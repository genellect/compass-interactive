import { expect, test, type Page, type Route } from '@playwright/test'
import { fileURLToPath } from 'node:url'

const lectureSessionId = '71000000-0000-4000-8000-000000000726'
const publicationId = '70000000-0000-4000-8000-000000000726'
const idempotencyKey = '72000000-0000-4000-8000-000000000726'
const documentId = 'doc-browser-admin-e2e'
const expiresAt = '2099-07-21T00:00:00.000Z'
const samplePdfPath = fileURLToPath(
  new URL('../../public/lecture-assets/m4-sample-v1.pdf', import.meta.url),
)

type PublicationAction = 'finalize' | 'initiate' | 'status'

type MockState = {
  active: boolean
  publicationActions: PublicationAction[]
  uploadCount: number
  uploadedBytes: number
}

function encodeJwtPart(value: unknown) {
  return Buffer.from(JSON.stringify(value)).toString('base64url')
}

function anonymousSessionResponse() {
  const nowSeconds = Math.floor(Date.now() / 1000)
  const user = {
    app_metadata: { provider: 'anonymous', providers: ['anonymous'] },
    aud: 'authenticated',
    confirmed_at: new Date().toISOString(),
    created_at: new Date().toISOString(),
    id: '73000000-0000-4000-8000-000000000726',
    is_anonymous: true,
    role: 'authenticated',
    updated_at: new Date().toISOString(),
    user_metadata: {},
  }
  const accessToken = [
    encodeJwtPart({ alg: 'HS256', typ: 'JWT' }),
    encodeJwtPart({
      aud: 'authenticated',
      exp: nowSeconds + 3600,
      iat: nowSeconds,
      role: 'authenticated',
      sub: user.id,
    }),
    'playwright-signature',
  ].join('.')
  return {
    access_token: accessToken,
    expires_in: 3600,
    refresh_token: 'playwright-refresh-token',
    token_type: 'bearer',
    user,
  }
}

function lectureResponse() {
  const now = new Date()
  return {
    archiveExpiresAt: null,
    closedAt: null,
    closeActorType: null,
    closeReason: null,
    createdAt: new Date(now.getTime() - 60_000).toISOString(),
    endsAt: new Date(now.getTime() + 60 * 60_000).toISOString(),
    hardStopAt: new Date(now.getTime() + 60 * 60_000).toISOString(),
    id: lectureSessionId,
    lectureCode: '285463',
    startsAt: new Date(now.getTime() - 60_000).toISOString(),
    status: 'open',
    title: 'Phase 7.26 browser publication E2E',
    updatedAt: now.toISOString(),
  }
}

function activeDocument() {
  return {
    byteSize: 12_345,
    displayName: 'Browser publication E2E',
    documentId,
    documentVersion: 'a'.repeat(64),
    downloadEnabled: true,
    manifestVersion: 2,
    pageCount: 3,
    pdfSha256: 'a'.repeat(64),
    publishedAt: new Date().toISOString(),
    textCharCount: 2_000,
    textSha256: 'b'.repeat(64),
    visible: true,
  }
}

async function fulfillJson(route: Route, body: unknown, status = 200) {
  await route.fulfill({
    body: JSON.stringify(body),
    contentType: 'application/json',
    status,
  })
}

async function installAdminState(page: Page, recoverPublication: boolean) {
  await page.addInitScript(
    ({ expiresAt, idempotencyKey, lectureSessionId, publicationId, documentId, recoverPublication }) => {
      window.sessionStorage.setItem(
        'compass-interactive-admin-authenticated',
        'true',
      )
      window.sessionStorage.setItem(
        'compass-interactive-admin-token',
        'admin-session-playwright',
      )
      window.localStorage.setItem(
        'compass-interactive-lecture-session-id',
        lectureSessionId,
      )
      window.localStorage.setItem(
        'compass-interactive-lecture-runtime-mode',
        'live',
      )
      window.localStorage.setItem(
        'compass-interactive-lecture-title',
        'Phase 7.26 browser publication E2E',
      )
      window.localStorage.setItem(
        'compass-interactive-lecture-status',
        'open',
      )
      if (recoverPublication) {
        window.sessionStorage.setItem(
          `compass-interactive-browser-pdf-publication-v1:${lectureSessionId}`,
          JSON.stringify({
            documentId,
            expiresAt,
            idempotencyKey,
            lectureSessionId,
            publicationId,
          }),
        )
      }
    },
    {
      documentId,
      expiresAt,
      idempotencyKey,
      lectureSessionId,
      publicationId,
      recoverPublication,
    },
  )
}

