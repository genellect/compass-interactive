BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path = public, extensions;
SELECT plan(27);

SELECT has_column(
  'public',
  'participants',
  'auth_user_id',
  'participants carry a Supabase Auth owner'
);
SELECT has_index(
  'public',
  'participants',
  'participants_lecture_auth_user_uidx',
  'one Auth user has at most one participant per lecture'
);
SELECT ok(
  to_regprocedure(
    'public.get_lecture_live_snapshot(uuid,bigint,bigint,bigint,bigint,bigint,timestamptz,uuid,integer)'
  ) IS NOT NULL,
  'snapshot RPC has the ownership-safe signature'
);
SELECT ok(
  to_regprocedure(
    'public.get_lecture_live_snapshot(uuid,uuid,bigint,bigint,bigint,bigint,bigint,timestamptz,uuid,integer)'
  ) IS NULL,
  'snapshot RPC no longer accepts a participant UUID'
);
SELECT ok(
  NOT has_function_privilege(
    'anon',
    'public.join_lecture_by_code(text)',
    'EXECUTE'
  ),
  'anon cannot execute join before Anonymous Auth'
);
SELECT ok(
  NOT has_function_privilege(
    'anon',
    'public.get_lecture_live_snapshot(uuid,bigint,bigint,bigint,bigint,bigint,timestamptz,uuid,integer)',
    'EXECUTE'
  ),
  'anon cannot execute snapshots before Anonymous Auth'
);
SELECT ok(
  has_function_privilege(
    'authenticated',
    'public.join_lecture_by_code(text)',
    'EXECUTE'
  ),
  'authenticated users can execute join'
);
SELECT ok(
  has_function_privilege(
    'authenticated',
    'public.get_lecture_live_snapshot(uuid,bigint,bigint,bigint,bigint,bigint,timestamptz,uuid,integer)',
    'EXECUTE'
  ),
  'authenticated users can execute snapshots'
);
SELECT ok(
  NOT (
    SELECT prosecdef
    FROM pg_proc
    WHERE oid = 'public.join_lecture_by_code(text)'::regprocedure
  ),
  'public join wrapper is SECURITY INVOKER'
);
SELECT ok(
  NOT (
    SELECT prosecdef
    FROM pg_proc
    WHERE oid =
      'public.get_lecture_live_snapshot(uuid,bigint,bigint,bigint,bigint,bigint,timestamptz,uuid,integer)'::regprocedure
  ),
  'public snapshot wrapper is SECURITY INVOKER'
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
  'comments are absent from the Realtime publication'
);
SELECT ok(
  (
    SELECT proconfig IS NOT NULL
    FROM pg_proc
    WHERE oid = 'public.set_updated_at()'::regprocedure
  ),
  'set_updated_at has a fixed search_path'
);
SELECT ok(
  (
    SELECT proconfig IS NOT NULL
    FROM pg_proc
    WHERE oid = 'public.validate_poll_response_option_ids()'::regprocedure
  ),
  'poll option validation has a fixed search_path'
);

INSERT INTO public.lecture_sessions (
  id, title, code_hash, status, starts_at, ends_at
) VALUES (
  '12000000-0000-4000-8000-000000000001',
  'Phase 0 ownership lecture',
  encode(extensions.digest(convert_to('AUTH0', 'UTF8'), 'sha256'), 'hex'),
  'open',
  now() - interval '5 minutes',
  now() + interval '1 hour'
);

INSERT INTO public.polls (
  id, lecture_session_id, question, type, status
) VALUES (
  '22000000-0000-4000-8000-000000000001',
  '12000000-0000-4000-8000-000000000001',
  'Ownership poll?',
  'single',
  'open'
);

INSERT INTO public.poll_options (
  id, lecture_session_id, poll_id, label, display_order
) VALUES (
  '32000000-0000-4000-8000-000000000001',
  '12000000-0000-4000-8000-000000000001',
  '22000000-0000-4000-8000-000000000001',
  'Yes',
  1
);

CREATE TEMP TABLE phase0_actor (
  actor text PRIMARY KEY,
  participant_id uuid NOT NULL
);
GRANT SELECT, INSERT ON phase0_actor TO authenticated;

CREATE FUNCTION pg_temp.try_insert_participant(target_lecture uuid)
RETURNS text
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO public.participants (
    lecture_session_id, participant_key
  ) VALUES (
    target_lecture, 'client-forged-participant'
  );
  RETURN 'allowed';
EXCEPTION WHEN OTHERS THEN
  RETURN SQLSTATE;
END;
$$;

CREATE FUNCTION pg_temp.try_insert_comment(
  target_lecture uuid,
  target_participant uuid
)
RETURNS text
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO public.comments (
    lecture_session_id, participant_id, body
  ) VALUES (
    target_lecture, target_participant, 'forged comment'
  );
  RETURN 'allowed';
EXCEPTION WHEN OTHERS THEN
  RETURN SQLSTATE;
END;
$$;

CREATE FUNCTION pg_temp.try_insert_like(
  target_lecture uuid,
  target_comment uuid,
  target_participant uuid
)
RETURNS text
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO public.comment_likes (
    lecture_session_id, comment_id, participant_id
  ) VALUES (
    target_lecture, target_comment, target_participant
  );
  RETURN 'allowed';
EXCEPTION WHEN OTHERS THEN
  RETURN SQLSTATE;
