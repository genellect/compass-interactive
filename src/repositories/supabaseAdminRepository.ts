import { type AdminOperationCredentialInput } from '../lib/adminAuth/adminOperationCredential'
import type { LectureStatus } from '../types'

import {
  getFunctionErrorMessage,
  SUPABASE_REQUEST_TIMEOUT_MS,
} from './supabase/requestPolicy'
import { invokeEdgeFunction } from './supabase/transport'
import { aiActivationIntentRepository } from './supabase/aiActivationIntentRepository'
import { aiMasterAuthorizationRepository } from './supabase/aiMasterAuthorizationRepository'
import {
  adminContentAiRepository,
  providerAttemptIsAmbiguous,
} from './supabase/adminContentAiRepository'
import {
  toAdminDisplayState,
  toAdminRecoveredSummaryResponse,
  toAdminSummaryResults,
  type DisplayStateRow,
  type RawSummaryResults,
} from './supabase/adminMappers'

export type {
  AdminAcademicAnswer,
  AdminAcademicCandidate,
  AdminAcademicResults,
  AdminAcademicSource,
  ManageAcademicAnswersRequest,
} from './supabase/adminAcademicTypes'
export type {
  AiBillingAction,
  AiMasterAuthorization,
  AiMasterAuthorizationScope,
  AiMasterAuthorizationStatus,
} from './supabase/aiMasterAuthorizationRepository'
export type { AiActivationIntentStatus } from './supabase/aiActivationIntentRepository'
export {
  AdminProviderAttemptError,
  shouldRetainAdminProviderAttempt,
} from './supabase/adminContentAiRepository'

const {
  adminFunction: ADMIN_FUNCTION_TIMEOUT_MS,
  aiFunction: AI_FUNCTION_TIMEOUT_MS,
  realtimeStart: REALTIME_START_TIMEOUT_MS,
} = SUPABASE_REQUEST_TIMEOUT_MS

type DisplayMode = 'normal' | 'presentation' | 'slideOnly'

export type AdminSessionSummary = {
  expiresAt: string
  id: string
  idleExpiresAt: string
  issuedAt: string
  lastSeenAt: string
  revokeReason: string | null
  revokedAt: string | null
}

type ManageAdminSessionsResponse = {
  currentSessionId?: string
  message?: string
  ok?: boolean
  sessions?: Array<{
    expires_at: string
    id: string
    idle_expires_at: string
    issued_at: string
    last_seen_at: string
    revoke_reason: string | null
    revoked_at: string | null
  }>
}

type IssueDisplaySessionResponse = {
  displayToken?: string
  expiresAt?: string
  lectureSessionId?: string
  message?: string
  ok?: boolean
  realtime?: {
    expiresAt?: string
    topic?: string
  } | null
}

export type AdminDisplayDeliveryState =
  'connected' | 'ended' | 'reconnecting' | 'synced' | 'waiting'

export type AdminDisplaySessionStatus = {
  connectedAt: string | null
  connectionGeneration: number
  currentDisplayVersion: number | null
  currentPage: number | null
  expiresAt: string
  hardStopAt: string
  lastAppliedDisplayVersion: number | null
  lastHeartbeatAt: string | null
  lastRenderedPage: number | null
  revokeReason: string | null
  revokedAt: string | null
  sessionId: string
  state: AdminDisplayDeliveryState
}

type DisplaySessionStatusResponse = {
  message?: string
  ok?: boolean
  runtimeEnabled?: boolean
  serverTime?: string
  session?: AdminDisplaySessionStatus | null
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
      adminToken: AdminOperationCredentialInput
      lectureSessionId: string
    }
  | {
      action: 'goToPage'
      adminToken: AdminOperationCredentialInput
      currentPdfPage: number
      lectureSessionId: string
    }
  | {
      action: 'setDisplayMode'
      adminToken: AdminOperationCredentialInput
      displayMode: DisplayMode
      lectureSessionId: string
    }
  | {
      action: 'setDocument'
      adminToken: AdminOperationCredentialInput
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
  journalClub?: {
    expectedDocumentId: string
    expectedPdfByteSize: number
    expectedPdfPageCount: number
    expectedPdfSha256: string
    presetVersion: number
    runKind: 'production' | 'rehearsal'
  } | null
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
  templateOrder?: number | null
  type: 'single' | 'multiple'
  updatedAt: string
}

