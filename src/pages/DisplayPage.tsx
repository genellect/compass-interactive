import { useEffect } from 'react'
import { useState } from 'react'
import { DisplayView } from '../components/DisplayView'
import { useCompassState } from '../hooks/useCompassState'
import {
  createDefaultDisplayState,
  type DisplayState,
  supabaseDisplayStateRepository,
} from '../repositories/supabaseDisplayStateRepository'

const DISPLAY_POLL_REFRESH_MS = 15_000

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
    realtimeCommentLikesStatus,
    realtimeCommentsStatus,
    realtimePollResultsStatus,
    refreshPollResults,
    visibleComments,
  } = useCompassState()
  const [displayState, setDisplayState] = useState<DisplayState | null>(null)
  const [displayStateError, setDisplayStateError] = useState<string | null>(null)

  useEffect(() => {
    if (!activeLectureSessionId) {
      return
    }

    void refreshPollResults()
    const intervalId = window.setInterval(() => {
      void refreshPollResults()
    }, DISPLAY_POLL_REFRESH_MS)

    return () => window.clearInterval(intervalId)
  }, [activeLectureSessionId, refreshPollResults])

  useEffect(() => {
    if (!activeLectureSessionId) {
      setDisplayState(null)
      setDisplayStateError(null)
      return
    }

    setDisplayState(createDefaultDisplayState(activeLectureSessionId))

    async function loadDisplayState() {
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
            ? `Display state fetch failed: ${error.message}`
            : 'Display state fetch failed.',
        )
      }
    }

    void loadDisplayState()

    return supabaseDisplayStateRepository.subscribeDisplayState({
      lectureSessionId: activeLectureSessionId,
      onStateChange: (nextDisplayState) => {
        setDisplayState(nextDisplayState)
        setDisplayStateError(null)
      },
    })
  }, [activeLectureSessionId])

  return (
    <DisplayView
      activeLectureSessionId={activeLectureSessionId}
      comments={visibleComments}
      commentsError={commentsError}
      commentsLoading={commentsLoading}
      displayState={displayState}
      displayStateError={displayStateError}
      hasJoinedLectureSession={hasJoinedLectureSession}
      lecture={lecture}
      pollResults={pollResults}
      pollResultsError={pollResultsError}
      polls={openPolls}
      pollsError={pollsError}
      pollsLoading={pollsLoading}
      realtimeCommentLikesStatus={realtimeCommentLikesStatus}
      realtimeCommentsStatus={realtimeCommentsStatus}
      realtimePollResultsStatus={realtimePollResultsStatus}
    />
  )
}
