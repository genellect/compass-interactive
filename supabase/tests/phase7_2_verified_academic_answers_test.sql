BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path = public, extensions;
SELECT no_plan();

SELECT has_table('public', 'academic_answer_requests', 'academic request audit table exists');
SELECT has_table('public', 'lecture_academic_answers', 'immutable academic answer table exists');
SELECT has_table('public', 'academic_answer_sources', 'verified source metadata table exists');
SELECT has_table('public', 'academic_answer_revisions', 'academic revision table exists');
SELECT has_table('public', 'academic_answer_publications', 'academic publication state exists');
SELECT has_column('public', 'ai_usage_ledger', 'accounting_settled_at', 'ledger tracks exact-once accounting settlement');
SELECT has_column('public', 'ai_usage_ledger', 'provider_dispatched_at', 'ledger distinguishes provider dispatch');
SELECT has_column('public', 'ai_usage_ledger', 'settlement_status', 'ledger records settlement confidence');
SELECT ok(
  (SELECT bool_and(relrowsecurity) FROM pg_class WHERE oid IN (
    'public.academic_answer_requests'::regclass,
    'public.lecture_academic_answers'::regclass,
    'public.academic_answer_sources'::regclass,
    'public.academic_answer_revisions'::regclass,
    'public.academic_answer_publications'::regclass
  )),
  'all Phase 7.2 tables have RLS enabled'
);
SELECT ok(
  NOT has_table_privilege('authenticated', 'public.lecture_academic_answers', 'SELECT')
  AND NOT has_table_privilege('authenticated', 'public.academic_answer_sources', 'SELECT')
  AND NOT has_table_privilege('authenticated', 'public.academic_answer_revisions', 'SELECT'),
  'browser clients cannot bypass bounded answer projections'
);
SELECT ok(
  NOT has_function_privilege(
    'authenticated',
    'public.admin_complete_academic_answer_operation(uuid,uuid,text,jsonb,jsonb,jsonb,bigint,bigint,bigint,text)',
    'EXECUTE'
  )
  AND has_function_privilege(
    'service_role',
    'public.admin_complete_academic_answer_operation(uuid,uuid,text,jsonb,jsonb,jsonb,bigint,bigint,bigint,text)',
    'EXECUTE'
  ),
  'only the Edge service role can persist provider results'
);
SELECT ok(
  NOT (SELECT prosecdef FROM pg_proc WHERE oid =
    'public.get_lecture_public_snapshot_v6(uuid,bigint,bigint,bigint,bigint,bigint,bigint,bigint,timestamptz,uuid,integer,bigint)'::regprocedure),
  'public v6 snapshot wrapper is SECURITY INVOKER'
);
SELECT ok(
  (SELECT prosecdef AND proconfig @> ARRAY['search_path=""']
   FROM pg_proc WHERE oid =
    'private.get_lecture_public_snapshot_v6(uuid,bigint,bigint,bigint,bigint,bigint,bigint,bigint,timestamptz,uuid,integer,bigint)'::regprocedure),
  'private v6 snapshot primitive fixes an empty search path'
);
SELECT ok(
  NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename IN (
        'academic_answer_requests', 'lecture_academic_answers',
        'academic_answer_sources', 'academic_answer_revisions',
        'academic_answer_publications'
      )
  ),
  'Phase 7.2 creates no Realtime fanout'
);
SELECT ok(
  to_regclass('public.ai_usage_ledger_unsettled_idx') IS NOT NULL
  AND to_regclass('public.academic_answer_publications_public_idx') IS NOT NULL
  AND to_regclass('public.academic_answer_requests_lease_idx') IS NOT NULL,
  'unsettled, public answer and stale-request lookups are indexed'
);
SELECT ok(
  EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'compass-phase7-2-academic-reaper'),
  'stale billed operations are recoverable even when browsers are closed'
);
SELECT ok(
  private.phase72_answer_body_is_valid(
    '{"answer_points":[{"text":"Supported claim","source_ids":["pmid:26551272"]}],"limitations":[]}'::jsonb
  ),
  'bounded claim-source body is accepted'
);
SELECT ok(
  NOT private.phase72_answer_body_is_valid(
    '{"answer_points":[{"text":"Unsupported claim","source_ids":[]}],"limitations":[]}'::jsonb
  ),
  'claim without a source is rejected'
);

