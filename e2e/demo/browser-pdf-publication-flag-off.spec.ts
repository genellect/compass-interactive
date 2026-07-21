import { expect, test, type Route } from '@playwright/test'

test.skip(
  process.env.VITE_PHASE3_PRIVATE_PDF !== 'true' ||
    process.env.VITE_PHASE7_26_BROWSER_PDF_PUBLISHING !== 'false',
  'The flag-off contract requires private PDF support with Phase 7.26 disabled.',
)

const lectureSessionId = '74000000-0000-4000-8000-000000000726'

function encodeJwtPart(value: unknown) {
  return Buffer.from(JSON.stringify(value)).toString('base64url')
}

function anonymousSessionResponse() {
  const nowSeconds = Math.floor(Date.now() / 1000)
  const userId = '75000000-0000-4000-8000-000000000726'
  return {
    access_token: [
      encodeJwtPart({ alg: 'HS256', typ: 'JWT' }),
      encodeJwtPart({
        aud: 'authenticated',
        exp: nowSeconds + 3600,
        iat: nowSeconds,
        role: 'authenticated',
        sub: userId,
      }),
      'playwright-signature',
    ].join('.'),
    expires_in: 3600,
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

async function fulfillJson(route: Route, body: unknown) {
  await route.fulfill({
    body: JSON.stringify(body),
    contentType: 'application/json',
    status: 200,
  })
}

test('Phase 7.26 flag OFF keeps Local Publisher and performs no publication discovery', async ({
  page,
}) => {
  let publicationCalls = 0
  await page.addInitScript((lectureId) => {
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
      lectureId,
    )
    window.localStorage.setItem(
      'compass-interactive-lecture-runtime-mode',
      'live',
    )
    window.localStorage.setItem(
      'compass-interactive-lecture-title',
      'Phase 7.26 flag-off E2E',
    )
    window.localStorage.setItem('compass-interactive-lecture-status', 'open')
  }, lectureSessionId)

  await page.route('https://example.supabase.co/**', async (route) => {
    const url = new URL(route.request().url())
    if (url.pathname.startsWith('/auth/v1/')) {
      await fulfillJson(route, anonymousSessionResponse())
      return
    }
    const functionName = url.pathname.split('/').at(-1)
    if (functionName === 'manage-pdf-publications') {
      publicationCalls += 1
      await fulfillJson(route, { found: false, ok: true })
      return
    }
    if (functionName === 'manage-lectures') {
      await fulfillJson(route, { lectures: [], ok: true })
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

  await page.goto('/admin')
  await expect(page.getByText('初回接続の設定')).toBeVisible()
  await expect(page.getByText('復旧・互換オプション')).toHaveCount(0)
  await expect(page.locator('#admin-live input[inputmode="numeric"]')).toHaveAttribute(
    'maxlength',
    '8',
  )
  await expect(
    page.locator('#admin-live button.primary-button', {
      hasText: '学生に講義資料を公開する',
    }),
  ).toHaveCount(1)
  await page.waitForTimeout(1_000)
  expect(publicationCalls).toBe(0)
})
