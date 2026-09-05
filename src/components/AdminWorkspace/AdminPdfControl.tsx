import { useEffect, useRef, type ChangeEvent } from 'react'
import type { AdminOperationCredentialInput } from '../../lib/adminAuth/adminOperationCredential'
import type { DisplayState } from '../../repositories/supabaseDisplayStateRepository'
import { SyncedPdfViewer } from '../DisplayView/SyncedPdfViewer'

type PdfAsset = { id: string; pageCount: number; title: string }

type AdminPdfControlProps = {
  activeLectureSessionId: string | null
  adminToken: AdminOperationCredentialInput
  availableAssets: readonly PdfAsset[]
  browserPublishingEnabled: boolean
  canCreateLectureForPublication: boolean
  displayState: DisplayState | null
  displayStateError: string | null
  displayStateLoading: boolean
  manualNavigationLocked?: boolean
  lectureStatus: string
  hasInterruptedPublication: boolean
  onAbortInterruptedPublication: () => void
  onCheckPublisher: () => void
  onDisplayNameChange: (value: string) => void
  onDownloadEnabledChange: (enabled: boolean) => void
  onFileChange: (file: File | null) => void
  onPairingCodeChange: (value: string) => void
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
  view: 'material' | 'slides'
}

export function AdminPdfControl(props: AdminPdfControlProps) {
  const pdfFileInputRef = useRef<HTMLInputElement>(null)
  const {
    activeLectureSessionId,
    adminToken,
    availableAssets,
    browserPublishingEnabled,
    canCreateLectureForPublication,
    displayState,
    displayStateError,
    displayStateLoading,
    manualNavigationLocked = false,
    lectureStatus,
    hasInterruptedPublication,
    onAbortInterruptedPublication,
    onCheckPublisher,
    onDisplayNameChange,
    onDownloadEnabledChange,
    onFileChange,
    onPairingCodeChange,
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
    view,
  } = props
  const closed = lectureStatus === 'closed'
  const requiredDocumentPublished = requiredDocument
    ? availableAssets.some((asset) => asset.id === requiredDocument.documentId)
    : false
  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    onFileChange(event.target.files?.[0] ?? null)
  }

  useEffect(() => {
    if (!pdfFile && pdfFileInputRef.current) {
      pdfFileInputRef.current.value = ''
    }
  }, [pdfFile])

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
                  : 'PDFを選択（15MB・75ページ以下）'}
              </span>
              <input
                accept="application/pdf,.pdf"
                disabled={pdfPublishing || closed}
                onChange={handleFileChange}
                ref={pdfFileInputRef}
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
                  displayStateLoading || closed || manualNavigationLocked
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
              disabled={displayStateLoading || closed || manualNavigationLocked}
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
    </section>
  )
}
