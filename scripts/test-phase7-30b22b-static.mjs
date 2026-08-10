import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

const migration = read(
  'supabase/migrations/20260810113000_phase7_30b22b_ai_unlock_edge_browser.sql',
)
const pgTap = read('supabase/tests/phase7_30b22b_ai_unlock_edge_browser_test.sql')
const edge = read('supabase/functions/admin-ai-unlock/index.ts')
const shared = read('supabase/functions/_shared/adminAiUnlock.ts')
const identityEdge = read('supabase/functions/admin-identity-session/index.ts')
const aiPanel = read('src/components/AdminAiUnlockPanel.tsx')
const factorPanel = read('src/components/AdminTotpFactorControlPanel.tsx')
const route = read('src/pages/AdminRoute.tsx')
const recovery = read('src/lib/adminAuth/adminTotpTransitionRecovery.ts')
const browserCredential = read(
  'src/lib/adminAuth/rememberedBrowserCredential.ts',
)
const featureFlags = read('src/lib/featureFlags.ts')
const envExample = read('.env.local.example')
const config = read('supabase/config.toml')
const packageJson = JSON.parse(read('package.json'))
const nonlive = read('scripts/ci/run-nonlive-suite.mjs')
const workflow = read('.github/workflows/ci.yml')
const browserE2e = read('e2e/demo/phase7-30b22b-browser-storage.spec.ts')
const upgradeRunner = read('scripts/test-phase7-30-upgrade.mjs')
const upgradeFixture = read('scripts/fixtures/phase7-30b22b-b22a-head-upgrade-probe.sql')
const upgradeProbe = read('scripts/fixtures/phase7-30b22b-b22a-head-upgrade-probe-test.sql')
const concurrency = read('scripts/test-phase7-30b2-concurrency.mjs')
const confirmBrowserWindow = browserCredential.slice(
  browserCredential.indexOf('export async function confirmPendingBrowserEnrollmentWindow'),
  browserCredential.indexOf('export async function activatePendingRememberedBrowserEnrollment'),
)
const activateBrowserEnrollment = browserCredential.slice(
  browserCredential.indexOf('export async function activatePendingRememberedBrowserEnrollment'),
  browserCredential.indexOf('export async function rotatePendingBrowserCompletionRequest'),
)

