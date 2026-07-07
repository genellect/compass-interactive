-- Manual repair SQL for the Phase 2 development lecture.
--
-- Cause of the participants RLS error:
-- The anonymous participant INSERT policy requires public.is_lecture_open().
-- The original seed set ends_at to now() + interval '2 hours', so the fixed
-- dev lecture can expire after a restart or the next day.
--
-- Run manually in Supabase SQL Editor. This updates only the fixed development
-- lecture row and does not change RLS policies, grants, participants, comments,
-- likes, polls, or poll responses.

update public.lecture_sessions
set
  status = 'open',
  starts_at = now() - interval '5 minutes',
  ends_at = now() + interval '30 days',
  updated_at = now()
where id = '11111111-1111-4111-8111-111111111111';
