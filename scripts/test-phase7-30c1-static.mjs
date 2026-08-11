import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (path) =>
  readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const directPrivateReadsAsServiceRole = (sql) => {
  const sanitized = sql
    .replace(/\$\$[\s\S]*?\$\$/g, ' ')
    .replace(/'(?:''|[^'])*'/g, ' ')
    .replace(/--[^\r\n]*/g, ' ')
  const reads = []
  let serviceRole = false
  for (const rawStatement of sanitized.split(';')) {
    const statement = rawStatement.replace(/\s+/g, ' ').trim()
    if (!statement) continue
    if (/^RESET ROLE$/i.test(statement)) {
      serviceRole = false
      continue
    }
    if (/^SET ROLE service_role$/i.test(statement)) {
      serviceRole = true
      continue
    }
    if (
      serviceRole &&
      /\b(?:FROM|JOIN)\s+private\.[a-z_][a-z0-9_]*/i.test(statement)
    ) {
      reads.push(statement)
    }
  }
  return reads
}

const migration = read(
  'supabase/migrations/20260810160000_phase7_30c1_google_ai_master.sql',
)
const pgTap = read('supabase/tests/phase7_30c1_google_ai_master_test.sql')
const runtimePgTap = read(
  'supabase/tests/phase7_30c1_google_ai_master_runtime_test.sql',
)
const localEdge = read('scripts/test-phase7-30b1-local-edge.mjs')
const workflow = read('.github/workflows/ci.yml')
const edge = read('supabase/functions/admin-ai-unlock/index.ts')
const client = read('src/lib/adminAuth/adminAiUnlockApi.ts')
const types = read('src/types/database.ts')
const upgradeRunner = read('scripts/test-phase7-30-upgrade.mjs')
const upgradeFixture = read(
  'scripts/fixtures/phase7-30c1-b22b-head-upgrade-probe.sql',
)
const upgradeProbe = read(
  'scripts/fixtures/phase7-30c1-b22b-head-upgrade-probe-test.sql',
)
const docs = read('docs/PHASE7_30C1_GOOGLE_AI_MASTER_ADMISSION.md')
const identityPlan = read('docs/PHASE7_30_GOOGLE_ADMIN_IDENTITY_PLAN.md')
const readme = read('README.md')
const packageJson = JSON.parse(read('package.json'))
const nonlive = read('scripts/ci/run-nonlive-suite.mjs')
const migrationDdl = migration.slice(
  0,
  migration.indexOf(
    'create function private.reject_admin_c1_evidence_mutation_v1',
  ),
)

assert.match(
  migration,
  /google_ai_master_admission_enabled boolean not null default false/,
)
assert.match(migration, /create table private\.admin_lecture_ownerships/)
assert.match(
  migration,
  /create table private\.admin_ai_master_admission_receipts/,
)
assert.match(
  migration,
  /create table private\.admin_ai_master_control_receipts/,
)
assert.match(migration, /create table private\.admin_ai_master_reuse_receipts/)
assert.match(
  migration,
  /get_admin_ai_unlock_runtime_gate_v1[\s\S]*google_ai_master_admission_enabled/,
)
assert.doesNotMatch(
  migrationDdl,
  /insert into private\.admin_lecture_ownerships|update private\.admin_lecture_ownerships/,
)
assert.doesNotMatch(
  migration,
  /alter table public\.lecture_sessions[\s\S]*principal_id/,
)
const ownedLectureCreate =
  migration.match(
    /create function private\.create_owned_admin_lecture_v1[\s\S]*?\n\$\$;/,
  )?.[0] ?? ''
const ownedLectureDigest =
  migration.match(
    /create function private\.owned_admin_lecture_intent_digest_v1[\s\S]*?\n\$\$;/,
  )?.[0] ?? ''
