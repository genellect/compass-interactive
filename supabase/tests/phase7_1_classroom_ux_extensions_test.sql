BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path = public, extensions;
SELECT no_plan();

SELECT has_column('public', 'lecture_ai_control', 'summary_language', 'AI control has summary language');
SELECT col_default_is('public', 'lecture_ai_control', 'summary_language', 'auto', 'summary language defaults to auto');
SELECT has_column('public', 'lecture_summary_windows', 'requested_language', 'summary window snapshots requested language');
SELECT has_column('public', 'lecture_summary_windows', 'resolved_language', 'summary window records resolved language');
SELECT has_column('public', 'lecture_summary_windows', 'language_reason', 'summary window records resolution reason');
SELECT ok(
  to_regclass('public.comments_lecture_participant_history_idx') IS NOT NULL,
  'own-comment cursor lookup has a bounded partial index'
);
SELECT ok(
  NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename IN ('lecture_ai_control', 'lecture_summary_windows', 'comments')
  ),
  'Phase 7.1 adds no Realtime fanout'
);
SELECT ok(
  NOT (SELECT prosecdef FROM pg_proc WHERE oid =
    'public.get_lecture_comment_history_v3(uuid,timestamptz,uuid,integer,text)'::regprocedure),
  'public own-comment RPC is SECURITY INVOKER'
);
SELECT ok(
  (SELECT prosecdef AND proconfig @> ARRAY['search_path=""']
   FROM pg_proc WHERE oid =
    'private.get_lecture_comment_history_v3(uuid,timestamptz,uuid,integer,text)'::regprocedure),
  'private ownership primitive is fixed-path SECURITY DEFINER code'
);
SELECT ok(
  has_function_privilege(
    'authenticated',
    'public.get_lecture_comment_history_v3(uuid,timestamptz,uuid,integer,text)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'anon',
    'public.get_lecture_comment_history_v3(uuid,timestamptz,uuid,integer,text)',
    'EXECUTE'
  ),
  'only authenticated browser clients can call comment history v3'
);
SELECT ok(
  NOT has_function_privilege(
    'authenticated',
    'public.admin_set_lecture_summary_language(uuid,text,text)',
    'EXECUTE'
  )
  AND has_function_privilege(
    'service_role',
    'public.admin_set_lecture_summary_language(uuid,text,text)',
    'EXECUTE'
  ),
  'summary language configuration remains service-role only'
);
SELECT ok(
  NOT has_function_privilege(
    'authenticated',
    'public.admin_record_summary_window_language(uuid,uuid,text,text,text)',
    'EXECUTE'
  ),
  'students cannot forge resolved summary language metadata'
);

CREATE TEMP TABLE phase71_fixture (
  lecture_id uuid,
  closed_lecture_id uuid,
  run_id uuid,
  window_auto uuid,
  window_ja uuid,
  window_en uuid,
  participant_a uuid,
  participant_b uuid,
  result jsonb
);
GRANT SELECT, INSERT, UPDATE ON phase71_fixture TO service_role, authenticated;
INSERT INTO phase71_fixture DEFAULT VALUES;

SET LOCAL ROLE service_role;
UPDATE phase71_fixture SET
  lecture_id = public.admin_create_lecture(
    'Phase 7.1 classroom extensions',
    encode(extensions.digest(convert_to('710001', 'UTF8'), 'sha256'), 'hex'),
    '710001', null, null
  ),
  closed_lecture_id = public.admin_create_lecture(
    'Phase 7.1 closed lecture',
    encode(extensions.digest(convert_to('710002', 'UTF8'), 'sha256'), 'hex'),
    '710002', null, null
  );
SELECT ok(
  public.admin_set_lecture_status((SELECT lecture_id FROM phase71_fixture), 'start', null),
  'Phase 7.1 fixture lecture starts'
);
SELECT ok(
  public.admin_set_lecture_status((SELECT closed_lecture_id FROM phase71_fixture), 'start', null)
  AND public.admin_set_lecture_status((SELECT closed_lecture_id FROM phase71_fixture), 'close', null),
  'closed fixture reaches the canonical terminal state'
);
SELECT is(
  (SELECT summary_language FROM public.lecture_ai_control AS control, phase71_fixture AS fixture
   WHERE control.lecture_session_id = fixture.lecture_id),
  'auto',
  'new lecture AI control starts in automatic language mode'
);

WITH inserted AS (
  INSERT INTO public.lecture_summary_runs (
    lecture_session_id, actor_id, token_hash, expires_at
  )
  SELECT lecture_id, 'admin-session:phase71', repeat('9', 64), statement_timestamp() + interval '90 minutes'
  FROM phase71_fixture
  RETURNING id
)
UPDATE phase71_fixture SET run_id = (SELECT id FROM inserted);

