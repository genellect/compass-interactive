import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (path) =>
  readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const migration = read(
  'supabase/migrations/20260812043000_phase7_30d_admin_ledger_authority.sql',
)
const edge = read('supabase/functions/manage-admin-ledger/index.ts')
const identityEdge = read('supabase/functions/admin-identity-session/index.ts')
const identityApi = read('src/lib/adminAuth/adminIdentityApi.ts')
const ledgerApi = read('src/lib/adminAuth/adminLedgerApi.ts')
const ledgerPanel = read('src/components/AdminLedgerPanel.tsx')
const aiUnlockPanel = read('src/components/AdminAiUnlockPanel.tsx')
const aiPolicyPanel = read('src/components/AdminAiPolicyPanel.tsx')
const aiUnlockEdge = read('supabase/functions/admin-ai-unlock/index.ts')
const aiUnlockApi = read('src/lib/adminAuth/adminAiUnlockApi.ts')
const adminRoute = read('src/pages/AdminRoute.tsx')
const adminPage = read('src/pages/AdminPage.tsx')
const adminSettingsPage = read('src/pages/AdminSettingsPage.tsx')
const adminStorage = read('src/lib/adminAuth/adminAuthStorage.ts')
const adminSurfaceNavigation = read(
  'src/lib/adminAuth/adminSurfaceNavigation.ts',
)
const publicHeaders = read('public/_headers')
const ownerCapabilityMigration = read(
  'supabase/migrations/20260817010000_admin_owner_capability_invariant.sql',
)
const ownerCapabilityPgTap = read(
  'supabase/tests/phase7_30g_owner_capability_invariant_test.sql',
)
const aiPolicyManagementMigration = read(
  'supabase/migrations/20260818070000_admin_ai_policy_management_facade.sql',
)
const productionAiProviderEnable = read(
  'scripts/production-ai-provider-enable.sql',
)
const productionAiProviderRollback = read(
  'scripts/production-ai-provider-rollback.sql',
)
const transport = read('src/repositories/supabase/transport.ts')
const featureFlags = read('src/lib/featureFlags.ts')
const databaseTypes = read('src/types/database.ts')
const envExample = read('.env.local.example')
const unifiedPgTap = read(
  'supabase/tests/phase7_30c2_unified_admin_authorization_test.sql',
)
const ledgerPgTap = read(
  'supabase/tests/phase7_30d_admin_ledger_authority_test.sql',
)
const authStorage = read('src/lib/adminAuth/adminAuthStorage.ts')
const concurrency = read('scripts/test-phase7-30d-concurrency.mjs')
const browserSpec = read('e2e/demo/phase7-30d-admin-ledger.spec.ts')
const browserRunner = read('scripts/ci/run-browser-e2e.mjs')
const packageJson = JSON.parse(read('package.json'))
const workflow = read('.github/workflows/ci.yml')
const b2UpgradeFixture = read('scripts/fixtures/phase7-30b2-upgrade-probe.sql')
const b2UpgradeProbe = read(
  'scripts/fixtures/phase7-30b2-upgrade-probe-test.sql',
)
const c2UpgradeProbe = read(
  'scripts/fixtures/phase7-30c2-c1-head-upgrade-probe-test.sql',
)

