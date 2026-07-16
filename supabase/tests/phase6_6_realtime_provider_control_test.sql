BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path = public, extensions;
SELECT no_plan();

-- Browser isolation and service-only provider lifecycle.
SELECT has_table(
  'public',
  'ai_realtime_provider_calls',
  'Realtime provider call lifecycle table exists'
);
SELECT ok(
  (
    SELECT relrowsecurity
    FROM pg_class
    WHERE oid = 'public.ai_realtime_provider_calls'::regclass
  ),
  'Realtime provider call lifecycle has RLS enabled'
);
SELECT ok(
  NOT has_table_privilege(
    'authenticated',
    'public.ai_realtime_provider_calls',
    'SELECT'
  ),
  'browser cannot inspect provider call identifiers'
);
SELECT ok(
  NOT has_function_privilege(
    'authenticated',
    'public.claim_realtime_provider_hangups(integer,uuid,uuid)',
    'EXECUTE'
  ),
  'browser cannot claim provider hangup jobs'
);
SELECT ok(
  has_function_privilege(
    'service_role',
    'public.claim_realtime_provider_hangups(integer,uuid,uuid)',
    'EXECUTE'
  ),
  'Edge service role can claim provider hangup jobs'
);
SELECT ok(
  to_regclass('public.ai_realtime_provider_calls_claim_idx') IS NOT NULL,
  'provider hangup due-work lookup is indexed'
);
SELECT ok(
  NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'ai_realtime_provider_calls'
  ),
  'provider lifecycle adds no Supabase Realtime fanout'
);

CREATE TEMP TABLE p66_realtime_fixture (
  lecture_id uuid,
  prepared_lecture_id uuid,
  timeout_lecture_id uuid,
  grant_id uuid,
  replay_grant_id uuid,
  prepared_grant_id uuid,
  timeout_grant_id uuid,
  operation_id uuid,
  prepared_operation_id uuid,
  timeout_operation_id uuid,
  result jsonb
);
GRANT SELECT, INSERT, UPDATE ON p66_realtime_fixture TO service_role;
INSERT INTO p66_realtime_fixture DEFAULT VALUES;

SET LOCAL ROLE service_role;
UPDATE p66_realtime_fixture
SET
  lecture_id = public.admin_create_lecture(
    'Phase 6.6 provider lifecycle',
    encode(
      extensions.digest(convert_to('765401', 'UTF8'), 'sha256'),
      'hex'
    ),
    '765401',
    null,
    null
  ),
  prepared_lecture_id = public.admin_create_lecture(
    'Phase 6.6 provider preparation timeout',
    encode(
      extensions.digest(convert_to('765402', 'UTF8'), 'sha256'),
      'hex'
    ),
    '765402',
    null,
    null
  ),
  timeout_lecture_id = public.admin_create_lecture(
    'Phase 6.6 activated provider timeout',
    encode(
      extensions.digest(convert_to('765403', 'UTF8'), 'sha256'),
      'hex'
    ),
    '765403',
    null,
    null
  );
SELECT ok(
  public.admin_set_lecture_status(
    (SELECT lecture_id FROM p66_realtime_fixture),
    'start',
    null
  ),
  'provider lifecycle lecture starts'
);
SELECT ok(
  public.admin_set_lecture_status(
    (SELECT prepared_lecture_id FROM p66_realtime_fixture),
    'start',
    null
  ),
  'prepared-call timeout lecture starts'
);
SELECT ok(
  public.admin_set_lecture_status(
    (SELECT timeout_lecture_id FROM p66_realtime_fixture),
    'start',
    null
  ),
  'activated-call timeout lecture starts'
);

