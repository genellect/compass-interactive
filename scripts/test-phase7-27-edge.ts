import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const read = (path: string) =>
  readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

const manageLectures = read('supabase/functions/manage-lectures/index.ts')
const managePolls = read('supabase/functions/manage-polls/index.ts')

function journalClubBranch(source: string) {
  const start = source.indexOf("if (body.action === 'createJournalClubRun')")
  const end = source.indexOf("if (body.action === 'duplicate')", start)
  assert.ok(start >= 0 && end > start)
  return source.slice(start, end)
}

test('Journal Club Edge action is behind Google Admin auth and two default-off server flags', () => {
  const branch = journalClubBranch(manageLectures)
  const credentialBoundary = manageLectures.indexOf('hasLegacyAdminFields(body)')
  const googleVerification = manageLectures.indexOf(
    'verifyGoogleAdminOperationRequest',
    credentialBoundary,
  )
  const action = manageLectures.indexOf(
    "if (body.action === 'createJournalClubRun')",
  )
  assert.ok(
    credentialBoundary >= 0 &&
      googleVerification > credentialBoundary &&
      action > googleVerification,
  )
  assert.match(
    branch,
    /Deno\.env\.get\('PHASE7_27_JOURNAL_CLUB_ENABLED'\) !== 'true'/,
  )
  assert.match(
    branch,
    /Deno\.env\.get\('PHASE7_28_JOURNAL_CLUB_PRESET_CREATION_ENABLED'\)\s*!==\s*'true'/,
  )
  assert.match(branch, /Journal Club preset creation is retired\./)
  assert.match(branch, /410/)
  assert.match(manageLectures, /UUID_PATTERN\.test\(requestId \?\? ''\)/)
  assert.match(branch, /\['production', 'rehearsal'\]\.includes/)
  assert.doesNotMatch(manageLectures, /getAdminTokenClaims|verifyAdminToken/)
})

test('Journal Club retirement rejects creation before mutation RPC work', () => {
  const branch = journalClubBranch(manageLectures)
  const retirementGuard = branch.indexOf(
    'PHASE7_28_JOURNAL_CLUB_PRESET_CREATION_ENABLED',
  )
  const creationRpc = branch.indexOf('createWithUniqueCode')

  assert.ok(retirementGuard >= 0)
  assert.ok(creationRpc > retirementGuard)
})

test('Journal Club action passes the verified Google identity to the typed facade', () => {
  const branch = journalClubBranch(manageLectures)
  assert.match(manageLectures, /target_auth_user_id: verification\.authUserId/)
  assert.match(manageLectures, /target_token_hash: verification\.appSessionTokenHash/)
  assert.match(manageLectures, /target_transport_enabled: verification\.transportEnabled/)
  assert.match(branch, /target_request_id: body\.clientRequestId/)
  assert.match(branch, /target_run_kind: body\.runKind/)
})

test('Journal Club creation delegates one atomic RPC and never starts billable or live work', () => {
  const branch = journalClubBranch(manageLectures)
  assert.match(branch, /createWithUniqueCode\('createJournalClubRun'/)
  assert.match(manageLectures, /manage_google_admin_lectures_v1/)
  assert.match(manageLectures, /error\.code === '23505'/)
  assert.match(manageLectures, /error\.code === 'P0001'/)
  assert.doesNotMatch(branch, /admin_set_lecture_status|start_lecture_core/)
  assert.doesNotMatch(
    branch,
    /OPENAI_API_KEY|create_pdf_publication|configure_lecture_ai_control|startMaterial|startSummary|startCaption/i,
  )
})

test('Journal Club metadata and Poll ordering stay inside typed Google facades', () => {
  assert.match(manageLectures, /manage_google_admin_lectures_v1/)
  assert.match(managePolls, /manage_google_admin_polls_v1/)
  assert.match(managePolls, /target_include_history: body\.includeHistory \?\? false/)
  assert.doesNotMatch(manageLectures, /\.from\('phase727_journal_club_runs'\)/)
  assert.doesNotMatch(managePolls, /\.from\('phase727_journal_club_poll_slots'\)/)
})
