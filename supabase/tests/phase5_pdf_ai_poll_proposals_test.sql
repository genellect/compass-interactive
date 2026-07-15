BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path = public, extensions;
SELECT no_plan();

SELECT has_table('public', 'material_ai_operation_contexts', 'Phase 5 operation contexts exist');
SELECT has_table('public', 'lecture_material_analyses', 'material analysis table exists');
SELECT has_table('public', 'ai_poll_proposals', 'AI Poll proposal table exists');

SELECT ok(
  (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.material_ai_operation_contexts'::regclass),
  'operation contexts have RLS enabled'
);
SELECT ok(
  (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.lecture_material_analyses'::regclass),
  'material analyses have RLS enabled'
);
SELECT ok(
  (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.ai_poll_proposals'::regclass),
  'Poll proposals have RLS enabled'
);

SELECT ok(
  NOT has_table_privilege('anon', 'public.lecture_material_analyses', 'SELECT'),
  'anonymous clients cannot read material analyses'
);
SELECT ok(
  NOT has_table_privilege('authenticated', 'public.lecture_material_analyses', 'SELECT'),
  'authenticated clients cannot read material analyses'
);
SELECT ok(
  NOT has_table_privilege('authenticated', 'public.ai_poll_proposals', 'SELECT'),
  'authenticated clients cannot read Poll proposals'
);
SELECT ok(
  has_table_privilege('service_role', 'public.ai_poll_proposals', 'SELECT'),
  'service role can read protected Poll proposals'
);
SELECT ok(
  NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name IN (
        'material_ai_operation_contexts',
        'lecture_material_analyses',
        'ai_poll_proposals'
      )
      AND column_name IN ('source_text', 'page_text', 'extracted_text', 'pages')
  ),
  'Supabase Phase 5 tables contain no extracted source-text column'
);

SELECT ok(
  to_regprocedure('public.admin_start_material_ai_operation(uuid,text,uuid,text,text,text,text,text,text,uuid,integer,integer,text,text,bigint,bigint,integer,bigint,bigint,bigint)') IS NOT NULL,
  'dedicated material operation start RPC exists'
);
SELECT ok(
  NOT (SELECT prosecdef FROM pg_proc WHERE oid = 'public.admin_start_material_ai_operation(uuid,text,uuid,text,text,text,text,text,text,uuid,integer,integer,text,text,bigint,bigint,integer,bigint,bigint,bigint)'::regprocedure),
  'public material start RPC is security invoker'
);
SELECT ok(
  (SELECT prosecdef FROM pg_proc WHERE oid = 'private.start_material_ai_operation(uuid,text,uuid,text,text,text,text,text,text,uuid,integer,integer,text,text,bigint,bigint,integer,bigint,bigint,bigint)'::regprocedure),
  'private material start primitive is security definer'
);
SELECT is(
  (SELECT proconfig FROM pg_proc WHERE oid = 'private.start_material_ai_operation(uuid,text,uuid,text,text,text,text,text,text,uuid,integer,integer,text,text,bigint,bigint,integer,bigint,bigint,bigint)'::regprocedure),
  ARRAY['search_path=""']::text[],
  'private material start primitive fixes an empty search path'
);
SELECT ok(
  NOT has_function_privilege(
    'authenticated',
    'public.admin_start_material_ai_operation(uuid,text,uuid,text,text,text,text,text,text,uuid,integer,integer,text,text,bigint,bigint,integer,bigint,bigint,bigint)',
    'EXECUTE'
  ),
  'browser clients cannot start material AI operations'
);
SELECT ok(
  has_function_privilege(
    'service_role',
    'public.admin_start_material_ai_operation(uuid,text,uuid,text,text,text,text,text,text,uuid,integer,integer,text,text,bigint,bigint,integer,bigint,bigint,bigint)',
    'EXECUTE'
  ),
  'service role can call the protected material start RPC'
);
SELECT ok(
  NOT has_function_privilege(
    'authenticated',
    'public.admin_adopt_poll_proposal(uuid,uuid,text,text,text,text[])',
    'EXECUTE'
  ),
  'browser clients cannot adopt AI proposals directly'
);
SELECT ok(
  to_regclass('public.ai_poll_proposals_lecture_status_created_idx') IS NOT NULL,
  'proposal review lookup is indexed'
);
SELECT ok(
  to_regclass('public.material_ai_operation_contexts_lecture_created_idx') IS NOT NULL,
  'material operation lecture lookup is indexed'
);

CREATE TEMP TABLE p5_fixture (
  lecture_id uuid,
  unrelated_lecture_id uuid,
  grant_id uuid,
  operation_id uuid,
  analysis_id uuid,
  adopted_proposal_id uuid,
  rejected_proposal_id uuid,
  adopted_poll_id uuid,
  result jsonb,
  proposal_count integer
);
GRANT SELECT, INSERT, UPDATE ON p5_fixture TO service_role, authenticated;
INSERT INTO p5_fixture DEFAULT VALUES;

SET LOCAL ROLE service_role;
UPDATE p5_fixture SET
  lecture_id = public.admin_create_lecture(
    'Phase 5 material lecture',
    encode(extensions.digest(convert_to('P5-MATERIAL', 'UTF8'), 'sha256'), 'hex'),
    'P5-MATERIAL', null, null
  ),
  unrelated_lecture_id = public.admin_create_lecture(
    'Unrelated Phase 5 lecture',
    encode(extensions.digest(convert_to('P5-OTHER', 'UTF8'), 'sha256'), 'hex'),
    'P5-OTHER', null, null
  );
SELECT ok(
  public.admin_set_lecture_status((SELECT lecture_id FROM p5_fixture), 'start', null),
  'Phase 5 lecture starts'
);
SELECT ok(
  public.admin_set_lecture_status((SELECT unrelated_lecture_id FROM p5_fixture), 'start', null),
  'unrelated lecture starts'
);
SELECT lives_ok(
  $$SELECT public.admin_register_pdf_document(
    (SELECT lecture_id FROM p5_fixture),
    'doc-main', repeat('a', 64), 1, 'Phase 5 material', 3, 3000, 300,
    repeat('a', 64), repeat('b', 64), true
  )$$,
  'content-free PDF metadata is registered'
);
SELECT lives_ok(
  $$SELECT public.admin_configure_lecture_ai_control(
    (SELECT lecture_id FROM p5_fixture),
    jsonb_build_object(
      'material_analysis_enabled', true,
      'poll_suggestions_enabled', true,
      'material_analysis_call_limit', 1,
      'poll_generation_limit', 5,
      'budget_limit_microusd', 2500000,
      'input_token_limit', 200000,
      'output_token_limit', 30000,
      'max_concurrent_operations', 2
    ),
    'admin-session:p5'
  )$$,
  'Phase 5 control limits are configured'
);

UPDATE p5_fixture SET grant_id = (
  public.admin_issue_ai_billing_grant(
    lecture_id,
    ARRAY['material_analysis'],
    repeat('c', 64), true, 'admin-session:p5'
  ) ->> 'grant_id'
)::uuid;
UPDATE p5_fixture SET result = public.admin_start_material_ai_operation(
  grant_id, repeat('c', 64), lecture_id,
  'material_analysis', 'phase5-initial-material', 'admin-session:p5',
  'doc-main', repeat('a', 64), repeat('b', 64),
  null, null, null,
  'gpt-5.6-luna', 'phase5-material-v1',
  1000000, 6000000, 4000,
  1600, 1000, 100
);
UPDATE p5_fixture
SET operation_id = (result #>> '{operations,0,operation,id}')::uuid;
SELECT is(
  (SELECT result ->> 'accepted' FROM p5_fixture),
  'true',
  'initial material analysis reserves the Batch lane'
);
SELECT is(
  (SELECT billing_grant.status FROM public.ai_billing_grants AS billing_grant, p5_fixture WHERE billing_grant.id = p5_fixture.grant_id),
  'consumed',
  'material Billing grant is consumed once'
);
SELECT is(
  (SELECT count(*)::integer FROM public.material_ai_operation_contexts AS context, p5_fixture
   WHERE context.operation_id = p5_fixture.operation_id),
  1,
  'operation context is committed atomically with usage reservation'
);
SELECT is(
  (SELECT context.source_text_sha256 FROM public.material_ai_operation_contexts AS context, p5_fixture
   WHERE context.operation_id = p5_fixture.operation_id),
  repeat('b', 64),
  'operation context is bound to immutable extraction hash'
);

SELECT throws_ok(
  $$SELECT public.admin_complete_material_ai_operation(
    (SELECT operation_id FROM p5_fixture), 'admin-session:other',
    '{}'::jsonb, 0, 0, 0, null
  )$$,
  '42501',
  'material AI operation is not owned by this actor',
  'wrong actor cannot complete another Admin session operation'
);

UPDATE p5_fixture SET result = public.admin_complete_material_ai_operation(
  operation_id,
  'admin-session:p5',
  jsonb_build_object(
    'analysis', jsonb_build_object(
      'outline', jsonb_build_array(jsonb_build_object(
        'pageStart', 1, 'pageEnd', 3, 'title', 'Study overview'
      )),
      'summary', 'A concise evidence-grounded material summary.',
      'keyTerms', jsonb_build_array(jsonb_build_object(
        'term', 'control group', 'definition', 'comparison group'
      )),
      'importantPages', jsonb_build_array(1, 2, 3),
      'sectionBoundaries', jsonb_build_array(jsonb_build_object(
        'pageStart', 1, 'pageEnd', 3, 'title', 'Study',
        'rationale', 'The pages form one study narrative.'
      ))
    ),
    'proposals', jsonb_build_array(
      jsonb_build_object(
        'type', 'single_choice', 'stem', 'Which interpretation best matches page one evidence?',
        'options', jsonb_build_array(
          jsonb_build_object('id', 'a', 'text', 'Grounded answer'),
          jsonb_build_object('id', 'b', 'text', 'Unsupported answer')
        ),
        'correctOptionIds', jsonb_build_array('a'),
        'explanation', 'The grounded answer follows the cited page.',
        'learningObjective', 'Distinguish grounded from unsupported interpretation.',
        'misconceptionTarget', null,
        'difficulty', 'intermediate',
        'evidencePages', jsonb_build_array(1),
        'evidenceExcerptIds', jsonb_build_array(repeat('1', 64)),
        'educationalValue', 'Checks evidence reading.', 'qualityScore', 0.9
      ),
      jsonb_build_object(
        'type', 'multiple_choice', 'stem', 'Which features are supported by page two evidence?',
        'options', jsonb_build_array(
          jsonb_build_object('id', 'a', 'text', 'Supported feature one'),
          jsonb_build_object('id', 'b', 'text', 'Supported feature two'),
          jsonb_build_object('id', 'c', 'text', 'Unsupported feature')
        ),
        'correctOptionIds', jsonb_build_array('a', 'b'),
        'explanation', 'Two features appear in the cited evidence.',
        'learningObjective', 'Identify multiple supported features.',
        'misconceptionTarget', 'Selecting one feature only.',
        'difficulty', 'advanced',
        'evidencePages', jsonb_build_array(2),
        'evidenceExcerptIds', jsonb_build_array(repeat('2', 64)),
        'educationalValue', 'Promotes close reading.', 'qualityScore', 0.92
      ),
      jsonb_build_object(
        'type', 'discussion', 'stem', 'How should the limitation on page three change interpretation?',
        'options', '[]'::jsonb,
        'correctOptionIds', '[]'::jsonb,
        'explanation', 'Discussion should connect the limitation to inference.',
        'learningObjective', 'Explain how limitations constrain inference.',
        'misconceptionTarget', null,
        'difficulty', 'intermediate',
        'evidencePages', jsonb_build_array(3),
        'evidenceExcerptIds', jsonb_build_array(repeat('3', 64)),
        'educationalValue', 'Supports critical appraisal.', 'qualityScore', 0.95
      )
    )
  ),
  1600, 1000, 100, 'resp-phase5-initial'
);
UPDATE p5_fixture SET
  analysis_id = (result #>> '{results,analysis,id}')::uuid,
  adopted_proposal_id = (result #>> '{results,proposals,0,id}')::uuid,
  rejected_proposal_id = (result #>> '{results,proposals,1,id}')::uuid,
  proposal_count = jsonb_array_length(result #> '{results,proposals}');
SELECT is(
  (SELECT result ->> 'accepted' FROM p5_fixture),
  'true',
  'valid provider result is accepted while lecture remains open'
);
SELECT is(
  (SELECT result ->> 'result_saved' FROM p5_fixture),
  'true',
  'analysis and Poll drafts are saved atomically with completion'
);
SELECT is(
  (SELECT usage.status FROM public.ai_usage_ledger AS usage, p5_fixture WHERE usage.id = p5_fixture.operation_id),
  'succeeded',
  'usage ledger records successful material analysis'
);
SELECT is(
  (SELECT count(*)::integer FROM public.lecture_material_analyses AS analysis, p5_fixture
   WHERE analysis.lecture_session_id = p5_fixture.lecture_id AND analysis.status = 'active'),
  1,
  'one active material analysis is stored'
);
SELECT is(
  (SELECT count(*)::integer FROM public.ai_poll_proposals AS proposal, p5_fixture
   WHERE proposal.lecture_session_id = p5_fixture.lecture_id),
  3,
  'initial analysis stores three Admin-only Poll proposals'
);

SELECT lives_ok(
  $$SELECT public.admin_complete_material_ai_operation(
    (SELECT operation_id FROM p5_fixture), 'admin-session:p5',
    '{}'::jsonb, 1600, 1000, 100, 'resp-phase5-initial'
  )$$,
  'completion replay is idempotent'
);
SELECT is(
  (SELECT count(*)::integer FROM public.ai_poll_proposals AS proposal, p5_fixture
   WHERE proposal.lecture_session_id = p5_fixture.lecture_id),
  3,
  'completion replay does not duplicate proposals'
);

SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $$SELECT * FROM public.ai_poll_proposals$$,
  '42501', null,
  'student cannot read Admin-only AI proposals'
);
SELECT throws_ok(
  $$SELECT public.admin_list_material_ai_results((SELECT lecture_id FROM p5_fixture))$$,
  '42501', null,
  'student cannot execute Admin-only material result RPC'
);

SET LOCAL ROLE service_role;
UPDATE p5_fixture SET adopted_poll_id = public.admin_adopt_poll_proposal(
  lecture_id,
  adopted_proposal_id,
  'admin-session:p5-reviewer',
  'Edited teacher-approved question for the ordinary Poll draft',
  'single',
  ARRAY['Teacher-approved option A', 'Teacher-approved option B']
);
SELECT is(
  (SELECT poll.status FROM public.polls AS poll, p5_fixture WHERE poll.id = p5_fixture.adopted_poll_id),
  'draft',
  'adoption creates an ordinary Poll in draft state only'
);
SELECT is(
  (SELECT proposal.status FROM public.ai_poll_proposals AS proposal, p5_fixture
   WHERE proposal.id = p5_fixture.adopted_proposal_id),
  'adopted',
  'adopted proposal records its review state'
);
SELECT is(
  public.admin_adopt_poll_proposal(
    (SELECT lecture_id FROM p5_fixture),
    (SELECT adopted_proposal_id FROM p5_fixture),
    'admin-session:p5-reviewer',
    'Edited teacher-approved question for the ordinary Poll draft',
    'single', ARRAY['Teacher-approved option A', 'Teacher-approved option B']
  ),
  (SELECT adopted_poll_id FROM p5_fixture),
  'adoption retry returns the same Poll id'
);
SELECT ok(
  public.admin_reject_poll_proposal(
    (SELECT lecture_id FROM p5_fixture),
    (SELECT rejected_proposal_id FROM p5_fixture),
    'admin-session:p5-reviewer'
  ),
  'teacher can reject a draft proposal'
);
SELECT ok(
  public.admin_reject_poll_proposal(
    (SELECT lecture_id FROM p5_fixture),
    (SELECT rejected_proposal_id FROM p5_fixture),
    'admin-session:p5-reviewer'
  ),
  'proposal rejection is idempotent'
);
SELECT throws_ok(
  $$SELECT public.admin_adopt_poll_proposal(
    (SELECT unrelated_lecture_id FROM p5_fixture),
    (SELECT adopted_proposal_id FROM p5_fixture),
    'admin-session:p5-reviewer',
    'A different lecture must not adopt this proposal',
    'single', ARRAY['A', 'B']
  )$$,
  'P0002',
  'Poll proposal not found',
  'unrelated lecture cannot adopt a proposal'
);

UPDATE p5_fixture SET grant_id = (
  public.admin_issue_ai_billing_grant(
    lecture_id,
    ARRAY['poll_suggestions'],
    repeat('d', 64), true, 'admin-session:p5'
  ) ->> 'grant_id'
)::uuid;
UPDATE p5_fixture SET result = public.admin_start_material_ai_operation(
  grant_id, repeat('d', 64), lecture_id,
  'poll_suggestions', 'phase5-extra-polls-one', 'admin-session:p5',
  'doc-main', repeat('a', 64), repeat('b', 64),
  analysis_id, 2, 3,
  'gpt-5.6-luna', 'phase5-material-v1',
  1000000, 6000000, 2500,
  1300, 1000, 50
);
UPDATE p5_fixture
SET operation_id = (result #>> '{operations,0,operation,id}')::uuid;
SELECT is(
  (SELECT context.requested_page_start FROM public.material_ai_operation_contexts AS context, p5_fixture
   WHERE context.operation_id = p5_fixture.operation_id),
  2,
  'additional proposal call is bound to explicit page start'
);
SELECT is(
  (SELECT context.requested_page_end FROM public.material_ai_operation_contexts AS context, p5_fixture
   WHERE context.operation_id = p5_fixture.operation_id),
  3,
  'additional proposal call is bound to explicit page end'
);
UPDATE p5_fixture SET result = public.admin_complete_material_ai_operation(
  operation_id,
  'admin-session:p5',
  jsonb_build_object(
    'proposals', jsonb_build_array(jsonb_build_object(
      'type', 'single_choice',
      'stem', 'Which additional conclusion is supported by pages two and three?',
      'options', jsonb_build_array(
        jsonb_build_object('id', 'a', 'text', 'Supported conclusion'),
        jsonb_build_object('id', 'b', 'text', 'Unsupported conclusion')
      ),
      'correctOptionIds', jsonb_build_array('a'),
      'explanation', 'The cited pages support option A.',
      'learningObjective', 'Integrate evidence across selected pages.',
      'misconceptionTarget', null,
      'difficulty', 'advanced',
      'evidencePages', jsonb_build_array(2, 3),
      'evidenceExcerptIds', jsonb_build_array(repeat('2', 64), repeat('3', 64)),
      'educationalValue', 'Promotes synthesis.', 'qualityScore', 0.93
    ))
  ),
  1300, 1000, 50, 'resp-phase5-extra'
);
SELECT is(
  (SELECT count(*)::integer FROM public.ai_poll_proposals AS proposal, p5_fixture
   WHERE proposal.lecture_session_id = p5_fixture.lecture_id),
  4,
  'explicit additional request appends one proposal without replacing analysis'
);

UPDATE p5_fixture SET grant_id = (
  public.admin_issue_ai_billing_grant(
    lecture_id,
    ARRAY['poll_suggestions'],
    repeat('e', 64), true, 'admin-session:p5'
  ) ->> 'grant_id'
)::uuid;
SELECT throws_ok(
  $$SELECT public.admin_start_material_ai_operation(
    (SELECT grant_id FROM p5_fixture), repeat('e', 64),
    (SELECT lecture_id FROM p5_fixture),
    'poll_suggestions', 'phase5-invalid-page-range', 'admin-session:p5',
    'doc-main', repeat('a', 64), repeat('b', 64),
    (SELECT analysis_id FROM p5_fixture), 3, 4,
    'gpt-5.6-luna', 'phase5-material-v1',
    1000000, 6000000, 2500, 1300, 1000, 50
  )$$,
  '22023',
  'additional Poll request is not bound to an active analysis',
  'page range beyond the PDF is rejected'
);
SELECT is(
  (SELECT billing_grant.status FROM public.ai_billing_grants AS billing_grant, p5_fixture WHERE billing_grant.id = p5_fixture.grant_id),
  'issued',
  'failed context validation rolls back Billing grant consumption'
);

UPDATE p5_fixture SET grant_id = (
  public.admin_issue_ai_billing_grant(
    lecture_id,
    ARRAY['poll_suggestions'],
    repeat('f', 64), true, 'admin-session:p5'
  ) ->> 'grant_id'
)::uuid;
UPDATE p5_fixture SET result = public.admin_start_material_ai_operation(
  grant_id, repeat('f', 64), lecture_id,
  'poll_suggestions', 'phase5-late-result', 'admin-session:p5',
  'doc-main', repeat('a', 64), repeat('b', 64),
  analysis_id, 1, 1,
  'gpt-5.6-luna', 'phase5-material-v1',
  1000000, 6000000, 2500, 1300, 1000, 50
);
UPDATE p5_fixture SET
  operation_id = (result #>> '{operations,0,operation,id}')::uuid,
  proposal_count = (
    SELECT count(*)::integer FROM public.ai_poll_proposals AS proposal
    WHERE proposal.lecture_session_id = p5_fixture.lecture_id
  );
SELECT ok(
  public.admin_set_lecture_status((SELECT lecture_id FROM p5_fixture), 'close', null),
  'lecture close wins over a running Phase 5 operation'
);
UPDATE p5_fixture SET result = public.admin_complete_material_ai_operation(
  operation_id,
  'admin-session:p5',
  jsonb_build_object(
    'proposals', jsonb_build_array(jsonb_build_object(
      'type', 'discussion',
      'stem', 'This late result must never become a visible proposal draft.',
      'options', '[]'::jsonb,
      'correctOptionIds', '[]'::jsonb,
      'explanation', 'Late output is discarded.',
      'learningObjective', 'Test lifecycle handling.',
      'misconceptionTarget', null,
      'difficulty', 'beginner',
      'evidencePages', jsonb_build_array(1),
      'evidenceExcerptIds', jsonb_build_array(repeat('1', 64)),
      'educationalValue', 'Lifecycle test only.', 'qualityScore', 0.99
    ))
  ),
  1300, 1000, 50, 'resp-phase5-late'
);
SELECT is(
  (SELECT result ->> 'accepted' FROM p5_fixture),
  'false',
  'late provider result is not accepted after lecture close'
);
SELECT is(
  (SELECT count(*)::integer FROM public.ai_poll_proposals AS proposal, p5_fixture
   WHERE proposal.lecture_session_id = p5_fixture.lecture_id),
  (SELECT proposal_count FROM p5_fixture),
  'late result does not append proposals'
);
SELECT is(
  (SELECT count(*)::integer FROM public.ai_poll_proposals AS proposal, p5_fixture
   WHERE proposal.lecture_session_id = p5_fixture.lecture_id AND proposal.status = 'draft'),
  0,
  'lecture close expires every remaining unreviewed proposal'
);
SELECT is(
  (SELECT poll.status FROM public.polls AS poll, p5_fixture WHERE poll.id = p5_fixture.adopted_poll_id),
  'draft',
  'adopted ordinary Poll remains an unbroadcast draft after lecture close'
);

SELECT * FROM finish();
ROLLBACK;
