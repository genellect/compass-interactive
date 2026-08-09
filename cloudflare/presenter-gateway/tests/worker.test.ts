import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import {
  createPresenterGateway,
  type PresenterGatewayEnvironment,
} from '../src/worker.ts'

const endpoint =
  'https://presenter-api.example.test/functions/v1/presenter-bridge-session'
const upstream =
  'https://pfvedtqccblecuyjlfqh.supabase.co/functions/v1/presenter-bridge-session'
const body = new TextEncoder().encode('{"action":"heartbeat","x":"raw"}')
const proofHeaders = {
  'X-Compass-Presenter-Key-Id': 'a'.repeat(64),
  'X-Compass-Presenter-Nonce': 'n'.repeat(32),
  'X-Compass-Presenter-Public-Key': 'p'.repeat(120),
  'X-Compass-Presenter-Signature': 's'.repeat(86),
  'X-Compass-Presenter-Timestamp': '1786200000',
}

function limiter(success = true) {
  return { limit: async () => ({ success }) }
}

function trackedLimiter(calls: string[], name: string, success = true) {
  return {
    limit: async () => {
      calls.push(name)
      return { success }
    },
  }
}

function jsonResponse(bodyValue: BodyInit | null, status = 200) {
  return new Response(bodyValue, {
    headers: {
      'Cache-Control': 'no-store',
      'Content-Type': 'application/json',
    },
    status,
  })
}

function environment(): PresenterGatewayEnvironment {
  return {
    PRESENTER_BRIDGE_GATEWAY_SECRET: 'g'.repeat(32),
    PRESENTER_LOCATION_RATE_LIMITER: limiter(),
    PRESENTER_NETWORK_RATE_LIMITER: limiter(),
  }
}

function machineRequest(init: RequestInit = {}) {
  return new Request(endpoint, {
    body,
    ...init,
    headers: {
      ...proofHeaders,
      'CF-Connecting-IP': '203.0.113.7',
      'Content-Type': 'application/json',
      ...Object.fromEntries(new Headers(init.headers).entries()),
    },
    method: init.method ?? 'POST',
  })
}

test('forwards exact bytes and proof headers while replacing trusted headers', async () => {
  const forwarded: Request[] = []
  const worker = createPresenterGateway(async (input, init) => {
    forwarded.push(new Request(input, init))
    return Response.json(
      { ok: true },
      { headers: { 'Cache-Control': 'no-store' } },
    )
  })
  const response = await worker.fetch(
    new Request(endpoint, {
      body,
      headers: {
        ...proofHeaders,
        'CF-Connecting-IP': '203.0.113.7',
        'Content-Type': 'application/json; charset=utf-8',
        'X-Compass-Presenter-Gateway': 'attacker',
        'X-Compass-Presenter-Network': 'attacker',
      },
      method: 'POST',
    }),
    environment(),
  )
  assert.equal(response.status, 200)
  const forwardedRequest = forwarded[0]
  assert.ok(forwardedRequest)
  assert.equal(forwardedRequest.url, upstream)
  assert.deepEqual(new Uint8Array(await forwardedRequest.arrayBuffer()), body)
  assert.equal(
    forwardedRequest.headers.get('X-Compass-Presenter-Gateway'),
    'g'.repeat(32),
  )
  assert.match(
    forwardedRequest.headers.get('X-Compass-Presenter-Network') ?? '',
    /^[0-9a-f]{64}$/,
  )
  for (const [name, value] of Object.entries(proofHeaders)) {
    assert.equal(forwardedRequest.headers.get(name), value)
  }
})

test('rejects browser, wrong route, spoofed method and oversized input', async () => {
  const worker = createPresenterGateway(async () => {
    throw new Error('must not fetch')
  })
  const env = environment()
  assert.equal(
    (
      await worker.fetch(
        new Request(endpoint, { headers: { Origin: 'https://evil.test' } }),
        env,
      )
    ).status,
    403,
  )
  assert.equal(
    (await worker.fetch(new Request(`${endpoint}/other`), env)).status,
    404,
  )
  assert.equal(
    (await worker.fetch(new Request(endpoint, { method: 'GET' }), env)).status,
    405,
  )
  assert.equal(
    (
      await worker.fetch(
        new Request(endpoint, {
          body: 'x'.repeat(16 * 1024 + 1),
          headers: {
            ...proofHeaders,
            'CF-Connecting-IP': '203.0.113.7',
            'Content-Type': 'application/json',
          },
          method: 'POST',
        }),
        env,
      )
    ).status,
    413,
  )
})

