import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'

const container =
  process.env.SUPABASE_DB_CONTAINER ?? 'supabase_db_compass-interactive'
const id = Object.fromEntries(
  [
    'environment',
    'authUserA',
    'authUserB',
    'principalA',
    'principalB',
    'membershipA',
    'membershipB',
    'authSessionA1',
    'authSessionA2',
    'authSessionB',
    'mfaFactorA',
    'mfaFactorB',
    'anchorRequestA',
    'anchorRequestB',
    'adminSessionA1',
    'adminSessionA2',
    'adminSessionB',
    'stepUpNonceA1',
    'stepUpNonceA2',
    'stepUpNonceB',
    'stepUpRequestA1',
    'stepUpRequestA2',
    'stepUpRequestB',
    'factorA',
    'factorB',
    'factorRequestA',
    'factorRequestB',
    'metadataRaceRequest',
    'rateRequestA',
    'rateRequestB',
    'wrongRateRequestA',
    'wrongRateRequestB',
    'ownerContextRequest',
    'policyRequestA',
    'policyRequestB',
    'stalePolicyRequest',
    'semaphoreEnvironmentRequest',
    'semaphoreNetworkRequest',
    'rotationRequest',
    'rotationMetadataRequest',
    'lecture',
    'enrollmentOne',
    'credentialOne',
    'challengeOne',
    'cleanupRotationRequest',
    'cleanupFactorRequest',
    'enrollmentTwo',
    'credentialTwo',
    'challengeTwo',
    'cleanupRevokeRequest',
    'revokeRequest',
    'enrollmentThree',
    'credentialThree',
    'challengeThree',
    'cleanupCleanerRequestA',
    'cleanupCleanerRequestB',
    'loginRaceReservedOld',
    'loginRaceReservedNew',
    'loginRaceRequestOld',
    'loginRaceRequestNew',
    'loginRaceCompletionRequest',
    'enrollmentFour',
    'credentialFour',
    'challengeFour',
    'sessionDrainRotationRequest',
    'sessionDrainRevokeRequest',
  ].map((name) => [name, randomUUID()]),
)
const hex = () => randomBytes(32).toString('hex')
const tokenA1 = hex()
const tokenA2 = hex()
const tokenB = hex()
const subjectHmacA = hex()
const subjectHmacB = hex()
const stepUpNonceHashA1 = hex()
const stepUpNonceHashA2 = hex()
const stepUpNonceHashB = hex()
const stepUpPrechallengeHashA1 = hex()
const stepUpPrechallengeHashA2 = hex()
const stepUpPrechallengeHashB = hex()
const stepUpCompletionHashA1 = hex()
const stepUpCompletionHashA2 = hex()
const stepUpCompletionHashB = hex()
const pinHmacA = hex()
const pinHmacB = hex()
const wrongPinHmacA = hex()
const wrongPinHmacB = hex()
const rotatedPinHmac = hex()
const cleanupRotatedPinHmac = hex()
const sessionDrainRotatedPinHmac = hex()
const loginRaceNonceOld = hex()
const loginRaceNonceNew = hex()
const loginRacePrechallengeOld = hex()
const loginRacePrechallengeNew = hex()
const loginRaceCompletionJwt = hex()
const loginRaceToken = hex()
const policyValidFrom = new Date(Date.now() - 5 * 60_000).toISOString()
const policyValidUntil = new Date(Date.now() + 24 * 60 * 60_000).toISOString()
const networkRace = hex()
const intentRace = hex()
const networkA = hex()
const networkB = hex()
const intentA = hex()
const intentB = hex()
const wrongIntentA = hex()
const wrongIntentB = hex()
const semaphoreEnvironmentNetwork = hex()
const semaphoreEnvironmentIntent = hex()
const semaphoreNetwork = hex()
const semaphoreNetworkIntent = hex()
const ownerNetwork = hex()
const ownerIntent = hex()
const rotationIntent = hex()
const proof = Object.fromEntries(
  [
    'nonceOne',
    'credentialOne',
    'challengeOne',
    'nonceTwo',
    'credentialTwo',
    'challengeTwo',
    'nonceThree',
    'credentialThree',
    'challengeThree',
    'nonceFour',
    'credentialFour',
    'challengeFour',
  ].map((name) => [name, hex()]),
)
const jwk = {
  crv: 'P-256',
  kty: 'EC',
  x: 'A'.repeat(43),
  y: 'B'.repeat(43),
}
const jwkFingerprint = createHash('sha256')
  .update(JSON.stringify(jwk), 'utf8')
  .digest('hex')

function literal(value) {
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
    let stderr = ''
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk) => {
      stderr += chunk
    })
    child.on('error', reject)
    child.on('exit', (code) => {
      if (code === 0) resolve()
      else reject(new Error(stderr.trim() || `psql exited with ${code}`))
    })
  })
}

function startSqlUntilReady(sql, readyMarker) {
  let resolveReady
  let rejectReady
  let readySettled = false
  const ready = new Promise((resolve, reject) => {
    resolveReady = resolve
    rejectReady = reject
  })
  const done = new Promise((resolve, reject) => {
    const child = spawn(
      'docker',
      [
        'exec',
        '-i',
        container,
        'psql',
        '-X',
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
    const observeReady = (chunk) => {
      if (!readySettled && chunk.includes(readyMarker)) {
        readySettled = true
        resolveReady()
      }
    }
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk) => {
      stdout += chunk
      observeReady(chunk)
    })
    child.stderr.on('data', (chunk) => {
      stderr += chunk
      observeReady(chunk)
    })
    child.on('error', (error) => {
      if (!readySettled) {
        readySettled = true
        rejectReady(error)
      }
      reject(error)
    })
    child.on('exit', (code) => {
      if (code === 0) {
        if (!readySettled) {
          const error = new Error(
            `psql exited before readiness marker ${readyMarker}: ${stdout.trim()}`,
          )
          readySettled = true
          rejectReady(error)
          reject(error)
          return
        }
        resolve()
        return
      }
      const error = new Error(
        stderr.trim() ||
          stdout.trim() ||
          `psql exited with ${code} before ${readyMarker}`,
      )
      if (!readySettled) {
        readySettled = true
        rejectReady(error)
      }
      reject(error)
    })
  })
  return { ready, done }
}

const transactionSettings = `
  set local lock_timeout = '5s';
  set local statement_timeout = '20s';
`
const asServiceRole = (sql) => `
  begin;
  ${transactionSettings}
  set local role service_role;
  ${sql}
  commit;
`
const recordServiceResult = (scenario, expression) =>
  asServiceRole(`
    with outcome as (select ${expression} as value)
    insert into public.phase7_30b2_concurrency_results (scenario, outcome)
    select ${literal(scenario)}, to_jsonb(outcome.value)
    from outcome;
  `)
const recordDelayedServiceResult = (scenario, expression) =>
  asServiceRole(`
    select pg_sleep(0.10);
    with outcome as (select ${expression} as value)
    insert into public.phase7_30b2_concurrency_results (scenario, outcome)
    select ${literal(scenario)}, to_jsonb(outcome.value)
    from outcome;
  `)
const recordAfterReadyServiceResult = (scenario, readyScenario, expression) =>
  asServiceRole(`
    do $$
    declare
      wait_started_at timestamptz := clock_timestamp();
    begin
      while not exists (
        select 1 from public.phase7_30b2_concurrency_results
        where scenario = ${literal(readyScenario)}
      ) loop
        if clock_timestamp() > wait_started_at + interval '5 seconds' then
          raise exception 'timed out waiting for advisory-slot fixture';
        end if;
        perform pg_sleep(0.01);
      end loop;
    end;
    $$;
    with outcome as (select ${expression} as value)
    insert into public.phase7_30b2_concurrency_results (scenario, outcome)
    select ${literal(scenario)}, to_jsonb(outcome.value)
    from outcome;
  `)

