import { useEffect, useState } from 'react'
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
    pollResults,
    pollResultsError,
    pollsError,
    pollsLoading,
    runtimeMode,
    isSessionSyncPaused,
    sessionSyncMessage,
    visibleComments,
  } = useCompassState()
  const [localCaption, setLocalCaption] = useState<CaptionContent | null>(null)

  useEffect(() => {
    setLocalCaption(null)
    if (!activeLectureSessionId) return
    const channel = createCaptionBroadcastChannel(activeLectureSessionId)
    if (!channel) return
    channel.addEventListener('message', (event) => {
      if (isCaptionBroadcastMessage(event.data, activeLectureSessionId)) {
        setLocalCaption(event.data.caption)
      }
    })
    return () => channel.close()
  }, [activeLectureSessionId])

  return (
    <DisplayView
      activeLectureSessionId={activeLectureSessionId}
      caption={localCaption ?? (caption ? { text: caption.text } : null)}
      comments={visibleComments}
      commentsError={commentsError}
      commentsLoading={commentsLoading}
      displayState={displayState}
      displayStateError={displayStateError}
      hasJoinedLectureSession={hasJoinedLectureSession}
      isSessionSyncPaused={isSessionSyncPaused}
      lecture={lecture}
      pollResults={pollResults}
      pollResultsError={pollResultsError}
      polls={openPolls}
      pollsError={pollsError}
      pollsLoading={pollsLoading}
      runtimeMode={runtimeMode}
      sessionSyncMessage={sessionSyncMessage}
    />
  )
}
