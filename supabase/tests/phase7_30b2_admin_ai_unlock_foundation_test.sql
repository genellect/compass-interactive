BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path = public, extensions;
SELECT no_plan();

SELECT has_table('private', 'admin_ai_unlock_runtime_gate', 'B2 runtime gate exists');
SELECT has_table('private', 'admin_ai_policies', 'Admin AI policies exist');
SELECT has_table('private', 'admin_ai_unlock_factors', 'personal AI factors exist');
SELECT has_table('private', 'admin_ai_unlock_rate_limits', 'atomic unlock limits exist');
SELECT has_table('private', 'admin_ai_unlock_attempt_receipts', 'idempotent attempt receipts exist');
SELECT has_table('private', 'admin_ai_pin_discovery_receipts', 'version-bound PIN discovery receipts exist');
SELECT has_table('private', 'admin_ai_browser_enrollment_nonces', 'browser enrollment nonces exist');
SELECT has_table('private', 'admin_ai_browser_credentials', 'remembered-browser credentials exist');
SELECT has_table('private', 'admin_ai_browser_assertion_challenges', 'browser assertion challenges exist');

SELECT ok(
  (
    SELECT count(*) = 9 AND bool_and(class.relrowsecurity)
    FROM pg_class AS class
    JOIN pg_namespace AS namespace ON namespace.oid = class.relnamespace
    WHERE namespace.nspname = 'private'
      AND class.relname IN (
        'admin_ai_unlock_runtime_gate',
        'admin_ai_policies',
        'admin_ai_unlock_factors',
        'admin_ai_unlock_rate_limits',
        'admin_ai_unlock_attempt_receipts',
        'admin_ai_pin_discovery_receipts',
        'admin_ai_browser_enrollment_nonces',
        'admin_ai_browser_credentials',
        'admin_ai_browser_assertion_challenges'
      )
  ),
  'every B2 private table has defense-in-depth RLS'
);

SELECT ok(
  NOT has_table_privilege('anon', 'private.admin_ai_policies', 'SELECT')
  AND NOT has_table_privilege('authenticated', 'private.admin_ai_unlock_factors', 'SELECT')
  AND NOT has_table_privilege('service_role', 'private.admin_ai_unlock_rate_limits', 'UPDATE')
  AND NOT has_table_privilege('service_role', 'private.admin_ai_browser_credentials', 'INSERT')
  AND NOT has_table_privilege('service_role', 'private.admin_ai_unlock_attempt_receipts', 'DELETE')
  AND NOT has_table_privilege('service_role', 'private.admin_ai_pin_discovery_receipts', 'SELECT')
  AND NOT has_table_privilege('service_role', 'private.admin_environment_memberships', 'DELETE'),
  'browser roles and service role have no direct B2 table mutation path'
);

SELECT ok(
  (
    SELECT ai_unlock_enabled IS FALSE
      AND remembered_browser_enabled IS FALSE
    FROM private.admin_ai_unlock_runtime_gate
    WHERE singleton
  ),
  'AI unlock and remembered-browser issuance both default OFF'
);

SELECT ok(
  NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'private'
      AND table_name IN (
        'admin_ai_unlock_factors',
        'admin_ai_unlock_rate_limits',
        'admin_ai_unlock_attempt_receipts',
        'admin_ai_pin_discovery_receipts',
        'admin_ai_browser_enrollment_nonces',
        'admin_ai_browser_credentials',
        'admin_ai_browser_assertion_challenges'
      )
      AND column_name IN (
        'pin',
        'pin_hmac',
        'peppered_pin_hmac',
        'raw_pin',
        'private_key',
        'private_key_jwk'
      )
  ),
  'no low-entropy input, intermediate HMAC or browser private key is persisted'
);

SELECT has_column(
  'private',
  'admin_ai_unlock_factors',
  'pin_verifier',
  'factor stores only a slow verifier'
);
SELECT has_column(
  'private',
  'admin_ai_unlock_factors',
  'pin_pepper_version',
  'factor records the Edge pepper version'
);

SELECT ok(
  (
    SELECT count(*) = 2 AND bool_and(column_value.is_nullable = 'NO')
    FROM information_schema.columns AS column_value
    WHERE column_value.table_schema = 'private'
      AND column_value.table_name = 'admin_ai_unlock_attempt_receipts'
      AND column_value.column_name IN (
        'input_pin_pepper_version',
        'input_pin_proof_digest'
      )
  ),
  'every attempt receipt binds non-null input pepper and proof independently of factor provenance'
);

SELECT ok(
  NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'private'
      AND table_name = 'admin_ai_unlock_rate_limits'
      AND column_name IN (
        'admin_session_id',
        'browser_credential_id',
        'factor_id',
        'factor_version'
      )
  ),
  'rate-limit identity is independent of factor version, session and browser'
);

SELECT ok(
  to_regclass('private.admin_ai_unlock_factors_one_active_membership_idx') IS NOT NULL
  AND to_regclass('private.admin_ai_unlock_rate_limits_locked_idx') IS NOT NULL
  AND to_regclass('private.admin_ai_browser_enrollment_pending_session_idx') IS NOT NULL
  AND to_regclass('private.admin_ai_browser_assertion_pending_binding_idx') IS NOT NULL
  AND to_regclass('private.admin_ai_unlock_attempt_receipts_retention_idx') IS NOT NULL
  AND to_regclass('private.admin_ai_pin_discovery_retention_idx') IS NOT NULL
  AND to_regclass('private.admin_ai_browser_credentials_expiry_idx') IS NOT NULL
  AND to_regclass('private.admin_ai_browser_assertion_retention_idx') IS NOT NULL,
  'factor, lockout, idempotency, enrollment, credential and assertion lookups are indexed'
);

SELECT ok(
  NOT EXISTS (
    SELECT 1
    FROM pg_constraint AS foreign_key
    WHERE foreign_key.contype = 'f'
      AND foreign_key.conrelid IN (
        'private.admin_ai_policies'::regclass,
        'private.admin_ai_unlock_factors'::regclass,
        'private.admin_ai_unlock_rate_limits'::regclass,
        'private.admin_ai_unlock_attempt_receipts'::regclass,
        'private.admin_ai_pin_discovery_receipts'::regclass,
        'private.admin_ai_browser_enrollment_nonces'::regclass,
        'private.admin_ai_browser_credentials'::regclass,
        'private.admin_ai_browser_assertion_challenges'::regclass,
        'public.lecture_ai_master_authorizations'::regclass
      )
      AND NOT EXISTS (
        SELECT 1
        FROM pg_index AS idx
        WHERE idx.indrelid = foreign_key.conrelid
          AND idx.indisvalid
          AND idx.indisready
          AND split_part(idx.indkey::text, ' ', 1)::smallint = foreign_key.conkey[1]
      )
  ),
  'every B2 foreign key has a valid leading lookup index for RESTRICT and security drains'
);

SELECT is(
  (
    SELECT count(*)::integer
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'lecture_ai_master_authorizations'
      AND column_name IN (
        'principal_id',
        'membership_id',
        'issuing_admin_session_id',
        'ai_policy_id',
        'ai_policy_version',
        'unlock_method',
        'unlock_factor_id',
        'unlock_factor_version',
        'browser_credential_id',
        'unlock_verified_at',
        'step_up_verified_at'
      )
  ),
  11,
  'lecture master records complete nullable B2 provenance'
);

SELECT ok(
  (
    SELECT provenance_constraint.convalidated
    FROM pg_constraint AS provenance_constraint
    WHERE provenance_constraint.conrelid = 'public.lecture_ai_master_authorizations'::regclass
      AND provenance_constraint.conname = 'lecture_ai_master_authorizations_unlock_provenance_check'
  ),
  'master provenance is protected by a validated all-or-none constraint'
);

SELECT ok(
  to_regclass('public.lecture_ai_master_authorizations_membership_active_idx') IS NOT NULL
  AND to_regclass('public.lecture_ai_master_authorizations_policy_idx') IS NOT NULL
  AND to_regclass('public.lecture_ai_master_authorizations_unlock_factor_idx') IS NOT NULL
  AND to_regclass('public.lecture_ai_master_authorizations_browser_credential_idx') IS NOT NULL,
  'master revocation and provenance lookups are indexed'
);

SELECT is(
  (
    SELECT count(*)::integer
    FROM pg_proc AS procedure
    JOIN pg_namespace AS namespace ON namespace.oid = procedure.pronamespace
    WHERE namespace.nspname = 'public'
      AND procedure.proname IN (
        'get_admin_ai_unlock_runtime_gate_v1',
        'set_admin_ai_policy_v1',
        'enroll_admin_ai_pin_v1',
        'get_admin_ai_pin_factor_metadata_v1',
        'verify_admin_ai_pin_v1',
        'begin_admin_ai_browser_enrollment_v1',
        'complete_admin_ai_browser_enrollment_v1',
        'begin_admin_ai_browser_assertion_v1',
        'complete_admin_ai_browser_assertion_v1',
        'revoke_admin_ai_browser_credential_v1',
        'cleanup_admin_ai_ephemera_v1'
      )
  ),
  11,
  'all eleven B2 service wrappers exist exactly once'
);

SELECT ok(
  NOT EXISTS (
    SELECT 1
    FROM pg_proc AS procedure
    JOIN pg_namespace AS namespace ON namespace.oid = procedure.pronamespace
    WHERE namespace.nspname = 'public'
      AND procedure.proname IN (
        'get_admin_ai_unlock_runtime_gate_v1',
        'set_admin_ai_policy_v1',
        'enroll_admin_ai_pin_v1',
        'get_admin_ai_pin_factor_metadata_v1',
        'verify_admin_ai_pin_v1',
        'begin_admin_ai_browser_enrollment_v1',
        'complete_admin_ai_browser_enrollment_v1',
        'begin_admin_ai_browser_assertion_v1',
        'complete_admin_ai_browser_assertion_v1',
        'revoke_admin_ai_browser_credential_v1',
        'cleanup_admin_ai_ephemera_v1'
      )
      AND (
        procedure.prosecdef
        OR has_function_privilege('anon', procedure.oid, 'EXECUTE')
        OR has_function_privilege('authenticated', procedure.oid, 'EXECUTE')
        OR NOT has_function_privilege('service_role', procedure.oid, 'EXECUTE')
      )
  ),
  'public B2 wrappers are invoker-only and service-role-only'
);

