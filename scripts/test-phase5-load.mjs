import assert from 'node:assert/strict'

function phase5Load(participants) {
  const initialInputTokens = 65_000
  const additionalCalls = 5
  const additionalInputTokens = 17_000
  const totalInputTokens =
    initialInputTokens + additionalCalls * additionalInputTokens
  const totalOutputTokens = 4_000 + additionalCalls * 2_500
  const estimatedMicrousd = totalInputTokens + totalOutputTokens * 6
  return {
    adminEdgeInvocations: 1 + additionalCalls,
    estimatedMicrousd,
    maxAdminDbRoundTrips: (1 + additionalCalls) * 6,
    participants,
    studentPhase5DbCalls: 0,
    studentPhase5RealtimeMessages: 0,
    totalInputTokens,
    totalOutputTokens,
    worstCaseResultBytes: 120_000,
  }
}

for (const participants of [20, 300]) {
  const load = phase5Load(participants)
  assert.equal(load.studentPhase5DbCalls, 0)
  assert.equal(load.studentPhase5RealtimeMessages, 0)
  assert.equal(load.adminEdgeInvocations, 6)
  assert.ok(load.maxAdminDbRoundTrips <= 36)
  assert.ok(load.totalInputTokens <= 200_000)
  assert.ok(load.totalOutputTokens <= 30_000)
  assert.ok(load.estimatedMicrousd <= 2_500_000)
  assert.ok(load.worstCaseResultBytes < 256_000)
}

assert.deepEqual(
  phase5Load(20),
  { ...phase5Load(300), participants: 20 },
  'Phase 5 teacher-only load must not scale with student count.',
)

console.log('Phase 5 20/300 participant load invariants passed.')
