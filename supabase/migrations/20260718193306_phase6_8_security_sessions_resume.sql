-- Phase 6.8: tracked Admin sessions, application PIN throttling, and
-- lecture-scoped resume-token versioning.
--
-- Expand-first: no Phase 0-6.6 RPC is removed or has its signature changed.

create table public.admin_sessions (
  id uuid primary key,
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  auth_user_id uuid not null,
  pin_version_hash text not null check (
    pin_version_hash ~ '^[0-9a-f]{64}$'
  ),
  network_hash text check (
    network_hash is null or network_hash ~ '^[0-9a-f]{64}$'
  ),
  user_agent_hash text check (
    user_agent_hash is null or user_agent_hash ~ '^[0-9a-f]{64}$'
  ),
  issued_at timestamptz not null default statement_timestamp(),
  last_seen_at timestamptz not null default statement_timestamp(),
  idle_expires_at timestamptz not null,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  revoke_reason text check (
    revoke_reason is null or char_length(revoke_reason) between 1 and 80
  ),
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  check (idle_expires_at <= expires_at),
  check (issued_at <= last_seen_at),
  check (issued_at < expires_at),
  check ((revoked_at is null) = (revoke_reason is null))
);

comment on table public.admin_sessions is
  'Hash-at-rest, individually revocable Admin management sessions. Plain tokens never enter PostgreSQL.';

create index admin_sessions_active_expiry_idx
  on public.admin_sessions (expires_at, idle_expires_at)
  where revoked_at is null;

create index admin_sessions_user_active_idx
  on public.admin_sessions (auth_user_id, issued_at desc)
  where revoked_at is null;

alter table public.admin_sessions enable row level security;
revoke all on public.admin_sessions from public, anon, authenticated;
grant select, insert, update, delete on public.admin_sessions to service_role;

create table public.admin_pin_rate_limits (
  bucket_hash text primary key check (bucket_hash ~ '^[0-9a-f]{64}$'),
  bucket_type text not null check (
    bucket_type in ('user', 'network', 'global')
  ),
  window_started_at timestamptz not null default statement_timestamp(),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  blocked_until timestamptz,
  last_attempt_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp()
);

comment on table public.admin_pin_rate_limits is
  'Fixed-window Admin PIN admission buckets keyed only by HMAC digests; raw user/network identifiers are not stored.';

create index admin_pin_rate_limits_cleanup_idx
  on public.admin_pin_rate_limits (last_attempt_at);

alter table public.admin_pin_rate_limits enable row level security;
revoke all on public.admin_pin_rate_limits from public, anon, authenticated;
grant select, insert, update, delete on public.admin_pin_rate_limits
  to service_role;

create function public.consume_admin_pin_rate_limit(
  user_bucket_hash text,
  network_bucket_hash text,
  global_bucket_hash text
)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  bucket record;
  current_row public.admin_pin_rate_limits%rowtype;
  effective_now timestamptz := statement_timestamp();
  allowed boolean := true;
  retry_after_seconds integer := 0;
  next_count integer;
  next_blocked_until timestamptz;
