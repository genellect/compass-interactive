import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.110.0'
import { getAdminTokenSecret, verifyAdminToken } from '../_shared/adminToken.ts'
import { handleCors } from '../_shared/cors.ts'
import { createJsonResponse } from '../_shared/responses.ts'

type PdfDocument = {
  byte_size: number
  display_name: string
  document_id: string
  document_version: string
  download_enabled: boolean
  manifest_version: number
  page_count: number
  pdf_sha256: string
  published_at: string
  text_char_count: number
  text_sha256: string
  visible: boolean
}

type RequestBody = {
  action?: 'list' | 'register'
  adminToken?: string
  byteSize?: number
  displayName?: string
  documentId?: string
  documentVersion?: string
  downloadEnabled?: boolean
  lectureSessionId?: string
  manifestVersion?: number
  pageCount?: number
  pdfSha256?: string
  textCharCount?: number
  textSha256?: string
}

function mapDocument(document: PdfDocument) {
  return {
    byteSize: document.byte_size,
    displayName: document.display_name,
    documentId: document.document_id,
    documentVersion: document.document_version,
    downloadEnabled: document.download_enabled,
    manifestVersion: document.manifest_version,
    pageCount: document.page_count,
    pdfSha256: document.pdf_sha256,
    publishedAt: document.published_at,
    textCharCount: document.text_char_count,
    textSha256: document.text_sha256,
    visible: document.visible,
  }
}

Deno.serve(async (request) => {
  const jsonResponse = createJsonResponse(request)
  const corsResponse = handleCors(request)
  if (corsResponse) return corsResponse
  if (request.method !== 'POST') {
    return jsonResponse({ message: 'Method not allowed.', ok: false }, 405)
  }
  if (Number(request.headers.get('content-length') ?? 0) > 64 * 1024) {
    return jsonResponse(
      { message: 'Request body is too large.', ok: false },
      413,
    )
  }

  let body: RequestBody
  try {
    body = (await request.json()) as RequestBody
  } catch {
    return jsonResponse({ message: 'Invalid JSON body.', ok: false }, 400)
  }
  if (!body.action || !body.lectureSessionId || !body.adminToken) {
    return jsonResponse(
      {
        message: 'action, lectureSessionId and adminToken are required.',
        ok: false,
      },
      400,
    )
  }

  let adminSecret: string
  try {
    adminSecret = getAdminTokenSecret()
  } catch (error) {
    return jsonResponse(
      {
        message: error instanceof Error ? error.message : 'Admin auth failed.',
        ok: false,
      },
      500,
    )
  }
  if (!(await verifyAdminToken(body.adminToken, adminSecret))) {
    return jsonResponse({ message: 'Invalid Admin session.', ok: false }, 401)
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!supabaseUrl || !serviceRoleKey) {
    return jsonResponse(
      { message: 'PDF metadata is not configured.', ok: false },
      500,
    )
  }
  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  })

  if (body.action === 'register') {
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
      return jsonResponse(
        { message: 'PDF metadata is incomplete.', ok: false },
        400,
      )
    }
    const { error } = await supabase.rpc('admin_register_pdf_document', {
      target_byte_size: body.byteSize,
      target_display_name: body.displayName,
      target_document_id: body.documentId,
      target_document_version: body.documentVersion,
      target_download_enabled: body.downloadEnabled ?? true,
      target_lecture_session_id: body.lectureSessionId,
      target_manifest_version: body.manifestVersion,
      target_page_count: body.pageCount,
      target_pdf_sha256: body.pdfSha256,
      target_text_char_count: body.textCharCount,
      target_text_sha256: body.textSha256,
    })
    if (error) return jsonResponse({ message: error.message, ok: false }, 409)
  }

  const { data, error } = await supabase
    .from('lecture_pdf_documents')
    .select(
      'document_id,document_version,manifest_version,display_name,page_count,byte_size,text_char_count,pdf_sha256,text_sha256,download_enabled,visible,published_at',
    )
    .eq('lecture_session_id', body.lectureSessionId)
    .eq('visible', true)
    .order('published_at', { ascending: false })

  if (error) return jsonResponse({ message: error.message, ok: false }, 500)
  return jsonResponse({
    documents: (data as PdfDocument[]).map(mapDocument),
    ok: true,
  })
})
