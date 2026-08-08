-- Phase 7.29: PowerPoint Presenter Bridge.
--
-- Expand-first and default OFF. PowerPoint/PDF bytes, slide text, local paths,
-- raw pairing material, and connector capabilities never enter PostgreSQL.

create table private.presenter_runtime_gate (
  singleton boolean primary key default true check (singleton),
  enabled boolean not null default false,
  updated_at timestamptz not null default statement_timestamp()
);

insert into private.presenter_runtime_gate (singleton, enabled)
values (true, false);

alter table private.presenter_runtime_gate enable row level security;
revoke all on private.presenter_runtime_gate
  from public, anon, authenticated;
grant select, update on private.presenter_runtime_gate to service_role;

create table public.presenter_connections (
  id uuid primary key default gen_random_uuid(),
  lecture_session_id uuid not null
    references public.lecture_sessions(id) on delete restrict,
  admin_session_id uuid not null
    references public.admin_sessions(id) on delete restrict,
  admin_auth_user_id uuid not null,
  state text not null default 'pairing'
    check (state in ('pairing', 'inspected', 'confirmed', 'active', 'revoked')),
  ticket_jti_hash text not null unique
    check (ticket_jti_hash ~ '^[0-9a-f]{64}$'),
  manual_code_hmac text not null unique
    check (manual_code_hmac ~ '^[0-9a-f]{64}$'),
  ticket_expires_at timestamptz not null,
  ticket_consumed_at timestamptz,
  installation_hash text
    check (installation_hash is null or installation_hash ~ '^[0-9a-f]{64}$'),
  capability_jti_hash text unique
    check (capability_jti_hash is null or capability_jti_hash ~ '^[0-9a-f]{64}$'),
  capability_expires_at timestamptz,
  inspected_at timestamptz,
  confirmed_at timestamptz,
  claimed_at timestamptz,
  pdf_document_id text not null,
  pdf_document_version text not null
    check (pdf_document_version ~ '^[0-9a-f]{64}$'),
  pdf_manifest_version bigint not null check (pdf_manifest_version >= 1),
  pdf_page_count integer not null check (pdf_page_count between 1 and 75),
  pptx_file_sha256 text
    check (pptx_file_sha256 is null or pptx_file_sha256 ~ '^[0-9a-f]{64}$'),
  slide_id_order_sha256 text
    check (
      slide_id_order_sha256 is null
      or slide_id_order_sha256 ~ '^[0-9a-f]{64}$'
    ),
  slide_count integer check (slide_count between 1 and 75),
  hidden_slide_count integer check (hidden_slide_count between 0 and 75),
  custom_show_active boolean,
  last_sequence bigint not null default -1 check (last_sequence >= -1),
  last_event_id uuid,
  last_slide_id integer check (last_slide_id is null or last_slide_id > 0),
  last_slide_index integer check (
    last_slide_index is null or last_slide_index between 1 and 75
  ),
  last_committed_pdf_page integer check (
    last_committed_pdf_page is null
    or last_committed_pdf_page between 1 and 75
  ),
  last_request_at timestamptz,
  last_seen_at timestamptz,
  issued_at timestamptz not null default statement_timestamp(),
  hard_stop_at timestamptz not null,
  revoked_at timestamptz,
  revoke_reason text check (
    revoke_reason is null or char_length(revoke_reason) between 1 and 80
  ),
  updated_at timestamptz not null default statement_timestamp(),
  check (issued_at < ticket_expires_at),
  check (ticket_expires_at <= issued_at + interval '60 seconds'),
  check (ticket_expires_at <= hard_stop_at),
  check (
    (installation_hash is null and inspected_at is null)
    or (installation_hash is not null and inspected_at is not null)
  ),
  check (
    state in ('pairing', 'revoked')
    or (
      pptx_file_sha256 is not null
      and slide_id_order_sha256 is not null
      and slide_count is not null
      and hidden_slide_count is not null
      and custom_show_active is not null
    )
  ),
  check (
    state not in ('confirmed', 'active')
    or (
      confirmed_at is not null
      and slide_count = pdf_page_count
      and hidden_slide_count = 0
      and not custom_show_active
    )
  ),
  check (
    state <> 'active'
    or (
      ticket_consumed_at is not null
      and capability_jti_hash is not null
      and capability_expires_at is not null
      and claimed_at is not null
      and capability_expires_at <= hard_stop_at
    )
  ),
  check ((state = 'revoked') = (revoked_at is not null)),
  check ((revoked_at is null) = (revoke_reason is null))
);

create unique index presenter_connections_one_unrevoked_per_lecture_idx
  on public.presenter_connections (lecture_session_id)
  where revoked_at is null;

create index presenter_connections_lecture_idx
  on public.presenter_connections (lecture_session_id);

create index presenter_connections_admin_session_idx
  on public.presenter_connections (admin_session_id);

create index presenter_connections_admin_active_idx
  on public.presenter_connections (
    admin_session_id,
    capability_expires_at,
    lecture_session_id
  )
  where revoked_at is null;

create index presenter_connections_owner_status_idx
  on public.presenter_connections (
    admin_auth_user_id,
    lecture_session_id,
    issued_at desc
  );

create index presenter_connections_cleanup_idx
  on public.presenter_connections (
    coalesce(last_seen_at, capability_expires_at, ticket_expires_at),
    id
  ) where revoked_at is null;

create index presenter_connections_revoked_cleanup_idx
  on public.presenter_connections (revoked_at, id)
  where revoked_at is not null;

create index presenter_connections_heartbeat_expiry_idx
  on public.presenter_connections (last_seen_at, lecture_session_id)
  where state = 'active' and revoked_at is null;

create table public.presenter_connection_events (
  id bigint generated always as identity primary key,
  connection_id uuid not null
    references public.presenter_connections(id) on delete cascade,
  lecture_session_id uuid not null
    references public.lecture_sessions(id) on delete restrict,
  event_type text not null check (
    event_type in (
      'issued',
      'inspected',
      'confirmed',
      'claimed',
      'manual_handover',
      'document_changed',
      'deck_changed',
      'lecture_closed',
      'admin_revoked',
      'feature_disabled',
      'expired',
      'disconnected',
      'session_replaced'
    )
  ),
  actor_id text not null check (char_length(actor_id) between 1 and 200),
  created_at timestamptz not null default statement_timestamp()
);

create index presenter_connection_events_connection_idx
  on public.presenter_connection_events (connection_id, created_at desc);

create index presenter_connection_events_lecture_idx
  on public.presenter_connection_events (lecture_session_id, created_at desc);

alter table public.presenter_connections enable row level security;
alter table public.presenter_connection_events enable row level security;

revoke all on public.presenter_connections
  from public, anon, authenticated;
revoke all on public.presenter_connection_events
  from public, anon, authenticated;

grant select, insert, update, delete on public.presenter_connections
  to service_role;
grant select, insert, delete on public.presenter_connection_events
  to service_role;
grant usage, select on sequence public.presenter_connection_events_id_seq
  to service_role;

