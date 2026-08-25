import { useRef } from 'react'
import { LiveBoard } from '../LiveBoard'
import { LivePoll } from '../LivePoll'
import { SyncedPdfViewer } from './SyncedPdfViewer'
import { useFullscreen } from '../../hooks/useFullscreen'
import { LectureJoinQr } from '../LectureJoinQr'
import { LiveCaptionPanel, type CaptionContent } from '../LearningSupport'
import type { DisplayState } from '../../repositories/supabaseDisplayStateRepository'
import type { PollResultSummary } from '../../repositories/supabasePollRepository'
import type { PublicLectureSummary } from '../../repositories/supabaseLiveStateRepository'
import type {
  LectureRuntimeMode,
  LectureSession,
  LiveComment,
  Poll,
} from '../../types'

type DisplayViewProps = {
  activeLectureSessionId: string | null
  caption: CaptionContent | null
  comments: LiveComment[]
  commentsError: string | null
  commentsLoading: boolean
  displayState: DisplayState | null
  displayStateError: string | null
  displayToken?: string
  hasJoinedLectureSession: boolean
  isSessionSyncPaused: boolean
  lecture: LectureSession
  lectureCode: string
  pollResults: PollResultSummary[]
  pollResultsError: string | null
  polls: Poll[]
  pollsError: string | null
  pollsLoading: boolean
  runtimeMode: LectureRuntimeMode
  sessionSyncMessage: string | null
  summary: PublicLectureSummary | null
  visibleCommentCount: number
}

export function DisplayView({
  activeLectureSessionId,
  caption,
  comments,
  commentsError,
  commentsLoading,
  displayState,
  displayStateError,
  displayToken,
  hasJoinedLectureSession,
  isSessionSyncPaused,
  lecture,
  lectureCode,
  pollResults,
  pollResultsError,
  polls,
  pollsError,
  pollsLoading,
  runtimeMode,
  sessionSyncMessage,
  summary,
  visibleCommentCount,
}: DisplayViewProps) {
  const presentationRef = useRef<HTMLElement | null>(null)
  const {
    errorMessage: presentationFullscreenError,
    isFullscreen: isPresentationFullscreen,
    isFullscreenSupported,
    toggleFullscreen,
  } = useFullscreen(presentationRef)
  const remotePdfPage = displayState?.currentPdfPage ?? null
  const isLectureClosed = lecture.status === 'closed'
  const activePolls = isLectureClosed ? [] : polls.slice(0, 1)

  return (
    <main className="display-shell" ref={presentationRef}>
      <section className="display-hero">
        <div className="display-title-group">
          <h1 title={lecture.title}>{lecture.title}</h1>
        </div>
        {!isLectureClosed ? (
          <LectureJoinQr
            code={lectureCode}
            compact
            demoJoin={runtimeMode === 'demo'}
            title="講義に参加"
          />
        ) : null}
        <div className="display-actions">
          <button
            className="secondary-button display-fullscreen-button"
            disabled={!isFullscreenSupported}
            onClick={() => void toggleFullscreen()}
            type="button"
          >
            {isPresentationFullscreen
              ? '全画面を終了'
              : '教室表示を全画面にする'}
          </button>
        </div>
        {presentationFullscreenError ? (
          <p className="error-note">{presentationFullscreenError}</p>
        ) : null}
        {displayStateError ? (
          <p className="error-note">教室表示の更新に時間がかかっています。</p>
        ) : null}
      </section>

      {!hasJoinedLectureSession || !activeLectureSessionId ? (
        <section className="display-warning">
          <p className="eyebrow">READY TO START</p>
          <h2>講義コードを入力すると、教室表示が始まります。</h2>
          <p>資料、みんなの声、投票結果がここに集まります。</p>
        </section>
      ) : null}

      {isSessionSyncPaused || isLectureClosed ? (
        <section className="display-warning">
          <p className="eyebrow">講義状態</p>
          <h2>
            {isLectureClosed
              ? '講義は終了しました。'
              : (sessionSyncMessage ?? '同期を停止しています。')}
          </h2>
        </section>
      ) : null}

      <div
        className={`display-layout display-mode-normal ${
          activePolls.length > 0 ? 'has-active-poll' : 'without-active-poll'
        }`}
      >
        <section className="display-main-stage">
          <div className="display-placeholder slide-placeholder">
            <SyncedPdfViewer
              displayToken={displayToken}
              documentId={displayState?.pdfDocumentId ?? null}
              documentVersion={displayState?.pdfDocumentVersion}
              key={`${activeLectureSessionId ?? 'none'}:${
                displayState?.pdfDocumentId ?? 'none'
              }:${displayState?.pdfDocumentVersion ?? 'none'}:${
                displayState?.pdfManifestVersion ?? 0
              }`}
              lectureSessionId={activeLectureSessionId}
              manifestVersion={displayState?.pdfManifestVersion}
              pageCount={displayState?.pdfPageCount}
              presenterLocked
              projector
              remotePage={remotePdfPage}
              viewMode={isLectureClosed ? 'closed' : 'live'}
              visible={displayState?.pdfVisible}
            />
          </div>

          {!isLectureClosed && (caption || runtimeMode === 'demo') ? (
            <LiveCaptionPanel
              caption={caption}
              compact
              isDemo={runtimeMode === 'demo'}
              mode="display"
            />
          ) : null}
        </section>

        <aside className="display-side-rail">
          {!isLectureClosed && summary && summary.lectureRecap.length > 0 ? (
            <section
              aria-live="polite"
              className="display-summary-card"
              key={summary.revisionId}
            >
              <div className="display-summary-heading">
                <p className="eyebrow">5 MINUTE RECAP</p>
                <h2>直近5分のハイライト</h2>
              </div>
              <ul>
                {summary.lectureRecap.slice(0, 3).map((point, index) => (
                  <li key={`${summary.revisionId}:${index}`}>{point}</li>
                ))}
              </ul>
            </section>
          ) : null}
          {commentsError ? (
            <p className="error-note">コメントの取得に失敗しました。</p>
          ) : null}
          {commentsLoading ? (
            <p className="note">コメントを読み込んでいます。</p>
          ) : null}
          <LiveBoard
            comments={comments}
            limit={5}
            mode="display"
            totalCount={visibleCommentCount}
          />
        </aside>

        {!isLectureClosed &&
        (activePolls.length > 0 ||
          pollsError ||
          pollResultsError ||
          pollsLoading) ? (
          <section className="display-poll-rail">
            <div className="display-poll-heading">
              <p className="eyebrow">LIVE POLL</p>
              <h2>みんなの考え</h2>
            </div>
            {pollsError ? (
              <p className="error-note">投票の取得に失敗しました。</p>
            ) : null}
            {pollResultsError ? (
              <p className="error-note">投票結果の更新に失敗しました。</p>
            ) : null}
            {pollsLoading ? (
              <p className="note">投票を読み込んでいます。</p>
            ) : null}
            {activePolls.map((poll) => (
              <LivePoll
                displayMode
                key={poll.id}
                poll={poll}
                responses={[]}
                results={pollResults}
              />
            ))}
          </section>
        ) : null}
      </div>
    </main>
  )
}
