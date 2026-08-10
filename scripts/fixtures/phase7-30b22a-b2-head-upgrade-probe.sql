-- Populated Phase 7.30B2-head state. The upgrade runner resets exactly to the
-- B2 migration, loads this state, then applies only B2.2a.

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  '00000000-0000-0000-0000-000000000000'::uuid,
  '73022000-0000-4000-8000-000000000001'::uuid,
  'authenticated', 'authenticated', 'phase730b22a-b2-head@example.test', '',
  statement_timestamp() - interval '1 hour',
  '{"provider":"google","providers":["google"]}'::jsonb, '{}'::jsonb,
  statement_timestamp() - interval '1 hour',
  statement_timestamp() - interval '1 hour'
);

insert into auth.sessions (id, user_id, created_at, updated_at) values (
  '73022000-0000-4000-8000-000000000002'::uuid,
  '73022000-0000-4000-8000-000000000001'::uuid,
  statement_timestamp() - interval '1 hour',
  statement_timestamp() - interval '1 hour'
);

insert into auth.mfa_factors (
  id, user_id, friendly_name, factor_type, status, created_at, updated_at
) values (
  '73022000-0000-4000-8000-000000000003'::uuid,
  '73022000-0000-4000-8000-000000000001'::uuid,
  'phase730b22a-b2-head-totp', 'totp', 'verified',
  statement_timestamp() - interval '1 hour',
  statement_timestamp() - interval '1 hour'
);

insert into private.admin_environments (
  id, environment_kind, canonical_admin_origin, supabase_issuer,
  current_deployment, bootstrap_sealed_at, owner_invariant_enforced_at
) values (
  '73022000-0000-4000-8000-000000000004'::uuid,
  'local', 'http://127.0.0.1:5173',
  'http://127.0.0.1:54321/auth/v1', true,
  statement_timestamp() - interval '1 hour', statement_timestamp()
);

insert into private.admin_principals (
  id, auth_user_id, google_issuer, provider_subject_hmac,
  subject_pepper_version, normalized_email, email_verified_at
) values (
  '73022000-0000-4000-8000-000000000005'::uuid,
  '73022000-0000-4000-8000-000000000001'::uuid,
  'https://accounts.google.com', repeat('a', 64), 1,
  'phase730b22a-b2-head@example.test',
  statement_timestamp() - interval '1 hour'
);

insert into private.admin_environment_memberships (
  id, environment_id, principal_id, role, status, can_use_ai, activated_at
) values (
  '73022000-0000-4000-8000-000000000006'::uuid,
  '73022000-0000-4000-8000-000000000004'::uuid,
  '73022000-0000-4000-8000-000000000005'::uuid,
  'owner', 'active', true, statement_timestamp() - interval '1 hour'
);

insert into private.admin_step_up_nonces (
  id, nonce_hash, reserved_admin_session_id, environment_id, principal_id,
  membership_id, supabase_auth_session_id, intended_action, request_id,
  prechallenge_jwt_hash, min_amr_at, issued_at, expires_at
) values (
  '73022000-0000-4000-8000-000000000007'::uuid,
  encode(extensions.digest('phase730b22a-b2-head-login', 'sha256'), 'hex'),
  '73022000-0000-4000-8000-000000000008'::uuid,
  '73022000-0000-4000-8000-000000000004'::uuid,
  '73022000-0000-4000-8000-000000000005'::uuid,
  '73022000-0000-4000-8000-000000000006'::uuid,
  '73022000-0000-4000-8000-000000000002'::uuid,
  'admin_login', '73022000-0000-4000-8000-000000000009'::uuid,
  encode(extensions.digest('phase730b22a-b2-head-prejwt', 'sha256'), 'hex'),
  statement_timestamp() - interval '1 hour',
  statement_timestamp() - interval '1 hour',
  statement_timestamp() - interval '55 minutes'
);

insert into public.admin_sessions (
  id, token_hash, auth_user_id, pin_version_hash, authentication_method, aal,
  principal_id, membership_id, environment_id, supabase_auth_session_id,
  step_up_verified_at, step_up_nonce_id, issued_at, last_seen_at,
  idle_expires_at, expires_at
) values (
  '73022000-0000-4000-8000-000000000008'::uuid, repeat('b', 64),
  '73022000-0000-4000-8000-000000000001'::uuid, null, 'google_totp', 2,
  '73022000-0000-4000-8000-000000000005'::uuid,
  '73022000-0000-4000-8000-000000000006'::uuid,
  '73022000-0000-4000-8000-000000000004'::uuid,
  '73022000-0000-4000-8000-000000000002'::uuid,
  statement_timestamp() - interval '1 hour',
  '73022000-0000-4000-8000-000000000007'::uuid,
  statement_timestamp() - interval '1 hour',
  statement_timestamp() - interval '1 hour',
  statement_timestamp() + interval '12 hours',
  statement_timestamp() + interval '12 hours'
);

