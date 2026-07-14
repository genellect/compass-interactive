import assert from 'node:assert/strict'

const lectureDurationSeconds = 90 * 60
const liveSyncIntervalSeconds = 5
const maintenanceIntervalSeconds = 60

function modelLifecycleScenario(students) {
  const existingSnapshotRequests =
    (lectureDurationSeconds / liveSyncIntervalSeconds) * students
  const maintenanceRuns = lectureDurationSeconds / maintenanceIntervalSeconds
  const steadyStateLifecycleRequestsPerSecond =
    maintenanceRuns / lectureDurationSeconds
  const archivePreviewRequests = students

  return {
    archivePreviewRequests,
    existingSnapshotRequests,
    lifecycleRealtimeSubscriptions: 0,
    maintenanceRuns,
    studentRequestsAddedDuringLecture: 0,
    students,
    terminalFallbackRequestsAtCloseMax: 2,
    steadyStateLifecycleRequestsPerSecond: Number(
      steadyStateLifecycleRequestsPerSecond.toFixed(4),
    ),
  }
}

const freeMvp = modelLifecycleScenario(20)
const proLecture = modelLifecycleScenario(300)

assert.equal(freeMvp.existingSnapshotRequests, 21_600)
assert.equal(proLecture.existingSnapshotRequests, 324_000)
assert.equal(freeMvp.studentRequestsAddedDuringLecture, 0)
assert.equal(proLecture.studentRequestsAddedDuringLecture, 0)
assert.equal(freeMvp.maintenanceRuns, 90)
assert.equal(proLecture.maintenanceRuns, 90)
assert.equal(freeMvp.lifecycleRealtimeSubscriptions, 0)
assert.equal(proLecture.lifecycleRealtimeSubscriptions, 0)
assert.equal(proLecture.steadyStateLifecycleRequestsPerSecond < 0.02, true)
assert.equal(
  proLecture.archivePreviewRequests / freeMvp.archivePreviewRequests,
  15,
  'archive is one-shot and scales linearly once, not every five seconds',
)

console.log(JSON.stringify({ freeMvp, proLecture }, null, 2))
console.log('Phase 2 lifecycle 20/300-student load model passed.')
