BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path = public, extensions;
SELECT no_plan();

SELECT has_table('public', 'lecture_summary_runs', 'summary run table exists');
SELECT has_table('public', 'lecture_summary_windows', 'summary window table exists');
SELECT has_table('public', 'lecture_ai_summaries', 'accepted summary table exists');
SELECT has_table('public', 'lecture_ai_summary_revisions', 'immutable revision table exists');
SELECT has_table('public', 'summary_publications', 'publication pointer table exists');

SELECT ok(
  (SELECT bool_and(relrowsecurity) FROM pg_class
   WHERE oid IN (
     'public.lecture_summary_runs'::regclass,
     'public.lecture_summary_windows'::regclass,
     'public.lecture_ai_summaries'::regclass,
     'public.lecture_ai_summary_revisions'::regclass,
     'public.summary_publications'::regclass
   )),
  'all Phase 6 tables have RLS enabled'
);
SELECT ok(
  NOT has_table_privilege('anon', 'public.lecture_ai_summaries', 'SELECT')
  AND NOT has_table_privilege('authenticated', 'public.lecture_ai_summaries', 'SELECT'),
  'browser roles cannot read protected AI output tables'
);
SELECT ok(
  has_table_privilege('service_role', 'public.lecture_ai_summaries', 'SELECT'),
  'service role receives the minimum summary table access'
);
SELECT ok(
  NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name IN (
        'lecture_summary_runs', 'lecture_summary_windows', 'lecture_ai_summaries',
        'lecture_ai_summary_revisions', 'summary_publications'
      )
      AND column_name IN (
        'transcript', 'transcript_text', 'pdf_text', 'pdf_content', 'source_text', 'audio'
      )
  ),
  'Supabase stores no raw transcript, PDF text or audio column'
);
SELECT ok(
  NOT (SELECT prosecdef FROM pg_proc
       WHERE oid = 'public.admin_start_summary_window_operation(uuid,uuid,text,text,integer,text,text,jsonb,jsonb,bigint,bigint,bigint,bigint,bigint)'::regprocedure),
  'public summary start wrapper is SECURITY INVOKER'
);
SELECT is(
  (SELECT proconfig FROM pg_proc
   WHERE oid = 'private.start_summary_window_operation(uuid,uuid,text,text,integer,text,text,jsonb,jsonb,bigint,bigint,bigint,bigint,bigint)'::regprocedure),
  ARRAY['search_path=""']::text[],
  'private summary primitive fixes an empty search path'
);
SELECT ok(
  NOT has_function_privilege(
    'authenticated',
    'public.admin_start_summary_window_operation(uuid,uuid,text,text,integer,text,text,jsonb,jsonb,bigint,bigint,bigint,bigint,bigint)',
    'EXECUTE'
  ),
  'students cannot start paid summary operations'
);
SELECT ok(
  has_function_privilege(
    'service_role',
    'public.admin_start_summary_window_operation(uuid,uuid,text,text,integer,text,text,jsonb,jsonb,bigint,bigint,bigint,bigint,bigint)',
    'EXECUTE'
  ),
  'service role can call the protected summary start RPC'
);
SELECT ok(
  to_regclass('public.lecture_summary_windows_lecture_window_idx') IS NOT NULL
  AND to_regclass('public.summary_publications_public_lecture_idx') IS NOT NULL,
  'window and publication lookups are indexed'
);

CREATE TEMP TABLE p6_fixture (
  lecture_id uuid,
  not_due_lecture_id uuid,
  unrelated_lecture_id uuid,
  grant_id uuid,
  not_due_grant_id uuid,
  run_id uuid,
  not_due_run_id uuid,
  operation_id uuid,
  second_operation_id uuid,
  late_operation_id uuid,
  summary_id uuid,
  result jsonb,
  snapshot jsonb
);
GRANT SELECT, INSERT, UPDATE ON p6_fixture TO service_role, authenticated;
INSERT INTO p6_fixture DEFAULT VALUES;

