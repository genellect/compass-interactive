import type { ChangeEvent, FormEventHandler } from 'react'
import type { DisplayState } from '../../repositories/supabaseDisplayStateRepository'
import { SyncedPdfViewer } from '../DisplayView/SyncedPdfViewer'

type PdfAsset = { id: string; pageCount: number; title: string }

type AdminPdfControlProps = {
  activeLectureSessionId: string | null
  adminToken: string
  availableAssets: readonly PdfAsset[]
  browserPublishingEnabled: boolean
  displayPageInput: string
  displayState: DisplayState | null
  displayStateError: string | null
  displayStateLoading: boolean
  lectureStatus: string
  hasInterruptedPublication: boolean
  onAbortInterruptedPublication: () => void
  onCheckPublisher: () => void
  onDisplayNameChange: (value: string) => void
  onDownloadEnabledChange: (enabled: boolean) => void
  onFileChange: (file: File | null) => void
  onGoToPage: FormEventHandler<HTMLFormElement>
  onNext: () => void
  onPageInputChange: (value: string) => void
  onPairingCodeChange: (value: string) => void
  onPrevious: () => void
  onPublish: () => void
  onPublishWithLocalPublisher: () => void
  onSelectDocument: (documentId: string) => void
  onSetDocument: () => void
  pdfDisplayName: string
  pdfDocumentInput: string
  pdfDownloadEnabled: boolean
  pdfFile: File | null
  pdfPublishing: boolean
  privatePdfEnabled: boolean
  publisherMessage: string
  publisherPairingCode: string
  publisherSessionToken: string
  publisherStatus: 'checking' | 'connected' | 'disconnected' | 'paired'
  selectedAsset: PdfAsset | null | undefined
}

