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
  'supabase/migrations/20260811012111_phase7_30c2_unified_admin_authorization.sql',
)
const workspaceMigration = read(
  'supabase/migrations/20260812033000_phase7_30c2_google_workspace_authority.sql',
)
const pgTap = read(
  'supabase/tests/phase7_30c2_unified_admin_authorization_test.sql',
)
const sharedEdge = read('supabase/functions/_shared/googleAdminOperations.ts')
const manageAdminSessions = read(
  'supabase/functions/manage-admin-sessions/index.ts',
)
const manageComments = read('supabase/functions/manage-comments/index.ts')
const manageLectures = read('supabase/functions/manage-lectures/index.ts')
const manageMaterialAnalysis = read(
  'supabase/functions/manage-material-analysis/index.ts',
)
const managePdfDocuments = read(
  'supabase/functions/manage-pdf-documents/index.ts',
)
const managePolls = read('supabase/functions/manage-polls/index.ts')
const issuePdfAccessToken = read(
  'supabase/functions/issue-pdf-access-token/index.ts',
)
const operatorLiveSnapshot = read(
  'supabase/functions/operator-live-snapshot/index.ts',
)
const updateDisplayState = read(
  'supabase/functions/update-display-state/index.ts',
)
const materialAnalysisControl = read(
  'src/components/AdminAiControl/MaterialAnalysisControl.tsx',
)
const academicAnswerControl = read(
  'src/components/AdminAiControl/AcademicAnswerControl.tsx',
)
const realtimeCaptionControl = read(
  'src/components/AdminAiControl/RealtimeCaptionControl.tsx',
)
const aiMasterAuthorizationControl = read(
  'src/components/AdminAiControl/AiMasterAuthorizationControl.tsx',
)
const aiMasterAuthorizationRepository = read(
  'src/repositories/supabase/aiMasterAuthorizationRepository.ts',
)
const adminRoute = read('src/pages/AdminRoute.tsx')
const adminOperationSessionEvents = read(
  'src/lib/adminAuth/adminOperationSessionEvents.ts',
)
const edgeTransport = read('src/repositories/supabase/transport.ts')
const adminAiControlPanel = read(
  'src/components/AdminWorkspace/AdminAiControlPanel.tsx',
)
const adminContentAiRepository = read(
  'src/repositories/supabase/adminContentAiRepository.ts',
)
const featureFlags = read('src/lib/featureFlags.ts')
const databaseTypes = read('src/types/database.ts')
const envExample = read('.env.local.example')
const packageJson = JSON.parse(read('package.json'))
const nonlive = read('scripts/ci/run-nonlive-suite.mjs')
const docsTest = read('scripts/test-phase6-7-docs.mjs')
const upgradeRunner = read('scripts/test-phase7-30-upgrade.mjs')
const browserRunner = read('scripts/ci/run-browser-e2e.mjs')
const c2UpgradeFixture = read(
  'scripts/fixtures/phase7-30c2-c1-head-upgrade-probe.sql',
)
const c2UpgradeProbe = read(
  'scripts/fixtures/phase7-30c2-c1-head-upgrade-probe-test.sql',
)
const ciDocs = read('docs/CI_AND_BROWSER_E2E.md')
const gateDocs = read('docs/GATE_ROUTING.md')

const operationalEdges = [
  'analyze-lecture-material',
  'generate-academic-answer',
  'generate-lecture-summary',
  'issue-display-session',
  'issue-pdf-access-token',
  'issue-realtime-client-secret',
  'manage-admin-sessions',
  'manage-ai-control',
  'manage-comments',
  'manage-lectures',
  'manage-lecture-summaries',
  'manage-material-analysis',
  'manage-pdf-documents',
  'manage-pdf-publications',
  'manage-polls',
  'manage-presenter-connection',
  'operator-live-snapshot',
  'publish-caption-window',
  'update-display-state',
].sort()
const historicalPolicyEdges = [...operationalEdges, 'authorize-ai-start'].sort()

assert.match(
  upgradeRunner,
  /--version'[\s\S]*20260810160000[\s\S]*phase7-30c2-c1-head-upgrade-probe\.sql[\s\S]*phase7-30c2-c1-head-upgrade-probe-test\.sql/,
  'populated C1-head state upgrades through C2 in the canonical runner',
)
assert.match(c2UpgradeFixture, /pre-C2 unowned active lecture/)
assert.match(
  c2UpgradeProbe,
  /never infers ownership[\s\S]*fabricates no generic operation receipt[\s\S]*unownedActiveLectureCount/,
  'upgrade evidence preserves no-backfill and activation HOLD semantics',
)

assert.match(
  migration,
  /google_operational_authorization_enabled boolean not null\s+default false/,
)
assert.match(
  pgTap,
  /the C2 policy matrix contains exactly 75 approved operations/,
)
assert.match(pgTap, /only service_role can execute the C2 public facades/)
assert.match(
  pgTap,
  /server-generated lecture codes are not caller retry intent/,
)
assert.match(
  migration,
  /operation_key ~ '\^\[a-z0-9-\]\+\\\.\[A-Za-z\]\[A-Za-z0-9_\]\*\$'/,
)
assert.match(
  migration,
  /control_step_up_action text check \([\s\S]*environment_ai_policy_change/,
)
assert.match(
  migration,
  /alter table private\.admin_google_operation_policies enable row level security;[\s\S]*revoke all on private\.admin_google_operation_policies\s+from public, anon, authenticated, service_role/,
)

const policyRows = [
  ...migration.matchAll(
    /^  \('([^']+)', '([^']+)', '([^']+)', '([^']+)', '([^']+)', '([^']+)', '([^']+)', (true|false), (true|false), (true|false)\)[,;]/gm,
  ),
].map((match) => ({
  accessScope: match[4],
  action: match[3],
  edge: match[2],
  gateMode: match[6],
  key: match[1],
  lectureState: match[5],
  operationClass: match[7],
  ownerRequiresAi: match[9] === 'true',
}))
assert.equal(policyRows.length, 75, 'C2 inventory must remain closed')
assert.equal(new Set(policyRows.map(({ key }) => key)).size, 75)
assert.deepEqual(
  [...new Set(policyRows.map(({ edge }) => edge))].sort(),
  historicalPolicyEdges,
)
for (const policy of policyRows) {
  assert.equal(policy.key, `${policy.edge}.${policy.action}`)
}
for (const key of [
  'analyze-lecture-material.material_analysis',
  'analyze-lecture-material.poll_suggestions',
]) {
  assert.ok(policyRows.some((policy) => policy.key === key))
}
assert.deepEqual(
  policyRows.find(({ key }) => key === 'manage-lectures.emergencyStop'),
  {
    accessScope: 'owner_lecture',
    action: 'emergencyStop',
    edge: 'manage-lectures',
    gateMode: 'gate_independent',
    key: 'manage-lectures.emergencyStop',
    lectureState: 'open_any',
    operationClass: 'free_control',
    ownerRequiresAi: false,
  },
)
assert.match(
  migration,
  /where operation_key = 'manage-ai-control\.configure'[\s\S]*environment_ai_policy_change|set control_step_up_action = 'environment_ai_policy_change'[\s\S]*where operation_key = 'manage-ai-control\.configure'/,
)

