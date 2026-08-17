import { CompassStateProvider } from '../context/CompassStateContext'
import type { AdminOperationCredential } from '../lib/adminAuth/adminOperationCredential'
import { AdminPage } from './AdminPage'

export default function AdminWorkspaceApp({
  adminCredential,
  onAdminLogout,
}: {
  adminCredential: AdminOperationCredential
  onAdminLogout: () => Promise<void>
}) {
  return (
    <CompassStateProvider>
      <AdminPage
        adminCredential={adminCredential}
        onAdminLogout={onAdminLogout}
      />
    </CompassStateProvider>
  )
}
