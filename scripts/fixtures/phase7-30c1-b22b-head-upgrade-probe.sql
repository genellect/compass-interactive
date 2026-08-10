-- Populated B2.2b-head state. C1 must not infer an owner or AI authority for
-- this pre-C1 populated lecture.
insert into public.lecture_sessions (
  id, title, code_hash, status, starts_at, started_at, hard_stop_at, ends_at
) values (
  '73031000-0000-4000-8000-000000000001'::uuid,
  'pre-C1 populated lecture', repeat('a', 64), 'open',
  statement_timestamp() - interval '5 minutes',
  statement_timestamp() - interval '5 minutes',
  statement_timestamp() + interval '1 hour',
  statement_timestamp() + interval '1 hour'
);

insert into public.lecture_ai_control (lecture_session_id, hard_stop_at)
values (
  '73031000-0000-4000-8000-000000000001'::uuid,
  statement_timestamp() + interval '1 hour'
);

insert into public.admin_sessions (
  id, token_hash, auth_user_id, pin_version_hash, authentication_method, aal,
  issued_at, last_seen_at, idle_expires_at, expires_at
) values (
  '73031000-0000-4000-8000-000000000002'::uuid,
  repeat('b', 64), '73031000-0000-4000-8000-000000000003'::uuid,
  repeat('c', 64), 'legacy_pin', 1,
  statement_timestamp() - interval '5 minutes',
  statement_timestamp() - interval '5 minutes',
  statement_timestamp() + interval '30 minutes',
  statement_timestamp() + interval '8 hours'
);

insert into public.lecture_ai_master_authorizations (
  id, lecture_session_id, admin_session_id, actor_id, scope, actions, expires_at
) values (
  '73031000-0000-4000-8000-000000000004'::uuid,
  '73031000-0000-4000-8000-000000000001'::uuid,
  '73031000-0000-4000-8000-000000000002'::uuid,
  'admin-session:73031000-0000-4000-8000-000000000002',
  'all_except_captions',
  array[
    'academic_answers', 'material_analysis', 'poll_suggestions', 'summaries'
  ]::text[],
  statement_timestamp() + interval '1 hour'
);

insert into public.ai_billing_grants (
  id, lecture_session_id, master_authorization_id, actor_id, actions,
  nonce_hash, expires_at
) values (
  '73031000-0000-4000-8000-000000000005'::uuid,
  '73031000-0000-4000-8000-000000000001'::uuid,
  '73031000-0000-4000-8000-000000000004'::uuid,
  'admin-session:73031000-0000-4000-8000-000000000002',
  array['summaries']::text[], repeat('e', 64),
  statement_timestamp() + interval '10 minutes'
);
