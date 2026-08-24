import { FunctionsHttpError } from '@supabase/supabase-js'
import { adminSupabase } from './adminSupabaseClient'
import { notifyGoogleAdminSessionInvalid } from './adminOperationSessionEvents'

export type TotpFactorAction = 'totp_factor_add' | 'totp_factor_remove'
export type RememberedBrowserScope =
  'all_except_captions' | 'all_including_captions'
export type GoogleAiMasterScope = RememberedBrowserScope
export type GoogleAiMasterPolicy = {
  allowedActions: string[]
  id: string
  validUntil: string
  version: number
}

export const ADMIN_AI_POLICY_PRESET = Object.freeze({
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
  validityDays: 30,
})

export type AdminAiPolicyMutationRequest = {
  maxCostMicrousdPerDay: number
  maxCostMicrousdPerLecture: number
  requestId: string
  targetMembershipId: string
  validFrom: string
  validUntil: string
}

export type AdminAiPolicyStatusMembership = {
  covered: boolean
  maxCostMicrousdPerDay: number | null
  maxCostMicrousdPerLecture: number | null
  membershipId: string
  policyId: string | null
  policyStatus: string | null
  policyVersion: number | null
  validFrom: string | null
  validUntil: string | null
}

export type AdminAiPolicyStatus = {
  activeAiMembershipCount: number
  canonicalPolicyTopologyComplete: boolean
  coveredMembershipCount: number
  memberships: AdminAiPolicyStatusMembership[]
  topologyComplete: boolean
}

const ADMIN_AI_POLICY_VALIDITY_MS =
  ADMIN_AI_POLICY_PRESET.validityDays * 24 * 60 * 60 * 1_000

export function createAdminAiPolicyMutationRequest(
  targetMembershipId: string,
  maxCostMicrousdPerLecture: number,
  maxCostMicrousdPerDay: number,
  requestId: string = crypto.randomUUID(),
  now: number = Date.now(),
) {
  const validFromMs = now - 60_000
  return {
    maxCostMicrousdPerDay,
    maxCostMicrousdPerLecture,
    requestId,
    targetMembershipId,
    validFrom: new Date(validFromMs).toISOString(),
    validUntil: new Date(
      validFromMs + ADMIN_AI_POLICY_VALIDITY_MS,
    ).toISOString(),
  } satisfies AdminAiPolicyMutationRequest
}

export type AdminAiUnlockProfile = {
  activeBrowserCount: number
  activePin: boolean
  canUseAi: boolean
  factorStatus: string | null
  factorVersion: number | null
  pinPepperVersion: number | null
  rememberedBrowserEnabled: boolean
  role: string | null
}

type AiUnlockResponse = Record<string, unknown> & {
  code?: string
  message?: string
  ok?: boolean
  recoveryUnused?: boolean
}

export class AdminAiUnlockError extends Error {
  readonly code: string
  readonly recoveryUnused: boolean

  constructor(code: string, message: string, recoveryUnused = false) {
    super(message)
    this.name = 'AdminAiUnlockError'
    this.code = code
    this.recoveryUnused = recoveryUnused
  }
}

async function readError(error: unknown) {
  if (!(error instanceof FunctionsHttpError)) return null
  const response = error.context
  if (!(response instanceof Response)) return null
  if (
    !response.headers.get('content-type')?.toLowerCase().includes('json') ||
    !response.headers.get('cache-control')?.toLowerCase().includes('no-store')
  ) {
    return null
  }
  try {
    const text = await response.clone().text()
    if (text.length > 4_096) return null
    const parsed = JSON.parse(text) as {
      code?: unknown
      message?: unknown
      recoveryUnused?: unknown
    }
    return {
      code: typeof parsed.code === 'string' ? parsed.code : 'request_failed',
      message:
        typeof parsed.message === 'string'
          ? parsed.message
          : 'Admin AI control failed.',
      recoveryUnused: parsed.recoveryUnused === true,
    }
  } catch {
    return null
  }
}

async function invoke(appSessionToken: string, body: Record<string, unknown>) {
  const { data, error } =
    await adminSupabase.functions.invoke<AiUnlockResponse>('admin-ai-unlock', {
      body: { ...body, appSessionToken },
      timeout: 10_000,
    })
  if (error || !data?.ok) {
    const detail = (await readError(error)) ?? {
      code: typeof data?.code === 'string' ? data.code : 'request_failed',
      message:
        typeof data?.message === 'string'
          ? data.message
          : 'Admin AI control failed.',
      recoveryUnused: data?.recoveryUnused === true,
    }
    if (
      ['aal2_required', 'app_session_invalid', 'identity_invalid'].includes(
        detail.code,
      )
    ) {
      notifyGoogleAdminSessionInvalid(appSessionToken)
    }
    throw new AdminAiUnlockError(
      detail.code,
      detail.message,
      detail.recoveryUnused === true,
    )
  }
  return data
}

