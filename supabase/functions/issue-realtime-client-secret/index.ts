import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.110.0'
import { parseBillingGrantToken, sha256Hex } from '../_shared/aiBilling.ts'
import {
  getAdminActorId,
  getAdminTokenClaims,
  getAdminTokenSecret,
} from '../_shared/adminToken.ts'
import { handleCors } from '../_shared/cors.ts'
import {
  createOpenAiRealtimeClientSecret,
  createRealtimeTranscriptionSessionConfig,
  DEFAULT_REALTIME_PRICE_MICROUSD_PER_MINUTE,
  DEFAULT_REALTIME_TRANSCRIPTION_MODEL,
  type RealtimeTranscriptionDelay,
} from '../_shared/openaiRealtime.ts'
import { jsonResponse } from '../_shared/responses.ts'

type IssueRealtimeSecretRequest = {
  adminToken?: string
  billingGrant?: string
  delay?: RealtimeTranscriptionDelay
  idempotencyKey?: string
  language?: 'auto' | 'en' | 'ja'
  lectureSessionId?: string
}

type LectureControl = {
  audio_seconds_limit: number
  audio_seconds_used: number
  budget_limit_microusd: number
  hard_stop_at: string | null
  used_microusd: number
}

type LectureState = {
  hard_stop_at: string | null
  status: string
}

type StartResult = {
  accepted?: boolean
  operations?: Array<{ operation?: { id?: string } }>
  reason?: string
}

const VALID_DELAYS = new Set<RealtimeTranscriptionDelay>([
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
])

function parsePrice(value: string | undefined) {
  if (!value) return DEFAULT_REALTIME_PRICE_MICROUSD_PER_MINUTE
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 1_000_000) {
    throw new Error('Realtime pricing configuration is invalid.')
  }
  return parsed
}

