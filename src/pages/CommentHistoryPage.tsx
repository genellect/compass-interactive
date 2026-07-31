import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router'
import { AppIcon } from '../components/AppIcon'
import { LiveBoard } from '../components/LiveBoard'
import { useCompassState } from '../hooks/useCompassState'
import { isPhase71ClassroomExtensionsEnabled } from '../lib/featureFlags'
import { supabaseLiveStateRepository } from '../repositories/supabaseLiveStateRepository'
import { getOldestCommentCursor } from '../context/compass/commentsAndPolls'
import type { LiveComment } from '../types'

export function CommentHistoryPage() {
  const {
    commentsError,
    activeLectureSessionId,
    currentParticipantId,
    hasOlderComments,
    isLoadingOlderComments,
    lecture,
    loadOlderComments,
    refreshComments,
    runtimeMode,
    visibleComments,
  } = useCompassState()
  const [historyScope, setHistoryScope] = useState<'all' | 'mine'>('all')
  const [ownComments, setOwnComments] = useState<LiveComment[]>([])
  const [ownHasOlder, setOwnHasOlder] = useState(false)
  const [ownLoading, setOwnLoading] = useState(false)
  const [ownLoaded, setOwnLoaded] = useState(false)
  const [ownError, setOwnError] = useState<string | null>(null)

  useEffect(() => {
    void refreshComments().catch(() => undefined)
  }, [refreshComments])

  useEffect(() => {
    setHistoryScope('all')
    setOwnComments([])
    setOwnHasOlder(false)
    setOwnLoaded(false)
    setOwnError(null)
  }, [activeLectureSessionId])

  const loadOwnComments = useCallback(
    async (reset: boolean) => {
      if (!activeLectureSessionId || ownLoading) return
      if (runtimeMode === 'demo') {
        setOwnComments(
          visibleComments.filter(
            (comment) => comment.participantId === currentParticipantId,
          ),
        )
        setOwnHasOlder(false)
        setOwnLoaded(true)
        return
      }

      const before = reset ? null : getOldestCommentCursor(ownComments)
      if (!reset && !before) {
        setOwnHasOlder(false)
        return
      }
      setOwnLoading(true)
      setOwnError(null)
      try {
        const page = await supabaseLiveStateRepository.getCommentHistory({
          before,
          lectureSessionId: activeLectureSessionId,
          scope: 'mine',
        })
        setOwnComments((current) => {
          const base = reset ? [] : current
          const byId = new Map(base.map((comment) => [comment.id, comment]))
          for (const comment of page.items) byId.set(comment.id, comment)
          return [...byId.values()].sort(
            (left, right) =>
              Date.parse(right.createdAt) - Date.parse(left.createdAt),
          )
        })
        setOwnHasOlder(page.hasOlder)
        setOwnLoaded(true)
      } catch (error) {
        setOwnError(
          error instanceof Error
            ? error.message
            : '自分のコメントを読み込めませんでした。',
        )
      } finally {
        setOwnLoaded(true)
        setOwnLoading(false)
      }
    },
    [
      activeLectureSessionId,
      currentParticipantId,
      ownComments,
      ownLoading,
      runtimeMode,
      visibleComments,
    ],
  )

  useEffect(() => {
    if (
      isPhase71ClassroomExtensionsEnabled &&
      historyScope === 'mine' &&
      !ownLoaded
    ) {
      void loadOwnComments(true)
    }
  }, [historyScope, loadOwnComments, ownLoaded])

  const showingOwnComments =
    isPhase71ClassroomExtensionsEnabled && historyScope === 'mine'
  const activeError = showingOwnComments ? ownError : commentsError

  return (
    <main className="page-shell comment-history-page">
      <section className="page-header compact-page-header">
        <div>
          <p className="eyebrow">COMMENT HISTORY</p>
          <h1>コメント履歴</h1>
          <p>{lecture.title}</p>
        </div>
        <Link className="secondary-link" to="/lecture">
          <AppIcon name="arrow-left" size={16} />
          講義へ戻る
        </Link>
      </section>

      {isPhase71ClassroomExtensionsEnabled ? (
        <div className="comment-history-tabs" role="tablist" aria-label="コメント表示">
          <button
            aria-selected={historyScope === 'all'}
            className={historyScope === 'all' ? 'is-active' : ''}
            onClick={() => setHistoryScope('all')}
            role="tab"
            type="button"
          >
            みんな
          </button>
          <button
            aria-selected={historyScope === 'mine'}
            className={historyScope === 'mine' ? 'is-active' : ''}
            onClick={() => setHistoryScope('mine')}
            role="tab"
            type="button"
          >
            自分
          </button>
        </div>
      ) : null}

      {activeError ? (
        <p className="error-note" role="alert">
          {showingOwnComments
            ? activeError
            : 'コメント履歴を読み込めませんでした。もう一度お試しください。'}
        </p>
      ) : null}

      <LiveBoard
        comments={showingOwnComments ? ownComments : visibleComments}
        currentParticipantId={currentParticipantId}
        hasOlderComments={showingOwnComments ? ownHasOlder : hasOlderComments}
        isLoadingOlderComments={
          showingOwnComments ? ownLoading : isLoadingOlderComments
        }
        onLoadOlderComments={
          showingOwnComments
            ? () => loadOwnComments(false)
            : loadOlderComments
        }
        title={showingOwnComments ? '自分のコメント' : 'みんなの声'}
      />
    </main>
  )
}
