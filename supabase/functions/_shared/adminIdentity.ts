const encoder = new TextEncoder()
const decoder = new TextDecoder('utf-8', { fatal: true })

export const GOOGLE_ISSUER = 'https://accounts.google.com'
export const GOOGLE_ADMIN_SESSION_PREFIX = 'g1.'
export const ADMIN_LOGIN_NONCE_BYTES = 32

export type AdminAuthMethod = {
  method?: unknown
  timestamp?: unknown
}

export type VerifiedAdminJwtClaims = {
  aal: 'aal1' | 'aal2'
  amr: Array<{ method: string; timestamp: number }>
  audience: string[]
  expiresAt: number
  issuedAt: number
  issuer: string
  sessionId: string
  subject: string
}

type TrustedIdentity = {
  id?: unknown
  identity_data?: Record<string, unknown> | null
  identity_id?: unknown
  provider?: unknown
}

export type TrustedGoogleIdentity = {
  displayName: string | null
  email: string
  issuer: typeof GOOGLE_ISSUER
  subject: string
}

function base64UrlToBytes(value: string) {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new Error('Invalid base64url value.')
  }
  const base64 = value.replaceAll('-', '+').replaceAll('_', '/')
  const padded = base64.padEnd(
    base64.length + ((4 - (base64.length % 4)) % 4),
    '=',
  )
  const binary = atob(padded)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }
  return bytes
}

function bytesToBase64Url(value: Uint8Array) {
  let binary = ''
  for (const byte of value) binary += String.fromCharCode(byte)
  return btoa(binary)
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll('=', '')
}

function bytesToHex(value: Uint8Array) {
  return Array.from(value)
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

function isUuid(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    )
  )
}

function normalizeAudience(value: unknown) {
  if (typeof value === 'string' && value) return [value]
  if (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((item) => typeof item === 'string' && item.length > 0)
  ) {
    return value as string[]
  }
  return []
}

export function decodeVerifiedAdminJwtClaims(
  jwt: string,
  nowSeconds = Math.floor(Date.now() / 1000),
): VerifiedAdminJwtClaims | null {
  const [header, payload, signature, extra] = jwt.split('.')
  if (!header || !payload || !signature || extra) return null

  try {
    const decoded = JSON.parse(decoder.decode(base64UrlToBytes(payload))) as {
      aal?: unknown
      amr?: AdminAuthMethod[]
      aud?: unknown
      exp?: unknown
      iat?: unknown
      iss?: unknown
      session_id?: unknown
      sub?: unknown
    }
    const audience = normalizeAudience(decoded.aud)
    const amr = Array.isArray(decoded.amr)
      ? decoded.amr.flatMap((entry) =>
          entry &&
          typeof entry.method === 'string' &&
          typeof entry.timestamp === 'number' &&
          Number.isSafeInteger(entry.timestamp) &&
          entry.timestamp > 0
            ? [{ method: entry.method, timestamp: entry.timestamp }]
            : [],
        )
      : []

    if (
      (decoded.aal !== 'aal1' && decoded.aal !== 'aal2') ||
      typeof decoded.sub !== 'string' ||
      !decoded.sub ||
      typeof decoded.iss !== 'string' ||
      !decoded.iss ||
      !isUuid(decoded.session_id) ||
      typeof decoded.iat !== 'number' ||
      !Number.isSafeInteger(decoded.iat) ||
      decoded.iat > nowSeconds + 60 ||
      typeof decoded.exp !== 'number' ||
      !Number.isSafeInteger(decoded.exp) ||
      decoded.exp <= nowSeconds ||
      audience.length === 0
    ) {
      return null
    }

    return {
      aal: decoded.aal,
      amr,
      audience,
      expiresAt: decoded.exp,
      issuedAt: decoded.iat,
      issuer: decoded.iss,
      sessionId: decoded.session_id,
      subject: decoded.sub,
    }
  } catch {
    return null
  }
}

export function hasOAuthAmr(claims: VerifiedAdminJwtClaims) {
  return claims.amr.some(({ method }) => method === 'oauth')
}

export function getFreshTotpAmrTimestamp(
  claims: VerifiedAdminJwtClaims,
): number | null {
  const timestamps = claims.amr
    .filter(({ method }) => method === 'totp' || method === 'mfa/totp')
    .map(({ timestamp }) => timestamp)
  return timestamps.length > 0 ? Math.max(...timestamps) : null
}

