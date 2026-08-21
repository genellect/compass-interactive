import type { AdminAcademicResults } from './adminAcademicTypes'

export type AcademicReconciliationBaseline = {
  knownActiveRequestIds: readonly string[]
  knownAnswerIds: readonly string[]
  preflightRequestId: string
  question: string
}

export type AcademicReconciliationMatch = {
  answerFound: boolean
  activeRequestFound: boolean
}

function canonicalQuestion(value: string) {
  return value.normalize('NFKC').replace(/\s+/g, ' ').trim()
}

export function matchAcademicReconciliationResult(
  results: AdminAcademicResults,
  baseline: AcademicReconciliationBaseline,
): AcademicReconciliationMatch {
  const question = canonicalQuestion(baseline.question)
  const knownActiveRequestIds = new Set(baseline.knownActiveRequestIds)
  const knownAnswerIds = new Set(baseline.knownAnswerIds)

  return {
    answerFound: results.answers.some(
      (answer) =>
        !knownAnswerIds.has(answer.id) &&
        answer.preflightRequestId === baseline.preflightRequestId &&
        canonicalQuestion(answer.question) === question,
    ),
    activeRequestFound: results.activeRequests.some(
      (request) =>
        !knownActiveRequestIds.has(request.id) &&
        request.preflightRequestId === baseline.preflightRequestId &&
        canonicalQuestion(request.question) === question,
    ),
  }
}
