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

export type ArchiveAccessClaims = {
  exp: number
  iat: number
  jti: string
  lec: string
  lookup: string
  rev: string
}

export type LectureResumeClaims = {
  aud: 'compass-lecture-resume'
  exp: number
  iat: number
  jti: string
  lec: string
  ver: number
}

export type PdfPublicationClaims = {
  aud: 'compass-pdf-publication-worker'
  bytes: number
  doc: string
  download?: boolean
  exp: number
  gen: number
  iat: number
  iss: 'compass-supabase'
  jti: string
  lec: string
  name?: string
  nbf: number
  nonce?: string
  origin: string
  pages?: number
  previous_av?: number
  pub: string
  purpose: 'activate' | 'commit' | 'rollback' | 'status' | 'upload'
  sha: string
  sid: string
  target_av?: number
  text_chars?: number
  text_sha?: string
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

export async function verifyPdfPublicationToken(input: {
  nowSeconds: number
  publicJwk: JsonWebKey
  token: string
}) {
  const parts = input.token.split('.')
  if (parts.length !== 3) throw new Error('Publication token is malformed.')
  const [encodedHeader, encodedPayload, encodedSignature] = parts
  const header = decodeJson(encodedHeader!)
  const payload = decodeJson(encodedPayload!)
  if (header.alg !== 'ES256' || header.typ !== 'JWT') {
    throw new Error('Publication token algorithm is invalid.')
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
  if (!valid) throw new Error('Publication token signature is invalid.')
  if (
    payload.iss !== 'compass-supabase' ||
    payload.aud !== 'compass-pdf-publication-worker' ||
    !['activate', 'commit', 'rollback', 'status', 'upload'].includes(
      String(payload.purpose),
    ) ||
    typeof payload.pub !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      payload.pub,
    ) ||
    typeof payload.sid !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      payload.sid,
    ) ||
    typeof payload.lec !== 'string' ||
    !LECTURE_PUBLIC_ID_PATTERN.test(payload.lec) ||
    typeof payload.doc !== 'string' ||
    !/^[a-z0-9][a-z0-9-]{0,63}$/.test(payload.doc) ||
    typeof payload.sha !== 'string' ||
    !/^[0-9a-f]{64}$/.test(payload.sha) ||
    !Number.isSafeInteger(payload.bytes) ||
    Number(payload.bytes) < 1 ||
    Number(payload.bytes) > 15 * 1024 * 1024 ||
    !Number.isSafeInteger(payload.gen) ||
    Number(payload.gen) < 1 ||
    typeof payload.origin !== 'string' ||
    !/^https?:\/\/[^/]+$/.test(payload.origin) ||
    !Number.isInteger(payload.exp) ||
    Number(payload.exp) <= input.nowSeconds ||
    Number(payload.exp) > input.nowSeconds + 10 * 60 + 30 ||
    !Number.isInteger(payload.nbf) ||
    Number(payload.nbf) > input.nowSeconds + 30 ||
    !Number.isInteger(payload.iat) ||
    Number(payload.iat) > input.nowSeconds + 30 ||
    typeof payload.jti !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      payload.jti,
    )
  ) {
    throw new Error('Publication token claims are invalid or expired.')
  }
  if (
    payload.purpose === 'upload' &&
    (typeof payload.nonce !== 'string' ||
      !/^[A-Za-z0-9_-]{32,128}$/.test(payload.nonce))
  ) {
    throw new Error('Publication upload nonce is invalid.')
  }
  if (
    payload.purpose === 'commit' &&
    (typeof payload.name !== 'string' ||
      payload.name.trim().length < 1 ||
      payload.name.length > 160 ||
      !Number.isInteger(payload.pages) ||
      Number(payload.pages) < 1 ||
      Number(payload.pages) > 75 ||
      !Number.isInteger(payload.text_chars) ||
      Number(payload.text_chars) < 1 ||
      Number(payload.text_chars) > 20_000 ||
      typeof payload.text_sha !== 'string' ||
      !/^[0-9a-f]{64}$/.test(payload.text_sha) ||
      typeof payload.download !== 'boolean' ||
      !Number.isInteger(payload.previous_av) ||
      Number(payload.previous_av) < 1 ||
      payload.target_av !== undefined)
  ) {
    throw new Error('Publication commit claims are invalid.')
  }
  if (
    (payload.purpose === 'activate' || payload.purpose === 'rollback') &&
    (!Number.isInteger(payload.previous_av) ||
      Number(payload.previous_av) < 1 ||
      !Number.isInteger(payload.target_av) ||
      Number(payload.target_av) !== Number(payload.previous_av) + 1)
  ) {
    throw new Error('Publication rollback claims are invalid.')
  }
  return payload as PdfPublicationClaims
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

