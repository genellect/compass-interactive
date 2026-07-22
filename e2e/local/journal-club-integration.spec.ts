import { expect, test } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'
import type { Database } from '../../src/types/database.js'
import { installBrowserSafetyMonitor } from '../helpers/browserSafety.js'

const adminPin = process.env.TEST_ADMIN_PIN?.trim() ?? ''
const supabaseUrl = process.env.TEST_SUPABASE_URL?.trim() ?? ''
const serviceRoleKey = process.env.TEST_SUPABASE_SERVICE_ROLE_KEY?.trim() ?? ''
const eventKey = 'journal-club-2026-07-23'
const canonicalPdfSha256 =
  '8c6903527b050c1db5f6b13b24bcf9108950bf8248a80205b10be6a9c63d7842'

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
  page,
}) => {
  const service = createLocalServiceClient()
  const safety = await installBrowserSafetyMonitor(page)
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
  await safety.assertClean()
})
