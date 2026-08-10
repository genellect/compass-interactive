import assert from 'node:assert/strict'
import { createHmac, randomBytes, randomUUID } from 'node:crypto'
import { execFileSync, spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { createClient } from '@supabase/supabase-js'

const require = createRequire(import.meta.url)
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

const container =
  process.env.SUPABASE_DB_CONTAINER ?? 'supabase_db_compass-interactive'
const expectedOrigin = 'http://127.0.0.1:4173'
const environmentId = '00000000-0000-4000-8000-000000000730'
const identityPepper = process.env.TEST_ADMIN_IDENTITY_PEPPER?.trim() ?? ''
assert.ok(
  identityPepper.length >= 32,
  'TEST_ADMIN_IDENTITY_PEPPER must be a synthetic value of at least 32 characters.',
)
const email = `phase730-${randomUUID()}@example.test`
const otherOwnerEmail = `phase730-owner-${randomUUID()}@example.test`
const googleSubject = `phase730-google-${randomBytes(16).toString('hex')}`
const password = `Phase730!${randomBytes(24).toString('base64url')}`
let authUserId = null
let sessionId = null
let failure

function sqlLiteral(value) {
  return `'${String(value).replaceAll("'", "''")}'`
}

function runSql(sql) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      'docker',
      [
        'exec',
        '-i',
        container,
        'psql',
        '-X',
        '-q',
        '-t',
        '-A',
        '-v',
        'ON_ERROR_STOP=1',
        '-U',
        'postgres',
        '-d',
        'postgres',
        '-c',
        sql,
      ],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    )
    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk) => {
      stdout += chunk
    })
    child.stderr.on('data', (chunk) => {
      stderr += chunk
    })
    child.on('error', reject)
    child.on('exit', (code) => {
      if (code === 0) resolve(stdout.trim())
      else reject(new Error(stderr.trim() || `psql exited with ${code}`))
    })
  })
}

function getLocalStatus() {
  const executable =
    process.platform === 'win32'
      ? join(
          dirname(
            require.resolve(
              `@supabase/cli-windows-${process.arch}/package.json`,
            ),
          ),
          'bin',
          'supabase.exe',
        )
      : 'npx'
  const args =
    process.platform === 'win32'
      ? ['status', '-o', 'json']
      : ['supabase', 'status', '-o', 'json']
  const output = execFileSync(executable, args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const status = JSON.parse(output)
  const url = new URL(status.API_URL)
  assert.ok(
    ['127.0.0.1', 'localhost'].includes(url.hostname),
    'The Admin identity integration test refuses non-local Supabase URLs.',
  )
  assert.ok(status.JWT_SECRET?.length >= 32)
  assert.ok(status.SERVICE_ROLE_KEY)
  assert.ok(status.PUBLISHABLE_KEY || status.ANON_KEY)
  return status
}

function hmacIdentity(value, domain) {
  return createHmac('sha256', identityPepper)
    .update(`phase730:${domain}:${value}`)
    .digest('hex')
}

function jwtPart(value) {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url')
}

function decodeJwtPayload(token) {
  const encoded = token.split('.')[1]
  assert.ok(encoded, 'The local Auth JWT payload is missing.')
  return JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'))
}

function latestTotpAmrTimestamp(claims) {
  const timestamps = (claims.amr ?? [])
    .filter(
      (entry) => entry?.method === 'totp' || entry?.method === 'mfa/totp',
    )
    .map((entry) => entry.timestamp)
    .filter(Number.isSafeInteger)
  return timestamps.length > 0 ? Math.max(...timestamps) : null
}

function decodeBase32(value) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
  let buffer = 0
  let bits = 0
  const bytes = []
  for (const character of value.replaceAll('=', '').toUpperCase()) {
    const index = alphabet.indexOf(character)
    assert.notEqual(index, -1, 'The local TOTP secret is not valid base32.')
    buffer = (buffer << 5) | index
    bits += 5
    while (bits >= 8) {
      bits -= 8
      bytes.push((buffer >>> bits) & 0xff)
      buffer &= (1 << bits) - 1
    }
  }
  return Buffer.from(bytes)
}

