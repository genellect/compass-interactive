import { createClient } from 'npm:@supabase/supabase-js@2'
import {
  canonicalizeBrowserAssertionPayload,
  createOpaqueBrowserToken,
  deriveNetworkHmac,
  derivePepperedPinHmac,
  FOUR_DIGIT_PIN_PATTERN,
  getPinControlCanonicalIntent,
  getPublicP256JwkFingerprint,
  normalizePublicP256Jwk,
  OPAQUE_BROWSER_TOKEN_PATTERN,
  parseBrowserAssertionPayload,
  SHA256_HEX_PATTERN,
  UUID_PATTERN,
  verifyHmacSha256Base64Url,
  verifyP256P1363Signature,
  hmacSha256Base64Url,
} from '../_shared/adminAiUnlock.ts'
import {
  decodeVerifiedAdminJwtClaims,
  getTrustedGoogleIdentity,
  hasOAuthAmr,
  isGoogleAdminSessionToken,
  readSecret,
  sha256Hex,
} from '../_shared/adminIdentity.ts'
import { getAllowedCorsOrigin, handleCors } from '../_shared/cors.ts'
import {
  readJsonBody,
  RequestBodyTooLargeError,
  UnsupportedJsonContentTypeError,
} from '../_shared/requestBody.ts'
import { createJsonResponse } from '../_shared/responses.ts'

type AiUnlockAction =
  | 'authorizeMasterWithPin'
  | 'authorizeTotpTransition'
  | 'beginBrowserAssertion'
  | 'beginBrowserEnrollment'
  | 'completeBrowserAssertion'
  | 'completeBrowserEnrollment'
  | 'completeBrowserMasterAdmission'
  | 'downgradeMaster'
  | 'finalizeTotpTransition'
  | 'getBrowserEnrollmentStatus'
  | 'masterStatus'
  | 'policyStatus'
  | 'preparePinMutation'
  | 'preparePolicyMutation'
  | 'prepareTotpTransition'
  | 'profile'
  | 'resetPin'
  | 'revokeBrowserCredential'
  | 'revokeMaster'
  | 'revokePin'
  | 'setPin'
  | 'setPolicy'
  | 'verifyPin'

type RequestBody = Record<string, unknown> & {
  action?: AiUnlockAction
  appSessionToken?: string
}

type EnvironmentConfig = {
  audience?: string
  canonical_admin_origin?: string
  environment_id?: string
  status?: string
  supabase_issuer?: string
}

type AdminContext = {
  can_use_ai?: boolean
  environment_id?: string
  expires_at?: string
  id?: string
  membership_id?: string
  principal_id?: string
  role?: string
  verified_totp_factor_set_hash?: string
}

type AiProfile = {
  active_browser_count?: number
  active_pin?: boolean
  ai_unlock_enabled?: boolean
  can_use_ai?: boolean
  factor_status?: string | null
  factor_version?: number | null
  pin_pepper_version?: number | null
  remembered_browser_enabled?: boolean
  role?: string
}

type AiRuntimeGate = {
  ai_unlock_enabled?: boolean
  google_ai_master_admission_enabled?: boolean
  remembered_browser_enabled?: boolean
}

type AiPolicyMutationInput = {
  maxCostMicrousdPerDay: number
  maxCostMicrousdPerLecture: number
  requestId: string
  targetMembershipId: string
  validFrom: string
  validUntil: string
}

const ADMIN_AI_POLICY_PRESET = Object.freeze({
  allowedActions: Object.freeze([
    'academic_answers',
    'captions',
    'material_analysis',
    'poll_suggestions',
    'summaries',
  ]),
  allowedModels: Object.freeze(['gpt-5.6-luna', 'gpt-realtime-whisper']),
  maxCallsPerDay: 96,
  maxCallsPerLecture: 24,
  maxConcurrency: 2,
  maxInputTokensPerDay: 800_000,
  maxInputTokensPerLecture: 200_000,
  maxOutputTokensPerDay: 160_000,
  maxOutputTokensPerLecture: 40_000,
  maxRealtimeMinutesPerDay: 180,
  maxRealtimeMinutesPerLecture: 90,
})

const ADMIN_AI_POLICY_VALIDITY_MS = 30 * 24 * 60 * 60 * 1_000
const ADMIN_AI_POLICY_RECOVERY_MS = 24 * 60 * 60 * 1_000
const MIN_POLICY_COST_MICROUSD = 10_000
const MAX_POLICY_LECTURE_COST_MICROUSD = 5_000_000
const MAX_POLICY_DAY_COST_MICROUSD = 20_000_000

const AI_ACTIONS = new Set<AiUnlockAction>([
  'beginBrowserAssertion',
  'beginBrowserEnrollment',
  'completeBrowserAssertion',
  'completeBrowserEnrollment',
  'getBrowserEnrollmentStatus',
  'policyStatus',
  'preparePinMutation',
  'preparePolicyMutation',
  'profile',
  'resetPin',
  'revokeBrowserCredential',
  'revokePin',
  'setPin',
  'setPolicy',
  'verifyPin',
])

const FACTOR_ENTRY_ACTIONS = new Set<AiUnlockAction>([
  'authorizeTotpTransition',
  'prepareTotpTransition',
])

const C1_ADMISSION_ACTIONS = new Set<AiUnlockAction>([
  'authorizeMasterWithPin',
  'completeBrowserMasterAdmission',
])

const ACTION_KEYS: Record<AiUnlockAction, ReadonlySet<string>> = {
  authorizeMasterWithPin: new Set([
    'action',
    'appSessionToken',
    'lectureSessionId',
    'pin',
    'policyId',
    'policyVersion',
    'requestId',
    'requestedScope',
  ]),
  authorizeTotpTransition: new Set([
    'action',
    'appSessionToken',
    'controlIntentDigest',
    'factorAction',
    'recoveryToken',
    'requestId',
    'targetFactorId',
  ]),
  beginBrowserAssertion: new Set([
    'action',
    'appSessionToken',
    'credentialToken',
    'lectureSessionId',
    'policyId',
    'policyVersion',
    'requestId',
    'requestedScope',
  ]),
  beginBrowserEnrollment: new Set([
    'absoluteExpiresAt',
    'action',
    'appSessionToken',
    'browserCredentialId',
    'credentialToken',
    'enrollmentNonce',
    'publicKeyFingerprint',
    'publicKeyJwk',
    'requestId',
  ]),
  completeBrowserAssertion: new Set([
    'action',
    'appSessionToken',
    'assertionPayload',
    'assertionPayloadMac',
    'credentialToken',
    'publicKeyJwk',
    'requestId',
    'signature',
  ]),
  completeBrowserEnrollment: new Set([
    'action',
    'appSessionToken',
    'enrollmentNonce',
    'pin',
    'publicKeyJwk',
    'requestId',
  ]),
  completeBrowserMasterAdmission: new Set([
    'action',
    'appSessionToken',
    'assertionPayload',
    'assertionPayloadMac',
    'credentialToken',
    'publicKeyJwk',
    'requestId',
    'signature',
  ]),
  downgradeMaster: new Set([
    'action',
    'appSessionToken',
    'lectureSessionId',
    'requestId',
  ]),
  finalizeTotpTransition: new Set([
    'action',
    'controlIntentDigest',
    'factorAction',
    'finalizeRequestId',
    'recoveryToken',
    'requestId',
    'targetFactorId',
  ]),
  getBrowserEnrollmentStatus: new Set([
    'action',
    'appSessionToken',
    'browserCredentialId',
    'credentialToken',
    'publicKeyFingerprint',
  ]),
  masterStatus: new Set(['action', 'appSessionToken', 'lectureSessionId']),
  policyStatus: new Set(['action', 'appSessionToken']),
  preparePinMutation: new Set([
    'action',
    'appSessionToken',
    'pin',
    'pinAction',
    'requestId',
  ]),
  preparePolicyMutation: new Set([
    'action',
    'appSessionToken',
    'maxCostMicrousdPerDay',
    'maxCostMicrousdPerLecture',
    'requestId',
    'targetMembershipId',
    'validFrom',
    'validUntil',
  ]),
  prepareTotpTransition: new Set([
    'action',
    'appSessionToken',
    'factorAction',
    'targetFactorId',
  ]),
  profile: new Set(['action', 'appSessionToken']),
  resetPin: new Set(['action', 'appSessionToken', 'requestId']),
  revokeBrowserCredential: new Set([
    'action',
    'appSessionToken',
    'browserCredentialId',
    'requestId',
  ]),
  revokeMaster: new Set([
    'action',
    'appSessionToken',
    'lectureSessionId',
    'reason',
    'requestId',
  ]),
  revokePin: new Set(['action', 'appSessionToken', 'requestId']),
  setPin: new Set(['action', 'appSessionToken', 'pin', 'requestId']),
  setPolicy: new Set([
    'action',
    'appSessionToken',
    'maxCostMicrousdPerDay',
    'maxCostMicrousdPerLecture',
    'requestId',
    'targetMembershipId',
    'validFrom',
    'validUntil',
  ]),
  verifyPin: new Set(['action', 'appSessionToken', 'pin', 'requestId']),
}

