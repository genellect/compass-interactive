import assert from 'node:assert/strict'

const lectureDurationSeconds = 90 * 60
const foregroundIntervalSeconds = 5
const pollsPerStudent = lectureDurationSeconds / foregroundIntervalSeconds

const unchangedSnapshot = {
  changed: {},
  contract_version: 2,
  server_time: '2026-07-14T00:00:00.000Z',
  versions: {
    caption: 1,
    comments: 10,
    lecture: 2,
    likes: 3,
    pdf: 4,
    polls: 5,
    summaries: 6,
  },
}

const captionOnlySnapshot = {
  ...unchangedSnapshot,
  changed: { caption: 'Five-second caption batch.' },
  versions: { ...unchangedSnapshot.versions, caption: 2 },
}

const publicFixture = JSON.stringify({
  ...captionOnlySnapshot,
  changed: {
    ...captionOnlySnapshot.changed,
    comments: {
      has_more: false,
      has_older: false,
      items: [
        {
          body: 'Public question',
          created_at: '2026-07-14T00:00:00.000Z',
          id: 'comment-1',
          is_pinned: false,
          lecture_session_id: 'lecture-1',
          status: 'visible',
        },
      ],
      mode: 'initial',
    },
    likes: [{ comment_id: 'comment-1', like_count: 2 }],
    polls: [{ id: 'poll-1', options: [] }],
  },
})

assert.deepEqual(Object.keys(captionOnlySnapshot.changed), ['caption'])
assert.doesNotMatch(
  publicFixture,
  /participant_id|current_participant_id|liked_by_participant|participant_option_ids/,
)

function modelScenario(students) {
  const sharedSnapshotRequests = students * pollsPerStudent
  const participantStateRequests = students
  const modeledBytes =
    sharedSnapshotRequests * Buffer.byteLength(JSON.stringify(unchangedSnapshot))

  return {
    students,
    lectureMinutes: 90,
    sharedSnapshotRequests,
    participantStateRequests,
    realtimeCommentSubscriptions: 0,
    modeledUnchangedPayloadMiB: Number(
      (modeledBytes / 1024 / 1024).toFixed(2),
    ),
  }
}

const freeMvp = modelScenario(20)
const proLecture = modelScenario(300)

assert.equal(freeMvp.sharedSnapshotRequests, 21_600)
assert.equal(proLecture.sharedSnapshotRequests, 324_000)
assert.equal(freeMvp.realtimeCommentSubscriptions, 0)
assert.equal(proLecture.realtimeCommentSubscriptions, 0)
assert.equal(
  Buffer.byteLength(JSON.stringify(captionOnlySnapshot)) < 512,
  true,
)

console.log(
  JSON.stringify(
    {
      captionOnlyPayloadBytes: Buffer.byteLength(
        JSON.stringify(captionOnlySnapshot),
      ),
      freeMvp,
      proLecture,
      unchangedPayloadBytes: Buffer.byteLength(
        JSON.stringify(unchangedSnapshot),
      ),
    },
    null,
    2,
  ),
)
console.log('Phase 1 20/300-student, 90-minute load model passed.')
