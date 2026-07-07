-- Phase 2-D development seed data.
-- Run manually in the Supabase SQL Editor after 001_initial_schema.sql.
-- Do not use this as a production lecture-code verification design.

insert into public.lecture_sessions (
  id,
  title,
  code_hash,
  status,
  starts_at,
  ends_at
)
values (
  '11111111-1111-4111-8111-111111111111',
  'COMPASS Interactive Phase 2-D Test Lecture',
  'dev-only-dummy-code-hash-0000000000000000000000000000000000000000000000000000000000000000',
  'open',
  now() - interval '5 minutes',
  now() + interval '30 days'
)
on conflict (id) do update
set
  title = excluded.title,
  status = 'open',
  starts_at = excluded.starts_at,
  ends_at = excluded.ends_at,
  updated_at = now();

insert into public.participants (
  id,
  lecture_session_id,
  participant_key,
  joined_at,
  last_seen_at
)
values (
  '22222222-2222-4222-8222-222222222222',
  '11111111-1111-4111-8111-111111111111',
  'phase2d-seed-participant',
  now(),
  now()
)
on conflict (id) do nothing;

insert into public.comments (
  id,
  lecture_session_id,
  participant_id,
  body,
  status,
  is_pinned,
  created_at,
  updated_at
)
values
  (
    '33333333-3333-4333-8333-333333333333',
    '11111111-1111-4111-8111-111111111111',
    '22222222-2222-4222-8222-222222222222',
    'Phase 2-D seed comment: Supabaseから取得できる表示確認用コメントです。',
    'visible',
    false,
    now() - interval '5 minutes',
    now() - interval '5 minutes'
  ),
  (
    '44444444-4444-4444-8444-444444444444',
    '11111111-1111-4111-8111-111111111111',
    '22222222-2222-4222-8222-222222222222',
    'コメント投稿の接続確認に使います。likesとpollsはまだmockのままです。',
    'visible',
    false,
    now() - interval '3 minutes',
    now() - interval '3 minutes'
  )
on conflict (id) do nothing;