SELECT ok(
  NOT has_function_privilege(
    'service_role',
    'private.consume_admin_ai_pin_attempt_v1(text,uuid,uuid,integer,text,text,text,uuid)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'service_role',
    'private.require_admin_ai_context_v1(text,uuid,uuid,timestamptz,boolean,boolean)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'service_role',
    'private.drain_admin_ai_factor_authority_v1(uuid,uuid,text,timestamptz)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'service_role',
    'private.serialize_admin_ai_request_v1(uuid)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'service_role',
    'private.serialize_admin_ai_scope_v1(text,uuid)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'service_role',
    'private.try_serialize_admin_ai_scope_v1(text,uuid)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'service_role',
    'private.try_acquire_admin_ai_bcrypt_lease_v1(uuid,text)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'service_role',
    'private.enforce_admin_membership_owner_v1()',
    'EXECUTE'
  ),
  'atomic subroutines are reachable only through bounded outer helpers'
);

SELECT ok(
  EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgrelid = 'private.admin_ai_unlock_attempt_receipts'::regclass
      AND tgname = 'admin_ai_unlock_attempt_receipts_immutable'
      AND NOT tgisinternal
      AND (tgtype & 16) = 16
      AND (tgtype & 8) = 0
  ),
  'attempt receipts reject updates while controlled retention may delete them'
);

SELECT ok(
  EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgrelid = 'private.admin_audit_events'::regclass
      AND tgname = 'admin_audit_events_append_only'
      AND NOT tgisinternal
      AND (tgtype & 16) = 16
      AND (tgtype & 8) = 8
  ),
  'canonical Admin audit remains append-only for both updates and deletes'
);

SELECT ok(
  pg_get_functiondef(
    'private.verify_and_touch_google_admin_session_v1(text,uuid,uuid)'::regprocedure
  ) LIKE '%from auth.sessions%'
  AND pg_get_functiondef(
    'private.require_admin_ai_context_v1(text,uuid,uuid,timestamptz,boolean,boolean)'::regprocedure
  ) LIKE '%from auth.sessions%',
  'B1 session touch and every B2 context verify backing auth.sessions existence'
);

WITH definitions AS (
  SELECT
    pg_get_functiondef(
      'private.require_admin_ai_context_v1(text,uuid,uuid,timestamptz,boolean,boolean)'::regprocedure
    ) AS b2_context,
    pg_get_functiondef(
      'private.verify_and_touch_google_admin_session_v1(text,uuid,uuid)'::regprocedure
    ) AS b1_touch,
    pg_get_functiondef(
      'private.enforce_admin_principal_identity_v1()'::regprocedure
    ) AS principal_guard,
    pg_get_functiondef(
      'private.enforce_admin_membership_owner_v1()'::regprocedure
    ) AS membership_guard
)
SELECT ok(
  position('from private.admin_principals as principal' IN b2_context)
    < position('from private.admin_environment_memberships as membership' IN b2_context)
  AND position('from private.admin_environment_memberships as membership' IN b2_context)
    < position('where session.id = session_snapshot.id' IN b2_context)
  AND position('where session.id = session_snapshot.id' IN b2_context)
    < position('from private.admin_environments as environment' IN b2_context)
  AND position('from private.admin_principals as principal' IN b1_touch)
    < position('from private.admin_environment_memberships as membership' IN b1_touch)
  AND position('from private.admin_environment_memberships as membership' IN b1_touch)
    < position('where session.id = session_snapshot.id' IN b1_touch)
  AND position('where session.id = session_snapshot.id' IN b1_touch)
    < position('from private.admin_environments as environment' IN b1_touch)
  AND b2_context LIKE '%for key share%'
  AND b1_touch LIKE '%for key share%'
  AND b2_context NOT LIKE '%from private.admin_environments as environment%for key share%'
  AND b1_touch NOT LIKE '%from private.admin_environments as environment%for key share%'
  AND principal_guard LIKE '%for update of environment%'
  AND membership_guard LIKE '%from private.admin_environments as environment%for update%',
  'B1/B2 readers lock principal-membership-session and revalidate environment without inverting owner DELETE'
)
FROM definitions;

SELECT ok(
  pg_get_functiondef(
    'private.enforce_google_admin_session_absolute_idle_v1()'::regprocedure
  ) LIKE '%auth_session.created_at%interval ''8 hours''%'
  AND pg_get_functiondef(
    'private.enforce_google_admin_session_absolute_idle_v1()'::regprocedure
  ) LIKE '%if not found then%P7323%'
  AND pg_get_functiondef(
    'private.enforce_google_admin_session_absolute_idle_v1()'::regprocedure
  ) LIKE '%new.idle_expires_at := new.expires_at%'
  AND pg_get_functiondef(
    'private.verify_and_touch_google_admin_session_v1(text,uuid,uuid)'::regprocedure
  ) LIKE '%idle_expires_at = expires_at%'
  AND pg_get_functiondef(
    'private.verify_and_touch_google_admin_session_v1(text,uuid,uuid)'::regprocedure
  ) NOT LIKE '%interval ''30 minutes''%',
  'Google/TOTP app sessions inherit the backing Auth-session eight-hour cap without an idle TOTP timer'
);

SELECT ok(
  pg_get_function_arguments(
    'private.verify_admin_ai_pin_v1(text,uuid,uuid,integer,text,text,text,uuid)'::regprocedure
  ) NOT LIKE '%target_min_step_up_verified_at%'
  AND pg_get_functiondef(
    'private.consume_admin_ai_pin_attempt_v1(text,uuid,uuid,integer,text,text,text,uuid)'::regprocedure
  ) LIKE '%target_supabase_auth_session_id,%null,%true,%false%'
  AND pg_get_function_arguments(
    'private.enroll_admin_ai_pin_v1(text,uuid,uuid,text,integer,uuid)'::regprocedure
  ) NOT LIKE '%target_min_step_up_verified_at%'
  AND pg_get_function_arguments(
    'private.begin_admin_ai_browser_enrollment_v1(text,uuid,uuid,text,uuid,text,text,text,timestamptz,uuid)'::regprocedure
  ) NOT LIKE '%target_min_step_up_verified_at%'
  AND pg_get_function_arguments(
    'private.set_admin_ai_policy_v1(text,uuid,uuid,uuid,text[],text[],integer,integer,bigint,bigint,bigint,bigint,bigint,bigint,integer,integer,integer,timestamptz,timestamptz,uuid)'::regprocedure
  ) NOT LIKE '%target_min_step_up_verified_at%'
  AND pg_get_functiondef(
    'private.set_admin_ai_policy_v1(text,uuid,uuid,uuid,text[],text[],integer,integer,bigint,bigint,bigint,bigint,bigint,bigint,integer,integer,integer,timestamptz,timestamptz,uuid)'::regprocedure
  ) LIKE '%effective_now - interval ''5 minutes''%'
  AND pg_get_functiondef(
    'private.enroll_admin_ai_pin_v1(text,uuid,uuid,text,integer,uuid)'::regprocedure
  ) LIKE '%effective_now - interval ''5 minutes''%',
  'normal lecture AI uses valid AAL2 while rare policy and PIN-factor mutations enforce a DB-authoritative five-minute step-up'
);

SELECT ok(
  pg_get_functiondef(
    'private.consume_admin_ai_pin_attempt_v1(text,uuid,uuid,integer,text,text,text,uuid)'::regprocedure
  ) LIKE '%receipt_row.occurred_at <= effective_now - interval ''5 minutes''%'
  AND pg_get_functiondef(
    'private.consume_admin_ai_pin_attempt_v1(text,uuid,uuid,integer,text,text,text,uuid)'::regprocedure
  ) LIKE '%factor.id = receipt_row.factor_id%factor.factor_version = receipt_row.factor_version%'
  AND pg_get_functiondef(
    'private.consume_admin_ai_pin_attempt_v1(text,uuid,uuid,integer,text,text,text,uuid)'::regprocedure
  ) LIKE '%factor.environment_id = receipt_row.environment_id%factor.principal_id = receipt_row.principal_id%factor.membership_id = receipt_row.membership_id%'
  AND pg_get_functiondef(
    'private.consume_admin_ai_pin_attempt_v1(text,uuid,uuid,integer,text,text,text,uuid)'::regprocedure
  ) LIKE '%factor.status = ''active''%',
  'successful PIN idempotency replay is short-lived and bound to the exact still-active factor authority'
);

SELECT ok(
  pg_get_functiondef(
    'private.consume_admin_ai_pin_attempt_v1(text,uuid,uuid,integer,text,text,text,uuid)'::regprocedure
  ) LIKE '%when ''membership'' then 5%'
  AND pg_get_functiondef(
    'private.consume_admin_ai_pin_attempt_v1(text,uuid,uuid,integer,text,text,text,uuid)'::regprocedure
  ) LIKE '%when ''network'' then 30%'
  AND pg_get_functiondef(
    'private.consume_admin_ai_pin_attempt_v1(text,uuid,uuid,integer,text,text,text,uuid)'::regprocedure
  ) LIKE '%else 300%'
  AND pg_get_functiondef(
    'private.consume_admin_ai_pin_attempt_v1(text,uuid,uuid,integer,text,text,text,uuid)'::regprocedure
  ) LIKE '%interval ''60 seconds''%',
  'approved membership, network and environment abuse limits are server-atomic'
);

SELECT ok(
  pg_get_functiondef(
    'private.drain_admin_ai_factor_authority_v1(uuid,uuid,text,timestamptz)'::regprocedure
  ) LIKE '%perform 1%from public.lecture_sessions as lecture%for update;%select master.*%from public.lecture_ai_master_authorizations as master%for update;%',
  'factor rotation drain locks each lecture before its active master authority'
);

