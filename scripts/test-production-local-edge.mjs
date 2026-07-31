import assert from 'node:assert/strict'
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.VITE_SUPABASE_URL?.trim()
const publishableKey = process.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim()
const adminPin = process.env.TEST_ADMIN_PIN?.trim()
const allowedOrigin = process.env.TEST_ALLOWED_ORIGIN?.trim()

assert.ok(supabaseUrl, 'VITE_SUPABASE_URL is required')
assert.ok(publishableKey, 'VITE_SUPABASE_PUBLISHABLE_KEY is required')
assert.ok(adminPin, 'TEST_ADMIN_PIN is required')
assert.ok(allowedOrigin, 'TEST_ALLOWED_ORIGIN is required')

const client = createClient(supabaseUrl, publishableKey, {
  auth: {
    autoRefreshToken: false,
    detectSessionInUrl: false,
    persistSession: false,
  },
  global: { headers: { Origin: allowedOrigin } },
})

async function readFunctionError(error) {
  assert.ok(error instanceof Error)
  const context = error.context
  assert.ok(context instanceof Response)
  return {
    allowedOrigin: context.headers.get('Access-Control-Allow-Origin'),
    body: await context.clone().json(),
    status: context.status,
  }
}

const transientPreflightStatuses = new Set([502, 503, 504])

async function fetchPreflightWithRetry(url, init, maximumAttempts = 3) {
  let response

  for (let attempt = 1; attempt <= maximumAttempts; attempt += 1) {
    response = await fetch(url, init)
    if (!transientPreflightStatuses.has(response.status)) return response
    if (attempt === maximumAttempts) return response

    await response.arrayBuffer().catch(() => undefined)
    await new Promise((resolve) => setTimeout(resolve, attempt * 1_000))
  }

  throw new Error('Preflight retry loop ended without a response.')
}

const { data: authData, error: authError } =
  await client.auth.signInAnonymously()
assert.ifError(authError)
assert.ok(authData.session?.access_token)

for (const functionName of [
  'analyze-lecture-material',
  'authorize-ai-start',
  'generate-lecture-summary',
  'issue-pdf-access-token',
  'issue-lecture-resume-token',
  'issue-realtime-client-secret',
  'manage-ai-control',
  'manage-admin-sessions',
  'manage-lecture-summaries',
  'manage-lectures',
  'manage-material-analysis',
  'manage-pdf-documents',
  'manage-polls',
  'publish-caption-window',
  'update-display-state',
  'verify-admin-pin',
]) {
  const response = await fetchPreflightWithRetry(
    `${supabaseUrl}/functions/v1/${functionName}`,
    {
      headers: {
        apikey: publishableKey,
        Authorization: `Bearer ${authData.session.access_token}`,
        Origin: allowedOrigin,
      },
      method: 'OPTIONS',
    },
  )
  assert.equal(response.status, 200, `${functionName} preflight must pass`)
  assert.ok(
    [allowedOrigin, '*'].includes(
      response.headers.get('Access-Control-Allow-Origin') ?? '',
    ),
    `${functionName} preflight must be accepted by the local gateway`,
  )
}

const hostileResponse = await fetch(
  `${supabaseUrl}/functions/v1/verify-admin-pin`,
  {
    body: JSON.stringify({ pin: adminPin }),
    headers: {
      apikey: publishableKey,
      Authorization: `Bearer ${authData.session.access_token}`,
      'Content-Type': 'application/json',
      Origin: 'https://hostile.example',
    },
    method: 'POST',
  },
)
assert.equal(hostileResponse.status, 403)

const { data: wrongPinData, error: wrongPinError } =
  await client.functions.invoke('verify-admin-pin', {
    body: { pin: `${adminPin}-wrong` },
  })
assert.ok(wrongPinError)
assert.equal(wrongPinData ?? null, null)
const wrongPinResponse = await readFunctionError(wrongPinError)
assert.equal(wrongPinResponse.status, 401)
assert.equal(wrongPinResponse.body.ok, false)
assert.ok(
  [allowedOrigin, '*'].includes(wrongPinResponse.allowedOrigin ?? ''),
  'the local Edge gateway may normalize the response CORS header',
)

const unsupportedBodyResponse = await fetch(
  `${supabaseUrl}/functions/v1/verify-admin-pin`,
  {
    body: JSON.stringify({ pin: adminPin }),
    headers: {
      apikey: publishableKey,
      Authorization: `Bearer ${authData.session.access_token}`,
      'Content-Type': 'text/plain',
      Origin: allowedOrigin,
    },
    method: 'POST',
  },
)
assert.equal(unsupportedBodyResponse.status, 415)

const { data: loginData, error: loginError } = await client.functions.invoke(
  'verify-admin-pin',
  {
    body: { pin: adminPin },
  },
)
assert.ifError(loginError)
assert.equal(loginData?.ok, true)
assert.equal(typeof loginData?.adminToken, 'string')
assert.ok(loginData.adminToken.length > 40)

const { data: secondLoginData, error: secondLoginError } =
  await client.functions.invoke('verify-admin-pin', {
    body: { pin: adminPin },
  })
