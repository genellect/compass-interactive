BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path = public, extensions;
SELECT plan(46);

SELECT has_column(
  'public', 'lecture_live_state', 'lecture_version',
  'live state has a lecture section version'
);
SELECT has_column(
  'public', 'lecture_live_state', 'caption_version',
  'live state has a caption section version'
);
SELECT has_column(
  'public', 'lecture_live_state', 'summaries_version',
  'live state has a summaries section version'
);
SELECT has_column(
  'public', 'lecture_live_state', 'pdf_version',
  'live state has a PDF section version'
);

SELECT ok(
  to_regprocedure(
    'public.get_lecture_public_snapshot_v2(uuid,bigint,bigint,bigint,bigint,bigint,bigint,bigint,timestamptz,uuid,integer)'
  ) IS NOT NULL,
  'shared Phase 1 snapshot RPC exists'
);
SELECT ok(
  to_regprocedure(
    'public.get_lecture_participant_state_v2(uuid)'
  ) IS NOT NULL,
  'participant-owned state RPC exists'
);
SELECT ok(
  to_regprocedure(
    'public.get_lecture_comment_history_v2(uuid,timestamptz,uuid,integer)'
  ) IS NOT NULL,
  'cursor history RPC exists'
);
SELECT ok(
  to_regprocedure(
    'public.get_lecture_live_snapshot(uuid,bigint,bigint,bigint,bigint,bigint,timestamptz,uuid,integer)'
  ) IS NOT NULL,
  'legacy snapshot remains during feature-flag migration'
);

SELECT ok(
  NOT has_function_privilege(
    'anon',
    'public.get_lecture_public_snapshot_v2(uuid,bigint,bigint,bigint,bigint,bigint,bigint,bigint,timestamptz,uuid,integer)',
    'EXECUTE'
  ),
  'unauthenticated anon cannot call the shared snapshot'
);
SELECT ok(
  NOT has_function_privilege(
    'anon',
    'public.get_lecture_participant_state_v2(uuid)',
    'EXECUTE'
  ),
  'unauthenticated anon cannot call participant state'
);
SELECT ok(
  NOT has_function_privilege(
    'anon',
    'public.get_lecture_comment_history_v2(uuid,timestamptz,uuid,integer)',
    'EXECUTE'
  ),
  'unauthenticated anon cannot call comment history'
);
SELECT ok(
  has_function_privilege(
    'authenticated',
    'public.get_lecture_public_snapshot_v2(uuid,bigint,bigint,bigint,bigint,bigint,bigint,bigint,timestamptz,uuid,integer)',
    'EXECUTE'
  ),
  'authenticated users can call the shared snapshot'
);
SELECT ok(
  has_function_privilege(
    'authenticated',
    'public.get_lecture_participant_state_v2(uuid)',
    'EXECUTE'
  ),
  'authenticated users can call participant state'
);
SELECT ok(
  has_function_privilege(
    'authenticated',
    'public.get_lecture_comment_history_v2(uuid,timestamptz,uuid,integer)',
    'EXECUTE'
  ),
  'authenticated users can call comment history'
);

SELECT ok(
  NOT (
    SELECT prosecdef
    FROM pg_proc
    WHERE oid =
      'public.get_lecture_public_snapshot_v2(uuid,bigint,bigint,bigint,bigint,bigint,bigint,bigint,timestamptz,uuid,integer)'::regprocedure
  ),
  'shared public wrapper is SECURITY INVOKER'
);
SELECT ok(
  NOT (
    SELECT prosecdef
    FROM pg_proc
    WHERE oid =
      'public.get_lecture_participant_state_v2(uuid)'::regprocedure
  ),
  'participant public wrapper is SECURITY INVOKER'
);
SELECT ok(
  NOT (
    SELECT prosecdef
    FROM pg_proc
    WHERE oid =
      'public.get_lecture_comment_history_v2(uuid,timestamptz,uuid,integer)'::regprocedure
  ),
  'history public wrapper is SECURITY INVOKER'
);
SELECT ok(
  (
    SELECT prosecdef AND proconfig IS NOT NULL
    FROM pg_proc
    WHERE oid =
      'private.get_lecture_public_snapshot_v2(uuid,bigint,bigint,bigint,bigint,bigint,bigint,bigint,timestamptz,uuid,integer)'::regprocedure
  ),
  'shared private implementation is fixed-path Definer code'
);
SELECT ok(
  (
    SELECT prosecdef AND proconfig IS NOT NULL
    FROM pg_proc
    WHERE oid =
      'private.get_lecture_participant_state_v2(uuid)'::regprocedure
  ),
  'participant private implementation is fixed-path Definer code'
);
SELECT ok(
  (
    SELECT prosecdef AND proconfig IS NOT NULL
    FROM pg_proc
    WHERE oid =
      'private.get_lecture_comment_history_v2(uuid,timestamptz,uuid,integer)'::regprocedure
  ),
  'history private implementation is fixed-path Definer code'
);
SELECT is(
  (
    SELECT count(*)::integer
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'comments'
  ),
  0,
  'comments stay outside the Realtime publication'
);

