import { supabase } from '../lib/supabaseClient'
import type { PublisherExtraction } from '../pdf/publisherClient'
import type { LectureStatus } from '../types'

type DisplayMode = 'normal' | 'presentation' | 'slideOnly'

type VerifyAdminPinResponse = {
  adminToken?: string
  message?: string
  ok?: boolean
}

type DisplayStateRow = {
  current_pdf_page: number
  display_mode: DisplayMode
  lecture_session_id: string
  pdf_document_id: string | null
  pdf_document_version: string | null
  pdf_manifest_version: number
  pdf_page_count: number | null
  pdf_visible: boolean
  updated_at: string
}

export type AdminDisplayState = {
  currentPdfPage: number
  displayMode: DisplayMode
  lectureSessionId: string
  pdfDocumentId: string | null
  pdfDocumentVersion: string | null
  pdfManifestVersion: number
  pdfPageCount: number | null
  pdfVisible: boolean
  updatedAt: string
}

type UpdateDisplayStateResponse = {
  displayState?: DisplayStateRow
  message?: string
  ok?: boolean
}

type UpdateDisplayStateRequest =
  | {
      action: 'next' | 'previous'
      adminToken: string
      lectureSessionId: string
    }
  | {
      action: 'goToPage'
      adminToken: string
      currentPdfPage: number
      lectureSessionId: string
    }
  | {
      action: 'setDisplayMode'
      adminToken: string
      displayMode: DisplayMode
      lectureSessionId: string
    }
  | {
      action: 'setDocument'
      adminToken: string
      lectureSessionId: string
      pdfDocumentId: string | null
    }

export type AdminLecture = {
  archiveExpiresAt: string | null
  closedAt: string | null
  closeActorType: string | null
  closeReason: string | null
  createdAt: string
  endsAt: string | null
  hardStopAt: string | null
  id: string
  lectureCode: string
  startsAt: string | null
  status: LectureStatus
  title: string
  updatedAt: string
}

export type AdminPollOption = {
  id: string
  label: string
  order: number
  responseCount: number
}

export type AdminPoll = {
  createdAt: string
  id: string
  lectureSessionId: string
  options: AdminPollOption[]
  question: string
  status: 'draft' | 'open' | 'closed'
  type: 'single' | 'multiple'
  updatedAt: string
}

type ManageLecturesResponse = {
  lecture?: AdminLecture
  lectures?: AdminLecture[]
  message?: string
  ok?: boolean
}

type ManageAiControlResponse = {
  control?: unknown
  message?: string
  ok?: boolean
  recentOperations?: unknown[]
  result?: unknown
}

export type AiBillingAction =
  | 'captions'
  | 'summaries'
  | 'material_analysis'
  | 'poll_suggestions'
  | 'academic_answers'

type AuthorizeAiStartResponse = {
  actions?: AiBillingAction[]
  billingGrant?: string
  expiresAt?: string
  message?: string
  ok?: boolean
  reason?: string
  retryAt?: string | null
}

export type RealtimeCaptionLanguage = 'auto' | 'en' | 'ja'

export type RealtimeCaptionSecret = {
  clientSecret: string
  expiresAt: number | null
  model: string
  operationId: string
  sessionConfig: Record<string, unknown>
}

type RealtimeCaptionSecretResponse = Partial<RealtimeCaptionSecret> & {
  message?: string
  ok?: boolean
}

type PublishCaptionResponse = {
  message?: string
  ok?: boolean
  result?: unknown
}

export type AdminPdfDocument = {
  byteSize: number
  displayName: string
  documentId: string
  documentVersion: string
  downloadEnabled: boolean
  manifestVersion: number
  pageCount: number
  pdfSha256: string
  publishedAt: string
  textCharCount: number
  textSha256: string
  visible: boolean
}

export type AdminMaterialAnalysis = {
  createdAt: string
  id: string
  importantPages: number[]
  keyTerms: Array<{ definition: string; term: string }>
  materialOutline: Array<{
    pageEnd: number
    pageStart: number
    title: string
  }>
  materialSummary: string
  modelId: string
  operationId: string
  sectionBoundaries: Array<{
    pageEnd: number
    pageStart: number
    rationale: string
    title: string
  }>
  sourceDocumentId: string
  sourceDocumentVersion: string
}

export type AdminPollProposal = {
  adoptedPollId: string | null
  analysisId: string
  correctOptionIds: string[]
  createdAt: string
  difficulty: 'beginner' | 'intermediate' | 'advanced'
  educationalValue: string
  evidenceExcerptIds: string[]
  evidencePages: number[]
  explanation: string
  id: string
  learningObjective: string
  misconceptionTarget: string | null
  options: Array<{ id: string; text: string }>
  proposalType: 'single_choice' | 'multiple_choice' | 'discussion'
  qualityScore: number
  reviewedAt: string | null
  status: 'draft' | 'adopted' | 'rejected' | 'expired' | 'superseded'
  stem: string
}

