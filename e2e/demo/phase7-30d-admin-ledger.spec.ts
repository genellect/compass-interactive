import { AxeBuilder } from '@axe-core/playwright'
import { expect, test, type Page, type Route } from '@playwright/test'

test.skip(
  process.env.VITE_PHASE7_30_ADMIN_IDENTITY !== 'true' ||
    process.env.VITE_PHASE7_30_GOOGLE_ADMIN_OPERATIONS !== 'true' ||
    process.env.VITE_PHASE7_30_GOOGLE_ADMIN_LEDGER !== 'true' ||
    process.env.VITE_PHASE7_30_LEGACY_ADMIN_PIN !== 'false',
  'Phase 7.30D Admin ledger requires its dedicated Google-only runner.',
)

const pendingStorageKey = 'compass-interactive-admin-ledger-pending-v1'
const appSessionToken = `g1.${'a'.repeat(43)}`
const invitationToken = 'i'.repeat(43)
const factorId = '730d0000-0000-4000-8000-000000000001'
const challengeId = '730d0000-0000-4000-8000-000000000002'
const authUserId = '730d0000-0000-4000-8000-000000000003'
const authSessionId = '730d0000-0000-4000-8000-000000000004'
const environmentId = '730d0000-0000-4000-8000-000000000005'
const ownerPrincipalId = '730d0000-0000-4000-8000-000000000006'
const ownerMembershipId = '730d0000-0000-4000-8000-000000000007'
const ownerSessionId = '730d0000-0000-4000-8000-000000000008'
const instructorPrincipalId = '730d0000-0000-4000-8000-000000000009'
const instructorMembershipId = '730d0000-0000-4000-8000-00000000000a'
const instructorSessionId = '730d0000-0000-4000-8000-00000000000b'
const priorInvitationId = '730d0000-0000-4000-8000-00000000000c'
const resultInvitationId = '730d0000-0000-4000-8000-00000000000d'
const intentDigest = 'd'.repeat(64)

type FunctionCall = {
  authorization: string
  body: Record<string, unknown>
  functionName: string
}

type MockState = {
  admissionEnabled: boolean
  anonymousRequests: number
  authRequests: Array<{
    authorization: string
    method: string
    pathname: string
  }>
  commitBodies: Record<string, unknown>[]
  functionCalls: FunctionCall[]
  unexpectedRequests: string[]
}

function encodeJwtPart(value: unknown) {
  return Buffer.from(JSON.stringify(value)).toString('base64url')
}

function adminUser() {
  const now = new Date().toISOString()
  return {
    app_metadata: { provider: 'google', providers: ['google'] },
    aud: 'authenticated',
    confirmed_at: now,
    created_at: now,
    email: 'owner@example.test',
    email_confirmed_at: now,
    factors: [
      {
        created_at: now,
        factor_type: 'totp',
        friendly_name: 'Owner authenticator',
        id: factorId,
        status: 'verified',
        updated_at: now,
      },
    ],
    id: authUserId,
    identities: [
      {
        created_at: now,
        id: 'phase730d-google-subject',
        identity_data: {
          email: 'owner@example.test',
          email_verified: true,
          iss: 'https://accounts.google.com',
          sub: 'phase730d-google-subject',
        },
        identity_id: '730d0000-0000-4000-8000-00000000000e',
        last_sign_in_at: now,
        provider: 'google',
        updated_at: now,
        user_id: authUserId,
      },
    ],
    is_anonymous: false,
    role: 'authenticated',
    updated_at: now,
    user_metadata: {
      email: 'owner@example.test',
      email_verified: true,
      sub: 'phase730d-google-subject',
    },
  }
}

function adminSession() {
  const user = adminUser()
  const nowSeconds = Math.floor(Date.now() / 1_000)
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
    'phase730d-admin-signature',
  ].join('.')
  return {
    access_token: accessToken,
    expires_at: nowSeconds + 3_600,
    expires_in: 3_600,
    refresh_token: 'phase730d-admin-refresh-token',
    token_type: 'bearer',
    user,
  }
}

