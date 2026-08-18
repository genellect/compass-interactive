const featureFlags = [
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
]

// Optional during the expand-first rollout. Absence is deliberately equivalent
// to false so existing production environments retire the one-off preset
// without needing an emergency configuration change.
const optionalFeatureFlags = [
  'VITE_PHASE7_28_JOURNAL_CLUB_PRESET_CREATION',
  'VITE_PHASE7_28_DISPLAY_REALTIME',
  'VITE_PHASE7_29_POWERPOINT_SYNC',
  'VITE_PHASE7_30_ADMIN_IDENTITY',
  'VITE_PHASE7_30_ADMIN_AI_UNLOCK',
  'VITE_PHASE7_30_ADMIN_TOTP_FACTOR_MUTATION',
  'VITE_PHASE7_30_GOOGLE_ADMIN_OPERATIONS',
  'VITE_PHASE7_30_GOOGLE_ADMIN_LEDGER',
]

export const phase730FFrontendFlagNames = [
  'VITE_PHASE7_30_ADMIN_IDENTITY',
  'VITE_PHASE7_30_ADMIN_AI_UNLOCK',
  'VITE_PHASE7_30_ADMIN_TOTP_FACTOR_MUTATION',
  'VITE_PHASE7_30_GOOGLE_ADMIN_OPERATIONS',
  'VITE_PHASE7_30_GOOGLE_ADMIN_LEDGER',
]

export const phase730FServerFlagNames = [
  'PHASE730_ADMIN_IDENTITY_ENABLED',
  'PHASE730_ADMIN_AI_UNLOCK_ENABLED',
  'PHASE730_ADMIN_TOTP_FACTOR_MUTATION_ENABLED',
  'PHASE730_C1_GOOGLE_AI_MASTER_ENABLED',
  'PHASE730_GOOGLE_ADMIN_OPERATIONS_ENABLED',
  'PHASE730_GOOGLE_ADMIN_LEDGER_ENABLED',
]

export const phase730FDatabaseGateNames = [
  'googleSessionIssueEnabled',
  'legacyPinLoginEnabled',
  'operatorTotpFactorSetAdoptionEnabled',
  'totpFactorMutationEnabled',
  'googleOperationalAuthorizationEnabled',
  'googleAdminLedgerEnabled',
  'aiUnlockEnabled',
  'googleAiMasterAdmissionEnabled',
  'rememberedBrowserEnabled',
]

export const phase730FSecretInventoryNames = [
  'SUPABASE_SERVICE_ROLE_KEY',
  'ADMIN_SESSION_SECRET',
  'ADMIN_IDENTITY_PEPPER',
  'ADMIN_AI_PIN_PEPPER',
  'ADMIN_AI_NETWORK_PEPPER',
  'ADMIN_AI_BROWSER_CHALLENGE_SECRET',
  'ADMIN_AI_CHILD_GRANT_SECRET',
  'ADMIN_INVITATION_SECRET',
  'ADMIN_PIN',
  'BILLING_PIN',
]

export const completeLectureFrontendFlagNames = [
  ...featureFlags,
  'VITE_PHASE7_28_DISPLAY_REALTIME',
  'VITE_PHASE7_30_ADMIN_IDENTITY',
  'VITE_PHASE7_30_ADMIN_AI_UNLOCK',
  'VITE_PHASE7_30_GOOGLE_ADMIN_OPERATIONS',
  'VITE_PHASE7_30_GOOGLE_ADMIN_LEDGER',
]

export const completeLectureServerFlagNames = [
  'PHASE4_REALTIME_CAPTIONS_ENABLED',
  'PHASE5_MATERIAL_ANALYSIS_ENABLED',
  'PHASE6_SUMMARIES_ENABLED',
  'PHASE68_RESUME_TOKENS_ENABLED',
  'PHASE7_1_CLASSROOM_EXTENSIONS_ENABLED',
  'PHASE7_2_ACADEMIC_ANSWERS_ENABLED',
  'PHASE7_25_AUTO_ACADEMIC_ANSWERS_ENABLED',
  'PHASE726_BROWSER_PDF_PUBLICATION_ENABLED',
  'PHASE7_27_JOURNAL_CLUB_ENABLED',
  'PHASE728_DISPLAY_REALTIME_ENABLED',
  'PHASE730_ADMIN_IDENTITY_ENABLED',
  'PHASE730_ADMIN_AI_UNLOCK_ENABLED',
  'PHASE730_C1_GOOGLE_AI_MASTER_ENABLED',
  'PHASE730_GOOGLE_ADMIN_OPERATIONS_ENABLED',
  'PHASE730_GOOGLE_ADMIN_LEDGER_ENABLED',
]

