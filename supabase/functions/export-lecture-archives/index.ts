import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.110.0'
import {
  runArchiveExportBatch,
  type FinishArchiveExportInput,
} from '../_shared/archiveExport.ts'
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

function configuredSecret(name: string) {
  const value = Deno.env.get(name) ?? ''
  if (new TextEncoder().encode(value).byteLength < 32) {
    throw new Error(`${name} is not configured.`)
  }
  return value
}

async function parseBatchLimit(request: Request) {
  const text = await request.text()
  if (!text.trim()) return 5

  let body: unknown
  try {
    body = JSON.parse(text)
  } catch {
    throw new Error('invalid_request')
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new Error('invalid_request')
  }
  const limit = (body as Record<string, unknown>).limit ?? 5
  if (!Number.isInteger(limit) || Number(limit) < 1 || Number(limit) > 5) {
    throw new Error('invalid_request')
  }
  return Number(limit)
}

Deno.serve(async (request) => {
  if (request.method !== 'POST') {
    return jsonResponse({ message: 'Method not allowed.', ok: false }, 405)
  }
  if (Deno.env.get('PHASE6_6_ARCHIVE_EXPORT_ENABLED') !== 'true') {
    return jsonResponse(
      { message: 'Lecture archive export is disabled.', ok: false },
      503,
    )
  }

  let triggerSecret: string
  let ingestSecret: string
  try {
    triggerSecret = configuredSecret('ARCHIVE_EXPORT_TRIGGER_SECRET')
    ingestSecret = configuredSecret('ARCHIVE_INGEST_SECRET')
  } catch {
    return jsonResponse(
      { message: 'Lecture archive export is not configured.', ok: false },
      503,
    )
  }

  const suppliedSecret =
    request.headers.get('Authorization')?.replace(/^Bearer /, '') ?? ''
  if (!timingSafeEqual(triggerSecret, suppliedSecret)) {
    return jsonResponse({ message: 'Unauthorized.', ok: false }, 401)
  }

  let limit: number
  try {
    limit = await parseBatchLimit(request)
  } catch {
    return jsonResponse({ message: 'Invalid request.', ok: false }, 400)
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const workerIngestUrl = Deno.env.get('ARCHIVE_WORKER_INGEST_URL')
  if (!supabaseUrl || !serviceRoleKey || !workerIngestUrl) {
    return jsonResponse(
      { message: 'Lecture archive export is not configured.', ok: false },
      503,
    )
  }

  const client = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  })
  try {
    const result = await runArchiveExportBatch({
      claim: async (jobLimit) => {
        const { data, error } = await client.rpc(
          'claim_lecture_archive_exports',
          { job_limit: jobLimit },
        )
        if (error) throw new Error('archive_claim_failed')
        return (data ?? []) as unknown[]
      },
      finish: async (input: FinishArchiveExportInput) => {
        const { data, error } = await client.rpc(
          'finish_lecture_archive_export',
          {
            target_error: input.error,
            target_lecture_session_id: input.lectureSessionId,
            target_payload_sha256: input.payloadSha256,
            target_source_version: input.sourceVersion,
            target_succeeded: input.succeeded,
          },
        )
        if (error) throw new Error('archive_finalize_failed')
        return data === true
      },
      ingestSecret,
      limit,
      workerIngestUrl,
    })
    return jsonResponse({ ok: true, ...result })
  } catch {
    return jsonResponse(
      { message: 'Lecture archive export batch failed.', ok: false },
      500,
    )
  }
})
