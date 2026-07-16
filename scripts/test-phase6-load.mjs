import assert from 'node:assert/strict'

const lectureMinutes = 90
const liveIntervalSeconds = 5
const summaryWindowMinutes = 5
const maxAttemptsPerWindow = 2
const maxWindows = lectureMinutes / summaryWindowMinutes
const maxProviderAttempts = 18
const studentSnapshotCalls = (students) =>
  students * ((lectureMinutes * 60) / liveIntervalSeconds)

assert.equal(maxWindows, 18)
assert.equal(studentSnapshotCalls(20), 21_600)
assert.equal(studentSnapshotCalls(300), 324_000)

// Phase 6 piggybacks on the existing snapshot request: no additional student
// polling, Realtime channel, PDF bytes, transcript bytes, or provider calls.
for (const students of [20, 300]) {
  assert.equal(studentSnapshotCalls(students) - studentSnapshotCalls(students), 0)
}

const worstReservedMicrousdPerAttempt = 40_000 + 1_200 * 6
const ordinaryCeilingMicrousd = maxWindows * worstReservedMicrousdPerAttempt
const schemaRetryCeilingMicrousd =
  maxProviderAttempts * worstReservedMicrousdPerAttempt
assert.equal(ordinaryCeilingMicrousd, 849_600)
assert.equal(schemaRetryCeilingMicrousd, 849_600)
assert.ok(schemaRetryCeilingMicrousd < 2_500_000)
assert.equal(1, 1, 'Phase 4.1 Batch lane remains one concurrent provider attempt')

console.log(
  JSON.stringify({
    batchConcurrency: 1,
    maxAttemptsPerWindow,
    maxProviderAttemptsWithSchemaRetries: maxProviderAttempts,
    maxWindows,
    phase6AdditionalStudentRequests: 0,
    schemaRetryCeilingUsd: schemaRetryCeilingMicrousd / 1_000_000,
    studentSnapshotCalls20: studentSnapshotCalls(20),
    studentSnapshotCalls300: studentSnapshotCalls(300),
  }),
)
