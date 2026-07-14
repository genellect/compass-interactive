BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path = public, extensions;
SELECT plan(14);

SELECT is(
  (
    SELECT count(*)
    FROM pg_class AS relation
    JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = 'public'
      AND relation.relname IN (
        'lecture_lifecycle_events',
        'lecture_archive_state',
        'lecture_ai_control',
        'ai_usage_ledger'
      )
      AND NOT relation.relrowsecurity
  ),
  0::bigint,
  'advisor: every Phase 2 public table has RLS enabled'
);

SELECT is(
  (
    SELECT count(*)
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename IN (
        'lecture_lifecycle_events',
        'lecture_archive_state',
        'lecture_ai_control',
        'ai_usage_ledger'
      )
  ),
  0::bigint,
  'advisor: server-only Phase 2 tables have no browser RLS policy'
);

SELECT is(
  (
    SELECT count(*)
    FROM pg_proc AS procedure
    JOIN pg_namespace AS namespace ON namespace.oid = procedure.pronamespace
    WHERE namespace.nspname = 'public'
      AND procedure.proname IN (
        'get_lecture_terminal_state_v2',
        'get_lecture_archive_v2',
        'admin_configure_lecture_ai_control',
        'admin_start_lecture_ai_operation',
        'admin_finish_lecture_ai_operation',
        'admin_stop_lecture_ai_control',
        'admin_restore_lecture_archive'
      )
      AND procedure.prosecdef
  ),
  0::bigint,
  'advisor: all new public RPCs are security invoker'
);

SELECT is(
  (
    SELECT count(*)
    FROM pg_proc AS procedure
    JOIN pg_namespace AS namespace ON namespace.oid = procedure.pronamespace
    WHERE namespace.nspname = 'private'
      AND procedure.proname IN (
        'close_lecture_core',
        'close_lecture_if_expired',
        'start_lecture_core',
        'close_expired_lectures',
        'archive_due_lectures',
        'run_lecture_lifecycle_maintenance',
        'configure_lecture_ai_control',
        'start_lecture_ai_operation',
        'finish_lecture_ai_operation',
        'stop_lecture_ai_control',
        'restore_lecture_archive'
      )
      AND (
        NOT procedure.prosecdef
        OR NOT coalesce(procedure.proconfig, '{}'::text[]) @> ARRAY['search_path=""']
      )
  ),
  0::bigint,
  'advisor: internal lifecycle Definer functions use an empty fixed search_path'
);

SELECT ok(
  NOT has_function_privilege(
    'anon', 'public.get_lecture_archive_v2(uuid)', 'EXECUTE'
  ),
  'advisor: anon cannot execute archive RPC'
);
SELECT ok(
  has_function_privilege(
    'authenticated', 'public.get_lecture_archive_v2(uuid)', 'EXECUTE'
  ),
  'advisor: authenticated can execute membership-scoped archive RPC'
);
SELECT ok(
  NOT has_function_privilege(
    'authenticated',
    'public.admin_configure_lecture_ai_control(uuid,jsonb,text)',
    'EXECUTE'
  ),
  'advisor: browser cannot configure AI control'
);
SELECT ok(
  NOT has_function_privilege(
    'authenticated',
    'private.close_lecture_core(uuid,text,text,text)',
    'EXECUTE'
  ),
  'advisor: browser cannot execute terminal close primitive'
);
SELECT ok(
  has_function_privilege(
    'service_role',
    'public.admin_configure_lecture_ai_control(uuid,jsonb,text)',
    'EXECUTE'
  ),
  'advisor: service role has explicit AI configuration grant'
);
SELECT ok(
  NOT has_table_privilege(
    'authenticated', 'public.lecture_lifecycle_events', 'SELECT'
  ),
  'advisor: browser cannot select lifecycle audit records'
);
SELECT ok(
  NOT has_table_privilege(
    'authenticated', 'public.lecture_archive_state', 'UPDATE'
  ),
  'advisor: browser cannot mutate archive state'
);
SELECT ok(
  to_regclass('public.lecture_sessions_open_hard_stop_idx') IS NOT NULL,
  'advisor: deadline worker predicate has a partial index'
);
SELECT ok(
  to_regclass('public.lecture_archive_state_due_idx') IS NOT NULL,
  'advisor: archive worker predicate has a partial index'
);
SELECT ok(
  to_regclass('public.ai_usage_ledger_running_idx') IS NOT NULL,
  'advisor: running AI cancellation predicate has a partial index'
);

SELECT * FROM finish();
ROLLBACK;