export function AdminPdfControl(props: AdminPdfControlProps) {
  const {
    activeLectureSessionId,
    adminToken,
    availableAssets,
    browserPublishingEnabled,
    displayPageInput,
    displayState,
    displayStateError,
    displayStateLoading,
    lectureStatus,
    hasInterruptedPublication,
    onAbortInterruptedPublication,
    onCheckPublisher,
    onDisplayNameChange,
    onDownloadEnabledChange,
    onFileChange,
    onGoToPage,
    onNext,
    onPageInputChange,
    onPairingCodeChange,
    onPrevious,
    onPublish,
    onSelectDocument,
    onSetDocument,
    pdfDisplayName,
    pdfDocumentInput,
    pdfDownloadEnabled,
    pdfFile,
    pdfPublishing,
    privatePdfEnabled,
    publisherMessage,
    publisherPairingCode,
    publisherSessionToken,
    publisherStatus,
    selectedAsset,
  } = props
  const closed = lectureStatus === 'closed'

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    onFileChange(event.target.files?.[0] ?? null)
  }

  return (
    <section className="panel" id="admin-live">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">LIVE MATERIAL</p>
          <h2>講義資料を操作する</h2>
        </div>
        <span className="metric">
          現在のページ: {displayState?.currentPdfPage ?? 1}
        </span>
      </div>
      {privatePdfEnabled ? (
        <div className="display-control-grid publisher-control-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">LECTURE MATERIAL</p>
              <h3>講義資料を公開する</h3>
            </div>
            <span className="metric">
              {browserPublishingEnabled
                ? 'ブラウザから公開できます'
                : publisherStatus === 'paired'
                  ? '公開できます'
                  : publisherStatus === 'connected'
                    ? '初回確認が必要'
                    : publisherStatus === 'checking'
                      ? '準備を確認中'
                      : '公開アプリを確認'}
            </span>
          </div>
          {!browserPublishingEnabled && publisherStatus !== 'paired' ? (
            <details className="admin-publisher-setup">
              <summary>初回接続の設定</summary>
              <div className="display-control-form">
                <label className="field compact-field">
                  <span>教員PCに表示された8桁コード</span>
                  <input
                    autoComplete="off"
                    disabled={pdfPublishing}
                    inputMode="numeric"
                    maxLength={8}
                    onChange={(event) =>
                      onPairingCodeChange(event.target.value.replace(/\D/g, ''))
                    }
                    value={publisherPairingCode}
                  />
                </label>
                <button
                  className="secondary-button"
                  disabled={publisherStatus === 'checking' || pdfPublishing}
                  onClick={onCheckPublisher}
                  type="button"
                >
                  公開準備を再確認
                </button>
              </div>
            </details>
          ) : null}
          <div className="display-control-form">
            <label className="field compact-field">
              <span>PDFを選択（15MB・75ページ・20,000文字以下）</span>
              <input
                accept="application/pdf,.pdf"
                disabled={pdfPublishing || closed}
                onChange={handleFileChange}
                type="file"
              />
            </label>
            <label className="field compact-field">
              <span>学生に表示する資料名</span>
              <input
                disabled={pdfPublishing}
                maxLength={160}
                onChange={(event) => onDisplayNameChange(event.target.value)}
                value={pdfDisplayName}
              />
            </label>
            <label className="field compact-field">
              <span>ダウンロード</span>
              <select
                disabled={pdfPublishing}
                onChange={(event) =>
                  onDownloadEnabledChange(event.target.value === 'enabled')
                }
                value={pdfDownloadEnabled ? 'enabled' : 'disabled'}
              >
                <option value="enabled">学生に許可する</option>
                <option value="disabled">閲覧のみ</option>
              </select>
            </label>
            <button
              className="primary-button"
              disabled={
                !pdfFile ||
                pdfPublishing ||
                closed ||
                (!browserPublishingEnabled &&
                  !publisherSessionToken &&
                  publisherPairingCode.trim().length !== 8)
              }
              onClick={onPublish}
              type="button"
            >
              {pdfPublishing ? '学生画面へ反映中…' : '学生に講義資料を公開する'}
            </button>
          </div>
          <p
            className={
              publisherMessage.includes('失敗') ? 'error-note' : 'note'
            }
          >
            {publisherMessage || 'PDFを選択して公開してください。'}
          </p>
          {browserPublishingEnabled && hasInterruptedPublication ? (
            <button
              className="secondary-button"
              disabled={pdfPublishing}
              onClick={onAbortInterruptedPublication}
              type="button"
            >
              中断した公開を破棄してやり直す
            </button>
          ) : null}
          <p className="note">
            大きい資料は公開やAI分析に時間と費用がかかります。可能な範囲で圧縮してください。
          </p>
        </div>
      ) : null}
      {!activeLectureSessionId ? (
        <p className="note">講義へ参加後、共有画面を操作できます。</p>
      ) : (
        <div className="display-control-grid">
          <div className="display-control-form pdf-document-control">
            <label className="field compact-field">
              <span>PDF資料</span>
              <select
                disabled={displayStateLoading || closed}
                onChange={(event) => onSelectDocument(event.target.value)}
                value={pdfDocumentInput}
              >
                <option value="">資料を表示しない</option>
                {availableAssets.map((asset) => (
                  <option key={asset.id} value={asset.id}>
                    {asset.title}（{asset.pageCount}ページ）
                  </option>
                ))}
              </select>
            </label>
            <button
              className="secondary-button"
              disabled={displayStateLoading || closed}
              onClick={onSetDocument}
              type="button"
            >
              この資料を表示
            </button>
          </div>
          <div className="display-control-actions">
            <button
              className="secondary-button"
              disabled={
                displayStateLoading ||
                closed ||
                !selectedAsset ||
                (displayState?.currentPdfPage ?? 1) <= 1
              }
              onClick={onPrevious}
              type="button"
            >
              前へ
            </button>
            <button
              className="secondary-button"
              disabled={
                displayStateLoading ||
                closed ||
                !selectedAsset ||
                (displayState?.currentPdfPage ?? 1) >= selectedAsset.pageCount
              }
              onClick={onNext}
              type="button"
            >
              次へ
            </button>
          </div>
          <form className="display-control-form" onSubmit={onGoToPage}>
            <label className="field compact-field">
              <span>ページ番号</span>
              <input
                disabled={displayStateLoading || closed}
                max={selectedAsset?.pageCount ?? 1}
                min={1}
                onChange={(event) => onPageInputChange(event.target.value)}
                type="number"
                value={displayPageInput}
              />
            </label>
            <button
              className="secondary-button"
              disabled={displayStateLoading || closed || !selectedAsset}
              type="submit"
            >
              移動
            </button>
          </form>
        </div>
      )}
      {activeLectureSessionId && displayState?.pdfDocumentId ? (
        <div className="admin-current-pdf-preview">
          <h3>現在、学生に表示しているページ</h3>
          <SyncedPdfViewer
            adminToken={adminToken}
            documentId={displayState.pdfDocumentId}
            documentVersion={displayState.pdfDocumentVersion}
            lectureSessionId={activeLectureSessionId}
            manifestVersion={displayState.pdfManifestVersion}
            pageCount={displayState.pdfPageCount}
            presenterLocked
            remotePage={displayState.currentPdfPage}
            viewMode={closed ? 'closed' : 'live'}
            visible={displayState.pdfVisible}
          />
        </div>
      ) : null}
      {displayStateError ? (
        <p className="error-note">{displayStateError}</p>
      ) : null}
      <p className="note">
        {closed
          ? '講義終了時点で表示していた資料とページです。'
          : '学生画面と教室表示は、教員が選んだ資料とページに自動で追従します。'}
      </p>
    </section>
  )
}
