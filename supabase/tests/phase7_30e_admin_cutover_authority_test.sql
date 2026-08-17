BEGIN ISOLATION LEVEL SERIALIZABLE;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path = public, extensions;
SELECT no_plan();

SELECT ok(
  (SELECT legacy_pin_login_enabled
   FROM private.admin_identity_runtime_gate
   WHERE singleton)
  AND NOT EXISTS (
    SELECT 1 FROM private.admin_identity_cutover_receipts
  ),
  'E authority migration applies dormant and creates no cutover tombstone'
);

CREATE TEMP TABLE e_private_evidence_tables(name text PRIMARY KEY)
ON COMMIT DROP;
INSERT INTO e_private_evidence_tables(name) VALUES
  ('admin_lecture_ownership_claim_approvals'),
  ('admin_lecture_ownership_claim_receipts'),
  ('admin_identity_cutover_receipts');

SELECT is(
  (
    SELECT count(*)::integer
    FROM e_private_evidence_tables AS expected
    JOIN pg_class AS class ON class.relname = expected.name
    JOIN pg_namespace AS namespace ON namespace.oid = class.relnamespace
    WHERE namespace.nspname = 'private'
      AND class.relkind = 'r'
  ),
  3,
  'all three E operator evidence tables exist in private'
);

SELECT ok(
  NOT EXISTS (
    SELECT 1
    FROM e_private_evidence_tables AS expected
    JOIN pg_class AS class ON class.relname = expected.name
    JOIN pg_namespace AS namespace ON namespace.oid = class.relnamespace
    WHERE namespace.nspname = 'private'
      AND (
        NOT class.relrowsecurity
        OR EXISTS (
          SELECT 1
          FROM pg_policies AS policy
          WHERE policy.schemaname = 'private'
            AND policy.tablename = expected.name
        )
      )
  ),
  'all E evidence tables are RLS-protected and policy-free'
);

SELECT ok(
  NOT EXISTS (
    SELECT 1
    FROM e_private_evidence_tables AS expected
    CROSS JOIN (VALUES
      ('service_role'),
      ('anon'),
      ('authenticated')
    ) AS role_name(name)
    WHERE has_table_privilege(
      role_name.name,
      format('private.%I', expected.name),
      'SELECT,INSERT,UPDATE,DELETE'
    )
  ),
  'service and browser roles have no direct E evidence-table access'
);

SELECT ok(
  NOT EXISTS (
    SELECT 1
    FROM e_private_evidence_tables AS expected
    JOIN pg_class AS class ON class.relname = expected.name
    JOIN pg_namespace AS namespace ON namespace.oid = class.relnamespace
    WHERE namespace.nspname = 'private'
      AND NOT EXISTS (
        SELECT 1
        FROM pg_trigger AS trigger
        JOIN pg_proc AS procedure ON procedure.oid = trigger.tgfoid
        JOIN pg_namespace AS function_namespace
          ON function_namespace.oid = procedure.pronamespace
        WHERE trigger.tgrelid = class.oid
          AND NOT trigger.tgisinternal
          AND function_namespace.nspname = 'private'
          AND procedure.proname = 'reject_admin_c1_evidence_mutation_v1'
      )
  ),
  'all E evidence tables are append-only'
);

CREATE TEMP TABLE e_operator_functions(signature text PRIMARY KEY)
ON COMMIT DROP;
INSERT INTO e_operator_functions(signature) VALUES
  ('private.approve_google_admin_lecture_ownership_claim_v1(uuid,uuid,uuid,uuid,uuid,uuid,uuid,text,text,text,timestamp with time zone)'),
  ('private.claim_approved_google_admin_lecture_ownership_v1(uuid,uuid)'),
  ('private.commit_google_only_admin_cutover_v1(uuid,uuid,text,text,text)');

SELECT is(
  (
    SELECT count(*)::integer
    FROM e_operator_functions AS expected
    JOIN pg_proc AS procedure
      ON procedure.oid = expected.signature::regprocedure
    JOIN pg_namespace AS namespace ON namespace.oid = procedure.pronamespace
    WHERE namespace.nspname = 'private'
      AND pg_get_userbyid(procedure.proowner) = 'postgres'
      AND procedure.prosecdef
      AND coalesce(
        procedure.proconfig @> ARRAY['search_path=""']::text[],
        false
      )
  ),
  3,
  'all three E authority functions are fixed-path postgres-owned private definers'
);

