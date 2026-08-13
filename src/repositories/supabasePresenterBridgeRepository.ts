import {
  isAdminOperationCredential,
  type AdminOperationCredentialInput,
} from '../lib/adminAuth/adminOperationCredential'
import { isPresenterPairingTicket } from '../presenter/presenterBridgeProtocol.ts'

import {
  getFunctionErrorMessage,
  SUPABASE_REQUEST_TIMEOUT_MS,
} from './supabase/requestPolicy'
import { invokeEdgeFunction } from './supabase/transport'

const PRESENTER_EDGE_FUNCTION = 'manage-presenter-connection'
const PRESENTER_EDGE_TIMEOUT_MS = SUPABASE_REQUEST_TIMEOUT_MS.adminFunction

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const SHA256_PATTERN = /^[0-9a-f]{64}$/
const DOCUMENT_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/
const MANUAL_CODE_PATTERN = /^[A-HJ-NP-Z2-9]{8}$/

export type PresenterConnectionState =
  'active' | 'confirmed' | 'inspected' | 'pairing' | 'revoked'

export type PresenterPdfBinding = {
  documentId: string
  documentVersion: string
  manifestVersion: number
  pageCount: number
}

export type IssuedPresenterConnection = {
  connectionId: string
  hardStopAt: string
  manualCode: string
  pairingTicketExpiresAt: string
  pairingTicket: string
  pdf: PresenterPdfBinding
  ticketExpiresAt: string
}

export type PresenterConnectionStatus = {
  capabilityExpiresAt: string | null
  confirmedAt: string | null
  connectionId: string
  customShowActive: boolean | null
  hardStopAt: string
  hiddenSlideCount: number | null
  lastCommittedPdfPage: number | null
  lastSeenAt: string | null
  lastSequence: number
  pdfDocumentId: string
  pdfDocumentVersion: string
  pdfPageCount: number
  pptxFileSha256: string | null
  revokedAt: string | null
  revokeReason: string | null
  slideCount: number | null
  slideIdOrderSha256: string | null
  state: PresenterConnectionState
  ticketExpiresAt: string
}

export type PresenterConnectionStatusResult = {
  connection: PresenterConnectionStatus | null
  runtimeEnabled: boolean
}

export type ConfirmedPresenterConnection = {
  connectionId: string
  pdfPageCount: number
  state: 'confirmed'
}

export type RevokedPresenterConnection = {
  connectionId: string
  revokeReason: 'manual_handover'
  revokedAt: string
  state: 'revoked'
}

type IssueResponse = IssuedPresenterConnection & { ok: true }
type ConfirmResponse = ConfirmedPresenterConnection & { ok: true }
type StatusResponse = PresenterConnectionStatusResult & { ok: true }
type RevokeResponse = RevokedPresenterConnection & { ok: true }

type PresenterEdgeErrorResponse = {
  message?: unknown
  ok?: unknown
}

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

function hasAsciiControl(value: string, includeSpace = false) {
  return Array.from(value).some((character) => {
    const code = character.charCodeAt(0)
    return code <= (includeSpace ? 32 : 31) || code === 127
  })
}

function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value)
}

function isSha256(value: unknown): value is string {
  return typeof value === 'string' && SHA256_PATTERN.test(value)
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

function isNullableIsoTimestamp(value: unknown): value is string | null {
  return value === null || isIsoTimestamp(value)
}

function isNullableSha256(value: unknown): value is string | null {
  return value === null || isSha256(value)
}

function isNullablePageCount(value: unknown): value is number | null {
  return (
    value === null ||
    (Number.isSafeInteger(value) && Number(value) >= 1 && Number(value) <= 75)
  )
}

function assertAdminRequest(request: {
  adminToken: AdminOperationCredentialInput
  connectionId?: string
  lectureSessionId?: string
}) {
  if (
    !isAdminOperationCredential(request.adminToken) ||
    (request.connectionId !== undefined && !isUuid(request.connectionId)) ||
    (request.lectureSessionId !== undefined &&
      !isUuid(request.lectureSessionId))
  ) {
    throw new Error('Invalid Presenter connection request.')
  }
}

function parsePdfBinding(value: unknown): PresenterPdfBinding | null {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      'documentId',
      'documentVersion',
      'manifestVersion',
      'pageCount',
    ]) ||
    typeof value.documentId !== 'string' ||
    !DOCUMENT_ID_PATTERN.test(value.documentId) ||
    !isSha256(value.documentVersion) ||
    !Number.isSafeInteger(value.manifestVersion) ||
    Number(value.manifestVersion) < 1 ||
    !Number.isSafeInteger(value.pageCount) ||
    Number(value.pageCount) < 1 ||
    Number(value.pageCount) > 75
  ) {
    return null
  }
  return value as PresenterPdfBinding
}

