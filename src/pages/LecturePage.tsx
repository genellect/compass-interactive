import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { AppIcon } from '../components/AppIcon'
import { SyncedPdfViewer } from '../components/DisplayView'
import {
  AcademicAnswerPanel,
  FiveMinuteRecapPanel,
  LiveCaptionPanel,
  MaterialSummaryPanel,
} from '../components/LearningSupport'
import { CommentInput, LiveBoard } from '../components/LiveBoard'
import { LivePoll } from '../components/LivePoll'
import { useCompassState } from '../hooks/useCompassState'
import { isPhase65CommentNicknamesEnabled } from '../lib/featureFlags'
import { formatSummaryWindowLabel } from '../summary/summaryWindow'

const CAPTION_FRESHNESS_MS = 15_000
const CONNECTED_FRESHNESS_MS = 20_000

export function LecturePage() {
  const {
    addComment,
    academicAnswers,
    activeLectureSessionId,
    caption,
    commentLikesError,
    commentsError,
    commentsLoading,
    currentParticipantId,
    displayState,
    displayStateError,
    hasJoinedLectureSession,
    hasOlderComments,
    isSessionSyncPaused,
    isSubmittingComment,
    lastSuccessfulSyncAt,
    leaveLecture,
    lecture,
    materialSummary,
    openPolls,
    participantCount,
    pollResults,
    pollResponses,
    pollResultsError,
    pollsError,
    resetDemoLecture,
    resumeSessionSync,
    runtimeMode,
    sessionSyncMessage,
    sessionSyncPauseReason,
    submitPollResponse,
    summaries,
    toggleCommentLike,
    visibleCommentCount,
    visibleComments,
  } = useCompassState()
  const navigate = useNavigate()
  const isJoined = Boolean(
    hasJoinedLectureSession && currentParticipantId && activeLectureSessionId,
  )
  const [demoParticipantCount, setDemoParticipantCount] = useState(
    lecture.expectedParticipants,
  )
  const [now, setNow] = useState(() => Date.now())
  const [liveNotice, setLiveNotice] = useState<string | null>(null)
  const previousPageRef = useRef<number | null>(null)
  const previousPollIdsRef = useRef<string[] | null>(null)

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 5_000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    setDemoParticipantCount(lecture.expectedParticipants)
    if (runtimeMode !== 'demo') return

    const changes = [1, 2, -1, 1, 1, -2, 2]
    let changeIndex = 0
    const timer = window.setInterval(() => {
      setDemoParticipantCount((current) => {
        const next = current + changes[changeIndex]
        changeIndex = (changeIndex + 1) % changes.length
        return Math.min(224, Math.max(216, next))
      })
    }, 2_600)

    return () => window.clearInterval(timer)
  }, [lecture.expectedParticipants, runtimeMode])

  useEffect(() => {
    const currentPage = displayState?.currentPdfPage ?? null
    const previousPage = previousPageRef.current
    previousPageRef.current = currentPage
    if (
      runtimeMode === 'live' &&
      previousPage !== null &&
      currentPage !== null &&
      previousPage !== currentPage
    ) {
      setLiveNotice(`発表者が P.${currentPage} へ移動しました`)
    }
  }, [displayState?.currentPdfPage, runtimeMode])

  useEffect(() => {
    const currentIds = openPolls.map((poll) => poll.id)
    const previousIds = previousPollIdsRef.current
    previousPollIdsRef.current = currentIds
    if (
      runtimeMode === 'live' &&
      previousIds !== null &&
      currentIds.some((id) => !previousIds.includes(id))
    ) {
      setLiveNotice('新しい投票が始まりました')
    }
  }, [openPolls, runtimeMode])

  useEffect(() => {
    if (!liveNotice) return
    const timer = window.setTimeout(() => setLiveNotice(null), 4_500)
    return () => window.clearTimeout(timer)
  }, [liveNotice])

  const liveRecaps = useMemo(
    () =>
      summaries.map((summary) => ({
        classPulse: summary.commentPulse,
        id: `${summary.id}:${summary.revisionId}`,
        presenterPoints: summary.lectureRecap,
        responseLabel:
          summary.reviewState === 'admin_revised'
            ? '教員修正済み'
            : summary.reviewState === 'admin_confirmed'
              ? '教員確認済み'
              : 'AI生成・教員未確認',
        windowLabel: formatSummaryWindowLabel(
          summary.windowStart,
          summary.windowEnd,
        ),
      })),
    [summaries],
  )
  const recentComments = visibleComments.slice(0, 5)
  const hasCommentHistory =
    hasOlderComments || visibleCommentCount > recentComments.length
  const isLectureClosed =
    lecture.status === 'closed' || sessionSyncPauseReason === 'lectureClosed'
  const captionUpdatedAt = caption ? Date.parse(caption.updatedAt) : Number.NaN
  const showCaption =
    !isLectureClosed &&
    (runtimeMode === 'demo' ||
      (caption !== null &&
        Number.isFinite(captionUpdatedAt) &&
        now - captionUpdatedAt <= CAPTION_FRESHNESS_MS))
  const isConnected =
    runtimeMode === 'demo' ||
    (!isSessionSyncPaused &&
      lastSuccessfulSyncAt !== null &&
      now - lastSuccessfulSyncAt <= CONNECTED_FRESHNESS_MS)
  const displayedParticipantCount =
    runtimeMode === 'demo'
      ? demoParticipantCount
      : Math.max(participantCount, isJoined ? 1 : 0)
  const connectionLabel = isLectureClosed
    ? '講義は終了しました'
    : isSessionSyncPaused
      ? '同期を休止しています'
      : isConnected
        ? 'いま講義とつながっています'
        : '講義に接続しています'

  function handleExit() {
    leaveLecture()
    navigate('/join', { replace: true })
  }

  return (
    <main className="page-shell lecture-page">
      <section className="lecture-hero">
        <div className="lecture-title-group">
          <div className="lecture-live-row">
            <span className={isLectureClosed ? 'archive-badge' : 'live-badge'}>
              {isLectureClosed ? (
                'LECTURE ENDED'
              ) : (
                <>
                  <i /> LIVE
                </>
              )}
            </span>
            <span className="lecture-mode-label">
              {isLectureClosed
                ? '講義終了後の記録'
                : runtimeMode === 'demo'
                  ? '体験版'
                  : '講義に参加中'}
            </span>
          </div>
          <h1>{lecture.title}</h1>
        </div>
        <div className="lecture-status-cluster">
          <span
            className={`lecture-connection ${isConnected && !isLectureClosed ? 'is-connected' : ''}`}
          >
            <i aria-hidden="true" />
            {connectionLabel}
          </span>
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
                  ? displayedParticipantCount
                  : `約${displayedParticipantCount}`}
              </strong>
              人参加{runtimeMode === 'demo' ? '（デモ）' : ''}
            </span>
            <span>
              <AppIcon name="poll" size={18} />
              <strong>{isLectureClosed ? 0 : openPolls.length}</strong>
              件受付中
            </span>
            <span>
              <AppIcon name="message" size={18} />
              <strong>{visibleCommentCount}</strong>
              件の声
            </span>
          </div>
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
              <span>2</span>みんなの声を見る
            </li>
            <li>
              <span>3</span>気づきを送る
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

      {liveNotice && !isLectureClosed ? (
        <div className="lecture-live-notice" role="status">
          <AppIcon name="sparkles" size={17} />
          {liveNotice}
        </div>
      ) : null}

      {isSessionSyncPaused || isLectureClosed ? (
        <section className="panel warning-panel">
          <p className="eyebrow">{isLectureClosed ? '講義終了' : '同期停止'}</p>
          <h2>
            {isLectureClosed
              ? '講義は終了しました。'
              : (sessionSyncMessage ?? '同期を停止しています。')}
          </h2>
          {!isLectureClosed ? (
            <button
              className="primary-button compact"
              onClick={() => {
                void resumeSessionSync().catch(() => undefined)
              }}
              type="button"
            >
              もう一度つなぐ
            </button>
          ) : (
            <p className="note">
              コメント投稿と投票は終了しました。記録は講義コードから30日間確認できます。
            </p>
          )}
        </section>
      ) : null}

      {commentsError ? (
        <p className="error-note" role="alert">
          コメントの取得または投稿に失敗しました。時間をおいて再度お試しください。
        </p>
      ) : null}
      {commentLikesError ? (
        <p className="error-note" role="alert">
          共感の反映に失敗しました。画面を再読み込みしてください。
        </p>
      ) : null}
      {pollsError ? (
        <p className="error-note" role="alert">
          投票の取得に失敗しました。画面を再読み込みしてください。
        </p>
      ) : null}
      {pollResultsError ? (
        <p className="error-note" role="alert">
          投票結果の更新に失敗しました。回答は保存されている可能性があります。
        </p>
      ) : null}

      <section
        className={`lecture-experience-grid ${!isLectureClosed && openPolls.length > 0 ? 'has-poll' : ''} ${runtimeMode === 'demo' || materialSummary ? 'has-summary' : ''}`}
      >
        <section
          className="panel student-pdf-panel lecture-material lecture-area-material"
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
            viewMode={isLectureClosed ? 'closed' : 'live'}
            visible={displayState?.pdfVisible}
          />
        </section>

        {showCaption ? (
          <div className="lecture-area-caption" id="lecture-caption">
            <LiveCaptionPanel
              caption={caption ? { text: caption.text } : null}
              compact
              isDemo={runtimeMode === 'demo'}
            />
          </div>
        ) : null}

        <div className="lecture-area-voices" id="lecture-voices">
          <LiveBoard
            comments={recentComments}
            currentParticipantId={currentParticipantId}
            onToggleLike={isLectureClosed ? undefined : toggleCommentLike}
            totalCount={visibleCommentCount}
          />
          {hasCommentHistory ? (
            <Link className="comment-history-link" to="/lecture/comments">
              コメント履歴を見る
              <AppIcon name="arrow-right" size={16} />
            </Link>
          ) : null}
        </div>

        <div className="lecture-area-composer">
          <CommentInput
            disabled={
              !isJoined ||
              commentsLoading ||
              isSessionSyncPaused ||
              isLectureClosed
            }
            draftKey={activeLectureSessionId ?? 'demo'}
            isSubmitting={isSubmittingComment}
            nicknameMode={
              runtimeMode === 'demo'
                ? 'demo'
                : isPhase65CommentNicknamesEnabled
                  ? 'live'
                  : 'disabled'
            }
            onSubmit={addComment}
          />
        </div>

        {!isLectureClosed && openPolls.length > 0 ? (
          <aside className="lecture-poll-focus lecture-area-poll" id="lecture-poll">
            {openPolls.map((poll) => (
              <LivePoll
                currentParticipantId={currentParticipantId}
                key={poll.id}
                onSubmitResponse={submitPollResponse}
                poll={poll}
                results={pollResults}
                responses={pollResponses}
              />
            ))}
          </aside>
        ) : null}

        {runtimeMode === 'demo' || liveRecaps.length > 0 ? (
          <div className="lecture-area-recap">
            <FiveMinuteRecapPanel
              isDemo={runtimeMode === 'demo'}
              recaps={liveRecaps}
              viewMode={isLectureClosed ? 'closed' : 'live'}
            />
          </div>
        ) : null}

        {runtimeMode === 'demo' || materialSummary ? (
          <aside className="lecture-area-summary">
            <MaterialSummaryPanel
              isDemo={runtimeMode === 'demo'}
              summary={materialSummary?.body}
            />
          </aside>
        ) : null}

        {runtimeMode === 'demo' || academicAnswers.length > 0 ? (
          <div className="lecture-area-academic">
            <AcademicAnswerPanel
              answers={academicAnswers}
              isDemo={runtimeMode === 'demo'}
              viewMode={isLectureClosed ? 'closed' : 'live'}
            />
          </div>
        ) : null}

        <section className="lecture-area-exit">
          <p>
            退出すると、この端末での同期と送信を停止します。講義コードを入力すれば再入場できます。
          </p>
          <button
            className="secondary-button lecture-exit-button"
            onClick={handleExit}
            type="button"
          >
            講義から退出する
          </button>
        </section>
      </section>

      <div className="lecture-mobile-actions" aria-label="講義内ショートカット">
        <a href="#lecture-material">
          <AppIcon name="book" size={18} /> 資料
        </a>
        <a href="#lecture-voices">
          <AppIcon name="users" size={18} /> みんなの声
        </a>
        {!isLectureClosed ? (
          <a href="#lecture-question">
            <AppIcon name="message" size={18} /> 共有する
          </a>
        ) : null}
        {!isLectureClosed && openPolls.length > 0 ? (
          <a className="has-update" href="#lecture-poll">
            <AppIcon name="poll" size={18} /> 投票
          </a>
        ) : null}
      </div>
    </main>
  )
}
