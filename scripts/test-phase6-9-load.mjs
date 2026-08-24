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
assert.match(liveSyncPolicy, /STUDENT_LIVE_SYNC_INTERVAL_MS\s*=\s*5_000/)
assert.match(liveSyncPolicy, /STUDENT_LIVE_SYNC_INITIAL_JITTER_MS\s*=\s*5_000/)
assert.match(liveSyncPolicy, /STUDENT_LIVE_SYNC_JITTER_MS\s*=\s*0/)
assert.match(liveSyncPolicy, /LIVE_SYNC_JITTER_MS\s*=\s*1_000/)
assert.match(context, /\.\.\.getLiveSyncRouteOptions\(normalizedPathname\)/)
assert.match(
  liveSyncPolicy,
  /pathname === '\/lecture'[\s\S]*?foregroundIntervalMs: STUDENT_LIVE_SYNC_INTERVAL_MS[\s\S]*?initialJitterMs: STUDENT_LIVE_SYNC_INITIAL_JITTER_MS[\s\S]*?jitterMs: STUDENT_LIVE_SYNC_JITTER_MS[\s\S]*?runImmediately: true[\s\S]*?visibilityJitterMs: STUDENT_LIVE_SYNC_INITIAL_JITTER_MS/,
)
assert.match(
  adaptiveSync,
  /scheduleSync\(\s*getLiveSyncJitter\(Math\.random\(\), visibilityJitterMs\)/,
)
assert.match(adaptiveSync, /Math\.max\(backoffDelay - completedRequestMs, 0\)/)
assert.match(
  adaptiveSync,
  /const syncStartedAt = Date\.now\(\)[\s\S]*scheduleForegroundSync\(syncStartedAt\)/,
)

const scenarios = [20, 300].map((students) => ({
  additionalPeriodicRequestsPerStudent: 0,
  additionalRealtimeSubscriptionsPerStudent: 0,
  modeledSnapshotRequests: students * Math.ceil((90 * 60 * 1_000) / 5_000),
  modeledStartupRequests: students,
  students,
}))
assert.deepEqual(
  scenarios.map((scenario) => scenario.modeledSnapshotRequests),
  [21_600, 324_000],
)
assert.equal(
  scenarios[1].modeledSnapshotRequests,
  324_000,
  'the 300-student periodic request envelope remains unchanged',
)
assert.equal(scenarios[1].modeledStartupRequests, 300)

console.log(JSON.stringify({ scenarios }))
console.log('Phase 6.9 preserves the student five-second request envelope.')
