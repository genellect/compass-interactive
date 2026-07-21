import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.110.0'
import { timingSafeEqual } from '../_shared/adminToken.ts'
import { sha256Hex } from '../_shared/pdfPublicationToken.ts'
import { describeJsonBodyError, readJsonBody } from '../_shared/requestBody.ts'

type RequestBody = {
  action?: 'claimCleanup' | 'claimNonce' | 'completeCleanup' | 'recordUploaded'
  actualByteSize?: number
  actualPdfSha256?: string
  allowedOrigin?: string
  cleanupClaimId?: string
  documentId?: string
  errorCode?: string | null
  expectedByteSize?: number
  expectedPdfSha256?: string
  generation?: number
  lecturePublicId?: string
  limit?: number
  nonce?: string
  objectEtag?: string
  objectKey?: string
  pdfMagicVerified?: boolean
  publicationId?: string
  ticketJti?: string
  ticketAdminSessionId?: string
  succeeded?: boolean
  workerId?: string
  workerAttemptId?: string
}

function json(payload: unknown, status: number) {
  return new Response(`${JSON.stringify(payload)}\n`, {
    headers: {
      'Cache-Control': 'no-store',
      'Content-Type': 'application/json; charset=utf-8',
      'X-Content-Type-Options': 'nosniff',
    },
    status,
  })
}

function validUuid(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    )
  )
}

