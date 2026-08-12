import { randomBytes, randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'

const container =
  process.env.SUPABASE_DB_CONTAINER ?? 'supabase_db_compass-interactive'
const id = Object.fromEntries(
  [
    'environment',
    'authUserA',
    'authUserB',
    'authUserC',
    'authSessionA',
    'mfaFactorA',
    'principalA',
    'principalB',
    'principalC',
    'membershipA',
    'membershipB',
    'membershipC',
    'factorAnchorA',
    'loginNonceA',
    'loginRequestA',
    'adminSessionA',
    'invitation',
    'invitationIssueRequest',
    'invitationRevokeRequest',
    'admissionRequest',
  ].map((name) => [name, randomUUID()]),
)
const hex = () => randomBytes(32).toString('hex')
const tokenA = hex()
const subjectA = hex()
const subjectB = hex()
const subjectC = hex()
const emailHmacC = hex()
const invitationTokenHash = hex()
const loginNonceHash = hex()
const prechallengeHash = hex()
const completionHash = hex()

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
      if (code === 0) resolve(stdout)
      else reject(new Error(stderr.trim() || stdout.trim() || `psql exited with ${code}`))
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
    const observe = (chunk) => {
      if (!readySettled && chunk.includes(readyMarker)) {
        readySettled = true
        resolveReady()
      }
    }
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk) => {
      stdout += chunk
      observe(chunk)
    })
    child.stderr.on('data', (chunk) => {
      stderr += chunk
      observe(chunk)
    })
    child.on('error', (error) => {
      if (!readySettled) {
        readySettled = true
        rejectReady(error)
      }
      reject(error)
    })
    child.on('exit', (code) => {
      if (code === 0 && readySettled) {
        resolve()
        return
      }
      const error = new Error(
        stderr.trim() ||
          stdout.trim() ||
          `psql exited before readiness marker ${readyMarker}`,
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

async function seedControlGrant() {
  const nonceId = randomUUID()
  const grantId = randomUUID()
  await runSql(`
    insert into private.admin_control_step_up_nonces (
      id, nonce_hash, environment_id, principal_id, membership_id,
      admin_session_id, supabase_auth_session_id,
      verified_totp_factor_set_hash, intended_action, intent_digest,
      mutation_request_id, prechallenge_jwt_hash, min_amr_at, issued_at,
      expires_at, status, consumed_at, completed_grant_id
    )
    select
      ${literal(nonceId)}::uuid, ${literal(hex())}, session.environment_id,
      session.principal_id, session.membership_id, session.id,
      session.supabase_auth_session_id, session.verified_totp_factor_set_hash,
      'admin_invitation_change', intent.outcome ->> 'intentDigest',
      ${literal(id.invitationRevokeRequest)}::uuid, ${literal(hex())},
      statement_timestamp() - interval '1 minute',
      statement_timestamp() - interval '1 minute',
      statement_timestamp() + interval '4 minutes', 'consumed',
      statement_timestamp(), ${literal(grantId)}::uuid
    from public.admin_sessions as session
    cross join public.phase7_30d_concurrency_results as intent
    where session.id = ${literal(id.adminSessionA)}::uuid
      and intent.scenario = 'invitation-revoke-intent';

    insert into private.admin_control_step_up_grants (
      id, source_kind, control_nonce_id, environment_id, principal_id,
      membership_id, admin_session_id, supabase_auth_session_id,
      verified_totp_factor_set_hash, intended_action, intent_digest,
      mutation_request_id, prechallenge_jwt_hash, completion_jwt_hash,
      min_amr_at, verified_totp_amr_at, issued_at, expires_at
    )
    select
      ${literal(grantId)}::uuid, 'control', ${literal(nonceId)}::uuid,
      session.environment_id, session.principal_id, session.membership_id,
      session.id, session.supabase_auth_session_id,
      session.verified_totp_factor_set_hash, 'admin_invitation_change',
      intent.outcome ->> 'intentDigest',
      ${literal(id.invitationRevokeRequest)}::uuid, nonce.prechallenge_jwt_hash,
      ${literal(hex())}, statement_timestamp() - interval '1 minute',
      statement_timestamp() - interval '1 minute', statement_timestamp(),
      statement_timestamp() + interval '4 minutes'
    from public.admin_sessions as session
    cross join public.phase7_30d_concurrency_results as intent
    join private.admin_control_step_up_nonces as nonce
      on nonce.id = ${literal(nonceId)}::uuid
    where session.id = ${literal(id.adminSessionA)}::uuid
      and intent.scenario = 'invitation-revoke-intent';
  `)
}

await runSql(`
  do $$
  begin
    if exists (
      select 1 from private.admin_environments where current_deployment
    ) then
      raise exception 'Phase 7.30D concurrency requires a reset database';
    end if;
  end;
  $$;

  drop table if exists public.phase7_30d_concurrency_results;
  create table public.phase7_30d_concurrency_results (
    scenario text primary key,
    sqlstate text not null check (char_length(sqlstate) = 5),
    outcome jsonb
  );
  revoke all on public.phase7_30d_concurrency_results
    from public, anon, authenticated, service_role;
  grant select, insert on public.phase7_30d_concurrency_results
    to service_role;

  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at
  ) values
    ('00000000-0000-0000-0000-000000000000'::uuid,
      ${literal(id.authUserA)}::uuid, 'authenticated', 'authenticated',
      ${literal(`phase730d-a-${id.authUserA}@example.test`)}, '',
      statement_timestamp() - interval '1 hour',
      '{"provider":"google","providers":["google"]}'::jsonb, '{}'::jsonb,
      statement_timestamp() - interval '1 hour', statement_timestamp() - interval '1 hour'),
    ('00000000-0000-0000-0000-000000000000'::uuid,
      ${literal(id.authUserB)}::uuid, 'authenticated', 'authenticated',
      ${literal(`phase730d-b-${id.authUserB}@example.test`)}, '',
      statement_timestamp() - interval '1 hour',
      '{"provider":"google","providers":["google"]}'::jsonb, '{}'::jsonb,
      statement_timestamp() - interval '1 hour', statement_timestamp() - interval '1 hour'),
    ('00000000-0000-0000-0000-000000000000'::uuid,
      ${literal(id.authUserC)}::uuid, 'authenticated', 'authenticated',
      'phase730d-invitee@example.test', '',
      statement_timestamp() - interval '1 hour',
      '{"provider":"google","providers":["google"]}'::jsonb, '{}'::jsonb,
      statement_timestamp() - interval '1 hour', statement_timestamp() - interval '1 hour');

  insert into auth.sessions (id, user_id, created_at, updated_at) values (
    ${literal(id.authSessionA)}::uuid, ${literal(id.authUserA)}::uuid,
    statement_timestamp() - interval '1 hour',
    statement_timestamp() - interval '1 hour'
  );
  insert into auth.mfa_factors (
    id, user_id, friendly_name, factor_type, status, created_at, updated_at
  ) values (
    ${literal(id.mfaFactorA)}::uuid, ${literal(id.authUserA)}::uuid,
    'phase730d-concurrency-a', 'totp', 'verified',
    statement_timestamp() - interval '1 hour',
    statement_timestamp() - interval '1 hour'
  );

  insert into private.admin_environments (
    id, environment_kind, canonical_admin_origin, supabase_issuer,
    current_deployment
  ) values (
    ${literal(id.environment)}::uuid, 'local', 'http://127.0.0.1:5173',
    'http://127.0.0.1:54321/auth/v1', false
  );
  insert into private.admin_principals (
    id, auth_user_id, google_issuer, provider_subject_hmac,
    subject_pepper_version, normalized_email, email_verified_at, display_name
  ) values
    (${literal(id.principalA)}::uuid, ${literal(id.authUserA)}::uuid,
      'https://accounts.google.com', ${literal(subjectA)}, 1,
      ${literal(`phase730d-a-${id.authUserA}@example.test`)},
      statement_timestamp() - interval '1 hour', 'Owner A'),
    (${literal(id.principalB)}::uuid, ${literal(id.authUserB)}::uuid,
      'https://accounts.google.com', ${literal(subjectB)}, 1,
      ${literal(`phase730d-b-${id.authUserB}@example.test`)},
      statement_timestamp() - interval '1 hour', 'Owner B'),
    (${literal(id.principalC)}::uuid, ${literal(id.authUserC)}::uuid,
      'https://accounts.google.com', ${literal(subjectC)}, 1,
      'phase730d-invitee@example.test',
      statement_timestamp() - interval '1 hour', 'Invitee C');

  insert into private.admin_environment_memberships (
    id, environment_id, principal_id, role, status, can_use_ai, activated_at
  ) values
    (${literal(id.membershipA)}::uuid, ${literal(id.environment)}::uuid,
      ${literal(id.principalA)}::uuid, 'instructor', 'active', false,
      statement_timestamp() - interval '1 hour'),
    (${literal(id.membershipB)}::uuid, ${literal(id.environment)}::uuid,
      ${literal(id.principalB)}::uuid, 'instructor', 'active', false,
      statement_timestamp() - interval '1 hour');
  update private.admin_environment_memberships
  set role = 'owner'
  where id in (${literal(id.membershipA)}::uuid, ${literal(id.membershipB)}::uuid);
  update private.admin_environments
  set current_deployment = true,
      bootstrap_sealed_at = statement_timestamp(),
      owner_invariant_enforced_at = statement_timestamp()
  where id = ${literal(id.environment)}::uuid;

  update private.admin_principals
  set approved_totp_factor_set_hash = snapshot.factor_set_hash,
      approved_totp_factor_set_version = 1,
      approved_totp_factor_count = snapshot.factor_count,
      approved_totp_factor_set_at = statement_timestamp(),
      approved_totp_factor_set_request_id = ${literal(id.factorAnchorA)}::uuid,
      approved_totp_factor_set_source = 'operator_adoption',
      approved_totp_factor_set_actor = 'fixture:phase730d-concurrency',
      approved_totp_factor_set_reason = 'D concurrency fixture'
  from private.current_verified_totp_factor_set_snapshot_v1(
    ${literal(id.authUserA)}::uuid
  ) as snapshot
  where id = ${literal(id.principalA)}::uuid;

  update private.admin_identity_runtime_gate
  set google_session_issue_enabled = true,
      google_admin_ledger_enabled = false
  where singleton;
  insert into private.admin_step_up_nonces (
    id, nonce_hash, reserved_admin_session_id, environment_id, principal_id,
    membership_id, supabase_auth_session_id, intended_action, request_id,
    prechallenge_jwt_hash, min_amr_at, challenged_totp_factor_id,
    prechallenge_verified_totp_factor_set_hash,
    verified_totp_factor_set_hash, factor_set_bootstrap_allowed,
    approved_totp_factor_set_version, completion_jwt_hash,
    verified_totp_amr_at, issued_at, expires_at
  ) values (
    ${literal(id.loginNonceA)}::uuid, ${literal(loginNonceHash)},
    ${literal(id.adminSessionA)}::uuid, ${literal(id.environment)}::uuid,
    ${literal(id.principalA)}::uuid, ${literal(id.membershipA)}::uuid,
    ${literal(id.authSessionA)}::uuid, 'admin_login',
    ${literal(id.loginRequestA)}::uuid, ${literal(prechallengeHash)},
    statement_timestamp() - interval '1 minute',
    ${literal(id.mfaFactorA)}::uuid,
    private.current_verified_totp_factor_set_hash_v1(${literal(id.authUserA)}::uuid),
    private.current_verified_totp_factor_set_hash_v1(${literal(id.authUserA)}::uuid),
    false, 1, ${literal(completionHash)}, statement_timestamp(),
    statement_timestamp() - interval '1 minute',
    statement_timestamp() + interval '4 minutes'
  );
  insert into public.admin_sessions (
    id, token_hash, auth_user_id, pin_version_hash, authentication_method, aal,
    principal_id, membership_id, environment_id, supabase_auth_session_id,
    step_up_verified_at, step_up_nonce_id, verified_totp_factor_set_hash,
    issued_at, last_seen_at, idle_expires_at, expires_at
  ) values (
    ${literal(id.adminSessionA)}::uuid, ${literal(tokenA)},
    ${literal(id.authUserA)}::uuid, null, 'google_totp', 2,
    ${literal(id.principalA)}::uuid, ${literal(id.membershipA)}::uuid,
    ${literal(id.environment)}::uuid, ${literal(id.authSessionA)}::uuid,
    statement_timestamp(), ${literal(id.loginNonceA)}::uuid,
    private.current_verified_totp_factor_set_hash_v1(${literal(id.authUserA)}::uuid),
    statement_timestamp() - interval '1 hour',
    statement_timestamp() - interval '1 hour',
    statement_timestamp() + interval '12 hours',
    statement_timestamp() + interval '12 hours'
  );
  update private.admin_step_up_nonces
  set status = 'consumed', consumed_at = statement_timestamp(),
      completed_admin_session_id = ${literal(id.adminSessionA)}::uuid,
      updated_at = statement_timestamp()
  where id = ${literal(id.loginNonceA)}::uuid;

  insert into private.admin_invitations (
    id, environment_id, invitation_kind, target_email_hmac,
    target_normalized_email, target_email_pepper_version,
    role, can_use_ai, token_hash, inviter_membership_id,
    membership_expires_at, expires_at, status, request_id
  ) values (
    ${literal(id.invitation)}::uuid, ${literal(id.environment)}::uuid,
    'invitation', ${literal(emailHmacC)},
    'phase730d-invitee@example.test', 1, 'instructor', true,
    ${literal(invitationTokenHash)}, ${literal(id.membershipA)}::uuid,
    statement_timestamp() + interval '7 days',
    statement_timestamp() + interval '2 days', 'pending',
    ${literal(id.invitationIssueRequest)}::uuid
  );
  insert into public.phase7_30d_concurrency_results
    (scenario, sqlstate, outcome)
  select 'invitation-revoke-payload', '00000', jsonb_build_object(
    'invitation_id', invitation.id,
    'expected_status', 'pending',
    'expected_updated_at', invitation.updated_at
  )
  from private.admin_invitations as invitation
  where invitation.id = ${literal(id.invitation)}::uuid;
`)

await runSql(
  asServiceRole(`
    with intent as (
      select public.get_google_admin_ledger_intent_v1(
        ${literal(tokenA)}, ${literal(id.authUserA)}::uuid,
        ${literal(id.authSessionA)}::uuid, 'https://accounts.google.com',
        ${literal(subjectA)}, 1, true, 'revokeInvitation',
        ${literal(id.invitationRevokeRequest)}::uuid,
        (select outcome from public.phase7_30d_concurrency_results
         where scenario = 'invitation-revoke-payload')
      ) as value
    )
    insert into public.phase7_30d_concurrency_results
      (scenario, sqlstate, outcome)
    select 'invitation-revoke-intent', '00000', value from intent;
  `),
)
await seedControlGrant()

const demoteWinner = startSqlUntilReady(
  `
    begin;
    ${transactionSettings}
    set local application_name = 'phase730d-cross-demote-a-holder';
    select private.serialize_admin_ai_scope_v1(
      'admin-ledger-environment', ${literal(id.environment)}::uuid
    );
    do $$ begin raise notice 'PHASE730D_DEMOTE_READY'; end; $$;
    do $$
    declare wait_started_at timestamptz := clock_timestamp();
    begin
      loop
        perform pg_catalog.pg_stat_clear_snapshot();
        exit when exists (
          select 1 from pg_catalog.pg_stat_activity
          where application_name = 'phase730d-cross-demote-b-waiter'
            and wait_event_type = 'Lock'
        );
        if clock_timestamp() > wait_started_at + interval '10 seconds' then
          raise exception 'cross-demote waiter did not reach the environment mutex';
        end if;
        perform pg_catalog.pg_sleep(0.01);
      end loop;
    end;
    $$;
    with changed as (
      update private.admin_environment_memberships
      set role = 'instructor', expires_at = null
      where id = ${literal(id.membershipB)}::uuid
      returning id
    )
    insert into public.phase7_30d_concurrency_results
      (scenario, sqlstate, outcome)
    select 'cross-demote-a', '00000', jsonb_build_object('changed', count(*))
    from changed;
    commit;
  `,
  'PHASE730D_DEMOTE_READY',
)
await demoteWinner.ready
const demoteLoser = runSql(`
  begin;
  ${transactionSettings}
  set local application_name = 'phase730d-cross-demote-b-waiter';
  do $$
  declare state text := '00000'; message text := null; changed integer := 0;
  begin
    begin
      perform private.serialize_admin_ai_scope_v1(
        'admin-ledger-environment', ${literal(id.environment)}::uuid
      );
      update private.admin_environment_memberships
      set role = 'instructor', expires_at = null
      where id = ${literal(id.membershipA)}::uuid;
      get diagnostics changed = row_count;
    exception when others then
      get stacked diagnostics state = returned_sqlstate, message = message_text;
    end;
    insert into public.phase7_30d_concurrency_results
      (scenario, sqlstate, outcome)
    values ('cross-demote-b', state,
      jsonb_build_object('changed', changed, 'message', message));
  end;
  $$;
  commit;
`)
await Promise.all([demoteWinner.done, demoteLoser])

const admissionWinner = startSqlUntilReady(
  `
    begin;
    ${transactionSettings}
    set local application_name = 'phase730d-invitation-accept-holder';
    select private.serialize_admin_ai_scope_v1(
      'admin-ledger-environment', ${literal(id.environment)}::uuid
    );
    do $$ begin raise notice 'PHASE730D_ACCEPT_READY'; end; $$;
    do $$
    declare wait_started_at timestamptz := clock_timestamp();
    begin
      loop
        perform pg_catalog.pg_stat_clear_snapshot();
        exit when exists (
          select 1 from pg_catalog.pg_stat_activity
          where application_name = 'phase730d-invitation-revoke-waiter'
            and wait_event_type = 'Lock'
        );
        if clock_timestamp() > wait_started_at + interval '10 seconds' then
          raise exception 'invitation revoke did not reach the environment mutex';
        end if;
        perform pg_catalog.pg_sleep(0.01);
      end loop;
    end;
    $$;
    set local role service_role;
    with admitted as (
      select public.consume_admin_identity_admission_v1(
        ${literal(id.environment)}::uuid, ${literal(id.authUserC)}::uuid,
        'https://accounts.google.com', ${literal(subjectC)}, 1,
        'phase730d-invitee@example.test', ${literal(emailHmacC)}, 'Invitee C',
        ${literal(id.admissionRequest)}::uuid, ${literal(invitationTokenHash)}
      ) as value
    )
    insert into public.phase7_30d_concurrency_results
      (scenario, sqlstate, outcome)
    select 'invitation-accept', '00000', value from admitted;
    commit;
  `,
  'PHASE730D_ACCEPT_READY',
)
await admissionWinner.ready
const revokeLoser = runSql(
  asServiceRole(`
    set local application_name = 'phase730d-invitation-revoke-waiter';
    do $$
    declare state text := '00000'; message text := null; result jsonb := null;
    begin
      begin
        result := public.manage_google_admin_ledger_v1(
          ${literal(tokenA)}, ${literal(id.authUserA)}::uuid,
          ${literal(id.authSessionA)}::uuid, 'https://accounts.google.com',
          ${literal(subjectA)}, 1, true, 'revokeInvitation',
          ${literal(id.invitationRevokeRequest)}::uuid,
          (select outcome from public.phase7_30d_concurrency_results
           where scenario = 'invitation-revoke-payload'),
          (select outcome ->> 'intentDigest'
           from public.phase7_30d_concurrency_results
           where scenario = 'invitation-revoke-intent')
        );
      exception when others then
        get stacked diagnostics state = returned_sqlstate, message = message_text;
      end;
      insert into public.phase7_30d_concurrency_results
        (scenario, sqlstate, outcome)
      values ('invitation-revoke', state,
        coalesce(result, jsonb_build_object('message', message)));
    end;
    $$;
  `),
)
await Promise.all([admissionWinner.done, revokeLoser])

await runSql(
  asServiceRole(`
    with replay as (
      select public.consume_admin_identity_admission_v1(
        ${literal(id.environment)}::uuid, ${literal(id.authUserC)}::uuid,
        'https://accounts.google.com', ${literal(subjectC)}, 1,
        'phase730d-invitee@example.test', ${literal(emailHmacC)}, 'Invitee C',
        ${literal(id.admissionRequest)}::uuid, ${literal(invitationTokenHash)}
      ) as value
    )
    insert into public.phase7_30d_concurrency_results
      (scenario, sqlstate, outcome)
    select 'admission-replay', '00000', value from replay;

    do $$
    declare state text := '00000'; message text := null;
    begin
      begin
        perform public.consume_admin_identity_admission_v1(
          ${literal(id.environment)}::uuid, ${literal(id.authUserC)}::uuid,
          'https://accounts.google.com', ${literal(subjectC)}, 1,
          'phase730d-invitee@example.test', ${literal(emailHmacC)},
          'Changed Invitee', ${literal(id.admissionRequest)}::uuid,
          ${literal(invitationTokenHash)}
        );
      exception when others then
        get stacked diagnostics state = returned_sqlstate, message = message_text;
      end;
      insert into public.phase7_30d_concurrency_results
        (scenario, sqlstate, outcome)
      values ('admission-changed-binding', state,
        jsonb_build_object('message', message));
    end;
    $$;
  `),
)

await runSql(`
  do $$
  declare
    cross_a text;
    cross_b text;
    accept_state text;
    revoke_state text;
    changed_state text;
  begin
    select sqlstate into strict cross_a from public.phase7_30d_concurrency_results
    where scenario = 'cross-demote-a';
    select sqlstate into strict cross_b from public.phase7_30d_concurrency_results
    where scenario = 'cross-demote-b';
    select sqlstate into strict accept_state from public.phase7_30d_concurrency_results
    where scenario = 'invitation-accept';
    select sqlstate into strict revoke_state from public.phase7_30d_concurrency_results
    where scenario = 'invitation-revoke';
    select sqlstate into strict changed_state from public.phase7_30d_concurrency_results
    where scenario = 'admission-changed-binding';

    if cross_a <> '00000' or cross_b <> 'P7310' then
      raise exception 'cross-demote did not converge: %, %', cross_a, cross_b;
    end if;
    if (select role <> 'owner' from private.admin_environment_memberships
        where id = ${literal(id.membershipA)}::uuid)
       or (select role <> 'instructor' from private.admin_environment_memberships
        where id = ${literal(id.membershipB)}::uuid)
       or (select count(*) <> 1 from private.admin_environment_memberships
        where environment_id = ${literal(id.environment)}::uuid
          and role = 'owner' and status = 'active') then
      raise exception 'cross-demote violated the last-owner invariant';
    end if;
    if exists (
      select 1 from public.phase7_30d_concurrency_results
      where sqlstate in ('40P01', '55P03', '57014')
    ) then
      raise exception 'D concurrency hit a deadlock or timeout';
    end if;
    if accept_state <> '00000' or revoke_state <> 'P7335' then
      raise exception 'invitation race did not converge: %, %',
        accept_state, revoke_state;
    end if;
    if not (
      select outcome @> '{"eligible":true,"idempotent_replay":false}'::jsonb
      from public.phase7_30d_concurrency_results
      where scenario = 'invitation-accept'
    ) or not (
      select outcome @> '{"eligible":true,"idempotent_replay":true}'::jsonb
      from public.phase7_30d_concurrency_results
      where scenario = 'admission-replay'
    ) or changed_state <> 'P7335' then
      raise exception 'admission replay binding is not exact';
    end if;
    if (select status <> 'accepted' from private.admin_invitations
        where id = ${literal(id.invitation)}::uuid)
       or (select count(*) <> 1 from private.admin_invitation_redemption_receipts
        where admission_request_id = ${literal(id.admissionRequest)}::uuid)
       or (select count(*) <> 1 from private.admin_environment_memberships
        where id = ${literal(id.membershipC)}::uuid
           or (environment_id = ${literal(id.environment)}::uuid
             and principal_id = ${literal(id.principalC)}::uuid))
       or exists (select 1 from private.admin_google_operation_receipts
        where request_id = ${literal(id.invitationRevokeRequest)}::uuid)
       or not exists (select 1 from private.admin_control_step_up_grants
        where mutation_request_id = ${literal(id.invitationRevokeRequest)}::uuid
          and consumed_at is null) then
      raise exception 'invitation race left inconsistent evidence';
    end if;
  end;
  $$;
  drop table public.phase7_30d_concurrency_results;
`)

console.log(
  'Phase 7.30D owner invariant and invitation terminal-state concurrency passed.',
)
