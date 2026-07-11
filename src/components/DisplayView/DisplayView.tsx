import { useRef } from 'react'
import { LiveBoard } from '../LiveBoard'
import { LivePoll } from '../LivePoll'
import { SyncedPdfViewer } from './SyncedPdfViewer'
import { useFullscreen } from '../../hooks/useFullscreen'
import type { DisplayState } from '../../repositories/supabaseDisplayStateRepository'
import type { PollResultSummary } from '../../repositories/supabasePollRepository'
import type { LectureSession, LiveComment, Poll } from '../../types'

type DisplayViewProps = {
  activeLectureSessionId: string | null
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
  sessionSyncMessage: string | null
}

export function DisplayView({
  activeLectureSessionId,
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
        <p className="eyebrow">共有画面</p>
        <h1>{lecture.title}</h1>
        <p>発表中のスライド、字幕、匿名コメント、投票結果を表示します。</p>
        <div className="display-status-row">
          <span className="metric">コメント {comments.length}件</span>
          <span className="metric">投票 {polls.length}件</span>
          <button
            className="secondary-button display-fullscreen-button"
            disabled={!isFullscreenSupported}
            onClick={() => void toggleFullscreen()}
            type="button"
          >
            {isPresentationFullscreen ? '全画面を終了' : '共有画面を全画面表示'}
          </button>
        </div>
        {presentationFullscreenError ? (
          <p className="error-note">{presentationFullscreenError}</p>
        ) : null}
        {displayStateError ? (
          <p className="error-note">表示画面の同期に失敗しました。</p>
        ) : null}
      </section>

      {!hasJoinedLectureSession || !activeLectureSessionId ? (
        <section className="display-warning">
          <p className="eyebrow">未参加</p>
          <h2>先に講義コードを入力してください。</h2>
          <p>参加後に、共有画面用のデータが表示されます。</p>
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
              presenterLocked
              remotePage={remotePdfPage}
            />
          </div>

          <div className="display-placeholder transcript-placeholder">
            <p className="eyebrow">字幕</p>
            <h2>発表字幕はここに表示されます</h2>
            <p>音声書き起こしと翻訳支援は、後続Phaseで接続します。</p>
          </div>
        </section>

        <aside className="display-side-rail">
          {commentsError ? (
            <p className="error-note">コメントの取得に失敗しました。</p>
          ) : null}
          {commentsLoading ? <p className="note">コメントを読み込んでいます。</p> : null}
          <LiveBoard comments={comments} mode="display" />
        </aside>

        <section className="display-poll-rail">
          <div className="display-poll-heading">
            <p className="eyebrow">投票結果</p>
            <h2>ディスカッション Poll</h2>
            <p className="note">結果は約5秒ごとに更新されます。</p>
          </div>
          {pollsError ? (
            <p className="error-note">投票の取得に失敗しました。</p>
          ) : null}
          {pollResultsError ? (
            <p className="error-note">投票結果の更新に失敗しました。</p>
          ) : null}
          {pollsLoading ? <p className="note">投票を読み込んでいます。</p> : null}
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
              <p className="eyebrow">投票</p>
              <h2>現在受付中の投票はありません。</h2>
            </section>
          )}
        </section>
      </div>
    </main>
  )
}
