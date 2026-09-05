import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const rootUrl = new URL(`file:///${root.replaceAll('\\', '/')}/`)
const read = (...parts) =>
  readFileSync(new URL(parts.join('/'), rootUrl), 'utf8')

const migrationName = readdirSync(
  new URL('supabase/migrations/', rootUrl),
).find((name) => name.endsWith('_phase7_29_powerpoint_presenter_bridge.sql'))
assert.ok(migrationName, 'Phase 7.29 migration must exist')

const migration = read('supabase', 'migrations', migrationName)
const proofMigrationName = readdirSync(
  new URL('supabase/migrations/', rootUrl),
).find((name) => name.endsWith('_phase7_29c_presenter_proof_and_cleanup.sql'))
assert.ok(proofMigrationName, 'Phase 7.29C proof migration must exist')
const proofMigration = read('supabase', 'migrations', proofMigrationName)
const manageConnection = read(
  'supabase',
  'functions',
  'manage-presenter-connection',
  'index.ts',
)
const bridgeSession = read(
  'supabase',
  'functions',
  'presenter-bridge-session',
  'index.ts',
)
const presenterToken = read(
  'supabase',
  'functions',
  '_shared',
  'presenterToken.ts',
)
const presenterProof = read(
  'supabase',
  'functions',
  '_shared',
  'presenterProof.ts',
)
const updateDisplay = read(
  'supabase',
  'functions',
  'update-display-state',
  'index.ts',
)
const repository = read(
  'src',
  'repositories',
  'supabasePresenterBridgeRepository.ts',
)
const browserClient = read('src', 'presenter', 'presenterBridgeClient.ts')
const browserProtocol = read('src', 'presenter', 'presenterBridgeProtocol.ts')
const flagOffBrowserSpec = read(
  'e2e',
  'demo',
  'phase7-29-presenter-flag-off.spec.ts',
)
const adminPresenterHook = read(
  'src',
  'components',
  'AdminWorkspace',
  'useAdminPowerPointSync.ts',
)
const adminPresenterControl = read(
  'src',
  'components',
  'AdminWorkspace',
  'AdminPowerPointSyncControl.tsx',
)
const featureFlags = read('src', 'lib', 'featureFlags.ts')
const envExample = read('.env.local.example')
const supabaseConfig = read('supabase', 'config.toml')
const displayPage = read('src', 'pages', 'DisplayPage.tsx')
const lecturePage = read('src', 'pages', 'LecturePage.tsx')
const adaptiveSync = read('src', 'hooks', 'useAdaptiveLiveSync.ts')
const concurrency = read('scripts', 'test-phase7-29-concurrency.mjs')
const nativeCoordinator = read(
  'presenter-bridge',
  'src',
  'Compass.Presenter.App',
  'PresenterSessionCoordinator.cs',
)
const nativeProof = read(
  'presenter-bridge',
  'src',
  'Compass.Presenter.App',
  'WindowsInstallationProof.cs',
)
const nativeRequestSigner = read(
  'presenter-bridge',
  'src',
  'Compass.Presenter.App',
  'PresenterRequestSigner.cs',
)
const nativeClient = read(
  'presenter-bridge',
  'src',
  'Compass.Presenter.App',
  'EdgePresenterClient.cs',
)
const nativeManualRecovery = read(
  'presenter-bridge',
  'src',
  'Compass.Presenter.App',
  'ManualRecoveryService.cs',
)
const nativeTray = read(
  'presenter-bridge',
  'src',
  'Compass.Presenter.App',
  'PresenterTrayHost.cs',
)
const nativeOptions = read(
  'presenter-bridge',
  'src',
  'Compass.Presenter.App',
  'BridgeOptions.cs',
)
const nativeRuntime = read(
  'presenter-bridge',
  'src',
  'Compass.Presenter.Core',
  'PresenterReconciliationRuntime.cs',
)
const nativeLoopbackServer = read(
  'presenter-bridge',
  'src',
  'Compass.Presenter.Loopback',
  'LoopbackPresenterServer.cs',
)
const nativeLoopbackSessions = read(
  'presenter-bridge',
  'src',
  'Compass.Presenter.Loopback',
  'PresenterLoopbackSessions.cs',
)
const nativePowerPoint = read(
  'presenter-bridge',
  'src',
  'Compass.Presenter.PowerPoint.External',
  'PowerPointComObservationSource.cs',
)
const presenterGateway = read(
  'cloudflare',
  'presenter-gateway',
  'src',
  'worker.ts',
)
const presenterGatewayConfig = read(
  'cloudflare',
  'presenter-gateway',
  'wrangler.jsonc',
)

