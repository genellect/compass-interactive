import { randomBytes, randomInt, randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'

const container =
  process.env.SUPABASE_DB_CONTAINER ?? 'supabase_db_compass-interactive'
const sessionId = randomUUID()
const actorId = `admin-session:${sessionId}`
const consumeFirstCode = String(randomInt(100000, 1000000))
const revokeFirstCode = String(randomInt(100000, 1000000))
const consumeFirstNonce = randomBytes(32).toString('hex')
const revokeFirstNonce = randomBytes(32).toString('hex')

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
      else reject(new Error(stderr.trim() || `psql exited with code ${code}`))
    })
  })
}

await runSql(`
  drop table if exists public.phase728c_race_fixture;
  create table public.phase728c_race_fixture (
    consume_first_lecture_id uuid,
    consume_first_grant_id uuid,
    revoke_first_lecture_id uuid,
    revoke_first_grant_id uuid
  );
  insert into public.phase728c_race_fixture (
    consume_first_lecture_id,
    revoke_first_lecture_id
  ) values (
    public.admin_create_lecture(
      'P728C consume-first race',
      ${sqlLiteral(randomBytes(32).toString('hex'))},
      ${sqlLiteral(consumeFirstCode)}, null, null
    ),
    public.admin_create_lecture(
      'P728C revoke-first race',
      ${sqlLiteral(randomBytes(32).toString('hex'))},
      ${sqlLiteral(revokeFirstCode)}, null, null
    )
  );
  insert into public.admin_sessions (
    id, token_hash, auth_user_id, pin_version_hash,
    issued_at, last_seen_at, idle_expires_at, expires_at
  ) values (
    ${sqlLiteral(sessionId)}::uuid,
    ${sqlLiteral(randomBytes(32).toString('hex'))},
    ${sqlLiteral(randomUUID())}::uuid,
    ${sqlLiteral(randomBytes(32).toString('hex'))},
    statement_timestamp() - interval '1 minute',
    statement_timestamp(),
    statement_timestamp() + interval '2 hours',
    statement_timestamp() + interval '3 hours'
  );
  select public.admin_set_lecture_status(lecture_id, 'start', null)
  from (
    select consume_first_lecture_id as lecture_id
    from public.phase728c_race_fixture
    union all
    select revoke_first_lecture_id from public.phase728c_race_fixture
  ) as lectures;
  select public.admin_configure_lecture_ai_control(
    lecture_id,
    jsonb_build_object(
      'summaries_enabled', false,
      'summary_call_limit', 18,
      'budget_limit_microusd', 2500000,
      'input_token_limit', 720000,
      'output_token_limit', 21600,
      'max_concurrent_operations', 2
    ),
    ${sqlLiteral(actorId)}
  )
  from (
    select consume_first_lecture_id as lecture_id
    from public.phase728c_race_fixture
    union all
    select revoke_first_lecture_id from public.phase728c_race_fixture
  ) as lectures;
  update public.phase728c_race_fixture
  set revoke_first_grant_id = (
    public.admin_issue_ai_billing_grant(
      revoke_first_lecture_id,
      array['summaries'],
      ${sqlLiteral(revokeFirstNonce)},
      true,
      ${sqlLiteral(actorId)}
    ) ->> 'grant_id'
  )::uuid;
  select public.admin_authorize_ai_master(
    lecture_id,
    ${sqlLiteral(sessionId)}::uuid,
    ${sqlLiteral(actorId)},
    'all_except_captions',
    true
  )
  from (
    select consume_first_lecture_id as lecture_id
    from public.phase728c_race_fixture
    union all
    select revoke_first_lecture_id from public.phase728c_race_fixture
  ) as lectures;
  update public.phase728c_race_fixture
  set consume_first_grant_id = (
        public.admin_issue_ai_billing_grant_from_master(
          consume_first_lecture_id,
          ${sqlLiteral(sessionId)}::uuid,
          array['summaries'],
          ${sqlLiteral(consumeFirstNonce)},
          ${sqlLiteral(actorId)}
        ) ->> 'grant_id'
      )::uuid;
`)

const transactionSettings = `
  set local lock_timeout = '5s';
  set local statement_timeout = '15s';
`

