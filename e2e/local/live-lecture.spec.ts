import { expect, test, type BrowserContext, type Page } from '@playwright/test'
import jsQR from 'jsqr'
import { installBrowserSafetyMonitor } from '../helpers/browserSafety.js'

const adminPin = process.env.TEST_ADMIN_PIN?.trim() ?? ''
const decodeQrPixels = jsQR as unknown as (
  data: Uint8ClampedArray,
  width: number,
  height: number,
) => { data: string } | null

async function openMonitoredPage(context: BrowserContext) {
  const page = await context.newPage()
  const safety = await installBrowserSafetyMonitor(page)
  return { page, safety }
}

async function closeContext(context: BrowserContext, page: Page) {
  if (!page.isClosed()) await page.close()
  await context.close()
}

async function decodeQrImage(page: Page, selector: string) {
  const raster = await page.locator(selector).evaluate((element) => {
    if (!(element instanceof HTMLImageElement)) {
      throw new Error('QR target is not an image.')
    }
    const width = element.naturalWidth
    const height = element.naturalHeight
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext('2d', { willReadFrequently: true })
    if (!context) throw new Error('QR canvas is unavailable.')
    context.drawImage(element, 0, 0, width, height)
    return {
      data: Array.from(context.getImageData(0, 0, width, height).data),
      height,
      width,
    }
  })
  return decodeQrPixels(
    Uint8ClampedArray.from(raster.data),
    raster.width,
    raster.height,
  )?.data
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
  let displayPage: Page | null = null
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
    await admin.page.getByRole('button', { name: 'セッション管理' }).click()
    await expect(
      admin.page.getByRole('heading', { name: '管理セッション' }),
    ).toBeVisible()
    await expect(admin.page.getByText('現在のセッション')).toBeVisible()

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

    const adminQr = admin.page
      .locator('.lecture-join-qr')
      .filter({ hasText: lectureTitle })
    await expect(adminQr.locator('img')).toBeVisible()
    const canonicalJoinUrl = `http://127.0.0.1:4173/join?code=${lectureCode}`
    await expect(adminQr).toHaveAttribute(
      'data-lecture-join-url',
      canonicalJoinUrl,
    )
    expect(await decodeQrImage(admin.page, '.lecture-join-qr img')).toBe(
      canonicalJoinUrl,
    )

    const summaryLanguage = admin.page.getByLabel('要約言語')
    await expect(summaryLanguage).toHaveValue('auto')
    await summaryLanguage.selectOption('en')
    await expect(
      admin.page.getByText(
        '要約言語を更新しました。処理中の要約には影響せず、次の5分枠から反映されます。',
      ),
    ).toBeVisible()
    await expect(summaryLanguage).toHaveValue('en')

    const displayPopup = admin.page.waitForEvent('popup')
    await admin.page.getByRole('button', { name: '共有画面を開く' }).click()
    displayPage = await displayPopup
    const displaySafety = await installBrowserSafetyMonitor(displayPage)
    await expect(
      displayPage.getByRole('heading', { name: lectureTitle }),
    ).toBeVisible()
    const displayQr = displayPage.locator('.lecture-join-qr')
    await expect(displayQr.locator('img')).toBeVisible()
    await expect(displayQr).toHaveAttribute(
      'data-lecture-join-url',
      canonicalJoinUrl,
    )
    expect(await decodeQrImage(displayPage, '.lecture-join-qr img')).toBe(
      canonicalJoinUrl,
    )

    await student.page.goto('/join')
    await student.page.getByLabel('講義コード').fill(lectureCode ?? '')
    const studentFunctionRequests: string[] = []
    let resumeIssueStatus: number | null = null
    student.page.on('request', (request) => {
      if (request.url().includes('/functions/v1/')) {
        studentFunctionRequests.push(request.url())
      }
    })
    student.page.on('response', (response) => {
      if (response.url().includes('/functions/v1/issue-lecture-resume-token')) {
        resumeIssueStatus = response.status()
      }
    })
    await student.page.getByRole('button', { name: '参加する' }).click()
    await expect(
      student.page.getByRole('heading', { name: lectureTitle }),
    ).toBeVisible()
    await expect(
      student.page.getByText('いま講義とつながっています'),
    ).toBeVisible({ timeout: 20_000 })
    expect(studentFunctionRequests).toContainEqual(
      expect.stringContaining('/functions/v1/issue-lecture-resume-token'),
    )
    await expect.poll(() => resumeIssueStatus).not.toBeNull()
    expect(resumeIssueStatus).toBe(200)
    const resumeEntries = await student.page.evaluate(() =>
      JSON.parse(
        window.localStorage.getItem(
          'compass-interactive-lecture-resume-tokens-v1',
        ) ?? '[]',
      ),
    )
    expect(resumeEntries).toHaveLength(1)
    expect(resumeEntries[0]).toMatchObject({
      lectureCode,
      token: expect.stringMatching(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/),
    })
    expect(student.page.url()).not.toContain(resumeEntries[0].token)

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

    const ownHistoryRequests: string[] = []
    student.page.on('request', (request) => {
      if (request.url().includes('/rpc/get_lecture_comment_history_v3')) {
        ownHistoryRequests.push(request.url())
      }
    })
    await student.page.goto('/lecture/comments')
    await student.page.getByRole('tab', { name: '自分' }).click()
    await expect(
      student.page.getByRole('heading', { name: '自分のコメント' }),
    ).toBeVisible()
    await expect(
      student.page.getByText('ローカルE2Eからの質問です'),
    ).toBeVisible()
    await expect.poll(() => ownHistoryRequests.length).toBe(1)
    await student.page.waitForTimeout(5_500)
    expect(ownHistoryRequests).toHaveLength(1)
    await student.page.goto('/lecture')
    await expect(
      student.page.getByRole('heading', { name: lectureTitle }),
    ).toBeVisible()

    admin.page.once('dialog', (dialog) => dialog.accept())
    await lectureRow.getByRole('button', { name: '終了', exact: true }).click()
    await expect(lectureRow).toContainText('締切')
    await expect(admin.page.locator('.lecture-join-qr')).toHaveCount(0)
    if (displayPage) {
      await expect(displayPage.locator('.lecture-join-qr')).toHaveCount(0, {
        timeout: 25_000,
      })
      await displaySafety.assertClean()
    }

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

    await admin.page.getByRole('button', { name: 'ログアウト' }).click()
    await expect(admin.page.getByLabel('管理PIN')).toBeVisible()

    await admin.safety.assertClean()
    await student.safety.assertClean()
  } finally {
    if (displayPage && !displayPage.isClosed()) await displayPage.close()
    await closeContext(studentContext, student.page)
    await closeContext(adminContext, admin.page)
  }
})
