BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path = public, extensions;
SELECT no_plan();

SELECT ok(
  to_regclass('public.ai_usage_ledger_running_realtime_uidx') IS NOT NULL,
  'one-running-Realtime-lane invariant is indexed'
);
SELECT ok(
  to_regclass('public.ai_usage_ledger_running_batch_uidx') IS NOT NULL,
  'one-running-Batch-lane invariant is indexed'
);
SELECT is(
  (
    SELECT pg_get_expr(default_value.adbin, default_value.adrelid)
    FROM pg_attrdef AS default_value
    JOIN pg_attribute AS attribute
      ON attribute.attrelid = default_value.adrelid
     AND attribute.attnum = default_value.adnum
    WHERE default_value.adrelid = 'public.lecture_ai_control'::regclass
      AND attribute.attname = 'max_concurrent_operations'
  ),
  '2',
  'new lectures default to the two-lane global ceiling'
);
SELECT ok(
  NOT has_function_privilege(
    'service_role',
    'private.reconcile_lecture_ai_runtime_state(uuid,boolean)',
    'EXECUTE'
  ),
  'runtime-state repair primitive is not an Edge-callable API'
);
SELECT ok(
  (SELECT prosecdef FROM pg_proc
   WHERE oid = 'private.reconcile_lecture_ai_runtime_state(uuid,boolean)'::regprocedure),
  'runtime-state repair primitive is security definer'
);
SELECT is(
  (SELECT proconfig FROM pg_proc
   WHERE oid = 'private.reconcile_lecture_ai_runtime_state(uuid,boolean)'::regprocedure),
  ARRAY['search_path=""']::text[],
  'runtime-state repair primitive fixes an empty search path'
);

CREATE TEMP TABLE p41_fixture (
  lecture_id uuid,
  global_lecture_id uuid,
  caption_operation_id uuid,
  batch_operation_id uuid,
  second_batch_operation_id uuid,
  bundle_grant_id uuid,
  lane_conflict_grant_id uuid,
  result jsonb
);
GRANT SELECT, INSERT, UPDATE ON p41_fixture TO service_role;
INSERT INTO p41_fixture DEFAULT VALUES;

SET LOCAL ROLE service_role;
UPDATE p41_fixture SET
  lecture_id = public.admin_create_lecture(
    'Phase 4.1 two-lane lecture',
    encode(extensions.digest(convert_to('P41-LANES', 'UTF8'), 'sha256'), 'hex'),
    'P41-LANES', null, null
  ),
  global_lecture_id = public.admin_create_lecture(
    'Phase 4.1 global ceiling lecture',
    encode(extensions.digest(convert_to('P41-GLOBAL', 'UTF8'), 'sha256'), 'hex'),
    'P41-GLOBAL', null, null
  );
SELECT ok(
  public.admin_set_lecture_status((SELECT lecture_id FROM p41_fixture), 'start', null),
  'two-lane lecture starts'
);
SELECT ok(
  public.admin_set_lecture_status((SELECT global_lecture_id FROM p41_fixture), 'start', null),
  'global-ceiling lecture starts'
);
SELECT lives_ok(
  $$SELECT public.admin_configure_lecture_ai_control(
    (SELECT lecture_id FROM p41_fixture),
    jsonb_build_object(
      'captions_enabled', true,
      'summaries_enabled', true,
      'material_analysis_enabled', true,
      'poll_suggestions_enabled', true,
      'academic_answers_enabled', true,
      'summary_call_limit', 18,
      'material_analysis_call_limit', 5,
      'poll_generation_limit', 20,
      'academic_answer_limit', 10,
      'max_concurrent_operations', 2
    ),
    'admin-session:p41'
  )$$,
  'two-lane AI control is configured'
);

