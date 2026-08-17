import { expect, test, type Page, type Route } from '@playwright/test'
import {
  createMockGoogleAdminSession,
  expectMockGoogleAdminCredential,
  fulfillMockGoogleAdminRequest,
  installMockGoogleAdminSession,
} from '../helpers/mockGoogleAdminSession.js'

test.skip(
  process.env.VITE_PHASE3_PRIVATE_PDF !== 'true' ||
    process.env.VITE_PHASE7_26_BROWSER_PDF_PUBLISHING !== 'false' ||
    process.env.VITE_PHASE7_30_ADMIN_IDENTITY !== 'true' ||
    process.env.VITE_PHASE7_30_GOOGLE_ADMIN_OPERATIONS !== 'true',
  'The flag-off contract requires the Google Admin workspace with browser PDF publication disabled.',
)

const lectureSessionId = '71000000-0000-4000-8000-000000000726'
const googleAdmin = createMockGoogleAdminSession()

function encodeJwtPart(value: unknown) {
  return Buffer.from(JSON.stringify(value)).toString('base64url')
}

function anonymousSessionResponse() {
  const nowSeconds = Math.floor(Date.now() / 1_000)
  const user = {
    app_metadata: { provider: 'anonymous', providers: ['anonymous'] },
    aud: 'authenticated',
    created_at: new Date().toISOString(),
    id: '73000000-0000-4000-8000-000000000726',
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
    lectureCode: '285463',
    startsAt: new Date(now - 60_000).toISOString(),
    status: 'open',
    title: 'Phase 7.26 browser publication flag-off E2E',
    updatedAt: new Date(now).toISOString(),
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
      'compass-interactive-lecture-title':
        'Phase 7.26 browser publication flag-off E2E',
    },
  })
}

async function installNetworkMocks(page: Page) {
  const publicationCalls: string[] = []

  await page.route('http://127.0.0.1:43123/**', async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    if (url.pathname !== '/v1/health') {
      publicationCalls.push(`${request.method()} ${url.pathname}`)
    }
    await fulfillJson(route, {
      ok: true,
      service: 'compass-pdf-publisher',
      version: 1,
    })
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
    expectMockGoogleAdminCredential(body, googleAdmin)
    if (functionName === 'manage-lectures') {
      await fulfillJson(route, { lectures: [lectureResponse()], ok: true })
      return
    }
    if (functionName === 'manage-polls') {
      await fulfillJson(route, { hasMore: false, ok: true, polls: [] })
      return
    }
    if (functionName === 'manage-pdf-documents') {
      await fulfillJson(route, { documents: [], ok: true })
      return
    }
    if (functionName === 'manage-pdf-publications') {
      publicationCalls.push(`${request.method()} ${url.pathname}`)
      await fulfillJson(route, { found: false, ok: true })
      return
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

  return publicationCalls
}

test('flag OFF keeps Google Admin and manual Publisher controls without browser publication calls', async ({
  page,
}) => {
  const pageErrors: string[] = []
  page.on('pageerror', (error) => pageErrors.push(error.message))
  await installAdminState(page)
  const publicationCalls = await installNetworkMocks(page)

  await page.goto('/admin')

  await expect(page.locator('#admin-live')).toBeVisible()
  const settingsLink = page.getByRole('link', {
    name: '管理者設定',
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
  const pdfPanel = page.locator('#admin-live .publisher-control-panel')
  await expect(pdfPanel).toBeVisible()
  await expect(pdfPanel.getByText('初回接続の設定')).toBeVisible()
  await pdfPanel.getByText('初回接続の設定').click()
  await expect(pdfPanel.getByLabel('教員PCに表示された8桁コード')).toBeVisible()
  await expect(pdfPanel.locator('input[type="file"]')).toBeVisible()
  await expect(
    pdfPanel.getByRole('button', { name: '学生に講義資料を公開する' }),
  ).toBeDisabled()
  await expect(page.locator('#admin-live .pdf-document-control')).toBeVisible()
  await page.waitForTimeout(250)
  expect(publicationCalls).toEqual([])
  expect(pageErrors).toEqual([])
})