update private.admin_step_up_nonces
set status = 'consumed', consumed_at = statement_timestamp() - interval '1 hour',
    completed_admin_session_id = '73022000-0000-4000-8000-000000000008'::uuid,
    updated_at = statement_timestamp() - interval '1 hour'
where id = '73022000-0000-4000-8000-000000000007'::uuid;

insert into private.admin_step_up_nonces (
  id, nonce_hash, reserved_admin_session_id, environment_id, principal_id,
  membership_id, supabase_auth_session_id, intended_action, request_id,
  prechallenge_jwt_hash, min_amr_at, issued_at, expires_at
) values (
  '73022000-0000-4000-8000-00000000000b'::uuid,
  encode(extensions.digest('phase730b22a-b2-head-pending-login', 'sha256'), 'hex'),
  '73022000-0000-4000-8000-00000000000c'::uuid,
  '73022000-0000-4000-8000-000000000004'::uuid,
  '73022000-0000-4000-8000-000000000005'::uuid,
  '73022000-0000-4000-8000-000000000006'::uuid,
  '73022000-0000-4000-8000-000000000002'::uuid,
  'admin_login', '73022000-0000-4000-8000-00000000000d'::uuid,
  encode(extensions.digest('phase730b22a-b2-head-pending-prejwt', 'sha256'), 'hex'),
  statement_timestamp(), statement_timestamp(),
  statement_timestamp() + interval '5 minutes'
);

insert into private.admin_ai_unlock_factors (
  id, environment_id, principal_id, membership_id, pin_verifier,
  pin_pepper_version, factor_version, enrolled_by_admin_session_id,
  enrolled_step_up_verified_at, enrollment_request_id
) values (
  '73022000-0000-4000-8000-00000000000e'::uuid,
  '73022000-0000-4000-8000-000000000004'::uuid,
  '73022000-0000-4000-8000-000000000005'::uuid,
  '73022000-0000-4000-8000-000000000006'::uuid,
  extensions.crypt(repeat('c', 64), extensions.gen_salt('bf', 12)),
  1, 1, '73022000-0000-4000-8000-000000000008'::uuid,
  statement_timestamp() - interval '30 minutes',
  '73022000-0000-4000-8000-00000000000f'::uuid
);

insert into private.admin_ai_policies (
  id, environment_id, membership_id, allowed_actions, allowed_models,
  max_calls_per_lecture, max_calls_per_day,
  max_input_tokens_per_lecture, max_input_tokens_per_day,
  max_output_tokens_per_lecture, max_output_tokens_per_day,
  max_cost_microusd_per_lecture, max_cost_microusd_per_day,
  max_realtime_minutes_per_lecture, max_realtime_minutes_per_day,
  max_concurrency, valid_from, valid_until, version,
  created_by_membership_id, created_by_admin_session_id, request_id
) values (
  '73022000-0000-4000-8000-000000000010'::uuid,
  '73022000-0000-4000-8000-000000000004'::uuid,
  '73022000-0000-4000-8000-000000000006'::uuid,
  array['academic_answers', 'summaries']::text[], array['test-model']::text[],
  10, 100, 10000, 100000, 10000, 100000, 100000, 1000000,
  0, 0, 1, statement_timestamp() - interval '1 hour',
  statement_timestamp() + interval '1 day', 1,
  '73022000-0000-4000-8000-000000000006'::uuid,
  '73022000-0000-4000-8000-000000000008'::uuid,
  '73022000-0000-4000-8000-000000000011'::uuid
);

insert into private.admin_ai_unlock_rate_limits (
  environment_id, bucket_kind, bucket_key, membership_id, window_started_at,
  failed_attempts
) values (
  '73022000-0000-4000-8000-000000000004'::uuid, 'membership',
  '73022000-0000-4000-8000-000000000006',
  '73022000-0000-4000-8000-000000000006'::uuid,
  statement_timestamp() - interval '1 minute', 1
);

