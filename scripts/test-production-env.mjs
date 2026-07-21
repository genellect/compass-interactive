import assert from 'node:assert/strict'
import {
  productionFeatureFlags,
  validateProductionEnvironment,
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
    VITE_PHASE7_27_JOURNAL_CLUB: 'true',
  }).join('\n'),
  /requires VITE_PHASE6_6_UX_INTEGRATION=true/,
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
