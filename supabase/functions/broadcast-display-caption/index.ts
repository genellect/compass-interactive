import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.110.0'
import { handleCors } from '../_shared/cors.ts'
import { describeJsonBodyError, readJsonBody } from '../_shared/requestBody.ts'
import { createJsonResponse } from '../_shared/responses.ts'

const MAX_CAPTION_TEXT_CHARACTERS = 4_000
const REALTIME_RELAY_TIMEOUT_MS = 5_000

type CaptionMessage = {
  caption?: { text?: unknown } | null
  lectureSessionId?: unknown
  sequence?: unknown
  source?: unknown
  streamId?: unknown
  timestamp?: unknown
}

type RelayRequest = {
  lectureSessionId?: string
  message?: CaptionMessage
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
    !body.lectureSessionId ||
    !isUuid(body.lectureSessionId) ||
    !body.topic ||
    !new RegExp(
      `^display:${body.lectureSessionId.replaceAll('-', '\\-')}:[0-9a-f-]{36}$`,
      'i',
    ).test(body.topic) ||
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
  if (authError || !authData.user) {
    return jsonResponse({ message: 'Authentication required.', ok: false }, 401)
  }

  const { data: admission, error: admissionError } = await service.rpc(
    'claim_display_caption_relay_v1',
    {
      target_admin_auth_user_id: authData.user.id,
      target_lecture_session_id: body.lectureSessionId,
      target_sequence: body.message.sequence,
      target_source: body.message.source,
      target_stream_id: body.message.streamId,
      target_topic: body.topic,
    },
  )
  if (admissionError) {
    return jsonResponse(
      { message: 'Display caption relay admission failed.', ok: false },
      500,
    )
  }
  if (admission === 'rate_limited') {
    return jsonResponse(
      { message: 'Display caption relay is rate limited.', ok: false },
      429,
    )
  }
  if (admission === 'stale') {
    return jsonResponse(
      { message: 'Display caption relay is stale.', ok: false },
      409,
    )
  }
  if (admission !== 'allowed') {
    return jsonResponse(
      { message: 'Display caption relay is unavailable.', ok: false },
      403,
    )
  }

  const relayUrl = new URL(
    `/realtime/v1/api/broadcast/${encodeURIComponent(body.topic)}/events/caption`,
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
