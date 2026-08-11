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
const dispatchMigration = read(
  'supabase/migrations/20260811203000_phase7_30c2_google_ai_provider_dispatch.sql',
)
const summaryMigration = read(
  'supabase/migrations/20260811213000_phase7_30c2_google_summary_scheduler.sql',
)
const aiBilling = read('supabase/functions/_shared/aiBilling.ts')
const analyzeMaterial = read(
  'supabase/functions/analyze-lecture-material/index.ts',
)
const manageSummaries = read(
  'supabase/functions/manage-lecture-summaries/index.ts',
)
const databaseTypes = read('src/types/database.ts')
const envExample = read('.env.local.example')
const pgTap = read('supabase/tests/phase7_30c2_google_ai_provider_test.sql')

assert.match(
  summaryMigration,
  /set operation_class = 'write'[\s\S]*where operation_key in \([\s\S]*manage-lecture-summaries\.start[\s\S]*manage-lecture-summaries\.resume/,
  'summary start and resume are scheduler writes rather than paid provider calls',
)
assert.match(
  summaryMigration,
  /set lecture_lock_mode = 'update'[\s\S]*where operation_key = 'manage-lecture-summaries\.stop'/,
  'summary stop takes the lecture update lock before entering the legacy stop core',
)
assert.match(
  summaryMigration,
  /create table private\.admin_google_summary_run_receipts[\s\S]*enable row level security;[\s\S]*revoke all on private\.admin_google_summary_run_receipts[\s\S]*service_role[\s\S]*before update or delete[\s\S]*reject_admin_c1_evidence_mutation_v1/,
  'summary scheduler evidence is private, append-only and unavailable to runtime roles',
)
const summaryScheduler = functionBlock(
  summaryMigration,
  'private.manage_google_admin_summary_run_v1',
)
const summaryRequest = summaryScheduler.indexOf('serialize_admin_ai_request_v1')
const summaryContext = summaryScheduler.indexOf(
  'require_google_ai_provider_context_v1',
)
const summaryReplay = summaryScheduler.indexOf(
  'from private.admin_google_summary_run_receipts as receipt',
)
const summaryReplayEnd = summaryScheduler.indexOf(
  "if target_action = 'stop' then",
  summaryReplay,
)
const summaryGate = summaryScheduler.indexOf(
  'from private.admin_identity_runtime_gate as gate',
)
const summaryOwnership = summaryScheduler.indexOf(
  'from private.admin_lecture_ownerships as ownership',
)
const summaryPolicy = summaryScheduler.indexOf(
  'from private.admin_ai_policies as policy',
)
const summaryLecture = summaryScheduler.indexOf(
  'from public.lecture_sessions as lecture',
)
const summaryMaster = summaryScheduler.lastIndexOf(
  'from public.lecture_ai_master_authorizations as master',
)
const summaryControl = summaryScheduler.indexOf(
  'from public.lecture_ai_control as control',
)
assert.ok(
  summaryRequest >= 0 &&
    summaryRequest < summaryContext &&
    summaryContext < summaryReplay &&
    summaryReplay < summaryGate &&
    summaryGate < summaryOwnership &&
    summaryOwnership < summaryPolicy &&
    summaryPolicy < summaryLecture &&
    summaryLecture < summaryMaster &&
    summaryMaster < summaryControl,
  'summary scheduler uses request -> Google context -> replay -> gates -> ownership -> policy -> lecture -> master -> control',
)
assert.match(
  summaryScheduler,
  /target_auto_academic_answers_enabled is distinct from false/,
  'Google summary scheduling cannot reuse one run-level child for automatic academic answers',
)
assert.match(
  summaryScheduler,
  /target_action = 'stop'[\s\S]*require_google_admin_operation_context_v1[\s\S]*select receipt\.\*[\s\S]*if target_action = 'stop'[\s\S]*stop_lecture_summary_run/,
  'summary stop uses current Google ownership and converges independently of admission gates',
)
assert.match(
  summaryScheduler,
  /return \(result_value - 'results'\)/,
  'fresh summary stop never returns AI result content after can_use_ai is revoked',
)
assert.doesNotMatch(
  summaryScheduler.slice(summaryReplay, summaryReplayEnd),
  /phase6_admin_results_json/,
  'exact scheduler replay returns receipt metadata without live summary content',
)
assert.match(
  summaryMigration,
  /revoke all on function public\.manage_google_admin_summary_run_v1\([\s\S]*from public, anon, authenticated;[\s\S]*grant execute on function public\.manage_google_admin_summary_run_v1\([\s\S]*to service_role/,
)
assert.match(
  aiBilling,
  /deriveGoogleSummaryRunNonce[\s\S]*google-summary-run-nonce:v1[\s\S]*action=\$\{input\.action\}/,
  'summary run credentials are deterministic, request-bound and action-separated',
)
assert.match(
  manageSummaries,
  /Exactly one Admin credential is required[\s\S]*verifyGoogleAdminOperationRequest[\s\S]*deriveGoogleSummaryRunNonce[\s\S]*manage_google_admin_summary_run_v1/,
  'the summary Edge keeps legacy and Google credentials mutually exclusive',
)
assert.match(
  manageSummaries,
  /automatic_academic_answers_unavailable[\s\S]*Start lecture summaries without automatic reference answers/,
  'Google scheduling fails closed until automatic academic answers use per-call children',
)
assert.match(
  manageSummaries,
  /target_action: 'stop'[\s\S]*target_transport_enabled: googleContext\.transportEnabled/,
  'Google summary stop remains routable without the summary admission transport flag',
)
assert.match(
  manageSummaries,
  /const summariesTransportEnabled[\s\S]*!summariesTransportEnabled[\s\S]*hasGoogleCredential && body\.action === 'stop'/,
  'the Edge transport kill switch blocks new work without blocking Google stop',
)
assert.match(
  databaseTypes,
  /manage_google_admin_summary_run_v1: \{[\s\S]*target_academic_source_policy: string[\s\S]*target_action: string[\s\S]*target_request_id: string[\s\S]*target_run_token_hash: string[\s\S]*Returns: Json/,
)

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

assert.match(
  dispatchMigration,
  /create table private\.admin_google_ai_provider_dispatch_receipts/,
)
assert.match(
  dispatchMigration,
  /alter table private\.admin_google_ai_provider_dispatch_receipts[\s\S]*enable row level security;[\s\S]*revoke all on private\.admin_google_ai_provider_dispatch_receipts[\s\S]*from public, anon, authenticated, service_role/,
)
assert.match(
  dispatchMigration,
  /before update or delete on private\.admin_google_ai_provider_dispatch_receipts[\s\S]*reject_admin_c1_evidence_mutation_v1/,
)
assert.match(
  dispatchMigration,
  /create function private\.require_google_ai_dispatch_receipt_on_terminal_v1\(\)[\s\S]*new\.status = 'succeeded'[\s\S]*admin_google_ai_provider_start_receipts[\s\S]*admin_google_ai_provider_dispatch_receipts[\s\S]*Google AI provider result lacks dispatch evidence[\s\S]*create trigger ai_usage_google_dispatch_terminal_guard/,
  'a Google provider result cannot be published without an immutable dispatch receipt',
)
assert.match(
  dispatchMigration,
  /lease_expires_at timestamptz not null[\s\S]*lease_expires_at <= claimed_at \+ interval '2 minutes'[\s\S]*admin_google_ai_dispatch_lease_idx/,
  'provider dispatch ambiguity is bounded by an indexed lease',
)
const staleDispatchSettlement = functionBlock(
  dispatchMigration,
  'private.settle_stale_google_ai_provider_dispatch_v1',
)
assert.match(
  staleDispatchSettlement,
  /serialize_admin_ai_request_v1[\s\S]*from private\.admin_google_ai_provider_dispatch_receipts as receipt[\s\S]*from public\.lecture_sessions as lecture[\s\S]*for update[\s\S]*from public\.ai_usage_ledger as usage[\s\S]*for update[\s\S]*accounting_settled_at is not null[\s\S]*provider_dispatched_at is null[\s\S]*fail_material_ai_operation[\s\S]*provider_dispatch_lease_expired_ambiguous/,
  'stale dispatch recovery serializes the request and settles conservatively in lecture -> usage order',
)
const staleDispatchReaper = functionBlock(
  dispatchMigration,
  'private.reap_stale_google_ai_provider_dispatches_v1',
)
assert.match(
  staleDispatchReaper,
  /lease_expires_at <= statement_timestamp\(\)[\s\S]*accounting_settled_at is null[\s\S]*limit job_limit[\s\S]*settle_stale_google_ai_provider_dispatch_v1/,
  'bounded cleanup converges abandoned dispatch claims without another provider call',
)
const dispatchClaim = functionBlock(
  dispatchMigration,
  'private.claim_google_ai_provider_dispatch_v1',
)
const dispatchEvidence = dispatchClaim.indexOf(
  'require_google_ai_provider_settlement_context_v1',
)
const dispatchReplay = dispatchClaim.indexOf(
  'from private.admin_google_ai_provider_dispatch_receipts as receipt',
)
const dispatchLive = dispatchClaim.indexOf(
  'require_google_ai_provider_context_v1',
)
const dispatchGate = dispatchClaim.indexOf(
  'from private.admin_identity_runtime_gate as gate',
)
const dispatchPolicy = dispatchClaim.indexOf(
  'from private.admin_ai_policies as policy',
)
const dispatchLecture = dispatchClaim.indexOf(
  'from public.lecture_sessions as lecture',
)
const dispatchMaster = dispatchClaim.indexOf(
  'from public.lecture_ai_master_authorizations as master',
)
const dispatchUsage = dispatchClaim.indexOf(
  'from public.ai_usage_ledger as usage',
)
const dispatchInsert = dispatchClaim.indexOf(
  'insert into private.admin_google_ai_provider_dispatch_receipts',
)
assert.ok(
  dispatchEvidence >= 0 &&
    dispatchEvidence < dispatchReplay &&
    dispatchReplay < dispatchLive &&
    dispatchLive < dispatchGate &&
    dispatchGate < dispatchPolicy &&
    dispatchPolicy < dispatchLecture &&
    dispatchLecture < dispatchMaster &&
    dispatchMaster < dispatchUsage &&
    dispatchUsage < dispatchInsert,
  'provider dispatch is immutable-evidence replay first, then live gates -> policy -> lecture -> master -> usage before one claim',
)
assert.match(
  dispatchClaim,
  /target_transport_enabled is distinct from true[\s\S]*google_operational_authorization_enabled[\s\S]*google_ai_child_grant_enabled/,
  'a fresh provider claim rechecks DB admission and the current Edge transport before dispatch',
)
assert.match(
  dispatchClaim.slice(dispatchReplay, dispatchLive),
  /lease_expires_at <= effective_now[\s\S]*settle_stale_google_ai_provider_dispatch_v1[\s\S]*dispatchAllowed'[\s\S]*false[\s\S]*idempotentReplay'[\s\S]*true[\s\S]*staleRecovered'/,
  'a lost dispatch response never authorizes a second request and becomes recoverable after its lease',
)
assert.match(
  dispatchClaim,
  /update public\.ai_usage_ledger as usage[\s\S]*provider_dispatched_at = effective_now[\s\S]*provider_request_id = target_client_request_id::text[\s\S]*insert into private\.admin_google_ai_provider_dispatch_receipts[\s\S]*effective_now \+ interval '90 seconds'/,
  'claim commit marks provider ambiguity and its bounded lease atomically',
)
assert.match(
  dispatchMigration,
  /revoke all on function public\.claim_google_ai_provider_dispatch_v1\([\s\S]*from public, anon, authenticated;[\s\S]*grant execute on function public\.claim_google_ai_provider_dispatch_v1\([\s\S]*to service_role/,
)
assert.match(
  dispatchMigration,
  /revoke all on function public\.reap_stale_google_ai_provider_dispatches_v1\([\s\S]*from public, anon, authenticated;[\s\S]*grant execute on function public\.reap_stale_google_ai_provider_dispatches_v1\([\s\S]*to service_role/,
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
  /if \(started\.idempotentReplay\)[\s\S]*claim_google_ai_provider_dispatch_v1[\s\S]*if \(!claim\.dispatchAllowed\)[\s\S]*operation_in_progress/,
  'a committed start may recover one missing dispatch claim, but an existing claim cannot dispatch twice',
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
  /ownsNewOperation = !started\.idempotentReplay[\s\S]*if \(started\.idempotentReplay\)[\s\S]*claim_google_ai_provider_dispatch_v1[\s\S]*providerRequestId = claim\.clientRequestId[\s\S]*ownsNewOperation = true/,
  'a fresh start is compensable before dispatch while a replay is armed only after winning the provider claim',
)
assert.match(
  analyzeMaterial,
  /let providerWasDispatched = false[\s\S]*providerWasDispatched &&[\s\S]*providerWasDispatched = true[\s\S]*fetch\(/,
  'pre-dispatch failures settle without charging an ambiguous provider reservation',
)
assert.match(
  analyzeMaterial,
  /reap_stale_google_ai_provider_dispatches_v1[\s\S]*provider_dispatch_cleanup_failed[\s\S]*claim_google_ai_provider_dispatch_v1[\s\S]*if \(claim\.staleRecovered\)[\s\S]*provider_dispatch_recovered/,
  'each Google provider attempt first reaps abandoned leases and returns an explicit retry path',
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
assert.match(
  databaseTypes,
  /claim_google_ai_provider_dispatch_v1: \{[\s\S]*target_client_request_id: string[\s\S]*target_operation_id: string[\s\S]*target_start_request_id: string[\s\S]*target_transport_enabled: boolean[\s\S]*Returns: Json/,
)
assert.match(
  analyzeMaterial,
  /claim_google_ai_provider_dispatch_v1[\s\S]*target_transport_enabled:[\s\S]*googleContext\.transportEnabled[\s\S]*materialTransportEnabled[\s\S]*Boolean\(openAiKey\)/,
  'material dispatch cannot outlive its current Edge transport or provider configuration',
)
assert.match(
  databaseTypes,
  /reap_stale_google_ai_provider_dispatches_v1: \{[\s\S]*job_limit\?: number[\s\S]*Returns: number/,
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

console.log('Phase 7.30C2 AI provider static checks passed.')
