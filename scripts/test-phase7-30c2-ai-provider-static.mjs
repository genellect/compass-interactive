import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (path) =>
  readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const functionBlock = (sql, qualifiedName) =>
  sql.match(
    new RegExp(
      `create (?:or replace )?function ${qualifiedName.replaceAll('.', '\\.')}` +
        `[\\s\\S]*?\\n\\$\\$;`,
    ),
  )?.[0] ?? ''

const migration = read(
  'supabase/migrations/20260811180000_phase7_30c2_google_ai_provider.sql',
)
const aiBilling = read('supabase/functions/_shared/aiBilling.ts')
const analyzeMaterial = read(
  'supabase/functions/analyze-lecture-material/index.ts',
)
const databaseTypes = read('src/types/database.ts')
const envExample = read('.env.local.example')
const pgTap = read('supabase/tests/phase7_30c2_google_ai_provider_test.sql')

const providerContext = functionBlock(
  migration,
  'private.require_google_ai_provider_context_v1',
)
assert.match(providerContext, /target_google_issuer is distinct from/)
assert.match(
  providerContext,
  /target_provider_subject_hmac is null[\s\S]*target_provider_subject_hmac !~/,
  'NULL or malformed Google subjects fail closed before principal lookup',
)
assert.match(
  providerContext,
  /principal_row\.provider_subject_hmac is distinct from[\s\S]*target_provider_subject_hmac/,
)

assert.match(
  migration,
  /add column google_ai_child_grant_enabled boolean not null default false/,
  'Google AI child authority must remain database-default OFF',
)

for (const table of [
  'admin_google_ai_child_grant_receipts',
  'admin_google_ai_provider_start_intents',
  'admin_google_ai_provider_start_receipts',
]) {
  assert.match(migration, new RegExp(`create table private\\.${table}`))
  assert.match(
    migration,
    new RegExp(
      `alter table private\\.${table} enable row level security;[\\s\\S]*` +
        `revoke all on private\\.${table}[\\s\\S]*` +
        `from public, anon, authenticated, service_role`,
    ),
  )
  assert.match(
    migration,
    new RegExp(
      `before update or delete on private\\.${table}[\\s\\S]*` +
        `reject_admin_c1_evidence_mutation_v1`,
    ),
  )
}

