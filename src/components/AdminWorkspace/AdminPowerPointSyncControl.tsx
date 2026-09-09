import type { ReactNode } from 'react'
import type { PresenterIssueCode } from '../../presenter/presenterBridgeProtocol'
import type { ReturnTypeOfPowerPointSync } from './adminPowerPointTypes'

const issueLabels: Record<PresenterIssueCode, string> = {
  current_slide_order_mismatch: 'スライドの並び順が変更されています。',
  custom_or_partial_show_unsupported:
    '通常の「全スライド」表示を選んでください。',
  hidden_slides_unsupported: '非表示スライドを含む資料は同期できません。',
  multiple_slide_shows: '対象のスライドショーを1つだけ開いてください。',
  page_count_mismatch: 'PowerPointと講義資料のページ数が一致しません。',
  pdf_page_count_invalid: '講義資料のページ数を確認できません。',
  powerpoint_not_running: 'PowerPointのスライドショーを開始してください。',
  presentation_changed: 'PowerPointが変更されています。',
  presenter_session_stopped:
    'PowerPoint同期が停止しました。再接続してください。',
  presenter_view_must_be_disabled: '発表者ツールをオフにしてください。',
  slide_id_order_invalid: 'PowerPointのスライド構成を確認できません。',
  windowed_slide_show_required:
    '通常のスライドショー（全画面またはウィンドウ）で開いてください。',
}

type AdminPowerPointSyncControlProps = {
  pdfPageCount: number | null
  pdfPreview?: ReactNode
  pdfTitle: string
  sync: ReturnTypeOfPowerPointSync
  showSetup: boolean
}

function readPresenterStoreUrl(): string | null {
  const value = import.meta.env.VITE_PRESENTER_STORE_URL?.trim()
  if (!value) return null
  try {
    const url = new URL(value)
    if (
      url.protocol !== 'https:' ||
      url.hostname !== 'apps.microsoft.com' ||
      url.port ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      !/^\/detail\/[A-Z0-9]{12}$/i.test(url.pathname)
    )
      return null
    return url.toString()
  } catch {
    return null
  }
}

// The release controller injects the exact Store listing only after the
// Store-signed package and matching hosted/device gates have been verified.
const PRESENTER_INSTALLER_URL = readPresenterStoreUrl()
const PRESENTER_PRIVACY_URL = '/presenter-bridge/privacy/'

function PrivacyConsentDisclosure({
  sync,
}: {
  sync: ReturnTypeOfPowerPointSync
}) {
  return (
    <section
      aria-labelledby="powerpoint-privacy-consent-title"
      className="admin-presenter-sync admin-presenter-consent"
      data-testid="powerpoint-sync-control"
    >
      <div className="admin-presenter-consent-copy">
        <strong id="powerpoint-privacy-consent-title">
          PowerPointでスライドを進める
        </strong>
        <p className="note">
          このPCでPresenter
          BridgeとPowerPointを開き、スライドショーを開始してください。
          講義資料との組合せを確認すると、PowerPointのページ操作が講義に反映されます。
        </p>
        <p className="note">
          連携のため、このPC内でPPTXを読み取り、資料を識別する情報とページ遷移をCOMPASSへ送信します。
          PPTX本体やスライドの内容は送信しません。
        </p>
        <details>
          <summary>データ利用の詳細</summary>
          <p className="note">
            このPC内で保存済みPPTXのバイト列、ファイル名、スライドID、スライドショー設定を確認します。
            資料と順序のハッシュ、枚数、ページ遷移、教員と講義セッションの関連情報をCloudflare／Supabase経由で送信します。
            本文、ノート、画像、動画は送信しません。
          </p>
          <a
            href={PRESENTER_PRIVACY_URL}
            rel="noopener noreferrer"
            target="_blank"
          >
            プライバシー情報を確認
          </a>
        </details>
        <a
          href="/presenter-bridge/index.html"
          rel="noopener noreferrer"
          target="_blank"
        >
          PowerPoint連携の始め方
        </a>
        {sync.message ? <p className="error-note">{sync.message}</p> : null}
      </div>
      <button
        className="primary-button compact"
        disabled={sync.busy}
        onClick={sync.acceptPrivacyConsent}
        type="button"
      >
        同意してPowerPoint連携を開始
      </button>
    </section>
  )
}

function PrivacyConsentManagement({
  sync,
}: {
  sync: ReturnTypeOfPowerPointSync
}) {
  if (!sync.privacyConsentAccepted) return null
  return (
    <details className="admin-presenter-privacy-management">
      <summary>連携設定</summary>
      <a href={PRESENTER_PRIVACY_URL} rel="noopener noreferrer" target="_blank">
        プライバシー情報
      </a>
      <button
        className="text-button"
        onClick={() => void sync.revokePrivacyConsent()}
        type="button"
      >
        データ利用への同意を取り消す
      </button>
      <p className="note">同期を停止し、このブラウザの連携設定を削除します。</p>
    </details>
  )
}

function RecoveryCode({ code }: { code: string }) {
  return (
    <div className="admin-presenter-recovery" aria-live="polite">
      <p className="note">
        Presenter Bridgeのトレイアイコンから「復旧コードを入力」を開き、
        次のコードを入力してください（5分間有効）。
      </p>
      <strong className="admin-presenter-recovery-code">{code}</strong>
    </div>
  )
}

