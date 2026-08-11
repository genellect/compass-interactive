const encoder = new TextEncoder()

export type PdfPublicationTicketClaims = {
  adminSessionId: string
  bytes: number
  doc: string
  download?: boolean
  expiresAt: number
  generation: number
  issuedAt: number
  jti: string
  lecturePublicId: string
  name?: string
  nonce?: string
  origin: string
  pages?: number
  previousAccessVersion?: number
  publicationId: string
  purpose: 'activate' | 'commit' | 'rollback' | 'status' | 'upload'
  sha256: string
  targetAccessVersion?: number
  textCharacters?: number
  textSha256?: string
}

function base64Url(bytes: Uint8Array) {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll('=', '')
}

function uuidFromBytes(bytes: Uint8Array) {
  const value = bytes.slice(0, 16)
  value[6] = (value[6] & 0x0f) | 0x40
  value[8] = (value[8] & 0x3f) | 0x80
  const hex = Array.from(value, (byte) => byte.toString(16).padStart(2, '0'))
  return [
    hex.slice(0, 4).join(''),
    hex.slice(4, 6).join(''),
    hex.slice(6, 8).join(''),
    hex.slice(8, 10).join(''),
    hex.slice(10, 16).join(''),
  ].join('-')
}

function assertRequestId(value: string) {
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    )
  ) {
    throw new Error('PDF publication request ID is invalid.')
  }
  return value.toLowerCase()
}

function coordinatorSecret() {
  const value = Deno.env.get('PDF_PUBLICATION_COORDINATOR_SECRET')?.trim() ?? ''
  if (value.length < 32 || value.length > 4096) {
    throw new Error('PDF publication coordinator secret is not configured.')
  }
  return value
}

async function hmacPublicationMaterial(requestId: string, purpose: string) {
  if (!/^[a-z][a-z0-9-]{0,63}$/.test(purpose)) {
    throw new Error('PDF publication derivation purpose is invalid.')
  }
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(coordinatorSecret()),
    { hash: 'SHA-256', name: 'HMAC' },
    false,
    ['sign'],
  )
  const signature = await crypto.subtle.sign(
    'HMAC',
    key,
    encoder.encode(
      `phase730c2:pdf-publication-output:v1|request=${assertRequestId(requestId)}|purpose=${purpose}`,
    ),
  )
  return new Uint8Array(signature)
}

function encodeJson(value: unknown) {
  return base64Url(encoder.encode(JSON.stringify(value)))
}

function getPrivateJwk() {
  const value = Deno.env.get('PDF_PUBLICATION_PRIVATE_JWK')
  if (!value) throw new Error('PDF publication signing key is not configured.')
  try {
    const key = JSON.parse(value) as JsonWebKey
    if (
      key.kty !== 'EC' ||
      key.crv !== 'P-256' ||
      typeof key.d !== 'string' ||
      typeof key.x !== 'string' ||
      typeof key.y !== 'string'
    ) {
      throw new Error('invalid')
    }
    return key
  } catch {
    throw new Error('PDF publication signing key is invalid.')
  }
}

export async function signPdfPublicationTicket(
  claims: PdfPublicationTicketClaims,
) {
  const key = await crypto.subtle.importKey(
    'jwk',
    getPrivateJwk(),
    { hash: 'SHA-256', name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign'],
  )
  const header = encodeJson({ alg: 'ES256', typ: 'JWT' })
  const payload = encodeJson({
    aud: 'compass-pdf-publication-worker',
    bytes: claims.bytes,
    doc: claims.doc,
    ...(claims.download === undefined ? {} : { download: claims.download }),
    exp: claims.expiresAt,
    gen: claims.generation,
    iat: claims.issuedAt,
    iss: 'compass-supabase',
    jti: claims.jti,
    lec: claims.lecturePublicId,
    ...(claims.name === undefined ? {} : { name: claims.name }),
    nbf: claims.issuedAt - 5,
    ...(claims.nonce === undefined ? {} : { nonce: claims.nonce }),
    origin: claims.origin,
    ...(claims.pages === undefined ? {} : { pages: claims.pages }),
    ...(claims.previousAccessVersion === undefined
      ? {}
      : { previous_av: claims.previousAccessVersion }),
    pub: claims.publicationId,
    purpose: claims.purpose,
    sha: claims.sha256,
    sid: claims.adminSessionId,
    ...(claims.targetAccessVersion === undefined
      ? {}
      : { target_av: claims.targetAccessVersion }),
    ...(claims.textCharacters === undefined
      ? {}
      : { text_chars: claims.textCharacters }),
    ...(claims.textSha256 === undefined ? {} : { text_sha: claims.textSha256 }),
  })
  const signature = await crypto.subtle.sign(
    { hash: 'SHA-256', name: 'ECDSA' },
    key,
    encoder.encode(`${header}.${payload}`),
  )
  return `${header}.${payload}.${base64Url(new Uint8Array(signature))}`
}

export function createPdfPublicationNonce() {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return base64Url(bytes)
}

/**
 * Recreates the same raw upload nonce for one server-authorized ticket request.
 * Only the hash is persisted. Rotating the coordinator secret intentionally
 * requires an explicit ticket reissue instead of silently changing a retry.
 */
export async function derivePdfPublicationNonce(ticketRequestId: string) {
  return base64Url(
    await hmacPublicationMaterial(ticketRequestId, 'upload-nonce'),
  )
}

/** Produces a deterministic UUID-shaped identifier for a bounded saga stage. */
export async function derivePdfPublicationUuid(
  requestId: string,
  purpose: string,
) {
  return uuidFromBytes(await hmacPublicationMaterial(requestId, purpose))
}

export async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(value))
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}
