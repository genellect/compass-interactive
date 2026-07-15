-- Phase 4.1: split long-lived Realtime captions from bounded text work.
--
-- This is an expand-first compatibility migration. Existing public RPC
-- signatures remain unchanged. The usage ledger is authoritative; the
-- control-row counter is a reconciled cache. Every cooperative transition
-- acquires lecture -> control -> usage locks, while billing consumption owns
-- its grant before entering that canonical lecture-scoped order.

do $$
declare
  duplicate_lane record;
begin
  select
    usage.lecture_session_id,
    case when usage.feature = 'captions' then 'realtime' else 'batch' end as lane,
    count(*) as running_count
  into duplicate_lane
  from public.ai_usage_ledger as usage
  where usage.status = 'running'
  group by
    usage.lecture_session_id,
    case when usage.feature = 'captions' then 'realtime' else 'batch' end
  having count(*) > 1
  limit 1;

  if found then
    raise exception
      'Phase 4.1 cannot enforce AI lanes: lecture % has % running % operations',
      duplicate_lane.lecture_session_id,
      duplicate_lane.running_count,
      duplicate_lane.lane
      using errcode = '23505';
  end if;
end;
$$;

alter table public.lecture_ai_control
  alter column max_concurrent_operations set default 2;

update public.lecture_ai_control
set
  max_concurrent_operations = 2,
  updated_at = statement_timestamp()
where max_concurrent_operations = 1;

create unique index ai_usage_ledger_running_realtime_uidx
  on public.ai_usage_ledger (lecture_session_id)
  where status = 'running' and feature = 'captions';

create unique index ai_usage_ledger_running_batch_uidx
  on public.ai_usage_ledger (lecture_session_id)
  where status = 'running'
    and feature in (
      'summaries',
      'material_analysis',
      'poll_suggestions',
      'academic_answers'
    );

