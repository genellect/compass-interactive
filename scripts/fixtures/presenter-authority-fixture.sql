-- Local synthetic Google fixture. No real credentials, content or teacher action.
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
