import { useCallback, useEffect, useRef, useState } from 'react'
import type { AdminOperationCredentialInput } from '../../lib/adminAuth/adminOperationCredential'
import type { DisplayState } from '../../repositories/supabaseDisplayStateRepository'
import {
  supabasePresenterBridgeRepository,
  type PresenterConnectionStatus,
} from '../../repositories/supabasePresenterBridgeRepository'
import {
  presenterBridgeClient,
  type PresenterBridgeClientError,
} from '../../presenter/presenterBridgeClient'
import type {
  PresenterBridgeHealthResponse,
  PresenterIssueCode,
  PresenterPresentation,
} from '../../presenter/presenterBridgeProtocol'
import {
  clearPresenterMaterialPreferences,
  getPresenterMaterialConsentKey,
  getPresenterManualModeKey,
  hasPresenterManualMode,
  hasPresenterMaterialConsent,
  rememberPresenterMaterialConsent,
  setPresenterManualMode,
} from '../../presenter/presenterMaterialConsent'
import {
  clearPresenterPrivacyConsent,
  readPresenterPrivacyConsent,
  rememberPresenterPrivacyConsent,
} from '../../presenter/presenterPrivacyConsent'

export type PowerPointSyncPhase =
  | 'active'
  | 'activating'
  | 'checking'
  | 'consent'
  | 'error'
  | 'idle'
  | 'recovery'
  | 'review'

export type PowerPointReviewPresentation = Omit<
  PresenterPresentation,
  'bindingDigest'
> & {
  bindingDigest: string | null
}

type UseAdminPowerPointSyncInput = {
  activeLectureSessionId: string | null
  adminToken: AdminOperationCredentialInput
  displayState: DisplayState | null
  enabled: boolean
  lectureStatus: string
  onCommittedPage: () => void
  materialConsentScope: string
}

const ACTIVE_STATUS_INTERVAL_MS = 5_000
const PAIRING_STATUS_INTERVAL_MS = 1_000
const READINESS_INTERVAL_MS = 5_000
const AUTOMATIC_RECOVERY_REASONS = new Set([
  'disconnected',
  'deck_changed',
  'document_changed',
  'stale_heartbeat',
  'heartbeat_stale',
])
type PresenterConnectionStage = 'active' | 'pending' | 'terminal'
const bridgeErrorMessages: Readonly<Record<string, string>> = {
  bridge_unavailable:
    'Presenter Bridgeへ直接接続できません。復旧コードで接続できます。',
  connector_conflict:
    '別のPowerPointが同期中です。先に現在の同期を停止してください。',
  current_slide_order_mismatch:
    '現在のスライド位置を確認し、スライドショーを開き直してください。',
  custom_or_partial_show_unsupported:
    '目的別スライドショーでは同期できません。「すべてのスライド」に切り替えてください。',
  hidden_slides_unsupported:
    '非表示スライドがあります。非表示を解除してからもう一度接続してください。',
  invalid_session: '接続確認の期限が切れました。もう一度接続してください。',
  multiple_slide_shows:
    '複数のスライドショーが開いています。同期する1つだけを残してください。',
  page_count_mismatch:
    'PowerPointの枚数と講義資料のページ数が一致しません。資料を確認してください。',
  pairing_rate_limited:
    '接続操作が続きました。少し待ってからもう一度お試しください。',
  powerpoint_not_running:
    'PowerPointのスライドショーを開始してから、もう一度お試しください。',
  presenter_view_must_be_disabled:
    'PowerPointの発表者ツールをオフにしてから、もう一度お試しください。',
  presentation_changed:
    'PowerPointが変更されたため同期を停止しました。もう一度接続してください。',
  request_timeout:
    'Presenter Bridgeの応答を待てませんでした。復旧コードで接続できます。',
  slide_id_order_invalid:
    'スライド構成を確認し、PowerPointを保存して開き直してください。',
  ticket_invalid: '接続確認の期限が切れました。もう一度接続してください。',
  windowed_slide_show_required:
    'PowerPointを通常のスライドショー（全画面またはウィンドウ）で開いてください。',
}

function friendlyBridgeError(error: unknown) {
  const code = (error as PresenterBridgeClientError | undefined)?.code
  return (
    (code && bridgeErrorMessages[code]) ||
    'PowerPointを確認できませんでした。画面の状態を確認して、もう一度お試しください。'
  )
}

function readinessMessage(health: PresenterBridgeHealthResponse) {
  if (health.powerpointIssue === 'powerpoint_not_running')
    return 'PowerPointのスライドショーを開始すると自動で接続します。'
  if (health.powerpointIssue === 'observation_unavailable')
    return 'PowerPointの準備を確認しています。準備ができると自動で接続します。'
  return health.powerpointIssue
    ? friendlyBridgeError({ code: health.powerpointIssue })
    : 'PowerPointの準備ができました。'
}

