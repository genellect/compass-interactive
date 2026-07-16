-- Phase 6.6 Realtime provider control hardening.
-- Additive migration: existing Phase 0-6.6 client RPC signatures remain intact.

create table public.ai_realtime_provider_calls (
  operation_id uuid primary key
    references public.ai_usage_ledger(id) on delete restrict,
  lecture_session_id uuid not null
    references public.lecture_sessions(id) on delete restrict,
  actor_id text not null check (char_length(actor_id) between 1 and 200),
  provider_call_id text unique check (
    provider_call_id is null
    or (
      char_length(provider_call_id) between 3 and 200
      and provider_call_id ~ '^[A-Za-z0-9_-]+$'
    )
  ),
  provider_request_id text check (
    provider_request_id is null
    or char_length(provider_request_id) <= 200
  ),
  status text not null default 'creating' check (
    status in (
      'creating',
      'active',
      'creation_failed',
      'stop_requested',
      'hanging_up',
      'retry',
      'stopped'
    )
  ),
  stop_reason text check (
    stop_reason is null or char_length(stop_reason) <= 120
  ),
  attempt_count integer not null default 0
    check (attempt_count between 0 and 1000000),
  next_attempt_at timestamptz not null default statement_timestamp(),
  lease_until timestamptz,
  last_error text check (
    last_error is null or char_length(last_error) <= 500
  ),
  created_at timestamptz not null default statement_timestamp(),
  activated_at timestamptz,
  stop_requested_at timestamptz,
  stopped_at timestamptz,
  updated_at timestamptz not null default statement_timestamp(),
  check (
    status in ('creating', 'creation_failed')
    or provider_call_id is not null
  ),
  check (status <> 'active' or activated_at is not null),
  check (status <> 'hanging_up' or lease_until is not null),
  check (status <> 'stopped' or stopped_at is not null)
);

create index ai_realtime_provider_calls_claim_idx
  on public.ai_realtime_provider_calls (
    status,
    next_attempt_at,
    operation_id
  )
  where provider_call_id is not null
    and status in ('stop_requested', 'hanging_up', 'retry');

create index ai_realtime_provider_calls_lecture_idx
  on public.ai_realtime_provider_calls (
    lecture_session_id,
    status,
    updated_at
  );

alter table public.ai_realtime_provider_calls enable row level security;
revoke all on public.ai_realtime_provider_calls
  from public, anon, authenticated;
grant select on public.ai_realtime_provider_calls to service_role;

