BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path = public, extensions;
SELECT plan(34);

SELECT ok(
  to_regprocedure('public.admin_create_lecture(text,text,text,timestamptz,timestamptz)') IS NOT NULL,
  'atomic lecture creation routine exists'
);
SELECT ok(
  to_regprocedure('public.admin_set_lecture_status(uuid,text,timestamptz)') IS NOT NULL,
  'lecture transition routine exists'
);
SELECT ok(
  to_regprocedure('public.admin_create_poll(uuid,text,text,text[])') IS NOT NULL,
  'atomic poll creation routine exists'
);
SELECT ok(
  to_regprocedure('public.admin_set_poll_status(uuid,uuid,text)') IS NOT NULL,
  'poll transition routine exists'
);

SELECT ok(
  NOT has_function_privilege(
    'anon',
    'public.admin_create_lecture(text,text,text,timestamptz,timestamptz)',
    'EXECUTE'
  ),
  'anonymous clients cannot create lectures'
);
SELECT ok(
  NOT has_function_privilege(
    'anon',
    'public.admin_set_lecture_status(uuid,text,timestamptz)',
    'EXECUTE'
  ),
  'anonymous clients cannot transition lectures'
);
SELECT ok(
  NOT has_function_privilege(
    'anon',
    'public.admin_create_poll(uuid,text,text,text[])',
    'EXECUTE'
  ),
  'anonymous clients cannot create polls'
);
SELECT ok(
  NOT has_function_privilege(
    'anon',
    'public.admin_set_poll_status(uuid,uuid,text)',
    'EXECUTE'
  ),
  'anonymous clients cannot transition polls'
);

SELECT ok(
  has_function_privilege(
    'service_role',
    'public.admin_create_lecture(text,text,text,timestamptz,timestamptz)',
    'EXECUTE'
  ),
  'service role can create lectures'
);
SELECT ok(
  has_function_privilege(
    'service_role',
    'public.admin_set_lecture_status(uuid,text,timestamptz)',
    'EXECUTE'
  ),
  'service role can transition lectures'
);
SELECT ok(
  has_function_privilege(
    'service_role',
    'public.admin_create_poll(uuid,text,text,text[])',
    'EXECUTE'
  ),
  'service role can create polls'
);
SELECT ok(
  has_function_privilege(
    'service_role',
    'public.admin_set_poll_status(uuid,uuid,text)',
    'EXECUTE'
  ),
  'service role can transition polls'
);

CREATE TEMP TABLE m3_fixture (
  lecture_id uuid,
  poll_id uuid,
  participant_id uuid,
  option_id uuid
);
GRANT SELECT, INSERT, UPDATE ON m3_fixture TO service_role, authenticated;

SET LOCAL ROLE service_role;

