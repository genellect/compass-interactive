import type { AdminOperationCredentialInput } from '../lib/adminAuth/adminOperationCredential'
import { invokeEdgeFunction } from '../repositories/supabase/transport'

export type PdfAccessSession = {
  accessToken: string
  expiresAt: string
  lecturePublicId: string
  manifestVersion: number
  workerBaseUrl: string
}

export type RuntimePdfDocument = {
  archiveExpiresAt: string | null
  byteSize: number
  deleteAfter: string | null
  displayName: string
  documentId: string
  documentVersion: string
  downloadEnabled: boolean
  pageCount: number
  textCharCount: number
  visible: boolean
}

type AccessTokenResponse = {
  accessToken?: string
  expiresAt?: string
  lecturePublicId?: string
  manifestVersion?: number
  message?: string
  ok?: boolean
  workerBaseUrl?: string | null
}

type PublicManifestResponse = {
  access_version: number
  documents: Array<{
    archive_expires_at: string | null
    byte_size: number
    delete_after: string | null
    display_name: string
    document_id: string
    document_version: string
    download_enabled: boolean
    page_count: number
    text_char_count: number
    visible: boolean
  }>
  lecture_public_id: string
  manifest_version: number
  schema_version: 1
  updated_at: string
}

const memberSessionCache = new Map<string, PdfAccessSession>()
const pendingAdminSessions = new Map<string, Promise<PdfAccessSession>>()

function getWorkerBaseUrl(responseValue?: string | null, required = true) {
  const value = responseValue || import.meta.env.VITE_PDF_WORKER_BASE_URL
  if (!value) {
    if (!required) return ''
    throw new Error('PDF配信Workerが設定されていません。')
  }
  return value.replace(/\/$/, '')
}

async function getFunctionErrorMessage(error: unknown, fallback: string) {
  if (!(error instanceof Error)) return fallback
  const response = (error as { context?: unknown }).context
  if (response instanceof Response) {
    try {
      const body = (await response.clone().json()) as { message?: string }
      return body.message ?? error.message
    } catch {
      return error.message
    }
  }
  return error.message
}

export async function issuePdfAccessSession(input: {
  adminToken?: AdminOperationCredentialInput
  displayToken?: string
  lectureSessionId: string
}): Promise<PdfAccessSession> {
  if (input.adminToken && input.displayToken) {
    throw new Error('PDF認証情報が重複しています。')
  }
  const action = input.adminToken
    ? 'admin'
    : input.displayToken
      ? 'display'
      : 'member'
  const { data, error } = await invokeEdgeFunction<AccessTokenResponse>(
    'issue-pdf-access-token',
    {
      body: {
        action,
        ...(input.adminToken ? { adminToken: input.adminToken } : {}),
        ...(input.displayToken ? { displayToken: input.displayToken } : {}),
        lectureSessionId: input.lectureSessionId,
      },
    },
  )
  if (error)
    throw new Error(
      await getFunctionErrorMessage(error, 'PDF認証に失敗しました。'),
    )
  const manifestVersion = data?.manifestVersion
  if (
    !data?.ok ||
    !data.accessToken ||
    !data.expiresAt ||
    !data.lecturePublicId ||
    typeof manifestVersion !== 'number' ||
    !Number.isInteger(manifestVersion)
  ) {
    throw new Error(data?.message ?? 'PDF認証情報を取得できませんでした。')
  }
  return {
    accessToken: data.accessToken,
    expiresAt: data.expiresAt,
    lecturePublicId: data.lecturePublicId,
    manifestVersion,
    workerBaseUrl: getWorkerBaseUrl(data.workerBaseUrl, !input.adminToken),
  }
}

async function getMemberSession(lectureSessionId: string, force = false) {
  const existing = memberSessionCache.get(lectureSessionId)
  if (
    !force &&
    existing &&
    Date.parse(existing.expiresAt) > Date.now() + 30_000
  ) {
    return existing
  }
  const session = await issuePdfAccessSession({ lectureSessionId })
  memberSessionCache.set(lectureSessionId, session)
  return session
}

