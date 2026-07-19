import { LiveBoard } from '../LiveBoard'
import type { LiveComment } from '../../types'

type Props = {
  comments: LiveComment[]
  error: string | null
  hasOlderComments: boolean
  isLoadingOlderComments: boolean
  pendingCommentId: string | null
  onLoadOlderComments: () => void
  onTogglePinned: (commentId: string) => void
  onToggleVisibility: (commentId: string) => void
}

export function AdminModerationPanel({
  comments,
  error,
  hasOlderComments,
  isLoadingOlderComments,
  pendingCommentId,
  onLoadOlderComments,
  onTogglePinned,
  onToggleVisibility,
}: Props) {
  return (
    <div id="admin-voices">
      {error ? <p className="error-note">{error}</p> : null}
      <LiveBoard
        comments={comments}
        hasOlderComments={hasOlderComments}
        isLoadingOlderComments={isLoadingOlderComments}
        mode="admin"
        onLoadOlderComments={onLoadOlderComments}
        onTogglePinned={onTogglePinned}
        onToggleVisibility={onToggleVisibility}
      />
      {pendingCommentId ? (
        <p className="note">コメントを更新しています…</p>
      ) : null}
    </div>
  )
}
