import { clearAdminOperationRequestIds } from './adminOperationRequestId.ts'

export const ADMIN_AUTH_STORAGE_KEY =
  'compass-interactive-admin-supabase-auth-v1'
export const ADMIN_APP_SESSION_STORAGE_KEY =
  'compass-interactive-admin-google-app-session-v1'
export const ADMIN_APP_SESSION_RESTORE_SEED_STORAGE_KEY =
  'compass-interactive-admin-google-app-session-restore-seed-v1'
export const ADMIN_OAUTH_ATTEMPT_STORAGE_KEY =
  'compass-interactive-admin-oauth-attempt-v1'
export const ADMIN_LEDGER_PENDING_STORAGE_KEY =
  'compass-interactive-admin-ledger-pending-v1'
export const ADMIN_AI_POLICY_PENDING_STORAGE_KEY =
  'compass-interactive-admin-ai-policy-pending-v1'

const ADMIN_INVITATION_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/
const ADMIN_AUTH_CODE_VERIFIER_STORAGE_KEY = `${ADMIN_AUTH_STORAGE_KEY}-code-verifier`

const PROVIDER_TOKEN_FIELDS = new Set([
  'provider_token',
  'provider_refresh_token',
])
export const ADMIN_AUTH_REQUEST_TIMEOUT_MS = 10_000
let adminAuthRateLimitUntil = 0

function parseRetryAfterMs(value: string | null, now = Date.now()) {
  if (!value) return 0
  const seconds = Number(value)
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(
      Math.max(1_000, Math.ceil(seconds * 1_000)),
      60 * 60 * 1_000,
    )
  }
  const retryAt = Date.parse(value)
  return Number.isFinite(retryAt)
    ? Math.min(Math.max(1_000, retryAt - now), 60 * 60 * 1_000)
    : 0
}

export function getAdminAuthRateLimitRemainingMs(now = Date.now()) {
  return Math.max(0, adminAuthRateLimitUntil - now)
}

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
    // This client also invokes Edge Functions, whose callers own longer deadlines.
    if (
      requestUrl.origin !== expectedOrigin ||
      !requestUrl.pathname.startsWith('/auth/v1/')
    ) {
      return baseFetch(input, init)
    }
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
    if (response.status === 429) {
      const retryAfterMs = parseRetryAfterMs(
        response.headers.get('retry-after'),
      )
      adminAuthRateLimitUntil = Math.max(
        adminAuthRateLimitUntil,
        Date.now() + (retryAfterMs || 60_000),
      )
    }
    if (!response.headers.get('content-type')?.toLowerCase().includes('json')) {
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
    const storage =
      key === ADMIN_AUTH_CODE_VERIFIER_STORAGE_KEY
        ? window.sessionStorage
        : window.localStorage
    const value = storage.getItem(key)
    if (value === null) return null
    const sanitized = sanitizeAdminAuthStorageValue(value)
    if (sanitized !== value) storage.setItem(key, sanitized)
    return sanitized
  },
  removeItem(key: string) {
    const storage =
      key === ADMIN_AUTH_CODE_VERIFIER_STORAGE_KEY
        ? window.sessionStorage
        : window.localStorage
    storage.removeItem(key)
  },
  setItem(key: string, value: string) {
    const storage =
      key === ADMIN_AUTH_CODE_VERIFIER_STORAGE_KEY
        ? window.sessionStorage
        : window.localStorage
    storage.setItem(key, sanitizeAdminAuthStorageValue(value))
  },
}

export function persistAdminAppSessionToken(token: string) {
  window.sessionStorage.setItem(ADMIN_APP_SESSION_STORAGE_KEY, token)
}

export function restoreAdminAppSessionToken() {
  return window.sessionStorage.getItem(ADMIN_APP_SESSION_STORAGE_KEY) ?? ''
}

export function clearAdminAppSessionToken() {
  window.sessionStorage.removeItem(ADMIN_APP_SESSION_STORAGE_KEY)
}

type AdminAppSessionRestoreScope = {
  authSessionId: string
  authUserId: string
}

export function persistAdminAppSessionRestoreSeed(
  seed: string,
  scope: AdminAppSessionRestoreScope,
) {
  window.localStorage.setItem(
    ADMIN_APP_SESSION_RESTORE_SEED_STORAGE_KEY,
    JSON.stringify({ ...scope, seed, version: 1 }),
  )
}

export function restoreAdminAppSessionRestoreSeed(
  scope: AdminAppSessionRestoreScope,
) {
  const raw = window.localStorage.getItem(
    ADMIN_APP_SESSION_RESTORE_SEED_STORAGE_KEY,
  )
  if (!raw) return ''
  try {
    const stored = JSON.parse(raw) as {
      authSessionId?: unknown
      authUserId?: unknown
      seed?: unknown
      version?: unknown
    }
    if (
      stored.version === 1 &&
      stored.authSessionId === scope.authSessionId &&
      stored.authUserId === scope.authUserId &&
      typeof stored.seed === 'string' &&
      /^[A-Za-z0-9_-]{43}$/.test(stored.seed)
    ) {
      return stored.seed
    }
  } catch {
    // A malformed or old restore seed cannot authorize anything and is purged.
  }
  clearAdminAppSessionRestoreSeed()
  return ''
}

