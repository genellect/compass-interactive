import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.110.0'
import {
  getAdminTokenClaims,
  getAdminTokenSecret,
  sha256Hex,
} from '../_shared/adminToken.ts'
import { handleCors } from '../_shared/cors.ts'
import { describeJsonBodyError, readJsonBody } from '../_shared/requestBody.ts'
import {
  createDisplayToken,
  getDisplayTokenClaims,
  getDisplayTokenSecret,
} from '../_shared/displayToken.ts'
import { createJsonResponse } from '../_shared/responses.ts'

type IssueDisplaySessionRequest = {
  adminToken?: string
  enableRealtime?: boolean
  lectureSessionId?: string
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
    !body.adminToken ||
    !body.lectureSessionId ||
    !isUuid(body.lectureSessionId) ||
    (body.enableRealtime !== undefined &&
      typeof body.enableRealtime !== 'boolean')
  ) {
    return jsonResponse(
      {
        ok: false,
        message: 'adminToken and lectureSessionId are required.',
      },
      400,
    )
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
    body.adminToken,
    adminSecret,
    request,
  )
  if (!adminClaims) {
    return jsonResponse({ ok: false, message: 'Invalid Admin session.' }, 401)
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!supabaseUrl || !serviceRoleKey) {
    return jsonResponse(
      { ok: false, message: 'Display session service is not configured.' },
      500,
    )
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
            message: 'A tracked Admin session is required for Display Realtime.',
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
