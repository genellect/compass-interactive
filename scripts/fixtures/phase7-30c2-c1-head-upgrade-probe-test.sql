begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select no_plan();

select ok(
  exists (
    select 1
    from public.lecture_sessions
    where id = '73032000-0000-4000-8000-000000000001'::uuid
      and title = 'pre-C2 unowned active lecture'
      and status = 'open'
  ),
  'the populated C1-head lecture survives C2 unchanged'
);
select ok(
  not exists (
    select 1
    from private.admin_lecture_ownerships
    where lecture_session_id =
      '73032000-0000-4000-8000-000000000001'::uuid
  ),
  'C2 never infers ownership for a pre-existing lecture'
);
select is(
  (
    select google_operational_authorization_enabled
    from private.admin_identity_runtime_gate
    where singleton
  ),
  false,
  'C2 operational authorization remains default OFF after populated upgrade'
);
select is(
  (select count(*)::integer from private.admin_google_operation_policies),
  75,
  'the closed C2 operation matrix is installed exactly once'
);
select is(
  (select count(*)::integer from private.admin_google_operation_receipts),
  0,
  'C2 fabricates no generic operation receipt during upgrade'
);
select is(
  (
    select count(*)::integer
    from private.admin_google_lecture_operation_receipts
  ),
  0,
  'C2 fabricates no lecture operation receipt during upgrade'
);
select ok(
  (
    select run.auto_academic_answers_enabled
      and run.academic_authority_mode = 'legacy_run_grant'
      and run.academic_authorization_grant_id =
        '73032000-0000-4000-8000-000000000002'::uuid
    from public.lecture_summary_runs as run
    where run.id = '73032000-0000-4000-8000-000000000003'::uuid
  )
  and (
    select not run.auto_academic_answers_enabled
      and run.academic_authority_mode = 'none'
      and run.academic_authorization_grant_id is null
    from public.lecture_summary_runs as run
    where run.id = '73032000-0000-4000-8000-000000000004'::uuid
  ),
  'C2 normalizes populated legacy and non-automatic summary authority without changing grants'
);
select ok(
  not exists (
    select 1
    from private.admin_google_summary_auto_receipts
    where run_id in (
      '73032000-0000-4000-8000-000000000003'::uuid,
      '73032000-0000-4000-8000-000000000004'::uuid
    )
  )
  and not exists (
    select 1
    from private.admin_google_academic_answer_preflight_receipts
  )
  and not exists (
    select 1
    from private.admin_google_academic_answer_start_bindings
  ),
  'C2 fabricates no Google summary or Academic evidence during populated upgrade'
);

set role service_role;
select is(
  public.get_google_admin_operations_activation_preflight_v1()
    ->> 'unownedActiveLectureCount',
  '1',
  'activation preflight keeps the unowned active lecture as an explicit HOLD'
);
reset role;

select * from finish();
rollback;
