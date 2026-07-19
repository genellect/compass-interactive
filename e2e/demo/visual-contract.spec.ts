import { expect, test } from '@playwright/test'
import { installBrowserSafetyMonitor } from '../helpers/browserSafety.js'

test('lecture layout matches the deterministic visual contract', async ({
  page,
}) => {
  const safety = await installBrowserSafetyMonitor(page)
  await page.goto('/demo')
  await expect(
    page.getByRole('heading', { name: 'AI時代の英語と学び' }),
  ).toBeVisible()

  const contract = await page.evaluate(() => {
    const grid = document.querySelector<HTMLElement>('.lecture-experience-grid')
    if (!grid) throw new Error('Lecture experience grid is missing.')
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
    const sections = selectors.map((selector) => {
      const element = document.querySelector<HTMLElement>(selector)
      if (!element) throw new Error(`Missing visual section: ${selector}`)
      const style = getComputedStyle(element)
      return {
        display: style.display,
        gridArea: style.gridArea,
        selector,
      }
    })
    const bodyStyle = getComputedStyle(document.body)
    const gridStyle = getComputedStyle(grid)
    return {
      body: {
        backgroundColor: bodyStyle.backgroundColor,
        color: bodyStyle.color,
      },
      grid: {
        columns: gridStyle.gridTemplateColumns,
        areas: gridStyle.gridTemplateAreas,
      },
      mode: window.innerWidth <= 900 ? 'mobile' : 'desktop',
      overflowFree:
        document.documentElement.scrollWidth <=
        document.documentElement.clientWidth + 1,
      sections,
    }
  })

  expect(`${JSON.stringify(contract, null, 2)}\n`).toMatchSnapshot(
    'lecture-layout.json',
  )
  await safety.assertClean()
})