export type AdminMaterialResults = {
  analysis: AdminMaterialAnalysis | null
  proposals: AdminPollProposal[]
}

type RawMaterialResults = {
  analysis?: null | {
    created_at: string
    id: string
    important_pages: number[]
    key_terms: AdminMaterialAnalysis['keyTerms']
    material_outline: AdminMaterialAnalysis['materialOutline']
    material_summary: string
    model_id: string
    operation_id: string
    section_boundaries: AdminMaterialAnalysis['sectionBoundaries']
    source_document_id: string
    source_document_version: string
  }
  proposals?: Array<{
    adopted_poll_id: string | null
    analysis_id: string
    correct_option_ids: string[]
    created_at: string
    difficulty: AdminPollProposal['difficulty']
    educational_value: string
    evidence_excerpt_ids: string[]
    evidence_pages: number[]
    explanation: string
    id: string
    learning_objective: string
    misconception_target: string | null
    options: AdminPollProposal['options']
    proposal_type: AdminPollProposal['proposalType']
    quality_score: number | string
    reviewed_at: string | null
    status: AdminPollProposal['status']
    stem: string
  }>
}

type MaterialFunctionResponse = {
  message?: string
  ok?: boolean
  pollId?: string | null
  results?: RawMaterialResults
}

type ManagePdfDocumentsResponse = {
  documents?: AdminPdfDocument[]
  message?: string
  ok?: boolean
}

export type ManagePdfDocumentsRequest =
  | {
      action: 'list'
      adminToken: string
      lectureSessionId: string
    }
  | ({
      action: 'register'
      adminToken: string
      lectureSessionId: string
    } & Omit<AdminPdfDocument, 'publishedAt' | 'visible'>)

export type ManageAiControlRequest =
  | {
      action: 'status'
      adminToken: string
      lectureSessionId: string
    }
  | {
      action: 'configure'
      adminToken: string
      configuration: Record<string, boolean | number>
      lectureSessionId: string
    }
  | {
      action: 'startOperation'
      adminToken: string
      estimatedAudioSeconds?: number
      estimatedInputTokens?: number
      estimatedMicrousd?: number
      estimatedOutputTokens?: number
      feature:
        | 'captions'
        | 'summaries'
        | 'material_analysis'
        | 'poll_suggestions'
        | 'academic_answers'
      idempotencyKey: string
      lectureSessionId: string
    }
  | {
      action: 'finishOperation'
      actualAudioSeconds?: number
      actualInputTokens?: number
      actualMicrousd?: number
      actualOutputTokens?: number
      adminToken: string
      errorCode?: string | null
      operationId: string
      providerRequestId?: string | null
      status: 'succeeded' | 'failed' | 'cancelled'
    }
  | {
      action: 'heartbeat'
      adminToken: string
      operationId: string
    }
  | {
      action: 'stopFeature'
      adminToken: string
      operationId: string
      reason: string
    }
  | {
      action: 'stop'
      adminToken: string
      lectureSessionId: string
      reason: string
    }

type ManageLecturesRequest =
  | {
      action: 'list'
      adminToken: string
    }
  | {
      action: 'create'
      adminToken: string
      endsAt?: string | null
      startsAt?: string | null
      title: string
    }
  | {
      action: 'start' | 'close'
      adminToken: string
      lectureSessionId: string
    }

type ManagePollsResponse = {
  message?: string
  ok?: boolean
  polls?: AdminPoll[]
}

export type ManagePollsRequest =
  | {
      action: 'list'
      adminToken: string
      lectureSessionId: string
    }
  | {
      action: 'create'
      adminToken: string
      lectureSessionId: string
      optionLabels: string[]
      question: string
      type: 'single' | 'multiple'
    }
  | {
      action: 'open' | 'close'
      adminToken: string
      lectureSessionId: string
      pollId: string
    }

function toAdminDisplayState(row: DisplayStateRow): AdminDisplayState {
  return {
    currentPdfPage: row.current_pdf_page,
    displayMode: row.display_mode,
    lectureSessionId: row.lecture_session_id,
    pdfDocumentId: row.pdf_document_id,
    pdfDocumentVersion: row.pdf_document_version,
    pdfManifestVersion: row.pdf_manifest_version,
    pdfPageCount: row.pdf_page_count,
    pdfVisible: row.pdf_visible,
    updatedAt: row.updated_at,
  }
}

