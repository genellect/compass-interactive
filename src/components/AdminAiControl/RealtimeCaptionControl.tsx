import { useEffect, useRef, useState } from 'react'
import type { AdminOperationCredentialInput } from '../../lib/adminAuth/adminOperationCredential'
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
  | 'idle'
  | 'requesting_microphone'
  | 'authorizing'
  | 'connecting'
  | 'running'
  | 'stopping'
  | 'error'

type RealtimeDuration = '600' | '1800' | 'remaining'

type RealtimeCaptionControlProps = {
  admissionEnabled: boolean
  adminToken: AdminOperationCredentialInput
  hardStopAt?: string | null
  lectureSessionId: string
  lectureStatus: string
  masterAuthorization: AiMasterAuthorization | null
}

const MICROPHONE_REQUEST_TIMEOUT_MS = 15_000

class MicrophoneRequestError extends Error {
  readonly reason:
    'denied' | 'not_found' | 'not_readable' | 'timeout' | 'unsupported'

  constructor(
    reason: 'denied' | 'not_found' | 'not_readable' | 'timeout' | 'unsupported',
  ) {
    super(reason)
    this.name = 'MicrophoneRequestError'
    this.reason = reason
  }
}

function classifyMicrophoneError(error: unknown) {
  if (error instanceof MicrophoneRequestError) return error
  const name =
    error && typeof error === 'object' && 'name' in error
      ? String(error.name)
      : ''
  if (
    ['NotAllowedError', 'PermissionDeniedError', 'SecurityError'].includes(name)
  ) {
    return new MicrophoneRequestError('denied')
  }
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
    return new MicrophoneRequestError('not_found')
  }
  if (['AbortError', 'NotReadableError', 'TrackStartError'].includes(name)) {
    return new MicrophoneRequestError('not_readable')
  }
  return new MicrophoneRequestError('not_readable')
}

function microphoneErrorMessage(error: unknown) {
  const requestError = classifyMicrophoneError(error)
  switch (requestError.reason) {
    case 'denied':
      return 'マイクの使用が許可されていません。ブラウザのサイト設定でマイクを許可してから、もう一度お試しください。'
    case 'not_found':
      return '利用できるマイクが見つかりません。マイクを接続してから、もう一度お試しください。'
    case 'not_readable':
      return 'マイクを開始できません。他のアプリが使用していないか確認して、もう一度お試しください。'
    case 'timeout':
      return 'マイクの確認が15秒以内に完了しませんでした。ブラウザのマイク許可を確認して、もう一度お試しください。'
    case 'unsupported':
      return 'このブラウザではマイクを利用できません。対応ブラウザで開いてください。'
  }
}

async function requestMicrophoneStream() {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new MicrophoneRequestError('unsupported')
  }

  let requestExpired = false
  let timeoutId: number | null = null
  const mediaRequest = navigator.mediaDevices.getUserMedia({
    audio: {
      autoGainControl: true,
      channelCount: 1,
      echoCancellation: true,
      noiseSuppression: true,
    },
    video: false,
  })
  void mediaRequest
    .then((lateStream) => {
      if (requestExpired) {
        lateStream.getTracks().forEach((track) => track.stop())
      }
    })
    .catch(() => undefined)

  try {
    return await Promise.race([
      mediaRequest,
      new Promise<never>((_, reject) => {
        timeoutId = window.setTimeout(() => {
          requestExpired = true
          reject(new MicrophoneRequestError('timeout'))
        }, MICROPHONE_REQUEST_TIMEOUT_MS)
      }),
    ])
  } catch (error) {
    throw classifyMicrophoneError(error)
  } finally {
    if (timeoutId !== null) window.clearTimeout(timeoutId)
  }
}