Deno.serve(async (request) => {
  if (request.method !== 'POST') {
    return json({ message: 'Method not allowed.', ok: false }, 405)
  }
  if (request.headers.has('Origin')) {
    return json(
      { message: 'Browser requests are not accepted.', ok: false },
      403,
    )
  }
  const configuredSecret = Deno.env.get('PDF_PUBLICATION_COORDINATOR_SECRET')
  const suppliedSecret =
    request.headers.get('X-Compass-Pdf-Publication-Secret') ?? ''
  if (
    !configuredSecret ||
    new TextEncoder().encode(configuredSecret).byteLength < 32 ||
    !timingSafeEqual(configuredSecret, suppliedSecret)
  ) {
    return json({ message: 'Unauthorized.', ok: false }, 401)
  }

  let body: RequestBody
  try {
    body = await readJsonBody<RequestBody>(request, 32 * 1024)
  } catch (error) {
    const detail = describeJsonBodyError(error)
    return json({ message: detail.message, ok: false }, detail.status)
  }
  if (!body.action) {
    return json({ message: 'Coordinator request is invalid.', ok: false }, 400)
  }
  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!supabaseUrl || !serviceRoleKey) {
    return json({ message: 'Coordinator is not configured.', ok: false }, 500)
  }
  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  })

  if (body.action === 'claimCleanup') {
    if (
      !Number.isSafeInteger(body.limit) ||
      Number(body.limit) < 1 ||
      Number(body.limit) > 100 ||
      typeof body.workerId !== 'string' ||
      !/^[a-z0-9][a-z0-9:_-]{0,79}$/.test(body.workerId)
    ) {
      return json({ message: 'Cleanup claim is invalid.', ok: false }, 400)
    }
    const { data, error } = await supabase.rpc(
      'claim_due_pdf_publication_cleanup_v1',
      {
        job_limit: body.limit,
        target_worker_id: body.workerId,
      },
    )
    if (error) {
      return json({ message: 'Cleanup claim failed.', ok: false }, 503)
    }
    return json({ data: data ?? [], ok: true, status: 'cleanup_claimed' }, 200)
  }

  if (body.action === 'completeCleanup') {
    if (
      !validUuid(body.publicationId) ||
      !validUuid(body.cleanupClaimId) ||
      typeof body.succeeded !== 'boolean' ||
      typeof body.workerId !== 'string' ||
      !/^[a-z0-9][a-z0-9:_-]{0,79}$/.test(body.workerId) ||
      (!body.succeeded &&
        (typeof body.errorCode !== 'string' ||
          !/^[a-z0-9_:-]{1,80}$/.test(body.errorCode)))
    ) {
      return json({ message: 'Cleanup completion is invalid.', ok: false }, 400)
    }
    const { data, error } = await supabase.rpc(
      'complete_pdf_publication_cleanup_v1',
      {
        target_cleanup_claim_id: body.cleanupClaimId,
        target_error_code: body.succeeded ? null : body.errorCode,
        target_publication_id: body.publicationId,
        target_succeeded: body.succeeded,
        target_worker_id: body.workerId,
      },
    )
    if (error) {
      return json({ message: 'Cleanup completion failed.', ok: false }, 409)
    }
    return json({ data, ok: true, status: 'cleanup_completed' }, 200)
  }

  if (Deno.env.get('PHASE726_BROWSER_PDF_PUBLICATION_ENABLED') !== 'true') {
    return json({ message: 'Not found.', ok: false }, 404)
  }
  if (!validUuid(body.publicationId) || !validUuid(body.workerAttemptId)) {
    return json({ message: 'Coordinator request is invalid.', ok: false }, 400)
  }

  if (body.action === 'claimNonce') {
    if (
      typeof body.nonce !== 'string' ||
      !/^[A-Za-z0-9_-]{32,128}$/.test(body.nonce) ||
      !validUuid(body.ticketJti) ||
      !validUuid(body.ticketAdminSessionId) ||
      !Number.isSafeInteger(body.generation) ||
      Number(body.generation) < 1 ||
      typeof body.lecturePublicId !== 'string' ||
      !/^lecture_[a-z0-9]{16,64}$/.test(body.lecturePublicId) ||
      typeof body.documentId !== 'string' ||
      !/^[a-z0-9][a-z0-9-]{0,63}$/.test(body.documentId) ||
      typeof body.expectedPdfSha256 !== 'string' ||
      !/^[0-9a-f]{64}$/.test(body.expectedPdfSha256) ||
      !Number.isSafeInteger(body.expectedByteSize) ||
      Number(body.expectedByteSize) < 1 ||
      Number(body.expectedByteSize) > 15 * 1024 * 1024 ||
      typeof body.allowedOrigin !== 'string'
    ) {
      return json({ message: 'Nonce claim is invalid.', ok: false }, 400)
    }
    const { data, error } = await supabase.rpc(
      'worker_claim_pdf_publication_nonce_v1',
      {
        target_allowed_origin: body.allowedOrigin,
        target_document_id: body.documentId,
        target_expected_byte_size: body.expectedByteSize,
        target_expected_pdf_sha256: body.expectedPdfSha256,
        target_ticket_generation: body.generation,
        target_lecture_public_id: body.lecturePublicId,
        target_nonce_hash: await sha256Hex(body.nonce),
        target_publication_id: body.publicationId,
        target_ticket_jti_hash: await sha256Hex(body.ticketJti),
        target_ticket_admin_session_id: body.ticketAdminSessionId,
        target_worker_attempt_id: body.workerAttemptId,
      },
    )
    if (error) {
      return json({ message: 'Nonce claim was rejected.', ok: false }, 409)
    }
    return json({ data, ok: true, status: 'claimed' }, 200)
  }

  if (body.action !== 'recordUploaded') {
    return json({ message: 'Coordinator action is invalid.', ok: false }, 400)
  }

  if (
    !Number.isSafeInteger(body.actualByteSize) ||
    Number(body.actualByteSize) < 1 ||
    Number(body.actualByteSize) > 15 * 1024 * 1024 ||
    typeof body.actualPdfSha256 !== 'string' ||
    !/^[0-9a-f]{64}$/.test(body.actualPdfSha256) ||
    body.pdfMagicVerified !== true ||
    typeof body.objectEtag !== 'string' ||
    body.objectEtag.length < 1 ||
    body.objectEtag.length > 256 ||
    typeof body.objectKey !== 'string' ||
    !body.objectKey.startsWith('pdf/')
  ) {
    return json({ message: 'Upload receipt is invalid.', ok: false }, 400)
  }
  const { data, error } = await supabase.rpc(
    'worker_record_pdf_publication_uploaded_v1',
    {
      target_actual_byte_size: body.actualByteSize,
      target_actual_pdf_sha256: body.actualPdfSha256,
      target_object_etag: body.objectEtag,
      target_object_key: body.objectKey,
      target_pdf_magic_verified: body.pdfMagicVerified,
      target_publication_id: body.publicationId,
      target_r2_object_version: body.objectEtag,
      target_worker_attempt_id: body.workerAttemptId,
    },
  )
  if (error) {
    return json({ message: 'Upload receipt was rejected.', ok: false }, 409)
  }
  return json({ data, ok: true, status: 'uploaded' }, 200)
})
