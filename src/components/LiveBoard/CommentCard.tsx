import type { LiveComment } from '../../types'
import { AppIcon } from '../AppIcon'

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
  const authorLabel = comment.nickname ?? '匿名の参加者'
  const authorInitial = comment.nickname
    ? (Array.from(comment.nickname)[0] ?? '?')
    : '?'

  return (
    <article
      className={`comment-card ${comment.status === 'hidden' ? 'is-hidden' : ''}`}
    >
      <div className="comment-meta">
        <span
          className={`comment-author ${comment.nickname ? 'has-nickname' : ''}`}
        >
          <i aria-hidden="true">{authorInitial}</i>
          {authorLabel}
        </span>
        <span>{comment.isPending ? '送信中…' : timeLabel}</span>
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
        <span className="like-count">
          <AppIcon name="heart" size={15} /> {comment.likeCount}
        </span>
        {mode === 'student' && onToggleLike && !comment.isPending ? (
          <button
            className={`text-button ${hasLiked ? 'is-active' : ''}`}
            disabled={hasLiked}
            onClick={() => {
              void onToggleLike(comment.id)
            }}
            type="button"
          >
            <AppIcon name="heart" size={15} />
            {hasLiked ? '共感しました' : '共感する'}
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
