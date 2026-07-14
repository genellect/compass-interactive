import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.110.0'
import { getAdminTokenSecret, verifyAdminToken } from '../_shared/adminToken.ts'
import { handleCors } from '../_shared/cors.ts'
import { getPdfAsset } from '../_shared/pdfAssets.ts'
import { jsonResponse } from '../_shared/responses.ts'

type DisplayMode = 'normal' | 'presentation' | 'slideOnly'

type UpdateDisplayStateRequest = {
  action?: 'next' | 'previous' | 'goToPage' | 'setDisplayMode' | 'setDocument'
  adminToken?: string
  currentPdfPage?: number
  displayMode?: DisplayMode
  lectureSessionId?: string
  pdfDocumentId?: string | null
}

type DisplayStateRow = {
  current_pdf_page: number
  display_mode: DisplayMode
  lecture_session_id: string
  pdf_document_id: string | null
  pdf_document_version: string | null
  pdf_manifest_version: number
  pdf_page_count: number | null
  pdf_visible: boolean
  updated_at: string
}

type RegisteredPdfRow = {
  document_id: string
  document_version: string
  manifest_version: number
  page_count: number
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
    .from('lecture_live_state')
    .select(
      'lecture_session_id,pdf_document_id,pdf_document_version,pdf_manifest_version,pdf_page_count,pdf_visible,current_pdf_page,display_mode,updated_at',
    )
    .eq('lecture_session_id', body.lectureSessionId)
    .maybeSingle<DisplayStateRow>()

  if (selectError) {
    return jsonResponse({ ok: false, message: selectError.message }, 500)
  }

  if (!currentState) {
    return jsonResponse(
      { ok: false, message: 'Lecture live state is unavailable.' },
      409,
    )
  }

  const existingState = currentState
  let nextDocumentId = existingState.pdf_document_id
  let nextDocumentVersion = existingState.pdf_document_version
  let nextManifestVersion = existingState.pdf_manifest_version
  let nextPageCount = existingState.pdf_page_count
  let nextVisible = existingState.pdf_visible
  let nextPage = existingState.current_pdf_page
  let nextDisplayMode = existingState.display_mode

  try {
    if (body.action === 'next') {
      const pageCount = nextPageCount ?? getPdfAsset(nextDocumentId)?.pageCount
      if (!pageCount || nextPage >= pageCount) {
        throw new Error('The PDF is already on its last page.')
      }
      nextPage += 1
    } else if (body.action === 'previous') {
      nextPage = Math.max(1, nextPage - 1)
    } else if (body.action === 'goToPage') {
      nextPage = normalizePage(body.currentPdfPage)
      const pageCount = nextPageCount ?? getPdfAsset(nextDocumentId)?.pageCount
      if (!pageCount || nextPage > pageCount) {
        throw new Error('currentPdfPage exceeds the PDF page count.')
      }
    } else if (body.action === 'setDisplayMode') {
      if (
        !body.displayMode ||
        !['normal', 'presentation', 'slideOnly'].includes(body.displayMode)
      ) {
        throw new Error('A valid displayMode is required.')
      }
      nextDisplayMode = body.displayMode
    } else if (body.action === 'setDocument') {
      const documentId = body.pdfDocumentId?.trim() || null
      let registered: RegisteredPdfRow | null = null
      if (documentId) {
        const { data, error } = await supabase
          .from('lecture_pdf_documents')
          .select('document_id,document_version,manifest_version,page_count')
          .eq('lecture_session_id', body.lectureSessionId)
          .eq('document_id', documentId)
          .eq('visible', true)
          .order('manifest_version', { ascending: false })
          .limit(1)
          .maybeSingle<RegisteredPdfRow>()
        if (error) throw error
        registered = data
      }
      const legacyAsset = getPdfAsset(documentId)
      if (documentId && !registered && !legacyAsset) {
        throw new Error('The selected PDF document is not registered.')
      }
      nextDocumentId = documentId
      nextDocumentVersion = registered?.document_version ?? null
      nextManifestVersion = registered?.manifest_version ?? 0
      nextPageCount = registered?.page_count ?? legacyAsset?.pageCount ?? null
      nextVisible = documentId !== null
      nextPage = 1
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

  const { error: updateError } = nextDocumentVersion
    ? await supabase.rpc('admin_update_pdf_display_v3', {
        target_current_pdf_page: nextPage,
        target_display_mode: nextDisplayMode,
        target_lecture_session_id: body.lectureSessionId,
        target_pdf_document_id: nextDocumentId,
        target_pdf_document_version: nextDocumentVersion,
        target_pdf_manifest_version: nextManifestVersion,
        target_pdf_page_count: nextPageCount,
        target_pdf_visible: nextVisible,
      })
    : await supabase.rpc('admin_update_pdf_display', {
        target_current_pdf_page: nextPage,
        target_display_mode: nextDisplayMode,
        target_lecture_session_id: body.lectureSessionId,
        target_pdf_document_id: nextDocumentId,
      })

  if (updateError) {
    return jsonResponse({ ok: false, message: updateError.message }, 500)
  }

  const { data: updatedState, error: readError } = await supabase
    .from('lecture_live_state')
    .select(
      'lecture_session_id,pdf_document_id,pdf_document_version,pdf_manifest_version,pdf_page_count,pdf_visible,current_pdf_page,display_mode,updated_at',
    )
    .eq('lecture_session_id', body.lectureSessionId)
    .single<DisplayStateRow>()
  if (readError)
    return jsonResponse({ message: readError.message, ok: false }, 500)
  return jsonResponse({ displayState: updatedState, ok: true })
})
