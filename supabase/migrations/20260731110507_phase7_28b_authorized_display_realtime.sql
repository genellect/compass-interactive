-- Phase 7.28B: low-latency, browser-independent classroom Display delivery.
--
-- The durable live snapshot remains authoritative. Realtime Broadcast is an
-- authenticated acceleration path for the Admin and the exact Display browser
-- that atomically claims an Admin-issued Display token. Student participants
-- remain on the existing five-second snapshot protocol.
--
-- Supabase owns the realtime schema. This migration only adds the supported
-- RLS policies on realtime.messages; it never creates, alters, or drops a
-- realtime schema object.

create table public.display_realtime_sessions (
  id uuid primary key,
  lecture_session_id uuid not null
    references public.lecture_sessions(id) on delete cascade,
  token_jti_hash text not null unique check (
    token_jti_hash ~ '^[0-9a-f]{64}$'
  ),
  topic text not null unique check (
    topic ~ '^display:[0-9a-f-]{36}:[0-9a-f-]{36}$'
    and char_length(topic) <= 96
  ),
  admin_session_id uuid not null
    references public.admin_sessions(id) on delete cascade,
  admin_auth_user_id uuid not null,
  display_auth_user_id uuid,
  issued_at timestamptz not null default statement_timestamp(),
  claimed_at timestamptz,
  expires_at timestamptz not null,
  hard_stop_at timestamptz not null,
  revoked_at timestamptz,
  revoke_reason text check (
    revoke_reason is null or char_length(revoke_reason) between 1 and 80
  ),
  last_caption_relay_at timestamptz,
  last_caption_delta_relay_at timestamptz,
  caption_control_window_started_at timestamptz,
  caption_control_relay_count integer not null default 0 check (
    caption_control_relay_count between 0 and 60
  ),
  last_caption_stream_id uuid,
  last_caption_sequence bigint check (
    last_caption_sequence is null or last_caption_sequence >= 0
  ),
  updated_at timestamptz not null default statement_timestamp(),
  check (issued_at < expires_at),
  check (expires_at <= hard_stop_at),
  check ((display_auth_user_id is null) = (claimed_at is null)),
  check ((revoked_at is null) = (revoke_reason is null))
);

comment on table public.display_realtime_sessions is
  'Hash-at-rest Display-token bindings for private classroom Broadcast. Raw Display tokens and captions are never stored.';

-- This DB-side gate closes the small rollback window that would otherwise
-- remain after disabling only the Edge/client flags: already-authorized
-- Realtime channels cache their join decision. The service-only setter below
-- disables new work and revokes every live binding in the same transaction.
create table private.display_realtime_runtime_gate (
  singleton boolean primary key default true check (singleton),
  enabled boolean not null default true,
  updated_at timestamptz not null default statement_timestamp()
);

insert into private.display_realtime_runtime_gate (singleton, enabled)
values (true, true);

alter table private.display_realtime_runtime_gate enable row level security;
revoke all on private.display_realtime_runtime_gate
  from public, anon, authenticated;
grant select, update on private.display_realtime_runtime_gate
  to service_role;

create index display_realtime_sessions_topic_access_idx
  on public.display_realtime_sessions (topic, expires_at)
  where revoked_at is null;

create index display_realtime_sessions_lecture_cleanup_idx
  on public.display_realtime_sessions (
    lecture_session_id,
    expires_at,
    id
  );

create index display_realtime_sessions_global_cleanup_idx
  on public.display_realtime_sessions (
    (coalesce(revoked_at, expires_at)),
    id
  );

create index display_realtime_sessions_admin_active_idx
  on public.display_realtime_sessions (admin_session_id, expires_at)
  where revoked_at is null;

-- One live classroom Display per lecture bounds Broadcast fan-out and turns
-- repeated CTA clicks into deterministic replacement instead of accumulation.
create unique index display_realtime_sessions_one_active_per_lecture_idx
  on public.display_realtime_sessions (lecture_session_id)
  where revoked_at is null;

alter table public.display_realtime_sessions enable row level security;
revoke all on public.display_realtime_sessions
  from public, anon, authenticated;