const operationKeys = [
  'audit',
  'snapshot',
  'issueInvitation',
  'revokeInvitation',
  'promoteOwner',
  'demoteOwner',
  'suspendMembership',
  'reactivateMembership',
  'revokeMembership',
  'enableAi',
  'disableAi',
  'revokeSession',
  'globalRevoke',
]
for (const action of operationKeys) {
  assert.match(migration, new RegExp(`manage-admin-ledger\\.${action}`))
}
assert.equal(
  (migration.match(/'manage-admin-ledger\.[A-Za-z]+'/g) ?? []).filter(
    (value, index, all) => all.indexOf(value) === index,
  ).length,
  13,
  'the owner ledger must have exactly thirteen C2 operation keys',
)
assert.match(
  migration,
  /add column google_admin_ledger_enabled boolean not null default false/,
)
assert.match(
  migration,
  /create table private\.admin_invitation_redemption_receipts[\s\S]*enable row level security/,
)
assert.match(
  migration,
  /admin_invitation_redemption_receipts[\s\S]*reject_admin_c1_evidence_mutation_v1/,
)
assert.match(
  migration,
  /create function private\.enforce_admin_invitation_transition_v1\(\)[\s\S]*acceptance evidence is incomplete[\s\S]*revoker binding is invalid/,
)
assert.match(
  migration,
  /'admin-ledger-environment'[\s\S]*'admin-identity-auth-user'[\s\S]*serialize_admin_ai_request_v1\(target_request_id\)[\s\S]*admin_invitation_redemption_receipts/,
)
assert.match(
  migration,
  /admin_invitation_redemption_receipts[\s\S]*if found then[\s\S]*'idempotent_replay', true[\s\S]*from private\.admin_identity_runtime_gate as gate[\s\S]*for share/,
)
assert.match(
  migration,
  /create function private\.enforce_google_admin_session_issue_gate_v1\(\)[\s\S]*google_session_issue_enabled[\s\S]*for share/,
)
assert.match(
  migration,
  /create trigger admin_sessions_google_issue_gate[\s\S]*before insert or update of authentication_method/,
)
assert.match(
  migration,
  /'factor-membership'[\s\S]*'disableAi', 'suspendMembership', 'revokeMembership', 'globalRevoke'/,
)
assert.match(
  migration,
  /target_action = 'promoteOwner'[\s\S]*environment_row\.environment_kind = 'contest'/,
)
assert.match(
  migration,
  /target_action = 'demoteOwner'[\s\S]*pg_catalog\.isfinite/,
)
assert.match(
  migration,
  /target_totp_amr_method is null[\s\S]*not in \('totp', 'mfa\/totp'\)/,
)
assert.match(
  migration,
  /invitation\.invitation_kind = 'invitation'\s+and gate_row\.google_admin_ledger_enabled is true\s+and invitation\.token_hash = target_invitation_token_hash/,
  'pending D invitations must obey the ledger admission kill switch',
)
assert.match(
  migration,
  /create function private\.begin_google_admin_owner_control_step_up_v1/,
)
assert.match(
  migration,
  /create function private\.complete_google_admin_owner_control_step_up_v1/,
)

