import type { AdminOperationCredentialInput } from '../../lib/adminAuth/adminOperationCredential'
import {
  AdminAiUnlockError,
  authorizeGoogleAiMasterWithPin,
  getGoogleAiMasterStatus,
  revokeGoogleAiMaster,
  type GoogleAiMasterPolicy,
} from '../../lib/adminAuth/adminAiUnlockApi'
import {
  completeAdminOperationRequestId,
  reserveAdminOperationRequestId,
} from '../../lib/adminAuth/adminOperationRequestId'

export type AiBillingAction =
  | 'captions'
  | 'summaries'
  | 'material_analysis'
  | 'poll_suggestions'
  | 'academic_answers'

export type AiMasterAuthorizationScope =
  'all_except_captions' | 'all_including_captions'

export type AiMasterAuthorization = {
  actions: AiBillingAction[]
  expiresAt: string
  id: string
  issuedAt: string
  lastUsedAt: string | null
  ownedByRequester: boolean
  revokeReason: string | null
  revokedAt: string | null
  scope: AiMasterAuthorizationScope
  status: 'active' | 'expired' | 'lecture_closed' | 'revoked'
  updatedAt: string
  version: number
}

export type AiMasterAuthorizationStatus = {
  admissionBlockedReason: string | null
  admissionEnabled: boolean
  allowedScopes: AiMasterAuthorizationScope[]
  authorization: AiMasterAuthorization | null
  canUseAi: boolean
  lectureOpen: boolean
  policy: GoogleAiMasterPolicy | null
  reason: string | null
  serverTime: string | null
}

type RawAiMasterAuthorization = {
  actions?: unknown
  expires_at?: unknown
  id?: unknown
  issued_at?: unknown
  last_used_at?: unknown
  owned_by_requester?: unknown
  revoke_reason?: unknown
  revoked_at?: unknown
  scope?: unknown
  status?: unknown
  updated_at?: unknown
  version?: unknown
}

function toAiMasterAuthorization(
  value: RawAiMasterAuthorization | null | undefined,
): AiMasterAuthorization | null {
  if (
    !value ||
    typeof value.id !== 'string' ||
    typeof value.expires_at !== 'string' ||
    typeof value.issued_at !== 'string' ||
    typeof value.updated_at !== 'string' ||
    (value.scope !== 'all_except_captions' &&
      value.scope !== 'all_including_captions') ||
    !['active', 'expired', 'lecture_closed', 'revoked'].includes(
      String(value.status),
    ) ||
    !Array.isArray(value.actions)
  ) {
    return null
  }
  const allowedActions = new Set<AiBillingAction>([
    'academic_answers',
    'captions',
    'material_analysis',
    'poll_suggestions',
    'summaries',
  ])
  const actions = value.actions.filter(
    (action): action is AiBillingAction =>
      typeof action === 'string' &&
      allowedActions.has(action as AiBillingAction),
  )
  return {
    actions,
    expiresAt: value.expires_at,
    id: value.id,
    issuedAt: value.issued_at,
    lastUsedAt:
      typeof value.last_used_at === 'string' ? value.last_used_at : null,
    ownedByRequester: value.owned_by_requester === true,
    revokeReason:
      typeof value.revoke_reason === 'string' ? value.revoke_reason : null,
    revokedAt: typeof value.revoked_at === 'string' ? value.revoked_at : null,
    scope: value.scope,
    status: String(value.status) as AiMasterAuthorization['status'],
    updatedAt: value.updated_at,
    version:
      typeof value.version === 'number' && Number.isSafeInteger(value.version)
        ? value.version
        : 1,
  }
}

export const aiMasterAuthorizationRepository = {
  async getAiMasterAuthorization(request: {
    adminToken: AdminOperationCredentialInput
    lectureSessionId: string
  }): Promise<AiMasterAuthorizationStatus> {
    const status = await getGoogleAiMasterStatus(
      request.adminToken.appSessionToken,
      request.lectureSessionId,
    )
    return {
      admissionBlockedReason: status.admissionBlockedReason,
      admissionEnabled: status.admissionEnabled,
      allowedScopes: status.allowedScopes,
      authorization: toAiMasterAuthorization(status.authorization),
      canUseAi: status.canUseAi,
      lectureOpen: status.lectureOpen,
      policy: status.policy,
      reason: status.reason,
      serverTime: status.serverTime,
    }
  },

  async authorizeAiMaster(request: {
    adminToken: AdminOperationCredentialInput
    aiPin: string
    lectureSessionId: string
    masterScope: AiMasterAuthorizationScope
  }): Promise<AiMasterAuthorizationStatus> {
    const status = await getGoogleAiMasterStatus(
      request.adminToken.appSessionToken,
      request.lectureSessionId,
    )
    if (!status.policy) {
      throw new Error('この講義で利用できるAIポリシーがありません。')
    }
    if (
      !status.admissionEnabled ||
      !status.allowedScopes.includes(request.masterScope)
    ) {
      throw new Error('この講義では選択したAI機能を新しく許可できません。')
    }
    const reserved = reserveAdminOperationRequestId(
      'admin-ai-unlock:authorizeMasterWithPin',
      {
        lectureSessionId: request.lectureSessionId,
        policyId: status.policy.id,
        policyVersion: status.policy.version,
        requestedScope: request.masterScope,
      },
    )
    let data: Awaited<ReturnType<typeof authorizeGoogleAiMasterWithPin>>
    try {
      data = await authorizeGoogleAiMasterWithPin(
        request.adminToken.appSessionToken,
        {
          lectureSessionId: request.lectureSessionId,
          pin: request.aiPin,
          policyId: status.policy.id,
          policyVersion: status.policy.version,
          requestId: reserved.requestId,
          requestedScope: request.masterScope,
        },
      )
    } catch (error) {
      // A durable PIN denial is a completed attempt. A corrected explicit
      // submission must use a new request ID, while a transport-ambiguous
      // failure keeps the same ID so a lost success response can converge.
      if (
        error instanceof AdminAiUnlockError &&
        error.code !== 'request_failed'
      ) {
        completeAdminOperationRequestId(reserved.key, reserved.requestId)
      }
      throw error
    }
    completeAdminOperationRequestId(reserved.key, reserved.requestId)
    return {
      admissionBlockedReason: status.admissionBlockedReason,
      admissionEnabled: status.admissionEnabled,
      allowedScopes: status.allowedScopes,
      authorization: toAiMasterAuthorization(
        data.authorization as RawAiMasterAuthorization | null | undefined,
      ),
      canUseAi: status.canUseAi,
      lectureOpen: true,
      policy: status.policy,
      reason: status.reason,
      serverTime: typeof data.serverTime === 'string' ? data.serverTime : null,
    }
  },

  async revokeAiMasterAuthorization(request: {
    adminToken: AdminOperationCredentialInput
    lectureSessionId: string
    reason: string
  }): Promise<AiMasterAuthorization | null> {
    const reserved = reserveAdminOperationRequestId(
      'admin-ai-unlock:revokeMaster',
      {
        lectureSessionId: request.lectureSessionId,
        reason: request.reason,
      },
    )
    const data = await revokeGoogleAiMaster(
      request.adminToken.appSessionToken,
      request.lectureSessionId,
      request.reason,
      reserved.requestId,
    )
    completeAdminOperationRequestId(reserved.key, reserved.requestId)
    return toAiMasterAuthorization(
      data.authorization as RawAiMasterAuthorization | null | undefined,
    )
  },
}
