import { AxeBuilder } from '@axe-core/playwright'
import {
  expect,
  test,
  type Locator,
  type Page,
  type Route,
} from '@playwright/test'
import {
  createMockGoogleAdminSession,
  expectMockGoogleAdminCredential,
  fulfillMockGoogleAdminRequest,
  installMockGoogleAdminSession,
} from '../helpers/mockGoogleAdminSession.js'

test.skip(
  process.env.VITE_PHASE7_29_POWERPOINT_SYNC !== 'true',
  'Phase 7.29 Presenter sync requires its dedicated flag-on runner.',
)

const googleAdmin = createMockGoogleAdminSession()
const lectureSessionId = '72900000-0000-4000-8000-000000000001'
const connectionId = '72900000-0000-4000-8000-000000000002'
const documentId = 'phase729-presenter-e2e'
const documentVersion = 'a'.repeat(64)
const lecturePublicId = 'phase729-public'
const pairingTicket = `eyJhbGciOiJIUzI1NiJ9.${'b'.repeat(43)}`
const workerAccessToken = `eyJhbGciOiJIUzI1NiJ9.${'c'.repeat(43)}`

type PresenterAction = 'confirm' | 'issue' | 'revoke' | 'status'

type MockState = {
  completeManualClaim: () => void
  completeManualInspect: () => void
  completeServerActivation: () => void
  completeServerTermination: () => void
  confirmed: boolean
  connectionIssued: boolean
  localActivationFailure: boolean
  manualClaimed: boolean
  manualInspected: boolean
  manualRecovery: boolean
  presenterActions: PresenterAction[]
  presenterActive: boolean
  presenterLastSeenAt: string
  revoked: boolean
  revokeReason: string
  maximumStatusConcurrency: number
  statusConcurrency: number
  currentConnectionId: string
  revokedConnectionIds: string[]
  currentLectureSessionId: string
}

type NetworkMockOptions = {
  expiredAutomaticTicket?: boolean
  localActivationFailure?: boolean
  manualRecovery?: boolean
  staleInspectedAfterConfirm?: boolean
  statusDelayMs?: number
  lectureStatus?: 'draft' | 'open'
  additionalAppToken?: string
}

function createDeferred() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

async function dispatchEnabledClick(locator: Locator) {
  await expect(locator).toBeEnabled()
  await locator.dispatchEvent('click')
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
  lastSeenAt = new Date().toISOString(),
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
    lastSeenAt,
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
  await installMockGoogleAdminSession(page, googleAdmin, {
    localStorage: {
      'compass-interactive-lecture-runtime-mode': 'live',
      'compass-interactive-lecture-session-id': lectureSessionId,
      'compass-interactive-lecture-status': 'open',
      'compass-interactive-lecture-title': 'Phase 7.29 Presenter E2E',
    },
  })
}

