import { handleCors } from '../_shared/cors.ts'
import { describeJsonBodyError, readJsonBody } from '../_shared/requestBody.ts'
import {
  createBoundDisplayToken,
  getDisplayTokenSecret,
} from '../_shared/displayToken.ts'
import { verifyGoogleAdminOperationRequest } from '../_shared/googleAdminOperations.ts'
import { hasLegacyAdminFields } from '../_shared/googleOnlyAdmin.ts'
import { createJsonResponse } from '../_shared/responses.ts'

type IssueDisplaySessionRequest = {
  appSessionToken?: string
  enableRealtime?: boolean
  lectureSessionId?: string
  requestId?: string
}

type GoogleDisplayIssuance = {
  displaySessionId?: string
  expiresAtEpoch?: number
  idempotentReplay?: boolean
  issuedAtEpoch?: number
  ok?: boolean
  realtime?: {
    expiresAt?: string
    sessionId?: string
    topic?: string
  } | null
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  )
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

  let body: IssueDisplaySessionRequest
  try {
    body = await readJsonBody<IssueDisplaySessionRequest>(request, 8 * 1024)
  } catch (error) {
    const bodyError = describeJsonBodyError(error)
    return jsonResponse(
      { ok: false, message: bodyError.message },
      bodyError.status,
    )
  }

  if (
    !body.lectureSessionId ||
    !isUuid(body.lectureSessionId) ||
    (body.enableRealtime !== undefined &&
      typeof body.enableRealtime !== 'boolean')
  ) {
    return jsonResponse(
      {
        ok: false,
        message: 'lectureSessionId is required.',
      },
      400,
    )
  }

  if (hasLegacyAdminFields(body)) {
    return jsonResponse(
      { ok: false, message: 'Legacy Admin credentials are not supported.' },
      400,
    )
  }
  if (
    typeof body.appSessionToken !== 'string' ||
    body.appSessionToken.trim().length === 0
  ) {
    return jsonResponse(
      { ok: false, message: 'appSessionToken is required.' },
      401,
    )
  }
  if (!isUuid(body.requestId ?? '')) {
    return jsonResponse({ ok: false, message: 'requestId is required.' }, 400)
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!supabaseUrl || !serviceRoleKey) {
    return jsonResponse(
      { ok: false, message: 'Display session service is not configured.' },
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

  const enableRealtime =
    body.enableRealtime === true &&
    Deno.env.get('PHASE728_DISPLAY_REALTIME_ENABLED') === 'true'
  const { data, error } = await verification.serviceClient.rpc(
    'issue_google_admin_display_session_v1',
    {
      target_auth_user_id: verification.authUserId,
      target_enable_realtime: enableRealtime,
      target_google_issuer: verification.googleIssuer,
      target_lecture_session_id: body.lectureSessionId,
      target_provider_subject_hmac: verification.googleSubjectHmac,
      target_request_id: body.requestId,
      target_subject_pepper_version: verification.subjectPepperVersion,
      target_supabase_auth_session_id: verification.supabaseAuthSessionId,
      target_token_hash: verification.appSessionTokenHash,
      target_transport_enabled: verification.transportEnabled,
    },
  )
  if (error) {
    const status = error.code === '42501' ? 401 : 409
    return jsonResponse(
      { ok: false, message: 'Display session could not be issued.' },
      status,
    )
  }

  const issuance = data as GoogleDisplayIssuance | null
  const realtime = issuance?.realtime
  if (
    issuance?.ok !== true ||
    issuance.displaySessionId !== body.requestId ||
    !Number.isSafeInteger(issuance.issuedAtEpoch) ||
    !Number.isSafeInteger(issuance.expiresAtEpoch) ||
    Number(issuance.expiresAtEpoch) <= Number(issuance.issuedAtEpoch) ||
    typeof issuance.idempotentReplay !== 'boolean' ||
    (enableRealtime &&
      (!realtime ||
        !isUuid(realtime.sessionId ?? '') ||
        !realtime.topic ||
        !realtime.expiresAt)) ||
    (!enableRealtime && realtime !== null)
  ) {
    return jsonResponse(
      { ok: false, message: 'Display session could not be confirmed.' },
      409,
    )
  }

  const expiresAtEpoch = Number(issuance.expiresAtEpoch)
  if (expiresAtEpoch <= Math.floor(Date.now() / 1000)) {
    return jsonResponse(
      {
        code: 'display_session_refresh_required',
        message: 'Create a new Display session to continue.',
        ok: false,
      },
      409,
    )
  }

  try {
    const displayToken = await createBoundDisplayToken(
      body.lectureSessionId,
      Number(issuance.issuedAtEpoch),
      expiresAtEpoch,
      body.requestId,
      getDisplayTokenSecret(),
      issuance.idempotentReplay,
    )
    return jsonResponse({
      displayToken,
      expiresAt: new Date(expiresAtEpoch * 1000).toISOString(),
      idempotentReplay: issuance.idempotentReplay,
      lectureSessionId: body.lectureSessionId,
      ok: true,
      realtime: realtime
        ? { expiresAt: realtime.expiresAt, topic: realtime.topic }
        : null,
    })
  } catch {
    return jsonResponse(
      { ok: false, message: 'Display session creation failed.' },
      500,
    )
  }
})