assert.match(ownedLectureDigest, /language sql\s+stable/)
assert.match(ownedLectureDigest, /extract\(epoch from target_starts_at\)/)
assert.match(ownedLectureDigest, /extract\(epoch from target_ends_at\)/)
assert.doesNotMatch(
  ownedLectureDigest,
  /target_(?:starts|ends)_at::text/,
  'canonical lecture timestamps must not depend on session TimeZone',
)
const ownershipLookup = ownedLectureCreate.indexOf(
  'where ownership.ownership_request_id = target_request_id',
)
const ownershipReplay = ownedLectureCreate.indexOf('if found then')
const ownershipGate = ownedLectureCreate.indexOf(
  'gate_row.google_ai_master_admission_enabled',
)
const ownershipGateLock = ownedLectureCreate.indexOf(
  'from private.admin_ai_unlock_runtime_gate as gate',
)
assert.ok(
  ownershipLookup >= 0 &&
    ownershipLookup < ownershipReplay &&
    ownershipReplay < ownershipGateLock &&
    ownershipGateLock < ownershipGate,
  'owned lecture exact replay must precede the default-OFF creation gate',
)
assert.match(
  ownedLectureCreate.slice(ownershipGateLock, ownershipGate),
  /from private\.admin_ai_unlock_runtime_gate as gate[\s\S]*for share/,
  'new owned-lecture creation holds the gate row against deactivation',
)
assert.match(
  migration,
  /owned-lecture-create:v1[\s\S]*code_hash=[\s\S]*created_lecture_id := public\.admin_create_lecture_v2/,
)

const context =
  migration.match(
    /create function private\.require_google_ai_master_context_v1[\s\S]*?\n\$\$;/,
  )?.[0] ?? ''
const principalLock = context.indexOf(
  'from private.admin_principals as principal',
)
const membershipLock = context.indexOf(
  'from private.admin_environment_memberships as membership',
)
const environmentRead = context.indexOf(
  'from private.admin_environments as environment',
)
const appSessionLock = context.lastIndexOf(
  'from public.admin_sessions as session',
)
const authSessionLock = context.indexOf('from auth.sessions as auth_session')
const totpSnapshot = context.indexOf(
  'current_verified_totp_factor_set_snapshot_v1',
)
assert.ok(
  principalLock >= 0 &&
    principalLock < membershipLock &&
    membershipLock < environmentRead &&
    environmentRead < appSessionLock &&
    appSessionLock < authSessionLock &&
    authSessionLock < totpSnapshot,
  'C1 context locks P -> M -> environment -> app session -> Auth session before one TOTP snapshot',
)
assert.match(
  context.slice(environmentRead, appSessionLock),
  /for share/i,
  'the environment is held FOR SHARE after P/M through authority admission',
)
assert.equal(
  (context.match(/current_verified_totp_factor_set_snapshot_v1/g) ?? []).length,
  1,
  'C1 context uses one paired TOTP hash/count snapshot',
)
assert.match(context, /auth_session_row\.created_at \+ interval '8 hours'/)
assert.match(context, /idle_expires_at = expires_at/)
assert.match(context, /revoke_reason = 'totp_factor_set_changed'/)

const pinAdmission =
  migration.match(
    /create function private\.authorize_google_ai_master_with_pin_v1[\s\S]*?\n\$\$;/,
  )?.[0] ?? ''
assert.ok(
  pinAdmission.indexOf('replay_or_reuse_google_ai_master_v1') <
    pinAdmission.indexOf('google_ai_master_admission_enabled') &&
    pinAdmission.indexOf('consume_admin_ai_pin_attempt_v1') <
      pinAdmission.indexOf('apply_google_ai_master_admission_v1'),
  'PIN replay precedes the gate and PIN proof is consumed in the master transaction',
)
assert.match(pinAdmission, /target_request_id[\s\S]*target_request_id/)

const browserAdmission =
  migration.match(
    /create function private\.complete_google_ai_master_browser_admission_v1[\s\S]*?\n\$\$;/,
  )?.[0] ?? ''
assert.ok(
  browserAdmission.indexOf('replay_or_reuse_google_ai_master_v1') <
    browserAdmission.indexOf('google_ai_master_admission_enabled') &&
    browserAdmission.indexOf('challenge_snapshot') <
      browserAdmission.indexOf('complete_admin_ai_browser_assertion_v1') &&
    browserAdmission.indexOf('complete_admin_ai_browser_assertion_v1') <
      browserAdmission.indexOf('apply_google_ai_master_admission_v1'),
  'browser replay/binding/proof/master order is atomic',
)
assert.match(
  browserAdmission,
  /if not target_signature_verified[\s\S]*return null;[\s\S]*raise exception 'browser proof binding changed during admission'/,
)

const applyAdmission =
  migration.match(
    /create function private\.apply_google_ai_master_admission_v1[\s\S]*?\n\$\$;/,
  )?.[0] ?? ''