async function installNetworkMocks(
  page: Page,
  options: NetworkMockOptions = {},
  sharedState?: MockState,
) {
  const state: MockState = sharedState ?? {
    completeManualClaim: () => {
      state.manualClaimed = true
    },
    completeManualInspect: () => {
      if (state.manualInspected) return
      state.manualInspected = true
    },
    completeServerActivation: () => {
      state.presenterActive = true
    },
    completeServerTermination: () => {
      state.presenterActive = false
      state.revoked = true
      state.revokeReason = 'disconnected'
    },
    confirmed: false,
    connectionIssued: false,
    localActivationFailure: options.localActivationFailure ?? false,
    manualClaimed: false,
    manualInspected: false,
    manualRecovery: options.manualRecovery ?? false,
    presenterActions: [],
    presenterActive: false,
    presenterLastSeenAt: new Date().toISOString(),
    revoked: false,
    revokeReason: 'disconnected',
    maximumStatusConcurrency: 0,
    statusConcurrency: 0,
    currentConnectionId: connectionId,
    revokedConnectionIds: [],
    currentLectureSessionId: lectureSessionId,
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
    if (
      functionName !== 'lecture-live-snapshot' &&
      functionName !== 'manage-presenter-connection'
    ) {
      expectMockGoogleAdminCredential(body, googleAdmin)
    }
    if (functionName === 'manage-lectures') {
      await fulfillJson(route, {
        lectures: [
          { ...lectureResponse(), status: options.lectureStatus ?? 'open' },
        ],
        ok: true,
      })
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
      expect(body.appSessionToken).toBe(googleAdmin.appSessionToken)
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
      expect(
        [googleAdmin.appSessionToken, options.additionalAppToken].filter(
          Boolean,
        ),
      ).toContain(body.appSessionToken)
      expectMockGoogleAdminCredential(body, {
        ...googleAdmin,
        appSessionToken: String(body.appSessionToken),
      })
      if (action === 'issue') {
        expect(body.lectureSessionId).toBe(state.currentLectureSessionId)
        state.connectionIssued = true
        state.revoked = false
        state.confirmed = false
        state.presenterActive = false
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
        state.statusConcurrency += 1
        state.maximumStatusConcurrency = Math.max(
          state.maximumStatusConcurrency,
          state.statusConcurrency,
        )
        if (options.statusDelayMs)
          await new Promise((resolve) =>
            setTimeout(resolve, options.statusDelayMs),
          )
        expect(body.lectureSessionId).toBe(state.currentLectureSessionId)
        let connection = null
        if (state.connectionIssued && state.revoked) {
          connection = {
            ...presenterStatus('active'),
            state: 'revoked',
            revokedAt: new Date().toISOString(),
            revokeReason: state.revokeReason,
          }
        }
        if (state.connectionIssued && !state.revoked) {
          if (state.manualRecovery && !state.confirmed) {
            connection = presenterStatus(
              state.manualInspected ? 'inspected' : 'pairing',
              state.presenterLastSeenAt,
            )
          } else if (state.manualRecovery && state.confirmed) {
            if (state.manualClaimed) {
              state.presenterActive = true
            }
            connection = presenterStatus(
              state.presenterActive ? 'active' : 'confirmed',
              state.presenterLastSeenAt,
            )
          } else if (state.presenterActive) {
            connection = presenterStatus('active', state.presenterLastSeenAt)
          } else if (state.localActivationFailure && state.confirmed) {
            if (state.manualClaimed) {
              state.presenterActive = true
            }
            connection = presenterStatus(
              state.presenterActive
                ? 'active'
                : options.staleInspectedAfterConfirm
                  ? 'inspected'
                  : 'confirmed',
              state.presenterLastSeenAt,
            )
          } else {
            connection = presenterStatus('inspected', state.presenterLastSeenAt)
          }
        }
        await fulfillJson(route, {
          connection: connection
            ? { ...connection, connectionId: state.currentConnectionId }
            : null,
          ok: true,
          runtimeEnabled: true,
        })
        state.statusConcurrency -= 1
        return
      }
      if (action === 'revoke') {
        expect(body.connectionId).toBe(state.currentConnectionId)
        state.revokedConnectionIds.push(String(body.connectionId))
        state.presenterActive = false
        state.revoked = true
        state.revokeReason = 'manual_handover'
        await fulfillJson(route, {
          connectionId: state.currentConnectionId,
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

async function installLocalActivationFailure(page: Page, hold = false) {
  const appBaseUrl = process.env.PLAYWRIGHT_BASE_URL
  if (!appBaseUrl) throw new Error('PLAYWRIGHT_BASE_URL is required.')
  const started = createDeferred()
  const release = createDeferred()
  const completed = createDeferred()
  await page.route('http://127.0.0.1:43124/v1/connect', async (route) => {
    const body = route.request().postDataJSON() as Record<
      string,
      unknown
    > | null
    if (body?.action !== 'activate') {
      await route.continue()
      return
    }
    started.resolve()
    try {
      if (hold) await release.promise
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
    } finally {
      completed.resolve()
    }
  })
  return {
    completed: completed.promise,
    release: release.resolve,
    started: started.promise,
  }
}

async function holdLoopbackDisconnect(page: Page) {
  const appBaseUrl = process.env.PLAYWRIGHT_BASE_URL
  if (!appBaseUrl) throw new Error('PLAYWRIGHT_BASE_URL is required.')
  const started = createDeferred()
  const release = createDeferred()
  const completed = createDeferred()
  await page.route('http://127.0.0.1:43124/v1/disconnect', async (route) => {
    if (route.request().method() !== 'POST') {
      await route.continue()
      return
    }
    started.resolve()
    try {
      await release.promise
      await route.fulfill({
        body: JSON.stringify({ ok: true, state: 'disconnected' }),
        contentType: 'application/json',
        headers: {
          'Access-Control-Allow-Origin': new URL(appBaseUrl).origin,
          'Cache-Control': 'no-store',
          Vary: 'Origin',
        },
        status: 200,
      })
    } finally {
      completed.resolve()
    }
  })
  return {
    completed: completed.promise,
    release: release.resolve,
    started: started.promise,
  }
}

async function startRecoveryPanelObserver(page: Page) {
  await page.evaluate(() => {
    document.documentElement.dataset.presenterRecoveryReappeared = 'false'
    const observer = new MutationObserver(() => {
      if (document.querySelector('.admin-presenter-recovery-panel')) {
        document.documentElement.dataset.presenterRecoveryReappeared = 'true'
      }
    })
    observer.observe(document.body, {
      attributes: true,
      childList: true,
      subtree: true,
    })
  })
}

async function recoveryPanelReappeared(page: Page) {
  return page.evaluate(
    () =>
      document.documentElement.dataset.presenterRecoveryReappeared === 'true',
  )
}

async function waitForAnimationFrames(page: Page, count: number) {
  await page.evaluate(
    (frameCount) =>
      new Promise<void>((resolve) => {
        let remainingFrames = frameCount
        const advance = () => {
          remainingFrames -= 1
          if (remainingFrames === 0) resolve()
          else requestAnimationFrame(advance)
        }
        requestAnimationFrame(advance)
      }),
    count,
  )
}

async function startAutomaticPresenterReview(page: Page) {
  await page.goto('/admin')
  const review = page.locator('.admin-presenter-review')
  await expect(review).toBeVisible()
  return review
}

async function confirmPresenterMaterial(page: Page) {
  const button = page.getByRole('button', { name: 'この組合せで同期する' })
  await expect(button).toBeEnabled()
  await button.scrollIntoViewIfNeeded()
  // WebKit can finish an automatic scroll after actionability is checked.
  // Wait for the actual CTA geometry to settle, then make one ordinary click.
  await expect
    .poll(async () => {
      const before = await button.boundingBox()
      await waitForAnimationFrames(page, 4)
      const after = await button.boundingBox()
      const viewport = page.viewportSize()
      if (!before || !after || !viewport) return false
      return (
        Math.abs(before.x - after.x) < 0.5 &&
        Math.abs(before.y - after.y) < 0.5 &&
        Math.abs(before.width - after.width) < 0.5 &&
        Math.abs(before.height - after.height) < 0.5 &&
        after.x >= 0 &&
        after.y >= 0 &&
        after.x + after.width <= viewport.width &&
        after.y + after.height <= viewport.height
      )
    })
    .toBe(true)
  await button.click()
}

async function mountHookHarness(page: Page, expectedPhase = 'active') {
  await page.goto('/demo')
  await page.evaluate(async (adminToken) => {
    const path = '/e2e/helpers/presenterHookHarness.tsx'
    const harness = await import(path)
    harness.mountPresenterHookHarness({
      activeLectureSessionId: '72900000-0000-4000-8000-000000000001',
      adminToken: { kind: 'google', appSessionToken: adminToken },
      enabled: true,
      lectureStatus: 'open',
      materialConsentScope: 'test-owner',
      displayState: {
        lectureSessionId: '72900000-0000-4000-8000-000000000001',
        currentPdfPage: 1,
        displayMode: 'normal',
        pdfDocumentId: 'phase729-presenter-e2e',
        pdfDocumentVersion: 'a'.repeat(64),
        pdfPageCount: 3,
        pdfManifestVersion: 1,
        pdfVisible: true,
        updatedAt: new Date().toISOString(),
      },
    })
  }, googleAdmin.appSessionToken)
  await expect(page.getByTestId('presenter-hook-phase')).toHaveText(
    expectedPhase,
  )
}

async function fulfillReadiness(route: Route, ready: boolean) {
  const response = await route.fetch()
  await route.fulfill({
    response,
    json: {
      ok: true,
      protocolVersion: 1,
      service: 'compass-presenter-bridge',
      powerpointReady: ready,
      powerpointIssue: ready ? null : 'powerpoint_not_running',
    },
  })
}

async function setPageVisibility(page: Page, visible: boolean) {
  await page.evaluate((visible) => {
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: visible ? 'visible' : 'hidden',
    })
    document.dispatchEvent(new Event('visibilitychange'))
  }, visible)
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
  await expect(page.locator('.admin-presenter-review')).toBeVisible()
  await expect(page.getByRole('button', { name: '次へ →' })).toBeEnabled()

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
      powerpointReady: true,
      powerpointIssue: null,
      protocolVersion: 1,
      service: 'compass-presenter-bridge',
    },
    error: null,
    status: 200,
  })

  const review = page.locator('.admin-presenter-review')
  await expect(review).toBeVisible()
  await expect(review).toContainText('Phase 7.29 test presentation.pptx')
  await expect(review).toContainText('3スライド')
  await expect(review).toContainText('Phase 7.29 lecture.pdf')
  await expect(review).toContainText('3ページ')
  await expect(review.locator('.admin-presenter-recovery-code')).toHaveCount(0)
  await expect(
    review.getByRole('button', {
      name: 'この組合せで同期する',
    }),
  ).toBeEnabled()
  await expect(page.getByRole('button', { name: '次へ →' })).toBeEnabled()
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

  await confirmPresenterMaterial(page)
  const active = page.locator('.admin-presenter-active')
  await expect(active).toContainText('PowerPoint同期中')
  await expect(page.getByRole('button', { name: '次へ →' })).toBeDisabled()
  await expect(page.getByLabel('表示するページ番号')).toBeDisabled()
  await expect(pdfPanel.getByLabel('PDF資料')).toBeDisabled()
  expect(state.presenterActions).toEqual(
    expect.arrayContaining(['issue', 'confirm', 'status']),
  )

  await active.getByRole('button', { name: '手動操作へ切り替える' }).click()
  await page.getByRole('tab', { name: '準備' }).click()
  await expect(presenter).toBeVisible()
  await expect(page.getByRole('button', { name: '次へ →' })).toBeEnabled()
  await expect(page.getByLabel('表示するページ番号')).toBeEnabled()
  await expect(pdfPanel.getByLabel('PDF資料')).toBeEnabled()
  expect(state.presenterActions.at(-1)).toBe('revoke')
  expect(pageErrors).toEqual([])
})

