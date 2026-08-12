import { clearAdminOperationRequestIds } from './adminOperationRequestId.ts'

export const ADMIN_AUTH_STORAGE_KEY =
  'compass-interactive-admin-supabase-auth-v1'
export const ADMIN_APP_SESSION_STORAGE_KEY =
  'compass-interactive-admin-google-app-session-v1'
export const ADMIN_OAUTH_ATTEMPT_STORAGE_KEY =
  'compass-interactive-admin-oauth-attempt-v1'
export const ADMIN_LEDGER_PENDING_STORAGE_KEY =
  'compass-interactive-admin-ledger-pending-v1'

const PROVIDER_TOKEN_FIELDS = new Set([
  'provider_token',
  'provider_refresh_token',
])
export const ADMIN_AUTH_REQUEST_TIMEOUT_MS = 10_000

export function stripAdminProviderTokens(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripAdminProviderTokens)
  if (!value || typeof value !== 'object') return value

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([key]) => !PROVIDER_TOKEN_FIELDS.has(key))
      .map(([key, nested]) => [key, stripAdminProviderTokens(nested)]),
  )
}

export function sanitizeAdminAuthStorageValue(value: string) {
  try {
    return JSON.stringify(stripAdminProviderTokens(JSON.parse(value)))
  } catch {
    // PKCE code verifiers are intentionally opaque, non-JSON values.
    return value
  }
}

function getRequestUrl(input: RequestInfo | URL) {
  if (typeof input === 'string') return new URL(input)
  if (input instanceof URL) return input
  return new URL(input.url)
}

export function createAdminAuthFetch(
  baseFetch: typeof fetch,
  supabaseUrl: string,
): typeof fetch {
  const expectedOrigin = new URL(supabaseUrl).origin

  return async (input, init) => {
    const requestUrl = getRequestUrl(input)
    const controller = new AbortController()
    const upstreamSignal =
      init?.signal ??
      (typeof Request !== 'undefined' && input instanceof Request
        ? input.signal
        : undefined)
    const abortFromUpstream = () => controller.abort()
    if (upstreamSignal?.aborted) controller.abort()
    else
      upstreamSignal?.addEventListener('abort', abortFromUpstream, {
        once: true,
      })
    const timeout = globalThis.setTimeout(
      () => controller.abort(),
      ADMIN_AUTH_REQUEST_TIMEOUT_MS,
    )
    let response: Response
    try {
      response = await baseFetch(input, { ...init, signal: controller.signal })
    } finally {
      globalThis.clearTimeout(timeout)
      upstreamSignal?.removeEventListener('abort', abortFromUpstream)
    }
    if (
      requestUrl.origin !== expectedOrigin ||
      !requestUrl.pathname.startsWith('/auth/v1/') ||
      !response.headers.get('content-type')?.toLowerCase().includes('json')
    ) {
      return response
    }

    let original: unknown
    try {
      original = await response.clone().json()
    } catch {
      return response
    }
    const sanitized = stripAdminProviderTokens(original)
    if (JSON.stringify(sanitized) === JSON.stringify(original)) return response

    const headers = new Headers(response.headers)
    headers.delete('content-encoding')
    headers.delete('content-length')
    return new Response(JSON.stringify(sanitized), {
      headers,
      status: response.status,
      statusText: response.statusText,
    })
  }
}

export const adminAuthStorage = {
  getItem(key: string) {
    const value = window.localStorage.getItem(key)
    if (value === null) return null
    const sanitized = sanitizeAdminAuthStorageValue(value)
    if (sanitized !== value) window.localStorage.setItem(key, sanitized)
    return sanitized
  },
  removeItem(key: string) {
    window.localStorage.removeItem(key)
  },
  setItem(key: string, value: string) {
    window.localStorage.setItem(key, sanitizeAdminAuthStorageValue(value))
  },
}

export function persistAdminAppSessionToken(token: string) {
  window.sessionStorage.setItem(ADMIN_APP_SESSION_STORAGE_KEY, token)
}

export function restoreAdminAppSessionToken() {
  return window.sessionStorage.getItem(ADMIN_APP_SESSION_STORAGE_KEY) ?? ''
}

export function clearAdminAuthStorage() {
  clearAdminOperationRequestIds()
  window.localStorage.removeItem(ADMIN_AUTH_STORAGE_KEY)
  window.localStorage.removeItem(`${ADMIN_AUTH_STORAGE_KEY}-code-verifier`)
  window.sessionStorage.removeItem(ADMIN_APP_SESSION_STORAGE_KEY)
  window.sessionStorage.removeItem(ADMIN_OAUTH_ATTEMPT_STORAGE_KEY)
  window.sessionStorage.removeItem(ADMIN_LEDGER_PENDING_STORAGE_KEY)
}

export function beginAdminOAuthAttempt() {
  const attempt = {
    callbackPath: '/admin/auth/callback',
    createdAt: Date.now(),
    id: crypto.randomUUID(),
  }
  window.sessionStorage.setItem(
    ADMIN_OAUTH_ATTEMPT_STORAGE_KEY,
    JSON.stringify(attempt),
  )
  return attempt.id
}

export function clearAdminOAuthAttempt() {
  window.sessionStorage.removeItem(ADMIN_OAUTH_ATTEMPT_STORAGE_KEY)
}

export function consumeAdminOAuthAttempt(now = Date.now()) {
  const raw = window.sessionStorage.getItem(ADMIN_OAUTH_ATTEMPT_STORAGE_KEY)
  window.sessionStorage.removeItem(ADMIN_OAUTH_ATTEMPT_STORAGE_KEY)
  if (!raw) return false
  try {
    const attempt = JSON.parse(raw) as {
      callbackPath?: unknown
      createdAt?: unknown
      id?: unknown
    }
    return Boolean(
      attempt.callbackPath === '/admin/auth/callback' &&
      typeof attempt.id === 'string' &&
      /^[0-9a-f-]{36}$/i.test(attempt.id) &&
      typeof attempt.createdAt === 'number' &&
      Number.isSafeInteger(attempt.createdAt) &&
      attempt.createdAt <= now &&
      now - attempt.createdAt <= 10 * 60 * 1000,
    )
  } catch {
    return false
  }
}

export function storageContainsProviderTokens(storage: Storage) {
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index)
    if (!key) continue
    const value = storage.getItem(key) ?? ''
    if (
      value.includes('provider_token') ||
      value.includes('provider_refresh_token')
    ) {
      return true
    }
  }
  return false
}
