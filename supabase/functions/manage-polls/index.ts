import { createClient } from 'npm:@supabase/supabase-js@2'
import { getAdminTokenSecret, verifyAdminToken } from '../_shared/adminToken.ts'
import { handleCors } from '../_shared/cors.ts'
import {
  type GoogleAdminOperationContext,
  verifyGoogleAdminOperationRequest,
} from '../_shared/googleAdminOperations.ts'
import { describeJsonBodyError, readJsonBody } from '../_shared/requestBody.ts'
import { createJsonResponse } from '../_shared/responses.ts'

type PollStatus = 'draft' | 'open' | 'closed'
type PollType = 'single' | 'multiple'

type ManagePollsRequest =
  | {
      action: 'list'
      adminToken?: string
      appSessionToken?: string
      includeHistory?: boolean
      lectureSessionId?: string
      requestId?: string
    }
  | {
      action: 'create'
      adminToken?: string
      appSessionToken?: string
      includeHistory?: boolean
      lectureSessionId?: string
      optionLabels?: string[]
      question?: string
      requestId?: string
      type?: PollType
    }
  | {
      action: 'open' | 'close'
      adminToken?: string
      appSessionToken?: string
      includeHistory?: boolean
      lectureSessionId?: string
      pollId?: string
      requestId?: string
    }

type PollRow = {
  created_at: string
  id: string
  lecture_session_id: string
  question: string
  status: PollStatus
  type: PollType
  updated_at: string
}

type PollOptionRow = {
  display_order: number
  id: string
  label: string
  poll_id: string
}

type PollOptionTotalRow = {
  option_id: string
  response_count: number
}

type JournalClubPollSlotRow = {
  display_order: number
  poll_id: string
}

const DEFAULT_RECENT_POLL_LIMIT = 5
const HISTORY_RECENT_POLL_LIMIT = 100
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

