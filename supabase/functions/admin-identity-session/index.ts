import { createClient } from 'npm:@supabase/supabase-js@2'
import {
  assertAdminLoginNonce,
  createAdminLoginNonce,
  createGoogleAdminSessionToken,
  decodeVerifiedAdminJwtClaims,
  getFreshTotpAmrTimestamp,
  getTrustedGoogleIdentity,
  hasOAuthAmr,
  hmacIdentityValue,
  isGoogleAdminSessionToken,
  readSecret,
  sha256Hex,
} from '../_shared/adminIdentity.ts'
import { getAllowedCorsOrigin, handleCors } from '../_shared/cors.ts'
import {
  readJsonBody,
  RequestBodyTooLargeError,
  UnsupportedJsonContentTypeError,
} from '../_shared/requestBody.ts'
import { createJsonResponse } from '../_shared/responses.ts'
import { hashAdminContext } from '../_shared/adminToken.ts'

type AdminIdentityRequest = {
  action?: 'admit' | 'beginStepUp' | 'completeStepUp' | 'logout' | 'status'
  appSessionToken?: string
  invitationToken?: string
  stepUpNonce?: string
}

type EnvironmentConfig = {
  audience?: string
  canonical_admin_origin?: string
  environment_id?: string
  status?: string
  supabase_issuer?: string
}

type Admission = {
  eligible?: boolean
  membership_id?: string
  principal_id?: string
}

type SessionSummary = {
  can_use_ai?: boolean
  environment_id?: string
  expires_at?: string
  id?: string
  idle_expires_at?: string
  membership_id?: string
  principal_id?: string
  role?: 'instructor' | 'owner'
  step_up_verified_at?: string
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function getBearerToken(request: Request) {
  const authorization = request.headers.get('authorization') ?? ''
  return authorization.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length).trim()
    : ''
}

function identityEnabled() {
  return Deno.env.get('PHASE730_ADMIN_IDENTITY_ENABLED') === 'true'
}

function getConfiguredEnvironmentId() {
  const value = Deno.env.get('PHASE730_ADMIN_ENVIRONMENT_ID')?.trim() ?? ''
  return UUID_PATTERN.test(value) ? value : null
}

