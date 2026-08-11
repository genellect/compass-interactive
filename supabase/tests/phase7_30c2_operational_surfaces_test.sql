BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path = public, extensions;
SELECT no_plan();

SELECT has_table(
  'private', 'admin_google_display_sessions',
  'C2 stores every Google-issued Display root binding privately'
);
SELECT is(
  (SELECT count(*)::integer FROM private.admin_google_display_sessions),
  0,
  'the migration fabricates no Google Display binding'
);
SELECT ok(
  (
    SELECT class.relrowsecurity
    FROM pg_class AS class
    JOIN pg_namespace AS namespace ON namespace.oid = class.relnamespace
    WHERE namespace.nspname = 'private'
      AND class.relname = 'admin_google_display_sessions'
  ),
  'the Google Display root table enables defense-in-depth RLS'
);
SELECT ok(
  NOT has_table_privilege(
    'service_role', 'private.admin_google_display_sessions', 'SELECT'
  )
  AND NOT has_table_privilege(
    'service_role', 'private.admin_google_display_sessions', 'UPDATE'
  )
  AND NOT has_table_privilege(
    'anon', 'private.admin_google_display_sessions', 'SELECT'
  )
  AND NOT has_table_privilege(
    'authenticated', 'private.admin_google_display_sessions', 'SELECT'
  ),
  'runtime roles cannot read or mutate Google Display bindings directly'
);
SELECT ok(
  NOT EXISTS (
    SELECT 1
    FROM pg_constraint AS foreign_key
    WHERE foreign_key.contype = 'f'
      AND foreign_key.conrelid =
        'private.admin_google_display_sessions'::regclass
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
  'every Google Display root foreign key has a full leading index'
);

SELECT has_table(
  'private', 'admin_google_pdf_publication_bindings',
  'C2 stores immutable Google PDF publication provenance privately'
);
SELECT has_table(
  'private', 'admin_google_pdf_publication_tickets',
  'C2 stores hash-only PDF ticket issuance evidence privately'
);
SELECT has_table(
  'private', 'admin_google_pdf_publication_continuations',
  'C2 stores bounded PDF finalize continuations privately'
);
SELECT is(
  (
    SELECT count(*)::integer
    FROM private.admin_google_pdf_publication_bindings
  ) + (
    SELECT count(*)::integer
    FROM private.admin_google_pdf_publication_tickets
  ) + (
    SELECT count(*)::integer
    FROM private.admin_google_pdf_publication_continuations
  ),
  0,
  'the migration neither backfills nor infers Google PDF publication evidence'
);
SELECT ok(
  NOT EXISTS (
    SELECT 1
    FROM (VALUES
      ('admin_google_pdf_publication_bindings'),
      ('admin_google_pdf_publication_tickets'),
      ('admin_google_pdf_publication_continuations')
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
  'Google PDF evidence tables enable RLS and deny every runtime role direct access'
);
SELECT ok(
  NOT EXISTS (
    SELECT 1
    FROM pg_constraint AS foreign_key
    WHERE foreign_key.contype = 'f'
      AND foreign_key.conrelid IN (
        'private.admin_google_pdf_publication_bindings'::regclass,
        'private.admin_google_pdf_publication_tickets'::regclass,
        'private.admin_google_pdf_publication_continuations'::regclass
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
  'every Google PDF evidence foreign key has a full leading index'
);

CREATE TEMP TABLE c2_operational_private_functions(
  signature text PRIMARY KEY
) ON COMMIT DROP;
INSERT INTO c2_operational_private_functions(signature) VALUES
  ('private.abort_google_admin_pdf_publication_v1(text,uuid,uuid,text,text,integer,boolean,uuid,uuid,uuid,text)'),
  ('private.advance_google_admin_pdf_publication_v1(text,uuid,uuid,text,text,integer,boolean,uuid,uuid,text,uuid,uuid,uuid,bigint,text,boolean,text,text,text,bigint,bigint,text)'),
  ('private.get_google_admin_pdf_publication_v1(text,uuid,uuid,text,text,integer,boolean,text,uuid,uuid)'),
  ('private.get_google_admin_ai_control_configuration_intent_v1(text,uuid,uuid,text,text,integer,uuid,uuid,jsonb,boolean)'),
  ('private.google_admin_ai_control_payload_digest_v1(text,uuid,jsonb,text)'),
  ('private.issue_google_admin_display_session_v1(text,uuid,uuid,text,text,integer,boolean,uuid,uuid,boolean)'),
  ('private.issue_google_admin_pdf_publication_ticket_v1(text,uuid,uuid,text,text,integer,boolean,uuid,uuid,integer,uuid,text,text,bigint,integer,integer,text,text,boolean,text,text,text)'),
  ('private.manage_google_admin_ai_control_v1(text,uuid,uuid,text,text,integer,text,uuid,uuid,uuid,jsonb,text,text,boolean)'),
  ('private.manage_google_admin_ai_master_v1(text,uuid,uuid,text,text,integer,text,uuid,uuid,text,boolean)'),
  ('private.manage_google_admin_presenter_connection_v1(text,uuid,uuid,text,text,integer,boolean,boolean,uuid,text,uuid,uuid,text,text,text)'),
  ('private.normalize_google_admin_ai_control_configuration_v1(text,jsonb)'),
  ('private.prepare_google_admin_pdf_publication_finalize_v1(text,uuid,uuid,text,text,integer,boolean,uuid,uuid,uuid,uuid,uuid,integer)'),
  ('private.verify_and_claim_google_display_session_v1(text,uuid,uuid)');
SELECT ok(
  NOT EXISTS (
    SELECT 1
    FROM c2_operational_private_functions AS expected
    WHERE has_function_privilege('service_role', expected.signature, 'EXECUTE')
      OR has_function_privilege('anon', expected.signature, 'EXECUTE')
      OR has_function_privilege('authenticated', expected.signature, 'EXECUTE')
  ),
  'C2 operational internals remain non-executable by runtime roles'
);

CREATE TEMP TABLE c2_operational_public_functions(
  signature text PRIMARY KEY
) ON COMMIT DROP;
INSERT INTO c2_operational_public_functions(signature) VALUES
  ('public.abort_google_admin_pdf_publication_v1(text,uuid,uuid,text,text,integer,boolean,uuid,uuid,uuid,text)'),
  ('public.advance_google_admin_pdf_publication_v1(text,uuid,uuid,text,text,integer,boolean,uuid,uuid,text,uuid,uuid,uuid,bigint,text,boolean,text,text,text,bigint,bigint,text)'),
  ('public.get_google_admin_pdf_publication_v1(text,uuid,uuid,text,text,integer,boolean,text,uuid,uuid)'),
  ('public.get_google_admin_ai_control_configuration_intent_v1(text,uuid,uuid,text,text,integer,uuid,uuid,jsonb,boolean)'),
  ('public.issue_google_admin_display_session_v1(text,uuid,uuid,text,text,integer,boolean,uuid,uuid,boolean)'),
  ('public.issue_google_admin_pdf_publication_ticket_v1(text,uuid,uuid,text,text,integer,boolean,uuid,uuid,integer,uuid,text,text,bigint,integer,integer,text,text,boolean,text,text,text)'),
  ('public.manage_google_admin_ai_control_v1(text,uuid,uuid,text,text,integer,text,uuid,uuid,uuid,jsonb,text,text,boolean)'),
  ('public.manage_google_admin_ai_master_v1(text,uuid,uuid,text,text,integer,text,uuid,uuid,text,boolean)'),
  ('public.manage_google_admin_presenter_connection_v1(text,uuid,uuid,text,text,integer,boolean,boolean,uuid,text,uuid,uuid,text,text,text)'),
  ('public.prepare_google_admin_pdf_publication_finalize_v1(text,uuid,uuid,text,text,integer,boolean,uuid,uuid,uuid,uuid,uuid,integer)'),
  ('public.verify_and_claim_google_display_session_v1(text,uuid,uuid)');
SELECT is(
  (
    SELECT count(*)::integer
    FROM c2_operational_public_functions AS expected
    JOIN pg_proc AS procedure
      ON procedure.oid = expected.signature::regprocedure
    WHERE pg_get_userbyid(procedure.proowner) = 'postgres'
      AND procedure.prosecdef
      AND procedure.proconfig @> ARRAY['search_path=""']::text[]
  ),
  11,
  'C2 operational public facades are postgres-owned with an empty search_path'
);
SELECT ok(
  NOT EXISTS (
    SELECT 1
    FROM c2_operational_public_functions AS expected
    WHERE NOT has_function_privilege(
      'service_role', expected.signature, 'EXECUTE'
    )
      OR has_function_privilege('anon', expected.signature, 'EXECUTE')
      OR has_function_privilege('authenticated', expected.signature, 'EXECUTE')
  ),
  'only service_role can execute C2 operational public facades'
);

INSERT INTO auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) VALUES (
  '00000000-0000-0000-0000-000000000000'::uuid,
  '00000000-0000-4000-8000-00000000d202'::uuid,
  'authenticated', 'authenticated', 'phase730c2-display@example.test', '',
  statement_timestamp() - interval '1 hour',
  '{"provider":"google","providers":["google"]}'::jsonb, '{}'::jsonb,
  statement_timestamp() - interval '1 hour',
  statement_timestamp() - interval '1 hour'
);
INSERT INTO auth.sessions (id, user_id, created_at, updated_at) VALUES (
  '00000000-0000-4000-8000-00000000d203'::uuid,
  '00000000-0000-4000-8000-00000000d202'::uuid,
  statement_timestamp() - interval '1 hour',
  statement_timestamp() - interval '1 hour'
);
INSERT INTO auth.mfa_factors (
  id, user_id, friendly_name, factor_type, status, created_at, updated_at
) VALUES (
  '00000000-0000-4000-8000-00000000d204'::uuid,
  '00000000-0000-4000-8000-00000000d202'::uuid,
  'phase730c2-display-totp', 'totp', 'verified',
  statement_timestamp() - interval '1 hour',
  statement_timestamp() - interval '1 hour'
);

INSERT INTO private.admin_environments (
  id, environment_kind, canonical_admin_origin, supabase_issuer,
  current_deployment, bootstrap_sealed_at, owner_invariant_enforced_at
) VALUES (
  '00000000-0000-4000-8000-00000000d201'::uuid,
  'local', 'http://127.0.0.1:5173',
  'http://127.0.0.1:54321/auth/v1', true,
  statement_timestamp() - interval '1 hour',
  statement_timestamp() - interval '1 hour'
);
INSERT INTO private.admin_principals (
  id, auth_user_id, google_issuer, provider_subject_hmac,
  subject_pepper_version, normalized_email, email_verified_at
) VALUES (
  '00000000-0000-4000-8000-00000000d205'::uuid,
  '00000000-0000-4000-8000-00000000d202'::uuid,
  'https://accounts.google.com', repeat('a', 64), 1,
  'phase730c2-display@example.test', statement_timestamp() - interval '1 hour'
);
UPDATE private.admin_principals
SET
  approved_totp_factor_set_hash = snapshot.factor_set_hash,
  approved_totp_factor_set_version = 1,
  approved_totp_factor_count = snapshot.factor_count,
  approved_totp_factor_set_at = statement_timestamp() - interval '30 minutes',
  approved_totp_factor_set_request_id =
    '00000000-0000-4000-8000-00000000d20b'::uuid,
  approved_totp_factor_set_source = 'operator_adoption',
  approved_totp_factor_set_actor = 'fixture:phase730c2-display',
  approved_totp_factor_set_reason = 'C2 Display runtime fixture'
FROM private.current_verified_totp_factor_set_snapshot_v1(
  '00000000-0000-4000-8000-00000000d202'::uuid
) AS snapshot
WHERE id = '00000000-0000-4000-8000-00000000d205'::uuid;
INSERT INTO private.admin_environment_memberships (
  id, environment_id, principal_id, role, status, can_use_ai, activated_at
) VALUES (
  '00000000-0000-4000-8000-00000000d206'::uuid,
  '00000000-0000-4000-8000-00000000d201'::uuid,
  '00000000-0000-4000-8000-00000000d205'::uuid,
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
  '00000000-0000-4000-8000-00000000d207'::uuid,
  repeat('2', 64),
  '00000000-0000-4000-8000-00000000d208'::uuid,
  '00000000-0000-4000-8000-00000000d201'::uuid,
  '00000000-0000-4000-8000-00000000d205'::uuid,
  '00000000-0000-4000-8000-00000000d206'::uuid,
  '00000000-0000-4000-8000-00000000d203'::uuid,
  'admin_login',
  '00000000-0000-4000-8000-00000000d20c'::uuid,
  repeat('3', 64), statement_timestamp() - interval '1 minute',
  '00000000-0000-4000-8000-00000000d204'::uuid,
  private.current_verified_totp_factor_set_hash_v1(
    '00000000-0000-4000-8000-00000000d202'::uuid
  ),
  private.current_verified_totp_factor_set_hash_v1(
    '00000000-0000-4000-8000-00000000d202'::uuid
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
  '00000000-0000-4000-8000-00000000d208'::uuid,
  repeat('1', 64),
  '00000000-0000-4000-8000-00000000d202'::uuid,
  null, 'google_totp', 2,
  '00000000-0000-4000-8000-00000000d205'::uuid,
  '00000000-0000-4000-8000-00000000d206'::uuid,
  '00000000-0000-4000-8000-00000000d201'::uuid,
  '00000000-0000-4000-8000-00000000d203'::uuid,
  statement_timestamp(),
  '00000000-0000-4000-8000-00000000d207'::uuid,
  private.current_verified_totp_factor_set_hash_v1(
    '00000000-0000-4000-8000-00000000d202'::uuid
  ),
  statement_timestamp() - interval '1 hour',
  statement_timestamp() - interval '1 hour',
  statement_timestamp() + interval '12 hours',
  statement_timestamp() + interval '12 hours'
);
UPDATE private.admin_step_up_nonces
SET
  status = 'consumed',
  consumed_at = statement_timestamp(),
  completed_admin_session_id = '00000000-0000-4000-8000-00000000d208'::uuid,
  updated_at = statement_timestamp()
WHERE id = '00000000-0000-4000-8000-00000000d207'::uuid;
UPDATE private.admin_identity_runtime_gate
SET google_session_issue_enabled = false
WHERE singleton;

INSERT INTO public.lecture_sessions (
  id, title, code_hash, status, starts_at, started_at, hard_stop_at, ends_at
) VALUES (
  '00000000-0000-4000-8000-00000000d209'::uuid,
  'C2 Google Display', repeat('d', 64), 'open',
  statement_timestamp() - interval '5 minutes',
  statement_timestamp() - interval '5 minutes',
  statement_timestamp() + interval '1 hour',
  statement_timestamp() + interval '1 hour'
);
INSERT INTO private.admin_lecture_ownerships (
  lecture_session_id, environment_id, principal_id, membership_id,
  assigned_by_admin_session_id, ownership_request_id, ownership_intent_digest
) VALUES (
  '00000000-0000-4000-8000-00000000d209'::uuid,
  '00000000-0000-4000-8000-00000000d201'::uuid,
  '00000000-0000-4000-8000-00000000d205'::uuid,
  '00000000-0000-4000-8000-00000000d206'::uuid,
  '00000000-0000-4000-8000-00000000d208'::uuid,
  '00000000-0000-4000-8000-00000000d20d'::uuid,
  repeat('9', 64)
);

SET ROLE service_role;
SELECT throws_ok(
  $$
    SELECT public.issue_google_admin_display_session_v1(
      repeat('1', 64),
      '00000000-0000-4000-8000-00000000d202'::uuid,
      '00000000-0000-4000-8000-00000000d203'::uuid,
      'https://accounts.google.com', repeat('a', 64), 1, true,
      '00000000-0000-4000-8000-00000000d210'::uuid,
      '00000000-0000-4000-8000-00000000d209'::uuid,
      false
    )
  $$,
  'P7337',
  'Google Admin operational authorization is disabled',
  'default-OFF rejects new Google Display authority'
);
RESET ROLE;

UPDATE private.admin_identity_runtime_gate
SET google_operational_authorization_enabled = true
WHERE singleton;
SET ROLE service_role;
SELECT is(
  public.issue_google_admin_display_session_v1(
    repeat('1', 64),
    '00000000-0000-4000-8000-00000000d202'::uuid,
    '00000000-0000-4000-8000-00000000d203'::uuid,
    'https://accounts.google.com', repeat('a', 64), 1, true,
    '00000000-0000-4000-8000-00000000d210'::uuid,
    '00000000-0000-4000-8000-00000000d209'::uuid,
    false
  ) ->> 'idempotentReplay',
  'false',
  'Google Admin issues one snapshot-only Display root without extra MFA'
);
RESET ROLE;
SELECT is(
  (SELECT count(*)::integer FROM private.admin_google_display_sessions),
  1,
  'successful issuance creates exactly one root binding'
);
SELECT is(
  (
    SELECT result_metadata ? 'displayToken'
      OR result_metadata ? 'token'
      OR result_metadata ? 'jti'
    FROM private.admin_google_operation_receipts
    WHERE request_id = '00000000-0000-4000-8000-00000000d210'::uuid
  ),
  false,
  'Display receipt stores no raw signed token or token identifier'
);

UPDATE private.admin_identity_runtime_gate
SET google_operational_authorization_enabled = false
WHERE singleton;
SET ROLE service_role;
SELECT is(
  public.issue_google_admin_display_session_v1(
    repeat('1', 64),
    '00000000-0000-4000-8000-00000000d202'::uuid,
    '00000000-0000-4000-8000-00000000d203'::uuid,
    'https://accounts.google.com', repeat('a', 64), 1, true,
    '00000000-0000-4000-8000-00000000d210'::uuid,
    '00000000-0000-4000-8000-00000000d209'::uuid,
    false
  ) ->> 'idempotentReplay',
  'true',
  'lost-response replay converges after the operational gate is disabled'
);
SELECT throws_ok(
  $$
    SELECT public.issue_google_admin_display_session_v1(
      repeat('1', 64),
      '00000000-0000-4000-8000-00000000d202'::uuid,
      '00000000-0000-4000-8000-00000000d203'::uuid,
      'https://accounts.google.com', repeat('a', 64), 1, true,
      '00000000-0000-4000-8000-00000000d210'::uuid,
      '00000000-0000-4000-8000-00000000d209'::uuid,
      true
    )
  $$,
  'P7335',
  'Display-session request binding does not match its receipt',
  'the same request cannot switch snapshot authority to Realtime'
);
SELECT is(
  public.verify_and_claim_google_display_session_v1(
    encode(
      extensions.digest(
        convert_to('00000000-0000-4000-8000-00000000d210', 'UTF8'),
        'sha256'
      ),
      'hex'
    ),
    '00000000-0000-4000-8000-00000000d209'::uuid,
    '00000000-0000-4000-8000-00000000d220'::uuid
  ) ->> 'valid',
  'true',
  'the first Display browser atomically claims the live root binding'
);
SELECT is(
  public.verify_and_claim_google_display_session_v1(
    encode(
      extensions.digest(
        convert_to('00000000-0000-4000-8000-00000000d210', 'UTF8'),
        'sha256'
      ),
      'hex'
    ),
    '00000000-0000-4000-8000-00000000d209'::uuid,
    '00000000-0000-4000-8000-00000000d221'::uuid
  ) ->> 'reason',
  'claimed_by_other',
  'a different browser cannot take over the claimed Display session'
);
RESET ROLE;

UPDATE private.admin_identity_runtime_gate
SET google_operational_authorization_enabled = true
WHERE singleton;
SET ROLE service_role;
SELECT is(
  public.issue_google_admin_display_session_v1(
    repeat('1', 64),
    '00000000-0000-4000-8000-00000000d202'::uuid,
    '00000000-0000-4000-8000-00000000d203'::uuid,
    'https://accounts.google.com', repeat('a', 64), 1, true,
    '00000000-0000-4000-8000-00000000d211'::uuid,
    '00000000-0000-4000-8000-00000000d209'::uuid,
    true
  ) ->> 'idempotentReplay',
  'false',
  'Google Admin can issue a Realtime Display binding without another MFA prompt'
);
SELECT is(
  public.verify_and_claim_google_display_session_v1(
    encode(
      extensions.digest(
        convert_to('00000000-0000-4000-8000-00000000d211', 'UTF8'),
        'sha256'
      ),
      'hex'
    ),
    '00000000-0000-4000-8000-00000000d209'::uuid,
    '00000000-0000-4000-8000-00000000d222'::uuid
  ) ->> 'valid',
  'true',
  'the unified verifier atomically claims the public and private Realtime bindings'
);
RESET ROLE;
SELECT is(
  (
    SELECT display_auth_user_id
    FROM public.display_realtime_sessions
    WHERE id = '00000000-0000-4000-8000-00000000d211'::uuid
  ),
  '00000000-0000-4000-8000-00000000d222'::uuid,
  'the public Realtime binding records the claiming Display browser'
);
SELECT is(
  (
    SELECT display_auth_user_id
    FROM private.admin_google_display_sessions
    WHERE id = '00000000-0000-4000-8000-00000000d211'::uuid
  ),
  '00000000-0000-4000-8000-00000000d222'::uuid,
  'the private Google root records the same Display browser'
);

SET ROLE service_role;
SELECT is(
  public.set_display_realtime_runtime_v1(false),
  1,
  'disabling Realtime downgrades the one live Google Display binding'
);
SELECT is(
  public.verify_and_claim_google_display_session_v1(
    encode(
      extensions.digest(
        convert_to('00000000-0000-4000-8000-00000000d211', 'UTF8'),
        'sha256'
      ),
      'hex'
    ),
    '00000000-0000-4000-8000-00000000d209'::uuid,
    '00000000-0000-4000-8000-00000000d222'::uuid
  ) ->> 'realtimeAvailable',
  'false',
  'the same browser retains snapshot access while Realtime is disabled'
);
SELECT is(
  public.set_display_realtime_runtime_v1(true),
  0,
  'reenabling Realtime does not silently resurrect a downgraded binding'
);
SELECT is(
  public.verify_and_claim_google_display_session_v1(
    encode(
      extensions.digest(
        convert_to('00000000-0000-4000-8000-00000000d211', 'UTF8'),
        'sha256'
      ),
      'hex'
    ),
    '00000000-0000-4000-8000-00000000d209'::uuid,
    '00000000-0000-4000-8000-00000000d222'::uuid
  ) ->> 'valid',
  'false',
  'a downgraded Realtime binding stays invalid after the gate is reenabled'
);
SELECT is(
  public.issue_google_admin_display_session_v1(
    repeat('1', 64),
    '00000000-0000-4000-8000-00000000d202'::uuid,
    '00000000-0000-4000-8000-00000000d203'::uuid,
    'https://accounts.google.com', repeat('a', 64), 1, true,
    '00000000-0000-4000-8000-00000000d212'::uuid,
    '00000000-0000-4000-8000-00000000d209'::uuid,
    true
  ) ->> 'idempotentReplay',
  'false',
  'a fresh request creates the replacement Realtime Display binding'
);
SELECT is(
  public.verify_and_claim_google_display_session_v1(
    encode(
      extensions.digest(
        convert_to('00000000-0000-4000-8000-00000000d211', 'UTF8'),
        'sha256'
      ),
      'hex'
    ),
    '00000000-0000-4000-8000-00000000d209'::uuid,
    '00000000-0000-4000-8000-00000000d222'::uuid
  ) ->> 'valid',
  'false',
  'replacement permanently invalidates the prior Google Display root'
);
RESET ROLE;

SET ROLE service_role;
SELECT lives_ok(
  $$
    SELECT public.admin_register_pdf_document(
      '00000000-0000-4000-8000-00000000d209'::uuid,
      'phase730c2-presenter-doc', repeat('d', 64), 1,
      'C2 Presenter material', 3, 3000, 300,
      repeat('d', 64), repeat('f', 64), true
    )
  $$,
  'Presenter fixture registers bounded PDF metadata'
);
SELECT lives_ok(
  $$
    SELECT * FROM public.admin_update_pdf_display_v3(
      '00000000-0000-4000-8000-00000000d209'::uuid,
      'phase730c2-presenter-doc', repeat('d', 64), 1, 3,
      true, 1, 'normal'
    )
  $$,
  'Presenter fixture selects a visible lecture PDF'
);
SELECT throws_ok(
  $$
    SELECT public.manage_google_admin_presenter_connection_v1(
      repeat('1', 64),
      '00000000-0000-4000-8000-00000000d202'::uuid,
      '00000000-0000-4000-8000-00000000d203'::uuid,
      'https://accounts.google.com', repeat('a', 64), 1,
      true, true,
      '00000000-0000-4000-8000-00000000d213'::uuid,
      'issue',
      '00000000-0000-4000-8000-00000000d209'::uuid,
      null,
      encode(
        extensions.digest(
          convert_to('00000000-0000-4000-8000-00000000d213', 'UTF8'),
          'sha256'
        ),
        'hex'
      ),
      repeat('b', 64),
      'http://127.0.0.1:5173'
    )
  $$,
  'P7290',
  'Presenter integration is disabled',
  'Presenter admission remains default-OFF independently of C2 identity'
);
SELECT is(
  public.set_presenter_runtime_v1(true) ->> 'enabled',
  'true',
  'the explicit Presenter runtime gate enables the local fixture'
);
SELECT is(
  public.manage_google_admin_presenter_connection_v1(
    repeat('1', 64),
    '00000000-0000-4000-8000-00000000d202'::uuid,
    '00000000-0000-4000-8000-00000000d203'::uuid,
    'https://accounts.google.com', repeat('a', 64), 1,
    true, true,
    '00000000-0000-4000-8000-00000000d213'::uuid,
    'issue',
    '00000000-0000-4000-8000-00000000d209'::uuid,
    null,
    encode(
      extensions.digest(
        convert_to('00000000-0000-4000-8000-00000000d213', 'UTF8'),
        'sha256'
      ),
      'hex'
    ),
    repeat('b', 64),
    'http://127.0.0.1:5173'
  ) ->> 'connectionId',
  '00000000-0000-4000-8000-00000000d213',
  'Google Admin prepares Presenter pairing without another MFA prompt'
);
RESET ROLE;
SELECT ok(
  (
    SELECT result_metadata ? 'connectionId'
      AND NOT (
        result_metadata ? 'manualCode'
        OR result_metadata ? 'pairingTicket'
        OR result_metadata ? 'ticketJti'
      )
    FROM private.admin_google_operation_receipts
    WHERE request_id = '00000000-0000-4000-8000-00000000d213'::uuid
  ),
  'Presenter receipt stores bounded identifiers and no raw pairing credential'
);

UPDATE private.admin_identity_runtime_gate
SET google_operational_authorization_enabled = false
WHERE singleton;
SET ROLE service_role;
SELECT is(
  public.manage_google_admin_presenter_connection_v1(
    repeat('1', 64),
    '00000000-0000-4000-8000-00000000d202'::uuid,
    '00000000-0000-4000-8000-00000000d203'::uuid,
    'https://accounts.google.com', repeat('a', 64), 1,
    false, false,
    '00000000-0000-4000-8000-00000000d213'::uuid,
    'issue',
    '00000000-0000-4000-8000-00000000d209'::uuid,
    null,
    encode(
      extensions.digest(
        convert_to('00000000-0000-4000-8000-00000000d213', 'UTF8'),
        'sha256'
      ),
      'hex'
    ),
    repeat('b', 64),
    'http://127.0.0.1:5173'
  ) ->> 'idempotentReplay',
  'true',
  'lost Presenter issue response converges while admission is disabled'
);
RESET ROLE;

UPDATE private.admin_identity_runtime_gate
SET google_operational_authorization_enabled = true
WHERE singleton;
UPDATE public.presenter_connections
SET
  state = 'inspected',
  installation_hash = repeat('c', 64),
  inspected_at = statement_timestamp(),
  pptx_file_sha256 = repeat('d', 64),
  slide_id_order_sha256 = repeat('e', 64),
  slide_count = 3,
  hidden_slide_count = 0,
  custom_show_active = false,
  updated_at = statement_timestamp()
WHERE id = '00000000-0000-4000-8000-00000000d213'::uuid;
SET ROLE service_role;
SELECT is(
  public.manage_google_admin_presenter_connection_v1(
    repeat('1', 64),
    '00000000-0000-4000-8000-00000000d202'::uuid,
    '00000000-0000-4000-8000-00000000d203'::uuid,
    'https://accounts.google.com', repeat('a', 64), 1,
    true, true,
    '00000000-0000-4000-8000-00000000d214'::uuid,
    'confirm', null,
    '00000000-0000-4000-8000-00000000d213'::uuid,
    null, null, null
  ) ->> 'state',
  'confirmed',
  'Google Admin confirms the inspected Presenter connection atomically'
);
RESET ROLE;

UPDATE private.admin_identity_runtime_gate
SET google_operational_authorization_enabled = false
WHERE singleton;
SET ROLE service_role;
SELECT is(
  public.manage_google_admin_presenter_connection_v1(
    repeat('1', 64),
    '00000000-0000-4000-8000-00000000d202'::uuid,
    '00000000-0000-4000-8000-00000000d203'::uuid,
    'https://accounts.google.com', repeat('a', 64), 1,
    false, false, null,
    'status',
    '00000000-0000-4000-8000-00000000d209'::uuid,
    null, null, null, null
  ) ->> 'runtime_enabled',
  'false',
  'Presenter status remains available and reports disabled admission'
);
SELECT is(
  public.manage_google_admin_presenter_connection_v1(
    repeat('1', 64),
    '00000000-0000-4000-8000-00000000d202'::uuid,
    '00000000-0000-4000-8000-00000000d203'::uuid,
    'https://accounts.google.com', repeat('a', 64), 1,
    false, false,
    '00000000-0000-4000-8000-00000000d215'::uuid,
    'revoke', null,
    '00000000-0000-4000-8000-00000000d213'::uuid,
    null, null, null
  ) ->> 'state',
  'revoked',
  'Presenter stop remains available while both admission flags are OFF'
);
RESET ROLE;

SET ROLE service_role;
SELECT throws_ok(
  $$
    SELECT public.issue_google_admin_pdf_publication_ticket_v1(
      repeat('1', 64),
      '00000000-0000-4000-8000-00000000d202'::uuid,
      '00000000-0000-4000-8000-00000000d203'::uuid,
      'https://accounts.google.com', repeat('a', 64), 1, false,
      '00000000-0000-4000-8000-00000000d230'::uuid,
      '00000000-0000-4000-8000-00000000d231'::uuid,
      1,
      '00000000-0000-4000-8000-00000000d209'::uuid,
      'c2-pdf', repeat('b', 64), 2048, 2, 100, repeat('c', 64),
      'C2 handout', true, 'http://127.0.0.1:5173',
      repeat('d', 64), repeat('e', 64)
    )
  $$,
  'P7337',
  'Google Admin operational authorization is disabled',
  'default-OFF rejects new Google PDF upload authority'
);
RESET ROLE;

UPDATE private.admin_identity_runtime_gate
SET google_operational_authorization_enabled = true
WHERE singleton;
SET ROLE service_role;
SELECT is(
  public.issue_google_admin_pdf_publication_ticket_v1(
    repeat('1', 64),
    '00000000-0000-4000-8000-00000000d202'::uuid,
    '00000000-0000-4000-8000-00000000d203'::uuid,
    'https://accounts.google.com', repeat('a', 64), 1, true,
    '00000000-0000-4000-8000-00000000d230'::uuid,
    '00000000-0000-4000-8000-00000000d231'::uuid,
    1,
    '00000000-0000-4000-8000-00000000d209'::uuid,
    'c2-pdf', repeat('b', 64), 2048, 2, 100, repeat('c', 64),
    'C2 handout', true, 'http://127.0.0.1:5173',
    repeat('d', 64), repeat('e', 64)
  ) ->> 'idempotentReplay',
  'false',
  'Google Admin creates one provenance-bound PDF upload without another MFA prompt'
);
RESET ROLE;

SELECT set_config(
  'test.c2_pdf_publication_id',
  (
    SELECT publication_id::text
    FROM private.admin_google_pdf_publication_bindings
    WHERE publication_request_id =
      '00000000-0000-4000-8000-00000000d230'::uuid
  ),
  false
);
SELECT is(
  (
    SELECT count(*)::integer
    FROM private.admin_google_pdf_publication_tickets
    WHERE ticket_request_id =
      '00000000-0000-4000-8000-00000000d231'::uuid
      AND nonce_hash = repeat('d', 64)
      AND ticket_jti_hash = repeat('e', 64)
  ),
  1,
  'PDF ticket evidence persists only the expected hashes and one generation'
);

UPDATE private.admin_identity_runtime_gate
SET google_operational_authorization_enabled = false
WHERE singleton;
SET ROLE service_role;
SELECT is(
  public.issue_google_admin_pdf_publication_ticket_v1(
    repeat('1', 64),
    '00000000-0000-4000-8000-00000000d202'::uuid,
    '00000000-0000-4000-8000-00000000d203'::uuid,
    'https://accounts.google.com', repeat('a', 64), 1, false,
    '00000000-0000-4000-8000-00000000d230'::uuid,
    '00000000-0000-4000-8000-00000000d231'::uuid,
    1,
    '00000000-0000-4000-8000-00000000d209'::uuid,
    'c2-pdf', repeat('b', 64), 2048, 2, 100, repeat('c', 64),
    'C2 handout', true, 'http://127.0.0.1:5173',
    repeat('d', 64), repeat('e', 64)
  ) ->> 'idempotentReplay',
  'true',
  'lost PDF ticket response converges while new admission is disabled'
);
RESET ROLE;

INSERT INTO auth.sessions (id, user_id, created_at, updated_at) VALUES (
  '00000000-0000-4000-8000-00000000d236'::uuid,
  '00000000-0000-4000-8000-00000000d202'::uuid,
  statement_timestamp(), statement_timestamp()
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
  '00000000-0000-4000-8000-00000000d237'::uuid,
  repeat('6', 64),
  '00000000-0000-4000-8000-00000000d238'::uuid,
  '00000000-0000-4000-8000-00000000d201'::uuid,
  '00000000-0000-4000-8000-00000000d205'::uuid,
  '00000000-0000-4000-8000-00000000d206'::uuid,
  '00000000-0000-4000-8000-00000000d236'::uuid,
  'admin_login',
  '00000000-0000-4000-8000-00000000d239'::uuid,
  repeat('7', 64), statement_timestamp() - interval '1 minute',
  '00000000-0000-4000-8000-00000000d204'::uuid,
  private.current_verified_totp_factor_set_hash_v1(
    '00000000-0000-4000-8000-00000000d202'::uuid
  ),
  private.current_verified_totp_factor_set_hash_v1(
    '00000000-0000-4000-8000-00000000d202'::uuid
  ),
  false, 1, repeat('8', 64), statement_timestamp(),
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
  '00000000-0000-4000-8000-00000000d238'::uuid,
  repeat('5', 64),
  '00000000-0000-4000-8000-00000000d202'::uuid,
  null, 'google_totp', 2,
  '00000000-0000-4000-8000-00000000d205'::uuid,
  '00000000-0000-4000-8000-00000000d206'::uuid,
  '00000000-0000-4000-8000-00000000d201'::uuid,
  '00000000-0000-4000-8000-00000000d236'::uuid,
  statement_timestamp(),
  '00000000-0000-4000-8000-00000000d237'::uuid,
  private.current_verified_totp_factor_set_hash_v1(
    '00000000-0000-4000-8000-00000000d202'::uuid
  ),
  statement_timestamp(), statement_timestamp(),
  statement_timestamp() + interval '12 hours',
  statement_timestamp() + interval '12 hours'
);
UPDATE private.admin_step_up_nonces
SET
  status = 'consumed',
  consumed_at = statement_timestamp(),
  completed_admin_session_id =
    '00000000-0000-4000-8000-00000000d238'::uuid,
  updated_at = statement_timestamp()
WHERE id = '00000000-0000-4000-8000-00000000d237'::uuid;
UPDATE private.admin_identity_runtime_gate
SET google_session_issue_enabled = false
WHERE singleton;

SET ROLE service_role;
SELECT throws_ok(
  format(
    $sql$
      SELECT public.prepare_google_admin_pdf_publication_finalize_v1(
        repeat('5', 64),
        '00000000-0000-4000-8000-00000000d202'::uuid,
        '00000000-0000-4000-8000-00000000d236'::uuid,
        'https://accounts.google.com', repeat('a', 64), 1, false,
        '00000000-0000-4000-8000-00000000d232'::uuid,
        '00000000-0000-4000-8000-00000000d209'::uuid,
        %L::uuid,
        '00000000-0000-4000-8000-00000000d233'::uuid,
        '00000000-0000-4000-8000-00000000d234'::uuid,
        1
      )
    $sql$,
    current_setting('test.c2_pdf_publication_id')
  ),
  'P7337',
  'Google Admin operational authorization is disabled',
  'disabled admission rejects a new PDF finalize continuation'
);
RESET ROLE;

UPDATE private.admin_identity_runtime_gate
SET google_operational_authorization_enabled = true
WHERE singleton;
SET ROLE service_role;
SELECT is(
  public.prepare_google_admin_pdf_publication_finalize_v1(
    repeat('5', 64),
    '00000000-0000-4000-8000-00000000d202'::uuid,
    '00000000-0000-4000-8000-00000000d236'::uuid,
    'https://accounts.google.com', repeat('a', 64), 1, true,
    '00000000-0000-4000-8000-00000000d232'::uuid,
    '00000000-0000-4000-8000-00000000d209'::uuid,
    current_setting('test.c2_pdf_publication_id')::uuid,
    '00000000-0000-4000-8000-00000000d233'::uuid,
    '00000000-0000-4000-8000-00000000d234'::uuid,
    1
  ) ->> 'idempotentReplay',
  'false',
  'Google Admin authorizes one bounded PDF finalize continuation'
);
RESET ROLE;
SELECT is(
  (
    SELECT binding.admin_session_id
    FROM private.admin_google_pdf_publication_bindings AS binding
    WHERE binding.publication_id =
      current_setting('test.c2_pdf_publication_id')::uuid
  ),
  '00000000-0000-4000-8000-00000000d208'::uuid,
  'PDF creation provenance remains bound to the original Admin session'
);
SELECT is(
  (
    SELECT continuation.admin_session_id
    FROM private.admin_google_pdf_publication_continuations AS continuation
    WHERE continuation.finalize_request_id =
      '00000000-0000-4000-8000-00000000d232'::uuid
  ),
  '00000000-0000-4000-8000-00000000d238'::uuid,
  'the same principal can recover PDF finalization in a new live session'
);

UPDATE private.admin_identity_runtime_gate
SET google_operational_authorization_enabled = false
WHERE singleton;
SET ROLE service_role;
SELECT is(
  public.prepare_google_admin_pdf_publication_finalize_v1(
    repeat('5', 64),
    '00000000-0000-4000-8000-00000000d202'::uuid,
    '00000000-0000-4000-8000-00000000d236'::uuid,
    'https://accounts.google.com', repeat('a', 64), 1, false,
    '00000000-0000-4000-8000-00000000d232'::uuid,
    '00000000-0000-4000-8000-00000000d209'::uuid,
    current_setting('test.c2_pdf_publication_id')::uuid,
    '00000000-0000-4000-8000-00000000d233'::uuid,
    '00000000-0000-4000-8000-00000000d234'::uuid,
    1
  ) ->> 'idempotentReplay',
  'true',
  'lost finalize authorization converges after admission is disabled'
);
SELECT is(
  public.abort_google_admin_pdf_publication_v1(
    repeat('5', 64),
    '00000000-0000-4000-8000-00000000d202'::uuid,
    '00000000-0000-4000-8000-00000000d236'::uuid,
    'https://accounts.google.com', repeat('a', 64), 1, false,
    '00000000-0000-4000-8000-00000000d235'::uuid,
    '00000000-0000-4000-8000-00000000d209'::uuid,
    current_setting('test.c2_pdf_publication_id')::uuid,
    'admin_cancelled'
  ) ->> 'state',
  'aborted',
  'PDF cancel remains available while admission is disabled'
);
SELECT is(
  public.abort_google_admin_pdf_publication_v1(
    repeat('5', 64),
    '00000000-0000-4000-8000-00000000d202'::uuid,
    '00000000-0000-4000-8000-00000000d236'::uuid,
    'https://accounts.google.com', repeat('a', 64), 1, false,
    '00000000-0000-4000-8000-00000000d235'::uuid,
    '00000000-0000-4000-8000-00000000d209'::uuid,
    current_setting('test.c2_pdf_publication_id')::uuid,
    'admin_cancelled'
  ) ->> 'idempotentReplay',
  'true',
  'lost PDF cancel response converges without reactivating admission'
);
RESET ROLE;

SELECT ok(
  NOT EXISTS (
    SELECT 1
    FROM private.admin_google_operation_receipts
    WHERE request_id IN (
      '00000000-0000-4000-8000-00000000d231'::uuid,
      '00000000-0000-4000-8000-00000000d232'::uuid,
      '00000000-0000-4000-8000-00000000d235'::uuid
    )
      AND result_metadata::text ~* 'token|nonce|secret|url|etag|body|content'
  ),
  'PDF receipts contain no raw ticket, nonce, URL, ETag or document content'
);

UPDATE public.admin_sessions
SET
  revoked_at = statement_timestamp(),
  revoke_reason = 'individual_logout',
  updated_at = statement_timestamp()
WHERE id = '00000000-0000-4000-8000-00000000d208'::uuid;
SET ROLE service_role;
SELECT is(
  public.verify_and_claim_google_display_session_v1(
    encode(
      extensions.digest(
        convert_to('00000000-0000-4000-8000-00000000d210', 'UTF8'),
        'sha256'
      ),
      'hex'
    ),
    '00000000-0000-4000-8000-00000000d209'::uuid,
    '00000000-0000-4000-8000-00000000d220'::uuid
  ) ->> 'reason',
  'inactive',
  'Admin-session revocation immediately invalidates its Display capability'
);
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