export function clearAdminAppSessionRestoreSeed() {
  window.localStorage.removeItem(ADMIN_APP_SESSION_RESTORE_SEED_STORAGE_KEY)
}

export function handoffAdminAppSessionToken(target: Window) {
  const token = restoreAdminAppSessionToken()
  if (!token) return { changed: false, handedOff: false }
  const previousToken = target.sessionStorage.getItem(
    ADMIN_APP_SESSION_STORAGE_KEY,
  )
  target.sessionStorage.setItem(ADMIN_APP_SESSION_STORAGE_KEY, token)
  return { changed: previousToken !== token, handedOff: true }
}

export function clearAdminTabWorkspaceStorage() {
  clearAdminOperationRequestIds()
  clearAdminAppSessionToken()
  window.sessionStorage.removeItem(ADMIN_LEDGER_PENDING_STORAGE_KEY)
  window.sessionStorage.removeItem(ADMIN_AI_POLICY_PENDING_STORAGE_KEY)
}

export function clearAdminAuthStorage() {
  clearAdminTabWorkspaceStorage()
  window.localStorage.removeItem(ADMIN_AUTH_STORAGE_KEY)
  window.localStorage.removeItem(`${ADMIN_AUTH_STORAGE_KEY}-user`)
  window.localStorage.removeItem(ADMIN_AUTH_CODE_VERIFIER_STORAGE_KEY)
  window.sessionStorage.removeItem(ADMIN_AUTH_CODE_VERIFIER_STORAGE_KEY)
  window.localStorage.removeItem(ADMIN_APP_SESSION_RESTORE_SEED_STORAGE_KEY)
  window.sessionStorage.removeItem(ADMIN_OAUTH_ATTEMPT_STORAGE_KEY)
}

const ADMIN_RETURN_PATHS = new Set(['/admin', '/admin/settings'])

export type AdminInvitationFragment =
  | { kind: 'absent'; token: '' }
  | { kind: 'invalid'; token: '' }
  | { kind: 'valid'; token: string }

export function parseAdminInvitationFragment(
  hash: string,
): AdminInvitationFragment {
  if (!hash || hash === '#') return { kind: 'absent', token: '' }
  if (!hash.startsWith('#invite')) return { kind: 'absent', token: '' }
  const match = /^#invite=([A-Za-z0-9_-]{43})$/.exec(hash)
  return match
    ? { kind: 'valid', token: match[1]! }
    : { kind: 'invalid', token: '' }
}

export function captureAdminInvitationFragment() {
  const invitation = parseAdminInvitationFragment(window.location.hash)
  if (invitation.kind !== 'absent') {
    window.history.replaceState(
      {},
      '',
      `${window.location.pathname}${window.location.search}`,
    )
  }
  return invitation
}

export function beginAdminOAuthAttempt(
  returnPath = '/admin',
  invitationToken = '',
) {
  const safeReturnPath = ADMIN_RETURN_PATHS.has(returnPath)
    ? returnPath
    : '/admin'
  const safeInvitationToken = ADMIN_INVITATION_TOKEN_PATTERN.test(
    invitationToken,
  )
    ? invitationToken
    : ''
  const attempt = {
    callbackPath: '/admin/auth/callback',
    createdAt: Date.now(),
    id: crypto.randomUUID(),
    ...(safeInvitationToken ? { invitationToken: safeInvitationToken } : {}),
    returnPath: safeReturnPath,
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
  if (!raw) return null
  try {
    const attempt = JSON.parse(raw) as {
      callbackPath?: unknown
      createdAt?: unknown
      id?: unknown
      invitationToken?: unknown
      returnPath?: unknown
    }
    const returnPath =
      attempt.returnPath === undefined ? '/admin' : attempt.returnPath
    const valid = Boolean(
      attempt.callbackPath === '/admin/auth/callback' &&
      typeof attempt.id === 'string' &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        attempt.id,
      ) &&
      typeof attempt.createdAt === 'number' &&
      Number.isSafeInteger(attempt.createdAt) &&
      attempt.createdAt <= now &&
      now - attempt.createdAt <= 10 * 60 * 1000 &&
      (attempt.invitationToken === undefined ||
        (typeof attempt.invitationToken === 'string' &&
          ADMIN_INVITATION_TOKEN_PATTERN.test(attempt.invitationToken))) &&
      typeof returnPath === 'string' &&
      ADMIN_RETURN_PATHS.has(returnPath),
    )
    return valid
      ? {
          id: attempt.id as string,
          invitationToken:
            typeof attempt.invitationToken === 'string'
              ? attempt.invitationToken
              : '',
          returnPath: returnPath as string,
        }
      : null
  } catch {
    return null
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
