import type { Page, Route } from '@playwright/test'

const adminAuthStorageKey = 'compass-interactive-admin-supabase-auth-v1'
const adminAppSessionStorageKey =
  'compass-interactive-admin-google-app-session-v1'

type StorageEntries = Record<string, string | null>

export type MockGoogleAdminSession = {
  accessToken: string
  appSessionToken: string
  authSession: {
    access_token: string
    expires_at: number
    expires_in: number
    refresh_token: string
    token_type: 'bearer'
    user: Record<string, unknown>
  }
  trackedSession: {
    canUseAi: boolean
    environmentId: string
    expiresAt: string
    id: string
    idleExpiresAt: string
    membershipId: string
    principalId: string
    role: 'instructor' | 'owner'
    stepUpVerifiedAt: string
  }
}

function encodeJwtPart(value: unknown) {
  return Buffer.from(JSON.stringify(value)).toString('base64url')
}

export function createMockGoogleAdminSession(): MockGoogleAdminSession {
  const now = new Date()
  const nowSeconds = Math.floor(now.getTime() / 1_000)
  const authUserId = '730e0000-0000-4000-8000-000000000001'
  const authSessionId = '730e0000-0000-4000-8000-000000000002'
  const factorId = '730e0000-0000-4000-8000-000000000003'
  const environmentId = '730e0000-0000-4000-8000-000000000004'
  const principalId = '730e0000-0000-4000-8000-000000000005'
  const membershipId = '730e0000-0000-4000-8000-000000000006'
  const appSessionId = '730e0000-0000-4000-8000-000000000007'
  const googleSubject = 'phase730e-google-admin'
  const accessToken = [
    encodeJwtPart({ alg: 'HS256', typ: 'JWT' }),
    encodeJwtPart({
      aal: 'aal2',
      amr: [
        { method: 'oauth', timestamp: nowSeconds - 120 },
        { method: 'totp', timestamp: nowSeconds - 60 },
      ],
      aud: 'authenticated',
      exp: nowSeconds + 3_600,
      iat: nowSeconds - 120,
      role: 'authenticated',
      session_id: authSessionId,
      sub: authUserId,
    }),
    'phase730e-google-admin-signature',
  ].join('.')
  const timestamp = now.toISOString()
  const user = {
    app_metadata: { provider: 'google', providers: ['google'] },
    aud: 'authenticated',
    confirmed_at: timestamp,
    created_at: timestamp,
    email: 'phase730e-owner@example.test',
    email_confirmed_at: timestamp,
    factors: [
      {
        created_at: timestamp,
        factor_type: 'totp',
        friendly_name: 'Phase 7.30E test authenticator',
        id: factorId,
        status: 'verified',
        updated_at: timestamp,
      },
    ],
    id: authUserId,
    identities: [
      {
        created_at: timestamp,
        id: googleSubject,
        identity_data: {
          email: 'phase730e-owner@example.test',
          email_verified: true,
          iss: 'https://accounts.google.com',
          sub: googleSubject,
        },
        identity_id: googleSubject,
        last_sign_in_at: timestamp,
        provider: 'google',
        updated_at: timestamp,
        user_id: authUserId,
      },
    ],
    is_anonymous: false,
    role: 'authenticated',
    updated_at: timestamp,
    user_metadata: {
      email: 'phase730e-owner@example.test',
      email_verified: true,
      sub: googleSubject,
    },
  }

  return {
    accessToken,
    appSessionToken: `g1.${'e'.repeat(43)}`,
    authSession: {
      access_token: accessToken,
      expires_at: nowSeconds + 3_600,
      expires_in: 3_600,
      refresh_token: 'phase730e-google-admin-refresh-token',
      token_type: 'bearer',
      user,
    },
    trackedSession: {
      canUseAi: false,
      environmentId,
      expiresAt: new Date(now.getTime() + 8 * 60 * 60_000).toISOString(),
      id: appSessionId,
      idleExpiresAt: new Date(now.getTime() + 30 * 60_000).toISOString(),
      membershipId,
      principalId,
      role: 'owner',
      stepUpVerifiedAt: new Date(now.getTime() - 60_000).toISOString(),
    },
  }
}

