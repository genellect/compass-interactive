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
    'owner', 'active', false, statement_timestamp() - interval '1 hour'
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
      AND membership.value ->> 'canUseAi' = 'false'
  ),
  'an owner without AI entitlement can read the default-OFF ledger'
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

SELECT * FROM finish();
ROLLBACK;
