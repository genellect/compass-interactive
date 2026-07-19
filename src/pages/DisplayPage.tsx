import { useEffect, useRef, useState } from 'react'
import { DisplayView } from '../components/DisplayView'
import { useCompassState } from '../hooks/useCompassState'
import {
  createCaptionBroadcastChannel,
  isCaptionBroadcastMessage,
} from '../caption/captionBroadcast'
import type { CaptionContent } from '../components/LearningSupport'

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
  const [localCaption, setLocalCaption] = useState<{
    content: CaptionContent
    updatedAt: number
  } | null>(null)
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const { displayToken, lectureSessionId } = displayLaunch
    if (operatorCleanupTimerRef.current !== null) {
      window.clearTimeout(operatorCleanupTimerRef.current)
      operatorCleanupTimerRef.current = null
    }
    window.history.replaceState(
      null,
      '',
      `${window.location.pathname}${window.location.search}`,
    )

    if (
      displayToken.length < 80 ||
      displayToken.length > 4096 ||
      !/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(lectureSessionId)
    ) {
      setOperatorLiveAccess(null)
      setDisplayAccessError(
        '管理画面から「共有画面を開く」を押して、もう一度開いてください。',
      )
      return
    }

    setDisplayAccessError(null)
    setOperatorLiveAccess({ kind: 'display', token: displayToken })
    selectLectureSession({
      id: lectureSessionId,
      runtimeMode: 'live',
      status: 'open',
      title: '講義共有画面',
    })
    return () => {
      operatorCleanupTimerRef.current = window.setTimeout(() => {
        setOperatorLiveAccess(null)
        operatorCleanupTimerRef.current = null
      }, 0)
    }
  }, [displayLaunch, selectLectureSession, setOperatorLiveAccess])

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 5_000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    setLocalCaption(null)
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
  }, [activeLectureSessionId])

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