SELECT ok(
  NOT EXISTS (
    SELECT 1
    FROM e_operator_functions AS expected
    JOIN pg_proc AS procedure
      ON procedure.oid = expected.signature::regprocedure
    WHERE has_function_privilege(
        'service_role', expected.signature, 'EXECUTE'
      )
      OR has_function_privilege('anon', expected.signature, 'EXECUTE')
      OR has_function_privilege(
        'authenticated', expected.signature, 'EXECUTE'
      )
      OR EXISTS (
        SELECT 1
        FROM aclexplode(
          coalesce(
            procedure.proacl,
            acldefault('f', procedure.proowner)
          )
        ) AS privilege
        WHERE privilege.grantee = 0
          AND privilege.privilege_type = 'EXECUTE'
      )
  ),
  'E ownership adoption and cutover cannot be called through service or browser roles'
);

SELECT ok(
  (
    SELECT NOT procedure.prosecdef
      AND coalesce(
        procedure.proconfig @> ARRAY['search_path=""']::text[],
        false
      )
    FROM pg_proc AS procedure
    WHERE procedure.oid =
      'public.verify_and_touch_admin_session(uuid,text,text)'::regprocedure
  )
  AND has_function_privilege(
    'service_role',
    'public.verify_and_touch_admin_session(uuid,text,text)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'anon',
    'public.verify_and_touch_admin_session(uuid,text,text)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'authenticated',
    'public.verify_and_touch_admin_session(uuid,text,text)',
    'EXECUTE'
  ),
  'legacy verifier keeps its fixed ABI and service-only invoker boundary'
);

SELECT alike(
  pg_get_functiondef(
    'public.verify_and_touch_admin_session(uuid,text,text)'::regprocedure
  ),
  '%hold_legacy_admin_session_gate_v1() is not true%return null%',
  'legacy verifier fails closed after the E cutover tombstone'
);

SELECT alike(
  pg_get_functiondef(
    'private.hold_legacy_admin_session_gate_v1()'::regprocedure
  ),
  '%from private.admin_identity_runtime_gate%for share%admin_identity_cutover_receipts%',
  'legacy verification holds the gate row against the cutover transaction'
);

SELECT ok(
  (
    SELECT pg_get_userbyid(procedure.proowner) = 'postgres'
      AND procedure.prosecdef
      AND coalesce(
        procedure.proconfig @> ARRAY['search_path=""']::text[],
        false
      )
    FROM pg_proc AS procedure
    WHERE procedure.oid =
      'private.hold_legacy_admin_session_gate_v1()'::regprocedure
  )
  AND has_function_privilege(
    'service_role',
    'private.hold_legacy_admin_session_gate_v1()',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'anon',
    'private.hold_legacy_admin_session_gate_v1()',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'authenticated',
    'private.hold_legacy_admin_session_gate_v1()',
    'EXECUTE'
  ),
  'only the reviewed service verifier can acquire the private legacy gate hold'
);

SELECT alike(
  pg_get_functiondef(
    'private.approve_google_admin_lecture_ownership_claim_v1(uuid,uuid,uuid,uuid,uuid,uuid,uuid,text,text,text,timestamp with time zone)'::regprocedure
  ),
  '%mapping_evidence_digest%insert into private.admin_lecture_ownership_claim_approvals%expected_lecture_status%expected_lifecycle_version%',
  'operator approval freezes mapping evidence and the reviewed lecture state'
);

SELECT alike(
  pg_get_functiondef(
    'private.claim_approved_google_admin_lecture_ownership_v1(uuid,uuid)'::regprocedure
  ),
  '%from private.admin_lecture_ownership_claim_receipts%from private.admin_lecture_ownership_claim_approvals%expected_lecture_status%expected_lifecycle_version%insert into private.admin_lecture_ownerships%operator_claim%insert into private.admin_lecture_ownership_claim_receipts%',
  'operator claim is replayable and consumes only an exact reviewed mapping'
);

