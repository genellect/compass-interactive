import { timingSafeEqual } from './adminToken.ts'

export const AI_FEATURES = [
  'captions',
  'summaries',
  'material_analysis',
  'poll_suggestions',
  'academic_answers',
] as const

export type AiFeature = (typeof AI_FEATURES)[number]

const textEncoder = new TextEncoder()

function bytesToHex(bytes: Uint8Array) {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

function bytesToBase64Url(bytes: Uint8Array) {
  let binary = ''
  for (const byte of bytes) {
    binary += String.fromCharCode(byte)
  }
  return btoa(binary)
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll('=', '')
}

function assertUuid(value: string, label: string) {
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    )
  ) {
    throw new Error(`${label} is invalid.`)
  }
  return value.toLowerCase()
}

function getGoogleAiChildGrantKeyVersion() {
  const raw = Deno.env.get('ADMIN_AI_CHILD_GRANT_SECRET_VERSION')?.trim() ?? '1'
  const value = Number(raw)
  if (!Number.isSafeInteger(value) || value < 1 || value > 2_147_483_647) {
    throw new Error('Google AI child authorization key version is invalid.')
  }
  return value
}

function getGoogleAiChildGrantSecret() {
  const value = Deno.env.get('ADMIN_AI_CHILD_GRANT_SECRET')?.trim() ?? ''
  if (textEncoder.encode(value).byteLength < 32 || value.length > 4096) {
    throw new Error('Google AI child authorization is not configured.')
  }
  return value
}

export async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    textEncoder.encode(value),
  )
  return bytesToHex(new Uint8Array(digest))
}

export function normalizeAiFeatures(value: unknown): AiFeature[] {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.length > AI_FEATURES.length
  ) {
    throw new Error('One or more valid AI actions are required.')
  }

  const unique = new Set<AiFeature>()
  for (const item of value) {
    if (typeof item !== 'string' || !AI_FEATURES.includes(item as AiFeature)) {
      throw new Error('Invalid AI action.')
    }
    unique.add(item as AiFeature)
  }
  return [...unique].sort()
}

export function createBillingGrantNonce() {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  return bytesToBase64Url(bytes)
}

/**
 * Recreates one raw nonce for a single Google Admin provider attempt. The
 * database stores only its SHA-256 hash and the version. A lost HTTP response
 * can therefore converge on the same short-lived child without persisting or
 * returning server secrets.
 */
export async function deriveGoogleAiChildGrantNonce(input: {
  feature: AiFeature
  lectureSessionId: string
  requestId: string
}) {
  const feature = normalizeAiFeatures([input.feature])[0]
  const lectureSessionId = assertUuid(input.lectureSessionId, 'Lecture ID')
  const requestId = assertUuid(input.requestId, 'AI authorization request ID')
  const keyVersion = getGoogleAiChildGrantKeyVersion()
  const key = await crypto.subtle.importKey(
    'raw',
    textEncoder.encode(getGoogleAiChildGrantSecret()),
    { hash: 'SHA-256', name: 'HMAC' },
    false,
    ['sign'],
  )
  const signature = await crypto.subtle.sign(
    'HMAC',
    key,
    textEncoder.encode(
      `compass:phase7.30c2:google-ai-child-nonce:v1|version=${keyVersion}|request=${requestId}|lecture=${lectureSessionId}|feature=${feature}`,
    ),
  )
  return {
    keyVersion,
    nonce: bytesToBase64Url(new Uint8Array(signature)),
  }
}

/**
 * Recreates the browser-facing summary-run credential for one request. The
 * action is part of the domain so a start request can never be replayed as a
 * resume. Only its SHA-256 hash crosses the database boundary.
 */
export async function deriveGoogleSummaryRunNonce(input: {
  action: 'start' | 'resume'
  lectureSessionId: string
  requestId: string
}) {
  const lectureSessionId = assertUuid(input.lectureSessionId, 'Lecture ID')
  const requestId = assertUuid(input.requestId, 'Summary request ID')
  const keyVersion = getGoogleAiChildGrantKeyVersion()
  const key = await crypto.subtle.importKey(
    'raw',
    textEncoder.encode(getGoogleAiChildGrantSecret()),
    { hash: 'SHA-256', name: 'HMAC' },
    false,
    ['sign'],
  )
  const signature = await crypto.subtle.sign(
    'HMAC',
    key,
    textEncoder.encode(
      `compass:phase7.30c2:google-summary-run-nonce:v1|version=${keyVersion}|request=${requestId}|lecture=${lectureSessionId}|action=${input.action}`,
    ),
  )
  return bytesToBase64Url(new Uint8Array(signature))
}

export function formatBillingGrantToken(grantId: string, nonce: string) {
  return `${grantId}.${nonce}`
}

export function parseBillingGrantToken(token: string) {
  const [grantId, nonce, extra] = token.split('.')
  if (
    !grantId ||
    !nonce ||
    extra ||
    !/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(grantId) ||
    !/^[A-Za-z0-9_-]{40,60}$/.test(nonce)
  ) {
    throw new Error('Invalid billing authorization.')
  }
  return { grantId, nonce }
}

export async function verifyBillingPin(candidate: string, expected: string) {
  if (candidate.length > 128 || expected.length < 6 || expected.length > 128) {
    return false
  }
  const [candidateHash, expectedHash] = await Promise.all([
    sha256Hex(candidate),
    sha256Hex(expected),
  ])
  return timingSafeEqual(candidateHash, expectedHash)
}
