BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path = public, extensions;
SELECT no_plan();

CREATE FUNCTION pg_temp.seed_d_admin_control_grant(
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
      extensions.digest('d-control:' || target_request_id::text, 'sha256'),
      'hex'
    ),
    session_row.environment_id, session_row.principal_id,
    session_row.membership_id, session_row.id,
    session_row.supabase_auth_session_id,
    session_row.verified_totp_factor_set_hash, target_action,
    target_intent_digest, target_request_id,
    encode(
      extensions.digest('d-control-pre:' || target_request_id::text, 'sha256'),
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
      extensions.digest('d-control-pre:' || target_request_id::text, 'sha256'),
      'hex'
    ),
    encode(
      extensions.digest('d-control-post:' || target_request_id::text, 'sha256'),
      'hex'
    ),
    effective_now - interval '1 minute', effective_now - interval '1 minute',
    effective_now, effective_now + interval '4 minutes'
  );
END;
$$;

SELECT ok(
  (
    SELECT class.relrowsecurity
    FROM pg_class AS class
    JOIN pg_namespace AS namespace ON namespace.oid = class.relnamespace
    WHERE namespace.nspname = 'private'
      AND class.relname = 'admin_invitation_redemption_receipts'
  )
  AND NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'private'
      AND tablename = 'admin_invitation_redemption_receipts'
  )
  AND NOT has_table_privilege(
    'service_role',
    'private.admin_invitation_redemption_receipts',
    'SELECT'
  )
  AND NOT has_table_privilege(
    'service_role',
    'private.admin_invitation_redemption_receipts',
    'INSERT'
  )
  AND NOT has_table_privilege(
    'anon',
    'private.admin_invitation_redemption_receipts',
    'SELECT'
  )
  AND NOT has_table_privilege(
    'authenticated',
    'private.admin_invitation_redemption_receipts',
    'SELECT'
  ),
  'invitation redemption evidence is private, RLS-protected and policy-free'
);

CREATE TEMP TABLE d_public_facades(signature text PRIMARY KEY) ON COMMIT DROP;
INSERT INTO d_public_facades(signature) VALUES
  ('public.get_google_admin_ledger_v1(text,uuid,uuid,text,text,integer,boolean)'),
  ('public.get_google_admin_ledger_audit_v1(text,uuid,uuid,text,text,integer,boolean,timestamp with time zone,bigint,integer)'),
  ('public.get_google_admin_ledger_intent_v1(text,uuid,uuid,text,text,integer,boolean,text,uuid,jsonb)'),
  ('public.begin_google_admin_owner_control_step_up_v1(text,uuid,uuid,text,text,integer,boolean,text,uuid,text,text,text)'),
  ('public.complete_google_admin_owner_control_step_up_v1(text,uuid,uuid,text,text,integer,boolean,text,text,uuid,text,text,timestamp with time zone,text,timestamp with time zone)'),
  ('public.manage_google_admin_ledger_v1(text,uuid,uuid,text,text,integer,boolean,text,uuid,jsonb,text)');

SELECT ok(
  NOT EXISTS (
    SELECT 1
    FROM d_public_facades AS facade
    JOIN pg_proc AS procedure ON procedure.oid = facade.signature::regprocedure
    WHERE pg_get_userbyid(procedure.proowner) <> 'postgres'
      OR NOT procedure.prosecdef
      OR NOT coalesce(
        procedure.proconfig @> ARRAY['search_path=""']::text[],
        false
      )
      OR NOT has_function_privilege(
        'service_role', facade.signature, 'EXECUTE'
      )
      OR has_function_privilege('anon', facade.signature, 'EXECUTE')
      OR has_function_privilege('authenticated', facade.signature, 'EXECUTE')
  ),
  'all D public facades are fixed-path service-role-only security definers'
);

SELECT ok(
  (
    SELECT count(*) = 13
      AND count(*) FILTER (WHERE access_scope = 'environment_owner') = 13
      AND count(*) FILTER (WHERE owner_requires_ai) = 0
      AND count(*) FILTER (WHERE gate_mode = 'required') = 4
      AND count(*) FILTER (WHERE gate_mode = 'gate_independent') = 9
      AND count(*) FILTER (WHERE operation_class = 'read') = 2
      AND count(*) FILTER (WHERE operation_class = 'write') = 4
      AND count(*) FILTER (WHERE operation_class = 'free_control') = 7
    FROM private.admin_google_operation_policies
    WHERE edge_function = 'manage-admin-ledger'
  ),
  'the D ledger policy matrix is closed and owner AI entitlement independent'
);

INSERT INTO auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) VALUES
  (
    '00000000-0000-0000-0000-000000000000'::uuid,
    '00000000-0000-4000-8000-00000000d102'::uuid,
    'authenticated', 'authenticated', 'phase730d-owner@example.test', '',
    statement_timestamp() - interval '1 hour',
    '{"provider":"google","providers":["google"]}'::jsonb, '{}'::jsonb,
    statement_timestamp() - interval '1 hour',
    statement_timestamp() - interval '1 hour'
  ),
  (
    '00000000-0000-0000-0000-000000000000'::uuid,
    '00000000-0000-4000-8000-00000000d112'::uuid,
    'authenticated', 'authenticated', 'phase730d-instructor@example.test', '',
    statement_timestamp() - interval '1 hour',
    '{"provider":"google","providers":["google"]}'::jsonb, '{}'::jsonb,
    statement_timestamp() - interval '1 hour',
    statement_timestamp() - interval '1 hour'
  ),
  (
    '00000000-0000-0000-0000-000000000000'::uuid,
    '00000000-0000-4000-8000-00000000d122'::uuid,
    'authenticated', 'authenticated', 'phase730d-invitee@example.test', '',
    statement_timestamp() - interval '1 hour',
    '{"provider":"google","providers":["google"]}'::jsonb, '{}'::jsonb,
    statement_timestamp() - interval '1 hour',
    statement_timestamp() - interval '1 hour'
  );

INSERT INTO auth.sessions (id, user_id, created_at, updated_at) VALUES
  (
    '00000000-0000-4000-8000-00000000d103'::uuid,
    '00000000-0000-4000-8000-00000000d102'::uuid,
    statement_timestamp() - interval '1 hour',
    statement_timestamp() - interval '1 hour'
  ),
  (
    '00000000-0000-4000-8000-00000000d113'::uuid,
    '00000000-0000-4000-8000-00000000d112'::uuid,
    statement_timestamp() - interval '1 hour',
    statement_timestamp() - interval '1 hour'
  );

INSERT INTO auth.mfa_factors (
  id, user_id, friendly_name, factor_type, status, created_at, updated_at
) VALUES
  (
    '00000000-0000-4000-8000-00000000d104'::uuid,
    '00000000-0000-4000-8000-00000000d102'::uuid,
    'phase730d-owner-totp', 'totp', 'verified',
    statement_timestamp() - interval '1 hour',
    statement_timestamp() - interval '1 hour'
  ),
  (
    '00000000-0000-4000-8000-00000000d114'::uuid,
    '00000000-0000-4000-8000-00000000d112'::uuid,
    'phase730d-instructor-totp', 'totp', 'verified',
    statement_timestamp() - interval '1 hour',
    statement_timestamp() - interval '1 hour'
  );

INSERT INTO private.admin_environments (
  id, environment_kind, canonical_admin_origin, supabase_issuer,
  current_deployment, bootstrap_sealed_at, owner_invariant_enforced_at
) VALUES (
  '00000000-0000-4000-8000-00000000d101'::uuid,
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
    '00000000-0000-4000-8000-00000000d105'::uuid,
    '00000000-0000-4000-8000-00000000d102'::uuid,
    'https://accounts.google.com', repeat('a', 64), 1,
    'phase730d-owner@example.test', statement_timestamp() - interval '1 hour',
    'Phase 7.30D Owner'
  ),
  (
    '00000000-0000-4000-8000-00000000d115'::uuid,
    '00000000-0000-4000-8000-00000000d112'::uuid,
    'https://accounts.google.com', repeat('b', 64), 1,
    'phase730d-instructor@example.test',
    statement_timestamp() - interval '1 hour', 'Phase 7.30D Instructor'
  ),
  (
    '00000000-0000-4000-8000-00000000d125'::uuid,
    '00000000-0000-4000-8000-00000000d122'::uuid,
    'https://accounts.google.com', repeat('c', 64), 1,
    'phase730d-invitee@example.test',
    statement_timestamp() - interval '1 hour', 'Phase 7.30D Invitee'
  );

