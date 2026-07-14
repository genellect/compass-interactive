-- Phase 2: server-authoritative lecture lifecycle, AI admission control, and
-- reversible 30-day logical archival.
--
-- This migration is expand-first. Existing public RPC signatures remain
-- available and both Phase 0 and Phase 1 snapshot contracts are preserved.

alter table public.lecture_sessions
  add column started_at timestamptz,
  add column hard_stop_at timestamptz,
  add column closed_at timestamptz,
  add column close_reason text,
  add column close_actor_type text,
  add column close_actor_id text,
  add column archive_expires_at timestamptz,
  add column lifecycle_version bigint not null default 0;

update public.lecture_sessions
set
  ends_at = case
    when status = 'open' then least(
      coalesce(ends_at, coalesce(starts_at, statement_timestamp()) + interval '90 minutes'),
      coalesce(starts_at, statement_timestamp()) + interval '90 minutes'
    )
    else ends_at
  end,
  started_at = case
    when status in ('open', 'closed') then coalesce(starts_at, created_at)
    else null
  end,
  hard_stop_at = case
    when status = 'open' then least(
      coalesce(ends_at, coalesce(starts_at, statement_timestamp()) + interval '90 minutes'),
      coalesce(starts_at, statement_timestamp()) + interval '90 minutes'
    )
    when status = 'closed' then least(
      coalesce(ends_at, updated_at, created_at),
      coalesce(starts_at, created_at) + interval '90 minutes'
    )
    else null
  end,
  closed_at = case
    when status = 'closed' then coalesce(ends_at, updated_at, created_at)
    else null
  end,
  close_reason = case when status = 'closed' then 'legacy' else null end,
  close_actor_type = case when status = 'closed' then 'migration' else null end,
  close_actor_id = case when status = 'closed' then 'phase2-upgrade' else null end,
  archive_expires_at = case
    when status = 'closed'
      then coalesce(ends_at, updated_at, created_at) + interval '30 days'
    else null
  end;

alter table public.lecture_sessions
  add constraint lecture_sessions_started_hard_stop_check
    check (
      hard_stop_at is null
      or started_at is null
      or hard_stop_at between started_at and started_at + interval '90 minutes'
    ) not valid,
  add constraint lecture_sessions_open_lifecycle_check
    check (
      status <> 'open'
      or (started_at is not null and hard_stop_at is not null and closed_at is null)
    ) not valid,
  add constraint lecture_sessions_closed_lifecycle_check
    check (
      status <> 'closed'
      or (
        closed_at is not null
        and close_reason is not null
        and close_actor_type is not null
        and archive_expires_at = closed_at + interval '30 days'
      )
    ) not valid,
  add constraint lecture_sessions_close_reason_check
    check (
      close_reason is null
      or close_reason in ('manual', 'hard_stop', 'deadline_guard', 'legacy', 'system')
    ) not valid,
  add constraint lecture_sessions_close_actor_type_check
    check (
      close_actor_type is null
      or close_actor_type in (
        'admin', 'deadline_worker', 'deadline_guard', 'migration', 'system'
      )
    ) not valid,
  add constraint lecture_sessions_close_actor_id_length_check
    check (close_actor_id is null or char_length(close_actor_id) between 1 and 200)
    not valid,
  add constraint lecture_sessions_lifecycle_version_check
    check (lifecycle_version >= 0) not valid;

alter table public.lecture_sessions
  validate constraint lecture_sessions_started_hard_stop_check;
alter table public.lecture_sessions
  validate constraint lecture_sessions_open_lifecycle_check;
alter table public.lecture_sessions
  validate constraint lecture_sessions_closed_lifecycle_check;
alter table public.lecture_sessions
  validate constraint lecture_sessions_close_reason_check;
alter table public.lecture_sessions
  validate constraint lecture_sessions_close_actor_type_check;
alter table public.lecture_sessions
  validate constraint lecture_sessions_close_actor_id_length_check;
alter table public.lecture_sessions
  validate constraint lecture_sessions_lifecycle_version_check;

create index lecture_sessions_open_hard_stop_idx
  on public.lecture_sessions (hard_stop_at, id)
  where status = 'open';
create index lecture_sessions_closed_archive_expiry_idx
  on public.lecture_sessions (archive_expires_at, id)
  where status = 'closed';

create table public.lecture_lifecycle_events (
  id bigint generated always as identity primary key,
  lecture_session_id uuid not null
    references public.lecture_sessions(id) on delete restrict,
  event_key text not null check (char_length(event_key) between 1 and 160),
  event_type text not null check (
    event_type in (
      'lecture_started',
      'lecture_closed',
      'lecture_archived',
      'lecture_archive_restored'
    )
  ),
  actor_type text not null check (
    actor_type in ('admin', 'deadline_worker', 'deadline_guard', 'migration', 'system')
  ),
  actor_id text check (actor_id is null or char_length(actor_id) between 1 and 200),
  reason text check (reason is null or char_length(reason) between 1 and 120),
  effective_at timestamptz not null,
  recorded_at timestamptz not null default statement_timestamp(),
  metadata jsonb not null default '{}'::jsonb
    check (jsonb_typeof(metadata) = 'object'),
  unique (lecture_session_id, event_key)
);

create index lecture_lifecycle_events_lecture_recorded_idx
  on public.lecture_lifecycle_events (lecture_session_id, recorded_at desc);

create table public.lecture_archive_state (
  lecture_session_id uuid primary key
    references public.lecture_sessions(id) on delete restrict,
  status text not null default 'retained'
    check (status in ('retained', 'archiving', 'archived', 'restored', 'error')),
  eligible_at timestamptz not null,
  archived_at timestamptz,
  restored_at timestamptz,
  last_attempt_at timestamptz,
  attempt_count integer not null default 0 check (attempt_count >= 0),
  error_message text check (
    error_message is null or char_length(error_message) <= 500
  ),
  version bigint not null default 0 check (version >= 0),
  updated_at timestamptz not null default statement_timestamp(),
  check (status <> 'archived' or archived_at is not null)
);

create index lecture_archive_state_due_idx
  on public.lecture_archive_state (eligible_at, lecture_session_id)
  where status in ('retained', 'error');

create table public.lecture_ai_control (
  lecture_session_id uuid primary key
    references public.lecture_sessions(id) on delete restrict,
  status text not null default 'disabled'
    check (status in ('disabled', 'ready', 'running', 'stopping', 'stopped', 'failed')),
  captions_enabled boolean not null default false,
  summaries_enabled boolean not null default false,
  material_analysis_enabled boolean not null default false,
  poll_suggestions_enabled boolean not null default false,
  academic_answers_enabled boolean not null default false,
  hard_stop_at timestamptz,
  budget_limit_microusd bigint not null default 2500000
    check (budget_limit_microusd between 0 and 100000000),
  used_microusd bigint not null default 0 check (used_microusd >= 0),
  audio_seconds_limit integer not null default 5400
    check (audio_seconds_limit between 0 and 5400),
  audio_seconds_used integer not null default 0 check (audio_seconds_used >= 0),
  input_token_limit bigint not null default 200000
    check (input_token_limit between 0 and 10000000),
  input_tokens_used bigint not null default 0 check (input_tokens_used >= 0),
  output_token_limit bigint not null default 30000
    check (output_token_limit between 0 and 1000000),
  output_tokens_used bigint not null default 0 check (output_tokens_used >= 0),
  summary_call_limit integer not null default 18
    check (summary_call_limit between 0 and 18),
  summary_calls_used integer not null default 0 check (summary_calls_used >= 0),
  material_analysis_call_limit integer not null default 1
    check (material_analysis_call_limit between 0 and 5),
  material_analysis_calls_used integer not null default 0
    check (material_analysis_calls_used >= 0),
  poll_generation_limit integer not null default 5
    check (poll_generation_limit between 0 and 20),
  poll_generation_calls_used integer not null default 0
    check (poll_generation_calls_used >= 0),
  academic_answer_limit integer not null default 3
    check (academic_answer_limit between 0 and 10),
  academic_answer_calls_used integer not null default 0
    check (academic_answer_calls_used >= 0),
  max_concurrent_operations integer not null default 1
    check (max_concurrent_operations between 1 and 4),
  active_operation_count integer not null default 0
    check (active_operation_count between 0 and 4),
  started_at timestamptz,
  stop_requested_at timestamptz,
  stopped_at timestamptz,
  stop_reason text check (stop_reason is null or char_length(stop_reason) <= 120),
  last_heartbeat_at timestamptz,
  version bigint not null default 0 check (version >= 0),
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp()
);

