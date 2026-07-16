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

const { data: authData, error: authError } =
  await client.auth.signInAnonymously()
assert.ifError(authError)
assert.ok(authData.session?.access_token)

for (const functionName of [
  'analyze-lecture-material',
  'authorize-ai-start',
  'generate-lecture-summary',
  'issue-pdf-access-token',
  'issue-realtime-client-secret',
  'manage-ai-control',
  'manage-lecture-summaries',
  'manage-lectures',
  'manage-material-analysis',
  'manage-pdf-documents',
  'manage-polls',
  'publish-caption-window',
  'update-display-state',
  'verify-admin-pin',
]) {
  const response = await fetch(`${supabaseUrl}/functions/v1/${functionName}`, {
    headers: {
      apikey: publishableKey,
      Authorization: `Bearer ${authData.session.access_token}`,
      Origin: allowedOrigin,
    },
    method: 'OPTIONS',
  })
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

const { data: lectureData, error: lectureError } =
  await client.functions.invoke('manage-lectures', {
    body: { action: 'list', adminToken: loginData.adminToken },
  })
assert.ifError(lectureError)
assert.equal(lectureData?.ok, true)
assert.ok(Array.isArray(lectureData?.lectures))

const { data: paidData, error: paidError } = await client.functions.invoke(
  'authorize-ai-start',
  {
    body: {
      actions: ['captions'],
      adminToken: loginData.adminToken,
      lectureSessionId: '00000000-0000-4000-8000-000000000000',
      pin: 'test-billing-pin',
    },
  },
)
assert.ok(paidError)
assert.equal(paidData ?? null, null)
const paidResponse = await readFunctionError(paidError)
assert.equal(paidResponse.status, 503)
assert.equal(paidResponse.body.ok, false)
assert.match(paidResponse.body.message ?? '', /disabled/i)

await client.auth.signOut()
console.log(
  'Local Supabase Auth, Edge CORS, Admin token and fail-closed checks passed.',
)
