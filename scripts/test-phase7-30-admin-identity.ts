import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  createAdminLoginNonce,
  createGoogleAdminSessionToken,
  decodeVerifiedAdminJwtClaims,
  getFreshTotpAmrTimestamp,
  getTrustedGoogleIdentity,
  hasOAuthAmr,
  hmacIdentityValue,
  isGoogleAdminSessionToken,
  sha256Hex,
} from '../supabase/functions/_shared/adminIdentity.ts'
import {
  ADMIN_AI_POLICY_PENDING_STORAGE_KEY,
  ADMIN_APP_SESSION_RESTORE_SEED_STORAGE_KEY,
  ADMIN_APP_SESSION_STORAGE_KEY,
  ADMIN_AUTH_STORAGE_KEY,
  ADMIN_LEDGER_PENDING_STORAGE_KEY,
  ADMIN_OAUTH_ATTEMPT_STORAGE_KEY,
  adminAuthStorage,
  beginAdminOAuthAttempt,
  captureAdminInvitationFragment,
  clearAdminAuthStorage,
  clearAdminTabWorkspaceStorage,
  consumeAdminOAuthAttempt,
  createAdminAuthFetch,
  getAdminAuthRateLimitRemainingMs,
  parseAdminInvitationFragment,
  sanitizeAdminAuthStorageValue,
} from '../src/lib/adminAuth/adminAuthStorage.ts'

const root = fileURLToPath(new URL('..', import.meta.url))
const read = (path: string) => readFileSync(join(root, path), 'utf8')

function base64Url(value: string) {
  return Buffer.from(value, 'utf8').toString('base64url')
}

const jwt = [
  base64Url(JSON.stringify({ alg: 'RS256', typ: 'JWT' })),
  base64Url(
    JSON.stringify({
      aal: 'aal2',
      amr: [
        { method: 'oauth', timestamp: 1_785_000_000 },
        { method: 'totp', timestamp: 1_785_000_100 },
      ],
      aud: 'authenticated',
      exp: 1_785_000_600,
      iat: 1_785_000_100,
      iss: 'http://127.0.0.1:54321/auth/v1',
      session_id: '00000000-0000-4000-8000-000000000711',
      sub: '00000000-0000-4000-8000-000000000701',
    }),
  ),
  'signature',
].join('.')
const claims = decodeVerifiedAdminJwtClaims(jwt, 1_785_000_200)
assert.ok(claims)
assert.equal(claims.aal, 'aal2')
assert.equal(hasOAuthAmr(claims), true)
assert.equal(getFreshTotpAmrTimestamp(claims), 1_785_000_100)
assert.equal(
  decodeVerifiedAdminJwtClaims(jwt, 1_785_000_700),
  null,
  'expired JWTs fail closed even after Auth signature verification',
)

const identity = getTrustedGoogleIdentity([
  {
    identity_data: {
      email: 'Teacher@Example.test',
      email_verified: true,
      full_name: 'Teacher One',
      iss: 'accounts.google.com',
      provider_id: 'google-subject-1',
      sub: 'google-subject-1',
    },
    id: 'google-subject-1',
    identity_id: '00000000-0000-4000-8000-000000000799',
    provider: 'google',
  },
])
assert.deepEqual(identity, {
  displayName: 'Teacher One',
  email: 'teacher@example.test',
  issuer: 'https://accounts.google.com',
  subject: 'google-subject-1',
})
assert.equal(
  getTrustedGoogleIdentity(undefined),
  null,
  'a verified Auth user without a Google identity fails closed',
)
assert.equal(
  getTrustedGoogleIdentity([
    {
      identity_data: {
        email: 'teacher@example.test',
        email_verified: true,
        provider_id: 'different-subject',
        sub: 'google-subject-1',
      },
      id: 'different-subject',
      identity_id: '00000000-0000-4000-8000-000000000798',
      provider: 'google',
    },
  ]),
  null,
  'provider subject disagreement never creates an Admin trust root',
)

const pepper = 'phase730-test-identity-pepper-at-least-32-bytes'
assert.equal(
  await hmacIdentityValue('google-subject-1', pepper, 'subject'),
  await hmacIdentityValue('google-subject-1', pepper, 'subject'),
)
assert.notEqual(
  await hmacIdentityValue('google-subject-1', pepper, 'subject'),
  await hmacIdentityValue('google-subject-1', pepper, 'email'),
)

