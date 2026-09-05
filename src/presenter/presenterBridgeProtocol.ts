export const PRESENTER_BRIDGE_BASE_URL = 'http://127.0.0.1:43124' as const
export const PRESENTER_BRIDGE_PROTOCOL_VERSION = 1 as const
export const PRESENTER_BRIDGE_HEALTH_TIMEOUT_MS = 1_500 as const
export const PRESENTER_BRIDGE_REQUEST_TIMEOUT_MS = 12_000 as const
export const PRESENTER_BRIDGE_MAX_RESPONSE_BYTES = 65_536 as const
export const PRESENTER_BRIDGE_SESSION_HEADER =
  'X-Compass-Presenter-Session' as const

export const PRESENTER_BRIDGE_ROUTES = {
  connect: '/v1/connect',
  disconnect: '/v1/disconnect',
  health: '/v1/health',
  presentation: '/v1/presentation',
  status: '/v1/status',
} as const

export const PRESENTER_ISSUE_CODES = [
  'pdf_page_count_invalid',
  'page_count_mismatch',
  'slide_id_order_invalid',
  'hidden_slides_unsupported',
  'custom_or_partial_show_unsupported',
  'windowed_slide_show_required',
  'presenter_view_must_be_disabled',
  'current_slide_order_mismatch',
  'powerpoint_not_running',
  'multiple_slide_shows',
  'presentation_changed',
  'presenter_session_stopped',
] as const

export type PresenterIssueCode = (typeof PRESENTER_ISSUE_CODES)[number]

export type PresenterPresentation = {
  bindingDigest: string
  currentSlideIndex: number
  displayName: string
  eligible: boolean
  issues: PresenterIssueCode[]
  slideCount: number
}

export type PresenterBridgeHealthResponse = {
  ok: true
  powerpointReady: boolean
  powerpointIssue: PresenterIssueCode | 'observation_unavailable' | null
  protocolVersion: typeof PRESENTER_BRIDGE_PROTOCOL_VERSION
  service: 'compass-presenter-bridge'
}

export type PresenterBridgeConnectResponse = {
  ok: true
  presentation: PresenterPresentation
  sessionToken: string
  state: 'pending_confirmation'
}

export type PresenterBridgeActivateResponse = {
  ok: true
  presentation: PresenterPresentation
  state: 'active'
}

export type PresenterBridgePresentationResponse = {
  ok: true
  presentation: PresenterPresentation
}

export type PresenterBridgeStatusResponse = {
  lastErrorCode: PresenterIssueCode | null
  ok: true
  presentation: PresenterPresentation | null
  state: 'active' | 'disconnected' | 'faulted' | 'pending_confirmation'
}

export type PresenterBridgeDisconnectResponse = {
  ok: true
  state: 'disconnected'
}

export type PresenterBridgeErrorResponse = {
  code: string
  message: string
  ok: false
}

export type PresenterBridgeConnectRequest = {
  lectureSessionId: string
  pdfDocumentId: string
  pdfDocumentVersion: string
  pdfPageCount: number
  ticket: string
}

export type PresenterBridgeActivateRequest = {
  action: 'activate'
  bindingDigest: string
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const SHA256_PATTERN = /^[0-9a-f]{64}$/
const BASE64URL_43_PATTERN = /^[A-Za-z0-9_-]{43}$/
const PAIRING_TICKET_PATTERN = /^[A-Za-z0-9_-]{16,2048}\.[A-Za-z0-9_-]{43}$/
const DOCUMENT_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/
const SAFE_ERROR_CODE_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/
const issueCodeSet = new Set<string>(PRESENTER_ISSUE_CODES)

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasExactKeys(
  value: Record<string, unknown>,
  expectedKeys: readonly string[],
) {
  const actualKeys = Object.keys(value)
  return (
    actualKeys.length === expectedKeys.length &&
    actualKeys.every((key) => expectedKeys.includes(key))
  )
}

function hasAsciiControl(value: string) {
  return Array.from(value).some((character) => {
    const code = character.charCodeAt(0)
    return code <= 31 || code === 127
  })
}

function isBoundedString(
  value: unknown,
  minimumLength: number,
  maximumLength: number,
): value is string {
  return (
    typeof value === 'string' &&
    value.length >= minimumLength &&
    value.length <= maximumLength &&
    !hasAsciiControl(value)
  )
}

function isPresenterIssueCode(value: unknown): value is PresenterIssueCode {
  return typeof value === 'string' && issueCodeSet.has(value)
}

function isPresenterPresentation(
  value: unknown,
): value is PresenterPresentation {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      'bindingDigest',
      'currentSlideIndex',
      'displayName',
      'eligible',
      'issues',
      'slideCount',
    ]) ||
    typeof value.bindingDigest !== 'string' ||
    !SHA256_PATTERN.test(value.bindingDigest) ||
    !isBoundedString(value.displayName, 1, 255) ||
    value.displayName.trim() !== value.displayName ||
    value.displayName === '.' ||
    value.displayName === '..' ||
    /[\\/]/.test(value.displayName) ||
    !Number.isSafeInteger(value.slideCount) ||
    Number(value.slideCount) < 1 ||
    Number(value.slideCount) > 75 ||
    !Number.isSafeInteger(value.currentSlideIndex) ||
    Number(value.currentSlideIndex) < 1 ||
    Number(value.currentSlideIndex) > Number(value.slideCount) ||
    typeof value.eligible !== 'boolean' ||
    !Array.isArray(value.issues) ||
    value.issues.length > PRESENTER_ISSUE_CODES.length ||
    !value.issues.every(isPresenterIssueCode) ||
    new Set(value.issues).size !== value.issues.length
  ) {
    return false
  }

  return value.eligible === (value.issues.length === 0)
}