function canonicalizeGoogleIssuer(value: unknown) {
  return value === GOOGLE_ISSUER || value === 'accounts.google.com'
    ? GOOGLE_ISSUER
    : null
}

function normalizeVerifiedEmail(value: unknown) {
  if (typeof value !== 'string') return null
  const normalized = value.normalize('NFKC').trim().toLowerCase()
  if (
    normalized.length < 3 ||
    normalized.length > 320 ||
    !normalized.includes('@') ||
    Array.from(normalized).some((character) => {
      const code = character.charCodeAt(0)
      return code <= 0x1f || code === 0x7f
    })
  ) {
    return null
  }
  return normalized
}

export function getTrustedGoogleIdentity(
  identities: TrustedIdentity[] | null | undefined,
): TrustedGoogleIdentity | null {
  const googleIdentities = (identities ?? []).filter(
    (identity) => identity.provider === 'google',
  )
  if (googleIdentities.length !== 1) return null

  const identity = googleIdentities[0]
  const data = identity.identity_data ?? {}
  const subject = typeof data.sub === 'string' ? data.sub.trim() : ''
  const providerSubject =
    typeof identity.id === 'string' ? identity.id.trim() : ''
  const dataProviderId =
    typeof data.provider_id === 'string' ? data.provider_id.trim() : ''
  const email = normalizeVerifiedEmail(data.email)
  const issuer = canonicalizeGoogleIssuer(data.iss ?? GOOGLE_ISSUER)
  const emailVerified = data.email_verified === true

  if (
    !subject ||
    subject.length > 255 ||
    !email ||
    !emailVerified ||
    !issuer ||
    providerSubject !== subject ||
    (dataProviderId && dataProviderId !== subject)
  ) {
    return null
  }

  const rawDisplayName =
    typeof data.full_name === 'string'
      ? data.full_name
      : typeof data.name === 'string'
        ? data.name
        : ''
  const displayName = rawDisplayName.normalize('NFKC').trim().slice(0, 160)

  return {
    displayName: displayName || null,
    email,
    issuer,
    subject,
  }
}

async function importHmacKey(secret: string) {
  if (encoder.encode(secret).byteLength < 32) {
    throw new Error('Phase 7.30 secret must contain at least 32 bytes.')
  }
  return crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { hash: 'SHA-256', name: 'HMAC' },
    false,
    ['sign'],
  )
}

export async function sha256Hex(value: string) {
  return bytesToHex(
    new Uint8Array(
      await crypto.subtle.digest('SHA-256', encoder.encode(value)),
    ),
  )
}

export async function hmacIdentityValue(
  value: string,
  secret: string,
  domain: 'email' | 'subject',
) {
  const signature = await crypto.subtle.sign(
    'HMAC',
    await importHmacKey(secret),
    encoder.encode(`phase730:${domain}:${value}`),
  )
  return bytesToHex(new Uint8Array(signature))
}

export async function createGoogleAdminSessionToken(
  rawNonce: string,
  adminSessionSecret: string,
) {
  assertAdminLoginNonce(rawNonce)
  const signature = await crypto.subtle.sign(
    'HMAC',
    await importHmacKey(adminSessionSecret),
    encoder.encode(`phase730:google-session:${rawNonce}`),
  )
  return `${GOOGLE_ADMIN_SESSION_PREFIX}${bytesToBase64Url(
    new Uint8Array(signature),
  )}`
}

export function assertAdminLoginNonce(value: string) {
  const bytes = base64UrlToBytes(value)
  if (bytes.byteLength !== ADMIN_LOGIN_NONCE_BYTES) {
    throw new Error('Invalid Admin login nonce.')
  }
  return value
}

export function createAdminLoginNonce() {
  const bytes = crypto.getRandomValues(new Uint8Array(ADMIN_LOGIN_NONCE_BYTES))
  return bytesToBase64Url(bytes)
}

export function isGoogleAdminSessionToken(value: string) {
  if (!value.startsWith(GOOGLE_ADMIN_SESSION_PREFIX)) return false
  try {
    return (
      base64UrlToBytes(value.slice(GOOGLE_ADMIN_SESSION_PREFIX.length))
        .byteLength === 32
    )
  } catch {
    return false
  }
}

export function readSecret(name: string) {
  const value =
    typeof Deno === 'undefined' ? undefined : Deno.env.get(name)?.trim()
  if (!value || encoder.encode(value).byteLength < 32) {
    throw new Error(`${name} must contain at least 32 bytes.`)
  }
  return value
}
