import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'
import ts from 'typescript'

const root = fileURLToPath(new URL('../supabase/functions/', import.meta.url))
const uuid = (last: number) =>
  `10000000-0000-4000-8000-${String(last).padStart(12, '0')}`
const operationId = uuid(8)
const startRequestId = uuid(4)
const documentVersion = 'a'.repeat(64)
const pageText = '比較群と交絡を検討し、信頼区間と効果量を解釈します。'
const requestBody = {
  appSessionToken: 'synthetic-test-session',
  grantRequestId: uuid(3),
  lectureSessionId: uuid(1),
  pdfContext: {
    documentId: 'synthetic-document',
    documentVersion,
    pages: [
      {
        excerptId: createHash('sha256')
          .update(`${documentVersion}:2:${pageText}`)
          .digest('hex'),
        pageNumber: 2,
        text: pageText,
      },
    ],
  },
  preflightRequestId: uuid(2),
  runToken: `${uuid(5)}.${'synthetic-summary-nonce-'.repeat(2)}`,
  startRequestId,
  transcriptSegments: [],
  windowIndex: 1,
}
const output = {
  academicQuestionCandidate: null,
  commentPulse: ['比較群と解釈について質問が寄せられた。'],
  cumulativeMemo: '比較群と交絡を検討した。',
  displayRecommendation: true,
  evidencePageIds: ['page-2'],
  evidenceSegmentIds: [],
  lectureRecap: ['比較群の設定を確認した。', '交絡要因を踏まえて解釈する。'],
  sourceCoverage: { comments: true, pdf: true, transcript: false },
}
const providerResponse = {
  id: 'resp_synthetic_handler',
  output: [
    { content: [{ text: JSON.stringify(output), type: 'output_text' }] },
  ],
  status: 'completed',
  usage: { input_tokens: 500, output_tokens: 100 },
}
type RpcResult = { data: unknown; error: unknown }
type RpcCall = { name: string; args: Record<string, unknown> }
type Scenario = {
  claim?: RpcResult
  completion?: RpcResult
  preflight?: RpcResult
  replay?: boolean
  provider?: () => Promise<Response>
}

