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
  6,
  'Phase 0 keeps only the current least-privilege policy set'
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
    SELECT count(*)::integer
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public'
  ),
  0,
  'student tables are removed from the Realtime publication'
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

SELECT ok(
  NOT has_function_privilege(
    'anon',
    'public.join_lecture_by_code(text)',
    'EXECUTE'
  ),
  'unauthenticated clients cannot join a lecture'
);

RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config(
  'request.jwt.claim.sub',
  '40000000-0000-4000-8000-000000000001',
  true
);

SELECT is(
  (SELECT count(*)::integer FROM public.join_lecture_by_code('SMOKE')),
  1,
  'authenticated join creates one server-owned participant'
);

SELECT lives_ok(
  $$
    INSERT INTO public.comments (
      id, lecture_session_id, participant_id, body
    ) VALUES (
      '50000000-0000-4000-8000-000000000001',
      '10000000-0000-4000-8000-000000000001',
      (
        SELECT id
        FROM public.participants
        WHERE auth_user_id = auth.uid()
          AND lecture_session_id = '10000000-0000-4000-8000-000000000001'
      ),
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
      (
        SELECT id
        FROM public.participants
        WHERE auth_user_id = auth.uid()
          AND lecture_session_id = '10000000-0000-4000-8000-000000000001'
      )
    )
  $$,
  'comment-like RLS accepts a valid like'
);

SELECT ok(
  NOT has_table_privilege(
    'authenticated',
    'public.comment_likes',
    'SELECT'
  ),
  'raw comment likes are not readable'
);

SELECT lives_ok(
  $$
    INSERT INTO public.poll_responses (
      lecture_session_id, poll_id, participant_id, option_ids
    ) VALUES (
      '10000000-0000-4000-8000-000000000001',
      '20000000-0000-4000-8000-000000000001',
      (
        SELECT id
        FROM public.participants
        WHERE auth_user_id = auth.uid()
          AND lecture_session_id = '10000000-0000-4000-8000-000000000001'
      ),
      ARRAY['30000000-0000-4000-8000-000000000001'::uuid]
    )
  $$,
  'poll response RLS and option trigger accept a valid answer'
);

SELECT is(
  (
    public.get_lecture_live_snapshot(
      '10000000-0000-4000-8000-000000000001'
    ) #>> '{polls,0,options,0,response_count}'
  )::integer,
  1,
  'snapshot returns the aggregate poll count'
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