function manualReviewFromStatus(
  connection: PresenterConnectionStatus,
): PowerPointReviewPresentation | null {
  if (
    !['inspected', 'confirmed'].includes(connection.state) ||
    connection.slideCount === null ||
    connection.hiddenSlideCount === null ||
    connection.customShowActive === null
  ) {
    return null
  }

  const issues: PresenterIssueCode[] = []
  if (connection.slideCount !== connection.pdfPageCount) {
    issues.push('page_count_mismatch')
  }
  if (connection.hiddenSlideCount !== 0) {
    issues.push('hidden_slides_unsupported')
  }
  if (connection.customShowActive) {
    issues.push('custom_or_partial_show_unsupported')
  }

  return {
    bindingDigest: null,
    currentSlideIndex: connection.lastCommittedPdfPage ?? 1,
    displayName: '接続中のPowerPoint',
    eligible: issues.length === 0,
    issues,
    slideCount: connection.slideCount,
  }
}

export function useAdminPowerPointSync(input: UseAdminPowerPointSyncInput) {
  const {
    activeLectureSessionId,
    adminToken,
    displayState,
    enabled,
    lectureStatus,
  } = input
  const inputRef = useRef(input)
  inputRef.current = input
  const [phase, setPhase] = useState<PowerPointSyncPhase>('idle')
  const [message, setMessage] = useState('')
  const [manualCode, setManualCode] = useState('')
  const [manualRecoveryRequired, setManualRecoveryRequired] = useState(false)
  const [presentation, setPresentation] =
    useState<PowerPointReviewPresentation | null>(null)
  const [serverConnection, setServerConnection] =
    useState<PresenterConnectionStatus | null>(null)
  const connectionIdRef = useRef<string | null>(null)
  const ownsIssuedConnectionRef = useRef(false)
  const localSessionRef = useRef<string | null>(null)
  const pairingTicketExpiresAtRef = useRef<string | null>(null)
  const manualRecoveryModeRef = useRef(false)
  const manualRecoveryReadyRef = useRef(false)
  const teacherConfirmedRef = useRef(false)
  const connectionStageRef = useRef<PresenterConnectionStage>('pending')
  const epochRef = useRef(0)
  const lastCommittedPageRef = useRef<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [privacyConsentAccepted, setPrivacyConsentAccepted] = useState(
    () => readPresenterPrivacyConsent() !== null,
  )
  const [waitingForReadiness, setWaitingForReadiness] = useState(false)
  const [pageVisible, setPageVisible] = useState(
    () => document.visibilityState === 'visible',
  )
  const healthRequestRef =
    useRef<Promise<PresenterBridgeHealthResponse> | null>(null)
  const readinessPendingConnectionRef = useRef<string | null>(null)
  const readinessIssueAttemptsRef = useRef(0)
  const [observedNativeFault, setObservedNativeFault] = useState(false)
  const [awaitingFaultReason, setAwaitingFaultReason] = useState(false)
  const terminalReasonPendingRef = useRef(false)
  const faultReasonChecksRef = useRef(0)
  const [watchingConnection, setWatchingConnection] = useState(false)
  const watchingConnectionRef = useRef(false)
  const automaticRecoveryAllowedRef = useRef(true)
  const reconnectFaultedRef = useRef(false)
  const operationRef = useRef(false)
  const statusRequestRef = useRef<Promise<void> | null>(null)
  const materialConsentKeyRef = useRef<string | null>(null)
  const manualModeKeyRef = useRef<string | null>(null)
  const manualPausedRef = useRef(false)
  const autoConfirmRef = useRef(false)
  const autoAttemptedRef = useRef<string | null>(null)
  const previousLectureRef = useRef<string | null>(null)
  const consentResumeRef = useRef<'automatic' | 'manual' | null>(null)
  const credentialRef = useRef(adminToken)
  const mountedRef = useRef(true)

  const clearLocalState = useCallback(() => {
    connectionIdRef.current = null
    ownsIssuedConnectionRef.current = false
    localSessionRef.current = null
    pairingTicketExpiresAtRef.current = null
    manualRecoveryModeRef.current = false
    manualRecoveryReadyRef.current = false
    teacherConfirmedRef.current = false
    connectionStageRef.current = 'pending'
    setManualRecoveryRequired(false)
    lastCommittedPageRef.current = null
    setManualCode('')
    setPresentation(null)
    setServerConnection(null)
    materialConsentKeyRef.current = null
    autoConfirmRef.current = false
    watchingConnectionRef.current = false
    setWatchingConnection(false)
    terminalReasonPendingRef.current = false
    setAwaitingFaultReason(false)
    faultReasonChecksRef.current = 0
    setWaitingForReadiness(false)
  }, [])

  const readHealth = useCallback(async () => {
    if (healthRequestRef.current) return healthRequestRef.current
    const request = presenterBridgeClient.health()
    healthRequestRef.current = request
    try {
      return await request
    } finally {
      if (healthRequestRef.current === request) healthRequestRef.current = null
    }
  }, [])

  useEffect(() => {
    const observeVisibility = () =>
      setPageVisible(document.visibilityState === 'visible')
    document.addEventListener('visibilitychange', observeVisibility)
    return () =>
      document.removeEventListener('visibilitychange', observeVisibility)
  }, [])

  useEffect(() => {
    const previousConnectionId = connectionIdRef.current
    const previousLocalSession = localSessionRef.current
    if (previousLectureRef.current !== activeLectureSessionId) {
      if (previousConnectionId && ownsIssuedConnectionRef.current) {
        void supabasePresenterBridgeRepository
          .revoke({
            adminToken: credentialRef.current,
            connectionId: previousConnectionId,
          })
          .catch(() => undefined)
      }
      if (previousLocalSession) {
        void presenterBridgeClient
          .disconnect(previousLocalSession)
          .catch(() => undefined)
      }
    }
    previousLectureRef.current = activeLectureSessionId
    credentialRef.current = inputRef.current.adminToken
    epochRef.current += 1
    autoAttemptedRef.current = null
    readinessPendingConnectionRef.current = null
    readinessIssueAttemptsRef.current = 0
    manualModeKeyRef.current = null
    manualPausedRef.current = false
    reconnectFaultedRef.current = false
    setObservedNativeFault(false)
    automaticRecoveryAllowedRef.current = true
    operationRef.current = false
    setBusy(false)
    clearLocalState()
    setMessage('')
    setPhase('idle')
  }, [activeLectureSessionId, adminToken.appSessionToken, clearLocalState])

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      epochRef.current += 1
      if (
        connectionStageRef.current === 'pending' &&
        ownsIssuedConnectionRef.current &&
        connectionIdRef.current
      ) {
        void supabasePresenterBridgeRepository
          .revoke({
            adminToken: inputRef.current.adminToken,
            connectionId: connectionIdRef.current,
          })
          .catch(() => undefined)
      }
      // Reload/navigation must not stop the native lecture. Server lifecycle,
      // explicit handover and the heartbeat lease remain authoritative.
    }
  }, [])

  useEffect(() => {
    const observeManualHandover = () => {
      const key = manualModeKeyRef.current
      if (!key || !hasPresenterManualMode(key)) return
      manualPausedRef.current = true
      reconnectFaultedRef.current = false
      autoConfirmRef.current = false
      setObservedNativeFault(false)
      setAwaitingFaultReason(false)
      setWaitingForReadiness(false)
    }
    window.addEventListener('storage', observeManualHandover)
    return () => window.removeEventListener('storage', observeManualHandover)
  }, [])

  const refreshStatus = useCallback(async () => {
    const { enabled, activeLectureSessionId, adminToken } = inputRef.current
    if (!enabled || !activeLectureSessionId || !connectionIdRef.current) {
      return
    }
    const epoch = epochRef.current
    const result = await supabasePresenterBridgeRepository.status({
      adminToken,
      lectureSessionId: activeLectureSessionId,
    })
    if (epoch !== epochRef.current) return
    if (
      connectionStageRef.current === 'terminal' &&
      !terminalReasonPendingRef.current
    )
      return

    const connection = result.connection
    if (connection && connection.connectionId !== connectionIdRef.current) {
      // A server-authoritative replacement belongs to the lecture. The old
      // local token must never be used to stop or inspect its successor.
      epochRef.current += 1
      operationRef.current = false
      setBusy(false)
      connectionIdRef.current = connection.connectionId
      ownsIssuedConnectionRef.current = false
      localSessionRef.current = null
      pairingTicketExpiresAtRef.current = null
      materialConsentKeyRef.current = null
      autoConfirmRef.current = false
      teacherConfirmedRef.current = false
      setPresentation(null)
      setManualCode('')
      manualRecoveryModeRef.current = false
      manualRecoveryReadyRef.current = false
      setManualRecoveryRequired(false)
      watchingConnectionRef.current = true
      setWatchingConnection(true)
      connectionStageRef.current = 'pending'
    }
    if (
      !result.runtimeEnabled ||
      !connection ||
      connection.state === 'revoked'
    ) {
      terminalReasonPendingRef.current = result.runtimeEnabled && !connection
      if (!terminalReasonPendingRef.current) setAwaitingFaultReason(false)
      automaticRecoveryAllowedRef.current = Boolean(
        result.runtimeEnabled &&
        connection?.revokeReason &&
        AUTOMATIC_RECOVERY_REASONS.has(connection.revokeReason),
      )
      if (
        !automaticRecoveryAllowedRef.current &&
        !terminalReasonPendingRef.current
      ) {
        reconnectFaultedRef.current = false
        setObservedNativeFault(false)
      }
      connectionStageRef.current = 'terminal'
      setServerConnection(connection)
      manualRecoveryModeRef.current = false
      manualRecoveryReadyRef.current = false
      teacherConfirmedRef.current = false
      setManualRecoveryRequired(false)
      setManualCode('')
      setPhase('error')
      setMessage(
        'PowerPoint同期は停止しました。手動操作は引き続き利用できます。',
      )
      return
    }

    if (connection.state === 'active') {
      terminalReasonPendingRef.current = false
      setAwaitingFaultReason(false)
      automaticRecoveryAllowedRef.current = true
      watchingConnectionRef.current = false
      setWatchingConnection(false)
      connectionStageRef.current = 'active'
      setServerConnection(connection)
      manualRecoveryModeRef.current = false
      manualRecoveryReadyRef.current = false
      teacherConfirmedRef.current = false
      setManualRecoveryRequired(false)
      setManualCode('')
      setPhase('active')
      setMessage('')
      if (
        connection.lastCommittedPdfPage !== null &&
        connection.lastCommittedPdfPage !== lastCommittedPageRef.current
      ) {
        lastCommittedPageRef.current = connection.lastCommittedPdfPage
        inputRef.current.onCommittedPage()
      }
      return
    }

    if (connectionStageRef.current === 'active') return

    if (Date.parse(connection.ticketExpiresAt) <= Date.now()) {
      connectionStageRef.current = 'terminal'
      setServerConnection(connection)
      manualRecoveryModeRef.current = false
      manualRecoveryReadyRef.current = false
      teacherConfirmedRef.current = false
      setManualRecoveryRequired(false)
      setManualCode('')
      setPhase('error')
      setMessage('復旧コードの有効期限が切れました。もう一度接続してください。')
      return
    }

    setServerConnection(connection)

    if (watchingConnectionRef.current) {
      setPhase('activating')
      setMessage('別の教員画面で接続を準備しています。')
      return
    }

    if (manualRecoveryModeRef.current) {
      if (!manualRecoveryReadyRef.current) return
      const manualReview = manualReviewFromStatus(connection)
      if (manualReview) {
        setPresentation(manualReview)
      }
      if (teacherConfirmedRef.current || connection.state === 'confirmed') {
        teacherConfirmedRef.current = true
        setPhase('activating')
        setMessage(
          'Presenter Bridgeで復旧コードを入力してください。接続完了を待っています…',
        )
      } else if (connection.state === 'inspected' && manualReview) {
        setPhase('review')
        setMessage(
          '復旧コードをPresenter Bridgeへ入力し、PowerPointと講義資料を確認してください。',
        )
      } else {
        setPhase('recovery')
      }
      return
    }

    if (!localSessionRef.current) {
      const manualReview = manualReviewFromStatus(connection)
      if (manualReview) {
        setPresentation(manualReview)
        if (connection.state === 'inspected') {
          setPhase('review')
          setMessage('PowerPointと講義資料を確認してください。')
        } else if (connection.state === 'confirmed') {
          setPhase('activating')
          setMessage('Presenter Bridgeの接続完了を待っています…')
        }
      }
    }
  }, [])

  useEffect(() => {
    if (
      !['active', 'activating', 'recovery', 'review'].includes(phase) &&
      !(phase === 'error' && awaitingFaultReason)
    )
      return
    let disposed = false
    let timeoutId: number | null = null
    const check = async () => {
      if (awaitingFaultReason && faultReasonChecksRef.current-- <= 0) {
        setAwaitingFaultReason(false)
        return
      }
      const epoch = epochRef.current
      const localSession = localSessionRef.current
      try {
        if (statusRequestRef.current) await statusRequestRef.current
        if (disposed) return
        const request = refreshStatus()
        statusRequestRef.current = request
        await request
        if (statusRequestRef.current === request)
          statusRequestRef.current = null
        if (
          (phase === 'active' || awaitingFaultReason) &&
          localSession &&
          localSession === localSessionRef.current &&
          epoch === epochRef.current
        ) {
          const localStatus =
            await presenterBridgeClient.getStatus(localSession)
          if (
            mountedRef.current &&
            epoch === epochRef.current &&
            localSession === localSessionRef.current &&
            localStatus.state === 'faulted' &&
            !(
              manualModeKeyRef.current &&
              hasPresenterManualMode(manualModeKeyRef.current)
            )
          ) {
            if (automaticRecoveryAllowedRef.current) {
              reconnectFaultedRef.current = true
              setObservedNativeFault(true)
              setAwaitingFaultReason(false)
              setMessage(
                'PowerPointを確認できなくなりました。手動操作へ切り替えられます。',
              )
            } else if (
              terminalReasonPendingRef.current &&
              !awaitingFaultReason
            ) {
              // An elapsed server lease may briefly hide the row before its
              // terminal reason is written. Only a positive local fault permits
              // three bounded, read-only checks; it never authorizes issuance.
              faultReasonChecksRef.current = 3
              setAwaitingFaultReason(true)
            }
          }
        }
      } catch {
        statusRequestRef.current = null
        if (!disposed) {
          setMessage(
            phase === 'active' || awaitingFaultReason
              ? '同期状態を確認できません。接続を維持しながら再確認します。'
              : '接続状態を確認しています…',
          )
        }
      } finally {
        if (!disposed) {
          timeoutId = window.setTimeout(
            () => void check(),
            phase === 'active' || awaitingFaultReason
              ? ACTIVE_STATUS_INTERVAL_MS
              : PAIRING_STATUS_INTERVAL_MS,
          )
        }
      }
    }
    void check()
    return () => {
      disposed = true
      if (timeoutId !== null) window.clearTimeout(timeoutId)
    }
  }, [awaitingFaultReason, phase, refreshStatus])

  const startAttempt = useCallback(
    async (automatic = false) => {
      if (operationRef.current) return
      const {
        displayState,
        activeLectureSessionId,
        adminToken,
        enabled,
        lectureStatus,
        materialConsentScope,
      } = inputRef.current
      const display = displayState
      const privacyConsent = readPresenterPrivacyConsent()
      setPrivacyConsentAccepted(privacyConsent !== null)
      if (enabled && activeLectureSessionId && !privacyConsent) {
        consentResumeRef.current = automatic ? 'automatic' : 'manual'
        setMessage('')
        setPhase('consent')
        return
      }
      if (enabled && activeLectureSessionId && lectureStatus === 'draft') {
        const epoch = ++epochRef.current
        operationRef.current = true
        setBusy(true)
        setPhase('checking')
        try {
          await readHealth()
          if (epoch === epochRef.current) {
            setMessage('Bridgeの準備ができました。講義開始時に自動接続します。')
          }
        } catch {
          if (epoch === epochRef.current) {
            setMessage('Bridgeを起動してから、もう一度接続を確認してください。')
          }
        } finally {
          if (epoch === epochRef.current) {
            operationRef.current = false
            setBusy(false)
            setPhase('idle')
          }
        }
        return
      }
      if (
        !enabled ||
        !activeLectureSessionId ||
        !adminToken ||
        lectureStatus !== 'open' ||
        !display?.pdfDocumentId ||
        !display.pdfDocumentVersion ||
        !display.pdfPageCount ||
        !display.pdfVisible
      ) {
        setPhase('error')
        setMessage('開始中の講義で、公開済みの講義資料を選択してください。')
        return
      }

      const epoch = ++epochRef.current
      const previousConnectionId = connectionIdRef.current
      const readinessPendingConnectionId = readinessPendingConnectionRef.current
      const readinessLocalSession = readinessPendingConnectionId
        ? localSessionRef.current
        : null
      const faultedLocalSession = reconnectFaultedRef.current
        ? localSessionRef.current
        : null
      const reconnectFaulted = reconnectFaultedRef.current
      reconnectFaultedRef.current = false
      operationRef.current = true
      setBusy(true)
      clearLocalState()
      setMessage('接続を準備しています…')
      setPhase('checking')
      try {
        const manualKey = await getPresenterManualModeKey(
          materialConsentScope,
          activeLectureSessionId,
        )
        if (epoch !== epochRef.current || !mountedRef.current) return
        manualModeKeyRef.current = manualKey
        if (!automatic) {
          manualPausedRef.current = false
          setPresenterManualMode(manualKey, false)
        }
        // Discover the server's active connection before issuing anything new.
        const existing = await supabasePresenterBridgeRepository.status({
          adminToken,
          lectureSessionId: activeLectureSessionId,
        })
        if (epoch !== epochRef.current || !mountedRef.current) return
        if (!existing.runtimeEnabled) {
          setPhase('idle')
          setMessage('')
          return
        }
        if (automatic && reconnectFaulted && !existing.connection) {
          connectionIdRef.current = previousConnectionId
          localSessionRef.current = faultedLocalSession
          connectionStageRef.current = 'terminal'
          terminalReasonPendingRef.current = true
          automaticRecoveryAllowedRef.current = false
          faultReasonChecksRef.current = 3
          setAwaitingFaultReason(true)
          setPhase('error')
          setMessage('同期の停止状態を確認しています。手動操作も使えます。')
          return
        }
        if (
          existing.connection?.state === 'active' &&
          (!reconnectFaulted ||
            existing.connection.connectionId !== previousConnectionId)
        ) {
          connectionIdRef.current = existing.connection.connectionId
          connectionStageRef.current = 'active'
          setServerConnection(existing.connection)
          setPhase('active')
          setMessage('')
          inputRef.current.onCommittedPage()
          return
        }
        if (
          automatic &&
          (manualPausedRef.current || hasPresenterManualMode(manualKey))
        ) {
          setPhase('idle')
          setMessage('手動スライド操作を利用中です。')
          return
        }
        if (
          automatic &&
          existing.connection?.state === 'revoked' &&
          existing.connection.revokeReason &&
          !AUTOMATIC_RECOVERY_REASONS.has(existing.connection.revokeReason)
        ) {
          setPhase('idle')
          setMessage('手動スライド操作を利用中です。')
          return
        }
        if (
          automatic &&
          existing.connection &&
          existing.connection.connectionId !== readinessPendingConnectionId &&
          ['pairing', 'inspected', 'confirmed'].includes(
            existing.connection.state,
          ) &&
          Date.parse(existing.connection.ticketExpiresAt) > Date.now()
        ) {
          connectionIdRef.current = existing.connection.connectionId
          setServerConnection(existing.connection)
          watchingConnectionRef.current = true
          setWatchingConnection(true)
          setPhase('activating')
          setMessage('別の教員画面で接続を準備しています。')
          return
        }
        if (
          existing.connection?.connectionId === readinessPendingConnectionId
        ) {
          connectionIdRef.current = readinessPendingConnectionId
          ownsIssuedConnectionRef.current = true
          localSessionRef.current = readinessLocalSession
        }
        if (
          reconnectFaulted &&
          existing.connection &&
          existing.connection.connectionId === previousConnectionId &&
          existing.connection.state !== 'revoked'
        ) {
          await supabasePresenterBridgeRepository.revoke({
            adminToken,
            connectionId: existing.connection.connectionId,
          })
        }
        if (faultedLocalSession) {
          await presenterBridgeClient
            .disconnect(faultedLocalSession)
            .catch(() => undefined)
        }
        if (epoch !== epochRef.current || !mountedRef.current) return
        try {
          const health = await readHealth()
          if (epoch !== epochRef.current || !mountedRef.current) return
          if (!health.powerpointReady) {
            setWaitingForReadiness(true)
            setPhase('idle')
            setMessage(readinessMessage(health))
            return
          }
        } catch {
          if (epoch !== epochRef.current) return
          setPhase('idle')
          setWaitingForReadiness(true)
          setMessage(
            'BridgeとPowerPointの起動を待っています。手動スライド操作も使えます。',
          )
          return
        }
        if (epoch !== epochRef.current || !mountedRef.current) return
        if (automatic && document.visibilityState !== 'visible') {
          setWaitingForReadiness(true)
          setPhase('idle')
          return
        }
        if (automatic && hasPresenterManualMode(manualKey)) {
          setPhase('idle')
          setMessage('手動スライド操作を利用中です。')
          return
        }
        if (readinessLocalSession) {
          await presenterBridgeClient
            .disconnect(readinessLocalSession)
            .catch(() => undefined)
          if (epoch !== epochRef.current || !mountedRef.current) return
        }
        if (
          automatic &&
          (manualPausedRef.current ||
            hasPresenterManualMode(manualKey) ||
            document.visibilityState !== 'visible')
        )
          return
        if (automatic) readinessIssueAttemptsRef.current += 1
        const issued = await supabasePresenterBridgeRepository.issue({
          adminToken,
          lectureSessionId: activeLectureSessionId,
        })
        if (epoch !== epochRef.current) {
          void supabasePresenterBridgeRepository
            .revoke({ adminToken, connectionId: issued.connectionId })
            .catch(() => undefined)
          return
        }
        connectionIdRef.current = issued.connectionId
        ownsIssuedConnectionRef.current = true
        readinessPendingConnectionRef.current = null
        pairingTicketExpiresAtRef.current = issued.pairingTicketExpiresAt
        setManualCode(issued.manualCode)

        try {
          const connected = await presenterBridgeClient.connect({
            lectureSessionId: activeLectureSessionId,
            pdfDocumentId: issued.pdf.documentId,
            pdfDocumentVersion: issued.pdf.documentVersion,
            pdfPageCount: issued.pdf.pageCount,
            ticket: issued.pairingTicket,
          })
          if (epoch !== epochRef.current) {
            void presenterBridgeClient
              .disconnect(connected.sessionToken)
              .catch(() => undefined)
            return
          }
          localSessionRef.current = connected.sessionToken
          if (
            automatic &&
            !connected.presentation.eligible &&
            connected.presentation.issues.every((issue) =>
              ['powerpoint_not_running', 'presenter_session_stopped'].includes(
                issue,
              ),
            )
          ) {
            readinessPendingConnectionRef.current = issued.connectionId
            setWaitingForReadiness(readinessIssueAttemptsRef.current < 2)
            setPhase('idle')
            setMessage(
              readinessIssueAttemptsRef.current < 2
                ? 'PowerPointのスライドショーを開始すると自動で接続します。'
                : 'PowerPointの準備を確認できませんでした。Bridgeの接続を確認してください。',
            )
            return
          }
          setPresentation(connected.presentation)
          if (connected.presentation.eligible) {
            readinessIssueAttemptsRef.current = 0
            const key = await getPresenterMaterialConsentKey({
              scope: materialConsentScope,
              pdfDocumentVersion: issued.pdf.documentVersion,
              pdfPageCount: issued.pdf.pageCount,
              deckBindingDigest: connected.presentation.bindingDigest,
            })
            if (epoch !== epochRef.current || !mountedRef.current) return
            materialConsentKeyRef.current = key
            autoConfirmRef.current = hasPresenterMaterialConsent(key)
          }
          setPhase('review')
          setMessage(
            connected.presentation.eligible
              ? 'PowerPointと講義資料を確認してください。'
              : 'このPowerPointは現在の講義資料と同期できません。',
          )
        } catch (bridgeError) {
          if (epoch !== epochRef.current) return
          const bridgeCode = (
            bridgeError as PresenterBridgeClientError | undefined
          )?.code
          let waitingForPowerPoint = bridgeCode === 'powerpoint_not_running'
          if (automatic && bridgeCode === 'ticket_invalid') {
            try {
              const health = await readHealth()
              waitingForPowerPoint =
                !health.powerpointReady &&
                health.powerpointIssue === 'powerpoint_not_running'
            } catch {
              /* An unknown failure retains the existing recovery flow. */
            }
            if (epoch !== epochRef.current || !mountedRef.current) return
          }
          if (automatic && waitingForPowerPoint) {
            readinessPendingConnectionRef.current = issued.connectionId
            setWaitingForReadiness(readinessIssueAttemptsRef.current < 2)
            setPhase('idle')
            setMessage(
              readinessIssueAttemptsRef.current < 2
                ? 'PowerPointのスライドショーを開始すると自動で接続します。'
                : 'PowerPointの準備を確認できませんでした。Bridgeの接続を確認してください。',
            )
            return
          }
          manualRecoveryModeRef.current = true
          manualRecoveryReadyRef.current = true
          teacherConfirmedRef.current = false
          setManualRecoveryRequired(true)
          setPhase('recovery')
          setMessage(friendlyBridgeError(bridgeError))
        }
      } catch (error) {
        if (epoch !== epochRef.current) return
        setPhase('error')
        setMessage(friendlyBridgeError(error))
      } finally {
        if (epoch === epochRef.current) {
          operationRef.current = false
          setBusy(false)
        }
      }
    },
    [clearLocalState, readHealth],
  )

  const start = useCallback(
    async (automatic = false) => {
      if (!automatic) return startAttempt(false)
      const current = inputRef.current
      if (
        !current.activeLectureSessionId ||
        !current.enabled ||
        document.visibilityState !== 'visible'
      )
        return
      const epoch = epochRef.current
      const key = await getPresenterManualModeKey(
        current.materialConsentScope,
        current.activeLectureSessionId,
      )
      if (!navigator.locks) return
      await navigator.locks.request(
        `compass-presenter-connection:${key}`,
        async () => {
          if (
            !mountedRef.current ||
            epoch !== epochRef.current ||
            document.visibilityState !== 'visible'
          )
            return
          await startAttempt(true)
        },
      )
    },
    [startAttempt],
  )

  const acceptPrivacyConsent = useCallback(() => {
    const consent = rememberPresenterPrivacyConsent()
    if (!consent) {
      setPrivacyConsentAccepted(false)
      setPhase('consent')
      setMessage(
        '同意をブラウザに保存できませんでした。ブラウザのサイトデータ設定を確認してください。',
      )
      return
    }
    setPrivacyConsentAccepted(true)
    setMessage('')
    manualPausedRef.current = false
    const resume = consentResumeRef.current
    consentResumeRef.current = null
    if (resume) void start(resume === 'automatic')
    else setPhase('idle')
  }, [start])

  const confirmConnection = useCallback(async () => {
    if (
      manualModeKeyRef.current &&
      hasPresenterManualMode(manualModeKeyRef.current)
    )
      return
    const connectionId = connectionIdRef.current
    if (
      !connectionId ||
      !presentation?.eligible ||
      connectionStageRef.current !== 'pending'
    ) {
      return
    }
    const epoch = epochRef.current
    const localSession = localSessionRef.current
    const pairingTicketExpiresAt = pairingTicketExpiresAtRef.current

    const transitionAutomaticPairingToRecovery = async () => {
      if (connectionStageRef.current !== 'pending') return
      manualRecoveryModeRef.current = true
      manualRecoveryReadyRef.current = false
      setManualRecoveryRequired(false)
      setPhase('activating')
      setMessage('Presenter Bridgeを安全に手動復旧へ切り替えています…')
      if (localSession) {
        await presenterBridgeClient
          .disconnect(localSession)
          .catch(() => undefined)
      }
      if (
        epoch === epochRef.current &&
        localSessionRef.current === localSession
      ) {
        localSessionRef.current = null
      }
      if (
        epoch !== epochRef.current ||
        connectionStageRef.current !== 'pending' ||
        !manualRecoveryModeRef.current
      ) {
        return
      }
      manualRecoveryReadyRef.current = true
      setManualRecoveryRequired(true)
      pairingTicketExpiresAtRef.current = null
      setPhase('recovery')
      setMessage(
        '自動接続の確認期限が切れました。表示中の復旧コードをPresenter Bridgeへ入力してください。',
      )
    }

    if (
      localSession &&
      (!pairingTicketExpiresAt ||
        Date.parse(pairingTicketExpiresAt) <= Date.now())
    ) {
      await transitionAutomaticPairingToRecovery()
      return
    }

    setMessage('同期を開始しています…')
    try {
      await supabasePresenterBridgeRepository.confirm({
        adminToken,
        connectionId,
      })
      if (
        epoch !== epochRef.current ||
        connectionStageRef.current !== 'pending'
      ) {
        return
      }
      if (
        manualModeKeyRef.current &&
        hasPresenterManualMode(manualModeKeyRef.current)
      ) {
        await refreshStatus()
        return
      }
      teacherConfirmedRef.current = true
      if (materialConsentKeyRef.current) {
        rememberPresenterMaterialConsent(materialConsentKeyRef.current)
      }
    } catch (error) {
      if (
        epoch !== epochRef.current ||
        connectionStageRef.current !== 'pending'
      ) {
        return
      }
      setPhase('review')
      setMessage(friendlyBridgeError(error))
      return
    }

    if (localSession && presentation.bindingDigest) {
      if (
        !pairingTicketExpiresAt ||
        Date.parse(pairingTicketExpiresAt) <= Date.now()
      ) {
        await transitionAutomaticPairingToRecovery()
        return
      }
      try {
        const active = await presenterBridgeClient.activate(
          localSession,
          presentation.bindingDigest,
        )
        if (
          epoch !== epochRef.current ||
          connectionStageRef.current !== 'pending'
        ) {
          return
        }
        connectionStageRef.current = 'active'
        setPresentation(active.presentation)
        manualRecoveryModeRef.current = false
        manualRecoveryReadyRef.current = false
        teacherConfirmedRef.current = false
        setManualRecoveryRequired(false)
        setManualCode('')
        setPhase('active')
        setMessage('')
      } catch {
        if (
          epoch !== epochRef.current ||
          connectionStageRef.current !== 'pending'
        ) {
          return
        }
        await transitionAutomaticPairingToRecovery()
        return
      }
    } else {
      setPhase('activating')
      setMessage('Presenter Bridgeの接続完了を待っています…')
    }
    await refreshStatus()
  }, [adminToken, presentation, refreshStatus])

  const confirm = useCallback(async () => {
    if (operationRef.current) return
    operationRef.current = true
    setBusy(true)
    const epoch = epochRef.current
    try {
      await confirmConnection()
    } finally {
      if (epoch === epochRef.current) {
        operationRef.current = false
        setBusy(false)
      }
    }
  }, [confirmConnection])

  useEffect(() => {
    if (phase !== 'review' || busy || !pageVisible || !autoConfirmRef.current)
      return
    autoConfirmRef.current = false
    void confirm()
  }, [busy, confirm, pageVisible, phase])

  const readyKey =
    enabled &&
    activeLectureSessionId &&
    lectureStatus === 'open' &&
    displayState?.pdfVisible &&
    displayState.pdfDocumentId &&
    displayState.pdfDocumentVersion &&
    displayState.pdfPageCount
      ? `${activeLectureSessionId}:${displayState.pdfDocumentVersion}:${displayState.pdfPageCount}`
      : null

  useEffect(() => {
    if (!pageVisible || !readyKey || autoAttemptedRef.current === readyKey)
      return
    autoAttemptedRef.current = readyKey
    void start(true)
  }, [adminToken.appSessionToken, pageVisible, readyKey, start])

  useEffect(() => {
    if (!waitingForReadiness || !pageVisible || !readyKey) return
    let disposed = false
    let timer: number | null = null
    const epoch = epochRef.current
    const check = async () => {
      const manualKey = manualModeKeyRef.current
      if (
        disposed ||
        epoch !== epochRef.current ||
        document.visibilityState !== 'visible' ||
        manualPausedRef.current ||
        (manualKey && hasPresenterManualMode(manualKey))
      )
        return
      try {
        const health = await readHealth()
        if (
          disposed ||
          epoch !== epochRef.current ||
          !mountedRef.current ||
          document.visibilityState !== 'visible'
        )
          return
        if (
          manualPausedRef.current ||
          (manualKey && hasPresenterManualMode(manualKey))
        )
          return
        if (health.powerpointReady) {
          await start(true)
          return
        }
        setMessage(readinessMessage(health))
      } catch {
        // Keep readiness local and quiet. No server retry or ticket is issued.
      }
      if (!disposed && epoch === epochRef.current)
        timer = window.setTimeout(() => void check(), READINESS_INTERVAL_MS)
    }
    timer = window.setTimeout(() => void check(), READINESS_INTERVAL_MS)
    return () => {
      disposed = true
      if (timer !== null) window.clearTimeout(timer)
    }
  }, [
    adminToken.appSessionToken,
    pageVisible,
    readHealth,
    readyKey,
    start,
    waitingForReadiness,
  ])

  useEffect(() => {
    if (!observedNativeFault || !readyKey || busy) return
    // A native fault is positive evidence. An unreachable Bridge or unknown
    // local token may mean the teacher exited it, so those never restart it.
    const timer = window.setTimeout(() => {
      setObservedNativeFault(false)
      void start(true)
    }, 1_000)
    return () => window.clearTimeout(timer)
  }, [busy, observedNativeFault, readyKey, start])

  const stop = useCallback(async (): Promise<boolean> => {
    if (operationRef.current) return false
    reconnectFaultedRef.current = false
    setObservedNativeFault(false)
    setWaitingForReadiness(false)
    manualPausedRef.current = true
    if (manualModeKeyRef.current)
      setPresenterManualMode(manualModeKeyRef.current, true)
    const connectionId = connectionIdRef.current
    const localSession = localSessionRef.current
    const epoch = epochRef.current
    let completed = false
    if (!connectionId) {
      clearLocalState()
      setPhase('idle')
      return true
    }
    operationRef.current = true
    setBusy(true)
    setMessage('手動操作へ切り替えています…')
    try {
      await supabasePresenterBridgeRepository.revoke({
        adminToken,
        connectionId,
      })
      if (epoch !== epochRef.current || !mountedRef.current) return false
      if (localSession) {
        await presenterBridgeClient
          .disconnect(localSession)
          .catch(() => undefined)
      }
      if (epoch !== epochRef.current || !mountedRef.current) return false
      epochRef.current += 1
      clearLocalState()
      completed = true
      setMessage('手動操作へ切り替えました。')
      setPhase('idle')
    } catch {
      if (epoch !== epochRef.current || !mountedRef.current) return false
      setMessage(
        '同期を停止できませんでした。状態を維持しているため、もう一度お試しください。',
      )
    } finally {
      if (completed || epoch === epochRef.current) {
        operationRef.current = false
        setBusy(false)
      }
    }
    return completed
  }, [adminToken, clearLocalState])

  const revokePrivacyConsent = useCallback(async () => {
    if (operationRef.current) return
    if (connectionIdRef.current && !(await stop())) return
    manualPausedRef.current = true
    consentResumeRef.current = 'manual'
    clearPresenterMaterialPreferences()
    clearPresenterPrivacyConsent()
    setPrivacyConsentAccepted(false)
    setMessage('')
    setPhase('consent')
  }, [stop])

  const manualNavigationLocked =
    phase === 'active' ||
    (serverConnection?.state === 'active' &&
      serverConnection.revokedAt === null)

  return {
    confirm,
    acceptPrivacyConsent,
    busy,
    watchingConnection,
    manualCode,
    manualRecoveryRequired,
    manualNavigationLocked,
    hasConnection: connectionIdRef.current !== null,
    message,
    phase,
    presentation,
    privacyConsentAccepted,
    revokePrivacyConsent,
    serverConnection,
    start,
    stop,
  }
}
