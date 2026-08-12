update private.admin_identity_runtime_gate
set google_session_issue_enabled = true
where singleton;

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
  '73020000-0000-4000-8000-000000000001'::uuid,
  'authenticated',
  'authenticated',
  'phase730b2-upgrade@example.test',
  '',
  statement_timestamp() - interval '1 hour',
  '{"provider":"google","providers":["google"]}'::jsonb,
  '{}'::jsonb,
  statement_timestamp() - interval '1 hour',
  statement_timestamp() - interval '1 hour'
);

insert into auth.sessions (id, user_id, created_at, updated_at)
values (
  '73020000-0000-4000-8000-000000000002'::uuid,
  '73020000-0000-4000-8000-000000000001'::uuid,
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
  '73020000-0000-4000-8000-000000000003'::uuid,
  'local',
  'http://127.0.0.1:5173',
  'http://127.0.0.1:54321/auth/v1',
  true,
  statement_timestamp() - interval '1 hour',
  statement_timestamp()
);

insert into private.admin_principals (
  id,
  auth_user_id,
  google_issuer,
  provider_subject_hmac,
  subject_pepper_version,
  normalized_email,
  email_verified_at
) values (
  '73020000-0000-4000-8000-000000000004'::uuid,
  '73020000-0000-4000-8000-000000000001'::uuid,
  'https://accounts.google.com',
  repeat('a', 64),
  1,
  'phase730b2-upgrade@example.test',
  statement_timestamp() - interval '1 hour'
);

insert into private.admin_environment_memberships (
  id,
  environment_id,
  principal_id,
  role,
  status,
  can_use_ai,
  activated_at
) values (
  '73020000-0000-4000-8000-000000000005'::uuid,
  '73020000-0000-4000-8000-000000000003'::uuid,
  '73020000-0000-4000-8000-000000000004'::uuid,
  'owner',
  'active',
  true,
  statement_timestamp() - interval '1 hour'
);

insert into private.admin_invitations (
  id, environment_id, invitation_kind, target_email_hmac, role, can_use_ai,
  token_hash, inviter_membership_id, expires_at, status,
  accepted_principal_id, accepted_membership_id, accepted_at,
  request_id, created_at, updated_at
) values
  (
    '73020000-0000-4000-8000-00000000000c'::uuid,
    '73020000-0000-4000-8000-000000000003'::uuid,
    'bootstrap', repeat('c', 64), 'owner', true, null, null,
    statement_timestamp() + interval '7 days', 'accepted',
    '73020000-0000-4000-8000-000000000004'::uuid,
    '73020000-0000-4000-8000-000000000005'::uuid,
    statement_timestamp() - interval '50 minutes',
    '73020000-0000-4000-8000-00000000000d'::uuid,
    statement_timestamp() - interval '1 hour',
    statement_timestamp() - interval '50 minutes'
  ),
  (
    '73020000-0000-4000-8000-00000000000e'::uuid,
    '73020000-0000-4000-8000-000000000003'::uuid,
    'invitation', repeat('d', 64), 'instructor', true, repeat('1', 64),
    '73020000-0000-4000-8000-000000000005'::uuid,
    statement_timestamp() + interval '7 days', 'pending',
    null, null, null,
    '73020000-0000-4000-8000-00000000000f'::uuid,
    statement_timestamp() - interval '40 minutes',
    statement_timestamp() - interval '40 minutes'
  ),
  (
    '73020000-0000-4000-8000-000000000010'::uuid,
    '73020000-0000-4000-8000-000000000003'::uuid,
    'invitation', repeat('e', 64), 'instructor', false, repeat('2', 64),
    '73020000-0000-4000-8000-000000000005'::uuid,
    statement_timestamp() + interval '7 days', 'revoked',
    null, null, null,
    '73020000-0000-4000-8000-000000000011'::uuid,
    statement_timestamp() - interval '30 minutes',
    statement_timestamp() - interval '20 minutes'
  ),
  (
    '73020000-0000-4000-8000-000000000012'::uuid,
    '73020000-0000-4000-8000-000000000003'::uuid,
    'invitation', repeat('f', 64), 'instructor', false, repeat('3', 64),
    '73020000-0000-4000-8000-000000000005'::uuid,
    statement_timestamp() - interval '5 minutes', 'expired',
    null, null, null,
    '73020000-0000-4000-8000-000000000013'::uuid,
    statement_timestamp() - interval '30 minutes',
    statement_timestamp() - interval '5 minutes'
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
  issued_at,
  expires_at
) values (
  '73020000-0000-4000-8000-000000000007'::uuid,
  encode(extensions.digest('phase7.30b2-upgrade-login-nonce', 'sha256'), 'hex'),
  '73020000-0000-4000-8000-000000000006'::uuid,
  '73020000-0000-4000-8000-000000000003'::uuid,
  '73020000-0000-4000-8000-000000000004'::uuid,
  '73020000-0000-4000-8000-000000000005'::uuid,
  '73020000-0000-4000-8000-000000000002'::uuid,
  'admin_login',
  '73020000-0000-4000-8000-000000000008'::uuid,
  encode(extensions.digest('phase7.30b2-upgrade-prechallenge', 'sha256'), 'hex'),
  statement_timestamp() - interval '1 hour',
  statement_timestamp() - interval '1 hour',
  statement_timestamp() - interval '55 minutes'
);

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
  issued_at,
  last_seen_at,
  idle_expires_at,
  expires_at
) values (
  '73020000-0000-4000-8000-000000000006'::uuid,
  repeat('b', 64),
  '73020000-0000-4000-8000-000000000001'::uuid,
  null,
  'google_totp',
  2,
  '73020000-0000-4000-8000-000000000004'::uuid,
  '73020000-0000-4000-8000-000000000005'::uuid,
  '73020000-0000-4000-8000-000000000003'::uuid,
  '73020000-0000-4000-8000-000000000002'::uuid,
  statement_timestamp() - interval '1 hour',
  '73020000-0000-4000-8000-000000000007'::uuid,
  statement_timestamp() - interval '1 hour',
  statement_timestamp() - interval '1 hour',
  statement_timestamp() + interval '12 hours',
  statement_timestamp() + interval '12 hours'
);

update private.admin_step_up_nonces
set
  status = 'consumed',
  consumed_at = statement_timestamp() - interval '1 hour',
  completed_admin_session_id = '73020000-0000-4000-8000-000000000006'::uuid,
  updated_at = statement_timestamp() - interval '1 hour'
where id = '73020000-0000-4000-8000-000000000007'::uuid;

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
  issued_at,
  expires_at
) values (
  '73020000-0000-4000-8000-000000000009'::uuid,
  encode(extensions.digest('phase7.30b2-upgrade-pending-login', 'sha256'), 'hex'),
  '73020000-0000-4000-8000-00000000000a'::uuid,
  '73020000-0000-4000-8000-000000000003'::uuid,
  '73020000-0000-4000-8000-000000000004'::uuid,
  '73020000-0000-4000-8000-000000000005'::uuid,
  '73020000-0000-4000-8000-000000000002'::uuid,
  'admin_login',
  '73020000-0000-4000-8000-00000000000b'::uuid,
  encode(extensions.digest('phase7.30b2-upgrade-pending-prejwt', 'sha256'), 'hex'),
  statement_timestamp(),
  statement_timestamp(),
  statement_timestamp() + interval '5 minutes'
);