Deno.serve(async (request) => {
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
  const openAiApiKey = Deno.env.get('OPENAI_API_KEY')
  if (!supabaseUrl || !serviceRoleKey || !openAiApiKey) {
    return jsonResponse(
      { ok: false, message: 'Realtime transcription is not configured.' },
      503,
    )
  }

  let body: IssueRealtimeSecretRequest
  try {
    body = (await request.json()) as IssueRealtimeSecretRequest
  } catch {
    return jsonResponse({ ok: false, message: 'Invalid JSON body.' }, 400)
  }
  if (
    !body.adminToken ||
    !body.billingGrant ||
    !body.lectureSessionId ||
    !body.idempotencyKey ||
    body.idempotencyKey.length < 8 ||
    body.idempotencyKey.length > 160
  ) {
    return jsonResponse(
      { ok: false, message: 'Realtime start request is incomplete.' },
      400,
    )
  }

  const language = body.language ?? 'auto'
  const delay = body.delay ?? 'low'
  if (!['auto', 'en', 'ja'].includes(language) || !VALID_DELAYS.has(delay)) {
    return jsonResponse(
      { ok: false, message: 'Invalid transcription configuration.' },
      400,
    )
  }

  let claims
  let grant
  let pricePerMinute: number
  try {
    const tokenSecret = getAdminTokenSecret()
    claims = await getAdminTokenClaims(body.adminToken, tokenSecret)
    grant = parseBillingGrantToken(body.billingGrant)
    pricePerMinute = parsePrice(
      Deno.env.get('OPENAI_REALTIME_PRICE_MICROUSD_PER_MINUTE'),
    )
  } catch (error) {
    return jsonResponse(
      {
        ok: false,
        message:
          error instanceof Error ? error.message : 'Realtime start failed.',
      },
      400,
    )
  }
  if (!claims) {
    return jsonResponse({ ok: false, message: 'Invalid Admin session.' }, 401)
  }

  const actorId = getAdminActorId(claims)
  const model =
    Deno.env.get('OPENAI_REALTIME_TRANSCRIPTION_MODEL') ??
    DEFAULT_REALTIME_TRANSCRIPTION_MODEL
  if (!/^[a-z0-9][a-z0-9._-]{1,119}$/i.test(model)) {
    return jsonResponse(
      { ok: false, message: 'Realtime model configuration is invalid.' },
      503,
    )
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  })
  const [controlResult, lectureResult] = await Promise.all([
    supabase
      .from('lecture_ai_control')
      .select(
        'hard_stop_at,budget_limit_microusd,used_microusd,audio_seconds_limit,audio_seconds_used',
      )
      .eq('lecture_session_id', body.lectureSessionId)
      .maybeSingle(),
    supabase
      .from('lecture_sessions')
      .select('status,hard_stop_at')
      .eq('id', body.lectureSessionId)
      .maybeSingle(),
  ])
  if (controlResult.error || lectureResult.error) {
    return jsonResponse(
      { ok: false, message: 'AI usage limits could not be checked.' },
      409,
    )
  }
  const control = controlResult.data as LectureControl | null
  const lecture = lectureResult.data as LectureState | null
  const hardStopMs = Date.parse(lecture?.hard_stop_at ?? '')
  if (
    !control ||
    !lecture ||
    lecture.status !== 'open' ||
    !Number.isFinite(hardStopMs) ||
    hardStopMs <= Date.now()
  ) {
    return jsonResponse({ ok: false, message: 'Lecture is not open.' }, 409)
  }

  const remainingByDeadline = Math.max(
    0,
    Math.floor((hardStopMs - Date.now()) / 1000),
  )
  const remainingByAudio = Math.max(
    0,
    control.audio_seconds_limit - control.audio_seconds_used,
  )
  const remainingBudget = Math.max(
    0,
    control.budget_limit_microusd - control.used_microusd,
  )
  const remainingByBudget = Math.floor((remainingBudget * 60) / pricePerMinute)
  const reservedAudioSeconds = Math.min(
    remainingByDeadline,
    remainingByAudio,
    remainingByBudget,
  )
  if (reservedAudioSeconds < 1) {
    return jsonResponse(
      { ok: false, message: 'Realtime caption limit has been reached.' },
      409,
    )
  }
  const reservedMicrousd = Math.ceil(
    (reservedAudioSeconds * pricePerMinute) / 60,
  )
  const nonceHash = await sha256Hex(grant.nonce)
  const { data: startData, error: startError } = await supabase.rpc(
    'admin_consume_ai_billing_grant',
    {
      target_actor_id: actorId,
      target_grant_id: grant.grantId,
      target_lecture_session_id: body.lectureSessionId,
      target_nonce_hash: nonceHash,
      target_operations: [
        {
          estimated_audio_seconds: reservedAudioSeconds,
          estimated_input_tokens: 0,
          estimated_microusd: reservedMicrousd,
          estimated_output_tokens: 0,
          feature: 'captions',
          idempotency_key: body.idempotencyKey,
          model_id: model,
          pricing_rate_microusd: pricePerMinute,
          pricing_unit: 'audio_minute',
        },
      ],
    },
  )
  const startResult = startData as StartResult | null
  const operationId = startResult?.operations?.[0]?.operation?.id
  if (startError || !startResult?.accepted || !operationId) {
    return jsonResponse(
      {
        ok: false,
        message: 'Billing authorization expired or usage limit was reached.',
        reason: startResult?.reason ?? null,
      },
      409,
    )
  }

  const sessionConfig = createRealtimeTranscriptionSessionConfig({
    delay,
    ...(language === 'auto' ? {} : { language }),
    model,
  })
  try {
    const clientSecret = await createOpenAiRealtimeClientSecret({
      apiKey: openAiApiKey,
      safetyIdentifier: await sha256Hex(`${body.lectureSessionId}:${actorId}`),
      sessionConfig,
    })

    await supabase.rpc('admin_record_realtime_token_issue', {
      target_actor_id: actorId,
      target_model_id: model,
      target_operation_id: operationId,
      target_outcome: 'issued',
      target_provider_request_id: clientSecret.requestId,
    })

    return jsonResponse({
      clientSecret: clientSecret.value,
      expiresAt: clientSecret.expiresAt,
      model,
      ok: true,
      operationId,
      sessionConfig,
    })
  } catch (error) {
    const errorCode =
      error instanceof Error ? error.message.slice(0, 120) : 'openai_error'
    await supabase.rpc('admin_finish_realtime_caption_operation', {
      charge_elapsed: false,
      disable_feature: true,
      target_actor_id: actorId,
      target_operation_id: operationId,
      target_reason: errorCode,
    })
    await supabase.rpc('admin_record_realtime_token_issue', {
      target_actor_id: actorId,
      target_model_id: model,
      target_operation_id: operationId,
      target_outcome: 'failed',
      target_provider_request_id: null,
    })
    return jsonResponse(
      {
        ok: false,
        message: 'OpenAI Realtime connection could not be prepared.',
      },
      errorCode === 'openai_http_429' ? 429 : 502,
    )
  }
})
