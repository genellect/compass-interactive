-- Phase 7.26: browser-complete private PDF publication control plane.
--
-- Expand-first guarantees:
-- - Phase 3 Local Publisher tables and RPC signatures remain unchanged.
-- - PDF bytes and extracted text never enter PostgreSQL.
-- - New browser publication state is service-role only and is not added to
--   Supabase Realtime.

create table public.lecture_pdf_publications (
  id uuid primary key default gen_random_uuid(),
  lecture_session_id uuid not null
    references public.lecture_sessions(id) on delete restrict,
  document_id text not null
    check (document_id ~ '^[a-z0-9][a-z0-9-]{0,63}$'),
  expected_pdf_sha256 text not null
    check (expected_pdf_sha256 ~ '^[0-9a-f]{64}$'),
  expected_byte_size bigint not null
    check (expected_byte_size between 1 and 15728640),
  declared_page_count integer not null
    check (declared_page_count between 1 and 75),
  declared_text_char_count integer not null
    check (declared_text_char_count between 1 and 20000),
  declared_text_sha256 text not null
    check (declared_text_sha256 ~ '^[0-9a-f]{64}$'),
  display_name text not null
    check (
      char_length(display_name) between 1 and 160
      and display_name !~ '[[:cntrl:]]'
    ),
  download_enabled boolean not null default true,
  allowed_origin text not null
    check (
      char_length(allowed_origin) between 1 and 255
      and allowed_origin !~ '[[:cntrl:]]'
      and allowed_origin ~ '^https?://[^/]+$'
    ),
  state text not null default 'pending'
    check (
      state in (
        'pending',
        'uploaded',
        'committed',
        'active',
        'retired',
        'aborted',
        'expired'
      )
    ),
  state_version bigint not null default 1 check (state_version >= 1),
  client_request_id uuid not null unique,
  request_fingerprint text not null
    check (request_fingerprint ~ '^[0-9a-f]{64}$'),
  requested_by_admin_session_id uuid not null
    references public.admin_sessions(id) on delete restrict,
  requested_by_auth_user_id uuid not null,
  ticket_admin_session_id uuid not null
    references public.admin_sessions(id) on delete restrict,
  ticket_generation integer not null default 1
    check (ticket_generation between 1 and 2147483647),
  nonce_hash text not null unique check (nonce_hash ~ '^[0-9a-f]{64}$'),
  ticket_jti_hash text not null unique
    check (ticket_jti_hash ~ '^[0-9a-f]{64}$'),
  ticket_expires_at timestamptz not null,
  nonce_used_at timestamptz,
  worker_attempt_id uuid unique,
  upload_lease_expires_at timestamptz,
  actual_byte_size bigint check (actual_byte_size between 1 and 15728640),
  actual_pdf_sha256 text
    check (actual_pdf_sha256 is null or actual_pdf_sha256 ~ '^[0-9a-f]{64}$'),
  pdf_magic_verified boolean,
  r2_object_version text
    check (
      r2_object_version is null
      or (
        char_length(r2_object_version) between 1 and 512
        and r2_object_version !~ '[[:cntrl:]]'
      )
    ),
  r2_etag text
    check (
      r2_etag is null
      or (
        char_length(r2_etag) between 1 and 512
        and r2_etag !~ '[[:cntrl:]]'
      )
    ),
  uploaded_at timestamptz,
  commit_operation_id uuid,
  commit_lease_expires_at timestamptz,
  committed_manifest_version bigint
    check (
      committed_manifest_version is null
      or committed_manifest_version >= 1
    ),
  committed_manifest_access_version bigint
    check (
      committed_manifest_access_version is null
      or committed_manifest_access_version >= 1
    ),
  committed_manifest_etag text
    check (
      committed_manifest_etag is null
      or (
        char_length(committed_manifest_etag) between 1 and 512
        and committed_manifest_etag !~ '[[:cntrl:]]'
      )
    ),
  committed_at timestamptz,
  activation_operation_id uuid,
  activation_lease_expires_at timestamptz,
  activation_target_access_version bigint
    check (
      activation_target_access_version is null
      or activation_target_access_version >= 2
    ),
  activated_manifest_version bigint
    check (
      activated_manifest_version is null
      or activated_manifest_version >= 1
    ),
  activated_manifest_etag text
    check (
      activated_manifest_etag is null
      or (
        char_length(activated_manifest_etag) between 1 and 512
        and activated_manifest_etag !~ '[[:cntrl:]]'
      )
    ),
  active_at timestamptz,
  retired_at timestamptz,
  aborted_at timestamptz,
  expired_at timestamptz,
  operation_expires_at timestamptz not null,
  cleanup_after timestamptz,
  cleanup_claim_id uuid,
  cleanup_lease_expires_at timestamptz,
  cleanup_attempt_count integer not null default 0
    check (cleanup_attempt_count between 0 and 1000),
  cleanup_completed_at timestamptz,
  last_error_code text
    check (
      last_error_code is null
      or (
        char_length(last_error_code) between 1 and 80
        and last_error_code ~ '^[a-z0-9_:-]+$'
      )
    ),
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  check (ticket_expires_at > created_at),
  check (ticket_expires_at <= operation_expires_at),
  check (
    (nonce_used_at is null and worker_attempt_id is null)
    or (nonce_used_at is not null and worker_attempt_id is not null)
  ),
  check (
    upload_lease_expires_at is null
    or (
      nonce_used_at is not null
      and upload_lease_expires_at > nonce_used_at
    )
  ),
  check (
    (
      actual_byte_size is null
      and actual_pdf_sha256 is null
      and pdf_magic_verified is null
      and r2_object_version is null
      and r2_etag is null
      and uploaded_at is null
    )
    or (
      actual_byte_size is not null
      and actual_pdf_sha256 is not null
      and pdf_magic_verified
      and r2_object_version is not null
      and r2_etag is not null
      and uploaded_at is not null
    )
  ),
  check (
    state not in ('uploaded', 'committed', 'active', 'retired')
    or uploaded_at is not null
  ),
  check (
    state not in ('committed', 'active', 'retired')
    or (
      committed_at is not null
      and committed_manifest_version is not null
      and committed_manifest_access_version is not null
      and committed_manifest_etag is not null
    )
  ),
  check (
    state not in ('active', 'retired')
    or (
      active_at is not null
      and activated_manifest_version is not null
      and activation_target_access_version is not null
      and activated_manifest_etag is not null
    )
  ),
  check ((state = 'retired') = (retired_at is not null)),
  check ((state = 'aborted') = (aborted_at is not null)),
  check ((state = 'expired') = (expired_at is not null)),
  check (
    (cleanup_claim_id is null and cleanup_lease_expires_at is null)
    or (
      cleanup_claim_id is not null
      and cleanup_lease_expires_at is not null
    )
  )
);

create unique index lecture_pdf_publications_one_inflight_per_lecture_idx
  on public.lecture_pdf_publications (lecture_session_id)
  where state in ('pending', 'uploaded', 'committed');

create index lecture_pdf_publications_lecture_state_idx
  on public.lecture_pdf_publications (
    lecture_session_id,
    state,
    updated_at desc
  );

create index lecture_pdf_publications_requested_admin_session_idx
  on public.lecture_pdf_publications (requested_by_admin_session_id, id);

create index lecture_pdf_publications_ticket_admin_session_idx
  on public.lecture_pdf_publications (ticket_admin_session_id, id);

create index lecture_pdf_publications_operation_expiry_idx
  on public.lecture_pdf_publications (operation_expires_at, id)
  where state in ('pending', 'uploaded', 'committed');

create index lecture_pdf_publications_cleanup_due_idx
  on public.lecture_pdf_publications (cleanup_after, id)
  where cleanup_completed_at is null
    and state in ('retired', 'aborted', 'expired');

alter table public.lecture_pdf_publications enable row level security;
revoke all on public.lecture_pdf_publications
  from public, anon, authenticated;
grant select, insert, update on public.lecture_pdf_publications to service_role;

create table public.lecture_pdf_publication_events (
  id uuid primary key default gen_random_uuid(),
  publication_id uuid not null
    references public.lecture_pdf_publications(id) on delete restrict,
  lecture_session_id uuid not null
    references public.lecture_sessions(id) on delete restrict,
  event_type text not null
    check (
      event_type in (
        'pending_created',
        'ticket_reissued',
        'nonce_claimed',
        'uploaded',
        'commit_prepared',
        'committed',
        'activation_prepared',
        'active',
        'retired',
        'aborted',
        'expired',
        'cleanup_claimed',
        'cleanup_completed',
        'cleanup_failed'
      )
    ),
  actor_type text not null
    check (actor_type in ('admin', 'worker', 'system')),
  actor_id text not null
    check (
      char_length(actor_id) between 1 and 200
      and actor_id !~ '[[:cntrl:]]'
    ),
  state_from text,
  state_to text not null,
  details jsonb not null default '{}'::jsonb
    check (
      jsonb_typeof(details) = 'object'
      and octet_length(details::text) <= 4096
    ),
  recorded_at timestamptz not null default statement_timestamp()
);

create index lecture_pdf_publication_events_publication_idx
  on public.lecture_pdf_publication_events (
    publication_id,
    recorded_at desc
  );

create index lecture_pdf_publication_events_lecture_idx
  on public.lecture_pdf_publication_events (
    lecture_session_id,
    recorded_at desc
  );

alter table public.lecture_pdf_publication_events enable row level security;
revoke all on public.lecture_pdf_publication_events
  from public, anon, authenticated;
grant select, insert on public.lecture_pdf_publication_events to service_role;

alter table public.lecture_pdf_documents
  add column browser_publication_id uuid
    references public.lecture_pdf_publications(id) on delete restrict;

