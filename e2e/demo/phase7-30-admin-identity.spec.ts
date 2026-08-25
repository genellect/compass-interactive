import { expect, test, type Page, type Route } from '@playwright/test'

test.skip(
  process.env.VITE_PHASE7_30_ADMIN_IDENTITY !== 'true',
  'Phase 7.30 B1 Admin identity requires its dedicated flag-on runner.',
)

const adminAuthStorageKey = 'compass-interactive-admin-supabase-auth-v1'
const adminAppSessionStorageKey =
  'compass-interactive-admin-google-app-session-v1'
const adminAppSessionRestoreSeedStorageKey =
  'compass-interactive-admin-google-app-session-restore-seed-v1'
const adminOAuthAttemptStorageKey = 'compass-interactive-admin-oauth-attempt-v1'
const studentAuthStorageKey = 'sb-example-auth-token'
const studentStorageSentinelKey = 'compass-phase730-student-sentinel'
const studentSessionSentinelKey = 'compass-phase730-student-session-sentinel'
const callbackCode = 'phase730-playwright-google-code'
const factorId = '73000000-0000-4000-8000-000000000003'
const abandonedFactorId = '73000000-0000-4000-8000-000000000006'
const challengeId = '73000000-0000-4000-8000-000000000004'
const appSessionToken = `g1.${'a'.repeat(43)}`
const restoreSeed = 'b'.repeat(43)
const studentParticipantId = '73000000-0000-4000-8000-000000000099'
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

type EdgeCall = {
  action: string
  authorization: string
  body: Record<string, unknown>
}

type MockState = {
  anonymousRequests: number
  authorizeQueries: Record<string, string>[]
  authRequests: Array<{
    authorization: string
    method: string
    pathname: string
    search: string
  }>
  edgeCalls: EdgeCall[]
  factorChallengeBodies: Record<string, unknown>[]
  factorVerifyBodies: Record<string, unknown>[]
  ledgerCalls: EdgeCall[]
  lectureCalls: EdgeCall[]
  pkceBodies: Record<string, unknown>[]
  unexpectedRequests: string[]
  verified: boolean
}

type BroadcastCaptureWindow = Window & {
  __phase730AdminAuthBroadcasts?: string[]
}

function encodeJwtPart(value: unknown) {
  return Buffer.from(JSON.stringify(value)).toString('base64url')
}

function sessionJwt(aal: 'aal1' | 'aal2', subject: string) {
  const nowSeconds = Math.floor(Date.now() / 1_000)
  const methods =
    aal === 'aal2'
      ? [
          { method: 'oauth', timestamp: nowSeconds - 60 },
          { method: 'totp', timestamp: nowSeconds },
        ]
      : [{ method: 'oauth', timestamp: nowSeconds - 60 }]
  return [
    encodeJwtPart({ alg: 'HS256', typ: 'JWT' }),
    encodeJwtPart({
      aal,
      amr: methods,
      aud: 'authenticated',
      exp: nowSeconds + 3_600,
      iat: nowSeconds - 60,
      role: 'authenticated',
      session_id: '73000000-0000-4000-8000-000000000002',
      sub: subject,
    }),
    'phase730-playwright-signature',
  ].join('.')
}

function factor(status: 'unverified' | 'verified', id = factorId) {
  const now = new Date().toISOString()
  return {
    created_at: now,
    factor_type: 'totp',
    friendly_name: 'COMPASS Interactive Admin',
    id,
    status,
    updated_at: now,
  }
}

function googleUser(verified: boolean, includeAbandonedFactor = false) {
  const now = new Date().toISOString()
  const id = '73000000-0000-4000-8000-000000000001'
  const googleSubject = 'phase730-google-subject'
  return {
    app_metadata: { provider: 'google', providers: ['google'] },
    aud: 'authenticated',
    confirmed_at: now,
    created_at: now,
    email: 'educator@example.test',
    email_confirmed_at: now,
    factors: verified
      ? [
          factor('verified'),
          ...(includeAbandonedFactor
            ? [factor('unverified', abandonedFactorId)]
            : []),
        ]
      : [],
    id,
    identities: [
      {
        created_at: now,
        id: googleSubject,
        identity_data: {
          email: 'educator@example.test',
          email_verified: true,
          iss: 'https://accounts.google.com',
          sub: googleSubject,
        },
        identity_id: '73000000-0000-4000-8000-000000000005',
        last_sign_in_at: now,
        provider: 'google',
        updated_at: now,
        user_id: id,
      },
    ],
    is_anonymous: false,
    role: 'authenticated',
    updated_at: now,
    user_metadata: {
      email: 'educator@example.test',
      email_verified: true,
      sub: googleSubject,
    },
  }
}

function authSession(
  aal: 'aal1' | 'aal2',
  options: { includeAbandonedFactor?: boolean; verified?: boolean } = {},
) {
  const user = googleUser(
    options.verified ?? aal === 'aal2',
    options.includeAbandonedFactor,
  )
  const nowSeconds = Math.floor(Date.now() / 1_000)
  return {
    access_token: sessionJwt(aal, user.id),
    expires_at: nowSeconds + 3_600,
    expires_in: 3_600,
    refresh_token: `phase730-${aal}-refresh-token`,
    token_type: 'bearer',
    user,
  }
}

function anonymousStudentSession() {
  const now = new Date().toISOString()
  const nowSeconds = Math.floor(Date.now() / 1_000)
  const id = '73000000-0000-4000-8000-000000000099'
  const accessToken = [
    encodeJwtPart({ alg: 'HS256', typ: 'JWT' }),
    encodeJwtPart({
      aud: 'authenticated',
      exp: nowSeconds + 3_600,
      iat: nowSeconds - 60,
      role: 'authenticated',
      sub: id,
    }),
    'phase730-student-signature',
  ].join('.')
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
    accessToken,
    storageValue: JSON.stringify({
      access_token: accessToken,
      expires_at: nowSeconds + 3_600,
      expires_in: 3_600,
      refresh_token: 'phase730-student-refresh-token',
      token_type: 'bearer',
      user,
    }),
  }
}

