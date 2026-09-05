// This is a material-choice preference, never an authentication credential.
// Only a digest of the owner/environment and exact PDF/deck binding is retained.
const STORAGE_KEY = 'compass-presenter-material-consent-v1'
const MAX_BINDINGS = 32
const DIGEST_PATTERN = /^[a-f0-9]{64}$/
const MANUAL_MODE_KEY = 'compass-presenter-manual-mode-v1'

async function digestValue(value: unknown): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(JSON.stringify(value)),
  )
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('')
}

export function getPresenterManualModeKey(
  scope: string,
  lectureSessionId: string,
): Promise<string> {
  return digestValue(['presenter-manual-mode-v1', scope, lectureSessionId])
}

export function hasPresenterManualMode(key: string): boolean {
  try {
    return localStorage.getItem(MANUAL_MODE_KEY) === key
  } catch {
    return false
  }
}

export function setPresenterManualMode(key: string, manual: boolean): void {
  if (!DIGEST_PATTERN.test(key)) return
  try {
    if (manual) localStorage.setItem(MANUAL_MODE_KEY, key)
    else if (hasPresenterManualMode(key))
      localStorage.removeItem(MANUAL_MODE_KEY)
  } catch {
    /* Manual mode remains in this mounted workspace. */
  }
}

export async function getPresenterMaterialConsentKey(input: {
  scope: string
  pdfDocumentVersion: string
  pdfPageCount: number
  deckBindingDigest: string
}): Promise<string> {
  return digestValue([
    'presenter-material-consent-v1',
    input.scope,
    input.pdfDocumentVersion,
    input.pdfPageCount,
    input.deckBindingDigest,
  ])
}

function readBindings(): string[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]')
    return Array.isArray(value)
      ? value
          .filter(
            (item): item is string =>
              typeof item === 'string' && DIGEST_PATTERN.test(item),
          )
          .slice(-MAX_BINDINGS)
      : []
  } catch {
    return []
  }
}

export function hasPresenterMaterialConsent(key: string): boolean {
  return DIGEST_PATTERN.test(key) && readBindings().includes(key)
}

export function rememberPresenterMaterialConsent(key: string): void {
  if (!DIGEST_PATTERN.test(key)) return
  try {
    const bindings = readBindings().filter((item) => item !== key)
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify([...bindings, key].slice(-MAX_BINDINGS)),
    )
  } catch {
    // Storage restrictions only require another material check next time.
  }
}

export function clearPresenterMaterialPreferences(): boolean {
  let removalSucceeded = true
  for (const [key, emptyValue] of [
    [STORAGE_KEY, '[]'],
    [MANUAL_MODE_KEY, ''],
  ] as const) {
    try {
      localStorage.removeItem(key)
    } catch {
      removalSucceeded = false
    }
    try {
      if (localStorage.getItem(key) !== null) {
        removalSucceeded = false
        localStorage.setItem(key, emptyValue)
      }
    } catch {
      removalSucceeded = false
    }
  }
  try {
    return (
      removalSucceeded &&
      localStorage.getItem(STORAGE_KEY) === null &&
      localStorage.getItem(MANUAL_MODE_KEY) === null
    )
  } catch {
    /* No Presenter preference is required for a safe manual workflow. */
    return false
  }
}