function getSubjectPepperVersion() {
  const raw = Deno.env.get('ADMIN_IDENTITY_PEPPER_VERSION')?.trim() ?? '1'
  const value = Number.parseInt(raw, 10)
  if (!Number.isSafeInteger(value) || value < 1 || value > 2_147_483_647) {
    throw new Error('ADMIN_IDENTITY_PEPPER_VERSION is invalid.')
  }
  return value
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

function errorResponse(
  jsonResponse: ReturnType<typeof createJsonResponse>,
  code: string,
  message: string,
  status: number,
) {
  return jsonResponse({ code, message, ok: false }, status)
}

function rpcErrorResponse(
  jsonResponse: ReturnType<typeof createJsonResponse>,
  errorCode: string,
) {
  if (errorCode === 'P7300') {
    return errorResponse(
      jsonResponse,
      'feature_disabled',
      'Google Admin sign-in is not enabled.',
      503,
    )
  }
  if (errorCode === 'P7301') {
    const response = errorResponse(
      jsonResponse,
      'rate_limited',
      'Too many Admin identity attempts were made.',
      429,
    )
    response.headers.set('Retry-After', '300')
    return response
  }
  return errorResponse(
    jsonResponse,
    'service_unavailable',
    'Admin identity is temporarily unavailable.',
    503,
  )
}

function normalizeSession(data: unknown): SessionSummary | null {
  if (!data || typeof data !== 'object') return null
  const candidate = data as SessionSummary
  if (
    !candidate.id ||
    !UUID_PATTERN.test(candidate.id) ||
    !candidate.principal_id ||
    !UUID_PATTERN.test(candidate.principal_id) ||
    !candidate.membership_id ||
    !UUID_PATTERN.test(candidate.membership_id) ||
    !candidate.environment_id ||
    !UUID_PATTERN.test(candidate.environment_id) ||
    (candidate.role !== 'owner' && candidate.role !== 'instructor') ||
    typeof candidate.can_use_ai !== 'boolean' ||
    !candidate.expires_at ||
    !candidate.idle_expires_at ||
    !candidate.step_up_verified_at
  ) {
    return null
  }
  return candidate
}

async function handleRequest(request: Request) {
  const jsonResponse = createJsonResponse(request)
  const corsResponse = handleCors(request)
  if (corsResponse) return corsResponse

  const requestOrigin = getAllowedCorsOrigin(request)
  if (!requestOrigin) {
    return errorResponse(
      jsonResponse,
      'origin_required',
      'Admin sign-in is not available from this origin.',
      403,
    )
  }
  if (request.method !== 'POST') {
    return errorResponse(
      jsonResponse,
      'method_not_allowed',
      'Method not allowed.',
      405,
    )
  }
  if (!identityEnabled()) {
    return errorResponse(
      jsonResponse,
      'feature_disabled',
      'Google Admin sign-in is not enabled.',
      503,
    )
  }

  const environmentId = getConfiguredEnvironmentId()
  const supabaseUrl = Deno.env.get('SUPABASE_URL')?.trim()
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')?.trim()
  if (!environmentId || !supabaseUrl || !serviceRoleKey) {
    return errorResponse(
      jsonResponse,
      'service_unavailable',
      'Admin identity is not configured.',
      503,
    )
  }

  let body: AdminIdentityRequest
  try {
    body = await readJsonBody<AdminIdentityRequest>(request, 8_192)
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) {
      return errorResponse(
        jsonResponse,
        'request_too_large',
        'Request is too large.',
        413,
      )
    }
    if (error instanceof UnsupportedJsonContentTypeError) {
      return errorResponse(
        jsonResponse,
        'content_type_invalid',
        'Request must be JSON.',
        415,
      )
    }
    return errorResponse(
      jsonResponse,
      'request_invalid',
      'Request is invalid.',
      400,
    )
  }

  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return errorResponse(
      jsonResponse,
      'request_invalid',
      'Request is invalid.',
      400,
    )
  }

  if (
    !body.action ||
    !['admit', 'beginStepUp', 'completeStepUp', 'logout', 'status'].includes(
      body.action,
    )
  ) {
    return errorResponse(
      jsonResponse,
      'request_invalid',
      'Request is invalid.',
      400,
    )
  }

  const allowedBodyKeys = new Set(
    body.action === 'admit' || body.action === 'beginStepUp'
      ? ['action', 'invitationToken']
      : body.action === 'completeStepUp'
        ? ['action', 'stepUpNonce']
        : ['action', 'appSessionToken'],
  )
  const rawBody = body as Record<string, unknown>
  if (
    Object.keys(rawBody).some((key) => !allowedBodyKeys.has(key)) ||
    ['appSessionToken', 'invitationToken', 'stepUpNonce'].some(
      (key) => rawBody[key] !== undefined && typeof rawBody[key] !== 'string',
    )
  ) {
    return errorResponse(
      jsonResponse,
      'request_invalid',
      'Request is invalid.',
      400,
    )
  }

  const bearerToken = getBearerToken(request)
  if (!bearerToken) {
    return errorResponse(
      jsonResponse,
      'identity_invalid',
      'Google identity could not be verified.',
      401,
    )
  }

  const serviceClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const { data: userData, error: userError } =
    await serviceClient.auth.getUser(bearerToken)
  const claims = decodeVerifiedAdminJwtClaims(bearerToken)
  if (
    userError ||
    !userData.user ||
    userData.user.is_anonymous === true ||
    !claims ||
    claims.subject !== userData.user.id ||
    !hasOAuthAmr(claims)
  ) {
    return errorResponse(
      jsonResponse,
      'identity_invalid',
      'Google identity could not be verified.',
      401,
    )
  }

  const environmentResult = await serviceClient.rpc(
    'get_admin_identity_environment_v1',
    {
      target_environment_id: environmentId,
    },
  )
  const environment = environmentResult.data as EnvironmentConfig | null
  const googleIdentity = getTrustedGoogleIdentity(userData.user.identities)
  if (environmentResult.error) {
    return errorResponse(
      jsonResponse,
      'service_unavailable',
      'Admin identity is temporarily unavailable.',
      503,
    )
  }
  if (
    !googleIdentity ||
    !environment ||
    environment.environment_id !== environmentId ||
    environment.status !== 'active' ||
    environment.canonical_admin_origin !== requestOrigin ||
    environment.supabase_issuer !== claims.issuer ||
    !environment.audience ||
    !claims.audience.includes(environment.audience)
  ) {
    return errorResponse(
      jsonResponse,
      'identity_invalid',
      'Google identity could not be verified.',
      401,
    )
  }

  let identityPepper: string
  let adminSessionSecret: string
  try {
    identityPepper = readSecret('ADMIN_IDENTITY_PEPPER')
    adminSessionSecret = readSecret('ADMIN_SESSION_SECRET')
  } catch {
    return errorResponse(
      jsonResponse,
      'service_unavailable',
      'Admin identity is not configured.',
      503,
    )
  }

  const requestId = crypto.randomUUID()
  const [subjectHmac, emailHmac] = await Promise.all([
    hmacIdentityValue(googleIdentity.subject, identityPepper, 'subject'),
    hmacIdentityValue(googleIdentity.email, identityPepper, 'email'),
  ])
  const invitationToken = body.invitationToken?.trim() ?? ''
  const invitationTokenHash = invitationToken
    ? await sha256Hex(invitationToken)
    : null
  const pepperVersion = getSubjectPepperVersion()

  const admitIdentity = async () => {
    const { data, error } = await serviceClient.rpc(
      'consume_admin_identity_admission_v1',
      {
        target_auth_user_id: userData.user.id,
        target_display_name: googleIdentity.displayName,
        target_email_digest: emailHmac,
        target_environment_id: environmentId,
        target_google_issuer: googleIdentity.issuer,
        target_invitation_token_hash: invitationTokenHash,
        target_normalized_email: googleIdentity.email,
        target_provider_subject_hmac: subjectHmac,
        target_request_id: requestId,
        target_subject_pepper_version: pepperVersion,
      },
    )
    return {
      admission: error ? null : (data as Admission | null),
      errorCode: error?.code ?? null,
    }
  }

  if (body.action === 'admit') {
    const { admission, errorCode } = await admitIdentity()
    if (errorCode) return rpcErrorResponse(jsonResponse, errorCode)
    if (!admission?.eligible) {
      return errorResponse(
        jsonResponse,
        'membership_unavailable',
        'This Google account is not available for Admin sign-in.',
        403,
      )
    }
    return jsonResponse({ eligible: true, ok: true })
  }

  if (body.action === 'beginStepUp') {
    const { admission, errorCode } = await admitIdentity()
    if (errorCode) return rpcErrorResponse(jsonResponse, errorCode)
    if (!admission?.eligible) {
      return errorResponse(
        jsonResponse,
        'membership_unavailable',
        'This Google account is not available for Admin sign-in.',
        403,
      )
    }
    const rawNonce = createAdminLoginNonce()
    const reservedSessionId = crypto.randomUUID()
    const { data, error } = await serviceClient.rpc(
      'begin_admin_totp_step_up_v1',
      {
        target_auth_user_id: userData.user.id,
        target_environment_id: environmentId,
        target_nonce_hash: await sha256Hex(rawNonce),
        target_prechallenge_jwt_hash: await sha256Hex(bearerToken),
        target_request_id: crypto.randomUUID(),
        target_reserved_admin_session_id: reservedSessionId,
        target_supabase_auth_session_id: claims.sessionId,
      },
    )
    const result = data as {
      expires_at?: string
      reserved_admin_session_id?: string
    } | null
    if (error) return rpcErrorResponse(jsonResponse, error.code)
    if (
      !result?.expires_at ||
      result.reserved_admin_session_id !== reservedSessionId
    ) {
      return errorResponse(
        jsonResponse,
        'step_up_unavailable',
        'Two-step verification could not be started.',
        409,
      )
    }
    return jsonResponse({
      expiresAt: result.expires_at,
      ok: true,
      stepUpNonce: rawNonce,
    })
  }

  const verifiedTotpFactor = userData.user.factors?.some(
    (factor) => factor.factor_type === 'totp' && factor.status === 'verified',
  )
  const { data: assurance, error: assuranceError } =
    await serviceClient.auth.mfa.getAuthenticatorAssuranceLevel(bearerToken)
  if (
    assuranceError ||
    !assurance ||
    assurance.currentLevel !== 'aal2' ||
    assurance.nextLevel !== 'aal2' ||
    claims.aal !== 'aal2' ||
    !verifiedTotpFactor
  ) {
    return errorResponse(
      jsonResponse,
      'aal2_required',
      'Authenticator verification is required.',
      401,
    )
  }

  const { admission, errorCode } = await admitIdentity()
  if (errorCode) return rpcErrorResponse(jsonResponse, errorCode)
  if (!admission?.eligible) {
    return errorResponse(
      jsonResponse,
      'membership_unavailable',
      'This Google account is not available for Admin sign-in.',
      403,
    )
  }

  if (body.action === 'completeStepUp') {
    const rawNonce = body.stepUpNonce?.trim() ?? ''
    const totpTimestamp = getFreshTotpAmrTimestamp(claims)
    try {
      assertAdminLoginNonce(rawNonce)
    } catch {
      return errorResponse(
        jsonResponse,
        'step_up_invalid',
        'Two-step verification could not be completed.',
        409,
      )
    }
    if (!totpTimestamp) {
      return errorResponse(
        jsonResponse,
        'aal2_required',
        'Authenticator verification is required.',
        401,
      )
    }
    const appSessionToken = await createGoogleAdminSessionToken(
      rawNonce,
      adminSessionSecret,
    )
    const networkIdentifier = getTrustedNetworkIdentifier(request)
    const [networkHash, userAgentHash] = await Promise.all([
      networkIdentifier
        ? hashAdminContext(networkIdentifier, adminSessionSecret, 'network')
        : Promise.resolve(null),
      request.headers.get('user-agent')
        ? hashAdminContext(
            request.headers.get('user-agent')!.slice(0, 512),
            adminSessionSecret,
            'user-agent',
          )
        : Promise.resolve(null),
    ])
    const { data, error } = await serviceClient.rpc(
      'complete_admin_totp_step_up_v1',
      {
        target_auth_user_id: userData.user.id,
        target_aal: 2,
        target_current_jwt_hash: await sha256Hex(bearerToken),
        target_current_jwt_iat: new Date(claims.issuedAt * 1000).toISOString(),
        target_network_hash: networkHash,
        target_nonce_hash: await sha256Hex(rawNonce),
        target_request_id: crypto.randomUUID(),
        target_supabase_auth_session_id: claims.sessionId,
        target_token_hash: await sha256Hex(appSessionToken),
        target_totp_amr_method: claims.amr.some(
          ({ method, timestamp }) =>
            method === 'mfa/totp' && timestamp === totpTimestamp,
        )
          ? 'mfa/totp'
          : 'totp',
        target_totp_amr_at: new Date(totpTimestamp * 1000).toISOString(),
        target_user_agent_hash: userAgentHash,
      },
    )
    const session = normalizeSession(data)
    if (error) return rpcErrorResponse(jsonResponse, error.code)
    if (!session) {
      return errorResponse(
        jsonResponse,
        'step_up_invalid',
        'Two-step verification could not be completed.',
        409,
      )
    }
    return jsonResponse({
      appSessionToken,
      ok: true,
      session: {
        canUseAi: session.can_use_ai,
        environmentId: session.environment_id,
        expiresAt: session.expires_at,
        id: session.id,
        idleExpiresAt: session.idle_expires_at,
        membershipId: session.membership_id,
        principalId: session.principal_id,
        role: session.role,
        stepUpVerifiedAt: session.step_up_verified_at,
      },
    })
  }

  const appSessionToken = body.appSessionToken?.trim() ?? ''
  if (!isGoogleAdminSessionToken(appSessionToken)) {
    return errorResponse(
      jsonResponse,
      'app_session_invalid',
      'Admin session is no longer available.',
      401,
    )
  }
  const tokenHash = await sha256Hex(appSessionToken)

  if (body.action === 'logout') {
    const { data, error } = await serviceClient.rpc(
      'revoke_own_google_admin_session_v1',
      {
        target_auth_user_id: userData.user.id,
        target_request_id: crypto.randomUUID(),
        target_supabase_auth_session_id: claims.sessionId,
        target_token_hash: tokenHash,
      },
    )
    if (error) return rpcErrorResponse(jsonResponse, error.code)
    return data !== true
      ? errorResponse(
          jsonResponse,
          'app_session_invalid',
          'Admin session is no longer available.',
          401,
        )
      : jsonResponse({ ok: true })
  }

  const { data, error } = await serviceClient.rpc(
    'verify_and_touch_google_admin_session_v1',
    {
      target_auth_user_id: userData.user.id,
      target_supabase_auth_session_id: claims.sessionId,
      target_token_hash: tokenHash,
    },
  )
  const session = normalizeSession(data)
  if (error) return rpcErrorResponse(jsonResponse, error.code)
  if (!session) {
    return errorResponse(
      jsonResponse,
      'app_session_invalid',
      'Admin session is no longer available.',
      401,
    )
  }

  return jsonResponse({
    ok: true,
    session: {
      canUseAi: session.can_use_ai,
      environmentId: session.environment_id,
      expiresAt: session.expires_at,
      id: session.id,
      idleExpiresAt: session.idle_expires_at,
      membershipId: session.membership_id,
      principalId: session.principal_id,
      role: session.role,
      stepUpVerifiedAt: session.step_up_verified_at,
    },
  })
}

Deno.serve(async (request) => {
  try {
    return await handleRequest(request)
  } catch {
    return errorResponse(
      createJsonResponse(request),
      'service_unavailable',
      'Admin identity is temporarily unavailable.',
      503,
    )
  }
})
