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
  createOpenAiRealtimeCall,
  createRealtimeTranscriptionSessionConfig,
  hangupOpenAiRealtimeCall,
  parseRealtimeCallId,
} from '../supabase/functions/_shared/openaiRealtime.ts'
import { runRealtimeProviderHangupSweep } from '../supabase/functions/_shared/realtimeProviderHangup.ts'

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
let observedClientRequestId = ''
let observedSafetyIdentifier = ''
let observedSdp = ''
let observedSession = null
const call = await createOpenAiRealtimeCall({
  apiKey: 'test-key-never-logged',
  clientRequestId: '12345678-1234-4123-8123-123456789012',
  fetchImpl: async (_input, init) => {
    observedAuthorization =
      new Headers(init?.headers).get('Authorization') ?? ''
    observedSafetyIdentifier =
      new Headers(init?.headers).get('OpenAI-Safety-Identifier') ?? ''
    observedClientRequestId =
      new Headers(init?.headers).get('X-Client-Request-Id') ?? ''
    assert.ok(init?.signal)
    assert.ok(init?.body instanceof FormData)
    const sdpField = init.body.get('sdp')
    const sessionField = init.body.get('session')
    assert.equal(typeof sdpField, 'string')
    assert.equal(typeof sessionField, 'string')
    observedSdp = sdpField
    observedSession = JSON.parse(sessionField)
    return new Response('v=0\r\nanswer-test-sdp', {
      headers: {
        'Content-Type': 'application/sdp',
        Location: '/v1/realtime/calls/rtc_test_call',
        'x-request-id': 'req-test',
      },
      status: 201,
    })
  },
  safetyIdentifier: 'hashed-lecture-admin',
  sdpOffer: 'v=0\r\noffer-test-sdp',
  sessionConfig,
})
assert.equal(observedAuthorization, 'Bearer test-key-never-logged')
assert.equal(observedClientRequestId, '12345678-1234-4123-8123-123456789012')
assert.equal(observedSafetyIdentifier, 'hashed-lecture-admin')
assert.equal(observedSdp, 'v=0\r\noffer-test-sdp')
assert.deepEqual(observedSession, sessionConfig.session)
assert.deepEqual(call, {
  answerSdp: 'v=0\r\nanswer-test-sdp',
  callId: 'rtc_test_call',
  requestId: 'req-test',
})
assert.equal(
  parseRealtimeCallId(
    'https://api.openai.com/v1/realtime/calls/rtc_absolute_call',
  ),
  'rtc_absolute_call',
)
assert.throws(
  () => parseRealtimeCallId('/v1/realtime/calls/invalid%2Fcall'),
  /openai_invalid_realtime_call_location/,
)

await assert.rejects(
  createOpenAiRealtimeCall({
    apiKey: 'test-key',
    clientRequestId: '22345678-1234-4123-8123-123456789012',
    fetchImpl: async () => new Response('{}', { status: 429 }),
    safetyIdentifier: 'hashed',
    sdpOffer: 'v=0\r\noffer-test-sdp',
    sessionConfig,
  }),
  /openai_http_429/,
)

await assert.rejects(
  createOpenAiRealtimeCall({
    apiKey: 'test-key',
    clientRequestId: '32345678-1234-4123-8123-123456789012',
    fetchImpl: async () =>
      new Response('v=0\r\nanswer-test-sdp', { status: 201 }),
    safetyIdentifier: 'hashed',
    sdpOffer: 'v=0\r\noffer-test-sdp',
    sessionConfig,
  }),
  /openai_missing_realtime_call_location/,
)

let observedHangupUrl = ''
let observedHangupMethod = ''
const hangup = await hangupOpenAiRealtimeCall({
  apiKey: 'test-key',
  callId: 'rtc_test_call',
  fetchImpl: async (input, init) => {
    observedHangupUrl = String(input)
    observedHangupMethod = init?.method ?? ''
    return new Response(null, {
      headers: { 'x-request-id': 'req-hangup' },
      status: 404,
    })
  },
})
assert.equal(
  observedHangupUrl,
  'https://api.openai.com/v1/realtime/calls/rtc_test_call/hangup',
)
assert.equal(observedHangupMethod, 'POST')
assert.deepEqual(hangup, {
  ok: true,
  requestId: 'req-hangup',
  status: 404,
})

const finalized = []
const sweep = await runRealtimeProviderHangupSweep({
  apiKey: 'test-key',
  claim: async ({ lectureSessionId, limit, operationId }) => {
    assert.equal(lectureSessionId, 'lecture-test')
    assert.equal(limit, 2)
    assert.equal(operationId, null)
    return [
      {
        attempt_count: 1,
        lecture_session_id: 'lecture-test',
        operation_id: 'operation-success',
        provider_call_id: 'rtc_success',
      },
      {
        attempt_count: 2,
        lecture_session_id: 'lecture-test',
        operation_id: 'operation-retry',
        provider_call_id: 'rtc_retry',
      },
    ]
  },
  fetchImpl: async (input) =>
    new Response(null, {
      status: String(input).includes('rtc_success') ? 200 : 500,
    }),
  finish: async (input) => {
    finalized.push(input)
    return true
  },
  lectureSessionId: 'lecture-test',
  limit: 2,
})
assert.deepEqual(sweep, {
  claimed: 2,
  retried: 1,
  stopped: 1,
})
assert.deepEqual(finalized, [
  {
    error: null,
    operationId: 'operation-success',
    succeeded: true,
  },
  {
    error: 'openai_hangup_http_500',
    operationId: 'operation-retry',
    succeeded: false,
  },
])

console.log(
  'Phase 4 Edge billing, token, trusted SDP, and provider hangup helpers passed.',
)