function toAdminMaterialResults(
  value: RawMaterialResults | null | undefined,
): AdminMaterialResults {
  const analysis = value?.analysis
  return {
    analysis: analysis
      ? {
          createdAt: analysis.created_at,
          id: analysis.id,
          importantPages: analysis.important_pages,
          keyTerms: analysis.key_terms,
          materialOutline: analysis.material_outline,
          materialSummary: analysis.material_summary,
          modelId: analysis.model_id,
          operationId: analysis.operation_id,
          sectionBoundaries: analysis.section_boundaries,
          sourceDocumentId: analysis.source_document_id,
          sourceDocumentVersion: analysis.source_document_version,
        }
      : null,
    proposals: (value?.proposals ?? []).map((proposal) => ({
      adoptedPollId: proposal.adopted_poll_id,
      analysisId: proposal.analysis_id,
      correctOptionIds: proposal.correct_option_ids,
      createdAt: proposal.created_at,
      difficulty: proposal.difficulty,
      educationalValue: proposal.educational_value,
      evidenceExcerptIds: proposal.evidence_excerpt_ids,
      evidencePages: proposal.evidence_pages,
      explanation: proposal.explanation,
      id: proposal.id,
      learningObjective: proposal.learning_objective,
      misconceptionTarget: proposal.misconception_target,
      options: proposal.options,
      proposalType: proposal.proposal_type,
      qualityScore: Number(proposal.quality_score),
      reviewedAt: proposal.reviewed_at,
      status: proposal.status,
      stem: proposal.stem,
    })),
  }
}

