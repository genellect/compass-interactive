import { createClient } from 'npm:@supabase/supabase-js@2'
import {
  createAdminToken,
  getAdminTokenSecret,
  hashAdminContext,
  timingSafeEqual,
} from '../_shared/adminToken.ts'
import { handleCors } from '../_shared/cors.ts'
import {
  readJsonBody,
  RequestBodyTooLargeError,
  UnsupportedJsonContentTypeError,
} from '../_shared/requestBody.ts'
import { createJsonResponse } from '../_shared/responses.ts'

type VerifyAdminPinRequest = {
  pin?: string
}

function getBearerToken(request: Request) {
  const authorization = request.headers.get('authorization') ?? ''
  return authorization.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length).trim()
    : ''
}

function getTrustedNetworkIdentifier(request: Request) {
  const hostname = new URL(request.url).hostname
  if (hostname === '127.0.0.1' || hostname === 'localhost') return null
  const candidate =
    request.headers.get('cf-connecting-ip') ??
    request.headers.get('x-real-ip') ??
    request.headers.get('x-forwarded-for')?.split(',', 1)[0] ??
    ''
  const normalized = candidate.trim().toLowerCase()
  return normalized.length >= 3 && normalized.length <= 64 ? normalized : null
}

Deno.serve(async (request) => {
  const jsonResponse = createJsonResponse(request)
  const corsResponse = handleCors(request)
  if (corsResponse) {
    return corsResponse
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

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!supabaseUrl || !serviceRoleKey) {
    return jsonResponse(
      { ok: false, message: 'Admin PIN could not be verified.' },
      503,
    )
  }
  const serviceClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  })
  const bearerToken = getBearerToken(request)
  const { data: authData, error: authError } = bearerToken
    ? await serviceClient.auth.getUser(bearerToken)
    : { data: { user: null }, error: new Error('missing bearer token') }
  if (authError || !authData.user || authData.user.is_anonymous !== true) {
    return jsonResponse(
      { ok: false, message: 'Admin PIN could not be verified.' },
      401,
    )
  }

  if (Deno.env.get('PHASE730_LEGACY_ADMIN_PIN_ENABLED') === 'false') {
    return jsonResponse(
      { ok: false, message: 'Admin PIN could not be verified.' },
      503,
    )
  }
  const { data: identityGate, error: identityGateError } =
    await serviceClient.rpc('get_admin_identity_runtime_gate_v1')
  if (
    identityGateError ||
    !identityGate ||
    (identityGate as { legacy_pin_login_enabled?: boolean })
      .legacy_pin_login_enabled !== true
  ) {
    return jsonResponse(
      { ok: false, message: 'Admin PIN could not be verified.' },
      503,
    )
  }

  let tokenSecret: string
  try {
    tokenSecret = getAdminTokenSecret()
  } catch {
    return jsonResponse(
      { ok: false, message: 'Admin PIN could not be verified.' },
      503,
    )
  }
  const networkIdentifier = getTrustedNetworkIdentifier(request)
  const [userBucketHash, networkHash, globalBucketHash, userAgentHash] =
    await Promise.all([
      hashAdminContext(authData.user.id, tokenSecret, 'user'),
      networkIdentifier
        ? hashAdminContext(networkIdentifier, tokenSecret, 'network')
        : Promise.resolve(null),
      hashAdminContext('compass-admin-pin', tokenSecret, 'global'),
      request.headers.get('user-agent')
        ? hashAdminContext(
            request.headers.get('user-agent')!.slice(0, 512),
            tokenSecret,
            'user-agent',
          )
        : Promise.resolve(null),
    ])
  const { data: rateLimit, error: rateLimitError } = await serviceClient.rpc(
    'consume_admin_pin_rate_limit',
    {
      global_bucket_hash: globalBucketHash,
      network_bucket_hash: networkHash,
      user_bucket_hash: userBucketHash,
    },
  )
  if (
    rateLimitError ||
    !rateLimit ||
    (rateLimit as { allowed?: boolean }).allowed !== true
  ) {
    return jsonResponse(
      { ok: false, message: 'Admin PIN could not be verified.' },
      rateLimitError ? 503 : 429,
    )
  }

  let body: VerifyAdminPinRequest
  try {
    body = await readJsonBody<VerifyAdminPinRequest>(request, 2_048)
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) {
      return jsonResponse({ ok: false, message: 'Request is too large.' }, 413)
    }
    if (error instanceof UnsupportedJsonContentTypeError) {
      return jsonResponse({ ok: false, message: 'Request must be JSON.' }, 415)
    }
    return jsonResponse({ ok: false, message: 'Invalid JSON body.' }, 400)
  }

  const submittedPin = body.pin?.trim() ?? ''
  if (!timingSafeEqual(submittedPin, adminPin)) {
    return jsonResponse(
      { ok: false, message: 'Admin PIN could not be verified.' },
      401,
    )
  }

  try {
    const adminToken = await createAdminToken(tokenSecret, {
      authUserId: authData.user.id,
      networkHash,
      userAgentHash,
    })
    await serviceClient.rpc('reset_admin_pin_rate_limit', {
      network_bucket_hash: networkHash,
      user_bucket_hash: userBucketHash,
    })
    return jsonResponse({ adminToken, ok: true })
  } catch {
    return jsonResponse(
      { ok: false, message: 'Admin PIN could not be verified.' },
      500,
    )
  }
})
