BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path = public, extensions;
SELECT plan(14);

SELECT has_extension('pg_cron', 'production gate enables pg_cron');

SELECT is(
  (
    SELECT count(*)::integer
    FROM cron.job
    WHERE jobname = 'compass-phase2-lifecycle-minute'
      AND schedule = '* * * * *'
      AND active
      AND command =
        'select private.run_lecture_lifecycle_maintenance(50, 25);'
  ),
  1,
  'server lifecycle maintenance is scheduled every minute'
);

SELECT is(
  (
    SELECT count(*)::integer
    FROM cron.job
    WHERE jobname = 'compass-cron-history-weekly'
      AND schedule = '17 3 * * 0'
      AND active
      AND command LIKE '%interval ''30 days''%'
      AND command LIKE '%jobname like ''compass-%%''%'
  ),
  1,
  'cron diagnostics are pruned after the bounded retention period'
);

SELECT has_index(
  'public',
  'material_ai_operation_contexts',
  'material_ai_operation_contexts_source_document_idx',
  'material operation source-document FK is indexed'
);
SELECT has_index(
  'public',
  'material_ai_operation_contexts',
  'material_ai_operation_contexts_analysis_idx',
  'material operation analysis FK is indexed'
);
SELECT has_index(
  'public',
  'ai_poll_proposals',
  'ai_poll_proposals_source_document_idx',
  'AI Poll proposal source-document FK is indexed'
);
SELECT has_index(
  'public',
  'lecture_summary_windows',
  'lecture_summary_windows_run_idx',
  'summary-window run FK is indexed'
);
SELECT has_index(
  'public',
  'lecture_ai_summary_revisions',
  'lecture_ai_summary_revisions_supersedes_idx',
  'summary revision supersedes FK is indexed'
);
SELECT has_index(
  'public',
  'summary_publications',
  'summary_publications_active_revision_idx',
  'summary publication active-revision FK is indexed'
);

SELECT is(
  (
    WITH foreign_keys AS (
      SELECT constraint_row.conrelid, constraint_row.conkey
      FROM pg_constraint AS constraint_row
      WHERE constraint_row.contype = 'f'
        AND constraint_row.connamespace = 'public'::regnamespace
    )
    SELECT count(*)::integer
    FROM foreign_keys AS foreign_key
    WHERE NOT EXISTS (
      SELECT 1
      FROM pg_index AS index_row
      WHERE index_row.indrelid = foreign_key.conrelid
        AND index_row.indisvalid
        AND index_row.indisready
        AND (index_row.indkey::smallint[])[
          0:cardinality(foreign_key.conkey) - 1
        ] = foreign_key.conkey
    )
  ),
  0,
  'all public foreign keys have a supporting leading index'
);

SELECT is(
  (
    SELECT count(*)::integer
    FROM pg_class AS relation
    JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = 'public'
      AND relation.relkind IN ('r', 'p')
      AND NOT relation.relrowsecurity
  ),
  0,
  'all public application tables keep RLS enabled'
);

SELECT is(
  (
    SELECT count(*)::integer
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
  ),
  0,
  'production hardening adds no Realtime publication load'
);

SELECT is(
  (
    SELECT count(*)::integer
    FROM pg_proc AS procedure
    JOIN pg_namespace AS namespace ON namespace.oid = procedure.pronamespace
    CROSS JOIN LATERAL aclexplode(
      coalesce(
        procedure.proacl,
        acldefault('f', procedure.proowner)
      )
    ) AS privilege
    WHERE namespace.nspname IN ('public', 'private')
      AND privilege.grantee = 0
      AND privilege.privilege_type = 'EXECUTE'
  ),
  0,
  'application functions grant no execute privilege to PUBLIC'
);

SELECT ok(
  (private.run_lecture_lifecycle_maintenance(1, 1) ->> 'closed_count')::integer
    >= 0,
  'lifecycle maintenance remains callable by its scheduler owner'
);

SELECT * FROM finish();
ROLLBACK;
