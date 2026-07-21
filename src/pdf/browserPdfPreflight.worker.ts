import * as pdfjsLib from 'pdfjs-dist'
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.mjs?url'

const MAX_PDF_BYTES = 15 * 1024 * 1024
const MAX_PDF_PAGES = 75
const MAX_PDF_TEXT_CHARACTERS = 20_000

type PreflightRequest = {
  bytes: ArrayBuffer
  fileName: string
  mimeType: string
}

type PreflightSuccess = {
  ok: true
  result: {
    byteSize: number
    pageCount: number
    pages: Array<{
      characterCount: number
      excerptId: string
      pageNumber: number
      text: string
    }>
    pdfSha256: string
    textCharCount: number
    textSha256: string
  }
  type: 'compass-pdf-preflight-result'
}

type PreflightFailure = {
  error: { code: string; message: string }
  ok: false
  type: 'compass-pdf-preflight-result'
}

type WorkerScope = {
  onmessage: ((event: MessageEvent<PreflightRequest>) => void) | null
  postMessage(message: PreflightFailure | PreflightSuccess): void
}

class PdfPreflightError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.code = code
  }
}

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl

function normalizeExtractedText(
  parts: Array<{ hasEOL?: boolean; str: string }>,
) {
  return parts
    .map((part) => `${part.str}${part.hasEOL ? '\n' : ' '}`)
    .join('')
    .normalize('NFKC')
    .replace(/([\p{L}\p{N}])-\s*\n\s*([\p{L}\p{N}])/gu, '$1$2')
    .replace(/[\t\f\v ]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

async function sha256Hex(value: ArrayBuffer | Uint8Array | string) {
  const digestInput = (() => {
    if (typeof value === 'string') return new TextEncoder().encode(value).buffer
    if (value instanceof ArrayBuffer) return value
    const copy = new Uint8Array(value.byteLength)
    copy.set(value)
    return copy.buffer
  })()
  const digest = await crypto.subtle.digest('SHA-256', digestInput)
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('')
}

async function inspectPdf(input: PreflightRequest) {
  if (!input.fileName.toLowerCase().endsWith('.pdf')) {
    throw new PdfPreflightError(
      'invalid_name',
      'ファイル名の拡張子が.pdfではありません。',
    )
  }
  if (input.mimeType.toLowerCase().split(';', 1)[0]?.trim() !== 'application/pdf') {
    throw new PdfPreflightError(
      'invalid_mime',
      'PDFファイル（application/pdf）を選択してください。',
    )
  }

  const bytes = new Uint8Array(input.bytes)
  if (bytes.byteLength < 5 || bytes.byteLength > MAX_PDF_BYTES) {
    throw new PdfPreflightError(
      'size_limit',
      'PDFは15MB以下にしてください。',
    )
  }
  if (new TextDecoder().decode(bytes.subarray(0, 5)) !== '%PDF-') {
    throw new PdfPreflightError(
      'invalid_magic',
      '選択したファイルは有効なPDFではありません。',
    )
  }

  const pdfSha256 = await sha256Hex(bytes)
  const byteSize = bytes.byteLength
  const loadingTask = pdfjsLib.getDocument({
    data: bytes,
    disableFontFace: true,
    isOffscreenCanvasSupported: false,
    useSystemFonts: false,
    useWasm: false,
    verbosity: 0,
  })

  try {
    const document = await loadingTask.promise
    if (document.numPages < 1 || document.numPages > MAX_PDF_PAGES) {
      throw new PdfPreflightError(
        'page_limit',
        'PDFは75ページ以下にしてください。',
      )
    }

    const pageTexts: string[] = []
    let textCharCount = 0
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber)
      const content = await page.getTextContent({ disableNormalization: false })
      const text = normalizeExtractedText(
        content.items.flatMap((item) =>
          'str' in item ? [{ hasEOL: item.hasEOL, str: item.str }] : [],
        ),
      )
      textCharCount += text.length
      if (textCharCount > MAX_PDF_TEXT_CHARACTERS) {
        throw new PdfPreflightError(
          'text_limit',
          'PDFから読み取る文字数は20,000文字以下にしてください。',
        )
      }
      pageTexts.push(text)
      page.cleanup()
    }

    if (textCharCount < 1) {
      throw new PdfPreflightError(
        'no_text_layer',
        '文字を選択できるPDFを使用してください。画像OCRは行いません。',
      )
    }

    const joinedText = pageTexts
      .map((text, index) => `--- page:${index + 1} ---\n${text}`)
      .join('\n')
    return {
      byteSize,
      pageCount: document.numPages,
      pages: await Promise.all(
        pageTexts.map(async (text, index) => ({
          characterCount: text.length,
          excerptId: await sha256Hex(
            `${pdfSha256}:${index + 1}:${text}`,
          ),
          pageNumber: index + 1,
          text,
        })),
      ),
      pdfSha256,
      textCharCount,
      textSha256: await sha256Hex(joinedText),
    }
  } catch (error) {
    if (error instanceof PdfPreflightError) throw error
    const name = error instanceof Error ? error.name : ''
    const message = error instanceof Error ? error.message.toLowerCase() : ''
    if (name === 'PasswordException' || message.includes('password')) {
      throw new PdfPreflightError(
        'encrypted',
        'パスワードで保護されたPDFは公開できません。',
      )
    }
    throw new PdfPreflightError(
      'corrupt',
      'PDFを読み取れませんでした。破損していないか確認してください。',
    )
  } finally {
    await loadingTask.destroy()
  }
}

const workerScope = self as unknown as WorkerScope
workerScope.onmessage = (event) => {
  void inspectPdf(event.data)
    .then((result) =>
      workerScope.postMessage({
        ok: true,
        result,
        type: 'compass-pdf-preflight-result',
      }),
    )
    .catch((error: unknown) =>
      workerScope.postMessage({
        error: {
          code:
            error instanceof PdfPreflightError ? error.code : 'preflight_failed',
          message:
            error instanceof Error
              ? error.message
              : 'PDFを確認できませんでした。',
        },
        ok: false,
        type: 'compass-pdf-preflight-result',
      }),
    )
}