export type AdminPollList = {
  hasMore: boolean
  polls: AdminPoll[]
}

type ManageLecturesResponse = {
  createdLectureSessionId?: string
  idempotentReplay?: boolean
  lecture?: AdminLecture
  lectures?: AdminLecture[]
  message?: string
  ok?: boolean
}

type ManageLecturesSuccessResponse = Omit<
  ManageLecturesResponse,
  'lectures' | 'ok'
> & {
  lectures: AdminLecture[]
  ok: true
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
  idempotentReplay?: boolean
  message?: string
  metadata?: Record<string, unknown>
  ok?: boolean
  result?: unknown
  shouldStop?: boolean
  status?: string | null
}

export type PublishCaptionResult = {
  accepted: boolean
  idempotentReplay: boolean
  metadata: Record<string, unknown>
  result: unknown
  shouldStop: boolean
  status: string | null
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
    summaryLanguage: SummaryLanguagePreference
    usedMicrousd: number
  } | null
  run: {
    academicSourcePolicy: 'auto' | 'biomedical_pubmed' | 'multidisciplinary_doi'
    autoAcademicAnswersEnabled: boolean
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
    languageReason: string | null
    requestedLanguage: SummaryLanguagePreference
    resolvedLanguage: 'ja' | 'en' | null
    status: string
    windowEnd: string
    windowIndex: number
    windowStart: string
  }>
}

export type SummaryLanguagePreference = 'auto' | 'ja' | 'en'

type SummaryFunctionResponse = {
  actualInputTokens?: number
  actualMicrousd?: number
  actualOutputTokens?: number
  idempotentReplay?: boolean
  message?: string
  ok?: boolean
  published?: boolean
  reason?: string
  refreshRequired?: boolean
  results?: RawSummaryResults
  runToken?: string
  skipped?: boolean
  windowId?: string
}

type ManagePdfDocumentsResponse = {
  documents?: AdminPdfDocument[]
  message?: string
  ok?: boolean
}

export type ManagePdfDocumentsRequest =
  | {
      action: 'list'
      adminToken: AdminOperationCredentialInput
      includeHistory?: boolean
      lectureSessionId: string
    }
  | ({
      action: 'register'
      adminToken: AdminOperationCredentialInput
      expectedAccessVersion: number
      lectureSessionId: string
      manifestEtag: string
    } & Omit<AdminPdfDocument, 'publishedAt' | 'visible'>)

export type ManageAiControlRequest =
  | {
      action: 'status'
      adminToken: AdminOperationCredentialInput
      lectureSessionId: string
    }
  | {
      action: 'configure'
      adminToken: AdminOperationCredentialInput
      configuration: Record<string, boolean | number | string>
      lectureSessionId: string
    }
  | {
      action: 'startOperation'
      adminToken: AdminOperationCredentialInput
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
      adminToken: AdminOperationCredentialInput
      errorCode?: string | null
      operationId: string
      providerRequestId?: string | null
      status: 'succeeded' | 'failed' | 'cancelled'
    }
  | {
      action: 'heartbeat'
      adminToken: AdminOperationCredentialInput
      lectureSessionId?: string
      operationId: string
      requestId?: string
    }
  | {
      action: 'stopFeature'
      adminToken: AdminOperationCredentialInput
      lectureSessionId?: string
      operationId: string
      reason: string
      requestId?: string
    }
  | {
      action: 'stop'
      adminToken: AdminOperationCredentialInput
      lectureSessionId: string
      reason: string
    }

type ManageLecturesRequest =
  | {
      action: 'list'
      adminToken: AdminOperationCredentialInput
      includeHistory?: boolean
    }
  | {
      action: 'create'
      adminToken: AdminOperationCredentialInput
      endsAt?: string | null
      startsAt?: string | null
      title: string
    }
  | {
      action: 'start' | 'close' | 'emergencyStop'
      adminToken: AdminOperationCredentialInput
      lectureSessionId: string
    }
  | {
      action: 'duplicate'
      adminToken: AdminOperationCredentialInput
      lectureSessionId: string
    }
  | {
      action: 'createJournalClubRun'
      adminToken: AdminOperationCredentialInput
      clientRequestId: string
      runKind: 'production' | 'rehearsal'
    }

