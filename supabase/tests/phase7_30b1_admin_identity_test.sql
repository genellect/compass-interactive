BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path = public, extensions;
SELECT no_plan();

SELECT has_table('private', 'admin_identity_runtime_gate', 'identity runtime gate exists');
SELECT has_table('private', 'admin_environments', 'Admin environments exist');
SELECT has_table('private', 'admin_principals', 'Admin principals exist');
SELECT has_table('private', 'admin_environment_memberships', 'environment memberships exist');
SELECT has_table('private', 'admin_invitations', 'Admin invitations exist');
SELECT has_table('private', 'admin_step_up_nonces', 'step-up nonces exist');
SELECT has_table('private', 'admin_audit_events', 'append-only Admin audit exists');

SELECT ok(
  (
    SELECT count(*) = 7 AND bool_and(class.relrowsecurity)
    FROM pg_class AS class
    JOIN pg_namespace AS namespace ON namespace.oid = class.relnamespace
    WHERE namespace.nspname = 'private'
      AND class.relname IN (
        'admin_identity_runtime_gate',
        'admin_environments',
        'admin_principals',
        'admin_environment_memberships',
        'admin_invitations',
        'admin_step_up_nonces',
        'admin_audit_events'
      )
  ),
  'every Phase 7.30 B1 private table has RLS enabled'
);

SELECT ok(
  NOT has_table_privilege('anon', 'private.admin_principals', 'SELECT')
  AND NOT has_table_privilege(
    'authenticated',
    'private.admin_environment_memberships',
    'SELECT'
  )
  AND NOT has_table_privilege(
    'service_role',
    'private.admin_step_up_nonces',
    'INSERT'
  )
  AND NOT has_table_privilege(
    'service_role',
    'private.admin_audit_events',
    'DELETE'
  ),
  'browser roles and service role receive no direct B1 table writes'
);

SELECT is(
  (
    SELECT count(*)::integer
    FROM pg_proc AS procedure
    JOIN pg_namespace AS namespace ON namespace.oid = procedure.pronamespace
    WHERE namespace.nspname = 'public'
      AND procedure.proname IN (
        'get_admin_identity_runtime_gate_v1',
        'get_admin_identity_environment_v1',
        'bootstrap_admin_environment_v1',
        'consume_admin_identity_admission_v1',
        'begin_admin_totp_step_up_v1',
        'complete_admin_totp_step_up_v1',
        'verify_and_touch_google_admin_session_v1',
        'revoke_own_google_admin_session_v1'
      )
  ),
  8,
  'all eight B1 service wrappers exist exactly once'
);

SELECT ok(
  NOT EXISTS (
    SELECT 1
    FROM pg_proc AS procedure
    JOIN pg_namespace AS namespace ON namespace.oid = procedure.pronamespace
    WHERE namespace.nspname = 'public'
      AND procedure.proname LIKE '%admin%v1'
      AND procedure.proname IN (
        'get_admin_identity_runtime_gate_v1',
        'get_admin_identity_environment_v1',
        'bootstrap_admin_environment_v1',
        'consume_admin_identity_admission_v1',
        'begin_admin_totp_step_up_v1',
        'complete_admin_totp_step_up_v1',
        'verify_and_touch_google_admin_session_v1',
        'revoke_own_google_admin_session_v1'
      )
      AND (
        procedure.prosecdef
        OR has_function_privilege('anon', procedure.oid, 'EXECUTE')
        OR has_function_privilege('authenticated', procedure.oid, 'EXECUTE')
        OR NOT has_function_privilege('service_role', procedure.oid, 'EXECUTE')
      )
  ),
  'public B1 wrappers are invoker-only and service-role-only'
);

SELECT ok(
  (
    SELECT google_session_issue_enabled IS FALSE
      AND legacy_pin_login_enabled IS TRUE
    FROM private.admin_identity_runtime_gate
    WHERE singleton
  ),
  'Google issuance defaults OFF while legacy PIN defaults ON'
);