const seedControlGrant = async (
  adminSessionId,
  action,
  requestId,
  intentDigestExpression,
) => {
  const nonceId = randomUUID()
  const grantId = randomUUID()
  const nonceHash = hex()
  const prechallengeHash = hex()
  const completionHash = hex()
  await runSql(`
    insert into private.admin_control_step_up_nonces (
      id, nonce_hash, environment_id, principal_id, membership_id,
      admin_session_id, supabase_auth_session_id,
      verified_totp_factor_set_hash, intended_action, intent_digest,
      mutation_request_id,
      prechallenge_jwt_hash, min_amr_at, issued_at, expires_at,
      status, consumed_at, completed_grant_id
    )
    select
      ${literal(nonceId)}::uuid, ${literal(nonceHash)}, session.environment_id,
      session.principal_id, session.membership_id, session.id,
      session.supabase_auth_session_id, session.verified_totp_factor_set_hash,
      ${literal(action)}, ${intentDigestExpression}, ${literal(requestId)}::uuid,
      ${literal(prechallengeHash)}, statement_timestamp() - interval '1 minute',
      statement_timestamp() - interval '1 minute',
      statement_timestamp() + interval '4 minutes', 'consumed',
      statement_timestamp(), ${literal(grantId)}::uuid
    from public.admin_sessions as session
    where session.id = ${literal(adminSessionId)}::uuid;

    insert into private.admin_control_step_up_grants (
      id, source_kind, control_nonce_id, environment_id, principal_id,
      membership_id, admin_session_id, supabase_auth_session_id,
      verified_totp_factor_set_hash, intended_action, intent_digest,
      mutation_request_id,
      prechallenge_jwt_hash, completion_jwt_hash, min_amr_at,
      verified_totp_amr_at, issued_at, expires_at
    )
    select
      ${literal(grantId)}::uuid, 'control', ${literal(nonceId)}::uuid,
      session.environment_id, session.principal_id, session.membership_id,
      session.id, session.supabase_auth_session_id,
      session.verified_totp_factor_set_hash, ${literal(action)},
      ${intentDigestExpression},
      ${literal(requestId)}::uuid, ${literal(prechallengeHash)},
      ${literal(completionHash)}, statement_timestamp() - interval '1 minute',
      statement_timestamp() - interval '1 minute', statement_timestamp(),
      statement_timestamp() + interval '4 minutes'
    from public.admin_sessions as session
    where session.id = ${literal(adminSessionId)}::uuid;
  `)
}

