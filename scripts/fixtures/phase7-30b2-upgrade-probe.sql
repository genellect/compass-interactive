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
  owner_invariant_enforced_at
) values (
  '73020000-0000-4000-8000-000000000003'::uuid,
  'local',
  'http://127.0.0.1:5173',
  'http://127.0.0.1:54321/auth/v1',
  true,
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
  statement_timestamp() - interval '1 hour',
  statement_timestamp() - interval '1 hour',
  statement_timestamp() + interval '12 hours',
  statement_timestamp() + interval '12 hours'
);
