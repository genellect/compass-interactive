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
const summaryProviderMigration = read(
  'supabase/migrations/20260811223000_phase7_30c2_google_summary_provider.sql',
)
const academicMigration = read(
  'supabase/migrations/20260811233000_phase7_30c2_google_academic_provider.sql',
)
const realtimeControlMigration = read(
  'supabase/migrations/20260812011500_phase7_30c2_google_realtime_control.sql',
)
const realtimeProviderMigration = read(
  'supabase/migrations/20260812023000_phase7_30c2_google_realtime_provider.sql',
)
const aiBilling = read('supabase/functions/_shared/aiBilling.ts')
const openAiRealtime = read('supabase/functions/_shared/openaiRealtime.ts')
const analyzeMaterial = read(
  'supabase/functions/analyze-lecture-material/index.ts',
)
const manageSummaries = read(
  'supabase/functions/manage-lecture-summaries/index.ts',
)
const manageAiControl = read('supabase/functions/manage-ai-control/index.ts')
const generateSummary = read(
  'supabase/functions/generate-lecture-summary/index.ts',
)
const generateAcademicAnswer = read(
  'supabase/functions/generate-academic-answer/index.ts',
)
const issueRealtimeClientSecret = read(
  'supabase/functions/issue-realtime-client-secret/index.ts',
)
const publishCaptionWindow = read(
  'supabase/functions/publish-caption-window/index.ts',
)
const sweepRealtimeProviderCalls = read(
  'supabase/functions/sweep-realtime-provider-calls/index.ts',
)
const databaseTypes = read('src/types/database.ts')
const envExample = read('.env.local.example')
const pgTap = read('supabase/tests/phase7_30c2_google_ai_provider_test.sql')
const c1HeadUpgradeFixture = read(
  'scripts/fixtures/phase7-30c2-c1-head-upgrade-probe.sql',
)
const c1HeadUpgradeProbe = read(
  'scripts/fixtures/phase7-30c2-c1-head-upgrade-probe-test.sql',
)

