BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path = public, extensions;
SELECT no_plan();

-- Probe settlement without consuming the fixture needed by the successful
-- completion below. The subtransaction rolls back data, not the TAP counter.
CREATE FUNCTION pg_temp.probe_summary_failure(
  dispatched boolean,
  unknown_usage boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  result jsonb;
  operation uuid := current_setting('compass.test.c2_summary_operation_e')::uuid;
  reserved public.ai_usage_ledger%ROWTYPE;
BEGIN
  BEGIN
    SELECT * INTO STRICT reserved FROM public.ai_usage_ledger WHERE id = operation;
    result := public.fail_google_admin_summary_window_operation_v1(
      repeat('1',64),
      '00000000-0000-4000-8000-00000000e202'::uuid,
      '00000000-0000-4000-8000-00000000e203'::uuid,
      'https://accounts.google.com', repeat('a',64), 1,
      '00000000-0000-4000-8000-00000000e27f'::uuid, operation, 'failed',
      CASE WHEN unknown_usage THEN reserved.reserved_microusd ELSE 0 END,
      CASE WHEN unknown_usage THEN reserved.reserved_input_tokens ELSE 0 END,
      CASE WHEN unknown_usage THEN reserved.reserved_output_tokens ELSE 0 END,
      CASE WHEN dispatched THEN '00000000-0000-4000-8000-00000000e27f' ELSE NULL END,
      CASE WHEN unknown_usage THEN 'provider_timeout_ambiguous' ELSE 'provider_http_429' END
    );
    SELECT result || jsonb_build_object(
      'settled', accounting_settled_at IS NOT NULL,
      'operationStatus', status,
      'actualCost', actual_microusd,
      'expectedCost', CASE WHEN unknown_usage THEN reserved.reserved_microusd ELSE 0 END
    ) INTO result FROM public.ai_usage_ledger WHERE id = operation;
    RAISE EXCEPTION 'rollback synthetic settlement probe' USING ERRCODE = 'ZX001';
  EXCEPTION WHEN SQLSTATE 'ZX001' THEN
    NULL;
  END;
  RETURN result;
END;
$$;

CREATE FUNCTION pg_temp.seed_c2_admin_control_grant(
  target_admin_session_id uuid,
  target_action text,
  target_request_id uuid,
  target_intent_digest text
)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  session_row public.admin_sessions%ROWTYPE;
  nonce_id uuid := extensions.gen_random_uuid();
  grant_id uuid := extensions.gen_random_uuid();
  effective_now timestamptz := statement_timestamp();
BEGIN
  SELECT session.*
  INTO STRICT session_row
  FROM public.admin_sessions AS session
  WHERE session.id = target_admin_session_id;

  INSERT INTO private.admin_control_step_up_nonces (
    id, nonce_hash, environment_id, principal_id, membership_id,
    admin_session_id, supabase_auth_session_id,
    verified_totp_factor_set_hash, intended_action, intent_digest,
    mutation_request_id, prechallenge_jwt_hash, min_amr_at, issued_at,
    expires_at, status, consumed_at, completed_grant_id
  ) VALUES (
    nonce_id,
    encode(
      extensions.digest('c2-control:' || target_request_id::text, 'sha256'),
      'hex'
    ),
    session_row.environment_id, session_row.principal_id,
    session_row.membership_id, session_row.id,
    session_row.supabase_auth_session_id,
    session_row.verified_totp_factor_set_hash, target_action,
    target_intent_digest, target_request_id,
    encode(
      extensions.digest('c2-control-pre:' || target_request_id::text, 'sha256'),
      'hex'
    ),
    effective_now - interval '1 minute', effective_now - interval '1 minute',
    effective_now + interval '4 minutes', 'consumed', effective_now, grant_id
  );

  INSERT INTO private.admin_control_step_up_grants (
    id, source_kind, control_nonce_id, environment_id, principal_id,
    membership_id, admin_session_id, supabase_auth_session_id,
    verified_totp_factor_set_hash, intended_action, intent_digest,
    mutation_request_id, prechallenge_jwt_hash, completion_jwt_hash,
    min_amr_at, verified_totp_amr_at, issued_at, expires_at
  ) VALUES (
    grant_id, 'control', nonce_id, session_row.environment_id,
    session_row.principal_id, session_row.membership_id, session_row.id,
    session_row.supabase_auth_session_id,
    session_row.verified_totp_factor_set_hash, target_action,
    target_intent_digest, target_request_id,
    encode(
      extensions.digest('c2-control-pre:' || target_request_id::text, 'sha256'),
      'hex'
    ),
    encode(
      extensions.digest('c2-control-post:' || target_request_id::text, 'sha256'),
      'hex'
    ),
    effective_now - interval '1 minute', effective_now - interval '1 minute',
    effective_now, effective_now + interval '4 minutes'
  );
END;
$$;

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
      ('admin_google_realtime_provider_creation_receipts'),
      ('admin_google_summary_run_receipts'),
      ('admin_google_summary_window_preflight_receipts'),
      ('admin_google_summary_window_start_bindings'),
      ('admin_google_summary_auto_receipts'),
      ('admin_google_academic_answer_preflight_receipts'),
      ('admin_google_academic_answer_start_bindings')
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
        'private.admin_google_realtime_provider_creation_receipts'::regclass,
        'private.admin_google_summary_run_receipts'::regclass,
        'private.admin_google_summary_window_preflight_receipts'::regclass,
        'private.admin_google_summary_window_start_bindings'::regclass,
        'private.admin_google_summary_auto_receipts'::regclass,
        'private.admin_google_academic_answer_preflight_receipts'::regclass,
        'private.admin_google_academic_answer_start_bindings'::regclass
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
    FROM unnest(ARRAY[
      'public.issue_google_realtime_ai_child_grant_v1(text,uuid,uuid,text,text,integer,uuid,text,text,text,text,text,bigint,integer,bigint,text,integer,uuid,boolean)',
      'public.start_google_admin_realtime_operation_v1(text,uuid,uuid,text,text,integer,uuid,text,uuid,text,text,text,text,text,bigint,integer,bigint,uuid,text,boolean)',
      'public.activate_google_admin_realtime_provider_v1(text,uuid,uuid,text,text,integer,uuid,uuid,uuid,text,text,boolean)',
      'public.fail_google_admin_realtime_provider_v1(text,uuid,uuid,text,text,integer,uuid,uuid,uuid,text,text,text,text,boolean)',
      'public.publish_google_admin_caption_window_v1(text,uuid,uuid,text,text,integer,uuid,uuid,uuid,uuid,text,text,text,bigint,boolean)'
    ]::text[]) AS facade(signature)
    WHERE NOT has_function_privilege('service_role', facade.signature, 'EXECUTE')
       OR has_function_privilege('authenticated', facade.signature, 'EXECUTE')
       OR has_function_privilege('anon', facade.signature, 'EXECUTE')
  )
  AND NOT EXISTS (
    SELECT 1
    FROM unnest(ARRAY[
      'private.issue_google_realtime_ai_child_grant_v1(text,uuid,uuid,text,text,integer,uuid,text,text,text,text,text,bigint,integer,bigint,text,integer,uuid,boolean)',
      'private.start_google_admin_realtime_operation_v1(text,uuid,uuid,text,text,integer,uuid,text,uuid,text,text,text,text,text,bigint,integer,bigint,uuid,text,boolean)',
      'private.finalize_google_admin_realtime_provider_v1(text,uuid,uuid,text,text,integer,uuid,uuid,uuid,text,text,text,text,boolean)',
      'private.publish_google_admin_caption_window_v1(text,uuid,uuid,text,text,integer,uuid,uuid,uuid,uuid,text,text,text,bigint,boolean)',
      'private.settle_unclaimed_google_realtime_start_v1(uuid)',
      'private.settle_terminal_google_realtime_accounting_v1(integer)'
    ]::text[]) AS helper(signature)
    WHERE has_function_privilege('service_role', helper.signature, 'EXECUTE')
       OR has_function_privilege('authenticated', helper.signature, 'EXECUTE')
       OR has_function_privilege('anon', helper.signature, 'EXECUTE')
  ),
  'Realtime provider authority is exposed only through typed service facades'
);
SELECT ok(
  NOT EXISTS (
    SELECT 1
    FROM unnest(ARRAY[
      'public.manage_google_admin_summary_run_v2(text,uuid,uuid,text,text,integer,uuid,text,text,boolean,text,text,uuid,boolean)',
      'public.get_google_admin_academic_results_v1(text,uuid,uuid,text,text,integer,boolean,uuid)',
      'public.prepare_google_admin_academic_answer_v1(text,uuid,uuid,text,text,integer,uuid,text,uuid,text,text,text,uuid,text,text,text,text,uuid,boolean)',
      'public.renew_google_admin_academic_answer_preflight_v1(text,uuid,uuid,text,text,integer,uuid,uuid,text,uuid,text,text,text,uuid,text,text,text,uuid,text,boolean)',
      'public.mark_google_admin_academic_answer_insufficient_v1(text,uuid,uuid,text,text,integer,uuid,uuid,text,boolean)',
      'public.issue_google_academic_answer_ai_child_grant_v1(text,uuid,uuid,text,text,integer,uuid,uuid,uuid,text,text,uuid,text,text,integer,integer,text,text,text,bigint,bigint,integer,bigint,bigint,bigint,text,integer,uuid,boolean)',
      'public.start_google_admin_academic_answer_operation_v1(text,uuid,uuid,text,text,integer,uuid,text,uuid,uuid,uuid,text,text,uuid,text,text,integer,integer,text,text,text,bigint,bigint,integer,bigint,bigint,bigint,uuid,text,boolean)',
      'public.fail_google_admin_academic_answer_operation_v1(text,uuid,uuid,text,text,integer,uuid,uuid,text,bigint,bigint,bigint,text,text)',
      'public.complete_google_admin_academic_answer_operation_v1(text,uuid,uuid,text,text,integer,uuid,uuid,jsonb,jsonb,jsonb,bigint,bigint,bigint,text)'
    ]::text[]) AS facade(signature)
    WHERE NOT has_function_privilege('service_role', facade.signature, 'EXECUTE')
       OR has_function_privilege('authenticated', facade.signature, 'EXECUTE')
       OR has_function_privilege('anon', facade.signature, 'EXECUTE')
  )
  AND NOT EXISTS (
    SELECT 1
    FROM unnest(ARRAY[
      'private.manage_google_admin_summary_run_v2(text,uuid,uuid,text,text,integer,uuid,text,text,boolean,text,text,uuid,boolean)',
      'private.get_google_admin_academic_results_v1(text,uuid,uuid,text,text,integer,boolean,uuid)',
      'private.google_academic_results_with_preflight_v1(uuid)',
      'private.prepare_google_admin_academic_answer_v1(text,uuid,uuid,text,text,integer,uuid,text,uuid,text,text,text,uuid,text,text,text,text,uuid,boolean)',
      'private.renew_google_admin_academic_answer_preflight_v1(text,uuid,uuid,text,text,integer,uuid,uuid,text,uuid,text,text,text,uuid,text,text,text,uuid,text,boolean)',
      'private.mark_google_admin_academic_answer_insufficient_v1(text,uuid,uuid,text,text,integer,uuid,uuid,text,boolean)',
      'private.issue_google_academic_answer_ai_child_grant_v1(text,uuid,uuid,text,text,integer,uuid,uuid,uuid,text,text,uuid,text,text,integer,integer,text,text,text,bigint,bigint,integer,bigint,bigint,bigint,text,integer,uuid,boolean)',
      'private.start_google_admin_academic_answer_operation_v1(text,uuid,uuid,text,text,integer,uuid,text,uuid,uuid,uuid,text,text,uuid,text,text,integer,integer,text,text,text,bigint,bigint,integer,bigint,bigint,bigint,uuid,text,boolean)',
      'private.fail_google_admin_academic_answer_operation_v1(text,uuid,uuid,text,text,integer,uuid,uuid,text,bigint,bigint,bigint,text,text)',
      'private.complete_google_admin_academic_answer_operation_v1(text,uuid,uuid,text,text,integer,uuid,uuid,jsonb,jsonb,jsonb,bigint,bigint,bigint,text)'
    ]::text[]) AS helper(signature)
    WHERE has_function_privilege('service_role', helper.signature, 'EXECUTE')
       OR has_function_privilege('authenticated', helper.signature, 'EXECUTE')
       OR has_function_privilege('anon', helper.signature, 'EXECUTE')
  ),
  'Academic and automatic-summary authority is exposed only through typed service facades'
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
        'admin_google_realtime_provider_creation_receipts',
        'admin_google_summary_run_receipts',
        'admin_google_summary_window_preflight_receipts',
        'admin_google_summary_window_start_bindings',
        'admin_google_summary_auto_receipts',
        'admin_google_academic_answer_preflight_receipts',
        'admin_google_academic_answer_start_bindings'
      )
      AND column_name ~ '(raw|bearer|secret|payload|response)'
      AND column_name !~ '(_sha256|_digest)$'
  ),
  'provider evidence stores no raw nonce, bearer, secret or provider payload'
);
SELECT ok(
  (
    SELECT count(*) = 3
    FROM (VALUES
      (
        'admin_google_summary_auto_receipts'::text,
        'admin_google_summary_auto_receipts_append_only'::text
      ),
      (
        'admin_google_academic_answer_preflight_receipts',
        'admin_google_academic_preflight_receipts_append_only'
      ),
      (
        'admin_google_academic_answer_start_bindings',
        'admin_google_academic_start_bindings_append_only'
      )
    ) AS expected(table_name, trigger_name)
    JOIN pg_class AS class ON class.relname = expected.table_name
    JOIN pg_namespace AS namespace ON namespace.oid = class.relnamespace
    JOIN pg_trigger AS trigger
      ON trigger.tgrelid = class.oid
     AND trigger.tgname = expected.trigger_name
     AND NOT trigger.tgisinternal
    WHERE namespace.nspname = 'private'
  )
  AND EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'lecture_summary_runs'
      AND column_name = 'academic_authority_mode'
      AND is_nullable = 'NO'
  ),
  'Academic evidence is append-only and summary runs carry an explicit authority mode'
);
SELECT ok(
  EXISTS (
    SELECT 1
    FROM pg_class AS class
    JOIN pg_namespace AS namespace ON namespace.oid = class.relnamespace
    JOIN pg_trigger AS trigger
      ON trigger.tgrelid = class.oid
     AND trigger.tgname =
       'admin_google_realtime_creation_receipts_append_only'
     AND NOT trigger.tgisinternal
    WHERE namespace.nspname = 'private'
      AND class.relname = 'admin_google_realtime_provider_creation_receipts'
  ),
  'Realtime provider creation evidence is append-only'
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

-- Keep a second active Owner while live-authority tests suspend the operation
-- Owner. Owner capability itself is no longer independently disableable.
INSERT INTO auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) VALUES (
  '00000000-0000-0000-0000-000000000000'::uuid,
  '00000000-0000-4000-8000-00000000e2f8'::uuid,
  'authenticated', 'authenticated', 'phase730c2-anchor@example.test', '',
  statement_timestamp() - interval '1 hour',
  '{"provider":"google","providers":["google"]}'::jsonb, '{}'::jsonb,
  statement_timestamp() - interval '1 hour',
  statement_timestamp() - interval '1 hour'
);
INSERT INTO private.admin_principals (
  id, auth_user_id, google_issuer, provider_subject_hmac,
  subject_pepper_version, normalized_email, email_verified_at
) VALUES (
  '00000000-0000-4000-8000-00000000e2f9'::uuid,
  '00000000-0000-4000-8000-00000000e2f8'::uuid,
  'https://accounts.google.com', repeat('f', 64), 1,
  'phase730c2-anchor@example.test', statement_timestamp() - interval '1 hour'
);
INSERT INTO private.admin_environment_memberships (
  id, environment_id, principal_id, role, status, can_use_ai, activated_at
) VALUES (
  '00000000-0000-4000-8000-00000000e2fa'::uuid,
  '00000000-0000-4000-8000-00000000e201'::uuid,
  '00000000-0000-4000-8000-00000000e2f9'::uuid,
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
    'captions',
    'material_analysis',
    'poll_suggestions',
    'summaries'
  ]::text[],
  array['test-model']::text[],
  20, 100, 11000, 100000, 10000, 100000, 100000, 1000000,
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

