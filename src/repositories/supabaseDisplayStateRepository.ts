import { supabase } from '../lib/supabaseClient'

export type DisplayMode = 'normal' | 'presentation' | 'slideOnly'

export type DisplayState = {
  lectureSessionId: string
  pdfDocumentId: string | null
  currentPdfPage: number
  displayMode: DisplayMode
  updatedAt: string
}

type DisplayStateRow = {
  lecture_session_id: string
  current_pdf_page: number
  display_mode: DisplayMode
  updated_at: string
}

function toDisplayState(row: DisplayStateRow): DisplayState {
  return {
    lectureSessionId: row.lecture_session_id,
    // This repository is retained only for compatibility with the pre-M2 table.
    // PDF identity is authoritative in lecture_live_state and its snapshot RPC.
    pdfDocumentId: null,
    currentPdfPage: row.current_pdf_page,
    displayMode: row.display_mode,
    updatedAt: row.updated_at,
  }
}

export function createDefaultDisplayState(
  lectureSessionId: string,
): DisplayState {
  return {
    lectureSessionId,
    pdfDocumentId: null,
    currentPdfPage: 1,
    displayMode: 'normal',
    updatedAt: new Date().toISOString(),
  }
}

export const supabaseDisplayStateRepository = {
  async getDisplayState(lectureSessionId: string): Promise<DisplayState> {
    const { data, error } = await supabase
      .from('lecture_display_state')
      .select(
        'lecture_session_id,current_pdf_page,display_mode,updated_at',
      )
      .eq('lecture_session_id', lectureSessionId)
      .maybeSingle<DisplayStateRow>()

    if (error) {
      throw new Error(error.message)
    }

    return data ? toDisplayState(data) : createDefaultDisplayState(lectureSessionId)
  },

}
