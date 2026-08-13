import { createClient } from 'npm:@supabase/supabase-js@2'
import { sha256Hex } from '../_shared/adminToken.ts'
import { getAllowedCorsOrigin, handleCors } from '../_shared/cors.ts'
import { verifyGoogleAdminOperationRequest } from '../_shared/googleAdminOperations.ts'
import { hasLegacyAdminFields } from '../_shared/googleOnlyAdmin.ts'
import { describeJsonBodyError, readJsonBody } from '../_shared/requestBody.ts'
import { createJsonResponse } from '../_shared/responses.ts'
import {
  createPresenterPairingToken,
  derivePresenterManualCode,
  getPresenterTokenSecret,
  hashPresenterContext,
} from '../_shared/presenterToken.ts'

type RequestBody = {
  action?: 'confirm' | 'issue' | 'revoke' | 'status'
  appSessionToken?: string
  connectionId?: string
  lectureSessionId?: string
  requestId?: string
}

type GoogleIssueResult = {
  connectionId: string
  hardStopAt: string
  manualExpiresAt: string
  ok: true
  pairingIssuedAtEpoch: number
  pairingTicketExpiresAt: string
  pdfDocumentId: string
  pdfDocumentVersion: string
  pdfManifestVersion: number
  pdfPageCount: number
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

function presenterErrorStatus(code?: string) {
  if (code === '42501') return 401
  if (code === 'P7290' || code === 'P7337') return 503
  if (code?.startsWith('P729')) return 409
  if (code === 'P7335') return 409
  if (code === '22023') return 400
  return 503
}

function presenterTokenSecret() {
  try {
    return getPresenterTokenSecret()
  } catch {
    return ''
  }
}

Deno.serve(async (request) => {
  const jsonResponse = createJsonResponse(request)
  const corsResponse = handleCors(request)
  if (corsResponse) return corsResponse
  if (request.method !== 'POST') {
    return jsonResponse({ ok: false, message: 'Method not allowed.' }, 405)
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
  if (hasLegacyAdminFields(body)) {
    return jsonResponse(
      { ok: false, message: 'Legacy Admin credentials are not supported.' },
      400,
    )
  }
  if (
    !isPresenterAction(body.action) ||
    typeof body.appSessionToken !== 'string' ||
    body.appSessionToken.trim().length === 0
  ) {
    return jsonResponse({ ok: false, message: 'Request is incomplete.' }, 400)
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

  const googleContext = await verifyGoogleAdminOperationRequest(
      request,
      body.appSessionToken,
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

    const requestRequired = body.action !== 'status'
    if (requestRequired && !UUID_PATTERN.test(body.requestId ?? '')) {
      return jsonResponse({ ok: false, message: 'requestId is required.' }, 400)
    }
    if (
      (body.action === 'issue' || body.action === 'status') &&
      !UUID_PATTERN.test(body.lectureSessionId ?? '')
    ) {
      return jsonResponse({ ok: false, message: 'Lecture is invalid.' }, 400)
    }
    if (
      (body.action === 'confirm' || body.action === 'revoke') &&
      !UUID_PATTERN.test(body.connectionId ?? '')
    ) {
      return jsonResponse({ ok: false, message: 'Connection is invalid.' }, 400)
    }

    const presenterTransportEnabled =
      Deno.env.get('PHASE729_POWERPOINT_SYNC_ENABLED') === 'true'
    const commonParameters = {
      target_action: body.action,
      target_auth_user_id: googleContext.authUserId,
      target_connection_id:
        body.action === 'confirm' || body.action === 'revoke'
          ? body.connectionId
          : null,
      target_google_issuer: googleContext.googleIssuer,
      target_lecture_session_id:
        body.action === 'issue' || body.action === 'status'
          ? body.lectureSessionId
          : null,
      target_manual_code_hmac: null as string | null,
      target_origin: null as string | null,
      target_presenter_transport_enabled: presenterTransportEnabled,
      target_provider_subject_hmac: googleContext.googleSubjectHmac,
      target_request_id: requestRequired ? body.requestId : null,
      target_subject_pepper_version: googleContext.subjectPepperVersion,
      target_supabase_auth_session_id: googleContext.supabaseAuthSessionId,
      target_ticket_jti_hash: null as string | null,
      target_token_hash: googleContext.appSessionTokenHash,
      target_transport_enabled: googleContext.transportEnabled,
    }

    if (body.action === 'issue') {
      const origin = getAllowedCorsOrigin(request)
      if (!origin) {
        return jsonResponse({ ok: false, message: 'Origin is required.' }, 403)
      }
      const tokenSecret = presenterTokenSecret()
      if (!tokenSecret) {
        return jsonResponse(
          { ok: false, message: 'Presenter service is not configured.' },
          503,
        )
      }
      const ticketJti = body.requestId!
      const manualCode = await derivePresenterManualCode(
        body.requestId!,
        tokenSecret,
      )
      const { data, error, unavailable } = await rpc(
        'manage_google_admin_presenter_connection_v1',
        {
          ...commonParameters,
          target_manual_code_hmac: await hashPresenterContext(
            manualCode,
            'manual-code',
            tokenSecret,
          ),
          target_origin: origin,
          target_ticket_jti_hash: await sha256Hex(ticketJti),
        },
      )
      const issued = data as GoogleIssueResult | null
      if (unavailable) {
        return jsonResponse(
          {
            ok: false,
            message: 'PowerPoint connection preparation timed out.',
          },
          504,
        )
      }
      if (
        error ||
        !issued?.ok ||
        !UUID_PATTERN.test(issued.connectionId) ||
        !Number.isSafeInteger(issued.pairingIssuedAtEpoch) ||
        !Number.isFinite(Date.parse(issued.pairingTicketExpiresAt)) ||
        !Number.isFinite(Date.parse(issued.manualExpiresAt)) ||
        typeof issued.hardStopAt !== 'string' ||
        typeof issued.pdfDocumentId !== 'string' ||
        typeof issued.pdfDocumentVersion !== 'string' ||
        !Number.isSafeInteger(issued.pdfManifestVersion) ||
        !Number.isSafeInteger(issued.pdfPageCount)
      ) {
        return jsonResponse(
          {
            ok: false,
            message: 'PowerPoint connection could not be prepared.',
          },
          presenterErrorStatus(error?.code),
        )
      }
      if (Date.parse(issued.manualExpiresAt) <= Date.now()) {
        return jsonResponse(
          {
            code: 'presenter_session_refresh_required',
            message: 'PowerPoint接続をもう一度開始してください。',
            ok: false,
          },
          409,
        )
      }
      const expiresAt = Math.floor(
        new Date(issued.pairingTicketExpiresAt).getTime() / 1000,
      )
      const pairingTicket = await createPresenterPairingToken({
        connectionId: issued.connectionId,
        expiresAt,
        issuedAt: issued.pairingIssuedAtEpoch,
        jti: ticketJti,
        lectureSessionId: body.lectureSessionId!,
        origin,
        secret: tokenSecret,
      })
      return jsonResponse({
        connectionId: issued.connectionId,
        hardStopAt: issued.hardStopAt,
        manualCode,
        ok: true,
        pairingTicketExpiresAt: issued.pairingTicketExpiresAt,
        pairingTicket,
        pdf: {
          documentId: issued.pdfDocumentId,
          documentVersion: issued.pdfDocumentVersion,
          manifestVersion: issued.pdfManifestVersion,
          pageCount: issued.pdfPageCount,
        },
        ticketExpiresAt: issued.manualExpiresAt,
      })
    }

    const { data, error, unavailable } = await rpc(
      'manage_google_admin_presenter_connection_v1',
      commonParameters,
    )
    if (unavailable) {
      return jsonResponse(
        {
          ok: false,
          message:
            body.action === 'status'
              ? 'PowerPoint status loading timed out.'
              : body.action === 'confirm'
                ? 'PowerPoint confirmation timed out.'
                : 'PowerPoint synchronization stop timed out.',
        },
        504,
      )
    }
    const result = data as Record<string, unknown> | null
    if (error || result?.ok !== true) {
      return jsonResponse(
        {
          ok: false,
          message:
            body.action === 'status'
              ? 'PowerPoint status could not be loaded.'
              : body.action === 'confirm'
                ? 'PowerPoint could not be confirmed.'
                : 'PowerPoint synchronization could not be stopped.',
        },
        presenterErrorStatus(error?.code),
      )
    }
    if (body.action === 'status') {
      return jsonResponse({
        connection:
          result.connection && typeof result.connection === 'object'
            ? camelCaseConnection(result.connection as Record<string, unknown>)
            : null,
        ok: true,
        runtimeEnabled: result.runtime_enabled === true,
      })
    }
    return body.action === 'confirm'
      ? jsonResponse({
          connectionId: result.connectionId,
          ok: true,
          pdfPageCount: result.pdfPageCount,
          state: result.state,
        })
      : jsonResponse({
          connectionId: result.connectionId,
          ok: true,
          revokeReason: result.revokeReason,
          revokedAt: result.revokedAt,
          state: result.state,
        })
})
