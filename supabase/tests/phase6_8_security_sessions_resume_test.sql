BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path = public, extensions;
SELECT no_plan();

SELECT has_table('public', 'admin_sessions', 'tracked Admin session table exists');
SELECT has_table('public', 'admin_pin_rate_limits', 'Admin PIN throttle table exists');
SELECT ok(
  (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.admin_sessions'::regclass),
  'Admin sessions have RLS enabled'
);
SELECT ok(
  NOT has_table_privilege('authenticated', 'public.admin_sessions', 'SELECT'),
  'browser clients cannot inspect Admin sessions'
);
SELECT ok(
  NOT has_function_privilege(
    'authenticated',
    'public.consume_admin_pin_rate_limit(text,text,text)',
    'EXECUTE'
  ),
  'browser clients cannot consume or reset server PIN throttle buckets'
);
SELECT ok(
  has_function_privilege(
    'service_role',
    'public.verify_and_touch_admin_session(uuid,text,text)',
    'EXECUTE'
  ),
  'Edge service role can verify tracked Admin sessions'
);
SELECT ok(
  to_regclass('public.admin_sessions_active_expiry_idx') IS NOT NULL
  AND to_regclass('public.admin_pin_rate_limits_cleanup_idx') IS NOT NULL,
  'session expiry and throttle cleanup lookups are indexed'
);
SELECT ok(
  NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename IN ('admin_sessions', 'admin_pin_rate_limits')
  ),
  'security state adds no Realtime fanout'
);

SET LOCAL ROLE service_role;

SELECT ok(
  bool_and(
    (public.consume_admin_pin_rate_limit(
      repeat('1', 64), repeat('2', 64), repeat('3', 64)
    ) ->> 'allowed')::boolean
  ),
  'first eight user PIN attempts are admitted'
)
FROM generate_series(1, 8);
SELECT is(
  public.consume_admin_pin_rate_limit(
    repeat('1', 64), repeat('2', 64), repeat('3', 64)
  ) ->> 'allowed',
  'false',
  'ninth user PIN attempt is application-rate-limited'
);
SELECT public.reset_admin_pin_rate_limit(repeat('1', 64), repeat('2', 64));
SELECT is(
  public.consume_admin_pin_rate_limit(
    repeat('1', 64), repeat('2', 64), repeat('4', 64)
  ) ->> 'allowed',
  'true',
  'successful authentication can reset user and trusted-network buckets'
);
SELECT ok(
  bool_and(
    (public.consume_admin_pin_rate_limit(
      encode(extensions.digest(convert_to('rotated-' || attempt, 'UTF8'), 'sha256'), 'hex'),
      repeat('8', 64),
      encode(extensions.digest(convert_to('global-' || attempt, 'UTF8'), 'sha256'), 'hex')
    ) ->> 'allowed')::boolean
  ),
  'first thirty rotated identities remain bounded by one trusted-network bucket'
)
FROM generate_series(1, 30) AS attempts(attempt);
SELECT is(
  public.consume_admin_pin_rate_limit(
    repeat('9', 64), repeat('8', 64), repeat('0', 64)
  ) ->> 'allowed',
  'false',
  'trusted-network bucket blocks the thirty-first rotated identity'
);

INSERT INTO public.admin_sessions (
  id, token_hash, auth_user_id, pin_version_hash,
  issued_at, last_seen_at, idle_expires_at, expires_at
) VALUES (
  '68000000-0000-4000-8000-000000000001',
  repeat('a', 64),
  '68000000-0000-4000-8000-000000000101',
  repeat('b', 64),
  statement_timestamp() - interval '10 minutes',
  statement_timestamp() - interval '6 minutes',
  statement_timestamp() + interval '10 minutes',
  statement_timestamp() + interval '2 hours'
);
SELECT ok(
  public.verify_and_touch_admin_session(
    '68000000-0000-4000-8000-000000000001',
    repeat('a', 64), repeat('b', 64)
  ) IS NOT NULL,
  'valid tracked Admin session is accepted'
);
SELECT ok(
  (SELECT last_seen_at > statement_timestamp() - interval '1 minute'
   FROM public.admin_sessions
   WHERE id = '68000000-0000-4000-8000-000000000001'),
  'tracked Admin session receives a rate-limited activity touch'
);
SELECT is(
  public.verify_and_touch_admin_session(
    '68000000-0000-4000-8000-000000000001',
    repeat('a', 64), repeat('c', 64)
  ),
  NULL,
  'PIN rotation fingerprint invalidates an existing session'
);
SELECT is(
  (SELECT revoke_reason FROM public.admin_sessions
   WHERE id = '68000000-0000-4000-8000-000000000001'),
  'pin_rotated',
  'PIN-rotation invalidation is auditable'
);

INSERT INTO public.admin_sessions (
  id, token_hash, auth_user_id, pin_version_hash,
  issued_at, last_seen_at, idle_expires_at, expires_at
) VALUES (
  '68000000-0000-4000-8000-000000000002',
  repeat('d', 64),
  '68000000-0000-4000-8000-000000000102',
  repeat('e', 64),
  statement_timestamp() - interval '2 hours',
  statement_timestamp() - interval '1 hour',
  statement_timestamp() - interval '30 minutes',
  statement_timestamp() + interval '1 hour'
);
SELECT is(
  public.verify_and_touch_admin_session(
    '68000000-0000-4000-8000-000000000002',
    repeat('d', 64), repeat('e', 64)
  ),
  NULL,
  'idle-expired Admin session is rejected'
);
SELECT is(
  (SELECT revoke_reason FROM public.admin_sessions
   WHERE id = '68000000-0000-4000-8000-000000000002'),
  'inactivity_expiry',
  'idle expiry is recorded for audit'
);

