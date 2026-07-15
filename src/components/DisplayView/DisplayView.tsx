import { useRef } from 'react'
import { LiveBoard } from '../LiveBoard'
import { LivePoll } from '../LivePoll'
import { SyncedPdfViewer } from './SyncedPdfViewer'
import { useFullscreen } from '../../hooks/useFullscreen'
import { AppIcon } from '../AppIcon'
import { LiveCaptionPanel, type CaptionContent } from '../LearningSupport'
import type { DisplayState } from '../../repositories/supabaseDisplayStateRepository'
import type { PollResultSummary } from '../../repositories/supabasePollRepository'
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
  hasJoinedLectureSession: boolean
  isSessionSyncPaused: boolean
  lecture: LectureSession
  pollResults: PollResultSummary[]
  pollResultsError: string | null
  polls: Poll[]
  pollsError: string | null
  pollsLoading: boolean
  runtimeMode: LectureRuntimeMode
  sessionSyncMessage: string | null
}

export function DisplayView({
  activeLectureSessionId,
  caption,
  comments,
  commentsError,
  commentsLoading,
  displayState,
  displayStateError,
  hasJoinedLectureSession,
  isSessionSyncPaused,
  lecture,
  pollResults,
  pollResultsError,
  polls,
  pollsError,
  pollsLoading,
  runtimeMode,
  sessionSyncMessage,
}: DisplayViewProps) {
  const presentationRef = useRef<HTMLDivElement | null>(null)
  const {
    errorMessage: presentationFullscreenError,
    isFullscreen: isPresentationFullscreen,
    isFullscreenSupported,
    toggleFullscreen,
  } = useFullscreen(presentationRef)
  const displayMode = displayState?.displayMode ?? 'normal'
  const remotePdfPage = displayState?.currentPdfPage ?? null

  return (
    <main className="display-shell">
      <section className="display-hero">
        <div className="display-title-group">
          <span className="live-badge">
            <i /> LIVE CLASSROOM
          </span>
          <div>
            <p className="eyebrow">COMPASS INTERACTIVE</p>
            <h1>{lecture.title}</h1>
          </div>
        </div>
        <div className="display-status-row">
          <span className="metric">
            <AppIcon name="message" size={16} /> {comments.length}件の声
          </span>
          <span className="metric">
            <AppIcon name="poll" size={16} /> {polls.length}件受付中
          </span>
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

      {isSessionSyncPaused ? (
        <section className="display-warning">
          <p className="eyebrow">講義状態</p>
          <h2>{sessionSyncMessage ?? '同期を停止しています。'}</h2>
        </section>
      ) : null}

      <div
        className={`display-layout display-mode-${displayMode}`}
        ref={presentationRef}
      >
        <section className="display-main-stage">
          <div className="display-placeholder slide-placeholder">
            <SyncedPdfViewer
              documentId={displayState?.pdfDocumentId ?? null}
              documentVersion={displayState?.pdfDocumentVersion}
              lectureSessionId={activeLectureSessionId}
              manifestVersion={displayState?.pdfManifestVersion}
              pageCount={displayState?.pdfPageCount}
              presenterLocked
              remotePage={remotePdfPage}
              visible={displayState?.pdfVisible}
            />
          </div>

          <LiveCaptionPanel
            caption={caption}
            compact
            isDemo={runtimeMode === 'demo'}
            mode="display"
          />
        </section>

        <aside className="display-side-rail">
          {commentsError ? (
            <p className="error-note">コメントの取得に失敗しました。</p>
          ) : null}
          {commentsLoading ? (
            <p className="note">コメントを読み込んでいます。</p>
          ) : null}
          <LiveBoard comments={comments} mode="display" />
        </aside>

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
          {polls.length > 0 ? (
            polls.map((poll) => (
              <LivePoll
                displayMode
                key={poll.id}
                poll={poll}
                responses={[]}
                results={pollResults}
              />
            ))
          ) : (
            <section className="panel display-panel">
              <span className="quiet-state-icon">
                <AppIcon name="poll" size={24} />
              </span>
              <p className="eyebrow">LIVE POLL</p>
              <h2>次の問いを待っています</h2>
            </section>
          )}
        </section>
      </div>
    </main>
  )
}
