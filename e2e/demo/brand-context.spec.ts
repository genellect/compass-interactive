import { expect, test } from '@playwright/test'
import { installBrowserSafetyMonitor } from '../helpers/browserSafety.js'

const INTERACTIVE_INTRO_URL =
  'https://compass-official.pages.dev/INTRO_Interactive/'
const DEVELOPER_URL = 'https://compass-official.pages.dev/founder/'

test('join hero and secondary COMPASS links preserve the primary lecture flow', async ({
  page,
}) => {
  const safety = await installBrowserSafetyMonitor(page)
  await page.goto('/join')

  await expect(
    page.getByRole('heading', { name: 'LET EVERYTHING MOVE.' }),
  ).toBeVisible()
  await expect(
    page
      .getByRole('navigation', { name: '画面切り替え' })
      .getByText('デモを体験'),
  ).toBeVisible()

  const contextTrigger = page.getByRole('button', {
    name: 'COMPASSのリンクを開く',
  })
  await expect(contextTrigger).toBeVisible()
  await expect(contextTrigger).toHaveAttribute('aria-expanded', 'false')

  const layout = await page.evaluate(() => {
    const heading = document.querySelector<HTMLElement>('.join-hero-copy > h1')
    const firstLine = document.querySelector<HTMLElement>('.hero-primary-line')
    const joinCard = document.querySelector<HTMLElement>('.join-card')
    const primaryNav = document.querySelector<HTMLElement>('.app-header nav')
    if (!heading || !firstLine || !joinCard || !primaryNav) {
      throw new Error('The join page visual contract is incomplete.')
    }

    const firstLineRect = firstLine.getBoundingClientRect()
    const joinCardRect = joinCard.getBoundingClientRect()
    return {
      firstLineRight: firstLineRect.right,
      joinCardBottom: joinCardRect.bottom,
      navVisible: primaryNav.getBoundingClientRect().width > 0,
      overflowFree:
        document.documentElement.scrollWidth <=
        document.documentElement.clientWidth + 1,
      viewportHeight: window.innerHeight,
      viewportWidth: window.innerWidth,
    }
  })

  expect(layout.overflowFree).toBe(true)
  expect(layout.navVisible).toBe(true)
  expect(layout.firstLineRight).toBeLessThanOrEqual(layout.viewportWidth + 1)
  if (layout.viewportWidth <= 430) {
    expect(layout.joinCardBottom).toBeLessThanOrEqual(layout.viewportHeight)
  }

  await contextTrigger.click()
  await expect(contextTrigger).toHaveAttribute('aria-expanded', 'true')

  const interactiveLink = page.getByRole('link', {
    name: /Interactiveについて/,
  })
  const developerLink = page.getByRole('link', {
    name: /Meet the Developer/,
  })
  await expect(interactiveLink).toHaveAttribute('href', INTERACTIVE_INTRO_URL)
  await expect(developerLink).toHaveAttribute('href', DEVELOPER_URL)
  await expect(
    developerLink.getByText('Yuto Matsui — Interactiveの開発者', {
      exact: true,
    }),
  ).toBeVisible()
  for (const link of [interactiveLink, developerLink]) {
    await expect(link).toHaveAttribute('target', '_blank')
    await expect(link).toHaveAttribute('rel', /noopener/)
    await expect(link).toHaveAttribute('rel', /noreferrer/)
  }

  const developerLinkLayout = await developerLink.evaluate((link) => {
    const support = link.querySelector<HTMLElement>('small')
    const arrow = link.querySelector<SVGElement>(':scope > svg:last-child')
    if (!support || !arrow) {
      throw new Error('The developer link visual contract is incomplete.')
    }

    const linkRect = link.getBoundingClientRect()
    const supportRect = support.getBoundingClientRect()
    const arrowRect = arrow.getBoundingClientRect()
    return {
      arrowInside: arrowRect.right <= linkRect.right + 1,
      contentDoesNotOverlapArrow: supportRect.right <= arrowRect.left + 1,
      overflowFree: link.scrollWidth <= link.clientWidth + 1,
    }
  })
  expect(developerLinkLayout).toEqual({
    arrowInside: true,
    contentDoesNotOverlapArrow: true,
    overflowFree: true,
  })

  await page.keyboard.press('Escape')
  await expect(contextTrigger).toHaveAttribute('aria-expanded', 'false')
  await expect(contextTrigger).toBeFocused()
  await safety.assertClean()
})

test('lecture and display navigation remain primary after joining the demo', async ({
  page,
}) => {
  const safety = await installBrowserSafetyMonitor(page)
  await page.goto('/demo')
  await expect(
    page.getByRole('heading', { name: 'AI時代の英語と学び' }),
  ).toBeVisible()

  const primaryNavigation = page.getByRole('navigation', {
    name: '画面切り替え',
  })
  await expect(
    primaryNavigation.getByRole('link', { name: '講義' }),
  ).toBeVisible()
  await expect(
    primaryNavigation.getByRole('link', { name: '教室表示' }),
  ).toBeVisible()
  await expect(
    page.getByRole('button', { name: 'COMPASSのリンクを開く' }),
  ).toBeVisible()

  const overlap = await page.evaluate(() => {
    const nav = document.querySelector<HTMLElement>('.app-header nav')
    const context = document.querySelector<HTMLElement>('.compass-context')
    if (!nav || !context) {
      throw new Error('The header controls are missing.')
    }
    const navRect = nav.getBoundingClientRect()
    const contextRect = context.getBoundingClientRect()
    return !(
      navRect.right <= contextRect.left ||
      contextRect.right <= navRect.left ||
      navRect.bottom <= contextRect.top ||
      contextRect.bottom <= navRect.top
    )
  })

  expect(overlap).toBe(false)
  await safety.assertClean()
})
