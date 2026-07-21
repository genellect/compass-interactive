BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path = public, extensions;
SELECT no_plan();

SELECT has_table(
  'public',
  'phase727_journal_club_runs',
  'Journal Club run binding table exists'
);
SELECT has_table(
  'public',
  'phase727_journal_club_poll_slots',
  'Journal Club Poll ordering table exists'
);
SELECT ok(
  (SELECT relrowsecurity
   FROM pg_class
   WHERE oid = 'public.phase727_journal_club_runs'::regclass)
  AND
  (SELECT relrowsecurity
   FROM pg_class
   WHERE oid = 'public.phase727_journal_club_poll_slots'::regclass),
  'Journal Club control tables have RLS enabled'
);
SELECT ok(
  NOT has_table_privilege(
    'anon', 'public.phase727_journal_club_runs', 'SELECT'
  )
  AND NOT has_table_privilege(
    'authenticated', 'public.phase727_journal_club_runs', 'SELECT'
  )
  AND NOT has_table_privilege(
    'anon', 'public.phase727_journal_club_poll_slots', 'SELECT'
  )
  AND NOT has_table_privilege(
    'authenticated', 'public.phase727_journal_club_poll_slots', 'SELECT'
  ),
  'browser roles cannot inspect Journal Club operational metadata'
);
SELECT ok(
  has_table_privilege(
    'service_role', 'public.phase727_journal_club_runs', 'SELECT,INSERT'
  )
  AND NOT has_table_privilege(
    'service_role', 'public.phase727_journal_club_runs', 'UPDATE'
  )
  AND NOT has_table_privilege(
    'service_role', 'public.phase727_journal_club_runs', 'DELETE'
  )
  AND has_table_privilege(
    'service_role', 'public.phase727_journal_club_poll_slots', 'SELECT,INSERT'
  )
  AND NOT has_table_privilege(
    'service_role', 'public.phase727_journal_club_poll_slots', 'UPDATE'
  )
  AND NOT has_table_privilege(
    'service_role', 'public.phase727_journal_club_poll_slots', 'DELETE'
  ),
  'service role has only the append-only Journal Club table privileges'
);
SELECT is(
  (SELECT count(*)::integer
   FROM pg_policies
   WHERE schemaname = 'public'
     AND tablename IN (
       'phase727_journal_club_runs',
       'phase727_journal_club_poll_slots'
     )),
  0,
  'Journal Club service-only tables expose no row policy to browser roles'
);
SELECT ok(
  NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename IN (
        'phase727_journal_club_runs',
        'phase727_journal_club_poll_slots'
      )
  ),
  'Journal Club operational metadata adds no Realtime fanout'
);
SELECT ok(
  to_regclass('public.phase727_journal_club_one_production_idx') IS NOT NULL
  AND to_regclass(
    'public.phase727_journal_club_runs_event_kind_created_idx'
  ) IS NOT NULL
  AND to_regclass(
    'public.phase727_journal_club_poll_slots_poll_idx'
  ) IS NOT NULL,
  'production uniqueness and operational lookups are indexed'
);

SELECT ok(
  to_regprocedure(
    'public.admin_create_phase727_journal_club_run_v1(text,text,text,uuid,uuid,uuid)'
  ) IS NOT NULL,
  'Journal Club run creation RPC exists'
);
SELECT ok(
  NOT has_function_privilege(
    'anon',
    'public.admin_create_phase727_journal_club_run_v1(text,text,text,uuid,uuid,uuid)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'authenticated',
    'public.admin_create_phase727_journal_club_run_v1(text,text,text,uuid,uuid,uuid)',
    'EXECUTE'
  )
  AND has_function_privilege(
    'service_role',
    'public.admin_create_phase727_journal_club_run_v1(text,text,text,uuid,uuid,uuid)',
    'EXECUTE'
  ),
  'Journal Club creation RPC is service-role only'
);
SELECT ok(
  (SELECT NOT procedure.prosecdef
          AND procedure.proconfig = ARRAY['search_path=""']::text[]
   FROM pg_proc AS procedure
   WHERE procedure.oid = to_regprocedure(
     'public.admin_create_phase727_journal_club_run_v1(text,text,text,uuid,uuid,uuid)'
   )),
  'Journal Club creation RPC is SECURITY INVOKER with empty search_path'
);
SELECT ok(
  NOT has_function_privilege(
    'anon', 'private.build_public_lecture_archive_v4(uuid)', 'EXECUTE'
  )
  AND NOT has_function_privilege(
    'authenticated', 'private.build_public_lecture_archive_v4(uuid)', 'EXECUTE'
  )
  AND has_function_privilege(
    'service_role', 'private.build_public_lecture_archive_v4(uuid)', 'EXECUTE'
  ),
  'Phase 7.27 archive builder remains service-only'
);

