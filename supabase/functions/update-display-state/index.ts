import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Origin': '*',
}

const textEncoder = new TextEncoder()
const textDecoder = new TextDecoder()

type DisplayMode = 'normal' | 'presentation' | 'slideOnly'

type UpdateDisplayStateRequest = {
  action?: 'next' | 'previous' | 'goToPage' | 'setDisplayMode'
  adminToken?: string
  currentPdfPage?: number
  displayMode?: DisplayMode
  lectureSessionId?: string
}

type DisplayStateRow = {
  lecture_session_id: string
  current_pdf_page: number
  display_mode: DisplayMode
  updated_at: string
}

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json',
    },
    status,
  })
}

function base64UrlToBytes(value: string) {
  const base64 = value.replaceAll('-', '+').replaceAll('_', '/')
  const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '=')
  const binary = atob(padded)
  const bytes = new Uint8Array(binary.length)

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }

  return bytes
}

function base64UrlToString(value: string) {
  return textDecoder.decode(base64UrlToBytes(value))
}

function base64UrlEncode(value: Uint8Array) {
  let binary = ''

  for (const byte of value) {
    binary += String.fromCharCode(byte)
  }

  return btoa(binary)
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll('=', '')
}

async function signToken(payload: string, secret: string) {
  const key = await crypto.subtle.importKey(
    'raw',
    textEncoder.encode(secret),
    { hash: 'SHA-256', name: 'HMAC' },
    false,
    ['sign'],
  )
  const signature = await crypto.subtle.sign('HMAC', key, textEncoder.encode(payload))

  return base64UrlEncode(new Uint8Array(signature))
}

function timingSafeEqual(left: string, right: string) {
  if (left.length !== right.length) {
    return false
  }

  let mismatch = 0
  for (let index = 0; index < left.length; index += 1) {
    mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index)
  }

  return mismatch === 0
}

async function verifyAdminToken(token: string, secret: string) {
  const [payload, signature] = token.split('.')

  if (!payload || !signature) {
    return false
  }

  const expectedSignature = await signToken(payload, secret)

  if (!timingSafeEqual(signature, expectedSignature)) {
    return false
  }

  const parsedPayload = JSON.parse(base64UrlToString(payload)) as {
    exp?: number
    scope?: string
  }

  if (parsedPayload.scope !== 'display-admin') {
    return false
  }

  return Boolean(parsedPayload.exp && parsedPayload.exp > Date.now() / 1000)
}

function normalizePage(page: number | undefined) {
  if (!Number.isInteger(page) || !page || page < 1) {
    throw new Error('currentPdfPage must be an integer greater than or equal to 1.')
  }

  return page
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  if (request.method !== 'POST') {
    return jsonResponse({ ok: false, message: 'Method not allowed.' }, 405)
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const adminPin = Deno.env.get('ADMIN_PIN')
  const tokenSecret = Deno.env.get('ADMIN_SESSION_SECRET') ?? adminPin

  if (!supabaseUrl || !serviceRoleKey || !tokenSecret) {
    return jsonResponse(
      { ok: false, message: 'Display state function is not configured.' },
      500,
    )
  }

  let body: UpdateDisplayStateRequest
  try {
    body = (await request.json()) as UpdateDisplayStateRequest
  } catch {
    return jsonResponse({ ok: false, message: 'Invalid JSON body.' }, 400)
  }

  if (!body.adminToken || !(await verifyAdminToken(body.adminToken, tokenSecret))) {
    return jsonResponse({ ok: false, message: 'Invalid Admin session.' }, 401)
  }

  if (!body.lectureSessionId) {
    return jsonResponse({ ok: false, message: 'lectureSessionId is required.' }, 400)
  }

  if (!body.action) {
    return jsonResponse({ ok: false, message: 'action is required.' }, 400)
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  })

  const { data: currentState, error: selectError } = await supabase
    .from('lecture_display_state')
    .select('lecture_session_id,current_pdf_page,display_mode,updated_at')
    .eq('lecture_session_id', body.lectureSessionId)
    .maybeSingle<DisplayStateRow>()

  if (selectError) {
    return jsonResponse({ ok: false, message: selectError.message }, 500)
  }

  const existingState = currentState ?? {
    current_pdf_page: 1,
    display_mode: 'normal' as DisplayMode,
    lecture_session_id: body.lectureSessionId,
    updated_at: new Date().toISOString(),
  }

  let nextPage = existingState.current_pdf_page
  let nextDisplayMode = existingState.display_mode

  try {
    if (body.action === 'next') {
      nextPage = existingState.current_pdf_page + 1
    }

    if (body.action === 'previous') {
      nextPage = Math.max(1, existingState.current_pdf_page - 1)
    }

    if (body.action === 'goToPage') {
      nextPage = normalizePage(body.currentPdfPage)
    }

    if (body.action === 'setDisplayMode') {
      if (!body.displayMode) {
        throw new Error('displayMode is required.')
      }
      nextDisplayMode = body.displayMode
    }
  } catch (error) {
    return jsonResponse(
      {
        ok: false,
        message: error instanceof Error ? error.message : 'Invalid request.',
      },
      400,
    )
  }

  const { data: updatedState, error: updateError } = await supabase
    .from('lecture_display_state')
    .upsert(
      {
        current_pdf_page: nextPage,
        display_mode: nextDisplayMode,
        lecture_session_id: body.lectureSessionId,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'lecture_session_id' },
    )
    .select('lecture_session_id,current_pdf_page,display_mode,updated_at')
    .single<DisplayStateRow>()

  if (updateError) {
    return jsonResponse({ ok: false, message: updateError.message }, 500)
  }

  return jsonResponse({ displayState: updatedState, ok: true })
})
