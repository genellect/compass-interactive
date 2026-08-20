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
const environmentId =
  process.env.TEST_ADMIN_ENVIRONMENT_ID?.trim() ??
  '00000000-0000-4000-8000-000000000730'
assert.match(
  environmentId,
  UUID_PATTERN,
  'TEST_ADMIN_ENVIRONMENT_ID must be an optional UUID.',
)
const browserFixtureMode = process.argv.includes('--browser-fixture')
const browserFixtureRetainEnvironment =
  browserFixtureMode &&
  process.env.TEST_GOOGLE_ADMIN_FIXTURE_RETAIN_ENVIRONMENT === 'true'
const browserFixtureResetRetainedMemberships =
  browserFixtureMode &&
  process.env.TEST_GOOGLE_ADMIN_FIXTURE_RESET_RETAINED_MEMBERSHIPS === 'true'
assert.ok(
  !browserFixtureResetRetainedMemberships || browserFixtureRetainEnvironment,
  'Retained membership reset requires a retained browser fixture.',
)
const browserFixtureAiPin =
  process.env.TEST_GOOGLE_ADMIN_FIXTURE_AI_PIN?.trim() ?? ''
assert.ok(
  !browserFixtureAiPin || /^\d{4}$/.test(browserFixtureAiPin),
  'TEST_GOOGLE_ADMIN_FIXTURE_AI_PIN must be an optional synthetic 4-digit PIN.',
)
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

