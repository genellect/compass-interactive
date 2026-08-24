import { type AdminOperationCredentialInput } from '../lib/adminAuth/adminOperationCredential'
import {
  completeAdminOperationRequestId,
  reserveAdminOperationRequestId,
} from '../lib/adminAuth/adminOperationRequestId'
import {
  getFunctionErrorMessage,
  SUPABASE_REQUEST_TIMEOUT_MS,
} from '../repositories/supabase/requestPolicy'
import { invokeEdgeFunction } from '../repositories/supabase/transport'
import type { BrowserPdfPreflightResult } from './browserPdfPreflight'

const PUBLICATION_FUNCTION = 'manage-pdf-publications'
const UPLOAD_TIMEOUT_MS = 3 * 60 * 1000
const FINALIZE_TIMEOUT_MS = 60 * 1000
const MAX_RESPONSE_BYTES = 64 * 1024
const STORAGE_PREFIX = 'compass-interactive-browser-pdf-publication-v1:'
const PUBLICATION_STATUSES = new Set<BrowserPdfPublicationStatus>([
  'pending',
  'uploaded',
  'committed',
  'active',
  'expired',
  'aborted',
  'retired',
])

export type BrowserPdfPublicationStatus =
  | 'pending'
  | 'uploaded'
  | 'committed'
  | 'active'
  | 'expired'
  | 'aborted'
  | 'retired'

type PublicationResponse = {
  documentId?: string
  documentVersion?: string
  expiresAt?: string
  found?: boolean
  idempotencyKey?: string
  message?: string
  manifestVersion?: number
  ok?: boolean
  publicationId?: string
  status?: BrowserPdfPublicationStatus
  uploadTicket?: string
  uploadUrl?: string
}

export type BrowserPdfPublicationActivation = {
  documentId: string
  documentVersion: string
  manifestVersion: number
}

export type BrowserPdfPublicationRecovery = {
  documentId: string
  expiresAt: string
  finalizeRequestId?: string
  idempotencyKey: string
  lectureSessionId: string
  publicationId: string
}

export type InitiateBrowserPdfPublicationInput = {
  adminToken: AdminOperationCredentialInput
  displayName: string
  documentId: string
  downloadEnabled: boolean
  fileName: string
  idempotencyKey: string
  lectureSessionId: string
  preflight: BrowserPdfPreflightResult
}

export type BrowserPdfPublicationHandle = {
  documentId: string
  expiresAt: string
  idempotencyKey: string
  lectureSessionId: string
  publicationId: string
  uploadRequired: boolean
  uploadTicket?: string
  uploadUrl?: string
}

export class BrowserPdfPublicationError extends Error {
  readonly status: number | null

  constructor(message: string, status: number | null = null) {
    super(message)
    this.name = 'BrowserPdfPublicationError'
    this.status = status
  }
}

function publicationStorageKey(lectureSessionId: string) {
  return `${STORAGE_PREFIX}${lectureSessionId}`
}

function assertPublicationId(value: string | undefined) {
  if (
    !value ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    )
  ) {
    throw new BrowserPdfPublicationError('PDF公開IDが不正です。')
  }
  return value
}

function assertDocumentVersion(value: string | undefined) {
  if (!value || !/^[0-9a-f]{64}$/.test(value)) {
    throw new BrowserPdfPublicationError(
      'PDF公開document versionのbindingを確認できません。',
    )
  }
  return value
}

function assertManifestVersion(value: number | undefined) {
  if (!Number.isSafeInteger(value) || (value ?? 0) < 1) {
    throw new BrowserPdfPublicationError(
      'PDF公開manifest versionのbindingを確認できません。',
    )
  }
  return value!
}

function assertExpiry(value: string | undefined) {
  if (
    !value ||
    !Number.isFinite(Date.parse(value)) ||
    Date.parse(value) <= Date.now()
  ) {
    throw new BrowserPdfPublicationError('PDF公開の有効期限が不正です。')
  }
  return value
}

function assertTimestamp(value: string | undefined) {
  if (!value || !Number.isFinite(Date.parse(value))) {
    throw new BrowserPdfPublicationError('PDF公開の有効期限が不正です。')
  }
  return value
}

function assertIdempotencyKey(value: string | undefined) {
  if (
    !value ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    )
  ) {
    throw new BrowserPdfPublicationError('PDF公開の再開情報が不正です。')
  }
  return value
}