await Promise.all([
  runSql(`
    begin;
    ${transactionSettings}
    select public.admin_start_lecture_summary_run_v2(
      consume_first_grant_id,
      ${sqlLiteral(consumeFirstNonce)},
      consume_first_lecture_id,
      ${sqlLiteral(randomBytes(32).toString('hex'))},
      ${sqlLiteral(actorId)}, false, 'auto'
    ) from public.phase728c_race_fixture;
    select pg_sleep(0.5);
    commit;
  `),
  runSql(`
    begin;
    ${transactionSettings}
    select pg_sleep(0.1);
    select public.admin_revoke_ai_master_authorization(
      consume_first_lecture_id,
      ${sqlLiteral(sessionId)}::uuid,
      ${sqlLiteral(actorId)},
      'consume_first_race'
    ) from public.phase728c_race_fixture;
    commit;
  `),
])

const revokeFirst = await Promise.allSettled([
  runSql(`
    begin;
    ${transactionSettings}
    select 1
    from public.lecture_sessions
    where id = (
      select revoke_first_lecture_id from public.phase728c_race_fixture
    )
    for update;
    select pg_sleep(0.5);
    select public.admin_revoke_ai_master_authorization(
      revoke_first_lecture_id,
      ${sqlLiteral(sessionId)}::uuid,
      ${sqlLiteral(actorId)},
      'revoke_first_race'
    ) from public.phase728c_race_fixture;
    commit;
  `),
  runSql(`
    begin;
    ${transactionSettings}
    select pg_sleep(0.1);
    select public.admin_start_lecture_summary_run_v2(
      revoke_first_grant_id,
      ${sqlLiteral(revokeFirstNonce)},
      revoke_first_lecture_id,
      ${sqlLiteral(randomBytes(32).toString('hex'))},
      ${sqlLiteral(actorId)}, false, 'auto'
    ) from public.phase728c_race_fixture;
    commit;
  `),
])
if (revokeFirst.filter((result) => result.status === 'rejected').length !== 1) {
  throw new Error('revoke-first race must reject exactly the losing consume')
}

const fencedRetry = await Promise.allSettled([
  runSql(`
    begin;
    ${transactionSettings}
    select public.admin_start_lecture_summary_run_v2(
      revoke_first_grant_id,
      ${sqlLiteral(revokeFirstNonce)},
      revoke_first_lecture_id,
      ${sqlLiteral(randomBytes(32).toString('hex'))},
      ${sqlLiteral(actorId)}, false, 'auto'
    ) from public.phase728c_race_fixture;
    commit;
  `),
])
if (fencedRetry[0]?.status !== 'rejected') {
  throw new Error('terminal master fence allowed a locked direct grant retry')
}

await runSql(`
  do $$
  declare
    fixture public.phase728c_race_fixture%rowtype;
  begin
    select * into fixture from public.phase728c_race_fixture;
    if exists (
      select 1
      from public.lecture_ai_master_authorizations as master_auth
      where master_auth.lecture_session_id in (
        fixture.consume_first_lecture_id,
        fixture.revoke_first_lecture_id
      ) and master_auth.status = 'active'
    ) then
      raise exception 'master authorization remained active after race';
    end if;
    if exists (
      select 1
      from public.lecture_summary_runs as summary_run
      where summary_run.lecture_session_id in (
        fixture.consume_first_lecture_id,
        fixture.revoke_first_lecture_id
      ) and summary_run.status = 'running'
    ) then
      raise exception 'summary work remained running after race';
    end if;
    if exists (
      select 1
      from public.ai_usage_ledger as usage
      where usage.lecture_session_id in (
        fixture.consume_first_lecture_id,
        fixture.revoke_first_lecture_id
      ) and usage.status = 'running'
    ) then
      raise exception 'paid work remained running after race';
    end if;
    if not exists (
      select 1
      from public.ai_billing_grants as billing_grant
      where billing_grant.id = fixture.revoke_first_grant_id
        and billing_grant.status in ('issued', 'revoked')
        and exists (
          select 1
          from public.lecture_ai_master_authorizations as master_auth
          where master_auth.lecture_session_id = billing_grant.lecture_session_id
            and master_auth.status = 'revoked'
            and master_auth.revoked_at >= billing_grant.issued_at
        )
    ) then
      raise exception 'revoke-first direct grant was not terminally fenced';
    end if;
  end;
  $$;
  drop table public.phase728c_race_fixture;
`)

console.log(
  'Phase 7.28C consume-first and revoke-first child-grant races converged without deadlock or residual work.',
)