INSERT INTO public.lecture_sessions (
  id, title, code_hash, status, starts_at, ends_at
) VALUES (
  '13000000-0000-4000-8000-000000000001',
  'Phase 1 sync lecture',
  encode(extensions.digest(convert_to('P1SYNC', 'UTF8'), 'sha256'), 'hex'),
  'open',
  now() - interval '5 minutes',
  now() + interval '1 hour'
);

INSERT INTO public.polls (
  id, lecture_session_id, question, type, status
) VALUES (
  '23000000-0000-4000-8000-000000000001',
  '13000000-0000-4000-8000-000000000001',
  'Phase 1 ownership poll?',
  'single',
  'open'
);

INSERT INTO public.poll_options (
  id, lecture_session_id, poll_id, label, display_order
) VALUES (
  '33000000-0000-4000-8000-000000000001',
  '13000000-0000-4000-8000-000000000001',
  '23000000-0000-4000-8000-000000000001',
  'Yes',
  1
);

CREATE TEMP TABLE phase1_actor (
  actor text PRIMARY KEY,
  participant_id uuid NOT NULL
);
CREATE TEMP TABLE phase1_payload (
  label text PRIMARY KEY,
  payload jsonb NOT NULL
);
GRANT SELECT, INSERT, UPDATE ON phase1_actor TO authenticated;
GRANT SELECT, INSERT, UPDATE ON phase1_payload TO authenticated;

SET LOCAL ROLE authenticated;
SELECT set_config(
  'request.jwt.claim.sub',
  '43000000-0000-4000-8000-000000000001',
  true
);

SELECT is(
  (SELECT count(*)::integer FROM public.join_lecture_by_code('P1SYNC')),
  1,
  'user A joins the Phase 1 lecture'
);
INSERT INTO phase1_actor (actor, participant_id)
SELECT 'A', id
FROM public.participants
WHERE auth_user_id = auth.uid()
  AND lecture_session_id = '13000000-0000-4000-8000-000000000001';

RESET ROLE;

INSERT INTO public.comments (
  id, lecture_session_id, participant_id, body, created_at, updated_at
)
SELECT
  CASE
    WHEN item = 0 THEN '53000000-0000-4000-8000-000000000001'::uuid
    ELSE gen_random_uuid()
  END,
  '13000000-0000-4000-8000-000000000001',
  (SELECT participant_id FROM phase1_actor WHERE actor = 'A'),
  'Phase 1 comment ' || item,
  now() - make_interval(secs => item),
  now() - make_interval(secs => item)
FROM generate_series(0, 104) AS series(item);

SET LOCAL ROLE authenticated;
SELECT set_config(
  'request.jwt.claim.sub',
  '43000000-0000-4000-8000-000000000001',
  true
);

INSERT INTO phase1_payload (label, payload)
VALUES (
  'initial_a',
  public.get_lecture_public_snapshot_v2(
    '13000000-0000-4000-8000-000000000001'
  )
);

