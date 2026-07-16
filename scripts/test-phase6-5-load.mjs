import assert from 'node:assert/strict'

const scenarios = [20, 300].map((students) => ({
  additionalParticipantProfileRows: 0,
  additionalRealtimeSubscriptions: 0,
  additionalStudentRequests: 0,
  commentWritesPerPost: 1,
  maxNicknameCharactersPerNamedComment: 10,
  students,
}))

for (const scenario of scenarios) {
  assert.equal(scenario.commentWritesPerPost, 1)
  assert.equal(scenario.additionalStudentRequests, 0)
  assert.equal(scenario.additionalRealtimeSubscriptions, 0)
  assert.equal(scenario.additionalParticipantProfileRows, 0)
}

console.log(JSON.stringify({ scenarios }))
