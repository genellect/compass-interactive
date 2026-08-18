import { useState, type ChangeEvent, type FormEventHandler } from 'react'
import type { AdminOperationCredentialInput } from '../../lib/adminAuth/adminOperationCredential'
import { isPhase729PowerPointSyncEnabled } from '../../lib/featureFlags'
import type { DisplayState } from '../../repositories/supabaseDisplayStateRepository'
import { SyncedPdfViewer } from '../DisplayView/SyncedPdfViewer'
import { AdminPowerPointIntegration } from './AdminPowerPointIntegration'

type PdfAsset = { id: string; pageCount: number; title: string }

type AdminPdfControlProps = {
  activeLectureSessionId: string | null
  adminToken: AdminOperationCredentialInput
  availableAssets: readonly PdfAsset[]
  browserPublishingEnabled: boolean
  canCreateLectureForPublication: boolean
  displayPageInput: string
  displayState: DisplayState | null
  displayStateError: string | null
  displayStateLoading: boolean
  lectureStatus: string
  hasInterruptedPublication: boolean
  onAbortInterruptedPublication: () => void
  onCheckPublisher: () => void
  onDisplayNameChange: (value: string) => void
  onDisplayStateRefresh: () => void
  onDownloadEnabledChange: (enabled: boolean) => void
  onFileChange: (file: File | null) => void
  onGoToPage: FormEventHandler<HTMLFormElement>
  onNext: () => void
  onPageInputChange: (value: string) => void
  onPairingCodeChange: (value: string) => void
  onPrevious: () => void
  onPublish: () => void
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
  requiredDocument: {
    displayName: string
    documentId: string
    expectedByteSize: number
    expectedPageCount: number
  } | null
  selectedAsset: PdfAsset | null | undefined
  view: 'material' | 'slides'
}

