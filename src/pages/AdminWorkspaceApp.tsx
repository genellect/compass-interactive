import { CompassStateProvider } from '../context/CompassStateContext'
import type { AdminOperationCredential } from '../lib/adminAuth/adminOperationCredential'
import type { RememberedBrowserIdentityScope } from '../lib/adminAuth/rememberedBrowserCredential'
import { AdminPage } from './AdminPage'

export default function AdminWorkspaceApp({
  adminCredential,
  canManageEducators = false,
  identityScope,
  onAdminLogout,
}: {
  adminCredential: AdminOperationCredential
  canManageEducators?: boolean
  identityScope: RememberedBrowserIdentityScope
  onAdminLogout: () => Promise<void>
}) {
  return (
    <CompassStateProvider>
      <AdminPage
        adminCredential={adminCredential}
        canManageEducators={canManageEducators}
        identityScope={identityScope}
        onAdminLogout={onAdminLogout}
      />
    </CompassStateProvider>
  )
}