const context = functionBlock(
  migration,
  'private.require_google_admin_operation_context_v1',
)
assert.ok(context, 'missing C2 transaction-authoritative context')
assert.match(context, /private\.require_google_ai_master_context_v1/)
for (const binding of [
  /principal_binding\.provider <> 'google'/,
  /principal_binding\.google_issuer is distinct from\s+target_google_issuer/,
  /principal_binding\.provider_subject_hmac is distinct from\s+target_provider_subject_hmac/,
  /principal_binding\.subject_pepper_version is distinct from\s+target_subject_pepper_version/,
]) {
  assert.match(context, binding)
}
assert.match(
  context,
  /policy_row\.access_scope = 'owner_lecture'[\s\S]*actor_role <> 'owner'/,
)
assert.match(
  context,
  /policy_row\.access_scope = 'owned_lecture'[\s\S]*ownership_row\.principal_id <>[\s\S]*ownership_row\.membership_id <>/,
  'owned_lecture must mean the exact actor ownership for both roles',
)
assert.doesNotMatch(
  context,
  /actor_role = 'instructor'[\s\S]{0,300}ownership_row\.principal_id/,
  'owners must not bypass ordinary own-lecture checks',
)
const c1Context = context.indexOf('require_google_ai_master_context_v1')
const principalBinding = context.indexOf(
  'from private.admin_principals as principal',
)
const gateLock = context.indexOf(
  'from private.admin_identity_runtime_gate as gate',
)
const ownershipLock = context.indexOf(
  'from private.admin_lecture_ownerships as ownership',
)
const lectureLock = context.indexOf('from public.lecture_sessions as lecture')
assert.ok(
  c1Context >= 0 &&
    c1Context < principalBinding &&
    principalBinding < gateLock &&
    gateLock < ownershipLock &&
    ownershipLock < lectureLock,
  'C2 context must extend C1 locks before gate, ownership and lecture',
)
assert.match(context.slice(gateLock, ownershipLock), /for share/)
assert.match(
  context,
  /lecture_lock_mode = 'share'[\s\S]*for share[\s\S]*else[\s\S]*for update/,
  'policy selects a shared or exclusive lecture lock before domain work',
)
assert.match(
  migration,
  /set lecture_lock_mode = 'update'[\s\S]*operation_class <> 'read'[\s\S]*operator-live-snapshot\.snapshot[\s\S]*operator-live-snapshot\.commentHistory/,
  'all writes and expiry-reconciling projections lock the lecture exclusively',
)

assert.match(
  migration,
  /create table private\.admin_google_lecture_operation_receipts/,
)
assert.match(
  migration,
  /alter table private\.admin_google_lecture_operation_receipts\s+enable row level security;[\s\S]*revoke all on private\.admin_google_lecture_operation_receipts\s+from public, anon, authenticated, service_role/,
)
assert.match(
  migration,
  /admin_google_lecture_operation_receipts_append_only[\s\S]*reject_admin_c1_evidence_mutation_v1/,
)
for (const index of [
  'environment_idx',
  'operation_idx',
  'principal_idx',
  'membership_idx',
  'session_idx',
  'target_idx',
  'result_idx',
]) {
  assert.match(migration, new RegExp(`admin_google_lecture_receipts_${index}`))
}

assert.match(migration, /create table private\.admin_google_operation_receipts/)
assert.match(
  migration,
  /alter table private\.admin_google_operation_receipts enable row level security;[\s\S]*revoke all on private\.admin_google_operation_receipts\s+from public, anon, authenticated, service_role/,
)
assert.match(
  migration,
  /admin_google_operation_receipts_append_only[\s\S]*reject_admin_c1_evidence_mutation_v1/,
)
for (const index of [
  'operation_idx',
  'environment_idx',
  'principal_idx',
  'membership_idx',
  'session_idx',
  'lecture_idx',
]) {
  assert.match(
    migration,
    new RegExp(`admin_google_operation_receipts_${index}`),
  )
}
assert.match(
  migration,
  /result_metadata jsonb not null default '\{\}'::jsonb check \([\s\S]*jsonb_typeof\(result_metadata\) = 'object'[\s\S]*pg_column_size\(result_metadata\) <= 4096/,
  'generic receipts keep only bounded non-secret metadata',
)
assert.match(
  migration,
  /result_metadata::text !~\* '[^']*bearer\|token\|secret\|pin\|totp\|credential\|authorization\|body\|content\|url\|code/,
  'generic receipt metadata rejects credential and content-shaped keys',
)

const operationIntent = functionBlock(
  migration,
  'private.google_admin_operation_intent_digest_v1',
)
assert.ok(operationIntent)
assert.match(operationIntent, /language sql\s+immutable/)
for (const binding of [
  /target_request_id/,
  /target_admin_session_id/,
  /target_operation_key/,
  /target_lecture_session_id/,
  /target_target_id/,
  /target_payload_digest/,
]) {
  assert.match(operationIntent, binding)
}
assert.match(operationIntent, /target_payload_digest !~ '\^\[0-9a-f\]\{64\}\$'/)
assert.doesNotMatch(operationIntent, /bearer|pin|totp|raw/i)

const manageCommentsSql = functionBlock(
  migration,
  'private.manage_google_admin_comments_v1',
)
assert.ok(manageCommentsSql)
const commentSerialize = manageCommentsSql.indexOf(
  'serialize_admin_ai_request_v1',
)
const commentContext = manageCommentsSql.indexOf(
  'require_google_admin_operation_context_v1',
)
const commentIntent = manageCommentsSql.indexOf(
  'google_admin_operation_intent_digest_v1',
)
const commentReceipt = manageCommentsSql.indexOf(
  'from private.admin_google_operation_receipts as receipt',
)
const commentGate = manageCommentsSql.indexOf(
  'assert_google_admin_operation_gate_v1',
)
const commentLifecycle = manageCommentsSql.indexOf(
  'assert_google_admin_operation_lecture_state_v1',
)
const commentMutation = manageCommentsSql.indexOf(
  'private.admin_moderate_lecture_comment',
)
assert.ok(
  commentSerialize >= 0 &&
    commentSerialize < commentContext &&
    commentContext < commentIntent &&
    commentIntent < commentReceipt &&
    commentReceipt < commentGate &&
    commentGate < commentLifecycle &&
    commentLifecycle < commentMutation,
  'comment mutation order is request -> context -> intent -> replay -> gate -> lifecycle -> child',
)
assert.match(
  manageCommentsSql,
  /actor_value := 'google-admin-session:'[\s\S]*private\.admin_moderate_lecture_comment/,
  'comment audit actors are derived from the DB-bound Admin session',
)
assert.doesNotMatch(
  manageCommentsSql.match(
    /insert into private\.admin_google_operation_receipts[\s\S]*?\);/,
  )?.[0] ?? '',
  /body|nickname|participant|bearer|token|secret|totp/i,
  'comment receipts never retain content or credentials',
)