SELECT ok(
  EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'admin_sessions'
      AND column_name = 'authentication_method'
  )
  AND EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'admin_sessions'
      AND column_name = 'step_up_verified_at'
  ),
  'tracked Admin sessions carry explicit auth mode and step-up provenance'
);

SELECT ok(
  NOT EXISTS (
    SELECT 1
    FROM pg_constraint AS foreign_key
    JOIN pg_class AS source_table
      ON source_table.oid = foreign_key.conrelid
    JOIN pg_namespace AS source_namespace
      ON source_namespace.oid = source_table.relnamespace
    JOIN pg_class AS target_table
      ON target_table.oid = foreign_key.confrelid
    JOIN pg_namespace AS target_namespace
      ON target_namespace.oid = target_table.relnamespace
    WHERE foreign_key.contype = 'f'
      AND source_namespace.nspname = 'private'
      AND source_table.relname = 'admin_step_up_nonces'
      AND target_namespace.nspname = 'public'
      AND target_table.relname = 'admin_sessions'
  ),
  'nonce completion provenance does not create a circular session foreign key'
);

SET ROLE service_role;
SELECT lives_ok(
  $$
    SELECT public.bootstrap_admin_environment_v1(
      '00000000-0000-4000-8000-000000000730'::uuid,
      'local',
      'http://127.0.0.1:5173',
      'http://127.0.0.1:54321/auth/v1',
      'authenticated',
      ARRAY[repeat('1', 64), repeat('2', 64)],
      statement_timestamp() + interval '1 day',
      '00000000-0000-4000-8000-000000000731'::uuid
    )
  $$,
  'service role can execute the create-only two-owner bootstrap wrapper'
);
RESET ROLE;

SET ROLE service_role;
SELECT throws_ok(
  $$
    SELECT public.consume_admin_identity_admission_v1(
      '00000000-0000-4000-8000-000000000730'::uuid,
      '00000000-0000-4000-8000-000000000701'::uuid,
      null::text,
      repeat('a', 64),
      1,
      'owner-one@example.test',
      repeat('1', 64),
      'Owner One',
      '00000000-0000-4000-8000-000000000743'::uuid,
      null
    )
  $$,
  '22023',
  'invalid Admin identity admission',
  'an existing principal cannot bypass issuer binding with SQL NULL'
);

SELECT throws_ok(
  $$
    SELECT public.consume_admin_identity_admission_v1(
      '00000000-0000-4000-8000-000000000730'::uuid,
      '00000000-0000-4000-8000-000000000701'::uuid,
      'https://accounts.google.com',
      null::text,
      1,
      'owner-one@example.test',
      repeat('1', 64),
      'Owner One',
      '00000000-0000-4000-8000-000000000744'::uuid,
      null
    )
  $$,
  '22023',
  'invalid Admin identity admission',
  'an existing principal cannot bypass subject binding with SQL NULL'
);

SELECT throws_ok(
  $$
    SELECT public.consume_admin_identity_admission_v1(
      '00000000-0000-4000-8000-000000000730'::uuid,
      '00000000-0000-4000-8000-000000000701'::uuid,
      'https://accounts.google.com',
      repeat('a', 64),
      null::integer,
      'owner-one@example.test',
      repeat('1', 64),
      'Owner One',
      '00000000-0000-4000-8000-000000000745'::uuid,
      null
    )
  $$,
  '22023',
  'invalid Admin identity admission',
  'an existing principal cannot bypass pepper-version binding with SQL NULL'
);

SELECT throws_ok(
  $$
    SELECT public.consume_admin_identity_admission_v1(
      '00000000-0000-4000-8000-000000000730'::uuid,
      '00000000-0000-4000-8000-000000000701'::uuid,
      'https://accounts.google.com',
      repeat('a', 64),
      1,
      null::text,
      null::text,
      'Owner One',
      '00000000-0000-4000-8000-000000000746'::uuid,
      null
    )
  $$,
  '22023',
  'invalid Admin identity admission',
  'identity admission rejects NULL email provenance'
);
RESET ROLE;