Deno.serve(async (request) => {
  const jsonResponse = createJsonResponse(request)
  const corsResponse = handleCors(request)
  if (corsResponse) {
    return corsResponse
  }

  if (request.method !== 'POST') {
    return jsonResponse({ ok: false, message: 'Method not allowed.' }, 405)
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!supabaseUrl || !serviceRoleKey) {
    return jsonResponse(
      { ok: false, message: 'Poll management is not configured.' },
      500,
    )
  }

  let body: ManagePollsRequest
  try {
    body = await readJsonBody<ManagePollsRequest>(request, 64 * 1024)
  } catch (error) {
    const bodyError = describeJsonBodyError(error)
    return jsonResponse(
      { ok: false, message: bodyError.message },
      bodyError.status,
    )
  }

  if (!body.lectureSessionId) {
    return jsonResponse(
      { ok: false, message: 'lectureSessionId is required.' },
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
      { ok: false, message: 'Exactly one Admin credential is required.' },
      401,
    )
  }
  if (
    hasGoogleCredential &&
    body.action !== 'list' &&
    !UUID_PATTERN.test(body.requestId ?? '')
  ) {
    return jsonResponse({ ok: false, message: 'requestId is required.' }, 400)
  }

  let googleContext: GoogleAdminOperationContext | null = null
  let supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  })

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
    if (!(await verifyAdminToken(body.adminToken!, tokenSecret, request))) {
      return jsonResponse({ ok: false, message: 'Invalid Admin session.' }, 401)
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
        target_transport_enabled: googleContext.transportEnabled,
      }
    : null

  async function listPolls(lectureSessionId: string, includeHistory = false) {
    if (googleRpcIdentity) {
      const { data, error } = await supabase.rpc(
        'manage_google_admin_polls_v1',
        {
          ...googleRpcIdentity,
          target_action: 'list',
          target_include_history: includeHistory,
          target_lecture_session_id: lectureSessionId,
          target_option_labels: null,
          target_poll_id: null,
          target_poll_type: null,
          target_question: null,
          target_request_id: null,
        },
      )
      if (error) throw new Error(error.message)
      const result = data as {
        hasMore?: unknown
        ok?: boolean
        polls?: unknown
      }
      if (
        result?.ok !== true ||
        typeof result.hasMore !== 'boolean' ||
        !Array.isArray(result.polls)
      ) {
        throw new Error('Google Admin poll list is unavailable.')
      }
      return { hasMore: result.hasMore, polls: result.polls }
    }

    const recentLimit = includeHistory
      ? HISTORY_RECENT_POLL_LIMIT
      : DEFAULT_RECENT_POLL_LIMIT
    const pollColumns =
      'id,lecture_session_id,question,type,status,created_at,updated_at'
    const [
      { data: openPollRows, error: openPollError },
      { data: recentPollRows, error: recentPollError },
    ] = await Promise.all([
      supabase
        .from('polls')
        .select(pollColumns)
        .eq('lecture_session_id', lectureSessionId)
        .eq('status', 'open')
        .order('created_at', { ascending: false })
        .limit(1),
      supabase
        .from('polls')
        .select(pollColumns)
        .eq('lecture_session_id', lectureSessionId)
        .neq('status', 'open')
        .order('created_at', { ascending: false })
        .limit(recentLimit + 1),
    ])

    if (openPollError) {
      throw new Error(openPollError.message)
    }
    if (recentPollError) {
      throw new Error(recentPollError.message)
    }

    const recentPolls = (recentPollRows ?? []) as PollRow[]
    const pollById = new Map<string, PollRow>()
    for (const poll of [
      ...((openPollRows ?? []) as PollRow[]),
      ...recentPolls.slice(0, recentLimit),
    ]) {
      if (!pollById.has(poll.id)) {
        pollById.set(poll.id, poll)
      }
    }
    const polls = [...pollById.values()]
    const hasMore = recentPolls.length > recentLimit
    const pollIds = polls.map((poll) => poll.id)
    if (pollIds.length === 0) {
      return { hasMore, polls: [] }
    }

    const [
      { data: optionRows, error: optionError },
      { data: totalRows, error: totalError },
      { data: slotRows, error: slotError },
    ] = await Promise.all([
      supabase
        .from('poll_options')
        .select('id,poll_id,label,display_order')
        .in('poll_id', pollIds)
        .order('display_order', { ascending: true }),
      supabase
        .from('poll_option_totals')
        .select('option_id,response_count')
        .in('poll_id', pollIds),
      Deno.env.get('PHASE7_27_JOURNAL_CLUB_ENABLED') === 'true'
        ? supabase
            .from('phase727_journal_club_poll_slots')
            .select('poll_id,display_order')
            .in('poll_id', pollIds)
        : Promise.resolve({ data: [], error: null }),
    ])

    if (optionError) {
      throw new Error(optionError.message)
    }
    if (totalError) {
      throw new Error(totalError.message)
    }
    if (slotError) {
      throw new Error(slotError.message)
    }

    const countByOptionId = new Map(
      ((totalRows ?? []) as PollOptionTotalRow[]).map((total) => [
        total.option_id,
        Number(total.response_count),
      ]),
    )
    const optionsByPollId = new Map<string, PollOptionRow[]>()
    const templateOrderByPollId = new Map(
      ((slotRows ?? []) as JournalClubPollSlotRow[]).map((slot) => [
        slot.poll_id,
        Number(slot.display_order),
      ]),
    )
    for (const option of (optionRows ?? []) as PollOptionRow[]) {
      const options = optionsByPollId.get(option.poll_id) ?? []
      options.push(option)
      optionsByPollId.set(option.poll_id, options)
    }

    return {
      hasMore,
      polls: polls
        .map((poll) => ({
          createdAt: poll.created_at,
          id: poll.id,
          lectureSessionId: poll.lecture_session_id,
          options: (optionsByPollId.get(poll.id) ?? []).map((option) => ({
            id: option.id,
            label: option.label,
            order: option.display_order,
            responseCount: countByOptionId.get(option.id) ?? 0,
          })),
          question: poll.question,
          status: poll.status,
          templateOrder: templateOrderByPollId.get(poll.id) ?? null,
          type: poll.type,
          updatedAt: poll.updated_at,
        }))
        .sort((left, right) => {
          if (left.templateOrder === null && right.templateOrder === null) {
            return 0
          }
          if (left.templateOrder === null) return 1
          if (right.templateOrder === null) return -1
          return left.templateOrder - right.templateOrder
        }),
    }
  }

  try {
    if (body.action === 'list') {
      return jsonResponse({
        ok: true,
        ...(await listPolls(body.lectureSessionId, body.includeHistory)),
      })
    }

    if (body.action === 'create') {
      const question = body.question?.trim()
      const optionLabels = body.optionLabels?.map((option) => option.trim())
      if (!question || !body.type || !optionLabels) {
        return jsonResponse(
          {
            ok: false,
            message: 'Poll question, type, and options are required.',
          },
          400,
        )
      }

      const { data, error } = googleRpcIdentity
        ? await supabase.rpc('manage_google_admin_polls_v1', {
            ...googleRpcIdentity,
            target_action: 'create',
            target_include_history: body.includeHistory ?? false,
            target_lecture_session_id: body.lectureSessionId,
            target_option_labels: optionLabels,
            target_poll_id: null,
            target_poll_type: body.type,
            target_question: question,
            target_request_id: body.requestId,
          })
        : await supabase.rpc('admin_create_poll', {
            option_labels: optionLabels,
            poll_question: question,
            poll_type: body.type,
            target_lecture_session_id: body.lectureSessionId,
          })

      if (error) {
        throw new Error(error.message)
      }
      if (googleRpcIdentity) {
        const result = data as {
          hasMore?: unknown
          ok?: boolean
          polls?: unknown
          refreshRequired?: boolean
        } | null
        if (
          result?.ok !== true ||
          typeof result.hasMore !== 'boolean' ||
          !Array.isArray(result.polls)
        ) {
          throw new Error('Google Admin poll creation was not confirmed.')
        }
        if (result.refreshRequired === true) {
          try {
            return jsonResponse({
              ...result,
              ...(await listPolls(
                body.lectureSessionId,
                body.includeHistory ?? false,
              )),
              refreshRequired: false,
            })
          } catch {
            return jsonResponse({ ...result, refreshRequired: true })
          }
        }
        return jsonResponse(result)
      }
    } else if (body.action === 'open' || body.action === 'close') {
      if (!body.pollId) {
        return jsonResponse({ ok: false, message: 'pollId is required.' }, 400)
      }

      const { data: changed, error } = googleRpcIdentity
        ? await supabase.rpc('manage_google_admin_polls_v1', {
            ...googleRpcIdentity,
            target_action: body.action,
            target_include_history: body.includeHistory ?? false,
            target_lecture_session_id: body.lectureSessionId,
            target_option_labels: null,
            target_poll_id: body.pollId,
            target_poll_type: null,
            target_question: null,
            target_request_id: body.requestId,
          })
        : await supabase.rpc('admin_set_poll_status', {
            target_lecture_session_id: body.lectureSessionId,
            target_poll_id: body.pollId,
            target_status: body.action === 'open' ? 'open' : 'closed',
          })

      if (error) {
        throw new Error(error.message)
      }
      if (
        !changed ||
        (googleRpcIdentity &&
          ((changed as { ok?: boolean }).ok !== true ||
            !Array.isArray((changed as { polls?: unknown }).polls)))
      ) {
        return jsonResponse(
          { ok: false, message: 'Poll status transition is not allowed.' },
          409,
        )
      }
      if (googleRpcIdentity) {
        if ((changed as { refreshRequired?: boolean }).refreshRequired) {
          try {
            return jsonResponse({
              ...(changed as Record<string, unknown>),
              ...(await listPolls(
                body.lectureSessionId,
                body.includeHistory ?? false,
              )),
              refreshRequired: false,
            })
          } catch {
            return jsonResponse({
              ...(changed as Record<string, unknown>),
              refreshRequired: true,
            })
          }
        }
        return jsonResponse(changed)
      }
    } else {
      return jsonResponse({ ok: false, message: 'Unknown action.' }, 400)
    }

    return jsonResponse({
      ok: true,
      ...(await listPolls(
        body.lectureSessionId,
        'includeHistory' in body && body.includeHistory,
      )),
    })
  } catch (error) {
    return jsonResponse(
      {
        ok: false,
        message:
          error instanceof Error ? error.message : 'Poll operation failed.',
      },
      500,
    )
  }
})