function trackedSession() {
  const now = Date.now()
  const expiresAt = new Date(now + 8 * 60 * 60_000).toISOString()
  return {
    canUseAi: true,
    environmentId: '73000000-0000-4000-8000-000000000010',
    expiresAt,
    id: '73000000-0000-4000-8000-000000000011',
    idleExpiresAt: expiresAt,
    membershipId: '73000000-0000-4000-8000-000000000012',
    principalId: '73000000-0000-4000-8000-000000000013',
    role: 'owner',
    stepUpVerifiedAt: new Date(now).toISOString(),
  }
}

function ledgerSnapshot() {
  const session = trackedSession()
  const now = new Date().toISOString()
  return {
    currentMembershipId: session.membershipId,
    currentPrincipalId: session.principalId,
    currentSessionId: session.id,
    environmentId: session.environmentId,
    environmentKind: 'staging',
    invitations: [],
    ledgerAdmissionEnabled: false,
    memberships: [
      {
        canUseAi: true,
        createdAt: now,
        displayName: 'Current Owner',
        expiresAt: null,
        membershipId: session.membershipId,
        normalizedEmail: 'educator@example.test',
        principalId: session.principalId,
        principalStatus: 'active',
        role: 'owner',
        status: 'active',
        statusReason: null,
        updatedAt: now,
      },
    ],
    ok: true,
    ownerships: [],
    sessions: [
      {
        expiresAt: session.expiresAt,
        idleExpiresAt: session.idleExpiresAt,
        isCurrent: true,
        issuedAt: session.stepUpVerifiedAt,
        lastSeenAt: session.stepUpVerifiedAt,
        membershipId: session.membershipId,
        revokeReason: null,
        revokedAt: null,
        sessionId: session.id,
        status: 'active',
      },
    ],
  }
}

async function fulfillJson(route: Route, body: unknown, status = 200) {
  await route.fulfill({
    body: JSON.stringify(body),
    contentType: 'application/json',
    headers: { 'cache-control': 'no-store' },
    status,
  })
}

async function installExistingStudentStorage(
  page: Page,
  studentStorageValue: string,
) {
  await page.evaluate(
    ({
      studentAuthStorageKey,
      studentSessionSentinelKey,
      studentStorageSentinelKey,
      studentStorageValue,
      studentParticipantId,
    }) => {
      window.localStorage.setItem(studentAuthStorageKey, studentStorageValue)
      window.localStorage.setItem(studentStorageSentinelKey, 'student-local')
      window.localStorage.setItem(
        'compass-interactive-participant-id',
        studentParticipantId,
      )
      window.sessionStorage.setItem(
        studentSessionSentinelKey,
        'student-session',
      )
    },
    {
      studentAuthStorageKey,
      studentSessionSentinelKey,
      studentStorageSentinelKey,
      studentStorageValue,
      studentParticipantId,
    },
  )
}

async function installBroadcastCapture(page: Page) {
  await page.addInitScript(() => {
    const target = window as BroadcastCaptureWindow
    target.__phase730AdminAuthBroadcasts = []
    if (typeof BroadcastChannel === 'undefined') return
    const originalPostMessage = BroadcastChannel.prototype.postMessage
    BroadcastChannel.prototype.postMessage = function (
      this: BroadcastChannel,
      message: unknown,
    ) {
      try {
        target.__phase730AdminAuthBroadcasts?.push(JSON.stringify(message))
      } catch {
        target.__phase730AdminAuthBroadcasts?.push('<unserializable>')
      }
      return originalPostMessage.call(this, message)
    }
  })
}

