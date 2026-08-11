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
  (
    SELECT count(*) = 3
      AND bool_and(
        CASE
          WHEN operation_key IN (
            'manage-lecture-summaries.start',
            'manage-lecture-summaries.resume'
          ) THEN operation_class = 'write'
          ELSE lecture_lock_mode = 'update'
        END
      )
    FROM private.admin_google_operation_policies
    WHERE operation_key IN (
      'manage-lecture-summaries.start',
      'manage-lecture-summaries.resume',
      'manage-lecture-summaries.stop'
    )
  ),
  'summary scheduling is a write while stop prelocks the lecture for update'
);
SELECT ok(
  NOT EXISTS (
    SELECT 1
    FROM (VALUES
      ('admin_google_ai_child_grant_receipts'),
      ('admin_google_ai_provider_start_intents'),
      ('admin_google_ai_provider_start_receipts'),
      ('admin_google_ai_provider_dispatch_receipts'),
      ('admin_google_summary_run_receipts'),
      ('admin_google_summary_window_preflight_receipts'),
      ('admin_google_summary_window_start_bindings')
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
          'service_role', format('private.%I', expected.table_name), 'INSERT'
        )
        OR has_table_privilege(
          'service_role', format('private.%I', expected.table_name), 'DELETE'
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
        'private.admin_google_ai_provider_start_receipts'::regclass,
        'private.admin_google_ai_provider_dispatch_receipts'::regclass,
        'private.admin_google_summary_run_receipts'::regclass,
        'private.admin_google_summary_window_preflight_receipts'::regclass,
        'private.admin_google_summary_window_start_bindings'::regclass
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
  AND has_function_privilege(
    'service_role',
    'public.claim_google_ai_provider_dispatch_v1(text,uuid,uuid,text,text,integer,uuid,uuid,text,uuid,boolean)',
    'EXECUTE'
  )
  AND has_function_privilege(
    'service_role',
    'public.reap_stale_google_ai_provider_dispatches_v1(integer)',
    'EXECUTE'
  )
  AND has_function_privilege(
    'service_role',
    'public.manage_google_admin_summary_run_v1(text,uuid,uuid,text,text,integer,uuid,text,text,boolean,text,text,uuid,boolean)',
    'EXECUTE'
  )
  AND has_function_privilege(
    'service_role',
    'public.prepare_google_admin_summary_window_v1(text,uuid,uuid,text,text,integer,uuid,uuid,text,integer,text,jsonb,jsonb,text,text,uuid,boolean)',
    'EXECUTE'
  )
  AND has_function_privilege(
    'service_role',
    'public.issue_google_summary_ai_child_grant_v1(text,uuid,uuid,text,text,integer,uuid,uuid,uuid,integer,uuid,text,text,text,text,text,text,bigint,bigint,integer,bigint,bigint,bigint,text,integer,uuid,boolean)',
    'EXECUTE'
  )
  AND has_function_privilege(
    'service_role',
    'public.start_google_admin_summary_window_operation_v1(text,uuid,uuid,text,text,integer,uuid,text,uuid,uuid,text,uuid,integer,uuid,text,text,text,text,text,text,bigint,bigint,integer,bigint,bigint,bigint,uuid,text,boolean)',
    'EXECUTE'
  )
  AND has_function_privilege(
    'service_role',
    'public.complete_google_admin_summary_window_operation_v1(text,uuid,uuid,text,text,integer,uuid,uuid,jsonb,jsonb,boolean,bigint,bigint,bigint,text)',
    'EXECUTE'
  )
  AND has_function_privilege(
    'service_role',
    'public.fail_google_admin_summary_window_operation_v1(text,uuid,uuid,text,text,integer,uuid,uuid,text,bigint,bigint,bigint,text,text)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'authenticated',
    'public.issue_google_material_ai_child_grant_v1(text,uuid,uuid,text,text,integer,uuid,text,text,integer,uuid,text,text,text,uuid,integer,integer,text,text,bigint,bigint,integer,bigint,bigint,bigint,boolean)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'authenticated',
    'public.claim_google_ai_provider_dispatch_v1(text,uuid,uuid,text,text,integer,uuid,uuid,text,uuid,boolean)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'authenticated',
    'public.reap_stale_google_ai_provider_dispatches_v1(integer)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'authenticated',
    'public.manage_google_admin_summary_run_v1(text,uuid,uuid,text,text,integer,uuid,text,text,boolean,text,text,uuid,boolean)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'authenticated',
    'public.start_google_admin_summary_window_operation_v1(text,uuid,uuid,text,text,integer,uuid,text,uuid,uuid,text,uuid,integer,uuid,text,text,text,text,text,text,bigint,bigint,integer,bigint,bigint,bigint,uuid,text,boolean)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'service_role',
    'private.issue_google_ai_child_grant_v1(text,uuid,uuid,text,text,integer,uuid,text,text,text,integer,uuid,boolean)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'service_role',
    'private.claim_google_ai_provider_dispatch_v1(text,uuid,uuid,text,text,integer,uuid,uuid,text,uuid,boolean)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'service_role',
    'private.settle_stale_google_ai_provider_dispatch_v1(uuid)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'service_role',
    'private.reap_stale_google_ai_provider_dispatches_v1(integer)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'service_role',
    'private.require_google_ai_dispatch_receipt_on_terminal_v1()',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'service_role',
    'private.manage_google_admin_summary_run_v1(text,uuid,uuid,text,text,integer,uuid,text,text,boolean,text,text,uuid,boolean)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'service_role',
    'private.prepare_google_admin_summary_window_v1(text,uuid,uuid,text,text,integer,uuid,uuid,text,integer,text,jsonb,jsonb,text,text,uuid,boolean)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'service_role',
    'private.issue_google_summary_ai_child_grant_v1(text,uuid,uuid,text,text,integer,uuid,uuid,uuid,integer,uuid,text,text,text,text,text,text,bigint,bigint,integer,bigint,bigint,bigint,text,integer,uuid,boolean)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'service_role',
    'private.start_google_admin_summary_window_operation_v1(text,uuid,uuid,text,text,integer,uuid,text,uuid,uuid,text,uuid,integer,uuid,text,text,text,text,text,text,bigint,bigint,integer,bigint,bigint,bigint,uuid,text,boolean)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'service_role',
    'private.complete_google_admin_summary_window_operation_v1(text,uuid,uuid,text,text,integer,uuid,uuid,jsonb,jsonb,boolean,bigint,bigint,bigint,text)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'service_role',
    'private.fail_google_admin_summary_window_operation_v1(text,uuid,uuid,text,text,integer,uuid,uuid,text,bigint,bigint,bigint,text,text)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'service_role',
    'private.google_summary_source_evidence_is_valid_v1(jsonb,jsonb)',
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
        'admin_google_ai_provider_start_receipts',
        'admin_google_ai_provider_dispatch_receipts',
        'admin_google_summary_run_receipts',
        'admin_google_summary_window_preflight_receipts',
        'admin_google_summary_window_start_bindings'
      )
      AND column_name ~ '(raw|bearer|secret|payload|response)'
      AND column_name !~ '(_sha256|_digest)$'
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

CREATE FUNCTION pg_temp.prepare_summary_window(
  request_id uuid,
  window_index integer,
  source_hashes jsonb,
  source_coverage jsonb
) RETURNS jsonb
LANGUAGE sql VOLATILE SET search_path = '' AS $$
  SELECT public.prepare_google_admin_summary_window_v1(
    repeat('1',64),
    '00000000-0000-4000-8000-00000000e202'::uuid,
    '00000000-0000-4000-8000-00000000e203'::uuid,
    'https://accounts.google.com', repeat('a',64), 1,
    current_setting('compass.test.c2_provider_lecture_id')::uuid,
    current_setting('compass.test.c2_summary_provider_run_id')::uuid,
    current_setting('compass.test.c2_summary_provider_run_token_hash'),
    window_index, 'phase6-summary-v1',
    source_hashes, source_coverage, null::text, null::text,
    request_id, true
  );
$$;

CREATE FUNCTION pg_temp.issue_summary_child(
  request_id uuid,
  nonce_hash text,
  preflight_request_id uuid,
  window_id uuid,
  expected_attempt integer,
  context_digest text,
  payload_sha256 text
) RETURNS jsonb
LANGUAGE sql VOLATILE SET search_path = '' AS $$
  SELECT public.issue_google_summary_ai_child_grant_v1(
    repeat('1',64),
    '00000000-0000-4000-8000-00000000e202'::uuid,
    '00000000-0000-4000-8000-00000000e203'::uuid,
    'https://accounts.google.com', repeat('a',64), 1,
    current_setting('compass.test.c2_provider_lecture_id')::uuid,
    current_setting('compass.test.c2_summary_provider_run_id')::uuid,
    window_id, expected_attempt, preflight_request_id, context_digest,
    payload_sha256, 'ja', 'auto_default_ja', 'test-model',
    'phase6-summary-v1', 1000000, 6000000, 4000, 1600, 1000, 100,
    nonce_hash, 1, request_id, true
  );
$$;

CREATE FUNCTION pg_temp.start_summary_operation(
  start_request_id uuid,
  grant_id uuid,
  nonce_hash text,
  preflight_request_id uuid,
  window_id uuid,
  expected_attempt integer,
  context_digest text,
  payload_sha256 text,
  provider_digest text
) RETURNS jsonb
LANGUAGE sql VOLATILE SET search_path = '' AS $$
  SELECT public.start_google_admin_summary_window_operation_v1(
    repeat('1',64),
    '00000000-0000-4000-8000-00000000e202'::uuid,
    '00000000-0000-4000-8000-00000000e203'::uuid,
    'https://accounts.google.com', repeat('a',64), 1,
    grant_id, nonce_hash,
    current_setting('compass.test.c2_provider_lecture_id')::uuid,
    current_setting('compass.test.c2_summary_provider_run_id')::uuid,
    current_setting('compass.test.c2_summary_provider_run_token_hash'),
    window_id, expected_attempt, preflight_request_id,
    context_digest, payload_sha256, 'ja', 'auto_default_ja', 'test-model',
    'phase6-summary-v1', 1000000, 6000000, 4000, 1600, 1000, 100,
    start_request_id, provider_digest, true
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
SELECT throws_ok(
  format(
    $$SELECT public.manage_google_admin_summary_run_v1(
      repeat('1',64),
      '00000000-0000-4000-8000-00000000e202'::uuid,
      '00000000-0000-4000-8000-00000000e203'::uuid,
      'https://accounts.google.com', repeat('a',64), 1,
      %L::uuid, 'start', repeat('c',64), false, 'auto', null,
      '00000000-0000-4000-8000-00000000e260'::uuid, true
    )$$,
    current_setting('compass.test.c2_provider_lecture_id')
  ),
  'P7338',
  'Google summary scheduling is disabled',
  'default-OFF rejects a new summary scheduler without consuming a child'
);
RESET ROLE;
UPDATE private.admin_identity_runtime_gate
SET google_operational_authorization_enabled = true
WHERE singleton;
UPDATE private.admin_ai_unlock_runtime_gate
SET google_ai_child_grant_enabled = true
WHERE singleton;

SET ROLE service_role;
SELECT ok(
  (
    SELECT set_config(
      'compass.test.c2_summary_run_id', result #>> '{run,id}', false
    ) IS NOT NULL
      AND result ->> 'accepted' = 'true'
      AND result ->> 'idempotentReplay' = 'false'
      AND result ->> 'refreshRequired' = 'false'
    FROM (
      SELECT public.manage_google_admin_summary_run_v1(
        repeat('1',64),
        '00000000-0000-4000-8000-00000000e202'::uuid,
        '00000000-0000-4000-8000-00000000e203'::uuid,
        'https://accounts.google.com', repeat('a',64), 1,
        current_setting('compass.test.c2_provider_lecture_id')::uuid,
        'start', repeat('c',64), false, 'auto', null,
        '00000000-0000-4000-8000-00000000e260'::uuid, true
      ) AS result
    ) AS started
  ),
  'Google scheduling starts without consuming a provider child or another MFA'
);
SELECT ok(
  (
    SELECT result ->> 'accepted' = 'true'
      AND result ->> 'idempotentReplay' = 'true'
      AND result ->> 'refreshRequired' = 'false'
      AND NOT (result ? 'results')
      AND result #>> '{run,id}' =
        current_setting('compass.test.c2_summary_run_id')
    FROM (
      SELECT public.manage_google_admin_summary_run_v1(
        repeat('1',64),
        '00000000-0000-4000-8000-00000000e202'::uuid,
        '00000000-0000-4000-8000-00000000e203'::uuid,
        'https://accounts.google.com', repeat('a',64), 1,
        current_setting('compass.test.c2_provider_lecture_id')::uuid,
        'start', repeat('c',64), false, 'auto', null,
        '00000000-0000-4000-8000-00000000e260'::uuid, true
      ) AS result
    ) AS replayed
  ),
  'a lost summary-start response converges on the same run token binding'
);
SELECT throws_ok(
  format(
    $$SELECT public.manage_google_admin_summary_run_v1(
      repeat('1',64),
      '00000000-0000-4000-8000-00000000e202'::uuid,
      '00000000-0000-4000-8000-00000000e203'::uuid,
      'https://accounts.google.com', repeat('a',64), 1,
      %L::uuid, 'start', repeat('c',64), false,
      'biomedical_pubmed', null,
      '00000000-0000-4000-8000-00000000e260'::uuid, true
    )$$,
    current_setting('compass.test.c2_provider_lecture_id')
  ),
  'P7335',
  'Google summary request binding changed on retry',
  'one summary request UUID cannot change scheduler intent'
);
SELECT ok(
  (
    SELECT result ->> 'accepted' = 'true'
      AND result ->> 'idempotentReplay' = 'false'
      AND result #>> '{run,id}' =
        current_setting('compass.test.c2_summary_run_id')
    FROM (
      SELECT public.manage_google_admin_summary_run_v1(
        repeat('1',64),
        '00000000-0000-4000-8000-00000000e202'::uuid,
        '00000000-0000-4000-8000-00000000e203'::uuid,
        'https://accounts.google.com', repeat('a',64), 1,
        current_setting('compass.test.c2_provider_lecture_id')::uuid,
        'resume', repeat('d',64), null, null, null,
        '00000000-0000-4000-8000-00000000e261'::uuid, true
      ) AS result
    ) AS resumed
  ),
  'the same principal can rotate a Google summary run credential without a child'
);
SELECT is(
  public.manage_google_admin_summary_run_v1(
    repeat('1',64),
    '00000000-0000-4000-8000-00000000e202'::uuid,
    '00000000-0000-4000-8000-00000000e203'::uuid,
    'https://accounts.google.com', repeat('a',64), 1,
    current_setting('compass.test.c2_provider_lecture_id')::uuid,
    'start', repeat('c',64), false, 'auto', null,
    '00000000-0000-4000-8000-00000000e260'::uuid, true
  ) ->> 'refreshRequired',
  'true',
  'an old start receipt never returns a run token after an explicit resume rotated it'
);
RESET ROLE;
UPDATE private.admin_identity_runtime_gate
SET google_operational_authorization_enabled = false
WHERE singleton;
UPDATE private.admin_ai_unlock_runtime_gate
SET google_ai_child_grant_enabled = false
WHERE singleton;
SET ROLE service_role;
SELECT ok(
  (
    SELECT result ->> 'accepted' = 'true'
      AND result ->> 'idempotentReplay' = 'false'
      AND result ->> 'resultStatus' = 'stopped'
      AND NOT (result ? 'results')
    FROM (
      SELECT public.manage_google_admin_summary_run_v1(
        repeat('1',64),
        '00000000-0000-4000-8000-00000000e202'::uuid,
        '00000000-0000-4000-8000-00000000e203'::uuid,
        'https://accounts.google.com', repeat('a',64), 1,
        current_setting('compass.test.c2_provider_lecture_id')::uuid,
        'stop', null, null, null, 'fixture_stop',
        '00000000-0000-4000-8000-00000000e262'::uuid, false
      ) AS result
    ) AS stopped
  ),
  'summary stop remains available when admission and transport are OFF'
);
SELECT ok(
  (
    SELECT result ->> 'accepted' = 'true'
      AND result ->> 'idempotentReplay' = 'true'
      AND result ->> 'resultStatus' = 'stopped'
      AND NOT (result ? 'results')
    FROM (
      SELECT public.manage_google_admin_summary_run_v1(
        repeat('1',64),
        '00000000-0000-4000-8000-00000000e202'::uuid,
        '00000000-0000-4000-8000-00000000e203'::uuid,
        'https://accounts.google.com', repeat('a',64), 1,
        current_setting('compass.test.c2_provider_lecture_id')::uuid,
        'stop', null, null, null, 'fixture_stop',
        '00000000-0000-4000-8000-00000000e262'::uuid, false
      ) AS result
    ) AS replayed
  ),
  'summary stop replay exposes no AI result content without can_use_ai'
);
RESET ROLE;
SELECT ok(
  (
    SELECT run.status = 'stopped'
      AND run.academic_authorization_grant_id IS NULL
      AND NOT run.auto_academic_answers_enabled
    FROM public.lecture_summary_runs AS run
    WHERE run.id = current_setting('compass.test.c2_summary_run_id')::uuid
  )
  AND NOT EXISTS (
    SELECT 1
    FROM private.admin_google_ai_child_grant_receipts AS child
    WHERE child.request_id IN (
      '00000000-0000-4000-8000-00000000e260'::uuid,
      '00000000-0000-4000-8000-00000000e261'::uuid,
      '00000000-0000-4000-8000-00000000e262'::uuid
    )
  ),
  'scheduler lifecycle creates no provider child and cannot retain legacy academic authority'
);
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

SET ROLE service_role;
SELECT is(
  public.claim_google_ai_provider_dispatch_v1(
    repeat('1',64),
    '00000000-0000-4000-8000-00000000e202'::uuid,
    '00000000-0000-4000-8000-00000000e203'::uuid,
    'https://accounts.google.com', repeat('a',64), 1,
    '00000000-0000-4000-8000-00000000e231'::uuid,
    current_setting('compass.test.c2_provider_operation_a')::uuid,
    null::text,
    '00000000-0000-4000-8000-00000000e231'::uuid,
    true
  )::text,
  null,
  'NULL provider family cannot create a dispatch claim'
);
SELECT is(
  public.claim_google_ai_provider_dispatch_v1(
    repeat('1',64),
    '00000000-0000-4000-8000-00000000e202'::uuid,
    '00000000-0000-4000-8000-00000000e203'::uuid,
    'https://accounts.google.com', repeat('a',64), 1,
    '00000000-0000-4000-8000-00000000e231'::uuid,
    current_setting('compass.test.c2_provider_operation_a')::uuid,
    'openai_responses_v1', null::uuid, true
  )::text,
  null,
  'NULL provider request identity cannot create a dispatch claim'
);
SELECT ok(
  (
    SELECT result ->> 'accepted' = 'true'
      AND result ->> 'dispatchAllowed' = 'true'
      AND result ->> 'idempotentReplay' = 'false'
      AND result ->> 'clientRequestId' =
        '00000000-0000-4000-8000-00000000e231'
      AND result ->> 'operationId' =
        current_setting('compass.test.c2_provider_operation_a')
    FROM (
      SELECT public.claim_google_ai_provider_dispatch_v1(
        repeat('1',64),
        '00000000-0000-4000-8000-00000000e202'::uuid,
        '00000000-0000-4000-8000-00000000e203'::uuid,
        'https://accounts.google.com', repeat('a',64), 1,
        '00000000-0000-4000-8000-00000000e231'::uuid,
        current_setting('compass.test.c2_provider_operation_a')::uuid,
        'openai_responses_v1',
        '00000000-0000-4000-8000-00000000e231'::uuid,
        true
      ) AS result
    ) AS claimed
  ),
  'a committed provider start can be claimed exactly once for dispatch'
);
RESET ROLE;
SELECT ok(
  (
    SELECT receipt.operation_id =
        current_setting('compass.test.c2_provider_operation_a')::uuid
      AND receipt.provider_family = 'openai_responses_v1'
      AND receipt.client_request_id =
        '00000000-0000-4000-8000-00000000e231'::uuid
      AND receipt.lease_expires_at =
        receipt.claimed_at + interval '90 seconds'
      AND usage.provider_dispatched_at = receipt.claimed_at
      AND usage.provider_request_id = receipt.client_request_id::text
    FROM private.admin_google_ai_provider_dispatch_receipts AS receipt
    JOIN public.ai_usage_ledger AS usage
      ON usage.id = receipt.operation_id
    WHERE receipt.start_request_id =
      '00000000-0000-4000-8000-00000000e231'::uuid
  ),
  'the dispatch claim stores bounded immutable provenance without provider data'
);

UPDATE private.admin_identity_runtime_gate
SET google_operational_authorization_enabled = false
WHERE singleton;
UPDATE private.admin_ai_unlock_runtime_gate
SET google_ai_child_grant_enabled = false
WHERE singleton;
SET ROLE service_role;
SELECT ok(
  (
    SELECT result ->> 'accepted' = 'true'
      AND result ->> 'dispatchAllowed' = 'false'
      AND result ->> 'idempotentReplay' = 'true'
      AND result ->> 'staleRecovered' = 'false'
    FROM (
      SELECT public.claim_google_ai_provider_dispatch_v1(
        repeat('1',64),
        '00000000-0000-4000-8000-00000000e202'::uuid,
        '00000000-0000-4000-8000-00000000e203'::uuid,
        'https://accounts.google.com', repeat('a',64), 1,
        '00000000-0000-4000-8000-00000000e231'::uuid,
        current_setting('compass.test.c2_provider_operation_a')::uuid,
        'openai_responses_v1',
        '00000000-0000-4000-8000-00000000e231'::uuid,
        false
      ) AS result
    ) AS replayed
  ),
  'dispatch replay stays gate-independent but can never dispatch twice'
);
SELECT throws_ok(
  $$SELECT public.claim_google_ai_provider_dispatch_v1(
    repeat('1',64),
    '00000000-0000-4000-8000-00000000e202'::uuid,
    '00000000-0000-4000-8000-00000000e203'::uuid,
    'https://accounts.google.com', repeat('a',64), 1,
    '00000000-0000-4000-8000-00000000e231'::uuid,
    current_setting('compass.test.c2_provider_operation_a')::uuid,
    'openai_responses_v1',
    '00000000-0000-4000-8000-00000000e237'::uuid,
    false
  )$$,
  'P7335',
  'Google AI provider dispatch binding changed on retry',
  'dispatch replay cannot substitute another provider request identity'
);
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
RESET ROLE;
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
        'compass.test.c2_provider_child_d', result ->> 'grant_id', false
      ) IS NOT NULL
      AND set_config(
        'compass.test.c2_provider_digest_d',
        result ->> 'providerIntentDigest', false
      ) IS NOT NULL
    FROM (
      SELECT pg_temp.issue_provider_child(
        '00000000-0000-4000-8000-00000000e238'::uuid,
        repeat('9',64), 'https://accounts.google.com', repeat('a',64),
        'material_analysis', 'test-model', true
      ) AS result
    ) AS issued
  ),
  'a fourth child is available for stale-dispatch recovery evidence'
);
SELECT ok(
  (
    SELECT set_config(
      'compass.test.c2_provider_operation_d', result ->> 'operationId', false
    ) IS NOT NULL
      AND result ->> 'accepted' = 'true'
      AND result ->> 'idempotentReplay' = 'false'
    FROM (
      SELECT pg_temp.start_provider_operation(
        '00000000-0000-4000-8000-00000000e239'::uuid,
        current_setting('compass.test.c2_provider_child_d')::uuid,
        repeat('9',64), current_setting('compass.test.c2_provider_digest_d'),
        'https://accounts.google.com', repeat('a',64), 'test-model', true
      ) AS result
    ) AS started
  ),
  'one additional operation models a dispatch response lost after commit'
);
RESET ROLE;

UPDATE public.ai_usage_ledger
SET
  status = 'cancelled',
  result_accepted = false,
  error_code = 'admin_stop',
  finished_at = statement_timestamp() - interval '1 minute',
  provider_dispatched_at = statement_timestamp() - interval '2 minutes',
  provider_request_id = '00000000-0000-4000-8000-00000000e239'
WHERE id = current_setting('compass.test.c2_provider_operation_d')::uuid;
INSERT INTO private.admin_google_ai_provider_dispatch_receipts (
  start_request_id,
  operation_id,
  provider_family,
  client_request_id,
  claimed_at,
  lease_expires_at
) VALUES (
  '00000000-0000-4000-8000-00000000e239'::uuid,
  current_setting('compass.test.c2_provider_operation_d')::uuid,
  'openai_responses_v1',
  '00000000-0000-4000-8000-00000000e239'::uuid,
  statement_timestamp() - interval '2 minutes',
  statement_timestamp() - interval '30 seconds'
);

SET ROLE service_role;
SELECT is(
  public.reap_stale_google_ai_provider_dispatches_v1(10),
  1,
  'bounded cleanup settles one abandoned dispatch even after stop cancelled it'
);
RESET ROLE;
SELECT ok(
  (
    SELECT usage.status = 'cancelled'
      AND usage.accounting_settled_at IS NOT NULL
      AND usage.error_code = 'provider_dispatch_lease_expired_ambiguous'
      AND usage.settlement_status = 'conservative'
      AND NOT usage.result_accepted
    FROM public.ai_usage_ledger AS usage
    WHERE usage.id =
      current_setting('compass.test.c2_provider_operation_d')::uuid
  ),
  'stale cancelled dispatch charges its reservation and releases the batch lane'
);

UPDATE public.lecture_sessions
SET
  starts_at = statement_timestamp() - interval '20 minutes',
  started_at = statement_timestamp() - interval '20 minutes',
  ends_at = statement_timestamp() + interval '70 minutes',
  hard_stop_at = statement_timestamp() + interval '70 minutes',
  updated_at = statement_timestamp()
WHERE id = current_setting('compass.test.c2_provider_lecture_id')::uuid;
UPDATE public.lecture_ai_control
SET
  hard_stop_at = statement_timestamp() + interval '70 minutes',
  updated_at = statement_timestamp()
WHERE lecture_session_id =
  current_setting('compass.test.c2_provider_lecture_id')::uuid;

SET ROLE service_role;
SELECT ok(
  (
    SELECT set_config(
      'compass.test.c2_summary_provider_run_id',
      result #>> '{run,id}',
      false
    ) IS NOT NULL
      AND set_config(
        'compass.test.c2_summary_provider_run_token_hash',
        repeat('e',64), false
      ) IS NOT NULL
      AND result ->> 'accepted' = 'true'
      AND result ->> 'idempotentReplay' = 'false'
    FROM (
      SELECT public.manage_google_admin_summary_run_v1(
        repeat('1',64),
        '00000000-0000-4000-8000-00000000e202'::uuid,
        '00000000-0000-4000-8000-00000000e203'::uuid,
        'https://accounts.google.com', repeat('a',64), 1,
        current_setting('compass.test.c2_provider_lecture_id')::uuid,
        'start', repeat('e',64), false, 'auto', null,
        '00000000-0000-4000-8000-00000000e263'::uuid, true
      ) AS result
    ) AS started
  ),
  'Google summary scheduling remains a provider-free control before each window'
);
RESET ROLE;
SELECT ok(
  NOT EXISTS (
    SELECT 1
    FROM private.admin_google_ai_child_grant_receipts AS child
    WHERE child.request_id =
      '00000000-0000-4000-8000-00000000e263'::uuid
  ),
  'starting a summary scheduler consumes no provider child'
);

SET ROLE service_role;
SELECT is(
  pg_temp.prepare_summary_window(
    '00000000-0000-4000-8000-00000000e26f'::uuid,
    1,
    jsonb_build_object(
      'pdf_character_count', 0,
      'pdf_context_sha256', null,
      'pdf_max_page_number', 0,
      'pdf_page_count', 0,
      'raw_transcript', 'must-not-persist',
      'transcript_character_count', 500,
      'transcript_segment_count', 1,
      'transcript_sha256', repeat('1',64)
    ),
    jsonb_build_object(
      'comments', false, 'pdf', false, 'transcript', true
    )
  )::text,
  null,
  'unexpected raw source metadata fails closed before evidence insertion'
);
RESET ROLE;
SELECT ok(
  NOT EXISTS (
    SELECT 1
    FROM private.admin_google_summary_window_preflight_receipts AS receipt
    WHERE receipt.request_id =
      '00000000-0000-4000-8000-00000000e26f'::uuid
  ),
  'rejected raw source metadata leaves no immutable evidence'
);

SET ROLE service_role;
SELECT ok(
  (
    SELECT set_config(
      'compass.test.c2_summary_preflight_window_a',
      result #>> '{window,id}', false
    ) IS NOT NULL
      AND set_config(
        'compass.test.c2_summary_preflight_attempt_a',
        result ->> 'expectedAttempt', false
      ) IS NOT NULL
      AND set_config(
        'compass.test.c2_summary_preflight_digest_a',
        result ->> 'preflightContextDigest', false
      ) IS NOT NULL
      AND result ->> 'accepted' = 'true'
      AND result ->> 'idempotentReplay' = 'false'
      AND result ->> 'refreshRequired' = 'false'
      AND result ->> 'resultStatus' = 'prepared'
    FROM (
      SELECT pg_temp.prepare_summary_window(
        '00000000-0000-4000-8000-00000000e270'::uuid,
        1,
        jsonb_build_object(
          'pdf_character_count', 0,
          'pdf_context_sha256', null,
          'pdf_max_page_number', 0,
          'pdf_page_count', 0,
          'transcript_character_count', 500,
          'transcript_segment_count', 1,
          'transcript_sha256', repeat('1',64)
        ),
        jsonb_build_object(
          'comments', false, 'pdf', false, 'transcript', true
        )
      ) AS result
    ) AS prepared
  ),
  'one due summary window prepares immutable source context without a child'
);
SELECT ok(
  (
    SELECT result ->> 'accepted' = 'true'
      AND result ->> 'idempotentReplay' = 'true'
      AND result ->> 'refreshRequired' = 'false'
      AND result #>> '{window,id}' =
        current_setting('compass.test.c2_summary_preflight_window_a')
      AND result ->> 'expectedAttempt' =
        current_setting('compass.test.c2_summary_preflight_attempt_a')
      AND result ->> 'preflightContextDigest' =
        current_setting('compass.test.c2_summary_preflight_digest_a')
    FROM (
      SELECT pg_temp.prepare_summary_window(
        '00000000-0000-4000-8000-00000000e270'::uuid,
        1,
        jsonb_build_object(
          'pdf_character_count', 0,
          'pdf_context_sha256', null,
          'pdf_max_page_number', 0,
          'pdf_page_count', 0,
          'transcript_character_count', 500,
          'transcript_segment_count', 1,
          'transcript_sha256', repeat('1',64)
        ),
        jsonb_build_object(
          'comments', false, 'pdf', false, 'transcript', true
        )
      ) AS result
    ) AS replayed
  ),
  'lost preflight response converges on the same current source context'
);
SELECT ok(
  (
    SELECT result ->> 'accepted' = 'true'
      AND result ->> 'idempotentReplay' = 'false'
      AND result ->> 'refreshRequired' = 'true'
      AND result ->> 'resultStatus' = 'skipped'
      AND result ->> 'skipped' = 'true'
    FROM (
      SELECT pg_temp.prepare_summary_window(
        '00000000-0000-4000-8000-00000000e271'::uuid,
        2,
        jsonb_build_object(
          'pdf_character_count', 0,
          'pdf_context_sha256', null,
          'pdf_max_page_number', 0,
          'pdf_page_count', 0,
          'transcript_character_count', 0,
          'transcript_segment_count', 0,
          'transcript_sha256', null
        ),
        jsonb_build_object(
          'comments', false, 'pdf', false, 'transcript', false
        )
      ) AS result
    ) AS skipped
  ),
  'insufficient source skips a due window without provider authority'
);
SELECT is(
  pg_temp.prepare_summary_window(
    '00000000-0000-4000-8000-00000000e271'::uuid,
    2,
    jsonb_build_object(
      'pdf_character_count', 0,
      'pdf_context_sha256', null,
      'pdf_max_page_number', 0,
      'pdf_page_count', 0,
      'transcript_character_count', 0,
      'transcript_segment_count', 0,
      'transcript_sha256', null
    ),
    jsonb_build_object(
      'comments', false, 'pdf', false, 'transcript', false
    )
  ) ->> 'idempotentReplay',
  'true',
  'skipped summary preflight replays without creating a child'
);
SELECT ok(
  (
    SELECT set_config(
      'compass.test.c2_summary_child_a', result ->> 'grant_id', false
    ) IS NOT NULL
      AND set_config(
        'compass.test.c2_summary_provider_digest_a',
        result ->> 'providerIntentDigest', false
      ) IS NOT NULL
      AND result ->> 'accepted' = 'true'
    FROM (
      SELECT pg_temp.issue_summary_child(
        '00000000-0000-4000-8000-00000000e272'::uuid,
        repeat('a',64),
        '00000000-0000-4000-8000-00000000e270'::uuid,
        current_setting('compass.test.c2_summary_preflight_window_a')::uuid,
        current_setting('compass.test.c2_summary_preflight_attempt_a')::integer,
        current_setting('compass.test.c2_summary_preflight_digest_a'),
        repeat('f',64)
      ) AS result
    ) AS issued
  ),
  'one prepared window receives one short-lived summaries child'
);
SELECT ok(
  (
    SELECT set_config(
      'compass.test.c2_summary_operation_a', result ->> 'operationId', false
    ) IS NOT NULL
      AND result ->> 'accepted' = 'true'
      AND result ->> 'idempotentReplay' = 'false'
    FROM (
      SELECT pg_temp.start_summary_operation(
        '00000000-0000-4000-8000-00000000e273'::uuid,
        current_setting('compass.test.c2_summary_child_a')::uuid,
        repeat('a',64),
        '00000000-0000-4000-8000-00000000e270'::uuid,
        current_setting('compass.test.c2_summary_preflight_window_a')::uuid,
        current_setting('compass.test.c2_summary_preflight_attempt_a')::integer,
        current_setting('compass.test.c2_summary_preflight_digest_a'),
        repeat('f',64),
        current_setting('compass.test.c2_summary_provider_digest_a')
      ) AS result
    ) AS started
  ),
  'one summary child starts exactly one usage operation for its window'
);
SELECT is(
  pg_temp.start_summary_operation(
    '00000000-0000-4000-8000-00000000e273'::uuid,
    current_setting('compass.test.c2_summary_child_a')::uuid,
    repeat('a',64),
    '00000000-0000-4000-8000-00000000e270'::uuid,
    current_setting('compass.test.c2_summary_preflight_window_a')::uuid,
    current_setting('compass.test.c2_summary_preflight_attempt_a')::integer,
    current_setting('compass.test.c2_summary_preflight_digest_a'),
    repeat('f',64),
    current_setting('compass.test.c2_summary_provider_digest_a')
  ) ->> 'idempotentReplay',
  'true',
  'lost summary-start response converges before dispatch'
);
SELECT throws_ok(
  $$SELECT public.complete_google_admin_summary_window_operation_v1(
    repeat('1',64),
    '00000000-0000-4000-8000-00000000e202'::uuid,
    '00000000-0000-4000-8000-00000000e203'::uuid,
    'https://accounts.google.com', repeat('a',64), 1,
    '00000000-0000-4000-8000-00000000e273'::uuid,
    current_setting('compass.test.c2_summary_operation_a')::uuid,
    jsonb_build_object(
      'lecture_recap', jsonb_build_array('discard me'),
      'comment_pulse', '[]'::jsonb
    ),
    '{}'::jsonb, false, 0, 0, 0, 'provider-before-claim'
  )$$,
  'P7335',
  'Google summary completion lacks dispatch evidence',
  'summary output cannot be saved before an immutable dispatch claim'
);
SELECT ok(
  (
    SELECT result ->> 'dispatchAllowed' = 'true'
      AND result ->> 'idempotentReplay' = 'false'
      AND result ->> 'operationId' =
        current_setting('compass.test.c2_summary_operation_a')
    FROM (
      SELECT public.claim_google_ai_provider_dispatch_v1(
        repeat('1',64),
        '00000000-0000-4000-8000-00000000e202'::uuid,
        '00000000-0000-4000-8000-00000000e203'::uuid,
        'https://accounts.google.com', repeat('a',64), 1,
        '00000000-0000-4000-8000-00000000e273'::uuid,
        current_setting('compass.test.c2_summary_operation_a')::uuid,
        'openai_responses_v1',
        '00000000-0000-4000-8000-00000000e273'::uuid,
        true
      ) AS result
    ) AS claimed
  ),
  'summary provider dispatch is claimed exactly once'
);
RESET ROLE;
UPDATE private.admin_environment_memberships
SET can_use_ai = false, updated_at = statement_timestamp()
WHERE id = '00000000-0000-4000-8000-00000000e206'::uuid;
SET ROLE service_role;
SELECT ok(
  (
    SELECT result ->> 'accepted' = 'false'
      AND result ->> 'authorityRevoked' = 'true'
      AND result ->> 'result_saved' = 'false'
    FROM (
      SELECT public.complete_google_admin_summary_window_operation_v1(
        repeat('1',64),
        '00000000-0000-4000-8000-00000000e202'::uuid,
        '00000000-0000-4000-8000-00000000e203'::uuid,
        'https://accounts.google.com', repeat('a',64), 1,
        '00000000-0000-4000-8000-00000000e273'::uuid,
        current_setting('compass.test.c2_summary_operation_a')::uuid,
        jsonb_build_object(
          'lecture_recap', jsonb_build_array('discard me'),
          'comment_pulse', '[]'::jsonb
        ),
        '{}'::jsonb, false, 1600, 1000, 100,
        '00000000-0000-4000-8000-00000000e273'
      ) AS result
    ) AS completed
  ),
  'revoked Google authority settles and discards an in-flight summary result'
);
RESET ROLE;
SELECT ok(
  (
    SELECT usage.status = 'cancelled'
      AND usage.accounting_settled_at IS NOT NULL
      AND NOT usage.result_accepted
      AND summary_window.status = 'discarded'
      AND summary_window.current_operation_id IS NULL
      AND summary_window.last_error_code = 'google_authority_revoked_ambiguous'
    FROM public.ai_usage_ledger AS usage
    JOIN public.lecture_summary_windows AS summary_window
      ON summary_window.id =
        current_setting('compass.test.c2_summary_preflight_window_a')::uuid
    WHERE usage.id =
      current_setting('compass.test.c2_summary_operation_a')::uuid
  )
  AND NOT EXISTS (
    SELECT 1
    FROM public.lecture_ai_summaries AS summary
    WHERE summary.operation_id =
      current_setting('compass.test.c2_summary_operation_a')::uuid
  ),
  'revoked completion never persists provider content and clears the window lane'
);
UPDATE private.admin_environment_memberships
SET can_use_ai = true, updated_at = statement_timestamp()
WHERE id = '00000000-0000-4000-8000-00000000e206'::uuid;
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
    '00000000-0000-4000-8000-00000000e279'::uuid
  ) ->> 'accepted',
  'true',
  'the restored AI membership can explicitly create a fresh lecture master'
);
SELECT ok(
  (
    SELECT set_config(
      'compass.test.c2_summary_provider_run_id',
      result #>> '{run,id}', false
    ) IS NOT NULL
      AND set_config(
        'compass.test.c2_summary_provider_run_token_hash',
        repeat('f',64), false
      ) IS NOT NULL
      AND result ->> 'accepted' = 'true'
      AND result ->> 'idempotentReplay' = 'false'
    FROM (
      SELECT public.manage_google_admin_summary_run_v1(
        repeat('1',64),
        '00000000-0000-4000-8000-00000000e202'::uuid,
        '00000000-0000-4000-8000-00000000e203'::uuid,
        'https://accounts.google.com', repeat('a',64), 1,
        current_setting('compass.test.c2_provider_lecture_id')::uuid,
        'start', repeat('f',64), false, 'auto', null,
        '00000000-0000-4000-8000-00000000e278'::uuid, true
      ) AS result
    ) AS restarted
  ),
  'recovery starts a fresh scheduler run after the revoked run is drained'
);

