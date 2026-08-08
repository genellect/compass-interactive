import { expect, test, type Page, type Route } from '@playwright/test'

test.skip(
  process.env.VITE_PHASE7_29_POWERPOINT_SYNC !== 'false',
  'Phase 7.29 flag-off contract requires its dedicated runner.',
)

const adminToken = 'admin-session-playwright-phase729-off-123456'
const lectureSessionId = '72900000-0000-4000-8000-000000000011'
const documentId = 'phase729-presenter-off-e2e'
const documentVersion = 'a'.repeat(64)

function encodeJwtPart(value: unknown) {
  return Buffer.from(JSON.stringify(value)).toString('base64url')
}

function anonymousSessionResponse() {
  const nowSeconds = Math.floor(Date.now() / 1_000)
  const userId = '72900000-0000-4000-8000-000000000099'
  return {
    access_token: [
      encodeJwtPart({ alg: 'HS256', typ: 'JWT' }),
      encodeJwtPart({
        aud: 'authenticated',
        exp: nowSeconds + 3_600,
        iat: nowSeconds,
        role: 'authenticated',
        sub: userId,
      }),
      'playwright-signature',
    ].join('.'),
    expires_in: 3_600,
    refresh_token: 'playwright-refresh-token',
    token_type: 'bearer',
    user: {
      app_metadata: { provider: 'anonymous', providers: ['anonymous'] },
      aud: 'authenticated',
      created_at: new Date().toISOString(),
      id: userId,
      is_anonymous: true,
      role: 'authenticated',
      updated_at: new Date().toISOString(),
      user_metadata: {},
    },
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
    lectureCode: '729011',
    startsAt: new Date(now - 60_000).toISOString(),
    status: 'open',
    title: 'Phase 7.29 flag-off E2E',
    updatedAt: new Date(now).toISOString(),
  }
}

async function fulfillJson(route: Route, body: unknown) {
  await route.fulfill({
    body: JSON.stringify(body),
    contentType: 'application/json',
    status: 200,
  })
}

async function installAdminState(page: Page) {
  await page.addInitScript(
    ({ adminToken, lectureSessionId }) => {
      window.sessionStorage.setItem(
        'compass-interactive-admin-authenticated',
        'true',
      )
      window.sessionStorage.setItem(
        'compass-interactive-admin-token',
        adminToken,
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
        'Phase 7.29 flag-off E2E',
      )
      window.localStorage.setItem('compass-interactive-lecture-status', 'open')
    },
    { adminToken, lectureSessionId },
  )
}

test('flag OFF performs no loopback or Presenter Edge call and preserves manual controls', async ({
  page,
}) => {
  let presenterEdgeCalls = 0
  const loopbackRequests: string[] = []
  page.on('request', (request) => {
    if (request.url().startsWith('http://127.0.0.1:43124/')) {
      loopbackRequests.push(request.url())
    }
  })
  await installAdminState(page)

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

    const functionName = url.pathname.split('/').at(-1) ?? ''
    if (functionName === 'manage-presenter-connection') {
      presenterEdgeCalls += 1
      await fulfillJson(route, { ok: false })
      return
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
      await fulfillJson(route, {
        documents: [
          {
            byteSize: 3_066,
            displayName: 'Phase 7.29 flag-off lecture.pdf',
            documentId,
            documentVersion,
            downloadEnabled: true,
            manifestVersion: 1,
            pageCount: 3,
            pdfSha256: documentVersion,
            publishedAt: new Date().toISOString(),
            textCharCount: 1_024,
            textSha256: 'b'.repeat(64),
            visible: true,
          },
        ],
        ok: true,
      })
      return
    }
    if (
      functionName === 'operator-live-snapshot' ||
      functionName === 'lecture-live-snapshot'
    ) {
      const lecture = lectureResponse()
      await fulfillJson(route, {
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
      })
      return
    }
    await fulfillJson(route, { ok: true })
  })

  await page.goto('/admin')
  const pdfPanel = page.locator('#admin-live')
  await expect(pdfPanel.getByRole('button', { name: '次へ →' })).toBeEnabled()
  await expect(pdfPanel.getByLabel('表示するページ番号')).toBeEnabled()
  await expect(pdfPanel.getByLabel('PDF資料')).toBeEnabled()
  await expect(page.getByTestId('powerpoint-sync-control')).toHaveCount(0)
  await expect(
    page.getByRole('button', { name: 'PowerPointと同期' }),
  ).toHaveCount(0)

  await page.waitForTimeout(500)
  expect(loopbackRequests).toEqual([])
  expect(presenterEdgeCalls).toBe(0)
})
