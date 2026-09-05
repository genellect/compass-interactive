import {
  assertCleanSql, assertState, fixtureSql, heartbeatSql, manualSql,
  pageSql, runSql, runSupabase, staleSql,
} from './lib/presenter-authority-test.mjs'

let failure
let fixtureStarted = false
try {
  await runSql(assertCleanSql)
  fixtureStarted = true
  runSupabase(['db', 'reset', '--local', '--no-seed', '--version', '20260826085622'])
  await runSql(fixtureSql)
  await runSql(`${staleSql};
    create table public.presenter_authority_upgrade_probe as
    select to_jsonb(connection) as connection_json,
      (select to_jsonb(live) from public.lecture_live_state as live
        where live.lecture_session_id = connection.lecture_session_id) as live_json,
      (select count(*) from public.presenter_connection_events) as event_count
    from public.presenter_connections as connection
    where id = '00000000-0000-4000-8000-00000000e513'::uuid;
  `)
  runSupabase(['migration', 'up', '--local'])
  await runSql(`do $$ begin
    if not exists (
      select 1 from public.presenter_authority_upgrade_probe as before
      join public.presenter_connections as connection
        on connection.id = '00000000-0000-4000-8000-00000000e513'::uuid
      join public.lecture_live_state as live
        on live.lecture_session_id = connection.lecture_session_id
      where to_jsonb(connection) = before.connection_json
        and to_jsonb(live) = before.live_json
        and (select count(*) from public.presenter_connection_events) = before.event_count
    ) or not (select enabled from private.presenter_runtime_gate where singleton)
    then raise exception 'Authority upgrade unexpectedly mutated an existing lecture, capability or runtime gate';
    end if;
  end; $$;
  ${manualSql}; ${pageSql}; ${heartbeatSql}; ${assertState(3, 'disconnected')}
  `)
} catch (error) {
  failure = error
} finally {
  if (fixtureStarted) {
    try { runSupabase(['db', 'reset', '--local', '--no-seed']) }
    catch (error) { failure ??= error }
  }
}
if (failure) throw failure
console.log('Populated current-main Google Presenter upgraded without data or gate changes; stale manual recovery remained terminal.')