const managePollsSql = functionBlock(
  migration,
  'private.manage_google_admin_polls_v1',
)
assert.ok(managePollsSql)
const pollSerialize = managePollsSql.indexOf('serialize_admin_ai_request_v1')
const pollContext = managePollsSql.lastIndexOf(
  'require_google_admin_operation_context_v1',
)
const pollIntent = managePollsSql.indexOf(
  'google_admin_operation_intent_digest_v1',
)
const pollReceipt = managePollsSql.indexOf(
  'from private.admin_google_operation_receipts as receipt',
)
const pollGate = managePollsSql.indexOf('assert_google_admin_operation_gate_v1')
const pollLifecycle = managePollsSql.lastIndexOf(
  'assert_google_admin_operation_lecture_state_v1',
)
const pollMutation = Math.min(
  ...['public.admin_create_poll', 'public.admin_set_poll_status']
    .map((needle) => managePollsSql.indexOf(needle))
    .filter((position) => position >= 0),
)
assert.ok(
  pollSerialize >= 0 &&
    pollSerialize < pollContext &&
    pollContext < pollIntent &&
    pollIntent < pollReceipt &&
    pollReceipt < pollGate &&
    pollGate < pollLifecycle &&
    pollLifecycle < pollMutation,
  'poll mutation order is request -> context -> intent -> replay -> gate -> lifecycle -> child',
)
assert.match(managePollsSql, /normalized_option_labels is null/)
assert.match(
  managePollsSql,
  /coalesce\(cardinality\(normalized_option_labels\), 0\) not between 2 and 8/,
)
assert.match(managePollsSql, /target_poll_type is null/)
assert.match(
  managePollsSql,
  /select distinct lower\(option_label\)[\s\S]*cardinality\(normalized_option_labels\)/,
  'poll payload validation rejects duplicate normalized options',
)
assert.match(
  managePollsSql,
  /target_action = 'close'[\s\S]*result_status <> 'closed'[\s\S]*poll close did not converge to closed/,
  'poll close converges when the poll is already terminal',
)
assert.doesNotMatch(
  managePollsSql.match(
    /insert into private\.admin_google_operation_receipts[\s\S]*?\);/,
  )?.[0] ?? '',
  /question|option_labels|bearer|token|secret|pin|totp/i,
  'poll receipts retain only the canonical payload digest and safe result scalars',
)
assert.match(
  migration,
  /create function private\.list_google_admin_polls_v1[\s\S]*poll_option_totals[\s\S]*phase727_journal_club_poll_slots/,
)
for (const facade of ['comments', 'polls']) {
  assert.match(
    migration,
    new RegExp(
      `create function public\\.manage_google_admin_${facade}_v1[\\s\\S]*security definer[\\s\\S]*set search_path = ''`,
    ),
  )
  assert.match(
    migration,
    new RegExp(
      `revoke all on function public\\.manage_google_admin_${facade}_v1[\\s\\S]*from public, anon, authenticated;[\\s\\S]*grant execute on function public\\.manage_google_admin_${facade}_v1[\\s\\S]*to service_role`,
    ),
  )
}

const managePdfDocumentsSql = functionBlock(
  migration,
  'private.manage_google_admin_pdf_documents_v1',
)
assert.ok(managePdfDocumentsSql)
const pdfSerialize = managePdfDocumentsSql.indexOf(
  'serialize_admin_ai_request_v1',
)
const pdfContext = managePdfDocumentsSql.lastIndexOf(
  'require_google_admin_operation_context_v1',
)
const pdfIntent = managePdfDocumentsSql.indexOf(
  'google_admin_operation_intent_digest_v1',
)
const pdfReceipt = managePdfDocumentsSql.indexOf(
  'from private.admin_google_operation_receipts as receipt',
)
const pdfGate = managePdfDocumentsSql.indexOf(
  'assert_google_admin_operation_gate_v1',
)
const pdfLifecycle = managePdfDocumentsSql.lastIndexOf(
  'assert_google_admin_operation_lecture_state_v1',
)
const pdfMutation = managePdfDocumentsSql.indexOf(
  'public.admin_register_pdf_document',
)
assert.ok(
  pdfSerialize >= 0 &&
    pdfSerialize < pdfContext &&
    pdfContext < pdfIntent &&
    pdfIntent < pdfReceipt &&
    pdfReceipt < pdfGate &&
    pdfGate < pdfLifecycle &&
    pdfLifecycle < pdfMutation,
  'PDF registration order is request -> context -> digest -> replay -> gate -> lifecycle -> document',
)
assert.match(
  managePdfDocumentsSql,
  /pdf_access_version[\s\S]*target_expected_access_version[\s\S]*admin_register_pdf_document/,
  'Local Publisher access-version evidence is checked under the C2 lecture lock',
)
assert.match(
  managePdfDocumentsSql,
  /local_manifest_etag = target_manifest_etag[\s\S]*returning document\.\* into registered_row/,
)
assert.doesNotMatch(
  managePdfDocumentsSql.match(
    /insert into private\.admin_google_operation_receipts[\s\S]*?\);/,
  )?.[0] ?? '',
  /display_name|manifest_etag|pdf_sha256|text_sha256|bearer|token|secret|pin|totp/i,
  'PDF receipts retain only the intent digest and safe result scalars',
)
assert.match(
  migration,
  /create function private\.list_google_admin_pdf_documents_v1[\s\S]*document\.visible/,
)
assert.match(
  migration,
  /create function public\.manage_google_admin_pdf_documents_v1[\s\S]*security definer[\s\S]*set search_path = ''/,
)
assert.match(
  migration,
  /revoke all on function public\.manage_google_admin_pdf_documents_v1[\s\S]*from public, anon, authenticated;[\s\S]*grant execute on function public\.manage_google_admin_pdf_documents_v1[\s\S]*to service_role/,
)

const issuePdfClaimsSql = functionBlock(
  migration,
  'private.issue_google_admin_pdf_access_claims_v1',
)
assert.ok(issuePdfClaimsSql)
const pdfClaimsSerialize = issuePdfClaimsSql.indexOf(
  'serialize_admin_ai_request_v1',
)
const pdfClaimsContext = issuePdfClaimsSql.indexOf(
  'require_google_admin_operation_context_v1',
)
const pdfClaimsIntent = issuePdfClaimsSql.indexOf(
  'google_admin_operation_intent_digest_v1',
)
const pdfClaimsReceipt = issuePdfClaimsSql.indexOf(
  'from private.admin_google_operation_receipts as receipt',
)
const pdfClaimsGate = issuePdfClaimsSql.indexOf(
  'assert_google_admin_operation_gate_v1',
)
const pdfClaimsLifecycle = issuePdfClaimsSql.indexOf(
  'assert_google_admin_operation_lecture_state_v1',
)
const pdfClaimsIssue = issuePdfClaimsSql.indexOf(
  'public.admin_get_pdf_access_claims_v1',
)
assert.ok(
  pdfClaimsSerialize >= 0 &&
    pdfClaimsSerialize < pdfClaimsContext &&
    pdfClaimsContext < pdfClaimsIntent &&
    pdfClaimsIntent < pdfClaimsReceipt &&
    pdfClaimsReceipt < pdfClaimsGate &&
    pdfClaimsGate < pdfClaimsLifecycle &&
    pdfClaimsLifecycle < pdfClaimsIssue,
  'PDF access claim issue is serialized and authorized before claims are read',
)
assert.match(
  issuePdfClaimsSql,
  /if found then[\s\S]*receipt_row\.result_metadata -> 'claims'[\s\S]*PDF access request binding does not match its receipt/,
  'PDF claim response loss replays the exact bounded claim set',
)
assert.doesNotMatch(issuePdfClaimsSql, /accessToken|privateKey|bearer/i)
assert.match(
  migration,
  /revoke all on function public\.issue_google_admin_pdf_access_claims_v1[\s\S]*from public, anon, authenticated;[\s\S]*grant execute on function public\.issue_google_admin_pdf_access_claims_v1[\s\S]*to service_role/,
)

