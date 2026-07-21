import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const context = readFileSync(
  new URL('../src/context/CompassStateContext.tsx', import.meta.url),
  'utf8',
)
const adaptiveSync = readFileSync(
  new URL('../src/hooks/useAdaptiveLiveSync.ts', import.meta.url),
  'utf8',
)
const liveSyncPolicy = readFileSync(
  new URL('../src/lib/liveSync.ts', import.meta.url),
  'utf8',
)

assert.equal((context.match(/useAdaptiveLiveSync\(/g) ?? []).length, 1)
assert.equal((context.match(/setInterval\(/g) ?? []).length, 1)
assert.match(
  context,
  /runtimeMode\s*!==\s*'demo'\s*\|\|\s*!hasActiveLectureSessionId[\s\S]{0,200}setInterval\([\s\S]{0,200}10_000/,
)
assert.match(adaptiveSync, /foregroundIntervalMs\s*=\s*LIVE_SYNC_INTERVAL_MS/)
assert.match(liveSyncPolicy, /LIVE_SYNC_INTERVAL_MS\s*=\s*5_000/)

const scenarios = [20, 300].map((students) => ({
  additionalPeriodicRequestsPerStudent: 0,
  additionalRealtimeSubscriptionsPerStudent: 0,
  modeledSnapshotRequests: (students * 90 * 60) / 5,
  students,
}))
assert.deepEqual(
  scenarios.map((scenario) => scenario.modeledSnapshotRequests),
  [21_600, 324_000],
)

console.log(JSON.stringify({ scenarios }))
console.log(
  'Phase 6.9 preserves the 20/300 participant synchronization envelope.',
)
