import { useEffect } from 'react'
import { Link } from 'react-router-dom'
import { AppIcon } from '../components/AppIcon'
import { LiveBoard } from '../components/LiveBoard'
import { useCompassState } from '../hooks/useCompassState'

export function CommentHistoryPage() {
  const {
    commentsError,
    hasOlderComments,
    isLoadingOlderComments,
    lecture,
    loadOlderComments,
    refreshComments,
    visibleComments,
  } = useCompassState()

  useEffect(() => {
    void refreshComments().catch(() => undefined)
  }, [refreshComments])

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

      {commentsError ? (
        <p className="error-note" role="alert">
          コメント履歴を読み込めませんでした。もう一度お試しください。
        </p>
      ) : null}

      <LiveBoard
        comments={visibleComments}
        hasOlderComments={hasOlderComments}
        isLoadingOlderComments={isLoadingOlderComments}
        onLoadOlderComments={loadOlderComments}
      />
    </main>
  )
}