UPDATE private.admin_principals
SET
  approved_totp_factor_set_hash = snapshot.factor_set_hash,
  approved_totp_factor_set_version = 1,
  approved_totp_factor_count = snapshot.factor_count,
  approved_totp_factor_set_at = statement_timestamp() - interval '30 minutes',
  approved_totp_factor_set_request_id =
    '00000000-0000-4000-8000-00000000d109'::uuid,
  approved_totp_factor_set_source = 'operator_adoption',
  approved_totp_factor_set_actor = 'fixture:phase730d',
  approved_totp_factor_set_reason = 'D ledger runtime fixture'
FROM private.current_verified_totp_factor_set_snapshot_v1(
  '00000000-0000-4000-8000-00000000d102'::uuid
) AS snapshot
WHERE id = '00000000-0000-4000-8000-00000000d105'::uuid;

UPDATE private.admin_principals
SET
  approved_totp_factor_set_hash = snapshot.factor_set_hash,
  approved_totp_factor_set_version = 1,
  approved_totp_factor_count = snapshot.factor_count,
  approved_totp_factor_set_at = statement_timestamp() - interval '30 minutes',
  approved_totp_factor_set_request_id =
    '00000000-0000-4000-8000-00000000d119'::uuid,
  approved_totp_factor_set_source = 'operator_adoption',
  approved_totp_factor_set_actor = 'fixture:phase730d',
  approved_totp_factor_set_reason = 'D ledger runtime fixture'
FROM private.current_verified_totp_factor_set_snapshot_v1(
  '00000000-0000-4000-8000-00000000d112'::uuid
) AS snapshot
WHERE id = '00000000-0000-4000-8000-00000000d115'::uuid;

INSERT INTO private.admin_environment_memberships (
  id, environment_id, principal_id, role, status, can_use_ai, activated_at
) VALUES
  (
    '00000000-0000-4000-8000-00000000d106'::uuid,
    '00000000-0000-4000-8000-00000000d101'::uuid,
    '00000000-0000-4000-8000-00000000d105'::uuid,
    'owner', 'active', true, statement_timestamp() - interval '1 hour'
  ),
  (
    '00000000-0000-4000-8000-00000000d116'::uuid,
    '00000000-0000-4000-8000-00000000d101'::uuid,
    '00000000-0000-4000-8000-00000000d115'::uuid,
    'instructor', 'active', true, statement_timestamp() - interval '1 hour'
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
    '00000000-0000-4000-8000-00000000d107'::uuid, repeat('3', 64),
    '00000000-0000-4000-8000-00000000d108'::uuid,
    '00000000-0000-4000-8000-00000000d101'::uuid,
    '00000000-0000-4000-8000-00000000d105'::uuid,
    '00000000-0000-4000-8000-00000000d106'::uuid,
    '00000000-0000-4000-8000-00000000d103'::uuid,
    'admin_login', '00000000-0000-4000-8000-00000000d109'::uuid,
    repeat('4', 64), statement_timestamp() - interval '1 minute',
    '00000000-0000-4000-8000-00000000d104'::uuid,
    private.current_verified_totp_factor_set_hash_v1(
      '00000000-0000-4000-8000-00000000d102'::uuid
    ),
    private.current_verified_totp_factor_set_hash_v1(
      '00000000-0000-4000-8000-00000000d102'::uuid
    ),
    false, 1, repeat('5', 64), statement_timestamp(),
    statement_timestamp() - interval '1 minute',
    statement_timestamp() + interval '4 minutes'
  ),
  (
    '00000000-0000-4000-8000-00000000d117'::uuid, repeat('6', 64),
    '00000000-0000-4000-8000-00000000d118'::uuid,
    '00000000-0000-4000-8000-00000000d101'::uuid,
    '00000000-0000-4000-8000-00000000d115'::uuid,
    '00000000-0000-4000-8000-00000000d116'::uuid,
    '00000000-0000-4000-8000-00000000d113'::uuid,
    'admin_login', '00000000-0000-4000-8000-00000000d119'::uuid,
    repeat('7', 64), statement_timestamp() - interval '1 minute',
    '00000000-0000-4000-8000-00000000d114'::uuid,
    private.current_verified_totp_factor_set_hash_v1(
      '00000000-0000-4000-8000-00000000d112'::uuid
    ),
    private.current_verified_totp_factor_set_hash_v1(
      '00000000-0000-4000-8000-00000000d112'::uuid
    ),
    false, 1, repeat('8', 64), statement_timestamp(),
    statement_timestamp() - interval '1 minute',
    statement_timestamp() + interval '4 minutes'
  );

UPDATE private.admin_identity_runtime_gate
SET google_session_issue_enabled = true, google_admin_ledger_enabled = false
WHERE singleton;

INSERT INTO public.admin_sessions (
  id, token_hash, auth_user_id, pin_version_hash, authentication_method, aal,
  principal_id, membership_id, environment_id, supabase_auth_session_id,
  step_up_verified_at, step_up_nonce_id, verified_totp_factor_set_hash,
  issued_at, last_seen_at, idle_expires_at, expires_at
) VALUES
  (
    '00000000-0000-4000-8000-00000000d108'::uuid, repeat('1', 64),
    '00000000-0000-4000-8000-00000000d102'::uuid,
    null, 'google_totp', 2,
    '00000000-0000-4000-8000-00000000d105'::uuid,
    '00000000-0000-4000-8000-00000000d106'::uuid,
    '00000000-0000-4000-8000-00000000d101'::uuid,
    '00000000-0000-4000-8000-00000000d103'::uuid,
    statement_timestamp(),
    '00000000-0000-4000-8000-00000000d107'::uuid,
    private.current_verified_totp_factor_set_hash_v1(
      '00000000-0000-4000-8000-00000000d102'::uuid
    ),
    statement_timestamp() - interval '1 hour',
    statement_timestamp() - interval '1 hour',
    statement_timestamp() + interval '12 hours',
    statement_timestamp() + interval '12 hours'
  ),
  (
    '00000000-0000-4000-8000-00000000d118'::uuid, repeat('2', 64),
    '00000000-0000-4000-8000-00000000d112'::uuid,
    null, 'google_totp', 2,
    '00000000-0000-4000-8000-00000000d115'::uuid,
    '00000000-0000-4000-8000-00000000d116'::uuid,
    '00000000-0000-4000-8000-00000000d101'::uuid,
    '00000000-0000-4000-8000-00000000d113'::uuid,
    statement_timestamp(),
    '00000000-0000-4000-8000-00000000d117'::uuid,
    private.current_verified_totp_factor_set_hash_v1(
      '00000000-0000-4000-8000-00000000d112'::uuid
    ),
    statement_timestamp() - interval '1 hour',
    statement_timestamp() - interval '1 hour',
    statement_timestamp() + interval '12 hours',
    statement_timestamp() + interval '12 hours'
  );

UPDATE private.admin_step_up_nonces
SET status = 'consumed', consumed_at = statement_timestamp(),
    completed_admin_session_id = case id
      when '00000000-0000-4000-8000-00000000d107'::uuid
        then '00000000-0000-4000-8000-00000000d108'::uuid
      else '00000000-0000-4000-8000-00000000d118'::uuid
    end,
    updated_at = statement_timestamp()
WHERE id IN (
  '00000000-0000-4000-8000-00000000d107'::uuid,
  '00000000-0000-4000-8000-00000000d117'::uuid
);

