import { FunctionsHttpError } from '@supabase/supabase-js'
import { adminSupabase } from './adminSupabaseClient'

export type GoogleAdminSession = {
  canUseAi: boolean
  environmentId: string
  expiresAt: string
  id: string
  idleExpiresAt: string
  membershipId: string
  principalId: string
  role: 'instructor' | 'owner'
  stepUpVerifiedAt: string
}

export type AdminControlAction =
  | 'ai_pin_enroll'
  | 'ai_pin_reset'
  | 'ai_pin_revoke'
  | 'ai_pin_rotate'
  | 'environment_ai_policy_change'

export class AdminIdentityError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.code = code
    this.name = 'AdminIdentityError'
  }
}

type IdentityResponse = {
  activeFactorSetPresent?: boolean
  appSessionToken?: string
  code?: string
  controlAction?: AdminControlAction
  controlIntentDigest?: string
  controlRequestId?: string
  controlStepUpNonce?: string
  eligible?: boolean
  expiresAt?: string
  message?: string
  ok?: boolean
  session?: GoogleAdminSession
  stepUpNonce?: string
  revokedSessions?: number
  verifiedTotpAmrAt?: string
}

const ADMIN_IDENTITY_MESSAGES: Record<string, string> = {
  aal2_required: '認証アプリでもう一度確認してください。',
  app_session_invalid:
    '管理者セッションの有効期限が切れました。もう一度ログインしてください。',
  feature_disabled: 'Google管理者ログインは現在利用できません。',
  identity_invalid:
    'Googleアカウントを確認できませんでした。もう一度ログインしてください。',
  membership_unavailable:
    'このGoogleアカウントは管理者として登録されていません。',
  rate_limited: '試行回数が多すぎます。5分待ってから再度お試しください。',
  request_invalid: '管理者認証の要求を確認できませんでした。',
  service_unavailable:
    '管理者認証を一時的に利用できません。少し待ってから再度お試しください。',
  step_up_invalid:
    '認証アプリの確認を完了できませんでした。新しいコードで再度お試しください。',
  step_up_unavailable:
    '認証アプリの確認を開始できませんでした。再度お試しください。',
}

function getIdentityMessage(code: string) {
  return (
    ADMIN_IDENTITY_MESSAGES[code] ??
    '管理者認証を確認できませんでした。もう一度お試しください。'
  )
}

async function readIdentityErrorCode(error: unknown) {
  if (!(error instanceof FunctionsHttpError)) return null
  const response = error.context
  if (!(response instanceof Response)) return null
  const contentLength = Number.parseInt(
    response.headers.get('content-length') ?? '0',
    10,
  )
  if (
    !response.headers.get('content-type')?.toLowerCase().includes('json') ||
    !response.headers
      .get('cache-control')
      ?.toLowerCase()
      .includes('no-store') ||
    (Number.isFinite(contentLength) && contentLength > 4_096)
  ) {
    return null
  }
  try {
    const text = await response.clone().text()
    if (text.length > 4_096) return null
    const body = JSON.parse(text) as { code?: unknown }
    return typeof body.code === 'string' && body.code in ADMIN_IDENTITY_MESSAGES
      ? body.code
      : null
  } catch {
    return null
  }
}

async function invoke(body: Record<string, unknown>) {
  const { data, error } =
    await adminSupabase.functions.invoke<IdentityResponse>(
      'admin-identity-session',
      { body, timeout: 10_000 },
    )
  if (error || !data?.ok) {
    const code =
      (typeof data?.code === 'string' && data.code in ADMIN_IDENTITY_MESSAGES
        ? data.code
        : null) ??
      (await readIdentityErrorCode(error)) ??
      'identity_request_failed'
    throw new AdminIdentityError(code, getIdentityMessage(code))
  }
  return data
}

export async function admitGoogleAdmin(invitationToken?: string) {
  const result = await invoke({
    action: 'admit',
    invitationToken: invitationToken || undefined,
  })
  if (result.eligible !== true) {
    throw new AdminIdentityError(
      'membership_unavailable',
      'このGoogleアカウントは管理者として登録されていません。',
    )
  }
}

