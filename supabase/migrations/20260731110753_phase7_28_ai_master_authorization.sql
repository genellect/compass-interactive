-- Phase 7.28C: lecture-scoped master authorization for paid AI features.
--
-- This is authorization only. It never starts a provider operation, reserves a
-- budget, opens a microphone, or stores the Billing PIN. Every paid action must
-- still exchange this authorization for the existing short-lived, single-use
-- ai_billing_grants row and pass all existing lifecycle/budget/concurrency gates.

create table public.lecture_ai_master_authorizations (
  id uuid primary key default extensions.gen_random_uuid(),
  lecture_session_id uuid not null
    references public.lecture_sessions(id) on delete restrict,
  admin_session_id uuid not null
    references public.admin_sessions(id) on delete restrict,
  actor_id text not null check (char_length(actor_id) between 1 and 200),
  scope text not null
    check (scope in ('all_except_captions', 'all_including_captions')),
  actions text[] not null check (
    actions in (
      array[
        'academic_answers',
        'material_analysis',
        'poll_suggestions',
        'summaries'
      ]::text[],
      array[
        'academic_answers',
        'captions',
        'material_analysis',
        'poll_suggestions',
        'summaries'
      ]::text[]
    )
  ),
  status text not null default 'active'
    check (status in ('active', 'revoked', 'expired', 'lecture_closed')),
  issued_at timestamptz not null default statement_timestamp(),
  expires_at timestamptz not null,
  last_used_at timestamptz,
  revoked_at timestamptz,
  revoked_by_actor_id text
    check (
      revoked_by_actor_id is null
      or char_length(revoked_by_actor_id) between 1 and 200
    ),
  revoke_reason text
    check (revoke_reason is null or char_length(revoke_reason) between 1 and 120),
  version bigint not null default 1 check (version >= 1),
  updated_at timestamptz not null default statement_timestamp(),
  check (expires_at > issued_at),
  check (actor_id = 'admin-session:' || admin_session_id::text),
  check (
    (status = 'active' and revoked_at is null and revoke_reason is null)
    or (status <> 'active' and revoked_at is not null and revoke_reason is not null)
  )
);

create unique index lecture_ai_master_authorizations_one_active_idx
  on public.lecture_ai_master_authorizations (lecture_session_id)
  where status = 'active';

create index lecture_ai_master_authorizations_actor_idx
  on public.lecture_ai_master_authorizations (
    lecture_session_id,
    actor_id,
    issued_at desc
  );

create index lecture_ai_master_authorizations_admin_session_idx
  on public.lecture_ai_master_authorizations (admin_session_id, issued_at desc);

create index lecture_ai_master_authorizations_expiry_idx
  on public.lecture_ai_master_authorizations (expires_at)
  where status = 'active';

create table public.ai_master_authorization_events (
  id uuid primary key default extensions.gen_random_uuid(),
  authorization_id uuid not null
    references public.lecture_ai_master_authorizations(id) on delete restrict,
  lecture_session_id uuid not null
    references public.lecture_sessions(id) on delete restrict,
  event_type text not null check (
    event_type in (
      'authorized',
      'scope_changed',
      'child_grant_issued',
      'revoked',
      'expired',
      'lecture_closed'
    )
  ),
  actor_id text not null check (char_length(actor_id) between 1 and 200),
  scope text not null
    check (scope in ('all_except_captions', 'all_including_captions')),
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
  child_grant_id uuid
    references public.ai_billing_grants(id) on delete restrict,
  reason text check (reason is null or char_length(reason) between 1 and 120),
  created_at timestamptz not null default statement_timestamp()
);

create index ai_master_authorization_events_lecture_created_idx
  on public.ai_master_authorization_events (lecture_session_id, created_at desc);

create index ai_master_authorization_events_authorization_idx
  on public.ai_master_authorization_events (authorization_id, created_at desc);

create index ai_master_authorization_events_child_grant_idx
  on public.ai_master_authorization_events (child_grant_id)
  where child_grant_id is not null;

alter table public.lecture_ai_master_authorizations enable row level security;
alter table public.ai_master_authorization_events enable row level security;

revoke all on public.lecture_ai_master_authorizations
  from public, anon, authenticated;
revoke all on public.ai_master_authorization_events
  from public, anon, authenticated;

grant select on public.lecture_ai_master_authorizations to service_role;
grant select on public.ai_master_authorization_events to service_role;

alter table public.ai_billing_grants
  add column master_authorization_id uuid
    references public.lecture_ai_master_authorizations(id) on delete restrict;

create index ai_billing_grants_master_issued_idx
  on public.ai_billing_grants (master_authorization_id, expires_at)
  where status = 'issued' and master_authorization_id is not null;

