import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'
import {
  startGoogleAdminAal2Fixture,
  stopGoogleAdminAal2Fixture,
} from './test-fixtures/google-admin-aal2-process.mjs'

const root = fileURLToPath(new URL('..', import.meta.url))
const supabaseUrl = process.env.VITE_SUPABASE_URL?.trim()
const publishableKey = process.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim()
const allowedOrigin = process.env.TEST_ALLOWED_ORIGIN?.trim()

assert.ok(supabaseUrl, 'VITE_SUPABASE_URL is required')
assert.ok(publishableKey, 'VITE_SUPABASE_PUBLISHABLE_KEY is required')
assert.ok(allowedOrigin, 'TEST_ALLOWED_ORIGIN is required')
assert.ok(
  ['127.0.0.1', 'localhost'].includes(new URL(supabaseUrl).hostname),
  'The production-contract Edge test refuses non-local Supabase URLs.',
)

const transientGatewayStatuses = new Set([502, 503, 504])

async function fetchPreflightWithRetry(url, init, maximumAttempts = 3) {
  let response
  for (let attempt = 1; attempt <= maximumAttempts; attempt += 1) {
    response = await fetch(url, init)
    if (!transientGatewayStatuses.has(response.status)) return response
    if (attempt === maximumAttempts) return response
    await response.arrayBuffer().catch(() => undefined)
    await new Promise((resolve) => setTimeout(resolve, attempt * 1_000))
  }
  throw new Error('Preflight retry loop ended without a response.')
}

async function postFunction(
  functionName,
  {
    body,
    jwt,
    origin = allowedOrigin,
    contentType = 'application/json',
    retryTransient = false,
  },
) {
  const encodedBody = typeof body === 'string' ? body : JSON.stringify(body)
  const maximumAttempts = retryTransient ? 3 : 1
  for (let attempt = 1; attempt <= maximumAttempts; attempt += 1) {
    const abortController = new AbortController()
    const timeout = setTimeout(() => abortController.abort(), 15_000)
    try {
      const response = await fetch(
        `${supabaseUrl}/functions/v1/${functionName}`,
        {
          body: encodedBody,
          headers: {
            apikey: publishableKey,
            Authorization: `Bearer ${jwt}`,
            'Content-Type': contentType,
            Origin: origin,
          },
          method: 'POST',
          signal: abortController.signal,
        },
      )
      const rawBody = await response.text()
      let responseBody = null
      try {
        responseBody = rawBody ? JSON.parse(rawBody) : null
      } catch {
        responseBody = rawBody
      }
      if (
        !retryTransient ||
        !transientGatewayStatuses.has(response.status) ||
        attempt === maximumAttempts
      ) {
        return { body: responseBody, response }
      }
    } catch (error) {
      const aborted = error instanceof Error && error.name === 'AbortError'
      if (!retryTransient || !aborted || attempt === maximumAttempts)
        throw error
    } finally {
      clearTimeout(timeout)
    }
    await new Promise((resolve) => setTimeout(resolve, attempt * 1_000))
  }
  throw new Error('POST retry loop ended without a response.')
}

const fixtureHandle = await startGoogleAdminAal2Fixture({
  cwd: root,
  env: process.env,
})