insert into private.admin_ai_browser_enrollment_nonces (
  id, nonce_hash, reserved_browser_credential_id, credential_hash,
  environment_id, principal_id, membership_id, admin_session_id,
  factor_id, factor_version, step_up_verified_at, origin,
  public_key_fingerprint, absolute_expires_at, begin_request_id, expires_at
) values (
  '73022000-0000-4000-8000-000000000012'::uuid,
  encode(extensions.digest('phase730b22a-consumed-enrollment', 'sha256'), 'hex'),
  '73022000-0000-4000-8000-000000000013'::uuid,
  encode(extensions.digest('phase730b22a-active-credential', 'sha256'), 'hex'),
  '73022000-0000-4000-8000-000000000004'::uuid,
  '73022000-0000-4000-8000-000000000005'::uuid,
  '73022000-0000-4000-8000-000000000006'::uuid,
  '73022000-0000-4000-8000-000000000008'::uuid,
  '73022000-0000-4000-8000-00000000000e'::uuid, 1,
  statement_timestamp() - interval '30 minutes', 'http://127.0.0.1:5173',
  'dd7ef224fe88ca6549161590c561f7a348c3f7482ec9c635e7cfa527f8a55d10',
  statement_timestamp() + interval '1 day',
  '73022000-0000-4000-8000-000000000014'::uuid,
  statement_timestamp() + interval '5 minutes'
);

insert into private.admin_ai_browser_credentials (
  id, credential_hash, environment_id, principal_id, membership_id,
  source_factor_id, source_factor_version, origin, public_key_jwk,
  public_key_fingerprint, enrolled_by_admin_session_id, enrollment_nonce_id,
  expires_at
) values (
  '73022000-0000-4000-8000-000000000013'::uuid,
  encode(extensions.digest('phase730b22a-active-credential', 'sha256'), 'hex'),
  '73022000-0000-4000-8000-000000000004'::uuid,
  '73022000-0000-4000-8000-000000000005'::uuid,
  '73022000-0000-4000-8000-000000000006'::uuid,
  '73022000-0000-4000-8000-00000000000e'::uuid, 1,
  'http://127.0.0.1:5173',
  jsonb_build_object('kty', 'EC', 'crv', 'P-256',
    'x', repeat('A', 43), 'y', repeat('B', 43)),
  'dd7ef224fe88ca6549161590c561f7a348c3f7482ec9c635e7cfa527f8a55d10',
  '73022000-0000-4000-8000-000000000008'::uuid,
  '73022000-0000-4000-8000-000000000012'::uuid,
  statement_timestamp() + interval '1 day'
);

update private.admin_ai_browser_enrollment_nonces
set status = 'consumed', consumed_at = statement_timestamp(),
    completion_request_id = '73022000-0000-4000-8000-000000000015'::uuid,
    completion_intent_digest =
      encode(extensions.digest('phase730b22a-enrollment-complete', 'sha256'), 'hex'),
    completed_browser_credential_id = '73022000-0000-4000-8000-000000000013'::uuid,
    updated_at = statement_timestamp()
where id = '73022000-0000-4000-8000-000000000012'::uuid;

insert into private.admin_ai_browser_enrollment_nonces (
  id, nonce_hash, reserved_browser_credential_id, credential_hash,
  environment_id, principal_id, membership_id, admin_session_id,
  factor_id, factor_version, step_up_verified_at, origin,
  public_key_fingerprint, absolute_expires_at, begin_request_id, expires_at
) values (
  '73022000-0000-4000-8000-000000000016'::uuid,
  encode(extensions.digest('phase730b22a-pending-enrollment', 'sha256'), 'hex'),
  '73022000-0000-4000-8000-000000000017'::uuid,
  encode(extensions.digest('phase730b22a-pending-credential', 'sha256'), 'hex'),
  '73022000-0000-4000-8000-000000000004'::uuid,
  '73022000-0000-4000-8000-000000000005'::uuid,
  '73022000-0000-4000-8000-000000000006'::uuid,
  '73022000-0000-4000-8000-000000000008'::uuid,
  '73022000-0000-4000-8000-00000000000e'::uuid, 1,
  statement_timestamp(), 'http://127.0.0.1:5173', repeat('d', 64),
  statement_timestamp() + interval '1 day',
  '73022000-0000-4000-8000-000000000018'::uuid,
  statement_timestamp() + interval '5 minutes'
);

