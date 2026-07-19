import type { FormEventHandler } from 'react'
import { AppIcon } from '../AppIcon'
import type { AdminSessionSummary } from '../../repositories/supabaseAdminRepository'

type AdminAuthPanelProps = {
  authError: string
  isVerifying: boolean
  onPinChange: (pin: string) => void
  onSubmit: FormEventHandler<HTMLFormElement>
  pin: string
}

export function AdminAuthPanel({
  authError,
  isVerifying,
  onPinChange,
  onSubmit,
  pin,
}: AdminAuthPanelProps) {
  return (
    <main className="page-shell join-page">
      <form className="join-card" onSubmit={onSubmit}>
        <span className="admin-login-icon">
          <AppIcon name="compass" size={25} />
        </span>
        <p className="eyebrow">FOR EDUCATORS</p>
        <h1>講義を運営する</h1>
        <p>管理PINを入力して、講義コントロールを開きます。</p>
        <label className="field">
          <span>PIN</span>
          <input
            aria-label="管理PIN"
            autoComplete="off"
            disabled={isVerifying}
            inputMode="numeric"
            onChange={(event) => onPinChange(event.target.value)}
            type="password"
            value={pin}
          />
        </label>
        {authError ? <p className="error-note">{authError}</p> : null}
        <button
          className="primary-button"
          disabled={isVerifying || pin.trim().length === 0}
          type="submit"
        >
          {isVerifying ? '確認中…' : '講義コントロールを開く'}
        </button>
      </form>
    </main>
  )
}

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
                最終確認 {new Date(session.lastSeenAt).toLocaleString('ja-JP')}
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
