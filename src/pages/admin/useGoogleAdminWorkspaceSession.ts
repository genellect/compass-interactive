import { useRef } from 'react'
import {
  type AdminOperationCredential,
  type AdminOperationCredentialInput,
} from '../../lib/adminAuth/adminOperationCredential'
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
  adminToken,
  clearLocalWorkspace,
  onAdminLogout,
  securityEnabled,
  setAuthError,
}: {
  activeLectureSessionId: string | null
  adminCredential?: AdminOperationCredential
  adminToken: AdminOperationCredentialInput | ''
  clearLocalWorkspace: () => void
  onAdminLogout?: () => Promise<void>
  securityEnabled: boolean
  setAuthError: (message: string) => void
}) {
  const logoutInFlightRef = useRef(false)

  function expireAdminSession() {
    clearLocalWorkspace()
    setAuthError('管理者認証の有効期限が切れました。再度ログインしてください。')
    if (!adminCredential || !onAdminLogout || logoutInFlightRef.current) return

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
    if (adminCredential && onAdminLogout) {
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
      return
    }

    try {
      if (securityEnabled && adminToken) {
        await supabaseAdminRepository.manageAdminSessions({
          action: 'logout',
          adminToken,
        })
      }
    } catch {
      // Local logout is fail-safe even when the revoke request times out.
    } finally {
      clearLocalWorkspace()
    }
  }

  return {
    expireAdminSession,
    handleInvalidAdminSession,
    handleLogout,
  }
}