assert.ifError(secondLoginError)
assert.equal(secondLoginData?.ok, true)
assert.equal(typeof secondLoginData?.adminToken, 'string')

const crossUserClient = createClient(supabaseUrl, publishableKey, {
  auth: {
    autoRefreshToken: false,
    detectSessionInUrl: false,
    persistSession: false,
  },
  global: { headers: { Origin: allowedOrigin } },
})
const { error: crossUserAuthError } =
  await crossUserClient.auth.signInAnonymously()
assert.ifError(crossUserAuthError)
const { error: crossUserReplayError } = await crossUserClient.functions.invoke(
  'manage-lectures',
  {
    body: { action: 'list', adminToken: secondLoginData.adminToken },
  },
)
assert.ok(crossUserReplayError)
assert.equal((await readFunctionError(crossUserReplayError)).status, 401)

const { data: sessionData, error: sessionError } =
  await client.functions.invoke('manage-admin-sessions', {
    body: { action: 'list', adminToken: secondLoginData.adminToken },
  })
assert.ifError(sessionError)
assert.equal(sessionData?.ok, true)
assert.equal(typeof sessionData?.currentSessionId, 'string')
const firstSession = sessionData.sessions.find(
  (session) =>
    session.id !== sessionData.currentSessionId && session.revoked_at === null,
)
assert.ok(firstSession?.id)

const { data: revokeData, error: revokeError } = await client.functions.invoke(
  'manage-admin-sessions',
  {
    body: {
      action: 'revoke',
      adminToken: secondLoginData.adminToken,
      sessionId: firstSession.id,
    },
  },
)
assert.ifError(revokeError)
assert.equal(revokeData?.ok, true)

const { error: replayError } = await client.functions.invoke(
  'manage-lectures',
  { body: { action: 'list', adminToken: loginData.adminToken } },
)
assert.ok(replayError)
assert.equal((await readFunctionError(replayError)).status, 401)

const { data: lectureData, error: lectureError } =
  await client.functions.invoke('manage-lectures', {
    body: { action: 'list', adminToken: secondLoginData.adminToken },
  })
assert.ifError(lectureError)
assert.equal(lectureData?.ok, true)
assert.ok(Array.isArray(lectureData?.lectures))

const { data: paidData, error: paidError } = await client.functions.invoke(
  'authorize-ai-start',
  {
    body: {
      actions: ['captions'],
      adminToken: secondLoginData.adminToken,
      lectureSessionId: '00000000-0000-4000-8000-000000000000',
      pin: 'test-billing-pin',
    },
  },
)
assert.ok(paidError)
assert.equal(paidData ?? null, null)
const paidResponse = await readFunctionError(paidError)
assert.ok(
  [401, 409, 503].includes(paidResponse.status),
  `Paid feature request must fail closed, received ${paidResponse.status}.`,
)
assert.equal(paidResponse.body.ok, false)
assert.match(
  paidResponse.body.message ?? '',
  /disabled|failed|not found|could not be verified/i,
)

const { data: revokeAllData, error: revokeAllError } =
  await client.functions.invoke('manage-admin-sessions', {
    body: { action: 'revokeAll', adminToken: secondLoginData.adminToken },
  })
assert.ifError(revokeAllError)
assert.equal(revokeAllData?.ok, true)
const { error: revokedCurrentError } = await client.functions.invoke(
  'manage-lectures',
  { body: { action: 'list', adminToken: secondLoginData.adminToken } },
)
assert.ok(revokedCurrentError)
assert.equal((await readFunctionError(revokedCurrentError)).status, 401)

const concurrentPinResults = await Promise.all(
  Array.from({ length: 16 }, async () => {
    const { error } = await client.functions.invoke('verify-admin-pin', {
      body: { pin: `${adminPin}-blocked` },
    })
    assert.ok(error)
    const response = await readFunctionError(error)
    assert.equal(response.body.message, 'Admin PIN could not be verified.')
    return response.status
  }),
)
assert.equal(concurrentPinResults.filter((status) => status === 401).length, 8)
assert.equal(concurrentPinResults.filter((status) => status === 429).length, 8)

const rotatedClient = createClient(supabaseUrl, publishableKey, {
  auth: {
    autoRefreshToken: false,
    detectSessionInUrl: false,
    persistSession: false,
  },
  global: { headers: { Origin: allowedOrigin } },
})
const { error: rotatedAuthError } = await rotatedClient.auth.signInAnonymously()
assert.ifError(rotatedAuthError)
const { error: rotatedPinError } = await rotatedClient.functions.invoke(
  'verify-admin-pin',
  { body: { pin: `${adminPin}-rotated` } },
)
assert.ok(rotatedPinError)
const rotatedPinResponse = await readFunctionError(rotatedPinError)
assert.equal(rotatedPinResponse.status, 401)
assert.equal(
  rotatedPinResponse.body.message,
  'Admin PIN could not be verified.',
)

console.log(
  'Local Auth, bounded Edge input, tracked Admin sessions, PIN throttling and fail-closed paid features passed.',
)
