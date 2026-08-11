import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (path) =>
  readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const functionBlock = (sql, qualifiedName) =>
  sql.match(
    new RegExp(
      `create (?:or replace )?function ${qualifiedName.replaceAll('.', '\\.')}` +
        `[\\s\\S]*?\\n\\$\\$;`,
    ),
  )?.[0] ?? ''

const migration = read(
  'supabase/migrations/20260811123000_phase7_30c2_operational_surfaces.sql',
)
const c2Foundation = read(
  'supabase/migrations/20260811012111_phase7_30c2_unified_admin_authorization.sql',
)
const issueDisplaySession = read(
  'supabase/functions/issue-display-session/index.ts',
)
const claimDisplayRealtimeSession = read(
  'supabase/functions/claim-display-realtime-session/index.ts',
)
const issuePdfAccessToken = read(
  'supabase/functions/issue-pdf-access-token/index.ts',
)
const operatorLiveSnapshot = read(
  'supabase/functions/operator-live-snapshot/index.ts',
)
const managePresenterConnection = read(
  'supabase/functions/manage-presenter-connection/index.ts',
)
const managePdfPublications = read(
  'supabase/functions/manage-pdf-publications/index.ts',
)
const googlePdfHandler = managePdfPublications.slice(
  managePdfPublications.indexOf('async function handleGooglePdfPublication'),
  managePdfPublications.indexOf('\nDeno.serve'),
)
const displayToken = read('supabase/functions/_shared/displayToken.ts')
const pdfPublicationToken = read(
  'supabase/functions/_shared/pdfPublicationToken.ts',
)
const presenterToken = read('supabase/functions/_shared/presenterToken.ts')
const pdfWorker = read('cloudflare/asset-worker/src/pdfPublication.ts')
const databaseTypes = read('src/types/database.ts')
const pgTap = read('supabase/tests/phase7_30c2_operational_surfaces_test.sql')

assert.match(
  c2Foundation,
  /'issue-display-session\.issue'[^\n]*'owned_lecture'[^\n]*'open'[^\n]*'required'[^\n]*'write'/,
  'Display issuance remains a closed, owned-lecture C2 operation',
)

assert.match(migration, /create table private\.admin_google_display_sessions/)
assert.match(
  migration,
  /alter table private\.admin_google_display_sessions enable row level security;[\s\S]*revoke all on private\.admin_google_display_sessions[\s\S]*from public, anon, authenticated, service_role/,
)
assert.match(
  migration,
  /admin_google_display_sessions_lecture_idx[\s\S]*admin_google_display_sessions_admin_idx/,
)
const displayVerificationSql = functionBlock(
  migration,
  'private.verify_and_claim_google_display_session_v1',
)
assert.match(
  displayVerificationSql,
  /from private\.admin_google_display_sessions[\s\S]*from private\.display_realtime_runtime_gate[\s\S]*for share[\s\S]*from private\.admin_principals[\s\S]*for share[\s\S]*from private\.admin_environment_memberships[\s\S]*for share[\s\S]*from private\.admin_environments[\s\S]*for share[\s\S]*from public\.admin_sessions[\s\S]*for share[\s\S]*from auth\.sessions[\s\S]*for key share[\s\S]*current_verified_totp_factor_set_snapshot_v1[\s\S]*from public\.lecture_sessions[\s\S]*for share[\s\S]*from public\.display_realtime_sessions[\s\S]*for update[\s\S]*from private\.admin_google_display_sessions[\s\S]*for update/,
  'Display consumers lock runtime gate, identity context, lecture, Realtime row, then root binding in canonical order',
)
assert.match(
  displayVerificationSql,
  /approved_totp_factor_set_hash[\s\S]*approved_totp_factor_count[\s\S]*verified_totp_factor_set_hash/,
  'Display use is bound to the current approved and live TOTP factor set',
)
assert.match(
  displayVerificationSql,
  /claimed_by_other[\s\S]*update private\.admin_google_display_sessions[\s\S]*display_auth_user_id = target_display_auth_user_id/,
)
assert.match(
  migration,
  /revoke all on function public\.verify_and_claim_google_display_session_v1[\s\S]*from public, anon, authenticated;[\s\S]*grant execute on function public\.verify_and_claim_google_display_session_v1[\s\S]*to service_role/,
)

