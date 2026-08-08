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
import type { PresenterPresentation } from '../../presenter/presenterBridgeProtocol'

export type PowerPointSyncPhase =
  'active' | 'checking' | 'error' | 'idle' | 'review'

type UseAdminPowerPointSyncInput = {
  activeLectureSessionId: string | null
  adminToken: string
  displayState: DisplayState | null
  enabled: boolean
  lectureStatus: string
  onCommittedPage: () => void
}

const STATUS_INTERVAL_MS = 5_000

function friendlyBridgeError(error: unknown) {
  const code = (error as PresenterBridgeClientError | undefined)?.code
  if (code === 'bridge_unavailable' || code === 'request_timeout') {
    return 'Presenter Bridgeを起動して、もう一度お試しください。'
  }
  if (code === 'presentation_changed') {
    return 'PowerPointが変更されたため同期を停止しました。もう一度接続してください。'
  }
  return error instanceof Error
    ? error.message
    : 'PowerPointを確認できませんでした。'
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
  const [presentation, setPresentation] =
    useState<PresenterPresentation | null>(null)
  const [serverConnection, setServerConnection] =
    useState<PresenterConnectionStatus | null>(null)
  const connectionIdRef = useRef<string | null>(null)
  const localSessionRef = useRef<string | null>(null)
  const epochRef = useRef(0)
  const lastCommittedPageRef = useRef<number | null>(null)

  const clearLocalState = useCallback(() => {
    connectionIdRef.current = null
    localSessionRef.current = null
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
    const connection = result.connection
    setServerConnection(connection)
    if (
      !result.runtimeEnabled ||
      !connection ||
      connection.state === 'revoked'
    ) {
      setPhase('error')
      setMessage('PowerPoint同期は停止しました。手動操作を利用できます。')
      return
    }
    if (
      connection.state === 'active' &&
      connection.lastCommittedPdfPage !== null &&
      connection.lastCommittedPdfPage !== lastCommittedPageRef.current
    ) {
      lastCommittedPageRef.current = connection.lastCommittedPdfPage
      onCommittedPage()
    }
  }, [activeLectureSessionId, adminToken, enabled, onCommittedPage])

  useEffect(() => {
    if (phase !== 'active') return
    let disposed = false
    const check = async () => {
      try {
        await refreshStatus()
        const localSession = localSessionRef.current
        if (!disposed && localSession) {
          const localStatus =
            await presenterBridgeClient.getStatus(localSession)
          if (!disposed && localStatus.state === 'faulted') {
            setMessage(
              'PowerPointを確認できなくなりました。手動操作へ切り替えることができます。',
            )
          }
        }
      } catch {
        if (!disposed) {
          setMessage(
            '同期状態を確認できません。接続は維持し、手動切替を利用できます。',
          )
        }
      }
    }
    void check()
    const intervalId = window.setInterval(
      () => void check(),
      STATUS_INTERVAL_MS,
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
    setMessage('')
    setPhase('checking')
    try {
      await presenterBridgeClient.health()
      const issued = await supabasePresenterBridgeRepository.issue({
        adminToken,
        lectureSessionId: activeLectureSessionId,
      })
      if (epoch !== epochRef.current) return
      connectionIdRef.current = issued.connectionId
      setManualCode(issued.manualCode)
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
    const localSession = localSessionRef.current
    if (!connectionId || !localSession || !presentation?.eligible) return
    const epoch = epochRef.current
    setMessage('同期を開始しています…')
    try {
      await supabasePresenterBridgeRepository.confirm({
        adminToken,
        connectionId,
      })
      const active = await presenterBridgeClient.activate(
        localSession,
        presentation.bindingDigest,
      )
      if (epoch !== epochRef.current) return
      setPresentation(active.presentation)
      setPhase('active')
      setMessage('')
      await refreshStatus()
    } catch (error) {
      if (epoch !== epochRef.current) return
      setPhase('review')
      setMessage(friendlyBridgeError(error))
    }
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
      setMessage('手動操作に切り替えました。')
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
    manualNavigationLocked,
    message,
    phase,
    presentation,
    serverConnection,
    start,
    stop,
  }
}
