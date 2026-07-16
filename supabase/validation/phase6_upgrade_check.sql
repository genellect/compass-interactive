BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path = public, extensions;
SELECT no_plan();

SELECT has_table('public', 'lecture_summary_runs', 'Phase 6 run table exists after upgrade');
SELECT has_table('public', 'lecture_summary_windows', 'Phase 6 window table exists after upgrade');
SELECT has_table('public', 'lecture_ai_summaries', 'Phase 6 summary table exists after upgrade');
SELECT is(
  (SELECT usage.status FROM public.ai_usage_ledger AS usage
   JOIN public.phase6_upgrade_fixture AS fixture ON fixture.operation_id = usage.id),
  'succeeded',
  'pre-Phase 6 AI ledger row survives upgrade'
);
SELECT is(
  (SELECT usage.provider_request_id FROM public.ai_usage_ledger AS usage
   JOIN public.phase6_upgrade_fixture AS fixture ON fixture.operation_id = usage.id),
  'provider-before-phase6',
  'pre-Phase 6 provider audit id survives upgrade'
);
SELECT is(
  (SELECT control.used_microusd FROM public.lecture_ai_control AS control
   JOIN public.phase6_upgrade_fixture AS fixture ON fixture.lecture_id = control.lecture_session_id),
  (SELECT used_microusd FROM public.phase6_upgrade_fixture),
  'Phase 6 migration does not change historical cost accounting'
);
SELECT is(
  (SELECT control.material_analysis_calls_used FROM public.lecture_ai_control AS control
   JOIN public.phase6_upgrade_fixture AS fixture ON fixture.lecture_id = control.lecture_session_id),
  (SELECT material_calls_used FROM public.phase6_upgrade_fixture),
  'Phase 6 migration does not change historical material call accounting'
);
SELECT is(
  (SELECT count(*)::integer FROM public.lecture_pdf_documents AS document
   JOIN public.phase6_upgrade_fixture AS fixture ON fixture.lecture_id = document.lecture_session_id),
  1,
  'pre-Phase 6 PDF metadata survives upgrade'
);
SELECT is(
  (SELECT poll.status FROM public.polls AS poll
   JOIN public.phase6_upgrade_fixture AS fixture ON fixture.poll_id = poll.id),
  'draft',
  'pre-Phase 6 teacher Poll survives as draft'
);
SELECT is(
  (SELECT count(*)::integer FROM public.lecture_summary_runs AS run
   JOIN public.phase6_upgrade_fixture AS fixture ON fixture.lecture_id = run.lecture_session_id),
  0,
  'migration does not invent paid summary runs for historical lectures'
);
SELECT ok(
  to_regprocedure('public.get_lecture_public_snapshot_v3(uuid,bigint,bigint,bigint,bigint,bigint,bigint,bigint,timestamp with time zone,uuid,integer)') IS NOT NULL,
  'legacy Phase 4 snapshot RPC remains available'
);
SELECT ok(
  to_regprocedure('public.admin_start_material_ai_operation(uuid,text,uuid,text,text,text,text,text,text,uuid,integer,integer,text,text,bigint,bigint,integer,bigint,bigint,bigint)') IS NOT NULL,
  'legacy Phase 5 material start RPC remains available'
);

SET LOCAL ROLE service_role;
CREATE TEMP TABLE p6_upgrade_runtime (grant_id uuid, run_id uuid, result jsonb);
GRANT SELECT, INSERT, UPDATE ON p6_upgrade_runtime TO service_role;
INSERT INTO p6_upgrade_runtime (grant_id)
SELECT (
  public.admin_issue_ai_billing_grant(
    fixture.lecture_id,
    ARRAY['summaries'],
    repeat('d', 64), true, 'admin-session:p6-upgrade'
  ) ->> 'grant_id'
)::uuid
FROM public.phase6_upgrade_fixture AS fixture;
UPDATE p6_upgrade_runtime SET result = public.admin_start_lecture_summary_run(
  grant_id, repeat('d', 64),
  (SELECT lecture_id FROM public.phase6_upgrade_fixture),
  repeat('e', 64), 'admin-session:p6-upgrade'
);
UPDATE p6_upgrade_runtime SET run_id = (result #>> '{run,id}')::uuid;
SELECT is(
  (SELECT result ->> 'accepted' FROM p6_upgrade_runtime),
  'true',
  'new summary run RPC works against upgraded Phase 5 data'
);
UPDATE p6_upgrade_runtime SET result = public.admin_skip_summary_window(
  (SELECT lecture_id FROM public.phase6_upgrade_fixture), run_id,
  repeat('e', 64), 'admin-session:p6-upgrade', 1,
  'phase6-summary-v1', 'insufficient_source_context', '{}'::jsonb, '{}'::jsonb
);
SELECT is(
  (SELECT result ->> 'accepted' FROM p6_upgrade_runtime),
  'true',
  'new server-time window RPC works after upgrade without a provider call'
);
SELECT lives_ok(
  $$SELECT public.admin_stop_lecture_summary_run(
    (SELECT lecture_id FROM public.phase6_upgrade_fixture),
    'admin-session:p6-upgrade', 'upgrade_cleanup'
  )$$,
  'upgraded summary run stops safely and idempotently'
);

SELECT * FROM finish();
ROLLBACK;
