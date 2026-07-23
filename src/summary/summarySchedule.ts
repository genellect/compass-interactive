export function resolveSummaryScheduleTiming(input: {
  fallbackHardStopAt?: string | null
  fallbackStartedAt?: string | null
  hardStopAt?: string | null
  startedAt?: string | null
}) {
  return {
    hardStopAt: input.hardStopAt ?? input.fallbackHardStopAt ?? null,
    startedAt: input.startedAt ?? input.fallbackStartedAt ?? null,
  }
}
