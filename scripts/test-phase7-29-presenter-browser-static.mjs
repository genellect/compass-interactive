import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const read = (path) =>
  readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

const protocol = read('src/presenter/presenterBridgeProtocol.ts')
const client = read('src/presenter/presenterBridgeClient.ts')
const repository = read('src/repositories/supabasePresenterBridgeRepository.ts')
const ciWorkflow = read('.github/workflows/ci.yml')

test('browser bridge is fixed to loopback port 43124 with bounded timeouts', () => {
  assert.match(
    protocol,
    /PRESENTER_BRIDGE_BASE_URL = 'http:\/\/127\.0\.0\.1:43124'/,
  )
  assert.match(protocol, /PRESENTER_BRIDGE_HEALTH_TIMEOUT_MS = 1_500/)
  assert.match(protocol, /PRESENTER_BRIDGE_REQUEST_TIMEOUT_MS = 12_000/)
  assert.doesNotMatch(protocol, /localhost|0\.0\.0\.0|43123/)
})

test('browser requests omit credentials, cache, referrers, and redirects', () => {
  assert.match(client, /cache: 'no-store'/)
  assert.match(client, /credentials: 'omit'/)
  assert.match(client, /redirect: 'manual'/)
  assert.match(client, /referrerPolicy: 'no-referrer'/)
  assert.match(client, /mode: 'cors'/)
  assert.match(client, /response\.type === 'opaqueredirect'/)
})

test('ticket and capability have no URL, browser-storage, history, or logging path', () => {
  const combined = `${client}\n${repository}`
  assert.doesNotMatch(
    combined,
    /localStorage|sessionStorage|indexedDB|URLSearchParams|location\.|history\.|console\./,
  )
  assert.match(client, /body: input\.body \? JSON\.stringify\(input\.body\)/)
  assert.match(protocol, /X-Compass-Presenter-Session/)
  assert.doesNotMatch(client, /[?&](?:ticket|token)=/i)
  assert.doesNotMatch(
    repository,
    /body:\s*\{[\s\S]{0,160}(?:pairingTicket|sessionToken)/,
  )
})

test('Admin Edge repository exposes only the four approved lifecycle actions', () => {
  assert.match(
    repository,
    /PRESENTER_EDGE_FUNCTION = 'manage-presenter-connection'/,
  )
  for (const action of ['issue', 'confirm', 'status', 'revoke']) {
    assert.match(repository, new RegExp(`action: '${action}'`))
  }
  assert.doesNotMatch(
    repository,
    /action: '(?:inspect|claim|apply|heartbeat|enableRuntime)'/,
  )
  assert.match(repository, /isAdminOperationCredential\(request\.adminToken\)/)
  assert.match(repository, /invokeEdgeFunction<unknown>\(/)
  assert.doesNotMatch(repository, /ensureAnonymousAuthSession\(\)/)
  assert.match(repository, /SUPABASE_REQUEST_TIMEOUT_MS\.adminFunction/)
  assert.match(
    repository,
    /MANUAL_CODE_PATTERN = \/\^\[A-HJ-NP-Z2-9\]\{8\}\$\//,
  )
})

test('both localhost and Edge response paths use exact-key validation', () => {
  assert.match(protocol, /function hasExactKeys/)
  assert.match(repository, /function hasExactKeys/)
  assert.match(protocol, /new Set\(value\.issues\)\.size/)
  assert.match(repository, /Date\.parse\(value\.ticketExpiresAt\)/)
})

test('native CI resolves the pinned SDK from the Presenter global.json directory', () => {
  assert.match(
    ciWorkflow,
    /name: Verify global\.json \.NET SDK feature band[\s\S]{0,160}working-directory: presenter-bridge[\s\S]{0,160}Get-Content global\.json/,
  )
  for (const stepName of [
    'Restore native solution',
    'Build native solution without publishing an artifact',
    'Run deterministic Core and loopback tests',
  ]) {
    assert.match(
      ciWorkflow,
      new RegExp(
        `name: ${stepName}[\\s\\S]{0,120}working-directory: presenter-bridge`,
      ),
    )
  }
})
