import { timingSafeEqual } from './adminToken.ts'

const textDecoder = new TextDecoder()
const textEncoder = new TextEncoder()
const PAIRING_SCOPE = 'compass-presenter-pairing'
const PAIRING_AUDIENCE = 'presenter-bridge-session'
const CAPABILITY_SCOPE = 'compass-presenter-capability'
const CAPABILITY_AUDIENCE = 'presenter-page-update'
const MAX_PAIRING_TTL_SECONDS = 60
const MAX_CAPABILITY_TTL_SECONDS = 95 * 60

type CommonClaims = {
  aud: string
  connectionId: string
  exp: number
  iat: number
  jti: string
  lectureSessionId: string
  scope: string
}

export type PresenterPairingClaims = CommonClaims & {
  aud: typeof PAIRING_AUDIENCE
  origin: string
  scope: typeof PAIRING_SCOPE
}

export type PresenterCapabilityClaims = CommonClaims & {
  aud: typeof CAPABILITY_AUDIENCE
  installationHash: string
  scope: typeof CAPABILITY_SCOPE
}

function isUuid(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    )
  )
}

function isSha256(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value)
}

function bytesToHex(value: Uint8Array) {
  return Array.from(value)
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

function base64UrlToBytes(value: string) {
  const base64 = value.replaceAll('-', '+').replaceAll('_', '/')
  const padded = base64.padEnd(
    base64.length + ((4 - (base64.length % 4)) % 4),
    '=',
  )
  const binary = atob(padded)
  return Uint8Array.from(binary, (character) => character.charCodeAt(0))
}

function base64UrlEncode(value: string | Uint8Array) {
  const bytes = typeof value === 'string' ? textEncoder.encode(value) : value
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll('=', '')
}

async function sign(payload: string, secret: string) {
  const key = await crypto.subtle.importKey(
    'raw',
    textEncoder.encode(secret),
    { hash: 'SHA-256', name: 'HMAC' },
    false,
    ['sign'],
  )
  return base64UrlEncode(
    new Uint8Array(
      await crypto.subtle.sign('HMAC', key, textEncoder.encode(payload)),
    ),
  )
}

async function createToken(claims: CommonClaims, secret: string) {
  const payload = base64UrlEncode(JSON.stringify(claims))
  return `${payload}.${await sign(payload, secret)}`
}

async function parseToken(token: string, secret: string) {
  const [payload, signature, extra] = token.split('.')
  if (!payload || !signature || extra) return null
  if (!timingSafeEqual(signature, await sign(payload, secret))) return null
  try {
    return JSON.parse(
      textDecoder.decode(base64UrlToBytes(payload)),
    ) as Partial<CommonClaims> & Record<string, unknown>
  } catch {
    return null
  }
}

export function getPresenterTokenSecret() {
  const secret = Deno.env.get('PRESENTER_BRIDGE_TOKEN_SECRET')
  if (!secret || textEncoder.encode(secret).byteLength < 32) {
    throw new Error('Presenter token secret is not configured.')
  }
  return secret
}

export async function hashPresenterContext(
  value: string,
  domain:
    | 'manual-code'
    | 'presenter-rate-global'
    | 'presenter-rate-key'
    | 'presenter-rate-network',
  secret: string,
) {
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
    textEncoder.encode(`${domain}:${value}`),
  )
  return bytesToHex(new Uint8Array(signature))
}

export async function createPresenterPairingToken(input: {
  connectionId: string
  expiresAt: number
  issuedAt: number
  jti: string
  lectureSessionId: string
  origin: string
  secret: string
}) {
  if (
    !isUuid(input.connectionId) ||
    !isUuid(input.lectureSessionId) ||
    !isUuid(input.jti) ||
    !Number.isInteger(input.issuedAt) ||
    !Number.isInteger(input.expiresAt) ||
    input.expiresAt <= input.issuedAt ||
    input.expiresAt - input.issuedAt > MAX_PAIRING_TTL_SECONDS ||
    !/^https?:\/\/[^/]+$/.test(input.origin)
  ) {
    throw new Error('Invalid Presenter pairing claims.')
  }
  return createToken(
    {
      aud: PAIRING_AUDIENCE,
      connectionId: input.connectionId,
      exp: input.expiresAt,
      iat: input.issuedAt,
      jti: input.jti,
      lectureSessionId: input.lectureSessionId,
      origin: input.origin,
      scope: PAIRING_SCOPE,
    } as PresenterPairingClaims,
    input.secret,
  )
}