test('fails closed when configuration or either rate limiter is unavailable', async () => {
  const worker = createPresenterGateway(async () => Response.json({ ok: true }))
  const request = () => machineRequest()
  assert.equal(
    (
      await worker.fetch(request(), {
        ...environment(),
        PRESENTER_BRIDGE_GATEWAY_SECRET: 'short',
      })
    ).status,
    503,
  )
  assert.equal(
    (
      await worker.fetch(request(), {
        ...environment(),
        PRESENTER_LOCATION_RATE_LIMITER: undefined,
      })
    ).status,
    503,
  )
  assert.equal(
    (
      await worker.fetch(request(), {
        ...environment(),
        PRESENTER_NETWORK_RATE_LIMITER: undefined,
      })
    ).status,
    503,
  )
  assert.equal(
    (
      await worker.fetch(request(), {
        ...environment(),
        PRESENTER_LOCATION_RATE_LIMITER: limiter(false),
      })
    ).status,
    429,
  )
  assert.equal(
    (
      await worker.fetch(request(), {
        ...environment(),
        PRESENTER_NETWORK_RATE_LIMITER: limiter(false),
      })
    ).status,
    429,
  )
})

test('does not charge the location limiter when the network limiter rejects', async () => {
  const calls: string[] = []
  let upstreamCalls = 0
  const response = await createPresenterGateway(async () => {
    upstreamCalls += 1
    return Response.json({ ok: true })
  }).fetch(machineRequest(), {
    ...environment(),
    PRESENTER_LOCATION_RATE_LIMITER: trackedLimiter(calls, 'location'),
    PRESENTER_NETWORK_RATE_LIMITER: trackedLimiter(calls, 'network', false),
  })

  assert.equal(response.status, 429)
  assert.deepEqual(calls, ['network'])
  assert.equal(upstreamCalls, 0)
})

test('charges the location limiter only after network admission', async () => {
  const calls: string[] = []
  const response = await createPresenterGateway(async () => {
    throw new Error('must not fetch')
  }).fetch(machineRequest(), {
    ...environment(),
    PRESENTER_LOCATION_RATE_LIMITER: trackedLimiter(calls, 'location', false),
    PRESENTER_NETWORK_RATE_LIMITER: trackedLimiter(calls, 'network'),
  })

  assert.equal(response.status, 429)
  assert.deepEqual(calls, ['network', 'location'])
})

test('rejects upstream redirects and overlarge responses', async () => {
  const request = () => machineRequest()
  assert.equal(
    (
      await createPresenterGateway(
        async () => new Response(null, { status: 302 }),
      ).fetch(request(), environment())
    ).status,
    502,
  )
  assert.equal(
    (
      await createPresenterGateway(async () =>
        jsonResponse('x'.repeat(64 * 1024 + 1)),
      ).fetch(request(), environment())
    ).status,
    502,
  )
})

test('rejects query, OPTIONS, content encoding, empty bodies and invalid proof', async () => {
  const worker = createPresenterGateway(async () => {
    throw new Error('must not fetch')
  })
  assert.equal(
    (await worker.fetch(machineRequest({ method: 'OPTIONS' }), environment()))
      .status,
    403,
  )
  assert.equal(
    (await worker.fetch(new Request(`${endpoint}?debug=1`), environment()))
      .status,
    404,
  )
  assert.equal(
    (
      await worker.fetch(
        machineRequest({ headers: { 'Content-Encoding': 'gzip' } }),
        environment(),
      )
    ).status,
    415,
  )
  assert.equal(
    (
      await worker.fetch(
        machineRequest({ body: new Uint8Array() }),
        environment(),
      )
    ).status,
    400,
  )
  assert.equal(
    (
      await worker.fetch(
        machineRequest({
          headers: { 'X-Compass-Presenter-Signature': 'invalid' },
        }),
        environment(),
      )
    ).status,
    401,
  )
})

test('requires Cloudflare network identity outside explicit loopback development', async () => {
  const worker = createPresenterGateway(async () => jsonResponse('{}'))
  const publicRequest = machineRequest()
  publicRequest.headers.delete('CF-Connecting-IP')
  assert.equal((await worker.fetch(publicRequest, environment())).status, 403)

  const localRequest = new Request(
    endpoint.replace('presenter-api.example.test', '127.0.0.1'),
    {
      body,
      headers: { ...proofHeaders, 'Content-Type': 'application/json' },
      method: 'POST',
    },
  )
  assert.equal((await worker.fetch(localRequest, environment())).status, 200)
})

