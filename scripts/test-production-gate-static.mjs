import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const read = (...parts) => readFileSync(join(root, ...parts), 'utf8')

const packageJson = read('package.json')
const supabaseConfig = read('supabase', 'config.toml')
const migration = read(
  'supabase',
  'migrations',
  '20260716073719_production_gate_hardening.sql',
)
const corsSource = read('supabase', 'functions', '_shared', 'cors.ts')
const responseSource = read('supabase', 'functions', '_shared', 'responses.ts')
const adminTokenSource = read(
  'supabase',
  'functions',
  '_shared',
  'adminToken.ts',
)
const adminRepository = read(
  'src',
  'repositories',
  'supabaseAdminRepository.ts',
)
const workerConfig = read(
  'cloudflare',
  'asset-worker',
  'wrangler.production.jsonc',
)
const headers = read('public', '_headers')
const html = read('index.html')
const envExample = read('.env.local.example')

assert.doesNotMatch(packageJson, /wrangler@latest/)
assert.match(packageJson, /production:check[\s\S]*?wrangler pages deploy dist/)
assert.match(supabaseConfig, /\[api\]\s+enabled = true/)
assert.match(supabaseConfig, /\[local_smtp\]/)
assert.doesNotMatch(supabaseConfig, /\[inbucket\]/)
assert.match(supabaseConfig, /site_url = "http:\/\/127\.0\.0\.1:5173"/)

for (const indexName of [
  'material_ai_operation_contexts_source_document_idx',
  'material_ai_operation_contexts_analysis_idx',
  'ai_poll_proposals_source_document_idx',
  'lecture_summary_windows_run_idx',
  'lecture_ai_summary_revisions_supersedes_idx',
  'summary_publications_active_revision_idx',
]) {
  assert.match(migration, new RegExp(`create index ${indexName}`))
}
assert.match(migration, /create extension if not exists pg_cron/)
assert.match(migration, /compass-phase2-lifecycle-minute/)
assert.match(migration, /compass-cron-history-weekly/)
assert.match(migration, /interval '30 days'/)

assert.match(corsSource, /COMPASS_EDGE_ALLOWED_ORIGINS/)
assert.match(corsSource, /Origin is not allowed/)
assert.doesNotMatch(corsSource, /Access-Control-Allow-Origin': '\*'/)
assert.match(responseSource, /createJsonResponse\(request: Request\)/)
assert.match(responseSource, /Cache-Control', 'no-store'/)
assert.match(adminTokenSource, /Deno\.env\.get\('ADMIN_SESSION_SECRET'\)/)
assert.doesNotMatch(
  adminTokenSource,
  /ADMIN_SESSION_SECRET'\)\s*\?\?\s*adminPin/,
)
assert.match(adminTokenSource, /byteLength < 32/)
assert.match(
  adminRepository,
  /await ensureAnonymousAuthSession\(\)[\s\S]*?verify-admin-pin/,
)

assert.match(workerConfig, /"crons": \["\*\/30 \* \* \* \*"\]/)
assert.match(workerConfig, /"bucket_name": "compass-private-pdf-assets"/)
assert.doesNotMatch(workerConfig, /-local/)
assert.match(workerConfig, /https:\/\/compass-interactive\.pages\.dev/)
assert.match(headers, /X-Content-Type-Options: nosniff/)
assert.match(headers, /X-Frame-Options: DENY/)
assert.match(headers, /Permissions-Policy:[^\n]*microphone=\(self\)/)
assert.match(html, /<html lang="ja">/)
assert.match(html, /<title>COMPASS Interactive<\/title>/)
assert.match(envExample, /^ADMIN_SESSION_SECRET=$/m)
assert.match(envExample, /^COMPASS_EDGE_ALLOWED_ORIGINS=/m)

const originalDeno = globalThis.Deno
globalThis.Deno = {
  env: {
    get(name) {
      return name === 'COMPASS_EDGE_ALLOWED_ORIGINS'
        ? 'https://compass.example'
        : undefined
    },
  },
}
const { handleCors } = await import('../supabase/functions/_shared/cors.ts')
const { createJsonResponse } =
  await import('../supabase/functions/_shared/responses.ts')

const hostileRequest = new Request('https://edge.example/function', {
  headers: { Origin: 'https://hostile.example' },
  method: 'POST',
})
assert.equal(handleCors(hostileRequest)?.status, 403)

const preflightRequest = new Request('https://edge.example/function', {
  headers: { Origin: 'https://compass.example' },
  method: 'OPTIONS',
})
const preflight = handleCors(preflightRequest)
assert.equal(preflight?.status, 200)
assert.equal(
  preflight?.headers.get('Access-Control-Allow-Origin'),
  'https://compass.example',
)

const response = createJsonResponse(
  new Request('https://edge.example/function', {
    headers: { Origin: 'https://compass.example' },
  }),
)({ ok: true })
assert.equal(
  response.headers.get('Access-Control-Allow-Origin'),
  'https://compass.example',
)
assert.equal(response.headers.get('Cache-Control'), 'no-store')

globalThis.Deno = originalDeno

console.log('Production gate static and Edge CORS checks passed.')
