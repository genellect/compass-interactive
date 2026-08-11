BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path = public, extensions;
SELECT no_plan();

SELECT is(
  (SELECT google_ai_child_grant_enabled
   FROM private.admin_ai_unlock_runtime_gate WHERE singleton),
  false,
  'Google AI child authority is database-default OFF'
);
SELECT ok(
  NOT EXISTS (
    SELECT 1
    FROM (VALUES
      ('admin_google_ai_child_grant_receipts'),
      ('admin_google_ai_provider_start_intents'),
      ('admin_google_ai_provider_start_receipts')
    ) AS expected(table_name)
    JOIN pg_class AS class ON class.relname = expected.table_name
    JOIN pg_namespace AS namespace ON namespace.oid = class.relnamespace
    WHERE namespace.nspname = 'private'
      AND (
        NOT class.relrowsecurity
        OR has_table_privilege(
          'service_role', format('private.%I', expected.table_name), 'SELECT'
        )
        OR has_table_privilege(
          'service_role', format('private.%I', expected.table_name), 'UPDATE'
        )
        OR has_table_privilege(
          'anon', format('private.%I', expected.table_name), 'SELECT'
        )
        OR has_table_privilege(
          'authenticated', format('private.%I', expected.table_name), 'SELECT'
        )
      )
  ),
  'provider authority evidence enables RLS and denies runtime table access'
);
SELECT ok(
  NOT EXISTS (
    SELECT 1
    FROM pg_constraint AS foreign_key
    WHERE foreign_key.contype = 'f'
      AND foreign_key.conrelid IN (
        'private.admin_google_ai_child_grant_receipts'::regclass,
        'private.admin_google_ai_provider_start_intents'::regclass,
        'private.admin_google_ai_provider_start_receipts'::regclass
      )
      AND NOT EXISTS (
        SELECT 1
        FROM pg_index AS idx
        WHERE idx.indrelid = foreign_key.conrelid
          AND idx.indisvalid
          AND idx.indisready
          AND idx.indpred IS NULL
          AND split_part(idx.indkey::text, ' ', 1)::smallint =
            foreign_key.conkey[1]
      )
  ),
  'every provider authority foreign key has a full leading index'
);
SELECT ok(
  has_function_privilege(
    'service_role',
    'public.issue_google_material_ai_child_grant_v1(text,uuid,uuid,text,text,integer,uuid,text,text,integer,uuid,text,text,text,uuid,integer,integer,text,text,bigint,bigint,integer,bigint,bigint,bigint,boolean)',
    'EXECUTE'
  )
  AND has_function_privilege(
    'service_role',
    'public.start_google_admin_material_ai_operation_v1(text,uuid,uuid,text,text,integer,uuid,text,uuid,text,uuid,text,text,text,text,uuid,integer,integer,text,text,bigint,bigint,integer,bigint,bigint,bigint,boolean)',
    'EXECUTE'
  )
  AND has_function_privilege(
    'service_role',
    'public.complete_google_admin_material_ai_operation_v1(text,uuid,uuid,text,text,integer,uuid,uuid,jsonb,bigint,bigint,bigint,text)',
    'EXECUTE'
  )
  AND has_function_privilege(
    'service_role',
    'public.fail_google_admin_material_ai_operation_v1(text,uuid,uuid,text,text,integer,uuid,uuid,text,bigint,bigint,bigint,text,text)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'authenticated',
    'public.issue_google_material_ai_child_grant_v1(text,uuid,uuid,text,text,integer,uuid,text,text,integer,uuid,text,text,text,uuid,integer,integer,text,text,bigint,bigint,integer,bigint,bigint,bigint,boolean)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'service_role',
    'private.issue_google_ai_child_grant_v1(text,uuid,uuid,text,text,integer,uuid,text,text,text,integer,uuid,boolean)',
    'EXECUTE'
  ),
  'only typed public provider facades are executable by service_role'
);
SELECT ok(
  NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'private'
      AND table_name IN (
        'admin_google_ai_child_grant_receipts',
        'admin_google_ai_provider_start_intents',
        'admin_google_ai_provider_start_receipts'
      )
      AND column_name ~ '(raw|bearer|secret|payload|response)'
  ),
  'provider evidence stores no raw nonce, bearer, secret or provider payload'
);

