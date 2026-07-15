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