SELECT is(
  (
    SELECT count(*)::integer
    FROM private.admin_invitations
    WHERE environment_id = '00000000-0000-4000-8000-000000000730'::uuid
      AND invitation_kind = 'bootstrap'
      AND role = 'owner'
      AND status = 'pending'
  ),
  2,
  'bootstrap records exactly two distinct pending owner admissions'
);

SELECT throws_ok(
  $$
    SELECT private.bootstrap_admin_environment_v1(
      '00000000-0000-4000-8000-000000000732'::uuid,
      'local',
      'http://127.0.0.1:5173',
      'http://127.0.0.1:54321/auth/v1',
      'authenticated',
      ARRAY[repeat('3', 64), repeat('4', 64)],
      statement_timestamp() + interval '1 day',
      '00000000-0000-4000-8000-000000000733'::uuid
    )
  $$,
  'P0001',
  'Admin environment bootstrap is create-only',
  'environment bootstrap cannot be replayed for a second deployment row'
);

UPDATE private.admin_identity_runtime_gate
SET google_session_issue_enabled = true;

SET ROLE service_role;
SELECT is(
  (
    public.consume_admin_identity_admission_v1(
      '00000000-0000-4000-8000-000000000730'::uuid,
      '00000000-0000-4000-8000-000000000701'::uuid,
      'https://accounts.google.com',
      repeat('a', 64),
      1,
      'owner-one@example.test',
      repeat('1', 64),
      'Owner One',
      '00000000-0000-4000-8000-000000000734'::uuid,
      null
    ) ->> 'eligible'
  ),
  'true',
  'trusted bootstrap identity creates only a pending-MFA membership'
);

RESET ROLE;

SELECT is(
  (
    SELECT membership.status
    FROM (
      SELECT status
      FROM private.admin_environment_memberships
      WHERE principal_id = (
        SELECT id
        FROM private.admin_principals
        WHERE auth_user_id = '00000000-0000-4000-8000-000000000701'::uuid
      )
    ) AS membership
  ),
  'pending_mfa',
  'AAL1 admission does not activate Admin membership'
);

SET ROLE service_role;

SELECT lives_ok(
  $$
    SELECT public.begin_admin_totp_step_up_v1(
      '00000000-0000-4000-8000-000000000730'::uuid,
      '00000000-0000-4000-8000-000000000701'::uuid,
      '00000000-0000-4000-8000-000000000711'::uuid,
      repeat('b', 64),
      '00000000-0000-4000-8000-000000000721'::uuid,
      repeat('c', 64),
      '00000000-0000-4000-8000-000000000735'::uuid
    )
  $$,
  'AAL1 creates only a five-minute nonce bound to a reserved future session'
);

SELECT throws_ok(
  $$
    SELECT public.complete_admin_totp_step_up_v1(
      repeat('b', 64),
      '00000000-0000-4000-8000-000000000701'::uuid,
      '00000000-0000-4000-8000-000000000711'::uuid,
      1::smallint,
      repeat('d', 64),
      statement_timestamp() + interval '1 second',
      'totp',
      statement_timestamp() + interval '1 second',
      repeat('e', 64),
      null,
      null,
      '00000000-0000-4000-8000-000000000736'::uuid
    )
  $$,
  '22023',
  'invalid Admin TOTP completion',
  'AAL1 cannot complete the tracked Admin session'
);

SELECT throws_ok(
  $$
    SELECT public.complete_admin_totp_step_up_v1(
      repeat('b', 64),
      '00000000-0000-4000-8000-000000000701'::uuid,
      '00000000-0000-4000-8000-000000000711'::uuid,
      null::smallint,
      repeat('d', 64),
      statement_timestamp() + interval '1 second',
      'totp',
      statement_timestamp() + interval '1 second',
      repeat('e', 64),
      null,
      null,
      '00000000-0000-4000-8000-000000000747'::uuid
    )
  $$,
  '22023',
  'invalid Admin TOTP completion',
  'NULL AAL cannot bypass the database AAL2 invariant'
);

