import { expect, test, type Page, type Route } from '@playwright/test'
import { fileURLToPath } from 'node:url'
import {
  createMockGoogleAdminSession,
  expectMockGoogleAdminCredential,
  fulfillMockGoogleAdminRequest,
  installMockGoogleAdminSession,
} from '../helpers/mockGoogleAdminSession.js'

test.skip(
  process.env.VITE_PHASE7_26_BROWSER_PDF_PUBLISHING !== 'true',
  'Phase 7.26 browser publication requires its dedicated flag-on runner.',
)

const lectureSessionId = '71000000-0000-4000-8000-000000000726'
const publicationId = '70000000-0000-4000-8000-000000000726'
const idempotencyKey = '72000000-0000-4000-8000-000000000726'
const documentId = 'doc-browser-admin-e2e'
const expiresAt = '2099-07-21T00:00:00.000Z'
const samplePdfPath = fileURLToPath(
  new URL('../../public/lecture-assets/m4-sample-v1.pdf', import.meta.url),
)
const googleAdmin = createMockGoogleAdminSession()

type PublicationAction =
  'abort' | 'discover' | 'finalize' | 'initiate' | 'status'

type MockState = {
  active: boolean
  displayMutationCount: number
  finalizeRequestIds: string[]
  inflightDocumentId: string | null
  initiateIdempotencyKeys: string[]
  lectureCreateCount: number
  lectureCreated: boolean
  lectureListIncludeHistory: boolean[]
  lectureTitle: string | null
  publicationActions: PublicationAction[]
  postActivationSnapshotFailuresRemaining: number
  postActivationSnapshotCount: number
  storedPublicationAtUpload: string | null
  uploadCount: number
  uploadedBytes: number
}

function withoutDiscovery(actions: PublicationAction[]) {
  return actions.filter((action) => action !== 'discover')
}

function discoveryCount(actions: PublicationAction[]) {
  return actions.filter((action) => action === 'discover').length
}

function encodeJwtPart(value: unknown) {
  return Buffer.from(JSON.stringify(value)).toString('base64url')
}

function anonymousSessionResponse() {
  const nowSeconds = Math.floor(Date.now() / 1000)
  const user = {
    app_metadata: { provider: 'anonymous', providers: ['anonymous'] },
    aud: 'authenticated',
    confirmed_at: new Date().toISOString(),
    created_at: new Date().toISOString(),
    id: '73000000-0000-4000-8000-000000000726',
    is_anonymous: true,
    role: 'authenticated',
    updated_at: new Date().toISOString(),
    user_metadata: {},
  }
  const accessToken = [
    encodeJwtPart({ alg: 'HS256', typ: 'JWT' }),
    encodeJwtPart({
      aud: 'authenticated',
      exp: nowSeconds + 3600,
      iat: nowSeconds,
      role: 'authenticated',
      sub: user.id,
    }),
    'playwright-signature',
  ].join('.')
  return {
    access_token: accessToken,
    expires_in: 3600,
    refresh_token: 'playwright-refresh-token',
    token_type: 'bearer',
    user,
  }
}

function lectureResponse(
  options: {
    status?: 'closed' | 'open' | 'scheduled'
    title?: string
  } = {},
) {
  const now = new Date()
  return {
    archiveExpiresAt: null,
    closedAt: null,
    closeActorType: null,
    closeReason: null,
    createdAt: new Date(now.getTime() - 60_000).toISOString(),
    endsAt: new Date(now.getTime() + 60 * 60_000).toISOString(),
    hardStopAt: new Date(now.getTime() + 60 * 60_000).toISOString(),
    id: lectureSessionId,
    lectureCode: '285463',
    startsAt: new Date(now.getTime() - 60_000).toISOString(),
    status: options.status ?? 'open',
    title: options.title ?? 'Phase 7.26 browser publication E2E',
    updatedAt: now.toISOString(),
  }
}

