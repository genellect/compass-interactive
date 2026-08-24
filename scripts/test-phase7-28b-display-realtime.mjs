import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const read = (path) =>
  readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

const migration = read(
  'supabase/migrations/20260731110507_phase7_28b_authorized_display_realtime.sql',
)
const deliveryMigration = read(
  'supabase/migrations/20260825173000_final_display_delivery_ack.sql',
)
const captionResolutionMigration = read(
  'supabase/migrations/20260825180000_display_caption_topic_resolution.sql',
)
const issueSession = read('supabase/functions/issue-display-session/index.ts')
const claimSession = read(
  'supabase/functions/claim-display-realtime-session/index.ts',
)
const captionRelay = read(
  'supabase/functions/broadcast-display-caption/index.ts',
)
const operatorSnapshot = read(
  'supabase/functions/operator-live-snapshot/index.ts',
)
const pdfAccess = read('supabase/functions/issue-pdf-access-token/index.ts')
const displayClient = read('src/display/displayRealtime.ts')
const displaySessionStorage = read('src/display/displaySessionStorage.ts')
const displayStatus = read('supabase/functions/display-session-status/index.ts')
const displayPage = read('src/pages/DisplayPage.tsx')
const displayView = read('src/components/DisplayView/DisplayView.tsx')
const appCss = read('src/App.css')
const compassStateContext = read('src/context/CompassStateContext.tsx')
const displayLauncher = read('src/pages/admin/useAdminDisplayLauncher.ts')
const displayStatusHook = read('src/pages/admin/useAdminDisplayStatus.ts')
const displayMutationHook = read('src/pages/admin/useAdminDisplayMutation.ts')
const lecturePage = read('src/pages/LecturePage.tsx')
const displayRealtimeE2e = read(
  'e2e/local/display-realtime-integration.spec.ts',
)
const lockOrderRegression = read('scripts/test-phase7-28b-lock-order.mjs')
const localEnvironment = read('.env.local.example')
const supabaseConfig = read('supabase/config.toml')
const {
  advanceLiveStateVersions,
  getLiveSnapshotFreshness,
  mergeLiveStateVersions,
} = await import(new URL('../src/lib/liveSnapshot.ts', import.meta.url))
const {
  DISPLAY_LIVE_SYNC_INITIAL_JITTER_MS,
  DISPLAY_LIVE_SYNC_INTERVAL_MS,
  DISPLAY_LIVE_SYNC_JITTER_MS,
  getLiveSyncRouteOptions,
  STUDENT_LIVE_SYNC_INITIAL_JITTER_MS,
  STUDENT_LIVE_SYNC_INTERVAL_MS,
  STUDENT_LIVE_SYNC_JITTER_MS,
} = await import(new URL('../src/lib/liveSync.ts', import.meta.url))
const { getLatestPublicSummary } = await import(
  new URL('../src/display/displaySummary.ts', import.meta.url)
)

const liveVersions = (overrides = {}) => ({
  caption: 5,
  comments: 8,
  display: 4,
  lecture: 3,
  likes: 6,
  metrics: 2,
  pdf: 9,
  polls: 7,
  state: 11,
  summaries: 10,
  ...overrides,
})

test('migration uses supported private Broadcast authorization without modifying Supabase-owned Realtime objects', () => {
  assert.match(
    migration,
    /create policy "phase728 display can receive private broadcast"[\s\S]*?on realtime\.messages[\s\S]*?for select/,
  )
  assert.doesNotMatch(
    migration,
    /(?:create|alter|drop)\s+(?:table|function|schema|trigger|index)\s+(?:if\s+(?:not\s+)?exists\s+)?realtime\./i,
  )
  assert.doesNotMatch(
    migration,
    /create policy "phase728[^\n]+"[\s\S]{0,120}?for insert/i,
  )
  assert.match(migration, /realtime\.messages\.extension = 'broadcast'/)
  assert.match(migration, /\(select realtime\.topic\(\)\)/)
})

