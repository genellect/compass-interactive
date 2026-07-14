import { LECTURE_PUBLIC_ID_PATTERN } from '../constants.ts'

type LectureAccessClaims = {
  access_until?: number
  aud: string
  av: number
  exp: number
  iat: number
  iss: string
  jti: string
  lec: string
  mv: number
  nbf: number
}

function decodeBase64Url(value: string) {
  return Uint8Array.from(Buffer.from(value, 'base64url'))
}

function decodeJson(value: string): Record<string, unknown> {
  try {
    return JSON.parse(
      Buffer.from(value, 'base64url').toString('utf8'),
    ) as Record<string, unknown>
  } catch {
    throw new Error('Lecture access token is malformed.')
  }
}

export async function verifyLectureAccessToken(input: {
  audience: string
  issuer: string
  lecturePublicId: string
  now?: Date
  publicJwk: JsonWebKey
  token: string
}): Promise<LectureAccessClaims> {
  const parts = input.token.split('.')
  if (parts.length !== 3) throw new Error('Lecture access token is malformed.')
  const [encodedHeader, encodedPayload, encodedSignature] = parts
  const header = decodeJson(encodedHeader!)
  const payload = decodeJson(encodedPayload!)
  if (header.alg !== 'ES256' || header.typ !== 'JWT') {
    throw new Error('Lecture access token algorithm is invalid.')
  }

  const key = await crypto.subtle.importKey(
    'jwk',
    input.publicJwk,
    { hash: 'SHA-256', name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['verify'],
  )
  const valid = await crypto.subtle.verify(
    { hash: 'SHA-256', name: 'ECDSA' },
    key,
    decodeBase64Url(encodedSignature!),
    new TextEncoder().encode(`${encodedHeader}.${encodedPayload}`),
  )
  if (!valid) throw new Error('Lecture access token signature is invalid.')

  const nowSeconds = Math.floor((input.now?.getTime() ?? Date.now()) / 1000)
  if (
    payload.iss !== input.issuer ||
    payload.aud !== input.audience ||
    payload.lec !== input.lecturePublicId ||
    !LECTURE_PUBLIC_ID_PATTERN.test(String(payload.lec)) ||
    !Number.isInteger(payload.exp) ||
    Number(payload.exp) <= nowSeconds ||
    !Number.isInteger(payload.nbf) ||
    Number(payload.nbf) > nowSeconds + 30 ||
    !Number.isInteger(payload.iat) ||
    Number(payload.iat) > nowSeconds + 30 ||
    !Number.isInteger(payload.av) ||
    Number(payload.av) < 1 ||
    !Number.isInteger(payload.mv) ||
    Number(payload.mv) < 0 ||
    typeof payload.jti !== 'string' ||
    payload.jti.length < 16 ||
    (payload.access_until !== undefined &&
      (!Number.isInteger(payload.access_until) ||
        Number(payload.access_until) <= nowSeconds))
  ) {
    throw new Error('Lecture access token claims are invalid or expired.')
  }

  return payload as LectureAccessClaims
}
