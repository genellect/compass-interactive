import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.110.0'
import { getAdminTokenSecret, verifyAdminToken } from '../_shared/adminToken.ts'
import { handleCors } from '../_shared/cors.ts'
import { describeJsonBodyError, readJsonBody } from '../_shared/requestBody.ts'
import { createJsonResponse } from '../_shared/responses.ts'

type PollStatus = 'draft' | 'open' | 'closed'
type PollType = 'single' | 'multiple'

type ManagePollsRequest =
  | {
      action: 'list'
      adminToken?: string
      includeHistory?: boolean
      lectureSessionId?: string
    }
  | {
      action: 'create'
      adminToken?: string
      includeHistory?: boolean
      lectureSessionId?: string
      optionLabels?: string[]
      question?: string
      type?: PollType
    }
  | {
      action: 'open' | 'close'
      adminToken?: string
      includeHistory?: boolean
      lectureSessionId?: string
      pollId?: string
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

  if (
    !body.adminToken ||
    !(await verifyAdminToken(body.adminToken, tokenSecret, request))
  ) {
    return jsonResponse({ ok: false, message: 'Invalid Admin session.' }, 401)
  }

  if (!body.lectureSessionId) {
    return jsonResponse(
      { ok: false, message: 'lectureSessionId is required.' },
      400,
    )
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  })

  async function listPolls(lectureSessionId: string, includeHistory = false) {
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

      const { error } = await supabase.rpc('admin_create_poll', {
        option_labels: optionLabels,
        poll_question: question,
        poll_type: body.type,
        target_lecture_session_id: body.lectureSessionId,
      })

      if (error) {
        throw new Error(error.message)
      }
    } else if (body.action === 'open' || body.action === 'close') {
      if (!body.pollId) {
        return jsonResponse({ ok: false, message: 'pollId is required.' }, 400)
      }

      const { data: changed, error } = await supabase.rpc(
        'admin_set_poll_status',
        {
          target_lecture_session_id: body.lectureSessionId,
          target_poll_id: body.pollId,
          target_status: body.action === 'open' ? 'open' : 'closed',
        },
      )

      if (error) {
        throw new Error(error.message)
      }
      if (!changed) {
        return jsonResponse(
          { ok: false, message: 'Poll status transition is not allowed.' },
          409,
        )
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
