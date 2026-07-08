import { CommentInput, LiveBoard } from '../components/LiveBoard'
import { LivePoll } from '../components/LivePoll'
import { useCompassState } from '../hooks/useCompassState'

export function LecturePage() {
  const {
    addComment,
    activeLectureSessionId,
    currentParticipantId,
    commentLikesError,
    commentsError,
    commentsLoading,
    hasJoinedLectureSession,
    isSubmittingComment,
    isSessionSyncPaused,
    lecture,
    openPolls,
    pollResults,
    pollResponses,
    pollResultsError,
    pollsError,
    pollsLoading,
    resumeSessionSync,
    sessionSyncMessage,
    sessionSyncPauseReason,
    submitPollResponse,
    toggleCommentLike,
    visibleComments,
  } = useCompassState()
  const isJoined = Boolean(
    hasJoinedLectureSession && currentParticipantId && activeLectureSessionId,
  )

  return (
    <main className="page-shell">
      <section className="page-header lecture-header">
        <div>
          <p className="eyebrow">参加画面</p>
          <h1>{lecture.title}</h1>
          <p>質問、気づき、投票を匿名で共有できます。</p>
        </div>
      </section>

      {isSessionSyncPaused ? (
        <section className="panel warning-panel">
          <p className="eyebrow">
            {sessionSyncPauseReason === 'lectureClosed' ? '講義終了' : '同期停止'}
          </p>
          <h2>{sessionSyncMessage ?? '同期を停止しています。'}</h2>
          {sessionSyncPauseReason !== 'lectureClosed' ? (
            <button
              className="primary-button compact"
              onClick={() => void resumeSessionSync()}
              type="button"
            >
              講義に戻る
            </button>
          ) : (
            <p className="note">新しい講義コードが案内された場合は、参加画面から入り直してください。</p>
          )}
        </section>
      ) : null}

      {commentsError ? (
        <p className="error-note">コメントの取得または投稿に失敗しました。時間をおいて再度お試しください。</p>
      ) : null}
      {commentLikesError ? (
        <p className="error-note">いいねの反映に失敗しました。画面を再読み込みしてください。</p>
      ) : null}
      {commentsLoading ? <p className="note">コメントを読み込んでいます。</p> : null}
      {pollsError ? (
        <p className="error-note">投票の取得に失敗しました。画面を再読み込みしてください。</p>
      ) : null}
      {pollResultsError ? (
        <p className="error-note">投票結果の更新に失敗しました。回答は保存されている可能性があります。</p>
      ) : null}
      {pollsLoading ? <p className="note">投票を読み込んでいます。</p> : null}

      <CommentInput
        disabled={!isJoined || commentsLoading || isSessionSyncPaused}
        isSubmitting={isSubmittingComment}
        onSubmit={addComment}
      />

      <div className="content-grid">
        <LiveBoard
          comments={visibleComments}
          currentParticipantId={currentParticipantId}
          onToggleLike={toggleCommentLike}
        />

        <section className="stack">
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
            <section className="panel">
              <p className="eyebrow">投票</p>
              <h2>現在受付中の投票はありません。</h2>
              <p className="note">投票が開始されると、ここに表示されます。</p>
            </section>
          )}
        </section>
      </div>
    </main>
  )
}
