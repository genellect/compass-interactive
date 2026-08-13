export type AdminOperationCredential = {
  appSessionToken: string
  kind: 'google'
}

// Phase 7.30E removes the shared-PIN transport. Keep the compatibility type
// name while making every Admin operation require the Google app session.
export type AdminOperationCredentialInput = AdminOperationCredential

export function createGoogleAdminCredential(
  appSessionToken: string,
): AdminOperationCredential {
  return { appSessionToken, kind: 'google' }
}

export function getAdminOperationCredentialBody(
  credential: AdminOperationCredential,
) {
  return { appSessionToken: credential.appSessionToken }
}

export function isAdminOperationCredential(
  value: unknown,
): value is AdminOperationCredential {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<AdminOperationCredential>
  return (
    candidate.kind === 'google' &&
    typeof candidate.appSessionToken === 'string' &&
    candidate.appSessionToken.length > 0
  )
}

export function isGoogleAdminOperationCredential(
  value: unknown,
): value is AdminOperationCredential {
  return isAdminOperationCredential(value)
}
