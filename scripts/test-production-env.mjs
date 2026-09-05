import assert from 'node:assert/strict'
import {
  completeLectureAiActions,
  completeLectureAiModels,
  completeLectureDatabaseGateNames,
  completeLectureFrontendFlagNames,
  completeLectureServerFlagNames,
  phase730FDatabaseGateNames,
  phase730FFrontendFlagNames,
  phase730FSecretInventoryNames,
  phase730FServerFlagNames,
  productionFeatureFlags,
  validateCompleteLectureProductionTopology,
  validatePhase730FReadinessMetadata,
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
delete legacyEnvironment.VITE_PHASE7_29_POWERPOINT_SYNC
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
    VITE_PHASE7_30_ADMIN_AI_UNLOCK: 'true',
  }).join('\n'),
  /requires VITE_PHASE7_30_ADMIN_IDENTITY=true/,
)
assert.match(
  validateProductionEnvironment({
    ...safeEnvironment,
    VITE_PHASE7_30_ADMIN_IDENTITY: 'true',
    VITE_PHASE7_30_ADMIN_AI_UNLOCK: 'true',
  }).join('\n'),
  /requires VITE_PHASE7_30_GOOGLE_ADMIN_OPERATIONS=true/,
)
assert.match(
  validateProductionEnvironment({
    ...safeEnvironment,
    VITE_PHASE7_29_POWERPOINT_SYNC: 'true',
  }).join('\n'),
  /requires VITE_PHASE3_PRIVATE_PDF=true/,
)
assert.match(
  validateProductionEnvironment({
    ...safeEnvironment,
    VITE_PHASE7_29_POWERPOINT_SYNC: 'true',
  }).join('\n'),
  /requires a valid VITE_PRESENTER_STORE_URL/,
)
assert.match(
  validateProductionEnvironment({
    ...safeEnvironment,
    VITE_PRESENTER_STORE_URL: 'https://example.com/fake-store-listing',
  }).join('\n'),
  /must be an exact HTTPS apps\.microsoft\.com listing URL/,
)
assert.match(
  validateProductionEnvironment({
    ...safeEnvironment,
    VITE_PRESENTER_STORE_URL: 'https://apps.microsoft.com/search?query=compass',
  }).join('\n'),
  /must be an exact HTTPS apps\.microsoft\.com listing URL/,
)
assert.deepEqual(
  validateProductionEnvironment({
    ...safeEnvironment,
    VITE_PRESENTER_STORE_URL: 'https://apps.microsoft.com/detail/9TESTONLY729',
  }),
  [],
)
assert.deepEqual(validateProductionServerEnvironment({}), [])
assert.match(
  validateProductionServerEnvironment({
    PHASE729_POWERPOINT_SYNC_ENABLED: 'yes',
  }).join('\n'),
  /PHASE729_POWERPOINT_SYNC_ENABLED must be true, false or omitted/,
)
assert.match(
  validateProductionServerEnvironment({
    PHASE729_POWERPOINT_SYNC_ENABLED: 'true',
  }).join('\n'),
  /requires PHASE728_DISPLAY_REALTIME_ENABLED=true/,
)
assert.match(
  validateProductionServerEnvironment({
    PHASE730_ADMIN_IDENTITY_ENABLED: 'true',
    PHASE730_GOOGLE_ADMIN_OPERATIONS_ENABLED: 'true',
    PHASE728_DISPLAY_REALTIME_ENABLED: 'true',
    PHASE729_POWERPOINT_SYNC_ENABLED: 'true',
    PRESENTER_BRIDGE_TOKEN_SECRET: 'short',
    PRESENTER_BRIDGE_GATEWAY_SECRET:
      'test-only-presenter-gateway-secret-at-least-thirty-two-bytes',
  }).join('\n'),
  /PRESENTER_BRIDGE_TOKEN_SECRET must contain at least 32 bytes/,
)
assert.deepEqual(
  validateProductionServerEnvironment({
    PHASE730_ADMIN_IDENTITY_ENABLED: 'true',
    PHASE730_GOOGLE_ADMIN_OPERATIONS_ENABLED: 'true',
    PHASE728_DISPLAY_REALTIME_ENABLED: 'true',
    PHASE729_POWERPOINT_SYNC_ENABLED: 'true',
    PRESENTER_BRIDGE_TOKEN_SECRET:
      'test-only-presenter-secret-at-least-thirty-two-bytes',
    PRESENTER_BRIDGE_GATEWAY_SECRET:
      'test-only-presenter-gateway-secret-at-least-thirty-two-bytes',
  }),
  [],
)