INSERT INTO auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) VALUES (
  '00000000-0000-0000-0000-000000000000'::uuid,
  '00000000-0000-4000-8000-00000000e202'::uuid,
  'authenticated', 'authenticated', 'phase730c2-provider@example.test', '',
  statement_timestamp() - interval '1 hour',
  '{"provider":"google","providers":["google"]}'::jsonb, '{}'::jsonb,
  statement_timestamp() - interval '1 hour',
  statement_timestamp() - interval '1 hour'
);
INSERT INTO auth.sessions (id, user_id, created_at, updated_at) VALUES (
  '00000000-0000-4000-8000-00000000e203'::uuid,
  '00000000-0000-4000-8000-00000000e202'::uuid,
  statement_timestamp() - interval '1 hour',
  statement_timestamp() - interval '1 hour'
);
INSERT INTO auth.mfa_factors (
  id, user_id, friendly_name, factor_type, status, created_at, updated_at
) VALUES (
  '00000000-0000-4000-8000-00000000e204'::uuid,
  '00000000-0000-4000-8000-00000000e202'::uuid,
  'phase730c2-provider-totp', 'totp', 'verified',
  statement_timestamp() - interval '1 hour',
  statement_timestamp() - interval '1 hour'
);
INSERT INTO private.admin_environments (
  id, environment_kind, canonical_admin_origin, supabase_issuer,
  current_deployment, bootstrap_sealed_at, owner_invariant_enforced_at
) VALUES (
  '00000000-0000-4000-8000-00000000e201'::uuid,
  'local', 'http://127.0.0.1:5173',
  'http://127.0.0.1:54321/auth/v1', true,
  statement_timestamp() - interval '1 hour',
  statement_timestamp() - interval '1 hour'
);
INSERT INTO private.admin_principals (
  id, auth_user_id, google_issuer, provider_subject_hmac,
  subject_pepper_version, normalized_email, email_verified_at
) VALUES (
  '00000000-0000-4000-8000-00000000e205'::uuid,
  '00000000-0000-4000-8000-00000000e202'::uuid,
  'https://accounts.google.com', repeat('a', 64), 1,
  'phase730c2-provider@example.test', statement_timestamp() - interval '1 hour'
);
UPDATE private.admin_principals
SET
  approved_totp_factor_set_hash = snapshot.factor_set_hash,
  approved_totp_factor_set_version = 1,
  approved_totp_factor_count = snapshot.factor_count,
  approved_totp_factor_set_at = statement_timestamp() - interval '30 minutes',
  approved_totp_factor_set_request_id =
    '00000000-0000-4000-8000-00000000e20b'::uuid,
  approved_totp_factor_set_source = 'operator_adoption',
  approved_totp_factor_set_actor = 'fixture:phase730c2-provider',
  approved_totp_factor_set_reason = 'C2 provider runtime fixture'
