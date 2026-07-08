import { useCallback, useEffect, useState } from 'react'
import { DisplayView } from '../components/DisplayView'
import { useAdaptiveLiveSync } from '../hooks/useAdaptiveLiveSync'
import { useCompassState } from '../hooks/useCompassState'
import {
  createDefaultDisplayState,
  type DisplayState,
  supabaseDisplayStateRepository,
} from '../repositories/supabaseDisplayStateRepository'

export function DisplayPage() {
  const {
    activeLectureSessionId,
    commentsError,
    commentsLoading,
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
  const [displayState, setDisplayState] = useState<DisplayState | null>(null)
  const [displayStateError, setDisplayStateError] = useState<string | null>(null)

  const loadDisplayState = useCallback(async () => {
    if (!activeLectureSessionId) {
      return
    }

    try {
      const remoteDisplayState =
        await supabaseDisplayStateRepository.getDisplayState(
          activeLectureSessionId,
        )
      setDisplayState(remoteDisplayState)
      setDisplayStateError(null)
    } catch (error) {
      setDisplayStateError(
        error instanceof Error
          ? `表示画面の状態取得に失敗しました: ${error.message}`
          : '表示画面の状態取得に失敗しました。',
      )
    }
  }, [activeLectureSessionId])

  useEffect(() => {
    if (!activeLectureSessionId) {
      setDisplayState(null)
      setDisplayStateError(null)
      return
    }

    setDisplayState(createDefaultDisplayState(activeLectureSessionId))
  }, [activeLectureSessionId])

  useAdaptiveLiveSync({
    enabled: Boolean(
      activeLectureSessionId &&
        lecture.status === 'open' &&
        !isSessionSyncPaused,
    ),
    onSync: loadDisplayState,
  })

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
