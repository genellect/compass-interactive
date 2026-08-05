import { AxeBuilder } from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import { installBrowserSafetyMonitor } from '../helpers/browserSafety.js'

async function expectNoSeriousAccessibilityViolations(page: Page) {
  const result = await new AxeBuilder({ page }).analyze()
  const blocking = result.violations
    .filter((violation) =>
      ['critical', 'serious'].includes(violation.impact ?? ''),
    )
    .map((violation) => ({
      id: violation.id,
      impact: violation.impact,
      targets: violation.nodes.map((node) => node.target.join(' ')),
    }))
  expect(blocking).toEqual([])
}

test('join and lecture learning flows have no serious accessibility violations', async ({
  page,
}) => {
  const safety = await installBrowserSafetyMonitor(page)
  await page.goto('/join')
  await expect(
    page.getByRole('heading', { name: '講義に参加する' }),
  ).toBeVisible()
  await page.getByRole('button', { name: 'COMPASSのリンクを開く' }).click()
  await expect(
    page.getByRole('link', { name: /Interactiveについて/ }),
  ).toBeVisible()
  await expectNoSeriousAccessibilityViolations(page)
  await page.keyboard.press('Escape')

  await page.getByRole('button', { name: 'デモ講義を体験' }).click()
  await expect(
    page.getByRole('heading', { name: 'AI時代の英語と学び' }),
  ).toBeVisible()
  await expectNoSeriousAccessibilityViolations(page)
  await safety.assertClean()
})

test('primary join and exit actions are keyboard operable', async ({
  page,
}) => {
  const safety = await installBrowserSafetyMonitor(page)
  await page.goto('/join')

  const lectureCode = page.getByLabel('講義コード')
  await lectureCode.fill('123456')
  await lectureCode.focus()
  await expect(lectureCode).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(page.getByRole('button', { name: '参加する' })).toBeFocused()

  const demoButton = page.getByRole('button', { name: 'デモ講義を体験' })
  await demoButton.focus()
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(/\/lecture$/)

  const exitButton = page.getByRole('button', { name: '講義から退出する' })
  await exitButton.focus()
  await expect(exitButton).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(/\/join$/)
  await safety.assertClean()
})
