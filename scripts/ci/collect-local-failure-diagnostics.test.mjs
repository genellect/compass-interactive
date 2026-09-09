import assert from 'node:assert/strict'
import test from 'node:test'
import {
  collectLocalFailureDiagnostics,
  summarizeLocalErrors,
} from './collect-local-failure-diagnostics.mjs'

test('retains useful error categories without any raw values', () => {
  const report = summarizeLocalErrors(
    [
      '2026-09-09T14:36:00.123Z ERROR: deadlock detected; token=synthetic-private-value',
      'DETAIL: SQL parameter synthetic-private-value',
      '2026-09-09T14:36:01Z ERROR: cache lookup failed for type 123456',
      '2026-09-09T14:36:02Z ERROR: unrecognized-message synthetic-private-value',
      'normal request synthetic-private-value',
      '2026-09-09T14:36:03Z INFO: schema cache loaded successfully',
    ].join('\n'),
  )
  assert.deepEqual(report, {
    matchedLines: 3,
    events: [
      { timestamp: '2026-09-09T14:36:00.123Z', categories: ['deadlock'] },
      { timestamp: '2026-09-09T14:36:01Z', categories: ['stale-type-cache'] },
      { timestamp: '2026-09-09T14:36:02Z', categories: ['unclassified-error'] },
    ],
    truncated: false,
  })
  assert.doesNotMatch(
    JSON.stringify(report),
    /synthetic-private-value|123456|unrecognized-message/,
  )
})

test('bounds output and reports that further matching lines were omitted', () => {
  const report = summarizeLocalErrors(
    [
      ...Array(104).fill('ERROR: deadlock detected'),
      'ERROR: connection refused',
    ].join('\n'),
  )
  assert.equal(report.matchedLines, 105)
  assert.equal(report.events.length, 100)
  assert.deepEqual(report.events.at(-1).categories, ['connection-unavailable'])
  assert.equal(report.truncated, true)
})

for (const [message, category] of [
  ['40001', 'serialization-failure'],
  ['57014', 'query-canceled'],
  ['55P03', 'lock-not-available'],
  ['PGRST202', 'schema-cache'],
  ['PGRST002', 'connection-unavailable'],
  ['FATAL: unknown secret', 'unclassified-error'],
]) {
  test(`classifies ${category} without keeping the message`, () => {
    assert.deepEqual(summarizeLocalErrors(message).events, [
      { timestamp: null, categories: [category] },
    ])
  })
}

test('only reads the discovered local pair with bounded log requests', () => {
  const calls = []
  const report = collectLocalFailureDiagnostics((args) => {
    calls.push(args)
    if (args[0] === 'ps')
      return 'supabase_db_test-project\nsupabase_rest_test-project'
    if (args.at(-1) === 'supabase_rest_test-project')
      throw new Error('secret stderr')
    return 'ERROR: deadlock detected'
  })
  assert.equal(report.db.capture, 'complete')
  assert.deepEqual(report.rest, { capture: 'unavailable' })
  assert.deepEqual(calls.slice(1), [
    [
      'logs',
      '--timestamps',
      '--since',
      '30m',
      '--tail',
      '4000',
      'supabase_db_test-project',
    ],
    [
      'logs',
      '--timestamps',
      '--since',
      '30m',
      '--tail',
      '4000',
      'supabase_rest_test-project',
    ],
  ])
  assert.doesNotMatch(JSON.stringify(report), /secret stderr/)
})

for (const names of [
  'supabase_db_test',
  'supabase_db_test\nsupabase_rest_other',
  'supabase_db_test\nsupabase_rest_test\nsupabase_db_extra',
  'supabase_db_bad/name\nsupabase_rest_bad/name',
]) {
  test(`rejects an ambiguous or unsafe container pair: ${names.replaceAll('\n', ',')}`, () => {
    let calls = 0
    assert.throws(
      () =>
        collectLocalFailureDiagnostics(() => {
          calls += 1
          return names
        }),
      /same project/,
    )
    assert.equal(calls, 1)
  })
}