INSERT INTO private.admin_ai_unlock_factors (
  id, environment_id, principal_id, membership_id, pin_verifier,
  pin_pepper_version, factor_version, enrolled_by_admin_session_id,
  enrolled_step_up_verified_at, enrollment_request_id
) VALUES (
  '00000000-0000-4000-8000-00000000d11a'::uuid,
  '00000000-0000-4000-8000-00000000d101'::uuid,
  '00000000-0000-4000-8000-00000000d115'::uuid,
  '00000000-0000-4000-8000-00000000d116'::uuid,
  extensions.crypt(repeat('f', 64), extensions.gen_salt('bf', 12)),
  1, 1,
  '00000000-0000-4000-8000-00000000d108'::uuid,
  statement_timestamp(),
  '00000000-0000-4000-8000-00000000d11b'::uuid
);

SET ROLE service_role;
SELECT ok(
  public.get_google_admin_ledger_v1(
    repeat('1', 64),
    '00000000-0000-4000-8000-00000000d102'::uuid,
    '00000000-0000-4000-8000-00000000d103'::uuid,
    'https://accounts.google.com', repeat('a', 64), 1, false
  ) @> jsonb_build_object(
    'ok', true,
    'environmentKind', 'local',
    'ledgerAdmissionEnabled', false,
    'currentMembershipId', '00000000-0000-4000-8000-00000000d106'
  )
  AND EXISTS (
    SELECT 1
    FROM jsonb_array_elements(
      public.get_google_admin_ledger_v1(
        repeat('1', 64),
        '00000000-0000-4000-8000-00000000d102'::uuid,
        '00000000-0000-4000-8000-00000000d103'::uuid,
        'https://accounts.google.com', repeat('a', 64), 1, false
      ) -> 'memberships'
    ) AS membership(value)
    WHERE membership.value ->> 'membershipId' =
      '00000000-0000-4000-8000-00000000d106'
      AND membership.value ->> 'canUseAi' = 'true'
  ),
  'an owner with the complete capability set can read the default-OFF ledger'
);

SELECT is(
  public.get_google_admin_ledger_v1(
    repeat('2', 64),
    '00000000-0000-4000-8000-00000000d112'::uuid,
    '00000000-0000-4000-8000-00000000d113'::uuid,
    'https://accounts.google.com', repeat('b', 64), 1, false
  ),
  null::jsonb,
  'an instructor cannot read the owner ledger'
);

SELECT throws_ok(
  $$
    SELECT public.get_google_admin_ledger_intent_v1(
      repeat('1', 64),
      '00000000-0000-4000-8000-00000000d102'::uuid,
      '00000000-0000-4000-8000-00000000d103'::uuid,
      'https://accounts.google.com', repeat('a', 64), 1, true,
      'issueInvitation',
      '00000000-0000-4000-8000-00000000d201'::uuid,
      jsonb_build_object(
        'normalized_email', 'phase730d-invitee@example.test',
        'email_hmac', repeat('d', 64),
        'email_pepper_version', 1,
        'invitation_token_hash', repeat('e', 64),
        'role', 'instructor', 'can_use_ai', true,
        'membership_expires_at', transaction_timestamp() + interval '7 days',
        'expires_at', transaction_timestamp() + interval '2 days'
      )
    )
  $$,
  'P7337',
  'Google Admin ledger admission is disabled',
  'default-OFF denies a new invitation intent'
);
RESET ROLE;

CREATE TEMP TABLE d_values(name text PRIMARY KEY, value jsonb) ON COMMIT DROP;
INSERT INTO d_values(name, value) VALUES (
  'issue_payload',
  jsonb_build_object(
    'normalized_email', 'phase730d-invitee@example.test',
    'email_hmac', repeat('d', 64),
    'email_pepper_version', 1,
    'invitation_token_hash', repeat('e', 64),
    'role', 'instructor', 'can_use_ai', true,
    'membership_expires_at', transaction_timestamp() + interval '7 days',
    'expires_at', transaction_timestamp() + interval '2 days'
  )
);
GRANT SELECT ON d_values TO service_role;

UPDATE private.admin_identity_runtime_gate
SET google_admin_ledger_enabled = true
WHERE singleton;

SET ROLE service_role;
SELECT ok(
  set_config(
    'compass.test.d.issue_intent',
    public.get_google_admin_ledger_intent_v1(
      repeat('1', 64),
      '00000000-0000-4000-8000-00000000d102'::uuid,
      '00000000-0000-4000-8000-00000000d103'::uuid,
      'https://accounts.google.com', repeat('a', 64), 1, true,
      'issueInvitation',
      '00000000-0000-4000-8000-00000000d201'::uuid,
      (SELECT value FROM d_values WHERE name = 'issue_payload')
    )::text,
    false
  )::jsonb @> '{"ok":true}'::jsonb,
  'the enabled ledger prepares an invitation intent'
);
RESET ROLE;

SELECT pg_temp.seed_d_admin_control_grant(
  '00000000-0000-4000-8000-00000000d108'::uuid,
  current_setting('compass.test.d.issue_intent')::jsonb
    ->> 'controlStepUpAction',
  '00000000-0000-4000-8000-00000000d201'::uuid,
  current_setting('compass.test.d.issue_intent')::jsonb ->> 'intentDigest'
);

SET ROLE service_role;
SELECT ok(
  set_config(
    'compass.test.d.issue_result',
    public.manage_google_admin_ledger_v1(
      repeat('1', 64),
      '00000000-0000-4000-8000-00000000d102'::uuid,
      '00000000-0000-4000-8000-00000000d103'::uuid,
      'https://accounts.google.com', repeat('a', 64), 1, true,
      'issueInvitation',
      '00000000-0000-4000-8000-00000000d201'::uuid,
      (SELECT value FROM d_values WHERE name = 'issue_payload'),
      current_setting('compass.test.d.issue_intent')::jsonb ->> 'intentDigest'
    )::text,
    false
  )::jsonb @> '{"ok":true,"idempotentReplay":false}'::jsonb,
  'one owner-controlled invitation is issued'
);

SELECT ok(
  set_config(
    'compass.test.d.issue_replay',
    public.manage_google_admin_ledger_v1(
      repeat('1', 64),
      '00000000-0000-4000-8000-00000000d102'::uuid,
      '00000000-0000-4000-8000-00000000d103'::uuid,
      'https://accounts.google.com', repeat('a', 64), 1, true,
      'issueInvitation',
      '00000000-0000-4000-8000-00000000d201'::uuid,
      (SELECT value FROM d_values WHERE name = 'issue_payload'),
      current_setting('compass.test.d.issue_intent')::jsonb ->> 'intentDigest'
    )::text,
    false
  )::jsonb @> '{"ok":true,"idempotentReplay":true}'::jsonb,
  'an exact invitation replay returns the original result without new evidence'
);

SELECT throws_ok(
  $$
    SELECT public.manage_google_admin_ledger_v1(
      repeat('1', 64),
      '00000000-0000-4000-8000-00000000d102'::uuid,
      '00000000-0000-4000-8000-00000000d103'::uuid,
      'https://accounts.google.com', repeat('a', 64), 1, true,
      'issueInvitation',
      '00000000-0000-4000-8000-00000000d201'::uuid,
      (SELECT value || '{"can_use_ai":false}'::jsonb
       FROM d_values WHERE name = 'issue_payload'),
      current_setting('compass.test.d.issue_intent')::jsonb ->> 'intentDigest'
    )
  $$,
  'P7335',
  'Admin ledger request binding does not match its receipt',
  'the same request ID cannot be rebound to changed invitation authority'
);
RESET ROLE;

UPDATE private.admin_identity_runtime_gate
SET google_admin_ledger_enabled = false
WHERE singleton;

SET ROLE service_role;
SELECT is(
  public.consume_admin_identity_admission_v1(
    '00000000-0000-4000-8000-00000000d101'::uuid,
    '00000000-0000-4000-8000-00000000d122'::uuid,
    'https://accounts.google.com', repeat('c', 64), 1,
    'phase730d-invitee@example.test', repeat('d', 64),
    'Phase 7.30D Invitee',
    '00000000-0000-4000-8000-00000000d202'::uuid,
    repeat('e', 64)
  ),
  '{"eligible":false}'::jsonb,
  'the ledger kill switch rejects a pending D invitation'
);
RESET ROLE;

