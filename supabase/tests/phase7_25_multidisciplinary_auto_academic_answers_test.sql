BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path = public, extensions;
SELECT no_plan();

SELECT has_table(
  'public', 'academic_answer_publication_events',
  'Phase 7.25 publication audit table exists'
);
SELECT has_column(
  'public', 'lecture_summary_runs', 'auto_academic_answers_enabled',
  'summary run stores the explicit automatic-answer opt-in'
);
SELECT has_column(
  'public', 'academic_answer_requests', 'evidence_attempt_count',
  'automatic evidence claims have a bounded retry counter'
);
SELECT ok(
  (SELECT relrowsecurity FROM pg_class
   WHERE oid = 'public.academic_answer_publication_events'::regclass),
  'publication audit events have RLS enabled'
);
SELECT ok(
  NOT has_table_privilege(
    'authenticated', 'public.academic_answer_publication_events', 'SELECT'
  )
  AND NOT has_table_privilege(
    'anon', 'public.academic_answer_publication_events', 'SELECT'
  )
  AND has_table_privilege(
    'service_role', 'public.academic_answer_publication_events', 'SELECT'
  )
  AND NOT has_table_privilege(
    'service_role', 'public.academic_answer_publication_events', 'INSERT'
  )
  AND NOT has_table_privilege(
    'service_role', 'public.academic_answer_publication_events', 'UPDATE'
  )
  AND NOT has_table_privilege(
    'service_role', 'public.academic_answer_publication_events', 'DELETE'
  ),
  'audit rows are browser-private and service-role read-only'
);
SELECT has_index(
  'public', 'lecture_summary_runs',
  'lecture_summary_runs_academic_authorization_grant_idx',
  'automatic-answer billing-grant FK is indexed'
);
SELECT has_index(
  'public', 'academic_answer_requests',
  'academic_answer_requests_source_summary_fk_idx',
  'academic-answer source-summary FK has a full leading index'
);
SELECT has_index(
  'public', 'academic_answer_requests',
  'academic_answer_requests_automation_run_fk_idx',
  'academic-answer automation-run FK is indexed'
);
SELECT has_index(
  'public', 'academic_answer_requests',
  'academic_answer_requests_automation_lecture_fk_idx',
  'academic-answer lecture-scoped automation FK is indexed'
);
SELECT has_index(
  'public', 'academic_answer_publication_events',
  'academic_answer_publication_events_revision_scope_fk_idx',
  'publication-event revision-scope FK is indexed'
);
SELECT ok(
  NOT has_function_privilege(
    'authenticated',
    'public.admin_prepare_auto_academic_answer_request(uuid,uuid,text,text,text,uuid,text,text,text,text)',
    'EXECUTE'
  )
  AND has_function_privilege(
    'service_role',
    'public.admin_prepare_auto_academic_answer_request(uuid,uuid,text,text,text,uuid,text,text,text,text)',
    'EXECUTE'
  ),
  'only the Edge service role can claim automatic-answer work'
);
SELECT ok(
  NOT (SELECT prosecdef FROM pg_proc WHERE oid =
    'public.admin_start_auto_academic_answer_operation(uuid,uuid,text,text,text,text,text,text,integer,integer,bigint,bigint,bigint,bigint,bigint)'::regprocedure),
  'public automatic start wrapper is SECURITY INVOKER'
);
SELECT ok(
  (SELECT prosecdef AND proconfig @> ARRAY['search_path=""']
   FROM pg_proc WHERE oid =
    'private.start_auto_academic_answer_operation(uuid,uuid,text,text,text,text,text,text,integer,integer,bigint,bigint,bigint,bigint,bigint)'::regprocedure),
  'private automatic start primitive is a fixed-search-path definer'
);
SELECT ok(
  NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename IN (
        'academic_answer_publication_events',
        'academic_answer_requests',
        'academic_answer_sources'
      )
  ),
  'Phase 7.25 adds no Realtime fanout'
);
SELECT ok(
  (SELECT convalidated
   FROM pg_constraint
   WHERE conrelid = 'public.academic_answer_sources'::regclass
     AND conname = 'academic_answer_sources_phase725_verification_check'),
  'provider-aware verification constraint is fully validated after legacy backfill'
);
SELECT ok(
  NOT private.phase72_answer_body_is_valid(
    '{"answer_points":[{"text":"Invalid null source","source_ids":["pmid:1",null]}],"limitations":[]}'::jsonb
  ),
  'JSON-null citation identifiers fail closed'
);
SELECT ok(
  NOT private.phase72_answer_body_is_valid(
    '{"answer_points":[{"text":"Duplicate source","source_ids":["pmid:1","pmid:1"]}],"limitations":[]}'::jsonb
  ),
  'duplicate citation identifiers fail closed'
);
SELECT is(
  private.phase725_safe_quality_score('"not-a-number"'::jsonb),
  0::numeric,
  'legacy malformed qualityScore is safely treated as zero'
);

