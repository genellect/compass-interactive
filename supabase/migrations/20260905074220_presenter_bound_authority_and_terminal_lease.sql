-- Revalidate the Google session which issued a Presenter capability on every
-- machine operation. This consumes no login admission, AI authority or MFA
-- challenge. The already-bound session is the only source of actor identity.
-- Existing function signatures, proof receipts and dormant runtime gates stay
-- intact; the historical PIN fixtures remain usable only before Google cutover.
create function private.validate_presenter_bound_authority_v3(
  target_connection_id uuid
)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
set statement_timeout = '3s'
set lock_timeout = '750ms'
as $$
declare
  connection_snapshot public.presenter_connections%rowtype;
  session_snapshot public.admin_sessions%rowtype;
  principal_binding private.admin_principals%rowtype;
  context_value jsonb;
  gate_value jsonb;
  authority_valid boolean := false;
  effective_now timestamptz := statement_timestamp();
begin
  -- Callers hold the Presenter runtime gate before entering this helper.
  -- Resolve bindings without a connection lock, then use the existing canonical
  -- principal -> membership -> environment -> Admin -> Auth -> lecture locks.
  -- Do not lock a Presenter row before the Google identity verifier.
  select connection.* into connection_snapshot
  from public.presenter_connections as connection
  where connection.id = target_connection_id;
  if not found then
    return false;
  end if;
  if connection_snapshot.revoked_at is not null then
    -- Preserve the existing terminal response; every caller rejects revoked
    -- connections before accepting a claim, a page or a heartbeat.
    return true;
  end if;

  select session.* into session_snapshot
  from public.admin_sessions as session
  where session.id = connection_snapshot.admin_session_id
    and session.auth_user_id = connection_snapshot.admin_auth_user_id;

  if found and session_snapshot.authentication_method = 'google_totp' then
    select principal.* into principal_binding
    from private.admin_principals as principal
    where principal.id = session_snapshot.principal_id
      and principal.auth_user_id = session_snapshot.auth_user_id;

    context_value := private.require_google_admin_operation_context_v1(
      session_snapshot.token_hash,
      session_snapshot.auth_user_id,
      session_snapshot.supabase_auth_session_id,
      principal_binding.google_issuer,
      principal_binding.provider_subject_hmac,
      principal_binding.subject_pepper_version,
      'manage-presenter-connection.confirm',
      connection_snapshot.lecture_session_id
    );
    authority_valid := context_value is not null
      and (context_value ->> 'admin_session_id')::uuid = session_snapshot.id
      and (context_value ->> 'lecture_status') = 'open'
      and (context_value ->> 'lecture_hard_stop_at')::timestamptz > effective_now
      and coalesce((context_value ->>
        'google_operational_authorization_enabled')::boolean, false);
  elsif found and session_snapshot.authentication_method = 'legacy_pin' then
    gate_value := private.get_admin_identity_runtime_gate_v1();
    authority_valid := coalesce((gate_value ->> 'legacy_pin_login_enabled')::boolean, false)
      and not coalesce((gate_value ->> 'google_only_admin_cutover_committed')::boolean, true)
      and session_snapshot.revoked_at is null
      and session_snapshot.expires_at > effective_now
      and session_snapshot.idle_expires_at > effective_now;
  end if;

  if coalesce(authority_valid, false) then
    return true;
  end if;

  -- Invalidated authority is terminal even when the teacher browser is absent.
  -- Restore of membership or a later login must issue a new connection.
  perform 1 from public.lecture_sessions
  where id = connection_snapshot.lecture_session_id for update;
  perform 1 from public.lecture_live_state
  where lecture_session_id = connection_snapshot.lecture_session_id for update;
  update public.presenter_connections
  set state = 'revoked', revoked_at = effective_now,
      revoke_reason = 'admin_revoked', updated_at = effective_now
  where id = target_connection_id and revoked_at is null;
  if found then
    perform private.record_presenter_connection_event_v1(
      target_connection_id, 'admin_revoked', 'presenter-authority'
    );
  end if;
  return false;
end;
$$;

revoke all on function private.validate_presenter_bound_authority_v3(uuid)
  from public, anon, authenticated;