CREATE TEMP TABLE phase68_fixture (
  lecture_id uuid,
  provider_lecture_id uuid,
  operation_id uuid,
  result jsonb
);
GRANT SELECT, INSERT, UPDATE ON phase68_fixture TO service_role;
INSERT INTO phase68_fixture DEFAULT VALUES;
UPDATE phase68_fixture SET
  lecture_id = public.admin_create_lecture(
    'Phase 6.8 resume token', repeat('5', 64), '680001', null, null
  ),
  provider_lecture_id = public.admin_create_lecture(
    'Phase 6.8 provider request', repeat('6', 64), '680002', null, null
  );
SELECT is(
  (SELECT resume_token_version FROM public.lecture_sessions, phase68_fixture
   WHERE id = lecture_id),
  1,
  'new lecture starts at resume-token version one'
);
SELECT is(
  public.admin_revoke_lecture_resume_tokens(
    (SELECT lecture_id FROM phase68_fixture),
    'admin-session:phase68'
  ),
  2,
  'resume-token revocation increments the lecture-scoped version'
);
SELECT ok(
  EXISTS (
    SELECT 1
    FROM public.lecture_resume_token_revocations AS revocation,
      phase68_fixture AS fixture
    WHERE revocation.lecture_session_id = fixture.lecture_id
      AND revocation.previous_version = 1
      AND revocation.next_version = 2
      AND revocation.actor_id = 'admin-session:phase68'
  ),
  'resume-token revocation actor and versions are auditable'
);
SELECT ok(
  NOT has_function_privilege(
    'authenticated',
    'public.admin_revoke_lecture_resume_tokens(uuid,text)',
    'EXECUTE'
  ),
  'browser clients cannot revoke another lecture resume scope'
);
SELECT ok(
  NOT has_function_privilege(
    'authenticated',
    'public.get_lecture_resume_claim(uuid,uuid)',
    'EXECUTE'
  )
  AND has_function_privilege(
    'service_role',
    'public.get_lecture_resume_claim(uuid,uuid)',
    'EXECUTE'
  ),
  'ownership-safe resume claim is available only to the Edge service role'
);

SELECT ok(
  public.admin_set_lecture_status(
    (SELECT provider_lecture_id FROM phase68_fixture), 'start', null
  ),
  'provider correlation fixture lecture starts'
);
UPDATE phase68_fixture
SET result = public.admin_consume_realtime_billing_grant(
  (public.admin_issue_ai_billing_grant(
    provider_lecture_id,
    ARRAY['captions'],
    repeat('7', 64),
    true,
    'admin-session:phase68-provider'
  ) ->> 'grant_id')::uuid,
  repeat('7', 64),
  provider_lecture_id,
  jsonb_build_array(jsonb_build_object(
    'feature', 'captions',
    'idempotency_key', 'phase68-provider-correlation',
    'estimated_microusd', 17000,
    'estimated_audio_seconds', 60,
    'estimated_input_tokens', 0,
    'estimated_output_tokens', 0,
    'model_id', 'gpt-realtime-whisper',
    'pricing_unit', 'audio_minute',
    'pricing_rate_microusd', 17000
  )),
  'admin-session:phase68-provider'
);
UPDATE phase68_fixture
SET operation_id = (result #>> '{operations,0,operation,id}')::uuid;
SELECT ok(
  public.record_realtime_provider_client_request(
    (SELECT operation_id FROM phase68_fixture),
    'admin-session:phase68-provider',
    '68000000-0000-4000-8000-000000000068'
  ),
  'Realtime client request correlation is persisted before provider fetch'
);
SELECT throws_ok(
  $$
    SELECT public.record_realtime_provider_client_request(
      operation_id,
      'admin-session:other',
      '68000000-0000-4000-8000-000000000069'
    ) FROM phase68_fixture
  $$,
  '42501',
  'Realtime provider call is not available',
  'another actor cannot replace provider correlation'
);
SELECT ok(
  public.mark_realtime_provider_creation_uncertain(
    (SELECT operation_id FROM phase68_fixture),
    'admin-session:phase68-provider',
    'openai_realtime_create_timeout'
  ),
  'ambiguous provider timeout is durably marked without retrying creation'
);
SELECT ok(
  (SELECT
     creation_outcome_uncertain
     AND uncertainty_recorded_at IS NOT NULL
     AND client_request_id = '68000000-0000-4000-8000-000000000068'
   FROM public.ai_realtime_provider_calls AS provider_call,
     phase68_fixture
   WHERE provider_call.operation_id = phase68_fixture.operation_id),
  'provider ambiguity retains its support correlation identifier'
);
SELECT ok(
  NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'lecture_resume_token_revocations'
  ),
  'resume revocation audit adds no periodic student load'
);

RESET ROLE;
SELECT * FROM finish();
ROLLBACK;
