import type { PublicLectureSummary } from '../repositories/supabaseLiveStateRepository'

export function getLatestPublicSummary(
  summaries: readonly PublicLectureSummary[],
) {
  return summaries.reduce<PublicLectureSummary | null>((latest, candidate) => {
    if (!latest) return candidate
    const candidateWindowEnd = Date.parse(candidate.windowEnd)
    const latestWindowEnd = Date.parse(latest.windowEnd)
    if (candidateWindowEnd !== latestWindowEnd) {
      return candidateWindowEnd > latestWindowEnd ? candidate : latest
    }
    return Date.parse(candidate.publishedAt) > Date.parse(latest.publishedAt)
      ? candidate
      : latest
  }, null)
}
