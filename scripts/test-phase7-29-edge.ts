import assert from 'node:assert/strict'
import test from 'node:test'

const environment = new Map<string, string>()
Object.assign(globalThis, {
  Deno: {
    env: {
      get(name: string) {
        return environment.get(name)
      },
    },
  },
})

const {
  createPresenterCapabilityToken,
  createPresenterPairingToken,
  getPresenterCapabilityClaims,
  getPresenterPairingClaims,
  getPresenterTokenSecret,
  hashPresenterContext,
  presenterCapabilityJtiFromNonceHash,
} = await import('../supabase/functions/_shared/presenterToken.ts')
const {
  getPresenterGatewaySecret,
  presenterProofCanonicalForTest,
  requirePresenterGateway,
  sha256HexBytes,
  verifyPresenterRequestProof,
} = await import('../supabase/functions/_shared/presenterProof.ts')

const secret = 'phase-7-29-test-secret-that-is-longer-than-32-bytes'
const connectionId = '72900000-0000-4000-8000-000000000001'
const lectureSessionId = '72900000-0000-4000-8000-000000000002'
const ticketId = '72900000-0000-4000-8000-000000000003'

test('pairing ticket is origin-bound, scoped and valid for at most 60 seconds', async () => {
  const issuedAt = Math.floor(Date.now() / 1000)
  const token = await createPresenterPairingToken({
    connectionId,
    expiresAt: issuedAt + 55,
    issuedAt,
    jti: ticketId,
    lectureSessionId,
    origin: 'https://compass-interactive.pages.dev',
    secret,
  })
  const claims = await getPresenterPairingClaims(token, secret)
  assert.equal(claims?.connectionId, connectionId)
  assert.equal(claims?.lectureSessionId, lectureSessionId)
  assert.equal(claims?.origin, 'https://compass-interactive.pages.dev')
  assert.equal(await getPresenterPairingClaims(`${token}x`, secret), null)
  await assert.rejects(() =>
    createPresenterPairingToken({
      connectionId,
      expiresAt: issuedAt + 61,
      issuedAt,
      jti: ticketId,
      lectureSessionId,
      origin: 'https://compass-interactive.pages.dev',
      secret,
    }),
  )
})

test('capability carries declared installation metadata and rejects another signing secret', async () => {
  const expiresAt = Math.floor(Date.now() / 1000) + 120
  const installationHash = 'a'.repeat(64)
  const capabilityId = presenterCapabilityJtiFromNonceHash('b'.repeat(64))
  const token = await createPresenterCapabilityToken({
    connectionId,
    expiresAt,
    installationHash,
    jti: capabilityId,
    lectureSessionId,
    secret,
  })
  const claims = await getPresenterCapabilityClaims(token, secret)
  assert.equal(claims?.installationHash, installationHash)
  assert.equal(claims?.jti, capabilityId)
  assert.equal(
    presenterCapabilityJtiFromNonceHash('b'.repeat(64)),
    capabilityId,
  )
  assert.notEqual(
    presenterCapabilityJtiFromNonceHash('c'.repeat(64)),
    capabilityId,
  )
  assert.equal(
    await getPresenterCapabilityClaims(token, `${secret}-different`),
    null,
  )
})

test('manual recovery code uses a dedicated keyed digest', async () => {
  const first = await hashPresenterContext('ABCDEFGH', 'manual-code', secret)
  const second = await hashPresenterContext('ABCDEFGJ', 'manual-code', secret)
  assert.match(first, /^[0-9a-f]{64}$/)
  assert.notEqual(first, second)
})

test('server refuses a missing or undersized Presenter secret', () => {
  environment.delete('PRESENTER_BRIDGE_TOKEN_SECRET')
  assert.throws(() => getPresenterTokenSecret())
  environment.set('PRESENTER_BRIDGE_TOKEN_SECRET', 'short')
  assert.throws(() => getPresenterTokenSecret())
  environment.set('PRESENTER_BRIDGE_TOKEN_SECRET', secret)
  assert.equal(getPresenterTokenSecret(), secret)
})

const base64Url = (value: Uint8Array) =>
  Buffer.from(value)
    .toString('base64url')

test('P-256 proof binds exact raw body, nonce, timestamp and public key', async () => {
  const keyPair = await crypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    ['sign', 'verify'],
  )
  const spki = new Uint8Array(
    await crypto.subtle.exportKey('spki', keyPair.publicKey),
  )
  const body = new TextEncoder().encode('{"action":"heartbeat"}')
  const nonce = Uint8Array.from({ length: 24 }, (_, index) => index + 1)
  const timestamp = String(Math.floor(Date.now() / 1000))
  const nonceText = base64Url(nonce)
  const bodySha256 = await sha256HexBytes(body)
  const canonical = presenterProofCanonicalForTest(
    timestamp,
    nonceText,
    bodySha256,
  )
  const signature = new Uint8Array(
    await crypto.subtle.sign(
      { hash: 'SHA-256', name: 'ECDSA' },
      keyPair.privateKey,
      new TextEncoder().encode(canonical),
    ),
  )
  assert.equal(signature.byteLength, 64)

  const headers = {
    'content-type': 'application/json',
    'x-compass-presenter-key-id': await sha256HexBytes(spki),
    'x-compass-presenter-nonce': nonceText,
    'x-compass-presenter-public-key': base64Url(spki),
    'x-compass-presenter-signature': base64Url(signature),
    'x-compass-presenter-timestamp': timestamp,
  }
  const verified = await verifyPresenterRequestProof(
    new Request(
      'https://project.supabase.co/functions/v1/presenter-bridge-session',
      { headers, method: 'POST' },
    ),
    body,
  )
  assert.equal(verified.keyId, headers['x-compass-presenter-key-id'])
  assert.equal(verified.bodySha256, bodySha256)
  assert.match(verified.nonceHash, /^[0-9a-f]{64}$/)

  await assert.rejects(() =>
    verifyPresenterRequestProof(
      new Request(
        'https://project.supabase.co/functions/v1/presenter-bridge-session',
        { headers, method: 'POST' },
      ),
      new TextEncoder().encode('{"action":"disconnect"}'),
    ),
  )
})

test('gateway secret is mandatory and never accepted by approximation', () => {
  const gatewaySecret =
    'phase-7-29c-test-gateway-secret-that-is-longer-than-32-bytes'
  environment.set('PRESENTER_BRIDGE_GATEWAY_SECRET', gatewaySecret)
  assert.equal(getPresenterGatewaySecret(), gatewaySecret)
  requirePresenterGateway(
    new Request('https://project.supabase.co', {
      headers: { 'x-compass-presenter-gateway': gatewaySecret },
    }),
    gatewaySecret,
  )
  assert.throws(() =>
    requirePresenterGateway(
      new Request('https://project.supabase.co', {
        headers: { 'x-compass-presenter-gateway': `${gatewaySecret}x` },
      }),
      gatewaySecret,
    ),
  )
})
