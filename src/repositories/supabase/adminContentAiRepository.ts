import type { AdminOperationCredentialInput } from '../../lib/adminAuth/adminOperationCredential'
import type { PublisherExtraction } from '../../pdf/publisherClient'
import type {
  AdminMaterialPublication,
  AdminMaterialResults,
  AdminMaterialSummaryBody,
  AdminSummaryResults,
} from '../supabaseAdminRepository'
import type {
  AdminAcademicResults,
  ManageAcademicAnswersRequest,
} from './adminAcademicTypes'
import {
  toAdminAcademicResults,
  toAdminMaterialResults,
  toAdminSummaryResults,
  type RawAcademicResults,
  type RawMaterialResults,
  type RawSummaryResults,
} from './adminMappers'
import {
  getFunctionErrorMessage,
  SUPABASE_REQUEST_TIMEOUT_MS,
} from './requestPolicy'
import { matchAcademicReconciliationResult } from './academicReconciliation'
import { invokeEdgeFunction } from './transport'

const {
  adminFunction: ADMIN_FUNCTION_TIMEOUT_MS,
  aiFunction: AI_FUNCTION_TIMEOUT_MS,
} = SUPABASE_REQUEST_TIMEOUT_MS
const ACADEMIC_RECONCILIATION_TIMEOUT_MS = 90_000
const ACADEMIC_RECONCILIATION_INTERVAL_MS = 1_000
const MATERIAL_RECONCILIATION_TIMEOUT_MS = 90_000
const MATERIAL_RECONCILIATION_INTERVAL_MS = 1_000

type AcademicFunctionResponse = {
  idempotentReplay?: boolean
  message?: string
  ok?: boolean
  refreshRequired?: boolean
  results?: RawAcademicResults
}

type MaterialFunctionResponse = {
  message?: string
  ok?: boolean
  pollId?: string | null
  results?: RawMaterialResults
}

type SummaryFunctionResponse = {
  message?: string
  ok?: boolean
  reason?: string
  results?: RawSummaryResults
  runToken?: string
}

type AcademicGenerateRequest = Extract<
  ManageAcademicAnswersRequest,
  { action: 'generate' | 'generateAuto' }
>

type MaterialAnalysisRequest = {
  action: 'material_analysis' | 'poll_suggestions'
  adminToken: AdminOperationCredentialInput
  analysisId?: string | null
  documentId: string
  documentVersion: string
  extraction: PublisherExtraction
  grantRequestId: string
  knownProposalIds?: string[]
  lectureSessionId: string
  pageEnd?: number | null
  pageStart?: number | null
  previousAnalysisId?: string | null
  startRequestId: string
}

type MaterialProviderWireRequest = {
  action: MaterialAnalysisRequest['action']
  adminToken: AdminOperationCredentialInput
  analysisId?: string | null
  documentId: string
  documentVersion: string
  extraction: PublisherExtraction
  grantRequestId: string
  lectureSessionId: string
  pageEnd?: number | null
  pageStart?: number | null
  startRequestId: string
}

export class AdminProviderAttemptError extends Error {
  readonly retainAttempt: boolean

  constructor(message: string, retainAttempt: boolean) {
    super(message)
    this.name = 'AdminProviderAttemptError'
    this.retainAttempt = retainAttempt
  }
}

export function shouldRetainAdminProviderAttempt(error: unknown) {
  return error instanceof AdminProviderAttemptError && error.retainAttempt
}

export async function providerAttemptIsAmbiguous(error: unknown) {
  const response = (error as { context?: unknown } | null)?.context
  if (!(response instanceof Response)) return true
  if (response.status >= 500) return true
  try {
    const body = (await response.clone().json()) as { code?: unknown }
    return body.code === 'operation_in_progress'
  } catch {
    return false
  }
}