const issueSql = functionBlock(
  migration,
  'private.issue_google_admin_display_session_v1',
)
assert.ok(issueSql, 'missing transaction-authoritative Display facade')
const serialize = issueSql.indexOf('serialize_admin_ai_request_v1')
const displayGate = issueSql.indexOf(
  'from private.display_realtime_runtime_gate as gate',
)
const context = issueSql.indexOf('require_google_admin_operation_context_v1')
const intent = issueSql.indexOf('google_admin_operation_intent_digest_v1')
const receipt = issueSql.indexOf(
  'from private.admin_google_operation_receipts as receipt',
)
const operationGate = issueSql.indexOf('assert_google_admin_operation_gate_v1')
const lifecycle = issueSql.indexOf(
  'assert_google_admin_operation_lecture_state_v1',
)
const lecture = issueSql.lastIndexOf('from public.lecture_sessions as lecture')
const displayMutation = issueSql.indexOf(
  'insert into public.display_realtime_sessions',
)
const rootBinding = issueSql.indexOf(
  'insert into private.admin_google_display_sessions',
)
const evidence = issueSql.indexOf(
  'insert into private.admin_google_operation_receipts',
)
assert.ok(
  serialize >= 0 &&
    serialize < displayGate &&
    displayGate < context &&
    context < intent &&
    intent < receipt &&
    receipt < operationGate &&
    operationGate < lifecycle &&
    lifecycle < lecture &&
    lecture < displayMutation &&
    displayMutation < rootBinding &&
    rootBinding < evidence,
  'issuance order is request -> Display gate -> Google context -> receipt -> lifecycle -> lecture -> optional realtime -> root binding -> evidence',
)
assert.match(
  issueSql.slice(displayGate, context),
  /for update/,
  'Display gate is acquired before the canonical Admin-session lock chain',
)
assert.match(
  issueSql.slice(receipt, operationGate),
  /return[\s\S]*idempotentReplay/,
  'exact replay converges before operational gates and lifecycle',
)
assert.match(
  issueSql,
  /target_request_id::text[\s\S]*token_jti_hash_value := encode\([\s\S]*extensions\.digest/,
  'request UUID deterministically binds the hash-at-rest Display JTI',
)
assert.match(
  issueSql,
  /least\([\s\S]*95 \* 60[\s\S]*lecture_row\.hard_stop_at[\s\S]*context_value ->> 'expires_at'/,
  'Display token is bounded by TTL, lecture hard stop and Google Admin session',
)
assert.match(
  issueSql,
  /where session\.lecture_session_id = target_lecture_session_id[\s\S]*session_replaced[\s\S]*insert into public\.display_realtime_sessions/,
  'one active realtime binding is replaced atomically',
)
assert.match(
  issueSql,
  /end if;[\s\S]*insert into private\.admin_google_display_sessions[\s\S]*target_enable_realtime/,
  'snapshot-only and realtime tokens both receive a root binding',
)
assert.doesNotMatch(
  issueSql.match(
    /insert into private\.admin_google_operation_receipts[\s\S]*?\);/,
  )?.[0] ?? '',
  /bearer|authorization|raw|secret|pin|totp|credential/i,
)
assert.match(
  migration,
  /revoke all on function private\.issue_google_admin_display_session_v1[\s\S]*from public, anon, authenticated, service_role/,
)
assert.match(
  migration,
  /revoke all on function public\.issue_google_admin_display_session_v1[\s\S]*from public, anon, authenticated;[\s\S]*grant execute on function public\.issue_google_admin_display_session_v1[\s\S]*to service_role/,
)

assert.match(displayToken, /export async function createBoundDisplayToken/)
assert.match(
  displayToken,
  /createDisplayTokenForClaims\([\s\S]*issuedAt[\s\S]*expiresAt[\s\S]*jti[\s\S]*expiresAt > issuedAt \+ MAX_TOKEN_TTL_SECONDS/,
)
assert.match(issueDisplaySession, /hasGoogleCredential === hasLegacyCredential/)
assert.match(issueDisplaySession, /verifyGoogleAdminOperationRequest/)
assert.match(issueDisplaySession, /issue_google_admin_display_session_v1/)
assert.match(issueDisplaySession, /target_request_id: body\.requestId/)
assert.match(
  issueDisplaySession,
  /PHASE728_DISPLAY_REALTIME_ENABLED[\s\S]*target_enable_realtime: enableRealtime/,
)
assert.match(
  issueDisplaySession,
  /createBoundDisplayToken\([\s\S]*body\.requestId!/,
  'lost-response retry recreates the same signed Display capability',
)
assert.match(
  issueDisplaySession,
  /display_session_refresh_required/,
  'an expired receipt asks for a fresh issuance instead of minting from stale evidence',
)
assert.match(issueDisplaySession, /getAdminTokenClaims/)
assert.match(issueDisplaySession, /register_display_realtime_session_v1/)
for (const consumer of [operatorLiveSnapshot, issuePdfAccessToken]) {
  assert.match(consumer, /verify_and_claim_google_display_session_v1/)
  assert.match(consumer, /googleDisplayBinding\?\.recognized !== true/)
  assert.match(consumer, /claimed_by_other/)
}
assert.match(
  claimDisplayRealtimeSession,
  /verify_and_claim_google_display_session_v1[\s\S]*googleBinding\?\.recognized === true[\s\S]*googleBinding\.realtimeAvailable !== true[\s\S]*googleBinding\?\.recognized !== true[\s\S]*claim_display_realtime_session_v1/,
  'Google Display Realtime claims use the atomic root/public facade and never fall through to the legacy claim',
)

const presenterSql = functionBlock(
  migration,
  'private.manage_google_admin_presenter_connection_v1',
)
assert.ok(presenterSql, 'missing transaction-authoritative Presenter facade')
const presenterSerialize = presenterSql.indexOf('serialize_admin_ai_request_v1')
const presenterGate = presenterSql.indexOf(
  'from private.presenter_runtime_gate as gate',
)
const presenterContext = presenterSql.indexOf(
  'require_google_admin_operation_context_v1',
)
const presenterReceipt = presenterSql.indexOf(
  'from private.admin_google_operation_receipts as receipt',
)
const presenterLive = presenterSql.indexOf(
  'from public.lecture_live_state as live',
)
const presenterConnection = presenterSql.indexOf(
  'from public.presenter_connections as connection',
  presenterLive,
)
assert.ok(
  presenterSerialize >= 0 &&
    presenterSerialize < presenterGate &&
    presenterGate < presenterContext &&
    presenterContext < presenterReceipt &&
    presenterReceipt < presenterLive &&
    presenterLive < presenterConnection,
  'Presenter mutations lock request -> Presenter gate -> Google context/lecture -> receipt -> live -> connection',
)
assert.match(
  presenterSql.slice(
    presenterReceipt,
    presenterSql.indexOf("if target_action = 'status'", presenterReceipt),
  ),
  /idempotentReplay/,
  'Presenter exact replay resolves before admission gates and domain mutation',
)
assert.match(
  presenterSql,
  /target_action in \('issue', 'confirm'\)[\s\S]*not presenter_gate\.enabled[\s\S]*not target_presenter_transport_enabled/,
  'only issue and confirm require Presenter admission to remain enabled',
)
assert.match(
  presenterSql,
  /target_action = 'status'[\s\S]*runtime_enabled := presenter_gate\.enabled[\s\S]*target_presenter_transport_enabled[\s\S]*target_transport_enabled/,
  'status is callable while disabled and reports the effective runtime state',
)
assert.match(
  presenterSql,
  /pairing_issued_epoch := floor[\s\S]*to_timestamp\(pairing_issued_epoch \+ 55\)[\s\S]*target_request_id,[\s\S]*target_ticket_jti_hash,[\s\S]*target_manual_code_hmac/,
  'Presenter issue persists deterministic request output with DB-authoritative times',
)
assert.doesNotMatch(
  presenterSql.match(
    /insert into private\.admin_google_operation_receipts[\s\S]*?\);/,
  )?.[0] ?? '',
  /manualCode|pairingTicket|ticketJti|bearer|secret|authorization/,
  'Presenter immutable evidence stores no raw pairing credential',
)
assert.match(
  migration,
  /revoke all on function private\.manage_google_admin_presenter_connection_v1[\s\S]*from public, anon, authenticated, service_role[\s\S]*revoke all on function public\.manage_google_admin_presenter_connection_v1[\s\S]*from public, anon, authenticated;[\s\S]*grant execute on function public\.manage_google_admin_presenter_connection_v1[\s\S]*to service_role/,
)

assert.match(presenterToken, /export async function derivePresenterManualCode/)
assert.match(
  presenterToken,
  /MANUAL_CODE_ALPHABET[\s\S]*presenter-manual-output[\s\S]*Array\.from\(\{ length: 8 \}/,
)
assert.match(
  managePresenterConnection,
  /hasLegacyCredential === hasGoogleCredential/,
)
assert.match(managePresenterConnection, /verifyGoogleAdminOperationRequest/)
assert.match(
  managePresenterConnection,
  /const requestRequired = body\.action !== 'status'[\s\S]*requestId is required/,
)
assert.match(
  managePresenterConnection,
  /ticketJti = body\.requestId![\s\S]*derivePresenterManualCode\([\s\S]*const \{ data, error, unavailable \} = await rpc\([\s\S]*manage_google_admin_presenter_connection_v1/,
  'Google Presenter output is recoverable from one stable request UUID',
)
assert.match(
  managePresenterConnection,
  /if \(hasGoogleCredential\)[\s\S]*manage_google_admin_presenter_connection_v1[\s\S]*if \(Deno\.env\.get\('PHASE729_POWERPOINT_SYNC_ENABLED'\) !== 'true'\)/,
  'Google status/revoke reach the DB facade before the legacy transport flag check',
)
assert.match(managePresenterConnection, /issue_presenter_connection_v2/)
assert.match(managePresenterConnection, /get_presenter_connection_status_v1/)

assert.match(
  databaseTypes,
  /issue_google_admin_display_session_v1: \{[\s\S]*target_enable_realtime: boolean[\s\S]*target_request_id: string[\s\S]*target_transport_enabled: boolean[\s\S]*Returns: Json/,
)
assert.match(
  databaseTypes,
  /verify_and_claim_google_display_session_v1: \{[\s\S]*target_display_auth_user_id: string[\s\S]*target_token_jti_hash: string[\s\S]*Returns: Json/,
)
assert.match(
  databaseTypes,
  /manage_google_admin_presenter_connection_v1: \{[\s\S]*target_action: string[\s\S]*target_presenter_transport_enabled: boolean[\s\S]*target_ticket_jti_hash: string[\s\S]*Returns: Json/,
)
assert.match(
  pgTap,
  /default-OFF rejects new Google Display authority[\s\S]*lost-response replay converges after the operational gate is disabled[\s\S]*the same request cannot switch snapshot authority to Realtime/,
)
assert.match(
  pgTap,
  /the first Display browser atomically claims the live root binding[\s\S]*a different browser cannot take over the claimed Display session[\s\S]*Admin-session revocation immediately invalidates its Display capability/,
)
assert.match(
  pgTap,
  /Google Admin can issue a Realtime Display binding without another MFA prompt[\s\S]*the unified verifier atomically claims the public and private Realtime bindings[\s\S]*the public Realtime binding records the claiming Display browser[\s\S]*the private Google root records the same Display browser/,
)
assert.match(
  pgTap,
  /disabling Realtime downgrades the one live Google Display binding[\s\S]*the same browser retains snapshot access while Realtime is disabled[\s\S]*reenabling Realtime does not silently resurrect a downgraded binding[\s\S]*a downgraded Realtime binding stays invalid after the gate is reenabled[\s\S]*replacement permanently invalidates the prior Google Display root/,
)
assert.match(
  pgTap,
  /Presenter admission remains default-OFF independently of C2 identity[\s\S]*Google Admin prepares Presenter pairing without another MFA prompt[\s\S]*Presenter receipt stores bounded identifiers and no raw pairing credential[\s\S]*lost Presenter issue response converges while admission is disabled/,
)
assert.match(
  pgTap,
  /Google Admin confirms the inspected Presenter connection atomically[\s\S]*Presenter status remains available and reports disabled admission[\s\S]*Presenter stop remains available while both admission flags are OFF/,
)

for (const table of [
  'admin_google_pdf_publication_bindings',
  'admin_google_pdf_publication_tickets',
  'admin_google_pdf_publication_continuations',
]) {
  assert.match(migration, new RegExp(`create table private\\.${table}`))
  assert.match(
    migration,
    new RegExp(
      `alter table private\\.${table}[\\s\\S]*enable row level security;[\\s\\S]*` +
        `revoke all on private\\.${table}[\\s\\S]*from public, anon, authenticated, service_role`,
    ),
  )
  assert.match(
    migration,
    new RegExp(
      `${table}_append_only[\\s\\S]*reject_admin_c1_evidence_mutation_v1`,
    ),
  )
}

const pdfIssueSql = functionBlock(
  migration,
  'private.issue_google_admin_pdf_publication_ticket_v1',
)
const pdfPrepareSql = functionBlock(
  migration,
  'private.prepare_google_admin_pdf_publication_finalize_v1',
)
const pdfAdvanceSql = functionBlock(
  migration,
  'private.advance_google_admin_pdf_publication_v1',
)
const pdfAbortSql = functionBlock(
  migration,
  'private.abort_google_admin_pdf_publication_v1',
)
for (const [label, block] of [
  ['issue', pdfIssueSql],
  ['prepare', pdfPrepareSql],
  ['advance', pdfAdvanceSql],
  ['abort', pdfAbortSql],
]) {
  assert.ok(block, `missing C2 PDF ${label} facade`)
}
assert.match(
  pdfIssueSql,
  /serialize_admin_ai_request_v1[\s\S]*require_google_admin_operation_context_v1[\s\S]*from private\.admin_google_operation_receipts[\s\S]*assert_google_admin_operation_gate_v1[\s\S]*assert_google_admin_operation_lecture_state_v1[\s\S]*from public\.lecture_pdf_publications[\s\S]*for update[\s\S]*insert into private\.admin_google_pdf_publication_tickets[\s\S]*insert into private\.admin_google_operation_receipts/,
  'PDF issue serializes request, rechecks Google context, resolves replay, gates new authority, mutates the publication and appends evidence in one transaction',
)
assert.match(
  pdfIssueSql,
  /publication_row\.document_id[\s\S]*publication_row\.allowed_origin[\s\S]*PDF ticket reissue metadata changed/,
  'explicit ticket reissue cannot change publication metadata',
)
assert.match(
  pdfPrepareSql,
  /from private\.admin_google_operation_receipts[\s\S]*idempotentReplay[\s\S]*assert_google_admin_operation_gate_v1[\s\S]*insert into private\.admin_google_pdf_publication_continuations/,
  'lost finalize authorization converges before admission checks while new authority remains gated',
)
assert.match(
  pdfPrepareSql,
  /if found then[\s\S]*assert_google_admin_operation_lecture_state_v1[\s\S]*build_pdf_publication_result_v1[\s\S]*idempotentReplay/,
  'finalize replay never becomes a stale retained-content read grant',
)
assert.match(
  pdfAdvanceSql,
  /require_google_admin_operation_context_v1[\s\S]*from private\.admin_google_operation_receipts[\s\S]*refreshRequired[\s\S]*assert_google_admin_operation_lecture_state_v1[\s\S]*from public\.lecture_pdf_publications[\s\S]*for update[\s\S]*from private\.admin_google_pdf_publication_continuations/,
  'every continuation stage rechecks live Google authority and locks lecture/publication before consuming immutable continuation evidence',
)
for (const [label, block] of [
  ['advance', pdfAdvanceSql],
  ['abort', pdfAbortSql],
]) {
  assert.doesNotMatch(
    block,
    /binding_row\.(?:admin_session_id|supabase_auth_session_id)/,
    `PDF ${label} preserves principal-owned recovery across a valid Admin/Auth session rotation`,
  )
}
assert.match(
  pdfAdvanceSql,
  /continuation_row\.admin_session_id[\s\S]*continuation_row\.supabase_auth_session_id/,
  'each PDF finalize continuation remains bound to the current recovery session',
)
assert.match(
  pdfAdvanceSql,
  /worker_record_pdf_publication_uploaded_v1[\s\S]*admin_prepare_pdf_publication_commit_v1[\s\S]*admin_complete_pdf_publication_commit_v1[\s\S]*admin_prepare_pdf_publication_activation_v1[\s\S]*admin_complete_pdf_publication_activation_v1/,
)
assert.match(
  pdfAbortSql,
  /from private\.admin_google_operation_receipts[\s\S]*idempotentReplay[\s\S]*assert_google_admin_operation_lecture_state_v1[\s\S]*admin_abort_pdf_publication_v1[\s\S]*insert into private\.admin_google_operation_receipts/,
  'abort is gate-independent, exactly replayable and terminalizes DB state before external cleanup',
)
for (const name of [
  'get_google_admin_pdf_publication_v1',
  'issue_google_admin_pdf_publication_ticket_v1',
  'prepare_google_admin_pdf_publication_finalize_v1',
  'advance_google_admin_pdf_publication_v1',
  'abort_google_admin_pdf_publication_v1',
]) {
  assert.match(
    migration,
    new RegExp(
      `revoke all on function private\\.${name}[\\s\\S]*from public, anon, authenticated, service_role`,
    ),
  )
  assert.match(
    migration,
    new RegExp(
      `revoke all on function public\\.${name}[\\s\\S]*from public, anon, authenticated;[\\s\\S]*` +
        `grant execute on function public\\.${name}[\\s\\S]*to service_role`,
    ),
  )
  assert.match(databaseTypes, new RegExp(`${name}: \\{[\\s\\S]*Returns: Json`))
}

assert.match(
  managePdfPublications,
  /hasLegacyCredential === hasGoogleCredential/,
)
assert.match(managePdfPublications, /verifyGoogleAdminOperationRequest/)
assert.match(
  managePdfPublications,
  /derivePdfPublicationNonce[\s\S]*derivePdfPublicationUuid[\s\S]*issue_google_admin_pdf_publication_ticket_v1/,
  'Google upload output is recoverable from stable ticket request evidence',
)
assert.match(managePdfPublications, /advance_google_admin_pdf_publication_v1/)
assert.match(
  managePdfPublications,
  /prepare_google_admin_pdf_publication_finalize_v1[\s\S]*await advance/,
  'Worker effects begin only after a bounded DB continuation is authorized',
)
assert.match(
  googlePdfHandler,
  /continuationTicketTimes\(continuationExpiresAt\)[\s\S]*purpose: 'status'[\s\S]*continuationTicketTimes\(continuationExpiresAt\)[\s\S]*purpose: 'commit'[\s\S]*continuationTicketTimes\(continuationExpiresAt\)[\s\S]*purpose: 'activate'/,
  'every finalize Worker capability is capped by the DB continuation deadline',
)
assert.match(
  managePdfPublications,
  /Math\.min\(now \+ 60, continuationExpiresAt\)[\s\S]*MIN_CONTINUATION_TICKET_SECONDS/,
  'the Edge refuses near-expiry continuation capabilities before Worker effects',
)
assert.match(
  managePdfPublications,
  /abort_google_admin_pdf_publication_v1[\s\S]*await callWorker\([\s\S]*rollback/,
  'DB abort precedes best-effort Worker rollback',
)
assert.match(
  managePdfPublications,
  /let cleanupPending[\s\S]*Number\.isInteger\(before\.committed_manifest_access_version\)[\s\S]*purpose: 'rollback'/,
  'an exact abort retry can resume Worker rollback after the DB row is already terminal',
)
assert.doesNotMatch(
  managePdfPublications,
  /before\.state === 'committed'[\s\S]{0,160}committed_manifest_access_version/,
  'Worker rollback recovery is not limited to the pre-abort committed state',
)
assert.match(
  managePdfPublications,
  /if \(hasGoogleCredential\)[\s\S]*handleGooglePdfPublication[\s\S]*PHASE726_BROWSER_PDF_PUBLICATION_ENABLED/,
  'Google read/abort/continuation routes are not hidden behind the legacy transport switch',
)
assert.match(pdfPublicationToken, /derivePdfPublicationNonce/)
assert.match(pdfPublicationToken, /derivePdfPublicationUuid/)
assert.match(
  pdfWorker,
  /PHASE726_BROWSER_PDF_UPLOAD_ENABLED !== 'true' &&[\s\S]*operation === 'upload'/,
  'runtime disable blocks only new upload effects while bounded continuation and rollback can converge',
)
assert.match(
  pgTap,
  /default-OFF rejects new Google PDF upload authority[\s\S]*Google Admin creates one provenance-bound PDF upload without another MFA prompt[\s\S]*lost PDF ticket response converges while new admission is disabled/,
)
assert.match(
  pgTap,
  /disabled admission rejects a new PDF finalize continuation[\s\S]*Google Admin authorizes one bounded PDF finalize continuation[\s\S]*lost finalize authorization converges after admission is disabled/,
)
assert.match(
  pgTap,
  /PDF creation provenance remains bound to the original Admin session[\s\S]*same principal can recover PDF finalization in a new live session[\s\S]*PDF cancel remains available while admission is disabled/,
  'PDF recovery covers a live same-principal session rotation without weakening immutable ownership',
)
assert.match(
  pgTap,
  /PDF cancel remains available while admission is disabled[\s\S]*lost PDF cancel response converges without reactivating admission[\s\S]*PDF receipts contain no raw ticket, nonce, URL, ETag or document content/,
)

console.log('Phase 7.30C2 operational static checks passed.')