SET ROLE service_role;
SELECT ok(
  set_config(
    'compass.test.c2_master_control_lecture_id',
    public.create_owned_admin_lecture_v1(
      repeat('1', 64),
      '00000000-0000-4000-8000-00000000e202'::uuid,
      '00000000-0000-4000-8000-00000000e203'::uuid,
      'C2 Google master control lecture',
      encode(extensions.digest(convert_to('654322', 'UTF8'), 'sha256'), 'hex'),
      '654322', null::timestamptz, null::timestamptz,
      '00000000-0000-4000-8000-00000000e2f0'::uuid
    ) ->> 'lecture_session_id',
    false
  ) IS NOT NULL,
  'Google Admin creates a separate lecture for gate-independent master control'
);
RESET ROLE;
SELECT ok(
  public.admin_set_lecture_status(
    current_setting('compass.test.c2_master_control_lecture_id')::uuid,
    'start'
  ),
  'the master-control lecture opens'
);
SET ROLE service_role;
SELECT is(
  public.authorize_google_ai_master_with_pin_v1(
    repeat('1', 64),
    '00000000-0000-4000-8000-00000000e202'::uuid,
    '00000000-0000-4000-8000-00000000e203'::uuid,
    current_setting('compass.test.c2_master_control_lecture_id')::uuid,
    'all_except_captions',
    '00000000-0000-4000-8000-00000000e20a'::uuid, 1,
    repeat('b', 64), 1, repeat('e', 64),
    '00000000-0000-4000-8000-00000000e2f1'::uuid
  ) ->> 'accepted',
  'true',
  'the control fixture receives one provenance-bound master'
);
SELECT is(
  public.manage_google_admin_ai_master_v1(
    repeat('1', 64),
    '00000000-0000-4000-8000-00000000e202'::uuid,
    '00000000-0000-4000-8000-00000000e203'::uuid,
    'https://accounts.google.com', repeat('a', 64), 1,
    'masterStatus',
    current_setting('compass.test.c2_master_control_lecture_id')::uuid,
    null::uuid, null::text, false
  ) ->> 'accepted',
  'true',
  'master status remains available while operational admission is disabled'
);
SELECT is(
  public.manage_google_admin_ai_master_v1(
    repeat('1', 64),
    '00000000-0000-4000-8000-00000000e202'::uuid,
    '00000000-0000-4000-8000-00000000e203'::uuid,
    'https://accounts.google.com', repeat('a', 64), 1,
    'revokeMaster',
    current_setting('compass.test.c2_master_control_lecture_id')::uuid,
    '00000000-0000-4000-8000-00000000e2f2'::uuid,
    'teacher_requested_stop', false
  ) ->> 'accepted',
  'true',
  'master revoke remains available while operational admission is disabled'
);
SELECT is(
  public.manage_google_admin_ai_master_v1(
    repeat('1', 64),
    '00000000-0000-4000-8000-00000000e202'::uuid,
    '00000000-0000-4000-8000-00000000e203'::uuid,
    'https://accounts.google.com', repeat('a', 64), 1,
    'revokeMaster',
    current_setting('compass.test.c2_master_control_lecture_id')::uuid,
    '00000000-0000-4000-8000-00000000e2f2'::uuid,
    'teacher_requested_stop', false
  ) ->> 'control_replayed',
  'true',
  'a lost master-revoke response converges without restoring admission'
);
RESET ROLE;
SELECT is(
  (
    SELECT master.status
    FROM public.lecture_ai_master_authorizations AS master
    WHERE master.lecture_session_id =
      current_setting('compass.test.c2_master_control_lecture_id')::uuid
  ),
  'revoked',
  'master revoke drains and terminalizes the exact lecture authority'
);