SET LOCAL ROLE service_role;
UPDATE p6_fixture SET
  lecture_id = public.admin_create_lecture(
    'Phase 6 summaries',
    encode(extensions.digest(convert_to('P6SUMM', 'UTF8'), 'sha256'), 'hex'),
    'P6SUMM', null, null
  ),
  not_due_lecture_id = public.admin_create_lecture(
    'Phase 6 boundary',
    encode(extensions.digest(convert_to('P6BOUND', 'UTF8'), 'sha256'), 'hex'),
    'P6BOUND', null, null
  ),
  unrelated_lecture_id = public.admin_create_lecture(
    'Phase 6 unrelated',
    encode(extensions.digest(convert_to('P6OTHER', 'UTF8'), 'sha256'), 'hex'),
    'P6OTHER', null, null
  );
SELECT ok(public.admin_set_lecture_status((SELECT lecture_id FROM p6_fixture), 'start', null), 'summary lecture starts');
SELECT ok(public.admin_set_lecture_status((SELECT not_due_lecture_id FROM p6_fixture), 'start', null), 'boundary lecture starts');
SELECT ok(public.admin_set_lecture_status((SELECT unrelated_lecture_id FROM p6_fixture), 'start', null), 'unrelated lecture starts');

UPDATE public.lecture_sessions
SET started_at = statement_timestamp() - interval '20 minutes',
    hard_stop_at = statement_timestamp() + interval '70 minutes',
    ends_at = statement_timestamp() + interval '70 minutes'
WHERE id = (SELECT lecture_id FROM p6_fixture);
UPDATE public.lecture_sessions
SET started_at = statement_timestamp() - interval '4 minutes 59 seconds',
    hard_stop_at = statement_timestamp() + interval '85 minutes 1 second',
    ends_at = statement_timestamp() + interval '85 minutes 1 second'
WHERE id = (SELECT not_due_lecture_id FROM p6_fixture);

SELECT lives_ok(
  $$SELECT public.admin_configure_lecture_ai_control(
    (SELECT lecture_id FROM p6_fixture),
    jsonb_build_object(
      'summaries_enabled', false,
      'material_analysis_enabled', true,
      'summary_call_limit', 18,
      'budget_limit_microusd', 2500000,
      'input_token_limit', 720000,
      'output_token_limit', 21600,
      'max_concurrent_operations', 2
    ),
    'admin-session:p6'
  )$$,
  'Phase 6 cost and concurrency limits are configured'
);
SELECT lives_ok(
  $$SELECT public.admin_configure_lecture_ai_control(
    (SELECT not_due_lecture_id FROM p6_fixture),
    jsonb_build_object('summaries_enabled', false, 'summary_call_limit', 18),
    'admin-session:p6'
  )$$,
  'boundary lecture AI control is configured'
);

UPDATE p6_fixture SET grant_id = (
  public.admin_issue_ai_billing_grant(
    lecture_id, ARRAY['summaries'], repeat('a', 64), true, 'admin-session:p6'
  ) ->> 'grant_id'
)::uuid,
not_due_grant_id = (
  public.admin_issue_ai_billing_grant(
    not_due_lecture_id, ARRAY['summaries'], repeat('c', 64), true, 'admin-session:p6'
  ) ->> 'grant_id'
)::uuid;

UPDATE p6_fixture SET result = public.admin_start_lecture_summary_run(
  grant_id, repeat('a', 64), lecture_id, repeat('b', 64), 'admin-session:wrong'
);
SELECT is((SELECT result ->> 'reason' FROM p6_fixture), 'invalid_grant', 'summary run is actor-bound');

