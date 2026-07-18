const encoder = new TextEncoder()
const RESUME_TOKEN_AUDIENCE = 'compass-lecture-resume'
const RESUME_TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60

function base64UrlEncode(value: string | Uint8Array) {
  const bytes = typeof value === 'string' ? encoder.encode(value) : value
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll('=', '')
}

async function sign(payload: string, secret: string) {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { hash: 'SHA-256', name: 'HMAC' },
    false,
    ['sign'],
  )
  return base64UrlEncode(
    new Uint8Array(
      await crypto.subtle.sign('HMAC', key, encoder.encode(payload)),
    ),
  )
}

export function getLectureResumeTokenSecret() {
  const secret = Deno.env.get('LECTURE_RESUME_TOKEN_SECRET') ?? ''
  if (encoder.encode(secret).byteLength < 32) {
    throw new Error('Lecture resume token secret is not configured.')
  }
  return secret
}

export async function createLectureResumeToken({
  archiveExpiresAt,
  lecturePublicId,
  version,
}: {
  archiveExpiresAt: string | null
  lecturePublicId: string
  version: number
}) {
  const now = Math.floor(Date.now() / 1000)
  const archiveExpiry = archiveExpiresAt
    ? Math.floor(Date.parse(archiveExpiresAt) / 1000)
    : Number.POSITIVE_INFINITY
  const expiresAt = Math.min(now + RESUME_TOKEN_TTL_SECONDS, archiveExpiry)
  if (
    !/^lecture_[0-9a-f]{32}$/.test(lecturePublicId) ||
    !Number.isSafeInteger(version) ||
    version < 1 ||
    !Number.isFinite(expiresAt) ||
    expiresAt <= now
  ) {
    throw new Error('Lecture resume scope is invalid.')
  }
  const payload = base64UrlEncode(
    JSON.stringify({
      aud: RESUME_TOKEN_AUDIENCE,
      exp: expiresAt,
      iat: now,
      jti: crypto.randomUUID(),
      lec: lecturePublicId,
      ver: version,
    }),
  )
  return {
    expiresAt: new Date(expiresAt * 1000).toISOString(),
    token: `${payload}.${await sign(payload, getLectureResumeTokenSecret())}`,
  }
}
