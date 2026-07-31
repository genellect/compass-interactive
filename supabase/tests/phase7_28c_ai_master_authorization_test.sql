BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path = public, extensions;
SELECT no_plan();

SELECT has_table(
  'public', 'lecture_ai_master_authorizations',
  'lecture-scoped AI master authorization table exists'
);
SELECT has_table(
  'public', 'ai_master_authorization_events',
  'content-free master authorization audit table exists'
);
SELECT ok(
  (SELECT bool_and(relrowsecurity)
   FROM pg_class
   WHERE oid IN (
     'public.lecture_ai_master_authorizations'::regclass,
     'public.ai_master_authorization_events'::regclass
   )),
  'master authorization tables have RLS enabled'
);
SELECT ok(
  NOT has_table_privilege(
    'anon', 'public.lecture_ai_master_authorizations', 'SELECT'
  )
  AND NOT has_table_privilege(
    'authenticated', 'public.lecture_ai_master_authorizations', 'SELECT'
  )
  AND NOT has_table_privilege(
    'anon', 'public.ai_master_authorization_events', 'SELECT'
  )
  AND NOT has_table_privilege(
    'authenticated', 'public.ai_master_authorization_events', 'SELECT'
  ),
  'browser roles cannot inspect master authorization or audit state'
);
SELECT ok(
  NOT has_function_privilege(
    'authenticated',
    'public.admin_authorize_ai_master(uuid,uuid,text,text,boolean)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'authenticated',
    'public.admin_issue_ai_billing_grant_from_master(uuid,uuid,text[],text,text)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'authenticated',
    'public.admin_revoke_ai_master_authorization(uuid,uuid,text,text)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'authenticated',
    'public.service_drain_ai_master_authorizations(text)',
    'EXECUTE'
  ),
  'student clients cannot authorize, exchange, revoke, or drain paid AI access'
);
SELECT ok(
  NOT (SELECT prosecdef FROM pg_proc WHERE oid =
    'public.admin_authorize_ai_master(uuid,uuid,text,text,boolean)'::regprocedure)
  AND NOT (SELECT prosecdef FROM pg_proc WHERE oid =
    'public.admin_issue_ai_billing_grant_from_master(uuid,uuid,text[],text,text)'::regprocedure)
  AND NOT (SELECT prosecdef FROM pg_proc WHERE oid =
    'public.admin_revoke_ai_master_authorization(uuid,uuid,text,text)'::regprocedure)
  AND NOT (SELECT prosecdef FROM pg_proc WHERE oid =
    'public.service_drain_ai_master_authorizations(text)'::regprocedure),
  'public master authorization wrappers remain SECURITY INVOKER'
);
SELECT ok(
  (SELECT prosecdef AND proconfig @> ARRAY['search_path=""']
   FROM pg_proc WHERE oid =
    'private.authorize_ai_master(uuid,uuid,text,text,boolean)'::regprocedure)
  AND
  (SELECT prosecdef AND proconfig @> ARRAY['search_path=""']
   FROM pg_proc WHERE oid =
    'private.issue_ai_billing_grant_from_master(uuid,uuid,text[],text,text)'::regprocedure),
  'private master primitives are fixed-search-path definers'
);
SELECT ok(
  to_regclass('public.lecture_ai_master_authorizations_one_active_idx') IS NOT NULL
  AND to_regclass('public.lecture_ai_master_authorizations_admin_session_idx') IS NOT NULL
  AND to_regclass('public.ai_billing_grants_master_issued_idx') IS NOT NULL
  AND to_regclass('public.ai_master_authorization_events_child_grant_idx') IS NOT NULL,
  'lecture, session, pending-grant and audit FK access paths are indexed'
);
SELECT ok(
  NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename IN (
        'lecture_ai_master_authorizations',
        'ai_master_authorization_events'
      )
  ),
  'master authorization adds no student Realtime fanout'
);