async function getFunctionErrorMessage(
  error: unknown,
  fallbackMessage: string,
) {
  if (!(error instanceof Error)) {
    return fallbackMessage
  }

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

export const supabaseAdminRepository = {
  async verifyAdminPin(pin: string) {
    const trimmedPin = pin.trim()

    if (!trimmedPin) {
      throw new Error('Admin PIN is required.')
    }

    const { data, error } =
      await supabase.functions.invoke<VerifyAdminPinResponse>(
        'verify-admin-pin',
        {
          body: { pin: trimmedPin },
        },
      )

    if (error) {
      throw new Error(
        await getFunctionErrorMessage(error, 'Admin PIN check failed.'),
      )
    }

    if (!data?.ok) {
      throw new Error(data?.message ?? 'Admin PIN is invalid.')
    }

    if (!data.adminToken) {
      throw new Error('Admin session token was not returned.')
    }

    return data.adminToken
  },

  async updateDisplayState(
    request: UpdateDisplayStateRequest,
  ): Promise<AdminDisplayState> {
    const { data, error } =
      await supabase.functions.invoke<UpdateDisplayStateResponse>(
        'update-display-state',
        {
          body: request,
        },
      )

    if (error) {
      throw new Error(
        await getFunctionErrorMessage(error, 'Display state update failed.'),
      )
    }

    if (!data?.ok || !data.displayState) {
      throw new Error(data?.message ?? 'Display state update failed.')
    }

    return toAdminDisplayState(data.displayState)
  },

  async manageLectures(
    request: ManageLecturesRequest,
  ): Promise<AdminLecture[]> {
    const { data, error } =
      await supabase.functions.invoke<ManageLecturesResponse>(
        'manage-lectures',
        {
          body: request,
        },
      )

    if (error) {
      throw new Error(
        await getFunctionErrorMessage(error, 'Lecture operation failed.'),
      )
    }

    if (!data?.ok || !data.lectures) {
      throw new Error(data?.message ?? 'Lecture operation failed.')
    }

    return data.lectures
  },

  async manageAiControl(request: ManageAiControlRequest) {
    const { data, error } =
      await supabase.functions.invoke<ManageAiControlResponse>(
        'manage-ai-control',
        { body: request },
      )

    if (error) {
      throw new Error(
        await getFunctionErrorMessage(error, 'AI control operation failed.'),
      )
    }
    if (!data?.ok) {
      throw new Error(data?.message ?? 'AI control operation failed.')
    }

    return data
  },

  async authorizeAiStart(request: {
    actions: AiBillingAction[]
    adminToken: string
    billingPin: string
    lectureSessionId: string
  }) {
    const { data, error } =
      await supabase.functions.invoke<AuthorizeAiStartResponse>(
        'authorize-ai-start',
        { body: request },
      )
    if (error) {
      throw new Error(
        await getFunctionErrorMessage(error, 'Billing authorization failed.'),
      )
    }
    if (!data?.ok || !data.billingGrant || !data.expiresAt) {
      throw new Error(data?.message ?? 'Billing authorization failed.')
    }
    return {
      actions: data.actions ?? request.actions,
      billingGrant: data.billingGrant,
      expiresAt: data.expiresAt,
    }
  },

  async issueRealtimeCaptionSecret(request: {
    adminToken: string
    billingGrant: string
    delay: 'minimal' | 'low' | 'medium' | 'high' | 'xhigh'
    idempotencyKey: string
    language: RealtimeCaptionLanguage
    lectureSessionId: string
  }): Promise<RealtimeCaptionSecret> {
    const { data, error } =
      await supabase.functions.invoke<RealtimeCaptionSecretResponse>(
        'issue-realtime-client-secret',
        { body: request },
      )
    if (error) {
      throw new Error(
        await getFunctionErrorMessage(
          error,
          'Realtime caption connection could not be prepared.',
        ),
      )
    }
    if (
      !data?.ok ||
      !data.clientSecret ||
      !data.model ||
      !data.operationId ||
      !data.sessionConfig
    ) {
      throw new Error(
        data?.message ?? 'Realtime caption connection could not be prepared.',
      )
    }
    return {
      clientSecret: data.clientSecret,
      expiresAt: data.expiresAt ?? null,
      model: data.model,
      operationId: data.operationId,
      sessionConfig: data.sessionConfig,
    }
  },

  async publishCaptionWindow(request: {
    adminToken: string
    language: RealtimeCaptionLanguage | 'mixed' | 'und'
    lastItemId: string
    lectureSessionId: string
    operationId: string
    sequence: number
    text: string
  }) {
    const { data, error } =
      await supabase.functions.invoke<PublishCaptionResponse>(
        'publish-caption-window',
        { body: request },
      )
    if (error) {
      throw new Error(
        await getFunctionErrorMessage(error, 'Caption publishing failed.'),
      )
    }
    if (!data?.ok) {
      throw new Error(data?.message ?? 'Caption publishing failed.')
    }
    return data.result
  },

  async managePdfDocuments(
    request: ManagePdfDocumentsRequest,
  ): Promise<AdminPdfDocument[]> {
    const { data, error } =
      await supabase.functions.invoke<ManagePdfDocumentsResponse>(
        'manage-pdf-documents',
        { body: request },
      )
    if (error) {
      throw new Error(
        await getFunctionErrorMessage(error, 'PDF metadata operation failed.'),
      )
    }
    if (!data?.ok || !data.documents) {
      throw new Error(data?.message ?? 'PDF metadata operation failed.')
    }
    return data.documents
  },

  async analyzeLectureMaterial(request: {
    action: 'material_analysis' | 'poll_suggestions'
    adminToken: string
    analysisId?: string | null
    billingGrant: string
    documentId: string
    documentVersion: string
    extraction: PublisherExtraction
    idempotencyKey: string
    lectureSessionId: string
    pageEnd?: number | null
    pageStart?: number | null
  }): Promise<AdminMaterialResults> {
    const { data, error } =
      await supabase.functions.invoke<MaterialFunctionResponse>(
        'analyze-lecture-material',
        { body: request },
      )
    if (error) {
      throw new Error(
        await getFunctionErrorMessage(error, 'Material analysis failed.'),
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
          adminToken: string
          lectureSessionId: string
        }
      | {
          action: 'reject'
          adminToken: string
          lectureSessionId: string
          proposalId: string
        }
      | {
          action: 'adopt'
          adminToken: string
          lectureSessionId: string
          optionLabels: string[]
          pollType: 'single' | 'multiple'
          proposalId: string
          question: string
        },
  ): Promise<{ pollId: string | null; results: AdminMaterialResults }> {
    const { data, error } =
      await supabase.functions.invoke<MaterialFunctionResponse>(
        'manage-material-analysis',
        { body: request },
      )
    if (error) {
      throw new Error(
        await getFunctionErrorMessage(
          error,
          'Material analysis operation failed.',
        ),
      )
    }
    if (!data?.ok || !data.results) {
      throw new Error(data?.message ?? 'Material analysis operation failed.')
    }
    return {
      pollId: data.pollId ?? null,
      results: toAdminMaterialResults(data.results),
    }
  },

  async managePolls(request: ManagePollsRequest): Promise<AdminPoll[]> {
    const { data, error } =
      await supabase.functions.invoke<ManagePollsResponse>('manage-polls', {
        body: request,
      })

    if (error) {
      throw new Error(
        await getFunctionErrorMessage(error, 'Poll operation failed.'),
      )
    }

    if (!data?.ok || !data.polls) {
      throw new Error(data?.message ?? 'Poll operation failed.')
    }

    return data.polls
  },
}