SELECT lives_ok(
  $$
    INSERT INTO m3_fixture (lecture_id)
    SELECT public.admin_create_lecture(
      'Milestone 3 lecture',
      encode(extensions.digest(convert_to('M3-LIVE', 'UTF8'), 'sha256'), 'hex'),
      'M3-LIVE',
      null,
      null
    )
  $$,
  'service role atomically creates a lecture'
);
SELECT is(
  (SELECT status FROM public.lecture_sessions WHERE id = (SELECT lecture_id FROM m3_fixture)),
  'draft',
  'created lecture starts as draft'
);
SELECT is(
  (SELECT lecture_code FROM public.lecture_admin_codes WHERE lecture_session_id = (SELECT lecture_id FROM m3_fixture)),
  'M3-LIVE',
  'plain lecture code is stored for Admin only'
);
SELECT is(
  (SELECT count(*)::integer FROM public.lecture_live_state WHERE lecture_session_id = (SELECT lecture_id FROM m3_fixture)),
  1,
  'lecture creation initializes live state'
);
SELECT is(
  (SELECT count(*)::integer FROM public.lecture_display_state WHERE lecture_session_id = (SELECT lecture_id FROM m3_fixture)),
  1,
  'lecture creation initializes display compatibility state'
);
SELECT ok(
  public.admin_set_lecture_status(
    (SELECT lecture_id FROM m3_fixture),
    'start',
    '2026-07-11 01:00:00+00'
  ),
  'draft lecture can start'
);
SELECT is(
  (SELECT status FROM public.lecture_sessions WHERE id = (SELECT lecture_id FROM m3_fixture)),
  'open',
  'start transition opens lecture'
);
SELECT ok(
  (SELECT state_version > 0 FROM public.lecture_live_state WHERE lecture_session_id = (SELECT lecture_id FROM m3_fixture)),
  'lecture transition advances live-state version'
);
SELECT lives_ok(
  $$
    UPDATE m3_fixture
    SET poll_id = public.admin_create_poll(
      lecture_id,
      'Milestone 3 poll?',
      'single',
      ARRAY['Yes', 'No']
    )
  $$,
  'service role atomically creates a poll and its options'
);
SELECT is(
  (SELECT count(*)::integer FROM public.poll_options WHERE poll_id = (SELECT poll_id FROM m3_fixture)),
  2,
  'poll creation inserts ordered options'
);
SELECT is(
  (SELECT status FROM public.polls WHERE id = (SELECT poll_id FROM m3_fixture)),
  'draft',
  'created poll starts as draft'
);
SELECT ok(
  public.admin_set_poll_status(
    (SELECT lecture_id FROM m3_fixture),
    (SELECT poll_id FROM m3_fixture),
    'open'
  ),
  'poll can open while lecture is open'
);
SELECT is(
  (SELECT status FROM public.polls WHERE id = (SELECT poll_id FROM m3_fixture)),
  'open',
  'poll transition is persisted'
);
UPDATE m3_fixture
SET option_id = (
  SELECT id
  FROM public.poll_options
  WHERE poll_id = m3_fixture.poll_id
  ORDER BY display_order
  LIMIT 1
);
SELECT ok(
  NOT public.admin_set_poll_status(
    (SELECT lecture_id FROM m3_fixture),
    (SELECT poll_id FROM m3_fixture),
    'open'
  ),
  'repeating the same poll transition is rejected'
);

SET LOCAL ROLE authenticated;
SELECT set_config(
  'request.jwt.claim.sub',
  '43000000-0000-4000-8000-000000000001',
  true
);
SELECT lives_ok(
  $$
    UPDATE m3_fixture
    SET participant_id = (
      SELECT participant_id
      FROM public.join_lecture_by_code('M3-LIVE')
    )
  $$,
  'authenticated participant can join after Admin starts lecture'
);
SELECT lives_ok(
  $$
    INSERT INTO public.poll_responses (
      lecture_session_id,
      poll_id,
      participant_id,
      option_ids
    ) VALUES (
      (SELECT lecture_id FROM m3_fixture),
      (SELECT poll_id FROM m3_fixture),
      (SELECT participant_id FROM m3_fixture),
      ARRAY[(SELECT option_id FROM m3_fixture)]
    )
  $$,
  'student response succeeds for Admin-opened poll'
);
SELECT is(
  (
    public.get_lecture_live_snapshot(
      (SELECT lecture_id FROM m3_fixture)
    ) #>> '{polls,0,options,0,response_count}'
  )::integer,
  1,
  'snapshot exposes the trigger-maintained poll aggregate'
);

SET LOCAL ROLE service_role;
SELECT ok(
  public.admin_set_lecture_status(
    (SELECT lecture_id FROM m3_fixture),
    'close',
    '2026-07-11 02:00:00+00'
  ),
  'open lecture can close'
);
SELECT is(
  (SELECT status FROM public.lecture_sessions WHERE id = (SELECT lecture_id FROM m3_fixture)),
  'closed',
  'close transition is persisted'
);
SELECT is(
  (SELECT status FROM public.polls WHERE id = (SELECT poll_id FROM m3_fixture)),
  'closed',
  'closing lecture also closes open polls'
);
SELECT throws_ok(
  $$
    SELECT public.admin_create_poll(
      (SELECT lecture_id FROM m3_fixture),
      'Too late?',
      'single',
      ARRAY['Yes', 'No']
    )
  $$,
  'P0001',
  'lecture is not available for poll creation',
  'closed lecture rejects new polls'
);

SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $$
    INSERT INTO public.comments (
      lecture_session_id,
      participant_id,
      body
    ) VALUES (
      (SELECT lecture_id FROM m3_fixture),
      (SELECT participant_id FROM m3_fixture),
      'Comment after close'
    )
  $$,
  '42501',
  null,
  'closed lecture rejects student writes through RLS'
);

SELECT * FROM finish();
ROLLBACK;
