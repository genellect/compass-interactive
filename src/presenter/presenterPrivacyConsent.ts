export const PRESENTER_PRIVACY_CONSENT_STORAGE_KEY =
  'compass-presenter-privacy-consent-v1'
export const PRESENTER_PRIVACY_POLICY_VERSION = '2026-09-06'

export type PresenterPrivacyConsent = {
  acceptedAt: string
  policyVersion: string
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

export function readPresenterPrivacyConsent(): PresenterPrivacyConsent | null {
  try {
    const value: unknown = JSON.parse(
      localStorage.getItem(PRESENTER_PRIVACY_CONSENT_STORAGE_KEY) ?? 'null',
    )
    if (
      !isRecord(value) ||
      Object.keys(value).length !== 2 ||
      value.policyVersion !== PRESENTER_PRIVACY_POLICY_VERSION ||
      !isIsoTimestamp(value.acceptedAt)
    ) {
      return null
    }
    return {
      acceptedAt: value.acceptedAt,
      policyVersion: value.policyVersion,
    }
  } catch {
    return null
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

export function clearPresenterPrivacyConsent(): void {
  try {
    localStorage.removeItem(PRESENTER_PRIVACY_CONSENT_STORAGE_KEY)
  } catch {
    /* The browser may block storage, so consent remains fail-closed. */
  }
}
