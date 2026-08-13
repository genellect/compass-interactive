import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const read = (path) =>
  readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

const migration = read(
  'supabase/migrations/20260731110507_phase7_28b_authorized_display_realtime.sql',
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
const displayPage = read('src/pages/DisplayPage.tsx')
const displayLauncher = read('src/pages/admin/useAdminDisplayLauncher.ts')
const lecturePage = read('src/pages/LecturePage.tsx')
const lockOrderRegression = read('scripts/test-phase7-28b-lock-order.mjs')
const localEnvironment = read('.env.local.example')
const supabaseConfig = read('supabase/config.toml')

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
  assert.match(captionRelay, /service\.auth\.getUser\(bearerToken\)/)
  assert.match(captionRelay, /claim_display_caption_relay_v1/)
  assert.match(captionRelay, /admission === 'rate_limited'[\s\S]*?429/)
  assert.match(captionRelay, /redirect: 'manual'/)
  assert.match(
    captionRelay,
    /AbortSignal\.timeout\(REALTIME_RELAY_TIMEOUT_MS\)/,
  )
  assert.match(captionRelay, /relayUrl\.searchParams\.set\('private', 'true'\)/)
  assert.match(captionRelay, /Authorization: `Bearer \$\{serviceRoleKey\}`/)
})

test('operator snapshot and PDF access preserve flag-OFF tokens but reject registered unclaimed or replayed tokens', () => {
  for (const source of [operatorSnapshot, pdfAccess]) {
    assert.match(source, /verify_and_claim_google_display_session_v1/)
    assert.match(source, /verify_google_display_terminal_session_v1/g)
    assert.match(source, /auth\.getUser\(bearerToken\)/)
    assert.match(
      source,
      /sha256Hex\((?:liveDisplayClaims|displayClaims)\.jti\)/,
    )
    assert.match(source, /target_display_auth_user_id: authData\.user\.id/)
    assert.match(source, /recognized !== true/)
    assert.match(source, /valid !== true/)
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
    /googleDisplayBinding\.valid !== true[\s\S]*?verify_google_display_terminal_session_v1[\s\S]*?admin_get_lecture_operator_access_v1[\s\S]*?mode === 'terminal'/,
  )
  assert.match(
    operatorSnapshot,
    /descendant\.valid !== true[\s\S]*?credentialExpired: true[\s\S]*?Display session has ended\./,
  )
  assert.match(pdfAccess, /getDisplayTerminalTokenClaims/)
  assert.match(
    pdfAccess,
    /googleDisplayBinding\.valid !== true[\s\S]*?verify_google_display_terminal_session_v1[\s\S]*?admin_get_lecture_operator_access_v1[\s\S]*?mode !== 'terminal'/,
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
  assert.match(displayClient, /supabase\.realtime\.setAuth/)
  assert.match(
    displayClient,
    /adminSupabase\.functions\.invoke<[\s\S]*?>\('broadcast-display-caption'/,
  )
  assert.match(displayClient, /supabase\.removeChannel\(channel\)/)
  assert.match(
    displayClient,
    /event: 'display_state'[\s\S]*?if \(closed\) return[\s\S]*?event: 'caption'[\s\S]*?if \(closed\) return[\s\S]*?event: 'session_closed'[\s\S]*?if \(closed\) return/,
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
  assert.equal((displayClient.match(/supabase\.channel\(/g) ?? []).length, 1)
  assert.doesNotMatch(lecturePage, /supabase\.channel\(/)
})
