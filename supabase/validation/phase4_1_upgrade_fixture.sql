\set ON_ERROR_STOP on

-- Run after resetting only through the Phase 4 migration. This deliberately
-- leaves one long-running caption and one unconsumed billing grant in place.
create table public.phase41_upgrade_fixture (
  lecture_id uuid not null,
  operation_id uuid,
  grant_id uuid
);
grant select, insert, update on public.phase41_upgrade_fixture to service_role;

set role service_role;

insert into public.phase41_upgrade_fixture (lecture_id)
values (
  public.admin_create_lecture(
    'Phase 4.1 upgrade fixture',
    encode(extensions.digest(convert_to('P41-UPGRADE', 'UTF8'), 'sha256'), 'hex'),
    'P41-UPGRADE',
    null,
    null
  )
);

select public.admin_set_lecture_status(
  (select lecture_id from public.phase41_upgrade_fixture),
  'start',
  null
);

select public.admin_configure_lecture_ai_control(
  (select lecture_id from public.phase41_upgrade_fixture),
  jsonb_build_object(
    'captions_enabled', true,
    'summaries_enabled', true,
    'max_concurrent_operations', 1
  ),
  'admin-session:upgrade'
);

update public.phase41_upgrade_fixture
set operation_id = (
  public.admin_start_lecture_ai_operation(
    lecture_id,
    'captions',
    'p41-upgrade-caption',
    1,
    1,
    0,
    0,
    'admin-session:upgrade'
  ) #>> '{operation,id}'
)::uuid;

update public.phase41_upgrade_fixture
set grant_id = (
  public.admin_issue_ai_billing_grant(
    lecture_id,
    array['summaries'],
    repeat('c', 64),
    true,
    'admin-session:upgrade'
  ) ->> 'grant_id'
)::uuid;

reset role;

do $$
begin
  if not exists (
    select 1
    from public.phase41_upgrade_fixture as fixture
    join public.lecture_ai_control as control
      on control.lecture_session_id = fixture.lecture_id
    join public.ai_usage_ledger as usage
      on usage.id = fixture.operation_id
    join public.ai_billing_grants as grant_record
      on grant_record.id = fixture.grant_id
    where control.max_concurrent_operations = 1
      and control.active_operation_count = 1
      and usage.feature = 'captions'
      and usage.status = 'running'
      and grant_record.status = 'issued'
  ) then
    raise exception 'Phase 4 upgrade fixture was not created correctly';
  end if;
end;
$$;