SET ROLE service_role;
SELECT is(
  public.manage_google_admin_ai_control_v1(
    repeat('1', 64),
    '00000000-0000-4000-8000-00000000e202'::uuid,
    '00000000-0000-4000-8000-00000000e203'::uuid,
    'https://accounts.google.com', repeat('a', 64), 1,
    'status',
    current_setting('compass.test.c2_master_control_lecture_id')::uuid,
    null::uuid, null::uuid, null::jsonb, null::text, null::text, false
  ) ->> 'accepted',
  'true',
  'AI control status remains available while operational admission is disabled'
);
SELECT is(
  public.manage_google_admin_ai_control_v1(
    repeat('1', 64),
    '00000000-0000-4000-8000-00000000e202'::uuid,
    '00000000-0000-4000-8000-00000000e203'::uuid,
    'https://accounts.google.com', repeat('a', 64), 1,
    'disableFeatures',
    current_setting('compass.test.c2_master_control_lecture_id')::uuid,
    '00000000-0000-4000-8000-00000000e2f3'::uuid,
    null::uuid, '{"captions_enabled":false}'::jsonb,
    null::text, null::text, false
  ) ->> 'accepted',
  'true',
  'safe feature disable remains available while operational admission is disabled'
);
SELECT is(
  public.manage_google_admin_ai_control_v1(
    repeat('1', 64),
    '00000000-0000-4000-8000-00000000e202'::uuid,
    '00000000-0000-4000-8000-00000000e203'::uuid,
    'https://accounts.google.com', repeat('a', 64), 1,
    'disableFeatures',
    current_setting('compass.test.c2_master_control_lecture_id')::uuid,
    '00000000-0000-4000-8000-00000000e2f3'::uuid,
    null::uuid, '{"captions_enabled":false}'::jsonb,
    null::text, null::text, false
  ) ->> 'idempotentReplay',
  'true',
  'a lost feature-disable response converges without restoring admission'
);
SELECT throws_ok(
  format(
    $$SELECT public.manage_google_admin_ai_control_v1(
      repeat('1',64),
      '00000000-0000-4000-8000-00000000e202'::uuid,
      '00000000-0000-4000-8000-00000000e203'::uuid,
      'https://accounts.google.com', repeat('a',64), 1,
      'setSummaryLanguage', %L::uuid,
      '00000000-0000-4000-8000-00000000e2f4'::uuid,
      null::uuid, '{"summary_language":"ja"}'::jsonb,
      null::text, null::text, false
    )$$,
    current_setting('compass.test.c2_master_control_lecture_id')
  ),
  'P7337',
  'Google Admin operational authorization is disabled',
  'default-OFF blocks new AI control writes without blocking status or stop'
);
SELECT is(
  public.manage_google_admin_ai_control_v1(
    repeat('1', 64),
    '00000000-0000-4000-8000-00000000e202'::uuid,
    '00000000-0000-4000-8000-00000000e203'::uuid,
    'https://accounts.google.com', repeat('a', 64), 1,
    'stop',
    current_setting('compass.test.c2_master_control_lecture_id')::uuid,
    '00000000-0000-4000-8000-00000000e2f5'::uuid,
    null::uuid, null::jsonb, 'teacher_requested_stop', null::text, false
  ) ->> 'accepted',
  'true',
  'full stop remains available while operational admission is disabled'
);
SELECT is(
  public.manage_google_admin_ai_control_v1(
    repeat('1', 64),
    '00000000-0000-4000-8000-00000000e202'::uuid,
    '00000000-0000-4000-8000-00000000e203'::uuid,
    'https://accounts.google.com', repeat('a', 64), 1,
    'stop',
    current_setting('compass.test.c2_master_control_lecture_id')::uuid,
    '00000000-0000-4000-8000-00000000e2f5'::uuid,
    null::uuid, null::jsonb, 'teacher_requested_stop', null::text, false
  ) ->> 'idempotentReplay',
  'true',
  'a lost full-stop response converges without reactivating provider authority'
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

CREATE FUNCTION pg_temp.prepare_academic_answer(
  preflight_request_id uuid,
  publication_mode text,
  run_id uuid,
  run_token_hash text,
  idempotency_key text,
  source_kind text,
  source_summary_id uuid,
  transport_enabled boolean
) RETURNS jsonb
LANGUAGE sql VOLATILE SET search_path = '' AS $$
  SELECT public.prepare_google_admin_academic_answer_v1(
    repeat('1',64),
    '00000000-0000-4000-8000-00000000e202'::uuid,
    '00000000-0000-4000-8000-00000000e203'::uuid,
    'https://accounts.google.com', repeat('a',64), 1,
    current_setting('compass.test.c2_provider_lecture_id')::uuid,
    publication_mode, run_id, run_token_hash, idempotency_key, source_kind,
    source_summary_id, 'What evidence supports this treatment?',
    encode(
      extensions.digest(
        convert_to('What evidence supports this treatment?', 'UTF8'),
        'sha256'
      ),
      'hex'
    ),
    repeat('b',64), 'auto', preflight_request_id, transport_enabled
  );
$$;

CREATE FUNCTION pg_temp.get_academic_results()
RETURNS jsonb
LANGUAGE sql VOLATILE SET search_path = '' AS $$
  SELECT public.get_google_admin_academic_results_v1(
    repeat('1',64),
    '00000000-0000-4000-8000-00000000e202'::uuid,
    '00000000-0000-4000-8000-00000000e203'::uuid,
    'https://accounts.google.com', repeat('a',64), 1, true,
    current_setting('compass.test.c2_provider_lecture_id')::uuid
  );
$$;

CREATE FUNCTION pg_temp.renew_academic_preflight(
  preflight_request_id uuid,
  academic_request_id uuid,
  preflight_context_digest text,
  publication_mode text,
  run_id uuid,
  run_token_hash text,
  idempotency_key text,
  source_kind text,
  source_summary_id uuid,
  transport_enabled boolean
) RETURNS jsonb
LANGUAGE sql VOLATILE SET search_path = '' AS $$
  SELECT public.renew_google_admin_academic_answer_preflight_v1(
    repeat('1',64),
    '00000000-0000-4000-8000-00000000e202'::uuid,
    '00000000-0000-4000-8000-00000000e203'::uuid,
    'https://accounts.google.com', repeat('a',64), 1,
    current_setting('compass.test.c2_provider_lecture_id')::uuid,
    academic_request_id, publication_mode, run_id, run_token_hash,
    idempotency_key, source_kind, source_summary_id,
    encode(
      extensions.digest(
        convert_to('What evidence supports this treatment?', 'UTF8'),
        'sha256'
      ),
      'hex'
    ),
    repeat('b',64), 'auto', preflight_request_id,
    preflight_context_digest, transport_enabled
  );
$$;

CREATE FUNCTION pg_temp.issue_academic_child(
  grant_request_id uuid,
  nonce_hash text,
  academic_request_id uuid,
  preflight_request_id uuid,
  preflight_context_digest text,
  publication_mode text,
  run_id uuid,
  source_set_sha256 text,
  provider_payload_sha256 text,
  transport_enabled boolean
) RETURNS jsonb
LANGUAGE sql VOLATILE SET search_path = '' AS $$
  SELECT public.issue_google_academic_answer_ai_child_grant_v1(
    repeat('1',64),
    '00000000-0000-4000-8000-00000000e202'::uuid,
    '00000000-0000-4000-8000-00000000e203'::uuid,
    'https://accounts.google.com', repeat('a',64), 1,
    current_setting('compass.test.c2_provider_lecture_id')::uuid,
    academic_request_id, preflight_request_id, preflight_context_digest,
    publication_mode, run_id, source_set_sha256, 'biomedical_pubmed', 1, 1,
    provider_payload_sha256, 'test-model', 'phase7-25-academic-v1',
    1000000, 6000000, 1200, 8200, 1000, 1200,
    nonce_hash, 1, grant_request_id, transport_enabled
  );
$$;

CREATE FUNCTION pg_temp.start_academic_operation(
  start_request_id uuid,
  grant_id uuid,
  nonce_hash text,
  academic_request_id uuid,
  preflight_request_id uuid,
  preflight_context_digest text,
  publication_mode text,
  run_id uuid,
  source_set_sha256 text,
  provider_payload_sha256 text,
  provider_intent_digest text,
  transport_enabled boolean
) RETURNS jsonb
LANGUAGE sql VOLATILE SET search_path = '' AS $$
  SELECT public.start_google_admin_academic_answer_operation_v1(
    repeat('1',64),
    '00000000-0000-4000-8000-00000000e202'::uuid,
    '00000000-0000-4000-8000-00000000e203'::uuid,
    'https://accounts.google.com', repeat('a',64), 1,
    grant_id, nonce_hash,
    current_setting('compass.test.c2_provider_lecture_id')::uuid,
    academic_request_id, preflight_request_id, preflight_context_digest,
    publication_mode, run_id, source_set_sha256, 'biomedical_pubmed', 1, 1,
    provider_payload_sha256, 'test-model', 'phase7-25-academic-v1',
    1000000, 6000000, 1200, 8200, 1000, 1200,
    start_request_id, provider_intent_digest, transport_enabled
  );
$$;

SET ROLE service_role;
SELECT throws_ok(
  $$SELECT pg_temp.prepare_academic_answer(
    '00000000-0000-4000-8000-00000000e2a0'::uuid,
    'manual_review', null::uuid, null::text,
    'phase730c2-academic-manual-a', 'teacher_selected', null::uuid, true
  )$$,
  'P7338',
  'Google academic preflight is disabled',
  'default-OFF rejects Academic preflight before evidence or paid authority exists'
);
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
  set_config(
    'compass.test.c2_ai_control_intent',
    public.get_google_admin_ai_control_configuration_intent_v1(
      repeat('1', 64),
      '00000000-0000-4000-8000-00000000e202'::uuid,
      '00000000-0000-4000-8000-00000000e203'::uuid,
      'https://accounts.google.com', repeat('a', 64), 1,
      current_setting('compass.test.c2_master_control_lecture_id')::uuid,
      '00000000-0000-4000-8000-00000000e2f6'::uuid,
      '{"budget_limit_microusd":3000000}'::jsonb,
      true
    ) ->> 'intentDigest',
    false
  ) ~ '^[0-9a-f]{64}$',
  'AI policy preview returns one request-bound server intent digest'
);
SELECT is(
  public.manage_google_admin_ai_control_v1(
    repeat('1', 64),
    '00000000-0000-4000-8000-00000000e202'::uuid,
    '00000000-0000-4000-8000-00000000e203'::uuid,
    'https://accounts.google.com', repeat('a', 64), 1,
    'configure',
    current_setting('compass.test.c2_master_control_lecture_id')::uuid,
    '00000000-0000-4000-8000-00000000e2f6'::uuid,
    null::uuid, '{"budget_limit_microusd":3000000}'::jsonb,
    null::text, current_setting('compass.test.c2_ai_control_intent'), true
  )::text,
  null,
  'AI policy mutation fails closed until its five-minute control grant exists'
);
RESET ROLE;
SELECT pg_temp.seed_c2_admin_control_grant(
  '00000000-0000-4000-8000-00000000e208'::uuid,
  'environment_ai_policy_change',
  '00000000-0000-4000-8000-00000000e2f6'::uuid,
  current_setting('compass.test.c2_ai_control_intent')
);
SET ROLE service_role;
SELECT is(
  public.manage_google_admin_ai_control_v1(
    repeat('1', 64),
    '00000000-0000-4000-8000-00000000e202'::uuid,
    '00000000-0000-4000-8000-00000000e203'::uuid,
    'https://accounts.google.com', repeat('a', 64), 1,
    'configure',
    current_setting('compass.test.c2_master_control_lecture_id')::uuid,
    '00000000-0000-4000-8000-00000000e2f6'::uuid,
    null::uuid, '{"budget_limit_microusd":3000000}'::jsonb,
    null::text, current_setting('compass.test.c2_ai_control_intent'), true
  ) ->> 'accepted',
  'true',
  'AI policy mutation consumes the exact five-minute control grant'
);
SELECT is(
  public.manage_google_admin_ai_control_v1(
    repeat('1', 64),
    '00000000-0000-4000-8000-00000000e202'::uuid,
    '00000000-0000-4000-8000-00000000e203'::uuid,
    'https://accounts.google.com', repeat('a', 64), 1,
    'configure',
    current_setting('compass.test.c2_master_control_lecture_id')::uuid,
    '00000000-0000-4000-8000-00000000e2f6'::uuid,
    null::uuid, '{"budget_limit_microusd":3000000}'::jsonb,
    null::text, current_setting('compass.test.c2_ai_control_intent'), true
  ) ->> 'idempotentReplay',
  'true',
  'lost AI policy mutation responses converge without another TOTP prompt'
);
SELECT ok(
  set_config(
    'compass.test.c2_ai_control_changed_intent',
    public.get_google_admin_ai_control_configuration_intent_v1(
      repeat('1', 64),
      '00000000-0000-4000-8000-00000000e202'::uuid,
      '00000000-0000-4000-8000-00000000e203'::uuid,
      'https://accounts.google.com', repeat('a', 64), 1,
      current_setting('compass.test.c2_master_control_lecture_id')::uuid,
      '00000000-0000-4000-8000-00000000e2f6'::uuid,
      '{"budget_limit_microusd":4000000}'::jsonb,
      true
    ) ->> 'intentDigest',
    false
  ) ~ '^[0-9a-f]{64}$',
  'changed policy payload receives a different canonical intent'
);
SELECT throws_ok(
  format(
    $$SELECT public.manage_google_admin_ai_control_v1(
      repeat('1',64),
      '00000000-0000-4000-8000-00000000e202'::uuid,
      '00000000-0000-4000-8000-00000000e203'::uuid,
      'https://accounts.google.com', repeat('a',64), 1,
      'configure', %L::uuid,
      '00000000-0000-4000-8000-00000000e2f6'::uuid,
      null::uuid, '{"budget_limit_microusd":4000000}'::jsonb,
      null::text, %L::text, true
    )$$,
    current_setting('compass.test.c2_master_control_lecture_id'),
    current_setting('compass.test.c2_ai_control_changed_intent')
  ),
  'P7335',
  'AI control request binding does not match its receipt',
  'the same request cannot replace an accepted AI policy payload'
);

