-- Phase 3: private PDF delivery metadata and authorization contracts.
-- PDF bytes and extracted text never enter Supabase.

alter table public.lecture_sessions
  add column pdf_public_id uuid not null default gen_random_uuid(),
  add column pdf_access_version bigint not null default 1
    check (pdf_access_version >= 1);

alter table public.lecture_sessions
  add constraint lecture_sessions_pdf_public_id_key unique (pdf_public_id);

alter table public.lecture_live_state
  add column pdf_document_version text,
  add column pdf_manifest_version bigint not null default 0
    check (pdf_manifest_version >= 0),
  add column pdf_page_count integer
    check (pdf_page_count between 1 and 75),
  add column pdf_visible boolean not null default false;

update public.lecture_live_state
set
  pdf_page_count = case pdf_document_id
    when 'why-learn-english-v1' then 15
    when 'm4-sample-v1' then 3
    else null
  end,
  pdf_visible = pdf_document_id is not null;

alter table public.lecture_live_state
  add constraint lecture_live_state_pdf_delivery_consistency_check check (
    (
      pdf_document_id is null
      and pdf_document_version is null
      and pdf_manifest_version = 0
      and pdf_page_count is null
      and not pdf_visible
    )
    or (
      pdf_document_id is not null
      and current_pdf_page >= 1
      and (pdf_page_count is null or current_pdf_page <= pdf_page_count)
    )
  ),
  add constraint lecture_live_state_pdf_document_version_check check (
    pdf_document_version is null
    or pdf_document_version ~ '^[0-9a-f]{64}$'
  );

create table public.lecture_pdf_documents (
  lecture_session_id uuid not null
    references public.lecture_sessions(id) on delete restrict,
  document_id text not null
    check (document_id ~ '^[a-z0-9][a-z0-9-]{0,63}$'),
  document_version text not null
    check (document_version ~ '^[0-9a-f]{64}$'),
  manifest_version bigint not null check (manifest_version >= 1),
  display_name text not null
    check (
      char_length(display_name) between 1 and 160
      and display_name !~ '[[:cntrl:]]'
    ),
  page_count integer not null check (page_count between 1 and 75),
  byte_size bigint not null check (byte_size between 1 and 15728640),
  text_char_count integer not null check (text_char_count between 1 and 20000),
  pdf_sha256 text not null check (pdf_sha256 ~ '^[0-9a-f]{64}$'),
  text_sha256 text not null check (text_sha256 ~ '^[0-9a-f]{64}$'),
  download_enabled boolean not null default true,
  visible boolean not null default true,
  published_at timestamptz not null default statement_timestamp(),
  archive_expires_at timestamptz,
  delete_after timestamptz,
  retired_at timestamptz,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  primary key (lecture_session_id, document_id, document_version),
  check (pdf_sha256 = document_version),
  check (
    (archive_expires_at is null and delete_after is null)
    or delete_after = archive_expires_at + interval '7 days'
  ),
  check ((visible and retired_at is null) or not visible)
);

create unique index lecture_pdf_documents_one_visible_document_version_idx
  on public.lecture_pdf_documents (lecture_session_id, document_id)
  where visible;

create index lecture_pdf_documents_manifest_lookup_idx
  on public.lecture_pdf_documents (
    lecture_session_id,
    manifest_version desc,
    document_id
  )
  where visible;

create index lecture_pdf_documents_cleanup_idx
  on public.lecture_pdf_documents (delete_after, lecture_session_id)
  where delete_after is not null and retired_at is null;

alter table public.lecture_pdf_documents enable row level security;
revoke all on public.lecture_pdf_documents from public, anon, authenticated;
grant select, insert, update on public.lecture_pdf_documents to service_role;

create function private.sync_pdf_retention_from_lecture()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'closed'
     and new.archive_expires_at is not null
     and (
       old.status is distinct from new.status
       or old.archive_expires_at is distinct from new.archive_expires_at
     ) then
    update public.lecture_pdf_documents as document
    set
      archive_expires_at = new.archive_expires_at,
      delete_after = new.archive_expires_at + interval '7 days',
      updated_at = statement_timestamp()
    where document.lecture_session_id = new.id
      and (
        document.archive_expires_at,
        document.delete_after
      ) is distinct from (
        new.archive_expires_at,
        new.archive_expires_at + interval '7 days'
      );
  end if;

  return new;