create function private.reconcile_lecture_ai_runtime_state(
  target_lecture_session_id uuid,
  preserve_terminal boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  control_row public.lecture_ai_control%rowtype;
  running_count integer;
  effective_status text;
begin
  perform 1
  from public.lecture_sessions as lecture
  where lecture.id = target_lecture_session_id
  for update;

  if not found then
    raise exception 'lecture not found' using errcode = 'P0002';
  end if;

  select control.*
  into control_row
  from public.lecture_ai_control as control
  where control.lecture_session_id = target_lecture_session_id
  for update;

  if not found then
    raise exception 'AI control is not configured' using errcode = 'P0001';
  end if;

  select count(*)::integer
  into running_count
  from public.ai_usage_ledger as usage
  where usage.lecture_session_id = target_lecture_session_id
    and usage.status = 'running';

  effective_status := case
    when preserve_terminal
      and control_row.status in ('stopping', 'stopped', 'failed')
      then control_row.status
    when running_count > 0 then 'running'
    when control_row.captions_enabled
      or control_row.summaries_enabled
      or control_row.material_analysis_enabled
      or control_row.poll_suggestions_enabled
      or control_row.academic_answers_enabled
      then 'ready'
    else 'disabled'
  end;

  update public.lecture_ai_control as control
  set
    active_operation_count = running_count,
    status = effective_status,
    version = control.version + case
      when control.active_operation_count is distinct from running_count
        or control.status is distinct from effective_status
        then 1
      else 0
    end,
    updated_at = case
      when control.active_operation_count is distinct from running_count
        or control.status is distinct from effective_status
        then statement_timestamp()
      else control.updated_at
    end
  where control.lecture_session_id = target_lecture_session_id
  returning * into control_row;

  return to_jsonb(control_row);
end;
$$;

do $$
declare
  target_lecture_session_id uuid;
begin
  for target_lecture_session_id in
    select control.lecture_session_id
    from public.lecture_ai_control as control
    order by control.lecture_session_id
  loop
    perform private.reconcile_lecture_ai_runtime_state(
      target_lecture_session_id,
      true
    );
  end loop;
end;
$$;

create or replace function private.close_lecture_core(
  target_lecture_session_id uuid,
  target_reason text,
  target_actor_type text,
  target_actor_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  lecture_row public.lecture_sessions%rowtype;
  effective_closed_at timestamptz;
  did_change boolean := false;
begin
  if target_reason not in ('manual', 'hard_stop', 'deadline_guard', 'system') then
    raise exception 'invalid lecture close reason' using errcode = '22023';
  end if;
  if target_actor_type not in (
    'admin', 'deadline_worker', 'deadline_guard', 'system'
  ) then
    raise exception 'invalid lecture close actor' using errcode = '22023';
  end if;
  if nullif(trim(target_actor_id), '') is null
     or char_length(target_actor_id) > 200 then
    raise exception 'invalid lecture close actor id' using errcode = '22023';
  end if;

  select lecture.*
  into lecture_row
  from public.lecture_sessions as lecture
  where lecture.id = target_lecture_session_id
  for update;

  if not found then
    raise exception 'lecture not found' using errcode = 'P0002';
  end if;

  if lecture_row.status = 'draft' then
    return jsonb_build_object(
      'changed', false,
      'lecture_session_id', lecture_row.id,
      'status', lecture_row.status,
      'reason', 'transition_not_allowed'
    );
  end if;

  if lecture_row.status = 'open' then
    -- Canonical AI lock order: lecture -> control -> usage rows by ID.
    perform 1
    from public.lecture_ai_control as control
    where control.lecture_session_id = target_lecture_session_id
    for update;

    perform 1
    from public.ai_usage_ledger as usage
    where usage.lecture_session_id = target_lecture_session_id
      and usage.status = 'running'
    order by usage.id
    for update;

    effective_closed_at := case
      when target_reason in ('hard_stop', 'deadline_guard')
        then lecture_row.hard_stop_at
      else statement_timestamp()
    end;

    update public.lecture_sessions as lecture
    set
      status = 'closed',
      ends_at = effective_closed_at,
      closed_at = effective_closed_at,
      close_reason = target_reason,
      close_actor_type = target_actor_type,
      close_actor_id = target_actor_id,
      archive_expires_at = effective_closed_at + interval '30 days',
      lifecycle_version = lecture.lifecycle_version + 1,
      updated_at = statement_timestamp()
    where lecture.id = target_lecture_session_id;

    update public.polls as poll
    set status = 'closed', updated_at = statement_timestamp()
    where poll.lecture_session_id = target_lecture_session_id
      and poll.status = 'open';

    update public.ai_usage_ledger as usage
    set
      status = 'cancelled',
      result_accepted = false,
      error_code = 'lecture_closed',
      finished_at = statement_timestamp()
    where usage.lecture_session_id = target_lecture_session_id
      and usage.status = 'running';

    update public.lecture_ai_control as control
    set
      status = 'stopped',
      active_operation_count = 0,
      stop_requested_at = statement_timestamp(),
      stopped_at = statement_timestamp(),
      stop_reason = 'lecture_closed',
      version = control.version + 1,
      updated_at = statement_timestamp()
    where control.lecture_session_id = target_lecture_session_id;

    insert into public.lecture_archive_state as archive (
      lecture_session_id,
      status,
      eligible_at,
      archived_at,
      restored_at,
      error_message,
      version,
      updated_at
    ) values (
      target_lecture_session_id,
      'retained',
      effective_closed_at + interval '30 days',
      null,
      null,
      null,
      0,
      statement_timestamp()
    )
    on conflict (lecture_session_id) do update
    set
      eligible_at = excluded.eligible_at,
      updated_at = excluded.updated_at
    where archive.status = 'retained';

    insert into public.lecture_lifecycle_events (
      lecture_session_id,
      event_key,
      event_type,
      actor_type,
      actor_id,
      reason,
      effective_at,
      metadata
    ) values (
      target_lecture_session_id,
      'close',
      'lecture_closed',
      target_actor_type,
      target_actor_id,
      target_reason,
      effective_closed_at,
      jsonb_build_object('processed_at', statement_timestamp())
    )
    on conflict (lecture_session_id, event_key) do nothing;

    did_change := true;

    select lecture.*
    into lecture_row
    from public.lecture_sessions as lecture
    where lecture.id = target_lecture_session_id;
  end if;

  return jsonb_build_object(
    'archive_expires_at', lecture_row.archive_expires_at,
    'changed', did_change,
    'closed_at', lecture_row.closed_at,
    'close_actor_id', lecture_row.close_actor_id,
    'close_actor_type', lecture_row.close_actor_type,
    'close_reason', lecture_row.close_reason,
    'hard_stop_at', lecture_row.hard_stop_at,
    'lecture_session_id', lecture_row.id,
    'status', lecture_row.status
  );
end;
$$;

create or replace function private.start_lecture_ai_operation(
  target_lecture_session_id uuid,
  target_feature text,
  target_idempotency_key text,
  estimated_microusd bigint,
  estimated_audio_seconds integer,
  estimated_input_tokens bigint,
  estimated_output_tokens bigint,
  target_actor_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  lecture_row public.lecture_sessions%rowtype;
  control_row public.lecture_ai_control%rowtype;
  existing_usage public.ai_usage_ledger%rowtype;
  created_usage public.ai_usage_ledger%rowtype;
  feature_is_enabled boolean;
  rejection_reason text;
  rejection_lane text;
  realtime_running_count integer;
  batch_running_count integer;
  total_running_count integer;
begin
  if target_feature not in (
    'captions',
    'summaries',
    'material_analysis',
    'poll_suggestions',
    'academic_answers'
  ) then
    raise exception 'invalid AI feature' using errcode = '22023';
  end if;
  if char_length(coalesce(target_idempotency_key, '')) not between 8 and 160 then
    raise exception 'invalid AI idempotency key' using errcode = '22023';
  end if;
  if nullif(trim(target_actor_id), '') is null
     or char_length(target_actor_id) > 200 then
    raise exception 'invalid AI actor id' using errcode = '22023';
  end if;
  if least(
    estimated_microusd,
    estimated_audio_seconds::bigint,
    estimated_input_tokens,
    estimated_output_tokens
  ) < 0 then
    raise exception 'AI reservations cannot be negative' using errcode = '22023';
  end if;

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
     or lecture_row.hard_stop_at <= statement_timestamp() then
    raise exception 'lecture is not open' using errcode = 'P0001';
  end if;

  select control.*
  into control_row
  from public.lecture_ai_control as control
  where control.lecture_session_id = target_lecture_session_id
  for update;

  if not found then
    raise exception 'AI control is not configured' using errcode = 'P0001';
  end if;

  select usage.*
  into existing_usage
  from public.ai_usage_ledger as usage
  where usage.lecture_session_id = target_lecture_session_id
    and usage.idempotency_key = target_idempotency_key;

  if found then
    if existing_usage.feature <> target_feature then
      raise exception 'AI idempotency key feature mismatch' using errcode = '22023';
    end if;
    return jsonb_build_object(
      'accepted', true,
      'idempotent_replay', true,
      'operation', to_jsonb(existing_usage)
    );
  end if;

  select
    count(*) filter (where usage.feature = 'captions')::integer,
    count(*) filter (where usage.feature <> 'captions')::integer,
    count(*)::integer
  into realtime_running_count, batch_running_count, total_running_count
  from public.ai_usage_ledger as usage
  where usage.lecture_session_id = target_lecture_session_id
    and usage.status = 'running';

  feature_is_enabled := case target_feature
    when 'captions' then control_row.captions_enabled
    when 'summaries' then control_row.summaries_enabled
    when 'material_analysis' then control_row.material_analysis_enabled
    when 'poll_suggestions' then control_row.poll_suggestions_enabled
    when 'academic_answers' then control_row.academic_answers_enabled
    else false
  end;

  if control_row.status not in ('ready', 'running') then
    rejection_reason := 'ai_control_not_ready';
  elsif not feature_is_enabled then
    rejection_reason := 'feature_disabled';
  elsif target_feature = 'captions' and realtime_running_count >= 1 then
    rejection_reason := 'concurrency_limit';
    rejection_lane := 'realtime';
  elsif target_feature <> 'captions' and batch_running_count >= 1 then
    rejection_reason := 'concurrency_limit';
    rejection_lane := 'batch';
  elsif total_running_count >= control_row.max_concurrent_operations then
    rejection_reason := 'concurrency_limit';
    rejection_lane := 'global';
  elsif control_row.used_microusd + estimated_microusd
      > control_row.budget_limit_microusd then
    rejection_reason := 'budget_limit';
  elsif control_row.audio_seconds_used + estimated_audio_seconds
      > control_row.audio_seconds_limit then
    rejection_reason := 'audio_limit';
  elsif control_row.input_tokens_used + estimated_input_tokens
      > control_row.input_token_limit then
    rejection_reason := 'input_token_limit';
  elsif control_row.output_tokens_used + estimated_output_tokens
      > control_row.output_token_limit then
    rejection_reason := 'output_token_limit';
  elsif target_feature = 'summaries'
      and control_row.summary_calls_used >= control_row.summary_call_limit then
    rejection_reason := 'summary_call_limit';
  elsif target_feature = 'material_analysis'
      and control_row.material_analysis_calls_used
        >= control_row.material_analysis_call_limit then
    rejection_reason := 'material_analysis_call_limit';
  elsif target_feature = 'poll_suggestions'
      and control_row.poll_generation_calls_used
        >= control_row.poll_generation_limit then
    rejection_reason := 'poll_generation_limit';
  elsif target_feature = 'academic_answers'
      and control_row.academic_answer_calls_used
        >= control_row.academic_answer_limit then
    rejection_reason := 'academic_answer_limit';
  end if;

  if rejection_reason is not null then
    return jsonb_strip_nulls(jsonb_build_object(
      'accepted', false,
      'idempotent_replay', false,
      'reason', rejection_reason,
      'concurrency_lane', rejection_lane,
      'retryable', case when rejection_reason = 'concurrency_limit' then true else null end
    ));
  end if;

  begin
    insert into public.ai_usage_ledger (
      lecture_session_id,
      feature,
      idempotency_key,
      requested_by_actor,
      reserved_microusd,
      reserved_audio_seconds,
      reserved_input_tokens,
      reserved_output_tokens
    ) values (
      target_lecture_session_id,
      target_feature,
      target_idempotency_key,
      target_actor_id,
      estimated_microusd,
      estimated_audio_seconds,
      estimated_input_tokens,
      estimated_output_tokens
    )
    returning * into created_usage;
  exception
    when unique_violation then
      select usage.*
      into existing_usage
      from public.ai_usage_ledger as usage
      where usage.lecture_session_id = target_lecture_session_id
        and usage.idempotency_key = target_idempotency_key;

      if found then
        if existing_usage.feature <> target_feature then
          raise exception 'AI idempotency key feature mismatch' using errcode = '22023';
        end if;
        return jsonb_build_object(
          'accepted', true,
          'idempotent_replay', true,
          'operation', to_jsonb(existing_usage)
        );
      end if;

      return jsonb_build_object(
        'accepted', false,
        'idempotent_replay', false,
        'reason', 'concurrency_limit',
        'concurrency_lane', case
          when target_feature = 'captions' then 'realtime'
          else 'batch'
        end,
        'retryable', true
      );
  end;

  update public.lecture_ai_control as control
  set
    status = 'running',
    active_operation_count = total_running_count + 1,
    used_microusd = control.used_microusd + estimated_microusd,
    audio_seconds_used = control.audio_seconds_used + estimated_audio_seconds,
    input_tokens_used = control.input_tokens_used + estimated_input_tokens,
    output_tokens_used = control.output_tokens_used + estimated_output_tokens,
    summary_calls_used = control.summary_calls_used
      + case when target_feature = 'summaries' then 1 else 0 end,
    material_analysis_calls_used = control.material_analysis_calls_used
      + case when target_feature = 'material_analysis' then 1 else 0 end,
    poll_generation_calls_used = control.poll_generation_calls_used
      + case when target_feature = 'poll_suggestions' then 1 else 0 end,
    academic_answer_calls_used = control.academic_answer_calls_used
      + case when target_feature = 'academic_answers' then 1 else 0 end,
    started_at = coalesce(control.started_at, statement_timestamp()),
    last_heartbeat_at = statement_timestamp(),
    version = control.version + 1,
    updated_at = statement_timestamp()
  where control.lecture_session_id = target_lecture_session_id;

  return jsonb_build_object(
    'accepted', true,
    'idempotent_replay', false,
    'operation', to_jsonb(created_usage)
  );
end;
$$;

create or replace function private.finish_lecture_ai_operation(
  target_operation_id uuid,
  target_status text,
  actual_microusd bigint,
  actual_audio_seconds integer,
  actual_input_tokens bigint,
  actual_output_tokens bigint,
  provider_request_id text,
  error_code text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  initial_usage public.ai_usage_ledger%rowtype;
  usage_row public.ai_usage_ledger%rowtype;
  control_row public.lecture_ai_control%rowtype;
  lecture_row public.lecture_sessions%rowtype;
  effective_status text;
  accept_result boolean;
  remaining_running_count integer;
begin
  if target_status not in ('succeeded', 'failed', 'cancelled') then
    raise exception 'invalid AI completion status' using errcode = '22023';
  end if;
  if least(
    actual_microusd,
    actual_audio_seconds::bigint,
    actual_input_tokens,
    actual_output_tokens
  ) < 0 then
    raise exception 'AI actual usage cannot be negative' using errcode = '22023';
  end if;

  select usage.*
  into initial_usage
  from public.ai_usage_ledger as usage
  where usage.id = target_operation_id;

  if not found then
    raise exception 'AI operation not found' using errcode = 'P0002';
  end if;

  perform private.close_lecture_if_expired(initial_usage.lecture_session_id);

  select lecture.*
  into lecture_row
  from public.lecture_sessions as lecture
  where lecture.id = initial_usage.lecture_session_id
  for update;

  select control.*
  into control_row
  from public.lecture_ai_control as control
  where control.lecture_session_id = initial_usage.lecture_session_id
  for update;

  if not found then
    raise exception 'AI control is not configured' using errcode = 'P0001';
  end if;

  select usage.*
  into usage_row
  from public.ai_usage_ledger as usage
  where usage.id = target_operation_id
  for update;

  if usage_row.status <> 'running' then
    return jsonb_build_object(
      'accepted', usage_row.result_accepted,
      'idempotent_replay', true,
      'operation', to_jsonb(usage_row)
    );
  end if;

  accept_result := target_status = 'succeeded'
    and lecture_row.status = 'open'
    and lecture_row.hard_stop_at > statement_timestamp()
    and control_row.status not in ('stopping', 'stopped');
  effective_status := case
    when target_status = 'succeeded' and not accept_result then 'discarded'
    else target_status
  end;

  update public.ai_usage_ledger as usage
  set
    status = effective_status,
    actual_microusd = finish_lecture_ai_operation.actual_microusd,
    actual_audio_seconds = finish_lecture_ai_operation.actual_audio_seconds,
    actual_input_tokens = finish_lecture_ai_operation.actual_input_tokens,
    actual_output_tokens = finish_lecture_ai_operation.actual_output_tokens,
    provider_request_id = nullif(trim(finish_lecture_ai_operation.provider_request_id), ''),
    error_code = nullif(trim(finish_lecture_ai_operation.error_code), ''),
    result_accepted = accept_result,
    finished_at = statement_timestamp()
  where usage.id = target_operation_id
  returning * into usage_row;

  select count(*)::integer
  into remaining_running_count
  from public.ai_usage_ledger as usage
  where usage.lecture_session_id = usage_row.lecture_session_id
    and usage.status = 'running';

  update public.lecture_ai_control as control
  set
    active_operation_count = remaining_running_count,
    status = case
      when control.status in ('stopping', 'stopped') then 'stopped'
      when remaining_running_count > 0 then 'running'
      when control.captions_enabled
        or control.summaries_enabled
        or control.material_analysis_enabled
        or control.poll_suggestions_enabled
        or control.academic_answers_enabled
        then 'ready'
      else 'disabled'
    end,
    used_microusd = control.used_microusd
      + greatest(actual_microusd - usage_row.reserved_microusd, 0),
    audio_seconds_used = control.audio_seconds_used
      + greatest(actual_audio_seconds - usage_row.reserved_audio_seconds, 0),
    input_tokens_used = control.input_tokens_used
      + greatest(actual_input_tokens - usage_row.reserved_input_tokens, 0),
    output_tokens_used = control.output_tokens_used
      + greatest(actual_output_tokens - usage_row.reserved_output_tokens, 0),
    last_heartbeat_at = statement_timestamp(),
    stopped_at = case
      when control.status in ('stopping', 'stopped') then statement_timestamp()
      else control.stopped_at
    end,
    version = control.version + 1,
    updated_at = statement_timestamp()
  where control.lecture_session_id = usage_row.lecture_session_id;

  return jsonb_build_object(
    'accepted', accept_result,
    'idempotent_replay', false,
    'operation', to_jsonb(usage_row)
  );
end;
$$;

create or replace function private.stop_lecture_ai_control(
  target_lecture_session_id uuid,
  target_reason text,
  target_actor_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  control_row public.lecture_ai_control%rowtype;
begin
  if nullif(trim(target_reason), '') is null
     or char_length(target_reason) > 120 then
    raise exception 'invalid AI stop reason' using errcode = '22023';
  end if;
  if nullif(trim(target_actor_id), '') is null
     or char_length(target_actor_id) > 200 then
    raise exception 'invalid AI stop actor' using errcode = '22023';
  end if;

  perform 1
  from public.lecture_sessions as lecture
  where lecture.id = target_lecture_session_id
  for update;

  if not found then
    raise exception 'lecture not found' using errcode = 'P0002';
  end if;

  select control.*
  into control_row
  from public.lecture_ai_control as control
  where control.lecture_session_id = target_lecture_session_id
  for update;

  if not found then
    raise exception 'AI control is not configured' using errcode = 'P0001';
  end if;

  perform 1
  from public.ai_usage_ledger as usage
  where usage.lecture_session_id = target_lecture_session_id
    and usage.status = 'running'
  order by usage.id
  for update;

  update public.ai_usage_ledger as usage
  set
    status = 'cancelled',
    result_accepted = false,
    error_code = 'admin_stop',
    finished_at = statement_timestamp()
  where usage.lecture_session_id = target_lecture_session_id
    and usage.status = 'running';

  update public.lecture_ai_control as control
  set
    status = 'stopped',
    active_operation_count = 0,
    stop_requested_at = statement_timestamp(),
    stopped_at = statement_timestamp(),
    stop_reason = target_reason,
    version = control.version + 1,
    updated_at = statement_timestamp()
  where control.lecture_session_id = target_lecture_session_id
  returning * into control_row;

  return to_jsonb(control_row) || jsonb_build_object('actor_id', target_actor_id);
end;
$$;

create or replace function private.issue_ai_billing_grant(
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

  -- Grant issuance never touches control/usage rows. This keeps the lock graph
  -- lecture -> PIN rate-limit only. Stale work is reconciled at consumption or
  -- by the service-only reaper.
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

create or replace function private.consume_ai_billing_grant_and_start_operations(
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
  requested_realtime_count integer;
  requested_batch_count integer;
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

  -- Billing-specific lock order: grant -> lecture -> control -> usage.
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
    count(distinct feature),
    count(*) filter (where feature = 'captions'),
    count(*) filter (where feature <> 'captions')
  into
    operation_features,
    operation_count,
    distinct_feature_count,
    requested_realtime_count,
    requested_batch_count
  from (
    select value ->> 'feature' as feature
    from jsonb_array_elements(target_operations)
  ) as requested;

  if operation_count <> distinct_feature_count
     or operation_features <> grant_row.actions then
    return jsonb_build_object('accepted', false, 'reason', 'grant_scope_mismatch');
  end if;

  if requested_realtime_count > 1 or requested_batch_count > 1 then
    return jsonb_build_object(
      'accepted', false,
      'reason', 'grant_lane_conflict',
      'concurrency_lane', case
        when requested_realtime_count > 1 then 'realtime'
        else 'batch'
      end
    );
  end if;

  perform private.reap_stale_realtime_caption_operations(
    target_lecture_session_id,
    20
  );
  perform private.close_lecture_if_expired(target_lecture_session_id);

  if not private.is_lecture_open(target_lecture_session_id) then
    return jsonb_build_object('accepted', false, 'reason', 'lecture_not_open');
  end if;

  update public.lecture_ai_control as control
  set
    status = case
      when exists (
        select 1
        from public.ai_usage_ledger as usage
        where usage.lecture_session_id = target_lecture_session_id
          and usage.status = 'running'
      ) then 'running'
      else 'ready'
    end,
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

create or replace function private.finish_realtime_caption_operation(
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
  initial_usage public.ai_usage_ledger%rowtype;
  usage_row public.ai_usage_ledger%rowtype;
  control_row public.lecture_ai_control%rowtype;
  actual_audio integer := 0;
  actual_cost bigint := 0;
  remaining_running_count integer;
  any_other_feature_enabled boolean;
  deleted_caption boolean := false;
begin
  if nullif(trim(target_reason), '') is null
     or char_length(target_reason) > 120 then
    raise exception 'invalid AI stop reason' using errcode = '22023';
  end if;

  select usage.*
  into initial_usage
  from public.ai_usage_ledger as usage
  where usage.id = target_operation_id;

  if not found then
    raise exception 'AI operation not found' using errcode = 'P0002';
  end if;
  if initial_usage.requested_by_actor <> target_actor_id then
    raise exception 'AI operation actor mismatch' using errcode = '42501';
  end if;
  if initial_usage.feature <> 'captions' then
    raise exception 'operation is not a caption session' using errcode = '22023';
  end if;

  perform private.close_lecture_if_expired(initial_usage.lecture_session_id);

  perform 1
  from public.lecture_sessions as lecture
  where lecture.id = initial_usage.lecture_session_id
  for update;

  select control.*
  into control_row
  from public.lecture_ai_control as control
  where control.lecture_session_id = initial_usage.lecture_session_id
  for update;

  if not found then
    raise exception 'AI control is not configured' using errcode = 'P0001';
  end if;

  select usage.*
  into usage_row
  from public.ai_usage_ledger as usage
  where usage.id = target_operation_id
  for update;

  if usage_row.status <> 'running' then
    return jsonb_build_object(
      'accepted', true,
      'idempotent_replay', true,
      'operation', to_jsonb(usage_row)
    );
  end if;

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

  select count(*)::integer
  into remaining_running_count
  from public.ai_usage_ledger as usage
  where usage.lecture_session_id = usage_row.lecture_session_id
    and usage.status = 'running';

  any_other_feature_enabled :=
    control_row.summaries_enabled
    or control_row.material_analysis_enabled
    or control_row.poll_suggestions_enabled
    or control_row.academic_answers_enabled;

  update public.lecture_ai_control as control
  set
    captions_enabled = case
      when disable_feature then false
      else control.captions_enabled
    end,
    active_operation_count = remaining_running_count,
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
      when remaining_running_count > 0 then 'running'
      when any_other_feature_enabled
        or (not disable_feature and control.captions_enabled)
        then 'ready'
      when disable_feature then 'stopped'
      else 'disabled'
    end,
    stop_requested_at = case
      when disable_feature
        and remaining_running_count = 0
        and not any_other_feature_enabled
        then statement_timestamp()
      else control.stop_requested_at
    end,
    stopped_at = case
      when disable_feature
        and remaining_running_count = 0
        and not any_other_feature_enabled
        then statement_timestamp()
      else control.stopped_at
    end,
    stop_reason = case
      when disable_feature
        and remaining_running_count = 0
        and not any_other_feature_enabled
        then target_reason
      else control.stop_reason
    end,
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

create or replace function private.reap_stale_realtime_caption_operations(
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
  perform private.close_lecture_if_expired(target_lecture_session_id);

  perform 1
  from public.lecture_sessions as lecture
  where lecture.id = target_lecture_session_id
  for update;

  if not found then
    return;
  end if;

  perform 1
  from public.lecture_ai_control as control
  where control.lecture_session_id = target_lecture_session_id
  for update;

  if not found then
    return;
  end if;

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

create or replace function private.heartbeat_realtime_caption_operation(
  target_operation_id uuid,
  target_actor_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  initial_usage public.ai_usage_ledger%rowtype;
  usage_row public.ai_usage_ledger%rowtype;
  control_row public.lecture_ai_control%rowtype;
  lecture_row public.lecture_sessions%rowtype;
begin
  select usage.*
  into initial_usage
  from public.ai_usage_ledger as usage
  where usage.id = target_operation_id;

  if not found or initial_usage.requested_by_actor <> target_actor_id then
    return jsonb_build_object(
      'should_stop', true,
      'reason', 'operation_not_available',
      'server_time', statement_timestamp()
    );
  end if;

  perform private.close_lecture_if_expired(initial_usage.lecture_session_id);

  select lecture.*
  into lecture_row
  from public.lecture_sessions as lecture
  where lecture.id = initial_usage.lecture_session_id
  for update;

  select control.*
  into control_row
  from public.lecture_ai_control as control
  where control.lecture_session_id = initial_usage.lecture_session_id
  for update;

  select usage.*
  into usage_row
  from public.ai_usage_ledger as usage
  where usage.id = target_operation_id
  for update;

  if usage_row.status <> 'running'
     or lecture_row.status <> 'open'
     or lecture_row.hard_stop_at <= statement_timestamp()
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

create or replace function private.publish_lecture_caption(
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
  lecture_row public.lecture_sessions%rowtype;
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

  select lecture.*
  into lecture_row
  from public.lecture_sessions as lecture
  where lecture.id = target_lecture_session_id
  for update;

  select control.*
  into control_row
  from public.lecture_ai_control as control
  where control.lecture_session_id = target_lecture_session_id
  for update;

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

  if lecture_row.status <> 'open'
     or lecture_row.hard_stop_at <= effective_now
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

revoke all on function private.reconcile_lecture_ai_runtime_state(uuid, boolean)
  from public, anon, authenticated, service_role;

comment on function private.reconcile_lecture_ai_runtime_state(uuid, boolean) is
  'Repairs the cached active-operation count from the authoritative usage ledger; callers follow lecture-control-usage lock order.';
comment on index public.ai_usage_ledger_running_realtime_uidx is
  'Hard invariant: at most one running Realtime caption session per lecture.';
comment on index public.ai_usage_ledger_running_batch_uidx is
  'Hard invariant: at most one running bounded text operation per lecture.';