CREATE TEMP TABLE phase727_fixture (
  production_id uuid,
  rehearsal_one_id uuid,
  rehearsal_two_id uuid,
  standard_id uuid,
  production_result jsonb,
  replay_result jsonb,
  rehearsal_one_result jsonb,
  rehearsal_two_result jsonb,
  publication_result jsonb
);
GRANT SELECT, INSERT, UPDATE ON phase727_fixture TO service_role;
INSERT INTO phase727_fixture DEFAULT VALUES;

SET LOCAL ROLE service_role;

INSERT INTO public.admin_sessions (
  id,
  token_hash,
  auth_user_id,
  pin_version_hash,
  issued_at,
  last_seen_at,
  idle_expires_at,
  expires_at
) VALUES
  (
    '72700000-0000-4000-8000-000000000001',
    repeat('1', 64),
    '72700000-0000-4000-8000-000000000101',
    repeat('2', 64),
    statement_timestamp() - interval '1 minute',
    statement_timestamp() - interval '30 seconds',
    statement_timestamp() + interval '1 hour',
    statement_timestamp() + interval '4 hours'
  ),
  (
    '72700000-0000-4000-8000-000000000002',
    repeat('3', 64),
    '72700000-0000-4000-8000-000000000102',
    repeat('4', 64),
    statement_timestamp() - interval '1 minute',
    statement_timestamp() - interval '30 seconds',
    statement_timestamp() + interval '1 hour',
    statement_timestamp() + interval '4 hours'
  );

UPDATE phase727_fixture
SET production_result = public.admin_create_phase727_journal_club_run_v1(
  'production',
  encode(
    extensions.digest(convert_to('727001', 'UTF8'), 'sha256'),
    'hex'
  ),
  '727001',
  '72700000-0000-4000-8000-000000000201',
  '72700000-0000-4000-8000-000000000001',
  '72700000-0000-4000-8000-000000000101'
);
UPDATE phase727_fixture
SET production_id = (production_result ->> 'lecture_session_id')::uuid;

SELECT is(
  (SELECT production_result ->> 'created' FROM phase727_fixture),
  'true',
  'first production request creates a run'
);
SELECT is(
  (SELECT production_result ->> 'idempotent_replay' FROM phase727_fixture),
  'false',
  'first production request is not a replay'
);
SELECT is(
  (SELECT lecture.status
   FROM public.lecture_sessions AS lecture, phase727_fixture AS fixture
   WHERE lecture.id = fixture.production_id),
  'draft',
  'preset creation does not start the production lecture'
);
SELECT is(
  (SELECT lecture.title
   FROM public.lecture_sessions AS lecture, phase727_fixture AS fixture
   WHERE lecture.id = fixture.production_id),
  '7.23 Journal Club',
  'preset assigns the fixed user-visible Journal Club title'
);

