import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.110.0'
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
import { createJsonResponse } from '../_shared/responses.ts'

type AuthorizeAiStartRequest = {
  actions?: unknown
  adminToken?: string
  billingPin?: string
  lectureSessionId?: string
}

type GrantResult = {
  accepted?: boolean
  expires_at?: string
  grant_id?: string
  reason?: string
  retry_at?: string | null
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
  const billingPin = Deno.env.get('BILLING_PIN')
  if (!supabaseUrl || !serviceRoleKey || !billingPin) {
    return jsonResponse(
      { ok: false, message: 'API usage authorization is not configured.' },
      503,
    )
  }

  let body: AuthorizeAiStartRequest
  try {
    body = (await request.json()) as AuthorizeAiStartRequest
  } catch {
    return jsonResponse({ ok: false, message: 'Invalid JSON body.' }, 400)
  }

  let actions
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
  if (
    actions.includes('captions') &&
    Deno.env.get('PHASE4_REALTIME_CAPTIONS_ENABLED') !== 'true'
  ) {
    return jsonResponse(
      { ok: false, message: 'Realtime captions are disabled.' },
      503,
    )
  }
  if (
    actions.some((action) =>
      ['material_analysis', 'poll_suggestions'].includes(action),
    ) &&
    Deno.env.get('PHASE5_MATERIAL_ANALYSIS_ENABLED') !== 'true'
  ) {
    return jsonResponse(
      { ok: false, message: 'Material analysis is disabled.' },
      503,
    )
  }
  if (
    actions.includes('summaries') &&
    Deno.env.get('PHASE6_SUMMARIES_ENABLED') !== 'true'
  ) {
    return jsonResponse(
      { ok: false, message: 'Five-minute summaries are disabled.' },
      503,
    )
  }
  if (!body.adminToken || !body.lectureSessionId) {
    return jsonResponse(
      { ok: false, message: 'Admin session and lecture are required.' },
      400,
    )
  }

  let tokenSecret: string
  try {
    tokenSecret = getAdminTokenSecret()
  } catch (error) {
    return jsonResponse(
      {
        ok: false,
        message: error instanceof Error ? error.message : 'Admin auth failed.',
      },
      500,
    )
  }
  const claims = await getAdminTokenClaims(body.adminToken, tokenSecret)
  if (!claims) {
    return jsonResponse({ ok: false, message: 'Invalid Admin session.' }, 401)
  }

  const nonce = createBillingGrantNonce()
  const nonceHash = await sha256Hex(nonce)
  const pinSucceeded = await verifyBillingPin(body.billingPin ?? '', billingPin)
  const actorId = getAdminActorId(claims)
  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  })
  const { data, error } = await supabase.rpc('admin_issue_ai_billing_grant', {
    pin_succeeded: pinSucceeded,
    target_actions: actions,
    target_actor_id: actorId,
    target_lecture_session_id: body.lectureSessionId,
    target_nonce_hash: nonceHash,
  })

  if (error) {
    return jsonResponse(
      { ok: false, message: 'API usage authorization failed.' },
      409,
    )
  }
  const result = data as GrantResult
  if (!result.accepted || !result.grant_id || !result.expires_at) {
    const rateLimited = result.reason === 'rate_limited'
    return jsonResponse(
      {
        ok: false,
        message: rateLimited
          ? 'Too many failed attempts. Try again later.'
          : 'API usage PIN could not be verified.',
        reason: result.reason,
        retryAt: result.retry_at ?? null,
      },
      rateLimited ? 429 : 401,
    )
  }

  return jsonResponse({
    actions,
    billingGrant: formatBillingGrantToken(result.grant_id, nonce),
    expiresAt: result.expires_at,
    ok: true,
  })
})
