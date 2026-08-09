export type PresenterRateLimiter = {
  limit(input: { key: string }): Promise<{ success: boolean }>
}

export type PresenterGatewayEnvironment = {
  PRESENTER_BRIDGE_GATEWAY_SECRET?: string
  PRESENTER_LOCATION_RATE_LIMITER?: PresenterRateLimiter
  PRESENTER_NETWORK_RATE_LIMITER?: PresenterRateLimiter
}

const MACHINE_PATH = '/functions/v1/presenter-bridge-session'
const MAXIMUM_REQUEST_BYTES = 16 * 1024
const MAXIMUM_RESPONSE_BYTES = 64 * 1024
const UPSTREAM_TIMEOUT_MS = 4_250
const CANONICAL_UPSTREAM =
  'https://pfvedtqccblecuyjlfqh.supabase.co/functions/v1/presenter-bridge-session'
const PROOF_HEADERS = [
  'x-compass-presenter-key-id',
  'x-compass-presenter-public-key',
  'x-compass-presenter-timestamp',
  'x-compass-presenter-nonce',
  'x-compass-presenter-signature',
] as const

function jsonError(code: string, message: string, status: number) {
  return Response.json(
    { code, message, ok: false },
    {
      headers: {
        'Cache-Control': 'no-store',
        'Content-Type': 'application/json; charset=utf-8',
        'X-Content-Type-Options': 'nosniff',
      },
      status,
    },
  )
}

async function readBoundedBytes(
  body: ReadableStream<Uint8Array> | null,
  maximumBytes: number,
) {
  if (!body) return new Uint8Array()
  const reader = body.getReader()
  const chunks: Uint8Array[] = []
  let length = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      length += value.byteLength
      if (length > maximumBytes) {
        await reader.cancel('body_too_large').catch(() => undefined)
        throw new RangeError('body_too_large')
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  const bytes = new Uint8Array(length)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return bytes
}

async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(value),
  )
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('')
}

function requireConfiguration(env: PresenterGatewayEnvironment) {
  const secret = env.PRESENTER_BRIDGE_GATEWAY_SECRET ?? ''
  if (new TextEncoder().encode(secret).byteLength < 32) {
    throw new Error('gateway_unavailable')
  }
  if (
    !env.PRESENTER_LOCATION_RATE_LIMITER ||
    !env.PRESENTER_NETWORK_RATE_LIMITER
  ) {
    throw new Error('gateway_unavailable')
  }
  return { secret, upstream: new URL(CANONICAL_UPSTREAM) }
}

function hasValidProofHeaders(request: Request) {
  const keyId = request.headers.get('X-Compass-Presenter-Key-Id') ?? ''
  const publicKey = request.headers.get('X-Compass-Presenter-Public-Key') ?? ''
  const timestamp = request.headers.get('X-Compass-Presenter-Timestamp') ?? ''
  const nonce = request.headers.get('X-Compass-Presenter-Nonce') ?? ''
  const signature = request.headers.get('X-Compass-Presenter-Signature') ?? ''
  return (
    /^[0-9a-f]{64}$/.test(keyId) &&
    /^[A-Za-z0-9_-]{80,256}$/.test(publicKey) &&
    /^\d{10}$/.test(timestamp) &&
    /^[A-Za-z0-9_-]{16,64}$/.test(nonce) &&
    /^[A-Za-z0-9_-]{86}$/.test(signature)
  )
}

