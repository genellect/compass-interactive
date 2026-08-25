import { useEffect, useState } from 'react'
import type { AdminOperationCredentialInput } from '../../lib/adminAuth/adminOperationCredential'
import {
  supabaseAdminRepository,
  type AdminDisplaySessionStatus,
} from '../../repositories/supabaseAdminRepository'

const STATUS_POLL_MS = 10_000
const STATUS_STALE_AFTER_MS = 25_000

export function useAdminDisplayStatus(input: {
  active: boolean
  adminToken: AdminOperationCredentialInput
  displayStateUpdatedAt?: string
  lectureSessionId: string | null
}) {
  const [session, setSession] = useState<AdminDisplaySessionStatus | null>(null)

  useEffect(() => {
    setSession(null)
    if (!input.active || !input.lectureSessionId) return
    let disposed = false
    let inFlight = false
    let refreshQueued = false
    let timer: number | null = null
    let lastSuccessfulPollAt = 0

    const schedule = () => {
      if (disposed) return
      if (timer !== null) window.clearTimeout(timer)
      timer = window.setTimeout(() => void refresh(), STATUS_POLL_MS)
    }
    const refresh = async () => {
      if (disposed || !input.lectureSessionId) return
      if (inFlight) {
        refreshQueued = true
        return
      }
      inFlight = true
      if (timer !== null) window.clearTimeout(timer)
      timer = null
      try {
        const status = await supabaseAdminRepository.getDisplaySessionStatus({
          adminToken: input.adminToken,
          lectureSessionId: input.lectureSessionId,
        })
        lastSuccessfulPollAt = Date.now()
        if (!disposed) setSession(status.session)
      } catch {
        // Delivery status is advisory. Slide control remains available and the
        // next modest-cadence poll reconciles transient status failures. Never
        // leave a cached healthy badge visible beyond the heartbeat window.
        if (
          !disposed &&
          lastSuccessfulPollAt > 0 &&
          Date.now() - lastSuccessfulPollAt >= STATUS_STALE_AFTER_MS
        ) {
          setSession((current) =>
            current?.state === 'connected' || current?.state === 'synced'
              ? { ...current, state: 'reconnecting' }
              : current,
          )
        }
      } finally {
        inFlight = false
        if (refreshQueued) {
          refreshQueued = false
          void refresh()
        } else {
          schedule()
        }
      }
    }
    const refreshWhenVisible = () => {
      if (document.visibilityState === 'visible') {
        if (timer !== null) window.clearTimeout(timer)
        timer = null
        void refresh()
      }
    }

    void refresh()
    window.addEventListener('focus', refreshWhenVisible)
    document.addEventListener('visibilitychange', refreshWhenVisible)
    return () => {
      disposed = true
      if (timer !== null) window.clearTimeout(timer)
      window.removeEventListener('focus', refreshWhenVisible)
      document.removeEventListener('visibilitychange', refreshWhenVisible)
    }
  }, [
    input.active,
    input.adminToken,
    input.displayStateUpdatedAt,
    input.lectureSessionId,
  ])

  const label =
    session?.state === 'synced'
      ? '表示同期済み'
      : session?.state === 'connected'
        ? 'Realtime接続済み'
        : session?.state === 'reconnecting'
          ? '再接続中'
          : session?.state === 'ended'
            ? '終了'
            : '接続待ち'

  return { label, session }
}
