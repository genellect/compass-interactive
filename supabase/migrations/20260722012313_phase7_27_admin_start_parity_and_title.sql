-- Phase 7.27 follow-up: keep the standard lecture lifecycle as the only start
-- path, while making rehearsal a faithful production-path proof. The only
-- intentional run-kind differences remain one-time production creation and
-- permanent post-lecture retention.

create function private.phase727_apply_canonical_lecture_title()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.lecture_sessions
  set title = 'Dual-targeting CasRx for C9orf72 ALS/FTD'
  where id = new.lecture_session_id
    and title is distinct from 'Dual-targeting CasRx for C9orf72 ALS/FTD';

  return new;
end;
$$;

revoke all on function private.phase727_apply_canonical_lecture_title()
from public, anon, authenticated, service_role;

create trigger phase727_apply_canonical_lecture_title
after insert on public.phase727_journal_club_runs
for each row execute function private.phase727_apply_canonical_lecture_title();

update public.lecture_sessions as lecture
set title = 'Dual-targeting CasRx for C9orf72 ALS/FTD'
from public.phase727_journal_club_runs as run
where run.lecture_session_id = lecture.id
  and lecture.title is distinct from 'Dual-targeting CasRx for C9orf72 ALS/FTD';

create or replace function private.phase727_guard_single_open_run()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_run public.phase727_journal_club_runs%rowtype;
begin
  if new.status <> 'open' or old.status = 'open' then
    return new;
  end if;

  select run.*
  into target_run
  from public.phase727_journal_club_runs as run
  where run.lecture_session_id = new.id;

  if not found then
    return new;
  end if;

  if not exists (
    select 1
    from public.lecture_pdf_documents as document
    where document.lecture_session_id = new.id
      and document.document_id = target_run.expected_document_id
      and document.document_version = target_run.expected_pdf_sha256
      and document.pdf_sha256 = target_run.expected_pdf_sha256
      and document.byte_size = target_run.expected_pdf_byte_size
      and document.page_count = target_run.expected_pdf_page_count
      and document.visible
      and document.retired_at is null
  ) then
    raise exception 'Journal Club PDF is not active'
      using errcode = '55000';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'phase727:open:' || target_run.event_key,
      0
    )
  );

  if exists (
    select 1
    from public.phase727_journal_club_runs as run
    join public.lecture_sessions as lecture
      on lecture.id = run.lecture_session_id
    where run.event_key = target_run.event_key
      and run.lecture_session_id <> new.id
      and lecture.status = 'open'
  ) then
    raise exception 'another Journal Club run is already open'
      using errcode = 'P0001';
  end if;

  return new;
end;
$$;

revoke all on function private.phase727_guard_single_open_run()
from public, anon, authenticated, service_role;

comment on function private.phase727_apply_canonical_lecture_title() is
  'Assigns the fixed public lecture title to every Phase 7.27 run.';

comment on function private.phase727_guard_single_open_run() is
  'Requires the exact active canonical PDF and serializes all Phase 7.27 starts, regardless of run kind.';
