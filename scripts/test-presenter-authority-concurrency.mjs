import {
  assertCleanSql, assertState, fixtureSql, heartbeatSql, manualSql,
  pageSql, runSql, runSupabase, staleSql,
} from './lib/presenter-authority-test.mjs'

// Coordinate actual lock waits, never timing guesses. The holder commits only
// after the second PostgreSQL connection has reached a conflicting lock.
async function race(holderSql, waiterSql, label) {
  const applicationName = `presenter-authority-${label}`
  const marker = `PRESENTER_READY_${label}`
  const first = runSql(`
    begin;
    set local lock_timeout = '5s';
    set local statement_timeout = '15s';
    ${holderSql};
    do $$ declare started timestamptz := clock_timestamp(); begin
      raise notice '${marker}';
      loop
        perform pg_catalog.pg_stat_clear_snapshot();
        exit when exists (select 1 from pg_stat_activity
          where application_name = '${applicationName}'
            and wait_event_type = 'Lock');
        if clock_timestamp() > started + interval '10 seconds' then
          raise exception 'Presenter concurrency waiter missed its lock barrier';
        end if;
        perform pg_sleep(0.01);
      end loop;
    end; $$;
    commit;
  `, marker)
  await first.ready
  const second = runSql(`
    begin;
    set local application_name = '${applicationName}';
    set local lock_timeout = '5s';
    set local statement_timeout = '15s';
    ${waiterSql};
    commit;
  `)
  await Promise.all([first.done, second])
}

let failure
let fixtureStarted = false
try {
  await runSql(assertCleanSql)
  fixtureStarted = true
  await runSql(fixtureSql)
  await runSql(staleSql)
  await race(manualSql, pageSql, 'manual_first')
  await runSql(`${heartbeatSql}; ${assertState(3, 'disconnected')}`)

  runSupabase(['db', 'reset', '--local', '--no-seed'])
  await runSql(fixtureSql)
  await runSql(staleSql)
  await race(heartbeatSql, manualSql, 'heartbeat_first')
  await runSql(`${pageSql}; ${assertState(3, 'disconnected')}`)

  runSupabase(['db', 'reset', '--local', '--no-seed'])
  await runSql(fixtureSql)
  await race(pageSql,
    "delete from auth.sessions where id = '00000000-0000-4000-8000-00000000e503'::uuid",
    'page_before_auth_revoke')
  await runSql(`${heartbeatSql}; ${assertState(2, 'admin_revoked')}`)

  runSupabase(['db', 'reset', '--local', '--no-seed'])
  await runSql(fixtureSql)
  await race(
    "delete from auth.sessions where id = '00000000-0000-4000-8000-00000000e503'::uuid",
    pageSql, 'auth_revoke_before_page')
  await runSql(`${heartbeatSql}; ${assertState(1, 'admin_revoked')}`)
  // Restoring the external authority cannot resurrect an already revoked lease.
  await runSql(`
    insert into auth.sessions(id,user_id,created_at,updated_at) values (
      '00000000-0000-4000-8000-00000000e503'::uuid,
      '00000000-0000-4000-8000-00000000e502'::uuid,
      statement_timestamp(),statement_timestamp());
    ${pageSql}; ${heartbeatSql}; ${assertState(1, 'admin_revoked')}
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
console.log('Presenter stale/manual and Auth-session races converged in both lock orders; authority restoration did not revive the lease.')