function parseIssueResponse(value: unknown): IssueResponse | null {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      'connectionId',
      'hardStopAt',
      'manualCode',
      'ok',
      'pairingTicketExpiresAt',
      'pairingTicket',
      'pdf',
      'ticketExpiresAt',
    ]) ||
    value.ok !== true ||
    !isUuid(value.connectionId) ||
    !isIsoTimestamp(value.hardStopAt) ||
    typeof value.manualCode !== 'string' ||
    !MANUAL_CODE_PATTERN.test(value.manualCode) ||
    !isIsoTimestamp(value.pairingTicketExpiresAt) ||
    !isPresenterPairingTicket(value.pairingTicket) ||
    !parsePdfBinding(value.pdf) ||
    !isIsoTimestamp(value.ticketExpiresAt) ||
    Date.parse(value.pairingTicketExpiresAt) >
      Date.parse(value.ticketExpiresAt) ||
    Date.parse(value.ticketExpiresAt) > Date.parse(value.hardStopAt)
  ) {
    return null
  }
  return value as IssueResponse
}

function parseConfirmResponse(value: unknown): ConfirmResponse | null {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ['connectionId', 'ok', 'pdfPageCount', 'state']) ||
    value.ok !== true ||
    !isUuid(value.connectionId) ||
    !Number.isSafeInteger(value.pdfPageCount) ||
    Number(value.pdfPageCount) < 1 ||
    Number(value.pdfPageCount) > 75 ||
    value.state !== 'confirmed'
  ) {
    return null
  }
  return value as ConfirmResponse
}

function parseConnectionStatus(
  value: unknown,
): PresenterConnectionStatus | null {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      'capabilityExpiresAt',
      'confirmedAt',
      'connectionId',
      'customShowActive',
      'hardStopAt',
      'hiddenSlideCount',
      'lastCommittedPdfPage',
      'lastSeenAt',
      'lastSequence',
      'pdfDocumentId',
      'pdfDocumentVersion',
      'pdfPageCount',
      'pptxFileSha256',
      'revokedAt',
      'revokeReason',
      'slideCount',
      'slideIdOrderSha256',
      'state',
      'ticketExpiresAt',
    ]) ||
    !isNullableIsoTimestamp(value.capabilityExpiresAt) ||
    !isNullableIsoTimestamp(value.confirmedAt) ||
    !isUuid(value.connectionId) ||
    !(
      value.customShowActive === null ||
      typeof value.customShowActive === 'boolean'
    ) ||
    !isIsoTimestamp(value.hardStopAt) ||
    !(
      value.hiddenSlideCount === null ||
      (Number.isSafeInteger(value.hiddenSlideCount) &&
        Number(value.hiddenSlideCount) >= 0 &&
        Number(value.hiddenSlideCount) <= 75)
    ) ||
    !isNullablePageCount(value.lastCommittedPdfPage) ||
    !isNullableIsoTimestamp(value.lastSeenAt) ||
    !Number.isSafeInteger(value.lastSequence) ||
    Number(value.lastSequence) < -1 ||
    typeof value.pdfDocumentId !== 'string' ||
    !DOCUMENT_ID_PATTERN.test(value.pdfDocumentId) ||
    !isSha256(value.pdfDocumentVersion) ||
    !Number.isSafeInteger(value.pdfPageCount) ||
    Number(value.pdfPageCount) < 1 ||
    Number(value.pdfPageCount) > 75 ||
    !isNullableSha256(value.pptxFileSha256) ||
    !isNullableIsoTimestamp(value.revokedAt) ||
    !(
      value.revokeReason === null ||
      (typeof value.revokeReason === 'string' &&
        value.revokeReason.length >= 1 &&
        value.revokeReason.length <= 80 &&
        !hasAsciiControl(value.revokeReason))
    ) ||
    !isNullablePageCount(value.slideCount) ||
    !isNullableSha256(value.slideIdOrderSha256) ||
    !['active', 'confirmed', 'inspected', 'pairing', 'revoked'].includes(
      String(value.state),
    ) ||
    !isIsoTimestamp(value.ticketExpiresAt)
  ) {
    return null
  }
  if (
    (value.state === 'revoked') !== (value.revokedAt !== null) ||
    (value.state === 'pairing' &&
      (value.slideCount !== null ||
        value.pptxFileSha256 !== null ||
        value.customShowActive !== null)) ||
    (['inspected', 'confirmed', 'active'].includes(String(value.state)) &&
      (value.slideCount === null ||
        value.pptxFileSha256 === null ||
        value.customShowActive === null))
  ) {
    return null
  }
  return value as PresenterConnectionStatus
}