end;
$$;

revoke all on function private.sync_pdf_retention_from_lecture() from public;

create trigger lecture_sessions_sync_pdf_retention
after update of status, archive_expires_at on public.lecture_sessions
for each row execute function private.sync_pdf_retention_from_lecture();

create function public.admin_register_pdf_document(
  target_lecture_session_id uuid,
  target_document_id text,
  target_document_version text,
  target_manifest_version bigint,
  target_display_name text,
  target_page_count integer,
  target_byte_size bigint,
  target_text_char_count integer,
  target_pdf_sha256 text,
  target_text_sha256 text,
  target_download_enabled boolean default true
)
returns public.lecture_pdf_documents
language plpgsql
security invoker
set search_path = ''
as $$
declare
  lecture_row public.lecture_sessions%rowtype;
  existing_row public.lecture_pdf_documents%rowtype;
  registered_row public.lecture_pdf_documents%rowtype;
  other_bytes bigint;
  other_pages bigint;
  other_characters bigint;
  greatest_manifest_version bigint;
begin
  if target_lecture_session_id is null
     or target_document_id is null
     or target_document_version is null
     or target_manifest_version is null
     or target_display_name is null
     or target_page_count is null
     or target_byte_size is null
     or target_text_char_count is null
     or target_pdf_sha256 is null
     or target_text_sha256 is null
     or target_download_enabled is null
     or target_document_id !~ '^[a-z0-9][a-z0-9-]{0,63}$'
     or target_document_version !~ '^[0-9a-f]{64}$'
     or target_pdf_sha256 <> target_document_version
     or target_text_sha256 !~ '^[0-9a-f]{64}$'
     or target_manifest_version < 1
     or target_page_count not between 1 and 75
     or target_byte_size not between 1 and 15728640
     or target_text_char_count not between 1 and 20000
     or char_length(trim(target_display_name)) not between 1 and 160
     or target_display_name ~ '[[:cntrl:]]' then
    raise exception 'Invalid PDF publication metadata.' using errcode = '22023';
  end if;

  select lecture.*
  into lecture_row
  from public.lecture_sessions as lecture
  where lecture.id = target_lecture_session_id
  for update;

  if not found or not (
    lecture_row.status = 'draft'
    or private.is_lecture_open(lecture_row.id)
  ) then
    raise exception 'PDF publication is unavailable for this lecture.'
      using errcode = 'P0001';
  end if;

  select document.*
  into existing_row
  from public.lecture_pdf_documents as document
  where document.lecture_session_id = target_lecture_session_id
    and document.document_id = target_document_id
    and document.document_version = target_document_version
  for update;

  if found then
    if (
      existing_row.display_name,
      existing_row.page_count,
      existing_row.byte_size,
      existing_row.text_char_count,
      existing_row.pdf_sha256,
      existing_row.text_sha256
    ) is distinct from (
      trim(target_display_name),
      target_page_count,
      target_byte_size,
      target_text_char_count,
      target_pdf_sha256,
      target_text_sha256
    ) then
      raise exception 'Immutable PDF metadata does not match.'
        using errcode = '23514';
    end if;
  end if;

  select coalesce(max(document.manifest_version), 0)
  into greatest_manifest_version
  from public.lecture_pdf_documents as document
  where document.lecture_session_id = target_lecture_session_id;

  if existing_row.lecture_session_id is null
     and target_manifest_version < greatest_manifest_version then
    raise exception 'PDF manifest version is stale.' using errcode = '40001';
  end if;

  select
    coalesce(sum(document.byte_size), 0),
    coalesce(sum(document.page_count), 0),
    coalesce(sum(document.text_char_count), 0)
  into other_bytes, other_pages, other_characters
  from public.lecture_pdf_documents as document
  where document.lecture_session_id = target_lecture_session_id
    and document.visible
    and document.document_id <> target_document_id;

  if other_bytes + target_byte_size > 15728640
     or other_pages + target_page_count > 75
     or other_characters + target_text_char_count > 20000 then
    raise exception 'Lecture PDF aggregate limit exceeded.'
      using errcode = '22023';
  end if;

  update public.lecture_pdf_documents as document
  set
    visible = false,
    retired_at = coalesce(document.retired_at, statement_timestamp()),
    updated_at = statement_timestamp()
  where document.lecture_session_id = target_lecture_session_id
    and document.document_id = target_document_id
    and document.document_version <> target_document_version
    and document.visible;

  insert into public.lecture_pdf_documents (
    lecture_session_id,
    document_id,
    document_version,
    manifest_version,
    display_name,
    page_count,
    byte_size,
    text_char_count,
    pdf_sha256,
    text_sha256,
    download_enabled,
    visible,
    archive_expires_at,
    delete_after,
    retired_at,
    updated_at
  ) values (
    target_lecture_session_id,
    target_document_id,
    target_document_version,
    target_manifest_version,
    trim(target_display_name),
    target_page_count,
    target_byte_size,
    target_text_char_count,
    target_pdf_sha256,
    target_text_sha256,
    target_download_enabled,
    true,
    lecture_row.archive_expires_at,
    case
      when lecture_row.archive_expires_at is null then null
      else lecture_row.archive_expires_at + interval '7 days'
    end,
    null,
    statement_timestamp()
  )
  on conflict (lecture_session_id, document_id, document_version)
  do update set
    manifest_version = greatest(
      public.lecture_pdf_documents.manifest_version,
      excluded.manifest_version
    ),
    download_enabled = excluded.download_enabled,
    visible = true,
    retired_at = null,
    updated_at = statement_timestamp()
  returning * into registered_row;

  return registered_row;
