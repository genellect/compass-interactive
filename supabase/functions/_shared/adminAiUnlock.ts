const encoder = new TextEncoder()
const decoder = new TextDecoder('utf-8', { fatal: true })

export const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
export const SHA256_HEX_PATTERN = /^[0-9a-f]{64}$/
export const FOUR_DIGIT_PIN_PATTERN = /^\d{4}$/
export const OPAQUE_BROWSER_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/

function bytesToHex(value: Uint8Array) {
  return Array.from(value)
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

export function bytesToBase64Url(value: Uint8Array) {
  let binary = ''
  for (const byte of value) binary += String.fromCharCode(byte)
  return btoa(binary)
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll('=', '')
}

export function base64UrlToBytes(value: string) {
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

export function createOpaqueBrowserToken() {
  return bytesToBase64Url(crypto.getRandomValues(new Uint8Array(32)))
}

async function importHmacKey(secret: string) {
  if (encoder.encode(secret).byteLength < 32) {
    throw new Error('Admin AI secret must contain at least 32 bytes.')
  }
  return crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { hash: 'SHA-256', name: 'HMAC' },
    false,
    ['sign', 'verify'],
  )
}

export async function hmacSha256Hex(secret: string, value: string) {
  const signature = await crypto.subtle.sign(
    'HMAC',
    await importHmacKey(secret),
    encoder.encode(value),
  )
  return bytesToHex(new Uint8Array(signature))
}

export async function hmacSha256Base64Url(secret: string, value: string) {
  const signature = await crypto.subtle.sign(
    'HMAC',
    await importHmacKey(secret),
    encoder.encode(value),
  )
  return bytesToBase64Url(new Uint8Array(signature))
}

export async function verifyHmacSha256Base64Url(
  secret: string,
  value: string,
  signature: string,
) {
  let signatureBytes: Uint8Array
  try {
    signatureBytes = base64UrlToBytes(signature)
  } catch {
    return false
  }
  if (signatureBytes.byteLength !== 32) return false
  return crypto.subtle.verify(
    'HMAC',
    await importHmacKey(secret),
    signatureBytes,
    encoder.encode(value),
  )
}

export async function derivePepperedPinHmac(
  pin: string,
  pepperVersion: number,
  secret: string,
) {
  if (
    !FOUR_DIGIT_PIN_PATTERN.test(pin) ||
    !Number.isSafeInteger(pepperVersion) ||
    pepperVersion < 1 ||
    pepperVersion > 2_147_483_647
  ) {
    throw new Error('Invalid Admin AI PIN input.')
  }
  return hmacSha256Hex(
    secret,
    `compass:phase7.30:ai-pin:v1|pepper_version=${pepperVersion}|pin=${pin}`,
  )
}

export function getPinControlCanonicalIntent(
  action: 'ai_pin_enroll' | 'ai_pin_rotate',
  pepperVersion: number,
  pepperedPinHmac: string,
) {
  if (!SHA256_HEX_PATTERN.test(pepperedPinHmac)) {
    throw new Error('Invalid Admin AI PIN proof.')
  }
  return (
    `compass:phase7.30:admin-control-intent:v1|action=${action}` +
    `|pin_pepper_version=${pepperVersion}` +
    `|peppered_pin_hmac=${pepperedPinHmac}`
  )
}

export function getCoarseNetworkIdentifier(request: Request) {
  const hostname = new URL(request.url).hostname
  if (hostname === '127.0.0.1' || hostname === 'localhost') {
    return 'local-development'
  }
  const candidate = (
    request.headers.get('cf-connecting-ip') ??
    request.headers.get('x-real-ip') ??
    request.headers.get('x-forwarded-for')?.split(',', 1)[0] ??
    ''
  )
    .trim()
    .toLowerCase()

  const ipv4 = candidate.split('.')
  if (
    ipv4.length === 4 &&
    ipv4.every((part) => {
      if (!/^\d{1,3}$/.test(part)) return false
      const value = Number.parseInt(part, 10)
      return value >= 0 && value <= 255 && String(value) === part
    })
  ) {
    return `ipv4:${ipv4[0]}.${ipv4[1]}.${ipv4[2]}.0/24`
  }

  if (
    candidate.includes(':') &&
    candidate.length <= 64 &&
    /^[0-9a-f:]+$/.test(candidate)
  ) {
    const groups = candidate.split(':').filter(Boolean).slice(0, 4)
    if (groups.length >= 2 && groups.every((group) => group.length <= 4)) {
      return `ipv6:${groups.join(':')}::/64`
    }
  }
  return 'network-unavailable'
}

export async function deriveNetworkHmac(request: Request, secret: string) {
  return hmacSha256Hex(
    secret,
    `compass:phase7.30:ai-network:v1|network=${getCoarseNetworkIdentifier(request)}`,
  )
}

export type PublicP256Jwk = {
  crv: 'P-256'
  kty: 'EC'
  x: string
  y: string
}

export function normalizePublicP256Jwk(value: unknown): PublicP256Jwk | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const candidate = value as Record<string, unknown>
  if (
    Object.keys(candidate).some(
      (key) => !['crv', 'ext', 'key_ops', 'kty', 'x', 'y'].includes(key),
    ) ||
    candidate.kty !== 'EC' ||
    candidate.crv !== 'P-256' ||
    typeof candidate.x !== 'string' ||
    typeof candidate.y !== 'string' ||
    !/^[A-Za-z0-9_-]{43}$/.test(candidate.x) ||
    !/^[A-Za-z0-9_-]{43}$/.test(candidate.y) ||
    'd' in candidate
  ) {
    return null
  }
  return { crv: 'P-256', kty: 'EC', x: candidate.x, y: candidate.y }
}

