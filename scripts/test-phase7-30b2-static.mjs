import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const read = (path) => readFileSync(join(root, path), 'utf8')

const migration = read(
  'supabase/migrations/20260809155129_phase7_30b2_admin_ai_unlock_foundation.sql',
)
const b1IdentityMigration = read(
  'supabase/migrations/20260809143000_phase7_30b1_admin_identity_aal2.sql',
)
const pgTap = read(
  'supabase/tests/phase7_30b2_admin_ai_unlock_foundation_test.sql',
)
const b1PgTap = read('supabase/tests/phase7_30b1_admin_identity_test.sql')
const legacyUpgradeFixture = read(
  'scripts/fixtures/phase7-30-upgrade-probe.sql',
)
const b2UpgradeFixture = read('scripts/fixtures/phase7-30b2-upgrade-probe.sql')
const b2UpgradeTest = read(
  'scripts/fixtures/phase7-30b2-upgrade-probe-test.sql',
)
const upgradeRunner = read('scripts/test-phase7-30-upgrade.mjs')
const concurrencyRunner = read('scripts/test-phase7-30b2-concurrency.mjs')
const packageJson = JSON.parse(read('package.json'))
const nonLiveSuite = read('scripts/ci/run-nonlive-suite.mjs')
const workflow = read('.github/workflows/ci.yml')
const databaseTypes = read('src/types/database.ts')

const extractFunction = (schema, name) => {
  const definition = migration.match(
    new RegExp(
      `create(?: or replace)? function ${schema}\\.${name}\\([\\s\\S]*?\\n\\$\\$;`,
    ),
  )?.[0]
  assert.ok(definition, `${schema}.${name} must be extractable`)
  return definition
}

const privateTables = [
  'admin_ai_unlock_runtime_gate',
  'admin_ai_policies',
  'admin_ai_unlock_factors',
  'admin_ai_unlock_rate_limits',
  'admin_ai_unlock_attempt_receipts',
  'admin_ai_pin_discovery_receipts',
  'admin_ai_browser_enrollment_nonces',
  'admin_ai_browser_credentials',
  'admin_ai_browser_assertion_challenges',
]

for (const table of privateTables) {
  assert.match(migration, new RegExp(`create table private\\.${table}\\b`))
  assert.match(
    migration,
    new RegExp(`alter table private\\.${table} enable row level security;`),
  )
  assert.match(
    migration,
    new RegExp(
      `revoke all on private\\.${table} from public, anon, authenticated, service_role;`,
    ),
  )
  assert.match(pgTap, new RegExp(`['"]${table}['"]`))
}

assert.match(migration, /ai_unlock_enabled boolean not null default false/)
assert.match(
  migration,
  /remembered_browser_enabled boolean not null default false/,
)

