import { useNavigate } from 'react-router-dom'
import { SyncedPdfViewer } from '../components/DisplayView'
import { LiveBoard } from '../components/LiveBoard'
import {
  FiveMinuteRecapPanel,
  MaterialSummaryPanel,
} from '../components/LearningSupport'
import { AppIcon } from '../components/AppIcon'
import { useCompassState } from '../hooks/useCompassState'
import { formatSummaryWindowLabel } from '../summary/summaryWindow'

export function LectureArchivePage() {
  const {
    archiveResumeError,
    archiveSession,
    isArchiveResumePending,
    leaveLecture,
    retryArchiveResume,
  } = useCompassState()
  const navigate = useNavigate()

  if (!archiveSession) {
    return (
      <main className="page-shell archive-page">
        <section className="panel quiet-state">
          <span className="quiet-state-icon">
            <AppIcon name="book" size={24} />
          </span>
          <p className="eyebrow">LECTURE ARCHIVE</p>
          <h1>
            {isArchiveResumePending
              ? '講義の記録を確認しています'
              : '講義コードを入力してください'}
          </h1>
          <p>
            {isArchiveResumePending
              ? '安全な短時間アクセスを取り直しています。'
              : archiveResumeError ??
                '終了した講義の記録は、参加画面から30日間確認できます。'}
          </p>
          <div className="button-row">
            {archiveResumeError ? (
              <button
                className="primary-button compact"
                onClick={retryArchiveResume}
                type="button"
              >
                もう一度読み込む
              </button>
            ) : null}
            <button
              className={
                archiveResumeError
                  ? 'secondary-button compact'
                  : 'primary-button compact'
              }
              onClick={() => navigate('/join', { replace: true })}
              type="button"
            >
              参加画面へ戻る
            </button>
          </div>
        </section>
      </main>
    )
  }

  const recaps = archiveSession.summaries.map((summary) => ({
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
  }))

  function exitArchive() {
    leaveLecture()
    navigate('/join', { replace: true })
  }

  return (
    <main className="page-shell archive-page">
      <section className="lecture-hero archive-hero">
        <div className="lecture-title-group">
          <div className="lecture-live-row">
            <span className="archive-badge">ARCHIVE</span>
            <span className="lecture-mode-label">講義終了後の記録</span>
          </div>
          <h1>{archiveSession.title}</h1>
        </div>
        <div className="lecture-metrics" aria-label="講義の記録">
          <span>
            <AppIcon name="users" size={18} />
            <strong>約{archiveSession.participantCountApproximate}</strong>
            人が参加
          </span>
          <span>
            <AppIcon name="message" size={18} />
            <strong>{archiveSession.comments.length}</strong>
            件の声
          </span>
        </div>
      </section>

      {archiveSession.pdf ? (
        <section className="panel student-pdf-panel lecture-material">
          <div className="section-intro compact-intro">
            <span className="section-icon">
              <AppIcon name="book" size={18} />
            </span>
            <div>
              <p className="eyebrow">LECTURE MATERIAL</p>
              <h2>講義資料</h2>
            </div>
          </div>
          <SyncedPdfViewer
            archiveSession={archiveSession}
            documentId={archiveSession.pdf.documentId}
            documentVersion={archiveSession.pdf.documentVersion}
            manifestVersion={archiveSession.pdf.manifestVersion}
            pageCount={archiveSession.pdf.pageCount}
            remotePage={archiveSession.pdf.currentPage}
            viewMode="archive"
          />
        </section>
      ) : null}

      <LiveBoard comments={archiveSession.comments} mode="display" />
      {archiveSession.commentsHasMore ? (
        <p className="note">
          コメント数が多いため、この記録では固定コメントと新しいコメントを最大500件表示しています。
        </p>
      ) : null}

      {archiveSession.polls.length > 0 ? (
        <section className="panel archive-polls">
          <div className="section-intro">
            <span className="section-icon">
              <AppIcon name="poll" size={18} />
            </span>
            <div>
              <p className="eyebrow">POLL ARCHIVE</p>
              <h2>講義中の投票</h2>
            </div>
          </div>
          <div className="archive-poll-list">
            {archiveSession.polls.map((poll) => {
              const total = poll.options.reduce(
                (sum, option) => sum + option.responseCount,
                0,
              )
              return (
                <article className="archive-poll-card" key={poll.id}>
                  <h3>{poll.question}</h3>
                  {poll.options.map((option) => {
                    const percentage =
                      total > 0
                        ? Math.round((option.responseCount / total) * 100)
                        : 0
                    return (
                      <div className="archive-poll-option" key={option.id}>
                        <span>{option.label}</span>
                        <strong>
                          {percentage}%（{option.responseCount}票）
                        </strong>
                      </div>
                    )
                  })}
                </article>
              )
            })}
          </div>
        </section>
      ) : null}

      {recaps.length > 0 ? (
        <FiveMinuteRecapPanel recaps={recaps} viewMode="archive" />
      ) : null}

      {archiveSession.materialSummary ? (
        <MaterialSummaryPanel summary={archiveSession.materialSummary.body} />
      ) : null}

      <section className="archive-expiry-note">
        <p>
          この記録は
          {new Date(archiveSession.archiveExpiresAt).toLocaleDateString(
            'ja-JP',
          )}
          まで閲覧できます。
        </p>
      </section>

      <button
        className="secondary-button lecture-exit-button"
        onClick={exitArchive}
        type="button"
      >
        講義の記録から退出する
      </button>
    </main>
  )
}
