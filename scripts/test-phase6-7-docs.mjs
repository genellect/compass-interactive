import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))

const read = (relativePath) => readFileSync(resolve(root, relativePath), 'utf8')

const requiredDocuments = [
  'README.md',
  'PROJECT_GUIDE.md',
  'docs/architecture.md',
  'docs/SECURITY.md',
  'docs/data_policy.md',
  'docs/database_schema.md',
  'docs/CHANGELOG.md',
  'docs/ROADMAP.md',
  'docs/RUNBOOK_INDEX.md',
  'docs/CLOUD_CANONICALIZATION_GATE.md',
  'docs/AGENT_EXECUTION_ROUTING.md',
  'docs/PHASE7_29_POWERPOINT_PRESENTER_BRIDGE.md',
  'docs/PHASE7_29_CLOUD_RESCUE_AND_DORMANT_ROLLOUT.md',
  'docs/PHASE7_30_GOOGLE_ADMIN_IDENTITY_PLAN.md',
  'docs/PHASE7_30B2_AI_UNLOCK_FOUNDATION.md',
  'docs/PHASE7_30B22A_ADMIN_CONTROL_HARDENING.md',
  'docs/PHASE7_31_CONTEST_PUBLICATION_AND_COMMERCIAL_READINESS.md',
  'docs/PHASE6_7_DOCUMENTATION_BASELINE.md',
  'docs/PHASE6_7_LOCAL_GATE_2026-07-18.md',
  'docs/PHASE6_8_SECURITY_SESSIONS_TIMEOUTS.md',
  'docs/PHASE6_8_LOCAL_GATE_2026-07-18.md',
  'docs/PHASE6_9_MODULARIZATION_AND_CI.md',
  'docs/PHASE6_9_LOCAL_GATE_2026-07-19.md',
  'docs/PHASE7_1_CLASSROOM_UX_EXTENSIONS.md',
  'docs/PHASE7_1_LOCAL_GATE_2026-07-19.md',
  'docs/PHASE7_2_EVIDENCE_GROUNDED_ACADEMIC_ANSWERS.md',
  'docs/PHASE7_2_LOCAL_GATE_2026-07-20.md',
  'docs/PHASE7_2_HANDOFF_2026-07-20.md',
  'docs/CI_AND_BROWSER_E2E.md',
  'docs/supabase_setup.md',
  'docs/cloudflare_pages_deploy.md',
]

for (const document of requiredDocuments) {
  assert.ok(
    existsSync(resolve(root, document)),
    `Missing document: ${document}`,
  )
}

const packageJson = JSON.parse(read('package.json'))
const packageLock = JSON.parse(read('package-lock.json'))
assert.match(packageJson.version, /^\d+\.\d+\.\d+$/)
assert.equal(packageLock.version, packageJson.version)
assert.equal(packageLock.packages?.['']?.version, packageJson.version)

const readme = read('README.md')
const roadmap = read('docs/ROADMAP.md')
const architecture = read('docs/architecture.md')
const security = read('docs/SECURITY.md')
const dataPolicy = read('docs/data_policy.md')
const changelog = read('docs/CHANGELOG.md')
const contestPlan = read(
  'docs/PHASE7_31_CONTEST_PUBLICATION_AND_COMMERCIAL_READINESS.md',
)
const googleAdminPlan = read('docs/PHASE7_30_GOOGLE_ADMIN_IDENTITY_PLAN.md')
const adminAiUnlockRecord = read('docs/PHASE7_30B2_AI_UNLOCK_FOUNDATION.md')
const adminControlRecord = read(
  'docs/PHASE7_30B22A_ADMIN_CONTROL_HARDENING.md',
)
const docsIndex = read('docs/README.md')
const agentRouting = read('docs/AGENT_EXECUTION_ROUTING.md')
const gateRouting = read('docs/GATE_ROUTING.md')
const runbook = read('docs/RUNBOOK_INDEX.md')
const agentsContract = read('AGENTS.md')
const ciAndBrowser = read('docs/CI_AND_BROWSER_E2E.md')
const databaseSchema = read('docs/database_schema.md')

for (const requiredText of [
  `Application version: \`${packageJson.version}\``,
  'Phase 6.7',
  'Phase 7.33',
  'docs/ROADMAP.md',
  'docs/RUNBOOK_INDEX.md',
  'test:phase6-7-docs',
]) {
  assert.ok(readme.includes(requiredText), `README missing: ${requiredText}`)
}

