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
  return (
    <main className="page-shell admin-settings-page">
      <section className="page-header">
        <div>
          <p className="eyebrow">ADMIN SETTINGS</p>
          <h1>管理者設定</h1>
          <p>メンバー、権限、ログイン状態を管理します。</p>
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
            講義画面を開く
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
      {personalSettings ? (
        <section className="panel admin-settings-section">
          <h2>個人設定</h2>
          {personalSettings}
        </section>
      ) : null}
      {ledger}
    </main>
  )
}