SELECT throws_ok(
  $$
    SELECT public.complete_admin_totp_step_up_v1(
      repeat('b', 64),
      '00000000-0000-4000-8000-000000000701'::uuid,
      '00000000-0000-4000-8000-000000000711'::uuid,
      2::smallint,
      null::text,
      null::timestamptz,
      null::text,
      null::timestamptz,
      repeat('e', 64),
      null,
      null,
      '00000000-0000-4000-8000-000000000748'::uuid
    )
  $$,
  '22023',
  'invalid Admin TOTP completion',
  'NULL JWT and TOTP provenance cannot create a tracked session'
);

SELECT is(
  (
    public.complete_admin_totp_step_up_v1(
      repeat('b', 64),
      '00000000-0000-4000-8000-000000000701'::uuid,
      '00000000-0000-4000-8000-000000000711'::uuid,
      2::smallint,
      repeat('d', 64),
      statement_timestamp() + interval '1 second',
      'totp',
      statement_timestamp() + interval '1 second',
      repeat('e', 64),
      repeat('f', 64),
      repeat('0', 64),
      '00000000-0000-4000-8000-000000000737'::uuid
    ) ->> 'role'
  ),
  'owner',
  'fresh TOTP atomically activates owner membership and tracked app session'
);

SELECT ok(
  (
    SELECT authentication_method = 'google_totp'
      AND aal = 2
      AND pin_version_hash IS NULL
      AND step_up_verified_at IS NOT NULL
    FROM public.admin_sessions
    WHERE id = '00000000-0000-4000-8000-000000000721'::uuid
  ),
  'Google session cannot satisfy the legacy PIN row shape'
);

SELECT is(
  public.verify_and_touch_admin_session(
    '00000000-0000-4000-8000-000000000721'::uuid,
    repeat('e', 64),
    repeat('9', 64)
  )::text,
  null,
  'legacy verifier explicitly rejects a Google TOTP session'
);

SELECT is(
  (
    public.complete_admin_totp_step_up_v1(
      repeat('b', 64),
      '00000000-0000-4000-8000-000000000701'::uuid,
      '00000000-0000-4000-8000-000000000711'::uuid,
      2::smallint,
      repeat('d', 64),
      statement_timestamp() + interval '1 second',
      'totp',
      statement_timestamp() + interval '1 second',
      repeat('e', 64),
      repeat('f', 64),
      repeat('0', 64),
      '00000000-0000-4000-8000-000000000738'::uuid
    ) ->> 'id'
  ),
  '00000000-0000-4000-8000-000000000721',
  'exact completion retry returns the same tracked session'
);

SELECT is(
  public.complete_admin_totp_step_up_v1(
    repeat('b', 64),
    '00000000-0000-4000-8000-000000000702'::uuid,
    '00000000-0000-4000-8000-000000000711'::uuid,
    2::smallint,
    repeat('d', 64),
    statement_timestamp() + interval '1 second',
    'totp',
    statement_timestamp() + interval '1 second',
    repeat('e', 64),
    repeat('f', 64),
    repeat('0', 64),
    '00000000-0000-4000-8000-000000000740'::uuid
  )::text,
  null,
  'a consumed nonce cannot replay across a different Google principal'
);

SELECT is(
  public.complete_admin_totp_step_up_v1(
    repeat('b', 64),
    '00000000-0000-4000-8000-000000000701'::uuid,
    '00000000-0000-4000-8000-000000000712'::uuid,
    2::smallint,
    repeat('d', 64),
    statement_timestamp() + interval '1 second',
    'totp',
    statement_timestamp() + interval '1 second',
    repeat('e', 64),
    repeat('f', 64),
    repeat('0', 64),
    '00000000-0000-4000-8000-000000000741'::uuid
  )::text,
  null,
  'a consumed nonce cannot replay across a different Supabase Auth session'
);

