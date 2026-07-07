import type { LiveComment } from '../../types'
import { CommentCard } from './CommentCard'

type LiveBoardProps = {
  comments: LiveComment[]
  currentParticipantId?: string | null
  mode?: 'student' | 'admin' | 'display'
  onToggleLike?: (commentId: string) => void | Promise<void>
  onTogglePinned?: (commentId: string) => void
  onToggleVisibility?: (commentId: string) => void
}

function sortForDisplay(comments: LiveComment[]) {
  return [...comments].sort((a, b) => {
    if (a.isPinned !== b.isPinned) {
      return a.isPinned ? -1 : 1
    }
    return b.likeCount - a.likeCount
  })
}

export function LiveBoard({
  comments,
  currentParticipantId,
  mode = 'student',
  onToggleLike,
  onTogglePinned,
  onToggleVisibility,
}: LiveBoardProps) {
  const visibleComments =
    mode === 'admin'
      ? comments
      : comments.filter((comment) => comment.status === 'visible')

  const displayedComments =
    mode === 'display' ? sortForDisplay(visibleComments) : visibleComments

  return (
    <section className="panel">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">コメント</p>
          <h2>匿名コメント</h2>
        </div>
        <span className="metric">{displayedComments.length}件</span>
      </div>

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
          <p className="note">まだ表示できるコメントはありません。</p>
        )}
      </div>
    </section>
  )
}