function assertFinalizeRequestId(value: string | undefined) {
  if (
    !value ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    )
  ) {
    throw new BrowserPdfPublicationError('PDF公開の再開IDが不正です。')
  }
  return value
}

function finalizeRequestBody(lectureSessionId: string, publicationId: string) {
  return {
    action: 'finalize',
    lectureSessionId,
    publicationId: assertPublicationId(publicationId),
  }
}

function assertPublicationStatus(value: string | undefined) {
  if (
    !value ||
    !PUBLICATION_STATUSES.has(value as BrowserPdfPublicationStatus)
  ) {
    throw new BrowserPdfPublicationError('PDF公開状態が不正です。')
  }
  return value as BrowserPdfPublicationStatus
}

function assertUploadUrl(value: string | undefined, publicationId: string) {
  if (!value) throw new BrowserPdfPublicationError('PDF送信先がありません。')
  let parsed: URL
  let configuredWorker: URL
  try {
    parsed = new URL(value)
    configuredWorker = new URL(import.meta.env.VITE_PDF_WORKER_BASE_URL)
  } catch {
    throw new BrowserPdfPublicationError('PDF送信先が不正です。')
  }
  const isLoopback = ['127.0.0.1', 'localhost'].includes(parsed.hostname)
  if (
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash ||
    parsed.origin !== configuredWorker.origin ||
    parsed.pathname !== `/v2/pdf-publications/${publicationId}` ||
    (parsed.protocol !== 'https:' &&
      !(parsed.protocol === 'http:' && isLoopback))
  ) {
    throw new BrowserPdfPublicationError('PDF送信先を安全に確認できません。')
  }
  return parsed.toString()
}

function assertUploadTicket(value: string | undefined) {
  if (
    !value ||
    value.length > 8192 ||
    !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(value)
  ) {
    throw new BrowserPdfPublicationError('PDF送信ticketが不正です。')
  }
  return value
}

async function invokePublicationAction(
  body: Record<
    string,
    AdminOperationCredentialInput | boolean | number | string
  >,
  timeout: number = SUPABASE_REQUEST_TIMEOUT_MS.adminFunction,
) {
  const { data, error } = await invokeEdgeFunction<PublicationResponse>(
    PUBLICATION_FUNCTION,
    { body, timeout },
  )
  if (error) {
    throw new BrowserPdfPublicationError(
      await getFunctionErrorMessage(error, 'PDF公開処理に失敗しました。'),
    )
  }
  if (!data?.ok) {
    throw new BrowserPdfPublicationError(
      data?.message ?? 'PDF公開処理に失敗しました。',
    )
  }
  return data
}

async function parseBoundedUploadResponse(response: Response) {
  const contentLength = response.headers.get('Content-Length')
  if (
    contentLength !== null &&
    (!/^\d+$/.test(contentLength) || Number(contentLength) > MAX_RESPONSE_BYTES)
  ) {
    throw new BrowserPdfPublicationError(
      'PDF送信結果が大きすぎます。',
      response.status,
    )
  }
  const reader = response.body?.getReader()
  const chunks: Uint8Array[] = []
  let byteLength = 0
  if (reader) {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      byteLength += value.byteLength
      if (byteLength > MAX_RESPONSE_BYTES) {
        await reader.cancel()
        throw new BrowserPdfPublicationError(
          'PDF送信結果が大きすぎます。',
          response.status,
        )
      }
      chunks.push(value)
    }
  }
  const bytes = new Uint8Array(byteLength)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  const text = new TextDecoder().decode(bytes)
  let body: PublicationResponse | null = null
  try {
    body = JSON.parse(text) as PublicationResponse
  } catch {
    // A non-JSON Worker response always fails closed.
  }
  if (!response.ok || !body?.ok) {
    throw new BrowserPdfPublicationError(
      body?.message ?? `PDFを送信できませんでした (${response.status})。`,
      response.status,
    )
  }
  return body
}