SELECT ok(
  pg_get_functiondef(
    'private.begin_admin_ai_browser_assertion_v1(text,uuid,uuid,text,text,text,uuid,text,uuid,bigint,timestamptz,uuid)'::regprocedure
  ) LIKE '%credential.source_factor_id = challenge_row.factor_id%credential.source_factor_version = challenge_row.factor_version%'
  AND
  pg_get_functiondef(
    'private.complete_admin_ai_browser_assertion_v1(text,uuid,uuid,text,text,text,text,boolean,uuid)'::regprocedure
  ) LIKE '%challenge_row.admin_session_id = (context_value ->> ''admin_session_id'')::uuid%'
  AND pg_get_functiondef(
    'private.complete_admin_ai_browser_assertion_v1(text,uuid,uuid,text,text,text,text,boolean,uuid)'::regprocedure
  ) LIKE '%challenge_row.environment_id = (context_value ->> ''environment_id'')::uuid%'
  AND pg_get_functiondef(
    'private.complete_admin_ai_browser_assertion_v1(text,uuid,uuid,text,text,text,text,boolean,uuid)'::regprocedure
  ) LIKE '%challenge_row.principal_id = (context_value ->> ''principal_id'')::uuid%'
  AND pg_get_functiondef(
    'private.complete_admin_ai_browser_assertion_v1(text,uuid,uuid,text,text,text,text,boolean,uuid)'::regprocedure
  ) LIKE '%challenge_row.membership_id = (context_value ->> ''membership_id'')::uuid%'
  AND pg_get_functiondef(
    'private.complete_admin_ai_browser_assertion_v1(text,uuid,uuid,text,text,text,text,boolean,uuid)'::regprocedure
  ) LIKE '%challenge_row.expires_at > effective_now%'
  AND pg_get_functiondef(
    'private.complete_admin_ai_browser_assertion_v1(text,uuid,uuid,text,text,text,text,boolean,uuid)'::regprocedure
  ) LIKE '%credential.source_factor_id = challenge_row.factor_id%credential.source_factor_version = challenge_row.factor_version%'
  AND pg_get_functiondef(
    'private.complete_admin_ai_browser_assertion_v1(text,uuid,uuid,text,text,text,text,boolean,uuid)'::regprocedure
  ) LIKE '%factor.status = ''active''%'
  AND pg_get_functiondef(
    'private.complete_admin_ai_browser_assertion_v1(text,uuid,uuid,text,text,text,text,boolean,uuid)'::regprocedure
  ) LIKE '%policy.status = ''active''%'
  AND pg_get_functiondef(
    'private.complete_admin_ai_browser_assertion_v1(text,uuid,uuid,text,text,text,text,boolean,uuid)'::regprocedure
  ) LIKE '%lecture.status = ''open''%',
  'remembered-browser begin/completion replay require the exact live session, credential, factor, policy and lecture binding'
);

SELECT ok(
  pg_get_functiondef(
    'private.complete_admin_ai_browser_enrollment_v1(text,uuid,uuid,text,integer,text,text,jsonb,uuid)'::regprocedure
  ) LIKE '%nonce_row.status = ''consumed''%nonce_row.expires_at <= effective_now%'
  AND pg_get_functiondef(
    'private.complete_admin_ai_browser_enrollment_v1(text,uuid,uuid,text,integer,text,text,jsonb,uuid)'::regprocedure
  ) LIKE '%credential.source_factor_id = nonce_row.factor_id%credential.source_factor_version = nonce_row.factor_version%'
  AND pg_get_functiondef(
    'private.complete_admin_ai_browser_enrollment_v1(text,uuid,uuid,text,integer,text,text,jsonb,uuid)'::regprocedure
  ) LIKE '%credential.public_key_jwk = target_public_key_jwk%credential.public_key_fingerprint = computed_fingerprint%'
  AND pg_get_functiondef(
    'private.complete_admin_ai_browser_enrollment_v1(text,uuid,uuid,text,integer,text,text,jsonb,uuid)'::regprocedure
  ) LIKE '%credential.status = ''active''%factor.status = ''active''%',
  'remembered-browser enrollment replay is short-lived and cannot resurrect a credential drained by PIN rotation'
);

SELECT ok(
  (
    WITH verifier AS (
      SELECT extensions.crypt(
        repeat('a', 64),
        extensions.gen_salt('bf', 12)
      ) AS value
    )
    SELECT value ~ '^\$2[aby]\$12\$[./A-Za-z0-9]{53}$'
      AND extensions.crypt(repeat('a', 64), value) = value
      AND extensions.crypt(repeat('b', 64), value) <> value
    FROM verifier
  ),
  'bcrypt cost 12 verifies only the Edge-peppered 64-character digest'
);

SELECT isnt(
  extensions.crypt(repeat('a', 64), extensions.gen_salt('bf', 12)),
  extensions.crypt(repeat('a', 64), extensions.gen_salt('bf', 12)),
  'factor verifiers use independent bcrypt salts'
);

INSERT INTO private.admin_environments (
  id,
  environment_kind,
  canonical_admin_origin,
  supabase_issuer,
  current_deployment
) VALUES (
  '00000000-0000-4000-8000-000000007320'::uuid,
  'local',
  'http://127.0.0.1:5173',
  'http://127.0.0.1:54321/auth/v1',
  false
);

INSERT INTO private.admin_principals (
  id,
  auth_user_id,
  google_issuer,
  provider_subject_hmac,
  subject_pepper_version,
  normalized_email,
  email_verified_at
) VALUES (
  '00000000-0000-4000-8000-000000007321'::uuid,
  '00000000-0000-4000-8000-000000007322'::uuid,
  'https://accounts.google.com',
  repeat('a', 64),
  1,
  'b2@example.test',
  statement_timestamp()
);

INSERT INTO private.admin_environment_memberships (
  id,
  environment_id,
  principal_id,
  role,
  status,
  can_use_ai,
  activated_at
) VALUES (
  '00000000-0000-4000-8000-000000007323'::uuid,
  '00000000-0000-4000-8000-000000007320'::uuid,
  '00000000-0000-4000-8000-000000007321'::uuid,
  'instructor',
  'active',
  true,
  statement_timestamp()
);

INSERT INTO private.admin_ai_unlock_rate_limits (
  environment_id,
  bucket_kind,
  bucket_key,
  membership_id,
  network_hmac,
  window_started_at
) VALUES
  (
    '00000000-0000-4000-8000-000000007320'::uuid,
    'environment',
    'environment',
    null,
    null,
    statement_timestamp()
  ),
  (
    '00000000-0000-4000-8000-000000007320'::uuid,
    'membership',
    '00000000-0000-4000-8000-000000007323',
    '00000000-0000-4000-8000-000000007323'::uuid,
    null,
    statement_timestamp()
  ),
  (
    '00000000-0000-4000-8000-000000007320'::uuid,
    'network',
    repeat('b', 64),
    null,
    repeat('b', 64),
    statement_timestamp()
  );

SELECT is(
  (
    SELECT count(*)::integer
    FROM private.admin_ai_unlock_rate_limits
    WHERE environment_id = '00000000-0000-4000-8000-000000007320'::uuid
  ),
  3,
  'one environment has exactly one independent bucket at each abuse boundary'
);

INSERT INTO public.admin_sessions (
  id,
  token_hash,
  auth_user_id,
  pin_version_hash,
  authentication_method,
  aal,
  issued_at,
  last_seen_at,
  idle_expires_at,
  expires_at
) VALUES (
  '00000000-0000-4000-8000-000000007324'::uuid,
  repeat('c', 64),
  '00000000-0000-4000-8000-000000007322'::uuid,
  repeat('d', 64),
  'legacy_pin',
  1,
  statement_timestamp(),
  statement_timestamp(),
  statement_timestamp() + interval '30 minutes',
  statement_timestamp() + interval '8 hours'
);

INSERT INTO private.admin_ai_unlock_factors (
  id,
  environment_id,
  principal_id,
  membership_id,
  pin_verifier,
  pin_pepper_version,
  factor_version,
  enrolled_by_admin_session_id,
  enrolled_step_up_verified_at,
  enrollment_request_id
) VALUES (
  '00000000-0000-4000-8000-000000007325'::uuid,
  '00000000-0000-4000-8000-000000007320'::uuid,
  '00000000-0000-4000-8000-000000007321'::uuid,
  '00000000-0000-4000-8000-000000007323'::uuid,
  extensions.crypt(repeat('e', 64), extensions.gen_salt('bf', 12)),
  1,
  1,
  '00000000-0000-4000-8000-000000007324'::uuid,
  statement_timestamp(),
  '00000000-0000-4000-8000-000000007326'::uuid
);

INSERT INTO private.admin_ai_policies (
  id,
  environment_id,
  membership_id,
  allowed_actions,
  allowed_models,
  max_calls_per_lecture,
  max_calls_per_day,
  max_input_tokens_per_lecture,
  max_input_tokens_per_day,
  max_output_tokens_per_lecture,
  max_output_tokens_per_day,
  max_cost_microusd_per_lecture,
  max_cost_microusd_per_day,
  max_realtime_minutes_per_lecture,
  max_realtime_minutes_per_day,
  max_concurrency,
  valid_from,
  valid_until,
  version,
  created_by_membership_id,
  created_by_admin_session_id,
  request_id
) VALUES (
  '00000000-0000-4000-8000-000000007327'::uuid,
  '00000000-0000-4000-8000-000000007320'::uuid,
  '00000000-0000-4000-8000-000000007323'::uuid,
  ARRAY['academic_answers', 'summaries']::text[],
  ARRAY['test-model']::text[],
  10,
  100,
  10000,
  100000,
  10000,
  100000,
  100000,
  1000000,
  0,
  0,
  1,
  statement_timestamp() - interval '1 minute',
  statement_timestamp() + interval '1 hour',
  1,
  '00000000-0000-4000-8000-000000007323'::uuid,
  '00000000-0000-4000-8000-000000007324'::uuid,
  '00000000-0000-4000-8000-000000007328'::uuid
);

INSERT INTO public.lecture_sessions (
  id,
  title,
  code_hash,
  status,
  starts_at,
  ends_at
) VALUES (
  '00000000-0000-4000-8000-000000007329'::uuid,
  'B2 factor rotation drain',
  repeat('4', 64),
  'open',
  statement_timestamp() - interval '5 minutes',
  statement_timestamp() + interval '1 hour'
);

INSERT INTO public.lecture_ai_control (lecture_session_id)
VALUES ('00000000-0000-4000-8000-000000007329'::uuid);

INSERT INTO private.admin_ai_browser_enrollment_nonces (
  id,
  nonce_hash,
  reserved_browser_credential_id,
  credential_hash,
  environment_id,
  principal_id,
  membership_id,
  admin_session_id,
  factor_id,
  factor_version,
  step_up_verified_at,
  origin,
  public_key_fingerprint,
  absolute_expires_at,
  begin_request_id,
  expires_at
) VALUES (
  '00000000-0000-4000-8000-000000007330'::uuid,
  repeat('5', 64),
  '00000000-0000-4000-8000-000000007331'::uuid,
  repeat('6', 64),
  '00000000-0000-4000-8000-000000007320'::uuid,
  '00000000-0000-4000-8000-000000007321'::uuid,
  '00000000-0000-4000-8000-000000007323'::uuid,
  '00000000-0000-4000-8000-000000007324'::uuid,
  '00000000-0000-4000-8000-000000007325'::uuid,
  1,
  statement_timestamp(),
  'http://127.0.0.1:5173',
  'dd7ef224fe88ca6549161590c561f7a348c3f7482ec9c635e7cfa527f8a55d10',
  statement_timestamp() + interval '1 day',
  '00000000-0000-4000-8000-000000007332'::uuid,
  statement_timestamp() + interval '5 minutes'
);

