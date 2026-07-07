-- COMPASS Interactive initial Supabase schema draft.
-- Phase 2-B only: review this SQL before running it in Supabase SQL Editor.
-- This file intentionally does not create admin authentication, realtime subscriptions,
-- Google integrations, seed data, or frontend repository implementations.

create extension if not exists pgcrypto;

-- Shared updated_at trigger helper.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists public.lecture_sessions (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(title) between 1 and 200),
  -- Store a hash of the lecture code, never the plain lecture code.
  code_hash text not null unique check (char_length(code_hash) >= 32),
  status text not null default 'draft' check (status in ('draft', 'open', 'closed')),
  starts_at timestamptz,
  ends_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at is null or starts_at is null or ends_at >= starts_at)
);

create table if not exists public.participants (
  id uuid primary key default gen_random_uuid(),
  lecture_session_id uuid not null references public.lecture_sessions(id) on delete cascade,
  -- Anonymous browser-side participant key. No name, student ID, or email is stored.
  participant_key text not null check (char_length(participant_key) between 8 and 128),
  joined_at timestamptz not null default now(),
  last_seen_at timestamptz,
  unique (lecture_session_id, participant_key),
  unique (id, lecture_session_id)
);

create table if not exists public.comments (
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

create table if not exists public.comment_likes (
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

create table if not exists public.polls (
  id uuid primary key default gen_random_uuid(),
  lecture_session_id uuid not null references public.lecture_sessions(id) on delete cascade,
  question text not null check (char_length(question) between 1 and 300),
  type text not null check (type in ('single', 'multiple')),
  status text not null default 'draft' check (status in ('draft', 'open', 'closed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, lecture_session_id)
);

create table if not exists public.poll_options (
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

create table if not exists public.poll_responses (
  id uuid primary key default gen_random_uuid(),
  lecture_session_id uuid not null references public.lecture_sessions(id) on delete cascade,
  poll_id uuid not null,
  participant_id uuid not null,
  -- uuid[] keeps this MVP to 7 tables. A later normalized poll_response_options
  -- table can be introduced if analytics become more complex.
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

create or replace function public.validate_poll_response_option_ids()
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

-- Indexes for lecture-scoped reads, display ordering, moderation, and aggregation.
create index if not exists lecture_sessions_status_time_idx
  on public.lecture_sessions (status, starts_at, ends_at);

create index if not exists participants_lecture_idx
  on public.participants (lecture_session_id, joined_at);

create index if not exists comments_lecture_created_idx
  on public.comments (lecture_session_id, created_at desc);

create index if not exists comments_lecture_status_created_idx
  on public.comments (lecture_session_id, status, created_at desc);

create index if not exists comments_lecture_pinned_likes_idx
  on public.comments (lecture_session_id, status, is_pinned desc, created_at desc);

create index if not exists comment_likes_participant_idx
  on public.comment_likes (participant_id, created_at desc);

create index if not exists polls_lecture_status_idx
  on public.polls (lecture_session_id, status, created_at desc);

create index if not exists poll_options_poll_order_idx
  on public.poll_options (poll_id, display_order);

create index if not exists poll_responses_poll_idx
  on public.poll_responses (poll_id, created_at desc);

create index if not exists poll_responses_participant_idx
  on public.poll_responses (participant_id, created_at desc);

-- Helper functions used by RLS policies. These expose only boolean checks.
create or replace function public.is_lecture_open(target_lecture_session_id uuid)
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

create or replace function public.participant_belongs_to_lecture(
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

create or replace function public.is_poll_open(target_poll_id uuid)
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

grant execute on function public.is_lecture_open(uuid) to anon, authenticated;
grant execute on function public.participant_belongs_to_lecture(uuid, uuid) to anon, authenticated;
grant execute on function public.is_poll_open(uuid) to anon, authenticated;

alter table public.lecture_sessions enable row level security;
alter table public.participants enable row level security;
alter table public.comments enable row level security;
alter table public.comment_likes enable row level security;
alter table public.polls enable row level security;
alter table public.poll_options enable row level security;
alter table public.poll_responses enable row level security;

-- Frontend grants are intentionally narrow. RLS still applies.
-- Important review note:
-- Direct anonymous writes can validate lecture status and row relationships,
-- but they do not cryptographically prove that a browser owns a participant_id.
-- Before production, consider Supabase anonymous auth or SECURITY DEFINER RPCs
-- that verify a private participant token without exposing it in readable rows.
grant usage on schema public to anon, authenticated;
grant insert on public.participants to anon, authenticated;
grant select, insert on public.comments to anon, authenticated;
grant insert on public.comment_likes to anon, authenticated;
grant select on public.polls to anon, authenticated;
grant select on public.poll_options to anon, authenticated;
grant insert on public.poll_responses to anon, authenticated;

-- No public SELECT policy is added for lecture_sessions because code_hash is stored
-- on the table. A later Phase should expose safe lecture metadata through an RPC
-- or view that does not include code_hash.

create policy "anonymous participants can join open lectures"
on public.participants
for insert
to anon, authenticated
with check (
  public.is_lecture_open(lecture_session_id)
);

-- Phase 2-D review note:
-- No public SELECT policy is provided for participants. A frontend can either
-- generate a UUID client-side and insert it as participants.id, or a later
-- SECURITY DEFINER RPC can create and return the participant row safely.
-- Avoid opening broad participant SELECT until participant ownership is defined.

create policy "students can read visible comments in open lectures"
on public.comments
for select
to anon, authenticated
using (
  status = 'visible'
  and public.is_lecture_open(lecture_session_id)
);

create policy "students can create visible comments in open lectures"
on public.comments
for insert
to anon, authenticated
with check (
  status = 'visible'
  and is_pinned = false
  and public.is_lecture_open(lecture_session_id)
  and public.participant_belongs_to_lecture(participant_id, lecture_session_id)
);

-- Phase 2-D minimum viable backend path for comments:
-- 1. Create one open seed lecture manually.
-- 2. Insert an anonymous participant for that lecture.
-- 3. Read visible comments through the SELECT policy above.
-- 4. Insert visible, unpinned comments through this INSERT policy.
-- Comment moderation remains blocked until admin auth and admin RLS exist.

create policy "students can like visible comments in open lectures"
on public.comment_likes
for insert
to anon, authenticated
with check (
  public.is_lecture_open(lecture_session_id)
  and public.participant_belongs_to_lecture(participant_id, lecture_session_id)
  and exists (
    select 1
    from public.comments c
    where c.id = comment_id
      and c.lecture_session_id = lecture_session_id
      and c.status = 'visible'
  )
);

-- Deleting likes is intentionally blocked until participant-bound auth or
-- a safe RPC exists. Without that, anonymous clients could delete others' likes.

create policy "students can read open polls"
on public.polls
for select
to anon, authenticated
using (
  status = 'open'
  and public.is_lecture_open(lecture_session_id)
);

create policy "students can read options for open polls"
on public.poll_options
for select
to anon, authenticated
using (
  exists (
    select 1
    from public.polls p
    where p.id = poll_id
      and p.lecture_session_id = lecture_session_id
      and p.status = 'open'
      and public.is_lecture_open(p.lecture_session_id)
  )
);

create policy "students can submit responses to open polls"
on public.poll_responses
for insert
to anon, authenticated
with check (
  public.is_poll_open(poll_id)
  and public.participant_belongs_to_lecture(participant_id, lecture_session_id)
);

-- Admin operations are intentionally blocked by the absence of UPDATE/DELETE
-- grants and policies. Add admin-authenticated policies in a later phase for:
-- lecture creation, poll creation, comment moderation, pinning, and dashboard reads.
