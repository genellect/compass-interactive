import { supabase } from '../lib/supabaseClient'
import { ensureAnonymousAuthSession } from '../lib/anonymousAuth'
import type { PublisherExtraction } from '../pdf/publisherClient'
import type { LectureStatus } from '../types'

type DisplayMode = 'normal' | 'presentation' | 'slideOnly'

type VerifyAdminPinResponse = {
  adminToken?: string
  message?: string
  ok?: boolean
}

type IssueDisplaySessionResponse = {
  displayToken?: string
  expiresAt?: string
  lectureSessionId?: string
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

export type AdminPollList = {
  hasMore: boolean
  polls: AdminPoll[]
}

type ManageLecturesResponse = {
  lecture?: AdminLecture
  lectures?: AdminLecture[]
  message?: string
  ok?: boolean
}

type ManageCommentsResponse = {
  comment?: unknown
  message?: string
  ok?: boolean
}

type ManageAiControlResponse = {
  control?: unknown
  message?: string
  ok?: boolean
  recentOperations?: unknown[]
  realtimePriceMicrousdPerMinute?: number | null
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

export type RealtimeCaptionCall = {
  model: string
  operationId: string
  pricingRateMicrousdPerMinute: number
  reservedAudioSeconds: number
  reservedMicrousd: number
  reservedUntil: string
  sdpAnswer: string
  sessionConfig: Record<string, unknown>
}

type RealtimeCaptionCallResponse = Partial<RealtimeCaptionCall> & {
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

export type AdminMaterialSummaryBody = {
  lead: string
  points: Array<{
    detail?: string
    pageLabel: string
    title: string
  }>
  reflectionQuestion?: string
}

export type AdminMaterialPublication = {
  analysisId: string
  body: AdminMaterialSummaryBody
  publishedAt: string | null
  reviewState: 'admin_confirmed' | 'admin_revised'
  updatedAt: string
  version: number
  visibility: 'hidden' | 'public'
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
  publication: AdminMaterialPublication | null
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
  publication?: null | {
    analysis_id: string
    body: AdminMaterialSummaryBody
    published_at: string | null
    review_state: AdminMaterialPublication['reviewState']
    updated_at: string
    version: number | string
    visibility: AdminMaterialPublication['visibility']
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

export type AdminSummaryRevision = {
  authorActorId: string | null
  authorType: 'admin' | 'ai'
  body: { commentPulse: string[]; lectureRecap: string[] }
  createdAt: string
  id: string
  reason: string | null
  revisionNumber: number
}

export type AdminLectureSummary = {
  aiOutput: {
    academicQuestionCandidate: {
      commentId: string
      educationalValue: string
      qualityScore: number
      question: string
      rationale: string
    } | null
    commentPulse: string[]
    lectureRecap: string[]
  }
  createdAt: string
  id: string
  modelId: string
  promptVersion: string
  publication: {
    activeRevisionId: string
    pinnedOrder: number | null
    pinnedUntil: string | null
    publishedAt: string | null
    reviewState: 'admin_confirmed' | 'admin_revised' | 'ai_unreviewed'
    visibility: 'hidden' | 'public'
  } | null
  qualityResult: Record<string, unknown>
  revisions: AdminSummaryRevision[]
  status: 'accepted' | 'hidden' | 'published'
  windowEnd: string
  windowIndex: number
  windowStart: string
}

export type AdminSummaryResults = {
  control: {
    budgetLimitMicrousd: number
    inputTokenLimit: number
    inputTokensUsed: number
    outputTokenLimit: number
    outputTokensUsed: number
    status: string
    summariesEnabled: boolean
    summaryCallLimit: number
    summaryCallsUsed: number
    usedMicrousd: number
  } | null
  run: {
    expiresAt: string
    id: string
    lastWindowIndex: number
    status: 'closed' | 'failed' | 'running' | 'stopped'
  } | null
  summaries: AdminLectureSummary[]
  windows: Array<{
    attemptCount: number
    id: string
    lastErrorCode: string | null
    status: string
    windowEnd: string
    windowIndex: number
    windowStart: string
  }>
}

type RawSummaryResults = {
  control?: null | Record<string, unknown>
  run?: null | Record<string, unknown>
  summaries?: Array<Record<string, unknown>>
  windows?: Array<Record<string, unknown>>
}

type SummaryFunctionResponse = {
  actualInputTokens?: number
  actualMicrousd?: number
  actualOutputTokens?: number
  idempotentReplay?: boolean
  message?: string
  ok?: boolean
  published?: boolean
  reason?: string
  results?: RawSummaryResults
  runToken?: string
  skipped?: boolean
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
      includeHistory?: boolean
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
      includeHistory?: boolean
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
  | {
      action: 'duplicate'
      adminToken: string
      lectureSessionId: string
    }

type ManagePollsResponse = {
  hasMore?: boolean
  message?: string
  ok?: boolean
  polls?: AdminPoll[]
}

export type ManagePollsRequest =
  | {
      action: 'list'
      adminToken: string
      includeHistory?: boolean
      lectureSessionId: string
    }
  | {
      action: 'create'
      adminToken: string
      includeHistory?: boolean
      lectureSessionId: string
      optionLabels: string[]
      question: string
      type: 'single' | 'multiple'
    }
  | {
      action: 'open' | 'close'
      adminToken: string
      includeHistory?: boolean
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
  const publication = value?.publication
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
    publication: publication
      ? {
          analysisId: publication.analysis_id,
          body: publication.body,
          publishedAt: publication.published_at,
          reviewState: publication.review_state,
          updatedAt: publication.updated_at,
          version: Number(publication.version),
          visibility: publication.visibility,
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

function toStringArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : []
}

function toAdminSummaryResults(raw?: RawSummaryResults): AdminSummaryResults {
  const control = raw?.control ?? null
  const run = raw?.run ?? null
  return {
    control: control
      ? {
          budgetLimitMicrousd: Number(control.budget_limit_microusd ?? 0),
          inputTokenLimit: Number(control.input_token_limit ?? 0),
          inputTokensUsed: Number(control.input_tokens_used ?? 0),
          outputTokenLimit: Number(control.output_token_limit ?? 0),
          outputTokensUsed: Number(control.output_tokens_used ?? 0),
          status: String(control.status ?? 'disabled'),
          summariesEnabled: Boolean(control.summaries_enabled),
          summaryCallLimit: Number(control.summary_call_limit ?? 18),
          summaryCallsUsed: Number(control.summary_calls_used ?? 0),
          usedMicrousd: Number(control.used_microusd ?? 0),
        }
      : null,
    run: run
      ? {
          expiresAt: String(run.expires_at ?? ''),
          id: String(run.id ?? ''),
          lastWindowIndex: Number(run.last_window_index ?? 0),
          status: String(
            run.status ?? 'stopped',
          ) as AdminSummaryResults['run'] extends infer T
            ? T extends { status: infer S }
              ? S
              : never
            : never,
        }
      : null,
    summaries: (raw?.summaries ?? []).map((item) => {
      const output = (item.ai_output ?? {}) as Record<string, unknown>
      const publication = (item.publication ?? null) as Record<
        string,
        unknown
      > | null
      return {
        aiOutput: {
          academicQuestionCandidate:
            (output.academic_question_candidate as AdminLectureSummary['aiOutput']['academicQuestionCandidate']) ??
            null,
          commentPulse: toStringArray(output.comment_pulse),
          lectureRecap: toStringArray(output.lecture_recap),
        },
        createdAt: String(item.created_at ?? ''),
        id: String(item.id ?? ''),
        modelId: String(item.model_id ?? ''),
        promptVersion: String(item.prompt_version ?? ''),
        publication: publication
          ? {
              activeRevisionId: String(publication.active_revision_id ?? ''),
              pinnedOrder:
                publication.pinned_order == null
                  ? null
                  : Number(publication.pinned_order),
              pinnedUntil:
                publication.pinned_until == null
                  ? null
                  : String(publication.pinned_until),
              publishedAt:
                publication.published_at == null
                  ? null
                  : String(publication.published_at),
              reviewState: String(
                publication.review_state ?? 'ai_unreviewed',
              ) as AdminLectureSummary['publication'] extends infer T
                ? T extends { reviewState: infer S }
                  ? S
                  : never
                : never,
              visibility: String(publication.visibility ?? 'hidden') as
                'hidden' | 'public',
            }
          : null,
        qualityResult: (item.quality_result ?? {}) as Record<string, unknown>,
        revisions: (
          (item.revisions ?? []) as Array<Record<string, unknown>>
        ).map((revision) => {
          const revisionBody = (revision.body ?? {}) as Record<string, unknown>
          return {
            authorActorId:
              revision.author_actor_id == null
                ? null
                : String(revision.author_actor_id),
            authorType: String(revision.author_type ?? 'ai') as 'admin' | 'ai',
            body: {
              commentPulse: toStringArray(revisionBody.comment_pulse),
              lectureRecap: toStringArray(revisionBody.lecture_recap),
            },
            createdAt: String(revision.created_at ?? ''),
            id: String(revision.id ?? ''),
            reason: revision.reason == null ? null : String(revision.reason),
            revisionNumber: Number(revision.revision_number ?? 0),
          }
        }),
        status: String(
          item.status ?? 'accepted',
        ) as AdminLectureSummary['status'],
        windowEnd: String(item.window_end ?? ''),
        windowIndex: Number(item.window_index ?? 0),
        windowStart: String(item.window_start ?? ''),
      }
    }),
    windows: (raw?.windows ?? []).map((item) => ({
      attemptCount: Number(item.attempt_count ?? 0),
      id: String(item.id ?? ''),
      lastErrorCode:
        item.last_error_code == null ? null : String(item.last_error_code),
      status: String(item.status ?? 'pending'),
      windowEnd: String(item.window_end ?? ''),
      windowIndex: Number(item.window_index ?? 0),
      windowStart: String(item.window_start ?? ''),
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

    await ensureAnonymousAuthSession()

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

  async issueDisplaySession(request: {
    adminToken: string
    lectureSessionId: string
  }) {
    await ensureAnonymousAuthSession()

    const { data, error } =
      await supabase.functions.invoke<IssueDisplaySessionResponse>(
        'issue-display-session',
        { body: request },
      )
    if (error) {
      throw new Error(
        await getFunctionErrorMessage(
          error,
          'Display session could not be issued.',
        ),
      )
    }
    if (
      !data?.ok ||
      !data.displayToken ||
      !data.expiresAt ||
      data.lectureSessionId !== request.lectureSessionId
    ) {
      throw new Error(data?.message ?? 'Display session could not be issued.')
    }

    return {
      displayToken: data.displayToken,
      expiresAt: data.expiresAt,
      lectureSessionId: data.lectureSessionId,
    }
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
        await getFunctionErrorMessage(error, '講義の操作に失敗しました。'),
      )
    }

    if (!data?.ok || !data.lectures) {
      throw new Error(data?.message ?? '講義の操作に失敗しました。')
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
        await getFunctionErrorMessage(error, 'API usage authorization failed.'),
      )
    }
    if (!data?.ok || !data.billingGrant || !data.expiresAt) {
      throw new Error(data?.message ?? 'API usage authorization failed.')
    }
    return {
      actions: data.actions ?? request.actions,
      billingGrant: data.billingGrant,
      expiresAt: data.expiresAt,
    }
  },

  async createRealtimeCaptionCall(request: {
    adminToken: string
    billingGrant: string
    delay: 'minimal' | 'low' | 'medium' | 'high' | 'xhigh'
    idempotencyKey: string
    language: RealtimeCaptionLanguage
    lectureSessionId: string
    maxAudioSeconds: number
    sdpOffer: string
  }): Promise<RealtimeCaptionCall> {
    const { data, error } =
      await supabase.functions.invoke<RealtimeCaptionCallResponse>(
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
      !data.model ||
      !data.operationId ||
      !data.pricingRateMicrousdPerMinute ||
      !data.reservedAudioSeconds ||
      !data.reservedMicrousd ||
      !data.reservedUntil ||
      !data.sdpAnswer ||
      !data.sessionConfig
    ) {
      throw new Error(
        data?.message ?? 'Realtime caption connection could not be prepared.',
      )
    }
    return {
      model: data.model,
      operationId: data.operationId,
      pricingRateMicrousdPerMinute: data.pricingRateMicrousdPerMinute,
      reservedAudioSeconds: data.reservedAudioSeconds,
      reservedMicrousd: data.reservedMicrousd,
      reservedUntil: data.reservedUntil,
      sdpAnswer: data.sdpAnswer,
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
        await getFunctionErrorMessage(error, '講義資料の操作に失敗しました。'),
      )
    }
    if (!data?.ok || !data.documents) {
      throw new Error(data?.message ?? '講義資料の操作に失敗しました。')
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
        }
      | {
          action: 'publishSummary'
          adminToken: string
          analysisId: string
          lectureSessionId: string
          reviewState: AdminMaterialPublication['reviewState']
          summaryBody: AdminMaterialSummaryBody
        }
      | {
          action: 'hideSummary'
          adminToken: string
          analysisId: string
          lectureSessionId: string
          reviewState: AdminMaterialPublication['reviewState']
          summaryBody: AdminMaterialSummaryBody
        },
  ): Promise<{ pollId: string | null; results: AdminMaterialResults }> {
    const { data, error } =
      await supabase.functions.invoke<MaterialFunctionResponse>(
        'manage-material-analysis',
        { body: request },
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
          adminToken: string
          lectureSessionId: string
        }
      | {
          action: 'start'
          adminToken: string
          billingGrant: string
          lectureSessionId: string
        }
      | {
          action: 'stop'
          adminToken: string
          lectureSessionId: string
          reason: string
        }
      | {
          action: 'hide' | 'publish' | 'unpin'
          adminToken: string
          lectureSessionId: string
          summaryId: string
        }
      | {
          action: 'pin'
          adminToken: string
          lectureSessionId: string
          pinnedOrder: number
          pinnedUntil: string
          summaryId: string
        }
      | {
          action: 'revisePublish'
          adminToken: string
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
    const { data, error } =
      await supabase.functions.invoke<SummaryFunctionResponse>(
        'manage-lecture-summaries',
        { body: request },
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

  async generateLectureSummary(request: {
    adminToken: string
    lectureSessionId: string
    pdfContext: {
      documentId: string
      documentVersion: string
      pages: Array<{ excerptId: string; pageNumber: number; text: string }>
    } | null
    runToken: string
    transcriptSegments: Array<{
      completedAt: string
      itemId: string
      startedAt: string
      text: string
    }>
    windowIndex: number
  }): Promise<{
    actualMicrousd: number
    published: boolean
    results: AdminSummaryResults
    skipped: boolean
  }> {
    const { data, error } =
      await supabase.functions.invoke<SummaryFunctionResponse>(
        'generate-lecture-summary',
        { body: request },
      )
    if (error) {
      throw new Error(
        await getFunctionErrorMessage(error, '講義要約の生成に失敗しました。'),
      )
    }
    if (!data?.ok) {
      throw new Error(data?.message ?? '講義要約の生成に失敗しました。')
    }
    return {
      actualMicrousd: Number(data.actualMicrousd ?? 0),
      published: Boolean(data.published),
      results: toAdminSummaryResults(data.results),
      skipped: Boolean(data.skipped),
    }
  },

  async managePolls(request: ManagePollsRequest): Promise<AdminPollList> {
    const { data, error } =
      await supabase.functions.invoke<ManagePollsResponse>('manage-polls', {
        body: request,
      })

    if (error) {
      throw new Error(
        await getFunctionErrorMessage(error, '投票の操作に失敗しました。'),
      )
    }

    if (!data?.ok || !data.polls) {
      throw new Error(data?.message ?? '投票の操作に失敗しました。')
    }

    return {
      hasMore: data.hasMore ?? data.polls.length > 5,
      polls: data.polls,
    }
  },

  async moderateComment(request: {
    action: 'togglePin' | 'toggleVisibility'
    adminToken: string
    commentId: string
    lectureSessionId: string
  }) {
    const { data, error } =
      await supabase.functions.invoke<ManageCommentsResponse>(
        'manage-comments',
        { body: request },
      )

    if (error) {
      throw new Error(
        await getFunctionErrorMessage(error, 'Comment moderation failed.'),
      )
    }
    if (!data?.ok) {
      throw new Error(data?.message ?? 'Comment moderation failed.')
    }
  },
}
