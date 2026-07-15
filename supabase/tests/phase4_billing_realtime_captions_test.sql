BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path = public, extensions;
SELECT no_plan();

-- Schema, browser boundary, and least privilege.
SELECT has_table('public', 'ai_billing_rate_limits', 'billing PIN rate-limit table exists');
SELECT has_table('public', 'ai_billing_grants', 'one-use billing grant table exists');
SELECT has_table('public', 'lecture_public_captions', 'bounded public caption table exists');
SELECT has_table('public', 'ai_realtime_token_audit', 'content-free Realtime token audit exists');
SELECT has_column('public', 'ai_usage_ledger', 'model_id', 'ledger records model ID');
SELECT has_column('public', 'ai_usage_ledger', 'pricing_unit', 'ledger records pricing unit');
SELECT has_column('public', 'ai_usage_ledger', 'pricing_rate_microusd', 'ledger records price snapshot');
SELECT ok(
  (SELECT bool_and(relrowsecurity)
   FROM pg_class
   WHERE oid IN (
     'public.ai_billing_rate_limits'::regclass,
     'public.ai_billing_grants'::regclass,
     'public.lecture_public_captions'::regclass,
     'public.ai_realtime_token_audit'::regclass
   )),
  'all Phase 4 tables have RLS enabled'
);
SELECT ok(
  NOT has_table_privilege('authenticated', 'public.ai_billing_grants', 'SELECT'),
  'browser cannot read billing grants'
);
SELECT ok(
  NOT has_table_privilege('authenticated', 'public.lecture_public_captions', 'SELECT'),
  'browser cannot bypass snapshot RPC to read captions'
);
SELECT ok(
  NOT has_table_privilege('authenticated', 'public.ai_realtime_token_audit', 'SELECT'),
  'browser cannot read token audit rows'
);
SELECT ok(
  NOT has_function_privilege(
    'authenticated',
    'public.admin_consume_ai_billing_grant(uuid,text,uuid,jsonb,text)',
    'EXECUTE'
  ),
  'browser cannot consume a billing grant'
);
SELECT ok(
  has_function_privilege(
    'service_role',
    'public.admin_consume_ai_billing_grant(uuid,text,uuid,jsonb,text)',
    'EXECUTE'
  ),
  'Edge service role can consume a billing grant'
);
SELECT ok(
  NOT (SELECT prosecdef FROM pg_proc
       WHERE oid = 'public.get_lecture_public_snapshot_v3(uuid,bigint,bigint,bigint,bigint,bigint,bigint,bigint,timestamptz,uuid,integer)'::regprocedure),
  'public v3 snapshot wrapper is security invoker'
);
SELECT ok(
  (SELECT prosecdef FROM pg_proc
   WHERE oid = 'private.get_lecture_public_snapshot_v3(uuid,bigint,bigint,bigint,bigint,bigint,bigint,bigint,timestamptz,uuid,integer)'::regprocedure),
  'private v3 snapshot primitive is security definer'
);
SELECT is(
  (SELECT proconfig FROM pg_proc
   WHERE oid = 'private.get_lecture_public_snapshot_v3(uuid,bigint,bigint,bigint,bigint,bigint,bigint,bigint,timestamptz,uuid,integer)'::regprocedure),
  ARRAY['search_path=""']::text[],
  'private v3 snapshot fixes an empty search path'
);
SELECT ok(
  to_regclass('public.ai_billing_grants_issued_due_idx') IS NOT NULL,
  'grant expiry lookup is indexed'
);
SELECT ok(
  to_regclass('public.ai_realtime_token_audit_lecture_created_idx') IS NOT NULL,
  'token audit lookup is indexed'
);
SELECT ok(
  to_regclass('public.ai_usage_ledger_stale_caption_idx') IS NOT NULL,
  'stale caption heartbeat lookup is indexed'
);
SELECT ok(
  NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename IN (
        'ai_billing_grants', 'lecture_public_captions', 'ai_realtime_token_audit'
      )
  ),
  'Phase 4 adds no Realtime publication load'
);

