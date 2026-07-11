BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path = public, extensions;
SELECT plan(19);

SELECT is(
  (
    SELECT count(*)::integer
    FROM pg_tables
    WHERE schemaname = 'public'
      AND tablename IN (
        'lecture_sessions',
        'participants',
        'comments',
        'comment_likes',
        'polls',
        'poll_options',
        'poll_responses',
        'lecture_display_state',
        'poll_result_refresh_events',
        'lecture_admin_codes'
      )
  ),
  10,
  'baseline creates all ten application tables'
);

SELECT is(
  (
    SELECT count(*)::integer
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname IN (
        'lecture_sessions', 'participants', 'comments', 'comment_likes',
        'polls', 'poll_options', 'poll_responses', 'lecture_display_state',
        'poll_result_refresh_events', 'lecture_admin_codes'
      )
      AND c.relrowsecurity
  ),
  10,
  'RLS is enabled on every application table'
);

SELECT is(
  (SELECT count(*)::integer FROM pg_policies WHERE schemaname = 'public'),
  10,
  'baseline creates the remote policy set'
);

SELECT ok(
  to_regprocedure('public.join_lecture_by_code(text)') IS NOT NULL,
  'join_lecture_by_code is available'
);
SELECT ok(
  to_regprocedure('public.get_lecture_session_state(uuid)') IS NOT NULL,
  'get_lecture_session_state is available'
);
SELECT ok(
  to_regprocedure('public.get_open_poll_results(uuid)') IS NOT NULL,
  'get_open_poll_results is available'
);
SELECT is(
  (
    SELECT array_agg(tablename ORDER BY tablename)::text
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public'
  ),
  ARRAY['comments']::text,
  'Realtime publication contains comments only'
);

INSERT INTO public.lecture_sessions (
  id, title, code_hash, status, starts_at, ends_at
)
VALUES (
  '10000000-0000-4000-8000-000000000001',
  'Baseline smoke lecture',
  encode(extensions.digest(convert_to('SMOKE', 'UTF8'), 'sha256'), 'hex'),
  'open',
  now() - interval '5 minutes',
  now() + interval '1 hour'
);

INSERT INTO public.polls (
  id, lecture_session_id, question, type, status
)
VALUES (
  '20000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001',
  'Smoke poll?',
  'single',
  'open'
);

INSERT INTO public.poll_options (
  id, lecture_session_id, poll_id, label, display_order
)
VALUES (
  '30000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000001',
  'Yes',
  1
);

SET LOCAL ROLE anon;

SELECT is(
  (SELECT count(*)::integer FROM public.join_lecture_by_code('SMOKE')),
  1,
  'anonymous client can join an open lecture by code'
);

SELECT lives_ok(
  $$
    INSERT INTO public.participants (
      id, lecture_session_id, participant_key
    ) VALUES (
      '40000000-0000-4000-8000-000000000001',
      '10000000-0000-4000-8000-000000000001',
      'smoke-participant-key'
    )
  $$,
  'participant RLS accepts a join for an open lecture'
);

SELECT lives_ok(
  $$
    INSERT INTO public.comments (
      id, lecture_session_id, participant_id, body
    ) VALUES (
      '50000000-0000-4000-8000-000000000001',
      '10000000-0000-4000-8000-000000000001',
      '40000000-0000-4000-8000-000000000001',
      'Smoke comment'
    )
  $$,
  'comment RLS accepts a visible comment'
);

SELECT is(
  (
    SELECT count(*)::integer
    FROM public.comments
    WHERE lecture_session_id = '10000000-0000-4000-8000-000000000001'
  ),
  1,
  'visible comments can be read'
);

SELECT lives_ok(
  $$
    INSERT INTO public.comment_likes (
      lecture_session_id, comment_id, participant_id
    ) VALUES (
      '10000000-0000-4000-8000-000000000001',
      '50000000-0000-4000-8000-000000000001',
      '40000000-0000-4000-8000-000000000001'
    )
  $$,
  'comment-like RLS accepts a valid like'
);

SELECT is(
  (
    SELECT count(*)::integer
    FROM public.comment_likes
    WHERE comment_id = '50000000-0000-4000-8000-000000000001'
  ),
  1,
  'comment likes can be read for a visible comment'
);

SELECT lives_ok(
  $$
    INSERT INTO public.poll_responses (
      lecture_session_id, poll_id, participant_id, option_ids
    ) VALUES (
      '10000000-0000-4000-8000-000000000001',
      '20000000-0000-4000-8000-000000000001',
      '40000000-0000-4000-8000-000000000001',
      ARRAY['30000000-0000-4000-8000-000000000001'::uuid]
    )
  $$,
  'poll response RLS and option trigger accept a valid answer'
);

SELECT is(
  (
    SELECT response_count::integer
    FROM public.get_open_poll_results(
      '10000000-0000-4000-8000-000000000001'
    )
    WHERE option_id = '30000000-0000-4000-8000-000000000001'
  ),
  1,
  'poll results RPC returns the aggregate count'
);

SELECT is(
  (
    SELECT status
    FROM public.get_lecture_session_state(
      '10000000-0000-4000-8000-000000000001'
    )
  ),
  'open',
  'lecture state RPC returns the current status'
);

SELECT ok(
  NOT has_table_privilege('anon', 'public.lecture_sessions', 'SELECT'),
  'lecture_sessions remains closed to anonymous SELECT'
);
SELECT ok(
  NOT has_table_privilege('anon', 'public.lecture_admin_codes', 'SELECT'),
  'lecture_admin_codes remains service-role only'
);
SELECT ok(
  NOT has_table_privilege('anon', 'public.poll_responses', 'SELECT'),
  'raw poll responses remain unreadable'
);

SELECT * FROM finish();
ROLLBACK;
