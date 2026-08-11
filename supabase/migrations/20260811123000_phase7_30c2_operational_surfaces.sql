-- Phase 7.30C2 operational surfaces, tranche 2.
--
-- Display and Presenter are the first capability-issuing surfaces in this
-- additive tranche. Google Admin identity, ownership, lecture lifecycle,
-- runtime gates, replacement and immutable request evidence are checked and
-- mutated in one transaction. The legacy transport remains available only
-- while the staged Google operations transport is default-OFF; its final
-- tombstone belongs to the Phase 7.30E cutover transaction.

create table private.admin_google_display_sessions (
  id uuid primary key,
  token_jti_hash text not null unique check (
    token_jti_hash ~ '^[0-9a-f]{64}$'
  ),
  lecture_session_id uuid not null
    references public.lecture_sessions(id) on delete cascade,
  admin_session_id uuid not null
    references public.admin_sessions(id) on delete cascade,
  admin_auth_user_id uuid not null,
  realtime_enabled boolean not null,
  display_auth_user_id uuid,
  issued_at timestamptz not null,
  claimed_at timestamptz,
  expires_at timestamptz not null,
  hard_stop_at timestamptz not null,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  check (issued_at < expires_at),
  check (expires_at <= hard_stop_at + interval '5 minutes'),
  check ((display_auth_user_id is null) = (claimed_at is null))
);

comment on table private.admin_google_display_sessions is
  'Hash-at-rest root bindings for every Google Admin-issued Display capability. Snapshot-only issuance remains tied to its live Admin/Auth session without enabling Realtime.';

create index admin_google_display_sessions_lecture_idx
  on private.admin_google_display_sessions (
    lecture_session_id,
    expires_at,
    id
  );
create index admin_google_display_sessions_admin_idx
  on private.admin_google_display_sessions (
    admin_session_id,
    expires_at,
    id
  );

alter table private.admin_google_display_sessions enable row level security;
revoke all on private.admin_google_display_sessions
  from public, anon, authenticated, service_role;

