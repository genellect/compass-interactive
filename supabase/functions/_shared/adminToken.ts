const textEncoder = new TextEncoder()

function bytesToHex(value: Uint8Array) {
  return Array.from(value)
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

export async function hashAdminContext(
  value: string,
  secret: string,
  domain: 'network' | 'user-agent',
) {
  const key = await crypto.subtle.importKey(
    'raw',
    textEncoder.encode(secret),
    { hash: 'SHA-256', name: 'HMAC' },
    false,
    ['sign'],
  )
  const signature = await crypto.subtle.sign(
    'HMAC',
    key,
    textEncoder.encode(`${domain}:${value}`),
  )
  return bytesToHex(new Uint8Array(signature))
}

export async function sha256Hex(value: string) {
  return bytesToHex(
    new Uint8Array(
      await crypto.subtle.digest('SHA-256', textEncoder.encode(value)),
    ),
  )
}

export function timingSafeEqual(left: string, right: string) {
  if (left.length !== right.length) {
    return false
  }

  let mismatch = 0
  for (let index = 0; index < left.length; index += 1) {
    mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index)
  }

  return mismatch === 0
}

export function getAdminTokenSecret() {
  const tokenSecret = Deno.env.get('ADMIN_SESSION_SECRET')

  if (!tokenSecret) {
    throw new Error('Admin session secret is not configured.')
  }
  if (textEncoder.encode(tokenSecret).byteLength < 32) {
    throw new Error('Admin session secret must contain at least 32 bytes.')
  }

  return tokenSecret
}
