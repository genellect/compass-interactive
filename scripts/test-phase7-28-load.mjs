import assert from 'node:assert/strict'

const SNAPSHOT_INTERVAL_SECONDS = 5
const DISPLAY_DELTA_INTERVAL_MILLISECONDS = 500
const AI_MASTER_STATUS_INTERVAL_SECONDS = 10
const REALTIME_FREE_CONCURRENT_CONNECTIONS = 200
const REALTIME_FREE_MESSAGES_PER_SECOND = 100
const REALTIME_FREE_MONTHLY_MESSAGES = 2_000_000
const EDGE_FREE_MONTHLY_INVOCATIONS = 500_000

function snapshotEnvelope({ participants, durationMinutes }) {
  const intervals = (durationMinutes * 60) / SNAPSHOT_INTERVAL_SECONDS
  return {
    participants,
    snapshotRequests: participants * intervals,
    studentRealtimeConnectionsAdded: 0,
    studentPeriodicRequestsAdded: 0,
  }
}

function displayEnvelope({ durationMinutes, completedEventsPerMinute = 12 }) {
  const seconds = durationMinutes * 60
  const deltaEvents = Math.ceil(
    (seconds * 1_000) / DISPLAY_DELTA_INTERVAL_MILLISECONDS,
  )
  const completedEvents = durationMinutes * completedEventsPerMinute
  const stopEvents = 1
  const relayCalls = deltaEvents + completedEvents + stopEvents

  return {
    displayRealtimeConnections: 1,
    relayCalls,
    realtimeMessages: relayCalls,
    peakMessagesPerSecond: 2 + Math.ceil(completedEventsPerMinute / 60),
  }
}

function monthlyLectureEnvelope({
  explicitPaidStarts,
  lecturesPerMonth,
  durationMinutes,
}) {
  const display = displayEnvelope({ durationMinutes })
  const aiMaster = aiMasterEnvelope({ durationMinutes, explicitPaidStarts })
  return {
    edgeInvocations:
      (display.relayCalls + aiMaster.incrementalEdgeInvocations) *
      lecturesPerMonth,
    realtimeMessages: display.realtimeMessages * lecturesPerMonth,
  }
}

function aiMasterEnvelope({ durationMinutes, explicitPaidStarts }) {
  assert.ok(Number.isInteger(explicitPaidStarts) && explicitPaidStarts >= 0)
  const adminStatusRequests = Math.ceil(
    (durationMinutes * 60) / AI_MASTER_STATUS_INTERVAL_SECONDS,
  )
  return {
    adminStatusRequests,
    authorizationProviderCalls: 0,
    authorizationBudgetReservations: 0,
    childGrants: explicitPaidStarts,
    incrementalEdgeInvocations: adminStatusRequests + explicitPaidStarts + 2,
    maximumPaidStarts: explicitPaidStarts,
    studentPeriodicRequestsAdded: 0,
  }
}

const freeSeminar = snapshotEnvelope({ participants: 20, durationMinutes: 90 })
const proLecture = snapshotEnvelope({ participants: 300, durationMinutes: 90 })
assert.deepEqual(freeSeminar, {
  participants: 20,
  snapshotRequests: 21_600,
  studentRealtimeConnectionsAdded: 0,
  studentPeriodicRequestsAdded: 0,
})
assert.deepEqual(proLecture, {
  participants: 300,
  snapshotRequests: 324_000,
  studentRealtimeConnectionsAdded: 0,
  studentPeriodicRequestsAdded: 0,
})

const display90 = displayEnvelope({ durationMinutes: 90 })
assert.equal(display90.displayRealtimeConnections, 1)
assert.ok(display90.peakMessagesPerSecond < REALTIME_FREE_MESSAGES_PER_SECOND)
assert.ok(
  display90.displayRealtimeConnections < REALTIME_FREE_CONCURRENT_CONNECTIONS,
)

// Four 90-minute lectures per month is the agreed weekly operating envelope.
// This deliberately pessimistic model assumes a continuously changing caption
// plus twelve completed transcript events each minute.
const monthly = monthlyLectureEnvelope({
  explicitPaidStarts: 24,
  lecturesPerMonth: 4,
  durationMinutes: 90,
})
assert.ok(monthly.edgeInvocations < EDGE_FREE_MONTHLY_INVOCATIONS)
assert.ok(monthly.realtimeMessages < REALTIME_FREE_MONTHLY_MESSAGES)

assert.deepEqual(
  aiMasterEnvelope({ durationMinutes: 90, explicitPaidStarts: 24 }),
  {
    adminStatusRequests: 540,
    authorizationProviderCalls: 0,
    authorizationBudgetReservations: 0,
    childGrants: 24,
    incrementalEdgeInvocations: 566,
    maximumPaidStarts: 24,
    studentPeriodicRequestsAdded: 0,
  },
)

console.log(
  `Phase 7.28 load model PASS: 20=${freeSeminar.snapshotRequests}, ` +
    `300=${proLecture.snapshotRequests}, display90=${display90.relayCalls}, ` +
    `monthly=${monthly.edgeInvocations}.`,
)