insert into public.lecture_sessions (
  id, title, code_hash, status, starts_at, ends_at
) values (
  '73022000-0000-4000-8000-000000000019'::uuid,
  'B2-head B2.2a upgrade probe', repeat('e', 64), 'open',
  statement_timestamp() - interval '5 minutes',
  statement_timestamp() + interval '1 hour'
);
insert into public.lecture_ai_control (lecture_session_id)
values ('73022000-0000-4000-8000-000000000019'::uuid);

insert into private.admin_ai_browser_assertion_challenges (
  id, challenge_hash, browser_credential_id, environment_id, principal_id,
  membership_id, admin_session_id, factor_id, factor_version,
  lecture_session_id, requested_scope, policy_id, policy_version, origin,
  begin_request_id, expires_at
) values (
  '73022000-0000-4000-8000-00000000001a'::uuid, repeat('f', 64),
  '73022000-0000-4000-8000-000000000013'::uuid,
  '73022000-0000-4000-8000-000000000004'::uuid,
  '73022000-0000-4000-8000-000000000005'::uuid,
  '73022000-0000-4000-8000-000000000006'::uuid,
  '73022000-0000-4000-8000-000000000008'::uuid,
  '73022000-0000-4000-8000-00000000000e'::uuid, 1,
  '73022000-0000-4000-8000-000000000019'::uuid,
  'all_except_captions', '73022000-0000-4000-8000-000000000010'::uuid, 1,
  'http://127.0.0.1:5173',
  '73022000-0000-4000-8000-00000000001b'::uuid,
  statement_timestamp() + interval '5 minutes'
);

insert into private.admin_ai_pin_discovery_receipts (
  request_id, intent_digest, network_hmac, environment_id, principal_id,
  membership_id, admin_session_id, factor_id, factor_version,
  pin_pepper_version, expires_at
) values (
  '73022000-0000-4000-8000-00000000001c'::uuid, repeat('1', 64),
  repeat('2', 64), '73022000-0000-4000-8000-000000000004'::uuid,
  '73022000-0000-4000-8000-000000000005'::uuid,
  '73022000-0000-4000-8000-000000000006'::uuid,
  '73022000-0000-4000-8000-000000000008'::uuid,
  '73022000-0000-4000-8000-00000000000e'::uuid, 1, 1,
  statement_timestamp() + interval '5 minutes'
);

insert into private.admin_ai_unlock_attempt_receipts (
  request_id, intent_digest, environment_id, principal_id, membership_id,
  admin_session_id, factor_id, factor_version, factor_pin_pepper_version,
  input_pin_pepper_version, input_pin_proof_digest, verified, reason_code
) values (
  '73022000-0000-4000-8000-00000000001d'::uuid, repeat('3', 64),
  '73022000-0000-4000-8000-000000000004'::uuid,
  '73022000-0000-4000-8000-000000000005'::uuid,
  '73022000-0000-4000-8000-000000000006'::uuid,
  '73022000-0000-4000-8000-000000000008'::uuid,
  '73022000-0000-4000-8000-00000000000e'::uuid, 1, 1, 1,
  repeat('4', 64), true, 'verified'
);

insert into public.lecture_ai_master_authorizations (
  id, lecture_session_id, admin_session_id, actor_id, scope, actions,
  expires_at, principal_id, membership_id, issuing_admin_session_id,
  ai_policy_id, ai_policy_version, unlock_method, unlock_factor_id,
  unlock_factor_version, unlock_verified_at, step_up_verified_at
) values (
  '73022000-0000-4000-8000-00000000001e'::uuid,
  '73022000-0000-4000-8000-000000000019'::uuid,
  '73022000-0000-4000-8000-000000000008'::uuid,
  'admin-session:73022000-0000-4000-8000-000000000008',
  'all_except_captions',
  array['academic_answers', 'material_analysis', 'poll_suggestions', 'summaries']::text[],
  statement_timestamp() + interval '1 hour',
  '73022000-0000-4000-8000-000000000005'::uuid,
  '73022000-0000-4000-8000-000000000006'::uuid,
  '73022000-0000-4000-8000-000000000008'::uuid,
  '73022000-0000-4000-8000-000000000010'::uuid, 1, 'ai_pin',
  '73022000-0000-4000-8000-00000000000e'::uuid, 1,
  statement_timestamp(), statement_timestamp()
);