function studentSession() {
  const nowSeconds = Math.floor(Date.now() / 1_000)
  const id = '730d0000-0000-4000-8000-00000000000f'
  const accessToken = [
    encodeJwtPart({ alg: 'HS256', typ: 'JWT' }),
    encodeJwtPart({
      aud: 'authenticated',
      exp: nowSeconds + 3_600,
      iat: nowSeconds - 60,
      role: 'authenticated',
      sub: id,
    }),
    'phase730d-student-signature',
  ].join('.')
  return {
    accessToken,
    storageValue: JSON.stringify({
      access_token: accessToken,
      expires_at: nowSeconds + 3_600,
      expires_in: 3_600,
      refresh_token: 'phase730d-student-refresh-token',
      token_type: 'bearer',
      user: {
        app_metadata: { provider: 'anonymous', providers: ['anonymous'] },
        aud: 'authenticated',
        created_at: new Date().toISOString(),
        id,
        is_anonymous: true,
        role: 'authenticated',
        updated_at: new Date().toISOString(),
        user_metadata: {},
      },
    }),
  }
}

function trackedAdminSession() {
  const now = Date.now()
  return {
    canUseAi: false,
    environmentId,
    expiresAt: new Date(now + 8 * 60 * 60_000).toISOString(),
    id: ownerSessionId,
    idleExpiresAt: new Date(now + 30 * 60_000).toISOString(),
    membershipId: ownerMembershipId,
    principalId: ownerPrincipalId,
    role: 'owner',
    stepUpVerifiedAt: new Date(now - 60_000).toISOString(),
  }
}

