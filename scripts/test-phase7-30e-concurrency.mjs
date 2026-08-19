import { randomBytes, randomUUID } from 'node:crypto'
import { spawn, spawnSync } from 'node:child_process'

const container =
  process.env.SUPABASE_DB_CONTAINER ?? 'supabase_db_compass-interactive'
const npmCli = process.env.npm_execpath
if (!npmCli) throw new Error('Run this concurrency check through npm.')

const id = Object.fromEntries(
  [
    'environment',
    'authUserA',
    'authUserB',
    'authSessionA',
    'mfaFactorA',
    'principalA',
    'principalB',
    'membershipA',
    'membershipB',
    'factorAnchorA',
    'loginNonceA',
    'loginRequestA',
    'adminSessionA',
    'legacyVerifySession',
    'legacyInsertSession',
    'legacyPostCutoverSession',
    'lecture',
    'approval',
    'approvalRequest',
    'lateApproval',
    'lateApprovalRequest',
    'claimRequest',
    'postCutoverClaimRequest',
    'approvalCutoverRequest',
    'insertCutoverRequest',
    'verifyCutoverRequest',
    'claimCutoverRequest',
    'finalCutoverRequest',
  ].map((name) => [name, randomUUID()]),
)

const hex = () => randomBytes(32).toString('hex')
const token = {
  google: hex(),
  legacyVerify: hex(),
  legacyInsert: hex(),
  legacyPostCutover: hex(),
}
const pin = {
  legacyVerify: hex(),
  legacyInsert: hex(),
  legacyPostCutover: hex(),
}
const subjectA = hex()
const subjectB = hex()
const mappingDigest = hex()
const deploymentDigest = hex()
const cutoverActor = 'operator:phase730e-concurrency'
const cutoverReason = 'verified Google-only concurrency deployment'

function literal(value) {
  return `'${String(value).replaceAll("'", "''")}'`
}

