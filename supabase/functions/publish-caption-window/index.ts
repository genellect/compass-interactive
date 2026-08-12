import { handleCors } from '../_shared/cors.ts'
import { verifyGoogleAdminOperationRequest } from '../_shared/googleAdminOperations.ts'
import { hasLegacyAdminFields } from '../_shared/googleOnlyAdmin.ts'
import { describeJsonBodyError, readJsonBody } from '../_shared/requestBody.ts'
import { createJsonResponse } from '../_shared/responses.ts'

type PublishCaptionRequest = {
  appSessionToken?: string
  language?: 'auto' | 'en' | 'ja' | 'mixed' | 'und'
  lastItemId?: string
  lectureSessionId?: string
  operationId?: string
  requestId?: string
  sequence?: number
  startRequestId?: string
  text?: string
}

function isUuid(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    )
  )
}

Deno.serve(async (request) => {
  const jsonResponse = createJsonResponse(request)
  const corsResponse = handleCors(request)
  if (corsResponse) return corsResponse
  if (request.method !== 'POST') {
    return jsonResponse({ ok: false, message: 'Method not allowed.' }, 405)
  }
  if (Deno.env.get('PHASE4_REALTIME_CAPTIONS_ENABLED') !== 'true') {
    return jsonResponse(
      { ok: false, message: 'Realtime captions are disabled.' },
      503,
    )
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!supabaseUrl || !serviceRoleKey) {
    return jsonResponse(
      { ok: false, message: 'Caption publishing is not configured.' },
      503,
    )
  }

  let body: PublishCaptionRequest
  try {
    body = await readJsonBody<PublishCaptionRequest>(request, 64 * 1024)
  } catch (error) {
    const bodyError = describeJsonBodyError(error)
    return jsonResponse(
      { ok: false, message: bodyError.message },
      bodyError.status,
    )
  }

  const text = body.text?.trim() ?? ''
  if (hasLegacyAdminFields(body) || !body.appSessionToken?.trim()) {
    return jsonResponse(
      { ok: false, message: 'Google Admin credential is required.' },
      401,
    )
  }
  if (
    !isUuid(body.lectureSessionId) ||
    !isUuid(body.operationId) ||
    !body.lastItemId ||
    text.length < 1 ||
    text.length > 1000 ||
    !Number.isSafeInteger(body.sequence) ||
    (body.sequence ?? -1) < 0
  ) {
    return jsonResponse(
      { ok: false, message: 'Caption window is invalid.' },
      400,
    )
  }
  if (
    (!isUuid(body.requestId) || !isUuid(body.startRequestId))
  ) {
    return jsonResponse(
      { ok: false, message: 'Google caption request IDs are invalid.' },
      400,
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
  const { data, error } = await verification.serviceClient.rpc(
      'publish_google_admin_caption_window_v1',
      {
        target_auth_user_id: verification.authUserId,
        target_google_issuer: verification.googleIssuer,
        target_language: body.language ?? 'auto',
        target_last_item_id: body.lastItemId,
        target_lecture_session_id: body.lectureSessionId,
        target_operation_id: body.operationId,
        target_provider_subject_hmac: verification.googleSubjectHmac,
        target_request_id: body.requestId,
        target_sequence: body.sequence,
        target_start_request_id: body.startRequestId,
        target_subject_pepper_version: verification.subjectPepperVersion,
        target_supabase_auth_session_id: verification.supabaseAuthSessionId,
        target_text: text,
        target_token_hash: verification.appSessionTokenHash,
        target_transport_enabled:
          verification.transportEnabled &&
          Deno.env.get('PHASE4_REALTIME_CAPTIONS_ENABLED') === 'true',
      },
    )
  const result = data as {
      accepted?: boolean
      idempotentReplay?: boolean
      metadata?: Record<string, unknown>
      status?: string
    } | null
  if (error || !result) {
    return jsonResponse(
      {
        message: 'Caption window was not accepted.',
        ok: false,
        shouldStop: true,
      },
      409,
    )
  }
  return jsonResponse({
    idempotentReplay: result.idempotentReplay === true,
    metadata: result.metadata ?? {},
    ok: result.accepted === true,
    shouldStop: result.metadata?.shouldStop === true,
    status: result.status ?? null,
  })
})