await runSql(`
  do $$
  begin
    if exists (
      select 1 from private.admin_environments where current_deployment
    ) then
      raise exception 'Phase 7.30B2 concurrency requires a reset database without a current Admin environment';
    end if;
  end;
  $$;

  drop table if exists public.phase7_30b2_concurrency_results;
  drop function if exists private.phase7_30b2_concurrency_child_delay_v1() cascade;
  create table public.phase7_30b2_concurrency_results (
    scenario text primary key,
    outcome jsonb not null
  );
  revoke all on public.phase7_30b2_concurrency_results from public, anon, authenticated, service_role;
  grant select, insert on public.phase7_30b2_concurrency_results to service_role;

  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at
  ) values
    (
      '00000000-0000-0000-0000-000000000000'::uuid,
      ${literal(id.authUserA)}::uuid, 'authenticated', 'authenticated',
      ${literal(`phase730b2-${id.authUserA}@example.test`)}, '',
      statement_timestamp() - interval '1 hour',
      '{"provider":"google","providers":["google"]}'::jsonb, '{}'::jsonb,
      statement_timestamp() - interval '1 hour', statement_timestamp() - interval '1 hour'
    ),
    (
      '00000000-0000-0000-0000-000000000000'::uuid,
      ${literal(id.authUserB)}::uuid, 'authenticated', 'authenticated',
      ${literal(`phase730b2-${id.authUserB}@example.test`)}, '',
      statement_timestamp() - interval '1 hour',
      '{"provider":"google","providers":["google"]}'::jsonb, '{}'::jsonb,
      statement_timestamp() - interval '1 hour', statement_timestamp() - interval '1 hour'
    );

  insert into auth.sessions (id, user_id, created_at, updated_at) values
    (${literal(id.authSessionA1)}::uuid, ${literal(id.authUserA)}::uuid, statement_timestamp() - interval '1 hour', statement_timestamp() - interval '1 hour'),
    (${literal(id.authSessionA2)}::uuid, ${literal(id.authUserA)}::uuid, statement_timestamp() - interval '1 hour', statement_timestamp() - interval '1 hour'),
    (${literal(id.authSessionB)}::uuid, ${literal(id.authUserB)}::uuid, statement_timestamp() - interval '1 hour', statement_timestamp() - interval '1 hour');

  insert into auth.mfa_factors (
    id, user_id, friendly_name, factor_type, status, created_at, updated_at
  ) values
    (${literal(id.mfaFactorA)}::uuid, ${literal(id.authUserA)}::uuid,
      'phase730b2-concurrency-a', 'totp', 'verified',
      statement_timestamp() - interval '1 hour',
      statement_timestamp() - interval '1 hour'),
    (${literal(id.mfaFactorB)}::uuid, ${literal(id.authUserB)}::uuid,
      'phase730b2-concurrency-b', 'totp', 'verified',
      statement_timestamp() - interval '1 hour',
      statement_timestamp() - interval '1 hour');

  insert into private.admin_environments (
    id, environment_kind, canonical_admin_origin, supabase_issuer,
    current_deployment
  ) values (
    ${literal(id.environment)}::uuid, 'local', 'http://127.0.0.1:5173',
    'http://127.0.0.1:54321/auth/v1', false
  );

  insert into private.admin_principals (
    id, auth_user_id, google_issuer, provider_subject_hmac,
    subject_pepper_version, normalized_email, email_verified_at
  ) values
    (${literal(id.principalA)}::uuid, ${literal(id.authUserA)}::uuid, 'https://accounts.google.com', ${literal(subjectHmacA)}, 1, ${literal(`phase730b2-${id.authUserA}@example.test`)}, statement_timestamp() - interval '1 hour'),
    (${literal(id.principalB)}::uuid, ${literal(id.authUserB)}::uuid, 'https://accounts.google.com', ${literal(subjectHmacB)}, 1, ${literal(`phase730b2-${id.authUserB}@example.test`)}, statement_timestamp() - interval '1 hour');

  insert into private.admin_environment_memberships (
    id, environment_id, principal_id, role, status, can_use_ai, activated_at
  ) values
    (${literal(id.membershipA)}::uuid, ${literal(id.environment)}::uuid, ${literal(id.principalA)}::uuid, 'instructor', 'active', true, statement_timestamp() - interval '1 hour'),
    (${literal(id.membershipB)}::uuid, ${literal(id.environment)}::uuid, ${literal(id.principalB)}::uuid, 'instructor', 'active', true, statement_timestamp() - interval '1 hour');
  update private.admin_environment_memberships set role = 'owner'
  where id = ${literal(id.membershipA)}::uuid;
  update private.admin_environments
  set current_deployment = true,
      bootstrap_sealed_at = statement_timestamp(),
      owner_invariant_enforced_at = statement_timestamp()
  where id = ${literal(id.environment)}::uuid;

  update private.admin_principals
  set
    approved_totp_factor_set_hash =
      private.current_verified_totp_factor_set_hash_v1(${literal(id.authUserA)}::uuid),
    approved_totp_factor_set_version = 1,
    approved_totp_factor_count = 1,
    approved_totp_factor_set_at = statement_timestamp(),
    approved_totp_factor_set_request_id = ${literal(id.anchorRequestA)}::uuid,
    approved_totp_factor_set_source = 'operator_adoption',
    approved_totp_factor_set_actor = 'fixture:phase7_30b2_concurrency',
    approved_totp_factor_set_reason = 'latest_schema_direct_session_fixture'
  where id = ${literal(id.principalA)}::uuid;
  update private.admin_principals
  set
    approved_totp_factor_set_hash =
      private.current_verified_totp_factor_set_hash_v1(${literal(id.authUserB)}::uuid),
    approved_totp_factor_set_version = 1,
    approved_totp_factor_count = 1,
    approved_totp_factor_set_at = statement_timestamp(),
    approved_totp_factor_set_request_id = ${literal(id.anchorRequestB)}::uuid,
    approved_totp_factor_set_source = 'operator_adoption',
    approved_totp_factor_set_actor = 'fixture:phase7_30b2_concurrency',
    approved_totp_factor_set_reason = 'latest_schema_direct_session_fixture'
  where id = ${literal(id.principalB)}::uuid;

  insert into private.admin_step_up_nonces (
    id, nonce_hash, reserved_admin_session_id, environment_id, principal_id,
    membership_id, supabase_auth_session_id, intended_action, request_id,
    prechallenge_jwt_hash, min_amr_at, challenged_totp_factor_id,
    prechallenge_verified_totp_factor_set_hash,
    verified_totp_factor_set_hash, factor_set_bootstrap_allowed,
    approved_totp_factor_set_version, completion_jwt_hash,
    verified_totp_amr_at, issued_at, expires_at
  ) values
    (${literal(id.stepUpNonceA1)}::uuid, ${literal(stepUpNonceHashA1)}, ${literal(id.adminSessionA1)}::uuid, ${literal(id.environment)}::uuid, ${literal(id.principalA)}::uuid, ${literal(id.membershipA)}::uuid, ${literal(id.authSessionA1)}::uuid, 'admin_login', ${literal(id.stepUpRequestA1)}::uuid, ${literal(stepUpPrechallengeHashA1)}, statement_timestamp() - interval '1 minute', ${literal(id.mfaFactorA)}::uuid, private.current_verified_totp_factor_set_hash_v1(${literal(id.authUserA)}::uuid), private.current_verified_totp_factor_set_hash_v1(${literal(id.authUserA)}::uuid), false, 1, ${literal(stepUpCompletionHashA1)}, statement_timestamp(), statement_timestamp() - interval '1 minute', statement_timestamp() + interval '4 minutes'),
    (${literal(id.stepUpNonceA2)}::uuid, ${literal(stepUpNonceHashA2)}, ${literal(id.adminSessionA2)}::uuid, ${literal(id.environment)}::uuid, ${literal(id.principalA)}::uuid, ${literal(id.membershipA)}::uuid, ${literal(id.authSessionA2)}::uuid, 'admin_login', ${literal(id.stepUpRequestA2)}::uuid, ${literal(stepUpPrechallengeHashA2)}, statement_timestamp() - interval '1 minute', ${literal(id.mfaFactorA)}::uuid, private.current_verified_totp_factor_set_hash_v1(${literal(id.authUserA)}::uuid), private.current_verified_totp_factor_set_hash_v1(${literal(id.authUserA)}::uuid), false, 1, ${literal(stepUpCompletionHashA2)}, statement_timestamp(), statement_timestamp() - interval '1 minute', statement_timestamp() + interval '4 minutes'),
    (${literal(id.stepUpNonceB)}::uuid, ${literal(stepUpNonceHashB)}, ${literal(id.adminSessionB)}::uuid, ${literal(id.environment)}::uuid, ${literal(id.principalB)}::uuid, ${literal(id.membershipB)}::uuid, ${literal(id.authSessionB)}::uuid, 'admin_login', ${literal(id.stepUpRequestB)}::uuid, ${literal(stepUpPrechallengeHashB)}, statement_timestamp() - interval '1 minute', ${literal(id.mfaFactorB)}::uuid, private.current_verified_totp_factor_set_hash_v1(${literal(id.authUserB)}::uuid), private.current_verified_totp_factor_set_hash_v1(${literal(id.authUserB)}::uuid), false, 1, ${literal(stepUpCompletionHashB)}, statement_timestamp(), statement_timestamp() - interval '1 minute', statement_timestamp() + interval '4 minutes');

  update private.admin_identity_runtime_gate
  set google_session_issue_enabled = true
  where singleton;

  insert into public.admin_sessions (
    id, token_hash, auth_user_id, pin_version_hash, authentication_method, aal,
    principal_id, membership_id, environment_id, supabase_auth_session_id,
    step_up_verified_at, step_up_nonce_id, verified_totp_factor_set_hash,
    issued_at, last_seen_at,
    idle_expires_at, expires_at
  ) values
    (${literal(id.adminSessionA1)}::uuid, ${literal(tokenA1)}, ${literal(id.authUserA)}::uuid, null, 'google_totp', 2, ${literal(id.principalA)}::uuid, ${literal(id.membershipA)}::uuid, ${literal(id.environment)}::uuid, ${literal(id.authSessionA1)}::uuid, statement_timestamp(), ${literal(id.stepUpNonceA1)}::uuid, private.current_verified_totp_factor_set_hash_v1(${literal(id.authUserA)}::uuid), statement_timestamp() - interval '1 hour', statement_timestamp() - interval '1 hour', statement_timestamp() + interval '12 hours', statement_timestamp() + interval '12 hours'),
    (${literal(id.adminSessionA2)}::uuid, ${literal(tokenA2)}, ${literal(id.authUserA)}::uuid, null, 'google_totp', 2, ${literal(id.principalA)}::uuid, ${literal(id.membershipA)}::uuid, ${literal(id.environment)}::uuid, ${literal(id.authSessionA2)}::uuid, statement_timestamp(), ${literal(id.stepUpNonceA2)}::uuid, private.current_verified_totp_factor_set_hash_v1(${literal(id.authUserA)}::uuid), statement_timestamp() - interval '1 hour', statement_timestamp() - interval '1 hour', statement_timestamp() + interval '12 hours', statement_timestamp() + interval '12 hours'),
    (${literal(id.adminSessionB)}::uuid, ${literal(tokenB)}, ${literal(id.authUserB)}::uuid, null, 'google_totp', 2, ${literal(id.principalB)}::uuid, ${literal(id.membershipB)}::uuid, ${literal(id.environment)}::uuid, ${literal(id.authSessionB)}::uuid, statement_timestamp(), ${literal(id.stepUpNonceB)}::uuid, private.current_verified_totp_factor_set_hash_v1(${literal(id.authUserB)}::uuid), statement_timestamp() - interval '1 hour', statement_timestamp() - interval '1 hour', statement_timestamp() + interval '12 hours', statement_timestamp() + interval '12 hours');

  update private.admin_step_up_nonces
  set
    status = 'consumed',
    consumed_at = statement_timestamp() - interval '1 hour',
    completed_admin_session_id = reserved_admin_session_id,
    updated_at = statement_timestamp() - interval '1 hour'
  where id in (
    ${literal(id.stepUpNonceA1)}::uuid,
    ${literal(id.stepUpNonceA2)}::uuid,
    ${literal(id.stepUpNonceB)}::uuid
  );

  insert into private.admin_ai_unlock_factors (
    id, environment_id, principal_id, membership_id, pin_verifier,
    pin_pepper_version, factor_version, enrolled_by_admin_session_id,
    enrolled_step_up_verified_at, enrollment_request_id
  ) values
    (${literal(id.factorA)}::uuid, ${literal(id.environment)}::uuid, ${literal(id.principalA)}::uuid, ${literal(id.membershipA)}::uuid, extensions.crypt(${literal(pinHmacA)}, extensions.gen_salt('bf', 12)), 1, 1, ${literal(id.adminSessionA1)}::uuid, statement_timestamp() - interval '1 hour', ${literal(id.factorRequestA)}::uuid),
    (${literal(id.factorB)}::uuid, ${literal(id.environment)}::uuid, ${literal(id.principalB)}::uuid, ${literal(id.membershipB)}::uuid, extensions.crypt(${literal(pinHmacB)}, extensions.gen_salt('bf', 12)), 1, 1, ${literal(id.adminSessionB)}::uuid, statement_timestamp() - interval '1 hour', ${literal(id.factorRequestB)}::uuid);

  update private.admin_ai_unlock_runtime_gate
  set ai_unlock_enabled = true, remembered_browser_enabled = true
  where singleton;
  update private.admin_identity_runtime_gate
  set google_session_issue_enabled = true
  where singleton;
`)

await runSql(
  asServiceRole(`
    do $$
    begin
      if public.begin_admin_totp_step_up_v2(
        ${literal(id.environment)}::uuid,
        ${literal(id.authUserA)}::uuid,
        ${literal(id.authSessionA1)}::uuid,
        ${literal(id.mfaFactorA)}::uuid,
        ${literal(loginRaceNonceOld)},
        ${literal(id.loginRaceReservedOld)}::uuid,
        ${literal(loginRacePrechallengeOld)},
        ${literal(id.loginRaceRequestOld)}::uuid
      ) is null then
        raise exception 'could not seed login begin/complete lock-order race';
      end if;
    end;
    $$;
  `),
)

