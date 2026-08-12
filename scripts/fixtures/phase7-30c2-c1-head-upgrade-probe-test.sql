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
  'the populated C1-head lecture survives the C2 through E upgrade unchanged'
);
select ok(
  not exists (
    select 1
    from private.admin_lecture_ownerships
    where lecture_session_id =
      '73032000-0000-4000-8000-000000000001'::uuid
  ),
  'the C2 through E upgrade never infers ownership for a pre-existing lecture'
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
  (
    select count(*)::integer
    from private.admin_google_operation_policies
    where edge_function <> 'manage-admin-ledger'
  ),
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

select ok(
  (select legacy_pin_login_enabled
   from private.admin_identity_runtime_gate
   where singleton)
  and not exists (
    select 1 from private.admin_identity_cutover_receipts
  )
  and not exists (
    select 1 from private.admin_lecture_ownership_claim_approvals
  )
  and not exists (
    select 1 from private.admin_lecture_ownership_claim_receipts
  ),
  'E applies dormant without disabling legacy admission or fabricating ownership evidence'
);

select ok(
  (private.get_google_only_admin_cutover_preflight_v1(
    '00000000-0000-0000-0000-000000000000'::uuid
  ) ->> 'authoritative')::boolean is false
  and (private.get_google_only_admin_cutover_preflight_v1(
    '00000000-0000-0000-0000-000000000000'::uuid
  ) ->> 'externalTransportAttestationRequired')::boolean
  and private.get_google_only_admin_cutover_preflight_v1(
    '00000000-0000-0000-0000-000000000000'::uuid
  ) ->> 'unownedActiveLectureCount' = '1'
  and private.get_google_only_admin_cutover_preflight_v1(
    '00000000-0000-0000-0000-000000000000'::uuid
  ) ->> 'issuedLegacyGrantCount' = '1',
  'E preflight preserves unresolved legacy authority as an explicit non-authoritative HOLD'
);

select ok(
  has_function_privilege(
    'service_role',
    'public.verify_and_touch_admin_session(uuid,text,text)',
    'EXECUTE'
  ),
  'migration application alone does not revoke the legacy verifier before operator cutover'
);

select * from finish();
rollback;