grant select, insert, update, delete on public.display_realtime_sessions
  to service_role;

create function public.register_display_realtime_session_v1(
  target_session_id uuid,
  target_lecture_session_id uuid,
  target_token_jti_hash text,
  target_token_expires_at timestamptz,
  target_admin_session_id uuid,
  target_admin_auth_user_id uuid
)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  effective_now timestamptz := statement_timestamp();
  lecture_row public.lecture_sessions%rowtype;
  admin_row public.admin_sessions%rowtype;
  effective_expiry timestamptz;
  target_topic text;
  registered public.display_realtime_sessions%rowtype;
  existing public.display_realtime_sessions%rowtype;
begin
  if target_session_id is null
     or target_lecture_session_id is null
     or target_admin_session_id is null
     or target_admin_auth_user_id is null
     or target_token_jti_hash !~ '^[0-9a-f]{64}$'
     or target_token_expires_at <= effective_now then
    raise exception 'invalid Display Realtime registration'
      using errcode = '22023';
  end if;

  perform 1
  from private.display_realtime_runtime_gate as gate
  where gate.singleton
    and gate.enabled
  for share;
  if not found then
    raise exception 'Display Realtime is disabled'
      using errcode = 'P0001';
  end if;

  -- Keep the global lock order aligned with Phase 7.28C: runtime gate,
  -- Admin session, then lecture. This prevents issue-vs-revoke deadlocks.
  select session.*
  into admin_row
  from public.admin_sessions as session
  where session.id = target_admin_session_id
  for share;

  if not found
     or admin_row.auth_user_id <> target_admin_auth_user_id
     or admin_row.revoked_at is not null
     or admin_row.expires_at <= effective_now
     or admin_row.idle_expires_at <= effective_now then
    raise exception 'tracked Admin session is not active'
      using errcode = '42501';
  end if;

  select lecture.*
  into lecture_row
  from public.lecture_sessions as lecture
  where lecture.id = target_lecture_session_id
  for update;

  if not found
     or lecture_row.status <> 'open'
     or lecture_row.started_at is null
     or lecture_row.hard_stop_at is null
     or lecture_row.closed_at is not null
     or lecture_row.hard_stop_at <= effective_now then
    raise exception 'lecture is not open for Display Realtime'
      using errcode = 'P0001';
  end if;

  effective_expiry := least(
    target_token_expires_at,
    lecture_row.hard_stop_at,
    admin_row.expires_at
  );
  if effective_expiry <= effective_now then
    raise exception 'Display Realtime registration has expired'
      using errcode = 'P0001';
  end if;

  target_topic := 'display:' || target_lecture_session_id::text || ':' ||
    target_session_id::text;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'display-realtime:' || target_lecture_session_id::text,
      0
    )
  );

  -- A runtime-gate rollback may temporarily leave the same claimed UID on the
  -- signed snapshot path. A later Display registration permanently replaces
  -- every such fallback as well as the currently active binding, so an older
  -- link can never regain access after the replacement is itself revoked.
  for existing in
    select session.*
    from public.display_realtime_sessions as session
    where session.lecture_session_id = target_lecture_session_id
      and (
        session.revoked_at is null
        or session.revoke_reason = 'feature_disabled'
      )
    order by session.id
    for update
  loop
    begin
      perform realtime.send(
        jsonb_build_object(
          'lectureSessionId', target_lecture_session_id,
          'reason', 'session_replaced',
          'sentAt', statement_timestamp()
        ),
        'session_closed',
        existing.topic,
        true
      );
    exception when others then
      null;
    end;

    update public.display_realtime_sessions
    set
      revoked_at = coalesce(revoked_at, effective_now),
      revoke_reason = 'session_replaced',
      updated_at = effective_now
    where id = existing.id
      and (
        revoked_at is null
        or revoke_reason = 'feature_disabled'
      );
  end loop;

  insert into public.display_realtime_sessions (
    id,
    lecture_session_id,
    token_jti_hash,
    topic,
    admin_session_id,
    admin_auth_user_id,
    issued_at,
    expires_at,
    hard_stop_at
  ) values (
    target_session_id,
    target_lecture_session_id,
    target_token_jti_hash,
    target_topic,
    target_admin_session_id,
    target_admin_auth_user_id,
    effective_now,
    effective_expiry,
    lecture_row.hard_stop_at
  )
  returning * into registered;

  return jsonb_build_object(
    'expires_at', registered.expires_at,
    'lecture_session_id', registered.lecture_session_id,
    'session_id', registered.id,
    'topic', registered.topic
  );
