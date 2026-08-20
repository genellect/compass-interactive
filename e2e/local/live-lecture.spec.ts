import { expect, test, type BrowserContext, type Page } from '@playwright/test'
import jsQR from 'jsqr'
import { installBrowserSafetyMonitor } from '../helpers/browserSafety.js'
import { installGoogleAdminSession } from '../helpers/googleAdminSession.js'

const appBaseUrl = process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:4173'
const STUDENT_PROPAGATION_TARGET_P95_MS = 5_000
const STUDENT_PROPAGATION_RELIABILITY_CEILING_MS = 10_000
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

async function installClipboardCapture(page: Page) {
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: async (value: string) => {
          window.sessionStorage.setItem('lifecycle-display-url', value)
        },
      },
    })
  })
}

async function copiedDisplayUrl(page: Page) {
  return page.evaluate(
    () => window.sessionStorage.getItem('lifecycle-display-url') ?? '',
  )
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
  test.setTimeout(150_000)

  const adminContext = await browser.newContext()
  const studentContext = await browser.newContext()
  const peerStudentContext = await browser.newContext()
  const admin = await openMonitoredPage(adminContext)
  const student = await openMonitoredPage(studentContext)
  const peerStudent = await openMonitoredPage(peerStudentContext)
  let displayPage: Page | null = null
  let isolatedDisplayContext: BrowserContext | null = null
  let isolatedDisplayPage: Page | null = null
  const lectureTitle = `CI講義 ${Date.now()}`

  try {
    await installGoogleAdminSession(admin.page)
    await admin.page.goto('/admin')
    await expect(
      admin.page.getByRole('heading', { name: '講義を準備する' }),
    ).toBeVisible()
    await expect(
      admin.page.getByRole('link', { name: '教員管理' }),
    ).toHaveAttribute('target', '_blank')

    const settingsPopupPromise = admin.page.waitForEvent('popup')
    await admin.page.getByRole('link', { name: '教員管理' }).click()
    const settingsPage = await settingsPopupPromise
    const settingsSafety = await installBrowserSafetyMonitor(settingsPage)
    await expect(
      settingsPage.getByRole('heading', {
        name: '教員管理',
        exact: true,
      }),
    ).toBeVisible()
    await expect(
      settingsPage.getByRole('heading', { name: '教員一覧' }),
    ).toBeVisible()
    await expect(
      settingsPage
        .locator('.admin-ledger-session')
        .filter({ hasText: '現在のセッション' }),
    ).toBeVisible()
    await expect(settingsPage.locator('.admin-identity-card')).toHaveCount(0)
    const pageCountBeforeWorkspaceReturn = adminContext.pages().length
    await settingsPage
      .getByRole('link', { name: '講義コントロール', exact: true })
      .click()
    await expect(admin.page.locator('.admin-workflow')).toBeVisible()
    expect(adminContext.pages()).toHaveLength(pageCountBeforeWorkspaceReturn)
    await settingsSafety.assertClean()
    await settingsPage.close()

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

    await admin.page.locator('#teacher-workspace-setup-tab').click()

    const adminQr = admin.page
      .locator('.lecture-join-qr')
      .filter({ hasText: lectureTitle })
    await expect(adminQr.locator('img')).toBeVisible()
    const canonicalJoinUrl = new URL(
      `/join?code=${lectureCode}`,
      appBaseUrl,
    ).toString()
    await expect(adminQr).toHaveAttribute(
      'data-lecture-join-url',
      canonicalJoinUrl,
    )
    expect(await decodeQrImage(admin.page, '.lecture-join-qr img')).toBe(
      canonicalJoinUrl,
    )

    await admin.page.locator('#teacher-workspace-ai-tab').click()

    const summaryLanguage = admin.page.getByLabel('要約言語')
    await expect(summaryLanguage).toHaveValue('auto')
    await summaryLanguage.selectOption('en')
    await expect(
      admin.page.getByText(
        '要約言語を更新しました。処理中の要約には影響せず、次の5分枠から反映されます。',
      ),
    ).toBeVisible()
    await expect(summaryLanguage).toHaveValue('en')

    const summaryControl = admin.page.locator('.lecture-summary-control')
    const autoAcademicAnswers =
      summaryControl.getByLabel('学術的な質問に参考回答を自動生成')
    const summarySourceDomain = summaryControl.getByLabel('参照する分野')
    await expect(autoAcademicAnswers).not.toBeChecked()
    await expect(summarySourceDomain).toHaveCount(0)
    await autoAcademicAnswers.check()
    await expect(summarySourceDomain).toHaveValue('auto')
    await autoAcademicAnswers.uncheck()

    const displayPopup = admin.page.waitForEvent('popup')
    const displaySessionResponse = admin.page.waitForResponse(
      (response) =>
        response.url().endsWith('/functions/v1/issue-display-session') &&
        response.status() === 200,
    )
    await admin.page.getByRole('button', { name: '共有画面を開く' }).click()
    displayPage = await displayPopup
    const initialDisplayPage = displayPage
    const issuedDisplaySession = (
      await displaySessionResponse
    ).json() as Promise<{
      displayToken: string
      lectureSessionId: string
    }>
    const displaySafety = await installBrowserSafetyMonitor(initialDisplayPage)
    await expect(
      initialDisplayPage.getByRole('heading', { name: lectureTitle }),
    ).toBeVisible()
    const displayQr = initialDisplayPage.locator('.lecture-join-qr')
    await expect(displayQr.locator('img')).toBeVisible()
    await expect(displayQr).toHaveAttribute(
      'data-lecture-join-url',
      canonicalJoinUrl,
    )
    expect(
      await decodeQrImage(initialDisplayPage, '.lecture-join-qr img'),
    ).toBe(canonicalJoinUrl)
    await expect
      .poll(
        () =>
          initialDisplayPage
            .locator('html')
            .getAttribute('data-display-realtime'),
        { timeout: 15_000 },
      )
      .toBe('connected')

    const popupSession = await issuedDisplaySession
    await installClipboardCapture(admin.page)
    const isolatedDisplaySessionResponse = admin.page.waitForResponse(
      (response) =>
        response.url().endsWith('/functions/v1/issue-display-session') &&
        response.status() === 200,
    )
    await admin.page
      .getByRole('button', { name: '別ブラウザ用リンクをコピー' })
      .click()
    const isolatedSession = (
      await isolatedDisplaySessionResponse
    ).json() as Promise<{
      displayToken: string
      lectureSessionId: string
    }>
    await expect(
      admin.page.getByRole('button', { name: 'リンクをコピーしました' }),
    ).toBeVisible()
    const isolatedDisplayUrl = await copiedDisplayUrl(admin.page)
    const issuedIsolatedSession = await isolatedSession
    expect(issuedIsolatedSession.lectureSessionId).toBe(
      popupSession.lectureSessionId,
    )
    expect(issuedIsolatedSession.displayToken).not.toBe(
      popupSession.displayToken,
    )
    expect(isolatedDisplayUrl).toContain('/display#')
    expect(isolatedDisplayUrl).toContain(
      encodeURIComponent(issuedIsolatedSession.displayToken),
    )
    isolatedDisplayContext = await browser.newContext()
    isolatedDisplayPage = await isolatedDisplayContext.newPage()
    const isolatedDisplaySafety =
      await installBrowserSafetyMonitor(isolatedDisplayPage)
    await isolatedDisplayPage.goto(isolatedDisplayUrl)
    await expect(
      isolatedDisplayPage.getByRole('heading', { name: lectureTitle }),
    ).toBeVisible()
    await expect(isolatedDisplayPage).toHaveURL(/\/display$/)
    await expect
      .poll(
        () =>
          isolatedDisplayPage
            ?.locator('html')
            .getAttribute('data-display-realtime'),
        { timeout: 15_000 },
      )
      .toBe('connected')
    await isolatedDisplaySafety.assertClean()
    await expect(
      initialDisplayPage.getByRole('heading', {
        name: '共有画面の確認が必要です',
      }),
    ).toBeVisible({ timeout: 8_000 })

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

    await peerStudent.page.goto('/join')
    await peerStudent.page.getByLabel('講義コード').fill(lectureCode ?? '')
    await peerStudent.page.getByRole('button', { name: '参加する' }).click()
    await expect(
      peerStudent.page.getByRole('heading', { name: lectureTitle }),
    ).toBeVisible()
    await expect(
      peerStudent.page.getByText('いま講義とつながっています'),
    ).toBeVisible({ timeout: 20_000 })

    const composer = student.page.locator('#lecture-question')
    await composer.getByLabel('ニックネームを表示する').check()
    await composer.getByLabel('ニックネーム（任意・10文字まで）').fill('CI学生')
    await composer
      .getByPlaceholder('感じたことや質問を、そのまま書いてみてください。')
      .fill('ローカルE2Eからの質問です')
    const commentSubmittedAt = Date.now()
    await composer.getByRole('button', { name: 'みんなに共有' }).click()
    const comment = student.page
      .locator('.comment-card')
      .filter({ hasText: 'ローカルE2Eからの質問です' })
    await expect(comment).toContainText('CI学生')
    const peerComment = peerStudent.page
      .locator('.comment-card')
      .filter({ hasText: 'ローカルE2Eからの質問です' })
    await expect(peerComment).toBeVisible({
      timeout: STUDENT_PROPAGATION_RELIABILITY_CEILING_MS,
    })
    const commentPropagationMs = Date.now() - commentSubmittedAt
    test.info().annotations.push({
      description: String(commentPropagationMs),
      type: 'student-comment-propagation-ms',
    })
    test.info().annotations.push({
      description: String(STUDENT_PROPAGATION_TARGET_P95_MS),
      type: 'student-propagation-target-p95-ms',
    })
    expect(commentPropagationMs).toBeLessThanOrEqual(
      STUDENT_PROPAGATION_RELIABILITY_CEILING_MS,
    )

    const likeSubmittedAt = Date.now()
    await peerComment.getByRole('button', { name: '共感する' }).click()
    await expect(comment.locator('.like-count')).toContainText('1', {
      timeout: STUDENT_PROPAGATION_RELIABILITY_CEILING_MS,
    })
    const likePropagationMs = Date.now() - likeSubmittedAt
    test.info().annotations.push({
      description: String(likePropagationMs),
      type: 'student-like-propagation-ms',
    })
    expect(likePropagationMs).toBeLessThanOrEqual(
      STUDENT_PROPAGATION_RELIABILITY_CEILING_MS,
    )

    await admin.page.locator('#teacher-workspace-participation-tab').click()
    const adminComment = admin.page
      .locator('#admin-voices .comment-card')
      .filter({ hasText: 'ローカルE2Eからの質問です' })
    await expect(adminComment).toContainText('CI学生', { timeout: 8_000 })
    if (!isolatedDisplayPage) {
      throw new Error('The active isolated Display page was not opened.')
    }
    const displayComment = isolatedDisplayPage
      .locator('.comment-card')
      .filter({ hasText: 'ローカルE2Eからの質問です' })
    await expect(displayComment).toBeVisible({ timeout: 8_000 })

    await adminComment.getByRole('button', { name: '非表示にする' }).click()
    await expect(adminComment).toContainText('非表示')
    await expect(
      adminComment.getByRole('button', { name: '表示に戻す' }),
    ).toBeVisible()
    await expect(comment).toHaveCount(0, { timeout: 8_000 })
    await expect(peerComment).toHaveCount(0, { timeout: 8_000 })
    await expect(displayComment).toHaveCount(0, { timeout: 8_000 })

    await adminComment.getByRole('button', { name: '表示に戻す' }).click()
    await expect(adminComment.locator('.tag.muted')).toHaveCount(0)
    await expect(
      adminComment.getByRole('button', { name: '非表示にする' }),
    ).toBeVisible()
    await expect(comment).toContainText('CI学生', { timeout: 8_000 })
    await expect(peerComment).toContainText('CI学生', { timeout: 8_000 })
    await expect(displayComment).toBeVisible({ timeout: 8_000 })

    const ownHistoryRequests: string[] = []
    student.page.on('request', (request) => {
      if (request.url().includes('/rpc/get_lecture_comment_history_v3')) {
        ownHistoryRequests.push(request.url())
      }
    })
    await student.page.evaluate(() => {
      window.history.pushState(window.history.state, '', '/lecture/comments')
      window.dispatchEvent(new PopStateEvent('popstate'))
    })
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
    await student.page.getByRole('link', { name: '講義へ戻る' }).click()
    await expect(
      student.page.getByRole('heading', { name: lectureTitle }),
    ).toBeVisible()

    admin.page.once('dialog', (dialog) => dialog.accept())
    await admin.page
      .getByRole('button', { name: '講義を終了', exact: true })
      .click()
    await expect(
      admin.page.getByRole('heading', { name: '講義を準備する' }),
    ).toBeVisible()
    await expect(
      admin.page.getByText(
        '終了した講義です。履歴を確認するか、次の講義を準備できます。',
      ),
    ).toHaveCount(0)
    await expect(admin.page.getByLabel('講義タイトル')).toBeEnabled()
    await admin.page.getByRole('button', { name: '講義履歴を表示する' }).click()
    await expect(lectureRow).toContainText('締切')
    await expect(
      lectureRow.getByRole('button', { name: '選択', exact: true }),
    ).toHaveCount(0)
    await expect(
      lectureRow.getByRole('button', { name: '同じタイトルで準備' }),
    ).toBeVisible()
    await expect(admin.page.locator('.lecture-join-qr')).toHaveCount(0)
    if (displayPage) {
      await expect(displayPage.locator('.lecture-join-qr')).toHaveCount(0, {
        timeout: 25_000,
      })
      await displaySafety.assertClean()
    }
    if (isolatedDisplayPage) {
      await expect(isolatedDisplayPage.locator('.lecture-join-qr')).toHaveCount(
        0,
        { timeout: 25_000 },
      )
    }

    await expect(
      student.page.getByRole('heading', { name: '講義は終了しました。' }),
    ).toBeVisible({ timeout: 25_000 })
    await expect(
      peerStudent.page.getByRole('heading', { name: '講義は終了しました。' }),
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
    await expect(
      admin.page.getByRole('heading', { name: '教員ポータル' }),
    ).toBeVisible()

    await admin.safety.assertClean()
    await student.safety.assertClean()
    await peerStudent.safety.assertClean()
  } finally {
    if (isolatedDisplayPage && !isolatedDisplayPage.isClosed()) {
      await isolatedDisplayPage.close()
    }
    if (isolatedDisplayContext) await isolatedDisplayContext.close()
    if (displayPage && !displayPage.isClosed()) await displayPage.close()
    await closeContext(peerStudentContext, peerStudent.page)
    await closeContext(studentContext, student.page)
    await closeContext(adminContext, admin.page)
  }
})