const loginBeginLockOrder = startSqlUntilReady(
  `
    begin;
    ${transactionSettings}
    select id
    from private.admin_principals
    where id = ${literal(id.principalA)}::uuid
    for update;
    select id
    from private.admin_environment_memberships
    where id = ${literal(id.membershipA)}::uuid
    for update;
    do $$
    begin
      raise notice 'PHASE730B22A_LOGIN_BEGIN_LOCKS_READY';
    end;
    $$;
    do $$
    declare
      wait_started_at timestamptz := clock_timestamp();
    begin
      while not exists (
        select 1
        from pg_catalog.pg_stat_activity
          where application_name = 'phase730b22a-login-complete-waiter'
            and wait_event_type = 'Lock'
            and pid <> pg_catalog.pg_backend_pid()
      ) loop
        if clock_timestamp() > wait_started_at + interval '10 seconds' then
          raise exception 'login complete did not reach the principal lock barrier';
        end if;
        perform pg_catalog.pg_sleep(0.01);
      end loop;
    end;
    $$;
    select id
    from private.admin_step_up_nonces
    where reserved_admin_session_id = ${literal(id.loginRaceReservedOld)}::uuid
    for update nowait;
    with outcome as (
      select public.begin_admin_totp_step_up_v2(
        ${literal(id.environment)}::uuid,
        ${literal(id.authUserA)}::uuid,
        ${literal(id.authSessionA1)}::uuid,
        ${literal(id.mfaFactorA)}::uuid,
        ${literal(loginRaceNonceNew)},
        ${literal(id.loginRaceReservedNew)}::uuid,
        ${literal(loginRacePrechallengeNew)},
        ${literal(id.loginRaceRequestNew)}::uuid
      ) as value
    )
    insert into public.phase7_30b2_concurrency_results (scenario, outcome)
    select 'login-begin-lock-order', to_jsonb(outcome.value)
    from outcome;
    commit;
  `,
  'PHASE730B22A_LOGIN_BEGIN_LOCKS_READY',
)
await loginBeginLockOrder.ready
const loginCompleteLockOrder = runSql(
  asServiceRole(`
    set local application_name = 'phase730b22a-login-complete-waiter';
    with outcome as (
      select coalesce(
        public.complete_admin_totp_step_up_v1(
          ${literal(loginRaceNonceOld)},
          ${literal(id.authUserA)}::uuid,
          ${literal(id.authSessionA1)}::uuid,
          2::smallint,
          ${literal(loginRaceCompletionJwt)},
          statement_timestamp(),
          'totp',
          statement_timestamp(),
          ${literal(loginRaceToken)},
          null,
          null,
          ${literal(id.loginRaceCompletionRequest)}::uuid
        ),
        '{"status":"rejected"}'::jsonb
      ) as value
    )
    insert into public.phase7_30b2_concurrency_results (scenario, outcome)
    select 'login-complete-lock-order', to_jsonb(outcome.value)
    from outcome;
  `),
)
await Promise.all([loginBeginLockOrder.done, loginCompleteLockOrder])

await runSql(`
  do $$
  begin
    if (select outcome ->> 'reserved_admin_session_id'
        from public.phase7_30b2_concurrency_results
        where scenario = 'login-begin-lock-order') <>
         ${literal(id.loginRaceReservedNew)}
       or (select outcome ->> 'status'
           from public.phase7_30b2_concurrency_results
           where scenario = 'login-complete-lock-order') <> 'rejected'
       or not exists (
         select 1 from private.admin_step_up_nonces
         where reserved_admin_session_id =
           ${literal(id.loginRaceReservedOld)}::uuid
           and status = 'superseded'
       )
       or not exists (
         select 1 from private.admin_step_up_nonces
         where reserved_admin_session_id =
           ${literal(id.loginRaceReservedNew)}::uuid
           and status = 'pending'
       ) then
      raise exception 'login begin/complete two-transaction lock order did not converge';
    end if;
  end;
  $$;
`)

const metadataExpression = (
  token,
  authUser,
  authSession,
  network,
  intent,
  request,
) => `
  public.get_admin_ai_pin_factor_metadata_v1(
    ${literal(token)}, ${literal(authUser)}::uuid, ${literal(authSession)}::uuid,
    ${literal(network)}, ${literal(intent)}, ${literal(request)}::uuid
  )
`

await Promise.all([
  runSql(
    recordServiceResult(
      'metadata-race-a',
      metadataExpression(
        tokenA1,
        id.authUserA,
        id.authSessionA1,
        networkRace,
        intentRace,
        id.metadataRaceRequest,
      ),
    ),
  ),
  runSql(
    recordServiceResult(
      'metadata-race-b',
      metadataExpression(
        tokenA1,
        id.authUserA,
        id.authSessionA1,
        networkRace,
        intentRace,
        id.metadataRaceRequest,
      ),
    ),
  ),
])
await runSql(`
  do $$
  begin
    if (select count(*) from private.admin_ai_pin_discovery_receipts where request_id = ${literal(id.metadataRaceRequest)}::uuid) <> 1
       or (select outcome from public.phase7_30b2_concurrency_results where scenario = 'metadata-race-a')
          is distinct from (select outcome from public.phase7_30b2_concurrency_results where scenario = 'metadata-race-b')
       or (select outcome ->> 'available' from public.phase7_30b2_concurrency_results where scenario = 'metadata-race-a') <> 'true' then
      raise exception 'concurrent PIN discovery did not converge to one exact receipt and result';
    end if;
  end;
  $$;
`)

const policyExpression = (token, authSession, requestId) => `
  public.set_admin_ai_policy_v1(
    ${literal(token)}, ${literal(id.authUserA)}::uuid, ${literal(authSession)}::uuid,
    ${literal(id.membershipA)}::uuid,
    array['academic_answers']::text[], array['test-model']::text[],
    10, 100, 10000, 100000, 10000, 100000, 1000000, 10000000,
    0, 0, 2, ${literal(policyValidFrom)}::timestamptz,
    ${literal(policyValidUntil)}::timestamptz, ${literal(requestId)}::uuid
  )
`
const policyIntentDigestExpression = `
  private.admin_ai_policy_control_intent_digest_v1(
    ${literal(id.membershipA)}::uuid,
    array['academic_answers']::text[], array['test-model']::text[],
    10, 100, 10000, 100000, 10000, 100000, 1000000, 10000000,
    0, 0, 2, ${literal(policyValidFrom)}::timestamptz,
    ${literal(policyValidUntil)}::timestamptz
  )
`
const policyCall = (token, authSession, requestId) =>
  asServiceRole(`select ${policyExpression(token, authSession, requestId)};`)

await runSql(
  asServiceRole(`
    do $$
    declare
      result_value jsonb;
    begin
      select ${policyExpression(tokenA1, id.authSessionA1, id.stalePolicyRequest)}
      into result_value;
      if result_value is not null then
        raise exception 'stale policy step-up unexpectedly succeeded';
      end if;
    end;
    $$;
  `),
)
await runSql(`
  do $$
  begin
    if exists (
      select 1 from private.admin_ai_policies
      where request_id = ${literal(id.stalePolicyRequest)}::uuid
    ) then
      raise exception 'stale policy step-up created authority';
    end if;
  end;
  $$;
  update public.admin_sessions
  set step_up_verified_at = statement_timestamp() - interval '1 minute'
  where id in (
    ${literal(id.adminSessionA1)}::uuid,
    ${literal(id.adminSessionA2)}::uuid
  );
`)
await Promise.all([
  seedControlGrant(
    id.adminSessionA1,
    'environment_ai_policy_change',
    id.policyRequestA,
    policyIntentDigestExpression,
  ),
  seedControlGrant(
    id.adminSessionA2,
    'environment_ai_policy_change',
    id.policyRequestB,
    policyIntentDigestExpression,
  ),
])
await Promise.all([
  runSql(policyCall(tokenA1, id.authSessionA1, id.policyRequestA)),
  runSql(policyCall(tokenA2, id.authSessionA2, id.policyRequestB)),
])
await runSql(`
  do $$
  begin
    if (select count(*) from private.admin_ai_policies where request_id in (${literal(id.policyRequestA)}::uuid, ${literal(id.policyRequestB)}::uuid)) <> 2
       or (select count(*) from private.admin_ai_policies where environment_id = ${literal(id.environment)}::uuid and membership_id = ${literal(id.membershipA)}::uuid and status = 'active' and version = 2) <> 1 then
      raise exception 'concurrent policy writes did not serialize to two versions and one active policy';
    end if;
  end;
  $$;
`)

const verifyExpression = (
  token,
  authUser,
  authSession,
  pepper,
  pin,
  network,
  intent,
  request,
) => `
  public.verify_admin_ai_pin_v1(
    ${literal(token)}, ${literal(authUser)}::uuid, ${literal(authSession)}::uuid,
    ${pepper}, ${literal(pin)}, ${literal(network)}, ${literal(intent)},
    ${literal(request)}::uuid
  )
`

await Promise.all([
  runSql(
    recordServiceResult(
      'semaphore-environment-metadata',
      metadataExpression(
        tokenA1,
        id.authUserA,
        id.authSessionA1,
        semaphoreEnvironmentNetwork,
        semaphoreEnvironmentIntent,
        id.semaphoreEnvironmentRequest,
      ),
    ),
  ),
  runSql(
    recordServiceResult(
      'semaphore-network-metadata',
      metadataExpression(
        tokenB,
        id.authUserB,
        id.authSessionB,
        semaphoreNetwork,
        semaphoreNetworkIntent,
        id.semaphoreNetworkRequest,
      ),
    ),
  ),
])

