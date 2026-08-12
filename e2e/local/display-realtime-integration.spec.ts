import { randomUUID } from 'node:crypto'
import { AxeBuilder } from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'
import type { Database } from '../../src/types/database.js'
import { installBrowserSafetyMonitor } from '../helpers/browserSafety.js'
import {
  installGoogleAdminSession,
  readGoogleAdminBrowserFixture,
} from '../helpers/googleAdminSession.js'

const adminSessionSecret = process.env.TEST_ADMIN_SESSION_SECRET?.trim() ?? ''
const appBaseUrl = process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:4173'
const supabaseUrl = process.env.TEST_SUPABASE_URL?.trim() ?? ''
const publishableKey = process.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim() ?? ''
const serviceRoleKey = process.env.TEST_SUPABASE_SERVICE_ROLE_KEY?.trim() ?? ''
const pdfSha256 = 'c'.repeat(64)

async function expectNoSeriousAccessibilityViolations(page: Page) {
  const result = await new AxeBuilder({ page }).analyze()
  expect(
    result.violations
      .filter((violation) =>
        ['critical', 'serious'].includes(violation.impact ?? ''),
      )
      .map((violation) => ({
        id: violation.id,
        nodes: violation.nodes.map((node) => ({
          html: node.html,
          summary: node.failureSummary,
          target: node.target.join(' '),
        })),
      })),
  ).toEqual([])
}

function serviceClient() {
  const parsed = new URL(supabaseUrl)
  expect(['127.0.0.1', 'localhost']).toContain(parsed.hostname)
  return createClient<Database>(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

async function installPdfMock(page: Page) {
  const corsHeaders = {
    'access-control-allow-headers': 'authorization, content-type, apikey',
    'access-control-allow-methods': 'GET, OPTIONS, POST',
    'access-control-allow-origin': '*',
  }
  const expiresAt = new Date(Date.now() + 5 * 60_000).toISOString()
  await page.route(
    /127\.0\.0\.1:8787\/v1\/lectures\/[^/]+\/manifest$/,
    async (route) => {
      if (route.request().method() === 'OPTIONS') {
        await route.fulfill({ headers: corsHeaders, status: 204 })
        return
      }
      await route.fulfill({
        body: JSON.stringify({
          access_version: 1,
          documents: [
            {
              archive_expires_at: null,
              byte_size: 100_000,
              delete_after: null,
              display_name: 'Phase 7.28B local.pdf',
              document_id: 'phase728b-local-pdf',
              document_version: pdfSha256,
              download_enabled: true,
              page_count: 34,
              text_char_count: 1_000,
              visible: true,
            },
          ],
          lecture_public_id: 'lecture_phase728b_local',
          manifest_version: 1,
          schema_version: 1,
          updated_at: new Date().toISOString(),
        }),
        contentType: 'application/json',
        headers: corsHeaders,
        status: 200,
      })
    },
  )
  await page.route(
    /127\.0\.0\.1:8787\/v1\/lectures\/[^/]+\/documents\/.*\/access/,
    async (route) => {
      if (route.request().method() === 'OPTIONS') {
        await route.fulfill({ headers: corsHeaders, status: 204 })
        return
      }
      await route.fulfill({
        body: JSON.stringify({
          expiresAt,
          url: `${appBaseUrl}/lecture-assets/m4-sample-v1.pdf`,
        }),
        contentType: 'application/json',
        headers: corsHeaders,
        status: 200,
      })
    },
  )
}

async function installClipboardCapture(page: Page) {
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: async (value: string) => {
          window.sessionStorage.setItem('phase728b-copied-display-url', value)
        },
      },
    })
  })
}

async function copiedDisplayUrl(page: Page) {
  return page.evaluate(
    () => window.sessionStorage.getItem('phase728b-copied-display-url') ?? '',
  )
}

function redactRealtimeFrame(payload: string) {
  return payload
    .replace(/"access_token":"[^"]+"/g, '"access_token":"[redacted]"')
    .replace(/Bearer\s+[A-Za-z0-9._~-]+/g, 'Bearer [redacted]')
}