type CreateLectureRequest = Omit<
  Extract<ManageLecturesRequest, { action: 'create' }>,
  'action'
>

type DuplicateLectureRequest = Omit<
  Extract<ManageLecturesRequest, { action: 'duplicate' }>,
  'action'
>

export type AdminLectureCreationResult = {
  idempotentReplay: boolean
  lectureSessionId: string
  lectures: AdminLecture[]
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
      adminToken: AdminOperationCredentialInput
      includeHistory?: boolean
      lectureSessionId: string
    }
  | {
      action: 'create'
      adminToken: AdminOperationCredentialInput
      includeHistory?: boolean
      lectureSessionId: string
      optionLabels: string[]
      question: string
      type: 'single' | 'multiple'
    }
  | {
      action: 'open' | 'close'
      adminToken: AdminOperationCredentialInput
      includeHistory?: boolean
      lectureSessionId: string
      pollId: string
    }

async function invokeManageLectures(
  request: ManageLecturesRequest,
): Promise<ManageLecturesSuccessResponse> {
  let response = await invokeEdgeFunction<ManageLecturesResponse>(
    'manage-lectures',
    {
      body: request,
      timeout: ADMIN_FUNCTION_TIMEOUT_MS,
    },
  )
  if (
    response.error &&
    request.action !== 'list' &&
    (await providerAttemptIsAmbiguous(response.error))
  ) {
    response = await invokeEdgeFunction<ManageLecturesResponse>(
      'manage-lectures',
      {
        body: request,
        timeout: ADMIN_FUNCTION_TIMEOUT_MS,
      },
    )
  }
  const { data, error } = response

  if (error) {
    throw new Error(
      await getFunctionErrorMessage(error, '講義の操作に失敗しました。'),
    )
  }

  if (!data?.ok || !Array.isArray(data.lectures)) {
    throw new Error(data?.message ?? '講義の操作に失敗しました。')
  }

  return data as ManageLecturesSuccessResponse
}