const holdAdvisorySlots = (readyScenario, lockKeys) => `
  ${lockKeys
    .map(
      (lockKey) =>
        `select pg_advisory_lock(pg_catalog.hashtextextended(${literal(lockKey)}, 732));`,
    )
    .join('\n')}
  begin;
  insert into public.phase7_30b2_concurrency_results (scenario, outcome)
  values (${literal(readyScenario)}, 'true'::jsonb);
  commit;
  select pg_sleep(0.50);
  ${[...lockKeys]
    .reverse()
    .map(
      (lockKey) =>
        `select pg_advisory_unlock(pg_catalog.hashtextextended(${literal(lockKey)}, 732));`,
    )
    .join('\n')}
`

await Promise.all([
  runSql(
    holdAdvisorySlots(
      'semaphore-environment-ready',
      [1, 2, 3, 4].map(
        (slot) => `bcrypt-environment:${id.environment}:${slot}`,
      ),
    ),
  ),
  runSql(
    recordAfterReadyServiceResult(
      'semaphore-environment-verify',
      'semaphore-environment-ready',
      verifyExpression(
        tokenA1,
        id.authUserA,
        id.authSessionA1,
        1,
        pinHmacA,
        semaphoreEnvironmentNetwork,
        semaphoreEnvironmentIntent,
        id.semaphoreEnvironmentRequest,
      ),
    ),
  ),
])

await Promise.all([
  runSql(
    holdAdvisorySlots(
      'semaphore-network-ready',
      [1, 2].map(
        (slot) =>
          `bcrypt-network:${id.environment}:${semaphoreNetwork}:${slot}`,
      ),
    ),
  ),
  runSql(
    recordAfterReadyServiceResult(
      'semaphore-network-verify',
      'semaphore-network-ready',
      verifyExpression(
        tokenB,
        id.authUserB,
        id.authSessionB,
        1,
        pinHmacB,
        semaphoreNetwork,
        semaphoreNetworkIntent,
        id.semaphoreNetworkRequest,
      ),
    ),
  ),
])

await runSql(`
  do $$
  begin
    if (select outcome ->> 'reason_code' from public.phase7_30b2_concurrency_results where scenario = 'semaphore-environment-verify') <> 'unlock_temporarily_unavailable'
       or (select (outcome ->> 'retry_after_seconds')::integer from public.phase7_30b2_concurrency_results where scenario = 'semaphore-environment-verify') <> 1
       or (select outcome -> 'factor_id' from public.phase7_30b2_concurrency_results where scenario = 'semaphore-environment-verify') is distinct from 'null'::jsonb
       or (select outcome ->> 'reason_code' from public.phase7_30b2_concurrency_results where scenario = 'semaphore-network-verify') <> 'unlock_temporarily_unavailable'
       or (select (outcome ->> 'retry_after_seconds')::integer from public.phase7_30b2_concurrency_results where scenario = 'semaphore-network-verify') <> 1
       or (select outcome -> 'factor_id' from public.phase7_30b2_concurrency_results where scenario = 'semaphore-network-verify') is distinct from 'null'::jsonb then
      raise exception 'bounded bcrypt semaphore did not return exact capacity denials';
    end if;
    if (select count(*) from private.admin_ai_unlock_rate_limits where environment_id = ${literal(id.environment)}::uuid) <> 0
       or exists (select 1 from private.admin_ai_unlock_rate_limits where environment_id = ${literal(id.environment)}::uuid and (failed_attempts <> 0 or locked_until is not null)) then
      raise exception 'bcrypt capacity denial mutated abuse counters';
    end if;
    if (select count(*) from private.admin_ai_unlock_attempt_receipts where request_id in (${literal(id.semaphoreEnvironmentRequest)}::uuid, ${literal(id.semaphoreNetworkRequest)}::uuid) and not verified and reason_code = 'unlock_temporarily_unavailable' and retry_after_seconds = 1 and factor_id is null and factor_version is null and factor_pin_pepper_version is null and input_pin_pepper_version = 1 and input_pin_proof_digest is not null) <> 2 then
      raise exception 'bcrypt capacity receipts lost exact input binding or nullable provenance';
    end if;
  end;
  $$;
`)

await runSql(`
  update public.admin_sessions
  set step_up_verified_at = statement_timestamp() - interval '1 minute'
  where id in (
    ${literal(id.adminSessionA1)}::uuid,
    ${literal(id.adminSessionA2)}::uuid
  );
`)
await Promise.all([
  runSql(
    recordServiceResult(
      'rate-metadata-a',
      metadataExpression(
        tokenA1,
        id.authUserA,
        id.authSessionA1,
        networkA,
        intentA,
        id.rateRequestA,
      ),
    ),
  ),
  runSql(
    recordServiceResult(
      'rate-metadata-b',
      metadataExpression(
        tokenB,
        id.authUserB,
        id.authSessionB,
        networkB,
        intentB,
        id.rateRequestB,
      ),
    ),
  ),
])
await Promise.all([
  runSql(
    recordServiceResult(
      'rate-verify-a',
      verifyExpression(
        tokenA1,
        id.authUserA,
        id.authSessionA1,
        1,
        pinHmacA,
        networkA,
        intentA,
        id.rateRequestA,
      ),
    ),
  ),
  runSql(
    recordServiceResult(
      'rate-verify-b',
      verifyExpression(
        tokenB,
        id.authUserB,
        id.authSessionB,
        1,
        pinHmacB,
        networkB,
        intentB,
        id.rateRequestB,
      ),
    ),
  ),
])
await runSql(`
  do $$
  begin
    if (select outcome ->> 'verified' from public.phase7_30b2_concurrency_results where scenario = 'rate-verify-a') <> 'true'
       or (select outcome ->> 'factor_id' from public.phase7_30b2_concurrency_results where scenario = 'rate-verify-a') <> ${literal(id.factorA)}
       or (select outcome ->> 'verified' from public.phase7_30b2_concurrency_results where scenario = 'rate-verify-b') <> 'true'
       or (select outcome ->> 'factor_id' from public.phase7_30b2_concurrency_results where scenario = 'rate-verify-b') <> ${literal(id.factorB)} then
      raise exception 'independent membership bcrypt verification did not return two exact successes';
    end if;
    if (select count(*) from private.admin_ai_unlock_rate_limits where environment_id = ${literal(id.environment)}::uuid) <> 5
       or exists (select 1 from private.admin_ai_unlock_rate_limits where environment_id = ${literal(id.environment)}::uuid and (failed_attempts <> 0 or locked_until is not null)) then
      raise exception 'independent membership verification produced incorrect shared rate counts';
    end if;
    if (select count(*) from private.admin_ai_unlock_attempt_receipts where request_id in (${literal(id.rateRequestA)}::uuid, ${literal(id.rateRequestB)}::uuid) and verified and input_pin_pepper_version = 1 and input_pin_proof_digest is not null and factor_id in (${literal(id.factorA)}::uuid, ${literal(id.factorB)}::uuid)) <> 2 then
      raise exception 'independent membership verification receipts lost exact input or factor provenance';
    end if;
  end;
  $$;
`)

await Promise.all([
  runSql(
    recordServiceResult(
      'wrong-rate-metadata-a',
      metadataExpression(
        tokenA1,
        id.authUserA,
        id.authSessionA1,
        networkA,
        wrongIntentA,
        id.wrongRateRequestA,
      ),
    ),
  ),
  runSql(
    recordServiceResult(
      'wrong-rate-metadata-b',
      metadataExpression(
        tokenB,
        id.authUserB,
        id.authSessionB,
        networkB,
        wrongIntentB,
        id.wrongRateRequestB,
      ),
    ),
  ),
])
await Promise.all([
  runSql(
    recordServiceResult(
      'wrong-rate-verify-a',
      verifyExpression(
        tokenA1,
        id.authUserA,
        id.authSessionA1,
        1,
        wrongPinHmacA,
        networkA,
        wrongIntentA,
        id.wrongRateRequestA,
      ),
    ),
  ),
  runSql(
    recordServiceResult(
      'wrong-rate-verify-b',
      verifyExpression(
        tokenB,
        id.authUserB,
        id.authSessionB,
        1,
        wrongPinHmacB,
        networkB,
        wrongIntentB,
        id.wrongRateRequestB,
      ),
    ),
  ),
])
await runSql(`
  do $$
  begin
    if (select outcome ->> 'reason_code' from public.phase7_30b2_concurrency_results where scenario = 'wrong-rate-verify-a') <> 'invalid_unlock'
       or (select outcome ->> 'reason_code' from public.phase7_30b2_concurrency_results where scenario = 'wrong-rate-verify-b') <> 'invalid_unlock'
       or (select failed_attempts from private.admin_ai_unlock_rate_limits where environment_id = ${literal(id.environment)}::uuid and bucket_kind = 'environment') <> 2
       or (select count(*) from private.admin_ai_unlock_rate_limits where environment_id = ${literal(id.environment)}::uuid and bucket_kind in ('membership', 'network') and failed_attempts = 1) <> 4 then
      raise exception 'independent membership failed verification produced incorrect exact shared and scoped counts';
    end if;
  end;
  $$;
`)