test('Display binding is private, atomically single-use and bounded to one active topic', () => {
  assert.match(
    migration,
    /alter table public\.display_realtime_sessions enable row level security/,
  )
  assert.match(
    migration,
    /revoke all on public\.display_realtime_sessions\s+from public, anon, authenticated/,
  )
  assert.match(
    migration,
    /create unique index display_realtime_sessions_one_active_per_lecture_idx[\s\S]*?where revoked_at is null/,
  )
  assert.match(migration, /pg_catalog\.pg_advisory_xact_lock/)
  assert.match(migration, /'session_replaced'/)
  assert.match(
    migration,
    /session\.revoked_at is null[\s\S]*?session\.revoke_reason = 'feature_disabled'[\s\S]*?coalesce\(revoked_at, effective_now\)[\s\S]*?revoke_reason = 'session_replaced'/,
    'a new binding must permanently fence runtime-downgraded predecessors',
  )
  assert.match(
    migration,
    /display_auth_user_id <> target_display_auth_user_id[\s\S]*?'claimed_by_other'/,
  )
  assert.match(migration, /token_jti_hash ~ '\^\[0-9a-f\]\{64\}\$'/)
  assert.match(
    migration,
    /create table private\.display_realtime_runtime_gate[\s\S]*?alter table private\.display_realtime_runtime_gate enable row level security/,
  )
  assert.match(
    migration,
    /create function public\.set_display_realtime_runtime_v1/,
  )
  assert.match(migration, /'feature_disabled'/)
  assert.match(
    migration,
    /order by coalesce\(session\.revoked_at, session\.expires_at\), session\.id[\s\S]*?limit 500[\s\S]*?for update skip locked/,
  )
  assert.match(
    migration,
    /select session\.\*[\s\S]*?from public\.admin_sessions[\s\S]*?for share;[\s\S]*?select lecture\.\*[\s\S]*?from public\.lecture_sessions[\s\S]*?for update;/,
  )
})

test('final Display root replacement is authoritative under the exact private row lock', () => {
  assert.match(
    deliveryMigration,
    /add column revoked_at timestamptz[\s\S]*?admin_google_display_sessions_revocation_pair_check/,
  )
  assert.match(
    deliveryMigration,
    /create unique index admin_google_display_sessions_one_live_lecture_idx[\s\S]*?where revoked_at is null/,
  )

  const issueStart = deliveryMigration.indexOf(
    'create or replace function private.issue_google_admin_display_session_v1(',
  )
  const issueEnd = deliveryMigration.indexOf(
    'create function private.ack_display_realtime_delivery_v1(',
    issueStart,
  )
  const issue = deliveryMigration.slice(issueStart, issueEnd)
  const replacementMarker = issue.indexOf(
    '-- Every new URL replaces every earlier Display capability',
  )
  const rootRevocation = issue.indexOf(
    'update private.admin_google_display_sessions',
    replacementMarker,
  )
  const realtimeInsertBranch = issue.indexOf(
    'if target_enable_realtime then',
    replacementMarker,
  )
  assert.ok(issueStart > 0 && issueEnd > issueStart)
  assert.ok(
    replacementMarker > 0 &&
      rootRevocation > replacementMarker &&
      realtimeInsertBranch > rootRevocation,
    'all prior private roots must be revoked before the optional Realtime insert',
  )

  const liveVerifierStart = deliveryMigration.indexOf(
    'create or replace function private.verify_and_claim_google_display_session_v1(',
  )
  const liveVerifierEnd = deliveryMigration.indexOf(
    'revoke all on function private.verify_and_claim_google_display_session_v1(',
    liveVerifierStart,
  )
  const liveVerifier = deliveryMigration.slice(
    liveVerifierStart,
    liveVerifierEnd,
  )
  assert.match(
    liveVerifier,
    /from private\.admin_google_display_sessions as session[\s\S]*?for update;[\s\S]*?if binding\.revoked_at is not null[\s\S]*?if binding\.realtime_enabled[\s\S]*?update public\.display_realtime_sessions[\s\S]*?update private\.admin_google_display_sessions/,
  )

  const terminalVerifierStart = deliveryMigration.indexOf(
    'create or replace function private.verify_google_display_terminal_session_v1(',
  )
  const terminalVerifierEnd = deliveryMigration.indexOf(
    'revoke all on function private.verify_google_display_terminal_session_v1(',
    terminalVerifierStart,
  )
  const terminalVerifier = deliveryMigration.slice(
    terminalVerifierStart,
    terminalVerifierEnd,
  )
  assert.match(
    terminalVerifier,
    /from private\.admin_google_display_sessions as session[\s\S]*?for update;[\s\S]*?terminal_disabled[\s\S]*?'recognized', true[\s\S]*?'valid', false/,
  )
  assert.doesNotMatch(
    terminalVerifier,
    /update private\.admin_google_display_sessions/,
  )

  for (const publicVerifierName of [
    'verify_and_claim_google_display_session_v1',
    'verify_google_display_terminal_session_v1',
  ]) {
    const publicStart = deliveryMigration.indexOf(
      `create or replace function public.${publicVerifierName}(`,
    )
    const publicEnd = deliveryMigration.indexOf('$$;', publicStart) + 3
    const publicVerifier = deliveryMigration.slice(publicStart, publicEnd)
    assert.match(
      publicVerifier,
      new RegExp(`select private\\.${publicVerifierName}\\(`),
    )
    assert.doesNotMatch(
      publicVerifier,
      /from private\.admin_google_display_sessions/,
    )
  }

  assert.match(
    deliveryMigration,
    /create trigger lecture_sessions_revoke_zz_google_display_roots[\s\S]*?create trigger admin_sessions_revoke_zz_google_display_roots/,
  )
  const lectureRootRevokeStart = deliveryMigration.indexOf(
    'create function private.revoke_google_display_roots_for_lecture_v1()',
  )
  const lectureRootRevokeEnd = deliveryMigration.indexOf(
    'revoke all on function private.revoke_google_display_roots_for_lecture_v1()',
    lectureRootRevokeStart,
  )
  const lectureRootRevoke = deliveryMigration.slice(
    lectureRootRevokeStart,
    lectureRootRevokeEnd,
  )
  assert.match(
    lectureRootRevoke,
    /new\.status = 'open'[\s\S]*?new\.closed_at is null[\s\S]*?new\.hard_stop_at > statement_timestamp\(\)[\s\S]*?return new;[\s\S]*?revoke_reason = case[\s\S]*?'lecture_closed'[\s\S]*?'hard_stop'/,
  )
  assert.match(
    deliveryMigration,
    /A Display URL is a live-lecture capability[\s\S]*?update private\.admin_google_display_sessions as binding[\s\S]*?from public\.lecture_sessions as lecture[\s\S]*?lecture\.status <> 'open'[\s\S]*?lecture\.closed_at is not null[\s\S]*?lecture\.hard_stop_at <= statement_timestamp\(\)/,
  )
})

