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
const changelog = read('docs/CHANGELOG.md')
const contestPlan = read(
  'docs/PHASE7_31_CONTEST_PUBLICATION_AND_COMMERCIAL_READINESS.md',
)
const googleAdminPlan = read('docs/PHASE7_30_GOOGLE_ADMIN_IDENTITY_PLAN.md')
const docsIndex = read('docs/README.md')
const agentRouting = read('docs/AGENT_EXECUTION_ROUTING.md')
const gateRouting = read('docs/GATE_ROUTING.md')
const runbook = read('docs/RUNBOOK_INDEX.md')
const agentsContract = read('AGENTS.md')

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
  'server-recorded recent step-up',
  'limited identity-migration release',
  'Five failed verifications in a rolling 15-minute window',
  'non-extractable WebCrypto private key',
  'bounded TLS request',
  'circuit breaker fails closed',
  'public-key fingerprint',
  'full-browser-profile copying',
  'caption-scope escalation',
  'No hardware/device-binding claim',
  '`ADMIN_PIN` is the legacy shared Admin-login path',
  '`BILLING_PIN` is the legacy paid-cost path',
  'personal four-digit `AI PIN` is the normal low-entropy intent factor',
  'all_except_captions',
  'all_including_captions',
  'AI Passkey is not part of the initial B2 implementation',
]) {
  assert.ok(
    googleAdminPlan.includes(requiredText),
    `Google Admin contract missing: ${requiredText}`,
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
}

for (const heading of [
  '### 7.30A - asset, IAM and threat inventory',
  '### 7.30B - additive identity foundation',
  '### 7.30C - RBAC, ownership and all server authorization',
  '### 7.30D - Google, MFA and Admin-ledger UX',
  '### 7.30E - dual-read compatibility and full regression',
  '### 7.30F - Hosted/Human identity migration gate',
]) {
  assert.ok(
    roadmap.includes(heading),
    `Roadmap phase mapping missing: ${heading}`,
  )
}

for (const requiredText of [
  'PHASE7_30_GOOGLE_ADMIN_IDENTITY_PLAN.md',
  'PHASE7_31_CONTEST_PUBLICATION_AND_COMMERCIAL_READINESS.md',
  'Roadmap and an approved detailed domain contract disagree',
]) {
  assert.ok(
    docsIndex.includes(requiredText),
    `Documentation precedence missing: ${requiredText}`,
  )
}

for (const requiredText of [
  '7.30B additive identity and AI-unlock foundation',
  '7.30C RBAC and all server authorization',
  'mandatory TOTP before B2 adds AI PIN',
  'personal four-digit AI PIN',
  'remembered-browser proof',
  'escalation requires a new AI proof',
  '`ADMIN_PIN`, `BILLING_PIN` and personal `AI PIN`',
]) {
  assert.ok(
    agentRouting.includes(requiredText),
    `Agent routing contract missing: ${requiredText}`,
  )
}
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
