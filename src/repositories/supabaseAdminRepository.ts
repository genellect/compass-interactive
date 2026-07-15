import { supabase } from '../lib/supabaseClient'
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
