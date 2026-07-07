-- Phase 2-G manual SQL: enable narrowly scoped SELECT for comment_likes.
--
-- Purpose:
-- - Allow the browser client to count likes for visible comments.
-- - Keep hidden/deleted comments' likes unreadable to student/display clients.
-- - Keep participants unreadable; this policy does not grant SELECT on participants.
--
-- Run this manually in the Supabase SQL Editor after reviewing it.
-- Do not run it automatically from the frontend or local scripts.

grant select on public.comment_likes to anon, authenticated;

drop policy if exists "students can read likes for visible comments in open lectures"
on public.comment_likes;

create policy "students can read likes for visible comments in open lectures"
on public.comment_likes
for select
to anon, authenticated
using (
  public.is_lecture_open(comment_likes.lecture_session_id)
  and exists (
    select 1
    from public.comments c
    where c.id = comment_likes.comment_id
      and c.lecture_session_id = comment_likes.lecture_session_id
      and c.status = 'visible'
  )
);
