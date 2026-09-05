import { useLayoutEffect } from 'react'
import { AdminPowerPointIntegration } from './AdminPowerPointIntegration'
import { useAdminPowerPointSync } from './useAdminPowerPointSync'

type AdminPowerPointControllerProps = Parameters<
  typeof useAdminPowerPointSync
>[0] & {
  onManualNavigationLockChange: (locked: boolean) => void
  pdfPageCount: number | null
  pdfTitle: string
  showSetup: boolean
}

// Keep the controller mounted at the AdminPage level even when its optional
// controls are hidden. Switching workspace panels must not stop native sync.
export default function AdminPowerPointController({
  onManualNavigationLockChange,
  pdfPageCount,
  pdfTitle,
  showSetup,
  ...input
}: AdminPowerPointControllerProps) {
  const sync = useAdminPowerPointSync(input)
  useLayoutEffect(() => {
    onManualNavigationLockChange(sync.manualNavigationLocked)
    return () => onManualNavigationLockChange(false)
  }, [onManualNavigationLockChange, sync.manualNavigationLocked])

  if (
    !input.activeLectureSessionId ||
    !input.displayState?.pdfDocumentId ||
    (!showSetup &&
      ['idle', 'error'].includes(sync.phase) &&
      !sync.hasConnection)
  )
    return null

  return (
    <AdminPowerPointIntegration
      activeLectureSessionId={input.activeLectureSessionId}
      adminToken={input.adminToken}
      displayState={input.displayState}
      pdfPageCount={pdfPageCount}
      pdfTitle={pdfTitle}
      sync={sync}
      showSetup={showSetup}
    />
  )
}
