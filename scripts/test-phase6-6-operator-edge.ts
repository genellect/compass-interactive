import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import {
  createAdminToken,
  getAdminTokenClaims,
} from '../supabase/functions/_shared/adminToken.ts'
import {
  createDisplayToken,
  getDisplayTokenClaims,
  getDisplayTerminalTokenClaims,
} from '../supabase/functions/_shared/displayToken.ts'

const secret = 'phase66-test-secret-with-at-least-32-bytes'
const lectureId = '76600000-0000-4000-8000-000000000001'
const otherLectureId = '76600000-0000-4000-8000-000000000002'
const expiresAt = Math.floor(Date.now() / 1000) + 60

const displayToken = await createDisplayToken(lectureId, expiresAt, secret)
const displayClaims = await getDisplayTokenClaims(displayToken, secret)
assert.equal(displayClaims?.lectureSessionId, lectureId)
assert.equal(displayClaims?.scope, 'compass-display')
assert.equal(displayClaims?.aud, 'operator-live-snapshot')
assert.equal(displayClaims?.exp, expiresAt)
assert.equal(await getAdminTokenClaims(displayToken, secret), null)
assert.equal(
  await getDisplayTokenClaims(
    displayToken,
    'different-phase66-secret-with-at-least-32-bytes',
  ),
  null,
)

const realDateNow = Date.now
const terminalBaseMs = realDateNow()
Date.now = () => terminalBaseMs
const terminalToken = await createDisplayToken(
  lectureId,
  Math.floor(terminalBaseMs / 1000) + 60,
  secret,
)
Date.now = () => terminalBaseMs + 120_000
assert.equal(await getDisplayTokenClaims(terminalToken, secret), null)
assert.equal(
  (await getDisplayTerminalTokenClaims(terminalToken, secret))
    ?.lectureSessionId,
  lectureId,
)
Date.now = () => terminalBaseMs + 31 * 24 * 60 * 60 * 1000
assert.equal(await getDisplayTerminalTokenClaims(terminalToken, secret), null)
Date.now = realDateNow

const adminToken = await createAdminToken(secret)
assert.equal(await getDisplayTokenClaims(adminToken, secret), null)
assert.equal(
  await getDisplayTokenClaims(`${displayToken.slice(0, -1)}x`, secret),
  null,
)
await assert.rejects(
  createDisplayToken(
    otherLectureId,
    Math.floor(Date.now() / 1000) + 96 * 60,
    secret,
  ),
  /Invalid display session claims/,
)

const read = (path: string) =>
  readFile(new URL(`../${path}`, import.meta.url), 'utf8')
const [
  issueDisplay,
  operatorSnapshot,
  migration,
  config,
  adminRepository,
  liveRepository,
  liveStateMappers,
  context,
  issuePdfAccess,
  pdfDelivery,
] = await Promise.all([
  read('supabase/functions/issue-display-session/index.ts'),
  read('supabase/functions/operator-live-snapshot/index.ts'),
  read(
    'supabase/migrations/20260716140920_phase6_6_ux_archive_metrics_digest.sql',
  ),
  read('supabase/config.toml'),
  read('src/repositories/supabaseAdminRepository.ts'),
  read('src/repositories/supabaseLiveStateRepository.ts'),
  read('src/repositories/supabase/liveStateMappers.ts'),
  read('src/context/CompassStateContext.tsx'),
  read('supabase/functions/issue-pdf-access-token/index.ts'),
  read('src/pdf/pdfDelivery.ts'),
])

