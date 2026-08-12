import { createClient } from 'npm:@supabase/supabase-js@2'
import {
  getAdminActorId,
  getAdminTokenClaims,
  getAdminTokenSecret,
} from '../_shared/adminToken.ts'
import { handleCors } from '../_shared/cors.ts'
import {
  type GoogleAdminOperationContext,
  verifyGoogleAdminOperationRequest,
} from '../_shared/googleAdminOperations.ts'
import { describeJsonBodyError, readJsonBody } from '../_shared/requestBody.ts'
import { DEFAULT_REALTIME_PRICE_MICROUSD_PER_MINUTE } from '../_shared/openaiRealtime.ts'
import {
  runRealtimeProviderHangupSweep,
  type RealtimeProviderHangupJob,
} from '../_shared/realtimeProviderHangup.ts'
import { createJsonResponse } from '../_shared/responses.ts'

type AiFeature =
  | 'captions'
  | 'summaries'
  | 'material_analysis'
  | 'poll_suggestions'
  | 'academic_answers'

type AiConfiguration = Partial<{
  academic_answer_limit: number
  academic_answers_enabled: boolean
  audio_seconds_limit: number
  budget_limit_microusd: number
  captions_enabled: boolean
  input_token_limit: number
  material_analysis_call_limit: number
  material_analysis_enabled: boolean
  max_concurrent_operations: number
  output_token_limit: number
  poll_generation_limit: number
  poll_suggestions_enabled: boolean
  summaries_enabled: boolean
  summary_call_limit: number
  summary_language: 'auto' | 'ja' | 'en'
}>

type ManageAiControlRequest =
  | {
      action: 'status'
      adminToken?: string
      appSessionToken?: string
      lectureSessionId?: string
    }
  | {
      action: 'configurationIntent'
      adminToken?: string
      appSessionToken?: string
      configuration?: AiConfiguration
      lectureSessionId?: string
      requestId?: string
    }
  | {
      action: 'configure'
      adminToken?: string
      appSessionToken?: string
      configuration?: AiConfiguration
      controlIntentDigest?: string
      lectureSessionId?: string
      requestId?: string
    }
  | {
      action: 'startOperation'
      adminToken?: string
      appSessionToken?: string
      estimatedAudioSeconds?: number
      estimatedInputTokens?: number
      estimatedMicrousd?: number
      estimatedOutputTokens?: number
      feature?: AiFeature
      idempotencyKey?: string
      lectureSessionId?: string
    }
  | {
      action: 'finishOperation'
      actualAudioSeconds?: number
      actualInputTokens?: number
      actualMicrousd?: number
      actualOutputTokens?: number
      adminToken?: string
      appSessionToken?: string
      errorCode?: string | null
      operationId?: string
      providerRequestId?: string | null
      status?: 'succeeded' | 'failed' | 'cancelled'
    }
  | {
      action: 'heartbeat'
      adminToken?: string
      appSessionToken?: string
      lectureSessionId?: string
      operationId?: string
      requestId?: string
    }
  | {
      action: 'stopFeature'
      adminToken?: string
      appSessionToken?: string
      lectureSessionId?: string
      operationId?: string
      reason?: string
      requestId?: string
    }
  | {
      action: 'stop'
      adminToken?: string
      appSessionToken?: string
      lectureSessionId?: string
      reason?: string
      requestId?: string
    }

type GoogleAiControlResult = {
  accepted?: boolean
  control?: unknown
  idempotentReplay?: boolean
  intentDigest?: string
  metadata?: Record<string, unknown>
  recentOperations?: unknown[]
  refreshRequired?: boolean
  requestId?: string
  result?: Record<string, unknown> | null
  serverTime?: string
  status?: string
}

function isUuid(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    )
  )
}

function isSha256(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value)
}

function getNonNegativeInteger(value: number | undefined, field: string) {
  const normalized = value ?? 0
  if (!Number.isSafeInteger(normalized) || normalized < 0) {
    throw new Error(`${field} must be a non-negative safe integer.`)
  }
  return normalized
}

