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
  createAdminAuthFetch,
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

const migration = read(
  'supabase/migrations/20260809143000_phase7_30b1_admin_identity_aal2.sql',
)
const edge = read('supabase/functions/admin-identity-session/index.ts')
const studentClient = read('src/lib/supabaseClient.ts')
const anonymousAuth = read('src/lib/anonymousAuth.ts')
const adminClient = read('src/lib/adminAuth/adminSupabaseClient.ts')
const adminStorage = read('src/lib/adminAuth/adminAuthStorage.ts')
const adminRoute = read('src/pages/AdminRoute.tsx')
const app = read('src/App.tsx')
const config = read('supabase/config.toml')
const workflow = read('.github/workflows/ci.yml')
const localIntegration = read('scripts/test-phase7-30b1-local-edge.mjs')

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
assert.match(
  adminRoute,
  /function normalizeAdminPathname\(pathname: string\)[\s\S]*pathname\.replace\(\/\\\/\+\$\/, ''\)[\s\S]*const adminPathname = normalizeAdminPathname\(location\.pathname\)/,
)
assert.match(adminRoute, /adminPathname === '\/admin\/auth\/callback'/)
assert.match(adminRoute, /adminPathname !== '\/admin'/)
assert.match(adminRoute, /exchangeCodeForSession/)
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

console.log('Phase 7.30 A-B1 Admin identity contract checks passed.')
