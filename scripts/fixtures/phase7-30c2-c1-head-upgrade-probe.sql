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

insert into public.ai_billing_grants (
  id, lecture_session_id, actor_id, actions, nonce_hash, expires_at
) values (
  '73032000-0000-4000-8000-000000000002'::uuid,
  '73032000-0000-4000-8000-000000000001'::uuid,
  'legacy-upgrade-fixture',
  array['academic_answers', 'summaries']::text[],
  repeat('d', 64),
  statement_timestamp() + interval '30 minutes'
);

insert into public.lecture_summary_runs (
  id, lecture_session_id, actor_id, token_hash, status, started_at,
  expires_at, stopped_at, stop_reason, auto_academic_answers_enabled,
  academic_source_policy, academic_authorization_grant_id
) values
  (
    '73032000-0000-4000-8000-000000000003'::uuid,
    '73032000-0000-4000-8000-000000000001'::uuid,
    'legacy-upgrade-fixture', repeat('e', 64), 'stopped',
    statement_timestamp() - interval '10 minutes',
    statement_timestamp() + interval '20 minutes',
    statement_timestamp() - interval '5 minutes', 'upgrade_fixture',
    true, 'auto',
    '73032000-0000-4000-8000-000000000002'::uuid
  ),
  (
    '73032000-0000-4000-8000-000000000004'::uuid,
    '73032000-0000-4000-8000-000000000001'::uuid,
    'legacy-upgrade-fixture', repeat('f', 64), 'stopped',
    statement_timestamp() - interval '10 minutes',
    statement_timestamp() + interval '20 minutes',
    statement_timestamp() - interval '5 minutes', 'upgrade_fixture',
    false, 'auto', null
  );