SELECT alike(
  pg_get_functiondef(
    'private.commit_google_only_admin_cutover_v1(uuid,uuid,text,text,text)'::regprocedure
  ),
  '%deployment_evidence_digest%transaction_isolation%serializable%legacy_pin_login_enabled%false%authentication_method = ''legacy_pin''%insert into private.admin_identity_cutover_receipts%',
  'cutover requires SERIALIZABLE execution, tombstones PIN admission and records deployment evidence'
);

SELECT ok(
  EXISTS (
    SELECT 1
    FROM pg_trigger AS trigger
    JOIN pg_proc AS procedure ON procedure.oid = trigger.tgfoid
    JOIN pg_namespace AS namespace ON namespace.oid = procedure.pronamespace
    WHERE trigger.tgrelid = 'public.admin_sessions'::regclass
      AND NOT trigger.tgisinternal
      AND namespace.nspname = 'private'
      AND procedure.proname = 'enforce_google_only_admin_session_fence_v1'
  ),
  'Admin session writer fence is installed before cutover activation'
);

SELECT ok(
  EXISTS (
    SELECT 1
    FROM pg_trigger AS trigger
    JOIN pg_proc AS procedure ON procedure.oid = trigger.tgfoid
    JOIN pg_namespace AS namespace ON namespace.oid = procedure.pronamespace
    WHERE trigger.tgrelid =
      'private.admin_identity_runtime_gate'::regclass
      AND NOT trigger.tgisinternal
      AND namespace.nspname = 'private'
      AND procedure.proname =
        'enforce_google_only_admin_gate_tombstone_v1'
  ),
  'identity gate tombstone cannot be silently reversed'
);

SELECT ok(
  EXISTS (
    SELECT 1
    FROM pg_trigger AS trigger
    JOIN pg_constraint AS constraint_row
      ON constraint_row.oid = trigger.tgconstraint
    JOIN pg_proc AS procedure ON procedure.oid = trigger.tgfoid
    JOIN pg_namespace AS namespace ON namespace.oid = procedure.pronamespace
    WHERE trigger.tgrelid = 'public.lecture_sessions'::regclass
      AND NOT trigger.tgisinternal
      AND constraint_row.condeferrable
      AND constraint_row.condeferred
      AND namespace.nspname = 'private'
      AND procedure.proname =
        'enforce_active_admin_lecture_ownership_v1'
  ),
  'draft/open lecture ownership is enforced by a deferred constraint trigger'
);

SELECT ok(
  EXISTS (
    SELECT 1
    FROM pg_constraint AS constraint_row
    WHERE constraint_row.conrelid =
      'private.admin_lecture_ownerships'::regclass
      AND constraint_row.contype = 'c'
      AND pg_get_constraintdef(constraint_row.oid) LIKE '%google_create%'
      AND pg_get_constraintdef(constraint_row.oid) LIKE '%operator_claim%'
  )
  AND EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'private'
      AND table_name = 'admin_lecture_ownerships'
      AND column_name = 'ownership_approval_id'
  ),
  'lecture ownership provenance distinguishes Google creation from reviewed operator claim'
);

INSERT INTO auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) VALUES
  (
    '00000000-0000-0000-0000-000000000000'::uuid,
    '00000000-0000-4000-8000-00000000e102'::uuid,
    'authenticated', 'authenticated', 'phase730e-owner-a@example.test', '',
    statement_timestamp() - interval '1 hour',
    '{"provider":"google","providers":["google"]}'::jsonb, '{}'::jsonb,
    statement_timestamp() - interval '1 hour',
    statement_timestamp() - interval '1 hour'
  ),
  (
    '00000000-0000-0000-0000-000000000000'::uuid,
    '00000000-0000-4000-8000-00000000e112'::uuid,
    'authenticated', 'authenticated', 'phase730e-owner-b@example.test', '',
    statement_timestamp() - interval '1 hour',
    '{"provider":"google","providers":["google"]}'::jsonb, '{}'::jsonb,
    statement_timestamp() - interval '1 hour',
    statement_timestamp() - interval '1 hour'
  );

