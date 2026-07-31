import { useEffect, useRef, useState } from 'react'
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
  subscribeClaimedDisplayRealtimeSession,
  type ClaimedDisplayRealtimeSession,
} from '../display/displayRealtime'

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
    participantCount,
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
    visibleCommentCount,
    visibleComments,
  } = useCompassState()
  const [displayAccessError, setDisplayAccessError] = useState<string | null>(
    null,
  )
  const [displayLaunch] = useState(() => {
    const fragment = new URLSearchParams(window.location.hash.slice(1))
    return {
      displayToken: fragment.get('token') ?? '',
      lectureCode: fragment.get('code') ?? '',
      lectureSessionId: fragment.get('lecture') ?? '',
    }
  })
  const operatorCleanupTimerRef = useRef<number | null>(null)
  const refreshDisplayStateRef = useRef(refreshDisplayState)
  refreshDisplayStateRef.current = refreshDisplayState
  const displayClaimRef = useRef<Promise<ClaimedDisplayRealtimeSession> | null>(
    null,
  )
  const [displayRealtimeSession, setDisplayRealtimeSession] =
    useState<ClaimedDisplayRealtimeSession | null>(null)
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
    window.history.replaceState(
      null,
      '',
      `${window.location.pathname}${window.location.search}`,
    )

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
        '管理画面から「共有画面を開く」を押して、もう一度開いてください。',
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
          realtimeSession = await displayClaimRef.current
        } catch (error) {
          if (canFallbackFromDisplayRealtimeClaim(error)) {
            realtimeSession = null
            displayClaimRef.current = null
          } else {
            if (!disposed) {
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
    if (!displayRealtimeSession) return
    document.documentElement.dataset.displayRealtime = 'connecting'
    let close: (() => Promise<void>) | null = null
    let disposed = false
    let displayRefreshTimer: number | null = null

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
        document.documentElement.dataset.displayRealtimeStatus = status
        if (error) {
          document.documentElement.dataset.displayRealtimeStatusError =
            error.message
        }
      },
      onDisplayState: () => {
        if (disposed || displayRefreshTimer !== null) return
        displayRefreshTimer = window.setTimeout(() => {
          displayRefreshTimer = null
          void refreshDisplayStateRef.current().catch(() => undefined)
        }, 25)
      },
      onSessionClosed: (reason) => {
        if (disposed) return
        setLocalCaption(null)
        if (
          reason === 'admin_session_revoked' ||
          reason === 'session_replaced'
        ) {
          setOperatorLiveAccess(null)
          setDisplayAccessError(
            reason === 'session_replaced'
              ? '新しい共有画面が開かれたため、この画面を終了しました。'
              : '教員の共有画面セッションが終了しました。',
          )
          return
        }
        if (reason === 'feature_disabled') {
          // The DB kill switch revokes Realtime admission but preserves the
          // same claimed UID's signed five-second snapshot/PDF fallback.
          setDisplayRealtimeSession(null)
        }
        void refreshDisplayStateRef.current().catch(() => undefined)
      },
      session: displayRealtimeSession,
    })
      .then((closeSubscription) => {
        if (disposed) {
          void closeSubscription()
          return
        }
        close = closeSubscription
        document.documentElement.dataset.displayRealtime = 'connected'
      })
      .catch((error) => {
        // Claim succeeded, so the operator snapshot remains the safe
        // five-second fallback if Realtime itself is temporarily unavailable.
        document.documentElement.dataset.displayRealtime = 'fallback'
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
    setOperatorLiveAccess(null)
    setDisplayAccessError(
      'この共有画面セッションは終了しました。管理画面から新しいリンクを開いてください。',
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

  if (displayAccessError) {
    return (
      <main className="page-shell display-layout">
        <section className="panel quiet-state">
          <p className="eyebrow">CLASSROOM DISPLAY</p>
          <h1>共有画面の確認が必要です</h1>
          <p>{displayAccessError}</p>
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
      participantCount={participantCount}
      pollResults={pollResults}
      pollResultsError={pollResultsError}
      polls={openPolls}
      pollsError={pollsError}
      pollsLoading={pollsLoading}
      runtimeMode={runtimeMode}
      sessionSyncMessage={sessionSyncMessage}
      visibleCommentCount={visibleCommentCount}
    />
  )
}
