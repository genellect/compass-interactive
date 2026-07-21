import { isPhase726BrowserPdfPublishingEnabled } from '../lib/featureFlags'
import { preflightBrowserPdf, type BrowserPdfPreflightResult } from './browserPdfPreflight'
import { issuePdfAccessSession, resolveRuntimePdf } from './pdfDelivery'
import {
  publisherClient,
  type PublisherExtraction,
} from './publisherClient'

type PdfDocumentIdentity = {
  documentId: string
  documentVersion: string
  manifestVersion: number
  pageCount: number
  textCharCount: number
  textSha256: string
}

const extractionCache = new Map<string, PublisherExtraction>()

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
    textCharCount: input.preflight.textCharCount,
    textSha256: input.preflight.textSha256,
  }
}

function assertPreflightMatchesDocument(
  preflight: BrowserPdfPreflightResult,
  document: PdfDocumentIdentity,
) {
  if (
    preflight.pdfSha256 !== document.documentVersion ||
    preflight.pageCount !== document.pageCount ||
    preflight.textCharCount !== document.textCharCount ||
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
    cacheKey(
      input.lectureSessionId,
      input.documentId,
      input.documentVersion,
    ),
  )
}

async function downloadAndExtract(input: {
  adminToken: string
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
  })
  if (!response.ok) {
    throw new Error(`Published PDF could not be read (${response.status}).`)
  }
  const contentLength = response.headers.get('Content-Length')
  if (
    contentLength &&
    (!/^\d+$/.test(contentLength) || Number(contentLength) > 15 * 1024 * 1024)
  ) {
    throw new Error('Published PDF exceeds the browser extraction limit.')
  }
  const bytes = await response.arrayBuffer()
  if (bytes.byteLength < 5 || bytes.byteLength > 15 * 1024 * 1024) {
    throw new Error('Published PDF size is invalid.')
  }
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
  adminToken: string
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
  if (cached) return cached

  if (isPhase726BrowserPdfPublishingEnabled) {
    try {
      return await downloadAndExtract(input)
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
  return publisherClient.getExtraction({
    accessToken: access.accessToken,
    documentId: input.document.documentId,
    documentVersion: input.document.documentVersion,
    lecturePublicId: access.lecturePublicId,
    publisherSessionToken: input.publisherSessionToken,
  })
}
