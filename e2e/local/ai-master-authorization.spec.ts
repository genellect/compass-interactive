import { AxeBuilder } from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'
import { installBrowserSafetyMonitor } from '../helpers/browserSafety.js'
import { installGoogleAdminSession } from '../helpers/googleAdminSession.js'

const supabaseUrl = process.env.TEST_SUPABASE_URL?.trim() ?? ''
const serviceRoleKey = process.env.TEST_SUPABASE_SERVICE_ROLE_KEY?.trim() ?? ''

async function expectNoSeriousAccessibilityViolations(page: Page) {
  const result = await new AxeBuilder({ page }).analyze()
  expect(
    result.violations
      .filter((violation) =>
        ['critical', 'serious'].includes(violation.impact ?? ''),
      )
      .map((violation) => ({
        id: violation.id,
        targets: violation.nodes.map((node) => node.target.join(' ')),
      })),
  ).toEqual([])
}

test('browser authorizes master AI, starts the provider-free summary scheduler, and atomically stops it', async ({
  page,
}) => {
  test.setTimeout(120_000)
  expect(supabaseUrl).toMatch(/^http:\/\/(127\.0\.0\.1|localhost):/)
  expect(serviceRoleKey).not.toBe('')

  const safety = await installBrowserSafetyMonitor(page)
  const service = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
  })

  await installGoogleAdminSession(page)
  await page.goto('/admin')
  await expect(
    page.getByRole('heading', { name: '講義を準備する' }),
  ).toBeVisible()

  const title = `AI許可E2E ${Date.now()}`
  await page.getByLabel('講義タイトル').fill(title)
  await page.getByRole('button', { name: '新しい講義を作成' }).click()
  const lectureRow = page
    .locator('.lecture-admin-row')
    .filter({ hasText: title })
  const startResponsePromise = page.waitForResponse((response) => {
    const request = response.request()
    if (
      new URL(response.url()).pathname !== '/functions/v1/manage-lectures' ||
      request.method() !== 'POST' ||
      response.status() !== 200
    ) {
      return false
    }
    try {
      const body = request.postDataJSON() as Record<string, unknown>
      return body.action === 'start'
    } catch {
      return false
    }
  })
  await lectureRow.getByRole('button', { name: '開始', exact: true }).click()
  await startResponsePromise
  await expect(lectureRow).toContainText('受付中')
  await page.locator('#teacher-workspace-ai-tab').click()

  const { data: lecture, error: lectureError } = await service
    .from('lecture_sessions')
    .select('id,status')
    .eq('title', title)
    .single()
  expect(lectureError).toBeNull()
  expect(lecture?.id).toBeTruthy()
  expect(lecture?.status).toBe('open')
  const lectureId = lecture!.id

  const sessionAdmissionPayloads: Record<string, unknown>[] = []
  await page.route('**/functions/v1/admin-ai-unlock', async (route) => {
    if (route.request().method() !== 'POST') {
      await route.continue()
      return
    }
    const payload = route.request().postDataJSON() as Record<string, unknown>
    if (payload.action === 'authorizeMasterWithAal2Session') {
      sessionAdmissionPayloads.push(payload)
    }
    await route.continue()
  })

  const paidRequests: string[] = []
  page.on('request', (request) => {
    if (request.method() !== 'POST') return
    const requestUrl = new URL(request.url())
    if (requestUrl.pathname.endsWith('/generate-academic-answer')) {
      const payload = request.postDataJSON() as Record<string, unknown>
      // Status reconciliation is read-only and may continue while the panel is mounted.
      if (payload.action === 'status') return
    }
    if (
      /\/(analyze-lecture-material|generate-academic-answer|generate-lecture-summary|issue-realtime-client-secret)$/.test(
        requestUrl.pathname,
      )
    ) {
      paidRequests.push(request.url())
    }
  })

  const master = page.getByTestId('ai-master-auth')
  await expect(master).toContainText('許可だけではAPIは呼び出されません')
  await expect(master.getByLabel('個人AI PIN')).toHaveCount(0)
  await expect(master).not.toContainText('認証アプリ')
  await expectNoSeriousAccessibilityViolations(page)
  const authorizeButton = master.getByRole('button', {
    name: 'AI機能を有効にする',
  })
  await expect(authorizeButton).toBeEnabled()
  await authorizeButton.focus()
  await expect(authorizeButton).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(master).toContainText('許可済み')
  expect(sessionAdmissionPayloads).toHaveLength(1)
  expect(sessionAdmissionPayloads[0]).toMatchObject({
    action: 'authorizeMasterWithAal2Session',
    lectureSessionId: lectureId,
    requestedScope: 'all_including_captions',
  })
  expect(sessionAdmissionPayloads[0]).not.toHaveProperty('pin')
  expect(sessionAdmissionPayloads[0]).not.toHaveProperty('credentialToken')
  expect(sessionAdmissionPayloads[0]).not.toHaveProperty('publicKeyJwk')

  await expect
    .poll(async () => {
      const { count } = await service
        .from('lecture_ai_master_authorizations')
        .select('id', { count: 'exact', head: true })
        .eq('lecture_session_id', lectureId)
        .eq('status', 'active')
      return count
    })
    .toBe(1)
  const { data: masterRows, error: masterRowsError } = await service
    .from('lecture_ai_master_authorizations')
    .select(
      'unlock_method,unlock_factor_id,unlock_factor_version,browser_credential_id',
    )
    .eq('lecture_session_id', lectureId)
    .eq('status', 'active')
  expect(masterRowsError).toBeNull()
  expect(masterRows).toEqual([
    {
      browser_credential_id: null,
      unlock_factor_id: null,
      unlock_factor_version: null,
      unlock_method: 'google_aal2_session',
    },
  ])
  const { count: grantCountAfterAuthorization } = await service
    .from('ai_billing_grants')
    .select('id', { count: 'exact', head: true })
    .eq('lecture_session_id', lectureId)
  const { count: usageCountAfterAuthorization } = await service
    .from('ai_usage_ledger')
    .select('id', { count: 'exact', head: true })
    .eq('lecture_session_id', lectureId)
  expect(grantCountAfterAuthorization).toBe(0)
  expect(usageCountAfterAuthorization).toBe(0)
  expect(paidRequests).toEqual([])

  const academic = page.locator('.academic-answer-control')
  const academicQuestion =
    'What evidence supports combining retrieval practice with feedback?'
  const academicEndpoint = `${supabaseUrl}/functions/v1/generate-academic-answer`
  let academicGenerateRequests = 0
  let academicStatusRequests = 0
  let academicPreflightRequestId = ''
  await page.route(
    '**/functions/v1/generate-academic-answer',
    async (route) => {
      const body = route.request().postDataJSON() as Record<string, unknown>
      if (body.action === 'generate') {
        academicGenerateRequests += 1
        academicPreflightRequestId = String(body.preflightRequestId ?? '')
        await route.fulfill({
          contentType: 'application/json',
          json: {
            code: 'operation_in_progress',
            message: 'This Academic answer is already running.',
            ok: false,
          },
          status: 409,
        })
        return
      }
      if (body.action !== 'status' || !academicPreflightRequestId) {
        await route.continue()
        return
      }

      academicStatusRequests += 1
      const exactBinding = academicStatusRequests > 1
      const answerText = exactBinding
        ? 'Exact preflight result'
        : 'Same-question result from another preflight'
      await route.fulfill({
        contentType: 'application/json',
        json: {
          ok: true,
          results: {
            active_requests: exactBinding
              ? []
              : [
                  {
                    id: '30000000-0000-4000-8000-000000000001',
                    operation_id: null,
                    preflight_request_id: academicPreflightRequestId,
                    question: academicQuestion,
                    status: 'evidence_checking',
                    updated_at: '2026-08-21T00:00:00.000Z',
                  },
                ],
            answers: [
              {
                created_at: '2026-08-21T00:00:01.000Z',
                id: exactBinding
                  ? '30000000-0000-4000-8000-000000000003'
                  : '30000000-0000-4000-8000-000000000002',
                preflight_request_id: exactBinding
                  ? academicPreflightRequestId
                  : '30000000-0000-4000-8000-000000000099',
                publication: null,
                question: academicQuestion,
                revisions: [
                  {
                    body: {
                      answer_points: [{ source_ids: [], text: answerText }],
                      limitations: [],
                    },
                    id: exactBinding
                      ? '30000000-0000-4000-8000-000000000005'
                      : '30000000-0000-4000-8000-000000000004',
                  },
                ],
                sources: [],
                status: 'awaiting_review',
              },
            ],
            automation: null,
            candidates: [],
            control: {
              academic_answer_calls_used: 1,
              academic_answer_limit: 3,
              budget_limit_microusd: 120000,
              status: 'active',
              used_microusd: 1000,
            },
          },
        },
      })
    },
  )
  await academic.getByLabel('学生へ補足したい質問').fill(academicQuestion)
  await academic
    .getByLabel('文献検索語')
    .fill('retrieval practice feedback learning evidence')
  const generateAcademicAnswer = academic.getByRole('button', {
    name: '一次文献を確認して下書きを作る',
  })
  await expect(generateAcademicAnswer).toBeEnabled()
  await generateAcademicAnswer.click()
  await expect(academic.getByText('Exact preflight result')).toBeVisible({
    timeout: 15_000,
  })
  expect(academicGenerateRequests).toBe(1)
  expect(academicStatusRequests).toBeGreaterThanOrEqual(2)
  expect(academicPreflightRequestId).toMatch(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
  )
  await safety.expectConsoleErrorOnce({
    message:
      'Failed to load resource: the server responded with a status of 409 (Conflict)',
    url: academicEndpoint,
  })
  paidRequests.length = 0

  const summary = page.locator('.lecture-summary-control')
  await expect(summary).toContainText('AI利用を許可済み／5分要約は未開始')
  await expect(summary.getByLabel(/PIN/)).toHaveCount(0)
  await summary.getByRole('button', { name: '要約を開始' }).click()
  await expect(summary).toContainText('実行中')

  const { count: runningRuns } = await service
    .from('lecture_summary_runs')
    .select('id', { count: 'exact', head: true })
    .eq('lecture_session_id', lectureId)
    .eq('status', 'running')
  expect(runningRuns).toBe(1)
  const { count: grantCountAfterSummaryStart } = await service
    .from('ai_billing_grants')
    .select('id', { count: 'exact', head: true })
    .eq('lecture_session_id', lectureId)
  const { count: usageCountAfterSummaryStart } = await service
    .from('ai_usage_ledger')
    .select('id', { count: 'exact', head: true })
    .eq('lecture_session_id', lectureId)
  expect(grantCountAfterSummaryStart).toBe(0)
  expect(usageCountAfterSummaryStart).toBe(0)
  expect(paidRequests).toEqual([])

  let postStopSummaryRequests = 0
  const countPostStopSummaryRequests = (request: { url: () => string }) => {
    if (request.url().endsWith('/functions/v1/manage-lecture-summaries')) {
      postStopSummaryRequests += 1
    }
  }
  page.on('request', countPostStopSummaryRequests)
  await master.getByRole('button', { name: 'すべて停止' }).click()
  await expect(master).toContainText('未許可')
  await expect(summary).not.toContainText('実行中')
  await expect(summary).toContainText('要約を停止しました。')
  await expect
    .poll(async () => {
      const { count } = await service
        .from('lecture_summary_runs')
        .select('id', { count: 'exact', head: true })
        .eq('lecture_session_id', lectureId)
        .eq('status', 'running')
      return count
    })
    .toBe(0)
  const { count: runningUsageAfterStop } = await service
    .from('ai_usage_ledger')
    .select('id', { count: 'exact', head: true })
    .eq('lecture_session_id', lectureId)
    .eq('status', 'running')
  expect(runningUsageAfterStop).toBe(0)
  postStopSummaryRequests = 0
  await page.waitForTimeout(5_500)
  expect(postStopSummaryRequests).toBe(0)
  page.off('request', countPostStopSummaryRequests)
  expect(paidRequests).toEqual([])
  expect(academicGenerateRequests).toBe(1)

  await safety.assertClean()
})

