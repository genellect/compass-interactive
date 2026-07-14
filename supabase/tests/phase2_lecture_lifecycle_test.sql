BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path = public, extensions;
SELECT no_plan();

-- Schema, privilege, and RLS contract.
SELECT has_column('public', 'lecture_sessions', 'started_at', 'started_at exists');
SELECT has_column('public', 'lecture_sessions', 'hard_stop_at', 'hard_stop_at exists');
SELECT has_column('public', 'lecture_sessions', 'closed_at', 'closed_at exists');
SELECT has_column('public', 'lecture_sessions', 'close_reason', 'close reason exists');
SELECT has_column('public', 'lecture_sessions', 'close_actor_type', 'close actor type exists');
SELECT has_column('public', 'lecture_sessions', 'archive_expires_at', 'archive expiry exists');
SELECT has_table('public', 'lecture_lifecycle_events', 'lifecycle event table exists');
SELECT has_table('public', 'lecture_archive_state', 'archive state table exists');
SELECT has_table('public', 'lecture_ai_control', 'AI control table exists');
SELECT has_table('public', 'ai_usage_ledger', 'AI usage ledger exists');
SELECT ok(
  (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.lecture_lifecycle_events'::regclass),
  'lifecycle events have RLS enabled'
);
SELECT ok(
  (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.lecture_archive_state'::regclass),
  'archive state has RLS enabled'
);
SELECT ok(
  (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.lecture_ai_control'::regclass),
  'AI control has RLS enabled'
);
SELECT ok(
  (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.ai_usage_ledger'::regclass),
  'AI ledger has RLS enabled'
);
SELECT ok(
  to_regprocedure('public.get_lecture_terminal_state_v2(uuid)') IS NOT NULL,
  'terminal-state RPC exists'
);
SELECT ok(
  to_regprocedure('public.get_lecture_archive_v2(uuid)') IS NOT NULL,
  'archive RPC exists'
);
SELECT ok(
  to_regprocedure('public.admin_start_lecture_ai_operation(uuid,text,text,bigint,integer,bigint,bigint,text)') IS NOT NULL,
  'AI admission RPC exists'
);
SELECT ok(
  NOT (SELECT prosecdef FROM pg_proc WHERE oid = 'public.get_lecture_archive_v2(uuid)'::regprocedure),
  'public archive RPC is security invoker'
);
SELECT ok(
  NOT (SELECT prosecdef FROM pg_proc WHERE oid = 'public.admin_start_lecture_ai_operation(uuid,text,text,bigint,integer,bigint,bigint,text)'::regprocedure),
  'public AI admission RPC is security invoker'
);
SELECT ok(
  (SELECT prosecdef FROM pg_proc WHERE oid = 'private.close_lecture_core(uuid,text,text,text)'::regprocedure),
  'internal close primitive is security definer'
);
SELECT ok(
  NOT has_function_privilege(
    'authenticated',
    'public.admin_start_lecture_ai_operation(uuid,text,text,bigint,integer,bigint,bigint,text)',
    'EXECUTE'
  ),
  'authenticated clients cannot start AI operations'
);
SELECT ok(
  has_function_privilege(
    'service_role',
    'public.admin_start_lecture_ai_operation(uuid,text,text,bigint,integer,bigint,bigint,text)',
    'EXECUTE'
  ),
  'service role can call AI admission RPC'
);
SELECT ok(
  has_function_privilege(
    'authenticated',
    'public.get_lecture_archive_v2(uuid)',
    'EXECUTE'
  ),
  'authenticated clients can call membership-scoped archive RPC'
);
SELECT ok(
  NOT has_table_privilege('authenticated', 'public.lecture_ai_control', 'SELECT'),
  'authenticated clients cannot select AI control rows'
);
SELECT ok(
  NOT has_table_privilege('authenticated', 'public.ai_usage_ledger', 'SELECT'),
  'authenticated clients cannot select AI usage rows'
);
SELECT ok(
  to_regclass('public.lecture_sessions_open_hard_stop_idx') IS NOT NULL,
  'open hard-stop lookup is indexed'
);
SELECT ok(
  to_regclass('public.lecture_archive_state_due_idx') IS NOT NULL,
  'archive eligibility lookup is indexed'
);

CREATE TEMP TABLE p2_fixture (
  main_lecture_id uuid,
  auto_lecture_id uuid,
  worker_lecture_id uuid,
  retry_lecture_id uuid,
  unrelated_lecture_id uuid,
  participant_a uuid,
  participant_b uuid,
  auto_participant uuid,
  comment_id uuid,
  poll_id uuid,
  option_id uuid,
  ai_operation_id uuid,
  expiry_ai_operation_id uuid,
  start_before timestamptz,
  start_after timestamptz
);
GRANT SELECT, INSERT, UPDATE ON p2_fixture TO service_role, authenticated;
INSERT INTO p2_fixture DEFAULT VALUES;

SET LOCAL ROLE service_role;
UPDATE p2_fixture SET start_before = statement_timestamp();
UPDATE p2_fixture
SET main_lecture_id = public.admin_create_lecture(
  'Phase 2 main lecture',
  encode(extensions.digest(convert_to('P2-MAIN', 'UTF8'), 'sha256'), 'hex'),
  'P2-MAIN',
  null,
  null
);
SELECT ok(
  public.admin_set_lecture_status(
    (SELECT main_lecture_id FROM p2_fixture),
    'start',
    '2099-01-01 00:00:00+00'
  ),
  'lecture start succeeds even when old caller supplies a fake future clock'
);
UPDATE p2_fixture SET start_after = statement_timestamp();
SELECT ok(
  (SELECT started_at >= start_before AND started_at <= start_after
   FROM public.lecture_sessions, p2_fixture
   WHERE id = main_lecture_id),
  'canonical start time comes from the database clock'
);
SELECT is(
  (SELECT hard_stop_at - started_at
   FROM public.lecture_sessions, p2_fixture
   WHERE id = main_lecture_id),
  interval '90 minutes',
  'new lecture hard stop is exactly 90 minutes after canonical start'
);
SELECT is(
  (SELECT ends_at FROM public.lecture_sessions, p2_fixture WHERE id = main_lecture_id),
  (SELECT hard_stop_at FROM public.lecture_sessions, p2_fixture WHERE id = main_lecture_id),
  'legacy ends_at projects the hard stop for old clients'
);
SELECT isnt(
  (SELECT started_at FROM public.lecture_sessions, p2_fixture WHERE id = main_lecture_id),
  '2099-01-01 00:00:00+00'::timestamptz,
  'caller clock cannot move canonical start time'
);

RESET ROLE;
SELECT ok(
  private.is_lecture_open_at(
    (SELECT main_lecture_id FROM p2_fixture),
    (SELECT hard_stop_at - interval '1 microsecond'
     FROM public.lecture_sessions, p2_fixture WHERE id = main_lecture_id)
  ),
  'lecture remains active immediately before 90-minute boundary'
);
SELECT ok(
  NOT private.is_lecture_open_at(
    (SELECT main_lecture_id FROM p2_fixture),
    (SELECT hard_stop_at
     FROM public.lecture_sessions, p2_fixture WHERE id = main_lecture_id)
  ),
  'lecture is inactive at the exact hard-stop boundary'
);
SELECT ok(
  NOT private.is_lecture_open_at(
    (SELECT main_lecture_id FROM p2_fixture),
    (SELECT hard_stop_at + interval '1 microsecond'
     FROM public.lecture_sessions, p2_fixture WHERE id = main_lecture_id)
  ),
  'lecture is inactive after the hard-stop boundary'
);

-- Two authenticated users join; ownership remains bound to auth.uid().
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '51000000-0000-4000-8000-000000000001', true);
UPDATE p2_fixture
SET participant_a = (
  SELECT participant_id FROM public.join_lecture_by_code('P2-MAIN')
);
SELECT ok((SELECT participant_a IS NOT NULL FROM p2_fixture), 'student A joins');

SELECT set_config('request.jwt.claim.sub', '51000000-0000-4000-8000-000000000002', true);
UPDATE p2_fixture
SET participant_b = (
  SELECT participant_id FROM public.join_lecture_by_code('P2-MAIN')
);
SELECT ok((SELECT participant_b IS NOT NULL FROM p2_fixture), 'student B joins');
SELECT throws_ok(
  $$
    INSERT INTO public.comments (lecture_session_id, participant_id, body)
    SELECT main_lecture_id, participant_a, 'B impersonates A'
    FROM p2_fixture
  $$,
  '42501',
  null,
  'student B cannot write with student A participant ownership'
);

SELECT set_config('request.jwt.claim.sub', '51000000-0000-4000-8000-000000000001', true);
SELECT lives_ok(
  $$
    INSERT INTO public.comments (lecture_session_id, participant_id, body)
    SELECT main_lecture_id, participant_a, 'Valid Phase 2 comment'
    FROM p2_fixture
  $$,
  'owned comment succeeds before hard stop'
);
UPDATE p2_fixture
SET comment_id = (
  SELECT comment.id
  FROM public.comments AS comment
  WHERE comment.lecture_session_id = p2_fixture.main_lecture_id
  ORDER BY comment.created_at DESC
  LIMIT 1
);

-- Poll and AI admission are both server-gated.
SET LOCAL ROLE service_role;
UPDATE p2_fixture
SET poll_id = public.admin_create_poll(
  main_lecture_id,
  'Phase 2 poll?',
  'single',
  ARRAY['Yes', 'No']
);
SELECT ok(
  public.admin_set_poll_status(
    (SELECT main_lecture_id FROM p2_fixture),
    (SELECT poll_id FROM p2_fixture),
    'open'
  ),
  'poll opens while lecture is effectively active'
);
UPDATE p2_fixture
SET option_id = (
  SELECT option.id
  FROM public.poll_options AS option
  WHERE option.poll_id = p2_fixture.poll_id
  ORDER BY option.display_order
  LIMIT 1
);

SELECT lives_ok(
  $$
    SELECT public.admin_configure_lecture_ai_control(
      (SELECT main_lecture_id FROM p2_fixture),
      '{
        "summaries_enabled": true,
        "academic_answers_enabled": true,
        "budget_limit_microusd": 100,
        "summary_call_limit": 1,
        "academic_answer_limit": 2,
        "max_concurrent_operations": 1
      }'::jsonb,
      'phase2-test-admin'
    )
  $$,
  'Admin explicitly configures AI limits without invoking an external API'
);
UPDATE p2_fixture
SET ai_operation_id = (
  public.admin_start_lecture_ai_operation(
    main_lecture_id,
    'summaries',
    'phase2-summary-operation-0001',
    60,
    0,
    100,
    50,
    'phase2-test-admin'
  ) #>> '{operation,id}'
)::uuid;
SELECT ok((SELECT ai_operation_id IS NOT NULL FROM p2_fixture), 'AI operation is admitted within limits');
SELECT is(
  (
    public.admin_start_lecture_ai_operation(
      (SELECT main_lecture_id FROM p2_fixture),
      'summaries',
      'phase2-summary-operation-0001',
      60, 0, 100, 50,
      'phase2-test-admin'
    ) #>> '{idempotent_replay}'
  )::boolean,
  true,
  'AI start retry replays the same idempotent operation'
);
SELECT is(
  (SELECT used_microusd FROM public.lecture_ai_control, p2_fixture
   WHERE lecture_session_id = main_lecture_id),
  60::bigint,
  'idempotent AI retry does not double reserve usage'
);
SELECT is(
  public.admin_start_lecture_ai_operation(
    (SELECT main_lecture_id FROM p2_fixture),
    'academic_answers',
    'phase2-academic-operation-concurrent',
    10, 0, 10, 10,
    'phase2-test-admin'
  ) #>> '{reason}',
  'concurrency_limit',
  'concurrent AI operation is rejected at the configured limit'
);
SELECT is(
  public.admin_finish_lecture_ai_operation(
    (SELECT ai_operation_id FROM p2_fixture),
    'succeeded',
    60, 0, 90, 40,
    'provider-request-redacted',
    null
  ) #>> '{accepted}',
  'true',
  'AI result is accepted while lecture remains active'
);
SELECT is(
  public.admin_start_lecture_ai_operation(
    (SELECT main_lecture_id FROM p2_fixture),
    'summaries',
    'phase2-summary-operation-0002',
    10, 0, 10, 10,
    'phase2-test-admin'
  ) #>> '{reason}',
  'summary_call_limit',
  'summary call limit prevents a second summary operation'
);
SELECT is(
  public.admin_start_lecture_ai_operation(
    (SELECT main_lecture_id FROM p2_fixture),
    'academic_answers',
    'phase2-academic-operation-budget',
    50, 0, 10, 10,
    'phase2-test-admin'
  ) #>> '{reason}',
  'budget_limit',
  'budget reservation prevents an over-limit AI operation'
);
SELECT is(
  public.admin_start_lecture_ai_operation(
    (SELECT main_lecture_id FROM p2_fixture),
    'captions',
    'phase2-caption-operation-disabled',
    1, 1, 0, 0,
    'phase2-test-admin'
  ) #>> '{reason}',
  'feature_disabled',
  'disabled AI feature cannot start'
);

-- Start one operation and close the lecture while it is running.
SELECT lives_ok(
  $$
    SELECT public.admin_configure_lecture_ai_control(
      (SELECT main_lecture_id FROM p2_fixture),
      '{"budget_limit_microusd": 1000}'::jsonb,
      'phase2-test-admin'
    )
  $$,
  'AI budget can be expanded explicitly before another admission'
);
UPDATE p2_fixture
SET ai_operation_id = (
  public.admin_start_lecture_ai_operation(
    main_lecture_id,
    'academic_answers',
    'phase2-academic-operation-running',
    20, 0, 20, 20,
    'phase2-test-admin'
  ) #>> '{operation,id}'
)::uuid;
SELECT ok((SELECT ai_operation_id IS NOT NULL FROM p2_fixture), 'second AI operation is running before close');
SELECT ok(
  public.admin_set_lecture_status(
    (SELECT main_lecture_id FROM p2_fixture),
    'close',
    '2099-01-01 00:00:00+00'
  ),
  'manual close succeeds through the unified terminal transition'
);
SELECT ok(
  public.admin_set_lecture_status(
    (SELECT main_lecture_id FROM p2_fixture),
    'close',
    '1999-01-01 00:00:00+00'
  ),
  'manual close retry is an idempotent success'
);
SELECT is(
  (SELECT close_reason FROM public.lecture_sessions, p2_fixture WHERE id = main_lecture_id),
  'manual',
  'first terminal reason is preserved'
);
SELECT is(
  (SELECT close_actor_type FROM public.lecture_sessions, p2_fixture WHERE id = main_lecture_id),
  'admin',
  'terminal actor type is auditable'
);
SELECT is(
  (SELECT archive_expires_at - closed_at FROM public.lecture_sessions, p2_fixture WHERE id = main_lecture_id),
  interval '30 days',
  'archive retention starts from canonical close time'
);
SELECT is(
  (SELECT count(*) FROM public.lecture_lifecycle_events, p2_fixture
   WHERE lecture_session_id = main_lecture_id AND event_type = 'lecture_closed'),
  1::bigint,
  'manual close retry does not duplicate terminal audit event'
);
SELECT is(
  (SELECT status FROM public.polls, p2_fixture WHERE id = poll_id),
  'closed',
  'unified close terminates open polls'
);
SELECT is(
  (SELECT status FROM public.lecture_ai_control, p2_fixture
   WHERE lecture_session_id = main_lecture_id),
  'stopped',
  'unified close stops AI control'
);
SELECT is(
  (SELECT status FROM public.ai_usage_ledger, p2_fixture WHERE id = ai_operation_id),
  'cancelled',
  'running AI operation is cancelled when lecture closes'
);
SELECT is(
  public.admin_finish_lecture_ai_operation(
    (SELECT ai_operation_id FROM p2_fixture),
    'succeeded',
    20, 0, 20, 20,
    'late-provider-request',
    null
  ) #>> '{accepted}',
  'false',
  'late AI completion cannot publish a result after lecture close'
);
SELECT throws_ok(
  $$
    SELECT public.admin_start_lecture_ai_operation(
      (SELECT main_lecture_id FROM p2_fixture),
      'academic_answers',
      'phase2-academic-after-close',
      1, 0, 1, 1,
      'phase2-test-admin'
    )
  $$,
  'P0001',
  'lecture is not open',
  'closed lecture rejects AI admission server-side'
);
SELECT is(
  (SELECT count(*) FROM public.admin_update_pdf_display(
    (SELECT main_lecture_id FROM p2_fixture), 'phase2-doc', 1, 'normal'
  )),
  0::bigint,
  'closed lecture rejects live PDF/snapshot updates'
);
SELECT ok(
  NOT public.admin_set_poll_status(
    (SELECT main_lecture_id FROM p2_fixture),
    (SELECT poll_id FROM p2_fixture),
    'open'
  ),
  'closed lecture rejects reopening a poll'
);

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '51000000-0000-4000-8000-000000000001', true);
SELECT throws_ok(
  $$
    INSERT INTO public.comments (lecture_session_id, participant_id, body)
    SELECT main_lecture_id, participant_a, 'Comment after close' FROM p2_fixture
  $$,
  '42501',
  null,
  'closed lecture rejects comments through RLS'
);
SELECT throws_ok(
  $$
    INSERT INTO public.comment_likes (lecture_session_id, comment_id, participant_id)
    SELECT main_lecture_id, comment_id, participant_a FROM p2_fixture
  $$,
  '42501',
  null,
  'closed lecture rejects likes through RLS'
);
SELECT throws_ok(
  $$
    INSERT INTO public.poll_responses (
      lecture_session_id, poll_id, participant_id, option_ids
    )
    SELECT main_lecture_id, poll_id, participant_a, ARRAY[option_id]
    FROM p2_fixture
  $$,
  '42501',
  null,
  'closed lecture rejects poll responses through RLS'
);
SELECT ok(
  public.get_lecture_archive_v2((SELECT main_lecture_id FROM p2_fixture)) IS NOT NULL,
  'member can fetch one-shot archive before 30 days'
);
SELECT ok(
  NOT (
    public.get_lecture_archive_v2((SELECT main_lecture_id FROM p2_fixture))
      #> '{comments,0}'
  ) ? 'participant_id',
  'archive comment payload excludes participant identity'
);
SELECT set_config('request.jwt.claim.sub', '51000000-0000-4000-8000-000000000003', true);
SELECT is(
  public.get_lecture_archive_v2((SELECT main_lecture_id FROM p2_fixture)),
  null::jsonb,
  'non-member cannot fetch another lecture archive'
);
SELECT ok(
  NOT has_function_privilege(
    'authenticated',
    'public.admin_set_lecture_status(uuid,text,timestamptz)',
    'EXECUTE'
  ),
  'student cannot close an unrelated lecture'
);

-- Expired stored-open rows reject writes even before maintenance runs.
SET LOCAL ROLE service_role;
UPDATE p2_fixture
SET auto_lecture_id = public.admin_create_lecture(
  'Phase 2 deadline guard lecture',
  encode(extensions.digest(convert_to('P2-AUTO', 'UTF8'), 'sha256'), 'hex'),
  'P2-AUTO', null, null
);
SELECT ok(
  public.admin_set_lecture_status((SELECT auto_lecture_id FROM p2_fixture), 'start', now()),
  'deadline-guard fixture starts'
);
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '51000000-0000-4000-8000-000000000004', true);
UPDATE p2_fixture
SET auto_participant = (
  SELECT participant_id FROM public.join_lecture_by_code('P2-AUTO')
);
RESET ROLE;
UPDATE public.lecture_sessions AS lecture
SET hard_stop_at = lecture.started_at
FROM p2_fixture
WHERE lecture.id = p2_fixture.auto_lecture_id;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '51000000-0000-4000-8000-000000000004', true);
SELECT throws_ok(
  $$
    INSERT INTO public.comments (lecture_session_id, participant_id, body)
    SELECT auto_lecture_id, auto_participant, 'Clock tamper cannot bypass' FROM p2_fixture
  $$,
  '42501',
  null,
  'hard-stop-aware RLS rejects writes while stored status is still open'
);
SELECT is(
  public.get_lecture_public_snapshot_v2(
    (SELECT auto_lecture_id FROM p2_fixture)
  ) #>> '{changed,lecture,status}',
  'closed',
  'snapshot deadline guard converges a member to closed state'
);
RESET ROLE;
SELECT is(
  (SELECT close_reason FROM public.lecture_sessions, p2_fixture WHERE id = auto_lecture_id),
  'deadline_guard',
  'lazy deadline reconciliation persists its close reason'
);
SELECT is(
  (SELECT count(*) FROM public.lecture_lifecycle_events, p2_fixture
   WHERE lecture_session_id = auto_lecture_id AND event_type = 'lecture_closed'),
  1::bigint,
  'deadline guard writes one close event'
);
SELECT is(
  private.close_lecture_core(
    (SELECT auto_lecture_id FROM p2_fixture),
    'hard_stop',
    'deadline_worker',
    'phase2-test-worker'
  ) #>> '{changed}',
  'false',
  'worker retry after deadline guard is idempotent'
);