grant execute on function private.validate_presenter_bound_authority_v3(uuid)
  to service_role;


create or replace function public.inspect_presenter_connection_v1(
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

  if not private.validate_presenter_bound_authority_v3(resolved_connection_id) then
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

create or replace function public.claim_presenter_connection_v1(
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

  if not private.validate_presenter_bound_authority_v3(target_connection_id) then
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

create or replace function public.apply_presenter_page_v1(
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

  if not private.validate_presenter_bound_authority_v3(target_connection_id) then
    return jsonb_build_object('accepted', false, 'reason', 'admin_revoked');
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

  -- A heartbeat lease which elapsed can never be refreshed or reclaimed.
  if connection_row.revoked_at is null
     and connection_row.state = 'active'
     and (connection_row.last_seen_at is null
       or connection_row.last_seen_at <= effective_now - interval '45 seconds') then
    update public.presenter_connections
    set state = 'revoked', revoked_at = effective_now,
        revoke_reason = 'disconnected', updated_at = effective_now
    where id = target_connection_id;
    perform private.record_presenter_connection_event_v1(
      target_connection_id, 'disconnected', 'presenter-lease'
    );
    return jsonb_build_object('accepted', false, 'reason', 'disconnected');
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

create or replace function public.heartbeat_presenter_connection_v1(
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

  if not private.validate_presenter_bound_authority_v3(target_connection_id) then
    return jsonb_build_object('active', false, 'reason', 'admin_revoked');
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
    when connection_row.last_seen_at is null
      or connection_row.last_seen_at <= effective_now - interval '45 seconds'
      then 'disconnected'
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
        when 'disconnected' then 'disconnected'
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

create or replace function private.revoke_presenter_on_pdf_binding_change_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  effective_now timestamptz := statement_timestamp();
begin
  -- Every manual PDF mutation already holds lecture/live locks. Revoke a stale
  -- active connection here before committing even a same-document page change.
  -- A delayed machine request therefore cannot reclaim the manual transport.
  with revoked as (
    update public.presenter_connections as connection
    set state = 'revoked', revoked_at = effective_now,
        revoke_reason = 'disconnected', updated_at = effective_now
    where connection.lecture_session_id = new.lecture_session_id
      and connection.state = 'active'
      and connection.revoked_at is null
      and (connection.last_seen_at is null
        or connection.last_seen_at <= effective_now - interval '45 seconds')
    returning connection.id, connection.lecture_session_id
  )
  insert into public.presenter_connection_events (
    connection_id, lecture_session_id, event_type, actor_id, created_at
  )
  select id, lecture_session_id, 'disconnected', 'pdf-manual-recovery', effective_now
  from revoked;

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

-- Include page-only/manual-mode updates explicitly; the terminal fence must
-- not depend on a caller redundantly assigning PDF metadata columns.
drop trigger lecture_live_state_revoke_presenter on public.lecture_live_state;
create trigger lecture_live_state_revoke_presenter
after update of
  pdf_document_id,
  pdf_document_version,
  pdf_manifest_version,
  pdf_page_count,
  pdf_visible,
  current_pdf_page,
  display_mode
on public.lecture_live_state
for each row execute function private.revoke_presenter_on_pdf_binding_change_v1();

create or replace function private.manage_google_admin_presenter_connection_v1(
  target_token_hash text,
  target_auth_user_id uuid,
  target_supabase_auth_session_id uuid,
  target_google_issuer text,
  target_provider_subject_hmac text,
  target_subject_pepper_version integer,
  target_transport_enabled boolean,
  target_presenter_transport_enabled boolean,
  target_request_id uuid,
  target_action text,
  target_lecture_session_id uuid,
  target_connection_id uuid,
  target_ticket_jti_hash text,
  target_manual_code_hmac text,
  target_origin text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
set statement_timeout = '5s'
set lock_timeout = '750ms'
as $$
declare
  operation_key_value text;
  resolved_lecture_session_id uuid;
  context_value jsonb;
  receipt_row private.admin_google_operation_receipts%rowtype;
  presenter_gate private.presenter_runtime_gate%rowtype;
  lecture_row public.lecture_sessions%rowtype;
  live_row public.lecture_live_state%rowtype;
  connection_row public.presenter_connections%rowtype;
  canonical_origin text;
  payload_digest_value text;
  intent_digest_value text;
  expected_ticket_jti_hash text;
  pairing_issued_epoch bigint;
  pairing_expires_at timestamptz;
  manual_expires_at timestamptz;
  connection_hard_stop_at timestamptz;
  runtime_enabled boolean := false;
  connection_value jsonb := 'null'::jsonb;
  result_metadata_value jsonb;
  effective_now timestamptz := statement_timestamp();
begin
  if target_action not in ('issue', 'confirm', 'status', 'revoke')
     or target_transport_enabled is null
     or target_presenter_transport_enabled is null then
    return null;
  end if;

  if target_action = 'issue' then
    if target_request_id is null
       or target_lecture_session_id is null
       or target_connection_id is not null
       or target_ticket_jti_hash is null
       or target_ticket_jti_hash !~ '^[0-9a-f]{64}$'
       or target_manual_code_hmac is null
       or target_manual_code_hmac !~ '^[0-9a-f]{64}$'
       or target_origin is null
       or char_length(target_origin) not between 8 and 512 then
      return null;
    end if;
  elsif target_action = 'status' then
    if target_request_id is not null
       or target_lecture_session_id is null
       or target_connection_id is not null
       or target_ticket_jti_hash is not null
       or target_manual_code_hmac is not null
       or target_origin is not null then
      return null;
    end if;
  else
    if target_request_id is null
       or target_lecture_session_id is not null
       or target_connection_id is null
       or target_ticket_jti_hash is not null
       or target_manual_code_hmac is not null
       or target_origin is not null then
      return null;
    end if;
  end if;

  operation_key_value := 'manage-presenter-connection.' || target_action;

  if target_action <> 'status' then
    perform private.serialize_admin_ai_request_v1(target_request_id);

    select gate.*
    into presenter_gate
    from private.presenter_runtime_gate as gate
    where gate.singleton
    for update;
  else
    select gate.*
    into presenter_gate
    from private.presenter_runtime_gate as gate
    where gate.singleton
    for share;
  end if;
  if not found then
    return null;
  end if;

  if target_action in ('confirm', 'revoke') then
    select connection.lecture_session_id
    into resolved_lecture_session_id
    from public.presenter_connections as connection
    where connection.id = target_connection_id;
    if resolved_lecture_session_id is null then
      return null;
    end if;
  else
    resolved_lecture_session_id := target_lecture_session_id;
  end if;

  context_value := private.require_google_admin_operation_context_v1(
    target_token_hash,
    target_auth_user_id,
    target_supabase_auth_session_id,
    target_google_issuer,
    target_provider_subject_hmac,
    target_subject_pepper_version,
    operation_key_value,
    resolved_lecture_session_id
  );
  if context_value is null then
    return null;
  end if;

  if target_action = 'issue' then
    select environment.canonical_admin_origin
    into canonical_origin
    from private.admin_environments as environment
    where environment.id = (context_value ->> 'environment_id')::uuid;
    if canonical_origin is null or canonical_origin <> target_origin then
      raise exception 'Presenter origin binding is invalid'
        using errcode = '42501';
    end if;

    expected_ticket_jti_hash := encode(
      extensions.digest(
        convert_to(target_request_id::text, 'UTF8'),
        'sha256'
      ),
      'hex'
    );
    if target_ticket_jti_hash <> expected_ticket_jti_hash then
      raise exception 'Presenter request and ticket binding do not match'
        using errcode = 'P7335';
    end if;

    payload_digest_value := encode(
      extensions.digest(
        convert_to(
          'phase730c2:presenter-issue:v1'
          || '|ticket_jti_hash=' || target_ticket_jti_hash
          || '|manual_code_hmac=' || target_manual_code_hmac
          || '|origin=' || target_origin,
          'UTF8'
        ),
        'sha256'
      ),
      'hex'
    );
  elsif target_action in ('confirm', 'revoke') then
    payload_digest_value := encode(
      extensions.digest(
        convert_to(
          'phase730c2:presenter-' || target_action || ':v1',
          'UTF8'
        ),
        'sha256'
      ),
      'hex'
    );
  end if;

  if target_action <> 'status' then
    intent_digest_value := private.google_admin_operation_intent_digest_v1(
      target_request_id,
      (context_value ->> 'admin_session_id')::uuid,
      operation_key_value,
      resolved_lecture_session_id,
      coalesce(target_connection_id::text, 'new'),
      payload_digest_value
    );
    if intent_digest_value is null then
      return null;
    end if;

    select receipt.*
    into receipt_row
    from private.admin_google_operation_receipts as receipt
    where receipt.request_id = target_request_id;
    if found then
      if receipt_row.operation_key = operation_key_value
         and receipt_row.intent_digest = intent_digest_value
         and receipt_row.environment_id =
           (context_value ->> 'environment_id')::uuid
         and receipt_row.principal_id =
           (context_value ->> 'principal_id')::uuid
         and receipt_row.membership_id =
           (context_value ->> 'membership_id')::uuid
         and receipt_row.admin_session_id =
           (context_value ->> 'admin_session_id')::uuid
         and receipt_row.supabase_auth_session_id =
           target_supabase_auth_session_id
         and receipt_row.lecture_session_id = resolved_lecture_session_id
         and receipt_row.target_id =
           coalesce(target_connection_id::text, 'new') then
        return receipt_row.result_metadata || jsonb_build_object(
          'idempotentReplay', true,
          'ok', true
        );
      end if;
      raise exception 'Presenter request binding does not match its receipt'
        using errcode = 'P7335';
    end if;
  end if;

  if target_action = 'status' then
    perform private.assert_google_admin_operation_lecture_state_v1(
      context_value
    );

    runtime_enabled := presenter_gate.enabled
      and target_presenter_transport_enabled
      and target_transport_enabled
      and coalesce(
        (context_value ->>
          'google_operational_authorization_enabled')::boolean,
        false
      );

    select connection.*
    into connection_row
    from public.presenter_connections as connection
    where connection.lecture_session_id = resolved_lecture_session_id
      and connection.admin_auth_user_id = target_auth_user_id
    -- The authenticated principal may have reopened Admin in another browser
    -- session. Prefer their currently usable lease/pairing for this lecture,
    -- then their newest terminal record. An older same-session receipt must
    -- not hide a live replacement or a later explicit manual handover.
    -- The existing same-user filter and current caller context stay mandatory.
    order by
      coalesce((
        connection.revoked_at is null
        and connection.hard_stop_at > effective_now
        and exists (
          select 1 from public.admin_sessions as owner_session
          where owner_session.id = connection.admin_session_id
            and owner_session.auth_user_id = connection.admin_auth_user_id
            and owner_session.revoked_at is null
            and owner_session.expires_at > effective_now
            and owner_session.idle_expires_at > effective_now
        )
        and (
          (connection.state = 'active'
            and connection.capability_expires_at > effective_now
            and connection.last_seen_at > effective_now - interval '45 seconds')
          or (connection.state in ('pairing', 'inspected', 'confirmed')
            and connection.ticket_expires_at > effective_now)
        )
      ), false) desc,
      connection.issued_at desc,
      connection.id desc
    limit 1;

    if found and not (
      connection_row.revoked_at is null
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
            and owner_session.auth_user_id =
              connection_row.admin_auth_user_id
            and owner_session.revoked_at is null
            and owner_session.expires_at > effective_now
            and owner_session.idle_expires_at > effective_now
        )
      )
    ) then
      connection_value := jsonb_build_object(
        'capability_expires_at', connection_row.capability_expires_at,
        'confirmed_at', connection_row.confirmed_at,
        'connection_id', connection_row.id,
        'custom_show_active', connection_row.custom_show_active,
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
      );
    end if;

    return jsonb_build_object(
      'connection', connection_value,
      'ok', true,
      'runtime_enabled', runtime_enabled
    );
  end if;

  perform private.assert_google_admin_operation_gate_v1(
    context_value,
    target_transport_enabled
  );
  perform private.assert_google_admin_operation_lecture_state_v1(
    context_value
  );

  if target_action in ('issue', 'confirm')
     and (
       not presenter_gate.enabled
       or not target_presenter_transport_enabled
     ) then
    raise exception 'Presenter integration is disabled'
      using errcode = 'P7290';
  end if;

  if target_action = 'issue' then
    select lecture.*
    into lecture_row
    from public.lecture_sessions as lecture
    where lecture.id = resolved_lecture_session_id;

    select live.*
    into live_row
    from public.lecture_live_state as live
    where live.lecture_session_id = resolved_lecture_session_id
    for update;

    if lecture_row.id is null
       or lecture_row.status <> 'open'
       or lecture_row.hard_stop_at is null
       or lecture_row.hard_stop_at <= effective_now then
      raise exception 'Only an open lecture can use Presenter sync'
        using errcode = 'P7292';
    end if;
    if live_row.lecture_session_id is null
       or not live_row.pdf_visible
       or live_row.pdf_document_id is null
       or live_row.pdf_document_version is null
       or live_row.pdf_manifest_version < 1
       or live_row.pdf_page_count is null
       or not exists (
         select 1
         from public.lecture_pdf_documents as document
         where document.lecture_session_id = resolved_lecture_session_id
           and document.document_id = live_row.pdf_document_id
           and document.document_version = live_row.pdf_document_version
           and document.manifest_version <= live_row.pdf_manifest_version
           and document.page_count = live_row.pdf_page_count
           and document.visible
       ) then
      raise exception 'A published lecture PDF is required'
        using errcode = 'P7293';
    end if;

    pairing_issued_epoch := floor(extract(epoch from effective_now))::bigint;
    connection_hard_stop_at := least(
      lecture_row.hard_stop_at,
      (context_value ->> 'expires_at')::timestamptz
    );
    pairing_expires_at := least(
      to_timestamp(pairing_issued_epoch + 55),
      connection_hard_stop_at
    );
    manual_expires_at := least(
      effective_now + interval '5 minutes',
      connection_hard_stop_at
    );
    if floor(extract(epoch from pairing_expires_at))::bigint <=
         pairing_issued_epoch
       or manual_expires_at < pairing_expires_at then
      raise exception 'Presenter pairing window is unavailable'
        using errcode = 'P7292';
    end if;

    with revoked as (
      update public.presenter_connections as connection
      set
        state = 'revoked',
        revoked_at = effective_now,
        revoke_reason = 'session_replaced',
        updated_at = effective_now
      where connection.lecture_session_id = resolved_lecture_session_id
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
      revoked.id,
      revoked.lecture_session_id,
      'session_replaced',
      'admin-session:' || (context_value ->> 'admin_session_id'),
      effective_now
    from revoked;

    insert into public.presenter_connections (
      id,
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
      target_request_id,
      resolved_lecture_session_id,
      (context_value ->> 'admin_session_id')::uuid,
      target_auth_user_id,
      target_ticket_jti_hash,
      target_manual_code_hmac,
      manual_expires_at,
      live_row.pdf_document_id,
      live_row.pdf_document_version,
      live_row.pdf_manifest_version,
      live_row.pdf_page_count,
      live_row.current_pdf_page,
      effective_now,
      connection_hard_stop_at,
      effective_now
    )
    returning * into connection_row;

    perform private.record_presenter_connection_event_v1(
      connection_row.id,
      'issued',
      'admin-session:' || (context_value ->> 'admin_session_id')
    );

    result_metadata_value := jsonb_build_object(
      'connectionId', connection_row.id,
      'hardStopAt', connection_row.hard_stop_at,
      'manualExpiresAt', connection_row.ticket_expires_at,
      'pairingIssuedAtEpoch', pairing_issued_epoch,
      'pairingTicketExpiresAt', pairing_expires_at,
      'pdfDocumentId', connection_row.pdf_document_id,
      'pdfDocumentVersion', connection_row.pdf_document_version,
      'pdfManifestVersion', connection_row.pdf_manifest_version,
      'pdfPageCount', connection_row.pdf_page_count
    );
  elsif target_action = 'confirm' then
    select live.*
    into live_row
    from public.lecture_live_state as live
    where live.lecture_session_id = resolved_lecture_session_id
    for update;

    select connection.*
    into connection_row
    from public.presenter_connections as connection
    where connection.id = target_connection_id
      and connection.lecture_session_id = resolved_lecture_session_id
    for update;

    if not found
       or connection_row.admin_session_id <>
         (context_value ->> 'admin_session_id')::uuid
       or connection_row.admin_auth_user_id <> target_auth_user_id
       or connection_row.revoked_at is not null
       or connection_row.ticket_expires_at <= effective_now
       or connection_row.hard_stop_at <= effective_now
       or connection_row.state not in ('inspected', 'confirmed')
       or connection_row.pdf_document_id is distinct from
         live_row.pdf_document_id
       or connection_row.pdf_document_version is distinct from
         live_row.pdf_document_version
       or connection_row.pdf_manifest_version is distinct from
         live_row.pdf_manifest_version
       or connection_row.pdf_page_count is distinct from
         live_row.pdf_page_count then
      return null;
    end if;
    if connection_row.slide_count <> connection_row.pdf_page_count
       or connection_row.hidden_slide_count <> 0
       or connection_row.custom_show_active then
      raise exception 'This presentation cannot be synchronized'
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
        'admin-session:' || (context_value ->> 'admin_session_id')
      );
    end if;

    result_metadata_value := jsonb_build_object(
      'connectionId', connection_row.id,
      'pdfPageCount', connection_row.pdf_page_count,
      'state', connection_row.state
    );
  else
    perform 1
    from public.lecture_live_state as live
    where live.lecture_session_id = resolved_lecture_session_id
    for update;

    select connection.*
    into connection_row
    from public.presenter_connections as connection
    where connection.id = target_connection_id
      and connection.lecture_session_id = resolved_lecture_session_id
      and connection.admin_auth_user_id = target_auth_user_id
    for update;
    if not found then
      return null;
    end if;

    if connection_row.revoked_at is null then
      update public.presenter_connections as connection
      set
        state = 'revoked',
        revoked_at = effective_now,
        revoke_reason = 'manual_handover',
        updated_at = effective_now
      where connection.id = target_connection_id
      returning * into connection_row;

      perform private.record_presenter_connection_event_v1(
        connection_row.id,
        'manual_handover',
        'admin-session:' || (context_value ->> 'admin_session_id')
      );
    end if;

    result_metadata_value := jsonb_build_object(
      'connectionId', connection_row.id,
      'revokedAt', connection_row.revoked_at,
      'revokeReason', connection_row.revoke_reason,
      'state', connection_row.state
    );
  end if;

  insert into private.admin_google_operation_receipts (
    request_id,
    operation_key,
    intent_digest,
    environment_id,
    principal_id,
    membership_id,
    admin_session_id,
    supabase_auth_session_id,
    lecture_session_id,
    target_id,
    result_id,
    result_status,
    result_metadata
  ) values (
    target_request_id,
    operation_key_value,
    intent_digest_value,
    (context_value ->> 'environment_id')::uuid,
    (context_value ->> 'principal_id')::uuid,
    (context_value ->> 'membership_id')::uuid,
    (context_value ->> 'admin_session_id')::uuid,
    target_supabase_auth_session_id,
    resolved_lecture_session_id,
    coalesce(target_connection_id::text, 'new'),
    connection_row.id::text,
    case target_action
      when 'issue' then 'issued'
      when 'confirm' then 'confirmed'
      else 'revoked'
    end,
    result_metadata_value
  );

  insert into private.admin_audit_events (
    request_id,
    environment_id,
    actor_principal_id,
    actor_membership_id,
    actor_session_id,
    action,
    target_type,
    target_id,
    result,
    reason_code,
    metadata
  ) values (
    target_request_id,
    (context_value ->> 'environment_id')::uuid,
    (context_value ->> 'principal_id')::uuid,
    (context_value ->> 'membership_id')::uuid,
    (context_value ->> 'admin_session_id')::uuid,
    'admin_presenter_connection.' || target_action,
    'presenter_connection',
    connection_row.id::text,
    'accepted',
    'google_admin_operation',
    jsonb_build_object(
      'lecture_session_id', resolved_lecture_session_id,
      'operation_key', operation_key_value,
      'state', connection_row.state
    )
  );

  return result_metadata_value || jsonb_build_object(
    'idempotentReplay', false,
    'ok', true
  );
end;
$$;