WITH inserted AS (
  INSERT INTO public.lecture_summary_windows (
    lecture_session_id, run_id, window_index, window_start, window_end,
    prompt_version, status
  )
  SELECT lecture_id, run_id, 1, statement_timestamp() - interval '15 minutes',
    statement_timestamp() - interval '10 minutes', 'phase6-summary-v1', 'skipped'
  FROM phase71_fixture
  RETURNING id
)
UPDATE phase71_fixture SET window_auto = (SELECT id FROM inserted);
SELECT is(
  (SELECT requested_language FROM public.lecture_summary_windows AS summary_window, phase71_fixture AS fixture
   WHERE summary_window.id = fixture.window_auto),
  'auto',
  'first window atomically snapshots auto'
);

SELECT lives_ok(
  $$SELECT public.admin_set_lecture_summary_language(
    (SELECT lecture_id FROM phase71_fixture), 'ja', 'admin-session:phase71'
  )$$,
  'teacher changes future summary windows to Japanese'
);
WITH inserted AS (
  INSERT INTO public.lecture_summary_windows (
    lecture_session_id, run_id, window_index, window_start, window_end,
    prompt_version, status
  )
  SELECT lecture_id, run_id, 2, statement_timestamp() - interval '10 minutes',
    statement_timestamp() - interval '5 minutes', 'phase6-summary-v1', 'skipped'
  FROM phase71_fixture
  RETURNING id
)
UPDATE phase71_fixture SET window_ja = (SELECT id FROM inserted);
SELECT is(
  (SELECT requested_language FROM public.lecture_summary_windows AS summary_window, phase71_fixture AS fixture
   WHERE summary_window.id = fixture.window_ja),
  'ja',
  'next inserted window snapshots Japanese'
);
SELECT is(
  (SELECT requested_language FROM public.lecture_summary_windows AS summary_window, phase71_fixture AS fixture
   WHERE summary_window.id = fixture.window_auto),
  'auto',
  'language change never rewrites a previous window'
);

UPDATE phase71_fixture SET result = public.admin_record_summary_window_language(
  window_ja, run_id, 'admin-session:phase71', 'ja', 'manual_ja'
);
SELECT is((SELECT result ->> 'accepted' FROM phase71_fixture), 'true', 'manual resolution is recorded');
SELECT is((SELECT result ->> 'idempotent_replay' FROM phase71_fixture), 'false', 'first language record is not a replay');
UPDATE phase71_fixture SET result = public.admin_record_summary_window_language(
  window_ja, run_id, 'admin-session:phase71', 'ja', 'manual_ja'
);
SELECT is((SELECT result ->> 'idempotent_replay' FROM phase71_fixture), 'true', 'same language record replays idempotently');
SELECT throws_ok(
  $$SELECT public.admin_record_summary_window_language(
    (SELECT window_ja FROM phase71_fixture), (SELECT run_id FROM phase71_fixture),
    'admin-session:phase71', 'en', 'manual_en'
  )$$,
  '22023', null,
  'manual requested language cannot resolve to a different language'
);
SELECT throws_ok(
  $$SELECT public.admin_record_summary_window_language(
    (SELECT window_ja FROM phase71_fixture), (SELECT run_id FROM phase71_fixture),
    'admin-session:other', 'ja', 'manual_ja'
  )$$,
  'P0002', null,
  'a different Admin actor cannot record another run language'
);

SELECT public.admin_set_lecture_summary_language(
  (SELECT lecture_id FROM phase71_fixture), 'en', 'admin-session:phase71'
);
WITH inserted AS (
  INSERT INTO public.lecture_summary_windows (
    lecture_session_id, run_id, window_index, window_start, window_end,
    prompt_version, status
  )
  SELECT lecture_id, run_id, 3, statement_timestamp() - interval '5 minutes',
    statement_timestamp(), 'phase6-summary-v1', 'skipped'
  FROM phase71_fixture
  RETURNING id
)
UPDATE phase71_fixture SET window_en = (SELECT id FROM inserted);
SELECT is(
  (SELECT requested_language FROM public.lecture_summary_windows AS summary_window, phase71_fixture AS fixture
   WHERE summary_window.id = fixture.window_en),
  'en',
  'later configuration affects only the later window'
);
SELECT throws_ok(
  $$SELECT public.admin_set_lecture_summary_language(
    (SELECT closed_lecture_id FROM phase71_fixture), 'ja', 'admin-session:phase71'
  )$$,
  'P0001', null,
  'closed lecture rejects AI language changes'
);

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '47100000-0000-4000-8000-000000000001', true);
UPDATE phase71_fixture SET participant_a = (
  SELECT participant_id FROM public.join_lecture_by_code('710001')
);
SELECT set_config('request.jwt.claim.sub', '47100000-0000-4000-8000-000000000002', true);
UPDATE phase71_fixture SET participant_b = (
  SELECT participant_id FROM public.join_lecture_by_code('710001')
);
RESET ROLE;

