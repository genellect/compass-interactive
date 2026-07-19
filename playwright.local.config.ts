import { defineConfig, devices } from '@playwright/test'

const baseURL = 'http://127.0.0.1:4173'
const supabaseUrl = process.env.VITE_SUPABASE_URL?.trim() ?? ''
const publishableKey = process.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim() ?? ''

function assertLocalSupabaseUrl(value: string) {
  const url = new URL(value)
  if (!['127.0.0.1', 'localhost'].includes(url.hostname)) {
    throw new Error(
      'Local E2E refuses non-local Supabase URLs. Start the local stack first.',
    )
  }
}

if (!supabaseUrl || !publishableKey) {
  throw new Error(
    'VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY are required.',
  )
}
assertLocalSupabaseUrl(supabaseUrl)

export default defineConfig({
  testDir: './e2e/local',
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  failOnFlakyTests: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI
    ? [
        ['line'],
        [
          'html',
          { open: 'never', outputFolder: 'test-results/reports/local' },
        ],
      ]
    : [
        ['list'],
        [
          'html',
          { open: 'never', outputFolder: 'test-results/reports/local' },
        ],
      ],
  outputDir: 'test-results/local',
  timeout: 90_000,
  snapshotPathTemplate:
    '{testDir}/{testFilePath}-snapshots/{arg}-{projectName}{ext}',
  expect: { timeout: 15_000 },
  use: {
    baseURL,
    colorScheme: 'light',
    locale: 'ja-JP',
    screenshot: 'only-on-failure',
    timezoneId: 'Asia/Tokyo',
    trace: 'on-first-retry',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'local-supabase-chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'local-supabase-webkit',
      use: { ...devices['Desktop Safari'] },
    },
    {
      name: 'local-supabase-mobile-chromium',
      use: {
        ...devices['Pixel 7'],
        viewport: { width: 390, height: 844 },
      },
    },
  ],
})