assert.match(applyAdmission, /target_intent_digest is null/)
assert.match(applyAdmission, /target_unlock_method is null[\s\S]*not in/)
assert.match(
  applyAdmission,
  /target_pin_attempt_request_id is distinct from target_request_id/,
)
assert.match(
  applyAdmission,
  /from private\.admin_ai_unlock_runtime_gate as gate[\s\S]*for share[\s\S]*gate_row\.ai_unlock_enabled[\s\S]*gate_row\.google_ai_master_admission_enabled[\s\S]*target_unlock_method = 'remembered_browser'[\s\S]*gate_row\.remembered_browser_enabled/,
  'final apply locks and rechecks the AI, C1 and remembered-browser gates together',
)
assert.match(
  applyAdmission,
  /pre-C1 AI master cannot be converted by C1[\s\S]*admin_ai_master_admission_receipts/,
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
  assert.match(applyAdmission, new RegExp(`\\b${column}\\b`))
}
assert.ok(
  applyAdmission.indexOf(
    'insert into private.admin_ai_master_admission_receipts',
  ) < applyAdmission.indexOf("'accepted', true"),
)

assert.match(
  migration,
  /admin_ai_master_control_receipts[\s\S]*Exact replay intentionally returns the current state of the recorded master row/,
)
assert.match(
  migration,
  /admin_ai_master_reuse_receipts[\s\S]*can never create or reactivate authority/,
)
const replayOrReuse =
  migration.match(
    /create function private\.replay_or_reuse_google_ai_master_v1[\s\S]*?\n\$\$;/,
  )?.[0] ?? ''
assert.ok(
  replayOrReuse.indexOf('from private.admin_ai_master_admission_receipts') <
    replayOrReuse.indexOf('from private.admin_ai_master_reuse_receipts') &&
    replayOrReuse.indexOf('from private.admin_ai_master_reuse_receipts') <
      replayOrReuse.indexOf(
        'insert into private.admin_ai_master_reuse_receipts',
      ),
  'exact admission/reuse observations precede new proof-free reuse recording',
)
assert.match(replayOrReuse, /reuse_replayed[\s\S]*return null/)
assert.match(migration, /control_action <> 'downgrade'[\s\S]*binding mismatch/)
assert.match(migration, /control_action <> 'revoke'[\s\S]*binding mismatch/)
assert.match(migration, /pre-C1 AI master cannot be converted by C1/)
assert.match(migration, /google_master_requires_c2/)
assert.match(migration, /google_master_child_grant_deferred_to_c2/)
assert.match(migration, /C1 Google AI master child authority is deferred to C2/)
assert.match(
  migration,
  /admin_lecture_ownerships[\s\S]*google_master_requires_c2[\s\S]*authorize_ai_master_pre_c1/,
)
assert.match(
  migration,
  /admin_lecture_ownerships[\s\S]*google_master_child_grant_deferred_to_c2[\s\S]*issue_ai_billing_grant_from_master_pre_c1/,
)
assert.equal(
  (migration.match(/C1 owned lecture child authority is deferred to C2/g) ?? [])
    .length,
  2,
  'owned lectures are fenced on both direct grant insert and consume',
)