INSERT INTO private.admin_ai_browser_credentials (
  id,
  credential_hash,
  environment_id,
  principal_id,
  membership_id,
  source_factor_id,
  source_factor_version,
  origin,
  public_key_jwk,
  public_key_fingerprint,
  enrolled_by_admin_session_id,
  enrollment_nonce_id,
  expires_at
) VALUES (
  '00000000-0000-4000-8000-000000007331'::uuid,
  repeat('6', 64),
  '00000000-0000-4000-8000-000000007320'::uuid,
  '00000000-0000-4000-8000-000000007321'::uuid,
  '00000000-0000-4000-8000-000000007323'::uuid,
  '00000000-0000-4000-8000-000000007325'::uuid,
  1,
  'http://127.0.0.1:5173',
  jsonb_build_object(
    'kty', 'EC',
    'crv', 'P-256',
    'x', repeat('A', 43),
    'y', repeat('B', 43)
  ),
  'dd7ef224fe88ca6549161590c561f7a348c3f7482ec9c635e7cfa527f8a55d10',
  '00000000-0000-4000-8000-000000007324'::uuid,
  '00000000-0000-4000-8000-000000007330'::uuid,
  statement_timestamp() + interval '1 day'
);

INSERT INTO private.admin_ai_browser_assertion_challenges (
  id,
  challenge_hash,
  browser_credential_id,
  environment_id,
  principal_id,
  membership_id,
  admin_session_id,
  factor_id,
  factor_version,
  lecture_session_id,
  requested_scope,
  policy_id,
  policy_version,
  origin,
  begin_request_id,
  expires_at
) VALUES (
  '00000000-0000-4000-8000-000000007333'::uuid,
  repeat('8', 64),
  '00000000-0000-4000-8000-000000007331'::uuid,
  '00000000-0000-4000-8000-000000007320'::uuid,
  '00000000-0000-4000-8000-000000007321'::uuid,
  '00000000-0000-4000-8000-000000007323'::uuid,
  '00000000-0000-4000-8000-000000007324'::uuid,
  '00000000-0000-4000-8000-000000007325'::uuid,
  1,
  '00000000-0000-4000-8000-000000007329'::uuid,
  'all_except_captions',
  '00000000-0000-4000-8000-000000007327'::uuid,
  1,
  'http://127.0.0.1:5173',
  '00000000-0000-4000-8000-000000007334'::uuid,
  statement_timestamp() + interval '5 minutes'
);

INSERT INTO public.lecture_ai_master_authorizations (
  id,
  lecture_session_id,
  admin_session_id,
  actor_id,
  scope,
  actions,
  expires_at,
  principal_id,
  membership_id,
  issuing_admin_session_id,
  ai_policy_id,
  ai_policy_version,
  unlock_method,
  unlock_factor_id,
  unlock_factor_version,
  unlock_verified_at,
  step_up_verified_at
) VALUES (
  '00000000-0000-4000-8000-000000007335'::uuid,
  '00000000-0000-4000-8000-000000007329'::uuid,
  '00000000-0000-4000-8000-000000007324'::uuid,
  'admin-session:00000000-0000-4000-8000-000000007324',
  'all_except_captions',
  ARRAY[
    'academic_answers',
    'material_analysis',
    'poll_suggestions',
    'summaries'
  ]::text[],
  statement_timestamp() + interval '1 hour',
  '00000000-0000-4000-8000-000000007321'::uuid,
  '00000000-0000-4000-8000-000000007323'::uuid,
  '00000000-0000-4000-8000-000000007324'::uuid,
  '00000000-0000-4000-8000-000000007327'::uuid,
  1,
  'ai_pin',
  '00000000-0000-4000-8000-000000007325'::uuid,
  1,
  statement_timestamp(),
  statement_timestamp()
);

SELECT private.drain_admin_ai_factor_authority_v1(
  '00000000-0000-4000-8000-000000007325'::uuid,
  '00000000-0000-4000-8000-000000007324'::uuid,
  'factor_rotated',
  statement_timestamp()
);

SELECT ok(
  (
    SELECT status = 'revoked' AND revoke_reason = 'factor_rotated'
    FROM public.lecture_ai_master_authorizations
    WHERE id = '00000000-0000-4000-8000-000000007335'::uuid
  )
  AND (
    SELECT status = 'revoked' AND revoke_reason = 'factor_rotated'
    FROM private.admin_ai_browser_credentials
    WHERE id = '00000000-0000-4000-8000-000000007331'::uuid
  )
  AND (
    SELECT status = 'superseded'
    FROM private.admin_ai_browser_assertion_challenges
    WHERE id = '00000000-0000-4000-8000-000000007333'::uuid
  )
  AND (
    SELECT status = 'superseded'
    FROM private.admin_ai_browser_enrollment_nonces
    WHERE id = '00000000-0000-4000-8000-000000007330'::uuid
  )
  AND (
    SELECT revoked_at IS NULL
    FROM public.admin_sessions
    WHERE id = '00000000-0000-4000-8000-000000007324'::uuid
  )
  AND pg_get_functiondef(
    'private.enroll_admin_ai_pin_v1(text,uuid,uuid,text,integer,uuid)'::regprocedure
  ) LIKE '%drain_admin_ai_factor_authority_v1%',
  'PIN rotation drains master, browser and pending proofs without revoking the Admin login session'
);

SELECT throws_ok(
  $$
    UPDATE public.lecture_ai_master_authorizations
    SET issuing_admin_session_id = NULL
    WHERE id = '00000000-0000-4000-8000-000000007335'::uuid
  $$,
  '23514',
  null,
  'master provenance rejects a NULL issuing session instead of accepting CHECK UNKNOWN'
);

SELECT throws_ok(
  $$
    UPDATE public.lecture_ai_master_authorizations
    SET ai_policy_version = NULL
    WHERE id = '00000000-0000-4000-8000-000000007335'::uuid
  $$,
  '23514',
  null,
  'master provenance rejects a NULL policy version instead of accepting CHECK UNKNOWN'
);

SELECT throws_ok(
  $$
    UPDATE public.lecture_ai_master_authorizations
    SET unlock_factor_version = NULL
    WHERE id = '00000000-0000-4000-8000-000000007335'::uuid
  $$,
  '23514',
  null,
  'master provenance rejects a NULL factor version instead of accepting CHECK UNKNOWN'
);

SELECT throws_ok(
  $$
    UPDATE private.admin_ai_browser_credentials
    SET public_key_jwk = jsonb_build_object(
      'kty', NULL,
      'crv', 'P-256',
      'x', repeat('A', 43),
      'y', repeat('B', 43)
    )
    WHERE id = '00000000-0000-4000-8000-000000007331'::uuid
  $$,
  '23514',
  null,
  'JSON null cannot bypass the ES256 public-key CHECK'
);

UPDATE private.admin_environments
SET current_deployment = true
WHERE id = '00000000-0000-4000-8000-000000007320'::uuid;

UPDATE private.admin_environment_memberships
SET role = 'owner'
WHERE id = '00000000-0000-4000-8000-000000007323'::uuid;

INSERT INTO auth.users (
  instance_id,
  id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  raw_app_meta_data,
  raw_user_meta_data,
  created_at,
  updated_at
) VALUES (
  '00000000-0000-0000-0000-000000000000'::uuid,
  '00000000-0000-4000-8000-000000007322'::uuid,
  'authenticated',
  'authenticated',
  'phase730b2-owner@example.test',
  '',
  statement_timestamp() - interval '1 hour',
  '{"provider":"google","providers":["google"]}'::jsonb,
  '{}'::jsonb,
  statement_timestamp() - interval '1 hour',
  statement_timestamp() - interval '1 hour'
) ON CONFLICT (id) DO NOTHING;

INSERT INTO auth.sessions (id, user_id, created_at, updated_at)
VALUES (
  '00000000-0000-4000-8000-000000007340'::uuid,
  '00000000-0000-4000-8000-000000007322'::uuid,
  statement_timestamp() - interval '1 hour',
  statement_timestamp() - interval '1 hour'
) ON CONFLICT (id) DO NOTHING;

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
  issued_at,
  expires_at
) VALUES (
  '00000000-0000-4000-8000-00000000734a'::uuid,
  encode(extensions.digest('phase7.30b2-main-login-nonce', 'sha256'), 'hex'),
  '00000000-0000-4000-8000-000000007341'::uuid,
  '00000000-0000-4000-8000-000000007320'::uuid,
  '00000000-0000-4000-8000-000000007321'::uuid,
  '00000000-0000-4000-8000-000000007323'::uuid,
  '00000000-0000-4000-8000-000000007340'::uuid,
  'admin_login',
  '00000000-0000-4000-8000-00000000734b'::uuid,
  encode(extensions.digest('phase7.30b2-main-prechallenge', 'sha256'), 'hex'),
  statement_timestamp() - interval '1 hour',
  statement_timestamp() - interval '1 hour',
  statement_timestamp() - interval '55 minutes'
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
  issued_at,
  last_seen_at,
  idle_expires_at,
  expires_at
) VALUES (
  '00000000-0000-4000-8000-000000007341'::uuid,
  repeat('1', 64),
  '00000000-0000-4000-8000-000000007322'::uuid,
  null,
  'google_totp',
  2,
  '00000000-0000-4000-8000-000000007321'::uuid,
  '00000000-0000-4000-8000-000000007323'::uuid,
  '00000000-0000-4000-8000-000000007320'::uuid,
  '00000000-0000-4000-8000-000000007340'::uuid,
  statement_timestamp() - interval '1 hour',
  '00000000-0000-4000-8000-00000000734a'::uuid,
  statement_timestamp() - interval '1 hour',
  statement_timestamp() - interval '1 hour',
  statement_timestamp() + interval '12 hours',
  statement_timestamp() + interval '12 hours'
);

UPDATE private.admin_step_up_nonces
SET
  status = 'consumed',
  consumed_at = statement_timestamp() - interval '1 hour',
  completed_admin_session_id = '00000000-0000-4000-8000-000000007341'::uuid,
  updated_at = statement_timestamp() - interval '1 hour'