const ownerDelete = `
  begin;
  ${transactionSettings}
  select 1 from private.admin_environment_memberships where id = ${literal(id.membershipA)}::uuid for update;
  select pg_sleep(0.30);
  do $$
  begin
    begin
      delete from private.admin_environment_memberships where id = ${literal(id.membershipA)}::uuid;
      insert into public.phase7_30b2_concurrency_results values ('owner-delete', '{"sqlstate":"unexpected_success"}'::jsonb);
    exception when sqlstate 'P7310' then
      insert into public.phase7_30b2_concurrency_results values ('owner-delete', jsonb_build_object('sqlstate', sqlstate));
    end;
  end;
  $$;
  commit;
`
const ownerContext = asServiceRole(`
  select pg_sleep(0.10);
  with outcome as (
    select ${metadataExpression(tokenA1, id.authUserA, id.authSessionA1, ownerNetwork, ownerIntent, id.ownerContextRequest)} as value
  )
  insert into public.phase7_30b2_concurrency_results (scenario, outcome)
  select 'owner-context', to_jsonb(outcome.value) from outcome;
`)
await Promise.all([runSql(ownerDelete), runSql(ownerContext)])
await runSql(`
  do $$
  begin
    if (select outcome ->> 'sqlstate' from public.phase7_30b2_concurrency_results where scenario = 'owner-delete') <> 'P7310'
       or (select outcome ->> 'available' from public.phase7_30b2_concurrency_results where scenario = 'owner-context') <> 'true'
       or not exists (select 1 from private.admin_environment_memberships where id = ${literal(id.membershipA)}::uuid and role = 'owner' and status = 'active') then
      raise exception 'last-owner DELETE/context race did not reject exactly without deadlock';
    end if;
  end;
  $$;
`)

await runSql(`
  update public.admin_sessions
  set step_up_verified_at = statement_timestamp() - interval '1 minute'
  where id in (
    ${literal(id.adminSessionA1)}::uuid,
    ${literal(id.adminSessionA2)}::uuid
  );
`)
await seedControlGrant(
  id.adminSessionA2,
  'ai_pin_rotate',
  id.rotationRequest,
  `private.admin_ai_pin_control_intent_digest_v1('ai_pin_rotate', 2, ${literal(rotatedPinHmac)})`,
)
await Promise.all([
  runSql(
    recordServiceResult(
      'rotation-metadata',
      metadataExpression(
        tokenA1,
        id.authUserA,
        id.authSessionA1,
        networkRace,
        rotationIntent,
        id.rotationMetadataRequest,
      ),
    ),
  ),
  runSql(
    recordServiceResult(
      'rotation-factor',
      `public.enroll_admin_ai_pin_v1(${literal(tokenA2)}, ${literal(id.authUserA)}::uuid, ${literal(id.authSessionA2)}::uuid, ${literal(rotatedPinHmac)}, 2, ${literal(id.rotationRequest)}::uuid)`,
    ),
  ),
  runSql(
    recordDelayedServiceResult(
      'rotation-factor-retry',
      `public.enroll_admin_ai_pin_v1(${literal(tokenA2)}, ${literal(id.authUserA)}::uuid, ${literal(id.authSessionA2)}::uuid, ${literal(rotatedPinHmac)}, 2, ${literal(id.rotationRequest)}::uuid)`,
    ),
  ),
])
await runSql(`
  do $$
  begin
    if (select outcome ->> 'factor_version' from public.phase7_30b2_concurrency_results where scenario = 'rotation-factor') <> '2'
       or (select outcome from public.phase7_30b2_concurrency_results where scenario = 'rotation-factor')
          is distinct from (select outcome from public.phase7_30b2_concurrency_results where scenario = 'rotation-factor-retry')
       or (select outcome ->> 'available' from public.phase7_30b2_concurrency_results where scenario = 'rotation-metadata') <> 'true'
       or (select (outcome ->> 'factor_version')::integer from public.phase7_30b2_concurrency_results where scenario = 'rotation-metadata') not in (1, 2)
       or (select count(*) from private.admin_ai_unlock_factors where environment_id = ${literal(id.environment)}::uuid and membership_id = ${literal(id.membershipA)}::uuid and status = 'active' and factor_version = 2 and pin_pepper_version = 2) <> 1 then
      raise exception 'PIN discovery/rotation race did not converge to exact factor v2';
    end if;
  end;
  $$;

  insert into public.lecture_sessions (id, title, code_hash, status, starts_at, ends_at)
  values (${literal(id.lecture)}::uuid, 'B2 lock-order concurrency', ${literal(hex())}, 'open', statement_timestamp() - interval '5 minutes', statement_timestamp() + interval '1 hour');
  insert into public.lecture_ai_control (lecture_session_id) values (${literal(id.lecture)}::uuid);

  create function private.phase7_30b2_concurrency_child_delay_v1()
  returns trigger
  language plpgsql
  set search_path = ''
  as $$
  begin
    if old.id = ${literal(id.challengeFour)}::uuid
       and old.status = 'pending'
       and new.status <> 'pending' then
      -- UPDATE already owns the assertion row when the BEFORE ROW trigger runs.
      -- Hold that exact lock until the other transaction is observed waiting.
      raise notice 'PHASE730B22A_SESSION_FACTOR_ASSERTION_LOCK_READY';
      declare
        wait_started_at timestamptz := clock_timestamp();
      begin
        while not exists (
          select 1
          from pg_catalog.pg_stat_activity
          where application_name = 'phase730b22a-session-revoke-waiter'
            and wait_event_type = 'Lock'
            and pid <> pg_catalog.pg_backend_pid()
        ) loop
          if clock_timestamp() > wait_started_at + interval '10 seconds' then
            raise exception 'session revoke did not reach the assertion lock barrier';
          end if;
          perform pg_catalog.pg_sleep(0.01);
        end loop;
        perform nonce.id
        from private.admin_ai_browser_enrollment_nonces as nonce
        where nonce.id = ${literal(id.enrollmentFour)}::uuid
        for update nowait;
      end;
    elsif old.id in (${literal(id.challengeOne)}::uuid, ${literal(id.challengeTwo)}::uuid, ${literal(id.challengeThree)}::uuid)
       and old.status = 'pending'
       and new.status <> 'pending' then
      perform pg_catalog.pg_sleep(0.40);
    end if;
    return new;
  end;
  $$;
  revoke all on function private.phase7_30b2_concurrency_child_delay_v1()
    from public, anon, authenticated, service_role;
  create trigger phase7_30b2_concurrency_child_delay
  before update on private.admin_ai_browser_assertion_challenges
  for each row execute function private.phase7_30b2_concurrency_child_delay_v1();
`)