CREATE TEMP TABLE p728c_fixture (
  auth_lecture_id uuid,
  work_lecture_id uuid,
  close_lecture_id uuid,
  session_lecture_id uuid,
  expiry_lecture_id uuid,
  hard_stop_lecture_id uuid,
  rollback_lecture_id uuid,
  owner_session_id uuid,
  second_session_id uuid,
  session_revoke_id uuid,
  master_id uuid,
  child_grant_id uuid,
  direct_grant_id uuid,
  other_run_id uuid,
  result jsonb
);
GRANT SELECT, INSERT, UPDATE ON p728c_fixture TO service_role;
INSERT INTO p728c_fixture (
  owner_session_id, second_session_id, session_revoke_id
) VALUES (
  '728c0000-0000-4000-8000-000000000101',
  '728c0000-0000-4000-8000-000000000102',
  '728c0000-0000-4000-8000-000000000103'
);

SET LOCAL ROLE service_role;

INSERT INTO public.admin_sessions (
  id, token_hash, auth_user_id, pin_version_hash,
  issued_at, last_seen_at, idle_expires_at, expires_at
) VALUES
  (
    '728c0000-0000-4000-8000-000000000101', repeat('1', 64),
    '728c0000-0000-4000-8000-000000000201', repeat('a', 64),
    statement_timestamp() - interval '1 minute',
    statement_timestamp() - interval '1 minute',
    statement_timestamp() + interval '2 hours',
    statement_timestamp() + interval '3 hours'
  ),
  (
    '728c0000-0000-4000-8000-000000000102', repeat('2', 64),
    '728c0000-0000-4000-8000-000000000202', repeat('b', 64),
    statement_timestamp() - interval '1 minute',
    statement_timestamp() - interval '1 minute',
    statement_timestamp() + interval '2 hours',
    statement_timestamp() + interval '3 hours'
  ),
  (
    '728c0000-0000-4000-8000-000000000103', repeat('3', 64),
    '728c0000-0000-4000-8000-000000000203', repeat('c', 64),
    statement_timestamp() - interval '1 minute',
    statement_timestamp() - interval '1 minute',
    statement_timestamp() + interval '2 hours',
    statement_timestamp() + interval '3 hours'
  );

UPDATE p728c_fixture SET
  auth_lecture_id = public.admin_create_lecture(
    'Phase 7.28C authorization only', repeat('4', 64), '728101', null, null
  ),
  work_lecture_id = public.admin_create_lecture(
    'Phase 7.28C atomic stop', repeat('5', 64), '728102', null, null
  ),
  close_lecture_id = public.admin_create_lecture(
    'Phase 7.28C lecture close', repeat('6', 64), '728103', null, null
  ),
  session_lecture_id = public.admin_create_lecture(
    'Phase 7.28C session revoke', repeat('7', 64), '728104', null, null
  ),
  expiry_lecture_id = public.admin_create_lecture(
    'Phase 7.28C authorization expiry', repeat('8', 64), '728105', null, null
  ),
  hard_stop_lecture_id = public.admin_create_lecture(
    'Phase 7.28C hard stop', repeat('9', 64), '728106', null, null
  ),
  rollback_lecture_id = public.admin_create_lecture(
    'Phase 7.28C rollback drain', repeat('0', 64), '728107', null, null
  );

SELECT ok(
  bool_and(public.admin_set_lecture_status(lecture_id, 'start', null)),
  'all master-authorization fixture lectures start'
)
FROM (
    SELECT auth_lecture_id AS lecture_id FROM p728c_fixture
    UNION ALL SELECT work_lecture_id FROM p728c_fixture
    UNION ALL SELECT close_lecture_id FROM p728c_fixture
    UNION ALL SELECT session_lecture_id FROM p728c_fixture
    UNION ALL SELECT expiry_lecture_id FROM p728c_fixture
    UNION ALL SELECT hard_stop_lecture_id FROM p728c_fixture
    UNION ALL SELECT rollback_lecture_id FROM p728c_fixture
  ) AS lectures;

SELECT lives_ok(
  format(
    'SELECT public.admin_configure_lecture_ai_control(%L::uuid, %L::jsonb, %L)',
    lecture_id,
    jsonb_build_object(
      'summaries_enabled', false,
      'academic_answers_enabled', false,
      'material_analysis_enabled', true,
      'summary_call_limit', 18,
      'academic_answer_limit', 3,
      'budget_limit_microusd', 2500000,
      'input_token_limit', 720000,
      'output_token_limit', 50000,
      'max_concurrent_operations', 2
    )::text,
    'admin-session:phase728c-setup'
  ),
  'AI control is configured for lecture ' || lecture_id
)
FROM (
  SELECT auth_lecture_id AS lecture_id FROM p728c_fixture
  UNION ALL SELECT work_lecture_id FROM p728c_fixture
  UNION ALL SELECT close_lecture_id FROM p728c_fixture
  UNION ALL SELECT session_lecture_id FROM p728c_fixture
  UNION ALL SELECT expiry_lecture_id FROM p728c_fixture
  UNION ALL SELECT hard_stop_lecture_id FROM p728c_fixture
  UNION ALL SELECT rollback_lecture_id FROM p728c_fixture
) AS lectures;

