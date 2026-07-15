const ADMIN_TOKEN_SCOPE = 'compass-admin'
const TOKEN_TTL_SECONDS = 8 * 60 * 60
const textDecoder = new TextDecoder()
const textEncoder = new TextEncoder()

export type AdminTokenClaims = {
  exp: number
  iat: number
  scope: typeof ADMIN_TOKEN_SCOPE
  sid?: string
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

export function timingSafeEqual(left: string, right: string) {
  if (left.length !== right.length) {
    return false
  }

  let mismatch = 0
  for (let index = 0; index < left.length; index += 1) {
    mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index)
  }

  return mismatch === 0
}

export function getAdminTokenSecret() {
  const adminPin = Deno.env.get('ADMIN_PIN')
  const tokenSecret = Deno.env.get('ADMIN_SESSION_SECRET') ?? adminPin

  if (!tokenSecret) {
    throw new Error('Admin session secret is not configured.')
  }

  return tokenSecret
}

export async function createAdminToken(secret: string) {
  const now = Math.floor(Date.now() / 1000)
  const payload = base64UrlEncode(
    JSON.stringify({
      exp: now + TOKEN_TTL_SECONDS,
      iat: now,
      scope: ADMIN_TOKEN_SCOPE,
      sid: crypto.randomUUID(),
    }),
  )
  const signature = await signToken(payload, secret)

  return `${payload}.${signature}`
}

export async function getAdminTokenClaims(
  token: string,
  secret: string,
): Promise<AdminTokenClaims | null> {
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
    ) as {
      exp?: number
      iat?: number
      sid?: string
      scope?: string
    }
    const now = Date.now() / 1000

    const valid = Boolean(
      parsedPayload.scope === ADMIN_TOKEN_SCOPE &&
      parsedPayload.iat &&
      parsedPayload.iat <= now &&
      parsedPayload.exp &&
      parsedPayload.exp > now &&
      (!parsedPayload.sid ||
        /^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(parsedPayload.sid)),
    )
    if (!valid) {
      return null
    }

    return parsedPayload as AdminTokenClaims
  } catch {
    return null
  }
}

export async function verifyAdminToken(token: string, secret: string) {
  return (await getAdminTokenClaims(token, secret)) !== null
}

export function getAdminActorId(claims: AdminTokenClaims) {
  return claims.sid ? `admin-session:${claims.sid}` : 'admin-session:legacy'
}
