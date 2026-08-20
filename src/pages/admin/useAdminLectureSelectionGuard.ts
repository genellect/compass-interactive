import { useEffect, useRef } from 'react'
import type { AdminLecture } from '../../repositories/supabaseAdminRepository'

export function useAdminLectureSelectionGuard(input: {
  activeLecture: AdminLecture | null | undefined
  clearSelection: () => void
  lecturesLoaded: boolean
  requestedLectureSessionId: string | null
}) {
  const pendingSelectionIdRef = useRef<string | null>(null)

  useEffect(() => {
    if (
      input.activeLecture &&
      pendingSelectionIdRef.current === input.activeLecture.id
    ) {
      pendingSelectionIdRef.current = null
    }
    if (
      input.lecturesLoaded &&
      input.requestedLectureSessionId &&
      pendingSelectionIdRef.current !== input.requestedLectureSessionId &&
      (!input.activeLecture || input.activeLecture.status === 'closed')
    ) {
      input.clearSelection()
    }
  }, [
    input.activeLecture,
    input.clearSelection,
    input.lecturesLoaded,
    input.requestedLectureSessionId,
  ])

  return {
    clearPendingSelection() {
      pendingSelectionIdRef.current = null
    },
    markPendingSelection(lectureSessionId: string) {
      pendingSelectionIdRef.current = lectureSessionId
    },
  }
}
