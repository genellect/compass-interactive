const corsHeaders = {
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Origin': '*',
}

type VerifyAdminPinRequest = {
  pin?: string
}

const TOKEN_TTL_SECONDS = 8 * 60 * 60
const textEncoder = new TextEncoder()

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json',
    },
    status,
  })
}

function base64UrlEncode(value: string | Uint8Array) {
  const bytes =
    typeof value === 'string' ? textEncoder.encode(value) : new Uint8Array(value)
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
  const signature = await crypto.subtle.sign('HMAC', key, textEncoder.encode(payload))

  return base64UrlEncode(new Uint8Array(signature))
}

async function createAdminToken(secret: string) {
  const payload = base64UrlEncode(
    JSON.stringify({
      exp: Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS,
      scope: 'display-admin',
    }),
  )
  const signature = await signToken(payload, secret)

  return `${payload}.${signature}`
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  if (request.method !== 'POST') {
    return jsonResponse({ ok: false, message: 'Method not allowed.' }, 405)
  }

  const adminPin = Deno.env.get('ADMIN_PIN')

  if (!adminPin) {
    return jsonResponse(
      { ok: false, message: 'ADMIN_PIN is not configured.' },
      500,
    )
  }

  let body: VerifyAdminPinRequest
  try {
    body = (await request.json()) as VerifyAdminPinRequest
  } catch {
    return jsonResponse({ ok: false, message: 'Invalid JSON body.' }, 400)
  }

  if (!body.pin || body.pin !== adminPin) {
    return jsonResponse({ ok: false, message: 'Invalid Admin PIN.' }, 401)
  }

  const tokenSecret = Deno.env.get('ADMIN_SESSION_SECRET') ?? adminPin
  const adminToken = await createAdminToken(tokenSecret)

  return jsonResponse({ adminToken, ok: true })
})
