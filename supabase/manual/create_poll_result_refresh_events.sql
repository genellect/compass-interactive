-- Journal Club MVP manual SQL: realtime poll result refresh events.
--
-- Purpose:
--   Let frontend clients refresh aggregate poll results in realtime without
--   granting SELECT on raw poll_responses.
--
-- Flow:
--   1. A student inserts a poll_responses row.
--   2. A trigger inserts a minimal event into poll_result_refresh_events.
--   3. Frontend receives the event and calls get_open_poll_results().
--
-- Run manually in Supabase SQL Editor after the main schema and
-- create_poll_results_rpc.sql have been applied.

create table if not exists public.poll_result_refresh_events (
  id uuid primary key default gen_random_uuid(),
  lecture_session_id uuid not null references public.lecture_sessions(id) on delete cascade,
  poll_id uuid not null references public.polls(id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.poll_result_refresh_events enable row level security;

grant select on public.poll_result_refresh_events to anon, authenticated;
grant insert on public.poll_result_refresh_events to service_role;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'poll_result_refresh_events'
      and policyname = 'poll_result_refresh_events_select'
  ) then
    create policy "poll_result_refresh_events_select"
    on public.poll_result_refresh_events
    for select
    to anon, authenticated
    using (public.is_lecture_open(lecture_session_id));
  end if;
end $$;

create or replace function public.emit_poll_result_refresh_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.poll_result_refresh_events (
    lecture_session_id,
    poll_id
  )
  values (
    new.lecture_session_id,
    new.poll_id
  );

  return new;
end;
$$;

do $$
begin
  if not exists (
    select 1
    from pg_trigger
    where tgname = 'emit_poll_result_refresh_event_after_insert'
  ) then
    create trigger emit_poll_result_refresh_event_after_insert
    after insert on public.poll_responses
    for each row
    execute function public.emit_poll_result_refresh_event();
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'poll_result_refresh_events'
  ) then
    alter publication supabase_realtime add table public.poll_result_refresh_events;
  end if;
end $$;