UPDATE phase727_fixture
SET replay_result = public.admin_create_phase727_journal_club_run_v1(
  'production',
  encode(
    extensions.digest(convert_to('727099', 'UTF8'), 'sha256'),
    'hex'
  ),
  '727099',
  '72700000-0000-4000-8000-000000000201',
  '72700000-0000-4000-8000-000000000001',
  '72700000-0000-4000-8000-000000000101'
);
SELECT is(
  (SELECT replay_result ->> 'lecture_session_id' FROM phase727_fixture),
  (SELECT production_id::text FROM phase727_fixture),
  'same client request returns the original production lecture'
);
SELECT is(
  (SELECT replay_result ->> 'idempotent_replay' FROM phase727_fixture),
  'true',
  'same client request is reported as an idempotent replay'
);
SELECT is(
  (SELECT count(*)::integer
   FROM public.phase727_journal_club_runs
   WHERE run_kind = 'production'),
  1,
  'idempotent replay does not duplicate production state'
);

SELECT throws_ok(
  $$
    SELECT public.admin_create_phase727_journal_club_run_v1(
      'production',
      encode(
        extensions.digest(convert_to('727098', 'UTF8'), 'sha256'),
        'hex'
      ),
      '727098',
      '72700000-0000-4000-8000-000000000201',
      '72700000-0000-4000-8000-000000000002',
      '72700000-0000-4000-8000-000000000102'
    )
  $$,
  '42501',
  'Journal Club request identity does not match',
  'a different tracked Admin cannot replay another Admin request'
);
SELECT throws_ok(
  $$
    SELECT public.admin_create_phase727_journal_club_run_v1(
      'production',
      encode(
        extensions.digest(convert_to('727002', 'UTF8'), 'sha256'),
        'hex'
      ),
      '727002',
      '72700000-0000-4000-8000-000000000202',
      '72700000-0000-4000-8000-000000000001',
      '72700000-0000-4000-8000-000000000101'
    )
  $$,
  'P0001',
  'Journal Club production run already exists',
  'the event permits only one production run'
);
SELECT is(
  (SELECT count(*)::integer
   FROM public.lecture_sessions
   WHERE code_hash = encode(
     extensions.digest(convert_to('727002', 'UTF8'), 'sha256'),
     'hex'
   )),
  0,
  'rejected second production leaves no orphan lecture'
);

UPDATE phase727_fixture
SET rehearsal_one_result = public.admin_create_phase727_journal_club_run_v1(
  'rehearsal',
  encode(
    extensions.digest(convert_to('727003', 'UTF8'), 'sha256'),
    'hex'
  ),
  '727003',
  '72700000-0000-4000-8000-000000000203',
  '72700000-0000-4000-8000-000000000001',
  '72700000-0000-4000-8000-000000000101'
);
UPDATE phase727_fixture
SET rehearsal_one_id = (rehearsal_one_result ->> 'lecture_session_id')::uuid;
UPDATE phase727_fixture
SET rehearsal_two_result = public.admin_create_phase727_journal_club_run_v1(
  'rehearsal',
  encode(
    extensions.digest(convert_to('727004', 'UTF8'), 'sha256'),
    'hex'
  ),
  '727004',
  '72700000-0000-4000-8000-000000000204',
  '72700000-0000-4000-8000-000000000001',
  '72700000-0000-4000-8000-000000000101'
);
UPDATE phase727_fixture
SET rehearsal_two_id = (rehearsal_two_result ->> 'lecture_session_id')::uuid;

