import { FunctionsHttpError } from '@supabase/supabase-js'
import { adminSupabase } from './adminSupabaseClient'

export type TotpFactorAction = 'totp_factor_add' | 'totp_factor_remove'
export type RememberedBrowserScope =
  | 'all_except_captions'
  | 'all_including_captions'

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

async function invoke(
  appSessionToken: string,
  body: Record<string, unknown>,
) {
  const { data, error } = await adminSupabase.functions.invoke<AiUnlockResponse>(
    'admin-ai-unlock',
    { body: { ...body, appSessionToken }, timeout: 10_000 },
  )
  if (error || !data?.ok) {
    const detail = (await readError(error)) ?? {
      code: typeof data?.code === 'string' ? data.code : 'request_failed',
      message:
        typeof data?.message === 'string'
          ? data.message
          : 'Admin AI control failed.',
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

async function invokeRecovery(body: Record<string, unknown>) {
  const { data, error } = await adminSupabase.functions.invoke<AiUnlockResponse>(
    'admin-ai-unlock',
    { body, timeout: 10_000 },
  )
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
      typeof data.pinPepperVersion === 'number'
        ? data.pinPepperVersion
        : null,
    rememberedBrowserEnabled: data.rememberedBrowserEnabled === true,
    role: typeof data.role === 'string' ? data.role : null,
  } satisfies AdminAiUnlockProfile
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

export async function finalizeTotpFactorTransition(
  input: {
    controlIntentDigest: string
    factorAction: TotpFactorAction
    finalizeRequestId: string
    recoveryToken: string
    requestId: string
    targetFactorId: string
  },
) {
  return invokeRecovery({
    action: 'finalizeTotpTransition',
    ...input,
  })
}
