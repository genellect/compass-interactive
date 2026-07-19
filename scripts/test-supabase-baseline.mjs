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
const adminLifecycleMigrationName = '20260711080712_admin_lifecycle.sql'
const pdfSyncMigrationName = '20260711111834_pdf_sync.sql'
const phase0MigrationName = '20260713142227_phase0_auth_hardening.sql'
const phase1MigrationName = '20260714021129_phase1_sync_protocol_v2.sql'
const phase2MigrationName = '20260714080706_phase2_lecture_lifecycle.sql'
const phase3MigrationName = '20260714104032_phase3_private_pdf_delivery.sql'
const phase4MigrationName =
  '20260715032806_phase4_billing_and_realtime_captions.sql'
const phase41MigrationName = '20260715145555_phase4_1_ai_concurrency_lanes.sql'
const phase5MigrationName = '20260715155407_phase5_pdf_ai_poll_proposals.sql'
const phase6MigrationName = '20260716013632_phase6_five_minute_summaries.sql'
const phase65MigrationName =
  '20260716062858_phase6_5_optional_comment_nicknames.sql'
const productionGateMigrationName =
  '20260716073719_production_gate_hardening.sql'
const phase66MigrationName =
  '20260716140920_phase6_6_ux_archive_metrics_digest.sql'
const phase66PgNetSchedulerMigrationName =
  '20260716222345_phase6_6_enable_pg_net_scheduler.sql'
const phase66ArchiveClaimMigrationName =
  '20260716224012_phase6_6_archive_claim_requires_code.sql'
const phase66RealtimeProviderMigrationName =
  '20260717090500_phase6_6_realtime_provider_control.sql'
const phase68SecuritySessionsMigrationName =
  '20260718193306_phase6_8_security_sessions_resume.sql'
const phase71ClassroomExtensionsMigrationName =
  '20260719114320_phase7_1_classroom_ux_extensions.sql'
const baselinePath = join(migrationsDir, baselineName)
const configPath = join(supabaseDir, 'config.toml')
const anonymousAuthPath = join(root, 'src', 'lib', 'anonymousAuth.ts')
const turnstilePath = join(root, 'src', 'lib', 'turnstile.ts')
const envExamplePath = join(root, '.env.local.example')

assert.deepEqual(
  readdirSync(migrationsDir).filter((name) => name.endsWith('.sql')),
  [
    baselineName,
    liveStateMigrationName,
    adminLifecycleMigrationName,
    pdfSyncMigrationName,
    phase0MigrationName,
    phase1MigrationName,
    phase2MigrationName,
    phase3MigrationName,
    phase4MigrationName,
    phase41MigrationName,
    phase5MigrationName,
    phase6MigrationName,
    phase65MigrationName,
    productionGateMigrationName,
    phase66MigrationName,
    phase66PgNetSchedulerMigrationName,
    phase66ArchiveClaimMigrationName,
    phase66RealtimeProviderMigrationName,
    phase68SecuritySessionsMigrationName,
    phase71ClassroomExtensionsMigrationName,
  ],
  'The immutable baseline must be followed by additive milestone migrations.',
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
assert.match(config, /enable_anonymous_sign_ins = true/)

const anonymousAuth = readFileSync(anonymousAuthPath, 'utf8')
const turnstile = readFileSync(turnstilePath, 'utf8')
const envExample = readFileSync(envExamplePath, 'utf8')
assert.match(anonymousAuth, /getAnonymousSignInCaptchaToken/)
assert.match(anonymousAuth, /options: \{ captchaToken \}/)
assert.match(turnstile, /VITE_TURNSTILE_SITE_KEY/)
assert.match(envExample, /VITE_PHASE1_SYNC_PROTOCOL=false/)
assert.match(envExample, /VITE_PHASE2_LECTURE_LIFECYCLE=false/)
assert.match(envExample, /VITE_PHASE3_PRIVATE_PDF=false/)
assert.match(envExample, /VITE_PHASE5_MATERIAL_ANALYSIS=false/)
assert.match(envExample, /VITE_PHASE6_5_COMMENT_NICKNAMES=false/)
assert.match(
  turnstile,
  /https:\/\/challenges\.cloudflare\.com\/turnstile\/v0\/api\.js\?render=explicit/,
)

const phase0Migration = readFileSync(
  join(migrationsDir, phase0MigrationName),
  'utf8',
)
assert.match(phase0Migration, /add column auth_user_id uuid null/)
assert.match(phase0Migration, /participants_lecture_auth_user_uidx/)
assert.match(
  phase0Migration,
  /grant execute on function public\.join_lecture_by_code\(text\)[\s\S]*?to authenticated/,
)

const phase2Migration = readFileSync(
  join(migrationsDir, phase2MigrationName),
  'utf8',
)
for (const lifecycleColumn of [
  'started_at',
  'hard_stop_at',
  'closed_at',
  'archive_expires_at',
]) {
  assert.match(phase2Migration, new RegExp(`add column ${lifecycleColumn}\\b`))
}
for (const table of [
  'lecture_lifecycle_events',
  'lecture_archive_state',
  'lecture_ai_control',
  'ai_usage_ledger',
]) {
  assert.match(phase2Migration, new RegExp(`create table public\\.${table}\\b`))
  assert.match(
    phase2Migration,
    new RegExp(`alter table public\\.${table} enable row level security;`),
  )
}
assert.match(phase2Migration, /interval '90 minutes'/)
assert.match(phase2Migration, /interval '30 days'/)
assert.match(phase2Migration, /for update skip locked/)
assert.doesNotMatch(phase2Migration, /delete from public\./)

const phase1Migration = readFileSync(
  join(migrationsDir, phase1MigrationName),
  'utf8',
)
for (const versionColumn of [
  'lecture_version',
  'caption_version',
  'summaries_version',
  'pdf_version',
]) {
  assert.match(phase1Migration, new RegExp(`add column ${versionColumn}\\b`))
}
for (const rpc of [
  'get_lecture_public_snapshot_v2',
  'get_lecture_participant_state_v2',
  'get_lecture_comment_history_v2',
]) {
  assert.match(phase1Migration, new RegExp(`public\\.${rpc}\\b`))
}
assert.doesNotMatch(
  phase1Migration,
  /drop function public\.get_lecture_live_snapshot/,
)
assert.doesNotMatch(
  phase0Migration,
  /grant execute on function public\.join_lecture_by_code\(text\)[\s\S]*?to anon/,
)
assert.match(
  phase0Migration,
  /alter publication supabase_realtime drop table public\.comments/,
)

for (const functionName of [
  'verify-admin-pin',
  'manage-lectures',
  'manage-polls',
  'update-display-state',
  'manage-ai-control',
  'issue-pdf-access-token',
  'manage-pdf-documents',
  'analyze-lecture-material',
  'manage-material-analysis',
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