-- Background worker remains effective with no browser and is retry-safe.
SET LOCAL ROLE service_role;
UPDATE p2_fixture
SET worker_lecture_id = public.admin_create_lecture(
  'Phase 2 worker lecture',
  encode(extensions.digest(convert_to('P2-WORKER', 'UTF8'), 'sha256'), 'hex'),
  'P2-WORKER', null, null
);
SELECT ok(
  public.admin_set_lecture_status((SELECT worker_lecture_id FROM p2_fixture), 'start', now()),
  'worker fixture starts'
);
RESET ROLE;
UPDATE public.lecture_sessions AS lecture
SET hard_stop_at = lecture.started_at
FROM p2_fixture
WHERE lecture.id = p2_fixture.worker_lecture_id;
SELECT is(
  (SELECT count(*) FROM private.close_expired_lectures(50)
   WHERE lecture_session_id = (SELECT worker_lecture_id FROM p2_fixture)
     AND changed),
  1::bigint,
  'background worker closes an expired lecture without a browser'
);
SELECT is(
  (SELECT close_reason FROM public.lecture_sessions, p2_fixture WHERE id = worker_lecture_id),
  'hard_stop',
  'background close records hard-stop reason'
);
SELECT is(
  (SELECT count(*) FROM private.close_expired_lectures(50)
   WHERE lecture_session_id = (SELECT worker_lecture_id FROM p2_fixture)),
  0::bigint,
  'background worker retry performs no duplicate close'
);
SET LOCAL ROLE service_role;
SELECT ok(
  public.admin_set_lecture_status(
    (SELECT worker_lecture_id FROM p2_fixture),
    'close',
    '2099-01-01 00:00:00+00'
  ),
  'manual close racing after automatic close is idempotent'
);
SELECT is(
  (SELECT close_reason FROM public.lecture_sessions, p2_fixture WHERE id = worker_lecture_id),
  'hard_stop',
  'manual/automatic race preserves first terminal reason'
);

