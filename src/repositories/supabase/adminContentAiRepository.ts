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
import { invokeEdgeFunction } from './transport'

const {
  adminFunction: ADMIN_FUNCTION_TIMEOUT_MS,
  aiFunction: AI_FUNCTION_TIMEOUT_MS,
} = SUPABASE_REQUEST_TIMEOUT_MS

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

export const adminContentAiRepository = {
  async manageAcademicAnswers(
    request: ManageAcademicAnswersRequest,
  ): Promise<AdminAcademicResults> {
    const requestBody =
      request.action === 'cancel'
        ? {
            ...request,
            academicRequestId: request.requestId,
            requestId: undefined,
          }
        : request
    let response = await invokeEdgeFunction<AcademicFunctionResponse>(
      'generate-academic-answer',
      {
        body: requestBody,
        timeout:
          request.action === 'generate' || request.action === 'generateAuto'
            ? AI_FUNCTION_TIMEOUT_MS
            : ADMIN_FUNCTION_TIMEOUT_MS,
      },
    )
    if (
      response.error &&
      request.action !== 'status' &&
      (await providerAttemptIsAmbiguous(response.error))
    ) {
      response = await invokeEdgeFunction<AcademicFunctionResponse>(
        'generate-academic-answer',
        {
          body: requestBody,
          timeout:
            request.action === 'generate' || request.action === 'generateAuto'
              ? AI_FUNCTION_TIMEOUT_MS
              : ADMIN_FUNCTION_TIMEOUT_MS,
        },
      )
    }
    const { data, error } = response
    if (error) {
      const message = await getFunctionErrorMessage(
        error,
        '文献に基づく参考回答の操作に失敗しました。',
      )
      if (
        request.action === 'generate' || request.action === 'generateAuto'
      ) {
        throw new AdminProviderAttemptError(
          message,
          await providerAttemptIsAmbiguous(error),
        )
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

  async analyzeLectureMaterial(request: {
    action: 'material_analysis' | 'poll_suggestions'
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
  }): Promise<AdminMaterialResults> {
    let response = await invokeEdgeFunction<MaterialFunctionResponse>(
      'analyze-lecture-material',
      { body: request, timeout: AI_FUNCTION_TIMEOUT_MS },
    )
    if (
      response.error &&
      (await providerAttemptIsAmbiguous(response.error))
    ) {
      response = await invokeEdgeFunction<MaterialFunctionResponse>(
        'analyze-lecture-material',
        { body: request, timeout: AI_FUNCTION_TIMEOUT_MS },
      )
    }
    const { data, error } = response
    if (error) {
      const message = await getFunctionErrorMessage(
        error,
        'Material analysis failed.',
      )
      throw new AdminProviderAttemptError(
        message,
        await providerAttemptIsAmbiguous(error),
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
