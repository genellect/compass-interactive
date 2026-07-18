import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.110.0'
import { parseBillingGrantToken, sha256Hex } from '../_shared/aiBilling.ts'
import {
  getAdminActorId,
  getAdminTokenClaims,
  getAdminTokenSecret,
} from '../_shared/adminToken.ts'
import { handleCors } from '../_shared/cors.ts'
import {
  createSummaryRunNonce,
  formatSummaryRunToken,
} from '../_shared/lectureSummaries.ts'
import {
  readJsonBody,
  RequestBodyTooLargeError,
  UnsupportedJsonContentTypeError,
} from '../_shared/requestBody.ts'
import { createJsonResponse } from '../_shared/responses.ts'

type RequestBody = {
  action?:
    | 'status'
    | 'start'
    | 'resume'
    | 'stop'
    | 'publish'
    | 'hide'
    | 'pin'
    | 'unpin'
    | 'revisePublish'
  adminToken?: string
  billingGrant?: string
  lectureSessionId?: string
  pinnedOrder?: number | null
  pinnedUntil?: string | null
  reason?: string | null
  revisionBody?: {
    commentPulse?: string[]
    lectureRecap?: string[]
  } | null
  summaryId?: string
}

function errorResponse(
  jsonResponse: ReturnType<typeof createJsonResponse>,
  error: unknown,
) {
  return jsonResponse(
    {
      message:
        error instanceof Error
          ? error.message
          : 'Lecture summary operation failed.',
      ok: false,
    },
    409,
  )
}

Deno.serve(async (request) => {
  const jsonResponse = createJsonResponse(request)
  const corsResponse = handleCors(request)
  if (corsResponse) return corsResponse
  if (request.method !== 'POST') {
    return jsonResponse({ message: 'Method not allowed.', ok: false }, 405)
  }
  if (Deno.env.get('PHASE6_SUMMARIES_ENABLED') !== 'true') {
    return jsonResponse(
      { message: 'Five-minute summaries are disabled.', ok: false },
      503,
    )
  }

  let body: RequestBody
  try {
    body = await readJsonBody<RequestBody>(request, 64 * 1024)
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) {
      return jsonResponse(
        { message: 'Request body is too large.', ok: false },
        413,
      )
    }
    if (error instanceof UnsupportedJsonContentTypeError) {
      return jsonResponse({ message: 'Request must be JSON.', ok: false }, 415)
    }
    return jsonResponse({ message: 'Invalid JSON body.', ok: false }, 400)
  }
  if (!body.action || !body.adminToken || !body.lectureSessionId) {
    return jsonResponse(
      { message: 'Admin session, lecture and action are required.', ok: false },
      400,
    )
  }

  let actorId: string
  try {
    const claims = await getAdminTokenClaims(
      body.adminToken,
      getAdminTokenSecret(),
      request,
    )
    if (!claims) {
      return jsonResponse({ message: 'Invalid Admin session.', ok: false }, 401)
    }
    actorId = getAdminActorId(claims)
  } catch {
    return jsonResponse({ message: 'Admin auth failed.', ok: false }, 500)
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!supabaseUrl || !serviceRoleKey) {
    return jsonResponse(
      { message: 'Lecture summaries are not configured.', ok: false },
      503,
    )
  }
  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  })

  try {
    if (body.action === 'status') {
      const { data, error } = await supabase.rpc(
        'admin_get_phase6_summary_results',
        { target_lecture_session_id: body.lectureSessionId },
      )
      if (error) throw error
      return jsonResponse({ ok: true, results: data })
    }

    if (body.action === 'start') {
      if (!body.billingGrant) {
        return jsonResponse(
          { message: 'Billing authorization is required.', ok: false },
          400,
        )
      }
      const billing = parseBillingGrantToken(body.billingGrant)
      const nonce = createSummaryRunNonce()
      const { data, error } = await supabase.rpc(
        'admin_start_lecture_summary_run',
        {
          target_actor_id: actorId,
          target_grant_id: billing.grantId,
          target_grant_nonce_hash: await sha256Hex(billing.nonce),
          target_lecture_session_id: body.lectureSessionId,
          target_run_token_hash: await sha256Hex(nonce),
        },
      )
      if (error) throw error
      const result = data as {
        accepted?: boolean
        reason?: string
        results?: unknown
        run?: { id?: string }
      }
      if (!result.accepted || !result.run?.id) {
        return jsonResponse(
          {
            message: 'Summary run could not be started.',
            ok: false,
            reason: result.reason,
          },
          409,
        )
      }
      return jsonResponse({
        ok: true,
        results: result.results,
        runToken: formatSummaryRunToken(result.run.id, nonce),
      })
    }

    if (body.action === 'resume') {
      const nonce = createSummaryRunNonce()
      const { data, error } = await supabase.rpc(
        'admin_resume_lecture_summary_run',
        {
          target_actor_id: actorId,
          target_lecture_session_id: body.lectureSessionId,
          target_run_token_hash: await sha256Hex(nonce),
        },
      )
      if (error) throw error
      const result = data as {
        accepted?: boolean
        reason?: string
        results?: unknown
        run?: { id?: string }
      }
      if (!result.accepted || !result.run?.id) {
        return jsonResponse({
          ok: true,
          reason: result.reason,
          results: result.results,
        })
      }
      return jsonResponse({
        ok: true,
        results: result.results,
        runToken: formatSummaryRunToken(result.run.id, nonce),
      })
    }

    if (body.action === 'stop') {
      const reason = body.reason?.trim() || 'admin_manual_stop'
      const { data, error } = await supabase.rpc(
        'admin_stop_lecture_summary_run',
        {
          target_actor_id: actorId,
          target_lecture_session_id: body.lectureSessionId,
          target_reason: reason,
        },
      )
      if (error) throw error
      return jsonResponse({
        ok: true,
        results: (data as { results?: unknown }).results,
      })
    }

    if (!body.summaryId) {
      return jsonResponse({ message: 'summaryId is required.', ok: false }, 400)
    }
    const actionMap = {
      hide: 'hide',
      pin: 'pin',
      publish: 'publish',
      revisePublish: 'revise_publish',
      unpin: 'unpin',
    } as const
    const action = actionMap[body.action as keyof typeof actionMap]
    if (!action) {
      return jsonResponse({ message: 'Unknown action.', ok: false }, 400)
    }
    const revisionBody = body.revisionBody
      ? {
          comment_pulse: body.revisionBody.commentPulse ?? [],
          lecture_recap: body.revisionBody.lectureRecap ?? [],
        }
      : null
    const { data, error } = await supabase.rpc(
      'admin_manage_summary_publication',
      {
        target_action: action,
        target_actor_id: actorId,
        target_body: revisionBody,
        target_lecture_session_id: body.lectureSessionId,
        target_pinned_order: body.pinnedOrder ?? null,
        target_pinned_until: body.pinnedUntil ?? null,
        target_reason: body.reason ?? null,
        target_summary_id: body.summaryId,
      },
    )
    if (error) throw error
    return jsonResponse({ ok: true, results: data })
  } catch (error) {
    return errorResponse(jsonResponse, error)
  }
})
