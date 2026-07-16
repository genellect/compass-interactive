const MAX_PDF_BYTES = 15 * 1024 * 1024

export type PublisherPublication = {
  document: {
    byteSize: number
    displayName: string
    documentId: string
    documentVersion: string
    downloadEnabled: boolean
    pageCount: number
    pdfSha256: string
    textCharCount: number
    textSha256: string
  }
  duplicate: boolean
  manifestVersion: number
}

export type PublisherExtractionPage = {
  characterCount: number
  excerptId: string
  pageNumber: number
  text: string
}

export type PublisherExtraction = {
  documentId: string
  documentVersion: string
  lecturePublicId: string
  pageCount: number
  pages: PublisherExtractionPage[]
  textCharCount: number
  textSha256: string
}

type PublisherResponse<T> = T & { message?: string; ok?: boolean }

export class PublisherRequestError extends Error {
  readonly status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = 'PublisherRequestError'
    this.status = status
  }
}

const baseUrl = (
  import.meta.env.VITE_PDF_PUBLISHER_URL || 'http://127.0.0.1:43123'
).replace(/\/$/, '')

async function parseResponse<T>(response: Response) {
  const body = (await response
    .json()
    .catch(() => null)) as PublisherResponse<T> | null
  if (!response.ok || !body?.ok) {
    throw new PublisherRequestError(
      body?.message ?? '講義資料の公開機能へ接続できませんでした。',
      response.status,
    )
  }
  return body
}

export const publisherClient = {
  async health() {
    const response = await fetch(`${baseUrl}/v1/health`, {
      cache: 'no-store',
    })
    return parseResponse<{ service: string; version: number }>(response)
  },

  async verifySession(publisherSessionToken: string) {
    const response = await fetch(`${baseUrl}/v1/session`, {
      cache: 'no-store',
      headers: {
        'X-Compass-Publisher-Token': publisherSessionToken,
      },
    })
    return parseResponse<{ expiresAt: string }>(response)
  },

  async pair(pairingCode: string) {
    const response = await fetch(`${baseUrl}/v1/pair`, {
      body: JSON.stringify({ pairingCode }),
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    })
    return parseResponse<{ expiresAt: string; sessionToken: string }>(response)
  },

  async publish(input: {
    accessToken: string
    displayName: string
    documentId: string
    downloadEnabled: boolean
    file: File
    lecturePublicId: string
    publisherSessionToken: string
  }): Promise<PublisherPublication> {
    if (
      input.file.size < 1 ||
      input.file.size > MAX_PDF_BYTES ||
      input.file.type !== 'application/pdf' ||
      !input.file.name.toLowerCase().endsWith('.pdf')
    ) {
      throw new Error('PDFはapplication/pdf・15MB以下で指定してください。')
    }
    const query = new URLSearchParams({
      displayName: input.displayName,
      downloadEnabled: String(input.downloadEnabled),
    })
    const response = await fetch(
      `${baseUrl}/v1/lectures/${input.lecturePublicId}/documents/${input.documentId}?${query}`,
      {
        body: input.file,
        cache: 'no-store',
        headers: {
          'Content-Type': 'application/pdf',
          'X-Compass-Lecture-Token': input.accessToken,
          'X-Compass-Publisher-Token': input.publisherSessionToken,
          'X-File-Name': encodeURIComponent(input.file.name),
        },
        method: 'POST',
      },
    )
    return parseResponse<PublisherPublication>(response)
  },

  async getExtraction(input: {
    accessToken: string
    documentId: string
    documentVersion: string
    lecturePublicId: string
    publisherSessionToken: string
  }): Promise<PublisherExtraction> {
    const response = await fetch(
      `${baseUrl}/v1/lectures/${input.lecturePublicId}/documents/${input.documentId}/versions/${input.documentVersion}/extraction`,
      {
        cache: 'no-store',
        headers: {
          'X-Compass-Lecture-Token': input.accessToken,
          'X-Compass-Publisher-Token': input.publisherSessionToken,
        },
      },
    )
    const body = await parseResponse<{ extraction: PublisherExtraction }>(
      response,
    )
    return body.extraction
  },
}