create function private.consume_realtime_billing_grant_and_prepare_call(
  target_grant_id uuid,
  target_nonce_hash text,
  target_lecture_session_id uuid,
  target_operations jsonb,
  target_actor_id text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  requested_operation jsonb;
  target_idempotency_key text;
  existing_usage public.ai_usage_ledger%rowtype;
  start_result jsonb;
  started_operation_id uuid;
begin
  if jsonb_typeof(target_operations) <> 'array'
     or jsonb_array_length(target_operations) <> 1 then
    raise exception 'Realtime start requires exactly one operation'
      using errcode = '22023';
  end if;

  requested_operation := target_operations -> 0;
  if requested_operation ->> 'feature' <> 'captions' then
    raise exception 'Realtime start requires a caption operation'
      using errcode = '22023';
  end if;

  target_idempotency_key := requested_operation ->> 'idempotency_key';
  if char_length(coalesce(target_idempotency_key, '')) not between 8 and 160 then
    raise exception 'invalid AI idempotency key' using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      target_lecture_session_id::text || ':' || target_idempotency_key,
      0
    )
  );

  select usage.*
  into existing_usage
  from public.ai_usage_ledger as usage
  where usage.lecture_session_id = target_lecture_session_id
    and usage.idempotency_key = target_idempotency_key;

  if found then
    return jsonb_build_object(
      'accepted', false,
      'reason', 'idempotent_replay',
      'operation', to_jsonb(existing_usage)
    );
  end if;

  start_result := private.consume_ai_billing_grant_and_start_operations(
    target_grant_id,
    target_nonce_hash,
    target_lecture_session_id,
    target_operations,
    target_actor_id
  );

  if coalesce((start_result ->> 'accepted')::boolean, false) is not true then
    return start_result;
  end if;

  started_operation_id :=
    (start_result #>> '{operations,0,operation,id}')::uuid;
  if started_operation_id is null
     or coalesce(
       (start_result #>> '{operations,0,idempotent_replay}')::boolean,
       false
     ) then
    raise exception 'Realtime operation was not created'
      using errcode = 'P0001';
  end if;

  insert into public.ai_realtime_provider_calls (
    operation_id,
    lecture_session_id,
    actor_id,
    status
  )
  values (
    started_operation_id,
    target_lecture_session_id,
    target_actor_id,
    'creating'
  );

  return start_result || jsonb_build_object(
    'provider_call_prepared', true
  );
end;
$$;

create function public.admin_consume_realtime_billing_grant(
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
  select private.consume_realtime_billing_grant_and_prepare_call(
    target_grant_id,
    target_nonce_hash,
    target_lecture_session_id,
    target_operations,
    target_actor_id
  );
$$;

create function private.activate_realtime_provider_call(
  target_operation_id uuid,
  target_actor_id text,
  target_provider_call_id text,
  target_provider_request_id text default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  call_row public.ai_realtime_provider_calls%rowtype;
  usage_row public.ai_usage_ledger%rowtype;
  effective_now timestamptz := statement_timestamp();
  canonical_call_id text := trim(coalesce(target_provider_call_id, ''));
begin
  if char_length(canonical_call_id) not between 3 and 200
     or canonical_call_id !~ '^[A-Za-z0-9_-]+$' then
    raise exception 'invalid Realtime provider call id'
      using errcode = '22023';
  end if;
  if char_length(coalesce(target_provider_request_id, '')) > 200 then
    raise exception 'invalid Realtime provider request id'
      using errcode = '22023';
  end if;

  select provider_call.*
  into call_row
  from public.ai_realtime_provider_calls as provider_call
  where provider_call.operation_id = target_operation_id
  for update;

  if not found or call_row.actor_id <> target_actor_id then
    raise exception 'Realtime provider call is not available'
      using errcode = '42501';
  end if;

  if call_row.provider_call_id is not null then
    if call_row.provider_call_id = canonical_call_id then
      return jsonb_build_object(
        'accepted', call_row.status = 'active',
        'idempotent_replay', true,
        'should_hangup', call_row.status <> 'active',
        'status', call_row.status
      );
    end if;
    raise exception 'Realtime provider call is already registered'
      using errcode = '23505';
  end if;

  select usage.*
  into usage_row
  from public.ai_usage_ledger as usage
  where usage.id = target_operation_id
  for update;

  if not found
     or usage_row.feature <> 'captions'
     or usage_row.requested_by_actor <> target_actor_id then
    raise exception 'Realtime operation is not available'
      using errcode = '42501';
  end if;

  update public.ai_realtime_provider_calls as provider_call
  set
    provider_call_id = canonical_call_id,
    provider_request_id =
      nullif(trim(coalesce(target_provider_request_id, '')), ''),
    status = case
      when usage_row.status = 'running' then 'active'
      else 'stop_requested'
    end,
    activated_at = effective_now,
    stop_requested_at = case
      when usage_row.status = 'running' then null
      else effective_now
    end,
    stop_reason = case
      when usage_row.status = 'running' then null
      else coalesce(usage_row.error_code, 'operation_stopped')
    end,
    next_attempt_at = effective_now,
    lease_until = null,
    last_error = null,
    updated_at = effective_now
  where provider_call.operation_id = target_operation_id
  returning * into call_row;

  return jsonb_build_object(
    'accepted', call_row.status = 'active',
    'idempotent_replay', false,
    'should_hangup', call_row.status <> 'active',
    'status', call_row.status
  );
end;
$$;

create function public.admin_activate_realtime_provider_call(
  target_operation_id uuid,
  target_actor_id text,
  target_provider_call_id text,
  target_provider_request_id text default null
)
returns jsonb
language sql
volatile
security invoker
set search_path = ''
as $$
  select private.activate_realtime_provider_call(
    target_operation_id,
    target_actor_id,
    target_provider_call_id,
    target_provider_request_id
  );
$$;

create function private.fail_realtime_provider_call_creation(
  target_operation_id uuid,
  target_actor_id text,
  target_error text
)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if nullif(trim(target_error), '') is null then
    raise exception 'Realtime provider error is required'
      using errcode = '22023';
  end if;

  update public.ai_realtime_provider_calls as provider_call
  set
    status = case
      when provider_call.provider_call_id is null
        then 'creation_failed'
      else 'stop_requested'
    end,
    stop_reason = 'provider_call_creation_failed',
    stop_requested_at = statement_timestamp(),
    next_attempt_at = statement_timestamp(),
    lease_until = null,
    last_error = left(target_error, 500),
    updated_at = statement_timestamp()
  where provider_call.operation_id = target_operation_id
    and provider_call.actor_id = target_actor_id
    and provider_call.status <> 'stopped';

  return found;
end;
$$;

create function public.admin_fail_realtime_provider_call_creation(
  target_operation_id uuid,
  target_actor_id text,
  target_error text
)
returns boolean
language sql
volatile
security invoker
set search_path = ''
as $$
  select private.fail_realtime_provider_call_creation(
    target_operation_id,
    target_actor_id,
    target_error
  );
$$;

create function private.enqueue_realtime_provider_hangup()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if old.status = 'running' and new.status <> 'running' then
    update public.ai_realtime_provider_calls as provider_call
    set
      status = case
        when provider_call.provider_call_id is null
          then 'creation_failed'
        else 'stop_requested'
      end,
      stop_reason = left(
        coalesce(new.error_code, 'operation_stopped'),
        120
      ),
      stop_requested_at = statement_timestamp(),
      next_attempt_at = statement_timestamp(),
      lease_until = null,
      updated_at = statement_timestamp()
    where provider_call.operation_id = new.id
      and provider_call.status <> 'stopped';
  end if;
  return new;
end;
$$;

create trigger ai_usage_ledger_enqueue_realtime_provider_hangup
after update of status on public.ai_usage_ledger
for each row
execute function private.enqueue_realtime_provider_hangup();

create function private.claim_realtime_provider_hangups(
  job_limit integer default 10,
  target_operation_id uuid default null,
  target_lecture_session_id uuid default null
)
returns table (
  operation_id uuid,
  lecture_session_id uuid,
  provider_call_id text,
  attempt_count integer
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  effective_limit integer := least(greatest(job_limit, 1), 50);
begin
  return query
  with candidates as (
    select provider_call.operation_id
    from public.ai_realtime_provider_calls as provider_call
    where provider_call.provider_call_id is not null
      and (
        provider_call.status in ('stop_requested', 'retry')
        or (
          provider_call.status = 'hanging_up'
          and provider_call.lease_until <= statement_timestamp()
        )
      )
      and provider_call.next_attempt_at <= statement_timestamp()
      and (
        target_operation_id is null
        or provider_call.operation_id = target_operation_id
      )
      and (
        target_lecture_session_id is null
        or provider_call.lecture_session_id = target_lecture_session_id
      )
    order by
      provider_call.next_attempt_at,
      provider_call.operation_id
    for update skip locked
    limit effective_limit
  )
  update public.ai_realtime_provider_calls as provider_call
  set
    status = 'hanging_up',
    attempt_count = provider_call.attempt_count + 1,
    lease_until = statement_timestamp() + interval '2 minutes',
    last_error = case
      when provider_call.status = 'hanging_up'
        then 'hangup_lease_expired'
      else provider_call.last_error
    end,
    updated_at = statement_timestamp()
  from candidates
  where provider_call.operation_id = candidates.operation_id
  returning
    provider_call.operation_id,
    provider_call.lecture_session_id,
    provider_call.provider_call_id,
    provider_call.attempt_count;
end;
$$;

create function public.claim_realtime_provider_hangups(
  job_limit integer default 10,
  target_operation_id uuid default null,
  target_lecture_session_id uuid default null
)
returns table (
  operation_id uuid,
  lecture_session_id uuid,
  provider_call_id text,
  attempt_count integer
)
language sql
volatile
security invoker
set search_path = ''
as $$
  select *
  from private.claim_realtime_provider_hangups(
    job_limit,
    target_operation_id,
    target_lecture_session_id
  );
$$;

create function private.finish_realtime_provider_hangup(
  target_operation_id uuid,
  target_succeeded boolean,
  target_error text default null
)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  call_row public.ai_realtime_provider_calls%rowtype;
  retry_seconds integer;
begin
  select provider_call.*
  into call_row
  from public.ai_realtime_provider_calls as provider_call
  where provider_call.operation_id = target_operation_id
  for update;

  if not found then
    return false;
  end if;
  if call_row.status = 'stopped' then
    return true;
  end if;
  if call_row.status <> 'hanging_up' then
    return false;
  end if;

  retry_seconds := least(
    3600,
    5 * (2 ^ least(greatest(call_row.attempt_count - 1, 0), 9))
  )::integer;

  update public.ai_realtime_provider_calls as provider_call
  set
    status = case when target_succeeded then 'stopped' else 'retry' end,
    next_attempt_at = case
      when target_succeeded then provider_call.next_attempt_at
      else statement_timestamp() + retry_seconds * interval '1 second'
    end,
    lease_until = null,
    last_error = case
      when target_succeeded then null
      else left(coalesce(target_error, 'provider_hangup_failed'), 500)
    end,
    stopped_at = case
      when target_succeeded then statement_timestamp()
      else null
    end,
    updated_at = statement_timestamp()
  where provider_call.operation_id = target_operation_id;

  return true;
end;
$$;

create function public.finish_realtime_provider_hangup(
  target_operation_id uuid,
  target_succeeded boolean,
  target_error text default null
)
returns boolean
language sql
volatile
security invoker
set search_path = ''
as $$
  select private.finish_realtime_provider_hangup(
    target_operation_id,
    target_succeeded,
    target_error
  );
$$;

-- Realtime timeout accounting is charged for every activated provider call.
-- A prepared call that never reached OpenAI remains zero-cost.
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
  effective_now timestamptz := statement_timestamp();
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
    select
      usage.id,
      usage.requested_by_actor,
      usage.requested_at
        + usage.reserved_audio_seconds * interval '1 second'
        <= effective_now as selected_duration_elapsed,
      provider_call.operation_id is null
        or provider_call.activated_at is not null as charge_elapsed
    from public.ai_usage_ledger as usage
    left join public.ai_realtime_provider_calls as provider_call
      on provider_call.operation_id = usage.id
    where usage.lecture_session_id = target_lecture_session_id
      and usage.feature = 'captions'
      and usage.status = 'running'
      and (
        coalesce(usage.last_heartbeat_at, usage.requested_at)
          < effective_now - interval '45 seconds'
        or usage.requested_at
          + usage.reserved_audio_seconds * interval '1 second'
          <= effective_now
      )
    order by
      least(
        coalesce(usage.last_heartbeat_at, usage.requested_at)
          + interval '45 seconds',
        usage.requested_at
          + usage.reserved_audio_seconds * interval '1 second'
      ),
      usage.id
    limit effective_limit
    for update of usage skip locked
  loop
    perform private.finish_realtime_caption_operation(
      stale_operation.id,
      stale_operation.requested_by_actor,
      case
        when stale_operation.selected_duration_elapsed
          then 'selected_duration_elapsed'
        else 'heartbeat_timeout'
      end,
      stale_operation.charge_elapsed,
      true
    );
    operation_id := stale_operation.id;
    return next;
  end loop;
end;
$$;

-- Student-facing captions are monotonic. A delayed request may be acknowledged
-- as stale, but it can never replace a newer five-second window.
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
  reserved_until timestamptz;
begin
  if char_length(trim(coalesce(target_text, ''))) not between 1 and 1000 then
    raise exception 'caption text must contain 1 to 1000 characters'
      using errcode = '22023';
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
     or usage_row.requested_by_actor <> target_actor_id then
    raise exception 'caption operation is not running' using errcode = 'P0001';
  end if;

  reserved_until := usage_row.requested_at
    + usage_row.reserved_audio_seconds * interval '1 second';

  if usage_row.status <> 'running' then
    if usage_row.error_code = 'selected_duration_elapsed' then
      return jsonb_build_object(
        'accepted', false,
        'changed', false,
        'reason', 'selected_duration_elapsed',
        'reserved_until', reserved_until,
        'sequence', target_sequence,
        'updated_at', effective_now
      );
    end if;
    raise exception 'caption operation is not running' using errcode = 'P0001';
  end if;

  if reserved_until <= effective_now then
    perform private.finish_realtime_caption_operation(
      target_operation_id,
      target_actor_id,
      'selected_duration_elapsed',
      true,
      true
    );
    return jsonb_build_object(
      'accepted', false,
      'changed', false,
      'reason', 'selected_duration_elapsed',
      'reserved_until', reserved_until,
      'sequence', target_sequence,
      'updated_at', effective_now
    );
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

  if found and target_sequence < caption_row.sequence then
    return jsonb_build_object(
      'accepted', false,
      'changed', false,
      'reason', 'stale_sequence',
      'reserved_until', reserved_until,
      'sequence', caption_row.sequence,
      'updated_at', caption_row.updated_at
    );
  end if;

  if found and target_sequence = caption_row.sequence then
    if caption_row.text is not distinct from trim(target_text)
       and caption_row.language is not distinct from target_language
       and caption_row.last_item_id is not distinct from target_last_item_id then
      return jsonb_build_object(
        'accepted', true,
        'changed', false,
        'reason', 'idempotent_replay',
        'reserved_until', reserved_until,
        'sequence', caption_row.sequence,
        'updated_at', caption_row.updated_at
      );
    end if;
    return jsonb_build_object(
      'accepted', false,
      'changed', false,
      'reason', 'sequence_conflict',
      'reserved_until', reserved_until,
      'sequence', caption_row.sequence,
      'updated_at', caption_row.updated_at
    );
  end if;

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
    updated_at = excluded.updated_at
  where caption.sequence < excluded.sequence;

  changed := found;
  if changed then
    perform private.bump_lecture_live_state(
      target_lecture_session_id,
      'caption'
    );
  end if;

  return jsonb_build_object(
    'accepted', true,
    'changed', changed,
    'reserved_until', reserved_until,
    'sequence', target_sequence,
    'updated_at', effective_now
  );
end;
$$;

revoke all on function private.consume_realtime_billing_grant_and_prepare_call(
  uuid, text, uuid, jsonb, text
) from public, anon, authenticated, service_role;
revoke all on function private.activate_realtime_provider_call(
  uuid, text, text, text
) from public, anon, authenticated, service_role;
revoke all on function private.fail_realtime_provider_call_creation(
  uuid, text, text
) from public, anon, authenticated, service_role;
revoke all on function private.enqueue_realtime_provider_hangup()
  from public, anon, authenticated, service_role;
revoke all on function private.claim_realtime_provider_hangups(
  integer, uuid, uuid
) from public, anon, authenticated, service_role;
revoke all on function private.finish_realtime_provider_hangup(
  uuid, boolean, text
) from public, anon, authenticated, service_role;

grant execute on function private.consume_realtime_billing_grant_and_prepare_call(
  uuid, text, uuid, jsonb, text
) to service_role;
grant execute on function private.activate_realtime_provider_call(
  uuid, text, text, text
) to service_role;
grant execute on function private.fail_realtime_provider_call_creation(
  uuid, text, text
) to service_role;
grant execute on function private.claim_realtime_provider_hangups(
  integer, uuid, uuid
) to service_role;
grant execute on function private.finish_realtime_provider_hangup(
  uuid, boolean, text
) to service_role;

revoke all on function public.admin_consume_realtime_billing_grant(
  uuid, text, uuid, jsonb, text
) from public, anon, authenticated, service_role;
revoke all on function public.admin_activate_realtime_provider_call(
  uuid, text, text, text
) from public, anon, authenticated, service_role;
revoke all on function public.admin_fail_realtime_provider_call_creation(
  uuid, text, text
) from public, anon, authenticated, service_role;
revoke all on function public.claim_realtime_provider_hangups(
  integer, uuid, uuid
) from public, anon, authenticated, service_role;
revoke all on function public.finish_realtime_provider_hangup(
  uuid, boolean, text
) from public, anon, authenticated, service_role;

grant execute on function public.admin_consume_realtime_billing_grant(
  uuid, text, uuid, jsonb, text
) to service_role;
grant execute on function public.admin_activate_realtime_provider_call(
  uuid, text, text, text
) to service_role;
grant execute on function public.admin_fail_realtime_provider_call_creation(
  uuid, text, text
) to service_role;
grant execute on function public.claim_realtime_provider_hangups(
  integer, uuid, uuid
) to service_role;
grant execute on function public.finish_realtime_provider_hangup(
  uuid, boolean, text
) to service_role;

comment on table public.ai_realtime_provider_calls is
  'One provider WebRTC call per caption operation plus a retryable server-side hangup outbox.';
