-- Phase 6.6: integrated UX support without weakening Phase 0-6.5.
--
-- This migration is expand-first:
-- - every existing public RPC remains available;
-- - the new snapshot contract is opt-in from the frontend;
-- - existing lecture codes remain valid;
-- - all new operational tables are private to service_role;
-- - no application table is added to Supabase Realtime.

alter table public.lecture_sessions
  add column duplicated_from_lecture_session_id uuid
    references public.lecture_sessions(id) on delete set null;

create index lecture_sessions_duplicated_from_idx
  on public.lecture_sessions (duplicated_from_lecture_session_id)
  where duplicated_from_lecture_session_id is not null;

alter table public.lecture_live_state
  add column metrics_version bigint not null default 0
    check (metrics_version >= 0),
  add column participant_count bigint not null default 0
    check (participant_count >= 0),
  add column visible_comment_count bigint not null default 0
    check (visible_comment_count >= 0),
  add column metrics_updated_at timestamptz not null default statement_timestamp();

update public.lecture_live_state as live
set
  participant_count = counts.participant_count,
  visible_comment_count = counts.visible_comment_count,
  metrics_updated_at = statement_timestamp()
from (
  select
    lecture.id as lecture_session_id,
    (
      select count(*)::bigint
      from public.participants as participant
      where participant.lecture_session_id = lecture.id
    ) as participant_count,
    (
      select count(*)::bigint
      from public.comments as comment
      where comment.lecture_session_id = lecture.id
        and comment.status = 'visible'
    ) as visible_comment_count
  from public.lecture_sessions as lecture
) as counts
where counts.lecture_session_id = live.lecture_session_id;

create table public.lecture_participant_presence (
  lecture_session_id uuid not null
    references public.lecture_sessions(id) on delete cascade,
  participant_id uuid not null,
  last_seen_at timestamptz not null default statement_timestamp(),
  primary key (lecture_session_id, participant_id),
  foreign key (participant_id, lecture_session_id)
    references public.participants(id, lecture_session_id)
    on delete cascade
);

create index lecture_participant_presence_active_idx
  on public.lecture_participant_presence (
    lecture_session_id,
    last_seen_at desc
  );

create index lecture_participant_presence_participant_idx
  on public.lecture_participant_presence (
    participant_id,
    lecture_session_id
  );

create table public.lecture_presence_metrics (
  lecture_session_id uuid primary key
    references public.lecture_sessions(id) on delete cascade,
  bucket_started_at timestamptz not null,
  participant_count bigint not null default 0
    check (participant_count >= 0),
  updated_at timestamptz not null default statement_timestamp()
);

alter table public.lecture_participant_presence enable row level security;
alter table public.lecture_presence_metrics enable row level security;
revoke all on public.lecture_participant_presence
  from public, anon, authenticated;
revoke all on public.lecture_presence_metrics
  from public, anon, authenticated;
grant select on public.lecture_participant_presence to service_role;
grant select on public.lecture_presence_metrics to service_role;

insert into public.lecture_participant_presence (
  lecture_session_id,
  participant_id,
  last_seen_at
)
select
  participant.lecture_session_id,
  participant.id,
  coalesce(participant.last_seen_at, participant.joined_at)
from public.participants as participant
join public.lecture_sessions as lecture
  on lecture.id = participant.lecture_session_id
where participant.auth_user_id is not null
  and lecture.status = 'open'
  and lecture.hard_stop_at > statement_timestamp()
  and coalesce(participant.last_seen_at, participant.joined_at)
    >= statement_timestamp() - interval '90 seconds'
on conflict (lecture_session_id, participant_id) do nothing;

create function private.invalidate_presence_metrics()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_lecture_session_id uuid;
begin
  if tg_op = 'DELETE' then
    target_lecture_session_id := old.lecture_session_id;
  elsif old.last_seen_at < statement_timestamp() - interval '90 seconds'
        and new.last_seen_at >= statement_timestamp() - interval '90 seconds' then
    target_lecture_session_id := new.lecture_session_id;
  else
    return new;
  end if;

  update public.lecture_presence_metrics as metrics
  set bucket_started_at = 'epoch'::timestamptz
  where metrics.lecture_session_id = target_lecture_session_id;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create trigger lecture_participant_presence_invalidate_metrics
after update or delete on public.lecture_participant_presence
for each row execute function private.invalidate_presence_metrics();

