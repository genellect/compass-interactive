-- Journal Club MVP manual SQL: lecture lifecycle support.
--
-- Purpose:
-- - Keep lecture_sessions closed to public SELECT.
-- - Store auto-issued lecture codes in an admin-only side table.
-- - Expose only minimal lecture status through an RPC so clients can stop sync
--   when a lecture is closed.
--
-- Run manually in Supabase SQL Editor.

create table if not exists public.lecture_admin_codes (
  lecture_session_id uuid primary key references public.lecture_sessions(id) on delete cascade,
  lecture_code text not null unique check (char_length(trim(lecture_code)) between 4 and 32),
  created_at timestamptz not null default now()
);

alter table public.lecture_admin_codes enable row level security;

grant select, insert, update, delete on public.lecture_admin_codes to service_role;
grant select, insert, update on public.lecture_sessions to service_role;

do $$
begin
  if to_regclass('public.lecture_display_state') is not null then
    grant select, insert, update on public.lecture_display_state to service_role;
  end if;
end $$;

create or replace function public.get_lecture_session_state(target_lecture_session_id uuid)
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

grant execute on function public.get_lecture_session_state(uuid)
to anon, authenticated;