CREATE TEMP TABLE phase72_fixture (
  lecture_id uuid,
  late_lecture_id uuid,
  other_lecture_id uuid,
  participant_id uuid,
  request_id uuid,
  operation_id uuid,
  answer_id uuid,
  late_request_id uuid,
  late_operation_id uuid,
  grant_id uuid,
  result jsonb
);
GRANT SELECT, INSERT, UPDATE ON phase72_fixture TO service_role, authenticated;
INSERT INTO phase72_fixture DEFAULT VALUES;

SET LOCAL ROLE service_role;
UPDATE phase72_fixture SET
  lecture_id = public.admin_create_lecture(
    'Phase 7.2 evidence answer',
    encode(extensions.digest(convert_to('720001', 'UTF8'), 'sha256'), 'hex'),
    '720001', null, null
  ),
  late_lecture_id = public.admin_create_lecture(
    'Phase 7.2 late result',
    encode(extensions.digest(convert_to('720002', 'UTF8'), 'sha256'), 'hex'),
    '720002', null, null
  ),
  other_lecture_id = public.admin_create_lecture(
    'Phase 7.2 unrelated',
    encode(extensions.digest(convert_to('720003', 'UTF8'), 'sha256'), 'hex'),
    '720003', null, null
  );
SELECT ok(public.admin_set_lecture_status((SELECT lecture_id FROM phase72_fixture), 'start', null), 'primary fixture starts');
SELECT ok(public.admin_set_lecture_status((SELECT late_lecture_id FROM phase72_fixture), 'start', null), 'late-result fixture starts');
SELECT ok(public.admin_set_lecture_status((SELECT other_lecture_id FROM phase72_fixture), 'start', null), 'unrelated fixture starts');

SELECT lives_ok(
  $$SELECT public.admin_configure_lecture_ai_control(
    (SELECT lecture_id FROM phase72_fixture),
    jsonb_build_object(
      'academic_answers_enabled', true,
      'academic_answer_limit', 1,
      'budget_limit_microusd', 2500000,
      'input_token_limit', 200000,
      'output_token_limit', 50000,
      'max_concurrent_operations', 1
    ),
    'admin-session:phase72'
  )$$,
  'primary lecture enables the bounded Batch feature'
);
SELECT lives_ok(
  $$SELECT public.admin_configure_lecture_ai_control(
    (SELECT late_lecture_id FROM phase72_fixture),
    jsonb_build_object(
      'academic_answers_enabled', true,
      'academic_answer_limit', 3,
      'budget_limit_microusd', 2500000,
      'input_token_limit', 200000,
      'output_token_limit', 50000,
      'max_concurrent_operations', 1
    ),
    'admin-session:phase72'
  )$$,
  'late-result lecture enables the bounded Batch feature'
);

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '47200000-0000-4000-8000-000000000001', true);
UPDATE phase72_fixture SET participant_id = (
  SELECT participant_id FROM public.join_lecture_by_code('720001')
);
RESET ROLE;