async function installNetworkMocks(
  page: Page,
  studentAccessToken: string,
  options: {
    beginStepUpReauthenticationRequired?: boolean
    includeAbandonedFactor?: boolean
    invalidStatusToken?: string
    initialVerified?: boolean
    verifyRateLimited?: boolean
  } = {},
) {
  const aal1Session = authSession('aal1', {
    includeAbandonedFactor: options.includeAbandonedFactor,
    verified: options.initialVerified,
  })
  const aal2Session = authSession('aal2', {
    includeAbandonedFactor: options.includeAbandonedFactor,
    verified: true,
  })
  const state: MockState = {
    anonymousRequests: 0,
    authorizeQueries: [],
    authRequests: [],
    edgeCalls: [],
    factorChallengeBodies: [],
    factorVerifyBodies: [],
    ledgerCalls: [],
    lectureCalls: [],
    pkceBodies: [],
    unexpectedRequests: [],
    verified: options.initialVerified ?? false,
  }

  const context = page.context()
  await context.route('https://example.supabase.co/**', async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    const authorization = request.headers().authorization ?? ''

    if (url.pathname.startsWith('/auth/v1/')) {
      state.authRequests.push({
        authorization,
        method: request.method(),
        pathname: url.pathname,
        search: url.search,
      })

      if (url.pathname === '/auth/v1/authorize' && request.method() === 'GET') {
        state.authorizeQueries.push(Object.fromEntries(url.searchParams))
        const redirectTo = url.searchParams.get('redirect_to')
        if (!redirectTo) {
          state.unexpectedRequests.push('authorize redirect_to missing')
          await fulfillJson(route, { error: 'redirect_to missing' }, 400)
          return
        }
        const callbackUrl = new URL(redirectTo)
        callbackUrl.searchParams.set('code', callbackCode)
        await route.fulfill({
          body: `<script>window.location.replace(${JSON.stringify(callbackUrl.toString())})</script>`,
          contentType: 'text/html',
          status: 200,
        })
        return
      }
      if (url.pathname === '/auth/v1/signup') {
        state.anonymousRequests += 1
        state.unexpectedRequests.push(`${request.method()} ${url.pathname}`)
        await fulfillJson(
          route,
          { error: 'anonymous sign-in is not expected' },
          500,
        )
        return
      }
      if (
        url.pathname === '/auth/v1/token' &&
        url.searchParams.get('grant_type') === 'pkce'
      ) {
        state.pkceBodies.push(
          (request.postDataJSON() ?? {}) as Record<string, unknown>,
        )
        await fulfillJson(route, {
          ...aal1Session,
          provider_refresh_token: 'phase730-google-provider-refresh-token',
          provider_token: 'phase730-google-provider-token',
        })
        return
      }
      if (url.pathname === '/auth/v1/user' && request.method() === 'GET') {
        await fulfillJson(
          route,
          googleUser(state.verified, options.includeAbandonedFactor),
        )
        return
      }
      if (url.pathname === '/auth/v1/factors' && request.method() === 'POST') {
        await fulfillJson(route, {
          friendly_name: 'COMPASS Interactive Admin',
          id: factorId,
          totp: {
            qr_code: encodeURIComponent(
              '<svg xmlns="http://www.w3.org/2000/svg" width="160" height="160"><rect width="160" height="160" fill="white"/><path d="M10 10h40v40H10z" fill="black"/></svg>',
            ),
            secret: 'PHASE730TOTPSECRET',
            uri: 'otpauth://totp/COMPASS:test?secret=PHASE730TOTPSECRET',
          },
          type: 'totp',
        })
        return
      }
      if (
        url.pathname === `/auth/v1/factors/${factorId}/challenge` &&
        request.method() === 'POST'
      ) {
        state.factorChallengeBodies.push(
          (request.postDataJSON() ?? {}) as Record<string, unknown>,
        )
        await fulfillJson(route, {
          expires_at: Math.floor(Date.now() / 1_000) + 300,
          id: challengeId,
          type: 'totp',
        })
        return
      }
      if (
        url.pathname === `/auth/v1/factors/${factorId}/verify` &&
        request.method() === 'POST'
      ) {
        state.factorVerifyBodies.push(
          (request.postDataJSON() ?? {}) as Record<string, unknown>,
        )
        if (options.verifyRateLimited) {
          await route.fulfill({
            body: JSON.stringify({ message: 'rate limited' }),
            contentType: 'application/json',
            headers: {
              'cache-control': 'no-store',
              'retry-after': '2',
            },
            status: 429,
          })
          return
        }
        state.verified = true
        await fulfillJson(route, {
          ...aal2Session,
          provider_refresh_token:
            'phase730-google-provider-refresh-token-after-totp',
          provider_token: 'phase730-google-provider-token-after-totp',
        })
        return
      }
      if (url.pathname === '/auth/v1/logout' && request.method() === 'POST') {
        await route.fulfill({ status: 204 })
        return
      }

      state.unexpectedRequests.push(
        `${request.method()} ${url.pathname}${url.search}`,
      )
      await fulfillJson(route, { error: 'unexpected auth request' }, 500)
      return
    }

    if (url.pathname === '/functions/v1/admin-identity-session') {
      const body = (request.postDataJSON() ?? {}) as Record<string, unknown>
      const action = typeof body.action === 'string' ? body.action : ''
      state.edgeCalls.push({ action, authorization, body })
      if (action === 'admit') {
        await fulfillJson(route, { eligible: true, ok: true })
        return
      }
      if (action === 'beginStepUp') {
        if (body.challengedFactorId !== factorId) {
          state.unexpectedRequests.push('beginStepUp factor binding mismatch')
          await fulfillJson(route, { code: 'request_invalid' }, 400)
          return
        }
        if (options.beginStepUpReauthenticationRequired) {
          await fulfillJson(
            route,
            {
              code: 'reauthentication_required',
              message:
                'The Google sign-in session has reached its absolute lifetime.',
              ok: false,
            },
            401,
          )
          return
        }
        await fulfillJson(route, {
          expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
          ok: true,
          stepUpNonce: restoreSeed,
        })
        return
      }
      if (action === 'completeStepUp') {
        await fulfillJson(route, {
          appSessionToken,
          ok: true,
          session: trackedSession(),
        })
        return
      }
      if (action === 'restore') {
        if (body.restoreSeed !== restoreSeed) {
          state.unexpectedRequests.push('restore seed binding mismatch')
          await fulfillJson(
            route,
            { code: 'app_session_invalid', ok: false },
            401,
          )
          return
        }
        await fulfillJson(route, {
          appSessionToken,
          ok: true,
          session: trackedSession(),
        })
        return
      }
      if (action === 'status') {
        if (body.appSessionToken !== appSessionToken) {
          if (body.appSessionToken !== options.invalidStatusToken) {
            state.unexpectedRequests.push('status app session binding mismatch')
          }
          await fulfillJson(
            route,
            { code: 'app_session_invalid', ok: false },
            401,
          )
          return
        }
        await fulfillJson(route, { ok: true, session: trackedSession() })
        return
      }
      if (action === 'logout') {
        await fulfillJson(route, { ok: true })
        return
      }
      state.unexpectedRequests.push(`identity action ${action || '<missing>'}`)
      await fulfillJson(route, { code: 'unexpected_action', ok: false }, 400)
      return
    }

    if (url.pathname === '/functions/v1/manage-lectures') {
      const body = (request.postDataJSON() ?? {}) as Record<string, unknown>
      state.lectureCalls.push({
        action: typeof body.action === 'string' ? body.action : '',
        authorization,
        body,
      })
      await fulfillJson(route, { lectures: [], ok: true })
      return
    }

    if (url.pathname === '/functions/v1/manage-admin-ledger') {
      const body = (request.postDataJSON() ?? {}) as Record<string, unknown>
      const action = typeof body.action === 'string' ? body.action : ''
      state.ledgerCalls.push({ action, authorization, body })
      if (action === 'snapshot') {
        await fulfillJson(route, ledgerSnapshot())
        return
      }
      if (action === 'audit') {
        await fulfillJson(route, { events: [], ok: true })
        return
      }
      state.unexpectedRequests.push(`ledger action ${action || '<missing>'}`)
      await fulfillJson(route, { code: 'request_invalid', ok: false }, 400)
      return
    }

    state.unexpectedRequests.push(`${request.method()} ${url.pathname}`)
    await fulfillJson(route, { error: 'unexpected Supabase request' }, 500)
  })

  return {
    aal1AccessToken: aal1Session.access_token,
    aal2AccessToken: aal2Session.access_token,
    state,
    studentAuthorization: `Bearer ${studentAccessToken}`,
  }
}

