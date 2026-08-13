import { useRef } from 'react'
import { type AdminOperationCredential } from '../../lib/adminAuth/adminOperationCredential'
import { supabaseAdminRepository } from '../../repositories/supabaseAdminRepository'

const INVALID_ADMIN_SESSION_MESSAGES = [
  'Invalid Admin session.',
  'Admin application session could not be verified.',
  'Admin session is no longer available.',
  'Admin identity could not be verified.',
  'AAL2 authentication is required.',
  'Authenticator verification is required.',
]

export function useGoogleAdminWorkspaceSession({
  activeLectureSessionId,
  adminCredential,
  clearLocalWorkspace,
  onAdminLogout,
}: {
  activeLectureSessionId: string | null
  adminCredential: AdminOperationCredential
  clearLocalWorkspace: () => void
  onAdminLogout: () => Promise<void>
}) {
  const logoutInFlightRef = useRef(false)

  function expireAdminSession() {
    clearLocalWorkspace()
    if (logoutInFlightRef.current) return

    logoutInFlightRef.current = true
    void onAdminLogout()
      .catch(() => undefined)
      .finally(() => {
        logoutInFlightRef.current = false
      })
  }

  function handleInvalidAdminSession(error: unknown) {
    if (!(error instanceof Error)) return false
    if (
      !INVALID_ADMIN_SESSION_MESSAGES.some((message) =>
        error.message.includes(message),
      )
    ) {
      return false
    }
    expireAdminSession()
    return true
  }

  async function handleLogout() {
    if (activeLectureSessionId) {
      try {
        await supabaseAdminRepository.manageAiControl({
          action: 'stop',
          adminToken: adminCredential,
          lectureSessionId: activeLectureSessionId,
          reason: 'admin_logout',
        })
      } catch {
        // Session revocation and the durable provider sweep remain the
        // authoritative fail-safe if the best-effort lecture stop is lost.
      }
    }
    clearLocalWorkspace()
    await onAdminLogout()
  }

  return {
    expireAdminSession,
    handleInvalidAdminSession,
    handleLogout,
  }
}
