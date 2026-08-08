import { spawnSync } from 'node:child_process'

const npmCli = process.env.npm_execpath
if (!npmCli) {
  throw new Error('Run this upgrade check through npm.')
}

const container =
  process.env.SUPABASE_DB_CONTAINER ?? 'supabase_db_compass-interactive'

function runSupabase(args) {
  const result = spawnSync(
    process.execPath,
    [npmCli, 'exec', '--', 'supabase', ...args],
    { cwd: process.cwd(), env: process.env, stdio: 'inherit' },
  )
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(`supabase ${args.join(' ')} exited with ${result.status}`)
  }
}

function runSql(sql) {
  const result = spawnSync(
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
    { cwd: process.cwd(), env: process.env, encoding: 'utf8' },
  )
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || `psql exited with ${result.status}`)
  }
}

let failure
try {
  // Restore a populated Phase 7.28 database, then fingerprint the contracts
  // which Phase 7.29 is not allowed to rewrite.
  runSupabase([
    'db',
    'reset',
    '--local',
    '--version',
    '20260731110753',
    '--sql-paths',
    '../scripts/fixtures/phase7-28-upgrade-probe.sql',
  ])
  runSql(`
    drop table if exists public.phase729_upgrade_contract_probe;
    create table public.phase729_upgrade_contract_probe (
      contract_name text primary key,
      contract_fingerprint text not null
    );
    insert into public.phase729_upgrade_contract_probe values
      (
        'display-claim-rpc',
        md5(pg_get_functiondef(
          'public.claim_display_realtime_session_v1(text,uuid,uuid)'::regprocedure
        ))
      ),
      (
        'ai-master-rpc',
        md5(pg_get_functiondef(
          'public.admin_authorize_ai_master(uuid,uuid,text,text,boolean)'::regprocedure
        ))
      ),
      (
        'display-broadcast-policy',
        md5((
          select jsonb_build_object(
            'cmd', policy.cmd,
            'permissive', policy.permissive,
            'qual', policy.qual,
            'roles', policy.roles,
            'with_check', policy.with_check
          )::text
          from pg_policies as policy
          where policy.schemaname = 'realtime'
            and policy.tablename = 'messages'
            and policy.policyname =
              'phase728 display can receive private broadcast'
        ))
      );
  `)

  runSupabase(['migration', 'up', '--local'])
  runSupabase([
    'test',
    'db',
    'scripts/fixtures/phase7-28-upgrade-probe-test.sql',
    '--local',
  ])

  runSql(`
    do $$
    declare
      expected text;
      actual text;
    begin
      select contract_fingerprint into expected
      from public.phase729_upgrade_contract_probe
      where contract_name = 'display-claim-rpc';
      actual := md5(pg_get_functiondef(
        'public.claim_display_realtime_session_v1(text,uuid,uuid)'::regprocedure
      ));
      if actual is distinct from expected then
        raise exception 'Phase 7.29 rewrote the Display claim RPC';
      end if;

      select contract_fingerprint into expected
      from public.phase729_upgrade_contract_probe
      where contract_name = 'ai-master-rpc';
      actual := md5(pg_get_functiondef(
        'public.admin_authorize_ai_master(uuid,uuid,text,text,boolean)'::regprocedure
      ));
      if actual is distinct from expected then
        raise exception 'Phase 7.29 rewrote the AI master RPC';
      end if;

      select contract_fingerprint into expected
      from public.phase729_upgrade_contract_probe
      where contract_name = 'display-broadcast-policy';
      select md5(jsonb_build_object(
        'cmd', policy.cmd,
        'permissive', policy.permissive,
        'qual', policy.qual,
        'roles', policy.roles,
        'with_check', policy.with_check
      )::text)
      into actual
      from pg_policies as policy
      where policy.schemaname = 'realtime'
        and policy.tablename = 'messages'
        and policy.policyname =
          'phase728 display can receive private broadcast';
      if actual is distinct from expected then
        raise exception 'Phase 7.29 rewrote the Display Broadcast policy';
      end if;

      if (select count(*) from public.presenter_connections) <> 0
         or (select count(*) from public.presenter_connection_events) <> 0 then
        raise exception 'upgrade created Presenter runtime rows';
      end if;
      if coalesce((
        select enabled
        from private.presenter_runtime_gate
        where singleton
      ), true) then
        raise exception 'upgrade did not leave the Presenter gate OFF';
      end if;
      if exists (
        select 1
        from pg_publication_tables
        where pubname = 'supabase_realtime'
          and schemaname = 'public'
          and tablename in (
            'presenter_connections',
            'presenter_connection_events'
          )
      ) then
        raise exception 'upgrade added Presenter metadata to Realtime';
      end if;
      if to_regprocedure(
        'public.admin_create_phase727_journal_club_run_v1(text,text,text,uuid,uuid,uuid)'
      ) is null then
        raise exception 'Phase 7.27 recovery RPC disappeared';
      end if;
    end;
    $$;
  `)
} catch (error) {
  failure = error
} finally {
  try {
    runSupabase(['db', 'reset', '--local', '--no-seed'])
  } catch (resetError) {
    failure ??= resetError
  }
}

if (failure) throw failure
console.log(
  'Populated Phase 7.28 data, RPCs and Broadcast policy upgraded through Phase 7.29 unchanged; Presenter rows=0 and gate=OFF.',
)