export function canonicalizePublicP256Jwk(jwk: PublicP256Jwk) {
  return `{"crv":"P-256","kty":"EC","x":"${jwk.x}","y":"${jwk.y}"}`
}

export async function getPublicP256JwkFingerprint(jwk: PublicP256Jwk) {
  const digest = new Uint8Array(
    await crypto.subtle.digest(
      'SHA-256',
      encoder.encode(canonicalizePublicP256Jwk(jwk)),
    ),
  )
  return bytesToHex(digest)
}

export type BrowserAssertionPayload = {
  adminSessionId: string
  authSessionId: string
  browserCredentialId: string
  challenge: string
  challengeId: string
  expiresAt: string
  lectureSessionId: string
  origin: string
  policyId: string
  policyVersion: number
  publicKeyFingerprint: string
  requestedScope: 'all_except_captions' | 'all_including_captions'
}

export function canonicalizeBrowserAssertionPayload(
  payload: BrowserAssertionPayload,
) {
  return [
    'compass:phase7.30:browser-assertion:v1',
    `admin_session_id=${payload.adminSessionId}`,
    `auth_session_id=${payload.authSessionId}`,
    `browser_credential_id=${payload.browserCredentialId}`,
    `challenge=${payload.challenge}`,
    `challenge_id=${payload.challengeId}`,
    `expires_at=${payload.expiresAt}`,
    `lecture_session_id=${payload.lectureSessionId}`,
    `origin=${payload.origin}`,
    `policy_id=${payload.policyId}`,
    `policy_version=${payload.policyVersion}`,
    `public_key_fingerprint=${payload.publicKeyFingerprint}`,
    `requested_scope=${payload.requestedScope}`,
  ].join('\n')
}

export function parseBrowserAssertionPayload(
  value: string,
): BrowserAssertionPayload | null {
  if (encoder.encode(value).byteLength > 4_096) return null
  const lines = value.split('\n')
  if (lines.length !== 13 || lines[0] !== 'compass:phase7.30:browser-assertion:v1') {
    return null
  }
  const entries = new Map<string, string>()
  for (const line of lines.slice(1)) {
    const separator = line.indexOf('=')
    if (separator <= 0) return null
    const key = line.slice(0, separator)
    const entry = line.slice(separator + 1)
    if (entries.has(key)) return null
    entries.set(key, entry)
  }
  const policyVersion = Number.parseInt(entries.get('policy_version') ?? '', 10)
  const requestedScope = entries.get('requested_scope')
  const payload = {
    adminSessionId: entries.get('admin_session_id') ?? '',
    authSessionId: entries.get('auth_session_id') ?? '',
    browserCredentialId: entries.get('browser_credential_id') ?? '',
    challenge: entries.get('challenge') ?? '',
    challengeId: entries.get('challenge_id') ?? '',
    expiresAt: entries.get('expires_at') ?? '',
    lectureSessionId: entries.get('lecture_session_id') ?? '',
    origin: entries.get('origin') ?? '',
    policyId: entries.get('policy_id') ?? '',
    policyVersion,
    publicKeyFingerprint: entries.get('public_key_fingerprint') ?? '',
    requestedScope,
  }
  if (
    !UUID_PATTERN.test(payload.adminSessionId) ||
    !UUID_PATTERN.test(payload.authSessionId) ||
    !UUID_PATTERN.test(payload.browserCredentialId) ||
    !OPAQUE_BROWSER_TOKEN_PATTERN.test(payload.challenge) ||
    !UUID_PATTERN.test(payload.challengeId) ||
    !UUID_PATTERN.test(payload.lectureSessionId) ||
    !UUID_PATTERN.test(payload.policyId) ||
    !SHA256_HEX_PATTERN.test(payload.publicKeyFingerprint) ||
    !Number.isSafeInteger(payload.policyVersion) ||
    payload.policyVersion < 1 ||
    (requestedScope !== 'all_except_captions' &&
      requestedScope !== 'all_including_captions') ||
    !Number.isFinite(Date.parse(payload.expiresAt)) ||
    !/^https?:\/\/[^/?#]+$/.test(payload.origin)
  ) {
    return null
  }
  return payload as BrowserAssertionPayload
}

export async function verifyP256P1363Signature(
  jwk: PublicP256Jwk,
  payload: string,
  signature: string,
) {
  let signatureBytes: Uint8Array
  try {
    signatureBytes = base64UrlToBytes(signature)
  } catch {
    return false
  }
  if (signatureBytes.byteLength !== 64) return false
  try {
    const key = await crypto.subtle.importKey(
      'jwk',
      { ...jwk, ext: true, key_ops: ['verify'] },
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['verify'],
    )
    return crypto.subtle.verify(
      { hash: 'SHA-256', name: 'ECDSA' },
      key,
      signatureBytes,
      encoder.encode(payload),
    )
  } catch {
    return false
  }
}

export function decodeUtf8(value: Uint8Array) {
  return decoder.decode(value)
}