FROM private.current_verified_totp_factor_set_snapshot_v1(
  '00000000-0000-4000-8000-00000000e202'::uuid
) AS snapshot
WHERE id = '00000000-0000-4000-8000-00000000e205'::uuid;
INSERT INTO private.admin_environment_memberships (
  id, environment_id, principal_id, role, status, can_use_ai, activated_at
) VALUES (
  '00000000-0000-4000-8000-00000000e206'::uuid,
  '00000000-0000-4000-8000-00000000e201'::uuid,
  '00000000-0000-4000-8000-00000000e205'::uuid,
  'owner', 'active', true, statement_timestamp() - interval '1 hour'
);
INSERT INTO private.admin_step_up_nonces (
  id, nonce_hash, reserved_admin_session_id, environment_id, principal_id,
  membership_id, supabase_auth_session_id, intended_action, request_id,
  prechallenge_jwt_hash, min_amr_at, challenged_totp_factor_id,
  prechallenge_verified_totp_factor_set_hash,
  verified_totp_factor_set_hash, factor_set_bootstrap_allowed,
  approved_totp_factor_set_version, completion_jwt_hash,
  verified_totp_amr_at, issued_at, expires_at
) VALUES (
  '00000000-0000-4000-8000-00000000e207'::uuid,
  repeat('2', 64),
  '00000000-0000-4000-8000-00000000e208'::uuid,
  '00000000-0000-4000-8000-00000000e201'::uuid,
  '00000000-0000-4000-8000-00000000e205'::uuid,
  '00000000-0000-4000-8000-00000000e206'::uuid,
  '00000000-0000-4000-8000-00000000e203'::uuid,
  'admin_login',
  '00000000-0000-4000-8000-00000000e20c'::uuid,
  repeat('3', 64), statement_timestamp() - interval '1 minute',
  '00000000-0000-4000-8000-00000000e204'::uuid,
  private.current_verified_totp_factor_set_hash_v1(
    '00000000-0000-4000-8000-00000000e202'::uuid
  ),
  private.current_verified_totp_factor_set_hash_v1(
    '00000000-0000-4000-8000-00000000e202'::uuid
  ),
  false, 1, repeat('4', 64), statement_timestamp(),
  statement_timestamp() - interval '1 minute',
  statement_timestamp() + interval '4 minutes'
);
UPDATE private.admin_identity_runtime_gate
SET google_session_issue_enabled = true
WHERE singleton;
INSERT INTO public.admin_sessions (
  id, token_hash, auth_user_id, pin_version_hash, authentication_method, aal,
  principal_id, membership_id, environment_id, supabase_auth_session_id,
  step_up_verified_at, step_up_nonce_id, verified_totp_factor_set_hash,
  issued_at, last_seen_at, idle_expires_at, expires_at
) VALUES (
  '00000000-0000-4000-8000-00000000e208'::uuid,
  repeat('1', 64),
  '00000000-0000-4000-8000-00000000e202'::uuid,
  null, 'google_totp', 2,
  '00000000-0000-4000-8000-00000000e205'::uuid,
  '00000000-0000-4000-8000-00000000e206'::uuid,
  '00000000-0000-4000-8000-00000000e201'::uuid,
  '00000000-0000-4000-8000-00000000e203'::uuid,
  statement_timestamp(),
  '00000000-0000-4000-8000-00000000e207'::uuid,
  private.current_verified_totp_factor_set_hash_v1(
    '00000000-0000-4000-8000-00000000e202'::uuid
  ),
  statement_timestamp() - interval '1 hour',
  statement_timestamp() - interval '1 hour',
  statement_timestamp() + interval '12 hours',
  statement_timestamp() + interval '12 hours'
);
UPDATE private.admin_step_up_nonces
SET status = 'consumed', consumed_at = statement_timestamp(),
    completed_admin_session_id =
      '00000000-0000-4000-8000-00000000e208'::uuid,
    updated_at = statement_timestamp()
WHERE id = '00000000-0000-4000-8000-00000000e207'::uuid;

INSERT INTO private.admin_ai_unlock_factors (
  id, environment_id, principal_id, membership_id, pin_verifier,
  pin_pepper_version, factor_version, enrolled_by_admin_session_id,
  enrolled_step_up_verified_at, enrollment_request_id
) VALUES (
  '00000000-0000-4000-8000-00000000e209'::uuid,
  '00000000-0000-4000-8000-00000000e201'::uuid,
  '00000000-0000-4000-8000-00000000e205'::uuid,
  '00000000-0000-4000-8000-00000000e206'::uuid,
  extensions.crypt(repeat('e', 64), extensions.gen_salt('bf', 12)),
  1, 1,
  '00000000-0000-4000-8000-00000000e208'::uuid,
  statement_timestamp(),
  '00000000-0000-4000-8000-00000000e20d'::uuid
);
INSERT INTO private.admin_ai_policies (
  id, environment_id, membership_id, allowed_actions, allowed_models,
  max_calls_per_lecture, max_calls_per_day,
  max_input_tokens_per_lecture, max_input_tokens_per_day,
  max_output_tokens_per_lecture, max_output_tokens_per_day,
  max_cost_microusd_per_lecture, max_cost_microusd_per_day,
  max_realtime_minutes_per_lecture, max_realtime_minutes_per_day,
  max_concurrency, valid_from, valid_until, version,
  created_by_membership_id, created_by_admin_session_id, request_id
) VALUES (
  '00000000-0000-4000-8000-00000000e20a'::uuid,
  '00000000-0000-4000-8000-00000000e201'::uuid,
  '00000000-0000-4000-8000-00000000e206'::uuid,
  array[
    'academic_answers',
    'material_analysis',
    'poll_suggestions',
    'summaries'
  ]::text[],
  array['test-model']::text[],
  10, 100, 10000, 100000, 10000, 100000, 100000, 1000000,
  90, 900, 2,
  statement_timestamp() - interval '1 minute',
  statement_timestamp() + interval '2 hours',
  1,
  '00000000-0000-4000-8000-00000000e206'::uuid,
  '00000000-0000-4000-8000-00000000e208'::uuid,
  '00000000-0000-4000-8000-00000000e20e'::uuid
);
UPDATE private.admin_ai_unlock_runtime_gate
SET
  ai_unlock_enabled = true,
  google_ai_master_admission_enabled = true
