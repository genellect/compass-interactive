import type { LiveComment } from '../../types'
import { AppIcon } from '../AppIcon'
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
    <section className="panel live-board">
      <div className="panel-heading">
        <div className="section-intro">
          <span className="section-icon">
            <AppIcon name="users" size={18} />
          </span>
          <div>
            <p className="eyebrow">CLASS VOICES</p>
            <h2>{mode === 'admin' ? 'みんなの声を管理' : 'みんなの声'}</h2>
          </div>
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
          <div className="empty-comments">
            <AppIcon name="message" size={24} />
            <p>最初の気づきを共有してみませんか？</p>
          </div>
        )}
      </div>
    </section>
  )
}
