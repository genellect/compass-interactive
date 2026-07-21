import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { validateProductionEnvironment } from './productionEnvironment.mjs'

const root = fileURLToPath(new URL('..', import.meta.url))
const rootUrl = new URL(`file:///${root.replaceAll('\\', '/')}/`)
const read = (...parts) =>
  readFileSync(new URL(parts.join('/'), rootUrl), 'utf8')

const migrationName = readdirSync(
  new URL('supabase/migrations/', rootUrl),
).find((name) => name.endsWith('_phase7_27_journal_club_integration.sql'))
assert.ok(migrationName, 'Phase 7.27 migration must exist')

const migration = read('supabase', 'migrations', migrationName)
const envExample = read('.env.local.example')
const featureFlags = read('src', 'lib', 'featureFlags.ts')
const manageLectures = read(
  'supabase',
  'functions',
  'manage-lectures',
  'index.ts',
)
const managePolls = read('supabase', 'functions', 'manage-polls', 'index.ts')
const adminPage = read('src', 'pages', 'AdminPage.tsx')
const preset = read(
  'src',
  'components',
  'AdminWorkspace',
  'AdminJournalClubPreset.tsx',
)

assert.match(envExample, /^VITE_PHASE7_27_JOURNAL_CLUB=false$/m)
assert.match(envExample, /^PHASE7_27_JOURNAL_CLUB_ENABLED=false$/m)
for (const dependency of [
  'isPhase66UxIntegrationEnabled',
  'isPhase68SecurityEnabled',
  'isPhase71ClassroomExtensionsEnabled',
  'isPhase726BrowserPdfPublishingEnabled',
]) {
  assert.match(featureFlags, new RegExp(`${dependency}\\s*&&`))
}
assert.match(
  featureFlags,
  /import\.meta\.env\.VITE_PHASE7_27_JOURNAL_CLUB === 'true'/,
)

const productionBase = {
  VITE_SUPABASE_URL: 'https://project.supabase.co',
  VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_phase727_probe',
  VITE_TURNSTILE_SITE_KEY: 'phase727-site-key',
  VITE_PDF_WORKER_BASE_URL: 'https://pdf.example.test',
}
for (const name of [
  'VITE_PHASE1_SYNC_PROTOCOL',
  'VITE_PHASE2_LECTURE_LIFECYCLE',
  'VITE_PHASE3_PRIVATE_PDF',
  'VITE_PHASE4_REALTIME_CAPTIONS',
  'VITE_PHASE5_MATERIAL_ANALYSIS',
  'VITE_PHASE6_SUMMARIES',
  'VITE_PHASE6_5_COMMENT_NICKNAMES',
  'VITE_PHASE6_6_UX_INTEGRATION',
  'VITE_PHASE6_8_SECURITY',
  'VITE_PHASE7_1_CLASSROOM_EXTENSIONS',
  'VITE_PHASE7_2_ACADEMIC_ANSWERS',
  'VITE_PHASE7_25_AUTO_ACADEMIC_ANSWERS',
  'VITE_PHASE7_26_BROWSER_PDF_PUBLISHING',
  'VITE_PHASE7_27_JOURNAL_CLUB',
]) {
  productionBase[name] = 'false'
}
assert.deepEqual(validateProductionEnvironment(productionBase), [])
const invalidStandalone = {
  ...productionBase,
  VITE_PHASE7_27_JOURNAL_CLUB: 'true',
}
const dependencyErrors = validateProductionEnvironment(invalidStandalone)
for (const dependency of [
  'VITE_PHASE6_6_UX_INTEGRATION',
  'VITE_PHASE6_8_SECURITY',
  'VITE_PHASE7_1_CLASSROOM_EXTENSIONS',
  'VITE_PHASE7_26_BROWSER_PDF_PUBLISHING',
]) {
  assert.ok(
    dependencyErrors.some((error) => error.includes(dependency)),
    `production validation must require ${dependency}`,
  )
}