const operatorSnapshotSql = functionBlock(
  migration,
  'private.get_google_admin_operator_live_snapshot_v1',
)
assert.ok(operatorSnapshotSql)
const operatorContext = operatorSnapshotSql.indexOf(
  'require_google_admin_operation_context_v1',
)
const operatorGate = operatorSnapshotSql.indexOf(
  'assert_google_admin_operation_gate_v1',
)
const operatorLifecycle = operatorSnapshotSql.indexOf(
  'assert_google_admin_operation_lecture_state_v1',
)
const operatorProjection = Math.min(
  ...[
    'private.get_lecture_operator_comment_history_v1',
    'private.get_lecture_operator_snapshot_v2',
    'private.get_lecture_operator_snapshot_v1',
  ]
    .map((needle) => operatorSnapshotSql.indexOf(needle))
    .filter((position) => position >= 0),
)
assert.ok(
  operatorContext >= 0 &&
    operatorContext < operatorGate &&
    operatorGate < operatorLifecycle &&
    operatorLifecycle < operatorProjection,
  'operator projection order is context -> gate -> lifecycle -> legacy projection',
)
assert.match(operatorSnapshotSql, /lecture_lock_mode'[\s\S]*<> 'update'/)
assert.match(
  operatorSnapshotSql,
  /target_action not in \('snapshot', 'commentHistory'\)/,
)
assert.match(
  migration,
  /revoke all on function public\.get_google_admin_operator_live_snapshot_v1[\s\S]*from public, anon, authenticated;[\s\S]*grant execute on function public\.get_google_admin_operator_live_snapshot_v1[\s\S]*to service_role/,
)

const displayStateSql = functionBlock(
  migration,
  'private.manage_google_admin_display_state_v1',
)
assert.ok(displayStateSql)
const displaySerialize = displayStateSql.indexOf(
  'serialize_admin_ai_request_v1',
)
const displayPresenterGate = displayStateSql.indexOf(
  'from private.presenter_runtime_gate as gate',
)
const displayContext = displayStateSql.indexOf(
  'require_google_admin_operation_context_v1',
)
const displayIntent = displayStateSql.indexOf(
  'google_admin_operation_intent_digest_v1',
)
const displayReceipt = displayStateSql.indexOf(
  'from private.admin_google_operation_receipts as receipt',
)
const displayGate = displayStateSql.indexOf(
  'assert_google_admin_operation_gate_v1',
)
const displayLifecycle = displayStateSql.indexOf(
  'assert_google_admin_operation_lecture_state_v1',
)
const displayLive = displayStateSql.indexOf(
  'from public.lecture_live_state as live',
)
const displayPresenterConnection = displayStateSql.indexOf(
  'from public.presenter_connections as connection',
)
const displayMutation = Math.min(
  ...['public.admin_update_pdf_display_v3', 'public.admin_update_pdf_display(']
    .map((needle) => displayStateSql.indexOf(needle))
    .filter((position) => position >= 0),
)
assert.ok(
  displaySerialize >= 0 &&
    displaySerialize < displayPresenterGate &&
    displayPresenterGate < displayContext &&
    displayContext < displayIntent &&
    displayIntent < displayReceipt &&
    displayReceipt < displayGate &&
    displayGate < displayLifecycle &&
    displayLifecycle < displayLive &&
    displayLive < displayPresenterConnection &&
    displayPresenterConnection < displayMutation,
  'Display mutation order is request -> Presenter gate -> Google context -> receipt -> lifecycle -> live -> connection -> update',
)
assert.match(
  displayStateSql,
  /normalized_mode is null[\s\S]*normalized_mode not in \('normal', 'presentation', 'slideOnly'\)/,
)
assert.match(
  displayStateSql,
  /why-learn-english-v1[\s\S]*next_page_count := 15[\s\S]*m4-sample-v1[\s\S]*next_page_count := 3/,
  'known legacy lecture assets remain usable during the Google transition',
)
assert.match(
  displayStateSql,
  /connection\.state = 'active'[\s\S]*last_seen_at > effective_now - interval '45 seconds'[\s\S]*using errcode = 'P7291'/,
  'active PowerPoint synchronization remains a server-authoritative manual-control fence',
)
assert.doesNotMatch(
  displayStateSql.match(
    /insert into private\.admin_google_operation_receipts[\s\S]*?\);/,
  )?.[0] ?? '',
  /bearer|token|secret|pin|totp|manifest_etag|pdf_sha256|text_sha256/i,
)
assert.match(
  migration,
  /revoke all on function public\.manage_google_admin_display_state_v1[\s\S]*from public, anon, authenticated;[\s\S]*grant execute on function public\.manage_google_admin_display_state_v1[\s\S]*to service_role/,
)

const materialAnalysisReadSql = functionBlock(
  migration,
  'private.get_google_admin_material_analysis_v1',
)
assert.ok(materialAnalysisReadSql)
assert.match(
  materialAnalysisReadSql,
  /require_google_admin_operation_context_v1[\s\S]*manage-material-analysis\.list[\s\S]*assert_google_admin_operation_gate_v1[\s\S]*assert_google_admin_operation_lecture_state_v1[\s\S]*public\.admin_list_material_ai_results/,
)
const materialAnalysisSql = functionBlock(
  migration,
  'private.manage_google_admin_material_analysis_v1',
)
assert.ok(materialAnalysisSql)
const materialSerialize = materialAnalysisSql.indexOf(
  'serialize_admin_ai_request_v1',
)
const materialContext = materialAnalysisSql.indexOf(
  'require_google_admin_operation_context_v1',
)
const materialIntent = materialAnalysisSql.indexOf(
  'google_admin_operation_intent_digest_v1',
)
const materialReceipt = materialAnalysisSql.indexOf(
  'from private.admin_google_operation_receipts as receipt',
)
const materialGate = materialAnalysisSql.indexOf(
  'assert_google_admin_operation_gate_v1',
)
const materialLifecycle = materialAnalysisSql.indexOf(
  'assert_google_admin_operation_lecture_state_v1',
)
const materialMutation = Math.min(
  ...[
    'public.admin_adopt_poll_proposal',
    'public.admin_reject_poll_proposal',
    'public.admin_set_material_summary_publication',
  ]
    .map((needle) => materialAnalysisSql.indexOf(needle))
    .filter((position) => position >= 0),
)
assert.ok(
  materialSerialize >= 0 &&
    materialSerialize < materialContext &&
    materialContext < materialIntent &&
    materialIntent < materialReceipt &&
    materialReceipt < materialGate &&
    materialGate < materialLifecycle &&
    materialLifecycle < materialMutation,
  'material curation order is request -> context -> digest -> replay -> gate -> lifecycle -> mutation',
)
assert.match(materialAnalysisSql, /target_poll_type is null/)
assert.match(
  materialAnalysisSql,
  /target_action in \('adopt', 'publishSummary', 'hideSummary'\)[\s\S]*lecture_lock_mode'[\s\S]*is distinct from 'update'/,
  'material mutations require the exclusive lecture lock before nested legacy RPCs',
)

