import assert from 'node:assert/strict'

function modelLecture(students) {
  const minutes = 90
  const snapshotIntervalSeconds = 5
  const existingStudentSnapshots =
    students * minutes * (60 / snapshotIntervalSeconds)

  return {
    students,
    existingStudentSnapshots,
    addedStudentSnapshots: 0,
    addedRealtimeSubscriptions: 0,
    maximumRunningLedgerRows: 2,
    maximumRunningRealtimeRows: 1,
    maximumRunningBatchRows: 1,
  }
}

const freeMvp = modelLecture(20)
const proLecture = modelLecture(300)

assert.equal(freeMvp.existingStudentSnapshots, 21_600)
assert.equal(proLecture.existingStudentSnapshots, 324_000)
assert.equal(freeMvp.addedStudentSnapshots, 0)
assert.equal(proLecture.addedStudentSnapshots, 0)
assert.equal(freeMvp.addedRealtimeSubscriptions, 0)
assert.equal(proLecture.addedRealtimeSubscriptions, 0)
assert.equal(freeMvp.maximumRunningLedgerRows, 2)
assert.equal(proLecture.maximumRunningLedgerRows, 2)
assert.equal(proLecture.maximumRunningRealtimeRows, 1)
assert.equal(proLecture.maximumRunningBatchRows, 1)

console.log('Phase 4.1 load model checks passed.')
