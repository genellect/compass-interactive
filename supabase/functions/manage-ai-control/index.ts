import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.110.0'
import {
  getAdminActorId,
  getAdminTokenClaims,
  getAdminTokenSecret,
} from '../_shared/adminToken.ts'
import { handleCors } from '../_shared/cors.ts'
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
}>

type ManageAiControlRequest =
  | {
      action: 'status'
      adminToken?: string
      lectureSessionId?: string
    }
  | {
      action: 'configure'
      adminToken?: string
      configuration?: AiConfiguration
      lectureSessionId?: string
    }
  | {
      action: 'startOperation'
      adminToken?: string
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
      errorCode?: string | null
      operationId?: string
      providerRequestId?: string | null
      status?: 'succeeded' | 'failed' | 'cancelled'
    }
  | {
      action: 'heartbeat'
      adminToken?: string
      operationId?: string
    }
  | {
      action: 'stopFeature'
      adminToken?: string
      operationId?: string
      reason?: string
    }
  | {
      action: 'stop'
      adminToken?: string
      lectureSessionId?: string
      reason?: string
    }

function getNonNegativeInteger(value: number | undefined, field: string) {
  const normalized = value ?? 0
  if (!Number.isSafeInteger(normalized) || normalized < 0) {
    throw new Error(`${field} must be a non-negative safe integer.`)
  }
  return normalized
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
    body = (await request.json()) as ManageAiControlRequest
  } catch {
    return jsonResponse({ ok: false, message: 'Invalid JSON body.' }, 400)
  }

  let tokenSecret: string
  try {
    tokenSecret = getAdminTokenSecret()
  } catch (error) {
    return jsonResponse(
      {
        ok: false,
        message: error instanceof Error ? error.message : 'Admin auth failed.',
      },
      500,
    )
  }

  const adminClaims = body.adminToken
    ? await getAdminTokenClaims(body.adminToken, tokenSecret)
    : null
  if (!adminClaims) {
    return jsonResponse({ ok: false, message: 'Invalid Admin session.' }, 401)
  }
  const actorId = getAdminActorId(adminClaims)

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  })

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
    if (body.action === 'heartbeat') {
      if (!body.operationId) {
        return jsonResponse(
          { ok: false, message: 'operationId is required.' },
          400,
        )
      }
      const { data, error } = await supabase.rpc(
        'admin_heartbeat_realtime_caption_operation',
        {
          target_actor_id: actorId,
          target_operation_id: body.operationId,
        },
      )
      if (error) throw new Error(error.message)
      return jsonResponse({ ok: true, result: data })
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
      return jsonResponse({ ok: true, result: data })
    }

    if (body.action === 'finishOperation') {
      if (!body.operationId || !body.status) {
        return jsonResponse(
          { ok: false, message: 'operationId and status are required.' },
          400,
        )
      }

      const { data: operation, error: operationError } = await supabase
        .from('lecture_ai_operation_ledger')
        .select('feature')
        .eq('id', body.operationId)
        .maybeSingle()
      if (operationError) throw new Error(operationError.message)
      if (
        operation?.feature === 'summaries' ||
        operation?.feature === 'material_analysis' ||
        operation?.feature === 'poll_suggestions'
      ) {
        return jsonResponse(
          {
            ok: false,
            message:
              'Phase 5 operations must be finalized by their dedicated endpoints; summaries use their dedicated endpoint too.',
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
      return jsonResponse({ control: data, ok: true })
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