WHERE singleton;

SET ROLE service_role;
SELECT ok(
  set_config(
    'compass.test.c2_provider_lecture_id',
    public.create_owned_admin_lecture_v1(
      repeat('1', 64),
      '00000000-0000-4000-8000-00000000e202'::uuid,
      '00000000-0000-4000-8000-00000000e203'::uuid,
      'C2 Google provider lecture',
      encode(extensions.digest(convert_to('654321', 'UTF8'), 'sha256'), 'hex'),
      '654321', null::timestamptz, null::timestamptz,
      '00000000-0000-4000-8000-00000000e210'::uuid
    ) ->> 'lecture_session_id',
    false
  ) IS NOT NULL,
  'Google Admin creates one owned provider lecture'
);
RESET ROLE;
SELECT ok(
  public.admin_set_lecture_status(
    current_setting('compass.test.c2_provider_lecture_id')::uuid,
    'start'
  ),
  'provider lecture opens'
);
SELECT lives_ok(
  format(
    $$SELECT public.admin_register_pdf_document(
      %L::uuid, 'doc-main', repeat('a',64), 1, 'Provider material',
      3, 3000, 300, repeat('a',64), repeat('b',64), true
    )$$,
    current_setting('compass.test.c2_provider_lecture_id')
  ),
  'provider source PDF metadata is registered'
);
SELECT lives_ok(
  format(
    $$SELECT public.admin_configure_lecture_ai_control(
      %L::uuid,
      jsonb_build_object(
        'material_analysis_enabled', false,
        'poll_suggestions_enabled', false,
        'material_analysis_call_limit', 5,
        'poll_generation_limit', 10,
        'budget_limit_microusd', 2500000,
        'input_token_limit', 200000,
        'output_token_limit', 30000,
        'max_concurrent_operations', 2
      ),
      'admin-session:00000000-0000-4000-8000-00000000e208'
    )$$,
    current_setting('compass.test.c2_provider_lecture_id')
  ),
  'provider control starts with both material features disabled'
);

SET ROLE service_role;
SELECT is(
  public.authorize_google_ai_master_with_pin_v1(
    repeat('1', 64),
    '00000000-0000-4000-8000-00000000e202'::uuid,
    '00000000-0000-4000-8000-00000000e203'::uuid,
    current_setting('compass.test.c2_provider_lecture_id')::uuid,
    'all_except_captions',
    '00000000-0000-4000-8000-00000000e20a'::uuid, 1,
    repeat('b', 64), 1, repeat('e', 64),
    '00000000-0000-4000-8000-00000000e220'::uuid
  ) ->> 'accepted',
  'true',
  'one explicit PIN proof creates the reusable C1 lecture master'
);
RESET ROLE;

CREATE FUNCTION pg_temp.issue_provider_child(
  request_id uuid,
  nonce_hash text,
  google_issuer text,
  subject_hmac text,
  feature_name text,
  model_name text,
  transport_enabled boolean
) RETURNS jsonb
LANGUAGE sql VOLATILE SET search_path = '' AS $$
  SELECT public.issue_google_material_ai_child_grant_v1(
    repeat('1',64),
    '00000000-0000-4000-8000-00000000e202'::uuid,
    '00000000-0000-4000-8000-00000000e203'::uuid,
    google_issuer, subject_hmac, 1,
    current_setting('compass.test.c2_provider_lecture_id')::uuid,
    feature_name, nonce_hash, 1, request_id,
    'doc-main', repeat('a',64), repeat('b',64),
    null::uuid, null::integer, null::integer,
    model_name, 'phase5-material-v1',
    1000000, 6000000, 4000, 1600, 1000, 100,
    transport_enabled
  );
