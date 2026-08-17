-- Populated D-head state. The E authority migration must preserve existing
-- Google identity, ownership and owner-ledger authority without committing the
-- irreversible cutover.
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
) values
  (
    '00000000-0000-0000-0000-000000000000'::uuid,
    '73035000-0000-4000-8000-000000000002'::uuid,
    'authenticated',
    'authenticated',
    'phase730e-d-head-a@example.test',
    '',
    statement_timestamp() - interval '1 hour',
    '{"provider":"google","providers":["google"]}'::jsonb,
    '{}'::jsonb,
    statement_timestamp() - interval '1 hour',
    statement_timestamp() - interval '1 hour'
  ),
  (
    '00000000-0000-0000-0000-000000000000'::uuid,
    '73035000-0000-4000-8000-000000000003'::uuid,
    'authenticated',
    'authenticated',
    'phase730e-d-head-b@example.test',
    '',
    statement_timestamp() - interval '1 hour',
    '{"provider":"google","providers":["google"]}'::jsonb,
    '{}'::jsonb,
    statement_timestamp() - interval '1 hour',
    statement_timestamp() - interval '1 hour'
  );

insert into auth.sessions (id, user_id, created_at, updated_at)
values (
  '73035000-0000-4000-8000-000000000004'::uuid,
  '73035000-0000-4000-8000-000000000002'::uuid,
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
  '73035000-0000-4000-8000-000000000005'::uuid,
  '73035000-0000-4000-8000-000000000002'::uuid,
  'phase730e-d-head-owner-a',
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
  '73035000-0000-4000-8000-000000000001'::uuid,
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
) values
  (
    '73035000-0000-4000-8000-000000000006'::uuid,
    '73035000-0000-4000-8000-000000000002'::uuid,
    'https://accounts.google.com',
    repeat('a', 64),
    1,
    'phase730e-d-head-a@example.test',
    statement_timestamp() - interval '1 hour',
    'D Head Owner A'
  ),
  (
    '73035000-0000-4000-8000-000000000007'::uuid,
    '73035000-0000-4000-8000-000000000003'::uuid,
    'https://accounts.google.com',
    repeat('b', 64),
    1,
    'phase730e-d-head-b@example.test',
    statement_timestamp() - interval '1 hour',
    'D Head Owner B'
  );

update private.admin_principals
set
  approved_totp_factor_set_hash = snapshot.factor_set_hash,
  approved_totp_factor_set_version = 1,
  approved_totp_factor_count = snapshot.factor_count,
  approved_totp_factor_set_at = statement_timestamp() - interval '30 minutes',
  approved_totp_factor_set_request_id =
    '73035000-0000-4000-8000-00000000000d'::uuid,
  approved_totp_factor_set_source = 'operator_adoption',
  approved_totp_factor_set_actor = 'fixture:phase730e-d-head',
  approved_totp_factor_set_reason = 'D-head owner upgrade evidence'
from private.current_verified_totp_factor_set_snapshot_v1(
  '73035000-0000-4000-8000-000000000002'::uuid
) as snapshot
where id = '73035000-0000-4000-8000-000000000006'::uuid;

insert into private.admin_environment_memberships (
  id,
  environment_id,
  principal_id,
  role,
  status,
  can_use_ai,
  activated_at
) values
  (
    '73035000-0000-4000-8000-000000000008'::uuid,
    '73035000-0000-4000-8000-000000000001'::uuid,
    '73035000-0000-4000-8000-000000000006'::uuid,
    'owner',
    'active',
    false,
    statement_timestamp() - interval '1 hour'
  ),
  (
    '73035000-0000-4000-8000-000000000009'::uuid,
    '73035000-0000-4000-8000-000000000001'::uuid,
    '73035000-0000-4000-8000-000000000007'::uuid,
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
  '73035000-0000-4000-8000-00000000000a'::uuid,
  repeat('2', 64),
  '73035000-0000-4000-8000-00000000000b'::uuid,
  '73035000-0000-4000-8000-000000000001'::uuid,
  '73035000-0000-4000-8000-000000000006'::uuid,
  '73035000-0000-4000-8000-000000000008'::uuid,
  '73035000-0000-4000-8000-000000000004'::uuid,
  'admin_login',
  '73035000-0000-4000-8000-00000000000e'::uuid,
  repeat('3', 64),
  statement_timestamp() - interval '1 minute',
  '73035000-0000-4000-8000-000000000005'::uuid,
  private.current_verified_totp_factor_set_hash_v1(
    '73035000-0000-4000-8000-000000000002'::uuid
  ),
  private.current_verified_totp_factor_set_hash_v1(
    '73035000-0000-4000-8000-000000000002'::uuid
  ),
  false,
  1,
  repeat('4', 64),
  statement_timestamp(),
  statement_timestamp() - interval '1 minute',
  statement_timestamp() + interval '4 minutes'
);

