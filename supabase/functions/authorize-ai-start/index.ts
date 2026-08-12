import { createClient } from 'npm:@supabase/supabase-js@2'
import {
  createBillingGrantNonce,
  formatBillingGrantToken,
  normalizeAiFeatures,
  sha256Hex,
  verifyBillingPin,
} from '../_shared/aiBilling.ts'
import {
  getAdminActorId,
  getAdminTokenClaims,
  getAdminTokenSecret,
} from '../_shared/adminToken.ts'
import { handleCors } from '../_shared/cors.ts'
import {
  type GoogleAdminOperationContext,
  verifyGoogleAdminOperationRequest,
} from '../_shared/googleAdminOperations.ts'
import { describeJsonBodyError, readJsonBody } from '../_shared/requestBody.ts'
import { createJsonResponse } from '../_shared/responses.ts'

type MasterAuthorizationScope = 'all_except_captions' | 'all_including_captions'

type AuthorizeAiStartRequest = {
  action?: 'issueGrant' | 'authorizeMaster' | 'masterStatus' | 'revokeMaster'
  actions?: unknown
  adminToken?: string
  appSessionToken?: string
  billingPin?: string
  lectureSessionId?: string
  masterScope?: unknown
  reason?: unknown
  requestId?: string
}

type GrantResult = {
  accepted?: boolean
  actions?: string[]
  expires_at?: string
  grant_id?: string
  reason?: string
  retry_at?: string | null
}

type MasterResult = {
  accepted?: boolean
  authorization?: unknown
  lecture_open?: boolean
  reason?: string
  retry_at?: string | null
  server_time?: string
}

function isUuid(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    )
  )
}

function isMasterScope(value: unknown): value is MasterAuthorizationScope {
  return value === 'all_except_captions' || value === 'all_including_captions'
}

function validateFeatureFlags(actions: string[]) {
  if (
    actions.includes('captions') &&
    Deno.env.get('PHASE4_REALTIME_CAPTIONS_ENABLED') !== 'true'
  ) {
    return 'Realtime captions are disabled.'
  }
  if (
    actions.some((action) =>
      ['material_analysis', 'poll_suggestions'].includes(action),
    ) &&
    Deno.env.get('PHASE5_MATERIAL_ANALYSIS_ENABLED') !== 'true'
  ) {
    return 'Material analysis is disabled.'
  }
  if (
    actions.includes('summaries') &&
    Deno.env.get('PHASE6_SUMMARIES_ENABLED') !== 'true'
  ) {
    return 'Five-minute summaries are disabled.'
  }
  if (
    actions.includes('academic_answers') &&
    Deno.env.get('PHASE7_2_ACADEMIC_ANSWERS_ENABLED') !== 'true'
  ) {
    return 'Academic reference answers are disabled.'
  }
  if (
    actions.includes('summaries') &&
    actions.includes('academic_answers') &&
    (actions.length !== 2 ||
      Deno.env.get('PHASE7_25_AUTO_ACADEMIC_ANSWERS_ENABLED') !== 'true')
  ) {
    return 'Automatic academic reference answers are disabled.'
  }
  return null
}

function validateMasterFeatureReadiness(scope: MasterAuthorizationScope) {
  if (Deno.env.get('PHASE7_25_AUTO_ACADEMIC_ANSWERS_ENABLED') !== 'true') {
    return 'Automatic academic reference answers are disabled.'
  }
  const actions = [
    'material_analysis',
    'poll_suggestions',
    'summaries',
    'academic_answers',
    ...(scope === 'all_including_captions' ? ['captions'] : []),
  ]
  for (const feature of actions) {
    const error = validateFeatureFlags([feature])
    if (error) return error
  }
  return null
}