test('exchanges only the Admin PKCE callback, requires TOTP, tracks the app session, and preserves student storage on logout', async ({
  page,
}) => {
  const pageErrors: string[] = []
  page.on('pageerror', (error) => pageErrors.push(error.message))

  const student = anonymousStudentSession()
  const { aal1AccessToken, aal2AccessToken, state, studentAuthorization } =
    await installNetworkMocks(page, student.accessToken)

  await installBroadcastCapture(page)
  await page.addInitScript(() => {
    localStorage.setItem('compass-interactive-lecture-session-id', 'demo')
    localStorage.setItem(
      'compass-interactive-lecture-title',
      'AI時代の英語と学び',
    )
    localStorage.setItem('compass-interactive-lecture-status', 'open')
    localStorage.setItem('compass-interactive-lecture-runtime-mode', 'demo')
  })
  await page.goto('/admin/')
  const card = page.locator('main .admin-identity-card')
  await expect(card.locator('.eyebrow')).toHaveText('EDUCATOR PORTAL')
  await expect(
    card.getByRole('heading', { name: '教員ポータル', exact: true }),
  ).toBeVisible()
  await expect(
    card.getByText(
      '登録済みの教員アカウントでCOMPASS Interactiveにアクセスします。',
      { exact: true },
    ),
  ).toBeVisible()
  await expect(
    card.getByText('セキュリティ保護のため、2段階認証が必要です。', {
      exact: true,
    }),
  ).toBeVisible()
  await expect(
    card.getByRole('button', { name: 'Googleで続ける', exact: true }),
  ).toBeVisible()
  await installExistingStudentStorage(page, student.storageValue)
  await page.locator('main .admin-identity-card button.primary-button').click()

  await expect
    .poll(async () => ({
      edgeActions: state.edgeCalls.map(({ action }) => action),
      eyebrow:
        (await card.locator('.eyebrow').count()) > 0
          ? await card.locator('.eyebrow').textContent()
          : null,
      pkceBodies: state.pkceBodies,
      unexpectedRequests: state.unexpectedRequests,
    }))
    .toEqual({
      edgeActions: ['admit'],
      eyebrow: 'TWO-STEP VERIFICATION',
      pkceBodies: [
        {
          auth_code: callbackCode,
          code_verifier: expect.any(String),
        },
      ],
      unexpectedRequests: [],
    })
  await expect(page).toHaveURL('/admin')
  await expect(card.locator('.eyebrow')).toHaveText('TWO-STEP VERIFICATION')
  await expect(
    card.getByRole('heading', { name: '2段階認証', exact: true }),
  ).toBeVisible()
  await expect(card.locator('.admin-totp-qr')).toHaveAttribute(
    'src',
    /^data:image\/svg\+xml;utf-8,%3Csvg/,
  )
  await expect(
    card.locator('input[autocomplete="one-time-code"]'),
  ).toHaveAttribute('placeholder', '6桁のコード')
  await expect(card.getByLabel('認証コード', { exact: true })).toBeVisible()
  await expect(
    card.getByRole('button', { name: '続ける', exact: true }),
  ).toBeVisible()

  const storageAfterCallback = await page.evaluate(
    ({ adminAuthStorageKey, studentAuthStorageKey }) => ({
      admin: window.localStorage.getItem(adminAuthStorageKey),
      codeVerifier: window.localStorage.getItem(
        `${adminAuthStorageKey}-code-verifier`,
      ),
      localValues: Array.from(
        { length: window.localStorage.length },
        (_, index) => {
          const key = window.localStorage.key(index)
          return key ? (window.localStorage.getItem(key) ?? '') : ''
        },
      ),
      oauthAttempt: window.sessionStorage.getItem(
        'compass-interactive-admin-oauth-attempt-v1',
      ),
      student: window.localStorage.getItem(studentAuthStorageKey),
    }),
    { adminAuthStorageKey, studentAuthStorageKey },
  )
  expect(storageAfterCallback.admin).toBeTruthy()
  expect(storageAfterCallback.codeVerifier).toBeNull()
  expect(storageAfterCallback.oauthAttempt).toBeNull()
  expect(storageAfterCallback.student).toBe(student.storageValue)
  expect(storageAfterCallback.localValues.join('\n')).not.toContain(
    'phase730-google-provider-token',
  )
  expect(storageAfterCallback.localValues.join('\n')).not.toContain(
    'phase730-google-provider-refresh-token',
  )
  expect(storageAfterCallback.localValues.join('\n')).not.toContain(
    'provider_token',
  )
  expect(storageAfterCallback.localValues.join('\n')).not.toContain(
    'provider_refresh_token',
  )
  const broadcastsAfterCallback = await page.evaluate(
    () =>
      (window as BroadcastCaptureWindow).__phase730AdminAuthBroadcasts ?? [],
  )
  expect(broadcastsAfterCallback.length).toBeGreaterThan(0)
  expect(broadcastsAfterCallback.join('\n')).not.toContain(
    'phase730-google-provider-token',
  )
  expect(broadcastsAfterCallback.join('\n')).not.toContain(
    'phase730-google-provider-refresh-token',
  )
  expect(broadcastsAfterCallback.join('\n')).not.toContain('provider_token')
  expect(broadcastsAfterCallback.join('\n')).not.toContain(
    'provider_refresh_token',
  )

  await card.locator('input[autocomplete="one-time-code"]').fill('123456')
  await card.locator('button[type="submit"]').click()

  await expect(page.locator('.admin-workflow')).toBeVisible()
  await expect(
    page.getByRole('heading', { name: '講義を準備する', exact: true }),
  ).toBeVisible()
  await expect(page.locator('main')).not.toContainText('AI時代の英語と学び')
  await expect(page.getByRole('tab')).toHaveCount(4)
  await expect(page.locator('#admin-live')).toBeVisible()
  await expect(page.locator('#teacher-workspace-ai')).toBeHidden()
  await expect
    .poll(() =>
      page.evaluate(() => ({
        lectureSessionId: localStorage.getItem(
          'compass-interactive-lecture-session-id',
        ),
        runtimeMode: localStorage.getItem(
          'compass-interactive-lecture-runtime-mode',
        ),
        title: localStorage.getItem('compass-interactive-lecture-title'),
      })),
    )
    .toEqual({
      lectureSessionId: 'compass-demo-lecture',
      runtimeMode: 'demo',
      title: 'AI時代の英語と学び',
    })
  await expect(
    page.getByRole('button', { name: 'ログアウト', exact: true }),
  ).toBeVisible()
  await expect(page.locator('.admin-totp-qr')).toHaveCount(0)
  await expect(page.locator('main')).not.toContainText('PHASE730TOTPSECRET')

  expect(state.authorizeQueries).toHaveLength(1)
  expect(state.authorizeQueries[0]).toMatchObject({
    code_challenge_method: 's256',
    prompt: 'select_account',
    provider: 'google',
    redirect_to: expect.stringMatching(/\/admin\/auth\/callback$/),
    scopes: 'openid email profile',
  })
  expect(state.authorizeQueries[0]?.code_challenge).toMatch(
    /^[A-Za-z0-9_-]{43}$/,
  )
  expect(state.pkceBodies).toEqual([
    {
      auth_code: callbackCode,
      code_verifier: expect.stringMatching(/^[A-Za-z0-9._~-]{43,128}$/),
    },
  ])
  expect(state.factorChallengeBodies).toEqual([{ factorId }])
  expect(state.factorVerifyBodies).toEqual([
    { challenge_id: challengeId, code: '123456' },
  ])
  expect(state.edgeCalls.map(({ action }) => action)).toEqual([
    'admit',
    'beginStepUp',
    'completeStepUp',
  ])
  expect(state.edgeCalls[0]?.authorization).toBe(`Bearer ${aal1AccessToken}`)
  expect(state.edgeCalls[1]?.authorization).toBe(`Bearer ${aal1AccessToken}`)
  expect(state.edgeCalls[2]?.authorization).toBe(`Bearer ${aal2AccessToken}`)
  const loginRequestIds = state.edgeCalls.map(({ body }) => body.loginRequestId)
  expect(loginRequestIds).toHaveLength(3)
  expect(loginRequestIds[0]).toEqual(loginRequestIds[1])
  expect(loginRequestIds[1]).toEqual(loginRequestIds[2])
  expect(loginRequestIds[0]).toEqual(expect.stringMatching(uuidPattern))
  expect(state.edgeCalls[1]?.body).toEqual({
    action: 'beginStepUp',
    challengedFactorId: factorId,
    loginRequestId: loginRequestIds[0],
  })
  await expect.poll(() => state.lectureCalls.length).toBeGreaterThan(0)
  for (const lectureCall of state.lectureCalls) {
    expect(lectureCall).toEqual({
      action: 'list',
      authorization: `Bearer ${aal2AccessToken}`,
      body: {
        action: 'list',
        appSessionToken,
        includeHistory: false,
      },
    })
  }
  const settingsLink = page.getByRole('link', { name: '教員管理' })
  await expect(settingsLink).toHaveAttribute('target', '_blank')
  const settingsPopupPromise = page.waitForEvent('popup')
  await settingsLink.click()
  const settingsPage = await settingsPopupPromise
  await expect(
    settingsPage.getByRole('heading', { name: '教員管理', exact: true }),
  ).toBeVisible()
  await expect(settingsPage.locator('.admin-identity-card')).toHaveCount(0)
  const pageCountBeforeChangedSessionHandoff = page.context().pages().length
  await settingsPage.evaluate(
    ({ adminAppSessionStorageKey }) =>
      window.sessionStorage.setItem(
        adminAppSessionStorageKey,
        'stale-admin-app-session',
      ),
    { adminAppSessionStorageKey },
  )
  const settingsReloadPromise = settingsPage.waitForEvent('load')
  await settingsLink.click()
  await settingsReloadPromise
  await expect(
    settingsPage.getByRole('heading', { name: '教員管理', exact: true }),
  ).toBeVisible()
  expect(page.context().pages()).toHaveLength(
    pageCountBeforeChangedSessionHandoff,
  )
  expect(
    await settingsPage.evaluate(
      ({ adminAppSessionStorageKey }) =>
        window.sessionStorage.getItem(adminAppSessionStorageKey),
      { adminAppSessionStorageKey },
    ),
  ).toBe(appSessionToken)
  await expect
    .poll(() =>
      [...new Set(state.ledgerCalls.map(({ action }) => action))].sort(),
    )
    .toEqual(['audit', 'snapshot'])
  for (const ledgerCall of state.ledgerCalls) {
    expect(ledgerCall.authorization).toBe(`Bearer ${aal2AccessToken}`)
    expect(ledgerCall.body).not.toHaveProperty('adminToken')
    expect(ledgerCall.body).toMatchObject({
      action: expect.stringMatching(/^(audit|snapshot)$/),
      appSessionToken,
    })
  }
  const pageCountBeforeWorkspaceReturn = page.context().pages().length
  await page.evaluate(() => {
    document.documentElement.dataset.adminWorkspaceDocument = 'preserved'
  })
  await settingsPage
    .getByRole('link', { name: '講義コントロール', exact: true })
    .click()
  await expect(page.locator('.admin-workflow')).toBeVisible()
  expect(page.context().pages()).toHaveLength(pageCountBeforeWorkspaceReturn)
  expect(
    await page.evaluate(
      () => document.documentElement.dataset.adminWorkspaceDocument,
    ),
  ).toBe('preserved')

  const storageAtReady = await page.evaluate(
    ({ adminAppSessionStorageKey, studentAuthStorageKey }) => ({
      appSession: window.sessionStorage.getItem(adminAppSessionStorageKey),
      student: window.localStorage.getItem(studentAuthStorageKey),
    }),
    { adminAppSessionStorageKey, studentAuthStorageKey },
  )
  expect(storageAtReady).toEqual({
    appSession: appSessionToken,
    student: student.storageValue,
  })

  await settingsPage
    .getByRole('button', { name: 'ログアウト', exact: true })
    .click()
  await expect(card.locator('.eyebrow')).toHaveText('EDUCATOR PORTAL')
  await expect(
    card.getByRole('heading', { name: '教員ポータル', exact: true }),
  ).toBeVisible()
  await settingsPage.close()

  const storageAfterLogout = await page.evaluate(
    ({
      adminAppSessionStorageKey,
      adminAuthStorageKey,
      adminOAuthAttemptStorageKey,
      studentAuthStorageKey,
      studentSessionSentinelKey,
      studentStorageSentinelKey,
    }) => ({
      adminAppSession: window.sessionStorage.getItem(adminAppSessionStorageKey),
      adminAuth: window.localStorage.getItem(adminAuthStorageKey),
      adminVerifier: window.localStorage.getItem(
        `${adminAuthStorageKey}-code-verifier`,
      ),
      oauthAttempt: window.sessionStorage.getItem(adminOAuthAttemptStorageKey),
      participant: window.localStorage.getItem(
        'compass-interactive-participant-id',
      ),
      studentAuth: window.localStorage.getItem(studentAuthStorageKey),
      studentSessionSentinel: window.sessionStorage.getItem(
        studentSessionSentinelKey,
      ),
      studentStorageSentinel: window.localStorage.getItem(
        studentStorageSentinelKey,
      ),
    }),
    {
      adminAppSessionStorageKey,
      adminAuthStorageKey,
      adminOAuthAttemptStorageKey,
      studentAuthStorageKey,
      studentSessionSentinelKey,
      studentStorageSentinelKey,
    },
  )
  expect(storageAfterLogout).toEqual({
    adminAppSession: null,
    adminAuth: null,
    adminVerifier: null,
    oauthAttempt: null,
    participant: studentParticipantId,
    studentAuth: student.storageValue,
    studentSessionSentinel: 'student-session',
    studentStorageSentinel: 'student-local',
  })
  expect(state.edgeCalls.map(({ action }) => action)).toEqual([
    'admit',
    'beginStepUp',
    'completeStepUp',
    'status',
    'status',
    'logout',
  ])
  expect(state.edgeCalls.at(-1)?.body).toEqual({
    action: 'logout',
    appSessionToken,
  })
  expect(
    state.authRequests.filter(
      ({ method, pathname }) =>
        method === 'POST' && pathname === '/auth/v1/logout',
    ),
  ).toEqual([
    {
      authorization: `Bearer ${aal2AccessToken}`,
      method: 'POST',
      pathname: '/auth/v1/logout',
      search: '?scope=local',
    },
  ])
  const broadcastsAfterLogout = await page.evaluate(
    () =>
      (window as BroadcastCaptureWindow).__phase730AdminAuthBroadcasts ?? [],
  )
  expect(broadcastsAfterLogout.join('\n')).not.toContain('provider_token')
  expect(broadcastsAfterLogout.join('\n')).not.toContain(
    'provider_refresh_token',
  )
  expect(state.anonymousRequests).toBe(0)
  expect(
    state.authRequests.filter(
      ({ authorization }) => authorization === studentAuthorization,
    ),
  ).toEqual([])
  expect(state.unexpectedRequests).toEqual([])
  expect(pageErrors).toEqual([])
})

