import { randomBytes, randomInt, randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'

const container =
  process.env.SUPABASE_DB_CONTAINER ?? 'supabase_db_compass-interactive'
const adminSessionId = randomUUID()
const adminAuthUserId = randomUUID()
const lectureCode = String(randomInt(100000, 1000000))
const lectureKeyHash = randomBytes(32).toString('hex')
const pdfHash = randomBytes(32).toString('hex')
const textHash = randomBytes(32).toString('hex')
const installationHash = randomBytes(32).toString('hex')
const pptxHash = randomBytes(32).toString('hex')
const slideOrderHash = randomBytes(32).toString('hex')
const issueFirstTicket = randomBytes(32).toString('hex')
const issueFirstManual = randomBytes(32).toString('hex')
const killFirstTicket = randomBytes(32).toString('hex')
const killFirstManual = randomBytes(32).toString('hex')
const claimTicket = randomBytes(32).toString('hex')
const claimManual = randomBytes(32).toString('hex')
const capabilityA = randomBytes(32).toString('hex')
const capabilityB = randomBytes(32).toString('hex')
const pageEvent1 = randomUUID()
const pageEvent2 = randomUUID()
const pageEvent3 = randomUUID()

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
    child.on('exit', (exitCode) => {
      if (exitCode === 0) resolve(stdout)
      else reject(new Error(stderr.trim() || `psql exited with ${exitCode}`))
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
    child.on('exit', (exitCode) => {
      if (exitCode === 0) {
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
          `psql exited with ${exitCode} before ${readyMarker}`,
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
  set local statement_timeout = '15s';
`

async function cleanup() {
  await runSql(`
    select public.set_presenter_runtime_v1(false)
    where to_regprocedure(
      'public.set_presenter_runtime_v1(boolean)'
    ) is not null;
    delete from public.presenter_connection_events
    where lecture_session_id = (
      select lecture_id from public.phase729_race_fixture limit 1
    );
    delete from public.presenter_connections
    where lecture_session_id = (
      select lecture_id from public.phase729_race_fixture limit 1
    );
    delete from public.lecture_pdf_documents
    where lecture_session_id = (
      select lecture_id from public.phase729_race_fixture limit 1
    );
    delete from public.lecture_lifecycle_events
    where lecture_session_id = (
      select lecture_id from public.phase729_race_fixture limit 1
    );
    delete from public.lecture_ai_control
    where lecture_session_id = (
      select lecture_id from public.phase729_race_fixture limit 1
    );
    delete from public.lecture_sessions
    where id = (
      select lecture_id from public.phase729_race_fixture limit 1
    );
    delete from public.admin_sessions
    where id = ${sqlLiteral(adminSessionId)}::uuid;
    drop table if exists public.phase729_race_results;
    drop table if exists public.phase729_race_fixture;
  `)
}

let failure
try {
  await runSql(`
    do $$
    begin
      if not exists (
        select 1
        from private.presenter_runtime_gate
        where singleton and not enabled
      ) or exists (
        select 1 from public.presenter_connections where revoked_at is null
      ) then
        raise exception 'Phase 7.29 concurrency test requires a clean reset database with the Presenter gate OFF';
      end if;
    end;
    $$;
    drop table if exists public.phase729_race_results;
    drop table if exists public.phase729_race_fixture;
    create table public.phase729_race_fixture (
      lecture_id uuid,
      issue_first_connection_id uuid,
      claim_connection_id uuid
    );
    create table public.phase729_race_results (
      label text primary key,
      payload jsonb
    );
    insert into public.phase729_race_fixture (
      lecture_id
    ) values (
      public.admin_create_lecture(
        'Phase 7.29 concurrency',
        ${sqlLiteral(lectureKeyHash)},
        ${sqlLiteral(lectureCode)},
        null,
        null
      )
    );
    insert into public.admin_sessions (
      id, token_hash, auth_user_id, pin_version_hash,
      issued_at, last_seen_at, idle_expires_at, expires_at
    ) values (
      ${sqlLiteral(adminSessionId)}::uuid,
      ${sqlLiteral(randomBytes(32).toString('hex'))},
      ${sqlLiteral(adminAuthUserId)}::uuid,
      ${sqlLiteral(randomBytes(32).toString('hex'))},
      statement_timestamp() - interval '1 minute',
      statement_timestamp(),
      statement_timestamp() + interval '1 hour',
      statement_timestamp() + interval '2 hours'
    );
    select public.admin_set_lecture_status(lecture_id, 'start', null)
    from public.phase729_race_fixture;
    select public.admin_register_pdf_document(
      lecture_id,
      'phase729-concurrency-doc',
      ${sqlLiteral(pdfHash)},
      1,
      'Phase 7.29 concurrency material',
      3,
      3000,
      300,
      ${sqlLiteral(pdfHash)},
      ${sqlLiteral(textHash)},
      true
    )
    from public.phase729_race_fixture;
    select public.admin_update_pdf_display_v3(
      lecture_id,
      'phase729-concurrency-doc',
      ${sqlLiteral(pdfHash)},
      1,
      3,
      true,
      1,
      'normal'
    )
    from public.phase729_race_fixture;
    select public.set_presenter_runtime_v1(true);
  `)

  // Issue owns the singleton gate first. The kill switch waits, then drains
  // the just-issued connection. Both calls must complete without deadlock.
  const issueFirst = startSqlUntilReady(
    `
      begin;
      ${transactionSettings}
      select 1 from private.presenter_runtime_gate where singleton for update;
      do $$
      declare
        wait_started_at timestamptz := clock_timestamp();
      begin
        raise notice 'PHASE729_ISSUE_FIRST_GATE_READY';
        while not exists (
          select 1 from pg_stat_activity
          where application_name = 'phase729-issue-first-kill-waiter'
            and wait_event_type = 'Lock'
        ) loop
          if clock_timestamp() > wait_started_at + interval '10 seconds' then
            raise exception 'issue-first kill did not reach the gate lock barrier';
          end if;
          perform pg_sleep(0.01);
        end loop;
      end;
      $$;
      update public.phase729_race_fixture
      set issue_first_connection_id = (
        public.issue_presenter_connection_v1(
          lecture_id,
          ${sqlLiteral(adminSessionId)}::uuid,
          ${sqlLiteral(adminAuthUserId)}::uuid,
          ${sqlLiteral(issueFirstTicket)},
          ${sqlLiteral(issueFirstManual)},
          statement_timestamp() + interval '45 seconds'
        ) ->> 'connection_id'
      )::uuid;
      commit;
    `,
    'PHASE729_ISSUE_FIRST_GATE_READY',
  )
  await issueFirst.ready
  const issueFirstKill = runSql(`
    begin;
    ${transactionSettings}
    set local application_name = 'phase729-issue-first-kill-waiter';
    select public.set_presenter_runtime_v1(false);
    commit;
  `)
  await Promise.all([issueFirst.done, issueFirstKill])
  await runSql(`
    do $$
    begin
      if not exists (
        select 1
        from public.presenter_connections as connection
        join public.phase729_race_fixture as fixture
          on fixture.issue_first_connection_id = connection.id
        where connection.state = 'revoked'
          and connection.revoke_reason = 'feature_disabled'
      ) or exists (
        select 1 from public.presenter_connections where revoked_at is null
      ) then
        raise exception 'issue-first/kill-switch race did not converge';
      end if;
    end;
    $$;
    select public.set_presenter_runtime_v1(true);
  `)

  // Kill-switch owns the gate first. The later issue must observe OFF and be
  // the sole rejected contender rather than persisting a connection.
  const killFirst = startSqlUntilReady(
    `
      begin;
      ${transactionSettings}
      select 1 from private.presenter_runtime_gate where singleton for update;
      do $$
      declare
        wait_started_at timestamptz := clock_timestamp();
      begin
        raise notice 'PHASE729_KILL_FIRST_GATE_READY';
        while not exists (
          select 1 from pg_stat_activity
          where application_name = 'phase729-kill-first-issue-waiter'
            and wait_event_type = 'Lock'
        ) loop
          if clock_timestamp() > wait_started_at + interval '10 seconds' then
            raise exception 'kill-first issue did not reach the gate lock barrier';
          end if;
          perform pg_sleep(0.01);
        end loop;
      end;
      $$;
      select public.set_presenter_runtime_v1(false);
      commit;
    `,
    'PHASE729_KILL_FIRST_GATE_READY',
  )
  await killFirst.ready
  const killFirstIssue = runSql(`
    begin;
    ${transactionSettings}
    set local application_name = 'phase729-kill-first-issue-waiter';
    select public.issue_presenter_connection_v1(
      (select lecture_id from public.phase729_race_fixture),
      ${sqlLiteral(adminSessionId)}::uuid,
      ${sqlLiteral(adminAuthUserId)}::uuid,
      ${sqlLiteral(killFirstTicket)},
      ${sqlLiteral(killFirstManual)},
      statement_timestamp() + interval '45 seconds'
    );
    commit;
  `)
  const killFirstRace = await Promise.allSettled([
    killFirst.done,
    killFirstIssue,
  ])
  if (
    killFirstRace.filter((result) => result.status === 'rejected').length !== 1
  ) {
    throw new Error('kill-first race must reject only the losing issue')
  }
  await runSql(`
    do $$
    begin
      if exists (
        select 1
        from public.presenter_connections
        where ticket_jti_hash = ${sqlLiteral(killFirstTicket)}
      ) or exists (
        select 1 from public.presenter_connections where revoked_at is null
      ) then
        raise exception 'kill-first race persisted a Presenter connection';
      end if;
    end;
    $$;
    select public.set_presenter_runtime_v1(true);
  `)

  // Two concurrent claim attempts share one ticket but propose different
  // capabilities. Exactly one can atomically become active.
  await runSql(`
    update public.phase729_race_fixture
    set claim_connection_id = (
      public.issue_presenter_connection_v1(
        lecture_id,
        ${sqlLiteral(adminSessionId)}::uuid,
        ${sqlLiteral(adminAuthUserId)}::uuid,
        ${sqlLiteral(claimTicket)},
        ${sqlLiteral(claimManual)},
        statement_timestamp() + interval '45 seconds'
      ) ->> 'connection_id'
    )::uuid;
    select public.inspect_presenter_connection_v1(
      claim_connection_id,
      'ticket',
      ${sqlLiteral(claimTicket)},
      ${sqlLiteral(installationHash)},
      ${sqlLiteral(pptxHash)},
      ${sqlLiteral(slideOrderHash)},
      3,
      0,
      false
    )
    from public.phase729_race_fixture;
    select public.confirm_presenter_connection_v1(
      claim_connection_id,
      ${sqlLiteral(adminSessionId)}::uuid,
      ${sqlLiteral(adminAuthUserId)}::uuid
    )
    from public.phase729_race_fixture;
  `)
  const claimSql = (capability) => `
    begin;
    ${transactionSettings}
    do $$
    declare
      claimed jsonb;
    begin
      select public.claim_presenter_connection_v1(
        claim_connection_id,
        'ticket',
        ${sqlLiteral(claimTicket)},
        ${sqlLiteral(installationHash)},
        ${sqlLiteral(capability)}
      ) into claimed
      from public.phase729_race_fixture;
      if claimed is null then
        raise exception 'claim lost the atomic capability race';
      end if;
    end;
    $$;
    commit;
  `
  const claimRace = await Promise.allSettled([
    runSql(claimSql(capabilityA)),
    runSql(claimSql(capabilityB)),
  ])
  if (claimRace.filter((result) => result.status === 'rejected').length !== 1) {
    throw new Error('two-claim race must reject exactly one capability')
  }
  await runSql(`
    do $$
    begin
      if (
        select count(*)
        from public.presenter_connections as connection
        join public.phase729_race_fixture as fixture
          on fixture.claim_connection_id = connection.id
        where connection.state = 'active'
          and connection.revoked_at is null
          and connection.capability_jti_hash in (
            ${sqlLiteral(capabilityA)},
            ${sqlLiteral(capabilityB)}
          )
      ) <> 1 then
        raise exception 'claim race did not converge to one capability';
      end if;
    end;
    $$;
  `)

  // Out-of-order observations can race, but a retry of the latest absolute
  // position must converge sequence=2/page=3 without duplicate rows.
  const pageSql = ({ eventId, label, page, sequence, slideId }) => `
    begin;
    ${transactionSettings}
    insert into public.phase729_race_results (label, payload)
    select
      ${sqlLiteral(label)},
      public.apply_presenter_page_v1(
        connection.id,
        connection.capability_jti_hash,
        ${sqlLiteral(installationHash)},
        ${sequence},
        ${sqlLiteral(eventId)}::uuid,
        ${sqlLiteral(pptxHash)},
        ${sqlLiteral(slideOrderHash)},
        ${slideId},
        ${page},
        ${page}
      )
    from public.presenter_connections as connection
    join public.phase729_race_fixture as fixture
      on fixture.claim_connection_id = connection.id;
    commit;
  `
  await Promise.all([
    runSql(
      pageSql({
        eventId: pageEvent1,
        label: 'sequence-1',
        page: 2,
        sequence: 1,
        slideId: 102,
      }),
    ),
    runSql(
      pageSql({
        eventId: pageEvent2,
        label: 'sequence-2',
        page: 3,
        sequence: 2,
        slideId: 103,
      }),
    ),
  ])
  await runSql(`
    update public.presenter_connections as connection
    set last_request_at = statement_timestamp() - interval '1 second'
    from public.phase729_race_fixture as fixture
    where connection.id = fixture.claim_connection_id;
    select public.apply_presenter_page_v1(
      connection.id,
      connection.capability_jti_hash,
      ${sqlLiteral(installationHash)},
      2,
      ${sqlLiteral(pageEvent2)}::uuid,
      ${sqlLiteral(pptxHash)},
      ${sqlLiteral(slideOrderHash)},
      103,
      3,
      3
    )
    from public.presenter_connections as connection
    join public.phase729_race_fixture as fixture
      on fixture.claim_connection_id = connection.id;
    do $$
    begin
      if not exists (
        select 1
        from public.presenter_connections as connection
        join public.phase729_race_fixture as fixture
          on fixture.claim_connection_id = connection.id
        join public.lecture_live_state as live
          on live.lecture_session_id = fixture.lecture_id
        where connection.last_sequence = 2
          and connection.last_committed_pdf_page = 3
          and live.current_pdf_page = 3
      ) then
        raise exception 'out-of-order page retry did not converge to latest position';
      end if;
      if (
        select count(*)
        from public.presenter_connections as connection
        join public.phase729_race_fixture as fixture
          on connection.lecture_session_id = fixture.lecture_id
        where connection.revoked_at is null
      ) <> 1 then
        raise exception 'page race violated one-unrevoked invariant';
      end if;
    end;
    $$;
  `)

  // The page writer owns the global gate first; manual handover waits and then
  // becomes terminal. No lock cycle or stale active connection may remain.
  const pageFirst = startSqlUntilReady(
    `
      begin;
      ${transactionSettings}
      select 1 from private.presenter_runtime_gate where singleton for update;
      update public.presenter_connections as connection
      set last_request_at = statement_timestamp() - interval '1 second'
      from public.phase729_race_fixture as fixture
      where connection.id = fixture.claim_connection_id;
      do $$
      declare
        wait_started_at timestamptz := clock_timestamp();
      begin
        raise notice 'PHASE729_PAGE_FIRST_GATE_READY';
        while not exists (
          select 1 from pg_stat_activity
          where application_name = 'phase729-page-first-manual-waiter'
            and wait_event_type = 'Lock'
        ) loop
          if clock_timestamp() > wait_started_at + interval '10 seconds' then
            raise exception 'page-first manual revoke did not reach the gate lock barrier';
          end if;
          perform pg_sleep(0.01);
        end loop;
      end;
      $$;
      select public.apply_presenter_page_v1(
        connection.id,
        connection.capability_jti_hash,
        ${sqlLiteral(installationHash)},
        3,
        ${sqlLiteral(pageEvent3)}::uuid,
        ${sqlLiteral(pptxHash)},
        ${sqlLiteral(slideOrderHash)},
        101,
        1,
        1
      )
      from public.presenter_connections as connection
      join public.phase729_race_fixture as fixture
        on fixture.claim_connection_id = connection.id;
      commit;
    `,
    'PHASE729_PAGE_FIRST_GATE_READY',
  )
  await pageFirst.ready
  const pageFirstManual = runSql(`
    begin;
    ${transactionSettings}
    set local application_name = 'phase729-page-first-manual-waiter';
    select public.revoke_presenter_connection_v1(
      claim_connection_id,
      ${sqlLiteral(adminSessionId)}::uuid,
      ${sqlLiteral(adminAuthUserId)}::uuid,
      'manual_handover'
    )
    from public.phase729_race_fixture;
    commit;
  `)
  await Promise.all([pageFirst.done, pageFirstManual])
  await runSql(`
    do $$
    begin
      if not exists (
        select 1
        from public.presenter_connections as connection
        join public.phase729_race_fixture as fixture
          on fixture.claim_connection_id = connection.id
        where connection.state = 'revoked'
          and connection.revoke_reason = 'manual_handover'
      ) or exists (
        select 1
        from public.presenter_connections as connection
        join public.phase729_race_fixture as fixture
          on connection.lecture_session_id = fixture.lecture_id
        where connection.revoked_at is null
      ) then
        raise exception 'page/manual-handover race did not converge';
      end if;
    end;
    $$;
    select public.admin_update_pdf_display_with_presenter_fence_v1(
      lecture_id,
      'phase729-concurrency-doc',
      ${sqlLiteral(pdfHash)},
      1,
      3,
      true,
      2,
      'normal'
    )
    from public.phase729_race_fixture;
  `)
} catch (error) {
  failure = error
} finally {
  try {
    await cleanup()
  } catch (cleanupError) {
    failure ??= cleanupError
  }
}

if (failure) throw failure
console.log(
  'Phase 7.29 issue/kill-switch, two-claim, page ordering and manual-handover races converged without deadlock or duplicate active state.',
)
