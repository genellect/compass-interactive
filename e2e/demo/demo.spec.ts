import { expect, test } from '@playwright/test'
import { installBrowserSafetyMonitor } from '../helpers/browserSafety.js'

test('join page opens the isolated demo and exposes the learning flow', async ({
  page,
}, testInfo) => {
  const safety = await installBrowserSafetyMonitor(page)

  await page.goto('/join')
  await expect(
    page.getByRole('heading', { name: '講義に参加する' }),
  ).toBeVisible()
  await expect(page.getByLabel('講義コード')).toHaveAttribute(
    'inputmode',
    'numeric',
  )
  await page.getByRole('button', { name: 'デモ講義を体験' }).click()

  await expect(page).toHaveURL(/\/lecture$/)
  await expect(
    page.getByRole('heading', { name: 'AI時代の英語と学び' }),
  ).toBeVisible()
  await expect(page.getByText('本番に近い講義体験です')).toBeVisible()
  await expect(
    page.getByRole('heading', { name: 'いま見ている資料' }),
  ).toBeVisible()
  await expect(page.getByRole('heading', { name: '講義字幕' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'みんなの声' })).toBeVisible()
  await expect(
    page.getByRole('heading', { name: '気づき・質問を共有する' }),
  ).toBeVisible()
  await expect(
    page.getByRole('heading', {
      name: '翻訳AIが使える今、英語を学ぶ価値として最も大きいものは？',
    }),
  ).toBeVisible()
  await expect(page.getByText(/\d+人参加（デモ）/).first()).toBeVisible()
  await expect(
    page.getByRole('heading', { name: 'AIによる参考回答' }),
  ).toBeVisible()
  await expect(page.getByText('教員未確認')).toBeVisible()
  await expect(
    page.getByRole('heading', {
      name: '英語能力とAIリテラシーは相関しますか？',
    }),
  ).toBeVisible()
  await expect(page.getByText('文献から考える参考回答')).toHaveCount(0)
  await expect(page.getByText('読み取るときの注意')).toHaveCount(0)
  await expect(
    page.getByText(
      '一次文献を手がかりに、講義で生まれた問いを短く整理しています。',
    ),
  ).toHaveCount(0)
  await page.getByText('参照文献（2件）').click()
  await expect(
    page.getByRole('link', {
      name: 'Impact of proficiency on Chinese EFL learners’ interaction with AI-generated feedback for translation revision',
    }),
  ).toHaveAttribute('href', 'https://doi.org/10.1080/09588221.2026.2631658')

  if (testInfo.project.name.startsWith('mobile-')) {
    const topPositions = await page.evaluate(() => {
      const selectors = [
        '#lecture-material',
        '#lecture-caption',
        '#lecture-voices',
        '#lecture-question',
        '#lecture-poll',
        '.lecture-area-recap',
        '.lecture-area-summary',
        '.lecture-area-academic',
        '.lecture-area-exit',
      ]
      return selectors.map((selector) => {
        const element = document.querySelector<HTMLElement>(selector)
        if (!element) throw new Error(`Missing mobile section: ${selector}`)
        return element.getBoundingClientRect().top + window.scrollY
      })
    })
    expect(topPositions).toEqual([...topPositions].sort((a, b) => a - b))
  }

  await safety.assertClean()
})