test('health precedes issuance, and tab changes and reload preserve native ownership', async ({
  page,
}) => {
  await installAdminState(page)
  const state = await installNetworkMocks(page)
  const operations: string[] = []
  page.on('request', (request) => {
    if (request.url().endsWith('/v1/health')) operations.push('health')
    if (request.url().endsWith('/manage-presenter-connection')) {
      operations.push(String(request.postDataJSON().action))
    }
  })
  await startAutomaticPresenterReview(page)
  expect(operations.indexOf('health')).toBeLessThan(operations.indexOf('issue'))
  await confirmPresenterMaterial(page)
  await expect(page.locator('.admin-presenter-active')).toBeVisible()
  for (const name of ['参加', 'AI', 'スライド']) {
    await page.getByRole('tab', { name }).click()
    await expect(page.locator('.admin-presenter-active')).toBeVisible()
    await expect(page.getByRole('button', { name: '次へ →' })).toBeDisabled()
  }
  await page.reload()
  await expect(page.locator('.admin-presenter-active')).toBeVisible()
  await expect(page.getByRole('button', { name: '次へ →' })).toBeDisabled()
  expect(
    state.presenterActions.filter((action) => action === 'issue'),
  ).toHaveLength(1)
  expect(
    state.presenterActions.filter((action) => action === 'confirm'),
  ).toHaveLength(1)
  expect(
    state.presenterActions.filter((action) => action === 'revoke'),
  ).toHaveLength(0)
  await page.getByRole('button', { name: '手動操作へ切り替える' }).click()
  await expect(page.getByRole('button', { name: '次へ →' })).toBeEnabled()
})

test('reuses one material confirmation after restart for the exact same deck and PDF', async ({
  page,
}) => {
  await installAdminState(page)
  const state = await installNetworkMocks(page)
  await startAutomaticPresenterReview(page)
  await confirmPresenterMaterial(page)
  await expect(page.locator('.admin-presenter-active')).toBeVisible()
  await page.getByRole('button', { name: '手動操作へ切り替える' }).click()
  await expect(page.getByRole('button', { name: '次へ →' })).toBeEnabled()
  await page.reload()
  await page.getByRole('tab', { name: '準備' }).click()
  await expect(page.getByTestId('powerpoint-sync-control')).toContainText(
    '手動スライド操作を利用中',
  )
  expect(
    state.presenterActions.filter((action) => action === 'issue'),
  ).toHaveLength(1)
  await page.getByRole('button', { name: 'Bridgeの接続を確認' }).click()
  await expect(page.locator('.admin-presenter-active')).toBeVisible()
  await expect(page.locator('.admin-presenter-recovery-code')).toHaveCount(0)
  expect(
    state.presenterActions.filter((action) => action === 'issue'),
  ).toHaveLength(2)
  expect(
    state.presenterActions.filter((action) => action === 'confirm'),
  ).toHaveLength(2)
  const stored = await page.evaluate(() =>
    localStorage.getItem('compass-presenter-material-consent-v1'),
  )
  expect(JSON.parse(stored ?? '[]')).toEqual([
    expect.stringMatching(/^[a-f0-9]{64}$/),
  ])
})