SELECT ok(
  (
    SELECT set_config(
      'compass.test.c2_summary_run_id', result #>> '{run,id}', false
    ) IS NOT NULL
      AND result ->> 'accepted' = 'true'
      AND result ->> 'idempotentReplay' = 'false'
      AND result ->> 'refreshRequired' = 'false'
    FROM (
      SELECT public.manage_google_admin_summary_run_v2(
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
      SELECT public.manage_google_admin_summary_run_v2(
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

SELECT is(
  set_config(
    'compass.test.c2_summary_provider_run_token_hash',
    repeat('e', 64),
    false
  ),
  repeat('e', 64),
  'the summary provider fixture persists its run token independently of assertion evaluation'
);
SET ROLE service_role;
SELECT ok(
  (
    SELECT set_config(
      'compass.test.c2_summary_provider_run_id',
      result #>> '{run,id}',
      false
    ) IS NOT NULL
      AND result ->> 'accepted' = 'true'
      AND result ->> 'idempotentReplay' = 'false'
    FROM (
      SELECT public.manage_google_admin_summary_run_v2(
        repeat('1',64),
        '00000000-0000-4000-8000-00000000e202'::uuid,
        '00000000-0000-4000-8000-00000000e203'::uuid,
        'https://accounts.google.com', repeat('a',64), 1,
        current_setting('compass.test.c2_provider_lecture_id')::uuid,
        'start', repeat('e',64), true, 'auto', null,
        '00000000-0000-4000-8000-00000000e263'::uuid, true
      ) AS result
    ) AS started
  ),
  'Google summary scheduling remains a provider-free control before each window'
);
RESET ROLE;
SELECT ok(
  (
    SELECT run.auto_academic_answers_enabled
      AND run.academic_authority_mode = 'google_per_call'
      AND run.academic_authorization_grant_id IS NULL
      AND run.token_hash =
        current_setting('compass.test.c2_summary_provider_run_token_hash')
    FROM public.lecture_summary_runs AS run
    WHERE run.id = current_setting('compass.test.c2_summary_provider_run_id')::uuid
  )
  AND NOT EXISTS (
    SELECT 1
    FROM private.admin_google_ai_child_grant_receipts AS child
    WHERE child.request_id =
      '00000000-0000-4000-8000-00000000e263'::uuid
  ),
  'Google automatic summary scheduling is grant-free until each provider call'
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

SELECT ok(
  private.google_summary_source_evidence_is_valid_v1(
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
  ),
  'the prepared-window source fixture satisfies the closed evidence schema'
);
SELECT ok(
  (
    SELECT lecture.status = 'open'
      AND lecture.hard_stop_at > statement_timestamp()
      AND control.summaries_enabled
      AND control.status in ('ready', 'running')
      AND run.status = 'running'
      AND run.expires_at > statement_timestamp()
      AND run.token_hash =
        current_setting('compass.test.c2_summary_provider_run_token_hash')
    FROM public.lecture_summary_runs AS run
    JOIN public.lecture_sessions AS lecture
      ON lecture.id = run.lecture_session_id
    JOIN public.lecture_ai_control AS control
      ON control.lecture_session_id = run.lecture_session_id
    WHERE run.id =
      current_setting('compass.test.c2_summary_provider_run_id')::uuid
  ),
  'the summary provider run, lecture and control remain live before preflight'
);
SELECT is(
  private.require_google_admin_operation_context_v1(
    repeat('1',64),
    '00000000-0000-4000-8000-00000000e202'::uuid,
    '00000000-0000-4000-8000-00000000e203'::uuid,
    'https://accounts.google.com', repeat('a',64), 1,
    'generate-lecture-summary.generate',
    current_setting('compass.test.c2_provider_lecture_id')::uuid
  ) ->> 'lecture_lock_mode',
  'update',
  'the due-window operation context preserves Google identity, ownership and lock mode'
);

SET ROLE service_role;
WITH captured AS MATERIALIZED (
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
), persisted AS MATERIALIZED (
  SELECT
    result,
    set_config(
      'compass.test.c2_summary_preflight_result_a',
      coalesce(result::text, 'null'),
      false
    ) AS stored_result
  FROM captured
)
SELECT ok(
  stored_result = coalesce(result::text, 'null')
    AND set_config(
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
    AND result ->> 'resultStatus' = 'prepared',
  format(
    'one due summary window prepares immutable source context without a child (result=%s)',
    case when result is null then 'SQL NULL' else jsonb_strip_nulls(
      jsonb_build_object(
        'accepted', result -> 'accepted',
        'idempotentReplay', result -> 'idempotentReplay',
        'reason', result -> 'reason',
        'refreshRequired', result -> 'refreshRequired',
        'resultStatus', result -> 'resultStatus',
        'windowStatus', result -> 'windowStatus'
      )
    )::text end
  )
)
FROM persisted;
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
        nullif(
          current_setting('compass.test.c2_summary_preflight_window_a', true),
          ''
        )::uuid,
        nullif(
          current_setting('compass.test.c2_summary_preflight_attempt_a', true),
          ''
        )::integer,
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
        nullif(
          current_setting('compass.test.c2_summary_child_a', true),
          ''
        )::uuid,
        repeat('a',64),
        '00000000-0000-4000-8000-00000000e270'::uuid,
        nullif(
          current_setting('compass.test.c2_summary_preflight_window_a', true),
          ''
        )::uuid,
        nullif(
          current_setting('compass.test.c2_summary_preflight_attempt_a', true),
          ''
        )::integer,
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
    nullif(
      current_setting('compass.test.c2_summary_child_a', true),
      ''
    )::uuid,
    repeat('a',64),
    '00000000-0000-4000-8000-00000000e270'::uuid,
    nullif(
      current_setting('compass.test.c2_summary_preflight_window_a', true),
      ''
    )::uuid,
    nullif(
      current_setting('compass.test.c2_summary_preflight_attempt_a', true),
      ''
    )::integer,
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
    nullif(
      current_setting('compass.test.c2_summary_operation_a', true),
      ''
    )::uuid,
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
        nullif(
          current_setting('compass.test.c2_summary_operation_a', true),
          ''
        )::uuid,
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
SET
  status = 'suspended',
  suspended_at = statement_timestamp(),
  status_reason = 'phase730c2_summary_authority_test'
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
      AND usage.error_code = 'google_authority_revoked_ambiguous'
      AND summary_window.status = 'discarded'
      AND summary_window.current_operation_id IS NULL
      AND summary_window.last_error_code = 'master_authorization_stopped'
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
SET status = 'active', suspended_at = null, status_reason = null
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
      SELECT public.manage_google_admin_summary_run_v2(
        repeat('1',64),
        '00000000-0000-4000-8000-00000000e202'::uuid,
        '00000000-0000-4000-8000-00000000e203'::uuid,
        'https://accounts.google.com', repeat('a',64), 1,
        current_setting('compass.test.c2_provider_lecture_id')::uuid,
        'start', repeat('f',64), true, 'auto', null,
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
RESET ROLE;
SELECT ok(
  (SELECT result ->> 'operationStatus' = 'failed'
    AND result ->> 'settled' = 'true'
    AND result ->> 'actualCost' = '0'
   FROM pg_temp.probe_summary_failure(false) AS result),
  'a summary failure before dispatch releases its unused reservation'
);
SET ROLE service_role;
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
SELECT throws_ok(
  $$SELECT public.fail_google_admin_summary_window_operation_v1(
    repeat('1',64),
    '00000000-0000-4000-8000-00000000e202'::uuid,
    '00000000-0000-4000-8000-00000000e203'::uuid,
    'https://accounts.google.com', repeat('a',64), 1,
    '00000000-0000-4000-8000-00000000e27f'::uuid,
    current_setting('compass.test.c2_summary_operation_e')::uuid,
    'failed', 0, 0, 0, NULL, 'summary_provider_failed'
  )$$,
  'P7335',
  'Google summary failure lacks dispatch ownership',
  'a lost claim response cannot zero-settle a concurrent authorized dispatch'
);
RESET ROLE;
SELECT ok(
  (SELECT status = 'running' AND accounting_settled_at IS NULL
   FROM public.ai_usage_ledger
   WHERE id = current_setting('compass.test.c2_summary_operation_e')::uuid),
  'rejected late failure leaves the live operation unmodified'
);
SELECT ok(
  (SELECT result ->> 'operationStatus' = 'failed'
    AND result ->> 'settled' = 'true'
    AND result ->> 'actualCost' = '0'
   FROM pg_temp.probe_summary_failure(true) AS result),
  'a real dispatched HTTP429 can still settle zero usage with its claim ID'
);
SELECT ok(
  (SELECT result ->> 'operationStatus' = 'failed'
    AND result ->> 'settled' = 'true'
    AND result ->> 'actualCost' = result ->> 'expectedCost'
   FROM pg_temp.probe_summary_failure(true, true) AS result),
  'ambiguous provider timeout still settles the conservative reservation'
);
SET ROLE service_role;
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
          'comment_pulse', '[]'::jsonb,
          'academic_question_candidate', jsonb_build_object(
            'question', 'What evidence supports this treatment?',
            'educationalValue', 'Supports evidence review',
            'qualityScore', 0.9
          )
        ),
        '{}'::jsonb, false, 1600, 1000, 100,
        '00000000-0000-4000-8000-00000000e27f'
      ) AS result
    ) AS completed
  ),
  'a recovered authorized retry saves its result without another MFA prompt'
);
SELECT is(
  public.fail_google_admin_summary_window_operation_v1(
    repeat('1',64),
    '00000000-0000-4000-8000-00000000e202'::uuid,
    '00000000-0000-4000-8000-00000000e203'::uuid,
    'https://accounts.google.com', repeat('a',64), 1,
    '00000000-0000-4000-8000-00000000e27f'::uuid,
    current_setting('compass.test.c2_summary_operation_e')::uuid,
    'failed', 0, 0, 0, NULL, 'summary_provider_failed'
  ) ->> 'idempotentReplay',
  'true',
  'a late failure replay cannot alter already settled summary output'
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
    SELECT set_config(
      'compass.test.c2_academic_request_a',
      result ->> 'academicRequestId', false
    ) IS NOT NULL
      AND set_config(
        'compass.test.c2_academic_preflight_digest_a',
        result ->> 'providerContextDigest', false
      ) IS NOT NULL
      AND result ->> 'accepted' = 'true'
      AND result ->> 'claimAcquired' = 'true'
      AND result ->> 'idempotentReplay' = 'false'
      AND result ->> 'requestStatus' = 'evidence_checking'
    FROM (
      SELECT pg_temp.prepare_academic_answer(
        '00000000-0000-4000-8000-00000000e2a0'::uuid,
        'manual_review', null::uuid, null::text,
        'phase730c2-academic-manual-a', 'teacher_selected', null::uuid, true
      ) AS result
    ) AS prepared
  ),
  'manual Academic preflight creates one content-free request lease'
);
SELECT ok(
  (
    SELECT active_request ->> 'preflight_request_id' =
        '00000000-0000-4000-8000-00000000e2a0'
      AND active_request ->> 'id' =
        current_setting('compass.test.c2_academic_request_a')
      AND NOT (active_request ? 'question_sha256')
      AND NOT (active_request ? 'search_query_sha256')
      AND NOT (active_request ? 'provider_context_digest')
    FROM jsonb_array_elements(
      pg_temp.get_academic_results() -> 'active_requests'
    ) AS active_request
    WHERE active_request ->> 'id' =
      current_setting('compass.test.c2_academic_request_a')
  ),
  'guarded Academic status returns the exact preflight binding without private receipt hashes'
);
SELECT ok(
  (
    SELECT result ->> 'academicRequestId' =
        current_setting('compass.test.c2_academic_request_a')
      AND result ->> 'claimAcquired' = 'false'
      AND result ->> 'idempotentReplay' = 'true'
      AND NOT (result ? 'results')
    FROM (
      SELECT pg_temp.prepare_academic_answer(
        '00000000-0000-4000-8000-00000000e2a0'::uuid,
        'manual_review', null::uuid, null::text,
        'phase730c2-academic-manual-a', 'teacher_selected', null::uuid, true
      ) AS result
    ) AS replayed
  ),
  'Academic preflight exact replay returns receipt metadata without provider content'
);
RESET ROLE;
UPDATE public.academic_answer_requests
SET lease_until = statement_timestamp() + interval '10 seconds',
    updated_at = statement_timestamp()
WHERE id = current_setting('compass.test.c2_academic_request_a')::uuid;
SET ROLE service_role;
SELECT ok(
  (
    SELECT set_config(
      'compass.test.c2_academic_renewed_lease_a',
      result ->> 'leaseUntil', false
    ) IS NOT NULL
      AND result ->> 'accepted' = 'true'
      AND result ->> 'academicRequestId' =
        current_setting('compass.test.c2_academic_request_a')
      AND result ->> 'preflightRequestId' =
        '00000000-0000-4000-8000-00000000e2a0'
      AND result ->> 'providerContextDigest' =
        current_setting('compass.test.c2_academic_preflight_digest_a')
      AND result ->> 'requestStatus' = 'evidence_checking'
      AND (result ->> 'leaseUntil')::timestamptz >
        statement_timestamp() + interval '1 minute'
    FROM (
      SELECT pg_temp.renew_academic_preflight(
        '00000000-0000-4000-8000-00000000e2a0'::uuid,
        current_setting('compass.test.c2_academic_request_a')::uuid,
        current_setting('compass.test.c2_academic_preflight_digest_a'),
        'manual_review', null::uuid, null::text,
        'phase730c2-academic-manual-a', 'teacher_selected', null::uuid, true
      ) AS result
    ) AS renewed
  ),
  'the retrieval owner renews the exact live authority and lease before child issue'
);
SELECT throws_ok(
  $$SELECT pg_temp.renew_academic_preflight(
    '00000000-0000-4000-8000-00000000e2a0'::uuid,
    current_setting('compass.test.c2_academic_request_a')::uuid,
    current_setting('compass.test.c2_academic_preflight_digest_a'),
    'manual_review', null::uuid, null::text,
    'phase730c2-academic-binding-changed', 'teacher_selected', null::uuid, true
  )$$,
  'P7335',
  'Google academic preflight renewal binding changed',
  'a changed retrieval binding cannot renew another preflight lease'
);
SELECT ok(
  (
    SELECT request.lease_until =
      current_setting('compass.test.c2_academic_renewed_lease_a')::timestamptz
    FROM public.academic_answer_requests AS request
    WHERE request.id =
      current_setting('compass.test.c2_academic_request_a')::uuid
  ),
  'a rejected renewal leaves the owner lease unchanged'
);
RESET ROLE;
UPDATE public.academic_answer_requests
SET lease_until = statement_timestamp() - interval '1 second',
    updated_at = statement_timestamp()
WHERE id = current_setting('compass.test.c2_academic_request_a')::uuid;
SET ROLE service_role;
SELECT is(
  pg_temp.prepare_academic_answer(
    '00000000-0000-4000-8000-00000000e2a0'::uuid,
    'manual_review', null::uuid, null::text,
    'phase730c2-academic-manual-a', 'teacher_selected', null::uuid, true
  ) ->> 'claimAcquired',
  'true',
  'an expired unstarted Academic lease is recovered by the same exact request'
);
SELECT ok(
  (
    SELECT set_config(
      'compass.test.c2_academic_child_a', result ->> 'grant_id', false
    ) IS NOT NULL
      AND set_config(
        'compass.test.c2_academic_provider_digest_a',
        result ->> 'providerIntentDigest', false
      ) IS NOT NULL
      AND result ->> 'accepted' = 'true'
      AND result ->> 'idempotentReplay' = 'false'
    FROM (
      SELECT pg_temp.issue_academic_child(
        '00000000-0000-4000-8000-00000000e2a1'::uuid,
        repeat('6',63) || '7',
        current_setting('compass.test.c2_academic_request_a')::uuid,
        '00000000-0000-4000-8000-00000000e2a0'::uuid,
        current_setting('compass.test.c2_academic_preflight_digest_a'),
        'manual_review', null::uuid, repeat('c',64), repeat('d',64), true
      ) AS result
    ) AS issued
  ),
  'one manual Academic provider call receives one short-lived child'
);
SELECT is(
  pg_temp.start_academic_operation(
    '00000000-0000-4000-8000-00000000e2a2'::uuid,
    current_setting('compass.test.c2_academic_child_a')::uuid,
    null::text,
    current_setting('compass.test.c2_academic_request_a')::uuid,
    '00000000-0000-4000-8000-00000000e2a0'::uuid,
    current_setting('compass.test.c2_academic_preflight_digest_a'),
    'manual_review', null::uuid, repeat('c',64), repeat('d',64),
    current_setting('compass.test.c2_academic_provider_digest_a'), true
  )::text,
  null,
  'NULL Academic child nonce fails closed without consuming authority'
);
SELECT ok(
  (
    SELECT set_config(
      'compass.test.c2_academic_operation_a', result ->> 'operationId', false
    ) IS NOT NULL
      AND result ->> 'accepted' = 'true'
      AND result ->> 'idempotentReplay' = 'false'
    FROM (
      SELECT pg_temp.start_academic_operation(
        '00000000-0000-4000-8000-00000000e2a2'::uuid,
        current_setting('compass.test.c2_academic_child_a')::uuid,
        repeat('6',63) || '7',
        current_setting('compass.test.c2_academic_request_a')::uuid,
        '00000000-0000-4000-8000-00000000e2a0'::uuid,
        current_setting('compass.test.c2_academic_preflight_digest_a'),
        'manual_review', null::uuid, repeat('c',64), repeat('d',64),
        current_setting('compass.test.c2_academic_provider_digest_a'), true
      ) AS result
    ) AS started
  ),
  'Academic start atomically consumes one child and reserves one operation'
);
SELECT ok(
  (
    SELECT result ->> 'grant_id' =
        current_setting('compass.test.c2_academic_child_a')
      AND result ->> 'idempotentReplay' = 'true'
      AND result ->> 'providerIntentDigest' =
        current_setting('compass.test.c2_academic_provider_digest_a')
    FROM (
      SELECT pg_temp.issue_academic_child(
        '00000000-0000-4000-8000-00000000e2a1'::uuid,
        repeat('6',63) || '7',
        current_setting('compass.test.c2_academic_request_a')::uuid,
        '00000000-0000-4000-8000-00000000e2a0'::uuid,
        current_setting('compass.test.c2_academic_preflight_digest_a'),
        'manual_review', null::uuid, repeat('c',64), repeat('d',64), true
      ) AS result
    ) AS replayed
  ),
  'lost child response recovers the consumed child through immutable start evidence'
);
SELECT ok(
  (
    SELECT result ->> 'operationId' =
        current_setting('compass.test.c2_academic_operation_a')
      AND result ->> 'idempotentReplay' = 'true'
    FROM (
      SELECT pg_temp.start_academic_operation(
        '00000000-0000-4000-8000-00000000e2a2'::uuid,
        current_setting('compass.test.c2_academic_child_a')::uuid,
        repeat('6',63) || '7',
        current_setting('compass.test.c2_academic_request_a')::uuid,
        '00000000-0000-4000-8000-00000000e2a0'::uuid,
        current_setting('compass.test.c2_academic_preflight_digest_a'),
        'manual_review', null::uuid, repeat('c',64), repeat('d',64),
        current_setting('compass.test.c2_academic_provider_digest_a'), true
      ) AS result
    ) AS replayed
  ),
  'lost Academic start response converges on the same operation before dispatch'
);
SELECT is(
  public.claim_google_ai_provider_dispatch_v1(
    repeat('1',64),
    '00000000-0000-4000-8000-00000000e202'::uuid,
    '00000000-0000-4000-8000-00000000e203'::uuid,
    'https://accounts.google.com', repeat('a',64), 1,
    '00000000-0000-4000-8000-00000000e2a2'::uuid,
    current_setting('compass.test.c2_academic_operation_a')::uuid,
    'openai_responses_v1',
    '00000000-0000-4000-8000-00000000e2a2'::uuid,
    true
  ) ->> 'dispatchAllowed',
  'true',
  'the recovered Academic operation receives exactly one provider dispatch claim'
);
RESET ROLE;
SELECT ok(
  (
    SELECT grant_record.status = 'consumed'
      AND grant_record.operation_ids = array[binding.operation_id]::uuid[]
      AND binding.operation_id =
        current_setting('compass.test.c2_academic_operation_a')::uuid
      AND request.status = 'running'
      AND request.operation_id = binding.operation_id
    FROM private.admin_google_academic_answer_start_bindings AS binding
    JOIN private.admin_google_ai_provider_start_receipts AS start_receipt
      ON start_receipt.start_request_id = binding.start_request_id
    JOIN public.ai_billing_grants AS grant_record
      ON grant_record.id = start_receipt.child_grant_id
    JOIN public.academic_answer_requests AS request
      ON request.id = binding.academic_request_id
    WHERE binding.start_request_id =
      '00000000-0000-4000-8000-00000000e2a2'::uuid
  ),
  'Academic preflight, child, operation and request share exact immutable provenance'
);

UPDATE private.admin_environment_memberships
SET
  status = 'suspended',
  suspended_at = statement_timestamp(),
  status_reason = 'phase730c2_academic_authority_test'
WHERE id = '00000000-0000-4000-8000-00000000e206'::uuid;
SET ROLE service_role;
SELECT is(
  public.complete_google_admin_academic_answer_operation_v1(
    repeat('1',64),
    '00000000-0000-4000-8000-00000000e202'::uuid,
    '00000000-0000-4000-8000-00000000e203'::uuid,
    'https://accounts.google.com', repeat('a',64), 1,
    '00000000-0000-4000-8000-00000000e2a2'::uuid,
    current_setting('compass.test.c2_academic_operation_a')::uuid,
    '[]'::jsonb, '{}'::jsonb, '{}'::jsonb, 0, 0, 0,
    '00000000-0000-4000-8000-00000000e2a2'
  ) ->> 'authorityRevoked',
  'true',
  'Academic completion rechecks live Google authority and discards revoked output'
);
RESET ROLE;
SELECT ok(
  (
    SELECT usage.status = 'cancelled'
      AND usage.accounting_settled_at IS NOT NULL
      AND NOT usage.result_accepted
      AND (
        SELECT request.status IN ('failed', 'discarded')
        FROM public.academic_answer_requests AS request
        WHERE request.id =
          current_setting('compass.test.c2_academic_request_a')::uuid
      )
    FROM public.ai_usage_ledger AS usage
    WHERE usage.id = current_setting('compass.test.c2_academic_operation_a')::uuid
  ),
  'revoked Academic output is accounted without persisting an answer'
);
UPDATE private.admin_environment_memberships
SET status = 'active', suspended_at = null, status_reason = null
WHERE id = '00000000-0000-4000-8000-00000000e206'::uuid;
SET ROLE service_role;
SELECT is(
  public.authorize_google_ai_master_with_pin_v1(
    repeat('1', 64),
    '00000000-0000-4000-8000-00000000e202'::uuid,
    '00000000-0000-4000-8000-00000000e203'::uuid,
    current_setting('compass.test.c2_provider_lecture_id')::uuid,
    'all_including_captions',
    '00000000-0000-4000-8000-00000000e20a'::uuid, 1,
    repeat('b', 64), 1, repeat('e', 64),
    '00000000-0000-4000-8000-00000000e2a3'::uuid
  ) ->> 'accepted',
  'true',
  'restored membership explicitly creates one Academic and Realtime-capable master'
);
SELECT ok(
  (
    SELECT set_config(
      'compass.test.c2_academic_auto_run_id', result #>> '{run,id}', false
    ) IS NOT NULL
      AND set_config(
        'compass.test.c2_academic_auto_run_token_hash', repeat('9',64), false
      ) IS NOT NULL
      AND set_config(
        'compass.test.c2_summary_provider_run_id', result #>> '{run,id}', false
      ) IS NOT NULL
      AND set_config(
        'compass.test.c2_summary_provider_run_token_hash', repeat('9',64), false
      ) IS NOT NULL
      AND result ->> 'accepted' = 'true'
      AND result ->> 'idempotentReplay' = 'false'
    FROM (
      SELECT public.manage_google_admin_summary_run_v2(
        repeat('1',64),
        '00000000-0000-4000-8000-00000000e202'::uuid,
        '00000000-0000-4000-8000-00000000e203'::uuid,
        'https://accounts.google.com', repeat('a',64), 1,
        current_setting('compass.test.c2_provider_lecture_id')::uuid,
        'start', repeat('9',64), true, 'auto', null,
        '00000000-0000-4000-8000-00000000e2a4'::uuid, true
      ) AS result
    ) AS started
  ),
  'automatic Academic recovery starts a grant-free google_per_call run'
);
RESET ROLE;
UPDATE public.lecture_sessions
SET
  starts_at = statement_timestamp() - interval '30 minutes',
  started_at = statement_timestamp() - interval '30 minutes',
  updated_at = statement_timestamp()
WHERE id = current_setting('compass.test.c2_provider_lecture_id')::uuid;

SET ROLE service_role;
SELECT ok(
  (
    SELECT set_config(
      'compass.test.c2_academic_auto_summary_window',
      result #>> '{window,id}', false
    ) IS NOT NULL
      AND set_config(
        'compass.test.c2_academic_auto_summary_attempt',
        result ->> 'expectedAttempt', false
      ) IS NOT NULL
      AND set_config(
        'compass.test.c2_academic_auto_summary_preflight_digest',
        result ->> 'preflightContextDigest', false
      ) IS NOT NULL
      AND result ->> 'accepted' = 'true'
      AND result ->> 'resultStatus' = 'prepared'
    FROM (
      SELECT pg_temp.prepare_summary_window(
        '00000000-0000-4000-8000-00000000e2d0'::uuid,
        5,
        jsonb_build_object(
          'pdf_character_count', 0,
          'pdf_context_sha256', null,
          'pdf_max_page_number', 0,
          'pdf_page_count', 0,
          'transcript_character_count', 500,
          'transcript_segment_count', 1,
          'transcript_sha256', repeat('5',64)
        ),
        jsonb_build_object(
          'comments', false, 'pdf', false, 'transcript', true
        )
      ) AS result
    ) AS prepared
  ),
  'automatic Academic fixture prepares a summary in the same grant-free run'
);
SELECT ok(
  (
    SELECT set_config(
      'compass.test.c2_academic_auto_summary_child',
      result ->> 'grant_id', false
    ) IS NOT NULL
      AND set_config(
        'compass.test.c2_academic_auto_summary_provider_digest',
        result ->> 'providerIntentDigest', false
      ) IS NOT NULL
      AND result ->> 'accepted' = 'true'
    FROM (
      SELECT pg_temp.issue_summary_child(
        '00000000-0000-4000-8000-00000000e2d1'::uuid,
        repeat('5',63) || '6',
        '00000000-0000-4000-8000-00000000e2d0'::uuid,
        current_setting('compass.test.c2_academic_auto_summary_window')::uuid,
        current_setting('compass.test.c2_academic_auto_summary_attempt')::integer,
        current_setting(
          'compass.test.c2_academic_auto_summary_preflight_digest'
        ),
        repeat('6',64)
      ) AS result
    ) AS issued
  ),
  'automatic Academic fixture issues one summary child for that run'
);
SELECT ok(
  (
    SELECT set_config(
      'compass.test.c2_academic_auto_summary_operation',
      result ->> 'operationId', false
    ) IS NOT NULL
      AND result ->> 'accepted' = 'true'
      AND result ->> 'idempotentReplay' = 'false'
    FROM (
      SELECT pg_temp.start_summary_operation(
        '00000000-0000-4000-8000-00000000e2d2'::uuid,
        current_setting('compass.test.c2_academic_auto_summary_child')::uuid,
        repeat('5',63) || '6',
        '00000000-0000-4000-8000-00000000e2d0'::uuid,
        current_setting('compass.test.c2_academic_auto_summary_window')::uuid,
        current_setting('compass.test.c2_academic_auto_summary_attempt')::integer,
        current_setting(
          'compass.test.c2_academic_auto_summary_preflight_digest'
        ),
        repeat('6',64),
        current_setting(
          'compass.test.c2_academic_auto_summary_provider_digest'
        )
      ) AS result
    ) AS started
  ),
  'automatic Academic fixture starts one summary provider operation'
);
SELECT is(
  public.claim_google_ai_provider_dispatch_v1(
    repeat('1',64),
    '00000000-0000-4000-8000-00000000e202'::uuid,
    '00000000-0000-4000-8000-00000000e203'::uuid,
    'https://accounts.google.com', repeat('a',64), 1,
    '00000000-0000-4000-8000-00000000e2d2'::uuid,
    current_setting('compass.test.c2_academic_auto_summary_operation')::uuid,
    'openai_responses_v1',
    '00000000-0000-4000-8000-00000000e2d2'::uuid,
    true
  ) ->> 'dispatchAllowed',
  'true',
  'automatic Academic fixture claims its summary dispatch once'
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
        '00000000-0000-4000-8000-00000000e2d2'::uuid,
        current_setting('compass.test.c2_academic_auto_summary_operation')::uuid,
        jsonb_build_object(
          'lecture_recap', jsonb_build_array('Automatic source summary'),
          'comment_pulse', '[]'::jsonb,
          'academic_question_candidate', jsonb_build_object(
            'question', 'What evidence supports this treatment?',
            'educationalValue', 'Supports evidence review',
            'qualityScore', 0.9
          )
        ),
        '{}'::jsonb, false, 1600, 1000, 100,
        '00000000-0000-4000-8000-00000000e2d2'
      ) AS result
    ) AS completed
  ),
  'automatic Academic fixture saves one same-run verified summary candidate'
);
RESET ROLE;
SELECT ok(
  set_config(
    'compass.test.c2_academic_source_summary_id',
    (
      SELECT summary.id::text
      FROM public.lecture_ai_summaries AS summary
      JOIN public.lecture_summary_windows AS summary_window
        ON summary_window.id = summary.window_id
      WHERE summary.lecture_session_id =
        current_setting('compass.test.c2_provider_lecture_id')::uuid
        AND summary_window.run_id =
          current_setting('compass.test.c2_academic_auto_run_id')::uuid
      ORDER BY summary.created_at DESC, summary.id DESC
      LIMIT 1
    ),
    false
  ) IS NOT NULL,
  'automatic Academic fixture reuses one retained verified summary candidate'
);
SET ROLE service_role;
SELECT ok(
  (
    SELECT set_config(
      'compass.test.c2_academic_request_b',
      result ->> 'academicRequestId', false
    ) IS NOT NULL
      AND set_config(
        'compass.test.c2_academic_preflight_digest_b',
        result ->> 'providerContextDigest', false
      ) IS NOT NULL
      AND result ->> 'accepted' = 'true'
      AND result ->> 'claimAcquired' = 'true'
    FROM (
      SELECT pg_temp.prepare_academic_answer(
        '00000000-0000-4000-8000-00000000e2a5'::uuid,
        'auto_unreviewed',
        current_setting('compass.test.c2_academic_auto_run_id')::uuid,
        current_setting('compass.test.c2_academic_auto_run_token_hash'),
        'phase730c2-academic-auto-b', 'summary_candidate',
        current_setting('compass.test.c2_academic_source_summary_id')::uuid,
        true
      ) AS result
    ) AS prepared
  ),
  'automatic Academic preflight uses the grant-free summary run but no provider child yet'
);
SELECT ok(
  (
    SELECT set_config(
      'compass.test.c2_academic_child_b', result ->> 'grant_id', false
    ) IS NOT NULL
      AND set_config(
        'compass.test.c2_academic_provider_digest_b',
        result ->> 'providerIntentDigest', false
      ) IS NOT NULL
      AND result ->> 'accepted' = 'true'
    FROM (
      SELECT pg_temp.issue_academic_child(
        '00000000-0000-4000-8000-00000000e2a6'::uuid,
        repeat('7',64),
        current_setting('compass.test.c2_academic_request_b')::uuid,
        '00000000-0000-4000-8000-00000000e2a5'::uuid,
        current_setting('compass.test.c2_academic_preflight_digest_b'),
        'auto_unreviewed',
        current_setting('compass.test.c2_academic_auto_run_id')::uuid,
        repeat('e',64), repeat('f',64), true
      ) AS result
    ) AS issued
  ),
  'each automatic Academic answer receives its own single-use child'
);
SELECT ok(
  (
    SELECT set_config(
      'compass.test.c2_academic_operation_b', result ->> 'operationId', false
    ) IS NOT NULL
      AND result ->> 'accepted' = 'true'
      AND result ->> 'idempotentReplay' = 'false'
    FROM (
      SELECT pg_temp.start_academic_operation(
        '00000000-0000-4000-8000-00000000e2a7'::uuid,
        current_setting('compass.test.c2_academic_child_b')::uuid,
        repeat('7',64),
        current_setting('compass.test.c2_academic_request_b')::uuid,
        '00000000-0000-4000-8000-00000000e2a5'::uuid,
        current_setting('compass.test.c2_academic_preflight_digest_b'),
        'auto_unreviewed',
        current_setting('compass.test.c2_academic_auto_run_id')::uuid,
        repeat('e',64), repeat('f',64),
        current_setting('compass.test.c2_academic_provider_digest_b'), true
      ) AS result
    ) AS started
  ),
  'automatic Academic start consumes only its per-call child'
);
RESET ROLE;
UPDATE public.ai_usage_ledger
SET provider_dispatched_at = statement_timestamp() - interval '2 minutes',
    provider_request_id = '00000000-0000-4000-8000-00000000e2a7',
    last_heartbeat_at = statement_timestamp() - interval '2 minutes'