test('Display issue and Admin revoke races observe real row-lock contention', () => {
  assert.match(lockOrderRegression, /function startSqlUntilReady/)
  assert.match(
    lockOrderRegression,
    /`\$\{stdout\}\\n\$\{stderr\}`\.includes\(readyMarker\)/,
  )
  assert.match(lockOrderRegression, /child\.on\('close'/)
  assert.match(lockOrderRegression, /void done\.catch\(\(\) => undefined\)/)
  assert.match(
    lockOrderRegression,
    /for share;[\s\S]*?PHASE728B_ISSUE_FIRST_READY[\s\S]*?phase728b-issue-first-revoke-waiter[\s\S]*?wait_event_type = 'Lock'[\s\S]*?register_display_realtime_session_v1/,
  )
  assert.match(
    lockOrderRegression,
    /await issueFirst\.ready[\s\S]*?phase728b-issue-first-revoke-waiter[\s\S]*?Promise\.all\(\[issueFirst\.done, issueFirstRevoke\]\)/,
  )
  assert.match(
    lockOrderRegression,
    /for update;[\s\S]*?PHASE728B_REVOKE_FIRST_READY[\s\S]*?phase728b-revoke-first-display-waiter[\s\S]*?wait_event_type = 'Lock'[\s\S]*?revoke_reason = 'p728b_revoke_first'/,
  )
  assert.match(
    lockOrderRegression,
    /revokeFirst\[0\]\?\.status !== 'fulfilled'[\s\S]*?revokeFirst\[1\]\?\.status !== 'rejected'[\s\S]*?tracked Admin session is not active/,
  )
  assert.match(
    lockOrderRegression,
    /await revokeFirstHolder\.ready[\s\S]*?phase728b-revoke-first-display-waiter[\s\S]*?Promise\.allSettled\(\[[\s\S]*?revokeFirstHolder\.done[\s\S]*?revokeFirstDisplay/,
  )
  assert.doesNotMatch(
    lockOrderRegression,
    /select (?:pg_catalog\.)?pg_sleep\(0\.(?:1|5)0*\);/,
  )
})

test('page acceleration and subscription authorization recheck Admin and lecture lifecycle', () => {
  const triggerStart = migration.indexOf(
    'create function private.broadcast_display_state_v1()',
  )
  const triggerEnd = migration.indexOf(
    'create trigger lecture_live_state_display_realtime',
    triggerStart,
  )
  const trigger = migration.slice(triggerStart, triggerEnd)
  assert.match(trigger, /join public\.admin_sessions as admin_session/)
  assert.match(
    trigger,
    /admin_session\.auth_user_id = session\.admin_auth_user_id/,
  )
  assert.match(trigger, /admin_session\.revoked_at is null/)
  assert.match(trigger, /admin_session\.expires_at > statement_timestamp\(\)/)
  assert.match(
    trigger,
    /admin_session\.idle_expires_at > statement_timestamp\(\)/,
  )
  assert.match(trigger, /lecture\.status = 'open'/)
  assert.match(trigger, /exception when others then[\s\S]*?null/)
  assert.match(
    migration,
    /create trigger admin_sessions_revoke_display_realtime/,
  )
  assert.match(
    migration,
    /create trigger lecture_sessions_revoke_display_realtime/,
  )
  const fallbackStart = migration.indexOf(
    'create function public.verify_display_snapshot_fallback_v1(',
  )
  const fallbackEnd = migration.indexOf(
    'create function public.claim_display_caption_relay_v1(',
    fallbackStart,
  )
  const fallback = migration.slice(fallbackStart, fallbackEnd)
  assert.ok(fallbackStart > 0)
  assert.match(fallback, /where not gate\.enabled/)
  assert.match(fallback, /binding\.revoke_reason = 'feature_disabled'/)
  assert.match(
    fallback,
    /binding\.display_auth_user_id = target_display_auth_user_id/,
  )
  assert.match(fallback, /binding\.expires_at > statement_timestamp\(\)/)
  assert.match(fallback, /binding\.hard_stop_at > statement_timestamp\(\)/)
  assert.match(fallback, /lecture\.status = 'open'/)
  assert.match(fallback, /lecture\.hard_stop_at > statement_timestamp\(\)/)
  assert.match(fallback, /admin_session\.revoked_at is null/)
  assert.match(fallback, /admin_session\.expires_at > statement_timestamp\(\)/)
  assert.match(
    fallback,
    /admin_session\.idle_expires_at > statement_timestamp\(\)/,
  )
  assert.match(
    migration,
    /revoke_display_realtime_for_admin_v1[\s\S]*?revoke_reason = 'feature_disabled'[\s\S]*?revoke_reason = 'admin_session_revoked'/,
  )
  assert.match(
    migration,
    /revoke_display_realtime_for_lecture_v1[\s\S]*?revoke_reason = 'feature_disabled'[\s\S]*?coalesce\(revoked_at, statement_timestamp\(\)\)/,
  )
})

test('caption terminal events bypass delta throttle while retaining sequence and bounded abuse gates', () => {
  const relayGateStart = migration.indexOf(
    'create function public.claim_display_caption_relay_v1(',
  )
  const relayGateEnd = migration.indexOf(
    'create function public.cleanup_display_realtime_sessions_v1()',
    relayGateStart,
  )
  const relayGate = migration.slice(relayGateStart, relayGateEnd)
  assert.match(
    relayGate,
    /target_source = 'delta'[\s\S]*?last_caption_delta_relay_at[\s\S]*?interval '450 milliseconds'/,
  )
  assert.match(
    relayGate,
    /target_source <> 'delta'[\s\S]*?interval '10 seconds'[\s\S]*?caption_control_relay_count >= 60/,
  )
  assert.match(
    relayGate,
    /target_sequence <= binding\.last_caption_sequence[\s\S]*?return 'stale'/,
  )
  assert.doesNotMatch(
    relayGate,
    /last_caption_relay_at > effective_now - interval '100 milliseconds'/,
  )
})

test('Edge claim binds signed jti to the verified anonymous Display identity', () => {
  assert.match(issueSession, /verifyGoogleAdminOperationRequest/)
  assert.match(issueSession, /hasLegacyAdminFields\(body\)/)
  assert.match(issueSession, /body\.enableRealtime === true/)
  assert.match(issueSession, /issue_google_admin_display_session_v1/)
  assert.match(issueSession, /createBoundDisplayToken/)
  assert.match(claimSession, /getDisplayTokenClaims/)
  assert.match(claimSession, /service\.auth\.getUser\(bearerToken\)/)
  assert.match(claimSession, /authData\.user\.is_anonymous !== true/)
  assert.match(claimSession, /verify_and_claim_google_display_session_v1/)
  assert.doesNotMatch(claimSession, /claim_display_realtime_session_v1/)
  assert.match(claimSession, /await sha256Hex\(displayClaims\.jti\)/)
  assert.match(claimSession, /result\.status === 'claimed_by_other'/)
  assert.match(claimSession, /409/)
  assert.match(claimSession, /result\.status === 'unavailable'[\s\S]*?503/)
  assert.match(
    displayLauncher,
    /enableRealtime: isPhase728DisplayRealtimeEnabled/,
  )
})

test('server caption relay is bounded, authenticated, lifecycle-gated and private', () => {
  assert.match(
    captionRelay,
    /readJsonBody<RelayRequest>\(request, 12 \* 1024\)/,
  )
  assert.match(captionRelay, /MAX_CAPTION_TEXT_CHARACTERS = 4_000/)
  assert.match(
    captionRelay,
    /Math\.abs\(Date\.now\(\) - value\.timestamp\) <= 60_000/,
  )
  assert.match(captionRelay, /verifyGoogleAdminOperationRequest/)
  assert.match(captionRelay, /claim_google_admin_display_caption_relay_v1/)
  assert.match(
    captionRelay,
    /admission\?\.status === 'rate_limited'[\s\S]*?429/,
  )
  assert.match(captionRelay, /redirect: 'manual'/)
  assert.match(
    captionRelay,
    /AbortSignal\.timeout\(REALTIME_RELAY_TIMEOUT_MS\)/,
  )
  assert.match(captionRelay, /relayUrl\.searchParams\.set\('private', 'true'\)/)
  assert.match(captionRelay, /Authorization: `Bearer \$\{serviceRoleKey\}`/)
})

test('caption relay resolves the claimed private Display topic after Admin reload', () => {
  assert.match(
    captionResolutionMigration,
    /'broadcast-display-caption\.publish'[\s\S]*?'owned_lecture'[\s\S]*?'open'[\s\S]*?'provider_continuation'/,
  )
  assert.match(
    captionResolutionMigration,
    /require_google_ai_provider_context_v1/,
  )
  assert.doesNotMatch(
    captionResolutionMigration,
    /require_google_admin_operation_context_v1/,
  )
  const captionClaimStart = captionResolutionMigration.indexOf(
    'create function private.claim_google_admin_display_caption_relay_v1(',
  )
  const captionClaimEnd = captionResolutionMigration.indexOf(
    'revoke all on function private.claim_google_admin_display_caption_relay_v1(',
    captionClaimStart,
  )
  const captionClaim = captionResolutionMigration.slice(
    captionClaimStart,
    captionClaimEnd,
  )
  const canonicalCaptionLocks = [
    'from private.admin_ai_policies as policy',
    'from public.lecture_sessions as lecture',
    'from public.lecture_ai_master_authorizations as master',
    'from public.lecture_ai_control as control',
    'from public.ai_usage_ledger as usage',
    'from public.ai_realtime_provider_calls as provider_call',
    'from private.display_realtime_runtime_gate as gate',
    'from private.admin_google_display_sessions as root',
  ].map((marker) => captionClaim.indexOf(marker))
  assert.ok(
    captionClaimStart >= 0 &&
      captionClaimEnd > captionClaimStart &&
      canonicalCaptionLocks.every(
        (lock, index) =>
          lock >= 0 && (index === 0 || lock > canonicalCaptionLocks[index - 1]),
      ),
    'caption relay must preserve AI policy -> lecture -> master -> control -> usage -> provider -> Display projection/root lock order',
  )
  assert.match(
    captionResolutionMigration,
    /from private\.display_realtime_runtime_gate as gate[\s\S]*?for update of session;[\s\S]*?from private\.admin_google_display_sessions as root[\s\S]*?for update;[\s\S]*?display_root\.revoked_at is not null/,
  )
  assert.match(
    captionResolutionMigration,
    /admission_status := public\.claim_display_caption_relay_v1\([\s\S]*?binding\.topic[\s\S]*?'topic', binding\.topic/,
  )
  assert.doesNotMatch(captionRelay, /body\.topic|target_topic/)
  const clientRelay = displayClient.slice(
    displayClient.indexOf('async function relayCaption'),
    displayClient.indexOf('async function sendCaptionNow'),
  )
  assert.match(clientRelay, /appSessionToken: adminToken\.appSessionToken/)
  assert.doesNotMatch(
    clientRelay,
    /adminPublishers|get\(message\.lectureSessionId\)/,
  )
})

test('operator snapshot and PDF access preserve live flag-OFF tokens but reject every terminal or replayed token', () => {
  for (const source of [operatorSnapshot, pdfAccess]) {
    assert.match(source, /verify_and_claim_google_display_session_v1/)
    assert.match(source, /auth\.getUser\(bearerToken\)/)
    assert.match(
      source,
      /sha256Hex\((?:liveDisplayClaims|displayClaims)\.jti\)/,
    )
    assert.match(source, /target_display_auth_user_id: authData\.user\.id/)
    assert.match(source, /recognized !== true/)
    assert.match(source, /valid !== true/)
    assert.doesNotMatch(source, /verify_google_display_terminal_session_v1/)
    assert.doesNotMatch(source, /getDisplayTerminalTokenClaims/)
    assert.doesNotMatch(source, /admin_get_lecture_operator_access_v1/)
    assert.doesNotMatch(
      source,
      /verify_display_realtime_session_v1|verify_display_snapshot_fallback_v1/,
    )
    const bindingVerificationStart = source.indexOf(
      'verify_and_claim_google_display_session_v1',
    )
    assert.ok(bindingVerificationStart > 0)
    assert.doesNotMatch(
      source.slice(
        Math.max(0, bindingVerificationStart - 500),
        bindingVerificationStart,
      ),
      /PHASE728_DISPLAY_REALTIME_ENABLED/,
      'registered binding enforcement must survive Edge flag rollback',
    )
  }
  assert.match(
    operatorSnapshot,
    /googleDisplayBinding\.valid !== true[\s\S]*?credentialExpired: true[\s\S]*?Display session has ended\.[\s\S]*?401/,
  )
  assert.match(
    pdfAccess,
    /googleDisplayBinding\?\.recognized !== true \|\|[\s\S]*?googleDisplayBinding\.valid !== true[\s\S]*?credentialExpired:[\s\S]*?Display session has ended\.[\s\S]*?401/,
  )
  assert.doesNotMatch(
    `${migration}\n${operatorSnapshot}\n${pdfAccess}`,
    /verify_display_realtime_terminal_session_v1/,
  )
})

test('Admin coalesces deltas, orders terminal messages and Display uses a private removable channel', () => {
  assert.match(displayClient, /REMOTE_CAPTION_MIN_INTERVAL_MS = 500/)
  assert.match(displayClient, /captionRelayInFlight = new Map/)
  assert.match(displayClient, /while \(queue\.length > 16\)/)
  assert.match(displayClient, /message\.source === 'completed'/)
  assert.match(displayClient, /message\.source === 'stopped'/)
  assert.match(
    displayClient,
    /message\.source !== 'stopped'[\s\S]*?stoppedCaptionStreams\.has\(streamKey\)/,
  )
  assert.match(displayClient, /private: true/)
  assert.match(displayClient, /broadcast: \{ ack: true, self: false \}/)
  assert.match(displayClient, /displaySupabase\.realtime\.setAuth/)
  assert.match(
    displayClient,
    /adminSupabase\.functions\.invoke<[\s\S]*?>\('broadcast-display-caption'/,
  )
  assert.match(
    displayRealtimeE2e,
    /publishAdminCaptionRealtime\([\s\S]*?\{ appSessionToken, kind: 'google' \}[\s\S]*?\{ operationId, startRequestId \}/,
    'the provider-free browser fixture must call the live caption client with the bound Admin credential and provider authority',
  )
  assert.match(
    displayRealtimeE2e,
    /functions\/v1\/broadcast-display-caption[\s\S]*?realtime\/v1\/api\/broadcast\/\$\{encodeURIComponent/,
    'the provider-free fixture must exercise the client request and relay it onto the claimed private Display topic',
  )
  assert.match(displayClient, /displaySupabase\.removeChannel\(channel\)/)
  assert.match(
    displayClient,
    /event: 'display_state'[\s\S]*?if \(closed \|\| activeChannel !== channel\) return[\s\S]*?event: 'caption'[\s\S]*?if \(closed \|\| activeChannel !== channel\) return[\s\S]*?event: 'session_closed'[\s\S]*?if \(closed \|\| activeChannel !== channel\) return/,
  )
  assert.match(
    displayClient,
    /Math\.min\([\s\S]*?Date\.parse\(session\.hardStopAt\)/,
  )
  assert.match(displayPage, /claimDisplayRealtimeSession/)
  assert.match(displayPage, /canFallbackFromDisplayRealtimeClaim/)
  assert.match(displayPage, /subscribeClaimedDisplayRealtimeSession/)
  assert.match(displayClient, /status === 404 \|\| status === 503/)
  assert.match(displayPage, /refreshDisplayStateRef\.current\(\)/)
  assert.match(
    displayPage,
    /reason === 'feature_disabled'[\s\S]*?setDisplayRealtimeSession\(null\)/,
  )
  assert.match(
    displayPage,
    /displayStateError\?\.includes\('Invalid Display session\.'\)[\s\S]*?Display session has ended\.[\s\S]*?setOperatorLiveAccess\(null\)[\s\S]*?setDisplayAccessError/,
  )
  assert.match(
    displayPage,
    /if \(displayRealtimeSession\) return[\s\S]*?createCaptionBroadcastChannel/,
  )
  assert.doesNotMatch(
    lecturePage,
    /subscribeClaimedDisplayRealtimeSession|displayRealtime/,
  )
})

test('Display keeps an explicit exit control inside the fullscreen element', () => {
  assert.match(
    displayView,
    /<main className="display-shell" ref=\{presentationRef\}>[\s\S]*display-fullscreen-button[\s\S]*isPresentationFullscreen[\s\S]*'全画面を終了'/,
  )
})

test('final Display delivery remains snapshot-authoritative and expires exactly at 90 minutes or hard stop', () => {
  assert.match(
    deliveryMigration,
    /token_issued_epoch \+ 90 \* 60[\s\S]*?floor\(extract\(epoch from lecture_row\.hard_stop_at\)\)::bigint,/,
  )
  assert.doesNotMatch(
    deliveryMigration,
    /token_issued_epoch \+ 95 \* 60|hard_stop_at\)\)::bigint \+ 5 \* 60/,
  )
  assert.match(
    deliveryMigration,
    /admin_google_display_sessions_exact_hard_stop_check[\s\S]*?expires_at <= hard_stop_at[\s\S]*?interval '90 minutes'/,
  )
  assert.doesNotMatch(
    deliveryMigration,
    /(?:create|alter|drop)\s+(?:table|function|schema|trigger|index)\s+(?:if\s+(?:not\s+)?exists\s+)?realtime\./i,
  )
})

test('Display reload recovery, full version invalidation and bounded reconnect preserve the five-second fallback', () => {
  assert.match(displaySessionStorage, /window\.sessionStorage/)
  assert.match(displaySessionStorage, /persistClaimedDisplayLaunch/)
  assert.match(displaySessionStorage, /stripDisplayLaunchFragment/)
  assert.match(displayPage, /readDisplayLaunch/)
  assert.match(
    displayPage,
    /persistClaimedDisplayLaunch[\s\S]*?stripDisplayLaunchFragment/,
  )
  assert.match(displayClient, /event: 'live_state_changed'/)
  assert.match(
    deliveryMigration,
    /'versions', jsonb_build_object\([\s\S]*?'caption'[\s\S]*?'comments'[\s\S]*?'display'[\s\S]*?'lecture'[\s\S]*?'likes'[\s\S]*?'metrics'[\s\S]*?'pdf'[\s\S]*?'polls'[\s\S]*?'summaries'/,
  )
  assert.match(
    displayClient,
    /RECONNECT_BACKOFF_MS = \[1_000, 2_000, 4_000, 8_000, 15_000\]/,
  )
  assert.match(
    displayPage,
    /setInterval\(\(\) => setNow\(Date\.now\(\)\), 5_000\)/,
  )
})

test('overlapping live snapshots never regress an already-applied domain version', () => {
  const applied = liveVersions()
  const staleSnapshot = {
    contractVersion: 2,
    versions: liveVersions({
      caption: null,
      comments: 7,
      pdf: 8,
      polls: 8,
      summaries: 9,
    }),
  }
  const freshness = getLiveSnapshotFreshness(applied, staleSnapshot)

  assert.equal(freshness.caption, false)
  assert.equal(freshness.comments, false)
  assert.equal(freshness.display, false)
  assert.equal(freshness.polls, true)
  assert.equal(freshness.summaries, false)

  const merged = mergeLiveStateVersions(applied, staleSnapshot.versions)
  assert.equal(merged.caption, 5, 'a null response cannot erase known state')
  assert.equal(merged.comments, 8, 'an older response cannot lower a version')
  assert.equal(merged.pdf, 9, 'Display V2 follows the PDF domain fence')
  assert.equal(merged.polls, 8, 'a newer domain can advance independently')

  const pagedComments = advanceLiveStateVersions(applied, {
    comments: { hasMore: true, mode: 'delta' },
    versions: liveVersions({ comments: 12 }),
  })
  assert.equal(
    pagedComments.comments,
    8,
    'an incomplete comment delta must keep requesting the prior version',
  )

  assert.match(compassStateContext, /liveSnapshotFenceRef/)
  assert.match(compassStateContext, /liveSnapshotFence\.appliedVersions/)
  assert.match(compassStateContext, /liveSnapshotFence\.appliedSequence/)
  assert.match(
    compassStateContext,
    /const freshness = getLiveSnapshotFreshness\(\s*appliedVersions,\s*snapshot,?\s*\)/,
  )
  assert.match(
    compassStateContext,
    /freshness\.summaries && snapshot\.summaries/,
  )
  assert.match(
    compassStateContext,
    /requestEpoch !== lifecycleRequestEpochRef\.current/,
  )
})

test('Display snapshot fallback is exactly five seconds without jitter while student request spreading is unchanged', () => {
  assert.equal(DISPLAY_LIVE_SYNC_INTERVAL_MS, 5_000)
  assert.equal(DISPLAY_LIVE_SYNC_INITIAL_JITTER_MS, 0)
  assert.equal(DISPLAY_LIVE_SYNC_JITTER_MS, 0)
  assert.equal(STUDENT_LIVE_SYNC_INTERVAL_MS, 5_000)
  assert.equal(STUDENT_LIVE_SYNC_INITIAL_JITTER_MS, 5_000)
  assert.equal(STUDENT_LIVE_SYNC_JITTER_MS, 0)
  assert.deepEqual(getLiveSyncRouteOptions('/display'), {
    foregroundIntervalMs: DISPLAY_LIVE_SYNC_INTERVAL_MS,
    initialJitterMs: DISPLAY_LIVE_SYNC_INITIAL_JITTER_MS,
    jitterMs: DISPLAY_LIVE_SYNC_JITTER_MS,
  })
  assert.match(
    compassStateContext,
    /\.\.\.getLiveSyncRouteOptions\(normalizedPathname\)/,
  )
})

test('Display selects and renders only the latest public lecture summary', () => {
  const olderPinned = {
    lectureRecap: ['older'],
    pinned: true,
    publishedAt: '2026-08-25T10:07:00.000Z',
    revisionId: 'revision-older',
    windowEnd: '2026-08-25T10:05:00.000Z',
  }
  const newest = {
    lectureRecap: ['newest'],
    pinned: false,
    publishedAt: '2026-08-25T10:06:00.000Z',
    revisionId: 'revision-newest',
    windowEnd: '2026-08-25T10:10:00.000Z',
  }

  assert.equal(getLatestPublicSummary([olderPinned, newest]), newest)
  assert.equal(getLatestPublicSummary([]), null)
  assert.match(
    displayPage,
    /const latestSummary = getLatestPublicSummary\(summaries\)[\s\S]*?summary=\{latestSummary\}/,
  )
  assert.match(displayView, /summary: PublicLectureSummary \| null/)
  assert.match(
    displayView,
    /className="display-summary-card"[\s\S]*?summary\.lectureRecap\.slice\(0, 3\)/,
  )
  assert.match(appCss, /\.display-summary-card/)
})

test('render acknowledgement and heartbeat are bound to the claimed anonymous Display and Admin status is read-only', () => {
  assert.match(
    deliveryMigration,
    /add column connected_at[\s\S]*?last_heartbeat_at[\s\S]*?last_applied_display_version[\s\S]*?last_rendered_page[\s\S]*?connection_generation/,
  )
  assert.match(displayStatus, /service\.auth\.getUser\(bearerToken\)/)
  assert.match(displayStatus, /authData\.user\.is_anonymous !== true/)
  assert.match(displayStatus, /ack_display_realtime_delivery_v1/)
  assert.match(displayStatus, /verifyGoogleAdminOperationRequest/)
  assert.match(
    deliveryMigration,
    /'display-session-status\.status'[\s\S]*?'gate_independent'[\s\S]*?'read'/,
  )
  assert.match(displayClient, /DISPLAY_HEARTBEAT_INTERVAL_MS = 10_000/)
  assert.match(displayClient, /createDisplaySessionReporter/)
  assert.match(displayPage, /reportRenderedDisplayState/)
  assert.match(displayStatusHook, /STATUS_STALE_AFTER_MS = 25_000/)
  assert.match(
    displayStatusHook,
    /Date\.now\(\) - lastSuccessfulPollAt >= STATUS_STALE_AFTER_MS[\s\S]*?state: 'reconnecting'/,
  )
})

test('Display ranks comments before limiting and shows one active Poll', () => {
  assert.doesNotMatch(displayView, /comments=\{comments\.slice\(0, 5\)\}/)
  assert.match(displayView, /comments=\{comments\}[\s\S]*?limit=\{5\}/)
  assert.match(
    displayView,
    /const activePolls = isLectureClosed \? \[\] : polls\.slice\(0, 1\)[\s\S]*?activePolls\.map/,
  )
})

test('late slide mutations cannot repopulate a cleared or different lecture', () => {
  assert.match(
    displayMutationHook,
    /activeLectureSessionIdRef\.current === targetLectureSessionId[\s\S]*?setDisplayState\(nextState\)/,
  )
  assert.doesNotMatch(
    displayMutationHook,
    /!activeLectureSessionIdRef\.current\s*\|\|/,
  )
})

test('Phase 7.28B remains default-off and every new Edge entry requires JWT verification', () => {
  assert.match(localEnvironment, /^VITE_PHASE7_28_DISPLAY_REALTIME=false$/m)
  assert.match(localEnvironment, /^PHASE728_DISPLAY_REALTIME_ENABLED=false$/m)
  assert.match(
    supabaseConfig,
    /\[functions\.claim-display-realtime-session\]\s+verify_jwt = true/,
  )
  assert.match(
    supabaseConfig,
    /\[functions\.broadcast-display-caption\]\s+verify_jwt = true/,
  )
})

test('60-minute worst-case relay stays bounded and adds no student Realtime subscriptions', () => {
  const maxDeltaRelays = Math.ceil((60 * 60 * 1_000) / 500)
  assert.equal(maxDeltaRelays, 7_200)
  assert.equal(
    (displayClient.match(/displaySupabase\.channel\(/g) ?? []).length,
    1,
  )
  assert.doesNotMatch(lecturePage, /supabase\.channel\(/)
})