create function private.phase66_active_participant_count(
  target_lecture_session_id uuid,
  effective_now timestamptz
)
returns table (
  active_count bigint,
  counted_at timestamptz
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  effective_bucket timestamptz := date_bin(
    interval '15 seconds',
    effective_now,
    '2000-01-01 00:00:00+00'::timestamptz
  );
  cached_bucket timestamptz;
begin
  select
    metrics.participant_count,
    metrics.updated_at,
    metrics.bucket_started_at
  into active_count, counted_at, cached_bucket
  from public.lecture_presence_metrics as metrics
  where metrics.lecture_session_id = target_lecture_session_id;

  if found and cached_bucket >= effective_bucket then
    return next;
    return;
  end if;

  if not found then
    insert into public.lecture_presence_metrics (
      lecture_session_id,
      bucket_started_at,
      participant_count,
      updated_at
    )
    values (
      target_lecture_session_id,
      'epoch'::timestamptz,
      0,
      'epoch'::timestamptz
    )
    on conflict (lecture_session_id) do nothing;
  end if;

  update public.lecture_presence_metrics as metrics
  set
    bucket_started_at = effective_bucket,
    participant_count = (
      select count(*)::bigint
      from public.lecture_participant_presence as presence
      where presence.lecture_session_id = target_lecture_session_id
        and presence.last_seen_at >= effective_now - interval '90 seconds'
    ),
    updated_at = effective_now
  where metrics.lecture_session_id = target_lecture_session_id
    and metrics.bucket_started_at < effective_bucket
  returning metrics.participant_count, metrics.updated_at
  into active_count, counted_at;

  if found then
    return next;
    return;
  end if;

  select metrics.participant_count, metrics.updated_at
  into active_count, counted_at
  from public.lecture_presence_metrics as metrics
  where metrics.lecture_session_id = target_lecture_session_id;

  return next;
end;
$$;

create function private.track_participant_metrics()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_lecture_session_id uuid := case
    when tg_op = 'DELETE' then old.lecture_session_id
    else new.lecture_session_id
  end;
  count_delta integer := case when tg_op = 'DELETE' then -1 else 1 end;
begin
  insert into public.lecture_live_state as live (
    lecture_session_id,
    metrics_version,
    participant_count,
    metrics_updated_at,
    updated_at
  )
  values (
    target_lecture_session_id,
    1,
    greatest(count_delta, 0),
    statement_timestamp(),
    statement_timestamp()
  )
  on conflict (lecture_session_id) do update
  set
    metrics_version = live.metrics_version + 1,
    participant_count = greatest(0, live.participant_count + count_delta),
    metrics_updated_at = statement_timestamp(),
    updated_at = statement_timestamp();

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create trigger participants_track_metrics
after insert or delete on public.participants
for each row execute function private.track_participant_metrics();

-- Preserve the existing comment version behavior while maintaining the cached
-- visible count in the same row update.
create or replace function private.track_comment_live_state()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_lecture_session_id uuid := case
    when tg_op = 'DELETE' then old.lecture_session_id
    else new.lecture_session_id
  end;
  visible_delta integer := case
    when tg_op = 'INSERT' and new.status = 'visible' then 1
    when tg_op = 'DELETE' and old.status = 'visible' then -1
    when tg_op = 'UPDATE' and old.status <> 'visible' and new.status = 'visible' then 1
    when tg_op = 'UPDATE' and old.status = 'visible' and new.status <> 'visible' then -1
    else 0
  end;
begin
  insert into public.lecture_live_state as live (
    lecture_session_id,
    state_version,
    comments_version,
    metrics_version,
    visible_comment_count,
    metrics_updated_at,
    updated_at
  )
  values (
    target_lecture_session_id,
    1,
    1,
    case when visible_delta <> 0 then 1 else 0 end,
    greatest(visible_delta, 0),
    statement_timestamp(),
    statement_timestamp()
  )
  on conflict (lecture_session_id) do update
  set
    state_version = live.state_version + 1,
    comments_version = live.comments_version + 1,
    metrics_version = live.metrics_version
      + case when visible_delta <> 0 then 1 else 0 end,
    visible_comment_count = greatest(
      0,
      live.visible_comment_count + visible_delta
    ),
    metrics_updated_at = case
      when visible_delta <> 0 then statement_timestamp()
      else live.metrics_updated_at
    end,
    updated_at = statement_timestamp();

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create table public.lecture_join_rate_limits (
  auth_user_id uuid primary key,
  failed_attempts integer not null default 0
    check (failed_attempts between 0 and 8),
  window_started_at timestamptz,
  last_failed_at timestamptz,
  locked_until timestamptz,
  updated_at timestamptz not null default statement_timestamp()
);

create index lecture_join_rate_limits_locked_idx
  on public.lecture_join_rate_limits (locked_until, auth_user_id)
  where locked_until is not null;

create index lecture_join_rate_limits_updated_idx
  on public.lecture_join_rate_limits (updated_at, auth_user_id);

alter table public.lecture_join_rate_limits enable row level security;
revoke all on public.lecture_join_rate_limits
  from public, anon, authenticated;
grant select, insert, update, delete on public.lecture_join_rate_limits
  to service_role;

create function private.join_lecture_by_code_v2(
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
  rate_row public.lecture_join_rate_limits%rowtype;
  effective_now timestamptz := statement_timestamp();
  next_attempts integer;
begin
  if request_user_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  insert into public.lecture_join_rate_limits (auth_user_id)
  values (request_user_id)
  on conflict (auth_user_id) do nothing;

  select rate.*
  into rate_row
  from public.lecture_join_rate_limits as rate
  where rate.auth_user_id = request_user_id
  for update;

  if rate_row.locked_until is not null
     and rate_row.locked_until > effective_now then
    return;
  end if;

  normalized_code := upper(trim(coalesce(lecture_code, '')));
  hashed_code := encode(
    extensions.digest(convert_to(normalized_code, 'UTF8'), 'sha256'),
    'hex'
  );

  if normalized_code <> '' then
    select lecture.*
    into matched_lecture
    from public.lecture_sessions as lecture
    where lecture.code_hash = hashed_code
      and lecture.status = 'open'
      and lecture.hard_stop_at > effective_now
      and private.is_lecture_open(lecture.id)
    limit 1
    for update of lecture;
  end if;

  if not found or normalized_code = '' then
    next_attempts := case
      when rate_row.window_started_at is null
        or rate_row.window_started_at < effective_now - interval '10 minutes'
        then 1
      else least(rate_row.failed_attempts + 1, 8)
    end;

    update public.lecture_join_rate_limits as rate
    set
      failed_attempts = next_attempts,
      window_started_at = case
        when rate.window_started_at is null
          or rate.window_started_at < effective_now - interval '10 minutes'
          then effective_now
        else rate.window_started_at
      end,
      last_failed_at = effective_now,
      locked_until = case
        when next_attempts >= 8 then effective_now + interval '15 minutes'
        else null
      end,
      updated_at = effective_now
    where rate.auth_user_id = request_user_id;
    return;
  end if;

  update public.lecture_join_rate_limits as rate
  set
    failed_attempts = 0,
    window_started_at = null,
    last_failed_at = null,
    locked_until = null,
    updated_at = effective_now
  where rate.auth_user_id = request_user_id;

  insert into public.participants (
    lecture_session_id,
    auth_user_id,
    participant_key,
    last_seen_at
  )
  values (
    matched_lecture.id,
    request_user_id,
    encode(extensions.gen_random_bytes(32), 'hex'),
    effective_now
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

create function public.join_lecture_by_code_v2(lecture_code text)
returns table (
  lecture_session_id uuid,
  participant_id uuid,
  title text,
  starts_at timestamptz,
  ends_at timestamptz,
  status text
)
language sql
volatile
security invoker
set search_path = ''
as $$
  select
    joined.joined_lecture_session_id,
    joined.participant_id,
    joined.title,
    joined.starts_at,
    joined.ends_at,
    joined.status
  from private.join_lecture_by_code_v2(lecture_code) as joined;
$$;

-- Keep the original public signature for old clients, but route it through the
-- same generic-response rate limiter so the compatibility RPC cannot bypass
-- the six-digit-code brute-force protection.
create or replace function private.join_lecture_by_code(lecture_code text)
returns table (
  joined_lecture_session_id uuid,
  participant_id uuid,
  title text,
  starts_at timestamptz,
  ends_at timestamptz,
  status text
)
language sql
volatile
security definer
set search_path = ''
as $$
  select
    joined.joined_lecture_session_id,
    joined.participant_id,
    joined.title,
    joined.starts_at,
    joined.ends_at,
    joined.status
  from private.join_lecture_by_code_v2(lecture_code) as joined;
$$;

create function public.admin_create_lecture_v2(
  lecture_title text,
  lecture_code_hash text,
  lecture_code text,
  lecture_starts_at timestamptz default null,
  lecture_ends_at timestamptz default null
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  normalized_code text := trim(coalesce(lecture_code, ''));
  expected_hash text;
  created_lecture_id uuid;
begin
  if nullif(trim(lecture_title), '') is null then
    raise exception 'lecture title is required' using errcode = '22023';
  end if;
  if normalized_code !~ '^[0-9]{6}$' then
    raise exception 'lecture code must contain six digits'
      using errcode = '22023';
  end if;
  expected_hash := encode(
    extensions.digest(convert_to(normalized_code, 'UTF8'), 'sha256'),
    'hex'
  );
  if lecture_code_hash <> expected_hash then
    raise exception 'lecture code hash does not match'
      using errcode = '22023';
  end if;

  created_lecture_id := public.admin_create_lecture(
    trim(lecture_title),
    expected_hash,
    normalized_code,
    lecture_starts_at,
    lecture_ends_at
  );
  return created_lecture_id;
end;
$$;

create function public.admin_duplicate_lecture_v1(
  source_lecture_session_id uuid,
  lecture_code_hash text,
  lecture_code text
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  source_lecture public.lecture_sessions%rowtype;
  normalized_code text := trim(coalesce(lecture_code, ''));
  expected_hash text;
  created_lecture_id uuid;
begin
  select lecture.*
  into source_lecture
  from public.lecture_sessions as lecture
  where lecture.id = source_lecture_session_id
    and lecture.status = 'closed'
  for update;

  if not found then
    raise exception 'source lecture is not closed' using errcode = 'P0001';
  end if;
  if normalized_code !~ '^[0-9]{6}$' then
    raise exception 'lecture code must contain six digits'
      using errcode = '22023';
  end if;
  expected_hash := encode(
    extensions.digest(convert_to(normalized_code, 'UTF8'), 'sha256'),
    'hex'
  );
  if lecture_code_hash <> expected_hash then
    raise exception 'lecture code hash does not match'
      using errcode = '22023';
  end if;

  insert into public.lecture_sessions (
    title,
    code_hash,
    status,
    duplicated_from_lecture_session_id
  )
  values (
    source_lecture.title,
    expected_hash,
    'draft',
    source_lecture.id
  )
  returning id into created_lecture_id;

  insert into public.lecture_admin_codes (
    lecture_session_id,
    lecture_code
  )
  values (created_lecture_id, normalized_code);

  insert into public.lecture_live_state (lecture_session_id)
  values (created_lecture_id)
  on conflict (lecture_session_id) do nothing;

  insert into public.lecture_display_state (
    lecture_session_id,
    current_pdf_page,
    display_mode
  )
  values (created_lecture_id, 1, 'normal')
  on conflict (lecture_session_id) do nothing;

  return created_lecture_id;
end;
$$;

-- Reconcile legacy multiple-open state before enforcing the invariant.
with ranked_open_polls as (
  select
    poll.id,
    row_number() over (
      partition by poll.lecture_session_id
      order by poll.updated_at desc, poll.created_at desc, poll.id desc
    ) as open_rank
  from public.polls as poll
  where poll.status = 'open'
)
update public.polls as poll
set
  status = 'closed',
  updated_at = statement_timestamp()
from ranked_open_polls as ranked
where ranked.id = poll.id
  and ranked.open_rank > 1;

create unique index polls_one_open_per_lecture_uidx
  on public.polls (lecture_session_id)
  where status = 'open';

create index polls_lecture_created_cursor_idx
  on public.polls (lecture_session_id, created_at desc, id desc);

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
  target_poll_status text;
begin
  perform 1
  from public.lecture_sessions as lecture
  where lecture.id = target_lecture_session_id
  for update;

  if not found then
    return false;
  end if;

  if target_status = 'open' then
    if not private.is_lecture_open(target_lecture_session_id) then
      return false;
    end if;

    select poll.status
    into target_poll_status
    from public.polls as poll
    where poll.id = target_poll_id
      and poll.lecture_session_id = target_lecture_session_id
    for update;

    if not found or target_poll_status not in ('draft', 'closed', 'open') then
      return false;
    end if;

    -- Preserve the pre-Phase-6.6 retry contract: reopening the already-open
    -- target is a no-op that returns false.
    if target_poll_status = 'open' then
      return false;
    end if;

    -- The lecture row lock serializes every Admin transition for this lecture.
    -- Close first, then open the target, so the non-deferrable partial unique
    -- index is never transiently violated by a multi-row CASE update.
    update public.polls as poll
    set status = 'closed', updated_at = statement_timestamp()
    where poll.lecture_session_id = target_lecture_session_id
      and poll.status = 'open';

    update public.polls as poll
    set status = 'open', updated_at = statement_timestamp()
    where poll.id = target_poll_id
      and poll.lecture_session_id = target_lecture_session_id
      and poll.status in ('draft', 'closed');
    return found;
  end if;

  if target_status = 'closed' then
    update public.polls as poll
    set status = 'closed', updated_at = statement_timestamp()
    where poll.id = target_poll_id
      and poll.lecture_session_id = target_lecture_session_id
      and poll.status = 'open';
    return found;
  end if;

  raise exception 'invalid poll status: %', target_status;
end;
$$;

create function private.phase66_material_summary_body_is_valid(
  target_body jsonb
)
returns boolean
language plpgsql
immutable
security invoker
set search_path = ''
as $$
declare
  point jsonb;
begin
  if target_body is null
     or jsonb_typeof(target_body) is distinct from 'object' then
    return false;
  end if;

  if exists (
       select 1
       from jsonb_object_keys(target_body) as key_name
       where key_name not in ('lead', 'points', 'reflectionQuestion')
     )
     or jsonb_typeof(target_body -> 'lead') is distinct from 'string'
     or char_length(trim(target_body ->> 'lead')) not between 1 and 1200
     or jsonb_typeof(target_body -> 'points') is distinct from 'array'
     or (
       target_body ? 'reflectionQuestion'
       and (
         jsonb_typeof(target_body -> 'reflectionQuestion')
           is distinct from 'string'
         or char_length(trim(target_body ->> 'reflectionQuestion')) > 300
       )
     ) then
    return false;
  end if;

  if jsonb_array_length(target_body -> 'points') not between 1 and 3 then
    return false;
  end if;

  for point in
    select value
    from jsonb_array_elements(target_body -> 'points')
  loop
    if jsonb_typeof(point) is distinct from 'object' then
      return false;
    end if;

    if exists (
         select 1
         from jsonb_object_keys(point) as key_name
         where key_name not in ('pageLabel', 'title', 'detail')
       )
       or jsonb_typeof(point -> 'pageLabel') is distinct from 'string'
       or char_length(trim(point ->> 'pageLabel')) not between 1 and 30
       or jsonb_typeof(point -> 'title') is distinct from 'string'
       or char_length(trim(point ->> 'title')) not between 1 and 160
       or jsonb_typeof(point -> 'detail') is distinct from 'string'
       or char_length(trim(point ->> 'detail')) > 500 then
      return false;
    end if;
  end loop;

  return true;
end;
$$;

-- The composite key makes lecture ownership of an analysis enforceable by a
-- foreign key, including for direct service-role writes that bypass the RPC.
create unique index lecture_material_analyses_lecture_id_uidx
  on public.lecture_material_analyses (lecture_session_id, id);

create table public.lecture_material_summary_publications (
  lecture_session_id uuid primary key
    references public.lecture_sessions(id) on delete restrict,
  analysis_id uuid not null,
  body jsonb not null
    check (private.phase66_material_summary_body_is_valid(body)),
  visibility text not null
    check (visibility in ('public', 'hidden')),
  review_state text not null
    check (review_state in ('admin_confirmed', 'admin_revised')),
  reviewed_by_actor_id uuid not null,
  published_at timestamptz,
  version bigint not null default 1
    check (version >= 1),
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  foreign key (lecture_session_id, analysis_id)
    references public.lecture_material_analyses (lecture_session_id, id)
    on delete restrict,
  check (visibility <> 'public' or published_at is not null)
);

create unique index lecture_material_summary_publications_analysis_uidx
  on public.lecture_material_summary_publications (analysis_id);
create index lecture_material_summary_publications_lecture_analysis_idx
  on public.lecture_material_summary_publications (
    lecture_session_id,
    analysis_id
  );

alter table public.lecture_material_summary_publications
  enable row level security;
revoke all on public.lecture_material_summary_publications
  from public, anon, authenticated;
grant select, insert, update
  on public.lecture_material_summary_publications
  to service_role;

create function private.phase66_public_material_summary_json(
  target_lecture_session_id uuid
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'analysis_id', publication.analysis_id,
    'published_at', publication.published_at,
    'review_state', publication.review_state,
    'body', publication.body
  )
  from public.lecture_material_summary_publications as publication
  where publication.lecture_session_id = target_lecture_session_id
    and publication.visibility = 'public';
$$;

create function private.phase66_admin_material_summary_publication_json(
  target_lecture_session_id uuid
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'analysis_id', publication.analysis_id,
    'published_at', publication.published_at,
    'review_state', publication.review_state,
    'body', publication.body,
    'visibility', publication.visibility,
    'version', publication.version,
    'updated_at', publication.updated_at
  )
  from public.lecture_material_summary_publications as publication
  where publication.lecture_session_id = target_lecture_session_id;
$$;

create function public.admin_set_material_summary_publication(
  target_actor_id uuid,
  target_lecture_session_id uuid,
  target_analysis_id uuid,
  target_visibility text,
  target_body jsonb,
  target_review_state text
)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  lecture_row public.lecture_sessions%rowtype;
  analysis_row public.lecture_material_analyses%rowtype;
  publication_row public.lecture_material_summary_publications%rowtype;
  normalized_body jsonb;
begin
  if target_actor_id is null
     or target_visibility not in ('public', 'hidden') then
    raise exception 'invalid material summary publication request'
      using errcode = '22023';
  end if;

  perform private.close_lecture_if_expired(target_lecture_session_id);

  select lecture.*
  into lecture_row
  from public.lecture_sessions as lecture
  where lecture.id = target_lecture_session_id
  for update;

  if not found or not (
    lecture_row.status = 'draft'
    or (
      lecture_row.status = 'open'
      and lecture_row.hard_stop_at > statement_timestamp()
    )
    or (
      lecture_row.status = 'closed'
      and lecture_row.archive_expires_at > statement_timestamp()
    )
  ) then
    raise exception 'lecture is unavailable for material summary publication'
      using errcode = 'P0001';
  end if;

  select analysis.*
  into analysis_row
  from public.lecture_material_analyses as analysis
  where analysis.id = target_analysis_id
    and analysis.lecture_session_id = target_lecture_session_id
  for update;

  if not found then
    raise exception 'material analysis not found' using errcode = 'P0002';
  end if;

  select publication.*
  into publication_row
  from public.lecture_material_summary_publications as publication
  where publication.lecture_session_id = target_lecture_session_id
  for update;

  if target_visibility = 'hidden' then
    if not found then
      raise exception 'material summary publication not found'
        using errcode = 'P0002';
    end if;

    if publication_row.visibility = 'hidden' then
      return to_jsonb(publication_row);
    end if;

    update public.lecture_material_summary_publications as publication
    set
      visibility = 'hidden',
      version = publication.version + 1,
      updated_at = statement_timestamp()
    where publication.lecture_session_id = target_lecture_session_id
    returning publication.* into publication_row;

    perform private.bump_lecture_live_state(
      target_lecture_session_id,
      'summaries'
    );
    return to_jsonb(publication_row);
  end if;

  if analysis_row.status <> 'active'
     or target_review_state not in ('admin_confirmed', 'admin_revised')
     or not private.phase66_material_summary_body_is_valid(target_body) then
    raise exception 'invalid reviewed material summary'
      using errcode = '22023';
  end if;

  normalized_body := jsonb_build_object(
    'lead', trim(target_body ->> 'lead'),
    'points', (
      select jsonb_agg(
        jsonb_build_object(
          'pageLabel', trim(point.value ->> 'pageLabel'),
          'title', trim(point.value ->> 'title'),
          'detail', trim(point.value ->> 'detail')
        )
        order by point.ordinality
      )
      from jsonb_array_elements(target_body -> 'points')
        with ordinality as point(value, ordinality)
    )
  ) || case
    when target_body ? 'reflectionQuestion'
      then jsonb_build_object(
        'reflectionQuestion',
        trim(target_body ->> 'reflectionQuestion')
      )
    else '{}'::jsonb
  end;

  if publication_row.lecture_session_id is not null
     and publication_row.analysis_id = target_analysis_id
     and publication_row.body = normalized_body
     and publication_row.visibility = 'public'
     and publication_row.review_state = target_review_state
     and publication_row.reviewed_by_actor_id = target_actor_id then
    return to_jsonb(publication_row);
  end if;

  insert into public.lecture_material_summary_publications as publication (
    lecture_session_id,
    analysis_id,
    body,
    visibility,
    review_state,
    reviewed_by_actor_id,
    published_at,
    version,
    created_at,
    updated_at
  )
  values (
    target_lecture_session_id,
    target_analysis_id,
    normalized_body,
    'public',
    target_review_state,
    target_actor_id,
    statement_timestamp(),
    1,
    statement_timestamp(),
    statement_timestamp()
  )
  on conflict (lecture_session_id) do update
  set
    analysis_id = excluded.analysis_id,
    body = excluded.body,
    visibility = 'public',
    review_state = excluded.review_state,
    reviewed_by_actor_id = excluded.reviewed_by_actor_id,
    published_at = coalesce(publication.published_at, excluded.published_at),
    version = publication.version + 1,
    updated_at = excluded.updated_at
  returning publication.* into publication_row;

  perform private.bump_lecture_live_state(
    target_lecture_session_id,
    'summaries'
  );
  return to_jsonb(publication_row);
end;
$$;

create or replace function public.admin_list_material_ai_results(
  target_lecture_session_id uuid
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select private.material_ai_results_json(target_lecture_session_id)
    || jsonb_build_object(
      'publication',
      private.phase66_admin_material_summary_publication_json(
        target_lecture_session_id
      )
    )
  where exists (
    select 1
    from public.lecture_sessions as lecture
    where lecture.id = target_lecture_session_id
  );
$$;

create table public.lecture_archive_exports (
  lecture_session_id uuid primary key
    references public.lecture_sessions(id) on delete restrict,
  source_version bigint not null default 1
    check (source_version >= 1),
  status text not null default 'pending'
    check (status in ('pending', 'exporting', 'exported', 'error', 'expired')),
  lease_until timestamptz,
  next_attempt_at timestamptz not null default statement_timestamp(),
  attempt_count integer not null default 0
    check (attempt_count >= 0),
  payload_sha256 text
    check (payload_sha256 is null or payload_sha256 ~ '^[0-9a-f]{64}$'),
  exported_at timestamptz,
  last_error text
    check (last_error is null or char_length(last_error) <= 500),
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp()
);

create index lecture_archive_exports_claim_idx
  on public.lecture_archive_exports (
    next_attempt_at,
    lecture_session_id
  )
  where status in ('pending', 'error');

create index lecture_archive_exports_lease_idx
  on public.lecture_archive_exports (lease_until, lecture_session_id)
  where status = 'exporting';

alter table public.lecture_archive_exports enable row level security;
revoke all on public.lecture_archive_exports
  from public, anon, authenticated;
grant select, insert, update on public.lecture_archive_exports to service_role;

create function private.requeue_lecture_archive_export(
  target_lecture_session_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.lecture_sessions as lecture
    where lecture.id = target_lecture_session_id
      and lecture.status = 'closed'
      and lecture.archive_expires_at > statement_timestamp()
  ) then
    return;
  end if;

  insert into public.lecture_archive_exports as export (
    lecture_session_id,
    source_version,
    status,
    next_attempt_at,
    updated_at
  )
  values (
    target_lecture_session_id,
    1,
    'pending',
    statement_timestamp(),
    statement_timestamp()
  )
  on conflict (lecture_session_id) do update
  set
    source_version = export.source_version + 1,
    status = 'pending',
    lease_until = null,
    next_attempt_at = statement_timestamp(),
    last_error = null,
    updated_at = statement_timestamp();
end;
$$;

create function private.track_lecture_archive_export()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'closed'
     and new.archive_expires_at > statement_timestamp()
     and (
       tg_op = 'INSERT'
       or old.status is distinct from new.status
       or old.title is distinct from new.title
       or old.archive_expires_at is distinct from new.archive_expires_at
     ) then
    perform private.requeue_lecture_archive_export(new.id);
  end if;
  return new;
end;
$$;

create trigger lecture_sessions_track_public_archive
after insert or update of status, title, archive_expires_at
on public.lecture_sessions
for each row execute function private.track_lecture_archive_export();

create function private.track_related_archive_export()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_lecture_session_id uuid := case
    when tg_op = 'DELETE' then old.lecture_session_id
    else new.lecture_session_id
  end;
begin
  perform private.requeue_lecture_archive_export(target_lecture_session_id);
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create trigger comments_track_public_archive
after insert or update or delete on public.comments
for each row execute function private.track_related_archive_export();

create trigger polls_track_public_archive
after insert or update or delete on public.polls
for each row execute function private.track_related_archive_export();

create trigger poll_option_totals_track_public_archive
after insert or update or delete on public.poll_option_totals
for each row execute function private.track_related_archive_export();

create trigger comment_like_totals_track_public_archive
after insert or update or delete on public.comment_like_totals
for each row execute function private.track_related_archive_export();

create trigger lecture_pdf_documents_track_public_archive
after insert or update or delete on public.lecture_pdf_documents
for each row execute function private.track_related_archive_export();

create trigger summary_publications_track_public_archive
after insert or update or delete on public.summary_publications
for each row execute function private.track_related_archive_export();

create trigger material_summary_publications_track_public_archive
after insert or update or delete
on public.lecture_material_summary_publications
for each row execute function private.track_related_archive_export();

create function private.build_public_lecture_archive_v1(
  target_lecture_session_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  lecture_row public.lecture_sessions%rowtype;
  live_row public.lecture_live_state%rowtype;
  comments_payload jsonb;
  comment_count bigint;
  polls_payload jsonb;
  pdf_payload jsonb;
begin
  select lecture.*
  into lecture_row
  from public.lecture_sessions as lecture
  where lecture.id = target_lecture_session_id
    and lecture.status = 'closed'
    and lecture.archive_expires_at > statement_timestamp();

  if not found then
    return null;
  end if;

  select live.*
  into live_row
  from public.lecture_live_state as live
  where live.lecture_session_id = target_lecture_session_id;

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
        'like_count', coalesce(total.like_count, 0),
        'nickname', comment.nickname
      )
      order by comment.is_pinned desc, comment.created_at desc, comment.id desc
    ),
    '[]'::jsonb
  )
  into comments_payload
  from (
    select candidate.*
    from public.comments as candidate
    where candidate.lecture_session_id = target_lecture_session_id
      and candidate.status = 'visible'
    order by candidate.is_pinned desc, candidate.created_at desc, candidate.id desc
    limit 500
  ) as comment
  left join public.comment_like_totals as total
    on total.lecture_session_id = comment.lecture_session_id
   and total.comment_id = comment.id;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'created_at', poll.created_at,
        'id', poll.id,
        'options', coalesce((
          select jsonb_agg(
            jsonb_build_object(
              'id', option.id,
              'label', option.label,
              'order', option.display_order,
              'response_count', coalesce(total.response_count, 0)
            )
            order by option.display_order, option.id
          )
          from public.poll_options as option
          left join public.poll_option_totals as total
            on total.lecture_session_id = option.lecture_session_id
           and total.poll_id = option.poll_id
           and total.option_id = option.id
          where option.lecture_session_id = poll.lecture_session_id
            and option.poll_id = poll.id
        ), '[]'::jsonb),
        'question', poll.question,
        'type', poll.type
      )
      order by poll.created_at, poll.id
    ),
    '[]'::jsonb
  )
  into polls_payload
  from (
    select candidate.*
    from public.polls as candidate
    where candidate.lecture_session_id = target_lecture_session_id
      and candidate.status = 'closed'
    order by candidate.created_at desc, candidate.id desc
    limit 100
  ) as poll;

  if live_row.pdf_document_id is not null
     and live_row.pdf_document_version is not null
     and live_row.pdf_visible then
    select jsonb_build_object(
      'current_page', live_row.current_pdf_page,
      'display_name', document.display_name,
      'document_id', document.document_id,
      'document_version', document.document_version,
      'download_enabled', document.download_enabled,
      'lecture_public_id',
        'lecture_' || replace(lecture_row.pdf_public_id::text, '-', ''),
      'manifest_version', document.manifest_version,
      'page_count', document.page_count
    )
    into pdf_payload
    from public.lecture_pdf_documents as document
    where document.lecture_session_id = target_lecture_session_id
      and document.document_id = live_row.pdf_document_id
      and document.document_version = live_row.pdf_document_version
      and document.visible
    limit 1;
  end if;

  return jsonb_build_object(
    'archive_expires_at', lecture_row.archive_expires_at,
    'closed_at', lecture_row.closed_at,
    'comments', comments_payload,
    'comments_has_more', comment_count > 500,
    'material_summary', private.phase66_public_material_summary_json(
      target_lecture_session_id
    ),
    'participant_count_approximate', coalesce(live_row.participant_count, 0),
    'pdf', pdf_payload,
    'polls', polls_payload,
    'schema_version', 1,
    'started_at', lecture_row.started_at,
    'summaries', private.phase6_public_summaries_json(
      target_lecture_session_id,
      12
    ),
    'title', lecture_row.title
  );
end;
$$;

create function private.claim_lecture_archive_exports(
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
      -- Incrementing the source version when reclaiming an expired lease
      -- fences the late result from the abandoned worker without adding a
      -- second token to the Edge Function contract.
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
    private.build_public_lecture_archive_v1(claimed.lecture_session_id)
  from claimed
  join public.lecture_sessions as lecture
    on lecture.id = claimed.lecture_session_id
  join public.lecture_admin_codes as code
    on code.lecture_session_id = claimed.lecture_session_id;
end;
$$;

create function private.finish_lecture_archive_export(
  target_lecture_session_id uuid,
  target_source_version bigint,
  target_succeeded boolean,
  target_payload_sha256 text default null,
  target_error text default null
)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if target_succeeded
     and (
       target_payload_sha256 is null
       or target_payload_sha256 !~ '^[0-9a-f]{64}$'
     ) then
    raise exception 'payload hash is invalid' using errcode = '22023';
  end if;

  update public.lecture_archive_exports as export
  set
    status = case when target_succeeded then 'exported' else 'error' end,
    lease_until = null,
    next_attempt_at = case
      when target_succeeded then export.next_attempt_at
      else statement_timestamp()
        + least(export.attempt_count, 12) * interval '5 minutes'
    end,
    payload_sha256 = case
      when target_succeeded then target_payload_sha256
      else export.payload_sha256
    end,
    exported_at = case
      when target_succeeded then statement_timestamp()
      else export.exported_at
    end,
    last_error = case
      when target_succeeded then null
      else left(coalesce(target_error, 'archive_export_failed'), 500)
    end,
    updated_at = statement_timestamp()
  where export.lecture_session_id = target_lecture_session_id
    and export.source_version = target_source_version
    and export.status = 'exporting';

  return found;
end;
$$;

create function public.claim_lecture_archive_exports(job_limit integer default 5)
returns table (
  lecture_session_id uuid,
  source_version bigint,
  lecture_code text,
  archive_expires_at timestamptz,
  attempt_count integer,
  payload jsonb
)
language sql
volatile
security invoker
set search_path = ''
as $$
  select *
  from private.claim_lecture_archive_exports(job_limit);
$$;

create function public.finish_lecture_archive_export(
  target_lecture_session_id uuid,
  target_source_version bigint,
  target_succeeded boolean,
  target_payload_sha256 text default null,
  target_error text default null
)
returns boolean
language sql
volatile
security invoker
set search_path = ''
as $$
  select private.finish_lecture_archive_export(
    target_lecture_session_id,
    target_source_version,
    target_succeeded,
    target_payload_sha256,
    target_error
  );
$$;

insert into public.lecture_archive_exports (
  lecture_session_id,
  source_version,
  status,
  next_attempt_at
)
select
  lecture.id,
  1,
  'pending',
  statement_timestamp()
from public.lecture_sessions as lecture
where lecture.status = 'closed'
  and lecture.archive_expires_at > statement_timestamp()
on conflict (lecture_session_id) do nothing;

create table public.daily_operations_digest_jobs (
  id uuid primary key default extensions.gen_random_uuid(),
  digest_date date not null,
  recipient text not null
    check (
      char_length(recipient) between 3 and 320
      and recipient ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    ),
  status text not null default 'pending'
    check (status in ('pending', 'sending', 'sent', 'skipped', 'failed')),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  next_attempt_at timestamptz not null default statement_timestamp(),
  provider_message_id text
    check (
      provider_message_id is null
      or char_length(provider_message_id) <= 200
    ),
  error_message text
    check (error_message is null or char_length(error_message) <= 500),
  sent_at timestamptz,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  unique (digest_date, recipient)
);

create index daily_operations_digest_jobs_claim_idx
  on public.daily_operations_digest_jobs (
    recipient,
    next_attempt_at,
    digest_date,
    id
  )
  where status in ('pending', 'failed');

create index daily_operations_digest_jobs_lease_idx
  on public.daily_operations_digest_jobs (recipient, updated_at, id)
  where status = 'sending';

create index lecture_sessions_started_digest_idx
  on public.lecture_sessions (started_at, id)
  where started_at is not null;

create index ai_usage_ledger_requested_global_idx
  on public.ai_usage_ledger (requested_at, id);

alter table public.daily_operations_digest_jobs enable row level security;
revoke all on public.daily_operations_digest_jobs
  from public, anon, authenticated;
grant select, insert, update on public.daily_operations_digest_jobs
  to service_role;

create function private.claim_daily_operations_digest_jobs(
  job_limit integer,
  target_recipient text
)
returns table (
  id uuid,
  digest_date date,
  recipient text,
  attempt_count integer
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  effective_date date := (
    statement_timestamp() at time zone 'Asia/Tokyo'
  )::date;
begin
  if target_recipient is null
     or char_length(target_recipient) not between 3 and 320
     or target_recipient !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception 'digest recipient is invalid' using errcode = '22023';
  end if;

  insert into public.daily_operations_digest_jobs (
    digest_date,
    recipient
  )
  values (effective_date, lower(trim(target_recipient)))
  on conflict on constraint
    daily_operations_digest_jobs_digest_date_recipient_key
  do nothing;

  return query
  with candidates as (
    select
      job.id,
      job.status = 'sending' as reclaim_expired_lease
    from public.daily_operations_digest_jobs as job
    where job.recipient = lower(trim(target_recipient))
      and (
        (
          job.status in ('pending', 'failed')
          and job.next_attempt_at <= statement_timestamp()
        )
        or (
          job.status = 'sending'
          and job.updated_at <= statement_timestamp() - interval '15 minutes'
        )
      )
      and job.attempt_count < 5
    order by
      job.digest_date,
      case
        when job.status = 'sending' then job.updated_at
        else job.next_attempt_at
      end,
      job.id
    for update skip locked
    limit least(greatest(job_limit, 1), 5)
  )
  update public.daily_operations_digest_jobs as job
  set
    status = 'sending',
    attempt_count = job.attempt_count + 1,
    error_message = case
      when candidates.reclaim_expired_lease then 'digest_lease_expired'
      else null
    end,
    updated_at = statement_timestamp()
  from candidates
  where job.id = candidates.id
  returning job.id, job.digest_date, job.recipient, job.attempt_count;
end;
$$;

create function private.finish_daily_operations_digest_job(
  target_job_id uuid,
  target_status text,
  target_provider_message_id text default null,
  target_error_message text default null
)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if target_status not in ('sent', 'skipped', 'failed') then
    raise exception 'invalid digest status' using errcode = '22023';
  end if;
  if target_status = 'sent'
     and (
       nullif(trim(coalesce(target_provider_message_id, '')), '') is null
       or char_length(target_provider_message_id) > 200
     ) then
    raise exception 'digest provider message id is invalid'
      using errcode = '22023';
  end if;

  update public.daily_operations_digest_jobs as job
  set
    status = target_status,
    provider_message_id = case
      when target_status = 'sent' then left(target_provider_message_id, 200)
      else job.provider_message_id
    end,
    error_message = case
      when target_status = 'failed'
        then left(coalesce(target_error_message, 'digest_send_failed'), 500)
      else null
    end,
    sent_at = case
      when target_status in ('sent', 'skipped') then statement_timestamp()
      else job.sent_at
    end,
    next_attempt_at = case
      when target_status = 'failed'
        then statement_timestamp()
          + least(job.attempt_count, 12) * interval '5 minutes'
      else job.next_attempt_at
    end,
    updated_at = statement_timestamp()
  where job.id = target_job_id
    and job.status = 'sending';

  return found;
end;
$$;

create function public.claim_daily_operations_digest_jobs(
  job_limit integer,
  target_recipient text
)
returns table (
  id uuid,
  digest_date date,
  recipient text,
  attempt_count integer
)
language sql
volatile
security invoker
set search_path = ''
as $$
  select *
  from private.claim_daily_operations_digest_jobs(
    job_limit,
    target_recipient
  );
$$;

create function public.finish_daily_operations_digest_job(
  target_job_id uuid,
  target_status text,
  target_provider_message_id text default null,
  target_error_message text default null
)
returns boolean
language sql
volatile
security invoker
set search_path = ''
as $$
  select private.finish_daily_operations_digest_job(
    target_job_id,
    target_status,
    target_provider_message_id,
    target_error_message
  );
$$;

create function private.get_lecture_public_snapshot_v5(
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
  comment_limit integer default 5,
  known_metrics_version bigint default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  payload jsonb;
  live_row public.lecture_live_state%rowtype;
  request_user_id uuid := (select auth.uid());
  request_participant_id uuid;
  participant_last_seen_at timestamptz;
  lecture_is_open boolean := false;
  active_participant_count bigint := 0;
  participant_counted_at timestamptz := statement_timestamp();
  effective_now timestamptz := statement_timestamp();
begin
  payload := private.get_lecture_public_snapshot_v4(
    target_lecture_session_id,
    known_lecture_version,
    known_caption_version,
    known_comments_version,
    known_likes_version,
    known_polls_version,
    known_summaries_version,
    known_pdf_version,
    null,
    null,
    least(greatest(comment_limit, 1), 5)
  );
  if payload is null then
    return null;
  end if;

  select live.*
  into live_row
  from public.lecture_live_state as live
  where live.lecture_session_id = target_lecture_session_id;

  select
    participant.id,
    lecture.status = 'open'
      and lecture.hard_stop_at > effective_now
  into request_participant_id, lecture_is_open
  from public.participants as participant
  join public.lecture_sessions as lecture
    on lecture.id = participant.lecture_session_id
  where participant.lecture_session_id = target_lecture_session_id
    and participant.auth_user_id = request_user_id;

  if not found then
    return null;
  end if;

  if lecture_is_open then
    select presence.last_seen_at
    into participant_last_seen_at
    from public.lecture_participant_presence as presence
    where presence.lecture_session_id = target_lecture_session_id
      and presence.participant_id = request_participant_id;

    if not found then
      insert into public.lecture_participant_presence (
        lecture_session_id,
        participant_id,
        last_seen_at
      )
      values (
        target_lecture_session_id,
        request_participant_id,
        effective_now
      )
      on conflict (lecture_session_id, participant_id) do nothing;
    elsif participant_last_seen_at
        <= effective_now - interval '45 seconds' then
      update public.lecture_participant_presence as presence
      set last_seen_at = effective_now
      where presence.lecture_session_id = target_lecture_session_id
        and presence.participant_id = request_participant_id
        and presence.last_seen_at
          <= effective_now - interval '45 seconds';
    end if;

    select active.active_count, active.counted_at
    into active_participant_count, participant_counted_at
    from private.phase66_active_participant_count(
      target_lecture_session_id,
      effective_now
    ) as active;
  end if;

  payload := jsonb_set(
    payload,
    '{versions,metrics}',
    to_jsonb(coalesce(live_row.metrics_version, 0)),
    true
  );

  -- Presence naturally expires without a write, so metrics are intentionally
  -- returned on every snapshot instead of relying only on a row-change
  -- version. A 15-second lecture-scoped bucket limits the indexed count to one
  -- refresh per lecture per bucket.
  payload := jsonb_set(
    payload,
    '{changed,metrics}',
    jsonb_build_object(
      'participant_count_approximate', active_participant_count,
      'participant_count_mode', 'active_90s',
      'updated_at', participant_counted_at,
      'visible_comment_count', live_row.visible_comment_count
    ),
    true
  );

  if (payload -> 'changed') ? 'summaries' then
    payload := jsonb_set(
      payload,
      '{changed,material_summary}',
      coalesce(
        private.phase66_public_material_summary_json(
          target_lecture_session_id
        ),
        'null'::jsonb
      ),
      true
    );
  end if;

  if (payload -> 'changed') ? 'likes' then
    payload := jsonb_set(
      payload,
      '{changed,likes}',
      coalesce((
        select jsonb_agg(item.value order by item.ordinality)
        from jsonb_array_elements(payload #> '{changed,likes}')
          with ordinality as item(value, ordinality)
        where item.ordinality <= 5
      ), '[]'::jsonb),
      true
    );
  end if;

  return payload;
end;
$$;

create function public.get_lecture_public_snapshot_v5(
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
  comment_limit integer default 5,
  known_metrics_version bigint default null
)
returns jsonb
language sql
volatile
security invoker
set search_path = ''
as $$
  select private.get_lecture_public_snapshot_v5(
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
    comment_limit,
    known_metrics_version
  );
$$;

-- Server-authoritative Realtime duration enforcement. The Admin UI and Edge
-- Functions may stop earlier, but neither client time nor an active browser is
-- trusted to decide whether a paid caption operation is still running.
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
        <= effective_now as selected_duration_elapsed
    from public.ai_usage_ledger as usage
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
    for update skip locked
  loop
    perform private.finish_realtime_caption_operation(
      stale_operation.id,
      stale_operation.requested_by_actor,
      case
        when stale_operation.selected_duration_elapsed
          then 'selected_duration_elapsed'
        else 'heartbeat_timeout'
      end,
      stale_operation.selected_duration_elapsed,
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
  effective_now timestamptz := statement_timestamp();
  reserved_until timestamptz;
begin
  select usage.*
  into initial_usage
  from public.ai_usage_ledger as usage
  where usage.id = target_operation_id;

  if not found
     or initial_usage.feature <> 'captions'
     or initial_usage.requested_by_actor <> target_actor_id then
    return jsonb_build_object(
      'should_stop', true,
      'reason', 'operation_not_available',
      'server_time', effective_now
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

  reserved_until := usage_row.requested_at
    + usage_row.reserved_audio_seconds * interval '1 second';

  if usage_row.status <> 'running' then
    return jsonb_build_object(
      'should_stop', true,
      'reason', case
        when usage_row.error_code = 'selected_duration_elapsed'
          then 'selected_duration_elapsed'
        else 'operation_stopped'
      end,
      'hard_stop_at', lecture_row.hard_stop_at,
      'reserved_until', reserved_until,
      'server_time', effective_now
    );
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
      'should_stop', true,
      'reason', 'selected_duration_elapsed',
      'hard_stop_at', lecture_row.hard_stop_at,
      'reserved_until', reserved_until,
      'server_time', effective_now
    );
  end if;

  if lecture_row.status <> 'open'
     or lecture_row.hard_stop_at <= effective_now
     or control_row.status not in ('ready', 'running')
     or not control_row.captions_enabled then
    return jsonb_build_object(
      'should_stop', true,
      'reason', 'operation_stopped',
      'hard_stop_at', lecture_row.hard_stop_at,
      'reserved_until', reserved_until,
      'server_time', effective_now
    );
  end if;

  update public.ai_usage_ledger
  set last_heartbeat_at = effective_now
  where id = target_operation_id
    and status = 'running';

  update public.lecture_ai_control
  set
    last_heartbeat_at = effective_now,
    updated_at = effective_now
  where lecture_session_id = usage_row.lecture_session_id;

  return jsonb_build_object(
    'should_stop', false,
    'hard_stop_at', lecture_row.hard_stop_at,
    'reserved_until', reserved_until,
    'server_time', effective_now
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

create function private.maintain_phase6_6_jobs()
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  reset_archive_count integer;
  expired_archive_count integer;
  reset_digest_count integer;
  deleted_join_rate_count integer;
  reaped_caption_count integer;
begin
  select count(*)::integer
  into reaped_caption_count
  from (
    select reaped.operation_id
    from (
      select usage.lecture_session_id
      from public.ai_usage_ledger as usage
      where usage.feature = 'captions'
        and usage.status = 'running'
        and (
          coalesce(usage.last_heartbeat_at, usage.requested_at)
            < statement_timestamp() - interval '45 seconds'
          or usage.requested_at
            + usage.reserved_audio_seconds * interval '1 second'
            <= statement_timestamp()
        )
      group by usage.lecture_session_id
      order by min(
        least(
          coalesce(usage.last_heartbeat_at, usage.requested_at)
            + interval '45 seconds',
          usage.requested_at
            + usage.reserved_audio_seconds * interval '1 second'
        )
      )
      limit 20
    ) as due_lecture
    cross join lateral private.reap_stale_realtime_caption_operations(
      due_lecture.lecture_session_id,
      20
    ) as reaped
  ) as completed_reaps;

  update public.lecture_archive_exports as export
  set
    source_version = export.source_version + 1,
    status = 'error',
    lease_until = null,
    next_attempt_at = statement_timestamp(),
    last_error = 'export_lease_expired',
    updated_at = statement_timestamp()
  where export.status = 'exporting'
    and export.lease_until <= statement_timestamp();
  get diagnostics reset_archive_count = row_count;

  update public.lecture_archive_exports as export
  set
    status = 'expired',
    lease_until = null,
    updated_at = statement_timestamp()
  where export.status <> 'expired'
    and exists (
      select 1
      from public.lecture_sessions as lecture
      where lecture.id = export.lecture_session_id
        and lecture.archive_expires_at <= statement_timestamp()
    );
  get diagnostics expired_archive_count = row_count;

  update public.daily_operations_digest_jobs as job
  set
    status = 'failed',
    next_attempt_at = statement_timestamp(),
    error_message = 'digest_lease_expired',
    updated_at = statement_timestamp()
  where job.status = 'sending'
    and job.updated_at <= statement_timestamp() - interval '15 minutes';
  get diagnostics reset_digest_count = row_count;

  with stale_join_rates as (
    select rate.auth_user_id
    from public.lecture_join_rate_limits as rate
    where rate.updated_at <= statement_timestamp() - interval '24 hours'
      and (
        rate.locked_until is null
        or rate.locked_until <= statement_timestamp()
      )
    order by rate.updated_at, rate.auth_user_id
    for update skip locked
    limit 500
  )
  delete from public.lecture_join_rate_limits as rate
  using stale_join_rates
  where rate.auth_user_id = stale_join_rates.auth_user_id;
  get diagnostics deleted_join_rate_count = row_count;

  return jsonb_build_object(
    'deleted_join_rate_rows', deleted_join_rate_count,
    'expired_archives', expired_archive_count,
    'reaped_caption_operations', reaped_caption_count,
    'reset_archive_jobs', reset_archive_count,
    'reset_digest_jobs', reset_digest_count
  );
end;
$$;

create function public.run_phase6_6_maintenance()
returns jsonb
language sql
volatile
security invoker
set search_path = ''
as $$
  select private.maintain_phase6_6_jobs();
$$;

revoke all on function private.track_participant_metrics()
  from public, anon, authenticated, service_role;
revoke all on function private.invalidate_presence_metrics()
  from public, anon, authenticated, service_role;
revoke all on function private.phase66_active_participant_count(
  uuid, timestamptz
) from public, anon, authenticated, service_role;
revoke all on function private.phase66_material_summary_body_is_valid(jsonb)
  from public, anon, authenticated, service_role;
revoke all on function private.phase66_public_material_summary_json(uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.phase66_admin_material_summary_publication_json(
  uuid
) from public, anon, authenticated, service_role;
revoke all on function private.join_lecture_by_code_v2(text)
  from public, anon, authenticated, service_role;
revoke all on function private.requeue_lecture_archive_export(uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.track_lecture_archive_export()
  from public, anon, authenticated, service_role;
revoke all on function private.track_related_archive_export()
  from public, anon, authenticated, service_role;
revoke all on function private.build_public_lecture_archive_v1(uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.claim_lecture_archive_exports(integer)
  from public, anon, authenticated, service_role;
revoke all on function private.finish_lecture_archive_export(
  uuid, bigint, boolean, text, text
) from public, anon, authenticated, service_role;
revoke all on function private.claim_daily_operations_digest_jobs(integer, text)
  from public, anon, authenticated, service_role;
revoke all on function private.finish_daily_operations_digest_job(
  uuid, text, text, text
) from public, anon, authenticated, service_role;
revoke all on function private.get_lecture_public_snapshot_v5(
  uuid, bigint, bigint, bigint, bigint, bigint, bigint, bigint,
  timestamptz, uuid, integer, bigint
) from public, anon, authenticated, service_role;
revoke all on function private.maintain_phase6_6_jobs()
  from public, anon, authenticated, service_role;

grant execute on function private.join_lecture_by_code_v2(text)
  to authenticated;
grant execute on function private.phase66_material_summary_body_is_valid(jsonb)
  to service_role;
grant execute on function private.phase66_admin_material_summary_publication_json(
  uuid
) to service_role;
grant execute on function private.bump_lecture_live_state(uuid, text)
  to service_role;
grant execute on function private.claim_lecture_archive_exports(integer)
  to service_role;
grant execute on function private.finish_lecture_archive_export(
  uuid, bigint, boolean, text, text
) to service_role;
grant execute on function private.claim_daily_operations_digest_jobs(integer, text)
  to service_role;
grant execute on function private.finish_daily_operations_digest_job(
  uuid, text, text, text
) to service_role;
grant execute on function private.get_lecture_public_snapshot_v5(
  uuid, bigint, bigint, bigint, bigint, bigint, bigint, bigint,
  timestamptz, uuid, integer, bigint
) to authenticated;
grant execute on function private.maintain_phase6_6_jobs()
  to service_role;

revoke all on function public.join_lecture_by_code_v2(text)
  from public, anon, authenticated, service_role;
revoke all on function public.admin_create_lecture_v2(
  text, text, text, timestamptz, timestamptz
) from public, anon, authenticated, service_role;
revoke all on function public.admin_duplicate_lecture_v1(uuid, text, text)
  from public, anon, authenticated, service_role;
revoke all on function public.admin_set_material_summary_publication(
  uuid, uuid, uuid, text, jsonb, text
) from public, anon, authenticated, service_role;
revoke all on function public.claim_lecture_archive_exports(integer)
  from public, anon, authenticated, service_role;
revoke all on function public.finish_lecture_archive_export(
  uuid, bigint, boolean, text, text
) from public, anon, authenticated, service_role;
revoke all on function public.claim_daily_operations_digest_jobs(integer, text)
  from public, anon, authenticated, service_role;
revoke all on function public.finish_daily_operations_digest_job(
  uuid, text, text, text
) from public, anon, authenticated, service_role;
revoke all on function public.get_lecture_public_snapshot_v5(
  uuid, bigint, bigint, bigint, bigint, bigint, bigint, bigint,
  timestamptz, uuid, integer, bigint
) from public, anon, authenticated, service_role;
revoke all on function public.run_phase6_6_maintenance()
  from public, anon, authenticated, service_role;

grant execute on function public.join_lecture_by_code_v2(text)
  to authenticated;
grant execute on function public.admin_create_lecture_v2(
  text, text, text, timestamptz, timestamptz
) to service_role;
grant execute on function public.admin_duplicate_lecture_v1(uuid, text, text)
  to service_role;
grant execute on function public.admin_set_material_summary_publication(
  uuid, uuid, uuid, text, jsonb, text
) to service_role;
grant execute on function public.claim_lecture_archive_exports(integer)
  to service_role;
grant execute on function public.finish_lecture_archive_export(
  uuid, bigint, boolean, text, text
) to service_role;
grant execute on function public.claim_daily_operations_digest_jobs(integer, text)
  to service_role;
grant execute on function public.finish_daily_operations_digest_job(
  uuid, text, text, text
) to service_role;
grant execute on function public.get_lecture_public_snapshot_v5(
  uuid, bigint, bigint, bigint, bigint, bigint, bigint, bigint,
  timestamptz, uuid, integer, bigint
) to authenticated;
grant execute on function public.run_phase6_6_maintenance()
  to service_role;

do $$
declare
  existing_job_id bigint;
begin
  select jobid
  into existing_job_id
  from cron.job
  where jobname = 'compass-phase6-6-maintenance'
  limit 1;

  if existing_job_id is null then
    perform cron.schedule(
      'compass-phase6-6-maintenance',
      '*/5 * * * *',
      'select public.run_phase6_6_maintenance();'
    );
  end if;
end;
$$;

do $$
declare
  existing_cleanup_job_id bigint;
begin
  select jobid
  into existing_cleanup_job_id
  from cron.job
  where jobname = 'compass-cron-history-weekly'
  limit 1;

  if existing_cleanup_job_id is not null then
    perform cron.unschedule(existing_cleanup_job_id);
  end if;

  perform cron.schedule(
    'compass-cron-history-weekly',
    '17 3 * * 0',
    $cleanup$delete from cron.job_run_details
      where jobid in (
        select jobid
        from cron.job
        where jobname like 'compass-%'
      )
        and end_time < statement_timestamp() - interval '30 days';$cleanup$
  );
end;
$$;

comment on column public.lecture_live_state.participant_count is
  'Cumulative unique joined-participant count for audit; public UX uses the separate active-90-second presence metric.';
comment on table public.lecture_participant_presence is
  'Server-owned, 45-second-throttled participant heartbeat state used for approximate active attendance.';
comment on table public.lecture_presence_metrics is
  'Fifteen-second cached active-presence count, refreshed from the indexed 90-second TTL window.';
comment on table public.lecture_archive_exports is
  'Outbox for one-time sanitized lecture archive publication to private R2.';
comment on table public.lecture_material_summary_publications is
  'One teacher-reviewed student-facing material summary projection per lecture.';
comment on table public.daily_operations_digest_jobs is
  'Idempotent daily 20:00 JST operations digest delivery state.';

-- Admin comment moderation is kept behind an Admin-token Edge Function. The
-- browser never receives UPDATE privileges on comments, and every state change
-- is auditable without adding any Realtime publication.
create table public.comment_moderation_events (
  id bigint generated always as identity primary key,
  lecture_session_id uuid not null
    references public.lecture_sessions(id) on delete restrict,
  comment_id uuid not null,
  actor_id text not null
    check (char_length(actor_id) between 1 and 160),
  action text not null
    check (action in ('toggle_visibility', 'toggle_pin')),
  previous_status text not null
    check (previous_status in ('visible', 'hidden', 'deleted')),
  next_status text not null
    check (next_status in ('visible', 'hidden', 'deleted')),
  previous_is_pinned boolean not null,
  next_is_pinned boolean not null,
  created_at timestamptz not null default statement_timestamp(),
  foreign key (comment_id, lecture_session_id)
    references public.comments(id, lecture_session_id) on delete restrict
);

create index comment_moderation_events_lecture_created_idx
  on public.comment_moderation_events (
    lecture_session_id,
    created_at desc,
    id desc
  );
create index comment_moderation_events_comment_idx
  on public.comment_moderation_events (comment_id, lecture_session_id);

alter table public.comment_moderation_events enable row level security;
revoke all on public.comment_moderation_events
  from public, anon, authenticated;
grant select, insert on public.comment_moderation_events to service_role;

create function private.admin_moderate_lecture_comment(
  target_lecture_session_id uuid,
  target_comment_id uuid,
  target_action text,
  target_actor_id text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  comment_row public.comments%rowtype;
  previous_status text;
  previous_is_pinned boolean;
  next_status text;
  next_is_pinned boolean;
  like_count bigint := 0;
begin
  if target_action not in ('toggle_visibility', 'toggle_pin') then
    raise exception 'unsupported comment moderation action'
      using errcode = '22023';
  end if;
  if target_actor_id is null
     or char_length(target_actor_id) not between 1 and 160 then
    raise exception 'invalid comment moderation actor'
      using errcode = '22023';
  end if;

  perform private.close_lecture_if_expired(target_lecture_session_id);

  select comment.*
  into comment_row
  from public.comments as comment
  join public.lecture_sessions as lecture
    on lecture.id = comment.lecture_session_id
  where comment.id = target_comment_id
    and comment.lecture_session_id = target_lecture_session_id
    and comment.status <> 'deleted'
    and (
      private.is_lecture_open(lecture.id)
      or (
        lecture.status = 'closed'
        and lecture.archive_expires_at > statement_timestamp()
      )
    )
  for update of comment;

  if not found then
    raise exception 'comment is not available for moderation'
      using errcode = '42501';
  end if;

  previous_status := comment_row.status;
  previous_is_pinned := comment_row.is_pinned;

  if target_action = 'toggle_visibility' then
    next_status := case
      when comment_row.status = 'visible' then 'hidden'
      else 'visible'
    end;
    next_is_pinned := case
      when next_status = 'visible' then comment_row.is_pinned
      else false
    end;
  else
    if comment_row.status <> 'visible' then
      raise exception 'hidden comments cannot be pinned'
        using errcode = '22023';
    end if;
    next_status := comment_row.status;
    next_is_pinned := not comment_row.is_pinned;
  end if;

  update public.comments as comment
  set
    status = next_status,
    is_pinned = next_is_pinned,
    updated_at = statement_timestamp()
  where comment.id = comment_row.id
    and comment.lecture_session_id = comment_row.lecture_session_id
  returning comment.* into comment_row;

  insert into public.comment_moderation_events (
    lecture_session_id,
    comment_id,
    actor_id,
    action,
    previous_status,
    next_status,
    previous_is_pinned,
    next_is_pinned
  )
  values (
    target_lecture_session_id,
    target_comment_id,
    target_actor_id,
    target_action,
    previous_status,
    comment_row.status,
    previous_is_pinned,
    comment_row.is_pinned
  );

  select coalesce(total.like_count, 0)
  into like_count
  from public.comment_like_totals as total
  where total.lecture_session_id = target_lecture_session_id
    and total.comment_id = target_comment_id;

  return jsonb_build_object(
    'body', comment_row.body,
    'created_at', comment_row.created_at,
    'id', comment_row.id,
    'is_pinned', comment_row.is_pinned,
    'lecture_session_id', comment_row.lecture_session_id,
    'like_count', coalesce(like_count, 0),
    'nickname', comment_row.nickname,
    'participant_id', comment_row.participant_id,
    'status', comment_row.status,
    'updated_at', comment_row.updated_at
  );
end;
$$;

create function public.admin_moderate_lecture_comment(
  target_lecture_session_id uuid,
  target_comment_id uuid,
  target_action text,
  target_actor_id text
)
returns jsonb
language sql
volatile
security invoker
set search_path = ''
as $$
  select private.admin_moderate_lecture_comment(
    target_lecture_session_id,
    target_comment_id,
    target_action,
    target_actor_id
  );
$$;

revoke all on function private.admin_moderate_lecture_comment(
  uuid, uuid, text, text
) from public, anon, authenticated, service_role;
grant execute on function private.admin_moderate_lecture_comment(
  uuid, uuid, text, text
) to service_role;

revoke all on function public.admin_moderate_lecture_comment(
  uuid, uuid, text, text
) from public, anon, authenticated, service_role;
grant execute on function public.admin_moderate_lecture_comment(
  uuid, uuid, text, text
) to service_role;

comment on table public.comment_moderation_events is
  'Service-only audit trail for Admin comment visibility and pin changes.';

-- Operator snapshots are a separate, service-only projection. They do not
-- weaken participant ownership or write participant presence. Admin callers
-- may inspect hidden comments; classroom display tokens receive visible rows
-- only. Hidden counts are cached in the existing five-second live-state row so
-- the Admin view does not add a COUNT query to every poll.
alter table public.lecture_live_state
  add column hidden_comment_count bigint not null default 0
    check (hidden_comment_count >= 0),
  add column visible_comments_version bigint not null default 0
    check (visible_comments_version >= 0);

update public.lecture_live_state as live
set
  hidden_comment_count = counts.hidden_comment_count,
  visible_comments_version = live.comments_version
from (
  select
    lecture.id as lecture_session_id,
    (
      select count(*)::bigint
      from public.comments as comment
      where comment.lecture_session_id = lecture.id
        and comment.status = 'hidden'
    ) as hidden_comment_count
  from public.lecture_sessions as lecture
) as counts
where counts.lecture_session_id = live.lecture_session_id;

drop trigger lecture_participant_presence_invalidate_metrics
  on public.lecture_participant_presence;

create or replace function private.invalidate_presence_metrics()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_lecture_session_id uuid;
  effective_now timestamptz := statement_timestamp();
begin
  if tg_op = 'INSERT' then
    target_lecture_session_id := new.lecture_session_id;
  elsif tg_op = 'DELETE' then
    target_lecture_session_id := old.lecture_session_id;
  elsif
    (old.last_seen_at >= effective_now - interval '90 seconds')
      is distinct from
    (new.last_seen_at >= effective_now - interval '90 seconds')
  then
    target_lecture_session_id := new.lecture_session_id;
  else
    return new;
  end if;

  update public.lecture_presence_metrics as metrics
  set bucket_started_at = 'epoch'::timestamptz
  where metrics.lecture_session_id = target_lecture_session_id;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create trigger lecture_participant_presence_invalidate_metrics
after insert or update or delete on public.lecture_participant_presence
for each row execute function private.invalidate_presence_metrics();

create or replace function private.track_comment_live_state()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_lecture_session_id uuid := case
    when tg_op = 'DELETE' then old.lecture_session_id
    else new.lecture_session_id
  end;
  visible_delta integer := case
    when tg_op = 'INSERT' and new.status = 'visible' then 1
    when tg_op = 'DELETE' and old.status = 'visible' then -1
    when tg_op = 'UPDATE'
      and old.status <> 'visible' and new.status = 'visible' then 1
    when tg_op = 'UPDATE'
      and old.status = 'visible' and new.status <> 'visible' then -1
    else 0
  end;
  hidden_delta integer := case
    when tg_op = 'INSERT' and new.status = 'hidden' then 1
    when tg_op = 'DELETE' and old.status = 'hidden' then -1
    when tg_op = 'UPDATE'
      and old.status <> 'hidden' and new.status = 'hidden' then 1
    when tg_op = 'UPDATE'
      and old.status = 'hidden' and new.status <> 'hidden' then -1
    else 0
  end;
  visible_projection_changed boolean := case
    when tg_op = 'INSERT' then new.status = 'visible'
    when tg_op = 'DELETE' then old.status = 'visible'
    else old.status = 'visible' or new.status = 'visible'
  end;
begin
  insert into public.lecture_live_state as live (
    lecture_session_id,
    state_version,
    comments_version,
    visible_comments_version,
    metrics_version,
    visible_comment_count,
    hidden_comment_count,
    metrics_updated_at,
    updated_at
  )
  values (
    target_lecture_session_id,
    1,
    1,
    case when visible_projection_changed then 1 else 0 end,
    case when visible_delta <> 0 then 1 else 0 end,
    greatest(visible_delta, 0),
    greatest(hidden_delta, 0),
    statement_timestamp(),
    statement_timestamp()
  )
  on conflict (lecture_session_id) do update
  set
    state_version = live.state_version + 1,
    comments_version = live.comments_version + 1,
    visible_comments_version = live.visible_comments_version
      + case when visible_projection_changed then 1 else 0 end,
    metrics_version = live.metrics_version
      + case when visible_delta <> 0 then 1 else 0 end,
    visible_comment_count = greatest(
      0,
      live.visible_comment_count + visible_delta
    ),
    hidden_comment_count = greatest(
      0,
      live.hidden_comment_count + hidden_delta
    ),
    metrics_updated_at = case
      when visible_delta <> 0 then statement_timestamp()
      else live.metrics_updated_at
    end,
    updated_at = statement_timestamp();

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create function private.phase66_operator_terminal_json(
  target_lecture_session_id uuid
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'archive_expires_at', lecture.archive_expires_at,
    'closed_at', lecture.closed_at,
    'close_reason', lecture.close_reason,
    'hard_stop_at', lecture.hard_stop_at,
    'lecture_session_id', lecture.id,
    'server_time', statement_timestamp(),
    'started_at', lecture.started_at,
    'status', 'closed',
    'title', lecture.title
  )
  from public.lecture_sessions as lecture
  where lecture.id = target_lecture_session_id
    and lecture.status = 'closed';
$$;

create function private.get_lecture_operator_access_v1(
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
  effective_now timestamptz := statement_timestamp();
begin
  perform private.close_lecture_if_expired(target_lecture_session_id);

  select lecture.*
  into lecture_row
  from public.lecture_sessions as lecture
  where lecture.id = target_lecture_session_id;

  if not found then
    return null;
  end if;

  return jsonb_build_object(
    'hard_stop_at', lecture_row.hard_stop_at,
    'lecture_session_id', lecture_row.id,
    'mode', case
      when lecture_row.status = 'open'
        and lecture_row.hard_stop_at > effective_now then 'live'
      when lecture_row.status = 'closed' then 'terminal'
      else 'unavailable'
    end,
    'server_time', effective_now,
    'terminal', case
      when lecture_row.status = 'closed' then
        private.phase66_operator_terminal_json(
          target_lecture_session_id
        )
      else null
    end
  );
end;
$$;

create function private.get_lecture_operator_snapshot_v1(
  target_lecture_session_id uuid,
  include_hidden boolean default false,
  known_lecture_version bigint default null,
  known_caption_version bigint default null,
  known_comments_version bigint default null,
  known_likes_version bigint default null,
  known_polls_version bigint default null,
  known_summaries_version bigint default null,
  known_pdf_version bigint default null,
  comment_cursor_created_at timestamptz default null,
  comment_cursor_id uuid default null,
  comment_limit integer default 5,
  known_metrics_version bigint default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  lecture_row public.lecture_sessions%rowtype;
  live_row public.lecture_live_state%rowtype;
  effective_now timestamptz := statement_timestamp();
  effective_comment_limit integer := least(greatest(comment_limit, 1), 5);
  active_participant_count bigint := 0;
  participant_counted_at timestamptz := effective_now;
  comments_payload jsonb;
  comments_items jsonb := '[]'::jsonb;
  comments_has_more boolean := false;
  comments_has_older boolean := false;
  force_initial_comments boolean :=
    comment_cursor_created_at is null or comment_cursor_id is null;
  effective_comments_version bigint;
  likes_payload jsonb := '[]'::jsonb;
  polls_payload jsonb := '[]'::jsonb;
  caption_payload jsonb := 'null'::jsonb;
  metrics_payload jsonb;
  changed_payload jsonb := '{}'::jsonb;
begin
  perform private.close_lecture_if_expired(target_lecture_session_id);

  select lecture.*
  into lecture_row
  from public.lecture_sessions as lecture
  where lecture.id = target_lecture_session_id;

  if not found then
    return null;
  end if;
  if lecture_row.status <> 'open'
     or lecture_row.hard_stop_at <= effective_now then
    if lecture_row.status = 'closed' then
      return jsonb_build_object(
        'mode', 'terminal',
        'terminal',
          private.phase66_operator_terminal_json(
            target_lecture_session_id
          )
      );
    end if;
    return null;
  end if;

  select live.*
  into live_row
  from public.lecture_live_state as live
  where live.lecture_session_id = target_lecture_session_id;

  if not found then
    live_row.lecture_session_id := target_lecture_session_id;
    live_row.current_pdf_page := 1;
    live_row.display_mode := 'normal';
    live_row.lecture_version := 0;
    live_row.caption_version := 0;
    live_row.comments_version := 0;
    live_row.visible_comments_version := 0;
    live_row.likes_version := 0;
    live_row.polls_version := 0;
    live_row.summaries_version := 0;
    live_row.pdf_version := 0;
    live_row.metrics_version := 0;
    live_row.visible_comment_count := 0;
    live_row.hidden_comment_count := 0;
    live_row.pdf_manifest_version := 0;
    live_row.pdf_visible := false;
    live_row.updated_at := lecture_row.updated_at;
  end if;

  effective_comments_version := case
    when include_hidden then live_row.comments_version
    else live_row.visible_comments_version
  end;

  if known_lecture_version is distinct from live_row.lecture_version then
    changed_payload := changed_payload || jsonb_build_object(
      'lecture',
      jsonb_build_object(
        'archive_expires_at', lecture_row.archive_expires_at,
        'closed_at', lecture_row.closed_at,
        'close_reason', lecture_row.close_reason,
        'ends_at', lecture_row.ends_at,
        'hard_stop_at', lecture_row.hard_stop_at,
        'lecture_session_id', lecture_row.id,
        'starts_at', lecture_row.starts_at,
        'status', lecture_row.status,
        'title', lecture_row.title
      )
    );
  end if;

  if known_caption_version is distinct from live_row.caption_version then
    select jsonb_build_object(
      'language', caption.language,
      'last_item_id', caption.last_item_id,
      'sequence', caption.sequence,
      'text', caption.text,
      'updated_at', caption.updated_at,
      'window_ended_at', caption.window_ended_at,
      'window_started_at', caption.window_started_at
    )
    into caption_payload
    from public.lecture_public_captions as caption
    where caption.lecture_session_id = target_lecture_session_id;

    changed_payload := changed_payload || jsonb_build_object(
      'caption',
      coalesce(caption_payload, 'null'::jsonb)
    );
  end if;

  if known_comments_version is distinct from effective_comments_version then
    if not force_initial_comments and exists (
      select 1
      from public.comment_moderation_events as moderation
      where moderation.lecture_session_id = target_lecture_session_id
        and moderation.created_at > comment_cursor_created_at
    ) then
      force_initial_comments := true;
    end if;

    if force_initial_comments then
      select count(*) > effective_comment_limit
      into comments_has_older
      from (
        select 1
        from public.comments as comment
        where comment.lecture_session_id = target_lecture_session_id
          and (
            comment.status = 'visible'
            or (include_hidden and comment.status = 'hidden')
          )
        order by comment.created_at desc, comment.id desc
        limit effective_comment_limit + 1
      ) as candidates;

      select coalesce(jsonb_agg(
        jsonb_build_object(
          'body', comment.body,
          'created_at', comment.created_at,
          'id', comment.id,
          'is_pinned', comment.is_pinned,
          'lecture_session_id', comment.lecture_session_id,
          'like_count', coalesce(total.like_count, 0),
          'nickname', comment.nickname,
          'status', comment.status
        )
        order by comment.created_at desc, comment.id desc
      ), '[]'::jsonb)
      into comments_items
      from (
        select candidate.*
        from public.comments as candidate
        where candidate.lecture_session_id = target_lecture_session_id
          and (
            candidate.status = 'visible'
            or (include_hidden and candidate.status = 'hidden')
          )
        order by candidate.created_at desc, candidate.id desc
        limit effective_comment_limit
      ) as comment
      left join public.comment_like_totals as total
        on total.lecture_session_id = comment.lecture_session_id
       and total.comment_id = comment.id;

      comments_payload := jsonb_build_object(
        'has_more', false,
        'has_older', comments_has_older,
        'items', comments_items,
        'mode', 'initial'
      );
    else
      select count(*) > effective_comment_limit
      into comments_has_more
      from (
        select 1
        from public.comments as comment
        where comment.lecture_session_id = target_lecture_session_id
          and (
            comment.status = 'visible'
            or (include_hidden and comment.status = 'hidden')
          )
          and (comment.created_at, comment.id)
            > (comment_cursor_created_at, comment_cursor_id)
        order by comment.created_at, comment.id
        limit effective_comment_limit + 1
      ) as candidates;

      select coalesce(jsonb_agg(
        jsonb_build_object(
          'body', comment.body,
          'created_at', comment.created_at,
          'id', comment.id,
          'is_pinned', comment.is_pinned,
          'lecture_session_id', comment.lecture_session_id,
          'like_count', coalesce(total.like_count, 0),
          'nickname', comment.nickname,
          'status', comment.status
        )
        order by comment.created_at, comment.id
      ), '[]'::jsonb)
      into comments_items
      from (
        select candidate.*
        from public.comments as candidate
        where candidate.lecture_session_id = target_lecture_session_id
          and (
            candidate.status = 'visible'
            or (include_hidden and candidate.status = 'hidden')
          )
          and (candidate.created_at, candidate.id)
            > (comment_cursor_created_at, comment_cursor_id)
        order by candidate.created_at, candidate.id
        limit effective_comment_limit
      ) as comment
      left join public.comment_like_totals as total
        on total.lecture_session_id = comment.lecture_session_id
       and total.comment_id = comment.id;

      comments_payload := jsonb_build_object(
        'has_more', comments_has_more,
        'has_older', false,
        'items', comments_items,
        'mode', 'delta'
      );
    end if;

    changed_payload := changed_payload
      || jsonb_build_object('comments', comments_payload);
  end if;

  if known_likes_version is distinct from live_row.likes_version then
    select coalesce(jsonb_agg(
      jsonb_build_object(
        'comment_id', comment.id,
        'like_count', coalesce(total.like_count, 0)
      )
      order by comment.created_at desc, comment.id desc
    ), '[]'::jsonb)
    into likes_payload
    from (
      select candidate.*
      from public.comments as candidate
      where candidate.lecture_session_id = target_lecture_session_id
        and (
          candidate.status = 'visible'
          or (include_hidden and candidate.status = 'hidden')
        )
      order by candidate.created_at desc, candidate.id desc
      limit 5
    ) as comment
    left join public.comment_like_totals as total
      on total.lecture_session_id = comment.lecture_session_id
     and total.comment_id = comment.id;

    changed_payload := changed_payload
      || jsonb_build_object('likes', likes_payload);
  end if;

  if known_polls_version is distinct from live_row.polls_version then
    select coalesce(jsonb_agg(
      jsonb_build_object(
        'created_at', poll.created_at,
        'id', poll.id,
        'lecture_session_id', poll.lecture_session_id,
        'options', coalesce((
          select jsonb_agg(
            jsonb_build_object(
              'display_order', option.display_order,
              'id', option.id,
              'label', option.label,
              'poll_id', option.poll_id,
              'response_count', coalesce(total.response_count, 0)
            )
            order by option.display_order, option.id
          )
          from public.poll_options as option
          left join public.poll_option_totals as total
            on total.lecture_session_id = option.lecture_session_id
           and total.poll_id = option.poll_id
           and total.option_id = option.id
          where option.lecture_session_id = poll.lecture_session_id
            and option.poll_id = poll.id
        ), '[]'::jsonb),
        'question', poll.question,
        'status', poll.status,
        'type', poll.type
      )
      order by poll.created_at, poll.id
    ), '[]'::jsonb)
    into polls_payload
    from public.polls as poll
    where poll.lecture_session_id = target_lecture_session_id
      and poll.status = 'open';

    changed_payload := changed_payload
      || jsonb_build_object('polls', polls_payload);
  end if;

  if known_summaries_version is distinct from live_row.summaries_version then
    changed_payload := changed_payload || jsonb_build_object(
      'material_summary',
      coalesce(
        private.phase66_public_material_summary_json(
          target_lecture_session_id
        ),
        'null'::jsonb
      ),
      'summaries',
      private.phase6_public_summaries_json(
        target_lecture_session_id,
        6
      )
    );
  end if;

  if known_pdf_version is distinct from live_row.pdf_version then
    changed_payload := changed_payload || jsonb_build_object(
      'pdf',
      jsonb_build_object(
        'current_pdf_page', live_row.current_pdf_page,
        'display_mode', live_row.display_mode,
        'lecture_session_id', target_lecture_session_id,
        'pdf_document_id', live_row.pdf_document_id,
        'pdf_document_version', live_row.pdf_document_version,
        'pdf_manifest_version', coalesce(live_row.pdf_manifest_version, 0),
        'pdf_page_count', live_row.pdf_page_count,
        'pdf_visible', coalesce(live_row.pdf_visible, false),
        'updated_at', live_row.updated_at
      )
    );
  end if;

  select active.active_count, active.counted_at
  into active_participant_count, participant_counted_at
  from private.phase66_active_participant_count(
    target_lecture_session_id,
    effective_now
  ) as active;

  metrics_payload := jsonb_build_object(
    'participant_count_approximate', active_participant_count,
    'participant_count_mode', 'active_90s',
    'updated_at', participant_counted_at,
    'visible_comment_count', coalesce(
      live_row.visible_comment_count,
      0
    )
  );
  if include_hidden then
    metrics_payload := metrics_payload || jsonb_build_object(
      'hidden_comment_count',
      coalesce(live_row.hidden_comment_count, 0)
    );
  end if;
  changed_payload := changed_payload
    || jsonb_build_object('metrics', metrics_payload);

  -- A concurrent manual close is observed before the payload leaves the DB.
  select lecture.*
  into lecture_row
  from public.lecture_sessions as lecture
  where lecture.id = target_lecture_session_id;
  if lecture_row.status <> 'open'
     or lecture_row.hard_stop_at <= statement_timestamp() then
    perform private.close_lecture_if_expired(target_lecture_session_id);
    return jsonb_build_object(
      'mode', 'terminal',
      'terminal',
        private.phase66_operator_terminal_json(
          target_lecture_session_id
        )
    );
  end if;

  return jsonb_build_object(
    'mode', 'live',
    'snapshot', jsonb_build_object(
      'changed', changed_payload,
      'contract_version', 2,
      'server_time', statement_timestamp(),
      'versions', jsonb_build_object(
        'caption', coalesce(live_row.caption_version, 0),
        'comments', coalesce(effective_comments_version, 0),
        'lecture', coalesce(live_row.lecture_version, 0),
        'likes', coalesce(live_row.likes_version, 0),
        'metrics', coalesce(live_row.metrics_version, 0),
        'pdf', coalesce(live_row.pdf_version, 0),
        'polls', coalesce(live_row.polls_version, 0),
        'summaries', coalesce(live_row.summaries_version, 0)
      )
    )
  );
end;
$$;

create function private.get_lecture_operator_comment_history_v1(
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
declare
  effective_limit integer := least(greatest(history_limit, 1), 50);
  items jsonb := '[]'::jsonb;
  has_older boolean := false;
begin
  perform private.close_lecture_if_expired(target_lecture_session_id);
  if before_created_at is null or before_comment_id is null then
    raise exception 'comment history cursor is required'
      using errcode = '22023';
  end if;
  if not exists (
    select 1
    from public.lecture_sessions as lecture
    where lecture.id = target_lecture_session_id
      and (
        (lecture.status = 'open'
          and lecture.hard_stop_at > statement_timestamp())
        or (
          lecture.status = 'closed'
          and lecture.archive_expires_at > statement_timestamp()
        )
      )
  ) then
    return null;
  end if;

  select count(*) > effective_limit
  into has_older
  from (
    select 1
    from public.comments as comment
    where comment.lecture_session_id = target_lecture_session_id
      and comment.status in ('visible', 'hidden')
      and (comment.created_at, comment.id)
        < (before_created_at, before_comment_id)
    order by comment.created_at desc, comment.id desc
    limit effective_limit + 1
  ) as candidates;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'body', comment.body,
      'created_at', comment.created_at,
      'id', comment.id,
      'is_pinned', comment.is_pinned,
      'lecture_session_id', comment.lecture_session_id,
      'like_count', coalesce(total.like_count, 0),
      'nickname', comment.nickname,
      'status', comment.status
    )
    order by comment.created_at desc, comment.id desc
  ), '[]'::jsonb)
  into items
  from (
    select candidate.*
    from public.comments as candidate
    where candidate.lecture_session_id = target_lecture_session_id
      and candidate.status in ('visible', 'hidden')
      and (candidate.created_at, candidate.id)
        < (before_created_at, before_comment_id)
    order by candidate.created_at desc, candidate.id desc
    limit effective_limit
  ) as comment
  left join public.comment_like_totals as total
    on total.lecture_session_id = comment.lecture_session_id
   and total.comment_id = comment.id;

  return jsonb_build_object(
    'contract_version', 2,
    'has_older', has_older,
    'items', items,
    'server_time', statement_timestamp()
  );
end;
$$;

create function public.admin_get_lecture_operator_access_v1(
  target_lecture_session_id uuid
)
returns jsonb
language sql
volatile
security invoker
set search_path = ''
as $$
  select private.get_lecture_operator_access_v1(
    target_lecture_session_id
  );
$$;

create function public.admin_get_lecture_operator_snapshot_v1(
  target_lecture_session_id uuid,
  include_hidden boolean default false,
  known_lecture_version bigint default null,
  known_caption_version bigint default null,
  known_comments_version bigint default null,
  known_likes_version bigint default null,
  known_polls_version bigint default null,
  known_summaries_version bigint default null,
  known_pdf_version bigint default null,
  comment_cursor_created_at timestamptz default null,
  comment_cursor_id uuid default null,
  comment_limit integer default 5,
  known_metrics_version bigint default null
)
returns jsonb
language sql
volatile
security invoker
set search_path = ''
as $$
  select private.get_lecture_operator_snapshot_v1(
    target_lecture_session_id,
    include_hidden,
    known_lecture_version,
    known_caption_version,
    known_comments_version,
    known_likes_version,
    known_polls_version,
    known_summaries_version,
    known_pdf_version,
    comment_cursor_created_at,
    comment_cursor_id,
    comment_limit,
    known_metrics_version
  );
$$;

create function public.admin_get_lecture_operator_comment_history_v1(
  target_lecture_session_id uuid,
  before_created_at timestamptz,
  before_comment_id uuid,
  history_limit integer default 50
)
returns jsonb
language sql
volatile
security invoker
set search_path = ''
as $$
  select private.get_lecture_operator_comment_history_v1(
    target_lecture_session_id,
    before_created_at,
    before_comment_id,
    history_limit
  );
$$;

revoke all on function private.phase66_operator_terminal_json(uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.get_lecture_operator_access_v1(uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.get_lecture_operator_snapshot_v1(
  uuid, boolean, bigint, bigint, bigint, bigint, bigint, bigint,
  bigint, timestamptz, uuid, integer, bigint
) from public, anon, authenticated, service_role;
revoke all on function private.get_lecture_operator_comment_history_v1(
  uuid, timestamptz, uuid, integer
) from public, anon, authenticated, service_role;

grant execute on function private.get_lecture_operator_access_v1(uuid)
  to service_role;
grant execute on function private.get_lecture_operator_snapshot_v1(
  uuid, boolean, bigint, bigint, bigint, bigint, bigint, bigint,
  bigint, timestamptz, uuid, integer, bigint
) to service_role;
grant execute on function private.get_lecture_operator_comment_history_v1(
  uuid, timestamptz, uuid, integer
) to service_role;

revoke all on function public.admin_get_lecture_operator_access_v1(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.admin_get_lecture_operator_snapshot_v1(
  uuid, boolean, bigint, bigint, bigint, bigint, bigint, bigint,
  bigint, timestamptz, uuid, integer, bigint
) from public, anon, authenticated, service_role;
revoke all on function public.admin_get_lecture_operator_comment_history_v1(
  uuid, timestamptz, uuid, integer
) from public, anon, authenticated, service_role;

grant execute on function public.admin_get_lecture_operator_access_v1(uuid)
  to service_role;
grant execute on function public.admin_get_lecture_operator_snapshot_v1(
  uuid, boolean, bigint, bigint, bigint, bigint, bigint, bigint,
  bigint, timestamptz, uuid, integer, bigint
) to service_role;
grant execute on function public.admin_get_lecture_operator_comment_history_v1(
  uuid, timestamptz, uuid, integer
) to service_role;

comment on column public.lecture_live_state.hidden_comment_count is
  'Cached hidden-comment count for service-backed Admin UX; never exposed by participant snapshot RPCs.';
comment on column public.lecture_live_state.visible_comments_version is
  'Visible-only comment projection version used by classroom operator tokens to avoid hidden-activity metadata leakage.';
comment on function public.admin_get_lecture_operator_snapshot_v1(
  uuid, boolean, bigint, bigint, bigint, bigint, bigint, bigint,
  bigint, timestamptz, uuid, integer, bigint
) is
  'Service-only sanitized live projection for Admin and lecture-room display credentials.';