const issue = functionBlock(migration, 'private.issue_google_ai_child_grant_v1')
assert.ok(issue, 'missing private Google AI child issuer')
const issueSerialize = issue.indexOf('serialize_admin_ai_request_v1')
const issueContext = issue.indexOf('require_google_ai_provider_context_v1')
const issueReplay = issue.indexOf(
  'from private.admin_google_ai_child_grant_receipts as receipt',
)
const issueIdentityGate = issue.indexOf(
  'from private.admin_identity_runtime_gate as gate',
)
const issueOwnership = issue.indexOf(
  'from private.admin_lecture_ownerships as ownership',
)
const issuePolicy = issue.indexOf('from private.admin_ai_policies as policy')
const issueLecture = issue.indexOf('from public.lecture_sessions as lecture')
const issueMaster = issue.lastIndexOf(
  'from public.lecture_ai_master_authorizations as master',
)
const issueReceipt = issue.indexOf(
  'insert into private.admin_google_ai_child_grant_receipts',
)
const issueGrant = issue.indexOf('insert into public.ai_billing_grants')
assert.ok(
  issueSerialize >= 0 &&
    issueSerialize < issueContext &&
    issueContext < issueReplay &&
    issueReplay < issueIdentityGate &&
    issueIdentityGate < issueOwnership &&
    issueOwnership < issuePolicy &&
    issuePolicy < issueLecture &&
    issueLecture < issueMaster &&
    issueMaster < issueReceipt &&
    issueReceipt < issueGrant,
  'child issue order is request -> Google context -> replay -> gates -> ownership -> policy -> lecture -> master -> evidence -> grant',
)
assert.match(
  issue.slice(issueReplay, issueIdentityGate),
  /idempotentReplay[\s\S]*providerIntentDigest/,
  'lost child response converges before admission gates',
)
assert.match(
  issue,
  /effective_now \+ interval '2 minutes'/,
  'each provider child is short-lived',
)
assert.match(issue, /array\[target_feature\]::text\[\]/)
assert.match(
  issue,
  /identity_gate\.singleton is distinct from true[\s\S]*ai_gate\.singleton is distinct from true[\s\S]*target_transport_enabled is distinct from true/,
  'missing, NULL or disabled admission gates fail closed',
)
assert.match(
  migration,
  /revoke all on function private\.issue_google_ai_child_grant_v1\([\s\S]*from public, anon, authenticated, service_role/,
)
assert.doesNotMatch(
  migration,
  /create function public\.issue_google_ai_child_grant_v1/,
  'the service role receives only provider-typed issuers',
)
assert.match(
  migration,
  /create function public\.issue_google_material_ai_child_grant_v1\([\s\S]*security definer[\s\S]*set search_path = ''[\s\S]*google_material_provider_intent_digest_v1/,
)
assert.match(
  migration,
  /revoke all on function public\.issue_google_material_ai_child_grant_v1\([\s\S]*from public, anon, authenticated;[\s\S]*grant execute on function public\.issue_google_material_ai_child_grant_v1\([\s\S]*to service_role/,
)

const insertFence = functionBlock(
  migration,
  'private.enforce_ai_master_on_direct_grant_insert',
)
const consumeFence = functionBlock(
  migration,
  'private.enforce_ai_master_on_child_grant_consume',
)
assert.match(
  insertFence,
  /admin_google_ai_child_grant_receipts[\s\S]*Google AI child grant requires immutable C2 evidence/,
)
assert.match(
  consumeFence,
  /admin_google_ai_child_grant_receipts[\s\S]*admin_google_ai_provider_start_intents[\s\S]*Google AI child consumption lacks provider-start evidence/,
)
assert.match(
  migration,
  /constraint trigger admin_google_ai_start_intents_completed[\s\S]*deferrable initially deferred/,
  'a provider intent and its operation receipt commit atomically',
)

const start = functionBlock(
  migration,
  'private.start_google_admin_material_ai_operation_v1',
)
assert.ok(start, 'missing transaction-authoritative material provider start')
const startRequest = start.indexOf('serialize_admin_ai_request_v1')
const startGrant = start.indexOf(
  'from public.ai_billing_grants as grant_record',
)
const startContext = start.indexOf('require_google_ai_provider_context_v1')
const startChildEvidence = start.indexOf(
  'from private.admin_google_ai_child_grant_receipts as receipt',
)
const startReplay = start.indexOf(
  'from private.admin_google_ai_provider_start_receipts as receipt',
)
const startGates = start.indexOf(
  'from private.admin_identity_runtime_gate as gate',
)
const startOwnership = start.indexOf(
  'from private.admin_lecture_ownerships as ownership',
)
const startPolicy = start.indexOf('from private.admin_ai_policies as policy')
const startLecture = start.indexOf('from public.lecture_sessions as lecture')
const startMaster = start.indexOf(
  'from public.lecture_ai_master_authorizations as master',
)
const startDocument = start.indexOf(
  'from public.lecture_pdf_documents as document',
)
const startFeatureEnable = start.indexOf('update public.lecture_ai_control')
const startIntent = start.indexOf(
  'insert into private.admin_google_ai_provider_start_intents',
)
const directStart = start.indexOf('private.start_lecture_ai_operation')
const startUsageBinding = start.indexOf(
  'from public.ai_usage_ledger as usage\n  where usage.id = operation_id_value',
)
const startGrantConsume = start.indexOf('update public.ai_billing_grants')
const startReceipt = start.indexOf(
  'insert into private.admin_google_ai_provider_start_receipts',
)
assert.ok(
  startRequest >= 0 &&
    startRequest < startGrant &&
    startGrant < startContext &&
    startContext < startChildEvidence &&
    startChildEvidence < startReplay &&
    startReplay < startGates &&
    startGates < startOwnership &&
    startOwnership < startPolicy &&
    startPolicy < startLecture &&
    startLecture < startMaster &&
    startMaster < startDocument &&
    startDocument < startFeatureEnable &&
    startFeatureEnable < startIntent &&
    startMaster < startIntent &&
    startIntent < directStart &&
    directStart < startUsageBinding &&
    startUsageBinding < startGrantConsume &&
    startGrantConsume < startReceipt,
  'provider start locks grant then Google context, gates, ownership, policy, lecture, master and document before atomic intent/usage/grant/receipt',
)
assert.doesNotMatch(
  start,
  /private\.start_material_ai_operation/,
  'C2 does not delegate operation selection to the legacy replay path',
)
assert.match(
  start,
  /target_nonce_hash is null[\s\S]*target_nonce_hash !~/,
  'NULL or malformed child nonce hashes fail closed',
)
assert.match(
  start.slice(startChildEvidence, startReplay),
  /child_receipt\.nonce_hash is distinct from target_nonce_hash/,
  'start replay is bound to the original child nonce evidence',
)
assert.match(start, /reserved_input_tokens/)
assert.match(start, /reserved_output_tokens/)
assert.match(start, /reserved_microusd/)
assert.doesNotMatch(start, /usage\.estimated_(?:input|output)_tokens/)
assert.doesNotMatch(start, /usage\.estimated_microusd/)
assert.match(
  start,
  /if found then[\s\S]*idempotentReplay[\s\S]*operationId/,
  'a committed provider start never dispatches a second operation on retry',
)
assert.match(
  start,
  /idempotent_replay'\)::boolean is distinct from false[\s\S]*usage_row\.requested_by_actor is distinct from actor_value[\s\S]*usage_row\.status is distinct from 'running'/,
  'legacy UUID collisions cannot become C2 provider starts',
)
assert.match(
  start,
  /material_analysis_enabled = control\.material_analysis_enabled[\s\S]*target_feature = 'material_analysis'[\s\S]*poll_suggestions_enabled = control\.poll_suggestions_enabled[\s\S]*target_feature = 'poll_suggestions'/,
  'the first Google start activates only its explicitly authorized feature',
)
assert.match(
  migration,
  /revoke all on function private\.start_google_admin_material_ai_operation_v1\([\s\S]*from public, anon, authenticated, service_role/,
)
assert.match(
  migration,
  /revoke all on function public\.start_google_admin_material_ai_operation_v1\([\s\S]*from public, anon, authenticated;[\s\S]*grant execute on function public\.start_google_admin_material_ai_operation_v1\([\s\S]*to service_role/,
)

const settlementContext = functionBlock(
  migration,
  'private.require_google_ai_provider_settlement_context_v1',
)
const settlementPrincipal = settlementContext.indexOf(
  'from private.admin_principals as principal',
)
const settlementMembership = settlementContext.indexOf(
  'from private.admin_environment_memberships as membership',
)
const settlementEnvironment = settlementContext.indexOf(
  'from private.admin_environments as environment',
)
const settlementSession = settlementContext.lastIndexOf(
  'from public.admin_sessions as session',
)
assert.ok(
  settlementContext.indexOf('serialize_admin_ai_request_v1') >= 0 &&
    settlementPrincipal >= 0 &&
    settlementPrincipal < settlementMembership &&
    settlementMembership < settlementEnvironment &&
    settlementEnvironment < settlementSession,
  'provider settlement binds immutable evidence in principal -> membership -> environment -> Admin-session order',
)
assert.match(settlementContext, /receipt\.operation_id = target_operation_id/)
assert.match(
  settlementContext,
  /principal_row\.provider_subject_hmac is distinct from[\s\S]*target_provider_subject_hmac/,
)
assert.match(
  settlementContext,
  /usage_row\.requested_by_actor is distinct from actor_value/,
  'settlement cannot be redirected to another identity, start receipt or usage row',
)

const completion = functionBlock(
  migration,
  'private.complete_google_admin_material_ai_operation_v1',
)
const completionEvidence = completion.indexOf(
  'require_google_ai_provider_settlement_context_v1',
)
const completionLiveContext = completion.indexOf(
  'require_google_ai_provider_context_v1',
)
const completionPolicy = completion.indexOf(
  'from private.admin_ai_policies as policy',
)
const completionLecture = completion.indexOf(
  'from public.lecture_sessions as lecture',
)
const completionMaster = completion.indexOf(
  'from public.lecture_ai_master_authorizations as master',
)
const completionSave = completion.indexOf(
  'private.complete_material_ai_operation',
)
assert.ok(
  completionEvidence >= 0 &&
    completionEvidence < completionLiveContext &&
    completionLiveContext < completionPolicy &&
    completionPolicy < completionLecture &&
    completionLecture < completionMaster &&
    completionMaster < completionSave,
  'success completion rechecks Google authority, policy, lecture and master before saving provider output',
)
assert.match(
  completion.slice(completionMaster, completionSave),
  /if not authority_is_live then[\s\S]*private\.fail_material_ai_operation[\s\S]*authorityRevoked[\s\S]*result_saved/,
  'revoked provider completion is accounted and discarded without saving content',
)
assert.match(
  migration,
  /revoke all on function public\.complete_google_admin_material_ai_operation_v1\([\s\S]*from public, anon, authenticated;[\s\S]*grant execute on function public\.complete_google_admin_material_ai_operation_v1\([\s\S]*to service_role/,
)
assert.match(
  migration,
  /revoke all on function public\.fail_google_admin_material_ai_operation_v1\([\s\S]*from public, anon, authenticated;[\s\S]*grant execute on function public\.fail_google_admin_material_ai_operation_v1\([\s\S]*to service_role/,
)

assert.match(aiBilling, /ADMIN_AI_CHILD_GRANT_SECRET/)
assert.match(aiBilling, /ADMIN_AI_CHILD_GRANT_SECRET_VERSION/)
assert.match(aiBilling, /deriveGoogleAiChildGrantNonce/)
assert.match(
  aiBilling,
  /google-ai-child-nonce:v1[\s\S]*request=\$\{requestId\}[\s\S]*lecture=\$\{lectureSessionId\}[\s\S]*feature=\$\{feature\}/,
)
assert.doesNotMatch(aiBilling, /export function getGoogleAiChildGrantSecret/)

assert.match(analyzeMaterial, /hasGoogleCredential === hasLegacyCredential/)
assert.match(analyzeMaterial, /verifyGoogleAdminOperationRequest/)
assert.match(analyzeMaterial, /deriveGoogleAiChildGrantNonce/)
assert.match(analyzeMaterial, /issue_google_material_ai_child_grant_v1/)
assert.match(analyzeMaterial, /start_google_admin_material_ai_operation_v1/)
assert.match(analyzeMaterial, /complete_google_admin_material_ai_operation_v1/)
assert.match(analyzeMaterial, /fail_google_admin_material_ai_operation_v1/)
assert.match(
  analyzeMaterial,
  /if \(started\.idempotentReplay\)[\s\S]*operation_in_progress[\s\S]*return jsonResponse/,
  'running replay stops before provider dispatch',
)
assert.match(
  analyzeMaterial,
  /let ownsNewOperation = false[\s\S]*if \(!ownsNewOperation \|\| !operationId\) return/,
  'a replay-read failure cannot cancel an operation owned by another request',
)
assert.match(
  analyzeMaterial,
  /if \(googleRpcIdentity && body\.startRequestId\)[\s\S]*fail_google_admin_material_ai_operation_v1[\s\S]*if \(!actorId\) return[\s\S]*admin_fail_material_ai_operation/,
  'Google failure settlement stays available after revocation while legacy failure remains actor-bound',
)
assert.match(
  analyzeMaterial,
  /if \(started\.idempotentReplay\)[\s\S]*ownsNewOperation = true/,
  'Google failure compensation is armed only after a fresh start',
)
assert.ok(
  analyzeMaterial.indexOf('if (started.idempotentReplay)') <
    analyzeMaterial.indexOf(
      "fetch(\n      'https://api.openai.com/v1/responses'",
    ),
  'provider HTTP is strictly after exact-replay handling',
)
assert.match(analyzeMaterial, /admin_start_material_ai_operation/)
assert.match(analyzeMaterial, /parseBillingGrantToken/)
assert.match(
  analyzeMaterial,
  /body\.billingGrant !== undefined[\s\S]*body\.idempotencyKey !== undefined/,
  'Google provider requests reject legacy child inputs',
)
assert.match(
  analyzeMaterial,
  /body\.grantRequestId !== undefined[\s\S]*body\.startRequestId !== undefined/,
  'legacy provider requests reject Google request identifiers',
)

assert.match(
  databaseTypes,
  /issue_google_material_ai_child_grant_v1: \{[\s\S]*target_nonce_key_version: number[\s\S]*target_request_id: string[\s\S]*Returns: Json/,
)
assert.match(
  databaseTypes,
  /start_google_admin_material_ai_operation_v1: \{[\s\S]*target_grant_id: string[\s\S]*target_provider_intent_digest: string[\s\S]*target_start_request_id: string[\s\S]*Returns: Json/,
)
assert.match(
  databaseTypes,
  /complete_google_admin_material_ai_operation_v1: \{[\s\S]*target_operation_id: string[\s\S]*target_start_request_id: string[\s\S]*Returns: Json/,
)
assert.match(
  databaseTypes,
  /fail_google_admin_material_ai_operation_v1: \{[\s\S]*target_operation_id: string[\s\S]*target_start_request_id: string[\s\S]*Returns: Json/,
)
assert.match(envExample, /^ADMIN_AI_CHILD_GRANT_SECRET=$/m)
assert.match(envExample, /^ADMIN_AI_CHILD_GRANT_SECRET_VERSION=1$/m)

for (const contract of [
  'Google AI child authority is database-default OFF',
  'NULL Google issuer fails closed before child admission',
  'NULL Google subject binding fails closed before child admission',
  'NULL child nonce fails closed without consuming the issued child',
  'a legacy grant UUID collision is a bounded fail-closed error',
  'first Google start enables only the explicitly authorized feature',
  'exact provider start replay converges after admission gates turn OFF',
  'a legacy idempotency UUID collision cannot become dispatch-eligible C2 work',
  'direct Google child insert without immutable receipt is rejected',
  'completion rechecks live Google authority without prompting for another MFA',
  'revoked completion accounts and closes work without saving provider content',
]) {
  assert.match(
    pgTap,
    new RegExp(contract.replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&')),
  )
}
assert.match(pgTap, /SELECT no_plan\(\)/)
assert.match(
  pgTap,
  /array\[\s*'academic_answers',\s*'material_analysis',\s*'poll_suggestions',\s*'summaries'\s*\]::text\[\]/,
  'the reusable master policy covers the complete all-except-captions scope',
)
assert.match(
  pgTap,
  /'material_analysis_call_limit', 5/,
  'the provider fixture remains inside the database call-limit constraint',
)
assert.match(
  pgTap,
  /NOT EXISTS \([\s\S]*admin_google_ai_provider_start_intents[\s\S]*admin_google_ai_provider_start_receipts[\s\S]*status = 'issued'/,
  'collision regression proves start evidence and child consumption roll back',
)
assert.match(
  pgTap,
  /RESET ROLE;\s*SELECT throws_ok\(\s*\$\$UPDATE public\.ai_billing_grants/,
  'direct child-consumption defense is tested above service_role table ACLs',
)
const providerFixtureC = pgTap.slice(
  pgTap.indexOf("'compass.test.c2_provider_child_c'"),
  pgTap.indexOf("'provider work starts while the Google Admin session is live'"),
)
assert.equal(
  [...providerFixtureC.matchAll(/repeat\('c',64\)/g)].length,
  2,
  'the third provider fixture reuses one fresh nonce only for its issue/start pair',
)
assert.doesNotMatch(
  providerFixtureC,
  /repeat\('8',64\)/,
  'the third provider fixture never collides with the legacy grant nonce',
)

console.log('Phase 7.30C2 AI provider static checks passed.')
