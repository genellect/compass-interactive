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
const parityMigrationName = readdirSync(
  new URL('supabase/migrations/', rootUrl),
).find((name) => name.endsWith('_phase7_27_admin_start_parity_and_title.sql'))
assert.ok(parityMigrationName, 'Phase 7.27 parity migration must exist')
const parityMigration = read('supabase', 'migrations', parityMigrationName)
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
const app = read('src', 'App.tsx')
const adminPdfControl = read(
  'src',
  'components',
  'AdminWorkspace',
  'AdminPdfControl.tsx',
)
const learningSupport = read(
  'src',
  'components',
  'LearningSupport',
  'LearningSupport.tsx',
)
const preset = read(
  'src',
  'components',
  'AdminWorkspace',
  'AdminJournalClubPreset.tsx',
)
const browserSpec = read('e2e', 'demo', 'journal-club-preset-admin.spec.ts')
const browserRunner = read('scripts', 'ci', 'run-browser-e2e.mjs')

assert.match(envExample, /^VITE_PHASE7_27_JOURNAL_CLUB=false$/m)
assert.match(envExample, /^PHASE7_27_JOURNAL_CLUB_ENABLED=false$/m)
assert.match(envExample, /^VITE_PHASE7_28_JOURNAL_CLUB_PRESET_CREATION=false$/m)
assert.match(
  envExample,
  /^PHASE7_28_JOURNAL_CLUB_PRESET_CREATION_ENABLED=false$/m,
)
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
assert.match(
  featureFlags,
  /isPhase728JournalClubPresetCreationEnabled\s*=\s*[\s\S]*?isPhase727JournalClubEnabled\s*&&[\s\S]*?VITE_PHASE7_28_JOURNAL_CLUB_PRESET_CREATION === 'true'/,
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
assert.match(manageLectures, /PHASE7_28_JOURNAL_CLUB_PRESET_CREATION_ENABLED/)
assert.match(manageLectures, /Journal Club preset creation is retired\./)
assert.match(
  manageLectures,
  /manage_google_admin_lectures_v1[\s\S]*createWithUniqueCode\('createJournalClubRun'/,
)
assert.match(managePolls, /manage_google_admin_polls_v1/)
assert.match(
  managePolls,
  /target_include_history: body\.includeHistory \?\? false/,
)
assert.doesNotMatch(managePolls, /\.from\('phase727_/)
assert.match(preset, /createJournalClubRun/)
assert.match(
  adminPage,
  /const effectiveIncludeHistory =[\s\S]*?includeHistory \|\| journalClubLectureIds\.has\(lectureSessionId\)[\s\S]*?includeHistory: effectiveIncludeHistory/,
)
assert.match(preset, /prepare\('rehearsal'\)/)
assert.match(preset, /prepare\('production'\)/)
assert.match(preset, /Dual-targeting CasRx for C9orf72 ALS\/FTD/)
assert.match(preset, /資料公開後、一覧の「開始」を押してください/)
assert.match(
  browserSpec,
  /const originalConfirm = window\.confirm[\s\S]*window\.confirm = originalConfirm[\s\S]*return false[\s\S]*await productionButton\.click\(\)[\s\S]*toHaveLength\(0\)/,
  'the cancellation browser contract must use a trusted click without leaving a dismissed native dialog',
)
assert.match(
  browserRunner,
  /VITE_TURNSTILE_SITE_KEY:[\s\S]*mode === 'demo-jc' \? '1x00000000000000000000AA' : ''/,
  'the Phase 7.27 production-like browser path must exercise Turnstile',
)
assert.match(
  browserSpec,
  /physically aborts stalled anonymous signup[\s\S]*anonymousSignupDelayMs: \[16_000, 0\][\s\S]*Promise\.allSettled[\s\S]*anonymousSignupRequests\)\.toBe\(1\)[\s\S]*toBe\(retryUserId\)/,
  'the browser contract must pin physical signup abort, caller deduplication, retry, and no late session overwrite',
)
assert.match(
  browserSpec,
  /mode = 'stall'[\s\S]*controller\.abort\(\)[\s\S]*turnstileAbort[\s\S]*layerCount: 0[\s\S]*removeCount: 1/,
  'the browser contract must remove an aborted Turnstile widget and layer',
)
assert.match(
  browserSpec,
  /bounds a stalled archive lookup[\s\S]*archives\/resolve[\s\S]*15_000[\s\S]*toBeVisible\([\s\S]*timeout: 12_000[\s\S]*resumeIssueResolvedAt\)\.toBeNull\(\)[\s\S]*lecture-resume-tokens-v1/,
  'the production-like join contract must bound archive lookup and persist the late resume token without delaying navigation',
)
assert.match(
  browserSpec,
  /waitForEvent\('dialog'\)[\s\S]*dialog\.message\(\)[\s\S]*dialog\.accept\(\)[\s\S]*7\/23 本番を一覧に追加/,
  'the accepted production path must still verify the real confirmation dialog',
)
assert.match(
  adminPage,
  /journalClubPreset={[\s\S]*?isPhase728JournalClubPresetCreationEnabled\s*\?\s*\(/,
)
assert.match(
  browserSpec,
  /const settingsLink = page\.getByRole\('link',[\s\S]*name: '教員管理',[\s\S]*exact: true[\s\S]*toHaveAttribute\('href', '\/admin\/settings'\)[\s\S]*toHaveAttribute\('target', '_blank'\)[\s\S]*\.admin-identity-card'[\s\S]*toHaveCount\(0\)/,
  'the retired preset workspace must keep identity controls on the separate Admin settings route',
)
assert.match(app, /<Route element={<DisplayPage \/>} path="\/display" \/>/)
assert.doesNotMatch(
  app,
  /<RequireJoinedLecture>[\s\S]*?<DisplayPage \/>[\s\S]*?<\/RequireJoinedLecture>/,
)
assert.match(learningSupport, /mode === 'display'[\s\S]*display-caption-strip/)
assert.match(
  adminPdfControl,
  /displayState\.pdfPageCount \?\? selectedAsset\?\.pageCount/,
)
assert.match(adminPdfControl, /aria-label="講義資料のページ操作"/)
assert.doesNotMatch(preset, /正本/)
assert.doesNotMatch(adminPdfControl, /正本/)
assert.match(parityMigration, /Dual-targeting CasRx for C9orf72 ALS\/FTD/)
assert.match(parityMigration, /if not exists \([\s\S]*lecture_pdf_documents/)
assert.doesNotMatch(
  parityMigration,
  /target_run\.run_kind\s*=\s*'production'[\s\S]*lecture_pdf_documents/,
)
assert.match(parityMigration, /revoke all on function[\s\S]*service_role/)

console.log('Phase 7.27 static contract checks passed.')