function activeDocument(activeDocumentId = documentId) {
  return {
    byteSize: 12_345,
    displayName: 'Browser publication E2E',
    documentId: activeDocumentId,
    documentVersion: 'a'.repeat(64),
    downloadEnabled: true,
    manifestVersion: 2,
    pageCount: 3,
    pdfSha256: 'a'.repeat(64),
    publishedAt: new Date().toISOString(),
    textCharCount: 2_000,
    textSha256: 'b'.repeat(64),
    visible: true,
  }
}

async function fulfillJson(route: Route, body: unknown, status = 200) {
  await route.fulfill({
    body: JSON.stringify(body),
    contentType: 'application/json',
    status,
  })
}

async function installAdminState(
  page: Page,
  recoverPublication: boolean,
  activeLecture = true,
  lectureStatus: 'closed' | 'open' = 'open',
) {
  await installMockGoogleAdminSession(page, googleAdmin, {
    localStorage: {
      'compass-interactive-lecture-runtime-mode': 'live',
      ...(activeLecture
        ? {
            'compass-interactive-lecture-session-id': lectureSessionId,
            'compass-interactive-lecture-status': lectureStatus,
            'compass-interactive-lecture-title':
              'Phase 7.26 browser publication E2E',
          }
        : {}),
    },
    sessionStorage: recoverPublication
      ? {
          [`compass-interactive-browser-pdf-publication-v1:${lectureSessionId}`]:
            JSON.stringify({
              documentId,
              expiresAt,
              idempotencyKey,
              lectureSessionId,
              publicationId,
            }),
        }
      : {},
  })
}