const expiredBrowserFixture = (
  enrollmentId,
  credentialId,
  challengeId,
  nonceHash,
  credentialHash,
  challengeHash,
  adminSessionId = id.adminSessionA1,
) => `
  -- The nonce remains pending on purpose. Credential expiry/self-revoke drains
  -- only credential-derived assertions, so cleanup later marks this nonce
  -- expired. Factor rotation owns the broader edge and marks it superseded.
  insert into private.admin_ai_browser_enrollment_nonces (
    id, nonce_hash, reserved_browser_credential_id, credential_hash,
    environment_id, principal_id, membership_id, admin_session_id,
    factor_id, factor_version, step_up_verified_at, origin,
    public_key_fingerprint, absolute_expires_at, begin_request_id,
    issued_at, expires_at
  )
  select ${literal(enrollmentId)}::uuid, ${literal(nonceHash)}, ${literal(credentialId)}::uuid,
    ${literal(credentialHash)}, factor.environment_id, factor.principal_id,
    factor.membership_id, ${literal(adminSessionId)}::uuid, factor.id,
    factor.factor_version, statement_timestamp() - interval '1 hour',
    'http://127.0.0.1:5173', ${literal(jwkFingerprint)},
    statement_timestamp() - interval '1 day', ${literal(randomUUID())}::uuid,
    statement_timestamp() - interval '2 days',
    statement_timestamp() - interval '2 days' + interval '4 minutes'
  from private.admin_ai_unlock_factors as factor
  where factor.membership_id = ${literal(id.membershipA)}::uuid and factor.status = 'active';

  insert into private.admin_ai_browser_credentials (
    id, credential_hash, environment_id, principal_id, membership_id,
    source_factor_id, source_factor_version, origin, public_key_jwk,
    public_key_fingerprint, enrolled_by_admin_session_id,
    enrollment_nonce_id, created_at, expires_at
  )
  select ${literal(credentialId)}::uuid, ${literal(credentialHash)}, factor.environment_id,
    factor.principal_id, factor.membership_id, factor.id, factor.factor_version,
    'http://127.0.0.1:5173', ${literal(JSON.stringify(jwk))}::jsonb,
    ${literal(jwkFingerprint)}, ${literal(adminSessionId)}::uuid,
    ${literal(enrollmentId)}::uuid, statement_timestamp() - interval '2 days',
    statement_timestamp() - interval '1 day'
  from private.admin_ai_unlock_factors as factor
  where factor.membership_id = ${literal(id.membershipA)}::uuid and factor.status = 'active';

  insert into private.admin_ai_browser_assertion_challenges (
    id, challenge_hash, browser_credential_id, environment_id, principal_id,
    membership_id, admin_session_id, factor_id, factor_version,
    lecture_session_id, requested_scope, policy_id, policy_version, origin,
    begin_request_id, issued_at, expires_at
  )
  select ${literal(challengeId)}::uuid, ${literal(challengeHash)}, ${literal(credentialId)}::uuid,
    factor.environment_id, factor.principal_id, factor.membership_id,
    ${literal(adminSessionId)}::uuid, factor.id, factor.factor_version,
    ${literal(id.lecture)}::uuid, 'all_except_captions', policy.id, policy.version,
    'http://127.0.0.1:5173', ${literal(randomUUID())}::uuid,
    statement_timestamp() - interval '2 days',
    statement_timestamp() - interval '2 days' + interval '4 minutes'
  from private.admin_ai_unlock_factors as factor
  join private.admin_ai_policies as policy
    on policy.membership_id = factor.membership_id and policy.status = 'active'
  where factor.membership_id = ${literal(id.membershipA)}::uuid and factor.status = 'active';
`

await runSql(
  expiredBrowserFixture(
    id.enrollmentOne,
    id.credentialOne,
    id.challengeOne,
    proof.nonceOne,
    proof.credentialOne,
    proof.challengeOne,
  ),
)
await seedControlGrant(
  id.adminSessionA2,
  'ai_pin_rotate',
  id.cleanupFactorRequest,
  `private.admin_ai_pin_control_intent_digest_v1('ai_pin_rotate', 3, ${literal(cleanupRotatedPinHmac)})`,
)
await Promise.all([
  runSql(
    recordServiceResult(
      'cleanup-rotation-cleanup',
      `public.cleanup_admin_ai_ephemera_v1(statement_timestamp() - interval '1 day', ${literal(id.cleanupRotationRequest)}::uuid)`,
    ),
  ),
  runSql(
    recordDelayedServiceResult(
      'cleanup-rotation-factor',
      `public.enroll_admin_ai_pin_v1(${literal(tokenA2)}, ${literal(id.authUserA)}::uuid, ${literal(id.authSessionA2)}::uuid, ${literal(cleanupRotatedPinHmac)}, 3, ${literal(id.cleanupFactorRequest)}::uuid)`,
    ),
  ),
])
await runSql(`
  do $$
  declare
    cleanup_count integer;
    rotation_count integer;
  begin
    cleanup_count := coalesce((select (outcome ->> 'browser_credentials_expired')::integer from public.phase7_30b2_concurrency_results where scenario = 'cleanup-rotation-cleanup'), -1);
    rotation_count := (select count(*) from private.admin_ai_browser_credentials where id = ${literal(id.credentialOne)}::uuid and status = 'revoked' and revoke_reason = 'factor_rotated');
    if cleanup_count + rotation_count <> 1
       or (select outcome ->> 'factor_version' from public.phase7_30b2_concurrency_results where scenario = 'cleanup-rotation-factor') <> '3'
       or (select count(*) from private.admin_ai_unlock_factors where membership_id = ${literal(id.membershipA)}::uuid and status = 'active' and factor_version = 3) <> 1
       or not exists (select 1 from private.admin_ai_browser_credentials where id = ${literal(id.credentialOne)}::uuid and ((cleanup_count = 1 and status = 'expired' and revoke_reason = 'absolute_expiry') or (rotation_count = 1 and status = 'revoked' and revoke_reason = 'factor_rotated')))
       -- Generic child cleanup can win after credential cleanup loses the
       -- membership try-lock, so either safe terminal reason is deterministic.
       or not exists (select 1 from private.admin_ai_browser_enrollment_nonces where id = ${literal(id.enrollmentOne)}::uuid and status in ('expired', 'superseded'))
       or not exists (select 1 from private.admin_ai_browser_assertion_challenges where id = ${literal(id.challengeOne)}::uuid and status in ('expired', 'superseded'))
       or (select count(*) from private.admin_audit_events where request_id in (${literal(id.cleanupRotationRequest)}::uuid, ${literal(id.cleanupFactorRequest)}::uuid)) <> 3 then
      raise exception 'cleanup/rotation two-transaction race did not converge to one exact terminalizer';
    end if;
  end;
  $$;
`)

await runSql(
  expiredBrowserFixture(
    id.enrollmentTwo,
    id.credentialTwo,
    id.challengeTwo,
    proof.nonceTwo,
    proof.credentialTwo,
    proof.challengeTwo,
  ),
)
await Promise.all([
  runSql(
    recordServiceResult(
      'cleanup-revoke-cleanup',
      `public.cleanup_admin_ai_ephemera_v1(statement_timestamp() - interval '1 day', ${literal(id.cleanupRevokeRequest)}::uuid)`,
    ),
  ),
  runSql(
    recordDelayedServiceResult(
      'cleanup-revoke-self',
      `public.revoke_admin_ai_browser_credential_v1(${literal(tokenA1)}, ${literal(id.authUserA)}::uuid, ${literal(id.authSessionA1)}::uuid, ${literal(id.credentialTwo)}::uuid, ${literal(id.revokeRequest)}::uuid)`,
    ),
  ),
])
await runSql(`
  do $$
  declare
    cleanup_count integer;
    revoke_succeeded integer;
  begin
    cleanup_count := coalesce((select (outcome ->> 'browser_credentials_expired')::integer from public.phase7_30b2_concurrency_results where scenario = 'cleanup-revoke-cleanup'), -1);
    revoke_succeeded := case when coalesce((select outcome = 'true'::jsonb from public.phase7_30b2_concurrency_results where scenario = 'cleanup-revoke-self'), false) then 1 else 0 end;
    if cleanup_count + revoke_succeeded <> 1
       or not exists (select 1 from private.admin_ai_browser_credentials where id = ${literal(id.credentialTwo)}::uuid and ((cleanup_count = 1 and status = 'expired' and revoke_reason = 'absolute_expiry') or (revoke_succeeded = 1 and status = 'revoked' and revoke_reason = 'self_revoked')))
       -- Self-revoke is credential-scoped. The independently expired pending
       -- enrollment belongs to cleanup; its assertion may be terminalized by
       -- either the revoke drain or the scheduler-independent generic cleanup.
       or (select status from private.admin_ai_browser_enrollment_nonces where id = ${literal(id.enrollmentTwo)}::uuid) <> 'expired'
       or not exists (select 1 from private.admin_ai_browser_assertion_challenges where id = ${literal(id.challengeTwo)}::uuid and status in ('expired', 'superseded'))
       or (select count(*) from private.admin_audit_events where request_id = ${literal(id.cleanupRevokeRequest)}::uuid) <> 1
       or (select count(*) from private.admin_audit_events where request_id = ${literal(id.revokeRequest)}::uuid) <> revoke_succeeded then
      raise exception 'cleanup/revoke two-transaction race did not converge to one exact terminalizer';
    end if;
    if (select count(*) from public.admin_sessions where id in (${literal(id.adminSessionA1)}::uuid, ${literal(id.adminSessionA2)}::uuid, ${literal(id.adminSessionB)}::uuid) and revoked_at is null and idle_expires_at = expires_at) <> 3 then
      raise exception 'B2 concurrency revoked or shortened an Admin lecture session';
    end if;
  end;
  $$;
`)

