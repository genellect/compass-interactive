import { LECTURE_PUBLIC_ID_PATTERN } from '../../../publisher/src/constants.ts'

export type LectureAccessClaims = {
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

export type AssetTicketClaims = {
  av: number
  doc: string
  exp: number
  jti: string
  lec: string
  mode: 'download' | 'inline'
  ver: string
}

function bytesToBase64Url(bytes: Uint8Array) {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '')
}

function base64UrlToBytes(value: string) {
  const padded = value
    .replace(/-/g, '+')
    .replace(/_/g, '/')
    .padEnd(Math.ceil(value.length / 4) * 4, '=')
  const binary = atob(padded)
  return Uint8Array.from(binary, (character) => character.charCodeAt(0))
}

function decodeJson(value: string): Record<string, unknown> {
  try {
    return JSON.parse(
      new TextDecoder().decode(base64UrlToBytes(value)),
    ) as Record<string, unknown>
  } catch {
    throw new Error('Token is malformed.')
  }
}

export async function verifyLectureToken(input: {
  audience: string
  issuer: string
  nowSeconds: number
  publicJwk: JsonWebKey
  token: string
}) {
  const parts = input.token.split('.')
  if (parts.length !== 3) throw new Error('Token is malformed.')
  const [encodedHeader, encodedPayload, encodedSignature] = parts
  const header = decodeJson(encodedHeader!)
  const payload = decodeJson(encodedPayload!)
  if (header.alg !== 'ES256' || header.typ !== 'JWT') {
    throw new Error('Token algorithm is invalid.')
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
    base64UrlToBytes(encodedSignature!),
    new TextEncoder().encode(`${encodedHeader}.${encodedPayload}`),
  )
  if (!valid) throw new Error('Token signature is invalid.')
  if (
    payload.iss !== input.issuer ||
    payload.aud !== input.audience ||
    typeof payload.lec !== 'string' ||
    !LECTURE_PUBLIC_ID_PATTERN.test(payload.lec) ||
    !Number.isInteger(payload.exp) ||
    Number(payload.exp) <= input.nowSeconds ||
    !Number.isInteger(payload.nbf) ||
    Number(payload.nbf) > input.nowSeconds + 30 ||
    !Number.isInteger(payload.iat) ||
    Number(payload.iat) > input.nowSeconds + 30 ||
    !Number.isInteger(payload.av) ||
    Number(payload.av) < 1 ||
    !Number.isInteger(payload.mv) ||
    Number(payload.mv) < 0 ||
    typeof payload.jti !== 'string' ||
    (payload.access_until !== undefined &&
      (!Number.isInteger(payload.access_until) ||
        Number(payload.access_until) <= input.nowSeconds))
  ) {
    throw new Error('Token claims are invalid or expired.')
  }
  return payload as LectureAccessClaims
}

async function importTicketKey(secret: string, usage: 'sign' | 'verify') {
  if (new TextEncoder().encode(secret).byteLength < 32) {
    throw new Error('Asset ticket secret must contain at least 32 bytes.')
  }
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { hash: 'SHA-256', name: 'HMAC' },
    false,
    [usage],
  )
}

export async function signAssetTicket(
  claims: AssetTicketClaims,
  secret: string,
) {
  const encodedPayload = bytesToBase64Url(
    new TextEncoder().encode(JSON.stringify(claims)),
  )
  const signature = await crypto.subtle.sign(
    'HMAC',
    await importTicketKey(secret, 'sign'),
    new TextEncoder().encode(encodedPayload),
  )
  return `${encodedPayload}.${bytesToBase64Url(new Uint8Array(signature))}`
}

export async function verifyAssetTicket(input: {
  nowSeconds: number
  secret: string
  ticket: string
}) {
  const parts = input.ticket.split('.')
  if (parts.length !== 2) throw new Error('Asset ticket is malformed.')
  const [encodedPayload, encodedSignature] = parts
  const valid = await crypto.subtle.verify(
    'HMAC',
    await importTicketKey(input.secret, 'verify'),
    base64UrlToBytes(encodedSignature!),
    new TextEncoder().encode(encodedPayload!),
  )
  if (!valid) throw new Error('Asset ticket signature is invalid.')
  const payload = decodeJson(encodedPayload!)
  if (
    typeof payload.lec !== 'string' ||
    typeof payload.doc !== 'string' ||
    typeof payload.ver !== 'string' ||
    !Number.isInteger(payload.av) ||
    Number(payload.av) < 1 ||
    !Number.isInteger(payload.exp) ||
    Number(payload.exp) <= input.nowSeconds ||
    Number(payload.exp) > input.nowSeconds + 5 * 60 + 30 ||
    !['inline', 'download'].includes(String(payload.mode)) ||
    typeof payload.jti !== 'string'
  ) {
    throw new Error('Asset ticket claims are invalid or expired.')
  }
  return payload as AssetTicketClaims
}
