BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path = public, extensions;
SELECT no_plan();
SELECT ok(NOT has_function_privilege('anon',
  'private.validate_presenter_bound_authority_v3(uuid)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated',
  'private.validate_presenter_bound_authority_v3(uuid)', 'EXECUTE'),
  'a bound-session verifier is not a browser capability');

-- Same synthetic setup as scripts/fixtures/presenter-authority-fixture.sql.
-- Keep pgTAP self-contained: supabase test db may stream files through psql.
INSERT INTO auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) VALUES (
  '00000000-0000-0000-0000-000000000000'::uuid,
  '00000000-0000-4000-8000-00000000e502'::uuid,
  'authenticated', 'authenticated', 'presenter-authority@example.test', '',
  statement_timestamp() - interval '1 hour',
  '{"provider":"google","providers":["google"]}'::jsonb, '{}'::jsonb,
  statement_timestamp() - interval '1 hour',
  statement_timestamp() - interval '1 hour'
);
INSERT INTO auth.sessions (id, user_id, created_at, updated_at) VALUES (
  '00000000-0000-4000-8000-00000000e503'::uuid,
  '00000000-0000-4000-8000-00000000e502'::uuid,
  statement_timestamp() - interval '1 hour',
  statement_timestamp() - interval '1 hour'
);
INSERT INTO auth.mfa_factors (
  id, user_id, friendly_name, factor_type, status, created_at, updated_at
) VALUES (
  '00000000-0000-4000-8000-00000000e504'::uuid,
  '00000000-0000-4000-8000-00000000e502'::uuid,
  'presenter-authority-totp', 'totp', 'verified',
  statement_timestamp() - interval '1 hour',
  statement_timestamp() - interval '1 hour'
);

INSERT INTO private.admin_environments (
  id, environment_kind, canonical_admin_origin, supabase_issuer,
  current_deployment, bootstrap_sealed_at, owner_invariant_enforced_at
) VALUES (
  '00000000-0000-4000-8000-00000000e501'::uuid,
  'local', 'http://127.0.0.1:5173',
  'http://127.0.0.1:54321/auth/v1', true,
  statement_timestamp() - interval '1 hour',
  null
);
INSERT INTO private.admin_principals (
  id, auth_user_id, google_issuer, provider_subject_hmac,
  subject_pepper_version, normalized_email, email_verified_at
) VALUES (
  '00000000-0000-4000-8000-00000000e505'::uuid,
  '00000000-0000-4000-8000-00000000e502'::uuid,
  'https://accounts.google.com', repeat('a', 64), 1,
  'presenter-authority@example.test', statement_timestamp() - interval '1 hour'
);
UPDATE private.admin_principals
SET
  approved_totp_factor_set_hash = snapshot.factor_set_hash,
  approved_totp_factor_set_version = 1,
  approved_totp_factor_count = snapshot.factor_count,
  approved_totp_factor_set_at = statement_timestamp() - interval '30 minutes',
  approved_totp_factor_set_request_id =
    '00000000-0000-4000-8000-00000000e50b'::uuid,
  approved_totp_factor_set_source = 'operator_adoption',
  approved_totp_factor_set_actor = 'fixture:presenter-authority',
  approved_totp_factor_set_reason = 'C2 Display runtime fixture'
