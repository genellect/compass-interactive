const ADMIN_TOKEN_SCOPE = 'compass-admin'
const TOKEN_TTL_SECONDS = 8 * 60 * 60
const IDLE_TTL_SECONDS = 30 * 60
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

function bytesToHex(value: Uint8Array) {
  return Array.from(value)
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

export async function sha256Hex(value: string) {
  return bytesToHex(
    new Uint8Array(
      await crypto.subtle.digest('SHA-256', textEncoder.encode(value)),
    ),
  )
}

export async function hashAdminContext(
  value: string,
  secret: string,
  domain: 'global' | 'network' | 'pin-version' | 'user' | 'user-agent',
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
  const tokenSecret = Deno.env.get('ADMIN_SESSION_SECRET')

  if (!tokenSecret) {
    throw new Error('Admin session secret is not configured.')
  }
  if (textEncoder.encode(tokenSecret).byteLength < 32) {
    throw new Error('Admin session secret must contain at least 32 bytes.')
  }

  return tokenSecret
}

async function getServiceClient() {
  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('Admin session storage is not configured.')
  }
  const { createClient } = await import('npm:@supabase/supabase-js@2')
  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  })
}

export function trackedAdminSessionsEnabled() {
  return (
    typeof Deno !== 'undefined' &&
    Deno.env.get('PHASE68_TRACKED_ADMIN_SESSIONS_ENABLED') === 'true'
  )
}

async function getPinVersionHash(secret: string) {
  const adminPin = Deno.env.get('ADMIN_PIN')
  if (!adminPin) throw new Error('Admin credential is not configured.')
  return hashAdminContext(adminPin, secret, 'pin-version')
}

export async function createAdminToken(
  secret: string,
  context?: {
    authUserId: string
    networkHash: string | null
    userAgentHash: string | null
  },
) {
  const now = Math.floor(Date.now() / 1000)
  const sessionId = crypto.randomUUID()
  const payload = base64UrlEncode(
    JSON.stringify({
      exp: now + TOKEN_TTL_SECONDS,
      iat: now,
      scope: ADMIN_TOKEN_SCOPE,
      sid: sessionId,
    }),
  )
  const signature = await signToken(payload, secret)
  const token = `${payload}.${signature}`

  if (trackedAdminSessionsEnabled()) {
    if (!context) throw new Error('Admin session context is required.')
    const serviceClient = await getServiceClient()
    const { error } = await serviceClient.from('admin_sessions').insert({
      aal: 1,
      authentication_method: 'legacy_pin',
      auth_user_id: context.authUserId,
      expires_at: new Date((now + TOKEN_TTL_SECONDS) * 1000).toISOString(),
      id: sessionId,
      idle_expires_at: new Date((now + IDLE_TTL_SECONDS) * 1000).toISOString(),
      issued_at: new Date(now * 1000).toISOString(),
      last_seen_at: new Date(now * 1000).toISOString(),
      network_hash: context.networkHash,
      pin_version_hash: await getPinVersionHash(secret),
      token_hash: await sha256Hex(token),
      user_agent_hash: context.userAgentHash,
    })
    if (error) throw new Error('Admin session could not be created.')
  }

  return token
}

export async function getAdminTokenClaims(
  token: string,
  secret: string,
  request?: Request,
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

    if (trackedAdminSessionsEnabled()) {
      if (!parsedPayload.sid || !request) return null
      const serviceClient = await getServiceClient()
      const authorization = request.headers.get('authorization') ?? ''
      const bearerToken = authorization.startsWith('Bearer ')
        ? authorization.slice('Bearer '.length).trim()
        : ''
      if (!bearerToken) return null
      const { data: authData, error: authError } =
        await serviceClient.auth.getUser(bearerToken)
      if (authError || !authData.user) return null
      const { data, error } = await serviceClient.rpc(
        'verify_and_touch_admin_session',
        {
          target_pin_version_hash: await getPinVersionHash(secret),
          target_session_id: parsedPayload.sid,
          target_token_hash: await sha256Hex(token),
        },
      )
      if (
        error ||
        !data ||
        (data as { auth_user_id?: string }).auth_user_id !== authData.user.id
      ) {
        return null
      }
    }

    return parsedPayload as AdminTokenClaims
  } catch {
    return null
  }
}

export async function verifyAdminToken(
  token: string,
  secret: string,
  request?: Request,
) {
  return (await getAdminTokenClaims(token, secret, request)) !== null
}

export function getAdminActorId(claims: AdminTokenClaims) {
  return claims.sid ? `admin-session:${claims.sid}` : 'admin-session:legacy'
}