function findRunningCaptionOperation(recentOperations?: unknown[]) {
  const operation = recentOperations?.find(
    (candidate): candidate is { id: string } & Record<string, unknown> =>
      Boolean(candidate) &&
      typeof candidate === 'object' &&
      (candidate as Record<string, unknown>).feature === 'captions' &&
      (candidate as Record<string, unknown>).status === 'running' &&
      typeof (candidate as Record<string, unknown>).id === 'string',
  )
  return operation?.id ?? null
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
  admissionEnabled,
  adminToken,
  hardStopAt,
  lectureSessionId,
  lectureStatus,
  masterAuthorization,
}: RealtimeCaptionControlProps) {
  const [language, setLanguage] = useState<RealtimeCaptionLanguage>('auto')
  const [duration, setDuration] = useState<RealtimeDuration>('600')
  const [status, setStatus] = useState<CaptionControlStatus>('idle')
  const statusRef = useRef<CaptionControlStatus>('idle')
  const [message, setMessage] = useState(() =>
    !admissionEnabled
      ? '字幕の新規開始は停止中です。状態確認と停止は利用できます。'
      : '講義中のAI機能を許可すると字幕を開始できます。',
  )
  const [localCaption, setLocalCaption] = useState('')
  const [savedSegmentCount, setSavedSegmentCount] = useState(0)
  const [pricingRateMicrousdPerMinute, setPricingRateMicrousdPerMinute] =
    useState<number | null>(null)
  const sessionRef = useRef<RealtimeCaptionSession | null>(null)
  const startAttemptGenerationRef = useRef(0)
  const operationIdRef = useRef<string | null>(null)
  const startRequestIdRef = useRef<string | null>(null)
  const unresolvedGoogleStartRef = useRef<{
    grantRequestId: string
    startRequestId: string
  } | null>(null)
  const sequenceRef = useRef(0)
  const transportSequenceRef = useRef(0)
  const transportStreamIdRef = useRef(crypto.randomUUID())
  const itemSequenceRef = useRef(new Map<string, number>())
  const itemStartedAtRef = useRef(new Map<string, string>())
  const itemTextRef = useRef(new Map<string, string>())
  const segmentsRef = useRef<CompletedCaptionSegment[]>([])
  const lastPublishedRef = useRef('')
  const publishRequestIdsRef = useRef(new Map<string, string>())
  const publishTimerRef = useRef<number | null>(null)
  const publishInFlightRef = useRef<Promise<void> | null>(null)
  const heartbeatTimerRef = useRef<number | null>(null)
  const heartbeatInFlightRef = useRef(false)
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
    const operationId = operationIdRef.current
    const startRequestId = startRequestIdRef.current
    if (operationId && startRequestId) {
      return publishAdminCaptionRealtime(message, adminToken, {
        operationId,
        startRequestId,
      }).catch(() => undefined)
    }
    return Promise.resolve()
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

  function stopLocal(
    nextMessage: string,
    nextStatus: CaptionControlStatus,
    terminalConfirmed = true,
  ) {
    clearTimers()
    sessionRef.current?.stop()
    sessionRef.current = null
    if (terminalConfirmed) {
      operationIdRef.current = null
      startRequestIdRef.current = null
    }
    stopInFlightRef.current = false
    itemTextRef.current.clear()
    setLocalCaption('')
    updateStatus(nextStatus)
    setMessage(nextMessage)
    void broadcastCaption(null, 'stopped')
  }

  async function stopServerOperation(reason: string) {
    const operationId = operationIdRef.current
    if (!operationId || stopInFlightRef.current) return
    stopInFlightRef.current = true
    try {
      await supabaseAdminRepository.manageAiControl({
        action: 'stopFeature',
        adminToken,
        lectureSessionId,
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
    await broadcastCaption(null, 'stopped')
    let terminalConfirmed = !operationId
    if (operationId) {
      try {
        await stopServerOperation('client_fail_closed')
        terminalConfirmed = true
      } catch {
        setMessage(
          `${reason} 音声送信は停止しました。サーバー停止確認に失敗したため再開しないでください。`,
        )
      }
    }
    if (terminalConfirmed) {
      operationIdRef.current = null
      startRequestIdRef.current = null
    }
  }
  failClosedRef.current = failClosed

  useEffect(() => {
    const previouslyAuthorized = previousMasterAuthorizedRef.current
    previousMasterAuthorizedRef.current = masterAuthorized
    if (
      previouslyAuthorized &&
      !masterAuthorized &&
      [
        'requesting_microphone',
        'authorizing',
        'connecting',
        'running',
      ].includes(statusRef.current)
    ) {
      void failClosedRef.current('字幕の講義中AI許可が解除されました。')
      return
    }
    if (statusRef.current === 'idle') {
      setMessage(
        !admissionEnabled
          ? '字幕の新規開始は停止中です。状態確認と停止は利用できます。'
          : masterAuthorized
            ? '利用時間を選び、教員の操作で字幕を開始してください。'
            : '講義中のAI機能を許可すると字幕を開始できます。',
      )
    }
  }, [admissionEnabled, masterAuthorized])

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
      void broadcastCaption(normalized ? { text: normalized } : null, 'delta')
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
    void broadcastCaption({ text }, 'completed')
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
      const requestId =
        publishRequestIdsRef.current.get(fingerprint) ?? crypto.randomUUID()
      publishRequestIdsRef.current.set(fingerprint, requestId)
      const publishResult = await supabaseAdminRepository.publishCaptionWindow({
        adminToken,
        language: window.language,
        lastItemId: window.lastItemId,
        lectureSessionId,
        operationId,
        requestId,
        startRequestId: startRequestIdRef.current ?? undefined,
        sequence: window.sequence,
        text: window.text,
      })
      publishRequestIdsRef.current.delete(fingerprint)
      if (publishResult.shouldStop) {
        await failClosed('字幕の配信権限が終了しました。')
        return
      }
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
    if (!operationId || heartbeatInFlightRef.current) return
    heartbeatInFlightRef.current = true
    try {
      const response = await supabaseAdminRepository.manageAiControl({
        action: 'heartbeat',
        adminToken,
        lectureSessionId,
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
    } finally {
      heartbeatInFlightRef.current = false
    }
  }

  async function handleStart() {
    if (
      [
        'requesting_microphone',
        'authorizing',
        'connecting',
        'running',
      ].includes(status) ||
      masterHeldByOther ||
      !admissionEnabled ||
      !masterAuthorized
    )
      return
    if (lectureStatus !== 'open') {
      updateStatus('error')
      setMessage('開始済みで終了前の講義だけ字幕を開始できます。')
      return
    }

    if (unresolvedGoogleStartRef.current) {
      updateStatus('authorizing')
      setMessage('前回の字幕開始が確定したか確認しています。')
      try {
        const response = await supabaseAdminRepository.manageAiControl({
          action: 'status',
          adminToken,
          lectureSessionId,
        })
        const runningOperationId = findRunningCaptionOperation(
          response.recentOperations,
        )
        if (runningOperationId) {
          operationIdRef.current = runningOperationId
          updateStatus('error')
          setMessage(
            '前回の字幕開始を確認しました。音声は自動再接続せず、停止操作を実行してください。',
          )
          return
        }
        unresolvedGoogleStartRef.current = null
      } catch {
        updateStatus('error')
        setMessage(
          '前回の字幕開始を確認できません。重複開始を防ぐため、停止を押して状態確認を再試行してください。',
        )
        return
      }
    }

    transportSequenceRef.current = 0
    transportStreamIdRef.current = crypto.randomUUID()
    const startAttemptGeneration = ++startAttemptGenerationRef.current

    updateStatus('requesting_microphone')
    setMessage('ブラウザのマイク使用を確認しています。')
    let stream: MediaStream | null = null
    let providerStartAttempted = false
    try {
      stream = await requestMicrophoneStream()
      if (
        startAttemptGenerationRef.current !== startAttemptGeneration ||
        statusRef.current !== 'requesting_microphone'
      ) {
        stream.getTracks().forEach((track) => track.stop())
        return
      }
      updateStatus('authorizing')
      setMessage('講義のAI許可、選択時間、利用上限を確認しています。')
      const session = new RealtimeCaptionSession({
        mediaStream: stream,
        onEvent: handleRealtimeEvent,
        onFailure: (failureMessage) => void failClosed(failureMessage),
      })
      sessionRef.current = session
      const sdpOffer = await session.createOffer()
      const grantRequestId = crypto.randomUUID()
      const startRequestId = crypto.randomUUID()
      unresolvedGoogleStartRef.current = { grantRequestId, startRequestId }
      providerStartAttempted = true
      const providerCall =
        await supabaseAdminRepository.createRealtimeCaptionCall({
          adminToken,
          grantRequestId,
          startRequestId,
          delay: 'low',
          language,
          lectureSessionId,
          maxAudioSeconds: requestedAudioSeconds,
          sdpOffer,
        })
      setPricingRateMicrousdPerMinute(providerCall.pricingRateMicrousdPerMinute)
      operationIdRef.current = providerCall.operationId
      startRequestIdRef.current = startRequestId ?? null
      unresolvedGoogleStartRef.current = null
      updateStatus('connecting')
      setMessage('OpenAI Realtimeへ短寿命接続を準備しています。')
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
      stream?.getTracks().forEach((track) => track.stop())
      await failClosed(
        statusRef.current === 'requesting_microphone'
          ? microphoneErrorMessage(error)
          : error instanceof Error
            ? error.message
            : '字幕を開始できませんでした。',
      )
      if (providerStartAttempted) {
        try {
          const response = await supabaseAdminRepository.manageAiControl({
            action: 'status',
            adminToken,
            lectureSessionId,
          })
          const runningOperationId = findRunningCaptionOperation(
            response.recentOperations,
          )
          if (runningOperationId) {
            operationIdRef.current = runningOperationId
            updateStatus('error')
            setMessage(
              '字幕開始の応答は失われましたが、実行中の処理を確認しました。自動再接続せず、停止操作を実行してください。',
            )
          } else {
            unresolvedGoogleStartRef.current = null
          }
        } catch {
          setMessage(
            '字幕開始の結果を確認できません。重複開始を防ぐため、停止を押して状態確認を再試行してください。',
          )
        }
      }
    }
  }

  async function stopAtSelectedDuration() {
    if (statusRef.current !== 'running') return
    updateStatus('stopping')
    clearTimers()
    sessionRef.current?.stop()
    sessionRef.current = null
    setLocalCaption('')
    await broadcastCaption(null, 'stopped')
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
        false,
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
      if (!operationIdRef.current && unresolvedGoogleStartRef.current) {
        const response = await supabaseAdminRepository.manageAiControl({
          action: 'status',
          adminToken,
          lectureSessionId,
        })
        operationIdRef.current = findRunningCaptionOperation(
          response.recentOperations,
        )
        if (!operationIdRef.current) {
          unresolvedGoogleStartRef.current = null
          stopLocal(
            '前回の字幕開始は実行されていません。安全に再試行できます。',
            'idle',
          )
          return
        }
      }
      await broadcastCaption(null, 'stopped')
      await stopServerOperation('admin_manual_stop')
      unresolvedGoogleStartRef.current = null
      stopLocal('字幕を停止しました。停止に個人AI PINは不要です。', 'idle')
    } catch {
      stopLocal(
        '音声送信は停止しましたが、サーバー停止確認に失敗しました。再開しないでください。',
        'error',
        false,
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
        const runningCaptionOperationId = findRunningCaptionOperation(
          response.recentOperations,
        )
        if (
          runningCaptionOperationId &&
          !sessionRef.current &&
          statusRef.current === 'idle'
        ) {
          operationIdRef.current = runningCaptionOperationId
          updateStatus('error')
          setMessage(
            '実行中の字幕処理を確認しました。音声送信は自動再開せず、停止操作を実行してください。',
          )
        }
      })
      .catch(() => {
        if (active) setPricingRateMicrousdPerMinute(null)
      })
    return () => {
      active = false
    }
  }, [adminToken, lectureSessionId])

  useEffect(() => {
    unresolvedGoogleStartRef.current = null
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
      startAttemptGenerationRef.current += 1
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
            lectureSessionId,
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

  const isStarting =
    status === 'requesting_microphone' ||
    status === 'authorizing' ||
    status === 'connecting'
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
              : status === 'requesting_microphone'
                ? 'マイク確認中'
                : status === 'authorizing'
                  ? '利用確認中'
                  : status === 'connecting'
                    ? '接続中'
                    : status === 'error'
                      ? 'エラー'
                      : '停止中'}
        </span>
      </div>

      <p className="privacy-notice">
        音声はOpenAIへリアルタイム送信されます。COMPASSは音声ファイルを保存せず、この操作以外から自動開始しません。
      </p>

      <div className="caption-control-form">
        {!admissionEnabled ? (
          <p className="note">
            字幕の新規開始は停止中です。状態確認と停止は引き続き利用できます。
          </p>
        ) : masterHeldByOther ? (
          <p className="note">別の教員画面がAI許可を保持しています。</p>
        ) : masterAuthorized ? (
          <p className="note">講義中のAI許可を使用します。</p>
        ) : (
          <p className="note">
            上の「講義中のAI機能」で字幕を許可してください。
          </p>
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
            !admissionEnabled ||
            lectureStatus !== 'open' ||
            !masterAuthorized
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