const adminSessionsReadSql = functionBlock(
  migration,
  'private.get_google_admin_sessions_v1',
)
const adminSessionsMutationSql = functionBlock(
  migration,
  'private.manage_google_admin_sessions_v1',
)
assert.match(
  adminSessionsReadSql,
  /require_google_admin_operation_context_v1[\s\S]*manage-admin-sessions\.list[\s\S]*'expires_at'[\s\S]*'idle_expires_at'[\s\S]*'issued_at'[\s\S]*'last_seen_at'[\s\S]*'revoke_reason'[\s\S]*'revoked_at'[\s\S]*authentication_method = 'google_totp'[\s\S]*principal_id[\s\S]*membership_id[\s\S]*limit 20/,
  'session ledger is bounded to the current principal membership',
)
const sessionReplay = adminSessionsMutationSql.indexOf(
  'from private.admin_google_operation_receipts as receipt',
)
const sessionContext = adminSessionsMutationSql.indexOf(
  'require_google_admin_operation_context_v1',
)
const sessionMutation = adminSessionsMutationSql.indexOf(
  'update public.admin_sessions',
)
assert.ok(
  sessionReplay >= 0 &&
    sessionReplay < sessionContext &&
    sessionContext < sessionMutation,
  'session exact replay precedes active context while new revocation remains context-bound',
)
assert.match(
  adminSessionsMutationSql,
  /target_action <> 'revoke'[\s\S]*target_session_id is not null[\s\S]*principal_id =[\s\S]*membership_id =[\s\S]*order by session\.id[\s\S]*for update/,
  'session operations reject spare targets and revoke only self sessions in UUID order',
)
assert.match(
  adminSessionsMutationSql,
  /self_logout[\s\S]*self_session_revoked[\s\S]*self_all_sessions_revoked[\s\S]*insert into private\.admin_google_operation_receipts[\s\S]*insert into private\.admin_audit_events/,
)
assert.match(materialAnalysisSql, /normalized_options is null/)
assert.match(
  materialAnalysisSql,
  /coalesce\(cardinality\(normalized_options\), 0\) not between 2 and 8/,
)
assert.match(materialAnalysisSql, /target_review_state is null/)
assert.match(
  materialAnalysisSql,
  /target_action = 'reject'[\s\S]*target_analysis_id is not null[\s\S]*target_summary_body is not null[\s\S]*target_review_state is not null/,
  'proposal rejection rejects every summary-only field',
)
assert.match(
  materialAnalysisSql,
  /target_action = 'publishSummary'[\s\S]*target_proposal_id is not null[\s\S]*target_option_labels is not null/,
  'summary publication rejects every proposal-only field',
)
assert.match(
  materialAnalysisSql,
  /target_action in \('adopt', 'reject'\)[\s\S]*target_type_value := 'poll_proposal'[\s\S]*target_type_value := 'material_summary'/,
  'audit target type and id are derived from the action rather than spare input',
)
assert.match(
  materialAnalysisSql,
  /\(publication_value ->> 'analysis_id'\) is distinct from[\s\S]*target_analysis_id::text[\s\S]*\(publication_value ->> 'visibility'\) is distinct from \([\s\S]*case when target_action = 'publishSummary'[\s\S]*\) then/,
  'summary publication proves the nested mutation targeted the requested analysis',
)
assert.match(
  materialAnalysisSql,
  /extensions\.digest[\s\S]*'summaryBody'[\s\S]*'sha256'/,
  'reviewed summary content is hashed into intent rather than stored in receipts',
)
assert.match(
  materialAnalysisSql,
  /if found then[\s\S]*'refreshRequired', true[\s\S]*'results', null/,
  'exact replay never becomes a stale material-content read grant',
)
assert.doesNotMatch(
  materialAnalysisSql.match(
    /insert into private\.admin_google_operation_receipts[\s\S]*?\);/,
  )?.[0] ?? '',
  /summaryBody|question|optionLabels|bearer|token|secret|pin|totp/i,
)
for (const facade of [
  'get_google_admin_material_analysis_v1',
  'manage_google_admin_material_analysis_v1',
]) {
  assert.match(
    migration,
    new RegExp(
      `revoke all on function public\\.${facade}[\\s\\S]*from public, anon, authenticated;[\\s\\S]*grant execute on function public\\.${facade}[\\s\\S]*to service_role`,
    ),
  )
}

const intent = functionBlock(
  migration,
  'private.google_admin_lecture_intent_digest_v1',
)
assert.ok(intent)
assert.match(intent, /language sql\s+immutable/)
assert.match(intent, /starts_at_epoch_us/)
assert.match(intent, /ends_at_epoch_us/)
assert.doesNotMatch(
  intent,
  /code_hash|target_code/,
  'server-generated lecture codes are output, not retry intent',
)

const manage = functionBlock(
  migration,
  'private.manage_google_admin_lectures_v1',
)
assert.ok(manage)
const serialize = manage.indexOf('serialize_admin_ai_request_v1')
const strongContext = manage.lastIndexOf(
  'require_google_admin_operation_context_v1',
)
const digest = manage.indexOf('google_admin_lecture_intent_digest_v1')
const receipt = manage.indexOf(
  'from private.admin_google_lecture_operation_receipts as receipt',
)
const gate = manage.indexOf('assert_google_admin_operation_gate_v1')
const lifecycle = manage.indexOf(
  'assert_google_admin_operation_lecture_state_v1',
)
const firstMutation = Math.min(
  ...[
    'public.admin_create_lecture_v2',
    'public.admin_create_phase727_journal_club_run_v1',
    'public.admin_duplicate_lecture_v1',
    'private.start_lecture_core',
    'private.close_lecture_core',
  ]
    .map((needle) => manage.indexOf(needle))
    .filter((position) => position >= 0),
)
assert.ok(
  serialize >= 0 &&
    serialize < strongContext &&
    strongContext < digest &&
    digest < receipt &&
    receipt < gate &&
    gate < lifecycle &&
    lifecycle < firstMutation,
  'mutation order is request lock -> context -> intent -> replay -> gate -> lifecycle -> mutation',
)
assert.match(
  manage,
  /if found then[\s\S]*idempotentReplay'[\s\S]*raise exception 'lecture request binding does not match its receipt'/,
)
assert.match(manage, /lecture start did not transition to open/)
assert.match(manage, /lecture close did not transition to closed/)
assert.match(
  migration,
  /state_requirement = 'open_any'[\s\S]*lecture_status <> 'open'/,
  'terminal close remains available after the hard-stop deadline',
)
assert.match(
  migration,
  /state_requirement = 'draft_or_open'[\s\S]*lecture_status = 'open'[\s\S]*hard_stop_at <= effective_now/,
  'state-expanding draft/open operations reject an overdue open lecture',
)
assert.match(
  migration,
  /'manage-polls\.close'[\s\S]*'draft_or_open_any'[\s\S]*'gate_independent'[\s\S]*'free_control'/,
  'poll close remains a deadline-independent terminal control',
)
assert.match(
  manage,
  /assert_google_admin_operation_gate_v1\(\s*context_value,\s*target_transport_enabled/,
)
assert.match(manage, /pre-C2 Journal Club run cannot be adopted implicitly/)
assert.doesNotMatch(
  migration.match(
    /insert into private\.admin_google_lecture_operation_receipts[\s\S]*?\);/,
  )?.[0] ?? '',
  /target_code|lecture_code/,
)

assert.match(
  migration,
  /create function public\.manage_google_admin_lectures_v1[\s\S]*security definer[\s\S]*set search_path = ''/,
)
assert.match(
  migration,
  /revoke all on function private\.manage_google_admin_lectures_v1[\s\S]*from public, anon, authenticated, service_role/,
)
assert.match(
  migration,
  /revoke all on function public\.manage_google_admin_lectures_v1[\s\S]*from public, anon, authenticated;[\s\S]*grant execute on function public\.manage_google_admin_lectures_v1[\s\S]*to service_role/,
)
assert.match(
  migration,
  /create function public\.get_google_admin_operations_activation_preflight_v1\(\)[\s\S]*security definer[\s\S]*unowned_active_lecture_count = 0[\s\S]*session_count = 0[\s\S]*legacy_pin_login_enabled is false/,
  'Google-only preflight reports unowned lectures and live legacy sessions',
)
assert.match(
  migration,
  /'authoritative', false[\s\S]*'preflightReady'[\s\S]*Advisory read-only preflight[\s\S]*same transaction/,
  'read-only preflight must never be mistaken for the E cutover transaction',
)
assert.match(
  migration,
  /revoke all on function\s+public\.get_google_admin_operations_activation_preflight_v1\(\)[\s\S]*from public, anon, authenticated;[\s\S]*grant execute on function\s+public\.get_google_admin_operations_activation_preflight_v1\(\)[\s\S]*to service_role/,
)