WHERE id = current_setting('compass.test.c2_academic_operation_b')::uuid;
INSERT INTO private.admin_google_ai_provider_dispatch_receipts (
  start_request_id, operation_id, provider_family, client_request_id,
  claimed_at, lease_expires_at
) VALUES (
  '00000000-0000-4000-8000-00000000e2a7'::uuid,
  current_setting('compass.test.c2_academic_operation_b')::uuid,
  'openai_responses_v1',
  '00000000-0000-4000-8000-00000000e2a7'::uuid,
  statement_timestamp() - interval '2 minutes',
  statement_timestamp() - interval '30 seconds'
);
SET ROLE service_role;
SELECT is(
  public.reap_stale_google_ai_provider_dispatches_v1(10),
  1,
  'bounded cleanup settles one abandoned automatic Academic dispatch'
);
RESET ROLE;
SELECT ok(
  (
    SELECT usage.status IN ('failed', 'cancelled')
      AND usage.accounting_settled_at IS NOT NULL
      AND usage.settlement_status = 'conservative'
      AND NOT usage.result_accepted
      AND (
        SELECT request.status IN ('failed', 'discarded')
        FROM public.academic_answer_requests AS request
        WHERE request.id =
          current_setting('compass.test.c2_academic_request_b')::uuid
      )
    FROM public.ai_usage_ledger AS usage
    WHERE usage.id = current_setting('compass.test.c2_academic_operation_b')::uuid
  ),
  'stale automatic Academic dispatch is conservatively accounted and releases its request lane'
);