create function private.enforce_ai_master_on_direct_grant_insert()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if new.master_authorization_id is null and exists (
    select 1
    from public.lecture_ai_master_authorizations as master_auth
    where master_auth.lecture_session_id = new.lecture_session_id
      and master_auth.status = 'active'
      and master_auth.expires_at > statement_timestamp()
  ) then
    raise exception 'lecture-wide AI authorization requires a child grant'
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger enforce_ai_master_on_direct_grant_insert
before insert on public.ai_billing_grants
for each row execute function private.enforce_ai_master_on_direct_grant_insert();

create function private.ai_master_actions_for_scope(target_scope text)
returns text[]
language sql
immutable
security invoker
set search_path = ''
as $$
  select case target_scope
    when 'all_except_captions' then array[
      'academic_answers',
      'material_analysis',
      'poll_suggestions',
      'summaries'
    ]::text[]
    when 'all_including_captions' then array[
      'academic_answers',
      'captions',
      'material_analysis',
      'poll_suggestions',
      'summaries'
    ]::text[]
    else null::text[]
  end;
$$;

create function private.ai_master_authorization_json(
  authorization_row public.lecture_ai_master_authorizations,
  requester_actor_id text
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'actions', to_jsonb(authorization_row.actions),
    'expires_at', authorization_row.expires_at,
    'id', authorization_row.id,
    'issued_at', authorization_row.issued_at,
    'last_used_at', authorization_row.last_used_at,
    'owned_by_requester', authorization_row.actor_id = requester_actor_id,
    'revoke_reason', authorization_row.revoke_reason,
    'revoked_at', authorization_row.revoked_at,
    'scope', authorization_row.scope,
    'status', authorization_row.status,
    'updated_at', authorization_row.updated_at,
    'version', authorization_row.version
  );
$$;

create function private.is_active_ai_master_admin_session(
  target_admin_session_id uuid,
  target_actor_id text
)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  session_row public.admin_sessions%rowtype;
begin
  if target_admin_session_id is null
     or target_actor_id <> ('admin-session:' || target_admin_session_id::text) then
    return false;
  end if;

  select admin_session.* into session_row
  from public.admin_sessions as admin_session
  where admin_session.id = target_admin_session_id
  for update;

  return found
    and session_row.revoked_at is null
    and session_row.expires_at > statement_timestamp()
    and session_row.idle_expires_at > statement_timestamp();
end;
$$;

create function private.revoke_pending_ai_master_grants(
  target_authorization_id uuid,
  target_reason text
)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  affected_count integer := 0;
begin
  if nullif(trim(target_reason), '') is null
     or char_length(target_reason) > 120 then
    raise exception 'invalid master grant revoke reason' using errcode = '22023';
  end if;

  -- SKIP LOCKED avoids inverting the established grant -> lecture lock order.
  -- A concurrently consumed locked grant is checked again by the consume
  -- trigger below after the master row transition commits.
  with pending_grants as (
    select billing_grant.id
    from public.ai_billing_grants as billing_grant
    where billing_grant.master_authorization_id = target_authorization_id
      and billing_grant.status = 'issued'
    order by billing_grant.id
    for update skip locked
  )
  update public.ai_billing_grants as billing_grant
  set status = 'revoked',
      revoked_at = statement_timestamp()
  from pending_grants
  where billing_grant.id = pending_grants.id;

  get diagnostics affected_count = row_count;
  return affected_count;
end;
$$;

create function private.enforce_ai_master_on_child_grant_consume()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  authorization_row public.lecture_ai_master_authorizations%rowtype;
  session_is_active boolean;
begin
  if old.status <> 'issued' or new.status <> 'consumed' then
    return new;
  end if;

  if old.master_authorization_id is null then
    if exists (
      select 1
      from public.lecture_ai_master_authorizations as master_auth
      where master_auth.lecture_session_id = old.lecture_session_id
        and (
          (
            master_auth.status = 'active'
            and master_auth.expires_at > statement_timestamp()
          )
          or (
            master_auth.status <> 'active'
            and master_auth.revoked_at is not null
            and master_auth.revoked_at >= old.issued_at
          )
        )
    ) then
      raise exception 'direct AI grant is fenced by lecture-wide authorization'
        using errcode = 'P0001';
    end if;
    return new;
  end if;

  select master_auth.* into authorization_row
  from public.lecture_ai_master_authorizations as master_auth
  where master_auth.id = old.master_authorization_id
    and master_auth.lecture_session_id = old.lecture_session_id
  for update;

  if not found then
    raise exception 'master authorization is unavailable' using errcode = 'P0001';
  end if;

  select exists (
    select 1
    from public.admin_sessions as admin_session
    where admin_session.id = authorization_row.admin_session_id
      and admin_session.revoked_at is null
      and admin_session.expires_at > statement_timestamp()
      and admin_session.idle_expires_at > statement_timestamp()
  ) into session_is_active;

  if authorization_row.status <> 'active'
     or authorization_row.expires_at <= statement_timestamp()
     or not session_is_active
     or authorization_row.actor_id <> old.actor_id
     or not old.actions <@ authorization_row.actions then
    raise exception 'master authorization is no longer active'
      using errcode = 'P0001';
  end if;

  return new;