SET LOCAL ROLE service_role;
UPDATE phase72_fixture SET result = public.admin_prepare_academic_answer_request(
  lecture_id, 'admin-session:phase72', 'phase72-request-one',
  'teacher_selected', null,
  '集中的な血圧管理にはどのような利益と注意点がありますか？',
  repeat('a', 64), repeat('b', 64)
);
UPDATE phase72_fixture SET request_id = (result #>> '{request,id}')::uuid;
SELECT is((SELECT result ->> 'idempotent_replay' FROM phase72_fixture), 'false', 'first request is admitted once');
SELECT is(
  public.admin_prepare_academic_answer_request(
    (SELECT lecture_id FROM phase72_fixture), 'admin-session:phase72',
    'phase72-request-one', 'teacher_selected', null,
    '集中的な血圧管理にはどのような利益と注意点がありますか？',
    repeat('a', 64), repeat('b', 64)
  ) ->> 'idempotent_replay',
  'true',
  'same request replays idempotently'
);
SELECT throws_ok(
  $$SELECT public.admin_prepare_academic_answer_request(
    (SELECT lecture_id FROM phase72_fixture), 'admin-session:phase72',
    'phase72-request-one', 'teacher_selected', null,
    '異なる質問を同じ識別子で送信することはできませんか？',
    repeat('c', 64), repeat('b', 64)
  )$$,
  '22023', null,
  'idempotency-key mismatch fails closed'
);

UPDATE phase72_fixture SET result = public.admin_issue_ai_billing_grant(
  lecture_id, ARRAY['academic_answers'], repeat('d', 64), true,
  'admin-session:phase72'
);
UPDATE phase72_fixture SET grant_id = (result ->> 'grant_id')::uuid;
UPDATE phase72_fixture SET result = public.admin_start_academic_answer_operation(
  request_id, grant_id, repeat('d', 64), 'admin-session:phase72',
  'gpt-5.6-luna', 'phase7-2-academic-v1', repeat('e', 64),
  1, 1, 10000, 5000, 1000, 1000000, 6000000
);
UPDATE phase72_fixture SET operation_id = (result #>> '{operations,0,operation,id}')::uuid;
SELECT is((SELECT result ->> 'accepted' FROM phase72_fixture), 'true', 'PIN grant starts one academic Batch operation');
SELECT is(
  (SELECT academic_answer_calls_used FROM public.lecture_ai_control AS control, phase72_fixture AS fixture WHERE control.lecture_session_id = fixture.lecture_id),
  1,
  'call limit is consumed exactly once before provider traffic'
);
SELECT is(
  (SELECT used_microusd FROM public.lecture_ai_control AS control, phase72_fixture AS fixture WHERE control.lecture_session_id = fixture.lecture_id),
  10000::bigint,
  'estimated cost is reserved before provider traffic'
);
SELECT ok(
  public.admin_mark_academic_provider_dispatched(
    (SELECT request_id FROM phase72_fixture),
    (SELECT operation_id FROM phase72_fixture),
    'admin-session:phase72'
  ),
  'provider dispatch is explicitly audited'
);

UPDATE phase72_fixture SET result = public.admin_complete_academic_answer_operation(
  request_id, operation_id, 'admin-session:phase72',
  jsonb_build_array(jsonb_build_object(
    'source_id', 'pmid:26551272', 'pmid', '26551272',
    'doi', '10.1056/NEJMoa1511939',
    'title', 'A Randomized Trial of Intensive versus Standard Blood-Pressure Control',
    'publication_year', 2015,
    'authors', jsonb_build_array('SPRINT Research Group'),
    'journal', 'New England Journal of Medicine',
    'publication_types', jsonb_build_array('Randomized Controlled Trial'),
    'study_type', 'randomized_controlled_trial', 'source_role', 'primary',
    'verification', jsonb_build_object('passed', true, 'pubmed', true, 'crossref', true)
  )),
  '{"answer_points":[{"text":"集中的な管理では主要な心血管イベントが少ない一方、一部の有害事象は多く報告されました。","source_ids":["pmid:26551272"]}],"limitations":["糖尿病患者は対象外です。"]}'::jsonb,
  '{"identifier_validity":1,"mapped_claim_fraction":1,"primary_source_count":1}'::jsonb,
  8000, 2000, 1000, 'response-phase72'
);
UPDATE phase72_fixture SET answer_id = (
  SELECT id FROM public.lecture_academic_answers WHERE operation_id = phase72_fixture.operation_id
);
SELECT is((SELECT result ->> 'accepted' FROM phase72_fixture), 'true', 'verified provider result is accepted while lecture is open');
SELECT is((SELECT result ->> 'result_saved' FROM phase72_fixture), 'true', 'accepted result persists an immutable hidden draft');
SELECT is(
  (SELECT prompt_version FROM public.lecture_academic_answers AS answer, phase72_fixture AS fixture WHERE answer.id = fixture.answer_id),
  'phase7-2-academic-v1',
  'the admitted prompt version is preserved in the answer audit record'
);
SELECT is(
  (SELECT used_microusd FROM public.lecture_ai_control AS control, phase72_fixture AS fixture WHERE control.lecture_session_id = fixture.lecture_id),
  8000::bigint,
  'actual usage replaces rather than adds to the reservation'
);
SELECT is(
  (SELECT settlement_status FROM public.ai_usage_ledger AS usage, phase72_fixture AS fixture WHERE usage.id = fixture.operation_id),
  'actual',
  'successful provider usage settles exactly once'
);
SELECT is(
  jsonb_array_length(private.phase72_public_answers_json((SELECT lecture_id FROM phase72_fixture), 3)),
  0,
  'unreviewed draft is invisible to students'
);
SELECT is(
  public.admin_complete_academic_answer_operation(
    (SELECT request_id FROM phase72_fixture),
    (SELECT operation_id FROM phase72_fixture), 'admin-session:phase72',
    '[]'::jsonb, '{}'::jsonb, '{}'::jsonb, 999999, 999999, 999999, 'replay'
  ) ->> 'idempotent_replay',
  'true',
  'completion retry cannot double-charge or rewrite evidence'
);

SELECT lives_ok(
  $$SELECT public.admin_manage_academic_answer_publication(
    (SELECT lecture_id FROM phase72_fixture),
    (SELECT answer_id FROM phase72_fixture),
    'admin-session:phase72', 'approve'
  )$$,
  'teacher approval publishes the verified draft'
);
SELECT is(
  jsonb_array_length(private.phase72_public_answers_json((SELECT lecture_id FROM phase72_fixture), 3)),
  1,
  'approved answer becomes visible through the bounded projection'
);
SELECT lives_ok(
  $$SELECT public.admin_manage_academic_answer_publication(
    (SELECT lecture_id FROM phase72_fixture),
    (SELECT answer_id FROM phase72_fixture),
    'admin-session:phase72', 'hide'
  )$$,
  'teacher can hide a published answer without a PIN'
);
SELECT is(
  jsonb_array_length(private.phase72_public_answers_json((SELECT lecture_id FROM phase72_fixture), 3)),
  0,
  'hidden answer immediately leaves the student projection'
);
SELECT lives_ok(
  $$SELECT public.admin_manage_academic_answer_publication(
    (SELECT lecture_id FROM phase72_fixture),
    (SELECT answer_id FROM phase72_fixture),
    'admin-session:phase72', 'approve'
  )$$,
  'a previously reviewed hidden answer can be republished'
);
SELECT throws_ok(
  $$SELECT public.admin_manage_academic_answer_publication(
    (SELECT other_lecture_id FROM phase72_fixture),
    (SELECT answer_id FROM phase72_fixture),
    'admin-session:phase72', 'hide'
  )$$,
  'P0002', null,
  'an unrelated lecture cannot mutate the answer'
);

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '47200000-0000-4000-8000-000000000001', true);
UPDATE phase72_fixture SET result = public.get_lecture_public_snapshot_v6(lecture_id);
SELECT is(
  jsonb_array_length((SELECT result #> '{changed,academic_answers}' FROM phase72_fixture)),
  1,
  'joined student receives the approved answer in the existing summary snapshot'
);
SELECT set_config('request.jwt.claim.sub', '47200000-0000-4000-8000-000000000099', true);
SELECT is(
  public.get_lecture_public_snapshot_v6((SELECT lecture_id FROM phase72_fixture)),
  null,
  'unrelated authenticated user cannot read the lecture snapshot'
);
RESET ROLE;

SET LOCAL ROLE service_role;
UPDATE phase72_fixture SET result = public.admin_prepare_academic_answer_request(
  lecture_id, 'admin-session:phase72', 'phase72-limit-two',
  'teacher_selected', null,
  '二件目の高価な回答は上限で拒否されますか？', repeat('f', 64), repeat('1', 64)
);
UPDATE phase72_fixture SET request_id = (result #>> '{request,id}')::uuid;
UPDATE phase72_fixture SET result = public.admin_issue_ai_billing_grant(
  lecture_id, ARRAY['academic_answers'], repeat('2', 64), true, 'admin-session:phase72'
);
UPDATE phase72_fixture SET grant_id = (result ->> 'grant_id')::uuid;
UPDATE phase72_fixture SET result = public.admin_start_academic_answer_operation(
  request_id, grant_id, repeat('2', 64), 'admin-session:phase72',
  'gpt-5.6-luna', 'phase7-2-academic-v1', repeat('3', 64),
  1, 1, 10000, 5000, 1000, 1000000, 6000000
);
SELECT is((SELECT result ->> 'reason' FROM phase72_fixture), 'academic_answer_limit', 'second paid call is rejected at the lecture limit');
SELECT is(
  (SELECT count(*)::integer FROM public.ai_usage_ledger AS usage, phase72_fixture AS fixture WHERE usage.lecture_session_id = fixture.lecture_id AND usage.feature = 'academic_answers'),
  1,
  'limit rejection creates no duplicate ledger operation'
);

UPDATE phase72_fixture SET result = public.admin_prepare_academic_answer_request(
  late_lecture_id, 'admin-session:phase72', 'phase72-late-one',
  'teacher_selected', null,
  '講義終了後に遅れて届いた回答は公開されませんか？', repeat('4', 64), repeat('5', 64)
);
UPDATE phase72_fixture SET late_request_id = (result #>> '{request,id}')::uuid;
UPDATE phase72_fixture SET result = public.admin_issue_ai_billing_grant(
  late_lecture_id, ARRAY['academic_answers'], repeat('6', 64), true, 'admin-session:phase72'
);
UPDATE phase72_fixture SET grant_id = (result ->> 'grant_id')::uuid;
UPDATE phase72_fixture SET result = public.admin_start_academic_answer_operation(
  late_request_id, grant_id, repeat('6', 64), 'admin-session:phase72',
  'gpt-5.6-luna', 'phase7-2-academic-v1', repeat('7', 64),
  1, 1, 10000, 5000, 1000, 1000000, 6000000
);
UPDATE phase72_fixture SET late_operation_id = (result #>> '{operations,0,operation,id}')::uuid;
SELECT public.admin_mark_academic_provider_dispatched(
  (SELECT late_request_id FROM phase72_fixture),
  (SELECT late_operation_id FROM phase72_fixture), 'admin-session:phase72'
);
SELECT ok(public.admin_set_lecture_status((SELECT late_lecture_id FROM phase72_fixture), 'close', null), 'lecture closes while provider work is in flight');
UPDATE phase72_fixture SET result = public.admin_complete_academic_answer_operation(
  late_request_id, late_operation_id, 'admin-session:phase72',
  jsonb_build_array(jsonb_build_object(
    'source_id', 'pmid:26551272', 'pmid', '26551272',
    'doi', '10.1056/NEJMoa1511939', 'title', 'A Randomized Trial of Intensive versus Standard Blood-Pressure Control',
    'publication_year', 2015, 'authors', jsonb_build_array('SPRINT Research Group'),
    'journal', 'New England Journal of Medicine',
    'publication_types', jsonb_build_array('Randomized Controlled Trial'),
    'study_type', 'randomized_controlled_trial', 'source_role', 'primary',
    'verification', jsonb_build_object('passed', true)
  )),
  '{"answer_points":[{"text":"Late result","source_ids":["pmid:26551272"]}],"limitations":[]}'::jsonb,
  '{"identifier_validity":1}'::jsonb, 7000, 1800, 700, 'response-late'
);
SELECT is((SELECT result ->> 'accepted' FROM phase72_fixture), 'false', 'late result is rejected after canonical lecture close');
SELECT is((SELECT result ->> 'result_saved' FROM phase72_fixture), 'false', 'late result persists no answer content');
SELECT is(
  (SELECT count(*)::integer FROM public.lecture_academic_answers AS answer, phase72_fixture AS fixture WHERE answer.lecture_session_id = fixture.late_lecture_id),
  0,
  'late result is invisible because no answer row is stored'
);
SELECT is(
  (SELECT actual_microusd FROM public.ai_usage_ledger AS usage, phase72_fixture AS fixture WHERE usage.id = fixture.late_operation_id),
  7000::bigint,
  'late provider usage is still settled for budget audit'
);

SELECT ok(public.admin_set_lecture_status((SELECT lecture_id FROM phase72_fixture), 'close', null), 'primary lecture closes after publication');
SELECT throws_ok(
  $$SELECT public.admin_prepare_academic_answer_request(
    (SELECT lecture_id FROM phase72_fixture), 'admin-session:phase72',
    'phase72-after-close', 'teacher_selected', null,
    '終了後には新しい学術回答を開始できませんか？', repeat('8', 64), repeat('9', 64)
  )$$,
  'P0001', null,
  'closed lecture rejects a new academic request'
);
SELECT throws_ok(
  $$SELECT public.admin_manage_academic_answer_publication(
    (SELECT lecture_id FROM phase72_fixture),
    (SELECT answer_id FROM phase72_fixture), 'admin-session:phase72', 'hide'
  )$$,
  'P0001', null,
  'closed lecture rejects publication mutations'
);

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '47200000-0000-4000-8000-000000000001', true);
UPDATE phase72_fixture SET result = public.get_lecture_archive_v4(lecture_id);
SELECT is(
  jsonb_array_length((SELECT result -> 'academic_answers' FROM phase72_fixture)),
  1,
  '30-day immediate archive includes only the approved academic answer'
);
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