assert.match(
  readme,
  /Phase 0 through Phase (?:6\.9|7\.1|7\.2)/,
  'README must state the implemented Phase 0 baseline through the current release',
)

assert.doesNotMatch(
  readme,
  /Phase 0 establishes the application foundation only/i,
)
assert.doesNotMatch(readme, /The app uses `src\/lib\/mockData\.ts` only/i)
assert.doesNotMatch(architecture, /There is no backend, API server, database/i)

for (const phase of [
  '6.7',
  '6.8',
  '6.9',
  '7.1',
  '7.2',
  '7.29',
  '7.30',
  '7.31',
  '7.32',
  '7.33',
  '8.1',
  '8.2',
  '9',
]) {
  assert.ok(
    roadmap.includes(`Phase ${phase}`),
    `Roadmap missing Phase ${phase}`,
  )
}
for (const requiredText of [
  'role=instructor',
  'can_use_ai=true',
  'TOTP',
  'isolated real contest environment',
  'Phase 7.33',
  '本人専用4桁AI PIN',
  'remembered-browser proof',
  'lecture_ai_master_authorizations',
  'owner介入や`BILLING_PIN`は',
  'Private R2 bucket',
  'prefix や namespace だけをセキュリティ境界として使うことは禁止',
  '短命一回限りnonce',
  'hardware/device bindingを主張しない',
  '`all_except_captions`から`all_including_captions`',
  'fresh TOTPは要求しない',
  '30分idleや周期的TOTP promptが発生しない',
  '`ADMIN_PIN`/`BILLING_PIN`完全撤去',
  '`講義資料`',
  'R2 bucket、binding、credential、namespace',
]) {
  assert.ok(
    contestPlan.includes(requiredText),
    `Contest/publication contract missing: ${requiredText}`,
  )
}
assert.doesNotMatch(
  contestPlan,
  /Private R2 bucket または/,
  'Contest contract must require a dedicated R2 bucket, not prefix-only isolation',
)

