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
} = await import('../supabase/functions/_shared/presenterToken.ts')

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

test('capability is installation-bound and does not accept another secret', async () => {
  const expiresAt = Math.floor(Date.now() / 1000) + 120
  const installationHash = 'a'.repeat(64)
  const token = await createPresenterCapabilityToken({
    connectionId,
    expiresAt,
    installationHash,
    lectureSessionId,
    secret,
  })
  const claims = await getPresenterCapabilityClaims(token, secret)
  assert.equal(claims?.installationHash, installationHash)
  assert.equal(claims?.jti, connectionId)
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