function getBearerToken(request: Request) {
  const authorization = request.headers.get('authorization') ?? ''
  return authorization.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length).trim()
    : ''
}

function getEnvironmentId() {
  const value = Deno.env.get('PHASE730_ADMIN_ENVIRONMENT_ID')?.trim() ?? ''
  return UUID_PATTERN.test(value) ? value : null
}

function getPinPepperVersion() {
  const value = Number.parseInt(
    Deno.env.get('ADMIN_AI_PIN_PEPPER_VERSION')?.trim() ?? '1',
    10,
  )
  if (!Number.isSafeInteger(value) || value < 1 || value > 2_147_483_647) {
    throw new Error('Invalid Admin AI PIN pepper version.')
  }
  return value
}

function getPinPepper(version: number) {
  const currentVersion = getPinPepperVersion()
  return readSecret(
    version === currentVersion
      ? 'ADMIN_AI_PIN_PEPPER'
      : `ADMIN_AI_PIN_PEPPER_V${version}`,
  )
}

function errorResponse(
  jsonResponse: ReturnType<typeof createJsonResponse>,
  code: string,
  message: string,
  status: number,
) {
  return jsonResponse({ code, message, ok: false }, status)
}

function rpcErrorResponse(
  jsonResponse: ReturnType<typeof createJsonResponse>,
  code: string,
) {
  if (code === '22023') {
    return errorResponse(
      jsonResponse,
      'request_invalid',
      'Request is invalid.',
      400,
    )
  }
  if (
    code === 'P7300' ||
    code === 'P7320' ||
    code === 'P7321' ||
    code === 'P7331' ||
    code === 'P7336'
  ) {
    return errorResponse(
      jsonResponse,
      'feature_disabled',
      'This Admin control is not enabled.',
      503,
    )
  }
  if (code === 'P7301') {
    const response = errorResponse(
      jsonResponse,
      'rate_limited',
      'Too many attempts were made.',
      429,
    )
    response.headers.set('Retry-After', '300')
    return response
  }
  if (code === 'P7332') {
    return errorResponse(
      jsonResponse,
      'factor_set_adoption_required',
      'Authenticator recovery approval is required.',
      409,
    )
  }
  if (code === 'P7334') {
    return errorResponse(
      jsonResponse,
      'relogin_required',
      'Please sign in again before changing an Authenticator.',
      409,
    )
  }
  if (code === 'P7335') {
    return errorResponse(
      jsonResponse,
      'master_admission_conflict',
      'Lecture AI authorization could not be changed safely.',
      409,
    )
  }
  return errorResponse(
    jsonResponse,
    'service_unavailable',
    'Admin AI control is temporarily unavailable.',
    503,
  )
}

function isString(value: unknown): value is string {
  return typeof value === 'string'
}

function isUuid(value: unknown): value is string {
  return isString(value) && UUID_PATTERN.test(value)
}

function isPositiveInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 1
}

function isSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value)
}

function isCanonicalIsoTimestamp(value: unknown): value is string {
  if (!isString(value)) return false
  const timestamp = Date.parse(value)
  return (
    Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value
  )
}

function getAiPolicyMutationInput(body: RequestBody) {
  if (
    !isUuid(body.targetMembershipId) ||
    !isUuid(body.requestId) ||
    !isCanonicalIsoTimestamp(body.validFrom) ||
    !isCanonicalIsoTimestamp(body.validUntil) ||
    !isSafeInteger(body.maxCostMicrousdPerLecture) ||
    !isSafeInteger(body.maxCostMicrousdPerDay)
  ) {
    return null
  }
  const validFromMs = Date.parse(body.validFrom)
  const validUntilMs = Date.parse(body.validUntil)
  const now = Date.now()
  if (
    body.maxCostMicrousdPerLecture < MIN_POLICY_COST_MICROUSD ||
    body.maxCostMicrousdPerLecture > MAX_POLICY_LECTURE_COST_MICROUSD ||
    body.maxCostMicrousdPerDay < body.maxCostMicrousdPerLecture ||
    body.maxCostMicrousdPerDay > MAX_POLICY_DAY_COST_MICROUSD ||
    validFromMs > now ||
    validFromMs < now - ADMIN_AI_POLICY_RECOVERY_MS ||
    validUntilMs <= now ||
    validUntilMs - validFromMs !== ADMIN_AI_POLICY_VALIDITY_MS
  ) {
    return null
  }
  return {
    maxCostMicrousdPerDay: body.maxCostMicrousdPerDay,
    maxCostMicrousdPerLecture: body.maxCostMicrousdPerLecture,
    requestId: body.requestId,
    targetMembershipId: body.targetMembershipId,
    validFrom: body.validFrom,
    validUntil: body.validUntil,
  } satisfies AiPolicyMutationInput
}

function getAiPolicyRpcArgs(
  input: AiPolicyMutationInput,
  identity: {
    authUserId: string
    authSessionId: string
    tokenHash: string
  },
) {
  return {
    target_allowed_actions: [...ADMIN_AI_POLICY_PRESET.allowedActions],
    target_allowed_models: [...ADMIN_AI_POLICY_PRESET.allowedModels],
    target_auth_user_id: identity.authUserId,
    target_max_calls_per_day: ADMIN_AI_POLICY_PRESET.maxCallsPerDay,
    target_max_calls_per_lecture: ADMIN_AI_POLICY_PRESET.maxCallsPerLecture,
    target_max_concurrency: ADMIN_AI_POLICY_PRESET.maxConcurrency,
    target_max_cost_microusd_per_day: input.maxCostMicrousdPerDay,
    target_max_cost_microusd_per_lecture: input.maxCostMicrousdPerLecture,
    target_max_input_tokens_per_day:
      ADMIN_AI_POLICY_PRESET.maxInputTokensPerDay,
    target_max_input_tokens_per_lecture:
      ADMIN_AI_POLICY_PRESET.maxInputTokensPerLecture,
    target_max_output_tokens_per_day:
      ADMIN_AI_POLICY_PRESET.maxOutputTokensPerDay,
    target_max_output_tokens_per_lecture:
      ADMIN_AI_POLICY_PRESET.maxOutputTokensPerLecture,
    target_max_realtime_minutes_per_day:
      ADMIN_AI_POLICY_PRESET.maxRealtimeMinutesPerDay,
    target_max_realtime_minutes_per_lecture:
      ADMIN_AI_POLICY_PRESET.maxRealtimeMinutesPerLecture,
    target_membership_id: input.targetMembershipId,
    target_request_id: input.requestId,
    target_supabase_auth_session_id: identity.authSessionId,
    target_token_hash: identity.tokenHash,
    target_valid_from: input.validFrom,
    target_valid_until: input.validUntil,
  }
}

function masterResultResponse(
  jsonResponse: ReturnType<typeof createJsonResponse>,
  value: Record<string, unknown> | null,
) {
  if (!value || value.accepted !== true) {
    return errorResponse(
      jsonResponse,
      'master_admission_unavailable',
      'Lecture AI authorization is unavailable.',
      409,
    )
  }
  return jsonResponse({
    accepted: true,
    admissionReplayed: value.admission_replayed === true,
    alreadyDowngraded: value.already_downgraded === true,
    alreadyInactive: value.already_inactive === true,
    authorization: value.authorization ?? null,
    controlReplayed: value.control_replayed === true,
    dormantAuthority: true,
    ok: true,
    providerAuthorityIssued: false,
    serverTime: value.server_time ?? null,
  })
}