async function installNetworkMocks(
  page: Page,
  options: {
    committedFinalizeResponses?: number
    conflictOnFirstInitiate?: boolean
    discoverPublicationAfterConflict?: boolean
    discoverPublication?: boolean
    finalizeStatus?: 'active' | 'committed'
    initialLectureStatus?: 'closed' | 'open'
    postActivationSnapshotFailures?: number
    postActivationStaleSnapshots?: number
    recoverPublication?: boolean
    startWithoutLecture?: boolean
  } = {},
) {
  const state: MockState = {
    active: false,
    displayMutationCount: 0,
    finalizeRequestIds: [],
    inflightDocumentId: null,
    initiateIdempotencyKeys: [],
    lectureCreateCount: 0,
    lectureCreated: !options.startWithoutLecture,
    lectureListIncludeHistory: [],
    lectureTitle: null,
    publicationActions: [],
    postActivationSnapshotFailuresRemaining:
      options.postActivationSnapshotFailures ?? 0,
    postActivationSnapshotCount: 0,
    storedPublicationAtUpload: null,
    uploadCount: 0,
    uploadedBytes: 0,
  }

  await page.route('https://pdf.example/**', async (route) => {
    const request = route.request()
    expect(request.method()).toBe('PUT')
    expect(request.headers().authorization).toBe(
      'Bearer playwright.header.signature',
    )
    expect(request.headers()['content-type']).toBe('application/pdf')
    const bytes = request.postDataBuffer()
    if (bytes) {
      expect(bytes.subarray(0, 5).toString()).toBe('%PDF-')
    }
    state.storedPublicationAtUpload = await page.evaluate(
      (lectureId) =>
        window.sessionStorage.getItem(
          `compass-interactive-browser-pdf-publication-v1:${lectureId}`,
        ),
      lectureSessionId,
    )
    state.uploadCount += 1
    state.uploadedBytes = bytes?.byteLength ?? 0
    await fulfillJson(
      route,
      { ok: true, publicationId, status: 'uploaded' },
      201,
    )
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

    const functionName = url.pathname.split('/').at(-1)
    const body = (request.postDataJSON() ?? {}) as Record<string, unknown>
    expectMockGoogleAdminCredential(body, googleAdmin)
    if (functionName === 'manage-lectures') {
      if (body.action === 'list') {
        state.lectureListIncludeHistory.push(body.includeHistory === true)
      }
      if (body.action === 'create') {
        state.lectureCreateCount += 1
        state.lectureCreated = true
        state.lectureTitle = String(body.title ?? '')
      }
      await fulfillJson(route, {
        lectures: state.lectureCreated
          ? [
              lectureResponse({
                status: options.startWithoutLecture
                  ? 'scheduled'
                  : (options.initialLectureStatus ?? 'open'),
                title: state.lectureTitle ?? undefined,
              }),
            ]
          : [],
        ok: true,
      })
      return
    }
    if (functionName === 'manage-polls') {
      await fulfillJson(route, { hasMore: false, ok: true, polls: [] })
      return
    }
    if (functionName === 'manage-pdf-documents') {
      await fulfillJson(route, {
        documents: state.active
          ? [activeDocument(state.inflightDocumentId ?? documentId)]
          : [],
        ok: true,
      })
      return
    }
    if (functionName === 'manage-pdf-publications') {
      const action = body.action as PublicationAction
      state.publicationActions.push(action)
      if (action === 'discover') {
        const shouldDiscover =
          options.discoverPublication ||
          (options.discoverPublicationAfterConflict &&
            state.initiateIdempotencyKeys.length > 0)
        await fulfillJson(
          route,
          shouldDiscover
            ? {
                documentId: state.inflightDocumentId ?? documentId,
                expiresAt,
                found: true,
                idempotencyKey,
                ok: true,
                publicationId,
                status: options.recoverPublication ? 'uploaded' : 'pending',
              }
            : { found: false, ok: true },
        )
        return
      }
      if (action === 'initiate') {
        state.initiateIdempotencyKeys.push(String(body.idempotencyKey ?? ''))
        if (
          options.conflictOnFirstInitiate &&
          state.initiateIdempotencyKeys.length === 1
        ) {
          state.inflightDocumentId = String(body.documentId ?? '')
          await fulfillJson(
            route,
            {
              message:
                'A PDF publication is already in progress for this lecture.',
              ok: false,
            },
            409,
          )
          return
        }
        expect(body.lectureSessionId).toBe(lectureSessionId)
        expect(body.byteSize).toBeGreaterThan(5)
        expect(body.pageCount).toBe(3)
        expect(body.pdfSha256).toMatch(/^[0-9a-f]{64}$/)
        expect(body.textSha256).toMatch(/^[0-9a-f]{64}$/)
        await fulfillJson(route, {
          documentId: body.documentId,
          expiresAt,
          ok: true,
          publicationId,
          status: 'pending',
          uploadTicket: 'playwright.header.signature',
          uploadUrl: `https://pdf.example/v2/pdf-publications/${publicationId}`,
        })
        return
      }
      if (action === 'status') {
        const publicationStatus = state.active
          ? 'active'
          : state.finalizeRequestIds.length > 0
            ? 'committed'
            : options.recoverPublication
              ? 'uploaded'
              : 'pending'
        await fulfillJson(route, {
          documentId,
          documentVersion: 'a'.repeat(64),
          manifestVersion: 2,
          ok: true,
          publicationId,
          status: publicationStatus,
        })
        return
      }
      if (action === 'finalize') {
        state.finalizeRequestIds.push(String(body.requestId ?? ''))
        const finalizeAttempt = state.publicationActions.filter(
          (publicationAction) => publicationAction === 'finalize',
        ).length
        const finalizeStatus =
          finalizeAttempt <= (options.committedFinalizeResponses ?? 0)
            ? 'committed'
            : (options.finalizeStatus ?? 'active')
        state.active = finalizeStatus === 'active'
        await fulfillJson(route, {
          documentId: state.inflightDocumentId ?? documentId,
          documentVersion: 'a'.repeat(64),
          manifestVersion: 2,
          ok: true,
          publicationId,
          status: finalizeStatus,
        })
        return
      }
      if (action === 'abort') {
        await fulfillJson(route, {
          documentId,
          ok: true,
          publicationId,
          status: 'aborted',
        })
        return
      }
    }

    if (functionName === 'update-display-state') {
      state.displayMutationCount += 1
      await fulfillJson(route, { ok: true })
      return
    }

    if (functionName === 'operator-live-snapshot') {
      if (state.active) {
        state.postActivationSnapshotCount += 1
        if (state.postActivationSnapshotFailuresRemaining > 0) {
          state.postActivationSnapshotFailuresRemaining -= 1
          await fulfillJson(
            route,
            { message: 'Temporary snapshot failure.', ok: false },
            503,
          )
          return
        }
      }
      const includeActivePdf =
        state.active &&
        state.postActivationSnapshotCount >
          (options.postActivationStaleSnapshots ?? 0)
      const includeStalePdf = state.active && !includeActivePdf
      const now = new Date().toISOString()
      await fulfillJson(route, {
        ok: true,
        result: {
          mode: 'live',
          snapshot: {
            changed:
              includeActivePdf || includeStalePdf
                ? {
                    pdf: {
                      current_pdf_page: 1,
                      display_mode: 'normal',
                      lecture_session_id: lectureSessionId,
                      pdf_document_id: includeActivePdf
                        ? (state.inflightDocumentId ?? documentId)
                        : '11111111-1111-4111-8111-111111111111',
                      pdf_document_version: includeActivePdf
                        ? 'a'.repeat(64)
                        : 'b'.repeat(64),
                      pdf_manifest_version: includeActivePdf ? 2 : 1,
                      pdf_page_count: 3,
                      pdf_visible: true,
                      updated_at: now,
                    },
                  }
                : {},
            contract_version: 2,
            server_time: now,
            versions: {
              caption: 0,
              comments: 0,
              lecture: 0,
              likes: 0,
              metrics: 0,
              pdf: includeActivePdf || includeStalePdf ? 1 : 0,
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

  return state
}

async function stopAdminOperatorPolling(page: Page) {
  await page.getByRole('button', { name: 'ログアウト', exact: true }).click()
  await expect(page.locator('#admin-live')).toHaveCount(0)
}

async function openTeacherSetup(page: Page) {
  await page.locator('#teacher-workspace-setup-tab').click()
  await expect(page.locator('#teacher-workspace-material')).toBeVisible()
}

test('Admin clears a restored closed lecture before preparing the next PDF', async ({
  page,
}) => {
  await installAdminState(page, false, true, 'closed')
  const state = await installNetworkMocks(page, {
    initialLectureStatus: 'closed',
  })

  await page.goto('/admin')
  await expect(
    page.getByRole('heading', { name: '講義を準備する' }),
  ).toBeVisible()
  await expect.poll(() => state.lectureListIncludeHistory[0]).toBe(true)
  await expect(
    page.getByText(
      '終了した講義です。履歴を確認するか、次の講義を準備できます。',
    ),
  ).toHaveCount(0)

  const pdfPanel = page.locator('#admin-live .publisher-control-panel')
  const fileInput = pdfPanel.locator('input[type="file"]')
  await expect(fileInput).toBeEnabled()
  await expect(page.locator('.lecture-admin-row')).toHaveCount(0)
  await expect(
    page.getByRole('button', { name: '講義履歴を表示する' }),
  ).toBeVisible()

  await fileInput.setInputFiles(samplePdfPath)
  await expect(page.getByLabel('講義タイトル')).toHaveValue('m4-sample-v1')
  await expect(
    pdfPanel.getByRole('button', {
      name: '講義を作成して資料を公開する',
    }),
  ).toBeEnabled()

  await stopAdminOperatorPolling(page)
})

test('Admin publishes a PDF in-browser without exposing Local Publisher controls', async ({
  browserName,
  page,
}) => {
  await installAdminState(page, false)
  const state = await installNetworkMocks(page)

  await page.goto('/admin')
  await openTeacherSetup(page)
  const pdfPanel = page.locator('#admin-live .publisher-control-panel')
  await expect(pdfPanel).toBeVisible()

  await expect(pdfPanel.getByText('Local Publisher')).toHaveCount(0)
  await expect(pdfPanel.locator('input[inputmode="numeric"]')).toHaveCount(0)

  await pdfPanel.locator('input[type="file"]').setInputFiles(samplePdfPath)
  const publishButton = pdfPanel.locator('button.primary-button')
  await expect(publishButton).toBeEnabled()
  await publishButton.click()

  await expect
    .poll(() => withoutDiscovery(state.publicationActions))
    .toEqual(['initiate', 'finalize'])
  expect(discoveryCount(state.publicationActions)).toBeGreaterThanOrEqual(1)
  expect(discoveryCount(state.publicationActions)).toBeLessThanOrEqual(2)
  expect(state.uploadCount).toBe(1)
  if (browserName === 'chromium') {
    expect(state.uploadedBytes).toBeGreaterThan(5)
  }
  expect(state.storedPublicationAtUpload).not.toBeNull()
  const storedPublication = JSON.parse(
    state.storedPublicationAtUpload ?? '{}',
  ) as Record<string, unknown>
  expect(Object.keys(storedPublication).sort()).toEqual([
    'documentId',
    'expiresAt',
    'idempotencyKey',
    'lectureSessionId',
    'publicationId',
  ])
  expect(state.storedPublicationAtUpload).not.toContain(
    'playwright.header.signature',
  )
  expect(state.storedPublicationAtUpload).not.toContain('pdf.example')
  expect(state.storedPublicationAtUpload).not.toContain('%PDF-')
  expect(state.storedPublicationAtUpload).not.toContain('pages')
  expect(state.storedPublicationAtUpload).not.toContain('textSha256')
  await expect(
    page.locator(`#admin-live select option[value="${documentId}"]`),
  ).toHaveCount(1)
  await expect(page.locator('#teacher-workspace-slides-tab')).toBeVisible()
  await expect
    .poll(() =>
      page.evaluate(
        (lectureId) =>
          window.sessionStorage.getItem(
            `compass-interactive-browser-pdf-publication-v1:${lectureId}`,
          ),
        lectureSessionId,
      ),
    )
    .toBeNull()
  await stopAdminOperatorPolling(page)
})

test('Admin retries the authoritative display read after PDF activation without a duplicate mutation', async ({
  page,
}) => {
  await installAdminState(page, false)
  const state = await installNetworkMocks(page, {
    postActivationSnapshotFailures: 1,
  })

  await page.goto('/admin')
  await openTeacherSetup(page)
  const pdfPanel = page.locator('#admin-live .publisher-control-panel')
  await pdfPanel.locator('input[type="file"]').setInputFiles(samplePdfPath)
  await pdfPanel.locator('button.primary-button').click()

  await expect
    .poll(() => state.postActivationSnapshotCount)
    .toBeGreaterThanOrEqual(2)
  await expect(page.locator('#teacher-workspace-slides-tab')).toBeVisible()
  expect(state.displayMutationCount).toBe(0)
  expect(withoutDiscovery(state.publicationActions)).toEqual([
    'initiate',
    'finalize',
  ])
  await expect(
    pdfPanel.getByText(/最新の表示状態を読み込めませんでした/),
  ).toHaveCount(0)
  await stopAdminOperatorPolling(page)
})

test('Admin rejects a stale successful display snapshot after PDF activation', async ({
  page,
}) => {
  await installAdminState(page, false)
  const state = await installNetworkMocks(page, {
    postActivationStaleSnapshots: 1,
  })

  await page.goto('/admin')
  await openTeacherSetup(page)
  const pdfPanel = page.locator('#admin-live .publisher-control-panel')
  await pdfPanel.locator('input[type="file"]').setInputFiles(samplePdfPath)
  await pdfPanel.locator('button.primary-button').click()

  await expect
    .poll(() => state.postActivationSnapshotCount)
    .toBeGreaterThanOrEqual(2)
  await expect(page.locator('#teacher-workspace-slides-tab')).toBeVisible()
  expect(state.displayMutationCount).toBe(0)
  expect(withoutDiscovery(state.publicationActions)).toEqual([
    'initiate',
    'finalize',
  ])
  await stopAdminOperatorPolling(page)
})

test('Admin completes a committed PDF publication without another teacher action', async ({
  page,
}) => {
  await installAdminState(page, false)
  const state = await installNetworkMocks(page, {
    committedFinalizeResponses: 1,
  })

  await page.goto('/admin')
  await openTeacherSetup(page)
  const pdfPanel = page.locator('#admin-live .publisher-control-panel')
  await pdfPanel.locator('input[type="file"]').setInputFiles(samplePdfPath)
  await pdfPanel.locator('button.primary-button').click()

  await expect(page.locator('#teacher-workspace-slides-tab')).toBeVisible()
  expect(withoutDiscovery(state.publicationActions)).toEqual([
    'initiate',
    'finalize',
    'finalize',
  ])
  expect(state.uploadCount).toBe(1)
  expect(state.finalizeRequestIds).toHaveLength(2)
  expect(new Set(state.finalizeRequestIds).size).toBe(1)
  expect(state.displayMutationCount).toBe(0)
  await stopAdminOperatorPolling(page)
})

test('Admin reloads only the display read after bounded PDF activation readback failures', async ({
  page,
}) => {
  await installAdminState(page, false)
  const state = await installNetworkMocks(page, {
    postActivationSnapshotFailures: 100,
  })

  await page.goto('/admin')
  await openTeacherSetup(page)
  const pdfPanel = page.locator('#admin-live .publisher-control-panel')
  await pdfPanel.locator('input[type="file"]').setInputFiles(samplePdfPath)
  await pdfPanel.locator('button.primary-button').click()

  await expect(
    pdfPanel.getByText(/表示状態の同期に時間がかかっています/),
  ).toBeVisible()
  state.postActivationSnapshotFailuresRemaining = 0
  await page.getByRole('button', { name: '再読み込み' }).click()
  await expect(page.locator('#teacher-workspace-slides-tab')).toBeVisible()
  await expect(pdfPanel).toContainText('資料の表示状態を再同期しました。')
  expect(state.displayMutationCount).toBe(0)
  expect(withoutDiscovery(state.publicationActions)).toEqual([
    'initiate',
    'finalize',
  ])
  await stopAdminOperatorPolling(page)
})

test('Admin reloads a committed PDF publication with the same finalize request ID', async ({
  page,
}) => {
  await installAdminState(page, false)
  const state = await installNetworkMocks(page, {
    committedFinalizeResponses: 3,
  })

  await page.goto('/admin')
  await openTeacherSetup(page)
  const pdfPanel = page.locator('#admin-live .publisher-control-panel')
  const fileInput = pdfPanel.locator('input[type="file"]')
  await fileInput.setInputFiles(samplePdfPath)
  await pdfPanel.locator('button.primary-button').click()

  await expect(pdfPanel).toContainText(
    '資料の送信は完了しました。公開の最終確定を再開しています。',
  )
  await expect(page.locator('#teacher-workspace-slides-tab')).toHaveCount(0)
  await expect(fileInput).toHaveValue(/m4-sample-v1\.pdf/)
  expect(state.displayMutationCount).toBe(0)
  expect(state.active).toBe(false)
  await expect
    .poll(() =>
      page.evaluate(
        (lectureId) =>
          window.sessionStorage.getItem(
            `compass-interactive-browser-pdf-publication-v1:${lectureId}`,
          ),
        lectureSessionId,
      ),
    )
    .not.toBeNull()
  expect(withoutDiscovery(state.publicationActions)).toEqual([
    'initiate',
    'finalize',
    'finalize',
    'finalize',
  ])
  expect(state.finalizeRequestIds).toHaveLength(3)
  expect(new Set(state.finalizeRequestIds).size).toBe(1)

  const storedFinalizeRequestId = await page.evaluate((lectureId) => {
    const raw = window.sessionStorage.getItem(
      `compass-interactive-browser-pdf-publication-v1:${lectureId}`,
    )
    return raw
      ? (JSON.parse(raw) as { finalizeRequestId?: string }).finalizeRequestId
      : null
  }, lectureSessionId)
  expect(storedFinalizeRequestId).toBe(state.finalizeRequestIds[0])

  await page.reload()
  await expect(page.locator('#teacher-workspace-slides-tab')).toBeVisible()
  expect(state.finalizeRequestIds).toHaveLength(4)
  expect(new Set(state.finalizeRequestIds).size).toBe(1)
  await expect
    .poll(() =>
      page.evaluate(
        (lectureId) =>
          window.sessionStorage.getItem(
            `compass-interactive-browser-pdf-publication-v1:${lectureId}`,
          ),
        lectureSessionId,
      ),
    )
    .toBeNull()
  await stopAdminOperatorPolling(page)
})

test('Admin creates a draft and publishes a preselected PDF with one CTA', async ({
  page,
}) => {
  await installAdminState(page, false, false)
  const state = await installNetworkMocks(page, { startWithoutLecture: true })

  await page.goto('/admin')
  await openTeacherSetup(page)
  const pdfPanel = page.locator('#admin-live .publisher-control-panel')
  await pdfPanel.locator('input[type="file"]').setInputFiles(samplePdfPath)

  await expect(
    pdfPanel.getByText(
      '大きい資料は公開やAI分析に時間と費用がかかります。可能な範囲で圧縮してください。',
    ),
  ).toHaveCount(0)
  await expect(
    pdfPanel.getByText(
      '資料はこのブラウザで選択した状態を保ちます。講義を作成すると公開できます。',
    ),
  ).toHaveCount(0)
  const publishButton = pdfPanel.getByRole('button', {
    name: '講義を作成して資料を公開する',
  })
  await expect(publishButton).toBeEnabled()
  await publishButton.click()

  await expect.poll(() => state.lectureCreateCount).toBe(1)
  expect(state.lectureTitle).toBe('m4-sample-v1')
  await expect
    .poll(() => withoutDiscovery(state.publicationActions))
    .toEqual(['initiate', 'finalize'])
  await expect(page.locator('#teacher-workspace-slides-tab')).toBeVisible()
  await expect(
    page.locator(`#admin-live select option[value="${documentId}"]`),
  ).toHaveCount(1)
  await stopAdminOperatorPolling(page)
})

test('Admin adopts an inflight publication after an initiate conflict', async ({
  page,
}) => {
  await installAdminState(page, false)
  const state = await installNetworkMocks(page, {
    conflictOnFirstInitiate: true,
    discoverPublicationAfterConflict: true,
  })

  await page.goto('/admin')
  await openTeacherSetup(page)
  const pdfPanel = page.locator('#admin-live .publisher-control-panel')
  await pdfPanel.locator('input[type="file"]').setInputFiles(samplePdfPath)
  await pdfPanel.locator('button.primary-button').click()

  await expect
    .poll(() => withoutDiscovery(state.publicationActions))
    .toEqual(['initiate', 'initiate', 'finalize'])
  expect(discoveryCount(state.publicationActions)).toBeGreaterThanOrEqual(2)
  expect(state.initiateIdempotencyKeys.at(-1)).toBe(idempotencyKey)
  expect(state.uploadCount).toBe(1)
  await expect
    .poll(() =>
      page
        .locator(
          `#admin-live select option[value="${state.inflightDocumentId}"]`,
        )
        .count(),
    )
    .toBe(1)
  await stopAdminOperatorPolling(page)
})

test('Admin resumes an uploaded publication with status then finalize and no second PUT', async ({
  page,
}) => {
  await installAdminState(page, false)
  const state = await installNetworkMocks(page, { recoverPublication: true })

  await page.goto('/admin')
  await openTeacherSetup(page)
  await expect(
    page.locator('#admin-live .publisher-control-panel'),
  ).toBeVisible()
  await expect
    .poll(() => discoveryCount(state.publicationActions))
    .toBeGreaterThanOrEqual(1)
  await page.evaluate(
    ({
      documentId,
      expiresAt,
      idempotencyKey,
      lectureSessionId,
      publicationId,
    }) => {
      window.sessionStorage.setItem(
        `compass-interactive-browser-pdf-publication-v1:${lectureSessionId}`,
        JSON.stringify({
          documentId,
          expiresAt,
          idempotencyKey,
          lectureSessionId,
          publicationId,
        }),
      )
    },
    {
      documentId,
      expiresAt,
      idempotencyKey,
      lectureSessionId,
      publicationId,
    },
  )
  await page.reload()
  await openTeacherSetup(page)

  await expect
    .poll(() => state.publicationActions.includes('finalize'))
    .toBe(true)
  expect(withoutDiscovery(state.publicationActions)[0]).toBe('status')
  expect(state.publicationActions).not.toContain('initiate')
  expect(
    withoutDiscovery(state.publicationActions).every(
      (action) => action === 'status' || action === 'finalize',
    ),
  ).toBe(true)
  expect(state.uploadCount).toBe(0)
  await expect(
    page.locator(`#admin-live select option[value="${documentId}"]`),
  ).toHaveCount(1)
  await expect
    .poll(() =>
      page.evaluate(
        (lectureId) =>
          window.sessionStorage.getItem(
            `compass-interactive-browser-pdf-publication-v1:${lectureId}`,
          ),
        lectureSessionId,
      ),
    )
    .toBeNull()
  await stopAdminOperatorPolling(page)
})

test('Admin rediscovers an uploaded publication without tab storage and finalizes it', async ({
  page,
}) => {
  await installAdminState(page, false)
  const state = await installNetworkMocks(page, {
    discoverPublication: true,
    recoverPublication: true,
  })

  await page.goto('/admin')
  await openTeacherSetup(page)
  await expect
    .poll(() => state.publicationActions.includes('finalize'))
    .toBe(true)
  expect(withoutDiscovery(state.publicationActions)).toEqual([
    'status',
    'finalize',
  ])
  expect(discoveryCount(state.publicationActions)).toBeGreaterThanOrEqual(1)
  expect(discoveryCount(state.publicationActions)).toBeLessThanOrEqual(2)
  expect(state.uploadCount).toBe(0)
  await expect(
    page.locator(`#admin-live select option[value="${documentId}"]`),
  ).toHaveCount(1)
  await expect
    .poll(() =>
      page.evaluate(
        (lectureId) =>
          window.sessionStorage.getItem(
            `compass-interactive-browser-pdf-publication-v1:${lectureId}`,
          ),
        lectureSessionId,
      ),
    )
    .toBeNull()
  await stopAdminOperatorPolling(page)
})

test('Admin explicitly aborts a discovered pending publication before replacing it', async ({
  page,
}) => {
  await installAdminState(page, false)
  const state = await installNetworkMocks(page, {
    discoverPublication: true,
  })

  await page.goto('/admin')
  await openTeacherSetup(page)
  const pdfPanel = page.locator('#admin-live .publisher-control-panel')
  const abortButton = pdfPanel.getByRole('button', {
    name: '中断した公開を破棄してやり直す',
  })
  await expect(abortButton).toBeVisible()
  await expect
    .poll(() => withoutDiscovery(state.publicationActions))
    .toEqual(['status'])
  expect(discoveryCount(state.publicationActions)).toBeGreaterThanOrEqual(1)
  expect(discoveryCount(state.publicationActions)).toBeLessThanOrEqual(2)
  await abortButton.click()
  await expect.poll(() => state.publicationActions.at(-1)).toBe('abort')
  await expect(abortButton).toHaveCount(0)
  await expect(pdfPanel).toContainText(
    '選択中のPDFを新しい公開として開始できます。',
  )
  await stopAdminOperatorPolling(page)
})
