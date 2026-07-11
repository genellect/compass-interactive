import { DisplayView } from '../components/DisplayView'
import { useCompassState } from '../hooks/useCompassState'

export function DisplayPage() {
  const {
    activeLectureSessionId,
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
    isSessionSyncPaused,
    sessionSyncMessage,
    visibleComments,
  } = useCompassState()

  return (
    <DisplayView
      activeLectureSessionId={activeLectureSessionId}
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
      sessionSyncMessage={sessionSyncMessage}
    />
  )
}