CREATE TEMP TABLE p725_fixture (
  lecture_id uuid,
  other_lecture_id uuid,
  grant_id uuid,
  run_id uuid,
  summary_operation_id uuid,
  summary_id uuid,
  request_id uuid,
  academic_operation_id uuid,
  answer_id uuid,
  result jsonb
);
GRANT SELECT, INSERT, UPDATE ON p725_fixture TO service_role, authenticated;
INSERT INTO p725_fixture DEFAULT VALUES;

SET LOCAL ROLE service_role;
UPDATE p725_fixture SET
  lecture_id = public.admin_create_lecture(
    'Phase 7.25 automatic answer',
    encode(extensions.digest(convert_to('725001', 'UTF8'), 'sha256'), 'hex'),
    '725001', null, null
  ),
  other_lecture_id = public.admin_create_lecture(
    'Phase 7.25 unrelated lecture',
    encode(extensions.digest(convert_to('725002', 'UTF8'), 'sha256'), 'hex'),
    '725002', null, null
  );
SELECT ok(
  public.admin_set_lecture_status(
    (SELECT lecture_id FROM p725_fixture), 'start', null
  ),
  'automatic-answer lecture starts'
);
SELECT ok(
  public.admin_set_lecture_status(
    (SELECT other_lecture_id FROM p725_fixture), 'start', null
  ),
  'unrelated lecture starts'
);
UPDATE public.lecture_sessions
SET started_at = statement_timestamp() - interval '10 minutes',
    hard_stop_at = statement_timestamp() + interval '80 minutes',
    ends_at = statement_timestamp() + interval '80 minutes'
WHERE id = (SELECT lecture_id FROM p725_fixture);

SELECT lives_ok(
  $$SELECT public.admin_configure_lecture_ai_control(
    (SELECT lecture_id FROM p725_fixture),
    jsonb_build_object(
      'summaries_enabled', false,
      'academic_answers_enabled', false,
      'summary_call_limit', 18,
      'academic_answer_limit', 3,
      'budget_limit_microusd', 2500000,
      'input_token_limit', 720000,
      'output_token_limit', 50000,
      'max_concurrent_operations', 2
    ),
    'admin-session:p725'
  )$$,
  'bounded AI control is configured with automatic answers default-off'
);
UPDATE p725_fixture SET result = public.admin_issue_ai_billing_grant(
  lecture_id, ARRAY['academic_answers', 'summaries'], repeat('a', 64),
  true, 'admin-session:p725'
);
UPDATE p725_fixture SET grant_id = (result ->> 'grant_id')::uuid;

