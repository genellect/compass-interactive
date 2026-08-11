import { createClient } from 'npm:@supabase/supabase-js@2'
import {
  getAdminActorId,
  getAdminTokenClaims,
  getAdminTokenSecret,
} from '../_shared/adminToken.ts'
import { handleCors } from '../_shared/cors.ts'
import {
  readJsonBody,
  RequestBodyTooLargeError,
  UnsupportedJsonContentTypeError,
} from '../_shared/requestBody.ts'
import { createJsonResponse } from '../_shared/responses.ts'
import {
  type GoogleAdminOperationContext,
  verifyGoogleAdminOperationRequest,
} from '../_shared/googleAdminOperations.ts'

type RequestBody = {
  action?: 'list' | 'adopt' | 'reject' | 'publishSummary' | 'hideSummary'
  adminToken?: string
  appSessionToken?: string
  analysisId?: string
  lectureSessionId?: string
  optionLabels?: string[]
  pollType?: 'single' | 'multiple'
  proposalId?: string
  question?: string
  reviewState?: 'admin_confirmed' | 'admin_revised'
  requestId?: string
  summaryBody?: {
    lead?: string
    points?: Array<{
      detail?: string
      pageLabel?: string
      title?: string
    }>
    reflectionQuestion?: string
  }
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function normalizeMaterialSummaryBody(value: RequestBody['summaryBody']) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const lead = value.lead?.trim() ?? ''
  const reflectionQuestion = value.reflectionQuestion?.trim() ?? ''
  if (lead.length < 1 || lead.length > 1_200) return null
  if (
    !Array.isArray(value.points) ||
    value.points.length < 1 ||
    value.points.length > 3 ||
    reflectionQuestion.length > 300
  ) {
    return null
  }
  const points = value.points.map((point) => ({
    detail: point.detail?.trim() ?? '',
    pageLabel: point.pageLabel?.trim() ?? '',
    title: point.title?.trim() ?? '',
  }))
  if (
    points.some(
      (point) =>
        point.pageLabel.length < 1 ||
        point.pageLabel.length > 30 ||
        point.title.length < 1 ||
        point.title.length > 160 ||
        point.detail.length > 500,
    )
  ) {
    return null
  }
  return {
    lead,
    points,
    reflectionQuestion,
  }
}

function hasUnexpectedFields(
  body: RequestBody,
  keys: Array<keyof RequestBody>,
) {
  return keys.some((key) => body[key] != null)
}

