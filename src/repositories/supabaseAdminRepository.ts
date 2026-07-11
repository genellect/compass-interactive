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
  updated_at: string
}

export type AdminDisplayState = {
  currentPdfPage: number
  displayMode: DisplayMode
  lectureSessionId: string
  pdfDocumentId: string | null
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
  createdAt: string
  endsAt: string | null
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
