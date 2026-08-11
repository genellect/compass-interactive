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

test('Journal Club Edge action is behind tracked Admin auth and two default-off server flags', () => {
  const branch = journalClubBranch(manageLectures)
  const credentialBoundary = manageLectures.indexOf(
    'if (hasGoogleCredential === hasLegacyCredential)',
  )
  const googleVerification = manageLectures.indexOf(
    'verifyGoogleAdminOperationRequest',
    credentialBoundary,
  )
  const legacyVerification = manageLectures.indexOf(
    'adminClaims = await getAdminTokenClaims',
    googleVerification,
  )
  const action = manageLectures.indexOf(
    "if (body.action === 'createJournalClubRun')",
  )
  assert.ok(
    credentialBoundary >= 0 &&
      googleVerification > credentialBoundary &&
      legacyVerification > googleVerification &&
      action > legacyVerification,
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
  assert.match(branch, /!googleRpcIdentity && !adminClaims\?\.sid/)
  assert.match(branch, /UUID_PATTERN\.test\(body\.clientRequestId\)/)
  assert.match(branch, /\['production', 'rehearsal'\]\.includes/)
})

test('Journal Club retirement rejects creation before auth-user lookup or RPC work', () => {
  const branch = journalClubBranch(manageLectures)
  const retirementGuard = branch.indexOf(
    'PHASE7_28_JOURNAL_CLUB_PRESET_CREATION_ENABLED',
  )
  const authUserLookup = branch.indexOf('await supabase.auth.getUser')
  const creationRpc = branch.indexOf(
    'admin_create_phase727_journal_club_run_v1',
  )

  assert.ok(retirementGuard >= 0)
  assert.ok(authUserLookup > retirementGuard)
  assert.ok(creationRpc > retirementGuard)
})

test('Journal Club Edge action binds the tracked token to the current Supabase user', () => {
  const branch = journalClubBranch(manageLectures)
  assert.match(branch, /request\.headers[\s\S]*?\.get\('Authorization'\)/)
  assert.match(branch, /await supabase\.auth\.getUser\(bearerToken\)/)
  assert.match(branch, /if \(authError \|\| !authData\.user\)/)
  assert.match(branch, /legacyAuthUserId = authData\.user\.id/)
  assert.match(branch, /target_admin_auth_user_id: legacyAuthUserId/)
  assert.match(branch, /target_admin_session_id: adminClaims!\.sid/)
  assert.match(branch, /target_client_request_id: body\.clientRequestId/)
  assert.match(branch, /target_run_kind: body\.runKind/)
  assert.match(branch, /error\.code === '42501'/)
})

test('Journal Club creation delegates one atomic RPC and never starts billable or live work', () => {
  const branch = journalClubBranch(manageLectures)
  assert.match(branch, /admin_create_phase727_journal_club_run_v1/)
  assert.match(branch, /manage_google_admin_lectures_v1/)
  assert.match(branch, /error\.code === '23505'/)
  assert.match(branch, /error\.code === 'P0001'/)
  assert.doesNotMatch(branch, /admin_set_lecture_status|start_lecture_core/)
  assert.doesNotMatch(
    branch,
    /OPENAI_API_KEY|create_pdf_publication|configure_lecture_ai_control|startMaterial|startSummary|startCaption/i,
  )
})

test('Journal Club metadata and Poll ordering add no query when the server flag is off', () => {
  const listStart = manageLectures.indexOf('async function listLectures')
  const createAction = manageLectures.indexOf("if (body.action === 'create')")
  const listBranch = manageLectures.slice(listStart, createAction)

  assert.match(
    manageLectures,
    /if \(Deno\.env\.get\('PHASE7_27_JOURNAL_CLUB_ENABLED'\) === 'true'\) \{[\s\S]*?\.from\('phase727_journal_club_runs'\)/,
  )
  assert.match(
    managePolls,
    /Deno\.env\.get\('PHASE7_27_JOURNAL_CLUB_ENABLED'\) === 'true'[\s\S]*?\.from\('phase727_journal_club_poll_slots'\)[\s\S]*?: Promise\.resolve\(\{ data: \[\], error: null \}\)/,
  )
  assert.match(
    managePolls,
    /templateOrder: templateOrderByPollId\.get\(poll\.id\) \?\? null/,
  )
  assert.match(managePolls, /return left\.templateOrder - right\.templateOrder/)
  assert.doesNotMatch(
    listBranch,
    /PHASE7_28_JOURNAL_CLUB_PRESET_CREATION_ENABLED/,
  )
})