create unique index lecture_pdf_documents_browser_publication_idx
  on public.lecture_pdf_documents (browser_publication_id)
  where browser_publication_id is not null;

create function private.assert_tracked_pdf_admin_actor_v1(
  target_admin_session_id uuid,
  target_auth_user_id uuid
)
returns void
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  session_row public.admin_sessions%rowtype;
  effective_now timestamptz := statement_timestamp();
begin
  if target_admin_session_id is null or target_auth_user_id is null then
    raise exception 'tracked Admin actor is required' using errcode = '42501';
  end if;

  select session.*
  into session_row
  from public.admin_sessions as session
  where session.id = target_admin_session_id
  for share;

  if not found
     or session_row.auth_user_id <> target_auth_user_id
     or session_row.revoked_at is not null
     or session_row.expires_at <= effective_now
     or session_row.idle_expires_at <= effective_now then
    raise exception 'tracked Admin session is unavailable'
      using errcode = '42501';
  end if;
end;
$$;

create function public.admin_create_pdf_publication_v1(
  target_lecture_session_id uuid,
  target_document_id text,
  target_expected_pdf_sha256 text,
  target_expected_byte_size bigint,
  target_declared_page_count integer,
  target_declared_text_char_count integer,
  target_declared_text_sha256 text,
  target_display_name text,
  target_download_enabled boolean,
  target_allowed_origin text,
  target_client_request_id uuid,
  target_nonce_hash text,
  target_ticket_jti_hash text,
  target_admin_session_id uuid,
  target_admin_auth_user_id uuid
)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  effective_now timestamptz := statement_timestamp();
  lecture_row public.lecture_sessions%rowtype;
  existing_row public.lecture_pdf_publications%rowtype;
  publication_id uuid;
  computed_fingerprint text;
  aggregate_bytes bigint;
  aggregate_pages bigint;
  aggregate_characters bigint;
