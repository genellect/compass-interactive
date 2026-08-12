import { FunctionsHttpError } from '@supabase/supabase-js'
import type { AdminOperationCredential } from './adminOperationCredential'
import type {
  AdminControlAction,
  AdminLedgerOperationKey,
} from './adminIdentityApi'
import { invokeEdgeFunction } from '../../repositories/supabase/transport'

export type AdminLedgerMembership = {
  canUseAi: boolean
  createdAt: string
  displayName: string | null
  expiresAt: string | null
  membershipId: string
  normalizedEmail: string
  principalId: string
  principalStatus: string
  role: 'instructor' | 'owner'
  status: 'active' | 'pending_mfa' | 'revoked' | 'suspended'
  statusReason: string | null
  updatedAt: string
}

export type AdminLedgerInvitation = {
  canUseAi: boolean
  createdAt: string
  expiredAt: string | null
  expiresAt: string
  invitationId: string
  membershipExpiresAt: string | null
  normalizedEmail: string
  revocationReason: string | null
  revokedAt: string | null
  role: 'instructor' | 'owner'
  status: 'accepted' | 'expired' | 'pending' | 'revoked'
  updatedAt: string
}

export type AdminLedgerSession = {
  expiresAt: string
  idleExpiresAt: string
  isCurrent: boolean
  issuedAt: string
  lastSeenAt: string
  membershipId: string
  revokeReason: string | null
  revokedAt: string | null
  sessionId: string
  status: 'active' | 'expired' | 'revoked'
}

export type AdminLedgerOwnership = {
  assignedAt: string
  lectureSessionId: string
  lectureStatus: string
  membershipId: string
  principalId: string
}

export type AdminLedgerSnapshot = {
  currentMembershipId: string
  currentPrincipalId: string
  currentSessionId: string
  environmentId: string
  environmentKind: 'contest' | 'local' | 'production' | 'staging'
  invitations: AdminLedgerInvitation[]
  ledgerAdmissionEnabled: boolean
  memberships: AdminLedgerMembership[]
  ok: true
  ownerships: AdminLedgerOwnership[]
  sessions: AdminLedgerSession[]
}

export type AdminLedgerAuditEvent = {
  action: string
  eventId: string
  occurredAt: string
  reasonCode: string | null
  result: string
  targetId: string | null
  targetType: string
}

export type AdminLedgerMutationPayloads = {
  demoteOwner: {
    expectedRole: 'owner'
    expectedStatus: 'active'
    expectedUpdatedAt: string
    membershipExpiresAt: string | null
    membershipId: string
    reasonCode: string
  }
  disableAi: {
    expectedCanUseAi: true
    expectedStatus: 'active'
    expectedUpdatedAt: string
    membershipId: string
  }
  enableAi: {
    expectedCanUseAi: false
    expectedStatus: 'active'
    expectedUpdatedAt: string
    membershipId: string
  }
  globalRevoke: { membershipId: string }
  issueInvitation: {
    canUseAi: boolean
    expiresAt: string
    membershipExpiresAt: string | null
    normalizedEmail: string
    role: 'instructor' | 'owner'
  }
  promoteOwner: {
    expectedRole: 'instructor'
    expectedStatus: 'active'
    expectedUpdatedAt: string
    membershipId: string
  }
  reactivateMembership: {
    expectedStatus: 'suspended'
    expectedUpdatedAt: string
    membershipId: string
  }
  revokeInvitation: {
    expectedStatus: 'pending'
    expectedUpdatedAt: string
    invitationId: string
  }
  revokeMembership: {
    expectedStatus: 'active' | 'pending_mfa' | 'suspended'
    expectedUpdatedAt: string
    membershipId: string
    reasonCode: string
  }
  revokeSession: { membershipId: string; sessionId: string }
  suspendMembership: {
    expectedStatus: 'active'
    expectedUpdatedAt: string
    membershipId: string
    reasonCode: string
  }
}

export type AdminLedgerMutationAction = keyof AdminLedgerMutationPayloads
export type AdminLedgerMutationRequest = {
  [Action in AdminLedgerMutationAction]: {
    action: Action
    payload: AdminLedgerMutationPayloads[Action]
  }
}[AdminLedgerMutationAction]

export type AdminLedgerMutationIntent = {
  controlStepUpAction: AdminControlAction
  intentDigest: string
  operationKey: AdminLedgerOperationKey
  requestId: string
  targetId: string
}