begin
  if user_bucket_hash !~ '^[0-9a-f]{64}$'
     or global_bucket_hash !~ '^[0-9a-f]{64}$'
     or (
       network_bucket_hash is not null
       and network_bucket_hash !~ '^[0-9a-f]{64}$'
     ) then
    raise exception 'invalid Admin PIN rate-limit bucket'
      using errcode = '22023';
  end if;

  for bucket in
    select *
    from (
      values
        (user_bucket_hash, 'user'::text, 8, interval '10 minutes', interval '15 minutes'),
        (network_bucket_hash, 'network'::text, 30, interval '10 minutes', interval '15 minutes'),
        (global_bucket_hash, 'global'::text, 120, interval '1 minute', interval '1 minute')
    ) as configured(bucket_hash, bucket_type, maximum_attempts, window_length, block_length)
    where configured.bucket_hash is not null
    order by configured.bucket_hash
  loop
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(bucket.bucket_hash, 0)
    );

    select rate_limit.*
    into current_row
    from public.admin_pin_rate_limits as rate_limit
    where rate_limit.bucket_hash = bucket.bucket_hash
    for update;

    if found and current_row.blocked_until > effective_now then
      allowed := false;
      retry_after_seconds := greatest(
        retry_after_seconds,
        ceil(extract(epoch from current_row.blocked_until - effective_now))::integer
      );
      continue;
    end if;

    if not found
       or current_row.window_started_at + bucket.window_length <= effective_now then
      next_count := 1;
    else
      next_count := current_row.attempt_count + 1;
    end if;

    next_blocked_until := case
      when next_count > bucket.maximum_attempts
        then effective_now + bucket.block_length
      else null
    end;

    insert into public.admin_pin_rate_limits as rate_limit (
      bucket_hash,
      bucket_type,
      window_started_at,
      attempt_count,
      blocked_until,
      last_attempt_at,
      updated_at
    ) values (
      bucket.bucket_hash,
      bucket.bucket_type,
      effective_now,
      next_count,
      next_blocked_until,
      effective_now,
      effective_now
    )
    on conflict (bucket_hash) do update
    set
      bucket_type = excluded.bucket_type,
      window_started_at = case
        when rate_limit.window_started_at + bucket.window_length <= effective_now
          then effective_now
        else rate_limit.window_started_at
      end,
      attempt_count = next_count,
      blocked_until = next_blocked_until,
      last_attempt_at = effective_now,
      updated_at = effective_now;

    if next_blocked_until is not null then
      allowed := false;
      retry_after_seconds := greatest(
        retry_after_seconds,
        ceil(extract(epoch from next_blocked_until - effective_now))::integer
      );
    end if;
  end loop;

  delete from public.admin_pin_rate_limits
  where last_attempt_at < effective_now - interval '2 days';

  return jsonb_build_object(
    'allowed', allowed,
    'retry_after_seconds', retry_after_seconds
  );
end;
$$;

create function public.reset_admin_pin_rate_limit(
  user_bucket_hash text,
  network_bucket_hash text default null
)
returns void
language sql
volatile
security invoker
set search_path = ''
as $$
  update public.admin_pin_rate_limits
  set
    attempt_count = 0,
    blocked_until = null,
    window_started_at = statement_timestamp(),
    updated_at = statement_timestamp()
  where bucket_hash in (user_bucket_hash, network_bucket_hash)
    and bucket_type in ('user', 'network');
$$;

create function public.verify_and_touch_admin_session(
  target_session_id uuid,
  target_token_hash text,
  target_pin_version_hash text
)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  session_row public.admin_sessions%rowtype;
  effective_now timestamptz := statement_timestamp();
  rejection_reason text;
begin
  if target_token_hash !~ '^[0-9a-f]{64}$'
     or target_pin_version_hash !~ '^[0-9a-f]{64}$' then
    return null;
  end if;

  select session.*
  into session_row
  from public.admin_sessions as session
  where session.id = target_session_id
    and session.token_hash = target_token_hash
  for update;

  if not found then
    return null;
  end if;

  rejection_reason := case
    when session_row.revoked_at is not null then session_row.revoke_reason
    when session_row.pin_version_hash <> target_pin_version_hash then 'pin_rotated'
    when session_row.expires_at <= effective_now then 'absolute_expiry'
    when session_row.idle_expires_at <= effective_now then 'inactivity_expiry'
    else null
  end;

  if rejection_reason is not null then
    if session_row.revoked_at is null then
      update public.admin_sessions
      set
        revoked_at = effective_now,
        revoke_reason = rejection_reason,
        updated_at = effective_now
      where id = session_row.id;
    end if;
    return null;
  end if;

  if session_row.last_seen_at <= effective_now - interval '5 minutes' then
    update public.admin_sessions
    set
      last_seen_at = effective_now,
      idle_expires_at = least(expires_at, effective_now + interval '30 minutes'),
      updated_at = effective_now
    where id = session_row.id
    returning * into session_row;
  end if;

  return jsonb_build_object(
    'auth_user_id', session_row.auth_user_id,
    'expires_at', session_row.expires_at,
    'id', session_row.id,
    'idle_expires_at', session_row.idle_expires_at,
    'last_seen_at', session_row.last_seen_at
  );
