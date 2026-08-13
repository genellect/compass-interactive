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
  const googleAdminFlags = [
    'PHASE730_ADMIN_IDENTITY_ENABLED',
    'PHASE730_ADMIN_AI_UNLOCK_ENABLED',
    'PHASE730_ADMIN_TOTP_FACTOR_MUTATION_ENABLED',
    'PHASE730_GOOGLE_ADMIN_OPERATIONS_ENABLED',
    'PHASE730_GOOGLE_ADMIN_LEDGER_ENABLED',
  ]
  for (const name of googleAdminFlags) {
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
    'PHASE730_GOOGLE_ADMIN_OPERATIONS_ENABLED',
    'PHASE730_ADMIN_IDENTITY_ENABLED',
  )
  requireServerFlag(
    'PHASE730_GOOGLE_ADMIN_LEDGER_ENABLED',
    'PHASE730_GOOGLE_ADMIN_OPERATIONS_ENABLED',
  )
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

export const productionFeatureFlags = [...featureFlags, ...optionalFeatureFlags]
