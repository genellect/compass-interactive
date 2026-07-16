import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.110.0'
import {
  getAdminActorId,
  getAdminTokenClaims,
  getAdminTokenSecret,
} from '../_shared/adminToken.ts'
import { handleCors } from '../_shared/cors.ts'
import { createJsonResponse } from '../_shared/responses.ts'

type PublishCaptionRequest = {
  adminToken?: string
  language?: 'auto' | 'en' | 'ja' | 'mixed' | 'und'
  lastItemId?: string
  lectureSessionId?: string
  operationId?: string
  sequence?: number
  text?: string
}

Deno.serve(async (request) => {
  const jsonResponse = createJsonResponse(request)
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
  if (!supabaseUrl || !serviceRoleKey) {
    return jsonResponse(
      { ok: false, message: 'Caption publishing is not configured.' },
      503,
    )
  }

  let body: PublishCaptionRequest
  try {
    body = (await request.json()) as PublishCaptionRequest
  } catch {
    return jsonResponse({ ok: false, message: 'Invalid JSON body.' }, 400)
  }

  const text = body.text?.trim() ?? ''
  if (
    !body.adminToken ||
    !body.lectureSessionId ||
    !body.operationId ||
    !body.lastItemId ||
    text.length < 1 ||
    text.length > 1000 ||
    !Number.isSafeInteger(body.sequence) ||
    (body.sequence ?? -1) < 0
  ) {
    return jsonResponse(
      { ok: false, message: 'Caption window is invalid.' },
      400,
    )
  }

  let claims
  try {
    claims = await getAdminTokenClaims(body.adminToken, getAdminTokenSecret())
  } catch (error) {
    return jsonResponse(
      {
        ok: false,
        message: error instanceof Error ? error.message : 'Admin auth failed.',
      },
      500,
    )
  }
  if (!claims) {
    return jsonResponse({ ok: false, message: 'Invalid Admin session.' }, 401)
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  })
  const { data, error } = await supabase.rpc('admin_publish_lecture_caption', {
    target_actor_id: getAdminActorId(claims),
    target_language: body.language ?? 'auto',
    target_last_item_id: body.lastItemId,
    target_lecture_session_id: body.lectureSessionId,
    target_operation_id: body.operationId,
    target_sequence: body.sequence,
    target_text: text,
  })
  if (error) {
    return jsonResponse(
      { ok: false, message: 'Caption window was not accepted.' },
      409,
    )
  }

  return jsonResponse({ ok: true, result: data })
})