test('503 master status keeps AI readiness blocked and cannot reach authorization', async ({
  page,
}) => {
  test.setTimeout(120_000)
  expect(supabaseUrl).toMatch(/^http:\/\/(127\.0\.0\.1|localhost):/)

  const safety = await installBrowserSafetyMonitor(page)
  let masterStatusRequests = 0
  let sessionAdmissionRequests = 0
  await page.route('**/functions/v1/admin-ai-unlock', async (route) => {
    if (route.request().method() !== 'POST') {
      await route.continue()
      return
    }
    const payload = route.request().postDataJSON() as Record<string, unknown>
    if (payload.action === 'masterStatus') {
      masterStatusRequests += 1
      await route.fulfill({
        contentType: 'application/json',
        json: {
          code: 'feature_disabled',
          message: 'This Admin control is not enabled.',
        },
        status: 503,
      })
      return
    }
    if (payload.action === 'authorizeMasterWithAal2Session') {
      sessionAdmissionRequests += 1
    }
    await route.continue()
  })

  await installGoogleAdminSession(page)
  await page.goto('/admin')
  await expect(
    page.getByRole('heading', { name: '講義を準備する' }),
  ).toBeVisible()

  const title = `AI状態503 E2E ${Date.now()}`
  await page.getByLabel('講義タイトル').fill(title)
  await page.getByRole('button', { name: '新しい講義を作成' }).click()
  const lectureRow = page
    .locator('.lecture-admin-row')
    .filter({ hasText: title })
  await lectureRow.getByRole('button', { name: '開始', exact: true }).click()
  await expect(lectureRow).toContainText('受付中')
  await page.locator('#teacher-workspace-ai-tab').click()

  const aiPanel = page.locator('.ai-readiness-panel')
  const readinessBadge = aiPanel.locator(
    ':scope > .panel-heading > .support-state',
  )
  await expect.poll(() => masterStatusRequests).toBeGreaterThan(0)
  await expect(readinessBadge).toHaveText('停止中')
  await expect(readinessBadge).not.toHaveClass(/is-ready/)
  const authorizeButton = page
    .getByTestId('ai-master-auth')
    .getByRole('button', { name: 'AI機能を有効にする' })
  await expect(authorizeButton).toBeDisabled()
  await authorizeButton.evaluate((button: HTMLButtonElement) => button.click())
  expect(sessionAdmissionRequests).toBe(0)

  await safety.expectConsoleErrors(
    {
      message:
        'Failed to load resource: the server responded with a status of 503 (Service Unavailable)',
      url: `${supabaseUrl}/functions/v1/admin-ai-unlock`,
    },
    masterStatusRequests,
  )

  await safety.assertClean()
})

