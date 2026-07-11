import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.110.0'
import { getAdminTokenSecret, verifyAdminToken } from '../_shared/adminToken.ts'
import { handleCors } from '../_shared/cors.ts'
import { jsonResponse } from '../_shared/responses.ts'

type DisplayMode = 'normal' | 'presentation' | 'slideOnly'

type UpdateDisplayStateRequest = {
  action?: 'next' | 'previous' | 'goToPage' | 'setDisplayMode'
  adminToken?: string
  currentPdfPage?: number
  displayMode?: DisplayMode
  lectureSessionId?: string
}

type DisplayStateRow = {
  current_pdf_page: number
  display_mode: DisplayMode
  lecture_session_id: string
  updated_at: string
}

function normalizePage(page: number | undefined) {
  if (!Number.isInteger(page) || !page || page < 1) {
    throw new Error(
      'currentPdfPage must be an integer greater than or equal to 1.',
    )
  }

  return page
}

Deno.serve(async (request) => {
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

  if (
    !body.adminToken ||
    !(await verifyAdminToken(body.adminToken, tokenSecret))
  ) {
    return jsonResponse({ ok: false, message: 'Invalid Admin session.' }, 401)
  }

  if (!body.lectureSessionId || !body.action) {
    return jsonResponse(
      { ok: false, message: 'lectureSessionId and action are required.' },
      400,
    )
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  })
  const { data: lecture, error: lectureError } = await supabase
    .from('lecture_sessions')
    .select('status')
    .eq('id', body.lectureSessionId)
    .maybeSingle<{ status: 'draft' | 'open' | 'closed' }>()

  if (lectureError) {
    return jsonResponse({ ok: false, message: lectureError.message }, 500)
  }

  if (!lecture || lecture.status === 'closed') {
    return jsonResponse(
      { ok: false, message: 'Display updates are unavailable.' },
      409,
    )
  }

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
      nextPage += 1
    } else if (body.action === 'previous') {
      nextPage = Math.max(1, nextPage - 1)
    } else if (body.action === 'goToPage') {
      nextPage = normalizePage(body.currentPdfPage)
    } else if (body.action === 'setDisplayMode') {
      if (
        !body.displayMode ||
        !['normal', 'presentation', 'slideOnly'].includes(body.displayMode)
      ) {
        throw new Error('A valid displayMode is required.')
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