function currentTotp(secret, now = Date.now()) {
  const counter = Buffer.alloc(8)
  counter.writeBigUInt64BE(BigInt(Math.floor(now / 30_000)))
  const digest = createHmac('sha1', decodeBase32(secret))
    .update(counter)
    .digest()
  const offset = digest[digest.length - 1] & 0x0f
  const value =
    (((digest[offset] & 0x7f) << 24) |
      ((digest[offset + 1] & 0xff) << 16) |
      ((digest[offset + 2] & 0xff) << 8) |
      (digest[offset + 3] & 0xff)) %
    1_000_000
  return value.toString().padStart(6, '0')
}

async function waitForNextTotpWindow() {
  const waitMs = 30_000 - (Date.now() % 30_000) + 750
  await new Promise((resolve) => setTimeout(resolve, waitMs))
}

function signAccessToken(status, claims) {
  const encodedHeader = jwtPart({ alg: 'HS256', typ: 'JWT' })
  const encodedPayload = jwtPart(claims)
  const signature = createHmac('sha256', status.JWT_SECRET)
    .update(`${encodedHeader}.${encodedPayload}`)
    .digest('base64url')
  return `${encodedHeader}.${encodedPayload}.${signature}`
}

function accessToken(status, { aal, totpTimestamp = null }) {
  assert.ok(sessionId, 'The local Auth session must exist before JWT signing.')
  const now = Math.floor(Date.now() / 1_000)
  const amr = [{ method: 'oauth', timestamp: now - 30 }]
  if (totpTimestamp !== null) {
    amr.push({ method: 'totp', timestamp: totpTimestamp })
  }
  return signAccessToken(status, {
    aal,
    amr,
    app_metadata: { provider: 'google', providers: ['google'] },
    aud: 'authenticated',
    email,
    exp: now + 3_600,
    iat: now,
    is_anonymous: false,
    iss: `${status.API_URL}/auth/v1`,
    role: 'authenticated',
    session_id: sessionId,
    sub: authUserId,
    user_metadata: { full_name: 'Phase 7.30 Local Owner' },
  })
}

async function invoke(status, jwt, path, body, expectedStatus) {
  const response = await fetch(`${status.API_URL}/functions/v1/${path}`, {
    body: JSON.stringify(body),
    headers: {
      apikey: status.PUBLISHABLE_KEY || status.ANON_KEY,
      Authorization: `Bearer ${jwt}`,
      'Content-Type': 'application/json',
      Origin: expectedOrigin,
    },
    method: 'POST',
    redirect: 'manual',
  })
  const responseBody = await response.json()
  assert.equal(response.status, expectedStatus, JSON.stringify(responseBody))
  assert.match(response.headers.get('cache-control') ?? '', /no-store/i)
  return responseBody
}

async function waitForAdminIdentityEdge(status) {
  const deadline = Date.now() + 30_000
  let lastStatus = 0
  while (Date.now() < deadline) {
    try {
      const response = await fetch(
        `${status.API_URL}/functions/v1/admin-identity-session`,
        {
          body: JSON.stringify({ action: 'readiness_probe' }),
          headers: {
            apikey: status.PUBLISHABLE_KEY || status.ANON_KEY,
            Authorization: `Bearer ${status.PUBLISHABLE_KEY || status.ANON_KEY}`,
            'Content-Type': 'application/json',
            Origin: expectedOrigin,
          },
          method: 'POST',
          redirect: 'manual',
        },
      )
      lastStatus = response.status
      if (response.status === 400) {
        const body = await response.json()
        assert.equal(body.code, 'request_invalid')
        return
      }
    } catch {
      lastStatus = 0
    }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error(
    `Admin identity Edge Function did not become ready (last status ${lastStatus}).`,
  )
}

const status = getLocalStatus()
const serviceClient = createClient(status.API_URL, status.SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})
const authClient = createClient(
  status.API_URL,
  status.PUBLISHABLE_KEY || status.ANON_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } },
)