for (const table of [
  'phase727_journal_club_runs',
  'phase727_journal_club_poll_slots',
]) {
  assert.match(
    migration,
    new RegExp(`alter table public\\.${table} enable row level security`),
  )
  assert.match(
    migration,
    new RegExp(
      `revoke all on public\\.${table}[\\s\\S]*?anon, authenticated, service_role`,
    ),
  )
}
assert.match(
  migration,
  /grant select, insert on public\.phase727_journal_club_runs to service_role/,
)
assert.match(
  migration,
  /grant select, insert on public\.phase727_journal_club_poll_slots to service_role/,
)
assert.match(
  migration,
  /create function public\.admin_create_phase727_journal_club_run_v1[\s\S]*?security invoker[\s\S]*?set search_path = ''/,
)
assert.match(migration, /pg_catalog\.pg_advisory_xact_lock/g)
assert.match(migration, /phase727:request:/)
assert.match(migration, /phase727:event:journal-club-2026-07-23/)
assert.match(migration, /phase727:open:/)

for (const descriptor of [
  "'journal-club-2026-07-23-v1'",
  "'8c6903527b050c1db5f6b13b24bcf9108950bf8248a80205b10be6a9c63d7842'",
  '5816208',
  '34',
]) {
  assert.ok(migration.includes(descriptor), `missing descriptor ${descriptor}`)
}
assert.match(migration, /phase727_validate_pdf_publication/)
assert.match(migration, /phase727_validate_pdf_document/)

const createRunStart = migration.indexOf(
  'create function public.admin_create_phase727_journal_club_run_v1',
)
const createRunEnd = migration.indexOf(
  'comment on function public.admin_create_phase727_journal_club_run_v1',
  createRunStart,
)
assert.ok(createRunStart >= 0 && createRunEnd > createRunStart)
const createRun = migration.slice(createRunStart, createRunEnd)
const blueprint = createRun.slice(
  createRun.indexOf('poll_blueprint constant jsonb :='),
  createRun.indexOf(
    'begin',
    createRun.indexOf('poll_blueprint constant jsonb :='),
  ),
)
assert.equal((blueprint.match(/'question'/g) ?? []).length, 6)
assert.equal((blueprint.match(/'options'/g) ?? []).length, 6)
assert.match(createRun, /public\.admin_create_poll\(/)
assert.match(createRun, /phase727_journal_club_poll_slots/)
assert.match(createRun, /poll_entry\.position/)
assert.doesNotMatch(createRun, /admin_set_lecture_status|start_lecture_core/)
assert.doesNotMatch(
  createRun,
  /admin_(?:create_pdf_publication|configure_lecture_ai_control|start_)/,
)

assert.match(migration, /'mode', 'permanent'/)
assert.match(migration, /'policy_id', 'phase7-27-journal-club-2026-07-23-v1'/)
assert.match(migration, /private\.phase6_public_summaries_json\([\s\S]*?18/)

assert.match(manageLectures, /action: 'createJournalClubRun'/)
assert.match(manageLectures, /PHASE7_27_JOURNAL_CLUB_ENABLED/)
assert.match(manageLectures, /admin_create_phase727_journal_club_run_v1/)
assert.match(managePolls, /phase727_journal_club_poll_slots/)
assert.match(managePolls, /return left\.templateOrder - right\.templateOrder/)
assert.match(preset, /createJournalClubRun/)
assert.match(
  adminPage,
  /const effectiveIncludeHistory =[\s\S]*?includeHistory \|\| journalClubLectureIds\.has\(lectureSessionId\)[\s\S]*?includeHistory: effectiveIncludeHistory/,
)
assert.match(preset, /prepare\('rehearsal'\)/)
assert.match(preset, /prepare\('production'\)/)
assert.match(preset, /作成後も講義と投票は開始されません/)

console.log('Phase 7.27 static contract checks passed.')