end;
$$;

create function public.claim_display_realtime_session_v1(
  target_token_jti_hash text,
  target_lecture_session_id uuid,
  target_display_auth_user_id uuid
)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  effective_now timestamptz := statement_timestamp();
  binding public.display_realtime_sessions%rowtype;
  lecture_row public.lecture_sessions%rowtype;
  admin_row public.admin_sessions%rowtype;
begin
  if target_token_jti_hash !~ '^[0-9a-f]{64}$'
     or target_lecture_session_id is null
     or target_display_auth_user_id is null then
    return jsonb_build_object('status', 'invalid');
  end if;

  perform 1
  from private.display_realtime_runtime_gate as gate
  where gate.singleton
    and gate.enabled
  for share;
  if not found then
    return jsonb_build_object('status', 'unavailable');
  end if;

  select session.*
  into binding
  from public.display_realtime_sessions as session
  where session.token_jti_hash = target_token_jti_hash
    and session.lecture_session_id = target_lecture_session_id
  for update;

  if not found then
    return jsonb_build_object('status', 'unavailable');
  end if;

  select lecture.*
  into lecture_row
  from public.lecture_sessions as lecture
  where lecture.id = binding.lecture_session_id;

  select session.*
  into admin_row
  from public.admin_sessions as session
  where session.id = binding.admin_session_id;

  if binding.revoked_at is not null
     or binding.expires_at <= effective_now
     or binding.hard_stop_at <= effective_now
     or lecture_row.id is null
     or lecture_row.status <> 'open'
     or lecture_row.closed_at is not null
     or lecture_row.hard_stop_at is null
     or lecture_row.hard_stop_at <= effective_now
     or admin_row.id is null
     or admin_row.auth_user_id <> binding.admin_auth_user_id
     or admin_row.revoked_at is not null
     or admin_row.expires_at <= effective_now
     or admin_row.idle_expires_at <= effective_now then
    if binding.revoked_at is null then
      update public.display_realtime_sessions
      set
        revoked_at = effective_now,
        revoke_reason = 'binding_expired',
        updated_at = effective_now
      where id = binding.id;
    end if;
    return jsonb_build_object('status', 'expired');
  end if;

  if binding.display_auth_user_id is not null
     and binding.display_auth_user_id <> target_display_auth_user_id then
    return jsonb_build_object('status', 'claimed_by_other');
  end if;

  if binding.display_auth_user_id is null then
    update public.display_realtime_sessions
    set
      display_auth_user_id = target_display_auth_user_id,
      claimed_at = effective_now,
      updated_at = effective_now
    where id = binding.id
      and display_auth_user_id is null
    returning * into binding;

    -- The row is already locked by this transaction, so a missing update is
    -- an internal invariant failure rather than a retryable claim race.
    if not found then
      raise exception 'Display Realtime claim could not be persisted'
        using errcode = 'P0001';
    end if;
  end if;

  return jsonb_build_object(
    'expires_at', binding.expires_at,
    'hard_stop_at', binding.hard_stop_at,
    'lecture_session_id', binding.lecture_session_id,
    'session_id', binding.id,
    'status', 'claimed',
    'topic', binding.topic
  );
end;
$$;

