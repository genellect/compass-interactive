import { AxeBuilder } from '@axe-core/playwright'
import { expect, test, type Page, type Route } from '@playwright/test'
import { fileURLToPath } from 'node:url'
import {
  createMockGoogleAdminSession,
  expectMockGoogleAdminCredential,
  fulfillMockGoogleAdminRequest,
  installMockGoogleAdminSession,
} from '../helpers/mockGoogleAdminSession.js'

const rehearsalLectureId = '72700000-0000-4000-8000-000000000001'
const productionLectureId = '72700000-0000-4000-8000-000000000002'
const expectedDocumentId = 'journal-club-2026-07-23-v1'
const samplePdfPath = fileURLToPath(
  new URL('../../public/lecture-assets/m4-sample-v1.pdf', import.meta.url),
)
const googleAdmin = createMockGoogleAdminSession()

const pollQuestions = [
  'QUIZ1: C9orf72リピートはどの方向に転写される？',
  'QUIZ2: CasRxが直接切断する分子はどれ？',
  'QUIZ3: gRNAをリピート隣接領域に設計する利点は？',
  'FINAL QUIZ: この研究から直接結論できないものはどれ？',
  '今回の発表を通して、説明・文献の内容をどの程度理解できましたか？',
  'COMPASS Interactiveは、今回の発表内容の理解や議論への参加に役立ちましたか？',
] as const

type JournalClubRunKind = 'production' | 'rehearsal'

type Lecture = {
  archiveExpiresAt: null
  closedAt: null
  closeActorType: null
  closeReason: null
  createdAt: string
  endsAt: null
  hardStopAt: null
  id: string
  journalClub: {
    expectedDocumentId: string
    expectedPdfByteSize: number
    expectedPdfPageCount: number
    expectedPdfSha256: string
    presetVersion: number
    runKind: JournalClubRunKind
  }
  lectureCode: string
  startsAt: null
  status: 'draft'
  title: string
  updatedAt: string
}

type MockState = {
  aiFunctionCalls: string[]
  anonymousSignupHandlerSettled: number
  anonymousSignupRequestFailures: number
  anonymousSignupRequests: number
  lectures: Lecture[]
  lectureRequests: Array<Record<string, unknown>>
  liveJoinRequests: number
  pdfPublicationActions: string[]
  pdfPublicationRequests: Array<Record<string, unknown>>
  pollRequests: Array<Record<string, unknown>>
  resumeIssueResolvedAt: number | null
  uploadRequests: number
}

type LiveJoinLecture = {
  ends_at: string | null
  lecture_session_id: string
  participant_id: string
  starts_at: string | null
  status: 'open'
  title: string
}

type NetworkMockOptions = {
  anonymousSignupDelayMs?: number[]
  anonymousSignupUserIds?: string[]
  invalidAdminSession?: boolean
  liveJoinLecture?: LiveJoinLecture | null
  missingOperatorSnapshot?: boolean
  rejectStartWithoutPdf?: boolean
  resumeIssueDelayMs?: number
}

function encodeJwtPart(value: unknown) {
  return Buffer.from(JSON.stringify(value)).toString('base64url')
}

function anonymousSessionResponse(
  userId = '72700000-0000-4000-8000-000000000099',
) {
  const nowSeconds = Math.floor(Date.now() / 1_000)
  const user = {
    app_metadata: { provider: 'anonymous', providers: ['anonymous'] },
    aud: 'authenticated',
    confirmed_at: new Date().toISOString(),
    created_at: new Date().toISOString(),
    id: userId,
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
    refresh_token: `playwright-refresh-token-${userId}`,
    token_type: 'bearer',
    user,
  }
}

async function installTurnstileMock(page: Page) {
  await page.addInitScript(() => {
    type TurnstileTestState = {
      mode: 'resolve' | 'stall'
      removeCount: number
      renderCount: number
    }
    type TurnstileTestWindow = Window & {
      __compassTurnstileTest: TurnstileTestState
      turnstile: {
        remove: (widgetId: string) => void
        render: (
          container: HTMLElement,
          options: { callback: (token: string) => void },
        ) => string
      }
    }

    const testWindow = window as unknown as TurnstileTestWindow
    const state: TurnstileTestState = {
      mode: 'resolve',
      removeCount: 0,
      renderCount: 0,
    }
    testWindow.__compassTurnstileTest = state
    testWindow.turnstile = {
      remove: () => {
        state.removeCount += 1
      },
      render: (_container, options) => {
        state.renderCount += 1
        const widgetId = `turnstile-widget-${state.renderCount}`
        if (state.mode === 'resolve') {
          queueMicrotask(() =>
            options.callback(`turnstile-token-${state.renderCount}`),
          )
        }
        return widgetId
      },
    }
  })
}