END;
$$;

CREATE FUNCTION pg_temp.try_insert_poll_response(
  target_lecture uuid,
  target_poll uuid,
  target_participant uuid,
  target_option uuid
)
RETURNS text
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO public.poll_responses (
    lecture_session_id, poll_id, participant_id, option_ids
  ) VALUES (
    target_lecture, target_poll, target_participant, ARRAY[target_option]
  );
  RETURN 'allowed';
EXCEPTION WHEN OTHERS THEN
  RETURN SQLSTATE;
END;
$$;

SET LOCAL ROLE authenticated;
SELECT set_config(
  'request.jwt.claim.sub',
  '42000000-0000-4000-8000-000000000001',
  true
);

SELECT is(
  (SELECT count(*)::integer FROM public.join_lecture_by_code('AUTH0')),
  1,
  'user A joins through the server RPC'
);
INSERT INTO phase0_actor (actor, participant_id)
SELECT 'A', id
FROM public.participants
WHERE auth_user_id = auth.uid()
  AND lecture_session_id = '12000000-0000-4000-8000-000000000001';

SELECT lives_ok(
  $$
    INSERT INTO public.comments (
      id, lecture_session_id, participant_id, body
    ) SELECT
      '52000000-0000-4000-8000-000000000001',
      '12000000-0000-4000-8000-000000000001',
      participant_id,
      'Owned comment'
    FROM phase0_actor
    WHERE actor = 'A'
  $$,
  'user A can comment as user A'
);
SELECT lives_ok(
  $$
    INSERT INTO public.comment_likes (
      lecture_session_id, comment_id, participant_id
    ) SELECT
      '12000000-0000-4000-8000-000000000001',
      '52000000-0000-4000-8000-000000000001',
      participant_id
    FROM phase0_actor
    WHERE actor = 'A'
  $$,
  'user A can like as user A'
);
SELECT lives_ok(
  $$
    INSERT INTO public.poll_responses (
      lecture_session_id, poll_id, participant_id, option_ids
    ) SELECT
      '12000000-0000-4000-8000-000000000001',
      '22000000-0000-4000-8000-000000000001',
      participant_id,
      ARRAY['32000000-0000-4000-8000-000000000001'::uuid]
    FROM phase0_actor
    WHERE actor = 'A'
  $$,
  'user A can answer as user A'
);

RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config(
  'request.jwt.claim.sub',
  '42000000-0000-4000-8000-000000000002',
  true
);

SELECT is(
  (SELECT count(*)::integer FROM public.join_lecture_by_code('AUTH0')),
  1,
  'user B joins through the server RPC'
);
INSERT INTO phase0_actor (actor, participant_id)
SELECT 'B', id
FROM public.participants
WHERE auth_user_id = auth.uid()
  AND lecture_session_id = '12000000-0000-4000-8000-000000000001';

SELECT isnt(
  (SELECT participant_id FROM phase0_actor WHERE actor = 'A'),
  (SELECT participant_id FROM phase0_actor WHERE actor = 'B'),
  'each Auth user receives a distinct participant'
);
SELECT is(
  private.participant_is_owned(
    (SELECT participant_id FROM phase0_actor WHERE actor = 'A'),
    '12000000-0000-4000-8000-000000000001'
  ),
  false,
  'user B does not own user A participant'
);
SELECT is(
  pg_temp.try_insert_participant(
    '12000000-0000-4000-8000-000000000001'
  ),
  '42501',
  'browser cannot create an arbitrary participant'
);
SELECT is(
  pg_temp.try_insert_comment(
    '12000000-0000-4000-8000-000000000001',
    (SELECT participant_id FROM phase0_actor WHERE actor = 'A')
  ),
  '42501',
  'user B cannot comment as user A'
);
SELECT is(
  pg_temp.try_insert_like(
    '12000000-0000-4000-8000-000000000001',
    '52000000-0000-4000-8000-000000000001',
    (SELECT participant_id FROM phase0_actor WHERE actor = 'A')
  ),
  '42501',
  'user B cannot like as user A'
);
SELECT is(
  pg_temp.try_insert_poll_response(
    '12000000-0000-4000-8000-000000000001',
    '22000000-0000-4000-8000-000000000001',
    (SELECT participant_id FROM phase0_actor WHERE actor = 'A'),
    '32000000-0000-4000-8000-000000000001'
  ),
  '42501',
  'user B cannot answer as user A'
);
SELECT is(
  (
    public.get_lecture_live_snapshot(
      '12000000-0000-4000-8000-000000000001'
    ) ->> 'current_participant_id'
  )::uuid,
  (SELECT participant_id FROM phase0_actor WHERE actor = 'B'),
  'snapshot derives user B participant from auth.uid()'
);
SELECT is(
  public.get_lecture_live_snapshot(
    '12000000-0000-4000-8000-000000000001'
  ) #> '{polls,0,participant_option_ids}',
  '[]'::jsonb,
  'snapshot does not expose user A poll response to user B'
);
SELECT is(
  (
    public.get_lecture_live_snapshot(
      '12000000-0000-4000-8000-000000000001'
    ) #>> '{like_totals,0,liked_by_participant}'
  )::boolean,
  false,
  'snapshot does not expose user A liked state to user B'
);

SELECT * FROM finish();
ROLLBACK;