-- Start a manual Academic request under the original Admin app session.
SET ROLE service_role;
WITH prepared AS MATERIALIZED (
  SELECT pg_temp.prepare_academic_answer(
    '00000000-0000-4000-8000-00000000e2c0'::uuid,
    'manual_review',
    null::uuid,
    null::text,
    'phase730c2-academic-session-replacement-c',
    'teacher_selected',
    null::uuid,
    true
  ) AS result
),
issued AS MATERIALIZED (
  SELECT
    prepared.result AS prepared_result,
    pg_temp.issue_academic_child(
      '00000000-0000-4000-8000-00000000e2c1'::uuid,
      repeat('8', 63) || '1',
      (prepared.result ->> 'academicRequestId')::uuid,
      '00000000-0000-4000-8000-00000000e2c0'::uuid,
      prepared.result ->> 'providerContextDigest',
      'manual_review',
      null::uuid,
      repeat('c', 64),
      repeat('d', 64),
      true
    ) AS child_result
  FROM prepared
),
started AS MATERIALIZED (
  SELECT
    issued.prepared_result,
    issued.child_result,
    pg_temp.start_academic_operation(
      '00000000-0000-4000-8000-00000000e2c2'::uuid,
      (issued.child_result ->> 'grant_id')::uuid,
      repeat('8', 63) || '1',
      (issued.prepared_result ->> 'academicRequestId')::uuid,
      '00000000-0000-4000-8000-00000000e2c0'::uuid,
      issued.prepared_result ->> 'providerContextDigest',
      'manual_review',
      null::uuid,
      repeat('c', 64),
      repeat('d', 64),
      issued.child_result ->> 'providerIntentDigest',
      true
    ) AS operation_result
  FROM issued
)
SELECT ok(
  set_config(
    'compass.test.c2_academic_request_c',
    prepared_result ->> 'academicRequestId',
    false
  ) IS NOT NULL
  AND set_config(
    'compass.test.c2_academic_operation_c',
    operation_result ->> 'operationId',
    false
  ) IS NOT NULL
  AND prepared_result ->> 'accepted' = 'true'
  AND child_result ->> 'accepted' = 'true'
  AND operation_result ->> 'accepted' = 'true',
  'Academic cancellation fixture starts under the old Admin app session'
)
FROM started;
RESET ROLE;

