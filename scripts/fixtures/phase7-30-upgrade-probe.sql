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
