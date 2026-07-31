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
import { publishAdminCaptionRealtime } from '../../display/displayRealtime'
import {
  RealtimeCaptionSession,
  type RealtimeCaptionEvent,
} from '../../caption/realtimeCaptionSession'
import {
  supabaseAdminRepository,
  type AiMasterAuthorization,
  type RealtimeCaptionLanguage,
} from '../../repositories/supabaseAdminRepository'
import { AppIcon } from '../AppIcon'
import {
  masterAuthorizationHeldByOther,
  masterAuthorizesFeature,
} from './aiMasterAuthorization'
import './RealtimeCaptionControl.css'

type CaptionControlStatus =
  'idle' | 'authorizing' | 'connecting' | 'running' | 'stopping' | 'error'

type RealtimeDuration = '600' | '1800' | 'remaining'

type RealtimeCaptionControlProps = {
  adminToken: string
  hardStopAt?: string | null
  lectureSessionId: string
  lectureStatus: string
  masterAuthorization: AiMasterAuthorization | null
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
  masterAuthorization,
}: RealtimeCaptionControlProps) {
  const [billingPin, setBillingPin] = useState('')
  const [language, setLanguage] = useState<RealtimeCaptionLanguage>('auto')
  const [duration, setDuration] = useState<RealtimeDuration>('600')
  const [status, setStatus] = useState<CaptionControlStatus>('idle')
  const statusRef = useRef<CaptionControlStatus>('idle')
  const [message, setMessage] = useState(
    'API利用PINを入力し、利用時間を選んで字幕を開始してください。',
  )
  const [localCaption, setLocalCaption] = useState('')
  const [savedSegmentCount, setSavedSegmentCount] = useState(0)
  const [pricingRateMicrousdPerMinute, setPricingRateMicrousdPerMinute] =
    useState<number | null>(null)
  const sessionRef = useRef<RealtimeCaptionSession | null>(null)
  const operationIdRef = useRef<string | null>(null)
  const sequenceRef = useRef(0)
  const transportSequenceRef = useRef(0)
  const transportStreamIdRef = useRef(crypto.randomUUID())
  const itemSequenceRef = useRef(new Map<string, number>())
  const itemStartedAtRef = useRef(new Map<string, string>())
  const itemTextRef = useRef(new Map<string, string>())
  const segmentsRef = useRef<CompletedCaptionSegment[]>([])
  const lastPublishedRef = useRef('')
  const publishTimerRef = useRef<number | null>(null)
  const publishInFlightRef = useRef<Promise<void> | null>(null)
  const heartbeatTimerRef = useRef<number | null>(null)
  const durationTimerRef = useRef<number | null>(null)
  const stopInFlightRef = useRef(false)
  const broadcastRef = useRef<BroadcastChannel | null>(null)
  const failClosedRef = useRef<(reason: string) => Promise<void>>(
    async () => {},
  )
  const previousMasterAuthorizedRef = useRef(false)
  const masterAuthorized = masterAuthorizesFeature(
    masterAuthorization,
    'captions',
  )
  const masterHeldByOther = masterAuthorizationHeldByOther(masterAuthorization)

  function updateStatus(nextStatus: CaptionControlStatus) {
    statusRef.current = nextStatus
    setStatus(nextStatus)
  }

  function broadcastCaption(
    caption: { text: string } | null,
    source: 'completed' | 'delta' | 'stopped',
  ) {
    const message = {
      caption: caption ? { text: caption.text.slice(-4_000) } : null,
      lectureSessionId,
      sequence: transportSequenceRef.current,
      source,
      streamId: transportStreamIdRef.current,
      timestamp: Date.now(),
    } as const
    transportSequenceRef.current += 1
    broadcastRef.current?.postMessage(message)
    void publishAdminCaptionRealtime(message).catch(() => undefined)
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
    if (durationTimerRef.current !== null) {
      window.clearTimeout(durationTimerRef.current)
      durationTimerRef.current = null
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
    broadcastCaption(null, 'stopped')
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
    setMessage(
      `${reason} 自動再接続はしません。再開は教員が明示的に操作してください。`,
    )
    setLocalCaption('')
    broadcastCaption(null, 'stopped')
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

  useEffect(() => {
    const previouslyAuthorized = previousMasterAuthorizedRef.current
    previousMasterAuthorizedRef.current = masterAuthorized
    if (
      previouslyAuthorized &&
      !masterAuthorized &&
      ['authorizing', 'connecting', 'running'].includes(statusRef.current)
    ) {
      void failClosedRef.current('字幕の講義中API許可が解除されました。')
      return
    }
    if (statusRef.current === 'idle') {
      setMessage(
        masterAuthorized
          ? '利用時間を選び、教員の操作で字幕を開始してください。'
          : 'API利用PINを入力し、利用時間を選んで字幕を開始してください。',
      )
    }
  }, [masterAuthorized])

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
      broadcastCaption(normalized ? { text: normalized } : null, 'delta')
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
    broadcastCaption({ text }, 'completed')
  }

  async function publishCompletedWindow() {
    if (publishInFlightRef.current) {
      return publishInFlightRef.current
    }

    const publish = (async () => {
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
      if (operationIdRef.current === operationId) {
        lastPublishedRef.current = fingerprint
      }
    })()
    publishInFlightRef.current = publish
    try {
      await publish
    } finally {
      if (publishInFlightRef.current === publish) {
        publishInFlightRef.current = null
      }
    }
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
      if (result.reason === 'selected_duration_elapsed') {
        stopLocal(
          '選択した利用時間に到達したため字幕を停止しました。再開は教員が明示的に操作してください。',
          'idle',
        )
        return
      }
      await failClosed(result.reason ?? '講義または字幕処理が終了しました。')
    }
  }

  async function handleStart() {
    if (
      status === 'running' ||
      status === 'connecting' ||
      masterHeldByOther ||
      (!masterAuthorized && !billingPin)
    )
      return
    if (lectureStatus !== 'open') {
      updateStatus('error')
      setMessage('開始済みで終了前の講義だけ字幕を開始できます。')
      return
    }

    transportSequenceRef.current = 0
    transportStreamIdRef.current = crypto.randomUUID()

    updateStatus('authorizing')
    setMessage('API利用PIN、選択時間、講義上限を確認しています。')
    let stream: MediaStream | null = null
    try {
      const authorization = await supabaseAdminRepository.authorizeAiStart({
        actions: ['captions'],
        adminToken,
        billingPin: masterAuthorized ? undefined : billingPin,
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
      const session = new RealtimeCaptionSession({
        mediaStream: stream,
        onEvent: handleRealtimeEvent,
        onFailure: (failureMessage) => void failClosed(failureMessage),
      })
      sessionRef.current = session
      const sdpOffer = await session.createOffer()
      const providerCall =
        await supabaseAdminRepository.createRealtimeCaptionCall({
          adminToken,
          billingGrant: authorization.billingGrant,
          delay: 'low',
          idempotencyKey: createIdempotencyKey(lectureSessionId),
          language,
          lectureSessionId,
          maxAudioSeconds: requestedAudioSeconds,
          sdpOffer,
        })
      setPricingRateMicrousdPerMinute(providerCall.pricingRateMicrousdPerMinute)
      operationIdRef.current = providerCall.operationId
      await session.connect(providerCall.sdpAnswer)
      updateStatus('running')
      setMessage(
        `字幕を開始しました。最大${Math.ceil(providerCall.reservedAudioSeconds / 60)}分、上限概算$${(
          providerCall.reservedMicrousd / 1_000_000
        ).toFixed(2)}です。完了字幕を5秒ごとに同期します。`,
      )
      durationTimerRef.current = window.setTimeout(
        () => {
          void stopAtSelectedDuration()
        },
        Math.max(1_000, Date.parse(providerCall.reservedUntil) - Date.now()),
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

  async function stopAtSelectedDuration() {
    if (statusRef.current !== 'running') return
    updateStatus('stopping')
    clearTimers()
    sessionRef.current?.stop()
    sessionRef.current = null
    setLocalCaption('')
    try {
      await stopServerOperation('selected_duration_elapsed')
      stopLocal(
        '選択した利用時間に到達したため字幕を停止しました。再開は教員が明示的に操作してください。',
        'idle',
      )
    } catch {
      stopLocal(
        '選択した利用時間で音声送信を停止しました。サーバー停止確認に失敗したため再開しないでください。',
        'error',
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
      stopLocal('字幕を停止しました。停止にはAPI利用PINは不要です。', 'idle')
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
    let active = true
    setPricingRateMicrousdPerMinute(null)
    void supabaseAdminRepository
      .manageAiControl({
        action: 'status',
        adminToken,
        lectureSessionId,
      })
      .then((response) => {
        if (!active) return
        const rate = response.realtimePriceMicrousdPerMinute
        setPricingRateMicrousdPerMinute(
          typeof rate === 'number' && Number.isSafeInteger(rate) && rate > 0
            ? rate
            : null,
        )
      })
      .catch(() => {
        if (active) setPricingRateMicrousdPerMinute(null)
      })
    return () => {
      active = false
    }
  }, [adminToken, lectureSessionId])

  useEffect(() => {
    transportSequenceRef.current = 0
    transportStreamIdRef.current = crypto.randomUUID()
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
  const hardStopMs = Date.parse(hardStopAt ?? '')
  const remainingAudioSeconds = Number.isFinite(hardStopMs)
    ? Math.max(
        1,
        Math.min(5_400, Math.floor((hardStopMs - Date.now()) / 1_000)),
      )
    : 5_400
  const requestedAudioSeconds =
    duration === 'remaining' ? remainingAudioSeconds : Number(duration)
  const estimatedMicrousd = pricingRateMicrousdPerMinute
    ? Math.ceil((requestedAudioSeconds * pricingRateMicrousdPerMinute) / 60)
    : null
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
        音声はOpenAIへリアルタイム送信されます。COMPASSは音声ファイルを保存せず、この操作以外から自動開始しません。
      </p>

      <div className="caption-control-form">
        {masterHeldByOther ? (
          <p className="note">別の教員画面がAI許可を保持しています。</p>
        ) : masterAuthorized ? (
          <p className="note">講義中のAPI許可を使用します。</p>
        ) : (
          <label className="field">
            <span>API利用PIN（管理PINとは別）</span>
            <input
              autoComplete="new-password"
              disabled={status === 'running' || isStarting || masterHeldByOther}
              maxLength={128}
              onChange={(event) => setBillingPin(event.target.value)}
              type="password"
              value={billingPin}
            />
          </label>
        )}
        <label className="field compact-field">
          <span>利用時間</span>
          <select
            disabled={status === 'running' || isStarting}
            onChange={(event) =>
              setDuration(event.target.value as RealtimeDuration)
            }
            value={duration}
          >
            <option value="600">10分</option>
            <option value="1800">30分</option>
            <option value="remaining">講義終了まで</option>
          </select>
          <small>
            {estimatedMicrousd === null
              ? '開始時に現在の単価から上限を確定します'
              : `上限概算 $${(estimatedMicrousd / 1_000_000).toFixed(2)}（実額は利用時間で変動）`}
          </small>
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
            masterHeldByOther ||
            lectureStatus !== 'open' ||
            (!masterAuthorized && billingPin.length < 1)
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