for (const requiredText of [
  'private.admin_ai_policies',
  'private.admin_ai_unlock_factors',
  'private.admin_ai_unlock_rate_limits',
  'private.admin_ai_browser_credentials',
  'private.admin_ai_browser_enrollment_nonces',
  'public.lecture_ai_master_authorizations',
  'provider_token',
  'provider_refresh_token',
  'TOTP AMR timestamp inside the five-minute boundary',
  'limited identity-migration release',
  'Five failed verifications in a rolling 15-minute window',
  'non-extractable WebCrypto private key',
  'bounded TLS request',
  'circuit breaker fails closed',
  'public-key fingerprint',
  'full-browser-profile copying',
  'caption-scope escalation',
  'No hardware/device-binding claim',
  '`auth.sessions.created_at + 8 hours`',
  'Phase 7.30B2 now implements the default-OFF',
  'B2.2a additionally',
  'still has to complete its unified verifier',
  'no email MFA',
  'Role changes are enforced live',
  '`ADMIN_PIN` is removed after the Phase 7.30C authorization migration',
  'immutable Google-only application revision',
  'all_except_captions',
  'all_including_captions',
  'AI Passkey is not part of the initial B2',
]) {
  assert.ok(
    googleAdminPlan.includes(requiredText),
    `Google Admin contract missing: ${requiredText}`,
  )
}
assert.match(
  googleAdminPlan,
  /there is no 30-minute\s+inactivity expiry/,
  'Google Admin contract must remove the transitional B1 idle expiry in B2',
)
assert.match(docsIndex, /PHASE7_30B22A_ADMIN_CONTROL_HARDENING\.md/)
assert.match(
  adminControlRecord,
  /factor-history-free initial PIN enrollment can reuse the tracked fresh TOTP/,
)
assert.match(adminControlRecord, /canonical mutation[- ]intent/)
assert.match(
  adminControlRecord,
  /unverified challenged factor is accepted only for a `pending_mfa`\s+membership whose principal is unbound and whose current verified TOTP set is\s+empty/,
)
assert.match(
  adminControlRecord,
  /Adding, removing or replacing a factor\s+requires B2\.2b rare-control[\s\S]{0,80}remains\s+HOLD/,
)
assert.match(
  adminControlRecord,
  /`private\.admin_principals` therefore stores the authoritative\s+approved digest, version and factor count plus bounded approval provenance/,
)
assert.match(
  adminControlRecord,
  /migration never guesses or backfills either a\s+session digest or a principal approval/,
)
assert.match(
  adminControlRecord,
  /service-role\/operator RPC can adopt one exact DB-recomputed set only while its\s+own gate is ON and normal Google session issuance is OFF/,
)
for (const [name, document] of [
  ['Google Admin', googleAdminPlan],
  ['Runbook', runbook],
  ['Security', security],
  ['Roadmap', roadmap],
]) {
  assert.doesNotMatch(
    document,
    /B2 does not yet (?:implement|store|compare)[^\n]*factor|TOTP factor-set fingerprinting[^\n]*remain HOLD/,
    `${name} must not defer the implemented B2.2a factor-set binding`,
  )
}
assert.match(
  googleAdminPlan,
  /`BILLING_PIN` and its\s+compatibility RPC are removed after personal-AI-PIN E2E/,
  'Google Admin contract must remove BILLING_PIN and its RPC after personal AI PIN E2E',
)
assert.match(
  googleAdminPlan,
  /Normal\s+lecture operations, emergency stop,[\s\S]{0,180}never request this\s+five-minute step-up/,
  'Normal lecture and emergency-stop flows must not prompt for fresh TOTP',
)
assert.match(
  googleAdminPlan,
  /A five-minute server-recorded TOTP\s+step-up is used only for owner\/principal changes, role\/status changes, verified\s+TOTP factor-set changes, environment AI-policy changes, global revocation and\s+AI PIN factor enrollment\/rotation\/revoke\/reset/,
  'Fresh TOTP step-up must have the exact rare control-plane allowlist',
)
assert.match(
  googleAdminPlan,
  /New factor enrollment, rotation, revoke and reset are rare\s+factor-control changes and require the five-minute boundary/,
  'AI PIN enrollment, rotation, revoke and reset must use the rare five-minute boundary',
)
assert.match(
  googleAdminPlan,
  /Login-time\s+initial enrollment uses the already-fresh TOTP event without another prompt/,
  'Immediate post-login PIN enrollment must not add a second TOTP prompt',
)
assert.match(
  googleAdminPlan,
  /Once an actor\/session\/scope-bound request ID\s+commits, an exact canonical-intent retry returns the committed result after the\s+window; the same request ID with changed PIN or policy material is rejected/,
  'Committed rare-mutation replay must require the exact canonical intent',
)
assert.match(
  googleAdminPlan,
  /B2\.2a additionally\s+requires a new login on a verified TOTP factor-set change/,
  'B2.2a must record factor-set session invalidation while C retains all-endpoint integration',
)

for (const [name, document] of [
  ['AGENTS', agentsContract],
  ['README', readme],
  ['Roadmap', roadmap],
  ['Agent routing', agentRouting],
  ['Runbook', runbook],
  ['Security', security],
  ['Architecture', architecture],
  ['Data policy', dataPolicy],
  ['Google Admin', googleAdminPlan],
  ['Contest plan', contestPlan],
]) {
  assert.match(
    document,
    /AI PIN factor(?:の)?\s*enrollment\/rotation\/revoke\/reset/,
    `${name} must route rare AI PIN factor mutations through the five-minute boundary`,
  )
}

for (const [requiredPattern, label] of [
  [
    /Supabase Auth\s+exclusively manages persistent factor material/,
    'Supabase Auth factor custody',
  ],
  [
    /application logs and browser persistence store no TOTP secret/,
    'no application persistence',
  ],
  [
    /secret\/QR only ephemerally for display, scan and verification/,
    'ephemeral client enrollment material',
  ],
]) {
  assert.match(
    dataPolicy,
    requiredPattern,
    `Data policy missing Supabase TOTP custody boundary: ${label}`,
  )
}

