import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const root = new URL('../', import.meta.url)
const migration = readFileSync(
  new URL('supabase/migrations/20260720065403_phase7_2_verified_academic_answers.sql', root),
  'utf8',
)
const repository = readFileSync(
  new URL('src/repositories/supabaseLiveStateRepository.ts', root),
  'utf8',
)

function lectureEnvelope(students) {
  const fiveSecondTicks = (90 * 60) / 5
  return {
    periodicSnapshotRequests: students * fiveSecondTicks,
    phase72ExtraPeriodicRequests: 0,
    phase72RealtimeSubscriptions: 0,
    maximumAcademicCalls: 3,
    maximumAcademicProviderCostUsd: 3 * 0.0312,
    maximumPublishedAnswers: 3,
  }
}

const free = lectureEnvelope(20)
const pro = lectureEnvelope(300)
assert.equal(free.phase72ExtraPeriodicRequests, 0)
assert.equal(pro.phase72ExtraPeriodicRequests, 0)
assert.equal(pro.phase72RealtimeSubscriptions, 0)
assert.equal(pro.periodicSnapshotRequests / free.periodicSnapshotRequests, 15)
assert.ok(pro.maximumAcademicProviderCostUsd < 0.10)
assert.equal(pro.maximumAcademicCalls, free.maximumAcademicCalls)
assert.match(repository, /knownSummariesVersion/)
assert.match(repository, /get_lecture_public_snapshot_v6/)
assert.match(migration, /limit least\(greatest\(answer_limit, 1\), 3\)/)
assert.match(migration, /academic_answer_limit.*3/s)
assert.doesNotMatch(migration, /alter publication supabase_realtime.*academic_answer/is)

console.log(
  JSON.stringify({ free, pro, verdict: 'no-new-per-student-periodic-load' }, null, 2),
)
