import { AxeBuilder } from '@axe-core/playwright'
import { expect, test, type Page, type Route } from '@playwright/test'

test.skip(
  process.env.VITE_PHASE7_29_POWERPOINT_SYNC !== 'true',
  'Phase 7.29 Presenter sync requires its dedicated flag-on runner.',
)

const adminToken = 'admin-session-playwright-phase729-1234567890'
const lectureSessionId = '72900000-0000-4000-8000-000000000001'
const connectionId = '72900000-0000-4000-8000-000000000002'
const documentId = 'phase729-presenter-e2e'
const documentVersion = 'a'.repeat(64)
const lecturePublicId = 'phase729-public'
const pairingTicket = `eyJhbGciOiJIUzI1NiJ9.${'b'.repeat(43)}`
const workerAccessToken = `eyJhbGciOiJIUzI1NiJ9.${'c'.repeat(43)}`

type PresenterAction = 'confirm' | 'issue' | 'revoke' | 'status'

type MockState = {
  confirmed: boolean
  connectionIssued: boolean
  delayedStatusDelivered: Promise<void>
  delayedStatusRequested: Promise<void>
  localActivationFailure: boolean
  manualRecovery: boolean
  manualStatusPollsBeforeInspect: number
  manualStatusPollsAfterConfirm: number
  presenterActions: PresenterAction[]
  presenterActive: boolean
  releaseDelayedStatus: () => void
  revoked: boolean
}

type NetworkMockOptions = {
  delayFirstStatus?: boolean
  expiredAutomaticTicket?: boolean
  localActivationFailure?: boolean
  manualRecovery?: boolean
}

function createDeferred() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = () => done()
  })
  return { promise, resolve }
}

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
    title: 'Phase 7.29 Presenter E2E',
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
            ends_at: lectureResponse().endsAt,
            hard_stop_at: lectureResponse().hardStopAt,
            lecture_session_id: lectureSessionId,
            starts_at: lectureResponse().startsAt,
            status: 'open',
            title: lectureResponse().title,
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

function presenterStatus(
  state: 'active' | 'confirmed' | 'inspected' | 'pairing' = 'active',
) {
  const now = Date.now()
  return {
    capabilityExpiresAt:
      state === 'active' ? new Date(now + 60 * 60_000).toISOString() : null,
    confirmedAt:
      state === 'confirmed' || state === 'active'
        ? new Date(now).toISOString()
        : null,
    connectionId,
    customShowActive: state === 'pairing' ? null : false,
    hardStopAt: new Date(now + 60 * 60_000).toISOString(),
    hiddenSlideCount: state === 'pairing' ? null : 0,
    lastCommittedPdfPage: state === 'active' ? 1 : null,
    lastSeenAt: new Date(now).toISOString(),
    lastSequence: 0,
    pdfDocumentId: documentId,
    pdfDocumentVersion: documentVersion,
    pdfPageCount: 3,
    pptxFileSha256: state === 'pairing' ? null : 'e'.repeat(64),
    revokedAt: null,
    revokeReason: null,
    slideCount: state === 'pairing' ? null : 3,
    slideIdOrderSha256: state === 'pairing' ? null : 'f'.repeat(64),
    state,
    ticketExpiresAt: new Date(now + 5 * 60_000).toISOString(),
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
        'Phase 7.29 Presenter E2E',
      )
      window.localStorage.setItem('compass-interactive-lecture-status', 'open')
    },
    { adminToken, lectureSessionId },
  )
}

