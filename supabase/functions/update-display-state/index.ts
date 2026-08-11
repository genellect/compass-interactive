import { createClient } from 'npm:@supabase/supabase-js@2'
import { getAdminTokenSecret, verifyAdminToken } from '../_shared/adminToken.ts'
import { handleCors } from '../_shared/cors.ts'
import { describeJsonBodyError, readJsonBody } from '../_shared/requestBody.ts'
import { getPdfAsset } from '../_shared/pdfAssets.ts'
import { createJsonResponse } from '../_shared/responses.ts'
import {
  type GoogleAdminOperationContext,
  verifyGoogleAdminOperationRequest,
} from '../_shared/googleAdminOperations.ts'

type DisplayMode = 'normal' | 'presentation' | 'slideOnly'

type UpdateDisplayStateRequest = {
  action?: 'next' | 'previous' | 'goToPage' | 'setDisplayMode' | 'setDocument'
  adminToken?: string
  appSessionToken?: string
  currentPdfPage?: number
  displayMode?: DisplayMode
  lectureSessionId?: string
  pdfDocumentId?: string | null
  requestId?: string
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

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function normalizePage(page: number | undefined) {
  if (!Number.isInteger(page) || !page || page < 1) {
    throw new Error(
      'currentPdfPage must be an integer greater than or equal to 1.',
    )
  }

  return page
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
      { ok: false, message: 'Display state function is not configured.' },
      500,
    )
  }

  let body: UpdateDisplayStateRequest
  try {
    body = await readJsonBody<UpdateDisplayStateRequest>(request, 16 * 1024)
  } catch (error) {
    const bodyError = describeJsonBodyError(error)
    return jsonResponse(
      { ok: false, message: bodyError.message },
      bodyError.status,
    )
  }

  if (
    !body.lectureSessionId ||
    !UUID_PATTERN.test(body.lectureSessionId) ||
    !body.action ||
    !['next', 'previous', 'goToPage', 'setDisplayMode', 'setDocument'].includes(
      body.action,
    )
  ) {
    return jsonResponse(
      { ok: false, message: 'lectureSessionId and action are required.' },
      400,
    )
  }

  const hasGoogleCredential = Boolean(body.appSessionToken)
  const hasLegacyCredential = Boolean(body.adminToken)
  if (hasGoogleCredential === hasLegacyCredential) {
    return jsonResponse(
      { ok: false, message: 'Exactly one Admin credential is required.' },
      400,
    )
  }

  let googleContext: GoogleAdminOperationContext | null = null
  if (body.appSessionToken) {
    const verification = await verifyGoogleAdminOperationRequest(
      request,
      body.appSessionToken,
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
    if (
      !body.adminToken ||
      !(await verifyAdminToken(body.adminToken, tokenSecret, request))
    ) {
      return jsonResponse({ ok: false, message: 'Invalid Admin session.' }, 401)
    }
  }

  const supabase =
    googleContext?.serviceClient ??
    createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false },
    })

  if (googleContext) {
    if (!body.requestId || !UUID_PATTERN.test(body.requestId)) {
      return jsonResponse({ ok: false, message: 'requestId is required.' }, 400)
    }
    if (body.action === 'goToPage') {
      try {
        normalizePage(body.currentPdfPage)
      } catch (error) {
        return jsonResponse(
          {
            ok: false,
            message:
              error instanceof Error ? error.message : 'Invalid request.',
          },
          400,
        )
      }
    }
    if (
      body.action === 'setDisplayMode' &&
      (!body.displayMode ||
        !['normal', 'presentation', 'slideOnly'].includes(body.displayMode))
    ) {
      return jsonResponse(
        { ok: false, message: 'A valid displayMode is required.' },
        400,
      )
    }

    const { data, error } = await supabase.rpc(
      'manage_google_admin_display_state_v1',
      {
        target_action: body.action,
        target_auth_user_id: googleContext.authUserId,
        target_current_pdf_page: body.currentPdfPage ?? null,
        target_display_mode: body.displayMode ?? null,
        target_google_issuer: googleContext.googleIssuer,
        target_lecture_session_id: body.lectureSessionId,
        target_pdf_document_id: body.pdfDocumentId ?? null,
        target_provider_subject_hmac: googleContext.googleSubjectHmac,
        target_request_id: body.requestId,
        target_subject_pepper_version: googleContext.subjectPepperVersion,
        target_supabase_auth_session_id: googleContext.supabaseAuthSessionId,
        target_token_hash: googleContext.appSessionTokenHash,
        target_transport_enabled: googleContext.transportEnabled,
      },
    )
    const result = data as {
      displayState?: DisplayStateRow
      ok?: boolean
    } | null
    if (error) {
      if (error.code === 'P7291') {
        return jsonResponse(
          {
            code: 'PRESENTER_SYNC_ACTIVE',
            message:
              'PowerPoint synchronization is active. Switch to manual control first.',
            ok: false,
          },
          409,
        )
      }
      return jsonResponse(
        { ok: false, message: 'Display state could not be updated.' },
        error.code === '22023' || error.code === 'P7335' ? 400 : 503,
      )
    }
    if (result?.ok !== true || !result.displayState) {
      return jsonResponse(
        { ok: false, message: 'Display state could not be confirmed.' },
        409,
      )
    }
    return jsonResponse({ displayState: result.displayState, ok: true })
  }
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

  const presenterFenceEnabled =
    Deno.env.get('PHASE729_POWERPOINT_SYNC_ENABLED') === 'true'
  const { error: updateError } = nextDocumentVersion
    ? await supabase.rpc(
        presenterFenceEnabled
          ? 'admin_update_pdf_display_with_presenter_fence_v1'
          : 'admin_update_pdf_display_v3',
        {
          target_current_pdf_page: nextPage,
          target_display_mode: nextDisplayMode,
          target_lecture_session_id: body.lectureSessionId,
          target_pdf_document_id: nextDocumentId,
          target_pdf_document_version: nextDocumentVersion,
          target_pdf_manifest_version: nextManifestVersion,
          target_pdf_page_count: nextPageCount,
          target_pdf_visible: nextVisible,
        },
      )
    : await supabase.rpc('admin_update_pdf_display', {
        target_current_pdf_page: nextPage,
        target_display_mode: nextDisplayMode,
        target_lecture_session_id: body.lectureSessionId,
        target_pdf_document_id: nextDocumentId,
      })

  if (updateError) {
    if (updateError.code === 'P7291') {
      return jsonResponse(
        {
          code: 'PRESENTER_SYNC_ACTIVE',
          message:
            'PowerPoint synchronization is active. Switch to manual control first.',
          ok: false,
        },
        409,
      )
    }
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
