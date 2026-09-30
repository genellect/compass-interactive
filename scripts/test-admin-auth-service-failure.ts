import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'
import ts from 'typescript'

const root = fileURLToPath(new URL('../supabase/functions/', import.meta.url))
const origin = 'https://example.test'
const environmentId = '10000000-0000-4000-8000-000000000001'
const userId = '10000000-0000-4000-8000-000000000002'
const issuer = 'http://127.0.0.1:54321/auth/v1'
const appSessionToken = `g1.${Buffer.alloc(32, 1).toString('base64url')}`
const environment = {
  audience: 'authenticated',
  canonical_admin_origin: origin,
  environment_id: environmentId,
  status: 'active',
  supabase_issuer: issuer,
}
const user = {
  id: userId,
  app_metadata: { provider: 'google', providers: ['google'] },
  factors: [{ factor_type: 'totp', status: 'verified' }],
  identities: [
    {
      id: 'synthetic-google-subject',
      provider: 'google',
      identity_data: {
        sub: 'synthetic-google-subject',
        email: 'teacher@example.test',
        email_verified: true,
        iss: 'accounts.google.com',
      },
    },
  ],
}
type Scenario = {
  userError?: unknown
  assuranceError?: unknown
  environmentError?: unknown
  environment?: unknown
  user?: unknown
  claims?: Record<string, unknown>
  assurance?: unknown
}
const sources = new Map<string, string>()
const entrypoints = [
  'operations',
  'admin-identity-session',
  'admin-ai-unlock',
] as const
type Entrypoint = (typeof entrypoints)[number]