const completeLectureTopology = {
  frontendFlags: Object.fromEntries(
    completeLectureFrontendFlagNames.map((name) => [name, true]),
  ),
  serverFlags: Object.fromEntries(
    completeLectureServerFlagNames.map((name) => [name, true]),
  ),
  databaseGates: Object.fromEntries(
    completeLectureDatabaseGateNames.map((name) => [name, true]),
  ),
  runtime: {
    activeAiPolicyCount: 2,
    activeAiMembershipCount: 2,
    activeOwnerCount: 2,
    aiPolicyAllowedActions: completeLectureAiActions,
    aiPolicyAllowedModels: completeLectureAiModels,
    aiPolicyTopologyComplete: true,
    browserPdfWorkerUploadEnabled: true,
    canonicalAiPolicyTopologyComplete: true,
    coveredAiMembershipCount: 2,
    productionEnvironmentConfigured: true,
    requiredEdgeFunctionsCurrent: true,
  },
}
assert.deepEqual(
  validateCompleteLectureProductionTopology(completeLectureTopology),
  [],
)
assert.match(
  validateCompleteLectureProductionTopology({
    ...completeLectureTopology,
    databaseGates: {
      ...completeLectureTopology.databaseGates,
      googleAiChildGrantEnabled: false,
    },
  }).join('\n'),
  /googleAiChildGrantEnabled must be true/,
)
assert.match(
  validateCompleteLectureProductionTopology({
    ...completeLectureTopology,
    runtime: {
      ...completeLectureTopology.runtime,
      aiPolicyAllowedActions: completeLectureAiActions.filter(
        (action) => action !== 'captions',
      ),
    },
  }).join('\n'),
  /exact lecture AI action set/,
)
assert.match(
  validateCompleteLectureProductionTopology({
    ...completeLectureTopology,
    runtime: {
      ...completeLectureTopology.runtime,
      aiPolicyAllowedModels: ['gpt-5.6-luna'],
    },
  }).join('\n'),
  /exact lecture AI model set/,
)
assert.match(
  validateCompleteLectureProductionTopology({
    ...completeLectureTopology,
    runtime: {
      ...completeLectureTopology.runtime,
      coveredAiMembershipCount: 1,
    },
  }).join('\n'),
  /AI membership coverage counts must match and be greater than zero/,
)
assert.match(
  validateCompleteLectureProductionTopology({
    ...completeLectureTopology,
    runtime: {
      ...completeLectureTopology.runtime,
      aiPolicyTopologyComplete: false,
    },
  }).join('\n'),
  /aiPolicyTopologyComplete must be true/,
)
assert.match(
  validateCompleteLectureProductionTopology({
    ...completeLectureTopology,
    runtime: {
      ...completeLectureTopology.runtime,
      canonicalAiPolicyTopologyComplete: false,
    },
  }).join('\n'),
  /canonicalAiPolicyTopologyComplete must be true/,
)
assert.match(
  validateCompleteLectureProductionTopology({
    ...completeLectureTopology,
    runtime: {
      ...completeLectureTopology.runtime,
      activeAiPolicyCount: 1,
    },
  }).join('\n'),
  /activeAiPolicyCount cannot be less than coveredAiMembershipCount/,
)
assert.match(
  validateProductionServerEnvironment({
    PHASE730_ADMIN_IDENTITY_ENABLED: 'true',
    PHASE730_GOOGLE_ADMIN_OPERATIONS_ENABLED: 'true',
    PHASE728_DISPLAY_REALTIME_ENABLED: 'true',
    PHASE729_POWERPOINT_SYNC_ENABLED: 'true',
    PRESENTER_BRIDGE_TOKEN_SECRET:
      'test-only-shared-presenter-secret-at-least-thirty-two-bytes',
    PRESENTER_BRIDGE_GATEWAY_SECRET:
      'test-only-shared-presenter-secret-at-least-thirty-two-bytes',
  }).join('\n'),
  /must be distinct trust-boundary secrets/,
)
assert.match(
  validateProductionServerEnvironment({
    PHASE730_ADMIN_IDENTITY_ENABLED: 'true',
    PHASE730_GOOGLE_ADMIN_OPERATIONS_ENABLED: 'true',
    PHASE728_DISPLAY_REALTIME_ENABLED: 'true',
    PHASE729_POWERPOINT_SYNC_ENABLED: 'true',
    PRESENTER_BRIDGE_TOKEN_SECRET:
      'test-only-presenter-secret-at-least-thirty-two-bytes',
    PRESENTER_BRIDGE_GATEWAY_SECRET: 'short',
  }).join('\n'),
  /PRESENTER_BRIDGE_GATEWAY_SECRET must contain at least 32 bytes/,
)
assert.match(
  validateProductionServerEnvironment({
    PHASE728_DISPLAY_REALTIME_ENABLED: 'yes',
  }).join('\n'),
  /PHASE728_DISPLAY_REALTIME_ENABLED must be true, false or omitted/,
)
assert.match(
  validateProductionServerEnvironment({
    PHASE728_DISPLAY_REALTIME_ENABLED: 'true',
  }).join('\n'),
  /PHASE728_DISPLAY_REALTIME_ENABLED=true requires PHASE730_GOOGLE_ADMIN_OPERATIONS_ENABLED=true/,
)
assert.deepEqual(
  validateProductionServerEnvironment({
    PHASE730_ADMIN_IDENTITY_ENABLED: 'true',
    PHASE730_GOOGLE_ADMIN_OPERATIONS_ENABLED: 'true',
    PHASE728_DISPLAY_REALTIME_ENABLED: 'true',
  }),
  [],
)
assert.match(
  validateProductionServerEnvironment({
    PHASE730_GOOGLE_ADMIN_OPERATIONS_ENABLED: 'true',
  }).join('\n'),
  /requires PHASE730_ADMIN_IDENTITY_ENABLED=true/,
)
assert.deepEqual(
  validateProductionServerEnvironment({
    PHASE730_ADMIN_IDENTITY_ENABLED: 'true',
    PHASE730_ADMIN_AI_UNLOCK_ENABLED: 'true',
    PHASE730_ADMIN_TOTP_FACTOR_MUTATION_ENABLED: 'true',
    PHASE730_GOOGLE_ADMIN_OPERATIONS_ENABLED: 'true',
    PHASE730_GOOGLE_ADMIN_LEDGER_ENABLED: 'true',
  }),
  [],
)
assert.match(
  validateProductionServerEnvironment({
    PHASE730_GOOGLE_ADMIN_LEDGER_ENABLED: 'true',
  }).join('\n'),
  /requires PHASE730_GOOGLE_ADMIN_OPERATIONS_ENABLED=true/,
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

assert.match(
  validateProductionServerEnvironment({
    PHASE730_C1_GOOGLE_AI_MASTER_ENABLED: 'yes',
  }).join('\n'),
  /PHASE730_C1_GOOGLE_AI_MASTER_ENABLED must be true, false or omitted/,
)
assert.match(
  validateProductionServerEnvironment({
    PHASE730_C1_GOOGLE_AI_MASTER_ENABLED: 'true',
  }).join('\n'),
  /requires PHASE730_ADMIN_AI_UNLOCK_ENABLED=true/,
)
assert.deepEqual(
  validateProductionServerEnvironment({
    PHASE730_ADMIN_IDENTITY_ENABLED: 'true',
    PHASE730_ADMIN_AI_UNLOCK_ENABLED: 'true',
    PHASE730_C1_GOOGLE_AI_MASTER_ENABLED: 'true',
    PHASE730_GOOGLE_ADMIN_OPERATIONS_ENABLED: 'true',
    OPENAI_API_KEY: 'test-only-openai-key',
    ADMIN_AI_CHILD_GRANT_SECRET:
      'test-only-child-grant-secret-at-least-thirty-two-bytes',
    ADMIN_AI_CHILD_GRANT_SECRET_VERSION: '1',
  }),
  [],
)
assert.match(
  validateProductionServerEnvironment({
    PHASE730_ADMIN_IDENTITY_ENABLED: 'true',
    PHASE730_GOOGLE_ADMIN_OPERATIONS_ENABLED: 'true',
    PHASE4_REALTIME_CAPTIONS_ENABLED: 'true',
  }).join('\n'),
  /OPENAI_API_KEY must be configured/,
)
assert.match(
  validateProductionServerEnvironment({
    PHASE730_ADMIN_IDENTITY_ENABLED: 'true',
    PHASE730_GOOGLE_ADMIN_OPERATIONS_ENABLED: 'true',
    PHASE5_MATERIAL_ANALYSIS_ENABLED: 'true',
    OPENAI_API_KEY: 'test-only-openai-key',
    ADMIN_AI_CHILD_GRANT_SECRET: 'short',
  }).join('\n'),
  /ADMIN_AI_CHILD_GRANT_SECRET must contain at least 32 bytes/,
)
assert.deepEqual(
  validateProductionServerEnvironment({
    PHASE730_ADMIN_IDENTITY_ENABLED: 'true',
    PHASE730_GOOGLE_ADMIN_OPERATIONS_ENABLED: 'true',
    PHASE4_REALTIME_CAPTIONS_ENABLED: 'true',
    PHASE5_MATERIAL_ANALYSIS_ENABLED: 'true',
    PHASE6_SUMMARIES_ENABLED: 'true',
    PHASE7_2_ACADEMIC_ANSWERS_ENABLED: 'true',
    PHASE726_BROWSER_PDF_PUBLICATION_ENABLED: 'true',
    OPENAI_API_KEY: 'test-only-openai-key',
    ADMIN_AI_CHILD_GRANT_SECRET:
      'test-only-child-grant-secret-at-least-thirty-two-bytes',
    ADMIN_AI_CHILD_GRANT_SECRET_VERSION: '2',
  }),
  [],
)

const phase730FMetadata = {
  environment: {
    target: 'staging',
    alias: 'staging-identity-slot-a',
    sourceCommitSha: '0123456789abcdef0123456789abcdef01234567',
    capturedAt: '2026-08-12T00:00:00.000Z',
    environmentIdConfigured: false,
  },
  frontendFlags: Object.fromEntries(
    phase730FFrontendFlagNames.map((name) => [name, false]),
  ),
  serverFlags: Object.fromEntries(
    phase730FServerFlagNames.map((name) => [name, false]),
  ),
  databaseGates: Object.fromEntries(
    phase730FDatabaseGateNames.map((name) => [
      name,
      name === 'legacyPinLoginEnabled',
    ]),
  ),
  secretInventory: {
    captured: false,
    capturedAt: null,
    entries: [],
  },
}

assert.deepEqual(validatePhase730FReadinessMetadata(phase730FMetadata), [])
assert.deepEqual(
  validatePhase730FReadinessMetadata({
    ...phase730FMetadata,
    environment: {
      ...phase730FMetadata.environment,
      alias: 'staging-identity-slot-b',
      capturedAt: '2026-08-12T00:00:00.123Z',
    },
  }),
  [],
)
assert.match(
  validatePhase730FReadinessMetadata({
    ...phase730FMetadata,
    environment: {
      ...phase730FMetadata.environment,
      alias: 'abc',
    },
  }).join('\n'),
  /alias must be a non-secret staging alias/,
)
assert.match(
  validatePhase730FReadinessMetadata({
    ...phase730FMetadata,
    environment: {
      ...phase730FMetadata.environment,
      capturedAt: '2026-08-12T00:00:00.1Z',
    },
  }).join('\n'),
  /capturedAt must be null or an ISO UTC timestamp/,
)
assert.match(
  validatePhase730FReadinessMetadata({
    ...phase730FMetadata,
    environment: {
      ...phase730FMetadata.environment,
      capturedAt: '2026-02-31T00:00:00Z',
    },
  }).join('\n'),
  /capturedAt must be null or an ISO UTC timestamp/,
)
assert.match(
  validatePhase730FReadinessMetadata({
    ...phase730FMetadata,
    environment: {
      ...phase730FMetadata.environment,
      capturedAt: null,
      environmentIdConfigured: true,
    },
  }).join('\n'),
  /capturedAt must be an ISO UTC timestamp when an environment ID was observed/,
)
assert.match(
  validatePhase730FReadinessMetadata({
    ...phase730FMetadata,
    environment: { ...phase730FMetadata.environment, target: 'production' },
  }).join('\n'),
  /target must be staging/,
)
assert.match(
  validatePhase730FReadinessMetadata({
    ...phase730FMetadata,
    serverFlags: {
      ...phase730FMetadata.serverFlags,
      PHASE730_ADMIN_IDENTITY_ENABLED: true,
    },
  }).join('\n'),
  /PHASE730_ADMIN_IDENTITY_ENABLED must remain false/,
)
assert.match(
  validatePhase730FReadinessMetadata({
    ...phase730FMetadata,
    databaseGates: {
      ...phase730FMetadata.databaseGates,
      googleAiMasterAdmissionEnabled: true,
    },
  }).join('\n'),
  /googleAiMasterAdmissionEnabled must remain false/,
)
assert.match(
  validatePhase730FReadinessMetadata({
    ...phase730FMetadata,
    secretInventory: {
      captured: false,
      capturedAt: null,
      entries: [{ name: 'ADMIN_PIN', value: 'forbidden' }],
    },
  }).join('\n'),
  /entries must be empty until inventory is captured/,
)

const capturedSecretInventory = {
  captured: true,
  capturedAt: '2026-08-12T00:00:00.000Z',
  entries: phase730FSecretInventoryNames.map((name) => ({
    name,
    present: !['ADMIN_PIN', 'BILLING_PIN'].includes(name),
    minimumBytesSatisfied: ['ADMIN_PIN', 'BILLING_PIN'].includes(name)
      ? null
      : true,
    rotationVersion: ['ADMIN_PIN', 'BILLING_PIN'].includes(name) ? null : 1,
    rotatedAt: ['ADMIN_PIN', 'BILLING_PIN'].includes(name)
      ? null
      : '2026-08-01T00:00:00.000Z',
    removedAt: ['ADMIN_PIN', 'BILLING_PIN'].includes(name)
      ? '2026-08-11T00:00:00.000Z'
      : null,
  })),
}
assert.deepEqual(
  validatePhase730FReadinessMetadata({
    ...phase730FMetadata,
    secretInventory: capturedSecretInventory,
  }),
  [],
)
assert.match(
  validatePhase730FReadinessMetadata({
    ...phase730FMetadata,
    secretInventory: {
      ...capturedSecretInventory,
      entries: capturedSecretInventory.entries.map((entry) =>
        entry.name === 'ADMIN_PIN'
          ? { ...entry, removedAt: '2026-08-13T00:00:00.000Z' }
          : entry,
      ),
    },
  }).join('\n'),
  /must not postdate inventory capture/,
)
assert.match(
  validatePhase730FReadinessMetadata({
    ...phase730FMetadata,
    secretInventory: {
      ...capturedSecretInventory,
      entries: capturedSecretInventory.entries.map((entry) =>
        entry.name === 'ADMIN_PIN' ? { ...entry, present: true } : entry,
      ),
    },
  }).join('\n'),
  /ADMIN_PIN must be absent/,
)

console.log('Production environment validation tests passed.')