INSERT INTO auth.sessions (id, user_id, created_at, updated_at) VALUES
  (
    '00000000-0000-4000-8000-00000000e103'::uuid,
    '00000000-0000-4000-8000-00000000e102'::uuid,
    statement_timestamp() - interval '1 hour',
    statement_timestamp() - interval '1 hour'
  ),
  (
    '00000000-0000-4000-8000-00000000e113'::uuid,
    '00000000-0000-4000-8000-00000000e112'::uuid,
    statement_timestamp() - interval '1 hour',
    statement_timestamp() - interval '1 hour'
  );

INSERT INTO auth.mfa_factors (
  id, user_id, friendly_name, factor_type, status, created_at, updated_at
) VALUES
  (
    '00000000-0000-4000-8000-00000000e104'::uuid,
    '00000000-0000-4000-8000-00000000e102'::uuid,
    'phase730e-owner-a-totp', 'totp', 'verified',
    statement_timestamp() - interval '1 hour',
    statement_timestamp() - interval '1 hour'
  ),
  (
    '00000000-0000-4000-8000-00000000e114'::uuid,
    '00000000-0000-4000-8000-00000000e112'::uuid,
    'phase730e-owner-b-totp', 'totp', 'verified',
    statement_timestamp() - interval '1 hour',
    statement_timestamp() - interval '1 hour'
  );

INSERT INTO private.admin_environments (
  id, environment_kind, canonical_admin_origin, supabase_issuer,
  current_deployment, bootstrap_sealed_at, owner_invariant_enforced_at
) VALUES (
  '00000000-0000-4000-8000-00000000e101'::uuid,
  'local', 'http://127.0.0.1:5173',
  'http://127.0.0.1:54321/auth/v1', true,
  statement_timestamp() - interval '1 hour',
  statement_timestamp() - interval '1 hour'
);

INSERT INTO private.admin_principals (
  id, auth_user_id, google_issuer, provider_subject_hmac,
  subject_pepper_version, normalized_email, email_verified_at, display_name
) VALUES
  (
    '00000000-0000-4000-8000-00000000e105'::uuid,
    '00000000-0000-4000-8000-00000000e102'::uuid,
    'https://accounts.google.com', repeat('a', 64), 1,
    'phase730e-owner-a@example.test', statement_timestamp() - interval '1 hour',
    'Phase 7.30E Owner A'
  ),
  (
    '00000000-0000-4000-8000-00000000e115'::uuid,
    '00000000-0000-4000-8000-00000000e112'::uuid,
    'https://accounts.google.com', repeat('b', 64), 1,
    'phase730e-owner-b@example.test', statement_timestamp() - interval '1 hour',
    'Phase 7.30E Owner B'
  );

UPDATE private.admin_principals
SET
  approved_totp_factor_set_hash = snapshot.factor_set_hash,
  approved_totp_factor_set_version = 1,
  approved_totp_factor_count = snapshot.factor_count,
  approved_totp_factor_set_at = statement_timestamp() - interval '30 minutes',
  approved_totp_factor_set_request_id =
    '00000000-0000-4000-8000-00000000e109'::uuid,
  approved_totp_factor_set_source = 'operator_adoption',
  approved_totp_factor_set_actor = 'fixture:phase730e',
  approved_totp_factor_set_reason = 'E cutover runtime fixture'
FROM private.current_verified_totp_factor_set_snapshot_v1(
  '00000000-0000-4000-8000-00000000e102'::uuid
) AS snapshot
WHERE id = '00000000-0000-4000-8000-00000000e105'::uuid;

UPDATE private.admin_principals
SET
  approved_totp_factor_set_hash = snapshot.factor_set_hash,
  approved_totp_factor_set_version = 1,
  approved_totp_factor_count = snapshot.factor_count,
  approved_totp_factor_set_at = statement_timestamp() - interval '30 minutes',
  approved_totp_factor_set_request_id =
    '00000000-0000-4000-8000-00000000e119'::uuid,
  approved_totp_factor_set_source = 'operator_adoption',
  approved_totp_factor_set_actor = 'fixture:phase730e',
  approved_totp_factor_set_reason = 'E cutover runtime fixture'
FROM private.current_verified_totp_factor_set_snapshot_v1(
  '00000000-0000-4000-8000-00000000e112'::uuid
) AS snapshot
WHERE id = '00000000-0000-4000-8000-00000000e115'::uuid;