export const completeLectureDatabaseGateNames = [
  'googleSessionIssueEnabled',
  'googleOperationalAuthorizationEnabled',
  'googleAdminLedgerEnabled',
  'aiUnlockEnabled',
  'googleAiMasterAdmissionEnabled',
  'googleAiChildGrantEnabled',
]

export const completeLectureAiActions = [
  'academic_answers',
  'captions',
  'material_analysis',
  'poll_suggestions',
  'summaries',
]

export const completeLectureAiModels = ['gpt-5.6-luna', 'gpt-realtime-whisper']

export const phase730FEnvironmentAliasPattern = '^staging-identity-slot-[a-z]$'
export const phase730FIsoTimestampPattern =
  '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\\.[0-9]{3})?Z$'

const phase730FEnvironmentAliasRegex = new RegExp(
  phase730FEnvironmentAliasPattern,
)
const phase730FIsoTimestampRegex = new RegExp(phase730FIsoTimestampPattern)

const phase730FForbiddenSecretNames = new Set(['ADMIN_PIN', 'BILLING_PIN'])

const forbiddenPublicNames = [
  'VITE_ADMIN_PIN',
  'VITE_ADMIN_SESSION_SECRET',
  'VITE_BILLING_PIN',
  'VITE_OPENAI_API_KEY',
  'VITE_SUPABASE_SECRET_KEY',
  'VITE_SUPABASE_SERVICE_ROLE_KEY',
  'VITE_TURNSTILE_SECRET_KEY',
]

function value(environment, name) {
  return environment[name]?.trim() ?? ''
}

function isPlaceholder(candidate) {
  return (
    !candidate ||
    /^(your-|replace-|missing-)|example\.supabase\.co/i.test(candidate)
  )
}

function validHttpsUrl(candidate) {
  try {
    return new URL(candidate).protocol === 'https:'
  } catch {
    return false
  }
}

