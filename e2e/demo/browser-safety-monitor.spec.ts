import { EventEmitter } from 'node:events'
import { expect, test, type Page } from '@playwright/test'
import { installBrowserSafetyMonitor } from '../helpers/browserSafety.js'

const url = 'http://127.0.0.1:54321/functions/v1/display-session-status'
const message =
  'Failed to load resource: the server responded with a status of 409 (Conflict)'
const expectedConsoleErrors = [{ message, url, minCount: 1, maxCount: 2 }]

// Exercise event ordering deterministically, without a server or browser timing
// dependency. The late console event arrives during the final layout check.
function fixture(lateEvent?: (events: EventEmitter) => void) {
  const events = new EventEmitter()
  let delivered = false
  const page = Object.assign(events, {
    async route() {},
    async evaluate() {
      if (!delivered) {
        delivered = true
        lateEvent?.(events)
      }
      return true
    },
  }) as unknown as Page
  return { events, page }
}

function consoleError(events: EventEmitter, text = message, source = url) {
  events.emit('console', {
    type: () => 'error',
    text: () => text,
    location: () => ({ url: source }),
  })
}

test('counts a delayed known console duplicate in one final snapshot', async () => {
  const { events, page } = fixture((target) => consoleError(target))
  const safety = await installBrowserSafetyMonitor(page)
  consoleError(events)
  await safety.assertClean({ expectedConsoleErrors })
})

test('rejects known console emissions above the response-bound maximum', async () => {
  const { events, page } = fixture((target) => {
    consoleError(target)
    consoleError(target)
  })
  const safety = await installBrowserSafetyMonitor(page)
  consoleError(events)
  await expect(safety.assertClean({ expectedConsoleErrors })).rejects.toThrow()
})

for (const unexpected of ['message', 'url', 'pageerror'] as const) {
  test(`keeps an unrelated ${unexpected} fatal beside a known duplicate`, async () => {
    const { events, page } = fixture((target) => {
      if (unexpected === 'pageerror') {
        target.emit('pageerror', new Error('unexpected runtime failure'))
      } else {
        consoleError(
          target,
          unexpected === 'message' ? 'unexpected error' : message,
          unexpected === 'url' ? `${url}/unrelated` : url,
        )
      }
    })
    const safety = await installBrowserSafetyMonitor(page)
    consoleError(events)
    await expect(
      safety.assertClean({ expectedConsoleErrors }),
    ).rejects.toThrow()
  })
}

test('does not persist an expected error allowance across assertions', async () => {
  const { events, page } = fixture()
  const safety = await installBrowserSafetyMonitor(page)
  consoleError(events)
  await safety.assertClean({ expectedConsoleErrors })
  await expect(safety.assertClean()).rejects.toThrow()
})

test('requires the declared minimum number of exact errors', async () => {
  const { page } = fixture()
  const safety = await installBrowserSafetyMonitor(page)
  await expect(safety.assertClean({ expectedConsoleErrors })).rejects.toThrow()
})

test('rejects an unbounded console allowance', async () => {
  const { events, page } = fixture()
  const safety = await installBrowserSafetyMonitor(page)
  consoleError(events)
  await expect(
    safety.assertClean({
      expectedConsoleErrors: [
        { message, url, minCount: 1, maxCount: Infinity },
      ],
    }),
  ).rejects.toThrow()
})

test('retains exact one-shot console consumption', async () => {
  const { events, page } = fixture()
  const safety = await installBrowserSafetyMonitor(page)
  consoleError(events)
  await safety.expectConsoleErrorOnce({ message, url })
  await safety.assertClean()
})