const factorTable = migration.match(
  /create table private\.admin_ai_unlock_factors \([\s\S]*?\n\);/,
)?.[0]
assert.ok(factorTable, 'factor table must be extractable')
assert.match(factorTable, /pin_verifier text not null/)
assert.match(factorTable, /pin_verifier ~ '\^\[\$\]2\[aby\]\[\$\]12\[\$\]/)
assert.match(factorTable, /pin_pepper_version integer not null/)
assert.match(factorTable, /verifier_work_factor smallint not null default 12/)
assert.doesNotMatch(
  factorTable,
  /^\s+(?:raw_pin|pin|pin_hmac|peppered_pin_hmac)\s/m,
)
assert.match(migration, /extensions\.gen_salt\('bf', 12\)/)
assert.match(
  migration,
  /extensions\.crypt\(\s*target_peppered_pin_hmac,\s*factor_row\.pin_verifier\s*\)\s*=\s*factor_row\.pin_verifier/,
)

const rateTable = migration.match(
  /create table private\.admin_ai_unlock_rate_limits \([\s\S]*?\n\);/,
)?.[0]
assert.ok(rateTable, 'rate-limit table must be extractable')
assert.match(
  rateTable,
  /bucket_kind in \('environment', 'membership', 'network'\)/,
)
assert.doesNotMatch(
  rateTable,
  /^\s+(?:admin_session_id|browser_credential_id|factor_id|factor_version)\s/m,
)
assert.match(migration, /when 'membership' then 5/)
assert.match(migration, /when 'network' then 30/)
assert.match(migration, /else 300/)
assert.match(migration, /when 'environment' then interval '60 seconds'/)
assert.match(
  migration,
  /order by limiter\.bucket_kind, limiter\.bucket_key\s+for update/,
)
assert.match(migration, /admin_ai_unlock_attempt_receipts_immutable/)
assert.match(
  migration,
  /before update on private\.admin_ai_unlock_attempt_receipts/,
)
assert.match(
  migration,
  /delete from private\.admin_ai_unlock_attempt_receipts as receipt/,
)
const attemptReceiptTable = migration.match(
  /create table private\.admin_ai_unlock_attempt_receipts \([\s\S]*?\n\);/,
)?.[0]
assert.ok(attemptReceiptTable, 'attempt receipt table must be extractable')
assert.match(attemptReceiptTable, /input_pin_pepper_version integer not null/)
assert.match(attemptReceiptTable, /input_pin_proof_digest text not null check/)
assert.match(attemptReceiptTable, /factor_pin_pepper_version integer/)
assert.match(
  migration,
  /receipt_row\.input_pin_proof_digest is not distinct from pin_proof_digest_value/,
)
assert.match(
  migration,
  /receipt_row\.input_pin_pepper_version is not distinct from target_pin_pepper_version/,
)
assert.match(
  migration,
  /target_pin_pepper_version::text \|\| ':' \|\| target_peppered_pin_hmac/,
)

const browserTable = migration.match(
  /create table private\.admin_ai_browser_credentials \([\s\S]*?\n\);/,
)?.[0]
assert.ok(browserTable, 'browser credential table must be extractable')
assert.match(browserTable, /public_key_algorithm = 'ES256'/)
for (const member of ['kty', 'crv', 'x', 'y']) {
  assert.match(
    browserTable,
    new RegExp(`jsonb_typeof\\(public_key_jwk -> '${member}'\\) = 'string'`),
  )
}
assert.match(browserTable, /\(public_key_jwk ->> 'crv' = 'P-256'\) is true/)
assert.match(browserTable, /not \(public_key_jwk \? 'd'\)/)
assert.match(
  browserTable,
  /\{"crv":"P-256","kty":"EC","x":"'[\s\S]*?public_key_jwk ->> 'x'[\s\S]*?public_key_jwk ->> 'y'/,
)
assert.match(browserTable, /public_key_fingerprint = pg_catalog\.encode\(/)
assert.match(browserTable, /expires_at <= created_at \+ interval '30 days'/)
assert.doesNotMatch(browserTable, /^\s+private_key/m)

const enrollmentTable = migration.match(
  /create table private\.admin_ai_browser_enrollment_nonces \([\s\S]*?\n\);/,
)?.[0]
assert.ok(enrollmentTable, 'browser enrollment table must be extractable')
for (const binding of [
  'admin_session_id',
  'environment_id',
  'factor_version',
  'membership_id',
  'origin',
  'principal_id',
  'public_key_fingerprint',
  'step_up_verified_at',
  'completion_intent_digest',
]) {
  assert.match(enrollmentTable, new RegExp(`\\b${binding}\\b`))
}
assert.match(
  enrollmentTable,
  /status in \('pending', 'consumed', 'superseded', 'expired'\)/,
)
assert.match(enrollmentTable, /expires_at <= issued_at \+ interval '5 minutes'/)
assert.match(migration, /admin_ai_browser_enrollment_completed_credential_fkey/)
assert.match(migration, /admin_ai_browser_enrollment_completed_credential_idx/)

const assertionTable = migration.match(
  /create table private\.admin_ai_browser_assertion_challenges \([\s\S]*?\n\);/,
)?.[0]
assert.ok(assertionTable, 'browser assertion table must be extractable')
for (const binding of [
  'admin_session_id',
  'browser_credential_id',
  'challenge_hash',
  'factor_version',
  'lecture_session_id',
  'membership_id',
  'origin',
  'policy_version',
  'requested_scope',
]) {
  assert.match(assertionTable, new RegExp(`\\b${binding}\\b`))
}
assert.match(migration, /target_signature_verified boolean/)
assert.match(
  migration,
  /status = case when target_signature_verified then 'consumed' else 'denied' end/,
)

for (const column of [
  'principal_id',
  'membership_id',
  'issuing_admin_session_id',
  'ai_policy_id',
  'ai_policy_version',
  'unlock_method',
  'unlock_factor_id',
  'unlock_factor_version',
  'browser_credential_id',
  'unlock_verified_at',
  'step_up_verified_at',
]) {
  assert.match(
    migration,
    new RegExp(
      `add column ${column.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`,
    ),
  )
  assert.match(databaseTypes, new RegExp(`\\b${column}:`))
}
assert.match(
  migration,
  /lecture_ai_master_authorizations_unlock_provenance_check/,
)
assert.match(migration, /issuing_admin_session_id = admin_session_id/)
assert.match(migration, /issuing_admin_session_id is not null/)
assert.match(migration, /ai_policy_version is not null/)
assert.match(migration, /unlock_factor_version is not null/)
assert.match(migration, /unlock_method = 'remembered_browser'/)

const publicWrappers = [
  'get_admin_ai_unlock_runtime_gate_v1',
  'set_admin_ai_policy_v1',
  'enroll_admin_ai_pin_v1',
  'get_admin_ai_pin_factor_metadata_v1',
  'verify_admin_ai_pin_v1',
  'begin_admin_ai_browser_enrollment_v1',
  'complete_admin_ai_browser_enrollment_v1',
  'begin_admin_ai_browser_assertion_v1',
  'complete_admin_ai_browser_assertion_v1',
  'revoke_admin_ai_browser_credential_v1',
  'cleanup_admin_ai_ephemera_v1',
]

for (const functionName of publicWrappers) {
  assert.match(
    migration,
    new RegExp(
      `create function public\\.${functionName}\\([\\s\\S]*?security invoker`,
    ),
  )
  assert.match(
    migration,
    new RegExp(
      `revoke all on function public\\.${functionName}\\([\\s\\S]*?from public, anon, authenticated, service_role;`,
    ),
  )
  assert.match(
    migration,
    new RegExp(
      `grant execute on function public\\.${functionName}\\([\\s\\S]*?to service_role;`,
    ),
  )
}

assert.match(
  migration,
  /create function private\.consume_admin_ai_pin_attempt_v1\([\s\S]*?security definer/,
)
assert.match(
  migration,
  /create function private\.complete_admin_ai_browser_enrollment_v1\([\s\S]*?security definer/,
)
assert.match(
  migration,
  /create function private\.complete_admin_ai_browser_assertion_v1\([\s\S]*?security definer/,
)
assert.match(migration, /set search_path = ''/)
assert.match(migration, /from auth\.sessions as auth_session/g)
assert.match(
  migration,
  /create or replace function private\.verify_and_touch_google_admin_session_v1/,
)
assert.match(migration, /create function private\.cleanup_admin_ai_ephemera_v1/)
assert.match(migration, /target_min_step_up_verified_at/)

const consumePin = extractFunction('private', 'consume_admin_ai_pin_attempt_v1')
const verifyPin = extractFunction('private', 'verify_admin_ai_pin_v1')
const publicVerifyPin = extractFunction('public', 'verify_admin_ai_pin_v1')
const enrollPin = extractFunction('private', 'enroll_admin_ai_pin_v1')
const beginBrowserEnrollment = extractFunction(
  'private',
  'begin_admin_ai_browser_enrollment_v1',
)
const setPolicy = extractFunction('private', 'set_admin_ai_policy_v1')
for (const definition of [
  consumePin,
  verifyPin,
  publicVerifyPin,
  enrollPin,
  beginBrowserEnrollment,
  setPolicy,
]) {
  const signature = definition.slice(0, definition.indexOf(')\nreturns'))
  assert.doesNotMatch(signature, /target_min_step_up_verified_at/)
}
assert.match(
  consumePin,
  /private\.require_admin_ai_context_v1\(\s*target_token_hash,\s*target_auth_user_id,\s*target_supabase_auth_session_id,\s*null,\s*true,\s*false/s,
)
assert.match(
  consumePin,
  /receipt_row\.occurred_at <= effective_now - interval '5 minutes'/,
)
for (const liveReceiptBinding of [
  'factor.id = receipt_row.factor_id',
  'factor.factor_version = receipt_row.factor_version',
  'factor.environment_id = receipt_row.environment_id',
  'factor.principal_id = receipt_row.principal_id',
  'factor.membership_id = receipt_row.membership_id',
  "factor.status = 'active'",
  'factor.pin_pepper_version = receipt_row.factor_pin_pepper_version',
  'discovery.pin_pepper_version = target_pin_pepper_version',
]) {
  assert.match(
    consumePin,
    new RegExp(liveReceiptBinding.replaceAll('.', '\\.')),
  )
}
assert.match(
  beginBrowserEnrollment,
  /private\.require_admin_ai_context_v1\(\s*target_token_hash,\s*target_auth_user_id,\s*target_supabase_auth_session_id,\s*null,/s,
)
for (const rareFactorControl of [enrollPin, setPolicy]) {
  assert.match(
    rareFactorControl,
    /private\.require_admin_ai_context_v1\(\s*target_token_hash,\s*target_auth_user_id,\s*target_supabase_auth_session_id,\s*null,/s,
  )
  assert.match(
    rareFactorControl,
    /context_value ->> 'step_up_verified_at'[\s\S]*?< effective_now - interval '5 minutes'/,
  )
}
for (const [definition, replayNeedle, mutationNeedle] of [
  [
    enrollPin,
    'where factor.enrollment_request_id = target_request_id',
    'select coalesce(max(factor.factor_version), 0) + 1',
  ],
  [
    setPolicy,
    'where policy.request_id = target_request_id',
    'select membership.*',
  ],
]) {
  const replayPosition = definition.indexOf(replayNeedle)
  const freshnessPosition = definition.indexOf(
    "< effective_now - interval '5 minutes'",
  )
  const mutationPosition = definition.indexOf(mutationNeedle)
  assert.ok(replayPosition >= 0)
  assert.ok(freshnessPosition > replayPosition)
  assert.ok(mutationPosition > freshnessPosition)
}
for (const binding of [
  'existing_factor.environment_id',
  'existing_factor.principal_id',
  'existing_factor.membership_id',
  'existing_factor.enrolled_by_admin_session_id',
]) {
  assert.match(enrollPin, new RegExp(binding.replaceAll('.', '\\.')))
}
const enrollmentReplayPosition = enrollPin.indexOf(
  'where factor.enrollment_request_id = target_request_id',
)
const enrollmentFreshnessPosition = enrollPin.indexOf(
  "< effective_now - interval '5 minutes'",
)
const enrollmentBcryptPosition = enrollPin.indexOf(
  'verifier_value := extensions.crypt',
)
const enrollmentReplayBlock = enrollPin.slice(
  enrollmentReplayPosition,
  enrollmentFreshnessPosition,
)
assert.doesNotMatch(
  enrollmentReplayBlock,
  /extensions\.crypt|target_peppered_pin_hmac|target_pin_pepper_version|\.pin_verifier/,
)
assert.ok(enrollmentBcryptPosition > enrollmentFreshnessPosition)
assert.equal(enrollPin.match(/extensions\.crypt/g)?.length, 1)
assert.doesNotMatch(
  databaseTypes.match(
    /set_admin_ai_policy_v1: \{[\s\S]*?\n\s+Returns: Json\n\s+\}/,
  )?.[0] ?? '',
  /target_min_step_up_verified_at/,
)
const bcryptPosition = consumePin.indexOf('verified_value := extensions.crypt')
const bcryptLeasePosition = consumePin.indexOf(
  'private.try_acquire_admin_ai_bcrypt_lease_v1',
)
const rateInsertPosition = consumePin.indexOf(
  'insert into private.admin_ai_unlock_rate_limits',
)
const rateLockPosition = consumePin.indexOf(
  'order by limiter.bucket_kind, limiter.bucket_key',
)
assert.ok(bcryptPosition >= 0)
assert.ok(bcryptLeasePosition >= 0)
assert.ok(bcryptLeasePosition < bcryptPosition)
assert.ok(rateInsertPosition > bcryptPosition)
assert.ok(rateLockPosition > rateInsertPosition)
const bcryptLease = extractFunction(
  'private',
  'try_acquire_admin_ai_bcrypt_lease_v1',
)
assert.match(bcryptLease, /for slot_number in 1\.\.4 loop/)
assert.match(bcryptLease, /for slot_number in 1\.\.2 loop/)
assert.match(bcryptLease, /pg_catalog\.pg_try_advisory_xact_lock/g)
assert.match(bcryptLease, /'bcrypt-environment:'/)
assert.match(bcryptLease, /'bcrypt-network:'/)
assert.match(
  consumePin,
  /if not bcrypt_lease_acquired then[\s\S]*?retry_after_value := 1;[\s\S]*?reason_value := 'unlock_temporarily_unavailable'/,
)
assert.match(
  consumePin,
  /factor_id,[\s\S]*?input_pin_pepper_version,[\s\S]*?\) values \([\s\S]*?factor_row\.id,[\s\S]*?target_pin_pepper_version/,
)

const factorDrain = extractFunction(
  'private',
  'drain_admin_ai_factor_authority_v1',
)
for (const target of [
  'private.admin_ai_browser_assertion_challenges',
  'private.admin_ai_browser_enrollment_nonces',
  'private.admin_ai_browser_credentials',
  'public.lecture_ai_master_authorizations',
]) {
  assert.match(factorDrain, new RegExp(target.replaceAll('.', '\\.')))
}
assert.match(factorDrain, /private\.revoke_pending_ai_grants_for_lecture/)
assert.match(factorDrain, /private\.stop_lecture_ai_control/)
assert.doesNotMatch(factorDrain, /update public\.admin_sessions/)
assert.match(
  factorDrain,
  /perform 1\s+from public\.lecture_sessions as lecture[\s\S]*?for update;\s+select master\.\*[\s\S]*?from public\.lecture_ai_master_authorizations as master[\s\S]*?for update;/,
)
assert.match(
  extractFunction('private', 'enroll_admin_ai_pin_v1'),
  /private\.drain_admin_ai_factor_authority_v1\(/,
)

const completeBrowserAssertion = extractFunction(
  'private',
  'complete_admin_ai_browser_assertion_v1',
)
for (const completion of [
  completeBrowserAssertion,
  extractFunction('private', 'complete_admin_ai_browser_enrollment_v1'),
]) {
  assert.match(
    completion,
    /gate\.ai_unlock_enabled[\s\S]*?gate\.remembered_browser_enabled/,
  )
  assert.match(completion, /using errcode = 'P7321'/)
}
const beginBrowserAssertion = extractFunction(
  'private',
  'begin_admin_ai_browser_assertion_v1',
)
assert.match(
  beginBrowserAssertion,
  /credential\.source_factor_id = challenge_row\.factor_id[\s\S]*?credential\.source_factor_version = challenge_row\.factor_version/,
)
assert.match(
  beginBrowserAssertion,
  /challenge_row\.expires_at = target_expires_at/,
)
for (const replayBinding of [
  'challenge_row.admin_session_id',
  'challenge_row.environment_id',
  'challenge_row.principal_id',
  'challenge_row.membership_id',
  'challenge_row.origin',
  'challenge_row.expires_at > effective_now',
  'credential.source_factor_id = challenge_row.factor_id',
  'credential.source_factor_version = challenge_row.factor_version',
  'factor.status = \\x27active\\x27',
  'policy.status = \\x27active\\x27',
  'lecture.status = \\x27open\\x27',
]) {
  assert.match(completeBrowserAssertion, new RegExp(replayBinding))
}

const completeBrowserEnrollment = extractFunction(
  'private',
  'complete_admin_ai_browser_enrollment_v1',
)
for (const replayBinding of [
  'nonce_row.expires_at <= effective_now',
  'nonce_row.environment_id',
  'nonce_row.principal_id',
  'nonce_row.membership_id',
  'credential.source_factor_id = nonce_row.factor_id',
  'credential.source_factor_version = nonce_row.factor_version',
  'credential.public_key_jwk = target_public_key_jwk',
  "credential.status = 'active'",
  "factor.status = 'active'",
  'nonce_row.completion_intent_digest <> intent_digest_value',
]) {
  assert.match(completeBrowserEnrollment, new RegExp(replayBinding))
}
assert.match(
  completeBrowserEnrollment,
  /\{"crv":"P-256","kty":"EC","x":"'[\s\S]*?target_public_key_jwk ->> 'x'[\s\S]*?target_public_key_jwk ->> 'y'/,
)

const requireContext = extractFunction('private', 'require_admin_ai_context_v1')
const lockTargets = [
  'from private.admin_principals as principal',
  'from private.admin_environment_memberships as membership',
  'where session.id = session_snapshot.id',
]
const lockPositions = lockTargets.map((target) =>
  requireContext.indexOf(target),
)
assert.ok(lockPositions.every((position) => position >= 0))
assert.deepEqual(
  lockPositions,
  [...lockPositions].sort((left, right) => left - right),
)
assert.ok(
  requireContext.indexOf('from private.admin_environments as environment') >
    lockPositions.at(-1),
)
assert.doesNotMatch(
  requireContext.match(
    /from private\.admin_environments as environment[\s\S]*?;/,
  )?.[0] ?? '',
  /for key share/,
)
assert.ok((requireContext.match(/for key share/g) ?? []).length >= 3)

const googleTouch = extractFunction(
  'private',
  'verify_and_touch_google_admin_session_v1',
)
const b1TouchLockPositions = lockTargets.map((target) =>
  googleTouch.indexOf(target),
)
assert.ok(b1TouchLockPositions.every((position) => position >= 0))
assert.deepEqual(
  b1TouchLockPositions,
  [...b1TouchLockPositions].sort((left, right) => left - right),
)
assert.ok(
  googleTouch.indexOf('from private.admin_environments as environment') >
    b1TouchLockPositions.at(-1),
)
assert.doesNotMatch(
  googleTouch.match(
    /from private\.admin_environments as environment[\s\S]*?;/,
  )?.[0] ?? '',
  /for key share/,
)
assert.ok((googleTouch.match(/for key share/g) ?? []).length >= 3)
assert.match(
  b1IdentityMigration,
  /create function private\.enforce_admin_principal_identity_v1\([\s\S]*?for update of environment/,
)
assert.match(
  b1IdentityMigration,
  /create function private\.enforce_admin_membership_owner_v1\([\s\S]*?from private\.admin_environments as environment[\s\S]*?for update/,
)
const googleSessionFence = extractFunction(
  'private',
  'enforce_google_admin_session_absolute_idle_v1',
)
assert.match(migration, /create trigger admin_sessions_google_absolute_idle/)
assert.match(googleSessionFence, /from auth\.sessions as auth_session/)
assert.match(
  googleSessionFence,
  /from auth\.sessions as auth_session[\s\S]*?for key share/,
)
assert.match(googleSessionFence, /if not found then/)
assert.match(googleSessionFence, /using errcode = 'P7323'/)
assert.match(
  googleSessionFence,
  /auth_session_created_at \+ interval '8 hours'/,
)
assert.match(
  googleSessionFence,
  /new\.expires_at := least\(new\.expires_at, auth_session_expires_at\)/,
)
assert.match(googleSessionFence, /new\.idle_expires_at := new\.expires_at/)
assert.match(
  migration,
  /update of\s+authentication_method,\s+auth_user_id,\s+supabase_auth_session_id,\s+issued_at,\s+expires_at,\s+idle_expires_at/,
)
assert.match(
  migration,
  /where session\.authentication_method = 'google_totp'[\s\S]*?auth_session\.created_at \+ interval '8 hours'/,
)
assert.match(requireContext, /idle_expires_at = expires_at/)
assert.match(
  requireContext,
  /from auth\.sessions as auth_session[\s\S]*?for key share/,
)
assert.match(googleTouch, /idle_expires_at = expires_at/)
assert.match(
  googleTouch,
  /from auth\.sessions as auth_session[\s\S]*?for key share/,
)
assert.doesNotMatch(migration, /interval '30 minutes'/)

const cleanup = extractFunction('private', 'cleanup_admin_ai_ephemera_v1')
assert.ok(
  (cleanup.match(/for update(?: of [a-z_]+)? skip locked/g) ?? []).length >= 9,
)
assert.ok((cleanup.match(/limit 500/g) ?? []).length >= 9)
assert.match(cleanup, /'has_more', has_more/)
assert.match(cleanup, /order by receipt\.occurred_at, receipt\.request_id/)
assert.match(cleanup, /delete from private\.admin_ai_pin_discovery_receipts/)
assert.match(cleanup, /private\.drain_admin_ai_browser_credential_authority_v1/)
assert.match(
  cleanup,
  /continue when not private\.try_serialize_admin_ai_scope_v1\(\s*'factor-membership',\s*expired_credential_candidate\.membership_id\s*\)/s,
)
assert.match(
  extractFunction('private', 'try_serialize_admin_ai_scope_v1'),
  /pg_catalog\.pg_try_advisory_xact_lock/,
)
assert.ok(
  cleanup.indexOf("'factor-membership'") <
    cleanup.indexOf(
      'from private.admin_ai_browser_assertion_challenges as challenge',
    ),
)
assert.ok(
  cleanup.indexOf("'factor-membership'") <
    cleanup.indexOf('from private.admin_ai_browser_enrollment_nonces as nonce'),
)
assert.match(
  migration,
  /admin_ai_unlock_attempt_receipts_retention_idx[\s\S]*?\(occurred_at, request_id\)/,
)

const verifyPinTypes = databaseTypes.match(
  /verify_admin_ai_pin_v1: \{[\s\S]*?\n\s+Returns: Json\n\s+\}/,
)?.[0]
assert.ok(verifyPinTypes, 'verify_admin_ai_pin_v1 generated type must exist')
assert.doesNotMatch(verifyPinTypes, /target_min_step_up_verified_at/)
assert.match(verifyPinTypes, /target_pin_pepper_version: number/)
assert.match(databaseTypes, /get_admin_ai_pin_factor_metadata_v1: \{/)
assert.match(databaseTypes, /pin_pepper_version: number/)
for (const rpcTypeName of [
  'enroll_admin_ai_pin_v1',
  'begin_admin_ai_browser_enrollment_v1',
  'set_admin_ai_policy_v1',
]) {
  const rpcType = databaseTypes.match(
    new RegExp(`${rpcTypeName}: \\{[\\s\\S]*?\\n\\s+Returns: Json\\n\\s+\\}`),
  )?.[0]
  assert.ok(rpcType, `${rpcTypeName} generated type must exist`)
  assert.doesNotMatch(rpcType, /target_min_step_up_verified_at/)
}

const metadataFunction = extractFunction(
  'private',
  'get_admin_ai_pin_factor_metadata_v1',
)
for (const binding of [
  'target_intent_digest',
  'target_request_id',
  'target_network_hmac',
  'pin_pepper_version',
  'admin_ai_pin_discovery_receipts',
  'require_admin_ai_context_v1',
  'admin_ai_unlock_rate_limits',
]) {
  assert.match(metadataFunction, new RegExp(binding))
}
assert.doesNotMatch(metadataFunction, /pin_verifier/)

for (const exactReplayBinding of [
  'allowed_actions is not distinct from target_allowed_actions',
  'allowed_models is not distinct from target_allowed_models',
  'max_calls_per_lecture is not distinct from target_max_calls_per_lecture',
  'max_calls_per_day is not distinct from target_max_calls_per_day',
  'max_input_tokens_per_lecture is not distinct from target_max_input_tokens_per_lecture',
  'max_output_tokens_per_lecture is not distinct from target_max_output_tokens_per_lecture',
  'max_cost_microusd_per_lecture is not distinct from target_max_cost_microusd_per_lecture',
  'max_realtime_minutes_per_lecture is not distinct from target_max_realtime_minutes_per_lecture',
  'max_concurrency is not distinct from target_max_concurrency',
  'valid_from is not distinct from target_valid_from',
  'valid_until is not distinct from target_valid_until',
]) {
  assert.match(setPolicy, new RegExp(exactReplayBinding))
}
assert.match(setPolicy, /private\.drain_admin_ai_policy_authority_v1/)
assert.match(
  migration,
  /create function private\.serialize_admin_ai_request_v1/,
)
assert.match(migration, /create function private\.serialize_admin_ai_scope_v1/)
assert.match(
  migration,
  /pg_catalog\.pg_advisory_xact_lock\([\s\S]*?pg_catalog\.hashtextextended/,
)
assert.equal(
  (
    migration.match(
      /perform private\.serialize_admin_ai_request_v1\(target_request_id\)/g,
    ) ?? []
  ).length,
  9,
)
assert.match(setPolicy, /'policy-membership',[\s\S]*?target_membership_id/)
assert.match(
  extractFunction('private', 'enroll_admin_ai_pin_v1'),
  /'factor-membership',[\s\S]*?membership_id/,
)
assert.ok(
  migration.indexOf(
    'create function private.drain_admin_ai_policy_authority_v1',
  ) < migration.indexOf('create function private.set_admin_ai_policy_v1'),
)
assert.match(
  migration,
  /create or replace function private\.drain_admin_ai_policy_authority_v1/,
)
assert.match(
  extractFunction('private', 'revoke_admin_ai_browser_credential_v1'),
  /private\.drain_admin_ai_browser_credential_authority_v1/,
)
assert.match(
  extractFunction('private', 'revoke_admin_ai_browser_credential_v1'),
  /revocation_request_id is not distinct from target_request_id/,
)

for (const fixture of [b1PgTap, legacyUpgradeFixture, b2UpgradeFixture]) {
  assert.match(fixture, /insert into auth\.users/i)
  assert.match(fixture, /insert into auth\.sessions/i)
  assert.match(fixture, /email_confirmed_at/)
  assert.doesNotMatch(fixture, /\bconfirmed_at\b/)
}
assert.match(b2UpgradeFixture, /authentication_method[\s\S]*?'google_totp'/)
assert.match(b2UpgradeTest, /auth_session\.created_at \+ interval '8 hours'/)
assert.match(
  b2UpgradeTest,
  /does not introduce a 30-minute lecture idle cutoff/,
)
assert.match(upgradeRunner, /phase7-30b2-upgrade-probe\.sql/)
assert.match(upgradeRunner, /phase7-30b2-upgrade-probe-test\.sql/)

assert.doesNotMatch(
  migration,
  /\bBILLING_PIN\b|\bADMIN_PIN\b|\bOPENAI_API_KEY\b/,
)
assert.doesNotMatch(
  migration,
  /https:\/\/api\.openai\.com|wrangler|supabase\s+link|supabase\s+db\s+push/i,
)

assert.equal(
  packageJson.scripts?.['test:phase7-30b2-static'],
  'node scripts/test-phase7-30b2-static.mjs',
)
assert.equal(
  packageJson.scripts?.['test:phase7-30b2-concurrency'],
  'node scripts/test-phase7-30b2-concurrency.mjs',
)
assert.match(nonLiveSuite, /'test:phase7-30b2-static'/)
assert.match(workflow, /run: npm run test:ci:nonlive/)
assert.match(workflow, /run: npx supabase test db --local/)
assert.match(workflow, /run: npm run test:phase7-30b2-concurrency/)
assert.match(concurrencyRunner, /Promise\.all\(\[/)
assert.match(
  concurrencyRunner,
  /concurrent PIN discovery did not converge to one exact receipt/,
)
assert.match(
  concurrencyRunner,
  /concurrent policy writes did not serialize to two versions and one active policy/,
)
assert.match(concurrencyRunner, /stale policy step-up created authority/)
assert.match(
  concurrencyRunner,
  /bounded bcrypt semaphore did not return exact capacity denials/,
)
assert.match(concurrencyRunner, /bcrypt capacity denial mutated abuse counters/)
assert.match(concurrencyRunner, /bcrypt-environment:/)
assert.match(concurrencyRunner, /bcrypt-network:/)
assert.match(
  concurrencyRunner,
  /PIN discovery\/rotation race did not converge to exact factor v2/,
)
assert.match(
  concurrencyRunner,
  /independent membership bcrypt verification did not return two exact successes/,
)
assert.match(
  concurrencyRunner,
  /independent membership failed verification produced incorrect exact shared and scoped counts/,
)
assert.match(
  concurrencyRunner,
  /last-owner DELETE\/context race did not reject exactly without deadlock/,
)
assert.match(
  concurrencyRunner,
  /cleanup\/rotation two-transaction race did not converge to one exact terminalizer/,
)
assert.match(
  concurrencyRunner,
  /cleanup\/revoke two-transaction race did not converge to one exact terminalizer/,
)
assert.match(
  concurrencyRunner,
  /two concurrent cleaners did not nonblockingly converge to one exact credential expiry/,
)
assert.match(
  concurrencyRunner,
  /id\.enrollmentOne[\s\S]*?status in \('expired', 'superseded'\)/,
)
assert.match(
  concurrencyRunner,
  /id\.challengeOne[\s\S]*?status in \('expired', 'superseded'\)/,
)
assert.match(
  concurrencyRunner,
  /id\.challengeTwo[\s\S]*?status in \('expired', 'superseded'\)/,
)
assert.match(
  concurrencyRunner,
  /id\.challengeThree[\s\S]*?status in \('expired', 'superseded'\)/,
)
assert.match(concurrencyRunner, /id\.enrollmentTwo[\s\S]*?<> 'expired'/)
assert.match(concurrencyRunner, /id\.enrollmentThree[\s\S]*?<> 'expired'/)
assert.match(
  concurrencyRunner,
  /phase7_30b2_concurrency_child_delay[\s\S]*?pg_catalog\.pg_sleep\(0\.40\)/,
)
assert.match(concurrencyRunner, /select pg_sleep\(0\.10\)/)
assert.match(pgTap, /auth\.sessions/)
assert.match(pgTap, /bcrypt cost 12/)
assert.match(pgTap, /public B2 wrappers are invoker-only and service-role-only/)
assert.match(pgTap, /every B2 foreign key has a valid leading lookup index/)
assert.match(pgTap, /generate_series\(1, 501\)/)
assert.match(pgTap, /second cleanup call converges/)
assert.match(pgTap, /canonical Admin audit remains append-only/)
assert.match(
  pgTap,
  /discovers only the active pepper version without fresh TOTP/,
)
assert.match(
  pgTap,
  /normal lecture AI PIN verification succeeds without periodic TOTP/,
)
assert.match(pgTap, /five minutes and one second/)
assert.match(pgTap, /four minutes and fifty-nine seconds/)
assert.match(pgTap, /near-eight-hour AAL2 session cannot rotate/)
assert.match(
  pgTap,
  /exact policy request replay returns the committed version after fresh step-up expires/,
)
assert.match(
  pgTap,
  /exact PIN mutation request replays after the five-minute step-up window expires/,
)
assert.match(
  pgTap,
  /same PIN enrollment request returns the committed result without rechecking changed PIN input/,
)
assert.match(
  pgTap,
  /same PIN enrollment request never creates a second factor version/,
)
assert.match(
  pgTap,
  /fresh rare step-up permits a PIN rotation immediately before the eight-hour Auth cap/,
)
assert.match(
  pgTap,
  /near-cap factor mutation cannot extend expires_at or idle_expires_at beyond Auth created_at plus eight hours/,
)
assert.match(
  pgTap,
  /same policy request ID cannot replay across owner actors with exact input/,
)
assert.match(pgTap, /same enrollment request ID cannot replay across actors/)
assert.match(pgTap, /gate-OFF enrollment completion leaves the nonce pending/)
assert.match(
  pgTap,
  /gate-OFF assertion completion leaves the challenge pending/,
)
assert.match(
  pgTap,
  /verification replay with a different PIN proof is rejected/,
)
assert.match(
  pgTap,
  /public browser assertion consumes exactly one signature-verified challenge/,
)
assert.match(
  pgTap,
  /browser credential revocation drains every active master sourced from it/,
)
assert.match(
  pgTap,
  /policy supersession drains every active master tied to the old policy/,
)
assert.match(
  pgTap,
  /locked membership cannot obtain another pepper-version attempt/,
)
assert.match(
  pgTap,
  /factor rotation preserves the logged-in Admin lecture session/,
)
assert.match(pgTap, /blocked receipts retain non-null input proof binding/)
assert.match(pgTap, /stale-factor receipts retain non-null input proof binding/)
assert.match(
  pgTap,
  /RFC 7638 EC canonical bytes match the Node Edge known vector/,
)
assert.match(
  pgTap,
  /final dormant gate also disables remembered-browser issuance and completion/,
)

console.log('Phase 7.30B2 static security and schema contract passed.')
