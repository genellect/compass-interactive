export const PRESENTER_PRIVACY_CONSENT_STORAGE_KEY =
  'compass-presenter-privacy-consent-v1'
export const PRESENTER_PRIVACY_POLICY_VERSION = '2026-09-06'
export const PRESENTER_PRIVACY_CONSENT_MAX_AGE_MS = 365 * 24 * 60 * 60 * 1_000
const PRESENTER_PRIVACY_WITHDRAWAL_SESSION_KEY =
  'compass-presenter-privacy-withdrawal-v1'
const PRESENTER_PRIVACY_WITHDRAWAL_COOKIE =
  'compass-presenter-privacy-withdrawal-v1'
const PRESENTER_PRIVACY_WITHDRAWAL_COOKIE_MAX_AGE =
  PRESENTER_PRIVACY_CONSENT_MAX_AGE_MS / 1_000

export type PresenterPrivacyConsent = {
  acceptedAt: string
  policyVersion: string
}

type PresenterPrivacyWithdrawalTombstone = {
  markedAt: string
  status: 'withdrawn'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isIsoTimestamp(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length >= 20 &&
    value.length <= 40 &&
    /(?:Z|[+-][0-9]{2}:[0-9]{2})$/.test(value) &&
    !Number.isNaN(Date.parse(value))
  )
}

function isCurrentRetentionTimestamp(value: unknown): value is string {
  if (!isIsoTimestamp(value)) return false
  const timestamp = Date.parse(value)
  const now = Date.now()
  return (
    timestamp <= now && timestamp >= now - PRESENTER_PRIVACY_CONSENT_MAX_AGE_MS
  )
}

function isWithdrawalTombstoneShape(
  value: unknown,
): value is PresenterPrivacyWithdrawalTombstone {
  return (
    isRecord(value) &&
    Object.keys(value).length === 2 &&
    value.status === 'withdrawn' &&
    isIsoTimestamp(value.markedAt)
  )
}

function removeStoredValue(
  storageName: 'localStorage' | 'sessionStorage',
  key: string,
): void {
  try {
    window[storageName].removeItem(key)
  } catch {
    /* Expired or invalid local metadata is ignored even if removal is blocked. */
  }
}

function readWithdrawalTombstone(
  storageName: 'localStorage' | 'sessionStorage',
  key: string,
): boolean {
  let raw: string | null
  try {
    raw = window[storageName].getItem(key)
  } catch {
    return false
  }
  if (raw === null) return false

  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    removeStoredValue(storageName, key)
    return false
  }
  if (!isWithdrawalTombstoneShape(value)) {
    const mayBePrivacyConsent =
      key === PRESENTER_PRIVACY_CONSENT_STORAGE_KEY &&
      isRecord(value) &&
      ('acceptedAt' in value || 'policyVersion' in value)
    if (!mayBePrivacyConsent) removeStoredValue(storageName, key)
    return false
  }
  if (isCurrentRetentionTimestamp(value.markedAt)) return true
  removeStoredValue(storageName, key)
  return false
}

function invalidateStoredPresenterPrivacyConsent(): void {
  try {
    localStorage.removeItem(PRESENTER_PRIVACY_CONSENT_STORAGE_KEY)
    if (localStorage.getItem(PRESENTER_PRIVACY_CONSENT_STORAGE_KEY) === null)
      return
  } catch {
    /* Fall through and replace the unusable decision with a safe tombstone. */
  }
  markPresenterPrivacyWithdrawalTombstone()
}