SELECT ok(
  (SELECT rehearsal_one_id <> production_id
          AND rehearsal_two_id <> production_id
          AND rehearsal_one_id <> rehearsal_two_id
   FROM phase727_fixture),
  'production and repeatable rehearsals use distinct lecture identities'
);
SELECT is(
  (SELECT count(*)::integer
   FROM public.phase727_journal_club_runs
   WHERE run_kind = 'rehearsal'),
  2,
  'multiple isolated rehearsals are allowed'
);
SELECT is(
  (SELECT count(*)::integer
   FROM public.polls AS poll, phase727_fixture AS fixture
   WHERE poll.lecture_session_id IN (
     fixture.production_id,
     fixture.rehearsal_one_id,
     fixture.rehearsal_two_id
   )),
  18,
  'each created run owns exactly six Polls'
);
SELECT is(
  (SELECT count(*)::integer
   FROM public.polls AS poll, phase727_fixture AS fixture
   WHERE poll.lecture_session_id IN (
     fixture.production_id,
     fixture.rehearsal_one_id,
     fixture.rehearsal_two_id
   )
     AND poll.status = 'draft'
     AND poll.type = 'single'),
  18,
  'all preset Polls begin as draft single-choice Polls'
);
SELECT is(
  (SELECT count(*)::integer
   FROM public.poll_options AS option
   JOIN public.polls AS poll ON poll.id = option.poll_id
   CROSS JOIN phase727_fixture AS fixture
   WHERE poll.lecture_session_id IN (
     fixture.production_id,
     fixture.rehearsal_one_id,
     fixture.rehearsal_two_id
   )),
  72,
  'each preset Poll receives four isolated options'
);
SELECT is(
  (SELECT jsonb_agg(poll.question ORDER BY slot.display_order)
   FROM public.phase727_journal_club_poll_slots AS slot
   JOIN public.polls AS poll ON poll.id = slot.poll_id
   CROSS JOIN phase727_fixture AS fixture
   WHERE slot.lecture_session_id = fixture.production_id),
  jsonb_build_array(
    'QUIZ1: C9orf72リピートはどの方向に転写される？',
    'QUIZ2: CasRxが直接切断する分子はどれ？',
    'QUIZ3: gRNAをリピート隣接領域に設計する利点は？',
    'FINAL QUIZ: この研究から直接結論できないものはどれ？',
    '今回の発表を通して、説明・文献の内容をどの程度理解できましたか？',
    'COMPASS Interactiveは、今回の発表内容の理解や議論への参加に役立ちましたか？'
  ),
  'the six fixed Polls retain their intended display order and wording'
);
SELECT ok(
  NOT EXISTS (
    SELECT 1
    FROM public.phase727_journal_club_poll_slots AS slot
    JOIN public.polls AS poll ON poll.id = slot.poll_id
    WHERE slot.lecture_session_id <> poll.lecture_session_id
  ),
  'Poll slots cannot cross lecture boundaries'
);

SELECT throws_ok(
  $$
    SELECT public.admin_register_pdf_document(
      production_id,
      'wrong-journal-club-document',
      '8c6903527b050c1db5f6b13b24bcf9108950bf8248a80205b10be6a9c63d7842',
      1,
      'Journal Club material',
      34,
      5816208,
      10000,
      '8c6903527b050c1db5f6b13b24bcf9108950bf8248a80205b10be6a9c63d7842',
      repeat('a', 64),
      true
    )
    FROM phase727_fixture
  $$,
  '22023',
  'PDF document does not match the Journal Club template',
  'a mismatched PDF document identifier is rejected by the DB binding'
);

SELECT lives_ok(
  $$
    SELECT public.admin_register_pdf_document(
      production_id,
      'journal-club-2026-07-23-v1',
      '8c6903527b050c1db5f6b13b24bcf9108950bf8248a80205b10be6a9c63d7842',
      1,
      '260723 JournalClub Presentation.pdf',
      34,
      5816208,
      10000,
      '8c6903527b050c1db5f6b13b24bcf9108950bf8248a80205b10be6a9c63d7842',
      repeat('a', 64),
      true
    )
    FROM phase727_fixture
  $$,
  'the exact production PDF descriptor can be registered'
);
SELECT lives_ok(
  $$
    SELECT public.admin_register_pdf_document(
      rehearsal_one_id,
      'journal-club-2026-07-23-v1',
      '8c6903527b050c1db5f6b13b24bcf9108950bf8248a80205b10be6a9c63d7842',
      1,
      '260723 JournalClub Presentation.pdf',
      34,
      5816208,
      10000,
      '8c6903527b050c1db5f6b13b24bcf9108950bf8248a80205b10be6a9c63d7842',
      repeat('b', 64),
      true
    )
    FROM phase727_fixture
  $$,
  'the exact rehearsal PDF descriptor can be registered independently'
);

