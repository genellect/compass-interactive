import { randomBytes } from 'node:crypto'
import { spawn } from 'node:child_process'

const container =
  process.env.SUPABASE_DB_CONTAINER ?? 'supabase_db_compass-interactive'
const suffix = randomBytes(5).toString('hex').toUpperCase()

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

const code = (name) => sqlLiteral(`P41-${name}-${suffix}`)
const digest = (name) =>
  `encode(extensions.digest(convert_to(${code(name)}, 'UTF8'), 'sha256'), 'hex')`

await runSql(`
  drop table if exists public.phase41_race_fixture;
  create table public.phase41_race_fixture (
    stop_lecture_id uuid,
    stop_caption_id uuid,
    stop_batch_id uuid,
    close_lecture_id uuid,
    close_caption_id uuid,
    close_batch_id uuid,
    batch_race_lecture_id uuid,
    cross_lane_lecture_id uuid
  );

  insert into public.phase41_race_fixture (
    stop_lecture_id,
    close_lecture_id,
    batch_race_lecture_id,
    cross_lane_lecture_id
  ) values (
    public.admin_create_lecture('P41 stop race', ${digest('STOP')}, ${code('STOP')}, null, null),
    public.admin_create_lecture('P41 close race', ${digest('CLOSE')}, ${code('CLOSE')}, null, null),
    public.admin_create_lecture('P41 batch race', ${digest('BATCH')}, ${code('BATCH')}, null, null),
    public.admin_create_lecture('P41 cross lane race', ${digest('CROSS')}, ${code('CROSS')}, null, null)
  );

  select public.admin_set_lecture_status(stop_lecture_id, 'start', null)
  from public.phase41_race_fixture;
  select public.admin_set_lecture_status(close_lecture_id, 'start', null)
  from public.phase41_race_fixture;
  select public.admin_set_lecture_status(batch_race_lecture_id, 'start', null)
  from public.phase41_race_fixture;
  select public.admin_set_lecture_status(cross_lane_lecture_id, 'start', null)
  from public.phase41_race_fixture;

  select public.admin_configure_lecture_ai_control(
    lecture_id,
    jsonb_build_object(
      'captions_enabled', true,
      'summaries_enabled', true,
      'material_analysis_enabled', true,
      'academic_answers_enabled', true,
      'material_analysis_call_limit', 5,
      'academic_answer_limit', 10,
      'max_concurrent_operations', 2
    ),
    actor_id
  )
  from (
    select stop_lecture_id as lecture_id, 'race-stop' as actor_id from public.phase41_race_fixture
    union all
    select close_lecture_id, 'race-close' from public.phase41_race_fixture
    union all
    select batch_race_lecture_id, 'race-batch' from public.phase41_race_fixture
    union all
    select cross_lane_lecture_id, 'race-cross' from public.phase41_race_fixture
  ) as lectures;

  update public.phase41_race_fixture
  set
    stop_caption_id = (
      public.admin_start_lecture_ai_operation(
        stop_lecture_id, 'captions', 'p41-race-stop-caption',
        1, 1, 0, 0, 'race-stop'
      ) #>> '{operation,id}'
    )::uuid,
    stop_batch_id = (
      public.admin_start_lecture_ai_operation(
        stop_lecture_id, 'summaries', 'p41-race-stop-summary',
        1, 0, 1, 1, 'race-stop'
      ) #>> '{operation,id}'
    )::uuid,
    close_caption_id = (
      public.admin_start_lecture_ai_operation(
        close_lecture_id, 'captions', 'p41-race-close-caption',
        1, 1, 0, 0, 'race-close'
      ) #>> '{operation,id}'
    )::uuid,
    close_batch_id = (
      public.admin_start_lecture_ai_operation(
        close_lecture_id, 'material_analysis', 'p41-race-close-material',
        1, 0, 1, 1, 'race-close'
      ) #>> '{operation,id}'
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
    select 1
    from public.lecture_sessions
    where id = (select stop_lecture_id from public.phase41_race_fixture)
    for update;
    select pg_sleep(0.5);
    select public.admin_finish_realtime_caption_operation(
      (select stop_caption_id from public.phase41_race_fixture),
      'race-stop', 'race_finish', false, true
    );
    commit;
  `),
  runSql(`
    begin;
    ${transactionSettings}
    select pg_sleep(0.1);
    select public.admin_stop_lecture_ai_control(
      (select stop_lecture_id from public.phase41_race_fixture),
      'parallel_stop', 'race-stop'
    );
    commit;
  `),
])