INSERT INTO private.admin_environment_memberships (
  id, environment_id, principal_id, role, status, can_use_ai, activated_at
) VALUES
  (
    '00000000-0000-4000-8000-00000000e106'::uuid,
    '00000000-0000-4000-8000-00000000e101'::uuid,
    '00000000-0000-4000-8000-00000000e105'::uuid,
    'owner', 'active', true, statement_timestamp() - interval '1 hour'
  ),
  (
    '00000000-0000-4000-8000-00000000e116'::uuid,
    '00000000-0000-4000-8000-00000000e101'::uuid,
    '00000000-0000-4000-8000-00000000e115'::uuid,
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
) VALUES
  (
    '00000000-0000-4000-8000-00000000e107'::uuid, repeat('3', 64),
    '00000000-0000-4000-8000-00000000e108'::uuid,
    '00000000-0000-4000-8000-00000000e101'::uuid,
    '00000000-0000-4000-8000-00000000e105'::uuid,
    '00000000-0000-4000-8000-00000000e106'::uuid,
    '00000000-0000-4000-8000-00000000e103'::uuid,
    'admin_login', '00000000-0000-4000-8000-00000000e109'::uuid,
    repeat('4', 64), statement_timestamp() - interval '1 minute',
    '00000000-0000-4000-8000-00000000e104'::uuid,
    private.current_verified_totp_factor_set_hash_v1(
      '00000000-0000-4000-8000-00000000e102'::uuid
    ),
    private.current_verified_totp_factor_set_hash_v1(
      '00000000-0000-4000-8000-00000000e102'::uuid
    ),
    false, 1, repeat('5', 64), statement_timestamp(),
    statement_timestamp() - interval '1 minute',
    statement_timestamp() + interval '4 minutes'
  ),
  (
    '00000000-0000-4000-8000-00000000e117'::uuid, repeat('6', 64),
    '00000000-0000-4000-8000-00000000e118'::uuid,
    '00000000-0000-4000-8000-00000000e101'::uuid,
    '00000000-0000-4000-8000-00000000e115'::uuid,
    '00000000-0000-4000-8000-00000000e116'::uuid,
    '00000000-0000-4000-8000-00000000e113'::uuid,
    'admin_login', '00000000-0000-4000-8000-00000000e119'::uuid,
    repeat('7', 64), statement_timestamp() - interval '1 minute',
    '00000000-0000-4000-8000-00000000e114'::uuid,
    private.current_verified_totp_factor_set_hash_v1(
      '00000000-0000-4000-8000-00000000e112'::uuid
    ),
    private.current_verified_totp_factor_set_hash_v1(
      '00000000-0000-4000-8000-00000000e112'::uuid
    ),
    false, 1, repeat('8', 64), statement_timestamp(),
    statement_timestamp() - interval '1 minute',
    statement_timestamp() + interval '4 minutes'
  );

UPDATE private.admin_identity_runtime_gate
SET
  google_session_issue_enabled = true,
  google_operational_authorization_enabled = true,
  google_admin_ledger_enabled = true,
  updated_at = statement_timestamp()
WHERE singleton;