-- Retention: no archive before 30 days, logical archive at boundary, idempotent retry.
RESET ROLE;
SELECT is(
  (SELECT count(*) FROM private.archive_due_lectures(100)
   WHERE lecture_session_id = (SELECT main_lecture_id FROM p2_fixture)),
  0::bigint,
  'lecture is not archived before 30-day eligibility'
);
UPDATE public.lecture_sessions AS lecture
SET
  starts_at = statement_timestamp() - interval '30 days 90 minutes',
  started_at = statement_timestamp() - interval '30 days 90 minutes',
  hard_stop_at = statement_timestamp() - interval '30 days',
  ends_at = statement_timestamp() - interval '30 days',
  closed_at = statement_timestamp() - interval '30 days',
  archive_expires_at = statement_timestamp()
FROM p2_fixture
WHERE lecture.id = p2_fixture.main_lecture_id;
UPDATE public.lecture_archive_state AS archive
SET eligible_at = statement_timestamp()
FROM p2_fixture
WHERE archive.lecture_session_id = p2_fixture.main_lecture_id;
SELECT is(
  (SELECT status FROM private.archive_due_lectures(100)
   WHERE lecture_session_id = (SELECT main_lecture_id FROM p2_fixture)),
  'archived',
  'lecture is logically archived at the 30-day boundary'
);
SELECT is(
  (SELECT count(*) FROM public.lecture_lifecycle_events, p2_fixture
   WHERE lecture_session_id = main_lecture_id AND event_type = 'lecture_archived'),
  1::bigint,
  'logical archive writes one audit event'
);
SELECT is(
  (SELECT count(*) FROM private.archive_due_lectures(100)
   WHERE lecture_session_id = (SELECT main_lecture_id FROM p2_fixture)),
  0::bigint,
  'archive worker retry is idempotent'
);
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '51000000-0000-4000-8000-000000000001', true);
SELECT is(
  public.get_lecture_archive_v2((SELECT main_lecture_id FROM p2_fixture)),
  null::jsonb,
  'member preview ends at the 30-day boundary'
);