export const browserPdfPublicationClient = {
  async discover(input: {
    adminToken: AdminOperationCredentialInput
    lectureSessionId: string
  }): Promise<
    | (BrowserPdfPublicationRecovery & { status: BrowserPdfPublicationStatus })
    | null
  > {
    const response = await invokePublicationAction({
      action: 'discover',
      adminToken: input.adminToken,
      lectureSessionId: input.lectureSessionId,
    })
    if (response.found === false) return null
    if (response.found !== true || !response.documentId) {
      throw new BrowserPdfPublicationError('PDF公開の再開情報が不正です。')
    }
    return {
      documentId: response.documentId,
      expiresAt: assertTimestamp(response.expiresAt),
      idempotencyKey: assertIdempotencyKey(response.idempotencyKey),
      lectureSessionId: input.lectureSessionId,
      publicationId: assertPublicationId(response.publicationId),
      status: assertPublicationStatus(response.status),
    }
  },

  async initiate(
    input: InitiateBrowserPdfPublicationInput,
  ): Promise<BrowserPdfPublicationHandle> {
    const response = await invokePublicationAction({
      action: 'initiate',
      adminToken: input.adminToken,
      byteSize: input.preflight.byteSize,
      displayName: input.displayName,
      documentId: input.documentId,
      downloadEnabled: input.downloadEnabled,
      fileName: input.fileName,
      idempotencyKey: input.idempotencyKey,
      lectureSessionId: input.lectureSessionId,
      pageCount: input.preflight.pageCount,
      pdfSha256: input.preflight.pdfSha256,
      // Publication metadata v1 requires a positive count. The extraction
      // keeps the real zero count and textAvailable=false for textless PDFs.
      textCharCount: Math.max(1, input.preflight.textCharCount),
      textSha256: input.preflight.textSha256,
    })
    const publicationId = assertPublicationId(response.publicationId)
    const expiresAt = assertExpiry(response.expiresAt)
    const status = assertPublicationStatus(response.status)
    const uploadRequired = status === 'pending'
    const uploadUrl = uploadRequired
      ? assertUploadUrl(response.uploadUrl, publicationId)
      : undefined
    const uploadTicket = uploadRequired
      ? assertUploadTicket(response.uploadTicket)
      : undefined
    if (
      !uploadRequired &&
      !['uploaded', 'committed', 'active'].includes(status)
    ) {
      throw new BrowserPdfPublicationError(
        'PDF publication can no longer be resumed.',
      )
    }
    return {
      documentId: input.documentId,
      expiresAt,
      idempotencyKey: input.idempotencyKey,
      lectureSessionId: input.lectureSessionId,
      publicationId,
      uploadRequired,
      uploadTicket,
      uploadUrl,
    }
  },

  async upload(handle: BrowserPdfPublicationHandle, file: File) {
    if (!handle.uploadRequired || !handle.uploadTicket || !handle.uploadUrl) {
      throw new BrowserPdfPublicationError('PDF upload is not required.')
    }
    const controller = new AbortController()
    const timeout = window.setTimeout(
      () => controller.abort(),
      UPLOAD_TIMEOUT_MS,
    )
    try {
      const response = await fetch(handle.uploadUrl, {
        body: file,
        cache: 'no-store',
        credentials: 'omit',
        headers: {
          Authorization: `Bearer ${handle.uploadTicket}`,
          'Content-Type': 'application/pdf',
        },
        method: 'PUT',
        mode: 'cors',
        redirect: 'error',
        referrerPolicy: 'no-referrer',
        signal: controller.signal,
      })
      const result = await parseBoundedUploadResponse(response)
      if (
        assertPublicationId(result.publicationId) !== handle.publicationId ||
        result.status !== 'uploaded'
      ) {
        throw new BrowserPdfPublicationError(
          'PDF送信結果のbindingを確認できません。',
          response.status,
        )
      }
      return result
    } catch (error) {
      if (error instanceof BrowserPdfPublicationError) throw error
      if (controller.signal.aborted) {
        throw new BrowserPdfPublicationError(
          'PDF送信がタイムアウトしました。状態を確認して再開できます。',
        )
      }
      throw new BrowserPdfPublicationError(
        error instanceof Error
          ? `PDFを送信できませんでした: ${error.message}`
          : 'PDFを送信できませんでした。',
      )
    } finally {
      window.clearTimeout(timeout)
    }
  },

  async status(input: {
    adminToken: AdminOperationCredentialInput
    lectureSessionId: string
    publicationId: string
  }) {
    const response = await invokePublicationAction({
      action: 'status',
      adminToken: input.adminToken,
      lectureSessionId: input.lectureSessionId,
      publicationId: assertPublicationId(input.publicationId),
    })
    const status = assertPublicationStatus(response.status)
    if (assertPublicationId(response.publicationId) !== input.publicationId) {
      throw new BrowserPdfPublicationError(
        'PDF公開状態のbindingを確認できません。',
      )
    }
    const activeBinding =
      status === 'active'
        ? {
            documentVersion: assertDocumentVersion(response.documentVersion),
            manifestVersion: assertManifestVersion(response.manifestVersion),
          }
        : {}
    return { ...response, ...activeBinding, status } as PublicationResponse & {
      publicationId: string
      status: BrowserPdfPublicationStatus
    }
  },

  async finalize(input: {
    adminToken: AdminOperationCredentialInput
    finalizeRequestId: string
    lectureSessionId: string
    publicationId: string
  }) {
    const requestBody = finalizeRequestBody(
      input.lectureSessionId,
      input.publicationId,
    )
    const reserved = reserveAdminOperationRequestId(
      PUBLICATION_FUNCTION,
      requestBody,
      assertFinalizeRequestId(input.finalizeRequestId),
    )
    const response = await invokePublicationAction(
      {
        adminToken: input.adminToken,
        ...requestBody,
        requestId: reserved.requestId,
      },
      FINALIZE_TIMEOUT_MS,
    )
    const status = assertPublicationStatus(response.status)
    if (
      assertPublicationId(response.publicationId) !== input.publicationId ||
      !['committed', 'active'].includes(status)
    ) {
      throw new BrowserPdfPublicationError(
        'PDF公開完了状態のbindingを確認できません。',
      )
    }
    const activeBinding =
      status === 'active'
        ? {
            documentVersion: assertDocumentVersion(response.documentVersion),
            manifestVersion: assertManifestVersion(response.manifestVersion),
          }
        : {}
    if (status === 'active') {
      completeAdminOperationRequestId(reserved.key, reserved.requestId)
    }
    return { ...response, ...activeBinding, status } as PublicationResponse & {
      publicationId: string
      status: 'active' | 'committed'
    }
  },

  async abort(input: {
    adminToken: AdminOperationCredentialInput
    lectureSessionId: string
    publicationId: string
    reason: string
  }) {
    return invokePublicationAction({
      action: 'abort',
      adminToken: input.adminToken,
      lectureSessionId: input.lectureSessionId,
      publicationId: assertPublicationId(input.publicationId),
      reason: input.reason,
    })
  },
}

