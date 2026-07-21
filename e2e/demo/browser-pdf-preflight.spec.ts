import { expect, test } from '@playwright/test'

type PreflightResult = {
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

test('browser PDF preflight keeps verified extraction available only in memory', async ({
  page,
}) => {
  await page.goto('/demo')
  const { expectedPdfSha256, result } = await page.evaluate(async (moduleUrl) => {
    const module = (await import(moduleUrl)) as {
      preflightBrowserPdf(file: File): Promise<PreflightResult>
    }
    const response = await fetch('/lecture-assets/m4-sample-v1.pdf')
    const bytes = await response.arrayBuffer()
    const file = new File([bytes], 'm4-sample-v1.pdf', {
      type: 'application/pdf',
    })
    const digest = await crypto.subtle.digest('SHA-256', bytes.slice(0))
    const expectedPdfSha256 = Array.from(new Uint8Array(digest), (byte) =>
      byte.toString(16).padStart(2, '0'),
    ).join('')
    return {
      expectedPdfSha256,
      result: await module.preflightBrowserPdf(file),
    }
  }, '/src/pdf/browserPdfPreflight.ts')

  expect(result.byteSize).toBeGreaterThan(5)
  expect(result.pageCount).toBe(3)
  expect(result.textCharCount).toBeGreaterThan(0)
  expect(result.pdfSha256).toMatch(/^[0-9a-f]{64}$/)
  expect(result.pdfSha256).toBe(expectedPdfSha256)
  expect(result.textSha256).toMatch(/^[0-9a-f]{64}$/)
  expect(result.pages).toHaveLength(3)
  expect(result.pages[0]).toMatchObject({ pageNumber: 1 })
  expect(result.pages[0]?.excerptId).toMatch(/^[0-9a-f]{64}$/)
  expect(result).not.toHaveProperty('text')
})

test('browser PDF preflight rejects non-PDF bytes', async ({ page }) => {
  await page.goto('/demo')
  const error = await page.evaluate(async (moduleUrl) => {
    const module = (await import(moduleUrl)) as {
      preflightBrowserPdf(file: File): Promise<PreflightResult>
    }
    const file = new File([new TextEncoder().encode('not-a-pdf')], 'fake.pdf', {
      type: 'application/pdf',
    })
    try {
      await module.preflightBrowserPdf(file)
      return null
    } catch (caught) {
      return {
        code:
          caught && typeof caught === 'object' && 'code' in caught
            ? String(caught.code)
            : '',
        message: caught instanceof Error ? caught.message : '',
      }
    }
  }, '/src/pdf/browserPdfPreflight.ts')

  expect(error).toEqual({
    code: 'invalid_magic',
    message: '選択したファイルは有効なPDFではありません。',
  })
})

test('browser publication PUT keeps the ticket in memory and verifies the response binding', async ({
  page,
}) => {
  await page.goto('/demo')
  const result = await page.evaluate(async (moduleUrl) => {
    const module = (await import(moduleUrl)) as {
      browserPdfPublicationClient: {
        upload(
          handle: Record<string, boolean | string>,
          file: File,
        ): Promise<{ publicationId?: string; status?: string }>
      }
      forgetBrowserPdfPublication(lectureSessionId: string): void
      rememberBrowserPdfPublication(
        handle: Record<string, boolean | string>,
      ): void
    }
    const publicationId = '70000000-0000-4000-8000-000000000726'
    const lectureSessionId = '71000000-0000-4000-8000-000000000726'
    const uploadTicket = 'header.payload.signature'
    const handle = {
      documentId: 'doc-browser-e2e',
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      idempotencyKey: '72000000-0000-4000-8000-000000000726',
      lectureSessionId,
      publicationId,
      uploadRequired: true,
      uploadTicket,
      uploadUrl: `https://pdf.example/v2/pdf-publications/${publicationId}`,
    }
    let authorization: string | null = null
    let contentLength: string | null = null
    let contentType: string | null = null
    let method = ''
    const originalFetch = window.fetch
    window.fetch = async (_input, init) => {
      const headers = new Headers(init?.headers)
      authorization = headers.get('Authorization')
      contentLength = headers.get('Content-Length')
      contentType = headers.get('Content-Type')
      method = init?.method ?? ''
      return new Response(
        JSON.stringify({ ok: true, publicationId, status: 'uploaded' }),
        { headers: { 'Content-Type': 'application/json' }, status: 201 },
      )
    }
    try {
      const response = await module.browserPdfPublicationClient.upload(
        handle,
        new File(['%PDF-test'], 'test.pdf', { type: 'application/pdf' }),
      )
      module.rememberBrowserPdfPublication(handle)
      const stored = window.sessionStorage.getItem(
        `compass-interactive-browser-pdf-publication-v1:${lectureSessionId}`,
      )
      module.forgetBrowserPdfPublication(lectureSessionId)
      return {
        authorization,
        contentLength,
        contentType,
        method,
        response,
        stored,
      }
    } finally {
      window.fetch = originalFetch
    }
  }, '/src/pdf/browserPdfPublicationClient.ts')

  expect(result.method).toBe('PUT')
  expect(result.authorization).toBe('Bearer header.payload.signature')
  expect(result.contentType).toBe('application/pdf')
  expect(result.contentLength).toBeNull()
  expect(result.response).toMatchObject({
    publicationId: '70000000-0000-4000-8000-000000000726',
    status: 'uploaded',
  })
  expect(result.stored).not.toContain('header.payload.signature')
  expect(result.stored).not.toContain('pdf.example')
})
