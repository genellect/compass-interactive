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
  /body\.action === 'beginControlStepUp'[\s\S]*body\.controlOperationKey === undefined[\s\S]*\['controlStepUpNonce'\]/,
  'owner-ledger begin step-up accepts its caller-retained recovery nonce',
)
assert.match(
  identityEdge,
  /const invitationAdmissionEnabled =[\s\S]*PHASE730_GOOGLE_ADMIN_OPERATIONS_ENABLED[\s\S]*PHASE730_GOOGLE_ADMIN_LEDGER_ENABLED[\s\S]*const invitationTokenHash = invitationToken && invitationAdmissionEnabled/,
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
assert.match(ledgerPanel, /新しい招待・権限追加は停止中です/)
assert.match(ledgerPanel, /persistPendingMutation/)
assert.match(ledgerPanel, /restorePendingMutation/)
assert.match(ledgerPanel, /snapshot\.environmentKind === 'contest'/)
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
  /href="\/admin\/settings"[\s\S]*rel="noopener noreferrer"[\s\S]*target="_blank"[\s\S]*管理者設定/,
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
  /<h1>管理者設定<\/h1>[\s\S]*メンバー、権限、ログイン状態を管理します。/,
)
assert.match(
  adminSettingsPage,
  /href="\/admin"[\s\S]*rel="noopener noreferrer"[\s\S]*target="_blank"[\s\S]*講義画面を開く/,
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
assert.match(
  ledgerPanel,
  /canUseAi: inviteRole === 'owner' \|\| inviteCanUseAi/,
)
assert.match(ledgerPanel, /membership\.role === 'owner'[\s\S]*全機能利用可/)
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

console.log('Phase 7.30D Admin ledger static checks passed.')
