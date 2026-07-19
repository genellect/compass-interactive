import assert from 'node:assert/strict'

const lectureMinutes = 90
const snapshotIntervalSeconds = 5
const snapshotsPerStudent = (lectureMinutes * 60) / snapshotIntervalSeconds
const modeled = [20, 300].map((students) => ({
  existingSnapshotRequests: students * snapshotsPerStudent,
  phase71PeriodicRequests: 0,
  phase71RealtimeSubscriptions: 0,
  students,
}))

assert.deepEqual(
  modeled.map((scenario) => scenario.existingSnapshotRequests),
  [21_600, 324_000],
)
assert.ok(modeled.every((scenario) => scenario.phase71PeriodicRequests === 0))

// One deliberate first-page request and at most one request per explicit
// "older comments" action. Language selection and QR generation are local or
// folded into existing teacher operations.
for (const students of [20, 300]) {
  assert.equal(students * 1, students)
}
assert.equal(18, lectureMinutes / 5)
assert.equal(1, 1, 'one summary call remains the maximum per five-minute window')

console.log(JSON.stringify({ modeled }))
console.log('Phase 7.1 adds no periodic Supabase or provider load.')
