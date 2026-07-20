BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path = public, extensions;
SELECT no_plan();

SELECT has_table('public', 'lecture_academic_answers', 'Phase 7.2 answer table exists after upgrade');
SELECT is(
  (SELECT usage.status FROM public.ai_usage_ledger AS usage
   JOIN public.phase72_upgrade_fixture AS fixture ON fixture.operation_id = usage.id),
  'succeeded',
  'pre-Phase 7.2 operation status survives upgrade'
);
SELECT is(
  (SELECT usage.provider_request_id FROM public.ai_usage_ledger AS usage
   JOIN public.phase72_upgrade_fixture AS fixture ON fixture.operation_id = usage.id),
  'provider-before-phase72',
  'pre-Phase 7.2 provider audit identifier survives upgrade'
);
SELECT is(
  (SELECT usage.settlement_status FROM public.ai_usage_ledger AS usage
   JOIN public.phase72_upgrade_fixture AS fixture ON fixture.operation_id = usage.id),
  'legacy_reserved',
  'historical terminal operations are marked without rewriting cost history'
);
SELECT ok(
  (SELECT usage.accounting_settled_at IS NOT NULL
   FROM public.ai_usage_ledger AS usage
   JOIN public.phase72_upgrade_fixture AS fixture ON fixture.operation_id = usage.id),
  'historical terminal operation is not re-settled later'
);
SELECT is(
  (SELECT control.used_microusd FROM public.lecture_ai_control AS control
   JOIN public.phase72_upgrade_fixture AS fixture ON fixture.lecture_id = control.lecture_session_id),
  (SELECT used_microusd FROM public.phase72_upgrade_fixture),
  'upgrade preserves historical micro-USD accounting'
);
SELECT is(
  (SELECT control.input_tokens_used FROM public.lecture_ai_control AS control
   JOIN public.phase72_upgrade_fixture AS fixture ON fixture.lecture_id = control.lecture_session_id),
  (SELECT input_tokens_used FROM public.phase72_upgrade_fixture),
  'upgrade preserves historical token accounting'
);
SELECT is(
  (SELECT count(*)::integer FROM public.lecture_academic_answers),
  0,
  'migration invents no paid academic answer'
);
SELECT ok(
  to_regprocedure('public.get_lecture_public_snapshot_v5(uuid,bigint,bigint,bigint,bigint,bigint,bigint,bigint,timestamp with time zone,uuid,integer,bigint)') IS NOT NULL
  AND to_regprocedure('public.get_lecture_comment_history_v3(uuid,timestamp with time zone,uuid,integer,text)') IS NOT NULL,
  'Phase 6.8 and 7.1 browser contracts remain available'
);

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '47209900-0000-4000-8000-000000000001', true);
SELECT is(
  (SELECT count(*)::integer FROM public.comments AS comment
   JOIN public.phase72_upgrade_fixture AS fixture ON fixture.lecture_id = comment.lecture_session_id),
  1,
  'existing participant keeps access to the existing lecture comment'
);
SELECT set_config('request.jwt.claim.sub', '47209900-0000-4000-8000-000000000099', true);
SELECT is(
  (SELECT count(*)::integer FROM public.comments AS comment
   JOIN public.phase72_upgrade_fixture AS fixture ON fixture.lecture_id = comment.lecture_session_id),
  0,
  'unrelated authenticated user no longer receives direct compatibility reads'
);
RESET ROLE;

SET LOCAL ROLE service_role;
SELECT lives_ok(
  $$SELECT public.admin_prepare_academic_answer_request(
    (SELECT lecture_id FROM public.phase72_upgrade_fixture),
    'admin-session:phase72-upgrade', 'phase72-upgrade-new-request',
    'teacher_selected', null,
    '既存講義でも新しい学術回答機能を安全に準備できますか？',
    repeat('a', 64), repeat('b', 64)
  )$$,
  'existing open lecture can use the new request primitive after upgrade'
);
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
