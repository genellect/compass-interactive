import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'
import { runAiQuickStart } from '../src/components/AdminAiControl/aiQuickStart.ts'

const stamp = '2026-09-27T00:00:00.000Z'
const rawAuthorization = (scope) => ({
  id: 'synthetic-master',
  status: 'active',
  scope,
  owned_by_requester: true,
  actions: [
    'summaries',
    'material_analysis',
    'poll_suggestions',
    'academic_answers',
    ...(scope === 'all_including_captions' ? ['captions'] : []),
  ],
  expires_at: '2099-01-01T00:00:00.000Z',
  issued_at: stamp,
  updated_at: stamp,
})
// Actual repository logic; replace only the auth transport and request-ID storage.
function repositoryHarness(currentScope, returnedScope) {
  const calls = []
  const source = readFileSync(
    new URL(
      '../src/repositories/supabase/aiMasterAuthorizationRepository.ts',
      import.meta.url,
    ),
    'utf8',
  )
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText
  class UnlockError extends Error {
    constructor(code, message) {
      super(message)
      this.code = code
    }
  }
  const module = { exports: {} }
  const requireModule = (specifier) => {
    if (specifier.endsWith('/adminAiUnlockApi'))
      return {
        AdminAiUnlockError: UnlockError,
        getGoogleAiMasterStatus: async () => ({
          authorization: currentScope ? rawAuthorization(currentScope) : null,
          policy: { id: 'policy', version: 1 },
          admissionEnabled: true,
          allowedScopes: ['all_except_captions', 'all_including_captions'],
          lectureOpen: true,
          canUseAi: true,
        }),
        authorizeGoogleAiMasterWithAal2Session: async (_token, request) => {
          calls.push(request)
          return {
            authorization: rawAuthorization(
              returnedScope ?? request.requestedScope,
            ),
          }
        },
      }
    if (specifier.endsWith('/rememberedBrowserCredential')) return {}
    if (specifier.endsWith('/adminOperationRequestId'))
      return {
        reserveAdminOperationRequestId: () => ({
          requestId: 'synthetic-request-id',
          key: 'synthetic-key',
        }),
        completeAdminOperationRequestId: () => {},
      }
    throw new Error(`Unexpected dependency ${specifier}`)
  }
  new vm.Script(
    `(function(require,module,exports){${compiled}\n})`,
  ).runInNewContext({ Error })(requireModule, module, module.exports)
  return {
    calls,
    authorize: (scope) =>
      module.exports.aiMasterAuthorizationRepository.authorizeAiMasterWithAal2Session(
        {
          adminToken: { kind: 'google', appSessionToken: 'synthetic-session' },
          lectureSessionId: 'lecture-a',
          masterScope: scope,
        },
      ),
  }
}
test('caption CTA elevates an existing non-caption master using the existing admission route', async () => {
  const h = repositoryHarness('all_except_captions')
  const result = await h.authorize('all_including_captions')
  assert.equal(h.calls.length, 1)
  assert.equal(h.calls[0].requestedScope, 'all_including_captions')
  assert.equal(result.authorization.scope, 'all_including_captions')
})
test('bulk CTA never downgrades a caption-inclusive master', async () => {
  const h = repositoryHarness('all_including_captions')
  const result = await h.authorize('all_except_captions')
  assert.equal(h.calls.length, 0)
  assert.equal(result.authorization.scope, 'all_including_captions')
})
test('same scope reuses existing master and an unfulfilled escalation fails closed', async () => {
  const same = repositoryHarness('all_except_captions')
  await same.authorize('all_except_captions')
  assert.equal(same.calls.length, 0)
  const stale = repositoryHarness('all_except_captions', 'all_except_captions')
  await assert.rejects(
    stale.authorize('all_including_captions'),
    /有効にできません/,
  )
})
const authorization = {
  status: 'active',
  ownedByRequester: true,
  scope: 'all_except_captions',
}
test('lecture/logout invalidation during authorization starts no current or replaced child', async () => {
  let resolve
  let current = true
  let starts = 0
  const operation = runAiQuickStart({
    authorize: () =>
      new Promise((r) => {
        resolve = r
      }),
    isCurrent: () => current,
    scope: 'all_except_captions',
    steps: [
      {
        name: 'summary',
        start: async () => {
          starts++
          return { status: 'started', message: 'done' }
        },
      },
    ],
  })
  current = false
  resolve(authorization)
  assert.equal((await operation)[0].status, 'skipped')
  assert.equal(starts, 0)
})
test('partial failure remains explicit and later independent feature can start', async () => {
  const result = await runAiQuickStart({
    authorize: async () => authorization,
    isCurrent: () => true,
    scope: 'all_except_captions',
    steps: [
      {
        name: 'summary',
        start: async () => {
          throw new Error('synthetic')
        },
      },
      {
        name: 'material',
        start: async () => ({ status: 'started', message: 'drafts only' }),
      },
    ],
  })
  assert.deepEqual(
    result.map((item) => item.status),
    ['failed', 'started'],
  )
})
test('stop between child starts cancels remaining work and never grants microphone implicitly', async () => {
  let current = true
  let secondStarts = 0
  const result = await runAiQuickStart({
    authorize: async () => authorization,
    isCurrent: () => current,
    scope: 'all_except_captions',
    steps: [
      {
        name: 'summary',
        start: async () => {
          current = false
          return { status: 'started', message: 'started' }
        },
      },
      {
        name: 'material',
        start: async () => {
          secondStarts++
          return { status: 'started', message: 'started' }
        },
      },
    ],
  })
  assert.equal(secondStarts, 0)
  assert.equal(result.at(-1).status, 'skipped')
})