test('restores the same app token only from its scoped live AAL2 Auth session', async ({
  page,
}) => {
  const student = anonymousStudentSession()
  const { aal2AccessToken, state } = await installNetworkMocks(
    page,
    student.accessToken,
    { initialVerified: true },
  )
  const storedSession = {
    ...authSession('aal2', { verified: true }),
    access_token: aal2AccessToken,
  }
  await page.addInitScript(
    ({
      adminAppSessionRestoreSeedStorageKey,
      adminAuthStorageKey,
      restoreSeed,
      storedSession,
    }) => {
      window.localStorage.setItem(
        adminAuthStorageKey,
        JSON.stringify(storedSession),
      )
      window.localStorage.setItem(
        adminAppSessionRestoreSeedStorageKey,
        JSON.stringify({
          authSessionId: '73000000-0000-4000-8000-000000000002',
          authUserId: '73000000-0000-4000-8000-000000000001',
          seed: restoreSeed,
          version: 1,
        }),
      )
    },
    {
      adminAppSessionRestoreSeedStorageKey,
      adminAuthStorageKey,
      restoreSeed,
      storedSession,
    },
  )

  await page.goto('/admin')

  await expect(page.locator('.admin-workflow')).toBeVisible()
  expect(state.edgeCalls.map(({ action }) => action)).toEqual(['restore'])
  expect(state.edgeCalls[0]?.authorization).toBe(`Bearer ${aal2AccessToken}`)
  expect(
    await page.evaluate(
      ({ adminAppSessionStorageKey }) =>
        window.sessionStorage.getItem(adminAppSessionStorageKey),
      { adminAppSessionStorageKey },
    ),
  ).toBe(appSessionToken)
  expect(state.edgeCalls[0]?.body).toEqual({ action: 'restore', restoreSeed })
  expect(state.unexpectedRequests).toEqual([])
})