async function getAdminSession(
  adminToken: AdminOperationCredentialInput,
  lectureSessionId: string,
) {
  const key = `${adminToken.appSessionToken}:${lectureSessionId}`
  const pending = pendingAdminSessions.get(key)
  if (pending) return pending

  const request = issuePdfAccessSession({
    adminToken,
    lectureSessionId,
  })
  pendingAdminSessions.set(key, request)
  try {
    return await request
  } finally {
    if (pendingAdminSessions.get(key) === request) {
      pendingAdminSessions.delete(key)
    }
  }
}

async function getDisplaySession(
  displayToken: string,
  lectureSessionId: string,
) {
  return issuePdfAccessSession({
    displayToken,
    lectureSessionId,
  })
}

async function requestWorkerJson<T>(url: string, accessToken: string) {
  const response = await fetch(url, {
    cache: 'no-store',
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as {
      message?: string
    } | null
    throw Object.assign(
      new Error(
        body?.message ?? `PDF配信に失敗しました (${response.status})。`,
      ),
      { status: response.status },
    )
  }
  return (await response.json()) as T
}

export async function resolveRuntimePdf(input: {
  adminToken?: AdminOperationCredentialInput
  displayToken?: string
  documentId: string
  documentVersion: string
  lectureSessionId: string
  manifestVersion: number
}) {
  if (input.adminToken && input.displayToken) {
    throw new Error('PDF認証情報が重複しています。')
  }
  const getSession = (force = false) => {
    if (input.adminToken) {
      return getAdminSession(input.adminToken, input.lectureSessionId)
    }
    if (input.displayToken) {
      return getDisplaySession(input.displayToken, input.lectureSessionId)
    }
    return getMemberSession(input.lectureSessionId, force)
  }
  let session = await getSession()
  const fetchManifest = () =>
    requestWorkerJson<PublicManifestResponse>(
      `${session.workerBaseUrl}/v1/lectures/${session.lecturePublicId}/manifest`,
      session.accessToken,
    )
  let manifest: PublicManifestResponse
  try {
    manifest = await fetchManifest()
  } catch (error) {
    if ((error as { status?: number }).status !== 401) throw error
    session = await getSession(true)
    manifest = await fetchManifest()
  }
  if (manifest.manifest_version < input.manifestVersion) {
    throw new Error('PDFマニフェストの反映を待っています。再試行してください。')
  }
  const rawDocument = manifest.documents.find(
    (document) =>
      document.document_id === input.documentId &&
      document.document_version === input.documentVersion &&
      document.visible,
  )
  if (!rawDocument) throw new Error('指定されたPDF資料は利用できません。')
  const document: RuntimePdfDocument = {
    archiveExpiresAt: rawDocument.archive_expires_at,
    byteSize: rawDocument.byte_size,
    deleteAfter: rawDocument.delete_after,
    displayName: rawDocument.display_name,
    documentId: rawDocument.document_id,
    documentVersion: rawDocument.document_version,
    downloadEnabled: rawDocument.download_enabled,
    pageCount: rawDocument.page_count,
    textCharCount: rawDocument.text_char_count,
    visible: rawDocument.visible,
  }

  async function getAccessUrl(mode: 'download' | 'inline') {
    if (mode === 'download' && !document.downloadEnabled) {
      throw new Error('この資料はダウンロードできません。')
    }
    if (Date.parse(session.expiresAt) <= Date.now() + 30_000) {
      session = await getSession(true)
    }
    const endpoint = `${session.workerBaseUrl}/v1/lectures/${session.lecturePublicId}/documents/${document.documentId}/${document.documentVersion}/access?mode=${mode}`
    let ticket: { expiresAt: string; url: string }
    try {
      ticket = await requestWorkerJson(endpoint, session.accessToken)
    } catch (error) {
      if ((error as { status?: number }).status !== 401) throw error
      session = await getSession(true)
      const retryEndpoint = `${session.workerBaseUrl}/v1/lectures/${session.lecturePublicId}/documents/${document.documentId}/${document.documentVersion}/access?mode=${mode}`
      ticket = await requestWorkerJson(retryEndpoint, session.accessToken)
    }
    return ticket.url
  }

  return { document, getAccessUrl, lecturePublicId: session.lecturePublicId }
}