WHERE id = '00000000-0000-4000-8000-00000000734a'::uuid;

SELECT ok(
  (
    SELECT app_session.expires_at = auth_session.created_at + interval '8 hours'
      AND app_session.idle_expires_at = app_session.expires_at
      AND app_session.expires_at > statement_timestamp() + interval '6 hours'
    FROM public.admin_sessions AS app_session
    JOIN auth.sessions AS auth_session
      ON auth_session.id = app_session.supabase_auth_session_id
    WHERE app_session.id = '00000000-0000-4000-8000-000000007341'::uuid
  ),
  'Google Admin session uses the backing Auth created_at plus eight hours and has no 30-minute idle cutoff'
);

UPDATE private.admin_ai_unlock_runtime_gate
SET ai_unlock_enabled = true, remembered_browser_enabled = true
WHERE singleton;

SET ROLE service_role;

SELECT is(
  public.get_admin_ai_pin_factor_metadata_v1(
    repeat('1', 64),
    '00000000-0000-4000-8000-000000007322'::uuid,
    '00000000-0000-4000-8000-000000007340'::uuid,
    repeat('2', 64),
    repeat('3', 64),
    '00000000-0000-4000-8000-000000007342'::uuid
  ) ->> 'pin_pepper_version',
  '1',
  'authenticated rate admission discovers only the active pepper version without fresh TOTP'
);

SELECT is(
  public.verify_admin_ai_pin_v1(
    repeat('1', 64),
    '00000000-0000-4000-8000-000000007322'::uuid,
    '00000000-0000-4000-8000-000000007340'::uuid,
    1,
    repeat('e', 64),
    repeat('2', 64),
    repeat('3', 64),
    '00000000-0000-4000-8000-000000007342'::uuid
  ) ->> 'verified',
  'true',
  'normal lecture AI PIN verification succeeds without periodic TOTP'
);

SELECT is(
  public.verify_admin_ai_pin_v1(
    repeat('1', 64),
    '00000000-0000-4000-8000-000000007322'::uuid,
    '00000000-0000-4000-8000-000000007340'::uuid,
    1,
    repeat('e', 64),
    repeat('2', 64),
    repeat('3', 64),
    '00000000-0000-4000-8000-000000007342'::uuid
  ) ->> 'verified',
  'true',
  'exact verification replay returns its immutable receipt without a second bcrypt attempt'
);

SELECT is(
  public.verify_admin_ai_pin_v1(
    repeat('1', 64),
    '00000000-0000-4000-8000-000000007322'::uuid,
    '00000000-0000-4000-8000-000000007340'::uuid,
    1,
    repeat('f', 64),
    repeat('2', 64),
    repeat('3', 64),
    '00000000-0000-4000-8000-000000007342'::uuid
  )::text,
  null,
  'verification replay with a different PIN proof is rejected as a different intent'
);

SELECT is(
  public.get_admin_ai_pin_factor_metadata_v1(
    repeat('1', 64),
    '00000000-0000-4000-8000-000000007322'::uuid,
    '00000000-0000-4000-8000-000000007340'::uuid,
    repeat('2', 64),
    repeat('4', 64),
    '00000000-0000-4000-8000-000000007342'::uuid
  )::text,
  null,
  'request replay with a different intent is rejected rather than aliased'
);

