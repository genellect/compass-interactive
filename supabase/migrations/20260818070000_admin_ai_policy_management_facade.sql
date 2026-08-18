-- Owner-operated, service-role-only Admin AI policy preparation and status.
--
-- Policy mutation remains owned by public.set_admin_ai_policy_v1. This facade
-- only prepares the canonical control intent and reports whether every active,
-- AI-enabled membership has a live full-lecture policy.

create function private.admin_ai_policy_matches_production_preset_v1(
  target_allowed_actions text[],
  target_allowed_models text[],
  target_max_calls_per_lecture integer,
  target_max_calls_per_day integer,
  target_max_input_tokens_per_lecture bigint,
  target_max_input_tokens_per_day bigint,
  target_max_output_tokens_per_lecture bigint,
  target_max_output_tokens_per_day bigint,
  target_max_cost_microusd_per_lecture bigint,
  target_max_cost_microusd_per_day bigint,
  target_max_realtime_minutes_per_lecture integer,
  target_max_realtime_minutes_per_day integer,
  target_max_concurrency integer,
  target_valid_from timestamptz,
  target_valid_until timestamptz,
  target_effective_now timestamptz
)
returns boolean
language sql
immutable
security invoker
set search_path = ''
as $$
  select coalesce(
    target_valid_from <= target_effective_now
    and target_valid_until > target_effective_now
    and target_valid_until = target_valid_from + interval '30 days'
    and cardinality(target_allowed_actions) = 5
    and target_allowed_actions @> array[
      'academic_answers',
      'captions',
      'material_analysis',
      'poll_suggestions',
      'summaries'
    ]::text[]
    and cardinality(target_allowed_models) = 2
    and target_allowed_models @> array[
      'gpt-5.6-luna',
      'gpt-realtime-whisper'
    ]::text[]
    and target_max_calls_per_lecture = 24
    and target_max_calls_per_day = 96
    and target_max_input_tokens_per_lecture = 200000
    and target_max_input_tokens_per_day = 800000
    and target_max_output_tokens_per_lecture = 40000
    and target_max_output_tokens_per_day = 160000
    and target_max_cost_microusd_per_lecture between 10000 and 5000000
    and target_max_cost_microusd_per_day between target_max_cost_microusd_per_lecture and 20000000
    and target_max_realtime_minutes_per_lecture = 90
    and target_max_realtime_minutes_per_day = 180
    and target_max_concurrency = 2,
    false
  );
$$;

revoke all on function private.admin_ai_policy_matches_production_preset_v1(
  text[], text[], integer, integer, bigint, bigint, bigint, bigint, bigint,
  bigint, integer, integer, integer, timestamptz, timestamptz, timestamptz
) from public, anon, authenticated, service_role;

