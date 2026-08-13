import { getAllowedCorsOrigin, handleCors } from '../_shared/cors.ts'
import { verifyGoogleAdminOperationRequest } from '../_shared/googleAdminOperations.ts'
import { hasLegacyAdminFields } from '../_shared/googleOnlyAdmin.ts'
import {
  derivePdfPublicationNonce,
  derivePdfPublicationUuid,
  sha256Hex,
  signPdfPublicationTicket,
} from '../_shared/pdfPublicationToken.ts'
import { describeJsonBodyError, readJsonBody } from '../_shared/requestBody.ts'
import { createJsonResponse } from '../_shared/responses.ts'

type PublicationState =
  | 'aborted'
  | 'active'
  | 'committed'
  | 'expired'
  | 'pending'
  | 'retired'
  | 'uploaded'

type PublicationRow = {
  activation_operation_id?: string | null
  activation_target_access_version: number | null
  activated_manifest_etag: string | null
  activated_manifest_version: number | null
  actual_byte_size: number | null
  actual_pdf_sha256: string | null
  allowed_origin: string
  commit_operation_id?: string | null
  committed_manifest_access_version: number | null
  committed_manifest_etag: string | null
  committed_manifest_version: number | null
  client_request_id: string
  declared_page_count: number
  declared_text_char_count: number
  declared_text_sha256: string
  display_name: string
  document_id: string
  document_version: string
  download_enabled: boolean
  expected_byte_size: number
  expected_pdf_sha256: string
  lecture_public_id: string
  lecture_session_id: string
  object_key: string
  operation_expires_at: string
  pdf_access_version: number
  pdf_magic_verified: boolean | null
  publication_id: string
  nonce_used_at: string | null
  r2_etag: string | null
  r2_object_version: string | null
  server_time: string
  state: PublicationState
  ticket_expires_at: string
  ticket_generation: number
  ticket_admin_session_id: string
  upload_lease_expires_at: string | null
  worker_attempt_id: string | null
}

type RequestBody = {
  action?: 'abort' | 'discover' | 'finalize' | 'initiate' | 'status'
  appSessionToken?: string
  abortRequestId?: string
  byteSize?: number
  displayName?: string
  documentId?: string
  downloadEnabled?: boolean
  fileName?: string
  idempotencyKey?: string
  lectureSessionId?: string
  pageCount?: number
  pdfSha256?: string
  publicationId?: string
  reason?: string
  requestId?: string
  ticketRequestId?: string
  textCharCount?: number
  textSha256?: string
}

type WorkerResponse = {
  accessVersion?: number
  actualByteSize?: number | null
  actualPdfSha256?: string | null
  manifestEtag?: string | null
  manifestVersion?: number | null
  message?: string
  objectEtag?: string | null
  objectKey?: string | null
  ok?: boolean
  pdfMagicVerified?: boolean
  publicationId?: string
  status?: string
  workerAttemptId?: string | null
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const SHA_PATTERN = /^[0-9a-f]{64}$/
const DOCUMENT_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/
const WORKER_TIMEOUT_MS = 15_000
const MAX_WORKER_RESPONSE_BYTES = 64 * 1024
const RPC_TIMEOUT_MS = 5_000
const MIN_CONTINUATION_TICKET_SECONDS = 10
const TRANSIENT_DATABASE_CODES = new Set(['55P03', '57014', 'PGRST003'])

function coordinatorKeyVersion() {
  const raw =
    Deno.env.get('PDF_PUBLICATION_COORDINATOR_KEY_VERSION')?.trim() ?? '1'
  const value = Number(raw)
  if (!Number.isSafeInteger(value) || value < 1 || value > 2_147_483_647) {
    throw new Error('PDF publication key version is invalid.')
  }
  return value
}

function googlePdfErrorStatus(code?: string) {
  if (code === '42501') return 401
  if (code === '22023') return 400
  if (code === 'P7335' || code === '55000' || code?.startsWith('P72')) {
    return 409
  }
  return 503
}

function seconds(value: string) {
  const parsed = Date.parse(value)
  if (!Number.isFinite(parsed)) throw new Error('Publication time is invalid.')
  return Math.floor(parsed / 1000)
}

function continuationTicketTimes(value: unknown) {
  if (typeof value !== 'string') {
    throw Object.assign(new Error('PDF finalization window is invalid.'), {
      status: 409,
    })
  }
  const now = Math.floor(Date.now() / 1000)
  const continuationExpiresAt = seconds(value)
  const expiresAt = Math.min(now + 60, continuationExpiresAt)
  if (expiresAt <= now + MIN_CONTINUATION_TICKET_SECONDS) {
    throw Object.assign(new Error('PDF finalization window expired.'), {
      status: 409,
    })
  }
  return { expiresAt, issuedAt: now }
}

function safeWorkerBaseUrl() {
  const value =
    Deno.env.get('PDF_PUBLICATION_WORKER_BASE_URL') ??
    Deno.env.get('PDF_WORKER_BASE_URL')
  if (!value) throw new Error('PDF publication Worker is not configured.')
  const url = new URL(value)
  const loopback = ['127.0.0.1', 'localhost'].includes(url.hostname)
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== '/' ||
    (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback))
  ) {
    throw new Error('PDF publication Worker URL is invalid.')
  }
  return url.origin
}

