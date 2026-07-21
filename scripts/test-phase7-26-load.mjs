import assert from 'node:assert/strict'

function publicationLoad({ participants, publications }) {
  // First publication: create/claim/upload/commit/activate state+audit writes
  // plus document, lecture and live-state activation = 17 writes. A replacement
  // also retires the prior publication and hides the prior document = 20.
  // The upper bound reserves four more writes per publication for one safe
  // ticket reissue/recovery cycle. None of these writes fan out per student.
  const firstPublicationWrites = publications > 0 ? 17 : 0
  const replacementWrites = Math.max(0, publications - 1) * 20
  const recoveryReserveWrites = publications * 4
  return {
    dbWritesExpected:
      firstPublicationWrites + replacementWrites,
    dbWritesUpperBound:
      firstPublicationWrites + replacementWrites + recoveryReserveWrites,
    edgeInvocationsUpperBound: publications * 7,
    realtimeMessages: 0,
    supabasePdfBytes: 0,
    workerRequestsUpperBound: publications * 5,
    participants,
  }
}

function cleanupLoad({ activeRollback = false, expiresInflight = false }) {
  return {
    dbWritesExpected: expiresInflight ? 10 : 8,
    r2MutationsUpperBound: activeRollback ? 6 : 4,
  }
}

function exhaustedCleanupLoad(attempts = 1000) {
  // The bounded retry ledger performs at most four DB writes per failed claim;
  // expiring an inflight row can add two once. Five R2 mutations per attempt is
  // a deliberately coarse fault-injection ceiling, not the normal sentinel
  // convergence cost (normally no more than six total).
  return {
    dbWritesUpperBound: attempts * 4 + 2,
    r2MutationsFaultCeiling: attempts * 5,
  }
}

for (const participants of [20, 300]) {
  const load = publicationLoad({ participants, publications: 3 })
  assert.equal(load.supabasePdfBytes, 0)
  assert.equal(load.realtimeMessages, 0)
  assert.equal(load.edgeInvocationsUpperBound, 21)
  assert.equal(load.dbWritesExpected, 57)
  assert.equal(load.dbWritesUpperBound, 69)
  assert.equal(load.workerRequestsUpperBound, 15)
}

assert.deepEqual(
  { ...publicationLoad({ participants: 20, publications: 3 }), participants: 0 },
  { ...publicationLoad({ participants: 300, publications: 3 }), participants: 0 },
)

assert.deepEqual(cleanupLoad({}), {
  dbWritesExpected: 8,
  r2MutationsUpperBound: 4,
})
assert.deepEqual(
  cleanupLoad({ activeRollback: true, expiresInflight: true }),
  { dbWritesExpected: 10, r2MutationsUpperBound: 6 },
)
assert.deepEqual(exhaustedCleanupLoad(), {
  dbWritesUpperBound: 4002,
  r2MutationsFaultCeiling: 5000,
})

console.log('Phase 7.26 load model is participant-count invariant.')