$$;
CREATE FUNCTION pg_temp.start_provider_operation(
  start_request_id uuid,
  grant_id uuid,
  nonce_hash text,
  provider_digest text,
  google_issuer text,
  subject_hmac text,
  model_name text,
  transport_enabled boolean
) RETURNS jsonb
LANGUAGE sql VOLATILE SET search_path = '' AS $$
  SELECT public.start_google_admin_material_ai_operation_v1(
    repeat('1',64),
    '00000000-0000-4000-8000-00000000e202'::uuid,
    '00000000-0000-4000-8000-00000000e203'::uuid,
    google_issuer, subject_hmac, 1,
    grant_id, nonce_hash,
    current_setting('compass.test.c2_provider_lecture_id')::uuid,
    'material_analysis', start_request_id, provider_digest,
    'doc-main', repeat('a',64), repeat('b',64),
    null::uuid, null::integer, null::integer,
    model_name, 'phase5-material-v1',
    1000000, 6000000, 4000, 1600, 1000, 100,
    transport_enabled
  );
$$;

SET ROLE service_role;
SELECT is(
  pg_temp.issue_provider_child(
    '00000000-0000-4000-8000-00000000e230'::uuid,
    repeat('5',64), null::text, repeat('a',64),
    'material_analysis', 'test-model', true
  )::text,
  null,
  'NULL Google issuer fails closed before child admission'
);
SELECT is(
  pg_temp.issue_provider_child(
    '00000000-0000-4000-8000-00000000e230'::uuid,
    repeat('5',64), 'https://accounts.google.com', null::text,
    'material_analysis', 'test-model', true
  )::text,
  null,
  'NULL Google subject binding fails closed before child admission'
);
SELECT throws_ok(
  $$SELECT pg_temp.issue_provider_child(
    '00000000-0000-4000-8000-00000000e230'::uuid,
    repeat('5',64), 'https://accounts.google.com', repeat('a',64),
    'material_analysis', 'test-model', true
  )$$,
  'P7338',
  'Google AI child admission is disabled',
  'default-OFF rejects a new provider child'
);
RESET ROLE;
UPDATE private.admin_identity_runtime_gate
SET google_operational_authorization_enabled = true
WHERE singleton;
UPDATE private.admin_ai_unlock_runtime_gate
SET google_ai_child_grant_enabled = true
WHERE singleton;

SELECT ok(
  set_config(
    'compass.test.c2_provider_unowned_lecture_id',
    public.admin_create_lecture(
      'Legacy unowned collision fixture',
      encode(extensions.digest(convert_to('765432', 'UTF8'), 'sha256'), 'hex'),
      '765432', null::timestamptz, null::timestamptz
    )::text,
    false
  ) IS NOT NULL,
  'an unowned legacy lecture exists only for UUID collision evidence'
);
INSERT INTO public.ai_billing_grants (
  id, lecture_session_id, actor_id, actions, nonce_hash, expires_at
) VALUES (
  '00000000-0000-4000-8000-00000000e234'::uuid,
  current_setting('compass.test.c2_provider_unowned_lecture_id')::uuid,
  'legacy-fixture', array['material_analysis']::text[], repeat('8',64),
  statement_timestamp() + interval '2 minutes'
);
SET ROLE service_role;
SELECT throws_ok(
  $$SELECT pg_temp.issue_provider_child(
    '00000000-0000-4000-8000-00000000e234'::uuid,
    repeat('9',64), 'https://accounts.google.com', repeat('a',64),
    'material_analysis', 'test-model', true
  )$$,
  'P7335',
  'Google AI child request collided with existing authority',
  'a legacy grant UUID collision is a bounded fail-closed error'
);
RESET ROLE;
SELECT ok(
  NOT EXISTS (
    SELECT 1 FROM private.admin_google_ai_child_grant_receipts
    WHERE request_id = '00000000-0000-4000-8000-00000000e234'::uuid
  )
  AND (
    SELECT lecture_session_id =
        current_setting('compass.test.c2_provider_unowned_lecture_id')::uuid
      AND status = 'issued'
    FROM public.ai_billing_grants
    WHERE id = '00000000-0000-4000-8000-00000000e234'::uuid
  ),
  'UUID collision rolls C2 evidence back and leaves legacy authority unchanged'
);