test('requires a new material check when the deck fingerprint changes', async ({
  page,
}) => {
  await installAdminState(page)
  const state = await installNetworkMocks(page)
  const review = await startAutomaticPresenterReview(page)
  await confirmPresenterMaterial(page)
  await expect(page.locator('.admin-presenter-active')).toBeVisible()
  await page.getByRole('button', { name: '手動操作へ切り替える' }).click()
  await expect(page.getByRole('button', { name: '次へ →' })).toBeEnabled()
  await page.route('http://127.0.0.1:43124/v1/connect', async (route) => {
    const response = await route.fetch()
    const body = await response.json()
    if (body.presentation) body.presentation.bindingDigest = 'b'.repeat(64)
    await route.fulfill({ response, json: body })
  })
  await page.reload()
  await page.getByRole('tab', { name: '準備' }).click()
  await expect(
    page.getByRole('button', { name: 'Bridgeの接続を確認' }),
  ).toBeEnabled()
  await page.getByRole('button', { name: 'Bridgeの接続を確認' }).click()
  await expect(review).toBeVisible()
  await expect(
    review.getByRole('button', { name: 'この組合せで同期する' }),
  ).toBeEnabled()
  await page.waitForTimeout(1_200)
  expect(
    state.presenterActions.filter((action) => action === 'confirm'),
  ).toHaveLength(1)
})

test('waits for slow status completion before scheduling another request', async ({
  page,
}) => {
  await installAdminState(page)
  const state = await installNetworkMocks(page, { statusDelayMs: 1_600 })
  await startAutomaticPresenterReview(page)
  await expect
    .poll(
      () =>
        state.presenterActions.filter((action) => action === 'status').length,
    )
    .toBeGreaterThanOrEqual(3)
  expect(state.maximumStatusConcurrency).toBe(1)
})

test('prepares local-network access before lecture start without issuing server credentials', async ({
  page,
}) => {
  await installAdminState(page)
  const state = await installNetworkMocks(page, { lectureStatus: 'draft' })
  const loopback: string[] = []
  page.on('request', (request) => {
    if (request.url().startsWith('http://127.0.0.1:43124/'))
      loopback.push(new URL(request.url()).pathname)
  })
  await page.goto('/admin')
  await page.getByRole('tab', { name: '準備' }).click()
  await expect(
    page.getByRole('link', { name: 'Bridgeをインストール' }),
  ).toHaveAttribute(
    'href',
    'https://presenter-updates.yuto-matsui.com/versions/0.1.0/CompassPresenterBridge-0.1.0-win-x64-Setup.exe',
  )
  await page.getByRole('button', { name: 'Bridgeの接続を確認' }).click()
  await expect(page.getByTestId('powerpoint-sync-control')).toContainText(
    'Bridgeの準備ができました',
  )
  expect(loopback).toEqual(['/v1/health'])
  expect(state.presenterActions).toEqual([])
  await expect(page.locator('.admin-presenter-recovery-code')).toHaveCount(0)
})

test('serializes simultaneous tabs and never reconnects after handover in another tab', async ({
  page,
  context,
}) => {
  await installAdminState(page)
  const state = await installNetworkMocks(page)
  const other = await context.newPage()
  await installAdminState(other)
  await installNetworkMocks(other, {}, state)
  await Promise.all([page.goto('/admin'), other.goto('/admin')])
  await expect
    .poll(
      async () =>
        (await page.locator('.admin-presenter-review').count()) +
        (await other.locator('.admin-presenter-review').count()),
    )
    .toBe(1)
  const controller = (await page.locator('.admin-presenter-review').isVisible())
    ? page
    : other
  const observer = controller === page ? other : page
  await expect(
    observer.getByRole('button', { name: 'この画面で接続を引き継ぐ' }),
  ).toBeVisible()
  expect(
    state.presenterActions.filter((action) => action === 'issue'),
  ).toHaveLength(1)
  await confirmPresenterMaterial(controller)
  await expect(observer.locator('.admin-presenter-active')).toBeVisible()
  await controller.route('http://127.0.0.1:43124/v1/status', async (route) => {
    const response = await route.fetch()
    await route.fulfill({
      response,
      json: {
        ok: true,
        state: 'faulted',
        lastErrorCode: 'presenter_session_stopped',
        presentation: null,
      },
    })
  })
  await observer.getByRole('button', { name: '手動操作へ切り替える' }).click()
  await expect(controller.getByRole('button', { name: '次へ →' })).toBeEnabled()
  await page.waitForTimeout(1_500)
  expect(
    state.presenterActions.filter((action) => action === 'issue'),
  ).toHaveLength(1)
  await other.close()
})