create table public.ai_usage_ledger (
  id uuid primary key default extensions.gen_random_uuid(),
  lecture_session_id uuid not null
    references public.lecture_sessions(id) on delete restrict,
  feature text not null check (
    feature in (
      'captions',
      'summaries',
      'material_analysis',
      'poll_suggestions',
      'academic_answers'
    )
  ),
  idempotency_key text not null check (char_length(idempotency_key) between 8 and 160),
  status text not null default 'running'
    check (status in ('running', 'succeeded', 'failed', 'cancelled', 'discarded')),
  requested_by_actor text not null
    check (char_length(requested_by_actor) between 1 and 200),
  provider_request_id text
    check (provider_request_id is null or char_length(provider_request_id) <= 200),
  reserved_microusd bigint not null default 0 check (reserved_microusd >= 0),
  actual_microusd bigint check (actual_microusd is null or actual_microusd >= 0),
  reserved_audio_seconds integer not null default 0
    check (reserved_audio_seconds >= 0),
  actual_audio_seconds integer
    check (actual_audio_seconds is null or actual_audio_seconds >= 0),
  reserved_input_tokens bigint not null default 0
    check (reserved_input_tokens >= 0),
  actual_input_tokens bigint
    check (actual_input_tokens is null or actual_input_tokens >= 0),
  reserved_output_tokens bigint not null default 0
    check (reserved_output_tokens >= 0),
  actual_output_tokens bigint
    check (actual_output_tokens is null or actual_output_tokens >= 0),
  result_accepted boolean not null default false,
  error_code text check (error_code is null or char_length(error_code) <= 120),
  requested_at timestamptz not null default statement_timestamp(),
  finished_at timestamptz,
  unique (lecture_session_id, idempotency_key)
);

create index ai_usage_ledger_lecture_requested_idx
  on public.ai_usage_ledger (lecture_session_id, requested_at desc);
create index ai_usage_ledger_running_idx
  on public.ai_usage_ledger (lecture_session_id, id)
  where status = 'running';

alter table public.lecture_lifecycle_events enable row level security;
alter table public.lecture_archive_state enable row level security;
alter table public.lecture_ai_control enable row level security;
alter table public.ai_usage_ledger enable row level security;

revoke all on public.lecture_lifecycle_events from public, anon, authenticated;
revoke all on public.lecture_archive_state from public, anon, authenticated;
revoke all on public.lecture_ai_control from public, anon, authenticated;
revoke all on public.ai_usage_ledger from public, anon, authenticated;

grant select on public.lecture_lifecycle_events to service_role;
grant select on public.lecture_archive_state to service_role;
grant select on public.lecture_ai_control to service_role;
grant select on public.ai_usage_ledger to service_role;

insert into public.lecture_archive_state (
  lecture_session_id,
  status,
  eligible_at
)
select lecture.id, 'retained', lecture.archive_expires_at
from public.lecture_sessions as lecture
where lecture.status = 'closed'
on conflict (lecture_session_id) do nothing;

insert into public.lecture_ai_control (lecture_session_id, hard_stop_at)
select lecture.id, lecture.hard_stop_at
from public.lecture_sessions as lecture
on conflict (lecture_session_id) do nothing;

insert into public.lecture_lifecycle_events (
  lecture_session_id,
  event_key,
  event_type,
  actor_type,
  actor_id,
  reason,
  effective_at,
  metadata
)
select
  lecture.id,
  'legacy-close',
  'lecture_closed',
  'migration',
  'phase2-upgrade',
  'legacy',
  lecture.closed_at,
  jsonb_build_object('backfilled', true)
from public.lecture_sessions as lecture
where lecture.status = 'closed'
on conflict (lecture_session_id, event_key) do nothing;

-- Expand-first compatibility for trusted legacy writers which insert or update
-- lecture_sessions directly. They receive safe lifecycle defaults and can never
-- extend an open lecture beyond 90 minutes. The Admin RPC below remains the
-- canonical start path and always uses DB time.
create function private.normalize_lecture_lifecycle_fields()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  effective_started_at timestamptz;
  effective_closed_at timestamptz;
begin
  if new.status = 'open' then
    effective_started_at := coalesce(
      new.started_at,
      new.starts_at,
      statement_timestamp()
    );
    new.started_at := effective_started_at;
    new.starts_at := coalesce(new.starts_at, effective_started_at);
    new.hard_stop_at := least(
      coalesce(new.hard_stop_at, effective_started_at + interval '90 minutes'),
      coalesce(new.ends_at, effective_started_at + interval '90 minutes'),
      effective_started_at + interval '90 minutes'
    );
    new.ends_at := coalesce(new.ends_at, new.hard_stop_at);
    new.closed_at := null;
    new.close_reason := null;
    new.close_actor_type := null;
    new.close_actor_id := null;
    new.archive_expires_at := null;
  elsif new.status = 'closed' then
    effective_closed_at := coalesce(
      new.closed_at,
      new.ends_at,
      statement_timestamp()
    );
    new.started_at := coalesce(new.started_at, new.starts_at, new.created_at);
    new.hard_stop_at := least(
      coalesce(new.hard_stop_at, effective_closed_at),
      coalesce(new.started_at, effective_closed_at) + interval '90 minutes'
    );
    new.closed_at := effective_closed_at;
    new.ends_at := effective_closed_at;
    new.close_reason := coalesce(new.close_reason, 'legacy');
    new.close_actor_type := coalesce(new.close_actor_type, 'system');
    new.close_actor_id := coalesce(new.close_actor_id, 'legacy-direct-write');
    new.archive_expires_at := effective_closed_at + interval '30 days';
  end if;

  if tg_op = 'UPDATE'
     and old.status is distinct from new.status
     and new.lifecycle_version = old.lifecycle_version then
    new.lifecycle_version := old.lifecycle_version + 1;
  end if;

  return new;
end;
$$;

create trigger normalize_lecture_lifecycle_fields
before insert or update of
  status,
  starts_at,
  ends_at,
  started_at,
  hard_stop_at,
  closed_at
on public.lecture_sessions
for each row execute function private.normalize_lecture_lifecycle_fields();

create function private.is_lecture_open_at(
  target_lecture_session_id uuid,
  reference_time timestamptz
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.lecture_sessions as lecture
    where lecture.id = target_lecture_session_id
      and lecture.status = 'open'
      and lecture.started_at is not null
      and lecture.started_at <= reference_time
      and lecture.hard_stop_at is not null
      and lecture.hard_stop_at > reference_time
  );
