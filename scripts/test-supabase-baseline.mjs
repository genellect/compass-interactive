import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const supabaseDir = join(root, 'supabase')
const migrationsDir = join(supabaseDir, 'migrations')
const manualDir = join(supabaseDir, 'manual')
const baselineName = '20260710104958_remote_baseline.sql'
const liveStateMigrationName = '20260711020445_live_state_integration.sql'
const baselinePath = join(migrationsDir, baselineName)
const configPath = join(supabaseDir, 'config.toml')

assert.deepEqual(
  readdirSync(migrationsDir).filter((name) => name.endsWith('.sql')),
  [baselineName, liveStateMigrationName],
  'The immutable baseline must be followed by the Milestone 2 migration.',
)
assert.equal(
  readdirSync(manualDir).filter((name) => name.endsWith('.sql')).length,
  0,
  'manual/ must not contain executable SQL after consolidation.',
)

const baseline = readFileSync(baselinePath, 'utf8')
const config = readFileSync(configPath, 'utf8')

for (const table of [
  'lecture_sessions',
  'participants',
  'comments',
  'comment_likes',
  'polls',
  'poll_options',
  'poll_responses',
  'lecture_display_state',
  'poll_result_refresh_events',
  'lecture_admin_codes',
]) {
  assert.match(baseline, new RegExp(`create table public\\.${table}\\b`))
  assert.match(
    baseline,
    new RegExp(`alter table public\\.${table} enable row level security;`),
  )
}

for (const rpc of [
  'join_lecture_by_code',
  'get_lecture_session_state',
  'get_open_poll_results',
]) {
  assert.match(baseline, new RegExp(`create function public\\.${rpc}\\b`))
}

assert.match(baseline, /tablename = 'comments'/)
assert.doesNotMatch(
  baseline,
  /alter publication supabase_realtime add table public\.(comment_likes|poll_result_refresh_events|lecture_display_state)/,
)
assert.match(config, /major_version = 17/)
assert.match(config, /\[db\.seed\][\s\S]*?enabled = false/)

for (const functionName of [
  'verify-admin-pin',
  'manage-lectures',
  'update-display-state',
]) {
  const sourcePath = join(supabaseDir, 'functions', functionName, 'index.ts')
  assert.ok(existsSync(sourcePath), `${functionName} source must exist.`)
  const source = readFileSync(sourcePath, 'utf8')
  assert.match(source, /Deno\.serve/)
  assert.match(
    config,
    new RegExp(`\\[functions\\.${functionName}\\][\\s\\S]*?verify_jwt = true`),
  )
}

console.log('Supabase baseline static checks passed.')
