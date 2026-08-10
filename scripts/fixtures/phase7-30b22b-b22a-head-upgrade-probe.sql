-- Populated Phase 7.30B2.2a-head state. The upgrade runner resets exactly to
-- B2.2a, loads this state, then applies only B2.2b. Browser rows deliberately
-- predate the B2.2b trust binding even though the principal anchor exists.

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  '00000000-0000-0000-0000-000000000000'::uuid,
  '73023000-0000-4000-8000-000000000001'::uuid,
  'authenticated', 'authenticated', 'phase730b22b-b22a-head@example.test', '',
  statement_timestamp() - interval '1 hour',
  '{"provider":"google","providers":["google"]}'::jsonb, '{}'::jsonb,
  statement_timestamp() - interval '1 hour',
  statement_timestamp() - interval '1 hour'
);

insert into auth.sessions (id, user_id, created_at, updated_at) values (
  '73023000-0000-4000-8000-000000000002'::uuid,
  '73023000-0000-4000-8000-000000000001'::uuid,
  statement_timestamp() - interval '1 hour',
  statement_timestamp() - interval '1 hour'
);

insert into auth.mfa_factors (
  id, user_id, friendly_name, factor_type, status, created_at, updated_at
) values (
  '73023000-0000-4000-8000-000000000003'::uuid,
  '73023000-0000-4000-8000-000000000001'::uuid,
  'phase730b22b-b22a-head-totp', 'totp', 'verified',
  statement_timestamp() - interval '1 hour',
  statement_timestamp() - interval '1 hour'
);

insert into private.admin_environments (
  id, environment_kind, canonical_admin_origin, supabase_issuer,
  current_deployment, bootstrap_sealed_at, owner_invariant_enforced_at
) values (
  '73023000-0000-4000-8000-000000000004'::uuid,
  'local', 'http://127.0.0.1:5173',
  'http://127.0.0.1:54321/auth/v1', true,
  statement_timestamp() - interval '1 hour', statement_timestamp()
);

insert into private.admin_principals (
  id, auth_user_id, google_issuer, provider_subject_hmac,
  subject_pepper_version, normalized_email, email_verified_at
) values (
  '73023000-0000-4000-8000-000000000005'::uuid,
  '73023000-0000-4000-8000-000000000001'::uuid,
  'https://accounts.google.com', repeat('a', 64), 1,
  'phase730b22b-b22a-head@example.test',
  statement_timestamp() - interval '1 hour'
);

update private.admin_principals
set approved_totp_factor_set_hash = snapshot.factor_set_hash,
    approved_totp_factor_set_version = 1,
    approved_totp_factor_count = snapshot.factor_count,
    approved_totp_factor_set_at = statement_timestamp() - interval '30 minutes',
    approved_totp_factor_set_request_id =
      '73023000-0000-4000-8000-000000000006'::uuid,
    approved_totp_factor_set_source = 'operator_adoption',
    approved_totp_factor_set_actor = 'operator:upgrade_fixture',
    approved_totp_factor_set_reason = 'B2.2a-head populated upgrade evidence'
from private.current_verified_totp_factor_set_snapshot_v1(
  '73023000-0000-4000-8000-000000000001'::uuid
) as snapshot
where id = '73023000-0000-4000-8000-000000000005'::uuid;

insert into private.admin_environment_memberships (
  id, environment_id, principal_id, role, status, can_use_ai, activated_at
) values (
  '73023000-0000-4000-8000-000000000007'::uuid,
  '73023000-0000-4000-8000-000000000004'::uuid,
  '73023000-0000-4000-8000-000000000005'::uuid,
  'owner', 'active', true, statement_timestamp() - interval '1 hour'
);

-- A legacy app-session row is sufficient provenance for the pre-B2.2b B2
-- browser tables; B2.2b must not infer a Google/TOTP binding from it.
insert into public.admin_sessions (
  id, token_hash, auth_user_id, pin_version_hash, authentication_method, aal,
  issued_at, last_seen_at, idle_expires_at, expires_at
) values (
  '73023000-0000-4000-8000-000000000008'::uuid,
  repeat('b', 64), '73023000-0000-4000-8000-000000000001'::uuid,
  repeat('c', 64), 'legacy_pin', 1,
  statement_timestamp() - interval '30 minutes',
  statement_timestamp() - interval '30 minutes',
  statement_timestamp() + interval '30 minutes',
  statement_timestamp() + interval '7 hours 30 minutes'
);