function mapPublication(row: PublicationRow) {
  return {
    documentId: row.document_id,
    expiresAt: row.operation_expires_at,
    idempotencyKey: row.client_request_id,
    lectureSessionId: row.lecture_session_id,
    publicationId: row.publication_id,
    status: row.state,
  }
}

async function readWorkerResponse(response: Response) {
  const contentLength = response.headers.get('Content-Length')
  if (
    contentLength &&
    (!/^\d+$/.test(contentLength) ||
      Number(contentLength) > MAX_WORKER_RESPONSE_BYTES)
  ) {
    throw new Error('PDF publication Worker response is too large.')
  }
  const chunks: Uint8Array[] = []
  let byteLength = 0
  const reader = response.body?.getReader()
  if (reader) {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      byteLength += value.byteLength
      if (byteLength > MAX_WORKER_RESPONSE_BYTES) {
        await reader.cancel()
        throw new Error('PDF publication Worker response is too large.')
      }
      chunks.push(value)
    }
  }
  const bytes = new Uint8Array(byteLength)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  let payload: WorkerResponse = {}
  try {
    payload = JSON.parse(new TextDecoder().decode(bytes)) as WorkerResponse
  } catch {
    throw new Error('PDF publication Worker response is invalid.')
  }
  if (!response.ok || payload.ok !== true) {
    throw Object.assign(
      new Error(payload.message ?? 'PDF publication Worker rejected request.'),
      { status: response.status },
    )
  }
  return payload
}

async function callWorker(path: string, token: string, method: 'GET' | 'POST') {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), WORKER_TIMEOUT_MS)
  try {
    const response = await fetch(`${safeWorkerBaseUrl()}${path}`, {
      headers: { Authorization: `Bearer ${token}` },
      method,
      redirect: 'manual',
      signal: controller.signal,
    })
    if (response.status >= 300 && response.status < 400) {
      throw Object.assign(
        new Error('PDF publication Worker redirect was rejected.'),
        { status: 502 },
      )
    }
    return await readWorkerResponse(response)
  } finally {
    clearTimeout(timeout)
  }
}

function ticketBase(row: PublicationRow, adminSessionId: string) {
  return {
    adminSessionId,
    bytes: row.expected_byte_size,
    doc: row.document_id,
    generation: row.ticket_generation,
    lecturePublicId: row.lecture_public_id,
    origin: row.allowed_origin,
    publicationId: row.publication_id,
    sha256: row.expected_pdf_sha256,
  }
}

