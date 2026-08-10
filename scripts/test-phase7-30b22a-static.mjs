import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const read = (path) => readFileSync(join(root, path), 'utf8')

const migration = read(
  'supabase/migrations/20260809231342_phase7_30b22a_admin_control_hardening.sql',
)
const b1 = read(
  'supabase/migrations/20260809143000_phase7_30b1_admin_identity_aal2.sql',
)
const b2 = read(
  'supabase/migrations/20260809155129_phase7_30b2_admin_ai_unlock_foundation.sql',
)
const edge = read('supabase/functions/admin-identity-session/index.ts')
const client = read('src/lib/adminAuth/adminIdentityApi.ts')
const databaseTypes = read('src/types/database.ts')
const localEdge = read('scripts/test-phase7-30b1-local-edge.mjs')
const concurrency = read('scripts/test-phase7-30b2-concurrency.mjs')
const adminIdentityE2e = read('e2e/demo/phase7-30-admin-identity.spec.ts')
const pgTap = read(
  'supabase/tests/phase7_30b22a_admin_control_hardening_test.sql',
)
const b1PgTap = read('supabase/tests/phase7_30b1_admin_identity_test.sql')
const b2PgTap = read(
  'supabase/tests/phase7_30b2_admin_ai_unlock_foundation_test.sql',
)
const packageJson = JSON.parse(read('package.json'))
const nonLiveSuite = read('scripts/ci/run-nonlive-suite.mjs')
const upgradeRunner = read('scripts/test-phase7-30-upgrade.mjs')
const b2HeadUpgradeFixture = read(
  'scripts/fixtures/phase7-30b22a-b2-head-upgrade-probe.sql',
)
const b2HeadUpgradeTest = read(
  'scripts/fixtures/phase7-30b22a-b2-head-upgrade-probe-test.sql',
)
const b1ToB22aUpgradeTest = read(
  'scripts/fixtures/phase7-30b2-upgrade-probe-test.sql',
)
const phase730UpgradeTest = read(
  'scripts/fixtures/phase7-30-upgrade-probe-test.sql',
)

assert.match(b1, /google_session_issue_enabled boolean not null default false/)
assert.match(b2, /ai_unlock_enabled boolean not null default false/)
assert.match(b2, /remembered_browser_enabled boolean not null default false/)
assert.doesNotMatch(migration, /create extension|pg_cron|net\.http|vault\./i)
assert.doesNotMatch(
  migration,
  /\bas grant\b|\bgrant\.\*|\bgrant\./,
  'reserved GRANT must never be reused as a table alias',
)
assert.match(
  migration,
  /from private\.admin_control_step_up_grants as control_grant/,
)
assert.match(
  migration,
  /operator_totp_factor_set_adoption_enabled boolean not null\s+default false/,
)
for (const column of [
  'approved_totp_factor_set_hash',
  'approved_totp_factor_set_version',
  'approved_totp_factor_count',
  'approved_totp_factor_set_request_id',
  'approved_totp_factor_set_source',
]) {
  assert.match(migration, new RegExp(`add column ${column}\\b`))
}
const preLoginBeginMigration = migration.slice(
  0,
  migration.indexOf('create function private.begin_admin_totp_step_up_v2'),
)
assert.doesNotMatch(
  preLoginBeginMigration,
  /update private\.admin_principals[\s\S]*?approved_totp_factor_set_hash\s*=/,
  'migration must not infer an approved principal anchor from existing factors',
)

for (const table of [
  'admin_control_step_up_nonces',
  'admin_control_step_up_grants',
]) {
  assert.match(migration, new RegExp(`create table private\\.${table}\\b`))
  assert.match(
    migration,
    new RegExp(`alter table private\\.${table} enable row level security;`),
  )
  assert.match(
    migration,
    new RegExp(
      `revoke all on private\\.${table}[\\s\\S]*?from public, anon, authenticated, service_role;`,
    ),
  )
}

