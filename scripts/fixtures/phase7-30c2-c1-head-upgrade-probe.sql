-- Populated C1-head state. C2 must preserve the lecture while refusing to
-- infer an owner or fabricate operational receipts for pre-C2 data.
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
  '73032000-0000-4000-8000-000000000001'::uuid,
  'pre-C2 unowned active lecture',
  repeat('c', 64),
  'open',
  statement_timestamp() - interval '5 minutes',
  statement_timestamp() - interval '5 minutes',
  statement_timestamp() + interval '1 hour',
  statement_timestamp() + interval '1 hour'
);
