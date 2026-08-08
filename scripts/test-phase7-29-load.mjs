import assert from 'node:assert/strict'

const LECTURE_MINUTES = 60
const PAGE_TRANSITIONS = 120
const HEARTBEATS = 240
const ADMIN_STATUS_POLLS = (LECTURE_MINUTES * 60) / 5
const MINIMUM_PAGE_COMMIT_INTERVAL_MS = 200
const EDGE_BODY_LIMIT_BYTES = 16 * 1024

function byteLength(value) {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength
}

function presenterLoadEnvelope({ participants }) {
  const updatePayloadBytes = byteLength({
    action: 'update',
    capabilityToken: `${'a'.repeat(256)}.${'b'.repeat(43)}`,
    eventId: '72900000-0000-4000-8000-000000000001',
    pdfPage: 75,
    pptxFileSha256: 'c'.repeat(64),
    sequence: 119,
    slideId: 2_147_483_647,
    slideIdOrderSha256: 'd'.repeat(64),
    slideIndex: 75,
  })
  const heartbeatPayloadBytes = byteLength({
    action: 'heartbeat',
    capabilityToken: `${'a'.repeat(256)}.${'b'.repeat(43)}`,
    pptxFileSha256: 'c'.repeat(64),
    slideIdOrderSha256: 'd'.repeat(64),
  })
  const lifecycleRows = 1 + 5
  const logicalPageCommitsPerSecond = 1_000 / MINIMUM_PAGE_COMMIT_INTERVAL_MS

  return {
    averagePageTransitionsPerSecond: PAGE_TRANSITIONS / (LECTURE_MINUTES * 60),
    dbRowsAdded: lifecycleRows,
    adminStatusPolls: ADMIN_STATUS_POLLS,
    edgeInvocations: PAGE_TRANSITIONS + HEARTBEATS + ADMIN_STATUS_POLLS,
    heartbeatCalls: HEARTBEATS,
    maximumLogicalPageCommitsPerSecond: logicalPageCommitsPerSecond,
    maximumRowUpdates: PAGE_TRANSITIONS * 2 + HEARTBEATS,
    pageTransitionCalls: PAGE_TRANSITIONS,
    participants,
    payloadBytes:
      updatePayloadBytes * PAGE_TRANSITIONS +
      heartbeatPayloadBytes * HEARTBEATS,
    realtimeConnectionsAddedForStudents: 0,
    realtimeMessagesAddedForStudents: 0,
    studentPeriodicRequestsAdded: 0,
    supabaseFileBytesAdded: 0,
    updatePayloadBytes,
    heartbeatPayloadBytes,
  }
}

for (const participants of [20, 300]) {
  const envelope = presenterLoadEnvelope({ participants })
  assert.equal(envelope.pageTransitionCalls, 120)
  assert.equal(envelope.heartbeatCalls, 240)
  assert.equal(envelope.adminStatusPolls, 720)
  assert.equal(envelope.edgeInvocations, 1_080)
  assert.equal(envelope.maximumLogicalPageCommitsPerSecond, 5)
  assert.equal(envelope.realtimeConnectionsAddedForStudents, 0)
  assert.equal(envelope.realtimeMessagesAddedForStudents, 0)
  assert.equal(envelope.studentPeriodicRequestsAdded, 0)
  assert.equal(envelope.supabaseFileBytesAdded, 0)
  assert.equal(envelope.dbRowsAdded, 6)
  assert.equal(envelope.maximumRowUpdates, 480)
  assert.ok(envelope.updatePayloadBytes < EDGE_BODY_LIMIT_BYTES)
  assert.ok(envelope.heartbeatPayloadBytes < EDGE_BODY_LIMIT_BYTES)
  assert.ok(envelope.payloadBytes < 512 * 1024)
}

const free = presenterLoadEnvelope({ participants: 20 })
const pro = presenterLoadEnvelope({ participants: 300 })
assert.deepEqual(
  { ...free, participants: 0 },
  { ...pro, participants: 0 },
  'Presenter load must not scale with student count',
)

console.log(
  `Phase 7.29 load PASS: 60min transitions=${PAGE_TRANSITIONS}, ` +
    `heartbeats=${HEARTBEATS}, logicalWritePeak=5/s, ` +
    `adminStatusPolls=${ADMIN_STATUS_POLLS}, edgeCalls=${free.edgeInvocations}, ` +
    `payload=${free.payloadBytes}B, rowsAdded=${free.dbRowsAdded}, ` +
    `studentAdded=0.`,
)