export function validateProductionEnvironment(environment) {
  const errors = []
  const supabaseUrl = value(environment, 'VITE_SUPABASE_URL')
  const publishableKey = value(environment, 'VITE_SUPABASE_PUBLISHABLE_KEY')
  const turnstileSiteKey = value(environment, 'VITE_TURNSTILE_SITE_KEY')

  if (isPlaceholder(supabaseUrl) || !validHttpsUrl(supabaseUrl)) {
    errors.push('VITE_SUPABASE_URL must be a non-placeholder HTTPS URL.')
  }
  if (
    isPlaceholder(publishableKey) ||
    !/^(sb_publishable_[A-Za-z0-9_-]+|eyJ[A-Za-z0-9_-]+\.)/.test(publishableKey)
  ) {
    errors.push(
      'VITE_SUPABASE_PUBLISHABLE_KEY must be a publishable or legacy anon key.',
    )
  }
  if (isPlaceholder(turnstileSiteKey)) {
    errors.push('VITE_TURNSTILE_SITE_KEY must be configured.')
  }

  for (const name of featureFlags) {
    if (!['false', 'true'].includes(value(environment, name))) {
      errors.push(`${name} must be explicitly true or false.`)
    }
  }
  for (const name of optionalFeatureFlags) {
    const configuredValue = value(environment, name)
    if (configuredValue && !['false', 'true'].includes(configuredValue)) {
      errors.push(`${name} must be true, false or omitted.`)
    }
  }
  for (const name of forbiddenPublicNames) {
    if (value(environment, name)) {
      errors.push(`${name} must never be exposed to the Vite bundle.`)
    }
  }

  const enabled = (name) => value(environment, name) === 'true'
  const requireFlag = (feature, dependency) => {
    if (enabled(feature) && !enabled(dependency)) {
      errors.push(`${feature}=true requires ${dependency}=true.`)
    }
  }
  requireFlag('VITE_PHASE4_REALTIME_CAPTIONS', 'VITE_PHASE1_SYNC_PROTOCOL')
  requireFlag('VITE_PHASE5_MATERIAL_ANALYSIS', 'VITE_PHASE3_PRIVATE_PDF')
  requireFlag('VITE_PHASE6_SUMMARIES', 'VITE_PHASE1_SYNC_PROTOCOL')
  requireFlag('VITE_PHASE6_5_COMMENT_NICKNAMES', 'VITE_PHASE1_SYNC_PROTOCOL')
  for (const dependency of [
    'VITE_PHASE1_SYNC_PROTOCOL',
    'VITE_PHASE2_LECTURE_LIFECYCLE',
    'VITE_PHASE3_PRIVATE_PDF',
    'VITE_PHASE4_REALTIME_CAPTIONS',
    'VITE_PHASE5_MATERIAL_ANALYSIS',
    'VITE_PHASE6_SUMMARIES',
    'VITE_PHASE6_5_COMMENT_NICKNAMES',
  ]) {
    requireFlag('VITE_PHASE6_6_UX_INTEGRATION', dependency)
  }
  requireFlag('VITE_PHASE6_8_SECURITY', 'VITE_PHASE6_6_UX_INTEGRATION')
  requireFlag('VITE_PHASE7_1_CLASSROOM_EXTENSIONS', 'VITE_PHASE1_SYNC_PROTOCOL')
  requireFlag('VITE_PHASE7_1_CLASSROOM_EXTENSIONS', 'VITE_PHASE6_SUMMARIES')
  requireFlag('VITE_PHASE7_2_ACADEMIC_ANSWERS', 'VITE_PHASE6_SUMMARIES')
  requireFlag(
    'VITE_PHASE7_25_AUTO_ACADEMIC_ANSWERS',
    'VITE_PHASE7_2_ACADEMIC_ANSWERS',
  )
  requireFlag(
    'VITE_PHASE7_26_BROWSER_PDF_PUBLISHING',
    'VITE_PHASE3_PRIVATE_PDF',
  )
  for (const dependency of [
    'VITE_PHASE6_6_UX_INTEGRATION',
    'VITE_PHASE6_8_SECURITY',
    'VITE_PHASE7_1_CLASSROOM_EXTENSIONS',
    'VITE_PHASE7_26_BROWSER_PDF_PUBLISHING',
  ]) {
    requireFlag('VITE_PHASE7_27_JOURNAL_CLUB', dependency)
  }
  requireFlag(
    'VITE_PHASE7_28_JOURNAL_CLUB_PRESET_CREATION',
    'VITE_PHASE7_27_JOURNAL_CLUB',
  )
  requireFlag('VITE_PHASE7_28_DISPLAY_REALTIME', 'VITE_PHASE6_8_SECURITY')
  requireFlag(
    'VITE_PHASE7_28_DISPLAY_REALTIME',
    'VITE_PHASE7_1_CLASSROOM_EXTENSIONS',
  )
  requireFlag('VITE_PHASE7_29_POWERPOINT_SYNC', 'VITE_PHASE3_PRIVATE_PDF')
  requireFlag(
    'VITE_PHASE7_29_POWERPOINT_SYNC',
    'VITE_PHASE7_28_DISPLAY_REALTIME',
  )
  requireFlag('VITE_PHASE7_30_ADMIN_AI_UNLOCK', 'VITE_PHASE7_30_ADMIN_IDENTITY')
  requireFlag(
    'VITE_PHASE7_30_ADMIN_AI_UNLOCK',
    'VITE_PHASE7_30_GOOGLE_ADMIN_OPERATIONS',
  )
  requireFlag(
    'VITE_PHASE7_30_ADMIN_TOTP_FACTOR_MUTATION',
    'VITE_PHASE7_30_ADMIN_IDENTITY',
  )
  requireFlag(
    'VITE_PHASE7_30_GOOGLE_ADMIN_OPERATIONS',
    'VITE_PHASE7_30_ADMIN_IDENTITY',
  )
  requireFlag(
    'VITE_PHASE7_30_GOOGLE_ADMIN_LEDGER',
    'VITE_PHASE7_30_GOOGLE_ADMIN_OPERATIONS',
  )

  if (enabled('VITE_PHASE3_PRIVATE_PDF')) {
    const workerUrl = value(environment, 'VITE_PDF_WORKER_BASE_URL')
    if (isPlaceholder(workerUrl) || !validHttpsUrl(workerUrl)) {
      errors.push(
        'VITE_PDF_WORKER_BASE_URL must be a non-placeholder HTTPS URL when Phase 3 is enabled.',
      )
    }
  }

  return errors
}

