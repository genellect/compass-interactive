import assert from 'node:assert/strict'
import {
  createServerClockSample,
  estimateServerTimeMs,
  getDeadlineRefreshDelayMs,
  isLifecycleRequestCurrent,
  removePendingComments,
} from '../src/lib/lectureLifecycle.ts'

const sample = createServerClockSample('2026-07-14T00:00:00.000Z', 1_000)
assert.ok(sample)
assert.equal(
  estimateServerTimeMs(sample, 6_000),
  Date.parse('2026-07-14T00:00:05.000Z'),
  'server estimate advances from monotonic time',
)
assert.equal(
  getDeadlineRefreshDelayMs({
    hardStopAt: '2026-07-14T00:01:30.000Z',
    monotonicNowMs: 6_000,
    sample,
  }),
  85_000,
  'deadline delay uses server time, not Date.now()',
)
assert.equal(
  getDeadlineRefreshDelayMs({
    hardStopAt: '2026-07-13T23:59:59.000Z',
    monotonicNowMs: 6_000,
    sample,
  }),
  0,
  'past deadline refreshes immediately',
)
assert.equal(
  createServerClockSample('invalid', 1_000),
  null,
  'invalid server timestamp is rejected',
)

const comments = [
  { id: 'saved', isPending: false },
  { id: 'pending', isPending: true },
]
assert.deepEqual(
  removePendingComments(comments),
  [{ id: 'saved', isPending: false }],
  'terminal convergence removes pending optimistic comments',
)
assert.equal(isLifecycleRequestCurrent(4, 4), true)
assert.equal(
  isLifecycleRequestCurrent(4, 5),
  false,
  'a response from before lecture close is discarded',
)

console.log('Phase 2 lifecycle frontend tests passed.')