async function installNetworkMocks(
  page: Page,
  options: { recoverPublication?: boolean } = {},
) {
  const state: MockState = {
    active: false,
    publicationActions: [],
    uploadCount: 0,
    uploadedBytes: 0,
  }

  await page.route('https://pdf.example/**', async (route) => {
    const request = route.request()
    expect(request.method()).toBe('PUT')
    expect(request.headers().authorization).toBe(
      'Bearer playwright.header.signature',
    )
    expect(request.headers()['content-type']).toBe('application/pdf')
    const bytes = request.postDataBuffer()
    expect(bytes?.subarray(0, 5).toString()).toBe('%PDF-')
    state.uploadCount += 1
    state.uploadedBytes = bytes?.byteLength ?? 0
    await fulfillJson(
      route,
      { ok: true, publicationId, status: 'uploaded' },
      201,
    )
  })

  await page.route('https://example.supabase.co/**', async (route) => {
    const request = route.request()
    const url = new URL(request.url())

    if (url.pathname.startsWith('/auth/v1/')) {
      await fulfillJson(route, anonymousSessionResponse())
      return
    }

    if (!url.pathname.startsWith('/functions/v1/')) {
      await fulfillJson(route, [])
      return
    }

    const functionName = url.pathname.split('/').at(-1)
    const body = (request.postDataJSON() ?? {}) as Record<string, unknown>
    if (functionName === 'manage-lectures') {
      await fulfillJson(route, { lectures: [lectureResponse()], ok: true })
      return
    }
    if (functionName === 'manage-polls') {
      await fulfillJson(route, { hasMore: false, ok: true, polls: [] })
      return
    }
    if (functionName === 'manage-pdf-documents') {
      await fulfillJson(route, {
        documents: state.active ? [activeDocument()] : [],
        ok: true,
      })
      return
    }
    if (functionName === 'manage-pdf-publications') {
      const action = body.action as PublicationAction
      state.publicationActions.push(action)
      if (action === 'initiate') {
        expect(body.lectureSessionId).toBe(lectureSessionId)
        expect(body.byteSize).toBeGreaterThan(5)
        expect(body.pageCount).toBe(3)
        expect(body.pdfSha256).toMatch(/^[0-9a-f]{64}$/)
        expect(body.textSha256).toMatch(/^[0-9a-f]{64}$/)
        await fulfillJson(route, {
          documentId: body.documentId,
          expiresAt,
          ok: true,
          publicationId,
          status: 'pending',
          uploadTicket: 'playwright.header.signature',
          uploadUrl: `https://pdf.example/v2/pdf-publications/${publicationId}`,
        })
        return
      }
      if (action === 'status') {
        await fulfillJson(route, {
          documentId,
          ok: true,
          publicationId,
          status: options.recoverPublication ? 'uploaded' : 'pending',
        })
        return
      }
      if (action === 'finalize') {
        state.active = true
        await fulfillJson(route, {
          documentId,
          ok: true,
          publicationId,
          status: 'active',
        })
        return
      }
    }

    if (functionName === 'operator-live-snapshot') {
      await fulfillJson(route, {
        ok: true,
        result: {
          mode: 'live',
          snapshot: {
            changed: {},
            contract_version: 2,
            server_time: new Date().toISOString(),
            versions: {
              caption: 0,
              comments: 0,
              lecture: 0,
              likes: 0,
              metrics: 0,
              pdf: 0,
              polls: 0,
              summaries: 0,
            },
          },
        },
      })
      return
    }
    await fulfillJson(route, { ok: true })
  })

  return state
}

test('Admin publishes a PDF in-browser and keeps Local Publisher as recovery only', async ({
  page,
}) => {
  await installAdminState(page, false)
  const state = await installNetworkMocks(page)

  await page.goto('/admin')
  const pdfPanel = page.locator('#admin-live .publisher-control-panel')
  await expect(pdfPanel).toBeVisible()

  const recovery = pdfPanel.locator('details.admin-publisher-setup', {
    hasText: 'Local Publisher',
  })
  await expect(recovery).toHaveCount(1)
  await expect(recovery).not.toHaveAttribute('open', '')
  await recovery.locator('summary').click()
  await expect(recovery.locator('input[inputmode="numeric"]')).toHaveAttribute(
    'maxlength',
    '8',
  )

  await pdfPanel.locator('input[type="file"]').setInputFiles(samplePdfPath)
  const publishButton = pdfPanel.locator('button.primary-button')
  await expect(publishButton).toBeEnabled()
  await publishButton.click()

  await expect
    .poll(() => state.publicationActions)
    .toEqual(['initiate', 'finalize'])
  expect(state.uploadCount).toBe(1)
  expect(state.uploadedBytes).toBeGreaterThan(5)
  await expect(
    page.locator(`#admin-live select option[value="${documentId}"]`),
  ).toHaveCount(1)
  await expect
    .poll(() =>
      page.evaluate(
        (lectureId) =>
          window.sessionStorage.getItem(
            `compass-interactive-browser-pdf-publication-v1:${lectureId}`,
          ),
        lectureSessionId,
      ),
    )
    .toBeNull()
})

test('Admin resumes an uploaded publication with status then finalize and no second PUT', async ({
  page,
}) => {
  await installAdminState(page, true)
  const state = await installNetworkMocks(page, { recoverPublication: true })

  await page.goto('/admin')

  await expect
    .poll(() => state.publicationActions.includes('finalize'))
    .toBe(true)
  expect(state.publicationActions[0]).toBe('status')
  expect(state.publicationActions).not.toContain('initiate')
  expect(
    state.publicationActions.every(
      (action) => action === 'status' || action === 'finalize',
    ),
  ).toBe(true)
  expect(state.uploadCount).toBe(0)
  await expect(
    page.locator(
      `#admin-live select option[value="${documentId}"]`,
    ),
  ).toHaveCount(1)
  await expect
    .poll(() =>
      page.evaluate(
        (lectureId) =>
          window.sessionStorage.getItem(
            `compass-interactive-browser-pdf-publication-v1:${lectureId}`,
          ),
        lectureSessionId,
      ),
    )
    .toBeNull()
})