SELECT throws_ok(
  $$
    SELECT public.admin_create_pdf_publication_v1(
      rehearsal_two_id,
      'journal-club-2026-07-23-v1',
      repeat('c', 64),
      5816208,
      34,
      10000,
      repeat('d', 64),
      '260723 JournalClub Presentation.pdf',
      true,
      'https://compass.example',
      '72700000-0000-4000-8000-000000000205',
      repeat('e', 64),
      repeat('f', 64),
      '72700000-0000-4000-8000-000000000001',
      '72700000-0000-4000-8000-000000000101'
    )
    FROM phase727_fixture
  $$,
  '22023',
  'PDF does not match the Journal Club template',
  'browser publication rejects a mismatched PDF SHA before upload'
);
UPDATE phase727_fixture
SET publication_result = public.admin_create_pdf_publication_v1(
  rehearsal_two_id,
  'journal-club-2026-07-23-v1',
  '8c6903527b050c1db5f6b13b24bcf9108950bf8248a80205b10be6a9c63d7842',
  5816208,
  34,
  10000,
  repeat('d', 64),
  '260723 JournalClub Presentation.pdf',
  true,
  'https://compass.example',
  '72700000-0000-4000-8000-000000000206',
  repeat('e', 64),
  repeat('f', 64),
  '72700000-0000-4000-8000-000000000001',
  '72700000-0000-4000-8000-000000000101'
);
SELECT is(
  (SELECT publication_result ->> 'state' FROM phase727_fixture),
  'pending',
  'the exact PDF descriptor may enter the existing browser publication saga'
);

SELECT ok(
  public.admin_set_lecture_status(
    (SELECT production_id FROM phase727_fixture),
    'start',
    null
  ),
  'production run starts only after explicit Admin action'
);
SELECT ok(
  public.admin_set_lecture_status(
    (SELECT production_id FROM phase727_fixture),
    'close',
    null
  ),
  'production run closes through the existing lifecycle'
);
SELECT ok(
  public.admin_set_lecture_status(
    (SELECT rehearsal_one_id FROM phase727_fixture),
    'start',
    null
  ),
  'first rehearsal starts independently after production closes'
);

-- Participant/comment base tables intentionally grant no direct service-role
-- writes. Seed the isolation fixture as the test owner, then return to the
-- same service-role surface exercised by the application.
RESET ROLE;
INSERT INTO public.participants (
  id,
  lecture_session_id,
  participant_key,
  auth_user_id
)
SELECT
  '72700000-0000-4000-8000-000000000301',
  rehearsal_one_id,
  'phase727-rehearsal-participant',
  '72700000-0000-4000-8000-000000000401'
FROM phase727_fixture;
INSERT INTO public.comments (
  lecture_session_id,
  participant_id,
  body
)
SELECT
  rehearsal_one_id,
  '72700000-0000-4000-8000-000000000301',
  'Rehearsal-only comment'
FROM phase727_fixture;
SELECT is(
  (SELECT count(*)::integer
   FROM public.comments AS comment, phase727_fixture AS fixture
   WHERE comment.lecture_session_id = fixture.rehearsal_two_id),
  0,
  'comments from one rehearsal do not enter another rehearsal'
);
SELECT is(
  (SELECT count(*)::integer
   FROM public.poll_responses AS response, phase727_fixture AS fixture
   WHERE response.lecture_session_id IN (
     fixture.production_id,
     fixture.rehearsal_two_id
   )),
  0,
  'production and untouched rehearsal start with no carried Poll responses'
);
SET LOCAL ROLE service_role;
SELECT throws_ok(
  $$
    SELECT public.admin_set_lecture_status(
      rehearsal_two_id,
      'start',
      null
    )
    FROM phase727_fixture
  $$,
  'P0001',
  'another Journal Club run is already open',
  'two Journal Club runs cannot be open simultaneously'
);
SELECT ok(
  public.admin_set_lecture_status(
    (SELECT rehearsal_one_id FROM phase727_fixture),
    'close',
    null
  ),
  'first rehearsal closes through the existing lifecycle'
);

