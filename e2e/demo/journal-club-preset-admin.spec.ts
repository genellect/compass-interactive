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
  aiActivationIntentRequests: Array<Record<string, unknown>>
  aiActivationIntentStatusResponses: number
  aiFunctionCalls: string[]
  aiMasterStatusHoldsStarted: number
  aiMasterStatusRequests: Array<Record<string, unknown>>
  aiMasterStatusResponses: number
  anonymousSignupHandlerSettled: number
  anonymousSignupRequestFailures: number
  anonymousSignupRequests: number
  lectures: Lecture[]
  lectureRequests: Array<Record<string, unknown>>
  liveJoinRequestedAt: number | null
  liveJoinRequests: number
  pdfPublicationActions: string[]
  pdfPublicationRequests: Array<Record<string, unknown>>
  pollRequests: Array<Record<string, unknown>>
  holdAiMasterStatusRequest: (
    lectureSessionId: string,
    requestNumber: number,
  ) => void
  releaseAiMasterStatus: () => void
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

async function installTurnstileMock(page: Page, anonymousDelayMs = 0) {
  await page.addInitScript((delayMs) => {
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
          options: { action: string; callback: (token: string) => void },
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
    const timers = new Map<string, number>()
    testWindow.turnstile = {
      remove: (widgetId) => {
        state.removeCount += 1
        window.clearTimeout(timers.get(widgetId))
        timers.delete(widgetId)
      },
      render: (_container, options) => {
        state.renderCount += 1
        const widgetId = `turnstile-widget-${state.renderCount}`
        if (state.mode === 'resolve') {
          const complete = () => options.callback(`turnstile-token-${widgetId}`)
          if (options.action === 'anonymous-sign-in' && delayMs > 0) {
            timers.set(widgetId, window.setTimeout(complete, delayMs))
          } else {
            queueMicrotask(complete)
          }
        }
        return widgetId
      },
    }
  }, anonymousDelayMs)
}

