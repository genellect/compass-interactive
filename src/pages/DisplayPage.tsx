import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router'
import { DisplayView } from '../components/DisplayView'
import { useCompassState } from '../hooks/useCompassState'
import {
  createCaptionBroadcastChannel,
  isCaptionBroadcastMessage,
} from '../caption/captionBroadcast'
import type { CaptionContent } from '../components/LearningSupport'
import { isPhase728DisplayRealtimeEnabled } from '../lib/featureFlags'
import {
  canFallbackFromDisplayRealtimeClaim,
  claimDisplayRealtimeSession,
  createDisplaySessionReporter,
  subscribeClaimedDisplayRealtimeSession,
  type ClaimedDisplayRealtimeSession,
} from '../display/displayRealtime'
import {
  clearStoredDisplayLaunch,
  persistClaimedDisplayLaunch,
  readDisplayLaunch,
  stripDisplayLaunchFragment,
} from '../display/displaySessionStorage'
import {
  getDisplayPdfRenderKey,
  subscribeDisplayPdfRendered,
} from '../display/displayRenderEvents'
import { getLatestPublicSummary } from '../display/displaySummary'

export function DisplayPage() {
  const {
    activeLectureSessionId,
    caption,
    commentsError,
    commentsLoading,
    displayState,
    displayStateError,
    hasJoinedLectureSession,
    lecture,
    openPolls,
    pollResults,
    pollResultsError,
    pollsError,
    pollsLoading,
    refreshDisplayState,
    runtimeMode,
    selectLectureSession,
    setOperatorLiveAccess,
    isSessionSyncPaused,
    sessionSyncMessage,
    summaries,
    visibleCommentCount,
    visibleComments,
  } = useCompassState()
  const [displayAccessError, setDisplayAccessError] = useState<string | null>(
    null,
  )
  const [displayLaunch] = useState(readDisplayLaunch)
  const operatorCleanupTimerRef = useRef<number | null>(null)
  const refreshDisplayStateRef = useRef(refreshDisplayState)
  refreshDisplayStateRef.current = refreshDisplayState
  const displayStateRef = useRef(displayState)
  displayStateRef.current = displayState
  const lastPdfRenderKeyRef = useRef<string | null>(null)
  const displayClaimRef = useRef<Promise<ClaimedDisplayRealtimeSession> | null>(
    null,
  )
  const [displayRealtimeSession, setDisplayRealtimeSession] =
    useState<ClaimedDisplayRealtimeSession | null>(null)
  const [displayRealtimeSubscribed, setDisplayRealtimeSubscribed] =
    useState(false)
  const displayReporterRef = useRef<ReturnType<
    typeof createDisplaySessionReporter
  > | null>(null)
  const [localCaption, setLocalCaption] = useState<{
    content: CaptionContent
    updatedAt: number
  } | null>(null)
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    let disposed = false
    const { displayToken, lectureSessionId } = displayLaunch
    const hasDisplayLaunch =
      displayToken.length > 0 || lectureSessionId.length > 0
    const hasValidDisplayLaunch =
      displayToken.length >= 80 &&
      displayToken.length <= 4096 &&
      /^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(lectureSessionId)
    const hasJoinedMemberAccess =
      !hasDisplayLaunch &&
      runtimeMode === 'live' &&
      hasJoinedLectureSession &&
      Boolean(activeLectureSessionId)
    if (operatorCleanupTimerRef.current !== null) {
      window.clearTimeout(operatorCleanupTimerRef.current)
      operatorCleanupTimerRef.current = null
    }
    if (hasJoinedMemberAccess) {
      displayClaimRef.current = null
      setDisplayRealtimeSession(null)
      setOperatorLiveAccess(null)
      setDisplayAccessError(null)
      return
    }

    if (!hasValidDisplayLaunch) {
      displayClaimRef.current = null
      setDisplayRealtimeSession(null)
      setOperatorLiveAccess(null)
      setDisplayAccessError(
        '管理画面から「画面共有を開始する」を押して、もう一度開いてください。',
      )
      return
    }

    setDisplayAccessError(null)
    const activate = async () => {
      let realtimeSession: ClaimedDisplayRealtimeSession | null = null
      if (isPhase728DisplayRealtimeEnabled) {
        displayClaimRef.current ??= claimDisplayRealtimeSession({
          displayToken,
          lectureSessionId,
        })
        try {
          const claimedSession = await displayClaimRef.current
          const persisted = persistClaimedDisplayLaunch({
            displayToken,
            lectureCode: displayLaunch.lectureCode,
            lectureSessionId,
            realtime: claimedSession,
          })
          realtimeSession = {
            ...claimedSession,
            connectionGeneration: persisted.connectionGeneration,
          }
          if (displayLaunch.source === 'fragment') {
            stripDisplayLaunchFragment()
          }
        } catch (error) {
          if (canFallbackFromDisplayRealtimeClaim(error)) {
            realtimeSession = null
            displayClaimRef.current = null
          } else {
            if (!disposed) {
              clearStoredDisplayLaunch()
              setOperatorLiveAccess(null)
              setDisplayRealtimeSession(null)
              setDisplayAccessError(
                error instanceof Error
                  ? `共有画面を認証できませんでした: ${error.message}`
                  : '共有画面を認証できませんでした。',
              )
            }
            return
          }
        }
      }
      if (disposed) return
      setDisplayRealtimeSession(realtimeSession)
      setOperatorLiveAccess({ kind: 'display', token: displayToken })
      if (activeLectureSessionId !== lectureSessionId) {
        selectLectureSession({
          id: lectureSessionId,
          runtimeMode: 'live',
          status: 'open',
          title: '講義共有画面',
        })
      }
    }
    void activate()
    return () => {
      disposed = true
      operatorCleanupTimerRef.current = window.setTimeout(() => {
        setOperatorLiveAccess(null)
        operatorCleanupTimerRef.current = null
      }, 0)
    }
  }, [
    activeLectureSessionId,
    displayLaunch,
    hasJoinedLectureSession,
    runtimeMode,
    selectLectureSession,
    setOperatorLiveAccess,
  ])

  useEffect(() => {
    if (!displayRealtimeSession || !displayLaunch.displayToken) return
    const reporter = createDisplaySessionReporter({
      displayToken: displayLaunch.displayToken,
      onStatus: (status, error) => {
        document.documentElement.dataset.displayDelivery = status
        if (error) {
          document.documentElement.dataset.displayDeliveryError = error.message
        } else {
          delete document.documentElement.dataset.displayDeliveryError
        }
      },
      session: displayRealtimeSession,
    })
    displayReporterRef.current = reporter
    return () => {
      reporter.close()
      if (displayReporterRef.current === reporter) {
        displayReporterRef.current = null
      }
      delete document.documentElement.dataset.displayDelivery
      delete document.documentElement.dataset.displayDeliveryError
    }
  }, [displayLaunch.displayToken, displayRealtimeSession])

  const reportRenderedDisplayState = useCallback(
    (rendered: { displayUpdatedAt: string; renderedPage: number }) => {
      if (!displayRealtimeSubscribed) return
      displayReporterRef.current?.reportRendered(rendered)
    },
    [displayRealtimeSubscribed],
  )

  useEffect(() => {
    lastPdfRenderKeyRef.current = null
    if (!displayRealtimeSession || !displayRealtimeSubscribed) return
    return subscribeDisplayPdfRendered((rendered) => {
      const current = displayStateRef.current
      if (
        !current ||
        current.lectureSessionId !== displayRealtimeSession.lectureSessionId ||
        rendered.lectureSessionId !== displayRealtimeSession.lectureSessionId ||
        rendered.documentId !== current.pdfDocumentId ||
        rendered.documentVersion !== current.pdfDocumentVersion ||
        rendered.manifestVersion !== current.pdfManifestVersion ||
        rendered.page !== current.currentPdfPage
      ) {
        return
      }
      lastPdfRenderKeyRef.current = getDisplayPdfRenderKey(rendered)
      reportRenderedDisplayState({
        displayUpdatedAt: current.updatedAt,
        renderedPage: current.currentPdfPage,
      })
    })
  }, [
    displayRealtimeSession,
    displayRealtimeSubscribed,
    reportRenderedDisplayState,
  ])

  useEffect(() => {
    if (
      !displayRealtimeSession ||
      !displayRealtimeSubscribed ||
      !displayState ||
      displayState.lectureSessionId !== displayRealtimeSession.lectureSessionId
    ) {
      return
    }
    if (displayState.pdfVisible && displayState.pdfDocumentId) {
      if (
        !displayState.pdfDocumentVersion ||
        displayState.pdfManifestVersion < 1
      ) {
        return
      }
      const expectedRenderKey = getDisplayPdfRenderKey({
        documentId: displayState.pdfDocumentId,
        documentVersion: displayState.pdfDocumentVersion,
        lectureSessionId: displayRealtimeSession.lectureSessionId,
        manifestVersion: displayState.pdfManifestVersion,
        page: displayState.currentPdfPage,
      })
      if (lastPdfRenderKeyRef.current !== expectedRenderKey) return
    }
    const frame = window.requestAnimationFrame(() => {
      reportRenderedDisplayState({
        displayUpdatedAt: displayState.updatedAt,
        renderedPage: displayState.currentPdfPage,
      })
    })
    return () => window.cancelAnimationFrame(frame)
  }, [
    displayRealtimeSession,
    displayRealtimeSubscribed,
    displayState,
    reportRenderedDisplayState,
  ])

  useEffect(() => {
    setDisplayRealtimeSubscribed(false)
    if (!displayRealtimeSession) return
    document.documentElement.dataset.displayRealtime = 'connecting'
    let close: (() => Promise<void>) | null = null
    let disposed = false
    let displayRefreshTimer: number | null = null
    const scheduleDisplayRefresh = () => {
      if (disposed || displayRefreshTimer !== null) return
      displayRefreshTimer = window.setTimeout(() => {
        displayRefreshTimer = null
        void refreshDisplayStateRef.current().catch(() => undefined)
      }, 25)
    }

    void subscribeClaimedDisplayRealtimeSession({
      onCaption: (message) => {
        if (disposed) return
        setLocalCaption(
          message.caption
            ? { content: message.caption, updatedAt: message.timestamp }
            : null,
        )
      },
      onConnectionStatus: (status, error) => {
        setDisplayRealtimeSubscribed(status === 'SUBSCRIBED')
        document.documentElement.dataset.displayRealtimeStatus = status
        document.documentElement.dataset.displayRealtime =
          status === 'SUBSCRIBED' ? 'connected' : 'fallback'
        if (error) {
          document.documentElement.dataset.displayRealtimeStatusError =
            error.message
        } else {
          delete document.documentElement.dataset.displayRealtimeStatusError
        }
      },
      onDisplayState: scheduleDisplayRefresh,
      onLiveStateChanged: scheduleDisplayRefresh,
      onSessionClosed: (reason) => {
        if (disposed) return
        setDisplayRealtimeSubscribed(false)
        setLocalCaption(null)
        if (reason === 'feature_disabled') {
          // The DB kill switch revokes Realtime admission but preserves the
          // same claimed UID's signed five-second snapshot/PDF fallback.
          setDisplayRealtimeSession(null)
          scheduleDisplayRefresh()
          return
        }
        clearStoredDisplayLaunch()
        setDisplayRealtimeSession(null)
        setOperatorLiveAccess(null)
        if (
          reason === 'admin_session_revoked' ||
          reason === 'session_replaced'
        ) {
          setDisplayAccessError(
            reason === 'session_replaced'
              ? '新しい共有画面が開かれたため、この画面を終了しました。'
              : '教員の共有画面セッションが終了しました。',
          )
          return
        }
        setDisplayAccessError(
          'この共有画面セッションは終了しました。管理画面の「画面共有を開始する」から新しいリンクを開いてください。',
        )
      },
      session: displayRealtimeSession,
    })
      .then((closeSubscription) => {
        if (disposed) {
          void closeSubscription()
          return
        }
        close = closeSubscription
      })
      .catch((error) => {
        // Claim succeeded, so the operator snapshot remains the safe
        // five-second fallback if Realtime itself is temporarily unavailable.
        document.documentElement.dataset.displayRealtime = 'fallback'
        setDisplayRealtimeSubscribed(false)
        document.documentElement.dataset.displayRealtimeError =
          error instanceof Error ? error.message : 'unknown'
      })

    return () => {
      disposed = true
      if (displayRefreshTimer !== null) {
        window.clearTimeout(displayRefreshTimer)
      }
      if (close) void close()
      delete document.documentElement.dataset.displayRealtime
      delete document.documentElement.dataset.displayRealtimeError
      delete document.documentElement.dataset.displayRealtimeStatus
      delete document.documentElement.dataset.displayRealtimeStatusError
    }
  }, [displayRealtimeSession, setOperatorLiveAccess])

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 5_000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    if (
      !displayLaunch.displayToken ||
      (!displayStateError?.includes('Invalid Display session.') &&
        !displayStateError?.includes('Display session has ended.'))
    ) {
      return
    }
    setDisplayRealtimeSession(null)
    clearStoredDisplayLaunch()
    setOperatorLiveAccess(null)
    setDisplayAccessError(
      'この共有画面セッションは終了しました。管理画面の「画面共有を開始する」から新しいリンクを開いてください。',
    )
  }, [displayLaunch.displayToken, displayStateError, setOperatorLiveAccess])

  useEffect(() => {
    setLocalCaption(null)
    // A claimed private Realtime session supersedes the legacy same-browser
    // BroadcastChannel. Keeping both alive could let a replaced Display tab
    // render a later local caption after its server binding was revoked.
    if (displayRealtimeSession) return
    if (!activeLectureSessionId) return
    const channel = createCaptionBroadcastChannel(activeLectureSessionId)
    if (!channel) return
    channel.addEventListener('message', (event) => {
      if (isCaptionBroadcastMessage(event.data, activeLectureSessionId)) {
        setLocalCaption(
          event.data.caption
            ? {
                content: event.data.caption,
                updatedAt: event.data.timestamp,
              }
            : null,
        )
      }
    })
    return () => channel.close()
  }, [activeLectureSessionId, displayRealtimeSession])

  const captionUpdatedAt = caption ? Date.parse(caption.updatedAt) : Number.NaN
  const publicCaption =
    caption &&
    Number.isFinite(captionUpdatedAt) &&
    now - captionUpdatedAt <= 15_000
      ? { text: caption.text }
      : null
  const freshLocalCaption =
    localCaption && now - localCaption.updatedAt <= 15_000
      ? localCaption.content
      : null
  const latestSummary = getLatestPublicSummary(summaries)

  if (displayAccessError) {
    return (
      <main className="page-shell display-layout">
        <section className="panel quiet-state">
          <p className="eyebrow">CLASSROOM DISPLAY</p>
          <h1>共有画面の確認が必要です</h1>
          <p>{displayAccessError}</p>
          <Link className="text-link-button" to="/demo/display">
            英語講義の共有Displayを体験
          </Link>
        </section>
      </main>
    )
  }

  return (
    <DisplayView
      activeLectureSessionId={activeLectureSessionId}
      caption={freshLocalCaption ?? publicCaption}
      comments={visibleComments}
      commentsError={commentsError}
      commentsLoading={commentsLoading}
      displayState={displayState}
      displayStateError={displayStateError}
      displayToken={displayLaunch.displayToken}
      hasJoinedLectureSession={hasJoinedLectureSession}
      isSessionSyncPaused={isSessionSyncPaused}
      lecture={lecture}
      lectureCode={
        /^[0-9]{6}$/.test(displayLaunch.lectureCode)
          ? displayLaunch.lectureCode
          : ''
      }
      pollResults={pollResults}
      pollResultsError={pollResultsError}
      polls={openPolls}
      pollsError={pollsError}
      pollsLoading={pollsLoading}
      runtimeMode={runtimeMode}
      sessionSyncMessage={sessionSyncMessage}
      summary={latestSummary}
      visibleCommentCount={visibleCommentCount}
    />
  )
}