SET ROLE service_role;
SELECT ok(
  (
    SELECT
      set_config(
        'compass.test.c2_provider_child_a', result ->> 'grant_id', false
      ) IS NOT NULL
      AND set_config(
        'compass.test.c2_provider_digest_a',
        result ->> 'providerIntentDigest', false
      ) IS NOT NULL
    FROM (
      SELECT pg_temp.issue_provider_child(
        '00000000-0000-4000-8000-00000000e230'::uuid,
        repeat('5',64), 'https://accounts.google.com', repeat('a',64),
        'material_analysis', 'test-model', true
      ) AS result
    ) AS issued
  ),
  'one two-minute child is issued without another MFA prompt'
);
SELECT is(
  pg_temp.start_provider_operation(
    '00000000-0000-4000-8000-00000000e231'::uuid,
    current_setting('compass.test.c2_provider_child_a')::uuid,
    null::text,
    current_setting('compass.test.c2_provider_digest_a'),
    'https://accounts.google.com', repeat('a',64), 'test-model', true
  )::text,
  null,
  'NULL child nonce fails closed without consuming the issued child'
);
SELECT is(
  (
    SELECT status FROM public.ai_billing_grants
    WHERE id = current_setting('compass.test.c2_provider_child_a')::uuid
  ),
  'issued',
  'failed start validation leaves the child issued'
);
SELECT ok(
  (
    SELECT set_config(
      'compass.test.c2_provider_operation_a',
      result ->> 'operationId', false
    ) IS NOT NULL
      AND result ->> 'accepted' = 'true'
      AND result ->> 'idempotentReplay' = 'false'
    FROM (
      SELECT pg_temp.start_provider_operation(
        '00000000-0000-4000-8000-00000000e231'::uuid,
        current_setting('compass.test.c2_provider_child_a')::uuid,
        repeat('5',64),
        current_setting('compass.test.c2_provider_digest_a'),
        'https://accounts.google.com', repeat('a',64), 'test-model', true
      ) AS result
    ) AS started
  ),
  'fresh Google provider start atomically consumes one child'
);
RESET ROLE;
SELECT ok(
  (
    SELECT control.material_analysis_enabled
      AND NOT control.poll_suggestions_enabled
    FROM public.lecture_ai_control AS control
    WHERE control.lecture_session_id =
      current_setting('compass.test.c2_provider_lecture_id')::uuid
  ),
  'first Google start enables only the explicitly authorized feature'
);
SELECT ok(
  (
    SELECT grant_record.status = 'consumed'
      AND grant_record.operation_ids = array[receipt.operation_id]::uuid[]
      AND usage.requested_by_actor =
        'admin-session:00000000-0000-4000-8000-00000000e208'
      AND usage.idempotency_key =
        '00000000-0000-4000-8000-00000000e231'
      AND usage.status = 'running'
    FROM private.admin_google_ai_provider_start_receipts AS receipt
    JOIN private.admin_google_ai_provider_start_intents AS intent
      ON intent.start_request_id = receipt.start_request_id
    JOIN public.ai_billing_grants AS grant_record
      ON grant_record.id = receipt.child_grant_id
    JOIN public.ai_usage_ledger AS usage ON usage.id = receipt.operation_id
    WHERE receipt.start_request_id =
      '00000000-0000-4000-8000-00000000e231'::uuid
  ),
  'intent, consumed child, usage and completion receipt share exact provenance'
);

UPDATE private.admin_identity_runtime_gate
SET google_operational_authorization_enabled = false
WHERE singleton;
UPDATE private.admin_ai_unlock_runtime_gate
SET google_ai_child_grant_enabled = false
WHERE singleton;
SET ROLE service_role;
SELECT is(
  pg_temp.start_provider_operation(
    '00000000-0000-4000-8000-00000000e231'::uuid,
    current_setting('compass.test.c2_provider_child_a')::uuid,
    repeat('5',64), current_setting('compass.test.c2_provider_digest_a'),
    'https://accounts.google.com', repeat('a',64), 'test-model', true
  ) ->> 'idempotentReplay',
  'true',
  'exact provider start replay converges after admission gates turn OFF'
);
SELECT throws_ok(
  $$SELECT pg_temp.start_provider_operation(
    '00000000-0000-4000-8000-00000000e231'::uuid,
    current_setting('compass.test.c2_provider_child_a')::uuid,
    repeat('6',64), current_setting('compass.test.c2_provider_digest_a'),
    'https://accounts.google.com', repeat('a',64), 'test-model', true
  )$$,
  'P7335',
  'Google AI child evidence is unavailable',
  'start replay cannot substitute another child nonce'
);
SELECT is(
  pg_temp.issue_provider_child(
    '00000000-0000-4000-8000-00000000e230'::uuid,
    repeat('5',64), 'https://accounts.google.com', repeat('a',64),
    'material_analysis', 'test-model', true
  ) ->> 'idempotentReplay',
  'true',
  'exact child issue replay also converges gate OFF'
);
RESET ROLE;