test('fails closed when limiter or upstream throws', async () => {
  const rejectingLimiter = {
    limit: async () => {
      throw new Error('rate backend unavailable')
    },
  }
  assert.equal(
    (
      await createPresenterGateway(async () => jsonResponse('{}')).fetch(
        machineRequest(),
        {
          ...environment(),
          PRESENTER_LOCATION_RATE_LIMITER: rejectingLimiter,
        },
      )
    ).status,
    503,
  )
  assert.equal(
    (
      await createPresenterGateway(async () => {
        throw new Error('upstream unavailable')
      }).fetch(machineRequest(), environment())
    ).status,
    504,
  )
})

test('strips untrusted credentials and exposes only bounded safe response headers', async () => {
  let forwarded: Request | undefined
  const response = await createPresenterGateway(async (input, init) => {
    forwarded = new Request(input, init)
    return new Response('{"ok":false,"code":"rate_limited"}', {
      headers: {
        'Cache-Control': 'no-store',
        'Content-Type': 'application/json',
        'Retry-After': '12',
        'Set-Cookie': 'secret=value',
        'X-Upstream-Secret': 'hidden',
      },
      status: 429,
    })
  }).fetch(
    machineRequest({
      headers: {
        Authorization: 'Bearer attacker',
        Cookie: 'attacker=true',
        'X-Compass-Presenter-Gateway': 'attacker',
        'X-Compass-Presenter-Network': 'attacker',
      },
    }),
    environment(),
  )
  assert.ok(forwarded)
  assert.equal(forwarded.headers.has('Authorization'), false)
  assert.equal(forwarded.headers.has('Cookie'), false)
  assert.equal(response.status, 429)
  assert.equal(response.headers.get('Retry-After'), '12')
  assert.equal(response.headers.has('Set-Cookie'), false)
  assert.equal(response.headers.has('X-Upstream-Secret'), false)
})

test('rejects upstream responses that are not JSON and no-store', async () => {
  assert.equal(
    (
      await createPresenterGateway(
        async () =>
          new Response('{}', {
            headers: {
              'Cache-Control': 'no-store',
              'Content-Type': 'text/plain',
            },
          }),
      ).fetch(machineRequest(), environment())
    ).status,
    502,
  )
  assert.equal(
    (
      await createPresenterGateway(
        async () =>
          new Response('{}', {
            headers: { 'Content-Type': 'application/json' },
          }),
      ).fetch(machineRequest(), environment())
    ).status,
    502,
  )
})

test('wrangler configuration remains dormant and fail-closed', () => {
  const configurationSource = readFileSync(
    new URL('../wrangler.jsonc', import.meta.url),
    'utf8',
  )
  const configuration = JSON.parse(
    configurationSource
      .replace(/^\s*\/\/.*$/gm, '')
      .replace(/,\s*([}\]])/g, '$1'),
  ) as {
    custom_domain?: unknown
    preview_urls?: boolean
    ratelimits?: Array<{
      name?: string
      namespace_id?: string
      simple?: { limit?: number; period?: number }
    }>
    route?: unknown
    routes?: unknown
    secrets?: { required?: string[] }
    vars?: Record<string, unknown>
    workers_dev?: boolean
  }

  assert.equal(configuration.workers_dev, false)
  assert.equal(configuration.preview_urls, false)
  assert.equal(configuration.custom_domain, undefined)
  assert.equal(configuration.route, undefined)
  assert.equal(configuration.routes, undefined)
  assert.equal(configuration.vars, undefined)
  assert.deepEqual(configuration.secrets?.required, [
    'PRESENTER_BRIDGE_GATEWAY_SECRET',
  ])

  const rateLimiters = configuration.ratelimits ?? []
  assert.deepEqual(
    rateLimiters.map((limiter) => limiter.name),
    ['PRESENTER_LOCATION_RATE_LIMITER', 'PRESENTER_NETWORK_RATE_LIMITER'],
  )
  assert.deepEqual(
    rateLimiters.map((limiter) => limiter.simple),
    [
      { limit: 9000, period: 60 },
      { limit: 1200, period: 60 },
    ],
  )
  const namespaceIds = rateLimiters.map((limiter) => limiter.namespace_id ?? '')
  assert.equal(new Set(namespaceIds).size, namespaceIds.length)
  assert.ok(namespaceIds.every((value) => /^[1-9]\d*$/.test(value)))
  assert.equal(namespaceIds.includes('6601'), false)
  assert.equal(namespaceIds.includes('6602'), false)
})
