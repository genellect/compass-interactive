/** An unavailable Auth service cannot establish that a session was revoked. */
export function isAdminAuthServiceUnavailable(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const candidate = error as { name?: unknown; status?: unknown }
  const status = candidate.status
  return (
    status === 429 ||
    (typeof status === 'number' && status >= 500 && status <= 599) ||
    (candidate.name === 'AuthRetryableFetchError' &&
      (status === undefined || status === 0))
  )
}