CREATE TEMP TABLE p4_fixture (
  lecture_id uuid,
  rate_lecture_id uuid,
  unrelated_lecture_id uuid,
  grant_id uuid,
  mismatch_grant_id uuid,
  expired_grant_id uuid,
  budget_grant_id uuid,
  operation_id uuid,
  stale_grant_id uuid,
  stale_operation_id uuid,
  participant_id uuid,
  consume_result jsonb,
  caption_version bigint
);
GRANT SELECT, INSERT, UPDATE ON p4_fixture TO service_role, authenticated;
INSERT INTO p4_fixture DEFAULT VALUES;

SET LOCAL ROLE service_role;
UPDATE p4_fixture SET
  lecture_id = public.admin_create_lecture(
    'Phase 4 caption lecture',
    encode(extensions.digest(convert_to('P4-CAPTION', 'UTF8'), 'sha256'), 'hex'),
    'P4-CAPTION', null, null
  ),
  rate_lecture_id = public.admin_create_lecture(
    'Phase 4 rate lecture',
    encode(extensions.digest(convert_to('P4-RATE', 'UTF8'), 'sha256'), 'hex'),
    'P4-RATE', null, null
  ),
  unrelated_lecture_id = public.admin_create_lecture(
    'Phase 4 unrelated lecture',
    encode(extensions.digest(convert_to('P4-OTHER', 'UTF8'), 'sha256'), 'hex'),
    'P4-OTHER', null, null
  );
SELECT ok(public.admin_set_lecture_status((SELECT lecture_id FROM p4_fixture), 'start', null), 'caption lecture starts');
SELECT ok(public.admin_set_lecture_status((SELECT rate_lecture_id FROM p4_fixture), 'start', null), 'rate-limit lecture starts');
SELECT ok(public.admin_set_lecture_status((SELECT unrelated_lecture_id FROM p4_fixture), 'start', null), 'unrelated lecture starts');

-- Five invalid PIN results lock the lecture for 15 minutes. The DB receives only a boolean.
SELECT is(
  public.admin_issue_ai_billing_grant(
    (SELECT rate_lecture_id FROM p4_fixture), ARRAY['captions'], repeat('1', 64), false, 'admin-session:rate'
  ) ->> 'reason',
  'invalid_pin',
  'first wrong PIN attempt is rejected'
);
SELECT public.admin_issue_ai_billing_grant(
  (SELECT rate_lecture_id FROM p4_fixture), ARRAY['captions'], repeat('2', 64), false, 'admin-session:rate'
);
SELECT public.admin_issue_ai_billing_grant(
  (SELECT rate_lecture_id FROM p4_fixture), ARRAY['captions'], repeat('3', 64), false, 'admin-session:rate'
);
SELECT public.admin_issue_ai_billing_grant(
  (SELECT rate_lecture_id FROM p4_fixture), ARRAY['captions'], repeat('4', 64), false, 'admin-session:rate'
);
SELECT is(
  public.admin_issue_ai_billing_grant(
    (SELECT rate_lecture_id FROM p4_fixture), ARRAY['captions'], repeat('5', 64), false, 'admin-session:rate'
  ) ->> 'reason',
  'rate_limited',
  'fifth wrong PIN attempt locks the lecture'
);
SELECT is(
  public.admin_issue_ai_billing_grant(
    (SELECT rate_lecture_id FROM p4_fixture), ARRAY['captions'], repeat('6', 64), true, 'admin-session:rate'
  ) ->> 'reason',
  'rate_limited',
  'correct PIN cannot bypass an active lockout'
);
RESET ROLE;
SELECT ok(
  (SELECT locked_until > statement_timestamp()
   FROM public.ai_billing_rate_limits, p4_fixture
   WHERE lecture_session_id = rate_lecture_id),
  'lockout expiry is stored server-side'
);

