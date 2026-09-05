import { expect, test, type Page } from '@playwright/test'
import { installBrowserSafetyMonitor } from '../helpers/browserSafety.js'

async function expectStableSlideInViewport(page: Page) {
  const canvas = page.locator('.display-main-stage .pdf-canvas')
  await expect(canvas).toBeVisible({ timeout: 15_000 })
  await expect
    .poll(() =>
      canvas.evaluate((element) => (element as HTMLCanvasElement).width),
    )
    .toBeGreaterThan(300)

  const samples = await page.evaluate(async () => {
    const stage = document.querySelector<HTMLElement>(
      '.display-main-stage .pdf-stage',
    )
    const canvas = stage?.querySelector<HTMLCanvasElement>('canvas')
    if (!stage || !canvas) throw new Error('Display PDF is missing.')
    const samples = []
    for (let index = 0; index < 8; index += 1) {
      await new Promise((resolve) => window.setTimeout(resolve, 200))
      const stageRect = stage.getBoundingClientRect()
      const canvasRect = canvas.getBoundingClientRect()
      const captionHeight =
        document
          .querySelector('.display-caption-strip')
          ?.getBoundingClientRect().height ?? 0
      samples.push({
        stageHeight: stageRect.height,
        // Live captions can take one or two lines. Fullscreen reallocates the
        // same bounded height between the slide and caption when this changes.
        allocatedHeight:
          stageRect.height + (document.fullscreenElement ? captionHeight : 0),
        top: canvasRect.top,
        bottom: canvasRect.bottom,
        left: canvasRect.left,
        right: canvasRect.right,
        width: canvasRect.width,
        height: canvasRect.height,
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
      })
    }
    // Fullscreen can animate its viewport before the final layout settles.
    return samples.slice(3)
  })
  expect(
    Math.max(...samples.map((sample) => sample.allocatedHeight)) -
      Math.min(...samples.map((sample) => sample.allocatedHeight)),
    JSON.stringify(samples),
  ).toBeLessThanOrEqual(1)
  for (const sample of samples) {
    expect(sample.top, JSON.stringify(sample)).toBeGreaterThanOrEqual(0)
    expect(sample.bottom, JSON.stringify(sample)).toBeLessThanOrEqual(
      sample.viewportHeight + 1,
    )
    expect(sample.left).toBeGreaterThanOrEqual(0)
    expect(sample.right).toBeLessThanOrEqual(sample.viewportWidth + 1)
    expect(sample.height).toBeGreaterThan(100)
  }
  return samples
}

test('Display slide remains in view and stable before and after fullscreen', async ({
  page,
  isMobile,
}, testInfo) => {
  test.setTimeout(90_000)
  const safety = await installBrowserSafetyMonitor(page)
  const viewports = isMobile
    ? [{ width: 390, height: 844 }]
    : [
        { width: 1280, height: 720 },
        { width: 1920, height: 1080 },
        { width: 1366, height: 768 },
        { width: 1024, height: 768 },
      ]

  for (const viewport of viewports) {
    await page.setViewportSize(viewport)
    await page.goto('/demo/display')
    const normal = await expectStableSlideInViewport(page)
    const measurements: Record<string, typeof normal> = { normal }
    if (!isMobile && (await page.evaluate(() => document.fullscreenEnabled))) {
      await page.getByRole('button', { name: '教室表示を全画面にする' }).click()
      await expect(
        page.getByRole('button', { name: '全画面を終了' }),
      ).toBeVisible()
      measurements.fullscreen = await expectStableSlideInViewport(page)
      await page.getByRole('button', { name: '全画面を終了' }).click()
      await expect(
        page.getByRole('button', { name: '教室表示を全画面にする' }),
      ).toBeVisible()
      measurements.restored = await expectStableSlideInViewport(page)
    }
    await testInfo.attach(`display-${viewport.width}x${viewport.height}.json`, {
      body: Buffer.from(JSON.stringify(measurements)),
      contentType: 'application/json',
    })
  }
  await safety.assertClean()
})