export function validateProductionServerEnvironment(environment) {
  const errors = []
  const presetCreationEnabled = value(
    environment,
    'PHASE7_28_JOURNAL_CLUB_PRESET_CREATION_ENABLED',
  )
  const displayRealtimeEnabled = value(
    environment,
    'PHASE728_DISPLAY_REALTIME_ENABLED',
  )
  const presenterEnabled = value(
    environment,
    'PHASE729_POWERPOINT_SYNC_ENABLED',
  )
  if (
    presetCreationEnabled &&
    !['false', 'true'].includes(presetCreationEnabled)
  ) {
    errors.push(
      'PHASE7_28_JOURNAL_CLUB_PRESET_CREATION_ENABLED must be true, false or omitted.',
    )
  }
  const operationalServerFlags = [
    'PHASE4_REALTIME_CAPTIONS_ENABLED',
    'PHASE5_MATERIAL_ANALYSIS_ENABLED',
    'PHASE6_SUMMARIES_ENABLED',
    'PHASE7_2_ACADEMIC_ANSWERS_ENABLED',
    'PHASE726_BROWSER_PDF_PUBLICATION_ENABLED',
  ]
  const googleAdminFlags = [
    'PHASE730_ADMIN_IDENTITY_ENABLED',
    'PHASE730_ADMIN_AI_UNLOCK_ENABLED',
    'PHASE730_ADMIN_TOTP_FACTOR_MUTATION_ENABLED',
    'PHASE730_C1_GOOGLE_AI_MASTER_ENABLED',
    'PHASE730_GOOGLE_ADMIN_OPERATIONS_ENABLED',
    'PHASE730_GOOGLE_ADMIN_LEDGER_ENABLED',
  ]
  for (const name of [...operationalServerFlags, ...googleAdminFlags]) {
    const configuredValue = value(environment, name)
    if (configuredValue && !['false', 'true'].includes(configuredValue)) {
      errors.push(`${name} must be true, false or omitted.`)
    }
  }
  if (presenterEnabled && !['false', 'true'].includes(presenterEnabled)) {
    errors.push(
      'PHASE729_POWERPOINT_SYNC_ENABLED must be true, false or omitted.',
    )
  }
  if (
    displayRealtimeEnabled &&
    !['false', 'true'].includes(displayRealtimeEnabled)
  ) {
    errors.push(
      'PHASE728_DISPLAY_REALTIME_ENABLED must be true, false or omitted.',
    )
  }
  if (
    presetCreationEnabled === 'true' &&
    value(environment, 'PHASE7_27_JOURNAL_CLUB_ENABLED') !== 'true'
  ) {
    errors.push(
      'PHASE7_28_JOURNAL_CLUB_PRESET_CREATION_ENABLED=true requires PHASE7_27_JOURNAL_CLUB_ENABLED=true.',
    )
  }
  if (
    displayRealtimeEnabled === 'true' &&
    value(environment, 'PHASE730_GOOGLE_ADMIN_OPERATIONS_ENABLED') !== 'true'
  ) {
    errors.push(
      'PHASE728_DISPLAY_REALTIME_ENABLED=true requires PHASE730_GOOGLE_ADMIN_OPERATIONS_ENABLED=true.',
    )
  }
  const requireServerFlag = (feature, dependency) => {
    if (
      value(environment, feature) === 'true' &&
      value(environment, dependency) !== 'true'
    ) {
      errors.push(`${feature}=true requires ${dependency}=true.`)
    }
  }
  requireServerFlag(
    'PHASE730_ADMIN_AI_UNLOCK_ENABLED',
    'PHASE730_ADMIN_IDENTITY_ENABLED',
  )
  requireServerFlag(
    'PHASE730_ADMIN_TOTP_FACTOR_MUTATION_ENABLED',
    'PHASE730_ADMIN_IDENTITY_ENABLED',
  )
  requireServerFlag(
    'PHASE730_C1_GOOGLE_AI_MASTER_ENABLED',
    'PHASE730_ADMIN_AI_UNLOCK_ENABLED',
  )
  requireServerFlag(
    'PHASE730_C1_GOOGLE_AI_MASTER_ENABLED',
    'PHASE730_GOOGLE_ADMIN_OPERATIONS_ENABLED',
  )
  requireServerFlag(
    'PHASE730_GOOGLE_ADMIN_OPERATIONS_ENABLED',
    'PHASE730_ADMIN_IDENTITY_ENABLED',
  )
  requireServerFlag(
    'PHASE730_GOOGLE_ADMIN_LEDGER_ENABLED',
    'PHASE730_GOOGLE_ADMIN_OPERATIONS_ENABLED',
  )
  for (const feature of operationalServerFlags) {
    requireServerFlag(feature, 'PHASE730_GOOGLE_ADMIN_OPERATIONS_ENABLED')
  }
  const aiProviderEnabled = [
    'PHASE4_REALTIME_CAPTIONS_ENABLED',
    'PHASE5_MATERIAL_ANALYSIS_ENABLED',
    'PHASE6_SUMMARIES_ENABLED',
    'PHASE7_2_ACADEMIC_ANSWERS_ENABLED',
  ].some((name) => value(environment, name) === 'true')
  const googleAiMasterEnabled =
    value(environment, 'PHASE730_C1_GOOGLE_AI_MASTER_ENABLED') === 'true'
  if (aiProviderEnabled || googleAiMasterEnabled) {
    if (!value(environment, 'OPENAI_API_KEY')) {
      errors.push(
        'OPENAI_API_KEY must be configured when lecture AI providers are enabled.',
      )
    }
    const childGrantSecret = value(environment, 'ADMIN_AI_CHILD_GRANT_SECRET')
    if (new TextEncoder().encode(childGrantSecret).byteLength < 32) {
      errors.push(
        'ADMIN_AI_CHILD_GRANT_SECRET must contain at least 32 bytes when lecture AI is enabled.',
      )
    }
    const childGrantVersion = Number(
      value(environment, 'ADMIN_AI_CHILD_GRANT_SECRET_VERSION') || '1',
    )
    if (
      !Number.isSafeInteger(childGrantVersion) ||
      childGrantVersion < 1 ||
      childGrantVersion > 2_147_483_647
    ) {
      errors.push(
        'ADMIN_AI_CHILD_GRANT_SECRET_VERSION must be a positive safe integer.',
      )
    }
  }
  if (presenterEnabled === 'true') {
    if (value(environment, 'PHASE728_DISPLAY_REALTIME_ENABLED') !== 'true') {
      errors.push(
        'PHASE729_POWERPOINT_SYNC_ENABLED=true requires PHASE728_DISPLAY_REALTIME_ENABLED=true.',
      )
    }
    if (
      new TextEncoder().encode(
        value(environment, 'PRESENTER_BRIDGE_TOKEN_SECRET'),
      ).byteLength < 32
    ) {
      errors.push(
        'PRESENTER_BRIDGE_TOKEN_SECRET must contain at least 32 bytes when Phase 7.29 is enabled.',
      )
    }
    if (
      new TextEncoder().encode(
        value(environment, 'PRESENTER_BRIDGE_GATEWAY_SECRET'),
      ).byteLength < 32
    ) {
      errors.push(
        'PRESENTER_BRIDGE_GATEWAY_SECRET must contain at least 32 bytes when Phase 7.29 is enabled.',
      )
    }
    if (
      value(environment, 'PRESENTER_BRIDGE_TOKEN_SECRET') &&
      value(environment, 'PRESENTER_BRIDGE_TOKEN_SECRET') ===
        value(environment, 'PRESENTER_BRIDGE_GATEWAY_SECRET')
    ) {
      errors.push(
        'PRESENTER_BRIDGE_TOKEN_SECRET and PRESENTER_BRIDGE_GATEWAY_SECRET must be distinct trust-boundary secrets.',
      )
    }
  }
  return errors
}

