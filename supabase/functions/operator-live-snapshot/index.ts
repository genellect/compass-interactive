import { createClient } from 'npm:@supabase/supabase-js@2'
import {
  getAdminTokenSecret,
  sha256Hex,
  verifyAdminToken,
} from '../_shared/adminToken.ts'
import { handleCors } from '../_shared/cors.ts'
import { describeJsonBodyError, readJsonBody } from '../_shared/requestBody.ts'
import {
  getDisplayTokenClaims,
  getDisplayTokenSecret,
  getDisplayTerminalTokenClaims,
} from '../_shared/displayToken.ts'
import { createJsonResponse } from '../_shared/responses.ts'
import {
  type GoogleAdminOperationContext,
  verifyGoogleAdminOperationRequest,
} from '../_shared/googleAdminOperations.ts'

type OperatorSnapshotRequest = {
  action?: 'commentHistory' | 'snapshot'
  adminToken?: string
  appSessionToken?: string
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

type LiveDisplayClaims = {
  jti: string
  lectureSessionId: string
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
  if (
    [body.adminToken, body.appSessionToken, body.displayToken].filter(Boolean)
      .length !== 1
  ) {
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

  const action = body.action ?? 'snapshot'
  let credentialKind: 'admin' | 'display' | null = null
  let googleContext: GoogleAdminOperationContext | null = null
  let terminalOnly = false
  let liveDisplayClaims: LiveDisplayClaims | null = null
  try {
    if (body.adminToken) {
      credentialKind = (await verifyAdminToken(
        body.adminToken,
        getAdminTokenSecret(),
        request,
      ))
        ? 'admin'
        : null
    } else if (body.appSessionToken) {
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
      credentialKind = 'admin'
      googleContext = verification
    } else if (body.displayToken) {
      const liveClaims = await getDisplayTokenClaims(
        body.displayToken,
        getDisplayTokenSecret(),
      )
      if (liveClaims?.lectureSessionId === body.lectureSessionId) {
        credentialKind = 'display'
        liveDisplayClaims = liveClaims
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
  if (action === 'commentHistory' && credentialKind !== 'admin') {
    return jsonResponse(
      { ok: false, message: 'Comment history requires an Admin session.' },
      403,
    )
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!googleContext && (!supabaseUrl || !serviceRoleKey)) {
    return jsonResponse(
      { ok: false, message: 'Operator snapshot is not configured.' },
      500,
    )
  }

  const supabase =
    googleContext?.serviceClient ??
    createClient(supabaseUrl ?? '', serviceRoleKey ?? '', {
      auth: { persistSession: false },
    })
  if (credentialKind === 'display' && liveDisplayClaims) {
    const authorization = request.headers.get('Authorization') ?? ''
    const bearerToken = authorization.startsWith('Bearer ')
      ? authorization.slice('Bearer '.length).trim()
      : ''
    if (!bearerToken) {
      return jsonResponse(
        { ok: false, message: 'Invalid Display session.' },
        401,
      )
    }
    const { data: authData, error: authError } =
      await supabase.auth.getUser(bearerToken)
    if (authError || !authData.user) {
      return jsonResponse(
        { ok: false, message: 'Invalid Display session.' },
        401,
      )
    }
    const tokenJtiHash = await sha256Hex(liveDisplayClaims.jti)
    const { data: bindingValid, error: bindingError } = await supabase.rpc(
      'verify_display_realtime_session_v1',
      {
        target_display_auth_user_id: authData.user.id,
        target_lecture_session_id: body.lectureSessionId,
        target_token_jti_hash: tokenJtiHash,
      },
    )
    if (bindingError) {
      return jsonResponse(
        { ok: false, message: 'Display session verification failed.' },
        503,
      )
    }
    if (bindingValid !== true) {
      const { data: realtimeBinding, error: realtimeBindingError } =
        await supabase
          .from('display_realtime_sessions')
          .select('id, display_auth_user_id, revoke_reason')
          .eq('lecture_session_id', body.lectureSessionId)
          .eq('token_jti_hash', tokenJtiHash)
          .maybeSingle()
      if (realtimeBindingError) {
        return jsonResponse(
          { ok: false, message: 'Display session verification failed.' },
          503,
        )
      }
      // Tokens issued to an old client have no Realtime binding and preserve
      // their established five-second snapshot path during staged rollout.
      // A registered token may downgrade only when the DB runtime gate is OFF
      // and a service-only RPC revalidates its exact browser, lecture, binding,
      // and issuing Admin session on this request.
      let snapshotFallbackValid = false
      if (realtimeBinding) {
        const { data: fallbackValid, error: fallbackError } =
          await supabase.rpc('verify_display_snapshot_fallback_v1', {
            target_display_auth_user_id: authData.user.id,
            target_lecture_session_id: body.lectureSessionId,
            target_token_jti_hash: tokenJtiHash,
          })
        if (fallbackError) {
          return jsonResponse(
            { ok: false, message: 'Display session verification failed.' },
            503,
          )
        }
        snapshotFallbackValid = fallbackValid === true
      }
      if (realtimeBinding && !snapshotFallbackValid) {
        const { data: terminalData, error: terminalError } = await supabase.rpc(
          'admin_get_lecture_operator_access_v1',
          { target_lecture_session_id: body.lectureSessionId },
        )
        const terminalAccess = terminalData as OperatorAccess | null
        if (
          !terminalError &&
          terminalAccess?.mode === 'terminal' &&
          terminalAccess.terminal
        ) {
          return jsonResponse({
            credentialExpired: true,
            credentialKind: 'display',
            ok: true,
            result: { mode: 'terminal', terminal: terminalAccess.terminal },
          })
        }
        if (realtimeBinding.display_auth_user_id === authData.user.id) {
          return jsonResponse({
            credentialExpired: true,
            credentialKind: 'display',
            message: 'Display session has ended.',
            ok: false,
          })
        }
        return jsonResponse(
          { ok: false, message: 'Invalid Display session.' },
          401,
        )
      }
    }
  }
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

  const { data, error } = googleContext
    ? await supabase.rpc('get_google_admin_operator_live_snapshot_v1', {
        target_academic_answers_enabled:
          Deno.env.get('PHASE7_2_ACADEMIC_ANSWERS_ENABLED') === 'true',
        target_action: action,
        target_auth_user_id: googleContext.authUserId,
        target_comment_cursor_created_at: body.commentCursorCreatedAt ?? null,
        target_comment_cursor_id: body.commentCursorId ?? null,
        target_google_issuer: googleContext.googleIssuer,
        target_known_caption_version: boundedVersion(body.knownCaptionVersion),
        target_known_comments_version: boundedVersion(
          body.knownCommentsVersion,
        ),
        target_known_lecture_version: boundedVersion(body.knownLectureVersion),
        target_known_likes_version: boundedVersion(body.knownLikesVersion),
        target_known_metrics_version: boundedVersion(body.knownMetricsVersion),
        target_known_pdf_version: boundedVersion(body.knownPdfVersion),
        target_known_polls_version: boundedVersion(body.knownPollsVersion),
        target_known_summaries_version: boundedVersion(
          body.knownSummariesVersion,
        ),
        target_lecture_session_id: body.lectureSessionId,
        target_limit: historyLimit,
        target_provider_subject_hmac: googleContext.googleSubjectHmac,
        target_subject_pepper_version: googleContext.subjectPepperVersion,
        target_supabase_auth_session_id: googleContext.supabaseAuthSessionId,
        target_token_hash: googleContext.appSessionTokenHash,
        target_transport_enabled: googleContext.transportEnabled,
      })
    : action === 'commentHistory'
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