end;
$$;

create function public.admin_update_pdf_display_v3(
  target_lecture_session_id uuid,
  target_pdf_document_id text,
  target_pdf_document_version text,
  target_pdf_manifest_version bigint,
  target_pdf_page_count integer,
  target_pdf_visible boolean,
  target_current_pdf_page integer,
  target_display_mode text
)
returns table (
  lecture_session_id uuid,
  pdf_document_id text,
  pdf_document_version text,
  pdf_manifest_version bigint,
  pdf_page_count integer,
  pdf_visible boolean,
  current_pdf_page integer,
  display_mode text,
  display_version bigint,
  pdf_version bigint,
  state_version bigint,
  updated_at timestamptz
)
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if target_display_mode not in ('normal', 'presentation', 'slideOnly') then
    raise exception 'Invalid display mode.' using errcode = '22023';
  end if;
  if target_current_pdf_page < 1 then
    raise exception 'PDF page must be greater than or equal to 1.'
      using errcode = '22023';
  end if;

  if target_pdf_document_id is null then
    if target_pdf_document_version is not null
       or target_pdf_manifest_version <> 0
       or target_pdf_page_count is not null
       or target_pdf_visible
       or target_current_pdf_page <> 1 then
      raise exception 'Empty PDF state is inconsistent.' using errcode = '22023';
    end if;
  elsif target_pdf_document_version !~ '^[0-9a-f]{64}$'
        or target_pdf_manifest_version < 1
        or target_pdf_page_count not between 1 and 75
        or target_current_pdf_page > target_pdf_page_count
        or not target_pdf_visible
        or not exists (
          select 1
          from public.lecture_pdf_documents as document
          where document.lecture_session_id = target_lecture_session_id
            and document.document_id = target_pdf_document_id
            and document.document_version = target_pdf_document_version
            and document.manifest_version <= target_pdf_manifest_version
            and document.page_count = target_pdf_page_count
            and document.visible
        ) then
    raise exception 'The selected PDF publication is not registered.'
      using errcode = 'P0001';
  end if;

  return query
  update public.lecture_live_state as live
  set
    pdf_document_id = target_pdf_document_id,
    pdf_document_version = target_pdf_document_version,
    pdf_manifest_version = target_pdf_manifest_version,
    pdf_page_count = target_pdf_page_count,
    pdf_visible = target_pdf_visible,
    current_pdf_page = target_current_pdf_page,
    display_mode = target_display_mode,
    display_version = live.display_version + 1,
    pdf_version = live.pdf_version + 1,
    state_version = live.state_version + 1,
    updated_at = statement_timestamp()
  where live.lecture_session_id = target_lecture_session_id
    and exists (
      select 1
      from public.lecture_sessions as lecture
      where lecture.id = target_lecture_session_id
        and (
          lecture.status = 'draft'
          or private.is_lecture_open(lecture.id)
        )
    )
    and (
      live.pdf_document_id,
      live.pdf_document_version,
      live.pdf_manifest_version,
      live.pdf_page_count,
      live.pdf_visible,
      live.current_pdf_page,
      live.display_mode
    ) is distinct from (
      target_pdf_document_id,
      target_pdf_document_version,
      target_pdf_manifest_version,
      target_pdf_page_count,
      target_pdf_visible,
      target_current_pdf_page,
      target_display_mode
    )
  returning
    live.lecture_session_id,
    live.pdf_document_id,
    live.pdf_document_version,
    live.pdf_manifest_version,
    live.pdf_page_count,
    live.pdf_visible,
    live.current_pdf_page,
    live.display_mode,
    live.display_version,
    live.pdf_version,
    live.state_version,
    live.updated_at;

  if found then
    return;
  end if;

  return query
  select
    live.lecture_session_id,
    live.pdf_document_id,
    live.pdf_document_version,
    live.pdf_manifest_version,
    live.pdf_page_count,
    live.pdf_visible,
    live.current_pdf_page,
    live.display_mode,
    live.display_version,
    live.pdf_version,
    live.state_version,
    live.updated_at
  from public.lecture_live_state as live
  join public.lecture_sessions as lecture
    on lecture.id = live.lecture_session_id
  where live.lecture_session_id = target_lecture_session_id
    and (
      lecture.status = 'draft'
      or private.is_lecture_open(lecture.id)
    );