insert into private.admin_ai_unlock_factors (
  id, environment_id, principal_id, membership_id, pin_verifier,
  pin_pepper_version, factor_version, enrolled_by_admin_session_id,
  enrolled_step_up_verified_at, enrollment_request_id
) values (
  '73023000-0000-4000-8000-000000000009'::uuid,
  '73023000-0000-4000-8000-000000000004'::uuid,
  '73023000-0000-4000-8000-000000000005'::uuid,
  '73023000-0000-4000-8000-000000000007'::uuid,
  extensions.crypt(repeat('d', 64), extensions.gen_salt('bf', 12)),
  1, 1, '73023000-0000-4000-8000-000000000008'::uuid,
  statement_timestamp() - interval '30 minutes',
  '73023000-0000-4000-8000-00000000000a'::uuid
);

insert into private.admin_ai_browser_enrollment_nonces (
  id, nonce_hash, reserved_browser_credential_id, credential_hash,
  environment_id, principal_id, membership_id, admin_session_id,
  factor_id, factor_version, step_up_verified_at, origin,
  public_key_fingerprint, absolute_expires_at, begin_request_id, expires_at
) values (
  '73023000-0000-4000-8000-00000000000b'::uuid,
  encode(extensions.digest('phase730b22b-consumed-enrollment', 'sha256'), 'hex'),
  '73023000-0000-4000-8000-00000000000c'::uuid,
  encode(extensions.digest('phase730b22b-active-credential', 'sha256'), 'hex'),
  '73023000-0000-4000-8000-000000000004'::uuid,
  '73023000-0000-4000-8000-000000000005'::uuid,
  '73023000-0000-4000-8000-000000000007'::uuid,
  '73023000-0000-4000-8000-000000000008'::uuid,
  '73023000-0000-4000-8000-000000000009'::uuid, 1,
  statement_timestamp() - interval '30 minutes', 'http://127.0.0.1:5173',
  'dd7ef224fe88ca6549161590c561f7a348c3f7482ec9c635e7cfa527f8a55d10',
  statement_timestamp() + interval '1 day',
  '73023000-0000-4000-8000-00000000000d'::uuid,
  statement_timestamp() + interval '5 minutes'
);

insert into private.admin_ai_browser_credentials (
  id, credential_hash, environment_id, principal_id, membership_id,
  source_factor_id, source_factor_version, origin, public_key_jwk,
  public_key_fingerprint, enrolled_by_admin_session_id, enrollment_nonce_id,
  expires_at
) values (
  '73023000-0000-4000-8000-00000000000c'::uuid,
  encode(extensions.digest('phase730b22b-active-credential', 'sha256'), 'hex'),
  '73023000-0000-4000-8000-000000000004'::uuid,
  '73023000-0000-4000-8000-000000000005'::uuid,
  '73023000-0000-4000-8000-000000000007'::uuid,
  '73023000-0000-4000-8000-000000000009'::uuid, 1,
  'http://127.0.0.1:5173',
  jsonb_build_object('kty', 'EC', 'crv', 'P-256',
    'x', repeat('A', 43), 'y', repeat('B', 43)),
  'dd7ef224fe88ca6549161590c561f7a348c3f7482ec9c635e7cfa527f8a55d10',
  '73023000-0000-4000-8000-000000000008'::uuid,
  '73023000-0000-4000-8000-00000000000b'::uuid,
  statement_timestamp() + interval '1 day'
);

update private.admin_ai_browser_enrollment_nonces
set status = 'consumed', consumed_at = statement_timestamp(),
    completion_request_id = '73023000-0000-4000-8000-00000000000e'::uuid,
    completion_intent_digest = repeat('e', 64),
    completed_browser_credential_id =
      '73023000-0000-4000-8000-00000000000c'::uuid,
    updated_at = statement_timestamp()
where id = '73023000-0000-4000-8000-00000000000b'::uuid;

insert into private.admin_ai_browser_enrollment_nonces (
  id, nonce_hash, reserved_browser_credential_id, credential_hash,
  environment_id, principal_id, membership_id, admin_session_id,
  factor_id, factor_version, step_up_verified_at, origin,
  public_key_fingerprint, absolute_expires_at, begin_request_id, expires_at
) values (
  '73023000-0000-4000-8000-00000000000f'::uuid,
  encode(extensions.digest('phase730b22b-pending-enrollment', 'sha256'), 'hex'),
  '73023000-0000-4000-8000-000000000010'::uuid,
  encode(extensions.digest('phase730b22b-pending-credential', 'sha256'), 'hex'),
  '73023000-0000-4000-8000-000000000004'::uuid,
  '73023000-0000-4000-8000-000000000005'::uuid,
  '73023000-0000-4000-8000-000000000007'::uuid,
  '73023000-0000-4000-8000-000000000008'::uuid,
  '73023000-0000-4000-8000-000000000009'::uuid, 1,
  statement_timestamp(), 'http://127.0.0.1:5173', repeat('f', 64),
  statement_timestamp() + interval '1 day',
  '73023000-0000-4000-8000-000000000011'::uuid,
  statement_timestamp() + interval '5 minutes'
);
