import assert from 'node:assert/strict'

const lectureSeconds = 90 * 60
const snapshotIntervalSeconds = 5
const captionPublishIntervalSeconds = 5
const heartbeatIntervalSeconds = 15

function modelPhase4(students) {
  return {
    edgeBillingAuthorizations: 1,
    edgeClientSecretIssues: 1,
    edgeHeartbeatInvocations: lectureSeconds / heartbeatIntervalSeconds,
    edgePublishInvocations: lectureSeconds / captionPublishIntervalSeconds,
    localRealtimeDeltaEventsInSupabase: 0,
    realtimeSubscriptionsAdded: 0,
    studentCaptionBytesStored: 0,
    studentSnapshotRequests:
      (lectureSeconds / snapshotIntervalSeconds) * students,
    students,
    supabaseCaptionRowsPerLecture: 1,
    supabaseCaptionWritesWorstCase:
      lectureSeconds / captionPublishIntervalSeconds,
  }
}

const freeMvp = modelPhase4(20)
const proLecture = modelPhase4(300)

assert.equal(freeMvp.studentSnapshotRequests, 21_600)
assert.equal(proLecture.studentSnapshotRequests, 324_000)
assert.equal(proLecture.realtimeSubscriptionsAdded, 0)
assert.equal(proLecture.localRealtimeDeltaEventsInSupabase, 0)
assert.equal(proLecture.studentCaptionBytesStored, 0)
assert.equal(proLecture.supabaseCaptionRowsPerLecture, 1)
assert.equal(proLecture.supabaseCaptionWritesWorstCase, 1_080)
assert.equal(proLecture.edgeHeartbeatInvocations, 360)
assert.equal(
  freeMvp.supabaseCaptionWritesWorstCase,
  proLecture.supabaseCaptionWritesWorstCase,
  'caption write load is independent of class size',
)
assert.ok(
  proLecture.supabaseCaptionWritesWorstCase /
    proLecture.studentSnapshotRequests <
    0.004,
)

console.log(JSON.stringify({ freeMvp, proLecture }, null, 2))
console.log('Phase 4 20/300-student, 90-minute load model passed.')