begin
  perform private.assert_tracked_pdf_admin_actor_v1(
    target_admin_session_id,
    target_admin_auth_user_id
  );

  if target_lecture_session_id is null
     or target_document_id is null
     or target_document_id !~ '^[a-z0-9][a-z0-9-]{0,63}$'
     or target_expected_pdf_sha256 is null
     or target_expected_pdf_sha256 !~ '^[0-9a-f]{64}$'
     or target_expected_byte_size is null
     or target_expected_byte_size not between 1 and 15728640
     or target_declared_page_count is null
     or target_declared_page_count not between 1 and 75
     or target_declared_text_char_count is null
     or target_declared_text_char_count not between 1 and 20000
     or target_declared_text_sha256 is null
     or target_declared_text_sha256 !~ '^[0-9a-f]{64}$'
     or target_display_name is null
     or char_length(trim(target_display_name)) not between 1 and 160
     or target_display_name ~ '[[:cntrl:]]'
     or target_download_enabled is null
     or target_allowed_origin is null
     or char_length(target_allowed_origin) not between 1 and 255
     or target_allowed_origin !~ '^https?://[^/]+$'
     or target_allowed_origin ~ '[[:cntrl:]]'
     or target_client_request_id is null
     or target_nonce_hash is null
     or target_nonce_hash !~ '^[0-9a-f]{64}$'
     or target_ticket_jti_hash is null
     or target_ticket_jti_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid browser PDF publication request'
      using errcode = '22023';
  end if;

  perform private.close_lecture_if_expired(
    target_lecture_session_id,
    'deadline_guard',
    'pdf-publication-initiate'
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

  computed_fingerprint := encode(
    extensions.digest(
      convert_to(
        jsonb_build_object(
          'allowed_origin', target_allowed_origin,
          'declared_page_count', target_declared_page_count,
          'declared_text_char_count', target_declared_text_char_count,
          'declared_text_sha256', target_declared_text_sha256,
          'display_name', trim(target_display_name),
          'document_id', target_document_id,
          'download_enabled', target_download_enabled,
          'expected_byte_size', target_expected_byte_size,
          'expected_pdf_sha256', target_expected_pdf_sha256,
          'lecture_session_id', target_lecture_session_id
        )::text,
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );

  select publication.*
  into existing_row
  from public.lecture_pdf_publications as publication
  where publication.client_request_id = target_client_request_id
  for update;

  if found then
    if existing_row.requested_by_auth_user_id <> target_admin_auth_user_id then
      raise exception 'publication idempotency key belongs to another Admin'
        using errcode = '42501';
    end if;
    if existing_row.request_fingerprint <> computed_fingerprint then
      raise exception 'publication idempotency key payload mismatch'
        using errcode = '23514';
    end if;

    if existing_row.state = 'pending'
       and existing_row.nonce_used_at is null
       and existing_row.operation_expires_at > effective_now then
      if existing_row.ticket_generation >= 2147483647 then
        raise exception 'publication ticket generation is exhausted'
          using errcode = '54000';
      end if;

      update public.lecture_pdf_publications as publication
      set
        ticket_admin_session_id = target_admin_session_id,
        ticket_generation = publication.ticket_generation + 1,
        nonce_hash = target_nonce_hash,
        ticket_jti_hash = target_ticket_jti_hash,
        ticket_expires_at = least(
          effective_now + interval '10 minutes',
          publication.operation_expires_at
        ),
        state_version = publication.state_version + 1,
        updated_at = effective_now
      where publication.id = existing_row.id;

      perform private.record_pdf_publication_event_v1(
        existing_row.id,
        existing_row.lecture_session_id,
        'ticket_reissued',
        'admin',
        'admin-session:' || target_admin_session_id::text,
        'pending',
        'pending',
        jsonb_build_object('reason', 'idempotent_initiate_retry')
      );
    end if;

    return private.build_pdf_publication_result_v1(existing_row.id);
  end if;

  select
    coalesce(sum(document.byte_size), 0),
    coalesce(sum(document.page_count), 0),
    coalesce(sum(document.text_char_count), 0)
  into aggregate_bytes, aggregate_pages, aggregate_characters
  from public.lecture_pdf_documents as document
  where document.lecture_session_id = target_lecture_session_id
    and document.visible
    and document.document_id <> target_document_id;

  if aggregate_bytes + target_expected_byte_size > 15728640
     or aggregate_pages + target_declared_page_count > 75
     or aggregate_characters + target_declared_text_char_count > 20000 then
    raise exception 'lecture PDF aggregate limit exceeded'
      using errcode = '22023';
  end if;

  insert into public.lecture_pdf_publications (
    lecture_session_id,
    document_id,
    expected_pdf_sha256,
    expected_byte_size,
    declared_page_count,
    declared_text_char_count,
    declared_text_sha256,
    display_name,
    download_enabled,
    allowed_origin,
    client_request_id,
    request_fingerprint,
    requested_by_admin_session_id,
    requested_by_auth_user_id,
    ticket_admin_session_id,
    nonce_hash,
    ticket_jti_hash,
    ticket_expires_at,
    operation_expires_at,
    created_at,
    updated_at
  ) values (
    target_lecture_session_id,
    target_document_id,
    target_expected_pdf_sha256,
    target_expected_byte_size,
    target_declared_page_count,
    target_declared_text_char_count,
    target_declared_text_sha256,
    trim(target_display_name),
    target_download_enabled,
    target_allowed_origin,
    target_client_request_id,
    computed_fingerprint,
    target_admin_session_id,
    target_admin_auth_user_id,
    target_admin_session_id,
    target_nonce_hash,
    target_ticket_jti_hash,
    effective_now + interval '10 minutes',
    effective_now + interval '24 hours',
    effective_now,
    effective_now
  )
  returning id into publication_id;

  perform private.record_pdf_publication_event_v1(
    publication_id,
    target_lecture_session_id,
    'pending_created',
    'admin',
    'admin-session:' || target_admin_session_id::text,
    null,
    'pending',
    jsonb_build_object('client_request_id', target_client_request_id)
  );

  return private.build_pdf_publication_result_v1(publication_id);
end;
$$;

create function public.admin_reissue_pdf_publication_ticket_v1(
  target_publication_id uuid,
  target_nonce_hash text,
  target_ticket_jti_hash text,
  target_admin_session_id uuid,
  target_admin_auth_user_id uuid
)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  effective_now timestamptz := statement_timestamp();
  target_lecture_session_id uuid;
  lecture_row public.lecture_sessions%rowtype;
  publication_row public.lecture_pdf_publications%rowtype;
begin
  perform private.assert_tracked_pdf_admin_actor_v1(
    target_admin_session_id,
    target_admin_auth_user_id
  );

  if target_publication_id is null
     or target_nonce_hash is null
     or target_nonce_hash !~ '^[0-9a-f]{64}$'
     or target_ticket_jti_hash is null
     or target_ticket_jti_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid publication ticket reissue request'
      using errcode = '22023';
  end if;

  select publication.lecture_session_id
  into target_lecture_session_id
  from public.lecture_pdf_publications as publication
  where publication.id = target_publication_id;

  if not found then
    raise exception 'PDF publication not found' using errcode = 'P0002';
  end if;

  perform private.close_lecture_if_expired(
    target_lecture_session_id,
    'deadline_guard',
    'pdf-publication-ticket-reissue'
  );

  select lecture.*
  into lecture_row
  from public.lecture_sessions as lecture
  where lecture.id = target_lecture_session_id
  for update;

  select publication.*
  into publication_row
  from public.lecture_pdf_publications as publication
  where publication.id = target_publication_id
    and publication.lecture_session_id = lecture_row.id
  for update;

  if publication_row.requested_by_auth_user_id <> target_admin_auth_user_id then
    raise exception 'PDF publication belongs to another Admin'
      using errcode = '42501';
  end if;
  if not (
    lecture_row.status = 'draft'
    or private.is_lecture_open(lecture_row.id)
  ) then
    raise exception 'PDF publication is unavailable for this lecture'
      using errcode = 'P0001';
  end if;
  if publication_row.state <> 'pending'
     or publication_row.operation_expires_at <= effective_now then
    raise exception 'PDF publication ticket cannot be reissued'
      using errcode = '55000';
  end if;
  if publication_row.nonce_used_at is not null
     and publication_row.upload_lease_expires_at > effective_now then
    raise exception 'PDF upload is already in progress'
      using errcode = '55000';
  end if;
  if publication_row.ticket_generation >= 2147483647 then
    raise exception 'publication ticket generation is exhausted'
      using errcode = '54000';
  end if;

  update public.lecture_pdf_publications as publication
  set
    ticket_admin_session_id = target_admin_session_id,
    ticket_generation = publication.ticket_generation + 1,
    nonce_hash = target_nonce_hash,
    ticket_jti_hash = target_ticket_jti_hash,
    ticket_expires_at = least(
      effective_now + interval '10 minutes',
      publication.operation_expires_at
    ),
    nonce_used_at = null,
    worker_attempt_id = null,
    upload_lease_expires_at = null,
    state_version = publication.state_version + 1,
    last_error_code = null,
    updated_at = effective_now
  where publication.id = target_publication_id;

  perform private.record_pdf_publication_event_v1(
    target_publication_id,
    target_lecture_session_id,
    'ticket_reissued',
    'admin',
    'admin-session:' || target_admin_session_id::text,
    'pending',
    'pending',
    jsonb_build_object('reason', 'explicit_resume')
  );

  return private.build_pdf_publication_result_v1(target_publication_id);
end;
$$;

create function public.admin_get_pdf_publication_v1(
  target_publication_id uuid,
  target_admin_session_id uuid,
  target_admin_auth_user_id uuid
)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  publication_row public.lecture_pdf_publications%rowtype;
begin
  perform private.assert_tracked_pdf_admin_actor_v1(
    target_admin_session_id,
    target_admin_auth_user_id
  );

  select publication.*
  into publication_row
  from public.lecture_pdf_publications as publication
  where publication.id = target_publication_id;

  if not found then
    return null;
  end if;
  if publication_row.requested_by_auth_user_id <> target_admin_auth_user_id then
    raise exception 'PDF publication belongs to another Admin'
      using errcode = '42501';
  end if;

  return private.build_pdf_publication_result_v1(target_publication_id);
end;
$$;

create function public.admin_find_inflight_pdf_publication_v1(
  target_lecture_session_id uuid,
  target_admin_session_id uuid,
  target_admin_auth_user_id uuid
)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  publication_id uuid;
begin
  perform private.assert_tracked_pdf_admin_actor_v1(
    target_admin_session_id,
    target_admin_auth_user_id
  );

  if target_lecture_session_id is null then
    raise exception 'lecture is required for PDF publication discovery'
      using errcode = '22023';
  end if;

  perform private.close_lecture_if_expired(
    target_lecture_session_id,
    'deadline_guard',
    'pdf-publication-discovery'
  );

  select publication.id
  into publication_id
  from public.lecture_pdf_publications as publication
  where publication.lecture_session_id = target_lecture_session_id
    and publication.requested_by_auth_user_id = target_admin_auth_user_id
    and publication.state in ('pending', 'uploaded', 'committed')
  order by publication.updated_at desc, publication.id desc
  limit 1;

  if not found then
    return null;
  end if;

  return private.build_pdf_publication_result_v1(publication_id);
end;
$$;

create function private.record_pdf_publication_event_v1(
  target_publication_id uuid,
  target_lecture_session_id uuid,
  target_event_type text,
  target_actor_type text,
  target_actor_id text,
  target_state_from text,
  target_state_to text,
  target_details jsonb default '{}'::jsonb
)
returns void
language plpgsql
volatile
security invoker
set search_path = ''
as $$
begin
  insert into public.lecture_pdf_publication_events (
    publication_id,
    lecture_session_id,
    event_type,
    actor_type,
    actor_id,
    state_from,
    state_to,
    details
  ) values (
    target_publication_id,
    target_lecture_session_id,
    target_event_type,
    target_actor_type,
    target_actor_id,
    target_state_from,
    target_state_to,
    coalesce(target_details, '{}'::jsonb)
  );
end;
$$;

create function public.worker_claim_pdf_publication_nonce_v1(
  target_publication_id uuid,
  target_ticket_generation integer,
  target_nonce_hash text,
  target_ticket_jti_hash text,
  target_lecture_public_id text,
  target_document_id text,
  target_expected_pdf_sha256 text,
  target_expected_byte_size bigint,
  target_allowed_origin text,
  target_ticket_admin_session_id uuid,
  target_worker_attempt_id uuid
)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  effective_now timestamptz := statement_timestamp();
  preliminary_row public.lecture_pdf_publications%rowtype;
  lecture_row public.lecture_sessions%rowtype;
  publication_row public.lecture_pdf_publications%rowtype;
begin
  if target_publication_id is null
     or target_ticket_generation is null
     or target_ticket_generation < 1
     or target_nonce_hash is null
     or target_nonce_hash !~ '^[0-9a-f]{64}$'
     or target_ticket_jti_hash is null
     or target_ticket_jti_hash !~ '^[0-9a-f]{64}$'
     or target_lecture_public_id is null
     or target_lecture_public_id !~ '^lecture_[0-9a-f]{32}$'
     or target_document_id is null
     or target_document_id !~ '^[a-z0-9][a-z0-9-]{0,63}$'
     or target_expected_pdf_sha256 is null
     or target_expected_pdf_sha256 !~ '^[0-9a-f]{64}$'
     or target_expected_byte_size is null
     or target_expected_byte_size not between 1 and 15728640
     or target_allowed_origin is null
     or char_length(target_allowed_origin) not between 1 and 255
     or target_allowed_origin !~ '^https?://[^/]+$'
     or target_allowed_origin ~ '[[:cntrl:]]'
     or target_worker_attempt_id is null
     or target_ticket_admin_session_id is null then
    raise exception 'invalid PDF upload ticket claim'
      using errcode = '22023';
  end if;

  select publication.*
  into preliminary_row
  from public.lecture_pdf_publications as publication
  where publication.id = target_publication_id;

  if not found then
    raise exception 'PDF publication not found' using errcode = 'P0002';
  end if;

  perform private.assert_tracked_pdf_admin_actor_v1(
    preliminary_row.ticket_admin_session_id,
    preliminary_row.requested_by_auth_user_id
  );

  perform private.close_lecture_if_expired(
    preliminary_row.lecture_session_id,
    'deadline_guard',
    'pdf-upload-ticket-claim'
  );

  select lecture.*
  into lecture_row
  from public.lecture_sessions as lecture
  where lecture.id = preliminary_row.lecture_session_id
  for update;

  select publication.*
  into publication_row
  from public.lecture_pdf_publications as publication
  where publication.id = target_publication_id
    and publication.lecture_session_id = lecture_row.id
  for update;

  if publication_row.ticket_admin_session_id
       <> target_ticket_admin_session_id
     or publication_row.allowed_origin <> target_allowed_origin
     or publication_row.document_id <> target_document_id
     or publication_row.expected_pdf_sha256 <> target_expected_pdf_sha256
     or publication_row.expected_byte_size <> target_expected_byte_size
     or target_lecture_public_id <>
       'lecture_' || replace(lecture_row.pdf_public_id::text, '-', '') then
    raise exception 'PDF upload ticket binding does not match'
      using errcode = '42501';
  end if;

  if publication_row.worker_attempt_id = target_worker_attempt_id
     and publication_row.nonce_used_at is not null
     and publication_row.ticket_generation = target_ticket_generation
     and publication_row.nonce_hash = target_nonce_hash
     and publication_row.ticket_jti_hash = target_ticket_jti_hash then
    return private.build_pdf_publication_result_v1(target_publication_id);
  end if;

  if not (
    lecture_row.status = 'draft'
    or private.is_lecture_open(lecture_row.id)
  ) then
    raise exception 'PDF upload is unavailable for this lecture'
      using errcode = 'P0001';
  end if;
  if publication_row.state <> 'pending'
     or publication_row.operation_expires_at <= effective_now
     or publication_row.ticket_expires_at <= effective_now
     or publication_row.ticket_generation <> target_ticket_generation
     or publication_row.nonce_hash <> target_nonce_hash
     or publication_row.ticket_jti_hash <> target_ticket_jti_hash
     or publication_row.nonce_used_at is not null
     then
    raise exception 'PDF upload ticket is stale, reused, or misbound'
      using errcode = '42501';
  end if;

  update public.lecture_pdf_publications as publication
  set
    nonce_used_at = effective_now,
    worker_attempt_id = target_worker_attempt_id,
    upload_lease_expires_at = least(
      publication.operation_expires_at,
      effective_now + interval '5 minutes'
    ),
    state_version = publication.state_version + 1,
    updated_at = effective_now
  where publication.id = target_publication_id;

  perform private.record_pdf_publication_event_v1(
    target_publication_id,
    lecture_row.id,
    'nonce_claimed',
    'worker',
    'worker-attempt:' || target_worker_attempt_id::text,
    'pending',
    'pending',
    jsonb_build_object('ticket_generation', target_ticket_generation)
  );

  return private.build_pdf_publication_result_v1(target_publication_id);
end;
$$;

create function public.worker_record_pdf_publication_uploaded_v1(
  target_publication_id uuid,
  target_worker_attempt_id uuid,
  target_actual_byte_size bigint,
  target_actual_pdf_sha256 text,
  target_pdf_magic_verified boolean,
  target_object_key text,
  target_r2_object_version text,
  target_object_etag text
)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  effective_now timestamptz := statement_timestamp();
  preliminary_row public.lecture_pdf_publications%rowtype;
  lecture_row public.lecture_sessions%rowtype;
  publication_row public.lecture_pdf_publications%rowtype;
  prior_state text;
  discard_state text;
  discard_reason text;
begin
  if target_publication_id is null
     or target_worker_attempt_id is null
     or target_actual_byte_size is null
     or target_actual_byte_size not between 1 and 15728640
     or target_actual_pdf_sha256 is null
     or target_actual_pdf_sha256 !~ '^[0-9a-f]{64}$'
     or target_pdf_magic_verified is not true
     or target_object_key is null
     or char_length(target_object_key) not between 1 and 512
     or target_object_key ~ '[[:cntrl:]]'
     or target_r2_object_version is null
     or char_length(target_r2_object_version) not between 1 and 512
     or target_r2_object_version ~ '[[:cntrl:]]'
     or target_object_etag is null
     or char_length(target_object_etag) not between 1 and 512
     or target_object_etag ~ '[[:cntrl:]]' then
    raise exception 'invalid verified PDF upload receipt'
      using errcode = '22023';
  end if;

  select publication.*
  into preliminary_row
  from public.lecture_pdf_publications as publication
  where publication.id = target_publication_id;

  if not found then
    raise exception 'PDF publication not found' using errcode = 'P0002';
  end if;

  perform private.close_lecture_if_expired(
    preliminary_row.lecture_session_id,
    'deadline_guard',
    'pdf-upload-receipt'
  );

  select lecture.*
  into lecture_row
  from public.lecture_sessions as lecture
  where lecture.id = preliminary_row.lecture_session_id
  for update;

  select publication.*
  into publication_row
  from public.lecture_pdf_publications as publication
  where publication.id = target_publication_id
    and publication.lecture_session_id = lecture_row.id
  for update;

  if publication_row.worker_attempt_id <> target_worker_attempt_id
     or publication_row.nonce_used_at is null
     or publication_row.expected_byte_size <> target_actual_byte_size
     or publication_row.expected_pdf_sha256 <> target_actual_pdf_sha256
     or target_object_key <>
       'pdf/' ||
       'lecture_' || replace(lecture_row.pdf_public_id::text, '-', '') || '/' ||
       publication_row.document_id || '/' ||
       publication_row.expected_pdf_sha256 || '/' ||
       publication_row.id::text || '.pdf' then
    raise exception 'verified PDF upload receipt is misbound'
      using errcode = '42501';
  end if;

  if publication_row.uploaded_at is not null then
    if publication_row.actual_byte_size <> target_actual_byte_size
       or publication_row.actual_pdf_sha256 <> target_actual_pdf_sha256
       or publication_row.pdf_magic_verified is not true
       or publication_row.r2_object_version <> target_r2_object_version
       or publication_row.r2_etag <> target_object_etag then
      raise exception 'verified PDF upload receipt changed on retry'
        using errcode = '23514';
    end if;
    return private.build_pdf_publication_result_v1(target_publication_id);
  end if;

  if publication_row.state not in ('pending', 'aborted', 'expired') then
    raise exception 'PDF publication cannot accept an upload receipt'
      using errcode = '55000';
  end if;

  prior_state := publication_row.state;

  if publication_row.state = 'pending'
     and publication_row.upload_lease_expires_at > effective_now
     and publication_row.operation_expires_at > effective_now
     and (
       lecture_row.status = 'draft'
       or private.is_lecture_open(lecture_row.id)
     ) then
    update public.lecture_pdf_publications as publication
    set
      state = 'uploaded',
      actual_byte_size = target_actual_byte_size,
      actual_pdf_sha256 = target_actual_pdf_sha256,
      pdf_magic_verified = true,
      r2_object_version = target_r2_object_version,
      r2_etag = target_object_etag,
      uploaded_at = effective_now,
      upload_lease_expires_at = null,
      state_version = publication.state_version + 1,
      last_error_code = null,
      updated_at = effective_now
    where publication.id = target_publication_id;

    perform private.record_pdf_publication_event_v1(
      target_publication_id,
      lecture_row.id,
      'uploaded',
      'worker',
      'worker-attempt:' || target_worker_attempt_id::text,
      prior_state,
      'uploaded',
      jsonb_build_object('verified_byte_size', target_actual_byte_size)
    );
  else
    discard_state := case
      when publication_row.state = 'aborted'
        or not (
          lecture_row.status = 'draft'
          or private.is_lecture_open(lecture_row.id)
        ) then 'aborted'
      else 'expired'
    end;
    discard_reason := case
      when discard_state = 'aborted' then 'lecture_closed_after_upload'
      else 'upload_lease_expired_after_upload'
    end;

    update public.lecture_pdf_publications as publication
    set
      state = discard_state,
      actual_byte_size = target_actual_byte_size,
      actual_pdf_sha256 = target_actual_pdf_sha256,
      pdf_magic_verified = true,
      r2_object_version = target_r2_object_version,
      r2_etag = target_object_etag,
      uploaded_at = effective_now,
      upload_lease_expires_at = null,
      aborted_at = case
        when discard_state = 'aborted'
          then coalesce(publication.aborted_at, effective_now)
        else null
      end,
      expired_at = case
        when discard_state = 'expired'
          then coalesce(publication.expired_at, effective_now)
        else null
      end,
      cleanup_after = effective_now,
      cleanup_claim_id = null,
      cleanup_lease_expires_at = null,
      cleanup_completed_at = null,
      state_version = publication.state_version + 1,
      last_error_code = discard_reason,
      updated_at = effective_now
    where publication.id = target_publication_id;

    perform private.record_pdf_publication_event_v1(
      target_publication_id,
      lecture_row.id,
      discard_state,
      'system',
      'pdf-upload-receipt-guard',
      prior_state,
      discard_state,
      jsonb_build_object(
        'reason', discard_reason,
        'verified_byte_size', target_actual_byte_size
      )
    );
  end if;

  return private.build_pdf_publication_result_v1(target_publication_id);
end;
$$;

create function public.admin_prepare_pdf_publication_commit_v1(
  target_publication_id uuid,
  target_commit_operation_id uuid,
  target_admin_session_id uuid,
  target_admin_auth_user_id uuid
)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  effective_now timestamptz := statement_timestamp();
  target_lecture_session_id uuid;
  lecture_row public.lecture_sessions%rowtype;
  publication_row public.lecture_pdf_publications%rowtype;
begin
  perform private.assert_tracked_pdf_admin_actor_v1(
    target_admin_session_id,
    target_admin_auth_user_id
  );

  if target_publication_id is null or target_commit_operation_id is null then
    raise exception 'invalid PDF commit preparation request'
      using errcode = '22023';
  end if;

  select publication.lecture_session_id
  into target_lecture_session_id
  from public.lecture_pdf_publications as publication
  where publication.id = target_publication_id;

  if not found then
    raise exception 'PDF publication not found' using errcode = 'P0002';
  end if;

  perform private.close_lecture_if_expired(
    target_lecture_session_id,
    'deadline_guard',
    'pdf-publication-commit-prepare'
  );

  select lecture.*
  into lecture_row
  from public.lecture_sessions as lecture
  where lecture.id = target_lecture_session_id
  for update;

  select publication.*
  into publication_row
  from public.lecture_pdf_publications as publication
  where publication.id = target_publication_id
    and publication.lecture_session_id = lecture_row.id
  for update;

  if publication_row.requested_by_auth_user_id <> target_admin_auth_user_id then
    raise exception 'PDF publication belongs to another Admin'
      using errcode = '42501';
  end if;
  if publication_row.state in ('committed', 'active', 'retired') then
    return private.build_pdf_publication_result_v1(target_publication_id);
  end if;
  if not (
    lecture_row.status = 'draft'
    or private.is_lecture_open(lecture_row.id)
  ) then
    raise exception 'PDF commit is unavailable for this lecture'
      using errcode = 'P0001';
  end if;
  if publication_row.state <> 'uploaded'
     or publication_row.operation_expires_at <= effective_now then
    raise exception 'PDF publication is not ready to commit'
      using errcode = '55000';
  end if;
  if publication_row.commit_operation_id is not null
     and publication_row.commit_operation_id <> target_commit_operation_id
     and publication_row.commit_lease_expires_at > effective_now then
    raise exception 'PDF commit is already in progress'
      using errcode = '55000';
  end if;

  update public.lecture_pdf_publications as publication
  set
    commit_operation_id = target_commit_operation_id,
    commit_lease_expires_at = least(
      publication.operation_expires_at,
      effective_now + interval '5 minutes'
    ),
    state_version = case
      when publication.commit_operation_id = target_commit_operation_id
        then publication.state_version
      else publication.state_version + 1
    end,
    updated_at = effective_now
  where publication.id = target_publication_id;

  if publication_row.commit_operation_id is distinct from target_commit_operation_id then
    perform private.record_pdf_publication_event_v1(
      target_publication_id,
      target_lecture_session_id,
      'commit_prepared',
      'admin',
      'admin-session:' || target_admin_session_id::text,
      'uploaded',
      'uploaded',
      jsonb_build_object('operation_id', target_commit_operation_id)
    );
  end if;

  return private.build_pdf_publication_result_v1(target_publication_id);
end;
$$;

create function public.admin_complete_pdf_publication_commit_v1(
  target_publication_id uuid,
  target_commit_operation_id uuid,
  target_manifest_version bigint,
  target_manifest_access_version bigint,
  target_manifest_etag text,
  target_admin_session_id uuid,
  target_admin_auth_user_id uuid
)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  effective_now timestamptz := statement_timestamp();
  target_lecture_session_id uuid;
  lecture_row public.lecture_sessions%rowtype;
  publication_row public.lecture_pdf_publications%rowtype;
begin
  perform private.assert_tracked_pdf_admin_actor_v1(
    target_admin_session_id,
    target_admin_auth_user_id
  );

  if target_publication_id is null
     or target_commit_operation_id is null
     or target_manifest_version is null
     or target_manifest_version < 1
     or target_manifest_access_version is null
     or target_manifest_access_version < 1
     or target_manifest_etag is null
     or char_length(target_manifest_etag) not between 1 and 512
     or target_manifest_etag ~ '[[:cntrl:]]' then
    raise exception 'invalid PDF commit completion request'
      using errcode = '22023';
  end if;

  select publication.lecture_session_id
  into target_lecture_session_id
  from public.lecture_pdf_publications as publication
  where publication.id = target_publication_id;

  if not found then
    raise exception 'PDF publication not found' using errcode = 'P0002';
  end if;

  perform private.close_lecture_if_expired(
    target_lecture_session_id,
    'deadline_guard',
    'pdf-publication-commit-complete'
  );

  select lecture.*
  into lecture_row
  from public.lecture_sessions as lecture
  where lecture.id = target_lecture_session_id
  for update;

  select publication.*
  into publication_row
  from public.lecture_pdf_publications as publication
  where publication.id = target_publication_id
    and publication.lecture_session_id = lecture_row.id
  for update;

  if publication_row.requested_by_auth_user_id <> target_admin_auth_user_id then
    raise exception 'PDF publication belongs to another Admin'
      using errcode = '42501';
  end if;

  if publication_row.state in ('committed', 'active', 'retired') then
    if publication_row.committed_manifest_version <> target_manifest_version
       or publication_row.committed_manifest_access_version
         <> target_manifest_access_version
       or publication_row.committed_manifest_etag <> target_manifest_etag then
      raise exception 'PDF commit receipt changed on retry'
        using errcode = '23514';
    end if;
    return private.build_pdf_publication_result_v1(target_publication_id);
  end if;

  if not (
    lecture_row.status = 'draft'
    or private.is_lecture_open(lecture_row.id)
  ) then
    raise exception 'PDF commit is unavailable for this lecture'
      using errcode = 'P0001';
  end if;
  if publication_row.state <> 'uploaded'
     or publication_row.commit_operation_id <> target_commit_operation_id
     or publication_row.commit_lease_expires_at <= effective_now
     or publication_row.operation_expires_at <= effective_now
     or target_manifest_access_version <> lecture_row.pdf_access_version then
    raise exception 'PDF commit receipt is stale or misbound'
      using errcode = '42501';
  end if;

  update public.lecture_pdf_publications as publication
  set
    state = 'committed',
    committed_manifest_version = target_manifest_version,
    committed_manifest_access_version = target_manifest_access_version,
    committed_manifest_etag = target_manifest_etag,
    committed_at = effective_now,
    commit_lease_expires_at = null,
    state_version = publication.state_version + 1,
    last_error_code = null,
    updated_at = effective_now
  where publication.id = target_publication_id;

  perform private.record_pdf_publication_event_v1(
    target_publication_id,
    target_lecture_session_id,
    'committed',
    'admin',
    'admin-session:' || target_admin_session_id::text,
    'uploaded',
    'committed',
    jsonb_build_object(
      'manifest_access_version', target_manifest_access_version,
      'manifest_version', target_manifest_version
    )
  );

  return private.build_pdf_publication_result_v1(target_publication_id);
end;
$$;

create function private.build_pdf_publication_result_v1(
  target_publication_id uuid
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'publication_id', publication.id,
    'client_request_id', publication.client_request_id,
    'lecture_session_id', publication.lecture_session_id,
    'lecture_public_id',
      'lecture_' || replace(lecture.pdf_public_id::text, '-', ''),
    'pdf_access_version', lecture.pdf_access_version,
    'document_id', publication.document_id,
    'document_version', publication.expected_pdf_sha256,
    'expected_pdf_sha256', publication.expected_pdf_sha256,
    'expected_byte_size', publication.expected_byte_size,
    'declared_page_count', publication.declared_page_count,
    'declared_text_char_count', publication.declared_text_char_count,
    'declared_text_sha256', publication.declared_text_sha256,
    'display_name', publication.display_name,
    'download_enabled', publication.download_enabled,
    'allowed_origin', publication.allowed_origin,
    'state', publication.state,
    'state_version', publication.state_version,
    'ticket_generation', publication.ticket_generation,
    'ticket_admin_session_id', publication.ticket_admin_session_id,
    'ticket_expires_at', publication.ticket_expires_at,
    'operation_expires_at', publication.operation_expires_at,
    'object_key',
      'pdf/' ||
      'lecture_' || replace(lecture.pdf_public_id::text, '-', '') || '/' ||
      publication.document_id || '/' ||
      publication.expected_pdf_sha256 || '/' ||
      publication.id::text || '.pdf',
    'nonce_used_at', publication.nonce_used_at,
    'worker_attempt_id', publication.worker_attempt_id,
    'upload_lease_expires_at', publication.upload_lease_expires_at,
    'actual_byte_size', publication.actual_byte_size,
    'actual_pdf_sha256', publication.actual_pdf_sha256,
    'pdf_magic_verified', publication.pdf_magic_verified,
    'r2_object_version', publication.r2_object_version,
    'r2_etag', publication.r2_etag,
    'uploaded_at', publication.uploaded_at
  ) || jsonb_build_object(
    'commit_operation_id', publication.commit_operation_id,
    'commit_lease_expires_at', publication.commit_lease_expires_at,
    'committed_manifest_version', publication.committed_manifest_version,
    'committed_manifest_access_version',
      publication.committed_manifest_access_version,
    'committed_manifest_etag', publication.committed_manifest_etag,
    'committed_at', publication.committed_at,
    'activation_operation_id', publication.activation_operation_id,
    'activation_lease_expires_at', publication.activation_lease_expires_at,
    'activation_target_access_version',
      publication.activation_target_access_version,
    'activated_manifest_version', publication.activated_manifest_version,
    'activated_manifest_etag', publication.activated_manifest_etag,
    'active_at', publication.active_at,
    'retired_at', publication.retired_at,
    'aborted_at', publication.aborted_at,
    'expired_at', publication.expired_at,
    'cleanup_after', publication.cleanup_after,
    'cleanup_claim_id', publication.cleanup_claim_id,
    'cleanup_lease_expires_at', publication.cleanup_lease_expires_at,
    'cleanup_attempt_count', publication.cleanup_attempt_count,
    'cleanup_completed_at', publication.cleanup_completed_at,
    'last_error_code', publication.last_error_code,
    'created_at', publication.created_at,
    'updated_at', publication.updated_at,
    'server_time', statement_timestamp()
  )
  from public.lecture_pdf_publications as publication
  join public.lecture_sessions as lecture
    on lecture.id = publication.lecture_session_id
  where publication.id = target_publication_id;
$$;

create function public.admin_prepare_pdf_publication_activation_v1(
  target_publication_id uuid,
  target_activation_operation_id uuid,
  target_admin_session_id uuid,
  target_admin_auth_user_id uuid
)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  effective_now timestamptz := statement_timestamp();
  target_lecture_session_id uuid;
  lecture_row public.lecture_sessions%rowtype;
  publication_row public.lecture_pdf_publications%rowtype;
  aggregate_bytes bigint;
  aggregate_pages bigint;
  aggregate_characters bigint;
begin
  perform private.assert_tracked_pdf_admin_actor_v1(
    target_admin_session_id,
    target_admin_auth_user_id
  );

  if target_publication_id is null
     or target_activation_operation_id is null then
    raise exception 'invalid PDF activation preparation request'
      using errcode = '22023';
  end if;

  select publication.lecture_session_id
  into target_lecture_session_id
  from public.lecture_pdf_publications as publication
  where publication.id = target_publication_id;

  if not found then
    raise exception 'PDF publication not found' using errcode = 'P0002';
  end if;

  perform private.close_lecture_if_expired(
    target_lecture_session_id,
    'deadline_guard',
    'pdf-publication-activation-prepare'
  );

  select lecture.*
  into lecture_row
  from public.lecture_sessions as lecture
  where lecture.id = target_lecture_session_id
  for update;

  select publication.*
  into publication_row
  from public.lecture_pdf_publications as publication
  where publication.id = target_publication_id
    and publication.lecture_session_id = lecture_row.id
  for update;

  if publication_row.requested_by_auth_user_id <> target_admin_auth_user_id then
    raise exception 'PDF publication belongs to another Admin'
      using errcode = '42501';
  end if;
  if publication_row.state in ('active', 'retired') then
    return private.build_pdf_publication_result_v1(target_publication_id);
  end if;
  if not (
    lecture_row.status = 'draft'
    or private.is_lecture_open(lecture_row.id)
  ) then
    raise exception 'PDF activation is unavailable for this lecture'
      using errcode = 'P0001';
  end if;
  if publication_row.state <> 'committed'
     or publication_row.operation_expires_at <= effective_now
     or publication_row.committed_manifest_access_version
       <> lecture_row.pdf_access_version then
    raise exception 'PDF publication is not ready to activate'
      using errcode = '55000';
  end if;
  if publication_row.activation_operation_id is not null
     and publication_row.activation_operation_id
       <> target_activation_operation_id
     and publication_row.activation_lease_expires_at > effective_now then
    raise exception 'PDF activation is already in progress'
      using errcode = '55000';
  end if;

  select
    coalesce(sum(document.byte_size), 0),
    coalesce(sum(document.page_count), 0),
    coalesce(sum(document.text_char_count), 0)
  into aggregate_bytes, aggregate_pages, aggregate_characters
  from public.lecture_pdf_documents as document
  where document.lecture_session_id = target_lecture_session_id
    and document.visible
    and document.document_id <> publication_row.document_id;

  if aggregate_bytes + publication_row.expected_byte_size > 15728640
     or aggregate_pages + publication_row.declared_page_count > 75
     or aggregate_characters + publication_row.declared_text_char_count
       > 20000 then
    raise exception 'lecture PDF aggregate limit exceeded'
      using errcode = '22023';
  end if;

  update public.lecture_pdf_publications as publication
  set
    activation_operation_id = target_activation_operation_id,
    activation_lease_expires_at = least(
      publication.operation_expires_at,
      effective_now + interval '5 minutes'
    ),
    activation_target_access_version = lecture_row.pdf_access_version + 1,
    state_version = case
      when publication.activation_operation_id = target_activation_operation_id
        then publication.state_version
      else publication.state_version + 1
    end,
    updated_at = effective_now
  where publication.id = target_publication_id;

  if publication_row.activation_operation_id
     is distinct from target_activation_operation_id then
    perform private.record_pdf_publication_event_v1(
      target_publication_id,
      target_lecture_session_id,
      'activation_prepared',
      'admin',
      'admin-session:' || target_admin_session_id::text,
      'committed',
      'committed',
      jsonb_build_object(
        'current_access_version', lecture_row.pdf_access_version,
        'target_access_version', lecture_row.pdf_access_version + 1
      )
    );
  end if;

  return private.build_pdf_publication_result_v1(target_publication_id);
end;
$$;

create function public.admin_complete_pdf_publication_activation_v1(
  target_publication_id uuid,
  target_activation_operation_id uuid,
  target_manifest_version bigint,
  target_manifest_access_version bigint,
  target_manifest_etag text,
  target_admin_session_id uuid,
  target_admin_auth_user_id uuid
)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  effective_now timestamptz := statement_timestamp();
  target_lecture_session_id uuid;
  lecture_row public.lecture_sessions%rowtype;
  publication_row public.lecture_pdf_publications%rowtype;
  registered_row public.lecture_pdf_documents%rowtype;
  prior_publication public.lecture_pdf_publications%rowtype;
  aggregate_bytes bigint;
  aggregate_pages bigint;
  aggregate_characters bigint;
  changed_count bigint;
begin
  perform private.assert_tracked_pdf_admin_actor_v1(
    target_admin_session_id,
    target_admin_auth_user_id
  );

  if target_publication_id is null
     or target_activation_operation_id is null
     or target_manifest_version is null
     or target_manifest_version < 1
     or target_manifest_access_version is null
     or target_manifest_access_version < 2
     or target_manifest_etag is null
     or char_length(target_manifest_etag) not between 1 and 512
     or target_manifest_etag ~ '[[:cntrl:]]' then
    raise exception 'invalid PDF activation completion request'
      using errcode = '22023';
  end if;

  select publication.lecture_session_id
  into target_lecture_session_id
  from public.lecture_pdf_publications as publication
  where publication.id = target_publication_id;

  if not found then
    raise exception 'PDF publication not found' using errcode = 'P0002';
  end if;

  perform private.close_lecture_if_expired(
    target_lecture_session_id,
    'deadline_guard',
    'pdf-publication-activation-complete'
  );

  select lecture.*
  into lecture_row
  from public.lecture_sessions as lecture
  where lecture.id = target_lecture_session_id
  for update;

  select publication.*
  into publication_row
  from public.lecture_pdf_publications as publication
  where publication.id = target_publication_id
    and publication.lecture_session_id = lecture_row.id
  for update;

  if publication_row.requested_by_auth_user_id <> target_admin_auth_user_id then
    raise exception 'PDF publication belongs to another Admin'
      using errcode = '42501';
  end if;

  if publication_row.state in ('active', 'retired') then
    if publication_row.activation_operation_id
         <> target_activation_operation_id
       or publication_row.activated_manifest_version
         <> target_manifest_version
       or publication_row.activation_target_access_version
         <> target_manifest_access_version
       or publication_row.activated_manifest_etag <> target_manifest_etag then
      raise exception 'PDF activation receipt changed on retry'
        using errcode = '23514';
    end if;
    return private.build_pdf_publication_result_v1(target_publication_id);
  end if;

  if lecture_row.status = 'closed' or publication_row.state = 'aborted' then
    if publication_row.state <> 'aborted' then
      update public.lecture_pdf_publications as publication
      set
        state = 'aborted',
        ticket_generation = publication.ticket_generation + 1,
        aborted_at = effective_now,
        cleanup_after = effective_now,
        state_version = publication.state_version + 1,
        last_error_code = 'lecture_closed_during_activation',
        updated_at = effective_now
      where publication.id = target_publication_id;

      perform private.record_pdf_publication_event_v1(
        target_publication_id,
        target_lecture_session_id,
        'aborted',
        'system',
        'pdf-activation-guard',
        publication_row.state,
        'aborted',
        jsonb_build_object('reason', 'lecture_closed_during_activation')
      );
    end if;
    return private.build_pdf_publication_result_v1(target_publication_id);
  end if;

  if not (
    lecture_row.status = 'draft'
    or private.is_lecture_open(lecture_row.id)
  )
     or publication_row.state <> 'committed'
     or publication_row.activation_operation_id
       <> target_activation_operation_id
     or publication_row.activation_lease_expires_at <= effective_now
     or publication_row.operation_expires_at <= effective_now
     or publication_row.activation_target_access_version
       <> target_manifest_access_version
     or target_manifest_access_version <> lecture_row.pdf_access_version + 1
     or target_manifest_version <= publication_row.committed_manifest_version then
    raise exception 'PDF activation receipt is stale or misbound'
      using errcode = '42501';
  end if;

  select
    coalesce(sum(document.byte_size), 0),
    coalesce(sum(document.page_count), 0),
    coalesce(sum(document.text_char_count), 0)
  into aggregate_bytes, aggregate_pages, aggregate_characters
  from public.lecture_pdf_documents as document
  where document.lecture_session_id = target_lecture_session_id
    and document.visible
    and document.document_id <> publication_row.document_id;

  if aggregate_bytes + publication_row.expected_byte_size > 15728640
     or aggregate_pages + publication_row.declared_page_count > 75
     or aggregate_characters + publication_row.declared_text_char_count
       > 20000 then
    raise exception 'lecture PDF aggregate limit exceeded'
      using errcode = '22023';
  end if;

  select document.*
  into registered_row
  from public.lecture_pdf_documents as document
  where document.lecture_session_id = target_lecture_session_id
    and document.document_id = publication_row.document_id
    and document.document_version = publication_row.expected_pdf_sha256
  for update;

  if found and (
    registered_row.display_name,
    registered_row.page_count,
    registered_row.byte_size,
    registered_row.text_char_count,
    registered_row.pdf_sha256,
    registered_row.text_sha256
  ) is distinct from (
    publication_row.display_name,
    publication_row.declared_page_count,
    publication_row.expected_byte_size,
    publication_row.declared_text_char_count,
    publication_row.expected_pdf_sha256,
    publication_row.declared_text_sha256
  ) then
    raise exception 'immutable PDF metadata does not match'
      using errcode = '23514';
  end if;

  if registered_row.lecture_session_id is not null
     and registered_row.browser_publication_id is not null
     and registered_row.browser_publication_id <> target_publication_id then
    raise exception 'PDF document version belongs to another publication'
      using errcode = '23514';
  end if;

  for prior_publication in
    select prior.*
    from public.lecture_pdf_publications as prior
    where prior.lecture_session_id = target_lecture_session_id
      and prior.document_id = publication_row.document_id
      and prior.id <> target_publication_id
      and prior.state = 'active'
    for update
  loop
    update public.lecture_pdf_publications as prior
    set
      state = 'retired',
      retired_at = effective_now,
      cleanup_after = effective_now + interval '7 days',
      state_version = prior.state_version + 1,
      updated_at = effective_now
    where prior.id = prior_publication.id;

    perform private.record_pdf_publication_event_v1(
      prior_publication.id,
      target_lecture_session_id,
      'retired',
      'admin',
      'admin-session:' || target_admin_session_id::text,
      'active',
      'retired',
      jsonb_build_object('replacement_publication_id', target_publication_id)
    );
  end loop;

  update public.lecture_pdf_documents as document
  set
    visible = false,
    retired_at = coalesce(document.retired_at, effective_now),
    archive_expires_at = coalesce(document.archive_expires_at, effective_now),
    delete_after = coalesce(
      document.delete_after,
      effective_now + interval '7 days'
    ),
    updated_at = effective_now
  where document.lecture_session_id = target_lecture_session_id
    and document.document_id = publication_row.document_id
    and document.document_version <> publication_row.expected_pdf_sha256
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
    updated_at,
    browser_publication_id
  ) values (
    target_lecture_session_id,
    publication_row.document_id,
    publication_row.expected_pdf_sha256,
    target_manifest_version,
    publication_row.display_name,
    publication_row.declared_page_count,
    publication_row.expected_byte_size,
    publication_row.declared_text_char_count,
    publication_row.expected_pdf_sha256,
    publication_row.declared_text_sha256,
    publication_row.download_enabled,
    true,
    lecture_row.archive_expires_at,
    case
      when lecture_row.archive_expires_at is null then null
      else lecture_row.archive_expires_at + interval '7 days'
    end,
    null,
    effective_now,
    target_publication_id
  )
  on conflict (lecture_session_id, document_id, document_version)
  do update set
    manifest_version = excluded.manifest_version,
    download_enabled = excluded.download_enabled,
    visible = true,
    archive_expires_at = excluded.archive_expires_at,
    delete_after = excluded.delete_after,
    retired_at = null,
    updated_at = excluded.updated_at,
    browser_publication_id = excluded.browser_publication_id;

  update public.lecture_sessions as lecture
  set
    pdf_access_version = target_manifest_access_version,
    updated_at = effective_now
  where lecture.id = target_lecture_session_id
    and lecture.pdf_access_version + 1 = target_manifest_access_version;

  get diagnostics changed_count = row_count;
  if changed_count <> 1 then
    raise exception 'PDF access-version fence changed during activation'
      using errcode = '40001';
  end if;

  update public.lecture_live_state as live
  set
    pdf_document_id = publication_row.document_id,
    pdf_document_version = publication_row.expected_pdf_sha256,
    pdf_manifest_version = target_manifest_version,
    pdf_page_count = publication_row.declared_page_count,
    pdf_visible = true,
    current_pdf_page = 1,
    display_version = live.display_version + 1,
    pdf_version = live.pdf_version + 1,
    state_version = live.state_version + 1,
    updated_at = effective_now
  where live.lecture_session_id = target_lecture_session_id;

  get diagnostics changed_count = row_count;
  if changed_count <> 1 then
    raise exception 'lecture live state is unavailable'
      using errcode = 'P0002';
  end if;

  update public.lecture_pdf_publications as publication
  set
    state = 'active',
    activated_manifest_version = target_manifest_version,
    activated_manifest_etag = target_manifest_etag,
    active_at = effective_now,
    activation_lease_expires_at = null,
    state_version = publication.state_version + 1,
    last_error_code = null,
    updated_at = effective_now
  where publication.id = target_publication_id;

  perform private.record_pdf_publication_event_v1(
    target_publication_id,
    target_lecture_session_id,
    'active',
    'admin',
    'admin-session:' || target_admin_session_id::text,
    'committed',
    'active',
    jsonb_build_object(
      'manifest_version', target_manifest_version,
      'published_access_version', target_manifest_access_version
    )
  );

  return private.build_pdf_publication_result_v1(target_publication_id);
end;
$$;

create function public.admin_abort_pdf_publication_v1(
  target_publication_id uuid,
  target_reason_code text,
  target_admin_session_id uuid,
  target_admin_auth_user_id uuid
)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  effective_now timestamptz := statement_timestamp();
  target_lecture_session_id uuid;
  lecture_row public.lecture_sessions%rowtype;
  publication_row public.lecture_pdf_publications%rowtype;
begin
  perform private.assert_tracked_pdf_admin_actor_v1(
    target_admin_session_id,
    target_admin_auth_user_id
  );

  if target_publication_id is null
     or target_reason_code is null
     or char_length(target_reason_code) not between 1 and 80
     or target_reason_code !~ '^[a-z0-9_:-]+$' then
    raise exception 'invalid PDF publication abort request'
      using errcode = '22023';
  end if;

  select publication.lecture_session_id
  into target_lecture_session_id
  from public.lecture_pdf_publications as publication
  where publication.id = target_publication_id;

  if not found then
    raise exception 'PDF publication not found' using errcode = 'P0002';
  end if;

  select lecture.*
  into lecture_row
  from public.lecture_sessions as lecture
  where lecture.id = target_lecture_session_id
  for update;

  select publication.*
  into publication_row
  from public.lecture_pdf_publications as publication
  where publication.id = target_publication_id
    and publication.lecture_session_id = lecture_row.id
  for update;

  if publication_row.requested_by_auth_user_id <> target_admin_auth_user_id then
    raise exception 'PDF publication belongs to another Admin'
      using errcode = '42501';
  end if;
  if publication_row.state in ('active', 'retired') then
    raise exception 'an active PDF publication cannot be aborted'
      using errcode = '55000';
  end if;
  if publication_row.state in ('aborted', 'expired') then
    return private.build_pdf_publication_result_v1(target_publication_id);
  end if;

  update public.lecture_pdf_publications as publication
  set
    state = 'aborted',
    ticket_generation = least(
      publication.ticket_generation::bigint + 1,
      2147483647::bigint
    )::integer,
    upload_lease_expires_at = null,
    commit_lease_expires_at = null,
    activation_lease_expires_at = null,
    aborted_at = effective_now,
    cleanup_after = effective_now,
    state_version = publication.state_version + 1,
    last_error_code = target_reason_code,
    updated_at = effective_now
  where publication.id = target_publication_id;

  perform private.record_pdf_publication_event_v1(
    target_publication_id,
    target_lecture_session_id,
    'aborted',
    'admin',
    'admin-session:' || target_admin_session_id::text,
    publication_row.state,
    'aborted',
    jsonb_build_object('reason', target_reason_code)
  );

  return private.build_pdf_publication_result_v1(target_publication_id);
end;
$$;

create function private.abort_pdf_publications_on_lecture_close_v1()
returns trigger
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  effective_now timestamptz := statement_timestamp();
  publication_row public.lecture_pdf_publications%rowtype;
begin
  if new.status <> 'closed' or old.status = 'closed' then
    return new;
  end if;

  for publication_row in
    select publication.*
    from public.lecture_pdf_publications as publication
    where publication.lecture_session_id = new.id
      and publication.state in ('pending', 'uploaded', 'committed')
    order by publication.id
    for update
  loop
    update public.lecture_pdf_publications as publication
    set
      state = 'aborted',
      ticket_generation = least(
        publication.ticket_generation::bigint + 1,
        2147483647::bigint
      )::integer,
      upload_lease_expires_at = null,
      commit_lease_expires_at = null,
      activation_lease_expires_at = null,
      aborted_at = effective_now,
      cleanup_after = effective_now,
      state_version = publication.state_version + 1,
      last_error_code = 'lecture_closed',
      updated_at = effective_now
    where publication.id = publication_row.id;

    perform private.record_pdf_publication_event_v1(
      publication_row.id,
      new.id,
      'aborted',
      'system',
      'lecture-close-trigger',
      publication_row.state,
      'aborted',
      jsonb_build_object(
        'close_actor_type', new.close_actor_type,
        'close_reason', new.close_reason
      )
    );
  end loop;

  return new;
end;
$$;

create trigger lecture_sessions_abort_browser_pdf_publications
after update of status on public.lecture_sessions
for each row execute function private.abort_pdf_publications_on_lecture_close_v1();

create function public.claim_due_pdf_publication_cleanup_v1(
  job_limit integer default 20,
  target_worker_id text default 'pdf-publication-cleanup'
)
returns setof jsonb
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  effective_now timestamptz := statement_timestamp();
  candidate_id uuid;
  preliminary_row public.lecture_pdf_publications%rowtype;
  lecture_row public.lecture_sessions%rowtype;
  publication_row public.lecture_pdf_publications%rowtype;
  new_claim_id uuid;
  claimed_count integer := 0;
begin
  if job_limit is null
     or job_limit not between 1 and 100
     or target_worker_id is null
     or char_length(target_worker_id) not between 1 and 200
     or target_worker_id ~ '[[:cntrl:]]' then
    raise exception 'invalid PDF cleanup claim request'
      using errcode = '22023';
  end if;

  for candidate_id in
    select publication.id
    from public.lecture_pdf_publications as publication
    where (
      publication.state in ('pending', 'uploaded', 'committed')
      and publication.operation_expires_at <= effective_now
    ) or (
      publication.state in ('retired', 'aborted', 'expired')
      and publication.cleanup_after <= effective_now
      and publication.cleanup_completed_at is null
      and (
        publication.cleanup_claim_id is null
        or publication.cleanup_lease_expires_at <= effective_now
      )
    )
    order by coalesce(
      publication.cleanup_after,
      publication.operation_expires_at
    ), publication.id
    limit job_limit * 4
  loop
    exit when claimed_count >= job_limit;

    select publication.*
    into preliminary_row
    from public.lecture_pdf_publications as publication
    where publication.id = candidate_id;

    if not found then
      continue;
    end if;

    perform private.close_lecture_if_expired(
      preliminary_row.lecture_session_id,
      'deadline_guard',
      'pdf-publication-cleanup-claim'
    );

    select lecture.*
    into lecture_row
    from public.lecture_sessions as lecture
    where lecture.id = preliminary_row.lecture_session_id
    for update;

    select publication.*
    into publication_row
    from public.lecture_pdf_publications as publication
    where publication.id = candidate_id
      and publication.lecture_session_id = lecture_row.id
    for update skip locked;

    if not found then
      continue;
    end if;

    if publication_row.state in ('pending', 'uploaded', 'committed')
       and publication_row.operation_expires_at <= effective_now then
      update public.lecture_pdf_publications as publication
      set
        state = 'expired',
        ticket_generation = least(
          publication.ticket_generation::bigint + 1,
          2147483647::bigint
        )::integer,
        upload_lease_expires_at = null,
        commit_lease_expires_at = null,
        activation_lease_expires_at = null,
        expired_at = effective_now,
        cleanup_after = effective_now,
        state_version = publication.state_version + 1,
        last_error_code = 'operation_expired',
        updated_at = effective_now
      where publication.id = candidate_id
      returning * into publication_row;

      perform private.record_pdf_publication_event_v1(
        candidate_id,
        lecture_row.id,
        'expired',
        'system',
        target_worker_id,
        preliminary_row.state,
        'expired',
        jsonb_build_object('reason', 'operation_expired')
      );
    end if;

    if publication_row.state not in ('retired', 'aborted', 'expired')
       or publication_row.cleanup_after > effective_now
       or publication_row.cleanup_completed_at is not null
       or (
         publication_row.cleanup_claim_id is not null
         and publication_row.cleanup_lease_expires_at > effective_now
       ) then
      continue;
    end if;

    new_claim_id := gen_random_uuid();
    update public.lecture_pdf_publications as publication
    set
      cleanup_claim_id = new_claim_id,
      cleanup_lease_expires_at = effective_now + interval '10 minutes',
      cleanup_attempt_count = publication.cleanup_attempt_count + 1,
      state_version = publication.state_version + 1,
      updated_at = effective_now
    where publication.id = candidate_id;

    perform private.record_pdf_publication_event_v1(
      candidate_id,
      lecture_row.id,
      'cleanup_claimed',
      'worker',
      target_worker_id,
      publication_row.state,
      publication_row.state,
      jsonb_build_object('cleanup_claim_id', new_claim_id)
    );

    claimed_count := claimed_count + 1;
    return next private.build_pdf_publication_result_v1(candidate_id);
  end loop;

  return;
end;
$$;

create function public.complete_pdf_publication_cleanup_v1(
  target_publication_id uuid,
  target_cleanup_claim_id uuid,
  target_succeeded boolean,
  target_error_code text,
  target_worker_id text default 'pdf-publication-cleanup'
)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  effective_now timestamptz := statement_timestamp();
  target_lecture_session_id uuid;
  lecture_row public.lecture_sessions%rowtype;
  publication_row public.lecture_pdf_publications%rowtype;
begin
  if target_publication_id is null
     or target_cleanup_claim_id is null
     or target_succeeded is null
     or target_worker_id is null
     or char_length(target_worker_id) not between 1 and 200
     or target_worker_id ~ '[[:cntrl:]]'
     or (
       not target_succeeded
       and (
         target_error_code is null
         or char_length(target_error_code) not between 1 and 80
         or target_error_code !~ '^[a-z0-9_:-]+$'
       )
     ) then
    raise exception 'invalid PDF cleanup completion request'
      using errcode = '22023';
  end if;

  select publication.lecture_session_id
  into target_lecture_session_id
  from public.lecture_pdf_publications as publication
  where publication.id = target_publication_id;

  if not found then
    raise exception 'PDF publication not found' using errcode = 'P0002';
  end if;

  select lecture.*
  into lecture_row
  from public.lecture_sessions as lecture
  where lecture.id = target_lecture_session_id
  for update;

  select publication.*
  into publication_row
  from public.lecture_pdf_publications as publication
  where publication.id = target_publication_id
    and publication.lecture_session_id = lecture_row.id
  for update;

  if publication_row.cleanup_completed_at is not null
     and publication_row.cleanup_claim_id = target_cleanup_claim_id then
    return private.build_pdf_publication_result_v1(target_publication_id);
  end if;
  if publication_row.state not in ('retired', 'aborted', 'expired')
     or publication_row.cleanup_claim_id <> target_cleanup_claim_id
     or publication_row.cleanup_lease_expires_at <= effective_now then
    raise exception 'PDF cleanup claim is stale or misbound'
      using errcode = '42501';
  end if;

  if target_succeeded then
    update public.lecture_pdf_publications as publication
    set
      cleanup_completed_at = effective_now,
      state_version = publication.state_version + 1,
      last_error_code = null,
      updated_at = effective_now
    where publication.id = target_publication_id;

    perform private.record_pdf_publication_event_v1(
      target_publication_id,
      target_lecture_session_id,
      'cleanup_completed',
      'worker',
      target_worker_id,
      publication_row.state,
      publication_row.state,
      jsonb_build_object('cleanup_claim_id', target_cleanup_claim_id)
    );
  else
    update public.lecture_pdf_publications as publication
    set
      cleanup_claim_id = null,
      cleanup_lease_expires_at = null,
      cleanup_after = effective_now + interval '5 minutes',
      state_version = publication.state_version + 1,
      last_error_code = target_error_code,
      updated_at = effective_now
    where publication.id = target_publication_id;

    perform private.record_pdf_publication_event_v1(
      target_publication_id,
      target_lecture_session_id,
      'cleanup_failed',
      'worker',
      target_worker_id,
      publication_row.state,
      publication_row.state,
      jsonb_build_object('error_code', target_error_code)
    );
  end if;

  return private.build_pdf_publication_result_v1(target_publication_id);
end;
$$;

revoke all on function private.assert_tracked_pdf_admin_actor_v1(uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.record_pdf_publication_event_v1(
  uuid, uuid, text, text, text, text, text, jsonb
) from public, anon, authenticated, service_role;
revoke all on function private.build_pdf_publication_result_v1(uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.abort_pdf_publications_on_lecture_close_v1()
  from public, anon, authenticated, service_role;

grant execute on function private.assert_tracked_pdf_admin_actor_v1(uuid, uuid)
  to service_role;
grant execute on function private.record_pdf_publication_event_v1(
  uuid, uuid, text, text, text, text, text, jsonb
) to service_role;
grant execute on function private.build_pdf_publication_result_v1(uuid)
  to service_role;
grant execute on function private.abort_pdf_publications_on_lecture_close_v1()
  to service_role;

revoke all on function public.admin_create_pdf_publication_v1(
  uuid, text, text, bigint, integer, integer, text, text, boolean, text,
  uuid, text, text, uuid, uuid
) from public, anon, authenticated, service_role;
revoke all on function public.admin_reissue_pdf_publication_ticket_v1(
  uuid, text, text, uuid, uuid
) from public, anon, authenticated, service_role;
revoke all on function public.admin_get_pdf_publication_v1(uuid, uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.admin_find_inflight_pdf_publication_v1(
  uuid, uuid, uuid
) from public, anon, authenticated, service_role;
revoke all on function public.worker_claim_pdf_publication_nonce_v1(
  uuid, integer, text, text, text, text, text, bigint, text, uuid, uuid
) from public, anon, authenticated, service_role;
revoke all on function public.worker_record_pdf_publication_uploaded_v1(
  uuid, uuid, bigint, text, boolean, text, text, text
) from public, anon, authenticated, service_role;
revoke all on function public.admin_prepare_pdf_publication_commit_v1(
  uuid, uuid, uuid, uuid
) from public, anon, authenticated, service_role;
revoke all on function public.admin_complete_pdf_publication_commit_v1(
  uuid, uuid, bigint, bigint, text, uuid, uuid
) from public, anon, authenticated, service_role;
revoke all on function public.admin_prepare_pdf_publication_activation_v1(
  uuid, uuid, uuid, uuid
) from public, anon, authenticated, service_role;
revoke all on function public.admin_complete_pdf_publication_activation_v1(
  uuid, uuid, bigint, bigint, text, uuid, uuid
) from public, anon, authenticated, service_role;
revoke all on function public.admin_abort_pdf_publication_v1(
  uuid, text, uuid, uuid
) from public, anon, authenticated, service_role;
revoke all on function public.claim_due_pdf_publication_cleanup_v1(integer, text)
  from public, anon, authenticated, service_role;
revoke all on function public.complete_pdf_publication_cleanup_v1(
  uuid, uuid, boolean, text, text
) from public, anon, authenticated, service_role;

grant execute on function public.admin_create_pdf_publication_v1(
  uuid, text, text, bigint, integer, integer, text, text, boolean, text,
  uuid, text, text, uuid, uuid
) to service_role;
grant execute on function public.admin_reissue_pdf_publication_ticket_v1(
  uuid, text, text, uuid, uuid
) to service_role;
grant execute on function public.admin_get_pdf_publication_v1(uuid, uuid, uuid)
  to service_role;
grant execute on function public.admin_find_inflight_pdf_publication_v1(
  uuid, uuid, uuid
) to service_role;
grant execute on function public.worker_claim_pdf_publication_nonce_v1(
  uuid, integer, text, text, text, text, text, bigint, text, uuid, uuid
) to service_role;
grant execute on function public.worker_record_pdf_publication_uploaded_v1(
  uuid, uuid, bigint, text, boolean, text, text, text
) to service_role;
grant execute on function public.admin_prepare_pdf_publication_commit_v1(
  uuid, uuid, uuid, uuid
) to service_role;
grant execute on function public.admin_complete_pdf_publication_commit_v1(
  uuid, uuid, bigint, bigint, text, uuid, uuid
) to service_role;
grant execute on function public.admin_prepare_pdf_publication_activation_v1(
  uuid, uuid, uuid, uuid
) to service_role;
grant execute on function public.admin_complete_pdf_publication_activation_v1(
  uuid, uuid, bigint, bigint, text, uuid, uuid
) to service_role;
grant execute on function public.admin_abort_pdf_publication_v1(
  uuid, text, uuid, uuid
) to service_role;
grant execute on function public.claim_due_pdf_publication_cleanup_v1(
  integer, text
) to service_role;
grant execute on function public.complete_pdf_publication_cleanup_v1(
  uuid, uuid, boolean, text, text
) to service_role;

comment on table public.lecture_pdf_publications is
  'Phase 7.26 service-only browser PDF publication saga; contains metadata and hashed one-time ticket state, never PDF bytes or extracted text.';
comment on table public.lecture_pdf_publication_events is
  'Append-only, content-free audit trail for browser PDF publication state transitions.';
comment on column public.lecture_pdf_documents.browser_publication_id is
  'Optional Phase 7.26 browser-publication provenance; NULL preserves Local Publisher compatibility.';
comment on function public.worker_claim_pdf_publication_nonce_v1(
  uuid, integer, text, text, text, text, text, bigint, text, uuid, uuid
) is
  'Atomically consumes a server-issued upload nonce after ticket, Origin and lecture/document binding validation.';
comment on function public.worker_record_pdf_publication_uploaded_v1(
  uuid, uuid, bigint, text, boolean, text, text, text
) is
  'Records an immutable Worker receipt only after exact byte, SHA-256, PDF magic, attempt and deterministic R2 object-key binding validation.';
comment on function public.admin_complete_pdf_publication_activation_v1(
  uuid, uuid, bigint, bigint, text, uuid, uuid
) is
  'Publishes the future PDF access-version fence, metadata and live-state pointer in one PostgreSQL transaction after Worker manifest activation.';
