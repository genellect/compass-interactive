function base64Url(bytes: Uint8Array) {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '')
}

function encodeJson(value: unknown) {
  return base64Url(new TextEncoder().encode(JSON.stringify(value)))
}

export type PdfAccessClaims = {
  accessUntil?: number
  accessVersion: number
  audience: string
  expiresAt: number
  issuedAt: number
  issuer: string
  keyId: string
  lecturePublicId: string
  manifestVersion: number
  notBefore: number
}

export async function signPdfAccessToken(claims: PdfAccessClaims) {
  const privateJwkValue = Deno.env.get('PDF_ACCESS_PRIVATE_JWK')
  if (!privateJwkValue)
    throw new Error('PDF access signing key is not configured.')
  let privateJwk: JsonWebKey
  try {
    privateJwk = JSON.parse(privateJwkValue) as JsonWebKey
  } catch {
    throw new Error('PDF access signing key is invalid.')
  }
  if (
    privateJwk.kty !== 'EC' ||
    privateJwk.crv !== 'P-256' ||
    typeof privateJwk.d !== 'string'
  ) {
    throw new Error('PDF access signing key must be a private P-256 JWK.')
  }
  const key = await crypto.subtle.importKey(
    'jwk',
    privateJwk,
    { hash: 'SHA-256', name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign'],
  )
  const header = encodeJson({ alg: 'ES256', kid: claims.keyId, typ: 'JWT' })
  const payload = encodeJson({
    ...(claims.accessUntil ? { access_until: claims.accessUntil } : {}),
    aud: claims.audience,
    av: claims.accessVersion,
    exp: claims.expiresAt,
    iat: claims.issuedAt,
    iss: claims.issuer,
    jti: crypto.randomUUID(),
    lec: claims.lecturePublicId,
    mv: claims.manifestVersion,
    nbf: claims.notBefore,
  })
  const signature = await crypto.subtle.sign(
    { hash: 'SHA-256', name: 'ECDSA' },
    key,
    new TextEncoder().encode(`${header}.${payload}`),
  )
  return `${header}.${payload}.${base64Url(new Uint8Array(signature))}`
}