async function installNetworkMocks(
  page: Page,
  options: NetworkMockOptions = {},
) {
  const delayedStatusRequest = createDeferred()
  const delayedStatusRelease = createDeferred()
  const delayedStatusDelivery = createDeferred()
  let delayedStatusHeld = false
  const state: MockState = {
    confirmed: false,
    connectionIssued: false,
    delayedStatusDelivered: delayedStatusDelivery.promise,
    delayedStatusRequested: delayedStatusRequest.promise,
    localActivationFailure: options.localActivationFailure ?? false,
    manualRecovery: options.manualRecovery ?? false,
    manualStatusPollsBeforeInspect: 0,
    manualStatusPollsAfterConfirm: 0,
    presenterActions: [],
    presenterActive: false,
    releaseDelayedStatus: delayedStatusRelease.resolve,
    revoked: false,
  }
  const appBaseUrl = process.env.PLAYWRIGHT_BASE_URL
  if (!appBaseUrl) throw new Error('PLAYWRIGHT_BASE_URL is required.')

  await page.route('https://pdf.example/**', async (route) => {
    const url = new URL(route.request().url())
    expect(route.request().headers().authorization).toBe(
      `Bearer ${workerAccessToken}`,
    )
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
      expect(body.action).toBe('admin')
      expect(body.adminToken).toBe(adminToken)
      expect(body.lectureSessionId).toBe(lectureSessionId)
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
      const action = body.action as PresenterAction
      state.presenterActions.push(action)
      expect(body.adminToken).toBe(adminToken)
      if (action === 'issue') {
        expect(body.lectureSessionId).toBe(lectureSessionId)
        state.connectionIssued = true
        const now = Date.now()
        await fulfillJson(route, {
          connectionId,
          hardStopAt: new Date(now + 60 * 60_000).toISOString(),
          manualCode: 'ABCD2345',
          ok: true,
          pairingTicketExpiresAt: new Date(
            now + (options.expiredAutomaticTicket ? -1_000 : 45_000),
          ).toISOString(),
          pairingTicket,
          pdf: {
            documentId,
            documentVersion,
            manifestVersion: 1,
            pageCount: 3,
          },
          ticketExpiresAt: new Date(now + 5 * 60_000).toISOString(),
        })
        return
      }
      if (action === 'confirm') {
        expect(body.connectionId).toBe(connectionId)
        state.confirmed = true
        if (!state.manualRecovery && !state.localActivationFailure) {
          state.presenterActive = true
        }
        await fulfillJson(route, {
          connectionId,
          ok: true,
          pdfPageCount: 3,
          state: 'confirmed',
        })
        return
      }
      if (action === 'status') {
        expect(body.lectureSessionId).toBe(lectureSessionId)
        let connection = null
        if (state.connectionIssued && !state.revoked) {
          if (state.manualRecovery && !state.confirmed) {
            state.manualStatusPollsBeforeInspect += 1
            connection = presenterStatus(
              state.manualStatusPollsBeforeInspect >= 2
                ? 'inspected'
                : 'pairing',
            )
          } else if (state.manualRecovery && state.confirmed) {
            state.manualStatusPollsAfterConfirm += 1
            if (state.manualStatusPollsAfterConfirm >= 3) {
              state.presenterActive = true
            }
            connection = presenterStatus(
              state.presenterActive ? 'active' : 'confirmed',
            )
          } else if (state.presenterActive) {
            connection = presenterStatus()
          } else if (state.localActivationFailure && state.confirmed) {
            connection = presenterStatus('confirmed')
          } else {
            connection = presenterStatus('inspected')
          }
        }
        const shouldDelayStatus =
          options.delayFirstStatus === true && !delayedStatusHeld
        if (shouldDelayStatus) {
          delayedStatusHeld = true
          delayedStatusRequest.resolve()
          await delayedStatusRelease.promise
        }
        await fulfillJson(route, {
          connection,
          ok: true,
          runtimeEnabled: true,
        })
        if (shouldDelayStatus) {
          delayedStatusDelivery.resolve()
        }
        return
      }
      if (action === 'revoke') {
        expect(body.connectionId).toBe(connectionId)
        state.presenterActive = false
        state.revoked = true
        await fulfillJson(route, {
          connectionId,
          ok: true,
          revokeReason: 'manual_handover',
          revokedAt: new Date().toISOString(),
          state: 'revoked',
        })
        return
      }
    }
    await fulfillJson(route, { ok: true })
  })

  return state
}

async function expectNoSeriousAccessibilityViolations(page: Page) {
  const result = await new AxeBuilder({ page }).analyze()
  expect(
    result.violations
      .filter((violation) =>
        ['critical', 'serious'].includes(violation.impact ?? ''),
      )
      .map((violation) => violation.id),
  ).toEqual([])
}