assert.match(issueDisplay, /getAdminTokenClaims/)
assert.match(
  issueDisplay,
  /getAdminTokenClaims\([\s\S]*?body\.adminToken[\s\S]*?adminSecret[\s\S]*?request/,
)
assert.match(issueDisplay, /admin_get_lecture_operator_access_v1/)
assert.match(issueDisplay, /access\.mode !== 'live'/)
assert.match(issueDisplay, /hardStopSeconds \+ 5 \* 60/)
assert.doesNotMatch(issueDisplay, /displayToken[\s\S]{0,80}console\./)

assert.match(operatorSnapshot, /Provide exactly one operator credential/)
assert.match(
  operatorSnapshot,
  /liveClaims\?\.lectureSessionId === body\.lectureSessionId/,
)
assert.match(operatorSnapshot, /include_hidden: credentialKind === 'admin'/)
assert.match(operatorSnapshot, /credentialKind !== 'admin'/)
assert.match(operatorSnapshot, /terminalOnly/)
assert.match(operatorSnapshot, /credentialExpired: true/)
assert.match(operatorSnapshot, /admin_get_lecture_operator_access_v1/)
assert.match(operatorSnapshot, /admin_get_lecture_operator_comment_history_v1/)
assert.match(operatorSnapshot, /Math\.min\(Math\.max\(body\.limit, 1\), 50\)/)
assert.match(operatorSnapshot, /comment_limit: 5/)
assert.doesNotMatch(operatorSnapshot, /VITE_|OPENAI_API_KEY/)

assert.match(issuePdfAccess, /getDisplayTokenClaims/)
assert.match(
  issuePdfAccess,
  /Provide exactly one credential for this PDF action/,
)
assert.match(
  issuePdfAccess,
  /displayClaims\?\.lectureSessionId !== body\.lectureSessionId/,
)
assert.match(issuePdfAccess, /admin_get_pdf_access_claims_v1/)
assert.match(issuePdfAccess, /getDisplayTerminalTokenClaims/)
assert.match(
  issuePdfAccess,
  /terminalOnly[\s\S]*?admin_get_lecture_operator_access_v1[\s\S]*?mode !== 'terminal'/,
)
assert.match(pdfDelivery, /\? 'display'\s*:\s*'member'/)
assert.match(
  pdfDelivery,
  /\.\.\.\(input\.displayToken \? \{ displayToken: input\.displayToken \} : \{\}\)/,
)

assert.match(migration, /add column hidden_comment_count bigint/)
assert.match(migration, /add column visible_comments_version bigint/)
assert.match(
  migration,
  /after insert or update or delete on public\.lecture_participant_presence/,
)
assert.match(
  migration,
  /create function public\.admin_get_lecture_operator_snapshot_v1/,
)
assert.match(
  migration,
  /create function public\.admin_get_lecture_operator_comment_history_v1/,
)
assert.match(migration, /private\.close_lecture_if_expired/)
assert.match(migration, /participant_count_mode', 'active_90s'/)
assert.match(migration, /private\.phase66_public_material_summary_json/)
assert.match(migration, /comment\.status in \('visible', 'hidden'\)/)
assert.match(migration, /from public\.comment_moderation_events as moderation/)
assert.match(migration, /force_initial_comments := true/)
assert.match(
  migration,
  /when include_hidden then live_row\.comments_version[\s\S]*?else live_row\.visible_comments_version/,
)
assert.match(migration, /'contract_version', 2/)
assert.match(
  migration,
  /grant execute on function public\.admin_get_lecture_operator_snapshot_v1\([\s\S]*?\) to service_role;/,
)
assert.doesNotMatch(
  migration,
  /grant execute on function public\.admin_get_lecture_operator_snapshot_v1\([^;]*?\)\s+to (?:anon|authenticated);/,
)

assert.match(config, /\[functions\.issue-display-session\]\s+verify_jwt = true/)
assert.match(
  config,
  /\[functions\.operator-live-snapshot\]\s+verify_jwt = true/,
)
assert.match(adminRepository, /async issueDisplaySession\(/)
assert.match(liveRepository, /async getOperatorSnapshot\(/)
assert.match(liveRepository, /async getOperatorCommentHistory\(/)
assert.match(liveRepository + liveStateMappers, /status: row\.status/)
assert.match(liveRepository, /hiddenCommentCount/)
assert.match(context, /commentCursor: commentCursorRef\.current/)

console.log(
  'Phase 6.6 operator display-token, snapshot, history, and privilege checks passed.',
)
