import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'
import * as mappers from '../src/repositories/supabase/adminMappers.ts'
import * as requestPolicy from '../src/repositories/supabase/requestPolicy.ts'
import { getDueSummaryWindows } from '../src/summary/summaryWindow.ts'
import type { supabaseAdminRepository } from '../src/repositories/supabaseAdminRepository.ts'

type GenerateRequest = Parameters<
  typeof supabaseAdminRepository.generateLectureSummary
>[0]
type WireResponse = { data: Record<string, unknown> | null; error: unknown }
const runId = '10000000-0000-4000-8000-000000000001'
const request: GenerateRequest = {
  adminToken: { appSessionToken: 'synthetic-app-session', kind: 'google' },
  grantRequestId: '10000000-0000-4000-8000-000000000002',
  lectureSessionId: '10000000-0000-4000-8000-000000000003',
  pdfContext: null,
  preflightRequestId: '10000000-0000-4000-8000-000000000004',
  runToken: `${runId}.synthetic-run-nonce`,
  startRequestId: '10000000-0000-4000-8000-000000000005',
  transcriptSegments: [],
  windowIndex: 1,
}
const ack = {
  data: {
    ok: true,
    idempotentReplay: true,
    refreshRequired: true,
    results: null,
    windowId: 'synthetic-window',
  },
  error: null,
}

function snapshot(status = 'succeeded', visibility = 'public') {
  return {
    control: { summary_calls_used: 1, summary_call_limit: 18 },
    run: { id: runId, status: 'running', last_window_index: 1 },
    summaries:
      status === 'succeeded'
        ? [
            {
              id: 'synthetic-summary',
              window_index: 1,
              window_id: 'synthetic-window',
              ai_output: {
                lecture_recap: ['比較群と交絡を確認しました。'],
                comment_pulse: [],
              },
              publication: { visibility },
              status: visibility === 'public' ? 'published' : 'hidden',
            },
          ]
        : [],
    windows: [
      { id: 'synthetic-window', window_index: 1, status, attempt_count: 1 },
    ],
  }
}

// Load the actual repository and mappers. Only the network transport and unrelated
// repository facades are replaced; neither credentials nor live fetch are exposed.
function harness(responses: WireResponse[]) {
  const calls: Array<{
    name: string
    options: { body: Record<string, unknown>; timeout: number }
  }> = []
  const compiled = ts.transpileModule(
    readFileSync(
      new URL(
        '../src/repositories/supabaseAdminRepository.ts',
        import.meta.url,
      ),
      'utf8',
    ),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
    },
  ).outputText
  const module = {
    exports: {} as { supabaseAdminRepository: typeof supabaseAdminRepository },
  }
  const context = vm.createContext({ Error, Response })
  const requireModule = (specifier: string) => {
    if (specifier === './supabase/adminMappers') return mappers
    if (specifier === './supabase/requestPolicy') return requestPolicy
    if (specifier === './supabase/transport')
      return {
        invokeEdgeFunction: async (
          name: string,
          options: (typeof calls)[number]['options'],
        ) => {
          calls.push({ name, options })
          assert.ok(responses.length, 'Unexpected additional transport call')
          return responses.shift()!
        },
      }
    assert.ok(
      [
        './supabase/aiActivationIntentRepository',
        './supabase/aiMasterAuthorizationRepository',
        './supabase/adminContentAiRepository',
      ].includes(specifier),
      `Unexpected dependency: ${specifier}`,
    )
    return {}
  }
  new vm.Script(
    `(function(require, module, exports) {${compiled}\n})`,
  ).runInContext(context)(requireModule, module, module.exports)
  return {
    calls,
    generate: () =>
      module.exports.supabaseAdminRepository.generateLectureSummary(request),
  }
}

test('lost success response reuses exact request IDs, restores publication, and leaves no due repeat', async () => {
  const h = harness([
    { data: null, error: new Error('synthetic lost response') },
    ack,
    { data: { ok: true, results: snapshot() }, error: null },
  ])
  const result = await h.generate()
  assert.deepEqual(
    h.calls.map((call) => call.name),
    [
      'generate-lecture-summary',
      'generate-lecture-summary',
      'manage-lecture-summaries',
    ],
  )
  assert.equal(h.calls[0].options.body, request)
  assert.equal(h.calls[1].options.body, request)
  assert.equal(h.calls[0].options.timeout, 65_000)
  assert.equal(h.calls[2].options.timeout, 15_000)
  assert.deepEqual(JSON.parse(JSON.stringify(h.calls[2].options.body)), {
    action: 'status',
    adminToken: request.adminToken,
    lectureSessionId: request.lectureSessionId,
  })
  assert.equal(result.published, true)
  assert.equal(result.skipped, false)
  assert.equal(result.results.control?.summaryCallsUsed, 1)
  assert.equal(result.results.control?.summaryCallLimit, 18)
  assert.deepEqual(result.results.summaries[0].aiOutput.lectureRecap, [
    '比較群と交絡を確認しました。',
  ])
  assert.deepEqual(
    getDueSummaryWindows({
      startedAt: '2026-09-01T00:00:00Z',
      hardStopAt: '2026-09-01T01:30:00Z',
      serverNow: '2026-09-01T00:05:30Z',
      processedWindowIndexes: new Set(
        result.results.windows
          .filter((window) =>
            ['succeeded', 'skipped', 'discarded'].includes(window.status),
          )
          .map((window) => window.windowIndex),
      ),
    }),
    [],
  )
})