UPDATE p41_fixture SET result = public.admin_start_lecture_ai_operation(
  lecture_id, 'captions', 'p41-caption-primary',
  100, 60, 0, 0, 'admin-session:p41'
);
UPDATE p41_fixture
SET caption_operation_id = (result #>> '{operation,id}')::uuid;
SELECT is(
  (SELECT result ->> 'accepted' FROM p41_fixture),
  'true',
  'Realtime caption occupies the Realtime lane'
);

UPDATE p41_fixture SET result = public.admin_start_lecture_ai_operation(
  lecture_id, 'material_analysis', 'p41-material-primary',
  100, 0, 100, 20, 'admin-session:p41'
);
UPDATE p41_fixture
SET batch_operation_id = (result #>> '{operation,id}')::uuid;
SELECT is(
  (SELECT result ->> 'accepted' FROM p41_fixture),
  'true',
  'material analysis starts while Realtime captions are running'
);
SELECT is(
  (SELECT active_operation_count FROM public.lecture_ai_control, p41_fixture
   WHERE lecture_session_id = lecture_id),
  2,
  'the cache reports one operation in each lane'
);

SELECT is(
  public.admin_start_lecture_ai_operation(
    (SELECT lecture_id FROM p41_fixture), 'captions', 'p41-caption-duplicate',
    1, 1, 0, 0, 'admin-session:p41'
  ) ->> 'concurrency_lane',
  'realtime',
  'a second caption session is rejected by the Realtime lane'
);
SELECT is(
  public.admin_start_lecture_ai_operation(
    (SELECT lecture_id FROM p41_fixture), 'summaries', 'p41-summary-blocked',
    1, 0, 1, 1, 'admin-session:p41'
  ) ->> 'concurrency_lane',
  'batch',
  'a second bounded text operation is rejected by the Batch lane'
);
SELECT is(
  public.admin_start_lecture_ai_operation(
    (SELECT lecture_id FROM p41_fixture), 'material_analysis', 'p41-material-primary',
    100, 0, 100, 20, 'admin-session:p41'
  ) ->> 'idempotent_replay',
  'true',
  'same-key retry does not reserve a second Batch slot'
);

SELECT is(
  public.admin_finish_lecture_ai_operation(
    (SELECT batch_operation_id FROM p41_fixture),
    'succeeded', 100, 0, 100, 20, 'provider-material', null
  ) ->> 'accepted',
  'true',
  'material analysis finishes successfully'
);
SELECT is(
  (SELECT active_operation_count FROM public.lecture_ai_control, p41_fixture
   WHERE lecture_session_id = lecture_id),
  1,
  'finishing Batch leaves the Realtime slot counted'
);
SELECT is(
  (SELECT status FROM public.lecture_ai_control, p41_fixture
   WHERE lecture_session_id = lecture_id),
  'running',
  'control remains running while Realtime captions continue'
);

UPDATE p41_fixture SET result = public.admin_start_lecture_ai_operation(
  lecture_id, 'summaries', 'p41-summary-primary',
  100, 0, 100, 20, 'admin-session:p41'
);
UPDATE p41_fixture
SET second_batch_operation_id = (result #>> '{operation,id}')::uuid;
SELECT is(
  (SELECT result ->> 'accepted' FROM p41_fixture),
  'true',
  'the Batch lane is reusable while captions continue'
);
SELECT is(
  public.admin_finish_realtime_caption_operation(
    (SELECT caption_operation_id FROM p41_fixture),
    'admin-session:p41', 'admin_manual_stop', false, true
  ) ->> 'accepted',
  'true',
  'caption stop succeeds while Batch remains active'
);
SELECT is(
  (SELECT active_operation_count FROM public.lecture_ai_control, p41_fixture
   WHERE lecture_session_id = lecture_id),
  1,
  'caption stop preserves the running Batch count'
);
SELECT is(
  (SELECT status FROM public.lecture_ai_control, p41_fixture
   WHERE lecture_session_id = lecture_id),
  'running',
  'caption stop does not stop the whole AI control plane'
);
SELECT is(
  public.admin_finish_lecture_ai_operation(
    (SELECT second_batch_operation_id FROM p41_fixture),
    'succeeded', 100, 0, 100, 20, 'provider-summary', null
  ) ->> 'accepted',
  'true',
  'summary finishes after the caption lane stops'
);
SELECT is(
  (SELECT active_operation_count FROM public.lecture_ai_control, p41_fixture
   WHERE lecture_session_id = lecture_id),
  0,
  'both completed lanes converge the cached count to zero'
);
SELECT is(
  (SELECT status FROM public.lecture_ai_control, p41_fixture
   WHERE lecture_session_id = lecture_id),
  'ready',
  'enabled Batch features leave the control plane ready'
);

RESET ROLE;
UPDATE public.lecture_ai_control AS control
SET active_operation_count = 4
FROM p41_fixture
WHERE control.lecture_session_id = p41_fixture.lecture_id;
SELECT lives_ok(
  $$SELECT private.reconcile_lecture_ai_runtime_state(
    (SELECT lecture_id FROM p41_fixture), true
  )$$,
  'ledger reconciliation repairs a deliberately drifted cache'
);
SELECT is(
  (SELECT active_operation_count FROM public.lecture_ai_control, p41_fixture
   WHERE lecture_session_id = lecture_id),
  0,
  'the ledger is authoritative over the cached count'
);

SET LOCAL ROLE service_role;
SELECT lives_ok(
  $$SELECT public.admin_configure_lecture_ai_control(
    (SELECT global_lecture_id FROM p41_fixture),
    jsonb_build_object(
      'captions_enabled', true,
      'summaries_enabled', true,
      'max_concurrent_operations', 1
    ),
    'admin-session:global'
  )$$,
  'global-ceiling fixture is configured in emergency serialization mode'
);
UPDATE p41_fixture SET result = public.admin_start_lecture_ai_operation(
  global_lecture_id, 'captions', 'p41-global-caption',
  1, 1, 0, 0, 'admin-session:global'
);
SELECT is(
  public.admin_start_lecture_ai_operation(
    (SELECT global_lecture_id FROM p41_fixture), 'summaries', 'p41-global-summary',
    1, 0, 1, 1, 'admin-session:global'
  ) ->> 'concurrency_lane',
  'global',
  'max_concurrent_operations=1 intentionally serializes both lanes'
);
SELECT public.admin_finish_realtime_caption_operation(
  (SELECT (result #>> '{operation,id}')::uuid FROM p41_fixture),
  'admin-session:global', 'test_cleanup', false, true
);

-- One grant may atomically start one operation in each lane.
UPDATE p41_fixture SET bundle_grant_id = (
  public.admin_issue_ai_billing_grant(
    lecture_id,
    ARRAY['captions', 'material_analysis'],
    repeat('a', 64), true, 'admin-session:p41'
  ) ->> 'grant_id'
)::uuid;
UPDATE p41_fixture SET result = public.admin_consume_ai_billing_grant(
  bundle_grant_id, repeat('a', 64), lecture_id,
  jsonb_build_array(
    jsonb_build_object(
      'feature', 'captions', 'idempotency_key', 'p41-bundle-caption',
      'estimated_microusd', 1, 'estimated_audio_seconds', 1,
      'estimated_input_tokens', 0, 'estimated_output_tokens', 0,
      'model_id', 'gpt-realtime-whisper', 'pricing_unit', 'audio_minute',
      'pricing_rate_microusd', 1
    ),
    jsonb_build_object(
      'feature', 'material_analysis', 'idempotency_key', 'p41-bundle-material',
      'estimated_microusd', 1, 'estimated_audio_seconds', 0,
      'estimated_input_tokens', 1, 'estimated_output_tokens', 1,
      'model_id', 'phase5-test-model', 'pricing_unit', 'token',
      'pricing_rate_microusd', 1
    )
  ),
  'admin-session:p41'
);
SELECT is(
  (SELECT result ->> 'accepted' FROM p41_fixture),
  'true',
  'billing grant atomically starts one Realtime and one Batch operation'
);
SELECT is(
  (SELECT active_operation_count FROM public.lecture_ai_control, p41_fixture
   WHERE lecture_session_id = lecture_id),
  2,
  'two-operation grant reserves both lanes'
);
SELECT is(
  (SELECT status FROM public.ai_billing_grants, p41_fixture
   WHERE id = bundle_grant_id),
  'consumed',
  'successful two-lane grant is consumed once'
);
SELECT is(
  public.admin_stop_lecture_ai_control(
    (SELECT lecture_id FROM p41_fixture), 'p41-bundle-stop', 'admin-session:p41'
  ) ->> 'active_operation_count',
  '0',
  'manual stop atomically clears both lanes'
);
SELECT is(
  (SELECT count(*)::integer FROM public.ai_usage_ledger, p41_fixture
   WHERE lecture_session_id = lecture_id AND status = 'running'),
  0,
  'manual stop leaves no running ledger row'
);

UPDATE p41_fixture SET lane_conflict_grant_id = (
  public.admin_issue_ai_billing_grant(
    lecture_id,
    ARRAY['summaries', 'poll_suggestions'],
    repeat('b', 64), true, 'admin-session:p41'
  ) ->> 'grant_id'
)::uuid;
UPDATE p41_fixture SET result = public.admin_consume_ai_billing_grant(
  lane_conflict_grant_id, repeat('b', 64), lecture_id,
  jsonb_build_array(
    jsonb_build_object(
      'feature', 'summaries', 'idempotency_key', 'p41-conflict-summary',
      'estimated_microusd', 1, 'estimated_audio_seconds', 0,
      'estimated_input_tokens', 1, 'estimated_output_tokens', 1,
      'model_id', 'phase5-test-model', 'pricing_unit', 'token',
      'pricing_rate_microusd', 1
    ),
    jsonb_build_object(
      'feature', 'poll_suggestions', 'idempotency_key', 'p41-conflict-poll',
      'estimated_microusd', 1, 'estimated_audio_seconds', 0,
      'estimated_input_tokens', 1, 'estimated_output_tokens', 1,
      'model_id', 'phase5-test-model', 'pricing_unit', 'token',
      'pricing_rate_microusd', 1
    )
  ),
  'admin-session:p41'
);
SELECT is(
  (SELECT result ->> 'reason' FROM p41_fixture),
  'grant_lane_conflict',
  'a grant cannot start two Batch operations together'
);
SELECT is(
  (SELECT status FROM public.ai_billing_grants, p41_fixture
   WHERE id = lane_conflict_grant_id),
  'issued',
  'lane-conflict rejection leaves the one-use grant unconsumed'
);

-- The indexes remain a final invariant even if a privileged caller bypasses RPCs.
RESET ROLE;
INSERT INTO public.ai_usage_ledger (
  lecture_session_id, feature, idempotency_key, requested_by_actor
)
SELECT lecture_id, 'captions', 'p41-direct-caption-one', 'migration-test'
FROM p41_fixture;
SELECT throws_ok(
  $$INSERT INTO public.ai_usage_ledger (
      lecture_session_id, feature, idempotency_key, requested_by_actor
    )
    SELECT lecture_id, 'captions', 'p41-direct-caption-two', 'migration-test'
    FROM p41_fixture$$,
  '23505',
  'duplicate key value violates unique constraint "ai_usage_ledger_running_realtime_uidx"',
  'partial unique index rejects direct duplicate Realtime rows'
);
UPDATE public.ai_usage_ledger
SET status = 'cancelled', finished_at = statement_timestamp()
WHERE idempotency_key = 'p41-direct-caption-one';
INSERT INTO public.ai_usage_ledger (
  lecture_session_id, feature, idempotency_key, requested_by_actor
)
SELECT lecture_id, 'summaries', 'p41-direct-batch-one', 'migration-test'
FROM p41_fixture;
SELECT throws_ok(
  $$INSERT INTO public.ai_usage_ledger (
      lecture_session_id, feature, idempotency_key, requested_by_actor
    )
    SELECT lecture_id, 'academic_answers', 'p41-direct-batch-two', 'migration-test'
    FROM p41_fixture$$,
  '23505',
  'duplicate key value violates unique constraint "ai_usage_ledger_running_batch_uidx"',
  'partial unique index rejects direct duplicate Batch rows'
);
UPDATE public.ai_usage_ledger
SET status = 'cancelled', finished_at = statement_timestamp()
WHERE idempotency_key = 'p41-direct-batch-one';
SELECT private.reconcile_lecture_ai_runtime_state(
  (SELECT lecture_id FROM p41_fixture), true
);

-- A stale caption recovery releases only the Realtime lane.
SET LOCAL ROLE service_role;
SELECT public.admin_configure_lecture_ai_control(
  (SELECT lecture_id FROM p41_fixture),
  jsonb_build_object(
    'captions_enabled', true,
    'summaries_enabled', true,
    'max_concurrent_operations', 2
  ),
  'admin-session:p41'
);
UPDATE p41_fixture SET result = public.admin_start_lecture_ai_operation(
  lecture_id, 'captions', 'p41-stale-caption',
  1, 1, 0, 0, 'admin-session:p41'
);
UPDATE p41_fixture
SET caption_operation_id = (result #>> '{operation,id}')::uuid;
UPDATE p41_fixture SET result = public.admin_start_lecture_ai_operation(
  lecture_id, 'summaries', 'p41-stale-summary',
  1, 0, 1, 1, 'admin-session:p41'
);
UPDATE p41_fixture
SET batch_operation_id = (result #>> '{operation,id}')::uuid;
RESET ROLE;
UPDATE public.ai_usage_ledger AS usage
SET last_heartbeat_at = statement_timestamp() - interval '46 seconds'
FROM p41_fixture
WHERE usage.id = p41_fixture.caption_operation_id;
SET LOCAL ROLE service_role;
SELECT is(
  (SELECT count(*)::integer
   FROM public.admin_reap_stale_realtime_caption_operations(
     (SELECT lecture_id FROM p41_fixture), 20
   )),
  1,
  'stale Realtime session is reaped'
);
SELECT is(
  (SELECT active_operation_count FROM public.lecture_ai_control, p41_fixture
   WHERE lecture_session_id = lecture_id),
  1,
  'stale Realtime recovery preserves the running Batch slot'
);
SELECT is(
  (SELECT status FROM public.ai_usage_ledger, p41_fixture
   WHERE id = batch_operation_id),
  'running',
  'stale Realtime recovery does not cancel Batch work'
);
SELECT public.admin_finish_lecture_ai_operation(
  (SELECT batch_operation_id FROM p41_fixture),
  'succeeded', 1, 0, 1, 1, 'provider-stale-summary', null
);

-- Unified lecture close cancels both lanes and late completion is rejected.
SELECT public.admin_configure_lecture_ai_control(
  (SELECT lecture_id FROM p41_fixture),
  jsonb_build_object(
    'captions_enabled', true,
    'material_analysis_enabled', true,
    'max_concurrent_operations', 2
  ),
  'admin-session:p41'
);
UPDATE p41_fixture SET result = public.admin_start_lecture_ai_operation(
  lecture_id, 'captions', 'p41-close-caption',
  1, 1, 0, 0, 'admin-session:p41'
);
UPDATE p41_fixture
SET caption_operation_id = (result #>> '{operation,id}')::uuid;
UPDATE p41_fixture SET result = public.admin_start_lecture_ai_operation(
  lecture_id, 'material_analysis', 'p41-close-material',
  1, 0, 1, 1, 'admin-session:p41'
);
UPDATE p41_fixture
SET batch_operation_id = (result #>> '{operation,id}')::uuid;
SELECT ok(
  public.admin_set_lecture_status((SELECT lecture_id FROM p41_fixture), 'close', null),
  'unified lecture close succeeds with both lanes running'
);
SELECT is(
  (SELECT count(*)::integer FROM public.ai_usage_ledger, p41_fixture
   WHERE lecture_session_id = lecture_id AND status = 'running'),
  0,
  'unified close leaves no running operation'
);
SELECT is(
  (SELECT active_operation_count FROM public.lecture_ai_control, p41_fixture
   WHERE lecture_session_id = lecture_id),
  0,
  'unified close resets the cache to zero'
);
SELECT is(
  public.admin_finish_lecture_ai_operation(
    (SELECT batch_operation_id FROM p41_fixture),
    'succeeded', 1, 0, 1, 1, 'late-provider-result', null
  ) ->> 'accepted',
  'false',
  'late Batch completion is not accepted after lecture close'
);

SELECT * FROM finish();
ROLLBACK;