export function isPresenterBridgeSessionToken(value: unknown): value is string {
  return typeof value === 'string' && BASE64URL_43_PATTERN.test(value)
}

export function isPresenterPairingTicket(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length <= 4_096 &&
    PAIRING_TICKET_PATTERN.test(value)
  )
}

export function isPresenterBridgeConnectRequest(
  value: unknown,
): value is PresenterBridgeConnectRequest {
  return (
    isRecord(value) &&
    hasExactKeys(value, [
      'lectureSessionId',
      'pdfDocumentId',
      'pdfDocumentVersion',
      'pdfPageCount',
      'ticket',
    ]) &&
    typeof value.lectureSessionId === 'string' &&
    UUID_PATTERN.test(value.lectureSessionId) &&
    typeof value.pdfDocumentId === 'string' &&
    DOCUMENT_ID_PATTERN.test(value.pdfDocumentId) &&
    typeof value.pdfDocumentVersion === 'string' &&
    SHA256_PATTERN.test(value.pdfDocumentVersion) &&
    Number.isSafeInteger(value.pdfPageCount) &&
    Number(value.pdfPageCount) >= 1 &&
    Number(value.pdfPageCount) <= 75 &&
    isPresenterPairingTicket(value.ticket)
  )
}

export function isPresenterBridgeActivateRequest(
  value: unknown,
): value is PresenterBridgeActivateRequest {
  return (
    isRecord(value) &&
    hasExactKeys(value, ['action', 'bindingDigest']) &&
    value.action === 'activate' &&
    typeof value.bindingDigest === 'string' &&
    SHA256_PATTERN.test(value.bindingDigest)
  )
}

export function parsePresenterBridgeHealthResponse(
  value: unknown,
): PresenterBridgeHealthResponse | null {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      'ok',
      'protocolVersion',
      'service',
      'powerpointReady',
      'powerpointIssue',
    ]) ||
    value.ok !== true ||
    value.protocolVersion !== PRESENTER_BRIDGE_PROTOCOL_VERSION ||
    value.service !== 'compass-presenter-bridge' ||
    typeof value.powerpointReady !== 'boolean' ||
    (value.powerpointReady
      ? value.powerpointIssue !== null
      : !(
          isPresenterIssueCode(value.powerpointIssue) ||
          value.powerpointIssue === 'observation_unavailable'
        ))
  ) {
    return null
  }
  return value as PresenterBridgeHealthResponse
}

export function parsePresenterBridgeConnectResponse(
  value: unknown,
): PresenterBridgeConnectResponse | null {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ['ok', 'presentation', 'sessionToken', 'state']) ||
    value.ok !== true ||
    value.state !== 'pending_confirmation' ||
    !isPresenterBridgeSessionToken(value.sessionToken) ||
    !isPresenterPresentation(value.presentation)
  ) {
    return null
  }
  return value as PresenterBridgeConnectResponse
}

export function parsePresenterBridgeActivateResponse(
  value: unknown,
): PresenterBridgeActivateResponse | null {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ['ok', 'presentation', 'state']) ||
    value.ok !== true ||
    value.state !== 'active' ||
    !isPresenterPresentation(value.presentation)
  ) {
    return null
  }
  return value as PresenterBridgeActivateResponse
}

export function parsePresenterBridgePresentationResponse(
  value: unknown,
): PresenterBridgePresentationResponse | null {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ['ok', 'presentation']) ||
    value.ok !== true ||
    !isPresenterPresentation(value.presentation)
  ) {
    return null
  }
  return value as PresenterBridgePresentationResponse
}

export function parsePresenterBridgeStatusResponse(
  value: unknown,
): PresenterBridgeStatusResponse | null {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ['lastErrorCode', 'ok', 'presentation', 'state']) ||
    value.ok !== true ||
    !['active', 'disconnected', 'faulted', 'pending_confirmation'].includes(
      String(value.state),
    ) ||
    !(
      value.lastErrorCode === null || isPresenterIssueCode(value.lastErrorCode)
    ) ||
    !(
      value.presentation === null || isPresenterPresentation(value.presentation)
    )
  ) {
    return null
  }
  if (
    (value.state === 'disconnected' && value.presentation !== null) ||
    (value.state === 'faulted' && value.lastErrorCode === null) ||
    (value.state !== 'faulted' && value.lastErrorCode !== null)
  ) {
    return null
  }
  return value as PresenterBridgeStatusResponse
}

export function parsePresenterBridgeDisconnectResponse(
  value: unknown,
): PresenterBridgeDisconnectResponse | null {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ['ok', 'state']) ||
    value.ok !== true ||
    value.state !== 'disconnected'
  ) {
    return null
  }
  return value as PresenterBridgeDisconnectResponse
}

export function parsePresenterBridgeErrorResponse(
  value: unknown,
): PresenterBridgeErrorResponse | null {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ['code', 'message', 'ok']) ||
    value.ok !== false ||
    typeof value.code !== 'string' ||
    !SAFE_ERROR_CODE_PATTERN.test(value.code) ||
    !isBoundedString(value.message, 1, 240)
  ) {
    return null
  }
  return value as PresenterBridgeErrorResponse
}