test('demo comments, nickname limit, poll, history and exit work locally', async ({
  page,
}) => {
  test.setTimeout(90_000)
  const safety = await installBrowserSafetyMonitor(page)
  await page.goto('/demo')
  await expect(
    page.getByRole('heading', { name: 'AI時代の英語と学び' }),
  ).toBeVisible()
  await expect(
    page
      .locator('.comment-card')
      .filter({ hasText: '英語能力とAIリテラシーは相関しますか？' }),
  ).toBeVisible({ timeout: 15_000 })

  const composer = page.locator('#lecture-question')
  const commentInput = composer.getByPlaceholder(
    '感じたことや質問を、そのまま書いてみてください。',
  )

  await commentInput.fill('E2E匿名コメント')
  const shareButton = composer.getByRole('button', { name: 'みんなに共有' })
  await shareButton.focus()
  await expect(shareButton).toBeFocused()
  await page.keyboard.press('Enter')
  const anonymousCard = page
    .locator('.comment-card')
    .filter({ hasText: 'E2E匿名コメント' })
  await expect(anonymousCard).toContainText('匿名の参加者')

  await composer.getByLabel('ニックネームを表示する').check()
  const nicknameInput = composer.getByLabel('ニックネーム（任意・10文字まで）')
  await nicknameInput.fill('12345678901')
  await expect(composer.getByRole('alert')).toHaveText(
    '10文字以内で入力してください',
  )
  await expect(nicknameInput).toHaveValue('1234567890')

  await nicknameInput.fill('英語E2E')
  await commentInput.fill('E2Eニックネームコメント')
  await shareButton.focus()
  await expect(shareButton).toBeFocused()
  await page.keyboard.press('Enter')
  const nicknameCard = page
    .locator('.comment-card')
    .filter({ hasText: 'E2Eニックネームコメント' })
  await expect(nicknameCard).toContainText('英語E2E')

  const pollChoice = page.getByRole('radio', {
    name: '世界中の仲間と一緒に挑戦できる',
  })
  await pollChoice.focus()
  await expect(pollChoice).toBeFocused()
  await page.keyboard.press('Space')
  await expect(pollChoice).toBeChecked()
  const pollSubmitButton = page.getByRole('button', {
    name: 'この回答を送る',
  })
  await pollSubmitButton.focus()
  await expect(pollSubmitButton).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(
    page.getByText('回答しました。みんなの考えを見てみましょう。'),
  ).toBeVisible()

  await commentInput.fill('E2E履歴リンク確認')
  await composer.evaluate((element) =>
    element.scrollIntoView({ block: 'center', behavior: 'auto' }),
  )
  const finalShareButton = composer.getByRole('button', {
    name: 'みんなに共有',
  })
  await expect(finalShareButton).toBeInViewport()
  await finalShareButton.focus()
  await expect(finalShareButton).toBeFocused()
  await page.keyboard.press('Enter')
  const historyLink = page.getByRole('link', { name: 'コメント履歴を見る' })
  await historyLink.scrollIntoViewIfNeeded()
  await historyLink.focus()
  await page.keyboard.press('Enter')
  await expect(
    page.getByRole('heading', { name: 'コメント履歴' }),
  ).toBeVisible()
  await expect(page.getByText('E2E履歴リンク確認')).toBeVisible()
  await page.getByRole('tab', { name: '自分' }).click()
  await expect(
    page.getByRole('heading', { name: '自分のコメント' }),
  ).toBeVisible()
  await expect(page.getByText('E2E匿名コメント')).toBeVisible()
  await expect(page.getByText('E2Eニックネームコメント')).toBeVisible()
  await expect(
    page.getByText(
      '翻訳結果が正しいか判断するには、自分にも基礎が必要だと思いました。',
    ),
  ).toHaveCount(0)

  const lectureLink = page.getByRole('link', { name: '講義へ戻る' })
  await lectureLink.focus()
  await page.keyboard.press('Enter')
  const exitButton = page.getByRole('button', { name: '講義から退出する' })
  await exitButton.evaluate((element) =>
    element.scrollIntoView({ block: 'center', behavior: 'auto' }),
  )
  await expect(exitButton).toBeInViewport()
  await exitButton.focus()
  await expect(exitButton).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(/\/join$/)
  await expect(
    page.getByRole('heading', { name: '講義に参加する' }),
  ).toBeVisible()

  await safety.assertClean()
})

test('classroom display without an issued token fails closed on the display route', async ({
  page,
}) => {
  await page.goto('/display')

  await expect(
    page.getByRole('heading', { name: '共有画面の確認が必要です' }),
  ).toBeVisible()
  await expect(page).toHaveURL(/\/display$/)
  await expect(
    page.getByText(
      '管理画面から「画面共有を開始する」を押して、もう一度開いてください。',
    ),
  ).toBeVisible()
  await expect(
    page.getByRole('link', { name: '英語講義の共有Displayを体験' }),
  ).toHaveAttribute('href', '/demo/display')
})

test('English lecture demo opens a local-only classroom Display without Supabase', async ({
  page,
}) => {
  const safety = await installBrowserSafetyMonitor(page)
  const hostedServiceRequests: string[] = []

  page.on('request', (request) => {
    const url = new URL(request.url())
    if (
      url.hostname.endsWith('.supabase.co') ||
      url.port === '54321' ||
      /\/(?:auth|functions|realtime|rest|storage)\/v1(?:\/|$)/.test(
        url.pathname,
      )
    ) {
      hostedServiceRequests.push(request.url())
    }
  })

  await page.goto('/demo')
  await page.getByRole('link', { name: '共有Displayを見る' }).click()

  await expect(page).toHaveURL(/\/demo\/display$/)
  await expect(
    page.getByRole('heading', { name: 'AI時代の英語と学び' }),
  ).toBeVisible()
  await expect(
    page.getByRole('button', { name: '教室表示を全画面にする' }),
  ).toBeVisible()
  const demoJoinQr = page.locator('.lecture-join-qr')
  await expect(demoJoinQr).toContainText('DEMO')
  await expect(demoJoinQr).toHaveAttribute('data-lecture-join-url', /\/demo$/)
  await expect(page.locator('.pdf-canvas')).toBeVisible({ timeout: 15_000 })
  await expect(page.getByLabel('講義字幕')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'コメント' })).toBeVisible()
  await expect(
    page.getByRole('heading', { name: '直近5分のハイライト' }),
  ).toBeVisible()
  await expect(
    page.getByText(
      'AI翻訳によって、海外の情報へアクセスするための壁は小さくなっている。',
    ),
  ).toBeVisible()
  await expect(
    page.getByRole('heading', {
      name: '翻訳AIが使える今、英語を学ぶ価値として最も大きいものは？',
    }),
  ).toBeVisible()
  await expect(page.getByText('共有画面の確認が必要です')).toHaveCount(0)
  const horizontalOverflow = await page.evaluate(
    () =>
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth,
  )
  expect(horizontalOverflow).toBeLessThanOrEqual(1)
  expect(hostedServiceRequests).toEqual([])

  await safety.assertClean()
})