INSERT INTO public.admin_sessions (
  id, token_hash, auth_user_id, pin_version_hash, authentication_method, aal,
  principal_id, membership_id, environment_id, supabase_auth_session_id,
  step_up_verified_at, step_up_nonce_id, verified_totp_factor_set_hash,
  issued_at, last_seen_at, idle_expires_at, expires_at
) VALUES
  (
    '00000000-0000-4000-8000-00000000e108'::uuid, repeat('1', 64),
    '00000000-0000-4000-8000-00000000e102'::uuid,
    null, 'google_totp', 2,
    '00000000-0000-4000-8000-00000000e105'::uuid,
    '00000000-0000-4000-8000-00000000e106'::uuid,
    '00000000-0000-4000-8000-00000000e101'::uuid,
    '00000000-0000-4000-8000-00000000e103'::uuid,
    statement_timestamp(),
    '00000000-0000-4000-8000-00000000e107'::uuid,
    private.current_verified_totp_factor_set_hash_v1(
      '00000000-0000-4000-8000-00000000e102'::uuid
    ),
    statement_timestamp() - interval '1 hour',
    statement_timestamp() - interval '1 hour',
    statement_timestamp() + interval '12 hours',
    statement_timestamp() + interval '12 hours'
  ),
  (
    '00000000-0000-4000-8000-00000000e118'::uuid, repeat('2', 64),
    '00000000-0000-4000-8000-00000000e112'::uuid,
    null, 'google_totp', 2,
    '00000000-0000-4000-8000-00000000e115'::uuid,
    '00000000-0000-4000-8000-00000000e116'::uuid,
    '00000000-0000-4000-8000-00000000e101'::uuid,
    '00000000-0000-4000-8000-00000000e113'::uuid,
    statement_timestamp(),
    '00000000-0000-4000-8000-00000000e117'::uuid,
    private.current_verified_totp_factor_set_hash_v1(
      '00000000-0000-4000-8000-00000000e112'::uuid
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
  completed_admin_session_id = CASE id
    WHEN '00000000-0000-4000-8000-00000000e107'::uuid
      THEN '00000000-0000-4000-8000-00000000e108'::uuid
    ELSE '00000000-0000-4000-8000-00000000e118'::uuid
  END,
  updated_at = statement_timestamp()
WHERE id IN (
  '00000000-0000-4000-8000-00000000e107'::uuid,
  '00000000-0000-4000-8000-00000000e117'::uuid
);

INSERT INTO public.admin_sessions (
  id, token_hash, auth_user_id, pin_version_hash,
  issued_at, last_seen_at, idle_expires_at, expires_at
) VALUES (
  '00000000-0000-4000-8000-00000000e141'::uuid,
  repeat('9', 64),
  '00000000-0000-4000-8000-00000000e102'::uuid,
  repeat('e', 64),
  statement_timestamp() - interval '1 hour',
  statement_timestamp(),
  statement_timestamp() + interval '30 minutes',
  statement_timestamp() + interval '2 hours'
);

INSERT INTO public.lecture_sessions (
  id, title, code_hash, status
) VALUES
  (
    '00000000-0000-4000-8000-00000000e130'::uuid,
    'Phase 7.30E reviewed closed lecture', repeat('c', 64), 'closed'
  ),
  (
    '00000000-0000-4000-8000-00000000e131'::uuid,
    'Phase 7.30E unclaimed closed lecture', repeat('d', 64), 'closed'
  );

SELECT ok(
  public.verify_and_touch_admin_session(
    '00000000-0000-4000-8000-00000000e141'::uuid,
    repeat('9', 64), repeat('e', 64)
  ) IS NOT NULL,
  'legacy verification remains dormant-compatible before explicit cutover'
);

SELECT is(
  private.approve_google_admin_lecture_ownership_claim_v1(
    '00000000-0000-4000-8000-00000000e120'::uuid,
    '00000000-0000-4000-8000-00000000e121'::uuid,
    '00000000-0000-4000-8000-00000000e101'::uuid,
    '00000000-0000-4000-8000-00000000e130'::uuid,
    '00000000-0000-4000-8000-00000000e115'::uuid,
    '00000000-0000-4000-8000-00000000e116'::uuid,
    '00000000-0000-4000-8000-00000000e108'::uuid,
    'operator:phase730e', 'reviewed mapping evidence', repeat('f', 64),
    transaction_timestamp() + interval '1 hour'
  ) ->> 'replayed',
  'false',
  'operator creates one immutable reviewed ownership approval'
);

SELECT is(
  private.approve_google_admin_lecture_ownership_claim_v1(
    '00000000-0000-4000-8000-00000000e120'::uuid,
    '00000000-0000-4000-8000-00000000e121'::uuid,
    '00000000-0000-4000-8000-00000000e101'::uuid,
    '00000000-0000-4000-8000-00000000e130'::uuid,
    '00000000-0000-4000-8000-00000000e115'::uuid,
    '00000000-0000-4000-8000-00000000e116'::uuid,
    '00000000-0000-4000-8000-00000000e108'::uuid,
    'operator:phase730e', 'reviewed mapping evidence', repeat('f', 64),
    transaction_timestamp() + interval '1 hour'
  ) ->> 'replayed',
  'true',
  'approval exact replay returns immutable evidence'
);

SELECT throws_ok(
  $$
    SELECT private.approve_google_admin_lecture_ownership_claim_v1(
      '00000000-0000-4000-8000-00000000e12f'::uuid,
      '00000000-0000-4000-8000-00000000e121'::uuid,
      '00000000-0000-4000-8000-00000000e101'::uuid,
      '00000000-0000-4000-8000-00000000e130'::uuid,
      '00000000-0000-4000-8000-00000000e115'::uuid,
      '00000000-0000-4000-8000-00000000e116'::uuid,
      '00000000-0000-4000-8000-00000000e108'::uuid,
      'operator:phase730e', 'changed approval binding', repeat('f', 64),
      transaction_timestamp() + interval '1 hour'
    )
  $$,
  'P7335',
  'Google Admin lecture ownership approval collided',
  'approval request ID cannot be rebound to different authority'
);

SELECT is(
  private.claim_approved_google_admin_lecture_ownership_v1(
    '00000000-0000-4000-8000-00000000e120'::uuid,
    '00000000-0000-4000-8000-00000000e122'::uuid
  ) ->> 'replayed',
  'false',
  'reviewed ownership claim atomically creates provenance'
);

SELECT is(
  private.claim_approved_google_admin_lecture_ownership_v1(
    '00000000-0000-4000-8000-00000000e120'::uuid,
    '00000000-0000-4000-8000-00000000e122'::uuid
  ) ->> 'replayed',
  'true',
  'ownership claim exact replay returns the committed mapping'
);

SELECT is(
  (SELECT ownership_source
   FROM private.admin_lecture_ownerships
   WHERE lecture_session_id =
     '00000000-0000-4000-8000-00000000e130'::uuid),
  'operator_claim',
  'claimed lecture stores explicit operator-reviewed provenance'
);

SELECT is(
  private.approve_google_admin_lecture_ownership_claim_v1(
    '00000000-0000-4000-8000-00000000e124'::uuid,
    '00000000-0000-4000-8000-00000000e125'::uuid,
    '00000000-0000-4000-8000-00000000e101'::uuid,
    '00000000-0000-4000-8000-00000000e131'::uuid,
    '00000000-0000-4000-8000-00000000e115'::uuid,
    '00000000-0000-4000-8000-00000000e116'::uuid,
    '00000000-0000-4000-8000-00000000e108'::uuid,
    'operator:phase730e', 'held for post-cutover fence', repeat('a', 64),
    transaction_timestamp() + interval '1 hour'
  ) ->> 'replayed',
  'false',
  'a second reviewed approval may remain deliberately unclaimed'
);

SELECT is(
  private.commit_google_only_admin_cutover_v1(
    '00000000-0000-4000-8000-00000000e101'::uuid,
    '00000000-0000-4000-8000-00000000e150'::uuid,
    'operator:phase730e', 'verified Google-only deployment', repeat('b', 64)
  ) ->> 'replayed',
  'false',
  'SERIALIZABLE operator transaction commits the Google-only identity cutover'
);

SELECT is(
  private.commit_google_only_admin_cutover_v1(
    '00000000-0000-4000-8000-00000000e101'::uuid,
    '00000000-0000-4000-8000-00000000e150'::uuid,
    'operator:phase730e', 'verified Google-only deployment', repeat('b', 64)
  ) ->> 'replayed',
  'true',
  'cutover exact replay remains available after the irreversible tombstone'
);

SELECT is(
  private.approve_google_admin_lecture_ownership_claim_v1(
    '00000000-0000-4000-8000-00000000e120'::uuid,
    '00000000-0000-4000-8000-00000000e121'::uuid,
    '00000000-0000-4000-8000-00000000e101'::uuid,
    '00000000-0000-4000-8000-00000000e130'::uuid,
    '00000000-0000-4000-8000-00000000e115'::uuid,
    '00000000-0000-4000-8000-00000000e116'::uuid,
    '00000000-0000-4000-8000-00000000e108'::uuid,
    'operator:phase730e', 'reviewed mapping evidence', repeat('f', 64),
    transaction_timestamp() + interval '1 hour'
  ) ->> 'replayed',
  'true',
  'committed approval replay remains available after cutover'
);

SELECT is(
  private.claim_approved_google_admin_lecture_ownership_v1(
    '00000000-0000-4000-8000-00000000e120'::uuid,
    '00000000-0000-4000-8000-00000000e122'::uuid
  ) ->> 'replayed',
  'true',
  'committed ownership replay remains available after cutover'
);

SELECT ok(
  NOT (SELECT legacy_pin_login_enabled
       FROM private.admin_identity_runtime_gate
       WHERE singleton)
  AND (SELECT revoked_at IS NOT NULL
       FROM public.admin_sessions
       WHERE id = '00000000-0000-4000-8000-00000000e141'::uuid)
  AND EXISTS (SELECT 1 FROM private.admin_identity_cutover_receipts),
  'cutover disables legacy admission, revokes the live legacy session and records the tombstone'
);

SELECT is(
  public.verify_and_touch_admin_session(
    '00000000-0000-4000-8000-00000000e141'::uuid,
    repeat('9', 64), repeat('e', 64)
  ),
  NULL,
  'legacy verifier fails closed after cutover'
);

SELECT ok(
  NOT has_function_privilege(
    'service_role',
    'public.verify_and_touch_admin_session(uuid,text,text)',
    'EXECUTE'
  ),
  'cutover transaction revokes the old service-role verifier entry point'
);

SELECT throws_ok(
  $$
    UPDATE private.admin_identity_runtime_gate
    SET legacy_pin_login_enabled = true
    WHERE singleton
  $$,
  'P7335',
  'Legacy Admin PIN admission cannot be re-enabled',
  'legacy admission cannot be re-enabled after the tombstone'
);

SELECT throws_ok(
  $$
    INSERT INTO public.admin_sessions (
      id, token_hash, auth_user_id, pin_version_hash,
      issued_at, last_seen_at, idle_expires_at, expires_at
    ) VALUES (
      '00000000-0000-4000-8000-00000000e142'::uuid,
      repeat('0', 64),
      '00000000-0000-4000-8000-00000000e102'::uuid,
      repeat('f', 64), statement_timestamp(), statement_timestamp(),
      statement_timestamp() + interval '30 minutes',
      statement_timestamp() + interval '2 hours'
    )
  $$,
  'P7335',
  'Legacy Admin session issuance is disabled',
  'new legacy session issuance is permanently fenced'
);

SELECT throws_ok(
  $$
    UPDATE public.admin_sessions
    SET revoked_at = NULL, revoke_reason = NULL
    WHERE id = '00000000-0000-4000-8000-00000000e141'::uuid
  $$,
  'P7335',
  'Legacy Admin session authority is fenced',
  'terminal legacy session evidence cannot be resurrected'
);

SELECT throws_ok(
  $$
    SELECT private.claim_approved_google_admin_lecture_ownership_v1(
      '00000000-0000-4000-8000-00000000e124'::uuid,
      '00000000-0000-4000-8000-00000000e126'::uuid
    )
  $$,
  'P7335',
  'Google-only Admin cutover already committed',
  'an unclaimed approval cannot add ownership after cutover'
);

SELECT throws_ok(
  $$
    SELECT private.approve_google_admin_lecture_ownership_claim_v1(
      '00000000-0000-4000-8000-00000000e127'::uuid,
      '00000000-0000-4000-8000-00000000e128'::uuid,
      '00000000-0000-4000-8000-00000000e101'::uuid,
      '00000000-0000-4000-8000-00000000e131'::uuid,
      '00000000-0000-4000-8000-00000000e115'::uuid,
      '00000000-0000-4000-8000-00000000e116'::uuid,
      '00000000-0000-4000-8000-00000000e108'::uuid,
      'operator:phase730e', 'late approval must fail', repeat('c', 64),
      transaction_timestamp() + interval '1 hour'
    )
  $$,
  'P7335',
  'Google-only Admin cutover already committed',
  'new ownership approval cannot be created after cutover'
);

INSERT INTO public.lecture_sessions (
  id, title, code_hash, status
) VALUES (
  '00000000-0000-4000-8000-00000000e160'::uuid,
  'Phase 7.30E forbidden unowned draft', repeat('0', 64), 'draft'
);

SELECT throws_ok(
  $$ SET CONSTRAINTS lecture_sessions_google_only_active_ownership IMMEDIATE $$,
  'P7335',
  'Active lecture requires Google Admin ownership authority',
  'deferred cutover fence rejects a new unowned draft lecture'
);

SELECT * FROM finish();
ROLLBACK;