SELECT ok(
  (
    SELECT status = 'pending'
      AND accepted_membership_id IS NULL
    FROM private.admin_invitations
    WHERE request_id = '00000000-0000-4000-8000-00000000d201'::uuid
  )
  AND NOT EXISTS (
    SELECT 1
    FROM private.admin_environment_memberships
    WHERE environment_id = '00000000-0000-4000-8000-00000000d101'::uuid
      AND principal_id = '00000000-0000-4000-8000-00000000d125'::uuid
  )
  AND NOT EXISTS (
    SELECT 1
    FROM private.admin_invitation_redemption_receipts
    WHERE admission_request_id =
      '00000000-0000-4000-8000-00000000d202'::uuid
  ),
  'the rejected invitation creates no membership or redemption evidence'
);

UPDATE private.admin_identity_runtime_gate
SET google_admin_ledger_enabled = true
WHERE singleton;

SET ROLE service_role;
SELECT ok(
  set_config(
    'compass.test.d.admission_result',
    public.consume_admin_identity_admission_v1(
      '00000000-0000-4000-8000-00000000d101'::uuid,
      '00000000-0000-4000-8000-00000000d122'::uuid,
      'https://accounts.google.com', repeat('c', 64), 1,
      'phase730d-invitee@example.test', repeat('d', 64),
      'Phase 7.30D Invitee',
      '00000000-0000-4000-8000-00000000d202'::uuid,
      repeat('e', 64)
    )::text,
    false
  )::jsonb @> '{"eligible":true,"idempotent_replay":false}'::jsonb,
  'an invited existing Google principal joins the current environment'
);

SELECT ok(
  set_config(
    'compass.test.d.admission_replay',
    public.consume_admin_identity_admission_v1(
      '00000000-0000-4000-8000-00000000d101'::uuid,
      '00000000-0000-4000-8000-00000000d122'::uuid,
      'https://accounts.google.com', repeat('c', 64), 1,
      'phase730d-invitee@example.test', repeat('d', 64),
      'Phase 7.30D Invitee',
      '00000000-0000-4000-8000-00000000d202'::uuid,
      repeat('e', 64)
    )::text,
    false
  )::jsonb @> '{"eligible":true,"idempotent_replay":true}'::jsonb,
  'admission exact replay returns the immutable acceptance result'
);
RESET ROLE;

SELECT ok(
  current_setting('compass.test.d.issue_replay')::jsonb
    @> '{"ok":true,"idempotentReplay":true}'::jsonb
  AND (
    SELECT count(*) = 1
    FROM private.admin_invitations
    WHERE request_id = '00000000-0000-4000-8000-00000000d201'::uuid
  )
  AND (
    SELECT count(*) = 1
    FROM private.admin_google_operation_receipts
    WHERE request_id = '00000000-0000-4000-8000-00000000d201'::uuid
  )
  AND (
    SELECT count(*) = 1
    FROM private.admin_audit_events
    WHERE request_id = '00000000-0000-4000-8000-00000000d201'::uuid
      AND action = 'admin_ledger.issueInvitation'
  ),
  'invitation exact replay creates no second invitation, receipt or audit row'
);

SELECT ok(
  (
    SELECT membership.principal_id =
        '00000000-0000-4000-8000-00000000d125'::uuid
      AND membership.status = 'pending_mfa'
      AND membership.role = 'instructor'
      AND membership.can_use_ai
      AND membership.expires_at = invitation.membership_expires_at
      AND invitation.status = 'accepted'
    FROM private.admin_environment_memberships AS membership
    JOIN private.admin_invitations AS invitation
      ON invitation.accepted_membership_id = membership.id
    WHERE membership.environment_id =
      '00000000-0000-4000-8000-00000000d101'::uuid
      AND membership.principal_id =
        '00000000-0000-4000-8000-00000000d125'::uuid
  )
  AND (
    SELECT count(*) = 1
    FROM private.admin_invitation_redemption_receipts
    WHERE admission_request_id =
      '00000000-0000-4000-8000-00000000d202'::uuid
  ),
  'admission preserves the existing principal and copies invitation authority'
);

SELECT ok(
  current_setting('compass.test.d.admission_replay')::jsonb
    @> '{"eligible":true,"idempotent_replay":true}'::jsonb
  AND (
    SELECT count(*) = 1
    FROM private.admin_invitation_redemption_receipts
    WHERE admission_request_id =
      '00000000-0000-4000-8000-00000000d202'::uuid
  ),
  'admission exact replay returns the immutable acceptance result'
);

UPDATE private.admin_identity_runtime_gate
SET google_admin_ledger_enabled = false
WHERE singleton;

INSERT INTO d_values(name, value) VALUES (
  'demote_payload',
  jsonb_build_object(
    'expected_role', 'owner',
    'expected_status', 'active',
    'expected_updated_at', (
      SELECT updated_at
      FROM private.admin_environment_memberships
      WHERE id = '00000000-0000-4000-8000-00000000d106'::uuid
    ),
    'membership_expires_at', transaction_timestamp() + interval '30 days',
    'membership_id', '00000000-0000-4000-8000-00000000d106',
    'reason_code', 'owner_demotion'
  )
), (
  'suspend_payload',
  jsonb_build_object(
    'expected_status', 'active',
    'expected_updated_at', (
      SELECT updated_at
      FROM private.admin_environment_memberships
      WHERE id = '00000000-0000-4000-8000-00000000d116'::uuid
    ),
    'membership_id', '00000000-0000-4000-8000-00000000d116',
    'reason_code', 'owner_suspension'
  )
);

SET ROLE service_role;
SELECT ok(
  set_config(
    'compass.test.d.demote_intent',
    public.get_google_admin_ledger_intent_v1(
      repeat('1', 64),
      '00000000-0000-4000-8000-00000000d102'::uuid,
      '00000000-0000-4000-8000-00000000d103'::uuid,
      'https://accounts.google.com', repeat('a', 64), 1, false,
      'demoteOwner',
      '00000000-0000-4000-8000-00000000d203'::uuid,
      (SELECT value FROM d_values WHERE name = 'demote_payload')
    )::text,
    false
  ) <> '',
  'gate-independent owner demotion prepares while admission is OFF'
);
RESET ROLE;

SELECT pg_temp.seed_d_admin_control_grant(
  '00000000-0000-4000-8000-00000000d108'::uuid,
  current_setting('compass.test.d.demote_intent')::jsonb
    ->> 'controlStepUpAction',
  '00000000-0000-4000-8000-00000000d203'::uuid,
  current_setting('compass.test.d.demote_intent')::jsonb ->> 'intentDigest'
);

SET ROLE service_role;
SELECT throws_ok(
  $$
    SELECT public.manage_google_admin_ledger_v1(
      repeat('1', 64),
      '00000000-0000-4000-8000-00000000d102'::uuid,
      '00000000-0000-4000-8000-00000000d103'::uuid,
      'https://accounts.google.com', repeat('a', 64), 1, false,
      'demoteOwner',
      '00000000-0000-4000-8000-00000000d203'::uuid,
      (SELECT value FROM d_values WHERE name = 'demote_payload'),
      current_setting('compass.test.d.demote_intent')::jsonb ->> 'intentDigest'
    )
  $$,
  'P7310',
  'An environment must retain an active owner',
  'the final active owner cannot be demoted'
);
RESET ROLE;

SELECT ok(
  (
    SELECT role = 'owner' AND status = 'active'
    FROM private.admin_environment_memberships
    WHERE id = '00000000-0000-4000-8000-00000000d106'::uuid
  )
  AND NOT EXISTS (
    SELECT 1
    FROM private.admin_google_operation_receipts
    WHERE request_id = '00000000-0000-4000-8000-00000000d203'::uuid
  )
  AND EXISTS (
    SELECT 1
    FROM private.admin_control_step_up_grants
    WHERE mutation_request_id =
      '00000000-0000-4000-8000-00000000d203'::uuid
      AND consumed_at IS NULL
  ),
  'failed last-owner mutation rolls back membership, receipt and grant consume'
);

