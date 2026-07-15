import { useEffect, useRef, useState } from 'react'
import {
  appendCompletedCaptionSegment,
  createCaptionWindow,
  normalizeCaptionText,
  type CompletedCaptionSegment,
} from '../../caption/captionWindow'
import {
  createTranscriptExport,
  deleteCompletedCaptionSegments,
  deleteExpiredCompletedCaptionSegments,
  listCompletedCaptionSegments,
  saveCompletedCaptionSegment,
} from '../../caption/captionTranscriptStore'
import { createCaptionBroadcastChannel } from '../../caption/captionBroadcast'
import {
  RealtimeCaptionSession,
  type RealtimeCaptionEvent,
} from '../../caption/realtimeCaptionSession'
import {
  supabaseAdminRepository,
  type RealtimeCaptionLanguage,
} from '../../repositories/supabaseAdminRepository'
import { AppIcon } from '../AppIcon'

type CaptionControlStatus =
  'idle' | 'authorizing' | 'connecting' | 'running' | 'stopping' | 'error'

type RealtimeCaptionControlProps = {
  adminToken: string
  hardStopAt?: string | null
  lectureSessionId: string
  lectureStatus: string
}

function createIdempotencyKey(lectureSessionId: string) {
  return `caption-${lectureSessionId}-${crypto.randomUUID()}`
}

function triggerTranscriptExport(
  segments: CompletedCaptionSegment[],
  lectureSessionId: string,
  format: 'jsonl' | 'txt',
) {
  const url = URL.createObjectURL(createTranscriptExport(segments, format))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `compass-transcript-${lectureSessionId}.${format}`
  anchor.click()
  URL.revokeObjectURL(url)
}