create function public.verify_display_realtime_session_v1(
  target_token_jti_hash text,
  target_lecture_session_id uuid,
  target_display_auth_user_id uuid
)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select exists (
    select 1
    from private.display_realtime_runtime_gate as gate
    join public.display_realtime_sessions as binding
      on gate.singleton
    join public.lecture_sessions as lecture
      on lecture.id = binding.lecture_session_id
    join public.admin_sessions as admin_session
      on admin_session.id = binding.admin_session_id
    where gate.enabled
      and binding.token_jti_hash = target_token_jti_hash
      and binding.lecture_session_id = target_lecture_session_id
      and binding.display_auth_user_id = target_display_auth_user_id
      and binding.revoked_at is null
      and binding.expires_at > statement_timestamp()
      and binding.hard_stop_at > statement_timestamp()
      and lecture.status = 'open'
      and lecture.closed_at is null
      and lecture.hard_stop_at > statement_timestamp()
      and admin_session.auth_user_id = binding.admin_auth_user_id
      and admin_session.revoked_at is null
      and admin_session.expires_at > statement_timestamp()
      and admin_session.idle_expires_at > statement_timestamp()
  );
$$;

-- A runtime rollback intentionally returns the already-claimed Display to the
-- durable snapshot/PDF path. The Edge functions must not infer that downgrade
-- from revoke_reason alone: every request rechecks the DB gate, exact browser
-- identity, binding lifetime, lecture lifecycle, and issuing Admin session.
create function public.verify_display_snapshot_fallback_v1(
  target_token_jti_hash text,
  target_lecture_session_id uuid,
  target_display_auth_user_id uuid
)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select exists (
    select 1
    from private.display_realtime_runtime_gate as gate
    join public.display_realtime_sessions as binding
      on gate.singleton
    join public.lecture_sessions as lecture
      on lecture.id = binding.lecture_session_id
    join public.admin_sessions as admin_session
      on admin_session.id = binding.admin_session_id
    where not gate.enabled
      and binding.token_jti_hash = target_token_jti_hash
      and binding.lecture_session_id = target_lecture_session_id
      and binding.display_auth_user_id = target_display_auth_user_id
      and binding.revoked_at is not null
      and binding.revoke_reason = 'feature_disabled'
      and binding.expires_at > statement_timestamp()
      and binding.hard_stop_at > statement_timestamp()
      and lecture.status = 'open'
      and lecture.started_at is not null
      and lecture.closed_at is null
      and lecture.hard_stop_at > statement_timestamp()
      and admin_session.auth_user_id = binding.admin_auth_user_id
      and admin_session.revoked_at is null
      and admin_session.expires_at > statement_timestamp()
      and admin_session.idle_expires_at > statement_timestamp()
  );
$$;

create function public.claim_display_caption_relay_v1(
  target_topic text,
  target_lecture_session_id uuid,
  target_admin_auth_user_id uuid,
  target_stream_id uuid,
  target_sequence bigint,
  target_source text
)
returns text
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  binding public.display_realtime_sessions%rowtype;
  effective_now timestamptz := statement_timestamp();