SET ROLE service_role;
SELECT ok(
  set_config(
    'compass.test.d.suspend_intent',
    public.get_google_admin_ledger_intent_v1(
      repeat('1', 64),
      '00000000-0000-4000-8000-00000000d102'::uuid,
      '00000000-0000-4000-8000-00000000d103'::uuid,
      'https://accounts.google.com', repeat('a', 64), 1, false,
      'suspendMembership',
      '00000000-0000-4000-8000-00000000d204'::uuid,
      (SELECT value FROM d_values WHERE name = 'suspend_payload')
    )::text,
    false
  ) <> '',
  'gate-independent suspension prepares while admission is OFF'
);
RESET ROLE;

SELECT pg_temp.seed_d_admin_control_grant(
  '00000000-0000-4000-8000-00000000d108'::uuid,
  current_setting('compass.test.d.suspend_intent')::jsonb
    ->> 'controlStepUpAction',
  '00000000-0000-4000-8000-00000000d204'::uuid,
  current_setting('compass.test.d.suspend_intent')::jsonb ->> 'intentDigest'
);

SET ROLE service_role;
SELECT ok(
  public.manage_google_admin_ledger_v1(
    repeat('1', 64),
    '00000000-0000-4000-8000-00000000d102'::uuid,
    '00000000-0000-4000-8000-00000000d103'::uuid,
    'https://accounts.google.com', repeat('a', 64), 1, false,
    'suspendMembership',
    '00000000-0000-4000-8000-00000000d204'::uuid,
    (SELECT value FROM d_values WHERE name = 'suspend_payload'),
    current_setting('compass.test.d.suspend_intent')::jsonb ->> 'intentDigest'
  ) @> '{"ok":true,"resultStatus":"suspended"}'::jsonb,
  'safe membership suspension succeeds while admission is OFF'
);
RESET ROLE;

SELECT ok(
  (
    SELECT status = 'suspended'
    FROM private.admin_environment_memberships
    WHERE id = '00000000-0000-4000-8000-00000000d116'::uuid
  )
  AND (
    SELECT revoked_at IS NOT NULL
      AND revoke_reason = 'membership_suspended'
    FROM public.admin_sessions
    WHERE id = '00000000-0000-4000-8000-00000000d118'::uuid
  )
  AND (
    SELECT revoked_at IS NOT NULL
      AND terminal_request_id =
        '00000000-0000-4000-8000-00000000d204'::uuid
      AND terminal_action = 'reset'
    FROM private.admin_ai_unlock_factors
    WHERE id = '00000000-0000-4000-8000-00000000d11a'::uuid
  )
  AND (
    SELECT count(*) = 1
    FROM private.admin_google_operation_receipts
    WHERE request_id = '00000000-0000-4000-8000-00000000d204'::uuid
  )
  AND (
    SELECT count(*) = 1
    FROM private.admin_audit_events
    WHERE request_id = '00000000-0000-4000-8000-00000000d204'::uuid
      AND action = 'admin_ledger.suspendMembership'
  ),
  'suspension drains the target session and persistent AI authority atomically'
);

-- One-step teacher AI administration reuses the verified Owner/grant fixture.
-- These cases remain in the local test transaction; all identities are synthetic.
CREATE TEMP TABLE teacher_ai_values(name text PRIMARY KEY, value jsonb) ON COMMIT DROP;
GRANT SELECT ON teacher_ai_values TO service_role;

INSERT INTO teacher_ai_values VALUES (
  'terms',
  '{"max_cost_microusd_per_lecture":3000000,"max_cost_microusd_per_day":6000000,"validity_days":30}'::jsonb
), (
  'sessions_before',
  (SELECT jsonb_agg(jsonb_build_object(
    'id', id, 'issued_at', issued_at, 'expires_at', expires_at,
    'idle_expires_at', idle_expires_at, 'revoked_at', revoked_at,
    'supabase_auth_session_id', supabase_auth_session_id
  ) ORDER BY id) FROM public.admin_sessions
  WHERE environment_id = '00000000-0000-4000-8000-00000000d101'::uuid)
), (
  'auth_sessions_before',
  (SELECT jsonb_agg(to_jsonb(session) ORDER BY session.id)
   FROM auth.sessions AS session WHERE user_id IN (
     '00000000-0000-4000-8000-00000000d102'::uuid,
     '00000000-0000-4000-8000-00000000d112'::uuid
   ))
);

SELECT is(
  private.normalize_teacher_ai_policy_terms_v1(
    (SELECT value FROM teacher_ai_values WHERE name = 'terms')
  ),
  (SELECT value FROM teacher_ai_values WHERE name = 'terms'),
  'one-step terms preserve the approved USD 3 / USD 6 / 30-day policy'
);

SELECT throws_ok(
  format('SELECT private.normalize_teacher_ai_policy_terms_v1(%L::jsonb)', invalid_terms),
  '22023', null, 'one-step terms reject ' || label
)
FROM (VALUES
  ('non-object input', '[]'),
  ('missing fields', '{"max_cost_microusd_per_lecture":3000000,"validity_days":30}'),
  ('extra fields', '{"max_cost_microusd_per_lecture":3000000,"max_cost_microusd_per_day":6000000,"validity_days":30,"role":"owner"}'),
  ('string amounts', '{"max_cost_microusd_per_lecture":"3000000","max_cost_microusd_per_day":6000000,"validity_days":30}'),
  ('fractional amounts', '{"max_cost_microusd_per_lecture":3000000.5,"max_cost_microusd_per_day":6000000,"validity_days":30}'),
  ('an excessive lecture limit', '{"max_cost_microusd_per_lecture":5000001,"max_cost_microusd_per_day":6000000,"validity_days":30}'),
  ('a daily limit below the lecture limit', '{"max_cost_microusd_per_lecture":3000000,"max_cost_microusd_per_day":2000000,"validity_days":30}'),
  ('an excessive daily limit', '{"max_cost_microusd_per_lecture":3000000,"max_cost_microusd_per_day":20000001,"validity_days":30}'),
  ('an extended validity', '{"max_cost_microusd_per_lecture":3000000,"max_cost_microusd_per_day":6000000,"validity_days":31}')
) AS cases(label, invalid_terms);

SELECT ok(
  (SELECT relrowsecurity FROM pg_class
   WHERE oid = 'private.admin_invitation_ai_policy_contracts'::regclass)
  AND NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'private' AND tablename = 'admin_invitation_ai_policy_contracts'
  )
  AND NOT EXISTS (
    SELECT 1 FROM (VALUES ('anon'), ('authenticated'), ('service_role')) AS roles(name)
    WHERE has_table_privilege(name, 'private.admin_invitation_ai_policy_contracts',
      'SELECT,INSERT,UPDATE,DELETE')
  ),
  'invitation AI contracts have RLS and no direct client or service-role table access'
);

SELECT ok(
  NOT EXISTS (
    SELECT 1
    FROM (VALUES ('anon'), ('authenticated'), ('service_role')) AS roles(name)
    CROSS JOIN (VALUES
      ('private.normalize_teacher_ai_policy_terms_v1(jsonb)'),
      ('private.normalize_google_admin_ledger_payload_v1(text,jsonb)'),
      ('private.normalize_google_admin_ledger_payload_pre_one_step_v1(text,jsonb)'),
      ('private.apply_teacher_ai_policy_from_ledger_v1(uuid,uuid,jsonb)'),
      ('private.manage_google_admin_ledger_pre_one_step_v1(text,uuid,uuid,text,text,integer,boolean,text,uuid,jsonb,text)'),
      ('private.manage_google_admin_ledger_v1(text,uuid,uuid,text,text,integer,boolean,text,uuid,jsonb,text)'),
      ('private.apply_accepted_invitation_ai_policy_v1()'),
      ('private.reject_invitation_ai_policy_contract_change_v1()')
    ) AS functions(signature)
    WHERE has_function_privilege(roles.name, functions.signature, 'EXECUTE')
  ),
  'one-step normalizers, legacy body and policy writers are not directly executable'
);