SELECT is(
  public.complete_admin_totp_step_up_v1(
    repeat('b', 64),
    '00000000-0000-4000-8000-000000000701'::uuid,
    '00000000-0000-4000-8000-000000000711'::uuid,
    2::smallint,
    repeat('c', 64),
    statement_timestamp() + interval '1 second',
    'totp',
    statement_timestamp() + interval '1 second',
    repeat('e', 64),
    repeat('f', 64),
    repeat('0', 64),
    '00000000-0000-4000-8000-000000000749'::uuid
  )::text,
  null,
  'the pre-challenge AAL1 JWT cannot replay a consumed TOTP nonce'
);

RESET ROLE;

UPDATE private.admin_step_up_nonces
SET
  issued_at = statement_timestamp() - interval '5 minutes',
  expires_at = statement_timestamp() - interval '1 second'
WHERE nonce_hash = repeat('b', 64);

SET ROLE service_role;

SELECT is(
  public.complete_admin_totp_step_up_v1(
    repeat('b', 64),
    '00000000-0000-4000-8000-000000000701'::uuid,
    '00000000-0000-4000-8000-000000000711'::uuid,
    2::smallint,
    repeat('d', 64),
    statement_timestamp() + interval '1 second',
    'totp',
    statement_timestamp() + interval '1 second',
    repeat('e', 64),
    repeat('f', 64),
    repeat('0', 64),
    '00000000-0000-4000-8000-000000000750'::uuid
  )::text,
  null,
  'consumed nonce replay closes after the five-minute uncertainty window'
);

RESET ROLE;

UPDATE private.admin_step_up_nonces
SET
  issued_at = statement_timestamp(),
  expires_at = statement_timestamp() + interval '5 minutes'
WHERE nonce_hash = repeat('b', 64);

UPDATE private.admin_environments
SET status = 'suspended'
WHERE id = '00000000-0000-4000-8000-000000000730'::uuid;

SET ROLE service_role;

SELECT is(
  public.complete_admin_totp_step_up_v1(
    repeat('b', 64),
    '00000000-0000-4000-8000-000000000701'::uuid,
    '00000000-0000-4000-8000-000000000711'::uuid,
    2::smallint,
    repeat('d', 64),
    statement_timestamp() + interval '1 second',
    'totp',
    statement_timestamp() + interval '1 second',
    repeat('e', 64),
    repeat('f', 64),
    repeat('0', 64),
    '00000000-0000-4000-8000-000000000751'::uuid
  )::text,
  null,
  'a suspended environment cannot replay a consumed tracked session'
);

RESET ROLE;

UPDATE private.admin_environments
SET status = 'active'
WHERE id = '00000000-0000-4000-8000-000000000730'::uuid;

UPDATE public.admin_sessions
SET revoked_at = statement_timestamp(), revoke_reason = 'test'
WHERE id = '00000000-0000-4000-8000-000000000721'::uuid;

SET ROLE service_role;

SELECT is(
  public.complete_admin_totp_step_up_v1(
    repeat('b', 64),
    '00000000-0000-4000-8000-000000000701'::uuid,
    '00000000-0000-4000-8000-000000000711'::uuid,
    2::smallint,
    repeat('d', 64),
    statement_timestamp() + interval '1 second',
    'totp',
    statement_timestamp() + interval '1 second',
    repeat('e', 64),
    repeat('f', 64),
    repeat('0', 64),
    '00000000-0000-4000-8000-000000000742'::uuid
  )::text,
  null,
  'a revoked tracked session cannot be resurrected by consumed nonce replay'
);

RESET ROLE;

UPDATE public.admin_sessions
SET revoked_at = null, revoke_reason = null
WHERE id = '00000000-0000-4000-8000-000000000721'::uuid;

INSERT INTO private.admin_audit_events (
  request_id,
  environment_id,
  actor_principal_id,
  actor_membership_id,
  action,
  target_type,
  target_id,
  result
)
SELECT
  gen_random_uuid(),
  membership.environment_id,
  principal.id,
  membership.id,
  'admin_identity.admit',
  'admin_membership',
  membership.id::text,
  'accepted'