begin
  if target_topic is null
     or target_lecture_session_id is null
     or target_admin_auth_user_id is null
     or target_stream_id is null
     or target_sequence is null
     or target_sequence < 0
     or target_source not in ('delta', 'completed', 'stopped') then
    return 'invalid';
  end if;

  if not coalesce((
    select gate.enabled
    from private.display_realtime_runtime_gate as gate
    where gate.singleton
  ), false) then
    return 'unavailable';
  end if;

  select session.*
  into binding
  from public.display_realtime_sessions as session
  join public.lecture_sessions as lecture
    on lecture.id = session.lecture_session_id
  join public.admin_sessions as admin_session
    on admin_session.id = session.admin_session_id
  where session.topic = target_topic
    and session.lecture_session_id = target_lecture_session_id
    and session.admin_auth_user_id = target_admin_auth_user_id
    and session.display_auth_user_id is not null
    and session.revoked_at is null
    and session.expires_at > effective_now
    and session.hard_stop_at > effective_now
    and lecture.status = 'open'
    and lecture.closed_at is null
    and lecture.hard_stop_at > effective_now
    and admin_session.auth_user_id = session.admin_auth_user_id
    and admin_session.revoked_at is null
    and admin_session.expires_at > effective_now
    and admin_session.idle_expires_at > effective_now
  for update of session;

  if not found then
    return 'unavailable';
  end if;

  if binding.last_caption_stream_id = target_stream_id
     and binding.last_caption_sequence is not null
     and target_sequence <= binding.last_caption_sequence then
    return 'stale';
  end if;

  if target_source = 'delta'
     and binding.last_caption_delta_relay_at is not null
     and binding.last_caption_delta_relay_at > effective_now - interval '450 milliseconds' then
    return 'rate_limited';
  end if;

  -- Final transcripts and explicit stop events must not be lost merely because
  -- a coalesced delta was delivered immediately beforehand. They therefore do
  -- not share the delta throttle. A deliberately generous independent burst
  -- ceiling still bounds a compromised Admin client without affecting normal
  -- delta -> completed/stopped transitions.
  if target_source <> 'delta'
     and binding.caption_control_window_started_at is not null
     and binding.caption_control_window_started_at >
       effective_now - interval '10 seconds'
     and binding.caption_control_relay_count >= 60 then
    return 'rate_limited';
  end if;

  update public.display_realtime_sessions
  set
    last_caption_relay_at = effective_now,
    last_caption_delta_relay_at = case
      when target_source = 'delta' then effective_now
      else last_caption_delta_relay_at
    end,
    caption_control_window_started_at = case
      when target_source = 'delta' then caption_control_window_started_at
      when caption_control_window_started_at is null
        or caption_control_window_started_at <=
          effective_now - interval '10 seconds'
        then effective_now
      else caption_control_window_started_at
    end,
    caption_control_relay_count = case
      when target_source = 'delta' then caption_control_relay_count
      when caption_control_window_started_at is null
        or caption_control_window_started_at <=
          effective_now - interval '10 seconds'
        then 1
      else caption_control_relay_count + 1
    end,
    last_caption_stream_id = target_stream_id,
    last_caption_sequence = target_sequence,
    updated_at = effective_now
  where id = binding.id;

  return 'allowed';
end;
$$;

create function public.cleanup_display_realtime_sessions_v1()
returns integer
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  removed integer;
begin
  with cleanup_batch as (
    select session.id
    from public.display_realtime_sessions as session
    where coalesce(session.revoked_at, session.expires_at) <
      statement_timestamp() - interval '1 day'
    order by coalesce(session.revoked_at, session.expires_at), session.id
    limit 500
    for update skip locked
  )
  delete from public.display_realtime_sessions as session
  using cleanup_batch
  where session.id = cleanup_batch.id;
  get diagnostics removed = row_count;
  return removed;
end;
$$;

create function public.set_display_realtime_runtime_v1(
  target_enabled boolean
)
returns integer
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  binding record;
  revoked_count integer := 0;
  effective_now timestamptz := statement_timestamp();
begin
  if target_enabled is null then
    raise exception 'Display Realtime runtime state is required'
      using errcode = '22023';
  end if;

  update private.display_realtime_runtime_gate
  set
    enabled = target_enabled,
    updated_at = effective_now
  where singleton;

  if target_enabled then
    return 0;
  end if;

  for binding in
    select session.id, session.lecture_session_id, session.topic
    from public.display_realtime_sessions as session
    where session.revoked_at is null
    order by session.id
    for update
  loop
    begin
      perform realtime.send(
        jsonb_build_object(
          'lectureSessionId', binding.lecture_session_id,
          'reason', 'feature_disabled',
          'sentAt', effective_now
        ),
        'session_closed',
        binding.topic,
        true
      );
    exception when others then
      null;
    end;

    update public.display_realtime_sessions
    set
      revoked_at = effective_now,
      revoke_reason = 'feature_disabled',
      updated_at = effective_now
    where id = binding.id
      and revoked_at is null;
    if found then
      revoked_count := revoked_count + 1;
    end if;
  end loop;

  return revoked_count;
end;
$$;

revoke all on function public.register_display_realtime_session_v1(
  uuid, uuid, text, timestamptz, uuid, uuid
) from public, anon, authenticated, service_role;
revoke all on function public.claim_display_realtime_session_v1(
  text, uuid, uuid
) from public, anon, authenticated, service_role;
revoke all on function public.verify_display_realtime_session_v1(
  text, uuid, uuid
) from public, anon, authenticated, service_role;
revoke all on function public.verify_display_snapshot_fallback_v1(
  text, uuid, uuid
) from public, anon, authenticated, service_role;
revoke all on function public.claim_display_caption_relay_v1(
  text, uuid, uuid, uuid, bigint, text
) from public, anon, authenticated, service_role;
revoke all on function public.cleanup_display_realtime_sessions_v1()
  from public, anon, authenticated, service_role;
