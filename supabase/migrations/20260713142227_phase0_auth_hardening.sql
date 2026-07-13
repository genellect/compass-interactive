-- Phase 0: bind student writes to Supabase Auth identities and reduce the
-- exposed Data API surface before any paid API integration is introduced.
--
-- Existing participant rows are intentionally left with auth_user_id = null.
-- A client-generated UUID or participant_key is not proof of ownership, so
-- legacy identities must never be silently claimed by a new Auth session.

alter table public.participants
  add column auth_user_id uuid null;

comment on column public.participants.auth_user_id is
  'Supabase Auth user that owns this lecture participant. NULL marks a legacy or archived identity.';

create unique index participants_lecture_auth_user_uidx
  on public.participants (lecture_session_id, auth_user_id)
  where auth_user_id is not null;

create index participants_auth_user_idx
  on public.participants (auth_user_id, lecture_session_id)
  where auth_user_id is not null;

-- Cover every foreign key reported by the Supabase performance advisor.
-- Existing low-usage indexes are retained until production query statistics
-- are representative enough to justify a removal.
create index comment_likes_comment_lecture_idx
  on public.comment_likes (comment_id, lecture_session_id);
create index comment_likes_lecture_idx
  on public.comment_likes (lecture_session_id);
create index comment_likes_participant_lecture_idx
  on public.comment_likes (participant_id, lecture_session_id);
create index comments_participant_lecture_idx
  on public.comments (participant_id, lecture_session_id);
create index poll_options_lecture_idx
  on public.poll_options (lecture_session_id);
create index poll_options_poll_lecture_idx
  on public.poll_options (poll_id, lecture_session_id);
create index poll_responses_lecture_idx
  on public.poll_responses (lecture_session_id);
create index poll_responses_participant_lecture_idx
  on public.poll_responses (participant_id, lecture_session_id);
create index poll_responses_poll_lecture_idx
  on public.poll_responses (poll_id, lecture_session_id);
create index poll_result_refresh_events_lecture_idx
  on public.poll_result_refresh_events (lecture_session_id);
create index poll_result_refresh_events_poll_idx
  on public.poll_result_refresh_events (poll_id);

-- Trigger functions are never public RPCs. Fix their search_path and remove
-- the PostgreSQL default PUBLIC EXECUTE privilege later in this migration.
-- Poll response validation needs narrow internal reads after browser SELECT
-- privileges on polls and poll_options are removed, so keep it private and
-- Definer-owned while the table INSERT still remains protected by RLS.
alter function public.set_updated_at() set search_path = '';
alter function public.validate_poll_response_option_ids() set schema private;
alter function private.validate_poll_response_option_ids() security definer;
alter function private.validate_poll_response_option_ids() set search_path = '';
alter function public.emit_poll_result_refresh_event() set search_path = '';

create or replace function private.is_lecture_open(
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
    from public.lecture_sessions as lecture
    where lecture.id = target_lecture_session_id
      and lecture.status = 'open'
      and (lecture.starts_at is null or lecture.starts_at <= now())
      and (lecture.ends_at is null or lecture.ends_at >= now())
  );
$$;

create or replace function private.participant_is_owned(
  target_participant_id uuid,
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
    from public.participants as participant
    where participant.id = target_participant_id
      and participant.lecture_session_id = target_lecture_session_id
      and participant.auth_user_id = (select auth.uid())
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
    join public.lecture_sessions as lecture
      on lecture.id = poll.lecture_session_id
    where poll.id = target_poll_id
      and poll.lecture_session_id = target_lecture_session_id
      and poll.status = 'open'
      and lecture.status = 'open'
      and (lecture.starts_at is null or lecture.starts_at <= now())
      and (lecture.ends_at is null or lecture.ends_at >= now())
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
  if matched_lecture.starts_at is not null
     and matched_lecture.starts_at > now() then
    raise exception 'lecture is not open yet' using errcode = 'P0001';
  end if;
  if matched_lecture.ends_at is not null
     and matched_lecture.ends_at < now() then
    raise exception 'lecture has expired' using errcode = 'P0001';
  end if;

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
    now()
  )
  on conflict (lecture_session_id, auth_user_id)
    where auth_user_id is not null
  do update
    set last_seen_at = excluded.last_seen_at
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
    lecture.ends_at,
    lecture.status
  from public.lecture_sessions as lecture
  where lecture.id = target_lecture_session_id
    and (
      private.is_lecture_open(lecture.id)
      or exists (
        select 1
        from public.participants as participant
        where participant.lecture_session_id = lecture.id
          and participant.auth_user_id = (select auth.uid())
      )
    )
  limit 1;
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
stable
security definer
set search_path = ''
as $$
declare
  request_user_id uuid := (select auth.uid());
  current_participant_id uuid;
  snapshot_payload jsonb;
  document_id text;
begin
  if request_user_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  select participant.id
  into current_participant_id
  from public.participants as participant
  where participant.lecture_session_id = target_lecture_session_id
    and participant.auth_user_id = request_user_id
  limit 1;

  -- Admin/Display compatibility: an authenticated non-member may read an
  -- open lecture by its UUID, but receives no participant-specific state.
  if current_participant_id is null
     and not private.is_lecture_open(target_lecture_session_id) then
    return null;
  end if;

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

  return jsonb_set(
    snapshot_payload,
    '{current_participant_id}',
    coalesce(to_jsonb(current_participant_id), 'null'::jsonb),
    true
  );
end;
$$;