for (const [name, document] of [
  ['AGENTS', agentsContract],
  ['README', readme],
  ['Roadmap', roadmap],
  ['Agent routing', agentRouting],
  ['Gate routing', gateRouting],
  ['Runbook', runbook],
  ['Google Admin', googleAdminPlan],
  ['contest', contestPlan],
]) {
  assert.doesNotMatch(
    document,
    /admin_cost_intent_grants|owner-issued scoped cost-intent grant|BILLING_PIN remains the root cost-intent factor/,
    `${name} future contract must not retain per-lecture owner PIN delegation`,
  )
  assert.doesNotMatch(
    document,
    /remembered-device|private\.admin_ai_trusted_devices/,
    `${name} must use the browser-profile-bound credential contract`,
  )
  assert.doesNotMatch(
    document,
    /no raw PIN appears in (?:storage or )?network/i,
    `${name} must allow only the bounded TLS verification body, not promise zero network transit`,
  )
  assert.doesNotMatch(
    document,
    /caption-scope escalation requires a new AI-unlock proof plus a still-fresh|escalation requires a new AI proof and recent TOTP|proof-plus-recent-AAL2 caption-scope/i,
    `${name} must not require a fresh TOTP prompt for ordinary AI scope escalation`,
  )
  assert.doesNotMatch(
    document,
    /`BILLING_PIN` is only a default-OFF|`BILLING_PIN` is the legacy paid-cost path/i,
    `${name} must not retain BILLING_PIN as a Production rollback path`,
  )
}

for (const heading of [
  '### 7.30A - asset, IAM and threat inventory',
  '### 7.30B - additive identity foundation',
  '### 7.30C - RBAC, ownership and all server authorization',
  '### 7.30D - Google, MFA and Admin-ledger UX',
  '### 7.30E - Google-only cutover and full regression',
  '### 7.30F - Hosted/Human identity migration gate',
]) {
  assert.ok(
    roadmap.includes(heading),
    `Roadmap phase mapping missing: ${heading}`,
  )
}

for (const requiredText of [
  'PHASE7_30_GOOGLE_ADMIN_IDENTITY_PLAN.md',
  'PHASE7_30B2_AI_UNLOCK_FOUNDATION.md',
  'PHASE7_31_CONTEST_PUBLICATION_AND_COMMERCIAL_READINESS.md',
  'Roadmap and an approved detailed domain contract disagree',
]) {
  assert.ok(
    docsIndex.includes(requiredText),
    `Documentation precedence missing: ${requiredText}`,
  )
}
assert.doesNotMatch(
  adminAiUnlockRecord,
  /rotation\/revocation drains/,
  'B2 record must not claim the deferred explicit factor-revoke drain API',
)

for (const requiredText of [
  '7.30B additive identity and AI-unlock foundation',
  '7.30C RBAC and all server authorization',
  'B2 now has a default-OFF database source foundation',
  'personal four-digit AI PIN',
  'remembered-browser proof',
  'caption-scope/cost escalation requires a new AI proof',
  'the C migration and `BILLING_PIN` after',
]) {
  assert.ok(
    agentRouting.includes(requiredText),
    `Agent routing contract missing: ${requiredText}`,
  )
}

for (const requiredText of [
  'Status: Implemented, verification pending',
  'database/source checkpoint is commit `9f1e0ec`',
  'Exact-head CI still has to prove',
  'nine RLS-enabled private tables',
  'bcrypt cost-12 verifier',
  'four concurrent attempts per environment',
  'two per coarse-network bucket',
  'RFC 7638 canonical thumbprint',
  'Actual browser non-extractable `CryptoKey`',
  'B2 does not yet issue a new lecture master',
  'explicit AI PIN factor revoke/reset transition APIs',
  'Hosted Supabase, real Google OAuth, Human MFA/browser evidence',
]) {
  assert.ok(
    adminAiUnlockRecord.includes(requiredText),
    `B2 implementation record missing: ${requiredText}`,
  )
}

for (const table of [
  'admin_ai_unlock_runtime_gate',
  'admin_ai_policies',
  'admin_ai_unlock_factors',
  'admin_ai_unlock_rate_limits',
  'admin_ai_unlock_attempt_receipts',
  'admin_ai_pin_discovery_receipts',
  'admin_ai_browser_enrollment_nonces',
  'admin_ai_browser_credentials',
  'admin_ai_browser_assertion_challenges',
]) {
  assert.ok(
    adminAiUnlockRecord.includes(table),
    `B2 implementation record missing table: ${table}`,
  )
  assert.ok(
    databaseSchema.includes(table),
    `Database responsibility map missing B2 table: ${table}`,
  )
}