async function installSavedSessionRestore(
  page: Page,
  { delayMs = 0, hold = false, expired = true, isAnonymous = true } = {},
) {
  const userId = '72700000-0000-4000-8000-000000000103'
  const participantId = '72700000-0000-4000-8000-000000000778'
  const title = 'Saved session lecture entry'
  const unexpectedOrigins: string[] = []
  const browserErrors: string[] = []
  page.on('pageerror', (error) => browserErrors.push(error.message))
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url())
    if (
      ['http:', 'https:'].includes(url.protocol) &&
      !['127.0.0.1', 'localhost'].includes(url.hostname)
    ) {
      unexpectedOrigins.push(url.origin)
      await route.abort('blockedbyclient')
      return
    }
    await route.continue()
  })
  await installTurnstileMock(page)
  const state = await installNetworkMocks(page, {
    liveJoinLecture: {
      ends_at: null,
      lecture_session_id: '72700000-0000-4000-8000-000000000777',
      participant_id: participantId,
      starts_at: null,
      status: 'open',
      title,
    },
  })
  await page.route('https://pdf.example/v1/archives/resolve', (route) =>
    route.fulfill({ status: 404, body: '{}' }),
  )
  const session = anonymousSessionResponse(userId)
  const expiresAt = Math.floor(Date.now() / 1_000) + (expired ? -60 : 3_600)
  const tokenParts = session.access_token.split('.')
  const payload = JSON.parse(Buffer.from(tokenParts[1], 'base64url').toString())
  tokenParts[1] = encodeJwtPart({ ...payload, exp: expiresAt })
  await page.addInitScript(
    (savedSession) => {
      window.localStorage.setItem(
        'sb-example-auth-token',
        JSON.stringify(savedSession),
      )
    },
    {
      ...session,
      access_token: tokenParts.join('.'),
      expires_at: expiresAt,
      user: { ...session.user, is_anonymous: isAnonymous },
    },
  )
  const restore = { requests: 0, startedAt: 0, finished: false }
  let releaseRestore!: () => void
  const gate = new Promise<void>((resolve) => {
    releaseRestore = resolve
  })
  await page.route(
    'https://example.supabase.co/auth/v1/token?grant_type=refresh_token',
    async (route) => {
      restore.requests += 1
      restore.startedAt = Date.now()
      if (hold) await gate
      if (delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs))
      await fulfillJson(route, anonymousSessionResponse(userId))
      restore.finished = true
    },
  )
  const joinedUsers: string[] = []
  page.on('request', (request) => {
    if (
      new URL(request.url()).pathname !== '/rest/v1/rpc/join_lecture_by_code_v2'
    )
      return
    const token = (request.headers().authorization ?? '').replace(
      /^Bearer /i,
      '',
    )
    const claims = JSON.parse(
      Buffer.from(token.split('.')[1], 'base64url').toString(),
    )
    joinedUsers.push(claims.sub)
  })
  await page.route('**/rest/v1/rpc/get_lecture_participant_state_v2', (route) =>
    fulfillJson(route, {
      contract_version: 2,
      membership: { participant_id: participantId },
      commenting: { allowed: true, max_length: 120, next_allowed_at: null },
      liked_comment_ids: [],
      poll_responses: [],
    }),
  )
  await page.route('**/rest/v1/rpc/get_lecture_public_snapshot_v*', (route) =>
    fulfillJson(route, {
      contract_version: 2,
      server_time: new Date().toISOString(),
      versions: {
        caption: 1,
        comments: 1,
        lecture: 1,
        likes: 1,
        metrics: 1,
        pdf: 1,
        polls: 1,
        summaries: 1,
      },
      changed: {
        comments: {
          has_more: false,
          has_older: false,
          items: [],
          mode: 'initial',
        },
        polls: [],
        metrics: {
          participant_count_approximate: 1,
          participant_count_mode: 'active_90s',
          updated_at: new Date().toISOString(),
          visible_comment_count: 0,
        },
      },
    }),
  )
  return {
    browserErrors,
    joinedUsers,
    releaseRestore,
    restore,
    state,
    title,
    unexpectedOrigins,
    userId,
  }
}

