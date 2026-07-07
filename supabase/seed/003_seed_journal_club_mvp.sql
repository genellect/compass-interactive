-- Journal Club MVP seed data.
-- Run manually in Supabase SQL Editor after:
-- 1. supabase/migrations/001_initial_schema.sql
-- 2. supabase/manual/create_join_lecture_by_code_rpc.sql
--
-- MVP join code:
--   JC2026
--
-- The plain code is not stored. code_hash uses:
--   encode(extensions.digest(convert_to(upper(trim('JC2026')), 'UTF8'), 'sha256'), 'hex')

create extension if not exists pgcrypto with schema extensions;

insert into public.lecture_sessions (
  id,
  title,
  code_hash,
  status,
  starts_at,
  ends_at
)
values (
  '77777777-7777-4777-8777-777777777777',
  'Journal Club MVP',
  encode(
    extensions.digest(convert_to(upper(trim('JC2026')), 'UTF8'), 'sha256'),
    'hex'
  ),
  'open',
  now() - interval '10 minutes',
  now() + interval '30 days'
)
on conflict (id) do update
set
  title = excluded.title,
  code_hash = excluded.code_hash,
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
  '88888888-8888-4888-8888-888888888888',
  '77777777-7777-4777-8777-777777777777',
  'journal-club-seed-participant',
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
    '99999999-9999-4999-8999-999999999991',
    '77777777-7777-4777-8777-777777777777',
    '88888888-8888-4888-8888-888888888888',
    'Journal Club MVP seed comment: 今日の論文で一番確認したい点を共有しましょう。',
    'visible',
    false,
    now() - interval '5 minutes',
    now() - interval '5 minutes'
  ),
  (
    '99999999-9999-4999-8999-999999999992',
    '77777777-7777-4777-8777-777777777777',
    '88888888-8888-4888-8888-888888888888',
    '英語abstractやfigure legendの理解支援に使えるかを試します。',
    'visible',
    false,
    now() - interval '4 minutes',
    now() - interval '4 minutes'
  )
on conflict (id) do nothing;

-- Poll prompts are maintained separately in:
--   supabase/seed/002_seed_test_polls.sql
--   supabase/manual/replace_active_jc2026_polls.sql
--
-- Keep this lecture seed from re-opening the older Lab DX sample polls.
update public.polls
set status = 'closed',
    updated_at = now()
where lecture_session_id = '77777777-7777-4777-8777-777777777777'
  and id in (
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1'
  );
