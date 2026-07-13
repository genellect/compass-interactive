BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path = public, extensions;
SELECT plan(22);

SELECT has_table('public', 'lecture_live_state', 'live-state table exists');
SELECT has_table('public', 'comment_like_totals', 'comment aggregate exists');
SELECT has_table('public', 'poll_option_totals', 'poll aggregate exists');
SELECT ok(
  (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.lecture_live_state'::regclass),
  'live-state table has RLS enabled'
);
SELECT ok(
  (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.comment_like_totals'::regclass),
  'comment aggregate has RLS enabled'
);
SELECT ok(
  (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.poll_option_totals'::regclass),
  'poll aggregate has RLS enabled'
);
SELECT ok(
  to_regprocedure(
    'public.get_lecture_live_snapshot(uuid,bigint,bigint,bigint,bigint,bigint,timestamptz,uuid,integer)'
  ) IS NOT NULL,
  'versioned snapshot RPC exists'
);
SELECT ok(
  NOT has_function_privilege(
    'anon',
    'private.bump_lecture_live_state(uuid,text)',
    'EXECUTE'
  ),
  'anonymous clients cannot execute internal version function'
);
SELECT ok(
  has_function_privilege(
    'authenticated',
    'public.get_lecture_live_snapshot(uuid,bigint,bigint,bigint,bigint,bigint,timestamptz,uuid,integer)',
    'EXECUTE'
  ),
  'authenticated clients can execute snapshot RPC'
);
SELECT ok(
  NOT has_table_privilege('anon', 'public.lecture_live_state', 'SELECT'),
  'anonymous clients cannot read raw live state'
);

INSERT INTO public.lecture_sessions (
  id, title, code_hash, status, starts_at, ends_at
) VALUES (
  '11000000-0000-4000-8000-000000000001',
  'Live-state integration lecture',
  encode(extensions.digest(convert_to('LIVE2', 'UTF8'), 'sha256'), 'hex'),
  'open',
  now() - interval '5 minutes',
  now() + interval '1 hour'
);

INSERT INTO public.polls (
  id, lecture_session_id, question, type, status
) VALUES (
  '21000000-0000-4000-8000-000000000001',
  '11000000-0000-4000-8000-000000000001',
  'Integrated poll?',
  'single',
  'open'
);

INSERT INTO public.poll_options (
  id, lecture_session_id, poll_id, label, display_order
) VALUES (
  '31000000-0000-4000-8000-000000000001',
  '11000000-0000-4000-8000-000000000001',
  '21000000-0000-4000-8000-000000000001',
  'Yes',
  1
);

INSERT INTO public.lecture_display_state (
  lecture_session_id, current_pdf_page, display_mode
) VALUES (
  '11000000-0000-4000-8000-000000000001',
  3,
  'presentation'
);

SET LOCAL ROLE authenticated;
SELECT set_config(
  'request.jwt.claim.sub',
  '41000000-0000-4000-8000-000000000001',
  true
);

SELECT is(
  (
    SELECT count(*)::integer
    FROM public.join_lecture_by_code('LIVE2')
  ),
  1,
  'join RPC creates the Auth-owned participant'
);

SELECT lives_ok(
  $$
    INSERT INTO public.comments (
      id, lecture_session_id, participant_id, body, created_at
    ) VALUES (
      '51000000-0000-4000-8000-000000000001',
      '11000000-0000-4000-8000-000000000001',
      (
        SELECT id
        FROM public.participants
        WHERE auth_user_id = auth.uid()
          AND lecture_session_id = '11000000-0000-4000-8000-000000000001'
      ),
      'First live comment',
      '2026-07-11 00:00:00+00'
    )
  $$,
  'comment insert passes RLS and version trigger'
);

SELECT lives_ok(
  $$
    INSERT INTO public.comment_likes (
      lecture_session_id, comment_id, participant_id
    ) VALUES (
      '11000000-0000-4000-8000-000000000001',
      '51000000-0000-4000-8000-000000000001',
      (
        SELECT id
        FROM public.participants
        WHERE auth_user_id = auth.uid()
          AND lecture_session_id = '11000000-0000-4000-8000-000000000001'
      )
    )
  $$,
  'like insert passes RLS and aggregate trigger'
);

SELECT lives_ok(
  $$
    INSERT INTO public.poll_responses (
      lecture_session_id, poll_id, participant_id, option_ids
    ) VALUES (
      '11000000-0000-4000-8000-000000000001',
      '21000000-0000-4000-8000-000000000001',
      (
        SELECT id
        FROM public.participants
        WHERE auth_user_id = auth.uid()
          AND lecture_session_id = '11000000-0000-4000-8000-000000000001'
      ),
      ARRAY['31000000-0000-4000-8000-000000000001'::uuid]
    )
  $$,
  'poll response passes RLS and aggregate trigger'
);

SELECT is(
  (
    public.get_lecture_live_snapshot(
      '11000000-0000-4000-8000-000000000001'
    ) #>> '{comments,items,0,body}'
  ),
  'First live comment',
  'initial snapshot contains comments'
);
SELECT is(
  (
    public.get_lecture_live_snapshot(
      '11000000-0000-4000-8000-000000000001'
    ) #>> '{like_totals,0,like_count}'
  )::integer,
  1,
  'snapshot reads pre-aggregated like count'
);
SELECT is(
  (
    public.get_lecture_live_snapshot(
      '11000000-0000-4000-8000-000000000001'
    ) #>> '{polls,0,options,0,response_count}'
  )::integer,
  1,
  'snapshot reads pre-aggregated poll count'
);
SELECT is(
  (
    public.get_lecture_live_snapshot(
      '11000000-0000-4000-8000-000000000001'
    ) #>> '{display,current_pdf_page}'
  )::integer,
  3,
  'legacy display writes are mirrored into live state'
);

RESET ROLE;
CREATE TEMP TABLE first_snapshot AS
SELECT public.get_lecture_live_snapshot(
  '11000000-0000-4000-8000-000000000001'
) AS payload;
GRANT SELECT ON first_snapshot TO authenticated;
SET LOCAL ROLE authenticated;

SELECT ok(
  (
    SELECT next.payload->'comments' = 'null'::jsonb
      AND next.payload->'like_totals' = 'null'::jsonb
      AND next.payload->'polls' = 'null'::jsonb
      AND next.payload->'display' = 'null'::jsonb
    FROM first_snapshot first
    CROSS JOIN LATERAL (
      SELECT public.get_lecture_live_snapshot(
        '11000000-0000-4000-8000-000000000001',
        (first.payload #>> '{versions,state}')::bigint,
        (first.payload #>> '{versions,comments}')::bigint,
        (first.payload #>> '{versions,likes}')::bigint,
        (first.payload #>> '{versions,polls}')::bigint,
        (first.payload #>> '{versions,display}')::bigint
      ) AS payload
    ) next
  ),
  'unchanged versions omit all heavy snapshot sections'
);

SELECT lives_ok(
  $$
    INSERT INTO public.comments (
      id, lecture_session_id, participant_id, body, created_at
    ) VALUES (
      '51000000-0000-4000-8000-000000000002',
      '11000000-0000-4000-8000-000000000001',
      (
        SELECT id
        FROM public.participants
        WHERE auth_user_id = auth.uid()
          AND lecture_session_id = '11000000-0000-4000-8000-000000000001'
      ),
      'Recovered after reconnect',
      '2026-07-11 00:00:01+00'
    )
  $$,
  'a comment can arrive while Realtime is disconnected'
);

SELECT is(
  (
    SELECT next.payload #>> '{comments,items,0,body}'
    FROM first_snapshot first
    CROSS JOIN LATERAL (
      SELECT public.get_lecture_live_snapshot(
        '11000000-0000-4000-8000-000000000001',
        (first.payload #>> '{versions,state}')::bigint,
        (first.payload #>> '{versions,comments}')::bigint,
        (first.payload #>> '{versions,likes}')::bigint,
        (first.payload #>> '{versions,polls}')::bigint,
        (first.payload #>> '{versions,display}')::bigint,
        '2026-07-11 00:00:00+00',
        '51000000-0000-4000-8000-000000000001',
        100
      ) AS payload
    ) next
  ),
  'Recovered after reconnect',
  'cursor delta recovers a missed Realtime comment'
);

SELECT ok(
  (
    SELECT comments > 0
      AND likes > 0
      AND polls > 0
      AND display > 0
    FROM public.get_lecture_live_snapshot(
      '11000000-0000-4000-8000-000000000001'
    ) snapshot,
    LATERAL jsonb_to_record(snapshot->'versions') AS versions(
      comments bigint,
      likes bigint,
      polls bigint,
      display bigint
    )
  ),
  'all section versions advance after writes'
);

SELECT * FROM finish();
ROLLBACK;