function parseStatusResponse(value: unknown): StatusResponse | null {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ['connection', 'ok', 'runtimeEnabled']) ||
    value.ok !== true ||
    typeof value.runtimeEnabled !== 'boolean'
  ) {
    return null
  }
  const connection =
    value.connection === null ? null : parseConnectionStatus(value.connection)
  if (value.connection !== null && connection === null) return null
  return value as StatusResponse
}

function parseRevokeResponse(value: unknown): RevokeResponse | null {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      'connectionId',
      'ok',
      'revokeReason',
      'revokedAt',
      'state',
    ]) ||
    value.ok !== true ||
    !isUuid(value.connectionId) ||
    value.revokeReason !== 'manual_handover' ||
    !isIsoTimestamp(value.revokedAt) ||
    value.state !== 'revoked'
  ) {
    return null
  }
  return value as RevokeResponse
}

async function invokePresenterAction<T>(input: {
  body: Record<string, unknown>
  fallbackMessage: string
  parse: (value: unknown) => T | null
}) {
  const { data, error } = await invokeEdgeFunction<unknown>(
    PRESENTER_EDGE_FUNCTION,
    {
      body: input.body,
      timeout: PRESENTER_EDGE_TIMEOUT_MS,
    },
  )
  if (error) {
    throw new Error(await getFunctionErrorMessage(error, input.fallbackMessage))
  }

  const parsed = input.parse(data)
  if (parsed) return parsed

  const errorResponse = data as PresenterEdgeErrorResponse | null
  if (
    errorResponse?.ok === false &&
    typeof errorResponse.message === 'string' &&
    errorResponse.message.length <= 240
  ) {
    throw new Error(errorResponse.message)
  }
  throw new Error(input.fallbackMessage)
}

export const supabasePresenterBridgeRepository = {
  async issue(request: {
    adminToken: AdminOperationCredentialInput
    lectureSessionId: string
  }): Promise<IssuedPresenterConnection> {
    assertAdminRequest(request)
    const response = await invokePresenterAction({
      body: { action: 'issue', ...request },
      fallbackMessage: 'PowerPoint connection could not be prepared.',
      parse: parseIssueResponse,
    })
    const { ok: _ok, ...result } = response
    return result
  },

  async confirm(request: {
    adminToken: AdminOperationCredentialInput
    connectionId: string
  }): Promise<ConfirmedPresenterConnection> {
    assertAdminRequest(request)
    const response = await invokePresenterAction({
      body: { action: 'confirm', ...request },
      fallbackMessage: 'PowerPoint connection could not be confirmed.',
      parse: parseConfirmResponse,
    })
    const { ok: _ok, ...result } = response
    return result
  },

  async status(request: {
    adminToken: AdminOperationCredentialInput
    lectureSessionId: string
  }): Promise<PresenterConnectionStatusResult> {
    assertAdminRequest(request)
    const response = await invokePresenterAction({
      body: { action: 'status', ...request },
      fallbackMessage: 'PowerPoint connection status is unavailable.',
      parse: parseStatusResponse,
    })
    return {
      connection: response.connection,
      runtimeEnabled: response.runtimeEnabled,
    }
  },

  async revoke(request: {
    adminToken: AdminOperationCredentialInput
    connectionId: string
  }): Promise<RevokedPresenterConnection> {
    assertAdminRequest(request)
    const response = await invokePresenterAction({
      body: { action: 'revoke', ...request },
      fallbackMessage: 'PowerPoint connection could not be stopped.',
      parse: parseRevokeResponse,
    })
    const { ok: _ok, ...result } = response
    return result
  },
}
