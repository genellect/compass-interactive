import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../..', import.meta.url))
const npmCli = process.env.npm_execpath
if (!npmCli) {
  throw new Error('Run this suite through npm so npm_execpath is available.')
}
const safeTestScripts = [
  'test:demo',
  'test:live-state',
  'test:phase1-load',
  'test:phase2-lifecycle',
  'test:phase2-load',
  'test:phase3-publisher',
  'test:phase3-worker',
  'test:phase3-static',
  'test:phase3-load',
  'test:phase4-caption',
  'test:phase4-edge',
  'test:phase4-static',
  'test:phase4-load',
  'test:phase4-1-static',
  'test:phase4-1-load',
  'test:phase5-edge',
  'test:phase5-static',
  'test:phase5-load',
  'test:phase6-edge',
  'test:phase6-static',
  'test:phase6-load',
  'test:phase6-5-nicknames',
  'test:phase6-5-static',
  'test:phase6-5-load',
  'test:phase6-6-archive-edge',
  'test:phase6-6-archive-session',
  'test:phase6-6-digest',
  'test:phase6-6-static',
  'test:phase6-6-load',
  'test:phase6-7-docs',
  'test:phase6-8-static',
  'test:phase6-9-static',
  'test:phase6-9-load',
  'test:phase7-1-edge',
  'test:phase7-1-static',
  'test:phase7-1-load',
  'test:phase7-2-edge',
  'test:phase7-2-static',
  'test:phase7-2-load',
  'test:phase7-2-quality',
  'test:phase7-25-edge',
  'test:phase7-25-static',
  'test:phase7-25-load',
  'test:phase7-26-browser-pdf',
  'test:phase7-26-edge',
  'test:phase7-26-static',
  'test:phase7-26-load',
  'test:production-gate:static',
  'test:production-env',
  'test:admin-lifecycle',
  'test:pdf-sync',
  'test:supabase:static',
]

const workflow = readFileSync(
  new URL('../../.github/workflows/ci.yml', import.meta.url),
  'utf8',
)
for (const forbiddenCommand of [
  'test:phase5-openai-live',
  'test:phase6-openai-live',
  'test-pdf-sync-hosted',
  'supabase db push',
  'supabase link',
  'wrangler deploy',
  'deploy:cloudflare',
]) {
  assert.doesNotMatch(
    workflow,
    new RegExp(forbiddenCommand.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
    `CI must not contain production/live command: ${forbiddenCommand}`,
  )
}

const packageJson = JSON.parse(
  readFileSync(new URL('../../package.json', import.meta.url), 'utf8'),
)
for (const scriptName of safeTestScripts) {
  assert.equal(
    typeof packageJson.scripts?.[scriptName],
    'string',
    `Missing CI test script: ${scriptName}`,
  )
}

for (const scriptName of safeTestScripts) {
  const startedAt = Date.now()
  console.log(`\n[CI non-live] ${scriptName}`)
  const result = spawnSync(process.execPath, [npmCli, 'run', scriptName], {
    cwd: root,
    env: process.env,
    stdio: 'inherit',
  })
  if (result.error) throw result.error
  if (result.status !== 0) {
    process.exit(result.status ?? 1)
  }
  console.log(
    `[CI non-live] ${scriptName} passed in ${Date.now() - startedAt}ms`,
  )
}

console.log(`\n${safeTestScripts.length} non-live test groups passed.`)