function ledgerSnapshot(ledgerAdmissionEnabled: boolean) {
  const now = Date.now()
  const createdAt = new Date(now - 24 * 60 * 60_000).toISOString()
  const updatedAt = new Date(now - 60_000).toISOString()
  const expiresAt = new Date(now + 7 * 24 * 60 * 60_000).toISOString()
  return {
    currentMembershipId: ownerMembershipId,
    currentPrincipalId: ownerPrincipalId,
    currentSessionId: ownerSessionId,
    environmentId,
    environmentKind: 'production',
    invitations: [
      {
        canUseAi: true,
        createdAt,
        expiredAt: null,
        expiresAt,
        invitationId: priorInvitationId,
        membershipExpiresAt: new Date(
          now + 30 * 24 * 60 * 60_000,
        ).toISOString(),
        normalizedEmail: 'pending@example.test',
        revocationReason: null,
        revokedAt: null,
        role: 'instructor',
        status: 'pending',
        updatedAt,
      },
    ],
    ledgerAdmissionEnabled,
    memberships: [
      {
        canUseAi: true,
        createdAt,
        displayName: 'Current Owner',
        expiresAt: null,
        membershipId: ownerMembershipId,
        normalizedEmail: 'owner@example.test',
        principalId: ownerPrincipalId,
        principalStatus: 'active',
        role: 'owner',
        status: 'active',
        statusReason: null,
        updatedAt,
      },
      {
        canUseAi: false,
        createdAt,
        displayName: 'Lecture Instructor',
        expiresAt: new Date(now + 30 * 24 * 60 * 60_000).toISOString(),
        membershipId: instructorMembershipId,
        normalizedEmail: 'instructor@example.test',
        principalId: instructorPrincipalId,
        principalStatus: 'active',
        role: 'instructor',
        status: 'active',
        statusReason: null,
        updatedAt,
      },
    ],
    ok: true,
    ownerships: [],
    sessions: [
      {
        expiresAt,
        idleExpiresAt: expiresAt,
        isCurrent: true,
        issuedAt: createdAt,
        lastSeenAt: updatedAt,
        membershipId: ownerMembershipId,
        revokeReason: null,
        revokedAt: null,
        sessionId: ownerSessionId,
        status: 'active',
      },
      {
        expiresAt,
        idleExpiresAt: expiresAt,
        isCurrent: false,
        issuedAt: createdAt,
        lastSeenAt: updatedAt,
        membershipId: instructorMembershipId,
        revokeReason: null,
        revokedAt: null,
        sessionId: instructorSessionId,
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

async function installStoredSessions(
  page: Page,
  admin: ReturnType<typeof adminSession>,
  studentStorageValue: string,
) {
  await page.addInitScript(
    ({ admin, studentStorageValue }) => {
      window.localStorage.setItem(
        'compass-interactive-admin-supabase-auth-v1',
        JSON.stringify(admin),
      )
      window.sessionStorage.setItem(
        'compass-interactive-admin-google-app-session-v1',
        `g1.${'a'.repeat(43)}`,
      )
      window.localStorage.setItem(
        'sb-example-auth-token',
        studentStorageValue,
      )
      window.localStorage.setItem(
        'compass-interactive-participant-id',
        'phase730d-student-participant',
      )
    },
    { admin, studentStorageValue },
  )
}

async function installMocks(
  page: Page,
  admin: ReturnType<typeof adminSession>,
) {
  const state: MockState = {
    admissionEnabled: false,
    anonymousRequests: 0,
    authRequests: [],
    commitBodies: [],
    functionCalls: [],
    unexpectedRequests: [],
  }
  let commitAttempts = 0

  await page.route('https://example.supabase.co/**', async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    const authorization = request.headers().authorization ?? ''

    if (url.pathname.startsWith('/auth/v1/')) {
      state.authRequests.push({
        authorization,
        method: request.method(),
        pathname: url.pathname,
      })
      if (url.pathname === '/auth/v1/signup') {
        state.anonymousRequests += 1
        state.unexpectedRequests.push(`${request.method()} ${url.pathname}`)
        await fulfillJson(route, { error: 'anonymous auth is not expected' }, 500)
        return
      }
      if (url.pathname === '/auth/v1/authorize') {
        state.unexpectedRequests.push(`${request.method()} ${url.pathname}`)
        await fulfillJson(route, { error: 'OAuth is not expected' }, 500)
        return
      }
      if (url.pathname === '/auth/v1/user' && request.method() === 'GET') {
        await fulfillJson(route, admin.user)
        return
      }
      if (
        url.pathname === `/auth/v1/factors/${factorId}/challenge` &&
        request.method() === 'POST'
      ) {
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
        await fulfillJson(route, admin)
        return
      }
      state.unexpectedRequests.push(`${request.method()} ${url.pathname}`)
      await fulfillJson(route, { error: 'unexpected auth request' }, 500)
      return
    }

    if (url.pathname.startsWith('/functions/v1/')) {
      const functionName = url.pathname.split('/').at(-1) ?? ''
      const body = (request.postDataJSON() ?? {}) as Record<string, unknown>
      state.functionCalls.push({ authorization, body, functionName })

      if (functionName === 'admin-identity-session') {
        const action = String(body.action ?? '')
        if (action === 'status') {
          await fulfillJson(route, {
            ok: true,
            session: trackedAdminSession(),
          })
          return
        }
        if (action === 'beginControlStepUp') {
          await fulfillJson(route, {
            controlAction: body.controlAction,
            controlIntentDigest: body.controlIntentDigest,
            controlOperationKey: body.controlOperationKey,
            controlRequestId: body.controlRequestId,
            controlStepUpNonce: body.controlStepUpNonce,
            expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
            ok: true,
          })
          return
        }
        if (action === 'completeControlStepUp') {
          await fulfillJson(route, {
            controlAction: body.controlAction,
            controlIntentDigest: body.controlIntentDigest,
            controlOperationKey: body.controlOperationKey,
            controlRequestId: body.controlRequestId,
            expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
            ok: true,
            verifiedTotpAmrAt: new Date().toISOString(),
          })
          return
        }
        state.unexpectedRequests.push(`identity action ${action || '<missing>'}`)
        await fulfillJson(route, { code: 'request_invalid', ok: false }, 400)
        return
      }

      if (functionName === 'manage-admin-ledger') {
        if (body.action === 'snapshot') {
          await fulfillJson(route, ledgerSnapshot(state.admissionEnabled))
          return
        }
        if (body.action === 'audit') {
          await fulfillJson(route, { events: [], ok: true })
          return
        }
        if (body.stage === 'intent' && body.action === 'issueInvitation') {
          await fulfillJson(route, {
            controlStepUpAction: 'admin_invitation_change',
            intentDigest,
            ok: true,
            operationKey: 'manage-admin-ledger.issueInvitation',
            requestId: body.requestId,
            targetId: resultInvitationId,
          })
          return
        }
        if (body.stage === 'commit' && body.action === 'issueInvitation') {
          state.commitBodies.push(JSON.parse(JSON.stringify(body)))
          commitAttempts += 1
          if (commitAttempts === 1) {
            await fulfillJson(
              route,
              { code: 'service_unavailable', ok: false },
              503,
            )
            return
          }
          await fulfillJson(route, {
            idempotentReplay: true,
            invitationToken,
            ok: true,
            refreshRequired: true,
            resultId: resultInvitationId,
            resultStatus: 'pending',
          })
          return
        }
        state.unexpectedRequests.push(
          `ledger ${String(body.stage ?? body.action ?? '<missing>')}`,
        )
        await fulfillJson(route, { code: 'request_invalid', ok: false }, 400)
        return
      }

      if (functionName === 'manage-lectures' && body.action === 'list') {
        await fulfillJson(route, { lectures: [], ok: true })
        return
      }

      state.unexpectedRequests.push(`function ${functionName}`)
      await fulfillJson(route, { code: 'unexpected_function', ok: false }, 500)
      return
    }

    state.unexpectedRequests.push(`${request.method()} ${url.pathname}`)
    await fulfillJson(route, { error: 'unexpected Supabase request' }, 500)
  })

  return state
}

async function openLedger(page: Page) {
  await page.goto('/admin')
  const identitySettings = page.getByText('個人設定とセキュリティ', {
    exact: true,
  })
  await expect(identitySettings).toBeVisible()
  await identitySettings.click()
  const panel = page.locator('.admin-ledger-panel')
  await expect(panel.getByRole('heading', { name: '管理者台帳' })).toBeVisible()
  await expect(panel).not.toHaveAttribute('aria-busy', 'true')
  return panel
}

test('keeps safe owner controls available while OFF and exactly recovers one invitation after a lost response', async ({
  page,
}, testInfo) => {
  const pageErrors: string[] = []
  page.on('pageerror', (error) => pageErrors.push(error.message))
  const admin = adminSession()
  const student = studentSession()
  await installStoredSessions(page, admin, student.storageValue)
  const state = await installMocks(page, admin)

  let panel = await openLedger(page)
  await expect(
    panel.getByText(
      '新しい招待・権限追加は停止中です。状態確認、権限の縮小、セッション失効は利用できます。',
      { exact: true },
    ),
  ).toBeVisible()
  await expect(
    panel.getByRole('button', { name: '招待リンクを作成' }),
  ).toBeDisabled()
  await expect(
    panel.getByRole('button', { name: '環境管理者に変更' }),
  ).toBeDisabled()
  await expect(
    panel.getByRole('button', { name: 'AI利用を許可' }),
  ).toBeDisabled()
  for (const label of [
    '最新状態を確認',
    'AI利用を停止',
    '一時停止',
    '登録を失効',
    '全セッションを失効',
    'このセッションを失効',
  ]) {
    await expect(panel.getByRole('button', { name: label }).first()).toBeEnabled()
  }
  await panel.getByText('招待履歴 (1)', { exact: true }).click()
  await expect(
    panel.getByRole('button', { name: '招待を取り消す' }),
  ).toBeEnabled()
  await expect(page.locator('body')).not.toContainText(
    /feature_disabled|manage-admin-ledger|ledgerAdmissionEnabled|P73\d+/,
  )

  state.admissionEnabled = true
  await panel.getByRole('button', { name: '最新状態を確認' }).click()
  await expect(
    panel.getByRole('button', { name: '招待リンクを作成' }),
  ).toBeEnabled()
  await panel
    .getByLabel('Googleアカウントのメールアドレス')
    .fill('new-admin@example.test')
  await panel.getByRole('button', { name: '招待リンクを作成' }).click()
  await expect(
    panel.getByText(
      '認証アプリの6桁コードで、この変更だけを確認してください。',
      { exact: true },
    ),
  ).toBeVisible()
  await panel.getByLabel('6桁コード').fill('123456')
  await panel.getByRole('button', { name: 'この変更を実行' }).click()
  await expect(
    panel.getByRole('button', { name: '更新結果を再確認' }),
  ).toBeVisible()

  const storedPending = await page.evaluate((key) => {
    const raw = window.sessionStorage.getItem(key)
    return raw ? { parsed: JSON.parse(raw), raw } : null
  }, pendingStorageKey)
  expect(storedPending?.parsed.pending.phase).toBe('authorized')
  expect(storedPending?.raw).not.toContain('123456')
  expect(storedPending?.raw).not.toContain(appSessionToken)
  expect(storedPending?.raw).not.toContain(invitationToken)

  await page.reload()
  panel = await openLedger(page)
  await panel.getByRole('button', { name: '更新結果を再確認' }).click()
  await expect(
    panel.getByText('今回だけ表示される招待リンク', { exact: true }),
  ).toBeVisible()
  await expect(
    panel.locator('.admin-ledger-invitation-link input'),
  ).toHaveValue(new RegExp(`#invite=${invitationToken}$`))
  await expect
    .poll(() => page.evaluate((key) => sessionStorage.getItem(key), pendingStorageKey))
    .toBeNull()

  const intentCalls = state.functionCalls.filter(
    ({ body, functionName }) =>
      functionName === 'manage-admin-ledger' && body.stage === 'intent',
  )
  const beginCalls = state.functionCalls.filter(
    ({ body, functionName }) =>
      functionName === 'admin-identity-session' &&
      body.action === 'beginControlStepUp',
  )
  const completeCalls = state.functionCalls.filter(
    ({ body, functionName }) =>
      functionName === 'admin-identity-session' &&
      body.action === 'completeControlStepUp',
  )
  expect(intentCalls).toHaveLength(1)
  expect(beginCalls).toHaveLength(1)
  expect(completeCalls).toHaveLength(1)
  expect(state.commitBodies).toHaveLength(2)
  expect(state.commitBodies[1]).toEqual(state.commitBodies[0])
  expect(state.commitBodies[0]?.requestId).toBe(intentCalls[0]?.body.requestId)
  expect(state.commitBodies[0]?.intentDigest).toBe(intentDigest)
  expect(beginCalls[0]?.body).toMatchObject({
    appSessionToken,
    controlAction: 'admin_invitation_change',
    controlIntentDigest: intentDigest,
    controlOperationKey: 'manage-admin-ledger.issueInvitation',
    controlRequestId: intentCalls[0]?.body.requestId,
  })
  expect(completeCalls[0]?.body).toMatchObject({
    appSessionToken,
    controlAction: 'admin_invitation_change',
    controlIntentDigest: intentDigest,
    controlOperationKey: 'manage-admin-ledger.issueInvitation',
    controlRequestId: intentCalls[0]?.body.requestId,
  })
  expect(
    state.authRequests.filter(({ pathname }) => pathname.includes('/challenge')),
  ).toHaveLength(1)
  expect(
    state.authRequests.filter(({ pathname }) => pathname.includes('/verify')),
  ).toHaveLength(1)
  expect(state.anonymousRequests).toBe(0)
  expect(
    state.functionCalls.some(
      ({ functionName }) => functionName === 'verify-admin-pin',
    ),
  ).toBe(false)
  expect(
    state.functionCalls.every(
      ({ authorization, body }) =>
        authorization === `Bearer ${admin.access_token}` &&
        body.appSessionToken === appSessionToken &&
        !('adminToken' in body) &&
        !('pin' in body),
    ),
  ).toBe(true)
  expect(
    state.authRequests.some(
      ({ authorization }) => authorization === `Bearer ${student.accessToken}`,
    ),
  ).toBe(false)
  expect(state.unexpectedRequests).toEqual([])
  expect(pageErrors).toEqual([])

  if (testInfo.project.name === 'mobile-webkit') {
    const accessibility = await new AxeBuilder({ page })
      .include('.admin-ledger-panel')
      .analyze()
    expect(
      accessibility.violations
        .filter((violation) =>
          ['critical', 'serious'].includes(violation.impact ?? ''),
        )
        .map((violation) => violation.id),
    ).toEqual([])
    await expect
      .poll(() =>
        page.evaluate(() => {
          const panel = document.querySelector<HTMLElement>('.admin-ledger-panel')
          return Boolean(
            panel &&
              document.documentElement.scrollWidth <=
                document.documentElement.clientWidth + 1 &&
              panel.scrollWidth <= panel.clientWidth + 1,
          )
        }),
      )
      .toBe(true)
  }
})
