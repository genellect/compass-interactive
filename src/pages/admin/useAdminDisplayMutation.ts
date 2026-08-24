import { useCallback, useEffect, useRef, useState } from 'react'
import type { AdminOperationCredentialInput } from '../../lib/adminAuth/adminOperationCredential'
import type { DisplayState } from '../../repositories/supabaseDisplayStateRepository'
import { supabaseAdminRepository } from '../../repositories/supabaseAdminRepository'
import { ADMIN_SESSION_EXPIRED_MESSAGE } from './adminMessages'

type DisplayMutationAction = 'next' | 'previous' | 'goToPage' | 'setDocument'

type PendingDisplayMutation = {
  desiredPage: number | null
  pageDelta: number
  lectureSessionId: string
}

export function useAdminDisplayMutation(input: {
  activeLectureSessionId: string | null
  adminToken: AdminOperationCredentialInput
  handleInvalidAdminSession: (error: unknown) => unknown
  setDisplayState: (state: DisplayState) => void
  setDisplayStateError: (message: string | null) => void
  setPdfDocumentInput: (documentId: string) => void
}) {
  const [isSending, setIsSending] = useState(false)
  const inFlightRef = useRef(false)
  const pendingRef = useRef<PendingDisplayMutation | null>(null)
  const activeLectureSessionIdRef = useRef(input.activeLectureSessionId)

  useEffect(() => {
    activeLectureSessionIdRef.current = input.activeLectureSessionId
    pendingRef.current = null
  }, [input.activeLectureSessionId])

  const updateDisplayState = useCallback(
    async function run(
      action: DisplayMutationAction,
      options: {
        currentPdfPage?: number
        pdfDocumentId?: string | null
      } = {},
      targetLectureSessionId = input.activeLectureSessionId,
    ) {
      if (!targetLectureSessionId) {
        input.setDisplayStateError('先に講義へ参加してください。')
        return false
      }
      if (!input.adminToken) {
        input.setDisplayStateError(ADMIN_SESSION_EXPIRED_MESSAGE)
        return false
      }
      if (inFlightRef.current) {
        if (action !== 'setDocument') {
          const pending =
            pendingRef.current?.lectureSessionId === targetLectureSessionId
              ? pendingRef.current
              : {
                  desiredPage: null,
                  pageDelta: 0,
                  lectureSessionId: targetLectureSessionId,
                }
          if (action === 'goToPage') {
            pending.desiredPage = options.currentPdfPage ?? 1
            pending.pageDelta = 0
          } else {
            const delta = action === 'next' ? 1 : -1
            if (pending.desiredPage !== null) pending.desiredPage += delta
            else pending.pageDelta += delta
          }
          pendingRef.current = pending
          return true
        }
        return false
      }

      inFlightRef.current = true
      setIsSending(true)
      input.setDisplayStateError(null)
      let committedState: DisplayState | null = null
      try {
        const common = {
          adminToken: input.adminToken,
          lectureSessionId: targetLectureSessionId,
        }
        const nextState = await supabaseAdminRepository.updateDisplayState(
          action === 'goToPage'
            ? {
                ...common,
                action,
                currentPdfPage: options.currentPdfPage ?? 1,
              }
            : action === 'setDocument'
              ? {
                  ...common,
                  action,
                  pdfDocumentId: options.pdfDocumentId ?? null,
                }
              : { ...common, action },
        )
        if (activeLectureSessionIdRef.current === targetLectureSessionId) {
          committedState = nextState
          input.setDisplayState(nextState)
          input.setPdfDocumentInput(nextState.pdfDocumentId ?? '')
        }
        return true
      } catch (error) {
        if (activeLectureSessionIdRef.current !== targetLectureSessionId) {
          return false
        }
        input.handleInvalidAdminSession(error)
        const message = error instanceof Error ? error.message : ''
        input.setDisplayStateError(
          message === 'Invalid Admin session.'
            ? ADMIN_SESSION_EXPIRED_MESSAGE
            : message.includes('PowerPoint synchronization is active')
              ? 'PowerPoint同期中です。先に手動操作へ切り替えてください。'
              : '表示画面の更新に失敗しました。少し時間をおいて再度お試しください。',
        )
        return false
      } finally {
        inFlightRef.current = false
        const pending = pendingRef.current
        pendingRef.current = null
        if (
          pending &&
          committedState &&
          activeLectureSessionIdRef.current === pending.lectureSessionId
        ) {
          const pageCount =
            committedState.pdfPageCount ?? Number.MAX_SAFE_INTEGER
          const desiredPage = Math.min(
            Math.max(
              pending.desiredPage ??
                committedState.currentPdfPage + pending.pageDelta,
              1,
            ),
            pageCount,
          )
          if (desiredPage !== committedState.currentPdfPage) {
            void run(
              'goToPage',
              { currentPdfPage: desiredPage },
              pending.lectureSessionId,
            )
          } else {
            setIsSending(false)
          }
        } else {
          setIsSending(false)
        }
      }
    },
    [input],
  )

  return { isSending, updateDisplayState }
}