-- Consumers call this service-only facade before considering the legacy
-- unbound-token compatibility path. A recognized Google binding can never
-- fall back to legacy validation: it either claims the exact browser and
-- revalidates its issuer session, or fails closed.
create function private.verify_and_claim_google_display_session_v1(
  target_token_jti_hash text,
  target_lecture_session_id uuid,
  target_display_auth_user_id uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
set statement_timeout = '3s'
set lock_timeout = '750ms'
as $$
declare
  binding_snapshot private.admin_google_display_sessions%rowtype;
  binding private.admin_google_display_sessions%rowtype;
  lecture_row public.lecture_sessions%rowtype;
  admin_snapshot public.admin_sessions%rowtype;
  admin_row public.admin_sessions%rowtype;
  principal_row private.admin_principals%rowtype;
  membership_row private.admin_environment_memberships%rowtype;
  environment_row private.admin_environments%rowtype;
  auth_session_row auth.sessions%rowtype;
  realtime_binding public.display_realtime_sessions%rowtype;
  display_gate_enabled boolean := false;
  live_factor_set_hash text;
  live_factor_count integer;
  effective_now timestamptz := statement_timestamp();
begin
  if target_token_jti_hash is null
     or target_token_jti_hash !~ '^[0-9a-f]{64}$'
     or target_lecture_session_id is null
     or target_display_auth_user_id is null then
    return jsonb_build_object('recognized', false, 'valid', false);
  end if;

  select session.*
  into binding_snapshot
  from private.admin_google_display_sessions as session
  where session.token_jti_hash = target_token_jti_hash
    and session.lecture_session_id = target_lecture_session_id;
  if not found then
    return jsonb_build_object('recognized', false, 'valid', false);
  end if;

  if binding_snapshot.realtime_enabled then
    select gate.enabled
    into display_gate_enabled
    from private.display_realtime_runtime_gate as gate
    where gate.singleton
    for share;
    if not found then
      return jsonb_build_object(
        'reason', 'inactive',
        'recognized', true,
        'realtimeEnabled', true,
        'valid', false
      );
    end if;
  end if;

  select session.*
  into admin_snapshot
  from public.admin_sessions as session
  where session.id = binding_snapshot.admin_session_id
    and session.auth_user_id = binding_snapshot.admin_auth_user_id;
  if not found then
    return jsonb_build_object(
      'reason', 'inactive',
      'recognized', true,
      'realtimeEnabled', binding_snapshot.realtime_enabled,
      'valid', false
    );
  end if;

  -- Display consumers use the same canonical identity ordering as Google Admin
  -- operations, but SHARE locks keep concurrent read-only classroom displays
  -- from serializing on one principal. Factor/session mutations take UPDATE
  -- locks and therefore linearize before or after this validation.
  select principal.*
  into principal_row
  from private.admin_principals as principal
  where principal.id = admin_snapshot.principal_id
    and principal.auth_user_id = binding_snapshot.admin_auth_user_id
  for share;

  if principal_row.id is not null then
    select membership.*
    into membership_row
    from private.admin_environment_memberships as membership
    where membership.id = admin_snapshot.membership_id
      and membership.principal_id = principal_row.id
      and membership.environment_id = admin_snapshot.environment_id
    for share;
  end if;

  if membership_row.id is not null then
    select environment.*
    into environment_row
    from private.admin_environments as environment
    where environment.id = membership_row.environment_id
    for share;
  end if;

  select session.*
  into admin_row
  from public.admin_sessions as session
  where session.id = admin_snapshot.id
    and session.auth_user_id = binding_snapshot.admin_auth_user_id
    and session.principal_id = principal_row.id
    and session.membership_id = membership_row.id
    and session.environment_id = environment_row.id
    and session.supabase_auth_session_id = admin_snapshot.supabase_auth_session_id
  for share;

  if admin_row.supabase_auth_session_id is not null then
    select session.*
    into auth_session_row
    from auth.sessions as session
    where session.id = admin_row.supabase_auth_session_id
      and session.user_id = binding_snapshot.admin_auth_user_id
    for key share;
  end if;

  if principal_row.id is not null then
    select snapshot.factor_set_hash, snapshot.factor_count
    into live_factor_set_hash, live_factor_count
    from private.current_verified_totp_factor_set_snapshot_v1(
      binding_snapshot.admin_auth_user_id
    ) as snapshot;
  end if;

  select lecture.*
  into lecture_row
  from public.lecture_sessions as lecture
  where lecture.id = binding_snapshot.lecture_session_id
  for share;

  if binding_snapshot.realtime_enabled then
    select session.*
    into realtime_binding
    from public.display_realtime_sessions as session
    where session.id = binding_snapshot.id
      and session.token_jti_hash = target_token_jti_hash
      and session.lecture_session_id = target_lecture_session_id
      and session.admin_session_id = binding_snapshot.admin_session_id
      and session.admin_auth_user_id = binding_snapshot.admin_auth_user_id
    for update;
    if not found then
      return jsonb_build_object(
        'reason', 'inactive',
        'recognized', true,
        'realtimeEnabled', true,
        'valid', false
      );
    end if;
  end if;

  select session.*
  into binding
  from private.admin_google_display_sessions as session
  where session.id = binding_snapshot.id
    and session.token_jti_hash = target_token_jti_hash
    and session.lecture_session_id = target_lecture_session_id
    and session.admin_session_id = binding_snapshot.admin_session_id
    and session.admin_auth_user_id = binding_snapshot.admin_auth_user_id
    and session.issued_at = binding_snapshot.issued_at
    and session.expires_at = binding_snapshot.expires_at
    and session.hard_stop_at = binding_snapshot.hard_stop_at
    and session.realtime_enabled = binding_snapshot.realtime_enabled
  for update;
  if not found then
    return jsonb_build_object(
      'reason', 'inactive',
      'recognized', true,
      'valid', false
    );
  end if;

  if binding.expires_at <= effective_now
     or binding.hard_stop_at <= effective_now
     or lecture_row.id is null
     or lecture_row.status <> 'open'
     or lecture_row.started_at is null
     or lecture_row.closed_at is not null
     or lecture_row.hard_stop_at is null
     or lecture_row.hard_stop_at <= effective_now
     or admin_row.id is null
     or admin_row.authentication_method <> 'google_totp'
     or admin_row.aal <> 2
     or admin_row.auth_user_id <> binding.admin_auth_user_id
     or admin_row.step_up_verified_at is null
     or admin_row.revoked_at is not null
     or admin_row.expires_at <= effective_now
     or admin_row.idle_expires_at <= effective_now
     or auth_session_row.id is null
     or auth_session_row.created_at + interval '8 hours' <= effective_now
     or principal_row.id is null
     or principal_row.status <> 'active'
     or principal_row.approved_totp_factor_set_hash is null
     or principal_row.approved_totp_factor_count < 1
     or membership_row.id is null
     or membership_row.status <> 'active'
     or (
       membership_row.expires_at is not null
       and membership_row.expires_at <= effective_now
     )
     or environment_row.id is null
     or environment_row.status <> 'active'
     or not environment_row.current_deployment
     or live_factor_set_hash is null
     or live_factor_set_hash is distinct from
       principal_row.approved_totp_factor_set_hash
     or live_factor_count <> principal_row.approved_totp_factor_count
     or admin_row.verified_totp_factor_set_hash is distinct from
       live_factor_set_hash
     or (
       binding.realtime_enabled
       and (
         realtime_binding.id is null
         or realtime_binding.issued_at < binding.issued_at
         or realtime_binding.issued_at >=
           binding.issued_at + interval '1 second'
         or realtime_binding.expires_at > binding.expires_at
         or realtime_binding.hard_stop_at is distinct from binding.hard_stop_at
         or realtime_binding.expires_at <= effective_now
         or realtime_binding.hard_stop_at <= effective_now
         or (
           display_gate_enabled
           and realtime_binding.revoked_at is not null
         )
         or (
           not display_gate_enabled
           and (
             realtime_binding.revoked_at is null
             or realtime_binding.revoke_reason <> 'feature_disabled'
           )
         )
       )
     ) then
    return jsonb_build_object(
      'reason', 'inactive',
      'recognized', true,
      'realtimeEnabled', binding.realtime_enabled,
      'valid', false
    );
  end if;

  if (
       binding.display_auth_user_id is not null
       and binding.display_auth_user_id <> target_display_auth_user_id
     )
     or (
       binding.realtime_enabled
       and realtime_binding.display_auth_user_id is not null
       and realtime_binding.display_auth_user_id <> target_display_auth_user_id
     )
     or (
       binding.realtime_enabled
       and binding.display_auth_user_id is not null
       and realtime_binding.display_auth_user_id is not null
       and binding.display_auth_user_id <>
         realtime_binding.display_auth_user_id
     ) then
    return jsonb_build_object(
      'reason', 'claimed_by_other',
      'recognized', true,
      'realtimeEnabled', binding.realtime_enabled,
      'valid', false
    );
  end if;

  if binding.realtime_enabled
     and realtime_binding.display_auth_user_id is null then
    update public.display_realtime_sessions
    set
      display_auth_user_id = target_display_auth_user_id,
      claimed_at = effective_now,
      updated_at = effective_now
    where id = realtime_binding.id
      and display_auth_user_id is null
    returning * into realtime_binding;
    if not found then
      raise exception 'Google Display Realtime claim did not converge'
        using errcode = 'P7335';
    end if;
  end if;

  if binding.display_auth_user_id is null then
    update private.admin_google_display_sessions
    set
      display_auth_user_id = target_display_auth_user_id,
      claimed_at = effective_now,
      updated_at = effective_now
    where id = binding.id
      and display_auth_user_id is null
    returning * into binding;
    if not found then
      raise exception 'Google Display claim did not converge'
        using errcode = 'P7335';
    end if;
  end if;

  return jsonb_build_object(
    'recognized', true,
    'realtime', case
      when binding.realtime_enabled then jsonb_build_object(
        'expires_at', realtime_binding.expires_at,
        'hard_stop_at', realtime_binding.hard_stop_at,
        'lecture_session_id', realtime_binding.lecture_session_id,
        'session_id', realtime_binding.id,
        'status', 'claimed',
        'topic', realtime_binding.topic
      )
      else 'null'::jsonb
    end,
    'realtimeAvailable',
      binding.realtime_enabled and display_gate_enabled,
    'realtimeEnabled', binding.realtime_enabled,
    'valid', true
  );
end;
$$;

revoke all on function private.verify_and_claim_google_display_session_v1(
  text, uuid, uuid
) from public, anon, authenticated, service_role;

create function public.verify_and_claim_google_display_session_v1(
  target_token_jti_hash text,
  target_lecture_session_id uuid,
  target_display_auth_user_id uuid
)
returns jsonb
language sql
volatile
security definer
set search_path = ''
as $$
  select private.verify_and_claim_google_display_session_v1(
    target_token_jti_hash,
    target_lecture_session_id,
    target_display_auth_user_id
  );
$$;

revoke all on function public.verify_and_claim_google_display_session_v1(
  text, uuid, uuid
) from public, anon, authenticated;
grant execute on function public.verify_and_claim_google_display_session_v1(
  text, uuid, uuid
) to service_role;

create function private.issue_google_admin_display_session_v1(
  target_token_hash text,
  target_auth_user_id uuid,
  target_supabase_auth_session_id uuid,
  target_google_issuer text,
  target_provider_subject_hmac text,
  target_subject_pepper_version integer,
  target_transport_enabled boolean,
  target_request_id uuid,
  target_lecture_session_id uuid,
  target_enable_realtime boolean
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
  operation_key_value constant text := 'issue-display-session.issue';
  context_value jsonb;
  receipt_row private.admin_google_operation_receipts%rowtype;
  lecture_row public.lecture_sessions%rowtype;
  display_gate_enabled boolean;
  existing public.display_realtime_sessions%rowtype;
  registered public.display_realtime_sessions%rowtype;
  payload_digest_value text;
  intent_digest_value text;
  token_jti_hash_value text;
  display_session_id uuid := target_request_id;
  display_topic text;
  token_issued_epoch bigint;
  token_expires_epoch bigint;
  realtime_expiry timestamptz;
  result_metadata_value jsonb;
  effective_now timestamptz := statement_timestamp();
begin
  if target_request_id is null
     or target_lecture_session_id is null
     or target_enable_realtime is null
     or target_transport_enabled is null then
    return null;
  end if;

  perform private.serialize_admin_ai_request_v1(target_request_id);

  -- The legacy registration order is Display gate -> Admin session ->
  -- lecture. Acquire the singleton first for realtime issuance so staged
  -- legacy and Google requests cannot create an inverse lock edge. Exact
  -- replay still takes this short lock, but never requires the gate to be ON.
  if target_enable_realtime then
    select gate.enabled
    into display_gate_enabled
    from private.display_realtime_runtime_gate as gate
    where gate.singleton
    for update;
    if not found then
      return null;
    end if;
  end if;

  context_value := private.require_google_admin_operation_context_v1(
    target_token_hash,
    target_auth_user_id,
    target_supabase_auth_session_id,
    target_google_issuer,
    target_provider_subject_hmac,
    target_subject_pepper_version,
    operation_key_value,
    target_lecture_session_id
  );
  if context_value is null then
    return null;
  end if;

  payload_digest_value := encode(
    extensions.digest(
      convert_to(
        'phase730c2:display-session:v1'
        || '|realtime=' || target_enable_realtime::text,
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );
  intent_digest_value := private.google_admin_operation_intent_digest_v1(
    target_request_id,
    (context_value ->> 'admin_session_id')::uuid,
    operation_key_value,
    target_lecture_session_id,
    case when target_enable_realtime then 'realtime' else 'snapshot' end,
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
       and receipt_row.lecture_session_id = target_lecture_session_id
       and receipt_row.target_id = (
         case when target_enable_realtime then 'realtime' else 'snapshot' end
       )
       and receipt_row.result_id = target_request_id::text then
      return receipt_row.result_metadata || jsonb_build_object(
        'idempotentReplay', true,
        'ok', true
      );
    end if;
    raise exception 'Display-session request binding does not match its receipt'
      using errcode = 'P7335';
  end if;

  perform private.assert_google_admin_operation_gate_v1(
    context_value,
    target_transport_enabled
  );
  perform private.assert_google_admin_operation_lecture_state_v1(context_value);

  select lecture.*
  into lecture_row
  from public.lecture_sessions as lecture
  where lecture.id = target_lecture_session_id
  for update;
  if not found
     or lecture_row.status <> 'open'
     or lecture_row.started_at is null
     or lecture_row.closed_at is not null
     or lecture_row.hard_stop_at is null
     or lecture_row.hard_stop_at <= effective_now then
    raise exception 'Lecture is not open for Display issuance'
      using errcode = 'P7335';
  end if;

  token_issued_epoch := floor(extract(epoch from effective_now))::bigint;
  token_expires_epoch := least(
    token_issued_epoch + 95 * 60,
    floor(extract(epoch from lecture_row.hard_stop_at))::bigint + 5 * 60,
    floor(extract(epoch from
      (context_value ->> 'expires_at')::timestamptz))::bigint
  );
  if token_expires_epoch <= token_issued_epoch then
    raise exception 'Display-session authorization has expired'
      using errcode = 'P7335';
  end if;

  token_jti_hash_value := encode(
    extensions.digest(
      convert_to(target_request_id::text, 'UTF8'),
      'sha256'
    ),
    'hex'
  );
  display_topic := 'display:' || target_lecture_session_id::text || ':' ||
    display_session_id::text;

  if target_enable_realtime then
    if not display_gate_enabled then
      raise exception 'Display Realtime is disabled'
        using errcode = 'P7335';
    end if;

    realtime_expiry := least(
      to_timestamp(token_expires_epoch),
      lecture_row.hard_stop_at,
      (context_value ->> 'expires_at')::timestamptz
    );
    if realtime_expiry <= effective_now then
      raise exception 'Display Realtime authorization has expired'
        using errcode = 'P7335';
    end if;

    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(
        'display-realtime:' || target_lecture_session_id::text,
        0
      )
    );

    for existing in
      select session.*
      from public.display_realtime_sessions as session
      where session.lecture_session_id = target_lecture_session_id
        and (
          session.revoked_at is null
          or session.revoke_reason = 'feature_disabled'
        )
      order by session.id
      for update
    loop
      begin
        perform realtime.send(
          jsonb_build_object(
            'lectureSessionId', target_lecture_session_id,
            'reason', 'session_replaced',
            'sentAt', effective_now
          ),
          'session_closed',
          existing.topic,
          true
        );
      exception when others then
        null;
      end;

      update public.display_realtime_sessions
      set
        revoked_at = coalesce(revoked_at, effective_now),
        revoke_reason = 'session_replaced',
        updated_at = effective_now
      where id = existing.id
        and (
          revoked_at is null
          or revoke_reason = 'feature_disabled'
        );
    end loop;

    insert into public.display_realtime_sessions (
      id,
      lecture_session_id,
      token_jti_hash,
      topic,
      admin_session_id,
      admin_auth_user_id,
      issued_at,
      expires_at,
      hard_stop_at
    ) values (
      display_session_id,
      target_lecture_session_id,
      token_jti_hash_value,
      display_topic,
      (context_value ->> 'admin_session_id')::uuid,
      target_auth_user_id,
      effective_now,
      realtime_expiry,
      lecture_row.hard_stop_at
    )
    returning * into registered;
    if registered.id is null then
      raise exception 'Display Realtime registration did not converge'
        using errcode = 'P7335';
    end if;
  end if;

  insert into private.admin_google_display_sessions (
    id,
    token_jti_hash,
    lecture_session_id,
    admin_session_id,
    admin_auth_user_id,
    realtime_enabled,
    issued_at,
    expires_at,
    hard_stop_at
  ) values (
    display_session_id,
    token_jti_hash_value,
    target_lecture_session_id,
    (context_value ->> 'admin_session_id')::uuid,
    target_auth_user_id,
    target_enable_realtime,
    to_timestamp(token_issued_epoch),
    to_timestamp(token_expires_epoch),
    lecture_row.hard_stop_at
  );

  result_metadata_value := jsonb_build_object(
    'displaySessionId', display_session_id,
    'expiresAtEpoch', token_expires_epoch,
    'issuedAtEpoch', token_issued_epoch,
    'realtime', case
      when target_enable_realtime then jsonb_build_object(
        'expiresAt', registered.expires_at,
        'sessionId', registered.id,
        'topic', registered.topic
      )
      else 'null'::jsonb
    end
  );

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
    target_lecture_session_id,
    case when target_enable_realtime then 'realtime' else 'snapshot' end,
    display_session_id::text,
    'issued',
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
    'admin_display_session.issue',
    'lecture_session',
    target_lecture_session_id::text,
    'accepted',
    'google_admin_operation',
    jsonb_build_object(
      'operation_key', operation_key_value,
      'realtime_enabled', target_enable_realtime
    )
  );

  return result_metadata_value || jsonb_build_object(
    'idempotentReplay', false,
    'ok', true
  );
end;
$$;

revoke all on function private.issue_google_admin_display_session_v1(
  text, uuid, uuid, text, text, integer, boolean, uuid, uuid, boolean
) from public, anon, authenticated, service_role;

create function public.issue_google_admin_display_session_v1(
  target_token_hash text,
  target_auth_user_id uuid,
  target_supabase_auth_session_id uuid,
  target_google_issuer text,
  target_provider_subject_hmac text,
  target_subject_pepper_version integer,
  target_transport_enabled boolean,
  target_request_id uuid,
  target_lecture_session_id uuid,
  target_enable_realtime boolean
)
returns jsonb
language sql
volatile
security definer
set search_path = ''
as $$
  select private.issue_google_admin_display_session_v1(
    target_token_hash,
    target_auth_user_id,
    target_supabase_auth_session_id,
    target_google_issuer,
    target_provider_subject_hmac,
    target_subject_pepper_version,
    target_transport_enabled,
    target_request_id,
    target_lecture_session_id,
    target_enable_realtime
  );
$$;

revoke all on function public.issue_google_admin_display_session_v1(
  text, uuid, uuid, text, text, integer, boolean, uuid, uuid, boolean
) from public, anon, authenticated;
grant execute on function public.issue_google_admin_display_session_v1(
  text, uuid, uuid, text, text, integer, boolean, uuid, uuid, boolean
) to service_role;

-- Presenter administration keeps the legacy gate-first order while moving the
-- Admin authority check, ownership check, lecture lock and mutation into one
-- transaction. Status and revoke remain available when either admission gate
-- is OFF; issue and confirm require both gates but exact replay does not.
create function private.manage_google_admin_presenter_connection_v1(
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
    order by
      (
        connection.admin_session_id =
          (context_value ->> 'admin_session_id')::uuid
      ) desc,
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

revoke all on function private.manage_google_admin_presenter_connection_v1(
  text, uuid, uuid, text, text, integer, boolean, boolean, uuid, text, uuid,
  uuid, text, text, text
) from public, anon, authenticated, service_role;

create function public.manage_google_admin_presenter_connection_v1(
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
language sql
volatile
security definer
set search_path = ''
as $$
  select private.manage_google_admin_presenter_connection_v1(
    target_token_hash,
    target_auth_user_id,
    target_supabase_auth_session_id,
    target_google_issuer,
    target_provider_subject_hmac,
    target_subject_pepper_version,
    target_transport_enabled,
    target_presenter_transport_enabled,
    target_request_id,
    target_action,
    target_lecture_session_id,
    target_connection_id,
    target_ticket_jti_hash,
    target_manual_code_hmac,
    target_origin
  );
$$;

revoke all on function public.manage_google_admin_presenter_connection_v1(
  text, uuid, uuid, text, text, integer, boolean, boolean, uuid, text, uuid,
  uuid, text, text, text
) from public, anon, authenticated;
grant execute on function public.manage_google_admin_presenter_connection_v1(
  text, uuid, uuid, text, text, integer, boolean, boolean, uuid, text, uuid,
  uuid, text, text, text
) to service_role;

-- Browser PDF publication is a multi-transaction Worker saga. The immutable
-- binding distinguishes C2-owned publications from legacy rows without
-- inferring ownership, while each ticket request records only hashes and the
-- DB-authoritative timing needed to recreate one lost response exactly.
create table private.admin_google_pdf_publication_bindings (
  publication_id uuid primary key
    references public.lecture_pdf_publications(id) on delete restrict,
  publication_request_id uuid not null unique,
  environment_id uuid not null
    references private.admin_environments(id) on delete restrict,
  principal_id uuid not null
    references private.admin_principals(id) on delete restrict,
  membership_id uuid not null
    references private.admin_environment_memberships(id) on delete restrict,
  admin_session_id uuid not null
    references public.admin_sessions(id) on delete restrict,
  supabase_auth_session_id uuid not null,
  auth_user_id uuid not null,
  created_at timestamptz not null default statement_timestamp()
);

comment on table private.admin_google_pdf_publication_bindings is
  'Immutable Google Admin provenance for C2 browser PDF publications. Existing legacy publications are intentionally not backfilled or inferred.';

create index admin_google_pdf_publication_bindings_environment_idx
  on private.admin_google_pdf_publication_bindings (
    environment_id,
    created_at desc,
    publication_id
  );
create index admin_google_pdf_publication_bindings_principal_idx
  on private.admin_google_pdf_publication_bindings (
    principal_id,
    created_at desc,
    publication_id
  );
create index admin_google_pdf_publication_bindings_membership_idx
  on private.admin_google_pdf_publication_bindings (
    membership_id,
    created_at desc,
    publication_id
  );
create index admin_google_pdf_publication_bindings_session_idx
  on private.admin_google_pdf_publication_bindings (
    admin_session_id,
    created_at desc,
    publication_id
  );

alter table private.admin_google_pdf_publication_bindings
  enable row level security;
revoke all on private.admin_google_pdf_publication_bindings
  from public, anon, authenticated, service_role;
create trigger admin_google_pdf_publication_bindings_append_only
before update or delete on private.admin_google_pdf_publication_bindings
for each row execute function private.reject_admin_c1_evidence_mutation_v1();

create table private.admin_google_pdf_publication_tickets (
  ticket_request_id uuid primary key,
  publication_id uuid not null
    references private.admin_google_pdf_publication_bindings(publication_id)
      on delete restrict,
  admin_session_id uuid not null
    references public.admin_sessions(id) on delete restrict,
  supabase_auth_session_id uuid not null,
  ticket_generation integer not null check (ticket_generation >= 1),
  key_version integer not null check (key_version >= 1),
  intent_digest text not null check (intent_digest ~ '^[0-9a-f]{64}$'),
  nonce_hash text not null check (nonce_hash ~ '^[0-9a-f]{64}$'),
  ticket_jti_hash text not null check (ticket_jti_hash ~ '^[0-9a-f]{64}$'),
  issued_at timestamptz not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default statement_timestamp(),
  unique (publication_id, ticket_generation),
  unique (publication_id, nonce_hash),
  unique (publication_id, ticket_jti_hash),
  check (issued_at < expires_at)
);

comment on table private.admin_google_pdf_publication_tickets is
  'Append-only hash-at-rest issuance evidence for deterministic C2 PDF upload tickets. Raw nonce, JTI, signing key and PDF metadata are never stored here.';

create index admin_google_pdf_publication_tickets_publication_idx
  on private.admin_google_pdf_publication_tickets (
    publication_id,
    ticket_generation desc,
    ticket_request_id
  );
create index admin_google_pdf_publication_tickets_session_idx
  on private.admin_google_pdf_publication_tickets (
    admin_session_id,
    created_at desc,
    ticket_request_id
  );

alter table private.admin_google_pdf_publication_tickets
  enable row level security;
revoke all on private.admin_google_pdf_publication_tickets
  from public, anon, authenticated, service_role;
create trigger admin_google_pdf_publication_tickets_append_only
before update or delete on private.admin_google_pdf_publication_tickets
for each row execute function private.reject_admin_c1_evidence_mutation_v1();

create table private.admin_google_pdf_publication_continuations (
  finalize_request_id uuid primary key,
  publication_id uuid not null
    references private.admin_google_pdf_publication_bindings(publication_id)
      on delete restrict,
  environment_id uuid not null
    references private.admin_environments(id) on delete restrict,
  principal_id uuid not null
    references private.admin_principals(id) on delete restrict,
  membership_id uuid not null
    references private.admin_environment_memberships(id) on delete restrict,
  admin_session_id uuid not null
    references public.admin_sessions(id) on delete restrict,
  supabase_auth_session_id uuid not null,
  intent_digest text not null check (intent_digest ~ '^[0-9a-f]{64}$'),
  commit_operation_id uuid not null,
  activation_operation_id uuid not null,
  key_version integer not null check (key_version >= 1),
  authorized_at timestamptz not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default statement_timestamp(),
  unique (publication_id, commit_operation_id),
  unique (publication_id, activation_operation_id),
  check (commit_operation_id <> activation_operation_id),
  check (authorized_at < expires_at)
);

comment on table private.admin_google_pdf_publication_continuations is
  'Immutable bounded authorization for one C2 PDF finalize saga. A successful authorization may converge while the admission gate is later OFF, but every stage still rechecks the live Google session, ownership and lecture lifecycle.';

create index admin_google_pdf_publication_continuations_publication_idx
  on private.admin_google_pdf_publication_continuations (
    publication_id,
    expires_at,
    finalize_request_id
  );
create index admin_google_pdf_publication_continuations_environment_idx
  on private.admin_google_pdf_publication_continuations (
    environment_id,
    expires_at,
    finalize_request_id
  );
create index admin_google_pdf_publication_continuations_principal_idx
  on private.admin_google_pdf_publication_continuations (
    principal_id,
    expires_at,
    finalize_request_id
  );
create index admin_google_pdf_publication_continuations_membership_idx
  on private.admin_google_pdf_publication_continuations (
    membership_id,
    expires_at,
    finalize_request_id
  );
create index admin_google_pdf_publication_continuations_session_idx
  on private.admin_google_pdf_publication_continuations (
    admin_session_id,
    expires_at,
    finalize_request_id
  );

alter table private.admin_google_pdf_publication_continuations
  enable row level security;
revoke all on private.admin_google_pdf_publication_continuations
  from public, anon, authenticated, service_role;
create trigger admin_google_pdf_publication_continuations_append_only
before update or delete on private.admin_google_pdf_publication_continuations
for each row execute function private.reject_admin_c1_evidence_mutation_v1();

create function private.get_google_admin_pdf_publication_v1(
  target_token_hash text,
  target_auth_user_id uuid,
  target_supabase_auth_session_id uuid,
  target_google_issuer text,
  target_provider_subject_hmac text,
  target_subject_pepper_version integer,
  target_transport_enabled boolean,
  target_action text,
  target_lecture_session_id uuid,
  target_publication_id uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
set statement_timeout = '3s'
set lock_timeout = '750ms'
as $$
declare
  operation_key_value text;
  resolved_lecture_session_id uuid;
  context_value jsonb;
  binding_row private.admin_google_pdf_publication_bindings%rowtype;
  publication_row public.lecture_pdf_publications%rowtype;
  result_value jsonb;
begin
  if target_action not in ('discover', 'status')
     or target_transport_enabled is null
     or target_lecture_session_id is null
     or (
       target_action = 'discover'
       and target_publication_id is not null
     )
     or (
       target_action = 'status'
       and target_publication_id is null
     ) then
    return null;
  end if;

  if target_action = 'status' then
    select publication.lecture_session_id
    into resolved_lecture_session_id
    from private.admin_google_pdf_publication_bindings as binding
    join public.lecture_pdf_publications as publication
      on publication.id = binding.publication_id
    where binding.publication_id = target_publication_id;
    if not found
       or resolved_lecture_session_id <> target_lecture_session_id then
      return null;
    end if;
  else
    resolved_lecture_session_id := target_lecture_session_id;
  end if;

  operation_key_value := 'manage-pdf-publications.' || target_action;
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

  perform private.assert_google_admin_operation_lecture_state_v1(
    context_value
  );

  if target_action = 'discover' then
    select binding, publication
    into binding_row, publication_row
    from private.admin_google_pdf_publication_bindings as binding
    join public.lecture_pdf_publications as publication
      on publication.id = binding.publication_id
    where publication.lecture_session_id = resolved_lecture_session_id
      and publication.state in ('pending', 'uploaded', 'committed')
      and binding.environment_id =
        (context_value ->> 'environment_id')::uuid
      and binding.principal_id = (context_value ->> 'principal_id')::uuid
      and binding.membership_id = (context_value ->> 'membership_id')::uuid
      and binding.auth_user_id = target_auth_user_id
    order by publication.updated_at desc, publication.id desc
    limit 1;
    if not found then
      return jsonb_build_object('found', false, 'ok', true);
    end if;
  else
    select binding, publication
    into binding_row, publication_row
    from private.admin_google_pdf_publication_bindings as binding
    join public.lecture_pdf_publications as publication
      on publication.id = binding.publication_id
    where binding.publication_id = target_publication_id
      and publication.lecture_session_id = resolved_lecture_session_id
      and binding.environment_id =
        (context_value ->> 'environment_id')::uuid
      and binding.principal_id = (context_value ->> 'principal_id')::uuid
      and binding.membership_id = (context_value ->> 'membership_id')::uuid
      and binding.auth_user_id = target_auth_user_id;
    if not found then
      return null;
    end if;
  end if;

  result_value := private.build_pdf_publication_result_v1(
    publication_row.id
  );
  if result_value is null then
    return null;
  end if;

  return result_value || jsonb_build_object(
    'found', true,
    'ok', true,
    'transport_enabled', target_transport_enabled
  );
end;
$$;

revoke all on function private.get_google_admin_pdf_publication_v1(
  text, uuid, uuid, text, text, integer, boolean, text, uuid, uuid
) from public, anon, authenticated, service_role;

create function public.get_google_admin_pdf_publication_v1(
  target_token_hash text,
  target_auth_user_id uuid,
  target_supabase_auth_session_id uuid,
  target_google_issuer text,
  target_provider_subject_hmac text,
  target_subject_pepper_version integer,
  target_transport_enabled boolean,
  target_action text,
  target_lecture_session_id uuid,
  target_publication_id uuid
)
returns jsonb
language sql
volatile
security definer
set search_path = ''
as $$
  select private.get_google_admin_pdf_publication_v1(
    target_token_hash,
    target_auth_user_id,
    target_supabase_auth_session_id,
    target_google_issuer,
    target_provider_subject_hmac,
    target_subject_pepper_version,
    target_transport_enabled,
    target_action,
    target_lecture_session_id,
    target_publication_id
  );
$$;

revoke all on function public.get_google_admin_pdf_publication_v1(
  text, uuid, uuid, text, text, integer, boolean, text, uuid, uuid
) from public, anon, authenticated;
grant execute on function public.get_google_admin_pdf_publication_v1(
  text, uuid, uuid, text, text, integer, boolean, text, uuid, uuid
) to service_role;

create function private.issue_google_admin_pdf_publication_ticket_v1(
  target_token_hash text,
  target_auth_user_id uuid,
  target_supabase_auth_session_id uuid,
  target_google_issuer text,
  target_provider_subject_hmac text,
  target_subject_pepper_version integer,
  target_transport_enabled boolean,
  target_publication_request_id uuid,
  target_ticket_request_id uuid,
  target_ticket_key_version integer,
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
  target_nonce_hash text,
  target_ticket_jti_hash text
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
  operation_key_value text := 'manage-pdf-publications.initiate';
  context_value jsonb;
  receipt_row private.admin_google_operation_receipts%rowtype;
  binding_row private.admin_google_pdf_publication_bindings%rowtype;
  ticket_row private.admin_google_pdf_publication_tickets%rowtype;
  publication_row public.lecture_pdf_publications%rowtype;
  payload_digest_value text;
  intent_digest_value text;
  result_value jsonb;
  effective_now timestamptz := statement_timestamp();
begin
  if target_publication_request_id is null
     or target_ticket_request_id is null
     or target_publication_request_id = target_ticket_request_id
     or target_ticket_key_version is null
     or target_ticket_key_version < 1
     or target_lecture_session_id is null
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
     or char_length(target_allowed_origin) not between 8 and 255
     or target_allowed_origin !~ '^https?://[^/]+$'
     or target_allowed_origin ~ '[[:cntrl:]]'
     or target_nonce_hash is null
     or target_nonce_hash !~ '^[0-9a-f]{64}$'
     or target_ticket_jti_hash is null
     or target_ticket_jti_hash !~ '^[0-9a-f]{64}$'
     or target_transport_enabled is null then
    return null;
  end if;

  -- Both identifiers are public idempotency namespaces. Sorting avoids a
  -- cross-request advisory cycle while the publication request serializes all
  -- explicit ticket reissues for one browser upload.
  if target_publication_request_id::text < target_ticket_request_id::text then
    perform private.serialize_admin_ai_request_v1(
      target_publication_request_id
    );
    perform private.serialize_admin_ai_request_v1(target_ticket_request_id);
  else
    perform private.serialize_admin_ai_request_v1(target_ticket_request_id);
    perform private.serialize_admin_ai_request_v1(
      target_publication_request_id
    );
  end if;

  context_value := private.require_google_admin_operation_context_v1(
    target_token_hash,
    target_auth_user_id,
    target_supabase_auth_session_id,
    target_google_issuer,
    target_provider_subject_hmac,
    target_subject_pepper_version,
    operation_key_value,
    target_lecture_session_id
  );
  if context_value is null then
    return null;
  end if;

  payload_digest_value := encode(
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
          'nonce_hash', target_nonce_hash,
          'publication_request_id', target_publication_request_id,
          'ticket_jti_hash', target_ticket_jti_hash,
          'ticket_key_version', target_ticket_key_version,
          'ticket_request_id', target_ticket_request_id
        )::text,
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );
  intent_digest_value := private.google_admin_operation_intent_digest_v1(
    target_ticket_request_id,
    (context_value ->> 'admin_session_id')::uuid,
    operation_key_value,
    target_lecture_session_id,
    target_publication_request_id::text,
    payload_digest_value
  );
  if intent_digest_value is null then
    return null;
  end if;

  select receipt.*
  into receipt_row
  from private.admin_google_operation_receipts as receipt
  where receipt.request_id = target_ticket_request_id;
  if found then
    if receipt_row.operation_key <> operation_key_value
       or receipt_row.intent_digest <> intent_digest_value
       or receipt_row.environment_id <>
         (context_value ->> 'environment_id')::uuid
       or receipt_row.principal_id <>
         (context_value ->> 'principal_id')::uuid
       or receipt_row.membership_id <>
         (context_value ->> 'membership_id')::uuid
       or receipt_row.admin_session_id <>
         (context_value ->> 'admin_session_id')::uuid
       or receipt_row.supabase_auth_session_id <>
         target_supabase_auth_session_id
       or receipt_row.lecture_session_id <> target_lecture_session_id
       or receipt_row.target_id <> target_publication_request_id::text then
      raise exception 'PDF ticket request binding does not match its receipt'
        using errcode = 'P7335';
    end if;

    select ticket, binding, publication
    into ticket_row, binding_row, publication_row
    from private.admin_google_pdf_publication_tickets as ticket
    join private.admin_google_pdf_publication_bindings as binding
      on binding.publication_id = ticket.publication_id
    join public.lecture_pdf_publications as publication
      on publication.id = binding.publication_id
    where ticket.ticket_request_id = target_ticket_request_id
      and binding.publication_request_id = target_publication_request_id
      and publication.id::text = receipt_row.result_id;
    if not found
       or ticket_row.intent_digest <> intent_digest_value
       or ticket_row.nonce_hash <> target_nonce_hash
       or ticket_row.ticket_jti_hash <> target_ticket_jti_hash
       or ticket_row.key_version <> target_ticket_key_version then
      raise exception 'PDF ticket evidence is incomplete or misbound'
        using errcode = 'P7335';
    end if;

    perform private.assert_google_admin_operation_lecture_state_v1(
      context_value
    );

    result_value := private.build_pdf_publication_result_v1(
      publication_row.id
    );
    return result_value || jsonb_build_object(
      'idempotentReplay', true,
      'ok', true,
      'ticketCurrent',
        publication_row.ticket_generation = ticket_row.ticket_generation
        and publication_row.nonce_hash = ticket_row.nonce_hash
        and publication_row.ticket_jti_hash = ticket_row.ticket_jti_hash
        and ticket_row.expires_at > effective_now,
      'ticketExpiresAt', ticket_row.expires_at,
      'ticketGeneration', ticket_row.ticket_generation,
      'ticketIssuedAt', ticket_row.issued_at,
      'ticketKeyVersion', ticket_row.key_version,
      'ticketRequestId', ticket_row.ticket_request_id
    );
  end if;

  perform private.assert_google_admin_operation_gate_v1(
    context_value,
    target_transport_enabled
  );
  perform private.assert_google_admin_operation_lecture_state_v1(
    context_value
  );

  select binding.*
  into binding_row
  from private.admin_google_pdf_publication_bindings as binding
  where binding.publication_request_id = target_publication_request_id;

  if found then
    if binding_row.environment_id <>
         (context_value ->> 'environment_id')::uuid
       or binding_row.principal_id <>
         (context_value ->> 'principal_id')::uuid
       or binding_row.membership_id <>
         (context_value ->> 'membership_id')::uuid
       or binding_row.auth_user_id <> target_auth_user_id then
      raise exception 'PDF publication belongs to another Google Admin'
        using errcode = '42501';
    end if;

    select publication.*
    into publication_row
    from public.lecture_pdf_publications as publication
    where publication.id = binding_row.publication_id
      and publication.lecture_session_id = target_lecture_session_id
    for update;
    if not found then
      return null;
    end if;

    if publication_row.document_id <> target_document_id
       or publication_row.expected_pdf_sha256 <> target_expected_pdf_sha256
       or publication_row.expected_byte_size <> target_expected_byte_size
       or publication_row.declared_page_count <> target_declared_page_count
       or publication_row.declared_text_char_count <>
         target_declared_text_char_count
       or publication_row.declared_text_sha256 <>
         target_declared_text_sha256
       or publication_row.display_name <> trim(target_display_name)
       or publication_row.download_enabled <> target_download_enabled
       or publication_row.allowed_origin <> target_allowed_origin then
      raise exception 'PDF ticket reissue metadata changed'
        using errcode = 'P7335';
    end if;

    perform public.admin_reissue_pdf_publication_ticket_v1(
      publication_row.id,
      target_nonce_hash,
      target_ticket_jti_hash,
      (context_value ->> 'admin_session_id')::uuid,
      target_auth_user_id
    );
  else
    if exists (
      select 1
      from public.lecture_pdf_publications as publication
      where publication.client_request_id = target_publication_request_id
    ) then
      raise exception 'Legacy PDF publication cannot be adopted as Google evidence'
        using errcode = 'P7335';
    end if;

    perform public.admin_create_pdf_publication_v1(
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
      target_publication_request_id,
      target_nonce_hash,
      target_ticket_jti_hash,
      (context_value ->> 'admin_session_id')::uuid,
      target_auth_user_id
    );

    select publication.*
    into publication_row
    from public.lecture_pdf_publications as publication
    where publication.client_request_id = target_publication_request_id
      and publication.lecture_session_id = target_lecture_session_id
    for update;
    if not found then
      return null;
    end if;

    insert into private.admin_google_pdf_publication_bindings (
      publication_id,
      publication_request_id,
      environment_id,
      principal_id,
      membership_id,
      admin_session_id,
      supabase_auth_session_id,
      auth_user_id
    ) values (
      publication_row.id,
      target_publication_request_id,
      (context_value ->> 'environment_id')::uuid,
      (context_value ->> 'principal_id')::uuid,
      (context_value ->> 'membership_id')::uuid,
      (context_value ->> 'admin_session_id')::uuid,
      target_supabase_auth_session_id,
      target_auth_user_id
    )
    returning * into binding_row;
  end if;

  select publication.*
  into publication_row
  from public.lecture_pdf_publications as publication
  where publication.id = binding_row.publication_id
  for update;
  if not found
     or publication_row.lecture_session_id <> target_lecture_session_id
     or publication_row.client_request_id <> target_publication_request_id
     or publication_row.nonce_hash <> target_nonce_hash
     or publication_row.ticket_jti_hash <> target_ticket_jti_hash
     or publication_row.ticket_admin_session_id <>
       (context_value ->> 'admin_session_id')::uuid
     or publication_row.ticket_expires_at <= effective_now then
    raise exception 'PDF ticket issuance did not preserve its binding'
      using errcode = 'P7335';
  end if;

  insert into private.admin_google_pdf_publication_tickets (
    ticket_request_id,
    publication_id,
    admin_session_id,
    supabase_auth_session_id,
    ticket_generation,
    key_version,
    intent_digest,
    nonce_hash,
    ticket_jti_hash,
    issued_at,
    expires_at
  ) values (
    target_ticket_request_id,
    publication_row.id,
    (context_value ->> 'admin_session_id')::uuid,
    target_supabase_auth_session_id,
    publication_row.ticket_generation,
    target_ticket_key_version,
    intent_digest_value,
    target_nonce_hash,
    target_ticket_jti_hash,
    effective_now,
    publication_row.ticket_expires_at
  )
  returning * into ticket_row;

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
    target_ticket_request_id,
    operation_key_value,
    intent_digest_value,
    (context_value ->> 'environment_id')::uuid,
    (context_value ->> 'principal_id')::uuid,
    (context_value ->> 'membership_id')::uuid,
    (context_value ->> 'admin_session_id')::uuid,
    target_supabase_auth_session_id,
    target_lecture_session_id,
    target_publication_request_id::text,
    publication_row.id::text,
    'issued',
    jsonb_build_object(
      'publicationId', publication_row.id,
      'state', publication_row.state,
      'ticketGeneration', publication_row.ticket_generation,
      'ticketKeyVersion', target_ticket_key_version
    )
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
    target_ticket_request_id,
    (context_value ->> 'environment_id')::uuid,
    (context_value ->> 'principal_id')::uuid,
    (context_value ->> 'membership_id')::uuid,
    (context_value ->> 'admin_session_id')::uuid,
    'admin_pdf_publication.ticket_issue',
    'pdf_publication',
    publication_row.id::text,
    'accepted',
    'google_admin_operation',
    jsonb_build_object(
      'lecture_session_id', target_lecture_session_id,
      'ticket_generation', publication_row.ticket_generation
    )
  );

  result_value := private.build_pdf_publication_result_v1(
    publication_row.id
  );
  return result_value || jsonb_build_object(
    'idempotentReplay', false,
    'ok', true,
    'ticketCurrent', true,
    'ticketExpiresAt', ticket_row.expires_at,
    'ticketGeneration', ticket_row.ticket_generation,
    'ticketIssuedAt', ticket_row.issued_at,
    'ticketKeyVersion', ticket_row.key_version,
    'ticketRequestId', ticket_row.ticket_request_id
  );
end;
$$;

create function private.advance_google_admin_pdf_publication_v1(
  target_token_hash text,
  target_auth_user_id uuid,
  target_supabase_auth_session_id uuid,
  target_google_issuer text,
  target_provider_subject_hmac text,
  target_subject_pepper_version integer,
  target_transport_enabled boolean,
  target_stage_request_id uuid,
  target_finalize_request_id uuid,
  target_stage text,
  target_lecture_session_id uuid,
  target_publication_id uuid,
  target_worker_attempt_id uuid,
  target_actual_byte_size bigint,
  target_actual_pdf_sha256 text,
  target_pdf_magic_verified boolean,
  target_object_key text,
  target_r2_object_version text,
  target_object_etag text,
  target_manifest_version bigint,
  target_manifest_access_version bigint,
  target_manifest_etag text
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
  operation_key_value text := 'manage-pdf-publications.finalize';
  context_value jsonb;
  receipt_row private.admin_google_operation_receipts%rowtype;
  binding_row private.admin_google_pdf_publication_bindings%rowtype;
  continuation_row private.admin_google_pdf_publication_continuations%rowtype;
  publication_row public.lecture_pdf_publications%rowtype;
  payload_digest_value text;
  intent_digest_value text;
  result_value jsonb;
  effective_now timestamptz := statement_timestamp();
begin
  if target_stage_request_id is null
     or target_finalize_request_id is null
     or target_stage_request_id = target_finalize_request_id
     or target_stage not in (
       'recordUploaded',
       'prepareCommit',
       'completeCommit',
       'prepareActivation',
       'completeActivation'
     )
     or target_lecture_session_id is null
     or target_publication_id is null
     or target_transport_enabled is null then
    return null;
  end if;

  if target_stage = 'recordUploaded' then
    if target_worker_attempt_id is null
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
       or target_object_etag ~ '[[:cntrl:]]'
       or target_manifest_version is not null
       or target_manifest_access_version is not null
       or target_manifest_etag is not null then
      return null;
    end if;
  elsif target_stage in ('completeCommit', 'completeActivation') then
    if target_worker_attempt_id is not null
       or target_actual_byte_size is not null
       or target_actual_pdf_sha256 is not null
       or target_pdf_magic_verified is not null
       or target_object_key is not null
       or target_r2_object_version is not null
       or target_object_etag is not null
       or target_manifest_version is null
       or target_manifest_version < 1
       or target_manifest_access_version is null
       or target_manifest_access_version < 1
       or target_manifest_etag is null
       or char_length(target_manifest_etag) not between 1 and 512
       or target_manifest_etag ~ '[[:cntrl:]]' then
      return null;
    end if;
  elsif target_worker_attempt_id is not null
     or target_actual_byte_size is not null
     or target_actual_pdf_sha256 is not null
     or target_pdf_magic_verified is not null
     or target_object_key is not null
     or target_r2_object_version is not null
     or target_object_etag is not null
     or target_manifest_version is not null
     or target_manifest_access_version is not null
     or target_manifest_etag is not null then
    return null;
  end if;

  perform private.serialize_admin_ai_request_v1(target_stage_request_id);

  select binding.*
  into binding_row
  from private.admin_google_pdf_publication_bindings as binding
  join public.lecture_pdf_publications as publication
    on publication.id = binding.publication_id
  where binding.publication_id = target_publication_id
    and publication.lecture_session_id = target_lecture_session_id;
  if not found then
    return null;
  end if;

  context_value := private.require_google_admin_operation_context_v1(
    target_token_hash,
    target_auth_user_id,
    target_supabase_auth_session_id,
    target_google_issuer,
    target_provider_subject_hmac,
    target_subject_pepper_version,
    operation_key_value,
    target_lecture_session_id
  );
  if context_value is null
     or binding_row.environment_id <>
       (context_value ->> 'environment_id')::uuid
     or binding_row.principal_id <>
       (context_value ->> 'principal_id')::uuid
     or binding_row.membership_id <>
       (context_value ->> 'membership_id')::uuid
     or binding_row.auth_user_id <> target_auth_user_id then
    return null;
  end if;

  payload_digest_value := encode(
    extensions.digest(
      convert_to(
        jsonb_build_object(
          'actual_byte_size', target_actual_byte_size,
          'actual_pdf_sha256', target_actual_pdf_sha256,
          'finalize_request_id', target_finalize_request_id,
          'manifest_access_version', target_manifest_access_version,
          'manifest_etag', target_manifest_etag,
          'manifest_version', target_manifest_version,
          'object_etag', target_object_etag,
          'object_key', target_object_key,
          'pdf_magic_verified', target_pdf_magic_verified,
          'publication_id', target_publication_id,
          'r2_object_version', target_r2_object_version,
          'stage', target_stage,
          'worker_attempt_id', target_worker_attempt_id
        )::text,
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );
  intent_digest_value := private.google_admin_operation_intent_digest_v1(
    target_stage_request_id,
    (context_value ->> 'admin_session_id')::uuid,
    operation_key_value,
    target_lecture_session_id,
    target_publication_id::text,
    payload_digest_value
  );
  if intent_digest_value is null then
    return null;
  end if;

  select receipt.*
  into receipt_row
  from private.admin_google_operation_receipts as receipt
  where receipt.request_id = target_stage_request_id;
  if found then
    if receipt_row.operation_key <> operation_key_value
       or receipt_row.intent_digest <> intent_digest_value
       or receipt_row.environment_id <>
         (context_value ->> 'environment_id')::uuid
       or receipt_row.principal_id <>
         (context_value ->> 'principal_id')::uuid
       or receipt_row.membership_id <>
         (context_value ->> 'membership_id')::uuid
       or receipt_row.admin_session_id <>
         (context_value ->> 'admin_session_id')::uuid
       or receipt_row.supabase_auth_session_id <>
         target_supabase_auth_session_id
       or receipt_row.lecture_session_id <> target_lecture_session_id
       or receipt_row.target_id <> target_publication_id::text then
      raise exception 'PDF continuation stage binding changed on retry'
        using errcode = 'P7335';
    end if;
    return jsonb_build_object(
      'idempotentReplay', true,
      'ok', true,
      'publicationId', target_publication_id,
      'refreshRequired', true,
      'stage', target_stage,
      'status', receipt_row.result_status
    );
  end if;

  perform private.assert_google_admin_operation_lecture_state_v1(
    context_value
  );

  select publication.*
  into publication_row
  from public.lecture_pdf_publications as publication
  where publication.id = target_publication_id
    and publication.lecture_session_id = target_lecture_session_id
  for update;
  if not found then
    return null;
  end if;

  select continuation.*
  into continuation_row
  from private.admin_google_pdf_publication_continuations as continuation
  where continuation.finalize_request_id = target_finalize_request_id
    and continuation.publication_id = target_publication_id;
  if not found
     or continuation_row.environment_id <>
       (context_value ->> 'environment_id')::uuid
     or continuation_row.principal_id <>
       (context_value ->> 'principal_id')::uuid
     or continuation_row.membership_id <>
       (context_value ->> 'membership_id')::uuid
     or continuation_row.admin_session_id <>
       (context_value ->> 'admin_session_id')::uuid
     or continuation_row.supabase_auth_session_id <>
       target_supabase_auth_session_id
     or continuation_row.expires_at <= effective_now then
    raise exception 'PDF finalize continuation is unavailable'
      using errcode = '55000';
  end if;

  if target_stage = 'recordUploaded' then
    result_value := public.worker_record_pdf_publication_uploaded_v1(
      target_publication_id,
      target_worker_attempt_id,
      target_actual_byte_size,
      target_actual_pdf_sha256,
      target_pdf_magic_verified,
      target_object_key,
      target_r2_object_version,
      target_object_etag
    );
    if result_value ->> 'state' not in ('uploaded', 'aborted', 'expired') then
      raise exception 'PDF upload receipt did not reach an accepted state'
        using errcode = 'P7335';
    end if;
  elsif target_stage = 'prepareCommit' then
    result_value := public.admin_prepare_pdf_publication_commit_v1(
      target_publication_id,
      continuation_row.commit_operation_id,
      (context_value ->> 'admin_session_id')::uuid,
      target_auth_user_id
    );
    if result_value ->> 'state' not in ('uploaded', 'committed', 'active', 'retired')
       or result_value ->> 'commit_operation_id' is distinct from
         continuation_row.commit_operation_id::text then
      raise exception 'PDF commit preparation changed its binding'
        using errcode = 'P7335';
    end if;
  elsif target_stage = 'completeCommit' then
    result_value := public.admin_complete_pdf_publication_commit_v1(
      target_publication_id,
      continuation_row.commit_operation_id,
      target_manifest_version,
      target_manifest_access_version,
      target_manifest_etag,
      (context_value ->> 'admin_session_id')::uuid,
      target_auth_user_id
    );
    if result_value ->> 'state' not in ('committed', 'active', 'retired')
       or result_value ->> 'commit_operation_id' is distinct from
         continuation_row.commit_operation_id::text
       or (result_value ->> 'committed_manifest_version')::bigint is distinct from
         target_manifest_version
       or (result_value ->> 'committed_manifest_access_version')::bigint
         is distinct from target_manifest_access_version
       or result_value ->> 'committed_manifest_etag' is distinct from
         target_manifest_etag then
      raise exception 'PDF commit completion changed its receipt'
        using errcode = 'P7335';
    end if;
  elsif target_stage = 'prepareActivation' then
    result_value := public.admin_prepare_pdf_publication_activation_v1(
      target_publication_id,
      continuation_row.activation_operation_id,
      (context_value ->> 'admin_session_id')::uuid,
      target_auth_user_id
    );
    if result_value ->> 'state' not in ('committed', 'active', 'retired')
       or result_value ->> 'activation_operation_id' is distinct from
         continuation_row.activation_operation_id::text then
      raise exception 'PDF activation preparation changed its binding'
        using errcode = 'P7335';
    end if;
  else
    result_value := public.admin_complete_pdf_publication_activation_v1(
      target_publication_id,
      continuation_row.activation_operation_id,
      target_manifest_version,
      target_manifest_access_version,
      target_manifest_etag,
      (context_value ->> 'admin_session_id')::uuid,
      target_auth_user_id
    );
    if result_value ->> 'state' not in ('active', 'retired')
       or result_value ->> 'activation_operation_id' is distinct from
         continuation_row.activation_operation_id::text
       or (result_value ->> 'activated_manifest_version')::bigint
         is distinct from target_manifest_version
       or (result_value ->> 'activation_target_access_version')::bigint
         is distinct from target_manifest_access_version
       or result_value ->> 'activated_manifest_etag' is distinct from
         target_manifest_etag then
      raise exception 'PDF activation completion changed its receipt'
        using errcode = 'P7335';
    end if;
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
    target_stage_request_id,
    operation_key_value,
    intent_digest_value,
    (context_value ->> 'environment_id')::uuid,
    (context_value ->> 'principal_id')::uuid,
    (context_value ->> 'membership_id')::uuid,
    (context_value ->> 'admin_session_id')::uuid,
    target_supabase_auth_session_id,
    target_lecture_session_id,
    target_publication_id::text,
    target_publication_id::text,
    target_stage,
    jsonb_strip_nulls(jsonb_build_object(
      'manifestAccessVersion', target_manifest_access_version,
      'manifestVersion', target_manifest_version,
      'publicationId', target_publication_id,
      'stage', target_stage,
      'state', result_value ->> 'state'
    ))
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
    target_stage_request_id,
    (context_value ->> 'environment_id')::uuid,
    (context_value ->> 'principal_id')::uuid,
    (context_value ->> 'membership_id')::uuid,
    (context_value ->> 'admin_session_id')::uuid,
    'admin_pdf_publication.finalize_' || lower(target_stage),
    'pdf_publication',
    target_publication_id::text,
    'accepted',
    'google_admin_operation',
    jsonb_build_object(
      'lecture_session_id', target_lecture_session_id,
      'state', result_value ->> 'state'
    )
  );

  return result_value || jsonb_build_object(
    'idempotentReplay', false,
    'ok', true,
    'stage', target_stage
  );
end;
$$;

revoke all on function private.advance_google_admin_pdf_publication_v1(
  text, uuid, uuid, text, text, integer, boolean, uuid, uuid, text, uuid, uuid,
  uuid, bigint, text, boolean, text, text, text, bigint, bigint, text
) from public, anon, authenticated, service_role;

create function public.advance_google_admin_pdf_publication_v1(
  target_token_hash text,
  target_auth_user_id uuid,
  target_supabase_auth_session_id uuid,
  target_google_issuer text,
  target_provider_subject_hmac text,
  target_subject_pepper_version integer,
  target_transport_enabled boolean,
  target_stage_request_id uuid,
  target_finalize_request_id uuid,
  target_stage text,
  target_lecture_session_id uuid,
  target_publication_id uuid,
  target_worker_attempt_id uuid,
  target_actual_byte_size bigint,
  target_actual_pdf_sha256 text,
  target_pdf_magic_verified boolean,
  target_object_key text,
  target_r2_object_version text,
  target_object_etag text,
  target_manifest_version bigint,
  target_manifest_access_version bigint,
  target_manifest_etag text
)
returns jsonb
language sql
volatile
security definer
set search_path = ''
as $$
  select private.advance_google_admin_pdf_publication_v1(
    target_token_hash,
    target_auth_user_id,
    target_supabase_auth_session_id,
    target_google_issuer,
    target_provider_subject_hmac,
    target_subject_pepper_version,
    target_transport_enabled,
    target_stage_request_id,
    target_finalize_request_id,
    target_stage,
    target_lecture_session_id,
    target_publication_id,
    target_worker_attempt_id,
    target_actual_byte_size,
    target_actual_pdf_sha256,
    target_pdf_magic_verified,
    target_object_key,
    target_r2_object_version,
    target_object_etag,
    target_manifest_version,
    target_manifest_access_version,
    target_manifest_etag
  );
$$;

revoke all on function public.advance_google_admin_pdf_publication_v1(
  text, uuid, uuid, text, text, integer, boolean, uuid, uuid, text, uuid, uuid,
  uuid, bigint, text, boolean, text, text, text, bigint, bigint, text
) from public, anon, authenticated;
grant execute on function public.advance_google_admin_pdf_publication_v1(
  text, uuid, uuid, text, text, integer, boolean, uuid, uuid, text, uuid, uuid,
  uuid, bigint, text, boolean, text, text, text, bigint, bigint, text
) to service_role;

create function private.abort_google_admin_pdf_publication_v1(
  target_token_hash text,
  target_auth_user_id uuid,
  target_supabase_auth_session_id uuid,
  target_google_issuer text,
  target_provider_subject_hmac text,
  target_subject_pepper_version integer,
  target_transport_enabled boolean,
  target_abort_request_id uuid,
  target_lecture_session_id uuid,
  target_publication_id uuid,
  target_reason_code text
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
  operation_key_value text := 'manage-pdf-publications.abort';
  context_value jsonb;
  receipt_row private.admin_google_operation_receipts%rowtype;
  binding_row private.admin_google_pdf_publication_bindings%rowtype;
  publication_row public.lecture_pdf_publications%rowtype;
  payload_digest_value text;
  intent_digest_value text;
  result_value jsonb;
begin
  if target_abort_request_id is null
     or target_lecture_session_id is null
     or target_publication_id is null
     or target_reason_code is null
     or target_reason_code !~ '^[a-z0-9_:-]{1,80}$'
     or target_transport_enabled is null then
    return null;
  end if;

  perform private.serialize_admin_ai_request_v1(target_abort_request_id);

  select binding.*
  into binding_row
  from private.admin_google_pdf_publication_bindings as binding
  join public.lecture_pdf_publications as publication
    on publication.id = binding.publication_id
  where binding.publication_id = target_publication_id
    and publication.lecture_session_id = target_lecture_session_id;
  if not found then
    return null;
  end if;

  context_value := private.require_google_admin_operation_context_v1(
    target_token_hash,
    target_auth_user_id,
    target_supabase_auth_session_id,
    target_google_issuer,
    target_provider_subject_hmac,
    target_subject_pepper_version,
    operation_key_value,
    target_lecture_session_id
  );
  if context_value is null
     or binding_row.environment_id <>
       (context_value ->> 'environment_id')::uuid
     or binding_row.principal_id <>
       (context_value ->> 'principal_id')::uuid
     or binding_row.membership_id <>
       (context_value ->> 'membership_id')::uuid
     or binding_row.auth_user_id <> target_auth_user_id then
    return null;
  end if;

  payload_digest_value := encode(
    extensions.digest(
      convert_to(
        jsonb_build_object(
          'publication_id', target_publication_id,
          'reason_code', target_reason_code
        )::text,
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );
  intent_digest_value := private.google_admin_operation_intent_digest_v1(
    target_abort_request_id,
    (context_value ->> 'admin_session_id')::uuid,
    operation_key_value,
    target_lecture_session_id,
    target_publication_id::text,
    payload_digest_value
  );
  if intent_digest_value is null then
    return null;
  end if;

  select receipt.*
  into receipt_row
  from private.admin_google_operation_receipts as receipt
  where receipt.request_id = target_abort_request_id;
  if found then
    if receipt_row.operation_key <> operation_key_value
       or receipt_row.intent_digest <> intent_digest_value
       or receipt_row.environment_id <>
         (context_value ->> 'environment_id')::uuid
       or receipt_row.principal_id <>
         (context_value ->> 'principal_id')::uuid
       or receipt_row.membership_id <>
         (context_value ->> 'membership_id')::uuid
       or receipt_row.admin_session_id <>
         (context_value ->> 'admin_session_id')::uuid
       or receipt_row.supabase_auth_session_id <>
         target_supabase_auth_session_id
       or receipt_row.lecture_session_id <> target_lecture_session_id
       or receipt_row.target_id <> target_publication_id::text then
      raise exception 'PDF abort request binding changed on retry'
        using errcode = 'P7335';
    end if;
    return jsonb_build_object(
      'cleanupPending', receipt_row.result_status in ('aborted', 'expired'),
      'idempotentReplay', true,
      'ok', true,
      'publicationId', target_publication_id,
      'refreshRequired', true,
      'status', receipt_row.result_status
    );
  end if;

  perform private.assert_google_admin_operation_lecture_state_v1(
    context_value
  );

  select publication.*
  into publication_row
  from public.lecture_pdf_publications as publication
  where publication.id = target_publication_id
    and publication.lecture_session_id = target_lecture_session_id
  for update;
  if not found then
    return null;
  end if;

  result_value := public.admin_abort_pdf_publication_v1(
    target_publication_id,
    target_reason_code,
    (context_value ->> 'admin_session_id')::uuid,
    target_auth_user_id
  );
  if result_value ->> 'state' not in ('aborted', 'expired') then
    raise exception 'PDF publication did not reach an abort terminal state'
      using errcode = 'P7335';
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
    target_abort_request_id,
    operation_key_value,
    intent_digest_value,
    (context_value ->> 'environment_id')::uuid,
    (context_value ->> 'principal_id')::uuid,
    (context_value ->> 'membership_id')::uuid,
    (context_value ->> 'admin_session_id')::uuid,
    target_supabase_auth_session_id,
    target_lecture_session_id,
    target_publication_id::text,
    target_publication_id::text,
    result_value ->> 'state',
    jsonb_build_object(
      'publicationId', target_publication_id,
      'state', result_value ->> 'state'
    )
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
    target_abort_request_id,
    (context_value ->> 'environment_id')::uuid,
    (context_value ->> 'principal_id')::uuid,
    (context_value ->> 'membership_id')::uuid,
    (context_value ->> 'admin_session_id')::uuid,
    'admin_pdf_publication.abort',
    'pdf_publication',
    target_publication_id::text,
    'accepted',
    target_reason_code,
    jsonb_build_object('lecture_session_id', target_lecture_session_id)
  );

  return result_value || jsonb_build_object(
    'cleanupPending', (result_value ->> 'cleanup_completed_at') is null,
    'idempotentReplay', false,
    'ok', true
  );
end;
$$;

revoke all on function private.abort_google_admin_pdf_publication_v1(
  text, uuid, uuid, text, text, integer, boolean, uuid, uuid, uuid, text
) from public, anon, authenticated, service_role;

create function public.abort_google_admin_pdf_publication_v1(
  target_token_hash text,
  target_auth_user_id uuid,
  target_supabase_auth_session_id uuid,
  target_google_issuer text,
  target_provider_subject_hmac text,
  target_subject_pepper_version integer,
  target_transport_enabled boolean,
  target_abort_request_id uuid,
  target_lecture_session_id uuid,
  target_publication_id uuid,
  target_reason_code text
)
returns jsonb
language sql
volatile
security definer
set search_path = ''
as $$
  select private.abort_google_admin_pdf_publication_v1(
    target_token_hash,
    target_auth_user_id,
    target_supabase_auth_session_id,
    target_google_issuer,
    target_provider_subject_hmac,
    target_subject_pepper_version,
    target_transport_enabled,
    target_abort_request_id,
    target_lecture_session_id,
    target_publication_id,
    target_reason_code
  );
$$;

revoke all on function public.abort_google_admin_pdf_publication_v1(
  text, uuid, uuid, text, text, integer, boolean, uuid, uuid, uuid, text
) from public, anon, authenticated;
grant execute on function public.abort_google_admin_pdf_publication_v1(
  text, uuid, uuid, text, text, integer, boolean, uuid, uuid, uuid, text
) to service_role;

revoke all on function private.issue_google_admin_pdf_publication_ticket_v1(
  text, uuid, uuid, text, text, integer, boolean, uuid, uuid, integer, uuid,
  text, text, bigint, integer, integer, text, text, boolean, text, text, text
) from public, anon, authenticated, service_role;

create function public.issue_google_admin_pdf_publication_ticket_v1(
  target_token_hash text,
  target_auth_user_id uuid,
  target_supabase_auth_session_id uuid,
  target_google_issuer text,
  target_provider_subject_hmac text,
  target_subject_pepper_version integer,
  target_transport_enabled boolean,
  target_publication_request_id uuid,
  target_ticket_request_id uuid,
  target_ticket_key_version integer,
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
  target_nonce_hash text,
  target_ticket_jti_hash text
)
returns jsonb
language sql
volatile
security definer
set search_path = ''
as $$
  select private.issue_google_admin_pdf_publication_ticket_v1(
    target_token_hash,
    target_auth_user_id,
    target_supabase_auth_session_id,
    target_google_issuer,
    target_provider_subject_hmac,
    target_subject_pepper_version,
    target_transport_enabled,
    target_publication_request_id,
    target_ticket_request_id,
    target_ticket_key_version,
    target_lecture_session_id,
    target_document_id,
    target_expected_pdf_sha256,
    target_expected_byte_size,
    target_declared_page_count,
    target_declared_text_char_count,
    target_declared_text_sha256,
    target_display_name,
    target_download_enabled,
    target_allowed_origin,
    target_nonce_hash,
    target_ticket_jti_hash
  );
$$;

revoke all on function public.issue_google_admin_pdf_publication_ticket_v1(
  text, uuid, uuid, text, text, integer, boolean, uuid, uuid, integer, uuid,
  text, text, bigint, integer, integer, text, text, boolean, text, text, text
) from public, anon, authenticated;
grant execute on function public.issue_google_admin_pdf_publication_ticket_v1(
  text, uuid, uuid, text, text, integer, boolean, uuid, uuid, integer, uuid,
  text, text, bigint, integer, integer, text, text, boolean, text, text, text
) to service_role;

create function private.prepare_google_admin_pdf_publication_finalize_v1(
  target_token_hash text,
  target_auth_user_id uuid,
  target_supabase_auth_session_id uuid,
  target_google_issuer text,
  target_provider_subject_hmac text,
  target_subject_pepper_version integer,
  target_transport_enabled boolean,
  target_finalize_request_id uuid,
  target_lecture_session_id uuid,
  target_publication_id uuid,
  target_commit_operation_id uuid,
  target_activation_operation_id uuid,
  target_key_version integer
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
  operation_key_value text := 'manage-pdf-publications.finalize';
  context_value jsonb;
  receipt_row private.admin_google_operation_receipts%rowtype;
  binding_row private.admin_google_pdf_publication_bindings%rowtype;
  continuation_row private.admin_google_pdf_publication_continuations%rowtype;
  publication_row public.lecture_pdf_publications%rowtype;
  payload_digest_value text;
  intent_digest_value text;
  result_value jsonb;
  continuation_expires_at timestamptz;
  effective_now timestamptz := statement_timestamp();
begin
  if target_finalize_request_id is null
     or target_lecture_session_id is null
     or target_publication_id is null
     or target_commit_operation_id is null
     or target_activation_operation_id is null
     or target_commit_operation_id = target_activation_operation_id
     or target_key_version is null
     or target_key_version < 1
     or target_transport_enabled is null then
    return null;
  end if;

  perform private.serialize_admin_ai_request_v1(target_finalize_request_id);

  select binding.*
  into binding_row
  from private.admin_google_pdf_publication_bindings as binding
  join public.lecture_pdf_publications as publication
    on publication.id = binding.publication_id
  where binding.publication_id = target_publication_id
    and publication.lecture_session_id = target_lecture_session_id;
  if not found then
    return null;
  end if;

  context_value := private.require_google_admin_operation_context_v1(
    target_token_hash,
    target_auth_user_id,
    target_supabase_auth_session_id,
    target_google_issuer,
    target_provider_subject_hmac,
    target_subject_pepper_version,
    operation_key_value,
    target_lecture_session_id
  );
  if context_value is null
     or binding_row.environment_id <>
       (context_value ->> 'environment_id')::uuid
     or binding_row.principal_id <>
       (context_value ->> 'principal_id')::uuid
     or binding_row.membership_id <>
       (context_value ->> 'membership_id')::uuid
     or binding_row.auth_user_id <> target_auth_user_id then
    return null;
  end if;

  payload_digest_value := encode(
    extensions.digest(
      convert_to(
        jsonb_build_object(
          'activation_operation_id', target_activation_operation_id,
          'commit_operation_id', target_commit_operation_id,
          'key_version', target_key_version,
          'publication_id', target_publication_id
        )::text,
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );
  intent_digest_value := private.google_admin_operation_intent_digest_v1(
    target_finalize_request_id,
    (context_value ->> 'admin_session_id')::uuid,
    operation_key_value,
    target_lecture_session_id,
    target_publication_id::text,
    payload_digest_value
  );
  if intent_digest_value is null then
    return null;
  end if;

  select receipt.*
  into receipt_row
  from private.admin_google_operation_receipts as receipt
  where receipt.request_id = target_finalize_request_id;
  if found then
    if receipt_row.operation_key <> operation_key_value
       or receipt_row.intent_digest <> intent_digest_value
       or receipt_row.environment_id <>
         (context_value ->> 'environment_id')::uuid
       or receipt_row.principal_id <>
         (context_value ->> 'principal_id')::uuid
       or receipt_row.membership_id <>
         (context_value ->> 'membership_id')::uuid
       or receipt_row.admin_session_id <>
         (context_value ->> 'admin_session_id')::uuid
       or receipt_row.supabase_auth_session_id <>
         target_supabase_auth_session_id
       or receipt_row.lecture_session_id <> target_lecture_session_id
       or receipt_row.target_id <> target_publication_id::text then
      raise exception 'PDF finalize request binding does not match its receipt'
        using errcode = 'P7335';
    end if;

    select continuation.*
    into continuation_row
    from private.admin_google_pdf_publication_continuations as continuation
    where continuation.finalize_request_id = target_finalize_request_id
      and continuation.publication_id = target_publication_id;
    if not found
       or continuation_row.intent_digest <> intent_digest_value
       or continuation_row.commit_operation_id <> target_commit_operation_id
       or continuation_row.activation_operation_id <>
         target_activation_operation_id
       or continuation_row.key_version <> target_key_version then
      raise exception 'PDF finalize continuation is incomplete or misbound'
        using errcode = 'P7335';
    end if;

    perform private.assert_google_admin_operation_lecture_state_v1(
      context_value
    );
    result_value := private.build_pdf_publication_result_v1(
      target_publication_id
    );
    return result_value || jsonb_build_object(
      'activationOperationId', continuation_row.activation_operation_id,
      'commitOperationId', continuation_row.commit_operation_id,
      'continuationExpiresAt', continuation_row.expires_at,
      'finalizeRequestId', continuation_row.finalize_request_id,
      'idempotentReplay', true,
      'keyVersion', continuation_row.key_version,
      'ok', true
    );
  end if;

  perform private.assert_google_admin_operation_gate_v1(
    context_value,
    target_transport_enabled
  );
  perform private.assert_google_admin_operation_lecture_state_v1(
    context_value
  );

  select publication.*
  into publication_row
  from public.lecture_pdf_publications as publication
  where publication.id = target_publication_id
    and publication.lecture_session_id = target_lecture_session_id
  for update;
  if not found
     or publication_row.state not in ('pending', 'uploaded', 'committed')
     or publication_row.operation_expires_at <= effective_now then
    raise exception 'PDF publication is not available to finalize'
      using errcode = '55000';
  end if;

  continuation_expires_at := least(
    effective_now + interval '15 minutes',
    publication_row.operation_expires_at,
    (context_value ->> 'expires_at')::timestamptz
  );
  if continuation_expires_at <= effective_now + interval '30 seconds' then
    raise exception 'PDF finalize continuation window is unavailable'
      using errcode = '55000';
  end if;

  insert into private.admin_google_pdf_publication_continuations (
    finalize_request_id,
    publication_id,
    environment_id,
    principal_id,
    membership_id,
    admin_session_id,
    supabase_auth_session_id,
    intent_digest,
    commit_operation_id,
    activation_operation_id,
    key_version,
    authorized_at,
    expires_at
  ) values (
    target_finalize_request_id,
    target_publication_id,
    (context_value ->> 'environment_id')::uuid,
    (context_value ->> 'principal_id')::uuid,
    (context_value ->> 'membership_id')::uuid,
    (context_value ->> 'admin_session_id')::uuid,
    target_supabase_auth_session_id,
    intent_digest_value,
    target_commit_operation_id,
    target_activation_operation_id,
    target_key_version,
    effective_now,
    continuation_expires_at
  )
  returning * into continuation_row;

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
    target_finalize_request_id,
    operation_key_value,
    intent_digest_value,
    (context_value ->> 'environment_id')::uuid,
    (context_value ->> 'principal_id')::uuid,
    (context_value ->> 'membership_id')::uuid,
    (context_value ->> 'admin_session_id')::uuid,
    target_supabase_auth_session_id,
    target_lecture_session_id,
    target_publication_id::text,
    target_publication_id::text,
    'authorized',
    jsonb_build_object(
      'activationOperationId', target_activation_operation_id,
      'commitOperationId', target_commit_operation_id,
      'continuationExpiresAt', continuation_expires_at,
      'keyVersion', target_key_version,
      'publicationId', target_publication_id,
      'state', publication_row.state
    )
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
    target_finalize_request_id,
    (context_value ->> 'environment_id')::uuid,
    (context_value ->> 'principal_id')::uuid,
    (context_value ->> 'membership_id')::uuid,
    (context_value ->> 'admin_session_id')::uuid,
    'admin_pdf_publication.finalize_authorize',
    'pdf_publication',
    target_publication_id::text,
    'accepted',
    'google_admin_operation',
    jsonb_build_object(
      'continuation_expires_at', continuation_expires_at,
      'lecture_session_id', target_lecture_session_id
    )
  );

  result_value := private.build_pdf_publication_result_v1(
    target_publication_id
  );
  return result_value || jsonb_build_object(
    'activationOperationId', target_activation_operation_id,
    'commitOperationId', target_commit_operation_id,
    'continuationExpiresAt', continuation_expires_at,
    'finalizeRequestId', target_finalize_request_id,
    'idempotentReplay', false,
    'keyVersion', target_key_version,
    'ok', true
  );
end;
$$;

revoke all on function private.prepare_google_admin_pdf_publication_finalize_v1(
  text, uuid, uuid, text, text, integer, boolean, uuid, uuid, uuid, uuid, uuid,
  integer
) from public, anon, authenticated, service_role;

create function public.prepare_google_admin_pdf_publication_finalize_v1(
  target_token_hash text,
  target_auth_user_id uuid,
  target_supabase_auth_session_id uuid,
  target_google_issuer text,
  target_provider_subject_hmac text,
  target_subject_pepper_version integer,
  target_transport_enabled boolean,
  target_finalize_request_id uuid,
  target_lecture_session_id uuid,
  target_publication_id uuid,
  target_commit_operation_id uuid,
  target_activation_operation_id uuid,
  target_key_version integer
)
returns jsonb
language sql
volatile
security definer
set search_path = ''
as $$
  select private.prepare_google_admin_pdf_publication_finalize_v1(
    target_token_hash,
    target_auth_user_id,
    target_supabase_auth_session_id,
    target_google_issuer,
    target_provider_subject_hmac,
    target_subject_pepper_version,
    target_transport_enabled,
    target_finalize_request_id,
    target_lecture_session_id,
    target_publication_id,
    target_commit_operation_id,
    target_activation_operation_id,
    target_key_version
  );
$$;

revoke all on function public.prepare_google_admin_pdf_publication_finalize_v1(
  text, uuid, uuid, text, text, integer, boolean, uuid, uuid, uuid, uuid, uuid,
  integer
) from public, anon, authenticated;
grant execute on function public.prepare_google_admin_pdf_publication_finalize_v1(
  text, uuid, uuid, text, text, integer, boolean, uuid, uuid, uuid, uuid, uuid,
  integer
) to service_role;