async function invokeRecovery(body: Record<string, unknown>) {
  const { data, error } =
    await adminSupabase.functions.invoke<AiUnlockResponse>('admin-ai-unlock', {
      body,
      timeout: 10_000,
    })
  if (error || !data?.ok) {
    const detail = (await readError(error)) ?? {
      code: typeof data?.code === 'string' ? data.code : 'request_failed',
      message:
        typeof data?.message === 'string'
          ? data.message
          : 'Admin identity recovery failed.',
      recoveryUnused: data?.recoveryUnused === true,
    }
    throw new AdminAiUnlockError(
      detail.code,
      detail.message,
      detail.recoveryUnused === true,
    )
  }
  return data
}

export async function getAdminAiUnlockProfile(appSessionToken: string) {
  const data = await invoke(appSessionToken, { action: 'profile' })
  return {
    activeBrowserCount: Number(data.activeBrowserCount ?? 0),
    activePin: data.activePin === true,
    canUseAi: data.canUseAi === true,
    factorStatus:
      typeof data.factorStatus === 'string' ? data.factorStatus : null,
    factorVersion:
      typeof data.factorVersion === 'number' ? data.factorVersion : null,
    pinPepperVersion:
      typeof data.pinPepperVersion === 'number' ? data.pinPepperVersion : null,
    rememberedBrowserEnabled: data.rememberedBrowserEnabled === true,
    role: typeof data.role === 'string' ? data.role : null,
  } satisfies AdminAiUnlockProfile
}

export async function getAdminAiPolicyStatus(appSessionToken: string) {
  const data = await invoke(appSessionToken, { action: 'policyStatus' })
  if (
    !Number.isSafeInteger(data.activeAiMembershipCount) ||
    Number(data.activeAiMembershipCount) < 0 ||
    !Number.isSafeInteger(data.coveredMembershipCount) ||
    Number(data.coveredMembershipCount) < 0 ||
    !Array.isArray(data.memberships)
  ) {
    throw new AdminAiUnlockError(
      'policy_status_unavailable',
      '講義AIの利用状況を確認できませんでした。',
    )
  }
  const memberships = data.memberships.map((entry) => {
    const value =
      entry && typeof entry === 'object'
        ? (entry as Record<string, unknown>)
        : null
    if (!value || typeof value.membershipId !== 'string') {
      throw new AdminAiUnlockError(
        'policy_status_unavailable',
        '講義AIの利用状況を確認できませんでした。',
      )
    }
    return {
      covered: value.covered === true,
      maxCostMicrousdPerDay:
        typeof value.maxCostMicrousdPerDay === 'number'
          ? value.maxCostMicrousdPerDay
          : null,
      maxCostMicrousdPerLecture:
        typeof value.maxCostMicrousdPerLecture === 'number'
          ? value.maxCostMicrousdPerLecture
          : null,
      membershipId: value.membershipId,
      policyId: typeof value.policyId === 'string' ? value.policyId : null,
      policyStatus:
        typeof value.policyStatus === 'string' ? value.policyStatus : null,
      policyVersion:
        typeof value.policyVersion === 'number' ? value.policyVersion : null,
      validFrom: typeof value.validFrom === 'string' ? value.validFrom : null,
      validUntil:
        typeof value.validUntil === 'string' ? value.validUntil : null,
    } satisfies AdminAiPolicyStatusMembership
  })
  return {
    activeAiMembershipCount: Number(data.activeAiMembershipCount),
    canonicalPolicyTopologyComplete:
      data.canonicalPolicyTopologyComplete === true,
    coveredMembershipCount: Number(data.coveredMembershipCount),
    memberships,
    topologyComplete: data.topologyComplete === true,
  } satisfies AdminAiPolicyStatus
}

