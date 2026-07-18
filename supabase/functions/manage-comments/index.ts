import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.110.0'
import {
  getAdminActorId,
  getAdminTokenClaims,
  getAdminTokenSecret,
} from '../_shared/adminToken.ts'
import { handleCors } from '../_shared/cors.ts'
import { describeJsonBodyError, readJsonBody } from '../_shared/requestBody.ts'
import { createJsonResponse } from '../_shared/responses.ts'

type ManageCommentsRequest = {
  action?: 'togglePin' | 'toggleVisibility'
  adminToken?: string
  commentId?: string
  lectureSessionId?: string
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
    !body.adminToken ||
    !body.action ||
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

  let claims
  try {
    claims = await getAdminTokenClaims(
      body.adminToken,
      getAdminTokenSecret(),
      request,
    )
  } catch (error) {
    return jsonResponse(
      {
        message: error instanceof Error ? error.message : 'Admin auth failed.',
        ok: false,
      },
      500,
    )
  }
  if (!claims) {
    return jsonResponse({ message: 'Invalid Admin session.', ok: false }, 401)
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!supabaseUrl || !serviceRoleKey) {
    return jsonResponse(
      { message: 'Comment moderation is not configured.', ok: false },
      500,
    )
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  })
  const { data, error } = await supabase.rpc('admin_moderate_lecture_comment', {
    target_action:
      body.action === 'togglePin' ? 'toggle_pin' : 'toggle_visibility',
    target_actor_id: getAdminActorId(claims),
    target_comment_id: body.commentId,
    target_lecture_session_id: body.lectureSessionId,
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

  return jsonResponse({ comment: data, ok: true })
})
