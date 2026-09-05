import type { AdminOperationCredentialInput } from '../../lib/adminAuth/adminOperationCredential'
import { SyncedPdfViewer } from '../DisplayView/SyncedPdfViewer'
import type { DisplayState } from '../../repositories/supabaseDisplayStateRepository'
import type { ReturnTypeOfPowerPointSync } from './adminPowerPointTypes'
import { AdminPowerPointSyncControl } from './AdminPowerPointSyncControl'

type AdminPowerPointIntegrationProps = {
  activeLectureSessionId: string
  adminToken: AdminOperationCredentialInput
  displayState: DisplayState
  sync: ReturnTypeOfPowerPointSync
  showSetup: boolean
  pdfPageCount: number | null
  pdfTitle: string
}

export function AdminPowerPointIntegration({
  activeLectureSessionId,
  adminToken,
  displayState,
  sync,
  showSetup,
  pdfPageCount,
  pdfTitle,
}: AdminPowerPointIntegrationProps) {
  return (
    <AdminPowerPointSyncControl
      pdfPageCount={pdfPageCount}
      pdfPreview={
        sync.phase === 'review' && displayState.pdfDocumentVersion ? (
          <div className="admin-presenter-first-page">
            <span>講義資料の先頭ページ</span>
            <SyncedPdfViewer
              adminToken={adminToken}
              documentId={displayState.pdfDocumentId!}
              documentVersion={displayState.pdfDocumentVersion}
              lectureSessionId={activeLectureSessionId}
              manifestVersion={displayState.pdfManifestVersion}
              pageCount={displayState.pdfPageCount}
              presenterLocked
              remotePage={1}
              viewMode="live"
              visible={displayState.pdfVisible}
            />
          </div>
        ) : undefined
      }
      pdfTitle={pdfTitle}
      sync={sync}
      showSetup={showSetup}
    />
  )
}