-- A rolled-back worker attempt leaves data and relations intact and can retry.
SET LOCAL ROLE service_role;
UPDATE p2_fixture
SET retry_lecture_id = public.admin_create_lecture(
  'Phase 2 archive retry lecture',
  encode(extensions.digest(convert_to('P2-RETRY', 'UTF8'), 'sha256'), 'hex'),
  'P2-RETRY', null, null
);
SELECT ok(
  public.admin_set_lecture_status((SELECT retry_lecture_id FROM p2_fixture), 'start', now()),
  'archive retry fixture starts'
);
SELECT ok(
  public.admin_set_lecture_status((SELECT retry_lecture_id FROM p2_fixture), 'close', now()),
  'archive retry fixture closes'
);
RESET ROLE;
UPDATE public.lecture_sessions AS lecture
SET
  starts_at = statement_timestamp() - interval '30 days 90 minutes',
  started_at = statement_timestamp() - interval '30 days 90 minutes',
  hard_stop_at = statement_timestamp() - interval '30 days',
  ends_at = statement_timestamp() - interval '30 days',
  closed_at = statement_timestamp() - interval '30 days',
  archive_expires_at = statement_timestamp()
FROM p2_fixture
WHERE lecture.id = p2_fixture.retry_lecture_id;
UPDATE public.lecture_archive_state AS archive
SET eligible_at = statement_timestamp()
FROM p2_fixture
WHERE archive.lecture_session_id = p2_fixture.retry_lecture_id;
DO $$
BEGIN
  BEGIN
    PERFORM * FROM private.archive_due_lectures(100);
    RAISE EXCEPTION 'simulated outer failure';
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;
END;
$$;
SELECT is(
  (SELECT status FROM public.lecture_archive_state, p2_fixture
   WHERE lecture_session_id = retry_lecture_id),
  'retained',
  'rolled-back archive attempt leaves state recoverable'
);
SELECT is(
  (SELECT count(*) FROM public.comments, p2_fixture
   WHERE lecture_session_id = retry_lecture_id),
  0::bigint,
  'failed archive attempt does not break child-data references'
);
SELECT is(
  (SELECT status FROM private.archive_due_lectures(100)
   WHERE lecture_session_id = (SELECT retry_lecture_id FROM p2_fixture)),
  'archived',
  'safe retry completes logical archive after prior rollback'
);
SET LOCAL ROLE service_role;
SELECT is(
  public.admin_restore_lecture_archive(
    (SELECT retry_lecture_id FROM p2_fixture),
    'phase2-test-admin'
  ) #>> '{status}',
  'restored',
  'logical archive can be restored without physical data reconstruction'
);
SELECT is(
  public.admin_restore_lecture_archive(
    (SELECT retry_lecture_id FROM p2_fixture),
    'phase2-test-admin'
  ) #>> '{status}',
  'restored',
  'archive restore retry is idempotent'
);
RESET ROLE;
SELECT is(
  (SELECT count(*) FROM private.archive_due_lectures(100)
   WHERE lecture_session_id = (SELECT retry_lecture_id FROM p2_fixture)),
  0::bigint,
  'restored archive is held from automatic re-archival'
);

SELECT * FROM finish();
ROLLBACK;