async function waitForAcademicAnswerResult(request: AcademicGenerateRequest) {
  const deadline = Date.now() + ACADEMIC_RECONCILIATION_TIMEOUT_MS
  let activeAtDeadline = false

  while (Date.now() < deadline) {
    const remainingMs = deadline - Date.now()
    const { data, error } = await invokeEdgeFunction<AcademicFunctionResponse>(
      'generate-academic-answer',
      {
        body: {
          action: 'status',
          adminToken: request.adminToken,
          lectureSessionId: request.lectureSessionId,
        },
        timeout: Math.min(
          ADMIN_FUNCTION_TIMEOUT_MS,
          Math.max(1_000, remainingMs),
        ),
      },
    )
    if (!error && data?.ok && data.results) {
      const results = toAdminAcademicResults(data.results)
      const match = matchAcademicReconciliationResult(results, {
        knownActiveRequestIds: request.knownActiveRequestIds,
        knownAnswerIds: request.knownAnswerIds,
        preflightRequestId: request.preflightRequestId,
        question: request.question,
      })
      if (match.answerFound) {
        return { results, retainAttempt: false }
      }
      activeAtDeadline = match.activeRequestFound
    }

    const delayMs = Math.min(
      ACADEMIC_RECONCILIATION_INTERVAL_MS,
      deadline - Date.now(),
    )
    if (delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, delayMs))
    }
  }

  return { results: null, retainAttempt: activeAtDeadline }
}

async function waitForMaterialAnalysisResult(request: {
  request: MaterialAnalysisRequest
  wireRequest: MaterialProviderWireRequest
}): Promise<{
  error: unknown | null
  results: AdminMaterialResults | null
}> {
  const deadline = Date.now() + MATERIAL_RECONCILIATION_TIMEOUT_MS
  const knownProposalIds = new Set(request.request.knownProposalIds ?? [])

  while (Date.now() < deadline) {
    const remainingMs = deadline - Date.now()
    const { data, error } = await invokeEdgeFunction<MaterialFunctionResponse>(
      'manage-material-analysis',
      {
        body: {
          action: 'list',
          adminToken: request.request.adminToken,
          lectureSessionId: request.request.lectureSessionId,
        },
        timeout: Math.min(
          ADMIN_FUNCTION_TIMEOUT_MS,
          Math.max(1_000, remainingMs),
        ),
      },
    )
    if (!error && data?.ok && data.results) {
      const results = toAdminMaterialResults(data.results)
      const candidateFound =
        request.request.action === 'material_analysis'
          ? Boolean(
              results.analysis &&
              results.analysis.sourceDocumentId ===
                request.request.documentId &&
              results.analysis.sourceDocumentVersion ===
                request.request.documentVersion &&
              results.analysis.id !== request.request.previousAnalysisId,
            )
          : Boolean(
              request.request.analysisId &&
              results.proposals.some(
                (proposal) =>
                  proposal.analysisId === request.request.analysisId &&
                  !knownProposalIds.has(proposal.id),
              ),
            )
      if (candidateFound) {
        const confirmation = await dispatchMaterialProviderRequest(
          request.wireRequest,
        )
        if (
          !confirmation.error &&
          confirmation.data?.ok &&
          confirmation.data.results
        ) {
          return {
            error: null,
            results: toAdminMaterialResults(confirmation.data.results),
          }
        }
        if (
          confirmation.error &&
          !(await providerAttemptIsAmbiguous(confirmation.error))
        ) {
          return { error: confirmation.error, results: null }
        }
      }
    }

    const delayMs = Math.min(
      MATERIAL_RECONCILIATION_INTERVAL_MS,
      deadline - Date.now(),
    )
    if (delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, delayMs))
    }
  }

  return { error: null, results: null }
}

function toMaterialProviderWireRequest(
  request: MaterialAnalysisRequest,
): MaterialProviderWireRequest {
  return {
    action: request.action,
    adminToken: request.adminToken,
    analysisId: request.analysisId,
    documentId: request.documentId,
    documentVersion: request.documentVersion,
    extraction: request.extraction,
    grantRequestId: request.grantRequestId,
    lectureSessionId: request.lectureSessionId,
    pageEnd: request.pageEnd,
    pageStart: request.pageStart,
    startRequestId: request.startRequestId,
  }
}

