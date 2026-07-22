import { expect, test, type Locator, type Page } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'
import type { Database } from '../../src/types/database.js'
import { installBrowserSafetyMonitor } from '../helpers/browserSafety.js'

const adminPin = process.env.TEST_ADMIN_PIN?.trim() ?? ''
const supabaseUrl = process.env.TEST_SUPABASE_URL?.trim() ?? ''
const serviceRoleKey = process.env.TEST_SUPABASE_SERVICE_ROLE_KEY?.trim() ?? ''
const eventKey = 'journal-club-2026-07-23'
const canonicalPdfSha256 =
  '8c6903527b050c1db5f6b13b24bcf9108950bf8248a80205b10be6a9c63d7842'
const journalClubPollQuestions = [
  'QUIZ1: C9orf72リピートはどの方向に転写される？',
  'QUIZ2: CasRxが直接切断する分子はどれ？',
  'QUIZ3: gRNAをリピート隣接領域に設計する利点は？',
  'FINAL QUIZ: この研究から直接結論できないものはどれ？',
  '今回の発表を通して、説明・文献の内容をどの程度理解できましたか？',
  'COMPASS Interactiveは、今回の発表内容の理解や議論への参加に役立ちましたか？',
] as const

async function installLocalPdfDeliveryMock(page: Page) {
  const corsHeaders = {
    'access-control-allow-headers': 'authorization, content-type, apikey',
    'access-control-allow-methods': 'GET, OPTIONS, POST',
    'access-control-allow-origin': '*',
  }
  const expiresAt = new Date(Date.now() + 5 * 60_000).toISOString()
  const lecturePublicId = 'lecture_local_journal_club'

  await page.route('**/functions/v1/issue-pdf-access-token', async (route) => {
    if (route.request().method() === 'OPTIONS') {
      await route.fulfill({ headers: corsHeaders, status: 204 })
      return
    }
    await route.fulfill({
      body: JSON.stringify({
        accessToken: 'local-journal-club-pdf-token',
        expiresAt,
        lecturePublicId,
        manifestVersion: 1,
        ok: true,
        workerBaseUrl: 'http://127.0.0.1:8787',
      }),
      contentType: 'application/json',
      headers: corsHeaders,
      status: 200,
    })
  })

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
              byte_size: 5_816_208,
              delete_after: null,
              display_name: '260723 JournalClub Presentation.pdf',
              document_id: 'journal-club-2026-07-23-v1',
              document_version: canonicalPdfSha256,
              download_enabled: true,
              page_count: 34,
              text_char_count: 10_000,
              visible: true,
            },
          ],
          lecture_public_id: lecturePublicId,
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
          url: `${process.env.PLAYWRIGHT_BASE_URL}/lecture-assets/m4-sample-v1.pdf`,
        }),
        contentType: 'application/json',
        headers: corsHeaders,
        status: 200,
      })
    },
  )

  await page.route(
    'http://127.0.0.1:8787/v1/archives/resolve',
    async (route) => {
      if (route.request().method() === 'OPTIONS') {
        await route.fulfill({ headers: corsHeaders, status: 204 })
        return
      }
      await route.fulfill({
        body: JSON.stringify({
          message: 'No local archive fixture.',
          ok: false,
        }),
        contentType: 'application/json',
        headers: corsHeaders,
        status: 200,
      })
    },
  )
}