async function importArchiveKey(secret: string, usage: 'sign' | 'verify') {
  if (new TextEncoder().encode(secret).byteLength < 32) {
    throw new Error('Archive secret must contain at least 32 bytes.')
  }
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { hash: 'SHA-256', name: 'HMAC' },
    false,
    [usage],
  )
}

function bytesToHex(bytes: Uint8Array) {
  return Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

export async function createArchiveLookupHash(
  lectureCode: string,
  secret: string,
) {
  const normalizedCode = lectureCode.trim().toUpperCase()
  if (
    normalizedCode.length < 4 ||
    normalizedCode.length > 32 ||
    !/^[A-Z0-9-]+$/.test(normalizedCode)
  ) {
    throw new Error('Lecture code is invalid.')
  }
  const signature = await crypto.subtle.sign(
    'HMAC',
    await importArchiveKey(secret, 'sign'),
    new TextEncoder().encode(`compass-archive-code:v1:${normalizedCode}`),
  )
  return bytesToHex(new Uint8Array(signature))
}

export async function signArchiveAccessToken(
  claims: ArchiveAccessClaims,
  secret: string,
) {
  const encodedPayload = bytesToBase64Url(
    new TextEncoder().encode(JSON.stringify(claims)),
  )
  const signature = await crypto.subtle.sign(
    'HMAC',
    await importArchiveKey(secret, 'sign'),
    new TextEncoder().encode(encodedPayload),
  )
  return `${encodedPayload}.${bytesToBase64Url(new Uint8Array(signature))}`
}

export async function verifyArchiveAccessToken(input: {
  nowSeconds: number
  secret: string
  token: string
}) {
  const parts = input.token.split('.')
  if (parts.length !== 2) throw new Error('Archive token is malformed.')
  const [encodedPayload, encodedSignature] = parts
  const valid = await crypto.subtle.verify(
    'HMAC',
    await importArchiveKey(input.secret, 'verify'),
    base64UrlToBytes(encodedSignature!),
    new TextEncoder().encode(encodedPayload!),
  )
  if (!valid) throw new Error('Archive token signature is invalid.')
  const payload = decodeJson(encodedPayload!)
  if (
    typeof payload.lookup !== 'string' ||
    !/^[0-9a-f]{64}$/.test(payload.lookup) ||
    typeof payload.lec !== 'string' ||
    !LECTURE_PUBLIC_ID_PATTERN.test(payload.lec) ||
    typeof payload.rev !== 'string' ||
    !/^[0-9a-f]{64}$/.test(payload.rev) ||
    !Number.isInteger(payload.iat) ||
    Number(payload.iat) > input.nowSeconds + 30 ||
    !Number.isInteger(payload.exp) ||
    Number(payload.exp) <= input.nowSeconds ||
    Number(payload.exp) > input.nowSeconds + 15 * 60 + 30 ||
    typeof payload.jti !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      payload.jti,
    )
  ) {
    throw new Error('Archive token claims are invalid or expired.')
  }
  return payload as ArchiveAccessClaims
}

export async function verifyLectureResumeToken(input: {
  nowSeconds: number
  secret: string
  token: string
}) {
  const parts = input.token.split('.')
  if (parts.length !== 2) throw new Error('Resume token is malformed.')
  const [encodedPayload, encodedSignature] = parts
  const valid = await crypto.subtle.verify(
    'HMAC',
    await importArchiveKey(input.secret, 'verify'),
    base64UrlToBytes(encodedSignature!),
    new TextEncoder().encode(encodedPayload!),
  )
  if (!valid) throw new Error('Resume token signature is invalid.')
  const payload = decodeJson(encodedPayload!)
  if (
    payload.aud !== 'compass-lecture-resume' ||
    typeof payload.lec !== 'string' ||
    !LECTURE_PUBLIC_ID_PATTERN.test(payload.lec) ||
    !Number.isInteger(payload.ver) ||
    Number(payload.ver) < 1 ||
    !Number.isInteger(payload.iat) ||
    Number(payload.iat) > input.nowSeconds + 30 ||
    Number(payload.iat) < input.nowSeconds - 7 * 24 * 60 * 60 - 30 ||
    !Number.isInteger(payload.exp) ||
    Number(payload.exp) <= input.nowSeconds ||
    Number(payload.exp) > Number(payload.iat) + 7 * 24 * 60 * 60 + 30 ||
    typeof payload.jti !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      payload.jti,
    )
  ) {
    throw new Error('Resume token claims are invalid or expired.')
  }
  return payload as LectureResumeClaims
}

export async function signLectureResumeToken(
  claims: LectureResumeClaims,
  secret: string,
) {
  const encodedPayload = bytesToBase64Url(
    new TextEncoder().encode(JSON.stringify(claims)),
  )
  const signature = await crypto.subtle.sign(
    'HMAC',
    await importArchiveKey(secret, 'sign'),
    new TextEncoder().encode(encodedPayload),
  )
  return `${encodedPayload}.${bytesToBase64Url(new Uint8Array(signature))}`
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