const nonce = createAdminLoginNonce()
const sessionSecret = 'phase730-test-session-secret-at-least-32-bytes'
const appToken = await createGoogleAdminSessionToken(nonce, sessionSecret)
assert.equal(isGoogleAdminSessionToken(appToken), true)
assert.equal(
  appToken,
  await createGoogleAdminSessionToken(nonce, sessionSecret),
  'network-uncertain completion can reproduce the same opaque app token',
)
assert.notEqual(
  appToken,
  await createGoogleAdminSessionToken(createAdminLoginNonce(), sessionSecret),
)
assert.equal((await sha256Hex(appToken)).length, 64)

const sanitized = sanitizeAdminAuthStorageValue(
  JSON.stringify({
    currentSession: {
      access_token: 'supabase-access-token',
      provider_refresh_token: 'google-refresh-secret',
      provider_token: 'google-access-secret',
      user: { provider_token: 'nested-google-secret' },
    },
  }),
)
assert.doesNotMatch(sanitized, /provider_(?:refresh_)?token/)
assert.doesNotMatch(sanitized, /google-(?:access|refresh)-secret/)
assert.match(sanitized, /supabase-access-token/)
assert.equal(
  sanitizeAdminAuthStorageValue('opaque-pkce-code-verifier'),
  'opaque-pkce-code-verifier',
)

const operationStorage = new Map<string, string>()
const authLocalStorage = new Map<string, string>()
const storageAdapter = (storage: Map<string, string>) => ({
  getItem: (key: string) => storage.get(key) ?? null,
  removeItem: (key: string) => storage.delete(key),
  setItem: (key: string, value: string) => storage.set(key, value),
})
const invitationToken = 'i'.repeat(43)
const operationLocation = {
  hash: `#invite=${invitationToken}`,
  pathname: '/admin',
  search: '',
}
const replacedHistoryUrls: string[] = []
Object.defineProperty(globalThis, 'window', {
  configurable: true,
  value: {
    history: {
      replaceState: (_state: unknown, _title: string, url: string) => {
        replacedHistoryUrls.push(url)
        operationLocation.hash = ''
      },
    },
    location: operationLocation,
    localStorage: storageAdapter(authLocalStorage),
    sessionStorage: storageAdapter(operationStorage),
  },
})

assert.deepEqual(parseAdminInvitationFragment(`#invite=${invitationToken}`), {
  kind: 'valid',
  token: invitationToken,
})
assert.equal(
  parseAdminInvitationFragment(`invite=${invitationToken}`).kind,
  'absent',
  'an invitation is accepted only from the exact URL fragment form',
)
assert.equal(
  parseAdminInvitationFragment(
    `#invite=${invitationToken}&invite=${invitationToken}`,
  ).kind,
  'invalid',
  'duplicate invitation parameters fail closed',
)
assert.equal(
  parseAdminInvitationFragment(`#invite=${invitationToken.slice(0, -1)}%69`)
    .kind,
  'invalid',
  'percent-encoded invitation tokens fail the exact fragment contract',
)
assert.deepEqual(captureAdminInvitationFragment(), {
  kind: 'valid',
  token: invitationToken,
})
assert.deepEqual(replacedHistoryUrls, ['/admin'])
assert.equal(operationLocation.hash, '')
assert.equal(
  operationStorage.size,
  0,
  'capturing the fragment keeps the token in memory until OAuth starts',
)

const oauthAttemptId = beginAdminOAuthAttempt('/admin', invitationToken)
const persistedOAuthAttempt = operationStorage.get(
  ADMIN_OAUTH_ATTEMPT_STORAGE_KEY,
)
assert.ok(persistedOAuthAttempt?.includes(invitationToken))
const consumedOAuthAttempt = consumeAdminOAuthAttempt()
assert.deepEqual(consumedOAuthAttempt, {
  id: oauthAttemptId,
  invitationToken,
  returnPath: '/admin',
})
assert.equal(operationStorage.has(ADMIN_OAUTH_ATTEMPT_STORAGE_KEY), false)
assert.equal(
  consumeAdminOAuthAttempt(),
  null,
  'the OAuth invitation handoff is one-shot',
)