test('replaces a stale tab token from the same scoped live AAL2 Auth session', async ({
  page,
}) => {
  const staleAppSessionToken = 'stale-admin-app-session'
  const student = anonymousStudentSession()
  const { aal2AccessToken, state } = await installNetworkMocks(
    page,
    student.accessToken,
    { initialVerified: true, invalidStatusToken: staleAppSessionToken },
  )
  const storedSession = {
    ...authSession('aal2', { verified: true }),
    access_token: aal2AccessToken,
  }
  await page.addInitScript(
    ({
      adminAppSessionStorageKey,
      adminAppSessionRestoreSeedStorageKey,
      adminAuthStorageKey,
      restoreSeed,
      staleToken,
      session,
    }) => {
      window.localStorage.setItem(adminAuthStorageKey, JSON.stringify(session))
      window.localStorage.setItem(
        adminAppSessionRestoreSeedStorageKey,
        JSON.stringify({
          authSessionId: '73000000-0000-4000-8000-000000000002',
          authUserId: '73000000-0000-4000-8000-000000000001',
          seed: restoreSeed,
          version: 1,
        }),
      )
      window.sessionStorage.setItem(adminAppSessionStorageKey, staleToken)
    },
    {
      adminAppSessionStorageKey,
      adminAppSessionRestoreSeedStorageKey,
      adminAuthStorageKey,
      restoreSeed,
      session: storedSession,
      staleToken: staleAppSessionToken,
    },
  )

  await page.goto('/admin')

  await expect(page.locator('.admin-workflow')).toBeVisible()
  expect(state.edgeCalls.map(({ action }) => action)).toEqual([
    'status',
    'restore',
  ])
  expect(state.edgeCalls[1]?.authorization).toBe(`Bearer ${aal2AccessToken}`)
  expect(
    await page.evaluate(
      ({ adminAppSessionStorageKey }) =>
        window.sessionStorage.getItem(adminAppSessionStorageKey),
      { adminAppSessionStorageKey },
    ),
  ).toBe(appSessionToken)
  expect(state.edgeCalls[1]?.body).toEqual({ action: 'restore', restoreSeed })
  expect(state.unexpectedRequests).toEqual([])
})