export async function prepareAdminAiPolicyMutation(
  appSessionToken: string,
  request: AdminAiPolicyMutationRequest,
) {
  const data = await invoke(appSessionToken, {
    action: 'preparePolicyMutation',
    ...request,
  })
  if (
    data.controlAction !== 'environment_ai_policy_change' ||
    typeof data.controlIntentDigest !== 'string' ||
    !/^[0-9a-f]{64}$/.test(data.controlIntentDigest) ||
    data.requestId !== request.requestId ||
    data.targetMembershipId !== request.targetMembershipId
  ) {
    throw new AdminAiUnlockError(
      'policy_intent_invalid',
      '講義AIの設定内容を確認できませんでした。',
    )
  }
  return {
    controlAction: 'environment_ai_policy_change' as const,
    controlIntentDigest: data.controlIntentDigest,
    requestId: request.requestId,
    targetMembershipId: request.targetMembershipId,
  }
}

export async function setAdminAiPolicy(
  appSessionToken: string,
  request: AdminAiPolicyMutationRequest,
) {
  const data = await invoke(appSessionToken, {
    action: 'setPolicy',
    ...request,
  })
  if (
    data.membershipId !== request.targetMembershipId ||
    typeof data.policyId !== 'string' ||
    data.status !== 'active' ||
    typeof data.version !== 'number' ||
    !Number.isSafeInteger(data.version) ||
    data.version < 1
  ) {
    throw new AdminAiUnlockError(
      'policy_commit_invalid',
      '講義AIの利用設定を完了できませんでした。',
    )
  }
  return {
    membershipId: request.targetMembershipId,
    policyId: data.policyId,
    status: 'active' as const,
    version: data.version,
  }
}

export async function prepareAdminAiPinMutation(
  appSessionToken: string,
  pin: string,
  pinAction: 'enroll' | 'rotate',
  requestId: string,
) {
  const data = await invoke(appSessionToken, {
    action: 'preparePinMutation',
    pin,
    pinAction,
    requestId,
  })
  return {
    controlAction: data.controlAction as 'ai_pin_enroll' | 'ai_pin_rotate',
    controlIntentDigest: String(data.controlIntentDigest),
    requestId,
  }
}

export async function setAdminAiPin(
  appSessionToken: string,
  pin: string,
  requestId: string,
) {
  return invoke(appSessionToken, { action: 'setPin', pin, requestId })
}

export async function revokeAdminAiPin(
  appSessionToken: string,
  requestId: string,
) {
  return invoke(appSessionToken, { action: 'revokePin', requestId })
}

export async function resetAdminAiPin(
  appSessionToken: string,
  requestId: string,
) {
  return invoke(appSessionToken, { action: 'resetPin', requestId })
}

export async function verifyAdminAiPin(
  appSessionToken: string,
  pin: string,
  requestId = crypto.randomUUID(),
) {
  return invoke(appSessionToken, { action: 'verifyPin', pin, requestId })
}

export async function getGoogleAiMasterStatus(
  appSessionToken: string,
  lectureSessionId: string,
) {
  const data = await invoke(appSessionToken, {
    action: 'masterStatus',
    lectureSessionId,
  })
  const policy =
    data.policy && typeof data.policy === 'object'
      ? (data.policy as Record<string, unknown>)
      : null
  return {
    admissionBlockedReason:
      typeof data.admissionBlockedReason === 'string'
        ? data.admissionBlockedReason
        : null,
    admissionEnabled: data.admissionEnabled === true,
    allowedScopes: Array.isArray(data.allowedScopes)
      ? data.allowedScopes.filter(
          (scope): scope is GoogleAiMasterScope =>
            scope === 'all_except_captions' ||
            scope === 'all_including_captions',
        )
      : [],
    authorization:
      data.authorization && typeof data.authorization === 'object'
        ? (data.authorization as Record<string, unknown>)
        : null,
    canUseAi: data.canUseAi === true,
    lectureOpen: data.lectureOpen === true,
    policy:
      policy &&
      typeof policy.id === 'string' &&
      typeof policy.version === 'number' &&
      Number.isSafeInteger(policy.version) &&
      typeof policy.valid_until === 'string' &&
      Array.isArray(policy.allowed_actions)
        ? ({
            allowedActions: policy.allowed_actions.filter(
              (action): action is string => typeof action === 'string',
            ),
            id: policy.id,
            validUntil: policy.valid_until,
            version: policy.version,
          } satisfies GoogleAiMasterPolicy)
        : null,
    reason: typeof data.reason === 'string' ? data.reason : null,
    serverTime: typeof data.serverTime === 'string' ? data.serverTime : null,
  }
}

export async function authorizeGoogleAiMasterWithPin(
  appSessionToken: string,
  input: {
    lectureSessionId: string
    pin: string
    policyId: string
    policyVersion: number
    requestId: string
    requestedScope: GoogleAiMasterScope
  },
) {
  return invoke(appSessionToken, {
    action: 'authorizeMasterWithPin',
    ...input,
  })
}

