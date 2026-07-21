import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const summaryControl = readFileSync(
  new URL('../src/components/AdminAiControl/LectureSummaryControl.tsx', import.meta.url),
  'utf8',
)
const migration = readFileSync(
  new URL(
    '../supabase/migrations/20260720205404_phase7_25_multidisciplinary_auto_academic_answers.sql',
    import.meta.url,
  ),
  'utf8',
)

function lectureEnvelope(students) {
  const fiveSecondTicks = (90 * 60) / 5
  const fiveMinuteWindows = 90 / 5
  return {
    existingSnapshotRequests: students * fiveSecondTicks,
    maximumAcademicProviderCalls: 3,
    maximumAcademicProviderCostUsd: 3 * 0.0312,
    maximumAutoDispatchAttemptsBeforeRecovery: fiveMinuteWindows * 3,
    phase725ExtraStudentRequests: 0,
    phase725RealtimeSubscriptions: 0,
    summaryWindows: fiveMinuteWindows,
    students,
  }
}

const free = lectureEnvelope(20)
const pro = lectureEnvelope(300)
assert.equal(free.existingSnapshotRequests, 21_600)
assert.equal(pro.existingSnapshotRequests, 324_000)
assert.equal(free.phase725ExtraStudentRequests, 0)
assert.equal(pro.phase725ExtraStudentRequests, 0)
assert.equal(pro.phase725RealtimeSubscriptions, 0)
assert.equal(free.maximumAcademicProviderCalls, 3)
assert.equal(pro.maximumAcademicProviderCalls, 3)
assert.ok(pro.maximumAcademicProviderCostUsd < 0.1)
assert.equal(pro.maximumAutoDispatchAttemptsBeforeRecovery, 54)
assert.match(summaryControl, /MAX_AUTO_ACADEMIC_DISPATCH_ATTEMPTS = 3/)
assert.match(summaryControl, /AUTO_ACADEMIC_RETRY_DELAYS_MS = \[10_000, 20_000\]/)
assert.match(migration, /least\(\s*control_row\.academic_answer_limit, 3\s*\)/)
assert.match(migration, /limit least\(greatest\(answer_limit, 1\), 3\)/)
assert.doesNotMatch(
  migration,
  /alter publication supabase_realtime[\s\S]*academic_answer/is,
)

console.log(
  JSON.stringify({
    free,
    pro,
    verdict: 'bounded-admin-dispatch-with-no-new-per-student-load',
  }, null, 2),
)