Deno.serve(async (request) => {
  const jsonResponse = createJsonResponse(request)
  const corsResponse = handleCors(request)
  if (corsResponse) return corsResponse
  if (request.method !== 'POST') {
    return jsonResponse({ message: 'Method not allowed.', ok: false }, 405)
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
  if (
    !body.action ||
    !['list', 'adopt', 'reject', 'publishSummary', 'hideSummary'].includes(
      body.action,
    ) ||
    !body.lectureSessionId ||
    !UUID_PATTERN.test(body.lectureSessionId)
  ) {
    return jsonResponse(
      {
        message: 'Admin session, lecture, and action are required.',
        ok: false,
      },
      400,
    )
  }

  if (
    ['adopt', 'publishSummary'].includes(body.action) &&
    Deno.env.get('PHASE5_MATERIAL_ANALYSIS_ENABLED') !== 'true'
  ) {
    return jsonResponse(
      { message: 'Material analysis is disabled.', ok: false },
      503,
    )
  }

  const hasGoogleCredential = Boolean(body.appSessionToken)
  const hasLegacyCredential = Boolean(body.adminToken)
  if (hasGoogleCredential === hasLegacyCredential) {
    return jsonResponse(
      { message: 'Exactly one Admin credential is required.', ok: false },
      400,
    )
  }

  let actorId = ''
  let actorSessionId: string | null = null
  let googleContext: GoogleAdminOperationContext | null = null
  if (body.appSessionToken) {
    const verification = await verifyGoogleAdminOperationRequest(
      request,
      body.appSessionToken,
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
  } else {
    try {
      const claims = await getAdminTokenClaims(
        body.adminToken ?? '',
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
      actorSessionId =
        claims.sid && UUID_PATTERN.test(claims.sid) ? claims.sid : null
    } catch {
      return jsonResponse({ message: 'Admin auth failed.', ok: false }, 500)
    }
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!supabaseUrl || !serviceRoleKey) {
    return jsonResponse(
      { message: 'Material analysis is not configured.', ok: false },
      503,
    )
  }
  const supabase =
    googleContext?.serviceClient ??
    createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false },
    })

  if (googleContext) {
    if (body.action === 'list') {
      const { data, error } = await supabase.rpc(
        'get_google_admin_material_analysis_v1',
        {
          target_auth_user_id: googleContext.authUserId,
          target_google_issuer: googleContext.googleIssuer,
          target_lecture_session_id: body.lectureSessionId,
          target_provider_subject_hmac: googleContext.googleSubjectHmac,
          target_subject_pepper_version: googleContext.subjectPepperVersion,
          target_supabase_auth_session_id: googleContext.supabaseAuthSessionId,
          target_token_hash: googleContext.appSessionTokenHash,
          target_transport_enabled: googleContext.transportEnabled,
        },
      )
      if (error || !data) {
        return jsonResponse(
          { message: 'Material analysis could not be loaded.', ok: false },
          error ? 503 : 404,
        )
      }
      return jsonResponse({ ok: true, pollId: null, results: data })
    }

    if (!body.requestId || !UUID_PATTERN.test(body.requestId)) {
      return jsonResponse({ message: 'requestId is required.', ok: false }, 400)
    }
    const normalizedSummary = normalizeMaterialSummaryBody(body.summaryBody)
    if (body.action === 'adopt') {
      const options = body.optionLabels?.map((option) => option.trim())
      if (
        !body.proposalId ||
        !UUID_PATTERN.test(body.proposalId) ||
        !body.question?.trim() ||
        !body.pollType ||
        !options ||
        options.length < 2 ||
        hasUnexpectedFields(body, ['analysisId', 'reviewState', 'summaryBody'])
      ) {
        return jsonResponse(
          { message: 'Edited Poll draft fields are required.', ok: false },
          400,
        )
      }
    } else if (body.action === 'reject') {
      if (
        !body.proposalId ||
        !UUID_PATTERN.test(body.proposalId) ||
        hasUnexpectedFields(body, [
          'analysisId',
          'optionLabels',
          'pollType',
          'question',
          'reviewState',
          'summaryBody',
        ])
      ) {
        return jsonResponse(
          { message: 'proposalId is required.', ok: false },
          400,
        )
      }
    } else if (body.action === 'publishSummary') {
      if (
        !body.analysisId ||
        !UUID_PATTERN.test(body.analysisId) ||
        !normalizedSummary ||
        !body.reviewState ||
        hasUnexpectedFields(body, [
          'optionLabels',
          'pollType',
          'proposalId',
          'question',
        ])
      ) {
        return jsonResponse(
          {
            message: 'Reviewed material summary fields are required.',
            ok: false,
          },
          400,
        )
      }
    } else if (
      !body.analysisId ||
      !UUID_PATTERN.test(body.analysisId) ||
      hasUnexpectedFields(body, [
        'optionLabels',
        'pollType',
        'proposalId',
        'question',
        'reviewState',
        'summaryBody',
      ])
    ) {
      return jsonResponse(
        { message: 'analysisId is required.', ok: false },
        400,
      )
    }

    const { data, error } = await supabase.rpc(
      'manage_google_admin_material_analysis_v1',
      {
        target_action: body.action,
        target_analysis_id:
          body.action === 'publishSummary' || body.action === 'hideSummary'
            ? (body.analysisId ?? null)
            : null,
        target_auth_user_id: googleContext.authUserId,
        target_google_issuer: googleContext.googleIssuer,
        target_lecture_session_id: body.lectureSessionId,
        target_option_labels:
          body.action === 'adopt' ? (body.optionLabels ?? null) : null,
        target_poll_type:
          body.action === 'adopt' ? (body.pollType ?? null) : null,
        target_proposal_id:
          body.action === 'adopt' || body.action === 'reject'
            ? (body.proposalId ?? null)
            : null,
        target_provider_subject_hmac: googleContext.googleSubjectHmac,
        target_question:
          body.action === 'adopt' ? (body.question ?? null) : null,
        target_request_id: body.requestId,
        target_review_state:
          body.action === 'publishSummary' ? (body.reviewState ?? null) : null,
        target_subject_pepper_version: googleContext.subjectPepperVersion,
        target_summary_body:
          body.action === 'publishSummary' ? normalizedSummary : null,
        target_supabase_auth_session_id: googleContext.supabaseAuthSessionId,
        target_token_hash: googleContext.appSessionTokenHash,
        target_transport_enabled: googleContext.transportEnabled,
      },
    )
    const result = data as {
      ok?: boolean
      pollId?: string | null
      refreshRequired?: boolean
      results?: unknown
    } | null
    if (error) {
      return jsonResponse(
        { message: 'Material analysis operation failed.', ok: false },
        error.code === '22023' || error.code === 'P7335' ? 400 : 409,
      )
    }
    if (result?.ok !== true) {
      return jsonResponse(
        {
          message: 'Material analysis operation was not confirmed.',
          ok: false,
        },
        409,
      )
    }

    let results = result.results ?? null
    if (result.refreshRequired === true) {
      const refreshed = await supabase.rpc(
        'get_google_admin_material_analysis_v1',
        {
          target_auth_user_id: googleContext.authUserId,
          target_google_issuer: googleContext.googleIssuer,
          target_lecture_session_id: body.lectureSessionId,
          target_provider_subject_hmac: googleContext.googleSubjectHmac,
          target_subject_pepper_version: googleContext.subjectPepperVersion,
          target_supabase_auth_session_id: googleContext.supabaseAuthSessionId,
          target_token_hash: googleContext.appSessionTokenHash,
          target_transport_enabled: googleContext.transportEnabled,
        },
      )
      if (!refreshed.error && refreshed.data) {
        results = refreshed.data
      }
    }
    return jsonResponse({ ok: true, pollId: result.pollId ?? null, results })
  }

  try {
    let pollId: string | null = null
    if (body.action === 'adopt') {
      const question = body.question?.trim()
      const options = body.optionLabels?.map((option) => option.trim())
      if (
        !body.proposalId ||
        !question ||
        !body.pollType ||
        !options ||
        options.length < 2
      ) {
        return jsonResponse(
          { message: 'Edited Poll draft fields are required.', ok: false },
          400,
        )
      }
      const { data, error } = await supabase.rpc('admin_adopt_poll_proposal', {
        option_labels: options,
        poll_question: question,
        poll_type: body.pollType,
        target_actor_id: actorId,
        target_lecture_session_id: body.lectureSessionId,
        target_proposal_id: body.proposalId,
      })
      if (error) throw error
      pollId = data as string
    } else if (body.action === 'reject') {
      if (!body.proposalId) {
        return jsonResponse(
          { message: 'proposalId is required.', ok: false },
          400,
        )
      }
      const { error } = await supabase.rpc('admin_reject_poll_proposal', {
        target_actor_id: actorId,
        target_lecture_session_id: body.lectureSessionId,
        target_proposal_id: body.proposalId,
      })
      if (error) throw error
    } else if (
      body.action === 'publishSummary' ||
      body.action === 'hideSummary'
    ) {
      if (!actorSessionId) {
        return jsonResponse(
          {
            message: '続行するには、管理画面へ再度ログインしてください。',
            ok: false,
          },
          401,
        )
      }
      const summaryBody = normalizeMaterialSummaryBody(body.summaryBody)
      if (
        !body.analysisId ||
        (body.action === 'publishSummary' &&
          (!summaryBody ||
            !body.reviewState ||
            !['admin_confirmed', 'admin_revised'].includes(body.reviewState)))
      ) {
        return jsonResponse(
          {
            message: 'Reviewed material summary fields are required.',
            ok: false,
          },
          400,
        )
      }
      const { error } = await supabase.rpc(
        'admin_set_material_summary_publication',
        {
          target_actor_id: actorSessionId,
          target_analysis_id: body.analysisId,
          target_body: summaryBody ?? null,
          target_lecture_session_id: body.lectureSessionId,
          target_review_state: body.reviewState ?? null,
          target_visibility:
            body.action === 'publishSummary' ? 'public' : 'hidden',
        },
      )
      if (error) throw error
    } else if (body.action !== 'list') {
      return jsonResponse({ message: 'Unknown action.', ok: false }, 400)
    }

    const { data, error } = await supabase.rpc(
      'admin_list_material_ai_results',
      { target_lecture_session_id: body.lectureSessionId },
    )
    if (error) throw error
    return jsonResponse({ ok: true, pollId, results: data })
  } catch {
    return jsonResponse(
      { message: 'Material analysis operation failed.', ok: false },
      409,
    )
  }
})
