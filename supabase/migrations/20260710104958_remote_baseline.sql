-- COMPASS Interactive remote schema baseline.
--
-- The production project already had this application schema before migration
-- tracking was introduced. NEVER execute this baseline against that project.
-- Do not alter the production migration history as part of Milestone 0.
--
-- `public.rls_auto_enable()` / `ensure_rls` are intentionally excluded. They
-- are platform configuration owned by postgres, not application schema.

create extension if not exists pgcrypto with schema extensions;

create table public.lecture_sessions (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(title) between 1 and 200),
  code_hash text not null unique check (char_length(code_hash) >= 32),
  status text not null default 'draft' check (status in ('draft', 'open', 'closed')),
  starts_at timestamptz,
  ends_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at is null or starts_at is null or ends_at >= starts_at)
);

create table public.participants (
  id uuid primary key default gen_random_uuid(),
  lecture_session_id uuid not null references public.lecture_sessions(id) on delete cascade,
  participant_key text not null check (char_length(participant_key) between 8 and 128),
  joined_at timestamptz not null default now(),
  last_seen_at timestamptz,
  unique (lecture_session_id, participant_key),
  unique (id, lecture_session_id)
);

create table public.comments (
  id uuid primary key default gen_random_uuid(),
  lecture_session_id uuid not null references public.lecture_sessions(id) on delete cascade,
  participant_id uuid not null,
  body text not null check (char_length(body) between 1 and 120),
  status text not null default 'visible' check (status in ('visible', 'hidden', 'deleted')),
  is_pinned boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (participant_id, lecture_session_id)
    references public.participants(id, lecture_session_id)
    on delete cascade,
  unique (id, lecture_session_id)
);

create table public.comment_likes (
  id uuid primary key default gen_random_uuid(),
  lecture_session_id uuid not null references public.lecture_sessions(id) on delete cascade,
  comment_id uuid not null,
  participant_id uuid not null,
  created_at timestamptz not null default now(),
  foreign key (comment_id, lecture_session_id)
    references public.comments(id, lecture_session_id)
    on delete cascade,
  foreign key (participant_id, lecture_session_id)
    references public.participants(id, lecture_session_id)
    on delete cascade,
  unique (comment_id, participant_id)
);

