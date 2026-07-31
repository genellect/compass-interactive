import { randomBytes, randomInt, randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'

const container =
  process.env.SUPABASE_DB_CONTAINER ?? 'supabase_db_compass-interactive'

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

const issueFirstSessionId = randomUUID()
const revokeFirstSessionId = randomUUID()
const issueFirstAuthUserId = randomUUID()
const revokeFirstAuthUserId = randomUUID()
const issueFirstDisplayId = randomUUID()
const revokeFirstDisplayId = randomUUID()

await runSql(`
  drop table if exists public.phase728b_lock_fixture;
  create table public.phase728b_lock_fixture (
    issue_first_lecture_id uuid not null,
    issue_first_admin_session_id uuid not null,
    revoke_first_lecture_id uuid not null,
    revoke_first_admin_session_id uuid not null
  );
  insert into public.phase728b_lock_fixture values (
    public.admin_create_lecture(
      'P728B issue-first lock race',
      ${sqlLiteral(randomBytes(32).toString('hex'))},
      ${sqlLiteral(String(randomInt(100000, 1000000)))},
      null, null
    ),
    ${sqlLiteral(issueFirstSessionId)}::uuid,
    public.admin_create_lecture(
      'P728B revoke-first lock race',
      ${sqlLiteral(randomBytes(32).toString('hex'))},
      ${sqlLiteral(String(randomInt(100000, 1000000)))},
      null, null
    ),
    ${sqlLiteral(revokeFirstSessionId)}::uuid
  );
  select public.admin_set_lecture_status(lecture_id, 'start', null)
  from (
    select issue_first_lecture_id as lecture_id
    from public.phase728b_lock_fixture
    union all
    select revoke_first_lecture_id
    from public.phase728b_lock_fixture
  ) as fixture;
  insert into public.admin_sessions (
    id, token_hash, auth_user_id, pin_version_hash,
    issued_at, last_seen_at, idle_expires_at, expires_at
  ) values
    (
      ${sqlLiteral(issueFirstSessionId)}::uuid,
      ${sqlLiteral(randomBytes(32).toString('hex'))},
      ${sqlLiteral(issueFirstAuthUserId)}::uuid,
      ${sqlLiteral(randomBytes(32).toString('hex'))},
      statement_timestamp(), statement_timestamp(),
      statement_timestamp() + interval '2 hours',
      statement_timestamp() + interval '3 hours'
    ),
    (
      ${sqlLiteral(revokeFirstSessionId)}::uuid,
      ${sqlLiteral(randomBytes(32).toString('hex'))},
      ${sqlLiteral(revokeFirstAuthUserId)}::uuid,
      ${sqlLiteral(randomBytes(32).toString('hex'))},
      statement_timestamp(), statement_timestamp(),
      statement_timestamp() + interval '2 hours',
      statement_timestamp() + interval '3 hours'
    );
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
    'admin-session:' || admin_session_id::text
  )
  from (
    select issue_first_lecture_id as lecture_id,
           issue_first_admin_session_id as admin_session_id
    from public.phase728b_lock_fixture
    union all
    select revoke_first_lecture_id, revoke_first_admin_session_id
    from public.phase728b_lock_fixture
  ) as fixture;
  select public.admin_authorize_ai_master(
    lecture_id,
    admin_session_id,
    'admin-session:' || admin_session_id::text,
    'all_except_captions',
    true
  )
  from (
    select issue_first_lecture_id as lecture_id,
           issue_first_admin_session_id as admin_session_id
    from public.phase728b_lock_fixture
    union all
    select revoke_first_lecture_id, revoke_first_admin_session_id
    from public.phase728b_lock_fixture
  ) as fixture;
`)

const transactionSettings = `
  set local lock_timeout = '5s';
  set local statement_timeout = '15s';
`

// Issue owns the Admin SHARE lock first. Revoke must then converge after the
// newly issued binding commits, and both B/C revoke triggers drain it.
await Promise.all([
  runSql(`
    begin;
    ${transactionSettings}
    select 1 from public.admin_sessions
    where id = ${sqlLiteral(issueFirstSessionId)}::uuid
    for share;
    select pg_sleep(0.5);
    select public.register_display_realtime_session_v1(
      ${sqlLiteral(issueFirstDisplayId)}::uuid,
      (select issue_first_lecture_id from public.phase728b_lock_fixture),
      ${sqlLiteral(randomBytes(32).toString('hex'))},
      statement_timestamp() + interval '1 hour',
      ${sqlLiteral(issueFirstSessionId)}::uuid,
      ${sqlLiteral(issueFirstAuthUserId)}::uuid
    );
    commit;
  `),
  runSql(`
    begin;
    ${transactionSettings}
    select pg_sleep(0.1);
    update public.admin_sessions
    set revoked_at = statement_timestamp(), revoke_reason = 'p728b_issue_first'
    where id = ${sqlLiteral(issueFirstSessionId)}::uuid;
    commit;
  `),
])

// Revoke owns the Admin row first. Registration must wait, observe terminal
// Admin state, and fail cleanly rather than taking lecture->Admin locks.
const revokeFirst = await Promise.allSettled([
  runSql(`
    begin;
    ${transactionSettings}
    select 1 from public.admin_sessions
    where id = ${sqlLiteral(revokeFirstSessionId)}::uuid
    for update;
    select pg_sleep(0.5);
    update public.admin_sessions
    set revoked_at = statement_timestamp(), revoke_reason = 'p728b_revoke_first'
    where id = ${sqlLiteral(revokeFirstSessionId)}::uuid;
    commit;
  `),
  runSql(`
    begin;
    ${transactionSettings}
    select pg_sleep(0.1);
    select public.register_display_realtime_session_v1(
      ${sqlLiteral(revokeFirstDisplayId)}::uuid,
      (select revoke_first_lecture_id from public.phase728b_lock_fixture),
      ${sqlLiteral(randomBytes(32).toString('hex'))},
      statement_timestamp() + interval '1 hour',
      ${sqlLiteral(revokeFirstSessionId)}::uuid,
      ${sqlLiteral(revokeFirstAuthUserId)}::uuid
    );
    commit;
  `),
])
if (revokeFirst.filter((result) => result.status === 'rejected').length !== 1) {
  throw new Error('revoke-first race must reject only the losing Display issue')
}

await runSql(`
  do $$
  begin
    if exists (
      select 1 from public.display_realtime_sessions
      where lecture_session_id in (
        (select issue_first_lecture_id from public.phase728b_lock_fixture),
        (select revoke_first_lecture_id from public.phase728b_lock_fixture)
      ) and revoked_at is null
    ) then
      raise exception 'Display/Admin revoke race left an active binding';
    end if;
    if not exists (
      select 1 from public.display_realtime_sessions
      where id = ${sqlLiteral(issueFirstDisplayId)}::uuid
        and revoke_reason = 'admin_session_revoked'
    ) then
      raise exception 'issue-first binding did not converge to Admin revoke';
    end if;
    if exists (
      select 1 from public.display_realtime_sessions
      where id = ${sqlLiteral(revokeFirstDisplayId)}::uuid
    ) then
      raise exception 'revoke-first race persisted a Display binding';
    end if;
  end;
  $$;
  drop table public.phase728b_lock_fixture;
`)

console.log(
  'Phase 7.28B Display issue/Admin revoke races converged without deadlock.',
)
