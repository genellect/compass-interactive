-- Populated C2-head state. Phase 7.30E must preserve the exact durable Google
-- Display root while adding terminal review for an expired signed capability.
insert into auth.users (
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
) values (
  '00000000-0000-0000-0000-000000000000'::uuid,
  '73034000-0000-4000-8000-000000000002'::uuid,
  'authenticated',
  'authenticated',
  'phase730e-c2-head@example.test',
  '',
  statement_timestamp() - interval '1 hour',
  '{"provider":"google","providers":["google"]}'::jsonb,
  '{}'::jsonb,
  statement_timestamp() - interval '1 hour',
  statement_timestamp() - interval '1 hour'
);

insert into auth.sessions (id, user_id, created_at, updated_at)
values (
  '73034000-0000-4000-8000-000000000003'::uuid,
  '73034000-0000-4000-8000-000000000002'::uuid,
  statement_timestamp() - interval '1 hour',
  statement_timestamp() - interval '1 hour'
);

insert into auth.mfa_factors (
  id,
  user_id,
  friendly_name,
  factor_type,
  status,
  created_at,
  updated_at
) values (
  '73034000-0000-4000-8000-000000000004'::uuid,
  '73034000-0000-4000-8000-000000000002'::uuid,
  'phase730e-c2-head-totp',
  'totp',
  'verified',
  statement_timestamp() - interval '1 hour',
  statement_timestamp() - interval '1 hour'
);

insert into private.admin_environments (
  id,
  environment_kind,
  canonical_admin_origin,
  supabase_issuer,
  current_deployment,
  bootstrap_sealed_at,
  owner_invariant_enforced_at
) values (
  '73034000-0000-4000-8000-000000000001'::uuid,
  'local',
  'http://127.0.0.1:5173',
  'http://127.0.0.1:54321/auth/v1',
  true,
  statement_timestamp() - interval '1 hour',
  statement_timestamp() - interval '1 hour'
);

insert into private.admin_principals (
  id,
  auth_user_id,
  google_issuer,
  provider_subject_hmac,
  subject_pepper_version,
  normalized_email,
  email_verified_at,
  display_name
) values (
  '73034000-0000-4000-8000-000000000005'::uuid,
  '73034000-0000-4000-8000-000000000002'::uuid,
  'https://accounts.google.com',
  repeat('a', 64),
  1,
  'phase730e-c2-head@example.test',
  statement_timestamp() - interval '1 hour',
  'C2 Head Owner'
);

update private.admin_principals
set
  approved_totp_factor_set_hash = snapshot.factor_set_hash,
  approved_totp_factor_set_version = 1,
  approved_totp_factor_count = snapshot.factor_count,
  approved_totp_factor_set_at = statement_timestamp() - interval '30 minutes',
  approved_totp_factor_set_request_id =
    '73034000-0000-4000-8000-00000000000a'::uuid,
  approved_totp_factor_set_source = 'operator_adoption',
  approved_totp_factor_set_actor = 'fixture:phase730e-c2-head',
  approved_totp_factor_set_reason = 'C2-head Display upgrade evidence'
from private.current_verified_totp_factor_set_snapshot_v1(
  '73034000-0000-4000-8000-000000000002'::uuid
) as snapshot
where id = '73034000-0000-4000-8000-000000000005'::uuid;

insert into private.admin_environment_memberships (
  id,
  environment_id,
  principal_id,
  role,
  status,
  can_use_ai,
  activated_at
) values (
  '73034000-0000-4000-8000-000000000006'::uuid,
  '73034000-0000-4000-8000-000000000001'::uuid,
  '73034000-0000-4000-8000-000000000005'::uuid,
  'owner',
  'active',
  true,
  statement_timestamp() - interval '1 hour'
);

