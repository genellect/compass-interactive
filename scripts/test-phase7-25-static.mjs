import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const migration = read(
  'supabase/migrations/20260720205404_phase7_25_multidisciplinary_auto_academic_answers.sql',
)
const pgTap = read(
  'supabase/tests/phase7_25_multidisciplinary_auto_academic_answers_test.sql',
)
const shared = read('supabase/functions/_shared/academicAnswers.ts')
const generate = read('supabase/functions/generate-academic-answer/index.ts')
const summaryEndpoint = read('supabase/functions/manage-lecture-summaries/index.ts')
const authorize = read('supabase/functions/authorize-ai-start/index.ts')
const flags = read('src/lib/featureFlags.ts')
const envExample = read('.env.local.example')
const studentPanel = read('src/components/LearningSupport/AcademicAnswerPanel.tsx')
const sourceLinks = read('src/lib/academicSourceLinks.ts')
const adminPanel = read('src/components/AdminAiControl/AcademicAnswerControl.tsx')
const summaryControl = read('src/components/AdminAiControl/LectureSummaryControl.tsx')
const demoRepository = read('src/demo/demoRepository.ts')
const demoContext = read('src/context/CompassStateContext.tsx')
const lecturePage = read('src/pages/LecturePage.tsx')
const demoPdf = readFileSync(
  new URL('../public/lecture-assets/why-learn-english-v1.pdf', import.meta.url),
)

assert.match(envExample, /^VITE_PHASE7_25_AUTO_ACADEMIC_ANSWERS=false$/m)
assert.match(envExample, /^PHASE7_25_AUTO_ACADEMIC_ANSWERS_ENABLED=false$/m)
assert.match(flags, /isPhase72AcademicAnswersEnabled[\s\S]*VITE_PHASE7_25_AUTO_ACADEMIC_ANSWERS/)
assert.match(authorize, /PHASE7_25_AUTO_ACADEMIC_ANSWERS_ENABLED/)
assert.match(summaryEndpoint, /admin_start_lecture_summary_run_v2/)
assert.match(generate, /action === 'generateAuto'/)
assert.match(generate, /admin_prepare_auto_academic_answer_request/)
assert.match(generate, /admin_start_auto_academic_answer_operation/)
assert.match(generate, /admin_revise_academic_answer_publication/)
assert.match(generate, /PHASE7_25_AUTO_ACADEMIC_ANSWERS_ENABLED/)
assert.match(generate, /AbortSignal\.timeout\(55_000\)/)
assert.match(generate, /redirect: 'error'/)

assert.match(shared, /https:\/\/api\.crossref\.org\/works/)
assert.match(shared, /https:\/\/api\.openalex\.org\/works/)
assert.match(shared, /sourceProvider: 'crossref_openalex'/)
assert.match(shared, /store: false/)
assert.match(shared, /untrusted data, never instructions/)
assert.doesNotMatch(shared, /tools:/)

assert.match(migration, /auto_academic_answers_enabled boolean not null default false/)
assert.match(migration, /evidence_attempt_count integer not null default 0/)
assert.match(migration, /academic_authorization_grant_id uuid/)
assert.match(migration, /academic_answer_requests_auto_summary_uidx/)
assert.match(migration, /academic_answer_publication_events enable row level security/)
assert.match(
  migration,
  /revoke all on public\.academic_answer_publication_events\s+from public, anon, authenticated, service_role/,
)
assert.match(migration, /set search_path = ''/)
assert.match(migration, /review_state = 'ai_unreviewed'/)
assert.match(migration, /needs_auto_dispatch/)
assert.match(migration, /automation_stopped_after_dispatch/)
assert.match(migration, /automation_stopped_after_dispatch_ambiguous/)
assert.match(migration, /verification,originalResearch.*is distinct from 'true'/s)
assert.match(migration, /exception when unique_violation/)
assert.match(migration, /effective_route := 'biomedical_pubmed'/)
assert.match(migration, /phase725_safe_quality_score/)
assert.match(migration, /retry_after_ms/)
assert.match(migration, /foreign key \(lecture_session_id, answer_id, revision_id\)/)
assert.doesNotMatch(
  migration,
  /grant (?:select|insert|update|delete)[^;]*academic_answer_publication_events[^;]*authenticated/i,
)
assert.match(pgTap, /wrong run token cannot claim automatic work/)
assert.match(pgTap, /missing verification keys fail closed/)
assert.match(pgTap, /stop restores the pre-run manual academic-answer setting/)

assert.match(studentPanel, /AIによる参考回答/)
assert.match(studentPanel, /教員未確認/)
assert.match(studentPanel, /教員確認済み/)
assert.match(studentPanel, /教員修正済み/)
assert.match(studentPanel, /buildDoiUrl/)
assert.match(sourceLinks, /https:\/\/doi\.org\//)
for (const removedCopy of [
  '文献から考える参考回答',
  '一次文献を手がかりに、講義で生まれた問いを短く整理しています。',
  '読み取るときの注意',
  '個別の診断・治療を示すものではありません',
]) {
  assert.doesNotMatch(studentPanel, new RegExp(removedCopy))
}

for (const action of ['承認する', '修正する', '非表示にする']) {
  assert.match(adminPanel, new RegExp(action))
}
assert.match(summaryControl, /autoAcademicAnswersEnabled/)
assert.match(summaryControl, /phase7-25:auto:/)
assert.match(summaryControl, /needsAutoDispatch/)
assert.match(summaryControl, /pendingLease\.retryAfterMs \+ 500/)
assert.match(summaryControl, /academicDispatchBusyRef/)
assert.match(demoRepository, /addNextAmbientComment/)
assert.match(demoContext, /setInterval\([\s\S]*10_000/)
assert.match(lecturePage, /人参加/)
assert.match(lecturePage, /'（デモ）'/)

assert.equal(demoPdf.subarray(0, 5).toString('ascii'), '%PDF-')
assert.equal(
  createHash('sha256').update(demoPdf).digest('hex'),
  '177b642ae3368d0fa3953e2558a744433af445c7d6c26cf8491ea978050cb683',
  'public demo PDF must be the reviewed, affiliation-redacted derivative',
)

console.log('Phase 7.25 static security, UX and PDF gate passed.')