export async function authorizeGoogleAiMasterWithAal2Session(
  appSessionToken: string,
  input: {
    intentVersion?: number
    lectureSessionId: string
    policyId: string
    policyVersion: number
    requestId: string
    requestedScope: GoogleAiMasterScope
  },
) {
  return invoke(appSessionToken, {
    action: 'authorizeMasterWithAal2Session',
    ...input,
  })
}

export async function downgradeGoogleAiMaster(
  appSessionToken: string,
  lectureSessionId: string,
  requestId: string = crypto.randomUUID(),
) {
  return invoke(appSessionToken, {
    action: 'downgradeMaster',
    lectureSessionId,
    requestId,
  })
}

export async function revokeGoogleAiMaster(
  appSessionToken: string,
  lectureSessionId: string,
  reason: string,
  requestId: string = crypto.randomUUID(),
) {
  return invoke(appSessionToken, {
    action: 'revokeMaster',
    lectureSessionId,
    reason,
    requestId,
  })
}

export async function beginRememberedBrowserEnrollment(
  appSessionToken: string,
  input: {
    absoluteExpiresAt: string
    browserCredentialId: string
    credentialToken: string
    enrollmentNonce: string
    publicKeyFingerprint: string
    publicKeyJwk: JsonWebKey
    requestId: string
  },
) {
  return invoke(appSessionToken, {
    action: 'beginBrowserEnrollment',
    ...input,
  })
}

export async function completeRememberedBrowserEnrollment(
  appSessionToken: string,
  input: {
    enrollmentNonce: string
    pin: string
    publicKeyJwk: JsonWebKey
    requestId: string
  },
) {
  return invoke(appSessionToken, {
    action: 'completeBrowserEnrollment',
    ...input,
  })
}

export async function getRememberedBrowserEnrollmentStatus(
  appSessionToken: string,
  input: {
    browserCredentialId: string
    credentialToken: string
    publicKeyFingerprint: string
  },
) {
  return invoke(appSessionToken, {
    action: 'getBrowserEnrollmentStatus',
    ...input,
  })
}

export async function beginRememberedBrowserAssertion(
  appSessionToken: string,
  input: {
    credentialToken: string
    lectureSessionId: string
    policyId: string
    policyVersion: number
    requestId: string
    requestedScope: RememberedBrowserScope
  },
) {
  return invoke(appSessionToken, {
    action: 'beginBrowserAssertion',
    ...input,
  })
}

export async function completeRememberedBrowserAssertion(
  appSessionToken: string,
  input: {
    assertionPayload: string
    assertionPayloadMac: string
    credentialToken: string
    publicKeyJwk: JsonWebKey
    requestId: string
    signature: string
  },
) {
  return invoke(appSessionToken, {
    action: 'completeBrowserAssertion',
    ...input,
  })
}

export async function completeRememberedBrowserMasterAdmission(
  appSessionToken: string,
  input: {
    assertionPayload: string
    assertionPayloadMac: string
    credentialToken: string
    publicKeyJwk: JsonWebKey
    requestId: string
    signature: string
  },
) {
  return invoke(appSessionToken, {
    action: 'completeBrowserMasterAdmission',
    ...input,
  })
}

export async function revokeRememberedBrowserCredential(
  appSessionToken: string,
  browserCredentialId: string,
  requestId = crypto.randomUUID(),
) {
  return invoke(appSessionToken, {
    action: 'revokeBrowserCredential',
    browserCredentialId,
    requestId,
  })
}

export async function prepareTotpFactorTransition(
  appSessionToken: string,
  factorAction: TotpFactorAction,
  targetFactorId: string,
) {
  return invoke(appSessionToken, {
    action: 'prepareTotpTransition',
    factorAction,
    targetFactorId,
  })
}

export async function authorizeTotpFactorTransition(
  appSessionToken: string,
  input: {
    controlIntentDigest: string
    factorAction: TotpFactorAction
    recoveryToken: string
    requestId: string
    targetFactorId: string
  },
) {
  return invoke(appSessionToken, {
    action: 'authorizeTotpTransition',
    ...input,
  })
}

export async function finalizeTotpFactorTransition(input: {
  controlIntentDigest: string
  factorAction: TotpFactorAction
  finalizeRequestId: string
  recoveryToken: string
  requestId: string
  targetFactorId: string
}) {
  return invokeRecovery({
    action: 'finalizeTotpTransition',
    ...input,
  })
}