$$;

create or replace function private.is_lecture_open(
  target_lecture_session_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_lecture_open_at(
    target_lecture_session_id,
    statement_timestamp()
  );
$$;

create or replace function private.is_poll_open(
  target_poll_id uuid,
  target_lecture_session_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.polls as poll
    where poll.id = target_poll_id
      and poll.lecture_session_id = target_lecture_session_id
      and poll.status = 'open'
      and private.is_lecture_open(target_lecture_session_id)
  );
$$;

create function private.close_lecture_core(
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

create function private.close_lecture_if_expired(
  target_lecture_session_id uuid,
  target_actor_type text default 'deadline_guard',
  target_actor_id text default 'snapshot-deadline-guard'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  should_close boolean;
begin
  select exists (
    select 1
    from public.lecture_sessions as lecture
    where lecture.id = target_lecture_session_id
      and lecture.status = 'open'
      and lecture.hard_stop_at <= statement_timestamp()
  ) into should_close;

  if not should_close then
    return null;
  end if;

  return private.close_lecture_core(
    target_lecture_session_id,
    case
      when target_actor_type = 'deadline_worker' then 'hard_stop'
      else 'deadline_guard'
    end,
    target_actor_type,
    target_actor_id
  );
end;
$$;

create function private.start_lecture_core(
  target_lecture_session_id uuid,
  target_actor_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  lecture_row public.lecture_sessions%rowtype;
  canonical_started_at timestamptz := statement_timestamp();
  did_change boolean := false;
begin
  if nullif(trim(target_actor_id), '') is null
     or char_length(target_actor_id) > 200 then
    raise exception 'invalid lecture start actor id' using errcode = '22023';
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
    update public.lecture_sessions as lecture
    set
      status = 'open',
      starts_at = canonical_started_at,
      started_at = canonical_started_at,
      hard_stop_at = canonical_started_at + interval '90 minutes',
      ends_at = canonical_started_at + interval '90 minutes',
      closed_at = null,
      close_reason = null,
      close_actor_type = null,
      close_actor_id = null,
      archive_expires_at = null,
      lifecycle_version = lecture.lifecycle_version + 1,
      updated_at = canonical_started_at
    where lecture.id = target_lecture_session_id;

    insert into public.lecture_ai_control as control (
      lecture_session_id,
      hard_stop_at
    ) values (
      target_lecture_session_id,
      canonical_started_at + interval '90 minutes'
    )
    on conflict (lecture_session_id) do update
    set
      hard_stop_at = excluded.hard_stop_at,
      status = case
        when control.captions_enabled
          or control.summaries_enabled
          or control.material_analysis_enabled
          or control.poll_suggestions_enabled
          or control.academic_answers_enabled
          then 'ready'
        else 'disabled'
      end,
      stop_requested_at = null,
      stopped_at = null,
      stop_reason = null,
      version = control.version + 1,
      updated_at = canonical_started_at;

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
      'start',
      'lecture_started',
      'admin',
      target_actor_id,
      'manual',
      canonical_started_at,
      jsonb_build_object(
        'hard_stop_at', canonical_started_at + interval '90 minutes'
      )
    )
    on conflict (lecture_session_id, event_key) do nothing;

    did_change := true;

    select lecture.*
    into lecture_row
    from public.lecture_sessions as lecture
    where lecture.id = target_lecture_session_id;
  end if;

  return jsonb_build_object(
    'changed', did_change,
    'hard_stop_at', lecture_row.hard_stop_at,
    'lecture_session_id', lecture_row.id,
    'started_at', lecture_row.started_at,
    'status', lecture_row.status
  );
end;
$$;

create function private.close_expired_lectures(
  batch_size integer default 50
)
returns table (lecture_session_id uuid, changed boolean, status text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  candidate record;
  close_result jsonb;
  effective_batch_size integer := least(greatest(batch_size, 1), 200);
begin
  for candidate in
    select lecture.id
    from public.lecture_sessions as lecture
    where lecture.status = 'open'
      and lecture.hard_stop_at <= statement_timestamp()
    order by lecture.hard_stop_at, lecture.id
    for update skip locked
    limit effective_batch_size
  loop
    close_result := private.close_lecture_core(
      candidate.id,
      'hard_stop',
      'deadline_worker',
      'phase2-lifecycle-maintenance'
    );
    lecture_session_id := candidate.id;
    changed := coalesce((close_result ->> 'changed')::boolean, false);
    status := close_result ->> 'status';
    return next;
  end loop;
end;
$$;

create function private.archive_due_lectures(
  batch_size integer default 25
)
returns table (lecture_session_id uuid, status text, attempt_count integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  candidate record;
  effective_batch_size integer := least(greatest(batch_size, 1), 100);
begin
  for candidate in
    select archive.lecture_session_id
    from public.lecture_archive_state as archive
    join public.lecture_sessions as lecture
      on lecture.id = archive.lecture_session_id
    where archive.status in ('retained', 'error')
      and archive.eligible_at <= statement_timestamp()
      and lecture.status = 'closed'
      and lecture.archive_expires_at <= statement_timestamp()
    order by archive.eligible_at, archive.lecture_session_id
    for update of archive skip locked
    limit effective_batch_size
  loop
    begin
      update public.lecture_archive_state as archive
      set
        status = 'archiving',
        last_attempt_at = statement_timestamp(),
        attempt_count = archive.attempt_count + 1,
        error_message = null,
        version = archive.version + 1,
        updated_at = statement_timestamp()
      where archive.lecture_session_id = candidate.lecture_session_id;

      -- Phase 2 archives logically. No content or FK-linked row is deleted.
      update public.lecture_archive_state as archive
      set
        status = 'archived',
        archived_at = coalesce(archive.archived_at, statement_timestamp()),
        error_message = null,
        version = archive.version + 1,
        updated_at = statement_timestamp()
      where archive.lecture_session_id = candidate.lecture_session_id;

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
        candidate.lecture_session_id,
        'archive',
        'lecture_archived',
        'deadline_worker',
        'phase2-lifecycle-maintenance',
        'retention_elapsed',
        statement_timestamp(),
        jsonb_build_object('physical_delete', false)
      )
      on conflict on constraint
        lecture_lifecycle_events_lecture_session_id_event_key_key
      do nothing;
    exception when others then
      update public.lecture_archive_state as archive
      set
        status = 'error',
        error_message = left(sqlerrm, 500),
        updated_at = statement_timestamp()
      where archive.lecture_session_id = candidate.lecture_session_id;
    end;

    select archive.status, archive.attempt_count
    into status, attempt_count
    from public.lecture_archive_state as archive
    where archive.lecture_session_id = candidate.lecture_session_id;
    lecture_session_id := candidate.lecture_session_id;
    return next;
  end loop;
end;
$$;

create function private.run_lecture_lifecycle_maintenance(
  close_batch_size integer default 50,
  archive_batch_size integer default 25
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  closed_count integer;
  archived_count integer;
begin
  select count(*)::integer
  into closed_count
  from private.close_expired_lectures(close_batch_size);

  select count(*)::integer
  into archived_count
  from private.archive_due_lectures(archive_batch_size)
  where status = 'archived';

  return jsonb_build_object(
    'archived_count', archived_count,
    'closed_count', closed_count,
    'server_time', statement_timestamp()
  );
end;
$$;

create function private.can_reconcile_lecture(
  target_lecture_session_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null
    and exists (
      select 1
      from public.lecture_sessions as lecture
      where lecture.id = target_lecture_session_id
        and (
          lecture.status = 'open'
          or exists (
            select 1
            from public.participants as participant
            where participant.lecture_session_id = lecture.id
              and participant.auth_user_id = (select auth.uid())
          )
        )
    );
$$;

create or replace function private.can_read_lecture_v2(
  target_lecture_session_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null
    and exists (
      select 1
      from public.lecture_sessions as lecture
      where lecture.id = target_lecture_session_id
        and (
          private.is_lecture_open(lecture.id)
          or (
            lecture.status = 'closed'
            and lecture.archive_expires_at > statement_timestamp()
            and exists (
              select 1
              from public.participants as participant
              where participant.lecture_session_id = lecture.id
                and participant.auth_user_id = (select auth.uid())
            )
          )
        )
    );
$$;

create or replace function private.join_lecture_by_code(
  lecture_code text
)
returns table (
  joined_lecture_session_id uuid,
  participant_id uuid,
  title text,
  starts_at timestamptz,
  ends_at timestamptz,
  status text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  request_user_id uuid := (select auth.uid());
  normalized_code text;
  hashed_code text;
  matched_lecture public.lecture_sessions%rowtype;
  joined_participant_id uuid;
begin
  if request_user_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  normalized_code := upper(trim(coalesce(lecture_code, '')));
  if normalized_code = '' then
    raise exception 'lecture code is empty' using errcode = 'P0001';
  end if;

  hashed_code := encode(
    extensions.digest(convert_to(normalized_code, 'UTF8'), 'sha256'),
    'hex'
  );

  select lecture.*
  into matched_lecture
  from public.lecture_sessions as lecture
  where lecture.code_hash = hashed_code
  limit 1;

  if not found then
    raise exception 'lecture code not found' using errcode = 'P0001';
  end if;
  if matched_lecture.status <> 'open' then
    raise exception 'lecture is not open' using errcode = 'P0001';
  end if;
  if matched_lecture.hard_stop_at <= statement_timestamp() then
    raise exception 'lecture has expired' using errcode = 'P0001';
  end if;
  if not private.is_lecture_open(matched_lecture.id) then
    raise exception 'lecture is not open' using errcode = 'P0001';
  end if;

  insert into public.participants (
    lecture_session_id,
    auth_user_id,
    participant_key,
    last_seen_at
  ) values (
    matched_lecture.id,
    request_user_id,
    encode(extensions.gen_random_bytes(32), 'hex'),
    statement_timestamp()
  )
  on conflict (lecture_session_id, auth_user_id)
    where auth_user_id is not null
  do update set last_seen_at = excluded.last_seen_at
  returning id into joined_participant_id;

  return query
  select
    matched_lecture.id,
    joined_participant_id,
    matched_lecture.title,
    matched_lecture.starts_at,
    matched_lecture.ends_at,
    matched_lecture.status;
end;
$$;

create or replace function private.get_lecture_session_state(
  target_lecture_session_id uuid
)
returns table (
  lecture_session_id uuid,
  title text,
  starts_at timestamptz,
  ends_at timestamptz,
  status text
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    lecture.id,
    lecture.title,
    lecture.starts_at,
    coalesce(lecture.hard_stop_at, lecture.ends_at),
    case
      when lecture.status = 'open'
        and not private.is_lecture_open(lecture.id)
        then 'closed'
      else lecture.status
    end
  from public.lecture_sessions as lecture
  where lecture.id = target_lecture_session_id
    and (
      private.is_lecture_open(lecture.id)
      or (
        lecture.status = 'closed'
        and lecture.archive_expires_at > statement_timestamp()
        and exists (
          select 1
          from public.participants as participant
          where participant.lecture_session_id = lecture.id
            and participant.auth_user_id = (select auth.uid())
        )
      )
      or (
        lecture.status = 'open'
        and exists (
          select 1
          from public.participants as participant
          where participant.lecture_session_id = lecture.id
            and participant.auth_user_id = (select auth.uid())
        )
      )
    )
  limit 1;
$$;

-- Preserve the Phase 1 implementations as private cores, then add deadline
-- reconciliation and terminal lifecycle metadata around the unchanged payloads.
alter function private.get_lecture_public_snapshot_v2(
  uuid, bigint, bigint, bigint, bigint, bigint, bigint, bigint,
  timestamptz, uuid, integer
) rename to get_lecture_public_snapshot_v2_phase1_core;

alter function private.get_lecture_participant_state_v2(uuid)
  rename to get_lecture_participant_state_v2_phase1_core;

alter function private.get_lecture_comment_history_v2(
  uuid, timestamptz, uuid, integer
) rename to get_lecture_comment_history_v2_phase1_core;

create function private.get_lecture_public_snapshot_v2(
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
  snapshot_payload jsonb;
  lecture_row public.lecture_sessions%rowtype;
begin
  if not private.can_reconcile_lecture(target_lecture_session_id) then
    return null;
  end if;

  perform private.close_lecture_if_expired(target_lecture_session_id);

  if not private.can_read_lecture_v2(target_lecture_session_id) then
    return null;
  end if;

  snapshot_payload := private.get_lecture_public_snapshot_v2_phase1_core(
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

  if snapshot_payload is null then
    return null;
  end if;

  select lecture.*
  into lecture_row
  from public.lecture_sessions as lecture
  where lecture.id = target_lecture_session_id;

  if jsonb_typeof(snapshot_payload #> '{changed,lecture}') = 'object' then
    snapshot_payload := jsonb_set(
      snapshot_payload,
      '{changed,lecture}',
      (snapshot_payload #> '{changed,lecture}') || jsonb_build_object(
        'archive_expires_at', lecture_row.archive_expires_at,
        'closed_at', lecture_row.closed_at,
        'close_reason', lecture_row.close_reason,
        'hard_stop_at', lecture_row.hard_stop_at,
        'lifecycle_version', lecture_row.lifecycle_version,
        'started_at', lecture_row.started_at
      ),
      true
    );
  end if;

  return snapshot_payload;
end;
$$;

create function private.get_lecture_participant_state_v2(
  target_lecture_session_id uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  participant_payload jsonb;
  lecture_row public.lecture_sessions%rowtype;
begin
  if not private.can_reconcile_lecture(target_lecture_session_id) then
    return null;
  end if;

  perform private.close_lecture_if_expired(target_lecture_session_id);

  if not private.can_read_lecture_v2(target_lecture_session_id) then
    return null;
  end if;

  participant_payload := private.get_lecture_participant_state_v2_phase1_core(
    target_lecture_session_id
  );
  if participant_payload is null then
    return null;
  end if;

  select lecture.*
  into lecture_row
  from public.lecture_sessions as lecture
  where lecture.id = target_lecture_session_id;

  participant_payload := jsonb_set(
    participant_payload,
    '{commenting,allowed}',
    to_jsonb(private.is_lecture_open(target_lecture_session_id)),
    true
  );

  return participant_payload || jsonb_build_object(
    'lifecycle', jsonb_build_object(
      'archive_expires_at', lecture_row.archive_expires_at,
      'closed_at', lecture_row.closed_at,
      'hard_stop_at', lecture_row.hard_stop_at,
      'status', lecture_row.status
    )
  );
end;
$$;

create function private.get_lecture_comment_history_v2(
  target_lecture_session_id uuid,
  before_created_at timestamptz,
  before_comment_id uuid,
  history_limit integer default 50
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if not private.can_reconcile_lecture(target_lecture_session_id) then
    return null;
  end if;

  perform private.close_lecture_if_expired(target_lecture_session_id);

  if not private.can_read_lecture_v2(target_lecture_session_id) then
    return null;
  end if;

  return private.get_lecture_comment_history_v2_phase1_core(
    target_lecture_session_id,
    before_created_at,
    before_comment_id,
    history_limit
  );
end;
$$;

create or replace function private.get_lecture_live_snapshot_for_current_user(
  target_lecture_session_id uuid,
  known_state_version bigint default null,
  known_comments_version bigint default null,
  known_likes_version bigint default null,
  known_polls_version bigint default null,
  known_display_version bigint default null,
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
  request_user_id uuid := (select auth.uid());
  current_participant_id uuid;
  snapshot_payload jsonb;
  document_id text;
  lecture_row public.lecture_sessions%rowtype;
begin
  if request_user_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  if not private.can_reconcile_lecture(target_lecture_session_id) then
    return null;
  end if;

  perform private.close_lecture_if_expired(target_lecture_session_id);

  if not private.can_read_lecture_v2(target_lecture_session_id) then
    return null;
  end if;

  select participant.id
  into current_participant_id
  from public.participants as participant
  where participant.lecture_session_id = target_lecture_session_id
    and participant.auth_user_id = request_user_id
  limit 1;

  snapshot_payload := private.get_lecture_live_snapshot_core(
    target_lecture_session_id,
    current_participant_id,
    known_state_version,
    known_comments_version,
    known_likes_version,
    known_polls_version,
    known_display_version,
    comment_cursor_created_at,
    comment_cursor_id,
    comment_limit
  );

  if snapshot_payload is null then
    return null;
  end if;

  if jsonb_typeof(snapshot_payload -> 'display') = 'object' then
    select live.pdf_document_id
    into document_id
    from public.lecture_live_state as live
    where live.lecture_session_id = target_lecture_session_id;

    snapshot_payload := jsonb_set(
      snapshot_payload #- '{display,pdf_asset_id}',
      '{display,pdf_document_id}',
      coalesce(to_jsonb(document_id), 'null'::jsonb),
      true
    );
  end if;

  select lecture.*
  into lecture_row
  from public.lecture_sessions as lecture
  where lecture.id = target_lecture_session_id;

  snapshot_payload := jsonb_set(
    snapshot_payload,
    '{lecture}',
    (snapshot_payload -> 'lecture') || jsonb_build_object(
      'archive_expires_at', lecture_row.archive_expires_at,
      'closed_at', lecture_row.closed_at,
      'close_reason', lecture_row.close_reason,
      'hard_stop_at', lecture_row.hard_stop_at,
      'lifecycle_version', lecture_row.lifecycle_version,
      'started_at', lecture_row.started_at,
      'status', lecture_row.status
    ),
    true
  );

  return jsonb_set(
    snapshot_payload || jsonb_build_object('server_time', statement_timestamp()),
    '{current_participant_id}',
    coalesce(to_jsonb(current_participant_id), 'null'::jsonb),
    true
  );
end;
$$;

alter function public.get_lecture_live_snapshot(
  uuid, bigint, bigint, bigint, bigint, bigint, timestamptz, uuid, integer
) volatile;
alter function public.get_lecture_public_snapshot_v2(
  uuid, bigint, bigint, bigint, bigint, bigint, bigint, bigint,
  timestamptz, uuid, integer
) volatile;
alter function public.get_lecture_participant_state_v2(uuid) volatile;
alter function public.get_lecture_comment_history_v2(
  uuid, timestamptz, uuid, integer
) volatile;

create function private.get_lecture_terminal_state_v2(
  target_lecture_session_id uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  lecture_row public.lecture_sessions%rowtype;
begin
  if (select auth.uid()) is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  perform private.close_lecture_if_expired(target_lecture_session_id);

  select lecture.*
  into lecture_row
  from public.lecture_sessions as lecture
  where lecture.id = target_lecture_session_id
    and lecture.status = 'closed';

  if not found then
    return null;
  end if;

  return jsonb_build_object(
    'archive_expires_at', lecture_row.archive_expires_at,
    'closed_at', lecture_row.closed_at,
    'close_reason', lecture_row.close_reason,
    'contract_version', 2,
    'hard_stop_at', lecture_row.hard_stop_at,
    'lecture_session_id', lecture_row.id,
    'server_time', statement_timestamp(),
    'started_at', lecture_row.started_at,
    'status', 'closed',
    'title', lecture_row.title
  );
end;
$$;

create function public.get_lecture_terminal_state_v2(
  target_lecture_session_id uuid
)
returns jsonb
language sql
volatile
security invoker
set search_path = ''
as $$
  select private.get_lecture_terminal_state_v2(target_lecture_session_id);
$$;

create function private.get_lecture_archive_v2(
  target_lecture_session_id uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  request_user_id uuid := (select auth.uid());
  lecture_row public.lecture_sessions%rowtype;
  comments_payload jsonb;
  comment_count bigint;
  pdf_payload jsonb;
begin
  if request_user_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  perform private.close_lecture_if_expired(target_lecture_session_id);

  select lecture.*
  into lecture_row
  from public.lecture_sessions as lecture
  where lecture.id = target_lecture_session_id
    and lecture.status = 'closed'
    and lecture.archive_expires_at > statement_timestamp()
    and exists (
      select 1
      from public.participants as participant
      where participant.lecture_session_id = lecture.id
        and participant.auth_user_id = request_user_id
    );

  if not found then
    return null;
  end if;

  select count(*)
  into comment_count
  from public.comments as comment
  where comment.lecture_session_id = target_lecture_session_id
    and comment.status = 'visible';

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'body', comment.body,
        'created_at', comment.created_at,
        'id', comment.id,
        'is_pinned', comment.is_pinned,
        'lecture_session_id', comment.lecture_session_id,
        'like_count', coalesce(total.like_count, 0),
        'status', comment.status
      ) order by comment.created_at desc, comment.id desc
    ),
    '[]'::jsonb
  )
  into comments_payload
  from (
    select candidate.*
    from public.comments as candidate
    where candidate.lecture_session_id = target_lecture_session_id
      and candidate.status = 'visible'
    order by candidate.created_at desc, candidate.id desc
    limit 500
  ) as comment
  left join public.comment_like_totals as total
    on total.lecture_session_id = comment.lecture_session_id
   and total.comment_id = comment.id;

  select jsonb_build_object(
    'current_pdf_page', live.current_pdf_page,
    'display_mode', live.display_mode,
    'pdf_document_id', live.pdf_document_id,
    'updated_at', live.updated_at
  )
  into pdf_payload
  from public.lecture_live_state as live
  where live.lecture_session_id = target_lecture_session_id;

  return jsonb_build_object(
    'comments', comments_payload,
    'comments_has_more', comment_count > 500,
    'contract_version', 1,
    'fetched_at', statement_timestamp(),
    'lecture', jsonb_build_object(
      'archive_expires_at', lecture_row.archive_expires_at,
      'closed_at', lecture_row.closed_at,
      'close_reason', lecture_row.close_reason,
      'hard_stop_at', lecture_row.hard_stop_at,
      'lecture_session_id', lecture_row.id,
      'started_at', lecture_row.started_at,
      'status', lecture_row.status,
      'title', lecture_row.title
    ),
    'pdf', pdf_payload,
    'summaries', '[]'::jsonb
  );
end;
$$;

create function public.get_lecture_archive_v2(
  target_lecture_session_id uuid
)
returns jsonb
language sql
volatile
security invoker
set search_path = ''
as $$
  select private.get_lecture_archive_v2(target_lecture_session_id);
$$;

create function private.configure_lecture_ai_control(
  target_lecture_session_id uuid,
  configuration jsonb,
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
  unknown_key text;
  any_enabled boolean;
begin
  if jsonb_typeof(configuration) <> 'object' then
    raise exception 'AI configuration must be an object' using errcode = '22023';
  end if;
  if nullif(trim(target_actor_id), '') is null
     or char_length(target_actor_id) > 200 then
    raise exception 'invalid AI control actor id' using errcode = '22023';
  end if;

  select key
  into unknown_key
  from jsonb_object_keys(configuration) as key
  where key not in (
    'captions_enabled',
    'summaries_enabled',
    'material_analysis_enabled',
    'poll_suggestions_enabled',
    'academic_answers_enabled',
    'budget_limit_microusd',
    'audio_seconds_limit',
    'input_token_limit',
    'output_token_limit',
    'summary_call_limit',
    'material_analysis_call_limit',
    'poll_generation_limit',
    'academic_answer_limit',
    'max_concurrent_operations'
  )
  limit 1;
  if unknown_key is not null then
    raise exception 'unknown AI configuration key: %', unknown_key
      using errcode = '22023';
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
  if lecture_row.status = 'closed' then
    raise exception 'lecture is closed' using errcode = 'P0001';
  end if;

  insert into public.lecture_ai_control (lecture_session_id, hard_stop_at)
  values (target_lecture_session_id, lecture_row.hard_stop_at)
  on conflict (lecture_session_id) do nothing;

  select control.*
  into control_row
  from public.lecture_ai_control as control
  where control.lecture_session_id = target_lecture_session_id
  for update;

  any_enabled :=
    coalesce((configuration ->> 'captions_enabled')::boolean, control_row.captions_enabled)
    or coalesce((configuration ->> 'summaries_enabled')::boolean, control_row.summaries_enabled)
    or coalesce((configuration ->> 'material_analysis_enabled')::boolean, control_row.material_analysis_enabled)
    or coalesce((configuration ->> 'poll_suggestions_enabled')::boolean, control_row.poll_suggestions_enabled)
    or coalesce((configuration ->> 'academic_answers_enabled')::boolean, control_row.academic_answers_enabled);

  update public.lecture_ai_control as control
  set
    status = case
      when control.active_operation_count > 0 then 'running'
      when any_enabled then 'ready'
      else 'disabled'
    end,
    captions_enabled = coalesce(
      (configuration ->> 'captions_enabled')::boolean,
      control.captions_enabled
    ),
    summaries_enabled = coalesce(
      (configuration ->> 'summaries_enabled')::boolean,
      control.summaries_enabled
    ),
    material_analysis_enabled = coalesce(
      (configuration ->> 'material_analysis_enabled')::boolean,
      control.material_analysis_enabled
    ),
    poll_suggestions_enabled = coalesce(
      (configuration ->> 'poll_suggestions_enabled')::boolean,
      control.poll_suggestions_enabled
    ),
    academic_answers_enabled = coalesce(
      (configuration ->> 'academic_answers_enabled')::boolean,
      control.academic_answers_enabled
    ),
    budget_limit_microusd = coalesce(
      (configuration ->> 'budget_limit_microusd')::bigint,
      control.budget_limit_microusd
    ),
    audio_seconds_limit = coalesce(
      (configuration ->> 'audio_seconds_limit')::integer,
      control.audio_seconds_limit
    ),
    input_token_limit = coalesce(
      (configuration ->> 'input_token_limit')::bigint,
      control.input_token_limit
    ),
    output_token_limit = coalesce(
      (configuration ->> 'output_token_limit')::bigint,
      control.output_token_limit
    ),
    summary_call_limit = coalesce(
      (configuration ->> 'summary_call_limit')::integer,
      control.summary_call_limit
    ),
    material_analysis_call_limit = coalesce(
      (configuration ->> 'material_analysis_call_limit')::integer,
      control.material_analysis_call_limit
    ),
    poll_generation_limit = coalesce(
      (configuration ->> 'poll_generation_limit')::integer,
      control.poll_generation_limit
    ),
    academic_answer_limit = coalesce(
      (configuration ->> 'academic_answer_limit')::integer,
      control.academic_answer_limit
    ),
    max_concurrent_operations = coalesce(
      (configuration ->> 'max_concurrent_operations')::integer,
      control.max_concurrent_operations
    ),
    hard_stop_at = lecture_row.hard_stop_at,
    stop_requested_at = null,
    stopped_at = null,
    stop_reason = null,
    version = control.version + 1,
    updated_at = statement_timestamp()
  where control.lecture_session_id = target_lecture_session_id
  returning * into control_row;

  return to_jsonb(control_row);
end;
$$;

create function private.start_lecture_ai_operation(
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
  control_row public.lecture_ai_control%rowtype;
  existing_usage public.ai_usage_ledger%rowtype;
  created_usage public.ai_usage_ledger%rowtype;
  feature_is_enabled boolean;
  rejection_reason text;
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

  if not private.is_lecture_open(target_lecture_session_id) then
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
  elsif control_row.active_operation_count >= control_row.max_concurrent_operations then
    rejection_reason := 'concurrency_limit';
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
    return jsonb_build_object(
      'accepted', false,
      'idempotent_replay', false,
      'reason', rejection_reason
    );
  end if;

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

  update public.lecture_ai_control as control
  set
    status = 'running',
    active_operation_count = control.active_operation_count + 1,
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

create function private.finish_lecture_ai_operation(
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
  usage_row public.ai_usage_ledger%rowtype;
  control_row public.lecture_ai_control%rowtype;
  effective_status text;
  accept_result boolean;
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
  into usage_row
  from public.ai_usage_ledger as usage
  where usage.id = target_operation_id
  for update;

  if not found then
    raise exception 'AI operation not found' using errcode = 'P0002';
  end if;

  if usage_row.status <> 'running' then
    return jsonb_build_object(
      'accepted', usage_row.result_accepted,
      'idempotent_replay', true,
      'operation', to_jsonb(usage_row)
    );
  end if;

  perform private.close_lecture_if_expired(usage_row.lecture_session_id);

  select control.*
  into control_row
  from public.lecture_ai_control as control
  where control.lecture_session_id = usage_row.lecture_session_id
  for update;

  accept_result := target_status = 'succeeded'
    and private.is_lecture_open(usage_row.lecture_session_id)
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

  update public.lecture_ai_control as control
  set
    active_operation_count = greatest(control.active_operation_count - 1, 0),
    status = case
      when control.status in ('stopping', 'stopped') then 'stopped'
      when control.active_operation_count - 1 > 0 then 'running'
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

create function private.stop_lecture_ai_control(
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

  select control.*
  into control_row
  from public.lecture_ai_control as control
  where control.lecture_session_id = target_lecture_session_id
  for update;

  if not found then
    raise exception 'AI control is not configured' using errcode = 'P0001';
  end if;

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

create function public.admin_configure_lecture_ai_control(
  target_lecture_session_id uuid,
  configuration jsonb,
  target_actor_id text default 'admin-session'
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select private.configure_lecture_ai_control(
    target_lecture_session_id,
    configuration,
    target_actor_id
  );
$$;

create function public.admin_start_lecture_ai_operation(
  target_lecture_session_id uuid,
  target_feature text,
  target_idempotency_key text,
  estimated_microusd bigint default 0,
  estimated_audio_seconds integer default 0,
  estimated_input_tokens bigint default 0,
  estimated_output_tokens bigint default 0,
  target_actor_id text default 'admin-session'
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select private.start_lecture_ai_operation(
    target_lecture_session_id,
    target_feature,
    target_idempotency_key,
    estimated_microusd,
    estimated_audio_seconds,
    estimated_input_tokens,
    estimated_output_tokens,
    target_actor_id
  );
$$;

create function public.admin_finish_lecture_ai_operation(
  target_operation_id uuid,
  target_status text,
  actual_microusd bigint default 0,
  actual_audio_seconds integer default 0,
  actual_input_tokens bigint default 0,
  actual_output_tokens bigint default 0,
  provider_request_id text default null,
  error_code text default null
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select private.finish_lecture_ai_operation(
    target_operation_id,
    target_status,
    actual_microusd,
    actual_audio_seconds,
    actual_input_tokens,
    actual_output_tokens,
    provider_request_id,
    error_code
  );
$$;

create function public.admin_stop_lecture_ai_control(
  target_lecture_session_id uuid,
  target_reason text,
  target_actor_id text default 'admin-session'
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select private.stop_lecture_ai_control(
    target_lecture_session_id,
    target_reason,
    target_actor_id
  );
$$;

create function private.restore_lecture_archive(
  target_lecture_session_id uuid,
  target_actor_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  archive_row public.lecture_archive_state%rowtype;
begin
  if nullif(trim(target_actor_id), '') is null
     or char_length(target_actor_id) > 200 then
    raise exception 'invalid archive restore actor' using errcode = '22023';
  end if;

  select archive.*
  into archive_row
  from public.lecture_archive_state as archive
  where archive.lecture_session_id = target_lecture_session_id
  for update;

  if not found then
    raise exception 'archive state not found' using errcode = 'P0002';
  end if;

  if archive_row.status = 'archived' then
    update public.lecture_archive_state as archive
    set
      status = 'restored',
      restored_at = statement_timestamp(),
      error_message = null,
      version = archive.version + 1,
      updated_at = statement_timestamp()
    where archive.lecture_session_id = target_lecture_session_id
    returning * into archive_row;

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
      'restore-' || archive_row.version::text,
      'lecture_archive_restored',
      'admin',
      target_actor_id,
      'manual_restore',
      statement_timestamp(),
      jsonb_build_object('student_access_restored', false)
    );
  end if;

  return to_jsonb(archive_row);
end;
$$;

create function public.admin_restore_lecture_archive(
  target_lecture_session_id uuid,
  target_actor_id text default 'admin-session'
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select private.restore_lecture_archive(
    target_lecture_session_id,
    target_actor_id
  );
$$;

create or replace function public.admin_set_lecture_status(
  target_lecture_session_id uuid,
  target_action text,
  transition_at timestamptz default now()
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  transition_result jsonb;
begin
  -- transition_at is retained only for old callers. Canonical time is always DB time.
  perform transition_at;
  if target_action = 'start' then
    transition_result := private.start_lecture_core(
      target_lecture_session_id,
      'admin-session'
    );
    return transition_result ->> 'status' = 'open';
  elsif target_action = 'close' then
    transition_result := private.close_lecture_core(
      target_lecture_session_id,
      'manual',
      'admin',
      'admin-session'
    );
    return transition_result ->> 'status' = 'closed';
  end if;

  raise exception 'unknown lecture action: %', target_action;
end;
$$;

create or replace function public.admin_create_poll(
  target_lecture_session_id uuid,
  poll_question text,
  poll_type text,
  option_labels text[]
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  created_poll_id uuid;
begin
  if not exists (
    select 1
    from public.lecture_sessions as lecture
    where lecture.id = target_lecture_session_id
      and (
        lecture.status = 'draft'
        or private.is_lecture_open(lecture.id)
      )
  ) then
    raise exception 'lecture is not available for poll creation';
  end if;
  if poll_type not in ('single', 'multiple') then
    raise exception 'invalid poll type';
  end if;
  if cardinality(option_labels) not between 2 and 8 then
    raise exception 'poll requires between 2 and 8 options';
  end if;
  if exists (
    select 1 from unnest(option_labels) as option_label
    where nullif(trim(option_label), '') is null
  ) then
    raise exception 'poll options cannot be empty';
  end if;
  if (
    select count(*)
    from (
      select distinct lower(trim(option_label))
      from unnest(option_labels) as option_label
    ) as unique_options
  ) <> cardinality(option_labels) then
    raise exception 'poll options must be unique';
  end if;

  insert into public.polls (lecture_session_id, question, type, status)
  values (target_lecture_session_id, trim(poll_question), poll_type, 'draft')
  returning id into created_poll_id;

  insert into public.poll_options (
    lecture_session_id, poll_id, label, display_order
  )
  select
    target_lecture_session_id,
    created_poll_id,
    trim(option_label),
    option_order::integer
  from unnest(option_labels) with ordinality
    as options(option_label, option_order);

  return created_poll_id;
end;
$$;

create or replace function public.admin_set_poll_status(
  target_lecture_session_id uuid,
  target_poll_id uuid,
  target_status text
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  changed_rows integer;
begin
  if target_status = 'open' then
    update public.polls as poll
    set status = 'open'
    where poll.id = target_poll_id
      and poll.lecture_session_id = target_lecture_session_id
      and poll.status in ('draft', 'closed')
      and private.is_lecture_open(target_lecture_session_id);
  elsif target_status = 'closed' then
    update public.polls as poll
    set status = 'closed'
    where poll.id = target_poll_id
      and poll.lecture_session_id = target_lecture_session_id
      and poll.status = 'open';
  else
    raise exception 'invalid poll status: %', target_status;
  end if;

  get diagnostics changed_rows = row_count;
  return changed_rows = 1;
end;
$$;

create or replace function public.admin_update_pdf_display(
  target_lecture_session_id uuid,
  target_pdf_document_id text,
  target_current_pdf_page integer,
  target_display_mode text
)
returns table (
  lecture_session_id uuid,
  pdf_document_id text,
  current_pdf_page integer,
  display_mode text,
  display_version bigint,
  state_version bigint,
  updated_at timestamptz
)
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if target_pdf_document_id is not null
     and target_pdf_document_id !~ '^[a-z0-9][a-z0-9-]{0,63}$' then
    raise exception 'Invalid PDF document ID.';
  end if;
  if target_current_pdf_page < 1 then
    raise exception 'PDF page must be greater than or equal to 1.';
  end if;
  if target_pdf_document_id is null and target_current_pdf_page <> 1 then
    raise exception 'A lecture without a PDF must remain on page 1.';
  end if;
  if target_display_mode not in ('normal', 'presentation', 'slideOnly') then
    raise exception 'Invalid display mode.';
  end if;

  return query
  update public.lecture_live_state as live
  set
    pdf_document_id = target_pdf_document_id,
    current_pdf_page = target_current_pdf_page,
    display_mode = target_display_mode,
    display_version = live.display_version + 1,
    pdf_version = live.pdf_version + 1,
    state_version = live.state_version + 1,
    updated_at = statement_timestamp()
  where live.lecture_session_id = target_lecture_session_id
    and exists (
      select 1
      from public.lecture_sessions as lecture
      where lecture.id = target_lecture_session_id
        and (
          lecture.status = 'draft'
          or private.is_lecture_open(lecture.id)
        )
    )
    and (live.pdf_document_id, live.current_pdf_page, live.display_mode)
      is distinct from (
        target_pdf_document_id,
        target_current_pdf_page,
        target_display_mode
      )
  returning
    live.lecture_session_id,
    live.pdf_document_id,
    live.current_pdf_page,
    live.display_mode,
    live.display_version,
    live.state_version,
    live.updated_at;

  if found then
    return;
  end if;

  return query
  select
    live.lecture_session_id,
    live.pdf_document_id,
    live.current_pdf_page,
    live.display_mode,
    live.display_version,
    live.state_version,
    live.updated_at
  from public.lecture_live_state as live
  join public.lecture_sessions as lecture
    on lecture.id = live.lecture_session_id
  where live.lecture_session_id = target_lecture_session_id
    and (
      lecture.status = 'draft'
      or private.is_lecture_open(lecture.id)
    );
end;
$$;

drop policy if exists "authenticated clients can read active display compatibility state"
  on public.lecture_display_state;
create policy "authenticated clients can read active display compatibility state"
on public.lecture_display_state
for select
to authenticated
using (
  private.is_lecture_open(lecture_session_id)
  or exists (
    select 1
    from public.participants as participant
    join public.lecture_sessions as lecture
      on lecture.id = participant.lecture_session_id
    where participant.lecture_session_id = lecture_display_state.lecture_session_id
      and participant.auth_user_id = (select auth.uid())
      and lecture.status = 'closed'
      and lecture.archive_expires_at > statement_timestamp()
  )
);

-- All internal Definer functions are private and denied by default. Public
-- wrappers are Invoker functions with explicit role grants.
revoke all on function private.is_lecture_open_at(uuid, timestamptz)
  from public, anon, authenticated, service_role;
revoke all on function private.normalize_lecture_lifecycle_fields()
  from public, anon, authenticated, service_role;
revoke all on function private.close_lecture_core(uuid, text, text, text)
  from public, anon, authenticated, service_role;
revoke all on function private.close_lecture_if_expired(uuid, text, text)
  from public, anon, authenticated, service_role;
revoke all on function private.start_lecture_core(uuid, text)
  from public, anon, authenticated, service_role;
revoke all on function private.close_expired_lectures(integer)
  from public, anon, authenticated, service_role;
revoke all on function private.archive_due_lectures(integer)
  from public, anon, authenticated, service_role;
revoke all on function private.run_lecture_lifecycle_maintenance(integer, integer)
  from public, anon, authenticated, service_role;
revoke all on function private.can_reconcile_lecture(uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.configure_lecture_ai_control(uuid, jsonb, text)
  from public, anon, authenticated, service_role;
revoke all on function private.start_lecture_ai_operation(
  uuid, text, text, bigint, integer, bigint, bigint, text
) from public, anon, authenticated, service_role;
revoke all on function private.finish_lecture_ai_operation(
  uuid, text, bigint, integer, bigint, bigint, text, text
) from public, anon, authenticated, service_role;
revoke all on function private.stop_lecture_ai_control(uuid, text, text)
  from public, anon, authenticated, service_role;
revoke all on function private.restore_lecture_archive(uuid, text)
  from public, anon, authenticated, service_role;
revoke all on function private.get_lecture_terminal_state_v2(uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.get_lecture_archive_v2(uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.get_lecture_public_snapshot_v2_phase1_core(
  uuid, bigint, bigint, bigint, bigint, bigint, bigint, bigint,
  timestamptz, uuid, integer
) from public, anon, authenticated, service_role;
revoke all on function private.get_lecture_participant_state_v2_phase1_core(uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.get_lecture_comment_history_v2_phase1_core(
  uuid, timestamptz, uuid, integer
) from public, anon, authenticated, service_role;

revoke all on function private.get_lecture_public_snapshot_v2(
  uuid, bigint, bigint, bigint, bigint, bigint, bigint, bigint,
  timestamptz, uuid, integer
) from public, anon, authenticated, service_role;
revoke all on function private.get_lecture_participant_state_v2(uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.get_lecture_comment_history_v2(
  uuid, timestamptz, uuid, integer
) from public, anon, authenticated, service_role;

grant execute on function private.get_lecture_public_snapshot_v2(
  uuid, bigint, bigint, bigint, bigint, bigint, bigint, bigint,
  timestamptz, uuid, integer
) to authenticated;
grant execute on function private.get_lecture_participant_state_v2(uuid)
  to authenticated;
grant execute on function private.get_lecture_comment_history_v2(
  uuid, timestamptz, uuid, integer
) to authenticated;
grant execute on function private.get_lecture_terminal_state_v2(uuid)
  to authenticated;
grant execute on function private.get_lecture_archive_v2(uuid)
  to authenticated;

grant execute on function private.start_lecture_core(uuid, text) to service_role;
grant execute on function private.close_lecture_core(uuid, text, text, text)
  to service_role;
grant execute on function private.close_lecture_if_expired(uuid, text, text)
  to service_role;
grant execute on function private.configure_lecture_ai_control(uuid, jsonb, text)
  to service_role;
grant execute on function private.start_lecture_ai_operation(
  uuid, text, text, bigint, integer, bigint, bigint, text
) to service_role;
grant execute on function private.finish_lecture_ai_operation(
  uuid, text, bigint, integer, bigint, bigint, text, text
) to service_role;
grant execute on function private.stop_lecture_ai_control(uuid, text, text)
  to service_role;
grant execute on function private.restore_lecture_archive(uuid, text)
  to service_role;
grant execute on function private.is_lecture_open(uuid) to service_role;
grant execute on function private.is_poll_open(uuid, uuid) to service_role;

grant usage on schema private to service_role;

revoke all on function public.get_lecture_terminal_state_v2(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.get_lecture_archive_v2(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.get_lecture_terminal_state_v2(uuid)
  to authenticated;
grant execute on function public.get_lecture_archive_v2(uuid)
  to authenticated;

revoke all on function public.admin_configure_lecture_ai_control(uuid, jsonb, text)
  from public, anon, authenticated, service_role;
revoke all on function public.admin_start_lecture_ai_operation(
  uuid, text, text, bigint, integer, bigint, bigint, text
) from public, anon, authenticated, service_role;
revoke all on function public.admin_finish_lecture_ai_operation(
  uuid, text, bigint, integer, bigint, bigint, text, text
) from public, anon, authenticated, service_role;
revoke all on function public.admin_stop_lecture_ai_control(uuid, text, text)
  from public, anon, authenticated, service_role;
revoke all on function public.admin_restore_lecture_archive(uuid, text)
  from public, anon, authenticated, service_role;

grant execute on function public.admin_configure_lecture_ai_control(uuid, jsonb, text)
  to service_role;
grant execute on function public.admin_start_lecture_ai_operation(
  uuid, text, text, bigint, integer, bigint, bigint, text
) to service_role;
grant execute on function public.admin_finish_lecture_ai_operation(
  uuid, text, bigint, integer, bigint, bigint, text, text
) to service_role;
grant execute on function public.admin_stop_lecture_ai_control(uuid, text, text)
  to service_role;
grant execute on function public.admin_restore_lecture_archive(uuid, text)
  to service_role;

comment on column public.lecture_sessions.hard_stop_at is
  'Canonical DB deadline fixed to started_at + 90 minutes for Phase 2 starts.';
comment on table public.lecture_ai_control is
  'Content-free, server-side AI admission and hard-limit state. No provider key is stored.';
comment on table public.ai_usage_ledger is
  'Content-free conservative reservation/usage ledger for AI operations.';
comment on table public.lecture_archive_state is
  'Reversible logical archive state. Phase 2 performs no physical deletion.';
