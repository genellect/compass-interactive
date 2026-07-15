\set ON_ERROR_STOP on

-- Run after applying the Phase 4.1 migration to phase4_1_upgrade_fixture.sql.
do $$
begin
  if to_regclass('public.ai_usage_ledger_running_realtime_uidx') is null
     or to_regclass('public.ai_usage_ledger_running_batch_uidx') is null then
    raise exception 'Phase 4.1 lane indexes are missing';
  end if;

  if not exists (
    select 1
    from public.phase41_upgrade_fixture as fixture
    join public.lecture_ai_control as control
      on control.lecture_session_id = fixture.lecture_id
    join public.ai_usage_ledger as usage
      on usage.id = fixture.operation_id
    join public.ai_billing_grants as grant_record
      on grant_record.id = fixture.grant_id
    where control.max_concurrent_operations = 2
      and control.active_operation_count = 1
      and usage.feature = 'captions'
      and usage.status = 'running'
      and grant_record.status = 'issued'
  ) then
    raise exception 'Phase 4 rows were not preserved or reconciled';
  end if;
end;
$$;

set role service_role;

do $$
declare
  result jsonb;
begin
  select public.admin_start_lecture_ai_operation(
    fixture.lecture_id,
    'summaries',
    'p41-upgrade-summary',
    1,
    0,
    1,
    1,
    'admin-session:upgrade'
  )
  into result
  from public.phase41_upgrade_fixture as fixture;

  if coalesce((result ->> 'accepted')::boolean, false) is not true then
    raise exception 'Phase 4.1 did not admit Batch work beside upgraded captions: %', result;
  end if;
end;
$$;

do $$
begin
  if not exists (
    select 1
    from public.phase41_upgrade_fixture as fixture
    join public.lecture_ai_control as control
      on control.lecture_session_id = fixture.lecture_id
    where control.active_operation_count = 2
      and (
        select count(*)
        from public.ai_usage_ledger as usage
        where usage.lecture_session_id = fixture.lecture_id
          and usage.status = 'running'
      ) = 2
  ) then
    raise exception 'upgraded lecture did not reach one running operation per lane';
  end if;
end;
$$;

select public.admin_stop_lecture_ai_control(
  (select lecture_id from public.phase41_upgrade_fixture),
  'upgrade_validation_cleanup',
  'admin-session:upgrade'
);

reset role;

drop table public.phase41_upgrade_fixture;