SELECT ok(
  (
    SELECT set_config(
      'compass.test.c2_summary_preflight_window_c',
      result #>> '{window,id}', false
    ) IS NOT NULL
      AND set_config(
        'compass.test.c2_summary_preflight_attempt_c',
        result ->> 'expectedAttempt', false
      ) IS NOT NULL
      AND set_config(
        'compass.test.c2_summary_preflight_digest_c',
        result ->> 'preflightContextDigest', false
      ) IS NOT NULL
    FROM (
      SELECT pg_temp.prepare_summary_window(
        '00000000-0000-4000-8000-00000000e274'::uuid,
        3,
        jsonb_build_object(
          'pdf_character_count', 0,
          'pdf_context_sha256', null,
          'pdf_max_page_number', 0,
          'pdf_page_count', 0,
          'transcript_character_count', 500,
          'transcript_segment_count', 1,
          'transcript_sha256', repeat('2',64)
        ),
        jsonb_build_object(
          'comments', false, 'pdf', false, 'transcript', true
        )
      ) AS result
    ) AS prepared
  ),
  'a second actual window prepares independent provider context'
);
SELECT ok(
  (
    SELECT set_config(
      'compass.test.c2_summary_child_c', result ->> 'grant_id', false
    ) IS NOT NULL
      AND set_config(
        'compass.test.c2_summary_provider_digest_c',
        result ->> 'providerIntentDigest', false
      ) IS NOT NULL
    FROM (
      SELECT pg_temp.issue_summary_child(
        '00000000-0000-4000-8000-00000000e275'::uuid,
        repeat('b',64),
        '00000000-0000-4000-8000-00000000e274'::uuid,
        current_setting('compass.test.c2_summary_preflight_window_c')::uuid,
        current_setting('compass.test.c2_summary_preflight_attempt_c')::integer,
        current_setting('compass.test.c2_summary_preflight_digest_c'),
        repeat('0',64)
      ) AS result
    ) AS issued
  ),
  'the second actual window receives a distinct child'
);
SELECT ok(
  (
    SELECT set_config(
      'compass.test.c2_summary_operation_c', result ->> 'operationId', false
    ) IS NOT NULL
    FROM (
      SELECT pg_temp.start_summary_operation(
        '00000000-0000-4000-8000-00000000e276'::uuid,
        current_setting('compass.test.c2_summary_child_c')::uuid,
        repeat('b',64),
        '00000000-0000-4000-8000-00000000e274'::uuid,
        current_setting('compass.test.c2_summary_preflight_window_c')::uuid,
        current_setting('compass.test.c2_summary_preflight_attempt_c')::integer,
        current_setting('compass.test.c2_summary_preflight_digest_c'),
        repeat('0',64),
        current_setting('compass.test.c2_summary_provider_digest_c')
      ) AS result
    ) AS started
  ),
  'the second actual window starts one independent usage operation'
);
RESET ROLE;
UPDATE public.ai_usage_ledger
SET
  provider_dispatched_at = statement_timestamp() - interval '2 minutes',
  provider_request_id = '00000000-0000-4000-8000-00000000e276'
