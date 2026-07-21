import assert from 'node:assert/strict'

function prepareRunLoad({ participants, runs = 1 }) {
  // Each preset run creates one lecture, Admin code, live/display state, run
  // binding, six Polls, 24 options and six ordering rows. It intentionally
  // starts no lecture, PDF publication or AI operation.
  const writesPerRun = 1 + 1 + 1 + 1 + 1 + 6 + 24 + 6
  return {
    aiProviderCalls: 0,
    dbWritesExpected: writesPerRun * runs,
    edgeInvocations: runs,
    participants,
    realtimeMessages: 0,
    supabasePdfBytes: 0,
  }
}

function adminListLoad({ journalClubEnabled, pollListRequested }) {
  return {
    journalClubMetadataQueries: journalClubEnabled ? 1 : 0,
    pollSlotQueries: journalClubEnabled && pollListRequested ? 1 : 0,
    studentQueriesAdded: 0,
  }
}

function finalArchiveLoad({ publishedSummaryWindows }) {
  assert.ok(publishedSummaryWindows >= 0 && publishedSummaryWindows <= 18)
  return {
    archiveExportClaims: 1,
    payloadSummaryItems: publishedSummaryWindows,
    realtimeMessages: 0,
    studentQueriesAdded: 0,
  }
}

for (const participants of [20, 300]) {
  assert.deepEqual(prepareRunLoad({ participants }), {
    aiProviderCalls: 0,
    dbWritesExpected: 41,
    edgeInvocations: 1,
    participants,
    realtimeMessages: 0,
    supabasePdfBytes: 0,
  })
}

assert.deepEqual(
  { ...prepareRunLoad({ participants: 20, runs: 4 }), participants: 0 },
  { ...prepareRunLoad({ participants: 300, runs: 4 }), participants: 0 },
)
assert.equal(prepareRunLoad({ participants: 300, runs: 4 }).dbWritesExpected, 164)

assert.deepEqual(adminListLoad({ journalClubEnabled: false, pollListRequested: true }), {
  journalClubMetadataQueries: 0,
  pollSlotQueries: 0,
  studentQueriesAdded: 0,
})
assert.deepEqual(adminListLoad({ journalClubEnabled: true, pollListRequested: true }), {
  journalClubMetadataQueries: 1,
  pollSlotQueries: 1,
  studentQueriesAdded: 0,
})
assert.deepEqual(finalArchiveLoad({ publishedSummaryWindows: 18 }), {
  archiveExportClaims: 1,
  payloadSummaryItems: 18,
  realtimeMessages: 0,
  studentQueriesAdded: 0,
})

console.log('Phase 7.27 load model is participant-count invariant.')
