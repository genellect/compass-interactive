import { handleCors } from '../_shared/cors.ts'
import { verifyGoogleAdminOperationRequest } from '../_shared/googleAdminOperations.ts'
import { hasLegacyAdminFields } from '../_shared/googleOnlyAdmin.ts'
import { describeJsonBodyError, readJsonBody } from '../_shared/requestBody.ts'
import { createJsonResponse } from '../_shared/responses.ts'

type RequestBody = {
  action?: 'consume' | 'set' | 'status'
  appSessionToken?: string
  enabled?: boolean
  lectureSessionId?: string
  requestId?: string
}

type RawIntentStatus = {
  activation_expires_at?: string | null
  armed?: boolean
  armed_at?: string | null
  consumed_at?: string | null
  idempotent_replay?: boolean
  ok?: boolean
  server_time?: string
  state?: 'armed' | 'cancelled' | 'consumed' | 'none'
  version?: number
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const RPC_TIMEOUT_MS = 3_500

function hasOnlyKeys(body: RequestBody, allowed: readonly string[]) {
  const allowedKeys = new Set(allowed)
  return Object.keys(body).every((key) => allowedKeys.has(key))
}

function isRequestBody(value: unknown): value is RequestBody {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function responseStatusForRpcCode(code: string | undefined) {
  if (code === '42501') return 401
  if (code === 'P7335') return 409
  if (code === 'P7337') return 503
  return 503
}

Deno.serve(async (request) => {
  const jsonResponse = createJsonResponse(request)
  const corsResponse = handleCors(request)
  if (corsResponse) return corsResponse
  if (request.method !== 'POST') {
    return jsonResponse({ message: 'Method not allowed.', ok: false }, 405)
  }

  let parsedBody: unknown
  try {
    parsedBody = await readJsonBody<unknown>(request, 8 * 1024)
  } catch (error) {
    const bodyError = describeJsonBodyError(error)
    return jsonResponse(
      { message: bodyError.message, ok: false },
      bodyError.status,
    )
  }
  if (!isRequestBody(parsedBody)) {
    return jsonResponse({ message: 'Request is invalid.', ok: false }, 400)
  }
  const body = parsedBody

  const action = body.action
  const allowedKeys =
    action === 'status'
      ? ['action', 'appSessionToken', 'lectureSessionId']
      : action === 'set'
        ? [
            'action',
            'appSessionToken',
            'enabled',
            'lectureSessionId',
            'requestId',
          ]
        : action === 'consume'
          ? ['action', 'appSessionToken', 'lectureSessionId', 'requestId']
          : []
  if (
    allowedKeys.length === 0 ||
    !hasOnlyKeys(body, allowedKeys) ||
    hasLegacyAdminFields(body) ||
    typeof body.appSessionToken !== 'string' ||
    body.appSessionToken.trim().length === 0 ||
    !UUID_PATTERN.test(body.lectureSessionId ?? '') ||
    (action === 'set' && typeof body.enabled !== 'boolean') ||
    (action !== 'set' && body.enabled !== undefined) ||
    (action === 'status' && body.requestId !== undefined) ||
    (action !== 'status' && !UUID_PATTERN.test(body.requestId ?? ''))
  ) {
    return jsonResponse({ message: 'Request is invalid.', ok: false }, 400)
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

  const { data, error } = await verification.serviceClient
    .rpc('manage_google_admin_ai_activation_intent_v1', {
      target_action: action,
      target_auth_user_id: verification.authUserId,
      target_enabled: action === 'set' ? body.enabled : null,
      target_google_issuer: verification.googleIssuer,
      target_lecture_session_id: body.lectureSessionId,
      target_provider_subject_hmac: verification.googleSubjectHmac,
      target_request_id: action === 'status' ? null : body.requestId,
      target_subject_pepper_version: verification.subjectPepperVersion,
      target_supabase_auth_session_id: verification.supabaseAuthSessionId,
      target_token_hash: verification.appSessionTokenHash,
      target_transport_enabled: verification.transportEnabled,
    })
    .abortSignal(AbortSignal.timeout(RPC_TIMEOUT_MS))
  const status = data as RawIntentStatus | null
  if (
    error ||
    status?.ok !== true ||
    typeof status.armed !== 'boolean' ||
    !['armed', 'cancelled', 'consumed', 'none'].includes(status.state ?? '') ||
    !Number.isSafeInteger(status.version) ||
    Number(status.version) < 0 ||
    (status.activation_expires_at !== null &&
      typeof status.activation_expires_at !== 'string') ||
    typeof status.server_time !== 'string'
  ) {
    return jsonResponse(
      {
        message:
          action === 'status'
            ? 'AI activation preparation could not be loaded.'
            : 'AI activation preparation could not be updated.',
        ok: false,
      },
      responseStatusForRpcCode(error?.code),
    )
  }

  return jsonResponse({
    activationExpiresAt: status.activation_expires_at,
    armed: status.armed,
    armedAt: status.armed_at ?? null,
    consumedAt: status.consumed_at ?? null,
    idempotentReplay: status.idempotent_replay === true,
    ok: true,
    serverTime: status.server_time,
    state: status.state,
    version: Number(status.version),
  })
})
