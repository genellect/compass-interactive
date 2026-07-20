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

for (const requiredText of [
  `Application version: \`${packageJson.version}\``,
  'Phase 6.7',
  'Phase 7 Production Gate',
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

for (const phase of ['6.7', '6.8', '6.9', '7.1', '7.2', '8.1', '8.2', '9']) {
  assert.ok(
    roadmap.includes(`Phase ${phase}`),
    `Roadmap missing Phase ${phase}`,
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
