import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (path) =>
  readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

const migration = read(
  'supabase/migrations/20260731110753_phase7_28_ai_master_authorization.sql',
)
const edge = read('supabase/functions/authorize-ai-start/index.ts')
const masterControl = read(
  'src/components/AdminAiControl/AiMasterAuthorizationControl.tsx',
)
const masterHelpers = read(
  'src/components/AdminAiControl/aiMasterAuthorization.ts',
)
const captions = read(
  'src/components/AdminAiControl/RealtimeCaptionControl.tsx',
)
const summaries = read(
  'src/components/AdminAiControl/LectureSummaryControl.tsx',
)
const material = read(
  'src/components/AdminAiControl/MaterialAnalysisControl.tsx',
)
const academic = read('src/components/AdminAiControl/AcademicAnswerControl.tsx')
const repository = read('src/repositories/supabaseAdminRepository.ts')
const masterRepository = read(
  'src/repositories/supabase/aiMasterAuthorizationRepository.ts',
)
const envExample = read('.env.local.example')
const featureFlags = read('src/lib/featureFlags.ts')

assert.match(
  migration,
  /create table public\.lecture_ai_master_authorizations[\s\S]*?enable row level security/,
)
assert.match(
  migration,
  /add column master_authorization_id uuid[\s\S]*?references public\.lecture_ai_master_authorizations/,
)
assert.match(
  migration,
  /old\.master_authorization_id is null[\s\S]*?return new/,
  'legacy direct-PIN grants must bypass only the new master consume check',
)
assert.match(
  migration,
  /status = 'revoked',[\s\S]*?revoked_at = statement_timestamp\(\)/,
)
assert.match(
  migration,
  /for update skip locked[\s\S]*?enforce_ai_master_on_child_grant_consume/,
)
assert.match(
  migration,
  /stop_captions_for_ai_master_scope_change[\s\S]*?feature = 'captions'/,
)
assert.match(migration, /service_drain_ai_master_authorizations/)
assert.match(
  migration,
  /revoke all on function public\.service_drain_ai_master_authorizations\(text\)[\s\S]*?from public, anon, authenticated/,
)
assert.doesNotMatch(
  migration,
  /billing_pin|openai_api_key|provider_key/i,
  'master authorization tables and RPCs must never store secrets',
)

assert.match(edge, /PHASE7_28_AI_MASTER_AUTH_ENABLED/)
assert.match(edge, /validateMasterFeatureReadiness/)
assert.match(
  edge,
  /validateMasterFeatureReadiness[\s\S]*?PHASE7_25_AUTO_ACADEMIC_ANSWERS_ENABLED/,
)
assert.match(edge, /PHASE68_TRACKED_ADMIN_SESSIONS_ENABLED|adminSessionId/)
assert.match(edge, /body\.billingPin\?\.trim\(\)/)
assert.match(edge, /admin_issue_ai_billing_grant_from_master/)
assert.match(edge, /createBillingGrantNonce\(\)/)
assert.match(edge, /formatBillingGrantToken/)
const revokeMasterBranch = edge.slice(
  edge.indexOf("if (action === 'revokeMaster')"),
  edge.indexOf("if (action !== 'issueGrant')"),
)
assert.ok(revokeMasterBranch.length > 0)
assert.doesNotMatch(
  revokeMasterBranch,
  /if \(!masterEnabled\)/,
  'stop-only recovery must remain available after the master flag is disabled',
)
const masterStatusBranch = edge.slice(
  edge.indexOf("if (action === 'masterStatus')"),
  edge.indexOf("if (action === 'authorizeMaster')"),
)
assert.doesNotMatch(
  masterStatusBranch,
  /if \(!masterEnabled\)/,
  'status must remain visible so an already-active authorization can be stopped after flag rollback',
)

assert.match(masterControl, /字幕以外を許可/)
assert.match(masterControl, /字幕も含めて許可/)
assert.match(masterControl, /許可だけではAPIは呼び出されません/)
assert.match(
  masterControl,
  /onAuthorizationChange\(next\?\.status === 'active'/,
)
assert.match(masterControl, /別の教員画面が許可を保持しています/)
assert.doesNotMatch(masterControl, /getUserMedia|createRealtimeCaptionCall/)
assert.match(masterHelpers, /masterAuthorizesFeature/)
assert.match(masterHelpers, /masterAuthorizationHeldByOther/)

for (const control of [captions, summaries, material, academic]) {
  assert.match(control, /masterAuthorizesFeature/)
  assert.match(control, /masterAuthorizationHeldByOther/)
  assert.match(control, /billingPin:/)
}
assert.match(captions, /navigator\.mediaDevices\.getUserMedia/)
assert.match(captions, /字幕を開始/)
assert.match(captions, /previousMasterAuthorizedRef/)
assert.match(summaries, /AI利用を許可済み／5分要約は未開始/)
assert.match(summaries, /window\.addEventListener\('online'/)
assert.match(summaries, /window\.addEventListener\('pageshow'/)
assert.match(summaries, /5_000/)
assert.match(summaries, /previousSummaryMasterAuthorizedRef/)
assert.match(
  summaries,
  /previouslyAuthorized[\s\S]*?!summaryMasterAuthorized[\s\S]*?runTokenRef\.current = null[\s\S]*?setRunToken\(null\)/,
  'master revocation must stop the local five-minute scheduler immediately',
)
assert.match(material, /講義中のAPI許可を使用します/)
assert.match(academic, /講義中のAPI許可を使用します/)

assert.match(repository, /billingPin\?: string/)
assert.match(repository, /aiMasterAuthorizationRepository/)
assert.match(masterRepository, /authorizeAiMaster/)
assert.match(masterRepository, /revokeAiMasterAuthorization/)
assert.match(envExample, /^VITE_PHASE7_28_AI_MASTER_AUTH=false$/m)
assert.match(envExample, /^PHASE7_28_AI_MASTER_AUTH_ENABLED=false$/m)
assert.match(
  featureFlags,
  /isPhase728AiMasterAuthorizationEnabled\s*=\s*[\s\S]*?isPhase68SecurityEnabled\s*&&[\s\S]*?VITE_PHASE7_28_AI_MASTER_AUTH === 'true'/,
)

console.log('Phase 7.28C master AI authorization static tests passed.')