export function createPresenterGateway(fetcher: typeof fetch = fetch) {
  return {
    async fetch(request: Request, env: PresenterGatewayEnvironment) {
      const url = new URL(request.url)
      if (request.headers.has('Origin') || request.method === 'OPTIONS') {
        return jsonError(
          'browser_forbidden',
          'Browser requests are not allowed.',
          403,
        )
      }
      if (url.pathname !== MACHINE_PATH || url.search || url.hash) {
        return jsonError('route_not_found', 'Route not found.', 404)
      }
      if (request.method !== 'POST') {
        return jsonError('method_not_allowed', 'Method not allowed.', 405)
      }
      if (
        request.headers.get('Content-Type')?.split(';', 1)[0]?.trim() !==
        'application/json'
      ) {
        return jsonError('request_invalid', 'Request body must be JSON.', 415)
      }
      if (request.headers.has('Content-Encoding')) {
        return jsonError(
          'request_invalid',
          'Encoded request bodies are not allowed.',
          415,
        )
      }
      if (!hasValidProofHeaders(request)) {
        return jsonError(
          'proof_invalid',
          'Presenter request proof is invalid.',
          401,
        )
      }
      const declaredLength = Number(request.headers.get('Content-Length') ?? 0)
      if (
        !Number.isFinite(declaredLength) ||
        declaredLength < 0 ||
        declaredLength > MAXIMUM_REQUEST_BYTES
      ) {
        return jsonError('request_too_large', 'Request is too large.', 413)
      }

      let configuration: ReturnType<typeof requireConfiguration>
      try {
        configuration = requireConfiguration(env)
      } catch {
        return jsonError(
          'service_unavailable',
          'Presenter gateway is unavailable.',
          503,
        )
      }

      const suppliedNetworkAddress = request.headers
        .get('CF-Connecting-IP')
        ?.trim()
        .toLowerCase()
      const localDevelopment =
        url.hostname === '127.0.0.1' || url.hostname === 'localhost'
      if (!suppliedNetworkAddress && !localDevelopment) {
        return jsonError(
          'network_identity_unavailable',
          'Presenter network identity is unavailable.',
          403,
        )
      }
      const networkAddress = suppliedNetworkAddress ?? 'loopback-development'
      const networkKey = await sha256Hex(
        `compass-presenter-gateway-network-v1:${networkAddress}`,
      )
      let networkRate: { success: boolean }
      try {
        networkRate = await env.PRESENTER_NETWORK_RATE_LIMITER!.limit({
          key: networkKey,
        })
      } catch {
        return jsonError(
          'service_unavailable',
          'Presenter gateway is unavailable.',
          503,
        )
      }
      if (!networkRate.success) {
        return new Response(
          JSON.stringify({
            code: 'rate_limited',
            message: 'Presenter request rate limit reached.',
            ok: false,
          }),
          {
            headers: {
              'Cache-Control': 'no-store',
              'Content-Type': 'application/json; charset=utf-8',
              'Retry-After': '60',
              'X-Content-Type-Options': 'nosniff',
            },
            status: 429,
          },
        )
      }

      let locationRate: { success: boolean }
      try {
        locationRate = await env.PRESENTER_LOCATION_RATE_LIMITER!.limit({
          key: 'presenter-machine',
        })
      } catch {
        return jsonError(
          'service_unavailable',
          'Presenter gateway is unavailable.',
          503,
        )
      }
      if (!locationRate.success) {
        return new Response(
          JSON.stringify({
            code: 'rate_limited',
            message: 'Presenter request rate limit reached.',
            ok: false,
          }),
          {
            headers: {
              'Cache-Control': 'no-store',
              'Content-Type': 'application/json; charset=utf-8',
              'Retry-After': '60',
              'X-Content-Type-Options': 'nosniff',
            },
            status: 429,
          },
        )
      }

      let requestBytes: Uint8Array
      try {
        requestBytes = await readBoundedBytes(
          request.body,
          MAXIMUM_REQUEST_BYTES,
        )
      } catch {
        return jsonError('request_too_large', 'Request is too large.', 413)
      }
      if (requestBytes.byteLength === 0) {
        return jsonError('request_invalid', 'Request body is empty.', 400)
      }
      try {
        JSON.parse(
          new TextDecoder('utf-8', { fatal: true }).decode(requestBytes),
        )
      } catch {
        return jsonError('request_invalid', 'Request body is invalid.', 400)
      }

      const headers = new Headers({
        'Cache-Control': 'no-store',
        'Content-Type': 'application/json; charset=utf-8',
        'X-Compass-Presenter-Gateway': configuration.secret,
        'X-Compass-Presenter-Network': networkKey,
      })
      for (const name of PROOF_HEADERS) {
        const value = request.headers.get(name)
        if (value) headers.set(name, value)
      }

      let upstreamResponse: Response
      try {
        upstreamResponse = await fetcher(configuration.upstream, {
          body: copyToArrayBuffer(requestBytes),
          headers,
          method: 'POST',
          redirect: 'manual',
          signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
        })
      } catch {
        return jsonError(
          'service_unavailable',
          'Presenter service is unavailable.',
          504,
        )
      }
      if (upstreamResponse.status >= 300 && upstreamResponse.status < 400) {
        return jsonError(
          'upstream_redirect_rejected',
          'Presenter service is unavailable.',
          502,
        )
      }
      if (
        upstreamResponse.headers
          .get('Content-Type')
          ?.split(';', 1)[0]
          ?.trim() !== 'application/json' ||
        !upstreamResponse.headers
          .get('Cache-Control')
          ?.toLowerCase()
          .split(',')
          .map((value) => value.trim())
          .includes('no-store')
      ) {
        return jsonError(
          'upstream_response_invalid',
          'Presenter service response is invalid.',
          502,
        )
      }

      let responseBytes: Uint8Array
      try {
        responseBytes = await readBoundedBytes(
          upstreamResponse.body,
          MAXIMUM_RESPONSE_BYTES,
        )
      } catch {
        return jsonError(
          'upstream_response_invalid',
          'Presenter service response is invalid.',
          502,
        )
      }
      const responseHeaders = new Headers({
        'Cache-Control': 'no-store',
        'Content-Type': 'application/json; charset=utf-8',
        'X-Content-Type-Options': 'nosniff',
      })
      const retryAfter = upstreamResponse.headers.get('Retry-After')
      if (retryAfter && /^\d{1,3}$/.test(retryAfter)) {
        responseHeaders.set('Retry-After', retryAfter)
      }
      return new Response(copyToArrayBuffer(responseBytes), {
        headers: responseHeaders,
        status: upstreamResponse.status,
      })
    },
  }
}

function copyToArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength)
  copy.set(bytes)
  return copy.buffer
}

export default createPresenterGateway()