function bootstrapEnvironmentSql(status) {
  const bootstrapCall = `
    public.bootstrap_admin_environment_v1(
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
    )`
  if (!browserFixtureRetainEnvironment) return `select ${bootstrapCall};`

  return `
    do $browser_fixture$
    begin
      if exists (
        select 1
        from private.admin_environments
        where id = ${sqlLiteral(environmentId)}::uuid
          and environment_kind = 'local'
          and current_deployment
          and status = 'active'
      ) then
        insert into private.admin_invitations (
          id, environment_id, invitation_kind, target_email_hmac,
          role, can_use_ai, expires_at, request_id
        ) values (
          ${sqlLiteral(randomUUID())}::uuid,
          ${sqlLiteral(environmentId)}::uuid,
          'bootstrap',
          ${sqlLiteral(hmacIdentity(email, 'email'))},
          'owner',
          false,
          statement_timestamp() + interval '1 hour',
          ${sqlLiteral(randomUUID())}::uuid
        );
      else
        perform ${bootstrapCall};
      end if;
    end
    $browser_fixture$;
  `
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
    .filter((entry) => entry?.method === 'totp' || entry?.method === 'mfa/totp')
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

function browserAuthStorageValue(accessToken, refreshToken, factorId) {
  const claims = decodeJwtPayload(accessToken)
  const now = new Date().toISOString()
  return JSON.stringify({
    access_token: accessToken,
    expires_at: claims.exp,
    expires_in: Math.max(1, claims.exp - Math.floor(Date.now() / 1_000)),
    refresh_token: refreshToken,
    token_type: 'bearer',
    user: {
      app_metadata: { provider: 'google', providers: ['google'] },
      aud: 'authenticated',
      confirmed_at: now,
      created_at: now,
      email,
      email_confirmed_at: now,
      factors: [
        {
          created_at: now,
          factor_type: 'totp',
          friendly_name: 'Phase 7.30 Local TOTP',
          id: factorId,
          status: 'verified',
          updated_at: now,
        },
      ],
      id: authUserId,
      identities: [
        {
          created_at: now,
          id: googleSubject,
          identity_data: {
            email,
            email_verified: true,
            iss: 'https://accounts.google.com',
            sub: googleSubject,
          },
          identity_id: googleSubject,
          last_sign_in_at: now,
          provider: 'google',
          updated_at: now,
          user_id: authUserId,
        },
      ],
      is_anonymous: false,
      role: 'authenticated',
      updated_at: now,
      user_metadata: { full_name: 'Phase 7.30 Local Owner' },
    },
  })
}

async function waitForBrowserFixtureRelease() {
  process.stdin.resume()
  await new Promise((resolve) => {
    const release = () => resolve()
    process.stdin.once('end', release)
    process.once('SIGINT', release)
    process.once('SIGTERM', release)
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
    delete from auth.identities
    where user_id = ${sqlLiteral(authUserId)}::uuid
      and provider <> 'google';
    update auth.users
    set raw_app_meta_data =
      '{"provider":"google","providers":["google"]}'::jsonb,
        updated_at = statement_timestamp()
    where id = ${sqlLiteral(authUserId)}::uuid;
    ${bootstrapEnvironmentSql(status)}
    update private.admin_identity_runtime_gate
    set google_session_issue_enabled = true,
        google_operational_authorization_enabled = ${
          browserFixtureMode ? 'true' : 'false'
        },
        google_admin_ledger_enabled = false,
        totp_factor_mutation_enabled = ${browserFixtureMode ? 'false' : 'true'},
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

  await runSql(`
    update auth.sessions
    set created_at = statement_timestamp() - interval '8 hours 1 minute',
        updated_at = statement_timestamp()
    where id = ${sqlLiteral(sessionId)}::uuid
      and user_id = ${sqlLiteral(authUserId)}::uuid;
  `)
  const expiredSessionBegin = await invoke(
    status,
    aal1,
    'admin-identity-session',
    { action: 'beginStepUp', challengedFactorId: enrolled.id },
    401,
  )
  assert.equal(expiredSessionBegin.code, 'reauthentication_required')
  const expiredSessionNonceCount = Number(
    await runSql(`
      select count(*)
      from private.admin_step_up_nonces
      where supabase_auth_session_id = ${sqlLiteral(sessionId)}::uuid
        and intended_action = 'admin_login';
    `),
  )
  assert.equal(expiredSessionNonceCount, 0)
  await runSql(`
    update auth.sessions
    set created_at = statement_timestamp() - interval '1 hour',
        updated_at = statement_timestamp()
    where id = ${sqlLiteral(sessionId)}::uuid
      and user_id = ${sqlLiteral(authUserId)}::uuid;
  `)

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
  // The local fixture starts from a password session and then adds its signed
  // Google identity. Preserve the real GoTrue TOTP proof timestamp while
  // signing the same-session Google OAuth bearer expected by the Edge gate.
  const aal2 = accessToken(status, {
    aal: 'aal2',
    totpTimestamp: verifiedTotpAmrTimestamp,
  })

  const completed = await invoke(
    status,
    aal2,
    'admin-identity-session',
    { action: 'completeStepUp', stepUpNonce: begun.stepUpNonce },
    200,
  )
  assert.match(completed.appSessionToken, /^g1\.[A-Za-z0-9_-]{43}$/)
  assert.equal(completed.session?.role, 'owner')
  assert.equal(completed.session?.canUseAi, true)
  let browserAal2 = aal2

  if (browserFixtureResetRetainedMemberships) {
    const resetState = JSON.parse(
      await runSql(`
        begin;
        update public.admin_sessions
        set revoked_at = coalesce(revoked_at, statement_timestamp()),
            revoke_reason = coalesce(
              revoke_reason,
              'browser_fixture_replaced'
            ),
            updated_at = statement_timestamp()
        where environment_id = ${sqlLiteral(environmentId)}::uuid
          and membership_id <> ${sqlLiteral(
            completed.session.membershipId,
          )}::uuid
          and revoked_at is null;
        update private.admin_environment_memberships
        set role = 'instructor',
            can_use_ai = false,
            updated_at = statement_timestamp()
        where environment_id = ${sqlLiteral(environmentId)}::uuid
          and id <> ${sqlLiteral(completed.session.membershipId)}::uuid
          and status = 'active'
          and (role <> 'instructor' or can_use_ai);
        select jsonb_build_object(
          'activeAiMemberships', (
            select count(*)
            from private.admin_environment_memberships
            where environment_id = ${sqlLiteral(environmentId)}::uuid
              and status = 'active'
              and can_use_ai
          ),
          'activeOwners', (
            select count(*)
            from private.admin_environment_memberships
            where environment_id = ${sqlLiteral(environmentId)}::uuid
              and status = 'active'
              and role = 'owner'
          ),
          'activePriorSessions', (
            select count(*)
            from public.admin_sessions
            where environment_id = ${sqlLiteral(environmentId)}::uuid
              and membership_id <> ${sqlLiteral(
                completed.session.membershipId,
              )}::uuid
              and revoked_at is null
          )
        );
        commit;
      `),
    )
    assert.equal(Number(resetState.activeAiMemberships), 1)
    assert.equal(Number(resetState.activeOwners), 1)
    assert.equal(Number(resetState.activePriorSessions), 0)
  }

  if (browserFixtureMode) {
    if (browserFixtureAiPin) {
      await runSql(`
        update private.admin_environment_memberships
        set can_use_ai = true,
            updated_at = statement_timestamp()
        where id = ${sqlLiteral(completed.session.membershipId)}::uuid;
        update private.admin_ai_unlock_runtime_gate
        set google_ai_master_admission_enabled = true,
            google_ai_child_grant_enabled = true,
            remembered_browser_enabled = true,
            updated_at = statement_timestamp()
        where singleton;
        insert into private.admin_ai_policies (
          id, environment_id, membership_id, allowed_actions, allowed_models,
          max_calls_per_lecture, max_calls_per_day,
          max_input_tokens_per_lecture, max_input_tokens_per_day,
          max_output_tokens_per_lecture, max_output_tokens_per_day,
          max_cost_microusd_per_lecture, max_cost_microusd_per_day,
          max_realtime_minutes_per_lecture, max_realtime_minutes_per_day,
          max_concurrency, valid_from, valid_until, version,
          created_by_membership_id, created_by_admin_session_id, request_id
        ) values (
          ${sqlLiteral(randomUUID())}::uuid,
          ${sqlLiteral(environmentId)}::uuid,
          ${sqlLiteral(completed.session.membershipId)}::uuid,
          array['academic_answers', 'captions', 'material_analysis', 'poll_suggestions', 'summaries']::text[],
          array['test-model']::text[],
          10, 100, 10000, 100000, 10000, 100000,
          100000, 1000000, 30, 300, 1,
          statement_timestamp() - interval '1 minute',
          statement_timestamp() + interval '1 hour', 1,
          ${sqlLiteral(completed.session.membershipId)}::uuid,
          ${sqlLiteral(completed.session.id)}::uuid,
          ${sqlLiteral(randomUUID())}::uuid
        );
      `)
      const pinRequestId = randomUUID()
      const pinPrepared = await invoke(
        status,
        aal2,
        'admin-ai-unlock',
        {
          action: 'preparePinMutation',
          appSessionToken: completed.appSessionToken,
          pin: browserFixtureAiPin,
          pinAction: 'enroll',
          requestId: pinRequestId,
        },
        200,
      )
      const pinControlBegunAt = Math.floor(Date.now() / 1_000)
      const pinControlPrechallengeClaims = decodeJwtPayload(aal2)
      const pinControlBegun = await invoke(
        status,
        aal2,
        'admin-identity-session',
        {
          action: 'beginControlStepUp',
          appSessionToken: completed.appSessionToken,
          controlAction: pinPrepared.controlAction,
          controlIntentDigest: pinPrepared.controlIntentDigest,
          controlRequestId: pinRequestId,
        },
        200,
      )
      const stalePinControl = await invoke(
        status,
        aal2,
        'admin-identity-session',
        {
          action: 'completeControlStepUp',
          appSessionToken: completed.appSessionToken,
          controlAction: pinPrepared.controlAction,
          controlIntentDigest: pinPrepared.controlIntentDigest,
          controlRequestId: pinRequestId,
          controlStepUpNonce: pinControlBegun.controlStepUpNonce,
        },
        409,
      )
      assert.equal(stalePinControl.code, 'step_up_invalid')

      // Complete the control step-up only after a real, post-challenge TOTP
      // proof. Re-signing the prechallenge claims in the same second can
      // reproduce the same JWT and must remain rejected by the replay fence.
      await waitForNextTotpWindow()
      const { data: pinControlVerified, error: pinControlVerifyError } =
        await authClient.auth.mfa.challengeAndVerify({
          code: currentTotp(enrolled.totp.secret),
          factorId: enrolled.id,
        })
      if (pinControlVerifyError) throw pinControlVerifyError
      assert.ok(pinControlVerified.access_token)
      const pinControlClaims = decodeJwtPayload(pinControlVerified.access_token)
      assert.equal(pinControlClaims.aal, 'aal2')
      assert.equal(pinControlClaims.session_id, sessionId)
      assert.ok(pinControlClaims.iat > pinControlPrechallengeClaims.iat)
      const pinControlTotpAmrTimestamp =
        latestTotpAmrTimestamp(pinControlClaims)
      assert.ok(Number.isSafeInteger(pinControlTotpAmrTimestamp))
      assert.ok(pinControlTotpAmrTimestamp > verifiedTotpAmrTimestamp)
      assert.ok(pinControlTotpAmrTimestamp >= pinControlBegunAt - 1)
      const pinControlAal2 = accessToken(status, {
        aal: 'aal2',
        totpTimestamp: pinControlTotpAmrTimestamp,
      })
      assert.notEqual(pinControlAal2, aal2)
      browserAal2 = pinControlAal2
      await invoke(
        status,
        pinControlAal2,
        'admin-identity-session',
        {
          action: 'completeControlStepUp',
          appSessionToken: completed.appSessionToken,
          controlAction: pinPrepared.controlAction,
          controlIntentDigest: pinPrepared.controlIntentDigest,
          controlRequestId: pinRequestId,
          controlStepUpNonce: pinControlBegun.controlStepUpNonce,
        },
        200,
      )
      const pinSet = await invoke(
        status,
        pinControlAal2,
        'admin-ai-unlock',
        {
          action: 'setPin',
          appSessionToken: completed.appSessionToken,
          pin: browserFixtureAiPin,
          requestId: pinRequestId,
        },
        200,
      )
      assert.equal(pinSet.status, 'active')

      const policyRequestId = randomUUID()
      const policyValidFromMs = Date.now() - 60_000
      const policyRequest = {
        appSessionToken: completed.appSessionToken,
        maxCostMicrousdPerDay: 2_000_000,
        maxCostMicrousdPerLecture: 500_000,
        requestId: policyRequestId,
        targetMembershipId: completed.session.membershipId,
        validFrom: new Date(policyValidFromMs).toISOString(),
        validUntil: new Date(
          policyValidFromMs + 30 * 24 * 60 * 60 * 1_000,
        ).toISOString(),
      }
      const invalidPolicy = await invoke(
        status,
        pinControlAal2,
        'admin-ai-unlock',
        {
          action: 'preparePolicyMutation',
          ...policyRequest,
          maxCostMicrousdPerDay: 400_000,
        },
        400,
      )
      assert.equal(invalidPolicy.code, 'request_invalid')
      const policyPrepared = await invoke(
        status,
        pinControlAal2,
        'admin-ai-unlock',
        { action: 'preparePolicyMutation', ...policyRequest },
        200,
      )
      assert.equal(policyPrepared.controlAction, 'environment_ai_policy_change')
      assert.match(policyPrepared.controlIntentDigest, /^[0-9a-f]{64}$/)
      assert.equal(policyPrepared.requestId, policyRequestId)
      assert.equal(
        policyPrepared.targetMembershipId,
        completed.session.membershipId,
      )

      const policyControlBegunAt = Math.floor(Date.now() / 1_000)
      const policyControlBegun = await invoke(
        status,
        pinControlAal2,
        'admin-identity-session',
        {
          action: 'beginControlStepUp',
          appSessionToken: completed.appSessionToken,
          controlAction: policyPrepared.controlAction,
          controlIntentDigest: policyPrepared.controlIntentDigest,
          controlRequestId: policyRequestId,
        },
        200,
      )
      await waitForNextTotpWindow()
      const { data: policyControlVerified, error: policyControlVerifyError } =
        await authClient.auth.mfa.challengeAndVerify({
          code: currentTotp(enrolled.totp.secret),
          factorId: enrolled.id,
        })
      if (policyControlVerifyError) throw policyControlVerifyError
      assert.ok(policyControlVerified.access_token)
      const policyControlClaims = decodeJwtPayload(
        policyControlVerified.access_token,
      )
      assert.equal(policyControlClaims.aal, 'aal2')
      assert.equal(policyControlClaims.session_id, sessionId)
      assert.ok(policyControlClaims.iat > pinControlClaims.iat)
      const policyControlTotpAmrTimestamp =
        latestTotpAmrTimestamp(policyControlClaims)
      assert.ok(Number.isSafeInteger(policyControlTotpAmrTimestamp))
      assert.ok(policyControlTotpAmrTimestamp > pinControlTotpAmrTimestamp)
      assert.ok(policyControlTotpAmrTimestamp >= policyControlBegunAt - 1)
      const policyControlAal2 = accessToken(status, {
        aal: 'aal2',
        totpTimestamp: policyControlTotpAmrTimestamp,
      })
      browserAal2 = policyControlAal2
      const policyControlCompleted = await invoke(
        status,
        policyControlAal2,
        'admin-identity-session',
        {
          action: 'completeControlStepUp',
          appSessionToken: completed.appSessionToken,
          controlAction: policyPrepared.controlAction,
          controlIntentDigest: policyPrepared.controlIntentDigest,
          controlRequestId: policyRequestId,
          controlStepUpNonce: policyControlBegun.controlStepUpNonce,
        },
        200,
      )
      assert.equal(
        policyControlCompleted.controlIntentDigest,
        policyPrepared.controlIntentDigest,
      )

      const policySet = await invoke(
        status,
        policyControlAal2,
        'admin-ai-unlock',
        { action: 'setPolicy', ...policyRequest },
        200,
      )
      assert.equal(policySet.membershipId, completed.session.membershipId)
      assert.match(policySet.policyId, UUID_PATTERN)
      assert.equal(policySet.status, 'active')
      assert.equal(policySet.version, 2)

      const policyStatus = await invoke(
        status,
        policyControlAal2,
        'admin-ai-unlock',
        {
          action: 'policyStatus',
          appSessionToken: completed.appSessionToken,
        },
        200,
      )
      const currentPolicyStatus = policyStatus.memberships.find(
        (membership) =>
          membership.membershipId === completed.session.membershipId,
      )
      assert.equal(policyStatus.topologyComplete, true)
      assert.equal(policyStatus.canonicalPolicyTopologyComplete, true)
      assert.equal(currentPolicyStatus?.covered, true)
      assert.equal(currentPolicyStatus?.policyId, policySet.policyId)
      assert.equal(currentPolicyStatus?.policyVersion, 2)
      assert.equal(currentPolicyStatus?.maxCostMicrousdPerLecture, 500_000)
      assert.equal(currentPolicyStatus?.maxCostMicrousdPerDay, 2_000_000)

      const persistedPolicy = JSON.parse(
        await runSql(`
          select jsonb_build_object(
            'allowedActions', allowed_actions,
            'allowedModels', allowed_models,
            'maxCallsPerLecture', max_calls_per_lecture,
            'maxCallsPerDay', max_calls_per_day,
            'maxInputTokensPerLecture', max_input_tokens_per_lecture,
            'maxInputTokensPerDay', max_input_tokens_per_day,
            'maxOutputTokensPerLecture', max_output_tokens_per_lecture,
            'maxOutputTokensPerDay', max_output_tokens_per_day,
            'maxCostMicrousdPerLecture', max_cost_microusd_per_lecture,
            'maxCostMicrousdPerDay', max_cost_microusd_per_day,
            'maxRealtimeMinutesPerLecture', max_realtime_minutes_per_lecture,
            'maxRealtimeMinutesPerDay', max_realtime_minutes_per_day,
            'maxConcurrency', max_concurrency,
            'validFrom', valid_from,
            'validUntil', valid_until,
            'version', version,
            'status', status
          )
          from private.admin_ai_policies
          where id = ${sqlLiteral(policySet.policyId)}::uuid;
        `),
      )
      assert.deepEqual(persistedPolicy.allowedActions, [
        'academic_answers',
        'captions',
        'material_analysis',
        'poll_suggestions',
        'summaries',
      ])
      assert.deepEqual(persistedPolicy.allowedModels, [
        'gpt-5.6-luna',
        'gpt-realtime-whisper',
      ])
      assert.equal(persistedPolicy.maxCallsPerLecture, 24)
      assert.equal(persistedPolicy.maxCallsPerDay, 96)
      assert.equal(persistedPolicy.maxInputTokensPerLecture, 200_000)
      assert.equal(persistedPolicy.maxInputTokensPerDay, 800_000)
      assert.equal(persistedPolicy.maxOutputTokensPerLecture, 40_000)
      assert.equal(persistedPolicy.maxOutputTokensPerDay, 160_000)
      assert.equal(persistedPolicy.maxCostMicrousdPerLecture, 500_000)
      assert.equal(persistedPolicy.maxCostMicrousdPerDay, 2_000_000)
      assert.equal(persistedPolicy.maxRealtimeMinutesPerLecture, 90)
      assert.equal(persistedPolicy.maxRealtimeMinutesPerDay, 180)
      assert.equal(persistedPolicy.maxConcurrency, 2)
      assert.equal(persistedPolicy.version, 2)
      assert.equal(persistedPolicy.status, 'active')
      assert.equal(
        Date.parse(persistedPolicy.validUntil) -
          Date.parse(persistedPolicy.validFrom),
        30 * 24 * 60 * 60 * 1_000,
      )
    }
    const fixture = {
      accessToken: browserAal2,
      appSessionId: completed.session.id,
      appSessionToken: completed.appSessionToken,
      authStorageValue: browserAuthStorageValue(
        browserAal2,
        signedIn.session.refresh_token,
        enrolled.id,
      ),
      aiPin: browserFixtureAiPin,
      environmentId,
    }
    console.log(
      `GOOGLE_ADMIN_AAL2_FIXTURE=${Buffer.from(
        JSON.stringify(fixture),
        'utf8',
      ).toString('base64url')}`,
    )
    await waitForBrowserFixtureRelease()
  } else {
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

    const sourceOffFactorBegin = await invoke(
      status,
      aal2,
      'admin-identity-session',
      {
        action: 'beginControlStepUp',
        appSessionToken: completed.appSessionToken,
        controlAction: 'totp_factor_add',
        controlIntentDigest: randomBytes(32).toString('hex'),
        controlRequestId: randomUUID(),
      },
      503,
    )
    assert.equal(sourceOffFactorBegin.code, 'feature_disabled')

    const sourceOffFactorComplete = await invoke(
      status,
      aal2,
      'admin-identity-session',
      {
        action: 'completeControlStepUp',
        appSessionToken: completed.appSessionToken,
        controlAction: 'totp_factor_add',
        controlIntentDigest: randomBytes(32).toString('hex'),
        controlRequestId: randomUUID(),
        controlStepUpNonce: randomBytes(32).toString('base64url'),
      },
      503,
    )
    assert.equal(sourceOffFactorComplete.code, 'feature_disabled')

    const sourceOffFactorPrepare = await invoke(
      status,
      aal2,
      'admin-ai-unlock',
      {
        action: 'prepareTotpTransition',
        appSessionToken: completed.appSessionToken,
        factorAction: 'totp_factor_add',
        targetFactorId: randomUUID(),
      },
      503,
    )
    assert.equal(sourceOffFactorPrepare.code, 'feature_disabled')

    const sourceOffC1Admission = await invoke(
      status,
      aal2,
      'admin-ai-unlock',
      {
        action: 'authorizeMasterWithPin',
        appSessionToken: completed.appSessionToken,
        lectureSessionId: randomUUID(),
        pin: '1234',
        policyId: randomUUID(),
        policyVersion: 1,
        requestId: randomUUID(),
        requestedScope: 'all_except_captions',
      },
      503,
    )
    assert.equal(sourceOffC1Admission.code, 'feature_disabled')

    const policyValidFromMs = Date.now() - 60_000
    const policyRequest = {
      appSessionToken: completed.appSessionToken,
      maxCostMicrousdPerDay: 2_000_000,
      maxCostMicrousdPerLecture: 500_000,
      requestId: randomUUID(),
      targetMembershipId: completed.session.membershipId,
      validFrom: new Date(policyValidFromMs).toISOString(),
      validUntil: new Date(
        policyValidFromMs + 30 * 24 * 60 * 60 * 1_000,
      ).toISOString(),
    }
    const closedPolicyStatus = await invoke(
      status,
      aal2,
      'admin-ai-unlock',
      {
        action: 'policyStatus',
        appSessionToken: completed.appSessionToken,
        targetMembershipId: completed.session.membershipId,
      },
      400,
    )
    assert.equal(closedPolicyStatus.code, 'request_invalid')
    const closedPolicyPrepare = await invoke(
      status,
      aal2,
      'admin-ai-unlock',
      {
        action: 'preparePolicyMutation',
        ...policyRequest,
        allowedModels: ['gpt-5.6-luna'],
      },
      400,
    )
    assert.equal(closedPolicyPrepare.code, 'request_invalid')
    const closedPolicySet = await invoke(
      status,
      aal2,
      'admin-ai-unlock',
      {
        action: 'setPolicy',
        ...policyRequest,
        allowedActions: ['academic_answers'],
      },
      400,
    )
    assert.equal(closedPolicySet.code, 'request_invalid')

    const initialPolicyStatus = await invoke(
      status,
      aal2,
      'admin-ai-unlock',
      {
        action: 'policyStatus',
        appSessionToken: completed.appSessionToken,
      },
      200,
    )
    assert.equal(initialPolicyStatus.activeAiMembershipCount, 1)
    assert.equal(initialPolicyStatus.coveredMembershipCount, 0)
    assert.equal(initialPolicyStatus.topologyComplete, false)
    assert.equal(initialPolicyStatus.canonicalPolicyTopologyComplete, false)
    assert.equal(initialPolicyStatus.memberships.length, 1)
    assert.equal(initialPolicyStatus.memberships[0]?.covered, false)
    assert.equal(
      initialPolicyStatus.memberships[0]?.membershipId,
      completed.session.membershipId,
    )

    const preparedPolicy = await invoke(
      status,
      aal2,
      'admin-ai-unlock',
      { action: 'preparePolicyMutation', ...policyRequest },
      200,
    )
    assert.equal(preparedPolicy.controlAction, 'environment_ai_policy_change')
    assert.match(preparedPolicy.controlIntentDigest, /^[0-9a-f]{64}$/)
    assert.equal(preparedPolicy.requestId, policyRequest.requestId)
    assert.equal(
      preparedPolicy.targetMembershipId,
      completed.session.membershipId,
    )

    const policyWithoutControlProof = await invoke(
      status,
      aal2,
      'admin-ai-unlock',
      { action: 'setPolicy', ...policyRequest },
      409,
    )
    assert.equal(policyWithoutControlProof.code, 'control_proof_required')

    const controlRequestId = policyRequest.requestId
    const controlIntentDigest = preparedPolicy.controlIntentDigest
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
    assert.notEqual(reverified.access_token, verified.access_token)
    const reverifiedClaims = decodeJwtPayload(reverified.access_token)
    assert.equal(reverifiedClaims.aal, 'aal2')
    assert.equal(reverifiedClaims.session_id, sessionId)
    assert.ok(reverifiedClaims.iat > aal2AuthClaims.iat)
    const refreshedTotpAmrTimestamp = latestTotpAmrTimestamp(reverifiedClaims)
    assert.ok(Number.isSafeInteger(refreshedTotpAmrTimestamp))
    assert.ok(refreshedTotpAmrTimestamp > verifiedTotpAmrTimestamp)
    assert.ok(refreshedTotpAmrTimestamp >= controlBegunAt - 1)
    const refreshedAal2 = accessToken(status, {
      aal: 'aal2',
      totpTimestamp: refreshedTotpAmrTimestamp,
    })

    const controlCompleted = await invoke(
      status,
      refreshedAal2,
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
    assert.ok(
      Date.parse(controlCompleted.verifiedTotpAmrAt) >= controlBegunAt * 1000,
    )

    const policySet = await invoke(
      status,
      refreshedAal2,
      'admin-ai-unlock',
      { action: 'setPolicy', ...policyRequest },
      200,
    )
    assert.equal(policySet.membershipId, completed.session.membershipId)
    assert.match(policySet.policyId, UUID_PATTERN)
    assert.equal(policySet.status, 'active')
    assert.equal(policySet.version, 1)

    const completedPolicyStatus = await invoke(
      status,
      refreshedAal2,
      'admin-ai-unlock',
      {
        action: 'policyStatus',
        appSessionToken: completed.appSessionToken,
      },
      200,
    )
    assert.equal(completedPolicyStatus.activeAiMembershipCount, 1)
    assert.equal(completedPolicyStatus.coveredMembershipCount, 1)
    assert.equal(completedPolicyStatus.topologyComplete, true)
    assert.equal(completedPolicyStatus.canonicalPolicyTopologyComplete, true)
    assert.equal(completedPolicyStatus.memberships[0]?.covered, true)
    assert.equal(
      completedPolicyStatus.memberships[0]?.policyId,
      policySet.policyId,
    )
    assert.equal(completedPolicyStatus.memberships[0]?.policyVersion, 1)

    const legacyEndpoint = await fetch(
      `${status.API_URL}/functions/v1/verify-admin-pin`,
      {
        headers: {
          apikey: status.PUBLISHABLE_KEY || status.ANON_KEY,
          Authorization: `Bearer ${refreshedAal2}`,
          Origin: expectedOrigin,
        },
        method: 'OPTIONS',
        redirect: 'manual',
      },
    )
    assert.equal(legacyEndpoint.status, 404)

    const loggedOut = await invoke(
      status,
      refreshedAal2,
      'admin-identity-session',
      { action: 'logout', appSessionToken: completed.appSessionToken },
      200,
    )
    assert.equal(loggedOut.ok, true)

    const revokedStatus = await invoke(
      status,
      refreshedAal2,
      'admin-identity-session',
      { action: 'status', appSessionToken: completed.appSessionToken },
      401,
    )
    assert.equal(revokedStatus.code, 'app_session_invalid')

    const preMissingSessionMutationCounts = JSON.parse(
      await runSql(`
        select jsonb_build_object(
          'nonces', (
            select count(*)
            from private.admin_step_up_nonces
            where supabase_auth_session_id = ${sqlLiteral(sessionId)}::uuid
              and intended_action = 'admin_login'
          ),
          'audit_events', (
            select count(*)
            from private.admin_audit_events
            where environment_id = ${sqlLiteral(environmentId)}::uuid
          )
        );
      `),
    )
    await runSql(`
      delete from auth.sessions
      where id = ${sqlLiteral(sessionId)}::uuid
        and user_id = ${sqlLiteral(authUserId)}::uuid;
    `)
    const missingSessionBegin = await invoke(
      status,
      aal1,
      'admin-identity-session',
      { action: 'beginStepUp', challengedFactorId: enrolled.id },
      401,
    )
    assert.equal(missingSessionBegin.code, 'reauthentication_required')
    const postMissingSessionMutationCounts = JSON.parse(
      await runSql(`
        select jsonb_build_object(
          'nonces', (
            select count(*)
            from private.admin_step_up_nonces
            where supabase_auth_session_id = ${sqlLiteral(sessionId)}::uuid
              and intended_action = 'admin_login'
          ),
          'audit_events', (
            select count(*)
            from private.admin_audit_events
            where environment_id = ${sqlLiteral(environmentId)}::uuid
          )
        );
      `),
    )
    assert.deepEqual(
      postMissingSessionMutationCounts,
      preMissingSessionMutationCounts,
    )

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
  }
} catch (error) {
  failure = error
} finally {
  try {
    if (browserFixtureRetainEnvironment) {
      await runSql(`
        begin;
        update private.admin_identity_runtime_gate
        set google_session_issue_enabled = false,
            google_operational_authorization_enabled = false,
            google_admin_ledger_enabled = false,
            totp_factor_mutation_enabled = false,
            updated_at = statement_timestamp()
        where singleton;
        update private.admin_ai_unlock_runtime_gate
        set ai_unlock_enabled = false,
            google_ai_master_admission_enabled = false,
            google_ai_child_grant_enabled = false,
            remembered_browser_enabled = false,
            updated_at = statement_timestamp()
        where singleton;
        update public.admin_sessions
        set revoked_at = coalesce(revoked_at, statement_timestamp()),
            revoke_reason = coalesce(revoke_reason, 'browser_fixture_released'),
            updated_at = statement_timestamp()
        where supabase_auth_session_id = ${
          sessionId ? `${sqlLiteral(sessionId)}::uuid` : 'null::uuid'
        };
        commit;
      `)
    } else {
      await runSql(`
      begin;
      update private.admin_identity_runtime_gate
      set google_session_issue_enabled = false,
          google_operational_authorization_enabled = false,
          google_admin_ledger_enabled = false,
          totp_factor_mutation_enabled = false,
          updated_at = statement_timestamp()
      where singleton;
      update private.admin_ai_unlock_runtime_gate
      set ai_unlock_enabled = false,
          google_ai_master_admission_enabled = false,
          google_ai_child_grant_enabled = false,
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
      delete from private.admin_ai_policies
      where environment_id = ${sqlLiteral(environmentId)}::uuid;
      delete from private.admin_control_step_up_grants
      where environment_id = ${sqlLiteral(environmentId)}::uuid;
      delete from private.admin_control_step_up_nonces
      where environment_id = ${sqlLiteral(environmentId)}::uuid;
      alter table private.admin_google_operation_receipts
        disable trigger admin_google_operation_receipts_append_only;
      delete from private.admin_google_operation_receipts
      where environment_id = ${sqlLiteral(environmentId)}::uuid;
      alter table private.admin_google_operation_receipts
        enable trigger admin_google_operation_receipts_append_only;
      delete from public.admin_sessions
      where environment_id = ${sqlLiteral(environmentId)}::uuid;
      delete from private.admin_step_up_nonces
      where environment_id = ${sqlLiteral(environmentId)}::uuid;
      alter table private.admin_invitation_redemption_receipts
        disable trigger admin_invitation_redemptions_append_only;
      delete from private.admin_invitation_redemption_receipts
      where environment_id = ${sqlLiteral(environmentId)}::uuid;
      alter table private.admin_invitation_redemption_receipts
        enable trigger admin_invitation_redemptions_append_only;
      alter table private.admin_invitations
        disable trigger enforce_admin_invitation_transition;
      delete from private.admin_invitations
      where environment_id = ${sqlLiteral(environmentId)}::uuid;
      alter table private.admin_invitations
        enable trigger enforce_admin_invitation_transition;
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
    }
  } catch (cleanupError) {
    failure ??= cleanupError
  }
}

if (failure) throw failure
