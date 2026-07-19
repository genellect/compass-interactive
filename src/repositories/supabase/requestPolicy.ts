export const SUPABASE_REQUEST_TIMEOUT_MS = {
  adminFunction: 15_000,
  aiFunction: 65_000,
  liveRpc: 12_000,
  operatorFunction: 15_000,
  realtimeStart: 30_000,
} as const

export async function getFunctionErrorMessage(
  error: unknown,
  fallbackMessage: string,
) {
  if (!(error instanceof Error)) return fallbackMessage

  const maybeResponse = (error as { context?: unknown }).context
  if (maybeResponse instanceof Response) {
    try {
      const body = (await maybeResponse.clone().json()) as { message?: string }
      return body.message ?? error.message
    } catch {
      return error.message
    }
  }
  return error.message
}
