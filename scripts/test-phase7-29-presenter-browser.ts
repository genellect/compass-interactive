import assert from 'node:assert/strict'
import test from 'node:test'

import {
  PresenterBridgeClient,
  PresenterBridgeClientError,
} from '../src/presenter/presenterBridgeClient.ts'
import {
  isPresenterBridgeConnectRequest,
  parsePresenterBridgeConnectResponse,
  parsePresenterBridgePresentationResponse,
  parsePresenterBridgeStatusResponse,
  PRESENTER_BRIDGE_BASE_URL,
  PRESENTER_BRIDGE_HEALTH_TIMEOUT_MS,
  PRESENTER_BRIDGE_REQUEST_TIMEOUT_MS,
  PRESENTER_BRIDGE_SESSION_HEADER,
} from '../src/presenter/presenterBridgeProtocol.ts'

const uuid = '11111111-1111-4111-8111-111111111111'
const digest = 'a'.repeat(64)
const documentVersion = 'b'.repeat(64)
const ticket = `${'c'.repeat(96)}.${'d'.repeat(43)}`
const sessionToken = 'e'.repeat(43)

const presentation = {
  bindingDigest: digest,
  currentSlideIndex: 1,
  displayName: 'lecture.pptx',
  eligible: true,
  issues: [],
  slideCount: 20,
}

function jsonResponse(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    headers: {
      'Cache-Control': 'no-store',
      'Content-Type': 'application/json; charset=utf-8',
    },
    status,
  })
}

test('loopback bridge contract fixes the port and bounded timeouts', () => {
  assert.equal(PRESENTER_BRIDGE_BASE_URL, 'http://127.0.0.1:43124')
  assert.equal(PRESENTER_BRIDGE_HEALTH_TIMEOUT_MS, 1_500)
  assert.equal(PRESENTER_BRIDGE_REQUEST_TIMEOUT_MS, 12_000)
})

test('strict presentation validators reject unknown fields and inconsistent eligibility', () => {
  assert.deepEqual(
    parsePresenterBridgePresentationResponse({ ok: true, presentation }),
    { ok: true, presentation },
  )
  assert.equal(
    parsePresenterBridgePresentationResponse({
      debug: true,
      ok: true,
      presentation,
    }),
    null,
  )
  assert.equal(
    parsePresenterBridgePresentationResponse({
      ok: true,
      presentation: {
        ...presentation,
        eligible: true,
        issues: ['page_count_mismatch'],
      },
    }),
    null,
  )
})

test('connect validator binds the ticket to one lecture and published PDF', () => {
  const request = {
    lectureSessionId: uuid,
    pdfDocumentId: 'journal-club-v1',
    pdfDocumentVersion: documentVersion,
    pdfPageCount: 20,
    ticket,
  }
  assert.equal(isPresenterBridgeConnectRequest(request), true)
  assert.equal(
    isPresenterBridgeConnectRequest({ ...request, pdfPageCount: 76 }),
    false,
  )
  assert.equal(
    isPresenterBridgeConnectRequest({ ...request, extra: 'not-allowed' }),
    false,
  )
})

test('connect sends its one-time ticket only in a no-credential POST body', async () => {
  let observedUrl = ''
  let observedInit: RequestInit | undefined
  const client = new PresenterBridgeClient(async (input, init) => {
    observedUrl = String(input)
    observedInit = init
    return jsonResponse({
      ok: true,
      presentation,
      sessionToken,
      state: 'pending_confirmation',
    })
  })

  const result = await client.connect({
    lectureSessionId: uuid,
    pdfDocumentId: 'journal-club-v1',
    pdfDocumentVersion: documentVersion,
    pdfPageCount: 20,
    ticket,
  })

  assert.equal(observedUrl, 'http://127.0.0.1:43124/v1/connect')
  assert.equal(observedUrl.includes(ticket), false)
  assert.equal(observedInit?.credentials, 'omit')
  assert.equal(observedInit?.cache, 'no-store')
  assert.equal(observedInit?.redirect, 'manual')
  assert.equal(observedInit?.referrerPolicy, 'no-referrer')
  assert.equal(observedInit?.method, 'POST')
  assert.equal(JSON.parse(String(observedInit?.body)).ticket, ticket)
  assert.equal(result.sessionToken, sessionToken)
})