/**
 * Validate redacted, value-free proof that every browser lecture path is
 * activated together. Optional Presenter hardware, remembered-browser
 * convenience and TOTP-factor mutation are intentionally outside this core
 * lecture-cycle gate.
 */
export function validateCompleteLectureProductionTopology(topology) {
  const errors = []
  if (
    !rejectUnknownKeys(
      errors,
      topology,
      ['frontendFlags', 'serverFlags', 'databaseGates', 'runtime'],
      'topology',
    )
  ) {
    return errors
  }

  for (const [path, names] of [
    ['topology.frontendFlags', completeLectureFrontendFlagNames],
    ['topology.serverFlags', completeLectureServerFlagNames],
    ['topology.databaseGates', completeLectureDatabaseGateNames],
  ]) {
    const candidate =
      path === 'topology.frontendFlags'
        ? topology.frontendFlags
        : path === 'topology.serverFlags'
          ? topology.serverFlags
          : topology.databaseGates
    if (!rejectUnknownKeys(errors, candidate, names, path)) continue
    for (const name of names) {
      if (candidate[name] !== true) {
        errors.push(`${path}.${name} must be true.`)
      }
    }
  }

  const runtime = topology.runtime
  if (
    rejectUnknownKeys(
      errors,
      runtime,
      [
        'activeAiPolicyCount',
        'activeAiMembershipCount',
        'activeOwnerCount',
        'aiPolicyAllowedActions',
        'aiPolicyAllowedModels',
        'aiPolicyTopologyComplete',
        'browserPdfWorkerUploadEnabled',
        'canonicalAiPolicyTopologyComplete',
        'coveredAiMembershipCount',
        'productionEnvironmentConfigured',
        'requiredEdgeFunctionsCurrent',
      ],
      'topology.runtime',
    )
  ) {
    const validActiveAiPolicyCount =
      Number.isSafeInteger(runtime.activeAiPolicyCount) &&
      runtime.activeAiPolicyCount > 0
    if (!validActiveAiPolicyCount) {
      errors.push('topology.runtime.activeAiPolicyCount must be at least 1.')
    }
    const validActiveAiMembershipCount =
      Number.isSafeInteger(runtime.activeAiMembershipCount) &&
      runtime.activeAiMembershipCount > 0
    if (!validActiveAiMembershipCount) {
      errors.push(
        'topology.runtime.activeAiMembershipCount must be a positive integer.',
      )
    }
    const validCoveredAiMembershipCount =
      Number.isSafeInteger(runtime.coveredAiMembershipCount) &&
      runtime.coveredAiMembershipCount >= 0
    if (!validCoveredAiMembershipCount) {
      errors.push(
        'topology.runtime.coveredAiMembershipCount must be a non-negative integer.',
      )
    }
    if (
      validActiveAiMembershipCount &&
      validCoveredAiMembershipCount &&
      runtime.coveredAiMembershipCount !== runtime.activeAiMembershipCount
    ) {
      errors.push(
        'topology.runtime AI membership coverage counts must match and be greater than zero.',
      )
    }
    if (
      validActiveAiPolicyCount &&
      validCoveredAiMembershipCount &&
      runtime.activeAiPolicyCount < runtime.coveredAiMembershipCount
    ) {
      errors.push(
        'topology.runtime.activeAiPolicyCount cannot be less than coveredAiMembershipCount.',
      )
    }
    if (runtime.aiPolicyTopologyComplete !== true) {
      errors.push('topology.runtime.aiPolicyTopologyComplete must be true.')
    }
    if (runtime.canonicalAiPolicyTopologyComplete !== true) {
      errors.push(
        'topology.runtime.canonicalAiPolicyTopologyComplete must be true.',
      )
    }
    if (
      !Number.isSafeInteger(runtime.activeOwnerCount) ||
      runtime.activeOwnerCount < 2
    ) {
      errors.push('topology.runtime.activeOwnerCount must be at least 2.')
    }
    const observedActions = Array.isArray(runtime.aiPolicyAllowedActions)
      ? [...new Set(runtime.aiPolicyAllowedActions)].sort()
      : []
    if (
      observedActions.length !== completeLectureAiActions.length ||
      observedActions.some(
        (action, index) => action !== completeLectureAiActions[index],
      )
    ) {
      errors.push(
        'topology.runtime.aiPolicyAllowedActions must contain the exact lecture AI action set.',
      )
    }
    const observedModels = Array.isArray(runtime.aiPolicyAllowedModels)
      ? [...new Set(runtime.aiPolicyAllowedModels)].sort()
      : []
    if (
      observedModels.length !== completeLectureAiModels.length ||
      observedModels.some(
        (model, index) => model !== completeLectureAiModels[index],
      )
    ) {
      errors.push(
        'topology.runtime.aiPolicyAllowedModels must contain the exact lecture AI model set.',
      )
    }
    for (const name of [
      'browserPdfWorkerUploadEnabled',
      'productionEnvironmentConfigured',
      'requiredEdgeFunctionsCurrent',
    ]) {
      if (runtime[name] !== true) {
        errors.push(`topology.runtime.${name} must be true.`)
      }
    }
  }

  return errors
}

