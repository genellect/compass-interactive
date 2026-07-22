import { randomBytes, randomInt, randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'

const container =
  process.env.SUPABASE_DB_CONTAINER ?? 'supabase_db_compass-interactive'
const adminA = { sessionId: randomUUID(), userId: randomUUID() }
const adminB = { sessionId: randomUUID(), userId: randomUUID() }

function sqlLiteral(value) {
  return `'${String(value).replaceAll("'", "''")}'`
}

function lectureCode() {
  return String(randomInt(100000, 1000000))
}

async function sha256Hex(value) {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(value),
  )
  return Buffer.from(digest).toString('hex')
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
      else
        reject(new Error(stderr.trim() || `psql exited with code ${exitCode}`))
    })
  })
}

const idempotentRequest = randomUUID()
const productionRequests = [randomUUID(), randomUUID()]
const rehearsalRequests = [randomUUID(), randomUUID()]
const codes = Array.from({ length: 6 }, () => lectureCode())
const hashes = await Promise.all(codes.map((code) => sha256Hex(code)))

function createRunSql({ admin, codeIndex, label, requestId, runKind }) {
  return `
    begin;
    set local lock_timeout = '5s';
    set local statement_timeout = '20s';
    insert into public.phase727_race_results (label, lecture_session_id)
    select
      ${sqlLiteral(label)},
      (public.admin_create_phase727_journal_club_run_v1(
        ${sqlLiteral(runKind)},
        ${sqlLiteral(hashes[codeIndex])},
        ${sqlLiteral(codes[codeIndex])},
        ${sqlLiteral(requestId)}::uuid,
        ${sqlLiteral(admin.sessionId)}::uuid,
        ${sqlLiteral(admin.userId)}::uuid
      ) ->> 'lecture_session_id')::uuid;
    commit;
  `
}

async function cleanup() {
  await runSql(`
    delete from public.phase727_journal_club_poll_slots
    where lecture_session_id in (
      select lecture_session_id from public.phase727_race_results
    );
    delete from public.poll_options
    where lecture_session_id in (
      select lecture_session_id from public.phase727_race_results
    );
    delete from public.polls
    where lecture_session_id in (
      select lecture_session_id from public.phase727_race_results
    );
    delete from public.phase727_journal_club_runs
    where lecture_session_id in (
      select lecture_session_id from public.phase727_race_results
    );
    delete from public.lecture_lifecycle_events
    where lecture_session_id in (
      select lecture_session_id from public.phase727_race_results
    );
    delete from public.lecture_ai_control
    where lecture_session_id in (
      select lecture_session_id from public.phase727_race_results
    );
    delete from public.lecture_pdf_documents
    where lecture_session_id in (
      select lecture_session_id from public.phase727_race_results
    );
    delete from public.lecture_sessions
    where id in (select lecture_session_id from public.phase727_race_results);
    delete from public.admin_sessions
    where id in (
      ${sqlLiteral(adminA.sessionId)}::uuid,
      ${sqlLiteral(adminB.sessionId)}::uuid
    );
    drop table if exists public.phase727_race_results;
  `)
}