test('leaving a passive pending observer preserves the originating setup', async ({
  page,
  context,
}) => {
  await installAdminState(page)
  const state = await installNetworkMocks(page)
  await startAutomaticPresenterReview(page)
  const observer = await context.newPage()
  await installAdminState(observer)
  await installNetworkMocks(observer, {}, state)
  await observer.goto('/admin')
  await expect(
    observer.getByRole('button', { name: 'この画面で接続を引き継ぐ' }),
  ).toBeVisible()
  await observer.goto('/demo')
  await observer.close()
  const count = state.presenterActions.filter(
    (action) => action === 'status',
  ).length
  await expect
    .poll(
      () =>
        state.presenterActions.filter((action) => action === 'status').length,
    )
    .toBeGreaterThan(count)
  expect(
    state.presenterActions.filter((action) => action === 'revoke'),
  ).toHaveLength(0)
  await confirmPresenterMaterial(page)
  await expect(page.locator('.admin-presenter-active')).toBeVisible()
})

test('hands over the server replacement connection rather than a stale local ID', async ({
  page,
}) => {
  await installAdminState(page)
  const state = await installNetworkMocks(page)
  await startAutomaticPresenterReview(page)
  await confirmPresenterMaterial(page)
  await expect(page.locator('.admin-presenter-active')).toBeVisible()
  state.currentConnectionId = '72900000-0000-4000-8000-000000000003'
  const count = state.presenterActions.filter(
    (action) => action === 'status',
  ).length
  await expect
    .poll(
      () =>
        state.presenterActions.filter((action) => action === 'status').length,
    )
    .toBeGreaterThan(count)
  await waitForAnimationFrames(page, 2)
  await page.getByRole('button', { name: '手動操作へ切り替える' }).click()
  await expect(page.getByRole('button', { name: '次へ →' })).toBeEnabled()
  expect(state.revokedConnectionIds).toEqual([state.currentConnectionId])
})

test('rediscovers native ownership when the ordinary application credential is replaced', async ({
  page,
}) => {
  const replacementToken = `${googleAdmin.appSessionToken.slice(0, -1)}Z`
  await installAdminState(page)
  const state = await installNetworkMocks(page, {
    additionalAppToken: replacementToken,
  })
  state.connectionIssued = true
  state.completeServerActivation()
  await mountHookHarness(page)
  const count = state.presenterActions.filter(
    (action) => action === 'status',
  ).length
  await page.evaluate(async (token) => {
    const path = '/e2e/helpers/presenterHookHarness.tsx'
    const harness = await import(path)
    harness.updatePresenterHookHarness({
      adminToken: { kind: 'google', appSessionToken: token },
    })
  }, replacementToken)
  await expect
    .poll(
      () =>
        state.presenterActions.filter((action) => action === 'status').length,
    )
    .toBeGreaterThan(count)
  await expect(page.getByTestId('presenter-hook-phase')).toHaveText('active')
  await expect(page.getByTestId('presenter-hook-locked')).toHaveText('true')
  expect(
    state.presenterActions.filter((action) => action === 'issue'),
  ).toHaveLength(0)
})

for (const changeLecture of [true, false]) {
  test(`ignores an old handover response after ${changeLecture ? 'selection moves to another lecture' : 'the server replaces the connection in this lecture'}`, async ({
    page,
  }) => {
    await installAdminState(page)
    const state = await installNetworkMocks(page)
    state.connectionIssued = true
    state.completeServerActivation()
    await mountHookHarness(page)
    const started = createDeferred()
    const release = createDeferred()
    await page.route(
      'https://example.supabase.co/functions/v1/manage-presenter-connection',
      async (route) => {
        if (route.request().postDataJSON().action !== 'revoke') {
          await route.fallback()
          return
        }
        started.resolve()
        await release.promise
        await fulfillJson(route, {
          ok: true,
          connectionId,
          state: 'revoked',
          revokeReason: 'manual_handover',
          revokedAt: new Date().toISOString(),
        })
      },
    )
    await page.getByRole('button', { name: 'Harness handover' }).click()
    await started.promise
    state.currentConnectionId = '72900000-0000-4000-8000-000000000005'
    if (changeLecture) {
      state.currentLectureSessionId = '72900000-0000-4000-8000-000000000004'
      await page.evaluate(async (lecture) => {
        const path = '/e2e/helpers/presenterHookHarness.tsx'
        const harness = await import(path)
        harness.updatePresenterHookHarness({ activeLectureSessionId: lecture })
      }, state.currentLectureSessionId)
    }
    await expect(page.getByTestId('presenter-hook-connection')).toHaveText(
      state.currentConnectionId,
    )
    release.resolve()
    await waitForAnimationFrames(page, 4)
    await expect(page.getByTestId('presenter-hook-phase')).toHaveText('active')
    await expect(page.getByTestId('presenter-hook-locked')).toHaveText('true')
    await expect(page.getByTestId('presenter-hook-connection')).toHaveText(
      state.currentConnectionId,
    )
  })
}

test('reconnects an observed native fault with fresh pairing and the existing material consent', async ({
  page,
}) => {
  await installAdminState(page)
  const state = await installNetworkMocks(page)
  await startAutomaticPresenterReview(page)
  await confirmPresenterMaterial(page)
  await expect(page.locator('.admin-presenter-active')).toBeVisible()
  let fault = true
  await page.route('http://127.0.0.1:43124/v1/status', async (route) => {
    const response = await route.fetch()
    if (!fault) {
      await route.fulfill({ response })
      return
    }
    fault = false
    state.completeServerTermination()
    await route.fulfill({
      response,
      json: {
        ok: true,
        state: 'faulted',
        lastErrorCode: 'presenter_session_stopped',
        presentation: null,
      },
    })
  })
  await expect
    .poll(
      () =>
        state.presenterActions.filter((action) => action === 'issue').length,
      { timeout: 15_000 },
    )
    .toBe(2)
  await expect(page.locator('.admin-presenter-active')).toBeVisible()
  expect(
    state.presenterActions.filter((action) => action === 'confirm'),
  ).toHaveLength(2)
  await expect(page.locator('.admin-presenter-recovery-code')).toHaveCount(0)
})