assert.match(migration, /totp_factor_mutation_enabled boolean not null default false/)
assert.match(
  migration,
  /create table private\.admin_totp_factor_transitions[\s\S]*expires_at <= authorized_at \+ interval '30 minutes'/,
)
assert.match(
  migration,
  /create unique index admin_totp_factor_transition_authorized_principal_idx[\s\S]*where status = 'authorized'/,
)
assert.match(
  migration,
  /create index admin_totp_factor_transition_principal_idx\s+on private\.admin_totp_factor_transitions \(principal_id, status\)/,
)
assert.match(pgTap, /idx\.indpred IS NULL/)
assert.match(pgTap, /full non-partial leading lookup index/)
assert.doesNotMatch(migration, /status in \([^)]*cancelled/)
assert.match(
  migration,
  /status = 'finalized'[\s\S]*finalize_request_id is not null[\s\S]*finalized_post_version is not null[\s\S]*finalized_at is not null[\s\S]*status <> 'finalized'[\s\S]*finalize_request_id is null[\s\S]*finalized_post_version is null[\s\S]*finalized_at is null/,
)
assert.match(pgTap, /non-finalized transitions reject partial terminal evidence/)
assert.match(
  migration,
  /if not private\.try_serialize_admin_ai_scope_v1\([\s\S]*'totp-factor-transition-principal'[\s\S]*return null;/,
)
assert.match(
  migration,
  /set status = 'expired'[\s\S]*expires_at <= effective_now;[\s\S]*limit 25/,
)
assert.match(
  migration,
  /Do not consume the competing grant[\s\S]*return null;[\s\S]*select grant\.\* into grant_row/,
)
const finalizeTransition = migration.match(
  /create function private\.finalize_admin_totp_factor_transition_v1[\s\S]*?\n\$\$;/,
)?.[0] ?? ''
const finalizePrincipalLock = finalizeTransition.indexOf(
  'select principal.* into principal_row',
)
const finalizeMembershipLock = finalizeTransition.indexOf(
  'select membership.* into membership_row',
)
const finalizeSessionLock = finalizeTransition.indexOf(
  'select session.* into session_row',
)
const finalizeAdvisory = finalizeTransition.indexOf(
  "'totp-factor-transition-principal'",
)
const finalizeTransitionLock = finalizeTransition.indexOf(
  'select transition.* into transition_row',
)
assert.ok(
  finalizePrincipalLock >= 0 &&
    finalizePrincipalLock < finalizeMembershipLock &&
    finalizeMembershipLock < finalizeSessionLock &&
    finalizeSessionLock < finalizeAdvisory &&
    finalizeAdvisory < finalizeTransitionLock,
  'finalize must lock principal -> membership -> session -> advisory -> transition',
)
assert.doesNotMatch(
  finalizeTransition.slice(0, finalizePrincipalLock),
  /select transition\.\* into transition_row[\s\S]*for update/,
  'finalize must not lock a transition before the principal',
)
assert.ok(
  finalizePrincipalLock < finalizeAdvisory,
  'finalize must lock the principal before the principal transition advisory',
)
assert.ok(
  finalizeMembershipLock < finalizeAdvisory,
  'finalize must lock the membership before the principal transition advisory',
)
const controlCleanup = migration.match(
  /create or replace function private\.cleanup_admin_control_step_up_ephemera_v1[\s\S]*?\n\$\$;/,
)?.[0] ?? ''
assert.ok(
  controlCleanup.indexOf(
    'delete from private.admin_totp_factor_transitions as transition',
  ) <
    controlCleanup.indexOf(
      'delete from private.admin_control_step_up_grants as grant',
    ) &&
    controlCleanup.indexOf(
      'delete from private.admin_control_step_up_grants as grant',
    ) <
      controlCleanup.indexOf(
        'delete from private.admin_control_step_up_nonces as nonce',
      ),
  'retention must delete transition -> grant -> nonce',
)
assert.match(controlCleanup, /for update of transition skip locked[\s\S]*limit 500/)
assert.match(
  controlCleanup,
  /not exists \([\s\S]*admin_totp_factor_transitions[\s\S]*control_grant_id = grant\.id/,
)
assert.match(controlCleanup, /'transitions_deleted', deleted_transitions/)
assert.match(
  migration,
  /grant execute on function private\.cleanup_admin_control_step_up_ephemera_v1\([\s\S]*timestamptz, uuid[\s\S]*\) to service_role/,
)
assert.match(
  migration,
  /target_action = 'totp_factor_remove' and live_count < 1/,
)
const describeTransition = migration.match(
  /create function private\.describe_admin_totp_factor_transition_v1[\s\S]*?\n\$\$;/,
)?.[0] ?? ''
assert.doesNotMatch(
  describeTransition,
  /current_verified_totp_factor_set_snapshot_v1/,
)
assert.match(
  describeTransition,
  /array_agg\(factor\.id order by factor\.id::text\)[\s\S]*max\(factor\.status\)[\s\S]*into live_ids, target_status[\s\S]*live_count := cardinality\(live_ids\)[\s\S]*live_hash := private\.hash_verified_totp_factor_ids_v1\([\s\S]*target_auth_user_id,[\s\S]*live_ids/,
)
assert.equal(
  (describeTransition.match(/from auth\.mfa_factors as factor/g) ?? []).length,
  1,
  'factor-transition intent must use exactly one Auth factor aggregate scan',
)
assert.match(pgTap, /one aggregate snapshot/)
assert.match(pgTap, /no split scalar factor-set read/)
assert.doesNotMatch(migration, /context_value ->> 'expires_at'/)
assert.match(
  migration,
  /least\([\s\S]*app_session\.expires_at[\s\S]*auth_session\.created_at \+ interval '8 hours'[\s\S]*app_session\.id = \(context_value ->> 'admin_session_id'\)::uuid/,
)
assert.match(
  migration,
  /approved_totp_factor_set_source = 'rare_control_transition'/,
)
assert.match(
  migration,
  /revoke_reason = 'totp_factor_set_changed'/,
)
assert.doesNotMatch(
  migration.match(
    /create or replace function private\.drain_admin_ai_on_session_revoke_v1\(\)[\s\S]*?\$\$;/,
  )?.[0] ?? '',
  /admin_ai_browser_credentials[\s\S]*status = 'revoked'/,
)
assert.doesNotMatch(
  migration,
  /credential_row\.enrolled_by_admin_session_id <> new\.admin_session_id/,
)
assert.match(migration, /where session\.id = new\.admin_session_id/)
assert.match(
  migration,
  /new\.supabase_auth_session_id := session_row\.supabase_auth_session_id/,
)
assert.match(
  migration,
  /revoke all on private\.admin_totp_factor_transitions[\s\S]*service_role/,
)
assert.doesNotMatch(migration, /grant (select|insert|update|delete) on private\./i)

assert.match(config, /\[functions\.admin-ai-unlock\][\s\S]*verify_jwt = true/)
assert.match(edge, /const FACTOR_ENTRY_ACTIONS[\s\S]*'authorizeTotpTransition'[\s\S]*'prepareTotpTransition'/)
assert.doesNotMatch(
  edge.match(/const FACTOR_ENTRY_ACTIONS[\s\S]*?\]\)/)?.[0] ?? '',
  /finalizeTotpTransition/,
)
assert.match(
  edge,
  /PHASE730_ADMIN_TOTP_FACTOR_MUTATION_ENABLED[\s\S]*feature_disabled/,
)
assert.match(
  identityEdge,
  /TOTP_FACTOR_CONTROL_ACTIONS[\s\S]*PHASE730_ADMIN_TOTP_FACTOR_MUTATION_ENABLED/,
)
assert.match(edge, /if \(action !== 'finalizeTotpTransition'\)/)
assert.match(edge, /authorityIssued: false/)
assert.match(edge, /dormantProof: true/)
assert.doesNotMatch(edge, /issue_admin_ai_master|activate_admin_ai_master/)
assert.match(edge, /if \(action === 'verifyPin'\)[\s\S]*ADMIN_AI_NETWORK_PEPPER/)
assert.match(
  edge,
  /if \(action === 'completeBrowserEnrollment'\)[\s\S]*ADMIN_AI_NETWORK_PEPPER/,
)
const transitionHandlers = edge.match(
  /if \(action === 'prepareTotpTransition'\)[\s\S]*if \(action === 'finalizeTotpTransition'\)[\s\S]*?return jsonResponse\([\s\S]*?\n  }/,
)?.[0] ?? ''
assert.doesNotMatch(transitionHandlers, /ADMIN_AI_NETWORK_PEPPER/)
assert.match(edge, /action === 'preparePinMutation'[\s\S]*FOUR_DIGIT_PIN_PATTERN\.test\(body\.pin\)[\s\S]*service_unavailable/)
assert.match(edge, /action === 'setPin'[\s\S]*FOUR_DIGIT_PIN_PATTERN\.test\(body\.pin\)[\s\S]*service_unavailable/)
assert.match(edge, /action === 'completeBrowserEnrollment'[\s\S]*FOUR_DIGIT_PIN_PATTERN\.test\(body\.pin\)[\s\S]*pin_denied[\s\S]*service_unavailable/)
assert.match(shared, /P-256/)
assert.match(shared, /canonicalizeBrowserAssertionPayload/)
assert.match(shared, /verifyP256P1363Signature/)

assert.match(browserCredential, /namedCurve: 'P-256' },\s*false,/)
assert.match(browserCredential, /indexedDB/)
assert.doesNotMatch(browserCredential, /localStorage/)
assert.doesNotMatch(browserCredential, /\bpin\b/i)
assert.match(browserCredential, /enrollmentExpiresAt/)
assert.match(browserCredential, /type RememberedBrowserIdentityScope[\s\S]*environmentId[\s\S]*membershipId[\s\S]*principalId/)
assert.match(browserCredential, /sameScope\(credential, scope\)/)
assert.match(browserCredential, /credential\.status === 'active'[\s\S]*Date\.parse\(credential\.expiresAt\) <= Date\.now\(\)[\s\S]*store\.delete\(credential\.id\)/)
assert.match(browserCredential, /withStore\('readwrite'[\s\S]*store\.getAll\(\)[\s\S]*store\.add\(credential\)/)
assert.match(browserCredential, /Date\.parse\(existing\.enrollmentExpiresAt\) > Date\.now\(\)[\s\S]*store\.delete\(existing\.id\)[\s\S]*store\.add\(credential\)/)
assert.match(browserCredential, /confirmPendingBrowserEnrollmentWindow/)
assert.doesNotMatch(confirmBrowserWindow, /current\?\.status === 'active'/)
assert.match(activateBrowserEnrollment, /current\?\.status === 'active'[\s\S]*current\.expiresAt === expiresAt[\s\S]*sameCredentialProvenance\(current, expected\)[\s\S]*return current/)
assert.match(browserCredential, /samePendingEnrollment[\s\S]*store\.delete\(expected\.id\)/)
assert.match(aiPanel, /const \[browserPin, setBrowserPin\]/)
assert.doesNotMatch(aiPanel, /縺|繧|謇ｿ隱/)
assert.match(aiPanel, /const submittedPin = browserPin[\s\S]*setBrowserPin\(''\)/)
assert.match(aiPanel, /if \(!profile\.canUseAi\)/)
assert.match(aiPanel, /AI PINと記憶ブラウザの設定は表示しません/)
assert.match(aiPanel, /const factorId = await getVerifiedFactorId\(\)[\s\S]*beginAdminControlStepUp/)
assert.match(aiPanel, /error\.code !== 'control_proof_required'/)
assert.match(aiPanel, /getRememberedBrowserEnrollmentStatus[\s\S]*remoteStatus\.status === 'active'[\s\S]*activatePendingRememberedBrowserEnrollment/)
assert.match(aiPanel, /credential\.enrollmentExpiresAt[\s\S]*createPendingRememberedBrowserEnrollment\(identityScope\)/)
assert.match(aiPanel, /confirmPendingBrowserEnrollmentWindow[\s\S]*beginRequestId/)
assert.doesNotMatch(aiPanel, /catch \(error\) \{[\s\S]{0,160}clearRememberedBrowserCredential\(credential\.id\)/)
assert.match(aiPanel, /pendingControl !== null && !completingPendingPin/)
assert.match(aiPanel, /if \(busy \|\| pendingControl\) return/)
assert.match(
  aiPanel,
  /setupRememberedBrowser[\s\S]*busy \|\| pendingControl/,
)
assert.match(aiPanel, /phase: 'authorization' as const[\s\S]*completeAdminControlStepUp/)
assert.match(aiPanel, /retryPendingControlAuthorization/)

assert.match(featureFlags, /VITE_PHASE7_30_ADMIN_TOTP_FACTOR_MUTATION/)
assert.match(envExample, /VITE_PHASE7_30_ADMIN_TOTP_FACTOR_MUTATION=false/)
assert.match(route, /isPhase730AdminTotpFactorMutationEnabled[\s\S]*AdminTotpFactorControlPanel/)
assert.match(route, /isPhase730AdminAiUnlockEnabled[\s\S]*AdminAiUnlockPanel/)
assert.match(route, /AdminAiUnlockPanel[\s\S]*environmentId: session\.environmentId[\s\S]*membershipId: session\.membershipId[\s\S]*principalId: session\.principalId/)
assert.ok(
  route.indexOf('restoreAdminTotpTransitionRecovery(') <
    route.indexOf('restoreGoogleAdminSession(appSessionToken)'),
  'recovery finalization must precede app-session touch/restore',
)
assert.doesNotMatch(route, /cancelTotpTransition|安全にキャンセル/)
assert.match(route, /transitionRecovery\.action === 'totp_factor_remove'/)
const routeRecoveryRetry = route.match(
  /async function retryTotpTransitionRecovery\(\)[\s\S]*?\n  }\n\n  const transitionRecoveryExpired/,
)?.[0] ?? ''
const recoveryFinalizeIndex = routeRecoveryRetry.indexOf(
  'await finalizePersistedTotpFactorTransition(',
)
const recoveryAuthorizeIndex = routeRecoveryRetry.indexOf(
  'await authorizeAndPersistTotpFactorTransition(',
)
const recoveryUnenrollIndex = routeRecoveryRetry.indexOf(
  'await adminSupabase.auth.mfa.unenroll(',
)
const recoveryCandidateVerifyIndex = routeRecoveryRetry.indexOf(
  'await adminSupabase.auth.mfa.challengeAndVerify(',
)
assert.ok(
  recoveryFinalizeIndex >= 0 &&
    recoveryFinalizeIndex < recoveryAuthorizeIndex &&
    recoveryAuthorizeIndex < recoveryUnenrollIndex &&
    recoveryAuthorizeIndex < recoveryCandidateVerifyIndex,
  'recovery must finalize-first, reconfirm exact DB authorization, then mutate GoTrue MFA',
)
assert.match(
  routeRecoveryRetry,
  /const recoveryAppSessionToken = restoreAdminAppSessionToken\(\)[\s\S]*if \(!recoveryAppSessionToken\)[\s\S]*authorizeAndPersistTotpFactorTransition[\s\S]*mutationRequestId: transitionRecovery\.mutationRequestId[\s\S]*recoveryExpiresAt: transitionRecovery\.expiresAt/,
)
assert.match(route, /transitionRecovery\.action === 'totp_factor_remove'[\s\S]*else \{[\s\S]*challengeAndVerify[\s\S]*finalizePersistedTotpFactorTransition/)
assert.match(route, /transitionCandidateCode[\s\S]*追加先の認証アプリに表示された6桁コード/)
assert.match(route, /期限切れ後の本人確認へ進む/)
assert.match(recovery, /finalizeRequestId: crypto\.randomUUID\(\)/)
assert.match(recovery, /lost success response must[\s\S]*recoverable after tab close/i)
assert.match(recovery, /indexedDB\.open/)
assert.match(recovery, /crypto\.getRandomValues\(new Uint8Array\(32\)\)/)
assert.match(recovery, /store\.add\(candidate\)/)
assert.match(recovery, /error\.recoveryUnused[\s\S]*compareAndDeleteStoredRecovery\(recovery\)/)
assert.match(
  recovery,
  /An existing claim was intentionally persisted[\s\S]*sameTransition\(current, input\)[\s\S]*expiresAt <= Date\.now\(\) \+ 5 \* 60 \* 1_000/,
)
assert.match(recovery, /purgeExpiredAdminTotpTransitionRecovery/)
assert.match(route, /purgeExpiredAdminTotpTransitionRecovery\(transitionRecoveryScope\)/)
assert.doesNotMatch(recovery, /clearAdminTotpTransitionRecovery/)
assert.match(
  recovery,
  /type AdminTotpTransitionRecoveryScope[\s\S]*authSessionId: string[\s\S]*authUserId: string/,
)
assert.match(
  recovery,
  /payload\.sub !== authUserId[\s\S]*payload\.session_id[\s\S]*recoveryId\(scope\)/,
)
assert.match(
  recovery,
  /store\.get\(id\)[\s\S]*sameScope\(value, scope\)[\s\S]*store\.delete\(id\)/,
)
assert.match(route, /getAdminTotpTransitionRecoveryScope\([\s\S]*data\.session\.user\.id[\s\S]*data\.session\.access_token/)
assert.match(factorPanel, /recoveryScope: AdminTotpTransitionRecoveryScope/)
assert.match(packageJson.scripts['test:e2e:phase7-30b22b-browser'], /desktop-chromium[\s\S]*desktop-webkit/)
assert.match(workflow, /npm run test:e2e:phase7-30b22b-browser/)
assert.match(browserE2e, /exportKey\('pkcs8', pending\.privateKey\)/)
assert.match(browserE2e, /Promise\.all\(\[create\(page\), create\(secondPage\)\]\)/)
assert.match(browserE2e, /scopeA[\s\S]*scopeB[\s\S]*otherTeacherAfter/)
assert.match(browserE2e, /recoveryScopeA[\s\S]*recoveryScopeB[\s\S]*restoreAdminTotpTransitionRecovery/)
assert.match(
  browserE2e,
  /transport failure before the Edge\/DB request commits[\s\S]*restoreAdminTotpTransitionRecovery[\s\S]*authorizeAndPersistTotpFactorTransition[\s\S]*new Set\(recoveryTokens\)\.size/,
)
assert.match(
  browserE2e,
  /five-minute boundary[\s\S]*recoveryUnused: true[\s\S]*4 \* 60_000[\s\S]*restoreAdminTotpTransitionRecovery\(scope\)\) === null/,
)
assert.match(upgradeRunner, /--version'[\s\S]*20260809231342[\s\S]*phase7-30b22b-b22a-head-upgrade-probe\.sql[\s\S]*phase7-30b22b-b22a-head-upgrade-probe-test\.sql/)
assert.match(upgradeFixture, /approved_totp_factor_set_source = 'operator_adoption'/)
assert.match(upgradeProbe, /without inferred trust binding[\s\S]*pending pre-B2\.2b enrollment is superseded without backfill[\s\S]*all B2\.2b source gates remain default OFF/)
assert.match(concurrency, /PHASE730B22B_TRANSITION_SLOT_READY[\s\S]*recordNullableServiceResult[\s\S]*transition-authorize-busy[\s\S]*status[\s\S]*available[\s\S]*transition-authorize-release/)
assert.match(
  concurrency,
  /PHASE730B22B_TRANSITION_EXPIRY_AUTHORIZE_READY[\s\S]*pg_catalog\.pg_stat_clear_snapshot\(\)[\s\S]*phase730b22b-transition-finalize-waiter[\s\S]*wait_event_type = 'Lock'[\s\S]*transition-finalize-at-expiry[\s\S]*transition-authorize-after-expiry/,
)
assert.doesNotMatch(concurrency, /transition-expiry-release/)
assert.match(
  concurrency,
  /transition-retention-cleanup[\s\S]*transitions_deleted[\s\S]*transition\/grant\/nonce retention order did not converge/,
)
assert.match(edge, /P7334[\s\S]*recoveryUnused: true/)
assert.match(edge, /recoveryExpiresAt: value\.recovery_expires_at/)
assert.match(factorPanel, /recoveryExpiresAt: prepared\.recoveryExpiresAt/)
assert.doesNotMatch(recovery, /transitionCandidateCode|totpCode|qrCode|cancelRequestId|appSessionReference/)

assert.match(factorPanel, /requireApprovalFactor/)
assert.match(factorPanel, /factors\.length < 2/)
assert.match(factorPanel, /authorizeAndPersistTotpFactorTransition/)
assert.match(factorPanel, /error\.code !== 'control_proof_required'/)
assert.match(factorPanel, /await finishFinalization\(\)[\s\S]*adminSupabase\.auth\.mfa\.unenroll/)
assert.match(factorPanel, /pending\.phase !== 'upstream_add'[\s\S]*await finishFinalization\(\)[\s\S]*challengeAndVerify/)
assert.match(factorPanel, /pending\.phase === 'control'[\s\S]*Scan this QR code before authorizing/)

const browserBeginHandler = edge.match(
  /if \(action === 'beginBrowserEnrollment'\)[\s\S]*?if \(action === 'getBrowserEnrollmentStatus'\)/,
)?.[0] ?? ''
assert.match(browserBeginHandler, /OPAQUE_BROWSER_TOKEN_PATTERN\.test\(body\.enrollmentNonce\)/)
assert.match(browserBeginHandler, /target_nonce_hash: await sha256Hex\(body\.enrollmentNonce\)/)
assert.doesNotMatch(browserBeginHandler, /createOpaqueBrowserToken\(\)/)
assert.match(edge, /get_admin_ai_browser_credential_status_v1/)

assert.equal(
  packageJson.scripts['test:phase7-30b22b-static'],
  'node scripts/test-phase7-30b22b-static.mjs',
)
assert.match(nonlive, /'test:phase7-30b22b-static'/)
assert.match(workflow, /admin-ai-unlock/)

console.log('Phase 7.30 B2.2b static contract passed.')
