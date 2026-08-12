import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.110.0'
import { timingSafeEqual } from '../_shared/adminToken.ts'
import {
  runRealtimeProviderHangupSweep,
  type RealtimeProviderHangupJob,
} from '../_shared/realtimeProviderHangup.ts'

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    headers: {
      'Cache-Control': 'no-store',
      'Content-Type': 'application/json; charset=utf-8',
      'X-Content-Type-Options': 'nosniff',
    },
    status,
  })
}

function bearerToken(request: Request) {
  const authorization = request.headers.get('Authorization') ?? ''
  return authorization.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length)
    : ''
}

async function parseLimit(request: Request) {
  const text = await request.text()
  if (!text.trim()) return 10
  const body = JSON.parse(text) as Record<string, unknown>
  const limit = body.limit ?? 10
  if (!Number.isInteger(limit) || Number(limit) < 1 || Number(limit) > 50) {
    throw new Error('invalid_request')
  }
  return Number(limit)
}

Deno.serve(async (request) => {
  if (request.method !== 'POST') {
    return jsonResponse({ message: 'Method not allowed.', ok: false }, 405)
  }
  const triggerSecret = Deno.env.get('REALTIME_SWEEP_TRIGGER_SECRET') ?? ''
  if (
    new TextEncoder().encode(triggerSecret).byteLength < 32 ||
    !timingSafeEqual(triggerSecret, bearerToken(request))
  ) {
    return jsonResponse({ message: 'Unauthorized.', ok: false }, 401)
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')?.trim()
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')?.trim()
  const openAiApiKey = Deno.env.get('OPENAI_API_KEY')?.trim()
  if (!supabaseUrl || !serviceRoleKey || !openAiApiKey) {
    return jsonResponse(
      { message: 'Realtime provider sweep is not configured.', ok: false },
      503,
    )
  }

  let limit: number
  try {
    limit = await parseLimit(request)
  } catch {
    return jsonResponse({ message: 'Invalid request.', ok: false }, 400)
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  })
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
      limit,
    })
    return jsonResponse({ ok: true, ...result })
  } catch {
    return jsonResponse(
      { message: 'Realtime provider sweep failed.', ok: false },
      500,
    )
  }
})
