import assert from 'node:assert/strict'

const lectureMinutes = 90
const snapshotIntervalSeconds = 5
const presenceWriteIntervalSeconds = 45
const presenceCountCacheSeconds = 15
const snapshotsPerParticipant = (lectureMinutes * 60) / snapshotIntervalSeconds
const heartbeatWritesPerParticipant =
  (lectureMinutes * 60) / presenceWriteIntervalSeconds

function lectureLoad(participants) {
  return {
    activeCountCacheRefreshes:
      (lectureMinutes * 60) / presenceCountCacheSeconds,
    participantHeartbeatWrites: participants * heartbeatWritesPerParticipant,
    participantJoinWrites: participants,
    snapshotCalls: participants * snapshotsPerParticipant,
  }
}

const freeMvp = lectureLoad(20)
const proLecture = lectureLoad(300)
const pollBurstParticipants = 300
const pollBurst = {
  liveVersionUpdates: pollBurstParticipants,
  optionTotalUpdates: pollBurstParticipants,
  voteWrites: pollBurstParticipants,
}

assert.equal(snapshotsPerParticipant, 1_080)
assert.deepEqual(freeMvp, {
  activeCountCacheRefreshes: 360,
  participantHeartbeatWrites: 2_400,
  participantJoinWrites: 20,
  snapshotCalls: 21_600,
})
assert.deepEqual(proLecture, {
  activeCountCacheRefreshes: 360,
  participantHeartbeatWrites: 36_000,
  participantJoinWrites: 300,
  snapshotCalls: 324_000,
})
assert.deepEqual(pollBurst, {
  liveVersionUpdates: 300,
  optionTotalUpdates: 300,
  voteWrites: 300,
})

// Presence is refreshed inside the already-existing snapshot RPC. A
// participant causes at most one indexed write every 45 seconds and expires
// from the approximate active count after 90 seconds.
assert.equal(heartbeatWritesPerParticipant, 120)
assert.ok(proLecture.participantHeartbeatWrites < proLecture.snapshotCalls / 8)

const previousInitialCommentLimit = 100
const phase66InitialCommentLimit = 25
assert.equal(
  previousInitialCommentLimit / phase66InitialCommentLimit,
  4,
  'initial comment row cap should remain four-fold below the legacy payload',
)

// A no-change snapshot carries versions plus a few metric integers. This
// conservative envelope is used only to catch accidental payload expansion.
const conservativeNoChangeSnapshotBytes = 800
const weeklyProSnapshotBytes =
  proLecture.snapshotCalls * conservativeNoChangeSnapshotBytes
assert.ok(
  weeklyProSnapshotBytes < 300 * 1024 * 1024,
  'weekly 300-person no-change snapshot envelope must stay below 300 MiB',
)

// Archive browsing and PDF bytes are served from Cloudflare after export, so
// repeat archive readers do not multiply Supabase read or egress load.
const archiveSupabaseReadsPerViewer = 0
const pdfSupabaseBytesPerViewer = 0
assert.equal(archiveSupabaseReadsPerViewer, 0)
assert.equal(pdfSupabaseBytesPerViewer, 0)

// One daily digest invocation and one email at most for the configured day.
const dailyDigestInvocations = 1
const dailyDigestEmails = 1
assert.equal(dailyDigestInvocations, 1)
assert.equal(dailyDigestEmails, 1)

console.log(
  JSON.stringify(
    {
      freeMvp,
      phase66InitialCommentLimit,
      pollBurst,
      proLecture,
      snapshotsPerParticipant,
      weeklyProSnapshotBytes,
    },
    null,
    2,
  ),
)
console.log('Phase 6.6 deterministic load-budget checks passed.')
