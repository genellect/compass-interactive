import { useEffect, useState } from 'react'
import { CommentInput, LiveBoard } from '../components/LiveBoard'
import { LivePoll } from '../components/LivePoll'
import { SyncedPdfViewer } from '../components/DisplayView'
import { AppIcon } from '../components/AppIcon'
import {
  FiveMinuteRecapPanel,
  LiveCaptionPanel,
  MaterialSummaryPanel,
} from '../components/LearningSupport'
import { useCompassState } from '../hooks/useCompassState'

export function LecturePage() {
  const {
    addComment,
    activeLectureSessionId,
    currentParticipantId,
    commentLikesError,
    commentsError,
    commentsLoading,
    displayState,
    displayStateError,
    hasJoinedLectureSession,
    hasOlderComments,
    isLoadingOlderComments,
    isSubmittingComment,
    isSessionSyncPaused,
    lecture,
    loadOlderComments,
    openPolls,
    participants,
    pollResults,
    pollResponses,
    pollResultsError,
    pollsError,
    pollsLoading,
    resumeSessionSync,
    resetDemoLecture,
    runtimeMode,
    sessionSyncMessage,
    sessionSyncPauseReason,
    submitPollResponse,
    toggleCommentLike,
    visibleComments,
  } = useCompassState()
  const isJoined = Boolean(
    hasJoinedLectureSession && currentParticipantId && activeLectureSessionId,
  )
  const [demoParticipantCount, setDemoParticipantCount] = useState(
    lecture.expectedParticipants,
  )

  useEffect(() => {
    setDemoParticipantCount(lecture.expectedParticipants)
    if (runtimeMode !== 'demo') {
      return
    }

    const changes = [1, 2, -1, 1, 1, -2, 2]
    let changeIndex = 0
    const timer = window.setInterval(() => {
      setDemoParticipantCount((current) => {
        const next = current + changes[changeIndex]
        changeIndex = (changeIndex + 1) % changes.length
        return Math.min(224, Math.max(216, next))
      })
    }, 2600)

    return () => window.clearInterval(timer)
  }, [lecture.expectedParticipants, runtimeMode])

  return (
    <main className="page-shell lecture-page">
      <section className="lecture-hero">
        <div className="lecture-title-group">
          <div className="lecture-live-row">
            <span className="live-badge">
              <i /> LIVE
            </span>
            <span className="lecture-mode-label">
              {runtimeMode === 'demo' ? '体験版' : '講義に参加中'}
            </span>
          </div>
          <h1>{lecture.title}</h1>
          <p>気づいたことを残すたび、みんなの学びが少しずつ動き出します。</p>
        </div>
        <div className="lecture-metrics" aria-label="講義の現在状況">
          <span>
            <AppIcon name="users" size={18} />
            <strong
              className={
                runtimeMode === 'demo' ? 'participant-number' : undefined
              }
              key={runtimeMode === 'demo' ? demoParticipantCount : undefined}
            >
              {runtimeMode === 'demo'
                ? demoParticipantCount
                : participants.length}
            </strong>
            人参加
          </span>
          <span>
            <AppIcon name="poll" size={18} />
            <strong>{openPolls.length}</strong>
            件受付中
          </span>
          <span>
            <AppIcon name="message" size={18} />
            <strong>{visibleComments.length}</strong>
            件の声
          </span>
        </div>
      </section>

      {runtimeMode === 'demo' ? (
        <section className="demo-journey" aria-label="デモ講義の体験ガイド">
          <div className="demo-journey-copy">
            <span className="support-icon">
              <AppIcon name="sparkles" size={18} />
            </span>
            <p>
              <strong>本番に近い講義体験です</strong>
              <span>
                資料をめくり、投票し、あなたの気づきを残してみてください。
              </span>
            </p>
          </div>
          <ol className="demo-steps">
            <li>
              <span>1</span>資料を見る
            </li>
            <li>
              <span>2</span>投票する
            </li>
            <li>
              <span>3</span>質問を送る
            </li>
          </ol>
          <button
            className="text-link-button muted"
            onClick={resetDemoLecture}
            type="button"
          >
            最初から試す
          </button>
        </section>
      ) : null}

      {isSessionSyncPaused ? (
        <section className="panel warning-panel">
          <p className="eyebrow">
            {sessionSyncPauseReason === 'lectureClosed'
              ? '講義終了'
              : '同期停止'}
          </p>
          <h2>{sessionSyncMessage ?? '同期を停止しています。'}</h2>
          {sessionSyncPauseReason !== 'lectureClosed' ? (
            <button
              className="primary-button compact"
              onClick={() => void resumeSessionSync()}
              type="button"
            >
              もう一度つなぐ
            </button>
          ) : (
            <p className="note">
              ご参加ありがとうございました。新しい講義は参加画面から入れます。
            </p>
          )}
        </section>
      ) : null}

      {commentsError ? (
        <p className="error-note">
          コメントの取得または投稿に失敗しました。時間をおいて再度お試しください。
        </p>
      ) : null}
      {commentLikesError ? (
        <p className="error-note">
          いいねの反映に失敗しました。画面を再読み込みしてください。
        </p>
      ) : null}
      {commentsLoading ? (
        <p className="note">みんなの声を読み込んでいます。</p>
      ) : null}
      {pollsError ? (
        <p className="error-note">
          投票の取得に失敗しました。画面を再読み込みしてください。
        </p>
      ) : null}
      {pollResultsError ? (
        <p className="error-note">
          投票結果の更新に失敗しました。回答は保存されている可能性があります。
        </p>
      ) : null}
      {pollsLoading ? (
        <p className="note">ライブ投票を読み込んでいます。</p>
      ) : null}

      <section className="lecture-live-grid">
        <section
          className="panel student-pdf-panel lecture-material"
          id="lecture-material"
        >
          <div className="section-intro compact-intro">
            <span className="section-icon">
              <AppIcon name="book" size={18} />
            </span>
            <div>
              <p className="eyebrow">LECTURE MATERIAL</p>
              <h2>いま見ている資料</h2>
            </div>
          </div>
          {displayStateError ? (
            <p className="error-note">資料の更新に時間がかかっています。</p>
          ) : null}
          <SyncedPdfViewer
            documentId={displayState?.pdfDocumentId ?? null}
            documentVersion={displayState?.pdfDocumentVersion}
            lectureSessionId={activeLectureSessionId}
            manifestVersion={displayState?.pdfManifestVersion}
            pageCount={displayState?.pdfPageCount}
            remotePage={displayState?.currentPdfPage ?? null}
            visible={displayState?.pdfVisible}
          />
        </section>

        <aside className="lecture-poll-focus" id="lecture-poll">
          {openPolls.length > 0 ? (
            openPolls.map((poll) => (
              <LivePoll
                currentParticipantId={currentParticipantId}
                key={poll.id}
                onSubmitResponse={submitPollResponse}
                poll={poll}
                results={pollResults}
                responses={pollResponses}
              />
            ))
          ) : (
            <section className="panel quiet-state">
              <span className="quiet-state-icon">
                <AppIcon name="poll" size={24} />
              </span>
              <p className="eyebrow">LIVE POLL</p>
              <h2>いまは講義に集中しましょう</h2>
              <p>次の投票が始まると、ここに届きます。</p>
            </section>
          )}
        </aside>
      </section>

      <LiveCaptionPanel compact isDemo={runtimeMode === 'demo'} />

      <FiveMinuteRecapPanel isDemo={runtimeMode === 'demo'} />

      <section className="lecture-participation">
        <div className="participation-main">
          <CommentInput
            disabled={!isJoined || commentsLoading || isSessionSyncPaused}
            isSubmitting={isSubmittingComment}
            onSubmit={addComment}
          />
          <LiveBoard
            comments={visibleComments}
            currentParticipantId={currentParticipantId}
            hasOlderComments={hasOlderComments}
            isLoadingOlderComments={isLoadingOlderComments}
            onLoadOlderComments={loadOlderComments}
            onToggleLike={toggleCommentLike}
          />
        </div>

        <aside className="lecture-review-rail">
          <MaterialSummaryPanel isDemo={runtimeMode === 'demo'} />
        </aside>
      </section>

      <div className="lecture-mobile-actions" aria-label="講義内ショートカット">
        <a href="#lecture-material">
          <AppIcon name="book" size={18} /> 資料
        </a>
        <a href="#lecture-poll">
          <AppIcon name="poll" size={18} /> 投票
        </a>
        <a className="has-update" href="#lecture-recap">
          <AppIcon name="sparkles" size={18} /> 要点
        </a>
        <a href="#lecture-question">
          <AppIcon name="message" size={18} /> 質問
        </a>
      </div>
    </main>
  )
}
