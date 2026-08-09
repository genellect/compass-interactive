insert into public.admin_sessions (
  id,
  token_hash,
  auth_user_id,
  pin_version_hash,
  issued_at,
  last_seen_at,
  idle_expires_at,
  expires_at
) values (
  '73000000-0000-4000-8000-000000000001',
  repeat('7', 64),
  '73000000-0000-4000-8000-000000000002',
  repeat('8', 64),
  statement_timestamp(),
  statement_timestamp(),
  statement_timestamp() + interval '30 minutes',
  statement_timestamp() + interval '8 hours'
);

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
  '73000000-0000-4000-8000-000000000002'::uuid,
  'authenticated',
  'authenticated',
  'phase730-upgrade@example.test',
  '',
  statement_timestamp() - interval '1 hour',
  '{"provider":"google","providers":["google"]}'::jsonb,
  '{}'::jsonb,
  statement_timestamp() - interval '1 hour',
  statement_timestamp() - interval '1 hour'
);

insert into auth.sessions (id, user_id, created_at, updated_at)
values (
  '73000000-0000-4000-8000-000000000003'::uuid,
  '73000000-0000-4000-8000-000000000002'::uuid,
  statement_timestamp() - interval '1 hour',
  statement_timestamp() - interval '1 hour'
);