beginAdminOAuthAttempt('/admin', invitationToken)
const tamperedOAuthAttempt = JSON.parse(
  operationStorage.get(ADMIN_OAUTH_ATTEMPT_STORAGE_KEY)!,
) as Record<string, unknown>
tamperedOAuthAttempt.invitationToken = 'invalid-token'
operationStorage.set(
  ADMIN_OAUTH_ATTEMPT_STORAGE_KEY,
  JSON.stringify(tamperedOAuthAttempt),
)
assert.equal(consumeAdminOAuthAttempt(), null)
assert.equal(operationStorage.has(ADMIN_OAUTH_ATTEMPT_STORAGE_KEY), false)

const operationBody = {
  action: 'update',
  rawText: 'PRIVATE LECTURE RAW BODY',
}
const firstOperationModule =
  await import('../src/lib/adminAuth/adminOperationRequestId.ts?phase730-reload=first')
const firstOperation = firstOperationModule.reserveAdminOperationRequestId(
  'manage-lectures',
  operationBody,
  '73000000-0000-4000-8000-000000000777',
)
const persistedOperationJson = [...operationStorage.values()].join('\n')
assert.doesNotMatch(persistedOperationJson, /PRIVATE LECTURE RAW BODY/)
const reloadedOperationModule =
  await import('../src/lib/adminAuth/adminOperationRequestId.ts?phase730-reload=second')
assert.equal(
  reloadedOperationModule.reserveAdminOperationRequestId(
    'manage-lectures',
    operationBody,
  ).requestId,
  firstOperation.requestId,
  'a reload must reuse the pending request ID without persisting raw body text',
)
reloadedOperationModule.clearAdminOperationRequestIds()

const verifierStorageKey = `${ADMIN_AUTH_STORAGE_KEY}-code-verifier`
adminAuthStorage.setItem(ADMIN_AUTH_STORAGE_KEY, '{"access_token":"safe"}')
adminAuthStorage.setItem(
  verifierStorageKey,
  JSON.stringify('tab-only-pkce-verifier'),
)
authLocalStorage.set(ADMIN_APP_SESSION_RESTORE_SEED_STORAGE_KEY, 'restore-seed')
operationStorage.set(ADMIN_APP_SESSION_STORAGE_KEY, 'app-session')
operationStorage.set(ADMIN_OAUTH_ATTEMPT_STORAGE_KEY, 'oauth-attempt')
operationStorage.set(ADMIN_LEDGER_PENDING_STORAGE_KEY, 'ledger-pending')
operationStorage.set(ADMIN_AI_POLICY_PENDING_STORAGE_KEY, 'policy-pending')

assert.equal(authLocalStorage.has(ADMIN_AUTH_STORAGE_KEY), true)
assert.equal(authLocalStorage.has(verifierStorageKey), false)
assert.equal(
  adminAuthStorage.getItem(verifierStorageKey),
  JSON.stringify('tab-only-pkce-verifier'),
)

clearAdminTabWorkspaceStorage()
assert.equal(
  authLocalStorage.has(ADMIN_AUTH_STORAGE_KEY),
  true,
  'passive tab cleanup must preserve the shared Supabase Auth session',
)
assert.equal(
  authLocalStorage.has(ADMIN_APP_SESSION_RESTORE_SEED_STORAGE_KEY),
  true,
  'passive tab cleanup must preserve the scoped restore seed',
)
assert.equal(
  operationStorage.get(ADMIN_OAUTH_ATTEMPT_STORAGE_KEY),
  'oauth-attempt',
  'passive tab cleanup must preserve an in-flight OAuth attempt',
)
assert.equal(
  operationStorage.get(verifierStorageKey),
  JSON.stringify('tab-only-pkce-verifier'),
  'passive tab cleanup must preserve this tab PKCE verifier',
)
assert.equal(operationStorage.has(ADMIN_APP_SESSION_STORAGE_KEY), false)
assert.equal(operationStorage.has(ADMIN_LEDGER_PENDING_STORAGE_KEY), false)
assert.equal(operationStorage.has(ADMIN_AI_POLICY_PENDING_STORAGE_KEY), false)