create function public.prepare_admin_ai_policy_change_v1(
  target_token_hash text,
  target_auth_user_id uuid,
  target_supabase_auth_session_id uuid,
  target_membership_id uuid,
  target_allowed_actions text[],
  target_allowed_models text[],
  target_max_calls_per_lecture integer,
  target_max_calls_per_day integer,
  target_max_input_tokens_per_lecture bigint,
  target_max_input_tokens_per_day bigint,
  target_max_output_tokens_per_lecture bigint,
  target_max_output_tokens_per_day bigint,
  target_max_cost_microusd_per_lecture bigint,
  target_max_cost_microusd_per_day bigint,
  target_max_realtime_minutes_per_lecture integer,
  target_max_realtime_minutes_per_day integer,
  target_max_concurrency integer,
  target_valid_from timestamptz,
  target_valid_until timestamptz,
  target_request_id uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
set statement_timeout = '3s'
set lock_timeout = '750ms'
as $$
declare
  context_value jsonb;
  intent_digest_value text;
  effective_now timestamptz := statement_timestamp();
begin
  if target_request_id is null
     or target_membership_id is null
     or private.admin_ai_policy_matches_production_preset_v1(
       target_allowed_actions,
       target_allowed_models,
       target_max_calls_per_lecture,
       target_max_calls_per_day,
       target_max_input_tokens_per_lecture,
       target_max_input_tokens_per_day,
       target_max_output_tokens_per_lecture,
       target_max_output_tokens_per_day,
       target_max_cost_microusd_per_lecture,
       target_max_cost_microusd_per_day,
       target_max_realtime_minutes_per_lecture,
       target_max_realtime_minutes_per_day,
       target_max_concurrency,
       target_valid_from,
       target_valid_until,
       effective_now
     ) is not true then
    raise exception 'invalid Admin AI policy preparation' using errcode = '22023';
  end if;

  context_value := private.require_admin_ai_context_v1(
    target_token_hash,
    target_auth_user_id,
    target_supabase_auth_session_id,
    null,
    false,
    true
  );
  if context_value is null then
    return null;
  end if;

  if not exists (
    select 1
    from private.admin_environment_memberships as membership
    where membership.id = target_membership_id
      and membership.environment_id = (context_value ->> 'environment_id')::uuid
      and membership.status = 'active'
      and membership.can_use_ai
      and (
        membership.expires_at is null
        or membership.expires_at > effective_now
      )
  ) then
    return null;
  end if;

  intent_digest_value := private.admin_ai_policy_control_intent_digest_v1(
    target_membership_id,
    target_allowed_actions,
    target_allowed_models,
    target_max_calls_per_lecture,
    target_max_calls_per_day,
    target_max_input_tokens_per_lecture,
    target_max_input_tokens_per_day,
    target_max_output_tokens_per_lecture,
    target_max_output_tokens_per_day,
    target_max_cost_microusd_per_lecture,
    target_max_cost_microusd_per_day,
    target_max_realtime_minutes_per_lecture,
    target_max_realtime_minutes_per_day,
    target_max_concurrency,
    target_valid_from,
    target_valid_until
  );
  if intent_digest_value is null then
    return null;
  end if;

  return jsonb_build_object(
    'actor_membership_id', (context_value ->> 'membership_id')::uuid,
    'control_action', 'environment_ai_policy_change',
    'control_intent_digest', intent_digest_value,
    'request_id', target_request_id,
    'target_membership_id', target_membership_id
  );
end;
$$;

create function public.get_admin_ai_policy_status_v1(
  target_token_hash text,
  target_auth_user_id uuid,
  target_supabase_auth_session_id uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
set statement_timeout = '3s'
set lock_timeout = '750ms'
as $$
declare
  context_value jsonb;
  result_value jsonb;
  effective_now timestamptz := statement_timestamp();
begin
  context_value := private.require_admin_ai_context_v1(
    target_token_hash,
    target_auth_user_id,
    target_supabase_auth_session_id,
    null,
    false,
    true
  );
  if context_value is null then
    return null;
  end if;

  with eligible_memberships as (
    select membership.id, membership.role
    from private.admin_environment_memberships as membership
    where membership.environment_id = (context_value ->> 'environment_id')::uuid
      and membership.status = 'active'
      and membership.can_use_ai
      and (
        membership.expires_at is null
        or membership.expires_at > effective_now
      )
  ), policy_state as (
    select
      membership.id as membership_id,
      membership.role,
      policy.id as policy_id,
      policy.status as policy_status,
      policy.version as policy_version,
      policy.max_cost_microusd_per_lecture,
      policy.max_cost_microusd_per_day,
      policy.valid_from,
      policy.valid_until,
      coalesce(
        policy.status = 'active'
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
          effective_now
        ),
        false
      ) as covered
    from eligible_memberships as membership
    left join private.admin_ai_policies as policy
      on policy.environment_id = (context_value ->> 'environment_id')::uuid
      and policy.membership_id = membership.id
      and policy.status = 'active'
  ), topology as (
    select
      count(*) as active_count,
      count(*) filter (where covered) as covered_count,
      count(*) filter (where role = 'owner') as active_owner_count,
      count(*) filter (where role = 'owner' and covered) as covered_owner_count,
      coalesce(
        jsonb_agg(
          jsonb_build_object(
            'covered', covered,
            'membership_id', membership_id,
            'policy_id', policy_id,
            'policy_status', policy_status,
            'policy_version', policy_version,
            'max_cost_microusd_per_lecture', max_cost_microusd_per_lecture,
            'max_cost_microusd_per_day', max_cost_microusd_per_day,
            'valid_from', valid_from,
            'valid_until', valid_until
          ) order by membership_id
        ),
        '[]'::jsonb
      ) as memberships
    from policy_state
  )
  select jsonb_build_object(
    'active_ai_membership_count', active_count,
    'covered_membership_count', covered_count,
    'active_ai_owner_count', active_owner_count,
    'covered_owner_count', covered_owner_count,
    'memberships', memberships,
    'canonical_policy_topology_complete', active_count > 0 and active_count = covered_count,
    'topology_complete', active_count > 0 and active_count = covered_count
  )
  into result_value
  from topology;

  return result_value;
end;
$$;

revoke all on function public.prepare_admin_ai_policy_change_v1(
  text, uuid, uuid, uuid, text[], text[], integer, integer, bigint, bigint,
  bigint, bigint, bigint, bigint, integer, integer, integer, timestamptz,
  timestamptz, uuid
) from public, anon, authenticated, service_role;
revoke all on function public.get_admin_ai_policy_status_v1(
  text, uuid, uuid
) from public, anon, authenticated, service_role;

grant execute on function public.prepare_admin_ai_policy_change_v1(
  text, uuid, uuid, uuid, text[], text[], integer, integer, bigint, bigint,
  bigint, bigint, bigint, bigint, integer, integer, integer, timestamptz,
  timestamptz, uuid
) to service_role;
grant execute on function public.get_admin_ai_policy_status_v1(
  text, uuid, uuid
) to service_role;
