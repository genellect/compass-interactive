export type AdminOperationCredential = {
  appSessionToken: string
  kind: 'google'
}

export type AdminOperationCredentialInput = AdminOperationCredential | string

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
