import { useCallback, useEffect, useRef, useState } from 'react'
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
  PresenterIssueCode,
  PresenterPresentation,
} from '../../presenter/presenterBridgeProtocol'

export type PowerPointSyncPhase =
  | 'active'
  | 'activating'
  | 'checking'
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
  adminToken: string
  displayState: DisplayState | null
  enabled: boolean
  lectureStatus: string
  onCommittedPage: () => void
}

const ACTIVE_STATUS_INTERVAL_MS = 5_000
const PAIRING_STATUS_INTERVAL_MS = 1_000
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
    'PowerPointをウィンドウ表示のスライドショーに切り替えてください。',
}

function friendlyBridgeError(error: unknown) {
  const code = (error as PresenterBridgeClientError | undefined)?.code
  return (
    (code && bridgeErrorMessages[code]) ||
    'PowerPointを確認できませんでした。画面の状態を確認して、もう一度お試しください。'
  )
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
    onCommittedPage,
  } = input
  const [phase, setPhase] = useState<PowerPointSyncPhase>('idle')
  const [message, setMessage] = useState('')
  const [manualCode, setManualCode] = useState('')
  const [manualRecoveryRequired, setManualRecoveryRequired] = useState(false)
  const [presentation, setPresentation] =
    useState<PowerPointReviewPresentation | null>(null)
  const [serverConnection, setServerConnection] =
    useState<PresenterConnectionStatus | null>(null)
  const connectionIdRef = useRef<string | null>(null)
  const localSessionRef = useRef<string | null>(null)
  const pairingTicketExpiresAtRef = useRef<string | null>(null)
  const manualRecoveryModeRef = useRef(false)
  const manualRecoveryReadyRef = useRef(false)
  const teacherConfirmedRef = useRef(false)
  const connectionStageRef = useRef<PresenterConnectionStage>('pending')
  const epochRef = useRef(0)
  const lastCommittedPageRef = useRef<number | null>(null)

  const clearLocalState = useCallback(() => {
    connectionIdRef.current = null
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
  }, [])

  useEffect(() => {
    epochRef.current += 1
    clearLocalState()
    setMessage('')
    setPhase('idle')

    return () => {
      const connectionId = connectionIdRef.current
      const localSession = localSessionRef.current
      epochRef.current += 1
      connectionIdRef.current = null
      localSessionRef.current = null
      pairingTicketExpiresAtRef.current = null
      manualRecoveryModeRef.current = false
      manualRecoveryReadyRef.current = false
      teacherConfirmedRef.current = false
      connectionStageRef.current = 'pending'
      lastCommittedPageRef.current = null

      if (localSession) {
        void presenterBridgeClient
          .disconnect(localSession)
          .catch(() => undefined)
      }
      if (connectionId && adminToken) {
        void supabasePresenterBridgeRepository
          .revoke({ adminToken, connectionId })
          .catch(() => undefined)
      }
    }
  }, [activeLectureSessionId, adminToken, clearLocalState])

  const refreshStatus = useCallback(async () => {
    if (
      !enabled ||
      !activeLectureSessionId ||
      !adminToken ||
      !connectionIdRef.current
    ) {
      return
    }
    const epoch = epochRef.current
    const result = await supabasePresenterBridgeRepository.status({
      adminToken,
      lectureSessionId: activeLectureSessionId,
    })
    if (epoch !== epochRef.current) return
    if (connectionStageRef.current === 'terminal') return

    const connection = result.connection
    if (
      !result.runtimeEnabled ||
      !connection ||
      connection.state === 'revoked'
    ) {
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
        onCommittedPage()
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
  }, [activeLectureSessionId, adminToken, enabled, onCommittedPage])

  useEffect(() => {
    if (!['active', 'activating', 'recovery', 'review'].includes(phase)) return
    let disposed = false
    const check = async () => {
      try {
        await refreshStatus()
        const localSession = localSessionRef.current
        if (!disposed && phase === 'active' && localSession) {
          const localStatus =
            await presenterBridgeClient.getStatus(localSession)
          if (!disposed && localStatus.state === 'faulted') {
            setMessage(
              'PowerPointを確認できなくなりました。手動操作へ切り替えられます。',
            )
          }
        }
      } catch {
        if (!disposed) {
          setMessage(
            phase === 'active'
              ? '同期状態を確認できません。接続を維持しながら再確認します。'
              : '接続状態を確認しています…',
          )
        }
      }
    }
    void check()
    const intervalId = window.setInterval(
      () => void check(),
      phase === 'active'
        ? ACTIVE_STATUS_INTERVAL_MS
        : PAIRING_STATUS_INTERVAL_MS,
    )
    return () => {
      disposed = true
      window.clearInterval(intervalId)
    }
  }, [phase, refreshStatus])

  const start = useCallback(async () => {
    const display = displayState
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
    clearLocalState()
    setMessage('接続を準備しています…')
    setPhase('checking')
    try {
      const issued = await supabasePresenterBridgeRepository.issue({
        adminToken,
        lectureSessionId: activeLectureSessionId,
      })
      if (epoch !== epochRef.current) return
      connectionIdRef.current = issued.connectionId
      pairingTicketExpiresAtRef.current = issued.pairingTicketExpiresAt
      setManualCode(issued.manualCode)

      try {
        await presenterBridgeClient.health()
        const connected = await presenterBridgeClient.connect({
          lectureSessionId: activeLectureSessionId,
          pdfDocumentId: issued.pdf.documentId,
          pdfDocumentVersion: issued.pdf.documentVersion,
          pdfPageCount: issued.pdf.pageCount,
          ticket: issued.pairingTicket,
        })
        if (epoch !== epochRef.current) return
        localSessionRef.current = connected.sessionToken
        setPresentation(connected.presentation)
        setPhase('review')
        setMessage(
          connected.presentation.eligible
            ? 'PowerPointと講義資料を確認してください。'
            : 'このPowerPointは現在の講義資料と同期できません。',
        )
      } catch (bridgeError) {
        if (epoch !== epochRef.current) return
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
    }
  }, [
    activeLectureSessionId,
    adminToken,
    clearLocalState,
    displayState,
    enabled,
    lectureStatus,
  ])

  const confirm = useCallback(async () => {
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
      setMessage(
        'Presenter Bridgeを安全に手動復旧へ切り替えています…',
      )
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
      teacherConfirmedRef.current = true
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

  const stop = useCallback(async () => {
    const connectionId = connectionIdRef.current
    if (!connectionId) {
      clearLocalState()
      setPhase('idle')
      return
    }
    setMessage('手動操作へ切り替えています…')
    try {
      await supabasePresenterBridgeRepository.revoke({
        adminToken,
        connectionId,
      })
      const localSession = localSessionRef.current
      if (localSession) {
        await presenterBridgeClient
          .disconnect(localSession)
          .catch(() => undefined)
      }
      epochRef.current += 1
      clearLocalState()
      setMessage('手動操作へ切り替えました。')
      setPhase('idle')
    } catch {
      setMessage(
        '同期を停止できませんでした。状態を維持しているため、もう一度お試しください。',
      )
    }
  }, [adminToken, clearLocalState])

  const manualNavigationLocked =
    serverConnection?.state === 'active' && serverConnection.revokedAt === null

  return {
    confirm,
    manualCode,
    manualRecoveryRequired,
    manualNavigationLocked,
    message,
    phase,
    presentation,
    serverConnection,
    start,
    stop,
  }
}