async function handleRequest(request: Request) {
  const jsonResponse = createJsonResponse(request)
  const corsResponse = handleCors(request)
  if (corsResponse) return corsResponse
  const requestOrigin = getAllowedCorsOrigin(request)
  if (!requestOrigin) {
    return errorResponse(
      jsonResponse,
      'origin_required',
      'Admin AI control is not available from this origin.',
      403,
    )
  }
  if (request.method !== 'POST') {
    return errorResponse(
      jsonResponse,
      'method_not_allowed',
      'Method not allowed.',
      405,
    )
  }

  let body: RequestBody
  try {
    body = await readJsonBody<RequestBody>(request, 12_288)
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) {
      return errorResponse(
        jsonResponse,
        'request_too_large',
        'Request is too large.',
        413,
      )
    }
    if (error instanceof UnsupportedJsonContentTypeError) {
      return errorResponse(
        jsonResponse,
        'content_type_invalid',
        'Request must be JSON.',
        415,
      )
    }
    return errorResponse(
      jsonResponse,
      'request_invalid',
      'Request is invalid.',
      400,
    )
  }
  if (
    !body ||
    typeof body !== 'object' ||
    Array.isArray(body) ||
    !body.action ||
    !(body.action in ACTION_KEYS) ||
    Object.keys(body).some((key) => !ACTION_KEYS[body.action!].has(key))
  ) {
    return errorResponse(
      jsonResponse,
      'request_invalid',
      'Request is invalid.',
      400,
    )
  }

  const action = body.action
  const aiSourceEnabled =
    Deno.env.get('PHASE730_ADMIN_AI_UNLOCK_ENABLED') === 'true'
  const factorSourceEnabled =
    Deno.env.get('PHASE730_ADMIN_TOTP_FACTOR_MUTATION_ENABLED') === 'true'
  const c1AdmissionSourceEnabled =
    Deno.env.get('PHASE730_C1_GOOGLE_AI_MASTER_ENABLED') === 'true'
  const c1AdmissionSourceAllowed =
    !C1_ADMISSION_ACTIONS.has(action) || c1AdmissionSourceEnabled
  if (
    (AI_ACTIONS.has(action) && !aiSourceEnabled) ||
    (FACTOR_ENTRY_ACTIONS.has(action) && !factorSourceEnabled)
  ) {
    return errorResponse(
      jsonResponse,
      'feature_disabled',
      'This Admin control is not enabled.',
      503,
    )
  }

  const environmentId = getEnvironmentId()
  const supabaseUrl = Deno.env.get('SUPABASE_URL')?.trim()
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')?.trim()
  if (!environmentId || !supabaseUrl || !serviceRoleKey) {
    return errorResponse(
      jsonResponse,
      'service_unavailable',
      'Admin AI control is not configured.',
      503,
    )
  }

  const appSessionToken = isString(body.appSessionToken)
    ? body.appSessionToken.trim()
    : ''
  const bearerToken = getBearerToken(request)
  const isRecoveryFinalize = action === 'finalizeTotpTransition'
  if (
    !bearerToken ||
    (!isRecoveryFinalize && !isGoogleAdminSessionToken(appSessionToken))
  ) {
    return errorResponse(
      jsonResponse,
      'identity_invalid',
      'Admin identity could not be verified.',
      401,
    )
  }

  const serviceClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const { data: userData, error: userError } =
    await serviceClient.auth.getUser(bearerToken)
  const claims = decodeVerifiedAdminJwtClaims(bearerToken)
  const trustedGoogleIdentity = getTrustedGoogleIdentity(
    userData.user?.identities,
  )
  if (
    userError ||
    !userData.user ||
    userData.user.is_anonymous === true ||
    !claims ||
    claims.subject !== userData.user.id ||
    claims.aal !== 'aal2' ||
    !hasOAuthAmr(claims) ||
    !trustedGoogleIdentity ||
    !userData.user.factors?.some(
      (factor) => factor.factor_type === 'totp' && factor.status === 'verified',
    )
  ) {
    return errorResponse(
      jsonResponse,
      'identity_invalid',
      'Admin identity could not be verified.',
      401,
    )
  }

  const { data: assurance, error: assuranceError } =
    await serviceClient.auth.mfa.getAuthenticatorAssuranceLevel(bearerToken)
  if (
    assuranceError ||
    assurance?.currentLevel !== 'aal2' ||
    assurance.nextLevel !== 'aal2'
  ) {
    return errorResponse(
      jsonResponse,
      'aal2_required',
      'Authenticator verification is required.',
      401,
    )
  }

  const environmentResult = await serviceClient.rpc(
    'get_admin_identity_environment_v1',
    { target_environment_id: environmentId },
  )
  const environment = environmentResult.data as EnvironmentConfig | null
  if (
    environmentResult.error ||
    !environment ||
    environment.environment_id !== environmentId ||
    environment.status !== 'active' ||
    environment.canonical_admin_origin !== requestOrigin ||
    environment.supabase_issuer !== claims.issuer ||
    !environment.audience ||
    !claims.audience.includes(environment.audience)
  ) {
    return errorResponse(
      jsonResponse,
      'identity_invalid',
      'Admin identity could not be verified.',
      401,
    )
  }

  const tokenHash = isRecoveryFinalize ? '' : await sha256Hex(appSessionToken)
  let context: AdminContext | null = null
  if (action !== 'finalizeTotpTransition') {
    const contextResult = await serviceClient.rpc(
      'verify_and_touch_google_admin_session_v1',
      {
        target_auth_user_id: userData.user.id,
        target_supabase_auth_session_id: claims.sessionId,
        target_token_hash: tokenHash,
      },
    )
    context = contextResult.data as AdminContext | null
    if (
      contextResult.error ||
      !context ||
      !isUuid(context.id) ||
      !isUuid(context.environment_id) ||
      context.environment_id !== environmentId ||
      !isUuid(context.principal_id) ||
      !isUuid(context.membership_id) ||
      !SHA256_HEX_PATTERN.test(context.verified_totp_factor_set_hash ?? '')
    ) {
      return contextResult.error
        ? rpcErrorResponse(jsonResponse, contextResult.error.code)
        : errorResponse(
            jsonResponse,
            'app_session_invalid',
            'Admin session is no longer available.',
            401,
          )
    }
  }

  let profile: AiProfile | null = null
  if (AI_ACTIONS.has(action)) {
    const profileResult = await serviceClient.rpc(
      'get_admin_ai_unlock_profile_v1',
      {
        target_auth_user_id: userData.user.id,
        target_supabase_auth_session_id: claims.sessionId,
        target_token_hash: tokenHash,
      },
    )
    profile = profileResult.data as AiProfile | null
    if (profileResult.error) {
      return rpcErrorResponse(jsonResponse, profileResult.error.code)
    }
    if (!profile) {
      return errorResponse(
        jsonResponse,
        'app_session_invalid',
        'Admin session is no longer available.',
        401,
      )
    }
    if (!profile.ai_unlock_enabled) {
      return errorResponse(
        jsonResponse,
        'feature_disabled',
        'Admin AI unlock is not enabled.',
        503,
      )
    }
  }

  async function requireC1AdmissionGate(requiresRememberedBrowser: boolean) {
    const gateResult = await serviceClient.rpc(
      'get_admin_ai_unlock_runtime_gate_v1',
    )
    if (gateResult.error) {
      return rpcErrorResponse(jsonResponse, gateResult.error.code)
    }
    const gate = gateResult.data as AiRuntimeGate | null
    if (
      !gate ||
      typeof gate.ai_unlock_enabled !== 'boolean' ||
      typeof gate.google_ai_master_admission_enabled !== 'boolean' ||
      typeof gate.remembered_browser_enabled !== 'boolean'
    ) {
      return errorResponse(
        jsonResponse,
        'service_unavailable',
        'Lecture AI authorization is not configured.',
        503,
      )
    }
    if (
      gate.ai_unlock_enabled !== true ||
      gate.google_ai_master_admission_enabled !== true ||
      (requiresRememberedBrowser && gate.remembered_browser_enabled !== true)
    ) {
      return errorResponse(
        jsonResponse,
        'feature_disabled',
        'Lecture AI authorization is not enabled.',
        503,
      )
    }
    return null
  }

  if (action === 'policyStatus') {
    if (context!.role !== 'owner') {
      return errorResponse(
        jsonResponse,
        'owner_required',
        'Owner authority is required.',
        403,
      )
    }
    const result = await serviceClient.rpc('get_admin_ai_policy_status_v1', {
      target_auth_user_id: userData.user.id,
      target_supabase_auth_session_id: claims.sessionId,
      target_token_hash: tokenHash,
    })
    if (result.error) return rpcErrorResponse(jsonResponse, result.error.code)
    const value = result.data as Record<string, unknown> | null
    const rawMemberships = Array.isArray(value?.memberships)
      ? value.memberships
      : null
    const activeAiMembershipCount = Number(value?.active_ai_membership_count)
    const coveredMembershipCount = Number(value?.covered_membership_count)
    if (
      !value ||
      !rawMemberships ||
      !Number.isSafeInteger(activeAiMembershipCount) ||
      activeAiMembershipCount < 0 ||
      !Number.isSafeInteger(coveredMembershipCount) ||
      coveredMembershipCount < 0
    ) {
      return errorResponse(
        jsonResponse,
        'policy_status_unavailable',
        'Lecture AI policy status is unavailable.',
        409,
      )
    }
    const memberships = rawMemberships.map((entry) => {
      const policy =
        entry && typeof entry === 'object'
          ? (entry as Record<string, unknown>)
          : {}
      return {
        covered: policy.covered === true,
        maxCostMicrousdPerDay:
          typeof policy.max_cost_microusd_per_day === 'number'
            ? policy.max_cost_microusd_per_day
            : null,
        maxCostMicrousdPerLecture:
          typeof policy.max_cost_microusd_per_lecture === 'number'
            ? policy.max_cost_microusd_per_lecture
            : null,
        membershipId: isUuid(policy.membership_id)
          ? policy.membership_id
          : null,
        policyId: isUuid(policy.policy_id) ? policy.policy_id : null,
        policyStatus: isString(policy.policy_status)
          ? policy.policy_status
          : null,
        policyVersion:
          typeof policy.policy_version === 'number'
            ? policy.policy_version
            : null,
        validFrom: isString(policy.valid_from) ? policy.valid_from : null,
        validUntil: isString(policy.valid_until) ? policy.valid_until : null,
      }
    })
    if (memberships.some((membership) => !membership.membershipId)) {
      return errorResponse(
        jsonResponse,
        'policy_status_unavailable',
        'Lecture AI policy status is unavailable.',
        409,
      )
    }
    return jsonResponse({
      activeAiMembershipCount,
      canonicalPolicyTopologyComplete:
        value.canonical_policy_topology_complete === true,
      coveredMembershipCount,
      memberships,
      ok: true,
      topologyComplete: value.topology_complete === true,
    })
  }

  if (action === 'preparePolicyMutation' || action === 'setPolicy') {
    if (context!.role !== 'owner') {
      return errorResponse(
        jsonResponse,
        'owner_required',
        'Owner authority is required.',
        403,
      )
    }
    const input = getAiPolicyMutationInput(body)
    if (!input) {
      return errorResponse(
        jsonResponse,
        'request_invalid',
        'Request is invalid.',
        400,
      )
    }
    const rpcArgs = getAiPolicyRpcArgs(input, {
      authSessionId: claims.sessionId,
      authUserId: userData.user.id,
      tokenHash,
    })
    if (action === 'preparePolicyMutation') {
      const result = await serviceClient.rpc(
        'prepare_admin_ai_policy_change_v1',
        rpcArgs,
      )
      if (result.error) return rpcErrorResponse(jsonResponse, result.error.code)
      const value = result.data as Record<string, unknown> | null
      if (
        !value ||
        value.control_action !== 'environment_ai_policy_change' ||
        !isString(value.control_intent_digest) ||
        !SHA256_HEX_PATTERN.test(value.control_intent_digest) ||
        value.request_id !== input.requestId ||
        value.target_membership_id !== input.targetMembershipId
      ) {
        return errorResponse(
          jsonResponse,
          'policy_target_unavailable',
          'The selected AI-enabled membership is unavailable.',
          409,
        )
      }
      return jsonResponse({
        controlAction: 'environment_ai_policy_change',
        controlIntentDigest: value.control_intent_digest,
        ok: true,
        requestId: input.requestId,
        targetMembershipId: input.targetMembershipId,
      })
    }

    const result = await serviceClient.rpc('set_admin_ai_policy_v1', rpcArgs)
    if (result.error) return rpcErrorResponse(jsonResponse, result.error.code)
    const value = result.data as Record<string, unknown> | null
    if (
      !value ||
      !isUuid(value.id) ||
      value.membership_id !== input.targetMembershipId ||
      value.status !== 'active' ||
      !isPositiveInteger(Number(value.version))
    ) {
      return errorResponse(
        jsonResponse,
        'control_proof_required',
        'Fresh control approval is required.',
        409,
      )
    }
    return jsonResponse({
      membershipId: input.targetMembershipId,
      ok: true,
      policyId: value.id,
      status: value.status,
      version: Number(value.version),
    })
  }

  if (action === 'masterStatus') {
    if (!isUuid(body.lectureSessionId)) {
      return errorResponse(
        jsonResponse,
        'request_invalid',
        'Request is invalid.',
        400,
      )
    }
    const result = await serviceClient.rpc('get_google_ai_master_status_v1', {
      target_auth_user_id: userData.user.id,
      target_lecture_session_id: body.lectureSessionId,
      target_supabase_auth_session_id: claims.sessionId,
      target_token_hash: tokenHash,
    })
    if (result.error) return rpcErrorResponse(jsonResponse, result.error.code)
    const value = result.data as Record<string, unknown> | null
    if (!value) {
      return errorResponse(
        jsonResponse,
        'master_status_unavailable',
        'Lecture AI authorization status is unavailable.',
        409,
      )
    }
    return jsonResponse({
      admissionBlockedReason: value.admission_blocked_reason ?? null,
      admissionEnabled: value.admission_enabled === true,
      allowedScopes: value.allowed_scopes ?? [],
      authorization: value.authorization ?? null,
      canUseAi: value.can_use_ai === true,
      dormantAuthority: true,
      lectureOpen: value.lecture_open === true,
      ok: true,
      policy: value.policy ?? null,
      providerAuthorityIssued: false,
      reason: value.reason ?? null,
      serverTime: value.server_time ?? null,
    })
  }

  if (action === 'downgradeMaster') {
    if (!isUuid(body.lectureSessionId) || !isUuid(body.requestId)) {
      return errorResponse(
        jsonResponse,
        'request_invalid',
        'Request is invalid.',
        400,
      )
    }
    const result = await serviceClient.rpc('downgrade_google_ai_master_v1', {
      target_auth_user_id: userData.user.id,
      target_lecture_session_id: body.lectureSessionId,
      target_request_id: body.requestId,
      target_supabase_auth_session_id: claims.sessionId,
      target_token_hash: tokenHash,
    })
    if (result.error) return rpcErrorResponse(jsonResponse, result.error.code)
    return masterResultResponse(
      jsonResponse,
      result.data as Record<string, unknown> | null,
    )
  }

  if (action === 'revokeMaster') {
    const reason = isString(body.reason) ? body.reason.trim() : ''
    if (
      !isUuid(body.lectureSessionId) ||
      !isUuid(body.requestId) ||
      reason.length < 1 ||
      reason.length > 120
    ) {
      return errorResponse(
        jsonResponse,
        'request_invalid',
        'Request is invalid.',
        400,
      )
    }
    const result = await serviceClient.rpc('revoke_google_ai_master_v1', {
      target_auth_user_id: userData.user.id,
      target_lecture_session_id: body.lectureSessionId,
      target_reason: reason,
      target_request_id: body.requestId,
      target_supabase_auth_session_id: claims.sessionId,
      target_token_hash: tokenHash,
    })
    if (result.error) return rpcErrorResponse(jsonResponse, result.error.code)
    return masterResultResponse(
      jsonResponse,
      result.data as Record<string, unknown> | null,
    )
  }

  if (action === 'authorizeMasterWithPin') {
    if (
      !isString(body.pin) ||
      !FOUR_DIGIT_PIN_PATTERN.test(body.pin) ||
      !isUuid(body.lectureSessionId) ||
      !isUuid(body.policyId) ||
      !isPositiveInteger(body.policyVersion) ||
      (body.requestedScope !== 'all_except_captions' &&
        body.requestedScope !== 'all_including_captions') ||
      !isUuid(body.requestId)
    ) {
      return errorResponse(
        jsonResponse,
        'request_invalid',
        'Request is invalid.',
        400,
      )
    }

    const replay = await serviceClient.rpc(
      'replay_google_ai_master_admission_v1',
      {
        target_auth_user_id: userData.user.id,
        target_lecture_session_id: body.lectureSessionId,
        target_policy_id: body.policyId,
        target_policy_version: body.policyVersion,
        target_request_id: body.requestId,
        target_scope: body.requestedScope,
        target_supabase_auth_session_id: claims.sessionId,
        target_token_hash: tokenHash,
        target_unlock_method: 'ai_pin',
      },
    )
    if (replay.error) return rpcErrorResponse(jsonResponse, replay.error.code)
    if (replay.data) {
      return masterResultResponse(
        jsonResponse,
        replay.data as Record<string, unknown>,
      )
    }
    if (!c1AdmissionSourceAllowed || !aiSourceEnabled) {
      return errorResponse(
        jsonResponse,
        'feature_disabled',
        'Lecture AI authorization is not enabled.',
        503,
      )
    }
    const gateError = await requireC1AdmissionGate(false)
    if (gateError) return gateError

    const profileResult = await serviceClient.rpc(
      'get_admin_ai_unlock_profile_v1',
      {
        target_auth_user_id: userData.user.id,
        target_supabase_auth_session_id: claims.sessionId,
        target_token_hash: tokenHash,
      },
    )
    const admissionProfile = profileResult.data as AiProfile | null
    if (
      profileResult.error ||
      !admissionProfile ||
      !isPositiveInteger(admissionProfile.pin_pepper_version)
    ) {
      return profileResult.error
        ? rpcErrorResponse(jsonResponse, profileResult.error.code)
        : errorResponse(
            jsonResponse,
            'service_unavailable',
            'Lecture AI authorization is not configured.',
            503,
          )
    }

    try {
      const networkHmac = await deriveNetworkHmac(
        request,
        readSecret('ADMIN_AI_NETWORK_PEPPER'),
      )
      const version = admissionProfile.pin_pepper_version
      const pinHmac = await derivePepperedPinHmac(
        body.pin,
        version,
        getPinPepper(version),
      )
      const result = await serviceClient.rpc(
        'authorize_google_ai_master_with_pin_v1',
        {
          target_auth_user_id: userData.user.id,
          target_lecture_session_id: body.lectureSessionId,
          target_network_hmac: networkHmac,
          target_peppered_pin_hmac: pinHmac,
          target_pin_pepper_version: version,
          target_policy_id: body.policyId,
          target_policy_version: body.policyVersion,
          target_request_id: body.requestId,
          target_scope: body.requestedScope,
          target_supabase_auth_session_id: claims.sessionId,
          target_token_hash: tokenHash,
        },
      )
      if (result.error) return rpcErrorResponse(jsonResponse, result.error.code)
      const value = result.data as Record<string, unknown> | null
      if (value?.accepted === true)
        return masterResultResponse(jsonResponse, value)
      const retryAfter = Number(value?.retry_after_seconds ?? 0)
      const response = errorResponse(
        jsonResponse,
        retryAfter > 0 ? 'rate_limited' : 'pin_denied',
        'AI PIN could not be verified.',
        retryAfter > 0 ? 429 : 401,
      )
      if (retryAfter > 0) {
        response.headers.set('Retry-After', String(Math.min(900, retryAfter)))
      }
      return response
    } catch {
      return errorResponse(
        jsonResponse,
        'service_unavailable',
        'Lecture AI authorization is not configured.',
        503,
      )
    }
  }

  if (action === 'completeBrowserMasterAdmission') {
    const jwk = normalizePublicP256Jwk(body.publicKeyJwk)
    const parsed = isString(body.assertionPayload)
      ? parseBrowserAssertionPayload(body.assertionPayload)
      : null
    if (
      !jwk ||
      !parsed ||
      canonicalizeBrowserAssertionPayload(parsed) !== body.assertionPayload ||
      !isString(body.assertionPayloadMac) ||
      !isString(body.signature) ||
      !isString(body.credentialToken) ||
      !OPAQUE_BROWSER_TOKEN_PATTERN.test(body.credentialToken) ||
      !isUuid(body.requestId) ||
      parsed.origin !== requestOrigin ||
      parsed.adminSessionId !== context!.id ||
      parsed.authSessionId !== claims.sessionId ||
      parsed.publicKeyFingerprint !== (await getPublicP256JwkFingerprint(jwk))
    ) {
      return errorResponse(
        jsonResponse,
        'request_invalid',
        'Request is invalid.',
        400,
      )
    }

    const replay = await serviceClient.rpc(
      'replay_google_ai_master_admission_v1',
      {
        target_auth_user_id: userData.user.id,
        target_lecture_session_id: parsed.lectureSessionId,
        target_policy_id: parsed.policyId,
        target_policy_version: parsed.policyVersion,
        target_request_id: body.requestId,
        target_scope: parsed.requestedScope,
        target_supabase_auth_session_id: claims.sessionId,
        target_token_hash: tokenHash,
        target_unlock_method: 'remembered_browser',
      },
    )
    if (replay.error) return rpcErrorResponse(jsonResponse, replay.error.code)
    if (replay.data) {
      return masterResultResponse(
        jsonResponse,
        replay.data as Record<string, unknown>,
      )
    }
    if (!c1AdmissionSourceAllowed || !aiSourceEnabled) {
      return errorResponse(
        jsonResponse,
        'feature_disabled',
        'Lecture AI authorization is not enabled.',
        503,
      )
    }
    const gateError = await requireC1AdmissionGate(true)
    if (gateError) return gateError
    if (
      Date.parse(parsed.expiresAt) <= Date.now() ||
      Date.parse(parsed.expiresAt) > Date.now() + 5 * 60 * 1_000
    ) {
      return errorResponse(
        jsonResponse,
        'assertion_invalid',
        'Remembered-browser proof is invalid.',
        409,
      )
    }

    let challengeSecret: string
    try {
      challengeSecret = readSecret('ADMIN_AI_BROWSER_CHALLENGE_SECRET')
    } catch {
      return errorResponse(
        jsonResponse,
        'service_unavailable',
        'Remembered-browser proof is not configured.',
        503,
      )
    }
    if (
      !(await verifyHmacSha256Base64Url(
        challengeSecret,
        body.assertionPayload,
        body.assertionPayloadMac,
      ))
    ) {
      return errorResponse(
        jsonResponse,
        'assertion_invalid',
        'Remembered-browser proof is invalid.',
        409,
      )
    }
    const signatureVerified = await verifyP256P1363Signature(
      jwk,
      body.assertionPayload,
      body.signature,
    )
    const result = await serviceClient.rpc(
      'complete_google_ai_master_browser_admission_v1',
      {
        target_assertion_payload_hash: await sha256Hex(body.assertionPayload),
        target_auth_user_id: userData.user.id,
        target_challenge_hash: await sha256Hex(parsed.challenge),
        target_credential_hash: await sha256Hex(body.credentialToken),
        target_lecture_session_id: parsed.lectureSessionId,
        target_origin: requestOrigin,
        target_policy_id: parsed.policyId,
        target_policy_version: parsed.policyVersion,
        target_request_id: body.requestId,
        target_scope: parsed.requestedScope,
        target_signature_verified: signatureVerified,
        target_supabase_auth_session_id: claims.sessionId,
        target_token_hash: tokenHash,
      },
    )
    if (result.error) return rpcErrorResponse(jsonResponse, result.error.code)
    const value = result.data as Record<string, unknown> | null
    if (!signatureVerified || !value) {
      return errorResponse(
        jsonResponse,
        'assertion_invalid',
        'Remembered-browser proof is invalid.',
        401,
      )
    }
    return masterResultResponse(jsonResponse, value)
  }

  if (action === 'profile') {
    return jsonResponse({
      activeBrowserCount: profile!.active_browser_count ?? 0,
      activePin: profile!.active_pin === true,
      canUseAi: profile!.can_use_ai === true,
      factorStatus: profile!.factor_status ?? null,
      factorVersion: profile!.factor_version ?? null,
      ok: true,
      pinPepperVersion: profile!.pin_pepper_version ?? null,
      rememberedBrowserEnabled: profile!.remembered_browser_enabled === true,
      role: profile!.role ?? null,
    })
  }

  if (action === 'preparePinMutation') {
    if (
      !isString(body.pin) ||
      !FOUR_DIGIT_PIN_PATTERN.test(body.pin) ||
      (body.pinAction !== 'enroll' && body.pinAction !== 'rotate') ||
      !isUuid(body.requestId)
    ) {
      return errorResponse(
        jsonResponse,
        'request_invalid',
        'Request is invalid.',
        400,
      )
    }
    try {
      const version = getPinPepperVersion()
      const pinHmac = await derivePepperedPinHmac(
        body.pin,
        version,
        getPinPepper(version),
      )
      const controlAction =
        body.pinAction === 'rotate' ? 'ai_pin_rotate' : 'ai_pin_enroll'
      const controlIntentDigest = await sha256Hex(
        getPinControlCanonicalIntent(controlAction, version, pinHmac),
      )
      return jsonResponse({
        controlAction,
        controlIntentDigest,
        ok: true,
        pinPepperVersion: version,
        requestId: body.requestId,
      })
    } catch {
      return errorResponse(
        jsonResponse,
        'service_unavailable',
        'Admin AI control is not configured.',
        503,
      )
    }
  }

  if (action === 'setPin') {
    if (
      !isString(body.pin) ||
      !FOUR_DIGIT_PIN_PATTERN.test(body.pin) ||
      !isUuid(body.requestId)
    ) {
      return errorResponse(
        jsonResponse,
        'request_invalid',
        'Request is invalid.',
        400,
      )
    }
    try {
      const version = getPinPepperVersion()
      const pinHmac = await derivePepperedPinHmac(
        body.pin,
        version,
        getPinPepper(version),
      )
      const result = await serviceClient.rpc('enroll_admin_ai_pin_v1', {
        target_auth_user_id: userData.user.id,
        target_peppered_pin_hmac: pinHmac,
        target_pin_pepper_version: version,
        target_request_id: body.requestId,
        target_supabase_auth_session_id: claims.sessionId,
        target_token_hash: tokenHash,
      })
      if (result.error) return rpcErrorResponse(jsonResponse, result.error.code)
      if (!result.data) {
        return errorResponse(
          jsonResponse,
          'control_proof_required',
          'Fresh control approval is required.',
          409,
        )
      }
      const value = result.data as Record<string, unknown>
      return jsonResponse({
        factorVersion: value.factor_version ?? null,
        ok: true,
        status: value.status ?? null,
      })
    } catch {
      return errorResponse(
        jsonResponse,
        'service_unavailable',
        'Admin AI control is not configured.',
        503,
      )
    }
  }

  if (action === 'revokePin' || action === 'resetPin') {
    if (!isUuid(body.requestId)) {
      return errorResponse(
        jsonResponse,
        'request_invalid',
        'Request is invalid.',
        400,
      )
    }
    const result = await serviceClient.rpc(
      action === 'revokePin'
        ? 'revoke_admin_ai_pin_v1'
        : 'reset_admin_ai_pin_v1',
      {
        target_auth_user_id: userData.user.id,
        target_request_id: body.requestId,
        target_supabase_auth_session_id: claims.sessionId,
        target_token_hash: tokenHash,
      },
    )
    if (result.error) return rpcErrorResponse(jsonResponse, result.error.code)
    if (!result.data) {
      return errorResponse(
        jsonResponse,
        'control_proof_required',
        'Fresh control approval is required.',
        409,
      )
    }
    return jsonResponse({ ok: true, status: 'revoked' })
  }

  if (action === 'verifyPin') {
    if (
      !isString(body.pin) ||
      !FOUR_DIGIT_PIN_PATTERN.test(body.pin) ||
      !isUuid(body.requestId)
    ) {
      return errorResponse(
        jsonResponse,
        'request_invalid',
        'Request is invalid.',
        400,
      )
    }
    let networkHmac: string
    try {
      networkHmac = await deriveNetworkHmac(
        request,
        readSecret('ADMIN_AI_NETWORK_PEPPER'),
      )
    } catch {
      return errorResponse(
        jsonResponse,
        'service_unavailable',
        'Admin AI control is not configured.',
        503,
      )
    }
    const intentDigest = await sha256Hex(
      `compass:phase7.30:pin-verify:v1|request_id=${body.requestId}|admin_session_id=${context!.id}`,
    )
    const metadata = await serviceClient.rpc(
      'get_admin_ai_pin_factor_metadata_v1',
      {
        target_auth_user_id: userData.user.id,
        target_intent_digest: intentDigest,
        target_network_hmac: networkHmac,
        target_request_id: body.requestId,
        target_supabase_auth_session_id: claims.sessionId,
        target_token_hash: tokenHash,
      },
    )
    if (metadata.error)
      return rpcErrorResponse(jsonResponse, metadata.error.code)
    const metadataValue = metadata.data as Record<string, unknown> | null
    if (!metadataValue || metadataValue.available !== true) {
      return jsonResponse({
        ok: false,
        reasonCode: metadataValue?.reason_code ?? 'invalid_unlock',
        retryAfterSeconds: metadataValue?.retry_after_seconds ?? 0,
        verified: false,
      })
    }
    const version = metadataValue.pin_pepper_version
    if (!isPositiveInteger(version)) {
      return errorResponse(
        jsonResponse,
        'service_unavailable',
        'Admin AI control is temporarily unavailable.',
        503,
      )
    }
    try {
      const pinHmac = await derivePepperedPinHmac(
        body.pin,
        version,
        getPinPepper(version),
      )
      const verification = await serviceClient.rpc('verify_admin_ai_pin_v1', {
        target_auth_user_id: userData.user.id,
        target_intent_digest: intentDigest,
        target_network_hmac: networkHmac,
        target_peppered_pin_hmac: pinHmac,
        target_pin_pepper_version: version,
        target_request_id: body.requestId,
        target_supabase_auth_session_id: claims.sessionId,
        target_token_hash: tokenHash,
      })
      if (verification.error)
        return rpcErrorResponse(jsonResponse, verification.error.code)
      const value = verification.data as Record<string, unknown> | null
      return jsonResponse(
        {
          ok: value?.verified === true,
          reasonCode: value?.reason_code ?? 'invalid_unlock',
          retryAfterSeconds: value?.retry_after_seconds ?? 0,
          verified: value?.verified === true,
          verifiedAt: value?.verified_at ?? null,
        },
        value?.verified === true ? 200 : 401,
      )
    } catch {
      return errorResponse(
        jsonResponse,
        'service_unavailable',
        'Admin AI control is not configured.',
        503,
      )
    }
  }

  if (action === 'beginBrowserEnrollment') {
    const jwk = normalizePublicP256Jwk(body.publicKeyJwk)
    if (
      !profile!.remembered_browser_enabled ||
      !jwk ||
      !isUuid(body.browserCredentialId) ||
      !isString(body.credentialToken) ||
      !OPAQUE_BROWSER_TOKEN_PATTERN.test(body.credentialToken) ||
      !isString(body.enrollmentNonce) ||
      !OPAQUE_BROWSER_TOKEN_PATTERN.test(body.enrollmentNonce) ||
      !isString(body.publicKeyFingerprint) ||
      !SHA256_HEX_PATTERN.test(body.publicKeyFingerprint) ||
      !isString(body.absoluteExpiresAt) ||
      !Number.isFinite(Date.parse(body.absoluteExpiresAt)) ||
      !isUuid(body.requestId)
    ) {
      return errorResponse(
        jsonResponse,
        'request_invalid',
        'Request is invalid.',
        400,
      )
    }
    if (
      (await getPublicP256JwkFingerprint(jwk)) !== body.publicKeyFingerprint
    ) {
      return errorResponse(
        jsonResponse,
        'request_invalid',
        'Request is invalid.',
        400,
      )
    }
    const result = await serviceClient.rpc(
      'begin_admin_ai_browser_enrollment_v1',
      {
        target_absolute_expires_at: body.absoluteExpiresAt,
        target_auth_user_id: userData.user.id,
        target_credential_hash: await sha256Hex(body.credentialToken),
        target_nonce_hash: await sha256Hex(body.enrollmentNonce),
        target_origin: requestOrigin,
        target_public_key_fingerprint: body.publicKeyFingerprint,
        target_request_id: body.requestId,
        target_reserved_browser_credential_id: body.browserCredentialId,
        target_supabase_auth_session_id: claims.sessionId,
        target_token_hash: tokenHash,
      },
    )
    if (result.error) return rpcErrorResponse(jsonResponse, result.error.code)
    const value = result.data as Record<string, unknown> | null
    if (!value)
      return errorResponse(
        jsonResponse,
        'enrollment_unavailable',
        'Remembered-browser setup is unavailable.',
        409,
      )
    return jsonResponse({
      browserCredentialId: body.browserCredentialId,
      expiresAt: value.expires_at ?? null,
      ok: true,
    })
  }

  if (action === 'getBrowserEnrollmentStatus') {
    if (
      !isUuid(body.browserCredentialId) ||
      !isString(body.credentialToken) ||
      !OPAQUE_BROWSER_TOKEN_PATTERN.test(body.credentialToken) ||
      !isString(body.publicKeyFingerprint) ||
      !SHA256_HEX_PATTERN.test(body.publicKeyFingerprint)
    ) {
      return errorResponse(
        jsonResponse,
        'request_invalid',
        'Request is invalid.',
        400,
      )
    }
    const result = await serviceClient.rpc(
      'get_admin_ai_browser_credential_status_v1',
      {
        target_auth_user_id: userData.user.id,
        target_browser_credential_id: body.browserCredentialId,
        target_credential_hash: await sha256Hex(body.credentialToken),
        target_origin: requestOrigin,
        target_public_key_fingerprint: body.publicKeyFingerprint,
        target_supabase_auth_session_id: claims.sessionId,
        target_token_hash: tokenHash,
      },
    )
    if (result.error) return rpcErrorResponse(jsonResponse, result.error.code)
    const value = result.data as Record<string, unknown> | null
    if (!value) {
      return errorResponse(
        jsonResponse,
        'service_unavailable',
        'Credential status is unavailable.',
        503,
      )
    }
    return jsonResponse({
      browserCredentialId: value.browser_credential_id ?? null,
      expiresAt: value.expires_at ?? null,
      ok: true,
      status: value.status === 'active' ? 'active' : 'absent',
    })
  }

  if (action === 'completeBrowserEnrollment') {
    const jwk = normalizePublicP256Jwk(body.publicKeyJwk)
    if (
      !profile!.remembered_browser_enabled ||
      !jwk ||
      !isString(body.enrollmentNonce) ||
      !OPAQUE_BROWSER_TOKEN_PATTERN.test(body.enrollmentNonce) ||
      !isString(body.pin) ||
      !FOUR_DIGIT_PIN_PATTERN.test(body.pin) ||
      !isUuid(body.requestId)
    ) {
      return errorResponse(
        jsonResponse,
        'request_invalid',
        'Request is invalid.',
        400,
      )
    }
    if (!isPositiveInteger(profile!.pin_pepper_version)) {
      return errorResponse(
        jsonResponse,
        'service_unavailable',
        'Remembered-browser enrollment is not configured.',
        503,
      )
    }
    try {
      const networkHmac = await deriveNetworkHmac(
        request,
        readSecret('ADMIN_AI_NETWORK_PEPPER'),
      )
      const version = profile!.pin_pepper_version!
      const pinHmac = await derivePepperedPinHmac(
        body.pin,
        version,
        getPinPepper(version),
      )
      const result = await serviceClient.rpc(
        'complete_admin_ai_browser_enrollment_v1',
        {
          target_auth_user_id: userData.user.id,
          target_network_hmac: networkHmac,
          target_nonce_hash: await sha256Hex(body.enrollmentNonce),
          target_peppered_pin_hmac: pinHmac,
          target_pin_pepper_version: version,
          target_public_key_jwk: jwk,
          target_request_id: body.requestId,
          target_supabase_auth_session_id: claims.sessionId,
          target_token_hash: tokenHash,
        },
      )
      if (result.error) return rpcErrorResponse(jsonResponse, result.error.code)
      const value = result.data as Record<string, unknown> | null
      if (!value || value.verified === false) {
        return jsonResponse(
          {
            code: 'pin_denied',
            message: 'AI PIN could not be verified.',
            ok: false,
            reasonCode: value?.reason_code ?? 'invalid_unlock',
            retryAfterSeconds: value?.retry_after_seconds ?? 0,
          },
          401,
        )
      }
      return jsonResponse({
        browserCredentialId: value.browser_credential_id ?? null,
        expiresAt: value.expires_at ?? null,
        ok: true,
        status: value.status ?? null,
      })
    } catch {
      return errorResponse(
        jsonResponse,
        'service_unavailable',
        'Remembered-browser enrollment is not configured.',
        503,
      )
    }
  }

  if (action === 'beginBrowserAssertion') {
    if (
      !profile!.remembered_browser_enabled ||
      !isString(body.credentialToken) ||
      !OPAQUE_BROWSER_TOKEN_PATTERN.test(body.credentialToken) ||
      !isUuid(body.lectureSessionId) ||
      !isUuid(body.policyId) ||
      !isPositiveInteger(body.policyVersion) ||
      (body.requestedScope !== 'all_except_captions' &&
        body.requestedScope !== 'all_including_captions') ||
      !isUuid(body.requestId)
    ) {
      return errorResponse(
        jsonResponse,
        'request_invalid',
        'Request is invalid.',
        400,
      )
    }
    const challenge = createOpaqueBrowserToken()
    const expiresAt = new Date(Date.now() + 2 * 60 * 1_000).toISOString()
    const result = await serviceClient.rpc(
      'begin_admin_ai_browser_assertion_v1',
      {
        target_auth_user_id: userData.user.id,
        target_challenge_hash: await sha256Hex(challenge),
        target_credential_hash: await sha256Hex(body.credentialToken),
        target_expires_at: expiresAt,
        target_lecture_session_id: body.lectureSessionId,
        target_origin: requestOrigin,
        target_policy_id: body.policyId,
        target_policy_version: body.policyVersion,
        target_request_id: body.requestId,
        target_requested_scope: body.requestedScope,
        target_supabase_auth_session_id: claims.sessionId,
        target_token_hash: tokenHash,
      },
    )
    if (result.error) return rpcErrorResponse(jsonResponse, result.error.code)
    const value = result.data as Record<string, unknown> | null
    const jwk = normalizePublicP256Jwk(value?.public_key_jwk)
    if (
      !value ||
      !jwk ||
      !isUuid(value.browser_credential_id) ||
      !isUuid(value.challenge_id)
    ) {
      return errorResponse(
        jsonResponse,
        'assertion_unavailable',
        'Remembered-browser proof is unavailable.',
        409,
      )
    }
    const fingerprint = await getPublicP256JwkFingerprint(jwk)
    const assertionPayload = canonicalizeBrowserAssertionPayload({
      adminSessionId: context!.id!,
      authSessionId: claims.sessionId,
      browserCredentialId: value.browser_credential_id,
      challenge,
      challengeId: value.challenge_id,
      expiresAt,
      lectureSessionId: body.lectureSessionId,
      origin: requestOrigin,
      policyId: body.policyId,
      policyVersion: body.policyVersion,
      publicKeyFingerprint: fingerprint,
      requestedScope: body.requestedScope,
    })
    let challengeSecret: string
    try {
      challengeSecret = readSecret('ADMIN_AI_BROWSER_CHALLENGE_SECRET')
    } catch {
      return errorResponse(
        jsonResponse,
        'service_unavailable',
        'Remembered-browser proof is not configured.',
        503,
      )
    }
    return jsonResponse({
      assertionPayload,
      assertionPayloadMac: await hmacSha256Base64Url(
        challengeSecret,
        assertionPayload,
      ),
      browserCredentialId: value.browser_credential_id,
      expiresAt,
      ok: true,
    })
  }

  if (action === 'completeBrowserAssertion') {
    const jwk = normalizePublicP256Jwk(body.publicKeyJwk)
    if (
      !profile!.remembered_browser_enabled ||
      !jwk ||
      !isString(body.assertionPayload) ||
      !isString(body.assertionPayloadMac) ||
      !isString(body.signature) ||
      !isString(body.credentialToken) ||
      !OPAQUE_BROWSER_TOKEN_PATTERN.test(body.credentialToken) ||
      !isUuid(body.requestId)
    ) {
      return errorResponse(
        jsonResponse,
        'request_invalid',
        'Request is invalid.',
        400,
      )
    }
    const parsed = parseBrowserAssertionPayload(body.assertionPayload)
    let challengeSecret: string
    try {
      challengeSecret = readSecret('ADMIN_AI_BROWSER_CHALLENGE_SECRET')
    } catch {
      return errorResponse(
        jsonResponse,
        'service_unavailable',
        'Remembered-browser proof is not configured.',
        503,
      )
    }
    if (
      !parsed ||
      canonicalizeBrowserAssertionPayload(parsed) !== body.assertionPayload ||
      parsed.origin !== requestOrigin ||
      parsed.adminSessionId !== context!.id ||
      parsed.authSessionId !== claims.sessionId ||
      Date.parse(parsed.expiresAt) <= Date.now() ||
      Date.parse(parsed.expiresAt) > Date.now() + 5 * 60 * 1_000 ||
      parsed.publicKeyFingerprint !==
        (await getPublicP256JwkFingerprint(jwk)) ||
      !(await verifyHmacSha256Base64Url(
        challengeSecret,
        body.assertionPayload,
        body.assertionPayloadMac,
      ))
    ) {
      return errorResponse(
        jsonResponse,
        'assertion_invalid',
        'Remembered-browser proof is invalid.',
        409,
      )
    }
    const signatureVerified = await verifyP256P1363Signature(
      jwk,
      body.assertionPayload,
      body.signature,
    )
    const result = await serviceClient.rpc(
      'complete_admin_ai_browser_assertion_v1',
      {
        target_assertion_payload_hash: await sha256Hex(body.assertionPayload),
        target_auth_user_id: userData.user.id,
        target_challenge_hash: await sha256Hex(parsed.challenge),
        target_credential_hash: await sha256Hex(body.credentialToken),
        target_origin: requestOrigin,
        target_request_id: body.requestId,
        target_signature_verified: signatureVerified,
        target_supabase_auth_session_id: claims.sessionId,
        target_token_hash: tokenHash,
      },
    )
    if (result.error) return rpcErrorResponse(jsonResponse, result.error.code)
    const value = result.data as Record<string, unknown> | null
    if (!signatureVerified || value?.verified !== true) {
      return errorResponse(
        jsonResponse,
        'assertion_invalid',
        'Remembered-browser proof is invalid.',
        401,
      )
    }
    return jsonResponse({
      authorityIssued: false,
      browserCredentialId: value.browser_credential_id ?? null,
      dormantProof: true,
      lectureSessionId: value.lecture_session_id ?? null,
      ok: true,
      policyId: value.policy_id ?? null,
      policyVersion: value.policy_version ?? null,
      scope: value.scope ?? null,
      verifiedAt: value.verified_at ?? null,
    })
  }

  if (action === 'revokeBrowserCredential') {
    if (!isUuid(body.browserCredentialId) || !isUuid(body.requestId)) {
      return errorResponse(
        jsonResponse,
        'request_invalid',
        'Request is invalid.',
        400,
      )
    }
    const result = await serviceClient.rpc(
      'revoke_admin_ai_browser_credential_v1',
      {
        target_auth_user_id: userData.user.id,
        target_browser_credential_id: body.browserCredentialId,
        target_request_id: body.requestId,
        target_supabase_auth_session_id: claims.sessionId,
        target_token_hash: tokenHash,
      },
    )
    if (result.error) return rpcErrorResponse(jsonResponse, result.error.code)
    return jsonResponse({
      ok: result.data === true,
      revoked: result.data === true,
    })
  }

  if (action === 'prepareTotpTransition') {
    if (
      (body.factorAction !== 'totp_factor_add' &&
        body.factorAction !== 'totp_factor_remove') ||
      !isUuid(body.targetFactorId)
    ) {
      return errorResponse(
        jsonResponse,
        'request_invalid',
        'Request is invalid.',
        400,
      )
    }
    const result = await serviceClient.rpc(
      'get_admin_totp_factor_transition_intent_v1',
      {
        target_action: body.factorAction,
        target_auth_user_id: userData.user.id,
        target_factor_id: body.targetFactorId,
        target_supabase_auth_session_id: claims.sessionId,
        target_token_hash: tokenHash,
      },
    )
    if (result.error) return rpcErrorResponse(jsonResponse, result.error.code)
    const value = result.data as Record<string, unknown> | null
    if (
      !value ||
      !isString(value.intent_digest) ||
      !SHA256_HEX_PATTERN.test(value.intent_digest)
    ) {
      return errorResponse(
        jsonResponse,
        'transition_unavailable',
        'Authenticator change is unavailable.',
        409,
      )
    }
    return jsonResponse({
      approvedPreVersion: value.approved_pre_version,
      controlIntentDigest: value.intent_digest,
      expectedPostCount: value.expected_post_count,
      factorAction: value.action,
      ok: true,
      recoveryExpiresAt: value.recovery_expires_at,
      targetFactorId: value.target_factor_id,
    })
  }

  if (action === 'authorizeTotpTransition') {
    if (
      (body.factorAction !== 'totp_factor_add' &&
        body.factorAction !== 'totp_factor_remove') ||
      !isUuid(body.targetFactorId) ||
      !isString(body.controlIntentDigest) ||
      !SHA256_HEX_PATTERN.test(body.controlIntentDigest) ||
      !isString(body.recoveryToken) ||
      !OPAQUE_BROWSER_TOKEN_PATTERN.test(body.recoveryToken) ||
      !isUuid(body.requestId)
    ) {
      return errorResponse(
        jsonResponse,
        'request_invalid',
        'Request is invalid.',
        400,
      )
    }
    const result = await serviceClient.rpc(
      'authorize_admin_totp_factor_transition_v1',
      {
        target_action: body.factorAction,
        target_auth_user_id: userData.user.id,
        target_factor_id: body.targetFactorId,
        target_intent_digest: body.controlIntentDigest,
        target_mutation_request_id: body.requestId,
        target_recovery_token_hash: await sha256Hex(body.recoveryToken),
        target_supabase_auth_session_id: claims.sessionId,
        target_token_hash: tokenHash,
      },
    )
    if (result.error) {
      if (result.error.code === 'P7334') {
        // The RPC serializes this request and returns any exact transition
        // before its recovery-lifetime check. P7334 therefore proves that no
        // authorized transition owns the caller's recovery token.
        return jsonResponse(
          {
            code: 'relogin_required',
            message: 'Please sign in again before changing an Authenticator.',
            ok: false,
            recoveryUnused: true,
          },
          409,
        )
      }
      return rpcErrorResponse(jsonResponse, result.error.code)
    }
    const value = result.data as Record<string, unknown> | null
    if (!value || value.status !== 'authorized') {
      return errorResponse(
        jsonResponse,
        'control_proof_required',
        'Fresh control approval is required.',
        409,
      )
    }
    return jsonResponse({
      expiresAt: value.expires_at,
      ok: true,
      status: value.status,
      transitionId: value.transition_id,
    })
  }

  if (action === 'finalizeTotpTransition') {
    if (
      (body.factorAction !== 'totp_factor_add' &&
        body.factorAction !== 'totp_factor_remove') ||
      !isUuid(body.targetFactorId) ||
      !isString(body.controlIntentDigest) ||
      !SHA256_HEX_PATTERN.test(body.controlIntentDigest) ||
      !isString(body.recoveryToken) ||
      !OPAQUE_BROWSER_TOKEN_PATTERN.test(body.recoveryToken) ||
      !isUuid(body.requestId) ||
      !isUuid(body.finalizeRequestId)
    ) {
      return errorResponse(
        jsonResponse,
        'request_invalid',
        'Request is invalid.',
        400,
      )
    }
    const result = await serviceClient.rpc(
      'finalize_admin_totp_factor_transition_v1',
      {
        target_action: body.factorAction,
        target_auth_user_id: userData.user.id,
        target_factor_id: body.targetFactorId,
        target_finalize_request_id: body.finalizeRequestId,
        target_intent_digest: body.controlIntentDigest,
        target_mutation_request_id: body.requestId,
        target_recovery_token_hash: await sha256Hex(body.recoveryToken),
        target_supabase_auth_session_id: claims.sessionId,
      },
    )
    if (result.error) return rpcErrorResponse(jsonResponse, result.error.code)
    const value = result.data as Record<string, unknown> | null
    if (!value || value.status !== 'finalized') {
      return errorResponse(
        jsonResponse,
        'transition_incomplete',
        'Authenticator change could not be finalized.',
        409,
      )
    }
    return jsonResponse({
      approvedFactorCount: value.approved_factor_count,
      approvedFactorSetVersion: value.approved_factor_set_version,
      finalizedAt: value.finalized_at,
      ok: true,
      reloginRequired: true,
      status: value.status,
    })
  }

  return errorResponse(
    jsonResponse,
    'request_invalid',
    'Request is invalid.',
    400,
  )
}

Deno.serve((request) =>
  handleRequest(request).catch(() =>
    createJsonResponse(request)(
      {
        code: 'service_unavailable',
        message: 'Admin AI control is temporarily unavailable.',
        ok: false,
      },
      503,
    ),
  ),
)