insert into private.admin_step_up_nonces (
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
  challenged_totp_factor_id,
  prechallenge_verified_totp_factor_set_hash,
  verified_totp_factor_set_hash,
  factor_set_bootstrap_allowed,
  approved_totp_factor_set_version,
  completion_jwt_hash,
  verified_totp_amr_at,
  issued_at,
  expires_at
) values (
  '73034000-0000-4000-8000-000000000007'::uuid,
  repeat('2', 64),
  '73034000-0000-4000-8000-000000000008'::uuid,
  '73034000-0000-4000-8000-000000000001'::uuid,
  '73034000-0000-4000-8000-000000000005'::uuid,
  '73034000-0000-4000-8000-000000000006'::uuid,
  '73034000-0000-4000-8000-000000000003'::uuid,
  'admin_login',
  '73034000-0000-4000-8000-00000000000b'::uuid,
  repeat('3', 64),
  statement_timestamp() - interval '1 minute',
  '73034000-0000-4000-8000-000000000004'::uuid,
  private.current_verified_totp_factor_set_hash_v1(
    '73034000-0000-4000-8000-000000000002'::uuid
  ),
  private.current_verified_totp_factor_set_hash_v1(
    '73034000-0000-4000-8000-000000000002'::uuid
  ),
  false,
  1,
  repeat('4', 64),
  statement_timestamp(),
  statement_timestamp() - interval '1 minute',
  statement_timestamp() + interval '4 minutes'
);

update private.admin_identity_runtime_gate
set google_session_issue_enabled = true
where singleton;

insert into public.admin_sessions (
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
  verified_totp_factor_set_hash,
  issued_at,
  last_seen_at,
  idle_expires_at,
  expires_at
) values (
  '73034000-0000-4000-8000-000000000008'::uuid,
  repeat('1', 64),
  '73034000-0000-4000-8000-000000000002'::uuid,
  null,
  'google_totp',
  2,
  '73034000-0000-4000-8000-000000000005'::uuid,
  '73034000-0000-4000-8000-000000000006'::uuid,
  '73034000-0000-4000-8000-000000000001'::uuid,
  '73034000-0000-4000-8000-000000000003'::uuid,
  statement_timestamp(),
  '73034000-0000-4000-8000-000000000007'::uuid,
  private.current_verified_totp_factor_set_hash_v1(
    '73034000-0000-4000-8000-000000000002'::uuid
  ),
  statement_timestamp() - interval '1 hour',
  statement_timestamp() - interval '1 hour',
  statement_timestamp() + interval '6 hours',
  statement_timestamp() + interval '6 hours'
);

update private.admin_step_up_nonces
set
  status = 'consumed',
  consumed_at = statement_timestamp(),
  completed_admin_session_id =
    '73034000-0000-4000-8000-000000000008'::uuid,
  updated_at = statement_timestamp()
where id = '73034000-0000-4000-8000-000000000007'::uuid;

update private.admin_identity_runtime_gate
set google_session_issue_enabled = false
where singleton;

insert into public.lecture_sessions (
  id,
  title,
  code_hash,
  status,
  starts_at,
  started_at,
  hard_stop_at,
  ends_at
) values (
  '73034000-0000-4000-8000-000000000009'::uuid,
  'C2-head Google Display terminal upgrade',
  repeat('d', 64),
  'open',
  statement_timestamp() - interval '5 minutes',
  statement_timestamp() - interval '5 minutes',
  statement_timestamp() + interval '1 hour',
  statement_timestamp() + interval '1 hour'
);

insert into private.admin_lecture_ownerships (
  lecture_session_id,
  environment_id,
  principal_id,
  membership_id,
  assigned_by_admin_session_id,
  ownership_request_id,
  ownership_intent_digest
) values (
  '73034000-0000-4000-8000-000000000009'::uuid,
  '73034000-0000-4000-8000-000000000001'::uuid,
  '73034000-0000-4000-8000-000000000005'::uuid,
  '73034000-0000-4000-8000-000000000006'::uuid,
  '73034000-0000-4000-8000-000000000008'::uuid,
  '73034000-0000-4000-8000-00000000000c'::uuid,
  repeat('9', 64)
);

insert into private.admin_google_display_sessions (
  id,
  token_jti_hash,
  lecture_session_id,
  admin_session_id,
  admin_auth_user_id,
  realtime_enabled,
  display_auth_user_id,
  issued_at,
  claimed_at,
  expires_at,
  hard_stop_at
) values (
  '73034000-0000-4000-8000-00000000000d'::uuid,
  repeat('e', 64),
  '73034000-0000-4000-8000-000000000009'::uuid,
  '73034000-0000-4000-8000-000000000008'::uuid,
  '73034000-0000-4000-8000-000000000002'::uuid,
  false,
  null,
  '2026-01-01 00:00:00+00'::timestamptz,
  null,
  '2026-01-01 00:05:00+00'::timestamptz,
  '2026-01-01 00:00:00+00'::timestamptz
);
