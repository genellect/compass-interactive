export const BROWSER_PDF_MAX_BYTES = 15 * 1024 * 1024
export const BROWSER_PDF_PREFLIGHT_TIMEOUT_MS = 60_000

export type BrowserPdfPreflightResult = {
  byteSize: number
  pageCount: number
  pages: Array<{
    characterCount: number
    excerptId: string
    pageNumber: number
    text: string
  }>
  pdfSha256: string
  textAvailable: boolean
  textCharCount: number
  textSha256: string
  textTruncated: boolean
}

type WorkerResponse =
  | {
      ok: true
      result: BrowserPdfPreflightResult
      type: 'compass-pdf-preflight-result'
    }
  | {
      error: { code: string; message: string }
      ok: false
      type: 'compass-pdf-preflight-result'
    }

export class BrowserPdfPreflightError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'BrowserPdfPreflightError'
    this.code = code
  }
}

function validateFileEnvelope(file: File) {
  if (!file.name.toLowerCase().endsWith('.pdf')) {
    throw new BrowserPdfPreflightError(
      'invalid_name',
      'ファイル名の拡張子が.pdfではありません。',
    )
  }
  const mimeType = file.type.toLowerCase().split(';', 1)[0]?.trim()
  if (mimeType && mimeType !== 'application/pdf') {
    throw new BrowserPdfPreflightError(
      'invalid_mime',
      'PDFファイル（application/pdf）を選択してください。',
    )
  }
  if (file.size < 5 || file.size > BROWSER_PDF_MAX_BYTES) {
    throw new BrowserPdfPreflightError(
      'size_limit',
      'PDFは15MB以下にしてください。',
    )
  }
}

export async function preflightBrowserPdf(
  file: File,
): Promise<BrowserPdfPreflightResult> {
  validateFileEnvelope(file)
  const worker = new Worker(
    new URL('./browserPdfPreflight.worker.ts', import.meta.url),
    { name: 'compass-pdf-preflight', type: 'module' },
  )

  try {
    const bytes = await file.arrayBuffer()
    return await new Promise<BrowserPdfPreflightResult>((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        reject(
          new BrowserPdfPreflightError(
            'timeout',
            'PDFの確認に時間がかかっています。資料を圧縮して再度お試しください。',
          ),
        )
      }, BROWSER_PDF_PREFLIGHT_TIMEOUT_MS)

      worker.onerror = () => {
        window.clearTimeout(timeout)
        reject(
          new BrowserPdfPreflightError(
            'worker_failed',
            'PDFの確認処理を開始できませんでした。',
          ),
        )
      }
      worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
        if (event.data?.type !== 'compass-pdf-preflight-result') return
        window.clearTimeout(timeout)
        if (event.data.ok) {
          resolve(event.data.result)
          return
        }
        reject(
          new BrowserPdfPreflightError(
            event.data.error.code,
            event.data.error.message,
          ),
        )
      }
      worker.postMessage({ bytes, fileName: file.name, mimeType: file.type }, [
        bytes,
      ])
    })
  } finally {
    worker.terminate()
  }
}
