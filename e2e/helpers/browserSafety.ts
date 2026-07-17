import { expect, type Page } from '@playwright/test'

type BrowserSafetyMonitor = {
  assertClean: () => Promise<void>
}

export async function installBrowserSafetyMonitor(
  page: Page,
): Promise<BrowserSafetyMonitor> {
  const browserErrors: string[] = []
  const externalRequests: string[] = []

  page.on('console', (message) => {
    if (message.type() === 'error') {
      browserErrors.push(`console: ${message.text()}`)
    }
  })
  page.on('pageerror', (error) => {
    browserErrors.push(`pageerror: ${error.message}`)
  })

  await page.route('**/*', async (route) => {
    const requestUrl = new URL(route.request().url())
    if (
      ['http:', 'https:'].includes(requestUrl.protocol) &&
      !['127.0.0.1', 'localhost'].includes(requestUrl.hostname)
    ) {
      externalRequests.push(requestUrl.origin)
      await route.abort('blockedbyclient')
      return
    }

    await route.continue()
  })

  return {
    async assertClean() {
      expect(
        [...new Set(externalRequests)],
        'E2E must not contact Hosted Supabase, Cloudflare, R2, OpenAI, or any other external host.',
      ).toEqual([])
      expect(browserErrors, 'The browser emitted runtime errors.').toEqual([])
      await expect
        .poll(() =>
          page.evaluate(
            () =>
              document.documentElement.scrollWidth <=
              document.documentElement.clientWidth + 1,
          ),
        )
        .toBe(true)
    },
  }
}