function dispatchMaterialProviderRequest(
  wireRequest: MaterialProviderWireRequest,
) {
  return invokeEdgeFunction<MaterialFunctionResponse>(
    'analyze-lecture-material',
    { body: wireRequest, timeout: AI_FUNCTION_TIMEOUT_MS },
  )
}

export const adminContentAiRepository = {
  async manageAcademicAnswers(
    request: ManageAcademicAnswersRequest,
  ): Promise<AdminAcademicResults> {
    const requestBody = { ...request } as Record<string, unknown>
    delete requestBody.knownActiveRequestIds
    delete requestBody.knownAnswerIds
    if (request.action === 'cancel') {
      requestBody.academicRequestId = request.requestId
      delete requestBody.requestId
    }
    const response = await invokeEdgeFunction<AcademicFunctionResponse>(
      'generate-academic-answer',
      {
        body: requestBody,
        timeout:
          request.action === 'generate' || request.action === 'generateAuto'
            ? AI_FUNCTION_TIMEOUT_MS
            : ADMIN_FUNCTION_TIMEOUT_MS,
      },
    )
    const { data, error } = response
    if (error) {
      const generateRequest =
        request.action === 'generate' || request.action === 'generateAuto'
          ? request
          : null
      const ambiguous = generateRequest
        ? await providerAttemptIsAmbiguous(error)
        : false
      if (generateRequest && ambiguous) {
        const reconciled = await waitForAcademicAnswerResult(generateRequest)
        if (reconciled.results) return reconciled.results
        const message = await getFunctionErrorMessage(
          error,
          '文献に基づく参考回答の操作に失敗しました。',
        )
        throw new AdminProviderAttemptError(
          reconciled.retainAttempt
            ? '参考回答の生成はサーバーで継続しています。完了結果をまだ確認できません。しばらくしてから同じ操作で再確認してください。'
            : message,
          reconciled.retainAttempt,
        )
      }
      const message = await getFunctionErrorMessage(
        error,
        '文献に基づく参考回答の操作に失敗しました。',
      )
      if (request.action === 'generate' || request.action === 'generateAuto') {
        throw new AdminProviderAttemptError(message, false)
      }
      throw new Error(message)
    }
    if (data?.ok && !data.results && data.refreshRequired) {
      const refreshed = await invokeEdgeFunction<AcademicFunctionResponse>(
        'generate-academic-answer',
        {
          body: {
            action: 'status',
            adminToken: request.adminToken,
            lectureSessionId: request.lectureSessionId,
          },
          timeout: ADMIN_FUNCTION_TIMEOUT_MS,
        },
      )
      if (!refreshed.error && refreshed.data?.ok && refreshed.data.results) {
        return toAdminAcademicResults(refreshed.data.results)
      }
      throw new AdminProviderAttemptError(
        '作成済みの参考回答を再取得できませんでした。同じ操作でもう一度状態を確認してください。',
        true,
      )
    }
    if (!data?.ok || !data.results) {
      throw new Error(
        data?.message ?? '文献に基づく参考回答の操作に失敗しました。',
      )
    }
    return toAdminAcademicResults(data.results)
  },

  async analyzeLectureMaterial(
    request: MaterialAnalysisRequest,
  ): Promise<AdminMaterialResults> {
    const wireRequest = toMaterialProviderWireRequest(request)
    const response = await dispatchMaterialProviderRequest(wireRequest)
    const { data, error } = response
    if (error) {
      const ambiguous = await providerAttemptIsAmbiguous(error)
      if (ambiguous) {
        const reconciled = await waitForMaterialAnalysisResult({
          request,
          wireRequest,
        })
        if (reconciled.results) return reconciled.results
        if (reconciled.error) {
          throw new AdminProviderAttemptError(
            await getFunctionErrorMessage(
              reconciled.error,
              'Material analysis failed.',
            ),
            false,
          )
        }
      }
      const message = await getFunctionErrorMessage(
        error,
        'Material analysis failed.',
      )
      throw new AdminProviderAttemptError(
        ambiguous
          ? 'AI処理はサーバーで継続しています。完了結果をまだ確認できません。しばらくしてから同じ操作で再確認してください。'
          : message,
        ambiguous,
      )
    }
    if (!data?.ok || !data.results) {
      throw new Error(data?.message ?? 'Material analysis failed.')
    }
    return toAdminMaterialResults(data.results)
  },

  async manageMaterialAnalysis(
    request:
      | {
          action: 'list'
          adminToken: AdminOperationCredentialInput
          lectureSessionId: string
        }
      | {
          action: 'reject'
          adminToken: AdminOperationCredentialInput
          lectureSessionId: string
          proposalId: string
        }
      | {
          action: 'adopt'
          adminToken: AdminOperationCredentialInput
          lectureSessionId: string
          optionLabels: string[]
          pollType: 'single' | 'multiple'
          proposalId: string
          question: string
        }
      | {
          action: 'publishSummary'
          adminToken: AdminOperationCredentialInput
          analysisId: string
          lectureSessionId: string
          reviewState: AdminMaterialPublication['reviewState']
          summaryBody: AdminMaterialSummaryBody
        }
      | {
          action: 'hideSummary'
          adminToken: AdminOperationCredentialInput
          analysisId: string
          lectureSessionId: string
        },
  ): Promise<{ pollId: string | null; results: AdminMaterialResults }> {
    const { data, error } = await invokeEdgeFunction<MaterialFunctionResponse>(
      'manage-material-analysis',
      { body: request, timeout: ADMIN_FUNCTION_TIMEOUT_MS },
    )
    if (error) {
      throw new Error(
        await getFunctionErrorMessage(error, '資料分析の操作に失敗しました。'),
      )
    }
    if (!data?.ok || !data.results) {
      throw new Error(data?.message ?? '資料分析の操作に失敗しました。')
    }
    return {
      pollId: data.pollId ?? null,
      results: toAdminMaterialResults(data.results),
    }
  },

  async manageLectureSummaries(
    request:
      | {
          action: 'status' | 'resume'
          adminToken: AdminOperationCredentialInput
          lectureSessionId: string
        }
      | {
          action: 'start'
          academicSourcePolicy:
            'auto' | 'biomedical_pubmed' | 'multidisciplinary_doi'
          adminToken: AdminOperationCredentialInput
          autoAcademicAnswers: boolean
          lectureSessionId: string
        }
      | {
          action: 'stop'
          adminToken: AdminOperationCredentialInput
          lectureSessionId: string
          reason: string
        }
      | {
          action: 'hide' | 'publish' | 'unpin'
          adminToken: AdminOperationCredentialInput
          lectureSessionId: string
          summaryId: string
        }
      | {
          action: 'pin'
          adminToken: AdminOperationCredentialInput
          lectureSessionId: string
          pinnedOrder: number
          pinnedUntil: string
          summaryId: string
        }
      | {
          action: 'revisePublish'
          adminToken: AdminOperationCredentialInput
          lectureSessionId: string
          reason: string
          revisionBody: { commentPulse: string[]; lectureRecap: string[] }
          summaryId: string
        },
  ): Promise<{
    reason: string | null
    results: AdminSummaryResults
    runToken: string | null
  }> {
    const { data, error } = await invokeEdgeFunction<SummaryFunctionResponse>(
      'manage-lecture-summaries',
      { body: request, timeout: ADMIN_FUNCTION_TIMEOUT_MS },
    )
    if (error) {
      throw new Error(
        await getFunctionErrorMessage(error, '講義要約の操作に失敗しました。'),
      )
    }
    if (!data?.ok) {
      throw new Error(data?.message ?? '講義要約の操作に失敗しました。')
    }
    return {
      reason: data.reason ?? null,
      results: toAdminSummaryResults(data.results),
      runToken: data.runToken ?? null,
    }
  },
}