update private.admin_identity_runtime_gate
set
  google_session_issue_enabled = true,
  google_operational_authorization_enabled = true,
  google_admin_ledger_enabled = true
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
  '73035000-0000-4000-8000-00000000000b'::uuid,
  repeat('1', 64),
  '73035000-0000-4000-8000-000000000002'::uuid,
  null,
  'google_totp',
  2,
  '73035000-0000-4000-8000-000000000006'::uuid,
  '73035000-0000-4000-8000-000000000008'::uuid,
  '73035000-0000-4000-8000-000000000001'::uuid,
  '73035000-0000-4000-8000-000000000004'::uuid,
  statement_timestamp(),
  '73035000-0000-4000-8000-00000000000a'::uuid,
  private.current_verified_totp_factor_set_hash_v1(
    '73035000-0000-4000-8000-000000000002'::uuid
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
    '73035000-0000-4000-8000-00000000000b'::uuid,
  updated_at = statement_timestamp()
where id = '73035000-0000-4000-8000-00000000000a'::uuid;

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
  '73035000-0000-4000-8000-00000000000c'::uuid,
  'D-head owned lecture',
  repeat('c', 64),
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
  ownership_intent_digest,
  ownership_source
) values (
  '73035000-0000-4000-8000-00000000000c'::uuid,
  '73035000-0000-4000-8000-000000000001'::uuid,
  '73035000-0000-4000-8000-000000000006'::uuid,
  '73035000-0000-4000-8000-000000000008'::uuid,
  '73035000-0000-4000-8000-00000000000b'::uuid,
  '73035000-0000-4000-8000-00000000000f'::uuid,
  repeat('5', 64),
  'google_create'
);

insert into private.admin_invitations (
  id,
  environment_id,
  invitation_kind,
  target_email_hmac,
  target_normalized_email,
  target_email_pepper_version,
  role,
  can_use_ai,
  token_hash,
  inviter_membership_id,
  membership_expires_at,
  expires_at,
  status,
  request_id
) values (
  '73035000-0000-4000-8000-000000000010'::uuid,
  '73035000-0000-4000-8000-000000000001'::uuid,
  'invitation',
  repeat('6', 64),
  'phase730e-d-head-invitee@example.test',
  1,
  'instructor',
  true,
  repeat('7', 64),
  '73035000-0000-4000-8000-000000000008'::uuid,
  statement_timestamp() + interval '7 days',
  statement_timestamp() + interval '2 days',
  'pending',
  '73035000-0000-4000-8000-000000000011'::uuid
);

insert into private.admin_audit_events (
  request_id,
  environment_id,
  actor_principal_id,
  actor_membership_id,
  actor_session_id,
  action,
  target_type,
  target_id,
  result,
  metadata
) values (
  '73035000-0000-4000-8000-000000000012'::uuid,
  '73035000-0000-4000-8000-000000000001'::uuid,
  '73035000-0000-4000-8000-000000000006'::uuid,
  '73035000-0000-4000-8000-000000000008'::uuid,
  '73035000-0000-4000-8000-00000000000b'::uuid,
  'admin_ledger.upgrade_fixture',
  'admin_invitation',
  '73035000-0000-4000-8000-000000000010',
  'accepted',
  '{"fixture":"phase7.30e-d-head"}'::jsonb
);
