alter table public.lecture_live_state
  add column pdf_document_id text null
  check (
    pdf_document_id is null
    or pdf_document_id ~ '^[a-z0-9][a-z0-9-]{0,63}$'
  );

create function public.admin_update_pdf_display(
  target_lecture_session_id uuid,
  target_pdf_document_id text,
  target_current_pdf_page integer,
  target_display_mode text
)
returns table (
  lecture_session_id uuid,
  pdf_document_id text,
  current_pdf_page integer,
  display_mode text,
  display_version bigint,
  state_version bigint,
  updated_at timestamptz
)
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if target_pdf_document_id is not null
     and target_pdf_document_id !~ '^[a-z0-9][a-z0-9-]{0,63}$' then
    raise exception 'Invalid PDF document ID.';
  end if;

  if target_current_pdf_page < 1 then
    raise exception 'PDF page must be greater than or equal to 1.';
  end if;

  if target_pdf_document_id is null and target_current_pdf_page <> 1 then
    raise exception 'A lecture without a PDF must remain on page 1.';
  end if;

  if target_display_mode not in ('normal', 'presentation', 'slideOnly') then
    raise exception 'Invalid display mode.';
  end if;

  return query
  update public.lecture_live_state as live
  set
    pdf_document_id = target_pdf_document_id,
    current_pdf_page = target_current_pdf_page,
    display_mode = target_display_mode,
    display_version = live.display_version + 1,
    state_version = live.state_version + 1,
    updated_at = now()
  where live.lecture_session_id = target_lecture_session_id
    and exists (
      select 1
      from public.lecture_sessions as lecture
      where lecture.id = target_lecture_session_id
        and lecture.status <> 'closed'
    )
    and (live.pdf_document_id, live.current_pdf_page, live.display_mode)
      is distinct from (
        target_pdf_document_id,
        target_current_pdf_page,
        target_display_mode
      )
  returning
    live.lecture_session_id,
    live.pdf_document_id,
    live.current_pdf_page,
    live.display_mode,
    live.display_version,
    live.state_version,
    live.updated_at;

  if found then
    return;
  end if;

  return query
  select
    live.lecture_session_id,
    live.pdf_document_id,
    live.current_pdf_page,
    live.display_mode,
    live.display_version,
    live.state_version,
    live.updated_at
  from public.lecture_live_state as live
  join public.lecture_sessions as lecture
    on lecture.id = live.lecture_session_id
  where live.lecture_session_id = target_lecture_session_id
    and lecture.status <> 'closed';
end;
$$;

revoke all on function public.admin_update_pdf_display(
  uuid, text, integer, text
) from public, anon, authenticated;
grant execute on function public.admin_update_pdf_display(
  uuid, text, integer, text
) to service_role;

alter function public.get_lecture_live_snapshot(
  uuid, uuid, bigint, bigint, bigint, bigint, bigint, timestamptz, uuid, integer
) rename to get_lecture_live_snapshot_core;

alter function public.get_lecture_live_snapshot_core(
  uuid, uuid, bigint, bigint, bigint, bigint, bigint, timestamptz, uuid, integer
) set schema private;

revoke all on function private.get_lecture_live_snapshot_core(
  uuid, uuid, bigint, bigint, bigint, bigint, bigint, timestamptz, uuid, integer
) from public, anon, authenticated, service_role;

create function public.get_lecture_live_snapshot(
  target_lecture_session_id uuid,
  target_participant_id uuid default null,
  known_state_version bigint default null,
  known_comments_version bigint default null,
  known_likes_version bigint default null,
  known_polls_version bigint default null,
  known_display_version bigint default null,
  comment_cursor_created_at timestamptz default null,
  comment_cursor_id uuid default null,
  comment_limit integer default 100
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  snapshot_payload jsonb;
  document_id text;
begin
  snapshot_payload := private.get_lecture_live_snapshot_core(
    target_lecture_session_id,
    target_participant_id,
    known_state_version,
    known_comments_version,
    known_likes_version,
    known_polls_version,
    known_display_version,
    comment_cursor_created_at,
    comment_cursor_id,
    comment_limit
  );

  if snapshot_payload is null then
    return null;
  end if;

  if jsonb_typeof(snapshot_payload -> 'display') = 'object' then
    select live.pdf_document_id
    into document_id
    from public.lecture_live_state as live
    where live.lecture_session_id = target_lecture_session_id;

    snapshot_payload := jsonb_set(
      snapshot_payload #- '{display,pdf_asset_id}',
      '{display,pdf_document_id}',
      coalesce(to_jsonb(document_id), 'null'::jsonb),
      true
    );
  end if;

  return snapshot_payload;
end;
$$;

revoke all on function public.get_lecture_live_snapshot(
  uuid, uuid, bigint, bigint, bigint, bigint, bigint, timestamptz, uuid, integer
) from public, anon, authenticated, service_role;
grant execute on function public.get_lecture_live_snapshot(
  uuid, uuid, bigint, bigint, bigint, bigint, bigint, timestamptz, uuid, integer
) to anon, authenticated;
