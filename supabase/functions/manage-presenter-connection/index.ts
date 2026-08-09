import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.110.0'
import {
  getAdminTokenClaims,
  getAdminTokenSecret,
  sha256Hex,
} from '../_shared/adminToken.ts'
import { getAllowedCorsOrigin, handleCors } from '../_shared/cors.ts'
import { describeJsonBodyError, readJsonBody } from '../_shared/requestBody.ts'
import { createJsonResponse } from '../_shared/responses.ts'
import {
  createPresenterPairingToken,
  getPresenterTokenSecret,
  hashPresenterContext,
} from '../_shared/presenterToken.ts'

type RequestBody = {
  action?: 'confirm' | 'issue' | 'revoke' | 'status'
  adminToken?: string
  connectionId?: string
  lectureSessionId?: string
}

type IssueResult = {
  connection_id: string
  hard_stop_at: string
  pdf_document_id: string
  pdf_document_version: string
  pdf_manifest_version: number
  pdf_page_count: number
  pairing_ticket_expires_at: string
  ticket_expires_at: string
}

type StatusResult = {
  connection: null | Record<string, unknown>
  runtime_enabled: boolean
}

function camelCaseConnection(connection: Record<string, unknown>) {
  return {
    capabilityExpiresAt: connection.capability_expires_at ?? null,
    confirmedAt: connection.confirmed_at ?? null,
    connectionId: connection.connection_id,
    customShowActive: connection.custom_show_active ?? null,
    hardStopAt: connection.hard_stop_at,
    hiddenSlideCount: connection.hidden_slide_count ?? null,
    lastCommittedPdfPage: connection.last_committed_pdf_page ?? null,
    lastSeenAt: connection.last_seen_at ?? null,
    lastSequence: connection.last_sequence,
    pdfDocumentId: connection.pdf_document_id,
    pdfDocumentVersion: connection.pdf_document_version,
    pdfPageCount: connection.pdf_page_count,
    pptxFileSha256: connection.pptx_file_sha256 ?? null,
    revokedAt: connection.revoked_at ?? null,
    revokeReason: connection.revoke_reason ?? null,
    slideCount: connection.slide_count ?? null,
    slideIdOrderSha256: connection.slide_id_order_sha256 ?? null,
    state: connection.state,
    ticketExpiresAt: connection.ticket_expires_at,
  }
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const MANUAL_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const PRESENTER_ACTIONS = new Set(['confirm', 'issue', 'revoke', 'status'])
const RPC_TIMEOUT_MS = 3_500
const TRANSIENT_DATABASE_CODES = new Set([
  '55P03',
  '57014',
  'P7297',
  'PGRST003',
])

function isPresenterAction(
  value: unknown,
): value is NonNullable<RequestBody['action']> {
  return typeof value === 'string' && PRESENTER_ACTIONS.has(value)
}

function randomManualCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(8))
  return Array.from(
    bytes,
    (value) => MANUAL_ALPHABET[value % MANUAL_ALPHABET.length],
  ).join('')
}

function bearerToken(request: Request) {
  const authorization = request.headers.get('Authorization') ?? ''
  return authorization.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length).trim()
    : ''
}

function presenterErrorStatus(code?: string) {
  if (code === '42501') return 401
  if (code === 'P7290') return 503
  if (code?.startsWith('P729')) return 409
  if (code === '22023') return 400
  return 503
}