assert.match(
  pgTap,
  /phase730c2-anchor@example\.test[\s\S]*'owner', 'active', true/,
  'provider authority fixtures retain a second active Owner during suspension checks',
)
assert.equal(
  (pgTap.match(/status = 'suspended'/g) ?? []).length,
  2,
  'summary and Academic completion each recheck a genuinely suspended membership',
)
assert.match(pgTap, /phase730c2_summary_authority_test/)
assert.match(pgTap, /phase730c2_academic_authority_test/)
assert.doesNotMatch(
  pgTap,
  /SET can_use_ai = false/,
  'provider tests cannot model Owner access loss by disabling Owner capability',
)

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
  /hasLegacyAdminFields\(body\)[\s\S]*appSessionToken is required[\s\S]*verifyGoogleAdminOperationRequest[\s\S]*deriveGoogleSummaryRunNonce[\s\S]*manage_google_admin_summary_run_v2/,
  'the summary Edge requires Google authority and rejects legacy Admin fields',
)
assert.match(
  manageSummaries,
  /manage_google_admin_summary_run_v2[\s\S]*target_auto_academic_answers_enabled:[\s\S]*body\.autoAcademicAnswers === true/,
  'Google summary automation uses the grant-free scheduler while each answer receives a per-call child',
)
assert.match(
  manageSummaries,
  /target_action: 'stop'[\s\S]*target_transport_enabled: googleContext\.transportEnabled/,
  'Google summary stop remains routable without the summary admission transport flag',
)
assert.match(
  manageSummaries,
  /const summariesTransportEnabled[\s\S]*!summariesTransportEnabled[\s\S]*!\['status', 'stop', 'hide'\]\.includes\(body\.action\)/,
  'the Edge transport kill switch blocks new work without blocking Google status, stop or hide',
)
assert.match(
  databaseTypes,
  /manage_google_admin_summary_run_v1: \{[\s\S]*target_academic_source_policy: string[\s\S]*target_action: string[\s\S]*target_request_id: string[\s\S]*target_run_token_hash: string[\s\S]*Returns: Json/,
)

for (const table of [
  'admin_google_summary_window_preflight_receipts',
  'admin_google_summary_window_start_bindings',
]) {
  assert.match(
    summaryProviderMigration,
    new RegExp(`create table private\\.${table}`),
  )
  assert.match(
    summaryProviderMigration,
    new RegExp(
      `alter table private\\.${table}[\\s\\S]*enable row level security;[\\s\\S]*` +
        `revoke all on private\\.${table}[\\s\\S]*` +
        `from public, anon, authenticated, service_role`,
    ),
  )
  assert.match(
    summaryProviderMigration,
    new RegExp(
      `before update or delete on private\\.${table}[\\s\\S]*` +
        `reject_admin_c1_evidence_mutation_v1`,
    ),
  )
}
assert.doesNotMatch(
  summaryProviderMigration.slice(
    summaryProviderMigration.indexOf(
      'create table private.admin_google_summary_window_preflight_receipts',
    ),
    summaryProviderMigration.indexOf(
      'create function private.google_summary_preflight_intent_digest_v1',
    ),
  ),
  /^\s*(?:raw|bearer|secret|transcript|pdf_text|provider_payload)(?!_sha256)\w*\s+\w+/im,
  'summary provider evidence stores hashes and bounded metadata, never raw source or credentials',
)
const summarySourceEvidenceValidator = functionBlock(
  summaryProviderMigration,
  'private.google_summary_source_evidence_is_valid_v1',
)
assert.match(
  summarySourceEvidenceValidator,
  /count\(\*\)[\s\S]*jsonb_object_keys\(target_source_hashes\)[\s\S]*<> 7[\s\S]*pdf_character_count[\s\S]*pdf_context_sha256[\s\S]*pdf_max_page_number[\s\S]*pdf_page_count[\s\S]*transcript_character_count[\s\S]*transcript_segment_count[\s\S]*transcript_sha256/,
  'summary source evidence accepts only the seven canonical hash/count keys',
)
assert.match(
  summarySourceEvidenceValidator,
  /jsonb_object_keys\(target_source_coverage\)[\s\S]*<> 3[\s\S]*'comments', 'pdf', 'transcript'[\s\S]*is distinct from 'boolean'/,
  'summary source coverage accepts only canonical boolean keys',
)
assert.match(
  summaryProviderMigration,
  /revoke all on function private\.google_summary_source_evidence_is_valid_v1\([\s\S]*service_role/,
  'the private exact evidence validator is unavailable to runtime roles',
)
assert.match(
  summaryProviderMigration,
  /check \(private\.google_summary_source_evidence_is_valid_v1\([\s\S]*source_hashes, source_coverage/,
  'the table constraint enforces the private exact evidence schema',
)
assert.match(
  summaryProviderMigration,
  /admin_google_summary_preflight_(?:environment|principal|membership|session|lecture|run|window)_idx[\s\S]*admin_google_summary_bindings_(?:operation|preflight|lecture|run|window)_idx/,
  'every summary evidence foreign key has a leading lookup index',
)

const summaryPreflight = functionBlock(
  summaryProviderMigration,
  'private.prepare_google_admin_summary_window_v1',
)
const preflightRequest = summaryPreflight.indexOf(
  'serialize_admin_ai_request_v1',
)
const preflightDiscovery = summaryPreflight.indexOf(
  'from private.admin_google_summary_window_preflight_receipts as receipt',
)
const preflightContext = summaryPreflight.indexOf(
  'require_google_admin_operation_context_v1',
)
const preflightReplay = summaryPreflight.indexOf(
  'from private.admin_google_summary_window_preflight_receipts as receipt',
  preflightContext,
)
const preflightGate = summaryPreflight.indexOf(
  'from private.admin_ai_unlock_runtime_gate as gate',
)
const preflightLecture = summaryPreflight.indexOf(
  'from public.lecture_sessions as lecture',
)
const preflightControl = summaryPreflight.indexOf(
  'from public.lecture_ai_control as control',
)
const preflightRun = summaryPreflight.indexOf(
  'from public.lecture_summary_runs as run',
)
const preflightWindow = summaryPreflight.indexOf(
  'from public.lecture_summary_windows as summary_window',
  preflightRun,
)
assert.ok(
  preflightRequest >= 0 &&
    preflightRequest < preflightDiscovery &&
    preflightDiscovery < preflightContext &&
    preflightContext < preflightReplay &&
    preflightReplay < preflightGate &&
    preflightGate < preflightLecture &&
    preflightLecture < preflightControl &&
    preflightControl < preflightRun &&
    preflightRun < preflightWindow,
  'summary preflight serializes discovered start requests before context, replays before gates, then locks lecture -> control -> run -> window',
)
assert.match(
  summaryPreflight.slice(preflightDiscovery, preflightContext),
  /admin_google_summary_window_start_bindings[\s\S]*serialize_admin_ai_request_v1\([\s\S]*start_binding_snapshot\.start_request_id/,
  'response-loss recovery takes the start advisory before identity and lecture locks',
)
assert.match(
  summaryPreflight.slice(preflightReplay, preflightGate),
  /idempotentReplay[\s\S]*refreshRequired[\s\S]*resultStatus/,
  'preflight exact replay returns receipt state instead of stale lecture content',
)
assert.match(
  summaryPreflight.slice(preflightReplay, preflightGate),
  /lecture_status[\s\S]*hard_stop_at[\s\S]*google_summary_provider_context_digest_v1[\s\S]*context_digest_value is distinct from receipt_row\.provider_context_digest[\s\S]*refreshRequired'[\s\S]*true[\s\S]*commentContext[\s\S]*materialContext[\s\S]*previousSummary/,
  'preflight replay exposes freshly derived source context only while the current owned lecture and original context digest still match',
)
assert.match(
  summaryPreflight.slice(preflightReplay, preflightGate),
  /context_digest_value is distinct from receipt_row\.provider_context_digest[\s\S]*admin_google_ai_provider_dispatch_receipts[\s\S]*provider_dispatched_at is null[\s\S]*summary_context_changed_before_dispatch[\s\S]*unclaimedStartRecovered/,
  'context drift zero-settles only an unclaimed start before releasing the window',
)
assert.match(
  summaryPreflight,
  /source_below_threshold[\s\S]*result_status[\s\S]*'skipped'/,
  'insufficient-source preflight reaches a terminal skip without provider authority',
)
assert.match(
  summaryPreflight,
  /pdf_max_page_number[\s\S]*document_row\.page_count[\s\S]*summary PDF context is not current[\s\S]*summary PDF context has no registered document/,
  'PDF source context is bound to the current registered document and page range',
)

const summaryChild = functionBlock(
  summaryProviderMigration,
  'private.issue_google_summary_ai_child_grant_v1',
)
assert.match(
  summaryChild,
  /private\.issue_google_ai_child_grant_v1\([\s\S]*'summaries'[\s\S]*from private\.admin_google_summary_window_preflight_receipts as receipt[\s\S]*result_status <> 'prepared'/,
  'one summary child is bound to one prepared preflight and the summaries feature',
)

const summaryStart = functionBlock(
  summaryProviderMigration,
  'private.start_google_admin_summary_window_operation_v1',
)
const summaryStartRequest = summaryStart.indexOf(
  'serialize_admin_ai_request_v1',
)
const summaryStartGrant = summaryStart.indexOf(
  'from public.ai_billing_grants as grant_record',
)
const summaryStartContext = summaryStart.indexOf(
  'require_google_ai_provider_context_v1',
)
const summaryStartReplay = summaryStart.indexOf(
  'from private.admin_google_ai_provider_start_receipts as receipt',
)
const summaryStartGate = summaryStart.indexOf(
  'from private.admin_identity_runtime_gate as gate',
)
const summaryStartPolicy = summaryStart.indexOf(
  'from private.admin_ai_policies as policy',
)
const summaryStartLecture = summaryStart.indexOf(
  'from public.lecture_sessions as lecture',
)
const summaryStartMaster = summaryStart.indexOf(
  'from public.lecture_ai_master_authorizations as master',
)
const summaryStartControl = summaryStart.indexOf(
  'from public.lecture_ai_control as control',
)
const summaryStartRun = summaryStart.indexOf(
  'from public.lecture_summary_runs as run',
)
const summaryStartWindow = summaryStart.indexOf(
  'from public.lecture_summary_windows as summary_window',
)
const summaryStartUsage = summaryStart.indexOf(
  'from public.ai_usage_ledger as usage',
  summaryStartWindow,
)
const summaryStartBinding = summaryStart.indexOf(
  'insert into private.admin_google_summary_window_start_bindings',
)
const summaryStartConsume = summaryStart.indexOf(
  'update public.ai_billing_grants as grant_record',
)
const summaryStartReceipt = summaryStart.indexOf(
  'insert into private.admin_google_ai_provider_start_receipts',
)
assert.ok(
  summaryStartRequest >= 0 &&
    summaryStartRequest < summaryStartGrant &&
    summaryStartGrant < summaryStartContext &&
    summaryStartContext < summaryStartReplay &&
    summaryStartReplay < summaryStartGate &&
    summaryStartGate < summaryStartPolicy &&
    summaryStartPolicy < summaryStartLecture &&
    summaryStartLecture < summaryStartMaster &&
    summaryStartMaster < summaryStartControl &&
    summaryStartControl < summaryStartRun &&
    summaryStartRun < summaryStartWindow &&
    summaryStartWindow < summaryStartUsage &&
    summaryStartUsage < summaryStartBinding &&
    summaryStartBinding < summaryStartConsume &&
    summaryStartConsume < summaryStartReceipt,
  'summary start preserves grant -> Google context -> policy -> lecture -> master -> control -> run -> window -> usage order',
)
assert.match(
  summaryStart,
  /control_row\.summaries_enabled is distinct from true[\s\S]*summary scheduler is not active/,
  'a provider attempt never restarts a stopped summary scheduler',
)
assert.match(
  summaryStart,
  /pdf_max_page_number[\s\S]*document_row\.page_count[\s\S]*summary PDF context changed before provider start[\s\S]*summary PDF context has no registered document/,
  'provider start rechecks the registered PDF and its bounded page range',
)
assert.doesNotMatch(
  summaryStart,
  /set[\s\S]*summaries_enabled\s*=\s*true/,
  'the provider start does not turn scheduler authority back on',
)
assert.match(
  summaryStart,
  /private\.start_lecture_ai_operation\([\s\S]*'summaries'[\s\S]*idempotent_replay'\)::boolean is distinct from false[\s\S]*usage_row\.requested_by_actor is distinct from actor_value[\s\S]*usage_row\.status <> 'running'/,
  'legacy UUID collisions cannot become dispatch-eligible Google summary work',
)

const summaryFailure = functionBlock(
  summaryProviderMigration,
  'private.fail_google_admin_summary_window_operation_v1',
)
assert.match(
  summaryFailure,
  /require_google_ai_provider_settlement_context_v1[\s\S]*admin_google_summary_window_start_bindings[\s\S]*admin_google_ai_provider_dispatch_receipts[\s\S]*fail_summary_window_operation/,
  'summary failure settles from immutable evidence and requires dispatch evidence for charged work',
)
assert.match(
  summaryFailure,
  /usage_row\.status = 'running' and target_status = 'failed'[\s\S]*fail_summary_window_operation[\s\S]*usage_row\.status = 'running'[\s\S]*finish_lecture_ai_operation\([\s\S]*'cancelled'[\s\S]*status = 'discarded'[\s\S]*current_operation_id = null/,
  'revoked completion discards its window while ordinary provider failures remain retryable',
)
assert.match(summaryFailure, /return \(settlement - 'results'\)/)
assert.match(
  summaryFailure,
  /target_status is null[\s\S]*actual_microusd is null[\s\S]*actual_input_tokens is null[\s\S]*actual_output_tokens is null/,
  'NULL settlement metrics fail closed at the typed summary boundary',
)

const summaryCompletion = functionBlock(
  summaryProviderMigration,
  'private.complete_google_admin_summary_window_operation_v1',
)
assert.match(
  summaryCompletion,
  /require_google_ai_provider_settlement_context_v1[\s\S]*admin_google_ai_provider_dispatch_receipts[\s\S]*require_google_ai_provider_context_v1[\s\S]*admin_lecture_ownerships[\s\S]*admin_ai_policies[\s\S]*lecture_sessions[\s\S]*lecture_ai_master_authorizations[\s\S]*if not authority_is_live then[\s\S]*fail_google_admin_summary_window_operation_v1[\s\S]*complete_summary_window_operation/,
  'summary completion saves content only after current Google authority, ownership, policy, lecture and master revalidation',
)
assert.match(
  summaryCompletion,
  /target_ai_output is null[\s\S]*target_quality_result is null[\s\S]*actual_microusd is null[\s\S]*actual_input_tokens is null[\s\S]*actual_output_tokens is null/,
  'NULL provider output or accounting fails closed before completion',
)

for (const facade of [
  'prepare_google_admin_summary_window_v1',
  'issue_google_summary_ai_child_grant_v1',
  'start_google_admin_summary_window_operation_v1',
  'complete_google_admin_summary_window_operation_v1',
  'fail_google_admin_summary_window_operation_v1',
]) {
  assert.match(
    summaryProviderMigration,
    new RegExp(
      `revoke all on function public\\.${facade}\\([\\s\\S]*` +
        `from public, anon, authenticated;[\\s\\S]*` +
        `grant execute on function public\\.${facade}\\([\\s\\S]*to service_role`,
    ),
  )
  assert.match(
    summaryProviderMigration,
    new RegExp(
      `revoke all on function private\\.${facade}\\([\\s\\S]*` +
        `from public, anon, authenticated, service_role`,
    ),
  )
}

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
  summaryProviderMigration,
  'private.settle_stale_google_ai_provider_dispatch_v1',
)
assert.match(
  staleDispatchSettlement,
  /serialize_admin_ai_request_v1[\s\S]*from private\.admin_google_ai_provider_dispatch_receipts as receipt[\s\S]*from public\.lecture_sessions as lecture[\s\S]*for update[\s\S]*from public\.ai_usage_ledger as usage[\s\S]*for update[\s\S]*accounting_settled_at is not null[\s\S]*provider_dispatched_at is null[\s\S]*intent_row\.feature = 'summaries'[\s\S]*fail_summary_window_operation[\s\S]*fail_material_ai_operation[\s\S]*provider_dispatch_lease_expired_ambiguous/,
  'stale dispatch recovery serializes the request and conservatively settles material or summary work in lecture -> usage order',
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

assert.match(analyzeMaterial, /hasLegacyAdminFields\(body\)/)
assert.match(analyzeMaterial, /appSessionToken is required/)
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
  /async function finishFailure[\s\S]*fail_google_admin_material_ai_operation_v1/,
  'Google failure settlement stays available after authority revocation',
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
assert.doesNotMatch(
  analyzeMaterial,
  /admin_start_material_ai_operation|admin_fail_material_ai_operation|parseBillingGrantToken/,
)
assert.match(
  analyzeMaterial,
  /hasLegacyAdminFields\(body\)[\s\S]*body\.idempotencyKey !== undefined/,
  'Google provider requests reject legacy child inputs',
)
assert.match(
  analyzeMaterial,
  /!isUuid\(body\.grantRequestId\)[\s\S]*!isUuid\(body\.startRequestId\)[\s\S]*body\.grantRequestId\.toLowerCase\(\) === body\.startRequestId\.toLowerCase\(\)/,
  'material provider work requires two distinct stable Google request identifiers',
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

assert.match(generateSummary, /hasLegacyAdminFields\(body\)/)
assert.match(generateSummary, /appSessionToken is required/)
assert.match(generateSummary, /verifyGoogleAdminOperationRequest/)
assert.match(generateSummary, /deriveGoogleAiChildGrantNonce/)
assert.match(generateSummary, /prepare_google_admin_summary_window_v1/)
assert.match(generateSummary, /issue_google_summary_ai_child_grant_v1/)
assert.match(generateSummary, /start_google_admin_summary_window_operation_v1/)
assert.match(generateSummary, /claim_google_ai_provider_dispatch_v1/)
assert.match(
  generateSummary,
  /complete_google_admin_summary_window_operation_v1/,
)
assert.match(generateSummary, /fail_google_admin_summary_window_operation_v1/)
assert.doesNotMatch(
  generateSummary,
  /\bbillingGrant\b|\bidempotencyKey\b/,
  'summary windows never accept a reusable run-level billing grant',
)
assert.match(
  generateSummary,
  /!isUuid\(body\.preflightRequestId\)[\s\S]*!isUuid\(body\.grantRequestId\)[\s\S]*!isUuid\(body\.startRequestId\)[\s\S]*\.size !== 3/,
  'summary windows require three distinct stable Google request identifiers',
)
assert.match(
  generateSummary,
  /pdf_max_page_number:[\s\S]*Math\.max\([\s\S]*page\.pageNumber/,
  'the Edge passes a bounded PDF page-range proof to both provider transactions',
)
assert.match(
  generateSummary,
  /JSON\.stringify\(providerRequestBody\)[\s\S]*sha256Hex\(serializedProviderBody\)[\s\S]*start_google_admin_summary_window_operation_v1[\s\S]*claim_google_ai_provider_dispatch_v1[\s\S]*fetch\([\s\S]*body: serializedProviderBody/,
  'the exact serialized provider payload is hashed, authorized, claimed and dispatched once',
)
assert.equal(
  (
    generateSummary.match(
      /fetch\('https:\/\/api\.openai\.com\/v1\/responses'/g,
    ) ?? []
  ).length,
  1,
  'the Google-only summary transport dispatches one provider request',
)
const googleSummaryBranch = generateSummary
assert.doesNotMatch(
  googleSummaryBranch,
  /admin_record_summary_window_language/,
  'Google language provenance is committed inside the typed start transaction',
)
assert.match(
  googleSummaryBranch,
  /ownsNewOperation = !started\.idempotentReplay[\s\S]*claim_google_ai_provider_dispatch_v1[\s\S]*if \(!claim\.dispatchAllowed\)[\s\S]*operation_in_progress[\s\S]*ownsNewOperation = true/,
  'a response-loss retry may recover one unclaimed summary start but never dispatch an existing claim twice',
)
assert.match(
  googleSummaryBranch,
  /providerWasDispatched = true[\s\S]*fetch\(/,
  'summary failure accounting distinguishes pre-dispatch rollback from ambiguous provider work',
)
assert.match(
  generateSummary,
  /async function finishGoogleFailure[\s\S]*if \([\s\S]*!ownsNewOperation[\s\S]*providerWasDispatched[\s\S]*conservativeUnknownUsage[\s\S]*fail_google_admin_summary_window_operation_v1[\s\S]*catch \(error\)[\s\S]*await finishGoogleFailure\(code\)/,
  'fresh-start, claim and provider failures converge through one typed settlement boundary',
)

assert.match(
  databaseTypes,
  /prepare_google_admin_summary_window_v1: \{[\s\S]*target_preflight_request_id|prepare_google_admin_summary_window_v1: \{[\s\S]*target_request_id: string[\s\S]*target_window_index: number[\s\S]*Returns: Json/,
)
assert.match(
  databaseTypes,
  /issue_google_summary_ai_child_grant_v1: \{[\s\S]*target_preflight_context_digest: string[\s\S]*target_preflight_request_id: string[\s\S]*target_request_id: string[\s\S]*Returns: Json/,
)
assert.match(
  databaseTypes,
  /start_google_admin_summary_window_operation_v1: \{[\s\S]*target_preflight_request_id: string[\s\S]*target_provider_payload_sha256: string[\s\S]*target_start_request_id: string[\s\S]*target_window_id: string[\s\S]*Returns: Json/,
)
assert.match(
  databaseTypes,
  /complete_google_admin_summary_window_operation_v1: \{[\s\S]*target_operation_id: string[\s\S]*target_quality_result: Json[\s\S]*target_start_request_id: string[\s\S]*Returns: Json/,
)
assert.match(
  databaseTypes,
  /fail_google_admin_summary_window_operation_v1: \{[\s\S]*target_operation_id: string[\s\S]*target_start_request_id: string[\s\S]*Returns: Json/,
)
assert.match(
  databaseTypes,
  /reap_stale_google_ai_provider_dispatches_v1: \{[\s\S]*job_limit\?: number[\s\S]*Returns: number/,
)

for (const table of [
  'admin_google_summary_auto_receipts',
  'admin_google_academic_answer_preflight_receipts',
  'admin_google_academic_answer_start_bindings',
]) {
  assert.match(academicMigration, new RegExp(`create table private\\.${table}`))
  assert.match(
    academicMigration,
    new RegExp(
      `alter table private\\.${table}[\\s\\S]*enable row level security;[\\s\\S]*` +
        `revoke all on private\\.${table}[\\s\\S]*` +
        `from public, anon, authenticated, service_role`,
    ),
  )
  assert.match(
    academicMigration,
    new RegExp(
      `before update or delete on private\\.${table}[\\s\\S]*` +
        `reject_admin_c1_evidence_mutation_v1`,
    ),
  )
}
assert.doesNotMatch(
  academicMigration.slice(
    academicMigration.indexOf(
      'create table private.admin_google_academic_answer_preflight_receipts',
    ),
    academicMigration.indexOf(
      'create function private.manage_google_admin_summary_run_v2',
    ),
  ),
  /^\s*(?:raw|bearer|secret|question|search_query|source_abstract|provider_payload)(?!_sha256)\w*\s+\w+/im,
  'academic evidence stores hashes and identifiers rather than source or credential content',
)
assert.match(
  academicMigration,
  /admin_google_summary_auto_(?:environment|principal|membership|session|lecture|master|run)_idx[\s\S]*admin_google_academic_preflight_(?:environment|principal|membership|session|lecture|request|run|summary)_idx[\s\S]*admin_google_academic_bindings_(?:operation|preflight|lecture|request|run)_idx/,
  'every Academic and automatic-summary evidence foreign key has a leading index',
)
assert.match(
  academicMigration,
  /academic_authority_mode text not null default 'none'[\s\S]*legacy_run_grant[\s\S]*google_per_call[\s\S]*lecture_summary_runs_academic_authorization_check/,
  'summary automation distinguishes legacy run grants from Google per-call authority',
)

const academicPreflight = functionBlock(
  academicMigration,
  'private.prepare_google_admin_academic_answer_v1',
)
const academicPreflightRequest = academicPreflight.indexOf(
  'serialize_admin_ai_request_v1',
)
const academicPreflightContext = academicPreflight.indexOf(
  'require_google_ai_provider_context_v1',
)
const academicPreflightReplay = academicPreflight.indexOf(
  'from private.admin_google_academic_answer_preflight_receipts as receipt',
)
const academicPreflightAuthority = academicPreflight.indexOf(
  'require_google_academic_live_authority_v1',
  academicPreflightReplay,
)
assert.ok(
  academicPreflightRequest >= 0 &&
    academicPreflightRequest < academicPreflightContext &&
    academicPreflightContext < academicPreflightReplay &&
    academicPreflightReplay < academicPreflightAuthority,
  'Academic preflight serializes one request before Google context, exact replay and live authority',
)
assert.match(
  academicPreflight,
  /status = 'evidence_checking'[\s\S]*lease_until <= statement_timestamp\(\)[\s\S]*require_google_academic_live_authority_v1[\s\S]*academic_authority_mode = 'google_per_call'[\s\S]*for update[\s\S]*claim_recovered := true/,
  'an expired preflight lease is recovered only after current gates, authority and automatic-run evidence pass',
)
assert.doesNotMatch(
  academicPreflight.slice(
    academicPreflightReplay,
    academicPreflight.indexOf('select gate.*', academicPreflightAuthority),
  ),
  /phase7_25_admin_results_json|target_question(?!_sha256)|source_abstract/,
  'Academic exact replay returns receipt state without answer or source content',
)

const academicChild = functionBlock(
  academicMigration,
  'private.issue_google_academic_answer_ai_child_grant_v1',
)
assert.match(
  academicChild,
  /where receipt\.request_id = target_grant_request_id/,
  'Academic child evidence is keyed by its immutable request UUID',
)
assert.match(
  academicChild,
  /request_row\.status = 'running'[\s\S]*child_replay[\s\S]*admin_google_academic_answer_start_bindings[\s\S]*admin_google_ai_provider_start_intents[\s\S]*admin_google_ai_provider_start_receipts[\s\S]*running replay evidence is incomplete/,
  'a lost start response may recover only through complete immutable child/start evidence',
)

const academicStart = functionBlock(
  academicMigration,
  'private.start_google_admin_academic_answer_operation_v1',
)
const academicStartRequest = academicStart.indexOf(
  'serialize_admin_ai_request_v1',
)
const academicStartGrant = academicStart.indexOf(
  'from public.ai_billing_grants as grant_record',
)
const academicStartContext = academicStart.indexOf(
  'require_google_ai_provider_context_v1',
)
const academicStartAuthority = academicStart.indexOf(
  'require_google_academic_live_authority_v1',
)
const academicStartPolicy = academicStart.indexOf(
  'from private.admin_ai_policies as policy',
)
const academicStartMaster = academicStart.indexOf(
  'from public.lecture_ai_master_authorizations as master',
)
const academicStartControl = academicStart.indexOf(
  'from public.lecture_ai_control as control',
)
const academicStartRequestRow = academicStart.lastIndexOf(
  'from public.academic_answer_requests as request',
)
const academicStartUsage = academicStart.indexOf(
  'from public.ai_usage_ledger as usage',
  academicStartRequestRow,
)
assert.ok(
  academicStartRequest >= 0 &&
    academicStartRequest < academicStartGrant &&
    academicStartGrant < academicStartContext &&
    academicStartContext < academicStartAuthority &&
    academicStartAuthority < academicStartPolicy &&
    academicStartPolicy < academicStartMaster &&
    academicStartMaster < academicStartControl &&
    academicStartControl < academicStartRequestRow &&
    academicStartRequestRow < academicStartUsage,
  'Academic start preserves request advisory -> child grant -> Google context -> live authority -> policy -> master -> control -> request -> usage order',
)
const academicAuthority = functionBlock(
  academicMigration,
  'private.require_google_academic_live_authority_v1',
)
assert.ok(
  academicAuthority.indexOf('from private.admin_ai_policies as policy') <
    academicAuthority.indexOf('from public.lecture_sessions as lecture') &&
    academicAuthority.indexOf('from public.lecture_sessions as lecture') <
      academicAuthority.lastIndexOf(
        'from public.lecture_ai_master_authorizations as master',
      ),
  'Academic live authority locks policy -> lecture -> master after its nonlocking master discovery',
)
assert.doesNotMatch(
  academicStart,
  /private\.start_(?:academic_answer_operation|auto_academic_answer_operation)/,
  'Google Academic start does not enter the legacy inverse-lock start path',
)
const academicFreshIntent = academicStart.indexOf(
  'insert into private.admin_google_ai_provider_start_intents',
)
const academicFreshOperation = academicStart.indexOf(
  'result_value := private.start_lecture_ai_operation',
  academicFreshIntent,
)
const academicFreshRequest = academicStart.indexOf(
  'update public.academic_answer_requests as request',
  academicFreshOperation,
)
const academicFreshGrant = academicStart.indexOf(
  'update public.ai_billing_grants as grant_record',
  academicFreshRequest,
)
const academicFreshReceipt = academicStart.indexOf(
  'insert into private.admin_google_ai_provider_start_receipts',
  academicFreshGrant,
)
const academicFreshBinding = academicStart.indexOf(
  'insert into private.admin_google_academic_answer_start_bindings',
  academicFreshReceipt,
)
assert.ok(
  academicFreshIntent >= 0 &&
    academicFreshIntent < academicFreshOperation &&
    academicFreshOperation < academicFreshRequest &&
    academicFreshRequest < academicFreshGrant &&
    academicFreshGrant < academicFreshReceipt &&
    academicFreshReceipt < academicFreshBinding,
  'Academic fresh start atomically records intent -> operation -> request -> consumed child -> start receipt -> immutable binding',
)
assert.match(
  academicStart.slice(academicFreshGrant, academicFreshBinding),
  /status = 'consumed'[\s\S]*operation_ids = array\[operation_id_value\]::uuid\[\][\s\S]*start_request_id, child_grant_id, operation_id/,
  'Academic start binds the consumed singleton child to the exact provider operation',
)

const academicFailure = functionBlock(
  academicMigration,
  'private.fail_google_admin_academic_answer_operation_v1',
)
assert.match(
  academicFailure,
  /target_status not in \('failed', 'cancelled'\)[\s\S]*error_code[\s\S]*like '%ambiguous%'[\s\S]*dispatch evidence/,
  'Academic failure validates terminal status and requires dispatch evidence for ambiguous accounting',
)
assert.match(
  academicFailure,
  /target_status = 'failed'[\s\S]*fail_academic_answer_operation[\s\S]*finish_lecture_ai_operation\([\s\S]*'cancelled'[\s\S]*status = 'discarded'/,
  'failed and cancelled Academic settlements remain distinct and content-free',
)

const academicCompletion = functionBlock(
  academicMigration,
  'private.complete_google_admin_academic_answer_operation_v1',
)
assert.match(
  academicCompletion,
  /require_google_ai_provider_settlement_context_v1[\s\S]*admin_google_ai_provider_dispatch_receipts[\s\S]*require_google_ai_provider_context_v1[\s\S]*require_google_academic_live_authority_v1[\s\S]*complete_academic_answer_operation/,
  'Academic completion rechecks dispatch evidence and live Google authority before saving provider content',
)
assert.match(
  academicCompletion,
  /if not authority_is_live then[\s\S]*fail_google_admin_academic_answer_operation_v1|if not authority_is_live then[\s\S]*fail_academic_answer_operation/,
  'revoked Academic completion is settled and discarded rather than published',
)
assert.match(
  academicMigration,
  /intent_row\.feature = 'academic_answers'[\s\S]*fail_academic_answer_operation[\s\S]*provider_dispatch_lease_expired_ambiguous/,
  'the shared stale-dispatch reaper accounts and releases abandoned Academic work',
)
assert.match(
  academicMigration,
  /create or replace function private\.start_academic_answer_operation\([\s\S]*from public\.ai_billing_grants[\s\S]*from public\.lecture_sessions[\s\S]*from public\.lecture_ai_control[\s\S]*from public\.academic_answer_requests/,
  'legacy manual Academic start is normalized to grant -> lecture -> control -> request order',
)
assert.match(
  academicMigration,
  /create or replace function private\.start_auto_academic_answer_operation\([\s\S]*academic_authority_mode = 'legacy_run_grant'[\s\S]*academic_authorization_grant_id is not null/,
  'legacy automatic start cannot consume Google per-call scheduler authority',
)

for (const facade of [
  'manage_google_admin_summary_run_v2',
  'prepare_google_admin_academic_answer_v1',
  'mark_google_admin_academic_answer_insufficient_v1',
  'issue_google_academic_answer_ai_child_grant_v1',
  'start_google_admin_academic_answer_operation_v1',
  'fail_google_admin_academic_answer_operation_v1',
  'complete_google_admin_academic_answer_operation_v1',
]) {
  assert.match(
    academicMigration,
    new RegExp(
      `revoke all on function public\\.${facade}\\([\\s\\S]*` +
        `from public, anon, authenticated;[\\s\\S]*` +
        `grant execute on function public\\.${facade}\\([\\s\\S]*` +
        `to service_role`,
    ),
    `${facade} is service-role-only`,
  )
  assert.match(
    academicMigration,
    new RegExp(
      `revoke all on function private\\.${facade}\\([\\s\\S]*` +
        `from public, anon, authenticated, service_role`,
    ),
    `${facade} private worker is unavailable to runtime roles`,
  )
}

assert.match(
  generateAcademicAnswer,
  /hasLegacyAdminFields\(body\)[\s\S]*body\.idempotencyKey !== undefined[\s\S]*appSessionToken is required[\s\S]*verifyGoogleAdminOperationRequest[\s\S]*preflightRequestId[\s\S]*grantRequestId[\s\S]*startRequestId/,
  'Academic Edge rejects legacy inputs and requires three stable Google request IDs',
)
assert.match(
  generateAcademicAnswer,
  /prepare_google_admin_academic_answer_v1[\s\S]*issue_google_academic_answer_ai_child_grant_v1[\s\S]*start_google_admin_academic_answer_operation_v1[\s\S]*claim_google_ai_provider_dispatch_v1[\s\S]*complete_google_admin_academic_answer_operation_v1/,
  'Google Academic provider work uses only typed preflight, child, start, dispatch and completion facades',
)
assert.match(
  generateAcademicAnswer,
  /let ownsNewOperation = !started\.idempotentReplay[\s\S]*if \(!claim\.dispatchAllowed\)[\s\S]*ownsNewOperation = true[\s\S]*providerDispatched = true[\s\S]*fetch\(/,
  'response-loss replay can win one missing dispatch claim but cannot dispatch an existing claim twice',
)
assert.match(
  generateAcademicAnswer,
  /providerDispatched[\s\S]*_ambiguous[\s\S]*fail_google_admin_academic_answer_operation_v1/,
  'Academic provider failure conservatively accounts only work that crossed dispatch',
)
assert.match(
  generateAcademicAnswer,
  /admin_authority_changed[\s\S]*result was safely discarded/,
  'late output after authority loss is discarded with actionable lecture UX copy',
)

for (const generatedRpc of [
  'manage_google_admin_summary_run_v2',
  'prepare_google_admin_academic_answer_v1',
  'mark_google_admin_academic_answer_insufficient_v1',
  'issue_google_academic_answer_ai_child_grant_v1',
  'start_google_admin_academic_answer_operation_v1',
  'fail_google_admin_academic_answer_operation_v1',
  'complete_google_admin_academic_answer_operation_v1',
]) {
  assert.match(
    databaseTypes,
    new RegExp(`${generatedRpc}: \\{[\\s\\S]*Returns: Json`),
    `${generatedRpc} is present in generated database types`,
  )
}
assert.match(
  databaseTypes,
  /lecture_summary_runs: \{[\s\S]*academic_authority_mode: string/,
  'generated summary-run types include the per-call Academic authority mode',
)
assert.match(
  c1HeadUpgradeFixture,
  /auto_academic_answers_enabled,[\s\S]*academic_authorization_grant_id[\s\S]*true, 'auto',[\s\S]*false, 'auto', null/,
  'the populated C1-head fixture carries both legacy automatic and non-automatic summary authority',
)
assert.match(
  c1HeadUpgradeProbe,
  /academic_authority_mode = 'legacy_run_grant'[\s\S]*academic_authority_mode = 'none'[\s\S]*admin_google_summary_auto_receipts[\s\S]*admin_google_academic_answer_preflight_receipts[\s\S]*admin_google_academic_answer_start_bindings/,
  'the populated upgrade proves authority-mode normalization without fabricated Google evidence',
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
  'one due summary window prepares immutable source context without a child',
  'unexpected raw source metadata fails closed before evidence insertion',
  'rejected raw source metadata leaves no immutable evidence',
  'summary output cannot be saved before an immutable dispatch claim',
  'revoked completion never persists provider content and clears the window lane',
  'recovery starts a fresh scheduler run after the revoked run is drained',
  'stale summary dispatch is conservatively accounted and releases its window',
  'context drift after a lost start response releases an unclaimed window',
  'unclaimed recovery settles zero cost and leaves no dispatch authority',
  'a recovered authorized retry saves its result without another MFA prompt',
  'the recovered happy path settles accounting and publishes one result',
  'default-OFF rejects Academic preflight before evidence or paid authority exists',
  'an expired unstarted Academic lease is recovered by the same exact request',
  'lost child response recovers the consumed child through immutable start evidence',
  'lost Academic start response converges on the same operation before dispatch',
  'the recovered Academic operation receives exactly one provider dispatch claim',
  'Academic completion rechecks live Google authority and discards revoked output',
  'Google automatic summary scheduling is grant-free until each provider call',
  'each automatic Academic answer receives its own single-use child',
  'bounded cleanup settles one abandoned automatic Academic dispatch',
  'stale automatic Academic dispatch is conservatively accounted and releases its request lane',
  'completion rechecks live Google authority without prompting for another MFA',
  'revoked completion accounts and closes work without saving provider content',
  'Realtime captions receive one scope-bound child without a provider call',
  'Realtime start consumes one child and reserves the bounded caption lane',
  'lost Realtime start response converges before provider dispatch',
  'Realtime provider dispatch is claimed exactly once after live control recheck',
  'Realtime activation records immutable provider evidence after live authority recheck',
  'an activated Google Realtime operation publishes one caption window',
  'stale caption delivery is ignored without stopping the live session',
  'same-sequence caption conflict is nonterminal and never replaces public text',
  'an activated Realtime operation continues without another MFA prompt',
  'disabling captions atomically settles the active operation before hangup',
  'terminal Realtime control settles accounting, clears public captions and preserves other AI work',
  'a second Realtime child can prepare an immediate-stop recovery fixture',
  'an unclaimed Realtime start remains locally reversible before provider dispatch',
  'an immediate caption disable succeeds before a provider claim exists',
  'pre-dispatch disable releases the full reservation without fabricated provider evidence',
]) {
  assert.match(
    pgTap,
    new RegExp(contract.replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&')),
  )
}
assert.match(pgTap, /SELECT no_plan\(\)/)
assert.match(
  pgTap,
  /array\[\s*'academic_answers',\s*'captions',\s*'material_analysis',\s*'poll_suggestions',\s*'summaries'\s*\]::text\[\]/,
  'the reusable policy covers every C2 provider action while each master remains scope-bound',
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
  pgTap.indexOf(
    "'provider work starts while the Google Admin session is live'",
  ),
)
assert.equal(
  [...providerFixtureC.matchAll(/repeat\('8',63\)\s*\|\|\s*'2'/g)].length,
  2,
  'the third provider fixture reuses one fresh nonce only for its issue/start pair',
)
assert.doesNotMatch(
  providerFixtureC,
  /repeat\('c',64\)|repeat\('8',64\)/,
  'the third provider fixture never collides with summary or legacy grant nonces',
)
for (const [suffix, expectedCount, contract] of [
  ['1', 2, 'Academic cancellation'],
  ['2', 2, 'provider completion'],
  ['3', 3, 'Realtime activation'],
  ['4', 2, 'Realtime unclaimed recovery'],
]) {
  const noncePattern = new RegExp(
    `repeat\\('8',\\s*63\\)\\s*\\|\\|\\s*'${suffix}'`,
    'g',
  )
  assert.equal(
    [...pgTap.matchAll(noncePattern)].length,
    expectedCount,
    `${contract} keeps one globally unique child nonce across its exact bindings`,
  )
}

assert.match(
  realtimeProviderMigration,
  /feature in \([\s\S]*'academic_answers', 'captions', 'material_analysis',[\s\S]*'poll_suggestions', 'summaries'[\s\S]*feature = 'captions' and provider_family = 'openai_realtime_v1'[\s\S]*feature <> 'captions'[\s\S]*provider_family = 'openai_responses_v1'/,
  'Realtime start evidence uses an exact captions/provider-family pairing',
)
assert.match(
  realtimeControlMigration,
  /create table private\.admin_google_realtime_provider_creation_receipts[\s\S]*enable row level security;[\s\S]*revoke all on private\.admin_google_realtime_provider_creation_receipts[\s\S]*public, anon, authenticated, service_role[\s\S]*before update or delete[\s\S]*reject_admin_c1_evidence_mutation_v1/,
  'Realtime provider creation evidence is private, RLS-protected and append-only',
)

for (const facade of [
  'issue_google_realtime_ai_child_grant_v1',
  'start_google_admin_realtime_operation_v1',
  'activate_google_admin_realtime_provider_v1',
  'fail_google_admin_realtime_provider_v1',
  'publish_google_admin_caption_window_v1',
]) {
  assert.match(
    realtimeProviderMigration,
    new RegExp(
      `revoke all on function public\\.${facade}\\([\\s\\S]*` +
        `from public, anon, authenticated;[\\s\\S]*` +
        `grant execute on function public\\.${facade}\\([\\s\\S]*` +
        `to service_role`,
    ),
    `${facade} is service-role-only`,
  )
  assert.match(
    databaseTypes,
    new RegExp(`${facade}: \\{[\\s\\S]*Returns: Json`),
    `${facade} is present in generated database types`,
  )
}

for (const worker of [
  'issue_google_realtime_ai_child_grant_v1',
  'start_google_admin_realtime_operation_v1',
  'finalize_google_admin_realtime_provider_v1',
  'publish_google_admin_caption_window_v1',
  'settle_unclaimed_google_realtime_start_v1',
  'settle_terminal_google_realtime_accounting_v1',
]) {
  assert.match(
    realtimeProviderMigration,
    new RegExp(
      `revoke all on function private\\.${worker}\\([\\s\\S]*` +
        `from public, anon, authenticated, service_role`,
    ),
    `${worker} is unavailable to runtime roles`,
  )
}

const realtimeStart = functionBlock(
  realtimeProviderMigration,
  'private.start_google_admin_realtime_operation_v1',
)
const realtimeStartRequest = realtimeStart.indexOf(
  'serialize_admin_ai_request_v1',
)
const realtimeStartGrant = realtimeStart.indexOf(
  'from public.ai_billing_grants as grant_record',
)
const realtimeStartContext = realtimeStart.indexOf(
  'require_google_ai_provider_context_v1',
)
const realtimeStartPolicy = realtimeStart.indexOf(
  'from private.admin_ai_policies as policy',
)
const realtimeStartLecture = realtimeStart.indexOf(
  'from public.lecture_sessions as lecture',
)
const realtimeStartMaster = realtimeStart.indexOf(
  'from public.lecture_ai_master_authorizations as master',
)
const realtimeStartControl = realtimeStart.indexOf(
  'from public.lecture_ai_control as control',
)
const realtimeStartOperation = realtimeStart.indexOf(
  'private.start_lecture_ai_operation',
)
const realtimeStartProvider = realtimeStart.indexOf(
  'insert into public.ai_realtime_provider_calls',
)
assert.ok(
  realtimeStartRequest >= 0 &&
    realtimeStartRequest < realtimeStartGrant &&
    realtimeStartGrant < realtimeStartContext &&
    realtimeStartContext < realtimeStartPolicy &&
    realtimeStartPolicy < realtimeStartLecture &&
    realtimeStartLecture < realtimeStartMaster &&
    realtimeStartMaster < realtimeStartControl &&
    realtimeStartControl < realtimeStartOperation &&
    realtimeStartOperation < realtimeStartProvider,
  'Realtime start preserves request -> child grant -> Google context -> policy -> lecture -> master -> control -> usage -> provider order',
)
assert.match(
  realtimeStart,
  /max_realtime_minutes_per_lecture[\s\S]*max_realtime_minutes_per_day[\s\S]*reserved_audio_seconds[\s\S]*max_calls_per_lecture[\s\S]*max_calls_per_day/,
  'Realtime start enforces audio and call budgets while holding the policy scope',
)
const providerDispatch = functionBlock(
  dispatchMigration,
  'private.claim_google_ai_provider_dispatch_v1',
)
const realtimeDispatchLecture = providerDispatch.indexOf(
  'from public.lecture_sessions as lecture',
)
const realtimeDispatchControl = providerDispatch.indexOf(
  'from public.lecture_ai_control as control',
)
const realtimeDispatchUsage = providerDispatch.indexOf(
  'from public.ai_usage_ledger as usage',
)
assert.ok(
  realtimeDispatchLecture >= 0 &&
    realtimeDispatchLecture < realtimeDispatchControl &&
    realtimeDispatchControl < realtimeDispatchUsage,
  'caption dispatch rechecks enabled control in lecture -> control -> usage order',
)
assert.match(
  providerDispatch,
  /feature'\) = 'captions'[\s\S]*captions_enabled[\s\S]*stop_requested_at is not null[\s\S]*P7338/,
  'a disabled caption feature cannot cross the paid provider-dispatch boundary',
)

const realtimeFinalize = functionBlock(
  realtimeProviderMigration,
  'private.finalize_google_admin_realtime_provider_v1',
)
const realtimeFinalizePolicy = realtimeFinalize.indexOf(
  'from private.admin_ai_policies as policy',
)
const realtimeFinalizeLecture = realtimeFinalize.indexOf(
  'from public.lecture_sessions as lecture',
)
const realtimeFinalizeMaster = realtimeFinalize.indexOf(
  'from public.lecture_ai_master_authorizations as master',
)
const realtimeFinalizeControl = realtimeFinalize.indexOf(
  'from public.lecture_ai_control as control',
)
const realtimeFinalizeUsage = realtimeFinalize.indexOf(
  'from public.ai_usage_ledger as usage',
)
const realtimeFinalizeProvider = realtimeFinalize.indexOf(
  'from public.ai_realtime_provider_calls as provider_call',
)
assert.ok(
  realtimeFinalizePolicy >= 0 &&
    realtimeFinalizePolicy < realtimeFinalizeLecture &&
    realtimeFinalizeLecture < realtimeFinalizeMaster &&
    realtimeFinalizeMaster < realtimeFinalizeControl &&
    realtimeFinalizeControl < realtimeFinalizeUsage &&
    realtimeFinalizeUsage < realtimeFinalizeProvider,
  'Realtime finalization uses policy -> lecture -> master -> control -> usage -> provider lock order',
)
assert.match(
  realtimeFinalize,
  /reconcile_activated_response_loss[\s\S]*authority_revoked_after_provider_dispatch_ambiguous[\s\S]*finish_lecture_ai_operation/,
  'activation response loss converges through durable hangup and conservative accounting',
)
const realtimeFinish = functionBlock(
  realtimeProviderMigration,
  'private.finish_realtime_caption_operation',
)
assert.match(
  realtimeFinish,
  /finish_lecture_ai_operation[\s\S]*if disable_feature then[\s\S]*delete from public\.lecture_public_captions[\s\S]*bump_lecture_live_state[\s\S]*'caption'/,
  'terminal Realtime settlement clears the student caption and advances live state',
)
assert.match(
  realtimeFinish,
  /admin_google_ai_provider_start_receipts[\s\S]*admin_google_ai_provider_dispatch_receipts[\s\S]*admin_google_realtime_provider_creation_receipts[\s\S]*creation_failed[\s\S]*activated[\s\S]*reserved_audio_seconds[\s\S]*realtime_stop_after_dispatch_ambiguous[\s\S]*elsif charge_elapsed/,
  'Realtime settlement distinguishes unclaimed, activated, ambiguous and legacy provider cost',
)
assert.match(
  realtimeFinish,
  /coalesce\([\s\S]*usage_snapshot\.finished_at,[\s\S]*statement_timestamp\(\)[\s\S]*- usage_snapshot\.requested_at/,
  'delayed terminal recovery charges only through the original finish time',
)

const realtimeControl = functionBlock(
  realtimeControlMigration,
  'private.manage_google_admin_ai_control_v1',
)
assert.match(
  realtimeControl,
  /admin_google_ai_provider_dispatch_receipts[\s\S]*admin_google_realtime_provider_creation_receipts[\s\S]*target_transport_enabled is true[\s\S]*google_ai_child_grant_enabled is true/,
  'Realtime heartbeat requires dispatch, activation, AI gate and transport authority',
)
assert.match(
  realtimeControl,
  /'should_stop', coalesce\([\s\S]*result_value ->> 'should_stop'/,
  'heartbeat replay preserves the canonical terminal stop signal',
)
assert.match(
  realtimeControl,
  /target_action = 'disableFeatures'[\s\S]*usage\.feature = 'captions'[\s\S]*usage\.status = 'running'[\s\S]*finish_realtime_caption_operation\([\s\S]*'caption_feature_disabled'[\s\S]*update public\.lecture_ai_control/,
  'disabling captions settles the active operation before provider sweep',
)
assert.match(
  realtimeControl,
  /Full stop is one database transaction[\s\S]*usage\.feature = 'captions'[\s\S]*finish_realtime_caption_operation\([\s\S]*stop_lecture_summary_run[\s\S]*stop_lecture_ai_control/,
  'a full stop settles Realtime accounting before legacy global control drain',
)
assert.match(
  realtimeProviderMigration,
  /result_status,[\s\S]*when coalesce\(\(result_value ->> 'accepted'\)::boolean, false\)[\s\S]*then 'published'[\s\S]*when live_authority is not true[\s\S]*then 'stopped'[\s\S]*else 'ignored'/,
  'stale caption windows are ignored without tearing down a healthy session',
)
assert.match(
  realtimeProviderMigration,
  /'shouldStop', live_authority is not true[\s\S]*'authority_revoked', 'selected_duration_elapsed'/,
  'only terminal authority or duration outcomes stop a healthy caption session',
)
assert.match(
  publishCaptionWindow,
  /publish_google_admin_caption_window_v1[\s\S]*shouldStop: result\.metadata\?\.shouldStop === true/,
  'the caption Edge propagates only an explicit terminal stop signal',
)
assert.doesNotMatch(
  sweepRealtimeProviderCalls,
  /PHASE4_REALTIME_CAPTIONS_ENABLED/,
  'provider hangup cleanup remains available while admission is disabled',
)
assert.ok(
  openAiRealtime.indexOf("response.headers.get('Location')") >= 0 &&
    openAiRealtime.indexOf("response.headers.get('Location')") <
      openAiRealtime.indexOf('await response.text()'),
  'Realtime provider call identity is captured before parsing a 2xx SDP body',
)
assert.match(
  openAiRealtime,
  /RealtimeProviderCreationError[\s\S]*creationMayHaveSucceeded[\s\S]*callId/,
  'post-dispatch ambiguity retains the known provider call for durable hangup',
)
assert.match(
  issueRealtimeClientSecret,
  /grantRequestId[\s\S]*startRequestId[\s\S]*issue_google_realtime_ai_child_grant_v1[\s\S]*start_google_admin_realtime_operation_v1[\s\S]*claim_google_ai_provider_dispatch_v1[\s\S]*activate_google_admin_realtime_provider_v1/,
  'the Realtime Edge uses stable request IDs and the complete typed authority chain',
)
assert.match(
  issueRealtimeClientSecret,
  /let childRetried = false[\s\S]*childResponse = await issueChild\(\)[\s\S]*let startRetried = false[\s\S]*startResponse = await startRealtime\(\)/,
  'child and start response loss receive one exact same-request recovery attempt before provider dispatch',
)
assert.match(
  issueRealtimeClientSecret,
  /fail_google_admin_realtime_provider_v1[\s\S]*target_action: 'stopFeature'/,
  'provider activation response loss falls back to a database-terminal stop before hangup',
)
assert.match(
  manageAiControl,
  /semanticAction === 'disableFeatures'[\s\S]*captions_enabled === false[\s\S]*sweepRealtimeProviderCalls[\s\S]*shouldStopRealtime[\s\S]*semanticAction === 'stopFeature'[\s\S]*sweepRealtimeProviderCalls/,
  'Google caption disable, terminal heartbeat and stop perform an immediate best-effort provider sweep',
)
assert.match(
  realtimeProviderMigration,
  /create or replace function public\.run_phase6_6_maintenance\(\)[\s\S]*security definer[\s\S]*reap_stale_google_ai_provider_dispatches_v1\(20\)[\s\S]*maintain_phase6_6_jobs\(\)[\s\S]*settle_terminal_google_realtime_accounting_v1\(20\)[\s\S]*revoke all on function public\.run_phase6_6_maintenance\(\)[\s\S]*grant execute on function public\.run_phase6_6_maintenance\(\)[\s\S]*to service_role/,
  'the service-only durable maintenance facade can reconcile private Google evidence and terminal legacy transitions',
)
assert.match(
  realtimeProviderMigration,
  /settle_unclaimed_google_realtime_start_v1[\s\S]*interval '45 seconds'[\s\S]*for update;[\s\S]*admin_google_ai_provider_dispatch_receipts[\s\S]*provider_dispatch_not_claimed/,
  'an abandoned pre-dispatch Realtime start is bounded and rechecks immutable evidence after locking',
)

console.log('Phase 7.30C2 AI provider static checks passed.')