export function AdminPdfControl(props: AdminPdfControlProps) {
  const {
    activeLectureSessionId,
    adminToken,
    availableAssets,
    browserPublishingEnabled,
    canCreateLectureForPublication,
    displayPageInput,
    displayState,
    displayStateError,
    displayStateLoading,
    lectureStatus,
    hasInterruptedPublication,
    onAbortInterruptedPublication,
    onCheckPublisher,
    onDisplayNameChange,
    onDisplayStateRefresh,
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
    requiredDocument,
    selectedAsset,
    view,
  } = props
  const [manualNavigationLocked, setManualNavigationLocked] = useState(false)
  const closed = lectureStatus === 'closed'
  const requiredDocumentPublished = requiredDocument
    ? availableAssets.some((asset) => asset.id === requiredDocument.documentId)
    : false
  const activePageCount = displayState?.pdfDocumentId
    ? (displayState.pdfPageCount ?? selectedAsset?.pageCount ?? null)
    : null
  const canNavigate =
    Boolean(activeLectureSessionId) &&
    Boolean(displayState?.pdfDocumentId) &&
    Boolean(displayState?.pdfVisible) &&
    Boolean(activePageCount) &&
    !displayStateLoading &&
    !manualNavigationLocked &&
    !closed

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    onFileChange(event.target.files?.[0] ?? null)
  }

  return (
    <section
      className={`panel admin-material-workspace is-${view}`}
      id="admin-live"
    >
      <div className="panel-heading">
        <h2>{view === 'material' ? '講義資料を選ぶ' : 'スライドを操作する'}</h2>
        {view === 'slides' ? (
          <span className="metric">
            現在のページ: {displayState?.currentPdfPage ?? 1}
          </span>
        ) : null}
      </div>
      <div hidden={view !== 'slides'}>
        {activeLectureSessionId && displayState?.pdfDocumentId ? (
          <div
            aria-label="講義資料のページ操作"
            className="admin-pdf-page-controller"
          >
            <button
              className="secondary-button"
              disabled={!canNavigate || displayState.currentPdfPage <= 1}
              onClick={onPrevious}
              type="button"
            >
              ← 前へ
            </button>
            <strong aria-live="polite">
              {displayState.currentPdfPage} / {activePageCount ?? '—'}
            </strong>
            <button
              className="primary-button compact"
              disabled={
                !canNavigate ||
                displayState.currentPdfPage >= (activePageCount ?? 1)
              }
              onClick={onNext}
              type="button"
            >
              次へ →
            </button>
            <form className="admin-pdf-page-jump" onSubmit={onGoToPage}>
              <label>
                <span>ページ</span>
                <input
                  aria-label="表示するページ番号"
                  disabled={!canNavigate}
                  max={activePageCount ?? 1}
                  min={1}
                  onChange={(event) => onPageInputChange(event.target.value)}
                  type="number"
                  value={displayPageInput}
                />
              </label>
              <button
                className="secondary-button compact"
                disabled={!canNavigate}
                type="submit"
              >
                移動
              </button>
            </form>
          </div>
        ) : null}
        {isPhase729PowerPointSyncEnabled &&
        activeLectureSessionId &&
        displayState?.pdfDocumentId ? (
          <AdminPowerPointIntegration
            activeLectureSessionId={activeLectureSessionId}
            adminToken={adminToken}
            displayState={displayState}
            lectureStatus={lectureStatus}
            onCommittedPage={onDisplayStateRefresh}
            onManualNavigationLockedChange={setManualNavigationLocked}
            pdfPageCount={activePageCount}
            pdfTitle={selectedAsset?.title ?? '講義資料'}
          />
        ) : null}
      </div>
      {privatePdfEnabled ? (
        <div
          className="display-control-grid publisher-control-panel"
          hidden={view !== 'material'}
        >
          <div className="panel-heading">
            <div>
              <h3>講義資料を公開する</h3>
            </div>
            <span className="metric">
              {requiredDocument
                ? requiredDocumentPublished
                  ? '講義資料は公開済み'
                  : '講義資料は未公開'
                : browserPublishingEnabled
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
              <span>
                {requiredDocument
                  ? `講義資料を選択（${requiredDocument.expectedPageCount}ページ・${(
                      requiredDocument.expectedByteSize /
                      1024 /
                      1024
                    ).toFixed(2)}MB）`
                  : 'PDFを選択（15MB・75ページ・20,000文字以下）'}
              </span>
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
                (!activeLectureSessionId && !canCreateLectureForPublication) ||
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
              {pdfPublishing
                ? '学生画面へ反映中…'
                : activeLectureSessionId
                  ? '学生に講義資料を公開する'
                  : '講義を作成して資料を公開する'}
            </button>
          </div>
          {publisherMessage ? (
            <p
              className={
                publisherMessage.includes('失敗') ? 'error-note' : 'note'
              }
            >
              {publisherMessage}
            </p>
          ) : null}
          {requiredDocument ? (
            <p className="note">講義資料: {requiredDocument.displayName}</p>
          ) : null}
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
        </div>
      ) : null}
      {activeLectureSessionId ? (
        <div className="display-control-grid">
          <div className="display-control-form pdf-document-control">
            <label className="field compact-field">
              <span>PDF資料</span>
              <select
                disabled={
                  displayStateLoading || manualNavigationLocked || closed
                }
                onChange={(event) => onSelectDocument(event.target.value)}
                value={pdfDocumentInput}
              >
                <option value="">
                  {requiredDocument && !requiredDocumentPublished
                    ? '講義資料を上の欄から公開してください'
                    : '資料を表示しない'}
                </option>
                {availableAssets.map((asset) => (
                  <option key={asset.id} value={asset.id}>
                    {asset.title}（{asset.pageCount}ページ）
                  </option>
                ))}
              </select>
            </label>
            <button
              className="secondary-button"
              disabled={displayStateLoading || manualNavigationLocked || closed}
              onClick={onSetDocument}
              type="button"
            >
              この資料を表示
            </button>
          </div>
        </div>
      ) : null}
      {activeLectureSessionId && displayState?.pdfDocumentId ? (
        <div className="admin-current-pdf-preview" hidden={view !== 'slides'}>
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
      {view === 'slides' ? (
        <p className="note">
          {closed
            ? '講義終了時点で表示していた資料とページです。'
            : '学生画面と教室表示は、教員が選んだ資料とページに自動で追従します。'}
        </p>
      ) : null}
    </section>
  )
}