UPDATE p728c_fixture SET result = public.admin_authorize_ai_master(
  auth_lecture_id,
  owner_session_id,
  'admin-session:' || owner_session_id::text,
  'all_except_captions',
  true
);
SELECT is(
  (SELECT result ->> 'accepted' FROM p728c_fixture), 'true',
  'one PIN check authorizes lecture-scoped AI use'
);
SELECT is(
  (SELECT result #>> '{authorization,scope}' FROM p728c_fixture),
  'all_except_captions',
  'master scope excludes captions exactly as requested'
);
SELECT is(
  (SELECT count(*)::integer
   FROM public.ai_billing_grants AS billing_grant, p728c_fixture AS fixture
   WHERE billing_grant.lecture_session_id = fixture.auth_lecture_id),
  0,
  'master authorization alone creates no single-use grant or paid reservation'
);
SELECT is(
  (SELECT count(*)::integer
   FROM public.ai_usage_ledger AS usage, p728c_fixture AS fixture
   WHERE usage.lecture_session_id = fixture.auth_lecture_id),
  0,
  'master authorization alone starts no provider work'
);

UPDATE p728c_fixture SET result = public.admin_authorize_ai_master(
  auth_lecture_id,
  second_session_id,
  'admin-session:' || second_session_id::text,
  'all_including_captions',
  true
);
SELECT is(
  (SELECT result ->> 'reason' FROM p728c_fixture),
  'authorization_held_by_other_admin',
  'a second Admin cannot take over an active authorization'
);
SELECT throws_ok(
  $$SELECT public.admin_issue_ai_billing_grant(
    (SELECT auth_lecture_id FROM p728c_fixture),
    ARRAY['summaries'], repeat('2', 64), true,
    'admin-session:direct-bypass'
  )$$,
  'P0001',
  'lecture-wide AI authorization requires a child grant',
  'active master authorization blocks direct-PIN issuance for every actor'
);

UPDATE p728c_fixture SET result = public.admin_issue_ai_billing_grant_from_master(
  auth_lecture_id,
  owner_session_id,
  ARRAY['captions'],
  repeat('8', 64),
  'admin-session:' || owner_session_id::text
);
SELECT is(
  (SELECT result ->> 'reason' FROM p728c_fixture),
  'master_scope_mismatch',
  'captions remain unavailable in the excluding-captions scope'
);
SELECT is(
  (public.admin_revoke_ai_master_authorization(
    (SELECT auth_lecture_id FROM p728c_fixture),
    (SELECT owner_session_id FROM p728c_fixture),
    'admin-session:' || (SELECT owner_session_id::text FROM p728c_fixture),
    'test_cleanup'
  ) ->> 'accepted'),
  'true',
  'authorization-only fixture can be stopped without a PIN'
);

UPDATE p728c_fixture SET result = public.admin_authorize_ai_master(
  auth_lecture_id,
  owner_session_id,
  'admin-session:' || owner_session_id::text,
  'all_including_captions',
  true
);
UPDATE p728c_fixture SET result = public.admin_issue_ai_billing_grant_from_master(
  auth_lecture_id,
  owner_session_id,
  ARRAY['captions'],
  repeat('f', 64),
  'admin-session:' || owner_session_id::text
);
UPDATE p728c_fixture SET child_grant_id = (result ->> 'grant_id')::uuid;
UPDATE p728c_fixture SET result = public.admin_consume_realtime_billing_grant(
  child_grant_id,
  repeat('f', 64),
  auth_lecture_id,
  jsonb_build_array(jsonb_build_object(
    'feature', 'captions',
    'idempotency_key', 'phase728c-caption-scope-change',
    'estimated_microusd', 17000,
    'estimated_audio_seconds', 60,
    'estimated_input_tokens', 0,
    'estimated_output_tokens', 0,
    'model_id', 'gpt-realtime-whisper',
    'pricing_unit', 'audio_minute',
    'pricing_rate_microusd', 17000
  )),
  'admin-session:' || owner_session_id::text
);
SELECT is(
  (SELECT result ->> 'accepted' FROM p728c_fixture), 'true',
  'caption work can start only after explicit child-grant consumption'
);
UPDATE p728c_fixture SET result = public.admin_authorize_ai_master(
  auth_lecture_id,
  owner_session_id,
  'admin-session:' || owner_session_id::text,
  'all_except_captions',
  true
);
SELECT is(
  (SELECT count(*)::integer
   FROM public.ai_usage_ledger AS usage, p728c_fixture AS fixture
   WHERE usage.lecture_session_id = fixture.auth_lecture_id
     AND usage.feature = 'captions'
     AND usage.status = 'running'),
  0,
  'removing captions from master scope stops active caption billing work'
);
SELECT is(
  (SELECT captions_enabled::text
   FROM public.lecture_ai_control AS control, p728c_fixture AS fixture
   WHERE control.lecture_session_id = fixture.auth_lecture_id),
  'false',
  'caption scope downgrade disables the caption lane'
);
SELECT is(
  (public.admin_revoke_ai_master_authorization(
    (SELECT auth_lecture_id FROM p728c_fixture),
    (SELECT owner_session_id FROM p728c_fixture),
    'admin-session:' || (SELECT owner_session_id::text FROM p728c_fixture),
    'test_scope_cleanup'
  ) ->> 'accepted'),
  'true',
  'scope-change fixture is stopped cleanly'
);

-- A summary started by another valid actor is deliberately used to prove that
-- stop semantics are lecture-scoped and cannot be rolled back by actor mismatch.
UPDATE p728c_fixture SET result = public.admin_issue_ai_billing_grant(
  work_lecture_id,
  ARRAY['summaries'],
  repeat('9', 64),
  true,
  'admin-session:other-running-actor'
);
UPDATE p728c_fixture SET child_grant_id = (result ->> 'grant_id')::uuid;
SELECT ok(
  (SELECT master_authorization_id IS NULL
   FROM public.ai_billing_grants AS billing_grant, p728c_fixture AS fixture
   WHERE billing_grant.id = fixture.child_grant_id),
  'legacy direct-PIN grants retain a null master authorization binding'
);
UPDATE p728c_fixture SET result = public.admin_start_lecture_summary_run_v2(
  child_grant_id,
  repeat('9', 64),
  work_lecture_id,
  repeat('a', 64),
  'admin-session:other-running-actor',
  false,
  'auto'
);
UPDATE p728c_fixture SET other_run_id = (result #>> '{run,id}')::uuid;
SELECT is(
  (SELECT result ->> 'accepted' FROM p728c_fixture), 'true',
  'legacy direct-PIN RPC still consumes a null-master grant after upgrade'
);
UPDATE p728c_fixture SET result = public.admin_issue_ai_billing_grant(
  work_lecture_id,
  ARRAY['summaries'],
  repeat('0', 64),
  true,
  'admin-session:legacy-pending-actor'
);
UPDATE p728c_fixture SET direct_grant_id = (result ->> 'grant_id')::uuid;

UPDATE p728c_fixture SET result = public.admin_authorize_ai_master(
  work_lecture_id,
  owner_session_id,
  'admin-session:' || owner_session_id::text,
  'all_including_captions',
  true
);
UPDATE p728c_fixture SET master_id = (result #>> '{authorization,id}')::uuid;
UPDATE p728c_fixture SET result = public.admin_issue_ai_billing_grant_from_master(
  work_lecture_id,
  owner_session_id,
  ARRAY['summaries'],
  repeat('b', 64),
  'admin-session:' || owner_session_id::text
);
UPDATE p728c_fixture SET child_grant_id = (result ->> 'grant_id')::uuid;
SELECT is(
  (SELECT status FROM public.ai_billing_grants AS billing_grant,
     p728c_fixture AS fixture
   WHERE billing_grant.id = fixture.child_grant_id),
  'issued',
  'master exchange creates a short-lived pending child grant'
);
UPDATE p728c_fixture SET result = public.admin_revoke_ai_master_authorization(
  work_lecture_id,
  owner_session_id,
  'admin-session:' || owner_session_id::text,
  'admin_manual_revoke'
);
SELECT is(
  (SELECT result ->> 'accepted' FROM p728c_fixture), 'true',
  'master stop response succeeds atomically'
);
SELECT ok(
  (SELECT status = 'revoked' AND revoked_at IS NOT NULL
   FROM public.ai_billing_grants AS billing_grant, p728c_fixture AS fixture
   WHERE billing_grant.id = fixture.child_grant_id),
  'pending child grant is revoked with the required revoked_at timestamp'
);
SELECT ok(
  (SELECT status = 'revoked' AND revoked_at IS NOT NULL
   FROM public.ai_billing_grants AS billing_grant, p728c_fixture AS fixture
   WHERE billing_grant.id = fixture.direct_grant_id),
  'lecture-wide stop also revokes a pending legacy/direct-PIN grant'
);
SELECT is(
  (SELECT status FROM public.lecture_summary_runs AS summary_run,
     p728c_fixture AS fixture
   WHERE summary_run.id = fixture.other_run_id),
  'stopped',
  'master stop closes a running summary even when it belongs to another actor'
);
SELECT is(
  (SELECT count(*)::integer
   FROM public.lecture_summary_runs AS summary_run, p728c_fixture AS fixture
   WHERE summary_run.lecture_session_id = fixture.work_lecture_id
     AND summary_run.status = 'running'),
  0,
  'no summary work remains running when master stop returns'
);
SELECT is(
  (SELECT count(*)::integer
   FROM public.ai_usage_ledger AS usage, p728c_fixture AS fixture
   WHERE usage.lecture_session_id = fixture.work_lecture_id
     AND usage.status = 'running'),
  0,
  'no paid ledger work remains running when master stop returns'
);
UPDATE p728c_fixture SET result = public.admin_start_lecture_summary_run_v2(
  child_grant_id,
  repeat('b', 64),
  work_lecture_id,
  repeat('c', 64),
  'admin-session:' || owner_session_id::text,
  false,
  'auto'
);
SELECT is(
  (SELECT result ->> 'reason' FROM p728c_fixture),
  'grant_not_available',
  'a revoked pending grant cannot create new work after stop returns'
);
UPDATE p728c_fixture SET result = public.admin_start_lecture_summary_run_v2(
  direct_grant_id,
  repeat('0', 64),
  work_lecture_id,
  repeat('1', 64),
  'admin-session:legacy-pending-actor',
  false,
  'auto'
);
SELECT is(
  (SELECT result ->> 'reason' FROM p728c_fixture),
  'grant_not_available',
  'a pre-stop direct-PIN grant cannot restart AI work after master stop'
);

UPDATE p728c_fixture SET result = public.admin_authorize_ai_master(
  close_lecture_id,
  owner_session_id,
  'admin-session:' || owner_session_id::text,
  'all_including_captions',
  true
);
UPDATE p728c_fixture SET result = public.admin_issue_ai_billing_grant_from_master(
  close_lecture_id,
  owner_session_id,
  ARRAY['captions'],
  repeat('d', 64),
  'admin-session:' || owner_session_id::text
);
UPDATE p728c_fixture SET child_grant_id = (result ->> 'grant_id')::uuid;
SELECT ok(
  public.admin_set_lecture_status(
    (SELECT close_lecture_id FROM p728c_fixture), 'close', null
  ),
  'lecture close succeeds while a child grant is pending'
);
SELECT ok(
  (SELECT status = 'revoked' AND revoked_at IS NOT NULL
   FROM public.ai_billing_grants AS billing_grant, p728c_fixture AS fixture
   WHERE billing_grant.id = fixture.child_grant_id),
  'lecture close revokes its pending child grant without violating CHECKs'
);
SELECT is(
  (SELECT status FROM public.lecture_ai_master_authorizations AS master_auth,
     p728c_fixture AS fixture
   WHERE master_auth.lecture_session_id = fixture.close_lecture_id
   ORDER BY master_auth.issued_at DESC LIMIT 1),
  'lecture_closed',
  'lecture lifecycle closes its master authorization'
);
SELECT is(
  (SELECT revoked_by_actor_id
   FROM public.lecture_ai_master_authorizations AS master_auth,
     p728c_fixture AS fixture
   WHERE master_auth.lecture_session_id = fixture.close_lecture_id
   ORDER BY master_auth.issued_at DESC LIMIT 1),
  'admin-session',
  'lecture lifecycle preserves the precise close actor in the master audit'
);

UPDATE p728c_fixture SET result = public.admin_authorize_ai_master(
  session_lecture_id,
  session_revoke_id,
  'admin-session:' || session_revoke_id::text,
  'all_including_captions',
  true
);
UPDATE p728c_fixture SET result = public.admin_issue_ai_billing_grant_from_master(
  session_lecture_id,
  session_revoke_id,
  ARRAY['material_analysis'],
  repeat('e', 64),
  'admin-session:' || session_revoke_id::text
);
UPDATE p728c_fixture SET child_grant_id = (result ->> 'grant_id')::uuid;
UPDATE public.admin_sessions
SET revoked_at = statement_timestamp(),
    revoke_reason = 'admin_manual_revoke',
    updated_at = statement_timestamp()
WHERE id = (SELECT session_revoke_id FROM p728c_fixture);
SELECT ok(
  (SELECT status = 'revoked' AND revoked_at IS NOT NULL
   FROM public.ai_billing_grants AS billing_grant, p728c_fixture AS fixture
   WHERE billing_grant.id = fixture.child_grant_id),
  'Admin-session revocation atomically revokes its pending child grant'
);
SELECT is(
  (SELECT status FROM public.lecture_ai_master_authorizations AS master_auth,
     p728c_fixture AS fixture
   WHERE master_auth.lecture_session_id = fixture.session_lecture_id
   ORDER BY master_auth.issued_at DESC LIMIT 1),
  'expired',
  'Admin-session revocation expires its master authorization'
);
SELECT is(
  (SELECT count(*)::integer
   FROM public.ai_usage_ledger AS usage, p728c_fixture AS fixture
   WHERE usage.lecture_session_id = fixture.session_lecture_id
     AND usage.status = 'running'),
  0,
  'Admin-session revocation leaves no paid work running'
);

UPDATE p728c_fixture SET result = public.admin_authorize_ai_master(
  expiry_lecture_id,
  owner_session_id,
  'admin-session:' || owner_session_id::text,
  'all_except_captions',
  true
);
UPDATE p728c_fixture SET result = public.admin_issue_ai_billing_grant_from_master(
  expiry_lecture_id,
  owner_session_id,
  ARRAY['summaries'],
  repeat('ab', 32),
  'admin-session:' || owner_session_id::text
);
UPDATE p728c_fixture SET child_grant_id = (result ->> 'grant_id')::uuid;
RESET ROLE;
UPDATE public.lecture_ai_master_authorizations AS master_auth
SET issued_at = statement_timestamp() - interval '2 minutes',
    expires_at = statement_timestamp() - interval '1 minute',
    updated_at = statement_timestamp()
FROM p728c_fixture AS fixture
WHERE master_auth.lecture_session_id = fixture.expiry_lecture_id
  AND master_auth.status = 'active';
SET LOCAL ROLE service_role;
UPDATE p728c_fixture SET result = public.admin_get_ai_master_authorization_status(
  expiry_lecture_id,
  owner_session_id,
  'admin-session:' || owner_session_id::text
);
SELECT is(
  (SELECT status FROM public.lecture_ai_master_authorizations AS master_auth,
     p728c_fixture AS fixture
   WHERE master_auth.lecture_session_id = fixture.expiry_lecture_id
   ORDER BY master_auth.issued_at DESC LIMIT 1),
  'expired',
  'server-side status read terminalizes a master authorization past its expiry'
);
SELECT ok(
  (SELECT status = 'revoked' AND revoked_at IS NOT NULL
   FROM public.ai_billing_grants AS billing_grant, p728c_fixture AS fixture
   WHERE billing_grant.id = fixture.child_grant_id),
  'master expiry revokes an already-issued child grant'
);
UPDATE p728c_fixture SET result = public.admin_issue_ai_billing_grant_from_master(
  expiry_lecture_id,
  owner_session_id,
  ARRAY['summaries'],
  repeat('ac', 32),
  'admin-session:' || owner_session_id::text
);
SELECT is(
  (SELECT result ->> 'reason' FROM p728c_fixture),
  'master_not_active',
  'an expired master cannot issue another paid child grant'
);

UPDATE p728c_fixture SET result = public.admin_authorize_ai_master(
  hard_stop_lecture_id,
  owner_session_id,
  'admin-session:' || owner_session_id::text,
  'all_including_captions',
  true
);
UPDATE p728c_fixture SET result = public.admin_issue_ai_billing_grant_from_master(
  hard_stop_lecture_id,
  owner_session_id,
  ARRAY['captions'],
  repeat('cd', 32),
  'admin-session:' || owner_session_id::text
);
UPDATE p728c_fixture SET child_grant_id = (result ->> 'grant_id')::uuid;
RESET ROLE;
UPDATE public.lecture_sessions AS lecture
SET started_at = statement_timestamp() - interval '91 minutes',
    starts_at = statement_timestamp() - interval '91 minutes',
    hard_stop_at = statement_timestamp() - interval '1 minute',
    ends_at = statement_timestamp() - interval '1 minute'
FROM p728c_fixture AS fixture
WHERE lecture.id = fixture.hard_stop_lecture_id;
SET LOCAL ROLE service_role;
UPDATE p728c_fixture SET result = public.admin_get_ai_master_authorization_status(
  hard_stop_lecture_id,
  owner_session_id,
  'admin-session:' || owner_session_id::text
);
SELECT is(
  (SELECT status FROM public.lecture_sessions AS lecture, p728c_fixture AS fixture
   WHERE lecture.id = fixture.hard_stop_lecture_id),
  'closed',
  'server-side status read closes an open lecture at its hard-stop boundary'
);
SELECT is(
  (SELECT status FROM public.lecture_ai_master_authorizations AS master_auth,
     p728c_fixture AS fixture
   WHERE master_auth.lecture_session_id = fixture.hard_stop_lecture_id
   ORDER BY master_auth.issued_at DESC LIMIT 1),
  'lecture_closed',
  'hard-stop lifecycle terminalizes the lecture master authorization'
);
SELECT ok(
  (SELECT status = 'revoked' AND revoked_at IS NOT NULL
   FROM public.ai_billing_grants AS billing_grant, p728c_fixture AS fixture
   WHERE billing_grant.id = fixture.child_grant_id),
  'hard-stop lifecycle revokes an already-issued child grant'
);
SELECT is(
  (SELECT count(*)::integer
   FROM public.ai_usage_ledger AS usage, p728c_fixture AS fixture
   WHERE usage.lecture_session_id = fixture.hard_stop_lecture_id
     AND usage.status = 'running'),
  0,
  'hard-stop convergence leaves no paid work running'
);

UPDATE p728c_fixture SET result = public.admin_authorize_ai_master(
  rollback_lecture_id,
  owner_session_id,
  'admin-session:' || owner_session_id::text,
  'all_including_captions',
  true
);
UPDATE p728c_fixture SET result = public.admin_issue_ai_billing_grant_from_master(
  rollback_lecture_id,
  owner_session_id,
  ARRAY['summaries'],
  repeat('ef', 32),
  'admin-session:' || owner_session_id::text
);
UPDATE p728c_fixture SET child_grant_id = (result ->> 'grant_id')::uuid;
UPDATE p728c_fixture SET result = public.service_drain_ai_master_authorizations(
  'phase7_28_test_rollback'
);
SELECT is(
  (SELECT result ->> 'remaining_active_count' FROM p728c_fixture),
  '0',
  'service-only rollback drain converges every active master to a terminal state'
);
SELECT ok(
  (SELECT status = 'revoked' AND revoked_at IS NOT NULL
   FROM public.ai_billing_grants AS billing_grant, p728c_fixture AS fixture
   WHERE billing_grant.id = fixture.child_grant_id),
  'rollback drain revokes pending child grants before flags can be disabled'
);
UPDATE p728c_fixture SET result = public.service_drain_ai_master_authorizations(
  'phase7_28_test_rollback_retry'
);
SELECT is(
  (SELECT result ->> 'drained_count' FROM p728c_fixture),
  '0',
  'service-only rollback drain is idempotent on retry'
);

SELECT * FROM finish();
ROLLBACK;
