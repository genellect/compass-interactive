BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path = public, extensions;
SELECT no_plan();

CREATE TEMP TABLE p727_material_recovery (
  lecture_id uuid,
  grant_id uuid,
  first_operation_id uuid,
  second_operation_id uuid,
  result jsonb
);
GRANT SELECT, INSERT, UPDATE ON p727_material_recovery TO service_role;
INSERT INTO p727_material_recovery DEFAULT VALUES;

SET LOCAL ROLE service_role;
UPDATE p727_material_recovery
SET lecture_id = public.admin_create_lecture(
  'Phase 7.27 material recovery',
  encode(extensions.digest(convert_to('P727-RECOVERY', 'UTF8'), 'sha256'), 'hex'),
  'P727-RECOVERY', null, null
);
SELECT ok(
  public.admin_set_lecture_status(
    (SELECT lecture_id FROM p727_material_recovery),
    'start',
    null
  ),
  'recovery fixture starts'
);
SELECT is(
  (
    SELECT control.material_analysis_call_limit
    FROM public.lecture_ai_control AS control, p727_material_recovery AS fixture
    WHERE control.lecture_session_id = fixture.lecture_id
  ),
  2,
  'new lectures receive the bounded two-attempt material-analysis default'
);
SELECT lives_ok(
  $$SELECT public.admin_register_pdf_document(
    (SELECT lecture_id FROM p727_material_recovery),
    'doc-recovery', repeat('a', 64), 1, 'Recovery PDF', 3, 3000, 300,
    repeat('a', 64), repeat('b', 64), true
  )$$,
  'recovery PDF metadata is registered'
);
SELECT lives_ok(
  $$SELECT public.admin_configure_lecture_ai_control(
    (SELECT lecture_id FROM p727_material_recovery),
    jsonb_build_object(
      'material_analysis_enabled', true,
      'budget_limit_microusd', 2500000,
      'input_token_limit', 200000,
      'output_token_limit', 30000,
      'max_concurrent_operations', 2
    ),
    'admin-session:p727-recovery'
  )$$,
  'material analysis is enabled without changing the two-attempt limit'
);

UPDATE p727_material_recovery
SET grant_id = (
  public.admin_issue_ai_billing_grant(
    lecture_id,
    ARRAY['material_analysis'],
    repeat('c', 64),
    true,
    'admin-session:p727-recovery'
  ) ->> 'grant_id'
)::uuid;
UPDATE p727_material_recovery
SET result = public.admin_start_material_ai_operation(
  grant_id, repeat('c', 64), lecture_id,
  'material_analysis', 'p727-material-attempt-one',
  'admin-session:p727-recovery', 'doc-recovery', repeat('a', 64),
  repeat('b', 64), null, null, null, 'gpt-5.6-luna',
  'phase5-material-v2', 1000000, 6000000, 4000, 1600, 1000, 100
);
UPDATE p727_material_recovery
SET first_operation_id = (result #>> '{operations,0,operation,id}')::uuid;
SELECT lives_ok(
  $$SELECT public.admin_fail_material_ai_operation(
    (SELECT first_operation_id FROM p727_material_recovery),
    'admin-session:p727-recovery', 'failed', 1600, 1000, 100,
    'resp-p727-quality-gate', 'quality_gate'
  )$$,
  'first billed quality-gate failure is finalized without rewriting usage'
);
SELECT is(
  (
    SELECT usage.actual_microusd
    FROM public.ai_usage_ledger AS usage, p727_material_recovery AS fixture
    WHERE usage.id = fixture.first_operation_id
  ),
  1600::bigint,
  'first failed attempt retains its actual billed cost'
);

UPDATE p727_material_recovery
SET grant_id = (
  public.admin_issue_ai_billing_grant(
    lecture_id,
    ARRAY['material_analysis'],
    repeat('d', 64),
    true,
    'admin-session:p727-recovery'
  ) ->> 'grant_id'
)::uuid;
UPDATE p727_material_recovery
SET result = public.admin_start_material_ai_operation(
  grant_id, repeat('d', 64), lecture_id,
  'material_analysis', 'p727-material-attempt-two',
  'admin-session:p727-recovery', 'doc-recovery', repeat('a', 64),
  repeat('b', 64), null, null, null, 'gpt-5.6-luna',
  'phase5-material-v2', 1000000, 6000000, 4000, 1600, 1000, 100
);
UPDATE p727_material_recovery
SET second_operation_id = (result #>> '{operations,0,operation,id}')::uuid;
SELECT is(
  (SELECT result ->> 'accepted' FROM p727_material_recovery),
  'true',
  'a fresh PIN grant permits exactly one recovery attempt'
);
SELECT is(
  (
    SELECT control.material_analysis_calls_used
    FROM public.lecture_ai_control AS control, p727_material_recovery AS fixture
    WHERE control.lecture_session_id = fixture.lecture_id
  ),
  2,
  'both attempts remain counted'
);
SELECT lives_ok(
  $$SELECT public.admin_fail_material_ai_operation(
    (SELECT second_operation_id FROM p727_material_recovery),
    'admin-session:p727-recovery', 'failed', 1600, 1000, 100,
    'resp-p727-second-failure', 'quality_gate'
  )$$,
  'the recovery attempt is finalized before the cap check'
);

UPDATE p727_material_recovery
SET grant_id = (
  public.admin_issue_ai_billing_grant(
    lecture_id,
    ARRAY['material_analysis'],
    repeat('e', 64),
    true,
    'admin-session:p727-recovery'
  ) ->> 'grant_id'
)::uuid;
SELECT throws_ok(
  $$SELECT public.admin_start_material_ai_operation(
    (SELECT grant_id FROM p727_material_recovery), repeat('e', 64),
    (SELECT lecture_id FROM p727_material_recovery),
    'material_analysis', 'p727-material-attempt-three',
    'admin-session:p727-recovery', 'doc-recovery', repeat('a', 64),
    repeat('b', 64), null, null, null, 'gpt-5.6-luna',
    'phase5-material-v2', 1000000, 6000000, 4000, 1600, 1000, 100
  )$$,
  'P0001',
  'AI operation rejected: material_analysis_call_limit',
  'a third billed attempt is rejected by the server-side cap'
);
SELECT is(
  (
    SELECT billing_grant.status
    FROM public.ai_billing_grants AS billing_grant, p727_material_recovery AS fixture
    WHERE billing_grant.id = fixture.grant_id
  ),
  'issued',
  'a rejected third attempt does not consume its grant'
);

SELECT * FROM finish();
ROLLBACK;