FROM private.admin_principals AS principal
JOIN private.admin_environment_memberships AS membership
  ON membership.principal_id = principal.id
CROSS JOIN generate_series(1, 30)
WHERE principal.auth_user_id = '00000000-0000-4000-8000-000000000701'::uuid;

INSERT INTO private.admin_audit_events (
  request_id,
  environment_id,
  actor_principal_id,
  actor_membership_id,
  action,
  target_type,
  target_id,
  result
)
SELECT
  gen_random_uuid(),
  membership.environment_id,
  principal.id,
  membership.id,
  'admin_step_up.begin',
  'admin_step_up_nonce',
  gen_random_uuid()::text,
  'accepted'
FROM private.admin_principals AS principal
JOIN private.admin_environment_memberships AS membership
  ON membership.principal_id = principal.id
CROSS JOIN generate_series(1, 10)
WHERE principal.auth_user_id = '00000000-0000-4000-8000-000000000701'::uuid;

SET ROLE service_role;
SELECT throws_ok(
  $$
    SELECT public.consume_admin_identity_admission_v1(
      '00000000-0000-4000-8000-000000000730'::uuid,
      '00000000-0000-4000-8000-000000000701'::uuid,
      'https://accounts.google.com',
      repeat('a', 64),
      1,
      'owner-one@example.test',
      repeat('1', 64),
      'Owner One',
      '00000000-0000-4000-8000-000000000752'::uuid,
      null
    )
  $$,
  'P7301',
  'Admin identity admission rate exceeded',
  'admitted principals cannot grow audit storage without a bounded rate'
);

SELECT throws_ok(
  $$
    SELECT public.begin_admin_totp_step_up_v1(
      '00000000-0000-4000-8000-000000000730'::uuid,
      '00000000-0000-4000-8000-000000000701'::uuid,
      '00000000-0000-4000-8000-000000000711'::uuid,
      repeat('7', 64),
      '00000000-0000-4000-8000-000000000722'::uuid,
      repeat('6', 64),
      '00000000-0000-4000-8000-000000000753'::uuid
    )
  $$,
  'P7301',
  'Admin TOTP step-up rate exceeded',
  'TOTP retries are bounded without weakening the ten-attempt teacher budget'
);
RESET ROLE;

SELECT throws_ok(
  $$
    UPDATE private.admin_environment_memberships
    SET
      status = 'revoked',
      revoked_at = statement_timestamp(),
      status_reason = 'test'
    WHERE id = (
      SELECT membership_id
      FROM public.admin_sessions
      WHERE id = '00000000-0000-4000-8000-000000000721'::uuid
    )
  $$,
  'P7310',
  'An environment must retain an active owner',
  'the first active owner seals the no-zero-owner invariant'
);

SELECT throws_ok(
  $$
    UPDATE private.admin_audit_events
    SET metadata = '{}'::jsonb
    WHERE id = (SELECT min(id) FROM private.admin_audit_events)
  $$,
  '42501',
  'Admin audit events are append-only',
  'Admin audit rows cannot be rewritten'
);

SELECT ok(
  (
    SELECT owner_invariant_enforced_at IS NOT NULL
    FROM private.admin_environments
    WHERE id = '00000000-0000-4000-8000-000000000730'::uuid
  ),
  'owner invariant is sealed only after the first successful TOTP activation'
);

SET ROLE service_role;
SELECT is(
  (
    public.consume_admin_identity_admission_v1(
      '00000000-0000-4000-8000-000000000730'::uuid,
      '00000000-0000-4000-8000-000000000702'::uuid,
      'https://accounts.google.com',
      repeat('8', 64),
      1,
      'owner-two@example.test',
      repeat('2', 64),
      'Owner Two',
      '00000000-0000-4000-8000-000000000739'::uuid,
      null
    ) ->> 'eligible'
  ),
  'true',
  'the second bootstrap owner remains independently admissible'
);
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
