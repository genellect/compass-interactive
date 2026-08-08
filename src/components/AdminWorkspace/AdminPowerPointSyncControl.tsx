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
    'スライドショーをウィンドウ表示にしてください。',
}

type AdminPowerPointSyncControlProps = {
  pdfPageCount: number | null
  pdfPreview?: ReactNode
  pdfTitle: string
  sync: ReturnTypeOfPowerPointSync
}

export function AdminPowerPointSyncControl({
  pdfPageCount,
  pdfPreview,
  pdfTitle,
  sync,
}: AdminPowerPointSyncControlProps) {
  if (sync.phase === 'idle' || sync.phase === 'error') {
    return (
      <div
        className="admin-presenter-sync"
        data-testid="powerpoint-sync-control"
      >
        <div>
          <strong>PowerPointと同期</strong>
          {sync.message ? <p className="note">{sync.message}</p> : null}
        </div>
        <button className="secondary-button" onClick={sync.start} type="button">
          PowerPointと同期
        </button>
        {sync.manualCode ? (
          <details>
            <summary>接続できない場合</summary>
            <p className="note">
              Presenter Bridgeに次の復旧コードを入力してください：
              <strong>{sync.manualCode}</strong>
            </p>
          </details>
        ) : null}
      </div>
    )
  }

  if (sync.phase === 'checking') {
    return (
      <div className="admin-presenter-sync" aria-live="polite">
        <strong>PowerPointを確認しています…</strong>
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
          <div aria-hidden="true">↔</div>
          <div>
            <span>講義資料</span>
            <strong>{pdfTitle}</strong>
            <small>{pdfPageCount ?? '—'}ページ</small>
          </div>
        </div>
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
            disabled={!sync.presentation.eligible}
            onClick={sync.confirm}
            type="button"
          >
            このPowerPointと講義資料を同期
          </button>
          <button
            className="secondary-button"
            onClick={sync.stop}
            type="button"
          >
            やめる
          </button>
        </div>
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
      <button className="secondary-button" onClick={sync.stop} type="button">
        手動操作に切り替える
      </button>
    </div>
  )
}