WHERE id = current_setting('compass.test.c2_summary_operation_c')::uuid;
INSERT INTO private.admin_google_ai_provider_dispatch_receipts (
  start_request_id, operation_id, provider_family, client_request_id,
  claimed_at, lease_expires_at
) VALUES (
  '00000000-0000-4000-8000-00000000e276'::uuid,
  current_setting('compass.test.c2_summary_operation_c')::uuid,
  'openai_responses_v1',
  '00000000-0000-4000-8000-00000000e276'::uuid,
  statement_timestamp() - interval '2 minutes',
  statement_timestamp() - interval '30 seconds'
);
SET ROLE service_role;
SELECT is(
  public.reap_stale_google_ai_provider_dispatches_v1(10),
  1,
  'stale dispatch cleanup also settles one abandoned summary window'
);
RESET ROLE;
SELECT ok(
  (
    SELECT usage.status = 'failed'
      AND usage.accounting_settled_at IS NOT NULL
      AND usage.settlement_status = 'conservative'
      AND usage.error_code = 'provider_dispatch_lease_expired_ambiguous'
      AND summary_window.status = 'failed'
      AND summary_window.current_operation_id IS NULL
    FROM public.ai_usage_ledger AS usage
    JOIN public.lecture_summary_windows AS summary_window
      ON summary_window.id =
        current_setting('compass.test.c2_summary_preflight_window_c')::uuid
    WHERE usage.id =
      current_setting('compass.test.c2_summary_operation_c')::uuid
  ),
  'stale summary dispatch is conservatively accounted and releases its window'
);