test('reviews, explicitly confirms, locks manual PDF controls, and hands back safely', async ({
  page,
}) => {
  const pageErrors: string[] = []
  page.on('pageerror', (error) => pageErrors.push(error.message))
  await installAdminState(page)
  const state = await installNetworkMocks(page)

  await page.goto('/admin')
  const pdfPanel = page.locator('#admin-live')
  const presenter = page.getByTestId('powerpoint-sync-control')
  await expect(presenter).toBeVisible()
  await expect(pdfPanel.getByRole('button', { name: '次へ →' })).toBeEnabled()

  const loopbackHealth = await page.evaluate(async () => {
    try {
      const response = await fetch('http://127.0.0.1:43124/v1/health', {
        cache: 'no-store',
        credentials: 'omit',
        mode: 'cors',
        redirect: 'manual',
        referrerPolicy: 'no-referrer',
      })
      return {
        body: await response.json(),
        error: null,
        status: response.status,
      }
    } catch (error) {
      return {
        body: null,
        error: error instanceof Error ? error.message : String(error),
        status: 0,
      }
    }
  })
  expect(loopbackHealth).toEqual({
    body: {
      ok: true,
      protocolVersion: 1,
      service: 'compass-presenter-bridge',
    },
    error: null,
    status: 200,
  })

  await presenter.getByRole('button', { name: 'PowerPointと同期' }).click()
  const review = page.locator('.admin-presenter-review')
  await expect(review).toBeVisible()
  await expect(review).toContainText('Phase 7.29 test presentation.pptx')
  await expect(review).toContainText('3スライド')
  await expect(review).toContainText('Phase 7.29 lecture.pdf')
  await expect(review).toContainText('3ページ')
  await expect(
    review.getByRole('button', {
      name: 'このPowerPointと講義資料を同期',
    }),
  ).toBeEnabled()
  await expect(pdfPanel.getByRole('button', { name: '次へ →' })).toBeEnabled()
  await expect(review.locator('canvas')).toBeVisible()

  await page.setViewportSize({ height: 844, width: 390 })
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          document.documentElement.scrollWidth <=
          document.documentElement.clientWidth + 1,
      ),
    )
    .toBe(true)
  await expectNoSeriousAccessibilityViolations(page)

  await review
    .getByRole('button', { name: 'このPowerPointと講義資料を同期' })
    .click()
  const active = page.locator('.admin-presenter-active')
  await expect(active).toContainText('PowerPoint同期中')
  await expect(pdfPanel.getByRole('button', { name: '次へ →' })).toBeDisabled()
  await expect(pdfPanel.getByLabel('表示するページ番号')).toBeDisabled()
  await expect(pdfPanel.getByLabel('PDF資料')).toBeDisabled()
  expect(state.presenterActions).toEqual(
    expect.arrayContaining(['issue', 'confirm', 'status']),
  )

  await active.getByRole('button', { name: '手動操作へ切り替える' }).click()
  await expect(presenter).toBeVisible()
  await expect(pdfPanel.getByRole('button', { name: '次へ →' })).toBeEnabled()
  await expect(pdfPanel.getByLabel('表示するページ番号')).toBeEnabled()
  await expect(pdfPanel.getByLabel('PDF資料')).toBeEnabled()
  expect(state.presenterActions.at(-1)).toBe('revoke')
  expect(pageErrors).toEqual([])
})