for (const reason of ['disconnected', 'manual_handover']) {
  test(`resolves a missing lease after a positive native fault and honors ${reason}`, async ({
    page,
  }) => {
    await installAdminState(page)
    const state = await installNetworkMocks(page)
    await startAutomaticPresenterReview(page)
    await confirmPresenterMaterial(page)
    await expect(page.locator('.admin-presenter-active')).toBeVisible()
    let nullReplies = 0
    let resolvedReplies = 0
    await page.route(
      'https://example.supabase.co/functions/v1/manage-presenter-connection',
      async (route) => {
        if (route.request().postDataJSON().action === 'status') {
          if (nullReplies === 0) {
            nullReplies += 1
            await fulfillJson(route, {
              ok: true,
              runtimeEnabled: true,
              connection: null,
            })
            return
          }
          resolvedReplies += 1
        }
        await route.fallback()
      },
    )
    await page.route('http://127.0.0.1:43124/v1/status', async (route) => {
      const response = await route.fetch()
      if (
        state.presenterActions.filter((action) => action === 'issue').length > 1
      ) {
        await route.fulfill({ response })
        return
      }
      state.completeServerTermination()
      state.revokeReason = reason
      await route.fulfill({
        response,
        json: {
          ok: true,
          state: 'faulted',
          lastErrorCode: 'presenter_session_stopped',
          presentation: null,
        },
      })
    })
    await expect
      .poll(() => resolvedReplies, { timeout: 15_000 })
      .toBeGreaterThan(0)
    if (reason === 'disconnected') {
      await expect
        .poll(
          () =>
            state.presenterActions.filter((action) => action === 'issue')
              .length,
          { timeout: 15_000 },
        )
        .toBe(2)
      await expect(page.locator('.admin-presenter-active')).toBeVisible()
    } else {
      await page.waitForTimeout(1_500)
      expect(
        state.presenterActions.filter((action) => action === 'issue'),
      ).toHaveLength(1)
      await expect(page.getByRole('button', { name: '次へ →' })).toBeEnabled()
    }
  })
}

test('does not restart an explicitly unavailable native session', async ({
  page,
}) => {
  await installAdminState(page)
  const state = await installNetworkMocks(page)
  await startAutomaticPresenterReview(page)
  await confirmPresenterMaterial(page)
  await expect(page.locator('.admin-presenter-active')).toBeVisible()
  await page.route('http://127.0.0.1:43124/v1/status', async (route) => {
    const response = await route.fetch()
    state.completeServerTermination()
    await route.fulfill({
      response,
      status: 401,
      json: {
        ok: false,
        code: 'invalid_session',
        message: 'Request rejected.',
      },
    })
  })
  await expect(page.getByRole('button', { name: '次へ →' })).toBeEnabled({
    timeout: 16_000,
  })
  await page.waitForTimeout(1_500)
  expect(
    state.presenterActions.filter((action) => action === 'issue'),
  ).toHaveLength(1)
  await expect(page.locator('.admin-presenter-recovery-code')).toHaveCount(0)
})

