import assert from 'node:assert/strict'
import {
  createBillingGrantNonce,
  formatBillingGrantToken,
  normalizeAiFeatures,
  parseBillingGrantToken,
  sha256Hex,
  verifyBillingPin,
} from '../supabase/functions/_shared/aiBilling.ts'
import {
  createAdminToken,
  getAdminActorId,
  getAdminTokenClaims,
} from '../supabase/functions/_shared/adminToken.ts'
import {
  createOpenAiRealtimeClientSecret,
  createRealtimeTranscriptionSessionConfig,
} from '../supabase/functions/_shared/openaiRealtime.ts'

assert.deepEqual(normalizeAiFeatures(['summaries', 'captions', 'summaries']), [
  'captions',
  'summaries',
])
assert.throws(() => normalizeAiFeatures([]), /valid AI actions/)
assert.throws(() => normalizeAiFeatures(['unknown']), /Invalid AI action/)

const nonce = createBillingGrantNonce()
const grantId = '12345678-1234-4123-8123-123456789012'
assert.deepEqual(
  parseBillingGrantToken(formatBillingGrantToken(grantId, nonce)),
  {
    grantId,
    nonce,
  },
)
assert.throws(() => parseBillingGrantToken('broken'), /Invalid billing/)
assert.equal((await sha256Hex('billing')).length, 64)
assert.equal(await verifyBillingPin('separate-pin', 'separate-pin'), true)
assert.equal(await verifyBillingPin('wrong-pin', 'separate-pin'), false)
assert.equal(await verifyBillingPin('short', 'short'), false)

const token = await createAdminToken('test-only-secret-with-sufficient-length')
const claims = await getAdminTokenClaims(
  token,
  'test-only-secret-with-sufficient-length',
)
assert.ok(claims?.sid)
assert.match(getAdminActorId(claims), /^admin-session:[0-9a-f-]+$/)
assert.equal(
  await getAdminTokenClaims(token, 'different-test-only-secret'),
  null,
)

const sessionConfig = createRealtimeTranscriptionSessionConfig({
  delay: 'low',
  language: 'ja',
  model: 'gpt-realtime-whisper',
})
assert.deepEqual(sessionConfig, {
  session: {
    audio: {
      input: {
        format: { rate: 24_000, type: 'audio/pcm' },
        transcription: {
          delay: 'low',
          language: 'ja',
          model: 'gpt-realtime-whisper',
        },
        turn_detection: null,
      },
    },
    type: 'transcription',
  },
})

let observedAuthorization = ''
let observedSafetyIdentifier = ''
const secret = await createOpenAiRealtimeClientSecret({
  apiKey: 'test-key-never-logged',
  fetchImpl: async (_input, init) => {
    observedAuthorization =
      new Headers(init?.headers).get('Authorization') ?? ''
    observedSafetyIdentifier =
      new Headers(init?.headers).get('OpenAI-Safety-Identifier') ?? ''
    return new Response(
      JSON.stringify({ expires_at: 123456, value: 'ephemeral-test-secret' }),
      {
        headers: {
          'Content-Type': 'application/json',
          'x-request-id': 'req-test',
        },
        status: 200,
      },
    )
  },
  safetyIdentifier: 'hashed-lecture-admin',
  sessionConfig,
})
assert.equal(observedAuthorization, 'Bearer test-key-never-logged')
assert.equal(observedSafetyIdentifier, 'hashed-lecture-admin')
assert.deepEqual(secret, {
  expiresAt: 123456,
  requestId: 'req-test',
  value: 'ephemeral-test-secret',
})

await assert.rejects(
  createOpenAiRealtimeClientSecret({
    apiKey: 'test-key',
    fetchImpl: async () => new Response('{}', { status: 429 }),
    safetyIdentifier: 'hashed',
    sessionConfig,
  }),
  /openai_http_429/,
)

console.log('Phase 4 Edge billing, token, and OpenAI request helpers passed.')