-- A successful PIN creates a short, actor/lecture/action scoped grant.
SET LOCAL ROLE service_role;
UPDATE p4_fixture
SET grant_id = (
  public.admin_issue_ai_billing_grant(
    lecture_id,
    ARRAY['captions'],
    repeat('a', 64),
    true,
    'admin-session:main'
  ) ->> 'grant_id'
)::uuid;
SELECT ok((SELECT grant_id IS NOT NULL FROM p4_fixture), 'correct PIN issues a grant');
SELECT is(
  (SELECT actions FROM public.ai_billing_grants, p4_fixture WHERE id = grant_id),
  ARRAY['captions']::text[],
  'grant stores only canonical actions'
);
SELECT ok(
  (SELECT expires_at <= issued_at + interval '2 minutes'
   FROM public.ai_billing_grants, p4_fixture WHERE id = grant_id),
  'grant expires within two minutes'
);
SELECT is(
  public.admin_consume_ai_billing_grant(
    (SELECT grant_id FROM p4_fixture), repeat('a', 64),
    (SELECT unrelated_lecture_id FROM p4_fixture),
    jsonb_build_array(jsonb_build_object(
      'feature', 'captions', 'idempotency_key', 'wrong-lecture',
      'estimated_microusd', 17000, 'estimated_audio_seconds', 60,
      'estimated_input_tokens', 0, 'estimated_output_tokens', 0,
      'model_id', 'gpt-realtime-whisper', 'pricing_unit', 'audio_minute',
      'pricing_rate_microusd', 17000
    )),
    'admin-session:main'
  ) ->> 'reason',
  'invalid_grant',
  'grant cannot cross lecture scope'
);
SELECT is(
  public.admin_consume_ai_billing_grant(
    (SELECT grant_id FROM p4_fixture), repeat('a', 64),
    (SELECT lecture_id FROM p4_fixture),
    jsonb_build_array(jsonb_build_object(
      'feature', 'captions', 'idempotency_key', 'wrong-actor',
      'estimated_microusd', 17000, 'estimated_audio_seconds', 60,
      'estimated_input_tokens', 0, 'estimated_output_tokens', 0,
      'model_id', 'gpt-realtime-whisper', 'pricing_unit', 'audio_minute',
      'pricing_rate_microusd', 17000
    )),
    'admin-session:other'
  ) ->> 'reason',
  'invalid_grant',
  'grant cannot cross admin session actor scope'
);