export type AdminLedgerMutationResult = {
  changed?: boolean
  idempotentReplay: boolean
  invitationToken?: string
  ok: true
  refreshRequired?: boolean
  resultId: string
  resultStatus: string
  revokedCount?: number
}

const ERROR_MESSAGES: Record<string, string> = {
  authorization_failed: 'この管理台帳を操作する権限がありません。',
  feature_disabled:
    '現在、新しい招待や権限追加は停止中です。確認と安全な停止操作は引き続き利用できます。',
  last_owner_required: '環境に最後に残るOwnerは変更できません。',
  rate_limited: '操作が集中しています。少し待ってからもう一度お試しください。',
  request_invalid: '入力内容を確認してください。',
  service_unavailable: '管理台帳を一時的に利用できません。',
  state_changed:
    '別の画面で状態が更新されました。最新情報を読み直してください。',
}

export class AdminLedgerError extends Error {
  readonly code: string

  constructor(code: string) {
    super(ERROR_MESSAGES[code] ?? ERROR_MESSAGES.service_unavailable)
    this.code = code
    this.name = 'AdminLedgerError'
  }
}

async function readErrorCode(error: unknown) {
  if (!(error instanceof FunctionsHttpError)) return null
  const response = error.context
  if (!(response instanceof Response)) return null
  try {
    const text = await response.clone().text()
    if (text.length > 4_096) return null
    const payload = JSON.parse(text) as { code?: unknown }
    return typeof payload.code === 'string' ? payload.code : null
  } catch {
    return null
  }
}

async function requireResult<T extends { ok?: boolean }>(
  data: T | null,
  error: unknown,
) {
  if (!error && data?.ok === true) return data as T & { ok: true }
  const code = await readErrorCode(error)
  throw new AdminLedgerError(code ?? 'service_unavailable')
}

export async function getAdminLedgerSnapshot(
  adminToken: AdminOperationCredential,
) {
  const { data, error } = await invokeEdgeFunction<AdminLedgerSnapshot>(
    'manage-admin-ledger',
    { body: { action: 'snapshot', adminToken }, timeout: 10_000 },
  )
  return await requireResult(data, error)
}

export async function getAdminLedgerAudit(
  adminToken: AdminOperationCredential,
  cursor?: { beforeAt: string; beforeId: string },
  limit = 50,
) {
  const { data, error } = await invokeEdgeFunction<{
    events?: AdminLedgerAuditEvent[]
    ok?: boolean
  }>('manage-admin-ledger', {
    body: {
      action: 'audit',
      adminToken,
      ...(cursor ?? {}),
      limit,
    },
    timeout: 10_000,
  })
  const result = await requireResult(data, error)
  if (!Array.isArray(result.events)) {
    throw new AdminLedgerError('service_unavailable')
  }
  return result.events
}

export async function prepareAdminLedgerMutation(
  request: AdminLedgerMutationRequest & {
    adminToken: AdminOperationCredential
    requestId: string
  },
) {
  const { data, error } = await invokeEdgeFunction<
    Partial<AdminLedgerMutationIntent> & { ok?: boolean }
  >('manage-admin-ledger', {
    body: { ...request, stage: 'intent' },
    timeout: 10_000,
  })
  const result = await requireResult(data, error)
  if (
    !result.controlStepUpAction ||
    !result.intentDigest ||
    !result.operationKey ||
    result.requestId !== request.requestId ||
    !result.targetId
  ) {
    throw new AdminLedgerError('service_unavailable')
  }
  return result as AdminLedgerMutationIntent
}

export async function commitAdminLedgerMutation(
  request: AdminLedgerMutationRequest & {
    adminToken: AdminOperationCredential
    intentDigest: string
    requestId: string
  },
) {
  const { data, error } = await invokeEdgeFunction<
    Partial<AdminLedgerMutationResult>
  >('manage-admin-ledger', {
    body: { ...request, stage: 'commit' },
    timeout: 10_000,
  })
  const result = await requireResult(data, error)
  if (
    typeof result.idempotentReplay !== 'boolean' ||
    !result.resultId ||
    !result.resultStatus
  ) {
    throw new AdminLedgerError('service_unavailable')
  }
  return result as AdminLedgerMutationResult
}
