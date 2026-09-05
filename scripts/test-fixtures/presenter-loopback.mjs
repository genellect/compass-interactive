import { createServer } from 'node:http'
import { randomBytes } from 'node:crypto'

const host = '127.0.0.1'
const port = 43_124
const allowedOrigin = process.env.PRESENTER_TEST_ALLOWED_ORIGIN
if (!allowedOrigin || new URL(allowedOrigin).origin !== allowedOrigin) {
  throw new Error('PRESENTER_TEST_ALLOWED_ORIGIN must be one exact Origin.')
}

const presentation = {
  bindingDigest: 'a'.repeat(64),
  currentSlideIndex: 1,
  displayName: 'Phase 7.29 test presentation.pptx',
  eligible: true,
  issues: [],
  slideCount: 3,
}
const sessions = new Map()

function headers(origin = allowedOrigin) {
  return {
    'Access-Control-Allow-Headers': 'Content-Type, X-Compass-Presenter-Session',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Max-Age': '60',
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json; charset=utf-8',
    Vary: 'Origin, Access-Control-Request-Private-Network',
    'X-Content-Type-Options': 'nosniff',
  }
}

function send(response, status, body, extraHeaders = {}) {
  const encoded = Buffer.from(JSON.stringify(body))
  response.writeHead(status, {
    ...headers(),
    ...extraHeaders,
    'Content-Length': String(encoded.byteLength),
  })
  response.end(encoded)
}

function reject(response, status, code) {
  send(response, status, { code, message: 'Request rejected.', ok: false })
}

async function readBody(request) {
  const declared = Number(request.headers['content-length'])
  if (
    !Number.isSafeInteger(declared) ||
    declared < 2 ||
    declared > 8_192 ||
    request.headers['transfer-encoding']
  ) {
    throw new Error('invalid_length')
  }
  const chunks = []
  let total = 0
  for await (const chunk of request) {
    total += chunk.length
    if (total > 8_192) throw new Error('body_too_large')
    chunks.push(chunk)
  }
  if (total !== declared) throw new Error('length_mismatch')
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

const server = createServer(async (request, response) => {
  process.stdout.write(
    `PRESENTER_LOOPBACK_REQUEST ${request.method ?? 'UNKNOWN'} ${request.url ?? '/'} origin=${request.headers.origin === allowedOrigin ? 'allowed' : 'rejected'} host=${request.headers.host === `${host}:${port}` ? 'allowed' : 'rejected'}\n`,
  )
  if (
    request.headers.host !== `${host}:${port}` ||
    request.headers.origin !== allowedOrigin
  ) {
    reject(response, 403, 'origin_not_allowed')
    return
  }

  if (request.method === 'OPTIONS') {
    const pna =
      request.headers['access-control-request-private-network'] === 'true'
        ? { 'Access-Control-Allow-Private-Network': 'true' }
        : {}
    response.writeHead(204, { ...headers(), ...pna })
    response.end()
    return
  }

  const suppliedSession = request.headers['x-compass-presenter-session']
  const session =
    typeof suppliedSession === 'string' ? sessions.get(suppliedSession) : null
  if (request.method === 'GET' && request.url === '/v1/health') {
    send(response, 200, {
      ok: true,
      powerpointReady: true,
      powerpointIssue: null,
      protocolVersion: 1,
      service: 'compass-presenter-bridge',
    })
    return
  }

  if (request.method === 'POST' && request.url === '/v1/connect') {
    let body
    try {
      body = await readBody(request)
    } catch {
      reject(response, 400, 'invalid_request')
      return
    }
    if (body?.action === 'activate') {
      if (!session || body.bindingDigest !== presentation.bindingDigest) {
        reject(response, 401, 'invalid_session')
        return
      }
      session.state = 'active'
      send(response, 200, { ok: true, presentation, state: session.state })
      return
    }
    if (
      typeof body?.ticket !== 'string' ||
      typeof body?.lectureSessionId !== 'string' ||
      body?.pdfPageCount !== presentation.slideCount
    ) {
      reject(response, 400, 'invalid_request')
      return
    }
    const sessionToken = randomBytes(32).toString('base64url')
    sessions.set(sessionToken, { state: 'pending_confirmation' })
    send(response, 200, {
      ok: true,
      presentation,
      sessionToken,
      state: 'pending_confirmation',
    })
    return
  }

  if (!session) {
    reject(response, 401, 'invalid_session')
    return
  }
  if (request.method === 'GET' && request.url === '/v1/presentation') {
    send(response, 200, { ok: true, presentation })
    return
  }
  if (request.method === 'GET' && request.url === '/v1/status') {
    send(response, 200, {
      lastErrorCode: null,
      ok: true,
      presentation,
      state: session.state,
    })
    return
  }
  if (request.method === 'POST' && request.url === '/v1/disconnect') {
    sessions.delete(suppliedSession)
    send(response, 200, { ok: true, state: 'disconnected' })
    return
  }
  reject(response, 404, 'invalid_request')
})

server.listen(port, host, () => {
  process.stdout.write('PRESENTER_LOOPBACK_READY\n')
})

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => server.close(() => process.exit(0)))
}
