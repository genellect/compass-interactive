import { FunctionsHttpError } from '@supabase/supabase-js'
import { adminSupabase } from './adminSupabaseClient'
import { notifyGoogleAdminSessionInvalid } from './adminOperationSessionEvents'

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
  | 'admin_global_revoke'
  | 'admin_invitation_change'
  | 'admin_membership_ai_change'
  | 'admin_membership_role_change'
  | 'admin_membership_status_change'
  | 'admin_session_revoke'
  | 'environment_ai_policy_change'
  | 'totp_factor_add'
  | 'totp_factor_remove'

export type AdminLedgerOperationKey =
  | 'manage-admin-ledger.demoteOwner'
  | 'manage-admin-ledger.disableAi'
  | 'manage-admin-ledger.enableAi'
  | 'manage-admin-ledger.globalRevoke'
  | 'manage-admin-ledger.issueInvitation'
  | 'manage-admin-ledger.promoteOwner'
  | 'manage-admin-ledger.reactivateMembership'
  | 'manage-admin-ledger.revokeInvitation'
  | 'manage-admin-ledger.revokeMembership'
  | 'manage-admin-ledger.revokeSession'
  | 'manage-admin-ledger.suspendMembership'

export class AdminIdentityError extends Error {
  readonly code: string
  readonly retryAfterMs: number

  constructor(code: string, message: string, retryAfterMs = 0) {
    super(message)
    this.code = code
    this.retryAfterMs = retryAfterMs
    this.name = 'AdminIdentityError'
  }
}

export function createAdminControlStepUpNonce() {
  const value = crypto.getRandomValues(new Uint8Array(32))
  let binary = ''
  for (const byte of value) binary += String.fromCharCode(byte)
  return btoa(binary)
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll('=', '')
}

type IdentityResponse = {
  activeFactorSetPresent?: boolean
  appSessionToken?: string
  code?: string
  controlAction?: AdminControlAction
  controlIntentDigest?: string
  controlOperationKey?: AdminLedgerOperationKey
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
  factor_set_adoption_required:
    '認証アプリの登録状態を運用担当者が承認する必要があります。再試行せず運用担当者に連絡してください。',
  identity_invalid:
    'Googleアカウントを確認できませんでした。もう一度ログインしてください。',
  membership_unavailable:
    'このGoogleアカウントは管理者として登録されていません。',
  reauthentication_required:
    'Googleログインの有効期限が切れました。Googleで再認証してください。',
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

function readRetryAfterMs(response: Response) {
  const value = response.headers.get('retry-after')
  if (!value) return 0
  const seconds = Number(value)
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(
      Math.max(1_000, Math.ceil(seconds * 1_000)),
      60 * 60 * 1_000,
    )
  }
  const retryAt = Date.parse(value)
  return Number.isFinite(retryAt)
    ? Math.min(Math.max(1_000, retryAt - Date.now()), 60 * 60 * 1_000)
    : 0
}

async function readIdentityError(error: unknown) {
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
      ? { code: body.code, retryAfterMs: readRetryAfterMs(response) }
      : null
  } catch {
    return null
  }
}

async function invoke(
  body: Record<string, unknown>,
  options: { notifyInvalidAppSession?: boolean } = {},
) {
  const { data, error } =
    await adminSupabase.functions.invoke<IdentityResponse>(
      'admin-identity-session',
      { body, timeout: 10_000 },
    )
  if (error || !data?.ok) {
    const responseError = await readIdentityError(error)
    const code =
      (typeof data?.code === 'string' && data.code in ADMIN_IDENTITY_MESSAGES
        ? data.code
        : null) ??
      responseError?.code ??
      'identity_request_failed'
    if (
      options.notifyInvalidAppSession !== false &&
      typeof body.appSessionToken === 'string' &&
      (code === 'aal2_required' ||
        code === 'app_session_invalid' ||
        code === 'identity_invalid')
    ) {
      notifyGoogleAdminSessionInvalid(body.appSessionToken)
    }
    throw new AdminIdentityError(
      code,
      getIdentityMessage(code),
      responseError?.retryAfterMs ?? 0,
    )
  }
  return data
}

export async function admitGoogleAdmin(
  loginRequestId: string,
  invitationToken?: string,
) {
  const result = await invoke({
    action: 'admit',
    invitationToken: invitationToken || undefined,
    loginRequestId,
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
  loginRequestId: string,
  invitationToken?: string,
) {
  const result = await invoke({
    action: 'beginStepUp',
    challengedFactorId,
    invitationToken: invitationToken || undefined,
    loginRequestId,
  })
  if (!result.stepUpNonce || !result.expiresAt) {
    throw new AdminIdentityError(
      'step_up_unavailable',
      '認証アプリの確認を開始できませんでした。',
    )
  }
  return { expiresAt: result.expiresAt, stepUpNonce: result.stepUpNonce }
}

export async function completeGoogleAdminStepUp(
  stepUpNonce: string,
  loginRequestId: string,
) {
  const result = await invoke({
    action: 'completeStepUp',
    loginRequestId,
    stepUpNonce,
  })
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

export async function restoreGoogleAdminSessionFromAuth(restoreSeed: string) {
  const result = await invoke({ action: 'restore', restoreSeed })
  if (!result.appSessionToken || !result.session) {
    throw new AdminIdentityError(
      'app_session_invalid',
      getIdentityMessage('app_session_invalid'),
    )
  }
  return {
    appSessionToken: result.appSessionToken,
    session: result.session,
  }
}

export async function restoreGoogleAdminSession(appSessionToken: string) {
  // A stale tab-scoped token may still be rotated from the same live AAL2
  // Supabase Auth session. Do not broadcast terminal invalidation until the
  // route has attempted that server-bound recovery path.
  const result = await invoke(
    { action: 'status', appSessionToken },
    { notifyInvalidAppSession: false },
  )
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
  controlRequestId: string = crypto.randomUUID(),
  controlOperationKey?: AdminLedgerOperationKey,
  controlStepUpNonce?: string,
) {
  const result = await invoke({
    action: 'beginControlStepUp',
    appSessionToken,
    controlAction,
    controlIntentDigest: controlIntentDigest ?? undefined,
    controlOperationKey,
    controlRequestId,
    controlStepUpNonce,
  })
  if (
    !result.controlStepUpNonce ||
    !result.controlIntentDigest ||
    !result.expiresAt ||
    result.controlAction !== controlAction ||
    (controlOperationKey !== undefined &&
      result.controlOperationKey !== controlOperationKey) ||
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
    ...(controlOperationKey ? { controlOperationKey } : {}),
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
  controlOperationKey?: AdminLedgerOperationKey,
) {
  const result = await invoke({
    action: 'completeControlStepUp',
    appSessionToken,
    controlAction,
    controlIntentDigest,
    controlOperationKey,
    controlRequestId,
    controlStepUpNonce,
  })
  if (
    !result.expiresAt ||
    result.controlIntentDigest !== controlIntentDigest ||
    !result.verifiedTotpAmrAt ||
    result.controlAction !== controlAction ||
    (controlOperationKey !== undefined &&
      result.controlOperationKey !== controlOperationKey) ||
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
    ...(controlOperationKey ? { controlOperationKey } : {}),
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
