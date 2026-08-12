import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  readJsonBody,
  RequestBodyTooLargeError,
  UnsupportedJsonContentTypeError,
} from '../supabase/functions/_shared/requestBody.ts'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const read = (path) => readFileSync(resolve(root, path), 'utf8')

function sourceFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolute = join(directory, entry.name)
    return entry.isDirectory()
      ? sourceFiles(absolute)
      : entry.name.endsWith('.ts')
        ? [absolute]
        : []
  })
}

function callArguments(source, functionName) {
  const calls = []
  let searchFrom = 0
  const marker = `${functionName}(`
  while (true) {
    const start = source.indexOf(marker, searchFrom)
    if (start < 0) return calls
    let depth = 1
    let cursor = start + marker.length
    while (cursor < source.length && depth > 0) {
      if (source[cursor] === '(') depth += 1
      if (source[cursor] === ')') depth -= 1
      cursor += 1
    }
    assert.equal(depth, 0, `${functionName} call is not balanced`)
    calls.push(source.slice(start + marker.length, cursor - 1))
    searchFrom = cursor
  }
}

const migration = read(
  'supabase/migrations/20260718193306_phase6_8_security_sessions_resume.sql',
)
const adminToken = read('supabase/functions/_shared/adminToken.ts')
const resumeIssuer = read(
  'supabase/functions/issue-lecture-resume-token/index.ts',
)
const worker = read('cloudflare/asset-worker/src/worker.ts')
const headers = read('public/_headers')
const envExample = read('.env.local.example')
const liveRepository = read('src/repositories/supabaseLiveStateRepository.ts')
const adminRepository = read('src/repositories/supabaseAdminRepository.ts')
const lectureRepository = read('src/repositories/supabaseLectureRepository.ts')
const realtimeProvider = read('supabase/functions/_shared/openaiRealtime.ts')
const materialFunction = read(
  'supabase/functions/analyze-lecture-material/index.ts',
)
const summaryFunction = read(
  'supabase/functions/generate-lecture-summary/index.ts',
)

for (const contract of [
  'create table public.admin_sessions',
  'create table public.admin_pin_rate_limits',
  'verify_and_touch_admin_session',
  'get_lecture_resume_claim',
  'admin_revoke_lecture_resume_tokens',
  'creation_outcome_uncertain',
  'record_realtime_provider_client_request',
]) {
  assert.ok(migration.includes(contract), `migration missing ${contract}`)
}
assert.match(migration, /enable row level security/)
assert.match(migration, /revoke all[\s\S]*authenticated/)
assert.match(migration, /security definer[\s\S]*set search_path = ''/)
assert.match(adminToken, /token_hash: await sha256Hex\(token\)/)
assert.doesNotMatch(adminToken, /\.insert\([\s\S]{0,500}\btoken:/)
assert.match(adminToken, /auth\.getUser\(bearerToken\)/)
assert.match(adminToken, /auth_user_id[\s\S]{0,200}authData\.user\.id/)
assert.equal(
  existsSync(resolve(root, 'supabase/functions/verify-admin-pin/index.ts')),
  false,
  'the legacy shared-PIN issuer must stay removed',
)
assert.match(resumeIssuer, /auth_user_id/)
assert.match(resumeIssuer, /resume_token_version/)
assert.match(worker, /\/v1\/archives\/resume/)
assert.match(worker, /archives\/by-public-id/)

for (const flag of [
  'VITE_PHASE6_8_SECURITY=false',
  'PHASE68_TRACKED_ADMIN_SESSIONS_ENABLED=false',
  'PHASE68_RESUME_TOKENS_ENABLED=false',
]) {
  assert.ok(envExample.includes(flag), `default-OFF flag missing: ${flag}`)
}
assert.match(envExample, /^LECTURE_RESUME_TOKEN_SECRET=$/m)
assert.doesNotMatch(envExample, /VITE_LECTURE_RESUME_TOKEN_SECRET/)
assert.doesNotMatch(envExample, /VITE_ADMIN_SESSION_SECRET/)

assert.match(headers, /Content-Security-Policy:/)
assert.match(headers, /Content-Security-Policy-Report-Only:/)
for (const directive of [
  "default-src 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  'https://challenges.cloudflare.com',
  'https://*.supabase.co',
  'https://*.workers.dev',
]) {
  assert.ok(headers.includes(directive), `CSP missing ${directive}`)
}

for (const [source, pattern, label] of [
  [liveRepository, /AbortSignal\.timeout\(LIVE_RPC_TIMEOUT_MS\)/, 'live RPC'],
  [adminRepository, /timeout: ADMIN_FUNCTION_TIMEOUT_MS/, 'Admin Edge'],
  [adminRepository, /timeout: AI_FUNCTION_TIMEOUT_MS/, 'AI Edge'],
  [
    lectureRepository,
    /AbortSignal\.timeout\(LECTURE_RPC_TIMEOUT_MS\)/,
    'join RPC',
  ],
  [
    realtimeProvider,
    /AbortSignal\.timeout\(REALTIME_CREATE_TIMEOUT_MS\)/,
    'Realtime create',
  ],
  [
    realtimeProvider,
    /AbortSignal\.timeout\(REALTIME_HANGUP_TIMEOUT_MS\)/,
    'Realtime stop',
  ],
  [materialFunction, /X-Client-Request-Id/, 'material correlation'],
  [summaryFunction, /provider_timeout_ambiguous/, 'summary ambiguity'],
]) {
  assert.match(source, pattern, `${label} deadline/correlation is missing`)
}

const exposedFunctions = sourceFiles(
  resolve(root, 'supabase/functions'),
).filter((path) => !path.includes(`${join('functions', '_shared')}`))
for (const sourcePath of exposedFunctions) {
  const source = readFileSync(sourcePath, 'utf8')
  assert.doesNotMatch(
    source,
    /request\.json\(\)/,
    `${sourcePath} bypasses the bounded JSON reader`,
  )
  for (const functionName of ['getAdminTokenClaims', 'verifyAdminToken']) {
    for (const argumentsSource of callArguments(source, functionName)) {
      assert.match(
        argumentsSource,
        /\brequest\b/,
        `${sourcePath} does not bind ${functionName} to the request Auth user`,
      )
    }
  }
}

const valid = await readJsonBody(
  new Request('https://example.test', {
    body: JSON.stringify({ ok: true }),
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    method: 'POST',
  }),
  64,
)
assert.deepEqual(valid, { ok: true })
await assert.rejects(
  readJsonBody(
    new Request('https://example.test', {
      body: '{}',
      headers: { 'Content-Type': 'text/plain' },
      method: 'POST',
    }),
    64,
  ),
  UnsupportedJsonContentTypeError,
)
await assert.rejects(
  readJsonBody(
    new Request('https://example.test', {
      body: JSON.stringify({ value: 'x'.repeat(100) }),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    }),
    32,
  ),
  RequestBodyTooLargeError,
)

console.log(
  `Phase 6.8 static security gate passed across ${exposedFunctions.length} Edge functions.`,
)