SET ROLE service_role;
SELECT ok(
  (
    SELECT set_config(
      'compass.test.c2_summary_preflight_window_d',
      result #>> '{window,id}', false
    ) IS NOT NULL
      AND set_config(
        'compass.test.c2_summary_preflight_attempt_d',
        result ->> 'expectedAttempt', false
      ) IS NOT NULL
      AND set_config(
        'compass.test.c2_summary_preflight_digest_d',
        result ->> 'preflightContextDigest', false
      ) IS NOT NULL
      AND result ->> 'resultStatus' = 'prepared'
    FROM (
      SELECT pg_temp.prepare_summary_window(
        '00000000-0000-4000-8000-00000000e27a'::uuid,
        4,
        jsonb_build_object(
          'pdf_character_count', 0,
          'pdf_context_sha256', null,
          'pdf_max_page_number', 0,
          'pdf_page_count', 0,
          'transcript_character_count', 500,
          'transcript_segment_count', 1,
          'transcript_sha256', repeat('3',64)
        ),
        jsonb_build_object(
          'comments', false, 'pdf', false, 'transcript', true
        )
      ) AS result
    ) AS prepared
  ),
  'a live recovery run prepares another independent summary window'
);
SELECT ok(
  (
    SELECT set_config(
      'compass.test.c2_summary_child_d', result ->> 'grant_id', false
    ) IS NOT NULL
      AND set_config(
        'compass.test.c2_summary_provider_digest_d',
        result ->> 'providerIntentDigest', false
      ) IS NOT NULL
    FROM (
      SELECT pg_temp.issue_summary_child(
        '00000000-0000-4000-8000-00000000e27b'::uuid,
        repeat('c',64),
        '00000000-0000-4000-8000-00000000e27a'::uuid,
        current_setting('compass.test.c2_summary_preflight_window_d')::uuid,
        current_setting('compass.test.c2_summary_preflight_attempt_d')::integer,
        current_setting('compass.test.c2_summary_preflight_digest_d'),
        repeat('3',64)
      ) AS result
    ) AS issued
  ),
  'the live window receives its own short-lived child'
);
SELECT ok(
  (
    SELECT set_config(
      'compass.test.c2_summary_operation_d', result ->> 'operationId', false
    ) IS NOT NULL
      AND result ->> 'idempotentReplay' = 'false'
    FROM (
      SELECT pg_temp.start_summary_operation(
        '00000000-0000-4000-8000-00000000e27c'::uuid,
        current_setting('compass.test.c2_summary_child_d')::uuid,
        repeat('c',64),
        '00000000-0000-4000-8000-00000000e27a'::uuid,
        current_setting('compass.test.c2_summary_preflight_window_d')::uuid,
        current_setting('compass.test.c2_summary_preflight_attempt_d')::integer,
        current_setting('compass.test.c2_summary_preflight_digest_d'),
        repeat('3',64),
        current_setting('compass.test.c2_summary_provider_digest_d')
      ) AS result
    ) AS started
  ),
  'the live window starts one independently accounted provider operation'
);
RESET ROLE;
INSERT INTO public.participants (
  id, lecture_session_id, participant_key, joined_at, last_seen_at
) VALUES (
  '00000000-0000-4000-8000-00000000e28d'::uuid,
  current_setting('compass.test.c2_provider_lecture_id')::uuid,
  'summary-drift-participant',
  statement_timestamp() - interval '2 minutes',
  statement_timestamp()
);
INSERT INTO public.comments (
  id, lecture_session_id, participant_id, body, status, created_at, updated_at
) VALUES (
  '00000000-0000-4000-8000-00000000e28e'::uuid,
  current_setting('compass.test.c2_provider_lecture_id')::uuid,
  '00000000-0000-4000-8000-00000000e28d'::uuid,
  'Context changed after start',
  'visible',
  (
    SELECT summary_window.window_start + interval '1 minute'
    FROM public.lecture_summary_windows AS summary_window
    WHERE summary_window.id =
      current_setting('compass.test.c2_summary_preflight_window_d')::uuid
  ),
  statement_timestamp()
);