UPDATE p4_fixture
SET consume_result = public.admin_consume_ai_billing_grant(
  grant_id, repeat('a', 64), lecture_id,
  jsonb_build_array(jsonb_build_object(
    'feature', 'captions', 'idempotency_key', 'phase4-caption-start',
    'estimated_microusd', 17000, 'estimated_audio_seconds', 60,
    'estimated_input_tokens', 0, 'estimated_output_tokens', 0,
    'model_id', 'gpt-realtime-whisper', 'pricing_unit', 'audio_minute',
    'pricing_rate_microusd', 17000
  )),
  'admin-session:main'
);
UPDATE p4_fixture
SET operation_id = (consume_result #>> '{operations,0,operation,id}')::uuid;
SELECT is((SELECT consume_result ->> 'accepted' FROM p4_fixture), 'true', 'valid grant starts the caption operation atomically');
SELECT ok((SELECT operation_id IS NOT NULL FROM p4_fixture), 'caption operation ID is returned');
SELECT is(
  (SELECT status FROM public.ai_billing_grants, p4_fixture WHERE id = grant_id),
  'consumed',
  'grant is consumed exactly once'
);
SELECT is(
  (SELECT model_id FROM public.ai_usage_ledger, p4_fixture WHERE id = operation_id),
  'gpt-realtime-whisper',
  'usage ledger snapshots the model ID'
);
SELECT is(
  (SELECT pricing_rate_microusd FROM public.ai_usage_ledger, p4_fixture WHERE id = operation_id),
  17000::bigint,
  'usage ledger snapshots the price used for admission'
);
SELECT is(
  public.admin_consume_ai_billing_grant(
    (SELECT grant_id FROM p4_fixture), repeat('a', 64),
    (SELECT lecture_id FROM p4_fixture),
    jsonb_build_array(jsonb_build_object(
      'feature', 'captions', 'idempotency_key', 'phase4-caption-start',
      'estimated_microusd', 17000, 'estimated_audio_seconds', 60,
      'estimated_input_tokens', 0, 'estimated_output_tokens', 0,
      'model_id', 'gpt-realtime-whisper', 'pricing_unit', 'audio_minute',
      'pricing_rate_microusd', 17000
    )),
    'admin-session:main'
  ) ->> 'reason',
  'grant_not_available',
  'replayed one-use grant cannot start a second operation'
);

-- Completed-only caption publication; unchanged values do not bump live state.
SELECT lives_ok(
  $$SELECT public.admin_publish_lecture_caption(
    (SELECT lecture_id FROM p4_fixture),
    (SELECT operation_id FROM p4_fixture),
    'First completed caption.', 'en', 'item-1', 1, 'admin-session:main'
  )$$,
  'running operation publishes a completed caption window'
);
UPDATE p4_fixture SET caption_version = live.caption_version
FROM public.lecture_live_state AS live
WHERE live.lecture_session_id = p4_fixture.lecture_id;
SELECT lives_ok(
  $$SELECT public.admin_publish_lecture_caption(
    (SELECT lecture_id FROM p4_fixture),
    (SELECT operation_id FROM p4_fixture),
    'First completed caption.', 'en', 'item-1', 1, 'admin-session:main'
  )$$,
  'identical caption publish is an idempotent no-op'
);
SELECT is(
  (SELECT live.caption_version FROM public.lecture_live_state live, p4_fixture
   WHERE live.lecture_session_id = p4_fixture.lecture_id),
  (SELECT caption_version FROM p4_fixture),
  'identical caption does not bump its version'
);
SELECT throws_ok(
  $$SELECT public.admin_publish_lecture_caption(
    (SELECT lecture_id FROM p4_fixture),
    (SELECT operation_id FROM p4_fixture),
    repeat('x', 1001), 'en', 'item-too-long', 2, 'admin-session:main'
  )$$,
  '22023',
  'caption text must contain 1 to 1000 characters',
  'server rejects an oversized student caption window'
);
SELECT throws_ok(
  $$SELECT public.admin_publish_lecture_caption(
    (SELECT unrelated_lecture_id FROM p4_fixture),
    (SELECT operation_id FROM p4_fixture),
    'Cross lecture', 'en', 'item-cross', 2, 'admin-session:main'
  )$$,
  'P0001',
  'caption operation is not running',
  'operation cannot publish into another lecture'
);

-- Membership remains auth.uid()-bound and v3 exposes only the bounded window.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '71000000-0000-4000-8000-000000000001', true);
UPDATE p4_fixture SET participant_id = (
  SELECT participant_id FROM public.join_lecture_by_code('P4-CAPTION')
);
SELECT is(
  public.get_lecture_public_snapshot_v3((SELECT lecture_id FROM p4_fixture)) #>> '{changed,caption,text}',
  'First completed caption.',
  'owned participant receives the latest completed caption window'
);
SELECT set_config('request.jwt.claim.sub', '71000000-0000-4000-8000-000000000099', true);
SELECT is(
  public.get_lecture_public_snapshot_v3((SELECT lecture_id FROM p4_fixture)),
  null::jsonb,
  'unrelated authenticated user receives no lecture snapshot'
);

