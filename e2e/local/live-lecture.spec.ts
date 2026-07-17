import { expect, test, type BrowserContext, type Page } from '@playwright/test'
import { installBrowserSafetyMonitor } from '../helpers/browserSafety.js'

const adminPin = process.env.TEST_ADMIN_PIN?.trim() ?? ''

async function openMonitoredPage(context: BrowserContext) {
  const page = await context.newPage()
  const safety = await installBrowserSafetyMonitor(page)
  return { page, safety }
}

async function closeContext(context: BrowserContext, page: Page) {
  if (!page.isClosed()) await page.close()
  await context.close()
}

test('teacher and student complete a lecture lifecycle on local Supabase', async ({
  browser,
}) => {
  expect(
    adminPin,
    'TEST_ADMIN_PIN must match the local Edge test env.',
  ).not.toBe('')

  const adminContext = await browser.newContext()
  const studentContext = await browser.newContext()
  const admin = await openMonitoredPage(adminContext)
  const student = await openMonitoredPage(studentContext)
  const lectureTitle = `CI講義 ${Date.now()}`

  try {
    await admin.page.goto('/admin')
    await admin.page.getByLabel('管理PIN').fill(adminPin)
    await admin.page
      .getByRole('button', { name: '講義コントロールを開く' })
      .click()
    await expect(
      admin.page.getByRole('heading', { name: '講義を準備する' }),
    ).toBeVisible()

    await admin.page.getByLabel('講義タイトル').fill(lectureTitle)
    await admin.page.getByRole('button', { name: '新しい講義を作成' }).click()

    const lectureRow = admin.page
      .locator('.lecture-admin-row')
      .filter({ hasText: lectureTitle })
    await expect(lectureRow).toContainText('準備中')
    const lectureCode = (await lectureRow.locator('code').textContent())?.trim()
    expect(lectureCode).toMatch(/^\d{6}$/)

    await lectureRow.getByRole('button', { name: '開始', exact: true }).click()
    await expect(lectureRow).toContainText('受付中')

    await student.page.goto('/join')
    await student.page.getByLabel('講義コード').fill(lectureCode ?? '')
    await student.page.getByRole('button', { name: '参加する' }).click()
    await expect(
      student.page.getByRole('heading', { name: lectureTitle }),
    ).toBeVisible()
    await expect(
      student.page.getByText('いま講義とつながっています'),
    ).toBeVisible({ timeout: 20_000 })

    const composer = student.page.locator('#lecture-question')
    await composer.getByLabel('ニックネームを表示する').check()
    await composer.getByLabel('ニックネーム（任意・10文字まで）').fill('CI学生')
    await composer
      .getByPlaceholder('感じたことや質問を、そのまま書いてみてください。')
      .fill('ローカルE2Eからの質問です')
    await composer.getByRole('button', { name: 'みんなに共有' }).click()
    const comment = student.page
      .locator('.comment-card')
      .filter({ hasText: 'ローカルE2Eからの質問です' })
    await expect(comment).toContainText('CI学生')

    admin.page.once('dialog', (dialog) => dialog.accept())
    await lectureRow.getByRole('button', { name: '終了', exact: true }).click()
    await expect(lectureRow).toContainText('締切')

    await expect(
      student.page.getByRole('heading', { name: '講義は終了しました。' }),
    ).toBeVisible({ timeout: 25_000 })
    await expect(
      student.page.getByText(
        'コメント投稿と投票は終了しました。記録は講義コードから30日間確認できます。',
      ),
    ).toBeVisible()
    await expect(
      composer.getByRole('button', { name: 'みんなに共有' }),
    ).toBeDisabled()

    await admin.safety.assertClean()
    await student.safety.assertClean()
  } finally {
    await closeContext(studentContext, student.page)
    await closeContext(adminContext, admin.page)
  }
})