UPDATE p6_fixture SET result = public.admin_start_lecture_summary_run(
  grant_id, repeat('a', 64), lecture_id, repeat('b', 64), 'admin-session:p6'
);
UPDATE p6_fixture SET run_id = (result #>> '{run,id}')::uuid;
SELECT is((SELECT result ->> 'accepted' FROM p6_fixture), 'true', 'one Billing-authorized summary run starts');
SELECT is(
  (SELECT status FROM public.ai_billing_grants AS grant_row, p6_fixture WHERE grant_row.id = p6_fixture.grant_id),
  'consumed',
  'Billing grant is consumed exactly once at run start'
);
SELECT is(
  (SELECT summaries_enabled::text FROM public.lecture_ai_control AS control, p6_fixture WHERE control.lecture_session_id = p6_fixture.lecture_id),
  'true',
  'summary run enables only the summary feature'
);
SELECT is(
  (public.admin_start_lecture_summary_run(
    (SELECT grant_id FROM p6_fixture), repeat('a', 64),
    (SELECT lecture_id FROM p6_fixture), repeat('d', 64), 'admin-session:p6'
  ) ->> 'reason'),
  'grant_not_available',
  'replayed Billing grant cannot start a second run'
);

UPDATE p6_fixture SET result = public.admin_start_lecture_summary_run(
  not_due_grant_id, repeat('c', 64), not_due_lecture_id, repeat('d', 64), 'admin-session:p6'
);
UPDATE p6_fixture SET not_due_run_id = (result #>> '{run,id}')::uuid;
UPDATE p6_fixture SET result = public.admin_start_summary_window_operation(
  not_due_lecture_id, not_due_run_id, repeat('d', 64), 'admin-session:p6',
  1, 'phase6-summary-v1', 'gpt-5.6-luna', '{}'::jsonb,
  jsonb_build_object('transcript', true, 'pdf', false, 'comments', true),
  12000, 4000, 1200, 1000000, 6000000
);
SELECT is((SELECT result ->> 'reason' FROM p6_fixture), 'window_not_due', 'five-minute boundary rejects 4:59 server elapsed time');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '46000000-0000-4000-8000-000000000001', true);
SELECT is(
  (SELECT count(*)::integer FROM public.join_lecture_by_code('P6SUMM')),
  1,
  'authenticated fixture student joins before comment-context tests'
);
RESET ROLE;
INSERT INTO public.comments (
  lecture_session_id, participant_id, body, created_at, updated_at
)
SELECT
  fixture.lecture_id,
  participant.id,
  'Phase 6 active discussion ' || item,
  statement_timestamp() - interval '12 minutes' + make_interval(secs => item),
  statement_timestamp() - interval '12 minutes' + make_interval(secs => item)
FROM p6_fixture AS fixture
JOIN public.participants AS participant
  ON participant.lecture_session_id = fixture.lecture_id
 AND participant.auth_user_id = '46000000-0000-4000-8000-000000000001'::uuid
CROSS JOIN generate_series(1, 3) AS item;
SET LOCAL ROLE service_role;

UPDATE p6_fixture SET result = public.admin_skip_summary_window(
  lecture_id, run_id, repeat('b', 64), 'admin-session:p6',
  1, 'phase6-summary-v1', 'insufficient_source_context', '{}'::jsonb,
  jsonb_build_object('transcript', false, 'pdf', false, 'comments', true)
);
SELECT is((SELECT result ->> 'accepted' FROM p6_fixture), 'true', 'information-poor due window is skipped without provider operation');
SELECT is(
  (SELECT count(*)::integer FROM public.ai_usage_ledger AS usage, p6_fixture
   WHERE usage.lecture_session_id = p6_fixture.lecture_id AND usage.feature = 'summaries'),
  0,
  'skip consumes no provider call, token or budget ledger row'
);
SELECT lives_ok(
  $$SELECT public.admin_skip_summary_window(
    (SELECT lecture_id FROM p6_fixture), (SELECT run_id FROM p6_fixture),
    repeat('b', 64), 'admin-session:p6', 1, 'phase6-summary-v1',
    'insufficient_source_context', '{}'::jsonb, '{}'::jsonb
  )$$,
  'skip replay is idempotent'
);

UPDATE p6_fixture SET result = public.admin_skip_summary_window(
  lecture_id, run_id, repeat('b', 64), 'admin-session:p6',
  2, 'phase6-summary-v1', 'insufficient_source_context', '{}'::jsonb,
  jsonb_build_object('transcript', false, 'pdf', false, 'comments', true)
);
SELECT is(
  (SELECT result ->> 'reason' FROM p6_fixture),
  'comment_context_available',
  'active comment-only window is not skipped before provider admission'
);

UPDATE p6_fixture SET result = public.admin_start_summary_window_operation(
  lecture_id, run_id, repeat('b', 64), 'admin-session:p6',
  2, 'phase6-summary-v1', 'gpt-5.6-luna',
  jsonb_build_object('transcript_character_count', 0, 'pdf_character_count', 0),
  jsonb_build_object('transcript', false, 'pdf', false, 'comments', true),
  12000, 4000, 1200, 1000000, 6000000
);
UPDATE p6_fixture SET operation_id = (result #>> '{operation,id}')::uuid;
SELECT is((SELECT result ->> 'accepted' FROM p6_fixture), 'true', 'active comment-only window reserves one Batch operation');
SELECT is(
  (SELECT attempt_count FROM public.lecture_summary_windows AS summary_window, p6_fixture
   WHERE summary_window.current_operation_id = p6_fixture.operation_id),
  1,
  'first provider attempt is audited on the deterministic window'
);
SELECT is(
  (public.admin_start_lecture_ai_operation(
    (SELECT lecture_id FROM p6_fixture), 'material_analysis', 'p6-batch-contention',
    1, 0, 1, 1, 'admin-session:p6'
  ) ->> 'reason'),
  'concurrency_limit',
  'material analysis cannot overlap the summary Batch lane'
);

UPDATE p6_fixture SET result = public.admin_complete_summary_window_operation(
  operation_id, run_id, 'admin-session:p6', 400, 100, 50,
  'resp-phase6-one', 'gpt-5.6-luna',
  jsonb_build_object(
    'lecture_recap', jsonb_build_array('対照群の設定を確認した。', '交絡要因を踏まえて結果を解釈する。'),
    'comment_pulse', jsonb_build_array('研究デザインに関する議論が続いた。'),
    'academic_question_candidate', jsonb_build_object(
      'commentId', 'admin-only-comment', 'question', '内的妥当性をどう評価しますか？',
      'educationalValue', '方法論の吟味', 'qualityScore', 0.9, 'rationale', '研究デザインの質問'
    ),
    'cumulative_memo', '比較群と交絡を検討した。',
    'display_recommendation', true,
    'evidence_page_ids', '[]'::jsonb,
    'evidence_segment_ids', jsonb_build_array(repeat('f', 64)),
    'source_coverage', jsonb_build_object('transcript', true, 'pdf', false, 'comments', true)
  ),
  jsonb_build_object('publish_recommended', true, 'evidence_present', true),
  true
);
UPDATE p6_fixture SET summary_id = (result ->> 'summary_id')::uuid;
SELECT is((SELECT result ->> 'result_saved' FROM p6_fixture), 'true', 'valid provider result is atomically saved');
SELECT is(
  (SELECT status FROM public.ai_usage_ledger AS usage, p6_fixture WHERE usage.id = p6_fixture.operation_id),
  'succeeded',
  'successful summary finalizes the usage ledger'
);
SELECT is(
  (SELECT count(*)::integer FROM public.lecture_ai_summary_revisions AS revision, p6_fixture
   WHERE revision.summary_id = p6_fixture.summary_id),
  1,
  'initial AI revision is immutable history revision one'
);
SELECT lives_ok(
  $$SELECT public.admin_complete_summary_window_operation(
    (SELECT operation_id FROM p6_fixture), (SELECT run_id FROM p6_fixture),
    'admin-session:p6', 400, 100, 50, 'resp-phase6-one', 'gpt-5.6-luna',
    jsonb_build_object('lecture_recap', jsonb_build_array('Replay'), 'comment_pulse', '[]'::jsonb),
    '{}'::jsonb, false
  )$$,
  'completion replay does not create a second result'
);
SELECT is(
  (SELECT count(*)::integer FROM public.lecture_ai_summaries AS summary, p6_fixture
   WHERE summary.window_id = (SELECT window_id FROM public.lecture_ai_summaries WHERE id = p6_fixture.summary_id)),
  1,
  'completion replay never duplicates a summary'
);

SELECT lives_ok(
  $$SELECT public.admin_manage_summary_publication(
    (SELECT lecture_id FROM p6_fixture), (SELECT summary_id FROM p6_fixture),
    'admin-session:p6', 'revise_publish',
    jsonb_build_object(
      'lecture_recap', jsonb_build_array('教員が根拠に沿って訂正した要点。'),
      'comment_pulse', jsonb_build_array('議論の焦点を中立に整理した。')
    ), 'teacher_correction', null, null
  )$$,
  'teacher correction appends and publishes a new revision'
);
SELECT is(
  (SELECT count(*)::integer FROM public.lecture_ai_summary_revisions AS revision, p6_fixture
   WHERE revision.summary_id = p6_fixture.summary_id),
  2,
  'teacher correction preserves the AI revision instead of overwriting it'
);
SELECT is(
  (SELECT review_state FROM public.summary_publications AS publication, p6_fixture
   WHERE publication.summary_id = p6_fixture.summary_id),
  'admin_revised',
  'student-facing revision carries teacher review status'
);
SELECT throws_ok(
  $$SELECT public.admin_manage_summary_publication(
    (SELECT unrelated_lecture_id FROM p6_fixture), (SELECT summary_id FROM p6_fixture),
    'admin-session:p6', 'hide', null, null, null, null
  )$$,
  'P0002', 'summary not found',
  'unrelated lecture cannot manage another lecture summary'
);

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '46000000-0000-4000-8000-000000000001', true);
SELECT is(
  (SELECT count(*)::integer FROM public.join_lecture_by_code('P6SUMM')),
  1,
  'authenticated student rejoin remains idempotent'
);
UPDATE p6_fixture SET snapshot = public.get_lecture_public_snapshot_v4(lecture_id);
SELECT is(
  (SELECT jsonb_array_length(snapshot #> '{changed,summaries}') FROM p6_fixture),
  1,
  'published summary is delivered inside the existing shared snapshot'
);
SELECT ok(
  NOT (SELECT snapshot #> '{changed,summaries,0}' ? 'academic_question_candidate' FROM p6_fixture),
  'academic question candidate is never exposed to students in Phase 6'
);
SELECT is(
  (SELECT snapshot #>> '{changed,summaries,0,review_state}' FROM p6_fixture),
  'admin_revised',
  'student sees the teacher review label'
);
SELECT throws_ok(
  $$SELECT * FROM public.lecture_ai_summaries$$,
  '42501', null,
  'student cannot bypass the compact snapshot to read raw AI output'
);

RESET ROLE;
SET LOCAL ROLE service_role;
UPDATE p6_fixture SET result = public.admin_start_summary_window_operation(
  lecture_id, run_id, repeat('b', 64), 'admin-session:p6',
  3, 'phase6-summary-v1', 'gpt-5.6-luna',
  jsonb_build_object('transcript_character_count', 0, 'pdf_character_count', 0),
  jsonb_build_object('transcript', false, 'pdf', false, 'comments', true),
  12000, 4000, 1200, 1000000, 6000000
);
SELECT is(
  (SELECT result ->> 'reason' FROM p6_fixture),
  'insufficient_source_context',
  'paid admission rechecks a quiet low-source window before reserving cost'
);
UPDATE p6_fixture SET result = public.admin_start_summary_window_operation(
  lecture_id, run_id, repeat('b', 64), 'admin-session:p6',
  3, 'phase6-summary-v1', 'gpt-5.6-luna', '{}'::jsonb,
  jsonb_build_object('transcript', true), 12000, 4000, 1200, 1000000, 6000000
);
UPDATE p6_fixture SET late_operation_id = (result #>> '{operation,id}')::uuid;
SELECT is((SELECT result ->> 'accepted' FROM p6_fixture), 'true', 'another due window starts before manual stop');
SELECT is(
  (public.admin_stop_lecture_summary_run(
    (SELECT lecture_id FROM p6_fixture), 'admin-session:other', 'wrong_actor'
  ) ->> 'reason'),
  'actor_mismatch',
  'another Admin actor cannot stop the owner run'
);
SELECT is(
  (public.admin_stop_lecture_summary_run(
    (SELECT lecture_id FROM p6_fixture), 'admin-session:p6', 'admin_manual_stop'
  ) ->> 'accepted'),
  'true',
  'owner can stop the run without another Billing grant'
);
SELECT is(
  (SELECT status FROM public.ai_usage_ledger AS usage, p6_fixture WHERE usage.id = p6_fixture.late_operation_id),
  'cancelled',
  'stop cancels an in-flight provider ledger entry'
);
SELECT is(
  (SELECT status FROM public.lecture_summary_windows AS summary_window, p6_fixture
   WHERE summary_window.current_operation_id IS NULL
     AND summary_window.lecture_session_id = p6_fixture.lecture_id
     AND summary_window.window_index = 3),
  'discarded',
  'stop discards the in-flight window so a late result cannot publish'
);
SELECT is(
  (SELECT count(*)::integer FROM public.lecture_ai_summaries AS summary, p6_fixture
   WHERE summary.operation_id = p6_fixture.late_operation_id),
  0,
  'no result exists for the stopped in-flight provider call'
);
SELECT lives_ok(
  $$SELECT public.admin_stop_lecture_summary_run(
    (SELECT lecture_id FROM p6_fixture), 'admin-session:p6', 'admin_manual_stop'
  )$$,
  'summary stop replay is idempotent'
);

SELECT is(
  (public.admin_start_summary_window_operation(
    (SELECT lecture_id FROM p6_fixture), (SELECT run_id FROM p6_fixture), repeat('b', 64),
    'admin-session:p6', 4, 'phase6-summary-v1', 'gpt-5.6-luna', '{}'::jsonb,
    '{}'::jsonb, 12000, 4000, 1200, 1000000, 6000000
  ) ->> 'reason'),
  'summary_run_not_active',
  'stopped run cannot start later paid work'
);

SELECT is(
  (public.admin_set_lecture_status((SELECT not_due_lecture_id FROM p6_fixture), 'close', null))::text,
  'true',
  'manual lecture close succeeds while a summary run exists'
);
SELECT is(
  (SELECT status FROM public.lecture_summary_runs AS run, p6_fixture WHERE run.id = p6_fixture.not_due_run_id),
  'closed',
  'lecture close converges the summary run to closed'
);
SELECT is(
  (public.admin_start_summary_window_operation(
    (SELECT not_due_lecture_id FROM p6_fixture), (SELECT not_due_run_id FROM p6_fixture), repeat('d', 64),
    'admin-session:p6', 1, 'phase6-summary-v1', 'gpt-5.6-luna', '{}'::jsonb,
    '{}'::jsonb, 1, 1, 1, 1000000, 6000000
  ) ->> 'reason'),
  'lecture_not_open',
  'closed lecture rejects every new summary write at the server'
);

SELECT * FROM finish();
ROLLBACK;
