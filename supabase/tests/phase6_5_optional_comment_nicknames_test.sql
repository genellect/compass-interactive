BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path = public, extensions;
SELECT no_plan();

SELECT has_column('public', 'comments', 'nickname', 'comments has a nullable nickname column');
SELECT col_is_null('public', 'comments', 'nickname', 'nickname remains nullable for anonymous comments');
SELECT col_hasnt_default('public', 'comments', 'nickname', 'nickname has no database default');
SELECT has_check('public', 'comments', 'comments has a nickname validation check');
SELECT ok(
  EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.comments'::regclass
      AND conname = 'comments_nickname_valid'
      AND convalidated
  ),
  'nickname validation constraint is active after expand migration'
);
SELECT ok(has_table_privilege('authenticated', 'public.comments', 'SELECT'), 'authenticated can read comments');
SELECT ok(has_table_privilege('authenticated', 'public.comments', 'INSERT'), 'authenticated can insert comments');
SELECT ok(NOT has_table_privilege('authenticated', 'public.comments', 'UPDATE'), 'authenticated cannot rewrite nicknames after posting');
SELECT is(
  (SELECT count(*)::integer FROM pg_publication_tables
   WHERE pubname = 'supabase_realtime'
     AND schemaname = 'public'
     AND tablename = 'comments'),
  0,
  'nickname does not add comments to Realtime publication'
);

SELECT ok(
  NOT (SELECT prosecdef FROM pg_proc WHERE oid =
    'public.get_lecture_public_snapshot_v4(uuid,bigint,bigint,bigint,bigint,bigint,bigint,bigint,timestamptz,uuid,integer)'::regprocedure),
  'latest public snapshot remains SECURITY INVOKER'
);
SELECT ok(
  NOT (SELECT prosecdef FROM pg_proc WHERE oid =
    'public.get_lecture_comment_history_v2(uuid,timestamptz,uuid,integer)'::regprocedure),
  'public comment history remains SECURITY INVOKER'
);
SELECT ok(
  NOT (SELECT prosecdef FROM pg_proc WHERE oid =
    'public.get_lecture_archive_v3(uuid)'::regprocedure),
  'latest public archive remains SECURITY INVOKER'
);
SELECT ok(
  (SELECT prosecdef AND proconfig @> ARRAY['search_path=""']
   FROM pg_proc WHERE oid =
    'private.get_lecture_public_snapshot_v2(uuid,bigint,bigint,bigint,bigint,bigint,bigint,bigint,timestamptz,uuid,integer)'::regprocedure),
  'nickname snapshot decorator is fixed-path Definer code'
);
SELECT ok(
  (SELECT prosecdef AND proconfig @> ARRAY['search_path=""']
   FROM pg_proc WHERE oid =
    'private.get_lecture_comment_history_v2(uuid,timestamptz,uuid,integer)'::regprocedure),
  'nickname history decorator is fixed-path Definer code'
);
SELECT ok(
  (SELECT prosecdef AND proconfig @> ARRAY['search_path=""']
   FROM pg_proc WHERE oid = 'private.get_lecture_archive_v2(uuid)'::regprocedure),
  'nickname archive decorator is fixed-path Definer code'
);
SELECT ok(
  NOT has_function_privilege(
    'authenticated',
    'private.get_lecture_public_snapshot_v2_phase65_core(uuid,bigint,bigint,bigint,bigint,bigint,bigint,bigint,timestamptz,uuid,integer)',
    'EXECUTE'
  ),
  'browser cannot bypass the nickname snapshot decorator through its core'
);
SELECT ok(
  NOT has_function_privilege(
    'authenticated',
    'private.get_lecture_comment_history_v2_phase65_core(uuid,timestamptz,uuid,integer)',
    'EXECUTE'
  ),
  'browser cannot bypass the nickname history decorator through its core'
);
SELECT ok(
  NOT has_function_privilege(
    'authenticated',
    'private.get_lecture_archive_v2_phase65_core(uuid)',
    'EXECUTE'
  ),
  'browser cannot bypass the nickname archive decorator through its core'
);
SELECT ok(
  NOT has_function_privilege(
    'authenticated',
    'private.phase65_comment_items_with_nicknames(uuid,jsonb)',
    'EXECUTE'
  ),
  'browser cannot execute the Definer enrichment helper directly'
);

CREATE TEMP TABLE p65_fixture (
  lecture_id uuid,
  participant_a uuid,
  participant_b uuid,
  anonymous_comment_id uuid,
  named_comment_id uuid,
  version_before bigint,
  version_after_anonymous bigint,
  version_after_named bigint
);
GRANT SELECT, INSERT, UPDATE ON p65_fixture TO service_role, authenticated;
INSERT INTO p65_fixture DEFAULT VALUES;