SELECT is(
  encode(
    extensions.digest(
      convert_to(
        '{"crv":"P-256","kty":"EC","x":"CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC","y":"DDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD"}',
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  ),
  '6095af6d3871acb291876a904d0bb06432486ba79f655f9397e8afc8a8e3a078',
  'RFC 7638 EC canonical bytes match the Node Edge known vector'
);

SELECT lives_ok(
  $$
    SELECT public.begin_admin_ai_browser_enrollment_v1(
      repeat('1', 64),
      '00000000-0000-4000-8000-000000007322'::uuid,
      '00000000-0000-4000-8000-000000007340'::uuid,
      repeat('9', 64),
      '00000000-0000-4000-8000-000000007343'::uuid,
      repeat('0', 64),
      'http://127.0.0.1:5173',
      '6095af6d3871acb291876a904d0bb06432486ba79f655f9397e8afc8a8e3a078',
      statement_timestamp() + interval '1 day',
      '00000000-0000-4000-8000-000000007344'::uuid
    )
  $$,
  'public browser enrollment begins from valid AAL2 and an active factor without a fresh TOTP boundary'
);

SELECT throws_ok(
  $$
    SELECT public.complete_admin_ai_browser_enrollment_v1(
      repeat('1', 64),
      '00000000-0000-4000-8000-000000007322'::uuid,
      '00000000-0000-4000-8000-000000007340'::uuid,
      repeat('9', 64),
      1,
      repeat('e', 64),
      repeat('2', 64),
      jsonb_build_object(
        'kty', NULL,
        'crv', 'P-256',
        'x', repeat('C', 43),
        'y', repeat('D', 43)
      ),
      '00000000-0000-4000-8000-000000007345'::uuid
    )
  $$,
  '22023',
  'invalid remembered-browser completion',
  'public browser completion rejects JSON null key material before persistence'
);

RESET ROLE;
UPDATE private.admin_ai_unlock_runtime_gate
SET remembered_browser_enabled = false
WHERE singleton;
SET ROLE service_role;

SELECT throws_ok(
  $$
    SELECT public.complete_admin_ai_browser_enrollment_v1(
      repeat('1', 64),
      '00000000-0000-4000-8000-000000007322'::uuid,
      '00000000-0000-4000-8000-000000007340'::uuid,
      repeat('9', 64),
      1,
      repeat('e', 64),
      repeat('2', 64),
      jsonb_build_object(
        'kty', 'EC',
        'crv', 'P-256',
        'x', repeat('C', 43),
        'y', repeat('D', 43)
      ),
      '00000000-0000-4000-8000-000000007345'::uuid
    )
  $$,
  'P7321',
  'Remembered-browser enrollment is disabled',
  'completion rechecks both runtime gates after a pending enrollment was issued'
);

RESET ROLE;
SELECT is(
  (
    SELECT status
    FROM private.admin_ai_browser_enrollment_nonces
    WHERE nonce_hash = repeat('9', 64)
  ),
  'pending',
  'gate-OFF enrollment completion leaves the nonce pending'
);
UPDATE private.admin_ai_unlock_runtime_gate
SET remembered_browser_enabled = true
WHERE singleton;
SET ROLE service_role;

SELECT is(
  public.complete_admin_ai_browser_enrollment_v1(
    repeat('1', 64),
    '00000000-0000-4000-8000-000000007322'::uuid,
    '00000000-0000-4000-8000-000000007340'::uuid,
    repeat('9', 64),
    1,
    repeat('e', 64),
    repeat('2', 64),
    jsonb_build_object(
      'kty', 'EC',
      'crv', 'P-256',
      'x', repeat('C', 43),
      'y', repeat('D', 43)
    ),
    '00000000-0000-4000-8000-000000007345'::uuid
  ) ->> 'status',
  'active',
  'version-bound PIN proof completes public remembered-browser enrollment'
);

SELECT lives_ok(
  $$
    SELECT public.begin_admin_ai_browser_assertion_v1(
      repeat('1', 64),
      '00000000-0000-4000-8000-000000007322'::uuid,
      '00000000-0000-4000-8000-000000007340'::uuid,
      repeat('0', 64),
      repeat('f', 64),
      'http://127.0.0.1:5173',
      '00000000-0000-4000-8000-000000007329'::uuid,
      'all_except_captions',
      '00000000-0000-4000-8000-000000007327'::uuid,
      1,
      statement_timestamp() + interval '5 minutes',
      '00000000-0000-4000-8000-000000007346'::uuid
    )
  $$,
  'public browser assertion begins with exact Origin, lecture, policy and factor bindings'
);

RESET ROLE;
UPDATE private.admin_ai_unlock_runtime_gate
SET ai_unlock_enabled = false
WHERE singleton;
SET ROLE service_role;

SELECT throws_ok(
  $$
    SELECT public.complete_admin_ai_browser_assertion_v1(
      repeat('1', 64),
      '00000000-0000-4000-8000-000000007322'::uuid,
      '00000000-0000-4000-8000-000000007340'::uuid,
      repeat('0', 64),
      repeat('f', 64),
      'http://127.0.0.1:5173',
      repeat('d', 64),
      true,
      '00000000-0000-4000-8000-000000007347'::uuid
    )
  $$,
  'P7321',
  'Remembered-browser assertion is disabled',
  'assertion completion rechecks both runtime gates after a challenge was issued'
);

RESET ROLE;
SELECT is(
  (
    SELECT status
    FROM private.admin_ai_browser_assertion_challenges
    WHERE challenge_hash = repeat('f', 64)
  ),
  'pending',
  'gate-OFF assertion completion leaves the challenge pending'
);
UPDATE private.admin_ai_unlock_runtime_gate
SET ai_unlock_enabled = true
WHERE singleton;
SET ROLE service_role;

SELECT is(
  public.complete_admin_ai_browser_assertion_v1(
    repeat('1', 64),
    '00000000-0000-4000-8000-000000007322'::uuid,
    '00000000-0000-4000-8000-000000007340'::uuid,
    repeat('0', 64),
    repeat('f', 64),
    'http://127.0.0.1:5173',
    repeat('d', 64),
    true,
    '00000000-0000-4000-8000-000000007347'::uuid
  ) ->> 'verified',
  'true',
  'public browser assertion consumes exactly one signature-verified challenge'
);

RESET ROLE;

INSERT INTO public.lecture_ai_master_authorizations (
  id,
  lecture_session_id,
  admin_session_id,
  actor_id,
  scope,
  actions,
  expires_at,
  principal_id,
  membership_id,
  issuing_admin_session_id,
  ai_policy_id,
  ai_policy_version,
  unlock_method,
  unlock_factor_id,
  unlock_factor_version,
  browser_credential_id,
  unlock_verified_at,
  step_up_verified_at
) VALUES (
  '00000000-0000-4000-8000-000000007348'::uuid,
  '00000000-0000-4000-8000-000000007329'::uuid,
  '00000000-0000-4000-8000-000000007341'::uuid,
  'admin-session:00000000-0000-4000-8000-000000007341',
  'all_except_captions',
  ARRAY['academic_answers', 'material_analysis', 'poll_suggestions', 'summaries']::text[],
  statement_timestamp() + interval '1 hour',
  '00000000-0000-4000-8000-000000007321'::uuid,
  '00000000-0000-4000-8000-000000007323'::uuid,
  '00000000-0000-4000-8000-000000007341'::uuid,
  '00000000-0000-4000-8000-000000007327'::uuid,
  1,
  'remembered_browser',
  '00000000-0000-4000-8000-000000007325'::uuid,
  1,
  '00000000-0000-4000-8000-000000007343'::uuid,
  statement_timestamp(),
  statement_timestamp() - interval '1 hour'
);

SET ROLE service_role;
SELECT ok(
  public.revoke_admin_ai_browser_credential_v1(
    repeat('1', 64),
    '00000000-0000-4000-8000-000000007322'::uuid,
    '00000000-0000-4000-8000-000000007340'::uuid,
    '00000000-0000-4000-8000-000000007343'::uuid,
    '00000000-0000-4000-8000-000000007349'::uuid
  ),
  'public credential self-revocation is accepted'
);
RESET ROLE;

SELECT ok(
  (
    SELECT status = 'revoked' AND revoke_reason = 'browser_credential_revoked'
    FROM public.lecture_ai_master_authorizations
    WHERE id = '00000000-0000-4000-8000-000000007348'::uuid
  ),
  'browser credential revocation drains every active master sourced from it'
);

INSERT INTO public.lecture_ai_master_authorizations (
  id,
  lecture_session_id,
  admin_session_id,
  actor_id,
  scope,
  actions,
  expires_at,
  principal_id,
  membership_id,
  issuing_admin_session_id,
  ai_policy_id,
  ai_policy_version,
  unlock_method,
  unlock_factor_id,
  unlock_factor_version,
  unlock_verified_at,
  step_up_verified_at
) VALUES (
  '00000000-0000-4000-8000-000000007350'::uuid,
  '00000000-0000-4000-8000-000000007329'::uuid,
  '00000000-0000-4000-8000-000000007341'::uuid,
  'admin-session:00000000-0000-4000-8000-000000007341',
  'all_except_captions',
  ARRAY['academic_answers', 'material_analysis', 'poll_suggestions', 'summaries']::text[],
  statement_timestamp() + interval '1 hour',
  '00000000-0000-4000-8000-000000007321'::uuid,
  '00000000-0000-4000-8000-000000007323'::uuid,
  '00000000-0000-4000-8000-000000007341'::uuid,
  '00000000-0000-4000-8000-000000007327'::uuid,
  1,
  'ai_pin',
  '00000000-0000-4000-8000-000000007325'::uuid,
  1,
  statement_timestamp(),
  statement_timestamp() - interval '1 hour'
);

SET ROLE service_role;

SELECT is(
  public.set_admin_ai_policy_v1(
    repeat('1', 64),
    '00000000-0000-4000-8000-000000007322'::uuid,
    '00000000-0000-4000-8000-000000007340'::uuid,
    '00000000-0000-4000-8000-000000007323'::uuid,
    ARRAY['academic_answers', 'summaries']::text[],
    ARRAY['test-model']::text[],
    11, 100, 10000, 100000, 10000, 100000, 100000, 1000000,
    0, 0, 1,
    '2020-01-01 00:00:00+00'::timestamptz,
    '2099-01-01 00:00:00+00'::timestamptz,
    '00000000-0000-4000-8000-000000007390'::uuid
  )::text,
  null,
  'policy mutation rejects a one-hour-old step-up without a caller-controlled recency override'
);

RESET ROLE;
SELECT is(
  (
    SELECT count(*)::integer
    FROM private.admin_ai_policies
    WHERE request_id = '00000000-0000-4000-8000-000000007390'::uuid
  ),
  0,
  'stale policy step-up creates no policy receipt or authority'
);
UPDATE public.admin_sessions
SET step_up_verified_at = statement_timestamp() - interval '1 minute'
WHERE id = '00000000-0000-4000-8000-000000007341'::uuid;
SET ROLE service_role;

SELECT is(
  public.set_admin_ai_policy_v1(
    repeat('1', 64),
    '00000000-0000-4000-8000-000000007322'::uuid,
    '00000000-0000-4000-8000-000000007340'::uuid,
    '00000000-0000-4000-8000-000000007323'::uuid,
    ARRAY['academic_answers', 'summaries']::text[],
    ARRAY['test-model']::text[],
    11, 100, 10000, 100000, 10000, 100000, 100000, 1000000,
    0, 0, 1,
    '2020-01-01 00:00:00+00'::timestamptz,
    '2099-01-01 00:00:00+00'::timestamptz,
    '00000000-0000-4000-8000-000000007351'::uuid
  ) ->> 'version',
  '2',
  'public owner policy update supersedes version one'
);

RESET ROLE;
UPDATE public.admin_sessions
SET step_up_verified_at = statement_timestamp() - interval '6 minutes'
WHERE id = '00000000-0000-4000-8000-000000007341'::uuid;
SET ROLE service_role;

SELECT is(
  public.set_admin_ai_policy_v1(
    repeat('1', 64),
    '00000000-0000-4000-8000-000000007322'::uuid,
    '00000000-0000-4000-8000-000000007340'::uuid,
    '00000000-0000-4000-8000-000000007323'::uuid,
    ARRAY['academic_answers', 'summaries']::text[],
    ARRAY['test-model']::text[],
    11, 100, 10000, 100000, 10000, 100000, 100000, 1000000,
    0, 0, 1,
    '2020-01-01 00:00:00+00'::timestamptz,
    '2099-01-01 00:00:00+00'::timestamptz,
    '00000000-0000-4000-8000-000000007351'::uuid
  ) ->> 'version',
  '2',
  'exact policy request replay returns the committed version after fresh step-up expires'
);

SELECT is(
  public.set_admin_ai_policy_v1(
    repeat('1', 64),
    '00000000-0000-4000-8000-000000007322'::uuid,
    '00000000-0000-4000-8000-000000007340'::uuid,
    '00000000-0000-4000-8000-000000007323'::uuid,
    ARRAY['academic_answers', 'summaries']::text[],
    ARRAY['test-model']::text[],
    12, 100, 10000, 100000, 10000, 100000, 100000, 1000000,
    0, 0, 1,
    '2020-01-01 00:00:00+00'::timestamptz,
    '2099-01-01 00:00:00+00'::timestamptz,
    '00000000-0000-4000-8000-000000007351'::uuid
  )::text,
  null,
  'stale policy request replay with a changed quota is rejected as a different intent'
);
RESET ROLE;

SELECT ok(
  (
    SELECT status = 'revoked' AND revoke_reason = 'policy_superseded'
    FROM public.lecture_ai_master_authorizations
    WHERE id = '00000000-0000-4000-8000-000000007350'::uuid
  ),
  'policy supersession drains every active master tied to the old policy'
);

SET ROLE service_role;

SELECT lives_ok($$
  SELECT public.get_admin_ai_pin_factor_metadata_v1(
    repeat('1',64), '00000000-0000-4000-8000-000000007322'::uuid,
    '00000000-0000-4000-8000-000000007340'::uuid,
    repeat('4',64), repeat('5',64), '00000000-0000-4000-8000-000000007360'::uuid
  )
$$, 'first wrong-PIN request receives a version-bound attempt');
SELECT lives_ok($$
  SELECT public.verify_admin_ai_pin_v1(
    repeat('1',64), '00000000-0000-4000-8000-000000007322'::uuid,
    '00000000-0000-4000-8000-000000007340'::uuid, 1,
    repeat('f',64), repeat('4',64), repeat('5',64),
    '00000000-0000-4000-8000-000000007360'::uuid
  )
$$, 'first wrong PIN is recorded');

SELECT lives_ok($$
  SELECT public.get_admin_ai_pin_factor_metadata_v1(
    repeat('1',64), '00000000-0000-4000-8000-000000007322'::uuid,
    '00000000-0000-4000-8000-000000007340'::uuid,
    repeat('4',64), repeat('6',64), '00000000-0000-4000-8000-000000007361'::uuid
  )
$$, 'second wrong-PIN request receives a version-bound attempt');
SELECT lives_ok($$
  SELECT public.verify_admin_ai_pin_v1(
    repeat('1',64), '00000000-0000-4000-8000-000000007322'::uuid,
    '00000000-0000-4000-8000-000000007340'::uuid, 1,
    repeat('f',64), repeat('4',64), repeat('6',64),
    '00000000-0000-4000-8000-000000007361'::uuid
  )
$$, 'second wrong PIN is recorded');

SELECT lives_ok($$
  SELECT public.get_admin_ai_pin_factor_metadata_v1(
    repeat('1',64), '00000000-0000-4000-8000-000000007322'::uuid,
    '00000000-0000-4000-8000-000000007340'::uuid,
    repeat('4',64), repeat('7',64), '00000000-0000-4000-8000-000000007362'::uuid
  )
$$, 'third wrong-PIN request receives a version-bound attempt');
SELECT lives_ok($$
  SELECT public.verify_admin_ai_pin_v1(
    repeat('1',64), '00000000-0000-4000-8000-000000007322'::uuid,
    '00000000-0000-4000-8000-000000007340'::uuid, 1,
    repeat('f',64), repeat('4',64), repeat('7',64),
    '00000000-0000-4000-8000-000000007362'::uuid
  )
$$, 'third wrong PIN is recorded');

SELECT lives_ok($$
  SELECT public.get_admin_ai_pin_factor_metadata_v1(
    repeat('1',64), '00000000-0000-4000-8000-000000007322'::uuid,
    '00000000-0000-4000-8000-000000007340'::uuid,
    repeat('4',64), repeat('8',64), '00000000-0000-4000-8000-000000007363'::uuid
  )
$$, 'fourth wrong-PIN request receives a version-bound attempt');
SELECT lives_ok($$
  SELECT public.verify_admin_ai_pin_v1(
    repeat('1',64), '00000000-0000-4000-8000-000000007322'::uuid,
    '00000000-0000-4000-8000-000000007340'::uuid, 1,
    repeat('f',64), repeat('4',64), repeat('8',64),
    '00000000-0000-4000-8000-000000007363'::uuid
  )
$$, 'fourth wrong PIN is recorded');

SELECT lives_ok($$
  SELECT public.get_admin_ai_pin_factor_metadata_v1(
    repeat('1',64), '00000000-0000-4000-8000-000000007322'::uuid,
    '00000000-0000-4000-8000-000000007340'::uuid,
    repeat('4',64), repeat('9',64), '00000000-0000-4000-8000-000000007364'::uuid
  )
$$, 'fifth wrong-PIN request receives a version-bound attempt');
SELECT is(
  public.verify_admin_ai_pin_v1(
    repeat('1',64), '00000000-0000-4000-8000-000000007322'::uuid,
    '00000000-0000-4000-8000-000000007340'::uuid, 1,
    repeat('f',64), repeat('4',64), repeat('9',64),
    '00000000-0000-4000-8000-000000007364'::uuid
  ) ->> 'reason_code',
  'unlock_temporarily_unavailable',
  'the fifth membership failure atomically activates the 15-minute lock'
);

SELECT is(
  public.get_admin_ai_pin_factor_metadata_v1(
    repeat('1',64), '00000000-0000-4000-8000-000000007322'::uuid,
    '00000000-0000-4000-8000-000000007340'::uuid,
    repeat('4',64), repeat('a',64), '00000000-0000-4000-8000-000000007365'::uuid
  ) ->> 'available',
  'false',
  'locked membership cannot obtain another pepper-version attempt'
);

RESET ROLE;
INSERT INTO private.admin_ai_pin_discovery_receipts (
  request_id,
  intent_digest,
  network_hmac,
  environment_id,
  principal_id,
  membership_id,
  admin_session_id,
  factor_id,
  factor_version,
  pin_pepper_version,
  expires_at
) VALUES (
  '00000000-0000-4000-8000-000000007367'::uuid,
  repeat('a',64),
  repeat('4',64),
  '00000000-0000-4000-8000-000000007320'::uuid,
  '00000000-0000-4000-8000-000000007321'::uuid,
  '00000000-0000-4000-8000-000000007323'::uuid,
  '00000000-0000-4000-8000-000000007341'::uuid,
  '00000000-0000-4000-8000-000000007325'::uuid,
  1,
  1,
  statement_timestamp() + interval '5 minutes'
);
SET ROLE service_role;

SELECT is(
  public.verify_admin_ai_pin_v1(
    repeat('1',64), '00000000-0000-4000-8000-000000007322'::uuid,
    '00000000-0000-4000-8000-000000007340'::uuid, 1,
    repeat('e',64), repeat('4',64), repeat('a',64),
    '00000000-0000-4000-8000-000000007367'::uuid
  ) ->> 'reason_code',
  'unlock_temporarily_unavailable',
  'a pre-locked attempt records a bounded denial without another bcrypt'
);

SELECT is(
  public.verify_admin_ai_pin_v1(
    repeat('1',64), '00000000-0000-4000-8000-000000007322'::uuid,
    '00000000-0000-4000-8000-000000007340'::uuid, 1,
    repeat('e',64), repeat('4',64), repeat('a',64),
    '00000000-0000-4000-8000-000000007367'::uuid
  ) ->> 'reason_code',
  'unlock_temporarily_unavailable',
  'exact pre-locked denial replay returns the immutable receipt'
);

SELECT is(
  public.verify_admin_ai_pin_v1(
    repeat('1',64), '00000000-0000-4000-8000-000000007322'::uuid,
    '00000000-0000-4000-8000-000000007340'::uuid, 1,
    repeat('d',64), repeat('4',64), repeat('a',64),
    '00000000-0000-4000-8000-000000007367'::uuid
  )::text,
  null,
  'pre-locked denial replay rejects a different input proof'
);

RESET ROLE;
SELECT ok(
  (
    SELECT input_pin_pepper_version = 1
      AND input_pin_proof_digest IS NOT NULL
      AND factor_id IS NULL
      AND factor_version IS NULL
      AND factor_pin_pepper_version IS NULL
    FROM private.admin_ai_unlock_attempt_receipts
    WHERE request_id = '00000000-0000-4000-8000-000000007367'::uuid
  ),
  'blocked receipts retain non-null input proof binding with nullable factor provenance'
);

DELETE FROM private.admin_ai_unlock_rate_limits
WHERE environment_id = '00000000-0000-4000-8000-000000007320'::uuid;
SET ROLE service_role;

SELECT is(
  public.get_admin_ai_pin_factor_metadata_v1(
    repeat('1',64), '00000000-0000-4000-8000-000000007322'::uuid,
    '00000000-0000-4000-8000-000000007340'::uuid,
    repeat('6',64), repeat('b',64), '00000000-0000-4000-8000-000000007368'::uuid
  ) ->> 'factor_version',
  '1',
  'stale-factor regression starts with an exact version-one discovery receipt'
);

RESET ROLE;
UPDATE public.admin_sessions
SET step_up_verified_at = statement_timestamp() - interval '5 minutes 1 second'
WHERE id = '00000000-0000-4000-8000-000000007341'::uuid;
SET ROLE service_role;

SELECT is(
  public.enroll_admin_ai_pin_v1(
    repeat('1',64),
    '00000000-0000-4000-8000-000000007322'::uuid,
    '00000000-0000-4000-8000-000000007340'::uuid,
    repeat('b',64),
    2,
    '00000000-0000-4000-8000-000000007378'::uuid
  )::text,
  null,
  'PIN rotation rejects a DB-recorded step-up at five minutes and one second'
);

RESET ROLE;
SELECT is(
  (
    SELECT count(*)::integer
    FROM private.admin_ai_unlock_factors
    WHERE enrollment_request_id = '00000000-0000-4000-8000-000000007378'::uuid
  ),
  0,
  'rejected five-minute PIN rotation creates no factor version'
);
UPDATE public.admin_sessions
SET step_up_verified_at = statement_timestamp() - interval '4 minutes 59 seconds'
WHERE id = '00000000-0000-4000-8000-000000007341'::uuid;
SET ROLE service_role;

SELECT is(
  public.enroll_admin_ai_pin_v1(
    repeat('1',64),
    '00000000-0000-4000-8000-000000007322'::uuid,
    '00000000-0000-4000-8000-000000007340'::uuid,
    repeat('b',64),
    2,
    '00000000-0000-4000-8000-000000007366'::uuid
  ) ->> 'factor_version',
  '2',
  'PIN rotation succeeds at four minutes and fifty-nine seconds without a second prompt'
);

RESET ROLE;
UPDATE public.admin_sessions
SET step_up_verified_at = statement_timestamp() - interval '6 minutes'
WHERE id = '00000000-0000-4000-8000-000000007341'::uuid;
SET ROLE service_role;

SELECT is(
  public.enroll_admin_ai_pin_v1(
    repeat('1',64),
    '00000000-0000-4000-8000-000000007322'::uuid,
    '00000000-0000-4000-8000-000000007340'::uuid,
    repeat('b',64),
    2,
    '00000000-0000-4000-8000-000000007366'::uuid
  ) ->> 'factor_version',
  '2',
  'exact PIN mutation request replays after the five-minute step-up window expires'
);

SELECT is(
  public.enroll_admin_ai_pin_v1(
    repeat('1',64),
    '00000000-0000-4000-8000-000000007322'::uuid,
    '00000000-0000-4000-8000-000000007340'::uuid,
    repeat('c',64),
    2,
    '00000000-0000-4000-8000-000000007366'::uuid
  ) ->> 'factor_version',
  '2',
  'same PIN enrollment request returns the committed result without rechecking changed PIN input'
);

RESET ROLE;
SELECT is(
  (
    SELECT count(*)::integer
    FROM private.admin_ai_unlock_factors
    WHERE enrollment_request_id = '00000000-0000-4000-8000-000000007366'::uuid
  ),
  1,
  'same PIN enrollment request never creates a second factor version'
);

INSERT INTO auth.users (
  instance_id,
  id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  raw_app_meta_data,
  raw_user_meta_data,
  created_at,
  updated_at
) VALUES (
  '00000000-0000-0000-0000-000000000000'::uuid,
  '00000000-0000-4000-8000-000000007370'::uuid,
  'authenticated',
  'authenticated',
  'phase730b2-second@example.test',
  '',
  statement_timestamp() - interval '7 hours 59 minutes',
  '{"provider":"google","providers":["google"]}'::jsonb,
  '{}'::jsonb,
  statement_timestamp() - interval '7 hours 59 minutes',
  statement_timestamp() - interval '7 hours 59 minutes'
) ON CONFLICT (id) DO NOTHING;

INSERT INTO auth.sessions (id, user_id, created_at, updated_at)
VALUES (
  '00000000-0000-4000-8000-000000007371'::uuid,
  '00000000-0000-4000-8000-000000007370'::uuid,
  statement_timestamp() - interval '7 hours 59 minutes',
  statement_timestamp() - interval '7 hours 59 minutes'
) ON CONFLICT (id) DO NOTHING;

INSERT INTO private.admin_principals (
  id,
  auth_user_id,
  google_issuer,
  provider_subject_hmac,
  subject_pepper_version,
  normalized_email,
  email_verified_at
) VALUES (
  '00000000-0000-4000-8000-000000007372'::uuid,
  '00000000-0000-4000-8000-000000007370'::uuid,
  'https://accounts.google.com',
  repeat('7', 64),
  1,
  'phase730b2-second@example.test',
  statement_timestamp() - interval '7 hours 59 minutes'
);

INSERT INTO private.admin_environment_memberships (
  id,
  environment_id,
  principal_id,
  role,
  status,
  can_use_ai,
  activated_at
) VALUES (
  '00000000-0000-4000-8000-000000007373'::uuid,
  '00000000-0000-4000-8000-000000007320'::uuid,
  '00000000-0000-4000-8000-000000007372'::uuid,
  'instructor',
  'active',
  true,
  statement_timestamp() - interval '7 hours 59 minutes'
);

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
  issued_at,
  expires_at
) VALUES (
  '00000000-0000-4000-8000-00000000737a'::uuid,
  encode(extensions.digest('phase7.30b2-near-cap-login-nonce', 'sha256'), 'hex'),
  '00000000-0000-4000-8000-000000007374'::uuid,
  '00000000-0000-4000-8000-000000007320'::uuid,
  '00000000-0000-4000-8000-000000007372'::uuid,
  '00000000-0000-4000-8000-000000007373'::uuid,
  '00000000-0000-4000-8000-000000007371'::uuid,
  'admin_login',
  '00000000-0000-4000-8000-00000000737b'::uuid,
  encode(extensions.digest('phase7.30b2-near-cap-prechallenge', 'sha256'), 'hex'),
  statement_timestamp() - interval '7 hours 59 minutes',
  statement_timestamp() - interval '7 hours 59 minutes',
  statement_timestamp() - interval '7 hours 54 minutes'
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
  issued_at,
  last_seen_at,
  idle_expires_at,
  expires_at
) VALUES (
  '00000000-0000-4000-8000-000000007374'::uuid,
  repeat('8', 64),
  '00000000-0000-4000-8000-000000007370'::uuid,
  null,
  'google_totp',
  2,
  '00000000-0000-4000-8000-000000007372'::uuid,
  '00000000-0000-4000-8000-000000007373'::uuid,
  '00000000-0000-4000-8000-000000007320'::uuid,
  '00000000-0000-4000-8000-000000007371'::uuid,
  statement_timestamp() - interval '7 hours 59 minutes',
  '00000000-0000-4000-8000-00000000737a'::uuid,
  statement_timestamp() - interval '7 hours 59 minutes',
  statement_timestamp() - interval '7 hours 59 minutes',
  statement_timestamp() + interval '1 hour',
  statement_timestamp() + interval '1 hour'
);

UPDATE private.admin_step_up_nonces
SET
  status = 'consumed',
  consumed_at = statement_timestamp() - interval '7 hours 59 minutes',
  completed_admin_session_id = '00000000-0000-4000-8000-000000007374'::uuid,
  updated_at = statement_timestamp() - interval '7 hours 59 minutes'
WHERE id = '00000000-0000-4000-8000-00000000737a'::uuid;

INSERT INTO private.admin_ai_unlock_factors (
  id,
  environment_id,
  principal_id,
  membership_id,
  pin_verifier,
  pin_pepper_version,
  factor_version,
  enrolled_by_admin_session_id,
  enrolled_step_up_verified_at,
  enrollment_request_id
) VALUES (
  '00000000-0000-4000-8000-000000007375'::uuid,
  '00000000-0000-4000-8000-000000007320'::uuid,
  '00000000-0000-4000-8000-000000007372'::uuid,
  '00000000-0000-4000-8000-000000007373'::uuid,
  extensions.crypt(repeat('9', 64), extensions.gen_salt('bf', 12)),
  1,
  1,
  '00000000-0000-4000-8000-000000007374'::uuid,
  statement_timestamp() - interval '7 hours 59 minutes',
  '00000000-0000-4000-8000-000000007376'::uuid
);

SET ROLE service_role;
SELECT is(
  public.enroll_admin_ai_pin_v1(
    repeat('8',64),
    '00000000-0000-4000-8000-000000007370'::uuid,
    '00000000-0000-4000-8000-000000007371'::uuid,
    repeat('a',64),
    2,
    '00000000-0000-4000-8000-000000007377'::uuid
  )::text,
  null,
  'near-eight-hour AAL2 session cannot rotate its PIN without a recent rare step-up'
);

RESET ROLE;
SELECT ok(
  (
    SELECT app_session.expires_at = auth_session.created_at + interval '8 hours'
    FROM public.admin_sessions AS app_session
    JOIN auth.sessions AS auth_session
      ON auth_session.id = app_session.supabase_auth_session_id
    WHERE app_session.id = '00000000-0000-4000-8000-000000007374'::uuid
  )
  AND NOT EXISTS (
    SELECT 1
    FROM private.admin_ai_unlock_factors
    WHERE enrollment_request_id = '00000000-0000-4000-8000-000000007377'::uuid
  ),
  'eight-hour Auth cap remains intact and stale factor mutation creates no new version'
);

UPDATE public.admin_sessions
SET step_up_verified_at = statement_timestamp() - interval '1 minute'
WHERE id = '00000000-0000-4000-8000-000000007374'::uuid;
SET ROLE service_role;

SELECT is(
  public.enroll_admin_ai_pin_v1(
    repeat('8',64),
    '00000000-0000-4000-8000-000000007370'::uuid,
    '00000000-0000-4000-8000-000000007371'::uuid,
    repeat('a',64),
    2,
    '00000000-0000-4000-8000-000000007379'::uuid
  ) ->> 'factor_version',
  '2',
  'fresh rare step-up permits a PIN rotation immediately before the eight-hour Auth cap'
);

RESET ROLE;
SELECT ok(
  (
    SELECT app_session.expires_at = auth_session.created_at + interval '8 hours'
      AND app_session.idle_expires_at = app_session.expires_at
      AND app_session.revoked_at IS NULL
    FROM public.admin_sessions AS app_session
    JOIN auth.sessions AS auth_session
      ON auth_session.id = app_session.supabase_auth_session_id
    WHERE app_session.id = '00000000-0000-4000-8000-000000007374'::uuid
  )
  AND EXISTS (
    SELECT 1
    FROM private.admin_ai_unlock_factors
    WHERE membership_id = '00000000-0000-4000-8000-000000007373'::uuid
      AND factor_version = 2
      AND status = 'active'
      AND enrollment_request_id = '00000000-0000-4000-8000-000000007379'::uuid
  ),
  'near-cap factor mutation cannot extend expires_at or idle_expires_at beyond Auth created_at plus eight hours'
);

UPDATE private.admin_environment_memberships
SET role = 'owner'
WHERE id = '00000000-0000-4000-8000-000000007373'::uuid;
SET ROLE service_role;

SELECT is(
  public.set_admin_ai_policy_v1(
    repeat('8', 64),
    '00000000-0000-4000-8000-000000007370'::uuid,
    '00000000-0000-4000-8000-000000007371'::uuid,
    '00000000-0000-4000-8000-000000007323'::uuid,
    ARRAY['academic_answers', 'summaries']::text[],
    ARRAY['test-model']::text[],
    11, 100, 10000, 100000, 10000, 100000, 100000, 1000000,
    0, 0, 1,
    '2020-01-01 00:00:00+00'::timestamptz,
    '2099-01-01 00:00:00+00'::timestamptz,
    '00000000-0000-4000-8000-000000007351'::uuid
  )::text,
  null,
  'same policy request ID cannot replay across owner actors with exact input'
);

SELECT is(
  public.enroll_admin_ai_pin_v1(
    repeat('8',64),
    '00000000-0000-4000-8000-000000007370'::uuid,
    '00000000-0000-4000-8000-000000007371'::uuid,
    repeat('b',64),
    2,
    '00000000-0000-4000-8000-000000007366'::uuid
  )::text,
  null,
  'same enrollment request ID cannot replay across actors even with the exact factor intent'
);

SELECT is(
  public.verify_admin_ai_pin_v1(
    repeat('1',64), '00000000-0000-4000-8000-000000007322'::uuid,
    '00000000-0000-4000-8000-000000007340'::uuid, 1,
    repeat('e',64), repeat('6',64), repeat('b',64),
    '00000000-0000-4000-8000-000000007368'::uuid
  ) ->> 'reason_code',
  'invalid_unlock',
  'a factor rotated after discovery records a stale-factor denial'
);

SELECT is(
  public.verify_admin_ai_pin_v1(
    repeat('1',64), '00000000-0000-4000-8000-000000007322'::uuid,
    '00000000-0000-4000-8000-000000007340'::uuid, 1,
    repeat('e',64), repeat('6',64), repeat('b',64),
    '00000000-0000-4000-8000-000000007368'::uuid
  ) ->> 'reason_code',
  'invalid_unlock',
  'exact stale-factor denial replay returns the immutable receipt'
);

SELECT is(
  public.verify_admin_ai_pin_v1(
    repeat('1',64), '00000000-0000-4000-8000-000000007322'::uuid,
    '00000000-0000-4000-8000-000000007340'::uuid, 1,
    repeat('d',64), repeat('6',64), repeat('b',64),
    '00000000-0000-4000-8000-000000007368'::uuid
  )::text,
  null,
  'stale-factor denial replay rejects a different input proof'
);

RESET ROLE;

SELECT ok(
  (
    SELECT input_pin_pepper_version = 1
      AND input_pin_proof_digest IS NOT NULL
      AND factor_id IS NULL
      AND factor_version IS NULL
      AND factor_pin_pepper_version IS NULL
    FROM private.admin_ai_unlock_attempt_receipts
    WHERE request_id = '00000000-0000-4000-8000-000000007368'::uuid
  ),
  'stale-factor receipts retain non-null input proof binding with nullable factor provenance'
);

SELECT ok(
  (
    SELECT revoked_at IS NULL AND expires_at = idle_expires_at
    FROM public.admin_sessions
    WHERE id = '00000000-0000-4000-8000-000000007341'::uuid
  ),
  'factor rotation preserves the logged-in Admin lecture session'
);

INSERT INTO private.admin_ai_unlock_rate_limits (
  environment_id,
  bucket_kind,
  bucket_key,
  network_hmac,
  window_started_at,
  updated_at
)
SELECT
  '00000000-0000-4000-8000-000000007320'::uuid,
  'network',
  encode(
    extensions.digest(
      convert_to('b2-cleanup:' || series.value::text, 'UTF8'),
      'sha256'
    ),
    'hex'
  ),
  encode(
    extensions.digest(
      convert_to('b2-cleanup:' || series.value::text, 'UTF8'),
      'sha256'
    ),
    'hex'
  ),
  statement_timestamp() - interval '2 days',
  statement_timestamp() - interval '2 days'
FROM generate_series(1, 501) AS series(value);

UPDATE private.admin_ai_unlock_runtime_gate
SET ai_unlock_enabled = false, remembered_browser_enabled = false
WHERE singleton;

SET ROLE service_role;
SELECT is(
  public.get_admin_ai_unlock_runtime_gate_v1() ->> 'ai_unlock_enabled',
  'false',
  'service wrapper exposes only dormant gate state'
);
SELECT is(
  public.get_admin_ai_unlock_runtime_gate_v1() ->> 'remembered_browser_enabled',
  'false',
  'final dormant gate also disables remembered-browser issuance and completion'
);

SELECT ok(
  (
    SELECT (cleanup.result ->> 'rate_buckets')::integer = 500
      AND (cleanup.result ->> 'has_more')::boolean
    FROM (
      SELECT public.cleanup_admin_ai_ephemera_v1(
        statement_timestamp() - interval '1 day',
        '00000000-0000-4000-8000-000000007336'::uuid
      ) AS result
    ) AS cleanup
  ),
  'first cleanup call is bounded at 500 rows and exposes remaining backlog'
);

SELECT ok(
  (
    SELECT (cleanup.result ->> 'rate_buckets')::integer = 1
      AND NOT (cleanup.result ->> 'has_more')::boolean
    FROM (
      SELECT public.cleanup_admin_ai_ephemera_v1(
        statement_timestamp() - interval '1 day',
        '00000000-0000-4000-8000-000000007337'::uuid
      ) AS result
    ) AS cleanup
  ),
  'second cleanup call converges and clears the reported backlog'
);
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