function isPlainObject(candidate) {
  return (
    candidate !== null &&
    typeof candidate === 'object' &&
    !Array.isArray(candidate)
  )
}

function rejectUnknownKeys(errors, candidate, allowedKeys, path) {
  if (!isPlainObject(candidate)) {
    errors.push(`${path} must be an object.`)
    return false
  }
  for (const key of Object.keys(candidate)) {
    if (!allowedKeys.includes(key)) {
      errors.push(`${path}.${key} is not allowed.`)
    }
  }
  return true
}

export function isPhase730FEnvironmentAlias(candidate) {
  return (
    typeof candidate === 'string' &&
    candidate.length >= 10 &&
    candidate.length <= 40 &&
    phase730FEnvironmentAliasRegex.test(candidate)
  )
}

export function isPhase730FIsoTimestamp(candidate) {
  if (
    typeof candidate !== 'string' ||
    !phase730FIsoTimestampRegex.test(candidate)
  ) {
    return false
  }
  const parsed = new Date(candidate)
  if (Number.isNaN(parsed.getTime())) return false
  const canonical = candidate.includes('.')
    ? candidate
    : candidate.replace(/Z$/, '.000Z')
  return parsed.toISOString() === canonical
}

/**
 * Validate only redacted Phase 7.30F configuration metadata. This function
 * never accepts or reads an environment-variable value. Missing Hosted
 * inventory is a HOLD evaluated by the evidence validator, not a source
 * configuration error here.
 */