export async function beginGoogleAdminStepUp(
  challengedFactorId: string,
  invitationToken?: string,
) {
  const result = await invoke({
    action: 'beginStepUp',
    challengedFactorId,
    invitationToken: invitationToken || undefined,
  })
  if (!result.stepUpNonce || !result.expiresAt) {
    throw new AdminIdentityError(
      'step_up_unavailable',
      '認証アプリの確認を開始できませんでした。',
    )
  }
  return { expiresAt: result.expiresAt, stepUpNonce: result.stepUpNonce }
}

export async function completeGoogleAdminStepUp(stepUpNonce: string) {
  const result = await invoke({ action: 'completeStepUp', stepUpNonce })
  if (!result.appSessionToken || !result.session) {
    throw new AdminIdentityError(
      'step_up_invalid',
      '認証アプリの確認を完了できませんでした。',
    )
  }
  return {
    appSessionToken: result.appSessionToken,
    session: result.session,
  }
}

export async function restoreGoogleAdminSession(appSessionToken: string) {
  const result = await invoke({ action: 'status', appSessionToken })
  if (!result.session) {
    throw new AdminIdentityError(
      'app_session_invalid',
      '管理者セッションの有効期限が切れました。',
    )
  }
  return result.session
}

export async function revokeGoogleAdminSession(appSessionToken: string) {
  await invoke({ action: 'logout', appSessionToken })
}

export async function beginAdminControlStepUp(
  appSessionToken: string,
  controlAction: AdminControlAction,
  controlIntentDigest: string | null,
  controlRequestId = crypto.randomUUID(),
) {
  const result = await invoke({
    action: 'beginControlStepUp',
    appSessionToken,
    controlAction,
    controlIntentDigest: controlIntentDigest ?? undefined,
    controlRequestId,
  })
  if (
    !result.controlStepUpNonce ||
    !result.controlIntentDigest ||
    !result.expiresAt ||
    result.controlAction !== controlAction ||
    result.controlRequestId !== controlRequestId
  ) {
    throw new AdminIdentityError(
      'step_up_unavailable',
      getIdentityMessage('step_up_unavailable'),
    )
  }
  return {
    controlAction,
    controlIntentDigest: result.controlIntentDigest,
    controlRequestId,
    controlStepUpNonce: result.controlStepUpNonce,
    expiresAt: result.expiresAt,
  }
}

export async function completeAdminControlStepUp(
  appSessionToken: string,
  controlAction: AdminControlAction,
  controlRequestId: string,
  controlIntentDigest: string,
  controlStepUpNonce: string,
) {
  const result = await invoke({
    action: 'completeControlStepUp',
    appSessionToken,
    controlAction,
    controlIntentDigest,
    controlRequestId,
    controlStepUpNonce,
  })
  if (
    !result.expiresAt ||
    result.controlIntentDigest !== controlIntentDigest ||
    !result.verifiedTotpAmrAt ||
    result.controlAction !== controlAction ||
    result.controlRequestId !== controlRequestId
  ) {
    throw new AdminIdentityError(
      'step_up_invalid',
      getIdentityMessage('step_up_invalid'),
    )
  }
  return {
    controlAction,
    controlIntentDigest,
    controlRequestId,
    expiresAt: result.expiresAt,
    verifiedTotpAmrAt: result.verifiedTotpAmrAt,
  }
}

export async function reconcileAdminTotpFactorSet() {
  const result = await invoke({ action: 'reconcileTotpFactorSet' })
  if (
    typeof result.activeFactorSetPresent !== 'boolean' ||
    typeof result.revokedSessions !== 'number'
  ) {
    throw new AdminIdentityError(
      'identity_request_failed',
      getIdentityMessage('identity_request_failed'),
    )
  }
  return {
    activeFactorSetPresent: result.activeFactorSetPresent,
    revokedSessions: result.revokedSessions,
  }
}