UPDATE p66_realtime_fixture
SET grant_id = (
  public.admin_issue_ai_billing_grant(
    lecture_id,
    ARRAY['captions'],
    repeat('1', 64),
    true,
    'admin-session:provider'
  ) ->> 'grant_id'
)::uuid;
UPDATE p66_realtime_fixture
SET result = public.admin_consume_realtime_billing_grant(
  grant_id,
  repeat('1', 64),
  lecture_id,
  jsonb_build_array(
    jsonb_build_object(
      'feature', 'captions',
      'idempotency_key', 'provider-lifecycle-primary',
      'estimated_microusd', 34000,
      'estimated_audio_seconds', 120,
      'estimated_input_tokens', 0,
      'estimated_output_tokens', 0,
      'model_id', 'gpt-realtime-whisper',
      'pricing_unit', 'audio_minute',
      'pricing_rate_microusd', 17000
    )
  ),
  'admin-session:provider'
);
UPDATE p66_realtime_fixture
SET operation_id = (result #>> '{operations,0,operation,id}')::uuid;
SELECT is(
  (SELECT result ->> 'accepted' FROM p66_realtime_fixture),
  'true',
  'billing grant and provider-call preparation commit atomically'
);
SELECT is(
  (
    SELECT provider_call.status
    FROM public.ai_realtime_provider_calls AS provider_call,
      p66_realtime_fixture AS fixture
    WHERE provider_call.operation_id = fixture.operation_id
  ),
  'creating',
  'new operation has a provider-call preparation row'
);

UPDATE p66_realtime_fixture
SET replay_grant_id = (
  public.admin_issue_ai_billing_grant(
    lecture_id,
    ARRAY['captions'],
    repeat('2', 64),
    true,
    'admin-session:provider'
  ) ->> 'grant_id'
)::uuid;
SELECT is(
  (
    SELECT public.admin_consume_realtime_billing_grant(
      fixture.replay_grant_id,
      repeat('2', 64),
      fixture.lecture_id,
      jsonb_build_array(
        jsonb_build_object(
          'feature', 'captions',
          'idempotency_key', 'provider-lifecycle-primary',
          'estimated_microusd', 34000,
          'estimated_audio_seconds', 120,
          'estimated_input_tokens', 0,
          'estimated_output_tokens', 0,
          'model_id', 'gpt-realtime-whisper',
          'pricing_unit', 'audio_minute',
          'pricing_rate_microusd', 17000
        )
      ),
      'admin-session:provider'
    ) ->> 'reason'
    FROM p66_realtime_fixture AS fixture
  ),
  'idempotent_replay',
  'same start key cannot allocate another provider operation'
);
SELECT is(
  (
    SELECT grant_row.status
    FROM public.ai_billing_grants AS grant_row,
      p66_realtime_fixture AS fixture
    WHERE grant_row.id = fixture.replay_grant_id
  ),
  'issued',
  'idempotent request detection does not consume a fresh billing grant'
);
SELECT is(
  (
    SELECT count(*)::integer
    FROM public.ai_usage_ledger AS usage,
      p66_realtime_fixture AS fixture
    WHERE usage.lecture_session_id = fixture.lecture_id
      AND usage.idempotency_key = 'provider-lifecycle-primary'
  ),
  1,
  'idempotent start leaves exactly one usage operation'
);

SELECT throws_ok(
  $$
    SELECT public.admin_activate_realtime_provider_call(
      operation_id,
      'admin-session:other',
      'rtc_wrong_actor',
      null
    )
    FROM p66_realtime_fixture
  $$,
  '42501',
  'Realtime provider call is not available',
  'another admin actor cannot register the provider call'
);
SELECT is(
  (
    SELECT public.admin_activate_realtime_provider_call(
      fixture.operation_id,
      'admin-session:provider',
      'rtc_provider_primary',
      'req-provider-primary'
    ) ->> 'accepted'
    FROM p66_realtime_fixture AS fixture
  ),
  'true',
  'owning Edge flow activates the provider call'
);
SELECT is(
  (
    SELECT public.admin_activate_realtime_provider_call(
      fixture.operation_id,
      'admin-session:provider',
      'rtc_provider_primary',
      'req-provider-primary'
    ) ->> 'idempotent_replay'
    FROM p66_realtime_fixture AS fixture
  ),
  'true',
  'same provider activation is idempotent'
);

SELECT is(
  (
    SELECT public.admin_publish_lecture_caption(
      fixture.lecture_id,
      fixture.operation_id,
      'Newest five-second caption.',
      'en',
      'item-sequence-2',
      2,
      'admin-session:provider'
    ) ->> 'changed'
    FROM p66_realtime_fixture AS fixture
  ),
  'true',
  'newer completed caption window is published'
);
SELECT is(
  (
    SELECT public.admin_publish_lecture_caption(
      fixture.lecture_id,
      fixture.operation_id,
      'Delayed old caption.',
      'en',
      'item-sequence-1',
      1,
      'admin-session:provider'
    ) ->> 'reason'
    FROM p66_realtime_fixture AS fixture
  ),
  'stale_sequence',
  'delayed lower sequence cannot replace the current caption'
);
SELECT is(
  (
    SELECT public.admin_publish_lecture_caption(
      fixture.lecture_id,
      fixture.operation_id,
      'Conflicting same sequence.',
      'en',
      'item-sequence-2-conflict',
      2,
      'admin-session:provider'
    ) ->> 'reason'
    FROM p66_realtime_fixture AS fixture
  ),
  'sequence_conflict',
  'same sequence with different content is rejected'
);
SELECT is(
  (
    SELECT caption.text
    FROM public.lecture_public_captions AS caption,
      p66_realtime_fixture AS fixture
    WHERE caption.lecture_session_id = fixture.lecture_id
  ),
  'Newest five-second caption.',
  'reordered delivery preserves the newest caption content'
);

SELECT is(
  (
    SELECT public.admin_finish_realtime_caption_operation(
      fixture.operation_id,
      'admin-session:provider',
      'admin_manual_stop',
      true,
      true
    ) ->> 'accepted'
    FROM p66_realtime_fixture AS fixture
  ),
  'true',
  'canonical caption stop succeeds'
);
SELECT is(
  (
    SELECT provider_call.status
    FROM public.ai_realtime_provider_calls AS provider_call,
      p66_realtime_fixture AS fixture
    WHERE provider_call.operation_id = fixture.operation_id
  ),
  'stop_requested',
  'usage stop transaction atomically queues provider hangup'
);
SELECT is(
  (
    SELECT count(*)::integer
    FROM public.claim_realtime_provider_hangups(
      10,
      (SELECT operation_id FROM p66_realtime_fixture),
      null
    )
  ),
  1,
  'provider hangup job is claimed once'
);
SELECT is(
  (
    SELECT provider_call.status
    FROM public.ai_realtime_provider_calls AS provider_call,
      p66_realtime_fixture AS fixture
    WHERE provider_call.operation_id = fixture.operation_id
  ),
  'hanging_up',
  'claim establishes the hangup lease'
);
SELECT ok(
  public.finish_realtime_provider_hangup(
    (SELECT operation_id FROM p66_realtime_fixture),
    false,
    'provider unavailable'
  ),
  'provider failure is finalized for retry'
);
SELECT ok(
  (
    SELECT
      provider_call.status = 'retry'
      AND provider_call.next_attempt_at > statement_timestamp()
      AND provider_call.last_error = 'provider unavailable'
    FROM public.ai_realtime_provider_calls AS provider_call,
      p66_realtime_fixture AS fixture
    WHERE provider_call.operation_id = fixture.operation_id
  ),
  'failed provider hangup receives bounded delayed retry state'
);
RESET ROLE;
UPDATE public.ai_realtime_provider_calls AS provider_call
SET next_attempt_at = statement_timestamp() - interval '1 second'
FROM p66_realtime_fixture AS fixture
WHERE provider_call.operation_id = fixture.operation_id;
SET LOCAL ROLE service_role;
SELECT is(
  (
    SELECT count(*)::integer
    FROM public.claim_realtime_provider_hangups(
      10,
      (SELECT operation_id FROM p66_realtime_fixture),
      null
    )
  ),
  1,
  'due provider hangup retry can be reclaimed'
);
SELECT ok(
  public.finish_realtime_provider_hangup(
    (SELECT operation_id FROM p66_realtime_fixture),
    true,
    null
  ),
  'successful provider hangup finalizes the outbox row'
);
SELECT is(
  (
    SELECT provider_call.status
    FROM public.ai_realtime_provider_calls AS provider_call,
      p66_realtime_fixture AS fixture
    WHERE provider_call.operation_id = fixture.operation_id
  ),
  'stopped',
  'provider call reaches terminal stopped state'
);
SELECT ok(
  public.finish_realtime_provider_hangup(
    (SELECT operation_id FROM p66_realtime_fixture),
    true,
    null
  ),
  'provider hangup finalization replay is idempotent'
);

-- A call that never reached OpenAI must not be billed.
UPDATE p66_realtime_fixture
SET prepared_grant_id = (
  public.admin_issue_ai_billing_grant(
    prepared_lecture_id,
    ARRAY['captions'],
    repeat('3', 64),
    true,
    'admin-session:prepared'
  ) ->> 'grant_id'
)::uuid;
UPDATE p66_realtime_fixture
SET result = public.admin_consume_realtime_billing_grant(
  prepared_grant_id,
  repeat('3', 64),
  prepared_lecture_id,
  jsonb_build_array(
    jsonb_build_object(
      'feature', 'captions',
      'idempotency_key', 'provider-prepared-timeout',
      'estimated_microusd', 34000,
      'estimated_audio_seconds', 120,
      'estimated_input_tokens', 0,
      'estimated_output_tokens', 0,
      'model_id', 'gpt-realtime-whisper',
      'pricing_unit', 'audio_minute',
      'pricing_rate_microusd', 17000
    )
  ),
  'admin-session:prepared'
);
UPDATE p66_realtime_fixture
SET prepared_operation_id =
  (result #>> '{operations,0,operation,id}')::uuid;
RESET ROLE;
UPDATE public.ai_usage_ledger AS usage
SET last_heartbeat_at = statement_timestamp() - interval '46 seconds'
FROM p66_realtime_fixture AS fixture
WHERE usage.id = fixture.prepared_operation_id;
SET LOCAL ROLE service_role;
SELECT is(
  (
    SELECT count(*)::integer
    FROM public.admin_reap_stale_realtime_caption_operations(
      (SELECT prepared_lecture_id FROM p66_realtime_fixture),
      20
    )
  ),
  1,
  'prepared call without heartbeat is reaped'
);
SELECT ok(
  (
    SELECT
      usage.actual_audio_seconds = 0
      AND usage.actual_microusd = 0
      AND provider_call.status = 'creation_failed'
    FROM public.ai_usage_ledger AS usage
    JOIN public.ai_realtime_provider_calls AS provider_call
      ON provider_call.operation_id = usage.id
    JOIN p66_realtime_fixture AS fixture
      ON fixture.prepared_operation_id = usage.id
  ),
  'prepared but never activated provider call has zero usage charge'
);

-- Once OpenAI accepted the call, timeout accounting charges bounded elapsed time
-- and the same stop transaction creates a hangup job.
UPDATE p66_realtime_fixture
SET timeout_grant_id = (
  public.admin_issue_ai_billing_grant(
    timeout_lecture_id,
    ARRAY['captions'],
    repeat('4', 64),
    true,
    'admin-session:timeout'
  ) ->> 'grant_id'
)::uuid;
UPDATE p66_realtime_fixture
SET result = public.admin_consume_realtime_billing_grant(
  timeout_grant_id,
  repeat('4', 64),
  timeout_lecture_id,
  jsonb_build_array(
    jsonb_build_object(
      'feature', 'captions',
      'idempotency_key', 'provider-activated-timeout',
      'estimated_microusd', 34000,
      'estimated_audio_seconds', 120,
      'estimated_input_tokens', 0,
      'estimated_output_tokens', 0,
      'model_id', 'gpt-realtime-whisper',
      'pricing_unit', 'audio_minute',
      'pricing_rate_microusd', 17000
    )
  ),
  'admin-session:timeout'
);
UPDATE p66_realtime_fixture
SET timeout_operation_id =
  (result #>> '{operations,0,operation,id}')::uuid;
SELECT is(
  (
    SELECT public.admin_activate_realtime_provider_call(
      fixture.timeout_operation_id,
      'admin-session:timeout',
      'rtc_provider_timeout',
      null
    ) ->> 'accepted'
    FROM p66_realtime_fixture AS fixture
  ),
  'true',
  'timeout fixture provider call is activated'
);
RESET ROLE;
UPDATE public.ai_usage_ledger AS usage
SET
  requested_at = statement_timestamp() - interval '61 seconds',
  last_heartbeat_at = statement_timestamp() - interval '46 seconds'
FROM p66_realtime_fixture AS fixture
WHERE usage.id = fixture.timeout_operation_id;
SET LOCAL ROLE service_role;
SELECT is(
  (
    SELECT count(*)::integer
    FROM public.admin_reap_stale_realtime_caption_operations(
      (SELECT timeout_lecture_id FROM p66_realtime_fixture),
      20
    )
  ),
  1,
  'activated call without heartbeat is reaped'
);
SELECT ok(
  (
    SELECT
      usage.actual_audio_seconds BETWEEN 60 AND 120
      AND usage.actual_microusd > 0
      AND usage.actual_microusd <= usage.reserved_microusd
    FROM public.ai_usage_ledger AS usage,
      p66_realtime_fixture AS fixture
    WHERE usage.id = fixture.timeout_operation_id
  ),
  'activated timeout charges only bounded server-observed elapsed usage'
);
SELECT is(
  (
    SELECT provider_call.status
    FROM public.ai_realtime_provider_calls AS provider_call,
      p66_realtime_fixture AS fixture
    WHERE provider_call.operation_id = fixture.timeout_operation_id
  ),
  'stop_requested',
  'activated timeout automatically queues provider hangup'
);

RESET ROLE;
SELECT * FROM finish();
ROLLBACK;