assert.match(
  migration,
  /create table private\.presenter_runtime_gate[\s\S]*?enabled boolean not null default false/,
)
assert.match(
  migration,
  /alter table public\.presenter_connections enable row level security/,
)
assert.match(
  migration,
  /alter table public\.presenter_connection_events enable row level security/,
)
assert.match(
  migration,
  /revoke all on public\.presenter_connections[\s\S]*?from public, anon, authenticated/,
)
assert.match(
  migration,
  /create unique index presenter_connections_one_unrevoked_per_lecture_idx[\s\S]*?where revoked_at is null/,
)
assert.match(
  migration,
  /ticket_expires_at <= issued_at \+ interval '60 seconds'/,
)
assert.match(migration, /target_pdf_page <> target_slide_index/)
assert.match(migration, /target_sequence <= connection_row\.last_sequence/)
assert.match(migration, /interval '200 milliseconds'/)
assert.match(migration, /'session_replaced'/)
assert.match(migration, /'manual_handover'/)
assert.match(migration, /'feature_disabled'/)
assert.match(migration, /for update skip locked/)
assert.match(migration, /effective_now - interval '45 seconds'/)
assert.match(
  migration,
  /admin_auth_user_id = target_admin_auth_user_id[\s\S]*?connection\.issued_at desc/,
)
assert.doesNotMatch(
  migration,
  /alter publication supabase_realtime[\s\S]*?presenter_/i,
)

assert.match(proofMigration, /add column proof_key_id text/)
assert.match(proofMigration, /create table private\.presenter_request_receipts/)
assert.match(proofMigration, /primary key \(proof_key_id, nonce_hash\)/)
assert.match(
  proofMigration,
  /create table private\.presenter_machine_rate_limits/,
)
assert.match(
  proofMigration,
  /create function public\.inspect_presenter_connection_v2/,
)
assert.match(proofMigration, /create function public\.apply_presenter_page_v2/)
assert.match(proofMigration, /set statement_timeout = '3s'/)
assert.match(proofMigration, /set lock_timeout = '750ms'/)
assert.match(proofMigration, /'compass-presenter-cleanup'/)
assert.match(proofMigration, /'\* \* \* \* \*'/)
assert.match(proofMigration, /enable row level security/g)
assert.doesNotMatch(
  proofMigration,
  /alter publication supabase_realtime[\s\S]*?presenter_/i,
)
assert.doesNotMatch(
  migration,
  /(?:pdf_bytes|pptx_bytes|slide_text|local_path|raw_ticket)/i,
)