test('recovers without localhost access, confirms once, and reaches active sync', async ({
  page,
}) => {
  const pageErrors: string[] = []
  const loopbackRequests: string[] = []
  page.on('pageerror', (error) => pageErrors.push(error.message))
  await page.route('http://127.0.0.1:43124/**', async (route) => {
    loopbackRequests.push(new URL(route.request().url()).pathname)
    await route.abort('connectionrefused')
  })
  await installAdminState(page)
  const state = await installNetworkMocks(page, { manualRecovery: true })

  await page.goto('/admin')
  const pdfPanel = page.locator('#admin-live')
  const presenter = page.getByTestId('powerpoint-sync-control')
  await presenter.getByRole('button', { name: 'PowerPointと同期' }).click()

  const recovery = page.locator('.admin-presenter-recovery-panel')
  await expect(recovery).toBeVisible()
  await expect(recovery).toContainText('復旧コードで接続')
  await expect(recovery.locator('.admin-presenter-recovery-code')).toHaveText(
    'ABCD2345',
  )
  expect(loopbackRequests).toEqual(['/v1/health'])

  const review = page.locator('.admin-presenter-review')
  await expect(review).toBeVisible()
  await expect(review).toContainText('接続中のPowerPoint')
  await expect(review).toContainText('3スライド')
  await expect(review).toContainText('Phase 7.29 lecture.pdf')
  await expect(
    review.getByRole('button', {
      name: 'このPowerPointと講義資料を同期',
    }),
  ).toBeEnabled()
  await expect(pdfPanel.getByRole('button', { name: '次へ →' })).toBeEnabled()

  await review
    .getByRole('button', { name: 'このPowerPointと講義資料を同期' })
    .click()
  await expect(page.locator('.admin-presenter-recovery-panel')).toContainText(
    'Presenter Bridgeの接続待ち',
  )

  const active = page.locator('.admin-presenter-active')
  await expect(active).toContainText('PowerPoint同期中')
  await expect(pdfPanel.getByRole('button', { name: '次へ →' })).toBeDisabled()
  expect(
    state.presenterActions.filter((action) => action === 'issue'),
  ).toHaveLength(1)
  expect(
    state.presenterActions.filter((action) => action === 'confirm'),
  ).toHaveLength(1)
  expect(loopbackRequests).toEqual(['/v1/health'])
  expect(pageErrors).toEqual([])
})

test('moves an expired automatic ticket to the five-minute recovery path without confirming', async ({
  page,
}) => {
  await installAdminState(page)
  const state = await installNetworkMocks(page, {
    expiredAutomaticTicket: true,
  })

  await page.goto('/admin')
  const presenter = page.getByTestId('powerpoint-sync-control')
  await presenter.getByRole('button', { name: 'PowerPointと同期' }).click()
  const review = page.locator('.admin-presenter-review')
  await expect(review).toBeVisible()
  await review
    .getByRole('button', { name: 'このPowerPointと講義資料を同期' })
    .click()

  const recovery = page.locator('.admin-presenter-recovery-panel')
  await expect(recovery).toBeVisible()
  await expect(recovery.locator('.admin-presenter-recovery-code')).toHaveText(
    'ABCD2345',
  )
  expect(
    state.presenterActions.filter((action) => action === 'confirm'),
  ).toHaveLength(0)
})

test('keeps the recovery code available when local activation fails after confirmation', async ({
  page,
}) => {
  const appBaseUrl = process.env.PLAYWRIGHT_BASE_URL
  if (!appBaseUrl) throw new Error('PLAYWRIGHT_BASE_URL is required.')
  await page.route('http://127.0.0.1:43124/v1/connect', async (route) => {
    const body = route.request().postDataJSON() as Record<
      string,
      unknown
    > | null
    if (body?.action !== 'activate') {
      await route.continue()
      return
    }
    await route.fulfill({
      body: JSON.stringify({
        code: 'invalid_session',
        message: 'Request rejected.',
        ok: false,
      }),
      contentType: 'application/json',
      headers: {
        'Access-Control-Allow-Origin': new URL(appBaseUrl).origin,
        'Cache-Control': 'no-store',
        Vary: 'Origin',
      },
      status: 401,
    })
  })
  await installAdminState(page)
  const state = await installNetworkMocks(page, {
    delayFirstStatus: true,
    localActivationFailure: true,
  })

  await page.goto('/admin')
  const presenter = page.getByTestId('powerpoint-sync-control')
  await presenter.getByRole('button', { name: 'PowerPointと同期' }).click()
  const review = page.locator('.admin-presenter-review')
  await expect(review).toBeVisible()
  await state.delayedStatusRequested
  await review
    .getByRole('button', { name: 'このPowerPointと講義資料を同期' })
    .click()

  const recovery = page.locator('.admin-presenter-recovery-panel')
  await expect(recovery).toBeVisible({ timeout: 17_000 })
  await expect(recovery.locator('.admin-presenter-recovery-code')).toHaveText(
    'ABCD2345',
  )
  state.releaseDelayedStatus()
  await state.delayedStatusDelivered
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
      }),
  )
  await expect(recovery).toBeVisible()
  await expect(recovery.locator('.admin-presenter-recovery-code')).toHaveText(
    'ABCD2345',
  )
  await expect(review).toBeHidden()
  expect(
    state.presenterActions.filter((action) => action === 'confirm'),
  ).toHaveLength(1)
})