for (const [name, document] of [
  ['README', readme],
  ['CI contract', ciAndBrowser],
  ['Gate routing', gateRouting],
]) {
  assert.match(
    document,
    /67 non-live(?: Phase 0-7\.30 test)? groups|`test:ci:nonlive` \(67 groups\)/,
    `${name} must record the 67-group non-live suite`,
  )
}
assert.match(
  agentRouting,
  /`ADMIN_PIN` is removed after\s+the C migration and `BILLING_PIN` after\s+personal-AI-PIN E2E/,
  'Agent routing must remove both shared PIN paths before Production',
)
for (const gate of ['G0', 'G1', 'G2', 'G3', 'G4', 'G5', 'G6', 'G7']) {
  assert.ok(roadmap.includes(gate), `Roadmap missing ${gate}`)
}
for (const text of [
  'auth.uid()',
  'application-level Admin PIN',
  'CSP',
  'resume token',
  'WebKit',
]) {
  assert.ok(security.includes(text), `Security contract missing: ${text}`)
}
for (const commit of [
  '9e213bc',
  'e0531d2',
  'd8a5354',
  '4b6744b',
  '5bcdd1b',
  'd211079',
  'f7cecb2',
  '74fa86d',
  'cc1ae93',
]) {
  assert.ok(changelog.includes(commit), `Changelog missing landmark: ${commit}`)
}

const npmScriptReferences = [
  ...readme.matchAll(/\bnpm run ([a-zA-Z0-9:._-]+)/g),
].map((match) => match[1])
for (const scriptName of npmScriptReferences) {
  assert.equal(
    typeof packageJson.scripts?.[scriptName],
    'string',
    `README references missing npm script: ${scriptName}`,
  )
}

const routeEntrypointScript = read('scripts/create-route-entrypoints.mjs')
const routeMatches = [...routeEntrypointScript.matchAll(/^\s*'([^']+)',?$/gm)]
const routeEntrypoints = routeMatches.map((match) => match[1])
assert.ok(
  routeEntrypoints.length >= 7,
  'Route entrypoint inventory is incomplete',
)
for (const route of routeEntrypoints) {
  assert.ok(readme.includes(`/${route}`), `README missing route: /${route}`)
}

const featureFlagSource = read('src/lib/featureFlags.ts')
const exampleEnvironment = read('.env.local.example')
const featureFlags = [
  ...new Set(featureFlagSource.match(/VITE_PHASE[A-Z0-9_]*/g) ?? []),
]
assert.ok(featureFlags.length >= 8, 'Feature flag inventory is incomplete')
for (const featureFlag of featureFlags) {
  assert.ok(readme.includes(featureFlag), `README missing flag: ${featureFlag}`)
  assert.ok(
    exampleEnvironment.includes(`${featureFlag}=`),
    `.env.local.example missing flag: ${featureFlag}`,
  )
}

const canonicalDocuments = requiredDocuments
const secretPatterns = [
  /C:\\Users\\/i,
  /sk-proj-[a-zA-Z0-9_-]+/,
  /pfvedtqccblecuyjlfqh/,
  /COMPASS_R2_SECRET_ACCESS_KEY=\S+/,
  /OPENAI_API_KEY=\S+/,
  /SUPABASE_SERVICE_ROLE_KEY=\S+/,
]
for (const document of canonicalDocuments) {
  const content = read(document)
  for (const pattern of secretPatterns) {
    assert.doesNotMatch(content, pattern, `${document} contains forbidden data`)
  }
}

const markdownDocuments = requiredDocuments.filter((document) =>
  document.endsWith('.md'),
)
for (const document of markdownDocuments) {
  const content = read(document)
  const linkTargets = [...content.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)].map(
    (match) => match[1],
  )
  for (const target of linkTargets) {
    if (/^(?:https?:|mailto:|#)/i.test(target)) continue
    const withoutAnchor = target.split('#', 1)[0]
    if (!withoutAnchor) continue
    const resolvedTarget = resolve(
      dirname(resolve(root, document)),
      withoutAnchor,
    )
    assert.ok(
      existsSync(resolvedTarget),
      `${document} contains a broken relative link: ${target}`,
    )
  }
}

console.log(
  `Phase 6.7 documentation baseline passed: ${requiredDocuments.length} documents, ` +
    `${npmScriptReferences.length} npm references, ${routeEntrypoints.length} routes, ` +
    `${featureFlags.length} feature flags.`,
)
