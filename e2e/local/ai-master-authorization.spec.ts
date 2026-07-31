import { AxeBuilder } from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'
import { installBrowserSafetyMonitor } from '../helpers/browserSafety.js'

const adminPin = process.env.TEST_ADMIN_PIN?.trim() ?? ''
const billingPin = process.env.TEST_BILLING_PIN?.trim() ?? ''
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

test('browser authorizes master AI without paid work, then explicitly starts and atomically stops summary work', async ({
  page,
}) => {
  test.setTimeout(120_000)
  expect(adminPin).not.toBe('')
  expect(billingPin).not.toBe('')
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

  await page.goto('/admin')
  await page.getByLabel('管理PIN').fill(adminPin)
  await page.getByRole('button', { name: '講義コントロールを開く' }).click()

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

  const master = page.getByTestId('ai-master-auth')
  await expect(master).toContainText('許可だけではAPIは呼び出されません')
  await expectNoSeriousAccessibilityViolations(page)
  await master.getByLabel('API PIN').fill(billingPin)
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

  const summary = page.locator('.lecture-summary-control')
  await expect(summary).toContainText('AI利用を許可済み／5分要約は未開始')
  await expect(summary.getByLabel(/API利用PIN/)).toHaveCount(0)
  await summary.getByRole('button', { name: '要約を開始' }).click()
  await expect(summary).toContainText('実行中')

  await expect
    .poll(async () => {
      const { count } = await service
        .from('ai_billing_grants')
        .select('id', { count: 'exact', head: true })
        .eq('lecture_session_id', lectureId)
        .not('master_authorization_id', 'is', null)
        .eq('status', 'consumed')
      return count
    })
    .toBe(1)
  const { count: runningRuns } = await service
    .from('lecture_summary_runs')
    .select('id', { count: 'exact', head: true })
    .eq('lecture_session_id', lectureId)
    .eq('status', 'running')
  expect(runningRuns).toBe(1)

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

  await safety.assertClean()
})
