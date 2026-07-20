import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.110.0'
import { getAdminTokenSecret, verifyAdminToken } from '../_shared/adminToken.ts'
import { handleCors } from '../_shared/cors.ts'
import { describeJsonBodyError, readJsonBody } from '../_shared/requestBody.ts'
import {
  getDisplayTokenClaims,
  getDisplayTokenSecret,
  getDisplayTerminalTokenClaims,
} from '../_shared/displayToken.ts'
import { createJsonResponse } from '../_shared/responses.ts'

type OperatorSnapshotRequest = {
  action?: 'commentHistory' | 'snapshot'
  adminToken?: string
  commentCursorCreatedAt?: string | null
  commentCursorId?: string | null
  displayToken?: string
  knownCaptionVersion?: number | null
  knownCommentsVersion?: number | null
  knownLectureVersion?: number | null
  knownLikesVersion?: number | null
  knownMetricsVersion?: number | null
  knownPdfVersion?: number | null
  knownPollsVersion?: number | null
  knownSummariesVersion?: number | null
  lectureSessionId?: string
  limit?: number
}

type OperatorAccess = {
  mode: 'live' | 'terminal' | 'unavailable'
  terminal?: Record<string, unknown> | null
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  )
}

function boundedVersion(value: unknown) {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
    ? value
    : null
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

  let body: OperatorSnapshotRequest
  try {
    body = await readJsonBody<OperatorSnapshotRequest>(request, 32 * 1024)
  } catch (error) {
    const bodyError = describeJsonBodyError(error)
    return jsonResponse(
      { ok: false, message: bodyError.message },
      bodyError.status,
    )
  }

  if (!body.lectureSessionId || !isUuid(body.lectureSessionId)) {
    return jsonResponse(
      { ok: false, message: 'lectureSessionId is required.' },
      400,
    )
  }
  if (Boolean(body.adminToken) === Boolean(body.displayToken)) {
    return jsonResponse(
      {
        ok: false,
        message: 'Provide exactly one operator credential.',
      },
      400,
    )
  }
  if (
    body.action !== undefined &&
    body.action !== 'snapshot' &&
    body.action !== 'commentHistory'
  ) {
    return jsonResponse({ ok: false, message: 'Unknown action.' }, 400)
  }

  let credentialKind: 'admin' | 'display' | null = null
  let terminalOnly = false
  try {
    if (body.adminToken) {
      credentialKind = (await verifyAdminToken(
        body.adminToken,
        getAdminTokenSecret(),
        request,
      ))
        ? 'admin'
        : null
    } else if (body.displayToken) {
      const liveClaims = await getDisplayTokenClaims(
        body.displayToken,
        getDisplayTokenSecret(),
      )
      if (liveClaims?.lectureSessionId === body.lectureSessionId) {
        credentialKind = 'display'
      } else {
        const terminalClaims = await getDisplayTerminalTokenClaims(
          body.displayToken,
          getDisplayTokenSecret(),
        )
        if (terminalClaims?.lectureSessionId === body.lectureSessionId) {
          credentialKind = 'display'
          terminalOnly = true
        }
      }
    }
  } catch (error) {
    return jsonResponse(
      {
        ok: false,
        message:
          error instanceof Error ? error.message : 'Operator auth failed.',
      },
      500,
    )
  }

  if (!credentialKind) {
    return jsonResponse(
      { ok: false, message: 'Invalid operator session.' },
      401,
    )
  }
  const action = body.action ?? 'snapshot'
  if (action === 'commentHistory' && credentialKind !== 'admin') {
    return jsonResponse(
      { ok: false, message: 'Comment history requires an Admin session.' },
      403,
    )
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!supabaseUrl || !serviceRoleKey) {
    return jsonResponse(
      { ok: false, message: 'Operator snapshot is not configured.' },
      500,
    )
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  })
  if (terminalOnly) {
    const { data: accessData, error: accessError } = await supabase.rpc(
      'admin_get_lecture_operator_access_v1',
      { target_lecture_session_id: body.lectureSessionId },
    )
    const access = accessData as OperatorAccess | null
    if (accessError) {
      return jsonResponse(
        { ok: false, message: 'Terminal state could not be loaded.' },
        500,
      )
    }
    if (access?.mode === 'terminal' && access.terminal) {
      return jsonResponse({
        credentialExpired: true,
        credentialKind: 'display',
        ok: true,
        result: { mode: 'terminal', terminal: access.terminal },
      })
    }
    return jsonResponse(
      { ok: false, message: 'Display session has expired.' },
      401,
    )
  }

  const historyLimit =
    typeof body.limit === 'number' && Number.isSafeInteger(body.limit)
      ? Math.min(Math.max(body.limit, 1), 50)
      : 50
  if (
    action === 'commentHistory' &&
    (!body.commentCursorCreatedAt ||
      !body.commentCursorId ||
      !isUuid(body.commentCursorId) ||
      Number.isNaN(new Date(body.commentCursorCreatedAt).getTime()))
  ) {
    return jsonResponse(
      { ok: false, message: 'A valid comment history cursor is required.' },
      400,
    )
  }

  const { data, error } =
    action === 'commentHistory'
      ? await supabase.rpc('admin_get_lecture_operator_comment_history_v1', {
          before_comment_id: body.commentCursorId,
          before_created_at: body.commentCursorCreatedAt,
          history_limit: historyLimit,
          target_lecture_session_id: body.lectureSessionId,
        })
      : await supabase.rpc(
          Deno.env.get('PHASE7_2_ACADEMIC_ANSWERS_ENABLED') === 'true'
            ? 'admin_get_lecture_operator_snapshot_v2'
            : 'admin_get_lecture_operator_snapshot_v1',
          {
          comment_cursor_created_at: body.commentCursorCreatedAt ?? null,
          comment_cursor_id: body.commentCursorId ?? null,
          comment_limit: 5,
          include_hidden: credentialKind === 'admin',
          known_caption_version: boundedVersion(body.knownCaptionVersion),
          known_comments_version: boundedVersion(body.knownCommentsVersion),
          known_lecture_version: boundedVersion(body.knownLectureVersion),
          known_likes_version: boundedVersion(body.knownLikesVersion),
          known_metrics_version: boundedVersion(body.knownMetricsVersion),
          known_pdf_version: boundedVersion(body.knownPdfVersion),
          known_polls_version: boundedVersion(body.knownPollsVersion),
          known_summaries_version: boundedVersion(body.knownSummariesVersion),
            target_lecture_session_id: body.lectureSessionId,
          },
        )

  if (error) {
    return jsonResponse(
      { ok: false, message: 'Operator snapshot could not be loaded.' },
      500,
    )
  }
  if (!data) {
    return jsonResponse({ ok: false, message: 'Lecture was not found.' }, 404)
  }

  return jsonResponse({ credentialKind, ok: true, result: data })
})