// Execute the deployed entrypoint and its real shared modules, not a re-created
// happy path. Only remote identity/RPC/provider boundaries are replaced. No
// process environment or network implementation is exposed to this VM.
function harness(scenario: Scenario = {}) {
  const rpcCalls: RpcCall[] = []
  const providerCalls: Array<{ url: string; init: RequestInit }> = []
  const results: Record<string, RpcResult> = {
    reap_stale_google_ai_provider_dispatches_v1: { data: 0, error: null },
    prepare_google_admin_summary_window_v1: scenario.preflight ?? {
      data: {
        accepted: true,
        commentContext: {
          comment_count: 3,
          comments: [1, 2, 3].map((i) => ({
            comment_id: uuid(20 + i),
            text: pageText,
          })),
        },
        expectedAttempt: 1,
        materialContext: null,
        preflightContextDigest: 'b'.repeat(64),
        previousSummary: [],
        resultStatus: 'prepared',
        window: {
          id: uuid(6),
          requested_language: 'ja',
          window_start: '2026-09-01T00:00:00Z',
          window_end: '2026-09-01T00:05:00Z',
        },
      },
      error: null,
    },
    issue_google_summary_ai_child_grant_v1: {
      data: {
        accepted: true,
        grant_id: uuid(7),
        providerIntentDigest: 'c'.repeat(64),
      },
      error: null,
    },
    start_google_admin_summary_window_operation_v1: {
      data: {
        accepted: true,
        actorId: `admin-session:${uuid(9)}`,
        idempotentReplay: scenario.replay ?? false,
        operationId,
      },
      error: null,
    },
    claim_google_ai_provider_dispatch_v1: scenario.claim ?? {
      data: {
        accepted: true,
        clientRequestId: startRequestId,
        dispatchAllowed: true,
        operationId,
      },
      error: null,
    },
    complete_google_admin_summary_window_operation_v1: scenario.completion ?? {
      data: {
        accepted: true,
        result_saved: true,
        results: { lecture_recap: output.lectureRecap },
      },
      error: null,
    },
    fail_google_admin_summary_window_operation_v1: {
      data: { accepted: true },
      error: null,
    },
  }
  const environment: Record<string, string> = {
    ADMIN_AI_CHILD_GRANT_SECRET: 'synthetic-child-grant-key-not-a-real-secret',
    ADMIN_AI_CHILD_GRANT_SECRET_VERSION: '1',
    COMPASS_EDGE_ALLOWED_ORIGINS: 'https://example.test',
    OPENAI_API_KEY: 'synthetic-provider-key',
    PHASE6_SUMMARIES_ENABLED: 'true',
    PHASE7_1_CLASSROOM_EXTENSIONS_ENABLED: 'true',
  }
  let handler: ((request: Request) => Promise<Response>) | undefined
  const context = vm.createContext({
    AbortSignal,
    crypto,
    DOMException,
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
      env: { get: (name: string) => environment[name] },
      serve: (callback: typeof handler) => {
        handler = callback
      },
    },
    fetch: async (url: string, init: RequestInit) => {
      providerCalls.push({ url, init })
      return scenario.provider
        ? scenario.provider()
        : Response.json(providerResponse)
    },
  })
  const modules = new Map<string, { exports: unknown }>()
  function loadModule(filename: string): unknown {
    const cached = modules.get(filename)
    if (cached) return cached.exports
    const module = { exports: {} }
    modules.set(filename, module)
    const compiled = ts.transpileModule(readFileSync(filename, 'utf8'), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        alwaysStrict: true,
      },
      fileName: filename,
    }).outputText
    const requireModule = (specifier: string) => {
      assert.ok(
        specifier.startsWith('.'),
        `Unexpected external import: ${specifier}`,
      )
      const target = path.resolve(path.dirname(filename), specifier)
      assert.ok(
        target.startsWith(root),
        'Only repository Edge sources may be loaded',
      )
      if (target === path.join(root, '_shared', 'googleAdminOperations.ts')) {
        return {
          verifyGoogleAdminOperationRequest: async () => ({
            ok: true,
            authUserId: uuid(10),
            googleIssuer: 'https://accounts.google.com',
            googleSubjectHmac: 'd'.repeat(64),
            subjectPepperVersion: 1,
            supabaseAuthSessionId: uuid(11),
            appSessionTokenHash: 'e'.repeat(64),
            transportEnabled: true,
            serviceClient: {
              rpc: async (name: string, args: Record<string, unknown>) => {
                rpcCalls.push({ name, args: JSON.parse(JSON.stringify(args)) })
                assert.ok(name in results, `Unexpected RPC: ${name}`)
                return results[name]
              },
            },
          }),
        }
      }
      return loadModule(target)
    }
    new vm.Script(`(function(require, module, exports) {${compiled}\n})`, {
      filename,
    }).runInContext(context)(requireModule, module, module.exports)
    return module.exports
  }
  loadModule(path.join(root, 'generate-lecture-summary', 'index.ts'))
  assert.ok(handler, 'Deno.serve must register the actual entrypoint')
  return {
    providerCalls,
    rpcCalls,
    invoke: () =>
      handler!(
        new Request('https://example.test/generate-lecture-summary', {
          method: 'POST',
          headers: {
            Origin: 'https://example.test',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(requestBody),
        }),
      ),
  }
}

test('actual summary handler authorizes, dispatches once, and publishes structured output', async () => {
  const h = harness()
  const response = await h.invoke()
  const body = await response.json()
  assert.equal(response.status, 200, JSON.stringify(body))
  assert.equal(body.published, true)
  assert.deepEqual(body.results.lecture_recap, output.lectureRecap)
  assert.equal(body.actualInputTokens, 500)
  assert.equal(body.actualOutputTokens, 100)
  assert.equal(body.actualMicrousd, 1100)
  assert.equal(h.providerCalls.length, 1)
  assert.equal(h.providerCalls[0].url, 'https://api.openai.com/v1/responses')
  const sent = JSON.parse(h.providerCalls[0].init.body as string)
  assert.equal(sent.max_output_tokens, 1200)
  assert.equal(sent.store, false)
  const authorizations = h.rpcCalls.filter(
    (call) => 'target_max_output_tokens' in call.args,
  )
  assert.equal(authorizations.length, 2)
  for (const call of authorizations)
    assert.equal(call.args.target_max_output_tokens, 1200)
  const completion = h.rpcCalls.find((call) =>
    call.name.startsWith('complete_'),
  )!
  assert.equal(completion.args.target_operation_id, operationId)
  assert.equal(completion.args.publish_recommended, true)
  assert.equal(completion.args.actual_microusd, body.actualMicrousd)
  assert.equal(
    h.rpcCalls.some((call) => call.name.startsWith('fail_')),
    false,
  )
})

test('a dispatch already owned by another retry is neither repeated nor failed', async () => {
  const h = harness({
    replay: true,
    claim: {
      data: {
        accepted: true,
        clientRequestId: startRequestId,
        dispatchAllowed: false,
        operationId,
      },
      error: null,
    },
  })
  const response = await h.invoke()
  assert.equal(response.status, 409)
  assert.equal((await response.json()).code, 'operation_in_progress')
  assert.equal(h.providerCalls.length, 0)
  assert.equal(
    h.rpcCalls.some((call) => call.name.startsWith('fail_')),
    false,
  )
})