-- Keep the historical fixture unchanged: use a separate active teacher and
-- a separate Google invitee, while retaining the existing Owner session.
INSERT INTO auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) VALUES
  ('00000000-0000-0000-0000-000000000000'::uuid,
   '00000000-0000-4000-8000-00000000d132'::uuid,
   'authenticated', 'authenticated', 'teacher-ai-existing@example.test', '',
   statement_timestamp() - interval '1 hour',
   '{"provider":"google","providers":["google"]}'::jsonb, '{}'::jsonb,
   statement_timestamp() - interval '1 hour', statement_timestamp() - interval '1 hour'),
  ('00000000-0000-0000-0000-000000000000'::uuid,
   '00000000-0000-4000-8000-00000000d142'::uuid,
   'authenticated', 'authenticated', 'teacher-ai-invitee@example.test', '',
   statement_timestamp() - interval '1 hour',
   '{"provider":"google","providers":["google"]}'::jsonb, '{}'::jsonb,
   statement_timestamp() - interval '1 hour', statement_timestamp() - interval '1 hour');

INSERT INTO private.admin_principals (
  id, auth_user_id, google_issuer, provider_subject_hmac,
  subject_pepper_version, normalized_email, email_verified_at
) VALUES (
  '00000000-0000-4000-8000-00000000d135'::uuid,
  '00000000-0000-4000-8000-00000000d132'::uuid,
  'https://accounts.google.com', repeat('8', 64), 1,
  'teacher-ai-existing@example.test', statement_timestamp() - interval '1 hour'
);
INSERT INTO private.admin_environment_memberships (
  id, environment_id, principal_id, role, status, can_use_ai, activated_at
) VALUES (
  '00000000-0000-4000-8000-00000000d136'::uuid,
  '00000000-0000-4000-8000-00000000d101'::uuid,
  '00000000-0000-4000-8000-00000000d135'::uuid,
  'instructor', 'active', false, statement_timestamp() - interval '1 hour'
);
UPDATE private.admin_identity_runtime_gate SET google_admin_ledger_enabled = true WHERE singleton;

CREATE FUNCTION pg_temp.teacher_ai_owner_intent(action text, request_id uuid, payload jsonb)
RETURNS jsonb LANGUAGE sql SECURITY INVOKER AS $$
  SELECT public.get_google_admin_ledger_intent_v1(
    repeat('1', 64), '00000000-0000-4000-8000-00000000d102'::uuid,
    '00000000-0000-4000-8000-00000000d103'::uuid,
    'https://accounts.google.com', repeat('a', 64), 1, true,
    action, request_id, payload
  );
$$;
CREATE FUNCTION pg_temp.teacher_ai_owner_commit(
  action text, request_id uuid, payload jsonb, intent jsonb
)
RETURNS jsonb LANGUAGE sql SECURITY INVOKER AS $$
  SELECT public.manage_google_admin_ledger_v1(
    repeat('1', 64), '00000000-0000-4000-8000-00000000d102'::uuid,
    '00000000-0000-4000-8000-00000000d103'::uuid,
    'https://accounts.google.com', repeat('a', 64), 1, true,
    action, request_id, payload, intent ->> 'intentDigest'
  );
$$;
CREATE FUNCTION pg_temp.teacher_ai_accept(request_id uuid, token_hash text)
RETURNS jsonb LANGUAGE sql SECURITY INVOKER AS $$
  SELECT public.consume_admin_identity_admission_v1(
    '00000000-0000-4000-8000-00000000d101'::uuid,
    '00000000-0000-4000-8000-00000000d142'::uuid,
    'https://accounts.google.com', repeat('9', 64), 1,
    'teacher-ai-invitee@example.test', repeat('7', 64), 'Teacher AI Invitee',
    request_id, token_hash
  );