UPDATE phase727_fixture
SET standard_id = public.admin_create_lecture_v2(
  'Unrelated standard lecture',
  encode(
    extensions.digest(convert_to('727090', 'UTF8'), 'sha256'),
    'hex'
  ),
  '727090',
  null,
  null
);
SELECT lives_ok(
  $$
    SELECT public.admin_register_pdf_document(
      standard_id,
      'standard-material',
      repeat('9', 64),
      1,
      'Standard material.pdf',
      3,
      3000,
      300,
      repeat('9', 64),
      repeat('8', 64),
      true
    )
    FROM phase727_fixture
  $$,
  'an unrelated lecture still accepts its own PDF descriptor'
);
SELECT ok(
  public.admin_set_lecture_status(
    (SELECT standard_id FROM phase727_fixture),
    'start',
    null
  ),
  'unrelated standard lecture still starts normally'
);
SELECT ok(
  public.admin_set_lecture_status(
    (SELECT standard_id FROM phase727_fixture),
    'close',
    null
  ),
  'unrelated standard lecture still closes normally'
);

SELECT ok(
  (SELECT document.archive_expires_at IS NULL
          AND document.delete_after IS NULL
   FROM public.lecture_pdf_documents AS document,
     phase727_fixture AS fixture
   WHERE document.lecture_session_id = fixture.production_id
     AND document.visible),
  'production PDF is exempted from the normal 30-day object deletion window'
);
SELECT ok(
  (SELECT document.archive_expires_at = lecture.archive_expires_at
          AND document.delete_after = lecture.archive_expires_at
            + interval '7 days'
   FROM public.lecture_pdf_documents AS document
   JOIN public.lecture_sessions AS lecture
     ON lecture.id = document.lecture_session_id
   CROSS JOIN phase727_fixture AS fixture
   WHERE document.lecture_session_id = fixture.rehearsal_one_id
     AND document.visible),
  'rehearsal PDF retains the existing 30-day plus cleanup lifecycle'
);
SELECT ok(
  (SELECT document.archive_expires_at = lecture.archive_expires_at
          AND document.delete_after = lecture.archive_expires_at
            + interval '7 days'
   FROM public.lecture_pdf_documents AS document
   JOIN public.lecture_sessions AS lecture
     ON lecture.id = document.lecture_session_id
   CROSS JOIN phase727_fixture AS fixture
   WHERE document.lecture_session_id = fixture.standard_id
     AND document.visible),
  'standard lecture PDF retention remains unchanged'
);
SELECT ok(
  (SELECT archive_expires_at = closed_at + interval '30 days'
   FROM public.lecture_sessions AS lecture, phase727_fixture AS fixture
   WHERE lecture.id = fixture.production_id),
  'production DB lifecycle remains on the existing recoverable 30-day window'
);

SELECT is(
  (SELECT private.build_public_lecture_archive_v4(production_id)
      #>> '{archive_policy,mode}'
   FROM phase727_fixture),
  'permanent',
  'production archive receives the exact permanent mode marker'
);
SELECT is(
  (SELECT private.build_public_lecture_archive_v4(production_id)
      #>> '{archive_policy,policy_id}'
   FROM phase727_fixture),
  'phase7-27-journal-club-2026-07-23-v1',
  'production archive receives the fixed permanent policy identifier'
);
SELECT ok(
  (SELECT NOT (
     private.build_public_lecture_archive_v4(rehearsal_one_id)
       ? 'archive_policy'
   )
   FROM phase727_fixture),
  'rehearsal archive receives no permanent retention marker'
);
SELECT ok(
  (SELECT NOT (
     private.build_public_lecture_archive_v4(standard_id)
       ? 'archive_policy'
   )
   FROM phase727_fixture),
  'unrelated standard archive remains unchanged'
);
SELECT ok(
  (SELECT jsonb_array_length(
     private.build_public_lecture_archive_v4(production_id) -> 'summaries'
   ) <= 18
   FROM phase727_fixture),
  'production archive applies the bounded eighteen-window summary limit'
);

RESET ROLE;
SELECT * FROM finish();
ROLLBACK;
