import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.110.0'
import { timingSafeEqual } from '../_shared/adminToken.ts'

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

type PdfRetentionRow = {
  archive_expires_at: string
  delete_after: string
  document_id: string
  document_version: string
  lecture_sessions:
    | { pdf_public_id: string; status: string }
    | Array<{ pdf_public_id: string; status: string }>
}

const PAGE_SIZE = 500

Deno.serve(async (request) => {
  if (request.method !== 'GET') {
    return jsonResponse({ message: 'Method not allowed.', ok: false }, 405)
  }
  const configuredSecret = Deno.env.get('PDF_RETENTION_SYNC_SECRET') ?? ''
  const suppliedSecret =
    request.headers.get('Authorization')?.replace(/^Bearer /, '') ?? ''
  if (
    configuredSecret.length < 32 ||
    !timingSafeEqual(configuredSecret, suppliedSecret)
  ) {
    return jsonResponse({ message: 'Unauthorized.', ok: false }, 401)
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!supabaseUrl || !serviceRoleKey) {
    return jsonResponse(
      { message: 'Retention feed is not configured.', ok: false },
      500,
    )
  }
  const url = new URL(request.url)
  const offset = Number(url.searchParams.get('offset') ?? 0)
  if (!Number.isInteger(offset) || offset < 0 || offset > 100_000) {
    return jsonResponse({ message: 'Invalid offset.', ok: false }, 400)
  }

  const client = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  })
  const { data, error } = await client
    .from('lecture_pdf_documents')
    .select(
      'document_id,document_version,archive_expires_at,delete_after,lecture_sessions!inner(pdf_public_id,status)',
    )
    .not('archive_expires_at', 'is', null)
    .not('delete_after', 'is', null)
    .eq('lecture_sessions.status', 'closed')
    .order('lecture_session_id', { ascending: true })
    .order('document_id', { ascending: true })
    .order('document_version', { ascending: true })
    .range(offset, offset + PAGE_SIZE - 1)

  if (error) return jsonResponse({ message: error.message, ok: false }, 500)
  const rows = (data ?? []) as unknown as PdfRetentionRow[]
  const items = rows.map((row) => {
    const lecture = Array.isArray(row.lecture_sessions)
      ? row.lecture_sessions[0]
      : row.lecture_sessions
    if (!lecture?.pdf_public_id || lecture.status !== 'closed') {
      throw new Error('Retention feed relation is invalid.')
    }
    return {
      archiveExpiresAt: row.archive_expires_at,
      deleteAfter: row.delete_after,
      documentId: row.document_id,
      documentVersion: row.document_version,
      lecturePublicId: `lecture_${lecture.pdf_public_id.replaceAll('-', '')}`,
    }
  })

  return jsonResponse({
    contractVersion: 1,
    generatedAt: new Date().toISOString(),
    hasMore: rows.length === PAGE_SIZE,
    items,
    nextOffset: offset + rows.length,
    ok: true,
  })
})
