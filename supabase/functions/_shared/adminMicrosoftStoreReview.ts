const encoder = new TextEncoder()

const CONTRACT_PREFIX = 'msr1'
const CONTRACT_PATTERN = /^msr1\.([0-9]{1,12})\.([A-Za-z0-9_-]{43})$/
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const SHA256_HEX_PATTERN = /^[0-9a-f]{64}$/
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export const MICROSOFT_STORE_REVIEW_PURPOSE = 'microsoftStoreReview' as const
export const MICROSOFT_STORE_REVIEW_INVITATION_SECONDS = 7 * 24 * 60 * 60
export const MICROSOFT_STORE_REVIEW_MEMBERSHIP_SECONDS = 14 * 24 * 60 * 60

export type MicrosoftStoreReviewRequest = {
  normalizedEmail: string
  purpose: typeof MICROSOFT_STORE_REVIEW_PURPOSE
}

export type MicrosoftStoreReviewTerms = {
  canUseAi: false
  expiresAt: string
  issuedAt: string
  membershipExpiresAt: string
  role: 'instructor'
}

function bytesToBase64Url(value: Uint8Array) {
  let binary = ''
  for (const byte of value) binary += String.fromCharCode(byte)
  return btoa(binary)
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll('=', '')
}

function base64UrlToBytes(value: string) {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) return null
  try {
    const base64 = value.replaceAll('-', '+').replaceAll('_', '/')
    const padded = base64.padEnd(
      base64.length + ((4 - (base64.length % 4)) % 4),
      '=',
    )
    const binary = atob(padded)
    const bytes = new Uint8Array(binary.length)
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index)
    }
    return bytes
  } catch {
    return null
  }
}

async function importContractKey(secret: string) {
  if (encoder.encode(secret).byteLength < 32) {
    throw new Error('Admin invitation secret must contain at least 32 bytes.')
  }
  return crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { hash: 'SHA-256', name: 'HMAC' },
    false,
    ['sign', 'verify'],
  )
}

function canonicalContractMessage(
  environmentId: string,
  requestId: string,
  emailHmac: string,
  issuedAtSeconds: number,
) {
  return (
    'compass:admin-microsoft-store-review:v1' +
    `|environment_id=${environmentId.toLowerCase()}` +
    `|request_id=${requestId.toLowerCase()}` +
    `|email_hmac=${emailHmac}` +
    `|issued_at=${issuedAtSeconds}`
  )
}

function hasValidBinding(
  environmentId: string,
  requestId: string,
  emailHmac: string,
) {
  return (
    UUID_PATTERN.test(environmentId) &&
    UUID_PATTERN.test(requestId) &&
    SHA256_HEX_PATTERN.test(emailHmac)
  )
}

function termsFromIssuedAt(issuedAtSeconds: number): MicrosoftStoreReviewTerms {
  return {
    canUseAi: false,
    expiresAt: new Date(
      (issuedAtSeconds + MICROSOFT_STORE_REVIEW_INVITATION_SECONDS) * 1_000,
    ).toISOString(),
    issuedAt: new Date(issuedAtSeconds * 1_000).toISOString(),
    membershipExpiresAt: new Date(
      (issuedAtSeconds + MICROSOFT_STORE_REVIEW_MEMBERSHIP_SECONDS) * 1_000,
    ).toISOString(),
    role: 'instructor',
  }
}

export function normalizeMicrosoftStoreReviewRequest(
  value: unknown,
): MicrosoftStoreReviewRequest | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  const keys = Object.keys(record).sort()
  if (
    keys.length !== 2 ||
    keys[0] !== 'normalizedEmail' ||
    keys[1] !== 'purpose' ||
    record.purpose !== MICROSOFT_STORE_REVIEW_PURPOSE ||
    typeof record.normalizedEmail !== 'string'
  ) {
    return null
  }
  const normalizedEmail = record.normalizedEmail.trim().toLowerCase()
  if (
    normalizedEmail.length < 3 ||
    normalizedEmail.length > 320 ||
    !EMAIL_PATTERN.test(normalizedEmail)
  ) {
    return null
  }
  return { normalizedEmail, purpose: MICROSOFT_STORE_REVIEW_PURPOSE }
}

export async function createMicrosoftStoreReviewContract({
  emailHmac,
  environmentId,
  issuedAtMs = Date.now(),
  invitationSecret,
  requestId,
}: {
  emailHmac: string
  environmentId: string
  issuedAtMs?: number
  invitationSecret: string
  requestId: string
}) {
  if (
    !hasValidBinding(environmentId, requestId, emailHmac) ||
    !Number.isFinite(issuedAtMs) ||
    issuedAtMs < 0
  ) {
    throw new Error('Invalid Microsoft Store review invitation binding.')
  }
  const issuedAtSeconds = Math.floor(issuedAtMs / 1_000)
  const signature = await crypto.subtle.sign(
    'HMAC',
    await importContractKey(invitationSecret),
    encoder.encode(
      canonicalContractMessage(
        environmentId,
        requestId,
        emailHmac,
        issuedAtSeconds,
      ),
    ),
  )
  return {
    contract: `${CONTRACT_PREFIX}.${issuedAtSeconds}.${bytesToBase64Url(
      new Uint8Array(signature),
    )}`,
    terms: termsFromIssuedAt(issuedAtSeconds),
  }
}

export async function verifyMicrosoftStoreReviewContract({
  contract,
  emailHmac,
  environmentId,
  invitationSecret,
  nowMs = Date.now(),
  requestId,
}: {
  contract: string
  emailHmac: string
  environmentId: string
  invitationSecret: string
  nowMs?: number
  requestId: string
}): Promise<MicrosoftStoreReviewTerms | null> {
  if (
    !hasValidBinding(environmentId, requestId, emailHmac) ||
    !Number.isFinite(nowMs)
  ) {
    return null
  }
  const match = CONTRACT_PATTERN.exec(contract)
  if (!match) return null
  const issuedAtSeconds = Number(match[1])
  const signature = base64UrlToBytes(match[2])
  const nowSeconds = Math.floor(nowMs / 1_000)
  if (
    !Number.isSafeInteger(issuedAtSeconds) ||
    issuedAtSeconds > nowSeconds + 60 ||
    issuedAtSeconds + MICROSOFT_STORE_REVIEW_INVITATION_SECONDS <= nowSeconds ||
    !signature
  ) {
    return null
  }
  try {
    const valid = await crypto.subtle.verify(
      'HMAC',
      await importContractKey(invitationSecret),
      signature,
      encoder.encode(
        canonicalContractMessage(
          environmentId,
          requestId,
          emailHmac,
          issuedAtSeconds,
        ),
      ),
    )
    return valid ? termsFromIssuedAt(issuedAtSeconds) : null
  } catch {
    return null
  }
}
