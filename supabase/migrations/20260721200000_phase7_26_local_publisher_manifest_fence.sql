-- Phase 7.26 follow-up: serialize Local Publisher metadata registration with
-- browser publication activation. R2 manifest writers already share ETag CAS;
-- this access-version receipt closes the corresponding Postgres/live-state
-- race without changing the Phase 3 compatibility RPC.

alter table public.lecture_pdf_documents
  add column local_manifest_etag text
    check (
      local_manifest_etag is null
      or (
        char_length(local_manifest_etag) between 1 and 512
        and local_manifest_etag !~ '[[:cntrl:]]'
      )
    );

create function public.admin_register_local_pdf_document_v2(
  target_lecture_session_id uuid,
  target_document_id text,
  target_document_version text,
  target_manifest_version bigint,
  target_manifest_etag text,
  target_expected_access_version bigint,
  target_display_name text,
  target_page_count integer,
  target_byte_size bigint,
  target_text_char_count integer,
  target_pdf_sha256 text,
  target_text_sha256 text,
  target_download_enabled boolean,
  target_admin_session_id uuid,
  target_admin_auth_user_id uuid
)
returns public.lecture_pdf_documents
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  lecture_row public.lecture_sessions%rowtype;
  registered_row public.lecture_pdf_documents%rowtype;
begin
  perform private.assert_tracked_pdf_admin_actor_v1(
    target_admin_session_id,
    target_admin_auth_user_id
  );

  if target_expected_access_version is null
     or target_expected_access_version < 1
     or target_manifest_etag is null
     or char_length(target_manifest_etag) not between 1 and 512
     or target_manifest_etag ~ '[[:cntrl:]]' then
    raise exception 'invalid Local Publisher manifest receipt'
      using errcode = '22023';
  end if;

  perform private.close_lecture_if_expired(
    target_lecture_session_id,
    'deadline_guard',
    'local-pdf-publication-register'
  );

  select lecture.*
  into lecture_row
  from public.lecture_sessions as lecture
  where lecture.id = target_lecture_session_id
  for update;

  if not found
     or not (
       lecture_row.status = 'draft'
       or private.is_lecture_open(lecture_row.id)
     ) then
    raise exception 'PDF publication is unavailable for this lecture'
      using errcode = 'P0001';
  end if;

  if lecture_row.pdf_access_version <> target_expected_access_version then
    raise exception 'Local Publisher access-version receipt is stale'
      using errcode = '40001';
  end if;

  select registration.*
  into registered_row
  from public.admin_register_pdf_document(
    target_lecture_session_id,
    target_document_id,
    target_document_version,
    target_manifest_version,
    target_display_name,
    target_page_count,
    target_byte_size,
    target_text_char_count,
    target_pdf_sha256,
    target_text_sha256,
    target_download_enabled
  ) as registration;

  update public.lecture_pdf_documents as document
  set
    local_manifest_etag = target_manifest_etag,
    updated_at = statement_timestamp()
  where document.lecture_session_id = registered_row.lecture_session_id
    and document.document_id = registered_row.document_id
    and document.document_version = registered_row.document_version
  returning document.* into registered_row;

  if not found then
    raise exception 'Local Publisher metadata registration was not persisted'
      using errcode = 'P0002';
  end if;

  return registered_row;
end;
$$;

revoke all on function public.admin_register_local_pdf_document_v2(
  uuid, text, text, bigint, text, bigint, text, integer, bigint, integer,
  text, text, boolean, uuid, uuid
) from public, anon, authenticated, service_role;

grant execute on function public.admin_register_local_pdf_document_v2(
  uuid, text, text, bigint, text, bigint, text, integer, bigint, integer,
  text, text, boolean, uuid, uuid
) to service_role;

comment on column public.lecture_pdf_documents.local_manifest_etag is
  'Latest verified Local Publisher R2 manifest receipt; NULL preserves pre-Phase-7.26 and browser publication rows.';

comment on function public.admin_register_local_pdf_document_v2(
  uuid, text, text, bigint, text, bigint, text, integer, bigint, integer,
  text, text, boolean, uuid, uuid
) is
  'Registers a Local Publisher receipt only while its signed PDF access version still matches the lecture row lock.';
