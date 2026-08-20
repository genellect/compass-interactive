import { CompassStateProvider } from '../context/CompassStateContext'
import type { AdminOperationCredential } from '../lib/adminAuth/adminOperationCredential'
import type { RememberedBrowserIdentityScope } from '../lib/adminAuth/rememberedBrowserCredential'
import { AdminPage } from './AdminPage'

export default function AdminWorkspaceApp({
  adminCredential,
  identityScope,
  onAdminLogout,
}: {
  adminCredential: AdminOperationCredential
  identityScope: RememberedBrowserIdentityScope
  onAdminLogout: () => Promise<void>
}) {
  return (
    <CompassStateProvider>
      <AdminPage
        adminCredential={adminCredential}
        identityScope={identityScope}
        onAdminLogout={onAdminLogout}
      />
    </CompassStateProvider>
  )
}
