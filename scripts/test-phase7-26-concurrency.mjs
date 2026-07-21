import { randomBytes, randomInt, randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'

const container =
  process.env.SUPABASE_DB_CONTAINER ?? 'supabase_db_compass-interactive'
const suffix = randomBytes(5).toString('hex')
const adminSessionId = randomUUID()
const adminUserId = randomUUID()
const workerAttemptId = randomUUID()
const commitOperationId = randomUUID()
const activationOperationId = randomUUID()
const abortWinsOperationId = randomUUID()
const activationWinsOperationId = randomUUID()

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

const roles = ['nonce', 'commit', 'activation', 'cleanup', 'abort_wins', 'active_wins']
const codes = new Map(
  roles.map((role) => [role, String(randomInt(100000, 1000000))]),
)
const hashes = new Map(
  roles.map((role) => [role, randomBytes(32).toString('hex')]),
)
const textHashes = new Map(
  roles.map((role) => [role, randomBytes(32).toString('hex')]),
)
const clientIds = new Map(roles.map((role) => [role, randomUUID()]))
const nonceHashes = new Map(
  roles.map((role) => [role, randomBytes(32).toString('hex')]),
)
const ticketHashes = new Map(
  roles.map((role) => [role, randomBytes(32).toString('hex')]),
)

const lectureColumn = (role) => `${role}_lecture_id`
const publicationColumn = (role) => `${role}_publication_id`
const createFixture = roles
  .map(
    (role) => `
      update public.phase726_race_fixture
      set ${lectureColumn(role)} = public.admin_create_lecture(
        ${sqlLiteral(`P726 ${role} ${suffix}`)},
        ${sqlLiteral(hashes.get(role))},
        ${sqlLiteral(codes.get(role))},
        null,
        null
      );
      select public.admin_set_lecture_status(
        ${lectureColumn(role)}, 'start', null
      ) from public.phase726_race_fixture;
      update public.phase726_race_fixture
      set ${publicationColumn(role)} = (
        public.admin_create_pdf_publication_v1(
          ${lectureColumn(role)},
          ${sqlLiteral(`doc-${role.replace('_', '-')}`)},
          ${sqlLiteral(hashes.get(role))},
          2048,
          2,
          200,
          ${sqlLiteral(textHashes.get(role))},
          ${sqlLiteral(`P726 ${role}`)},
          true,
          'https://compass.example',
          ${sqlLiteral(clientIds.get(role))}::uuid,
          ${sqlLiteral(nonceHashes.get(role))},
          ${sqlLiteral(ticketHashes.get(role))},
          ${sqlLiteral(adminSessionId)}::uuid,
          ${sqlLiteral(adminUserId)}::uuid
        ) ->> 'publication_id'
      )::uuid;
    `,
  )
  .join('\n')

await runSql(`
  drop table if exists public.phase726_race_fixture;
  create table public.phase726_race_fixture (
    ${roles
      .flatMap((role) => [
        `${lectureColumn(role)} uuid`,
        `${publicationColumn(role)} uuid`,
      ])
      .join(',\n    ')}
  );
  insert into public.phase726_race_fixture default values;

  insert into public.admin_sessions (
    id, token_hash, auth_user_id, pin_version_hash,
    issued_at, last_seen_at, idle_expires_at, expires_at
  ) values (
    ${sqlLiteral(adminSessionId)}::uuid,
    ${sqlLiteral(randomBytes(32).toString('hex'))},
    ${sqlLiteral(adminUserId)}::uuid,
    ${sqlLiteral(randomBytes(32).toString('hex'))},
    statement_timestamp() - interval '1 minute',
    statement_timestamp(),
    statement_timestamp() + interval '1 hour',
    statement_timestamp() + interval '4 hours'
  );

  ${createFixture}

  update public.lecture_pdf_publications as publication
  set
    state = 'uploaded',
    nonce_used_at = statement_timestamp(),
    worker_attempt_id = gen_random_uuid(),
    actual_byte_size = publication.expected_byte_size,
    actual_pdf_sha256 = publication.expected_pdf_sha256,
    pdf_magic_verified = true,
    r2_object_version = 'race-r2-version',
    r2_etag = 'race-upload-etag',
    uploaded_at = statement_timestamp(),
    upload_lease_expires_at = null
  from public.phase726_race_fixture as fixture
  where publication.id = fixture.commit_publication_id;

  update public.lecture_pdf_publications as publication
  set
    state = 'committed',
    nonce_used_at = statement_timestamp(),
    worker_attempt_id = gen_random_uuid(),
    actual_byte_size = publication.expected_byte_size,
    actual_pdf_sha256 = publication.expected_pdf_sha256,
    pdf_magic_verified = true,
    r2_object_version = 'race-r2-version',
    r2_etag = 'race-upload-etag',
    uploaded_at = statement_timestamp(),
    commit_operation_id = gen_random_uuid(),
    committed_manifest_version = 10,
    committed_manifest_access_version = 1,
    committed_manifest_etag = 'race-hidden-etag',
    committed_at = statement_timestamp()
  from public.phase726_race_fixture as fixture
  where publication.id in (
    fixture.activation_publication_id,
    fixture.abort_wins_publication_id,
    fixture.active_wins_publication_id
  );

  update public.lecture_pdf_publications as publication
  set
    state = 'aborted',
    ticket_generation = publication.ticket_generation + 1,
    aborted_at = statement_timestamp(),
    cleanup_after = statement_timestamp() - interval '1 second',
    last_error_code = 'race_cleanup'
  from public.phase726_race_fixture as fixture
  where publication.id = fixture.cleanup_publication_id;
`)

const transactionSettings = `
  set local lock_timeout = '5s';
  set local statement_timeout = '15s';
`
const nonceClaimSql = `
  begin;
  ${transactionSettings}
  select public.worker_claim_pdf_publication_nonce_v1(
    fixture.nonce_publication_id,
    1,
    ${sqlLiteral(nonceHashes.get('nonce'))},
    ${sqlLiteral(ticketHashes.get('nonce'))},
    'lecture_' || replace(lecture.pdf_public_id::text, '-', ''),
    'doc-nonce',
    ${sqlLiteral(hashes.get('nonce'))},
    2048,
    'https://compass.example',
    ${sqlLiteral(adminSessionId)}::uuid,
    ${sqlLiteral(workerAttemptId)}::uuid
  )
  from public.phase726_race_fixture as fixture
  join public.lecture_sessions as lecture on lecture.id = fixture.nonce_lecture_id;
  commit;
`
await Promise.all([runSql(nonceClaimSql), runSql(nonceClaimSql)])

const commitPrepareSql = `
  begin;
  ${transactionSettings}
  select public.admin_prepare_pdf_publication_commit_v1(
    commit_publication_id,
    ${sqlLiteral(commitOperationId)}::uuid,
    ${sqlLiteral(adminSessionId)}::uuid,
    ${sqlLiteral(adminUserId)}::uuid
  ) from public.phase726_race_fixture;
  commit;
`
await Promise.all([runSql(commitPrepareSql), runSql(commitPrepareSql)])

const activationPrepare = (column, operationId) => `
  select public.admin_prepare_pdf_publication_activation_v1(
    ${column},
    ${sqlLiteral(operationId)}::uuid,
    ${sqlLiteral(adminSessionId)}::uuid,
    ${sqlLiteral(adminUserId)}::uuid
  ) from public.phase726_race_fixture;
`
const activationPrepareSql = `
  begin;
  ${transactionSettings}
  ${activationPrepare('activation_publication_id', activationOperationId)}
  commit;
`
await Promise.all([runSql(activationPrepareSql), runSql(activationPrepareSql)])

await Promise.all([
  runSql(`select * from public.claim_due_pdf_publication_cleanup_v1(1, 'race-cleaner-a');`),
  runSql(`select * from public.claim_due_pdf_publication_cleanup_v1(1, 'race-cleaner-b');`),
])

const activationComplete = (column, operationId, etag) => `
  select public.admin_complete_pdf_publication_activation_v1(
    ${column},
    ${sqlLiteral(operationId)}::uuid,
    11,
    2,
    ${sqlLiteral(etag)},
    ${sqlLiteral(adminSessionId)}::uuid,
    ${sqlLiteral(adminUserId)}::uuid
  ) from public.phase726_race_fixture;
`
const activationCompleteSql = `
  begin;
  ${transactionSettings}
  ${activationComplete(
    'activation_publication_id',
    activationOperationId,
    'race-active-etag',
  )}
  commit;
`
await Promise.all([runSql(activationCompleteSql), runSql(activationCompleteSql)])

await runSql(`
  ${activationPrepare('abort_wins_publication_id', abortWinsOperationId)}
  ${activationPrepare('active_wins_publication_id', activationWinsOperationId)}
`)

await Promise.all([
  runSql(`
    begin;
    ${transactionSettings}
    select public.admin_abort_pdf_publication_v1(
      abort_wins_publication_id,
      'parallel_abort_wins',
      ${sqlLiteral(adminSessionId)}::uuid,
      ${sqlLiteral(adminUserId)}::uuid
    ) from public.phase726_race_fixture;
    select pg_sleep(0.5);
    commit;
  `),
  runSql(`
    begin;
    ${transactionSettings}
    select pg_sleep(0.1);
    ${activationComplete(
      'abort_wins_publication_id',
      abortWinsOperationId,
      'race-abort-wins-etag',
    )}
    commit;
  `),
])

const activationWins = await Promise.allSettled([
  runSql(`
    begin;
    ${transactionSettings}
    ${activationComplete(
      'active_wins_publication_id',
      activationWinsOperationId,
      'race-activation-wins-etag',
    )}
    select pg_sleep(0.5);
    commit;
  `),
  runSql(`
    begin;
    ${transactionSettings}
    select pg_sleep(0.1);
    select public.admin_abort_pdf_publication_v1(
      active_wins_publication_id,
      'parallel_activation_wins',
      ${sqlLiteral(adminSessionId)}::uuid,
      ${sqlLiteral(adminUserId)}::uuid
    ) from public.phase726_race_fixture;
    commit;
  `),
])
if (activationWins.filter((result) => result.status === 'rejected').length !== 1) {
  throw new Error('activation-first race did not reject exactly the losing abort')
}

await runSql(`
  do $$
  declare
    fixture public.phase726_race_fixture%rowtype;
  begin
    select * into fixture from public.phase726_race_fixture;

    if (
      select count(*) from public.lecture_pdf_publication_events
      where publication_id = fixture.nonce_publication_id
        and event_type = 'nonce_claimed'
    ) <> 1 then
      raise exception 'parallel nonce claim produced a noncanonical event count';
    end if;
    if (
      select worker_attempt_id from public.lecture_pdf_publications
      where id = fixture.nonce_publication_id
    ) <> ${sqlLiteral(workerAttemptId)}::uuid then
      raise exception 'parallel nonce claim did not converge to one attempt';
    end if;

    if (
      select count(*) from public.lecture_pdf_publication_events
      where publication_id = fixture.commit_publication_id
        and event_type = 'commit_prepared'
    ) <> 1 then
      raise exception 'parallel commit preparation produced duplicate events';
    end if;
    if (
      select count(*) from public.lecture_pdf_publication_events
      where publication_id = fixture.activation_publication_id
        and event_type = 'activation_prepared'
    ) <> 1 then
      raise exception 'parallel activation preparation produced duplicate events';
    end if;
    if (
      select count(*) from public.lecture_pdf_publication_events
      where publication_id = fixture.activation_publication_id
        and event_type = 'active'
    ) <> 1 then
      raise exception 'parallel activation completion produced duplicate events';
    end if;

    if (
      select count(*) from public.lecture_pdf_publication_events
      where publication_id = fixture.cleanup_publication_id
        and event_type = 'cleanup_claimed'
    ) <> 1 or (
      select cleanup_attempt_count from public.lecture_pdf_publications
      where id = fixture.cleanup_publication_id
    ) <> 1 then
      raise exception 'parallel cleanup did not converge to one lease';
    end if;

    if not exists (
      select 1
      from public.lecture_pdf_publications as publication
      join public.lecture_sessions as lecture
        on lecture.id = publication.lecture_session_id
      where publication.id = fixture.abort_wins_publication_id
        and publication.state = 'aborted'
        and lecture.pdf_access_version = 1
        and publication.cleanup_worker_generation = 1
    ) then
      raise exception 'abort-first activation race split DB state';
    end if;
    if not exists (
      select 1
      from public.lecture_pdf_publications as publication
      join public.lecture_sessions as lecture
        on lecture.id = publication.lecture_session_id
      where publication.id = fixture.active_wins_publication_id
        and publication.state = 'active'
        and lecture.pdf_access_version = 2
        and publication.cleanup_worker_generation is null
    ) then
      raise exception 'activation-first abort race split DB state';
    end if;
  end;
  $$;

  delete from public.lecture_pdf_publication_events as event
  using public.phase726_race_fixture as fixture
  where event.publication_id in (
    fixture.nonce_publication_id,
    fixture.commit_publication_id,
    fixture.activation_publication_id,
    fixture.cleanup_publication_id,
    fixture.abort_wins_publication_id,
    fixture.active_wins_publication_id
  );
  delete from public.lecture_pdf_documents as document
  using public.phase726_race_fixture as fixture
  where document.lecture_session_id in (
    fixture.nonce_lecture_id,
    fixture.commit_lecture_id,
    fixture.activation_lecture_id,
    fixture.cleanup_lecture_id,
    fixture.abort_wins_lecture_id,
    fixture.active_wins_lecture_id
  );
  delete from public.lecture_pdf_publications as publication
  using public.phase726_race_fixture as fixture
  where publication.id in (
    fixture.nonce_publication_id,
    fixture.commit_publication_id,
    fixture.activation_publication_id,
    fixture.cleanup_publication_id,
    fixture.abort_wins_publication_id,
    fixture.active_wins_publication_id
  );
  delete from public.lecture_lifecycle_events as event
  using public.phase726_race_fixture as fixture
  where event.lecture_session_id in (
    fixture.nonce_lecture_id,
    fixture.commit_lecture_id,
    fixture.activation_lecture_id,
    fixture.cleanup_lecture_id,
    fixture.abort_wins_lecture_id,
    fixture.active_wins_lecture_id
  );
  delete from public.lecture_ai_control as control
  using public.phase726_race_fixture as fixture
  where control.lecture_session_id in (
    fixture.nonce_lecture_id,
    fixture.commit_lecture_id,
    fixture.activation_lecture_id,
    fixture.cleanup_lecture_id,
    fixture.abort_wins_lecture_id,
    fixture.active_wins_lecture_id
  );
  delete from public.lecture_sessions as lecture
  using public.phase726_race_fixture as fixture
  where lecture.id in (
    fixture.nonce_lecture_id,
    fixture.commit_lecture_id,
    fixture.activation_lecture_id,
    fixture.cleanup_lecture_id,
    fixture.abort_wins_lecture_id,
    fixture.active_wins_lecture_id
  );
  delete from public.admin_sessions where id = ${sqlLiteral(adminSessionId)}::uuid;
  drop table public.phase726_race_fixture;
`)

console.log(
  'Phase 7.26 two-connection nonce, lease, finalize, abort, and cleanup races converged without deadlock.',
)