UPDATE private.admin_identity_runtime_gate
SET google_operational_authorization_enabled = true
WHERE singleton;
UPDATE private.admin_ai_unlock_runtime_gate
SET google_ai_child_grant_enabled = true
WHERE singleton;
SET ROLE service_role;
SELECT lives_ok(
  $$SELECT public.fail_google_admin_material_ai_operation_v1(
    repeat('1',64),
    '00000000-0000-4000-8000-00000000e202'::uuid,
    '00000000-0000-4000-8000-00000000e203'::uuid,
    'https://accounts.google.com', repeat('a',64), 1,
    '00000000-0000-4000-8000-00000000e231'::uuid,
    current_setting('compass.test.c2_provider_operation_a')::uuid,
    'failed', 0, 0, 0, null::text, 'fixture_finished'
  )$$,
  'the Google failure facade settles accounting without publishing a result'
);
SELECT ok(
  (
    SELECT
      set_config(
        'compass.test.c2_provider_child_b', result ->> 'grant_id', false
      ) IS NOT NULL
      AND set_config(
        'compass.test.c2_provider_digest_b',
        result ->> 'providerIntentDigest', false
      ) IS NOT NULL
    FROM (
      SELECT pg_temp.issue_provider_child(
        '00000000-0000-4000-8000-00000000e232'::uuid,
        repeat('6',64), 'https://accounts.google.com', repeat('a',64),
        'material_analysis', 'test-model', true
      ) AS result
    ) AS issued
  ),
  'a second independent child can be issued after the first operation ends'
);
SELECT throws_ok(
  $$UPDATE public.ai_billing_grants
    SET status = 'consumed', consumed_at = statement_timestamp()
    WHERE id = current_setting('compass.test.c2_provider_child_b')::uuid$$,
  'P7335',
  'Google AI child consumption lacks provider-start evidence',
  'direct child consumption without a provider intent is rejected'
);
RESET ROLE;
INSERT INTO public.ai_usage_ledger (
  id, lecture_session_id, feature, idempotency_key, status,
  requested_by_actor, reserved_microusd, reserved_input_tokens,
  reserved_output_tokens, finished_at
) VALUES (
  '00000000-0000-4000-8000-00000000e241'::uuid,
  current_setting('compass.test.c2_provider_lecture_id')::uuid,
  'material_analysis',
  '00000000-0000-4000-8000-00000000e233',
  'failed', 'legacy-fixture', 0, 0, 0, statement_timestamp()
);
SET ROLE service_role;
SELECT throws_ok(
  $$SELECT pg_temp.start_provider_operation(
    '00000000-0000-4000-8000-00000000e233'::uuid,
    current_setting('compass.test.c2_provider_child_b')::uuid,
    repeat('6',64), current_setting('compass.test.c2_provider_digest_b'),
    'https://accounts.google.com', repeat('a',64), 'test-model', true
  )$$,
  'P7335',
  'Google material provider start collided with existing usage',
  'a legacy idempotency UUID collision cannot become dispatch-eligible C2 work'
);
RESET ROLE;
SELECT ok(
  NOT EXISTS (
    SELECT 1 FROM private.admin_google_ai_provider_start_intents
    WHERE start_request_id = '00000000-0000-4000-8000-00000000e233'::uuid
  )
  AND NOT EXISTS (
    SELECT 1 FROM private.admin_google_ai_provider_start_receipts
    WHERE start_request_id = '00000000-0000-4000-8000-00000000e233'::uuid
  )
  AND (
    SELECT status = 'issued'
    FROM public.ai_billing_grants
    WHERE id = current_setting('compass.test.c2_provider_child_b')::uuid
  )
  AND (
    SELECT requested_by_actor = 'legacy-fixture' AND status = 'failed'
    FROM public.ai_usage_ledger
    WHERE id = '00000000-0000-4000-8000-00000000e241'::uuid
  ),
  'collision rejection rolls intent, receipt, child consumption and usage back'
);

