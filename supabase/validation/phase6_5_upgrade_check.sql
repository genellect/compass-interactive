BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path = public, extensions;
SELECT no_plan();

SELECT has_column('public', 'comments', 'nickname', 'upgrade adds nickname without rebuilding comments');
SELECT is(
  (SELECT comment.nickname FROM public.comments AS comment
   JOIN public.phase6_5_upgrade_fixture AS fixture ON fixture.comment_id = comment.id),
  null,
  'historical comment is preserved as anonymous NULL'
);
SELECT is(
  (SELECT live.comments_version FROM public.lecture_live_state AS live
   JOIN public.phase6_5_upgrade_fixture AS fixture ON fixture.lecture_id = live.lecture_session_id),
  (SELECT comments_version FROM public.phase6_5_upgrade_fixture),
  'expand migration does not create a synthetic comments-version update'
);
SELECT ok(
  to_regprocedure(
    'public.get_lecture_public_snapshot_v2(uuid,bigint,bigint,bigint,bigint,bigint,bigint,bigint,timestamptz,uuid,integer)'
  ) IS NOT NULL,
  'legacy Phase 1 snapshot signature survives upgrade'
);
SELECT ok(
  to_regprocedure(
    'public.get_lecture_public_snapshot_v3(uuid,bigint,bigint,bigint,bigint,bigint,bigint,bigint,timestamptz,uuid,integer)'
  ) IS NOT NULL,
  'legacy Phase 4 snapshot signature survives upgrade'
);
SELECT ok(
  to_regprocedure(
    'public.get_lecture_public_snapshot_v4(uuid,bigint,bigint,bigint,bigint,bigint,bigint,bigint,timestamptz,uuid,integer)'
  ) IS NOT NULL,
  'latest Phase 6 snapshot signature survives upgrade'
);
SELECT ok(
  to_regprocedure('public.get_lecture_comment_history_v2(uuid,timestamptz,uuid,integer)') IS NOT NULL,
  'comment history signature survives upgrade'
);
SELECT ok(
  to_regprocedure('public.get_lecture_archive_v3(uuid)') IS NOT NULL,
  'latest archive signature survives upgrade'
);

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '56500000-0000-4000-8000-000000000001', true);
SELECT ok(
  (SELECT EXISTS (
    SELECT 1
    FROM jsonb_array_elements(
      public.get_lecture_public_snapshot_v4(fixture.lecture_id)
        #> '{changed,comments,items}'
    ) AS item
    WHERE item ->> 'id' = fixture.comment_id::text
      AND item ? 'nickname'
      AND item -> 'nickname' = 'null'::jsonb
  ) FROM public.phase6_5_upgrade_fixture AS fixture),
  'upgraded snapshot exposes the historical anonymous row as JSON null'
);
SELECT lives_ok(
  $$
    INSERT INTO public.comments (lecture_session_id, participant_id, nickname, body)
    SELECT lecture_id, participant_id, 'upgrade', 'Post-upgrade named comment'
    FROM public.phase6_5_upgrade_fixture
  $$,
  'new named comment can be written against upgraded Phase 6 data'
);
SELECT is(
  (SELECT comment.nickname FROM public.comments AS comment
   JOIN public.phase6_5_upgrade_fixture AS fixture
     ON fixture.lecture_id = comment.lecture_session_id
   WHERE comment.body = 'Post-upgrade named comment'),
  'upgrade',
  'post-upgrade nickname is persisted'
);
RESET ROLE;
SELECT is(
  (SELECT live.comments_version - fixture.comments_version
   FROM public.lecture_live_state AS live
   JOIN public.phase6_5_upgrade_fixture AS fixture
     ON fixture.lecture_id = live.lecture_session_id),
  1::bigint,
  'post-upgrade named comment uses the existing single version bump'
);

SELECT * FROM finish();
ROLLBACK;
