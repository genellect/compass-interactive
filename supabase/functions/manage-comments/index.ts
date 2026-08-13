import { handleCors } from '../_shared/cors.ts'
import {
  type GoogleAdminOperationContext,
  verifyGoogleAdminOperationRequest,
} from '../_shared/googleAdminOperations.ts'
import { hasLegacyAdminFields } from '../_shared/googleOnlyAdmin.ts'
import { describeJsonBodyError, readJsonBody } from '../_shared/requestBody.ts'
import { createJsonResponse } from '../_shared/responses.ts'

type ManageCommentsRequest = {
  action?: 'togglePin' | 'toggleVisibility'
  appSessionToken?: string
  commentId?: string
  lectureSessionId?: string
  requestId?: string
}

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

Deno.serve(async (request) => {
  const jsonResponse = createJsonResponse(request)
  const corsResponse = handleCors(request)
  if (corsResponse) {
    return corsResponse
  }

  if (request.method !== 'POST') {
    return jsonResponse({ message: 'Method not allowed.', ok: false }, 405)
  }

  let body: ManageCommentsRequest
  try {
    body = await readJsonBody<ManageCommentsRequest>(request, 8 * 1024)
  } catch (error) {
    const bodyError = describeJsonBodyError(error)
    return jsonResponse(
      { message: bodyError.message, ok: false },
      bodyError.status,
    )
  }

  if (
    hasLegacyAdminFields(body) ||
    !['togglePin', 'toggleVisibility'].includes(body.action ?? '') ||
    !body.commentId ||
    !body.lectureSessionId ||
    !uuidPattern.test(body.commentId) ||
    !uuidPattern.test(body.lectureSessionId)
  ) {
    return jsonResponse(
      { message: 'Comment moderation request is invalid.', ok: false },
      400,
    )
  }

  if (!body.appSessionToken?.trim()) {
    return jsonResponse(
      { message: 'Google Admin credential is required.', ok: false },
      401,
    )
  }
  if (!uuidPattern.test(body.requestId ?? '')) {
    return jsonResponse({ message: 'requestId is required.', ok: false }, 400)
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!supabaseUrl || !serviceRoleKey) {
    return jsonResponse(
      { message: 'Comment moderation is not configured.', ok: false },
      500,
    )
  }

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
  const googleContext: GoogleAdminOperationContext = verification
  const supabase = verification.serviceClient

  const { data, error } = await supabase.rpc('manage_google_admin_comments_v1', {
        target_action: body.action,
        target_auth_user_id: googleContext.authUserId,
        target_comment_id: body.commentId,
        target_google_issuer: googleContext.googleIssuer,
        target_lecture_session_id: body.lectureSessionId,
        target_provider_subject_hmac: googleContext.googleSubjectHmac,
        target_request_id: body.requestId,
        target_subject_pepper_version: googleContext.subjectPepperVersion,
        target_supabase_auth_session_id: googleContext.supabaseAuthSessionId,
        target_token_hash: googleContext.appSessionTokenHash,
        target_transport_enabled: googleContext.transportEnabled,
      })

  if (error) {
    const denied = error.code === '42501'
    return jsonResponse(
      {
        message: denied
          ? 'This comment is no longer available for moderation.'
          : 'Comment moderation failed.',
        ok: false,
      },
      denied ? 409 : 500,
    )
  }

  if ((data as { ok?: boolean } | null)?.ok !== true) {
    return jsonResponse(
      {
        message: 'Comment moderation could not be confirmed.',
        ok: false,
      },
      409,
    )
  }

  return jsonResponse({
    comment: (data as { comment?: unknown }).comment ?? null,
    ok: true,
    refreshRequired:
      (data as { refreshRequired?: boolean }).refreshRequired === true,
  })
})
