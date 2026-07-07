-- Journal Club MVP manual SQL.
-- Purpose:
--   Store the display state for each lecture session.
--   Display clients may read and subscribe to this table.
--   Admin writes should go through the update-display-state Edge Function.
--
-- Run manually in Supabase SQL Editor.
-- Do not put service_role keys, database passwords, or Admin PINs in frontend code.

create table if not exists public.lecture_display_state (
  lecture_session_id uuid primary key references public.lecture_sessions(id) on delete cascade,
  current_pdf_page integer not null default 1 check (current_pdf_page >= 1),
  display_mode text not null default 'normal' check (display_mode in ('normal', 'presentation', 'slideOnly')),
  updated_at timestamptz not null default now()
);

alter table public.lecture_display_state enable row level security;

grant select on public.lecture_display_state to anon, authenticated;
grant select, insert, update on public.lecture_display_state to service_role;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'lecture_display_state'
      and policyname = 'lecture_display_state_select'
  ) then
    create policy "lecture_display_state_select"
    on public.lecture_display_state
    for select
    to anon, authenticated
    using (true);
  end if;
end $$;

-- Intentionally do not grant INSERT / UPDATE / DELETE to anon.
-- Admin mutation belongs in an Edge Function or reviewed SECURITY DEFINER RPC.

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'lecture_display_state'
  ) then
    alter publication supabase_realtime add table public.lecture_display_state;
  end if;
end $$;
