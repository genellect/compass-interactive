import { expect, test, type BrowserContext, type Page } from '@playwright/test'

const adminAuthStorageKey = 'compass-interactive-admin-supabase-auth-v1'
const adminAppSessionStorageKey =
  'compass-interactive-admin-google-app-session-v1'

type FixtureTarget = BrowserContext | Page

export type GoogleAdminBrowserFixture = {
  appSessionToken: string
  authStorageValue: string
}

export function readGoogleAdminBrowserFixture(): GoogleAdminBrowserFixture {
  const fixtures = process.env.TEST_GOOGLE_ADMIN_BROWSER_FIXTURES?.trim()
  let fixture: GoogleAdminBrowserFixture
  if (fixtures) {
    const byProject = JSON.parse(fixtures) as Record<
      string,
      GoogleAdminBrowserFixture | GoogleAdminBrowserFixture[]
    >
    const projectName = test.info().project.name
    const configuredFixture = byProject[projectName]
    const retryStride = Number(
      process.env.TEST_GOOGLE_ADMIN_BROWSER_RETRY_STRIDE ?? '1',
    )
    expect(
      Number.isSafeInteger(retryStride) && retryStride > 0,
      'The local Google Admin fixture retry stride must be a positive integer.',
    ).toBe(true)
    const attemptIndex =
      test.info().repeatEachIndex * retryStride + test.info().retry
    const projectFixture = Array.isArray(configuredFixture)
      ? configuredFixture[attemptIndex]
      : configuredFixture
    expect(
      projectFixture,
      `The local Google Admin fixture for ${projectName} repeat ${test.info().repeatEachIndex} retry ${test.info().retry} is required.`,
    ).toBeTruthy()
    fixture = projectFixture
  } else {
    fixture = {
      appSessionToken:
        process.env.TEST_GOOGLE_ADMIN_APP_SESSION_TOKEN?.trim() ?? '',
      authStorageValue:
        process.env.TEST_GOOGLE_ADMIN_AUTH_STORAGE_VALUE?.trim() ?? '',
    }
  }
  expect(
    fixture.appSessionToken,
    'The local Google Admin app-session fixture is required.',
  ).toMatch(/^g1\.[A-Za-z0-9_-]{43}$/)
  expect(
    fixture.authStorageValue,
    'The local Google AAL2 auth-storage fixture is required.',
  ).not.toBe('')
  return fixture
}

export async function installGoogleAdminSession(
  target: FixtureTarget,
  appSessionToken = readGoogleAdminBrowserFixture().appSessionToken,
) {
  const { authStorageValue } = readGoogleAdminBrowserFixture()
  await target.addInitScript(
    ({
      appSessionToken,
      authStorageValue,
      authStorageKey,
      appSessionStorageKey,
    }) => {
      window.localStorage.setItem(authStorageKey, authStorageValue)
      window.sessionStorage.setItem(appSessionStorageKey, appSessionToken)
      window.sessionStorage.removeItem(
        'compass-interactive-admin-authenticated',
      )
      window.sessionStorage.removeItem('compass-interactive-admin-token')
    },
    {
      appSessionStorageKey: adminAppSessionStorageKey,
      appSessionToken,
      authStorageKey: adminAuthStorageKey,
      authStorageValue,
    },
  )
}
