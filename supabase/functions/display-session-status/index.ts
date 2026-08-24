import { createClient } from 'npm:@supabase/supabase-js@2'
import { sha256Hex } from '../_shared/adminToken.ts'
import { handleCors } from '../_shared/cors.ts'
import {
  getDisplayTokenClaims,
  getDisplayTokenSecret,
} from '../_shared/displayToken.ts'
import { verifyGoogleAdminOperationRequest } from '../_shared/googleAdminOperations.ts'
import { hasLegacyAdminFields } from '../_shared/googleOnlyAdmin.ts'
import { describeJsonBodyError, readJsonBody } from '../_shared/requestBody.ts'
import { createJsonResponse } from '../_shared/responses.ts'

type RequestBody = {
  action?: 'heartbeat' | 'rendered' | 'status'
  appSessionToken?: string
  connectionGeneration?: number
  displayToken?: string
  displayUpdatedAt?: string
  lectureSessionId?: string
  renderedPage?: number
  sessionId?: string
}

type DeliveryAck = {
  display_version?: number
  rendered_page?: number
  server_time?: string
  status?:
    | 'accepted'
    | 'inactive'
    | 'invalid'
    | 'render_required'
    | 'snapshot_stale'
    | 'stale_generation'
}

type RawDisplaySessionStatus = {
  ok?: boolean
  runtime_enabled?: boolean
  server_time?: string
  session?: {
    connected_at?: string | null
    connection_generation?: number
    current_display_version?: number | null
    current_page?: number | null
    expires_at?: string
    hard_stop_at?: string
    last_applied_display_version?: number | null
    last_heartbeat_at?: string | null
    last_rendered_page?: number | null
    revoke_reason?: string | null
    revoked_at?: string | null
    session_id?: string
    state?: 'connected' | 'ended' | 'reconnecting' | 'synced' | 'waiting'
  } | null
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const RPC_TIMEOUT_MS = 3_500

function getBearerToken(request: Request) {
  const authorization = request.headers.get('authorization')?.trim() ?? ''
  const match = /^Bearer ([A-Za-z0-9._~-]+)$/.exec(authorization)
  return match?.[1] ?? ''
}

function hasOnlyKeys(body: RequestBody, allowed: readonly string[]) {
  const allowedKeys = new Set(allowed)
  return Object.keys(body).every((key) => allowedKeys.has(key))
}

function mapStatusSession(
  session: NonNullable<RawDisplaySessionStatus['session']>,
) {
  return {
    connectedAt: session.connected_at ?? null,
    connectionGeneration: session.connection_generation ?? 0,
    currentDisplayVersion: session.current_display_version ?? null,
    currentPage: session.current_page ?? null,
    expiresAt: session.expires_at,
    hardStopAt: session.hard_stop_at,
    lastAppliedDisplayVersion: session.last_applied_display_version ?? null,
    lastHeartbeatAt: session.last_heartbeat_at ?? null,
    lastRenderedPage: session.last_rendered_page ?? null,
    revokeReason: session.revoke_reason ?? null,
    revokedAt: session.revoked_at ?? null,
    sessionId: session.session_id,
    state: session.state,
  }
}

Deno.serve(async (request) => {
  const jsonResponse = createJsonResponse(request)
  const corsResponse = handleCors(request)
  if (corsResponse) return corsResponse
  if (request.method !== 'POST') {
    return jsonResponse({ message: 'Method not allowed.', ok: false }, 405)
  }

  let body: RequestBody
  try {
    body = await readJsonBody<RequestBody>(request, 8 * 1024)
  } catch (error) {
    const bodyError = describeJsonBodyError(error)
    return jsonResponse(
      { message: bodyError.message, ok: false },
      bodyError.status,
    )
  }

  if (
    !body.lectureSessionId ||
    !UUID_PATTERN.test(body.lectureSessionId) ||
    !['heartbeat', 'rendered', 'status'].includes(body.action ?? '')
  ) {
    return jsonResponse({ message: 'Request is incomplete.', ok: false }, 400)
  }

  if (body.action === 'status') {
    if (
      !hasOnlyKeys(body, ['action', 'appSessionToken', 'lectureSessionId']) ||
      hasLegacyAdminFields(body) ||
      typeof body.appSessionToken !== 'string' ||
      body.appSessionToken.trim().length === 0
    ) {
      return jsonResponse(
        { message: 'Admin session is required.', ok: false },
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

    const { data, error } = await verification.serviceClient
      .rpc('get_google_admin_display_session_status_v1', {
        target_auth_user_id: verification.authUserId,
        target_display_realtime_enabled:
          Deno.env.get('PHASE728_DISPLAY_REALTIME_ENABLED') === 'true',
        target_google_issuer: verification.googleIssuer,
        target_lecture_session_id: body.lectureSessionId,
        target_provider_subject_hmac: verification.googleSubjectHmac,
        target_subject_pepper_version: verification.subjectPepperVersion,
        target_supabase_auth_session_id: verification.supabaseAuthSessionId,
        target_token_hash: verification.appSessionTokenHash,
        target_transport_enabled: verification.transportEnabled,
      })
      .abortSignal(AbortSignal.timeout(RPC_TIMEOUT_MS))
    const status = data as RawDisplaySessionStatus | null
    if (error || status?.ok !== true) {
      return jsonResponse(
        { message: 'Display status could not be loaded.', ok: false },
        error?.code === '42501' ? 401 : 503,
      )
    }
    return jsonResponse({
      ok: true,
      runtimeEnabled: status.runtime_enabled === true,
      serverTime: status.server_time,
      session: status.session ? mapStatusSession(status.session) : null,
    })
  }

  const rendered = body.action === 'rendered'
  const allowedKeys = rendered
    ? [
        'action',
        'connectionGeneration',
        'displayToken',
        'displayUpdatedAt',
        'lectureSessionId',
        'renderedPage',
        'sessionId',
      ]
    : [
        'action',
        'connectionGeneration',
        'displayToken',
        'lectureSessionId',
        'sessionId',
      ]
  if (
    !hasOnlyKeys(body, allowedKeys) ||
    typeof body.displayToken !== 'string' ||
    body.displayToken.length < 80 ||
    body.displayToken.length > 4_096 ||
    !UUID_PATTERN.test(body.sessionId ?? '') ||
    !Number.isSafeInteger(body.connectionGeneration) ||
    Number(body.connectionGeneration) < 1 ||
    Number(body.connectionGeneration) > 2_147_483_647 ||
    (rendered &&
      (typeof body.displayUpdatedAt !== 'string' ||
        !Number.isFinite(Date.parse(body.displayUpdatedAt)) ||
        !Number.isSafeInteger(body.renderedPage) ||
        Number(body.renderedPage) < 1))
  ) {
    return jsonResponse(
      { message: 'Display delivery report is invalid.', ok: false },
      400,
    )
  }
  if (Deno.env.get('PHASE728_DISPLAY_REALTIME_ENABLED') !== 'true') {
    return jsonResponse(
      { message: 'Display Realtime is not enabled.', ok: false },
      503,
    )
  }

  let displayClaims
  try {
    displayClaims = await getDisplayTokenClaims(
      body.displayToken,
      getDisplayTokenSecret(),
    )
  } catch {
    return jsonResponse(
      { message: 'Display delivery is not configured.', ok: false },
      503,
    )
  }
  if (displayClaims?.lectureSessionId !== body.lectureSessionId) {
    return jsonResponse({ message: 'Invalid Display session.', ok: false }, 401)
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')?.trim()
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')?.trim()
  if (!supabaseUrl || !serviceRoleKey) {
    return jsonResponse(
      { message: 'Display delivery is not configured.', ok: false },
      503,
    )
  }
  const service = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const bearerToken = getBearerToken(request)
  const { data: authData, error: authError } =
    await service.auth.getUser(bearerToken)
  if (
    !bearerToken ||
    authError ||
    !authData.user ||
    authData.user.is_anonymous !== true
  ) {
    return jsonResponse({ message: 'Authentication required.', ok: false }, 401)
  }

  const { data, error } = await service
    .rpc('ack_display_realtime_delivery_v1', {
      target_action: body.action,
      target_connection_generation: body.connectionGeneration,
      target_display_auth_user_id: authData.user.id,
      target_display_updated_at: rendered ? body.displayUpdatedAt : null,
      target_lecture_session_id: body.lectureSessionId,
      target_rendered_page: rendered ? body.renderedPage : null,
      target_session_id: body.sessionId,
      target_token_jti_hash: await sha256Hex(displayClaims.jti),
    })
    .abortSignal(AbortSignal.timeout(RPC_TIMEOUT_MS))
  const acknowledgement = data as DeliveryAck | null
  if (error) {
    return jsonResponse(
      { message: 'Display delivery report failed.', ok: false },
      503,
    )
  }
  if (acknowledgement?.status !== 'accepted') {
    return jsonResponse(
      {
        code: acknowledgement?.status ?? 'delivery_inactive',
        message:
          acknowledgement?.status === 'snapshot_stale'
            ? 'Display snapshot changed before it was rendered.'
            : 'Display delivery session is no longer active.',
        ok: false,
      },
      acknowledgement?.status === 'invalid' ? 400 : 409,
    )
  }

  return jsonResponse({
    displayVersion: acknowledgement.display_version,
    ok: true,
    renderedPage: acknowledgement.rendered_page,
    serverTime: acknowledgement.server_time,
  })
})
