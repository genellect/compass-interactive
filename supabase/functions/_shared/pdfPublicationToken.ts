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
    ...(claims.download === undefined
      ? {}
      : { download: claims.download }),
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
    ...(claims.textSha256 === undefined
      ? {}
      : { text_sha: claims.textSha256 }),
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

export async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(value))
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}
