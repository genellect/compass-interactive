import assert from 'node:assert/strict'
import {
  productionFeatureFlags,
  validateProductionEnvironment,
  validateProductionServerEnvironment,
} from './productionEnvironment.mjs'

const safeEnvironment = {
  VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test_only',
  VITE_SUPABASE_URL: 'https://project-ref.supabase.co',
  VITE_TURNSTILE_SITE_KEY: 'turnstile-test-site-key',
}
for (const name of productionFeatureFlags) {
  safeEnvironment[name] = 'false'
}

assert.deepEqual(validateProductionEnvironment(safeEnvironment), [])
const legacyEnvironment = { ...safeEnvironment }
delete legacyEnvironment.VITE_PHASE7_28_JOURNAL_CLUB_PRESET_CREATION
assert.deepEqual(
  validateProductionEnvironment(legacyEnvironment),
  [],
  'omitting the Phase 7.28 creation switch must remain a safe default-off upgrade',
)
assert.match(
  validateProductionEnvironment({
    ...safeEnvironment,
    VITE_OPENAI_API_KEY: 'must-not-be-public',
  }).join('\n'),
  /VITE_OPENAI_API_KEY/,
)
assert.match(
  validateProductionEnvironment({
    ...safeEnvironment,
    VITE_PHASE4_REALTIME_CAPTIONS: 'true',
  }).join('\n'),
  /requires VITE_PHASE1_SYNC_PROTOCOL=true/,
)
assert.match(
  validateProductionEnvironment({
    ...safeEnvironment,
    VITE_PHASE3_PRIVATE_PDF: 'true',
  }).join('\n'),
  /VITE_PDF_WORKER_BASE_URL/,
)
assert.match(
  validateProductionEnvironment({
    ...safeEnvironment,
    VITE_PHASE7_26_BROWSER_PDF_PUBLISHING: 'true',
  }).join('\n'),
  /requires VITE_PHASE3_PRIVATE_PDF=true/,
)
assert.match(
  validateProductionEnvironment({
    ...safeEnvironment,
    VITE_PHASE7_28_AI_MASTER_AUTH: 'true',
  }).join('\n'),
  /requires VITE_PHASE4_REALTIME_CAPTIONS=true/,
)
assert.deepEqual(validateProductionServerEnvironment({}), [])
assert.match(
  validateProductionServerEnvironment({
    PHASE728_DISPLAY_REALTIME_ENABLED: 'yes',
  }).join('\n'),
  /PHASE728_DISPLAY_REALTIME_ENABLED must be true, false or omitted/,
)
assert.match(
  validateProductionServerEnvironment({
    PHASE68_TRACKED_ADMIN_SESSIONS_ENABLED: 'false',
    PHASE728_DISPLAY_REALTIME_ENABLED: 'true',
  }).join('\n'),
  /PHASE728_DISPLAY_REALTIME_ENABLED=true requires PHASE68_TRACKED_ADMIN_SESSIONS_ENABLED=true/,
)
assert.deepEqual(
  validateProductionServerEnvironment({
    PHASE68_TRACKED_ADMIN_SESSIONS_ENABLED: 'true',
    PHASE728_DISPLAY_REALTIME_ENABLED: 'true',
  }),
  [],
)
assert.match(
  validateProductionServerEnvironment({
    PHASE7_28_AI_MASTER_AUTH_ENABLED: 'true',
    PHASE68_TRACKED_ADMIN_SESSIONS_ENABLED: 'false',
  }).join('\n'),
  /requires PHASE68_TRACKED_ADMIN_SESSIONS_ENABLED=true/,
)
assert.deepEqual(
  validateProductionServerEnvironment({
    PHASE7_28_AI_MASTER_AUTH_ENABLED: 'true',
    PHASE68_TRACKED_ADMIN_SESSIONS_ENABLED: 'true',
    PHASE4_REALTIME_CAPTIONS_ENABLED: 'true',
    PHASE5_MATERIAL_ANALYSIS_ENABLED: 'true',
    PHASE6_SUMMARIES_ENABLED: 'true',
    PHASE7_2_ACADEMIC_ANSWERS_ENABLED: 'true',
    PHASE7_25_AUTO_ACADEMIC_ANSWERS_ENABLED: 'true',
  }),
  [],
)
assert.match(
  validateProductionServerEnvironment({
    PHASE7_28_AI_MASTER_AUTH_ENABLED: 'true',
    PHASE68_TRACKED_ADMIN_SESSIONS_ENABLED: 'true',
  }).join('\n'),
  /requires PHASE4_REALTIME_CAPTIONS_ENABLED=true/,
)
assert.match(
  validateProductionServerEnvironment({
    PHASE7_28_JOURNAL_CLUB_PRESET_CREATION_ENABLED: 'true',
  }).join('\n'),
  /requires PHASE7_27_JOURNAL_CLUB_ENABLED=true/,
)
assert.match(
  validateProductionEnvironment({
    ...safeEnvironment,
    VITE_PHASE7_27_JOURNAL_CLUB: 'true',
  }).join('\n'),
  /requires VITE_PHASE6_6_UX_INTEGRATION=true/,
)
assert.match(
  validateProductionEnvironment({
    ...safeEnvironment,
    VITE_PHASE7_28_JOURNAL_CLUB_PRESET_CREATION: 'true',
  }).join('\n'),
  /requires VITE_PHASE7_27_JOURNAL_CLUB=true/,
)
assert.match(
  validateProductionEnvironment({
    ...safeEnvironment,
    VITE_PHASE7_28_JOURNAL_CLUB_PRESET_CREATION: 'yes',
  }).join('\n'),
  /must be true, false or omitted/,
)
assert.deepEqual(
  validateProductionEnvironment({
    ...safeEnvironment,
    VITE_PDF_WORKER_BASE_URL: 'https://pdf-worker.example.workers.dev',
    VITE_PHASE1_SYNC_PROTOCOL: 'true',
    VITE_PHASE2_LECTURE_LIFECYCLE: 'true',
    VITE_PHASE3_PRIVATE_PDF: 'true',
    VITE_PHASE4_REALTIME_CAPTIONS: 'true',
    VITE_PHASE5_MATERIAL_ANALYSIS: 'true',
    VITE_PHASE6_5_COMMENT_NICKNAMES: 'true',
    VITE_PHASE6_6_UX_INTEGRATION: 'true',
    VITE_PHASE6_SUMMARIES: 'true',
  }),
  [],
)

console.log('Production environment validation tests passed.')