revoke all on function public.set_display_realtime_runtime_v1(boolean)
  from public, anon, authenticated, service_role;
grant execute on function public.register_display_realtime_session_v1(
  uuid, uuid, text, timestamptz, uuid, uuid
) to service_role;
grant execute on function public.claim_display_realtime_session_v1(
  text, uuid, uuid
) to service_role;
grant execute on function public.verify_display_realtime_session_v1(
  text, uuid, uuid
) to service_role;
grant execute on function public.verify_display_snapshot_fallback_v1(
  text, uuid, uuid
) to service_role;
grant execute on function public.claim_display_caption_relay_v1(
  text, uuid, uuid, uuid, bigint, text
) to service_role;
grant execute on function public.cleanup_display_realtime_sessions_v1()
  to service_role;
grant execute on function public.set_display_realtime_runtime_v1(boolean)
  to service_role;

-- Realtime Authorization evaluates this private helper only while a client
-- joins or refreshes a private channel. The binding table itself remains
-- unavailable through the Data API.
create function private.display_realtime_access_allowed_v1(
  target_topic text,
  target_publish boolean
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
      from private.display_realtime_runtime_gate as gate
      join public.display_realtime_sessions as binding
        on gate.singleton
      join public.lecture_sessions as lecture
        on lecture.id = binding.lecture_session_id
      join public.admin_sessions as admin_session
        on admin_session.id = binding.admin_session_id
      where gate.enabled
        and binding.topic = target_topic
        and binding.revoked_at is null
        and binding.expires_at > statement_timestamp()
        and binding.hard_stop_at > statement_timestamp()
        and lecture.status = 'open'
        and lecture.closed_at is null
        and lecture.hard_stop_at > statement_timestamp()
        and admin_session.auth_user_id = binding.admin_auth_user_id
        and admin_session.revoked_at is null
        and admin_session.expires_at > statement_timestamp()
        and admin_session.idle_expires_at > statement_timestamp()
        and case
          when target_publish then
            binding.admin_auth_user_id = (select auth.uid())
          else
            binding.display_auth_user_id = (select auth.uid())
        end
    );
$$;

revoke all on function private.display_realtime_access_allowed_v1(text, boolean)
  from public, anon, authenticated, service_role;
grant execute on function private.display_realtime_access_allowed_v1(text, boolean)
  to authenticated;

create policy "phase728 display can receive private broadcast"
on realtime.messages
for select
to authenticated
using (
  realtime.messages.extension = 'broadcast'
  and private.display_realtime_access_allowed_v1(
    (select realtime.topic()),
    false
  )
);

create function private.broadcast_display_state_v1()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  binding record;
begin
  if not coalesce((
    select gate.enabled
    from private.display_realtime_runtime_gate as gate
    where gate.singleton
  ), false) then
    return new;
  end if;

  if new.display_version is not distinct from old.display_version then
    return new;
  end if;

  for binding in
    select session.topic
    from public.display_realtime_sessions as session
    join public.lecture_sessions as lecture
      on lecture.id = session.lecture_session_id
    join public.admin_sessions as admin_session
      on admin_session.id = session.admin_session_id
    where session.lecture_session_id = new.lecture_session_id
      and session.display_auth_user_id is not null
      and session.revoked_at is null
      and session.expires_at > statement_timestamp()
      and session.hard_stop_at > statement_timestamp()
      and lecture.status = 'open'
      and lecture.closed_at is null
      and lecture.hard_stop_at > statement_timestamp()
      and admin_session.auth_user_id = session.admin_auth_user_id
      and admin_session.revoked_at is null
      and admin_session.expires_at > statement_timestamp()
      and admin_session.idle_expires_at > statement_timestamp()
  loop
    begin
      perform realtime.send(
        jsonb_build_object(
          'currentPdfPage', new.current_pdf_page,
          'displayVersion', new.display_version,
          'lectureSessionId', new.lecture_session_id,
          'sentAt', statement_timestamp()
        ),
        'display_state',
        binding.topic,
        true
      );
    exception when others then
      -- Broadcast is an acceleration path. The committed snapshot remains
      -- authoritative and must never be rolled back by a Realtime outage.
      null;
    end;
  end loop;

  return new;