SELECT throws_ok(
  format(
    $$INSERT INTO public.ai_billing_grants(
      id, lecture_session_id, master_authorization_id, actor_id,
      actions, nonce_hash, expires_at
    ) VALUES (
      '00000000-0000-4000-8000-00000000e250'::uuid,
      %L::uuid,
      (SELECT id FROM public.lecture_ai_master_authorizations
       WHERE lecture_session_id = %L::uuid ORDER BY issued_at DESC LIMIT 1),
      'admin-session:00000000-0000-4000-8000-00000000e208',
      array['material_analysis']::text[], repeat('7',64),
      statement_timestamp() + interval '1 minute'
    )$$,
    current_setting('compass.test.c2_provider_lecture_id'),
    current_setting('compass.test.c2_provider_lecture_id')
  ),
  'P7335',
  'Google AI child grant requires immutable C2 evidence',
  'direct Google child insert without immutable receipt is rejected'
);

SET ROLE service_role;
SELECT ok(
  (
    SELECT
      set_config(
        'compass.test.c2_provider_child_c', result ->> 'grant_id', false
      ) IS NOT NULL
      AND set_config(
        'compass.test.c2_provider_digest_c',
        result ->> 'providerIntentDigest', false
      ) IS NOT NULL
    FROM (
      SELECT pg_temp.issue_provider_child(
        '00000000-0000-4000-8000-00000000e235'::uuid,
        repeat('8',64), 'https://accounts.google.com', repeat('a',64),
        'material_analysis', 'test-model', true
      ) AS result
    ) AS issued
  ),
  'a third child is available for completion authority testing'
);
SELECT ok(
  (
    SELECT set_config(
      'compass.test.c2_provider_operation_c', result ->> 'operationId', false
    ) IS NOT NULL
      AND result ->> 'accepted' = 'true'
      AND result ->> 'idempotentReplay' = 'false'
    FROM (
      SELECT pg_temp.start_provider_operation(
        '00000000-0000-4000-8000-00000000e236'::uuid,
        current_setting('compass.test.c2_provider_child_c')::uuid,
        repeat('8',64), current_setting('compass.test.c2_provider_digest_c'),
        'https://accounts.google.com', repeat('a',64), 'test-model', true
      ) AS result
    ) AS started
  ),
  'provider work starts while the Google Admin session is live'
);
RESET ROLE;

UPDATE public.admin_sessions
SET
  revoked_at = statement_timestamp(),
  revoke_reason = 'fixture_completion_authority_revoked',
  updated_at = statement_timestamp()
WHERE id = '00000000-0000-4000-8000-00000000e208'::uuid;

SET ROLE service_role;
SELECT is(
  public.complete_google_admin_material_ai_operation_v1(
    repeat('1',64),
    '00000000-0000-4000-8000-00000000e202'::uuid,
    '00000000-0000-4000-8000-00000000e203'::uuid,
    'https://accounts.google.com', repeat('a',64), 1,
    '00000000-0000-4000-8000-00000000e236'::uuid,
    current_setting('compass.test.c2_provider_operation_c')::uuid,
    '{}'::jsonb, 0, 0, 0, 'provider-after-revoke'
  ) ->> 'authorityRevoked',
  'true',
  'completion rechecks live Google authority without prompting for another MFA'
);
RESET ROLE;
SELECT ok(
  (
    SELECT usage.status = 'cancelled'
      AND NOT usage.result_accepted
      AND context.result_committed_at IS NULL
    FROM public.ai_usage_ledger AS usage
    JOIN public.material_ai_operation_contexts AS context
      ON context.operation_id = usage.id
    WHERE usage.id =
      current_setting('compass.test.c2_provider_operation_c')::uuid
  )
  AND NOT EXISTS (
    SELECT 1 FROM public.lecture_material_analyses
    WHERE operation_id =
      current_setting('compass.test.c2_provider_operation_c')::uuid
  )
  AND NOT EXISTS (
    SELECT 1 FROM public.ai_poll_proposals
    WHERE operation_id =
      current_setting('compass.test.c2_provider_operation_c')::uuid
  ),
  'revoked completion accounts and closes work without saving provider content'
);

SELECT * FROM finish();
ROLLBACK;