INSERT INTO public.comments (lecture_session_id, participant_id, body, created_at, updated_at)
SELECT fixture.lecture_id, fixture.participant_a, 'Student A comment ' || item,
  statement_timestamp() - make_interval(secs => 10 - item),
  statement_timestamp() - make_interval(secs => 10 - item)
FROM phase71_fixture AS fixture CROSS JOIN generate_series(1, 3) AS item;
INSERT INTO public.comments (lecture_session_id, participant_id, body, created_at, updated_at)
SELECT fixture.lecture_id, fixture.participant_b, 'Student B comment ' || item,
  statement_timestamp() - make_interval(secs => 20 - item),
  statement_timestamp() - make_interval(secs => 20 - item)
FROM phase71_fixture AS fixture CROSS JOIN generate_series(1, 2) AS item;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '47100000-0000-4000-8000-000000000001', true);
UPDATE phase71_fixture SET result = public.get_lecture_comment_history_v3(
  lecture_id, null, null, 2, 'mine'
);
SELECT is(jsonb_array_length((SELECT result -> 'items' FROM phase71_fixture)), 2, 'own history returns the requested first page');
SELECT is((SELECT result ->> 'has_older' FROM phase71_fixture), 'true', 'own history exposes a bounded older cursor');
SELECT ok(
  NOT EXISTS (
    SELECT 1 FROM phase71_fixture AS fixture,
      jsonb_array_elements(fixture.result -> 'items') AS item(value)
    WHERE item.value ->> 'body' NOT LIKE 'Student A comment %'
  ),
  'student A receives only student A comments'
);
SELECT ok(
  NOT EXISTS (
    SELECT 1 FROM phase71_fixture AS fixture,
      jsonb_array_elements(fixture.result -> 'items') AS item(value)
    WHERE item.value ? 'participant_id'
  ),
  'own history does not disclose participant identifiers'
);
UPDATE phase71_fixture SET result = public.get_lecture_comment_history_v3(
  lecture_id,
  (result #>> '{items,1,created_at}')::timestamptz,
  (result #>> '{items,1,id}')::uuid,
  2,
  'mine'
);
SELECT is(jsonb_array_length((SELECT result -> 'items' FROM phase71_fixture)), 1, 'own cursor loads the remaining comment without overlap');
SELECT is((SELECT result ->> 'has_older' FROM phase71_fixture), 'false', 'own cursor reaches a stable end');

SELECT set_config('request.jwt.claim.sub', '47100000-0000-4000-8000-000000000002', true);
UPDATE phase71_fixture SET result = public.get_lecture_comment_history_v3(
  lecture_id, null, null, 50, 'mine'
);
SELECT is(jsonb_array_length((SELECT result -> 'items' FROM phase71_fixture)), 2, 'student B sees exactly student B comments');
SELECT ok(
  NOT EXISTS (
    SELECT 1 FROM phase71_fixture AS fixture,
      jsonb_array_elements(fixture.result -> 'items') AS item(value)
    WHERE item.value ->> 'body' NOT LIKE 'Student B comment %'
  ),
  'student B cannot observe student A through mine scope'
);
UPDATE phase71_fixture SET result = public.get_lecture_comment_history_v3(
  lecture_id, null, null, 50, 'all'
);
SELECT is(jsonb_array_length((SELECT result -> 'items' FROM phase71_fixture)), 5, 'all scope preserves the shared history contract');

SELECT set_config('request.jwt.claim.sub', '47100000-0000-4000-8000-000000000003', true);
SELECT is(
  public.get_lecture_comment_history_v3(
    (SELECT lecture_id FROM phase71_fixture), null, null, 50, 'mine'
  ),
  null,
  'unrelated authenticated user has no own-comment history'
);
SELECT throws_ok(
  $$SELECT public.get_lecture_comment_history_v3(
    (SELECT lecture_id FROM phase71_fixture), null, null, 50, 'invalid'
  )$$,
  '22023', null,
  'invalid history scope fails closed'
);

RESET ROLE;
SELECT * FROM finish();
ROLLBACK;
