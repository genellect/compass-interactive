import { expect, test, type Page, type Route } from '@playwright/test'

test.skip(
  process.env.VITE_PHASE7_30_ADMIN_IDENTITY !== 'false',
  'Phase 7.30 B1 flag-off contract requires its dedicated runner.',
)

function encodeJwtPart(value: unknown) {
  return Buffer.from(JSON.stringify(value)).toString('base64url')
}

function anonymousSessionResponse() {
  const now = new Date().toISOString()
  const nowSeconds = Math.floor(Date.now() / 1_000)
  const id = '73000000-0000-4000-8000-000000000090'
  const user = {
    app_metadata: { provider: 'anonymous', providers: ['anonymous'] },
    aud: 'authenticated',
    created_at: now,
    id,
    is_anonymous: true,
    role: 'authenticated',
    updated_at: now,
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
        sub: id,
      }),
      'phase730-flag-off-signature',
    ].join('.'),
    expires_at: nowSeconds + 3_600,
    expires_in: 3_600,
    refresh_token: 'phase730-flag-off-refresh-token',
    token_type: 'bearer',
    user,
  }
}

async function fulfillJson(route: Route, body: unknown, status = 200) {
  await route.fulfill({
    body: JSON.stringify(body),
    contentType: 'application/json',
    status,
  })
}

async function installFlagOffMocks(page: Page) {
  const requests = {
    anonymous: 0,
    identity: 0,
    pkce: 0,
    unexpected: [] as string[],
  }
  const anonymous = anonymousSessionResponse()

  await page.route('https://example.supabase.co/**', async (route) => {
    const request = route.request()
    const url = new URL(request.url())

    if (url.pathname === '/auth/v1/signup' && request.method() === 'POST') {
      requests.anonymous += 1
      await fulfillJson(route, anonymous)
      return
    }
    if (url.pathname === '/auth/v1/user' && request.method() === 'GET') {
      await fulfillJson(route, anonymous.user)
      return
    }
    if (
      url.pathname === '/auth/v1/token' &&
      url.searchParams.get('grant_type') === 'pkce'
    ) {
      requests.pkce += 1
      await fulfillJson(route, { error: 'PKCE must stay disabled' }, 500)
      return
    }
    if (url.pathname === '/functions/v1/admin-identity-session') {
      requests.identity += 1
      await fulfillJson(route, { code: 'feature_disabled', ok: false }, 503)
      return
    }

    requests.unexpected.push(`${request.method()} ${url.pathname}${url.search}`)
    await fulfillJson(route, { error: 'unexpected request' }, 500)
  })

  return requests
}

test('default OFF preserves the existing numeric Admin PIN surface without invoking Google identity', async ({
  page,
}) => {
  const pageErrors: string[] = []
  page.on('pageerror', (error) => pageErrors.push(error.message))
  const requests = await installFlagOffMocks(page)

  await page.goto('/admin')

  const legacyForm = page.locator('main form.join-card')
  const pin = legacyForm.locator('input[type="password"][inputmode="numeric"]')
  await expect(legacyForm.locator('.eyebrow')).toHaveText('FOR EDUCATORS')
  await expect(legacyForm.getByText('PIN', { exact: true })).toBeVisible()
  await expect(pin).toHaveAttribute('autocomplete', 'off')
  await pin.fill('2468')
  await expect(pin).toHaveValue('2468')
  await expect(legacyForm.locator('button[type="submit"]')).toBeEnabled()

  const adminIdentityStorage = await page.evaluate(() => ({
    appSession: window.sessionStorage.getItem(
      'compass-interactive-admin-google-app-session-v1',
    ),
    auth: window.localStorage.getItem(
      'compass-interactive-admin-supabase-auth-v1',
    ),
    oauthAttempt: window.sessionStorage.getItem(
      'compass-interactive-admin-oauth-attempt-v1',
    ),
  }))
  expect(adminIdentityStorage).toEqual({
    appSession: null,
    auth: null,
    oauthAttempt: null,
  })
  expect(requests.identity).toBe(0)
  expect(requests.pkce).toBe(0)
  expect(requests.anonymous).toBe(0)
  expect(requests.unexpected).toEqual([])
  expect(pageErrors).toEqual([])
})