function spawnPsql(sql, readyMarker) {
  let resolveReady
  let rejectReady
  let readySettled = readyMarker === undefined
  const ready = new Promise((resolve, reject) => {
    resolveReady = resolve
    rejectReady = reject
    if (readySettled) resolve()
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
        resolve(stdout)
        return
      }
      const error = new Error(
        stderr.trim() ||
          stdout.trim() ||
          `psql exited before readiness marker ${readyMarker ?? '<none>'}`,
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

function runSql(sql) {
  return spawnPsql(sql).done
}

async function runPair(holder, contender) {
  try {
    await holder.ready
  } catch (error) {
    await holder.done.catch(() => {})
    throw error
  }
  const settled = await Promise.allSettled([holder.done, contender()])
  const rejected = settled.find((entry) => entry.status === 'rejected')
  if (rejected) throw rejected.reason
}

function resetLocalDatabase() {
  const result = spawnSync(
    process.execPath,
    [npmCli, 'exec', '--', 'supabase', 'db', 'reset', '--local', '--no-seed'],
    { cwd: process.cwd(), env: process.env, stdio: 'inherit' },
  )
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(`supabase db reset exited with ${result.status}`)
  }
}

const transactionSettings = `
  set local lock_timeout = '5s';
  set local statement_timeout = '20s';
`

function capturedCutoverSql({ applicationName, requestId, scenario }) {
  return `
    begin transaction isolation level serializable;
    ${transactionSettings}
    set local application_name = ${literal(applicationName)};
    do $phase730e$
    declare
      state text := '00000';
      message text := null;
      result jsonb := null;
    begin
      begin
        result := private.commit_google_only_admin_cutover_v1(
          ${literal(id.environment)}::uuid,
          ${literal(requestId)}::uuid,
          ${literal(cutoverActor)},
          ${literal(cutoverReason)},
          ${literal(deploymentDigest)}
        );
      exception when others then
        get stacked diagnostics state = returned_sqlstate, message = message_text;
      end;
      insert into public.phase7_30e_concurrency_results
        (scenario, sqlstate, outcome)
      values (
        ${literal(scenario)}, state,
        coalesce(result, jsonb_build_object('message', message))
      );
    end;
    $phase730e$;
    commit;
  `
}

const waitForScenario = (scenario, failureMessage) => `
  do $phase730e_wait$
  declare wait_started_at timestamptz := clock_timestamp();
  begin
    loop
      exit when exists (
        select 1 from public.phase7_30e_concurrency_results
        where scenario = ${literal(scenario)}
      );
      if clock_timestamp() > wait_started_at + interval '10 seconds' then
        raise exception ${literal(failureMessage)};
      end if;
      perform pg_catalog.pg_sleep(0.01);
    end loop;
  end;
  $phase730e_wait$;
`

const waitForApplicationLock = (applicationName, failureMessage) => `
  do $phase730e_wait$
  declare wait_started_at timestamptz := clock_timestamp();
  begin
    loop
      perform pg_catalog.pg_stat_clear_snapshot();
      exit when exists (
        select 1
        from pg_catalog.pg_stat_activity
        where application_name = ${literal(applicationName)}
          and wait_event_type = 'Lock'
          and pid <> pg_catalog.pg_backend_pid()
      );
      if clock_timestamp() > wait_started_at + interval '10 seconds' then
        raise exception ${literal(failureMessage)};
      end if;
      perform pg_catalog.pg_sleep(0.005);
    end loop;
  end;
  $phase730e_wait$;
`

let fixtureMutationStarted = false
let failure

try {
  await runSql(`
    do $phase730e$
    begin
      if to_regclass('public.phase7_30e_concurrency_results') is not null
         or exists (
           select 1 from private.admin_environments where current_deployment
         )
         or exists (select 1 from private.admin_identity_cutover_receipts) then
        raise exception 'Phase 7.30E concurrency requires a reset local database';
      end if;
    end;
    $phase730e$;
  `)

  fixtureMutationStarted = true
  await runSql(`
    begin;

    create table public.phase7_30e_concurrency_results (
      scenario text primary key,
      sqlstate text not null check (pg_catalog.char_length(sqlstate) = 5),
      outcome jsonb not null
    );
    revoke all on public.phase7_30e_concurrency_results
      from public, anon, authenticated, service_role;
    grant select, insert on public.phase7_30e_concurrency_results
      to service_role;

    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password,
      email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
      created_at, updated_at
    ) values
      (
        '00000000-0000-0000-0000-000000000000'::uuid,
        ${literal(id.authUserA)}::uuid, 'authenticated', 'authenticated',
        ${literal(`phase730e-a-${id.authUserA}@example.test`)}, '',
        statement_timestamp() - interval '1 hour',
        '{"provider":"google","providers":["google"]}'::jsonb,
        '{}'::jsonb, statement_timestamp() - interval '1 hour',
        statement_timestamp() - interval '1 hour'
      ),
      (
        '00000000-0000-0000-0000-000000000000'::uuid,
        ${literal(id.authUserB)}::uuid, 'authenticated', 'authenticated',
        ${literal(`phase730e-b-${id.authUserB}@example.test`)}, '',
        statement_timestamp() - interval '1 hour',
        '{"provider":"google","providers":["google"]}'::jsonb,
        '{}'::jsonb, statement_timestamp() - interval '1 hour',
        statement_timestamp() - interval '1 hour'
      );

    insert into auth.sessions (id, user_id, created_at, updated_at) values (
      ${literal(id.authSessionA)}::uuid, ${literal(id.authUserA)}::uuid,
      statement_timestamp() - interval '1 hour',
      statement_timestamp() - interval '1 hour'
    );
    insert into auth.mfa_factors (
      id, user_id, friendly_name, factor_type, status, created_at, updated_at
    ) values (
      ${literal(id.mfaFactorA)}::uuid, ${literal(id.authUserA)}::uuid,
      'phase730e-concurrency-owner-a', 'totp', 'verified',
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
      (
        ${literal(id.principalA)}::uuid, ${literal(id.authUserA)}::uuid,
        'https://accounts.google.com', ${literal(subjectA)}, 1,
        ${literal(`phase730e-a-${id.authUserA}@example.test`)},
        statement_timestamp() - interval '1 hour', 'Owner A'
      ),
      (
        ${literal(id.principalB)}::uuid, ${literal(id.authUserB)}::uuid,
        'https://accounts.google.com', ${literal(subjectB)}, 1,
        ${literal(`phase730e-b-${id.authUserB}@example.test`)},
        statement_timestamp() - interval '1 hour', 'Owner B'
      );
    insert into private.admin_environment_memberships (
      id, environment_id, principal_id, role, status, can_use_ai, activated_at
    ) values
      (
        ${literal(id.membershipA)}::uuid, ${literal(id.environment)}::uuid,
        ${literal(id.principalA)}::uuid, 'owner', 'active', true,
        statement_timestamp() - interval '1 hour'
      ),
      (
        ${literal(id.membershipB)}::uuid, ${literal(id.environment)}::uuid,
        ${literal(id.principalB)}::uuid, 'owner', 'active', true,
        statement_timestamp() - interval '1 hour'
      );
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
        approved_totp_factor_set_actor = 'fixture:phase730e-concurrency',
        approved_totp_factor_set_reason = 'E concurrency fixture'
    from private.current_verified_totp_factor_set_snapshot_v1(
      ${literal(id.authUserA)}::uuid
    ) as snapshot
    where id = ${literal(id.principalA)}::uuid;

    update private.admin_identity_runtime_gate
    set google_session_issue_enabled = true,
        google_operational_authorization_enabled = true,
        google_admin_ledger_enabled = true,
        updated_at = statement_timestamp()
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
      ${literal(id.loginNonceA)}::uuid, ${literal(hex())},
      ${literal(id.adminSessionA)}::uuid, ${literal(id.environment)}::uuid,
      ${literal(id.principalA)}::uuid, ${literal(id.membershipA)}::uuid,
      ${literal(id.authSessionA)}::uuid, 'admin_login',
      ${literal(id.loginRequestA)}::uuid, ${literal(hex())},
      statement_timestamp() - interval '1 minute',
      ${literal(id.mfaFactorA)}::uuid,
      private.current_verified_totp_factor_set_hash_v1(
        ${literal(id.authUserA)}::uuid
      ),
      private.current_verified_totp_factor_set_hash_v1(
        ${literal(id.authUserA)}::uuid
      ),
      false, 1, ${literal(hex())}, statement_timestamp(),
      statement_timestamp() - interval '1 minute',
      statement_timestamp() + interval '4 minutes'
    );
    insert into public.admin_sessions (
      id, token_hash, auth_user_id, pin_version_hash, authentication_method, aal,
      principal_id, membership_id, environment_id, supabase_auth_session_id,
      step_up_verified_at, step_up_nonce_id, verified_totp_factor_set_hash,
      issued_at, last_seen_at, idle_expires_at, expires_at
    ) values (
      ${literal(id.adminSessionA)}::uuid, ${literal(token.google)},
      ${literal(id.authUserA)}::uuid, null, 'google_totp', 2,
      ${literal(id.principalA)}::uuid, ${literal(id.membershipA)}::uuid,
      ${literal(id.environment)}::uuid, ${literal(id.authSessionA)}::uuid,
      statement_timestamp(), ${literal(id.loginNonceA)}::uuid,
      private.current_verified_totp_factor_set_hash_v1(
        ${literal(id.authUserA)}::uuid
      ),
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

    insert into public.admin_sessions (
      id, token_hash, auth_user_id, pin_version_hash,
      issued_at, last_seen_at, idle_expires_at, expires_at
    ) values (
      ${literal(id.legacyVerifySession)}::uuid,
      ${literal(token.legacyVerify)}, ${literal(id.authUserA)}::uuid,
      ${literal(pin.legacyVerify)}, statement_timestamp() - interval '1 hour',
      statement_timestamp() - interval '1 hour',
      statement_timestamp() + interval '30 minutes',
      statement_timestamp() + interval '2 hours'
    );

    insert into public.lecture_sessions (id, title, code_hash, status) values (
      ${literal(id.lecture)}::uuid,
      'Phase 7.30E concurrency ownership claim', ${literal(hex())}, 'draft'
    );

    commit;
  `)

  const approvalHolder = spawnPsql(
    `
      begin;
      set local lock_timeout = '15s';
      set local statement_timeout = '20s';
      set local application_name = 'phase730e-approval-holder';
      select private.serialize_admin_ai_scope_v1(
        'admin-ledger-environment', ${literal(id.environment)}::uuid
      );
      with approved as (
        select private.approve_google_admin_lecture_ownership_claim_v1(
          ${literal(id.approval)}::uuid,
          ${literal(id.approvalRequest)}::uuid,
          ${literal(id.environment)}::uuid,
          ${literal(id.lecture)}::uuid,
          ${literal(id.principalB)}::uuid,
          ${literal(id.membershipB)}::uuid,
          ${literal(id.adminSessionA)}::uuid,
          'operator:phase730e-concurrency',
          'reviewed concurrency ownership mapping',
          ${literal(mappingDigest)},
          statement_timestamp() + interval '1 day'
        ) as value
      )
      insert into public.phase7_30e_concurrency_results
        (scenario, sqlstate, outcome)
      select 'approval-holder', '00000', value from approved;
      do $phase730e$ begin
        raise notice 'PHASE730E_APPROVAL_HOLDER_READY';
      end; $phase730e$;
      ${waitForApplicationLock(
        'phase730e-approval-cutover-waiter',
        'approval/cutover waiter did not reach the environment mutex',
      )}
      commit;
    `,
    'PHASE730E_APPROVAL_HOLDER_READY',
  )
  await runPair(approvalHolder, () =>
    runSql(
      capturedCutoverSql({
        applicationName: 'phase730e-approval-cutover-waiter',
        requestId: id.approvalCutoverRequest,
        scenario: 'approval-cutover-waiter',
      }),
    ),
  )

  await runSql(`
    do $phase730e$
    begin
      -- The SERIALIZABLE contender starts before the holder commits. Both a
      -- policy rejection after lock acquisition and the bounded transient
      -- serialization/lock outcomes are fail-closed; no receipt may survive.
      if (select sqlstate from public.phase7_30e_concurrency_results
          where scenario = 'approval-holder') <> '00000'
         or (select outcome ->> 'replayed'
             from public.phase7_30e_concurrency_results
             where scenario = 'approval-holder') <> 'false'
         or coalesce((
              select sqlstate from public.phase7_30e_concurrency_results
              where scenario = 'approval-cutover-waiter'
            ), '') not in ('P7335', '40001', '55P03')
         or (
           (select sqlstate from public.phase7_30e_concurrency_results
            where scenario = 'approval-cutover-waiter') = 'P7335'
           and coalesce((
             select outcome ->> 'message'
             from public.phase7_30e_concurrency_results
             where scenario = 'approval-cutover-waiter'
           ), '') <> 'Active lectures require valid Google ownership evidence'
         )
         or (select count(*) from private.admin_lecture_ownership_claim_approvals
             where id = ${literal(id.approval)}::uuid) <> 1
         or exists (select 1 from private.admin_identity_cutover_receipts) then
        raise exception 'approval/cutover environment serialization diverged';
      end if;
    end;
    $phase730e$;
  `)

  const legacyInsertHolder = spawnPsql(
    `
      begin;
      ${transactionSettings}
      set local application_name = 'phase730e-legacy-insert-holder';
      insert into public.admin_sessions (
        id, token_hash, auth_user_id, pin_version_hash,
        issued_at, last_seen_at, idle_expires_at, expires_at
      ) values (
        ${literal(id.legacyInsertSession)}::uuid,
        ${literal(token.legacyInsert)}, ${literal(id.authUserA)}::uuid,
        ${literal(pin.legacyInsert)}, statement_timestamp(),
        statement_timestamp(), statement_timestamp() + interval '30 minutes',
        statement_timestamp() + interval '2 hours'
      );
      do $phase730e$ begin
        raise notice 'PHASE730E_LEGACY_INSERT_READY';
      end; $phase730e$;
      ${waitForScenario(
        'legacy-insert-cutover',
        'legacy INSERT did not observe the cutover NOWAIT result',
      )}
      commit;
    `,
    'PHASE730E_LEGACY_INSERT_READY',
  )
  await runPair(legacyInsertHolder, () =>
    runSql(
      capturedCutoverSql({
        applicationName: 'phase730e-legacy-insert-cutover',
        requestId: id.insertCutoverRequest,
        scenario: 'legacy-insert-cutover',
      }),
    ),
  )

  await runSql(`
    do $phase730e$
    begin
      if (select sqlstate from public.phase7_30e_concurrency_results
          where scenario = 'legacy-insert-cutover') <> '55P03'
         or not exists (
           select 1 from public.admin_sessions
           where id = ${literal(id.legacyInsertSession)}::uuid
             and authentication_method = 'legacy_pin'
             and revoked_at is null
         )
         or exists (select 1 from private.admin_identity_cutover_receipts)
         or not (select legacy_pin_login_enabled
                 from private.admin_identity_runtime_gate where singleton) then
        raise exception 'legacy INSERT/cutover writer fence diverged';
      end if;
    end;
    $phase730e$;
  `)

  const legacyVerifyHolder = spawnPsql(
    `
      begin;
      ${transactionSettings}
      set local application_name = 'phase730e-legacy-verify-holder';
      set local role service_role;
      with verified as (
        select public.verify_and_touch_admin_session(
          ${literal(id.legacyVerifySession)}::uuid,
          ${literal(token.legacyVerify)}, ${literal(pin.legacyVerify)}
        ) as value
      )
      insert into public.phase7_30e_concurrency_results
        (scenario, sqlstate, outcome)
      select 'legacy-verify-holder', '00000', to_jsonb(value)
      from verified;
      reset role;
      do $phase730e$ begin
        raise notice 'PHASE730E_LEGACY_VERIFY_READY';
      end; $phase730e$;
      ${waitForScenario(
        'legacy-verify-cutover',
        'legacy verifier did not observe the cutover NOWAIT result',
      )}
      commit;
    `,
    'PHASE730E_LEGACY_VERIFY_READY',
  )
  await runPair(legacyVerifyHolder, () =>
    runSql(
      capturedCutoverSql({
        applicationName: 'phase730e-legacy-verify-cutover',
        requestId: id.verifyCutoverRequest,
        scenario: 'legacy-verify-cutover',
      }),
    ),
  )

  await runSql(`
    do $phase730e$
    begin
      if (select sqlstate from public.phase7_30e_concurrency_results
          where scenario = 'legacy-verify-cutover') <> '55P03'
         or (select outcome ->> 'id'
             from public.phase7_30e_concurrency_results
             where scenario = 'legacy-verify-holder') <>
              ${literal(id.legacyVerifySession)}
         or exists (select 1 from private.admin_identity_cutover_receipts)
         or not (select legacy_pin_login_enabled
                 from private.admin_identity_runtime_gate where singleton) then
        raise exception 'legacy verify/cutover gate hold diverged';
      end if;
    end;
    $phase730e$;
  `)

  const claimHolder = spawnPsql(
    `
      begin;
      set local lock_timeout = '15s';
      set local statement_timeout = '20s';
      set local application_name = 'phase730e-claim-holder';
      select private.serialize_admin_ai_scope_v1(
        'admin-ledger-environment', ${literal(id.environment)}::uuid
      );
      with claimed as (
        select private.claim_approved_google_admin_lecture_ownership_v1(
          ${literal(id.approval)}::uuid, ${literal(id.claimRequest)}::uuid
        ) as value
      )
      insert into public.phase7_30e_concurrency_results
        (scenario, sqlstate, outcome)
      select 'claim-holder', '00000', value from claimed;
      do $phase730e$ begin
        raise notice 'PHASE730E_CLAIM_HOLDER_READY';
      end; $phase730e$;
      ${waitForApplicationLock(
        'phase730e-claim-cutover-waiter',
        'claim/cutover waiter did not reach the environment mutex',
      )}
      commit;
    `,
    'PHASE730E_CLAIM_HOLDER_READY',
  )
  await runPair(claimHolder, () =>
    runSql(
      capturedCutoverSql({
        applicationName: 'phase730e-claim-cutover-waiter',
        requestId: id.claimCutoverRequest,
        scenario: 'claim-cutover-waiter',
      }),
    ),
  )

  await runSql(`
    do $phase730e$
    begin
      -- The same bounded transient outcomes are valid while ownership claim
      -- commit releases the shared environment mutex. Every path stays
      -- fail-closed and the later exact cutover/replay scenario proves retry.
      if (select sqlstate from public.phase7_30e_concurrency_results
          where scenario = 'claim-holder') <> '00000'
         or (select outcome ->> 'replayed'
             from public.phase7_30e_concurrency_results
             where scenario = 'claim-holder') <> 'false'
         or coalesce((
              select sqlstate from public.phase7_30e_concurrency_results
              where scenario = 'claim-cutover-waiter'
            ), '') not in ('P7335', '40001', '55P03')
         or (
           (select sqlstate from public.phase7_30e_concurrency_results
            where scenario = 'claim-cutover-waiter') = 'P7335'
           and coalesce((
             select outcome ->> 'message'
             from public.phase7_30e_concurrency_results
             where scenario = 'claim-cutover-waiter'
           ), '') <> 'Active lectures require valid Google ownership evidence'
         )
         or not exists (
           select 1 from private.admin_lecture_ownerships
           where lecture_session_id = ${literal(id.lecture)}::uuid
             and ownership_source = 'operator_claim'
             and ownership_approval_id = ${literal(id.approval)}::uuid
         )
         or exists (select 1 from private.admin_identity_cutover_receipts) then
        raise exception 'claim/cutover environment serialization diverged';
      end if;
    end;
    $phase730e$;
  `)

  const nowaitBlocker = spawnPsql(
    `
      begin;
      ${transactionSettings}
      set local application_name = 'phase730e-cutover-nowait-blocker';
      lock table public.lecture_pdf_publications in access share mode;
      do $phase730e$ begin
        raise notice 'PHASE730E_CUTOVER_NOWAIT_BLOCKER_READY';
      end; $phase730e$;
      ${waitForScenario(
        'cutover-nowait',
        'cutover did not fail while the descendant table was busy',
      )}
      commit;
    `,
    'PHASE730E_CUTOVER_NOWAIT_BLOCKER_READY',
  )
  await runPair(nowaitBlocker, () =>
    runSql(
      capturedCutoverSql({
        applicationName: 'phase730e-cutover-nowait',
        requestId: id.finalCutoverRequest,
        scenario: 'cutover-nowait',
      }),
    ),
  )

  await runSql(`
    do $phase730e$
    begin
      if (select sqlstate from public.phase7_30e_concurrency_results
          where scenario = 'cutover-nowait') <> '55P03'
         or exists (select 1 from private.admin_identity_cutover_receipts)
         or not (select legacy_pin_login_enabled
                 from private.admin_identity_runtime_gate where singleton)
         or exists (
           select 1 from public.admin_sessions
           where id in (
             ${literal(id.legacyVerifySession)}::uuid,
             ${literal(id.legacyInsertSession)}::uuid
           ) and revoked_at is not null
         )
         or not has_function_privilege(
           'service_role',
           'public.verify_and_touch_admin_session(uuid,text,text)',
           'EXECUTE'
         ) then
        raise exception 'cutover NOWAIT failure was not a full rollback';
      end if;
    end;
    $phase730e$;
  `)

  await runSql(
    capturedCutoverSql({
      applicationName: 'phase730e-cutover-winner',
      requestId: id.finalCutoverRequest,
      scenario: 'cutover-winner',
    }),
  )
  await runSql(
    capturedCutoverSql({
      applicationName: 'phase730e-cutover-exact-replay',
      requestId: id.finalCutoverRequest,
      scenario: 'cutover-exact-replay',
    }),
  )

  await runSql(`
    do $phase730e$
    declare
      winner_replayed text;
      replay_replayed text;
      post_fence_state text := '00000';
    begin
      select outcome ->> 'replayed'
      into winner_replayed
      from public.phase7_30e_concurrency_results
      where scenario = 'cutover-winner';
      select outcome ->> 'replayed'
      into replay_replayed
      from public.phase7_30e_concurrency_results
      where scenario = 'cutover-exact-replay';

      begin
        insert into public.admin_sessions (
          id, token_hash, auth_user_id, pin_version_hash,
          issued_at, last_seen_at, idle_expires_at, expires_at
        ) values (
          ${literal(id.legacyPostCutoverSession)}::uuid,
          ${literal(token.legacyPostCutover)}, ${literal(id.authUserA)}::uuid,
          ${literal(pin.legacyPostCutover)}, statement_timestamp(),
          statement_timestamp(), statement_timestamp() + interval '30 minutes',
          statement_timestamp() + interval '2 hours'
        );
      exception when others then
        get stacked diagnostics post_fence_state = returned_sqlstate;
      end;

      if winner_replayed <> 'false'
         or replay_replayed <> 'true'
         or (select sqlstate from public.phase7_30e_concurrency_results
             where scenario = 'cutover-winner') <> '00000'
         or (select sqlstate from public.phase7_30e_concurrency_results
             where scenario = 'cutover-exact-replay') <> '00000'
         or (select count(*) from private.admin_identity_cutover_receipts
             where request_id = ${literal(id.finalCutoverRequest)}::uuid) <> 1
         or (select revoked_legacy_session_count
             from private.admin_identity_cutover_receipts
             where request_id = ${literal(id.finalCutoverRequest)}::uuid) <> 2
         or (select legacy_pin_login_enabled
             from private.admin_identity_runtime_gate where singleton)
         or (select count(*) from public.admin_sessions
             where id in (
               ${literal(id.legacyVerifySession)}::uuid,
               ${literal(id.legacyInsertSession)}::uuid
             )
               and revoked_at is not null
               and revoke_reason = 'google_only_cutover') <> 2
         or public.verify_and_touch_admin_session(
              ${literal(id.legacyVerifySession)}::uuid,
              ${literal(token.legacyVerify)}, ${literal(pin.legacyVerify)}
            ) is not null
         or post_fence_state <> 'P7335'
         or has_function_privilege(
           'service_role',
           'public.verify_and_touch_admin_session(uuid,text,text)',
           'EXECUTE'
         )
         or exists (
           select 1 from public.phase7_30e_concurrency_results
           where sqlstate in ('40P01', '57014')
         ) then
        raise exception 'concurrent cutover replay or permanent writer fence diverged';
      end if;

      begin
        perform private.claim_approved_google_admin_lecture_ownership_v1(
          ${literal(id.approval)}::uuid,
          ${literal(id.postCutoverClaimRequest)}::uuid
        );
        raise exception 'post-cutover claim unexpectedly succeeded';
      exception
        when sqlstate 'P7335' then null;
      end;

      begin
        perform private.approve_google_admin_lecture_ownership_claim_v1(
          ${literal(id.lateApproval)}::uuid,
          ${literal(id.lateApprovalRequest)}::uuid,
          ${literal(id.environment)}::uuid,
          ${literal(id.lecture)}::uuid,
          ${literal(id.principalB)}::uuid,
          ${literal(id.membershipB)}::uuid,
          ${literal(id.adminSessionA)}::uuid,
          'operator:phase730e-concurrency',
          'late approval must remain tombstoned',
          ${literal(mappingDigest)},
          statement_timestamp() + interval '1 day'
        );
        raise exception 'post-cutover approval unexpectedly succeeded';
      exception
        when sqlstate 'P7335' then null;
      end;
    end;
    $phase730e$;
  `)
} catch (error) {
  failure = error
} finally {
  if (fixtureMutationStarted) {
    try {
      resetLocalDatabase()
      await runSql(`
        do $phase730e$
        begin
          if to_regclass('public.phase7_30e_concurrency_results') is not null
             or exists (select 1 from private.admin_identity_cutover_receipts)
             or exists (
               select 1 from private.admin_environments where current_deployment
             )
             or not (select legacy_pin_login_enabled
                     from private.admin_identity_runtime_gate where singleton)
             or not has_function_privilege(
               'service_role',
               'public.verify_and_touch_admin_session(uuid,text,text)',
               'EXECUTE'
             ) then
            raise exception 'Phase 7.30E full reset did not restore baseline';
          end if;
        end;
        $phase730e$;
      `)
    } catch (resetError) {
      failure ??= resetError
    }
  }
}

if (failure) throw failure
console.log(
  'Phase 7.30E approval/claim, legacy-session fence, cutover NOWAIT and exact-replay races passed; the local database was fully reset.',
)