create function private.record_presenter_connection_event_v1(
  target_connection_id uuid,
  target_event_type text,
  target_actor_id text
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  insert into public.presenter_connection_events (
    connection_id,
    lecture_session_id,
    event_type,
    actor_id
  )
  select
    connection.id,
    connection.lecture_session_id,
    target_event_type,
    left(target_actor_id, 200)
  from public.presenter_connections as connection
  where connection.id = target_connection_id;
end;
$$;

revoke all on function private.record_presenter_connection_event_v1(
  uuid, text, text
) from public, anon, authenticated;
grant execute on function private.record_presenter_connection_event_v1(
  uuid, text, text
) to service_role;

create function public.issue_presenter_connection_v1(
  target_lecture_session_id uuid,
  target_admin_session_id uuid,
  target_admin_auth_user_id uuid,
  target_ticket_jti_hash text,
  target_manual_code_hmac text,
  target_ticket_expires_at timestamptz
)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  gate_row private.presenter_runtime_gate%rowtype;
  admin_row public.admin_sessions%rowtype;
  lecture_row public.lecture_sessions%rowtype;
  live_row public.lecture_live_state%rowtype;
  created_row public.presenter_connections%rowtype;
  effective_now timestamptz := statement_timestamp();
begin
  if target_ticket_jti_hash !~ '^[0-9a-f]{64}$'
     or target_manual_code_hmac !~ '^[0-9a-f]{64}$'
     or target_ticket_expires_at <= effective_now
     or target_ticket_expires_at > effective_now + interval '60 seconds' then
    raise exception 'Invalid Presenter pairing request.' using errcode = '22023';
  end if;

  select gate.* into gate_row
  from private.presenter_runtime_gate as gate
  where gate.singleton
  for update;

  if not gate_row.enabled then
    raise exception 'Presenter integration is disabled.' using errcode = 'P7290';
  end if;

  select session.* into admin_row
  from public.admin_sessions as session
  where session.id = target_admin_session_id
    and session.auth_user_id = target_admin_auth_user_id
  for update;

  if not found
     or admin_row.revoked_at is not null
     or admin_row.expires_at <= effective_now
     or admin_row.idle_expires_at <= effective_now then
    raise exception 'Invalid Admin session.' using errcode = '42501';
  end if;

  select lecture.* into lecture_row
  from public.lecture_sessions as lecture
  where lecture.id = target_lecture_session_id
  for update;

  if not found
     or lecture_row.status <> 'open'
     or lecture_row.hard_stop_at is null
     or lecture_row.hard_stop_at <= effective_now then
    raise exception 'Only an open lecture can use Presenter sync.'
      using errcode = 'P7292';
  end if;

  select live.* into live_row
  from public.lecture_live_state as live
  where live.lecture_session_id = target_lecture_session_id
  for update;

  if not found
     or not live_row.pdf_visible
     or live_row.pdf_document_id is null
     or live_row.pdf_document_version is null
     or live_row.pdf_manifest_version < 1
     or live_row.pdf_page_count is null
     or not exists (
       select 1
       from public.lecture_pdf_documents as document
       where document.lecture_session_id = target_lecture_session_id
         and document.document_id = live_row.pdf_document_id
         and document.document_version = live_row.pdf_document_version
         and document.manifest_version <= live_row.pdf_manifest_version
         and document.page_count = live_row.pdf_page_count
         and document.visible
     ) then
    raise exception 'A published lecture PDF is required.' using errcode = 'P7293';
  end if;

  with revoked as (
    update public.presenter_connections as connection
    set
      state = 'revoked',
      revoked_at = effective_now,
      revoke_reason = 'session_replaced',
      updated_at = effective_now
    where connection.lecture_session_id = target_lecture_session_id
      and connection.revoked_at is null
    returning connection.id, connection.lecture_session_id
  )
  insert into public.presenter_connection_events (
    connection_id,
    lecture_session_id,
    event_type,
    actor_id,
    created_at
  )
  select
    id,
    lecture_session_id,
    'session_replaced',
    'admin-session:' || target_admin_session_id::text,
    effective_now
  from revoked;

  insert into public.presenter_connections (
    lecture_session_id,
    admin_session_id,
    admin_auth_user_id,
    ticket_jti_hash,
    manual_code_hmac,
    ticket_expires_at,
    pdf_document_id,
    pdf_document_version,
    pdf_manifest_version,
    pdf_page_count,
    last_committed_pdf_page,
    issued_at,
    hard_stop_at,
    updated_at
  ) values (
    target_lecture_session_id,
    target_admin_session_id,
    target_admin_auth_user_id,
    target_ticket_jti_hash,
    target_manual_code_hmac,
    least(
      target_ticket_expires_at,
      lecture_row.hard_stop_at,
      admin_row.expires_at
    ),
    live_row.pdf_document_id,
    live_row.pdf_document_version,
    live_row.pdf_manifest_version,
    live_row.pdf_page_count,
    live_row.current_pdf_page,
    effective_now,
    least(lecture_row.hard_stop_at, admin_row.expires_at),
    effective_now
  )
  returning * into created_row;

  perform private.record_presenter_connection_event_v1(
    created_row.id,
    'issued',
    'admin-session:' || target_admin_session_id::text
  );

  return jsonb_build_object(
    'connection_id', created_row.id,
    'hard_stop_at', created_row.hard_stop_at,
    'pdf_document_id', created_row.pdf_document_id,
    'pdf_document_version', created_row.pdf_document_version,
    'pdf_manifest_version', created_row.pdf_manifest_version,
    'pdf_page_count', created_row.pdf_page_count,
    'ticket_expires_at', created_row.ticket_expires_at
  );
end;
$$;

create function public.inspect_presenter_connection_v1(
  target_connection_id uuid,
  target_credential_kind text,
  target_credential_hash text,
  target_installation_hash text,
  target_pptx_file_sha256 text,
  target_slide_id_order_sha256 text,
  target_slide_count integer,
  target_hidden_slide_count integer,
  target_custom_show_active boolean
)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  gate_row private.presenter_runtime_gate%rowtype;
  resolved_connection_id uuid;
  admin_id uuid;
  admin_row public.admin_sessions%rowtype;
  lecture_id uuid;
  lecture_row public.lecture_sessions%rowtype;
  live_row public.lecture_live_state%rowtype;
  connection_row public.presenter_connections%rowtype;
  effective_now timestamptz := statement_timestamp();
begin
  if target_credential_kind not in ('ticket', 'manual_code')
     or target_credential_hash !~ '^[0-9a-f]{64}$'
     or target_installation_hash !~ '^[0-9a-f]{64}$'
     or target_pptx_file_sha256 !~ '^[0-9a-f]{64}$'
     or target_slide_id_order_sha256 !~ '^[0-9a-f]{64}$'
     or target_slide_count not between 1 and 75
     or target_hidden_slide_count not between 0 and 75 then
    raise exception 'Invalid Presenter inspection.' using errcode = '22023';
  end if;

  select gate.* into gate_row
  from private.presenter_runtime_gate as gate
  where gate.singleton
  for update;
  if not gate_row.enabled then
    raise exception 'Presenter integration is disabled.' using errcode = 'P7290';
  end if;

  select
    connection.id,
    connection.admin_session_id,
    connection.lecture_session_id
  into resolved_connection_id, admin_id, lecture_id
  from public.presenter_connections as connection
  where (
      target_credential_kind = 'ticket'
      and connection.id = target_connection_id
      and connection.ticket_jti_hash = target_credential_hash
    )
    or (
      target_credential_kind = 'manual_code'
      and connection.manual_code_hmac = target_credential_hash
    );
  if lecture_id is null then
    return null;
  end if;

  select session.* into admin_row
  from public.admin_sessions as session
  where session.id = admin_id
  for update;
  if not found
     or admin_row.revoked_at is not null
     or admin_row.expires_at <= effective_now
     or admin_row.idle_expires_at <= effective_now then
    return null;
  end if;

  select lecture.* into lecture_row
  from public.lecture_sessions as lecture
  where lecture.id = lecture_id
  for update;

  select live.* into live_row
  from public.lecture_live_state as live
  where live.lecture_session_id = lecture_id
  for update;

  select connection.* into connection_row
  from public.presenter_connections as connection
  where connection.id = resolved_connection_id
  for update;

  if connection_row.revoked_at is not null
     or connection_row.ticket_expires_at <= effective_now
     or lecture_row.status <> 'open'
     or lecture_row.hard_stop_at <= effective_now
     or connection_row.pdf_document_id is distinct from live_row.pdf_document_id
     or connection_row.pdf_document_version is distinct from live_row.pdf_document_version
     or connection_row.pdf_manifest_version is distinct from live_row.pdf_manifest_version
     or connection_row.pdf_page_count is distinct from live_row.pdf_page_count
     or (
       target_credential_kind = 'ticket'
       and connection_row.ticket_jti_hash <> target_credential_hash
     )
     or (
       target_credential_kind = 'manual_code'
       and connection_row.manual_code_hmac <> target_credential_hash
     ) then
    return null;
  end if;

  if connection_row.installation_hash is not null
     and connection_row.installation_hash <> target_installation_hash then
    return null;
  end if;

  if connection_row.state = 'pairing' then
    update public.presenter_connections as connection
    set
      state = 'inspected',
      installation_hash = target_installation_hash,
      pptx_file_sha256 = target_pptx_file_sha256,
      slide_id_order_sha256 = target_slide_id_order_sha256,
      slide_count = target_slide_count,
      hidden_slide_count = target_hidden_slide_count,
      custom_show_active = target_custom_show_active,
      inspected_at = effective_now,
      last_seen_at = effective_now,
      updated_at = effective_now
    where connection.id = resolved_connection_id
    returning * into connection_row;

    perform private.record_presenter_connection_event_v1(
      connection_row.id,
      'inspected',
      'presenter-installation'
    );
  elsif connection_row.installation_hash <> target_installation_hash
        or connection_row.pptx_file_sha256 <> target_pptx_file_sha256
        or connection_row.slide_id_order_sha256 <> target_slide_id_order_sha256
        or connection_row.slide_count <> target_slide_count
        or connection_row.hidden_slide_count <> target_hidden_slide_count
        or connection_row.custom_show_active <> target_custom_show_active then
    return null;
  end if;

  return jsonb_build_object(
    'connection_id', connection_row.id,
    'hard_stop_at', connection_row.hard_stop_at,
    'lecture_session_id', connection_row.lecture_session_id,
    'pdf_document_id', connection_row.pdf_document_id,
    'pdf_document_version', connection_row.pdf_document_version,
    'pdf_manifest_version', connection_row.pdf_manifest_version,
    'pdf_page_count', connection_row.pdf_page_count,
    'state', connection_row.state,
    'ticket_expires_at', connection_row.ticket_expires_at
  );
end;
$$;

create function public.confirm_presenter_connection_v1(
  target_connection_id uuid,
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
  gate_row private.presenter_runtime_gate%rowtype;
  admin_row public.admin_sessions%rowtype;
  lecture_id uuid;
  lecture_row public.lecture_sessions%rowtype;
  live_row public.lecture_live_state%rowtype;
  connection_row public.presenter_connections%rowtype;
  effective_now timestamptz := statement_timestamp();
begin
  select gate.* into gate_row
  from private.presenter_runtime_gate as gate
  where gate.singleton
  for update;
  if not gate_row.enabled then
    raise exception 'Presenter integration is disabled.' using errcode = 'P7290';
  end if;

  select session.* into admin_row
  from public.admin_sessions as session
  where session.id = target_admin_session_id
    and session.auth_user_id = target_admin_auth_user_id
  for update;
  if not found
     or admin_row.revoked_at is not null
     or admin_row.expires_at <= effective_now
     or admin_row.idle_expires_at <= effective_now then
    raise exception 'Invalid Admin session.' using errcode = '42501';
  end if;

  select connection.lecture_session_id into lecture_id
  from public.presenter_connections as connection
  where connection.id = target_connection_id;
  if lecture_id is null then
    return null;
  end if;

  select lecture.* into lecture_row
  from public.lecture_sessions as lecture
  where lecture.id = lecture_id
  for update;

  select live.* into live_row
  from public.lecture_live_state as live
  where live.lecture_session_id = lecture_id
  for update;

  select connection.* into connection_row
  from public.presenter_connections as connection
  where connection.id = target_connection_id
  for update;

  if connection_row.admin_session_id <> target_admin_session_id
     or connection_row.admin_auth_user_id <> target_admin_auth_user_id
     or connection_row.revoked_at is not null
     or connection_row.ticket_expires_at <= effective_now
     or lecture_row.status <> 'open'
     or lecture_row.hard_stop_at <= effective_now
     or connection_row.state not in ('inspected', 'confirmed')
     or connection_row.pdf_document_id is distinct from live_row.pdf_document_id
     or connection_row.pdf_document_version is distinct from live_row.pdf_document_version
     or connection_row.pdf_manifest_version is distinct from live_row.pdf_manifest_version
     or connection_row.pdf_page_count is distinct from live_row.pdf_page_count then
    return null;
  end if;

  if connection_row.slide_count <> connection_row.pdf_page_count
     or connection_row.hidden_slide_count <> 0
     or connection_row.custom_show_active then
    raise exception 'This presentation cannot be synchronized.'
      using errcode = 'P7294';
  end if;

  if connection_row.state = 'inspected' then
    update public.presenter_connections as connection
    set
      state = 'confirmed',
      confirmed_at = effective_now,
      updated_at = effective_now
    where connection.id = target_connection_id
    returning * into connection_row;

    perform private.record_presenter_connection_event_v1(
      connection_row.id,
      'confirmed',
      'admin-session:' || target_admin_session_id::text
    );
  end if;

  return jsonb_build_object(
    'connection_id', connection_row.id,
    'pdf_page_count', connection_row.pdf_page_count,
    'state', connection_row.state
  );
end;
$$;

create function public.claim_presenter_connection_v1(
  target_connection_id uuid,
  target_credential_kind text,
  target_credential_hash text,
  target_installation_hash text,
  target_capability_jti_hash text
)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  gate_row private.presenter_runtime_gate%rowtype;
  admin_id uuid;
  admin_row public.admin_sessions%rowtype;
  lecture_id uuid;
  lecture_row public.lecture_sessions%rowtype;
  live_row public.lecture_live_state%rowtype;
  connection_row public.presenter_connections%rowtype;
  effective_now timestamptz := statement_timestamp();
begin
  if target_credential_kind not in ('ticket', 'manual_code')
     or target_credential_hash !~ '^[0-9a-f]{64}$'
     or target_installation_hash !~ '^[0-9a-f]{64}$'
     or target_capability_jti_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'Invalid Presenter claim.' using errcode = '22023';
  end if;

  select gate.* into gate_row
  from private.presenter_runtime_gate as gate
  where gate.singleton
  for update;
  if not gate_row.enabled then
    raise exception 'Presenter integration is disabled.' using errcode = 'P7290';
  end if;

  select connection.admin_session_id, connection.lecture_session_id
  into admin_id, lecture_id
  from public.presenter_connections as connection
  where connection.id = target_connection_id;
  if lecture_id is null then
    return null;
  end if;

  select session.* into admin_row
  from public.admin_sessions as session
  where session.id = admin_id
  for update;
  if not found
     or admin_row.revoked_at is not null
     or admin_row.expires_at <= effective_now
     or admin_row.idle_expires_at <= effective_now then
    return null;
  end if;

  select lecture.* into lecture_row
  from public.lecture_sessions as lecture
  where lecture.id = lecture_id
  for update;

  select live.* into live_row
  from public.lecture_live_state as live
  where live.lecture_session_id = lecture_id
  for update;

  select connection.* into connection_row
  from public.presenter_connections as connection
  where connection.id = target_connection_id
  for update;

  if connection_row.revoked_at is not null
     or connection_row.ticket_expires_at <= effective_now
     or lecture_row.status <> 'open'
     or lecture_row.hard_stop_at <= effective_now
     or connection_row.installation_hash <> target_installation_hash
     or connection_row.pdf_document_id is distinct from live_row.pdf_document_id
     or connection_row.pdf_document_version is distinct from live_row.pdf_document_version
     or connection_row.pdf_manifest_version is distinct from live_row.pdf_manifest_version
     or connection_row.pdf_page_count is distinct from live_row.pdf_page_count
     or (
       target_credential_kind = 'ticket'
       and connection_row.ticket_jti_hash <> target_credential_hash
     )
     or (
       target_credential_kind = 'manual_code'
       and connection_row.manual_code_hmac <> target_credential_hash
     ) then
    return null;
  end if;

  if connection_row.state = 'active' then
    if connection_row.capability_jti_hash = target_capability_jti_hash then
      return jsonb_build_object(
        'capability_expires_at', connection_row.capability_expires_at,
        'connection_id', connection_row.id,
        'hard_stop_at', connection_row.hard_stop_at,
        'lecture_session_id', connection_row.lecture_session_id,
        'state', connection_row.state
      );
    end if;
    return null;
  end if;

  if connection_row.state <> 'confirmed' then
    return null;
  end if;

  update public.presenter_connections as connection
  set
    state = 'active',
    ticket_consumed_at = effective_now,
    capability_jti_hash = target_capability_jti_hash,
    capability_expires_at = least(
      connection_row.hard_stop_at,
      effective_now + interval '95 minutes'
    ),
    claimed_at = effective_now,
    last_seen_at = effective_now,
    updated_at = effective_now
  where connection.id = target_connection_id
  returning * into connection_row;

  perform private.record_presenter_connection_event_v1(
    connection_row.id,
    'claimed',
    'presenter-installation'
  );

  return jsonb_build_object(
    'capability_expires_at', connection_row.capability_expires_at,
    'connection_id', connection_row.id,
    'hard_stop_at', connection_row.hard_stop_at,
    'lecture_session_id', connection_row.lecture_session_id,
    'state', connection_row.state
  );
end;
$$;

create function public.apply_presenter_page_v1(
  target_connection_id uuid,
  target_capability_jti_hash text,
  target_installation_hash text,
  target_sequence bigint,
  target_event_id uuid,
  target_pptx_file_sha256 text,
  target_slide_id_order_sha256 text,
  target_slide_id integer,
  target_slide_index integer,
  target_pdf_page integer
)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  gate_row private.presenter_runtime_gate%rowtype;
  admin_id uuid;
  admin_row public.admin_sessions%rowtype;
  admin_valid boolean := false;
  lecture_id uuid;
  lecture_row public.lecture_sessions%rowtype;
  live_row public.lecture_live_state%rowtype;
  connection_row public.presenter_connections%rowtype;
  effective_now timestamptz := statement_timestamp();
begin
  if target_capability_jti_hash !~ '^[0-9a-f]{64}$'
     or target_installation_hash !~ '^[0-9a-f]{64}$'
     or target_pptx_file_sha256 !~ '^[0-9a-f]{64}$'
     or target_slide_id_order_sha256 !~ '^[0-9a-f]{64}$'
     or target_sequence < 0
     or target_slide_id <= 0
     or target_slide_index not between 1 and 75
     or target_pdf_page <> target_slide_index then
    raise exception 'Invalid Presenter page update.' using errcode = '22023';
  end if;

  select gate.* into gate_row
  from private.presenter_runtime_gate as gate
  where gate.singleton
  for update;
  if not gate_row.enabled then
    return jsonb_build_object('accepted', false, 'reason', 'feature_disabled');
  end if;

  select connection.admin_session_id, connection.lecture_session_id
  into admin_id, lecture_id
  from public.presenter_connections as connection
  where connection.id = target_connection_id
    and connection.capability_jti_hash = target_capability_jti_hash;
  if lecture_id is null then
    return null;
  end if;

  select session.* into admin_row
  from public.admin_sessions as session
  where session.id = admin_id
  for update;
  admin_valid := found
    and admin_row.revoked_at is null
    and admin_row.expires_at > effective_now
    and admin_row.idle_expires_at > effective_now;

  select lecture.* into lecture_row
  from public.lecture_sessions as lecture
  where lecture.id = lecture_id
  for update;

  select live.* into live_row
  from public.lecture_live_state as live
  where live.lecture_session_id = lecture_id
  for update;

  select connection.* into connection_row
  from public.presenter_connections as connection
  where connection.id = target_connection_id
    and connection.capability_jti_hash = target_capability_jti_hash
  for update;

  if not found then
    return null;
  end if;

  if not admin_valid then
    if connection_row.revoked_at is null then
      update public.presenter_connections as connection
      set
        state = 'revoked',
        revoked_at = effective_now,
        revoke_reason = 'admin_revoked',
        updated_at = effective_now
      where connection.id = target_connection_id;
      perform private.record_presenter_connection_event_v1(
        target_connection_id,
        'admin_revoked',
        'presenter-runtime'
      );
    end if;
    return jsonb_build_object('accepted', false, 'reason', 'admin_revoked');
  end if;

  if connection_row.revoked_at is not null
     or connection_row.state <> 'active'
     or connection_row.capability_expires_at <= effective_now
     or connection_row.hard_stop_at <= effective_now
     or lecture_row.status <> 'open'
     or lecture_row.hard_stop_at <= effective_now
     or connection_row.installation_hash <> target_installation_hash then
    if connection_row.revoked_at is null then
      update public.presenter_connections as connection
      set
        state = 'revoked',
        revoked_at = effective_now,
        revoke_reason = 'expired',
        updated_at = effective_now
      where connection.id = target_connection_id;
      perform private.record_presenter_connection_event_v1(
        target_connection_id,
        'expired',
        'presenter-runtime'
      );
    end if;
    return jsonb_build_object('accepted', false, 'reason', 'expired');
  end if;

  if connection_row.pdf_document_id is distinct from live_row.pdf_document_id
     or connection_row.pdf_document_version is distinct from live_row.pdf_document_version
     or connection_row.pdf_manifest_version is distinct from live_row.pdf_manifest_version
     or connection_row.pdf_page_count is distinct from live_row.pdf_page_count then
    update public.presenter_connections as connection
    set
      state = 'revoked',
      revoked_at = effective_now,
      revoke_reason = 'document_changed',
      updated_at = effective_now
    where connection.id = target_connection_id;
    perform private.record_presenter_connection_event_v1(
      target_connection_id,
      'document_changed',
      'presenter-runtime'
    );
    return jsonb_build_object('accepted', false, 'reason', 'document_changed');
  end if;

  if connection_row.pptx_file_sha256 <> target_pptx_file_sha256
     or connection_row.slide_id_order_sha256 <> target_slide_id_order_sha256
     or target_pdf_page > connection_row.pdf_page_count then
    update public.presenter_connections as connection
    set
      state = 'revoked',
      revoked_at = effective_now,
      revoke_reason = 'deck_changed',
      updated_at = effective_now
    where connection.id = target_connection_id;
    perform private.record_presenter_connection_event_v1(
      target_connection_id,
      'deck_changed',
      'presenter-runtime'
    );
    return jsonb_build_object('accepted', false, 'reason', 'deck_changed');
  end if;

  if target_sequence = connection_row.last_sequence
     and target_event_id = connection_row.last_event_id
     and target_slide_id = connection_row.last_slide_id
     and target_slide_index = connection_row.last_slide_index then
    return jsonb_build_object(
      'accepted', true,
      'changed', false,
      'current_pdf_page', live_row.current_pdf_page,
      'display_version', live_row.display_version,
      'idempotent_replay', true,
      'pdf_version', live_row.pdf_version,
      'state_version', live_row.state_version
    );
  end if;

  if target_sequence <= connection_row.last_sequence then
    return jsonb_build_object('accepted', false, 'reason', 'stale_sequence');
  end if;

  if connection_row.last_request_at is not null
     and connection_row.last_request_at > effective_now - interval '200 milliseconds' then
    return jsonb_build_object('accepted', false, 'reason', 'rate_limited');
  end if;

  perform * from public.admin_update_pdf_display_v3(
    connection_row.lecture_session_id,
    connection_row.pdf_document_id,
    connection_row.pdf_document_version,
    connection_row.pdf_manifest_version,
    connection_row.pdf_page_count,
    true,
    target_pdf_page,
    live_row.display_mode
  );

  select live.* into live_row
  from public.lecture_live_state as live
  where live.lecture_session_id = connection_row.lecture_session_id;

  update public.presenter_connections as connection
  set
    last_sequence = target_sequence,
    last_event_id = target_event_id,
    last_slide_id = target_slide_id,
    last_slide_index = target_slide_index,
    last_committed_pdf_page = live_row.current_pdf_page,
    last_request_at = effective_now,
    last_seen_at = effective_now,
    updated_at = effective_now
  where connection.id = target_connection_id;

  return jsonb_build_object(
    'accepted', true,
    'changed', live_row.current_pdf_page is distinct from connection_row.last_committed_pdf_page,
    'current_pdf_page', live_row.current_pdf_page,
    'display_version', live_row.display_version,
    'idempotent_replay', false,
    'pdf_version', live_row.pdf_version,
    'state_version', live_row.state_version
  );
end;
$$;

create function public.heartbeat_presenter_connection_v1(
  target_connection_id uuid,
  target_capability_jti_hash text,
  target_installation_hash text,
  target_pptx_file_sha256 text,
  target_slide_id_order_sha256 text
)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  gate_enabled boolean;
  admin_id uuid;
  admin_row public.admin_sessions%rowtype;
  admin_valid boolean := false;
  lecture_id uuid;
  lecture_row public.lecture_sessions%rowtype;
  live_row public.lecture_live_state%rowtype;
  connection_row public.presenter_connections%rowtype;
  effective_now timestamptz := statement_timestamp();
  rejection_reason text;
  event_name text;
begin
  if target_capability_jti_hash !~ '^[0-9a-f]{64}$'
     or target_installation_hash !~ '^[0-9a-f]{64}$'
     or target_pptx_file_sha256 !~ '^[0-9a-f]{64}$'
     or target_slide_id_order_sha256 !~ '^[0-9a-f]{64}$' then
    return null;
  end if;

  select gate.enabled into gate_enabled
  from private.presenter_runtime_gate as gate
  where gate.singleton
  for update;

  select connection.admin_session_id, connection.lecture_session_id
  into admin_id, lecture_id
  from public.presenter_connections as connection
  where connection.id = target_connection_id
    and connection.capability_jti_hash = target_capability_jti_hash;
  if lecture_id is null then
    return null;
  end if;

  select session.* into admin_row
  from public.admin_sessions as session
  where session.id = admin_id
  for update;
  admin_valid := found
    and admin_row.revoked_at is null
    and admin_row.expires_at > effective_now
    and admin_row.idle_expires_at > effective_now;

  select lecture.* into lecture_row
  from public.lecture_sessions as lecture
  where lecture.id = lecture_id
  for update;

  select live.* into live_row
  from public.lecture_live_state as live
  where live.lecture_session_id = lecture_id
  for update;

  select connection.* into connection_row
  from public.presenter_connections as connection
  where connection.id = target_connection_id
    and connection.capability_jti_hash = target_capability_jti_hash
  for update;
  if not found then
    return null;
  end if;

  rejection_reason := case
    when not gate_enabled then 'feature_disabled'
    when not admin_valid then 'admin_revoked'
    when connection_row.revoked_at is not null then connection_row.revoke_reason
    when connection_row.state <> 'active' then 'not_active'
    when connection_row.capability_expires_at <= effective_now then 'expired'
    when lecture_row.status <> 'open' or lecture_row.hard_stop_at <= effective_now
      then 'lecture_closed'
    when connection_row.installation_hash <> target_installation_hash
      then 'installation_changed'
    when connection_row.pptx_file_sha256 <> target_pptx_file_sha256
      or connection_row.slide_id_order_sha256 <> target_slide_id_order_sha256
      then 'deck_changed'
    when connection_row.pdf_document_id is distinct from live_row.pdf_document_id
      or connection_row.pdf_document_version is distinct from live_row.pdf_document_version
      or connection_row.pdf_manifest_version is distinct from live_row.pdf_manifest_version
      or connection_row.pdf_page_count is distinct from live_row.pdf_page_count
      then 'document_changed'
    else null
  end;

  if rejection_reason is not null then
    if connection_row.revoked_at is null then
      update public.presenter_connections as connection
      set
        state = 'revoked',
        revoked_at = effective_now,
        revoke_reason = left(rejection_reason, 80),
        updated_at = effective_now
      where connection.id = target_connection_id;

      event_name := case rejection_reason
        when 'feature_disabled' then 'feature_disabled'
        when 'admin_revoked' then 'admin_revoked'
        when 'lecture_closed' then 'lecture_closed'
        when 'deck_changed' then 'deck_changed'
        when 'installation_changed' then 'deck_changed'
        when 'document_changed' then 'document_changed'
        else 'expired'
      end;
      perform private.record_presenter_connection_event_v1(
        target_connection_id,
        event_name,
        'presenter-heartbeat'
      );
    end if;
    return jsonb_build_object('active', false, 'reason', rejection_reason);
  end if;

  if connection_row.last_seen_at is null
     or connection_row.last_seen_at <= effective_now - interval '15 seconds' then
    update public.presenter_connections as connection
    set last_seen_at = effective_now, updated_at = effective_now
    where connection.id = target_connection_id;
  end if;

  return jsonb_build_object(
    'active', true,
    'current_pdf_page', live_row.current_pdf_page,
    'hard_stop_at', connection_row.hard_stop_at,
    'last_sequence', connection_row.last_sequence,
    'pdf_document_id', connection_row.pdf_document_id,
    'pdf_document_version', connection_row.pdf_document_version
  );
end;
$$;

create function public.get_presenter_connection_status_v1(
  target_lecture_session_id uuid,
  target_admin_session_id uuid,
  target_admin_auth_user_id uuid
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  gate_enabled boolean;
  connection_row public.presenter_connections%rowtype;
  effective_now timestamptz := statement_timestamp();
begin
  select gate.enabled into gate_enabled
  from private.presenter_runtime_gate as gate
  where gate.singleton;

  if not exists (
    select 1
    from public.admin_sessions as session
    where session.id = target_admin_session_id
      and session.auth_user_id = target_admin_auth_user_id
      and session.revoked_at is null
      and session.expires_at > effective_now
      and session.idle_expires_at > effective_now
  ) then
    raise exception 'Invalid Admin session.' using errcode = '42501';
  end if;

  select connection.* into connection_row
  from public.presenter_connections as connection
  where connection.lecture_session_id = target_lecture_session_id
    and connection.admin_auth_user_id = target_admin_auth_user_id
  order by
    (connection.admin_session_id = target_admin_session_id) desc,
    connection.issued_at desc
  limit 1;

  if not found then
    return jsonb_build_object(
      'connection', null,
      'runtime_enabled', coalesce(gate_enabled, false)
    );
  end if;

  if connection_row.revoked_at is null
     and (
       connection_row.hard_stop_at <= effective_now
       or (
         connection_row.state = 'active'
         and (
           connection_row.capability_expires_at is null
           or connection_row.capability_expires_at <= effective_now
           or connection_row.last_seen_at is null
           or connection_row.last_seen_at <=
             effective_now - interval '45 seconds'
         )
       )
       or (
         connection_row.state <> 'active'
         and connection_row.ticket_expires_at <= effective_now
       )
       or not exists (
         select 1
         from public.admin_sessions as owner_session
         where owner_session.id = connection_row.admin_session_id
           and owner_session.auth_user_id = connection_row.admin_auth_user_id
           and owner_session.revoked_at is null
           and owner_session.expires_at > effective_now
           and owner_session.idle_expires_at > effective_now
       )
       or not exists (
         select 1
         from public.lecture_sessions as lecture
         where lecture.id = connection_row.lecture_session_id
           and lecture.status = 'open'
           and lecture.hard_stop_at > effective_now
       )
     ) then
    return jsonb_build_object(
      'connection', null,
      'runtime_enabled', coalesce(gate_enabled, false)
    );
  end if;

  return jsonb_build_object(
    'connection', jsonb_build_object(
      'capability_expires_at', connection_row.capability_expires_at,
      'confirmed_at', connection_row.confirmed_at,
      'connection_id', connection_row.id,
      'hard_stop_at', connection_row.hard_stop_at,
      'hidden_slide_count', connection_row.hidden_slide_count,
      'last_committed_pdf_page', connection_row.last_committed_pdf_page,
      'last_seen_at', connection_row.last_seen_at,
      'last_sequence', connection_row.last_sequence,
      'pdf_document_id', connection_row.pdf_document_id,
      'pdf_document_version', connection_row.pdf_document_version,
      'pdf_page_count', connection_row.pdf_page_count,
      'pptx_file_sha256', connection_row.pptx_file_sha256,
      'revoked_at', connection_row.revoked_at,
      'revoke_reason', connection_row.revoke_reason,
      'slide_count', connection_row.slide_count,
      'slide_id_order_sha256', connection_row.slide_id_order_sha256,
      'state', connection_row.state,
      'ticket_expires_at', connection_row.ticket_expires_at
    ),
    'runtime_enabled', coalesce(gate_enabled, false)
  );
end;
$$;

create function public.disconnect_presenter_connection_v1(
  target_connection_id uuid,
  target_capability_jti_hash text,
  target_installation_hash text
)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  lecture_id uuid;
  connection_row public.presenter_connections%rowtype;
  effective_now timestamptz := statement_timestamp();
begin
  if target_capability_jti_hash !~ '^[0-9a-f]{64}$'
     or target_installation_hash !~ '^[0-9a-f]{64}$' then
    return null;
  end if;

  perform 1
  from private.presenter_runtime_gate as gate
  where gate.singleton
  for update;

  select connection.lecture_session_id into lecture_id
  from public.presenter_connections as connection
  where connection.id = target_connection_id
    and connection.capability_jti_hash = target_capability_jti_hash;
  if lecture_id is null then
    return null;
  end if;

  perform 1
  from public.lecture_sessions as lecture
  where lecture.id = lecture_id
  for update;

  perform 1
  from public.lecture_live_state as live
  where live.lecture_session_id = lecture_id
  for update;

  select connection.* into connection_row
  from public.presenter_connections as connection
  where connection.id = target_connection_id
    and connection.capability_jti_hash = target_capability_jti_hash
    and connection.installation_hash = target_installation_hash
  for update;
  if not found then
    return null;
  end if;

  if connection_row.revoked_at is null then
    update public.presenter_connections as connection
    set
      state = 'revoked',
      revoked_at = effective_now,
      revoke_reason = 'disconnected',
      updated_at = effective_now
    where connection.id = target_connection_id
    returning * into connection_row;

    perform private.record_presenter_connection_event_v1(
      connection_row.id,
      'disconnected',
      'presenter-runtime'
    );
  end if;

  return jsonb_build_object(
    'connection_id', connection_row.id,
    'revoked_at', connection_row.revoked_at,
    'revoke_reason', connection_row.revoke_reason,
    'state', connection_row.state
  );
end;
$$;

create function public.revoke_presenter_connection_v1(
  target_connection_id uuid,
  target_admin_session_id uuid,
  target_admin_auth_user_id uuid,
  target_reason text default 'manual_handover'
)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  admin_row public.admin_sessions%rowtype;
  lecture_id uuid;
  connection_row public.presenter_connections%rowtype;
  effective_now timestamptz := statement_timestamp();
  event_name text;
begin
  if target_reason not in ('manual_handover', 'disconnected') then
    raise exception 'Invalid Presenter revoke reason.' using errcode = '22023';
  end if;

  perform 1
  from private.presenter_runtime_gate as gate
  where gate.singleton
  for update;

  select session.* into admin_row
  from public.admin_sessions as session
  where session.id = target_admin_session_id
    and session.auth_user_id = target_admin_auth_user_id
  for update;
  if not found
     or admin_row.revoked_at is not null
     or admin_row.expires_at <= effective_now
     or admin_row.idle_expires_at <= effective_now then
    raise exception 'Invalid Admin session.' using errcode = '42501';
  end if;

  select connection.lecture_session_id into lecture_id
  from public.presenter_connections as connection
  where connection.id = target_connection_id;
  if lecture_id is null then
    return null;
  end if;

  perform 1
  from public.lecture_sessions as lecture
  where lecture.id = lecture_id
  for update;

  perform 1
  from public.lecture_live_state as live
  where live.lecture_session_id = lecture_id
  for update;

  select connection.* into connection_row
  from public.presenter_connections as connection
  where connection.id = target_connection_id
    and connection.admin_auth_user_id = target_admin_auth_user_id
  for update;
  if not found then
    return null;
  end if;

  if connection_row.revoked_at is null then
    update public.presenter_connections as connection
    set
      state = 'revoked',
      revoked_at = effective_now,
      revoke_reason = target_reason,
      updated_at = effective_now
    where connection.id = target_connection_id
    returning * into connection_row;

    event_name := case target_reason
      when 'manual_handover' then 'manual_handover'
      else 'disconnected'
    end;
    perform private.record_presenter_connection_event_v1(
      connection_row.id,
      event_name,
      'admin-session:' || target_admin_session_id::text
    );
  end if;

  return jsonb_build_object(
    'connection_id', connection_row.id,
    'revoked_at', connection_row.revoked_at,
    'revoke_reason', connection_row.revoke_reason,
    'state', connection_row.state
  );
end;
$$;

create function public.admin_update_pdf_display_with_presenter_fence_v1(
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
volatile
security invoker
set search_path = ''
as $$
declare
  gate_enabled boolean;
  lecture_row public.lecture_sessions%rowtype;
  effective_now timestamptz := statement_timestamp();
begin
  select gate.enabled into gate_enabled
  from private.presenter_runtime_gate as gate
  where gate.singleton
  for update;

  select lecture.* into lecture_row
  from public.lecture_sessions as lecture
  where lecture.id = target_lecture_session_id
  for update;

  perform 1
  from public.lecture_live_state as live
  where live.lecture_session_id = target_lecture_session_id
  for update;

  with revoked as (
    update public.presenter_connections as connection
    set
      state = 'revoked',
      revoked_at = effective_now,
      revoke_reason = case
        when not exists (
          select 1
          from public.admin_sessions as owner_session
          where owner_session.id = connection.admin_session_id
            and owner_session.auth_user_id = connection.admin_auth_user_id
            and owner_session.revoked_at is null
            and owner_session.expires_at > effective_now
            and owner_session.idle_expires_at > effective_now
        ) then 'admin_revoked'
        when lecture_row.status <> 'open'
          or lecture_row.hard_stop_at <= effective_now then 'lecture_closed'
        when connection.state = 'active'
          and (
            connection.last_seen_at is null
            or connection.last_seen_at <=
              effective_now - interval '45 seconds'
          ) then 'disconnected'
        else 'expired'
      end,
      updated_at = effective_now
    where connection.lecture_session_id = target_lecture_session_id
      and connection.revoked_at is null
      and (
        connection.capability_expires_at is null
        or connection.capability_expires_at <= effective_now
        or connection.hard_stop_at <= effective_now
        or lecture_row.status <> 'open'
        or lecture_row.hard_stop_at <= effective_now
        or connection.last_seen_at is null
        or connection.last_seen_at <= effective_now - interval '45 seconds'
        or not exists (
          select 1
          from public.admin_sessions as owner_session
          where owner_session.id = connection.admin_session_id
            and owner_session.auth_user_id = connection.admin_auth_user_id
            and owner_session.revoked_at is null
            and owner_session.expires_at > effective_now
            and owner_session.idle_expires_at > effective_now
        )
      )
    returning connection.id, connection.lecture_session_id,
      connection.revoke_reason
  )
  insert into public.presenter_connection_events (
    connection_id,
    lecture_session_id,
    event_type,
    actor_id,
    created_at
  )
  select
    revoked.id,
    revoked.lecture_session_id,
    case revoked.revoke_reason
      when 'admin_revoked' then 'admin_revoked'
      when 'lecture_closed' then 'lecture_closed'
      when 'disconnected' then 'disconnected'
      else 'expired'
    end,
    'manual-pdf-fence',
    effective_now
  from revoked;

  if gate_enabled and exists (
    select 1
    from public.presenter_connections as connection
    where connection.lecture_session_id = target_lecture_session_id
      and connection.state = 'active'
      and connection.revoked_at is null
      and connection.capability_expires_at > effective_now
      and connection.hard_stop_at > effective_now
  ) then
    raise exception 'PowerPoint synchronization is active.'
      using errcode = 'P7291';
  end if;

  return query
  select *
  from public.admin_update_pdf_display_v3(
    target_lecture_session_id,
    target_pdf_document_id,
    target_pdf_document_version,
    target_pdf_manifest_version,
    target_pdf_page_count,
    target_pdf_visible,
    target_current_pdf_page,
    target_display_mode
  );
end;
$$;

create function public.set_presenter_runtime_v1(target_enabled boolean)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  effective_now timestamptz := statement_timestamp();
  revoked_count integer := 0;
begin
  update private.presenter_runtime_gate
  set enabled = target_enabled, updated_at = effective_now
  where singleton;

  if not target_enabled then
    with revoked as (
      update public.presenter_connections as connection
      set
        state = 'revoked',
        revoked_at = effective_now,
        revoke_reason = 'feature_disabled',
        updated_at = effective_now
      where connection.revoked_at is null
      returning connection.id, connection.lecture_session_id
    )
    insert into public.presenter_connection_events (
      connection_id,
      lecture_session_id,
      event_type,
      actor_id,
      created_at
    )
    select
      id,
      lecture_session_id,
      'feature_disabled',
      'runtime-gate',
      effective_now
    from revoked;
    get diagnostics revoked_count = row_count;
  end if;

  return jsonb_build_object(
    'enabled', target_enabled,
    'revoked_count', revoked_count,
    'updated_at', effective_now
  );
end;
$$;

create function public.cleanup_presenter_connections_v1(
  target_limit integer default 500
)
returns integer
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  effective_now timestamptz := statement_timestamp();
  deleted_count integer;
begin
  if target_limit not between 1 and 500 then
    raise exception 'Invalid cleanup limit.' using errcode = '22023';
  end if;

  with revoke_candidates as (
    select
      connection.id,
      case
        when not exists (
          select 1
          from public.admin_sessions as owner_session
          where owner_session.id = connection.admin_session_id
            and owner_session.auth_user_id = connection.admin_auth_user_id
            and owner_session.revoked_at is null
            and owner_session.expires_at > effective_now
            and owner_session.idle_expires_at > effective_now
        ) then 'admin_revoked'
        when not exists (
          select 1
          from public.lecture_sessions as lecture
          where lecture.id = connection.lecture_session_id
            and lecture.status = 'open'
            and lecture.hard_stop_at > effective_now
        ) then 'lecture_closed'
        when connection.state = 'active'
          and (
            connection.last_seen_at is null
            or connection.last_seen_at <=
              effective_now - interval '45 seconds'
          ) then 'disconnected'
        else 'expired'
      end as revoke_reason
    from public.presenter_connections as connection
    where connection.revoked_at is null
      and (
        connection.hard_stop_at <= effective_now
        or (
          connection.state = 'active'
          and (
            connection.capability_expires_at is null
            or connection.capability_expires_at <= effective_now
            or connection.last_seen_at is null
            or connection.last_seen_at <=
              effective_now - interval '45 seconds'
          )
        )
        or (
          connection.state <> 'active'
          and connection.ticket_expires_at <= effective_now
        )
        or not exists (
          select 1
          from public.admin_sessions as owner_session
          where owner_session.id = connection.admin_session_id
            and owner_session.auth_user_id = connection.admin_auth_user_id
            and owner_session.revoked_at is null
            and owner_session.expires_at > effective_now
            and owner_session.idle_expires_at > effective_now
        )
        or not exists (
          select 1
          from public.lecture_sessions as lecture
          where lecture.id = connection.lecture_session_id
            and lecture.status = 'open'
            and lecture.hard_stop_at > effective_now
        )
      )
    order by
      coalesce(
        connection.last_seen_at,
        connection.capability_expires_at,
        connection.ticket_expires_at
      ),
      connection.id
    for update of connection skip locked
    limit target_limit
  ),
  revoked as (
    update public.presenter_connections as connection
    set
      state = 'revoked',
      revoked_at = effective_now,
      revoke_reason = candidate.revoke_reason,
      updated_at = effective_now
    from revoke_candidates as candidate
    where connection.id = candidate.id
    returning connection.id, connection.lecture_session_id,
      connection.revoke_reason
  )
  insert into public.presenter_connection_events (
    connection_id,
    lecture_session_id,
    event_type,
    actor_id,
    created_at
  )
  select
    revoked.id,
    revoked.lecture_session_id,
    case revoked.revoke_reason
      when 'admin_revoked' then 'admin_revoked'
      when 'lecture_closed' then 'lecture_closed'
      when 'disconnected' then 'disconnected'
      else 'expired'
    end,
    'presenter-cleanup',
    effective_now
  from revoked;

  with candidates as (
    select connection.id
    from public.presenter_connections as connection
    where connection.revoked_at is not null
      and connection.revoked_at <= effective_now - interval '30 days'
    order by connection.revoked_at, connection.id
    for update skip locked
    limit target_limit
  )
  delete from public.presenter_connections as connection
  using candidates
  where connection.id = candidates.id;

  get diagnostics deleted_count = row_count;
  return deleted_count;
end;
$$;

create function private.revoke_presenter_on_lecture_terminal_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  effective_now timestamptz := statement_timestamp();
begin
  if new.status = 'closed'
     or (new.hard_stop_at is not null and new.hard_stop_at <= effective_now) then
    with revoked as (
      update public.presenter_connections as connection
      set
        state = 'revoked',
        revoked_at = effective_now,
        revoke_reason = 'lecture_closed',
        updated_at = effective_now
      where connection.lecture_session_id = new.id
        and connection.revoked_at is null
      returning connection.id, connection.lecture_session_id
    )
    insert into public.presenter_connection_events (
      connection_id,
      lecture_session_id,
      event_type,
      actor_id,
      created_at
    )
    select id, lecture_session_id, 'lecture_closed', 'lecture-lifecycle', effective_now
    from revoked;
  end if;
  return new;
end;
$$;

create trigger lecture_sessions_revoke_presenter
after update of status, hard_stop_at on public.lecture_sessions
for each row execute function private.revoke_presenter_on_lecture_terminal_v1();

create function private.revoke_presenter_on_admin_session_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  effective_now timestamptz := statement_timestamp();
begin
  if new.revoked_at is not null and old.revoked_at is null then
    with revoked as (
      update public.presenter_connections as connection
      set
        state = 'revoked',
        revoked_at = effective_now,
        revoke_reason = 'admin_revoked',
        updated_at = effective_now
      where connection.admin_session_id = new.id
        and connection.revoked_at is null
      returning connection.id, connection.lecture_session_id
    )
    insert into public.presenter_connection_events (
      connection_id,
      lecture_session_id,
      event_type,
      actor_id,
      created_at
    )
    select id, lecture_session_id, 'admin_revoked', 'admin-lifecycle', effective_now
    from revoked;
  end if;
  return new;
end;
$$;

create trigger admin_sessions_revoke_presenter
after update of revoked_at on public.admin_sessions
for each row execute function private.revoke_presenter_on_admin_session_v1();

create function private.revoke_presenter_on_pdf_binding_change_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  effective_now timestamptz := statement_timestamp();
begin
  if (
    old.pdf_document_id,
    old.pdf_document_version,
    old.pdf_manifest_version,
    old.pdf_page_count,
    old.pdf_visible
  ) is distinct from (
    new.pdf_document_id,
    new.pdf_document_version,
    new.pdf_manifest_version,
    new.pdf_page_count,
    new.pdf_visible
  ) then
    with revoked as (
      update public.presenter_connections as connection
      set
        state = 'revoked',
        revoked_at = effective_now,
        revoke_reason = 'document_changed',
        updated_at = effective_now
      where connection.lecture_session_id = new.lecture_session_id
        and connection.revoked_at is null
      returning connection.id, connection.lecture_session_id
    )
    insert into public.presenter_connection_events (
      connection_id,
      lecture_session_id,
      event_type,
      actor_id,
      created_at
    )
    select id, lecture_session_id, 'document_changed', 'pdf-binding', effective_now
    from revoked;
  end if;
  return new;
end;
$$;

create trigger lecture_live_state_revoke_presenter
after update of
  pdf_document_id,
  pdf_document_version,
  pdf_manifest_version,
  pdf_page_count,
  pdf_visible
on public.lecture_live_state
for each row execute function private.revoke_presenter_on_pdf_binding_change_v1();

revoke all on function private.revoke_presenter_on_lecture_terminal_v1()
  from public, anon, authenticated;
revoke all on function private.revoke_presenter_on_admin_session_v1()
  from public, anon, authenticated;
revoke all on function private.revoke_presenter_on_pdf_binding_change_v1()
  from public, anon, authenticated;

revoke all on function public.issue_presenter_connection_v1(
  uuid, uuid, uuid, text, text, timestamptz
) from public, anon, authenticated;
revoke all on function public.inspect_presenter_connection_v1(
  uuid, text, text, text, text, text, integer, integer, boolean
) from public, anon, authenticated;
revoke all on function public.confirm_presenter_connection_v1(uuid, uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.claim_presenter_connection_v1(
  uuid, text, text, text, text
) from public, anon, authenticated;
revoke all on function public.apply_presenter_page_v1(
  uuid, text, text, bigint, uuid, text, text, integer, integer, integer
) from public, anon, authenticated;
revoke all on function public.heartbeat_presenter_connection_v1(
  uuid, text, text, text, text
) from public, anon, authenticated;
revoke all on function public.get_presenter_connection_status_v1(uuid, uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.disconnect_presenter_connection_v1(uuid, text, text)
  from public, anon, authenticated;
revoke all on function public.revoke_presenter_connection_v1(
  uuid, uuid, uuid, text
) from public, anon, authenticated;
revoke all on function public.admin_update_pdf_display_with_presenter_fence_v1(
  uuid, text, text, bigint, integer, boolean, integer, text
) from public, anon, authenticated;
revoke all on function public.set_presenter_runtime_v1(boolean)
  from public, anon, authenticated;
revoke all on function public.cleanup_presenter_connections_v1(integer)
  from public, anon, authenticated;

grant execute on function public.issue_presenter_connection_v1(
  uuid, uuid, uuid, text, text, timestamptz
) to service_role;
grant execute on function public.inspect_presenter_connection_v1(
  uuid, text, text, text, text, text, integer, integer, boolean
) to service_role;
grant execute on function public.confirm_presenter_connection_v1(uuid, uuid, uuid)
  to service_role;
grant execute on function public.claim_presenter_connection_v1(
  uuid, text, text, text, text
) to service_role;
grant execute on function public.apply_presenter_page_v1(
  uuid, text, text, bigint, uuid, text, text, integer, integer, integer
) to service_role;
grant execute on function public.heartbeat_presenter_connection_v1(
  uuid, text, text, text, text
) to service_role;
grant execute on function public.get_presenter_connection_status_v1(uuid, uuid, uuid)
  to service_role;
grant execute on function public.disconnect_presenter_connection_v1(uuid, text, text)
  to service_role;
grant execute on function public.revoke_presenter_connection_v1(
  uuid, uuid, uuid, text
) to service_role;
grant execute on function public.admin_update_pdf_display_with_presenter_fence_v1(
  uuid, text, text, bigint, integer, boolean, integer, text
) to service_role;
grant execute on function public.set_presenter_runtime_v1(boolean)
  to service_role;
grant execute on function public.cleanup_presenter_connections_v1(integer)
  to service_role;

comment on table public.presenter_connections is
  'Phase 7.29 hash-at-rest Presenter Bridge session and PPTX/PDF binding metadata. Contains no files, slide text, paths, raw tickets, or raw capabilities.';
comment on table public.presenter_connection_events is
  'Content-free low-frequency Presenter Bridge lifecycle audit. Page movements are deliberately not recorded here.';
comment on function public.apply_presenter_page_v1(
  uuid, text, text, bigint, uuid, text, text, integer, integer, integer
) is
  'Commits one stable absolute PowerPoint page after server lifecycle, binding, sequence, fingerprint, and rate checks. Same-page updates do not increment live-state versions.';
