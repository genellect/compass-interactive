import { expect, test, type Page, type Route } from '@playwright/test'
import {
  createMockGoogleAdminSession,
  expectMockGoogleAdminCredential,
  fulfillMockGoogleAdminRequest,
  installMockGoogleAdminSession,
} from '../helpers/mockGoogleAdminSession.js'

test.skip(
  process.env.VITE_PHASE7_29_POWERPOINT_SYNC !== 'false' ||
    process.env.VITE_PHASE7_30_ADMIN_IDENTITY !== 'true' ||
    process.env.VITE_PHASE7_30_GOOGLE_ADMIN_OPERATIONS !== 'true',
  'The flag-off contract requires Google Admin ON with Presenter sync disabled.',
)

const googleAdmin = createMockGoogleAdminSession()
const lectureSessionId = '72900000-0000-4000-8000-000000000001'
const documentId = 'phase729-presenter-e2e'
const documentVersion = 'a'.repeat(64)
const lecturePublicId = 'phase729-public'
const workerAccessToken = `eyJhbGciOiJIUzI1NiJ9.${'c'.repeat(43)}`

function encodeJwtPart(value: unknown) {
  return Buffer.from(JSON.stringify(value)).toString('base64url')
}

function anonymousSessionResponse() {
  const nowSeconds = Math.floor(Date.now() / 1_000)
  const user = {
    app_metadata: { provider: 'anonymous', providers: ['anonymous'] },
    aud: 'authenticated',
    created_at: new Date().toISOString(),
    id: '72900000-0000-4000-8000-000000000099',
    is_anonymous: true,
    role: 'authenticated',
    updated_at: new Date().toISOString(),
    user_metadata: {},
  }
  return {
    access_token: [
      encodeJwtPart({ alg: 'HS256', typ: 'JWT' }),
      encodeJwtPart({
        aud: 'authenticated',
        exp: nowSeconds + 3_600,
        iat: nowSeconds,
        role: 'authenticated',
        sub: user.id,
      }),
      'playwright-signature',
    ].join('.'),
    expires_in: 3_600,
    refresh_token: 'playwright-refresh-token',
    token_type: 'bearer',
    user,
  }
}

function lectureResponse() {
  const now = Date.now()
  return {
    archiveExpiresAt: null,
    closedAt: null,
    closeActorType: null,
    closeReason: null,
    createdAt: new Date(now - 60_000).toISOString(),
    endsAt: new Date(now + 60 * 60_000).toISOString(),
    hardStopAt: new Date(now + 60 * 60_000).toISOString(),
    id: lectureSessionId,
    lectureCode: '729001',
    startsAt: new Date(now - 60_000).toISOString(),
    status: 'open',
    title: 'Phase 7.29 Presenter flag-off E2E',
    updatedAt: new Date(now).toISOString(),
  }
}

function activeDocument() {
  return {
    byteSize: 3_066,
    displayName: 'Phase 7.29 lecture.pdf',
    documentId,
    documentVersion,
    downloadEnabled: true,
    manifestVersion: 1,
    pageCount: 3,
    pdfSha256: documentVersion,
    publishedAt: new Date().toISOString(),
    textCharCount: 1_024,
    textSha256: 'd'.repeat(64),
    visible: true,
  }
}

function operatorSnapshot() {
  const lecture = lectureResponse()
  return {
    ok: true,
    result: {
      mode: 'live',
      snapshot: {
        changed: {
          lecture: {
            archive_expires_at: null,
            closed_at: null,
            close_reason: null,
            ends_at: lecture.endsAt,
            hard_stop_at: lecture.hardStopAt,
            lecture_session_id: lectureSessionId,
            starts_at: lecture.startsAt,
            status: 'open',
            title: lecture.title,
          },
          pdf: {
            current_pdf_page: 1,
            display_mode: 'normal',
            lecture_session_id: lectureSessionId,
            pdf_document_id: documentId,
            pdf_document_version: documentVersion,
            pdf_manifest_version: 1,
            pdf_page_count: 3,
            pdf_visible: true,
            updated_at: new Date().toISOString(),
          },
        },
        contract_version: 2,
        server_time: new Date().toISOString(),
        versions: {
          caption: 0,
          comments: 0,
          lecture: 1,
          likes: 0,
          metrics: 0,
          pdf: 1,
          polls: 0,
          summaries: 0,
        },
      },
    },
  }
}

async function fulfillJson(route: Route, body: unknown, status = 200) {
  await route.fulfill({
    body: JSON.stringify(body),
    contentType: 'application/json',
    status,
  })
}

async function installAdminState(page: Page) {
  await installMockGoogleAdminSession(page, googleAdmin, {
    localStorage: {
      'compass-interactive-lecture-runtime-mode': 'live',
      'compass-interactive-lecture-session-id': lectureSessionId,
      'compass-interactive-lecture-status': 'open',
      'compass-interactive-lecture-title': 'Phase 7.29 Presenter flag-off E2E',
    },
  })
}