SELECT is(
  (SELECT (payload ->> 'contract_version')::integer
   FROM phase1_payload WHERE label = 'initial_a'),
  2,
  'shared snapshot declares contract version 2'
);
SELECT is(
  (SELECT count(*)::integer
   FROM phase1_payload,
        LATERAL jsonb_object_keys(payload -> 'versions') AS version_key
   WHERE label = 'initial_a'),
  7,
  'shared snapshot publishes seven section versions'
);
SELECT ok(
  NOT (SELECT payload ? 'current_participant_id'
       FROM phase1_payload WHERE label = 'initial_a'),
  'shared snapshot has no participant identifier'
);
SELECT ok(
  NOT (SELECT payload #> '{changed,comments,items,0}' ? 'participant_id'
       FROM phase1_payload WHERE label = 'initial_a'),
  'shared comments omit participant identifiers'
);
SELECT ok(
  NOT (SELECT payload #> '{changed,likes,0}' ? 'liked_by_participant'
       FROM phase1_payload WHERE label = 'initial_a'),
  'shared likes omit participant-owned state'
);
SELECT ok(
  NOT (SELECT payload #> '{changed,polls,0}' ? 'participant_option_ids'
       FROM phase1_payload WHERE label = 'initial_a'),
  'shared polls omit participant responses'
);
SELECT is(
  (SELECT jsonb_array_length(payload #> '{changed,comments,items}')
   FROM phase1_payload WHERE label = 'initial_a'),
  100,
  'initial shared snapshot is capped at 100 comments'
);
SELECT is(
  (SELECT (payload #>> '{changed,comments,has_older}')::boolean
   FROM phase1_payload WHERE label = 'initial_a'),
  true,
  'initial snapshot reports older comment history'
);

SELECT lives_ok(
  $$
    INSERT INTO public.comment_likes (
      lecture_session_id, comment_id, participant_id
    ) VALUES (
      '13000000-0000-4000-8000-000000000001',
      '53000000-0000-4000-8000-000000000001',
      (SELECT participant_id FROM phase1_actor WHERE actor = 'A')
    )
  $$,
  'user A can like as user A'
);
SELECT lives_ok(
  $$
    INSERT INTO public.poll_responses (
      lecture_session_id, poll_id, participant_id, option_ids
    ) VALUES (
      '13000000-0000-4000-8000-000000000001',
      '23000000-0000-4000-8000-000000000001',
      (SELECT participant_id FROM phase1_actor WHERE actor = 'A'),
      ARRAY['33000000-0000-4000-8000-000000000001'::uuid]
    )
  $$,
  'user A can answer as user A'
);

INSERT INTO phase1_payload (label, payload)
VALUES (
  'participant_a',
  public.get_lecture_participant_state_v2(
    '13000000-0000-4000-8000-000000000001'
  )
), (
  'after_a',
  public.get_lecture_public_snapshot_v2(
    '13000000-0000-4000-8000-000000000001'
  )
);

SELECT is(
  (SELECT (payload #>> '{membership,participant_id}')::uuid
   FROM phase1_payload WHERE label = 'participant_a'),
  (SELECT participant_id FROM phase1_actor WHERE actor = 'A'),
  'participant state derives user A membership from auth.uid()'
);
SELECT ok(
  (SELECT payload -> 'liked_comment_ids'
     @> '["53000000-0000-4000-8000-000000000001"]'::jsonb
   FROM phase1_payload WHERE label = 'participant_a'),
  'participant state contains user A liked comment'
);
SELECT is(
  (SELECT payload #> '{poll_responses,0,option_ids}'
   FROM phase1_payload WHERE label = 'participant_a'),
  '["33000000-0000-4000-8000-000000000001"]'::jsonb,
  'participant state contains user A poll response'
);

RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config(
  'request.jwt.claim.sub',
  '43000000-0000-4000-8000-000000000002',
  true
);

SELECT is(
  (SELECT count(*)::integer FROM public.join_lecture_by_code('P1SYNC')),
  1,
  'user B joins the Phase 1 lecture'
);
INSERT INTO phase1_actor (actor, participant_id)
SELECT 'B', id
FROM public.participants
WHERE auth_user_id = auth.uid()
  AND lecture_session_id = '13000000-0000-4000-8000-000000000001';

SELECT isnt(
  (SELECT participant_id FROM phase1_actor WHERE actor = 'A'),
  (SELECT participant_id FROM phase1_actor WHERE actor = 'B'),
  'users A and B receive distinct participants'
);

INSERT INTO phase1_payload (label, payload)
VALUES (
  'participant_b',
  public.get_lecture_participant_state_v2(
    '13000000-0000-4000-8000-000000000001'
  )
), (
  'public_b',
  public.get_lecture_public_snapshot_v2(
    '13000000-0000-4000-8000-000000000001'
  )
);

SELECT is(
  (SELECT jsonb_array_length(payload -> 'liked_comment_ids')
   FROM phase1_payload WHERE label = 'participant_b'),
  0,
  'user B cannot see user A liked state'
);
SELECT is(
  (SELECT jsonb_array_length(payload -> 'poll_responses')
   FROM phase1_payload WHERE label = 'participant_b'),
  0,
  'user B cannot see user A poll response'
);
SELECT is(
  (SELECT (like_item ->> 'like_count')::integer
   FROM phase1_payload,
        LATERAL jsonb_array_elements(payload #> '{changed,likes}') AS like_item
   WHERE label = 'public_b'
     AND like_item ->> 'comment_id' =
       '53000000-0000-4000-8000-000000000001'),
  1,
  'shared like total is common without exposing who liked'
);

INSERT INTO phase1_payload (label, payload)
SELECT
  'unchanged_b',
  public.get_lecture_public_snapshot_v2(
    '13000000-0000-4000-8000-000000000001',
    (payload #>> '{versions,lecture}')::bigint,
    (payload #>> '{versions,caption}')::bigint,
    (payload #>> '{versions,comments}')::bigint,
    (payload #>> '{versions,likes}')::bigint,
    (payload #>> '{versions,polls}')::bigint,
    (payload #>> '{versions,summaries}')::bigint,
    (payload #>> '{versions,pdf}')::bigint
  )
FROM phase1_payload
WHERE label = 'public_b';

SELECT is(
  (SELECT payload -> 'changed'
   FROM phase1_payload WHERE label = 'unchanged_b'),
  '{}'::jsonb,
  'unchanged sections are not resent'
);

INSERT INTO phase1_payload (label, payload)
SELECT
  'history_b',
  public.get_lecture_comment_history_v2(
    '13000000-0000-4000-8000-000000000001',
    (payload #>> '{changed,comments,items,99,created_at}')::timestamptz,
    (payload #>> '{changed,comments,items,99,id}')::uuid,
    50
  )
FROM phase1_payload
WHERE label = 'initial_a';

SELECT is(
  (SELECT jsonb_array_length(payload -> 'items')
   FROM phase1_payload WHERE label = 'history_b'),
  5,
  'history cursor returns only the five older comments'
);
SELECT is(
  (SELECT (payload ->> 'has_older')::boolean
   FROM phase1_payload WHERE label = 'history_b'),
  false,
  'history cursor reports when the backlog is drained'
);

RESET ROLE;
SELECT private.bump_lecture_live_state(
  '13000000-0000-4000-8000-000000000001',
  'caption'
);

SET LOCAL ROLE authenticated;
SELECT set_config(
  'request.jwt.claim.sub',
  '43000000-0000-4000-8000-000000000002',
  true
);
INSERT INTO phase1_payload (label, payload)
SELECT
  'caption_only_b',
  public.get_lecture_public_snapshot_v2(
    '13000000-0000-4000-8000-000000000001',
    (payload #>> '{versions,lecture}')::bigint,
    (payload #>> '{versions,caption}')::bigint,
    (payload #>> '{versions,comments}')::bigint,
    (payload #>> '{versions,likes}')::bigint,
    (payload #>> '{versions,polls}')::bigint,
    (payload #>> '{versions,summaries}')::bigint,
    (payload #>> '{versions,pdf}')::bigint
  )
FROM phase1_payload
WHERE label = 'public_b';

SELECT ok(
  (SELECT payload -> 'changed' ? 'caption'
     AND (payload -> 'changed') - 'caption' = '{}'::jsonb
   FROM phase1_payload WHERE label = 'caption_only_b'),
  'caption-only changes do not resend comments, likes, polls, summaries, or PDF'
);

RESET ROLE;
CREATE TEMP TABLE phase1_pdf_version AS
SELECT pdf_version
FROM public.lecture_live_state
WHERE lecture_session_id = '13000000-0000-4000-8000-000000000001';

SELECT *
FROM public.admin_update_pdf_display(
  '13000000-0000-4000-8000-000000000001',
  'phase1-document',
  2,
  'presentation'
);

SELECT is(
  (SELECT pdf_version
   FROM public.lecture_live_state
   WHERE lecture_session_id = '13000000-0000-4000-8000-000000000001'),
  (SELECT pdf_version + 1 FROM phase1_pdf_version),
  'Admin PDF changes bump the Phase 1 PDF version'
);

SET LOCAL ROLE authenticated;
SELECT set_config(
  'request.jwt.claim.sub',
  '43000000-0000-4000-8000-000000000002',
  true
);
SELECT is(
  jsonb_typeof(public.get_lecture_live_snapshot(
    '13000000-0000-4000-8000-000000000001'
  )),
  'object',
  'legacy snapshot remains callable during rollout'
);

SELECT * FROM finish();
ROLLBACK;
