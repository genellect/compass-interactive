import type { LiveComment } from '../../types'

type CommentCardProps = {
  comment: LiveComment
  currentParticipantId?: string | null
  mode?: 'student' | 'admin' | 'display'
  onToggleLike?: (commentId: string) => void | Promise<void>
  onTogglePinned?: (commentId: string) => void
  onToggleVisibility?: (commentId: string) => void
}

export function CommentCard({
  comment,
  currentParticipantId,
  mode = 'student',
  onToggleLike,
  onTogglePinned,
  onToggleVisibility,
}: CommentCardProps) {
  const hasLiked = currentParticipantId
    ? comment.likedByParticipantIds.includes(currentParticipantId)
    : false
  const timeLabel = new Date(comment.createdAt).toLocaleTimeString('ja-JP', {
    hour: '2-digit',
    minute: '2-digit',
  })

  return (
    <article
      className={`comment-card ${comment.status === 'hidden' ? 'is-hidden' : ''}`}
    >
      <div className="comment-meta">
        <span>匿名コメント</span>
        <span>{timeLabel}</span>
      </div>

      {mode === 'admin' && (comment.isPinned || comment.status === 'hidden') ? (
        <div className="tag-row">
          {comment.isPinned ? <span className="tag">固定中</span> : null}
          {comment.status === 'hidden' ? (
            <span className="tag muted">非表示</span>
          ) : null}
        </div>
      ) : null}

      <p>{comment.body}</p>

      <div className="comment-actions">
        <span>いいね {comment.likeCount}件</span>
        {mode === 'student' && onToggleLike ? (
          <button
            className={`text-button ${hasLiked ? 'is-active' : ''}`}
            disabled={hasLiked}
            onClick={() => {
              void onToggleLike(comment.id)
            }}
            type="button"
          >
            {hasLiked ? 'いいね済み' : 'いいね'}
          </button>
        ) : null}
      </div>

      {mode === 'admin' ? (
        <div className="admin-actions">
          <button
            className="secondary-button"
            onClick={() => onToggleVisibility?.(comment.id)}
            type="button"
          >
            {comment.status === 'visible' ? '非表示にする' : '表示に戻す'}
          </button>
          <button
            className="secondary-button"
            onClick={() => onTogglePinned?.(comment.id)}
            type="button"
          >
            {comment.isPinned ? '固定を解除' : '固定する'}
          </button>
        </div>
      ) : null}
    </article>
  )
}
