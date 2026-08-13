import { AxeBuilder } from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'
import { installBrowserSafetyMonitor } from '../helpers/browserSafety.js'
import { installGoogleAdminSession } from '../helpers/googleAdminSession.js'

const aiPin = process.env.TEST_GOOGLE_ADMIN_AI_PIN?.trim() ?? ''
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
  expect(aiPin).toMatch(/^\d{4}$/)
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
  await lectureRow.getByRole('button', { name: '開始', exact: true }).click()
  await expect(lectureRow).toContainText('受付中')

  const { data: lecture, error: lectureError } = await service
    .from('lecture_sessions')
    .select('id')
    .eq('title', title)
    .single()
  expect(lectureError).toBeNull()
  expect(lecture?.id).toBeTruthy()
  const lectureId = lecture!.id

  const paidRequests: string[] = []
  page.on('request', (request) => {
    if (
      /\/(analyze-lecture-material|generate-academic-answer|generate-lecture-summary|issue-realtime-client-secret)$/.test(
        new URL(request.url()).pathname,
      )
    ) {
      paidRequests.push(request.url())
    }
  })

  const master = page.getByTestId('ai-master-auth')
  await expect(master).toContainText('許可だけではAPIは呼び出されません')
  await expectNoSeriousAccessibilityViolations(page)
  await master.getByLabel('個人AI PIN').fill(aiPin)
  const authorizeButton = master.getByRole('button', {
    name: '字幕も含めて許可',
  })
  await authorizeButton.focus()
  await expect(authorizeButton).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(master).toContainText('許可済み')

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

  await safety.assertClean()
})