end;
$$;

revoke all on function private.broadcast_display_state_v1()
  from public, anon, authenticated, service_role;

create trigger lecture_live_state_display_realtime
after update of display_version on public.lecture_live_state
for each row execute function private.broadcast_display_state_v1();

create function private.revoke_display_realtime_for_lecture_v1()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  binding record;
  effective_reason text;
begin
  if old.status <> 'open'
     or (
       new.status = 'open'
       and new.closed_at is null
       and new.hard_stop_at > statement_timestamp()
     ) then
    return new;
  end if;

  effective_reason := case
    when new.hard_stop_at <= statement_timestamp() then 'hard_stop'
    else 'lecture_closed'
  end;

  for binding in
    select session.id, session.topic
    from public.display_realtime_sessions as session
    where session.lecture_session_id = new.id
      and (
        session.revoked_at is null
        or session.revoke_reason = 'feature_disabled'
      )
    for update
  loop
    begin
      perform realtime.send(
        jsonb_build_object(
          'lectureSessionId', new.id,
          'reason', effective_reason,
          'sentAt', statement_timestamp()
        ),
        'session_closed',
        binding.topic,
        true
      );
    exception when others then
      null;
    end;

    update public.display_realtime_sessions
    set
      revoked_at = coalesce(revoked_at, statement_timestamp()),
      revoke_reason = effective_reason,
      updated_at = statement_timestamp()
    where id = binding.id
      and (
        revoked_at is null
        or revoke_reason = 'feature_disabled'
      );
  end loop;

  return new;
end;
$$;

revoke all on function private.revoke_display_realtime_for_lecture_v1()
  from public, anon, authenticated, service_role;

create trigger lecture_sessions_revoke_display_realtime
after update of status, closed_at, hard_stop_at on public.lecture_sessions
for each row execute function private.revoke_display_realtime_for_lecture_v1();

create function private.revoke_display_realtime_for_admin_v1()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  binding record;
begin
  if old.revoked_at is not null or new.revoked_at is null then
    return new;
  end if;

  for binding in
    select session.id, session.lecture_session_id, session.topic
    from public.display_realtime_sessions as session
    where session.admin_session_id = new.id
      and (
        session.revoked_at is null
        or session.revoke_reason = 'feature_disabled'
      )
    for update
  loop
    begin
      perform realtime.send(
        jsonb_build_object(
          'lectureSessionId', binding.lecture_session_id,
          'reason', 'admin_session_revoked',
          'sentAt', statement_timestamp()
        ),
        'session_closed',
        binding.topic,
        true
      );
    exception when others then
      null;
    end;

    update public.display_realtime_sessions
    set
      revoked_at = coalesce(revoked_at, statement_timestamp()),
      revoke_reason = 'admin_session_revoked',
      updated_at = statement_timestamp()
    where id = binding.id
      and (
        revoked_at is null
        or revoke_reason = 'feature_disabled'
      );
  end loop;

  return new;
end;
$$;

revoke all on function private.revoke_display_realtime_for_admin_v1()
  from public, anon, authenticated, service_role;

create trigger admin_sessions_revoke_display_realtime
after update of revoked_at on public.admin_sessions
for each row execute function private.revoke_display_realtime_for_admin_v1();

do $$
declare
  existing_job_id bigint;
begin
  select jobid
  into existing_job_id
  from cron.job
  where jobname = 'compass-display-realtime-cleanup';

  if existing_job_id is not null then
    perform cron.unschedule(existing_job_id);
  end if;

  perform cron.schedule(
    'compass-display-realtime-cleanup',
    '17 * * * *',
    $cleanup$select public.cleanup_display_realtime_sessions_v1();$cleanup$
  );
end;
$$;