export function validatePhase730FReadinessMetadata(configuration) {
  const errors = []
  if (
    !rejectUnknownKeys(
      errors,
      configuration,
      [
        'environment',
        'frontendFlags',
        'serverFlags',
        'databaseGates',
        'secretInventory',
      ],
      'configuration',
    )
  ) {
    return errors
  }

  const environment = configuration.environment
  if (
    rejectUnknownKeys(
      errors,
      environment,
      [
        'target',
        'alias',
        'sourceCommitSha',
        'capturedAt',
        'environmentIdConfigured',
      ],
      'configuration.environment',
    )
  ) {
    if (environment.target !== 'staging') {
      errors.push('configuration.environment.target must be staging.')
    }
    if (!isPhase730FEnvironmentAlias(environment.alias)) {
      errors.push(
        'configuration.environment.alias must be a non-secret staging alias.',
      )
    }
    if (!/^[0-9a-f]{40}$/.test(environment.sourceCommitSha ?? '')) {
      errors.push(
        'configuration.environment.sourceCommitSha must be an exact 40-hex commit SHA.',
      )
    }
    if (
      environment.capturedAt !== null &&
      !isPhase730FIsoTimestamp(environment.capturedAt)
    ) {
      errors.push(
        'configuration.environment.capturedAt must be null or an ISO UTC timestamp.',
      )
    }
    if (
      environment.environmentIdConfigured === true &&
      !isPhase730FIsoTimestamp(environment.capturedAt)
    ) {
      errors.push(
        'configuration.environment.capturedAt must be an ISO UTC timestamp when an environment ID was observed.',
      )
    }
    if (typeof environment.environmentIdConfigured !== 'boolean') {
      errors.push(
        'configuration.environment.environmentIdConfigured must be boolean metadata.',
      )
    }
  }

  for (const [path, names] of [
    ['configuration.frontendFlags', phase730FFrontendFlagNames],
    ['configuration.serverFlags', phase730FServerFlagNames],
  ]) {
    const flags =
      path === 'configuration.frontendFlags'
        ? configuration.frontendFlags
        : configuration.serverFlags
    if (rejectUnknownKeys(errors, flags, names, path)) {
      for (const name of names) {
        if (typeof flags[name] !== 'boolean') {
          errors.push(`${path}.${name} must be explicit boolean metadata.`)
        } else if (flags[name]) {
          errors.push(`${path}.${name} must remain false before activation.`)
        }
      }
    }
  }

  const databaseGates = configuration.databaseGates
  if (
    rejectUnknownKeys(
      errors,
      databaseGates,
      phase730FDatabaseGateNames,
      'configuration.databaseGates',
    )
  ) {
    for (const name of phase730FDatabaseGateNames) {
      if (typeof databaseGates[name] !== 'boolean') {
        errors.push(
          `configuration.databaseGates.${name} must be explicit boolean metadata.`,
        )
      }
    }
    for (const name of phase730FDatabaseGateNames.filter(
      (name) => name !== 'legacyPinLoginEnabled',
    )) {
      if (databaseGates[name] === true) {
        errors.push(
          `configuration.databaseGates.${name} must remain false before separately approved activation.`,
        )
      }
    }
    if (databaseGates.legacyPinLoginEnabled !== true) {
      errors.push(
        'configuration.databaseGates.legacyPinLoginEnabled must remain true in the pre-cutover source snapshot.',
      )
    }
  }

  const secretInventory = configuration.secretInventory
  if (
    rejectUnknownKeys(
      errors,
      secretInventory,
      ['captured', 'capturedAt', 'entries'],
      'configuration.secretInventory',
    )
  ) {
    if (typeof secretInventory.captured !== 'boolean') {
      errors.push('configuration.secretInventory.captured must be boolean.')
    }
    if (!Array.isArray(secretInventory.entries)) {
      errors.push('configuration.secretInventory.entries must be an array.')
    } else if (secretInventory.captured === false) {
      if (secretInventory.capturedAt !== null) {
        errors.push(
          'configuration.secretInventory.capturedAt must be null until inventory is captured.',
        )
      }
      if (secretInventory.entries.length !== 0) {
        errors.push(
          'configuration.secretInventory.entries must be empty until inventory is captured.',
        )
      }
    } else if (secretInventory.captured === true) {
      if (!isPhase730FIsoTimestamp(secretInventory.capturedAt)) {
        errors.push(
          'configuration.secretInventory.capturedAt must be an ISO UTC timestamp when captured.',
        )
      }
      const observedNames = new Set()
      for (const [index, entry] of secretInventory.entries.entries()) {
        const path = `configuration.secretInventory.entries[${index}]`
        if (
          !rejectUnknownKeys(
            errors,
            entry,
            [
              'name',
              'present',
              'minimumBytesSatisfied',
              'rotationVersion',
              'rotatedAt',
              'removedAt',
            ],
            path,
          )
        ) {
          continue
        }
        if (!phase730FSecretInventoryNames.includes(entry.name)) {
          errors.push(`${path}.name is not an approved metadata-only name.`)
          continue
        }
        if (observedNames.has(entry.name)) {
          errors.push(`${path}.name must not be duplicated.`)
        }
        observedNames.add(entry.name)
        if (typeof entry.present !== 'boolean') {
          errors.push(`${path}.present must be boolean metadata.`)
        }
        if (phase730FForbiddenSecretNames.has(entry.name)) {
          if (
            entry.present !== false ||
            entry.minimumBytesSatisfied !== null ||
            entry.rotationVersion !== null ||
            entry.rotatedAt !== null ||
            !isPhase730FIsoTimestamp(entry.removedAt)
          ) {
            errors.push(
              `${path}.${entry.name} must be absent with null length and rotation metadata.`,
            )
          }
        } else if (
          entry.present !== true ||
          entry.minimumBytesSatisfied !== true ||
          !Number.isSafeInteger(entry.rotationVersion) ||
          entry.rotationVersion < 1 ||
          !isPhase730FIsoTimestamp(entry.rotatedAt) ||
          entry.removedAt !== null
        ) {
          errors.push(
            `${path}.${entry.name} must be present with valid length and rotation metadata.`,
          )
        }
        for (const timestamp of [entry.rotatedAt, entry.removedAt]) {
          if (
            timestamp &&
            isPhase730FIsoTimestamp(secretInventory.capturedAt) &&
            Date.parse(timestamp) > Date.parse(secretInventory.capturedAt)
          ) {
            errors.push(
              `${path} rotation/removal metadata must not postdate inventory capture.`,
            )
          }
        }
      }
      for (const name of phase730FSecretInventoryNames) {
        if (!observedNames.has(name)) {
          errors.push(
            `configuration.secretInventory must record ${name} presence metadata.`,
          )
        }
      }
    }
  }

  return errors
}

export const productionFeatureFlags = [...featureFlags, ...optionalFeatureFlags]
