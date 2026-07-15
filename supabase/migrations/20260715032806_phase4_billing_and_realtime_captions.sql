-- Phase 4: billing authorization and low-latency Realtime captions.
-- Expand-first: all Phase 0-3 RPCs remain available and the frontend flag is
-- OFF by default. Browser roles receive captions only through the snapshot RPC.

create table public.ai_billing_rate_limits (
  lecture_session_id uuid primary key
    references public.lecture_sessions(id) on delete restrict,
  failed_attempts integer not null default 0
    check (failed_attempts between 0 and 5),
  window_started_at timestamptz,
  last_failed_at timestamptz,
  locked_until timestamptz,
  updated_at timestamptz not null default statement_timestamp()
);

create table public.ai_billing_grants (
  id uuid primary key default extensions.gen_random_uuid(),
  lecture_session_id uuid not null
    references public.lecture_sessions(id) on delete restrict,
  actor_id text not null check (char_length(actor_id) between 1 and 200),
  actions text[] not null check (
    cardinality(actions) between 1 and 5
    and actions <@ array[
      'captions',
      'summaries',
      'material_analysis',
      'poll_suggestions',
      'academic_answers'
    ]::text[]
  ),
  nonce_hash text not null unique check (nonce_hash ~ '^[0-9a-f]{64}$'),
  status text not null default 'issued'
    check (status in ('issued', 'consumed', 'expired', 'revoked')),
  issued_at timestamptz not null default statement_timestamp(),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  revoked_at timestamptz,
  operation_ids uuid[] not null default '{}'::uuid[],
  check (expires_at > issued_at),
  check (status <> 'consumed' or consumed_at is not null),
  check (status <> 'revoked' or revoked_at is not null)
);

create index ai_billing_grants_issued_due_idx
  on public.ai_billing_grants (expires_at, lecture_session_id)
  where status = 'issued';
create index ai_billing_grants_lecture_issued_idx
  on public.ai_billing_grants (lecture_session_id, issued_at desc);

create table public.lecture_public_captions (
  lecture_session_id uuid primary key
    references public.lecture_sessions(id) on delete restrict,
  text text not null check (char_length(text) between 1 and 1000),
  language text not null default 'auto'
    check (language in ('auto', 'en', 'ja', 'mixed', 'und')),
  last_item_id text not null check (char_length(last_item_id) between 1 and 200),
  sequence bigint not null check (sequence >= 0),
  window_started_at timestamptz not null,
  window_ended_at timestamptz not null,
  updated_at timestamptz not null default statement_timestamp(),
  check (window_started_at <= window_ended_at)
);

create table public.ai_realtime_token_audit (
  id uuid primary key default extensions.gen_random_uuid(),
  lecture_session_id uuid not null
    references public.lecture_sessions(id) on delete restrict,
  operation_id uuid not null
    references public.ai_usage_ledger(id) on delete restrict,
  actor_id text not null check (char_length(actor_id) between 1 and 200),
  model_id text not null check (char_length(model_id) between 1 and 120),
  outcome text not null check (outcome in ('issued', 'failed')),
  provider_request_id text
    check (provider_request_id is null or char_length(provider_request_id) <= 200),
  created_at timestamptz not null default statement_timestamp()
);

create index ai_realtime_token_audit_lecture_created_idx
  on public.ai_realtime_token_audit (lecture_session_id, created_at desc);
create index ai_realtime_token_audit_operation_idx
  on public.ai_realtime_token_audit (operation_id);

alter table public.ai_usage_ledger
  add column model_id text
    check (model_id is null or char_length(model_id) between 1 and 120),
  add column pricing_unit text
    check (pricing_unit is null or pricing_unit in ('audio_minute', 'token')),
  add column pricing_rate_microusd bigint
    check (pricing_rate_microusd is null or pricing_rate_microusd between 0 and 100000000),
  add column last_heartbeat_at timestamptz;

create index ai_usage_ledger_stale_caption_idx
  on public.ai_usage_ledger (lecture_session_id, last_heartbeat_at)
  where feature = 'captions' and status = 'running';

alter table public.ai_billing_rate_limits enable row level security;
alter table public.ai_billing_grants enable row level security;
alter table public.lecture_public_captions enable row level security;
alter table public.ai_realtime_token_audit enable row level security;

revoke all on public.ai_billing_rate_limits from public, anon, authenticated;
revoke all on public.ai_billing_grants from public, anon, authenticated;
revoke all on public.lecture_public_captions from public, anon, authenticated;
revoke all on public.ai_realtime_token_audit from public, anon, authenticated;