Deno.serve(async (request) => {
  const jsonResponse = createJsonResponse(request)
  const corsResponse = handleCors(request)
  if (corsResponse) return corsResponse
  if (request.method !== 'POST') {
    return jsonResponse({ ok: false, message: 'Method not allowed.' }, 405)
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!supabaseUrl || !serviceRoleKey) {
    return jsonResponse(
      { ok: false, message: 'API usage authorization is not configured.' },
      503,
    )
  }

  let body: AuthorizeAiStartRequest
  try {
    body = await readJsonBody<AuthorizeAiStartRequest>(request, 16 * 1024)
  } catch (error) {
    const bodyError = describeJsonBodyError(error)
    return jsonResponse(
      { ok: false, message: bodyError.message },
      bodyError.status,
    )
  }

  const action = body.action ?? 'issueGrant'
  const hasGoogleCredential =
    typeof body.appSessionToken === 'string' &&
    body.appSessionToken.trim().length > 0
  const hasLegacyCredential =
    typeof body.adminToken === 'string' && body.adminToken.trim().length > 0
  if (!body.lectureSessionId || hasGoogleCredential === hasLegacyCredential) {
    return jsonResponse(
      {
        ok: false,
        message: body.lectureSessionId
          ? 'Exactly one Admin credential is required.'
          : 'Lecture is required.',
      },
      body.lectureSessionId ? 401 : 400,
    )
  }

  let supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  })
  let actorId: string | null = null
  let adminSessionId: string | null = null
  let googleContext: GoogleAdminOperationContext | null = null
  if (hasGoogleCredential) {
    const verification = await verifyGoogleAdminOperationRequest(
      request,
      body.appSessionToken!,
    )
    if (!verification.ok) {
      return jsonResponse(
        {
          code: verification.code,
          message: verification.message,
          ok: false,
        },
        verification.status,
      )
    }
    googleContext = verification
    supabase = verification.serviceClient
  } else {
    let tokenSecret: string
    try {
      tokenSecret = getAdminTokenSecret()
    } catch (error) {
      return jsonResponse(
        {
          ok: false,
          message:
            error instanceof Error ? error.message : 'Admin auth failed.',
        },
        500,
      )
    }
    const claims = await getAdminTokenClaims(
      body.adminToken!,
      tokenSecret,
      request,
    )
    if (!claims) {
      return jsonResponse({ ok: false, message: 'Invalid Admin session.' }, 401)
    }
    actorId = getAdminActorId(claims)
    adminSessionId = claims.sid ?? null
  }
  const masterEnabled =
    Deno.env.get('PHASE7_28_AI_MASTER_AUTH_ENABLED') === 'true'
  const trackedAdminSessionsEnabled =
    Deno.env.get('PHASE68_TRACKED_ADMIN_SESSIONS_ENABLED') === 'true'

  if (googleContext) {
    if (action === 'authorizeMaster') {
      return jsonResponse(
        {
          code: 'google_ai_master_proof_required',
          message:
            'Authorize lecture AI from the personal AI authorization panel.',
          ok: false,
        },
        409,
      )
    }
    if (action === 'issueGrant') {
      return jsonResponse(
        {
          code: 'google_ai_provider_start_required',
          message:
            'Start the selected AI feature directly. Its provider authorization is issued atomically.',
          ok: false,
        },
        409,
      )
    }
    if (!['masterStatus', 'revokeMaster'].includes(action)) {
      return jsonResponse({ ok: false, message: 'Unknown action.' }, 400)
    }
    if (
      action === 'revokeMaster' &&
      (!isUuid(body.requestId) ||
        body.requestId.toLowerCase() === body.lectureSessionId.toLowerCase())
    ) {
      return jsonResponse(
        { ok: false, message: 'A valid revoke request ID is required.' },
        400,
      )
    }
    if (
      body.billingPin !== undefined ||
      body.actions !== undefined ||
      body.masterScope !== undefined
    ) {
      return jsonResponse(
        { ok: false, message: 'Google AI master request is invalid.' },
        400,
      )
    }
    const trimmedReason =
      action === 'revokeMaster' && typeof body.reason === 'string'
        ? body.reason.trim()
        : ''
    if (trimmedReason.length > 120) {
      return jsonResponse(
        { ok: false, message: 'The revoke reason is too long.' },
        400,
      )
    }
    const reason =
      action === 'revokeMaster'
        ? trimmedReason || 'admin_manual_revoke'
        : null
    const { data, error } = await supabase.rpc(
      'manage_google_admin_ai_master_v1',
      {
        target_action: action,
        target_auth_user_id: googleContext.authUserId,
        target_google_issuer: googleContext.googleIssuer,
        target_lecture_session_id: body.lectureSessionId,
        target_provider_subject_hmac: googleContext.googleSubjectHmac,
        target_reason: reason,
        target_request_id:
          action === 'revokeMaster' ? body.requestId : null,
        target_subject_pepper_version: googleContext.subjectPepperVersion,
        target_supabase_auth_session_id: googleContext.supabaseAuthSessionId,
        target_token_hash: googleContext.appSessionTokenHash,
        target_transport_enabled: googleContext.transportEnabled,
      },
    )
    if (error || !data) {
      return jsonResponse(
        {
          message:
            action === 'masterStatus'
              ? 'AI authorization status is unavailable.'
              : 'AI authorization could not be stopped.',
          ok: false,
        },
        409,
      )
    }
    const result = data as MasterResult
    if (result.accepted !== true) {
      return jsonResponse(
        { message: 'AI authorization is unavailable.', ok: false },
        409,
      )
    }
    return jsonResponse({
      authorization: result.authorization ?? null,
      lectureOpen: result.lecture_open === true,
      ok: true,
      serverTime: result.server_time ?? null,
    })
  }

  if (
    ['masterStatus', 'authorizeMaster', 'revokeMaster'].includes(action) &&
    !trackedAdminSessionsEnabled
  ) {
    return jsonResponse(
      { ok: false, message: 'Tracked Admin sessions are required.' },
      503,
    )
  }

  if (action === 'masterStatus') {
    if (!adminSessionId) {
      return jsonResponse(
        { ok: false, message: 'Tracked Admin session is required.' },
        401,
      )
    }
    const { data, error } = await supabase.rpc(
      'admin_get_ai_master_authorization_status',
      {
        target_admin_session_id: adminSessionId,
        target_actor_id: actorId!,
        target_lecture_session_id: body.lectureSessionId,
      },
    )
    if (error) {
      return jsonResponse(
        { ok: false, message: 'AI authorization status is unavailable.' },
        409,
      )
    }
    const result = data as MasterResult
    return jsonResponse({
      authorization: result.authorization ?? null,
      lectureOpen: result.lecture_open === true,
      ok: true,
      serverTime: result.server_time ?? null,
    })
  }

  if (action === 'authorizeMaster') {
    if (!masterEnabled) {
      return jsonResponse(
        { ok: false, message: 'Lecture-wide AI authorization is disabled.' },
        503,
      )
    }
    if (!isMasterScope(body.masterScope)) {
      return jsonResponse(
        { ok: false, message: 'AI authorization scope is invalid.' },
        400,
      )
    }
    const readinessError = validateMasterFeatureReadiness(body.masterScope)
    if (readinessError) {
      return jsonResponse({ ok: false, message: readinessError }, 503)
    }
    if (!adminSessionId) {
      return jsonResponse(
        { ok: false, message: 'Tracked Admin session is required.' },
        401,
      )
    }
    const billingPin = Deno.env.get('BILLING_PIN')
    if (!billingPin) {
      return jsonResponse(
        { ok: false, message: 'API usage authorization is not configured.' },
        503,
      )
    }
    const pinSucceeded = await verifyBillingPin(
      body.billingPin ?? '',
      billingPin,
    )
    const { data, error } = await supabase.rpc('admin_authorize_ai_master', {
      pin_succeeded: pinSucceeded,
      target_admin_session_id: adminSessionId,
      target_actor_id: actorId!,
      target_lecture_session_id: body.lectureSessionId,
      target_scope: body.masterScope,
    })
    if (error) {
      return jsonResponse(
        { ok: false, message: 'Lecture-wide AI authorization failed.' },
        409,
      )
    }
    const result = data as MasterResult
    if (!result.accepted) {
      const rateLimited = result.reason === 'rate_limited'
      return jsonResponse(
        {
          message: rateLimited
            ? 'Too many failed attempts. Try again later.'
            : result.reason === 'authorization_held_by_other_admin'
              ? 'Another Admin screen already holds the lecture AI authorization.'
              : result.reason === 'lecture_not_open'
                ? 'AI can be authorized only while the lecture is open.'
                : 'API usage PIN could not be verified.',
          ok: false,
          reason: result.reason,
          retryAt: result.retry_at ?? null,
        },
        rateLimited ? 429 : result.reason === 'lecture_not_open' ? 409 : 401,
      )
    }
    return jsonResponse({
      authorization: result.authorization ?? null,
      ok: true,
      serverTime: result.server_time ?? null,
    })
  }

  if (action === 'revokeMaster') {
    if (!adminSessionId) {
      return jsonResponse(
        { ok: false, message: 'Tracked Admin session is required.' },
        401,
      )
    }
    const reason =
      typeof body.reason === 'string' && body.reason.trim()
        ? body.reason.trim().slice(0, 120)
        : 'admin_manual_revoke'
    const { data, error } = await supabase.rpc(
      'admin_revoke_ai_master_authorization',
      {
        target_admin_session_id: adminSessionId,
        target_actor_id: actorId!,
        target_lecture_session_id: body.lectureSessionId,
        target_reason: reason,
      },
    )
    if (error) {
      return jsonResponse(
        { ok: false, message: 'AI authorization could not be stopped.' },
        409,
      )
    }
    const result = data as MasterResult
    if (!result.accepted) {
      return jsonResponse(
        {
          message:
            result.reason === 'actor_mismatch'
              ? 'This AI authorization belongs to another Admin screen.'
              : 'AI authorization could not be stopped.',
          ok: false,
          reason: result.reason,
        },
        409,
      )
    }

    // The RPC atomically revokes pending child grants, stops summary/runtime
    // state and queues any active Realtime provider call for hangup.
    return jsonResponse({
      authorization: result.authorization ?? null,
      ok: true,
    })
  }

  if (action !== 'issueGrant') {
    return jsonResponse({ ok: false, message: 'Unknown action.' }, 400)
  }

  let actions: string[]
  try {
    actions = normalizeAiFeatures(body.actions)
  } catch (error) {
    return jsonResponse(
      {
        ok: false,
        message: error instanceof Error ? error.message : 'Invalid AI actions.',
      },
      400,
    )
  }
  const flagError = validateFeatureFlags(actions)
  if (flagError) {
    return jsonResponse({ ok: false, message: flagError }, 503)
  }

  const nonce = createBillingGrantNonce()
  const nonceHash = await sha256Hex(nonce)
  let result: GrantResult
  if (body.billingPin?.trim()) {
    const billingPin = Deno.env.get('BILLING_PIN')
    if (!billingPin) {
      return jsonResponse(
        { ok: false, message: 'API usage authorization is not configured.' },
        503,
      )
    }
    const pinSucceeded = await verifyBillingPin(body.billingPin, billingPin)
    const { data, error } = await supabase.rpc('admin_issue_ai_billing_grant', {
      pin_succeeded: pinSucceeded,
      target_actions: actions,
      target_actor_id: actorId!,
      target_lecture_session_id: body.lectureSessionId,
      target_nonce_hash: nonceHash,
    })
    if (error) {
      const masterConflict = error.message.includes(
        'lecture-wide AI authorization requires a child grant',
      )
      return jsonResponse(
        {
          ok: false,
          message: masterConflict
            ? 'Lecture-wide AI authorization is active. Use its authorized feature controls.'
            : 'API usage authorization failed.',
          reason: masterConflict ? 'master_authorization_active' : undefined,
        },
        409,
      )
    }
    result = data as GrantResult
  } else {
    if (!masterEnabled) {
      return jsonResponse(
        { ok: false, message: 'API usage PIN is required.' },
        400,
      )
    }
    if (!trackedAdminSessionsEnabled) {
      return jsonResponse(
        { ok: false, message: 'Tracked Admin sessions are required.' },
        503,
      )
    }
    if (!adminSessionId) {
      return jsonResponse(
        { ok: false, message: 'Tracked Admin session is required.' },
        401,
      )
    }
    const { data, error } = await supabase.rpc(
      'admin_issue_ai_billing_grant_from_master',
      {
        target_admin_session_id: adminSessionId,
        target_actions: actions,
        target_actor_id: actorId!,
        target_lecture_session_id: body.lectureSessionId,
        target_nonce_hash: nonceHash,
      },
    )
    if (error) {
      return jsonResponse(
        { ok: false, message: 'Lecture-wide AI authorization failed.' },
        409,
      )
    }
    result = data as GrantResult
  }

  if (!result.accepted || !result.grant_id || !result.expires_at) {
    const rateLimited = result.reason === 'rate_limited'
    const masterReasonMessages: Record<string, string> = {
      lecture_not_open: 'The lecture is no longer open.',
      master_actor_mismatch:
        'This AI authorization belongs to another Admin screen.',
      master_expired: 'The lecture-wide AI authorization expired.',
      master_not_active: 'Authorize AI use for this lecture first.',
      master_scope_mismatch:
        'The selected AI authorization does not include this feature.',
    }
    return jsonResponse(
      {
        message: rateLimited
          ? 'Too many failed attempts. Try again later.'
          : (masterReasonMessages[result.reason ?? ''] ??
            'API usage PIN could not be verified.'),
        ok: false,
        reason: result.reason,
        retryAt: result.retry_at ?? null,
      },
      rateLimited ? 429 : 401,
    )
  }

  return jsonResponse({
    actions: result.actions ?? actions,
    billingGrant: formatBillingGrantToken(result.grant_id, nonce),
    expiresAt: result.expires_at,
    ok: true,
  })
})