authLocalStorage.set(verifierStorageKey, 'legacy-shared-verifier')
clearAdminAuthStorage()
assert.equal(authLocalStorage.has(ADMIN_AUTH_STORAGE_KEY), false)
assert.equal(authLocalStorage.has(verifierStorageKey), false)
assert.equal(
  authLocalStorage.has(ADMIN_APP_SESSION_RESTORE_SEED_STORAGE_KEY),
  false,
)
assert.equal(operationStorage.has(ADMIN_OAUTH_ATTEMPT_STORAGE_KEY), false)
assert.equal(operationStorage.has(verifierStorageKey), false)
Reflect.deleteProperty(globalThis, 'window')

const adminAuthFetch = createAdminAuthFetch(
  (async () =>
    new Response(
      JSON.stringify({
        access_token: 'supabase-access-token',
        nested: { provider_token: 'nested-provider-secret' },
        provider_refresh_token: 'provider-refresh-secret',
        provider_token: 'provider-access-secret',
        refresh_token: 'supabase-refresh-token',
      }),
      { headers: { 'content-type': 'application/json; charset=utf-8' } },
    )) as typeof fetch,
  'https://example.supabase.co',
)
const sanitizedAuthResponse = await adminAuthFetch(
  'https://example.supabase.co/auth/v1/token?grant_type=refresh_token',
)
const sanitizedAuthJson = JSON.stringify(await sanitizedAuthResponse.json())
assert.doesNotMatch(sanitizedAuthJson, /provider_(?:refresh_)?token/)
assert.doesNotMatch(sanitizedAuthJson, /provider-(?:access|refresh)-secret/)
assert.match(sanitizedAuthJson, /supabase-access-token/)
assert.match(sanitizedAuthJson, /supabase-refresh-token/)

const rateLimitedAuthFetch = createAdminAuthFetch(
  (async () =>
    new Response(JSON.stringify({ message: 'rate limited' }), {
      headers: {
        'content-type': 'application/json',
        'retry-after': '2',
      },
      status: 429,
    })) as typeof fetch,
  'https://rate-limit.example.supabase.co',
)
await rateLimitedAuthFetch(
  'https://rate-limit.example.supabase.co/auth/v1/factors/factor-id/verify',
)
assert.ok(
  getAdminAuthRateLimitRemainingMs() > 1_000,
  'Auth Retry-After must suppress immediate TOTP resubmission',
)

const migration = read(
  'supabase/migrations/20260809143000_phase7_30b1_admin_identity_aal2.sql',
)
const restoreMigration = read(
  'supabase/migrations/20260825090000_admin_auth_login_restore.sql',
)
const edge = read('supabase/functions/admin-identity-session/index.ts')
const cors = read('supabase/functions/_shared/cors.ts')
const studentClient = read('src/lib/supabaseClient.ts')
const anonymousAuth = read('src/lib/anonymousAuth.ts')
const adminClient = read('src/lib/adminAuth/adminSupabaseClient.ts')
const adminStorage = read('src/lib/adminAuth/adminAuthStorage.ts')
const adminRoute = read('src/pages/AdminRoute.tsx')
const app = read('src/App.tsx')
const config = read('supabase/config.toml')
const workflow = read('.github/workflows/ci.yml')
const localIntegration = read('scripts/test-phase7-30b1-local-edge.mjs')

