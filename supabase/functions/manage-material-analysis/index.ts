import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.110.0'
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

type RequestBody = {
  action?: 'list' | 'adopt' | 'reject' | 'publishSummary' | 'hideSummary'
  adminToken?: string
  analysisId?: string
  lectureSessionId?: string
  optionLabels?: string[]
  pollType?: 'single' | 'multiple'
  proposalId?: string
  question?: string
  reviewState?: 'admin_confirmed' | 'admin_revised'
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

Deno.serve(async (request) => {
  const jsonResponse = createJsonResponse(request)
  const corsResponse = handleCors(request)
  if (corsResponse) return corsResponse
  if (request.method !== 'POST') {
    return jsonResponse({ message: 'Method not allowed.', ok: false }, 405)
  }
  if (Deno.env.get('PHASE5_MATERIAL_ANALYSIS_ENABLED') !== 'true') {
    return jsonResponse(
      { message: 'Material analysis is disabled.', ok: false },
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
      {
        message: 'Admin session, lecture, and action are required.',
        ok: false,
      },
      400,
    )
  }

  let actorId: string
  let actorSessionId: string | null
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
    actorSessionId =
      claims.sid &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        claims.sid,
      )
        ? claims.sid
        : null
  } catch {
    return jsonResponse({ message: 'Admin auth failed.', ok: false }, 500)
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!supabaseUrl || !serviceRoleKey) {
    return jsonResponse(
      { message: 'Material analysis is not configured.', ok: false },
      503,
    )
  }
  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  })

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
            message: '要点を公開する前に、管理画面へ再ログインしてください。',
            ok: false,
          },
          401,
        )
      }
      const summaryBody = normalizeMaterialSummaryBody(body.summaryBody)
      if (
        !body.analysisId ||
        !summaryBody ||
        !body.reviewState ||
        !['admin_confirmed', 'admin_revised'].includes(body.reviewState)
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
          target_body: summaryBody,
          target_lecture_session_id: body.lectureSessionId,
          target_review_state: body.reviewState,
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