FROM private.current_verified_totp_factor_set_snapshot_v1(
  '00000000-0000-4000-8000-00000000e502'::uuid
) AS snapshot
WHERE id = '00000000-0000-4000-8000-00000000e505'::uuid;
INSERT INTO private.admin_environment_memberships (
  id, environment_id, principal_id, role, status, can_use_ai, activated_at
) VALUES (
  '00000000-0000-4000-8000-00000000e506'::uuid,
  '00000000-0000-4000-8000-00000000e501'::uuid,
  '00000000-0000-4000-8000-00000000e505'::uuid,
  'instructor', 'active', false, statement_timestamp() - interval '1 hour'
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
  '00000000-0000-4000-8000-00000000e507'::uuid,
  repeat('2', 64),
  '00000000-0000-4000-8000-00000000e508'::uuid,
  '00000000-0000-4000-8000-00000000e501'::uuid,
  '00000000-0000-4000-8000-00000000e505'::uuid,
  '00000000-0000-4000-8000-00000000e506'::uuid,
  '00000000-0000-4000-8000-00000000e503'::uuid,
  'admin_login',
  '00000000-0000-4000-8000-00000000e50c'::uuid,
  repeat('3', 64), statement_timestamp() - interval '1 minute',
  '00000000-0000-4000-8000-00000000e504'::uuid,
  private.current_verified_totp_factor_set_hash_v1(
    '00000000-0000-4000-8000-00000000e502'::uuid
  ),
  private.current_verified_totp_factor_set_hash_v1(
    '00000000-0000-4000-8000-00000000e502'::uuid
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
  '00000000-0000-4000-8000-00000000e508'::uuid,
  repeat('1', 64),
  '00000000-0000-4000-8000-00000000e502'::uuid,
  null, 'google_totp', 2,
  '00000000-0000-4000-8000-00000000e505'::uuid,
  '00000000-0000-4000-8000-00000000e506'::uuid,
  '00000000-0000-4000-8000-00000000e501'::uuid,
  '00000000-0000-4000-8000-00000000e503'::uuid,
  statement_timestamp(),
  '00000000-0000-4000-8000-00000000e507'::uuid,
  private.current_verified_totp_factor_set_hash_v1(
    '00000000-0000-4000-8000-00000000e502'::uuid
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
  completed_admin_session_id = '00000000-0000-4000-8000-00000000e508'::uuid,
  updated_at = statement_timestamp()
WHERE id = '00000000-0000-4000-8000-00000000e507'::uuid;
UPDATE private.admin_identity_runtime_gate
SET google_session_issue_enabled = false
WHERE singleton;

INSERT INTO public.lecture_sessions (
  id, title, code_hash, status, starts_at, started_at, hard_stop_at, ends_at
) VALUES (
  '00000000-0000-4000-8000-00000000e509'::uuid,
  'Presenter authority fixture', repeat('d', 64), 'open',
  statement_timestamp() - interval '5 minutes',
  statement_timestamp() - interval '5 minutes',
  statement_timestamp() + interval '1 hour',
  statement_timestamp() + interval '1 hour'
);
INSERT INTO private.admin_lecture_ownerships (
  lecture_session_id, environment_id, principal_id, membership_id,
  assigned_by_admin_session_id, ownership_request_id, ownership_intent_digest
) VALUES (
  '00000000-0000-4000-8000-00000000e509'::uuid,
  '00000000-0000-4000-8000-00000000e501'::uuid,
  '00000000-0000-4000-8000-00000000e505'::uuid,
  '00000000-0000-4000-8000-00000000e506'::uuid,
  '00000000-0000-4000-8000-00000000e508'::uuid,
  '00000000-0000-4000-8000-00000000e50d'::uuid,
  repeat('9', 64)
);


UPDATE private.admin_identity_runtime_gate
SET google_operational_authorization_enabled = true WHERE singleton;
SELECT public.set_presenter_runtime_v1(true);
SELECT public.admin_register_pdf_document(
  '00000000-0000-4000-8000-00000000e509'::uuid,
  'presenter-authority-doc', repeat('d',64), 1, 'Presenter authority',
  3, 3000, 300, repeat('d',64), repeat('f',64), true
);
SELECT public.admin_update_pdf_display_v3(
  '00000000-0000-4000-8000-00000000e509'::uuid,
  'presenter-authority-doc', repeat('d',64), 1, 3, true, 1, 'normal'
);
SET ROLE service_role;
SELECT public.manage_google_admin_presenter_connection_v1(
  repeat('1',64), '00000000-0000-4000-8000-00000000e502'::uuid,
  '00000000-0000-4000-8000-00000000e503'::uuid,
  'https://accounts.google.com', repeat('a',64), 1, true, true,
  '00000000-0000-4000-8000-00000000e513'::uuid, 'issue',
  '00000000-0000-4000-8000-00000000e509'::uuid, null,
  encode(extensions.digest('00000000-0000-4000-8000-00000000e513','sha256'),'hex'),
  repeat('b',64), 'http://127.0.0.1:5173'
);
SELECT public.inspect_presenter_connection_v1(
  '00000000-0000-4000-8000-00000000e513'::uuid, 'ticket',
  encode(extensions.digest('00000000-0000-4000-8000-00000000e513','sha256'),'hex'),
  repeat('c',64), repeat('d',64), repeat('e',64), 3, 0, false
);
SELECT public.manage_google_admin_presenter_connection_v1(
  repeat('1',64), '00000000-0000-4000-8000-00000000e502'::uuid,
  '00000000-0000-4000-8000-00000000e503'::uuid,
  'https://accounts.google.com', repeat('a',64), 1, true, true,
  '00000000-0000-4000-8000-00000000e514'::uuid, 'confirm',
  null, '00000000-0000-4000-8000-00000000e513'::uuid, null, null, null
);
SELECT public.claim_presenter_connection_v1(
  '00000000-0000-4000-8000-00000000e513'::uuid, 'ticket',
  encode(extensions.digest('00000000-0000-4000-8000-00000000e513','sha256'),'hex'),
  repeat('c',64), repeat('f',64)
);
RESET ROLE;
UPDATE public.presenter_connections
SET proof_key_id = repeat('c',64), proof_public_key_spki = repeat('A',120)
WHERE id = '00000000-0000-4000-8000-00000000e513'::uuid;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.presenter_connections
      WHERE id = '00000000-0000-4000-8000-00000000e513'::uuid
        AND state = 'active' AND revoked_at IS NULL) THEN
    RAISE EXCEPTION 'Google Presenter fixture did not activate';
  END IF;
END;
$$;


-- Each exercise uses a rollback subtransaction, leaving pgTAP assertions and
-- their counters outside it. Only this fixture helper executes arbitrary SQL.
CREATE FUNCTION pg_temp.exercise_presenter(mutation text, first_operation text DEFAULT 'page')
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  page_result jsonb;
  heartbeat_result jsonb;
  observed jsonb;
  state_before_machine text;
BEGIN
  BEGIN
    IF mutation <> '' THEN EXECUTE mutation; END IF;
    SELECT state INTO state_before_machine FROM public.presenter_connections
    WHERE id = '00000000-0000-4000-8000-00000000e513'::uuid;
    SET LOCAL ROLE service_role;
    IF first_operation IN ('inspect', 'claim') THEN
      IF first_operation = 'inspect' THEN
        page_result := jsonb_build_object('accepted',
          public.inspect_presenter_connection_v1(
            '00000000-0000-4000-8000-00000000e513'::uuid, 'ticket',
            encode(extensions.digest('00000000-0000-4000-8000-00000000e513','sha256'),'hex'),
            repeat('c',64), repeat('d',64), repeat('e',64), 3, 0, false
          ) IS NOT NULL);
      ELSE
        page_result := jsonb_build_object('accepted',
          public.claim_presenter_connection_v1(
            '00000000-0000-4000-8000-00000000e513'::uuid, 'ticket',
            encode(extensions.digest('00000000-0000-4000-8000-00000000e513','sha256'),'hex'),
            repeat('c',64), repeat('f',64)
          ) IS NOT NULL);
      END IF;
      heartbeat_result := public.heartbeat_presenter_connection_v2(
  '00000000-0000-4000-8000-00000000e513'::uuid,
  repeat('f',64), repeat('c',64), repeat('d',64), repeat('e',64),
  repeat('c',64), repeat('A',120),
  encode(extensions.digest(gen_random_uuid()::text,'sha256'),'hex'),
  repeat('6',64), statement_timestamp(),
  repeat('c',64), repeat('8',64), repeat('9',64));
    ELSIF first_operation = 'heartbeat' THEN
      heartbeat_result := public.heartbeat_presenter_connection_v2(
  '00000000-0000-4000-8000-00000000e513'::uuid,
  repeat('f',64), repeat('c',64), repeat('d',64), repeat('e',64),
  repeat('c',64), repeat('A',120),
  encode(extensions.digest(gen_random_uuid()::text,'sha256'),'hex'),
  repeat('6',64), statement_timestamp(),
  repeat('c',64), repeat('8',64), repeat('9',64));
      page_result := public.apply_presenter_page_v2(
  '00000000-0000-4000-8000-00000000e513'::uuid,
  repeat('f',64), repeat('c',64), 1, gen_random_uuid(),
  repeat('d',64), repeat('e',64), 102, 2, 2,
  repeat('c',64), repeat('A',120),
  encode(extensions.digest(gen_random_uuid()::text,'sha256'),'hex'),
  repeat('7',64), statement_timestamp(),
  repeat('c',64), repeat('8',64), repeat('9',64));
    ELSE
      page_result := public.apply_presenter_page_v2(
  '00000000-0000-4000-8000-00000000e513'::uuid,
  repeat('f',64), repeat('c',64), 1, gen_random_uuid(),
  repeat('d',64), repeat('e',64), 102, 2, 2,
  repeat('c',64), repeat('A',120),
  encode(extensions.digest(gen_random_uuid()::text,'sha256'),'hex'),
  repeat('7',64), statement_timestamp(),
  repeat('c',64), repeat('8',64), repeat('9',64));
      heartbeat_result := public.heartbeat_presenter_connection_v2(
  '00000000-0000-4000-8000-00000000e513'::uuid,
  repeat('f',64), repeat('c',64), repeat('d',64), repeat('e',64),
  repeat('c',64), repeat('A',120),
  encode(extensions.digest(gen_random_uuid()::text,'sha256'),'hex'),
  repeat('6',64), statement_timestamp(),
  repeat('c',64), repeat('8',64), repeat('9',64));
    END IF;
    RESET ROLE;
    SELECT jsonb_build_object(
      'page_accepted', page_result -> 'accepted',
      'state_before_machine', state_before_machine,
      'heartbeat_active', heartbeat_result -> 'active',
      'page', live.current_pdf_page,
      'state', connection.state,
      'reason', connection.revoke_reason,
      'last_sequence', connection.last_sequence,
      'nonce_count', (SELECT count(*) FROM private.admin_step_up_nonces),
      'new_events', (SELECT count(*) FROM public.presenter_connection_events
        WHERE connection_id = connection.id
          AND event_type IN ('admin_revoked','disconnected'))
    ) INTO observed
    FROM public.presenter_connections AS connection
    JOIN public.lecture_live_state AS live
      ON live.lecture_session_id = connection.lecture_session_id
    WHERE connection.id = '00000000-0000-4000-8000-00000000e513'::uuid;
    RAISE EXCEPTION 'rollback fixture exercise' USING ERRCODE = 'PT001';
  EXCEPTION WHEN SQLSTATE 'PT001' THEN
    RETURN observed;
  END;
END;
$$;

SELECT is(pg_temp.exercise_presenter('') ->> 'page_accepted', 'true',
  'bound Google session accepts native proof without AI entitlement');
SELECT is(pg_temp.exercise_presenter('') ->> 'heartbeat_active', 'true',
  'bound Google session accepts native heartbeat without another MFA');
SELECT is(pg_temp.exercise_presenter('') ->> 'nonce_count', '1',
  'ordinary Presenter traffic issues no additional MFA nonce');
SELECT is(pg_temp.exercise_presenter('') ->> 'page', '2',
  'valid native update uses the existing PDF live-state writer');
SELECT is(pg_temp.exercise_presenter($mutation$
  DELETE FROM auth.sessions WHERE id = '00000000-0000-4000-8000-00000000e503'
  $mutation$, 'inspect') ->> 'page_accepted', 'false',
  'inspection cannot continue a ticket whose bound Auth session disappeared');
SELECT is(pg_temp.exercise_presenter($mutation$
  DELETE FROM auth.sessions WHERE id = '00000000-0000-4000-8000-00000000e503'
  $mutation$, 'claim') ->> 'page_accepted', 'false',
  'claim replay cannot continue a ticket whose bound Auth session disappeared');

SELECT is(pg_temp.exercise_presenter($mutation$DELETE FROM auth.sessions WHERE id = '00000000-0000-4000-8000-00000000e503'$mutation$)
  - 'nonce_count' - 'new_events' - 'state_before_machine',
  '{"page_accepted":false,"heartbeat_active":false,"page":1,"state":"revoked","reason":"admin_revoked","last_sequence":-1}'::jsonb,
  'Auth session deleted: page cannot advance and capability is terminal');
SELECT is(pg_temp.exercise_presenter($mutation$DELETE FROM auth.sessions WHERE id = '00000000-0000-4000-8000-00000000e503'$mutation$, 'heartbeat')
  ->> 'heartbeat_active', 'false',
  'Auth session deleted: heartbeat cannot refresh the capability');

SELECT is(pg_temp.exercise_presenter($mutation$UPDATE private.admin_environment_memberships SET status = 'suspended', suspended_at = statement_timestamp() WHERE id = '00000000-0000-4000-8000-00000000e506'$mutation$)
  - 'nonce_count' - 'new_events' - 'state_before_machine',
  '{"page_accepted":false,"heartbeat_active":false,"page":1,"state":"revoked","reason":"admin_revoked","last_sequence":-1}'::jsonb,
  'membership suspended: page cannot advance and capability is terminal');
SELECT is(pg_temp.exercise_presenter($mutation$UPDATE private.admin_environment_memberships SET status = 'suspended', suspended_at = statement_timestamp() WHERE id = '00000000-0000-4000-8000-00000000e506'$mutation$, 'heartbeat')
  ->> 'heartbeat_active', 'false',
  'membership suspended: heartbeat cannot refresh the capability');

SELECT is(pg_temp.exercise_presenter($mutation$UPDATE private.admin_environment_memberships SET expires_at = statement_timestamp() - interval '1 second' WHERE id = '00000000-0000-4000-8000-00000000e506'$mutation$)
  - 'nonce_count' - 'new_events' - 'state_before_machine',
  '{"page_accepted":false,"heartbeat_active":false,"page":1,"state":"revoked","reason":"admin_revoked","last_sequence":-1}'::jsonb,
  'membership expired: page cannot advance and capability is terminal');
SELECT is(pg_temp.exercise_presenter($mutation$UPDATE private.admin_environment_memberships SET expires_at = statement_timestamp() - interval '1 second' WHERE id = '00000000-0000-4000-8000-00000000e506'$mutation$, 'heartbeat')
  ->> 'heartbeat_active', 'false',
  'membership expired: heartbeat cannot refresh the capability');

SELECT is(pg_temp.exercise_presenter($mutation$UPDATE private.admin_principals SET status = 'suspended' WHERE id = '00000000-0000-4000-8000-00000000e505'$mutation$)
  - 'nonce_count' - 'new_events' - 'state_before_machine',
  '{"page_accepted":false,"heartbeat_active":false,"page":1,"state":"revoked","reason":"admin_revoked","last_sequence":-1}'::jsonb,
  'principal suspended: page cannot advance and capability is terminal');
SELECT is(pg_temp.exercise_presenter($mutation$UPDATE private.admin_principals SET status = 'suspended' WHERE id = '00000000-0000-4000-8000-00000000e505'$mutation$, 'heartbeat')
  ->> 'heartbeat_active', 'false',
  'principal suspended: heartbeat cannot refresh the capability');

SELECT is(pg_temp.exercise_presenter($mutation$UPDATE private.admin_environments SET status = 'suspended' WHERE id = '00000000-0000-4000-8000-00000000e501'$mutation$)
  - 'nonce_count' - 'new_events' - 'state_before_machine',
  '{"page_accepted":false,"heartbeat_active":false,"page":1,"state":"revoked","reason":"admin_revoked","last_sequence":-1}'::jsonb,
  'environment suspended: page cannot advance and capability is terminal');
SELECT is(pg_temp.exercise_presenter($mutation$UPDATE private.admin_environments SET status = 'suspended' WHERE id = '00000000-0000-4000-8000-00000000e501'$mutation$, 'heartbeat')
  ->> 'heartbeat_active', 'false',
  'environment suspended: heartbeat cannot refresh the capability');

SELECT is(pg_temp.exercise_presenter($mutation$UPDATE private.admin_environments SET current_deployment = false WHERE id = '00000000-0000-4000-8000-00000000e501'$mutation$)
  - 'nonce_count' - 'new_events' - 'state_before_machine',
  '{"page_accepted":false,"heartbeat_active":false,"page":1,"state":"revoked","reason":"admin_revoked","last_sequence":-1}'::jsonb,
  'environment replaced: page cannot advance and capability is terminal');
SELECT is(pg_temp.exercise_presenter($mutation$UPDATE private.admin_environments SET current_deployment = false WHERE id = '00000000-0000-4000-8000-00000000e501'$mutation$, 'heartbeat')
  ->> 'heartbeat_active', 'false',
  'environment replaced: heartbeat cannot refresh the capability');

SELECT is(pg_temp.exercise_presenter($mutation$DELETE FROM auth.mfa_factors WHERE id = '00000000-0000-4000-8000-00000000e504'$mutation$)
  - 'nonce_count' - 'new_events' - 'state_before_machine',
  '{"page_accepted":false,"heartbeat_active":false,"page":1,"state":"revoked","reason":"admin_revoked","last_sequence":-1}'::jsonb,
  'verified factor removed: page cannot advance and capability is terminal');
SELECT is(pg_temp.exercise_presenter($mutation$DELETE FROM auth.mfa_factors WHERE id = '00000000-0000-4000-8000-00000000e504'$mutation$, 'heartbeat')
  ->> 'heartbeat_active', 'false',
  'verified factor removed: heartbeat cannot refresh the capability');

SELECT is(pg_temp.exercise_presenter($mutation$UPDATE auth.mfa_factors SET status = 'unverified' WHERE id = '00000000-0000-4000-8000-00000000e504'$mutation$)
  - 'nonce_count' - 'new_events' - 'state_before_machine',
  '{"page_accepted":false,"heartbeat_active":false,"page":1,"state":"revoked","reason":"admin_revoked","last_sequence":-1}'::jsonb,
  'verified factor changed: page cannot advance and capability is terminal');
SELECT is(pg_temp.exercise_presenter($mutation$UPDATE auth.mfa_factors SET status = 'unverified' WHERE id = '00000000-0000-4000-8000-00000000e504'$mutation$, 'heartbeat')
  ->> 'heartbeat_active', 'false',
  'verified factor changed: heartbeat cannot refresh the capability');

SELECT is(pg_temp.exercise_presenter($mutation$UPDATE auth.sessions SET created_at = statement_timestamp() - interval '9 hours' WHERE id = '00000000-0000-4000-8000-00000000e503'$mutation$)
  - 'nonce_count' - 'new_events' - 'state_before_machine',
  '{"page_accepted":false,"heartbeat_active":false,"page":1,"state":"revoked","reason":"admin_revoked","last_sequence":-1}'::jsonb,
  'eight-hour Auth limit elapsed: page cannot advance and capability is terminal');
SELECT is(pg_temp.exercise_presenter($mutation$UPDATE auth.sessions SET created_at = statement_timestamp() - interval '9 hours' WHERE id = '00000000-0000-4000-8000-00000000e503'$mutation$, 'heartbeat')
  ->> 'heartbeat_active', 'false',
  'eight-hour Auth limit elapsed: heartbeat cannot refresh the capability');

SELECT is(pg_temp.exercise_presenter($mutation$ALTER TABLE private.admin_lecture_ownerships DISABLE TRIGGER admin_lecture_ownerships_append_only; DELETE FROM private.admin_lecture_ownerships WHERE lecture_session_id = '00000000-0000-4000-8000-00000000e509'; ALTER TABLE private.admin_lecture_ownerships ENABLE TRIGGER admin_lecture_ownerships_append_only$mutation$)
  - 'nonce_count' - 'new_events' - 'state_before_machine',
  '{"page_accepted":false,"heartbeat_active":false,"page":1,"state":"revoked","reason":"admin_revoked","last_sequence":-1}'::jsonb,
  'ownership removed by operator repair: page cannot advance and capability is terminal');
SELECT is(pg_temp.exercise_presenter($mutation$ALTER TABLE private.admin_lecture_ownerships DISABLE TRIGGER admin_lecture_ownerships_append_only; DELETE FROM private.admin_lecture_ownerships WHERE lecture_session_id = '00000000-0000-4000-8000-00000000e509'; ALTER TABLE private.admin_lecture_ownerships ENABLE TRIGGER admin_lecture_ownerships_append_only$mutation$, 'heartbeat')
  ->> 'heartbeat_active', 'false',
  'ownership removed by operator repair: heartbeat cannot refresh the capability');

SELECT is(pg_temp.exercise_presenter($mutation$UPDATE public.presenter_connections SET last_seen_at = statement_timestamp() - interval '46 seconds' WHERE id = '00000000-0000-4000-8000-00000000e513'$mutation$)
  - 'nonce_count' - 'new_events' - 'state_before_machine',
  '{"page_accepted":false,"heartbeat_active":false,"page":1,"state":"revoked","reason":"disconnected","last_sequence":-1}'::jsonb,
  'a delayed page terminates an elapsed lease before changing live state');
SELECT is(pg_temp.exercise_presenter($mutation$UPDATE public.presenter_connections SET last_seen_at = statement_timestamp() - interval '46 seconds' WHERE id = '00000000-0000-4000-8000-00000000e513'$mutation$, 'heartbeat')
  ->> 'reason', 'disconnected',
  'a delayed heartbeat terminates an elapsed lease');
SELECT is(pg_temp.exercise_presenter($mutation$UPDATE public.presenter_connections SET last_seen_at = statement_timestamp() - interval '46 seconds' WHERE id = '00000000-0000-4000-8000-00000000e513'; SELECT public.manage_google_admin_display_state_v1(
  repeat('1',64), '00000000-0000-4000-8000-00000000e502'::uuid,
  '00000000-0000-4000-8000-00000000e503'::uuid,
  'https://accounts.google.com', repeat('a',64), 1, true,
  'goToPage', gen_random_uuid(),
  '00000000-0000-4000-8000-00000000e509'::uuid, 3, null, null
)$mutation$)
  - 'nonce_count' - 'new_events' - 'state_before_machine',
  '{"page_accepted":false,"heartbeat_active":false,"page":3,"state":"revoked","reason":"disconnected","last_sequence":-1}'::jsonb,
  'manual stale recovery is terminal before delayed native page or heartbeat');
SELECT is(pg_temp.exercise_presenter($mutation$UPDATE public.presenter_connections SET last_seen_at = statement_timestamp() - interval '46 seconds' WHERE id = '00000000-0000-4000-8000-00000000e513'; SELECT public.manage_google_admin_display_state_v1(
  repeat('1',64), '00000000-0000-4000-8000-00000000e502'::uuid,
  '00000000-0000-4000-8000-00000000e503'::uuid,
  'https://accounts.google.com', repeat('a',64), 1, true,
  'goToPage', gen_random_uuid(),
  '00000000-0000-4000-8000-00000000e509'::uuid, 3, null, null
)$mutation$)
  ->> 'new_events', '1',
  'manual stale recovery records exactly one terminal event');
SELECT is(pg_temp.exercise_presenter($mutation$UPDATE public.presenter_connections SET last_seen_at = statement_timestamp() - interval '46 seconds' WHERE id = '00000000-0000-4000-8000-00000000e513'; SELECT public.manage_google_admin_display_state_v1(
  repeat('1',64), '00000000-0000-4000-8000-00000000e502'::uuid,
  '00000000-0000-4000-8000-00000000e503'::uuid,
  'https://accounts.google.com', repeat('a',64), 1, true,
  'goToPage', gen_random_uuid(),
  '00000000-0000-4000-8000-00000000e509'::uuid, 3, null, null
)$mutation$)
  ->> 'state_before_machine', 'revoked',
  'Google manual recovery commits terminal revocation before any delayed machine traffic');
SELECT is(pg_temp.exercise_presenter($mutation$UPDATE public.presenter_connections SET last_seen_at = statement_timestamp() - interval '46 seconds' WHERE id = '00000000-0000-4000-8000-00000000e513';
  UPDATE public.lecture_live_state SET current_pdf_page = 3
  WHERE lecture_session_id = '00000000-0000-4000-8000-00000000e509'
  $mutation$) ->> 'state_before_machine', 'revoked',
  'a page-only update fires the terminal stale fence without PDF metadata assignments');

CREATE FUNCTION pg_temp.presenter_status_after(mutation text, wrong_actor boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql AS $exercise$
DECLARE observed jsonb;
BEGIN
  BEGIN
    INSERT INTO private.admin_step_up_nonces (
  id, nonce_hash, reserved_admin_session_id, environment_id, principal_id,
  membership_id, supabase_auth_session_id, intended_action, request_id,
  prechallenge_jwt_hash, min_amr_at, challenged_totp_factor_id,
  prechallenge_verified_totp_factor_set_hash,
  verified_totp_factor_set_hash, factor_set_bootstrap_allowed,
  approved_totp_factor_set_version, completion_jwt_hash,
  verified_totp_amr_at, issued_at, expires_at
) VALUES (
  '00000000-0000-4000-8000-00000000e517'::uuid,
  repeat('6', 64),
  '00000000-0000-4000-8000-00000000e518'::uuid,
  '00000000-0000-4000-8000-00000000e501'::uuid,
  '00000000-0000-4000-8000-00000000e505'::uuid,
  '00000000-0000-4000-8000-00000000e506'::uuid,
  '00000000-0000-4000-8000-00000000e503'::uuid,
  'admin_login',
  '00000000-0000-4000-8000-00000000e51c'::uuid,
  repeat('3', 64), statement_timestamp() - interval '1 minute',
  '00000000-0000-4000-8000-00000000e504'::uuid,
  private.current_verified_totp_factor_set_hash_v1(
    '00000000-0000-4000-8000-00000000e502'::uuid
  ),
  private.current_verified_totp_factor_set_hash_v1(
    '00000000-0000-4000-8000-00000000e502'::uuid
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
  '00000000-0000-4000-8000-00000000e518'::uuid,
  repeat('5', 64),
  '00000000-0000-4000-8000-00000000e502'::uuid,
  null, 'google_totp', 2,
  '00000000-0000-4000-8000-00000000e505'::uuid,
  '00000000-0000-4000-8000-00000000e506'::uuid,
  '00000000-0000-4000-8000-00000000e501'::uuid,
  '00000000-0000-4000-8000-00000000e503'::uuid,
  statement_timestamp(),
  '00000000-0000-4000-8000-00000000e517'::uuid,
  private.current_verified_totp_factor_set_hash_v1(
    '00000000-0000-4000-8000-00000000e502'::uuid
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
  completed_admin_session_id = '00000000-0000-4000-8000-00000000e518'::uuid,
  updated_at = statement_timestamp()
WHERE id = '00000000-0000-4000-8000-00000000e517'::uuid;
UPDATE private.admin_identity_runtime_gate
SET google_session_issue_enabled = false
WHERE singleton;

    SET ROLE service_role;
PERFORM public.manage_google_admin_presenter_connection_v1(
  repeat('5',64), '00000000-0000-4000-8000-00000000e502'::uuid,
  '00000000-0000-4000-8000-00000000e503'::uuid,
  'https://accounts.google.com', repeat('a',64), 1, true, true,
  '00000000-0000-4000-8000-00000000e523'::uuid, 'issue',
  '00000000-0000-4000-8000-00000000e509'::uuid, null,
  encode(extensions.digest('00000000-0000-4000-8000-00000000e523','sha256'),'hex'),
  repeat('8',64), 'http://127.0.0.1:5173'
);
PERFORM public.inspect_presenter_connection_v1(
  '00000000-0000-4000-8000-00000000e523'::uuid, 'ticket',
  encode(extensions.digest('00000000-0000-4000-8000-00000000e523','sha256'),'hex'),
  repeat('c',64), repeat('d',64), repeat('e',64), 3, 0, false
);
PERFORM public.manage_google_admin_presenter_connection_v1(
  repeat('5',64), '00000000-0000-4000-8000-00000000e502'::uuid,
  '00000000-0000-4000-8000-00000000e503'::uuid,
  'https://accounts.google.com', repeat('a',64), 1, true, true,
  '00000000-0000-4000-8000-00000000e524'::uuid, 'confirm',
  null, '00000000-0000-4000-8000-00000000e523'::uuid, null, null, null
);
PERFORM public.claim_presenter_connection_v1(
  '00000000-0000-4000-8000-00000000e523'::uuid, 'ticket',
  encode(extensions.digest('00000000-0000-4000-8000-00000000e523','sha256'),'hex'),
  repeat('c',64), repeat('7',64)
);
RESET ROLE;
UPDATE public.presenter_connections
SET proof_key_id = repeat('c',64), proof_public_key_spki = repeat('A',120)
WHERE id = '00000000-0000-4000-8000-00000000e523'::uuid;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.presenter_connections
      WHERE id = '00000000-0000-4000-8000-00000000e523'::uuid
        AND state = 'active' AND revoked_at IS NULL) THEN
    RAISE EXCEPTION 'Google Presenter fixture did not activate';
  END IF;
END;
$$;

    IF mutation <> '' THEN EXECUTE mutation; END IF;
    SET LOCAL ROLE service_role;
    observed := public.manage_google_admin_presenter_connection_v1(
      repeat('1',64),
      CASE WHEN wrong_actor THEN gen_random_uuid()
        ELSE '00000000-0000-4000-8000-00000000e502'::uuid END,
      '00000000-0000-4000-8000-00000000e503'::uuid,
      'https://accounts.google.com', repeat('a',64), 1, true, true,
      null, 'status', '00000000-0000-4000-8000-00000000e509'::uuid,
      null, null, null, null);
    RESET ROLE;
    RAISE EXCEPTION 'rollback status exercise' USING ERRCODE = 'PT001';
  EXCEPTION WHEN SQLSTATE 'PT001' THEN
    RETURN observed;
  END;
END;
$exercise$;

SELECT is(pg_temp.presenter_status_after('') #>> '{connection,connection_id}',
  '00000000-0000-4000-8000-00000000e523',
  'older valid Admin session discovers the active connection issued by its same principal in a replacement session');
SELECT is(pg_temp.presenter_status_after($mutation$
  UPDATE public.presenter_connections SET state = 'confirmed'
  WHERE id = '00000000-0000-4000-8000-00000000e523'
  $mutation$) #>> '{connection,connection_id}',
  '00000000-0000-4000-8000-00000000e523',
  'same-principal pending pairing also takes priority over an older session record');
SELECT is(pg_temp.presenter_status_after($mutation$
  UPDATE public.presenter_connections SET state = 'revoked',
    revoked_at = statement_timestamp(), revoke_reason = 'manual_handover'
  WHERE id = '00000000-0000-4000-8000-00000000e523'
  $mutation$) #>> '{connection,revoke_reason}', 'manual_handover',
  'the newest manual handover remains visible across Admin sessions');
SELECT is(pg_temp.presenter_status_after($mutation$
  UPDATE public.presenter_connections SET last_seen_at = statement_timestamp() - interval '46 seconds'
  WHERE id = '00000000-0000-4000-8000-00000000e523'
  $mutation$) -> 'connection', 'null'::jsonb,
  'status does not advertise an expired active heartbeat lease');
SELECT is(pg_temp.presenter_status_after($mutation$
  UPDATE public.presenter_connections SET capability_expires_at = statement_timestamp() - interval '1 second'
  WHERE id = '00000000-0000-4000-8000-00000000e523'
  $mutation$) -> 'connection', 'null'::jsonb,
  'status does not advertise an expired machine capability');
SELECT is(pg_temp.presenter_status_after($mutation$
  UPDATE public.presenter_connections SET
    issued_at = statement_timestamp() - interval '8 minutes',
    ticket_expires_at = statement_timestamp() - interval '3 minutes'
  WHERE id = '00000000-0000-4000-8000-00000000e513';
  UPDATE public.presenter_connections SET state = 'confirmed',
    issued_at = statement_timestamp() - interval '6 minutes',
    ticket_expires_at = statement_timestamp() - interval '1 minute'
  WHERE id = '00000000-0000-4000-8000-00000000e523'
  $mutation$) -> 'connection', 'null'::jsonb,
  'status does not advertise an expired pending pairing');
SELECT is(pg_temp.presenter_status_after($mutation$
  UPDATE public.admin_sessions SET revoked_at = statement_timestamp(), revoke_reason = 'test'
  WHERE id = '00000000-0000-4000-8000-00000000e508'
  $mutation$), null::jsonb,
  'status still requires the callers own valid Admin session');
SELECT is(pg_temp.presenter_status_after('', true), null::jsonb,
  'status does not expose any connection to a mismatched authenticated actor');
SELECT * FROM finish();
ROLLBACK;