$$;
GRANT EXECUTE ON FUNCTION pg_temp.teacher_ai_owner_intent(text, uuid, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION pg_temp.teacher_ai_owner_commit(text, uuid, jsonb, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION pg_temp.teacher_ai_accept(uuid, text) TO service_role;

INSERT INTO teacher_ai_values VALUES (
  'enable_payload', jsonb_build_object(
    'membership_id', '00000000-0000-4000-8000-00000000d136',
    'expected_status', 'active', 'expected_can_use_ai', false,
    'expected_updated_at', (SELECT updated_at FROM private.admin_environment_memberships
      WHERE id = '00000000-0000-4000-8000-00000000d136'::uuid),
    'ai_policy', (SELECT value FROM teacher_ai_values WHERE name = 'terms')
  )
), (
  'invite_payload', jsonb_build_object(
    'normalized_email', 'teacher-ai-invitee@example.test',
    'email_hmac', repeat('7', 64), 'email_pepper_version', 1,
    'invitation_token_hash', repeat('6', 64), 'role', 'instructor',
    'can_use_ai', true, 'membership_expires_at', null,
    'expires_at', transaction_timestamp() + interval '48 hours',
    'ai_policy', (SELECT value FROM teacher_ai_values WHERE name = 'terms')
  )
);

SELECT is(
  private.normalize_google_admin_ledger_payload_v1('enableAi', value - 'ai_policy'),
  private.normalize_google_admin_ledger_payload_pre_one_step_v1('enableAi', value - 'ai_policy'),
  'legacy entitlement payloads retain their exact canonical representation'
) FROM teacher_ai_values WHERE name = 'enable_payload';
SELECT isnt(
  private.google_admin_ledger_payload_digest_v1('enableAi', value),
  private.google_admin_ledger_payload_digest_v1('enableAi',
    jsonb_set(value, '{ai_policy,max_cost_microusd_per_day}', '7000000'::jsonb)),
  'the Owner intent digest binds the entire AI policy terms'
) FROM teacher_ai_values WHERE name = 'enable_payload';
SELECT throws_ok(
  $$SELECT private.normalize_google_admin_ledger_payload_v1('issueInvitation',
    (SELECT value || '{"role":"owner"}'::jsonb FROM teacher_ai_values WHERE name = 'invite_payload'))$$,
  '22023', null, 'one-step AI invitation cannot elevate the recipient to Owner'
);
SELECT throws_ok(
  $$SELECT private.normalize_google_admin_ledger_payload_v1('issueInvitation',
    (SELECT value || '{"can_use_ai":false}'::jsonb FROM teacher_ai_values WHERE name = 'invite_payload'))$$,
  '22023', null, 'an AI policy cannot be attached to an AI-disabled invitation'
);
SELECT throws_ok(
  $$SELECT private.normalize_google_admin_ledger_payload_v1('disableAi',
    (SELECT value FROM teacher_ai_values WHERE name = 'enable_payload'))$$,
  '22023', null, 'other ledger actions cannot carry hidden AI policy authority'
);

INSERT INTO teacher_ai_values VALUES ('enable_intent', pg_temp.teacher_ai_owner_intent(
  'enableAi', '00000000-0000-4000-8000-00000000d401'::uuid,
  (SELECT value FROM teacher_ai_values WHERE name = 'enable_payload')
));
SELECT pg_temp.seed_d_admin_control_grant(
  '00000000-0000-4000-8000-00000000d108'::uuid,
  value ->> 'controlStepUpAction', '00000000-0000-4000-8000-00000000d401'::uuid,
  value ->> 'intentDigest'
) FROM teacher_ai_values WHERE name = 'enable_intent';

SET ROLE service_role;
SELECT throws_ok(
  $$SELECT pg_temp.teacher_ai_owner_commit('enableAi',
    '00000000-0000-4000-8000-00000000d401'::uuid,
    (SELECT jsonb_set(value, '{ai_policy,max_cost_microusd_per_day}', '7000000'::jsonb)
     FROM teacher_ai_values WHERE name = 'enable_payload'),
    (SELECT value FROM teacher_ai_values WHERE name = 'enable_intent'))$$,
  'P7335', 'Admin ledger intent changed before mutation',
  'a confirmed Owner grant cannot be reused for changed AI policy limits'
);
RESET ROLE;

-- Fault injection is a transaction-local test constraint, never product logic.
ALTER TABLE private.admin_ai_policies ADD CONSTRAINT teacher_ai_test_enable_failure
  CHECK (request_id <> '00000000-0000-4000-8000-00000000d401'::uuid) NOT VALID;
SET ROLE service_role;
SELECT throws_ok(
  $$SELECT pg_temp.teacher_ai_owner_commit('enableAi',
    '00000000-0000-4000-8000-00000000d401'::uuid,
    (SELECT value FROM teacher_ai_values WHERE name = 'enable_payload'),
    (SELECT value FROM teacher_ai_values WHERE name = 'enable_intent'))$$,
  '23514', null, 'a failed policy insert aborts the compound enable operation'
);
RESET ROLE;
SELECT ok(
  (SELECT NOT can_use_ai FROM private.admin_environment_memberships
   WHERE id = '00000000-0000-4000-8000-00000000d136'::uuid)
  AND NOT EXISTS (SELECT 1 FROM private.admin_ai_policies
    WHERE request_id = '00000000-0000-4000-8000-00000000d401'::uuid)
  AND NOT EXISTS (SELECT 1 FROM private.admin_google_operation_receipts
    WHERE request_id = '00000000-0000-4000-8000-00000000d401'::uuid)
  AND EXISTS (SELECT 1 FROM private.admin_control_step_up_grants
    WHERE mutation_request_id = '00000000-0000-4000-8000-00000000d401'::uuid
      AND status = 'available' AND consumed_at IS NULL),
  'policy failure rolls back entitlement, policy, receipt and grant consumption together'
);
ALTER TABLE private.admin_ai_policies DROP CONSTRAINT teacher_ai_test_enable_failure;

SET ROLE service_role;
SELECT ok(
  pg_temp.teacher_ai_owner_commit('enableAi',
    '00000000-0000-4000-8000-00000000d401'::uuid,
    (SELECT value FROM teacher_ai_values WHERE name = 'enable_payload'),
    (SELECT value FROM teacher_ai_values WHERE name = 'enable_intent'))
    @> '{"ok":true,"idempotentReplay":false,"resultStatus":"ai_enabled"}'::jsonb,
  'the same confirmed request enables entitlement and policy in one commit'
);
RESET ROLE;
SELECT ok(
  (SELECT role = 'instructor' AND status = 'active' AND can_use_ai
   FROM private.admin_environment_memberships
   WHERE id = '00000000-0000-4000-8000-00000000d136'::uuid)
  AND (SELECT count(*) = 1 AND bool_and(
    membership_id = '00000000-0000-4000-8000-00000000d136'::uuid
    AND created_by_membership_id = '00000000-0000-4000-8000-00000000d106'::uuid
    AND created_by_admin_session_id = '00000000-0000-4000-8000-00000000d108'::uuid
    AND max_cost_microusd_per_lecture = 3000000 AND max_cost_microusd_per_day = 6000000
    AND status = 'active' AND valid_until = valid_from + interval '30 days'
    AND cardinality(allowed_actions) = 5 AND cardinality(allowed_models) = 2)
   FROM private.admin_ai_policies
   WHERE request_id = '00000000-0000-4000-8000-00000000d401'::uuid)
  AND (SELECT count(*) = 1 FROM private.admin_control_step_up_grants
    WHERE mutation_request_id = '00000000-0000-4000-8000-00000000d401'::uuid
      AND status = 'consumed'),
  'one grant yields a bounded membership policy without Owner promotion'
);

-- A historical successful response is not permission to restore later-revoked AI.
UPDATE private.admin_environment_memberships SET can_use_ai = false
WHERE id = '00000000-0000-4000-8000-00000000d136'::uuid;
UPDATE private.admin_ai_policies SET status = 'revoked', revoked_at = statement_timestamp()
WHERE request_id = '00000000-0000-4000-8000-00000000d401'::uuid;
INSERT INTO teacher_ai_values VALUES ('revoked_policy', (
  SELECT to_jsonb(policy) FROM private.admin_ai_policies AS policy
  WHERE request_id = '00000000-0000-4000-8000-00000000d401'::uuid
));
SET ROLE service_role;
SELECT ok(
  pg_temp.teacher_ai_owner_commit('enableAi',
    '00000000-0000-4000-8000-00000000d401'::uuid,
    (SELECT value FROM teacher_ai_values WHERE name = 'enable_payload'),
    (SELECT value FROM teacher_ai_values WHERE name = 'enable_intent'))
    @> '{"ok":true,"idempotentReplay":true}'::jsonb,
  'lost-response replay returns its historical result after teacher AI was revoked'
);
RESET ROLE;
SELECT ok(
  (SELECT NOT can_use_ai FROM private.admin_environment_memberships
    WHERE id = '00000000-0000-4000-8000-00000000d136'::uuid)
  AND (SELECT count(*) = 1 FROM private.admin_ai_policies
    WHERE membership_id = '00000000-0000-4000-8000-00000000d136'::uuid)
  AND (SELECT to_jsonb(policy) FROM private.admin_ai_policies AS policy
    WHERE request_id = '00000000-0000-4000-8000-00000000d401'::uuid)
    = (SELECT value FROM teacher_ai_values WHERE name = 'revoked_policy'),
  'replay cannot restore entitlement, recreate a policy or extend its lifetime'
);

INSERT INTO teacher_ai_values VALUES ('invite_intent', pg_temp.teacher_ai_owner_intent(
  'issueInvitation', '00000000-0000-4000-8000-00000000d402'::uuid,
  (SELECT value FROM teacher_ai_values WHERE name = 'invite_payload')
));
SELECT pg_temp.seed_d_admin_control_grant(
  '00000000-0000-4000-8000-00000000d108'::uuid,
  value ->> 'controlStepUpAction', '00000000-0000-4000-8000-00000000d402'::uuid,
  value ->> 'intentDigest'
) FROM teacher_ai_values WHERE name = 'invite_intent';
SET ROLE service_role;
SELECT ok(
  pg_temp.teacher_ai_owner_commit('issueInvitation',
    '00000000-0000-4000-8000-00000000d402'::uuid,
    (SELECT value FROM teacher_ai_values WHERE name = 'invite_payload'),
    (SELECT value FROM teacher_ai_values WHERE name = 'invite_intent'))
    @> '{"ok":true,"idempotentReplay":false}'::jsonb,
  'one Owner confirmation issues the teacher invitation with its AI approval'
);
RESET ROLE;
SELECT ok(
  (SELECT count(*) = 1 AND bool_and(
    invitation.role = 'instructor' AND invitation.status = 'pending' AND invitation.can_use_ai
    AND invitation.membership_expires_at IS NULL
    AND invitation.expires_at = transaction_timestamp() + interval '48 hours'
    AND contract.policy_terms = (SELECT value FROM teacher_ai_values WHERE name = 'terms'))
   FROM private.admin_invitations AS invitation
   JOIN private.admin_invitation_ai_policy_contracts AS contract ON contract.invitation_id = invitation.id
   WHERE invitation.request_id = '00000000-0000-4000-8000-00000000d402'::uuid)
  AND NOT EXISTS (SELECT 1 FROM private.admin_ai_policies
    WHERE request_id = '00000000-0000-4000-8000-00000000d402'::uuid),
  'the immutable 48-hour invitation stores approval without premature membership policy'
);
SELECT throws_ok(
  $$UPDATE private.admin_invitation_ai_policy_contracts
    SET policy_terms = jsonb_set(policy_terms, '{max_cost_microusd_per_day}', '7000000'::jsonb)
    WHERE request_id = '00000000-0000-4000-8000-00000000d402'::uuid$$,
  '55000', 'invitation AI policy approval is immutable',
  'an issued invitation policy cannot be widened after Owner confirmation'
);
SELECT throws_ok(
  $$DELETE FROM private.admin_invitation_ai_policy_contracts
    WHERE request_id = '00000000-0000-4000-8000-00000000d402'::uuid$$,
  '55000', 'invitation AI policy approval is immutable',
  'an issued invitation policy approval cannot be deleted'
);

SET ROLE service_role;
SELECT is(
  pg_temp.teacher_ai_accept('00000000-0000-4000-8000-00000000d404'::uuid, repeat('5', 64)),
  '{"eligible":false}'::jsonb,
  'the AI contract does not bypass the invitation token check'
);
RESET ROLE;
ALTER TABLE private.admin_ai_policies ADD CONSTRAINT teacher_ai_test_accept_failure
  CHECK (request_id <> '00000000-0000-4000-8000-00000000d402'::uuid) NOT VALID;
SET ROLE service_role;
SELECT throws_ok(
  $$SELECT pg_temp.teacher_ai_accept('00000000-0000-4000-8000-00000000d403'::uuid, repeat('6', 64))$$,
  '23514', null, 'a failed policy materialization aborts invitation acceptance'
);
RESET ROLE;
SELECT ok(
  (SELECT status = 'pending' AND accepted_membership_id IS NULL
   FROM private.admin_invitations WHERE request_id = '00000000-0000-4000-8000-00000000d402'::uuid)
  AND NOT EXISTS (SELECT 1 FROM private.admin_principals
    WHERE auth_user_id = '00000000-0000-4000-8000-00000000d142'::uuid)
  AND NOT EXISTS (SELECT 1 FROM private.admin_invitation_redemption_receipts
    WHERE admission_request_id = '00000000-0000-4000-8000-00000000d403'::uuid)
  AND NOT EXISTS (SELECT 1 FROM private.admin_ai_policies
    WHERE request_id = '00000000-0000-4000-8000-00000000d402'::uuid),
  'failed acceptance rolls back principal, membership, acceptance receipt and policy'
);
ALTER TABLE private.admin_ai_policies DROP CONSTRAINT teacher_ai_test_accept_failure;

SET ROLE service_role;
SELECT ok(
  pg_temp.teacher_ai_accept('00000000-0000-4000-8000-00000000d403'::uuid, repeat('6', 64))
    @> '{"eligible":true,"idempotent_replay":false}'::jsonb,
  'the same invitation acceptance succeeds with its already-approved AI policy'
);
RESET ROLE;
SELECT ok(
  (SELECT membership.role = 'instructor' AND membership.status = 'pending_mfa'
      AND membership.can_use_ai AND invitation.status = 'accepted'
      AND policy.status = 'active' AND policy.valid_until = policy.valid_from + interval '30 days'
      AND policy.max_cost_microusd_per_lecture = 3000000 AND policy.max_cost_microusd_per_day = 6000000
      AND policy.created_by_membership_id = invitation.inviter_membership_id
      AND policy.created_by_admin_session_id = '00000000-0000-4000-8000-00000000d108'::uuid
   FROM private.admin_invitations AS invitation
   JOIN private.admin_environment_memberships AS membership ON membership.id = invitation.accepted_membership_id
   JOIN private.admin_ai_policies AS policy ON policy.membership_id = membership.id
     AND policy.environment_id = membership.environment_id AND policy.request_id = invitation.request_id
   WHERE invitation.request_id = '00000000-0000-4000-8000-00000000d402'::uuid)
  AND NOT EXISTS (SELECT 1 FROM public.admin_sessions
    WHERE auth_user_id = '00000000-0000-4000-8000-00000000d142'::uuid),
  'acceptance attaches policy to the exact pending-MFA teacher without issuing an Admin session'
);
INSERT INTO teacher_ai_values VALUES ('accepted_policy', (
  SELECT to_jsonb(policy) FROM private.admin_ai_policies AS policy
  WHERE request_id = '00000000-0000-4000-8000-00000000d402'::uuid
));
SET ROLE service_role;
SELECT ok(
  pg_temp.teacher_ai_accept('00000000-0000-4000-8000-00000000d403'::uuid, repeat('6', 64))
    @> '{"eligible":true,"idempotent_replay":true}'::jsonb,
  'acceptance replay recovers the existing membership and approval'
);
SELECT ok(
  pg_temp.teacher_ai_owner_commit('issueInvitation',
    '00000000-0000-4000-8000-00000000d402'::uuid,
    (SELECT value FROM teacher_ai_values WHERE name = 'invite_payload'),
    (SELECT value FROM teacher_ai_values WHERE name = 'invite_intent'))
    @> '{"ok":true,"idempotentReplay":true}'::jsonb,
  'Owner response replay remains safe after the invitation has been accepted'
);
RESET ROLE;
SELECT ok(
  (SELECT count(*) = 1 FROM private.admin_invitation_ai_policy_contracts
    WHERE request_id = '00000000-0000-4000-8000-00000000d402'::uuid)
  AND (SELECT count(*) = 1 FROM private.admin_ai_policies
    WHERE request_id = '00000000-0000-4000-8000-00000000d402'::uuid)
  AND (SELECT to_jsonb(policy) FROM private.admin_ai_policies AS policy
    WHERE request_id = '00000000-0000-4000-8000-00000000d402'::uuid)
    = (SELECT value FROM teacher_ai_values WHERE name = 'accepted_policy'),
  'neither replay creates duplicate contracts or policies nor extends the 30-day approval'
);

SELECT is(
  (SELECT jsonb_agg(jsonb_build_object(
    'id', id, 'issued_at', issued_at, 'expires_at', expires_at,
    'idle_expires_at', idle_expires_at, 'revoked_at', revoked_at,
    'supabase_auth_session_id', supabase_auth_session_id
  ) ORDER BY id) FROM public.admin_sessions
  WHERE environment_id = '00000000-0000-4000-8000-00000000d101'::uuid),
  (SELECT value FROM teacher_ai_values WHERE name = 'sessions_before'),
  'one-step AI administration leaves Admin session identity, lifetime and revocation unchanged'
);
SELECT is(
  (SELECT jsonb_agg(to_jsonb(session) ORDER BY session.id)
   FROM auth.sessions AS session WHERE user_id IN (
     '00000000-0000-4000-8000-00000000d102'::uuid,
     '00000000-0000-4000-8000-00000000d112'::uuid
   )),
  (SELECT value FROM teacher_ai_values WHERE name = 'auth_sessions_before'),
  'one-step AI administration does not renew or replace the backing Auth sessions'
);

-- Existing receipt replay intentionally does not require current Owner authority.
-- Revoking the fixture Owner proves that the wrapper does not turn replay into
-- a new policy grant; this occurs last and is rolled back with the whole suite.
UPDATE public.admin_sessions SET revoked_at = statement_timestamp(),
  revoke_reason = 'teacher_ai_test_owner_revoked', updated_at = statement_timestamp()
WHERE id = '00000000-0000-4000-8000-00000000d108'::uuid;
SET ROLE service_role;
SELECT ok(
  pg_temp.teacher_ai_owner_commit('enableAi',
    '00000000-0000-4000-8000-00000000d401'::uuid,
    (SELECT value FROM teacher_ai_values WHERE name = 'enable_payload'),
    (SELECT value FROM teacher_ai_values WHERE name = 'enable_intent'))
    @> '{"ok":true,"idempotentReplay":true}'::jsonb,
  'a revoked Owner session can recover only the historical compound receipt'
);
RESET ROLE;
SELECT is(
  (SELECT to_jsonb(policy) FROM private.admin_ai_policies AS policy
    WHERE request_id = '00000000-0000-4000-8000-00000000d401'::uuid),
  (SELECT value FROM teacher_ai_values WHERE name = 'revoked_policy'),
  'Owner-session revocation cannot be bypassed to recreate policy through receipt replay'
);

SELECT * FROM finish();
ROLLBACK;