async function handleGooglePdfPublication(input: {
  body: RequestBody
  jsonResponse: ReturnType<typeof createJsonResponse>
  origin: string
  request: Request
}) {
  const { body, jsonResponse, origin, request } = input
  const googleContext = await verifyGoogleAdminOperationRequest(
    request,
    body.appSessionToken!,
  )
  if (!googleContext.ok) {
    return jsonResponse(
      {
        code: googleContext.code,
        message: googleContext.message,
        ok: false,
      },
      googleContext.status,
    )
  }

  const pdfTransportEnabled =
    Deno.env.get('PHASE726_BROWSER_PDF_PUBLICATION_ENABLED') === 'true'
  const targetTransportEnabled =
    googleContext.transportEnabled && pdfTransportEnabled
  const rpc = async (name: string, parameters: Record<string, unknown>) => {
    try {
      const result = await googleContext.serviceClient
        .rpc(name, parameters)
        .abortSignal(AbortSignal.timeout(RPC_TIMEOUT_MS))
      return {
        ...result,
        unavailable: TRANSIENT_DATABASE_CODES.has(result.error?.code ?? ''),
      }
    } catch {
      return { data: null, error: null, unavailable: true }
    }
  }
  const commonParameters = {
    target_auth_user_id: googleContext.authUserId,
    target_google_issuer: googleContext.googleIssuer,
    target_provider_subject_hmac: googleContext.googleSubjectHmac,
    target_subject_pepper_version: googleContext.subjectPepperVersion,
    target_supabase_auth_session_id: googleContext.supabaseAuthSessionId,
    target_token_hash: googleContext.appSessionTokenHash,
    target_transport_enabled: targetTransportEnabled,
  }
  const readPublication = async (
    action: 'discover' | 'status',
    publicationId: string | null,
  ) => {
    const result = await rpc('get_google_admin_pdf_publication_v1', {
      ...commonParameters,
      target_action: action,
      target_lecture_session_id: body.lectureSessionId,
      target_publication_id: publicationId,
    })
    if (result.unavailable) {
      throw Object.assign(new Error('PDF status loading timed out.'), {
        status: 504,
      })
    }
    if (result.error) {
      throw Object.assign(new Error(result.error.message), {
        status: googlePdfErrorStatus(result.error.code),
      })
    }
    return result.data as (PublicationRow & Record<string, unknown>) | null
  }
  const requirePublication = (
    value: (PublicationRow & Record<string, unknown>) | null,
  ) => {
    if (
      !value ||
      value.ok !== true ||
      !UUID_PATTERN.test(value.publication_id ?? '') ||
      value.lecture_session_id !== body.lectureSessionId
    ) {
      throw Object.assign(new Error('PDF publication was not found.'), {
        status: 404,
      })
    }
    return value
  }
  const advance = async (
    finalizeRequestId: string,
    stage:
      | 'completeActivation'
      | 'completeCommit'
      | 'prepareActivation'
      | 'prepareCommit'
      | 'recordUploaded',
    values: {
      actualByteSize?: number
      actualPdfSha256?: string
      manifestAccessVersion?: number
      manifestEtag?: string
      manifestVersion?: number
      objectEtag?: string
      objectKey?: string
      pdfMagicVerified?: boolean
      r2ObjectVersion?: string
      workerAttemptId?: string
    } = {},
  ) => {
    const stageRequestId = await derivePdfPublicationUuid(
      finalizeRequestId,
      `finalize-${stage.toLowerCase()}-request`,
    )
    const result = await rpc('advance_google_admin_pdf_publication_v1', {
      ...commonParameters,
      target_actual_byte_size: values.actualByteSize ?? null,
      target_actual_pdf_sha256: values.actualPdfSha256 ?? null,
      target_finalize_request_id: finalizeRequestId,
      target_lecture_session_id: body.lectureSessionId,
      target_manifest_access_version: values.manifestAccessVersion ?? null,
      target_manifest_etag: values.manifestEtag ?? null,
      target_manifest_version: values.manifestVersion ?? null,
      target_object_etag: values.objectEtag ?? null,
      target_object_key: values.objectKey ?? null,
      target_pdf_magic_verified: values.pdfMagicVerified ?? null,
      target_publication_id: body.publicationId,
      target_r2_object_version: values.r2ObjectVersion ?? null,
      target_stage: stage,
      target_stage_request_id: stageRequestId,
      target_worker_attempt_id: values.workerAttemptId ?? null,
    })
    if (result.unavailable) {
      throw Object.assign(new Error('PDF publication update timed out.'), {
        status: 504,
      })
    }
    if (result.error || !(result.data as { ok?: boolean } | null)?.ok) {
      throw Object.assign(
        new Error(result.error?.message ?? 'PDF publication update failed.'),
        { status: googlePdfErrorStatus(result.error?.code) },
      )
    }
    return result.data as Record<string, unknown>
  }

  try {
    if (body.action === 'discover') {
      if (!UUID_PATTERN.test(body.lectureSessionId ?? '')) {
        return jsonResponse(
          { message: 'Lecture ID is invalid.', ok: false },
          400,
        )
      }
      const row = await readPublication('discover', null)
      if (!row?.found) return jsonResponse({ found: false, ok: true }, 200)
      return jsonResponse(
        { found: true, ok: true, ...mapPublication(row) },
        200,
      )
    }

    if (body.action === 'initiate') {
      const ticketRequestId = body.ticketRequestId ?? body.requestId
      if (
        !UUID_PATTERN.test(body.lectureSessionId ?? '') ||
        !UUID_PATTERN.test(body.idempotencyKey ?? '') ||
        !UUID_PATTERN.test(ticketRequestId ?? '') ||
        body.idempotencyKey === ticketRequestId ||
        !DOCUMENT_PATTERN.test(body.documentId ?? '') ||
        !SHA_PATTERN.test(body.pdfSha256 ?? '') ||
        !Number.isSafeInteger(body.byteSize) ||
        Number(body.byteSize) < 1 ||
        Number(body.byteSize) > 15 * 1024 * 1024 ||
        !Number.isSafeInteger(body.pageCount) ||
        Number(body.pageCount) < 1 ||
        Number(body.pageCount) > 75 ||
        !Number.isSafeInteger(body.textCharCount) ||
        Number(body.textCharCount) < 1 ||
        Number(body.textCharCount) > 20_000 ||
        !SHA_PATTERN.test(body.textSha256 ?? '') ||
        typeof body.displayName !== 'string' ||
        body.displayName.trim().length < 1 ||
        body.displayName.length > 160 ||
        typeof body.downloadEnabled !== 'boolean'
      ) {
        return jsonResponse(
          { message: 'PDF publication metadata is invalid.', ok: false },
          400,
        )
      }
      const keyVersion = coordinatorKeyVersion()
      const nonce = await derivePdfPublicationNonce(ticketRequestId!)
      const ticketJti = await derivePdfPublicationUuid(
        ticketRequestId!,
        'upload-ticket-jti',
      )
      const issued = await rpc('issue_google_admin_pdf_publication_ticket_v1', {
        ...commonParameters,
        target_allowed_origin: origin,
        target_declared_page_count: body.pageCount,
        target_declared_text_char_count: body.textCharCount,
        target_declared_text_sha256: body.textSha256,
        target_display_name: body.displayName.trim(),
        target_document_id: body.documentId,
        target_download_enabled: body.downloadEnabled,
        target_expected_byte_size: body.byteSize,
        target_expected_pdf_sha256: body.pdfSha256,
        target_lecture_session_id: body.lectureSessionId,
        target_nonce_hash: await sha256Hex(nonce),
        target_publication_request_id: body.idempotencyKey,
        target_ticket_jti_hash: await sha256Hex(ticketJti),
        target_ticket_key_version: keyVersion,
        target_ticket_request_id: ticketRequestId,
      })
      const row = issued.data as
        | (PublicationRow & {
            idempotentReplay?: boolean
            ok?: boolean
            ticketCurrent?: boolean
            ticketExpiresAt?: string
            ticketIssuedAt?: string
          })
        | null
      if (issued.unavailable) {
        return jsonResponse(
          { message: 'PDF publication preparation timed out.', ok: false },
          504,
        )
      }
      if (issued.error || !row?.ok) {
        return jsonResponse(
          {
            message:
              issued.error?.message ?? 'PDF publication could not be prepared.',
            ok: false,
          },
          googlePdfErrorStatus(issued.error?.code),
        )
      }
      if (row.state !== 'pending') {
        return jsonResponse({ ok: true, ...mapPublication(row) }, 200)
      }
      if (
        row.ticketCurrent !== true ||
        !UUID_PATTERN.test(row.ticket_admin_session_id ?? '') ||
        !Number.isFinite(Date.parse(row.ticketIssuedAt ?? '')) ||
        !Number.isFinite(Date.parse(row.ticketExpiresAt ?? '')) ||
        Date.parse(row.ticketExpiresAt!) <= Date.now()
      ) {
        return jsonResponse(
          {
            code: 'pdf_ticket_refresh_required',
            message: 'PDFアップロードをもう一度開始してください。',
            ok: false,
          },
          409,
        )
      }
      const uploadTicket = await signPdfPublicationTicket({
        ...ticketBase(row, row.ticket_admin_session_id),
        expiresAt: seconds(row.ticketExpiresAt!),
        issuedAt: seconds(row.ticketIssuedAt!),
        jti: ticketJti,
        nonce,
        purpose: 'upload',
      })
      return jsonResponse(
        {
          ...mapPublication(row),
          expiresAt: row.ticketExpiresAt,
          ok: true,
          uploadTicket,
          uploadUrl: `${safeWorkerBaseUrl()}/v2/pdf-publications/${row.publication_id}`,
        },
        row.idempotentReplay ? 200 : 201,
      )
    }

    if (
      !UUID_PATTERN.test(body.lectureSessionId ?? '') ||
      !UUID_PATTERN.test(body.publicationId ?? '')
    ) {
      return jsonResponse(
        { message: 'Publication scope is invalid.', ok: false },
        400,
      )
    }

    if (body.action === 'status') {
      const row = requirePublication(
        await readPublication('status', body.publicationId!),
      )
      return jsonResponse({ ok: true, ...mapPublication(row) }, 200)
    }

    if (body.action === 'abort') {
      const abortRequestId = body.abortRequestId ?? body.requestId
      if (!UUID_PATTERN.test(abortRequestId ?? '')) {
        return jsonResponse(
          { message: 'requestId is required.', ok: false },
          400,
        )
      }
      const before = requirePublication(
        await readPublication('status', body.publicationId!),
      )
      const reason =
        typeof body.reason === 'string' &&
        /^[a-z0-9_:-]{1,80}$/.test(body.reason)
          ? body.reason
          : 'admin_cancelled'
      const aborted = await rpc('abort_google_admin_pdf_publication_v1', {
        ...commonParameters,
        target_abort_request_id: abortRequestId,
        target_lecture_session_id: body.lectureSessionId,
        target_publication_id: body.publicationId,
        target_reason_code: reason,
      })
      const result = aborted.data as Record<string, unknown> | null
      if (aborted.unavailable) {
        return jsonResponse(
          { message: 'PDF cancellation timed out.', ok: false },
          504,
        )
      }
      if (aborted.error || result?.ok !== true) {
        return jsonResponse(
          {
            message:
              aborted.error?.message ?? 'PDF publication was not cancelled.',
            ok: false,
          },
          googlePdfErrorStatus(aborted.error?.code),
        )
      }

      let cleanupPending = result.cleanupPending === true
      if (
        Number.isInteger(before.committed_manifest_access_version)
      ) {
        try {
          const now = Math.floor(Date.now() / 1000)
          const rollbackTicket = await signPdfPublicationTicket({
            ...ticketBase(before, before.ticket_admin_session_id),
            expiresAt: now + 60,
            issuedAt: now,
            jti: await derivePdfPublicationUuid(
              abortRequestId!,
              'rollback-ticket-jti',
            ),
            previousAccessVersion:
              before.committed_manifest_access_version ??
              before.pdf_access_version,
            purpose: 'rollback',
            targetAccessVersion:
              before.activation_target_access_version ??
              before.pdf_access_version + 1,
          })
          await callWorker(
            `/v2/pdf-publications/${before.publication_id}/rollback`,
            rollbackTicket,
            'POST',
          )
        } catch {
          cleanupPending = true
        }
      }
      return jsonResponse(
        {
          cleanupPending,
          ok: true,
          publicationId: body.publicationId,
          status: result.status ?? 'aborted',
        },
        200,
      )
    }

    if (
      body.action !== 'finalize' ||
      !UUID_PATTERN.test(body.requestId ?? '')
    ) {
      return jsonResponse(
        { message: 'Action or requestId is invalid.', ok: false },
        400,
      )
    }

    const finalizeRequestId = body.requestId!
    const keyVersion = coordinatorKeyVersion()
    const commitOperationId = await derivePdfPublicationUuid(
      finalizeRequestId,
      'commit-operation-id',
    )
    const activationOperationId = await derivePdfPublicationUuid(
      finalizeRequestId,
      'activation-operation-id',
    )
    const authorization = await rpc(
      'prepare_google_admin_pdf_publication_finalize_v1',
      {
        ...commonParameters,
        target_activation_operation_id: activationOperationId,
        target_commit_operation_id: commitOperationId,
        target_finalize_request_id: finalizeRequestId,
        target_key_version: keyVersion,
        target_lecture_session_id: body.lectureSessionId,
        target_publication_id: body.publicationId,
      },
    )
    if (authorization.unavailable) {
      return jsonResponse(
        { message: 'PDF finalization preparation timed out.', ok: false },
        504,
      )
    }
    const authorizationValue = authorization.data as {
      continuationExpiresAt?: unknown
      ok?: boolean
    } | null
    if (
      authorization.error ||
      authorizationValue?.ok !== true
    ) {
      return jsonResponse(
        {
          message:
            authorization.error?.message ??
            'PDF publication could not be finalized.',
          ok: false,
        },
        googlePdfErrorStatus(authorization.error?.code),
      )
    }
    const continuationExpiresAt = authorizationValue.continuationExpiresAt

    let row = requirePublication(
      await readPublication('status', body.publicationId!),
    )
    if (['aborted', 'expired', 'retired', 'active'].includes(row.state)) {
      return jsonResponse({ ok: true, ...mapPublication(row) }, 200)
    }

    if (row.state === 'pending') {
      const ticketTimes = continuationTicketTimes(continuationExpiresAt)
      const statusTicket = await signPdfPublicationTicket({
        ...ticketBase(row, row.ticket_admin_session_id),
        ...ticketTimes,
        jti: await derivePdfPublicationUuid(
          finalizeRequestId,
          'status-ticket-jti',
        ),
        purpose: 'status',
      })
      const status = await callWorker(
        `/v2/pdf-publications/${row.publication_id}/status`,
        statusTicket,
        'GET',
      )
      if (
        ['active', 'committed', 'uploaded'].includes(status.status ?? '') &&
        status.publicationId === row.publication_id &&
        UUID_PATTERN.test(status.workerAttemptId ?? '') &&
        Number.isSafeInteger(status.actualByteSize) &&
        status.actualByteSize === row.expected_byte_size &&
        status.actualPdfSha256 === row.expected_pdf_sha256 &&
        status.pdfMagicVerified === true &&
        typeof status.objectKey === 'string' &&
        typeof status.objectEtag === 'string'
      ) {
        await advance(finalizeRequestId, 'recordUploaded', {
          actualByteSize: status.actualByteSize!,
          actualPdfSha256: status.actualPdfSha256!,
          objectEtag: status.objectEtag,
          objectKey: status.objectKey,
          pdfMagicVerified: true,
          r2ObjectVersion: status.objectEtag,
          workerAttemptId: status.workerAttemptId!,
        })
        row = requirePublication(
          await readPublication('status', body.publicationId!),
        )
      }
    }
    if (row.state === 'pending') {
      return jsonResponse(
        { message: 'PDF upload is not complete.', ok: false },
        409,
      )
    }

    if (row.state === 'uploaded') {
      await advance(finalizeRequestId, 'prepareCommit')
      row = requirePublication(
        await readPublication('status', body.publicationId!),
      )
      const ticketTimes = continuationTicketTimes(continuationExpiresAt)
      const commitTicket = await signPdfPublicationTicket({
        ...ticketBase(row, row.ticket_admin_session_id),
        download: row.download_enabled,
        ...ticketTimes,
        jti: await derivePdfPublicationUuid(
          finalizeRequestId,
          'commit-ticket-jti',
        ),
        name: row.display_name,
        pages: row.declared_page_count,
        previousAccessVersion: row.pdf_access_version,
        purpose: 'commit',
        textCharacters: row.declared_text_char_count,
        textSha256: row.declared_text_sha256,
      })
      const commit = await callWorker(
        `/v2/pdf-publications/${row.publication_id}/commit`,
        commitTicket,
        'POST',
      )
      if (
        commit.publicationId !== row.publication_id ||
        commit.status !== 'committed' ||
        commit.accessVersion !== row.pdf_access_version ||
        !Number.isSafeInteger(commit.manifestVersion) ||
        typeof commit.manifestEtag !== 'string'
      ) {
        throw new Error('PDF commit receipt is invalid.')
      }
      await advance(finalizeRequestId, 'completeCommit', {
        manifestAccessVersion: commit.accessVersion,
        manifestEtag: commit.manifestEtag,
        manifestVersion: commit.manifestVersion,
      })
      row = requirePublication(
        await readPublication('status', body.publicationId!),
      )
    }

    if (row.state === 'committed') {
      await advance(finalizeRequestId, 'prepareActivation')
      row = requirePublication(
        await readPublication('status', body.publicationId!),
      )
      const targetAccessVersion = row.activation_target_access_version
      if (!Number.isSafeInteger(targetAccessVersion)) {
        throw new Error('PDF activation fence is invalid.')
      }
      const ticketTimes = continuationTicketTimes(continuationExpiresAt)
      const activationTicket = await signPdfPublicationTicket({
        ...ticketBase(row, row.ticket_admin_session_id),
        ...ticketTimes,
        jti: await derivePdfPublicationUuid(
          finalizeRequestId,
          'activation-ticket-jti',
        ),
        previousAccessVersion:
          row.committed_manifest_access_version ?? row.pdf_access_version,
        purpose: 'activate',
        targetAccessVersion: targetAccessVersion!,
      })
      const activation = await callWorker(
        `/v2/pdf-publications/${row.publication_id}/activate`,
        activationTicket,
        'POST',
      )
      if (
        activation.publicationId !== row.publication_id ||
        activation.status !== 'active' ||
        activation.accessVersion !== targetAccessVersion ||
        !Number.isSafeInteger(activation.manifestVersion) ||
        typeof activation.manifestEtag !== 'string'
      ) {
        throw new Error('PDF activation receipt is invalid.')
      }
      await advance(finalizeRequestId, 'completeActivation', {
        manifestAccessVersion: activation.accessVersion,
        manifestEtag: activation.manifestEtag,
        manifestVersion: activation.manifestVersion,
      })
      row = requirePublication(
        await readPublication('status', body.publicationId!),
      )
    }

    return jsonResponse({ ok: true, ...mapPublication(row) }, 200)
  } catch (error) {
    const status =
      error && typeof error === 'object' && 'status' in error
        ? Number(error.status)
        : 409
    return jsonResponse(
      {
        message:
          error instanceof Error ? error.message : 'PDF publication failed.',
        ok: false,
      },
      status >= 400 && status <= 599 ? status : 500,
    )
  }
}

Deno.serve(async (request) => {
  const jsonResponse = createJsonResponse(request)
  const corsResponse = handleCors(request)
  if (corsResponse) return corsResponse
  if (request.method !== 'POST') {
    return jsonResponse({ message: 'Method not allowed.', ok: false }, 405)
  }
  const origin = getAllowedCorsOrigin(request)
  if (!origin) {
    return jsonResponse({ message: 'Origin is required.', ok: false }, 403)
  }
  let body: RequestBody
  try {
    body = await readJsonBody<RequestBody>(request, 32 * 1024)
  } catch (error) {
    const detail = describeJsonBodyError(error)
    return jsonResponse({ message: detail.message, ok: false }, detail.status)
  }
  if (hasLegacyAdminFields(body)) {
    return jsonResponse(
      { message: 'Legacy Admin credentials are not supported.', ok: false },
      400,
    )
  }
  if (
    !body.action ||
    !body.lectureSessionId ||
    typeof body.appSessionToken !== 'string' ||
    body.appSessionToken.trim().length === 0
  ) {
    return jsonResponse(
      { message: 'Action, lecture and Admin session are required.', ok: false },
      400,
    )
  }

  return handleGooglePdfPublication({ body, jsonResponse, origin, request })
})