-- A new app session for the same principal/membership can still perform the
-- lecture-owner stop control; historical requested_by_actor is evidence only.
INSERT INTO private.admin_step_up_nonces (
  id,
  nonce_hash,
  reserved_admin_session_id,
  environment_id,
  principal_id,
  membership_id,
  supabase_auth_session_id,
  intended_action,
  request_id,
  prechallenge_jwt_hash,
  min_amr_at,
  challenged_totp_factor_id,
  prechallenge_verified_totp_factor_set_hash,
  verified_totp_factor_set_hash,
  factor_set_bootstrap_allowed,
  approved_totp_factor_set_version,
  completion_jwt_hash,
  verified_totp_amr_at,
  issued_at,
  expires_at,
  status,
  consumed_at,
  completed_admin_session_id,
  updated_at
) VALUES (
  '00000000-0000-4000-8000-00000000e2c3'::uuid,
  repeat('8', 64),
  '00000000-0000-4000-8000-00000000e2c4'::uuid,
  '00000000-0000-4000-8000-00000000e201'::uuid,
  '00000000-0000-4000-8000-00000000e205'::uuid,
  '00000000-0000-4000-8000-00000000e206'::uuid,
  '00000000-0000-4000-8000-00000000e203'::uuid,
  'admin_login',
  '00000000-0000-4000-8000-00000000e2c5'::uuid,
  repeat('9', 64),
  statement_timestamp() - interval '1 minute',
  '00000000-0000-4000-8000-00000000e204'::uuid,
  private.current_verified_totp_factor_set_hash_v1(
    '00000000-0000-4000-8000-00000000e202'::uuid
  ),
  private.current_verified_totp_factor_set_hash_v1(
    '00000000-0000-4000-8000-00000000e202'::uuid
  ),
  false,
  1,
  repeat('a', 64),
  statement_timestamp(),
  statement_timestamp() - interval '1 minute',
  statement_timestamp() + interval '4 minutes',
  'pending',
  null,
  null,
  statement_timestamp()
);

INSERT INTO public.admin_sessions (
  id,
  token_hash,
  auth_user_id,
  pin_version_hash,
  authentication_method,
  aal,
  principal_id,
  membership_id,
  environment_id,
  supabase_auth_session_id,
  step_up_verified_at,
  step_up_nonce_id,
  verified_totp_factor_set_hash,
  issued_at,
  last_seen_at,
  idle_expires_at,
  expires_at
) VALUES (
  '00000000-0000-4000-8000-00000000e2c4'::uuid,
  repeat('f', 64),
  '00000000-0000-4000-8000-00000000e202'::uuid,
  null,
  'google_totp',
  2,
  '00000000-0000-4000-8000-00000000e205'::uuid,
  '00000000-0000-4000-8000-00000000e206'::uuid,
  '00000000-0000-4000-8000-00000000e201'::uuid,
  '00000000-0000-4000-8000-00000000e203'::uuid,
  statement_timestamp(),
  '00000000-0000-4000-8000-00000000e2c3'::uuid,
  private.current_verified_totp_factor_set_hash_v1(
    '00000000-0000-4000-8000-00000000e202'::uuid
  ),
  statement_timestamp(),
  statement_timestamp(),
  statement_timestamp() + interval '30 minutes',
  statement_timestamp() + interval '7 hours'
);

UPDATE private.admin_step_up_nonces
SET
  status = 'consumed',
  consumed_at = statement_timestamp(),
  completed_admin_session_id =
    '00000000-0000-4000-8000-00000000e2c4'::uuid,
  updated_at = statement_timestamp()
WHERE id = '00000000-0000-4000-8000-00000000e2c3'::uuid;

SET ROLE service_role;
SELECT ok(
  result ->> 'ok' = 'true'
  AND result ->> 'idempotentReplay' = 'false'
  AND result ->> 'resultStatus' = 'cancel'
  AND result ->> 'resultId' =
    current_setting('compass.test.c2_academic_request_c'),
  'the current lecture owner cancels an Academic request from an old app session'
)
FROM (
  SELECT public.manage_google_admin_academic_results_v1(
    repeat('f', 64),
    '00000000-0000-4000-8000-00000000e202'::uuid,
    '00000000-0000-4000-8000-00000000e203'::uuid,
    'https://accounts.google.com',
    repeat('a', 64),
    1,
    false,
    'cancel',
    '00000000-0000-4000-8000-00000000e2c6'::uuid,
    current_setting('compass.test.c2_provider_lecture_id')::uuid,
    current_setting('compass.test.c2_academic_request_c')::uuid,
    null::uuid,
    null::jsonb,
    null::text
  ) AS result
) AS cancelled;
RESET ROLE;

