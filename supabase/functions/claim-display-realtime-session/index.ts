import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.110.0'
import { sha256Hex } from '../_shared/adminToken.ts'
import { handleCors } from '../_shared/cors.ts'
import {
  getDisplayTokenClaims,
  getDisplayTokenSecret,
} from '../_shared/displayToken.ts'
import { describeJsonBodyError, readJsonBody } from '../_shared/requestBody.ts'
import { createJsonResponse } from '../_shared/responses.ts'

type ClaimDisplayRealtimeRequest = {
  displayToken?: string
  lectureSessionId?: string
}

type ClaimResult = {
  expires_at?: string
  hard_stop_at?: string
  lecture_session_id?: string
  session_id?: string
  status?:
    'claimed' | 'claimed_by_other' | 'expired' | 'invalid' | 'unavailable'
  topic?: string
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
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

  let body: ClaimDisplayRealtimeRequest
  try {
    body = await readJsonBody<ClaimDisplayRealtimeRequest>(request, 8 * 1024)
  } catch (error) {
    const bodyError = describeJsonBodyError(error)
    return jsonResponse(
      { message: bodyError.message, ok: false },
      bodyError.status,
    )
  }

  if (
    !body.displayToken ||
    body.displayToken.length < 80 ||
    body.displayToken.length > 4_096 ||
    !body.lectureSessionId ||
    !isUuid(body.lectureSessionId)
  ) {
    return jsonResponse(
      { message: 'A valid Display session is required.', ok: false },
      400,
    )
  }

  let displayClaims
  try {
    displayClaims = await getDisplayTokenClaims(
      body.displayToken,
      getDisplayTokenSecret(),
    )
  } catch (error) {
    return jsonResponse(
      {
        message:
          error instanceof Error ? error.message : 'Display auth failed.',
        ok: false,
      },
      500,
    )
  }
  if (displayClaims?.lectureSessionId !== body.lectureSessionId) {
    return jsonResponse({ message: 'Invalid Display session.', ok: false }, 401)
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!supabaseUrl || !serviceRoleKey) {
    return jsonResponse(
      { message: 'Display Realtime is not configured.', ok: false },
      500,
    )
  }
  const service = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  })
  const authorization = request.headers.get('Authorization') ?? ''
  const bearerToken = authorization.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length).trim()
    : ''
  if (!bearerToken) {
    return jsonResponse({ message: 'Authentication required.', ok: false }, 401)
  }
  const { data: authData, error: authError } =
    await service.auth.getUser(bearerToken)
  if (authError || !authData.user || authData.user.is_anonymous !== true) {
    return jsonResponse({ message: 'Authentication required.', ok: false }, 401)
  }

  const tokenJtiHash = await sha256Hex(displayClaims.jti)
  const { data: googleBindingData, error: googleBindingError } =
    await service.rpc('verify_and_claim_google_display_session_v1', {
      target_display_auth_user_id: authData.user.id,
      target_lecture_session_id: body.lectureSessionId,
      target_token_jti_hash: tokenJtiHash,
    })
  if (googleBindingError) {
    return jsonResponse(
      { message: 'Display Realtime claim failed.', ok: false },
      500,
    )
  }
  const googleBinding = googleBindingData as {
    reason?: unknown
    recognized?: unknown
    realtime?: ClaimResult | null
    realtimeAvailable?: unknown
    realtimeEnabled?: unknown
    valid?: unknown
  } | null
  if (googleBinding?.recognized === true) {
    if (googleBinding.reason === 'claimed_by_other') {
      return jsonResponse(
        { message: 'This Display link is already in use.', ok: false },
        409,
      )
    }
    if (
      googleBinding.valid !== true ||
      googleBinding.realtimeEnabled !== true ||
      googleBinding.realtimeAvailable !== true ||
      !googleBinding.realtime
    ) {
      return jsonResponse(
        { message: 'Display Realtime session is unavailable.', ok: false },
        503,
      )
    }
  }

  if (googleBinding?.recognized !== true) {
    return jsonResponse({ message: 'Invalid Display session.', ok: false }, 401)
  }
  const result = (googleBinding.realtime ?? {}) as ClaimResult
  if (result.status === 'claimed_by_other') {
    return jsonResponse(
      { message: 'This Display link is already in use.', ok: false },
      409,
    )
  }
  if (result.status === 'unavailable') {
    return jsonResponse(
      { message: 'Display Realtime session is unavailable.', ok: false },
      503,
    )
  }
  if (result.status !== 'claimed') {
    return jsonResponse(
      { message: 'Display Realtime session is unavailable.', ok: false },
      401,
    )
  }
  if (
    result.lecture_session_id !== body.lectureSessionId ||
    !result.session_id ||
    !result.topic ||
    !result.expires_at ||
    !result.hard_stop_at
  ) {
    return jsonResponse(
      { message: 'Display Realtime claim is inconsistent.', ok: false },
      500,
    )
  }

  return jsonResponse({
    expiresAt: result.expires_at,
    hardStopAt: result.hard_stop_at,
    lectureSessionId: result.lecture_session_id,
    ok: true,
    sessionId: result.session_id,
    topic: result.topic,
  })
})