-- Replace public Definer RPCs with narrow Invoker wrappers. The only routines
-- exposed to authenticated clients accept no caller-supplied ownership ID.
drop function public.join_lecture_by_code(text);
create function public.join_lecture_by_code(lecture_code text)
returns table (
  lecture_session_id uuid,
  participant_id uuid,
  title text,
  starts_at timestamptz,
  ends_at timestamptz,
  status text
)
language sql
security invoker
set search_path = ''
as $$
  select * from private.join_lecture_by_code(lecture_code);
$$;

drop function public.get_lecture_session_state(uuid);
create function public.get_lecture_session_state(
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
security invoker
set search_path = ''
as $$
  select *
  from private.get_lecture_session_state(target_lecture_session_id);
$$;

drop function public.get_lecture_live_snapshot(
  uuid, uuid, bigint, bigint, bigint, bigint, bigint, timestamptz, uuid, integer
);
create function public.get_lecture_live_snapshot(
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
language sql
stable
security invoker
set search_path = ''
as $$
  select private.get_lecture_live_snapshot_for_current_user(
    target_lecture_session_id,
    known_state_version,
    known_comments_version,
    known_likes_version,
    known_polls_version,
    known_display_version,
    comment_cursor_created_at,
    comment_cursor_id,
    comment_limit
  );
$$;

-- Replace policies that trusted any existing participant UUID.
drop policy if exists "anonymous participants can join open lectures"
  on public.participants;
drop policy if exists "students can read visible comments in open lectures"
  on public.comments;
drop policy if exists "students can create visible comments in open lectures"
  on public.comments;
drop policy if exists "students can like visible comments in open lectures"
  on public.comment_likes;
drop policy if exists "students can read likes for visible comments in open lectures"
  on public.comment_likes;
drop policy if exists "students can read open polls"
  on public.polls;
drop policy if exists "students can read options for open polls"
  on public.poll_options;
drop policy if exists "students can submit responses to open polls"
  on public.poll_responses;
drop policy if exists "lecture_display_state_select"
  on public.lecture_display_state;
drop policy if exists "poll_result_refresh_events_select"
  on public.poll_result_refresh_events;

create policy "students can read their own participant"
on public.participants
for select
to authenticated
using (auth_user_id = (select auth.uid()));

create policy "students can read visible comments in open lectures"
on public.comments
for select
to authenticated
using (
  status = 'visible'
  and private.is_lecture_open(lecture_session_id)
);

create policy "students can create comments as their participant"
on public.comments
for insert
to authenticated
with check (
  status = 'visible'
  and is_pinned = false
  and private.is_lecture_open(lecture_session_id)
  and private.participant_is_owned(participant_id, lecture_session_id)
);

create policy "students can like as their participant"
on public.comment_likes
for insert
to authenticated
with check (
  private.is_lecture_open(lecture_session_id)
  and private.participant_is_owned(participant_id, lecture_session_id)
  and exists (
    select 1
    from public.comments as comment
    where comment.id = comment_likes.comment_id
      and comment.lecture_session_id = comment_likes.lecture_session_id
      and comment.status = 'visible'
  )
);

create policy "students can submit responses as their participant"
on public.poll_responses
for insert
to authenticated
with check (
  private.is_poll_open(poll_id, lecture_session_id)
  and private.participant_is_owned(participant_id, lecture_session_id)
);

create policy "authenticated clients can read active display compatibility state"
on public.lecture_display_state
for select
to authenticated
using (
  private.is_lecture_open(lecture_session_id)
  or exists (
    select 1
    from public.participants as participant
    where participant.lecture_session_id = lecture_display_state.lecture_session_id
      and participant.auth_user_id = (select auth.uid())
  )
);

-- Remove all inherited broad privileges, then grant only the operations used
-- by the browser. service_role grants from earlier migrations remain intact.
revoke all on all tables in schema public from public, anon, authenticated;
grant select on public.participants to authenticated;
grant select, insert on public.comments to authenticated;
grant insert on public.comment_likes to authenticated;
grant insert on public.poll_responses to authenticated;
grant select on public.lecture_display_state to authenticated;

revoke execute on all functions in schema public
  from public, anon, authenticated;
grant execute on function public.join_lecture_by_code(text)
  to authenticated;
grant execute on function public.get_lecture_session_state(uuid)
  to authenticated;
grant execute on function public.get_lecture_live_snapshot(
  uuid, bigint, bigint, bigint, bigint, bigint, timestamptz, uuid, integer
) to authenticated;

revoke all on schema private from public, anon, authenticated;
grant usage on schema private to authenticated;
revoke execute on all functions in schema private
  from public, anon, authenticated;
grant execute on function private.is_lecture_open(uuid)
  to authenticated;
grant execute on function private.participant_is_owned(uuid, uuid)
  to authenticated;
grant execute on function private.is_poll_open(uuid, uuid)
  to authenticated;
grant execute on function private.join_lecture_by_code(text)
  to authenticated;
grant execute on function private.get_lecture_session_state(uuid)
  to authenticated;
grant execute on function private.get_lecture_live_snapshot_for_current_user(
  uuid, bigint, bigint, bigint, bigint, bigint, timestamptz, uuid, integer
) to authenticated;

alter default privileges for role postgres in schema public
  revoke all on tables from public, anon, authenticated;
alter default privileges for role postgres in schema public
  revoke execute on functions from public, anon, authenticated;

-- The five-second versioned snapshot is now the only student live-sync path.
do $$
begin
  if exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'comments'
  ) then
    alter publication supabase_realtime drop table public.comments;
  end if;
end;
$$;
