import { AxeBuilder } from '@axe-core/playwright'
import { expect, test, type Page, type Route } from '@playwright/test'
import { fileURLToPath } from 'node:url'

const rehearsalLectureId = '72700000-0000-4000-8000-000000000001'
const productionLectureId = '72700000-0000-4000-8000-000000000002'
const expectedDocumentId = 'journal-club-2026-07-23-v1'
const samplePdfPath = fileURLToPath(
  new URL('../../public/lecture-assets/m4-sample-v1.pdf', import.meta.url),
)

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
  lectures: Lecture[]
  lectureRequests: Array<Record<string, unknown>>
  pdfPublicationActions: string[]
  pdfPublicationRequests: Array<Record<string, unknown>>
  pollRequests: Array<Record<string, unknown>>
  uploadRequests: number
}

function encodeJwtPart(value: unknown) {
  return Buffer.from(JSON.stringify(value)).toString('base64url')
}

function anonymousSessionResponse() {
  const nowSeconds = Math.floor(Date.now() / 1_000)
  const user = {
    app_metadata: { provider: 'anonymous', providers: ['anonymous'] },
    aud: 'authenticated',
    confirmed_at: new Date().toISOString(),
    created_at: new Date().toISOString(),
    id: '72700000-0000-4000-8000-000000000099',
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
  await page.addInitScript(() => {
    window.sessionStorage.setItem(
      'compass-interactive-admin-authenticated',
      'true',
    )
    window.sessionStorage.setItem(
      'compass-interactive-admin-token',
      'admin-session-playwright',
    )
    window.localStorage.removeItem('compass-interactive-lecture-session-id')
    window.localStorage.removeItem('compass-interactive-lecture-runtime-mode')
    window.localStorage.removeItem('compass-interactive-lecture-title')
    window.localStorage.removeItem('compass-interactive-lecture-status')
  })
}

async function installNetworkMocks(
  page: Page,
  {
    invalidAdminSession = false,
    missingOperatorSnapshot = false,
    rejectStartWithoutPdf = false,
  } = {},
) {
  const state: MockState = {
    aiFunctionCalls: [],
    lectures: [],
    lectureRequests: [],
    pdfPublicationActions: [],
    pdfPublicationRequests: [],
    pollRequests: [],
    uploadRequests: 0,
  }

  page.on('request', (request) => {
    if (new URL(request.url()).hostname === 'pdf.example') {
      state.uploadRequests += 1
    }
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
      (functionName === 'manage-material-analysis' &&
        body.action === 'list') ||
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

    await Promise.all([
      page.waitForEvent('dialog').then((dialog) => dialog.dismiss()),
      // This branch verifies cancellation state. The accepted path below keeps
      // a real pointer click, so avoid Mobile WebKit occasionally stalling the
      // redundant native-dialog action after the focus-order assertion.
      productionButton.dispatchEvent('click'),
    ])
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
      expect(request.adminToken).toBe('admin-session-playwright')
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
    await publishButton.click()

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
    await page.addInitScript(() => {
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
      page.locator('.stat-card').filter({ hasText: '講義状態' }),
    ).toContainText('未選択')
    await expect
      .poll(() =>
        page.evaluate(() => ({
          adminAuthenticated: window.sessionStorage.getItem(
            'compass-interactive-admin-authenticated',
          ),
          adminToken: window.sessionStorage.getItem(
            'compass-interactive-admin-token',
          ),
          lectureSessionId: window.localStorage.getItem(
            'compass-interactive-lecture-session-id',
          ),
        })),
      )
      .toEqual({
        adminAuthenticated: 'true',
        adminToken: 'admin-session-playwright',
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
    await expect(page.getByLabel('管理PIN')).toBeVisible()
    await expect(
      page.getByText(
        '管理者認証の有効期限が切れました。再度ログインしてください。',
      ),
    ).toBeVisible()
    await expect
      .poll(() =>
        page.evaluate(() => ({
          authenticated: window.sessionStorage.getItem(
            'compass-interactive-admin-authenticated',
          ),
          token: window.sessionStorage.getItem(
            'compass-interactive-admin-token',
          ),
        })),
      )
      .toEqual({ authenticated: null, token: null })
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
      process.env.VITE_PHASE7_28_JOURNAL_CLUB_PRESET_CREATION !== 'false',
    'Phase 7.28 retirement requires history compatibility ON and creation OFF.',
  )

  test('keeps the preset hidden and issues no Journal Club prepare request', async ({
    page,
  }) => {
    await installAdminState(page)
    const state = await installNetworkMocks(page)

    await page.goto('/admin')
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