SELECT ok(
  EXISTS (
    SELECT 1
    FROM public.academic_answer_requests AS request
    JOIN public.ai_usage_ledger AS usage
      ON usage.id = request.operation_id
    JOIN private.admin_google_operation_receipts AS receipt
      ON receipt.request_id =
        '00000000-0000-4000-8000-00000000e2c6'::uuid
    WHERE request.id =
        current_setting('compass.test.c2_academic_request_c')::uuid
      AND request.lecture_session_id =
        current_setting('compass.test.c2_provider_lecture_id')::uuid
      AND request.requested_by_actor =
        'admin-session:00000000-0000-4000-8000-00000000e208'
      AND usage.requested_by_actor =
        'admin-session:00000000-0000-4000-8000-00000000e208'
      AND request.status = 'discarded'
      AND request.error_code = 'cancelled_by_admin_before_dispatch'
      AND usage.status = 'cancelled'
      AND usage.accounting_settled_at IS NOT NULL
      AND usage.provider_dispatched_at IS NULL
      AND receipt.operation_key = 'generate-academic-answer.cancel'
      AND receipt.admin_session_id =
        '00000000-0000-4000-8000-00000000e2c4'::uuid
      AND receipt.principal_id =
        '00000000-0000-4000-8000-00000000e205'::uuid
      AND receipt.membership_id =
        '00000000-0000-4000-8000-00000000e206'::uuid
      AND receipt.result_status = 'cancel'
  ),
  'Academic cancel uses current lecture ownership instead of historical requested_by_actor'
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
        repeat('8',63) || '2', 'https://accounts.google.com', repeat('a',64),
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
        repeat('8',63) || '2',
        current_setting('compass.test.c2_provider_digest_c'),
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

SET ROLE service_role;
SELECT ok(
  (
    SELECT set_config(
      'compass.test.c2_realtime_child', result ->> 'grant_id', false
    ) IS NOT NULL
      AND set_config(
        'compass.test.c2_realtime_digest',
        result ->> 'providerIntentDigest', false
      ) IS NOT NULL
      AND result ->> 'accepted' = 'true'
      AND result ->> 'idempotentReplay' = 'false'
    FROM (
      SELECT public.issue_google_realtime_ai_child_grant_v1(
        repeat('1',64),
        '00000000-0000-4000-8000-00000000e202'::uuid,
        '00000000-0000-4000-8000-00000000e203'::uuid,
        'https://accounts.google.com', repeat('a',64), 1,
        current_setting('compass.test.c2_provider_lecture_id')::uuid,
        'test-model', 'ja', 'minimal', repeat('e',64), repeat('f',64),
        60, 60, 60, repeat('8',63) || '3', 1,
        '00000000-0000-4000-8000-00000000e2b0'::uuid, true
      ) AS result
    ) AS issued
  ),
  'Realtime captions receive one scope-bound child without a provider call'
);
SELECT ok(
  (
    SELECT set_config(
      'compass.test.c2_realtime_operation', result ->> 'operationId', false
    ) IS NOT NULL
      AND result ->> 'accepted' = 'true'
      AND result ->> 'idempotentReplay' = 'false'
      AND (result ->> 'reservedAudioSeconds')::integer = 60
      AND (result ->> 'reservedMicrousd')::bigint = 60
    FROM (
      SELECT public.start_google_admin_realtime_operation_v1(
        repeat('1',64),
        '00000000-0000-4000-8000-00000000e202'::uuid,
        '00000000-0000-4000-8000-00000000e203'::uuid,
        'https://accounts.google.com', repeat('a',64), 1,
        current_setting('compass.test.c2_realtime_child')::uuid,
        repeat('8',63) || '3',
        current_setting('compass.test.c2_provider_lecture_id')::uuid,
        'test-model', 'ja', 'minimal', repeat('e',64), repeat('f',64),
        60, 60, 60,
        '00000000-0000-4000-8000-00000000e2b1'::uuid,
        current_setting('compass.test.c2_realtime_digest'), true
      ) AS result
    ) AS started
  ),
  'Realtime start consumes one child and reserves the bounded caption lane'
);
SELECT ok(
  (
    SELECT result ->> 'operationId' =
        current_setting('compass.test.c2_realtime_operation')
      AND result ->> 'idempotentReplay' = 'true'
    FROM (
      SELECT public.start_google_admin_realtime_operation_v1(
        repeat('1',64),
        '00000000-0000-4000-8000-00000000e202'::uuid,
        '00000000-0000-4000-8000-00000000e203'::uuid,
        'https://accounts.google.com', repeat('a',64), 1,
        current_setting('compass.test.c2_realtime_child')::uuid,
        repeat('8',63) || '3',
        current_setting('compass.test.c2_provider_lecture_id')::uuid,
        'test-model', 'ja', 'minimal', repeat('e',64), repeat('f',64),
        60, 60, 60,
        '00000000-0000-4000-8000-00000000e2b1'::uuid,
        current_setting('compass.test.c2_realtime_digest'), true
      ) AS result
    ) AS replayed
  ),
  'lost Realtime start response converges before provider dispatch'
);
SELECT is(
  public.claim_google_ai_provider_dispatch_v1(
    repeat('1',64),
    '00000000-0000-4000-8000-00000000e202'::uuid,
    '00000000-0000-4000-8000-00000000e203'::uuid,
    'https://accounts.google.com', repeat('a',64), 1,
    '00000000-0000-4000-8000-00000000e2b1'::uuid,
    current_setting('compass.test.c2_realtime_operation')::uuid,
    'openai_realtime_v1',
    '00000000-0000-4000-8000-00000000e2b1'::uuid, true
  ) ->> 'dispatchAllowed',
  'true',
  'Realtime provider dispatch is claimed exactly once after live control recheck'
);
SELECT is(
  public.activate_google_admin_realtime_provider_v1(
    repeat('1',64),
    '00000000-0000-4000-8000-00000000e202'::uuid,
    '00000000-0000-4000-8000-00000000e203'::uuid,
    'https://accounts.google.com', repeat('a',64), 1,
    '00000000-0000-4000-8000-00000000e2b1'::uuid,
    current_setting('compass.test.c2_realtime_operation')::uuid,
    '00000000-0000-4000-8000-00000000e2b1'::uuid,
    'call_phase730c2_realtime', 'request-phase730c2-realtime', true
  ) ->> 'accepted',
  'true',
  'Realtime activation records immutable provider evidence after live authority recheck'
);
SELECT is(
  public.publish_google_admin_caption_window_v1(
    repeat('1',64),
    '00000000-0000-4000-8000-00000000e202'::uuid,
    '00000000-0000-4000-8000-00000000e203'::uuid,
    'https://accounts.google.com', repeat('a',64), 1,
    '00000000-0000-4000-8000-00000000e2b1'::uuid,
    current_setting('compass.test.c2_realtime_operation')::uuid,
    '00000000-0000-4000-8000-00000000e2b2'::uuid,
    current_setting('compass.test.c2_provider_lecture_id')::uuid,
    'Realtime caption fixture', 'ja', 'item-2', 2, true
  ) ->> 'status',
  'published',
  'an activated Google Realtime operation publishes one caption window'
);
SELECT ok(
  (
    SELECT result ->> 'status' = 'ignored'
      AND result #>> '{metadata,reason}' = 'stale_sequence'
      AND result #>> '{metadata,shouldStop}' = 'false'
    FROM (
      SELECT public.publish_google_admin_caption_window_v1(
        repeat('1',64),
        '00000000-0000-4000-8000-00000000e202'::uuid,
        '00000000-0000-4000-8000-00000000e203'::uuid,
        'https://accounts.google.com', repeat('a',64), 1,
        '00000000-0000-4000-8000-00000000e2b1'::uuid,
        current_setting('compass.test.c2_realtime_operation')::uuid,
        '00000000-0000-4000-8000-00000000e2b3'::uuid,
        current_setting('compass.test.c2_provider_lecture_id')::uuid,
        'Delayed caption fixture', 'ja', 'item-1', 1, true
      ) AS result
    ) AS ignored
  ),
  'stale caption delivery is ignored without stopping the live session'
);
SELECT ok(
  (
    SELECT result ->> 'status' = 'ignored'
      AND result #>> '{metadata,reason}' = 'sequence_conflict'
      AND result #>> '{metadata,shouldStop}' = 'false'
    FROM (
      SELECT public.publish_google_admin_caption_window_v1(
        repeat('1',64),
        '00000000-0000-4000-8000-00000000e202'::uuid,
        '00000000-0000-4000-8000-00000000e203'::uuid,
        'https://accounts.google.com', repeat('a',64), 1,
        '00000000-0000-4000-8000-00000000e2b1'::uuid,
        current_setting('compass.test.c2_realtime_operation')::uuid,
        '00000000-0000-4000-8000-00000000e2b4'::uuid,
        current_setting('compass.test.c2_provider_lecture_id')::uuid,
        'Conflicting caption fixture', 'ja', 'item-2-conflict', 2, true
      ) AS result
    ) AS ignored
  ),
  'same-sequence caption conflict is nonterminal and never replaces public text'
);
SELECT ok(
  (
    SELECT result ->> 'status' = 'continue'
      AND result #>> '{metadata,should_stop}' = 'false'
    FROM (
      SELECT public.manage_google_admin_ai_control_v1(
        repeat('1',64),
        '00000000-0000-4000-8000-00000000e202'::uuid,
        '00000000-0000-4000-8000-00000000e203'::uuid,
        'https://accounts.google.com', repeat('a',64), 1,
        'heartbeat',
        current_setting('compass.test.c2_provider_lecture_id')::uuid,
        '00000000-0000-4000-8000-00000000e2b5'::uuid,
        current_setting('compass.test.c2_realtime_operation')::uuid,
        null::jsonb, null::text, null::text, true
      ) AS result
    ) AS continued
  ),
  'an activated Realtime operation continues without another MFA prompt'
);
SELECT ok(
  (
    SELECT result ->> 'status' = 'disabled'
      AND result #>> '{metadata,changed}' = 'true'
    FROM (
      SELECT public.manage_google_admin_ai_control_v1(
        repeat('1',64),
        '00000000-0000-4000-8000-00000000e202'::uuid,
        '00000000-0000-4000-8000-00000000e203'::uuid,
        'https://accounts.google.com', repeat('a',64), 1,
        'disableFeatures',
        current_setting('compass.test.c2_provider_lecture_id')::uuid,
        '00000000-0000-4000-8000-00000000e2b6'::uuid,
        null::uuid,
        jsonb_build_object('captions_enabled', false),
        null::text, null::text, true
      ) AS result
    ) AS disabled
  ),
  'disabling captions atomically settles the active operation before hangup'
);
RESET ROLE;
SELECT ok(
  (
    SELECT usage.status = 'cancelled'
      AND usage.accounting_settled_at IS NOT NULL
      AND provider_call.status = 'stop_requested'
      AND creation.outcome = 'activated'
    FROM public.ai_usage_ledger AS usage
    JOIN public.ai_realtime_provider_calls AS provider_call
      ON provider_call.operation_id = usage.id
    JOIN private.admin_google_realtime_provider_creation_receipts AS creation
      ON creation.operation_id = usage.id
    WHERE usage.id =
      current_setting('compass.test.c2_realtime_operation')::uuid
  )
  AND NOT EXISTS (
    SELECT 1
    FROM public.lecture_public_captions AS caption
    WHERE caption.lecture_session_id =
      current_setting('compass.test.c2_provider_lecture_id')::uuid
  )
  AND (
    SELECT control.active_operation_count = 1
      AND control.status = 'running'
      AND NOT control.captions_enabled
      AND control.stop_requested_at IS NULL
    FROM public.lecture_ai_control AS control
    WHERE control.lecture_session_id =
      current_setting('compass.test.c2_provider_lecture_id')::uuid
  ),
  'terminal Realtime control settles accounting, clears public captions and preserves other AI work'
);

SET ROLE service_role;
SELECT ok(
  (
    SELECT set_config(
      'compass.test.c2_realtime_unclaimed_child',
      result ->> 'grant_id', false
    ) IS NOT NULL
      AND set_config(
        'compass.test.c2_realtime_unclaimed_digest',
        result ->> 'providerIntentDigest', false
      ) IS NOT NULL
      AND result ->> 'accepted' = 'true'
    FROM (
      SELECT public.issue_google_realtime_ai_child_grant_v1(
        repeat('1',64),
        '00000000-0000-4000-8000-00000000e202'::uuid,
        '00000000-0000-4000-8000-00000000e203'::uuid,
        'https://accounts.google.com', repeat('a',64), 1,
        current_setting('compass.test.c2_provider_lecture_id')::uuid,
        'test-model', 'ja', 'minimal', repeat('e',64), repeat('f',64),
        60, 60, 60, repeat('8',63) || '4', 1,
        '00000000-0000-4000-8000-00000000e2b7'::uuid, true
      ) AS result
    ) AS issued
  ),
  'a second Realtime child can prepare an immediate-stop recovery fixture'
);
SELECT ok(
  (
    SELECT set_config(
      'compass.test.c2_realtime_unclaimed_operation',
      result ->> 'operationId', false
    ) IS NOT NULL
      AND result ->> 'accepted' = 'true'
    FROM (
      SELECT public.start_google_admin_realtime_operation_v1(
        repeat('1',64),
        '00000000-0000-4000-8000-00000000e202'::uuid,
        '00000000-0000-4000-8000-00000000e203'::uuid,
        'https://accounts.google.com', repeat('a',64), 1,
        current_setting('compass.test.c2_realtime_unclaimed_child')::uuid,
        repeat('8',63) || '4',
        current_setting('compass.test.c2_provider_lecture_id')::uuid,
        'test-model', 'ja', 'minimal', repeat('e',64), repeat('f',64),
        60, 60, 60,
        '00000000-0000-4000-8000-00000000e2b8'::uuid,
        current_setting('compass.test.c2_realtime_unclaimed_digest'), true
      ) AS result
    ) AS started
  ),
  'an unclaimed Realtime start remains locally reversible before provider dispatch'
);
SELECT is(
  public.manage_google_admin_ai_control_v1(
    repeat('1',64),
    '00000000-0000-4000-8000-00000000e202'::uuid,
    '00000000-0000-4000-8000-00000000e203'::uuid,
    'https://accounts.google.com', repeat('a',64), 1,
    'disableFeatures',
    current_setting('compass.test.c2_provider_lecture_id')::uuid,
    '00000000-0000-4000-8000-00000000e2b9'::uuid,
    null::uuid,
    jsonb_build_object('captions_enabled', false),
    null::text, null::text, true
  ) ->> 'status',
  'disabled',
  'an immediate caption disable succeeds before a provider claim exists'
);
RESET ROLE;
SELECT ok(
  (
    SELECT usage.status = 'cancelled'
      AND usage.accounting_settled_at IS NOT NULL
      AND usage.settlement_status = 'released'
      AND usage.actual_microusd = 0
      AND usage.actual_audio_seconds = 0
      AND provider_call.status = 'creation_failed'
    FROM public.ai_usage_ledger AS usage
    JOIN public.ai_realtime_provider_calls AS provider_call
      ON provider_call.operation_id = usage.id
    WHERE usage.id =
      current_setting('compass.test.c2_realtime_unclaimed_operation')::uuid
  )
  AND NOT EXISTS (
    SELECT 1
    FROM private.admin_google_ai_provider_dispatch_receipts AS receipt
    WHERE receipt.operation_id =
      current_setting('compass.test.c2_realtime_unclaimed_operation')::uuid
  )
  AND NOT EXISTS (
    SELECT 1
    FROM private.admin_google_realtime_provider_creation_receipts AS receipt
    WHERE receipt.operation_id =
      current_setting('compass.test.c2_realtime_unclaimed_operation')::uuid
  ),
  'pre-dispatch disable releases the full reservation without fabricated provider evidence'
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