const publicFacades = [
  'create_owned_admin_lecture_v1',
  'replay_google_ai_master_admission_v1',
  'authorize_google_ai_master_with_pin_v1',
  'complete_google_ai_master_browser_admission_v1',
  'get_google_ai_master_status_v1',
  'downgrade_google_ai_master_v1',
  'revoke_google_ai_master_v1',
  'admin_authorize_ai_master',
  'admin_issue_ai_billing_grant_from_master',
]
for (const name of publicFacades) {
  const facade =
    migration.match(
      new RegExp(
        `create(?: or replace)? function public\\.${name}[\\s\\S]*?\\n\\$\\$;`,
      ),
    )?.[0] ?? ''
  assert.match(facade, /security definer/)
  assert.match(facade, /set search_path = ''/)
  assert.match(
    migration,
    new RegExp(
      `revoke all on function public\\.${name}[\\s\\S]*?from public, anon, authenticated;`,
    ),
  )
  assert.match(
    migration,
    new RegExp(
      `grant execute on function public\\.${name}[\\s\\S]*?to service_role;`,
    ),
  )
}
const privateGrantNames = [
  ...migration.matchAll(
    /grant execute on function private\.([a-z0-9_]+)\s*\(/g,
  ),
].map((match) => match[1])
assert.deepEqual(
  privateGrantNames,
  ['get_admin_ai_unlock_runtime_gate_v1'],
  'only the pre-existing B2 runtime-gate getter keeps its service-role grant',
)
const createdPrivateFunctions = [
  ...migration.matchAll(
    /create(?: or replace)? function private\.([a-z0-9_]+)\s*\(/g,
  ),
].map((match) => match[1])
const revokedPrivateFunctions = [
  ...migration.matchAll(/revoke all on function private\.([a-z0-9_]+)\s*\(/g),
].map((match) => match[1])
for (const name of createdPrivateFunctions) {
  assert.ok(
    revokedPrivateFunctions.includes(name),
    `private C1 function must be revoked from all runtime roles: ${name}`,
  )
}
for (const renamed of [
  'authorize_ai_master_pre_c1',
  'issue_ai_billing_grant_from_master_pre_c1',
]) {
  assert.ok(revokedPrivateFunctions.includes(renamed))
}
assert.match(pgTap, /all nine C1 public facades are owned by postgres/)
assert.match(pgTap, /all nine C1 public facades fix an empty search_path/)
assert.match(pgTap, /only service_role can execute all nine C1 public facades/)
assert.match(
  pgTap,
  /private C1 functions remain non-executable by service_role/,
)
assert.deepEqual(
  directPrivateReadsAsServiceRole(`${pgTap}\n${runtimePgTap}`),
  [],
  'C1 pgTAP must not grant service_role a direct private-table read path',
)
assert.match(pgTap, /every C1 evidence foreign key has a full leading index/)
assert.doesNotMatch(pgTap, /SELECT like\(/)
assert.match(pgTap, /SELECT alike\(/)
assert.equal(
  (
    runtimePgTap.match(
      /C2 owned lecture child authority requires Google evidence/g,
    ) ?? []
  ).length,
  2,
  'runtime expectations follow the final C2 grant-evidence fence',
)
assert.match(
  migration,
  /create index admin_ai_master_admission_receipts_browser_idx\s+on private\.admin_ai_master_admission_receipts \(browser_credential_id\);/,
)
assert.match(
  migration,
  /create index admin_ai_master_control_receipts_master_idx\s+on private\.admin_ai_master_control_receipts \(master_authorization_id\);/,
)
assert.match(pgTap, /existing lectures receive no inferred ownership/)
assert.match(
  pgTap,
  /owned lecture digest is invariant across TimeZone settings/,
)
assert.match(runtimePgTap, /gate-OFF rejects a new owned lecture/)
assert.match(runtimePgTap, /PIN master and immutable receipt commit together/)
assert.match(
  runtimePgTap,
  /failed policy rolls PIN proof and master receipt back together/,
)
assert.match(
  runtimePgTap,
  /preissued direct grant cannot cross a concurrent C1 ownership boundary/,
)
assert.match(
  runtimePgTap,
  /false browser signature denial commits but creates no master receipt/,
)
assert.match(
  runtimePgTap,
  /browser challenge consumption rolls back when master admission fails/,
)
assert.match(
  runtimePgTap,
  /browser assertion, master, and immutable receipt commit atomically/,
)
assert.match(
  runtimePgTap,
  /remembered-browser gate OFF rejects final admission/,
)
assert.match(
  runtimePgTap,
  /remembered-browser gate change rolls proof and master back together/,
)
assert.match(
  runtimePgTap,
  /stale proof-free PIN request returns its recorded terminal master/,
)
assert.match(
  runtimePgTap,
  /stale proof-free browser request returns its recorded terminal master/,
)
assert.match(
  runtimePgTap,
  /stale reuse retries cannot resurrect revoked authority/,
)
assert.match(
  runtimePgTap,
  /membership AI-access loss drains a C1 browser master/,
)
assert.match(runtimePgTap, /B2 policy authority drain revokes a C1 master/)
assert.match(runtimePgTap, /B2 factor authority drain revokes a C1 master/)
assert.match(
  runtimePgTap,
  /Admin session revocation drains the final C1 master/,
)

for (const action of [
  'authorizeMasterWithPin',
  'completeBrowserMasterAdmission',
  'masterStatus',
  'downgradeMaster',
  'revokeMaster',
]) {
  assert.match(edge, new RegExp(`['"]${action}['"]`))
}
assert.match(edge, /PHASE730_C1_GOOGLE_AI_MASTER_ENABLED/)
assert.match(edge, /dormantAuthority: true/)
assert.match(edge, /providerAuthorityIssued: false/)
assert.doesNotMatch(
  edge,
  /admin_issue_ai_billing_grant_from_master|providerRequest/,
)
const pinHandler =
  edge.match(
    /if \(action === 'authorizeMasterWithPin'\)[\s\S]*?\n  }\n\n  if \(action === 'completeBrowserMasterAdmission'\)/,
  )?.[0] ?? ''
assert.ok(
  pinHandler.indexOf('replay_google_ai_master_admission_v1') <
    pinHandler.indexOf('ADMIN_AI_NETWORK_PEPPER'),
  'PIN exact replay precedes source gate and secret access',
)
const browserHandler =
  edge.match(
    /if \(action === 'completeBrowserMasterAdmission'\)[\s\S]*?\n  }\n\n  if \(action === 'profile'\)/,
  )?.[0] ?? ''
assert.ok(
  browserHandler.indexOf('replay_google_ai_master_admission_v1') <
    browserHandler.indexOf('verifyP256P1363Signature'),
  'browser exact replay precedes proof expiry and verification',
)
assert.match(
  edge,
  /action === 'masterStatus'[\s\S]*get_google_ai_master_status_v1/,
)
assert.match(
  edge,
  /action === 'downgradeMaster'[\s\S]*downgrade_google_ai_master_v1/,
)
assert.match(edge, /action === 'revokeMaster'[\s\S]*revoke_google_ai_master_v1/)

for (const symbol of [
  'authorizeGoogleAiMasterWithPin',
  'completeRememberedBrowserMasterAdmission',
  'getGoogleAiMasterStatus',
  'downgradeGoogleAiMaster',
  'revokeGoogleAiMaster',
]) {
  assert.match(client, new RegExp(`export async function ${symbol}`))
}
for (const rpc of [
  'authorize_google_ai_master_with_pin_v1',
  'complete_google_ai_master_browser_admission_v1',
  'create_owned_admin_lecture_v1',
  'downgrade_google_ai_master_v1',
  'get_google_ai_master_status_v1',
  'replay_google_ai_master_admission_v1',
  'revoke_google_ai_master_v1',
]) {
  assert.match(types, new RegExp(`\\b${rpc}:`))
}
const generatedFunctionsStart = types.indexOf('    Functions: {')
const generatedFunctionsEnd = types.indexOf(
  '    Enums: {',
  generatedFunctionsStart,
)
assert.ok(
  generatedFunctionsStart >= 0 &&
    generatedFunctionsEnd > generatedFunctionsStart,
)
const generatedFunctionNames = Array.from(
  types
    .slice(generatedFunctionsStart, generatedFunctionsEnd)
    .matchAll(/^      ([A-Za-z0-9_]+):/gm),
  (match) => match[1],
)
assert.deepEqual(
  generatedFunctionNames,
  [...generatedFunctionNames].sort(),
  'generated public function types must stay in generator lexicographic order',
)

assert.match(
  upgradeRunner,
  /--version'[\s\S]*20260810113000[\s\S]*phase7-30c1-b22b-head-upgrade-probe\.sql[\s\S]*phase7-30c1-b22b-head-upgrade-probe-test\.sql/,
)
assert.match(upgradeFixture, /pre-C1 populated lecture/)
assert.match(
  upgradeFixture,
  /insert into public\.ai_billing_grants[\s\S]*master_authorization_id/,
)
assert.match(
  upgradeProbe,
  /existing lecture remains unowned[\s\S]*no inferred admission, reuse or control receipts[\s\S]*C1 admission gate remains default OFF[\s\S]*pre-C1 active master and child grant are preserved without inferred C1 provenance/,
)
assert.match(docs, /C2 HOLD/)
assert.match(docs, /no inferred backfill/i)
assert.match(docs, /immutable request observation/i)
assert.match(
  identityPlan,
  /C1 then\s+adds private optional-row lecture ownership and atomic PIN\/browser-proof to\s+dormant-master admission/,
)
assert.doesNotMatch(
  identityPlan,
  /does not implement the all-Admin verifier, lecture ownership, atomic proof-to-master/,
)
assert.match(
  readme,
  /C1はprivate optional-row lecture ownershipとPIN\/browser proofからdormant masterまでのatomic admissionをsource実装/,
)
assert.doesNotMatch(
  readme,
  /lecture ownership、proofからmasterまでのatomic admission、AI Passkey、実Google OAuth、Hosted\/Human evidenceはC以降で未実装/,
)
assert.match(
  localEdge,
  /sourceOffC1Admission[\s\S]*authorizeMasterWithPin[\s\S]*503/,
)
assert.match(workflow, /B2\.2b\/C1 source-OFF checks/)
assert.equal(
  packageJson.scripts['test:phase7-30c1-static'],
  'node scripts/test-phase7-30c1-static.mjs',
)
assert.match(nonlive, /'test:phase7-30c1-static'/)

console.log('Phase 7.30 C1 static contract passed.')