export function readPresenterPrivacyConsent(): PresenterPrivacyConsent | null {
  let raw: string | null
  try {
    raw = localStorage.getItem(PRESENTER_PRIVACY_CONSENT_STORAGE_KEY)
  } catch {
    return null
  }
  if (raw === null) return null

  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    invalidateStoredPresenterPrivacyConsent()
    return null
  }
  if (isWithdrawalTombstoneShape(value)) {
    if (!isCurrentRetentionTimestamp(value.markedAt)) {
      removeStoredValue('localStorage', PRESENTER_PRIVACY_CONSENT_STORAGE_KEY)
    }
    return null
  }
  if (
    !isRecord(value) ||
    Object.keys(value).length !== 2 ||
    value.policyVersion !== PRESENTER_PRIVACY_POLICY_VERSION ||
    !isCurrentRetentionTimestamp(value.acceptedAt)
  ) {
    invalidateStoredPresenterPrivacyConsent()
    return null
  }
  return {
    acceptedAt: value.acceptedAt,
    policyVersion: value.policyVersion,
  }
}

export function hasPresenterPrivacyWithdrawalTombstone(): boolean {
  if (
    readWithdrawalTombstone(
      'sessionStorage',
      PRESENTER_PRIVACY_WITHDRAWAL_SESSION_KEY,
    )
  )
    return true
  try {
    if (
      document.cookie
        .split(';')
        .some(
          (entry) =>
            entry.trim() === `${PRESENTER_PRIVACY_WITHDRAWAL_COOKIE}=required`,
        )
    )
      return true
  } catch {
    /* The local or session tombstone may still be available. */
  }
  return readWithdrawalTombstone(
    'localStorage',
    PRESENTER_PRIVACY_CONSENT_STORAGE_KEY,
  )
}

export function markPresenterPrivacyWithdrawalTombstone(): void {
  const tombstone = JSON.stringify({
    markedAt: new Date().toISOString(),
    status: 'withdrawn',
  } satisfies PresenterPrivacyWithdrawalTombstone)
  try {
    localStorage.setItem(PRESENTER_PRIVACY_CONSENT_STORAGE_KEY, tombstone)
  } catch {
    /* The session marker still prevents a same-tab reload from reconnecting. */
  }
  try {
    document.cookie =
      `${PRESENTER_PRIVACY_WITHDRAWAL_COOKIE}=required; ` +
      `Max-Age=${PRESENTER_PRIVACY_WITHDRAWAL_COOKIE_MAX_AGE}; ` +
      `Path=/; SameSite=Strict${location.protocol === 'https:' ? '; Secure' : ''}`
  } catch {
    /* The local or session tombstone may still prevent reconnection. */
  }
  try {
    sessionStorage.setItem(PRESENTER_PRIVACY_WITHDRAWAL_SESSION_KEY, tombstone)
  } catch {
    /* The mounted hook remains fail-closed when browser storage is blocked. */
  }
}

export function rememberPresenterPrivacyConsent(): PresenterPrivacyConsent | null {
  const consent: PresenterPrivacyConsent = {
    acceptedAt: new Date().toISOString(),
    policyVersion: PRESENTER_PRIVACY_POLICY_VERSION,
  }
  try {
    localStorage.setItem(
      PRESENTER_PRIVACY_CONSENT_STORAGE_KEY,
      JSON.stringify(consent),
    )
    return readPresenterPrivacyConsent()
  } catch {
    return null
  }
}

export function clearPresenterPrivacyConsent(): boolean {
  try {
    localStorage.removeItem(PRESENTER_PRIVACY_CONSENT_STORAGE_KEY)
    if (localStorage.getItem(PRESENTER_PRIVACY_CONSENT_STORAGE_KEY) === null) {
      try {
        sessionStorage.removeItem(PRESENTER_PRIVACY_WITHDRAWAL_SESSION_KEY)
      } catch {
        /* A stale session marker safely requires site-data cleanup. */
      }
      try {
        document.cookie =
          `${PRESENTER_PRIVACY_WITHDRAWAL_COOKIE}=; Max-Age=0; ` +
          `Path=/; SameSite=Strict${location.protocol === 'https:' ? '; Secure' : ''}`
      } catch {
        /* A stale cookie marker safely requires site-data cleanup. */
      }
      return !hasPresenterPrivacyWithdrawalTombstone()
    }
  } catch {
    /* Fall through and invalidate a consent value that could not be removed. */
  }

  markPresenterPrivacyWithdrawalTombstone()
  return false
}