create table public.polls (
  id uuid primary key default gen_random_uuid(),
  lecture_session_id uuid not null references public.lecture_sessions(id) on delete cascade,
  question text not null check (char_length(question) between 1 and 300),
  type text not null check (type in ('single', 'multiple')),
  status text not null default 'draft' check (status in ('draft', 'open', 'closed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, lecture_session_id)
);

create table public.poll_options (
  id uuid primary key default gen_random_uuid(),
  lecture_session_id uuid not null references public.lecture_sessions(id) on delete cascade,
  poll_id uuid not null,
  label text not null check (char_length(label) between 1 and 200),
  display_order integer not null check (display_order > 0),
  created_at timestamptz not null default now(),
  foreign key (poll_id, lecture_session_id)
    references public.polls(id, lecture_session_id)
    on delete cascade,
  unique (poll_id, display_order),
  unique (id, poll_id)
);

create table public.poll_responses (
  id uuid primary key default gen_random_uuid(),
  lecture_session_id uuid not null references public.lecture_sessions(id) on delete cascade,
  poll_id uuid not null,
  participant_id uuid not null,
  option_ids uuid[] not null check (cardinality(option_ids) > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (poll_id, lecture_session_id)
    references public.polls(id, lecture_session_id)
    on delete cascade,
  foreign key (participant_id, lecture_session_id)
    references public.participants(id, lecture_session_id)
    on delete cascade,
  unique (poll_id, participant_id)
);

create table public.lecture_display_state (
  lecture_session_id uuid primary key references public.lecture_sessions(id) on delete cascade,
  current_pdf_page integer not null default 1 check (current_pdf_page >= 1),
  display_mode text not null default 'normal'
    check (display_mode in ('normal', 'presentation', 'slideOnly')),
  updated_at timestamptz not null default now()
);

create table public.poll_result_refresh_events (
  id uuid primary key default gen_random_uuid(),
  lecture_session_id uuid not null references public.lecture_sessions(id) on delete cascade,
  poll_id uuid not null references public.polls(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table public.lecture_admin_codes (
  lecture_session_id uuid primary key references public.lecture_sessions(id) on delete cascade,
  lecture_code text not null unique check (char_length(trim(lecture_code)) between 4 and 32),
  created_at timestamptz not null default now()
);

create index lecture_sessions_status_time_idx
  on public.lecture_sessions (status, starts_at, ends_at);
create index participants_lecture_idx
  on public.participants (lecture_session_id, joined_at);
create index comments_lecture_created_idx
  on public.comments (lecture_session_id, created_at desc);
create index comments_lecture_status_created_idx
  on public.comments (lecture_session_id, status, created_at desc);
create index comments_lecture_pinned_likes_idx
  on public.comments (lecture_session_id, status, is_pinned desc, created_at desc);
create index comment_likes_participant_idx
  on public.comment_likes (participant_id, created_at desc);
create index polls_lecture_status_idx
  on public.polls (lecture_session_id, status, created_at desc);
create index poll_options_poll_order_idx
  on public.poll_options (poll_id, display_order);
create index poll_responses_poll_idx
  on public.poll_responses (poll_id, created_at desc);
create index poll_responses_participant_idx
  on public.poll_responses (participant_id, created_at desc);

create function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create function public.validate_poll_response_option_ids()
returns trigger
language plpgsql
as $$
declare
  target_poll_type text;
  valid_option_count integer;
  distinct_option_count integer;
begin
  select p.type
    into target_poll_type
  from public.polls p
  where p.id = new.poll_id
    and p.lecture_session_id = new.lecture_session_id;

  if target_poll_type is null then
    raise exception 'poll_responses.poll_id does not belong to lecture_session_id';
  end if;

  select count(distinct option_id)
    into distinct_option_count
  from unnest(new.option_ids) as option_id;

  if distinct_option_count <> cardinality(new.option_ids) then
    raise exception 'poll_responses.option_ids contains duplicate options';
  end if;

  if target_poll_type = 'single' and cardinality(new.option_ids) <> 1 then
    raise exception 'single choice poll responses must contain exactly one option';
  end if;

  select count(*)
    into valid_option_count
  from public.poll_options po
  where po.poll_id = new.poll_id
    and po.lecture_session_id = new.lecture_session_id
    and po.id = any(new.option_ids);

  if valid_option_count <> cardinality(new.option_ids) then
    raise exception 'poll_responses.option_ids contains an option outside the poll';
  end if;

  return new;
end;
$$;

create function public.is_lecture_open(target_lecture_session_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.lecture_sessions ls
    where ls.id = target_lecture_session_id
      and ls.status = 'open'
      and (ls.starts_at is null or ls.starts_at <= now())
      and (ls.ends_at is null or ls.ends_at >= now())
  );
$$;

create function public.participant_belongs_to_lecture(
  target_participant_id uuid,
  target_lecture_session_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.participants p
    where p.id = target_participant_id
      and p.lecture_session_id = target_lecture_session_id
  );
$$;

create function public.is_poll_open(target_poll_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.polls p
    where p.id = target_poll_id
      and p.status = 'open'
      and public.is_lecture_open(p.lecture_session_id)
  );
$$;

create function public.emit_poll_result_refresh_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.poll_result_refresh_events (lecture_session_id, poll_id)
  values (new.lecture_session_id, new.poll_id);
  return new;
end;
$$;

create function public.join_lecture_by_code(lecture_code text)
returns table (
  lecture_session_id uuid,
  title text,
  starts_at timestamptz,
  ends_at timestamptz,
  status text
)
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  normalized_code text;
  hashed_code text;
  matched_lecture record;
begin
  normalized_code := upper(trim(coalesce(lecture_code, '')));
  if normalized_code = '' then
    raise exception 'lecture code is empty' using errcode = 'P0001';
  end if;

  hashed_code := encode(
    extensions.digest(convert_to(normalized_code, 'UTF8'), 'sha256'),
    'hex'
  );

  select ls.id, ls.title, ls.starts_at, ls.ends_at, ls.status
    into matched_lecture
  from public.lecture_sessions ls
  where ls.code_hash = hashed_code
  limit 1;

  if not found then
    raise exception 'lecture code not found' using errcode = 'P0001';
  end if;
  if matched_lecture.status <> 'open' then
    raise exception 'lecture is not open' using errcode = 'P0001';
  end if;
  if matched_lecture.starts_at is not null and matched_lecture.starts_at > now() then
    raise exception 'lecture is not open yet' using errcode = 'P0001';
  end if;
  if matched_lecture.ends_at is not null and matched_lecture.ends_at < now() then
    raise exception 'lecture has expired' using errcode = 'P0001';
  end if;

  return query
  select
    matched_lecture.id::uuid,
    matched_lecture.title::text,
    matched_lecture.starts_at::timestamptz,
    matched_lecture.ends_at::timestamptz,
    matched_lecture.status::text;
end;
$$;

create function public.get_lecture_session_state(target_lecture_session_id uuid)
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
set search_path = public
as $$
  select
    ls.id as lecture_session_id,
    ls.title,
    ls.starts_at,
    ls.ends_at,
    ls.status
  from public.lecture_sessions ls
  where ls.id = target_lecture_session_id
  limit 1;
$$;

create function public.get_open_poll_results(target_lecture_session_id uuid)
returns table (poll_id uuid, option_id uuid, response_count bigint)
language sql
stable
security definer
set search_path = public
as $$
  select
    po.poll_id,
    po.id as option_id,
    count(selected_options.option_id)::bigint as response_count
  from public.poll_options po
  join public.polls p
    on p.id = po.poll_id
   and p.lecture_session_id = po.lecture_session_id
  left join (
    select pr.poll_id, unnest(pr.option_ids) as option_id
    from public.poll_responses pr
    where pr.lecture_session_id = target_lecture_session_id
  ) selected_options
    on selected_options.poll_id = po.poll_id
   and selected_options.option_id = po.id
  where po.lecture_session_id = target_lecture_session_id
    and p.status = 'open'
    and public.is_lecture_open(p.lecture_session_id)
  group by po.poll_id, po.id, po.display_order
  order by po.poll_id, po.display_order;
$$;

create trigger set_lecture_sessions_updated_at
before update on public.lecture_sessions
for each row execute function public.set_updated_at();
create trigger set_comments_updated_at
before update on public.comments
for each row execute function public.set_updated_at();
create trigger set_polls_updated_at
before update on public.polls
for each row execute function public.set_updated_at();
create trigger set_poll_responses_updated_at
before update on public.poll_responses
for each row execute function public.set_updated_at();
create trigger validate_poll_response_options
before insert or update on public.poll_responses
for each row execute function public.validate_poll_response_option_ids();

alter table public.lecture_sessions enable row level security;
alter table public.participants enable row level security;
alter table public.comments enable row level security;
alter table public.comment_likes enable row level security;
alter table public.polls enable row level security;
alter table public.poll_options enable row level security;
alter table public.poll_responses enable row level security;
alter table public.lecture_display_state enable row level security;
alter table public.poll_result_refresh_events enable row level security;
alter table public.lecture_admin_codes enable row level security;

create policy "anonymous participants can join open lectures"
on public.participants for insert to anon, authenticated
with check (public.is_lecture_open(lecture_session_id));

create policy "students can read visible comments in open lectures"
on public.comments for select to anon, authenticated
using (status = 'visible' and public.is_lecture_open(lecture_session_id));

create policy "students can create visible comments in open lectures"
on public.comments for insert to anon, authenticated
with check (
  status = 'visible'
  and is_pinned = false
  and public.is_lecture_open(lecture_session_id)
  and public.participant_belongs_to_lecture(participant_id, lecture_session_id)
);

create policy "students can like visible comments in open lectures"
on public.comment_likes for insert to anon, authenticated
with check (
  public.is_lecture_open(lecture_session_id)
  and public.participant_belongs_to_lecture(participant_id, lecture_session_id)
  and exists (
    select 1 from public.comments c
    where c.id = comment_likes.comment_id
      and c.lecture_session_id = lecture_session_id
      and c.status = 'visible'
  )
);

create policy "students can read likes for visible comments in open lectures"
on public.comment_likes for select to anon, authenticated
using (
  public.is_lecture_open(lecture_session_id)
  and exists (
    select 1 from public.comments c
    where c.id = comment_likes.comment_id
      and c.lecture_session_id = comment_likes.lecture_session_id
      and c.status = 'visible'
  )
);

create policy "students can read open polls"
on public.polls for select to anon, authenticated
using (status = 'open' and public.is_lecture_open(lecture_session_id));

create policy "students can read options for open polls"
on public.poll_options for select to anon, authenticated
using (
  exists (
    select 1 from public.polls p
    where p.id = poll_options.poll_id
      and p.lecture_session_id = lecture_session_id
      and p.status = 'open'
      and public.is_lecture_open(p.lecture_session_id)
  )
);

create policy "students can submit responses to open polls"
on public.poll_responses for insert to anon, authenticated
with check (
  public.is_poll_open(poll_id)
  and public.participant_belongs_to_lecture(participant_id, lecture_session_id)
);

create policy "lecture_display_state_select"
on public.lecture_display_state for select to anon, authenticated
using (true);

create policy "poll_result_refresh_events_select"
on public.poll_result_refresh_events for select to anon, authenticated
using (public.is_lecture_open(lecture_session_id));

revoke select, insert, update, delete on all tables in schema public
  from anon, authenticated, service_role;
grant truncate, references, trigger, maintain on all tables in schema public
  to anon, authenticated, service_role;
grant insert on public.participants to anon, authenticated;
grant select, insert on public.comments to anon, authenticated;
grant select, insert on public.comment_likes to anon, authenticated;
grant select on public.polls, public.poll_options to anon, authenticated;
grant insert on public.poll_responses to anon, authenticated;
grant select on public.lecture_display_state to anon, authenticated;
grant select on public.poll_result_refresh_events to anon, authenticated;

grant select, insert, update on public.lecture_sessions to service_role;
grant select, insert, update, delete on public.lecture_admin_codes to service_role;
grant select, insert, update on public.lecture_display_state to service_role;
grant insert on public.poll_result_refresh_events to service_role;

grant execute on function public.join_lecture_by_code(text) to anon, authenticated;
grant execute on function public.get_lecture_session_state(uuid) to anon, authenticated;
grant execute on function public.get_open_poll_results(uuid) to anon, authenticated;
grant execute on function public.is_lecture_open(uuid) to anon, authenticated;
grant execute on function public.participant_belongs_to_lecture(uuid, uuid)
  to anon, authenticated;
grant execute on function public.is_poll_open(uuid) to anon, authenticated;

-- New Supabase projects add explicit routine grants through default
-- privileges. Remove those extras so the reconstructed ACLs match the remote
-- schema captured for this baseline. PUBLIC's PostgreSQL default EXECUTE grant
-- remains unchanged, so effective privileges are identical to the remote.
revoke execute on function public.emit_poll_result_refresh_event()
  from anon, authenticated, service_role;
revoke execute on function public.set_updated_at()
  from anon, authenticated, service_role;
revoke execute on function public.validate_poll_response_option_ids()
  from anon, authenticated, service_role;
revoke execute on function public.join_lecture_by_code(text) from service_role;
revoke execute on function public.get_lecture_session_state(uuid) from service_role;
revoke execute on function public.get_open_poll_results(uuid) from service_role;
revoke execute on function public.is_lecture_open(uuid) from service_role;
revoke execute on function public.participant_belongs_to_lecture(uuid, uuid)
  from service_role;
revoke execute on function public.is_poll_open(uuid) from service_role;

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'comments'
  ) then
    alter publication supabase_realtime add table public.comments;
  end if;
end;
$$;