async function ensureTestAnonymousSession(
  page: Page,
  kind: 'student' | 'display',
) {
  return await page.evaluate(async (clientKind) => {
    const modulePath =
      clientKind === 'student'
        ? '/src/lib/anonymousAuth.ts'
        : '/src/lib/displaySupabaseClient.ts'
    const auth = (await import(/* @vite-ignore */ modulePath)) as {
      ensureAnonymousAuthSession: () => Promise<string>
      ensureDisplayAnonymousAuthSession: () => Promise<string>
    }
    const ensure =
      clientKind === 'student'
        ? auth.ensureAnonymousAuthSession
        : auth.ensureDisplayAnonymousAuthSession
    return await Promise.all([ensure(), ensure()])
  }, kind)
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
  let aiMasterStatusHoldPending = false
  let aiMasterStatusHoldLectureId: string | null = null
  let aiMasterStatusHoldRequestNumber = 0
  let aiMasterStatusGateResolve: (() => void) | null = null
  let aiActivationIntentArmed = false
  let aiActivationIntentVersion = 0
  const state: MockState = {
    aiActivationIntentRequests: [],
    aiActivationIntentStatusResponses: 0,
    aiFunctionCalls: [],
    aiMasterStatusHoldsStarted: 0,
    aiMasterStatusRequests: [],
    aiMasterStatusResponses: 0,
    anonymousSignupHandlerSettled: 0,
    anonymousSignupRequestFailures: 0,
    anonymousSignupRequests: 0,
    lectures: [],
    lectureRequests: [],
    liveJoinRequestedAt: null,
    liveJoinRequests: 0,
    pdfPublicationActions: [],
    pdfPublicationRequests: [],
    pollRequests: [],
    holdAiMasterStatusRequest: (lectureSessionId, requestNumber) => {
      if (aiMasterStatusHoldPending || aiMasterStatusGateResolve) {
        throw new Error('An AI master-status hold is already active.')
      }
      aiMasterStatusHoldPending = true
      aiMasterStatusHoldLectureId = lectureSessionId
      aiMasterStatusHoldRequestNumber = requestNumber
    },
    releaseAiMasterStatus: () => {
      aiMasterStatusHoldPending = false
      aiMasterStatusHoldLectureId = null
      aiMasterStatusHoldRequestNumber = 0
      aiMasterStatusGateResolve?.()
      aiMasterStatusGateResolve = null
    },
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
      state.liveJoinRequestedAt = Date.now()
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
        'manage-ai-activation-intent',
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
    if (functionName === 'manage-ai-activation-intent') {
      state.aiActivationIntentRequests.push(body)
      if (body.action === 'set') {
        aiActivationIntentArmed = body.enabled === true
        aiActivationIntentVersion += 1
      } else if (body.action !== 'status') {
        await fulfillJson(
          route,
          { message: 'Unexpected action.', ok: false },
          400,
        )
        return
      }
      await fulfillJson(route, {
        activationExpiresAt: null,
        armed: aiActivationIntentArmed,
        armedAt: aiActivationIntentArmed ? new Date().toISOString() : null,
        consumedAt: null,
        idempotentReplay: false,
        ok: true,
        serverTime: new Date().toISOString(),
        state: aiActivationIntentArmed ? 'armed' : 'none',
        version: aiActivationIntentVersion,
      })
      if (body.action === 'status') {
        state.aiActivationIntentStatusResponses += 1
      }
      return
    }
    if (functionName === 'admin-ai-unlock' && body.action === 'masterStatus') {
      state.aiMasterStatusRequests.push(body)
      const matchingRequestNumber = state.aiMasterStatusRequests.filter(
        (request) => request.lectureSessionId === aiMasterStatusHoldLectureId,
      ).length
      if (
        aiMasterStatusHoldPending &&
        body.lectureSessionId === aiMasterStatusHoldLectureId &&
        matchingRequestNumber === aiMasterStatusHoldRequestNumber
      ) {
        aiMasterStatusHoldPending = false
        aiMasterStatusHoldLectureId = null
        aiMasterStatusHoldRequestNumber = 0
        const aiMasterStatusGate = new Promise<void>((resolve) => {
          aiMasterStatusGateResolve = resolve
        })
        state.aiMasterStatusHoldsStarted += 1
        await aiMasterStatusGate
      }
      await fulfillJson(route, {
        admissionBlockedReason: 'lecture_not_open',
        admissionEnabled: false,
        allowedScopes: [],
        authorization: null,
        canUseAi: true,
        lectureOpen: false,
        ok: true,
        policy: null,
        reason: null,
        serverTime: new Date().toISOString(),
      })
      state.aiMasterStatusResponses += 1
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

  for (const entry of ['QR', 'code'] as const) {
    test(`${entry} live entry clears demo content while the first snapshot is pending`, async ({
      page,
    }) => {
      const lectureTitle = 'Fresh live lecture'
      await installTurnstileMock(page)
      await installNetworkMocks(page, {
        liveJoinLecture: {
          ends_at: null,
          lecture_session_id: '72700000-0000-4000-8000-000000000777',
          participant_id: '72700000-0000-4000-8000-000000000778',
          starts_at: null,
          status: 'open',
          title: lectureTitle,
        },
      })
      await page.route('https://pdf.example/v1/archives/resolve', (route) =>
        route.fulfill({ status: 404, body: '{}' }),
      )
      let releaseSnapshot!: () => void
      const snapshotGate = new Promise<void>((resolve) => {
        releaseSnapshot = resolve
      })
      let snapshotRequests = 0
      await page.route(
        '**/rest/v1/rpc/get_lecture_public_snapshot_v*',
        async (route) => {
          snapshotRequests += 1
          await snapshotGate
          await fulfillJson(route, {
            contract_version: 2,
            server_time: new Date().toISOString(),
            versions: {
              caption: 1,
              comments: 1,
              lecture: 1,
              likes: 1,
              metrics: 1,
              pdf: 1,
              polls: 1,
              summaries: 1,
            },
            changed: {
              comments: {
                has_more: false,
                has_older: false,
                items: [],
                mode: 'initial',
              },
              polls: [],
              metrics: {
                participant_count_approximate: 2,
                participant_count_mode: 'active_90s',
                updated_at: new Date().toISOString(),
                visible_comment_count: 0,
              },
            },
          })
        },
      )
      await page.goto('/demo')
      await expect(
        page.getByRole('heading', { name: 'AI時代の英語と学び' }),
      ).toBeVisible()
      await expect(
        page.getByRole('heading', {
          name: '翻訳AIが使える今、英語を学ぶ価値として最も大きいものは？',
        }),
      ).toBeVisible()
      // Keep the real persisted demo session, as on a phone that tried the demo
      // before scanning the classroom QR. No state/auth injection is needed.
      await page.goto(entry === 'QR' ? '/join?code=731042' : '/join')
      if (entry === 'code') {
        await page.getByLabel('講義コード', { exact: true }).fill('731042')
        await page
          .getByRole('button', { name: '参加する', exact: true })
          .click()
      }
      try {
        await expect(
          page.getByRole('heading', { name: lectureTitle }),
        ).toBeVisible()
        await expect.poll(() => snapshotRequests).toBeGreaterThan(0)
        await expect(page.getByLabel('講義の現在状況')).toContainText('約1')
        await expect(page.getByLabel('講義の現在状況')).toContainText('0件の声')
        await expect(
          page.getByText('いま講義とつながっています', { exact: true }),
        ).toHaveCount(0)
        await expect(
          page.getByText('翻訳できる時代に、なぜ英語を学ぶのか。', {
            exact: true,
          }),
        ).toHaveCount(0)
        await expect(
          page.getByText('TOEIC申し込んでみようと思います！', { exact: true }),
        ).toHaveCount(0)
        await expect(
          page.getByRole('heading', {
            name: '翻訳AIが使える今、英語を学ぶ価値として最も大きいものは？',
          }),
        ).toHaveCount(0)
        await expect(
          page.getByRole('heading', { name: 'AIによる参考回答' }),
        ).toHaveCount(0)
      } finally {
        releaseSnapshot()
      }
      await expect(page.getByLabel('講義の現在状況')).toContainText('約2')
      await expect(
        page.getByText('いま講義とつながっています', { exact: true }),
      ).toBeVisible()
    })
  }

  for (const entry of ['QR', 'code'] as const) {
    test(`${entry} restores a saved anonymous session after a 7000ms refresh without another submission`, async ({
      page,
    }) => {
      const fixture = await installSavedSessionRestore(page, { delayMs: 7_000 })
      await page.goto(entry === 'QR' ? '/join?code=731042' : '/join')
      if (entry === 'code') {
        await page.getByLabel('講義コード', { exact: true }).fill('731042')
        await page
          .getByRole('button', { name: '参加する', exact: true })
          .click()
      }
      await expect(
        page.getByRole('heading', { name: fixture.title }),
      ).toBeVisible({ timeout: 10_000 })
      await expect(page).toHaveURL(/\/lecture$/)
      await expect(
        page.getByText('いま講義とつながっています', { exact: true }),
      ).toBeVisible()
      expect(fixture.restore.requests).toBe(1)
      expect(fixture.state.anonymousSignupRequests).toBe(0)
      expect(fixture.state.liveJoinRequests).toBe(1)
      expect(fixture.joinedUsers).toEqual([fixture.userId])
      const savedUser = await page.evaluate(() => {
        const saved = JSON.parse(
          window.localStorage.getItem('sb-example-auth-token') ?? 'null',
        )
        return saved?.user.id ?? null
      })
      expect(savedUser).toBe(fixture.userId)
      expect(fixture.browserErrors).toEqual([])
      expect(fixture.unexpectedOrigins).toEqual([])
    })
  }

  test('bounds a stalled join session restore at twelve seconds and ignores its late completion', async ({
    page,
  }) => {
    const fixture = await installSavedSessionRestore(page, { hold: true })
    try {
      await page.goto('/join?code=731042')
      await expect(page.getByRole('alert')).toHaveText(
        '匿名セッションの確認に時間がかかっています。通信状態を確認して、もう一度お試しください。',
        { timeout: 15_000 },
      )
      const waitedMs = Date.now() - fixture.restore.startedAt
      expect(waitedMs).toBeGreaterThanOrEqual(11_500)
      expect(waitedMs).toBeLessThan(15_000)
      expect(fixture.state.liveJoinRequests).toBe(0)
      fixture.releaseRestore()
      const restoredUser = await page.evaluate(async () => {
        const modulePath = '/src/lib/supabaseClient.ts'
        const client = (await import(/* @vite-ignore */ modulePath)) as {
          supabase: {
            auth: {
              getSession: () => Promise<{
                data: { session: { user: { id: string } } | null }
              }>
            }
          }
        }
        const { data } = await client.supabase.auth.getSession()
        return data.session?.user.id ?? null
      })
      expect(restoredUser).toBe(fixture.userId)
      await expect(page).toHaveURL(/\/join\?code=/)
      expect(fixture.state.liveJoinRequests).toBe(0)
      expect(fixture.restore.requests).toBe(1)
      expect(fixture.state.anonymousSignupRequests).toBe(0)
      expect(fixture.browserErrors).toEqual([])
      expect(fixture.unexpectedOrigins).toEqual([])
    } finally {
      fixture.releaseRestore()
    }
  })

  test('keeps the ordinary six-second deadline while a concurrent join waits for the same refresh', async ({
    page,
  }) => {
    const fixture = await installSavedSessionRestore(page, { delayMs: 7_000 })
    await page.goto('/join')
    const results = await page.evaluate(async () => {
      const modulePath = '/src/lib/anonymousAuth.ts'
      const auth = (await import(/* @vite-ignore */ modulePath)) as {
        ensureAnonymousAuthSession: (
          captchaToken?: string,
          options?: { purpose?: 'lecture-join' },
        ) => Promise<string>
      }
      const startedAt = Date.now()
      const capture = async (request: Promise<string>) => {
        try {
          return { value: await request, elapsedMs: Date.now() - startedAt }
        } catch (error) {
          return {
            message: error instanceof Error ? error.message : String(error),
            elapsedMs: Date.now() - startedAt,
          }
        }
      }
      return await Promise.all([
        capture(auth.ensureAnonymousAuthSession()),
        capture(
          auth.ensureAnonymousAuthSession(undefined, {
            purpose: 'lecture-join',
          }),
        ),
      ])
    })
    expect(results[0].message).toContain(
      '匿名セッションの確認に時間がかかっています',
    )
    expect(results[0].elapsedMs).toBeGreaterThanOrEqual(5_800)
    expect(results[0].elapsedMs).toBeLessThan(7_000)
    expect(results[1].value).toBe(fixture.userId)
    expect(fixture.restore.requests).toBe(1)
    expect(fixture.state.anonymousSignupRequests).toBe(0)
    expect(fixture.state.liveJoinRequests).toBe(0)
    expect(fixture.browserErrors).toEqual([])
    expect(fixture.unexpectedOrigins).toEqual([])
  })

  test('rejects a saved non-anonymous session instead of creating a student identity', async ({
    page,
  }) => {
    const fixture = await installSavedSessionRestore(page, {
      expired: false,
      isAnonymous: false,
    })
    await page.goto('/join?code=731042')
    await expect(page.getByRole('alert')).toContainText(
      '学生用セッションに匿名ではない認証情報が存在します',
    )
    expect(fixture.restore.requests).toBe(0)
    expect(fixture.state.anonymousSignupRequests).toBe(0)
    expect(fixture.state.liveJoinRequests).toBe(0)
    expect(fixture.browserErrors).toEqual([])
    expect(fixture.unexpectedOrigins).toEqual([])
  })

  for (const kind of ['student', 'display'] as const) {
    for (const timing of [
      { challengeMs: 13_000, signupMs: 0 },
      { challengeMs: 11_000, signupMs: 2_000 },
    ]) {
      test(`${kind} gives signup its full network deadline after a ${timing.challengeMs}ms challenge and ${timing.signupMs}ms signup`, async ({
        page,
      }) => {
        const userId = '72700000-0000-4000-8000-000000000103'
        const lectureTitle = 'Cold QR lecture entry'
        await installTurnstileMock(page, timing.challengeMs)
        const state = await installNetworkMocks(page, {
          anonymousSignupDelayMs: [timing.signupMs],
          anonymousSignupUserIds: [userId],
          liveJoinLecture: {
            ends_at: null,
            lecture_session_id: '72700000-0000-4000-8000-000000000777',
            participant_id: '72700000-0000-4000-8000-000000000778',
            starts_at: null,
            status: 'open',
            title: lectureTitle,
          },
        })
        await page.route('https://pdf.example/v1/archives/resolve', (route) =>
          route.fulfill({ status: 404, body: '{}' }),
        )

        if (kind === 'student') {
          // A fresh QR URL must finish without a second form submission.
          await page.goto('/join?code=731042')
          await expect(
            page.getByRole('heading', { name: lectureTitle }),
          ).toBeVisible({ timeout: 20_000 })
          expect(state.liveJoinRequests).toBe(1)
        } else {
          await page.goto('/join')
          expect(await ensureTestAnonymousSession(page, kind)).toEqual([
            userId,
            userId,
          ])
        }

        expect(state.anonymousSignupRequests).toBe(1)
        expect(state.anonymousSignupRequestFailures).toBe(0)
        await expect(page.locator('.turnstile-challenge-layer')).toHaveCount(0)
        const renderCount = await page.evaluate(
          () =>
            (
              window as unknown as {
                __compassTurnstileTest: { renderCount: number }
              }
            ).__compassTurnstileTest.renderCount,
        )
        expect(await ensureTestAnonymousSession(page, kind)).toEqual([
          userId,
          userId,
        ])
        expect(state.anonymousSignupRequests).toBe(1)
        expect(
          await page.evaluate(
            () =>
              (
                window as unknown as {
                  __compassTurnstileTest: { renderCount: number }
                }
              ).__compassTurnstileTest.renderCount,
          ),
        ).toBe(renderCount)
      })
    }
  }

  test('keeps single-use CAPTCHA tokens separate for concurrent Student and Display signup', async ({
    page,
  }) => {
    await installTurnstileMock(page, 50)
    const state = await installNetworkMocks(page)
    const signupTokens: string[] = []
    page.on('request', (request) => {
      const url = new URL(request.url())
      if (
        url.origin === 'https://example.supabase.co' &&
        url.pathname === '/auth/v1/signup'
      ) {
        const body = request.postDataJSON() as {
          gotrue_meta_security: { captcha_token: string }
        }
        signupTokens.push(body.gotrue_meta_security.captcha_token)
      }
    })
    await page.goto('/join')
    await Promise.all([
      ensureTestAnonymousSession(page, 'student'),
      ensureTestAnonymousSession(page, 'display'),
    ])
    expect(state.anonymousSignupRequests).toBe(2)
    expect(signupTokens).toHaveLength(2)
    expect(
      signupTokens.every((token) => token.startsWith('turnstile-token-')),
    ).toBe(true)
    expect(new Set(signupTokens).size).toBe(2)
  })

  test('physically aborts stalled Display signup, deduplicates callers, and preserves the retry session', async ({
    page,
  }, testInfo) => {
    test.skip(
      testInfo.project.name.startsWith('mobile-'),
      'The network abort is exercised once per browser engine.',
    )
    const staleUserId = '72700000-0000-4000-8000-000000000104'
    const retryUserId = '72700000-0000-4000-8000-000000000105'
    await installTurnstileMock(page)
    const state = await installNetworkMocks(page, {
      anonymousSignupDelayMs: [16_000, 0],
      anonymousSignupUserIds: [staleUserId, retryUserId],
    })
    await page.goto('/join')
    const startedAt = Date.now()
    await expect(ensureTestAnonymousSession(page, 'display')).rejects.toThrow(
      'Display匿名セッションの開始に時間がかかっています',
    )
    expect(Date.now() - startedAt).toBeLessThan(15_000)
    expect(state.anonymousSignupRequests).toBe(1)
    expect(
      await page.evaluate(() =>
        window.localStorage.getItem(
          'compass-interactive-display-supabase-auth-v1',
        ),
      ),
    ).toBeNull()
    expect(await ensureTestAnonymousSession(page, 'display')).toEqual([
      retryUserId,
      retryUserId,
    ])
    expect(state.anonymousSignupRequests).toBe(2)
    await expect
      .poll(() => state.anonymousSignupHandlerSettled, { timeout: 6_000 })
      .toBe(2)
    expect(await ensureTestAnonymousSession(page, 'display')).toEqual([
      retryUserId,
      retryUserId,
    ])
    expect(state.anonymousSignupRequests).toBe(2)
    expect(state.anonymousSignupRequestFailures).toBeGreaterThanOrEqual(1)
  })

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
    let archiveResolveStartedAt: number | null = null
    await page.route(
      'https://pdf.example/v1/archives/resolve',
      async (route) => {
        archiveResolveRequests += 1
        archiveResolveStartedAt = Date.now()
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
    await page.getByRole('button', { name: '参加する' }).click()
    await expect
      .poll(() => state.liveJoinRequestedAt, { timeout: 8_000 })
      .not.toBeNull()
    expect(archiveResolveStartedAt).not.toBeNull()
    const archivePreflightDurationMs =
      Number(state.liveJoinRequestedAt) - Number(archiveResolveStartedAt)
    expect(archivePreflightDurationMs).toBeGreaterThanOrEqual(0)
    expect(archivePreflightDurationMs).toBeLessThan(6_000)
    await expect(page.getByRole('heading', { name: lectureTitle })).toBeVisible(
      { timeout: 12_000 },
    )

    expect(archiveResolveRequests).toBe(1)
    expect(state.liveJoinRequests).toBe(1)
    expect(state.resumeIssueResolvedAt).toBeNull()

    await expect
      .poll(() => state.resumeIssueResolvedAt, { timeout: 12_000 })
      .not.toBeNull()
    expect(Number(state.liveJoinRequestedAt)).toBeLessThan(
      Number(state.resumeIssueResolvedAt),
    )
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

  test('keeps the activation intent armed when an older status read finishes after the mutation', async ({
    page,
  }) => {
    await installAdminState(page)
    const state = await installNetworkMocks(page)

    try {
      await page.goto('/admin')
      const preset = page.locator('.journal-club-preset')
      await preset
        .getByRole('button', { name: 'リハーサルを一覧に追加' })
        .click()
      await expect(preset).toContainText('リハーサルを選択中')

      const settledMasterStatusCount = state.aiMasterStatusResponses
      const intentStatusResponsesBeforeRace =
        state.aiActivationIntentStatusResponses
      const heldMasterStatusCount = state.aiMasterStatusHoldsStarted
      const priorRehearsalMasterStatusRequests =
        state.aiMasterStatusRequests.filter(
          (request) => request.lectureSessionId === rehearsalLectureId,
        ).length
      state.holdAiMasterStatusRequest(
        rehearsalLectureId,
        priorRehearsalMasterStatusRequests + 2,
      )
      await page.locator('#teacher-workspace-ai-tab').click()
      await expect
        .poll(() => state.aiMasterStatusHoldsStarted)
        .toBeGreaterThan(heldMasterStatusCount)
      await expect
        .poll(
          () =>
            state.aiActivationIntentRequests.filter(
              (request) =>
                request.action === 'status' &&
                request.lectureSessionId === rehearsalLectureId,
            ).length,
        )
        .toBeGreaterThanOrEqual(1)
      await expect
        .poll(() => state.aiActivationIntentStatusResponses)
        .toBeGreaterThan(intentStatusResponsesBeforeRace)

      const armButton = page.getByRole('button', {
        name: '講義開始時にAI機能を有効にする',
      })
      const cancelButton = page.getByRole('button', {
        name: '講義開始時のAI有効化を取り消す',
      })
      await expect(armButton).toBeVisible()
      await armButton.click()
      await expect(cancelButton).toBeVisible()

      const armRequests = state.aiActivationIntentRequests.filter(
        (request) => request.action === 'set' && request.enabled === true,
      )
      expect(armRequests).toHaveLength(1)
      expect(armRequests[0]).toMatchObject({
        lectureSessionId: rehearsalLectureId,
      })

      state.releaseAiMasterStatus()
      await expect
        .poll(() => state.aiMasterStatusResponses)
        .toBeGreaterThan(settledMasterStatusCount)
      await page.evaluate(
        () =>
          new Promise<void>((resolve) => {
            requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
          }),
      )

      await expect(cancelButton).toBeVisible()
      expect(
        state.aiActivationIntentRequests.filter(
          (request) => request.action === 'set' && request.enabled === true,
        ),
      ).toHaveLength(1)
      expect(
        state.aiActivationIntentRequests.filter(
          (request) => request.action === 'set' && request.enabled === false,
        ),
      ).toHaveLength(0)
    } finally {
      state.releaseAiMasterStatus()
    }
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
    expect(
      [
        ...new Set(
          state.aiActivationIntentRequests.map((request) =>
            String(request.lectureSessionId),
          ),
        ),
      ].sort(),
    ).toEqual([productionLectureId, rehearsalLectureId].sort())
    expect(
      state.aiActivationIntentRequests.every(
        (request) =>
          request.action === 'status' &&
          [rehearsalLectureId, productionLectureId].includes(
            String(request.lectureSessionId),
          ),
      ),
    ).toBe(true)
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
    const workspaceTabs = page.getByRole('tab')
    await expect(workspaceTabs).toHaveCount(4)
    await expect(workspaceTabs.nth(0)).toBeEnabled()
    await expect(workspaceTabs.nth(0)).toHaveAttribute('aria-selected', 'true')
    await expect(workspaceTabs.nth(1)).toBeDisabled()
    await expect(workspaceTabs.nth(2)).toBeDisabled()
    await expect(workspaceTabs.nth(3)).toBeDisabled()
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

  test('expires an invalid saved Admin app session without clearing shared Auth or leaving stale controls active', async ({
    page,
  }) => {
    await installAdminState(page)
    await installNetworkMocks(page, { invalidAdminSession: true })

    await page.goto('/admin')
    await expect(page.locator('.admin-identity-card')).toBeVisible()
    await expect(
      page.getByRole('heading', { name: '教員ポータル' }),
    ).toBeVisible()
    await expect(
      page.getByRole('button', { name: 'Googleで続ける' }),
    ).toBeVisible()
    await expect(page.locator('input[type="password"]')).toHaveCount(0)
    await expect(page.locator('#admin-live')).toHaveCount(0)
    await expect(page.locator('.admin-workflow')).toHaveCount(0)
    await expect(
      page.getByText(
        '管理者セッションの有効期限が切れました。もう一度ログインしてください。',
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
      .toEqual({ appSessionToken: null, authPresent: true })
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
      await installTurnstileMock(page)
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