end;
$$;

revoke all on function public.consume_admin_pin_rate_limit(text, text, text)
  from public, anon, authenticated, service_role;
revoke all on function public.reset_admin_pin_rate_limit(text, text)
  from public, anon, authenticated, service_role;
revoke all on function public.verify_and_touch_admin_session(uuid, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.consume_admin_pin_rate_limit(text, text, text)
  to service_role;
grant execute on function public.reset_admin_pin_rate_limit(text, text)
  to service_role;
grant execute on function public.verify_and_touch_admin_session(uuid, text, text)
  to service_role;

alter table public.lecture_sessions
  add column resume_token_version integer not null default 1
  check (resume_token_version between 1 and 2147483647);

comment on column public.lecture_sessions.resume_token_version is
  'Incrementing this value revokes all previously issued lecture resume tokens.';

create table public.lecture_resume_token_revocations (
  id bigint generated always as identity primary key,
  lecture_session_id uuid not null
    references public.lecture_sessions(id) on delete restrict,
  previous_version integer not null,
  next_version integer not null,
  actor_id text not null check (char_length(actor_id) between 1 and 200),
  created_at timestamptz not null default statement_timestamp(),
  check (next_version = previous_version + 1)
);

create index lecture_resume_token_revocations_lecture_idx
  on public.lecture_resume_token_revocations (
    lecture_session_id,
    created_at desc
  );

alter table public.lecture_resume_token_revocations enable row level security;
revoke all on public.lecture_resume_token_revocations
  from public, anon, authenticated;
grant select, insert on public.lecture_resume_token_revocations to service_role;

create function private.revoke_lecture_resume_tokens(
  target_lecture_session_id uuid,
  target_actor_id text
)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  previous_version integer;
  next_version integer;
begin
  if nullif(trim(target_actor_id), '') is null
     or char_length(target_actor_id) > 200 then
    raise exception 'invalid resume-token revocation actor'
      using errcode = '22023';
  end if;

  select resume_token_version
  into previous_version
  from public.lecture_sessions
  where id = target_lecture_session_id
  for update;

  if not found then
    raise exception 'lecture is not available' using errcode = 'P0002';
  end if;
  if previous_version >= 2147483647 then
    raise exception 'resume-token version exhausted' using errcode = '22003';
  end if;

  next_version := previous_version + 1;
  update public.lecture_sessions
  set
    resume_token_version = next_version,
    updated_at = statement_timestamp()
  where id = target_lecture_session_id;

  insert into public.lecture_resume_token_revocations (
    lecture_session_id,
    previous_version,
    next_version,
    actor_id
  ) values (
    target_lecture_session_id,
    previous_version,
    next_version,
    trim(target_actor_id)
  );

  return next_version;
end;
$$;

create function public.admin_revoke_lecture_resume_tokens(
  target_lecture_session_id uuid,
  target_actor_id text
)
returns integer
language sql
volatile
security invoker
set search_path = ''
as $$
  select private.revoke_lecture_resume_tokens(
    target_lecture_session_id,
    target_actor_id
  );
$$;

create function private.build_public_lecture_archive_v2(
  target_lecture_session_id uuid
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when base.payload is null then null
    else base.payload || jsonb_build_object(
      'lecture_public_id',
        'lecture_' || replace(lecture.pdf_public_id::text, '-', ''),
      'resume_token_version', lecture.resume_token_version
    )
  end
  from (
    select private.build_public_lecture_archive_v1(
      target_lecture_session_id
    ) as payload
  ) as base
  join public.lecture_sessions as lecture
    on lecture.id = target_lecture_session_id;
$$;

create or replace function private.claim_lecture_archive_exports(
  job_limit integer default 5
)
returns table (
  lecture_session_id uuid,
  source_version bigint,
  lecture_code text,
  archive_expires_at timestamptz,
  attempt_count integer,
  payload jsonb
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  return query
  with candidates as (
    select
      export.lecture_session_id,
      export.status = 'exporting' as reclaim_expired_lease
    from public.lecture_archive_exports as export
    join public.lecture_sessions as lecture
      on lecture.id = export.lecture_session_id
    where (
        (
          export.status in ('pending', 'error')
          and export.next_attempt_at <= statement_timestamp()
        )
        or (
          export.status = 'exporting'
          and export.lease_until <= statement_timestamp()
        )
      )
      and lecture.status = 'closed'
      and lecture.archive_expires_at > statement_timestamp()
      and exists (
        select 1
        from public.lecture_admin_codes as code
        where code.lecture_session_id = export.lecture_session_id
      )
    order by
      case
        when export.status = 'exporting' then export.lease_until
        else export.next_attempt_at
      end,
      export.lecture_session_id
    for update of export skip locked
    limit least(greatest(job_limit, 1), 20)
  ),
  claimed as (
    update public.lecture_archive_exports as export
    set
      source_version = export.source_version
        + case when candidates.reclaim_expired_lease then 1 else 0 end,
      status = 'exporting',
      lease_until = statement_timestamp() + interval '10 minutes',
      attempt_count = export.attempt_count + 1,
      last_error = case
        when candidates.reclaim_expired_lease then 'export_lease_expired'
        else export.last_error
      end,
      updated_at = statement_timestamp()
    from candidates
    where export.lecture_session_id = candidates.lecture_session_id
    returning
      export.lecture_session_id,
      export.source_version,
      export.attempt_count
  )
  select
    claimed.lecture_session_id,
    claimed.source_version,
    code.lecture_code,
    lecture.archive_expires_at,
    claimed.attempt_count,
    private.build_public_lecture_archive_v2(claimed.lecture_session_id)
  from claimed
  join public.lecture_sessions as lecture
    on lecture.id = claimed.lecture_session_id
  join public.lecture_admin_codes as code
    on code.lecture_session_id = claimed.lecture_session_id;
end;
$$;

create trigger lecture_sessions_resume_version_tracks_archive
after update of resume_token_version on public.lecture_sessions
for each row execute function private.track_lecture_archive_export();

revoke all on function private.revoke_lecture_resume_tokens(uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function private.revoke_lecture_resume_tokens(uuid, text)
  to service_role;
revoke all on function public.admin_revoke_lecture_resume_tokens(uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.admin_revoke_lecture_resume_tokens(uuid, text)
  to service_role;
revoke all on function private.build_public_lecture_archive_v2(uuid)
  from public, anon, authenticated, service_role;
grant execute on function private.build_public_lecture_archive_v2(uuid)
  to service_role;

create function private.get_lecture_resume_claim(
  target_lecture_session_id uuid,
  target_auth_user_id uuid
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'archive_expires_at', lecture.archive_expires_at,
    'lecture_public_id',
      'lecture_' || replace(lecture.pdf_public_id::text, '-', ''),
    'resume_token_version', lecture.resume_token_version
  )
  from public.lecture_sessions as lecture
  join public.participants as participant
    on participant.lecture_session_id = lecture.id
   and participant.auth_user_id = target_auth_user_id
  where lecture.id = target_lecture_session_id
    and (
      (
        lecture.status = 'open'
        and lecture.hard_stop_at > statement_timestamp()
      )
      or (
        lecture.status = 'closed'
        and lecture.archive_expires_at > statement_timestamp()
      )
    )
  limit 1;
$$;

create function public.get_lecture_resume_claim(
  target_lecture_session_id uuid,
  target_auth_user_id uuid
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select private.get_lecture_resume_claim(
    target_lecture_session_id,
    target_auth_user_id
  );
$$;

revoke all on function private.get_lecture_resume_claim(uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.get_lecture_resume_claim(uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function private.get_lecture_resume_claim(uuid, uuid)
  to service_role;
grant execute on function public.get_lecture_resume_claim(uuid, uuid)
  to service_role;

-- Realtime provider requests need a durable correlation identifier before the
-- network call starts. A timeout is recorded as uncertain rather than retried.
alter table public.ai_realtime_provider_calls
  add column client_request_id text unique check (
    client_request_id is null
    or client_request_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  ),
  add column creation_outcome_uncertain boolean not null default false,
  add column uncertainty_recorded_at timestamptz;

create index ai_realtime_provider_calls_uncertain_idx
  on public.ai_realtime_provider_calls (uncertainty_recorded_at, operation_id)
  where creation_outcome_uncertain;

create function private.record_realtime_provider_client_request(
  target_operation_id uuid,
  target_actor_id text,
  target_client_request_id text
)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  existing_request_id text;
begin
  if target_client_request_id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    raise exception 'invalid Realtime client request id'
      using errcode = '22023';
  end if;

  select provider_call.client_request_id
  into existing_request_id
  from public.ai_realtime_provider_calls as provider_call
  where provider_call.operation_id = target_operation_id
    and provider_call.actor_id = target_actor_id
  for update;

  if not found then
    raise exception 'Realtime provider call is not available'
      using errcode = '42501';
  end if;
  if existing_request_id is not null then
    return existing_request_id = target_client_request_id;
  end if;

  update public.ai_realtime_provider_calls as provider_call
  set
    client_request_id = target_client_request_id,
    updated_at = statement_timestamp()
  where provider_call.operation_id = target_operation_id
    and provider_call.actor_id = target_actor_id
    and provider_call.status = 'creating';

  return found;
end;
$$;

create function public.record_realtime_provider_client_request(
  target_operation_id uuid,
  target_actor_id text,
  target_client_request_id text
)
returns boolean
language sql
volatile
security invoker
set search_path = ''
as $$
  select private.record_realtime_provider_client_request(
    target_operation_id,
    target_actor_id,
    target_client_request_id
  );
$$;

create function private.mark_realtime_provider_creation_uncertain(
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
    raise exception 'Realtime uncertainty reason is required'
      using errcode = '22023';
  end if;

  update public.ai_realtime_provider_calls as provider_call
  set
    creation_outcome_uncertain = true,
    uncertainty_recorded_at = coalesce(
      provider_call.uncertainty_recorded_at,
      statement_timestamp()
    ),
    stop_reason = 'provider_call_creation_uncertain',
    last_error = left(trim(target_error), 500),
    updated_at = statement_timestamp()
  where provider_call.operation_id = target_operation_id
    and provider_call.actor_id = target_actor_id
    and provider_call.provider_call_id is null
    and provider_call.status in ('creating', 'creation_failed');

  return found;
end;
$$;

create function public.mark_realtime_provider_creation_uncertain(
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
  select private.mark_realtime_provider_creation_uncertain(
    target_operation_id,
    target_actor_id,
    target_error
  );
$$;

revoke all on function private.record_realtime_provider_client_request(
  uuid, text, text
) from public, anon, authenticated, service_role;
revoke all on function private.mark_realtime_provider_creation_uncertain(
  uuid, text, text
) from public, anon, authenticated, service_role;
grant execute on function private.record_realtime_provider_client_request(
  uuid, text, text
) to service_role;
grant execute on function private.mark_realtime_provider_creation_uncertain(
  uuid, text, text
) to service_role;

revoke all on function public.record_realtime_provider_client_request(
  uuid, text, text
) from public, anon, authenticated, service_role;
revoke all on function public.mark_realtime_provider_creation_uncertain(
  uuid, text, text
) from public, anon, authenticated, service_role;
grant execute on function public.record_realtime_provider_client_request(
  uuid, text, text
) to service_role;
grant execute on function public.mark_realtime_provider_creation_uncertain(
  uuid, text, text
) to service_role;
