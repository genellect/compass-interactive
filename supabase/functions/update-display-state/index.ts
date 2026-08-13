import { handleCors } from '../_shared/cors.ts'
import {
  verifyGoogleAdminOperationRequest,
} from '../_shared/googleAdminOperations.ts'
import { hasLegacyAdminFields } from '../_shared/googleOnlyAdmin.ts'
import { describeJsonBodyError, readJsonBody } from '../_shared/requestBody.ts'
import { createJsonResponse } from '../_shared/responses.ts'

type DisplayMode = 'normal' | 'presentation' | 'slideOnly'

type UpdateDisplayStateRequest = {
  action?: 'next' | 'previous' | 'goToPage' | 'setDisplayMode' | 'setDocument'
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

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

Deno.serve(async (request) => {
  const jsonResponse = createJsonResponse(request)
  const corsResponse = handleCors(request)
  if (corsResponse) return corsResponse
  if (request.method !== 'POST') {
    return jsonResponse({ ok: false, message: 'Method not allowed.' }, 405)
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
    hasLegacyAdminFields(body) ||
    !body.appSessionToken?.trim() ||
    !body.lectureSessionId ||
    !UUID_PATTERN.test(body.lectureSessionId) ||
    !body.requestId ||
    !UUID_PATTERN.test(body.requestId) ||
    !body.action ||
    !['next', 'previous', 'goToPage', 'setDisplayMode', 'setDocument'].includes(
      body.action,
    )
  ) {
    return jsonResponse(
      { ok: false, message: 'Google Admin credential and request are required.' },
      400,
    )
  }
  if (
    body.action === 'goToPage' &&
    (!Number.isSafeInteger(body.currentPdfPage) || (body.currentPdfPage ?? 0) < 1)
  ) {
    return jsonResponse(
      { ok: false, message: 'A valid currentPdfPage is required.' },
      400,
    )
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

  const { data, error } = await verification.serviceClient.rpc(
    'manage_google_admin_display_state_v1',
    {
      target_action: body.action,
      target_auth_user_id: verification.authUserId,
      target_current_pdf_page: body.currentPdfPage ?? null,
      target_display_mode: body.displayMode ?? null,
      target_google_issuer: verification.googleIssuer,
      target_lecture_session_id: body.lectureSessionId,
      target_pdf_document_id: body.pdfDocumentId ?? null,
      target_provider_subject_hmac: verification.googleSubjectHmac,
      target_request_id: body.requestId,
      target_subject_pepper_version: verification.subjectPepperVersion,
      target_supabase_auth_session_id: verification.supabaseAuthSessionId,
      target_token_hash: verification.appSessionTokenHash,
      target_transport_enabled: verification.transportEnabled,
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
})
