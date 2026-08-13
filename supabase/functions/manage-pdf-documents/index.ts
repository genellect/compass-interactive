import { handleCors } from '../_shared/cors.ts'
import { verifyGoogleAdminOperationRequest } from '../_shared/googleAdminOperations.ts'
import { hasLegacyAdminFields } from '../_shared/googleOnlyAdmin.ts'
import { describeJsonBodyError, readJsonBody } from '../_shared/requestBody.ts'
import { createJsonResponse } from '../_shared/responses.ts'

type RequestBody = {
  action?: 'list' | 'register'
  appSessionToken?: string
  byteSize?: number
  displayName?: string
  documentId?: string
  documentVersion?: string
  downloadEnabled?: boolean
  expectedAccessVersion?: number
  lectureSessionId?: string
  manifestEtag?: string
  manifestVersion?: number
  pageCount?: number
  pdfSha256?: string
  requestId?: string
  textCharCount?: number
  textSha256?: string
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function containsControlCharacters(value: string) {
  return Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0) ?? 0
    return codePoint <= 31 || codePoint === 127
  })
}

Deno.serve(async (request) => {
  const jsonResponse = createJsonResponse(request)
  const corsResponse = handleCors(request)
  if (corsResponse) return corsResponse
  if (request.method !== 'POST') {
    return jsonResponse({ message: 'Method not allowed.', ok: false }, 405)
  }

  let body: RequestBody
  try {
    body = await readJsonBody<RequestBody>(request, 64 * 1024)
  } catch (error) {
    const bodyError = describeJsonBodyError(error)
    return jsonResponse(
      { message: bodyError.message, ok: false },
      bodyError.status,
    )
  }
  if (
    hasLegacyAdminFields(body) ||
    !body.appSessionToken?.trim() ||
    !['list', 'register'].includes(body.action ?? '') ||
    !body.lectureSessionId
  ) {
    return jsonResponse(
      { message: 'Google Admin credential, action, and lecture are required.', ok: false },
      400,
    )
  }
  if (
    body.action === 'register' &&
    !UUID_PATTERN.test(body.requestId ?? '')
  ) {
    return jsonResponse({ message: 'requestId is required.', ok: false }, 400)
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
  const serviceClient = verification.serviceClient
  const identity = {
    target_auth_user_id: verification.authUserId,
    target_google_issuer: verification.googleIssuer,
    target_provider_subject_hmac: verification.googleSubjectHmac,
    target_subject_pepper_version: verification.subjectPepperVersion,
    target_supabase_auth_session_id: verification.supabaseAuthSessionId,
    target_token_hash: verification.appSessionTokenHash,
    target_transport_enabled: verification.transportEnabled,
  }

  async function listDocuments() {
    const { data, error } = await serviceClient.rpc(
      'manage_google_admin_pdf_documents_v1',
      {
        ...identity,
        target_action: 'list',
        target_byte_size: null,
        target_display_name: null,
        target_document_id: null,
        target_document_version: null,
        target_download_enabled: null,
        target_expected_access_version: null,
        target_lecture_session_id: body.lectureSessionId,
        target_manifest_etag: null,
        target_manifest_version: null,
        target_page_count: null,
        target_pdf_sha256: null,
        target_request_id: null,
        target_text_char_count: null,
        target_text_sha256: null,
      },
    )
    if (error) throw new Error(error.message)
    const result = data as { documents?: unknown; ok?: boolean } | null
    if (result?.ok !== true || !Array.isArray(result.documents)) {
      throw new Error('Google Admin PDF list is unavailable.')
    }
    return result
  }

  if (body.action === 'list') {
    try {
      return jsonResponse(await listDocuments())
    } catch (error) {
      return jsonResponse(
        {
          message: error instanceof Error ? error.message : 'PDF list failed.',
          ok: false,
        },
        500,
      )
    }
  }

  if (Deno.env.get('PHASE726_BROWSER_PDF_PUBLICATION_ENABLED') === 'true') {
    return jsonResponse(
      {
        message:
          'Local Publisher registration is unavailable while browser PDF publication is enabled.',
        ok: false,
      },
      409,
    )
  }
  const required = [
    body.byteSize,
    body.displayName,
    body.documentId,
    body.documentVersion,
    body.manifestVersion,
    body.pageCount,
    body.pdfSha256,
    body.textCharCount,
    body.textSha256,
  ]
  if (required.some((value) => value === undefined || value === null)) {
    return jsonResponse({ message: 'PDF metadata is incomplete.', ok: false }, 400)
  }
  const hasPublicationReceipt =
    body.expectedAccessVersion !== undefined || body.manifestEtag !== undefined
  if (
    hasPublicationReceipt &&
    (!Number.isSafeInteger(body.expectedAccessVersion) ||
      Number(body.expectedAccessVersion) < 1 ||
      typeof body.manifestEtag !== 'string' ||
      body.manifestEtag.length < 1 ||
      body.manifestEtag.length > 512 ||
      containsControlCharacters(body.manifestEtag))
  ) {
    return jsonResponse(
      { message: 'PDF publication receipt is invalid.', ok: false },
      400,
    )
  }

  const { data, error } = await verification.serviceClient.rpc(
    'manage_google_admin_pdf_documents_v1',
    {
      ...identity,
      target_action: 'register',
      target_byte_size: body.byteSize,
      target_display_name: body.displayName,
      target_document_id: body.documentId,
      target_document_version: body.documentVersion,
      target_download_enabled: body.downloadEnabled ?? true,
      target_expected_access_version: body.expectedAccessVersion ?? null,
      target_lecture_session_id: body.lectureSessionId,
      target_manifest_etag: body.manifestEtag ?? null,
      target_manifest_version: body.manifestVersion,
      target_page_count: body.pageCount,
      target_pdf_sha256: body.pdfSha256,
      target_request_id: body.requestId,
      target_text_char_count: body.textCharCount,
      target_text_sha256: body.textSha256,
    },
  )
  if (error) {
    return jsonResponse({ message: error.message, ok: false }, 409)
  }
  const result = data as {
    documents?: unknown
    ok?: boolean
    refreshRequired?: boolean
  } | null
  if (
    result?.ok !== true ||
    !Array.isArray(result.documents) ||
    typeof result.refreshRequired !== 'boolean'
  ) {
    return jsonResponse(
      { message: 'PDF registration could not be confirmed.', ok: false },
      409,
    )
  }
  if (result.refreshRequired) {
    try {
      return jsonResponse({
        ...result,
        ...(await listDocuments()),
        refreshRequired: false,
      })
    } catch {
      return jsonResponse(result)
    }
  }
  return jsonResponse(result)
})