Deno.serve(async (request) => {
  const jsonResponse = createJsonResponse(request)
  const corsResponse = handleCors(request)
  if (corsResponse) return corsResponse
  if (request.method !== 'POST') {
    return jsonResponse({ ok: false, message: 'Method not allowed.' }, 405)
  }
  if (Deno.env.get('PHASE729_POWERPOINT_SYNC_ENABLED') !== 'true') {
    return jsonResponse(
      { ok: false, message: 'PowerPoint synchronization is disabled.' },
      503,
    )
  }

  let body: RequestBody
  try {
    body = await readJsonBody<RequestBody>(request, 8 * 1024)
  } catch (error) {
    const bodyError = describeJsonBodyError(error)
    return jsonResponse(
      { ok: false, message: bodyError.message },
      bodyError.status,
    )
  }
  if (!isPresenterAction(body.action) || !body.adminToken) {
    return jsonResponse({ ok: false, message: 'Request is incomplete.' }, 400)
  }

  const claims = await getAdminTokenClaims(
    body.adminToken,
    getAdminTokenSecret(),
    request,
  ).catch(() => null)
  if (!claims?.sid) {
    return jsonResponse({ ok: false, message: 'Invalid Admin session.' }, 401)
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!supabaseUrl || !serviceRoleKey) {
    return jsonResponse(
      { ok: false, message: 'Presenter service is not configured.' },
      503,
    )
  }
  const service = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  })
  const rpc = async (name: string, parameters: Record<string, unknown>) => {
    try {
      const result = await service
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
  const userJwt = bearerToken(request)
  const { data: userData, error: userError } = userJwt
    ? await service.auth.getUser(userJwt)
    : { data: { user: null }, error: new Error('Missing bearer token.') }
  if (userError || !userData.user) {
    return jsonResponse(
      { ok: false, message: 'Admin authentication failed.' },
      401,
    )
  }

  if (body.action === 'issue') {
    if (!body.lectureSessionId || !UUID_PATTERN.test(body.lectureSessionId)) {
      return jsonResponse({ ok: false, message: 'Lecture is invalid.' }, 400)
    }
    const origin = getAllowedCorsOrigin(request)
    if (!origin) {
      return jsonResponse({ ok: false, message: 'Origin is required.' }, 403)
    }
    const ticketJti = crypto.randomUUID()
    const manualCode = randomManualCode()
    const tokenSecret = getPresenterTokenSecret()
    const pairingTicketExpiresAt = new Date(Date.now() + 55_000)
    const manualCodeExpiresAt = new Date(Date.now() + 5 * 60_000)
    const { data, error, unavailable } = await rpc('issue_presenter_connection_v2', {
      target_admin_auth_user_id: userData.user.id,
      target_admin_session_id: claims.sid,
      target_lecture_session_id: body.lectureSessionId,
      target_manual_code_hmac: await hashPresenterContext(
        manualCode,
        'manual-code',
        tokenSecret,
      ),
      target_manual_code_expires_at: manualCodeExpiresAt.toISOString(),
      target_pairing_ticket_expires_at:
        pairingTicketExpiresAt.toISOString(),
      target_ticket_jti_hash: await sha256Hex(ticketJti),
    })
    if (unavailable) {
      return jsonResponse(
        { ok: false, message: 'PowerPoint connection preparation timed out.' },
        504,
      )
    }
    if (error || !data) {
      return jsonResponse(
        { ok: false, message: 'PowerPoint connection could not be prepared.' },
        presenterErrorStatus(error?.code),
      )
    }
    const issued = data as unknown as IssueResult
    const issuedAt = Math.floor(Date.now() / 1000)
    const expiresAt = Math.floor(
      new Date(issued.pairing_ticket_expires_at).getTime() / 1000,
    )
    const pairingTicket = await createPresenterPairingToken({
      connectionId: issued.connection_id,
      expiresAt,
      issuedAt,
      jti: ticketJti,
      lectureSessionId: body.lectureSessionId,
      origin,
      secret: tokenSecret,
    })
    return jsonResponse({
      connectionId: issued.connection_id,
      hardStopAt: issued.hard_stop_at,
      manualCode,
      ok: true,
      pairingTicketExpiresAt: issued.pairing_ticket_expires_at,
      pairingTicket,
      pdf: {
        documentId: issued.pdf_document_id,
        documentVersion: issued.pdf_document_version,
        manifestVersion: issued.pdf_manifest_version,
        pageCount: issued.pdf_page_count,
      },
      ticketExpiresAt: issued.ticket_expires_at,
    })
  }

  if (body.action === 'status') {
    if (!body.lectureSessionId || !UUID_PATTERN.test(body.lectureSessionId)) {
      return jsonResponse({ ok: false, message: 'Lecture is invalid.' }, 400)
    }
    const { data, error, unavailable } = await rpc(
      'get_presenter_connection_status_v1',
      {
        target_admin_auth_user_id: userData.user.id,
        target_admin_session_id: claims.sid,
        target_lecture_session_id: body.lectureSessionId,
      },
    )
    if (unavailable) {
      return jsonResponse(
        { ok: false, message: 'PowerPoint status loading timed out.' },
        504,
      )
    }
    if (error || !data) {
      return jsonResponse(
        { ok: false, message: 'PowerPoint status could not be loaded.' },
        presenterErrorStatus(error?.code),
      )
    }
    const status = data as unknown as StatusResult
    return jsonResponse({
      connection: status.connection
        ? camelCaseConnection(status.connection)
        : null,
      ok: true,
      runtimeEnabled: status.runtime_enabled,
    })
  }

  if (!body.connectionId || !UUID_PATTERN.test(body.connectionId)) {
    return jsonResponse({ ok: false, message: 'Connection is invalid.' }, 400)
  }
  const functionName =
    body.action === 'confirm'
      ? 'confirm_presenter_connection_v1'
      : 'revoke_presenter_connection_v1'
  const parameters = {
    target_admin_auth_user_id: userData.user.id,
    target_admin_session_id: claims.sid,
    target_connection_id: body.connectionId,
    ...(body.action === 'revoke' ? { target_reason: 'manual_handover' } : {}),
  }
  const { data, error, unavailable } = await rpc(functionName, parameters)
  if (unavailable) {
    return jsonResponse(
      {
        ok: false,
        message:
          body.action === 'confirm'
            ? 'PowerPoint confirmation timed out.'
            : 'PowerPoint synchronization stop timed out.',
      },
      504,
    )
  }
  if (error || !data) {
    return jsonResponse(
      {
        ok: false,
        message:
          body.action === 'confirm'
            ? 'PowerPoint could not be confirmed.'
            : 'PowerPoint synchronization could not be stopped.',
      },
      presenterErrorStatus(error?.code),
    )
  }
  const result = data as Record<string, unknown>
  return body.action === 'confirm'
    ? jsonResponse({
        connectionId: result.connection_id,
        ok: true,
        pdfPageCount: result.pdf_page_count,
        state: result.state,
      })
    : jsonResponse({
        connectionId: result.connection_id,
        ok: true,
        revokeReason: result.revoke_reason,
        revokedAt: result.revoked_at,
        state: result.state,
      })
})