test('clears a stale app token without backing Auth before one OAuth reaches TOTP', async ({
  page,
}) => {
  const student = anonymousStudentSession()
  const { state } = await installNetworkMocks(page, student.accessToken, {
    initialVerified: true,
  })
  await page.addInitScript(
    ({ adminAppSessionStorageKey, seedKey }) => {
      if (window.sessionStorage.getItem(seedKey)) return
      window.sessionStorage.setItem(seedKey, 'true')
      window.sessionStorage.setItem(
        adminAppSessionStorageKey,
        'stale-admin-app-session',
      )
    },
    {
      adminAppSessionStorageKey,
      seedKey: 'phase730-stale-app-token-seeded',
    },
  )

  await page.goto('/admin')

  const card = page.locator('main .admin-identity-card')
  await expect(card.locator('.eyebrow')).toHaveText('EDUCATOR PORTAL')
  expect(
    await page.evaluate(
      ({ adminAppSessionStorageKey }) =>
        window.sessionStorage.getItem(adminAppSessionStorageKey),
      { adminAppSessionStorageKey },
    ),
  ).toBeNull()

  await card.getByRole('button', { name: 'Googleで続ける' }).click()
  await expect
    .poll(() => state.edgeCalls.map(({ action }) => action))
    .toEqual(['admit'])
  await expect(card.locator('.eyebrow')).toHaveText('TWO-STEP VERIFICATION')
  expect(state.unexpectedRequests).toEqual([])
})

test('honors Auth Retry-After before another TOTP submission', async ({
  page,
}) => {
  const student = anonymousStudentSession()
  const { state } = await installNetworkMocks(page, student.accessToken, {
    initialVerified: true,
    verifyRateLimited: true,
  })

  await page.goto('/admin')
  await page.locator('main .admin-identity-card button.primary-button').click()
  const card = page.locator('main .admin-identity-card')
  await expect(card.locator('.eyebrow')).toHaveText('TWO-STEP VERIFICATION')
  await card.getByLabel('認証コード', { exact: true }).fill('123456')
  await card.getByRole('button', { name: '続ける', exact: true }).click()

  await expect(card.getByRole('alert')).toContainText(
    '試行回数が多すぎます。待機時間の終了後に再度お試しください。',
  )
  await expect(card.getByRole('status')).toContainText('再試行まで')
  await expect(card.getByLabel('認証コード', { exact: true })).toBeDisabled()
  await expect(
    card.getByRole('button', { name: '続ける', exact: true }),
  ).toBeDisabled()
  expect(state.factorVerifyBodies).toHaveLength(1)
  expect(state.edgeCalls.map(({ action }) => action)).toEqual([
    'admit',
    'beginStepUp',
  ])
  expect(state.unexpectedRequests).toEqual([])
})

