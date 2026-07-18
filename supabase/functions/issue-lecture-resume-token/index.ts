import { createClient } from 'npm:@supabase/supabase-js@2'
import { handleCors } from '../_shared/cors.ts'
import { createLectureResumeToken } from '../_shared/lectureResumeToken.ts'
import {
  readJsonBody,
  RequestBodyTooLargeError,
  UnsupportedJsonContentTypeError,
} from '../_shared/requestBody.ts'
import { createJsonResponse } from '../_shared/responses.ts'

type ResumeTokenRequest = { lectureSessionId?: string }

function getBearerToken(request: Request) {
  const authorization = request.headers.get('authorization') ?? ''
  return authorization.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length).trim()
    : ''
}

Deno.serve(async (request) => {
  const jsonResponse = createJsonResponse(request)
  const corsResponse = handleCors(request)
  if (corsResponse) return corsResponse
  if (request.method !== 'POST') {
    return jsonResponse({ ok: false, message: 'Method not allowed.' }, 405)
  }
  if (Deno.env.get('PHASE68_RESUME_TOKENS_ENABLED') !== 'true') {
    return jsonResponse(
      { ok: false, message: 'Lecture resume tokens are disabled.' },
      503,
    )
  }

  let body: ResumeTokenRequest
  try {
    body = await readJsonBody<ResumeTokenRequest>(request, 4_096)
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) {
      return jsonResponse({ ok: false, message: 'Request is too large.' }, 413)
    }
    if (error instanceof UnsupportedJsonContentTypeError) {
      return jsonResponse({ ok: false, message: 'Request must be JSON.' }, 415)
    }
    return jsonResponse({ ok: false, message: 'Invalid JSON body.' }, 400)
  }
  if (
    !body.lectureSessionId ||
    !/^[0-9a-f-]{36}$/i.test(body.lectureSessionId)
  ) {
    return jsonResponse({ ok: false, message: 'Lecture is invalid.' }, 400)
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!supabaseUrl || !serviceRoleKey) {
    return jsonResponse(
      { ok: false, message: 'Lecture resume is unavailable.' },
      503,
    )
  }
  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  })
  const bearerToken = getBearerToken(request)
  const { data: authData, error: authError } = bearerToken
    ? await supabase.auth.getUser(bearerToken)
    : { data: { user: null }, error: new Error('missing bearer token') }
  if (authError || !authData.user) {
    return jsonResponse({ ok: false, message: 'Lecture is unavailable.' }, 401)
  }

  const { data: claimData, error: claimError } = await supabase.rpc(
    'get_lecture_resume_claim',
    {
      target_auth_user_id: authData.user.id,
      target_lecture_session_id: body.lectureSessionId,
    },
  )
  const claim = claimData as {
    archive_expires_at: string | null
    lecture_public_id: string
    resume_token_version: number
  } | null
  if (claimError || !claim) {
    return jsonResponse({ ok: false, message: 'Lecture is unavailable.' }, 404)
  }

  try {
    const issued = await createLectureResumeToken({
      archiveExpiresAt: claim.archive_expires_at,
      lecturePublicId: claim.lecture_public_id,
      version: claim.resume_token_version,
    })
    return jsonResponse({
      expiresAt: issued.expiresAt,
      lectureSessionId: body.lectureSessionId,
      ok: true,
      resumeToken: issued.token,
    })
  } catch {
    return jsonResponse(
      { ok: false, message: 'Lecture resume is unavailable.' },
      503,
    )
  }
})
