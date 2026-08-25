import { useEffect, useState } from 'react'
import { DisplayView } from '../components/DisplayView'
import { demoRepository } from '../demo/demoRepository'
import { DEMO_LECTURE_CODE, demoDisplaySummary } from '../demo/demoSeedData'

export function DemoDisplayPage() {
  const [snapshot, setSnapshot] = useState(() => demoRepository.getSnapshot())

  useEffect(() => {
    const refresh = () => setSnapshot(demoRepository.getSnapshot())
    const unsubscribe = demoRepository.subscribe(refresh)
    const ambientCommentTimer = window.setInterval(() => {
      setSnapshot(demoRepository.addNextAmbientComment())
    }, 10_000)

    return () => {
      unsubscribe()
      window.clearInterval(ambientCommentTimer)
    }
  }, [])

  const visibleComments = snapshot.comments.filter(
    (comment) => comment.status === 'visible',
  )
  const openPolls = snapshot.polls.filter((poll) => poll.status === 'open')

  return (
    <DisplayView
      activeLectureSessionId={snapshot.session.id}
      caption={null}
      comments={visibleComments}
      commentsError={null}
      commentsLoading={false}
      displayState={snapshot.displayState}
      displayStateError={null}
      hasJoinedLectureSession
      isSessionSyncPaused={false}
      lecture={snapshot.lecture}
      lectureCode={DEMO_LECTURE_CODE}
      pollResults={snapshot.pollResults}
      pollResultsError={null}
      polls={openPolls}
      pollsError={null}
      pollsLoading={false}
      runtimeMode="demo"
      sessionSyncMessage={null}
      summary={demoDisplaySummary}
      visibleCommentCount={visibleComments.length}
    />
  )
}
