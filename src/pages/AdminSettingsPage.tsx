import type { ReactNode } from 'react'
import { openAdminSurface } from '../lib/adminAuth/adminSurfaceNavigation'

export default function AdminSettingsPage({
  ledger,
  onAdminLogout,
  personalSettings,
}: {
  ledger?: ReactNode
  onAdminLogout: () => Promise<void>
  personalSettings?: ReactNode
}) {
  const pageTitle = ledger ? '教員管理' : 'AI PINの設定'

  return (
    <main className="page-shell admin-settings-page">
      <section className="page-header">
        <div>
          <h1>{pageTitle}</h1>
        </div>
        <div className="admin-actions">
          <a
            className="secondary-button"
            href="/admin"
            onClick={(event) => {
              event.preventDefault()
              openAdminSurface('/admin')
            }}
            rel="noopener noreferrer"
            target="_blank"
          >
            講義コントロール
          </a>
          <button
            className="secondary-button"
            onClick={() => void onAdminLogout()}
            type="button"
          >
            ログアウト
          </button>
        </div>
      </section>
      {ledger}
      {personalSettings ? (
        <section className="admin-settings-section">{personalSettings}</section>
      ) : null}
    </main>
  )
}