assert.match(manageConnection, /PHASE729_POWERPOINT_SYNC_ENABLED/)
assert.match(
  manageConnection,
  /PRESENTER_ACTIONS = new Set\(\['confirm', 'issue', 'revoke', 'status'\]\)/,
)
assert.match(manageConnection, /!isPresenterAction\(body\.action\)/)
assert.match(manageConnection, /hasLegacyAdminFields\(body\)/)
assert.match(manageConnection, /verifyGoogleAdminOperationRequest/)
assert.match(manageConnection, /body\.appSessionToken\.trim\(\)\.length === 0/)
assert.match(
  manageConnection,
  /requestRequired && !UUID_PATTERN\.test\(body\.requestId/,
)
assert.match(
  manageConnection,
  /target_transport_enabled: googleContext\.transportEnabled/,
)
assert.doesNotMatch(manageConnection, /getAdminTokenClaims|verifyAdminToken/)
assert.match(manageConnection, /handleCors\(request\)/)
assert.match(manageConnection, /getAllowedCorsOrigin\(request\)/)
assert.match(manageConnection, /createPresenterPairingToken/)
assert.match(manageConnection, /issued\.pairingTicketExpiresAt/)
assert.match(manageConnection, /issued\.manualExpiresAt/)
assert.match(manageConnection, /manage_google_admin_presenter_connection_v1/)
assert.match(
  manageConnection,
  /readJsonBody<RequestBody>\(request, 8 \* 1024\)/,
)

assert.match(
  bridgeSession,
  /request\.headers\.has\('Origin'\) \|\| request\.method === 'OPTIONS'/,
)
assert.match(bridgeSession, /Browser requests are not allowed\./)
assert.match(bridgeSession, /PHASE729_POWERPOINT_SYNC_ENABLED/)
assert.match(bridgeSession, /readRequestBodyBytes\(request, 16 \* 1024\)/)
assert.match(bridgeSession, /getPresenterPairingClaims/)
assert.match(bridgeSession, /getPresenterCapabilityClaims/)
assert.match(bridgeSession, /claim_presenter_connection_v2/)
assert.match(bridgeSession, /apply_presenter_page_v2/)
assert.match(bridgeSession, /heartbeat_presenter_connection_v2/)
assert.match(presenterProof, /PRESENTER_BRIDGE_GATEWAY_SECRET/)
assert.match(bridgeSession, /verifyPresenterRequestProof\(request, rawBody\)/)
assert.match(bridgeSession, /AbortSignal\.timeout\(RPC_TIMEOUT_MS\)/)

assert.match(presenterProof, /compass-presenter-session-v1/)
assert.match(presenterProof, /x-compass-presenter-signature/)
assert.match(presenterProof, /ALLOWED_CLOCK_SKEW_SECONDS = 120/)
assert.match(presenterProof, /namedCurve: 'P-256'/)
assert.match(
  presenterProof,
  /request\.headers\.get\('x-compass-presenter-gateway'\)/,
)

assert.match(presenterToken, /PRESENTER_BRIDGE_TOKEN_SECRET/)
assert.match(presenterToken, /byteLength < 32/)
assert.match(presenterToken, /HMAC/)
assert.match(presenterToken, /timingSafeEqual/)
assert.match(presenterToken, /MAX_PAIRING_TTL_SECONDS = 60/)
assert.match(presenterToken, /MAX_CAPABILITY_TTL_SECONDS = 95 \* 60/)
assert.match(presenterToken, /origin: string/)
assert.match(presenterToken, /installationHash: string/)
assert.doesNotMatch(envExample, /^VITE_PRESENTER_BRIDGE_TOKEN_SECRET=/m)
assert.match(envExample, /^PRESENTER_BRIDGE_TOKEN_SECRET=$/m)
assert.doesNotMatch(envExample, /^VITE_PRESENTER_BRIDGE_GATEWAY_SECRET=/m)
assert.match(envExample, /^PRESENTER_BRIDGE_GATEWAY_SECRET=$/m)

assert.match(
  repository,
  /const PRESENTER_EDGE_FUNCTION = 'manage-presenter-connection'/,
)
assert.match(repository, /MANUAL_CODE_PATTERN = \/\^\[A-HJ-NP-Z2-9\]\{8\}\$\//)
assert.match(repository, /SUPABASE_REQUEST_TIMEOUT_MS\.adminFunction/)
assert.match(browserProtocol, /http:\/\/127\.0\.0\.1:43124/)
assert.match(browserProtocol, /PRESENTER_BRIDGE_HEALTH_TIMEOUT_MS = 1_500/)
assert.match(browserProtocol, /PRESENTER_BRIDGE_REQUEST_TIMEOUT_MS = 12_000/)
assert.match(adminPresenterHook, /pairingTicketExpiresAtRef/)
assert.match(adminPresenterHook, /transitionAutomaticPairingToRecovery/)
assert.match(browserClient, /credentials: 'omit'/)
assert.match(browserClient, /redirect: 'manual'/)
assert.match(browserClient, /referrerPolicy: 'no-referrer'/)
assert.match(browserClient, /cache: 'no-store'/)

const presenterBrowserSources = `${repository}\n${browserClient}\n${browserProtocol}`
assert.doesNotMatch(
  presenterBrowserSources,
  /localStorage|sessionStorage|indexedDB|document\.cookie/,
  'pairing tickets and loopback session tokens must remain memory-only',
)
assert.doesNotMatch(
  `${manageConnection}\n${bridgeSession}\n${presenterToken}`,
  /console\.(?:log|info|debug)\s*\(/,
  'Edge paths must not log pairing or capability material',
)

assert.match(envExample, /^VITE_PHASE7_29_POWERPOINT_SYNC=false$/m)
assert.match(envExample, /^VITE_PRESENTER_STORE_URL=$/m)
assert.match(adminPresenterControl, /VITE_PRESENTER_STORE_URL/)
assert.match(adminPresenterControl, /url\.hostname !== 'apps\.microsoft\.com'/)
assert.match(adminPresenterControl, /\\\/detail\\\/\[A-Z0-9\]\{12\}/)
assert.doesNotMatch(
  adminPresenterControl,
  /presenter-updates\.yuto-matsui\.com/,
)
assert.match(envExample, /^PHASE729_POWERPOINT_SYNC_ENABLED=false$/m)
assert.match(
  featureFlags,
  /isPhase729PowerPointSyncEnabled\s*=\s*[\s\S]*?isPhase3PrivatePdfEnabled\s*&&[\s\S]*?isPhase728DisplayRealtimeEnabled\s*&&[\s\S]*?VITE_PHASE7_29_POWERPOINT_SYNC === 'true'/,
)
assert.match(
  supabaseConfig,
  /\[functions\.manage-presenter-connection\]\s+verify_jwt = true/,
)
assert.match(
  supabaseConfig,
  /\[functions\.presenter-bridge-session\]\s+verify_jwt = false/,
)
assert.match(
  updateDisplay,
  /verifyGoogleAdminOperationRequest[\s\S]*?manage_google_admin_display_state_v1[\s\S]*?target_transport_enabled: verification\.transportEnabled/,
  'manual Admin display updates must pass through the Google authority facade',
)
assert.match(updateDisplay, /hasLegacyAdminFields\(body\)/)
assert.doesNotMatch(
  updateDisplay,
  /admin_update_pdf_display_with_presenter_fence_v1|admin_update_pdf_display_v3|getAdminTokenClaims|verifyAdminToken/,
)

for (const studentOrDisplaySource of [displayPage, lecturePage, adaptiveSync]) {
  assert.doesNotMatch(
    studentOrDisplaySource,
    /presenterBridge|presenter_connections|PowerPoint synchronization/,
    'Presenter control must not enter Display or student snapshot code',
  )
}
assert.doesNotMatch(lecturePage, /supabase\.channel\(/)
assert.match(
  flagOffBrowserSpec,
  /const settingsLink = page\.getByRole\('link',[\s\S]*name: '教員管理',[\s\S]*exact: true[\s\S]*toHaveAttribute\('href', '\/admin\/settings'\)[\s\S]*toHaveAttribute\('target', '_blank'\)[\s\S]*\.admin-identity-card'[\s\S]*toHaveCount\(0\)/,
  'the flag-OFF Presenter workspace must link to separate Admin settings instead of restoring the identity card',
)

assert.equal((concurrency.match(/startSqlUntilReady\(/g) ?? []).length, 4)
for (const readyMarker of [
  'PHASE729_ISSUE_FIRST_GATE_READY',
  'PHASE729_KILL_FIRST_GATE_READY',
  'PHASE729_PAGE_FIRST_GATE_READY',
]) {
  assert.equal(
    (concurrency.match(new RegExp(readyMarker, 'g')) ?? []).length,
    2,
  )
}
for (const applicationName of [
  'phase729-issue-first-kill-waiter',
  'phase729-kill-first-issue-waiter',
  'phase729-page-first-manual-waiter',
]) {
  assert.equal(
    (concurrency.match(new RegExp(applicationName, 'g')) ?? []).length,
    2,
  )
}
for (const obsoleteReleaseMarker of [
  'issue-first-kill-release',
  'kill-first-issue-release',
  'page-first-manual-release',
]) {
  assert.doesNotMatch(
    concurrency,
    new RegExp(obsoleteReleaseMarker),
    'Presenter race holders must release themselves after observing the waiter lock',
  )
}
assert.equal((concurrency.match(/wait_event_type = 'Lock'/g) ?? []).length, 3)
assert.equal(
  (concurrency.match(/pg_catalog\.pg_stat_clear_snapshot\(\)/g) ?? []).length,
  3,
  'each Presenter holder must refresh its statistics snapshot before observing the waiter',
)
assert.equal((concurrency.match(/interval '10 seconds'/g) ?? []).length, 3)
assert.match(concurrency, /lock_timeout = '5s'/)
assert.match(concurrency, /statement_timeout = '15s'/)
assert.doesNotMatch(
  concurrency,
  /pg_sleep\(0\.(?:1|5)0*\)/,
  'Presenter race ordering must never depend on 0.1s or 0.5s sleeps',
)

assert.match(nativePowerPoint, /hiddenSlideIds\.Add\(slideId\)/)
assert.match(nativePowerPoint, /hidden:\{string\.Join\(',', hiddenSlideIds\)\}/)
assert.match(nativeCoordinator, /IPresenterSessionFaultSource/)
assert.match(nativeCoordinator, /SessionFaulted\?\.Invoke/)
assert.match(nativeCoordinator, /SessionStateChanged\?\.Invoke/)
assert.match(nativeCoordinator, /PresenterSessionState\.Active/)
assert.match(nativeCoordinator, /PresenterSessionState\.Faulted/)
assert.match(
  nativeManualRecovery,
  /PresentationEligibilityEvaluator\.Evaluate\([\s\S]*?observation,[\s\S]*?observation\.SlideCount[\s\S]*?InspectManualCodeAsync/,
)
assert.match(nativeTray, /ReportSessionState/)
assert.match(nativeTray, /状態: PowerPoint同期中/)
assert.match(
  nativeOptions,
  /https:\/\/presenter-api\.yuto-matsui\.com\/functions\/v1\/presenter-bridge-session/,
)
assert.match(
  nativeOptions,
  /#else\s+var endpointText = ProductionPresenterEndpoint;\s+#endif/,
)
assert.doesNotMatch(nativeOptions, /supabase\.co/)
assert.match(nativeOptions, /ProductionPresenterEndpoint/)
assert.match(nativeOptions, /endpoint\.IsDefaultPort/)
assert.match(nativeRuntime, /missingObservationGrace/)
assert.match(nativeRuntime, /observationTimeout/)
assert.match(nativeRuntime, /Faulted\?\.Invoke/)
assert.match(nativeLoopbackSessions, /State = "faulted"/)
assert.match(nativeLoopbackServer, /sessions\.MarkFaulted/)
assert.match(nativeProof, /CngAlgorithm\.ECDsaP256/)
assert.match(nativeProof, /CngExportPolicies\.None/)
assert.match(nativeProof, /CngKeyOpenOptions\.UserKey/)
assert.doesNotMatch(nativeProof, /CngKeyCreationOptions\.MachineKey/)
assert.match(nativeRequestSigner, /IeeeP1363FixedFieldConcatenation/)
assert.match(nativeRequestSigner, /RandomNumberGenerator\.GetBytes\(24\)/)
assert.match(nativeClient, /X-Compass-Presenter-Signature/)
assert.match(nativeClient, /X-Compass-Presenter-Nonce/)
assert.match(nativeClient, /HttpStatusCode\.TooManyRequests/)
assert.match(nativeClient, /"rate_limited"/)
assert.match(proofMigration, /ticket_consumed_at is not null/)
assert.match(presenterGateway, /const CANONICAL_UPSTREAM =/)
assert.match(presenterGateway, /PRESENTER_LOCATION_RATE_LIMITER/)
assert.match(presenterGateway, /x-compass-presenter-network/i)
assert.match(presenterGatewayConfig, /"workers_dev": false/)
assert.match(presenterGatewayConfig, /"preview_urls": false/)
assert.match(
  presenterGatewayConfig,
  /"required": \["PRESENTER_BRIDGE_GATEWAY_SECRET"\]/,
)
assert.doesNotMatch(presenterGatewayConfig, /"routes"\s*:/)

console.log(
  'Phase 7.29 static PASS: secret, CORS/Origin, memory-only tokens, default-OFF, legacy Display and student paths preserved.',
)