await runSql(
  expiredBrowserFixture(
    id.enrollmentThree,
    id.credentialThree,
    id.challengeThree,
    proof.nonceThree,
    proof.credentialThree,
    proof.challengeThree,
  ),
)
await Promise.all([
  runSql(
    recordServiceResult(
      'cleanup-cleaner-a',
      `public.cleanup_admin_ai_ephemera_v1(statement_timestamp() - interval '1 day', ${literal(id.cleanupCleanerRequestA)}::uuid)`,
    ),
  ),
  runSql(
    recordDelayedServiceResult(
      'cleanup-cleaner-b',
      `public.cleanup_admin_ai_ephemera_v1(statement_timestamp() - interval '1 day', ${literal(id.cleanupCleanerRequestB)}::uuid)`,
    ),
  ),
])
await runSql(`
  do $$
  declare
    cleaner_a_count integer;
    cleaner_b_count integer;
  begin
    cleaner_a_count := coalesce((select (outcome ->> 'browser_credentials_expired')::integer from public.phase7_30b2_concurrency_results where scenario = 'cleanup-cleaner-a'), -1);
    cleaner_b_count := coalesce((select (outcome ->> 'browser_credentials_expired')::integer from public.phase7_30b2_concurrency_results where scenario = 'cleanup-cleaner-b'), -1);
    if cleaner_a_count + cleaner_b_count <> 1
       or not exists (select 1 from private.admin_ai_browser_credentials where id = ${literal(id.credentialThree)}::uuid and status = 'expired' and revoke_reason = 'absolute_expiry')
       or (select status from private.admin_ai_browser_enrollment_nonces where id = ${literal(id.enrollmentThree)}::uuid) <> 'expired'
       or not exists (select 1 from private.admin_ai_browser_assertion_challenges where id = ${literal(id.challengeThree)}::uuid and status in ('expired', 'superseded'))
       or (select count(*) from private.admin_audit_events where request_id in (${literal(id.cleanupCleanerRequestA)}::uuid, ${literal(id.cleanupCleanerRequestB)}::uuid)) <> 2 then
      raise exception 'two concurrent cleaners did not nonblockingly converge to one exact credential expiry';
    end if;
    if (select count(*) from public.admin_sessions where id in (${literal(id.adminSessionA1)}::uuid, ${literal(id.adminSessionA2)}::uuid, ${literal(id.adminSessionB)}::uuid) and revoked_at is null and idle_expires_at = expires_at) <> 3 then
      raise exception 'cleaner race revoked or shortened an Admin lecture session';
    end if;
  end;
  $$;
`)

await runSql(
  expiredBrowserFixture(
    id.enrollmentFour,
    id.credentialFour,
    id.challengeFour,
    proof.nonceFour,
    proof.credentialFour,
    proof.challengeFour,
    id.adminSessionA2,
  ),
)
await seedControlGrant(
  id.adminSessionA1,
  'ai_pin_rotate',
  id.sessionDrainRotationRequest,
  `private.admin_ai_pin_control_intent_digest_v1('ai_pin_rotate', 4, ${literal(sessionDrainRotatedPinHmac)})`,
)
const sessionFactorRotation = startSqlUntilReady(
  recordServiceResult(
    'session-drain-factor-rotation',
    `public.enroll_admin_ai_pin_v1(${literal(tokenA1)}, ${literal(id.authUserA)}::uuid, ${literal(id.authSessionA1)}::uuid, ${literal(sessionDrainRotatedPinHmac)}, 4, ${literal(id.sessionDrainRotationRequest)}::uuid)`,
  ),
  'PHASE730B22A_SESSION_FACTOR_ASSERTION_LOCK_READY',
)
await sessionFactorRotation.ready
const sessionSelfRevoke = runSql(
  asServiceRole(`
    set local application_name = 'phase730b22a-session-revoke-waiter';
    with outcome as (
      select public.revoke_own_google_admin_session_v1(
        ${literal(tokenA2)}, ${literal(id.authUserA)}::uuid,
        ${literal(id.authSessionA2)}::uuid,
        ${literal(id.sessionDrainRevokeRequest)}::uuid
      ) as value
    )
    insert into public.phase7_30b2_concurrency_results (scenario, outcome)
    select 'session-drain-self-revoke', to_jsonb(outcome.value)
    from outcome;
  `),
)
await Promise.all([sessionFactorRotation.done, sessionSelfRevoke])
await runSql(`
  do $$
  begin
    if (select outcome ->> 'factor_version'
        from public.phase7_30b2_concurrency_results
        where scenario = 'session-drain-factor-rotation') <> '4'
       or (select outcome
           from public.phase7_30b2_concurrency_results
           where scenario = 'session-drain-self-revoke') <> 'true'::jsonb
       or not exists (
         select 1 from public.admin_sessions
         where id = ${literal(id.adminSessionA2)}::uuid
           and revoke_reason = 'self_logout'
           and revoked_at is not null
       )
       or not exists (
         select 1 from private.admin_ai_browser_assertion_challenges
         where id = ${literal(id.challengeFour)}::uuid
           and status = 'superseded'
       )
       or not exists (
         select 1 from private.admin_ai_browser_enrollment_nonces
         where id = ${literal(id.enrollmentFour)}::uuid
           and status = 'superseded'
       ) then
      raise exception 'session revoke/factor drain two-transaction lock order did not converge';
    end if;
  end;
  $$;


  insert into private.admin_control_step_up_nonces (
    nonce_hash, environment_id, principal_id, membership_id, admin_session_id,
    supabase_auth_session_id, verified_totp_factor_set_hash, intended_action,
    intent_digest, mutation_request_id, prechallenge_jwt_hash, min_amr_at,
    expires_at
  )
  select ${literal(hex())}, session.environment_id, session.principal_id,
    session.membership_id, session.id, session.supabase_auth_session_id,
    session.verified_totp_factor_set_hash, 'ai_pin_reset',
    ${literal(hex())}, ${literal(randomUUID())}::uuid, ${literal(hex())},
    statement_timestamp(),
    statement_timestamp() + interval '5 minutes'
  from public.admin_sessions as session
  where session.id = ${literal(id.adminSessionA1)}::uuid;

  insert into auth.mfa_factors (
    id, user_id, friendly_name, factor_type, status, created_at, updated_at
  ) values (
    ${literal(randomUUID())}::uuid, ${literal(id.authUserA)}::uuid,
    'phase730b22a-factor-change', 'totp', 'verified',
    statement_timestamp(), statement_timestamp()
  );
`)

await Promise.all([
  runSql(
    recordServiceResult(
      'factor-reconcile',
      `public.reconcile_admin_totp_factor_set_v1(${literal(id.authUserA)}::uuid, ${literal(randomUUID())}::uuid)`,
    ),
  ),
  runSql(
    recordDelayedServiceResult(
      'factor-touch-race',
      `public.verify_and_touch_google_admin_session_v1(${literal(tokenA2)}, ${literal(id.authUserA)}::uuid, ${literal(id.authSessionA2)}::uuid)`,
    ),
  ),
])

await runSql(`
  do $$
  begin
    if (select outcome ->> 'revoked_sessions' from public.phase7_30b2_concurrency_results where scenario = 'factor-reconcile') <> '1'
       or (select count(*) from public.admin_sessions where id = ${literal(id.adminSessionA1)}::uuid and revoked_at is not null and revoke_reason = 'totp_factor_set_changed') <> 1
       or (select count(*) from public.admin_sessions where id = ${literal(id.adminSessionA2)}::uuid and revoked_at is not null and revoke_reason = 'self_logout') <> 1
       or (select count(*) from public.admin_sessions where id = ${literal(id.adminSessionB)}::uuid and revoked_at is null) <> 1
       or exists (select 1 from private.admin_control_step_up_nonces where admin_session_id = ${literal(id.adminSessionA1)}::uuid and status = 'pending') then
      raise exception 'factor reconciliation/session touch race did not converge to stale-session drain';
    end if;
  end;
  $$;

  drop trigger phase7_30b2_concurrency_child_delay
    on private.admin_ai_browser_assertion_challenges;
  drop function private.phase7_30b2_concurrency_child_delay_v1();
  drop table public.phase7_30b2_concurrency_results;
`)

console.log(
  'Phase 7.30B2/B2.2a exact request, single-use control, factor reconciliation, bounded bcrypt, independent-rate, owner DELETE and cleanup races converged without deadlock.',
)