end;
$$;

create function private.revoke_pending_ai_grants_for_lecture(
  target_lecture_session_id uuid,
  target_reason text
)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  affected_count integer := 0;
begin
  if nullif(trim(target_reason), '') is null
     or char_length(target_reason) > 120 then
    raise exception 'invalid lecture grant revoke reason' using errcode = '22023';
  end if;

  with pending_grants as (
    select billing_grant.id
    from public.ai_billing_grants as billing_grant
    where billing_grant.lecture_session_id = target_lecture_session_id
      and billing_grant.status = 'issued'
    order by billing_grant.id
    for update skip locked
  )
  update public.ai_billing_grants as billing_grant
  set status = 'revoked',
      revoked_at = statement_timestamp()
  from pending_grants
  where billing_grant.id = pending_grants.id;

  get diagnostics affected_count = row_count;
  return affected_count;
end;
$$;

create trigger enforce_ai_master_on_child_grant_consume
before update of status on public.ai_billing_grants
for each row execute function private.enforce_ai_master_on_child_grant_consume();

create function private.stop_summary_for_ai_master_transition(
  target_lecture_session_id uuid,
  target_reason text
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if nullif(trim(target_reason), '') is null
     or char_length(target_reason) > 120 then
    raise exception 'invalid master summary stop reason' using errcode = '22023';
  end if;

  perform 1
  from public.lecture_sessions as lecture
  where lecture.id = target_lecture_session_id
  for update;
  if not found then
    raise exception 'lecture not found' using errcode = 'P0002';
  end if;

  perform 1
  from public.lecture_ai_control as control
  where control.lecture_session_id = target_lecture_session_id
  for update;

  perform 1
  from public.ai_usage_ledger as usage
  where usage.lecture_session_id = target_lecture_session_id
    and usage.feature = 'summaries'
    and usage.status = 'running'
  order by usage.id
  for update;

  perform 1
  from public.lecture_summary_runs as summary_run
  where summary_run.lecture_session_id = target_lecture_session_id
    and summary_run.status = 'running'
  order by summary_run.id
  for update;

  update public.ai_usage_ledger
  set status = 'cancelled',
      result_accepted = false,
      error_code = 'master_authorization_stopped_cost_unknown',
      finished_at = statement_timestamp()
  where lecture_session_id = target_lecture_session_id
    and feature = 'summaries'
    and status = 'running';

  update public.lecture_summary_windows
  set status = 'discarded',
      current_operation_id = null,
      last_error_code = 'master_authorization_stopped',
      updated_at = statement_timestamp()
  where lecture_session_id = target_lecture_session_id
    and status = 'running';

  update public.lecture_summary_runs
  set status = 'stopped',
      stopped_at = statement_timestamp(),
      stop_reason = trim(target_reason),
      token_hash = encode(extensions.gen_random_bytes(32), 'hex'),
      updated_at = statement_timestamp()
  where lecture_session_id = target_lecture_session_id
    and status = 'running';

  update public.lecture_ai_control as control
  set summaries_enabled = false,
      version = control.version + 1,
      updated_at = statement_timestamp()
  where control.lecture_session_id = target_lecture_session_id;

  perform private.reconcile_lecture_ai_runtime_state(
    target_lecture_session_id,
    false
  );
end;
$$;

create function private.stop_captions_for_ai_master_scope_change(
  target_lecture_session_id uuid
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  perform 1
  from public.lecture_sessions as lecture
  where lecture.id = target_lecture_session_id
  for update;
  if not found then
    raise exception 'lecture not found' using errcode = 'P0002';
  end if;

  perform 1
  from public.lecture_ai_control as control
  where control.lecture_session_id = target_lecture_session_id
  for update;

  perform 1
  from public.ai_usage_ledger as usage
  where usage.lecture_session_id = target_lecture_session_id
    and usage.feature = 'captions'
    and usage.status = 'running'
  order by usage.id
  for update;

  update public.ai_usage_ledger
  set status = 'cancelled',
      result_accepted = false,
      error_code = 'master_scope_removed_captions_cost_unknown',
      finished_at = statement_timestamp()
  where lecture_session_id = target_lecture_session_id
    and feature = 'captions'
    and status = 'running';

  update public.lecture_ai_control as control
  set captions_enabled = false,
      version = control.version + 1,
      updated_at = statement_timestamp()
  where control.lecture_session_id = target_lecture_session_id;

  perform private.reconcile_lecture_ai_runtime_state(
    target_lecture_session_id,
    false
  );
end;
$$;

create function private.expire_ai_master_authorization(
  target_lecture_session_id uuid,
  target_status text,
  target_reason text,
  target_actor_id text
)
returns public.lecture_ai_master_authorizations
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  authorization_row public.lecture_ai_master_authorizations%rowtype;
begin
  if target_status not in ('expired', 'lecture_closed')
     or nullif(trim(target_reason), '') is null
     or char_length(target_reason) > 120
     or nullif(trim(target_actor_id), '') is null
     or char_length(target_actor_id) > 200 then
    raise exception 'invalid master authorization expiry' using errcode = '22023';
  end if;

  -- Preserve the established lecture -> AI runtime lock order. Callers that
  -- already hold the lecture row simply reacquire it in the same transaction.
  perform 1
  from public.lecture_sessions as lecture
  where lecture.id = target_lecture_session_id
  for update;
  if not found then
    raise exception 'lecture not found' using errcode = 'P0002';
  end if;

  update public.lecture_ai_master_authorizations as master_auth
  set
    status = target_status,
    revoked_at = statement_timestamp(),
    revoked_by_actor_id = target_actor_id,
    revoke_reason = trim(target_reason),
    version = master_auth.version + 1,
    updated_at = statement_timestamp()
  where master_auth.lecture_session_id = target_lecture_session_id
    and master_auth.status = 'active'
  returning * into authorization_row;

  if found then
    perform private.revoke_pending_ai_grants_for_lecture(
      authorization_row.lecture_session_id,
      trim(target_reason)
    );
    perform private.stop_summary_for_ai_master_transition(
      authorization_row.lecture_session_id,
      trim(target_reason)
    );
    perform private.stop_lecture_ai_control(
      authorization_row.lecture_session_id,
      trim(target_reason),
      target_actor_id
    );
    insert into public.ai_master_authorization_events (
      authorization_id,
      lecture_session_id,
      event_type,
      actor_id,
      scope,
      actions,
      reason
    ) values (
      authorization_row.id,
      authorization_row.lecture_session_id,
      target_status,
      target_actor_id,
      authorization_row.scope,
      authorization_row.actions,
      trim(target_reason)
    );
  end if;

  return authorization_row;
end;
$$;

create function private.get_ai_master_authorization_status(
  target_lecture_session_id uuid,
  target_admin_session_id uuid,
  target_actor_id text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  lecture_row public.lecture_sessions%rowtype;
  authorization_row public.lecture_ai_master_authorizations%rowtype;
  effective_now timestamptz := statement_timestamp();
begin
  if not private.is_active_ai_master_admin_session(
    target_admin_session_id,
    target_actor_id
  ) then
    raise exception 'invalid master authorization actor' using errcode = '22023';
  end if;

  perform private.close_lecture_if_expired(target_lecture_session_id);

  select lecture.* into lecture_row
  from public.lecture_sessions as lecture
  where lecture.id = target_lecture_session_id
  for update;

  if not found then
    raise exception 'lecture not found' using errcode = 'P0002';
  end if;

  select master_auth.* into authorization_row
  from public.lecture_ai_master_authorizations as master_auth
  where master_auth.lecture_session_id = target_lecture_session_id
    and master_auth.status = 'active'
  for update;

  if found and (
    lecture_row.status <> 'open'
    or lecture_row.hard_stop_at is null
    or lecture_row.hard_stop_at <= effective_now
  ) then
    authorization_row := private.expire_ai_master_authorization(
      target_lecture_session_id,
      'lecture_closed',
      'lecture_not_open',
      'system:lifecycle'
    );
  elsif found and authorization_row.expires_at <= effective_now then
    authorization_row := private.expire_ai_master_authorization(
      target_lecture_session_id,
      'expired',
      'authorization_expired',
      'system:expiry'
    );
  elsif found and not exists (
    select 1
    from public.admin_sessions as owner_session
    where owner_session.id = authorization_row.admin_session_id
      and owner_session.revoked_at is null
      and owner_session.expires_at > effective_now
      and owner_session.idle_expires_at > effective_now
  ) then
    authorization_row := private.expire_ai_master_authorization(
      target_lecture_session_id,
      'expired',
      'admin_session_inactive',
      'system:admin_session'
    );
  end if;

  return jsonb_build_object(
    'authorization', case
      when authorization_row.id is null then null::jsonb
      else private.ai_master_authorization_json(
        authorization_row,
        target_actor_id
      )
    end,
    'lecture_open', lecture_row.status = 'open'
      and lecture_row.hard_stop_at is not null
      and lecture_row.hard_stop_at > effective_now,
    'server_time', effective_now
  );
end;
$$;

create function private.authorize_ai_master(
  target_lecture_session_id uuid,
  target_admin_session_id uuid,
  target_actor_id text,
  target_scope text,
  pin_succeeded boolean
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  lecture_row public.lecture_sessions%rowtype;
  rate_row public.ai_billing_rate_limits%rowtype;
  authorization_row public.lecture_ai_master_authorizations%rowtype;
  requested_actions text[];
  effective_attempts integer;
  effective_lock timestamptz;
  effective_now timestamptz := statement_timestamp();
begin
  requested_actions := private.ai_master_actions_for_scope(target_scope);
  if requested_actions is null
     or not private.is_active_ai_master_admin_session(
       target_admin_session_id,
       target_actor_id
     ) then
    raise exception 'invalid master authorization request' using errcode = '22023';
  end if;

  perform private.close_lecture_if_expired(target_lecture_session_id);
  select lecture.* into lecture_row
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

  select rate.* into rate_row
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
  set failed_attempts = 0,
      window_started_at = null,
      last_failed_at = null,
      locked_until = null,
      updated_at = effective_now
  where rate.lecture_session_id = target_lecture_session_id;

  select master_auth.* into authorization_row
  from public.lecture_ai_master_authorizations as master_auth
  where master_auth.lecture_session_id = target_lecture_session_id
    and master_auth.status = 'active'
  for update;

  if found and authorization_row.expires_at <= effective_now then
    perform private.expire_ai_master_authorization(
      target_lecture_session_id,
      'expired',
      'authorization_expired',
      'system:expiry'
    );
    authorization_row := null;
  elsif found and not exists (
    select 1
    from public.admin_sessions as owner_session
    where owner_session.id = authorization_row.admin_session_id
      and owner_session.revoked_at is null
      and owner_session.expires_at > effective_now
      and owner_session.idle_expires_at > effective_now
  ) then
    perform private.expire_ai_master_authorization(
      target_lecture_session_id,
      'expired',
      'admin_session_inactive',
      'system:admin_session'
    );
    authorization_row := null;
  end if;

  if authorization_row.id is not null
     and authorization_row.actor_id <> target_actor_id then
    return jsonb_build_object(
      'accepted', false,
      'reason', 'authorization_held_by_other_admin'
    );
  end if;

  if authorization_row.id is null then
    insert into public.lecture_ai_master_authorizations (
      lecture_session_id,
      admin_session_id,
      actor_id,
      scope,
      actions,
      expires_at
    ) values (
      target_lecture_session_id,
      target_admin_session_id,
      target_actor_id,
      target_scope,
      requested_actions,
      lecture_row.hard_stop_at
    ) returning * into authorization_row;

    insert into public.ai_master_authorization_events (
      authorization_id,
      lecture_session_id,
      event_type,
      actor_id,
      scope,
      actions
    ) values (
      authorization_row.id,
      target_lecture_session_id,
      'authorized',
      target_actor_id,
      authorization_row.scope,
      authorization_row.actions
    );
  elsif authorization_row.scope <> target_scope then
    if authorization_row.scope = 'all_including_captions'
       and target_scope = 'all_except_captions' then
      perform private.stop_captions_for_ai_master_scope_change(
        target_lecture_session_id
      );
    end if;

    update public.lecture_ai_master_authorizations as master_auth
    set
      scope = target_scope,
      actions = requested_actions,
      last_used_at = null,
      expires_at = lecture_row.hard_stop_at,
      version = master_auth.version + 1,
      updated_at = effective_now
    where master_auth.id = authorization_row.id
    returning * into authorization_row;

    perform private.revoke_pending_ai_master_grants(
      authorization_row.id,
      'admin_scope_change'
    );

    insert into public.ai_master_authorization_events (
      authorization_id,
      lecture_session_id,
      event_type,
      actor_id,
      scope,
      actions,
      reason
    ) values (
      authorization_row.id,
      target_lecture_session_id,
      'scope_changed',
      target_actor_id,
      authorization_row.scope,
      authorization_row.actions,
      'admin_scope_change'
    );
  end if;

  return jsonb_build_object(
    'accepted', true,
    'authorization', private.ai_master_authorization_json(
      authorization_row,
      target_actor_id
    ),
    'server_time', effective_now
  );
end;
$$;

create function private.issue_ai_billing_grant_from_master(
  target_lecture_session_id uuid,
  target_admin_session_id uuid,
  target_actions text[],
  target_nonce_hash text,
  target_actor_id text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  canonical_actions text[];
  lecture_row public.lecture_sessions%rowtype;
  authorization_row public.lecture_ai_master_authorizations%rowtype;
  grant_row public.ai_billing_grants%rowtype;
  effective_now timestamptz := statement_timestamp();
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
     ]::text[]
     or target_nonce_hash !~ '^[0-9a-f]{64}$'
     or not private.is_active_ai_master_admin_session(
       target_admin_session_id,
       target_actor_id
     ) then
    raise exception 'invalid master child grant request' using errcode = '22023';
  end if;

  perform private.close_lecture_if_expired(target_lecture_session_id);
  select lecture.* into lecture_row
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

  select master_auth.* into authorization_row
  from public.lecture_ai_master_authorizations as master_auth
  where master_auth.lecture_session_id = target_lecture_session_id
    and master_auth.status = 'active'
  for update;

  if not found then
    return jsonb_build_object('accepted', false, 'reason', 'master_not_active');
  end if;
  if authorization_row.expires_at <= effective_now then
    perform private.expire_ai_master_authorization(
      target_lecture_session_id,
      'expired',
      'authorization_expired',
      'system:expiry'
    );
    return jsonb_build_object('accepted', false, 'reason', 'master_expired');
  end if;
  if authorization_row.actor_id <> target_actor_id then
    return jsonb_build_object('accepted', false, 'reason', 'master_actor_mismatch');
  end if;
  if authorization_row.admin_session_id <> target_admin_session_id then
    return jsonb_build_object('accepted', false, 'reason', 'master_actor_mismatch');
  end if;
  if not canonical_actions <@ authorization_row.actions then
    return jsonb_build_object('accepted', false, 'reason', 'master_scope_mismatch');
  end if;

  insert into public.ai_billing_grants (
    lecture_session_id,
    master_authorization_id,
    actor_id,
    actions,
    nonce_hash,
    expires_at
  ) values (
    target_lecture_session_id,
    authorization_row.id,
    target_actor_id,
    canonical_actions,
    target_nonce_hash,
    least(
      effective_now + interval '2 minutes',
      lecture_row.hard_stop_at,
      authorization_row.expires_at
    )
  ) returning * into grant_row;

  update public.lecture_ai_master_authorizations as master_auth
  set last_used_at = effective_now,
      version = master_auth.version + 1,
      updated_at = effective_now
  where master_auth.id = authorization_row.id
  returning * into authorization_row;

  insert into public.ai_master_authorization_events (
    authorization_id,
    lecture_session_id,
    event_type,
    actor_id,
    scope,
    actions,
    child_grant_id
  ) values (
    authorization_row.id,
    target_lecture_session_id,
    'child_grant_issued',
    target_actor_id,
    authorization_row.scope,
    canonical_actions,
    grant_row.id
  );

  return jsonb_build_object(
    'accepted', true,
    'actions', to_jsonb(grant_row.actions),
    'expires_at', grant_row.expires_at,
    'grant_id', grant_row.id
  );
end;
$$;

create function private.revoke_ai_master_authorization(
  target_lecture_session_id uuid,
  target_admin_session_id uuid,
  target_actor_id text,
  target_reason text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  authorization_row public.lecture_ai_master_authorizations%rowtype;
begin
  if not private.is_active_ai_master_admin_session(
       target_admin_session_id,
       target_actor_id
     )
     or nullif(trim(target_reason), '') is null
     or char_length(target_reason) > 120 then
    raise exception 'invalid master authorization revoke' using errcode = '22023';
  end if;

  perform 1 from public.lecture_sessions as lecture
  where lecture.id = target_lecture_session_id
  for update;
  if not found then
    raise exception 'lecture not found' using errcode = 'P0002';
  end if;

  select master_auth.* into authorization_row
  from public.lecture_ai_master_authorizations as master_auth
  where master_auth.lecture_session_id = target_lecture_session_id
    and master_auth.status = 'active'
  for update;

  if not found then
    return jsonb_build_object('accepted', true, 'already_inactive', true);
  end if;
  if authorization_row.actor_id <> target_actor_id
     or authorization_row.admin_session_id <> target_admin_session_id then
    return jsonb_build_object('accepted', false, 'reason', 'actor_mismatch');
  end if;

  update public.lecture_ai_master_authorizations as master_auth
  set status = 'revoked',
      revoked_at = statement_timestamp(),
      revoked_by_actor_id = target_actor_id,
      revoke_reason = trim(target_reason),
      version = master_auth.version + 1,
      updated_at = statement_timestamp()
  where master_auth.id = authorization_row.id
  returning * into authorization_row;

  perform private.revoke_pending_ai_grants_for_lecture(
    authorization_row.lecture_session_id,
    trim(target_reason)
  );

  perform private.stop_summary_for_ai_master_transition(
    authorization_row.lecture_session_id,
    trim(target_reason)
  );
  perform private.stop_lecture_ai_control(
    authorization_row.lecture_session_id,
    trim(target_reason),
    target_actor_id
  );

  insert into public.ai_master_authorization_events (
    authorization_id,
    lecture_session_id,
    event_type,
    actor_id,
    scope,
    actions,
    reason
  ) values (
    authorization_row.id,
    target_lecture_session_id,
    'revoked',
    target_actor_id,
    authorization_row.scope,
    authorization_row.actions,
    trim(target_reason)
  );

  return jsonb_build_object(
    'accepted', true,
    'authorization', private.ai_master_authorization_json(
      authorization_row,
      target_actor_id
    )
  );
end;
$$;

create function private.drain_ai_master_authorizations(
  target_reason text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  candidate record;
  drained_row public.lecture_ai_master_authorizations%rowtype;
  drained_count integer := 0;
  remaining_count integer := 0;
begin
  if nullif(trim(target_reason), '') is null
     or char_length(target_reason) > 120 then
    raise exception 'invalid master authorization drain reason'
      using errcode = '22023';
  end if;

  -- Do not lock master rows before lecture rows. expire_ai_master_authorization
  -- preserves the established lecture -> AI runtime lock order and is itself
  -- idempotent when another drain or lifecycle transition wins the race.
  for candidate in
    select master_auth.lecture_session_id
    from public.lecture_ai_master_authorizations as master_auth
    where master_auth.status = 'active'
    order by master_auth.lecture_session_id
  loop
    drained_row := private.expire_ai_master_authorization(
      candidate.lecture_session_id,
      'expired',
      trim(target_reason),
      'system:rollback'
    );
    if drained_row.id is not null then
      drained_count := drained_count + 1;
    end if;
  end loop;

  select count(*)::integer into remaining_count
  from public.lecture_ai_master_authorizations as master_auth
  where master_auth.status = 'active';

  return jsonb_build_object(
    'drained_count', drained_count,
    'remaining_active_count', remaining_count
  );
end;
$$;

create function private.revoke_ai_master_on_lecture_close()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.status = 'open' and new.status <> 'open' then
    perform private.expire_ai_master_authorization(
      new.id,
      'lecture_closed',
      coalesce(new.close_reason, 'lecture_closed'),
      coalesce(
        new.close_actor_id,
        new.close_actor_type,
        'system:lifecycle'
      )
    );
  end if;
  return new;
end;
$$;

create trigger revoke_ai_master_on_lecture_close
after update of status on public.lecture_sessions
for each row execute function private.revoke_ai_master_on_lecture_close();

create function private.revoke_ai_master_on_admin_session_revoke()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  active_authorization record;
begin
  if old.revoked_at is not null or new.revoked_at is null then
    return new;
  end if;

  for active_authorization in
    select master_auth.lecture_session_id
    from public.lecture_ai_master_authorizations as master_auth
    where master_auth.admin_session_id = new.id
      and master_auth.status = 'active'
    order by master_auth.lecture_session_id
  loop
    perform private.expire_ai_master_authorization(
      active_authorization.lecture_session_id,
      'expired',
      'admin_session_revoked',
      'system:admin_session'
    );
  end loop;

  return new;
end;
$$;

create trigger admin_sessions_revoke_ai_master
after update of revoked_at on public.admin_sessions
for each row execute function private.revoke_ai_master_on_admin_session_revoke();

create function public.admin_authorize_ai_master(
  target_lecture_session_id uuid,
  target_admin_session_id uuid,
  target_actor_id text,
  target_scope text,
  pin_succeeded boolean
)
returns jsonb
language sql
volatile
security invoker
set search_path = ''
as $$
  select private.authorize_ai_master(
    target_lecture_session_id,
    target_admin_session_id,
    target_actor_id,
    target_scope,
    pin_succeeded
  );
$$;

create function public.admin_get_ai_master_authorization_status(
  target_lecture_session_id uuid,
  target_admin_session_id uuid,
  target_actor_id text
)
returns jsonb
language sql
volatile
security invoker
set search_path = ''
as $$
  select private.get_ai_master_authorization_status(
    target_lecture_session_id,
    target_admin_session_id,
    target_actor_id
  );
$$;

create function public.admin_issue_ai_billing_grant_from_master(
  target_lecture_session_id uuid,
  target_admin_session_id uuid,
  target_actions text[],
  target_nonce_hash text,
  target_actor_id text
)
returns jsonb
language sql
volatile
security invoker
set search_path = ''
as $$
  select private.issue_ai_billing_grant_from_master(
    target_lecture_session_id,
    target_admin_session_id,
    target_actions,
    target_nonce_hash,
    target_actor_id
  );
$$;

create function public.admin_revoke_ai_master_authorization(
  target_lecture_session_id uuid,
  target_admin_session_id uuid,
  target_actor_id text,
  target_reason text
)
returns jsonb
language sql
volatile
security invoker
set search_path = ''
as $$
  select private.revoke_ai_master_authorization(
    target_lecture_session_id,
    target_admin_session_id,
    target_actor_id,
    target_reason
  );
$$;

create function public.service_drain_ai_master_authorizations(
  target_reason text default 'phase7_28_rollback'
)
returns jsonb
language sql
volatile
security invoker
set search_path = ''
as $$
  select private.drain_ai_master_authorizations(target_reason);
$$;

revoke all on function private.ai_master_actions_for_scope(text) from public;
revoke all on function private.ai_master_authorization_json(
  public.lecture_ai_master_authorizations,
  text
) from public;
revoke all on function private.is_active_ai_master_admin_session(uuid, text)
  from public;
revoke all on function private.revoke_pending_ai_master_grants(uuid, text)
  from public;
revoke all on function private.enforce_ai_master_on_child_grant_consume()
  from public;
revoke all on function private.enforce_ai_master_on_direct_grant_insert()
  from public;
revoke all on function private.revoke_pending_ai_grants_for_lecture(uuid, text)
  from public;
revoke all on function private.stop_summary_for_ai_master_transition(uuid, text)
  from public;
revoke all on function private.stop_captions_for_ai_master_scope_change(uuid)
  from public;
revoke all on function private.expire_ai_master_authorization(
  uuid,
  text,
  text,
  text
) from public;
revoke all on function private.get_ai_master_authorization_status(uuid, uuid, text)
  from public;
revoke all on function private.authorize_ai_master(uuid, uuid, text, text, boolean)
  from public;
revoke all on function private.issue_ai_billing_grant_from_master(
  uuid,
  uuid,
  text[],
  text,
  text
) from public;
revoke all on function private.revoke_ai_master_authorization(
  uuid,
  uuid,
  text,
  text
) from public;
revoke all on function private.drain_ai_master_authorizations(text)
  from public;
revoke all on function private.revoke_ai_master_on_lecture_close() from public;
revoke all on function private.revoke_ai_master_on_admin_session_revoke()
  from public;

revoke all on function public.admin_authorize_ai_master(
  uuid,
  uuid,
  text,
  text,
  boolean
) from public, anon, authenticated;
revoke all on function public.admin_get_ai_master_authorization_status(uuid, uuid, text)
  from public, anon, authenticated;
revoke all on function public.admin_issue_ai_billing_grant_from_master(
  uuid,
  uuid,
  text[],
  text,
  text
) from public, anon, authenticated;
revoke all on function public.admin_revoke_ai_master_authorization(
  uuid,
  uuid,
  text,
  text
) from public, anon, authenticated;
revoke all on function public.service_drain_ai_master_authorizations(text)
  from public, anon, authenticated;

grant execute on function private.ai_master_actions_for_scope(text)
  to service_role;
grant execute on function private.ai_master_authorization_json(
  public.lecture_ai_master_authorizations,
  text
) to service_role;
grant execute on function private.is_active_ai_master_admin_session(uuid, text)
  to service_role;
grant execute on function private.revoke_pending_ai_master_grants(uuid, text)
  to service_role;
grant execute on function private.revoke_pending_ai_grants_for_lecture(uuid, text)
  to service_role;
grant execute on function private.stop_summary_for_ai_master_transition(uuid, text)
  to service_role;
grant execute on function private.stop_captions_for_ai_master_scope_change(uuid)
  to service_role;
grant execute on function private.expire_ai_master_authorization(
  uuid,
  text,
  text,
  text
) to service_role;
grant execute on function private.get_ai_master_authorization_status(uuid, uuid, text)
  to service_role;
grant execute on function private.authorize_ai_master(uuid, uuid, text, text, boolean)
  to service_role;
grant execute on function private.issue_ai_billing_grant_from_master(
  uuid,
  uuid,
  text[],
  text,
  text
) to service_role;
grant execute on function private.revoke_ai_master_authorization(
  uuid,
  uuid,
  text,
  text
) to service_role;
grant execute on function private.drain_ai_master_authorizations(text)
  to service_role;

grant execute on function public.admin_authorize_ai_master(
  uuid,
  uuid,
  text,
  text,
  boolean
) to service_role;
grant execute on function public.admin_get_ai_master_authorization_status(uuid, uuid, text)
  to service_role;
grant execute on function public.admin_issue_ai_billing_grant_from_master(
  uuid,
  uuid,
  text[],
  text,
  text
) to service_role;
grant execute on function public.admin_revoke_ai_master_authorization(
  uuid,
  uuid,
  text,
  text
) to service_role;
grant execute on function public.service_drain_ai_master_authorizations(text)
  to service_role;

comment on table public.lecture_ai_master_authorizations is
  'Lecture-scoped, actor-bound authorization. Never stores PINs or starts/reserves provider work.';
comment on table public.ai_master_authorization_events is
  'Content-free audit trail for master authorization lifecycle and child grant issuance.';
