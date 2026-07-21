import { useCallback, useEffect, useRef, useState } from 'react'
import { archiveClient } from '../../archive/archiveClient'
import {
  clearLectureArchiveResumeCode,
  restoreLectureArchiveResumeCode,
} from '../../archive/archiveSessionStorage'
import {
  isPhase66UxIntegrationEnabled,
  isPhase68SecurityEnabled,
} from '../../lib/featureFlags'
import { restoreLectureResumeTokenByCode } from '../../lib/lectureResumeStorage'
import { getLectureJoinCaptchaToken } from '../../lib/turnstile'
import type { LectureArchiveSession } from '../../types/archive'

export function useArchiveResume(normalizedPathname: string) {
  const [archiveSession, setArchiveSession] =
    useState<LectureArchiveSession | null>(null)
  const [isArchiveResumePending, setIsArchiveResumePending] = useState(false)
  const [archiveResumeError, setArchiveResumeError] = useState<string | null>(
    null,
  )
  const [archiveResumeNonce, setArchiveResumeNonce] = useState(0)
  const attemptedCodeRef = useRef<string | null>(null)

  useEffect(() => {
    if (
      normalizedPathname !== '/lecture/archive' ||
      archiveSession ||
      !isPhase66UxIntegrationEnabled ||
      !archiveClient.isConfigured()
    ) {
      if (normalizedPathname !== '/lecture/archive') {
        setIsArchiveResumePending(false)
        setArchiveResumeError(null)
      }
      return
    }
    const lectureCode = restoreLectureArchiveResumeCode()
    if (!lectureCode || attemptedCodeRef.current === lectureCode) return

    attemptedCodeRef.current = lectureCode
    setIsArchiveResumePending(true)
    setArchiveResumeError(null)
    let active = true
    void (async () => {
      const storedResume = isPhase68SecurityEnabled
        ? restoreLectureResumeTokenByCode(lectureCode)
        : null
      if (storedResume) {
        const resumed = await archiveClient
          .resumeLecture(storedResume.token, lectureCode)
          .catch(() => null)
        if (resumed) return resumed
      }
      const turnstileToken = await getLectureJoinCaptchaToken()
      return archiveClient.resolveLectureCode(lectureCode, turnstileToken)
    })()
      .then((archive) => {
        if (!active) return
        if (!archive) {
          clearLectureArchiveResumeCode()
          setIsArchiveResumePending(false)
          setArchiveResumeError(
            '講義記録が見つかりませんでした。参加画面から講義コードを確認してください。',
          )
          return
        }
        setArchiveSession(archive)
        setIsArchiveResumePending(false)
        setArchiveResumeError(null)
      })
      .catch(() => {
        if (!active) return
        attemptedCodeRef.current = null
        setIsArchiveResumePending(false)
        setArchiveResumeError(
          '講義記録を読み込めませんでした。通信を確認して、もう一度お試しください。',
        )
      })
    return () => {
      active = false
      if (attemptedCodeRef.current === lectureCode) {
        attemptedCodeRef.current = null
      }
    }
  }, [archiveResumeNonce, archiveSession, normalizedPathname])

  const retryArchiveResume = useCallback(() => {
    attemptedCodeRef.current = null
    setArchiveResumeError(null)
    setArchiveResumeNonce((current) => current + 1)
  }, [])

  const acceptArchiveSession = useCallback((archive: LectureArchiveSession) => {
    setArchiveSession(archive)
    setIsArchiveResumePending(false)
    setArchiveResumeError(null)
  }, [])

  const clearArchiveResume = useCallback(() => {
    clearLectureArchiveResumeCode()
    attemptedCodeRef.current = null
    setArchiveSession(null)
    setIsArchiveResumePending(false)
    setArchiveResumeError(null)
  }, [])

  return {
    acceptArchiveSession,
    archiveResumeError,
    archiveSession,
    clearArchiveResume,
    isArchiveResumePending,
    retryArchiveResume,
  }
}