SET LOCAL ROLE service_role;
UPDATE p65_fixture
SET lecture_id = public.admin_create_lecture(
  'Phase 6.5 nickname lecture',
  encode(extensions.digest(convert_to('P65-NICK', 'UTF8'), 'sha256'), 'hex'),
  'P65-NICK', null, null
);
SELECT ok(
  public.admin_set_lecture_status((SELECT lecture_id FROM p65_fixture), 'start', null),
  'nickname fixture lecture starts through the canonical lifecycle transition'
);
UPDATE p65_fixture
SET version_before = (
  SELECT comments_version FROM public.lecture_live_state AS live
  WHERE live.lecture_session_id = p65_fixture.lecture_id
);

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '46500000-0000-4000-8000-000000000001', true);
UPDATE p65_fixture
SET participant_a = (
  SELECT participant_id FROM public.join_lecture_by_code('P65-NICK')
);
SELECT ok((SELECT participant_a IS NOT NULL FROM p65_fixture), 'student A joins the nickname lecture');

SELECT set_config('request.jwt.claim.sub', '46500000-0000-4000-8000-000000000002', true);
UPDATE p65_fixture
SET participant_b = (
  SELECT participant_id FROM public.join_lecture_by_code('P65-NICK')
);
SELECT ok((SELECT participant_b IS NOT NULL FROM p65_fixture), 'student B joins the nickname lecture');
SELECT throws_ok(
  $$
    INSERT INTO public.comments (lecture_session_id, participant_id, nickname, body)
    SELECT lecture_id, participant_a, 'spoof', 'B impersonates A'
    FROM p65_fixture
  $$,
  '42501', null,
  'student B cannot attach a nickname to student A ownership'
);

SELECT set_config('request.jwt.claim.sub', '46500000-0000-4000-8000-000000000001', true);
SELECT lives_ok(
  $$
    INSERT INTO public.comments (lecture_session_id, participant_id, body)
    SELECT lecture_id, participant_a, 'Anonymous Phase 6.5 comment'
    FROM p65_fixture
  $$,
  'anonymous comment inserts without an extra identity write'
);
RESET ROLE;
UPDATE p65_fixture
SET anonymous_comment_id = (
      SELECT comment.id FROM public.comments AS comment
      WHERE comment.lecture_session_id = p65_fixture.lecture_id
        AND comment.body = 'Anonymous Phase 6.5 comment'
    ),
    version_after_anonymous = (
      SELECT comments_version FROM public.lecture_live_state AS live
      WHERE live.lecture_session_id = p65_fixture.lecture_id
    );
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '46500000-0000-4000-8000-000000000001', true);
SELECT is(
  (SELECT nickname FROM public.comments AS comment, p65_fixture
   WHERE comment.id = anonymous_comment_id),
  null,
  'omitted nickname is stored as NULL'
);
SELECT is(
  (SELECT version_after_anonymous - version_before FROM p65_fixture),
  1::bigint,
  'anonymous comment increments the existing comments section exactly once'
);

SELECT lives_ok(
  $$
    INSERT INTO public.comments (lecture_session_id, participant_id, nickname, body)
    SELECT lecture_id, participant_a, '薬理好き', 'Named Phase 6.5 comment'
    FROM p65_fixture
  $$,
  'named comment inserts nickname and body in the same row write'
);
RESET ROLE;
UPDATE p65_fixture
SET named_comment_id = (
      SELECT comment.id FROM public.comments AS comment
      WHERE comment.lecture_session_id = p65_fixture.lecture_id
        AND comment.body = 'Named Phase 6.5 comment'
    ),
    version_after_named = (
      SELECT comments_version FROM public.lecture_live_state AS live
      WHERE live.lecture_session_id = p65_fixture.lecture_id
    );
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '46500000-0000-4000-8000-000000000001', true);
SELECT is(
  (SELECT nickname FROM public.comments AS comment, p65_fixture
   WHERE comment.id = named_comment_id),
  '薬理好き',
  'named comment stores the exact short nickname'
);
SELECT is(
  (SELECT version_after_named - version_after_anonymous FROM p65_fixture),
  1::bigint,
  'named comment also increments comments version exactly once'
);
SELECT lives_ok(
  $$
    INSERT INTO public.comments (lecture_session_id, participant_id, nickname, body)
    SELECT lecture_id, participant_a, '1234567890', 'Ten character boundary'
    FROM p65_fixture
  $$,
  'ten-character nickname is accepted at the boundary'
);
SELECT throws_ok(
  $$
    INSERT INTO public.comments (lecture_session_id, participant_id, nickname, body)
    SELECT lecture_id, participant_a, '12345678901', 'Too long nickname'
    FROM p65_fixture
  $$,
  '23514', null,
  'eleven-character nickname is rejected by the database'
);
SELECT throws_ok(
  $$
    INSERT INTO public.comments (lecture_session_id, participant_id, nickname, body)
    SELECT lecture_id, participant_a, '', 'Empty nickname'
    FROM p65_fixture
  $$,
  '23514', null,
  'empty string is rejected instead of becoming a stored anonymous identity'
);
SELECT throws_ok(
  $$
    INSERT INTO public.comments (lecture_session_id, participant_id, nickname, body)
    SELECT lecture_id, participant_a, ' padded ', 'Padded nickname'
    FROM p65_fixture
  $$,
  '23514', null,
  'untrimmed nickname is rejected by the server contract'
);
SELECT throws_ok(
  $$
    INSERT INTO public.comments (lecture_session_id, participant_id, nickname, body)
    SELECT lecture_id, participant_a, E'line\nbreak', 'Control nickname'
    FROM p65_fixture
  $$,
  '23514', null,
  'control characters are rejected by the server contract'
);