for (const binding of [
  'admin_session_id',
  'intent_digest',
  'intended_action',
  'mutation_request_id',
  'prechallenge_jwt_hash',
  'supabase_auth_session_id',
  'verified_totp_factor_set_hash',
]) {
  assert.match(migration, new RegExp(`\\b${binding}\\b`))
}
assert.match(migration, /expires_at <= issued_at \+ interval '5 minutes'/)
assert.match(
  migration,
  /expires_at <= verified_totp_amr_at \+ interval '5 minutes'/,
)
assert.match(migration, /status in \('available', 'consumed', 'superseded', 'expired'\)/)
assert.match(migration, /where status = 'available'/)
assert.match(migration, /compass:phase7\.30:admin-control-intent:v1\|/)
for (const helper of [
  'admin_ai_pin_control_intent_digest_v1',
  'admin_ai_pin_terminal_control_intent_digest_v1',
  'admin_ai_policy_control_intent_digest_v1',
]) {
  assert.match(migration, new RegExp(`create function private\\.${helper}\\(`))
  assert.match(
    migration,
    new RegExp(
      `revoke all on function private\\.${helper}\\([\\s\\S]*?from public, anon, authenticated, service_role;`,
    ),
  )
  assert.doesNotMatch(
    migration,
    new RegExp(`grant execute on function private\\.${helper}\\(`),
  )
}
assert.match(
  migration,
  /grant_row\.intent_digest <> target_intent_digest/,
  'grant consumption must compare the DB-recomputed mutation intent',
)
assert.match(
  migration,
  /create function private\.begin_admin_control_step_up_v1\(\s*target_token_hash text,\s*target_auth_user_id uuid,\s*target_supabase_auth_session_id uuid,\s*target_action text,\s*target_mutation_request_id uuid,\s*target_nonce_hash text,\s*target_prechallenge_jwt_hash text,\s*target_intent_digest text default null/,
)
for (const scope of ['private', 'public']) {
  assert.match(
    migration,
    new RegExp(
      `(?:revoke all|grant execute) on function ${scope}\\.begin_admin_control_step_up_v1\\(\\s*text, uuid, uuid, text, uuid, text, text, text`,
    ),
  )
}
assert.match(
  migration,
  /private\.admin_ai_pin_control_intent_digest_v1\([\s\S]*?private\.consume_admin_control_step_up_grant_v1\(/,
)
assert.match(
  migration,
  /private\.admin_ai_policy_control_intent_digest_v1\([\s\S]*?private\.consume_admin_control_step_up_grant_v1\(/,
)
assert.match(
  migration,
  /private\.admin_ai_pin_terminal_control_intent_digest_v1\([\s\S]*?private\.consume_admin_control_step_up_grant_v1\(/,
)

assert.match(
  migration,
  /compass:phase7\.30:verified-totp-factor-set:v1\|user=/,
)
assert.match(migration, /string_agg\([\s\S]*?order by factor\.id::text/)
assert.match(migration, /factor\.factor_type = 'totp'/)
assert.match(migration, /factor\.status = 'verified'/)
const factorSetSnapshot = migration.match(
  /create function private\.current_verified_totp_factor_set_snapshot_v1\([\s\S]*?\n\$\$;/,
)?.[0]
assert.ok(factorSetSnapshot)
assert.match(
  factorSetSnapshot,
  /returns table \(\s*factor_set_hash text,\s*factor_count integer\s*\)/,
)
assert.equal(
  [...factorSetSnapshot.matchAll(/from auth\.mfa_factors as factor/g)].length,
  1,
  'factor-set hash and count must come from one aggregate scan',
)
assert.match(factorSetSnapshot, /end as factor_set_hash,\s*count\(\*\)::integer as factor_count/)
assert.match(
  migration,
  /revoke all on function private\.current_verified_totp_factor_set_snapshot_v1\(uuid\)\s+from public, anon, authenticated, service_role;/,
)
assert.doesNotMatch(
  migration,
  /grant execute on function private\.current_verified_totp_factor_set_snapshot_v1\(/,
)
for (const scalarHelper of [
  'current_verified_totp_factor_set_hash_v1',
  'current_verified_totp_factor_count_v1',
]) {
  const definition = migration.match(
    new RegExp(`create function private\\.${scalarHelper}\\([\\s\\S]*?\\n\\$\\$;`),
  )?.[0]
  assert.ok(definition)
  assert.match(definition, /current_verified_totp_factor_set_snapshot_v1\(/)
  assert.doesNotMatch(definition, /from auth\.mfa_factors/)
}
assert.doesNotMatch(migration, /chr\(0\)/)
assert.match(migration, /revoke_reason = 'totp_factor_set_migration'/)
assert.match(migration, /factor_set_backfilled', false/)
assert.doesNotMatch(
  migration,
  /update public\.admin_sessions[\s\S]{0,400}verified_totp_factor_set_hash\s*=/,
  'migration must revoke old Google sessions, never infer a factor-set hash',
)

for (const legacyName of [
  'begin_admin_totp_step_up_pre_b22a_v1',
  'complete_admin_totp_step_up_pre_b22a_v1',
  'enroll_admin_ai_pin_pre_b22a_v1',
  'require_admin_ai_context_pre_b22a_v1',
  'set_admin_ai_policy_pre_b22a_v1',
  'verify_and_touch_google_admin_session_pre_b22a_v1',
]) {
  assert.match(
    migration,
    new RegExp(
      `revoke all on function private\\.${legacyName}\\([\\s\\S]*?from public, anon, authenticated, service_role;`,
    ),
  )
  assert.doesNotMatch(
    migration,
    new RegExp(`grant execute on function private\\.${legacyName}\\(`),
  )
}
assert.match(
  migration,
  /drop function public\.begin_admin_totp_step_up_v1\([\s\S]*?\);/,
  'the factor-unbound public login-begin signature must be removed',
)
assert.doesNotMatch(
  migration,
  /grant execute on function public\.begin_admin_totp_step_up_v1\(/,
)

const loginBeginV2 = migration.match(
  /create function private\.begin_admin_totp_step_up_v2\([\s\S]*?\n\$\$;/,
)?.[0]
assert.ok(loginBeginV2)
assert.match(loginBeginV2, /target_challenged_factor_id/)
assert.match(loginBeginV2, /expected_verified_totp_factor_set_hash_v1\(/)
assert.match(loginBeginV2, /prechallenge_verified_totp_factor_set_hash/)
assert.match(loginBeginV2, /verified_totp_factor_set_hash/)
assert.match(loginBeginV2, /principal_row\.approved_totp_factor_set_hash is null/)
assert.match(loginBeginV2, /membership_row\.status <> 'pending_mfa'/)
assert.match(loginBeginV2, /current_factor_count <> 0/)
assert.match(loginBeginV2, /challenged_factor_status <> 'unverified'/)
assert.match(loginBeginV2, /using errcode = 'P7332'/)
assert.match(
  loginBeginV2,
  /prechallenge_factor_set_snapshot is distinct from\s+principal_row\.approved_totp_factor_set_hash/,
)
assert.match(loginBeginV2, /challenged_factor_status <> 'verified'/)
assert.ok(
  loginBeginV2.indexOf('from private.admin_principals as principal') <
    loginBeginV2.indexOf(
      'from private.admin_environment_memberships as membership',
    ) &&
    loginBeginV2.indexOf(
      'from private.admin_environment_memberships as membership',
    ) < loginBeginV2.indexOf('update private.admin_step_up_nonces'),
  'factor-bound begin keeps principal -> membership -> nonce order',
)
assert.match(
  migration,
  /status = 'superseded'[\s\S]*?reason_code,[\s\S]*?'totp_factor_set_migration'[\s\S]*?'factor_set_backfilled', false/,
  'pre-B2.2a pending proofs must be superseded without inferred binding',
)
assert.match(
  migration,
  /challenged as materialized[\s\S]*?factor\.id = target_challenged_factor_id/,
)
assert.match(
  migration,
  /verified as materialized[\s\S]*?challenged\.status = 'unverified'[\s\S]*?not exists \(select 1 from verified\)/,
)
assert.match(
  migration,
  /challenged where challenged\.status = 'unverified'[\s\S]*?exists \(select 1 from verified\) then null/,
  'an unverified factor is login authority only for the first 0-to-1 enrollment',
)
assert.doesNotMatch(
  migration,
  /where factor\.user_id = target_auth_user_id[\s\S]{0,300}factor\.status = 'unverified'[\s\S]{0,120}\) <> 1/,
  'abandoned unverified factors must not block the exact challenged factor',
)

const loginComplete = migration.match(
  /create function private\.complete_admin_totp_step_up_v1\([\s\S]*?\n\$\$;/,
)?.[0]
assert.ok(loginComplete)
assert.doesNotMatch(
  loginComplete,
  /complete_admin_totp_step_up_pre_b22a_v1/,
  'B2.2a login completion must not call the inverse-lock-order B1 body',
)
const loginNonceReads = [
  ...loginComplete.matchAll(/from private\.admin_step_up_nonces as nonce/g),
].map((match) => match.index)
assert.ok(loginNonceReads.length >= 2)
const principalLock = loginComplete.indexOf(
  'from private.admin_principals as principal',
)
const membershipLock = loginComplete.indexOf(
  'from private.admin_environment_memberships as membership',
)
const environmentLock = loginComplete.indexOf(
  'from private.admin_environments as environment',
)
assert.doesNotMatch(
  loginComplete.slice(loginNonceReads[0], principalLock),
  /for update/,
  'the discovery nonce read must remain nonlocking',
)
for (const [before, after] of [
  [principalLock, membershipLock],
  [membershipLock, environmentLock],
  [environmentLock, loginNonceReads[1]],
]) {
  assert.ok(
    before >= 0 && before < after,
    'login completion lock order requires principal -> membership -> environment -> nonce',
  )
}
assert.match(loginComplete.slice(loginNonceReads[1]), /for update;/)
assert.match(
  loginComplete,
  /current_factor_set_hash is distinct from\s+nonce_row\.verified_totp_factor_set_hash/,
)
assert.match(
  loginComplete,
  /factor\.id = nonce_row\.challenged_totp_factor_id[\s\S]*?factor\.status = 'verified'/,
)
assert.match(
  loginComplete,
  /completion_jwt_hash = target_current_jwt_hash[\s\S]*?verified_totp_amr_at = target_totp_amr_at/,
  'completion must write post-challenge evidence before session INSERT',
)
assert.ok(
  loginComplete.indexOf('completion_jwt_hash = target_current_jwt_hash') <
    loginComplete.indexOf('insert into public.admin_sessions'),
  'post-challenge evidence must precede session insertion',
)
assert.ok(
  loginComplete.indexOf('update private.admin_principals') <
    loginComplete.indexOf('insert into public.admin_sessions'),
  'initial factor approval must be atomic and precede session insertion',
)
assert.match(
  loginComplete,
  /session_row\.verified_totp_factor_set_hash is distinct from\s+nonce_row\.verified_totp_factor_set_hash/,
  'completion must assert the INSERT returned the exact nonce-bound factor set',
)
const factorBindingTrigger = migration.match(
  /create function private\.bind_google_admin_totp_factor_set_v1\([\s\S]*?\n\$\$;/,
)?.[0]
assert.ok(factorBindingTrigger)
assert.ok(
  factorBindingTrigger.indexOf("if tg_op = 'UPDATE'") <
    factorBindingTrigger.indexOf("if new.authentication_method <> 'google_totp'"),
  'old Google bindings must be immutable before the non-Google early return',
)
assert.match(
  factorBindingTrigger,
  /new\.verified_totp_factor_set_hash is null[\s\S]*?raise exception 'Google Admin session requires expected TOTP factor set'/,
)
assert.match(
  factorBindingTrigger,
  /new\.verified_totp_factor_set_hash is distinct from factor_set_hash/,
)
assert.match(
  factorBindingTrigger,
  /gate\.google_session_issue_enabled[\s\S]*?using errcode = 'P7300'/,
  'direct Google session insertion must honor the default-OFF identity gate',
)
assert.ok(
  factorBindingTrigger.indexOf('from private.admin_principals as principal') <
    factorBindingTrigger.indexOf('from private.admin_step_up_nonces as nonce'),
  'session INSERT trigger must lock principal before nonce evidence',
)
assert.match(
  factorBindingTrigger,
  /from private\.admin_principals as principal[\s\S]*?for share;/,
)
assert.match(
  factorBindingTrigger,
  /from private\.admin_step_up_nonces as nonce[\s\S]*?for share;/,
)
assert.match(factorBindingTrigger, /nonce_row\.completion_jwt_hash is null/)
assert.match(
  factorBindingTrigger,
  /nonce_row\.completion_jwt_hash = nonce_row\.prechallenge_jwt_hash/,
)
assert.match(factorBindingTrigger, /nonce_row\.verified_totp_amr_at is null/)
const loginBegin = b1.match(
  /create function private\.begin_admin_totp_step_up_v1\([\s\S]*?\n\$\$;/,
)?.[0]
assert.ok(loginBegin)
assert.ok(
  loginBegin.indexOf('from private.admin_principals as principal') <
    loginBegin.indexOf('from private.admin_environment_memberships as membership') &&
    loginBegin.indexOf('from private.admin_environment_memberships as membership') <
      loginBegin.indexOf('update private.admin_step_up_nonces'),
  'begin and complete must share the principal -> membership -> nonce order',
)

const operatorAdoption = migration.match(
  /create function private\.adopt_existing_admin_totp_factor_set_v1\([\s\S]*?\n\$\$;/,
)?.[0]
assert.ok(operatorAdoption)
assert.match(
  operatorAdoption,
  /serialize_admin_ai_scope_v1\(\s*'totp-factor-set-adoption-request',\s*target_request_id/,
)
const adoptionPrincipalLock = operatorAdoption.indexOf(
  'from private.admin_principals as principal',
)
const adoptionMembershipLock = operatorAdoption.indexOf(
  'from private.admin_environment_memberships as membership',
)
const adoptionReplay = operatorAdoption.indexOf("'replayed', true")
const adoptionGate = operatorAdoption.indexOf(
  'operator_totp_factor_set_adoption_enabled',
)
assert.ok(
  adoptionPrincipalLock >= 0 &&
    adoptionPrincipalLock < adoptionMembershipLock &&
    adoptionMembershipLock < adoptionReplay &&
    adoptionReplay < adoptionGate,
  'adoption requires request advisory -> principal -> membership -> gate-independent exact replay -> new-mutation gate',
)
assert.match(operatorAdoption, /and not gate\.google_session_issue_enabled/)
assert.match(operatorAdoption, /approved_totp_factor_set_hash is not null/)
assert.match(operatorAdoption, /approved_totp_factor_set_hash is null/)
assert.match(operatorAdoption, /admin_totp_factor_set\.operator_adopt/)
for (const [pathName, definition] of [
  ['login begin', loginBeginV2],
  ['session INSERT trigger', factorBindingTrigger],
  ['login complete', loginComplete],
  ['operator adoption', operatorAdoption],
]) {
  assert.equal(
    [
      ...definition.matchAll(
        /private\.current_verified_totp_factor_set_snapshot_v1\(/g,
      ),
    ].length,
    1,
    `${pathName} must read the factor-set hash/count from one snapshot`,
  )
  assert.doesNotMatch(
    definition,
    /private\.current_verified_totp_factor_(?:set_hash|count)_v1\(/,
    `${pathName} must not split hash/count across scalar reads`,
  )
}

for (const wrapper of [
  'adopt_existing_admin_totp_factor_set_v1',
  'begin_admin_totp_step_up_v2',
  'begin_admin_control_step_up_v1',
  'cleanup_admin_control_step_up_ephemera_v1',
  'complete_admin_control_step_up_v1',
  'get_admin_ai_unlock_profile_v1',
  'reconcile_admin_totp_factor_set_v1',
  'reset_admin_ai_pin_v1',
  'revoke_admin_ai_pin_v1',
]) {
  assert.match(
    migration,
    new RegExp(`create function public\\.${wrapper}\\([\\s\\S]*?security invoker`),
  )
  assert.match(
    migration,
    new RegExp(
      `revoke all on function public\\.${wrapper}\\([\\s\\S]*?from public, anon, authenticated;`,
    ),
  )
  assert.match(
    migration,
    new RegExp(
      `grant execute on function public\\.${wrapper}\\([\\s\\S]*?to service_role;`,
    ),
  )
  assert.match(databaseTypes, new RegExp(`\\b${wrapper}:`))
}

assert.match(
  migration,
  /current_factor_set_hash is distinct from[\s\S]*?session_row\.verified_totp_factor_set_hash/,
)
assert.match(migration, /revoke_reason = 'totp_factor_set_changed'/)
assert.match(migration, /update private\.admin_control_step_up_nonces[\s\S]*?status = 'superseded'/)
assert.match(migration, /update private\.admin_control_step_up_grants[\s\S]*?status = 'superseded'/)
assert.match(migration, /update private\.admin_ai_browser_enrollment_nonces[\s\S]*?status = 'superseded'/)
assert.match(migration, /update private\.admin_ai_browser_assertion_challenges[\s\S]*?status = 'superseded'/)
const sessionDrain = migration.match(
  /create function private\.drain_admin_ai_on_session_revoke_v1\([\s\S]*?\n\$\$;/,
)?.[0]
assert.ok(sessionDrain)
assert.doesNotMatch(sessionDrain, /update private\.admin_ai_browser_credentials/)
assert.ok(
  sessionDrain.indexOf('update private.admin_ai_browser_assertion_challenges') <
    sessionDrain.indexOf('update private.admin_ai_browser_enrollment_nonces'),
  'session revoke must match the B2 assertion-challenge -> enrollment-nonce lock order',
)

assert.match(
  migration,
  /factor_history_count = 0/,
  'only a factor-history-free initial PIN enrollment may reuse login TOTP',
)
assert.match(migration, /intended_action := case[\s\S]*?'ai_pin_rotate'/)
assert.match(migration, /'environment_ai_policy_change'/)
assert.match(migration, /'ai_pin_revoke'/)
assert.match(migration, /'ai_pin_reset'/)
assert.match(migration, /terminal_action in \('revoke', 'reset'\)/)
assert.match(migration, /private\.drain_admin_ai_factor_authority_v1/)

const controlBegin = migration.match(
  /create function private\.begin_admin_control_step_up_v1\([\s\S]*?\n\$\$;/,
)?.[0]
assert.ok(controlBegin)
assert.ok(
  controlBegin.indexOf('private.require_admin_ai_context_v1(') <
    controlBegin.indexOf('select count(*) >= 10') &&
    controlBegin.indexOf('select count(*) >= 10') <
      controlBegin.indexOf('insert into private.admin_control_step_up_nonces'),
  'session-row context lock must serialize rate count before nonce insertion',
)
assert.match(controlBegin, /nonce\.issued_at >= effective_now - interval '5 minutes'/)
assert.match(controlBegin, /raise exception 'Admin control step-up rate exceeded'/)

const factorReconcile = migration.match(
  /create function private\.reconcile_admin_totp_factor_set_v1\([\s\S]*?\n\$\$;/,
)?.[0]
assert.ok(factorReconcile)
assert.ok(
  factorReconcile.indexOf('from private.admin_principals as principal') <
    factorReconcile.indexOf('from public.admin_sessions as session'),
  'factor reconciliation must lock an active principal before sessions',
)
assert.match(factorReconcile, /if not found then\s+return null;/)
assert.match(
  factorReconcile,
  /if revoked_count > 0 then[\s\S]*?insert into private\.admin_audit_events/,
)

for (const normalPath of [
  'consume_admin_ai_pin_attempt_v1',
  'begin_admin_ai_browser_assertion_v1',
]) {
  const definition = b2.match(
    new RegExp(`create function private\\.${normalPath}\\([\\s\\S]*?\\n\\$\\$;`),
  )?.[0]
  assert.ok(definition, `${normalPath} must be extractable`)
  assert.match(
    definition,
    /private\.require_admin_ai_context_v1\([\s\S]*?target_supabase_auth_session_id,\s*null,/,
    `${normalPath} must not gain periodic fresh-TOTP requirements`,
  )
}

for (const action of [
  'beginControlStepUp',
  'completeControlStepUp',
  'reconcileTotpFactorSet',
]) {
  assert.match(edge, new RegExp(`'${action}'`))
}
assert.match(edge, /begin_admin_control_step_up_v1/)
assert.match(edge, /complete_admin_control_step_up_v1/)
assert.match(edge, /controlIntentDigest/)
assert.match(
  edge,
  /body\.controlIntentDigest[\s\S]*?target_intent_digest: body\.controlIntentDigest/,
)
assert.doesNotMatch(edge, /target_intent_digest: body\.controlIntentDigest \?\? null/)
assert.match(edge, /begin_admin_totp_step_up_v2/)
assert.match(edge, /target_challenged_factor_id: body\.challengedFactorId/)
assert.match(edge, /errorCode === 'P7332'/)
assert.match(edge, /factor_set_adoption_required/)
assert.match(
  client,
  /factor_set_adoption_required:\s*'認証アプリの登録状態を運用担当者が承認する必要があります。再試行せず運用担当者に連絡してください。'/,
  'factor-set adoption must remain an explicit frontend allowlisted recovery message',
)
assert.match(
  client,
  /typeof data\?\.code === 'string' && data\.code in ADMIN_IDENTITY_MESSAGES/,
  'allowlisted identity response codes must not collapse into the generic error',
)
assert.match(
  client,
  /typeof body\.code === 'string' && body\.code in ADMIN_IDENTITY_MESSAGES/,
  'allowlisted identity HTTP error codes must not collapse into the generic error',
)
assert.doesNotMatch(
  edge,
  /adopt_existing_admin_totp_factor_set_v1/,
  'operator adoption must remain absent from the browser Edge surface',
)
assert.match(
  edge,
  /challengedFactor\.status === 'unverified' && hasVerifiedTotpFactor/,
)
assert.match(client, /beginGoogleAdminStepUp\(\s*challengedFactorId: string/)
assert.match(
  adminIdentityE2e,
  /uses the existing verified factor instead of an abandoned unverified factor/,
)
assert.match(adminIdentityE2e, /challengedFactorId: factorId/)
assert.match(databaseTypes, /target_intent_digest\?: string/)
assert.match(
  migration,
  /target_totp_amr_method is null\s+or target_totp_amr_method not in/,
)
assert.match(
  migration,
  /target_terminal_action is null\s+or target_terminal_action not in/,
)
assert.match(localEdge, /action: 'beginStepUp', challengedFactorId: enrolled\.id/)
assert.match(localEdge, /AAL2 -> AAL2 freshness semantics/)
assert.match(localEdge, /action: 'beginControlStepUp'/)
assert.match(localEdge, /authClient\.auth\.mfa\.challengeAndVerify/)
assert.match(localEdge, /action: 'completeControlStepUp'/)
assert.match(localEdge, /latestTotpAmrTimestamp/)
assert.match(concurrency, /login-begin-lock-order/)
assert.match(concurrency, /login-complete-lock-order/)
assert.match(
  concurrency,
  /login begin\/complete two-transaction lock order did not converge/,
)
assert.match(concurrency, /session-drain-factor-rotation/)
assert.match(concurrency, /session-drain-self-revoke/)
assert.match(
  concurrency,
  /session revoke\/factor drain two-transaction lock order did not converge/,
)
for (const barrier of [
  'PHASE730B22A_LOGIN_BEGIN_LOCKS_READY',
  'PHASE730B22A_SESSION_FACTOR_ASSERTION_LOCK_READY',
  'phase730b22a-login-complete-waiter',
  'phase730b22a-session-revoke-waiter',
]) {
  assert.match(concurrency, new RegExp(barrier))
}
assert.match(concurrency, /wait_event_type = 'Lock'/)
assert.match(
  concurrency,
  /from private\.admin_step_up_nonces[\s\S]*?for update nowait/,
)
assert.match(
  concurrency,
  /from private\.admin_ai_browser_enrollment_nonces[\s\S]*?for update nowait/,
)
assert.match(concurrency, /challenged_totp_factor_id/)
assert.match(concurrency, /verified_totp_factor_set_hash/)
assert.match(upgradeRunner, /--version',\s*'20260809155129'/)
assert.match(
  upgradeRunner,
  /phase7-30b22a-b2-head-upgrade-probe\.sql/,
)
assert.match(
  upgradeRunner,
  /phase7-30b22a-b2-head-upgrade-probe-test\.sql/,
)
for (const b2State of [
  'admin_ai_unlock_factors',
  'admin_ai_policies',
  'admin_ai_browser_credentials',
  'admin_ai_browser_assertion_challenges',
  'admin_ai_unlock_attempt_receipts',
  'admin_ai_pin_discovery_receipts',
  'lecture_ai_master_authorizations',
]) {
  assert.match(b2HeadUpgradeFixture, new RegExp(b2State))
}
assert.match(
  b2HeadUpgradeTest,
  /B2\.2a never fabricates rare-control proof or grants while upgrading/,
)
assert.match(
  b2HeadUpgradeTest,
  /pending B2 login nonce is superseded without inferred factor evidence/,
)
assert.match(
  b2HeadUpgradeTest,
  /verified factors are not inferred into the principal trust anchor/,
)
assert.match(
  b1ToB22aUpgradeTest,
  /does not infer an approved principal TOTP trust anchor/,
)
const relabelGateEnabled = phase730UpgradeTest.indexOf(
  'SET google_session_issue_enabled = true',
)
const relabelProvenanceNegative = phase730UpgradeTest.indexOf(
  'legacy data cannot be relabelled as Google without factor-set provenance',
)
const relabelGateRestored = phase730UpgradeTest.indexOf(
  'SET google_session_issue_enabled = false',
  relabelProvenanceNegative,
)
assert.ok(
  relabelGateEnabled !== -1 &&
    relabelGateEnabled < relabelProvenanceNegative &&
    relabelProvenanceNegative < relabelGateRestored,
  'the legacy relabel probe must enable issuance only around provenance validation and restore default OFF',
)
assert.match(b1PgTap, /'unverified'/)
assert.match(
  b1PgTap,
  /UPDATE auth\.mfa_factors[\s\S]*?SET status = 'verified'[\s\S]*?public\.complete_admin_totp_step_up_v1/,
  'B1 latest-schema regression must exercise the real 0-to-1 bootstrap order',
)
assert.equal(
  (b1PgTap.match(/min_amr_at \+ interval '1 second'/g) ?? []).length,
  1,
  'B1 fixture reads private nonce evidence only before entering service_role',
)
assert.equal(
  (
    b1PgTap.match(
      /current_setting\('compass\.test\.admin_totp_amr_at'\)::timestamptz/g,
    ) ?? []
  ).length,
  4,
  'B1 initial completion and exact retry reuse one session-scoped AMR timestamp',
)
const b22aLoginCompleteCalls =
  pgTap.match(/public\.complete_admin_totp_step_up_v1\([\s\S]*?\n  \)/g) ?? []
assert.equal(b22aLoginCompleteCalls.length, 2)
for (const call of b22aLoginCompleteCalls) {
  assert.match(call, /\n\s+2::smallint,\n/)
}
for (const delegatedContract of [
  'require_admin_ai_context_pre_b22a_v1',
  'verify_and_touch_google_admin_session_pre_b22a_v1',
  'consume_admin_control_step_up_grant_v1',
  'set_admin_ai_policy_pre_b22a_v1',
  'enroll_admin_ai_pin_pre_b22a_v1',
]) {
  assert.match(b2PgTap, new RegExp(delegatedContract))
}
assert.match(
  b2PgTap,
  /approved_totp_factor_set_actor = 'fixture:phase7_30b2'/,
  'B2 latest-schema direct Google sessions require explicit approved anchors',
)
assert.match(
  b2PgTap,
  /completion_jwt_hash,[\s\S]*?verified_totp_amr_at/,
  'B2 latest-schema direct sessions seed completed nonce evidence',
)
assert.match(
  concurrency,
  /approved_totp_factor_set_actor = 'fixture:phase7_30b2_concurrency'/,
  'concurrency direct sessions require explicit approved anchors',
)
assert.match(concurrency, /stepUpCompletionHashA1/)
assert.match(
  pgTap,
  /every B2\.2a foreign key has a valid leading lookup index/,
)
assert.match(
  pgTap,
  /factor-history-free initial PIN enrollment reuses the fresh login TOTP/,
)
assert.match(pgTap, /changed PIN input cannot replay the consumed login-source grant/)
assert.match(pgTap, /explicit PIN revoke consumes its exact grant/)
assert.match(pgTap, /same request\/grant cannot cross from revoke to reset/)
assert.match(pgTap, /explicit PIN reset consumes its independent exact grant/)
assert.match(pgTap, /reset records its distinct terminal factor outcome/)
assert.match(pgTap, /existing verified set rejects an unverified login candidate/)
assert.match(pgTap, /rejected post-enrollment factor addition writes no login nonce/)
assert.match(pgTap, /factor A removal rejects its stale proof/)
assert.match(pgTap, /session INSERT trigger rejects rather than laundering/)
assert.match(
  pgTap,
  /operator adoption persists one authoritative hash\/count aggregate snapshot/,
)
assert.match(
  pgTap,
  /Google TOTP session cannot compound-downgrade into a legacy PIN session/,
)
assert.match(
  pgTap,
  /valid pending nonce without post-challenge evidence cannot issue a session/,
)
assert.match(
  pgTap,
  /completed evidence cannot bypass the default-OFF issue gate/,
)
assert.match(
  pgTap,
  /newly verified factor from an old AAL2 bearer cannot become Admin authority/,
)
assert.match(pgTap, /exact adoption retry survives the operator gate returning OFF/)
assert.match(pgTap, /non-admin and no-op reconciliation add no audit rows/)
assert.match(pgTap, /reconciliation writes one audit row only for a committed revoke/)
assert.match(pgTap, /exact control-begin retry is returned before rate accounting/)
assert.match(pgTap, /rate rejection creates neither a nonce nor an audit row/)
assert.match(edge, /reconcile_admin_totp_factor_set_v1/)
assert.ok(
  edge.indexOf("body.action === 'reconcileTotpFactorSet'") <
    edge.indexOf('getAuthenticatorAssuranceLevel(bearerToken)'),
  'factor reconciliation must work when unenrollment leaves a stale AAL claim',
)
assert.match(client, /export async function beginAdminControlStepUp/)
assert.match(client, /export async function completeAdminControlStepUp/)
assert.match(client, /controlIntentDigest/)
assert.match(client, /export async function reconcileAdminTotpFactorSet/)

assert.equal(
  packageJson.scripts['test:phase7-30b22a-static'],
  'node scripts/test-phase7-30b22a-static.mjs',
)
assert.match(nonLiveSuite, /'test:phase7-30b22a-static'/)

console.log('Phase 7.30B2.2a Admin control hardening static checks passed.')
