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
  await expect(page.getByText(/21[6-9]|22[0-4]/).first()).toBeVisible()

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
  const safety = await installBrowserSafetyMonitor(page)
  await page.goto('/demo')
  await expect(
    page.getByRole('heading', { name: 'AI時代の英語と学び' }),
  ).toBeVisible()

  const composer = page.locator('#lecture-question')
  const commentInput = composer.getByPlaceholder(
    '感じたことや質問を、そのまま書いてみてください。',
  )

  await commentInput.fill('E2E匿名コメント')
  await composer.getByRole('button', { name: 'みんなに共有' }).click()
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

  await nicknameInput.fill('薬理E2E')
  await commentInput.fill('E2Eニックネームコメント')
  await composer.getByRole('button', { name: 'みんなに共有' }).click()
  const nicknameCard = page
    .locator('.comment-card')
    .filter({ hasText: 'E2Eニックネームコメント' })
  await expect(nicknameCard).toContainText('薬理E2E')

  await page
    .locator('.choice-row')
    .filter({ hasText: '世界中の仲間と一緒に挑戦できる' })
    .click()
  await page.getByRole('button', { name: 'この回答を送る' }).click()
  await expect(
    page.getByText('回答しました。みんなの考えを見てみましょう。'),
  ).toBeVisible()

  await commentInput.fill('E2E履歴リンク確認')
  await composer.getByRole('button', { name: 'みんなに共有' }).click()
  const historyLink = page.getByRole('link', { name: 'コメント履歴を見る' })
  await historyLink.scrollIntoViewIfNeeded()
  await historyLink.focus()
  await page.keyboard.press('Enter')
  await expect(
    page.getByRole('heading', { name: 'コメント履歴' }),
  ).toBeVisible()
  await expect(page.getByText('E2E履歴リンク確認')).toBeVisible()

  const lectureLink = page.getByRole('link', { name: '講義へ戻る' })
  await lectureLink.focus()
  await page.keyboard.press('Enter')
  await page.getByRole('button', { name: '講義から退出する' }).click()
  await expect(page).toHaveURL(/\/join$/)
  await expect(
    page.getByRole('heading', { name: '講義に参加する' }),
  ).toBeVisible()

  await safety.assertClean()
})
