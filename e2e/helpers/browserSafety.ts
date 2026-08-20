import { expect, type Page } from '@playwright/test'

type BrowserSafetyMonitor = {
  assertClean: () => Promise<void>
  expectConsoleErrors: (
    expected: {
      message: string
      url: string
    },
    count: number,
  ) => Promise<void>
  expectConsoleErrorOnce: (expected: {
    message: string
    url: string
  }) => Promise<void>
}

type BrowserError = {
  locationUrl: string
  message: string
}

export async function installBrowserSafetyMonitor(
  page: Page,
): Promise<BrowserSafetyMonitor> {
  const browserErrors: BrowserError[] = []
  const externalRequests: string[] = []

  page.on('console', (message) => {
    if (message.type() === 'error') {
      browserErrors.push({
        locationUrl: message.location().url,
        message: `console: ${message.text()}`,
      })
    }
  })
  page.on('pageerror', (error) => {
    browserErrors.push({
      locationUrl: '',
      message: `pageerror: ${error.message}`,
    })
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

  async function expectConsoleErrors(
    expected: { message: string; url: string },
    count: number,
  ) {
    const expectedMessage = `console: ${expected.message}`
    const matchingErrors = () =>
      browserErrors.filter(
        (error) =>
          error.message === expectedMessage &&
          error.locationUrl === expected.url,
      )

    await expect
      .poll(() => matchingErrors().length, {
        message: `Expected ${count} browser console error(s) from ${expected.url}.`,
      })
      .toBe(count)

    const matchingIndexes = browserErrors.flatMap((error, index) =>
      error.message === expectedMessage && error.locationUrl === expected.url
        ? [index]
        : [],
    )
    expect(matchingIndexes).toHaveLength(count)
    for (const index of matchingIndexes.reverse()) {
      browserErrors.splice(index, 1)
    }
  }

  return {
    async assertClean() {
      expect(
        [...new Set(externalRequests)],
        'E2E must not contact Hosted Supabase, Cloudflare, R2, OpenAI, or any other external host.',
      ).toEqual([])
      expect(
        browserErrors.map((error) =>
          error.locationUrl
            ? `${error.message} (${error.locationUrl})`
            : error.message,
        ),
        'The browser emitted runtime errors.',
      ).toEqual([])
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
    expectConsoleErrors,
    async expectConsoleErrorOnce(expected) {
      await expectConsoleErrors(expected, 1)
    },
  }
}