test('provider rate limits settle zero known usage without an automatic paid retry', async () => {
  const h = harness({
    provider: async () => new Response(null, { status: 429 }),
  })
  const response = await h.invoke()
  assert.equal(response.status, 429)
  assert.equal((await response.json()).code, 'provider_http_429')
  assert.equal(h.providerCalls.length, 1)
  const failure = h.rpcCalls.find((call) => call.name.startsWith('fail_'))!
  assert.equal(failure.args.actual_microusd, 0)
  assert.equal(failure.args.provider_request_id, startRequestId)
})

test('provider timeout reserves conservative usage and never dispatches twice', async () => {
  const h = harness({
    provider: async () => {
      throw new DOMException('synthetic timeout', 'TimeoutError')
    },
  })
  assert.equal((await h.invoke()).status, 502)
  assert.equal(h.providerCalls.length, 1)
  const failure = h.rpcCalls.find((call) => call.name.startsWith('fail_'))!
  const start = h.rpcCalls.find((call) => call.name.startsWith('start_'))!
  assert.equal(
    failure.args.actual_microusd,
    start.args.target_estimated_microusd,
  )
  assert.equal(failure.args.error_code, 'provider_timeout_ambiguous')
})

test('invalid structured output records known usage without publication or retry', async () => {
  const h = harness({
    provider: async () =>
      Response.json({
        ...providerResponse,
        output: [{ content: [{ type: 'output_text', text: '{' }] }],
      }),
  })
  assert.equal((await h.invoke()).status, 502)
  assert.equal(h.providerCalls.length, 1)
  assert.equal(
    h.rpcCalls.some((call) => call.name.startsWith('complete_')),
    false,
  )
  const failure = h.rpcCalls.find((call) => call.name.startsWith('fail_'))!
  assert.equal(failure.args.actual_microusd, 1100)
})

test('a finalized preflight replay returns without authorization or paid dispatch', async () => {
  const h = harness({
    preflight: {
      data: {
        accepted: true,
        resultStatus: 'final',
        windowId: uuid(6),
        windowStatus: 'succeeded',
      },
      error: null,
    },
  })
  const response = await h.invoke()
  assert.equal(response.status, 200)
  assert.equal((await response.json()).idempotentReplay, true)
  assert.equal(h.providerCalls.length, 0)
  assert.equal(h.rpcCalls.length, 2)
})

for (const windowStatus of ['succeeded', 'skipped', 'discarded']) {
  test(`prepared receipt replay for ${windowStatus} returns an ACK without paid dispatch`, async () => {
    const h = harness({
      preflight: {
        data: {
          accepted: true,
          idempotentReplay: true,
          refreshRequired: true,
          resultStatus: 'prepared',
          windowId: uuid(6),
          windowStatus,
        },
        error: null,
      },
    })
    const response = await h.invoke()
    const body = await response.json()
    assert.equal(response.status, 200, JSON.stringify(body))
    assert.equal(body.idempotentReplay, true)
    assert.equal(body.refreshRequired, true)
    assert.equal(body.results, null)
    assert.equal(body.skipped, windowStatus === 'skipped')
    assert.equal(body.windowId, uuid(6))
    assert.equal(h.providerCalls.length, 0)
    assert.deepEqual(
      h.rpcCalls.map((call) => call.name),
      [
        'reap_stale_google_ai_provider_dispatches_v1',
        'prepare_google_admin_summary_window_v1',
      ],
    )
  })
}

for (const windowStatus of ['failed', 'running', 'pending']) {
  test(`${windowStatus} refresh is not a terminal success or a new paid attempt`, async () => {
    const h = harness({
      preflight: {
        data: {
          accepted: true,
          idempotentReplay: true,
          refreshRequired: true,
          resultStatus: 'prepared',
          windowStatus,
        },
        error: null,
      },
    })
    const response = await h.invoke()
    assert.equal(response.status, 409)
    assert.equal(
      (await response.json()).code,
      'summary_preflight_refresh_required',
    )
    assert.equal(h.providerCalls.length, 0)
    assert.equal(h.rpcCalls.length, 2)
  })
}

test('context refresh without a replay remains rejected', async () => {
  const h = harness({
    preflight: {
      data: {
        accepted: true,
        idempotentReplay: false,
        refreshRequired: true,
        resultStatus: 'prepared',
        windowStatus: 'succeeded',
      },
      error: null,
    },
  })
  assert.equal((await h.invoke()).status, 409)
  assert.equal(h.providerCalls.length, 0)
})