grant select on public.ai_billing_rate_limits to service_role;
grant select on public.ai_billing_grants to service_role;
grant select on public.lecture_public_captions to service_role;
grant select on public.ai_realtime_token_audit to service_role;

create function private.issue_ai_billing_grant(
  target_lecture_session_id uuid,
  target_actions text[],
  target_nonce_hash text,
  pin_succeeded boolean,
  target_actor_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  canonical_actions text[];
  lecture_row public.lecture_sessions%rowtype;
  rate_row public.ai_billing_rate_limits%rowtype;
  grant_row public.ai_billing_grants%rowtype;
  effective_attempts integer;
  effective_now timestamptz := statement_timestamp();
  effective_lock timestamptz;
begin
  select array_agg(distinct action order by action)
  into canonical_actions
  from unnest(target_actions) as action;

  if canonical_actions is null
     or cardinality(canonical_actions) not between 1 and 5
     or not canonical_actions <@ array[
       'captions',
       'summaries',
       'material_analysis',
       'poll_suggestions',
       'academic_answers'
     ]::text[] then
    raise exception 'invalid billing actions' using errcode = '22023';
  end if;
  if target_nonce_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid billing grant nonce' using errcode = '22023';
  end if;
  if nullif(trim(target_actor_id), '') is null
     or char_length(target_actor_id) > 200 then
    raise exception 'invalid billing actor' using errcode = '22023';
  end if;

  perform private.reap_stale_realtime_caption_operations(
    target_lecture_session_id,
    20
  );

  perform private.close_lecture_if_expired(target_lecture_session_id);

  select lecture.*
  into lecture_row
  from public.lecture_sessions as lecture
  where lecture.id = target_lecture_session_id
  for update;

  if not found then
    raise exception 'lecture not found' using errcode = 'P0002';
  end if;
  if lecture_row.status <> 'open'
     or lecture_row.hard_stop_at is null
     or lecture_row.hard_stop_at <= effective_now then
    return jsonb_build_object('accepted', false, 'reason', 'lecture_not_open');
  end if;

  insert into public.ai_billing_rate_limits (lecture_session_id)
  values (target_lecture_session_id)
  on conflict (lecture_session_id) do nothing;

  select rate.*
  into rate_row
  from public.ai_billing_rate_limits as rate
  where rate.lecture_session_id = target_lecture_session_id
  for update;

  if rate_row.locked_until is not null and rate_row.locked_until > effective_now then
    return jsonb_build_object(
      'accepted', false,
      'reason', 'rate_limited',
      'retry_at', rate_row.locked_until
    );
  end if;

  if not pin_succeeded then
    effective_attempts := case
      when rate_row.window_started_at is null
        or rate_row.window_started_at < effective_now - interval '10 minutes'
        then 1
      else least(rate_row.failed_attempts + 1, 5)
    end;
    effective_lock := case
      when effective_attempts >= 5 then effective_now + interval '15 minutes'
      else null
    end;

    update public.ai_billing_rate_limits as rate
    set
      failed_attempts = effective_attempts,
      window_started_at = case
        when rate.window_started_at is null
          or rate.window_started_at < effective_now - interval '10 minutes'
          then effective_now
        else rate.window_started_at
      end,
      last_failed_at = effective_now,
      locked_until = effective_lock,
      updated_at = effective_now
    where rate.lecture_session_id = target_lecture_session_id;

    return jsonb_build_object(
      'accepted', false,
      'reason', case when effective_lock is null then 'invalid_pin' else 'rate_limited' end,
      'retry_at', effective_lock
    );
  end if;

  update public.ai_billing_rate_limits as rate
  set
    failed_attempts = 0,
    window_started_at = null,
    last_failed_at = null,
    locked_until = null,
    updated_at = effective_now
  where rate.lecture_session_id = target_lecture_session_id;

  insert into public.ai_billing_grants (
    lecture_session_id,
    actor_id,
    actions,
    nonce_hash,
    expires_at
  ) values (
    target_lecture_session_id,
    target_actor_id,
    canonical_actions,
    target_nonce_hash,
    least(effective_now + interval '2 minutes', lecture_row.hard_stop_at)
  )
  returning * into grant_row;

  return jsonb_build_object(
    'accepted', true,
    'grant_id', grant_row.id,
    'expires_at', grant_row.expires_at,
    'actions', to_jsonb(grant_row.actions)
  );
end;
$$;

create function public.admin_issue_ai_billing_grant(
  target_lecture_session_id uuid,
  target_actions text[],
  target_nonce_hash text,
  pin_succeeded boolean,
  target_actor_id text
)
returns jsonb
language sql
volatile
security invoker
set search_path = ''
as $$
  select private.issue_ai_billing_grant(
    target_lecture_session_id,
    target_actions,
    target_nonce_hash,
    pin_succeeded,
    target_actor_id
  );
$$;

create function private.consume_ai_billing_grant_and_start_operations(
  target_grant_id uuid,
  target_nonce_hash text,
  target_lecture_session_id uuid,
  target_operations jsonb,
  target_actor_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  grant_row public.ai_billing_grants%rowtype;
  operation jsonb;
  operation_result jsonb;
  operation_results jsonb := '[]'::jsonb;
  started_operation_ids uuid[] := '{}'::uuid[];
  operation_features text[];
  operation_count integer;
  distinct_feature_count integer;
  operation_id uuid;
begin
  if jsonb_typeof(target_operations) <> 'array'
     or jsonb_array_length(target_operations) not between 1 and 5 then
    raise exception 'AI operations must be a non-empty array' using errcode = '22023';
  end if;
  if target_nonce_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid billing grant nonce' using errcode = '22023';
  end if;
  if nullif(trim(target_actor_id), '') is null
     or char_length(target_actor_id) > 200 then
    raise exception 'invalid billing actor' using errcode = '22023';
  end if;

  perform private.reap_stale_realtime_caption_operations(
    target_lecture_session_id,
    20
  );

  perform private.close_lecture_if_expired(target_lecture_session_id);

  select grant_record.*
  into grant_row
  from public.ai_billing_grants as grant_record
  where grant_record.id = target_grant_id
    and grant_record.lecture_session_id = target_lecture_session_id
  for update;

  if not found
     or grant_row.nonce_hash <> target_nonce_hash
     or grant_row.actor_id <> target_actor_id then
    return jsonb_build_object('accepted', false, 'reason', 'invalid_grant');
  end if;
  if grant_row.status <> 'issued' then
    return jsonb_build_object('accepted', false, 'reason', 'grant_not_available');
  end if;
  if grant_row.expires_at <= statement_timestamp() then
    update public.ai_billing_grants
    set status = 'expired'
    where id = grant_row.id;
    return jsonb_build_object('accepted', false, 'reason', 'grant_expired');
  end if;

  select
    array_agg(feature order by feature),
    count(*),
    count(distinct feature)
  into operation_features, operation_count, distinct_feature_count
  from (
    select value ->> 'feature' as feature
    from jsonb_array_elements(target_operations)
  ) as requested;

  if operation_count <> distinct_feature_count
     or operation_features <> grant_row.actions then
    return jsonb_build_object('accepted', false, 'reason', 'grant_scope_mismatch');
  end if;

  update public.lecture_ai_control as control
  set
    status = case when control.active_operation_count > 0 then 'running' else 'ready' end,
    captions_enabled = control.captions_enabled or 'captions' = any(grant_row.actions),
    summaries_enabled = control.summaries_enabled or 'summaries' = any(grant_row.actions),
    material_analysis_enabled = control.material_analysis_enabled
      or 'material_analysis' = any(grant_row.actions),
    poll_suggestions_enabled = control.poll_suggestions_enabled
      or 'poll_suggestions' = any(grant_row.actions),
    academic_answers_enabled = control.academic_answers_enabled
      or 'academic_answers' = any(grant_row.actions),
    stop_requested_at = null,
    stopped_at = null,
    stop_reason = null,
    version = control.version + 1,
    updated_at = statement_timestamp()
  where control.lecture_session_id = target_lecture_session_id;

  if not found then
    raise exception 'AI control is not configured' using errcode = 'P0001';
  end if;

  for operation in select value from jsonb_array_elements(target_operations)
  loop
    if nullif(trim(operation ->> 'model_id'), '') is null
       or char_length(operation ->> 'model_id') > 120 then
      raise exception 'invalid AI model id' using errcode = '22023';
    end if;
    if coalesce(operation ->> 'pricing_unit', '') not in ('audio_minute', 'token') then
      raise exception 'invalid AI pricing unit' using errcode = '22023';
    end if;

    operation_result := private.start_lecture_ai_operation(
      target_lecture_session_id,
      operation ->> 'feature',
      operation ->> 'idempotency_key',
      coalesce((operation ->> 'estimated_microusd')::bigint, 0),
      coalesce((operation ->> 'estimated_audio_seconds')::integer, 0),
      coalesce((operation ->> 'estimated_input_tokens')::bigint, 0),
      coalesce((operation ->> 'estimated_output_tokens')::bigint, 0),
      target_actor_id
    );

    if coalesce((operation_result ->> 'accepted')::boolean, false) is not true then
      raise exception 'AI operation rejected: %', operation_result ->> 'reason'
        using errcode = 'P0001';
    end if;

    operation_id := (operation_result #>> '{operation,id}')::uuid;
    update public.ai_usage_ledger as usage
    set
      model_id = operation ->> 'model_id',
      pricing_unit = operation ->> 'pricing_unit',
      pricing_rate_microusd = coalesce(
        (operation ->> 'pricing_rate_microusd')::bigint,
        0
      ),
      last_heartbeat_at = statement_timestamp()
    where usage.id = operation_id;

    started_operation_ids := array_append(started_operation_ids, operation_id);
    operation_results := operation_results || jsonb_build_array(operation_result);
  end loop;

  update public.ai_billing_grants as grant_record
  set
    status = 'consumed',
    consumed_at = statement_timestamp(),
    operation_ids = started_operation_ids
  where grant_record.id = grant_row.id;

  return jsonb_build_object(
    'accepted', true,
    'operations', operation_results
  );
end;
$$;

create function public.admin_consume_ai_billing_grant(
  target_grant_id uuid,
  target_nonce_hash text,
  target_lecture_session_id uuid,
  target_operations jsonb,
  target_actor_id text
)
returns jsonb
language sql
volatile
security invoker
set search_path = ''
as $$
  select private.consume_ai_billing_grant_and_start_operations(
    target_grant_id,
    target_nonce_hash,
    target_lecture_session_id,
    target_operations,
    target_actor_id
  );
$$;

create function private.finish_realtime_caption_operation(
  target_operation_id uuid,
  target_actor_id text,
  target_reason text,
  charge_elapsed boolean,
  disable_feature boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  usage_row public.ai_usage_ledger%rowtype;
  actual_audio integer := 0;
  actual_cost bigint := 0;
  deleted_caption boolean := false;
begin
  if nullif(trim(target_reason), '') is null
     or char_length(target_reason) > 120 then
    raise exception 'invalid AI stop reason' using errcode = '22023';
  end if;

  select usage.*
  into usage_row
  from public.ai_usage_ledger as usage
  where usage.id = target_operation_id
  for update;

  if not found then
    raise exception 'AI operation not found' using errcode = 'P0002';
  end if;
  if usage_row.requested_by_actor <> target_actor_id then
    raise exception 'AI operation actor mismatch' using errcode = '42501';
  end if;
  if usage_row.feature <> 'captions' then
    raise exception 'operation is not a caption session' using errcode = '22023';
  end if;
  if usage_row.status <> 'running' then
    return jsonb_build_object(
      'accepted', true,
      'idempotent_replay', true,
      'operation', to_jsonb(usage_row)
    );
  end if;

  perform 1
  from public.lecture_ai_control as control
  where control.lecture_session_id = usage_row.lecture_session_id
  for update;

  if charge_elapsed then
    actual_audio := least(
      usage_row.reserved_audio_seconds,
      greatest(
        0,
        ceil(extract(epoch from statement_timestamp() - usage_row.requested_at))::integer
      )
    );
    actual_cost := least(
      usage_row.reserved_microusd,
      ceil(
        actual_audio::numeric
        * coalesce(usage_row.pricing_rate_microusd, 0)::numeric
        / 60
      )::bigint
    );
  end if;

  update public.ai_usage_ledger as usage
  set
    status = 'cancelled',
    actual_microusd = actual_cost,
    actual_audio_seconds = actual_audio,
    actual_input_tokens = 0,
    actual_output_tokens = 0,
    result_accepted = false,
    error_code = target_reason,
    finished_at = statement_timestamp(),
    last_heartbeat_at = statement_timestamp()
  where usage.id = target_operation_id
  returning * into usage_row;

  update public.lecture_ai_control as control
  set
    captions_enabled = case when disable_feature then false else control.captions_enabled end,
    active_operation_count = greatest(control.active_operation_count - 1, 0),
    used_microusd = greatest(
      control.used_microusd - usage_row.reserved_microusd + actual_cost,
      0
    ),
    audio_seconds_used = greatest(
      control.audio_seconds_used - usage_row.reserved_audio_seconds + actual_audio,
      0
    ),
    input_tokens_used = greatest(
      control.input_tokens_used - usage_row.reserved_input_tokens,
      0
    ),
    output_tokens_used = greatest(
      control.output_tokens_used - usage_row.reserved_output_tokens,
      0
    ),
    status = case
      when control.active_operation_count - 1 > 0 then 'running'
      when (not disable_feature and control.captions_enabled)
        or control.summaries_enabled
        or control.material_analysis_enabled
        or control.poll_suggestions_enabled
        or control.academic_answers_enabled
        then 'ready'
      else 'stopped'
    end,
    stop_requested_at = case when disable_feature then statement_timestamp() else control.stop_requested_at end,
    stopped_at = case when disable_feature then statement_timestamp() else control.stopped_at end,
    stop_reason = case when disable_feature then target_reason else control.stop_reason end,
    last_heartbeat_at = statement_timestamp(),
    version = control.version + 1,
    updated_at = statement_timestamp()
  where control.lecture_session_id = usage_row.lecture_session_id;

  if disable_feature then
    delete from public.lecture_public_captions
    where lecture_session_id = usage_row.lecture_session_id;
    deleted_caption := found;
    if deleted_caption then
      perform private.bump_lecture_live_state(usage_row.lecture_session_id, 'caption');
    end if;
  end if;

  return jsonb_build_object(
    'accepted', true,
    'idempotent_replay', false,
    'operation', to_jsonb(usage_row)
  );
end;
$$;

create function public.admin_finish_realtime_caption_operation(
  target_operation_id uuid,
  target_actor_id text,
  target_reason text,
  charge_elapsed boolean default true,
  disable_feature boolean default true
)
returns jsonb
language sql
volatile
security invoker
set search_path = ''
as $$
  select private.finish_realtime_caption_operation(
    target_operation_id,
    target_actor_id,
    target_reason,
    charge_elapsed,
    disable_feature
  );
$$;

create function private.reap_stale_realtime_caption_operations(
  target_lecture_session_id uuid,
  batch_limit integer default 20
)
returns table(operation_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
  stale_operation record;
  effective_limit integer := least(greatest(batch_limit, 1), 100);
begin
  for stale_operation in
    select usage.id, usage.requested_by_actor
    from public.ai_usage_ledger as usage
    where usage.lecture_session_id = target_lecture_session_id
      and usage.feature = 'captions'
      and usage.status = 'running'
      and coalesce(usage.last_heartbeat_at, usage.requested_at)
        < statement_timestamp() - interval '45 seconds'
    order by coalesce(usage.last_heartbeat_at, usage.requested_at), usage.id
    limit effective_limit
    for update skip locked
  loop
    perform private.finish_realtime_caption_operation(
      stale_operation.id,
      stale_operation.requested_by_actor,
      'heartbeat_timeout',
      false,
      true
    );
    operation_id := stale_operation.id;
    return next;
  end loop;
end;
$$;

create function public.admin_reap_stale_realtime_caption_operations(
  target_lecture_session_id uuid,
  batch_limit integer default 20
)
returns table(operation_id uuid)
language sql
volatile
security invoker
set search_path = ''
as $$
  select *
  from private.reap_stale_realtime_caption_operations(
    target_lecture_session_id,
    batch_limit
  );
$$;

create function private.heartbeat_realtime_caption_operation(
  target_operation_id uuid,
  target_actor_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  usage_row public.ai_usage_ledger%rowtype;
  control_row public.lecture_ai_control%rowtype;
  lecture_row public.lecture_sessions%rowtype;
begin
  select usage.*
  into usage_row
  from public.ai_usage_ledger as usage
  where usage.id = target_operation_id;

  if not found or usage_row.requested_by_actor <> target_actor_id then
    return jsonb_build_object(
      'should_stop', true,
      'reason', 'operation_not_available',
      'server_time', statement_timestamp()
    );
  end if;

  perform private.close_lecture_if_expired(usage_row.lecture_session_id);

  select lecture.*
  into lecture_row
  from public.lecture_sessions as lecture
  where lecture.id = usage_row.lecture_session_id;

  select control.*
  into control_row
  from public.lecture_ai_control as control
  where control.lecture_session_id = usage_row.lecture_session_id;

  if usage_row.status <> 'running'
     or lecture_row.status <> 'open'
     or control_row.status not in ('ready', 'running')
     or not control_row.captions_enabled then
    return jsonb_build_object(
      'should_stop', true,
      'reason', 'operation_stopped',
      'hard_stop_at', lecture_row.hard_stop_at,
      'server_time', statement_timestamp()
    );
  end if;

  update public.ai_usage_ledger
  set last_heartbeat_at = statement_timestamp()
  where id = target_operation_id
    and status = 'running';

  update public.lecture_ai_control
  set
    last_heartbeat_at = statement_timestamp(),
    updated_at = statement_timestamp()
  where lecture_session_id = usage_row.lecture_session_id;

  return jsonb_build_object(
    'should_stop', false,
    'hard_stop_at', lecture_row.hard_stop_at,
    'server_time', statement_timestamp()
  );
end;
$$;

create function public.admin_heartbeat_realtime_caption_operation(
  target_operation_id uuid,
  target_actor_id text
)
returns jsonb
language sql
volatile
security invoker
set search_path = ''
as $$
  select private.heartbeat_realtime_caption_operation(
    target_operation_id,
    target_actor_id
  );
$$;

create function private.record_realtime_token_issue(
  target_operation_id uuid,
  target_actor_id text,
  target_model_id text,
  target_outcome text,
  target_provider_request_id text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  usage_row public.ai_usage_ledger%rowtype;
  audit_row public.ai_realtime_token_audit%rowtype;
begin
  if target_outcome not in ('issued', 'failed') then
    raise exception 'invalid Realtime token outcome' using errcode = '22023';
  end if;

  select usage.*
  into usage_row
  from public.ai_usage_ledger as usage
  where usage.id = target_operation_id;

  if not found or usage_row.requested_by_actor <> target_actor_id then
    raise exception 'AI operation actor mismatch' using errcode = '42501';
  end if;

  insert into public.ai_realtime_token_audit (
    lecture_session_id,
    operation_id,
    actor_id,
    model_id,
    outcome,
    provider_request_id
  ) values (
    usage_row.lecture_session_id,
    target_operation_id,
    target_actor_id,
    target_model_id,
    target_outcome,
    nullif(trim(target_provider_request_id), '')
  )
  returning * into audit_row;

  return to_jsonb(audit_row);
end;
$$;

create function public.admin_record_realtime_token_issue(
  target_operation_id uuid,
  target_actor_id text,
  target_model_id text,
  target_outcome text,
  target_provider_request_id text default null
)
returns jsonb
language sql
volatile
security invoker
set search_path = ''
as $$
  select private.record_realtime_token_issue(
    target_operation_id,
    target_actor_id,
    target_model_id,
    target_outcome,
    target_provider_request_id
  );
$$;

create function private.publish_lecture_caption(
  target_lecture_session_id uuid,
  target_operation_id uuid,
  target_text text,
  target_language text,
  target_last_item_id text,
  target_sequence bigint,
  target_actor_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  usage_row public.ai_usage_ledger%rowtype;
  control_row public.lecture_ai_control%rowtype;
  caption_row public.lecture_public_captions%rowtype;
  changed boolean := false;
  effective_now timestamptz := statement_timestamp();
begin
  if char_length(trim(coalesce(target_text, ''))) not between 1 and 1000 then
    raise exception 'caption text must contain 1 to 1000 characters' using errcode = '22023';
  end if;
  if target_language not in ('auto', 'en', 'ja', 'mixed', 'und') then
    raise exception 'invalid caption language' using errcode = '22023';
  end if;
  if char_length(coalesce(target_last_item_id, '')) not between 1 and 200
     or target_sequence < 0 then
    raise exception 'invalid caption sequence' using errcode = '22023';
  end if;

  perform private.close_lecture_if_expired(target_lecture_session_id);

  select usage.*
  into usage_row
  from public.ai_usage_ledger as usage
  where usage.id = target_operation_id
    and usage.lecture_session_id = target_lecture_session_id
  for update;

  if not found
     or usage_row.feature <> 'captions'
     or usage_row.status <> 'running'
     or usage_row.requested_by_actor <> target_actor_id then
    raise exception 'caption operation is not running' using errcode = 'P0001';
  end if;

  select control.*
  into control_row
  from public.lecture_ai_control as control
  where control.lecture_session_id = target_lecture_session_id
  for update;

  if not private.is_lecture_open(target_lecture_session_id)
     or control_row.status not in ('ready', 'running')
     or not control_row.captions_enabled then
    raise exception 'lecture captions are stopped' using errcode = 'P0001';
  end if;

  select caption.*
  into caption_row
  from public.lecture_public_captions as caption
  where caption.lecture_session_id = target_lecture_session_id
  for update;

  if not found
     or caption_row.text is distinct from trim(target_text)
     or caption_row.language is distinct from target_language
     or caption_row.last_item_id is distinct from target_last_item_id
     or caption_row.sequence is distinct from target_sequence then
    insert into public.lecture_public_captions as caption (
      lecture_session_id,
      text,
      language,
      last_item_id,
      sequence,
      window_started_at,
      window_ended_at,
      updated_at
    ) values (
      target_lecture_session_id,
      trim(target_text),
      target_language,
      target_last_item_id,
      target_sequence,
      effective_now - interval '45 seconds',
      effective_now,
      effective_now
    )
    on conflict (lecture_session_id) do update
    set
      text = excluded.text,
      language = excluded.language,
      last_item_id = excluded.last_item_id,
      sequence = excluded.sequence,
      window_started_at = excluded.window_started_at,
      window_ended_at = excluded.window_ended_at,
      updated_at = excluded.updated_at;
    changed := true;
    perform private.bump_lecture_live_state(target_lecture_session_id, 'caption');
  end if;

  return jsonb_build_object(
    'accepted', true,
    'changed', changed,
    'sequence', target_sequence,
    'updated_at', effective_now
  );
end;
$$;

create function public.admin_publish_lecture_caption(
  target_lecture_session_id uuid,
  target_operation_id uuid,
  target_text text,
  target_language text,
  target_last_item_id text,
  target_sequence bigint,
  target_actor_id text
)
returns jsonb
language sql
volatile
security invoker
set search_path = ''
as $$
  select private.publish_lecture_caption(
    target_lecture_session_id,
    target_operation_id,
    target_text,
    target_language,
    target_last_item_id,
    target_sequence,
    target_actor_id
  );
$$;

create function private.get_lecture_public_snapshot_v3(
  target_lecture_session_id uuid,
  known_lecture_version bigint default null,
  known_caption_version bigint default null,
  known_comments_version bigint default null,
  known_likes_version bigint default null,
  known_polls_version bigint default null,
  known_summaries_version bigint default null,
  known_pdf_version bigint default null,
  comment_cursor_created_at timestamptz default null,
  comment_cursor_id uuid default null,
  comment_limit integer default 100
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  payload jsonb;
  caption_payload jsonb := 'null'::jsonb;
begin
  if (select auth.uid()) is null
     or not exists (
       select 1
       from public.participants as participant
       where participant.lecture_session_id = target_lecture_session_id
         and participant.auth_user_id = (select auth.uid())
     ) then
    return null;
  end if;

  payload := private.get_lecture_public_snapshot_v2(
    target_lecture_session_id,
    known_lecture_version,
    known_caption_version,
    known_comments_version,
    known_likes_version,
    known_polls_version,
    known_summaries_version,
    known_pdf_version,
    comment_cursor_created_at,
    comment_cursor_id,
    comment_limit
  );

  if payload is null then
    return null;
  end if;

  if (payload -> 'changed') ? 'caption' then
    select jsonb_build_object(
      'text', caption.text,
      'language', caption.language,
      'last_item_id', caption.last_item_id,
      'sequence', caption.sequence,
      'window_started_at', caption.window_started_at,
      'window_ended_at', caption.window_ended_at,
      'updated_at', caption.updated_at
    )
    into caption_payload
    from public.lecture_public_captions as caption
    where caption.lecture_session_id = target_lecture_session_id
      and private.is_lecture_open(target_lecture_session_id);

    payload := jsonb_set(
      payload,
      '{changed,caption}',
      coalesce(caption_payload, 'null'::jsonb),
      true
    );
  end if;

  return payload;
end;
$$;

create function public.get_lecture_public_snapshot_v3(
  target_lecture_session_id uuid,
  known_lecture_version bigint default null,
  known_caption_version bigint default null,
  known_comments_version bigint default null,
  known_likes_version bigint default null,
  known_polls_version bigint default null,
  known_summaries_version bigint default null,
  known_pdf_version bigint default null,
  comment_cursor_created_at timestamptz default null,
  comment_cursor_id uuid default null,
  comment_limit integer default 100
)
returns jsonb
language sql
volatile
security invoker
set search_path = ''
as $$
  select private.get_lecture_public_snapshot_v3(
    target_lecture_session_id,
    known_lecture_version,
    known_caption_version,
    known_comments_version,
    known_likes_version,
    known_polls_version,
    known_summaries_version,
    known_pdf_version,
    comment_cursor_created_at,
    comment_cursor_id,
    comment_limit
  );
$$;

create function private.clear_public_caption_after_lecture_close()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'closed' and old.status is distinct from 'closed' then
    delete from public.lecture_public_captions
    where lecture_session_id = new.id;
    if found then
      perform private.bump_lecture_live_state(new.id, 'caption');
    end if;
  end if;
  return new;
end;
$$;

create trigger lecture_sessions_clear_public_caption
after update of status on public.lecture_sessions
for each row
execute function private.clear_public_caption_after_lecture_close();

revoke all on function private.issue_ai_billing_grant(uuid, text[], text, boolean, text)
  from public, anon, authenticated, service_role;
revoke all on function private.consume_ai_billing_grant_and_start_operations(
  uuid, text, uuid, jsonb, text
) from public, anon, authenticated, service_role;
revoke all on function private.finish_realtime_caption_operation(
  uuid, text, text, boolean, boolean
) from public, anon, authenticated, service_role;
revoke all on function private.reap_stale_realtime_caption_operations(uuid, integer)
  from public, anon, authenticated, service_role;
revoke all on function private.heartbeat_realtime_caption_operation(uuid, text)
  from public, anon, authenticated, service_role;
revoke all on function private.record_realtime_token_issue(uuid, text, text, text, text)
  from public, anon, authenticated, service_role;
revoke all on function private.publish_lecture_caption(
  uuid, uuid, text, text, text, bigint, text
) from public, anon, authenticated, service_role;
revoke all on function private.get_lecture_public_snapshot_v3(
  uuid, bigint, bigint, bigint, bigint, bigint, bigint, bigint,
  timestamptz, uuid, integer
) from public, anon, authenticated, service_role;
revoke all on function private.clear_public_caption_after_lecture_close()
  from public, anon, authenticated, service_role;

grant execute on function private.issue_ai_billing_grant(uuid, text[], text, boolean, text)
  to service_role;
grant execute on function private.consume_ai_billing_grant_and_start_operations(
  uuid, text, uuid, jsonb, text
) to service_role;
grant execute on function private.finish_realtime_caption_operation(
  uuid, text, text, boolean, boolean
) to service_role;
grant execute on function private.reap_stale_realtime_caption_operations(uuid, integer)
  to service_role;
grant execute on function private.heartbeat_realtime_caption_operation(uuid, text)
  to service_role;
grant execute on function private.record_realtime_token_issue(uuid, text, text, text, text)
  to service_role;
grant execute on function private.publish_lecture_caption(
  uuid, uuid, text, text, text, bigint, text
) to service_role;
grant execute on function private.get_lecture_public_snapshot_v3(
  uuid, bigint, bigint, bigint, bigint, bigint, bigint, bigint,
  timestamptz, uuid, integer
) to authenticated;

revoke all on function public.admin_issue_ai_billing_grant(uuid, text[], text, boolean, text)
  from public, anon, authenticated, service_role;
revoke all on function public.admin_consume_ai_billing_grant(uuid, text, uuid, jsonb, text)
  from public, anon, authenticated, service_role;
revoke all on function public.admin_finish_realtime_caption_operation(
  uuid, text, text, boolean, boolean
) from public, anon, authenticated, service_role;
revoke all on function public.admin_reap_stale_realtime_caption_operations(uuid, integer)
  from public, anon, authenticated, service_role;
revoke all on function public.admin_heartbeat_realtime_caption_operation(uuid, text)
  from public, anon, authenticated, service_role;
revoke all on function public.admin_record_realtime_token_issue(uuid, text, text, text, text)
  from public, anon, authenticated, service_role;
revoke all on function public.admin_publish_lecture_caption(
  uuid, uuid, text, text, text, bigint, text
) from public, anon, authenticated, service_role;
revoke all on function public.get_lecture_public_snapshot_v3(
  uuid, bigint, bigint, bigint, bigint, bigint, bigint, bigint,
  timestamptz, uuid, integer
) from public, anon, authenticated, service_role;

grant execute on function public.admin_issue_ai_billing_grant(uuid, text[], text, boolean, text)
  to service_role;
grant execute on function public.admin_consume_ai_billing_grant(uuid, text, uuid, jsonb, text)
  to service_role;
grant execute on function public.admin_finish_realtime_caption_operation(
  uuid, text, text, boolean, boolean
) to service_role;
grant execute on function public.admin_reap_stale_realtime_caption_operations(uuid, integer)
  to service_role;
grant execute on function public.admin_heartbeat_realtime_caption_operation(uuid, text)
  to service_role;
grant execute on function public.admin_record_realtime_token_issue(uuid, text, text, text, text)
  to service_role;
grant execute on function public.admin_publish_lecture_caption(
  uuid, uuid, text, text, text, bigint, text
) to service_role;
grant execute on function public.get_lecture_public_snapshot_v3(
  uuid, bigint, bigint, bigint, bigint, bigint, bigint, bigint,
  timestamptz, uuid, integer
) to authenticated;

comment on table public.ai_billing_grants is
  'Hashed, lecture/action/actor-scoped, two-minute, single-use billing authorization grants.';
comment on table public.lecture_public_captions is
  'Only the latest completed 45-second caption window; never audio, deltas, or the full transcript.';
comment on table public.ai_realtime_token_audit is
  'Content-free audit of Realtime client-secret issuance attempts. No token value is stored.';