export function AdminPowerPointSyncControl({
  pdfPageCount,
  pdfPreview,
  pdfTitle,
  sync,
  showSetup,
}: AdminPowerPointSyncControlProps) {
  if (sync.phase === 'consent') {
    return <PrivacyConsentDisclosure sync={sync} />
  }

  if (sync.phase === 'idle' || sync.phase === 'error') {
    return (
      <div
        className="admin-presenter-sync"
        data-testid="powerpoint-sync-control"
      >
        <div>
          <strong>PowerPointでスライドを進める</strong>
          {!sync.message ? (
            <p className="note">
              このPCでPowerPointのスライドショーを開始して接続します。
            </p>
          ) : null}
          {sync.message ? <p className="note">{sync.message}</p> : null}
          {sync.manualRecoveryRequired && sync.manualCode ? (
            <RecoveryCode code={sync.manualCode} />
          ) : null}
        </div>
        <div className="admin-presenter-actions">
          {showSetup && PRESENTER_INSTALLER_URL ? (
            <a
              className="secondary-button"
              href={PRESENTER_INSTALLER_URL}
              rel="noopener noreferrer"
              target="_blank"
            >
              Bridgeをインストール
            </a>
          ) : showSetup ? (
            <a
              href="/presenter-bridge/index.html"
              rel="noopener noreferrer"
              target="_blank"
            >
              連携の始め方
            </a>
          ) : null}
          <button
            className="secondary-button"
            disabled={sync.busy}
            onClick={() => void sync.start()}
            type="button"
          >
            PowerPointを接続
          </button>
        </div>
        <PrivacyConsentManagement sync={sync} />
      </div>
    )
  }

  if (sync.phase === 'checking') {
    return (
      <div className="admin-presenter-sync" aria-live="polite">
        <strong>PowerPointを確認中…</strong>
        <PrivacyConsentManagement sync={sync} />
      </div>
    )
  }

  if (sync.phase === 'recovery' || sync.phase === 'activating') {
    return (
      <div
        className="admin-presenter-sync admin-presenter-recovery-panel"
        aria-live="polite"
      >
        <div>
          <strong>
            {sync.phase === 'recovery'
              ? '復旧コードで接続'
              : 'Presenter Bridgeの接続待ち'}
          </strong>
          {sync.watchingConnection ? (
            <button
              className="secondary-button"
              disabled={sync.busy}
              onClick={() => void sync.start()}
              type="button"
            >
              この画面で接続を引き継ぐ
            </button>
          ) : null}
          {sync.message ? <p className="note">{sync.message}</p> : null}
          {sync.manualRecoveryRequired && sync.manualCode ? (
            <RecoveryCode code={sync.manualCode} />
          ) : null}
        </div>
        <button
          className="secondary-button"
          disabled={sync.busy}
          onClick={sync.stop}
          type="button"
        >
          やめる
        </button>
        <PrivacyConsentManagement sync={sync} />
      </div>
    )
  }

  if (sync.phase === 'review' && sync.presentation) {
    return (
      <div className="admin-presenter-sync admin-presenter-review">
        <div className="admin-presenter-binding">
          <div>
            <span>PowerPoint</span>
            <strong>{sync.presentation.displayName}</strong>
            <small>{sync.presentation.slideCount}スライド</small>
          </div>
          <div aria-hidden="true">→</div>
          <div>
            <span>講義資料</span>
            <strong>{pdfTitle}</strong>
            <small>{pdfPageCount ?? '—'}ページ</small>
          </div>
        </div>
        {sync.manualRecoveryRequired && sync.manualCode ? (
          <RecoveryCode code={sync.manualCode} />
        ) : null}
        {pdfPreview}
        {sync.presentation.issues.length ? (
          <ul className="error-note">
            {sync.presentation.issues.map((issue) => (
              <li key={issue}>{issueLabels[issue]}</li>
            ))}
          </ul>
        ) : null}
        {sync.message ? <p className="note">{sync.message}</p> : null}
        <div className="admin-presenter-actions">
          <button
            className="primary-button"
            disabled={!sync.presentation.eligible || sync.busy}
            onClick={sync.confirm}
            type="button"
          >
            この組合せで同期する
          </button>
          <button
            className="secondary-button"
            disabled={sync.busy}
            onClick={sync.stop}
            type="button"
          >
            やめる
          </button>
        </div>
        <PrivacyConsentManagement sync={sync} />
      </div>
    )
  }

  return (
    <div
      className="admin-presenter-sync admin-presenter-active"
      aria-live="polite"
    >
      <div>
        <strong>PowerPoint同期中</strong>
        <p className="note">
          P.
          {sync.serverConnection?.lastCommittedPdfPage ??
            sync.presentation?.currentSlideIndex ??
            '—'}
          {' / '}
          {sync.serverConnection?.pdfPageCount ?? pdfPageCount ?? '—'}
        </p>
        {sync.message ? <p className="error-note">{sync.message}</p> : null}
      </div>
      <button
        className="secondary-button"
        disabled={sync.busy}
        onClick={sync.stop}
        type="button"
      >
        手動操作へ切り替える
      </button>
      <PrivacyConsentManagement sync={sync} />
    </div>
  )
}
