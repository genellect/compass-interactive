import { timingSafeEqual } from './adminToken.ts'

const textEncoder = new TextEncoder()
const SIGNATURE_CONTEXT = 'compass-presenter-session-v1'
const SIGNATURE_PATH = '/functions/v1/presenter-bridge-session'
const ALLOWED_CLOCK_SKEW_SECONDS = 120
const KEY_ID_PATTERN = /^[0-9a-f]{64}$/
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/

export type PresenterRequestProof = {
  bodySha256: string
  issuedAt: string
  keyId: string
  nonceHash: string
  publicKeySpki: string
}

export class PresenterProofError extends Error {
  readonly code:
    'gateway_invalid' | 'proof_invalid' | 'proof_stale' | 'service_unavailable'
  readonly status: number

  constructor(
    code:
      | 'gateway_invalid'
      | 'proof_invalid'
      | 'proof_stale'
      | 'service_unavailable',
    status: number,
  ) {
    super('Presenter request proof could not be verified.')
    this.name = 'PresenterProofError'
    this.code = code
    this.status = status
  }
}

function bytesToHex(value: Uint8Array) {
  return Array.from(value)
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

function decodeBase64Url(value: string, minimum: number, maximum: number) {
  if (
    value.length < minimum ||
    value.length > maximum ||
    !BASE64URL_PATTERN.test(value)
  ) {
    throw new PresenterProofError('proof_invalid', 401)
  }
  try {
    const base64 = value.replaceAll('-', '+').replaceAll('_', '/')
    const padded = base64.padEnd(
      base64.length + ((4 - (base64.length % 4)) % 4),
      '=',
    )
    const binary = atob(padded)
    const bytes = Uint8Array.from(binary, (character) =>
      character.charCodeAt(0),
    )
    if (bytes.byteLength < minimum || bytes.byteLength > maximum) {
      throw new PresenterProofError('proof_invalid', 401)
    }
    return bytes
  } catch (error) {
    if (error instanceof PresenterProofError) throw error
    throw new PresenterProofError('proof_invalid', 401)
  }
}

export async function sha256HexBytes(value: Uint8Array | string) {
  const bytes = typeof value === 'string' ? textEncoder.encode(value) : value
  return bytesToHex(
    new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)),
  )
}

export function getPresenterGatewaySecret() {
  const secret = Deno.env.get('PRESENTER_BRIDGE_GATEWAY_SECRET')
  if (!secret || textEncoder.encode(secret).byteLength < 32) {
    throw new PresenterProofError('service_unavailable', 503)
  }
  return secret
}

export function requirePresenterGateway(request: Request, secret: string) {
  const supplied = request.headers.get('x-compass-presenter-gateway') ?? ''
  if (!timingSafeEqual(supplied, secret)) {
    throw new PresenterProofError('gateway_invalid', 403)
  }
}

export async function verifyPresenterRequestProof(
  request: Request,
  rawBody: Uint8Array,
  now = Date.now(),
): Promise<PresenterRequestProof> {
  const keyId = request.headers.get('x-compass-presenter-key-id')?.trim() ?? ''
  const publicKeySpki =
    request.headers.get('x-compass-presenter-public-key')?.trim() ?? ''
  const timestampText =
    request.headers.get('x-compass-presenter-timestamp')?.trim() ?? ''
  const nonce = request.headers.get('x-compass-presenter-nonce')?.trim() ?? ''
  const signatureText =
    request.headers.get('x-compass-presenter-signature')?.trim() ?? ''

  if (!KEY_ID_PATTERN.test(keyId) || !/^\d{10}$/.test(timestampText)) {
    throw new PresenterProofError('proof_invalid', 401)
  }
  const timestampSeconds = Number(timestampText)
  if (
    !Number.isSafeInteger(timestampSeconds) ||
    Math.abs(Math.floor(now / 1000) - timestampSeconds) >
      ALLOWED_CLOCK_SKEW_SECONDS
  ) {
    throw new PresenterProofError('proof_stale', 401)
  }

  const spkiBytes = decodeBase64Url(publicKeySpki, 80, 256)
  const nonceBytes = decodeBase64Url(nonce, 16, 64)
  const signatureBytes = decodeBase64Url(signatureText, 64, 96)
  if (signatureBytes.byteLength !== 64) {
    throw new PresenterProofError('proof_invalid', 401)
  }
  if ((await sha256HexBytes(spkiBytes)) !== keyId) {
    throw new PresenterProofError('proof_invalid', 401)
  }

  let publicKey: CryptoKey
  try {
    publicKey = await crypto.subtle.importKey(
      'spki',
      spkiBytes,
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['verify'],
    )
  } catch {
    throw new PresenterProofError('proof_invalid', 401)
  }

  const bodySha256 = await sha256HexBytes(rawBody)
  const canonical = [
    'v1',
    'POST',
    SIGNATURE_CONTEXT,
    SIGNATURE_PATH,
    timestampText,
    nonce,
    bodySha256,
  ].join('\n')
  let valid = false
  try {
    valid = await crypto.subtle.verify(
      { hash: 'SHA-256', name: 'ECDSA' },
      publicKey,
      signatureBytes,
      textEncoder.encode(canonical),
    )
  } catch {
    valid = false
  }
  if (!valid) {
    throw new PresenterProofError('proof_invalid', 401)
  }

  return {
    bodySha256,
    issuedAt: new Date(timestampSeconds * 1000).toISOString(),
    keyId,
    nonceHash: await sha256HexBytes(nonceBytes),
    publicKeySpki,
  }
}

export const presenterProofCanonicalForTest = (
  timestamp: string,
  nonce: string,
  bodySha256: string,
) =>
  [
    'v1',
    'POST',
    SIGNATURE_CONTEXT,
    SIGNATURE_PATH,
    timestamp,
    nonce,
    bodySha256,
  ].join('\n')