SELECT is(
  (SELECT snapshot.item ->> 'nickname'
   FROM p65_fixture,
     LATERAL jsonb_array_elements(
       public.get_lecture_public_snapshot_v4(lecture_id)
         #> '{changed,comments,items}'
     ) AS snapshot(item)
   WHERE snapshot.item ->> 'id' = named_comment_id::text),
  '薬理好き',
  'latest five-second snapshot includes the named comment nickname'
);
SELECT ok(
  (SELECT EXISTS (
    SELECT 1
    FROM jsonb_array_elements(
      public.get_lecture_public_snapshot_v4(lecture_id) #> '{changed,comments,items}'
    ) AS item
    WHERE item ->> 'id' = anonymous_comment_id::text
      AND item ? 'nickname'
      AND item -> 'nickname' = 'null'::jsonb
  ) FROM p65_fixture),
  'snapshot represents anonymous display as an explicit JSON null'
);
SELECT is(
  (SELECT history.item ->> 'nickname'
   FROM p65_fixture,
     LATERAL jsonb_array_elements(
       public.get_lecture_comment_history_v2(
         lecture_id,
         statement_timestamp() + interval '1 day',
         'ffffffff-ffff-ffff-ffff-ffffffffffff',
         50
       ) -> 'items'
     ) AS history(item)
   WHERE history.item ->> 'id' = named_comment_id::text),
  '薬理好き',
  'cursor history includes the per-comment nickname'
);
SELECT ok(
  NOT (
    SELECT history.item ? 'participant_id'
    FROM p65_fixture,
      LATERAL jsonb_array_elements(
        public.get_lecture_comment_history_v2(
          lecture_id,
          statement_timestamp() + interval '1 day',
          'ffffffff-ffff-ffff-ffff-ffffffffffff',
          50
        ) -> 'items'
      ) AS history(item)
    WHERE history.item ->> 'id' = named_comment_id::text
  ),
  'nickname enrichment does not disclose participant identity'
);

SET LOCAL ROLE service_role;
SELECT ok(
  public.admin_set_lecture_status((SELECT lecture_id FROM p65_fixture), 'close', null),
  'nickname lecture closes through the existing terminal transition'
);

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '46500000-0000-4000-8000-000000000001', true);
SELECT is(
  (SELECT archive.item ->> 'nickname'
   FROM p65_fixture,
     LATERAL jsonb_array_elements(
       public.get_lecture_archive_v3(lecture_id) -> 'comments'
     ) AS archive(item)
   WHERE archive.item ->> 'id' = named_comment_id::text),
  '薬理好き',
  '30-day archive payload retains the nickname with its comment'
);
SELECT throws_ok(
  $$
    INSERT INTO public.comments (lecture_session_id, participant_id, nickname, body)
    SELECT lecture_id, participant_a, 'late', 'Comment after close'
    FROM p65_fixture
  $$,
  '42501', null,
  'closed lecture still rejects named comments through server-side RLS'
);

SELECT set_config('request.jwt.claim.sub', '46500000-0000-4000-8000-000000000099', true);
SELECT is(
  public.get_lecture_archive_v3((SELECT lecture_id FROM p65_fixture)),
  null,
  'unrelated authenticated user cannot read nicknames from another lecture archive'
);

SELECT * FROM finish();
ROLLBACK;