assert.match(
  adminRoute,
  /useLayoutEffect\(\(\) => \{[\s\S]*captureAdminInvitationFragment\(\)/,
  'the invitation fragment is scrubbed before the Admin route paints',
)
assert.match(
  adminRoute,
  /admitGoogleAdmin\([\s\S]*loginRequestIdRef\.current,[\s\S]*invitationTokenRef\.current[\s\S]*beginGoogleAdminStepUp\([\s\S]*loginRequestIdRef\.current,[\s\S]*invitationTokenRef\.current/,
  'the same in-memory invitation token reaches admission and TOTP step-up',
)
assert.match(
  adminRoute,
  /completeGoogleAdminStepUp\(\s*stepUpNonce,\s*loginRequestIdRef\.current,?\s*\)/,
  'invitation tokens never enter the completed AAL2 session request',
)

for (const table of [
  'admin_identity_runtime_gate',
  'admin_environments',
  'admin_principals',
  'admin_environment_memberships',
  'admin_invitations',
  'admin_step_up_nonces',
  'admin_audit_events',
]) {
  assert.match(migration, new RegExp(`create table private\\.${table}\\b`))
  assert.match(
    migration,
    new RegExp(`alter table private\\.${table} enable row level security;`),
  )
}
assert.match(
  migration,
  /google_session_issue_enabled boolean not null default false/,
)
assert.match(
  migration,
  /legacy_pin_login_enabled boolean not null default true/,
)
assert.match(migration, /authentication_method = 'legacy_pin'/)
assert.match(migration, /authentication_method = 'google_totp'/)
assert.match(migration, /target_aal is distinct from 2/)
assert.match(migration, /target_totp_amr_method not in \('totp', 'mfa\/totp'\)/)
assert.match(migration, /expires_at <= issued_at \+ interval '5 minutes'/)
assert.match(migration, /An environment must retain an active owner/)
assert.doesNotMatch(
  migration,
  /admin_ai_unlock|remembered.browser|lecture_ai_master/,
)

assert.match(edge, /PHASE730_ADMIN_IDENTITY_ENABLED/)
assert.match(edge, /getTrustedGoogleIdentity/)
assert.match(edge, /userData\.user\.identities/)
assert.doesNotMatch(edge, /auth\.admin\.getUserById/)
assert.match(edge, /getAuthenticatorAssuranceLevel\(bearerToken\)/)
assert.match(edge, /getFreshTotpAmrTimestamp/)
assert.match(edge, /requestOrigin/)
assert.doesNotMatch(edge, /user_metadata/)
assert.doesNotMatch(edge, /body\.environment/)
assert.match(edge, /consume_admin_identity_admission_once_v1/)
assert.equal(
  [...edge.matchAll(/await admitIdentity\(\)/g)].length,
  1,
  'one logical browser login must mutate admission exactly once',
)
assert.match(edge, /body\.action === 'restore'/)
assert.match(edge, /restore_google_admin_session_v1/)
assert.match(
  restoreMigration,
  /serialize_admin_ai_request_v1\(target_request_id\)/,
)
assert.match(restoreMigration, /action = 'admin_identity\.admit'/)
assert.match(restoreMigration, /auth_session_created_at \+ interval '8 hours'/)
assert.match(restoreMigration, /approved_totp_factor_set_hash/)
assert.match(restoreMigration, /verified_totp_factor_set_hash/)
assert.match(restoreMigration, /session\.token_hash = target_token_hash/)
assert.doesNotMatch(
  restoreMigration,
  /target_new_token_hash|set\s+token_hash\s*=/,
)
assert.match(
  restoreMigration,
  /select principal\.\*[\s\S]*?for update;[\s\S]*?select membership\.\*[\s\S]*?for update;[\s\S]*?select environment\.\*[\s\S]*?for share;[\s\S]*?select session\.\*[\s\S]*?for update;[\s\S]*?from auth\.sessions[\s\S]*?for key share;/,
  'restore must keep the canonical principal -> membership -> environment -> Admin session -> Auth session lock order',
)
assert.match(restoreMigration, /'token_restored', true/)
assert.match(
  cors,
  /'Access-Control-Expose-Headers': 'Retry-After'/,
  'the browser must be able to observe the server Retry-After header',
)

assert.equal(
  existsSync(join(root, 'supabase/functions/verify-admin-pin/index.ts')),
  false,
  'the shared Admin PIN issuer must stay removed',
)
assert.match(studentClient, /detectSessionInUrl: false/)
assert.match(anonymousAuth, /user\.is_anonymous === true/)
assert.match(adminClient, /flowType: 'pkce'/)
assert.match(adminClient, /storageKey: ADMIN_AUTH_STORAGE_KEY/)
assert.match(adminClient, /fetch: adminAuthFetch/)
assert.match(adminStorage, /createAdminAuthFetch/)
assert.match(adminStorage, /ADMIN_AUTH_REQUEST_TIMEOUT_MS = 10_000/)
assert.match(adminStorage, /provider_refresh_token/)
assert.match(adminStorage, /provider_token/)
assert.match(adminStorage, /ADMIN_APP_SESSION_RESTORE_SEED_STORAGE_KEY/)
assert.match(
  adminStorage,
  /JSON\.stringify\(\{ \.\.\.scope, seed, version: 1 \}\)/,
)
assert.match(
  adminStorage,
  /stored\.authSessionId === scope\.authSessionId[\s\S]*?stored\.authUserId === scope\.authUserId/,
)
assert.match(
  adminRoute,
  /function normalizeAdminPathname\(pathname: string\)[\s\S]*pathname\.replace\(\/\\\/\+\$\/, ''\)[\s\S]*const adminPathname = normalizeAdminPathname\(location\.pathname\)/,
)
assert.match(adminRoute, /adminPathname === '\/admin\/auth\/callback'/)
assert.match(
  adminRoute,
  /!\['\/admin', '\/admin\/settings'\]\.includes\(adminPathname\)/,
)
assert.match(adminRoute, /exchangeCodeForSession/)
assert.match(adminRoute, /queryParams: \{ prompt: 'select_account' \}/)
assert.match(
  adminRoute,
  /restoreAdminAppSessionRestoreSeed\([\s\S]*?restoreGoogleAdminSessionFromAuth\(restoreSeed\)/,
)
assert.match(
  adminRoute,
  /clearAdminAppSessionToken\(\)[\s\S]*?restoreAdminAppSessionRestoreSeed\([\s\S]*?restoreGoogleAdminSessionFromAuth\([\s\S]*?restoreSeed/,
  'a stale tab token must fall through to same-session AAL2 restore',
)
assert.match(
  adminRoute,
  /persistAdminAppSessionRestoreSeed\(stepUpNonce, transitionRecoveryScope\)/,
)
assert.match(edge, /assertAdminLoginNonce\(restoreSeed\)/)
assert.match(edge, /createGoogleAdminSessionToken\([\s\S]*?restoreSeed/)
assert.match(adminRoute, /getAdminAuthRateLimitRemainingMs/)
assert.match(adminRoute, /再試行まで \{rateLimitRemainingSeconds\} 秒/)
assert.match(adminRoute, /window\.history\.replaceState\(\{\}, '', '\/admin'\)/)
assert.match(adminRoute, /challengeAndVerify/)
assert.doesNotMatch(adminRoute, /従来PIN|AdminLegacyApp/)
assert.match(app, /location\.pathname\.startsWith\('\/admin'\)/)
assert.match(
  config,
  /\[functions\.admin-identity-session\][\s\S]*?verify_jwt = true/,
)
assert.match(
  config,
  /\[auth\.mfa\.totp\][\s\S]*?enroll_enabled = true[\s\S]*?verify_enabled = true/,
)
assert.match(config, /\[auth\.external\.google\][\s\S]*?enabled = false/)
assert.match(workflow, /TEST_ADMIN_IDENTITY_PEPPER: compass-ci-only-/)
assert.match(
  workflow,
  /Run local GoTrue TOTP and signed Google identity through Edge and database/,
)
assert.match(
  workflow,
  /printf 'ADMIN_IDENTITY_PEPPER=%s\\n' "\$TEST_ADMIN_IDENTITY_PEPPER"/,
)
assert.doesNotMatch(workflow, /^\s+ADMIN_IDENTITY_PEPPER=compass-/m)
assert.match(localIntegration, /process\.env\.TEST_ADMIN_IDENTITY_PEPPER/)
assert.match(localIntegration, /auth\.mfa\.enroll/)
assert.match(localIntegration, /auth\.mfa\.challengeAndVerify/)
assert.match(localIntegration, /aal2AuthClaims\.aal, 'aal2'/)
assert.doesNotMatch(localIntegration, /insert into auth\.mfa_factors/i)
assert.doesNotMatch(localIntegration, /update auth\.sessions\s+set aal/i)
assert.match(
  edge,
  /!body \|\| typeof body !== 'object' \|\| Array\.isArray\(body\)/,
)
assert.doesNotMatch(
  localIntegration,
  /compass-local-only-admin-identity-pepper/,
)
assert.ok(
  adminRoute.lastIndexOf("adminSupabase.auth.signOut({ scope: 'local' })") <
    adminRoute.lastIndexOf('clearAdminAuthStorage()'),
  'Supabase Auth logout must run before local Admin auth storage is cleared',
)
assert.match(
  adminRoute,
  /if \(!data\.session\) \{[\s\S]*?restoreAdminAppSessionToken\(\)[\s\S]*?clearAdminAuthStorage\(\)[\s\S]*?forgetGoogleAdminOperationSession/,
  'an app token without a backing Auth session must be cleared before OAuth',
)

console.log('Phase 7.30 A-B1 Admin identity contract checks passed.')
