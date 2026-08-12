import { getAdminTokenSecret, timingSafeEqual } from './adminToken.ts'

const DISPLAY_TOKEN_SCOPE = 'compass-display'
const DISPLAY_TOKEN_AUDIENCE = 'operator-live-snapshot'
const MAX_TOKEN_TTL_SECONDS = 95 * 60
const TERMINAL_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60
const textDecoder = new TextDecoder()
const textEncoder = new TextEncoder()

export type DisplayTokenClaims = {
  aud: typeof DISPLAY_TOKEN_AUDIENCE
  exp: number
  iat: number
  jti: string
  lectureSessionId: string
  scope: typeof DISPLAY_TOKEN_SCOPE
  terminalExp: number
}

function base64UrlToBytes(value: string) {
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

function base64UrlEncode(value: string | Uint8Array) {
  const bytes = typeof value === 'string' ? textEncoder.encode(value) : value
  let binary = ''

  for (const byte of bytes) {
    binary += String.fromCharCode(byte)
  }

  return btoa(binary)
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll('=', '')
}

async function signToken(payload: string, secret: string) {
  const key = await crypto.subtle.importKey(
    'raw',
    textEncoder.encode(secret),
    { hash: 'SHA-256', name: 'HMAC' },
    false,
    ['sign'],
  )
  const signature = await crypto.subtle.sign(
    'HMAC',
    key,
    textEncoder.encode(payload),
  )

  return base64UrlEncode(new Uint8Array(signature))
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  )
}

export function getDisplayTokenSecret() {
  return getAdminTokenSecret()
}

async function createDisplayTokenForClaims(
  lectureSessionId: string,
  issuedAt: number,
  expiresAt: number,
  jti: string,
  secret: string,
) {
  const now = Math.floor(Date.now() / 1000)
  if (
    !isUuid(lectureSessionId) ||
    !isUuid(jti) ||
    !Number.isInteger(issuedAt) ||
    !Number.isInteger(expiresAt) ||
    issuedAt > now + 5 ||
    expiresAt <= now ||
    expiresAt <= issuedAt ||
    expiresAt > issuedAt + MAX_TOKEN_TTL_SECONDS
  ) {
    throw new Error('Invalid display session claims.')
  }

  const payload = base64UrlEncode(
    JSON.stringify({
      aud: DISPLAY_TOKEN_AUDIENCE,
      exp: expiresAt,
      iat: issuedAt,
      jti,
      lectureSessionId,
      scope: DISPLAY_TOKEN_SCOPE,
      terminalExp: expiresAt + TERMINAL_TOKEN_TTL_SECONDS,
    }),
  )
  const signature = await signToken(payload, secret)

  return `${payload}.${signature}`
}

// Google Admin issuance uses the request UUID as the Display JTI and stores
// only its hash plus the bounded timestamps in the database transaction. A
// lost HTTP response can therefore recreate the exact same signed token
// without persisting bearer material or minting a second capability.
export async function createBoundDisplayToken(
  lectureSessionId: string,
  issuedAt: number,
  expiresAt: number,
  jti: string,
  secret: string,
) {
  return createDisplayTokenForClaims(
    lectureSessionId,
    issuedAt,
    expiresAt,
    jti,
    secret,
  )
}

export async function getDisplayTokenClaims(
  token: string,
  secret: string,
): Promise<DisplayTokenClaims | null> {
  const claims = await getSignedDisplayTokenClaims(token, secret)
  return claims && claims.exp > Date.now() / 1000 ? claims : null
}

export async function getDisplayTerminalTokenClaims(
  token: string,
  secret: string,
): Promise<DisplayTokenClaims | null> {
  const claims = await getSignedDisplayTokenClaims(token, secret)
  const now = Date.now() / 1000
  return claims && claims.exp <= now && claims.terminalExp > now ? claims : null
}

async function getSignedDisplayTokenClaims(
  token: string,
  secret: string,
): Promise<DisplayTokenClaims | null> {
  const [payload, signature, extra] = token.split('.')
  if (!payload || !signature || extra) {
    return null
  }

  const expectedSignature = await signToken(payload, secret)
  if (!timingSafeEqual(signature, expectedSignature)) {
    return null
  }

  try {
    const parsedPayload = JSON.parse(
      textDecoder.decode(base64UrlToBytes(payload)),
    ) as Partial<DisplayTokenClaims>
    const now = Date.now() / 1000
    const valid = Boolean(
      parsedPayload.scope === DISPLAY_TOKEN_SCOPE &&
      parsedPayload.aud === DISPLAY_TOKEN_AUDIENCE &&
      typeof parsedPayload.iat === 'number' &&
      parsedPayload.iat <= now + 5 &&
      typeof parsedPayload.exp === 'number' &&
      parsedPayload.exp - parsedPayload.iat <= MAX_TOKEN_TTL_SECONDS &&
      parsedPayload.exp > parsedPayload.iat &&
      typeof parsedPayload.terminalExp === 'number' &&
      parsedPayload.terminalExp ===
        parsedPayload.exp + TERMINAL_TOKEN_TTL_SECONDS &&
      typeof parsedPayload.lectureSessionId === 'string' &&
      isUuid(parsedPayload.lectureSessionId) &&
      typeof parsedPayload.jti === 'string' &&
      isUuid(parsedPayload.jti),
    )

    return valid ? (parsedPayload as DisplayTokenClaims) : null
  } catch {
    return null
  }
}