// Run the real Edge entrypoints and shared verifier. Only the remote SDK boundary
// is replaced; the VM has no network or access to the operator's environment.
function harness(entrypoint: Entrypoint, scenario: Scenario = {}) {
  const rpcCalls: string[] = []
  const authCalls = { getUser: 0, assurance: 0 }
  const now = Math.floor(Date.now() / 1000)
  const claims = {
    aal: 'aal2',
    amr: [
      { method: 'oauth', timestamp: now - 120 },
      { method: 'totp', timestamp: now - 60 },
    ],
    aud: 'authenticated',
    exp: now + 3600,
    iat: now - 60,
    iss: issuer,
    session_id: '10000000-0000-4000-8000-000000000003',
    sub: userId,
    ...scenario.claims,
  }
  const bearer = [
    'header',
    Buffer.from(JSON.stringify(claims)).toString('base64url'),
    'signature',
  ].join('.')
  const config: Record<string, string> = {
    COMPASS_EDGE_ALLOWED_ORIGINS: origin,
    PHASE730_ADMIN_ENVIRONMENT_ID: environmentId,
    PHASE730_ADMIN_IDENTITY_ENABLED: 'true',
    PHASE730_ADMIN_AI_UNLOCK_ENABLED: 'true',
    PHASE730_GOOGLE_ADMIN_OPERATIONS_ENABLED: 'true',
    SUPABASE_URL: 'http://127.0.0.1:54321',
    SUPABASE_SERVICE_ROLE_KEY: 'synthetic-service-key',
    ADMIN_IDENTITY_PEPPER: 'synthetic-identity-pepper-at-least-32-bytes',
    ADMIN_SESSION_SECRET: 'synthetic-session-secret-at-least-32-bytes',
  }
  const client = {
    auth: {
      getUser: async () => {
        authCalls.getUser += 1
        return {
          data: {
            user: scenario.userError
              ? null
              : 'user' in scenario
                ? scenario.user
                : user,
          },
          error: scenario.userError ?? null,
        }
      },
      mfa: {
        getAuthenticatorAssuranceLevel: async () => {
          authCalls.assurance += 1
          return {
            data: scenario.assuranceError
              ? null
              : (scenario.assurance ?? {
                  currentLevel: 'aal2',
                  nextLevel: 'aal2',
                }),
            error: scenario.assuranceError ?? null,
          }
        },
      },
    },
    rpc: async (name: string) => {
      rpcCalls.push(name)
      assert.equal(
        name,
        'get_admin_identity_environment_v1',
        'Denied requests must never invoke a privileged operation or session mutation',
      )
      return {
        data: 'environment' in scenario ? scenario.environment : environment,
        error: scenario.environmentError ?? null,
      }
    },
  }
  let handler: ((request: Request) => Promise<Response>) | undefined
  const context = vm.createContext({
    crypto,
    Headers,
    Request,
    Response,
    TextDecoder,
    TextEncoder,
    URL,
    Uint8Array,
    btoa,
    atob,
    Deno: {
      env: { get: (name: string) => config[name] },
      serve: (callback: typeof handler) => {
        handler = callback
      },
    },
  })
  const modules = new Map<string, { exports: Record<string, unknown> }>()
  function loadModule(filename: string): Record<string, unknown> {
    const cached = modules.get(filename)
    if (cached) return cached.exports
    const module = { exports: {} }
    modules.set(filename, module)
    let compiled = sources.get(filename)
    if (!compiled) {
      compiled = ts.transpileModule(readFileSync(filename, 'utf8'), {
        compilerOptions: {
          module: ts.ModuleKind.CommonJS,
          target: ts.ScriptTarget.ES2022,
          alwaysStrict: true,
        },
        fileName: filename,
      }).outputText
      sources.set(filename, compiled)
    }
    const requireModule = (specifier: string) => {
      if (specifier === 'npm:@supabase/supabase-js@2')
        return { createClient: () => client }
      assert.ok(
        specifier.startsWith('.'),
        `Unexpected external import: ${specifier}`,
      )
      const target = path.resolve(path.dirname(filename), specifier)
      assert.ok(
        target.startsWith(root),
        'Only repository Edge modules may be loaded',
      )
      return loadModule(target)
    }
    new vm.Script(`(function(require, module, exports) {${compiled}\n})`, {
      filename,
    }).runInContext(context)(requireModule, module, module.exports)
    return module.exports
  }
  const loaded = loadModule(
    path.join(
      root,
      entrypoint === 'operations'
        ? '_shared/googleAdminOperations.ts'
        : `${entrypoint}/index.ts`,
    ),
  )
  return {
    authCalls,
    rpcCalls,
    async invoke() {
      const request = new Request(`${origin}/${entrypoint}`, {
        method: 'POST',
        headers: {
          Origin: origin,
          Authorization: `Bearer ${bearer}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          action: entrypoint === 'admin-ai-unlock' ? 'policyStatus' : 'status',
          appSessionToken,
        }),
      })
      if (entrypoint === 'operations') {
        const verify = loaded.verifyGoogleAdminOperationRequest as (
          req: Request,
          token: string,
        ) => Promise<{ ok: boolean; status?: number; code?: string }>
        return verify(request, appSessionToken)
      }
      assert.ok(handler, 'The actual entrypoint must register Deno.serve')
      const response = await handler(request)
      const body = await response.json()
      return { ...body, status: response.status }
    },
  }
}

test('verified identity still reaches the transaction-bound operation context', async () => {
  const fixture = harness('operations')
  assert.equal((await fixture.invoke()).ok, true)
  assert.deepEqual(fixture.rpcCalls, ['get_admin_identity_environment_v1'])
})

for (const entrypoint of entrypoints) {
  for (const error of [
    { name: 'AuthApiError', status: 429 },
    { name: 'AuthApiError', status: 500 },
    { name: 'AuthApiError', status: 503 },
    { name: 'AuthRetryableFetchError', status: 0 },
  ]) {
    test(`${entrypoint}: Auth ${error.name}/${error.status} denies work without declaring session expiry`, async () => {
      const fixture = harness(entrypoint, { userError: error })
      const result = await fixture.invoke()
      assert.equal(result.status, 503)
      assert.equal(result.code, 'service_unavailable')
      assert.equal(result.ok, false)
      assert.deepEqual(fixture.authCalls, { getUser: 1, assurance: 0 })
      assert.deepEqual(fixture.rpcCalls, [])
    })
  }
  test(`${entrypoint}: assurance service failure denies work without requesting TOTP again`, async () => {
    const fixture = harness(entrypoint, {
      assuranceError: { name: 'AuthApiError', status: 503 },
    })
    const result = await fixture.invoke()
    assert.equal(result.status, 503)
    assert.equal(result.code, 'service_unavailable')
    assert.equal(result.ok, false)
    assert.deepEqual(fixture.authCalls, { getUser: 1, assurance: 1 })
    assert.ok(
      fixture.rpcCalls.every(
        (name) => name === 'get_admin_identity_environment_v1',
      ),
    )
  })
  test(`${entrypoint}: environment lookup failure is temporary, not proof of invalid identity`, async () => {
    const fixture = harness(entrypoint, { environmentError: { code: '57014' } })
    const result = await fixture.invoke()
    assert.equal(result.status, 503)
    assert.equal(result.code, 'service_unavailable')
    assert.equal(result.ok, false)
    assert.deepEqual(fixture.rpcCalls, ['get_admin_identity_environment_v1'])
  })
  for (const [label, scenario] of Object.entries({
    'Auth rejection': { userError: { name: 'AuthApiError', status: 401 } },
    'Auth forbidden': { userError: { name: 'AuthApiError', status: 403 } },
    'assurance rejected': {
      assuranceError: { name: 'AuthApiError', status: 401 },
    },
    'missing Auth user': { user: null },
    'expired JWT': { claims: { exp: 1 } },
    'another subject': { claims: { sub: 'another-subject' } },
    'missing MFA': { assurance: { currentLevel: 'aal1', nextLevel: 'aal2' } },
    'inactive environment': {
      environment: { ...environment, status: 'inactive' },
    },
    'missing environment': { environment: null },
    'wrong environment origin': {
      environment: {
        ...environment,
        canonical_admin_origin: 'https://other.example.test',
      },
    },
  })) {
    test(`${entrypoint}: ${label} remains an authentication failure`, async () => {
      const fixture = harness(entrypoint, scenario)
      const result = await fixture.invoke()
      assert.equal(result.status, 401)
      assert.equal(result.ok, false)
      assert.ok(
        fixture.rpcCalls.every(
          (name) => name === 'get_admin_identity_environment_v1',
        ),
      )
    })
  }
}
