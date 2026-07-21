import assert from 'node:assert/strict'

function publicationLoad({ participants, publications }) {
  return {
    dbWritesUpperBound: publications * 10,
    edgeInvocationsUpperBound: publications * 7,
    realtimeMessages: 0,
    supabasePdfBytes: 0,
    workerRequestsUpperBound: publications * 5,
    participants,
  }
}

for (const participants of [20, 300]) {
  const load = publicationLoad({ participants, publications: 3 })
  assert.equal(load.supabasePdfBytes, 0)
  assert.equal(load.realtimeMessages, 0)
  assert.equal(load.edgeInvocationsUpperBound, 21)
  assert.equal(load.dbWritesUpperBound, 30)
  assert.equal(load.workerRequestsUpperBound, 15)
}

assert.deepEqual(
  { ...publicationLoad({ participants: 20, publications: 3 }), participants: 0 },
  { ...publicationLoad({ participants: 300, publications: 3 }), participants: 0 },
)

console.log('Phase 7.26 load model is participant-count invariant.')