function createLocalServiceClient() {
  expect(adminPin, 'TEST_ADMIN_PIN must match the local Edge env.').not.toBe('')
  expect(supabaseUrl, 'TEST_SUPABASE_URL is required.').not.toBe('')
  expect(
    serviceRoleKey,
    'TEST_SUPABASE_SERVICE_ROLE_KEY is required.',
  ).not.toBe('')

  const parsedUrl = new URL(supabaseUrl)
  expect(
    ['127.0.0.1', 'localhost'],
    'The Journal Club integration test refuses Hosted Supabase.',
  ).toContain(parsedUrl.hostname)

  return createClient<Database>(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

test('prepares isolated Journal Club rehearsal and production drafts through real Edge and database', async ({
  browser,
  page,
}) => {
  test.setTimeout(180_000)

  const service = createLocalServiceClient()
  const safety = await installBrowserSafetyMonitor(page)
  await installLocalPdfDeliveryMock(page)
  const functionCalls: Array<{ action: string; name: string }> = []

  page.on('request', (request) => {
    const match = /\/functions\/v1\/([^/?]+)/.exec(request.url())
    if (!match || request.method() !== 'POST') return
    let action = ''
    try {
      action = String(
        (request.postDataJSON() as { action?: unknown }).action ?? '',
      )
    } catch {
      // A bodyless call cannot be mistaken for a paid action.
    }
    functionCalls.push({ action, name: match[1] })
  })

  const initialRuns = await service
    .from('phase727_journal_club_runs')
    .select('lecture_session_id', { count: 'exact', head: true })
    .eq('event_key', eventKey)
  expect(initialRuns.error).toBeNull()
  expect(
    initialRuns.count,
    'This test requires a clean local reset so production cannot be duplicated.',
  ).toBe(0)

  await page.goto('/admin')
  await page.getByLabel('管理PIN').fill(adminPin)
  await page.getByRole('button', { name: '講義コントロールを開く' }).click()
  await expect(
    page.getByRole('heading', { name: '講義を準備する' }),
  ).toBeVisible()
  await page.getByRole('button', { name: 'セッション管理' }).click()

  const preset = page.locator('.journal-club-preset')
  await expect(preset).toBeVisible()
  await expect(preset).toContainText('Dual-targeting CasRx for C9orf72 ALS/FTD')

  await preset.getByRole('button', { name: 'リハーサルを一覧に追加' }).click()
  await expect(preset.getByRole('status')).toContainText(
    'リハーサルを講義一覧に追加しました。',
  )
  await expect(page.locator('.poll-admin-row')).toHaveCount(6)
  await expect(page.locator('.poll-admin-row .status-pill.draft')).toHaveCount(
    6,
  )

  page.once('dialog', async (dialog) => {
    expect(dialog.message()).toContain('講義と投票はまだ開始されません。')
    await dialog.accept()
  })
  await preset.getByRole('button', { name: '7/23 本番を一覧に追加' }).click()
  await expect(preset.getByRole('status')).toContainText(
    '本番を講義一覧に追加しました。',
  )
  await expect(
    preset.getByRole('button', { name: '本番は準備済み' }),
  ).toBeDisabled()
  await expect(page.locator('.poll-admin-row')).toHaveCount(6)
  await expect(page.locator('.poll-admin-row .status-pill.draft')).toHaveCount(
    6,
  )

  const rows = page
    .locator('.lecture-admin-row')
    .filter({ hasText: 'Dual-targeting CasRx for C9orf72 ALS/FTD' })
  await expect(rows).toHaveCount(2)
  const visibleCodes = await rows.locator('code').allTextContents()
  expect(visibleCodes).toHaveLength(2)
  expect(visibleCodes.every((code) => /^\d{6}$/.test(code.trim()))).toBe(true)
  expect(new Set(visibleCodes.map((code) => code.trim())).size).toBe(2)

  const runsResult = await service
    .from('phase727_journal_club_runs')
    .select(
      'lecture_session_id,run_kind,expected_document_id,expected_pdf_sha256,expected_pdf_byte_size,expected_pdf_page_count',
    )
    .eq('event_key', eventKey)
    .order('created_at', { ascending: true })
  expect(runsResult.error).toBeNull()
  const runs = runsResult.data ?? []
  expect(runs).toHaveLength(2)
  expect(runs.map((run) => run.run_kind)).toEqual(['rehearsal', 'production'])
  expect(new Set(runs.map((run) => run.lecture_session_id)).size).toBe(2)
  for (const run of runs) {
    expect(run).toMatchObject({
      expected_document_id: 'journal-club-2026-07-23-v1',
      expected_pdf_byte_size: 5_816_208,
      expected_pdf_page_count: 34,
      expected_pdf_sha256:
        '8c6903527b050c1db5f6b13b24bcf9108950bf8248a80205b10be6a9c63d7842',
    })
  }

  const lectureIds = runs.map((run) => run.lecture_session_id)
  const lecturesResult = await service
    .from('lecture_sessions')
    .select('id,status')
    .in('id', lectureIds)
  expect(lecturesResult.error).toBeNull()
  expect(lecturesResult.data).toHaveLength(2)
  expect(
    lecturesResult.data?.every((lecture) => lecture.status === 'draft'),
  ).toBe(true)

  const slotsResult = await service
    .from('phase727_journal_club_poll_slots')
    .select('lecture_session_id,poll_id,display_order')
    .in('lecture_session_id', lectureIds)
    .order('display_order', { ascending: true })
  expect(slotsResult.error).toBeNull()
  expect(slotsResult.data).toHaveLength(12)
  for (const lectureId of lectureIds) {
    expect(
      slotsResult.data
        ?.filter((slot) => slot.lecture_session_id === lectureId)
        .map((slot) => slot.display_order),
    ).toEqual([1, 2, 3, 4, 5, 6])
  }

  const pollsResult = await service
    .from('polls')
    .select('id,lecture_session_id,status')
    .in('lecture_session_id', lectureIds)
  expect(pollsResult.error).toBeNull()
  expect(pollsResult.data).toHaveLength(12)
  expect(pollsResult.data?.every((poll) => poll.status === 'draft')).toBe(true)

  for (const table of [
    'ai_usage_ledger',
    'lecture_pdf_documents',
    'lecture_pdf_publications',
  ] as const) {
    const result = await service
      .from(table)
      .select('*', { count: 'exact', head: true })
      .in('lecture_session_id', lectureIds)
    expect(result.error).toBeNull()
    expect(result.count, `${table} must remain empty after preparation.`).toBe(
      0,
    )
  }

  expect(
    functionCalls.filter(
      ({ action, name }) =>
        /authorize-ai|caption|generate-lecture-summary|material/i.test(name) ||
        (name === 'generate-academic-answer' &&
          ['generate', 'generateAuto'].includes(action)),
    ),
  ).toEqual([])

  const rehearsal = runs.find((run) => run.run_kind === 'rehearsal')
  const production = runs.find((run) => run.run_kind === 'production')
  expect(rehearsal).toBeDefined()
  expect(production).toBeDefined()

  const rehearsalRow = rows.filter({ hasText: 'リハーサル' })
  const productionRow = rows.filter({ hasText: '本番' })
  await expect(rehearsalRow).toHaveCount(1)
  await expect(productionRow).toHaveCount(1)
  const rehearsalCode = (
    await rehearsalRow.locator('code').textContent()
  )?.trim()
  expect(rehearsalCode).toMatch(/^\d{6}$/)

  for (const [run, textSha256] of [
    [rehearsal, 'a'.repeat(64)],
    [production, 'b'.repeat(64)],
  ] as const) {
    const registration = await service.rpc('admin_register_pdf_document', {
      target_byte_size: 5_816_208,
      target_display_name: '260723 JournalClub Presentation.pdf',
      target_document_id: 'journal-club-2026-07-23-v1',
      target_document_version: canonicalPdfSha256,
      target_download_enabled: true,
      target_lecture_session_id: run!.lecture_session_id,
      target_manifest_version: 1,
      target_page_count: 34,
      target_pdf_sha256: canonicalPdfSha256,
      target_text_char_count: 10_000,
      target_text_sha256: textSha256,
    })
    expect(registration.error).toBeNull()
    const displayRegistration = await service.rpc(
      'admin_update_pdf_display_v3',
      {
        target_current_pdf_page: 1,
        target_display_mode: 'normal',
        target_lecture_session_id: run!.lecture_session_id,
        target_pdf_document_id: 'journal-club-2026-07-23-v1',
        target_pdf_document_version: canonicalPdfSha256,
        target_pdf_manifest_version: 1,
        target_pdf_page_count: 34,
        target_pdf_visible: true,
      },
    )
    expect(displayRegistration.error).toBeNull()
  }

  await rehearsalRow.getByRole('button', { name: '開始', exact: true }).click()
  await expect(rehearsalRow).toContainText('受付中')
  const rehearsalLifecycle = await service
    .from('lecture_sessions')
    .select('started_at,hard_stop_at,status')
    .eq('id', rehearsal!.lecture_session_id)
    .single()
  expect(rehearsalLifecycle.error).toBeNull()
  expect(rehearsalLifecycle.data?.status).toBe('open')
  expect(
    Date.parse(rehearsalLifecycle.data!.hard_stop_at!) -
      Date.parse(rehearsalLifecycle.data!.started_at!),
  ).toBe(90 * 60 * 1_000)
  await expect(page.locator('.poll-admin-row .status-pill.draft')).toHaveCount(
    6,
  )

  const pageController = page.getByLabel('講義資料のページ操作')
  await expect(pageController).toBeVisible()
  await expect(pageController).toContainText('1 / 34')
  await pageController.getByRole('button', { name: '次へ' }).click()
  await expect(pageController).toContainText('2 / 34')
  const pageTwoState = await service
    .from('lecture_live_state')
    .select('current_pdf_page,pdf_page_count,pdf_visible')
    .eq('lecture_session_id', rehearsal!.lecture_session_id)
    .single()
  expect(pageTwoState.error).toBeNull()
  expect(pageTwoState.data).toMatchObject({
    current_pdf_page: 2,
    pdf_page_count: 34,
    pdf_visible: true,
  })
  await pageController.getByRole('button', { name: '前へ' }).click()
  await expect(pageController).toContainText('1 / 34')

  const studentContext = await browser.newContext()
  const studentPage = await studentContext.newPage()
  const studentSafety = await installBrowserSafetyMonitor(studentPage)
  await installLocalPdfDeliveryMock(studentPage)
  try {
    await studentPage.goto('/join')
    await studentPage.getByLabel('講義コード').fill(rehearsalCode ?? '')
    await studentPage.getByRole('button', { name: '参加する' }).click()
    await expect(
      studentPage.getByRole('heading', {
        name: 'Dual-targeting CasRx for C9orf72 ALS/FTD',
      }),
    ).toBeVisible()

    let previousOpenPollRow: Locator | null = null
    for (const [index, question] of journalClubPollQuestions.entries()) {
      const adminPollRow = page
        .locator('.poll-admin-row')
        .filter({ hasText: question })
      await expect(adminPollRow).toHaveCount(1)
      await adminPollRow
        .getByRole('button', { name: '開始する', exact: true })
        .click()
      await expect(adminPollRow.locator('.status-pill.open')).toHaveText(
        '受付中',
      )
      if (previousOpenPollRow) {
        await expect(
          previousOpenPollRow.locator('.status-pill.closed'),
        ).toHaveText('締切')
        previousOpenPollRow = null
      }

      const studentPoll = studentPage
        .locator('.poll-card')
        .filter({ hasText: question })
      await expect(studentPoll).toBeVisible({ timeout: 20_000 })
      const firstChoice = studentPoll.locator('label.choice-row').first()
      await firstChoice.click()
      await expect(firstChoice.getByRole('radio')).toBeChecked()
      await studentPoll.getByRole('button', { name: 'この回答を送る' }).click()
      await expect(studentPoll.getByText('回答しました。')).toBeVisible()

      if (index === 0) {
        previousOpenPollRow = adminPollRow
        continue
      }
      await adminPollRow
        .getByRole('button', { name: '締め切る', exact: true })
        .click()
      await expect(adminPollRow.locator('.status-pill.closed')).toHaveText(
        '締切',
      )
    }

    await studentSafety.assertClean()
  } finally {
    await studentContext.close().catch(() => undefined)
  }

  const answeredPollTotals = await service
    .from('poll_option_totals')
    .select('poll_id,response_count')
    .eq('lecture_session_id', rehearsal!.lecture_session_id)
  expect(answeredPollTotals.error).toBeNull()
  expect(
    new Set(
      answeredPollTotals.data
        ?.filter((total) => total.response_count > 0)
        .map((total) => total.poll_id),
    ).size,
  ).toBe(6)
  expect(
    answeredPollTotals.data?.reduce(
      (sum, total) => sum + total.response_count,
      0,
    ),
  ).toBe(6)

  const rehearsalPollStates = await service
    .from('polls')
    .select('status')
    .eq('lecture_session_id', rehearsal!.lecture_session_id)
  expect(rehearsalPollStates.error).toBeNull()
  expect(rehearsalPollStates.data).toHaveLength(6)
  expect(
    rehearsalPollStates.data?.every((poll) => poll.status === 'closed'),
  ).toBe(true)

  page.once('dialog', (dialog) => dialog.accept())
  await rehearsalRow.getByRole('button', { name: '終了', exact: true }).click()
  await expect(rehearsalRow.locator('.status-pill.closed')).toHaveText('締切')
  const closedRehearsal = await service
    .from('lecture_sessions')
    .select('closed_at,status')
    .eq('id', rehearsal!.lecture_session_id)
    .single()
  expect(closedRehearsal.error).toBeNull()
  expect(closedRehearsal.data?.status).toBe('closed')
  expect(closedRehearsal.data?.closed_at).not.toBeNull()

  await productionRow.getByRole('button', { name: '開始', exact: true }).click()
  await expect(productionRow).toContainText('受付中')
  const productionLifecycle = await service
    .from('lecture_sessions')
    .select('started_at,hard_stop_at,status')
    .eq('id', production!.lecture_session_id)
    .single()
  expect(productionLifecycle.error).toBeNull()
  expect(productionLifecycle.data?.status).toBe('open')
  expect(
    Date.parse(productionLifecycle.data!.hard_stop_at!) -
      Date.parse(productionLifecycle.data!.started_at!),
  ).toBe(90 * 60 * 1_000)

  page.once('dialog', (dialog) => dialog.accept())
  await productionRow.getByRole('button', { name: '終了', exact: true }).click()
  await expect(productionRow.locator('.status-pill.closed')).toHaveText('締切')
  const closedProduction = await service
    .from('lecture_sessions')
    .select('closed_at,status')
    .eq('id', production!.lecture_session_id)
    .single()
  expect(closedProduction.error).toBeNull()
  expect(closedProduction.data?.status).toBe('closed')
  expect(closedProduction.data?.closed_at).not.toBeNull()
  const productionPollTotals = await service
    .from('poll_option_totals')
    .select('response_count')
    .eq('lecture_session_id', production!.lecture_session_id)
  expect(productionPollTotals.error).toBeNull()
  expect(
    productionPollTotals.data?.reduce(
      (sum, total) => sum + total.response_count,
      0,
    ),
  ).toBe(0)
  await safety.assertClean()
})