SET ROLE service_role;
SELECT ok(
  (
    SELECT result ->> 'accepted' = 'true'
      AND result ->> 'idempotentReplay' = 'true'
      AND result ->> 'refreshRequired' = 'true'
      AND result ->> 'unclaimedStartRecovered' = 'true'
      AND result ->> 'windowStatus' = 'failed'
    FROM (
      SELECT pg_temp.prepare_summary_window(
        '00000000-0000-4000-8000-00000000e27a'::uuid,
        4,
        jsonb_build_object(
          'pdf_character_count', 0,
          'pdf_context_sha256', null,
          'pdf_max_page_number', 0,
          'pdf_page_count', 0,
          'transcript_character_count', 500,
          'transcript_segment_count', 1,
          'transcript_sha256', repeat('3',64)
        ),
        jsonb_build_object(
          'comments', false, 'pdf', false, 'transcript', true
        )
      ) AS result
    ) AS recovered
  ),
  'context drift after a lost start response releases an unclaimed window'
);
RESET ROLE;
SELECT ok(
  (
    SELECT usage.status = 'failed'
      AND usage.accounting_settled_at IS NOT NULL
      AND usage.error_code = 'summary_context_changed_before_dispatch'
      AND usage.provider_dispatched_at IS NULL
      AND summary_window.status = 'failed'
      AND summary_window.current_operation_id IS NULL
    FROM public.ai_usage_ledger AS usage
    JOIN public.lecture_summary_windows AS summary_window
      ON summary_window.id =
        current_setting('compass.test.c2_summary_preflight_window_d')::uuid
    WHERE usage.id =
      current_setting('compass.test.c2_summary_operation_d')::uuid
  )
  AND NOT EXISTS (
    SELECT 1
    FROM private.admin_google_ai_provider_dispatch_receipts AS dispatch
    WHERE dispatch.start_request_id =
      '00000000-0000-4000-8000-00000000e27c'::uuid
  ),
  'unclaimed recovery settles zero cost and leaves no dispatch authority'
);