export const supabaseAdminRepository = {
  ...aiActivationIntentRepository,
  ...aiMasterAuthorizationRepository,

  async manageAdminSessions(request: {
    action: 'list' | 'logout' | 'revoke' | 'revokeAll'
    adminToken: AdminOperationCredentialInput
    sessionId?: string
  }) {
    const { data, error } =
      await invokeEdgeFunction<ManageAdminSessionsResponse>(
        'manage-admin-sessions',
        { body: request, timeout: ADMIN_FUNCTION_TIMEOUT_MS },
      )
    if (error || !data?.ok) {
      throw new Error(
        error
          ? await getFunctionErrorMessage(
              error,
              'Admin session operation failed.',
            )
          : (data?.message ?? 'Admin session operation failed.'),
      )
    }
    return {
      currentSessionId: data.currentSessionId ?? null,
      sessions: (data.sessions ?? []).map((session) => ({
        expiresAt: session.expires_at,
        id: session.id,
        idleExpiresAt: session.idle_expires_at,
        issuedAt: session.issued_at,
        lastSeenAt: session.last_seen_at,
        revokeReason: session.revoke_reason,
        revokedAt: session.revoked_at,
      })) satisfies AdminSessionSummary[],
    }
  },

  async issueDisplaySession(request: {
    adminToken: AdminOperationCredentialInput
    enableRealtime?: boolean
    lectureSessionId: string
  }) {
    const { data, error } =
      await invokeEdgeFunction<IssueDisplaySessionResponse>(
        'issue-display-session',
        { body: request, timeout: ADMIN_FUNCTION_TIMEOUT_MS },
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
      realtime:
        data.realtime?.expiresAt && data.realtime.topic
          ? {
              expiresAt: data.realtime.expiresAt,
              topic: data.realtime.topic,
            }
          : null,
    }
  },

  async getDisplaySessionStatus(request: {
    adminToken: AdminOperationCredentialInput
    lectureSessionId: string
  }) {
    const { data, error } =
      await invokeEdgeFunction<DisplaySessionStatusResponse>(
        'display-session-status',
        {
          body: { action: 'status', ...request },
          timeout: ADMIN_FUNCTION_TIMEOUT_MS,
        },
      )
    if (error) {
      throw new Error(
        await getFunctionErrorMessage(
          error,
          'Display status could not be loaded.',
        ),
      )
    }
    if (!data?.ok) {
      throw new Error(data?.message ?? 'Display status could not be loaded.')
    }
    return {
      runtimeEnabled: data.runtimeEnabled === true,
      serverTime: data.serverTime ?? null,
      session: data.session ?? null,
    }
  },

  async updateDisplayState(
    request: UpdateDisplayStateRequest,
  ): Promise<AdminDisplayState> {
    const { data, error } =
      await invokeEdgeFunction<UpdateDisplayStateResponse>(
        'update-display-state',
        {
          body: request,
          timeout: ADMIN_FUNCTION_TIMEOUT_MS,
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
    const data = await invokeManageLectures(request)
    return data.lectures
  },

  async createLecture(
    request: CreateLectureRequest,
  ): Promise<AdminLectureCreationResult> {
    const data = await invokeManageLectures({ action: 'create', ...request })
    if (!data.createdLectureSessionId) {
      throw new Error('作成した講義を確認できませんでした。')
    }
    return {
      idempotentReplay: data.idempotentReplay === true,
      lectureSessionId: data.createdLectureSessionId,
      lectures: data.lectures,
    }
  },

  async duplicateLecture(
    request: DuplicateLectureRequest,
  ): Promise<AdminLectureCreationResult> {
    const data = await invokeManageLectures({ action: 'duplicate', ...request })
    if (!data.createdLectureSessionId) {
      throw new Error('複製した講義を確認できませんでした。')
    }
    return {
      idempotentReplay: data.idempotentReplay === true,
      lectureSessionId: data.createdLectureSessionId,
      lectures: data.lectures,
    }
  },

  async createJournalClubRun(request: {
    adminToken: AdminOperationCredentialInput
    clientRequestId: string
    runKind: 'production' | 'rehearsal'
  }) {
    const { data, error } = await invokeEdgeFunction<ManageLecturesResponse>(
      'manage-lectures',
      {
        body: { action: 'createJournalClubRun', ...request },
        timeout: ADMIN_FUNCTION_TIMEOUT_MS,
      },
    )
    if (error) {
      throw new Error(
        await getFunctionErrorMessage(
          error,
          'Journal Clubの準備に失敗しました。',
        ),
      )
    }
    if (!data?.ok || !data.lectures || !data.createdLectureSessionId) {
      throw new Error(data?.message ?? 'Journal Clubの準備に失敗しました。')
    }
    return {
      idempotentReplay: data.idempotentReplay === true,
      lectureSessionId: data.createdLectureSessionId,
      lectures: data.lectures,
    }
  },

  async manageAiControl(request: ManageAiControlRequest) {
    const { data, error } = await invokeEdgeFunction<ManageAiControlResponse>(
      'manage-ai-control',
      { body: request, timeout: ADMIN_FUNCTION_TIMEOUT_MS },
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

  ...adminContentAiRepository,

  async createRealtimeCaptionCall(request: {
    adminToken: AdminOperationCredentialInput
    delay: 'minimal' | 'low' | 'medium' | 'high' | 'xhigh'
    grantRequestId: string
    language: RealtimeCaptionLanguage
    lectureSessionId: string
    maxAudioSeconds: number
    sdpOffer: string
    startRequestId: string
  }): Promise<RealtimeCaptionCall> {
    let response = await invokeEdgeFunction<RealtimeCaptionCallResponse>(
      'issue-realtime-client-secret',
      { body: request, timeout: REALTIME_START_TIMEOUT_MS },
    )
    if (response.error && (await providerAttemptIsAmbiguous(response.error))) {
      response = await invokeEdgeFunction<RealtimeCaptionCallResponse>(
        'issue-realtime-client-secret',
        { body: request, timeout: REALTIME_START_TIMEOUT_MS },
      )
    }
    const { data, error } = response
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
    adminToken: AdminOperationCredentialInput
    language: RealtimeCaptionLanguage | 'mixed' | 'und'
    lastItemId: string
    lectureSessionId: string
    operationId: string
    requestId?: string
    sequence: number
    startRequestId?: string
    text: string
  }): Promise<PublishCaptionResult> {
    const { data, error } = await invokeEdgeFunction<PublishCaptionResponse>(
      'publish-caption-window',
      { body: request, timeout: ADMIN_FUNCTION_TIMEOUT_MS },
    )
    if (error) {
      throw new Error(
        await getFunctionErrorMessage(error, 'Caption publishing failed.'),
      )
    }
    const ignored = data?.status === 'ignored' && data.shouldStop !== true
    if (!data?.ok && !ignored) {
      throw new Error(data?.message ?? 'Caption publishing failed.')
    }
    return {
      accepted: data.ok === true,
      idempotentReplay: data.idempotentReplay === true,
      metadata: data.metadata ?? {},
      result: data.result,
      shouldStop: data.shouldStop === true,
      status: data.status ?? (data.ok ? 'published' : null),
    }
  },

  async managePdfDocuments(
    request: ManagePdfDocumentsRequest,
  ): Promise<AdminPdfDocument[]> {
    const { data, error } =
      await invokeEdgeFunction<ManagePdfDocumentsResponse>(
        'manage-pdf-documents',
        { body: request, timeout: ADMIN_FUNCTION_TIMEOUT_MS },
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

  async generateLectureSummary(request: {
    adminToken: AdminOperationCredentialInput
    grantRequestId?: string
    lectureSessionId: string
    pdfContext: {
      documentId: string
      documentVersion: string
      pages: Array<{ excerptId: string; pageNumber: number; text: string }>
    } | null
    preflightRequestId?: string
    runToken: string
    startRequestId?: string
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
    let response = await invokeEdgeFunction<SummaryFunctionResponse>(
      'generate-lecture-summary',
      { body: request, timeout: AI_FUNCTION_TIMEOUT_MS },
    )
    if (response.error) {
      response = await invokeEdgeFunction<SummaryFunctionResponse>(
        'generate-lecture-summary',
        { body: request, timeout: AI_FUNCTION_TIMEOUT_MS },
      )
    }
    const { data, error } = response
    if (error) {
      throw new Error(
        await getFunctionErrorMessage(error, '講義要約の生成に失敗しました。'),
      )
    }
    if (!data?.ok) {
      throw new Error(data?.message ?? '講義要約の生成に失敗しました。')
    }
    if (data.refreshRequired) {
      // A terminal receipt acknowledges the same attempt; never regenerate it.
      const refreshed = await invokeEdgeFunction<SummaryFunctionResponse>(
        'manage-lecture-summaries',
        {
          body: {
            action: 'status',
            adminToken: request.adminToken,
            lectureSessionId: request.lectureSessionId,
          },
          timeout: ADMIN_FUNCTION_TIMEOUT_MS,
        },
      )
      if (refreshed.error || !refreshed.data?.ok || !refreshed.data.results) {
        throw new Error(
          '作成済みの要約を確認できませんでした。同じ処理の結果を再確認します。',
        )
      }
      return toAdminRecoveredSummaryResponse(
        data,
        refreshed.data.results,
        request,
      )
    }
    if (!data.results) {
      throw new Error(
        '要約の結果を受信できませんでした。同じ処理の結果を再確認します。',
      )
    }
    return {
      actualMicrousd: Number(data.actualMicrousd ?? 0),
      published: Boolean(data.published),
      results: toAdminSummaryResults(data.results),
      skipped: Boolean(data.skipped),
    }
  },

  async managePolls(request: ManagePollsRequest): Promise<AdminPollList> {
    const { data, error } = await invokeEdgeFunction<ManagePollsResponse>(
      'manage-polls',
      {
        body: request,
        timeout: ADMIN_FUNCTION_TIMEOUT_MS,
      },
    )

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
    adminToken: AdminOperationCredentialInput
    commentId: string
    lectureSessionId: string
  }) {
    const { data, error } = await invokeEdgeFunction<ManageCommentsResponse>(
      'manage-comments',
      { body: request, timeout: ADMIN_FUNCTION_TIMEOUT_MS },
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