try {
  const fixture = fixtureHandle.fixture
  for (const functionName of [
    'admin-ai-unlock',
    'admin-identity-session',
    'analyze-lecture-material',
    'claim-display-realtime-session',
    'generate-academic-answer',
    'generate-lecture-summary',
    'issue-display-session',
    'issue-lecture-resume-token',
    'issue-pdf-access-token',
    'issue-realtime-client-secret',
    'manage-admin-ledger',
    'manage-admin-sessions',
    'manage-ai-control',
    'manage-comments',
    'manage-lecture-summaries',
    'manage-lectures',
    'manage-material-analysis',
    'manage-pdf-documents',
    'manage-pdf-publications',
    'manage-polls',
    'manage-presenter-connection',
    'operator-live-snapshot',
    'publish-caption-window',
    'update-display-state',
  ]) {
    const response = await fetchPreflightWithRetry(
      `${supabaseUrl}/functions/v1/${functionName}`,
      {
        headers: {
          apikey: publishableKey,
          Authorization: `Bearer ${fixture.accessToken}`,
          Origin: allowedOrigin,
        },
        method: 'OPTIONS',
      },
    )
    await response.arrayBuffer()
    assert.equal(response.status, 200, `${functionName} preflight must pass`)
    assert.ok(
      [allowedOrigin, '*'].includes(
        response.headers.get('Access-Control-Allow-Origin') ?? '',
      ),
      `${functionName} preflight must be accepted by the local gateway`,
    )
  }

  for (const removedFunctionName of [
    'authorize-ai-start',
    'verify-admin-pin',
  ]) {
    const response = await fetch(
      `${supabaseUrl}/functions/v1/${removedFunctionName}`,
      {
        headers: {
          apikey: publishableKey,
          Authorization: `Bearer ${fixture.accessToken}`,
          Origin: allowedOrigin,
        },
        method: 'OPTIONS',
      },
    )
    await response.arrayBuffer()
    assert.equal(
      response.status,
      404,
      `${removedFunctionName} must not remain routable`,
    )
  }

  const hostile = await postFunction('manage-lectures', {
    body: { action: 'list', appSessionToken: fixture.appSessionToken },
    jwt: fixture.accessToken,
    origin: 'https://hostile.example',
    retryTransient: true,
  })
  assert.equal(hostile.response.status, 403)

  const unsupported = await postFunction('manage-lectures', {
    body: JSON.stringify({
      action: 'list',
      appSessionToken: fixture.appSessionToken,
    }),
    contentType: 'text/plain',
    jwt: fixture.accessToken,
  })
  assert.equal(unsupported.response.status, 415)

  const browserBridge = await postFunction('presenter-bridge-session', {
    body: { action: 'inspect' },
    jwt: fixture.accessToken,
  })
  assert.equal(
    browserBridge.response.status,
    403,
    'The native Presenter Bridge endpoint must reject browser-originated requests.',
  )

  const restored = await postFunction('admin-identity-session', {
    body: { action: 'status', appSessionToken: fixture.appSessionToken },
    jwt: fixture.accessToken,
  })
  assert.equal(restored.response.status, 200)
  assert.equal(restored.body?.session?.id, fixture.appSessionId)

  const lectures = await postFunction('manage-lectures', {
    body: { action: 'list', appSessionToken: fixture.appSessionToken },
    jwt: fixture.accessToken,
  })
  assert.equal(lectures.response.status, 200)
  assert.equal(lectures.body?.ok, true)
  assert.ok(Array.isArray(lectures.body?.lectures))

  const legacyFields = await postFunction('manage-ai-control', {
    body: {
      action: 'status',
      adminToken: 'legacy-admin-token-must-be-rejected',
      appSessionToken: fixture.appSessionToken,
      billingGrant: 'legacy-billing-grant-must-be-rejected',
      billingPin: '135790',
    },
    jwt: fixture.accessToken,
  })
  assert.equal(legacyFields.response.status, 400)
  assert.equal(legacyFields.body?.ok, false)

  const crossUserClient = createClient(supabaseUrl, publishableKey, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
  })
  const { data: crossUser, error: crossUserError } =
    await crossUserClient.auth.signInAnonymously()
  assert.ifError(crossUserError)
  assert.ok(crossUser.session?.access_token)
  const crossUserReplay = await postFunction('manage-lectures', {
    body: { action: 'list', appSessionToken: fixture.appSessionToken },
    jwt: crossUser.session.access_token,
  })
  assert.equal(crossUserReplay.response.status, 401)

  const sessions = await postFunction('manage-admin-sessions', {
    body: {
      action: 'list',
      appSessionToken: fixture.appSessionToken,
    },
    jwt: fixture.accessToken,
  })
  assert.equal(sessions.response.status, 200)
  assert.equal(sessions.body?.currentSessionId, fixture.appSessionId)

  const revokeAll = await postFunction('manage-admin-sessions', {
    body: {
      action: 'revokeAll',
      appSessionToken: fixture.appSessionToken,
      requestId: randomUUID(),
    },
    jwt: fixture.accessToken,
  })
  assert.equal(revokeAll.response.status, 200)
  const revokedCurrent = await postFunction('manage-lectures', {
    body: {
      action: 'list',
      appSessionToken: fixture.appSessionToken,
    },
    jwt: fixture.accessToken,
  })
  assert.equal(revokedCurrent.response.status, 401)
  assert.equal(revokedCurrent.body?.code, 'app_session_invalid')

  console.log(
    'Local Google AAL2 Auth, CORS, removed legacy routes, strict request fields and tracked Admin sessions passed.',
  )
} finally {
  await stopGoogleAdminAal2Fixture(fixtureHandle)
}
