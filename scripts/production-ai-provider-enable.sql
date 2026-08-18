-- Tracked Hosted operator mutation: enable only new Google AI master and child
-- admission after identity, policy topology and zero-work preconditions hold.
-- Run as the database owner in a separately approved Hosted mutation window.

begin;
set local lock_timeout = '2s';
set local statement_timeout = '15s';

do $$
declare
  identity_gate private.admin_identity_runtime_gate%rowtype;
  ai_gate private.admin_ai_unlock_runtime_gate%rowtype;
  production_environment_ids uuid[];
  production_environment_id uuid;
  active_owner_count bigint;
  ai_owner_count bigint;
  eligible_membership_count bigint;
  covered_membership_count bigint;
begin
  select gate.*
  into identity_gate
  from private.admin_identity_runtime_gate as gate
  where gate.singleton
  for update;
  if not found then
    raise exception 'production AI activation blocked: identity gate row missing';
  end if;

  select gate.*
  into ai_gate
  from private.admin_ai_unlock_runtime_gate as gate
  where gate.singleton
  for update;
  if not found then
    raise exception 'production AI activation blocked: AI gate row missing';
  end if;

  select array_agg(environment.id order by environment.id)
  into production_environment_ids
  from private.admin_environments as environment
  where environment.environment_kind = 'production'
    and environment.status = 'active'
    and environment.current_deployment;
  if coalesce(cardinality(production_environment_ids), 0) <> 1 then
    raise exception 'production AI activation blocked: active production environment is not unique';
  end if;
  production_environment_id := production_environment_ids[1];

  if identity_gate.google_session_issue_enabled is not true
     or identity_gate.google_operational_authorization_enabled is not true
     or identity_gate.google_admin_ledger_enabled is not true then
    raise exception 'production AI activation blocked: identity, operations or ledger gate is off';
  end if;
  if ai_gate.ai_unlock_enabled is not true then
    raise exception 'production AI activation blocked: Admin AI unlock gate is off';
  end if;
  if ai_gate.google_ai_child_grant_enabled is true
     and ai_gate.google_ai_master_admission_enabled is not true then
    raise exception 'production AI activation blocked: child admission is on without master admission';
  end if;

  select
    count(*) filter (where membership.role = 'owner'),
    count(*) filter (
      where membership.role = 'owner' and membership.can_use_ai
    )
  into active_owner_count, ai_owner_count
  from private.admin_environment_memberships as membership
  where membership.environment_id = production_environment_id
    and membership.status = 'active'
    and (
      membership.expires_at is null
      or membership.expires_at > statement_timestamp()
    );
  if active_owner_count <> 2 or ai_owner_count <> 2 then
    raise exception 'production AI activation blocked: exactly two active AI-enabled Owners are required';
  end if;

  select count(*)
  into eligible_membership_count
  from private.admin_environment_memberships as membership
  where membership.environment_id = production_environment_id
    and membership.status = 'active'
    and membership.can_use_ai
    and (
      membership.expires_at is null
      or membership.expires_at > statement_timestamp()
    );

  select count(*)
  into covered_membership_count
  from private.admin_environment_memberships as membership
  where membership.environment_id = production_environment_id
    and membership.status = 'active'
    and membership.can_use_ai
    and (
      membership.expires_at is null
      or membership.expires_at > statement_timestamp()
    )
    and exists (
      select 1
      from private.admin_ai_policies as policy
      where policy.environment_id = production_environment_id
        and policy.membership_id = membership.id
        and policy.status = 'active'
        and private.admin_ai_policy_matches_production_preset_v1(
          policy.allowed_actions,
          policy.allowed_models,
          policy.max_calls_per_lecture,
          policy.max_calls_per_day,
          policy.max_input_tokens_per_lecture,
          policy.max_input_tokens_per_day,
          policy.max_output_tokens_per_lecture,
          policy.max_output_tokens_per_day,
          policy.max_cost_microusd_per_lecture,
          policy.max_cost_microusd_per_day,
          policy.max_realtime_minutes_per_lecture,
          policy.max_realtime_minutes_per_day,
          policy.max_concurrency,
          policy.valid_from,
          policy.valid_until,
          statement_timestamp()
        )
    );
  if eligible_membership_count = 0
     or covered_membership_count <> eligible_membership_count then
    raise exception 'production AI activation blocked: active AI membership policy coverage is incomplete';
  end if;

  if exists (
    select 1 from public.lecture_sessions as lecture where lecture.status = 'open'
  ) then
    raise exception 'production AI activation blocked: an open lecture exists';
  end if;
  if exists (
    select 1
    from public.lecture_ai_master_authorizations as master
    where master.status = 'active'
      and master.expires_at > statement_timestamp()
  ) then
    raise exception 'production AI activation blocked: active master authorization exists';
  end if;
  if exists (
    select 1
    from public.ai_billing_grants as grant_row
    where grant_row.status = 'issued'
      and grant_row.expires_at > statement_timestamp()
  ) then
    raise exception 'production AI activation blocked: an unconsumed child grant exists';
  end if;
  if exists (
    select 1 from public.ai_usage_ledger as usage where usage.status = 'running'
  ) then
    raise exception 'production AI activation blocked: a provider operation is running';
  end if;
  if exists (
    select 1
    from private.admin_google_ai_provider_start_intents as intent
    left join private.admin_google_ai_provider_start_receipts as receipt
      on receipt.start_request_id = intent.start_request_id
    where receipt.start_request_id is null
  ) then
    raise exception 'production AI activation blocked: a provider start is pending';
  end if;
  if exists (
    select 1
    from public.lecture_summary_runs as run
    where run.status = 'running'
  ) or exists (
    select 1
    from public.lecture_summary_windows as window_row
    where window_row.status in ('pending', 'running')
  ) or exists (
    select 1
    from public.academic_answer_requests as request_row
    where request_row.status in ('evidence_checking', 'running')
  ) then
    raise exception 'production AI activation blocked: lecture AI work is pending or running';
  end if;

  update private.admin_ai_unlock_runtime_gate
  set
    google_ai_master_admission_enabled = true,
    updated_at = statement_timestamp()
  where singleton;

  update private.admin_ai_unlock_runtime_gate
  set
    google_ai_child_grant_enabled = true,
    updated_at = statement_timestamp()
  where singleton;
end;
$$;

commit;