SET ROLE service_role;
SELECT ok(
  (
    SELECT set_config(
      'compass.test.c2_summary_preflight_attempt_e',
      result ->> 'expectedAttempt', false
    ) IS NOT NULL
      AND set_config(
        'compass.test.c2_summary_preflight_digest_e',
        result ->> 'preflightContextDigest', false
      ) IS NOT NULL
      AND result ->> 'accepted' = 'true'
      AND result ->> 'idempotentReplay' = 'false'
      AND result ->> 'refreshRequired' = 'false'
      AND result ->> 'resultStatus' = 'prepared'
    FROM (
      SELECT pg_temp.prepare_summary_window(
        '00000000-0000-4000-8000-00000000e27d'::uuid,
        4,
        jsonb_build_object(
          'pdf_character_count', 0,
          'pdf_context_sha256', null,
          'pdf_max_page_number', 0,
          'pdf_page_count', 0,
          'transcript_character_count', 500,
          'transcript_segment_count', 1,
          'transcript_sha256', repeat('3',64)
        ),
        jsonb_build_object(
          'comments', false, 'pdf', false, 'transcript', true
        )
      ) AS result
    ) AS prepared
  ),
  'the released window prepares a fresh attempt with current lecture context'
);
SELECT ok(
  (
    SELECT set_config(
      'compass.test.c2_summary_child_e', result ->> 'grant_id', false
    ) IS NOT NULL
      AND set_config(
        'compass.test.c2_summary_provider_digest_e',
        result ->> 'providerIntentDigest', false
      ) IS NOT NULL
      AND result ->> 'accepted' = 'true'
    FROM (
      SELECT pg_temp.issue_summary_child(
        '00000000-0000-4000-8000-00000000e27e'::uuid,
        repeat('d',64),
        '00000000-0000-4000-8000-00000000e27d'::uuid,
        current_setting('compass.test.c2_summary_preflight_window_d')::uuid,
        current_setting('compass.test.c2_summary_preflight_attempt_e')::integer,
        current_setting('compass.test.c2_summary_preflight_digest_e'),
        repeat('4',64)
      ) AS result
    ) AS issued
  ),
  'the fresh attempt receives a replacement single-use child'
);
SELECT ok(
  (
    SELECT set_config(
      'compass.test.c2_summary_operation_e', result ->> 'operationId', false
    ) IS NOT NULL
      AND result ->> 'accepted' = 'true'
      AND result ->> 'idempotentReplay' = 'false'
    FROM (
      SELECT pg_temp.start_summary_operation(
        '00000000-0000-4000-8000-00000000e27f'::uuid,
        current_setting('compass.test.c2_summary_child_e')::uuid,
        repeat('d',64),
        '00000000-0000-4000-8000-00000000e27d'::uuid,
        current_setting('compass.test.c2_summary_preflight_window_d')::uuid,
        current_setting('compass.test.c2_summary_preflight_attempt_e')::integer,
        current_setting('compass.test.c2_summary_preflight_digest_e'),
        repeat('4',64),
        current_setting('compass.test.c2_summary_provider_digest_e')
      ) AS result
    ) AS started
  ),
  'the replacement child starts exactly one retry operation'
);
SELECT is(
  public.claim_google_ai_provider_dispatch_v1(
    repeat('1',64),
    '00000000-0000-4000-8000-00000000e202'::uuid,
    '00000000-0000-4000-8000-00000000e203'::uuid,
    'https://accounts.google.com', repeat('a',64), 1,
    '00000000-0000-4000-8000-00000000e27f'::uuid,
    current_setting('compass.test.c2_summary_operation_e')::uuid,
    'openai_responses_v1',
    '00000000-0000-4000-8000-00000000e27f'::uuid,
    true
  ) ->> 'dispatchAllowed',
  'true',
  'only the recovered retry receives provider dispatch authority'
);
SELECT ok(
  (
    SELECT result ->> 'accepted' = 'true'
      AND result ->> 'result_saved' = 'true'
    FROM (
      SELECT public.complete_google_admin_summary_window_operation_v1(
        repeat('1',64),
        '00000000-0000-4000-8000-00000000e202'::uuid,
        '00000000-0000-4000-8000-00000000e203'::uuid,
        'https://accounts.google.com', repeat('a',64), 1,
        '00000000-0000-4000-8000-00000000e27f'::uuid,
        current_setting('compass.test.c2_summary_operation_e')::uuid,
        jsonb_build_object(
          'lecture_recap', jsonb_build_array('Saved summary'),
          'comment_pulse', '[]'::jsonb
        ),
        '{}'::jsonb, false, 1600, 1000, 100,
        '00000000-0000-4000-8000-00000000e27f'
      ) AS result
    ) AS completed
  ),
  'a recovered authorized retry saves its result without another MFA prompt'
);
RESET ROLE;
SELECT ok(
  (
    SELECT usage.status = 'succeeded'
      AND usage.accounting_settled_at IS NOT NULL
      AND usage.result_accepted
      AND summary_window.status = 'succeeded'
      AND summary_window.current_operation_id IS NULL
    FROM public.ai_usage_ledger AS usage
    JOIN public.lecture_summary_windows AS summary_window
      ON summary_window.id =
        current_setting('compass.test.c2_summary_preflight_window_d')::uuid
    WHERE usage.id =
      current_setting('compass.test.c2_summary_operation_e')::uuid
  )
  AND EXISTS (
    SELECT 1
    FROM public.lecture_ai_summaries AS summary
    WHERE summary.operation_id =
      current_setting('compass.test.c2_summary_operation_e')::uuid
  ),
  'the recovered happy path settles accounting and publishes one result'
);
SELECT ok(
  (
    SELECT count(*) = 4
      AND count(DISTINCT binding.window_id) = 3
      AND count(DISTINCT binding.operation_id) = 4
      AND bool_and(grant_record.status = 'consumed')
      AND bool_and(
        grant_record.operation_ids = array[binding.operation_id]::uuid[]
      )
    FROM private.admin_google_summary_window_start_bindings AS binding
    JOIN private.admin_google_ai_provider_start_receipts AS start_receipt
      ON start_receipt.start_request_id = binding.start_request_id
    JOIN public.ai_billing_grants AS grant_record
      ON grant_record.id = start_receipt.child_grant_id
    WHERE binding.start_request_id IN (
      '00000000-0000-4000-8000-00000000e273'::uuid,
      '00000000-0000-4000-8000-00000000e276'::uuid,
      '00000000-0000-4000-8000-00000000e27c'::uuid,
      '00000000-0000-4000-8000-00000000e27f'::uuid
    )
  )
  AND NOT EXISTS (
    SELECT 1
    FROM private.admin_google_summary_window_start_bindings AS binding
    WHERE binding.preflight_request_id =
      '00000000-0000-4000-8000-00000000e271'::uuid
  ),
  'each provider attempt consumes one child while skipped windows consume none'
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
        repeat('c',64), 'https://accounts.google.com', repeat('a',64),
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
        repeat('c',64), current_setting('compass.test.c2_provider_digest_c'),
        'https://accounts.google.com', repeat('a',64), 'test-model', true
      ) AS result
    ) AS started
  ),
  'provider work starts while the Google Admin session is live'
);
RESET ROLE;
UPDATE private.admin_identity_runtime_gate
SET google_operational_authorization_enabled = false
WHERE singleton;
UPDATE private.admin_ai_unlock_runtime_gate
SET google_ai_child_grant_enabled = false
WHERE singleton;
SET ROLE service_role;
SELECT throws_ok(
  $$SELECT public.claim_google_ai_provider_dispatch_v1(
    repeat('1',64),
    '00000000-0000-4000-8000-00000000e202'::uuid,
    '00000000-0000-4000-8000-00000000e203'::uuid,
    'https://accounts.google.com', repeat('a',64), 1,
    '00000000-0000-4000-8000-00000000e236'::uuid,
    current_setting('compass.test.c2_provider_operation_c')::uuid,
    'openai_responses_v1',
    '00000000-0000-4000-8000-00000000e236'::uuid,
    false
  )$$,
  'P7338',
  'Google AI provider dispatch is disabled',
  'turning admission or Edge transport OFF before claim prevents a new provider request'
);
RESET ROLE;
SELECT ok(
  NOT EXISTS (
    SELECT 1
    FROM private.admin_google_ai_provider_dispatch_receipts AS receipt
    WHERE receipt.start_request_id =
      '00000000-0000-4000-8000-00000000e236'::uuid
  )
  AND (
    SELECT usage.provider_dispatched_at IS NULL
      AND usage.provider_request_id IS NULL
    FROM public.ai_usage_ledger AS usage
    WHERE usage.id =
      current_setting('compass.test.c2_provider_operation_c')::uuid
  ),
  'a denied fresh claim leaves no dispatch marker or immutable receipt'
);
UPDATE private.admin_identity_runtime_gate
SET google_operational_authorization_enabled = true
WHERE singleton;
UPDATE private.admin_ai_unlock_runtime_gate
SET google_ai_child_grant_enabled = true
WHERE singleton;
SELECT throws_ok(
  format(
    $$UPDATE public.ai_usage_ledger
      SET status = 'succeeded', result_accepted = true
      WHERE id = %L::uuid$$,
    current_setting('compass.test.c2_provider_operation_c')
  ),
  'P7335',
  'Google AI provider result lacks dispatch evidence',
  'a Google provider result cannot bypass the dispatch receipt'
);

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
