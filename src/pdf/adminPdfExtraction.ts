import { isPhase726BrowserPdfPublishingEnabled } from '../lib/featureFlags'
import type { AdminOperationCredentialInput } from '../lib/adminAuth/adminOperationCredential'
import {
  preflightBrowserPdf,
  type BrowserPdfPreflightResult,
} from './browserPdfPreflight'
import { issuePdfAccessSession, resolveRuntimePdf } from './pdfDelivery'
import { publisherClient, type PublisherExtraction } from './publisherClient'

type PdfDocumentIdentity = {
  documentId: string
  documentVersion: string
  manifestVersion: number
  pageCount: number
  textCharCount: number
  textSha256: string
}

const extractionCache = new Map<string, PublisherExtraction>()
const MAX_PDF_DOWNLOAD_BYTES = 15 * 1024 * 1024
const PDF_DOWNLOAD_TIMEOUT_MS = 30 * 1000

function cacheKey(
  lectureSessionId: string,
  documentId: string,
  documentVersion: string,
) {
  return `${lectureSessionId}:${documentId}:${documentVersion}`
}

function toExtraction(input: {
  documentId: string
  documentVersion: string
  lecturePublicId: string
  preflight: BrowserPdfPreflightResult
}): PublisherExtraction {
  return {
    documentId: input.documentId,
    documentVersion: input.documentVersion,
    lecturePublicId: input.lecturePublicId,
    pageCount: input.preflight.pageCount,
    pages: input.preflight.pages,
    textAvailable: input.preflight.textAvailable,
    textCharCount: input.preflight.textCharCount,
    textSha256: input.preflight.textSha256,
    textTruncated: input.preflight.textTruncated,
  }
}

function isCompatibleTextCount(
  preflight: BrowserPdfPreflightResult,
  documentTextCharCount: number,
) {
  return (
    preflight.textCharCount === documentTextCharCount ||
    (!preflight.textAvailable &&
      preflight.textCharCount === 0 &&
      documentTextCharCount === 1)
  )
}

function requireAiText(extraction: PublisherExtraction) {
  if (extraction.textAvailable === false || extraction.textCharCount < 1) {
    throw new Error(
      'このPDFには読み取れる文字情報がないため、AI分析は利用できません。資料の配信とスライド操作は利用できます。',
    )
  }
  return extraction
}

function assertPreflightMatchesDocument(
  preflight: BrowserPdfPreflightResult,
  document: PdfDocumentIdentity,
) {
  if (
    preflight.pdfSha256 !== document.documentVersion ||
    preflight.pageCount !== document.pageCount ||
    !isCompatibleTextCount(preflight, document.textCharCount) ||
    preflight.textSha256 !== document.textSha256
  ) {
    throw new Error('PDF extraction does not match the published document.')
  }
}

export function rememberBrowserPdfExtraction(input: {
  documentId: string
  lecturePublicId?: string
  lectureSessionId: string
  preflight: BrowserPdfPreflightResult
}) {
  const extraction = toExtraction({
    documentId: input.documentId,
    documentVersion: input.preflight.pdfSha256,
    lecturePublicId: input.lecturePublicId ?? '',
    preflight: input.preflight,
  })
  extractionCache.set(
    cacheKey(
      input.lectureSessionId,
      input.documentId,
      input.preflight.pdfSha256,
    ),
    extraction,
  )
}

export function hasBrowserPdfExtraction(input: {
  documentId: string
  documentVersion: string
  lectureSessionId: string
}) {
  return extractionCache.has(
    cacheKey(input.lectureSessionId, input.documentId, input.documentVersion),
  )
}

export function clearAdminPdfExtractionCache() {
  extractionCache.clear()
}

async function readBoundedPdfBody(response: Response) {
  const reader = response.body?.getReader()
  if (!reader) {
    throw new Error('Published PDF response body is unavailable.')
  }
  const chunks: Uint8Array[] = []
  let byteLength = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    byteLength += value.byteLength
    if (byteLength > MAX_PDF_DOWNLOAD_BYTES) {
      await reader.cancel()
      throw new Error('Published PDF exceeds the browser extraction limit.')
    }
    chunks.push(value)
  }
  if (byteLength < 5) {
    throw new Error('Published PDF size is invalid.')
  }
  const bytes = new Uint8Array(byteLength)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return bytes
}

async function downloadAndExtract(input: {
  adminToken: AdminOperationCredentialInput
  document: PdfDocumentIdentity
  lectureSessionId: string
}) {
  const runtime = await resolveRuntimePdf({
    adminToken: input.adminToken,
    documentId: input.document.documentId,
    documentVersion: input.document.documentVersion,
    lectureSessionId: input.lectureSessionId,
    manifestVersion: input.document.manifestVersion,
  })
  const url = await runtime.getAccessUrl('inline')
  const response = await fetch(url, {
    cache: 'no-store',
    credentials: 'omit',
    redirect: 'error',
    referrerPolicy: 'no-referrer',
    signal: AbortSignal.timeout(PDF_DOWNLOAD_TIMEOUT_MS),
  })
  if (!response.ok) {
    throw new Error(`Published PDF could not be read (${response.status}).`)
  }
  const contentLength = response.headers.get('Content-Length')
  if (
    contentLength &&
    (!/^\d+$/.test(contentLength) ||
      Number(contentLength) > MAX_PDF_DOWNLOAD_BYTES)
  ) {
    throw new Error('Published PDF exceeds the browser extraction limit.')
  }
  const bytes = await readBoundedPdfBody(response)
  const preflight = await preflightBrowserPdf(
    new File([bytes], `${input.document.documentId}.pdf`, {
      type: 'application/pdf',
    }),
  )
  assertPreflightMatchesDocument(preflight, input.document)
  const extraction = toExtraction({
    documentId: input.document.documentId,
    documentVersion: input.document.documentVersion,
    lecturePublicId: runtime.lecturePublicId,
    preflight,
  })
  extractionCache.set(
    cacheKey(
      input.lectureSessionId,
      input.document.documentId,
      input.document.documentVersion,
    ),
    extraction,
  )
  return extraction
}

export async function getAdminPdfExtraction(input: {
  adminToken: AdminOperationCredentialInput
  document: PdfDocumentIdentity
  lectureSessionId: string
  publisherSessionToken: string
}) {
  const key = cacheKey(
    input.lectureSessionId,
    input.document.documentId,
    input.document.documentVersion,
  )
  const cached = extractionCache.get(key)
  if (cached) {
    await issuePdfAccessSession({
      adminToken: input.adminToken,
      lectureSessionId: input.lectureSessionId,
    })
    return requireAiText(cached)
  }

  if (isPhase726BrowserPdfPublishingEnabled) {
    try {
      return requireAiText(await downloadAndExtract(input))
    } catch (error) {
      if (!input.publisherSessionToken) throw error
    }
  }
  if (!input.publisherSessionToken) {
    throw new Error('PDF extraction is unavailable in this browser session.')
  }
  const access = await issuePdfAccessSession({
    adminToken: input.adminToken,
    lectureSessionId: input.lectureSessionId,
  })
  return requireAiText(
    await publisherClient.getExtraction({
      accessToken: access.accessToken,
      documentId: input.document.documentId,
      documentVersion: input.document.documentVersion,
      lecturePublicId: access.lecturePublicId,
      publisherSessionToken: input.publisherSessionToken,
    }),
  )
}