-- Heartbeat and stop are actor-bound; stopping never requires another grant/PIN.
SET LOCAL ROLE service_role;
SELECT is(
  public.admin_heartbeat_realtime_caption_operation(
    (SELECT operation_id FROM p4_fixture), 'admin-session:other'
  ) ->> 'should_stop',
  'true',
  'unrelated admin actor cannot keep the operation alive'
);
SELECT is(
  public.admin_heartbeat_realtime_caption_operation(
    (SELECT operation_id FROM p4_fixture), 'admin-session:main'
  ) ->> 'should_stop',
  'false',
  'owning admin actor can heartbeat a running caption operation'
);
SELECT is(
  public.admin_finish_realtime_caption_operation(
    (SELECT operation_id FROM p4_fixture), 'admin-session:main',
    'admin_manual_stop', true, true
  ) ->> 'accepted',
  'true',
  'manual stop succeeds without a new billing grant'
);
SELECT is(
  (SELECT count(*)::integer FROM public.lecture_public_captions, p4_fixture
   WHERE lecture_session_id = lecture_id),
  0,
  'stop clears the student caption window'
);
SELECT is(
  public.admin_finish_realtime_caption_operation(
    (SELECT operation_id FROM p4_fixture), 'admin-session:main',
    'admin_manual_stop', true, true
  ) ->> 'idempotent_replay',
  'true',
  'repeated stop is idempotent'
);
SELECT throws_ok(
  $$SELECT public.admin_publish_lecture_caption(
    (SELECT lecture_id FROM p4_fixture),
    (SELECT operation_id FROM p4_fixture),
    'After stop', 'en', 'item-after-stop', 3, 'admin-session:main'
  )$$,
  'P0001',
  'caption operation is not running',
  'stopped operation cannot publish captions'
);

