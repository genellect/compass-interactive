BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path = public, extensions;
SELECT no_plan();

SELECT has_table('public', 'material_ai_operation_contexts', 'Phase 5 context table exists after upgrade');
SELECT has_table('public', 'lecture_material_analyses', 'Phase 5 analysis table exists after upgrade');
SELECT has_table('public', 'ai_poll_proposals', 'Phase 5 proposal table exists after upgrade');
SELECT is(
  (SELECT usage.status FROM public.ai_usage_ledger AS usage
   JOIN public.phase5_upgrade_fixture AS fixture ON fixture.operation_id = usage.id),
  'succeeded',
  'pre-Phase 5 AI ledger row survives upgrade'
);
SELECT is(
  (SELECT usage.provider_request_id FROM public.ai_usage_ledger AS usage
   JOIN public.phase5_upgrade_fixture AS fixture ON fixture.operation_id = usage.id),
  'provider-before-phase5',
  'pre-Phase 5 provider audit id survives upgrade'
);
SELECT is(
  (SELECT control.used_microusd FROM public.lecture_ai_control AS control
   JOIN public.phase5_upgrade_fixture AS fixture ON fixture.lecture_id = control.lecture_session_id),
  (SELECT used_microusd FROM public.phase5_upgrade_fixture),
  'pre-Phase 5 usage reservation total is unchanged'
);
SELECT is(
  (SELECT control.material_analysis_calls_used FROM public.lecture_ai_control AS control
   JOIN public.phase5_upgrade_fixture AS fixture ON fixture.lecture_id = control.lecture_session_id),
  (SELECT material_calls_used FROM public.phase5_upgrade_fixture),
  'pre-Phase 5 call counter is unchanged'
);
SELECT is(
  (SELECT count(*)::integer FROM public.lecture_pdf_documents AS document
   JOIN public.phase5_upgrade_fixture AS fixture ON fixture.lecture_id = document.lecture_session_id),
  1,
  'pre-Phase 5 PDF metadata survives upgrade'
);
SELECT is(
  (SELECT poll.status FROM public.polls AS poll
   JOIN public.phase5_upgrade_fixture AS fixture ON fixture.poll_id = poll.id),
  'draft',
  'pre-Phase 5 teacher Poll survives as draft'
);
SELECT is(
  (SELECT count(*)::integer FROM public.material_ai_operation_contexts AS context
   JOIN public.phase5_upgrade_fixture AS fixture ON fixture.lecture_id = context.lecture_session_id),
  0,
  'migration does not invent contexts for historical provider calls'
);
SELECT ok(
  to_regprocedure('public.admin_finish_lecture_ai_operation(uuid,text,bigint,integer,bigint,bigint,text,text)') IS NOT NULL,
  'legacy AI finish RPC remains available'
);
SELECT ok(
  to_regprocedure('public.admin_create_poll(uuid,text,text,text[])') IS NOT NULL,
  'legacy Poll creation RPC remains available'
);

SET LOCAL ROLE service_role;
CREATE TEMP TABLE p5_upgrade_runtime (grant_id uuid, result jsonb);
GRANT SELECT, INSERT, UPDATE ON p5_upgrade_runtime TO service_role;
INSERT INTO p5_upgrade_runtime (grant_id)
SELECT (
  public.admin_issue_ai_billing_grant(
    fixture.lecture_id,
    ARRAY['material_analysis'],
    repeat('d', 64), true, 'admin-session:upgrade'
  ) ->> 'grant_id'
)::uuid
FROM public.phase5_upgrade_fixture AS fixture;
UPDATE p5_upgrade_runtime
SET result = public.admin_start_material_ai_operation(
  grant_id,
  repeat('d', 64),
  (SELECT lecture_id FROM public.phase5_upgrade_fixture),
  'material_analysis',
  'phase5-upgrade-new-operation',
  'admin-session:upgrade',
  'doc-upgrade', repeat('a', 64), repeat('b', 64),
  null, null, null,
  'gpt-5.6-luna', 'phase5-material-v1',
  1000000, 6000000, 4000,
  1600, 1000, 100
);
SELECT is(
  (SELECT result ->> 'accepted' FROM p5_upgrade_runtime),
  'true',
  'new dedicated operation RPC works against upgraded Phase 4.1 data'
);
SELECT lives_ok(
  $$SELECT public.admin_fail_material_ai_operation(
    (SELECT (result #>> '{operations,0,operation,id}')::uuid FROM p5_upgrade_runtime),
    'admin-session:upgrade', 'cancelled', 0, 0, 0, null, 'upgrade_cleanup'
  )$$,
  'new dedicated operation can be closed safely after upgrade'
);

SELECT * FROM finish();
ROLLBACK;
