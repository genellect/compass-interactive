import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const migration = read('supabase/migrations/20260720065403_phase7_2_verified_academic_answers.sql')
const shared = read('supabase/functions/_shared/academicAnswers.ts')
const endpoint = read('supabase/functions/generate-academic-answer/index.ts')
const authorize = read('supabase/functions/authorize-ai-start/index.ts')
const config = read('supabase/config.toml')
const flags = read('src/lib/featureFlags.ts')
const envExample = read('.env.local.example')
const studentPanel = read('src/components/LearningSupport/AcademicAnswerPanel.tsx')
const sourceLinks = read('src/lib/academicSourceLinks.ts')
const adminPanel = read('src/components/AdminAiControl/AcademicAnswerControl.tsx')
const liveRepository = read('src/repositories/supabaseLiveStateRepository.ts')
const archiveExport = read('supabase/functions/_shared/archiveExport.ts')
const worker = read('cloudflare/asset-worker/src/worker.ts')

assert.match(envExample, /^VITE_PHASE7_2_ACADEMIC_ANSWERS=false$/m)
assert.match(envExample, /^PHASE7_2_ACADEMIC_ANSWERS_ENABLED=false$/m)
assert.match(flags, /isPhase6SummariesEnabled[\s\S]*VITE_PHASE7_2_ACADEMIC_ANSWERS/)
assert.match(config, /\[functions\.generate-academic-answer\]\s+verify_jwt = true/)
assert.match(authorize, /PHASE7_2_ACADEMIC_ANSWERS_ENABLED/)
assert.match(endpoint, /getAdminTokenClaims/)
assert.match(endpoint, /admin_prepare_academic_answer_request/)
assert.match(endpoint, /admin_start_academic_answer_operation/)
assert.match(endpoint, /admin_mark_academic_provider_dispatched/)
assert.match(endpoint, /admin_complete_academic_answer_operation/)
assert.match(endpoint, /admin_cancel_academic_answer_request/)
assert.match(endpoint, /admin_reap_stale_academic_answer_operations/)
assert.match(endpoint, /AbortSignal\.timeout\(55_000\)/)
assert.match(endpoint, /redirect: 'error'/)
assert.doesNotMatch(endpoint, /VITE_OPENAI|serviceRoleKey.*return|console\.log\([^)]*openAiKey/i)

assert.match(shared, /export const PHASE72_MODEL = 'gpt-5\.6-luna'/)
assert.match(shared, /https:\/\/eutils\.ncbi\.nlm\.nih\.gov\/entrez\/eutils\/esearch\.fcgi/)
assert.match(shared, /https:\/\/api\.crossref\.org\/works\//)
assert.match(shared, /retmax: String\(PHASE72_MAX_SOURCES\)/)
assert.match(shared, /store: false/)
assert.match(shared, /strict: true/)
assert.match(shared, /safety_identifier/)
assert.doesNotMatch(shared, /tools:/)
assert.doesNotMatch(shared, /web_search|file_search|computer_use/)

for (const table of [
  'academic_answer_requests',
  'lecture_academic_answers',
  'academic_answer_sources',
  'academic_answer_revisions',
  'academic_answer_publications',
]) {
  assert.match(migration, new RegExp(`alter table public\\.${table} enable row level security`))
  assert.match(migration, new RegExp(`revoke all on public\\.${table} from public, anon, authenticated`))
}
assert.match(migration, /create policy "students can read visible comments in owned lectures"/)
assert.match(migration, /participant\.auth_user_id = \(select auth\.uid\(\)\)/)
assert.match(migration, /accounting_settled_at/)
assert.match(migration, /compass-phase7-2-academic-reaper/)
assert.match(migration, /private\.build_public_lecture_archive_v3/)
assert.match(migration, /academic_answers.*private\.phase72_public_answers_json/s)
assert.doesNotMatch(migration, /grant (?:select|insert|update|delete).*academic_answer.*authenticated/i)

assert.match(studentPanel, /AIによる参考回答/)
assert.match(studentPanel, /教員未確認/)
assert.match(studentPanel, /教員確認済み/)
assert.match(studentPanel, /pubmed\.ncbi\.nlm\.nih\.gov/)
assert.match(studentPanel, /buildDoiUrl/)
assert.match(sourceLinks, /https:\/\/doi\.org\//)
assert.doesNotMatch(studentPanel, /文献から考える参考回答/)
assert.doesNotMatch(
  studentPanel,
  /一次文献を手がかりに、講義で生まれた問いを短く整理しています。/,
)
assert.doesNotMatch(studentPanel, /読み取るときの注意/)
assert.doesNotMatch(studentPanel, /個別の診断・治療を示すものではありません/)
assert.match(adminPanel, /API PIN/)
assert.match(adminPanel, /停止する/)
assert.match(adminPanel, /最大3回／講義/)
assert.match(liveRepository, /get_lecture_public_snapshot_v6/)
assert.match(liveRepository, /get_lecture_archive_v4/)
assert.match(archiveExport, /academic_answers/)
assert.match(worker, /academicAnswers\.length > 3/)

console.log('Phase 7.2 static security and integration gate passed.')