test('an expired or missing backing Auth session clears Admin state and preserves the settings return path for Google reauthentication', async ({
  page,
}) => {
  const student = anonymousStudentSession()
  const { state } = await installNetworkMocks(page, student.accessToken, {
    beginStepUpReauthenticationRequired: true,
    initialVerified: true,
  })

  await page.goto('/admin/settings')
  const card = page.locator('main .admin-identity-card')
  await card.getByRole('button', { name: 'Googleで続ける' }).click()
  await expect(page).toHaveURL('/admin/settings')
  await expect(card.locator('.eyebrow')).toHaveText('TWO-STEP VERIFICATION')

  await installExistingStudentStorage(page, student.storageValue)
  await page.evaluate(
    ({ adminAppSessionStorageKey }) =>
      window.sessionStorage.setItem(
        adminAppSessionStorageKey,
        'stale-admin-app-session',
      ),
    { adminAppSessionStorageKey },
  )
  await card.getByLabel('認証コード', { exact: true }).fill('123456')
  await card.getByRole('button', { name: '続ける', exact: true }).click()

  await expect(card.locator('.eyebrow')).toHaveText('EDUCATOR PORTAL')
  await expect(card.getByRole('alert')).toHaveText(
    'Googleログインの有効期限が切れました。Googleで再認証してください。',
  )
  await expect(page).toHaveURL('/admin/settings')
  expect(state.edgeCalls.map(({ action }) => action)).toEqual([
    'admit',
    'beginStepUp',
  ])
  expect(state.factorChallengeBodies).toEqual([])
  expect(state.factorVerifyBodies).toEqual([])

  const clearedStorage = await page.evaluate(
    ({
      adminAppSessionStorageKey,
      adminAuthStorageKey,
      adminOAuthAttemptStorageKey,
      studentAuthStorageKey,
    }) => ({
      adminAppSession: window.sessionStorage.getItem(adminAppSessionStorageKey),
      adminAuth: window.localStorage.getItem(adminAuthStorageKey),
      adminVerifier: window.localStorage.getItem(
        `${adminAuthStorageKey}-code-verifier`,
      ),
      oauthAttempt: window.sessionStorage.getItem(adminOAuthAttemptStorageKey),
      studentAuth: window.localStorage.getItem(studentAuthStorageKey),
    }),
    {
      adminAppSessionStorageKey,
      adminAuthStorageKey,
      adminOAuthAttemptStorageKey,
      studentAuthStorageKey,
    },
  )
  expect(clearedStorage).toEqual({
    adminAppSession: null,
    adminAuth: null,
    adminVerifier: null,
    oauthAttempt: null,
    studentAuth: student.storageValue,
  })
  expect(
    state.authRequests.filter(
      ({ method, pathname }) =>
        method === 'POST' && pathname === '/auth/v1/logout',
    ),
  ).toHaveLength(1)

  await card.getByRole('button', { name: 'Googleで続ける' }).click()
  await expect(page).toHaveURL('/admin/settings')
  await expect(card.locator('.eyebrow')).toHaveText('TWO-STEP VERIFICATION')
  expect(state.authorizeQueries).toHaveLength(2)
  expect(state.edgeCalls.map(({ action }) => action)).toEqual([
    'admit',
    'beginStepUp',
    'admit',
  ])
  expect(state.unexpectedRequests).toEqual([])
})

test('uses the existing verified factor instead of an abandoned unverified factor', async ({
  page,
}) => {
  const student = anonymousStudentSession()
  const { aal2AccessToken, state } = await installNetworkMocks(
    page,
    student.accessToken,
    {
      includeAbandonedFactor: true,
      initialVerified: true,
    },
  )

  await page.goto('/admin')
  await page.locator('main .admin-identity-card button.primary-button').click()

  const card = page.locator('main .admin-identity-card')
  await expect(card.locator('.eyebrow')).toHaveText('TWO-STEP VERIFICATION')
  await expect(
    card.getByRole('heading', { name: '2段階認証', exact: true }),
  ).toBeVisible()
  await expect(
    card.getByText(
      '認証アプリに表示されている6桁のコードを入力してください。',
      {
        exact: true,
      },
    ),
  ).toBeVisible()
  await expect(card.locator('.admin-totp-qr')).toHaveCount(0)
  await expect(card.getByLabel('認証コード', { exact: true })).toHaveAttribute(
    'placeholder',
    '6桁のコード',
  )
  await expect(
    card.getByRole('button', { name: '続ける', exact: true }),
  ).toBeVisible()
  await card.locator('input[autocomplete="one-time-code"]').fill('123456')
  await card.locator('button[type="submit"]').click()
  await expect(page.locator('.admin-workflow')).toBeVisible()
  await expect(
    page.getByRole('button', { name: 'ログアウト', exact: true }),
  ).toBeVisible()
  await expect.poll(() => state.lectureCalls.length).toBeGreaterThan(0)
  for (const lectureCall of state.lectureCalls) {
    expect(lectureCall).toEqual({
      action: 'list',
      authorization: `Bearer ${aal2AccessToken}`,
      body: {
        action: 'list',
        appSessionToken,
        includeHistory: false,
      },
    })
  }
  await page.goto('/admin/settings')
  await expect(
    page.getByRole('heading', { name: '教員管理', exact: true }),
  ).toBeVisible()
  await expect
    .poll(() =>
      [...new Set(state.ledgerCalls.map(({ action }) => action))].sort(),
    )
    .toEqual(['audit', 'snapshot'])
  for (const ledgerCall of state.ledgerCalls) {
    expect(ledgerCall.authorization).toBe(`Bearer ${aal2AccessToken}`)
    expect(ledgerCall.body).not.toHaveProperty('adminToken')
    expect(ledgerCall.body).toMatchObject({
      action: expect.stringMatching(/^(audit|snapshot)$/),
      appSessionToken,
    })
  }

  expect(
    state.authRequests.filter(
      ({ method, pathname }) =>
        method === 'POST' && pathname === '/auth/v1/factors',
    ),
  ).toEqual([])
  expect(
    state.edgeCalls.find(({ action }) => action === 'beginStepUp')?.body,
  ).toEqual({
    action: 'beginStepUp',
    challengedFactorId: factorId,
    loginRequestId: expect.stringMatching(uuidPattern),
  })
  expect(
    state.edgeCalls.some(
      ({ action, body }) =>
        action === 'beginStepUp' &&
        body.challengedFactorId === abandonedFactorId,
    ),
  ).toBe(false)
  expect(state.unexpectedRequests).toEqual([])
})