assert.match(
  sharedEdge,
  /transportEnabled:[\s\S]*PHASE730_GOOGLE_ADMIN_OPERATIONS_ENABLED'\) === 'true'/,
)
assert.doesNotMatch(
  sharedEdge,
  /if \(Deno\.env\.get\('PHASE730_GOOGLE_ADMIN_OPERATIONS_ENABLED'\)/,
  'transport OFF must still reach the DB for exact replay and free controls',
)
assert.match(sharedEdge, /getAllowedCorsOrigin\(request\)/)
assert.match(sharedEdge, /serviceClient\.auth\.getUser\(bearerToken\)/)
assert.match(sharedEdge, /claims\.aal !== 'aal2'/)
assert.match(sharedEdge, /getAuthenticatorAssuranceLevel\(bearerToken\)/)
assert.match(sharedEdge, /getTrustedGoogleIdentity/)
assert.match(
  sharedEdge,
  /appMetadataProviders\.length !== 1[\s\S]*appMetadataProviders\[0\] !== 'google'[\s\S]*userIdentities\.length !== 1[\s\S]*userIdentities\[0\]\?\.provider !== 'google'/,
  'C2 refuses a Google-linked user authenticated through another provider',
)
assert.match(sharedEdge, /readSecret\('ADMIN_IDENTITY_PEPPER'\)/)
assert.match(sharedEdge, /hmacIdentityValue\([\s\S]*'subject'/)
assert.match(sharedEdge, /appSessionTokenHash: await sha256Hex/)
assert.doesNotMatch(
  sharedEdge.match(
    /export type GoogleAdminOperationContext[\s\S]*?\n\}/,
  )?.[0] ?? '',
  /bearerToken/,
  'raw bearer tokens must not leave the verifier implementation',
)
assert.doesNotMatch(sharedEdge, /ADMIN_PIN|BILLING_PIN/)

assert.match(manageLectures, /hasLegacyAdminFields\(body\)/)
assert.match(manageLectures, /!body\.appSessionToken\?\.trim\(\)/)
assert.match(manageLectures, /verifyGoogleAdminOperationRequest/)
assert.match(manageLectures, /manage_google_admin_lectures_v1/)
assert.match(
  manageLectures,
  /target_transport_enabled: verification\.transportEnabled/,
)
for (const action of [
  'list',
  'create',
  'createJournalClubRun',
  'duplicate',
  'start',
  'close',
  'emergencyStop',
]) {
  assert.match(manageLectures, new RegExp(`['"]${action}['"]`))
}
assert.match(manageLectures, /Google Admin credential is required/)
assert.doesNotMatch(manageLectures, /getAdminTokenClaims|verifyAdminToken/)
assert.equal(
  (manageLectures.match(/\.ok (?:===|!==) true/g) ?? []).length,
  3,
  'Google create, Journal and duplicate must validate RPC results',
)
assert.match(
  manageLectures,
  /const result = requireGoogleAdminRpcResult\(\s*data as \{ ok\?: boolean \} \| null,?\s*\)\s*if \(result(?:\?\.|\.)ok !== true\) \{\s*throw new Error\(\s*'Google Admin lecture transition result is unavailable\.'/,
  'Google lifecycle mutations must reject an invalid session before validating the RPC result',
)
assert.match(
  databaseTypes,
  /manage_google_admin_lectures_v1: \{[\s\S]*target_action: string[\s\S]*target_google_issuer: string[\s\S]*target_provider_subject_hmac: string[\s\S]*target_subject_pepper_version: number[\s\S]*target_transport_enabled: boolean[\s\S]*Returns: Json/,
)
assert.match(
  databaseTypes,
  /manage_google_admin_comments_v1: \{[\s\S]*target_comment_id: string[\s\S]*target_request_id: string[\s\S]*target_transport_enabled: boolean[\s\S]*Returns: Json/,
)
assert.match(
  databaseTypes,
  /manage_google_admin_polls_v1: \{[\s\S]*target_include_history: boolean[\s\S]*target_option_labels: string\[\][\s\S]*target_poll_id: string[\s\S]*target_request_id: string[\s\S]*Returns: Json/,
)
assert.match(
  databaseTypes,
  /manage_google_admin_pdf_documents_v1: \{[\s\S]*target_document_id: string[\s\S]*target_expected_access_version: number[\s\S]*target_manifest_etag: string[\s\S]*target_request_id: string[\s\S]*Returns: Json/,
)
assert.match(
  databaseTypes,
  /issue_google_admin_pdf_access_claims_v1: \{[\s\S]*target_google_issuer: string[\s\S]*target_lecture_session_id: string[\s\S]*target_request_id: string[\s\S]*target_transport_enabled: boolean[\s\S]*Returns: Json/,
)
assert.match(
  databaseTypes,
  /get_google_admin_operations_activation_preflight_v1: \{\s*Args: never\s*Returns: Json\s*\}/,
)
assert.match(
  databaseTypes,
  /get_google_admin_operator_live_snapshot_v1: \{[\s\S]*target_academic_answers_enabled: boolean[\s\S]*target_action: string[\s\S]*target_comment_cursor_created_at: string[\s\S]*target_known_summaries_version: number[\s\S]*target_transport_enabled: boolean[\s\S]*Returns: Json/,
)
assert.match(
  databaseTypes,
  /manage_google_admin_display_state_v1: \{[\s\S]*target_action: string[\s\S]*target_current_pdf_page: number[\s\S]*target_display_mode: string[\s\S]*target_pdf_document_id: string[\s\S]*target_request_id: string[\s\S]*target_transport_enabled: boolean[\s\S]*Returns: Json/,
)
assert.match(
  databaseTypes,
  /get_google_admin_material_analysis_v1: \{[\s\S]*target_auth_user_id: string[\s\S]*target_lecture_session_id: string[\s\S]*target_transport_enabled: boolean[\s\S]*Returns: Json/,
)
assert.match(
  databaseTypes,
  /manage_google_admin_material_analysis_v1: \{[\s\S]*target_action: string[\s\S]*target_analysis_id: string[\s\S]*target_option_labels: string\[\][\s\S]*target_proposal_id: string[\s\S]*target_request_id: string[\s\S]*target_summary_body: Json[\s\S]*Returns: Json/,
)
assert.match(
  databaseTypes,
  /get_google_admin_sessions_v1: \{[\s\S]*target_auth_user_id: string[\s\S]*target_subject_pepper_version: number[\s\S]*target_transport_enabled: boolean[\s\S]*Returns: Json/,
)
assert.match(
  databaseTypes,
  /manage_google_admin_sessions_v1: \{[\s\S]*target_action: string[\s\S]*target_request_id: string[\s\S]*target_session_id: string[\s\S]*target_transport_enabled: boolean[\s\S]*Returns: Json/,
)

const legacyEdges = operationalEdges.filter((edgeName) =>
  /getAdminTokenClaims|verifyAdminToken/.test(
    read(`supabase/functions/${edgeName}/index.ts`),
  ),
)
assert.equal(operationalEdges.length, 19)
assert.equal(legacyEdges.length, 0)
for (const [name, source, rpc] of [
  [
    'manage-admin-sessions',
    manageAdminSessions,
    'manage_google_admin_sessions_v1',
  ],
  ['manage-comments', manageComments, 'manage_google_admin_comments_v1'],
  [
    'update-display-state',
    updateDisplayState,
    'manage_google_admin_display_state_v1',
  ],
  ['manage-lectures', manageLectures, 'manage_google_admin_lectures_v1'],
  [
    'manage-material-analysis',
    manageMaterialAnalysis,
    'manage_google_admin_material_analysis_v1',
  ],
  [
    'manage-pdf-documents',
    managePdfDocuments,
    'manage_google_admin_pdf_documents_v1',
  ],
  ['manage-polls', managePolls, 'manage_google_admin_polls_v1'],
]) {
  assert.match(source, /hasLegacyAdminFields\(body\)/)
  assert.match(source, /appSessionToken/)
  assert.match(source, /verifyGoogleAdminOperationRequest/)
  assert.ok(source.includes(rpc), `${name} must call its C2 facade`)
  assert.match(
    source,
    /target_transport_enabled: (?:googleContext|verification)\.transportEnabled/,
  )
  assert.doesNotMatch(source, /getAdminTokenClaims|verifyAdminToken/)
}
assert.match(manageAdminSessions, /get_google_admin_sessions_v1/)
assert.match(manageAdminSessions, /body\.requestId[\s\S]*requestId is required/)
assert.match(
  manageAdminSessions,
  /body\.action !== 'revoke' && body\.sessionId != null/,
  'Google logout and revoke-all reject an unrelated target session id',
)
assert.doesNotMatch(manageAdminSessions, /trackedAdminSessionsEnabled/)
assert.match(manageComments, /requestId is required/)
assert.match(manageComments, /Comment moderation could not be confirmed/)
assert.match(managePolls, /body\.action !== 'list'[\s\S]*requestId is required/)
assert.match(managePolls, /Google Admin poll operation was not confirmed/)
assert.match(
  managePdfDocuments,
  /body\.action === 'register'[\s\S]*requestId is required/,
)
assert.match(managePdfDocuments, /PDF registration could not be confirmed/)
assert.match(
  managePdfDocuments,
  /target_expected_access_version:[\s\S]*target_manifest_etag:/,
)
assert.match(
  updateDisplayState,
  /!body\.requestId[\s\S]*!UUID_PATTERN\.test\(body\.requestId\)/,
)
assert.match(updateDisplayState, /PRESENTER_SYNC_ACTIVE/)
assert.match(
  updateDisplayState,
  /target_transport_enabled: verification\.transportEnabled/,
)
assert.match(manageMaterialAnalysis, /get_google_admin_material_analysis_v1/)
assert.match(manageMaterialAnalysis, /requestId is required/)
assert.match(
  manageMaterialAnalysis,
  /hasUnexpectedFields[\s\S]*analysisId[\s\S]*reviewState[\s\S]*summaryBody/,
  'Google material actions reject action-incompatible fields before RPC dispatch',
)
assert.doesNotMatch(
  manageMaterialAnalysis.match(
    /manage_google_admin_material_analysis_v1'[\s\S]*?\n\s*\)\n/,
  )?.[0] ?? '',
  /target_proposal_id: body\.proposalId \?\? null|target_analysis_id: body\.analysisId \?\? null/,
  'Google transport never forwards both target identity families',
)
assert.match(
  manageMaterialAnalysis,
  /\['adopt', 'publishSummary'\]\.includes\(body\.action\)[\s\S]*PHASE5_MATERIAL_ANALYSIS_ENABLED/,
  'source feature OFF blocks expansion while list/reject/hide remain available',
)
assert.doesNotMatch(
  manageMaterialAnalysis.slice(
    manageMaterialAnalysis.indexOf('Deno.serve'),
    manageMaterialAnalysis.indexOf('let body:'),
  ),
  /PHASE5_MATERIAL_ANALYSIS_ENABLED/,
  'material feature gating must not block status and cleanup before action parsing',
)
assert.match(
  manageMaterialAnalysis,
  /Google Admin credential is required/,
  'the Google-only endpoint explains its required authority boundary',
)
assert.doesNotMatch(manageMaterialAnalysis, /ADMIN_PIN|BILLING_PIN|API PIN/)
const hideSummaryRepositoryType =
  adminContentAiRepository.match(
    /\| \{\s*action: 'hideSummary'[\s\S]*?\n\s*\},/,
  )?.[0] ?? ''
assert.match(hideSummaryRepositoryType, /analysisId: string/)
assert.doesNotMatch(hideSummaryRepositoryType, /reviewState|summaryBody/)
assert.match(
  materialAnalysisControl,
  /action: 'hideSummary'[\s\S]*analysisId: results\.analysis\.id[\s\S]*lectureSessionId/,
  'hide sends only the analysis target and never resubmits publication content',
)
assert.ok(
  materialAnalysisControl.indexOf("action: 'hideSummary'") <
    materialAnalysisControl.indexOf('const normalized:'),
  'hide remains available before any editable summary-body validation',
)
assert.match(
  adminAiControlPanel,
  /adminToken && activeLectureSessionId[\s\S]*<MaterialAnalysisControl[\s\S]*generationEnabled=\{materialEnabled\}/,
  'feature OFF keeps material status and cleanup UI mounted',
)
assert.match(
  materialAnalysisControl,
  /AI生成は現在停止中です。既存結果の確認・非表示・非採用は引き続き利用できます。/,
)
assert.match(
  materialAnalysisControl,
  /学生画面から非表示にする[\s\S]*非採用/,
  'feature-off UX keeps free hide and reject controls available',
)
assert.match(issuePdfAccessToken, /hasLegacyAdminFields\(body\)/)
assert.match(issuePdfAccessToken, /const hasGoogleCredential/)
assert.match(issuePdfAccessToken, /verifyGoogleAdminOperationRequest/)
assert.match(issuePdfAccessToken, /issue_google_admin_pdf_access_claims_v1/)
assert.match(
  issuePdfAccessToken,
  /target_transport_enabled: verification\.transportEnabled/,
)
assert.match(issuePdfAccessToken, /requestId is required/)
for (const preserved of [/getDisplayTokenClaims/, /get_pdf_access_claims_v1/]) {
  assert.match(issuePdfAccessToken, preserved)
}
assert.doesNotMatch(issuePdfAccessToken, /getDisplayTerminalTokenClaims/)
assert.doesNotMatch(
  issuePdfAccessToken,
  /verify_google_display_terminal_session_v1/,
)
assert.doesNotMatch(issuePdfAccessToken, /admin_get_lecture_operator_access_v1/)
assert.doesNotMatch(
  issuePdfAccessToken,
  /verify_display_realtime_session_v1|verify_display_snapshot_fallback_v1|getAdminTokenClaims|verifyAdminToken/,
)
assert.match(operatorLiveSnapshot, /verifyGoogleAdminOperationRequest/)
assert.match(operatorLiveSnapshot, /get_google_admin_operator_live_snapshot_v1/)
assert.match(
  operatorLiveSnapshot,
  /target_transport_enabled: googleContext\.transportEnabled/,
)
assert.match(
  operatorLiveSnapshot,
  /\[body\.appSessionToken, body\.displayToken\]\.filter\(Boolean\)\.length !== 1/,
)
for (const preserved of [
  /getDisplayTokenClaims/,
  /admin_get_lecture_operator_snapshot_v2/,
]) {
  assert.match(operatorLiveSnapshot, preserved)
}
assert.doesNotMatch(operatorLiveSnapshot, /getDisplayTerminalTokenClaims/)
assert.doesNotMatch(
  operatorLiveSnapshot,
  /verify_google_display_terminal_session_v1/,
)
assert.doesNotMatch(
  operatorLiveSnapshot,
  /admin_get_lecture_operator_access_v1/,
)
assert.doesNotMatch(
  operatorLiveSnapshot,
  /verify_display_realtime_session_v1|verify_display_snapshot_fallback_v1|getAdminTokenClaims|verifyAdminToken/,
)

assert.match(envExample, /^VITE_PHASE7_30_GOOGLE_ADMIN_OPERATIONS=false$/m)
assert.match(envExample, /^PHASE730_GOOGLE_ADMIN_OPERATIONS_ENABLED=false$/m)
assert.match(featureFlags, /isPhase730GoogleAdminOperationsEnabled/)
assert.match(
  featureFlags,
  /VITE_PHASE7_30_GOOGLE_ADMIN_OPERATIONS[\s\S]*=== 'true'/,
)
assert.match(
  adminRoute,
  /adminPathname === '\/admin\/settings'[\s\S]*isPhase730GoogleAdminOperationsEnabled[\s\S]*<AdminWorkspaceApp/,
  'the lecture workspace must stay unmounted while Google operations are disabled',
)
assert.match(
  adminRoute,
  /講義コントロールは現在利用できません/,
  'the operations-off state must fail closed with a concise educator-facing message',
)
assert.equal(
  packageJson.scripts?.['test:phase7-30c2-static'],
  'node scripts/test-phase7-30c2-static.mjs',
)
assert.match(nonlive, /'test:phase7-30c2-static'/)
assert.match(docsTest, /75 non-live/)
assert.match(ciDocs, /75 non-live/)
assert.match(gateDocs, /test:ci:nonlive` \(75 groups\)/)

const googleMasterStatus = functionBlock(
  workspaceMigration,
  'private.get_google_ai_master_status_v1',
)
assert.match(
  googleMasterStatus,
  /admin_ai_unlock_runtime_gate[\s\S]*for share[\s\S]*admin_ai_policies[\s\S]*for share[\s\S]*lecture_sessions[\s\S]*for update/,
  'workspace status preserves gate -> policy -> lecture authority lock order',
)
assert.match(
  googleMasterStatus,
  /expire_ai_master_authorization[\s\S]*pre_c1_master_fenced[\s\S]*pre_c1_master_remediated/,
  'workspace status drains an unconvertible pre-C1 master before readmission',
)
assert.match(
  googleMasterStatus,
  /admission_blocked_reason[\s\S]*admission_enabled[\s\S]*allowed_scopes/,
  'workspace status exposes one authoritative admission decision and supported bundles',
)

const googleAcademicControl = functionBlock(
  workspaceMigration,
  'private.manage_google_admin_academic_results_v1',
)
assert.match(
  googleAcademicControl,
  /target_action = 'cancel'[\s\S]*lecture_ai_control[\s\S]*academic_answer_requests[\s\S]*ai_usage_ledger[\s\S]*finish_lecture_ai_operation/,
  'Google academic cancellation follows lecture -> control -> request -> usage settlement',
)
assert.doesNotMatch(
  googleAcademicControl,
  /admin_cancel_academic_answer_request/,
  'Google academic cancellation is owned by canonical lecture authority, not the historical app-session actor',
)
for (const facade of [
  'get_google_admin_summary_results_v1',
  'manage_google_admin_summary_publication_v1',
  'get_google_admin_academic_results_v1',
  'manage_google_admin_academic_results_v1',
]) {
  assert.match(
    workspaceMigration,
    new RegExp(
      `revoke all on function public\\.${facade}\\([\\s\\S]*from public, anon, authenticated;[\\s\\S]*grant execute on function public\\.${facade}\\([\\s\\S]*to service_role`,
    ),
    `${facade} remains service-role-only`,
  )
  assert.match(
    databaseTypes,
    new RegExp(`${facade}: \\{[\\s\\S]*Returns: Json`),
  )
}

assert.match(
  edgeTransport,
  /GOOGLE_ADMIN_SESSION_INVALID_CODES[\s\S]*response\.clone\(\)\.text\(\)[\s\S]*notifyGoogleAdminSessionInvalid\(credential\.appSessionToken\)/,
  'Google session expiry is dispatched only after reading a bounded structured error code',
)
assert.match(
  edgeTransport,
  /confirmGoogleAdminSessionInvalid[\s\S]*restoreGoogleAdminSession\(appSessionToken\)[\s\S]*GOOGLE_ADMIN_SESSION_INVALID_CODES\.has\(sessionError\.code\)/,
  'generic domain failures confirm the exact application session before forcing logout',
)
assert.match(
  edgeTransport,
  /GOOGLE_REQUEST_ID_FREE_ACTIONS[\s\S]*generate-academic-answer[\s\S]*status[\s\S]*requiresGeneratedRequestId/,
  'read-only Google actions do not acquire mutation idempotency IDs',
)
assert.doesNotMatch(
  edgeTransport,
  /context\.status === 401[\s\S]*notifyGoogleAdminSessionInvalid/,
  'recoverable non-session 401 responses never force a workspace logout',
)
assert.match(
  adminOperationSessionEvents,
  /getSessionSignal\(appSessionToken\)[\s\S]*CustomEvent[\s\S]*event\.detail === signal/,
  'session invalidation events are scoped to the exact app session',
)
assert.match(
  adminRoute,
  /subscribeGoogleAdminSessionInvalid\(appSessionToken[\s\S]*auth\.signOut\(\{ scope: 'local' \}\)[\s\S]*clearGoogleAdminWorkspace/,
  'the workspace subscribes once and returns invalid Google sessions to sign-in',
)
assert.match(
  adminRoute,
  /restoreGoogleAdminSession\(appSessionToken\)[\s\S]*'aal2_required',[\s\S]*'app_session_invalid',[\s\S]*'identity_invalid',[\s\S]*\.includes\(error\.code\)[\s\S]*auth[\s\S]*\.signOut\(\{ scope: 'local' \}\)[\s\S]*clearGoogleAdminWorkspace\([\s\S]*appSessionToken[\s\S]*return/,
  'boot-time identity invalidation must also clear Google Auth before sign-in',
)
assert.match(
  adminRoute,
  /clearGoogleAdminWorkspace[\s\S]*clearAdminAuthStorage\(\)[\s\S]*clearAdminPdfExtractionCache\(\)[\s\S]*setPhase\('signed_out'\)/,
  'session invalidation clears auth, idempotency and private PDF state locally',
)
assert.match(
  adminRoute,
  /forcedSessionInvalidRef\.current = true[\s\S]*async function logout\(\)[\s\S]*finishForcedSessionInvalidation[\s\S]*forcedSessionInvalidRef\.current[\s\S]*if \(finishForcedSessionInvalidation\(\)\) return[\s\S]*hasAdminTotpTransitionRecovery[\s\S]*if \(finishForcedSessionInvalidation\(\)\) return/,
  'a stale child logout callback cannot replace forced sign-out with TOTP recovery',
)
assert.match(
  browserRunner,
  /const googleAdminWorkspaceMode =[\s\S]*'demo-admin-identity'[\s\S]*VITE_PHASE7_30_GOOGLE_ADMIN_OPERATIONS: googleAdminWorkspaceMode[\s\S]*\? 'true'/,
  'the ready-state Admin identity browser profile must enable Google operations explicitly',
)

assert.match(
  aiMasterAuthorizationRepository,
  /error instanceof AdminAiUnlockError[\s\S]*error\.code !== 'request_failed'[\s\S]*completeAdminOperationRequestId/,
  'authoritative PIN denials retire their request ID while ambiguous responses retain it',
)
assert.match(
  aiMasterAuthorizationControl,
  /status\.admissionEnabled[\s\S]*status\.allowedScopes[\s\S]*authorization\?\.status !== 'active'/,
  'AI master UX follows DB admission bundles and lets the same principal stop a prior-session master',
)

for (const [source, label] of [
  [materialAnalysisControl, 'material'],
  [academicAnswerControl, 'academic'],
]) {
  assert.match(
    source,
    /googleProviderAttemptsRef[\s\S]*\.get\(googleAttemptKey\)[\s\S]*\.set\(googleAttemptKey[\s\S]*shouldRetainAdminProviderAttempt[\s\S]*\.delete\(googleAttemptKey\)/,
    `${label} starts retain exact provider IDs only across ambiguous outcomes`,
  )
}
assert.match(
  realtimeCaptionControl,
  /unresolvedGoogleStartRef[\s\S]*manageAiControl\(\{[\s\S]*action: 'status'[\s\S]*findRunningCaptionOperation[\s\S]*重複開始を防ぐ/,
  'Realtime response loss is reconciled through status before any new provider intent',
)

console.log('Phase 7.30C2 static checks passed.')