export function rememberBrowserPdfPublication(
  handle: BrowserPdfPublicationRecovery,
) {
  const stored: BrowserPdfPublicationRecovery = {
    documentId: handle.documentId,
    expiresAt: handle.expiresAt,
    ...(handle.finalizeRequestId
      ? { finalizeRequestId: assertFinalizeRequestId(handle.finalizeRequestId) }
      : {}),
    idempotencyKey: handle.idempotencyKey,
    lectureSessionId: handle.lectureSessionId,
    publicationId: handle.publicationId,
  }
  window.sessionStorage.setItem(
    publicationStorageKey(handle.lectureSessionId),
    JSON.stringify(stored),
  )
}

export function restoreBrowserPdfPublication(lectureSessionId: string) {
  const raw = window.sessionStorage.getItem(
    publicationStorageKey(lectureSessionId),
  )
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as BrowserPdfPublicationRecovery
    if (
      parsed.lectureSessionId !== lectureSessionId ||
      !parsed.documentId ||
      !Number.isFinite(Date.parse(parsed.expiresAt))
    ) {
      throw new Error('Stored publication is invalid.')
    }
    assertIdempotencyKey(parsed.idempotencyKey)
    assertPublicationId(parsed.publicationId)
    if (parsed.finalizeRequestId) {
      assertFinalizeRequestId(parsed.finalizeRequestId)
    }
    return parsed
  } catch {
    window.sessionStorage.removeItem(publicationStorageKey(lectureSessionId))
    return null
  }
}

export function prepareBrowserPdfPublicationFinalization(
  recovery: BrowserPdfPublicationRecovery,
) {
  const requestBody = finalizeRequestBody(
    recovery.lectureSessionId,
    recovery.publicationId,
  )
  const reserved = reserveAdminOperationRequestId(
    PUBLICATION_FUNCTION,
    requestBody,
    recovery.finalizeRequestId
      ? assertFinalizeRequestId(recovery.finalizeRequestId)
      : undefined,
  )
  const prepared = {
    ...recovery,
    finalizeRequestId: reserved.requestId,
  }
  rememberBrowserPdfPublication(prepared)
  return prepared
}

export function forgetBrowserPdfPublication(lectureSessionId: string) {
  window.sessionStorage.removeItem(publicationStorageKey(lectureSessionId))
}