async function installNetworkMocks(page: Page) {
  const presenterRequests: string[] = []
  const appBaseUrl = process.env.PLAYWRIGHT_BASE_URL
  if (!appBaseUrl) throw new Error('PLAYWRIGHT_BASE_URL is required.')

  await page.route('http://127.0.0.1:43123/**', async (route) => {
    await fulfillJson(route, {
      ok: true,
      service: 'compass-pdf-publisher',
      version: 1,
    })
  })
  await page.route('http://127.0.0.1:43124/**', async (route) => {
    const request = route.request()
    presenterRequests.push(`${request.method()} ${request.url()}`)
    await fulfillJson(route, {
      ok: true,
      protocolVersion: 1,
      service: 'compass-presenter-bridge',
    })
  })
  await page.route('https://pdf.example/**', async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    expect(request.headers().authorization).toBe(`Bearer ${workerAccessToken}`)
    if (url.pathname.endsWith('/manifest')) {
      await fulfillJson(route, {
        access_version: 1,
        documents: [
          {
            archive_expires_at: null,
            byte_size: 3_066,
            delete_after: null,
            display_name: 'Phase 7.29 lecture.pdf',
            document_id: documentId,
            document_version: documentVersion,
            download_enabled: true,
            page_count: 3,
            text_char_count: 1_024,
            visible: true,
          },
        ],
        lecture_public_id: lecturePublicId,
        manifest_version: 1,
        schema_version: 1,
        updated_at: new Date().toISOString(),
      })
      return
    }
    if (url.pathname.endsWith('/access')) {
      await fulfillJson(route, {
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        url: `${appBaseUrl}/lecture-assets/m4-sample-v1.pdf`,
      })
      return
    }
    await fulfillJson(route, { message: 'Not found.' }, 404)
  })

  await page.route('https://example.supabase.co/**', async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    if (await fulfillMockGoogleAdminRequest(route, googleAdmin)) return
    if (url.pathname.startsWith('/auth/v1/')) {
      await fulfillJson(route, anonymousSessionResponse())
      return
    }
    if (!url.pathname.startsWith('/functions/v1/')) {
      await fulfillJson(route, [])
      return
    }

    const functionName = url.pathname.split('/').at(-1) ?? ''
    const body = (request.postDataJSON() ?? {}) as Record<string, unknown>
    if (functionName !== 'lecture-live-snapshot') {
      expectMockGoogleAdminCredential(body, googleAdmin)
    }
    if (functionName === 'manage-lectures') {
      await fulfillJson(route, { lectures: [lectureResponse()], ok: true })
      return
    }
    if (functionName === 'manage-polls') {
      await fulfillJson(route, { hasMore: false, ok: true, polls: [] })
      return
    }
    if (functionName === 'manage-pdf-documents') {
      await fulfillJson(route, { documents: [activeDocument()], ok: true })
      return
    }
    if (
      functionName === 'operator-live-snapshot' ||
      functionName === 'lecture-live-snapshot'
    ) {
      await fulfillJson(route, operatorSnapshot())
      return
    }
    if (functionName === 'issue-pdf-access-token') {
      await fulfillJson(route, {
        accessToken: workerAccessToken,
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        lecturePublicId,
        manifestVersion: 1,
        ok: true,
        workerBaseUrl: 'https://pdf.example',
      })
      return
    }
    if (functionName === 'manage-presenter-connection') {
      presenterRequests.push(`${request.method()} ${url.pathname}`)
      await fulfillJson(route, { connection: null, ok: true })
      return
    }
    await fulfillJson(route, { ok: true })
  })

  return presenterRequests
}

test('flag OFF keeps Google Admin manual PDF controls without Presenter or loopback calls', async ({
  page,
}) => {
  const pageErrors: string[] = []
  page.on('pageerror', (error) => pageErrors.push(error.message))
  await installAdminState(page)
  const presenterRequests = await installNetworkMocks(page)

  await page.goto('/admin')

  await expect(page.locator('#admin-live')).toBeVisible()
  const settingsLink = page.getByRole('link', {
    name: '教員管理',
    exact: true,
  })
  await expect(settingsLink).toBeVisible()
  await expect(settingsLink).toHaveAttribute('href', '/admin/settings')
  await expect(settingsLink).toHaveAttribute('target', '_blank')
  await expect(page.locator('.admin-identity-card')).toHaveCount(0)
  await expect
    .poll(() =>
      page.evaluate(() => ({
        legacyAuthenticated: window.sessionStorage.getItem(
          'compass-interactive-admin-authenticated',
        ),
        legacyToken: window.sessionStorage.getItem(
          'compass-interactive-admin-token',
        ),
      })),
    )
    .toEqual({ legacyAuthenticated: null, legacyToken: null })
  await expect(page.getByTestId('powerpoint-sync-control')).toHaveCount(0)
  const pageControls = page.locator(
    '#admin-live [aria-label="講義資料のページ操作"]',
  )
  await expect(pageControls).toBeVisible()
  await expect(
    pageControls.getByRole('button', { name: '次へ →' }),
  ).toBeEnabled()
  await expect(pageControls.getByLabel('表示するページ番号')).toBeEnabled()
  await expect(page.locator('#admin-live .pdf-document-control')).toBeVisible()
  await expect(page.getByLabel('PDF資料')).toBeEnabled()
  await page.waitForTimeout(250)
  expect(presenterRequests).toEqual([])
  expect(pageErrors).toEqual([])
})
