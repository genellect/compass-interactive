-- Journal Club MVP display-state seed.
-- Run manually after supabase/manual/create_lecture_display_state.sql.
-- This seed assumes the existing Journal Club lecture id used by the MVP.

insert into public.lecture_display_state (
  lecture_session_id,
  current_pdf_page,
  display_mode
)
values (
  '11111111-1111-4111-8111-111111111111',
  1,
  'normal'
)
on conflict (lecture_session_id)
do update set
  current_pdf_page = excluded.current_pdf_page,
  display_mode = excluded.display_mode,
  updated_at = now();