async function invokeDisplaySnapshot(
  page: Page,
  input: { displayToken: string; lectureSessionId: string },
) {
  return page.evaluate(
    async ({ displayToken, endpoint, lectureSessionId, publicKey }) => {
      // @ts-expect-error Vite resolves this browser-only source module.
      const { supabase } = await import('/src/lib/supabaseClient.ts')
      const { data } = await supabase.auth.getSession()
      const accessToken = data.session?.access_token ?? ''
      const response = await fetch(endpoint, {
        body: JSON.stringify({
          action: 'snapshot',
          displayToken,
          lectureSessionId,
        }),
        headers: {
          apikey: publicKey,
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        method: 'POST',
      })
      return { body: await response.json(), status: response.status }
    },
    {
      displayToken: input.displayToken,
      endpoint: `${supabaseUrl}/functions/v1/operator-live-snapshot`,
      lectureSessionId: input.lectureSessionId,
      publicKey: publishableKey,
    },
  )
}

async function invokeDisplayPdf(
  page: Page,
  input: { displayToken: string; lectureSessionId: string },
) {
  return page.evaluate(
    async ({ displayToken, endpoint, lectureSessionId, publicKey }) => {
      // @ts-expect-error Vite resolves this browser-only source module.
      const { supabase } = await import('/src/lib/supabaseClient.ts')
      const { data } = await supabase.auth.getSession()
      const accessToken = data.session?.access_token ?? ''
      const response = await fetch(endpoint, {
        body: JSON.stringify({
          action: 'display',
          displayToken,
          lectureSessionId,
        }),
        headers: {
          apikey: publicKey,
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        method: 'POST',
      })
      return { body: await response.json(), status: response.status }
    },
    {
      displayToken: input.displayToken,
      endpoint: `${supabaseUrl}/functions/v1/issue-pdf-access-token`,
      lectureSessionId: input.lectureSessionId,
      publicKey: publishableKey,
    },
  )
}

test('claimed cross-browser Display receives private page/caption acceleration and converges safely', async ({
  browser,
}) => {
  test.setTimeout(180_000)
  expect(adminSessionSecret).not.toBe('')
  expect(publishableKey).not.toBe('')
  expect(serviceRoleKey).not.toBe('')

  const service = serviceClient()
  const contextOptions = test.info().project.name.includes('mobile')
    ? { viewport: { height: 844, width: 390 } }
    : {}
  const adminContext = await browser.newContext(contextOptions)
  const adminPage = await adminContext.newPage()
  const adminSafety = await installBrowserSafetyMonitor(adminPage)
  const title = `Phase 7.28B Display ${Date.now()} ${test.info().project.name}`
  let displayContext: Awaited<ReturnType<typeof browser.newContext>> | null =
    null

  try {
    await installPdfMock(adminPage)
    await installGoogleAdminSession(adminPage)
    await adminPage.goto('/admin')
    await expect(adminPage.locator('.admin-workflow')).toBeVisible()
    const appSessionToken = readGoogleAdminBrowserFixture().appSessionToken

    const lecture = await adminPage.evaluate(
      async ({ token, lectureTitle }) => {
        const repositoryPath = '/src/repositories/supabaseAdminRepository.ts'
        const { supabaseAdminRepository } = await import(
          /* @vite-ignore */ repositoryPath
        )
        const created = await supabaseAdminRepository.manageLectures({
          action: 'create',
          adminToken: { appSessionToken: token, kind: 'google' },
          title: lectureTitle,
        })
        const row = created.find(
          (candidate: { title: string }) => candidate.title === lectureTitle,
        )
        if (!row) throw new Error('Display E2E lecture was not created.')
        const started = await supabaseAdminRepository.manageLectures({
          action: 'start',
          adminToken: { appSessionToken: token, kind: 'google' },
          lectureSessionId: row.id,
        })
        const active = started.find(
          (candidate: { id: string; status: string }) =>
            candidate.id === row.id,
        )
        if (!active || active.status !== 'open') {
          throw new Error('Display E2E lecture was not started.')
        }
        return active
      },
      { lectureTitle: title, token: appSessionToken },
    )

    const registration = await service.rpc('admin_register_pdf_document', {
      target_byte_size: 100_000,
      target_display_name: 'Phase 7.28B local.pdf',
      target_document_id: 'phase728b-local-pdf',
      target_document_version: pdfSha256,
      target_download_enabled: true,
      target_lecture_session_id: lecture.id,
      target_manifest_version: 1,
      target_page_count: 34,
      target_pdf_sha256: pdfSha256,
      target_text_char_count: 1_000,
      target_text_sha256: 'd'.repeat(64),
    })
    expect(registration.error).toBeNull()
    const displayRegistration = await service.rpc(
      'admin_update_pdf_display_v3',
      {
        target_current_pdf_page: 1,
        target_display_mode: 'normal',
        target_lecture_session_id: lecture.id,
        target_pdf_document_id: 'phase728b-local-pdf',
        target_pdf_document_version: pdfSha256,
        target_pdf_manifest_version: 1,
        target_pdf_page_count: 34,
        target_pdf_visible: true,
      },
    )
    expect(displayRegistration.error).toBeNull()

    await adminPage.reload()
    const lectureRow = adminPage
      .locator('.lecture-admin-row')
      .filter({ hasText: title })
    await expect(lectureRow).toBeVisible()
    await lectureRow.locator('.lecture-row-actions button').first().click()
    await expect(lectureRow).toHaveClass(/is-active/)
    await expect(adminPage.locator('.admin-pdf-page-controller')).toContainText(
      '1 / 34',
    )
    await expectNoSeriousAccessibilityViolations(adminPage)

    await installClipboardCapture(adminPage)
    const issueResponsePromise = adminPage.waitForResponse(
      (response) =>
        response.url().endsWith('/functions/v1/issue-display-session') &&
        response.status() === 200,
    )
    const copyButton = adminPage.getByRole('button', {
      name: '別ブラウザ用リンクをコピー',
    })
    await copyButton.focus()
    await expect(copyButton).toBeFocused()
    await adminPage.keyboard.press('Enter')
    const issueResponse = await issueResponsePromise
    const issued = (await issueResponse.json()) as {
      displayToken: string
      lectureSessionId: string
      realtime?: { expiresAt?: string; topic?: string }
    }
    expect(issued.lectureSessionId).toBe(lecture.id)
    expect(issued.realtime?.topic).toMatch(
      new RegExp(`^display:${lecture.id}:[0-9a-f-]{36}$`, 'i'),
    )
    await expect(
      adminPage.getByRole('button', { name: 'リンクをコピーしました' }),
    ).toBeVisible()
    const displayUrl = await copiedDisplayUrl(adminPage)
    expect(displayUrl).toContain(`/display#`)
    expect(displayUrl).toContain(encodeURIComponent(issued.displayToken))

    displayContext = await browser.newContext(contextOptions)
    const displayPage = await displayContext.newPage()
    const realtimeFrames: string[] = []
    displayPage.on('websocket', (socket) => {
      socket.on('framesent', (event) =>
        realtimeFrames.push(
          `sent:${redactRealtimeFrame(String(event.payload)).slice(0, 1_000)}`,
        ),
      )
      socket.on('framereceived', (event) =>
        realtimeFrames.push(
          `received:${redactRealtimeFrame(String(event.payload)).slice(0, 1_000)}`,
        ),
      )
    })
    const displaySafety = await installBrowserSafetyMonitor(displayPage)
    await installPdfMock(displayPage)
    const claimPromise = displayPage.waitForResponse((response) =>
      response.url().endsWith('/functions/v1/claim-display-realtime-session'),
    )
    await displayPage.goto(displayUrl)
    expect((await claimPromise).status()).toBe(200)
    await expect(
      displayPage.getByRole('heading', { name: title }),
    ).toBeVisible()
    await expectNoSeriousAccessibilityViolations(displayPage)
    await expect(displayPage.locator('.pdf-canvas')).toBeVisible({
      timeout: 20_000,
    })
    await expect
      .poll(
        () => displayPage.locator('html').getAttribute('data-display-realtime'),
        { timeout: 15_000 },
      )
      .toBe('connected')
      .catch((error: unknown) => {
        throw new Error(
          `${error instanceof Error ? error.message : 'Realtime join failed.'}\n${realtimeFrames.join('\n')}`,
        )
      })

    const pageStartedAt = Date.now()
    await adminPage
      .locator('.admin-pdf-page-controller')
      .locator('button')
      .filter({ hasText: /次/ })
      .click()
    await expect(displayPage.getByText('2 / 3', { exact: true })).toBeVisible({
      timeout: 2_000,
    })
    expect(Date.now() - pageStartedAt).toBeLessThan(2_000)

    const streamId = randomUUID()
    await adminPage.evaluate(
      async ({ lectureSessionId, id }) => {
        const realtimePath = '/src/display/displayRealtime.ts'
        const { publishAdminCaptionRealtime } = await import(
          /* @vite-ignore */ realtimePath
        )
        await publishAdminCaptionRealtime({
          caption: { text: 'Phase 7.28B private caption' },
          lectureSessionId,
          sequence: 0,
          source: 'completed',
          streamId: id,
          timestamp: Date.now(),
        })
      },
      { id: streamId, lectureSessionId: lecture.id },
    )
    await expect(displayPage.locator('.display-caption-strip')).toContainText(
      'Phase 7.28B private caption',
      { timeout: 2_000 },
    )
    await adminPage.evaluate(
      async ({ lectureSessionId, id }) => {
        const realtimePath = '/src/display/displayRealtime.ts'
        const { publishAdminCaptionRealtime } = await import(
          /* @vite-ignore */ realtimePath
        )
        await publishAdminCaptionRealtime({
          caption: null,
          lectureSessionId,
          sequence: 1,
          source: 'stopped',
          streamId: id,
          timestamp: Date.now(),
        })
        await publishAdminCaptionRealtime({
          caption: { text: 'must not reappear after stop' },
          lectureSessionId,
          sequence: 2,
          source: 'completed',
          streamId: id,
          timestamp: Date.now(),
        })
      },
      { id: streamId, lectureSessionId: lecture.id },
    )
    await expect(displayPage.locator('.display-caption-strip')).toHaveCount(0)
    await displayPage.waitForTimeout(700)
    await expect(
      displayPage.getByText('must not reappear after stop'),
    ).toHaveCount(0)

    const replayContext = await browser.newContext(contextOptions)
    const replayPage = await replayContext.newPage()
    const replayClaim = replayPage.waitForResponse((response) =>
      response.url().endsWith('/functions/v1/claim-display-realtime-session'),
    )
    await replayPage.goto(displayUrl)
    expect((await replayClaim).status()).toBe(409)
    await replayContext.close()

    const studentContext = await browser.newContext(contextOptions)
    const studentPage = await studentContext.newPage()
    await studentPage.goto('/join')
    const studentChannelStatus = await studentPage.evaluate(
      async ({ topic }) => {
        const anonymousAuthPath = '/src/lib/anonymousAuth.ts'
        const { ensureAnonymousAuthSession } = await import(
          /* @vite-ignore */ anonymousAuthPath
        )
        // @ts-expect-error Vite resolves this browser-only source module.
        const { supabase } = await import('/src/lib/supabaseClient.ts')
        await ensureAnonymousAuthSession()
        const { data } = await supabase.auth.getSession()
        if (!data.session) return 'NO_SESSION'
        await supabase.realtime.setAuth(data.session.access_token)
        const channel = supabase.channel(topic, {
          config: { broadcast: { ack: true }, private: true },
        })
        const status = await new Promise<string>((resolve) => {
          const timer = window.setTimeout(
            () => resolve('CLIENT_TIMEOUT'),
            9_000,
          )
          channel.subscribe((nextStatus: string) => {
            if (nextStatus !== 'SUBSCRIBING') {
              window.clearTimeout(timer)
              resolve(nextStatus)
            }
          })
        })
        await supabase.removeChannel(channel)
        return status
      },
      { topic: issued.realtime?.topic ?? '' },
    )
    expect(studentChannelStatus).not.toBe('SUBSCRIBED')

    // Stop Admin background polling before the test deliberately revokes its
    // tracked session from the service-role fixture.
    await adminPage.goto('/join')
    const disabled = await service.rpc('set_display_realtime_runtime_v1', {
      target_enabled: false,
    })
    expect(disabled.error).toBeNull()
    try {
      await expect
        .poll(
          async () =>
            (
              await invokeDisplaySnapshot(displayPage, {
                displayToken: issued.displayToken,
                lectureSessionId: lecture.id,
              })
            ).status,
          { timeout: 5_000 },
        )
        .toBe(200)
      const sameUserPdfFallback = await invokeDisplayPdf(displayPage, {
        displayToken: issued.displayToken,
        lectureSessionId: lecture.id,
      })
      expect(sameUserPdfFallback.status).toBe(200)
      expect(sameUserPdfFallback.body).toMatchObject({ ok: true })
      const crossUserFallback = await invokeDisplaySnapshot(studentPage, {
        displayToken: issued.displayToken,
        lectureSessionId: lecture.id,
      })
      expect(crossUserFallback.status).toBe(401)
      expect(crossUserFallback.body).toMatchObject({
        message: 'Invalid Display session.',
        ok: false,
      })

      const bindingResult = await service
        .from('display_realtime_sessions')
        .select('admin_session_id')
        .eq('lecture_session_id', lecture.id)
        .eq('revoke_reason', 'feature_disabled')
        .single()
      expect(bindingResult.error).toBeNull()
      expect(bindingResult.data?.admin_session_id).toBeTruthy()
      const revokeResult = await service
        .from('admin_sessions')
        .update({
          revoke_reason: 'phase728b_e2e_revoke',
          revoked_at: new Date().toISOString(),
        })
        .eq('id', bindingResult.data?.admin_session_id ?? '')
      expect(revokeResult.error).toBeNull()

      const postRevokeSnapshot = await invokeDisplaySnapshot(displayPage, {
        displayToken: issued.displayToken,
        lectureSessionId: lecture.id,
      })
      expect(postRevokeSnapshot.status).toBe(200)
      expect(postRevokeSnapshot.body).toMatchObject({
        credentialExpired: true,
        ok: false,
      })
      expect(postRevokeSnapshot.body).not.toHaveProperty('result')
      const postRevokePdf = await invokeDisplayPdf(displayPage, {
        displayToken: issued.displayToken,
        lectureSessionId: lecture.id,
      })
      expect(postRevokePdf.status).toBe(200)
      expect(postRevokePdf.body).toMatchObject({
        credentialExpired: true,
        ok: false,
      })
      expect(postRevokePdf.body).not.toHaveProperty('accessToken')
    } finally {
      const enabled = await service.rpc('set_display_realtime_runtime_v1', {
        target_enabled: true,
      })
      expect(enabled.error).toBeNull()
    }
    await studentContext.close()

    // The regression intentionally revokes the issuing Google Admin session.
    // Replacement issuance is covered by the separate Google-session fixture;
    // this browser must now remain unable to elevate or resume operations.
    await adminPage.goto('/admin')
    await expect(
      adminPage.getByRole('heading', { name: '教員としてログイン' }),
    ).toBeVisible()
    await expect(adminPage.locator('.admin-workflow')).toHaveCount(0)

    await displaySafety.assertClean()
    await adminSafety.assertClean()
  } finally {
    if (displayContext) await displayContext.close()
    await adminContext.close()
  }
})