const ledgerIntentWorker = migration.slice(
  migration.indexOf(
    'create function private.get_google_admin_ledger_intent_v1',
  ),
  migration.indexOf(
    'revoke all on function private.get_google_admin_ledger_intent_v1',
  ),
)
assert.match(
  ledgerIntentWorker,
  /return jsonb_build_object\(\s*'ok', true,/,
  'the ledger intent response must satisfy the client result contract',
)

const publicFacades = [
  'get_google_admin_ledger_v1',
  'get_google_admin_ledger_audit_v1',
  'get_google_admin_ledger_intent_v1',
  'begin_google_admin_owner_control_step_up_v1',
  'complete_google_admin_owner_control_step_up_v1',
  'manage_google_admin_ledger_v1',
]
for (const facade of publicFacades) {
  assert.match(migration, new RegExp(`create function public\\.${facade}\\(`))
  assert.match(
    migration,
    new RegExp(
      `revoke all on function public\\.${facade}\\([\\s\\S]*?from public, anon, authenticated;`,
    ),
  )
  assert.match(
    migration,
    new RegExp(
      `grant execute on function public\\.${facade}\\([\\s\\S]*?to service_role;`,
    ),
  )
  assert.match(databaseTypes, new RegExp(`${facade}: \\{`))
}

assert.match(edge, /verifyGoogleAdminOperationRequest/)
assert.match(edge, /PHASE730_GOOGLE_ADMIN_LEDGER_ENABLED/)
assert.match(edge, /readSecret\('ADMIN_INVITATION_SECRET'\)/)
assert.match(edge, /deriveAdminInvitationToken/)
assert.match(edge, /EMAIL_PATTERN\.test\(normalizedEmail\)/)
assert.doesNotMatch(
  migration,
  /invitation_token(?!_hash)/,
  'the database migration must never persist the raw invitation token',
)
assert.match(
  identityEdge,
  /begin_google_admin_owner_control_step_up_v1[\s\S]*controlStepUpNonce/,
)
assert.match(
  identityEdge,
  /body\.action === 'beginControlStepUp'[\s\S]*'controlOperationKey'[\s\S]*'controlStepUpNonce'[\s\S]*const ownerLedgerOperationKey = body\.controlOperationKey \?\? null[\s\S]*const suppliedNonce = body\.controlStepUpNonce\?\.trim\(\) \?\? ''[\s\S]*const rawNonce = suppliedNonce \|\| createAdminLoginNonce\(\)/,
  'owner-ledger begin step-up accepts its caller-retained recovery nonce',
)
assert.match(
  identityEdge,
  /const invitationAdmissionEnabled =[\s\S]*PHASE730_GOOGLE_ADMIN_OPERATIONS_ENABLED[\s\S]*PHASE730_GOOGLE_ADMIN_LEDGER_ENABLED[\s\S]*const invitationTokenHash =[\s\S]*invitationToken && invitationAdmissionEnabled/,
  'only both server rollout gates may admit a tokenized D invitation',
)
assert.match(
  identityEdge,
  /body\.invitationToken !== undefined[\s\S]*!ADMIN_INVITATION_TOKEN_PATTERN\.test\(body\.invitationToken\)[\s\S]*'request_invalid'/,
  'the identity Edge must reject malformed invitation tokens before admission',
)
assert.match(
  identityEdge,
  /complete_google_admin_owner_control_step_up_v1[\s\S]*controlOperationKey/,
)
assert.match(identityApi, /createAdminControlStepUpNonce/)
assert.match(
  identityApi,
  /controlOperationKey\?: AdminLedgerOperationKey[\s\S]*controlStepUpNonce\?: string/,
)
assert.match(
  ledgerPanel,
  /if \(currentMembershipChanged \|\| currentSessionRevoked\) \{\s*await onReloginRequired\(\)\s*return\s*\}\s*await refresh\(\)/,
  'self authority changes must relogin before any denied ledger refresh',
)
assert.match(ledgerApi, /prepareAdminLedgerMutation/)
assert.match(ledgerApi, /commitAdminLedgerMutation/)
assert.match(
  ledgerPanel,
  /phase: 'authorized' \| 'completing' \| 'control' \| 'preparing'/,
)
assert.match(ledgerPanel, /新しい教員の招待は停止中です/)
assert.match(
  ledgerPanel,
  /INVITATION_LIFETIME_MS = 48 \* 60 \* 60 \* 1_000[\s\S]*membershipExpiresAt: null[\s\S]*role: 'instructor'/,
  'teacher invitations must use a fixed 48-hour link with no membership expiry',
)
assert.match(
  ledgerPanel,
  /\[inviteCanUseAi, setInviteCanUseAi\] = useState\(false\)/,
  'new teacher invitations must default to least-privilege AI access',
)
assert.match(
  ledgerPanel,
  /className="admin-ledger-add-teacher"[\s\S]*open=\{invitationLink \? true : undefined\}/,
  'a recovered one-time invitation link must be revealed without another hidden step',
)
assert.doesNotMatch(
  ledgerPanel,
  /action: 'promoteOwner'/,
  'the teacher-management UI must not grant full administrator authority',
)
assert.doesNotMatch(
  ledgerPanel,
  /招待リンクの期限|利用期限|Owner解除後の利用期限/,
)
assert.match(
  ledgerPanel,
  /'管理者（全権限付与）'[\s\S]*'教員（AI利用可）'[\s\S]*'教員（AI利用不可）'/,
)
assert.match(
  ledgerPanel,
  /aria-label="運用状況"[\s\S]*有効な教員[\s\S]*ログイン中[\s\S]*進行中の講義[\s\S]*要確認/,
  'teacher management must foreground access, session, lecture, and review status',
)
assert.match(
  ledgerPanel,
  /<section className="admin-ledger-members" aria-label="教員一覧">[\s\S]*className="admin-ledger-add-teacher"/,
  'the teacher permission table must remain the primary surface before invitation controls',
)
assert.match(
  ledgerPanel,
  /reviewEvents[\s\S]*\['denied', 'failed'\][\s\S]*拒否・失敗した操作はありません。/,
  'teacher management must surface denied and failed operations without claiming abuse',
)
assert.match(
  ledgerPanel,
  /supabaseAdminRepository\.manageLectures\(\{[\s\S]*action: 'emergencyStop'[\s\S]*講義を停止/,
  'owner teacher management must retain an explicit emergency lecture stop',
)
assert.match(
  browserSpec,
  /membershipId: instructorMembershipId[\s\S]*body\.action === 'emergencyStop'[\s\S]*body\.lectureSessionId === lectureSessionId[\s\S]*toHaveLength\(1\)/,
  'the browser contract must prove an Owner uses emergencyStop for another instructor owned lecture',
)
assert.match(
  ledgerPanel,
  /action: 'list'[\s\S]*\.catch\(\(\) => \[\]\)[\s\S]*lectureTitlesById[\s\S]*講義 \$\{ownership\.lectureSessionId\.slice\(0, 8\)\}/,
  'lecture monitoring must show readable titles without coupling teacher access management to lecture-list availability',
)
assert.match(
  aiUnlockPanel,
  /<summary id="admin-ai-unlock-title">AI PINの設定<\/summary>/,
)
assert.doesNotMatch(
  aiUnlockPanel,
  /PERSONAL AI CONTROL|通常の講義中に認証アプリを繰り返し要求しません/,
)
assert.match(ledgerPanel, /persistPendingMutation/)
assert.match(ledgerPanel, /restorePendingMutation/)
assert.match(
  ledgerPanel,
  /membershipExpiresAt: null[\s\S]*role: 'instructor'/,
  'all UI invitations must remain instructor-only in every environment',
)
assert.match(
  authStorage,
  /ADMIN_LEDGER_PENDING_STORAGE_KEY[\s\S]*removeItem\(ADMIN_LEDGER_PENDING_STORAGE_KEY\)/,
)
assert.match(
  adminRoute,
  /session\?\.role === 'owner'[\s\S]*AdminLedgerPanel[\s\S]*isPhase730GoogleAdminLedgerAdmissionEnabled/,
)
assert.match(
  adminRoute,
  /\['\/admin', '\/admin\/settings'\]\.includes\(adminPathname\)/,
)
assert.match(
  adminRoute,
  /adminPathname === '\/admin\/settings'[\s\S]*AdminSettingsPage[\s\S]*ledger=\{ownerLedger\}/,
)
assert.match(
  adminPage,
  /href="\/admin\/settings"[\s\S]*rel="noopener noreferrer"[\s\S]*target="_blank"[\s\S]*教員管理/,
)
assert.match(
  adminPage,
  /href="\/admin\/settings"[\s\S]*event\.preventDefault\(\)[\s\S]*openAdminSurface\('\/admin\/settings'\)/,
)
assert.doesNotMatch(
  adminPage,
  /AdminLedgerPanel|AdminSessionPanel|セッション管理/,
)
assert.match(
  adminSettingsPage,
  /pageTitle = ledger \? '教員管理' : 'AI PINの設定'[\s\S]*<h1>\{pageTitle\}<\/h1>/,
)
assert.doesNotMatch(
  adminSettingsPage,
  /メンバー、権限、ログイン状態を管理します。|個人設定/,
)
assert.match(
  adminSettingsPage,
  /href="\/admin"[\s\S]*rel="noopener noreferrer"[\s\S]*target="_blank"[\s\S]*講義コントロール/,
)
assert.match(
  adminSettingsPage,
  /href="\/admin"[\s\S]*event\.preventDefault\(\)[\s\S]*openAdminSurface\('\/admin'\)/,
)
assert.match(
  adminSurfaceNavigation,
  /'\/admin': 'compass-admin-workspace'[\s\S]*'\/admin\/settings': 'compass-admin-settings'/,
)
assert.match(
  adminSurfaceNavigation,
  /targetUrl = new URL\(pathname, window\.location\.origin\)\.href[\s\S]*window\.open\('', ADMIN_SURFACE_WINDOW_NAMES\[pathname\]\)[\s\S]*window\.location\.assign\(targetUrl\)[\s\S]*sessionChanged = handoffAdminAppSessionToken\(opened\)\.changed[\s\S]*sessionChanged \|\| !isCurrentAdminSurface\(opened, pathname\)[\s\S]*opened\.location\.replace\(targetUrl\)[\s\S]*opened\.focus\(\)/,
)
assert.match(
  adminSurfaceNavigation,
  /target\.location\.origin === window\.location\.origin[\s\S]*currentPathname === pathname/,
)
assert.match(publicHeaders, /^\s*Cross-Origin-Opener-Policy: same-origin\s*$/m)
assert.match(
  adminStorage,
  /handoffAdminAppSessionToken\(target: Window\)[\s\S]*restoreAdminAppSessionToken\(\)[\s\S]*previousToken = target\.sessionStorage\.getItem\([\s\S]*ADMIN_APP_SESSION_STORAGE_KEY[\s\S]*target\.sessionStorage\.setItem\(ADMIN_APP_SESSION_STORAGE_KEY, token\)[\s\S]*changed: previousToken !== token/,
)
assert.match(adminRoute, /claimAdminSurfaceWindow\(adminPathname\)/)
assert.match(
  adminRoute,
  /onAuthStateChange\(\(event\) => \{[\s\S]*event !== 'SIGNED_OUT'[\s\S]*clearGoogleAdminWorkspace/,
)
assert.match(
  adminStorage,
  /ADMIN_RETURN_PATHS = new Set\(\['\/admin', '\/admin\/settings'\]\)[\s\S]*returnPath: safeReturnPath/,
)
assert.match(
  ownerCapabilityMigration,
  /update private\.admin_environment_memberships[\s\S]*role = 'owner'[\s\S]*status <> 'revoked'[\s\S]*not can_use_ai/,
)
assert.match(
  ownerCapabilityMigration,
  /create trigger admin_memberships_owner_capability_normalizer[\s\S]*before update of role, status, can_use_ai/,
)
assert.match(
  ownerCapabilityMigration,
  /create constraint trigger admin_memberships_owner_capability_guard[\s\S]*deferrable initially deferred/,
)
assert.match(
  ownerCapabilityMigration,
  /create function private\.enforce_admin_owner_capability_v1\(\)[\s\S]*language plpgsql[\s\S]*volatile[\s\S]*where membership\.environment_id = new\.environment_id[\s\S]*membership\.principal_id = new\.principal_id/,
)
assert.match(
  ownerCapabilityMigration,
  /create trigger admin_invitations_apply_owner_capability[\s\S]*when \(old\.status = 'pending' and new\.status = 'accepted'\)/,
)
assert.doesNotMatch(
  ownerCapabilityMigration,
  /update private\.(?:admin_identity_runtime_gate|admin_ai_unlock_runtime_gate)/,
)
assert.match(
  ownerCapabilityPgTap,
  /a direct Owner insert cannot commit without the complete capability set[\s\S]*changing only the membership ID cannot bypass the deferred Owner guard[\s\S]*promotion to Owner atomically grants the complete capability set[\s\S]*an existing Owner capability cannot be disabled[\s\S]*accepting an Owner invitation normalizes legacy false capability intent[\s\S]*does not weaken the last-active-Owner guard[\s\S]*does not activate identity or paid AI gates/,
)
assert.match(
  ownerCapabilityPgTap,
  /SET CONSTRAINTS private\.admin_memberships_owner_capability_guard IMMEDIATE[\s\S]*SET CONSTRAINTS private\.admin_memberships_owner_capability_guard DEFERRED/,
)
assert.match(
  ownerCapabilityPgTap,
  /current_deployment, bootstrap_sealed_at[\s\S]*statement_timestamp\(\) - interval '1 hour'[\s\S]*SET owner_invariant_enforced_at = statement_timestamp\(\)/,
)
assert.match(
  ownerCapabilityPgTap,
  /normalize_admin_owner_capability_v1\(\)[\s\S]*apply_accepted_owner_capability_v1\(\)[\s\S]*enforce_admin_owner_capability_v1\(\)[\s\S]*not callable by application roles/,
)
assert.match(ledgerPanel, /canUseAi: inviteCanUseAi[\s\S]*role: 'instructor'/)
assert.match(
  ledgerPanel,
  /membership\.role === 'owner'[\s\S]*'管理者（全権限付与）'/,
)
assert.match(
  ledgerPanel,
  /membership\.role === 'instructor'[\s\S]*membership\.canUseAi[\s\S]*AI利用を停止/,
)
assert.match(
  transport,
  /'manage-admin-ledger', new Set\(\['audit', 'snapshot'\]\)/,
)
assert.match(
  featureFlags,
  /VITE_PHASE7_30_GOOGLE_ADMIN_LEDGER[\s\S]*=== 'true'/,
)
assert.match(envExample, /^VITE_PHASE7_30_GOOGLE_ADMIN_LEDGER=false$/m)
assert.match(envExample, /^PHASE730_GOOGLE_ADMIN_LEDGER_ENABLED=false$/m)
assert.match(envExample, /^ADMIN_INVITATION_SECRET=$/m)
assert.ok(
  (unifiedPgTap.match(/edge_function <> 'manage-admin-ledger'/g) ?? [])
    .length >= 3,
  'pre-D exact C2 inventory assertions must deliberately exclude the D slice',
)
assert.match(
  ledgerPgTap,
  /existing Google principal joins the current environment/,
)
assert.match(
  ledgerPgTap,
  /suspension drains the target session and persistent AI authority atomically/,
)
assert.equal(
  packageJson.scripts['test:phase7-30d-concurrency'],
  'node scripts/test-phase7-30d-concurrency.mjs',
)
assert.match(
  concurrency,
  /'admin-ledger-environment'[\s\S]*cross-demote-b[\s\S]*P7310/,
)
assert.match(
  concurrency,
  /invitation-accept[\s\S]*invitation-revoke[\s\S]*P7335[\s\S]*idempotent_replay/,
)
assert.match(
  workflow,
  /test:phase7-29-upgrade[\s\S]*test:phase7-30d-concurrency[\s\S]*test:phase7-30-upgrade/,
)
assert.match(b2UpgradeFixture, /'bootstrap'[\s\S]*'revoked'[\s\S]*'expired'/)
assert.match(
  b2UpgradeProbe,
  /D does not fabricate redemption receipts[\s\S]*google_admin_ledger_enabled IS FALSE/,
)
assert.match(c2UpgradeProbe, /edge_function <> 'manage-admin-ledger'/)
assert.equal(
  packageJson.scripts['test:e2e:phase7-30d-browser'],
  'node scripts/ci/run-browser-e2e.mjs demo-admin-ledger --project=desktop-chromium --project=mobile-webkit --retries=0',
)
assert.match(
  browserRunner,
  /demo-admin-ledger[\s\S]*VITE_PHASE7_30_GOOGLE_ADMIN_OPERATIONS[\s\S]*VITE_PHASE7_30_GOOGLE_ADMIN_LEDGER/,
)
assert.doesNotMatch(browserRunner, /VITE_PHASE7_30_LEGACY_ADMIN_PIN/)
assert.match(
  browserSpec,
  /ledgerAdmissionEnabled[\s\S]*idempotentReplay[\s\S]*更新結果を再確認/,
)
assert.match(browserSpec, /AxeBuilder/)
assert.match(browserSpec, /scrollWidth/)
assert.match(workflow, /npm run test:e2e:phase7-30d-browser/)

for (const facade of [
  'prepare_admin_ai_policy_change_v1',
  'get_admin_ai_policy_status_v1',
]) {
  assert.match(
    aiPolicyManagementMigration,
    new RegExp(`create function public\\.${facade}\\(`),
  )
  assert.match(
    aiPolicyManagementMigration,
    new RegExp(
      `revoke all on function public\\.${facade}\\([\\s\\S]*?from public, anon, authenticated, service_role;`,
    ),
  )
  assert.match(
    aiPolicyManagementMigration,
    new RegExp(
      `grant execute on function public\\.${facade}\\([\\s\\S]*?to service_role;`,
    ),
  )
}
assert.match(
  aiPolicyManagementMigration,
  /prepare_admin_ai_policy_change_v1[\s\S]*require_admin_ai_context_v1[\s\S]*membership\.environment_id = \(context_value ->> 'environment_id'\)::uuid[\s\S]*membership\.status = 'active'[\s\S]*membership\.can_use_ai/,
  'policy preparation must stay Owner-context-bound and target only an active AI-capable membership in the same environment',
)
assert.match(
  aiPolicyManagementMigration,
  /admin_ai_policy_control_intent_digest_v1[\s\S]*'control_action', 'environment_ai_policy_change'[\s\S]*'request_id', target_request_id[\s\S]*'target_membership_id', target_membership_id/,
  'policy preparation must bind the canonical preset, target and request to the existing TOTP control intent',
)
assert.match(
  aiPolicyManagementMigration,
  /create function private\.admin_ai_policy_matches_production_preset_v1[\s\S]*target_valid_until = target_valid_from \+ interval '30 days'[\s\S]*target_max_calls_per_lecture = 24[\s\S]*target_max_calls_per_day = 96[\s\S]*target_max_input_tokens_per_lecture = 200000[\s\S]*target_max_input_tokens_per_day = 800000[\s\S]*target_max_output_tokens_per_lecture = 40000[\s\S]*target_max_output_tokens_per_day = 160000[\s\S]*target_max_cost_microusd_per_lecture between 10000 and 5000000[\s\S]*target_max_cost_microusd_per_day between target_max_cost_microusd_per_lecture and 20000000[\s\S]*target_max_realtime_minutes_per_lecture = 90[\s\S]*target_max_realtime_minutes_per_day = 180[\s\S]*target_max_concurrency = 2/,
  'the database-owned Production predicate must pin the complete bounded policy preset',
)
assert.match(
  aiPolicyManagementMigration,
  /prepare_admin_ai_policy_change_v1[\s\S]*admin_ai_policy_matches_production_preset_v1[\s\S]*get_admin_ai_policy_status_v1[\s\S]*admin_ai_policy_matches_production_preset_v1[\s\S]*canonical_policy_topology_complete/,
  'preparation and coverage must share the canonical database predicate',
)

for (const gateTable of [
  'admin_identity_runtime_gate',
  'admin_ai_unlock_runtime_gate',
]) {
  assert.match(
    productionAiProviderEnable,
    new RegExp(
      `from private\\.${gateTable} as gate[\\s\\S]*?where gate\\.singleton[\\s\\S]*?for update;`,
    ),
    `production activation must lock the singleton ${gateTable} row`,
  )
}
assert.match(
  productionAiProviderRollback,
  /from private\.admin_ai_unlock_runtime_gate as gate[\s\S]*where gate\.singleton[\s\S]*for update;/,
  'production rollback must lock the singleton AI gate row',
)
for (const requiredGate of [
  'google_session_issue_enabled',
  'google_operational_authorization_enabled',
  'google_admin_ledger_enabled',
  'ai_unlock_enabled',
]) {
  assert.match(productionAiProviderEnable, new RegExp(requiredGate))
}
assert.match(
  productionAiProviderEnable,
  /membership\.role = 'owner'[\s\S]*membership\.can_use_ai[\s\S]*active_owner_count <> 2 or ai_owner_count <> 2/,
  'activation requires exactly two current AI-enabled Owners',
)
assert.match(
  productionAiProviderEnable,
  /eligible_membership_count[\s\S]*membership\.status = 'active'[\s\S]*membership\.can_use_ai[\s\S]*covered_membership_count[\s\S]*admin_ai_policy_matches_production_preset_v1[\s\S]*covered_membership_count <> eligible_membership_count/,
  'activation must use the same canonical database predicate for every current AI-enabled membership',
)
for (const idleInvariant of [
  /public\.lecture_sessions as lecture where lecture\.status = 'open'/,
  /public\.lecture_ai_master_authorizations as master[\s\S]*master\.status = 'active'/,
  /public\.ai_billing_grants as grant_row[\s\S]*grant_row\.status = 'issued'/,
  /public\.ai_usage_ledger as usage where usage\.status = 'running'/,
  /private\.admin_google_ai_provider_start_intents as intent[\s\S]*left join private\.admin_google_ai_provider_start_receipts[\s\S]*receipt\.start_request_id is null/,
  /public\.lecture_summary_runs as run[\s\S]*run\.status = 'running'/,
  /public\.lecture_summary_windows as window_row[\s\S]*window_row\.status in \('pending', 'running'\)/,
  /public\.academic_answer_requests as request_row[\s\S]*request_row\.status in \('evidence_checking', 'running'\)/,
]) {
  assert.match(productionAiProviderEnable, idleInvariant)
}
assert.equal(
  productionAiProviderEnable.match(/\bupdate private\./gi)?.length,
  2,
  'activation may update only the two admission bits',
)
assert.match(
  productionAiProviderEnable,
  /update private\.admin_ai_unlock_runtime_gate[\s\S]*google_ai_master_admission_enabled = true[\s\S]*update private\.admin_ai_unlock_runtime_gate[\s\S]*google_ai_child_grant_enabled = true/,
  'activation enables master admission before child grants',
)
assert.equal(
  productionAiProviderRollback.match(/\bupdate private\./gi)?.length,
  2,
  'rollback may update only the two admission bits',
)
assert.match(
  productionAiProviderRollback,
  /update private\.admin_ai_unlock_runtime_gate[\s\S]*google_ai_child_grant_enabled = false[\s\S]*update private\.admin_ai_unlock_runtime_gate[\s\S]*google_ai_master_admission_enabled = false/,
  'rollback disables child grants before master admission',
)

assert.match(
  aiUnlockEdge,
  /policyStatus: new Set\(\['action', 'appSessionToken'\]\)/,
)
assert.match(
  browserSpec,
  /failFirstPolicySet: true[\s\S]*loseFirstPolicyCompletionResponse: true[\s\S]*policyCompleteAttempts[\s\S]*toBe\(1\)/,
  'browser recovery must prove one committed TOTP completion survives a lost response and a later policy response failure',
)
assert.match(
  read('src/components/AdminAiPolicyPanel.tsx'),
  /recoverCompleting[\s\S]*commitPolicy\(\{ \.\.\.attempt, phase: 'authorized' \}\)[\s\S]*error\.code !== 'control_proof_required'[\s\S]*completeControl\(attempt\)/,
  'a completing mutation must consume an existing exact grant before attempting TOTP completion again',
)
for (const action of ['preparePolicyMutation', 'setPolicy']) {
  assert.match(
    aiUnlockEdge,
    new RegExp(
      `${action}: new Set\\(\\[[\\s\\S]*?'action'[\\s\\S]*?'appSessionToken'[\\s\\S]*?'maxCostMicrousdPerDay'[\\s\\S]*?'maxCostMicrousdPerLecture'[\\s\\S]*?'requestId'[\\s\\S]*?'targetMembershipId'[\\s\\S]*?'validFrom'[\\s\\S]*?'validUntil'[\\s\\S]*?\\]\\)`,
    ),
  )
}
assert.match(
  aiUnlockEdge,
  /if \(action === 'policyStatus'\)[\s\S]*context!\.role !== 'owner'[\s\S]*get_admin_ai_policy_status_v1/,
)
assert.match(
  aiUnlockEdge,
  /action === 'preparePolicyMutation' \|\| action === 'setPolicy'[\s\S]*context!\.role !== 'owner'[\s\S]*getAiPolicyMutationInput\(body\)/,
)
assert.match(
  aiUnlockEdge,
  /prepare_admin_ai_policy_change_v1[\s\S]*control_action !== 'environment_ai_policy_change'[\s\S]*set_admin_ai_policy_v1[\s\S]*value\.status !== 'active'/,
)

const policyActions = [
  'academic_answers',
  'captions',
  'material_analysis',
  'poll_suggestions',
  'summaries',
]
const policyModels = ['gpt-5.6-luna', 'gpt-realtime-whisper']
for (const source of [aiUnlockEdge, aiUnlockApi]) {
  for (const action of policyActions) assert.match(source, new RegExp(action))
  for (const model of policyModels) assert.match(source, new RegExp(model))
  for (const [name, value] of [
    ['maxCallsPerLecture', '24'],
    ['maxCallsPerDay', '96'],
    ['maxInputTokensPerLecture', '200_000'],
    ['maxInputTokensPerDay', '800_000'],
    ['maxOutputTokensPerLecture', '40_000'],
    ['maxOutputTokensPerDay', '160_000'],
    ['maxRealtimeMinutesPerLecture', '90'],
    ['maxRealtimeMinutesPerDay', '180'],
    ['maxConcurrency', '2'],
  ]) {
    assert.match(source, new RegExp(`${name}: ${value}`))
  }
}
assert.match(
  aiUnlockEdge,
  /validUntilMs - validFromMs !== ADMIN_AI_POLICY_VALIDITY_MS/,
)
assert.match(
  aiUnlockApi,
  /createAdminAiPolicyMutationRequest[\s\S]*validFromMs = now - 60_000[\s\S]*validFromMs \+ ADMIN_AI_POLICY_VALIDITY_MS/,
)
assert.match(
  aiUnlockApi,
  /getAdminAiPolicyStatus[\s\S]*action: 'policyStatus'[\s\S]*activeAiMembershipCount[\s\S]*canonicalPolicyTopologyComplete[\s\S]*coveredMembershipCount[\s\S]*topologyComplete/,
)
assert.match(
  aiUnlockApi,
  /prepareAdminAiPolicyMutation[\s\S]*action: 'preparePolicyMutation'[\s\S]*controlAction: 'environment_ai_policy_change'/,
)
assert.match(
  aiUnlockApi,
  /setAdminAiPolicy[\s\S]*action: 'setPolicy'[\s\S]*data\.status !== 'active'/,
)

assert.match(aiPolicyPanel, /<summary[^>]*>講義AIの利用設定<\/summary>/)
for (const label of [
  '対象の教員',
  '講義ごとの上限（USD）',
  '1日ごとの上限（USD）',
  '確認に使う認証アプリ',
  '6桁コード',
  'この設定で利用を許可',
  '認証アプリで確認',
  '同じ内容で再試行',
  '保留中の設定を取り消す',
]) {
  assert.match(aiPolicyPanel, new RegExp(label))
}
assert.match(aiPolicyPanel, /0\.50[\s\S]*2\.00/)
for (const clientCall of [
  'getAdminAiPolicyStatus',
  'prepareAdminAiPolicyMutation',
  'beginAdminControlStepUp',
  'challengeAndVerify',
  'completeAdminControlStepUp',
  'setAdminAiPolicy',
]) {
  assert.match(aiPolicyPanel, new RegExp(clientCall))
}
for (const statusField of [
  'activeAiMembershipCount',
  'canonicalPolicyTopologyComplete',
  'coveredMembershipCount',
  'topologyComplete',
]) {
  assert.match(aiPolicyPanel, new RegExp(statusField))
}
assert.match(
  aiPolicyPanel,
  /ADMIN_AI_POLICY_PRESET\.allowedModels[\s\S]*maxCallsPerLecture[\s\S]*maxCallsPerDay[\s\S]*maxInputTokensPerLecture[\s\S]*maxOutputTokensPerLecture[\s\S]*maxRealtimeMinutesPerLecture[\s\S]*maxConcurrency[\s\S]*validityDays/,
  'the browser may describe, but cannot choose, the server-owned action/model preset',
)
assert.match(
  adminRoute,
  /session\?\.role === 'owner'[\s\S]*AdminLedgerPanel/,
  'only an Owner receives the Admin ledger that owns environment policy controls',
)
assert.match(
  ledgerPanel,
  /AdminAiPolicyPanel[\s\S]*appSessionToken=\{appSessionToken\}[\s\S]*factors=\{factors\}[\s\S]*memberships=\{snapshot\.memberships\}/,
  'the Owner ledger supplies only server-derived active membership and factor inputs to policy settings',
)
for (const browserInvariant of [
  '講義AIの利用設定',
  'preparePolicyMutation',
  'environment_ai_policy_change',
  'setPolicy',
  '同じ内容で再試行',
  "role: 'instructor'",
  'toHaveCount(0)',
]) {
  assert.match(
    browserSpec,
    new RegExp(browserInvariant.replace(/[()]/g, '\\$&')),
  )
}

console.log('Phase 7.30D Admin ledger static checks passed.')
