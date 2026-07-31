import { getFunctionErrorMessage, SUPABASE_REQUEST_TIMEOUT_MS } from './requestPolicy'
import { invokeEdgeFunction } from './transport'

export type AiBillingAction =
  | 'captions'
  | 'summaries'
  | 'material_analysis'
  | 'poll_suggestions'
  | 'academic_answers'

export type AiMasterAuthorizationScope =
  | 'all_except_captions'
  | 'all_including_captions'

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
  authorization: AiMasterAuthorization | null
  lectureOpen: boolean
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

type AiMasterAuthorizationResponse = {
  authorization?: RawAiMasterAuthorization | null
  lectureOpen?: boolean
  message?: string
  ok?: boolean
  serverTime?: string | null
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

const timeout = SUPABASE_REQUEST_TIMEOUT_MS.adminFunction

export const aiMasterAuthorizationRepository = {
  async getAiMasterAuthorization(request: {
    adminToken: string
    lectureSessionId: string
  }): Promise<AiMasterAuthorizationStatus> {
    const { data, error } =
      await invokeEdgeFunction<AiMasterAuthorizationResponse>(
        'authorize-ai-start',
        { body: { action: 'masterStatus', ...request }, timeout },
      )
    if (error) {
      throw new Error(
        await getFunctionErrorMessage(
          error,
          'AI機能の許可状態を確認できませんでした。',
        ),
      )
    }
    if (!data?.ok) {
      throw new Error(
        data?.message ?? 'AI機能の許可状態を確認できませんでした。',
      )
    }
    return {
      authorization: toAiMasterAuthorization(data.authorization),
      lectureOpen: data.lectureOpen === true,
      serverTime: data.serverTime ?? null,
    }
  },

  async authorizeAiMaster(request: {
    adminToken: string
    billingPin: string
    lectureSessionId: string
    masterScope: AiMasterAuthorizationScope
  }): Promise<AiMasterAuthorizationStatus> {
    const { data, error } =
      await invokeEdgeFunction<AiMasterAuthorizationResponse>(
        'authorize-ai-start',
        { body: { action: 'authorizeMaster', ...request }, timeout },
      )
    if (error) {
      throw new Error(
        await getFunctionErrorMessage(
          error,
          '講義中のAI機能を許可できませんでした。',
        ),
      )
    }
    if (!data?.ok) {
      throw new Error(
        data?.message ?? '講義中のAI機能を許可できませんでした。',
      )
    }
    return {
      authorization: toAiMasterAuthorization(data.authorization),
      lectureOpen: true,
      serverTime: data.serverTime ?? null,
    }
  },

  async revokeAiMasterAuthorization(request: {
    adminToken: string
    lectureSessionId: string
    reason: string
  }): Promise<AiMasterAuthorization | null> {
    const { data, error } =
      await invokeEdgeFunction<AiMasterAuthorizationResponse>(
        'authorize-ai-start',
        { body: { action: 'revokeMaster', ...request }, timeout },
      )
    if (error) {
      throw new Error(
        await getFunctionErrorMessage(
          error,
          '講義中のAI機能を停止できませんでした。',
        ),
      )
    }
    if (!data?.ok) {
      throw new Error(
        data?.message ?? '講義中のAI機能を停止できませんでした。',
      )
    }
    return toAiMasterAuthorization(data.authorization)
  },
}