test('keeps absent Bridge readiness checks local without issuing pairing material', async ({
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
  await page.getByRole('tab', { name: '準備' }).click()
  const pdfPanel = page.locator('#admin-live')
  const presenter = page.getByTestId('powerpoint-sync-control')
  await expect(presenter).toContainText(
    'BridgeとPowerPointの起動を待っています',
  )
  await expect(page.locator('.admin-presenter-recovery-code')).toHaveCount(0)
  expect(loopbackRequests.every((path) => path === '/v1/health')).toBe(true)
  await expect(page.getByRole('button', { name: '次へ →' })).toBeEnabled()
  await expect(pdfPanel.getByLabel('PDF資料')).toBeEnabled()
  await page.getByRole('tab', { name: 'スライド' }).click()
  await page.getByRole('tab', { name: '参加' }).click()
  await expect
    .poll(() => loopbackRequests.length, { timeout: 8_000 })
    .toBeGreaterThan(1)
  expect(
    state.presenterActions.filter((action) => action === 'issue'),
  ).toHaveLength(0)
  expect(
    state.presenterActions.filter((action) => action === 'confirm'),
  ).toHaveLength(0)
  expect(loopbackRequests.every((path) => path === '/v1/health')).toBe(true)
  expect(
    state.presenterActions.filter((action) => action === 'status'),
  ).toHaveLength(1)
  expect(pageErrors).toEqual([])
})

test('late startup waits locally for both Bridge and PowerPoint then issues once without a retry click', async ({
  page,
}) => {
  await installAdminState(page)
  const state = await installNetworkMocks(page)
  let stage = 0
  let healthCalls = 0
  await page.route('http://127.0.0.1:43124/v1/health', async (route) => {
    healthCalls += 1
    if (stage === 0) await route.abort('connectionrefused')
    else await fulfillReadiness(route, stage === 2)
  })
  await page.goto('/admin')
  await expect.poll(() => healthCalls).toBe(1)
  expect(
    state.presenterActions.filter((action) => action === 'issue'),
  ).toHaveLength(0)
  stage = 1
  await expect.poll(() => healthCalls, { timeout: 8_000 }).toBeGreaterThan(1)
  expect(
    state.presenterActions.filter((action) => action === 'issue'),
  ).toHaveLength(0)
  expect(
    state.presenterActions.filter((action) => action === 'status'),
  ).toHaveLength(1)
  stage = 2
  await expect(page.locator('.admin-presenter-review')).toBeVisible({
    timeout: 10_000,
  })
  expect(
    state.presenterActions.filter((action) => action === 'issue'),
  ).toHaveLength(1)
  await confirmPresenterMaterial(page)
  await expect(page.locator('.admin-presenter-active')).toBeVisible()
  await expect(page.locator('.admin-presenter-recovery-code')).toHaveCount(0)
})

for (const alwaysUnavailable of [false, true]) {
  test(`late startup handles a PowerPoint readiness race with ${alwaysUnavailable ? 'at most two automatic tickets' : 'one fresh retry and no cancel click'}`, async ({
    page,
  }) => {
    await installAdminState(page)
    const state = await installNetworkMocks(page)
    let attempts = 0
    await page.route('http://127.0.0.1:43124/v1/connect', async (route) => {
      if (route.request().postDataJSON().action === 'activate') {
        await route.fallback()
        return
      }
      const response = await route.fetch()
      const payload = await response.json()
      attempts += 1
      if (alwaysUnavailable || attempts === 1) {
        await route.fulfill({
          response,
          json: {
            ...payload,
            presentation: {
              ...payload.presentation,
              eligible: false,
              issues: ['powerpoint_not_running'],
            },
          },
        })
      } else await route.fulfill({ response })
    })
    await page.goto('/admin')
    await expect.poll(() => attempts, { timeout: 12_000 }).toBe(2)
    if (alwaysUnavailable) {
      await page.waitForTimeout(5_500)
      expect(attempts).toBe(2)
      expect(
        state.presenterActions.filter((action) => action === 'confirm'),
      ).toHaveLength(0)
    } else {
      await expect(page.locator('.admin-presenter-review')).toBeVisible()
      await confirmPresenterMaterial(page)
      await expect(page.locator('.admin-presenter-active')).toBeVisible()
    }
    expect(
      state.presenterActions.filter((action) => action === 'issue'),
    ).toHaveLength(2)
    await expect(page.locator('.admin-presenter-recovery-code')).toHaveCount(0)
  })
}

test('late startup pauses health while hidden, resumes on session refresh, and preserves manual handover', async ({
  page,
}) => {
  await installAdminState(page)
  const replacement = `${googleAdmin.appSessionToken.slice(0, -1)}Y`
  const state = await installNetworkMocks(page, {
    additionalAppToken: replacement,
  })
  let ready = false
  let calls = 0
  let active = 0
  let maximum = 0
  await page.route('http://127.0.0.1:43124/v1/health', async (route) => {
    calls += 1
    active += 1
    maximum = Math.max(maximum, active)
    await page.waitForTimeout(250)
    await fulfillReadiness(route, ready)
    active -= 1
  })
  await mountHookHarness(page, 'idle')
  await expect.poll(() => calls).toBe(1)
  await expect.poll(() => active).toBe(0)
  await setPageVisibility(page, false)
  await page.waitForTimeout(5_500)
  expect(calls).toBe(1)
  await setPageVisibility(page, true)
  await expect.poll(() => calls, { timeout: 7_000 }).toBe(2)
  await page.evaluate(async (token) => {
    const path = '/e2e/helpers/presenterHookHarness.tsx'
    const harness = await import(path)
    harness.updatePresenterHookHarness({
      adminToken: { kind: 'google', appSessionToken: token },
    })
  }, replacement)
  await expect.poll(() => calls).toBe(3)
  await expect.poll(() => active).toBe(0)
  await page.getByRole('button', { name: 'Harness handover' }).click()
  ready = true
  const stoppedAt = calls
  await setPageVisibility(page, false)
  await setPageVisibility(page, true)
  await page.waitForTimeout(5_500)
  expect(calls).toBe(stoppedAt)
  expect(maximum).toBe(1)
  expect(
    state.presenterActions.filter((action) => action === 'issue'),
  ).toHaveLength(0)
})

test('late startup discovers existing active ownership before a nonready health probe', async ({
  page,
}) => {
  await installAdminState(page)
  const state = await installNetworkMocks(page)
  state.connectionIssued = true
  state.completeServerActivation()
  let calls = 0
  await page.route('http://127.0.0.1:43124/v1/health', async (route) => {
    calls += 1
    await fulfillReadiness(route, false)
  })
  await mountHookHarness(page)
  await expect(page.getByTestId('presenter-hook-locked')).toHaveText('true')
  expect(calls).toBe(0)
  expect(
    state.presenterActions.filter((action) => action === 'issue'),
  ).toHaveLength(0)
})

test('late startup recovery adopts a successor instead of revoking it for an old local fault', async ({
  page,
}) => {
  await installAdminState(page)
  const state = await installNetworkMocks(page)
  await startAutomaticPresenterReview(page)
  await confirmPresenterMaterial(page)
  await expect(page.locator('.admin-presenter-active')).toBeVisible()
  let observed = false
  await page.route('http://127.0.0.1:43124/v1/status', async (route) => {
    const response = await route.fetch()
    observed = true
    state.currentConnectionId = '72900000-0000-4000-8000-000000000009'
    await route.fulfill({
      response,
      json: {
        ok: true,
        state: 'faulted',
        lastErrorCode: 'presenter_session_stopped',
        presentation: null,
      },
    })
  })
  await expect.poll(() => observed).toBe(true)
  await page.waitForTimeout(5_500)
  await expect(page.locator('.admin-presenter-active')).toBeVisible()
  expect(state.revokedConnectionIds).toHaveLength(0)
  expect(
    state.presenterActions.filter((action) => action === 'issue'),
  ).toHaveLength(1)
})

test('late startup discards a delayed readiness response after unmount', async ({
  page,
}) => {
  await installAdminState(page)
  const state = await installNetworkMocks(page)
  const started = createDeferred()
  const release = createDeferred()
  let calls = 0
  await page.route('http://127.0.0.1:43124/v1/health', async (route) => {
    calls += 1
    started.resolve()
    await release.promise
    await fulfillReadiness(route, true)
  })
  await page.goto('/admin')
  await started.promise
  await page.goto('/demo')
  release.resolve()
  await page.waitForTimeout(5_500)
  expect(calls).toBe(1)
  expect(
    state.presenterActions.filter((action) => action === 'issue'),
  ).toHaveLength(0)
})

test('moves an expired automatic ticket to the five-minute recovery path without confirming', async ({
  page,
}) => {
  await installAdminState(page)
  const state = await installNetworkMocks(page, {
    expiredAutomaticTicket: true,
  })

  const review = await startAutomaticPresenterReview(page)
  await dispatchEnabledClick(
    review.getByRole('button', {
      name: 'この組合せで同期する',
    }),
  )

  const recoveryCode = page.locator('.admin-presenter-recovery-code')
  await expect(recoveryCode).toHaveText('ABCD2345')
  const statusCountAfterRecovery = state.presenterActions.filter(
    (action) => action === 'status',
  ).length
  await expect
    .poll(
      () =>
        state.presenterActions.filter((action) => action === 'status').length,
    )
    .toBeGreaterThan(statusCountAfterRecovery)
  await expect(review).toBeVisible()
  await expect(review.locator('.admin-presenter-recovery-code')).toHaveText(
    'ABCD2345',
  )
  expect(
    state.presenterActions.filter((action) => action === 'confirm'),
  ).toHaveLength(0)
})

test('keeps the recovery code available when local activation fails after confirmation', async ({
  page,
}) => {
  const activationFailure = await installLocalActivationFailure(page)
  await installAdminState(page)
  const state = await installNetworkMocks(page, {
    localActivationFailure: true,
    staleInspectedAfterConfirm: true,
  })

  const review = await startAutomaticPresenterReview(page)
  await confirmPresenterMaterial(page)
  await activationFailure.completed

  const recoveryCode = page.locator('.admin-presenter-recovery-code')
  await expect(recoveryCode).toHaveText('ABCD2345')
  const statusCountAfterRecovery = state.presenterActions.filter(
    (action) => action === 'status',
  ).length
  await expect
    .poll(
      () =>
        state.presenterActions.filter((action) => action === 'status').length,
    )
    .toBeGreaterThan(statusCountAfterRecovery)
  const recovery = page.locator('.admin-presenter-recovery-panel')
  await expect(recovery).toBeVisible()
  await expect(recovery.locator('.admin-presenter-recovery-code')).toHaveText(
    'ABCD2345',
  )
  await expect(review).toBeHidden()
  expect(
    state.presenterActions.filter((action) => action === 'confirm'),
  ).toHaveLength(1)

  state.completeManualInspect()
  state.completeManualClaim()
  const active = page.locator('.admin-presenter-active')
  await expect(active).toContainText('PowerPoint同期中')
  await expect(recoveryCode).toHaveCount(0)
})

for (const outcome of ['active', 'terminal'] as const) {
  test(`does not revive recovery after ${outcome} wins during a delayed disconnect`, async ({
    page,
  }) => {
    await installLocalActivationFailure(page)
    const disconnect = await holdLoopbackDisconnect(page)
    await installAdminState(page)
    const state = await installNetworkMocks(page, {
      localActivationFailure: true,
      staleInspectedAfterConfirm: true,
    })

    const review = await startAutomaticPresenterReview(page)
    await dispatchEnabledClick(
      review.getByRole('button', {
        name: 'この組合せで同期する',
      }),
    )

    await disconnect.started
    const recoveryCode = page.locator('.admin-presenter-recovery-code')
    await expect(recoveryCode).toHaveCount(0)
    if (outcome === 'active') {
      state.completeServerActivation()
      await expect(page.locator('.admin-presenter-active')).toBeVisible()
    } else {
      state.completeServerTermination()
      await expect(page.getByTestId('powerpoint-sync-control')).toBeVisible()
    }
    await expect(recoveryCode).toHaveCount(0)
    await startRecoveryPanelObserver(page)

    disconnect.release()
    await disconnect.completed
    await waitForAnimationFrames(page, 4)

    expect(await recoveryPanelReappeared(page)).toBe(false)
    await expect(page.locator('.admin-presenter-recovery-panel')).toBeHidden()
    await expect(recoveryCode).toHaveCount(0)
    if (outcome === 'active') {
      await expect(page.locator('.admin-presenter-active')).toBeVisible()
    } else {
      await expect(page.getByTestId('powerpoint-sync-control')).toBeVisible()
    }
    expect(
      state.presenterActions.filter((action) => action === 'confirm'),
    ).toHaveLength(1)
  })
}

test('keeps active when a delayed local activation fails after server activation', async ({
  page,
}) => {
  const activation = await installLocalActivationFailure(page, true)
  const disconnectRequests: string[] = []
  await page.route('http://127.0.0.1:43124/v1/disconnect', async (route) => {
    if (route.request().method() === 'POST') {
      disconnectRequests.push(route.request().url())
    }
    await route.continue()
  })
  await installAdminState(page)
  const state = await installNetworkMocks(page, {
    localActivationFailure: true,
    staleInspectedAfterConfirm: true,
  })

  const review = await startAutomaticPresenterReview(page)
  await dispatchEnabledClick(
    review.getByRole('button', {
      name: 'この組合せで同期する',
    }),
  )

  await activation.started
  state.completeServerActivation()
  await expect(page.locator('.admin-presenter-active')).toBeVisible()
  const recoveryCode = page.locator('.admin-presenter-recovery-code')
  await expect(recoveryCode).toHaveCount(0)
  await startRecoveryPanelObserver(page)

  activation.release()
  await activation.completed
  await waitForAnimationFrames(page, 2)

  expect(await recoveryPanelReappeared(page)).toBe(false)
  await expect(page.locator('.admin-presenter-active')).toBeVisible()
  await expect(page.locator('.admin-presenter-recovery-panel')).toBeHidden()
  await expect(recoveryCode).toHaveCount(0)
  expect(disconnectRequests).toEqual([])
  expect(
    state.presenterActions.filter((action) => action === 'confirm'),
  ).toHaveLength(1)
})