let failure
try {
  await runSql(`
    drop table if exists public.phase727_race_results;
    create table public.phase727_race_results (
      id bigint generated always as identity primary key,
      label text not null,
      lecture_session_id uuid not null
    );
    insert into public.admin_sessions (
      id, token_hash, auth_user_id, pin_version_hash,
      issued_at, last_seen_at, idle_expires_at, expires_at
    ) values
      (
        ${sqlLiteral(adminA.sessionId)}::uuid,
        ${sqlLiteral(randomBytes(32).toString('hex'))},
        ${sqlLiteral(adminA.userId)}::uuid,
        ${sqlLiteral(randomBytes(32).toString('hex'))},
        statement_timestamp() - interval '1 minute',
        statement_timestamp(),
        statement_timestamp() + interval '1 hour',
        statement_timestamp() + interval '4 hours'
      ),
      (
        ${sqlLiteral(adminB.sessionId)}::uuid,
        ${sqlLiteral(randomBytes(32).toString('hex'))},
        ${sqlLiteral(adminB.userId)}::uuid,
        ${sqlLiteral(randomBytes(32).toString('hex'))},
        statement_timestamp() - interval '1 minute',
        statement_timestamp(),
        statement_timestamp() + interval '1 hour',
        statement_timestamp() + interval '4 hours'
      );
  `)

  const idempotentSql = createRunSql({
    admin: adminA,
    codeIndex: 0,
    label: 'idempotent',
    requestId: idempotentRequest,
    runKind: 'rehearsal',
  })
  await Promise.all([runSql(idempotentSql), runSql(idempotentSql)])

  await runSql(`
    do $$
    begin
      if (
        select count(*) from public.phase727_race_results
        where label = 'idempotent'
      ) <> 2 or (
        select count(distinct lecture_session_id)
        from public.phase727_race_results where label = 'idempotent'
      ) <> 1 then
        raise exception 'same request did not converge to one lecture';
      end if;
      if (
        select count(*)
        from public.polls as poll
        where poll.lecture_session_id = (
          select lecture_session_id
          from public.phase727_race_results
          where label = 'idempotent'
          limit 1
        )
      ) <> 6 then
        raise exception 'idempotent replay created duplicate or missing Polls';
      end if;
      if exists (
        select 1 from public.lecture_sessions as lecture
        join public.phase727_race_results as result
          on result.lecture_session_id = lecture.id
        where result.label = 'idempotent' and lecture.status <> 'draft'
      ) or exists (
        select 1 from public.lecture_pdf_documents as document
        join public.phase727_race_results as result
          on result.lecture_session_id = document.lecture_session_id
        where result.label = 'idempotent'
      ) then
        raise exception 'preset creation started or published work';
      end if;
    end;
    $$;
  `)

  const productionRace = await Promise.allSettled([
    runSql(
      createRunSql({
        admin: adminA,
        codeIndex: 1,
        label: 'production-a',
        requestId: productionRequests[0],
        runKind: 'production',
      }),
    ),
    runSql(
      createRunSql({
        admin: adminB,
        codeIndex: 2,
        label: 'production-b',
        requestId: productionRequests[1],
        runKind: 'production',
      }),
    ),
  ])
  if (
    productionRace.filter((result) => result.status === 'rejected').length !== 1
  ) {
    throw new Error('production race did not reject exactly one contender')
  }

  await Promise.all([
    runSql(
      createRunSql({
        admin: adminA,
        codeIndex: 3,
        label: 'rehearsal-a',
        requestId: rehearsalRequests[0],
        runKind: 'rehearsal',
      }),
    ),
    runSql(
      createRunSql({
        admin: adminB,
        codeIndex: 4,
        label: 'rehearsal-b',
        requestId: rehearsalRequests[1],
        runKind: 'rehearsal',
      }),
    ),
  ])

  await runSql(`
    do $$
    begin
      if (
        select count(*) from public.phase727_journal_club_runs
        where run_kind = 'production'
      ) <> 1 then
        raise exception 'production uniqueness did not converge';
      end if;
      if (
        select count(distinct lecture_session_id)
        from public.phase727_race_results
        where label in ('rehearsal-a', 'rehearsal-b')
      ) <> 2 then
        raise exception 'parallel rehearsals did not remain isolated';
      end if;
      if exists (
        select 1
        from public.phase727_race_results as result
        join public.phase727_journal_club_runs as run
          on run.lecture_session_id = result.lecture_session_id
        where (result.label = 'rehearsal-a'
               and run.created_by_admin_session_id <> ${sqlLiteral(adminA.sessionId)}::uuid)
           or (result.label = 'rehearsal-b'
               and run.created_by_admin_session_id <> ${sqlLiteral(adminB.sessionId)}::uuid)
      ) then
        raise exception 'parallel rehearsal ownership binding crossed Admins';
      end if;
      if exists (
        select 1
        from public.phase727_race_results as result
        join public.polls as poll
          on poll.lecture_session_id = result.lecture_session_id
        where result.label in ('rehearsal-a', 'rehearsal-b')
          and poll.status <> 'draft'
      ) then
        raise exception 'rehearsal Poll was opened automatically';
      end if;
    end;
    $$;
  `)

  await runSql(`
    select public.admin_register_pdf_document(
      result.lecture_session_id,
      'journal-club-2026-07-23-v1',
      '8c6903527b050c1db5f6b13b24bcf9108950bf8248a80205b10be6a9c63d7842',
      1,
      '260723 JournalClub Presentation.pdf',
      34,
      5816208,
      10000,
      '8c6903527b050c1db5f6b13b24bcf9108950bf8248a80205b10be6a9c63d7842',
      case result.label
        when 'rehearsal-a' then repeat('a', 64)
        else repeat('b', 64)
      end,
      true
    )
    from public.phase727_race_results as result
    where result.label in ('rehearsal-a', 'rehearsal-b');
  `)

  const openRace = await Promise.allSettled([
    runSql(`
      select public.admin_set_lecture_status(
        (select lecture_session_id from public.phase727_race_results
         where label = 'rehearsal-a'),
        'start',
        null
      );
    `),
    runSql(`
      select public.admin_set_lecture_status(
        (select lecture_session_id from public.phase727_race_results
         where label = 'rehearsal-b'),
        'start',
        null
      );
    `),
  ])
  if (openRace.filter((result) => result.status === 'rejected').length !== 1) {
    throw new Error(
      'parallel rehearsal start did not reject exactly one contender',
    )
  }

  await runSql(`
    do $$
    begin
      if (
        select count(*)
        from public.lecture_sessions as lecture
        join public.phase727_journal_club_runs as run
          on run.lecture_session_id = lecture.id
        where lecture.status = 'open'
      ) <> 1 then
        raise exception 'parallel starts left an invalid open-run count';
      end if;
    end;
    $$;
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
  'Phase 7.27 two-connection idempotency, production uniqueness, rehearsal isolation, and open-run races converged.',
)
