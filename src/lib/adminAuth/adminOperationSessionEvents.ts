const GOOGLE_ADMIN_SESSION_INVALID_EVENT =
  'compass:google-admin-session-invalid'

const sessionSignals = new Map<string, string>()
const lastNotificationAt = new Map<string, number>()
const MAX_SESSION_SIGNALS = 16

function getSessionSignal(appSessionToken: string) {
  const existing = sessionSignals.get(appSessionToken)
  if (existing) return existing
  const signal = crypto.randomUUID()
  sessionSignals.set(appSessionToken, signal)
  while (sessionSignals.size > MAX_SESSION_SIGNALS) {
    const oldest = sessionSignals.keys().next().value
    if (typeof oldest !== 'string') break
    const removedSignal = sessionSignals.get(oldest)
    sessionSignals.delete(oldest)
    if (removedSignal) lastNotificationAt.delete(removedSignal)
  }
  return signal
}

export function notifyGoogleAdminSessionInvalid(appSessionToken: string) {
  if (typeof window === 'undefined' || !appSessionToken) return
  const signal = getSessionSignal(appSessionToken)
  const now = Date.now()
  if (now - (lastNotificationAt.get(signal) ?? 0) < 1_000) return
  lastNotificationAt.set(signal, now)
  window.dispatchEvent(
    new CustomEvent(GOOGLE_ADMIN_SESSION_INVALID_EVENT, { detail: signal }),
  )
}

export function subscribeGoogleAdminSessionInvalid(
  appSessionToken: string,
  listener: () => void,
) {
  if (typeof window === 'undefined' || !appSessionToken) return () => undefined
  const signal = getSessionSignal(appSessionToken)
  const handleInvalidSession = (event: Event) => {
    if (event instanceof CustomEvent && event.detail === signal) {
      listener()
    }
  }
  window.addEventListener(
    GOOGLE_ADMIN_SESSION_INVALID_EVENT,
    handleInvalidSession,
  )
  return () =>
    window.removeEventListener(
      GOOGLE_ADMIN_SESSION_INVALID_EVENT,
      handleInvalidSession,
    )
}

export function forgetGoogleAdminOperationSession(appSessionToken: string) {
  const signal = sessionSignals.get(appSessionToken)
  sessionSignals.delete(appSessionToken)
  if (signal) lastNotificationAt.delete(signal)
}
