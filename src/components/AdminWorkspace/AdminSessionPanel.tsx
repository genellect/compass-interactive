import type { AdminSessionSummary } from '../../repositories/supabaseAdminRepository'

type AdminSessionPanelProps = {
  currentSessionId: string
  error: string
  isLoading: boolean
  onRevoke: (sessionId: string) => void
  sessions: AdminSessionSummary[]
}

export function AdminSessionPanel({
  currentSessionId,
  error,
  isLoading,
  onRevoke,
  sessions,
}: AdminSessionPanelProps) {
  return (
    <section className="control-card admin-session-panel">
      <div>
        <p className="eyebrow">SECURITY</p>
        <h2>管理セッション</h2>
        <p>利用していない端末のセッションを個別に失効できます。</p>
      </div>
      {error ? (
        <p className="error-note" role="alert">
          {error}
        </p>
      ) : null}
      <div className="admin-session-list">
        {sessions.map((session) => (
          <div className="admin-session-row" key={session.id}>
            <span>
              <strong>
                {session.revokedAt
                  ? '失効済み'
                  : session.id === currentSessionId
                    ? '現在のセッション'
                    : '有効なセッション'}
              </strong>
              <small>
                最終確認: {new Date(session.lastSeenAt).toLocaleString('ja-JP')}
              </small>
            </span>
            <button
              className="secondary-button compact"
              disabled={isLoading || Boolean(session.revokedAt)}
              onClick={() => onRevoke(session.id)}
              type="button"
            >
              失効する
            </button>
          </div>
        ))}
      </div>
    </section>
  )
}
