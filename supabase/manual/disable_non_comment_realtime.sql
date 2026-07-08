-- Journal Club MVP manual SQL: keep only board comments on Supabase Realtime.
--
-- Purpose:
-- - Keep `comments` Realtime enabled for the anonymous board.
-- - Stop unnecessary Realtime streams for likes, poll result refresh events,
--   and display state.
-- - Stop the poll_result_refresh_events trigger so each poll response does not
--   create an extra realtime event row.
--
-- This SQL does not drop application tables and does not delete user data.
-- Run manually in Supabase SQL Editor after reviewing it.

do $$
begin
  if exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'comment_likes'
  ) then
    alter publication supabase_realtime drop table public.comment_likes;
  end if;

  if exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'poll_result_refresh_events'
  ) then
    alter publication supabase_realtime drop table public.poll_result_refresh_events;
  end if;

  if exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'lecture_display_state'
  ) then
    alter publication supabase_realtime drop table public.lecture_display_state;
  end if;
end $$;

drop trigger if exists emit_poll_result_refresh_event_after_insert
on public.poll_responses;

