import { handleCors } from '../_shared/cors.ts'
import { verifyGoogleAdminOperationRequest } from '../_shared/googleAdminOperations.ts'
import { hasLegacyAdminFields } from '../_shared/googleOnlyAdmin.ts'
import { describeJsonBodyError, readJsonBody } from '../_shared/requestBody.ts'
import { createJsonResponse } from '../_shared/responses.ts'

const MAX_CAPTION_TEXT_CHARACTERS = 4_000
const REALTIME_RELAY_TIMEOUT_MS = 5_000
const RPC_TIMEOUT_MS = 5_500

type CaptionMessage = {
  caption?: { text?: unknown } | null
  lectureSessionId?: unknown
  sequence?: unknown
  source?: unknown
  streamId?: unknown
  timestamp?: unknown
}

type RelayRequest = {
  appSessionToken?: string
  lectureSessionId?: string
  message?: CaptionMessage
  operationId?: string
  startRequestId?: string
}

type RelayAdmission = {
  status?: 'allowed' | 'invalid' | 'rate_limited' | 'stale' | 'unavailable'
  topic?: string
}

function isUuid(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    )
  )
}

function validMessage(value: CaptionMessage, lectureSessionId: string) {
  const captionText = value.caption?.text
  return (
    value.lectureSessionId === lectureSessionId &&
    isUuid(value.streamId) &&
    typeof value.sequence === 'number' &&
    Number.isSafeInteger(value.sequence) &&
    value.sequence >= 0 &&
    ['completed', 'delta', 'stopped'].includes(
      typeof value.source === 'string' ? value.source : '',
    ) &&
    typeof value.timestamp === 'number' &&
    Number.isSafeInteger(value.timestamp) &&
    Math.abs(Date.now() - value.timestamp) <= 60_000 &&
    (value.caption === null ||
      (typeof captionText === 'string' &&
        captionText.length <= MAX_CAPTION_TEXT_CHARACTERS)) &&
    (value.source !== 'stopped' || value.caption === null)
  )
}

function hasOnlyKeys(body: RelayRequest, allowed: readonly string[]) {
  const allowedKeys = new Set(allowed)
  return Object.keys(body).every((key) => allowedKeys.has(key))
}

function isTopic(value: unknown, lectureSessionId: string): value is string {
  return (
    typeof value === 'string' &&
    new RegExp(
      `^display:${lectureSessionId.replaceAll('-', '\\-')}:[0-9a-f-]{36}$`,
      'i',
    ).test(value)
  )
}

Deno.serve(async (request) => {
  const jsonResponse = createJsonResponse(request)
  const corsResponse = handleCors(request)
  if (corsResponse) return corsResponse

  if (request.method !== 'POST') {
    return jsonResponse({ message: 'Method not allowed.', ok: false }, 405)
  }
  if (Deno.env.get('PHASE728_DISPLAY_REALTIME_ENABLED') !== 'true') {
    return jsonResponse(
      { message: 'Display Realtime is not enabled.', ok: false },
      503,
    )
  }

  let body: RelayRequest
  try {
    body = await readJsonBody<RelayRequest>(request, 12 * 1024)
  } catch (error) {
    const bodyError = describeJsonBodyError(error)
    return jsonResponse(
      { message: bodyError.message, ok: false },
      bodyError.status,
    )
  }

  if (
    !hasOnlyKeys(body, [
      'appSessionToken',
      'lectureSessionId',
      'message',
      'operationId',
      'startRequestId',
    ]) ||
    hasLegacyAdminFields(body) ||
    typeof body.appSessionToken !== 'string' ||
    body.appSessionToken.trim().length === 0 ||
    !body.lectureSessionId ||
    !isUuid(body.lectureSessionId) ||
    !body.operationId ||
    !isUuid(body.operationId) ||
    !body.startRequestId ||
    !isUuid(body.startRequestId) ||
    !body.message ||
    !validMessage(body.message, body.lectureSessionId)
  ) {
    return jsonResponse(
      { message: 'Invalid Display caption relay.', ok: false },
      400,
    )
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!supabaseUrl || !serviceRoleKey) {
    return jsonResponse(
      { message: 'Display caption relay is not configured.', ok: false },
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

  const { data, error: admissionError } = await verification.serviceClient
    .rpc('claim_google_admin_display_caption_relay_v1', {
      target_auth_user_id: verification.authUserId,
      target_google_issuer: verification.googleIssuer,
      target_lecture_session_id: body.lectureSessionId,
      target_operation_id: body.operationId,
      target_provider_subject_hmac: verification.googleSubjectHmac,
      target_sequence: body.message.sequence,
      target_source: body.message.source,
      target_stream_id: body.message.streamId,
      target_start_request_id: body.startRequestId,
      target_subject_pepper_version: verification.subjectPepperVersion,
      target_supabase_auth_session_id: verification.supabaseAuthSessionId,
      target_token_hash: verification.appSessionTokenHash,
      target_transport_enabled: verification.transportEnabled,
    })
    .abortSignal(AbortSignal.timeout(RPC_TIMEOUT_MS))
  const admission = data as RelayAdmission | null
  if (admissionError) {
    return jsonResponse(
      { message: 'Display caption relay admission failed.', ok: false },
      admissionError.code === '42501' ? 401 : 503,
    )
  }
  if (admission?.status === 'rate_limited') {
    return jsonResponse(
      { message: 'Display caption relay is rate limited.', ok: false },
      429,
    )
  }
  if (admission?.status === 'stale') {
    return jsonResponse(
      { message: 'Display caption relay is stale.', ok: false },
      409,
    )
  }
  if (
    admission?.status !== 'allowed' ||
    !isTopic(admission.topic, body.lectureSessionId)
  ) {
    return jsonResponse(
      { message: 'Display caption relay is unavailable.', ok: false },
      403,
    )
  }

  const relayUrl = new URL(
    `/realtime/v1/api/broadcast/${encodeURIComponent(admission.topic)}/events/caption`,
    supabaseUrl,
  )
  relayUrl.searchParams.set('private', 'true')
  try {
    const relayResponse = await fetch(relayUrl, {
      body: JSON.stringify(body.message),
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
        'Content-Type': 'application/json',
      },
      method: 'POST',
      redirect: 'manual',
      signal: AbortSignal.timeout(REALTIME_RELAY_TIMEOUT_MS),
    })
    if (!relayResponse.ok) {
      return jsonResponse(
        { message: 'Display caption relay was not accepted.', ok: false },
        502,
      )
    }
  } catch {
    return jsonResponse(
      { message: 'Display caption relay timed out.', ok: false },
      504,
    )
  }

  return jsonResponse({ ok: true })
})
