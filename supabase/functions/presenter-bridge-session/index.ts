import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.110.0'
import { sha256Hex } from '../_shared/adminToken.ts'
import {
  getPresenterGatewaySecret,
  PresenterProofError,
  requirePresenterGateway,
  verifyPresenterRequestProof,
} from '../_shared/presenterProof.ts'
import {
  describeJsonBodyError,
  readRequestBodyBytes,
} from '../_shared/requestBody.ts'
import {
  createPresenterCapabilityToken,
  getPresenterCapabilityClaims,
  getPresenterPairingClaims,
  getPresenterTokenSecret,
  hashPresenterContext,
  presenterCapabilityJtiFromNonceHash,
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
const RPC_TIMEOUT_MS = 3_500
const TRANSIENT_DATABASE_CODES = new Set([
  '55P03',
  '57014',
  'P7297',
  'PGRST003',
])

function response(
  body: object,
  status = 200,
  headers?: Record<string, string>,
) {
  return new Response(JSON.stringify(body), {
    headers: {
      'Cache-Control': 'no-store',
      'Content-Type': 'application/json; charset=utf-8',
      'X-Content-Type-Options': 'nosniff',
      ...headers,
    },
    status,
  })
}

function errorResponse(
  code: string,
  message: string,
  status: number,
  headers?: Record<string, string>,
) {
  return response({ code, message, ok: false }, status, headers)
}

function getTrustedNetworkIdentifier(request: Request) {
  const hostname = new URL(request.url).hostname
  if (hostname === '127.0.0.1' || hostname === 'localhost') return null
  const candidate =
    request.headers.get('x-compass-presenter-network') ??
    request.headers.get('cf-connecting-ip') ??
    request.headers.get('x-real-ip') ??
    request.headers.get('x-forwarded-for')?.split(',', 1)[0] ??
    ''
  const normalized = candidate.trim().toLowerCase()
  return normalized.length >= 3 && normalized.length <= 64 ? normalized : null
}

function proofSentinel(data: unknown) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null
  const value = data as Record<string, unknown>
  if (value.proof_rate_limited === true) {
    return response(
      {
        code: 'rate_limited',
        ok: false,
        message: 'Presenter request rate limit reached.',
      },
      429,
      { 'Retry-After': '60' },
    )
  }
  if (typeof value.proof_rejected === 'string') {
    return response(
      {
        code: 'replay_rejected',
        ok: false,
        message: 'Presenter request proof was rejected.',
      },
      409,
    )
  }
  if (typeof value.presenter_error === 'string') {
    const error = value.presenter_error
    if (error === 'rate_limited') {
      return response(
        {
          code: error,
          ok: false,
          message: 'Presenter request rate limit reached.',
        },
        429,
        { 'Retry-After': '60' },
      )
    }
    if (error === 'confirmation_pending') {
      return errorResponse(
        error,
        'Teacher confirmation is still required.',
        409,
        { 'Retry-After': '3' },
      )
    }
    const publicCode =
      error === 'expired'
        ? 'connection_expired'
        : error === 'revoked'
          ? 'connection_revoked'
          : 'credential_invalid'
    return errorResponse(
      publicCode,
      'Presenter request was rejected.',
      error === 'expired' || error === 'revoked' ? 410 : 401,
    )
  }
  return null
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
    return errorResponse(
      'browser_forbidden',
      'Browser requests are not allowed.',
      403,
    )
  }
  if (request.method !== 'POST') {
    return errorResponse('method_not_allowed', 'Method not allowed.', 405)
  }
  if (Deno.env.get('PHASE729_POWERPOINT_SYNC_ENABLED') !== 'true') {
    return errorResponse(
      'feature_disabled',
      'Presenter integration is disabled.',
      503,
    )
  }

  let secret: string
  try {
    secret = getPresenterTokenSecret()
    requirePresenterGateway(request, getPresenterGatewaySecret())
  } catch (error) {
    if (
      error instanceof PresenterProofError &&
      error.code === 'gateway_invalid'
    ) {
      return errorResponse(
        'gateway_required',
        'Presenter gateway is required.',
        403,
      )
    }
    return errorResponse(
      'service_unavailable',
      'Presenter service is unavailable.',
      503,
    )
  }

  let rawBody: Uint8Array
  try {
    rawBody = await readRequestBodyBytes(request, 16 * 1024)
  } catch (error) {
    const bodyError = describeJsonBodyError(error)
    return errorResponse('request_invalid', bodyError.message, bodyError.status)
  }

  let proof
  try {
    proof = await verifyPresenterRequestProof(request, rawBody)
  } catch (error) {
    const stale =
      error instanceof PresenterProofError && error.code === 'proof_stale'
    return errorResponse(
      stale ? 'proof_stale' : 'proof_invalid',
      stale
        ? 'Presenter system clock must be corrected.'
        : 'Presenter request proof is invalid.',
      401,
    )
  }

  let body: BridgeRequest
  try {
    const decoded = JSON.parse(new TextDecoder().decode(rawBody)) as unknown
    if (!decoded || typeof decoded !== 'object' || Array.isArray(decoded)) {
      return errorResponse('request_invalid', 'Invalid JSON body.', 400)
    }
    body = decoded as BridgeRequest
  } catch {
    return errorResponse('request_invalid', 'Invalid JSON body.', 400)
  }
  if (!body.action) {
    return errorResponse('request_invalid', 'Request is incomplete.', 400)
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!supabaseUrl || !serviceRoleKey) {
    return errorResponse(
      'service_unavailable',
      'Presenter service is unavailable.',
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
      const code = result.error?.code ?? ''
      return {
        ...result,
        unavailable: TRANSIENT_DATABASE_CODES.has(code),
      }
    } catch {
      return { data: null, error: null, unavailable: true }
    }
  }

  const networkIdentifier = getTrustedNetworkIdentifier(request)
  const [proofKeyBucketHash, networkBucketHash, globalBucketHash] =
    await Promise.all([
      hashPresenterContext(
        proof.keyId,
        'presenter-rate-key',
        secret,
      ),
      networkIdentifier
        ? hashPresenterContext(
            networkIdentifier,
            'presenter-rate-network',
            secret,
          )
        : Promise.resolve(null),
      hashPresenterContext(
        'compass-presenter-machine-endpoint',
        'presenter-rate-global',
        secret,
      ),
    ])
  const proofParameters = {
    target_global_bucket_hash: globalBucketHash,
    target_network_bucket_hash: networkBucketHash,
    target_nonce_hash: proof.nonceHash,
    target_proof_key_bucket_hash:
      body.action === 'inspect' ? null : proofKeyBucketHash,
    target_proof_key_id: proof.keyId,
    target_proof_public_key_spki: proof.publicKeySpki,
    target_request_body_sha256: proof.bodySha256,
    target_request_issued_at: proof.issuedAt,
  }

  if (body.action === 'inspect' || body.action === 'claim') {
    const credential = await pairingCredential(body, secret)
    if (
      !credential ||
      body.installationHash !== proof.keyId ||
      !SHA_PATTERN.test(body.installationHash)
    ) {
      return errorResponse(
        'credential_invalid',
        'Pairing credential is invalid.',
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
        (body.slideCount as number) < 1 ||
        (body.slideCount as number) > 75 ||
        (body.hiddenSlideCount as number) < 0 ||
        (body.hiddenSlideCount as number) > 75 ||
        typeof body.customShowActive !== 'boolean'
      ) {
        return errorResponse(
          'request_invalid',
          'Presentation metadata is invalid.',
          400,
        )
      }
      const { data, error, unavailable } = await rpc(
        'inspect_presenter_connection_v2',
        {
          ...proofParameters,
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
      if (unavailable) {
        return errorResponse(
          'service_unavailable',
          'Presenter service timed out.',
          504,
        )
      }
      const sentinel = proofSentinel(data)
      if (sentinel) return sentinel
      return error || !data
        ? errorResponse(
            'operation_rejected',
            'Presentation could not be inspected.',
            409,
          )
        : response({ ...(data as object), ok: true })
    }

    if (!credential.connectionId) {
      return errorResponse('request_invalid', 'Connection is required.', 400)
    }
    const capabilityJti = presenterCapabilityJtiFromNonceHash(proof.nonceHash)
    const capabilityJtiHash = await sha256Hex(capabilityJti)
    const { data, error, unavailable } = await rpc(
      'claim_presenter_connection_v2',
      {
        ...proofParameters,
        target_capability_jti_hash: capabilityJtiHash,
        target_connection_id: credential.connectionId,
        target_credential_hash: credential.hash,
        target_credential_kind: credential.kind,
        target_installation_hash: body.installationHash,
      },
    )
    if (unavailable) {
      return errorResponse(
        'service_unavailable',
        'Presenter service timed out.',
        504,
      )
    }
    const sentinel = proofSentinel(data)
    if (sentinel) return sentinel
    if (error || !data) {
      return errorResponse(
        'operation_rejected',
        'PowerPoint connection is not ready.',
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
      installationHash: proof.keyId,
      jti: capabilityJti,
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
    return errorResponse(
      'credential_invalid',
      'Presenter capability is required.',
      401,
    )
  }
  const capability = await getPresenterCapabilityClaims(
    body.capabilityToken,
    secret,
  )
  if (!capability || capability.installationHash !== proof.keyId) {
    return errorResponse(
      'credential_invalid',
      'Presenter capability is invalid.',
      401,
    )
  }
  const commonParameters = {
    ...proofParameters,
    target_capability_jti_hash: await sha256Hex(capability.jti),
    target_connection_id: capability.connectionId,
    target_installation_hash: capability.installationHash,
  }

  if (body.action === 'disconnect') {
    const { data, error, unavailable } = await rpc(
      'disconnect_presenter_connection_v2',
      commonParameters,
    )
    if (unavailable) {
      return errorResponse(
        'service_unavailable',
        'Presenter service timed out.',
        504,
      )
    }
    const sentinel = proofSentinel(data)
    if (sentinel) return sentinel
    return error || !data
      ? errorResponse(
          'operation_rejected',
          'Presenter disconnect failed.',
          409,
        )
      : response({ ...(data as object), ok: true })
  }

  if (
    !body.pptxFileSha256 ||
    !SHA_PATTERN.test(body.pptxFileSha256) ||
    !body.slideIdOrderSha256 ||
    !SHA_PATTERN.test(body.slideIdOrderSha256)
  ) {
    return errorResponse(
      'request_invalid',
      'Presentation binding is invalid.',
      400,
    )
  }

  if (body.action === 'heartbeat') {
    const { data, error, unavailable } = await rpc(
      'heartbeat_presenter_connection_v2',
      {
        ...commonParameters,
        target_pptx_file_sha256: body.pptxFileSha256,
        target_slide_id_order_sha256: body.slideIdOrderSha256,
      },
    )
    if (unavailable) {
      return errorResponse(
        'service_unavailable',
        'Presenter service timed out.',
        504,
      )
    }
    const sentinel = proofSentinel(data)
    if (sentinel) return sentinel
    return error || !data
      ? errorResponse(
          'operation_rejected',
          'Presenter heartbeat was rejected.',
          409,
        )
      : response({ ...(data as object), ok: true })
  }

  if (
    body.action !== 'update' ||
    !Number.isSafeInteger(body.sequence) ||
    (body.sequence as number) < 0 ||
    !body.eventId ||
    !UUID_PATTERN.test(body.eventId) ||
    !Number.isInteger(body.slideId) ||
    (body.slideId as number) <= 0 ||
    !Number.isInteger(body.slideIndex) ||
    (body.slideIndex as number) < 1 ||
    (body.slideIndex as number) > 75 ||
    !Number.isInteger(body.pdfPage) ||
    (body.pdfPage as number) < 1 ||
    (body.pdfPage as number) > 75 ||
    body.pdfPage !== body.slideIndex
  ) {
    return errorResponse('request_invalid', 'Page update is invalid.', 400)
  }
  const { data, error, unavailable } = await rpc('apply_presenter_page_v2', {
    ...commonParameters,
    target_event_id: body.eventId,
    target_pdf_page: body.pdfPage,
    target_pptx_file_sha256: body.pptxFileSha256,
    target_sequence: body.sequence,
    target_slide_id: body.slideId,
    target_slide_id_order_sha256: body.slideIdOrderSha256,
    target_slide_index: body.slideIndex,
  })
  if (unavailable) {
    return errorResponse(
      'service_unavailable',
      'Presenter service timed out.',
      504,
    )
  }
  const sentinel = proofSentinel(data)
  if (sentinel) return sentinel
  return error || !data
    ? errorResponse('operation_rejected', 'Page update was rejected.', 409)
    : response({ ...(data as object), ok: true })
})
