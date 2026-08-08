import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.110.0'
import { sha256Hex } from '../_shared/adminToken.ts'
import { describeJsonBodyError, readJsonBody } from '../_shared/requestBody.ts'
import {
  createPresenterCapabilityToken,
  getPresenterCapabilityClaims,
  getPresenterPairingClaims,
  getPresenterTokenSecret,
  hashPresenterContext,
} from '../_shared/presenterToken.ts'

type BridgeRequest = {
  action?: 'claim' | 'disconnect' | 'heartbeat' | 'inspect' | 'update'
  capabilityToken?: string
  connectionId?: string
  customShowActive?: boolean
  eventId?: string
  hiddenSlideCount?: number
  installationHash?: string
  manualCode?: string
  pairingTicket?: string
  pdfPage?: number
  pptxFileSha256?: string
  sequence?: number
  slideCount?: number
  slideId?: number
  slideIdOrderSha256?: string
  slideIndex?: number
}

type PairingCredential = {
  connectionId: string | null
  hash: string
  kind: 'manual_code' | 'ticket'
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const SHA_PATTERN = /^[0-9a-f]{64}$/

function response(body: object, status = 200) {
  return new Response(JSON.stringify(body), {
    headers: {
      'Cache-Control': 'no-store',
      'Content-Type': 'application/json; charset=utf-8',
      'X-Content-Type-Options': 'nosniff',
    },
    status,
  })
}

async function pairingCredential(
  body: BridgeRequest,
  secret: string,
): Promise<PairingCredential | null> {
  if (typeof body.pairingTicket === 'string' && !body.manualCode) {
    const claims = await getPresenterPairingClaims(body.pairingTicket, secret)
    return claims
      ? {
          connectionId: claims.connectionId,
          hash: await sha256Hex(claims.jti),
          kind: 'ticket',
        }
      : null
  }
  if (
    typeof body.manualCode === 'string' &&
    !body.pairingTicket &&
    /^[A-HJ-NP-Z2-9]{8}$/.test(body.manualCode.toUpperCase())
  ) {
    return {
      connectionId:
        typeof body.connectionId === 'string' &&
        UUID_PATTERN.test(body.connectionId)
          ? body.connectionId
          : null,
      hash: await hashPresenterContext(
        body.manualCode.toUpperCase(),
        'manual-code',
        secret,
      ),
      kind: 'manual_code',
    }
  }
  return null
}

Deno.serve(async (request) => {
  if (request.headers.has('Origin') || request.method === 'OPTIONS') {
    return response(
      { ok: false, message: 'Browser requests are not allowed.' },
      403,
    )
  }
  if (request.method !== 'POST') {
    return response({ ok: false, message: 'Method not allowed.' }, 405)
  }
  if (Deno.env.get('PHASE729_POWERPOINT_SYNC_ENABLED') !== 'true') {
    return response(
      { ok: false, message: 'Presenter integration is disabled.' },
      503,
    )
  }

  let body: BridgeRequest
  try {
    body = await readJsonBody<BridgeRequest>(request, 16 * 1024)
  } catch (error) {
    const bodyError = describeJsonBodyError(error)
    return response({ ok: false, message: bodyError.message }, bodyError.status)
  }
  if (!body.action) {
    return response({ ok: false, message: 'Request is incomplete.' }, 400)
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!supabaseUrl || !serviceRoleKey) {
    return response(
      { ok: false, message: 'Presenter service is unavailable.' },
      503,
    )
  }
  const service = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  })
  let secret: string
  try {
    secret = getPresenterTokenSecret()
  } catch {
    return response(
      { ok: false, message: 'Presenter service is unavailable.' },
      503,
    )
  }

  if (body.action === 'inspect' || body.action === 'claim') {
    const credential = await pairingCredential(body, secret)
    if (
      !credential ||
      !body.installationHash ||
      !SHA_PATTERN.test(body.installationHash)
    ) {
      return response(
        { ok: false, message: 'Pairing credential is invalid.' },
        401,
      )
    }
    if (body.action === 'inspect') {
      if (
        !body.pptxFileSha256 ||
        !SHA_PATTERN.test(body.pptxFileSha256) ||
        !body.slideIdOrderSha256 ||
        !SHA_PATTERN.test(body.slideIdOrderSha256) ||
        !Number.isInteger(body.slideCount) ||
        !Number.isInteger(body.hiddenSlideCount) ||
        typeof body.customShowActive !== 'boolean'
      ) {
        return response(
          { ok: false, message: 'Presentation metadata is invalid.' },
          400,
        )
      }
      const { data, error } = await service.rpc(
        'inspect_presenter_connection_v1',
        {
          target_connection_id: credential.connectionId,
          target_credential_hash: credential.hash,
          target_credential_kind: credential.kind,
          target_custom_show_active: body.customShowActive,
          target_hidden_slide_count: body.hiddenSlideCount,
          target_installation_hash: body.installationHash,
          target_pptx_file_sha256: body.pptxFileSha256,
          target_slide_count: body.slideCount,
          target_slide_id_order_sha256: body.slideIdOrderSha256,
        },
      )
      return error || !data
        ? response(
            { ok: false, message: 'Presentation could not be inspected.' },
            409,
          )
        : response({ ...(data as object), ok: true })
    }

    if (!credential.connectionId) {
      return response({ ok: false, message: 'Connection is required.' }, 400)
    }
    const capabilityJtiHash = await sha256Hex(credential.connectionId)
    const { data, error } = await service.rpc('claim_presenter_connection_v1', {
      target_capability_jti_hash: capabilityJtiHash,
      target_connection_id: credential.connectionId,
      target_credential_hash: credential.hash,
      target_credential_kind: credential.kind,
      target_installation_hash: body.installationHash,
    })
    if (error || !data) {
      return response(
        { ok: false, message: 'PowerPoint connection is not ready.' },
        409,
      )
    }
    const claimed = data as unknown as {
      capability_expires_at: string
      connection_id: string
      lecture_session_id: string
      state: string
    }
    const expiresAt = Math.floor(
      new Date(claimed.capability_expires_at).getTime() / 1000,
    )
    const capabilityToken = await createPresenterCapabilityToken({
      connectionId: claimed.connection_id,
      expiresAt,
      installationHash: body.installationHash,
      lectureSessionId: claimed.lecture_session_id,
      secret,
    })
    return response({
      capabilityExpiresAt: claimed.capability_expires_at,
      capabilityToken,
      connectionId: claimed.connection_id,
      lectureSessionId: claimed.lecture_session_id,
      ok: true,
      state: claimed.state,
    })
  }

  if (!body.capabilityToken) {
    return response(
      { ok: false, message: 'Presenter capability is required.' },
      401,
    )
  }
  const capability = await getPresenterCapabilityClaims(
    body.capabilityToken,
    secret,
  )
  if (!capability) {
    return response(
      { ok: false, message: 'Presenter capability is invalid.' },
      401,
    )
  }
  const commonParameters = {
    target_capability_jti_hash: await sha256Hex(capability.jti),
    target_connection_id: capability.connectionId,
    target_installation_hash: capability.installationHash,
  }

  if (body.action === 'disconnect') {
    const { data, error } = await service.rpc(
      'disconnect_presenter_connection_v1',
      commonParameters,
    )
    return error || !data
      ? response({ ok: false, message: 'Presenter disconnect failed.' }, 409)
      : response({ ...(data as object), ok: true })
  }

  if (
    !body.pptxFileSha256 ||
    !SHA_PATTERN.test(body.pptxFileSha256) ||
    !body.slideIdOrderSha256 ||
    !SHA_PATTERN.test(body.slideIdOrderSha256)
  ) {
    return response(
      { ok: false, message: 'Presentation binding is invalid.' },
      400,
    )
  }

  if (body.action === 'heartbeat') {
    const { data, error } = await service.rpc(
      'heartbeat_presenter_connection_v1',
      {
        ...commonParameters,
        target_pptx_file_sha256: body.pptxFileSha256,
        target_slide_id_order_sha256: body.slideIdOrderSha256,
      },
    )
    return error || !data
      ? response(
          { ok: false, message: 'Presenter heartbeat was rejected.' },
          409,
        )
      : response({ ...(data as object), ok: true })
  }

  if (
    body.action !== 'update' ||
    !Number.isSafeInteger(body.sequence) ||
    !body.eventId ||
    !UUID_PATTERN.test(body.eventId) ||
    !Number.isInteger(body.slideId) ||
    !Number.isInteger(body.slideIndex) ||
    !Number.isInteger(body.pdfPage)
  ) {
    return response({ ok: false, message: 'Page update is invalid.' }, 400)
  }
  const { data, error } = await service.rpc('apply_presenter_page_v1', {
    ...commonParameters,
    target_event_id: body.eventId,
    target_pdf_page: body.pdfPage,
    target_pptx_file_sha256: body.pptxFileSha256,
    target_sequence: body.sequence,
    target_slide_id: body.slideId,
    target_slide_id_order_sha256: body.slideIdOrderSha256,
    target_slide_index: body.slideIndex,
  })
  return error || !data
    ? response({ ok: false, message: 'Page update was rejected.' }, 409)
    : response({ ...(data as object), ok: true })
})
