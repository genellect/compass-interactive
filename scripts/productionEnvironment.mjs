const featureFlags = [
  'VITE_PHASE1_SYNC_PROTOCOL',
  'VITE_PHASE2_LECTURE_LIFECYCLE',
  'VITE_PHASE3_PRIVATE_PDF',
  'VITE_PHASE4_REALTIME_CAPTIONS',
  'VITE_PHASE5_MATERIAL_ANALYSIS',
  'VITE_PHASE6_SUMMARIES',
  'VITE_PHASE6_5_COMMENT_NICKNAMES',
  'VITE_PHASE6_6_UX_INTEGRATION',
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

export const productionFeatureFlags = featureFlags
