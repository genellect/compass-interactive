import type { ReactNode } from 'react'
import { CompassStateProvider } from '../context/CompassStateContext'
import type { AdminOperationCredential } from '../lib/adminAuth/adminOperationCredential'
import { AdminPage } from './AdminPage'

export default function AdminWorkspaceApp({
  adminCredential,
  identitySettings,
  onAdminLogout,
}: {
  adminCredential: AdminOperationCredential
  identitySettings?: ReactNode
  onAdminLogout: () => Promise<void>
}) {
  return (
    <CompassStateProvider>
      <AdminPage
        adminCredential={adminCredential}
        identitySettings={identitySettings}
        onAdminLogout={onAdminLogout}
      />
    </CompassStateProvider>
  )
}