export async function getPresenterPairingClaims(
  token: string,
  secret: string,
): Promise<PresenterPairingClaims | null> {
  const claims = await parseToken(token, secret)
  const now = Date.now() / 1000
  const valid = Boolean(
    claims?.scope === PAIRING_SCOPE &&
    claims.aud === PAIRING_AUDIENCE &&
    isUuid(claims.connectionId) &&
    isUuid(claims.lectureSessionId) &&
    isUuid(claims.jti) &&
    typeof claims.iat === 'number' &&
    claims.iat <= now + 5 &&
    typeof claims.exp === 'number' &&
    claims.exp > now &&
    claims.exp - claims.iat <= MAX_PAIRING_TTL_SECONDS &&
    typeof claims.origin === 'string' &&
    /^https?:\/\/[^/]+$/.test(claims.origin),
  )
  return valid ? (claims as PresenterPairingClaims) : null
}

export async function createPresenterCapabilityToken(input: {
  connectionId: string
  expiresAt: number
  installationHash: string
  jti: string
  lectureSessionId: string
  secret: string
}) {
  const issuedAt = input.expiresAt - MAX_CAPABILITY_TTL_SECONDS
  if (
    !isUuid(input.connectionId) ||
    !isUuid(input.lectureSessionId) ||
    !isUuid(input.jti) ||
    !isSha256(input.installationHash) ||
    !Number.isInteger(input.expiresAt) ||
    input.expiresAt <= Date.now() / 1000 ||
    issuedAt > Date.now() / 1000 + 5
  ) {
    throw new Error('Invalid Presenter capability claims.')
  }
  return createToken(
    {
      aud: CAPABILITY_AUDIENCE,
      connectionId: input.connectionId,
      exp: input.expiresAt,
      iat: issuedAt,
      installationHash: input.installationHash,
      jti: input.jti,
      lectureSessionId: input.lectureSessionId,
      scope: CAPABILITY_SCOPE,
    } as PresenterCapabilityClaims,
    input.secret,
  )
}

export async function getPresenterCapabilityClaims(
  token: string,
  secret: string,
): Promise<PresenterCapabilityClaims | null> {
  const claims = await parseToken(token, secret)
  const now = Date.now() / 1000
  const valid = Boolean(
    claims?.scope === CAPABILITY_SCOPE &&
    claims.aud === CAPABILITY_AUDIENCE &&
    isUuid(claims.connectionId) &&
    isUuid(claims.lectureSessionId) &&
    isUuid(claims.jti) &&
    isSha256(claims.installationHash) &&
    typeof claims.iat === 'number' &&
    claims.iat <= now + 5 &&
    typeof claims.exp === 'number' &&
    claims.exp > now &&
    claims.exp - claims.iat === MAX_CAPABILITY_TTL_SECONDS,
  )
  return valid ? (claims as PresenterCapabilityClaims) : null
}

export function presenterCapabilityJtiFromNonceHash(nonceHash: string) {
  if (!isSha256(nonceHash)) {
    throw new Error('Invalid Presenter proof nonce hash.')
  }
  const value = nonceHash.slice(0, 32).split('')
  value[12] = '5'
  value[16] = ((Number.parseInt(value[16], 16) & 0x3) | 0x8).toString(16)
  return [
    value.slice(0, 8).join(''),
    value.slice(8, 12).join(''),
    value.slice(12, 16).join(''),
    value.slice(16, 20).join(''),
    value.slice(20, 32).join(''),
  ].join('-')
}
