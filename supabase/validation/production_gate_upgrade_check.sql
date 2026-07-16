BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path = public, extensions;
SELECT plan(8);

SELECT ok(
  to_regclass('public.phase6_5_upgrade_fixture') IS NOT NULL,
  'pre-hardening Phase 6.5 fixture table survives upgrade'
);
SELECT is(
  (
    SELECT count(*)::integer
    FROM public.comments AS comment
    JOIN public.phase6_5_upgrade_fixture AS fixture
      ON fixture.comment_id = comment.id
  ),
  1,
  'pre-hardening comment survives upgrade'
);
SELECT is(
  (
    SELECT comment.nickname
    FROM public.comments AS comment
    JOIN public.phase6_5_upgrade_fixture AS fixture
      ON fixture.comment_id = comment.id
  ),
  null,
  'pre-hardening anonymous nickname remains NULL'
);
SELECT ok(
  to_regprocedure(
    'public.get_lecture_public_snapshot_v4(uuid,bigint,bigint,bigint,bigint,bigint,bigint,bigint,timestamptz,uuid,integer)'
  ) IS NOT NULL,
  'latest snapshot RPC remains available'
);
SELECT ok(
  to_regprocedure('public.get_lecture_archive_v3(uuid)') IS NOT NULL,
  'latest archive RPC remains available'
);
SELECT has_index(
  'public',
  'lecture_summary_windows',
  'lecture_summary_windows_run_idx',
  'hardening index is present after upgrade'
);
SELECT is(
  (
    SELECT count(*)::integer
    FROM cron.job
    WHERE jobname IN (
      'compass-phase2-lifecycle-minute',
      'compass-cron-history-weekly'
    )
      AND active
  ),
  2,
  'both production Cron jobs are active after upgrade'
);
SELECT is(
  (
    SELECT count(*)::integer
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
  ),
  0,
  'upgrade adds no Realtime publication'
);

SELECT * FROM finish();
ROLLBACK;
