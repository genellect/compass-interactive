import { supabase } from '../lib/supabaseClient'

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
  updated_at: string
}

export type AdminDisplayState = {
  currentPdfPage: number
  displayMode: DisplayMode
  lectureSessionId: string
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

function toAdminDisplayState(row: DisplayStateRow): AdminDisplayState {
  return {
    currentPdfPage: row.current_pdf_page,
    displayMode: row.display_mode,
    lectureSessionId: row.lecture_session_id,
    updatedAt: row.updated_at,
  }
}

async function getFunctionErrorMessage(error: unknown, fallbackMessage: string) {
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

    const { data, error } = await supabase.functions.invoke<VerifyAdminPinResponse>(
      'verify-admin-pin',
      {
        body: { pin: trimmedPin },
      },
    )

    if (error) {
      throw new Error(await getFunctionErrorMessage(error, 'Admin PIN check failed.'))
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
}
