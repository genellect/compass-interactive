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
const b2UpgradeFixture = read(
  'scripts/fixtures/phase7-30b2-upgrade-probe.sql',
)
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
  /create function private\.begin_google_admin_owner_control_step_up_v1/,
)
assert.match(
  migration,
  /create function private\.complete_google_admin_owner_control_step_up_v1/,
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
  /complete_google_admin_owner_control_step_up_v1[\s\S]*controlOperationKey/,
)
assert.match(identityApi, /createAdminControlStepUpNonce/)
assert.match(
  identityApi,
  /controlOperationKey\?: AdminLedgerOperationKey[\s\S]*controlStepUpNonce\?: string/,
)
assert.match(ledgerApi, /prepareAdminLedgerMutation/)
assert.match(ledgerApi, /commitAdminLedgerMutation/)
assert.match(ledgerPanel, /phase: 'authorized' \| 'completing' \| 'control' \| 'preparing'/)
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
  /session\.role === 'owner'[\s\S]*AdminLedgerPanel[\s\S]*isPhase730GoogleAdminLedgerAdmissionEnabled/,
)
assert.match(transport, /'manage-admin-ledger', new Set\(\['audit', 'snapshot'\]\)/)
assert.match(
  featureFlags,
  /VITE_PHASE7_30_GOOGLE_ADMIN_LEDGER[\s\S]*=== 'true'/,
)
assert.match(envExample, /^VITE_PHASE7_30_GOOGLE_ADMIN_LEDGER=false$/m)
assert.match(envExample, /^PHASE730_GOOGLE_ADMIN_LEDGER_ENABLED=false$/m)
assert.match(envExample, /^ADMIN_INVITATION_SECRET=$/m)
assert.ok(
  (unifiedPgTap.match(/edge_function <> 'manage-admin-ledger'/g) ?? []).length >=
    3,
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
  /demo-admin-ledger[\s\S]*VITE_PHASE7_30_GOOGLE_ADMIN_OPERATIONS[\s\S]*VITE_PHASE7_30_GOOGLE_ADMIN_LEDGER[\s\S]*VITE_PHASE7_30_LEGACY_ADMIN_PIN/,
)
assert.match(
  browserSpec,
  /ledgerAdmissionEnabled[\s\S]*idempotentReplay[\s\S]*更新結果を再確認/,
)
assert.match(browserSpec, /AxeBuilder/)
assert.match(browserSpec, /scrollWidth/)
assert.match(workflow, /npm run test:e2e:phase7-30d-browser/)

console.log('Phase 7.30D Admin ledger static checks passed.')
