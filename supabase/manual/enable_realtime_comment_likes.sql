-- Phase 2-G manual SQL: enable Supabase Realtime for comment_likes.
--
-- Run manually in Supabase SQL Editor only if comment_likes INSERT events
-- do not arrive in other browser tabs after the frontend implementation.
-- This does not change RLS and does not grant SELECT/INSERT/DELETE.

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'comment_likes'
  ) then
    alter publication supabase_realtime add table public.comment_likes;
  end if;
end $$;
