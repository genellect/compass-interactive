import { expect, test, type Page, type Route } from '@playwright/test'

const rehearsalLectureId = '72700000-0000-4000-8000-000000000001'
const productionLectureId = '72700000-0000-4000-8000-000000000002'
const expectedDocumentId = 'journal-club-2026-07-23-v1'

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
    title: '7.23 Journal Club',
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

async function installNetworkMocks(page: Page) {
  const state: MockState = {
    aiFunctionCalls: [],
    lectures: [],
    lectureRequests: [],
    pdfPublicationActions: [],
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
      await fulfillJson(route, { found: false, ok: true })
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
    if (/ai|academic|caption|material|realtime|summar/i.test(functionName)) {
      state.aiFunctionCalls.push(functionName)
    }
    await fulfillJson(route, { ok: true })
  })

  return state
}

test.describe('Phase 7.27 flag ON', () => {
  test.skip(
    process.env.VITE_PHASE7_27_JOURNAL_CLUB !== 'true',
    'Phase 7.27 preset requires its dedicated flag-on runner.',
  )

  test('prepares isolated rehearsal and production drafts without starting paid or live work', async ({
    page,
  }) => {
    await installAdminState(page)
    const state = await installNetworkMocks(page)

    await page.goto('/admin')
    const preset = page.locator('.journal-club-preset')
    await expect(preset).toBeVisible()
    await expect(preset).toContainText('7/23 Journal Club')
    await expect(preset).toContainText('作成後も講義と投票は開始されません。')

    await preset.getByRole('button', { name: 'リハーサルを準備' }).click()
    await expect(preset.getByRole('status')).toContainText(
      'リハーサルを準備しました。',
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

    page.once('dialog', async (dialog) => {
      expect(dialog.message()).toContain('講義と投票はまだ開始されません。')
      await dialog.accept()
    })
    await preset.getByRole('button', { name: '7/23 本番を準備' }).click()
    await expect(preset.getByRole('status')).toContainText(
      '本番を準備しました。',
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
})

test.describe('Phase 7.27 flag OFF', () => {
  test.skip(
    process.env.VITE_PHASE7_27_JOURNAL_CLUB !== 'false',
    'Phase 7.27 fallback requires its dedicated flag-off runner.',
  )

  test('keeps the preset hidden and issues no Journal Club prepare request', async ({
    page,
  }) => {
    await installAdminState(page)
    const state = await installNetworkMocks(page)

    await page.goto('/admin')
    await expect(page.locator('.journal-club-preset')).toHaveCount(0)
    await expect(
      page.getByRole('button', { name: 'リハーサルを準備' }),
    ).toHaveCount(0)
    await expect(
      page.getByRole('button', { name: '7/23 本番を準備' }),
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
