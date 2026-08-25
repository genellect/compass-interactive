import type { LiveComment } from '../../types'
import { AppIcon } from '../AppIcon'
import { CommentCard } from './CommentCard'

type LiveBoardProps = {
  comments: LiveComment[]
  currentParticipantId?: string | null
  hasOlderComments?: boolean
  isLoadingOlderComments?: boolean
  limit?: number
  mode?: 'student' | 'admin' | 'display'
  onLoadOlderComments?: () => void | Promise<void>
  onToggleLike?: (commentId: string) => void | Promise<void>
  onTogglePinned?: (commentId: string) => void
  onToggleVisibility?: (commentId: string) => void
  title?: string
  totalCount?: number
}

function sortForDisplay(comments: LiveComment[]) {
  return [...comments].sort((a, b) => {
    if (a.isPinned !== b.isPinned) {
      return a.isPinned ? -1 : 1
    }
    const recency = b.createdAt.localeCompare(a.createdAt)
    return recency !== 0 ? recency : b.likeCount - a.likeCount
  })
}

export function LiveBoard({
  comments,
  currentParticipantId,
  hasOlderComments = false,
  isLoadingOlderComments = false,
  limit,
  mode = 'student',
  onLoadOlderComments,
  onToggleLike,
  onTogglePinned,
  onToggleVisibility,
  title,
  totalCount,
}: LiveBoardProps) {
  const visibleComments =
    mode === 'admin'
      ? comments
      : comments.filter((comment) => comment.status === 'visible')

  const rankedComments =
    mode === 'display' ? sortForDisplay(visibleComments) : visibleComments
  const displayedComments =
    limit === undefined ? rankedComments : rankedComments.slice(0, limit)

  return (
    <section className="panel live-board">
      {mode === 'display' ? (
        <div className="panel-heading display-board-heading">
          <h2>{title ?? 'コメント'}</h2>
        </div>
      ) : (
        <div className="panel-heading">
          <div className="section-intro">
            <span className="section-icon">
              <AppIcon name="users" size={18} />
            </span>
            <div>
              <p className="eyebrow">CLASS VOICES</p>
              <h2>
                {title ??
                  (mode === 'admin' ? 'みんなの声を管理' : 'みんなの声')}
              </h2>
            </div>
          </div>
          <span className="metric">
            {totalCount ?? displayedComments.length}件
          </span>
        </div>
      )}

      <div className="comment-list">
        {displayedComments.length > 0 ? (
          displayedComments.map((comment) => (
            <CommentCard
              comment={comment}
              currentParticipantId={currentParticipantId}
              key={comment.id}
              mode={mode}
              onToggleLike={onToggleLike}
              onTogglePinned={onTogglePinned}
              onToggleVisibility={onToggleVisibility}
            />
          ))
        ) : (
          <div className="empty-comments">
            <AppIcon name="message" size={24} />
            <p>最初の気づきを共有してみませんか？</p>
          </div>
        )}
        {hasOlderComments && onLoadOlderComments ? (
          <button
            className="secondary-button"
            disabled={isLoadingOlderComments}
            onClick={() => {
              void onLoadOlderComments()
            }}
            type="button"
          >
            {isLoadingOlderComments
              ? '過去のコメントを読み込み中…'
              : '過去のコメントを表示'}
          </button>
        ) : null}
      </div>
    </section>
  )
}