test('lost AI admission response does not poison revoke and one-click re-enable', async ({
  page,
}) => {
  test.setTimeout(180_000)
  expect(supabaseUrl).toMatch(/^http:\/\/(127\.0\.0\.1|localhost):/)
  expect(serviceRoleKey).not.toBe('')
  const service = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
  })

  await installGoogleAdminSession(page)
  await page.goto('/admin')
  await expect(
    page.getByRole('heading', { name: '講義を準備する' }),
  ).toBeVisible()

  const title = `AI応答喪失E2E ${Date.now()}`
  await page.getByLabel('講義タイトル').fill(title)
  await page.getByRole('button', { name: '新しい講義を作成' }).click()
  const lectureRow = page
    .locator('.lecture-admin-row')
    .filter({ hasText: title })
  await lectureRow.getByRole('button', { name: '開始', exact: true }).click()
  await expect(lectureRow).toContainText('受付中')
  await page.locator('#teacher-workspace-ai-tab').click()

  const { data: lecture, error: lectureError } = await service
    .from('lecture_sessions')
    .select('id')
    .eq('title', title)
    .single()
  expect(lectureError).toBeNull()
  expect(lecture?.id).toBeTruthy()

  let dropFirstAdmissionResponse = true
  const admissionRequestIds: string[] = []
  await page.route('**/functions/v1/admin-ai-unlock', async (route) => {
    if (route.request().method() !== 'POST') {
      await route.continue()
      return
    }
    const payload = route.request().postDataJSON() as Record<string, unknown>
    if (payload.action !== 'authorizeMasterWithAal2Session') {
      await route.continue()
      return
    }
    expect(payload.requestId).toEqual(expect.any(String))
    admissionRequestIds.push(payload.requestId as string)
    if (!dropFirstAdmissionResponse) {
      await route.continue()
      return
    }
    dropFirstAdmissionResponse = false
    const committedResponse = await route.fetch()
    expect(committedResponse.status()).toBe(200)
    await route.abort('connectionfailed')
  })

  const master = page.getByTestId('ai-master-auth')
  const enableButton = master.getByRole('button', {
    name: 'AI機能を有効にする',
  })
  await expect(enableButton).toBeEnabled()
  await enableButton.click()
  await expect(master).toContainText('同じ許可ボタンでもう一度確認できます')
  await expect
    .poll(async () => {
      const { count } = await service
        .from('lecture_ai_master_authorizations')
        .select('id', { count: 'exact', head: true })
        .eq('lecture_session_id', lecture!.id)
        .eq('status', 'active')
      return count
    })
    .toBe(1)

  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await expect(master).toContainText('許可済み')
  expect(admissionRequestIds).toHaveLength(1)

  await master.getByRole('button', { name: 'すべて停止' }).click()
  await expect(master).toContainText('未許可')
  await master.getByRole('button', { name: 'AI機能を有効にする' }).click()
  await expect(master).toContainText('許可済み')
  expect(admissionRequestIds).toHaveLength(2)
  expect(admissionRequestIds[1]).not.toBe(admissionRequestIds[0])
  await expect
    .poll(async () => {
      const { count } = await service
        .from('lecture_ai_master_authorizations')
        .select('id', { count: 'exact', head: true })
        .eq('lecture_session_id', lecture!.id)
        .eq('status', 'active')
      return count
    })
    .toBe(1)
})