UPDATE p725_fixture SET result = public.admin_start_lecture_summary_run_v2(
  grant_id, repeat('a', 64), lecture_id, repeat('b', 64),
  'admin-session:p725', true, 'auto'
);
UPDATE p725_fixture SET run_id = (result #>> '{run,id}')::uuid;
SELECT is(
  (SELECT result ->> 'accepted' FROM p725_fixture), 'true',
  'combined-scope PIN grant starts the opted-in automatic run'
);
SELECT is(
  (SELECT auto_academic_answers_enabled::text
   FROM public.lecture_summary_runs AS run, p725_fixture AS fixture
   WHERE run.id = fixture.run_id),
  'true',
  'automatic-answer opt-in is persisted on the run'
);
SELECT is(
  (SELECT academic_answers_enabled::text
   FROM public.lecture_ai_control AS control, p725_fixture AS fixture
   WHERE control.lecture_session_id = fixture.lecture_id),
  'true',
  'run temporarily enables the academic-answer lane'
);

UPDATE p725_fixture SET result = public.admin_start_summary_window_operation(
  lecture_id, run_id, repeat('b', 64), 'admin-session:p725',
  1, 'phase7-1-summary-language-v1', 'gpt-5.6-luna',
  jsonb_build_object('transcript_character_count', 500),
  jsonb_build_object('transcript', true, 'pdf', false, 'comments', false),
  12000, 4000, 1200, 1000000, 6000000
);
UPDATE p725_fixture
SET summary_operation_id = (result #>> '{operation,id}')::uuid;
SELECT is(
  (SELECT result ->> 'accepted' FROM p725_fixture), 'true',
  'due summary window is admitted before automatic evidence work'
);
UPDATE p725_fixture SET result = public.admin_complete_summary_window_operation(
  summary_operation_id, run_id, 'admin-session:p725',
  400, 100, 50, 'resp-p725-summary', 'gpt-5.6-luna',
  jsonb_build_object(
    'lecture_recap', jsonb_build_array('英語学習とAI活用の関係を整理した。'),
    'comment_pulse', jsonb_build_array('AIリテラシーへの質問が生まれた。'),
    'academic_question_candidate', jsonb_build_object(
      'commentId', 'p725-comment',
      'question', '英語能力とAIリテラシーは相関しますか？',
      'educationalValue', '言語学習とAI活用を研究知見から考えられる。',
      'qualityScore', 0.92,
      'rationale', '学際的で教育価値の高い問い'
    ),
    'cumulative_memo', '英語学習とAI活用を検討した。',
    'display_recommendation', true,
    'evidence_page_ids', '[]'::jsonb,
    'evidence_segment_ids', jsonb_build_array(repeat('f', 64)),
    'source_coverage', jsonb_build_object(
      'transcript', true, 'pdf', false, 'comments', false
    ),
    'output_language', 'ja'
  ),
  jsonb_build_object(
    'publish_recommended', true,
    'evidence_present', true,
    'output_language', 'ja'
  ),
  true
);
UPDATE p725_fixture SET summary_id = (
  SELECT summary.id
  FROM public.lecture_ai_summaries AS summary
  WHERE summary.operation_id = p725_fixture.summary_operation_id
);
SELECT ok(
  (SELECT summary_id IS NOT NULL FROM p725_fixture),
  'summary candidate is stored before academic retrieval'
);

SELECT throws_ok(
  $$SELECT public.admin_prepare_auto_academic_answer_request(
    (SELECT lecture_id FROM p725_fixture),
    (SELECT run_id FROM p725_fixture), repeat('9', 64),
    'admin-session:p725', 'phase7-25:auto:wrong-token',
    (SELECT summary_id FROM p725_fixture),
    '英語能力とAIリテラシーは相関しますか？', repeat('d', 64),
    repeat('e', 64), 'auto'
  )$$,
  '42501', null,
  'wrong run token cannot claim automatic work'
);
UPDATE p725_fixture SET result = public.admin_prepare_auto_academic_answer_request(
  lecture_id, run_id, repeat('b', 64), 'admin-session:p725',
  'phase7-25:auto:summary-one', summary_id,
  '英語能力とAIリテラシーは相関しますか？', repeat('d', 64),
  repeat('e', 64), 'auto'
);
UPDATE p725_fixture SET request_id = (result #>> '{request,id}')::uuid;
SELECT is(
  (SELECT result ->> 'claim_acquired' FROM p725_fixture), 'true',
  'first caller acquires the bounded evidence lease'
);
SELECT is(
  public.admin_prepare_auto_academic_answer_request(
    (SELECT lecture_id FROM p725_fixture),
    (SELECT run_id FROM p725_fixture), repeat('b', 64),
    'admin-session:p725', 'phase7-25:auto:summary-one',
    (SELECT summary_id FROM p725_fixture),
    '英語能力とAIリテラシーは相関しますか？', repeat('d', 64),
    repeat('e', 64), 'auto'
  ) ->> 'claim_acquired',
  'false',
  'live evidence lease prevents duplicate metadata/model dispatch'
);

UPDATE p725_fixture SET result = public.admin_start_auto_academic_answer_operation(
  request_id, run_id, repeat('b', 64), 'admin-session:p725',
  'gpt-5.6-luna', 'phase7-25-academic-v1', repeat('f', 64),
  'multidisciplinary_doi', 1, 1,
  10000, 5000, 1000, 1000000, 6000000
);
UPDATE p725_fixture
SET academic_operation_id = (result #>> '{operation,id}')::uuid;
SELECT is(
  (SELECT result ->> 'accepted' FROM p725_fixture), 'true',
  'automatic operation reserves one bounded academic call'
);
SELECT ok(
  public.admin_mark_academic_provider_dispatched(
    (SELECT request_id FROM p725_fixture),
    (SELECT academic_operation_id FROM p725_fixture),
    'admin-session:p725'
  ),
  'provider dispatch is audited before completion'
);

UPDATE p725_fixture SET result = public.admin_complete_academic_answer_operation(
  request_id, academic_operation_id, 'admin-session:p725',
  jsonb_build_array(jsonb_build_object(
    'source_id', 'doi:10.1080/09588221.2026.2631658',
    'source_provider', 'crossref_openalex',
    'pmid', null,
    'doi', '10.1080/09588221.2026.2631658',
    'title', 'Impact of proficiency on interaction with AI-generated feedback',
    'publication_year', 2026,
    'authors', jsonb_build_array('Li M', 'Wang X'),
    'journal', 'Computer Assisted Language Learning',
    'publication_types', jsonb_build_array('Journal Article'),
    'study_type', 'original_journal_article',
    'source_role', 'primary',
    'verification', jsonb_build_object(
      'passed', true, 'pubmed', false, 'crossref', true,
      'openalex', true, 'originalResearch', true
    )
  )),
  jsonb_build_object(
    'answer_points', jsonb_build_array(jsonb_build_object(
      'text', '英語力だけでなく、AIの出力を吟味する力も学習成果に関わります。',
      'source_ids', jsonb_build_array(
        'doi:10.1080/09588221.2026.2631658'
      )
    )),
    'limitations', '[]'::jsonb
  ),
  jsonb_build_object(
    'identifier_validity', 1,
    'mapped_claim_fraction', 1,
    'primary_source_count', 1,
    'source_set_sha256', repeat('f', 64)
  ),
  8000, 1800, 700, 'resp-p725-academic'
);
UPDATE p725_fixture SET answer_id = (
  SELECT answer.id
  FROM public.lecture_academic_answers AS answer
  WHERE answer.operation_id = p725_fixture.academic_operation_id
);
SELECT is(
  (SELECT result ->> 'auto_published' FROM p725_fixture), 'true',
  'supported automatic answer publishes immediately as AI-unreviewed'
);
SELECT is(
  (SELECT review_state
   FROM public.academic_answer_publications AS publication, p725_fixture AS fixture
   WHERE publication.answer_id = fixture.answer_id),
  'ai_unreviewed',
  'student-visible state is explicitly teacher-unconfirmed'
);
SELECT is(
  (SELECT count(*)::integer
   FROM public.academic_answer_publication_events AS event, p725_fixture AS fixture
   WHERE event.answer_id = fixture.answer_id
     AND event.event_type = 'auto_publish'),
  1,
  'automatic publication creates one immutable audit event'
);
SELECT is(
  jsonb_array_length(
    private.phase72_public_answers_json((SELECT lecture_id FROM p725_fixture), 3)
  ),
  1,
  'bounded student projection includes the automatic answer'
);
SELECT throws_ok(
  $$INSERT INTO public.academic_answer_sources (
    answer_id, lecture_session_id, source_id, source_provider, pmid, doi,
    title, publication_year, authors, journal, publication_types,
    study_type, source_role, verification
  ) SELECT
    answer_id, lecture_id, 'doi:10.1000/unverified',
    'crossref_openalex', null, '10.1000/unverified', 'Unverified source',
    2025, '["Unknown"]'::jsonb, 'Unknown Journal',
    '["Journal Article"]'::jsonb, 'original_journal_article', 'primary',
    '{}'::jsonb
  FROM p725_fixture$$,
  '23514', null,
  'new source rows with missing verification keys fail closed'
);
SELECT lives_ok(
  $$SELECT public.admin_manage_academic_answer_publication(
    (SELECT lecture_id FROM p725_fixture),
    (SELECT answer_id FROM p725_fixture),
    'admin-session:p725', 'approve'
  )$$,
  'teacher can approve the automatic answer'
);
SELECT lives_ok(
  $$SELECT public.admin_revise_academic_answer_publication(
    (SELECT lecture_id FROM p725_fixture),
    (SELECT answer_id FROM p725_fixture),
    'admin-session:p725',
    '{"answer_points":[{"text":"教員が表現を修正しました。","source_ids":["doi:10.1080/09588221.2026.2631658"]}],"limitations":[]}'::jsonb,
    'teacher_correction'
  )$$,
  'teacher can revise while preserving claim-source mapping'
);
SELECT is(
  (SELECT review_state
   FROM public.academic_answer_publications AS publication, p725_fixture AS fixture
   WHERE publication.answer_id = fixture.answer_id),
  'admin_revised',
  'teacher revision is visibly distinguished from AI output'
);
SELECT throws_ok(
  $$SELECT public.admin_manage_academic_answer_publication(
    (SELECT other_lecture_id FROM p725_fixture),
    (SELECT answer_id FROM p725_fixture),
    'admin-session:p725', 'hide'
  )$$,
  'P0002', null,
  'unrelated lecture cannot mutate an answer'
);

SELECT is(
  public.admin_stop_lecture_summary_run(
    (SELECT lecture_id FROM p725_fixture),
    'admin-session:p725', 'admin_manual_stop'
  ) ->> 'accepted',
  'true',
  'summary and automatic-answer authorization stop through one owner action'
);
SELECT is(
  (SELECT academic_answers_enabled::text
   FROM public.lecture_ai_control AS control, p725_fixture AS fixture
   WHERE control.lecture_session_id = fixture.lecture_id),
  'false',
  'stop restores the pre-run manual academic-answer setting'
);

SELECT * FROM finish();
ROLLBACK;