function getRealtimePriceMicrousdPerMinute() {
  const configured = Deno.env.get('OPENAI_REALTIME_PRICE_MICROUSD_PER_MINUTE')
  if (!configured) return DEFAULT_REALTIME_PRICE_MICROUSD_PER_MINUTE
  const parsed = Number(configured)
  return Number.isSafeInteger(parsed) && parsed >= 1 && parsed <= 1_000_000
    ? parsed
    : null
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

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!supabaseUrl || !serviceRoleKey) {
    return jsonResponse(
      { ok: false, message: 'AI control is not configured.' },
      500,
    )
  }

  let body: ManageAiControlRequest
  try {
    body = await readJsonBody<ManageAiControlRequest>(request, 16 * 1024)
  } catch (error) {
    const bodyError = describeJsonBodyError(error)
    return jsonResponse(
      { ok: false, message: bodyError.message },
      bodyError.status,
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

  let supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  })
  let actorId: string | null = null
  let googleContext: GoogleAdminOperationContext | null = null
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
    googleContext = verification
    supabase = verification.serviceClient
  } else {
    let tokenSecret: string
    try {
      tokenSecret = getAdminTokenSecret()
    } catch (error) {
      return jsonResponse(
        {
          ok: false,
          message:
            error instanceof Error ? error.message : 'Admin auth failed.',
        },
        500,
      )
    }
    const adminClaims = await getAdminTokenClaims(
      body.adminToken!,
      tokenSecret,
      request,
    )
    if (!adminClaims) {
      return jsonResponse({ ok: false, message: 'Invalid Admin session.' }, 401)
    }
    actorId = getAdminActorId(adminClaims)
  }

  async function sweepRealtimeProviderCalls({
    lectureSessionId = null,
    operationId = null,
  }: {
    lectureSessionId?: string | null
    operationId?: string | null
  }) {
    const openAiApiKey = Deno.env.get('OPENAI_API_KEY')?.trim()
    if (!openAiApiKey) {
      return { claimed: 0, pending: true, retried: 0, stopped: 0 }
    }
    try {
      const result = await runRealtimeProviderHangupSweep({
        apiKey: openAiApiKey,
        claim: async ({ lectureSessionId, limit, operationId }) => {
          const { data, error } = await supabase.rpc(
            'claim_realtime_provider_hangups',
            {
              job_limit: limit,
              target_lecture_session_id: lectureSessionId,
              target_operation_id: operationId,
            },
          )
          if (error) throw new Error('realtime_hangup_claim_failed')
          return (data ?? []) as RealtimeProviderHangupJob[]
        },
        finish: async ({ error: providerError, operationId, succeeded }) => {
          const { data, error } = await supabase.rpc(
            'finish_realtime_provider_hangup',
            {
              target_error: providerError,
              target_operation_id: operationId,
              target_succeeded: succeeded,
            },
          )
          if (error) throw new Error('realtime_hangup_finalize_failed')
          return data === true
        },
        lectureSessionId,
        limit: operationId ? 1 : 10,
        operationId,
      })
      return { ...result, pending: result.retried > 0 }
    } catch {
      return { claimed: 0, pending: true, retried: 1, stopped: 0 }
    }
  }

  async function getStatus(lectureSessionId: string) {
    const [controlResult, ledgerResult] = await Promise.all([
      supabase
        .from('lecture_ai_control')
        .select('*')
        .eq('lecture_session_id', lectureSessionId)
        .maybeSingle(),
      supabase
        .from('ai_usage_ledger')
        .select(
          'id,lecture_session_id,feature,status,reserved_microusd,actual_microusd,reserved_audio_seconds,actual_audio_seconds,reserved_input_tokens,actual_input_tokens,reserved_output_tokens,actual_output_tokens,result_accepted,error_code,requested_at,finished_at',
        )
        .eq('lecture_session_id', lectureSessionId)
        .order('requested_at', { ascending: false })
        .limit(20),
    ])

    if (controlResult.error) {
      throw new Error(controlResult.error.message)
    }
    if (ledgerResult.error) {
      throw new Error(ledgerResult.error.message)
    }

    return {
      control: controlResult.data,
      recentOperations: ledgerResult.data ?? [],
    }
  }

  try {
    if (googleContext) {
      if (
        body.action === 'startOperation' ||
        body.action === 'finishOperation'
      ) {
        return jsonResponse(
          {
            code: 'provider_specific_authority_required',
            message:
              'Start and finish AI work through the selected feature control.',
            ok: false,
          },
          409,
        )
      }

      const lectureSessionId =
        'lectureSessionId' in body ? body.lectureSessionId : undefined
      if (!isUuid(lectureSessionId)) {
        return jsonResponse(
          { ok: false, message: 'A valid lecture is required.' },
          400,
        )
      }

      if (body.action === 'configurationIntent') {
        if (!isUuid(body.requestId) || !body.configuration) {
          return jsonResponse(
            {
              ok: false,
              message: 'A configuration and stable request ID are required.',
            },
            400,
          )
        }
        const { data, error } = await supabase.rpc(
          'get_google_admin_ai_control_configuration_intent_v1',
          {
            target_auth_user_id: googleContext.authUserId,
            target_configuration: body.configuration,
            target_google_issuer: googleContext.googleIssuer,
            target_lecture_session_id: lectureSessionId,
            target_provider_subject_hmac: googleContext.googleSubjectHmac,
            target_request_id: body.requestId,
            target_subject_pepper_version: googleContext.subjectPepperVersion,
            target_supabase_auth_session_id:
              googleContext.supabaseAuthSessionId,
            target_token_hash: googleContext.appSessionTokenHash,
            target_transport_enabled: googleContext.transportEnabled,
          },
        )
        const result = data as GoogleAiControlResult | null
        if (
          error ||
          result?.accepted !== true ||
          !isSha256(result.intentDigest) ||
          result.requestId !== body.requestId
        ) {
          return jsonResponse(
            {
              message: 'AI policy verification could not be prepared.',
              ok: false,
            },
            409,
          )
        }
        return jsonResponse({
          controlIntentDigest: result.intentDigest,
          ok: true,
          requestId: result.requestId,
          serverTime: result.serverTime ?? null,
        })
      }

      let semanticAction:
        | 'configure'
        | 'disableFeatures'
        | 'heartbeat'
        | 'setSummaryLanguage'
        | 'status'
        | 'stop'
        | 'stopFeature' = body.action
      let configuration: AiConfiguration | null = null
      let controlIntentDigest: string | null = null
      let operationId: string | null = null
      let reason: string | null = null
      let requestId: string | null = null

      if (body.action === 'configure') {
        if (!body.configuration) {
          return jsonResponse(
            { ok: false, message: 'configuration is required.' },
            400,
          )
        }
        configuration = body.configuration
        const entries = Object.entries(configuration)
        if (entries.length === 1 && entries[0]?.[0] === 'summary_language') {
          semanticAction = 'setSummaryLanguage'
        } else if (
          entries.length > 0 &&
          entries.every(
            ([key, value]) => key.endsWith('_enabled') && value === false,
          )
        ) {
          semanticAction = 'disableFeatures'
        } else {
          semanticAction = 'configure'
          controlIntentDigest = body.controlIntentDigest ?? null
          if (!isSha256(controlIntentDigest)) {
            return jsonResponse(
              {
                code: 'control_step_up_required',
                message:
                  'Confirm this sensitive policy change with the authenticator app.',
                ok: false,
              },
              409,
            )
          }
        }
        requestId = body.requestId ?? null
      } else if (body.action === 'heartbeat') {
        operationId = body.operationId ?? null
        requestId = body.requestId ?? null
      } else if (body.action === 'stopFeature') {
        operationId = body.operationId ?? null
        requestId = body.requestId ?? null
        reason = body.reason?.trim() ?? null
      } else if (body.action === 'stop') {
        requestId = body.requestId ?? null
        reason = body.reason?.trim() ?? null
      }

      if (
        semanticAction !== 'status' &&
        (!isUuid(requestId) ||
          (operationId !== null && !isUuid(operationId)) ||
          (reason !== null && (reason.length < 1 || reason.length > 120)))
      ) {
        return jsonResponse(
          { ok: false, message: 'The AI control request is invalid.' },
          400,
        )
      }

      const { data, error } = await supabase.rpc(
        'manage_google_admin_ai_control_v1',
        {
          target_action: semanticAction,
          target_auth_user_id: googleContext.authUserId,
          target_configuration: configuration,
          target_control_intent_digest: controlIntentDigest,
          target_google_issuer: googleContext.googleIssuer,
          target_lecture_session_id: lectureSessionId,
          target_operation_id: operationId,
          target_provider_subject_hmac: googleContext.googleSubjectHmac,
          target_reason: reason,
          target_request_id: requestId,
          target_subject_pepper_version: googleContext.subjectPepperVersion,
          target_supabase_auth_session_id: googleContext.supabaseAuthSessionId,
          target_token_hash: googleContext.appSessionTokenHash,
          target_transport_enabled: googleContext.transportEnabled,
        },
      )
      const result = data as GoogleAiControlResult | null
      if (error || result?.accepted !== true) {
        return jsonResponse(
          {
            message:
              semanticAction === 'status'
                ? 'AI control status is unavailable.'
                : 'AI control could not be updated.',
            ok: false,
          },
          409,
        )
      }

      if (semanticAction === 'status') {
        return jsonResponse({
          control: result.control ?? null,
          ok: true,
          realtimePriceMicrousdPerMinute: getRealtimePriceMicrousdPerMinute(),
          recentOperations: result.recentOperations ?? [],
          serverTime: result.serverTime ?? null,
        })
      }
      if (
        semanticAction === 'configure' ||
        semanticAction === 'disableFeatures' ||
        semanticAction === 'setSummaryLanguage'
      ) {
        const providerHangup =
          semanticAction === 'disableFeatures' &&
          configuration?.captions_enabled === false
            ? await sweepRealtimeProviderCalls({ lectureSessionId })
            : null
        return jsonResponse({
          control: result.result ?? null,
          idempotentReplay: result.idempotentReplay === true,
          metadata: result.metadata ?? {},
          ok: true,
          providerHangup,
          refreshRequired: result.refreshRequired === true,
          status: result.status ?? null,
        })
      }
      const shouldStopRealtime =
        semanticAction === 'heartbeat' &&
        (result.status === 'stop' || result.metadata?.should_stop === true)
      const providerHangup =
        semanticAction === 'stop' ||
        semanticAction === 'stopFeature' ||
        shouldStopRealtime
          ? await sweepRealtimeProviderCalls(
              operationId ? { operationId } : { lectureSessionId },
            )
          : (result.result?.providerHangup ?? null)
      return jsonResponse({
        idempotentReplay: result.idempotentReplay === true,
        metadata: result.metadata ?? {},
        ok: true,
        providerHangup,
        refreshRequired: result.refreshRequired === true,
        result: result.result ?? result.metadata ?? null,
        status: result.status ?? null,
      })
    }

    if (body.action === 'heartbeat') {
      if (!body.operationId) {
        return jsonResponse(
          { ok: false, message: 'operationId is required.' },
          400,
        )
      }
      const { data: operationClock, error: operationClockError } =
        await supabase
          .from('ai_usage_ledger')
          .select(
            'feature,status,requested_at,requested_by_actor,reserved_audio_seconds',
          )
          .eq('id', body.operationId)
          .maybeSingle()
      if (operationClockError) {
        throw new Error(operationClockError.message)
      }
      if (
        operationClock?.feature === 'captions' &&
        operationClock.status === 'running' &&
        operationClock.requested_by_actor === actorId
      ) {
        const reservedUntil =
          Date.parse(operationClock.requested_at) +
          Number(operationClock.reserved_audio_seconds) * 1_000
        if (Number.isFinite(reservedUntil) && reservedUntil <= Date.now()) {
          const { error: finishError } = await supabase.rpc(
            'admin_finish_realtime_caption_operation',
            {
              charge_elapsed: true,
              disable_feature: true,
              target_actor_id: actorId,
              target_operation_id: body.operationId,
              target_reason: 'selected_duration_elapsed',
            },
          )
          if (finishError) {
            throw new Error(finishError.message)
          }
          const providerHangup = await sweepRealtimeProviderCalls({
            operationId: body.operationId,
          })
          return jsonResponse({
            ok: true,
            providerHangup,
            result: {
              reason: 'selected_duration_elapsed',
              server_time: new Date().toISOString(),
              should_stop: true,
            },
          })
        }
      }
      const { data, error } = await supabase.rpc(
        'admin_heartbeat_realtime_caption_operation',
        {
          target_actor_id: actorId,
          target_operation_id: body.operationId,
        },
      )
      if (error) throw new Error(error.message)
      const shouldStop =
        data &&
        typeof data === 'object' &&
        !Array.isArray(data) &&
        (data as Record<string, unknown>).should_stop === true
      const providerHangup = shouldStop
        ? await sweepRealtimeProviderCalls({ operationId: body.operationId })
        : null
      return jsonResponse({ ok: true, providerHangup, result: data })
    }

    if (body.action === 'stopFeature') {
      const reason = body.reason?.trim()
      if (!body.operationId || !reason) {
        return jsonResponse(
          { ok: false, message: 'operationId and reason are required.' },
          400,
        )
      }
      const { data, error } = await supabase.rpc(
        'admin_finish_realtime_caption_operation',
        {
          charge_elapsed: true,
          disable_feature: true,
          target_actor_id: actorId,
          target_operation_id: body.operationId,
          target_reason: reason,
        },
      )
      if (error) throw new Error(error.message)
      const providerHangup = await sweepRealtimeProviderCalls({
        operationId: body.operationId,
      })
      return jsonResponse({ ok: true, providerHangup, result: data })
    }

    if (body.action === 'finishOperation') {
      if (!body.operationId || !body.status) {
        return jsonResponse(
          { ok: false, message: 'operationId and status are required.' },
          400,
        )
      }

      const { data: operation, error: operationError } = await supabase
        .from('ai_usage_ledger')
        .select('feature')
        .eq('id', body.operationId)
        .maybeSingle()
      if (operationError) throw new Error(operationError.message)
      // Phase 5 operations must be finalized by their dedicated endpoints.
      // Later Batch features inherit the same exact-settlement boundary.
      if (
        operation?.feature === 'summaries' ||
        operation?.feature === 'material_analysis' ||
        operation?.feature === 'poll_suggestions' ||
        operation?.feature === 'academic_answers'
      ) {
        return jsonResponse(
          {
            ok: false,
            message:
              'Batch AI operations must be finalized by their dedicated endpoints.',
          },
          409,
        )
      }

      const { data, error } = await supabase.rpc(
        'admin_finish_lecture_ai_operation',
        {
          actual_audio_seconds: getNonNegativeInteger(
            body.actualAudioSeconds,
            'actualAudioSeconds',
          ),
          actual_input_tokens: getNonNegativeInteger(
            body.actualInputTokens,
            'actualInputTokens',
          ),
          actual_microusd: getNonNegativeInteger(
            body.actualMicrousd,
            'actualMicrousd',
          ),
          actual_output_tokens: getNonNegativeInteger(
            body.actualOutputTokens,
            'actualOutputTokens',
          ),
          error_code: body.errorCode ?? null,
          provider_request_id: body.providerRequestId ?? null,
          target_operation_id: body.operationId,
          target_status: body.status,
        },
      )
      if (error) {
        throw new Error(error.message)
      }
      return jsonResponse({ ok: true, result: data })
    }

    if (!body.lectureSessionId) {
      return jsonResponse(
        { ok: false, message: 'lectureSessionId is required.' },
        400,
      )
    }

    if (body.action === 'status') {
      return jsonResponse({
        ok: true,
        ...(await getStatus(body.lectureSessionId)),
        realtimePriceMicrousdPerMinute: getRealtimePriceMicrousdPerMinute(),
      })
    }

    if (body.action === 'configure') {
      if (!body.configuration) {
        return jsonResponse(
          { ok: false, message: 'configuration is required.' },
          400,
        )
      }
      if (
        Object.entries(body.configuration).some(
          ([key, value]) => key.endsWith('_enabled') && value === true,
        )
      ) {
        return jsonResponse(
          {
            ok: false,
            message: 'Enabling a paid AI feature requires a billing grant.',
          },
          403,
        )
      }
      if ('summary_language' in body.configuration) {
        if (Deno.env.get('PHASE7_1_CLASSROOM_EXTENSIONS_ENABLED') !== 'true') {
          return jsonResponse(
            { ok: false, message: 'Summary language control is disabled.' },
            503,
          )
        }
        if (Object.keys(body.configuration).length !== 1) {
          return jsonResponse(
            {
              ok: false,
              message: 'Summary language must be configured independently.',
            },
            400,
          )
        }
        const summaryLanguage = body.configuration.summary_language
        if (!['auto', 'ja', 'en'].includes(summaryLanguage ?? '')) {
          return jsonResponse(
            { ok: false, message: 'Invalid summary language.' },
            400,
          )
        }
        const { data, error } = await supabase.rpc(
          'admin_set_lecture_summary_language',
          {
            target_actor_id: actorId,
            target_lecture_session_id: body.lectureSessionId,
            target_summary_language: summaryLanguage,
          },
        )
        if (error) throw new Error(error.message)
        return jsonResponse({ control: data, ok: true })
      }
      const { data, error } = await supabase.rpc(
        'admin_configure_lecture_ai_control',
        {
          configuration: body.configuration,
          target_actor_id: actorId,
          target_lecture_session_id: body.lectureSessionId,
        },
      )
      if (error) {
        throw new Error(error.message)
      }
      return jsonResponse({ control: data, ok: true })
    }

    if (body.action === 'startOperation') {
      return jsonResponse(
        {
          ok: false,
          message: 'Starting a paid AI feature requires a billing grant.',
        },
        403,
      )
    }

    if (body.action === 'stop') {
      const reason = body.reason?.trim()
      if (!reason) {
        return jsonResponse(
          { ok: false, message: 'stop reason is required.' },
          400,
        )
      }
      if (Deno.env.get('PHASE6_SUMMARIES_ENABLED') === 'true') {
        await supabase.rpc('admin_stop_lecture_summary_run', {
          target_actor_id: actorId,
          target_lecture_session_id: body.lectureSessionId,
          target_reason: reason,
        })
      }
      const { data, error } = await supabase.rpc(
        'admin_stop_lecture_ai_control',
        {
          target_actor_id: actorId,
          target_lecture_session_id: body.lectureSessionId,
          target_reason: reason,
        },
      )
      if (error) {
        throw new Error(error.message)
      }
      const providerHangup = await sweepRealtimeProviderCalls({
        lectureSessionId: body.lectureSessionId,
      })
      return jsonResponse({ control: data, ok: true, providerHangup })
    }

    return jsonResponse({ ok: false, message: 'Unknown action.' }, 400)
  } catch (error) {
    return jsonResponse(
      {
        ok: false,
        message:
          error instanceof Error
            ? error.message
            : 'AI control operation failed.',
      },
      409,
    )
  }
})