test('session capability is sent in a header and never placed in the URL', async () => {
  let observedUrl = ''
  let observedInit: RequestInit | undefined
  const client = new PresenterBridgeClient(async (input, init) => {
    observedUrl = String(input)
    observedInit = init
    return jsonResponse({ ok: true, presentation, state: 'active' })
  })

  await client.activate(sessionToken, digest)

  const headers = new Headers(observedInit?.headers)
  assert.equal(observedUrl, 'http://127.0.0.1:43124/v1/connect')
  assert.equal(observedUrl.includes(sessionToken), false)
  assert.equal(headers.get(PRESENTER_BRIDGE_SESSION_HEADER), sessionToken)
  assert.deepEqual(JSON.parse(String(observedInit?.body)), {
    action: 'activate',
    bindingDigest: digest,
  })
})

test('remote error text is not reflected into browser errors', async () => {
  const client = new PresenterBridgeClient(async () =>
    jsonResponse({ code: 'invalid_request', message: ticket, ok: false }, 400),
  )

  await assert.rejects(
    client.connect({
      lectureSessionId: uuid,
      pdfDocumentId: 'journal-club-v1',
      pdfDocumentVersion: documentVersion,
      pdfPageCount: 20,
      ticket,
    }),
    (error: unknown) => {
      assert.ok(error instanceof PresenterBridgeClientError)
      assert.equal(error.code, 'invalid_request')
      assert.equal(error.message.includes(ticket), false)
      return true
    },
  )
})

test('known PowerPoint errors provide bounded actionable text', async () => {
  const client = new PresenterBridgeClient(async () =>
    jsonResponse(
      {
        code: 'powerpoint_not_running',
        message: 'untrusted-local-detail',
        ok: false,
      },
      409,
    ),
  )

  await assert.rejects(
    client.connect({
      lectureSessionId: uuid,
      pdfDocumentId: 'journal-club-v1',
      pdfDocumentVersion: documentVersion,
      pdfPageCount: 20,
      ticket,
    }),
    (error: unknown) => {
      assert.ok(error instanceof PresenterBridgeClientError)
      assert.equal(error.code, 'powerpoint_not_running')
      assert.equal(
        error.message,
        'Start the PowerPoint slide show and try again.',
      )
      assert.equal(error.message.includes('untrusted-local-detail'), false)
      return true
    },
  )
})

test('manual redirects and cacheable responses fail closed', async () => {
  const redirectingClient = new PresenterBridgeClient(
    async () =>
      new Response(null, {
        headers: { Location: 'http://127.0.0.1:43125/v1/health' },
        status: 307,
      }),
  )
  await assert.rejects(
    redirectingClient.health(),
    (error: unknown) =>
      error instanceof PresenterBridgeClientError &&
      error.code === 'redirect_rejected',
  )

  const cacheableClient = new PresenterBridgeClient(
    async () =>
      new Response(
        JSON.stringify({
          ok: true,
          protocolVersion: 1,
          service: 'compass-presenter-bridge',
        }),
        { headers: { 'Content-Type': 'application/json' } },
      ),
  )
  await assert.rejects(
    cacheableClient.health(),
    (error: unknown) =>
      error instanceof PresenterBridgeClientError &&
      error.code === 'invalid_response',
  )
})

test('connect and status response validators enforce exact capability-free status', () => {
  assert.ok(
    parsePresenterBridgeConnectResponse({
      ok: true,
      presentation,
      sessionToken,
      state: 'pending_confirmation',
    }),
  )
  assert.ok(
    parsePresenterBridgeStatusResponse({
      lastErrorCode: null,
      ok: true,
      presentation,
      state: 'pending_confirmation',
    }),
  )
  assert.equal(
    parsePresenterBridgeStatusResponse({
      lastErrorCode: null,
      ok: true,
      presentation,
      sessionToken,
      state: 'pending_confirmation',
    }),
    null,
  )
})