end;
$$;

alter function public.admin_update_pdf_display(uuid, text, integer, text)
  rename to admin_update_pdf_display_phase2;

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
declare
  registered public.lecture_pdf_documents%rowtype;
  changed_count bigint;
begin
  if target_pdf_document_id is not null then
    select document.*
    into registered
    from public.lecture_pdf_documents as document
    where document.lecture_session_id = target_lecture_session_id
      and document.document_id = target_pdf_document_id
      and document.visible
    order by document.manifest_version desc
    limit 1;
  end if;

  if registered.lecture_session_id is not null then
    perform * from public.admin_update_pdf_display_v3(
      target_lecture_session_id,
      registered.document_id,
      registered.document_version,
      registered.manifest_version,
      registered.page_count,
      true,
      target_current_pdf_page,
      target_display_mode
    );
  else
    select count(*)
    into changed_count
    from public.admin_update_pdf_display_phase2(
      target_lecture_session_id,
      target_pdf_document_id,
      target_current_pdf_page,
      target_display_mode
    );

    if changed_count > 0 then
      update public.lecture_live_state as live
      set
        pdf_document_version = null,
        pdf_manifest_version = 0,
        pdf_page_count = case target_pdf_document_id
          when 'why-learn-english-v1' then 15
          when 'm4-sample-v1' then 3
          else null
        end,
        pdf_visible = target_pdf_document_id is not null
      where live.lecture_session_id = target_lecture_session_id;
    end if;
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
    and (
      lecture.status = 'draft'
      or private.is_lecture_open(lecture.id)
    );
end;
$$;

create function private.get_pdf_access_claims_v1(
  target_lecture_session_id uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  request_user_id uuid := (select auth.uid());
  lecture_row public.lecture_sessions%rowtype;
  live_row public.lecture_live_state%rowtype;
  token_expires_at timestamptz;
begin
  if request_user_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  perform private.close_lecture_if_expired(target_lecture_session_id);

  select lecture.*
  into lecture_row
  from public.lecture_sessions as lecture
  where lecture.id = target_lecture_session_id
    and (
      private.is_lecture_open(lecture.id)
      or (
        lecture.status = 'closed'
        and lecture.archive_expires_at > statement_timestamp()
      )
    )
    and exists (
      select 1
      from public.participants as participant
      where participant.lecture_session_id = lecture.id
        and participant.auth_user_id = request_user_id
    );

  if not found then
    return null;
  end if;

  select live.*
  into live_row
  from public.lecture_live_state as live
  where live.lecture_session_id = lecture_row.id;

  token_expires_at := least(
    statement_timestamp() + interval '10 minutes',
    coalesce(lecture_row.archive_expires_at, 'infinity'::timestamptz)
  );

  return jsonb_build_object(
    'access_version', lecture_row.pdf_access_version,
    'archive_expires_at', lecture_row.archive_expires_at,
    'expires_at', token_expires_at,
    'lecture_public_id', lecture_row.pdf_public_id,
    'manifest_version', live_row.pdf_manifest_version,
    'not_before', statement_timestamp() - interval '30 seconds',
    'server_time', statement_timestamp()
  );
end;
$$;

create function public.get_pdf_access_claims_v1(
  target_lecture_session_id uuid
)
returns jsonb
language sql
volatile
security invoker
set search_path = ''
as $$
  select private.get_pdf_access_claims_v1(target_lecture_session_id);
$$;

create function public.admin_get_pdf_access_claims_v1(
  target_lecture_session_id uuid
)
returns jsonb
language sql
volatile
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'access_version', lecture.pdf_access_version,
    'archive_expires_at', lecture.archive_expires_at,
    'expires_at', least(
      statement_timestamp() + interval '10 minutes',
      coalesce(lecture.archive_expires_at, 'infinity'::timestamptz)
    ),
    'lecture_public_id', lecture.pdf_public_id,
    'manifest_version', live.pdf_manifest_version,
    'not_before', statement_timestamp() - interval '30 seconds',
    'server_time', statement_timestamp()
  )
  from public.lecture_sessions as lecture
  join public.lecture_live_state as live
    on live.lecture_session_id = lecture.id
  where lecture.id = target_lecture_session_id
    and (
      lecture.status = 'draft'
      or private.is_lecture_open(lecture.id)
      or (
        lecture.status = 'closed'
        and lecture.archive_expires_at > statement_timestamp()
      )
    );
