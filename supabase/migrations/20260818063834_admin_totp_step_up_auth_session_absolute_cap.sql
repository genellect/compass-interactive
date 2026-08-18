-- Reject an expired backing Supabase Auth session before asking the educator
-- to complete TOTP. The existing eight-hour absolute cap remains unchanged;
-- this moves the same invariant ahead of nonce creation so the browser can
-- restart Google authentication instead of reaching a late session INSERT
-- failure.
create or replace function private.begin_admin_totp_step_up_v2(
  target_environment_id uuid,
  target_auth_user_id uuid,
  target_supabase_auth_session_id uuid,
  target_challenged_factor_id uuid,
  target_nonce_hash text,
  target_reserved_admin_session_id uuid,
  target_prechallenge_jwt_hash text,
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
  principal_row private.admin_principals%rowtype;
  membership_row private.admin_environment_memberships%rowtype;
  auth_session_created_at timestamptz;
  prechallenge_factor_set_snapshot text;
  factor_set_snapshot text;
  challenged_factor_status text;
  current_factor_count integer;
  bootstrap_allowed boolean := false;
  issued_at_value timestamptz := statement_timestamp();
  nonce_id uuid;
begin
  if target_environment_id is null
     or target_auth_user_id is null
     or target_supabase_auth_session_id is null
     or target_challenged_factor_id is null
     or target_reserved_admin_session_id is null
     or target_request_id is null
     or target_nonce_hash is null
     or target_prechallenge_jwt_hash is null
     or target_nonce_hash !~ '^[0-9a-f]{64}$'
     or target_prechallenge_jwt_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid Admin TOTP step-up request' using errcode = '22023';
  end if;

  if not exists (
    select 1
    from private.admin_identity_runtime_gate as gate
    where gate.singleton and gate.google_session_issue_enabled
  ) then
    raise exception 'Admin Google identity is disabled' using errcode = 'P7300';
  end if;

  select principal.*
  into principal_row
  from private.admin_principals as principal
  where principal.auth_user_id = target_auth_user_id
    and principal.status = 'active'
  for update;
  if not found then
    return null;
  end if;

  select membership.*
  into membership_row
  from private.admin_environment_memberships as membership
  where membership.environment_id = target_environment_id
    and membership.principal_id = principal_row.id
    and membership.status in ('pending_mfa', 'active')
    and (membership.expires_at is null or membership.expires_at > issued_at_value)
  for update;
  if not found then
    return null;
  end if;

  -- Keep the established principal -> membership lock order, then pin the
  -- backing Auth row before any nonce ID, cleanup, supersede, insert or audit
  -- mutation can occur.
  select auth_session.created_at
  into auth_session_created_at
  from auth.sessions as auth_session
  where auth_session.id = target_supabase_auth_session_id
    and auth_session.user_id = target_auth_user_id
  for key share;
  if not found then
    raise exception 'Supabase Auth session does not exist'
      using errcode = 'P7323';
  end if;
  if auth_session_created_at + interval '8 hours' <= issued_at_value then
    raise exception 'Supabase Auth session absolute cap elapsed'
      using errcode = 'P7322';
  end if;

  nonce_id := extensions.gen_random_uuid();

  select factor.status
  into challenged_factor_status
  from auth.mfa_factors as factor
  where factor.id = target_challenged_factor_id
    and factor.user_id = target_auth_user_id
    and factor.factor_type = 'totp'
    and factor.status in ('unverified', 'verified');
  if not found then
    return null;
  end if;

  select snapshot.factor_set_hash, snapshot.factor_count
  into prechallenge_factor_set_snapshot, current_factor_count
  from private.current_verified_totp_factor_set_snapshot_v1(
    target_auth_user_id
  ) as snapshot;

  if principal_row.approved_totp_factor_set_hash is null then
    -- Automatic trust-anchor creation is limited to the first 0 -> 1 setup.
    -- A verified set already present on an unbound principal is never adopted
    -- from the browser or inferred from live Auth state.
    if membership_row.status <> 'pending_mfa'
       or prechallenge_factor_set_snapshot is not null
       or current_factor_count <> 0
       or challenged_factor_status <> 'unverified' then
      raise exception 'Admin TOTP factor-set adoption is required'
        using errcode = 'P7332';
    end if;

    factor_set_snapshot := private.expected_verified_totp_factor_set_hash_v1(
      target_auth_user_id,
      target_challenged_factor_id
    );
    if factor_set_snapshot is null then
      return null;
    end if;
    bootstrap_allowed := true;
  else
    if principal_row.approved_totp_factor_set_version < 1
       or principal_row.approved_totp_factor_count < 1
       or prechallenge_factor_set_snapshot is distinct from
         principal_row.approved_totp_factor_set_hash
       or current_factor_count <> principal_row.approved_totp_factor_count then
      raise exception 'approved Admin TOTP factor set changed'
        using errcode = 'P7330';
    end if;
    if challenged_factor_status <> 'verified' then
      return null;
    end if;
    factor_set_snapshot := principal_row.approved_totp_factor_set_hash;
  end if;

  if (
    select count(*) >= 10
    from private.admin_audit_events as event
    where event.actor_principal_id = principal_row.id
      and event.action = 'admin_step_up.begin'
      and event.occurred_at >= issued_at_value - interval '5 minutes'
  ) then
    raise exception 'Admin TOTP step-up rate exceeded' using errcode = 'P7301';
  end if;

  delete from private.admin_step_up_nonces as nonce
  where nonce.principal_id = principal_row.id
    and nonce.status in ('superseded', 'expired')
    and nonce.expires_at < issued_at_value - interval '1 day';

  update private.admin_step_up_nonces
  set status = 'superseded', updated_at = issued_at_value
  where supabase_auth_session_id = target_supabase_auth_session_id
    and intended_action = 'admin_login'
    and status = 'pending';

  insert into private.admin_step_up_nonces (
    id,
    nonce_hash,
    reserved_admin_session_id,
    environment_id,
    principal_id,
    membership_id,
    supabase_auth_session_id,
    intended_action,
    request_id,
    prechallenge_jwt_hash,
    min_amr_at,
    challenged_totp_factor_id,
    prechallenge_verified_totp_factor_set_hash,
    verified_totp_factor_set_hash,
    factor_set_bootstrap_allowed,
    approved_totp_factor_set_version,
    issued_at,
    expires_at
  ) values (
    nonce_id,
    target_nonce_hash,
    target_reserved_admin_session_id,
    target_environment_id,
    principal_row.id,
    membership_row.id,
    target_supabase_auth_session_id,
    'admin_login',
    target_request_id,
    target_prechallenge_jwt_hash,
    issued_at_value,
    target_challenged_factor_id,
    prechallenge_factor_set_snapshot,
    factor_set_snapshot,
    bootstrap_allowed,
    principal_row.approved_totp_factor_set_version,
    issued_at_value,
    issued_at_value + interval '5 minutes'
  );

  insert into private.admin_audit_events (
    request_id,
    environment_id,
    actor_principal_id,
    actor_membership_id,
    action,
    target_type,
    target_id,
    result,
    metadata
  ) values (
    target_request_id,
    target_environment_id,
    principal_row.id,
    membership_row.id,
    'admin_step_up.begin',
    'admin_step_up_nonce',
    nonce_id::text,
    'accepted',
    jsonb_build_object(
      'challenged_factor_id', target_challenged_factor_id,
      'approved_factor_set_version',
        principal_row.approved_totp_factor_set_version,
      'factor_set_bootstrap_allowed', bootstrap_allowed,
      'factor_set_snapshot_bound', true
    )
  );

  return jsonb_build_object(
    'expires_at', issued_at_value + interval '5 minutes',
    'issued_at', issued_at_value,
    'nonce_id', nonce_id,
    'reserved_admin_session_id', target_reserved_admin_session_id
  );
end;
$$;

revoke all on function private.begin_admin_totp_step_up_v2(
  uuid, uuid, uuid, uuid, text, uuid, text, uuid
) from public, anon, authenticated, service_role;

grant execute on function private.begin_admin_totp_step_up_v2(
  uuid, uuid, uuid, uuid, text, uuid, text, uuid
) to service_role;
