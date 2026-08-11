import { createClient } from 'npm:@supabase/supabase-js@2'
import {
  getAdminTokenClaims,
  getAdminTokenSecret,
  sha256Hex,
} from '../_shared/adminToken.ts'
import { handleCors } from '../_shared/cors.ts'
import { describeJsonBodyError, readJsonBody } from '../_shared/requestBody.ts'
import {
  createBoundDisplayToken,
  createDisplayToken,
  getDisplayTokenClaims,
  getDisplayTokenSecret,
} from '../_shared/displayToken.ts'
import { verifyGoogleAdminOperationRequest } from '../_shared/googleAdminOperations.ts'
import { createJsonResponse } from '../_shared/responses.ts'

type IssueDisplaySessionRequest = {
  adminToken?: string
  appSessionToken?: string
  enableRealtime?: boolean
  lectureSessionId?: string
  requestId?: string
}

type OperatorAccess = {
  hard_stop_at: string | null
  lecture_session_id: string
  mode: 'live' | 'terminal' | 'unavailable'
  server_time: string
}

type DisplayRealtimeRegistration = {
  expires_at: string
  lecture_session_id: string
  session_id: string
  topic: string
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

  const hasGoogleCredential =
    typeof body.appSessionToken === 'string' &&
    body.appSessionToken.trim().length > 0
  const hasLegacyCredential =
    typeof body.adminToken === 'string' && body.adminToken.trim().length > 0
  if (hasGoogleCredential === hasLegacyCredential) {
    return jsonResponse(
      { ok: false, message: 'Exactly one Admin credential is required.' },
      401,
    )
  }
  if (hasGoogleCredential && !isUuid(body.requestId ?? '')) {
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

  if (hasGoogleCredential) {
    const verification = await verifyGoogleAdminOperationRequest(
      request,
      body.appSessionToken!,
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
        body.requestId!,
        getDisplayTokenSecret(),
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
  }

  let adminSecret: string
  try {
    adminSecret = getAdminTokenSecret()
  } catch (error) {
    return jsonResponse(
      {
        ok: false,
        message: error instanceof Error ? error.message : 'Admin auth failed.',
      },
      500,
    )
  }

  const adminClaims = await getAdminTokenClaims(
    body.adminToken!,
    adminSecret,
    request,
  )
  if (!adminClaims) {
    return jsonResponse({ ok: false, message: 'Invalid Admin session.' }, 401)
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  })
  const { data, error } = await supabase.rpc(
    'admin_get_lecture_operator_access_v1',
    { target_lecture_session_id: body.lectureSessionId },
  )
  if (error) {
    return jsonResponse(
      { ok: false, message: 'Display session could not be issued.' },
      500,
    )
  }
  if (!data) {
    return jsonResponse({ ok: false, message: 'Lecture was not found.' }, 404)
  }

  const access = data as OperatorAccess
  if (access.mode !== 'live' || !access.hard_stop_at) {
    return jsonResponse(
      { ok: false, message: 'Only an open lecture can be displayed.' },
      409,
    )
  }

  const nowSeconds = Math.floor(Date.now() / 1000)
  const hardStopSeconds = Math.floor(
    new Date(access.hard_stop_at).getTime() / 1000,
  )
  const expiresAtSeconds = Math.min(
    nowSeconds + 95 * 60,
    hardStopSeconds + 5 * 60,
  )

  try {
    const displaySecret = getDisplayTokenSecret()
    const displayToken = await createDisplayToken(
      body.lectureSessionId,
      expiresAtSeconds,
      displaySecret,
    )
    let realtime: {
      expiresAt: string
      topic: string
    } | null = null

    if (
      body.enableRealtime === true &&
      Deno.env.get('PHASE728_DISPLAY_REALTIME_ENABLED') === 'true'
    ) {
      if (!adminClaims.sid) {
        return jsonResponse(
          {
            ok: false,
            message:
              'A tracked Admin session is required for Display Realtime.',
          },
          409,
        )
      }

      const authorization = request.headers.get('Authorization') ?? ''
      const bearerToken = authorization.startsWith('Bearer ')
        ? authorization.slice('Bearer '.length).trim()
        : ''
      if (!bearerToken) {
        return jsonResponse(
          { ok: false, message: 'Display Realtime authentication failed.' },
          401,
        )
      }
      const { data: authData, error: authError } =
        await supabase.auth.getUser(bearerToken)
      if (authError || !authData.user) {
        return jsonResponse(
          { ok: false, message: 'Display Realtime authentication failed.' },
          401,
        )
      }

      const displayClaims = await getDisplayTokenClaims(
        displayToken,
        displaySecret,
      )
      if (!displayClaims) {
        return jsonResponse(
          { ok: false, message: 'Display session creation failed.' },
          500,
        )
      }

      const { data: registrationData, error: registrationError } =
        await supabase.rpc('register_display_realtime_session_v1', {
          target_admin_auth_user_id: authData.user.id,
          target_admin_session_id: adminClaims.sid,
          target_lecture_session_id: body.lectureSessionId,
          target_session_id: crypto.randomUUID(),
          target_token_expires_at: new Date(
            displayClaims.exp * 1_000,
          ).toISOString(),
          target_token_jti_hash: await sha256Hex(displayClaims.jti),
        })
      if (registrationError || !registrationData) {
        return jsonResponse(
          { ok: false, message: 'Display Realtime could not be prepared.' },
          registrationError?.code === '42501' ? 401 : 500,
        )
      }
      const registration =
        registrationData as unknown as DisplayRealtimeRegistration
      if (
        registration.lecture_session_id !== body.lectureSessionId ||
        !registration.topic ||
        !registration.expires_at
      ) {
        return jsonResponse(
          { ok: false, message: 'Display Realtime could not be prepared.' },
          500,
        )
      }
      realtime = {
        expiresAt: registration.expires_at,
        topic: registration.topic,
      }
    }

    return jsonResponse({
      displayToken,
      expiresAt: new Date(expiresAtSeconds * 1000).toISOString(),
      lectureSessionId: body.lectureSessionId,
      ok: true,
      realtime,
    })
  } catch (error) {
    return jsonResponse(
      {
        ok: false,
        message:
          error instanceof Error
            ? error.message
            : 'Display session creation failed.',
      },
      500,
    )
  }
})