export function RealtimeCaptionControl({
  adminToken,
  hardStopAt,
  lectureSessionId,
  lectureStatus,
}: RealtimeCaptionControlProps) {
  const [billingPin, setBillingPin] = useState('')
  const [language, setLanguage] = useState<RealtimeCaptionLanguage>('auto')
  const [status, setStatus] = useState<CaptionControlStatus>('idle')
  const statusRef = useRef<CaptionControlStatus>('idle')
  const [message, setMessage] = useState(
    '課金PINを入力し、字幕を開始してください。',
  )
  const [localCaption, setLocalCaption] = useState('')
  const [savedSegmentCount, setSavedSegmentCount] = useState(0)
  const sessionRef = useRef<RealtimeCaptionSession | null>(null)
  const operationIdRef = useRef<string | null>(null)
  const sequenceRef = useRef(0)
  const itemSequenceRef = useRef(new Map<string, number>())
  const itemStartedAtRef = useRef(new Map<string, string>())
  const itemTextRef = useRef(new Map<string, string>())
  const segmentsRef = useRef<CompletedCaptionSegment[]>([])
  const lastPublishedRef = useRef('')
  const publishTimerRef = useRef<number | null>(null)
  const heartbeatTimerRef = useRef<number | null>(null)
  const stopInFlightRef = useRef(false)
  const broadcastRef = useRef<BroadcastChannel | null>(null)
  const failClosedRef = useRef<(reason: string) => Promise<void>>(
    async () => {},
  )

  function updateStatus(nextStatus: CaptionControlStatus) {
    statusRef.current = nextStatus
    setStatus(nextStatus)
  }

  function clearTimers() {
    if (publishTimerRef.current !== null) {
      window.clearInterval(publishTimerRef.current)
      publishTimerRef.current = null
    }
    if (heartbeatTimerRef.current !== null) {
      window.clearInterval(heartbeatTimerRef.current)
      heartbeatTimerRef.current = null
    }
  }

  function stopLocal(nextMessage: string, nextStatus: CaptionControlStatus) {
    clearTimers()
    sessionRef.current?.stop()
    sessionRef.current = null
    operationIdRef.current = null
    stopInFlightRef.current = false
    itemTextRef.current.clear()
    setLocalCaption('')
    updateStatus(nextStatus)
    setMessage(nextMessage)
    broadcastRef.current?.postMessage({
      caption: null,
      lectureSessionId,
      source: 'stopped',
      timestamp: Date.now(),
    })
  }

  async function stopServerOperation(reason: string) {
    const operationId = operationIdRef.current
    if (!operationId || stopInFlightRef.current) return
    stopInFlightRef.current = true
    try {
      await supabaseAdminRepository.manageAiControl({
        action: 'stopFeature',
        adminToken,
        operationId,
        reason,
      })
    } finally {
      stopInFlightRef.current = false
    }
  }

  async function failClosed(reason: string) {
    if (statusRef.current === 'idle' || statusRef.current === 'stopping') return
    const operationId = operationIdRef.current
    clearTimers()
    sessionRef.current?.stop()
    sessionRef.current = null
    updateStatus('error')
    setMessage(`${reason} 自動再接続はしません。再開には課金PINが必要です。`)
    setLocalCaption('')
    broadcastRef.current?.postMessage({
      caption: null,
      lectureSessionId,
      source: 'stopped',
      timestamp: Date.now(),
    })
    if (operationId) {
      try {
        await stopServerOperation('client_fail_closed')
      } catch {
        setMessage(
          `${reason} 音声送信は停止しました。サーバー停止確認に失敗したため再開しないでください。`,
        )
      }
    }
    operationIdRef.current = null
  }
  failClosedRef.current = failClosed

  function getItemSequence(itemId: string) {
    const existing = itemSequenceRef.current.get(itemId)
    if (existing !== undefined) return existing
    const sequence = sequenceRef.current
    sequenceRef.current += 1
    itemSequenceRef.current.set(itemId, sequence)
    itemStartedAtRef.current.set(itemId, new Date().toISOString())
    return sequence
  }

  function handleRealtimeEvent(event: RealtimeCaptionEvent) {
    const sequence = getItemSequence(event.itemId)
    if (event.type === 'delta') {
      const nextText = `${itemTextRef.current.get(event.itemId) ?? ''}${event.delta}`
      itemTextRef.current.set(event.itemId, nextText)
      const normalized = normalizeCaptionText(nextText)
      setLocalCaption(normalized)
      broadcastRef.current?.postMessage({
        caption: normalized ? { text: normalized } : null,
        lectureSessionId,
        source: 'delta',
        timestamp: Date.now(),
      })
      return
    }

    const text = normalizeCaptionText(
      event.transcript || itemTextRef.current.get(event.itemId) || '',
    )
    itemTextRef.current.delete(event.itemId)
    if (!text) return
    const completedAt = new Date().toISOString()
    const segment: CompletedCaptionSegment = {
      completedAt,
      itemId: event.itemId,
      language,
      lectureSessionId,
      sequence,
      startedAt: itemStartedAtRef.current.get(event.itemId) ?? completedAt,
      text,
    }
    segmentsRef.current = appendCompletedCaptionSegment(
      segmentsRef.current,
      segment,
    )
    setSavedSegmentCount(segmentsRef.current.length)
    setLocalCaption(text)
    void saveCompletedCaptionSegment(segment).catch(() => {
      setMessage('字幕は継続中ですが、ローカルレビュー用保存に失敗しました。')
    })
    broadcastRef.current?.postMessage({
      caption: { text },
      lectureSessionId,
      source: 'completed',
      timestamp: Date.now(),
    })
  }

  async function publishCompletedWindow() {
    const operationId = operationIdRef.current
    if (!operationId) return
    const window = createCaptionWindow(segmentsRef.current)
    if (!window) return
    const fingerprint = `${window.sequence}:${window.lastItemId}:${window.text}`
    if (fingerprint === lastPublishedRef.current) return
    await supabaseAdminRepository.publishCaptionWindow({
      adminToken,
      language: window.language,
      lastItemId: window.lastItemId,
      lectureSessionId,
      operationId,
      sequence: window.sequence,
      text: window.text,
    })
    lastPublishedRef.current = fingerprint
  }

  async function heartbeat() {
    const operationId = operationIdRef.current
    if (!operationId) return
    const response = await supabaseAdminRepository.manageAiControl({
      action: 'heartbeat',
      adminToken,
      operationId,
    })
    const result = response.result as
      { reason?: string; should_stop?: boolean } | undefined
    if (result?.should_stop) {
      await failClosed(result.reason ?? '講義または字幕処理が終了しました。')
    }
  }

  async function handleStart() {
    if (status === 'running' || status === 'connecting' || !billingPin) return
    if (lectureStatus !== 'open') {
      updateStatus('error')
      setMessage('開始済みで終了前の講義だけ字幕を開始できます。')
      return
    }

    updateStatus('authorizing')
    setMessage('課金PINと講義上限を確認しています。')
    let stream: MediaStream | null = null
    try {
      const authorization = await supabaseAdminRepository.authorizeAiStart({
        actions: ['captions'],
        adminToken,
        billingPin,
        lectureSessionId,
      })
      setBillingPin('')
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          autoGainControl: true,
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
        },
        video: false,
      })
      updateStatus('connecting')
      setMessage('OpenAI Realtimeへ短寿命接続を準備しています。')
      const secret = await supabaseAdminRepository.issueRealtimeCaptionSecret({
        adminToken,
        billingGrant: authorization.billingGrant,
        delay: 'low',
        idempotencyKey: createIdempotencyKey(lectureSessionId),
        language,
        lectureSessionId,
      })
      operationIdRef.current = secret.operationId
      const session = new RealtimeCaptionSession({
        clientSecret: secret.clientSecret,
        mediaStream: stream,
        onEvent: handleRealtimeEvent,
        onFailure: (failureMessage) => void failClosed(failureMessage),
      })
      sessionRef.current = session
      await session.connect()
      updateStatus('running')
      setMessage(
        '教員端末だけでRealtime差分を表示し、完了字幕を5秒ごとに同期します。',
      )
      publishTimerRef.current = window.setInterval(() => {
        void publishCompletedWindow().catch((error) =>
          failClosed(
            error instanceof Error ? error.message : '字幕同期に失敗しました。',
          ),
        )
      }, 5_000)
      heartbeatTimerRef.current = window.setInterval(() => {
        void heartbeat().catch((error) =>
          failClosed(
            error instanceof Error
              ? error.message
              : '字幕の利用状態を確認できません。',
          ),
        )
      }, 15_000)
    } catch (error) {
      setBillingPin('')
      stream?.getTracks().forEach((track) => track.stop())
      await failClosed(
        error instanceof Error ? error.message : '字幕を開始できませんでした。',
      )
    }
  }

  async function handleStop() {
    if (status !== 'running' && status !== 'error') return
    updateStatus('stopping')
    clearTimers()
    sessionRef.current?.stop()
    sessionRef.current = null
    setLocalCaption('')
    try {
      await stopServerOperation('admin_manual_stop')
      stopLocal('字幕を停止しました。停止には課金PINは不要です。', 'idle')
    } catch {
      stopLocal(
        '音声送信は停止しましたが、サーバー停止確認に失敗しました。再開しないでください。',
        'error',
      )
    }
  }

  async function handleExport(format: 'jsonl' | 'txt') {
    const segments = await listCompletedCaptionSegments(lectureSessionId)
    triggerTranscriptExport(segments, lectureSessionId, format)
  }

  async function handleDeleteLocalTranscript() {
    await deleteCompletedCaptionSegments(lectureSessionId)
    segmentsRef.current = []
    setSavedSegmentCount(0)
    setMessage('この端末のレビュー用字幕を削除しました。')
  }

  useEffect(() => {
    broadcastRef.current = createCaptionBroadcastChannel(lectureSessionId)
    void deleteExpiredCompletedCaptionSegments()
      .then(() => listCompletedCaptionSegments(lectureSessionId))
      .then((segments) => {
        segmentsRef.current = segments
        setSavedSegmentCount(segments.length)
        sequenceRef.current = (segments.at(-1)?.sequence ?? -1) + 1
      })
    return () => {
      const operationId = operationIdRef.current
      broadcastRef.current?.close()
      broadcastRef.current = null
      clearTimers()
      sessionRef.current?.stop()
      sessionRef.current = null
      operationIdRef.current = null
      if (operationId) {
        void supabaseAdminRepository
          .manageAiControl({
            action: 'stopFeature',
            adminToken,
            operationId,
            reason: 'client_unmount',
          })
          .catch(() => undefined)
      }
    }
  }, [adminToken, lectureSessionId])

  useEffect(() => {
    if (lectureStatus === 'closed' && status === 'running') {
      void failClosedRef.current('講義が終了しました。')
    }
  }, [lectureStatus, status])

  useEffect(() => {
    const hardStopMs = Date.parse(hardStopAt ?? '')
    if (!Number.isFinite(hardStopMs) || status !== 'running') return
    const timer = window.setTimeout(
      () => {
        void failClosedRef.current('講義の90分期限に到達しました。')
      },
      Math.max(0, hardStopMs - Date.now()),
    )
    return () => window.clearTimeout(timer)
  }, [hardStopAt, status])

  const isStarting = status === 'authorizing' || status === 'connecting'
  return (
    <section className="realtime-caption-control">
      <div className="panel-heading">
        <div className="section-intro">
          <span className="section-icon violet">
            <AppIcon name="message" size={18} />
          </span>
          <div>
            <p className="eyebrow">OPENAI REALTIME</p>
            <h3>教員端末のリアルタイム字幕</h3>
          </div>
        </div>
        <span
          className={`support-state ${status === 'running' ? 'is-ready' : ''}`}
        >
          {status === 'running'
            ? '配信中'
            : status === 'idle'
              ? '停止中'
              : '確認中'}
        </span>
      </div>

      <p className="privacy-notice">
        マイク音声はOpenAIへリアルタイム送信されますが、COMPASSは音声ファイルを保存しません。
        差分字幕は教員端末内だけ、学生には完了済みの短い字幕窓だけを5秒同期します。
      </p>

      <div className="caption-control-form">
        <label className="field">
          <span>課金PIN（Admin PINとは別）</span>
          <input
            autoComplete="new-password"
            disabled={status === 'running' || isStarting}
            maxLength={128}
            onChange={(event) => setBillingPin(event.target.value)}
            type="password"
            value={billingPin}
          />
        </label>
        <label className="field compact-field">
          <span>主言語</span>
          <select
            disabled={status === 'running' || isStarting}
            onChange={(event) =>
              setLanguage(event.target.value as RealtimeCaptionLanguage)
            }
            value={language}
          >
            <option value="auto">自動</option>
            <option value="ja">日本語</option>
            <option value="en">英語</option>
          </select>
        </label>
        <button
          className="primary-button"
          disabled={
            status === 'running' ||
            isStarting ||
            lectureStatus !== 'open' ||
            billingPin.length < 1
          }
          onClick={() => void handleStart()}
          type="button"
        >
          字幕を開始
        </button>
        <button
          className="secondary-button"
          disabled={status !== 'running' && status !== 'error'}
          onClick={() => void handleStop()}
          type="button"
        >
          字幕を停止
        </button>
      </div>

      <div className="caption-local-preview" aria-live="polite">
        <small>教員端末のみ・Realtime差分</small>
        <p>{localCaption || '字幕を待機しています。'}</p>
      </div>
      <p className={status === 'error' ? 'error-note' : 'note'}>{message}</p>
      <div className="caption-local-actions">
        <span>ローカル保存済み完了字幕: {savedSegmentCount}件</span>
        <button onClick={() => void handleExport('txt')} type="button">
          TXT書き出し
        </button>
        <button onClick={() => void handleExport('jsonl')} type="button">
          JSONL書き出し
        </button>
        <button
          onClick={() => void handleDeleteLocalTranscript()}
          type="button"
        >
          この端末から削除
        </button>
      </div>
    </section>
  )
}
