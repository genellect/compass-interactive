import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.110.0'
import { getAdminTokenSecret, verifyAdminToken } from '../_shared/adminToken.ts'
import { handleCors } from '../_shared/cors.ts'
import {
  createDisplayToken,
  getDisplayTokenSecret,
} from '../_shared/displayToken.ts'
import { createJsonResponse } from '../_shared/responses.ts'

type IssueDisplaySessionRequest = {
  adminToken?: string
  lectureSessionId?: string
}

type OperatorAccess = {
  hard_stop_at: string | null
  lecture_session_id: string
  mode: 'live' | 'terminal' | 'unavailable'
  server_time: string
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
    body = (await request.json()) as IssueDisplaySessionRequest
  } catch {
    return jsonResponse({ ok: false, message: 'Invalid JSON body.' }, 400)
  }

  if (
    !body.adminToken ||
    !body.lectureSessionId ||
    !isUuid(body.lectureSessionId)
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

  if (!(await verifyAdminToken(body.adminToken, adminSecret))) {
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
    const displayToken = await createDisplayToken(
      body.lectureSessionId,
      expiresAtSeconds,
      getDisplayTokenSecret(),
    )
    return jsonResponse({
      displayToken,
      expiresAt: new Date(expiresAtSeconds * 1000).toISOString(),
      lectureSessionId: body.lectureSessionId,
      ok: true,
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
