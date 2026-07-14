import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'
import {
  MAX_PDF_BYTES,
  MAX_PDF_PAGES,
  MAX_PDF_TEXT_CHARACTERS,
} from '../constants.ts'

export type ExtractedPdfPage = {
  characterCount: number
  excerptId: string
  pageNumber: number
  text: string
}

export type ValidatedPdf = {
  byteSize: number
  pageCount: number
  pages: ExtractedPdfPage[]
  pdfSha256: string
  textCharCount: number
  textSha256: string
}

export class PdfValidationError extends Error {
  readonly code:
    | 'corrupt'
    | 'encrypted'
    | 'invalid_magic'
    | 'invalid_mime'
    | 'invalid_name'
    | 'no_text_layer'
    | 'page_limit'
    | 'size_limit'
    | 'text_limit'

  constructor(
    message: string,
    code:
      | 'corrupt'
      | 'encrypted'
      | 'invalid_magic'
      | 'invalid_mime'
      | 'invalid_name'
      | 'no_text_layer'
      | 'page_limit'
      | 'size_limit'
      | 'text_limit',
  ) {
    super(message)
    this.code = code
  }
}

function sha256(value: Uint8Array | string) {
  return createHash('sha256').update(value).digest('hex')
}

function normalizeExtractedText(
  parts: Array<{ hasEOL?: boolean; str: string }>,
) {
  const joined = parts
    .map((part) => `${part.str}${part.hasEOL ? '\n' : ' '}`)
    .join('')
  return joined
    .normalize('NFKC')
    .replace(/([\p{L}\p{N}])-\s*\n\s*([\p{L}\p{N}])/gu, '$1$2')
    .replace(/[\t\f\v ]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

export async function validatePdf(input: {
  bytes: Uint8Array
  fileName: string
  mimeType: string
}): Promise<ValidatedPdf> {
  const { bytes, fileName, mimeType } = input
  if (!fileName.toLowerCase().endsWith('.pdf')) {
    throw new PdfValidationError(
      'ファイル名の拡張子が.pdfではありません。',
      'invalid_name',
    )
  }
  if (mimeType.toLowerCase().split(';', 1)[0]?.trim() !== 'application/pdf') {
    throw new PdfValidationError(
      'MIME typeはapplication/pdfである必要があります。',
      'invalid_mime',
    )
  }
  if (
    bytes.byteLength < 5 ||
    new TextDecoder().decode(bytes.subarray(0, 5)) !== '%PDF-'
  ) {
    throw new PdfValidationError(
      'PDF magic bytesを確認できません。',
      'invalid_magic',
    )
  }
  if (bytes.byteLength > MAX_PDF_BYTES) {
    throw new PdfValidationError(
      'PDFは合計15MB以下にしてください。',
      'size_limit',
    )
  }

  const pdfSha256 = sha256(bytes)
  const loadingTask = getDocument({
    data: new Uint8Array(bytes),
    disableFontFace: true,
    standardFontDataUrl: fileURLToPath(
      new URL(
        '../../../node_modules/pdfjs-dist/standard_fonts/',
        import.meta.url,
      ),
    ).replaceAll('\\', '/'),
    useSystemFonts: false,
  })

  try {
    const document = await loadingTask.promise
    if (document.numPages > MAX_PDF_PAGES) {
      throw new PdfValidationError(
        'PDFは合計75ページ以下にしてください。',
        'page_limit',
      )
    }

    const pages: ExtractedPdfPage[] = []
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
        throw new PdfValidationError(
          'PDFの抽出文字数は合計20,000文字以下にしてください。',
          'text_limit',
        )
      }
      pages.push({
        characterCount: text.length,
        excerptId: sha256(`${pdfSha256}:${pageNumber}:${text}`),
        pageNumber,
        text,
      })
      page.cleanup()
    }

    if (textCharCount < 1) {
      throw new PdfValidationError(
        'テキストレイヤーがないPDFは公開できません。OCRや画像解析は行いません。',
        'no_text_layer',
      )
    }

    const joinedText = pages
      .map((page) => `--- page:${page.pageNumber} ---\n${page.text}`)
      .join('\n')
    return {
      byteSize: bytes.byteLength,
      pageCount: document.numPages,
      pages,
      pdfSha256,
      textCharCount,
      textSha256: sha256(joinedText),
    }
  } catch (error) {
    if (error instanceof PdfValidationError) {
      throw error
    }
    const name = error instanceof Error ? error.name : ''
    const message = error instanceof Error ? error.message.toLowerCase() : ''
    if (name === 'PasswordException' || message.includes('password')) {
      throw new PdfValidationError(
        '暗号化またはパスワード保護されたPDFは公開できません。',
        'encrypted',
      )
    }
    throw new PdfValidationError(
      'PDFが破損しているか、解析できない形式です。',
      'corrupt',
    )
  } finally {
    await loadingTask.destroy()
  }
}
