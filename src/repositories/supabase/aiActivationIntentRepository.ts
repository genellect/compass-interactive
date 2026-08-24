import type { AdminOperationCredentialInput } from '../../lib/adminAuth/adminOperationCredential'
import {
  getFunctionErrorMessage,
  SUPABASE_REQUEST_TIMEOUT_MS,
} from './requestPolicy'
import { invokeEdgeFunction } from './transport'

export type AiActivationIntentStatus = {
  activationExpiresAt: string | null
  armed: boolean
  armedAt: string | null
  consumedAt: string | null
  idempotentReplay: boolean
  serverTime: string
  state: 'armed' | 'cancelled' | 'consumed' | 'none'
  version: number
}

type AiActivationIntentResponse = Partial<AiActivationIntentStatus> & {
  message?: string
  ok?: boolean
}

function toIntentStatus(
  value: AiActivationIntentResponse | null,
): AiActivationIntentStatus {
  if (
    value?.ok !== true ||
    typeof value.armed !== 'boolean' ||
    !['armed', 'cancelled', 'consumed', 'none'].includes(value.state ?? '') ||
    !Number.isSafeInteger(value.version) ||
    Number(value.version) < 0 ||
    (value.activationExpiresAt !== null &&
      typeof value.activationExpiresAt !== 'string') ||
    typeof value.serverTime !== 'string'
  ) {
    throw new Error('AI有効化予約の状態を確認できませんでした。')
  }
  return {
    activationExpiresAt: value.activationExpiresAt,
    armed: value.armed,
    armedAt: typeof value.armedAt === 'string' ? value.armedAt : null,
    consumedAt: typeof value.consumedAt === 'string' ? value.consumedAt : null,
    idempotentReplay: value.idempotentReplay === true,
    serverTime: value.serverTime,
    state: value.state as AiActivationIntentStatus['state'],
    version: Number(value.version),
  }
}

async function invokeIntent(
  request: {
    action: 'consume' | 'set' | 'status'
    adminToken: AdminOperationCredentialInput
    enabled?: boolean
    lectureSessionId: string
  },
  fallbackMessage: string,
) {
  const { data, error } = await invokeEdgeFunction<AiActivationIntentResponse>(
    'manage-ai-activation-intent',
    {
      body: request,
      timeout: SUPABASE_REQUEST_TIMEOUT_MS.adminFunction,
    },
  )
  if (error) {
    throw new Error(await getFunctionErrorMessage(error, fallbackMessage))
  }
  if (!data?.ok) throw new Error(data?.message ?? fallbackMessage)
  return toIntentStatus(data)
}

export const aiActivationIntentRepository = {
  async consumeAiActivationIntent(request: {
    adminToken: AdminOperationCredentialInput
    lectureSessionId: string
  }) {
    return await invokeIntent(
      { action: 'consume', ...request },
      'AI有効化予約を完了できませんでした。',
    )
  },

  async getAiActivationIntent(request: {
    adminToken: AdminOperationCredentialInput
    lectureSessionId: string
  }) {
    return await invokeIntent(
      { action: 'status', ...request },
      'AI有効化予約の状態を確認できませんでした。',
    )
  },

  async setAiActivationIntent(request: {
    adminToken: AdminOperationCredentialInput
    enabled: boolean
    lectureSessionId: string
  }) {
    return await invokeIntent(
      { action: 'set', ...request },
      'AI有効化予約を更新できませんでした。',
    )
  },
}