export async function installMockGoogleAdminSession(
  page: Page,
  fixture: MockGoogleAdminSession,
  {
    localStorage = {},
    sessionStorage = {},
  }: {
    localStorage?: StorageEntries
    sessionStorage?: StorageEntries
  } = {},
) {
  await page.addInitScript(
    ({ appSessionToken, authSession, localEntries, sessionEntries }) => {
      window.localStorage.setItem(
        'compass-interactive-admin-supabase-auth-v1',
        JSON.stringify(authSession),
      )
      window.sessionStorage.setItem(
        'compass-interactive-admin-google-app-session-v1',
        appSessionToken,
      )
      window.sessionStorage.removeItem(
        'compass-interactive-admin-authenticated',
      )
      window.sessionStorage.removeItem('compass-interactive-admin-token')
      for (const [key, value] of localEntries) {
        if (value === null) window.localStorage.removeItem(key)
        else window.localStorage.setItem(key, value)
      }
      for (const [key, value] of sessionEntries) {
        if (value === null) window.sessionStorage.removeItem(key)
        else window.sessionStorage.setItem(key, value)
      }
    },
    {
      appSessionToken: fixture.appSessionToken,
      authSession: fixture.authSession,
      localEntries: Object.entries(localStorage),
      sessionEntries: Object.entries(sessionStorage),
    },
  )
}

async function fulfillJson(route: Route, body: unknown, status = 200) {
  await route.fulfill({
    body: JSON.stringify(body),
    contentType: 'application/json',
    headers: { 'cache-control': 'no-store' },
    status,
  })
}

export async function fulfillMockGoogleAdminRequest(
  route: Route,
  fixture: MockGoogleAdminSession,
  { identityInvalid = false }: { identityInvalid?: boolean } = {},
) {
  const request = route.request()
  const url = new URL(request.url())
  const authorization = request.headers().authorization ?? ''

  if (
    url.pathname.startsWith('/auth/v1/') &&
    authorization === `Bearer ${fixture.accessToken}`
  ) {
    await fulfillJson(
      route,
      url.pathname === '/auth/v1/user'
        ? fixture.authSession.user
        : fixture.authSession,
    )
    return true
  }

  if (url.pathname === '/functions/v1/admin-identity-session') {
    const body = (request.postDataJSON() ?? {}) as Record<string, unknown>
    if (
      identityInvalid ||
      body.appSessionToken !== fixture.appSessionToken
    ) {
      await fulfillJson(
        route,
        {
          code: 'app_session_invalid',
          message: 'The Google Admin application session is invalid.',
          ok: false,
        },
        401,
      )
      return true
    }
    if (body.action === 'status') {
      await fulfillJson(route, {
        ok: true,
        session: fixture.trackedSession,
      })
      return true
    }
    if (body.action === 'logout') {
      await fulfillJson(route, { ok: true })
      return true
    }
    await fulfillJson(
      route,
      { code: 'request_invalid', message: 'Unexpected action.', ok: false },
      400,
    )
    return true
  }

  return false
}

export function expectMockGoogleAdminCredential(
  body: Record<string, unknown>,
  fixture: MockGoogleAdminSession,
) {
  if (body.appSessionToken !== fixture.appSessionToken) {
    throw new Error('Google Admin app-session credential was not forwarded.')
  }
  if ('adminToken' in body || 'billingGrant' in body || 'billingPin' in body) {
    throw new Error('A retired Admin credential field was forwarded.')
  }
}

export const mockGoogleAdminStorageKeys = {
  appSession: adminAppSessionStorageKey,
  auth: adminAuthStorageKey,
} as const