await Promise.all([
  runSql(`
    begin;
    ${transactionSettings}
    select 1
    from public.lecture_sessions
    where id = (select close_lecture_id from public.phase41_race_fixture)
    for update;
    select pg_sleep(0.5);
    select public.admin_finish_lecture_ai_operation(
      (select close_batch_id from public.phase41_race_fixture),
      'succeeded', 1, 0, 1, 1, 'race-provider', null
    );
    commit;
  `),
  runSql(`
    begin;
    ${transactionSettings}
    select pg_sleep(0.1);
    select public.admin_set_lecture_status(
      (select close_lecture_id from public.phase41_race_fixture),
      'close', null
    );
    commit;
  `),
])

await Promise.all([
  runSql(`
    begin;
    ${transactionSettings}
    select public.admin_start_lecture_ai_operation(
      (select batch_race_lecture_id from public.phase41_race_fixture),
      'summaries', 'p41-race-batch-summary',
      1, 0, 1, 1, 'race-batch'
    );
    commit;
  `),
  runSql(`
    begin;
    ${transactionSettings}
    select public.admin_start_lecture_ai_operation(
      (select batch_race_lecture_id from public.phase41_race_fixture),
      'academic_answers', 'p41-race-batch-academic',
      1, 0, 1, 1, 'race-batch'
    );
    commit;
  `),
])

await Promise.all([
  runSql(`
    begin;
    ${transactionSettings}
    select public.admin_start_lecture_ai_operation(
      (select cross_lane_lecture_id from public.phase41_race_fixture),
      'captions', 'p41-race-cross-caption',
      1, 1, 0, 0, 'race-cross'
    );
    commit;
  `),
  runSql(`
    begin;
    ${transactionSettings}
    select public.admin_start_lecture_ai_operation(
      (select cross_lane_lecture_id from public.phase41_race_fixture),
      'summaries', 'p41-race-cross-summary',
      1, 0, 1, 1, 'race-cross'
    );
    commit;
  `),
])

await runSql(`
  do $$
  declare
    fixture public.phase41_race_fixture%rowtype;
  begin
    select * into fixture from public.phase41_race_fixture;

    if exists (
      select 1
      from public.lecture_ai_control as control
      where control.lecture_session_id in (
        fixture.stop_lecture_id,
        fixture.close_lecture_id,
        fixture.batch_race_lecture_id,
        fixture.cross_lane_lecture_id
      )
        and control.active_operation_count <> (
          select count(*)
          from public.ai_usage_ledger as usage
          where usage.lecture_session_id = control.lecture_session_id
            and usage.status = 'running'
        )
    ) then
      raise exception 'active-operation cache drifted during concurrency test';
    end if;

    if (
      select count(*)
      from public.ai_usage_ledger as usage
      where usage.lecture_session_id = fixture.batch_race_lecture_id
        and usage.status = 'running'
    ) <> 1 then
      raise exception 'same-lane race did not admit exactly one Batch operation';
    end if;

    if (
      select count(*)
      from public.ai_usage_ledger as usage
      where usage.lecture_session_id = fixture.cross_lane_lecture_id
        and usage.status = 'running'
    ) <> 2 then
      raise exception 'cross-lane race did not admit Realtime plus Batch';
    end if;

    if exists (
      select 1
      from public.ai_usage_ledger as usage
      where usage.lecture_session_id in (
        fixture.stop_lecture_id,
        fixture.close_lecture_id
      )
        and usage.status = 'running'
    ) then
      raise exception 'stop/close race left a running operation';
    end if;
  end;
  $$;

  select public.admin_stop_lecture_ai_control(
    batch_race_lecture_id, 'race_cleanup', 'race-batch'
  ) from public.phase41_race_fixture;
  select public.admin_stop_lecture_ai_control(
    cross_lane_lecture_id, 'race_cleanup', 'race-cross'
  ) from public.phase41_race_fixture;
  drop table public.phase41_race_fixture;
`)

console.log(
  'Phase 4.1 concurrent start/finish/stop/close checks passed without deadlock.',
)