$$;

alter function private.get_lecture_public_snapshot_v2(
  uuid, bigint, bigint, bigint, bigint, bigint, bigint, bigint,
  timestamptz, uuid, integer
) rename to get_lecture_public_snapshot_v2_phase2_core;

create function private.get_lecture_public_snapshot_v2(
  target_lecture_session_id uuid,
  known_lecture_version bigint default null,
  known_caption_version bigint default null,
  known_comments_version bigint default null,
  known_likes_version bigint default null,
  known_polls_version bigint default null,
  known_summaries_version bigint default null,
  known_pdf_version bigint default null,
  comment_cursor_created_at timestamptz default null,
  comment_cursor_id uuid default null,
  comment_limit integer default 100
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  snapshot_payload jsonb;
  live_row public.lecture_live_state%rowtype;
begin
  if (select auth.uid()) is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  snapshot_payload := private.get_lecture_public_snapshot_v2_phase2_core(
    target_lecture_session_id,
    known_lecture_version,
    known_caption_version,
    known_comments_version,
    known_likes_version,
    known_polls_version,
    known_summaries_version,
    known_pdf_version,
    comment_cursor_created_at,
    comment_cursor_id,
    comment_limit
  );

  if snapshot_payload is null
     or jsonb_typeof(snapshot_payload #> '{changed,pdf}') is distinct from 'object' then
    return snapshot_payload;
  end if;

  select live.* into live_row
  from public.lecture_live_state as live
  where live.lecture_session_id = target_lecture_session_id;

  return jsonb_set(
    snapshot_payload,
    '{changed,pdf}',
    (snapshot_payload #> '{changed,pdf}') || jsonb_build_object(
      'pdf_document_version', live_row.pdf_document_version,
      'pdf_manifest_version', live_row.pdf_manifest_version,
      'pdf_page_count', live_row.pdf_page_count,
      'pdf_visible', live_row.pdf_visible
    ),
    true
  );
end;
$$;

alter function private.get_lecture_live_snapshot_for_current_user(
  uuid, bigint, bigint, bigint, bigint, bigint, timestamptz, uuid, integer
) rename to get_lecture_live_snapshot_for_current_user_phase2_core;

create function private.get_lecture_live_snapshot_for_current_user(
  target_lecture_session_id uuid,
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
volatile
security definer
set search_path = ''
as $$
declare
  snapshot_payload jsonb;
  live_row public.lecture_live_state%rowtype;
begin
  if (select auth.uid()) is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  snapshot_payload := private.get_lecture_live_snapshot_for_current_user_phase2_core(
    target_lecture_session_id,
    known_state_version,
    known_comments_version,
    known_likes_version,
    known_polls_version,
    known_display_version,
    comment_cursor_created_at,
    comment_cursor_id,
    comment_limit
  );

  if snapshot_payload is null
     or jsonb_typeof(snapshot_payload -> 'display') is distinct from 'object' then
    return snapshot_payload;
  end if;

  select live.* into live_row
  from public.lecture_live_state as live
  where live.lecture_session_id = target_lecture_session_id;

  return jsonb_set(
    snapshot_payload,
    '{display}',
    (snapshot_payload -> 'display') || jsonb_build_object(
      'pdf_document_version', live_row.pdf_document_version,
      'pdf_manifest_version', live_row.pdf_manifest_version,
      'pdf_page_count', live_row.pdf_page_count,
      'pdf_visible', live_row.pdf_visible
    ),
    true
  );
end;
$$;

alter function private.get_lecture_archive_v2(uuid)
  rename to get_lecture_archive_v2_phase2_core;

create function private.get_lecture_archive_v2(
  target_lecture_session_id uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  archive_payload jsonb;
  live_row public.lecture_live_state%rowtype;
begin
  if (select auth.uid()) is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  archive_payload := private.get_lecture_archive_v2_phase2_core(
    target_lecture_session_id
  );

  if archive_payload is null
     or jsonb_typeof(archive_payload -> 'pdf') <> 'object' then
    return archive_payload;
  end if;

  select live.* into live_row
  from public.lecture_live_state as live
  where live.lecture_session_id = target_lecture_session_id;

  return jsonb_set(
    archive_payload,
    '{pdf}',
    (archive_payload -> 'pdf') || jsonb_build_object(
      'pdf_document_version', live_row.pdf_document_version,
      'pdf_manifest_version', live_row.pdf_manifest_version,
      'pdf_page_count', live_row.pdf_page_count,
      'pdf_visible', live_row.pdf_visible
    ),
    true
  );
end;
$$;

revoke all on function public.admin_register_pdf_document(
  uuid, text, text, bigint, text, integer, bigint, integer, text, text, boolean
) from public, anon, authenticated;
revoke all on function public.admin_update_pdf_display_v3(
  uuid, text, text, bigint, integer, boolean, integer, text
) from public, anon, authenticated;
revoke all on function public.admin_update_pdf_display_phase2(
  uuid, text, integer, text
) from public, anon, authenticated;
revoke all on function public.admin_update_pdf_display(
  uuid, text, integer, text
) from public, anon, authenticated;
revoke all on function public.admin_get_pdf_access_claims_v1(uuid)
  from public, anon, authenticated;
revoke all on function public.get_pdf_access_claims_v1(uuid)
  from public, anon;

grant execute on function public.admin_register_pdf_document(
  uuid, text, text, bigint, text, integer, bigint, integer, text, text, boolean
) to service_role;
grant execute on function public.admin_update_pdf_display_v3(
  uuid, text, text, bigint, integer, boolean, integer, text
) to service_role;
grant execute on function public.admin_update_pdf_display(
  uuid, text, integer, text
) to service_role;
grant execute on function public.admin_get_pdf_access_claims_v1(uuid)
  to service_role;
grant execute on function public.get_pdf_access_claims_v1(uuid)
  to authenticated;

revoke all on function private.get_pdf_access_claims_v1(uuid) from public;
revoke all on function private.get_lecture_public_snapshot_v2(
  uuid, bigint, bigint, bigint, bigint, bigint, bigint, bigint,
  timestamptz, uuid, integer
) from public;
revoke all on function private.get_lecture_live_snapshot_for_current_user(
  uuid, bigint, bigint, bigint, bigint, bigint, timestamptz, uuid, integer
) from public;
revoke all on function private.get_lecture_archive_v2(uuid) from public;

grant execute on function private.get_pdf_access_claims_v1(uuid)
  to authenticated;
grant execute on function private.get_lecture_public_snapshot_v2(
  uuid, bigint, bigint, bigint, bigint, bigint, bigint, bigint,
  timestamptz, uuid, integer
) to authenticated;
grant execute on function private.get_lecture_live_snapshot_for_current_user(
  uuid, bigint, bigint, bigint, bigint, bigint, timestamptz, uuid, integer
) to authenticated;
grant execute on function private.get_lecture_archive_v2(uuid)
  to authenticated;

comment on table public.lecture_pdf_documents is
  'Phase 3 content-free metadata for PDFs stored outside Supabase in private R2.';
comment on column public.lecture_sessions.pdf_public_id is
  'Pseudonymous lecture identifier used in signed PDF delivery claims.';
comment on function public.get_pdf_access_claims_v1(uuid) is
  'Returns bounded claims for a server-signed PDF access token; never PDF bytes.';