function makeLecture(runKind: JournalClubRunKind): Lecture {
  const now = new Date().toISOString()
  return {
    archiveExpiresAt: null,
    closedAt: null,
    closeActorType: null,
    closeReason: null,
    createdAt: now,
    endsAt: null,
    hardStopAt: null,
    id: runKind === 'production' ? productionLectureId : rehearsalLectureId,
    journalClub: {
      expectedDocumentId,
      expectedPdfByteSize: 5_816_208,
      expectedPdfPageCount: 34,
      expectedPdfSha256:
        '8c6903527b050c1db5f6b13b24bcf9108950bf8248a80205b10be6a9c63d7842',
      presetVersion: 1,
      runKind,
    },
    lectureCode: runKind === 'production' ? '723001' : '723002',
    startsAt: null,
    status: 'draft',
    title: 'Dual-targeting CasRx for C9orf72 ALS/FTD',
    updatedAt: now,
  }
}

function makePolls(lectureSessionId: string) {
  return pollQuestions
    .map((question, index) => ({
      createdAt: new Date(Date.UTC(2026, 6, 21, 0, index)).toISOString(),
      id: `72700000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
      lectureSessionId,
      options: ['A', 'B', 'C', 'D'].map((label, optionIndex) => ({
        id: `72700000-0000-4000-9000-${String(index * 4 + optionIndex + 1).padStart(12, '0')}`,
        label,
        order: optionIndex,
        responseCount: 0,
      })),
      question,
      status: 'draft',
      templateOrder: index + 1,
      type: 'single',
      updatedAt: new Date(Date.UTC(2026, 6, 21, 0, index)).toISOString(),
    }))
    .reverse()
}

async function fulfillJson(route: Route, body: unknown, status = 200) {
  await route.fulfill({
    body: JSON.stringify(body),
    contentType: 'application/json',
    status,
  })
}

async function expectNoSeriousAccessibilityViolations(page: Page) {
  const result = await new AxeBuilder({ page }).analyze()
  expect(
    result.violations
      .filter((violation) =>
        ['critical', 'serious'].includes(violation.impact ?? ''),
      )
      .map((violation) => ({
        id: violation.id,
        nodes: violation.nodes.map((node) => ({
          failureSummary: node.failureSummary,
          target: node.target,
        })),
      })),
  ).toEqual([])
}

function archiveResolveResponse(
  archivePolicy: Record<string, unknown> | undefined,
) {
  return {
    archive: {
      academic_answers: [],
      archive_expires_at: '2026-08-22T00:00:00.000Z',
      ...(archivePolicy ? { archive_policy: archivePolicy } : {}),
      closed_at: '2026-07-23T12:30:00.000Z',
      comments: [
        {
          body: '本番講義のコメント',
          created_at: '2026-07-23T12:00:00.000Z',
          id: '72700000-0000-4000-8000-000000000501',
          is_pinned: false,
          like_count: 3,
          nickname: null,
        },
      ],
      comments_has_more: false,
      material_summary: null,
      participant_count_approximate: 30,
      pdf: null,
      polls: [],
      schema_version: 1,
      started_at: '2026-07-23T11:00:00.000Z',
      summaries: [],
      title: 'Dual-targeting CasRx for C9orf72 ALS/FTD',
    },
    archiveAccessToken: 'archive-access-token',
    archiveAccessTokenExpiresAt: '2099-07-23T12:45:00.000Z',
    lookupHash: 'a'.repeat(64),
    ok: true,
  }
}

async function installAdminState(page: Page) {
  await installMockGoogleAdminSession(page, googleAdmin, {
    localStorage: {
      'compass-interactive-lecture-runtime-mode': null,
      'compass-interactive-lecture-session-id': null,
      'compass-interactive-lecture-status': null,
      'compass-interactive-lecture-title': null,
    },
  })
}

async function installNetworkMocks(
  page: Page,
  {
    anonymousSignupDelayMs = [],
    anonymousSignupUserIds = [],
    invalidAdminSession = false,
    liveJoinLecture = null,
    missingOperatorSnapshot = false,
    rejectStartWithoutPdf = false,
    resumeIssueDelayMs = 0,
  }: NetworkMockOptions = {},
) {
  const state: MockState = {
    aiFunctionCalls: [],
    anonymousSignupHandlerSettled: 0,
    anonymousSignupRequestFailures: 0,
    anonymousSignupRequests: 0,
    lectures: [],
    lectureRequests: [],
    liveJoinRequests: 0,
    pdfPublicationActions: [],
    pdfPublicationRequests: [],
    pollRequests: [],
    resumeIssueResolvedAt: null,
    uploadRequests: 0,
  }

  page.on('request', (request) => {
    if (new URL(request.url()).hostname === 'pdf.example') {
      state.uploadRequests += 1
    }
  })
  page.on('requestfailed', (request) => {
    const url = new URL(request.url())
    if (url.pathname === '/auth/v1/signup') {
      state.anonymousSignupRequestFailures += 1
    }
  })

  await page.route('https://example.supabase.co/**', async (route) => {
    const request = route.request()
    const url = new URL(request.url())

    if (
      await fulfillMockGoogleAdminRequest(route, googleAdmin, {
        identityInvalid: invalidAdminSession,
      })
    ) {
      return
    }

    if (url.pathname === '/auth/v1/signup' && request.method() === 'POST') {
      const requestIndex = state.anonymousSignupRequests
      state.anonymousSignupRequests += 1
      const delayMs = anonymousSignupDelayMs[requestIndex] ?? 0
      if (delayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, delayMs))
      }
      state.anonymousSignupHandlerSettled += 1
      try {
        await fulfillJson(
          route,
          anonymousSessionResponse(anonymousSignupUserIds[requestIndex]),
        )
      } catch {
        // An AbortSignal-backed client may close the request before the
        // deliberately delayed fixture tries to respond.
      }
      return
    }
    if (url.pathname.startsWith('/auth/v1/')) {
      await fulfillJson(route, anonymousSessionResponse())
      return
    }
    if (
      liveJoinLecture &&
      url.pathname === '/rest/v1/rpc/join_lecture_by_code_v2'
    ) {
      state.liveJoinRequests += 1
      await fulfillJson(route, [liveJoinLecture])
      return
    }
    if (!url.pathname.startsWith('/functions/v1/')) {
      await fulfillJson(route, [])
      return
    }

    const functionName = url.pathname.split('/').at(-1) ?? ''
    const body = (request.postDataJSON() ?? {}) as Record<string, unknown>
    if (functionName === 'issue-lecture-resume-token' && liveJoinLecture) {
      if (resumeIssueDelayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, resumeIssueDelayMs))
      }
      state.resumeIssueResolvedAt = Date.now()
      await fulfillJson(route, {
        expiresAt: '2099-08-18T12:00:00.000Z',
        lectureSessionId: liveJoinLecture.lecture_session_id,
        ok: true,
        resumeToken: `${'a'.repeat(80)}.${'b'.repeat(80)}`,
      })
      return
    }
    if (
      [
        'generate-academic-answer',
        'manage-ai-control',
        'manage-lecture-summaries',
        'manage-lectures',
        'manage-material-analysis',
        'manage-pdf-documents',
        'manage-pdf-publications',
        'manage-polls',
        'operator-live-snapshot',
      ].includes(functionName)
    ) {
      expectMockGoogleAdminCredential(body, googleAdmin)
    }
    if (functionName === 'manage-lectures') {
      state.lectureRequests.push(body)
      if (invalidAdminSession && body.action === 'list') {
        await fulfillJson(
          route,
          { message: 'Invalid Admin session.', ok: false },
          401,
        )
        return
      }
      if (body.action === 'createJournalClubRun') {
        const runKind = body.runKind as JournalClubRunKind
        const created = makeLecture(runKind)
        state.lectures = [
          created,
          ...state.lectures.filter((lecture) => lecture.id !== created.id),
        ]
        await fulfillJson(route, {
          createdLectureSessionId: created.id,
          idempotentReplay: false,
          lectures: state.lectures,
          ok: true,
        })
        return
      }
      if (rejectStartWithoutPdf && body.action === 'start') {
        await fulfillJson(
          route,
          { message: 'Journal Club PDF is not active', ok: false },
          409,
        )
        return
      }
      await fulfillJson(route, { lectures: state.lectures, ok: true })
      return
    }
    if (functionName === 'manage-polls') {
      state.pollRequests.push(body)
      await fulfillJson(route, {
        hasMore: false,
        ok: true,
        polls:
          body.action === 'list' && typeof body.lectureSessionId === 'string'
            ? makePolls(body.lectureSessionId)
            : [],
      })
      return
    }
    if (functionName === 'manage-pdf-documents') {
      await fulfillJson(route, { documents: [], ok: true })
      return
    }
    if (functionName === 'manage-pdf-publications') {
      state.pdfPublicationActions.push(String(body.action ?? ''))
      state.pdfPublicationRequests.push(body)
      await fulfillJson(route, { found: false, ok: true })
      return
    }
    if (functionName === 'operator-live-snapshot') {
      if (missingOperatorSnapshot) {
        await fulfillJson(
          route,
          { message: 'Lecture was not found.', ok: false },
          404,
        )
        return
      }
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
    const safeAiStatusRead =
      (functionName === 'admin-ai-unlock' && body.action === 'masterStatus') ||
      (functionName === 'manage-material-analysis' && body.action === 'list') ||
      (body.action === 'status' &&
        [
          'generate-academic-answer',
          'manage-ai-control',
          'manage-lecture-summaries',
        ].includes(functionName))
    if (
      /ai|academic|caption|material|realtime|summar/i.test(functionName) &&
      !safeAiStatusRead
    ) {
      state.aiFunctionCalls.push(functionName)
    }
    await fulfillJson(route, { ok: true })
  })

  return state
}

test.describe('Phase 7.27 flag ON', () => {
  test.skip(
    process.env.VITE_PHASE7_28_JOURNAL_CLUB_PRESET_CREATION !== 'true',
    'Phase 7.27 preset creation requires its dedicated recovery runner.',
  )

  test('bounds a stalled archive lookup and opens the live lecture before resume-token delivery', async ({
    page,
  }) => {
    const lectureCode = '731042'
    const lectureTitle = 'Bounded live lecture'
    const liveJoinLecture: LiveJoinLecture = {
      ends_at: null,
      lecture_session_id: '72700000-0000-4000-8000-000000000777',
      participant_id: '72700000-0000-4000-8000-000000000778',
      starts_at: null,
      status: 'open',
      title: lectureTitle,
    }
    await installTurnstileMock(page)
    const state = await installNetworkMocks(page, {
      liveJoinLecture,
      resumeIssueDelayMs: 8_000,
    })
    let archiveResolveRequests = 0
    await page.route(
      'https://pdf.example/v1/archives/resolve',
      async (route) => {
        archiveResolveRequests += 1
        await new Promise((resolve) => setTimeout(resolve, 15_000))
        await route
          .fulfill({
            body: JSON.stringify({ message: 'late archive miss', ok: false }),
            contentType: 'application/json',
            status: 404,
          })
          .catch(() => undefined)
      },
    )

    await page.goto('/join')
    await page.getByLabel('講義コード').fill(lectureCode)
    const startedAt = Date.now()
    await page.getByRole('button', { name: '参加する' }).click()
    await expect(page.getByRole('heading', { name: lectureTitle })).toBeVisible(
      { timeout: 12_000 },
    )

    expect(Date.now() - startedAt).toBeLessThan(12_000)
    expect(archiveResolveRequests).toBe(1)
    expect(state.liveJoinRequests).toBe(1)
    expect(state.resumeIssueResolvedAt).toBeNull()

    await expect
      .poll(() => state.resumeIssueResolvedAt, { timeout: 12_000 })
      .not.toBeNull()
    await expect
      .poll(
        () =>
          page.evaluate(() => {
            const raw = window.localStorage.getItem(
              'compass-interactive-lecture-resume-tokens-v1',
            )
            return raw ? JSON.parse(raw).length : 0
          }),
        { timeout: 12_000 },
      )
      .toBe(1)
  })

  test('physically aborts stalled anonymous signup, deduplicates callers, and retries without a late session', async ({
    page,
  }, testInfo) => {
    test.skip(
      testInfo.project.name.startsWith('mobile-'),
      'The deadline contract is exercised once per browser engine.',
    )

    const delayedUserId = '72700000-0000-4000-8000-000000000101'
    const retryUserId = '72700000-0000-4000-8000-000000000102'
    await installTurnstileMock(page)
    const state = await installNetworkMocks(page, {
      anonymousSignupDelayMs: [16_000, 0],
      anonymousSignupUserIds: [delayedUserId, retryUserId],
    })
    await page.goto('/join')

    const turnstileAbort = await page.evaluate(async () => {
      const testWindow = window as unknown as Window & {
        __compassTurnstileTest: {
          mode: 'resolve' | 'stall'
          removeCount: number
          renderCount: number
        }
      }
      testWindow.__compassTurnstileTest.mode = 'stall'
      const modulePath = '/src/lib/turnstile.ts'
      const turnstileModule = (await import(/* @vite-ignore */ modulePath)) as {
        getAnonymousSignInCaptchaToken: (
          signal?: AbortSignal,
        ) => Promise<string | undefined>
      }
      const controller = new AbortController()
      window.setTimeout(() => controller.abort(), 50)
      let rejected = false
      try {
        await turnstileModule.getAnonymousSignInCaptchaToken(controller.signal)
      } catch {
        rejected = true
      }
      return {
        layerCount: document.querySelectorAll('.turnstile-challenge-layer')
          .length,
        rejected,
        removeCount: testWindow.__compassTurnstileTest.removeCount,
      }
    })
    expect(turnstileAbort).toEqual({
      layerCount: 0,
      rejected: true,
      removeCount: 1,
    })

    await page.evaluate(() => {
      const testWindow = window as unknown as Window & {
        __compassTurnstileTest: { mode: 'resolve' | 'stall' }
      }
      testWindow.__compassTurnstileTest.mode = 'resolve'
    })

    const startedAt = Date.now()
    const firstAttempts = await page.evaluate(async () => {
      const modulePath = '/src/lib/anonymousAuth.ts'
      const anonymousAuth = (await import(/* @vite-ignore */ modulePath)) as {
        ensureAnonymousAuthSession: () => Promise<string>
      }
      const results = await Promise.allSettled([
        anonymousAuth.ensureAnonymousAuthSession(),
        anonymousAuth.ensureAnonymousAuthSession(),
      ])
      return results.map((result) =>
        result.status === 'fulfilled'
          ? { status: result.status, value: result.value }
          : {
              message:
                result.reason instanceof Error
                  ? result.reason.message
                  : String(result.reason),
              status: result.status,
            },
      )
    })

    expect(Date.now() - startedAt).toBeLessThan(15_000)
    expect(state.anonymousSignupRequests).toBe(1)
    expect(state.liveJoinRequests).toBe(0)
    expect(firstAttempts).toHaveLength(2)
    for (const result of firstAttempts) {
      expect(result.status).toBe('rejected')
      expect('message' in result ? result.message : '').toContain(
        '匿名セッションの開始に時間がかかっています',
      )
    }
    await expect
      .poll(
        () =>
          page.evaluate(() =>
            window.localStorage.getItem('sb-example-auth-token'),
          ),
        { timeout: 1_000 },
      )
      .toBeNull()

    const retriedUserId = await page.evaluate(async () => {
      const modulePath = '/src/lib/anonymousAuth.ts'
      const anonymousAuth = (await import(/* @vite-ignore */ modulePath)) as {
        ensureAnonymousAuthSession: () => Promise<string>
      }
      return await anonymousAuth.ensureAnonymousAuthSession()
    })
    expect(retriedUserId).toBe(retryUserId)
    expect(state.anonymousSignupRequests).toBe(2)

    await expect
      .poll(() => state.anonymousSignupHandlerSettled, { timeout: 6_000 })
      .toBe(2)
    await expect
      .poll(
        () =>
          page.evaluate(async () => {
            const modulePath = '/src/lib/supabaseClient.ts'
            const clientModule = (await import(
              /* @vite-ignore */ modulePath
            )) as {
              supabase: {
                auth: {
                  getSession: () => Promise<{
                    data: { session: { user: { id: string } } | null }
                  }>
                }
              }
            }
            const { data } = await clientModule.supabase.auth.getSession()
            return data.session?.user.id ?? null
          }),
        { timeout: 2_000 },
      )
      .toBe(retryUserId)
    expect(state.anonymousSignupRequestFailures).toBeGreaterThanOrEqual(1)
  })

  test('prepares isolated rehearsal and production drafts without starting paid or live work', async ({
    page,
  }) => {
    await installAdminState(page)
    const state = await installNetworkMocks(page)

    await page.goto('/admin')
    const preset = page.locator('.journal-club-preset')
    await expect(preset).toBeVisible()
    await expect(preset).toContainText(
      'Dual-targeting CasRx for C9orf72 ALS/FTD',
    )
    await expect(preset).toContainText(
      '講義資料と6件の投票を、独立した講義として追加します。',
    )
    await expectNoSeriousAccessibilityViolations(page)

    const rehearsalButton = preset.getByRole('button', {
      name: 'リハーサルを一覧に追加',
    })
    const productionButton = preset.getByRole('button', {
      name: '7/23 本番を一覧に追加',
    })
    await rehearsalButton.focus()
    await expect(rehearsalButton).toBeFocused()
    await page.keyboard.press('Tab')
    await expect(productionButton).toBeFocused()

    await page.evaluate(() => {
      const originalConfirm = window.confirm
      window.confirm = () => {
        window.confirm = originalConfirm
        return false
      }
    })
    // Keep the cancellation path on a trusted pointer click without leaving a
    // dismissed native dialog to absorb Mobile WebKit's next pointer action.
    // The accepted path below still verifies the real dialog and its copy.
    await productionButton.click()
    expect(
      state.lectureRequests.filter(
        (request) => request.action === 'createJournalClubRun',
      ),
    ).toHaveLength(0)

    await rehearsalButton.click()
    await expect(preset.getByRole('status')).toContainText(
      'リハーサルを講義一覧に追加しました。',
    )
    await expect(preset).toContainText('リハーサルを選択中')
    await expect(page.getByText('リハーサル', { exact: true })).toHaveCount(1)

    await expect
      .poll(() => page.locator('.poll-admin-row strong').allTextContents())
      .toEqual([...pollQuestions])
    await expect(page.locator('.poll-admin-row')).toHaveCount(6)
    await expect(
      page.locator('.poll-admin-row .status-pill.draft'),
    ).toHaveCount(6)
    await expect(
      page.getByRole('button', { name: '投票履歴を見る' }),
    ).toHaveCount(0)

    await Promise.all([
      page.waitForEvent('dialog').then(async (dialog) => {
        expect(dialog.message()).toContain('講義と投票はまだ開始されません。')
        await dialog.accept()
      }),
      preset.getByRole('button', { name: '7/23 本番を一覧に追加' }).click(),
    ])
    await expect(preset.getByRole('status')).toContainText(
      '本番を講義一覧に追加しました。',
    )
    await expect(preset).toContainText('本番を選択中')
    await expect(
      preset.getByRole('button', { name: '本番は準備済み' }),
    ).toBeDisabled()
    await expect(page.getByText('本番', { exact: true })).toHaveCount(1)

    await expect
      .poll(() => page.locator('.poll-admin-row strong').allTextContents())
      .toEqual([...pollQuestions])
    await expect(
      page.locator('.poll-admin-row .status-pill.draft'),
    ).toHaveCount(6)

    const prepareRequests = state.lectureRequests.filter(
      (request) => request.action === 'createJournalClubRun',
    )
    expect(prepareRequests).toHaveLength(2)
    expect(prepareRequests.map((request) => request.runKind)).toEqual([
      'rehearsal',
      'production',
    ])
    for (const request of prepareRequests) {
      expect(request.appSessionToken).toBe(googleAdmin.appSessionToken)
      expect(request).not.toHaveProperty('adminToken')
      expect(request.clientRequestId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      )
    }
    expect(
      state.lectureRequests.every((request) =>
        ['list', 'createJournalClubRun'].includes(String(request.action)),
      ),
    ).toBe(true)
    expect(
      state.pollRequests.every((request) => request.action === 'list'),
    ).toBe(true)
    expect(
      state.pollRequests
        .filter((request) => request.action === 'list')
        .every((request) => request.includeHistory === true),
    ).toBe(true)
    expect(
      state.pdfPublicationActions.every((action) => action === 'discover'),
    ).toBe(true)
    expect(state.uploadRequests).toBe(0)
    expect(state.aiFunctionCalls).toEqual([])

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
  })

  test('keeps the canonical Journal Club document binding when the teacher selects a PDF', async ({
    page,
  }) => {
    await installAdminState(page)
    const state = await installNetworkMocks(page)

    await page.goto('/admin')
    await page.getByRole('button', { name: 'リハーサルを一覧に追加' }).click()

    const pdfPanel = page.locator('#admin-live .publisher-control-panel')
    await expect(pdfPanel).toBeVisible()
    await expect(
      pdfPanel.getByRole('heading', {
        name: '講義資料を公開する',
      }),
    ).toBeVisible()
    await expect(pdfPanel).toContainText('講義資料を選択（34ページ・5.55MB）')
    await expect(pdfPanel).toContainText(
      '講義資料: 260723 JournalClub Presentation.pdf',
    )

    const documentOptions = page.locator(
      '#admin-live .pdf-document-control select option',
    )
    await expect(documentOptions).toHaveCount(1)
    await expect(documentOptions.first()).toHaveText(
      '講義資料を上の欄から公開してください',
    )

    await pdfPanel.locator('input[type="file"]').setInputFiles(samplePdfPath)
    const publishButton = pdfPanel.locator('button.primary-button')
    await expect(publishButton).toBeEnabled()
    await publishButton.dispatchEvent('click')

    await expect
      .poll(() =>
        state.pdfPublicationRequests.find(
          (request) => request.action === 'initiate',
        ),
      )
      .toMatchObject({
        action: 'initiate',
        documentId: expectedDocumentId,
        lectureSessionId: rehearsalLectureId,
      })
  })

  test('clears a missing saved lecture without revoking the Admin session', async ({
    page,
  }) => {
    const pageErrors: Error[] = []
    page.on('pageerror', (error) => pageErrors.push(error))
    await installMockGoogleAdminSession(page, googleAdmin)
    await page.addInitScript(() => {
      window.localStorage.setItem(
        'compass-interactive-lecture-session-id',
        '72700000-0000-4000-8000-000000000404',
      )
      window.localStorage.setItem(
        'compass-interactive-lecture-runtime-mode',
        'live',
      )
      window.localStorage.setItem(
        'compass-interactive-lecture-title',
        'Deleted local lecture',
      )
      window.localStorage.setItem('compass-interactive-lecture-status', 'open')
    })
    await installNetworkMocks(page, { missingOperatorSnapshot: true })
    const missingSnapshotResponse = page.waitForResponse(
      (response) =>
        response.url().endsWith('/functions/v1/operator-live-snapshot') &&
        response.status() === 404,
    )

    await page.goto('/admin')
    await missingSnapshotResponse
    await expect(page.getByText('まだ講義がありません。')).toBeVisible()
    await expect(
      page.getByRole('heading', { name: '講義を準備する', exact: true }),
    ).toBeVisible()
    await expect(page.getByRole('tab')).toHaveCount(1)
    await expect(page.locator('#teacher-workspace-material')).toBeVisible()
    await expect(page.locator('main')).not.toContainText(
      'Deleted local lecture',
    )
    await expect
      .poll(() =>
        page.evaluate(() => ({
          appSessionToken: window.sessionStorage.getItem(
            'compass-interactive-admin-google-app-session-v1',
          ),
          authPresent: Boolean(
            window.localStorage.getItem(
              'compass-interactive-admin-supabase-auth-v1',
            ),
          ),
          lectureSessionId: window.localStorage.getItem(
            'compass-interactive-lecture-session-id',
          ),
        })),
      )
      .toEqual({
        appSessionToken: googleAdmin.appSessionToken,
        authPresent: true,
        lectureSessionId: null,
      })
    await expect(
      page.getByRole('button', { name: 'リハーサルを一覧に追加' }),
    ).toBeEnabled()
    expect(pageErrors).toEqual([])
  })

  test('expires an invalid saved Admin session instead of leaving stale controls active', async ({
    page,
  }) => {
    await installAdminState(page)
    await installNetworkMocks(page, { invalidAdminSession: true })

    await page.goto('/admin')
    await expect(page.locator('.admin-identity-card')).toBeVisible()
    await expect(
      page.getByRole('heading', { name: '教員ポータル' }),
    ).toBeVisible()
    await expect(page.locator('input[type="password"]')).toHaveCount(0)
    await expect(page.locator('#admin-live')).toHaveCount(0)
    await expect(
      page.getByText(
        '管理者セッションの有効期限が切れました。Googleログインからやり直してください。',
      ),
    ).toBeVisible()
    await expect
      .poll(() =>
        page.evaluate(() => ({
          appSessionToken: window.sessionStorage.getItem(
            'compass-interactive-admin-google-app-session-v1',
          ),
          authPresent: Boolean(
            window.localStorage.getItem(
              'compass-interactive-admin-supabase-auth-v1',
            ),
          ),
        })),
      )
      .toEqual({ appSessionToken: null, authPresent: false })
  })

  test('explains the shared PDF start guard in teacher-facing language', async ({
    page,
  }) => {
    await installAdminState(page)
    await installNetworkMocks(page, { rejectStartWithoutPdf: true })

    await page.goto('/admin')
    await page.getByRole('button', { name: 'リハーサルを一覧に追加' }).click()
    const rehearsalRow = page
      .locator('.lecture-admin-row')
      .filter({ hasText: 'リハーサル' })
    await rehearsalRow
      .getByRole('button', { name: '開始', exact: true })
      .click()

    await expect(
      page.getByText('講義資料を学生に公開してから講義を開始してください。'),
    ).toBeVisible()
    await expect(rehearsalRow.locator('.status-pill.draft')).toHaveText(
      '準備中',
    )
  })

  for (const [name, policy, expectedMode] of [
    [
      'exact permanent policy is shown as continuously available',
      {
        mode: 'permanent',
        policy_id: 'phase7-27-journal-club-2026-07-23-v1',
      },
      'permanent',
    ],
    [
      'extra policy keys cannot opt an archive into permanent display',
      {
        mode: 'permanent',
        policy_id: 'phase7-27-journal-club-2026-07-23-v1',
        retention_days: 0,
      },
      'standard',
    ],
  ] as const) {
    test(name, async ({ page }) => {
      const archiveRequests: string[] = []
      page.on('request', (request) => {
        if (
          request.url().includes('/v1/archives/') ||
          request.url().includes('challenges.cloudflare.com')
        ) {
          archiveRequests.push(`${request.method()} ${request.url()}`)
        }
      })
      await page.addInitScript(() => {
        window.sessionStorage.setItem(
          'compass-interactive-lecture-archive-resume-code-v1',
          '723001',
        )
      })
      await installNetworkMocks(page)
      await page.route(
        'https://pdf.example/v1/archives/resolve',
        async (route) => {
          if (route.request().method() === 'OPTIONS') {
            await route.fulfill({
              headers: {
                'Access-Control-Allow-Headers': '*',
                'Access-Control-Allow-Methods': 'POST, OPTIONS',
                'Access-Control-Allow-Origin': '*',
              },
              status: 204,
            })
            return
          }
          await route.fulfill({
            body: JSON.stringify(archiveResolveResponse(policy)),
            contentType: 'application/json',
            headers: { 'Access-Control-Allow-Origin': '*' },
            status: 200,
          })
        },
      )

      await page.goto('/lecture/archive')
      await expect
        .poll(() => archiveRequests, {
          message: 'Archive resume must call the configured Worker.',
        })
        .toContain('POST https://pdf.example/v1/archives/resolve')
      await expect(
        page.getByRole('heading', {
          name: 'Dual-targeting CasRx for C9orf72 ALS/FTD',
        }),
      ).toBeVisible()
      const retentionNote = page.locator('.archive-expiry-note')
      if (expectedMode === 'permanent') {
        await expect(retentionNote).toContainText('継続公開')
      } else {
        await expect(retentionNote).not.toContainText('継続公開')
        await expect(retentionNote).toContainText('まで閲覧できます')
      }
      await expectNoSeriousAccessibilityViolations(page)
    })
  }
})

test.describe('Phase 7.28 Journal Club creation retired', () => {
  test.skip(
    process.env.VITE_PHASE7_27_JOURNAL_CLUB !== 'true' ||
      process.env.VITE_PHASE7_28_JOURNAL_CLUB_PRESET_CREATION !== 'false' ||
      process.env.VITE_PHASE7_30_ADMIN_IDENTITY !== 'true' ||
      process.env.VITE_PHASE7_30_GOOGLE_ADMIN_OPERATIONS !== 'true',
    'Phase 7.28 retirement requires Google Admin and history compatibility ON with creation OFF.',
  )

  test('keeps the preset hidden and issues no Journal Club prepare request', async ({
    page,
  }) => {
    await installAdminState(page)
    const state = await installNetworkMocks(page)

    await page.goto('/admin')
    await expect(page.locator('#admin-live')).toBeVisible()
    const settingsLink = page.getByRole('link', {
      name: '教員管理',
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
    await expect(page.locator('.journal-club-preset')).toHaveCount(0)
    await expect(
      page.getByRole('button', { name: 'リハーサルを一覧に追加' }),
    ).toHaveCount(0)
    await expect(
      page.getByRole('button', { name: '7/23 本番を一覧に追加' }),
    ).toHaveCount(0)
    expect(
      state.lectureRequests.some(
        (request) => request.action === 'createJournalClubRun',
      ),
    ).toBe(false)
    expect(state.aiFunctionCalls).toEqual([])
    expect(state.uploadRequests).toBe(0)
  })
})