try {
  await waitForAdminIdentityEdge(status)
  const { data: created, error: createError } =
    await serviceClient.auth.admin.createUser({
      email,
      email_confirm: true,
      password,
      user_metadata: { full_name: 'Phase 7.30 Local Owner' },
    })
  if (createError) throw createError
  authUserId = created.user.id

  const { data: signedIn, error: signInError } =
    await authClient.auth.signInWithPassword({ email, password })
  if (signInError) throw signInError
  assert.ok(signedIn.session?.access_token)
  const aal1AuthClaims = decodeJwtPayload(signedIn.session.access_token)
  assert.equal(aal1AuthClaims.aal, 'aal1')
  assert.equal(aal1AuthClaims.sub, authUserId)
  assert.match(aal1AuthClaims.session_id, UUID_PATTERN)
  sessionId = aal1AuthClaims.session_id

  const { data: enrolled, error: enrollError } =
    await authClient.auth.mfa.enroll({
      factorType: 'totp',
      friendlyName: 'Phase 7.30 Local TOTP',
      issuer: 'COMPASS Interactive Local Gate',
    })
  if (enrollError) throw enrollError
  assert.match(enrolled.id, UUID_PATTERN)
  assert.match(enrolled.totp.secret, /^[A-Z2-7]+=*$/)

  await runSql(`
    insert into auth.identities (
      provider_id, user_id, identity_data, provider,
      last_sign_in_at, created_at, updated_at
    ) values (
      ${sqlLiteral(googleSubject)},
      ${sqlLiteral(authUserId)}::uuid,
      ${sqlLiteral(
        JSON.stringify({
          email,
          email_verified: true,
          full_name: 'Phase 7.30 Local Owner',
          iss: 'https://accounts.google.com',
          provider_id: googleSubject,
          sub: googleSubject,
        }),
      )}::jsonb,
      'google',
      statement_timestamp(),
      statement_timestamp(),
      statement_timestamp()
    );
    update auth.users
    set raw_app_meta_data =
      '{"provider":"google","providers":["google"]}'::jsonb,
        updated_at = statement_timestamp()
    where id = ${sqlLiteral(authUserId)}::uuid;
    select public.bootstrap_admin_environment_v1(
      ${sqlLiteral(environmentId)}::uuid,
      'local',
      ${sqlLiteral(expectedOrigin)},
      ${sqlLiteral(`${status.API_URL}/auth/v1`)},
      'authenticated',
      array[
        ${sqlLiteral(hmacIdentity(email, 'email'))},
        ${sqlLiteral(hmacIdentity(otherOwnerEmail, 'email'))}
      ]::text[],
      statement_timestamp() + interval '1 hour',
      ${sqlLiteral(randomUUID())}::uuid
    );
    update private.admin_identity_runtime_gate
    set google_session_issue_enabled = true,
        updated_at = statement_timestamp()
    where singleton;
    update private.admin_ai_unlock_runtime_gate
    set ai_unlock_enabled = true,
        updated_at = statement_timestamp()
    where singleton;
  `)

  const aal1 = accessToken(status, { aal: 'aal1' })
  const malformed = await invoke(
    status,
    aal1,
    'admin-identity-session',
    { action: 'admit', invitationToken: 730 },
    400,
  )
  assert.equal(malformed.code, 'request_invalid')

  const admitted = await invoke(
    status,
    aal1,
    'admin-identity-session',
    { action: 'admit' },
    200,
  )
  assert.equal(admitted.eligible, true)

  const begun = await invoke(
    status,
    aal1,
    'admin-identity-session',
    { action: 'beginStepUp', challengedFactorId: enrolled.id },
    200,
  )
  assert.match(begun.stepUpNonce, /^[A-Za-z0-9_-]{43}$/)

  const rejectedAal1 = await invoke(
    status,
    aal1,
    'admin-identity-session',
    { action: 'completeStepUp', stepUpNonce: begun.stepUpNonce },
    401,
  )
  assert.equal(rejectedAal1.code, 'aal2_required')

  await new Promise((resolve) => setTimeout(resolve, 1_100))
  const { data: verified, error: verifyError } =
    await authClient.auth.mfa.challengeAndVerify({
      code: currentTotp(enrolled.totp.secret),
      factorId: enrolled.id,
    })
  if (verifyError) throw verifyError
  assert.ok(verified.access_token)
  const aal2AuthClaims = decodeJwtPayload(verified.access_token)
  assert.equal(aal2AuthClaims.aal, 'aal2')
  assert.equal(aal2AuthClaims.session_id, sessionId)
  const verifiedTotpAmrTimestamp = latestTotpAmrTimestamp(aal2AuthClaims)
  assert.ok(Number.isSafeInteger(verifiedTotpAmrTimestamp))
  assert.equal(aal2AuthClaims.app_metadata?.provider, 'google')
  const aal2 = verified.access_token

  const completed = await invoke(
    status,
    aal2,
    'admin-identity-session',
    { action: 'completeStepUp', stepUpNonce: begun.stepUpNonce },
    200,
  )
  assert.match(completed.appSessionToken, /^g1\.[A-Za-z0-9_-]{43}$/)
  assert.equal(completed.session?.role, 'owner')
  assert.equal(completed.session?.canUseAi, false)

  const replayed = await invoke(
    status,
    aal2,
    'admin-identity-session',
    { action: 'completeStepUp', stepUpNonce: begun.stepUpNonce },
    200,
  )
  assert.equal(replayed.appSessionToken, completed.appSessionToken)
  assert.deepEqual(replayed.session, completed.session)

  const restored = await invoke(
    status,
    aal2,
    'admin-identity-session',
    { action: 'status', appSessionToken: completed.appSessionToken },
    200,
  )
  assert.equal(restored.session?.id, completed.session.id)

  const controlRequestId = randomUUID()
  const controlIntentDigest = randomBytes(32).toString('hex')
  const controlBegunAt = Math.floor(Date.now() / 1_000)
  const controlBegun = await invoke(
    status,
    aal2,
    'admin-identity-session',
    {
      action: 'beginControlStepUp',
      appSessionToken: completed.appSessionToken,
      controlAction: 'environment_ai_policy_change',
      controlIntentDigest,
      controlRequestId,
    },
    200,
  )
  assert.match(controlBegun.controlStepUpNonce, /^[A-Za-z0-9_-]{43}$/)
  assert.equal(controlBegun.controlIntentDigest, controlIntentDigest)

  // GoTrue's AAL2 -> AAL2 freshness semantics are not documented. Keep this
  // real same-factor exchange in Local CI as the B2.2a activation proof.
  await waitForNextTotpWindow()
  const { data: reverified, error: reverifyError } =
    await authClient.auth.mfa.challengeAndVerify({
      code: currentTotp(enrolled.totp.secret),
      factorId: enrolled.id,
    })
  if (reverifyError) throw reverifyError
  assert.ok(reverified.access_token)
  assert.notEqual(reverified.access_token, aal2)
  const reverifiedClaims = decodeJwtPayload(reverified.access_token)
  assert.equal(reverifiedClaims.aal, 'aal2')
  assert.equal(reverifiedClaims.session_id, sessionId)
  assert.ok(reverifiedClaims.iat > aal2AuthClaims.iat)
  const refreshedTotpAmrTimestamp = latestTotpAmrTimestamp(reverifiedClaims)
  assert.ok(Number.isSafeInteger(refreshedTotpAmrTimestamp))
  assert.ok(refreshedTotpAmrTimestamp > verifiedTotpAmrTimestamp)
  assert.ok(refreshedTotpAmrTimestamp >= controlBegunAt - 1)

  const controlCompleted = await invoke(
    status,
    reverified.access_token,
    'admin-identity-session',
    {
      action: 'completeControlStepUp',
      appSessionToken: completed.appSessionToken,
      controlAction: 'environment_ai_policy_change',
      controlIntentDigest,
      controlRequestId,
      controlStepUpNonce: controlBegun.controlStepUpNonce,
    },
    200,
  )
  assert.equal(controlCompleted.controlIntentDigest, controlIntentDigest)
  assert.equal(controlCompleted.controlRequestId, controlRequestId)
  assert.ok(Date.parse(controlCompleted.verifiedTotpAmrAt) >= controlBegunAt * 1000)

  const legacyCrossMode = await invoke(
    status,
    reverified.access_token,
    'verify-admin-pin',
    { pin: '246810' },
    401,
  )
  assert.equal(legacyCrossMode.ok, false)

  const loggedOut = await invoke(
    status,
    reverified.access_token,
    'admin-identity-session',
    { action: 'logout', appSessionToken: completed.appSessionToken },
    200,
  )
  assert.equal(loggedOut.ok, true)

  const revokedStatus = await invoke(
    status,
    reverified.access_token,
    'admin-identity-session',
    { action: 'status', appSessionToken: completed.appSessionToken },
    401,
  )
  assert.equal(revokedStatus.code, 'app_session_invalid')

  const state = JSON.parse(
    await runSql(`
      select jsonb_build_object(
        'active_memberships', (
          select count(*)
          from private.admin_environment_memberships
          where environment_id = ${sqlLiteral(environmentId)}::uuid
            and status = 'active'
        ),
        'google_sessions', (
          select count(*)
          from public.admin_sessions
          where environment_id = ${sqlLiteral(environmentId)}::uuid
            and authentication_method = 'google_totp'
            and aal = 2
            and revoked_at is not null
        ),
        'audit_events', (
          select count(*)
          from private.admin_audit_events
          where environment_id = ${sqlLiteral(environmentId)}::uuid
        )
      );
    `),
  )
  assert.equal(Number(state.active_memberships), 1)
  assert.equal(Number(state.google_sessions), 1)
  assert.ok(Number(state.audit_events) >= 4)

  console.log(
    'Phase 7.30 B1 local Google identity, AAL2 and tracked-session integration passed.',
  )
} catch (error) {
  failure = error
} finally {
  try {
    await runSql(`
      begin;
      update private.admin_identity_runtime_gate
      set google_session_issue_enabled = false,
          updated_at = statement_timestamp()
      where singleton;
      update private.admin_ai_unlock_runtime_gate
      set ai_unlock_enabled = false,
          remembered_browser_enabled = false,
          updated_at = statement_timestamp()
      where singleton;
      update private.admin_environments
      set owner_invariant_enforced_at = null
      where id = ${sqlLiteral(environmentId)}::uuid;
      alter table private.admin_audit_events
        disable trigger admin_audit_events_append_only;
      delete from private.admin_audit_events
      where environment_id = ${sqlLiteral(environmentId)}::uuid;
      alter table private.admin_audit_events
        enable trigger admin_audit_events_append_only;
      delete from private.admin_control_step_up_grants
      where environment_id = ${sqlLiteral(environmentId)}::uuid;
      delete from private.admin_control_step_up_nonces
      where environment_id = ${sqlLiteral(environmentId)}::uuid;
      delete from public.admin_sessions
      where environment_id = ${sqlLiteral(environmentId)}::uuid;
      delete from private.admin_step_up_nonces
      where environment_id = ${sqlLiteral(environmentId)}::uuid;
      delete from private.admin_invitations
      where environment_id = ${sqlLiteral(environmentId)}::uuid;
      delete from private.admin_environment_memberships
      where environment_id = ${sqlLiteral(environmentId)}::uuid;
      delete from private.admin_principals
      where auth_user_id = ${
        authUserId ? `${sqlLiteral(authUserId)}::uuid` : 'null::uuid'
      };
      delete from private.admin_environments
      where id = ${sqlLiteral(environmentId)}::uuid;
      delete from auth.users
      where id = ${
        authUserId ? `${sqlLiteral(authUserId)}::uuid` : 'null::uuid'
      };
      commit;
    `)
  } catch (cleanupError) {
    failure ??= cleanupError
  }
}

if (failure) throw failure
