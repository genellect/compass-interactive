import { hangupOpenAiRealtimeCall } from './openaiRealtime.ts'

export type RealtimeProviderHangupJob = {
  attempt_count: number
  lecture_session_id: string
  operation_id: string
  provider_call_id: string
}

export type FinishRealtimeProviderHangupInput = {
  error: string | null
  operationId: string
  succeeded: boolean
}

function safeErrorMessage(error: unknown) {
  const message =
    error instanceof Error ? error.message : 'provider_hangup_failed'
  return message.replaceAll(/[\r\n\t]+/g, ' ').slice(0, 500)
}

export async function runRealtimeProviderHangupSweep({
  apiKey,
  claim,
  fetchImpl = fetch,
  finish,
  lectureSessionId = null,
  limit = 10,
  operationId = null,
}: {
  apiKey: string
  claim: (input: {
    lectureSessionId: string | null
    limit: number
    operationId: string | null
  }) => Promise<RealtimeProviderHangupJob[]>
  fetchImpl?: typeof fetch
  finish: (input: FinishRealtimeProviderHangupInput) => Promise<boolean>
  lectureSessionId?: string | null
  limit?: number
  operationId?: string | null
}) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
    throw new Error('invalid_realtime_hangup_batch_limit')
  }

  const jobs = await claim({ lectureSessionId, limit, operationId })
  let stopped = 0
  let retried = 0

  for (const job of jobs) {
    let succeeded = false
    let errorMessage: string | null = null
    try {
      const result = await hangupOpenAiRealtimeCall({
        apiKey,
        callId: job.provider_call_id,
        fetchImpl,
      })
      succeeded = result.ok
      if (!result.ok) {
        errorMessage = `openai_hangup_http_${result.status}`
      }
    } catch (error) {
      errorMessage = safeErrorMessage(error)
    }

    try {
      const finalized = await finish({
        error: errorMessage,
        operationId: job.operation_id,
        succeeded,
      })
      if (!finalized) {
        retried += 1
      } else if (succeeded) {
        stopped += 1
      } else {
        retried += 1
      }
    } catch {
      retried += 1
    }
  }

  return {
    claimed: jobs.length,
    retried,
    stopped,
  }
}
