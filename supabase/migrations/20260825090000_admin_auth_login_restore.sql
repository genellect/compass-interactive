-- Keep one browser login on one admission receipt and permit a lost tab-scoped
-- application token to be rotated only inside the same live AAL2 Auth session.

create function private.consume_admin_identity_admission_once_v1(
  target_environment_id uuid,
  target_auth_user_id uuid,
  target_google_issuer text,
  target_provider_subject_hmac text,
  target_subject_pepper_version integer,
  target_normalized_email text,
  target_email_digest text,
  target_display_name text,
  target_request_id uuid,
  target_invitation_token_hash text default null
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
  principal_row private.admin_principals%rowtype;
  membership_row private.admin_environment_memberships%rowtype;
  replay_event private.admin_audit_events%rowtype;
  effective_now timestamptz := statement_timestamp();
begin
  if target_request_id is null then
    raise exception 'invalid Admin identity admission' using errcode = '22023';
  end if;

  perform private.serialize_admin_ai_request_v1(target_request_id);

  -- Once this exact logical request was accepted, replay only its exact
  -- Google principal, membership, environment, and accepted audit binding.
  select principal.*
  into principal_row
  from private.admin_principals as principal
  where principal.auth_user_id = target_auth_user_id
    and principal.status = 'active'
    and principal.google_issuer = target_google_issuer
    and principal.provider_subject_hmac = target_provider_subject_hmac
    and principal.subject_pepper_version = target_subject_pepper_version;

  if found then
    select membership.*
    into membership_row
    from private.admin_environment_memberships as membership
    join private.admin_environments as environment
      on environment.id = membership.environment_id
     and environment.current_deployment
     and environment.status = 'active'
    where membership.environment_id = target_environment_id
      and membership.principal_id = principal_row.id
      and membership.status in ('pending_mfa', 'active')
      and (
        membership.expires_at is null
        or membership.expires_at > effective_now
      );

    if found then
      select event.*
      into replay_event
      from private.admin_audit_events as event
      where event.request_id = target_request_id
        and event.environment_id = target_environment_id
        and event.actor_principal_id = principal_row.id
        and event.actor_membership_id = membership_row.id
        and event.action = 'admin_identity.admit'
        and event.result = 'accepted'
      order by event.id
      limit 1;

      if found then
        return jsonb_build_object(
          'eligible', true,
          'idempotent_replay', true,
          'membership_id', membership_row.id,
          'principal_id', principal_row.id
        );
      end if;
    end if;
  end if;

  return private.consume_admin_identity_admission_v1(
    target_environment_id,
    target_auth_user_id,
    target_google_issuer,
    target_provider_subject_hmac,
    target_subject_pepper_version,
    target_normalized_email,
    target_email_digest,
    target_display_name,
    target_request_id,
    target_invitation_token_hash
  );
end;
$$;

create function private.restore_google_admin_session_v1(
  target_token_hash text,
  target_auth_user_id uuid,
  target_supabase_auth_session_id uuid,
  target_google_issuer text,
  target_provider_subject_hmac text,
  target_subject_pepper_version integer,
  target_network_hash text,
  target_user_agent_hash text,
  target_request_id uuid
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
  session_snapshot public.admin_sessions%rowtype;
  session_row public.admin_sessions%rowtype;
  principal_row private.admin_principals%rowtype;
  membership_row private.admin_environment_memberships%rowtype;
  environment_row private.admin_environments%rowtype;
  auth_session_created_at timestamptz;
  current_factor_set_hash text;
  effective_now timestamptz := statement_timestamp();
  rejection_reason text;
begin
  if target_token_hash is null
     or target_token_hash !~ '^[0-9a-f]{64}$'
     or target_auth_user_id is null
     or target_supabase_auth_session_id is null
     or target_google_issuer <> 'https://accounts.google.com'
     or target_provider_subject_hmac !~ '^[0-9a-f]{64}$'
     or target_subject_pepper_version is null
     or target_subject_pepper_version < 1
     or target_request_id is null
     or (
       target_network_hash is not null
       and target_network_hash !~ '^[0-9a-f]{64}$'
     )
     or (
       target_user_agent_hash is not null
       and target_user_agent_hash !~ '^[0-9a-f]{64}$'
     ) then
    raise exception 'invalid Google Admin session restore' using errcode = '22023';
  end if;

  if not exists (
    select 1
    from private.admin_identity_runtime_gate as gate
    where gate.singleton and gate.google_session_issue_enabled
  ) then
    raise exception 'Admin Google identity is disabled' using errcode = 'P7300';
  end if;

  select session.*
  into session_snapshot
  from public.admin_sessions as session
  where session.authentication_method = 'google_totp'
    and session.aal = 2
    and session.auth_user_id = target_auth_user_id
    and session.supabase_auth_session_id = target_supabase_auth_session_id
    and session.token_hash = target_token_hash
    and session.revoked_at is null
  order by session.issued_at desc, session.id desc
  limit 1;
  if not found then
    return null;
  end if;

  -- Follow the canonical Admin authorization lock order. The initial session
  -- lookup is lock-free and only supplies immutable row identifiers; every
  -- security binding is revalidated again after the identity locks are held.
  select principal.*
  into principal_row
  from private.admin_principals as principal
  where principal.id = session_snapshot.principal_id
    and principal.auth_user_id = target_auth_user_id
    and principal.google_issuer = target_google_issuer
    and principal.provider_subject_hmac = target_provider_subject_hmac
    and principal.subject_pepper_version = target_subject_pepper_version
  for update;

  select membership.*
  into membership_row
  from private.admin_environment_memberships as membership
  where membership.id = session_snapshot.membership_id
    and membership.environment_id = session_snapshot.environment_id
    and membership.principal_id = session_snapshot.principal_id
  for update;

  select environment.*
  into environment_row
  from private.admin_environments as environment
  where environment.id = session_snapshot.environment_id
  for share;

  select session.*
  into session_row
  from public.admin_sessions as session
  where session.id = session_snapshot.id
    and session.authentication_method = 'google_totp'
    and session.aal = 2
    and session.auth_user_id = target_auth_user_id
    and session.supabase_auth_session_id = target_supabase_auth_session_id
    and session.environment_id = session_snapshot.environment_id
    and session.principal_id = session_snapshot.principal_id
    and session.membership_id = session_snapshot.membership_id
    and session.token_hash = target_token_hash
  for update;
  if not found then
    return null;
  end if;

  select auth_session.created_at
  into auth_session_created_at
  from auth.sessions as auth_session
  where auth_session.id = target_supabase_auth_session_id
    and auth_session.user_id = target_auth_user_id
  for key share;

  current_factor_set_hash := private.current_verified_totp_factor_set_hash_v1(
    target_auth_user_id
  );
  rejection_reason := case
    when session_row.revoked_at is not null then coalesce(session_row.revoke_reason, 'revoked')
    when auth_session_created_at is null then 'auth_session_revoked'
    when auth_session_created_at + interval '8 hours' <= effective_now then 'absolute_expiry'
    when session_row.expires_at <= effective_now then 'absolute_expiry'
    when principal_row.id is null or principal_row.status <> 'active' then 'principal_inactive'
    when membership_row.id is null or membership_row.status <> 'active' then 'membership_inactive'
    when membership_row.expires_at is not null and membership_row.expires_at <= effective_now then 'membership_expired'
    when environment_row.id is null
      or environment_row.status <> 'active'
      or not environment_row.current_deployment then 'environment_inactive'
    when current_factor_set_hash is null
      or principal_row.approved_totp_factor_set_hash is distinct from current_factor_set_hash
      or session_row.verified_totp_factor_set_hash is distinct from current_factor_set_hash then 'totp_factor_set_changed'
    else null
  end;

  if rejection_reason is not null then
    if session_row.revoked_at is null then
      update public.admin_sessions
      set
        revoked_at = effective_now,
        revoke_reason = rejection_reason,
        updated_at = effective_now
      where id = session_row.id;
    end if;
    return null;
  end if;

  update public.admin_sessions
  set
    network_hash = target_network_hash,
    user_agent_hash = target_user_agent_hash,
    last_seen_at = effective_now,
    idle_expires_at = expires_at,
    updated_at = effective_now
  where id = session_row.id
  returning * into session_row;

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
    metadata
  ) values (
    target_request_id,
    session_row.environment_id,
    session_row.principal_id,
    session_row.membership_id,
    session_row.id,
    'admin_session.restore',
    'admin_session',
    session_row.id::text,
    'accepted',
    jsonb_build_object('token_restored', true)
  );

  return jsonb_build_object(
    'can_use_ai', membership_row.can_use_ai,
    'environment_id', session_row.environment_id,
    'expires_at', session_row.expires_at,
    'id', session_row.id,
    'idle_expires_at', session_row.idle_expires_at,
    'membership_id', session_row.membership_id,
    'principal_id', session_row.principal_id,
    'role', membership_row.role,
    'step_up_verified_at', session_row.step_up_verified_at
  );
end;
$$;

create function public.consume_admin_identity_admission_once_v1(
  target_environment_id uuid,
  target_auth_user_id uuid,
  target_google_issuer text,
  target_provider_subject_hmac text,
  target_subject_pepper_version integer,
  target_normalized_email text,
  target_email_digest text,
  target_display_name text,
  target_request_id uuid,
  target_invitation_token_hash text default null
)
returns jsonb
language sql
volatile
security invoker
set search_path = ''
as $$
  select private.consume_admin_identity_admission_once_v1(
    target_environment_id,
    target_auth_user_id,
    target_google_issuer,
    target_provider_subject_hmac,
    target_subject_pepper_version,
    target_normalized_email,
    target_email_digest,
    target_display_name,
    target_request_id,
    target_invitation_token_hash
  );
$$;

create function public.restore_google_admin_session_v1(
  target_token_hash text,
  target_auth_user_id uuid,
  target_supabase_auth_session_id uuid,
  target_google_issuer text,
  target_provider_subject_hmac text,
  target_subject_pepper_version integer,
  target_network_hash text,
  target_user_agent_hash text,
  target_request_id uuid
)
returns jsonb
language sql
volatile
security invoker
set search_path = ''
as $$
  select private.restore_google_admin_session_v1(
    target_token_hash,
    target_auth_user_id,
    target_supabase_auth_session_id,
    target_google_issuer,
    target_provider_subject_hmac,
    target_subject_pepper_version,
    target_network_hash,
    target_user_agent_hash,
    target_request_id
  );
$$;

revoke all on function private.consume_admin_identity_admission_once_v1(uuid, uuid, text, text, integer, text, text, text, uuid, text)
  from public, anon, authenticated, service_role;
revoke all on function private.restore_google_admin_session_v1(text, uuid, uuid, text, text, integer, text, text, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.consume_admin_identity_admission_once_v1(uuid, uuid, text, text, integer, text, text, text, uuid, text)
  from public, anon, authenticated, service_role;
revoke all on function public.restore_google_admin_session_v1(text, uuid, uuid, text, text, integer, text, text, uuid)
  from public, anon, authenticated, service_role;

grant execute on function private.consume_admin_identity_admission_once_v1(uuid, uuid, text, text, integer, text, text, text, uuid, text)
  to service_role;
grant execute on function private.restore_google_admin_session_v1(text, uuid, uuid, text, text, integer, text, text, uuid)
  to service_role;
grant execute on function public.consume_admin_identity_admission_once_v1(uuid, uuid, text, text, integer, text, text, text, uuid, text)
  to service_role;
grant execute on function public.restore_google_admin_session_v1(text, uuid, uuid, text, text, integer, text, text, uuid)
  to service_role;