-- Browser crashes do not strand the concurrency/budget reservation forever.
UPDATE p4_fixture SET stale_grant_id = (
  public.admin_issue_ai_billing_grant(
    lecture_id, ARRAY['captions'], repeat('f', 64), true, 'admin-session:main'
  ) ->> 'grant_id'
)::uuid;
UPDATE p4_fixture SET consume_result = public.admin_consume_ai_billing_grant(
  stale_grant_id, repeat('f', 64), lecture_id,
  jsonb_build_array(jsonb_build_object(
    'feature', 'captions', 'idempotency_key', 'stale-caption-start',
    'estimated_microusd', 1, 'estimated_audio_seconds', 1,
    'estimated_input_tokens', 0, 'estimated_output_tokens', 0,
    'model_id', 'gpt-realtime-whisper', 'pricing_unit', 'audio_minute',
    'pricing_rate_microusd', 17000
  )), 'admin-session:main'
);
UPDATE p4_fixture
SET stale_operation_id = (consume_result #>> '{operations,0,operation,id}')::uuid;
RESET ROLE;
UPDATE public.ai_usage_ledger AS usage
SET last_heartbeat_at = statement_timestamp() - interval '46 seconds'
FROM p4_fixture
WHERE usage.id = p4_fixture.stale_operation_id;
SET LOCAL ROLE service_role;
SELECT is(
  (SELECT count(*)::integer
   FROM public.admin_reap_stale_realtime_caption_operations(
     (SELECT lecture_id FROM p4_fixture), 20
   )),
  1,
  '45-second heartbeat timeout reaps a crashed caption operation'
);
SELECT is(
  (SELECT status FROM public.ai_usage_ledger, p4_fixture
   WHERE id = stale_operation_id),
  'cancelled',
  'stale operation is cancelled and no longer reserves concurrency'
);
SELECT is(
  (SELECT count(*)::integer
   FROM public.admin_reap_stale_realtime_caption_operations(
     (SELECT lecture_id FROM p4_fixture), 20
   )),
  0,
  'stale-operation reaper retry is idempotent'
);

-- Expiry, action scoping, and budget protection.
UPDATE p4_fixture SET expired_grant_id = (
  public.admin_issue_ai_billing_grant(
    lecture_id, ARRAY['captions'], repeat('b', 64), true, 'admin-session:main'
  ) ->> 'grant_id'
)::uuid;
RESET ROLE;
UPDATE public.ai_billing_grants AS grant_row
SET
  issued_at = statement_timestamp() - interval '3 minutes',
  expires_at = statement_timestamp() - interval '1 second'
FROM p4_fixture
WHERE grant_row.id = p4_fixture.expired_grant_id;
SET LOCAL ROLE service_role;
SELECT is(
  public.admin_consume_ai_billing_grant(
    (SELECT expired_grant_id FROM p4_fixture), repeat('b', 64),
    (SELECT lecture_id FROM p4_fixture),
    jsonb_build_array(jsonb_build_object(
      'feature', 'captions', 'idempotency_key', 'expired-grant',
      'estimated_microusd', 1, 'estimated_audio_seconds', 1,
      'estimated_input_tokens', 0, 'estimated_output_tokens', 0,
      'model_id', 'gpt-realtime-whisper', 'pricing_unit', 'audio_minute',
      'pricing_rate_microusd', 17000
    )), 'admin-session:main'
  ) ->> 'reason',
  'grant_expired',
  'expired grant cannot start paid work'
);
UPDATE p4_fixture SET mismatch_grant_id = (
  public.admin_issue_ai_billing_grant(
    lecture_id, ARRAY['captions'], repeat('c', 64), true, 'admin-session:main'
  ) ->> 'grant_id'
)::uuid;
SELECT is(
  public.admin_consume_ai_billing_grant(
    (SELECT mismatch_grant_id FROM p4_fixture), repeat('c', 64),
    (SELECT lecture_id FROM p4_fixture),
    jsonb_build_array(jsonb_build_object(
      'feature', 'summaries', 'idempotency_key', 'scope-mismatch',
      'estimated_microusd', 1, 'estimated_audio_seconds', 0,
      'estimated_input_tokens', 1, 'estimated_output_tokens', 1,
      'model_id', 'gpt-5-mini', 'pricing_unit', 'token',
      'pricing_rate_microusd', 1
    )), 'admin-session:main'
  ) ->> 'reason',
  'grant_scope_mismatch',
  'grant cannot enable an action absent from its PIN confirmation'
);
RESET ROLE;
UPDATE public.lecture_ai_control AS control
SET budget_limit_microusd = control.used_microusd
FROM p4_fixture
WHERE control.lecture_session_id = p4_fixture.lecture_id;
SET LOCAL ROLE service_role;
UPDATE p4_fixture SET budget_grant_id = (
  public.admin_issue_ai_billing_grant(
    lecture_id, ARRAY['captions'], repeat('d', 64), true, 'admin-session:main'
  ) ->> 'grant_id'
)::uuid;
SELECT throws_ok(
  $$SELECT public.admin_consume_ai_billing_grant(
    (SELECT budget_grant_id FROM p4_fixture), repeat('d', 64),
    (SELECT lecture_id FROM p4_fixture),
    jsonb_build_array(jsonb_build_object(
      'feature', 'captions', 'idempotency_key', 'budget-rejected',
      'estimated_microusd', 1, 'estimated_audio_seconds', 1,
      'estimated_input_tokens', 0, 'estimated_output_tokens', 0,
      'model_id', 'gpt-realtime-whisper', 'pricing_unit', 'audio_minute',
      'pricing_rate_microusd', 17000
    )), 'admin-session:main'
  )$$,
  'P0001',
  'AI operation rejected: budget_limit',
  'billing grant cannot bypass the lecture budget limit'
);

-- Lecture closure removes any public caption and all further starts are denied.
SELECT ok(
  public.admin_set_lecture_status((SELECT lecture_id FROM p4_fixture), 'close', null),
  'lecture closes through the existing unified transition'
);
SELECT is(
  public.admin_issue_ai_billing_grant(
    (SELECT lecture_id FROM p4_fixture), ARRAY['captions'], repeat('e', 64), true, 'admin-session:main'
  ) ->> 'reason',
  'lecture_not_open',
  'closed lecture rejects new billing grants'
);

SELECT * FROM finish();
ROLLBACK;
