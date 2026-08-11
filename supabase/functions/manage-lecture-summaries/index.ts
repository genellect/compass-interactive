import { createClient } from 'npm:@supabase/supabase-js@2'
import {
  deriveGoogleSummaryRunNonce,
  parseBillingGrantToken,
  sha256Hex,
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
  academicSourcePolicy?: 'auto' | 'biomedical_pubmed' | 'multidisciplinary_doi'
  autoAcademicAnswers?: boolean
  appSessionToken?: string
  billingGrant?: string
  lectureSessionId?: string
  pinnedOrder?: number | null
  pinnedUntil?: string | null
  reason?: string | null
  requestId?: string
  revisionBody?: {
    commentPulse?: string[]
    lectureRecap?: string[]
  } | null
  summaryId?: string
}

function isUuid(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    )
  )
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
  const summariesTransportEnabled =
    Deno.env.get('PHASE6_SUMMARIES_ENABLED') === 'true'

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
  if (!body.action || !body.lectureSessionId) {
    return jsonResponse(
      { message: 'Lecture and action are required.', ok: false },
      400,
    )
  }

  const hasGoogleCredential =
    typeof body.appSessionToken === 'string' &&
    body.appSessionToken.trim().length > 0
  const hasLegacyCredential =
    typeof body.adminToken === 'string' && body.adminToken.trim().length > 0
  if (hasGoogleCredential === hasLegacyCredential) {
    return jsonResponse(
      { message: 'Exactly one Admin credential is required.', ok: false },
      401,
    )
  }
  if (
    !summariesTransportEnabled &&
    !(hasGoogleCredential && body.action === 'stop')
  ) {
    return jsonResponse(
      { message: 'Five-minute summaries are disabled.', ok: false },
      503,
    )
  }
  const isGoogleSchedulerAction = ['start', 'resume', 'stop'].includes(
    body.action,
  )
  if (
    hasGoogleCredential &&
    (!isGoogleSchedulerAction ||
      !isUuid(body.requestId) ||
      body.billingGrant !== undefined)
  ) {
    return jsonResponse(
      {
        message: isGoogleSchedulerAction
          ? 'A valid summary request ID is required.'
          : 'This summary action is not available for this sign-in.',
        ok: false,
      },
      isGoogleSchedulerAction ? 400 : 409,
    )
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!supabaseUrl || !serviceRoleKey) {
    return jsonResponse(
      { message: 'Lecture summaries are not configured.', ok: false },
      503,
    )
  }
  let supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  })
  let actorId: string | null = null
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
    try {
      const claims = await getAdminTokenClaims(
        body.adminToken!,
        getAdminTokenSecret(),
        request,
      )
      if (!claims) {
        return jsonResponse(
          { message: 'Invalid Admin session.', ok: false },
          401,
        )
      }
      actorId = getAdminActorId(claims)
    } catch {
      return jsonResponse({ message: 'Admin auth failed.', ok: false }, 500)
    }
  }

  const googleRpcIdentity = googleContext
    ? {
        target_auth_user_id: googleContext.authUserId,
        target_google_issuer: googleContext.googleIssuer,
        target_provider_subject_hmac: googleContext.googleSubjectHmac,
        target_subject_pepper_version: googleContext.subjectPepperVersion,
        target_supabase_auth_session_id: googleContext.supabaseAuthSessionId,
        target_token_hash: googleContext.appSessionTokenHash,
      }
    : null

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
      if (googleContext && body.autoAcademicAnswers === true) {
        return jsonResponse(
          {
            code: 'automatic_academic_answers_unavailable',
            message:
              'Start lecture summaries without automatic reference answers.',
            ok: false,
          },
          409,
        )
      }
      if (!body.billingGrant) {
        if (!googleContext) {
          return jsonResponse(
            { message: 'Billing authorization is required.', ok: false },
            400,
          )
        }
      }
      const sourcePolicy = body.academicSourcePolicy ?? 'auto'
      if (
        !['auto', 'biomedical_pubmed', 'multidisciplinary_doi'].includes(
          sourcePolicy,
        )
      ) {
        return jsonResponse(
          { message: 'Academic source policy is invalid.', ok: false },
          400,
        )
      }
      if (
        body.autoAcademicAnswers === true &&
        Deno.env.get('PHASE7_25_AUTO_ACADEMIC_ANSWERS_ENABLED') !== 'true'
      ) {
        return jsonResponse(
          {
            message: 'Automatic academic reference answers are disabled.',
            ok: false,
          },
          503,
        )
      }
      if (googleContext && googleRpcIdentity) {
        let nonce: string
        try {
          nonce = await deriveGoogleSummaryRunNonce({
            action: 'start',
            lectureSessionId: body.lectureSessionId,
            requestId: body.requestId!,
          })
        } catch {
          return jsonResponse(
            {
              code: 'google_summary_not_configured',
              message: 'Lecture summaries are not configured.',
              ok: false,
            },
            503,
          )
        }
        const { data, error } = await supabase.rpc(
          'manage_google_admin_summary_run_v1',
          {
            ...googleRpcIdentity,
            target_academic_source_policy: sourcePolicy,
            target_action: 'start',
            target_auto_academic_answers_enabled: false,
            target_lecture_session_id: body.lectureSessionId,
            target_reason: null,
            target_request_id: body.requestId,
            target_run_token_hash: await sha256Hex(nonce),
            target_transport_enabled:
              googleContext.transportEnabled && summariesTransportEnabled,
          },
        )
        if (error) throw error
        const result = data as {
          accepted?: boolean
          idempotentReplay?: boolean
          reason?: string
          refreshRequired?: boolean
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
        if (result.refreshRequired) {
          return jsonResponse(
            {
              code: 'summary_run_refresh_required',
              message: 'Resume the current summary run to continue.',
              ok: false,
              results: result.results,
            },
            409,
          )
        }
        return jsonResponse({
          idempotentReplay: result.idempotentReplay === true,
          ok: true,
          results: result.results,
          runToken: formatSummaryRunToken(result.run.id, nonce),
        })
      }

      const billing = parseBillingGrantToken(body.billingGrant!)
      const nonce = createSummaryRunNonce()
      const { data, error } = await supabase.rpc(
        'admin_start_lecture_summary_run_v2',
        {
          target_actor_id: actorId!,
          target_academic_source_policy: sourcePolicy,
          target_auto_academic_answers_enabled:
            body.autoAcademicAnswers === true,
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
      if (googleContext && googleRpcIdentity) {
        let nonce: string
        try {
          nonce = await deriveGoogleSummaryRunNonce({
            action: 'resume',
            lectureSessionId: body.lectureSessionId,
            requestId: body.requestId!,
          })
        } catch {
          return jsonResponse(
            {
              code: 'google_summary_not_configured',
              message: 'Lecture summaries are not configured.',
              ok: false,
            },
            503,
          )
        }
        const { data, error } = await supabase.rpc(
          'manage_google_admin_summary_run_v1',
          {
            ...googleRpcIdentity,
            target_academic_source_policy: null,
            target_action: 'resume',
            target_auto_academic_answers_enabled: null,
            target_lecture_session_id: body.lectureSessionId,
            target_reason: null,
            target_request_id: body.requestId,
            target_run_token_hash: await sha256Hex(nonce),
            target_transport_enabled:
              googleContext.transportEnabled && summariesTransportEnabled,
          },
        )
        if (error) throw error
        const result = data as {
          accepted?: boolean
          idempotentReplay?: boolean
          reason?: string
          refreshRequired?: boolean
          results?: unknown
          run?: { id?: string }
        }
        if (!result.accepted || !result.run?.id || result.refreshRequired) {
          return jsonResponse(
            {
              code: result.refreshRequired
                ? 'summary_run_refresh_required'
                : 'summary_run_not_active',
              message: result.refreshRequired
                ? 'Start a new resume request to continue.'
                : 'The summary run is no longer active.',
              ok: false,
              reason: result.reason,
              results: result.results,
            },
            409,
          )
        }
        return jsonResponse({
          idempotentReplay: result.idempotentReplay === true,
          ok: true,
          results: result.results,
          runToken: formatSummaryRunToken(result.run.id, nonce),
        })
      }

      const nonce = createSummaryRunNonce()
      const { data, error } = await supabase.rpc(
        'admin_resume_lecture_summary_run',
        {
          target_actor_id: actorId!,
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
      if (googleContext && googleRpcIdentity) {
        const { data, error } = await supabase.rpc(
          'manage_google_admin_summary_run_v1',
          {
            ...googleRpcIdentity,
            target_academic_source_policy: null,
            target_action: 'stop',
            target_auto_academic_answers_enabled: null,
            target_lecture_session_id: body.lectureSessionId,
            target_reason: reason,
            target_request_id: body.requestId,
            target_run_token_hash: null,
            target_transport_enabled: googleContext.transportEnabled,
          },
        )
        if (error) throw error
        const result = data as {
          accepted?: boolean
          idempotentReplay?: boolean
          reason?: string
        }
        if (!result.accepted) {
          return jsonResponse(
            {
              message: 'Summary run could not be stopped.',
              ok: false,
              reason: result.reason,
            },
            409,
          )
        }
        return jsonResponse({
          idempotentReplay: result.idempotentReplay === true,
          ok: true,
        })
      }

      const { data, error } = await supabase.rpc(
        'admin_stop_lecture_summary_run',
        {
          target_actor_id: actorId!,
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
        target_actor_id: actorId!,
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
