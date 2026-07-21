import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.110.0'
import {
  getAdminTokenClaims,
  getAdminTokenSecret,
  trackedAdminSessionsEnabled,
} from '../_shared/adminToken.ts'
import { getAllowedCorsOrigin, handleCors } from '../_shared/cors.ts'
import {
  createPdfPublicationNonce,
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
  upload_lease_expires_at: string | null
  worker_attempt_id: string | null
}

type RequestBody = {
  action?: 'abort' | 'finalize' | 'initiate' | 'status'
  adminToken?: string
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

function seconds(value: string) {
  const parsed = Date.parse(value)
  if (!Number.isFinite(parsed)) throw new Error('Publication time is invalid.')
  return Math.floor(parsed / 1000)
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
    lectureSessionId: row.lecture_session_id,
    publicationId: row.publication_id,
    status: row.state,
  }
}

async function readWorkerResponse(response: Response) {
  const contentLength = response.headers.get('Content-Length')
  if (
    contentLength &&
    (!/^\d+$/.test(contentLength) || Number(contentLength) > MAX_WORKER_RESPONSE_BYTES)
  ) {
    throw new Error('PDF publication Worker response is too large.')
  }
  const bytes = new Uint8Array(await response.arrayBuffer())
  if (bytes.byteLength > MAX_WORKER_RESPONSE_BYTES) {
    throw new Error('PDF publication Worker response is too large.')
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

async function callWorker(
  path: string,
  token: string,
  method: 'GET' | 'POST',
) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), WORKER_TIMEOUT_MS)
  try {
    const response = await fetch(`${safeWorkerBaseUrl()}${path}`, {
      headers: { Authorization: `Bearer ${token}` },
      method,
      redirect: 'error',
      signal: controller.signal,
    })
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

async function workerStatus(row: PublicationRow, adminSessionId: string) {
  const now = Math.floor(Date.now() / 1000)
  const token = await signPdfPublicationTicket({
    ...ticketBase(row, adminSessionId),
    expiresAt: now + 60,
    issuedAt: now,
    jti: crypto.randomUUID(),
    purpose: 'status',
  })
  return callWorker(
    `/v2/pdf-publications/${row.publication_id}/status`,
    token,
    'GET',
  )
}

Deno.serve(async (request) => {
  const jsonResponse = createJsonResponse(request)
  const corsResponse = handleCors(request)
  if (corsResponse) return corsResponse
  if (request.method !== 'POST') {
    return jsonResponse({ message: 'Method not allowed.', ok: false }, 405)
  }
  if (Deno.env.get('PHASE726_BROWSER_PDF_PUBLICATION_ENABLED') !== 'true') {
    return jsonResponse({ message: 'Not found.', ok: false }, 404)
  }
  const origin = getAllowedCorsOrigin(request)
  if (!origin) {
    return jsonResponse({ message: 'Origin is required.', ok: false }, 403)
  }
  if (!trackedAdminSessionsEnabled()) {
    return jsonResponse(
      { message: 'Tracked Admin sessions are required.', ok: false },
      503,
    )
  }

  let body: RequestBody
  try {
    body = await readJsonBody<RequestBody>(request, 32 * 1024)
  } catch (error) {
    const detail = describeJsonBodyError(error)
    return jsonResponse({ message: detail.message, ok: false }, detail.status)
  }
  if (!body.action || !body.adminToken || !body.lectureSessionId) {
    return jsonResponse(
      { message: 'Action, lecture and Admin session are required.', ok: false },
      400,
    )
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!supabaseUrl || !serviceRoleKey) {
    return jsonResponse(
      { message: 'PDF publication is not configured.', ok: false },
      500,
    )
  }
  const service = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  })
  let adminClaims
  try {
    adminClaims = await getAdminTokenClaims(
      body.adminToken,
      getAdminTokenSecret(),
      request,
    )
  } catch {
    adminClaims = null
  }
  if (!adminClaims?.sid || !UUID_PATTERN.test(adminClaims.sid)) {
    return jsonResponse({ message: 'Invalid Admin session.', ok: false }, 401)
  }
  const authorization = request.headers.get('Authorization') ?? ''
  const userJwt = authorization.startsWith('Bearer ')
    ? authorization.slice(7).trim()
    : ''
  const { data: userData, error: userError } = await service.auth.getUser(userJwt)
  if (userError || !userData.user) {
    return jsonResponse({ message: 'Authentication required.', ok: false }, 401)
  }
  const adminSessionId = adminClaims.sid
  const adminAuthUserId = userData.user.id

  async function getPublication(publicationId: string) {
    const { data, error } = await service.rpc('admin_get_pdf_publication_v1', {
      target_admin_auth_user_id: adminAuthUserId,
      target_admin_session_id: adminSessionId,
      target_publication_id: publicationId,
    })
    if (error) throw new Error(error.message)
    const row = data as PublicationRow | null
    if (!row || row.lecture_session_id !== body.lectureSessionId) {
      throw Object.assign(new Error('PDF publication was not found.'), {
        status: 404,
      })
    }
    return row
  }

  async function reconcileUploaded(row: PublicationRow) {
    if (row.state !== 'pending') return row
    const status = await workerStatus(row, adminSessionId)
    if (
      !['active', 'committed', 'uploaded'].includes(status.status ?? '') ||
      status.publicationId !== row.publication_id ||
      !UUID_PATTERN.test(status.workerAttemptId ?? '') ||
      !Number.isSafeInteger(status.actualByteSize) ||
      status.actualByteSize !== row.expected_byte_size ||
      status.actualPdfSha256 !== row.expected_pdf_sha256 ||
      status.pdfMagicVerified !== true ||
      typeof status.objectKey !== 'string' ||
      typeof status.objectEtag !== 'string'
    ) {
      return row
    }
    const { data, error } = await service.rpc(
      'worker_record_pdf_publication_uploaded_v1',
      {
        target_actual_byte_size: status.actualByteSize,
        target_actual_pdf_sha256: status.actualPdfSha256,
        target_pdf_magic_verified: true,
        target_publication_id: row.publication_id,
        target_object_etag: status.objectEtag,
        target_object_key: status.objectKey,
        target_r2_object_version: status.objectEtag,
        target_worker_attempt_id: status.workerAttemptId,
      },
    )
    if (error) throw new Error(error.message)
    return data as PublicationRow
  }

  try {
    if (body.action === 'initiate') {
      if (
        !UUID_PATTERN.test(body.idempotencyKey ?? '') ||
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
        body.downloadEnabled === undefined
      ) {
        return jsonResponse(
          { message: 'PDF publication metadata is invalid.', ok: false },
          400,
        )
      }
      const nonce = createPdfPublicationNonce()
      const ticketJti = crypto.randomUUID()
      const { data, error } = await service.rpc(
        'admin_create_pdf_publication_v1',
        {
          target_admin_auth_user_id: adminAuthUserId,
          target_admin_session_id: adminSessionId,
          target_allowed_origin: origin,
          target_client_request_id: body.idempotencyKey,
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
          target_ticket_jti_hash: await sha256Hex(ticketJti),
        },
      )
      if (error) throw Object.assign(new Error(error.message), { status: 409 })
      let row = data as PublicationRow
      if (row.state !== 'pending') {
        return jsonResponse({ ok: true, ...mapPublication(row) }, 200)
      }
      if (row.nonce_used_at) {
        row = await reconcileUploaded(row)
        if (row.state !== 'pending') {
          return jsonResponse({ ok: true, ...mapPublication(row) }, 200)
        }
        const leaseExpiresAt = Date.parse(row.upload_lease_expires_at ?? '')
        const serverNow = Date.parse(row.server_time)
        if (
          Number.isFinite(leaseExpiresAt) &&
          Number.isFinite(serverNow) &&
          leaseExpiresAt > serverNow
        ) {
          return jsonResponse(
            {
              message: 'The previous PDF upload is still being recovered.',
              ok: false,
              retryAt: row.upload_lease_expires_at,
            },
            409,
          )
        }
        const { data: reissued, error: reissueError } = await service.rpc(
          'admin_reissue_pdf_publication_ticket_v1',
          {
            target_admin_auth_user_id: adminAuthUserId,
            target_admin_session_id: adminSessionId,
            target_nonce_hash: await sha256Hex(nonce),
            target_publication_id: row.publication_id,
            target_ticket_jti_hash: await sha256Hex(ticketJti),
          },
        )
        if (reissueError) {
          throw Object.assign(new Error(reissueError.message), { status: 409 })
        }
        row = reissued as PublicationRow
      }
      const issuedAt = seconds(row.server_time)
      const expiresAt = seconds(row.ticket_expires_at)
      const uploadTicket = await signPdfPublicationTicket({
        ...ticketBase(row, adminSessionId),
        expiresAt,
        issuedAt,
        jti: ticketJti,
        nonce,
        purpose: 'upload',
      })
      return jsonResponse(
        {
          ...mapPublication(row),
          expiresAt: row.ticket_expires_at,
          ok: true,
          uploadTicket,
          uploadUrl: `${safeWorkerBaseUrl()}/v2/pdf-publications/${row.publication_id}`,
        },
        201,
      )
    }

    if (!UUID_PATTERN.test(body.publicationId ?? '')) {
      return jsonResponse({ message: 'Publication ID is invalid.', ok: false }, 400)
    }
    let row = await getPublication(body.publicationId!)

    if (body.action === 'status') {
      row = await reconcileUploaded(row)
      return jsonResponse({ ok: true, ...mapPublication(row) }, 200)
    }

    if (body.action === 'abort') {
      const reason =
        typeof body.reason === 'string' &&
        /^[a-z0-9_:-]{1,80}$/.test(body.reason)
          ? body.reason
          : 'admin_cancelled'
      if (row.state === 'committed') {
        const now = Math.floor(Date.now() / 1000)
        const rollbackTicket = await signPdfPublicationTicket({
          ...ticketBase(row, adminSessionId),
          expiresAt: now + 60,
          issuedAt: now,
          jti: crypto.randomUUID(),
          previousAccessVersion:
            row.committed_manifest_access_version ?? row.pdf_access_version,
          purpose: 'rollback',
          targetAccessVersion:
            row.activation_target_access_version ?? row.pdf_access_version + 1,
        })
        await callWorker(
          `/v2/pdf-publications/${row.publication_id}/rollback`,
          rollbackTicket,
          'POST',
        )
      }
      const { data, error } = await service.rpc(
        'admin_abort_pdf_publication_v1',
        {
          target_admin_auth_user_id: adminAuthUserId,
          target_admin_session_id: adminSessionId,
          target_publication_id: row.publication_id,
          target_reason_code: reason,
        },
      )
      if (error) throw Object.assign(new Error(error.message), { status: 409 })
      return jsonResponse({ ok: true, ...mapPublication(data as PublicationRow) }, 200)
    }

    if (body.action !== 'finalize') {
      return jsonResponse({ message: 'Action is invalid.', ok: false }, 400)
    }
    row = await reconcileUploaded(row)
    if (['aborted', 'expired', 'retired'].includes(row.state)) {
      return jsonResponse({ ok: true, ...mapPublication(row) }, 200)
    }
    if (row.state === 'pending') {
      return jsonResponse(
        { message: 'PDF upload is not complete.', ok: false },
        409,
      )
    }

    if (row.state === 'uploaded') {
      const commitOperationId = row.commit_operation_id ?? crypto.randomUUID()
      const prepared = await service.rpc(
        'admin_prepare_pdf_publication_commit_v1',
        {
          target_admin_auth_user_id: adminAuthUserId,
          target_admin_session_id: adminSessionId,
          target_commit_operation_id: commitOperationId,
          target_publication_id: row.publication_id,
        },
      )
      if (prepared.error) throw new Error(prepared.error.message)
      row = prepared.data as PublicationRow
      const now = Math.floor(Date.now() / 1000)
      const commitTicket = await signPdfPublicationTicket({
        ...ticketBase(row, adminSessionId),
        download: row.download_enabled,
        expiresAt: now + 60,
        issuedAt: now,
        jti: crypto.randomUUID(),
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
      const completed = await service.rpc(
        'admin_complete_pdf_publication_commit_v1',
        {
          target_admin_auth_user_id: adminAuthUserId,
          target_admin_session_id: adminSessionId,
          target_commit_operation_id: commitOperationId,
          target_manifest_access_version: commit.accessVersion,
          target_manifest_etag: commit.manifestEtag,
          target_manifest_version: commit.manifestVersion,
          target_publication_id: row.publication_id,
        },
      )
      if (completed.error) throw new Error(completed.error.message)
      row = completed.data as PublicationRow
    }

    if (row.state === 'committed') {
      const activationOperationId =
        row.activation_operation_id ?? crypto.randomUUID()
      const prepared = await service.rpc(
        'admin_prepare_pdf_publication_activation_v1',
        {
          target_activation_operation_id: activationOperationId,
          target_admin_auth_user_id: adminAuthUserId,
          target_admin_session_id: adminSessionId,
          target_publication_id: row.publication_id,
        },
      )
      if (prepared.error) throw new Error(prepared.error.message)
      row = prepared.data as PublicationRow
      const targetAccessVersion = row.activation_target_access_version
      if (!Number.isInteger(targetAccessVersion)) {
        throw new Error('PDF activation fence is invalid.')
      }
      const now = Math.floor(Date.now() / 1000)
      const activationTicket = await signPdfPublicationTicket({
        ...ticketBase(row, adminSessionId),
        expiresAt: now + 60,
        issuedAt: now,
        jti: crypto.randomUUID(),
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
      const rollbackActivation = async () => {
        const rollbackTicket = await signPdfPublicationTicket({
          ...ticketBase(row, adminSessionId),
          expiresAt: now + 60,
          issuedAt: now,
          jti: crypto.randomUUID(),
          previousAccessVersion:
            row.committed_manifest_access_version ?? row.pdf_access_version,
          purpose: 'rollback',
          targetAccessVersion,
        })
        await callWorker(
          `/v2/pdf-publications/${row.publication_id}/rollback`,
          rollbackTicket,
          'POST',
        )
      }
      const completed = await service.rpc(
        'admin_complete_pdf_publication_activation_v1',
        {
          target_activation_operation_id: activationOperationId,
          target_admin_auth_user_id: adminAuthUserId,
          target_admin_session_id: adminSessionId,
          target_manifest_access_version: activation.accessVersion,
          target_manifest_etag: activation.manifestEtag,
          target_manifest_version: activation.manifestVersion,
          target_publication_id: row.publication_id,
        },
      )
      const activationMatches = (candidate: PublicationRow) =>
        ['active', 'retired'].includes(candidate.state) &&
        candidate.activation_operation_id === activationOperationId &&
        candidate.activation_target_access_version === activation.accessVersion &&
        candidate.activated_manifest_version === activation.manifestVersion &&
        candidate.activated_manifest_etag === activation.manifestEtag
      if (completed.error) {
        let authoritative: PublicationRow
        try {
          authoritative = await getPublication(row.publication_id)
        } catch {
          throw new Error(
            'PDF activation outcome is uncertain; retry status before rollback.',
          )
        }
        if (['active', 'retired'].includes(authoritative.state)) {
          if (!activationMatches(authoritative)) {
            throw new Error('Active PDF publication receipt is inconsistent.')
          }
          row = authoritative
        } else {
          await rollbackActivation()
          throw new Error(completed.error.message)
        }
      } else {
        row = completed.data as PublicationRow
      }
      if (!['active', 'retired'].includes(row.state)) {
        let authoritative: PublicationRow
        try {
          authoritative = await getPublication(row.publication_id)
        } catch {
          throw new Error(
            'PDF activation outcome is uncertain; retry status before rollback.',
          )
        }
        if (['active', 'retired'].includes(authoritative.state)) {
          if (!activationMatches(authoritative)) {
            throw new Error('Active PDF publication receipt is inconsistent.')
          }
          row = authoritative
        } else {
          await rollbackActivation()
          throw new Error('PDF activation was not committed.')
        }
      }
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
})