for (const status of ['skipped', 'discarded']) {
  test(`${status} receipt restores terminal window without a generate retry`, async () => {
    const h = harness([
      ack,
      { data: { ok: true, results: snapshot(status) }, error: null },
    ])
    const result = await h.generate()
    assert.equal(result.skipped, status === 'skipped')
    assert.equal(result.published, false)
    assert.equal(result.results.windows[0].status, status)
    assert.equal(h.calls.length, 2)
  })
}

test('replayed hidden summary stays hidden instead of trusting an old published flag', async () => {
  const h = harness([
    { ...ack, data: { ...ack.data, published: true } },
    {
      data: { ok: true, results: snapshot('succeeded', 'hidden') },
      error: null,
    },
  ])
  assert.equal((await h.generate()).published, false)
})

test('same-index windows from another prompt cannot replace the acknowledged window', async () => {
  const current = snapshot()
  const h = harness([
    ack,
    {
      data: {
        ok: true,
        results: {
          ...current,
          windows: [
            { id: 'other-window', window_index: 1, status: 'failed' },
            ...current.windows,
          ],
          summaries: [
            {
              ...current.summaries[0],
              id: 'other-summary',
              window_id: 'other-window',
              publication: { visibility: 'hidden' },
            },
            ...current.summaries,
          ],
        },
      },
      error: null,
    },
  ])
  assert.equal((await h.generate()).published, true)
})

for (const scope of ['window', 'summary']) {
  test(`same-index but different ${scope} ID cannot produce a false success`, async () => {
    const current = snapshot()
    const h = harness([
      ack,
      {
        data: {
          ok: true,
          results: {
            ...current,
            ...(scope === 'window'
              ? { windows: [{ ...current.windows[0], id: 'other-window' }] }
              : {
                  summaries: [
                    { ...current.summaries[0], window_id: 'other-window' },
                  ],
                }),
          },
        },
        error: null,
      },
    ])
    await assert.rejects(h.generate(), /作成済みの要約を確認できませんでした/)
    assert.equal(h.calls.length, 2)
  })
}

for (const [label, response] of Object.entries({
  transport: { data: null, error: new Error('synthetic status unavailable') },
  rejected: { data: { ok: false }, error: null },
  missing: { data: { ok: true }, error: null },
  empty: { data: { ok: true, results: {} }, error: null },
  wrongWindow: {
    data: {
      ok: true,
      results: {
        ...snapshot(),
        windows: [{ window_index: 2, status: 'succeeded' }],
      },
    },
    error: null,
  },
  wrongRun: {
    data: {
      ok: true,
      results: { ...snapshot(), run: { id: 'different-run' } },
    },
    error: null,
  },
  noSummary: {
    data: { ok: true, results: { ...snapshot(), summaries: [] } },
    error: null,
  },
  failed: { data: { ok: true, results: snapshot('failed') }, error: null },
  running: { data: { ok: true, results: snapshot('running') }, error: null },
})) {
  test(`status ${label} never replaces prior results with an empty success`, async () => {
    const h = harness([ack, response])
    await assert.rejects(h.generate(), /作成済みの要約を確認できませんでした/)
    assert.equal(h.calls.length, 2)
  })
}

test('normal structured success needs no status request', async () => {
  const h = harness([
    {
      data: {
        ok: true,
        results: snapshot(),
        published: true,
        actualMicrousd: 1100,
      },
      error: null,
    },
  ])
  const result = await h.generate()
  assert.equal(result.published, true)
  assert.equal(result.actualMicrousd, 1100)
  assert.equal(h.calls.length, 1)
})

test('success without results and without refresh metadata is not an empty success', async () => {
  const h = harness([{ data: { ok: true }, error: null }])
  await assert.rejects(h.generate(), /要約の結果を受信できませんでした/)
  assert.equal(h.calls.length, 1)
})
