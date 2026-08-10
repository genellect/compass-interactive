-- Phase 7.30B2.2a: authoritative TOTP factor-set binding and rare-control
-- step-up grants. Everything remains behind the existing default-OFF identity
-- and AI-unlock runtime gates. No hosted object or recurring service is added.

-- The live Auth factor set is not itself a trust anchor: an old AAL2 bearer
-- can add and verify another factor upstream. Keep the approved set on the
-- globally unique Admin principal and never infer it from pre-B2.2a rows.
alter table private.admin_identity_runtime_gate
  add column operator_totp_factor_set_adoption_enabled boolean not null
    default false;

alter table private.admin_principals
  add column approved_totp_factor_set_hash text,
  add column approved_totp_factor_set_version bigint not null default 0,
  add column approved_totp_factor_count integer not null default 0,
  add column approved_totp_factor_set_at timestamptz,
  add column approved_totp_factor_set_request_id uuid,
  add column approved_totp_factor_set_source text,
  add column approved_totp_factor_set_actor text,
  add column approved_totp_factor_set_reason text,
  add constraint admin_principals_approved_totp_factor_set_check check (
    (
      approved_totp_factor_set_hash is null
      and approved_totp_factor_set_version = 0
      and approved_totp_factor_count = 0
      and approved_totp_factor_set_at is null
      and approved_totp_factor_set_request_id is null
      and approved_totp_factor_set_source is null
      and approved_totp_factor_set_actor is null
      and approved_totp_factor_set_reason is null
    )
    or (
      approved_totp_factor_set_hash ~ '^[0-9a-f]{64}$'
      and approved_totp_factor_set_version >= 1
      and approved_totp_factor_count >= 1
      and approved_totp_factor_set_at is not null
      and approved_totp_factor_set_request_id is not null
      and approved_totp_factor_set_source in (
        'login_bootstrap',
        'operator_adoption'
      )
      and approved_totp_factor_set_actor is not null
      and char_length(approved_totp_factor_set_actor) between 3 and 160
      and approved_totp_factor_set_reason is not null
      and char_length(approved_totp_factor_set_reason) between 3 and 500
    )
  );

create unique index admin_principals_approved_totp_request_idx
  on private.admin_principals (approved_totp_factor_set_request_id)
  where approved_totp_factor_set_request_id is not null;

comment on column private.admin_principals.approved_totp_factor_set_hash is
  'Authoritative approved verified-TOTP set digest. NULL is unbound and must never be inferred/backfilled from Auth factors or legacy sessions.';

comment on column private.admin_identity_runtime_gate.operator_totp_factor_set_adoption_enabled is
  'Default-OFF service-role/operator recovery gate. It is intentionally not exposed through the Admin identity Edge action allowlist.';

alter table public.admin_sessions
  add column verified_totp_factor_set_hash text check (
    verified_totp_factor_set_hash is null
    or verified_totp_factor_set_hash ~ '^[0-9a-f]{64}$'
  );

create index admin_sessions_active_totp_factor_set_idx
  on public.admin_sessions (
    auth_user_id,
    verified_totp_factor_set_hash,
    id
  )
  where authentication_method = 'google_totp' and revoked_at is null;

alter table private.admin_step_up_nonces
  add column challenged_totp_factor_id uuid,
  add column prechallenge_verified_totp_factor_set_hash text check (
    prechallenge_verified_totp_factor_set_hash is null
    or prechallenge_verified_totp_factor_set_hash ~ '^[0-9a-f]{64}$'
  ),
  add column completion_jwt_hash text check (
    completion_jwt_hash is null or completion_jwt_hash ~ '^[0-9a-f]{64}$'
  ),
  add column verified_totp_amr_at timestamptz,
  add column verified_totp_factor_set_hash text check (
    verified_totp_factor_set_hash is null
    or verified_totp_factor_set_hash ~ '^[0-9a-f]{64}$'
  ),
  add column factor_set_bootstrap_allowed boolean not null default false,
  add column approved_totp_factor_set_version bigint not null default 0 check (
    approved_totp_factor_set_version >= 0
  );

alter table private.admin_ai_unlock_factors
  add column terminal_request_id uuid,
  add column terminal_action text check (
    terminal_action is null or terminal_action in ('revoke', 'reset')
  ),
  add column terminal_by_admin_session_id uuid
    references public.admin_sessions(id) on delete restrict,
  add constraint admin_ai_unlock_factors_terminal_binding_check check (
    (
      terminal_request_id is null
      and terminal_action is null
      and terminal_by_admin_session_id is null
    )
    or (
      status = 'revoked'
      and terminal_request_id is not null
      and terminal_action is not null
      and terminal_by_admin_session_id is not null
    )
  );

create unique index admin_ai_unlock_factors_terminal_request_idx
  on private.admin_ai_unlock_factors (terminal_request_id)
  where terminal_request_id is not null;

create index admin_ai_unlock_factors_terminal_session_idx
  on private.admin_ai_unlock_factors (
    terminal_by_admin_session_id,
    updated_at desc
  )
  where terminal_by_admin_session_id is not null;

create table private.admin_control_step_up_nonces (
  id uuid primary key default extensions.gen_random_uuid(),
  nonce_hash text not null unique check (nonce_hash ~ '^[0-9a-f]{64}$'),
  environment_id uuid not null
    references private.admin_environments(id) on delete restrict,
  principal_id uuid not null
    references private.admin_principals(id) on delete restrict,
  membership_id uuid not null
    references private.admin_environment_memberships(id) on delete restrict,
  admin_session_id uuid not null
    references public.admin_sessions(id) on delete restrict,
  supabase_auth_session_id uuid not null,
  verified_totp_factor_set_hash text not null check (
    verified_totp_factor_set_hash ~ '^[0-9a-f]{64}$'
  ),
  intended_action text not null check (
    intended_action in (
      'ai_pin_enroll',
      'ai_pin_rotate',
      'ai_pin_revoke',
      'ai_pin_reset',
      'environment_ai_policy_change'
    )
  ),
  intent_digest text not null check (intent_digest ~ '^[0-9a-f]{64}$'),
  mutation_request_id uuid not null unique,
  prechallenge_jwt_hash text not null check (
    prechallenge_jwt_hash ~ '^[0-9a-f]{64}$'
  ),
  min_amr_at timestamptz not null,
  issued_at timestamptz not null default statement_timestamp(),
  expires_at timestamptz not null,
  status text not null default 'pending' check (
    status in ('pending', 'consumed', 'superseded', 'expired')
  ),
  consumed_at timestamptz,
  -- Deliberately not a reverse foreign key. Grants already reference nonces;
  -- adding the inverse edge would prevent bounded cleanup.
  completed_grant_id uuid,
  updated_at timestamptz not null default statement_timestamp(),
  check (
    expires_at > issued_at
    and expires_at <= issued_at + interval '5 minutes'
  ),
  check (
    (status = 'consumed') = (
      consumed_at is not null and completed_grant_id is not null
    )
  )
);

create unique index admin_control_step_up_pending_session_action_idx
  on private.admin_control_step_up_nonces (admin_session_id, intended_action)
  where status = 'pending';

create index admin_control_step_up_nonce_expiry_idx
  on private.admin_control_step_up_nonces (expires_at, id)
  where status = 'pending';

create index admin_control_step_up_nonce_retention_idx
  on private.admin_control_step_up_nonces (updated_at, id)
  where status in ('consumed', 'superseded', 'expired');

create index admin_control_step_up_nonce_environment_idx
  on private.admin_control_step_up_nonces (environment_id, status);

create index admin_control_step_up_nonce_principal_idx
  on private.admin_control_step_up_nonces (principal_id, status);

create index admin_control_step_up_nonce_membership_idx
  on private.admin_control_step_up_nonces (membership_id, status);

create index admin_control_step_up_nonce_session_idx
  on private.admin_control_step_up_nonces (admin_session_id, status);

create table private.admin_control_step_up_grants (
  id uuid primary key default extensions.gen_random_uuid(),
  source_kind text not null check (source_kind in ('admin_login', 'control')),
  control_nonce_id uuid
    references private.admin_control_step_up_nonces(id) on delete restrict,
  login_step_up_nonce_id uuid
    references private.admin_step_up_nonces(id) on delete restrict,
  environment_id uuid not null
    references private.admin_environments(id) on delete restrict,
  principal_id uuid not null
    references private.admin_principals(id) on delete restrict,
  membership_id uuid not null
    references private.admin_environment_memberships(id) on delete restrict,
  admin_session_id uuid not null
    references public.admin_sessions(id) on delete restrict,
  supabase_auth_session_id uuid not null,
  verified_totp_factor_set_hash text not null check (
    verified_totp_factor_set_hash ~ '^[0-9a-f]{64}$'
  ),
  intended_action text not null check (
    intended_action in (
      'ai_pin_enroll',
      'ai_pin_rotate',
      'ai_pin_revoke',
      'ai_pin_reset',
      'environment_ai_policy_change'
    )
  ),
  intent_digest text not null check (intent_digest ~ '^[0-9a-f]{64}$'),
  mutation_request_id uuid not null unique,
  prechallenge_jwt_hash text not null check (
    prechallenge_jwt_hash ~ '^[0-9a-f]{64}$'
  ),
  completion_jwt_hash text not null check (
    completion_jwt_hash ~ '^[0-9a-f]{64}$'
  ),
  min_amr_at timestamptz not null,
  verified_totp_amr_at timestamptz not null,
  issued_at timestamptz not null default statement_timestamp(),
  expires_at timestamptz not null,
  status text not null default 'available' check (
    status in ('available', 'consumed', 'superseded', 'expired')
  ),
  consumed_at timestamptz,
  updated_at timestamptz not null default statement_timestamp(),
  check (
    (
      source_kind = 'admin_login'
      and control_nonce_id is null
      and login_step_up_nonce_id is not null
    )
    or (
      source_kind = 'control'
      and control_nonce_id is not null
      and login_step_up_nonce_id is null
    )
  ),
  check (
    expires_at > issued_at
    and expires_at <= verified_totp_amr_at + interval '5 minutes'
  ),
  check ((status = 'consumed') = (consumed_at is not null))
);

create unique index admin_control_step_up_grant_control_nonce_idx
  on private.admin_control_step_up_grants (control_nonce_id)
  where control_nonce_id is not null;

create unique index admin_control_step_up_grant_login_action_idx
  on private.admin_control_step_up_grants (
    login_step_up_nonce_id,
    intended_action
  )
  where login_step_up_nonce_id is not null;

create index admin_control_step_up_grant_available_idx
  on private.admin_control_step_up_grants (
    admin_session_id,
    intended_action,
    expires_at
  )
  where status = 'available';

create index admin_control_step_up_grant_retention_idx
  on private.admin_control_step_up_grants (updated_at, id)
  where status in ('consumed', 'superseded', 'expired');

create index admin_control_step_up_grant_environment_idx
  on private.admin_control_step_up_grants (environment_id, status);

create index admin_control_step_up_grant_principal_idx
  on private.admin_control_step_up_grants (principal_id, status);

create index admin_control_step_up_grant_membership_idx
  on private.admin_control_step_up_grants (membership_id, status);

create index admin_control_step_up_grant_session_idx
  on private.admin_control_step_up_grants (admin_session_id, status);

alter table private.admin_control_step_up_nonces enable row level security;
alter table private.admin_control_step_up_grants enable row level security;

revoke all on private.admin_control_step_up_nonces
  from public, anon, authenticated, service_role;
revoke all on private.admin_control_step_up_grants
  from public, anon, authenticated, service_role;

comment on table private.admin_control_step_up_nonces is
  'Digest-only five-minute TOTP challenge boundary bound to canonical mutation intent, action, request, Admin/Auth session, factor set and pre-challenge JWT.';

comment on table private.admin_control_step_up_grants is
  'Single-use rare-control authority bound to a DB-recomputed canonical mutation intent. A login source is accepted only for the first AI PIN enrollment immediately after its tracked fresh TOTP event.';

create function private.current_verified_totp_factor_set_snapshot_v1(
  target_auth_user_id uuid
)
returns table (
  factor_set_hash text,
  factor_count integer
)
language sql
stable
security definer
set search_path = ''
set statement_timeout = '2s'
as $$
  select
    case
      when count(*) = 0 then null
      else pg_catalog.encode(
        extensions.digest(
          pg_catalog.convert_to(
            'compass:phase7.30:verified-totp-factor-set:v1|user='
            || target_auth_user_id::text
            || '|factors='
            || pg_catalog.string_agg(
              factor.id::text,
              ',' order by factor.id::text
            ),
            'UTF8'
          ),
          'sha256'
        ),
        'hex'
      )
    end as factor_set_hash,
    count(*)::integer as factor_count
  from auth.mfa_factors as factor
  where target_auth_user_id is not null
    and factor.user_id = target_auth_user_id
    and factor.factor_type = 'totp'
    and factor.status = 'verified';
$$;

revoke all on function private.current_verified_totp_factor_set_snapshot_v1(uuid)
  from public, anon, authenticated, service_role;

create function private.current_verified_totp_factor_set_hash_v1(
  target_auth_user_id uuid
)
returns text
language sql
stable
security definer
set search_path = ''
set statement_timeout = '2s'
as $$
  select snapshot.factor_set_hash
  from private.current_verified_totp_factor_set_snapshot_v1(
    target_auth_user_id
  ) as snapshot;
$$;

revoke all on function private.current_verified_totp_factor_set_hash_v1(uuid)
  from public, anon, authenticated, service_role;

create function private.current_verified_totp_factor_count_v1(
  target_auth_user_id uuid
)
returns integer
language sql
stable
security definer
set search_path = ''
set statement_timeout = '2s'
as $$
  select snapshot.factor_count
  from private.current_verified_totp_factor_set_snapshot_v1(
    target_auth_user_id
  ) as snapshot;
$$;

revoke all on function private.current_verified_totp_factor_count_v1(uuid)
  from public, anon, authenticated, service_role;

create function private.expected_verified_totp_factor_set_hash_v1(
  target_auth_user_id uuid,
  target_challenged_factor_id uuid
)
returns text
language sql
stable
security definer
set search_path = ''
set statement_timeout = '2s'
as $$
  with challenged as materialized (
    select factor.id, factor.status
    from auth.mfa_factors as factor
    where factor.id = target_challenged_factor_id
      and factor.user_id = target_auth_user_id
      and factor.factor_type = 'totp'
      and factor.status in ('unverified', 'verified')
  ),
  verified as materialized (
    select factor.id::text as factor_id
    from auth.mfa_factors as factor
    where factor.user_id = target_auth_user_id
      and factor.factor_type = 'totp'
      and factor.status = 'verified'
  ),
  eligible as (
    select verified.factor_id
    from verified
    union
    select challenged.id::text
    from challenged
    where challenged.status = 'unverified'
      -- An unverified candidate is login authority only for the first 0 -> 1
      -- enrollment. Adding a factor beside an existing verified set requires
      -- the deferred B2.2b rare-control flow and fresh proof of that set.
      and not exists (select 1 from verified)
  )
  select case
    when not exists (select 1 from challenged) then null
    when exists (
      select 1 from challenged where challenged.status = 'unverified'
    ) and exists (select 1 from verified) then null
    else pg_catalog.encode(
      extensions.digest(
        pg_catalog.convert_to(
          'compass:phase7.30:verified-totp-factor-set:v1|user='
          || target_auth_user_id::text
          || '|factors='
          || (
            select pg_catalog.string_agg(
              eligible.factor_id,
              ',' order by eligible.factor_id
            )
            from eligible
          ),
          'UTF8'
        ),
        'sha256'
      ),
      'hex'
    )
  end;
$$;

revoke all on function private.expected_verified_totp_factor_set_hash_v1(
  uuid, uuid
) from public, anon, authenticated, service_role;

-- Pending B1 login nonces have no trustworthy factor-set snapshot. Preserve
-- the rows for audit but supersede them rather than inferring a security bind.
with superseded_nonces as (
  update private.admin_step_up_nonces as nonce
  set status = 'superseded', updated_at = statement_timestamp()
  where nonce.intended_action = 'admin_login'
    and nonce.status = 'pending'
  returning nonce.*
)
insert into private.admin_audit_events (
  request_id,
  environment_id,
  actor_principal_id,
  actor_membership_id,
  action,
  target_type,
  target_id,
  result,
  reason_code,
  metadata
)
select
  extensions.gen_random_uuid(),
  nonce.environment_id,
  nonce.principal_id,
  nonce.membership_id,
  'admin_step_up.migration_supersede',
  'admin_step_up_nonce',
  nonce.id::text,
  'accepted',
  'totp_factor_set_migration',
  jsonb_build_object('factor_set_backfilled', false)
from superseded_nonces as nonce;

alter table private.admin_step_up_nonces
  add constraint admin_step_up_pending_factor_set_binding_check check (
    intended_action <> 'admin_login'
    or status <> 'pending'
    or (
      challenged_totp_factor_id is not null
      and verified_totp_factor_set_hash is not null
      and (
        (
          factor_set_bootstrap_allowed
          and approved_totp_factor_set_version = 0
          and prechallenge_verified_totp_factor_set_hash is null
        )
        or (
          not factor_set_bootstrap_allowed
          and approved_totp_factor_set_version >= 1
          and prechallenge_verified_totp_factor_set_hash =
            verified_totp_factor_set_hash
        )
      )
    )
  );

alter function private.begin_admin_totp_step_up_v1(
  uuid, uuid, uuid, text, uuid, text, uuid
) rename to begin_admin_totp_step_up_pre_b22a_v1;

revoke all on function private.begin_admin_totp_step_up_pre_b22a_v1(
  uuid, uuid, uuid, text, uuid, text, uuid
) from public, anon, authenticated, service_role;

-- The B1 public wrapper cannot express the challenged factor. Remove it so the
-- factor-bound v2 wrapper below is the only login-begin RPC after B2.2a.
drop function public.begin_admin_totp_step_up_v1(
  uuid, uuid, uuid, text, uuid, text, uuid
);

create function private.begin_admin_totp_step_up_v2(
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
  prechallenge_factor_set_snapshot text;
  factor_set_snapshot text;
  challenged_factor_status text;
  current_factor_count integer;
  bootstrap_allowed boolean := false;
  issued_at_value timestamptz := statement_timestamp();
  nonce_id uuid := extensions.gen_random_uuid();
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

create function private.hash_admin_control_intent_v1(
  target_canonical_intent text
)
returns text
language sql
immutable
security definer
set search_path = ''
set statement_timeout = '2s'
as $$
  select case
    when target_canonical_intent is null then null
    else pg_catalog.encode(
      extensions.digest(
        pg_catalog.convert_to(
          'compass:phase7.30:admin-control-intent:v1|'
          || target_canonical_intent,
          'UTF8'
        ),
        'sha256'
      ),
      'hex'
    )
  end;
$$;

revoke all on function private.hash_admin_control_intent_v1(text)
  from public, anon, authenticated, service_role;

create function private.admin_ai_pin_control_intent_digest_v1(
  target_action text,
  target_pin_pepper_version integer,
  target_peppered_pin_hmac text
)
returns text
language sql
immutable
security definer
set search_path = ''
set statement_timeout = '2s'
as $$
  select case
    when target_action not in ('ai_pin_enroll', 'ai_pin_rotate')
      or target_pin_pepper_version is null
      or target_pin_pepper_version < 1
      or target_peppered_pin_hmac is null
      or target_peppered_pin_hmac !~ '^[0-9a-f]{64}$'
      then null
    else private.hash_admin_control_intent_v1(
      'action=' || target_action
      || '|pin_pepper_version=' || target_pin_pepper_version::text
      || '|peppered_pin_hmac=' || target_peppered_pin_hmac
    )
  end;
$$;

revoke all on function private.admin_ai_pin_control_intent_digest_v1(
  text, integer, text
) from public, anon, authenticated, service_role;

create function private.admin_ai_policy_control_intent_digest_v1(
  target_membership_id uuid,
  target_allowed_actions text[],
  target_allowed_models text[],
  target_max_calls_per_lecture integer,
  target_max_calls_per_day integer,
  target_max_input_tokens_per_lecture bigint,
  target_max_input_tokens_per_day bigint,
  target_max_output_tokens_per_lecture bigint,
  target_max_output_tokens_per_day bigint,
  target_max_cost_microusd_per_lecture bigint,
  target_max_cost_microusd_per_day bigint,
  target_max_realtime_minutes_per_lecture integer,
  target_max_realtime_minutes_per_day integer,
  target_max_concurrency integer,
  target_valid_from timestamptz,
  target_valid_until timestamptz
)
returns text
language sql
stable
security definer
set search_path = ''
set statement_timeout = '2s'
as $$
  select case
    when target_membership_id is null
      or target_allowed_actions is null
      or target_allowed_models is null
      or target_max_calls_per_lecture is null
      or target_max_calls_per_day is null
      or target_max_input_tokens_per_lecture is null
      or target_max_input_tokens_per_day is null
      or target_max_output_tokens_per_lecture is null
      or target_max_output_tokens_per_day is null
      or target_max_cost_microusd_per_lecture is null
      or target_max_cost_microusd_per_day is null
      or target_max_realtime_minutes_per_lecture is null
      or target_max_realtime_minutes_per_day is null
      or target_max_concurrency is null
      or target_valid_from is null
      or target_valid_until is null
      then null
    else private.hash_admin_control_intent_v1(
      'action=environment_ai_policy_change'
      || '|target_membership_id=' || target_membership_id::text
      || '|allowed_actions=' || (
        select pg_catalog.string_agg(value, ',' order by value)
        from pg_catalog.unnest(target_allowed_actions) as action(value)
      )
      || '|allowed_models=' || (
        select pg_catalog.string_agg(value, ',' order by value)
        from pg_catalog.unnest(target_allowed_models) as model(value)
      )
      || '|max_calls_per_lecture=' || target_max_calls_per_lecture::text
      || '|max_calls_per_day=' || target_max_calls_per_day::text
      || '|max_input_tokens_per_lecture=' || target_max_input_tokens_per_lecture::text
      || '|max_input_tokens_per_day=' || target_max_input_tokens_per_day::text
      || '|max_output_tokens_per_lecture=' || target_max_output_tokens_per_lecture::text
      || '|max_output_tokens_per_day=' || target_max_output_tokens_per_day::text
      || '|max_cost_microusd_per_lecture=' || target_max_cost_microusd_per_lecture::text
      || '|max_cost_microusd_per_day=' || target_max_cost_microusd_per_day::text
      || '|max_realtime_minutes_per_lecture=' || target_max_realtime_minutes_per_lecture::text
      || '|max_realtime_minutes_per_day=' || target_max_realtime_minutes_per_day::text
      || '|max_concurrency=' || target_max_concurrency::text
      || '|valid_from=' || pg_catalog.to_char(
        target_valid_from at time zone 'UTC',
        'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
      )
      || '|valid_until=' || pg_catalog.to_char(
        target_valid_until at time zone 'UTC',
        'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
      )
    )
  end;
$$;

revoke all on function private.admin_ai_policy_control_intent_digest_v1(
  uuid, text[], text[], integer, integer, bigint, bigint, bigint, bigint,
  bigint, bigint, integer, integer, integer, timestamptz, timestamptz
) from public, anon, authenticated, service_role;

create function private.admin_ai_pin_terminal_control_intent_digest_v1(
  target_action text,
  target_membership_id uuid,
  target_factor_id uuid,
  target_factor_version bigint
)
returns text
language sql
immutable
security definer
set search_path = ''
set statement_timeout = '2s'
as $$
  select case
    when target_action not in ('ai_pin_revoke', 'ai_pin_reset')
      or target_membership_id is null
      or target_factor_id is null
      or target_factor_version is null
      or target_factor_version < 1
      then null
    else private.hash_admin_control_intent_v1(
      'action=' || target_action
      || '|membership_id=' || target_membership_id::text
      || '|factor_id=' || target_factor_id::text
      || '|factor_version=' || target_factor_version::text
    )
  end;
$$;

revoke all on function private.admin_ai_pin_terminal_control_intent_digest_v1(
  text, uuid, uuid, bigint
) from public, anon, authenticated, service_role;

create function private.bind_google_admin_totp_factor_set_v1()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  factor_set_hash text;
  factor_count integer;
  approved_factor_set_hash text;
  approved_factor_count integer;
  approved_factor_set_version bigint;
  approved_factor_set_source text;
  approved_factor_set_request_id uuid;
  nonce_row private.admin_step_up_nonces%rowtype;
begin
  if tg_op = 'UPDATE'
     and old.authentication_method = 'google_totp' then
    if new.authentication_method is distinct from old.authentication_method
       or new.auth_user_id is distinct from old.auth_user_id
       or new.supabase_auth_session_id is distinct from
         old.supabase_auth_session_id
       or new.principal_id is distinct from old.principal_id
       or new.membership_id is distinct from old.membership_id
       or new.environment_id is distinct from old.environment_id
       or new.step_up_nonce_id is distinct from old.step_up_nonce_id
       or new.verified_totp_factor_set_hash
       is distinct from old.verified_totp_factor_set_hash then
      raise exception 'Google Admin identity/factor-set binding is immutable'
        using errcode = '23514';
    end if;
    return new;
  end if;

  if new.authentication_method <> 'google_totp' then
    if new.verified_totp_factor_set_hash is not null then
      raise exception 'legacy Admin session cannot bind a TOTP factor set'
        using errcode = '23514';
    end if;
    return new;
  end if;

  if not exists (
    select 1
    from private.admin_identity_runtime_gate as gate
    where gate.singleton and gate.google_session_issue_enabled
  ) then
    raise exception 'Admin Google identity is disabled' using errcode = 'P7300';
  end if;

  select snapshot.factor_set_hash, snapshot.factor_count
  into factor_set_hash, factor_count
  from private.current_verified_totp_factor_set_snapshot_v1(
    new.auth_user_id
  ) as snapshot;
  if factor_set_hash is null then
    raise exception 'verified TOTP factor set not found' using errcode = 'P7330';
  end if;

  select
    principal.approved_totp_factor_set_hash,
    principal.approved_totp_factor_count,
    principal.approved_totp_factor_set_version,
    principal.approved_totp_factor_set_source,
    principal.approved_totp_factor_set_request_id
  into
    approved_factor_set_hash,
    approved_factor_count,
    approved_factor_set_version,
    approved_factor_set_source,
    approved_factor_set_request_id
  from private.admin_principals as principal
  where principal.id = new.principal_id
    and principal.auth_user_id = new.auth_user_id
    and principal.status = 'active'
  for share;
  if not found or approved_factor_set_hash is null then
    raise exception 'Admin TOTP factor-set adoption is required'
      using errcode = 'P7332';
  end if;
  if factor_set_hash is distinct from approved_factor_set_hash
     or factor_count is distinct from approved_factor_count then
    raise exception 'live TOTP factor set does not match approved authority'
      using errcode = 'P7330';
  end if;
  if new.verified_totp_factor_set_hash is null then
    raise exception 'Google Admin session requires expected TOTP factor set'
      using errcode = 'P7330';
  elsif new.verified_totp_factor_set_hash is distinct from factor_set_hash
        or new.verified_totp_factor_set_hash is distinct from
          approved_factor_set_hash then
    raise exception 'verified TOTP factor set changed during session issue'
      using errcode = 'P7330';
  end if;

  select nonce.*
  into nonce_row
  from private.admin_step_up_nonces as nonce
  where nonce.id = new.step_up_nonce_id
    and nonce.status = 'pending'
    and nonce.intended_action = 'admin_login'
  for share;
  if not found
     or nonce_row.reserved_admin_session_id is distinct from new.id
     or nonce_row.principal_id is distinct from new.principal_id
     or nonce_row.membership_id is distinct from new.membership_id
     or nonce_row.environment_id is distinct from new.environment_id
     or nonce_row.supabase_auth_session_id is distinct from
       new.supabase_auth_session_id
     or nonce_row.verified_totp_factor_set_hash is distinct from
       new.verified_totp_factor_set_hash
     or nonce_row.expires_at <= statement_timestamp()
     or nonce_row.completion_jwt_hash is null
     or nonce_row.completion_jwt_hash = nonce_row.prechallenge_jwt_hash
     or nonce_row.verified_totp_amr_at is null
     or nonce_row.verified_totp_amr_at <
       nonce_row.min_amr_at - interval '1 second'
     or nonce_row.verified_totp_amr_at >
       statement_timestamp() + interval '1 minute'
     or new.step_up_verified_at <
       nonce_row.verified_totp_amr_at - interval '1 second'
     or new.step_up_verified_at > statement_timestamp() + interval '1 minute'
     or not exists (
       select 1
       from auth.mfa_factors as factor
       where factor.id = nonce_row.challenged_totp_factor_id
         and factor.user_id = new.auth_user_id
         and factor.factor_type = 'totp'
         and factor.status = 'verified'
     ) then
    raise exception 'Google Admin session requires bound completed TOTP evidence'
      using errcode = 'P7330';
  end if;

  if nonce_row.factor_set_bootstrap_allowed then
    if nonce_row.approved_totp_factor_set_version <> 0
       or nonce_row.prechallenge_verified_totp_factor_set_hash is not null
       or approved_factor_set_version <> 1
       or approved_factor_set_source <> 'login_bootstrap'
       or approved_factor_set_request_id is distinct from nonce_row.request_id then
      raise exception 'invalid initial TOTP factor-set approval binding'
        using errcode = 'P7330';
    end if;
  elsif nonce_row.approved_totp_factor_set_version < 1
        or nonce_row.approved_totp_factor_set_version <>
          approved_factor_set_version
        or nonce_row.prechallenge_verified_totp_factor_set_hash is distinct from
          approved_factor_set_hash then
    raise exception 'invalid approved TOTP factor-set version binding'
      using errcode = 'P7330';
  end if;
  return new;
end;
$$;

create trigger admin_sessions_google_totp_factor_binding
before insert or update of
  authentication_method,
  auth_user_id,
  supabase_auth_session_id,
  principal_id,
  membership_id,
  environment_id,
  step_up_nonce_id,
  verified_totp_factor_set_hash
on public.admin_sessions
for each row execute function private.bind_google_admin_totp_factor_set_v1();

revoke all on function private.bind_google_admin_totp_factor_set_v1()
  from public, anon, authenticated, service_role;

create function private.drain_admin_ai_on_session_revoke_v1()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  effective_now timestamptz := statement_timestamp();
begin
  if old.revoked_at is not null or new.revoked_at is null then
    return new;
  end if;

  -- Lock order is app session (held by the UPDATE) -> control nonce -> grant ->
  -- assertion challenge -> enrollment nonce. This matches the existing B2
  -- factor-authority drain; factors and remembered credentials survive logout.
  update private.admin_control_step_up_nonces
  set status = 'superseded', updated_at = effective_now
  where admin_session_id = new.id and status = 'pending';

  update private.admin_control_step_up_grants
  set status = 'superseded', updated_at = effective_now
  where admin_session_id = new.id and status = 'available';

  update private.admin_ai_browser_assertion_challenges
  set status = 'superseded', updated_at = effective_now
  where admin_session_id = new.id and status = 'pending';

  update private.admin_ai_browser_enrollment_nonces
  set status = 'superseded', updated_at = effective_now
  where admin_session_id = new.id and status = 'pending';

  return new;
end;
$$;

create trigger admin_sessions_revoke_admin_ai_b22a
after update of revoked_at on public.admin_sessions
for each row execute function private.drain_admin_ai_on_session_revoke_v1();

revoke all on function private.drain_admin_ai_on_session_revoke_v1()
  from public, anon, authenticated, service_role;

-- Existing Google sessions predate the authoritative factor-set binding.
-- Do not infer or backfill a security decision: retain the rows for audit/FK
-- integrity, revoke them with an explicit reason, and require a new login.
with revoked_sessions as (
  update public.admin_sessions as session
  set
    revoked_at = statement_timestamp(),
    revoke_reason = 'totp_factor_set_migration',
    updated_at = statement_timestamp()
  where session.authentication_method = 'google_totp'
    and session.revoked_at is null
  returning session.*
)
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
)
select
  extensions.gen_random_uuid(),
  session.environment_id,
  session.principal_id,
  session.membership_id,
  session.id,
  'admin_session.migration_revoke',
  'admin_session',
  session.id::text,
  'accepted',
  'totp_factor_set_migration',
  jsonb_build_object('factor_set_backfilled', false)
from revoked_sessions as session;

alter table public.admin_sessions
  add constraint admin_sessions_totp_factor_set_binding_check check (
    (
      authentication_method = 'legacy_pin'
      and verified_totp_factor_set_hash is null
    )
    or (
      authentication_method = 'google_totp'
      and (
        revoked_at is not null
        or verified_totp_factor_set_hash is not null
      )
    )
  );

-- Preserve the reviewed B1 implementation for rollback evidence, but remove
-- every callable privilege. The same-signature facade below records the
-- post-challenge JWT/AMR evidence and validates the authoritative factor set.
alter function private.complete_admin_totp_step_up_v1(
  text, uuid, uuid, smallint, text, timestamptz, text, timestamptz,
  text, text, text, uuid
) rename to complete_admin_totp_step_up_pre_b22a_v1;

revoke all on function private.complete_admin_totp_step_up_pre_b22a_v1(
  text, uuid, uuid, smallint, text, timestamptz, text, timestamptz,
  text, text, text, uuid
) from public, anon, authenticated, service_role;

create function private.complete_admin_totp_step_up_v1(
  target_nonce_hash text,
  target_auth_user_id uuid,
  target_supabase_auth_session_id uuid,
  target_aal smallint,
  target_current_jwt_hash text,
  target_current_jwt_iat timestamptz,
  target_totp_amr_method text,
  target_totp_amr_at timestamptz,
  target_token_hash text,
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
  principal_row private.admin_principals%rowtype;
  membership_row private.admin_environment_memberships%rowtype;
  environment_row private.admin_environments%rowtype;
  session_row public.admin_sessions%rowtype;
  nonce_snapshot private.admin_step_up_nonces%rowtype;
  nonce_row private.admin_step_up_nonces%rowtype;
  current_factor_set_hash text;
  current_factor_count integer;
  effective_now timestamptz := statement_timestamp();
begin
  if target_nonce_hash is null
     or target_auth_user_id is null
     or target_supabase_auth_session_id is null
     or target_aal is distinct from 2
     or target_current_jwt_hash is null
     or target_current_jwt_iat is null
     or target_totp_amr_method is null
     or target_totp_amr_method not in ('totp', 'mfa/totp')
     or target_totp_amr_at is null
     or target_token_hash is null
     or target_request_id is null
     or target_nonce_hash !~ '^[0-9a-f]{64}$'
     or target_current_jwt_hash !~ '^[0-9a-f]{64}$'
     or target_token_hash !~ '^[0-9a-f]{64}$'
     or (
       target_network_hash is not null
       and target_network_hash !~ '^[0-9a-f]{64}$'
     )
     or (
       target_user_agent_hash is not null
       and target_user_agent_hash !~ '^[0-9a-f]{64}$'
     ) then
    raise exception 'invalid Admin TOTP completion' using errcode = '22023';
  end if;

  if not exists (
    select 1
    from private.admin_identity_runtime_gate as gate
    where gate.singleton and gate.google_session_issue_enabled
  ) then
    raise exception 'Admin Google identity is disabled' using errcode = 'P7300';
  end if;

  -- Discover immutable IDs without a row lock. B1 begin holds principal then
  -- membership before superseding a pending nonce, so completion must follow
  -- principal -> membership -> environment -> nonce to avoid a begin/complete
  -- cycle. The nonce is fully re-read and revalidated once locked.
  select nonce.*
  into nonce_snapshot
  from private.admin_step_up_nonces as nonce
  where nonce.nonce_hash = target_nonce_hash;
  if not found then
    return null;
  end if;

  select principal.*
  into principal_row
  from private.admin_principals as principal
  where principal.id = nonce_snapshot.principal_id
    and principal.auth_user_id = target_auth_user_id
    and principal.status = 'active'
  for update;
  if not found then
    return null;
  end if;

  select membership.*
  into membership_row
  from private.admin_environment_memberships as membership
  where membership.id = nonce_snapshot.membership_id
    and membership.environment_id = nonce_snapshot.environment_id
    and membership.principal_id = nonce_snapshot.principal_id
    and membership.status in ('pending_mfa', 'active')
    and (membership.expires_at is null or membership.expires_at > effective_now)
  for update;
  if not found then
    return null;
  end if;

  if membership_row.role = 'owner' then
    select environment.*
    into environment_row
    from private.admin_environments as environment
    where environment.id = nonce_snapshot.environment_id
      and environment.current_deployment
      and environment.status = 'active'
    for update;
  else
    select environment.*
    into environment_row
    from private.admin_environments as environment
    where environment.id = nonce_snapshot.environment_id
      and environment.current_deployment
      and environment.status = 'active'
    for share;
  end if;
  if not found then
    return null;
  end if;

  select nonce.*
  into nonce_row
  from private.admin_step_up_nonces as nonce
  where nonce.id = nonce_snapshot.id
    and nonce.nonce_hash = target_nonce_hash
    and nonce.reserved_admin_session_id = nonce_snapshot.reserved_admin_session_id
    and nonce.environment_id = nonce_snapshot.environment_id
    and nonce.principal_id = nonce_snapshot.principal_id
    and nonce.membership_id = nonce_snapshot.membership_id
    and nonce.supabase_auth_session_id = nonce_snapshot.supabase_auth_session_id
    and nonce.intended_action = 'admin_login'
    and nonce.request_id = nonce_snapshot.request_id
    and nonce.prechallenge_jwt_hash = nonce_snapshot.prechallenge_jwt_hash
    and nonce.min_amr_at is not distinct from nonce_snapshot.min_amr_at
    and nonce.challenged_totp_factor_id is not distinct from
      nonce_snapshot.challenged_totp_factor_id
    and nonce.prechallenge_verified_totp_factor_set_hash is not distinct from
      nonce_snapshot.prechallenge_verified_totp_factor_set_hash
    and nonce.verified_totp_factor_set_hash is not distinct from
      nonce_snapshot.verified_totp_factor_set_hash
    and nonce.factor_set_bootstrap_allowed is not distinct from
      nonce_snapshot.factor_set_bootstrap_allowed
    and nonce.approved_totp_factor_set_version is not distinct from
      nonce_snapshot.approved_totp_factor_set_version
    and nonce.issued_at is not distinct from nonce_snapshot.issued_at
    and nonce.expires_at is not distinct from nonce_snapshot.expires_at
  for update;
  if not found then
    return null;
  end if;

  if nonce_row.status not in ('pending', 'consumed')
     or (nonce_row.status = 'consumed' and membership_row.status <> 'active')
     or nonce_row.expires_at <= effective_now
     or nonce_row.supabase_auth_session_id <> target_supabase_auth_session_id
     or nonce_row.prechallenge_jwt_hash = target_current_jwt_hash
     or target_current_jwt_iat < nonce_row.min_amr_at - interval '1 second'
     or target_totp_amr_at < nonce_row.min_amr_at - interval '1 second'
     or target_totp_amr_at > effective_now + interval '1 minute' then
    return null;
  end if;

  select snapshot.factor_set_hash, snapshot.factor_count
  into current_factor_set_hash, current_factor_count
  from private.current_verified_totp_factor_set_snapshot_v1(
    target_auth_user_id
  ) as snapshot;
  if current_factor_set_hash is null
     or current_factor_set_hash is distinct from
       nonce_row.verified_totp_factor_set_hash
     or not exists (
       select 1
       from auth.mfa_factors as factor
       where factor.id = nonce_row.challenged_totp_factor_id
         and factor.user_id = target_auth_user_id
         and factor.factor_type = 'totp'
         and factor.status = 'verified'
     ) then
    return null;
  end if;

  if nonce_row.status = 'consumed' then
    if nonce_row.factor_set_bootstrap_allowed then
      if principal_row.approved_totp_factor_set_hash is distinct from
           current_factor_set_hash
         or principal_row.approved_totp_factor_set_version <> 1
         or principal_row.approved_totp_factor_count <> current_factor_count
         or principal_row.approved_totp_factor_set_source <>
           'login_bootstrap'
         or principal_row.approved_totp_factor_set_request_id is distinct from
           nonce_row.request_id then
        return null;
      end if;
    elsif principal_row.approved_totp_factor_set_hash is distinct from
          current_factor_set_hash
          or principal_row.approved_totp_factor_set_version <>
            nonce_row.approved_totp_factor_set_version
          or principal_row.approved_totp_factor_count <> current_factor_count then
      return null;
    end if;
  elsif nonce_row.factor_set_bootstrap_allowed then
    if principal_row.approved_totp_factor_set_hash is not null
       or principal_row.approved_totp_factor_set_version <> 0
       or principal_row.approved_totp_factor_count <> 0
       or membership_row.status <> 'pending_mfa'
       or nonce_row.prechallenge_verified_totp_factor_set_hash is not null
       or nonce_row.approved_totp_factor_set_version <> 0
       or current_factor_count <> 1 then
      return null;
    end if;
  elsif principal_row.approved_totp_factor_set_hash is null then
    raise exception 'Admin TOTP factor-set adoption is required'
      using errcode = 'P7332';
  elsif principal_row.approved_totp_factor_set_hash is distinct from
        current_factor_set_hash
        or principal_row.approved_totp_factor_set_version <>
          nonce_row.approved_totp_factor_set_version
        or principal_row.approved_totp_factor_count <> current_factor_count then
    return null;
  end if;

  if nonce_row.status = 'consumed' then
    select session.*
    into session_row
    from public.admin_sessions as session
    where session.id = nonce_row.completed_admin_session_id
      and session.authentication_method = 'google_totp'
      and session.token_hash = target_token_hash
      and session.auth_user_id = target_auth_user_id
      and session.supabase_auth_session_id = target_supabase_auth_session_id
      and session.step_up_nonce_id = nonce_row.id
      and session.principal_id = nonce_row.principal_id
      and session.membership_id = nonce_row.membership_id
      and session.environment_id = nonce_row.environment_id
      and session.aal = 2
      and session.revoked_at is null
      and session.expires_at > effective_now
      and session.idle_expires_at > effective_now
    for update;
    if not found then
      return null;
    end if;

    if session_row.verified_totp_factor_set_hash is distinct from
       current_factor_set_hash then
      update public.admin_sessions
      set
        revoked_at = effective_now,
        revoke_reason = 'totp_factor_set_changed',
        updated_at = effective_now
      where id = session_row.id and revoked_at is null;
      return null;
    end if;

    update private.admin_step_up_nonces
    set
      completion_jwt_hash = coalesce(completion_jwt_hash, target_current_jwt_hash),
      verified_totp_amr_at = coalesce(verified_totp_amr_at, target_totp_amr_at),
      verified_totp_factor_set_hash = coalesce(
        verified_totp_factor_set_hash,
        current_factor_set_hash
      ),
      updated_at = effective_now
    where id = nonce_row.id
      and status = 'consumed'
      and completed_admin_session_id = session_row.id
      and (
        completion_jwt_hash is null
        or (
          completion_jwt_hash = target_current_jwt_hash
          and verified_totp_amr_at is not distinct from target_totp_amr_at
          and verified_totp_factor_set_hash = current_factor_set_hash
        )
      )
    returning * into nonce_row;

    if nonce_row.id is null
       or nonce_row.prechallenge_jwt_hash = nonce_row.completion_jwt_hash
       or nonce_row.verified_totp_amr_at < nonce_row.min_amr_at - interval '1 second'
       or nonce_row.verified_totp_amr_at > effective_now + interval '1 minute' then
      update public.admin_sessions
      set
        revoked_at = effective_now,
        revoke_reason = 'invalid_step_up_evidence',
        updated_at = effective_now
      where id = session_row.id and revoked_at is null;
      return null;
    end if;

    return jsonb_build_object(
      'can_use_ai', membership_row.can_use_ai,
      'environment_id', session_row.environment_id,
      'expires_at', session_row.expires_at,
      'id', session_row.id,
      'idle_expires_at', session_row.idle_expires_at,
      'membership_id', session_row.membership_id,
      'principal_id', session_row.principal_id,
      'role', membership_row.role,
      'step_up_verified_at', session_row.step_up_verified_at,
      'verified_totp_factor_set_hash', current_factor_set_hash
    );
  end if;

  -- Record the verified post-challenge evidence while the nonce is still
  -- pending. The session INSERT trigger requires these fields, so direct table
  -- INSERT cannot skip this completion function. Any later exception rolls the
  -- evidence, bootstrap approval and session issue back together.
  update private.admin_step_up_nonces
  set
    completion_jwt_hash = target_current_jwt_hash,
    verified_totp_amr_at = target_totp_amr_at,
    verified_totp_factor_set_hash = current_factor_set_hash,
    updated_at = effective_now
  where id = nonce_row.id
    and status = 'pending'
    and completion_jwt_hash is null
    and verified_totp_amr_at is null
  returning * into nonce_row;
  if not found then
    raise exception 'Admin TOTP completion evidence was already written'
      using errcode = 'P7330';
  end if;

  if nonce_row.factor_set_bootstrap_allowed then
    update private.admin_principals
    set
      approved_totp_factor_set_hash = current_factor_set_hash,
      approved_totp_factor_set_version = 1,
      approved_totp_factor_count = 1,
      approved_totp_factor_set_at = effective_now,
      approved_totp_factor_set_request_id = nonce_row.request_id,
      approved_totp_factor_set_source = 'login_bootstrap',
      approved_totp_factor_set_actor = 'system:admin_login',
      approved_totp_factor_set_reason = 'first_totp_enrollment'
    where id = principal_row.id
      and approved_totp_factor_set_hash is null
      and approved_totp_factor_set_version = 0
      and approved_totp_factor_count = 0
    returning * into principal_row;
    if not found then
      raise exception 'Admin TOTP factor-set bootstrap lost serialization'
        using errcode = 'P7332';
    end if;

    insert into private.admin_audit_events (
      request_id,
      environment_id,
      actor_principal_id,
      actor_membership_id,
      action,
      target_type,
      target_id,
      result,
      reason_code,
      metadata
    ) values (
      nonce_row.request_id,
      environment_row.id,
      principal_row.id,
      membership_row.id,
      'admin_totp_factor_set.bootstrap',
      'admin_principal',
      principal_row.id::text,
      'accepted',
      'first_totp_enrollment',
      jsonb_build_object(
        'approved_factor_count', 1,
        'approved_factor_set_hash', current_factor_set_hash,
        'approved_factor_set_version', 1,
        'source', 'login_bootstrap'
      )
    );
  end if;

  if membership_row.status = 'pending_mfa' then
    update private.admin_environment_memberships
    set
      status = 'active',
      activated_at = effective_now,
      updated_at = effective_now
    where id = membership_row.id
    returning * into membership_row;
  end if;

  if membership_row.role = 'owner'
     and environment_row.owner_invariant_enforced_at is null then
    update private.admin_environments
    set
      owner_invariant_enforced_at = effective_now,
      updated_at = effective_now
    where id = environment_row.id
    returning * into environment_row;
  end if;

  insert into public.admin_sessions (
    id,
    token_hash,
    auth_user_id,
    pin_version_hash,
    authentication_method,
    aal,
    principal_id,
    membership_id,
    environment_id,
    supabase_auth_session_id,
    step_up_verified_at,
    step_up_nonce_id,
    network_hash,
    user_agent_hash,
    verified_totp_factor_set_hash,
    issued_at,
    last_seen_at,
    idle_expires_at,
    expires_at
  ) values (
    nonce_row.reserved_admin_session_id,
    target_token_hash,
    target_auth_user_id,
    null,
    'google_totp',
    2,
    principal_row.id,
    membership_row.id,
    environment_row.id,
    target_supabase_auth_session_id,
    effective_now,
    nonce_row.id,
    target_network_hash,
    target_user_agent_hash,
    nonce_row.verified_totp_factor_set_hash,
    effective_now,
    effective_now,
    effective_now + interval '8 hours',
    effective_now + interval '8 hours'
  ) returning * into session_row;

  if session_row.verified_totp_factor_set_hash is distinct from
     nonce_row.verified_totp_factor_set_hash then
    raise exception 'Admin session factor-set binding changed during issue'
      using errcode = 'P7330';
  end if;

  update private.admin_step_up_nonces
  set
    status = 'consumed',
    consumed_at = effective_now,
    completed_admin_session_id = session_row.id,
    completion_jwt_hash = target_current_jwt_hash,
    verified_totp_amr_at = target_totp_amr_at,
    verified_totp_factor_set_hash = nonce_row.verified_totp_factor_set_hash,
    updated_at = effective_now
  where id = nonce_row.id
  returning * into nonce_row;

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
    environment_row.id,
    principal_row.id,
    membership_row.id,
    session_row.id,
    'admin_step_up.complete',
    'admin_session',
    session_row.id::text,
    'accepted',
    jsonb_build_object(
      'aal', 2,
      'approved_factor_set_version',
        principal_row.approved_totp_factor_set_version,
      'factor_set_bound', true,
      'method', 'totp'
    )
  );

  return jsonb_build_object(
    'can_use_ai', membership_row.can_use_ai,
    'environment_id', environment_row.id,
    'expires_at', session_row.expires_at,
    'id', session_row.id,
    'idle_expires_at', session_row.idle_expires_at,
    'membership_id', membership_row.id,
    'principal_id', principal_row.id,
    'role', membership_row.role,
    'step_up_verified_at', session_row.step_up_verified_at,
    'verified_totp_factor_set_hash', current_factor_set_hash
  );
end;
$$;

revoke all on function private.complete_admin_totp_step_up_v1(
  text, uuid, uuid, smallint, text, timestamptz, text, timestamptz,
  text, text, text, uuid
) from public, anon, authenticated, service_role;

alter function private.require_admin_ai_context_v1(
  text, uuid, uuid, timestamptz, boolean, boolean
) rename to require_admin_ai_context_pre_b22a_v1;

revoke all on function private.require_admin_ai_context_pre_b22a_v1(
  text, uuid, uuid, timestamptz, boolean, boolean
) from public, anon, authenticated, service_role;

create function private.require_admin_ai_context_v1(
  target_token_hash text,
  target_auth_user_id uuid,
  target_supabase_auth_session_id uuid,
  target_min_step_up_verified_at timestamptz default null,
  target_require_ai boolean default true,
  target_require_owner boolean default false
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
  context_value jsonb;
  session_row public.admin_sessions%rowtype;
  current_factor_set_hash text;
  approved_factor_set_hash text;
  effective_now timestamptz := statement_timestamp();
begin
  context_value := private.require_admin_ai_context_pre_b22a_v1(
    target_token_hash,
    target_auth_user_id,
    target_supabase_auth_session_id,
    target_min_step_up_verified_at,
    target_require_ai,
    target_require_owner
  );

  if context_value is null then
    return null;
  end if;

  select session.*
  into session_row
  from public.admin_sessions as session
  where session.id = (context_value ->> 'admin_session_id')::uuid
    and session.authentication_method = 'google_totp'
    and session.auth_user_id = target_auth_user_id
    and session.supabase_auth_session_id = target_supabase_auth_session_id
  for update;

  if not found or session_row.revoked_at is not null then
    return null;
  end if;

  current_factor_set_hash := private.current_verified_totp_factor_set_hash_v1(
    target_auth_user_id
  );
  select principal.approved_totp_factor_set_hash
  into approved_factor_set_hash
  from private.admin_principals as principal
  where principal.id = session_row.principal_id
    and principal.auth_user_id = target_auth_user_id
    and principal.status = 'active';
  if current_factor_set_hash is null
     or current_factor_set_hash is distinct from
       session_row.verified_totp_factor_set_hash
     or approved_factor_set_hash is null
     or approved_factor_set_hash is distinct from current_factor_set_hash then
    update public.admin_sessions
    set
      revoked_at = effective_now,
      revoke_reason = 'totp_factor_set_changed',
      updated_at = effective_now
    where id = session_row.id and revoked_at is null;

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
      extensions.gen_random_uuid(),
      session_row.environment_id,
      session_row.principal_id,
      session_row.membership_id,
      session_row.id,
      'admin_session.factor_set_revoke',
      'admin_session',
      session_row.id::text,
      'accepted',
      'totp_factor_set_changed',
      jsonb_build_object('authority_drained', true)
    );
    return null;
  end if;

  return context_value || jsonb_build_object(
    'verified_totp_factor_set_hash', current_factor_set_hash
  );
end;
$$;

revoke all on function private.require_admin_ai_context_v1(
  text, uuid, uuid, timestamptz, boolean, boolean
) from public, anon, authenticated, service_role;

alter function private.verify_and_touch_google_admin_session_v1(
  text, uuid, uuid
) rename to verify_and_touch_google_admin_session_pre_b22a_v1;

revoke all on function private.verify_and_touch_google_admin_session_pre_b22a_v1(
  text, uuid, uuid
) from public, anon, authenticated, service_role;

create function private.verify_and_touch_google_admin_session_v1(
  target_token_hash text,
  target_auth_user_id uuid,
  target_supabase_auth_session_id uuid
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
  result_value jsonb;
  session_row public.admin_sessions%rowtype;
  current_factor_set_hash text;
  approved_factor_set_hash text;
  effective_now timestamptz := statement_timestamp();
begin
  result_value := private.verify_and_touch_google_admin_session_pre_b22a_v1(
    target_token_hash,
    target_auth_user_id,
    target_supabase_auth_session_id
  );
  if result_value is null then
    return null;
  end if;

  select session.*
  into session_row
  from public.admin_sessions as session
  where session.id = (result_value ->> 'id')::uuid
    and session.token_hash = target_token_hash
    and session.auth_user_id = target_auth_user_id
    and session.supabase_auth_session_id = target_supabase_auth_session_id
  for update;

  if not found or session_row.revoked_at is not null then
    return null;
  end if;

  current_factor_set_hash := private.current_verified_totp_factor_set_hash_v1(
    target_auth_user_id
  );
  select principal.approved_totp_factor_set_hash
  into approved_factor_set_hash
  from private.admin_principals as principal
  where principal.id = session_row.principal_id
    and principal.auth_user_id = target_auth_user_id
    and principal.status = 'active';
  if current_factor_set_hash is null
     or current_factor_set_hash is distinct from
       session_row.verified_totp_factor_set_hash
     or approved_factor_set_hash is null
     or approved_factor_set_hash is distinct from current_factor_set_hash then
    update public.admin_sessions
    set
      revoked_at = effective_now,
      revoke_reason = 'totp_factor_set_changed',
      updated_at = effective_now
    where id = session_row.id and revoked_at is null;
    return null;
  end if;

  return result_value || jsonb_build_object(
    'verified_totp_factor_set_hash', current_factor_set_hash
  );
end;
$$;

revoke all on function private.verify_and_touch_google_admin_session_v1(
  text, uuid, uuid
) from public, anon, authenticated, service_role;

-- Called by the trusted identity Edge path after a successful TOTP factor
-- enroll/unenroll operation. UUID ordering avoids cross-session deadlocks.
create function private.reconcile_admin_totp_factor_set_v1(
  target_auth_user_id uuid,
  target_request_id uuid
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
  current_factor_set_hash text;
  approved_factor_set_hash text;
  candidate record;
  revoked_count integer := 0;
  effective_now timestamptz := statement_timestamp();
begin
  if target_auth_user_id is null or target_request_id is null then
    raise exception 'invalid Admin TOTP reconciliation' using errcode = '22023';
  end if;

  perform private.serialize_admin_ai_scope_v1(
    'totp-factor-set-user',
    target_auth_user_id
  );

  select principal.*
  into principal_row
  from private.admin_principals as principal
  where principal.auth_user_id = target_auth_user_id
    and principal.status = 'active'
  for update;
  if not found then
    return null;
  end if;

  current_factor_set_hash := private.current_verified_totp_factor_set_hash_v1(
    target_auth_user_id
  );
  approved_factor_set_hash := principal_row.approved_totp_factor_set_hash;

  for candidate in
    select session.id
    from public.admin_sessions as session
    where session.authentication_method = 'google_totp'
      and session.auth_user_id = target_auth_user_id
      and session.revoked_at is null
      and (
        approved_factor_set_hash is null
        or current_factor_set_hash is distinct from approved_factor_set_hash
        or session.verified_totp_factor_set_hash is distinct from
          approved_factor_set_hash
      )
    order by session.id
  loop
    perform 1
    from public.admin_sessions as session
    where session.id = candidate.id and session.revoked_at is null
    for update;

    if found then
      update public.admin_sessions
      set
        revoked_at = effective_now,
        revoke_reason = 'totp_factor_set_changed',
        updated_at = effective_now
      where id = candidate.id and revoked_at is null;
      if found then
        revoked_count := revoked_count + 1;
      end if;
    end if;
  end loop;

  if revoked_count > 0 then
    insert into private.admin_audit_events (
      request_id,
      actor_principal_id,
      action,
      target_type,
      target_id,
      result,
      reason_code,
      metadata
    ) values (
      target_request_id,
      principal_row.id,
      'admin_session.factor_set_reconcile',
      'auth_user',
      target_auth_user_id::text,
      'accepted',
      'totp_factor_set_changed',
      jsonb_build_object(
        'active_factor_set_present', current_factor_set_hash is not null,
        'approved_factor_set_present', approved_factor_set_hash is not null,
        'revoked_sessions', revoked_count
      )
    );
  end if;

  return jsonb_build_object(
    'active_factor_set_present', current_factor_set_hash is not null,
    'approved_factor_set_present', approved_factor_set_hash is not null,
    'revoked_sessions', revoked_count
  );
end;
$$;

revoke all on function private.reconcile_admin_totp_factor_set_v1(uuid, uuid)
  from public, anon, authenticated, service_role;

-- Human/operator recovery only. This function is intentionally absent from
-- the Edge action allowlist and cannot replace an existing approval. It adopts
-- only an exact, DB-recomputed live set after a separate default-OFF gate is
-- deliberately enabled.
create function private.adopt_existing_admin_totp_factor_set_v1(
  target_environment_id uuid,
  target_principal_id uuid,
  target_membership_id uuid,
  target_auth_user_id uuid,
  target_expected_factor_set_hash text,
  target_expected_factor_count integer,
  target_request_id uuid,
  target_operator_actor text,
  target_reason text
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
  current_factor_set_hash text;
  current_factor_count integer;
  candidate record;
  effective_now timestamptz := statement_timestamp();
begin
  if target_environment_id is null
     or target_principal_id is null
     or target_membership_id is null
     or target_auth_user_id is null
     or target_expected_factor_set_hash is null
     or target_expected_factor_set_hash !~ '^[0-9a-f]{64}$'
     or target_expected_factor_count is null
     or target_expected_factor_count < 1
     or target_request_id is null
     or target_operator_actor is null
     or target_operator_actor <> btrim(target_operator_actor)
     or char_length(target_operator_actor) not between 3 and 160
     or target_reason is null
     or target_reason <> btrim(target_reason)
     or char_length(target_reason) not between 3 and 500 then
    raise exception 'invalid Admin TOTP factor-set adoption'
      using errcode = '22023';
  end if;

  perform private.serialize_admin_ai_scope_v1(
    'totp-factor-set-adoption-request',
    target_request_id
  );

  -- Principal is the global serialization anchor for begin, complete and
  -- operator adoption. Membership then environment preserves canonical order.
  select principal.*
  into principal_row
  from private.admin_principals as principal
  where principal.id = target_principal_id
    and principal.auth_user_id = target_auth_user_id
    and principal.status = 'active'
  for update;
  if not found then
    return null;
  end if;

  select membership.*
  into membership_row
  from private.admin_environment_memberships as membership
  where membership.id = target_membership_id
    and membership.environment_id = target_environment_id
    and membership.principal_id = principal_row.id
  for update;
  if not found then
    return null;
  end if;

  if principal_row.approved_totp_factor_set_hash is not null then
    if principal_row.approved_totp_factor_set_request_id = target_request_id
       and principal_row.approved_totp_factor_set_hash =
         target_expected_factor_set_hash
       and principal_row.approved_totp_factor_count =
         target_expected_factor_count
       and principal_row.approved_totp_factor_set_source = 'operator_adoption'
       and principal_row.approved_totp_factor_set_actor = target_operator_actor
       and principal_row.approved_totp_factor_set_reason = target_reason
       and exists (
         select 1
         from private.admin_audit_events as event
         where event.request_id = target_request_id
           and event.environment_id = target_environment_id
           and event.actor_principal_id = principal_row.id
           and event.actor_membership_id = membership_row.id
           and event.action = 'admin_totp_factor_set.operator_adopt'
           and event.result = 'accepted'
       ) then
      return jsonb_build_object(
        'approved_factor_count', principal_row.approved_totp_factor_count,
        'approved_factor_set_hash',
          principal_row.approved_totp_factor_set_hash,
        'approved_factor_set_version',
          principal_row.approved_totp_factor_set_version,
        'replayed', true
      );
    end if;
    return null;
  end if;

  if exists (
    select 1
    from private.admin_principals as other_principal
    where other_principal.approved_totp_factor_set_request_id = target_request_id
      and other_principal.id <> principal_row.id
  ) then
    return null;
  end if;

  if membership_row.status not in ('pending_mfa', 'active')
     or (
       membership_row.expires_at is not null
       and membership_row.expires_at <= effective_now
     ) then
    return null;
  end if;

  if not exists (
    select 1
    from private.admin_identity_runtime_gate as gate
    where gate.singleton
      and gate.operator_totp_factor_set_adoption_enabled
      and not gate.google_session_issue_enabled
  ) then
    raise exception 'Admin TOTP factor-set operator adoption is disabled'
      using errcode = 'P7300';
  end if;

  perform 1
  from private.admin_environments as environment
  where environment.id = target_environment_id
    and environment.current_deployment
    and environment.status = 'active'
  for share;
  if not found then
    return null;
  end if;

  select snapshot.factor_set_hash, snapshot.factor_count
  into current_factor_set_hash, current_factor_count
  from private.current_verified_totp_factor_set_snapshot_v1(
    target_auth_user_id
  ) as snapshot;
  if current_factor_set_hash is null
     or current_factor_set_hash is distinct from
       target_expected_factor_set_hash
     or current_factor_count <> target_expected_factor_count then
    return null;
  end if;

  update private.admin_principals
  set
    approved_totp_factor_set_hash = current_factor_set_hash,
    approved_totp_factor_set_version = 1,
    approved_totp_factor_count = current_factor_count,
    approved_totp_factor_set_at = effective_now,
    approved_totp_factor_set_request_id = target_request_id,
    approved_totp_factor_set_source = 'operator_adoption',
    approved_totp_factor_set_actor = target_operator_actor,
    approved_totp_factor_set_reason = target_reason
  where id = principal_row.id
    and approved_totp_factor_set_hash is null
    and approved_totp_factor_set_version = 0
    and approved_totp_factor_count = 0
  returning * into principal_row;
  if not found then
    return null;
  end if;

  -- Adoption invalidates pre-adoption proof and sessions. Preserve factor,
  -- PIN/policy and remembered-browser rows; the operator must start a new login.
  for candidate in
    select nonce.id
    from private.admin_step_up_nonces as nonce
    where nonce.principal_id = principal_row.id
      and nonce.intended_action = 'admin_login'
      and nonce.status = 'pending'
    order by nonce.id
    for update
  loop
    update private.admin_step_up_nonces
    set status = 'superseded', updated_at = effective_now
    where id = candidate.id and status = 'pending';
  end loop;

  for candidate in
    select session.id
    from public.admin_sessions as session
    where session.principal_id = principal_row.id
      and session.authentication_method = 'google_totp'
      and session.revoked_at is null
    order by session.id
    for update
  loop
    update public.admin_sessions
    set
      revoked_at = effective_now,
      revoke_reason = 'totp_factor_set_operator_adoption',
      updated_at = effective_now
    where id = candidate.id and revoked_at is null;
  end loop;

  insert into private.admin_audit_events (
    request_id,
    environment_id,
    actor_principal_id,
    actor_membership_id,
    action,
    target_type,
    target_id,
    result,
    reason_code,
    metadata
  ) values (
    target_request_id,
    target_environment_id,
    principal_row.id,
    membership_row.id,
    'admin_totp_factor_set.operator_adopt',
    'admin_principal',
    principal_row.id::text,
    'accepted',
    'operator_adoption',
    jsonb_build_object(
      'approved_factor_count', current_factor_count,
      'approved_factor_set_hash', current_factor_set_hash,
      'approved_factor_set_version', 1,
      'operator_actor', target_operator_actor,
      'reason', target_reason,
      'source', 'operator_adoption'
    )
  );

  return jsonb_build_object(
    'approved_factor_count', current_factor_count,
    'approved_factor_set_hash', current_factor_set_hash,
    'approved_factor_set_version', 1,
    'replayed', false
  );
end;
$$;

revoke all on function private.adopt_existing_admin_totp_factor_set_v1(
  uuid, uuid, uuid, uuid, text, integer, uuid, text, text
) from public, anon, authenticated, service_role;

create function private.begin_admin_control_step_up_v1(
  target_token_hash text,
  target_auth_user_id uuid,
  target_supabase_auth_session_id uuid,
  target_action text,
  target_mutation_request_id uuid,
  target_nonce_hash text,
  target_prechallenge_jwt_hash text,
  target_intent_digest text default null
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
  context_value jsonb;
  active_factor private.admin_ai_unlock_factors%rowtype;
  existing_nonce private.admin_control_step_up_nonces%rowtype;
  nonce_row private.admin_control_step_up_nonces%rowtype;
  effective_intent_digest text;
  effective_now timestamptz := statement_timestamp();
begin
  if target_action is null
     or target_action not in (
       'ai_pin_enroll',
       'ai_pin_rotate',
       'ai_pin_revoke',
       'ai_pin_reset',
       'environment_ai_policy_change'
     )
     or (
       target_intent_digest is not null
       and target_intent_digest !~ '^[0-9a-f]{64}$'
     )
     or (
       target_action not in ('ai_pin_revoke', 'ai_pin_reset')
       and target_intent_digest is null
     )
     or target_mutation_request_id is null
     or target_nonce_hash is null
     or target_nonce_hash !~ '^[0-9a-f]{64}$'
     or target_prechallenge_jwt_hash is null
     or target_prechallenge_jwt_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid Admin control step-up start' using errcode = '22023';
  end if;

  if not exists (
       select 1
       from private.admin_identity_runtime_gate as gate
       where gate.singleton and gate.google_session_issue_enabled
     )
     or not exists (
       select 1
       from private.admin_ai_unlock_runtime_gate as gate
       where gate.singleton and gate.ai_unlock_enabled
     ) then
    raise exception 'Admin control step-up is disabled' using errcode = 'P7331';
  end if;

  perform private.serialize_admin_ai_request_v1(target_mutation_request_id);

  context_value := private.require_admin_ai_context_v1(
    target_token_hash,
    target_auth_user_id,
    target_supabase_auth_session_id,
    null,
    target_action <> 'environment_ai_policy_change',
    target_action = 'environment_ai_policy_change'
  );
  if context_value is null then
    return null;
  end if;

  effective_intent_digest := target_intent_digest;
  if target_action in ('ai_pin_revoke', 'ai_pin_reset') then
    perform private.serialize_admin_ai_scope_v1(
      'factor-membership',
      (context_value ->> 'membership_id')::uuid
    );
    select factor.*
    into active_factor
    from private.admin_ai_unlock_factors as factor
    where factor.environment_id = (context_value ->> 'environment_id')::uuid
      and factor.membership_id = (context_value ->> 'membership_id')::uuid
      and factor.status = 'active'
    for key share;
    if not found then
      return null;
    end if;
    effective_intent_digest :=
      private.admin_ai_pin_terminal_control_intent_digest_v1(
        target_action,
        active_factor.membership_id,
        active_factor.id,
        active_factor.factor_version
      );
    if target_intent_digest is not null
       and target_intent_digest <> effective_intent_digest then
      return null;
    end if;
  end if;

  select nonce.*
  into existing_nonce
  from private.admin_control_step_up_nonces as nonce
  where nonce.mutation_request_id = target_mutation_request_id
  for update;

  if found then
    if existing_nonce.environment_id = (context_value ->> 'environment_id')::uuid
       and existing_nonce.principal_id = (context_value ->> 'principal_id')::uuid
       and existing_nonce.membership_id = (context_value ->> 'membership_id')::uuid
       and existing_nonce.admin_session_id = (context_value ->> 'admin_session_id')::uuid
       and existing_nonce.supabase_auth_session_id = target_supabase_auth_session_id
       and existing_nonce.verified_totp_factor_set_hash =
         context_value ->> 'verified_totp_factor_set_hash'
       and existing_nonce.intended_action = target_action
       and existing_nonce.intent_digest = effective_intent_digest
       and existing_nonce.nonce_hash = target_nonce_hash
       and existing_nonce.prechallenge_jwt_hash = target_prechallenge_jwt_hash then
      if existing_nonce.status = 'pending'
         and existing_nonce.expires_at <= effective_now then
        update private.admin_control_step_up_nonces
        set status = 'expired', updated_at = effective_now
        where id = existing_nonce.id and status = 'pending'
        returning * into existing_nonce;
      end if;
      return jsonb_build_object(
        'action', existing_nonce.intended_action,
        'expires_at', existing_nonce.expires_at,
        'intent_digest', existing_nonce.intent_digest,
        'min_amr_at', existing_nonce.min_amr_at,
        'nonce_id', existing_nonce.id,
        'request_id', existing_nonce.mutation_request_id,
        'status', existing_nonce.status
      );
    end if;
    return null;
  end if;

  if (
    select count(*) >= 10
    from private.admin_control_step_up_nonces as nonce
    where nonce.principal_id = (context_value ->> 'principal_id')::uuid
      and nonce.admin_session_id = (context_value ->> 'admin_session_id')::uuid
      and nonce.intended_action = target_action
      and nonce.issued_at >= effective_now - interval '5 minutes'
  ) then
    raise exception 'Admin control step-up rate exceeded'
      using errcode = 'P7301';
  end if;

  update private.admin_control_step_up_nonces
  set status = 'superseded', updated_at = effective_now
  where admin_session_id = (context_value ->> 'admin_session_id')::uuid
    and intended_action = target_action
    and status = 'pending';

  insert into private.admin_control_step_up_nonces (
    nonce_hash,
    environment_id,
    principal_id,
    membership_id,
    admin_session_id,
    supabase_auth_session_id,
    verified_totp_factor_set_hash,
    intended_action,
    intent_digest,
    mutation_request_id,
    prechallenge_jwt_hash,
    min_amr_at,
    issued_at,
    expires_at
  ) values (
    target_nonce_hash,
    (context_value ->> 'environment_id')::uuid,
    (context_value ->> 'principal_id')::uuid,
    (context_value ->> 'membership_id')::uuid,
    (context_value ->> 'admin_session_id')::uuid,
    target_supabase_auth_session_id,
    context_value ->> 'verified_totp_factor_set_hash',
    target_action,
    effective_intent_digest,
    target_mutation_request_id,
    target_prechallenge_jwt_hash,
    effective_now,
    effective_now,
    effective_now + interval '5 minutes'
  ) returning * into nonce_row;

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
    target_mutation_request_id,
    nonce_row.environment_id,
    nonce_row.principal_id,
    nonce_row.membership_id,
    nonce_row.admin_session_id,
    'admin_control_step_up.begin',
    'admin_control_step_up_nonce',
    nonce_row.id::text,
    'accepted',
    jsonb_build_object('intended_action', nonce_row.intended_action)
  );

  return jsonb_build_object(
    'action', nonce_row.intended_action,
    'expires_at', nonce_row.expires_at,
    'intent_digest', nonce_row.intent_digest,
    'min_amr_at', nonce_row.min_amr_at,
    'nonce_id', nonce_row.id,
    'request_id', nonce_row.mutation_request_id,
    'status', nonce_row.status
  );
end;
$$;

revoke all on function private.begin_admin_control_step_up_v1(
  text, uuid, uuid, text, uuid, text, text, text
) from public, anon, authenticated, service_role;

create function private.complete_admin_control_step_up_v1(
  target_token_hash text,
  target_auth_user_id uuid,
  target_supabase_auth_session_id uuid,
  target_action text,
  target_intent_digest text,
  target_mutation_request_id uuid,
  target_nonce_hash text,
  target_current_jwt_hash text,
  target_current_jwt_iat timestamptz,
  target_totp_amr_method text,
  target_totp_amr_at timestamptz
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
  context_value jsonb;
  nonce_snapshot private.admin_control_step_up_nonces%rowtype;
  nonce_row private.admin_control_step_up_nonces%rowtype;
  grant_row private.admin_control_step_up_grants%rowtype;
  session_row public.admin_sessions%rowtype;
  grant_expires_at timestamptz;
  effective_now timestamptz := statement_timestamp();
begin
  if target_action is null
     or target_action not in (
       'ai_pin_enroll',
       'ai_pin_rotate',
       'ai_pin_revoke',
       'ai_pin_reset',
       'environment_ai_policy_change'
     )
     or target_intent_digest is null
     or target_intent_digest !~ '^[0-9a-f]{64}$'
     or target_mutation_request_id is null
     or target_nonce_hash is null
     or target_nonce_hash !~ '^[0-9a-f]{64}$'
     or target_current_jwt_hash is null
     or target_current_jwt_hash !~ '^[0-9a-f]{64}$'
     or target_current_jwt_iat is null
     or target_totp_amr_method is null
     or target_totp_amr_method not in ('totp', 'mfa/totp')
     or target_totp_amr_at is null then
    raise exception 'invalid Admin control step-up completion'
      using errcode = '22023';
  end if;

  if not exists (
       select 1
       from private.admin_identity_runtime_gate as gate
       where gate.singleton and gate.google_session_issue_enabled
     )
     or not exists (
       select 1
       from private.admin_ai_unlock_runtime_gate as gate
       where gate.singleton and gate.ai_unlock_enabled
     ) then
    raise exception 'Admin control step-up is disabled' using errcode = 'P7331';
  end if;

  perform private.serialize_admin_ai_request_v1(target_mutation_request_id);

  -- Discover immutable bindings before taking identity/session locks. The
  -- nonce itself is locked only after the established principal -> membership
  -- -> session chain.
  select nonce.*
  into nonce_snapshot
  from private.admin_control_step_up_nonces as nonce
  where nonce.nonce_hash = target_nonce_hash
    and nonce.mutation_request_id = target_mutation_request_id;
  if not found
     or nonce_snapshot.intended_action <> target_action
     or nonce_snapshot.intent_digest <> target_intent_digest then
    return null;
  end if;

  context_value := private.require_admin_ai_context_v1(
    target_token_hash,
    target_auth_user_id,
    target_supabase_auth_session_id,
    null,
    target_action <> 'environment_ai_policy_change',
    target_action = 'environment_ai_policy_change'
  );
  if context_value is null then
    return null;
  end if;

  select nonce.*
  into nonce_row
  from private.admin_control_step_up_nonces as nonce
  where nonce.id = nonce_snapshot.id
    and nonce.nonce_hash = target_nonce_hash
    and nonce.mutation_request_id = target_mutation_request_id
    and nonce.intended_action = target_action
    and nonce.intent_digest = target_intent_digest
  for update;
  if not found then
    return null;
  end if;

  if nonce_row.environment_id <> (context_value ->> 'environment_id')::uuid
     or nonce_row.principal_id <> (context_value ->> 'principal_id')::uuid
     or nonce_row.membership_id <> (context_value ->> 'membership_id')::uuid
     or nonce_row.admin_session_id <> (context_value ->> 'admin_session_id')::uuid
     or nonce_row.supabase_auth_session_id <> target_supabase_auth_session_id
     or nonce_row.verified_totp_factor_set_hash <>
       context_value ->> 'verified_totp_factor_set_hash'
     or nonce_row.prechallenge_jwt_hash = target_current_jwt_hash
     or target_current_jwt_iat < nonce_row.min_amr_at - interval '1 second'
     or target_totp_amr_at < nonce_row.min_amr_at - interval '1 second'
     or target_totp_amr_at > effective_now + interval '1 minute' then
    return null;
  end if;

  if nonce_row.status = 'consumed' then
    select grant.*
    into grant_row
    from private.admin_control_step_up_grants as grant
    where grant.control_nonce_id = nonce_row.id
      and grant.mutation_request_id = target_mutation_request_id
      and grant.intended_action = target_action
      and grant.intent_digest = target_intent_digest
      and grant.completion_jwt_hash = target_current_jwt_hash
      and grant.verified_totp_amr_at is not distinct from target_totp_amr_at;
    if not found then
      return null;
    end if;
    return jsonb_build_object(
      'action', grant_row.intended_action,
      'expires_at', grant_row.expires_at,
      'grant_id', grant_row.id,
      'intent_digest', grant_row.intent_digest,
      'request_id', grant_row.mutation_request_id,
      'status', grant_row.status,
      'verified_totp_amr_at', grant_row.verified_totp_amr_at
    );
  end if;

  if nonce_row.status <> 'pending' or nonce_row.expires_at <= effective_now then
    if nonce_row.status = 'pending' then
      update private.admin_control_step_up_nonces
      set status = 'expired', updated_at = effective_now
      where id = nonce_row.id and status = 'pending';
    end if;
    return null;
  end if;

  select session.*
  into session_row
  from public.admin_sessions as session
  where session.id = nonce_row.admin_session_id
    and session.revoked_at is null
  for update;
  if not found then
    return null;
  end if;

  grant_expires_at := least(
    nonce_row.expires_at,
    target_totp_amr_at + interval '5 minutes',
    session_row.expires_at
  );
  if grant_expires_at <= effective_now then
    update private.admin_control_step_up_nonces
    set status = 'expired', updated_at = effective_now
    where id = nonce_row.id and status = 'pending';
    return null;
  end if;

  insert into private.admin_control_step_up_grants (
    source_kind,
    control_nonce_id,
    environment_id,
    principal_id,
    membership_id,
    admin_session_id,
    supabase_auth_session_id,
    verified_totp_factor_set_hash,
    intended_action,
    intent_digest,
    mutation_request_id,
    prechallenge_jwt_hash,
    completion_jwt_hash,
    min_amr_at,
    verified_totp_amr_at,
    issued_at,
    expires_at
  ) values (
    'control',
    nonce_row.id,
    nonce_row.environment_id,
    nonce_row.principal_id,
    nonce_row.membership_id,
    nonce_row.admin_session_id,
    nonce_row.supabase_auth_session_id,
    nonce_row.verified_totp_factor_set_hash,
    nonce_row.intended_action,
    nonce_row.intent_digest,
    nonce_row.mutation_request_id,
    nonce_row.prechallenge_jwt_hash,
    target_current_jwt_hash,
    nonce_row.min_amr_at,
    target_totp_amr_at,
    effective_now,
    grant_expires_at
  ) returning * into grant_row;

  update private.admin_control_step_up_nonces
  set
    status = 'consumed',
    consumed_at = effective_now,
    completed_grant_id = grant_row.id,
    updated_at = effective_now
  where id = nonce_row.id;

  update public.admin_sessions
  set step_up_verified_at = target_totp_amr_at, updated_at = effective_now
  where id = nonce_row.admin_session_id;

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
    target_mutation_request_id,
    grant_row.environment_id,
    grant_row.principal_id,
    grant_row.membership_id,
    grant_row.admin_session_id,
    'admin_control_step_up.complete',
    'admin_control_step_up_grant',
    grant_row.id::text,
    'accepted',
    jsonb_build_object(
      'intended_action', grant_row.intended_action,
      'source_kind', grant_row.source_kind
    )
  );

  return jsonb_build_object(
    'action', grant_row.intended_action,
    'expires_at', grant_row.expires_at,
    'grant_id', grant_row.id,
    'intent_digest', grant_row.intent_digest,
    'request_id', grant_row.mutation_request_id,
    'status', grant_row.status,
    'verified_totp_amr_at', grant_row.verified_totp_amr_at
  );
end;
$$;

revoke all on function private.complete_admin_control_step_up_v1(
  text, uuid, uuid, text, text, uuid, text, text, timestamptz, text, timestamptz
) from public, anon, authenticated, service_role;

create function private.consume_admin_control_step_up_grant_v1(
  target_admin_session_id uuid,
  target_action text,
  target_mutation_request_id uuid,
  target_intent_digest text,
  target_allow_login_source boolean default false
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
  session_row public.admin_sessions%rowtype;
  login_nonce private.admin_step_up_nonces%rowtype;
  grant_row private.admin_control_step_up_grants%rowtype;
  current_factor_set_hash text;
  grant_expires_at timestamptz;
  effective_now timestamptz := statement_timestamp();
begin
  if target_admin_session_id is null
     or target_action is null
     or target_action not in (
       'ai_pin_enroll',
       'ai_pin_rotate',
       'ai_pin_revoke',
       'ai_pin_reset',
       'environment_ai_policy_change'
     )
     or target_mutation_request_id is null
     or target_intent_digest is null
     or target_intent_digest !~ '^[0-9a-f]{64}$'
     or target_allow_login_source is null then
    raise exception 'invalid Admin control grant consumption'
      using errcode = '22023';
  end if;

  select session.*
  into session_row
  from public.admin_sessions as session
  where session.id = target_admin_session_id
    and session.authentication_method = 'google_totp'
    and session.aal = 2
    and session.revoked_at is null
    and session.expires_at > effective_now
  for update;
  if not found then
    return null;
  end if;

  current_factor_set_hash := private.current_verified_totp_factor_set_hash_v1(
    session_row.auth_user_id
  );
  if current_factor_set_hash is null
     or current_factor_set_hash is distinct from
       session_row.verified_totp_factor_set_hash then
    update public.admin_sessions
    set
      revoked_at = effective_now,
      revoke_reason = 'totp_factor_set_changed',
      updated_at = effective_now
    where id = session_row.id and revoked_at is null;
    return null;
  end if;

  select grant.*
  into grant_row
  from private.admin_control_step_up_grants as grant
  where grant.mutation_request_id = target_mutation_request_id
  for update;

  if found then
    if grant_row.source_kind <> 'control'
       or grant_row.admin_session_id <> session_row.id
       or grant_row.environment_id <> session_row.environment_id
       or grant_row.principal_id <> session_row.principal_id
       or grant_row.membership_id <> session_row.membership_id
       or grant_row.supabase_auth_session_id <>
         session_row.supabase_auth_session_id
       or grant_row.verified_totp_factor_set_hash <>
         session_row.verified_totp_factor_set_hash
       or grant_row.intended_action <> target_action
       or grant_row.intent_digest <> target_intent_digest then
      return null;
    end if;

    if grant_row.status <> 'available'
       or grant_row.expires_at <= effective_now then
      if grant_row.status = 'available' then
        update private.admin_control_step_up_grants
        set status = 'expired', updated_at = effective_now
        where id = grant_row.id and status = 'available';
      end if;
      return null;
    end if;

    update private.admin_control_step_up_grants
    set
      status = 'consumed',
      consumed_at = effective_now,
      updated_at = effective_now
    where id = grant_row.id and status = 'available'
    returning * into grant_row;
  elsif target_allow_login_source then
    if exists (
      select 1
      from private.admin_ai_unlock_factors as factor
      where factor.environment_id = session_row.environment_id
        and factor.membership_id = session_row.membership_id
    ) then
      return null;
    end if;

    select nonce.*
    into login_nonce
    from private.admin_step_up_nonces as nonce
    where nonce.id = session_row.step_up_nonce_id
      and nonce.status = 'consumed'
      and nonce.completed_admin_session_id = session_row.id
      and nonce.supabase_auth_session_id = session_row.supabase_auth_session_id
    for update;

    if not found
       or login_nonce.completion_jwt_hash is null
       or login_nonce.prechallenge_jwt_hash = login_nonce.completion_jwt_hash
       or login_nonce.verified_totp_amr_at is null
       or login_nonce.verified_totp_amr_at <
         login_nonce.min_amr_at - interval '1 second'
       or login_nonce.verified_totp_amr_at + interval '5 minutes' <= effective_now
       or login_nonce.verified_totp_factor_set_hash is distinct from
         session_row.verified_totp_factor_set_hash then
      return null;
    end if;

    grant_expires_at := least(
      login_nonce.verified_totp_amr_at + interval '5 minutes',
      session_row.expires_at
    );
    if grant_expires_at <= effective_now then
      return null;
    end if;

    insert into private.admin_control_step_up_grants (
      source_kind,
      login_step_up_nonce_id,
      environment_id,
      principal_id,
      membership_id,
      admin_session_id,
      supabase_auth_session_id,
      verified_totp_factor_set_hash,
      intended_action,
      intent_digest,
      mutation_request_id,
      prechallenge_jwt_hash,
      completion_jwt_hash,
      min_amr_at,
      verified_totp_amr_at,
      issued_at,
      expires_at,
      status,
      consumed_at
    ) values (
      'admin_login',
      login_nonce.id,
      session_row.environment_id,
      session_row.principal_id,
      session_row.membership_id,
      session_row.id,
      session_row.supabase_auth_session_id,
      session_row.verified_totp_factor_set_hash,
      target_action,
      target_intent_digest,
      target_mutation_request_id,
      login_nonce.prechallenge_jwt_hash,
      login_nonce.completion_jwt_hash,
      login_nonce.min_amr_at,
      login_nonce.verified_totp_amr_at,
      effective_now,
      grant_expires_at,
      'consumed',
      effective_now
    ) returning * into grant_row;

    update public.admin_sessions
    set
      step_up_verified_at = login_nonce.verified_totp_amr_at,
      updated_at = effective_now
    where id = session_row.id;
  else
    return null;
  end if;

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
    target_mutation_request_id,
    grant_row.environment_id,
    grant_row.principal_id,
    grant_row.membership_id,
    grant_row.admin_session_id,
    'admin_control_step_up.consume',
    'admin_control_step_up_grant',
    grant_row.id::text,
    'accepted',
    jsonb_build_object(
      'intended_action', grant_row.intended_action,
      'source_kind', grant_row.source_kind
    )
  );

  return jsonb_build_object(
    'grant_id', grant_row.id,
    'source_kind', grant_row.source_kind,
    'verified_totp_amr_at', grant_row.verified_totp_amr_at
  );
end;
$$;

revoke all on function private.consume_admin_control_step_up_grant_v1(
  uuid, text, uuid, text, boolean
) from public, anon, authenticated, service_role;

alter function private.enroll_admin_ai_pin_v1(
  text, uuid, uuid, text, integer, uuid
) rename to enroll_admin_ai_pin_pre_b22a_v1;

revoke all on function private.enroll_admin_ai_pin_pre_b22a_v1(
  text, uuid, uuid, text, integer, uuid
) from public, anon, authenticated, service_role;

create function private.enroll_admin_ai_pin_v1(
  target_token_hash text,
  target_auth_user_id uuid,
  target_supabase_auth_session_id uuid,
  target_peppered_pin_hmac text,
  target_pin_pepper_version integer,
  target_request_id uuid
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
  context_value jsonb;
  existing_factor private.admin_ai_unlock_factors%rowtype;
  active_factor private.admin_ai_unlock_factors%rowtype;
  retry_grant private.admin_control_step_up_grants%rowtype;
  factor_history_count bigint;
  intended_action text;
  intent_digest_value text;
  grant_value jsonb;
begin
  if target_peppered_pin_hmac is null
     or target_peppered_pin_hmac !~ '^[0-9a-f]{64}$'
     or target_pin_pepper_version is null
     or target_pin_pepper_version < 1
     or target_request_id is null then
    raise exception 'invalid Admin AI PIN enrollment' using errcode = '22023';
  end if;

  perform private.serialize_admin_ai_request_v1(target_request_id);
  context_value := private.require_admin_ai_context_v1(
    target_token_hash,
    target_auth_user_id,
    target_supabase_auth_session_id,
    null,
    true,
    false
  );
  if context_value is null then
    return null;
  end if;

  perform private.serialize_admin_ai_scope_v1(
    'factor-membership',
    (context_value ->> 'membership_id')::uuid
  );

  select factor.*
  into existing_factor
  from private.admin_ai_unlock_factors as factor
  where factor.enrollment_request_id = target_request_id;
  if found then
    if existing_factor.environment_id = (context_value ->> 'environment_id')::uuid
       and existing_factor.principal_id = (context_value ->> 'principal_id')::uuid
       and existing_factor.membership_id = (context_value ->> 'membership_id')::uuid
       and existing_factor.enrolled_by_admin_session_id =
          (context_value ->> 'admin_session_id')::uuid then
      select grant.*
      into retry_grant
      from private.admin_control_step_up_grants as grant
      where grant.mutation_request_id = target_request_id
        and grant.status = 'consumed'
        and grant.admin_session_id = (context_value ->> 'admin_session_id')::uuid
        and grant.environment_id = existing_factor.environment_id
        and grant.principal_id = existing_factor.principal_id
        and grant.membership_id = existing_factor.membership_id
        and grant.intended_action in ('ai_pin_enroll', 'ai_pin_rotate');
      intent_digest_value := private.admin_ai_pin_control_intent_digest_v1(
        retry_grant.intended_action,
        target_pin_pepper_version,
        target_peppered_pin_hmac
      );
      if retry_grant.id is null
         or retry_grant.intent_digest is distinct from intent_digest_value then
        return null;
      end if;
      return private.enroll_admin_ai_pin_pre_b22a_v1(
        target_token_hash,
        target_auth_user_id,
        target_supabase_auth_session_id,
        target_peppered_pin_hmac,
        target_pin_pepper_version,
        target_request_id
      );
    end if;
    return null;
  end if;

  select count(*)
  into factor_history_count
  from private.admin_ai_unlock_factors as factor
  where factor.environment_id = (context_value ->> 'environment_id')::uuid
    and factor.membership_id = (context_value ->> 'membership_id')::uuid;

  select factor.*
  into active_factor
  from private.admin_ai_unlock_factors as factor
  where factor.environment_id = (context_value ->> 'environment_id')::uuid
    and factor.membership_id = (context_value ->> 'membership_id')::uuid
    and factor.status = 'active'
  for update;

  intended_action := case
    when active_factor.id is not null then 'ai_pin_rotate'
    else 'ai_pin_enroll'
  end;
  intent_digest_value := private.admin_ai_pin_control_intent_digest_v1(
    intended_action,
    target_pin_pepper_version,
    target_peppered_pin_hmac
  );

  grant_value := private.consume_admin_control_step_up_grant_v1(
    (context_value ->> 'admin_session_id')::uuid,
    intended_action,
    target_request_id,
    intent_digest_value,
    factor_history_count = 0
  );
  if grant_value is null then
    return null;
  end if;

  update public.admin_sessions
  set
    step_up_verified_at = (grant_value ->> 'verified_totp_amr_at')::timestamptz,
    updated_at = statement_timestamp()
  where id = (context_value ->> 'admin_session_id')::uuid;

  return private.enroll_admin_ai_pin_pre_b22a_v1(
    target_token_hash,
    target_auth_user_id,
    target_supabase_auth_session_id,
    target_peppered_pin_hmac,
    target_pin_pepper_version,
    target_request_id
  );
end;
$$;

revoke all on function private.enroll_admin_ai_pin_v1(
  text, uuid, uuid, text, integer, uuid
) from public, anon, authenticated, service_role;

alter function private.set_admin_ai_policy_v1(
  text, uuid, uuid, uuid, text[], text[], integer, integer, bigint, bigint,
  bigint, bigint, bigint, bigint, integer, integer, integer, timestamptz,
  timestamptz, uuid
) rename to set_admin_ai_policy_pre_b22a_v1;

revoke all on function private.set_admin_ai_policy_pre_b22a_v1(
  text, uuid, uuid, uuid, text[], text[], integer, integer, bigint, bigint,
  bigint, bigint, bigint, bigint, integer, integer, integer, timestamptz,
  timestamptz, uuid
) from public, anon, authenticated, service_role;

create function private.set_admin_ai_policy_v1(
  target_token_hash text,
  target_auth_user_id uuid,
  target_supabase_auth_session_id uuid,
  target_membership_id uuid,
  target_allowed_actions text[],
  target_allowed_models text[],
  target_max_calls_per_lecture integer,
  target_max_calls_per_day integer,
  target_max_input_tokens_per_lecture bigint,
  target_max_input_tokens_per_day bigint,
  target_max_output_tokens_per_lecture bigint,
  target_max_output_tokens_per_day bigint,
  target_max_cost_microusd_per_lecture bigint,
  target_max_cost_microusd_per_day bigint,
  target_max_realtime_minutes_per_lecture integer,
  target_max_realtime_minutes_per_day integer,
  target_max_concurrency integer,
  target_valid_from timestamptz,
  target_valid_until timestamptz,
  target_request_id uuid
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
  context_value jsonb;
  target_membership private.admin_environment_memberships%rowtype;
  retry_grant private.admin_control_step_up_grants%rowtype;
  intent_digest_value text;
  grant_value jsonb;
begin
  if target_request_id is null or target_membership_id is null then
    raise exception 'invalid Admin AI policy request' using errcode = '22023';
  end if;

  perform private.serialize_admin_ai_request_v1(target_request_id);
  context_value := private.require_admin_ai_context_v1(
    target_token_hash,
    target_auth_user_id,
    target_supabase_auth_session_id,
    null,
    false,
    true
  );
  if context_value is null then
    return null;
  end if;

  intent_digest_value := private.admin_ai_policy_control_intent_digest_v1(
    target_membership_id,
    target_allowed_actions,
    target_allowed_models,
    target_max_calls_per_lecture,
    target_max_calls_per_day,
    target_max_input_tokens_per_lecture,
    target_max_input_tokens_per_day,
    target_max_output_tokens_per_lecture,
    target_max_output_tokens_per_day,
    target_max_cost_microusd_per_lecture,
    target_max_cost_microusd_per_day,
    target_max_realtime_minutes_per_lecture,
    target_max_realtime_minutes_per_day,
    target_max_concurrency,
    target_valid_from,
    target_valid_until
  );

  if exists (
    select 1
    from private.admin_ai_policies as policy
    where policy.request_id = target_request_id
  ) then
    select grant.*
    into retry_grant
    from private.admin_control_step_up_grants as grant
    where grant.mutation_request_id = target_request_id
      and grant.status = 'consumed'
      and grant.admin_session_id = (context_value ->> 'admin_session_id')::uuid
      and grant.environment_id = (context_value ->> 'environment_id')::uuid
      and grant.principal_id = (context_value ->> 'principal_id')::uuid
      and grant.membership_id = (context_value ->> 'membership_id')::uuid
      and grant.intended_action = 'environment_ai_policy_change'
      and grant.intent_digest = intent_digest_value;
    if not found then
      return null;
    end if;
    return private.set_admin_ai_policy_pre_b22a_v1(
      target_token_hash,
      target_auth_user_id,
      target_supabase_auth_session_id,
      target_membership_id,
      target_allowed_actions,
      target_allowed_models,
      target_max_calls_per_lecture,
      target_max_calls_per_day,
      target_max_input_tokens_per_lecture,
      target_max_input_tokens_per_day,
      target_max_output_tokens_per_lecture,
      target_max_output_tokens_per_day,
      target_max_cost_microusd_per_lecture,
      target_max_cost_microusd_per_day,
      target_max_realtime_minutes_per_lecture,
      target_max_realtime_minutes_per_day,
      target_max_concurrency,
      target_valid_from,
      target_valid_until,
      target_request_id
    );
  end if;

  perform private.serialize_admin_ai_scope_v1(
    'policy-membership',
    target_membership_id
  );
  select membership.*
  into target_membership
  from private.admin_environment_memberships as membership
  where membership.id = target_membership_id
    and membership.environment_id = (context_value ->> 'environment_id')::uuid
    and membership.status = 'active'
    and membership.can_use_ai
    and (
      membership.expires_at is null
      or membership.expires_at > statement_timestamp()
    )
  for key share;
  if not found then
    return null;
  end if;

  grant_value := private.consume_admin_control_step_up_grant_v1(
    (context_value ->> 'admin_session_id')::uuid,
    'environment_ai_policy_change',
    target_request_id,
    intent_digest_value,
    false
  );
  if grant_value is null then
    return null;
  end if;

  update public.admin_sessions
  set
    step_up_verified_at = (grant_value ->> 'verified_totp_amr_at')::timestamptz,
    updated_at = statement_timestamp()
  where id = (context_value ->> 'admin_session_id')::uuid;

  return private.set_admin_ai_policy_pre_b22a_v1(
    target_token_hash,
    target_auth_user_id,
    target_supabase_auth_session_id,
    target_membership_id,
    target_allowed_actions,
    target_allowed_models,
    target_max_calls_per_lecture,
    target_max_calls_per_day,
    target_max_input_tokens_per_lecture,
    target_max_input_tokens_per_day,
    target_max_output_tokens_per_lecture,
    target_max_output_tokens_per_day,
    target_max_cost_microusd_per_lecture,
    target_max_cost_microusd_per_day,
    target_max_realtime_minutes_per_lecture,
    target_max_realtime_minutes_per_day,
    target_max_concurrency,
    target_valid_from,
    target_valid_until,
    target_request_id
  );
end;
$$;

revoke all on function private.set_admin_ai_policy_v1(
  text, uuid, uuid, uuid, text[], text[], integer, integer, bigint, bigint,
  bigint, bigint, bigint, bigint, integer, integer, integer, timestamptz,
  timestamptz, uuid
) from public, anon, authenticated, service_role;

create function private.terminate_admin_ai_pin_v1(
  target_token_hash text,
  target_auth_user_id uuid,
  target_supabase_auth_session_id uuid,
  target_terminal_action text,
  target_request_id uuid
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
  context_value jsonb;
  factor_row private.admin_ai_unlock_factors%rowtype;
  retry_grant private.admin_control_step_up_grants%rowtype;
  grant_value jsonb;
  drain_result jsonb;
  control_action text;
  intent_digest_value text;
  effective_now timestamptz := statement_timestamp();
begin
  if target_terminal_action is null
     or target_terminal_action not in ('revoke', 'reset')
     or target_request_id is null then
    raise exception 'invalid Admin AI PIN termination' using errcode = '22023';
  end if;
  control_action := 'ai_pin_' || target_terminal_action;

  if not exists (
    select 1
    from private.admin_ai_unlock_runtime_gate as gate
    where gate.singleton and gate.ai_unlock_enabled
  ) then
    raise exception 'Admin AI unlock is disabled' using errcode = 'P7320';
  end if;

  perform private.serialize_admin_ai_request_v1(target_request_id);
  context_value := private.require_admin_ai_context_v1(
    target_token_hash,
    target_auth_user_id,
    target_supabase_auth_session_id,
    null,
    true,
    false
  );
  if context_value is null then
    return null;
  end if;

  perform private.serialize_admin_ai_scope_v1(
    'factor-membership',
    (context_value ->> 'membership_id')::uuid
  );

  select factor.*
  into factor_row
  from private.admin_ai_unlock_factors as factor
  where factor.terminal_request_id = target_request_id;
  if found then
    if factor_row.environment_id = (context_value ->> 'environment_id')::uuid
       and factor_row.principal_id = (context_value ->> 'principal_id')::uuid
       and factor_row.membership_id = (context_value ->> 'membership_id')::uuid
       and factor_row.terminal_by_admin_session_id =
          (context_value ->> 'admin_session_id')::uuid
       and factor_row.terminal_action = target_terminal_action then
      intent_digest_value := private.admin_ai_pin_terminal_control_intent_digest_v1(
        control_action,
        factor_row.membership_id,
        factor_row.id,
        factor_row.factor_version
      );
      select grant.*
      into retry_grant
      from private.admin_control_step_up_grants as grant
      where grant.mutation_request_id = target_request_id
        and grant.status = 'consumed'
        and grant.admin_session_id = (context_value ->> 'admin_session_id')::uuid
        and grant.environment_id = factor_row.environment_id
        and grant.principal_id = factor_row.principal_id
        and grant.membership_id = factor_row.membership_id
        and grant.intended_action = control_action
        and grant.intent_digest = intent_digest_value;
      if not found then
        return null;
      end if;
      return jsonb_build_object(
        'factor_id', factor_row.id,
        'factor_version', factor_row.factor_version,
        'status', factor_row.status,
        'terminal_action', factor_row.terminal_action
      );
    end if;
    return null;
  end if;

  select factor.*
  into factor_row
  from private.admin_ai_unlock_factors as factor
  where factor.environment_id = (context_value ->> 'environment_id')::uuid
    and factor.membership_id = (context_value ->> 'membership_id')::uuid
    and factor.status = 'active'
  for update;
  if not found then
    return null;
  end if;

  intent_digest_value := private.admin_ai_pin_terminal_control_intent_digest_v1(
    control_action,
    factor_row.membership_id,
    factor_row.id,
    factor_row.factor_version
  );

  grant_value := private.consume_admin_control_step_up_grant_v1(
    (context_value ->> 'admin_session_id')::uuid,
    control_action,
    target_request_id,
    intent_digest_value,
    false
  );
  if grant_value is null then
    return null;
  end if;

  update private.admin_ai_unlock_factors
  set
    status = 'revoked',
    revoked_at = effective_now,
    revoke_reason = case
      when target_terminal_action = 'reset' then 'factor_reset'
      else 'factor_revoked'
    end,
    terminal_request_id = target_request_id,
    terminal_action = target_terminal_action,
    terminal_by_admin_session_id =
      (context_value ->> 'admin_session_id')::uuid,
    updated_at = effective_now
  where id = factor_row.id
  returning * into factor_row;

  drain_result := private.drain_admin_ai_factor_authority_v1(
    factor_row.id,
    (context_value ->> 'admin_session_id')::uuid,
    'factor_revoked',
    effective_now
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
    metadata
  ) values (
    target_request_id,
    factor_row.environment_id,
    factor_row.principal_id,
    factor_row.membership_id,
    factor_row.terminal_by_admin_session_id,
    'admin_ai_factor.' || target_terminal_action,
    'admin_ai_unlock_factor',
    factor_row.id::text,
    'accepted',
    jsonb_build_object(
      'authority_drain', drain_result,
      'factor_version', factor_row.factor_version
    )
  );

  return jsonb_build_object(
    'factor_id', factor_row.id,
    'factor_version', factor_row.factor_version,
    'status', factor_row.status,
    'terminal_action', factor_row.terminal_action
  );
end;
$$;

revoke all on function private.terminate_admin_ai_pin_v1(
  text, uuid, uuid, text, uuid
) from public, anon, authenticated, service_role;

create function private.revoke_admin_ai_pin_v1(
  target_token_hash text,
  target_auth_user_id uuid,
  target_supabase_auth_session_id uuid,
  target_request_id uuid
)
returns jsonb
language sql
volatile
security definer
set search_path = ''
as $$
  select private.terminate_admin_ai_pin_v1(
    target_token_hash,
    target_auth_user_id,
    target_supabase_auth_session_id,
    'revoke',
    target_request_id
  );
$$;

revoke all on function private.revoke_admin_ai_pin_v1(
  text, uuid, uuid, uuid
) from public, anon, authenticated, service_role;

create function private.reset_admin_ai_pin_v1(
  target_token_hash text,
  target_auth_user_id uuid,
  target_supabase_auth_session_id uuid,
  target_request_id uuid
)
returns jsonb
language sql
volatile
security definer
set search_path = ''
as $$
  select private.terminate_admin_ai_pin_v1(
    target_token_hash,
    target_auth_user_id,
    target_supabase_auth_session_id,
    'reset',
    target_request_id
  );
$$;

revoke all on function private.reset_admin_ai_pin_v1(
  text, uuid, uuid, uuid
) from public, anon, authenticated, service_role;

create function private.get_admin_ai_unlock_profile_v1(
  target_token_hash text,
  target_auth_user_id uuid,
  target_supabase_auth_session_id uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
set statement_timeout = '3s'
as $$
declare
  context_value jsonb;
  latest_factor private.admin_ai_unlock_factors%rowtype;
  active_browser_count bigint;
  can_use_ai_value boolean;
  ai_unlock_enabled_value boolean;
  remembered_browser_enabled_value boolean;
begin
  context_value := private.require_admin_ai_context_v1(
    target_token_hash,
    target_auth_user_id,
    target_supabase_auth_session_id,
    null,
    false,
    false
  );
  if context_value is null then
    return null;
  end if;

  select membership.can_use_ai
  into can_use_ai_value
  from private.admin_environment_memberships as membership
  where membership.id = (context_value ->> 'membership_id')::uuid;

  select factor.*
  into latest_factor
  from private.admin_ai_unlock_factors as factor
  where factor.environment_id = (context_value ->> 'environment_id')::uuid
    and factor.membership_id = (context_value ->> 'membership_id')::uuid
  order by factor.factor_version desc
  limit 1;

  select count(*)
  into active_browser_count
  from private.admin_ai_browser_credentials as credential
  where credential.environment_id = (context_value ->> 'environment_id')::uuid
    and credential.membership_id = (context_value ->> 'membership_id')::uuid
    and credential.status = 'active'
    and credential.expires_at > statement_timestamp();

  select gate.ai_unlock_enabled, gate.remembered_browser_enabled
  into ai_unlock_enabled_value, remembered_browser_enabled_value
  from private.admin_ai_unlock_runtime_gate as gate
  where gate.singleton;

  return jsonb_build_object(
    'active_browser_count', active_browser_count,
    'active_pin', coalesce(latest_factor.status = 'active', false),
    'ai_unlock_enabled', ai_unlock_enabled_value,
    'can_use_ai', can_use_ai_value,
    'factor_status', latest_factor.status,
    'factor_version', latest_factor.factor_version,
    'pin_pepper_version', latest_factor.pin_pepper_version,
    'remembered_browser_enabled', remembered_browser_enabled_value,
    'role', context_value ->> 'role'
  );
end;
$$;

revoke all on function private.get_admin_ai_unlock_profile_v1(
  text, uuid, uuid
) from public, anon, authenticated, service_role;

create function private.cleanup_admin_control_step_up_ephemera_v1(
  target_retention_before timestamptz,
  target_request_id uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
set statement_timeout = '10s'
set lock_timeout = '750ms'
as $$
declare
  effective_now timestamptz := statement_timestamp();
  expired_nonces integer := 0;
  expired_grants integer := 0;
  deleted_grants integer := 0;
  deleted_nonces integer := 0;
  has_more boolean := false;
begin
  if target_retention_before is null
     or target_retention_before > effective_now - interval '1 day'
     or target_request_id is null then
    raise exception 'invalid Admin control retention cutoff'
      using errcode = '22023';
  end if;

  with candidates as (
    select nonce.id
    from private.admin_control_step_up_nonces as nonce
    where nonce.status = 'pending' and nonce.expires_at <= effective_now
    order by nonce.expires_at, nonce.id
    for update of nonce skip locked
    limit 500
  )
  update private.admin_control_step_up_nonces as nonce
  set status = 'expired', updated_at = effective_now
  from candidates
  where nonce.id = candidates.id;
  get diagnostics expired_nonces = row_count;

  with candidates as (
    select grant.id
    from private.admin_control_step_up_grants as grant
    where grant.status = 'available' and grant.expires_at <= effective_now
    order by grant.expires_at, grant.id
    for update of grant skip locked
    limit 500
  )
  update private.admin_control_step_up_grants as grant
  set status = 'expired', updated_at = effective_now
  from candidates
  where grant.id = candidates.id;
  get diagnostics expired_grants = row_count;

  -- Delete child grants before their control nonces. The reverse completion
  -- identifier is deliberately not an FK, so this order is deterministic.
  with candidates as (
    select grant.id
    from private.admin_control_step_up_grants as grant
    where grant.status in ('consumed', 'superseded', 'expired')
      and grant.updated_at < target_retention_before
    order by grant.updated_at, grant.id
    for update of grant skip locked
    limit 500
  )
  delete from private.admin_control_step_up_grants as grant
  using candidates
  where grant.id = candidates.id;
  get diagnostics deleted_grants = row_count;

  with candidates as (
    select nonce.id
    from private.admin_control_step_up_nonces as nonce
    where nonce.status in ('consumed', 'superseded', 'expired')
      and nonce.updated_at < target_retention_before
      and not exists (
        select 1
        from private.admin_control_step_up_grants as grant
        where grant.control_nonce_id = nonce.id
      )
    order by nonce.updated_at, nonce.id
    for update of nonce skip locked
    limit 500
  )
  delete from private.admin_control_step_up_nonces as nonce
  using candidates
  where nonce.id = candidates.id;
  get diagnostics deleted_nonces = row_count;

  select
    exists (
      select 1
      from private.admin_control_step_up_nonces as nonce
      where nonce.status = 'pending' and nonce.expires_at <= effective_now
    )
    or exists (
      select 1
      from private.admin_control_step_up_grants as grant
      where grant.status = 'available' and grant.expires_at <= effective_now
    )
    or exists (
      select 1
      from private.admin_control_step_up_grants as grant
      where grant.status in ('consumed', 'superseded', 'expired')
        and grant.updated_at < target_retention_before
    )
    or exists (
      select 1
      from private.admin_control_step_up_nonces as nonce
      where nonce.status in ('consumed', 'superseded', 'expired')
        and nonce.updated_at < target_retention_before
        and not exists (
          select 1
          from private.admin_control_step_up_grants as grant
          where grant.control_nonce_id = nonce.id
        )
    )
  into has_more;

  insert into private.admin_audit_events (
    request_id,
    action,
    target_type,
    result,
    metadata
  ) values (
    target_request_id,
    'admin_control_retention.cleanup',
    'admin_control_ephemera',
    'accepted',
    jsonb_build_object(
      'grants_deleted', deleted_grants,
      'grants_expired', expired_grants,
      'has_more', has_more,
      'nonces_deleted', deleted_nonces,
      'nonces_expired', expired_nonces
    )
  );

  return jsonb_build_object(
    'grants_deleted', deleted_grants,
    'grants_expired', expired_grants,
    'has_more', has_more,
    'nonces_deleted', deleted_nonces,
    'nonces_expired', expired_nonces
  );
end;
$$;

revoke all on function private.cleanup_admin_control_step_up_ephemera_v1(
  timestamptz, uuid
) from public, anon, authenticated, service_role;

create function public.adopt_existing_admin_totp_factor_set_v1(
  target_environment_id uuid,
  target_principal_id uuid,
  target_membership_id uuid,
  target_auth_user_id uuid,
  target_expected_factor_set_hash text,
  target_expected_factor_count integer,
  target_request_id uuid,
  target_operator_actor text,
  target_reason text
)
returns jsonb
language sql
volatile
security invoker
set search_path = ''
as $$
  select private.adopt_existing_admin_totp_factor_set_v1(
    target_environment_id,
    target_principal_id,
    target_membership_id,
    target_auth_user_id,
    target_expected_factor_set_hash,
    target_expected_factor_count,
    target_request_id,
    target_operator_actor,
    target_reason
  );
$$;

create function public.begin_admin_totp_step_up_v2(
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
language sql
volatile
security invoker
set search_path = ''
as $$
  select private.begin_admin_totp_step_up_v2(
    target_environment_id,
    target_auth_user_id,
    target_supabase_auth_session_id,
    target_challenged_factor_id,
    target_nonce_hash,
    target_reserved_admin_session_id,
    target_prechallenge_jwt_hash,
    target_request_id
  );
$$;

create function public.begin_admin_control_step_up_v1(
  target_token_hash text,
  target_auth_user_id uuid,
  target_supabase_auth_session_id uuid,
  target_action text,
  target_mutation_request_id uuid,
  target_nonce_hash text,
  target_prechallenge_jwt_hash text,
  target_intent_digest text default null
)
returns jsonb
language sql
volatile
security invoker
set search_path = ''
as $$
  select private.begin_admin_control_step_up_v1(
    target_token_hash,
    target_auth_user_id,
    target_supabase_auth_session_id,
    target_action,
    target_mutation_request_id,
    target_nonce_hash,
    target_prechallenge_jwt_hash,
    target_intent_digest
  );
$$;

create function public.complete_admin_control_step_up_v1(
  target_token_hash text,
  target_auth_user_id uuid,
  target_supabase_auth_session_id uuid,
  target_action text,
  target_intent_digest text,
  target_mutation_request_id uuid,
  target_nonce_hash text,
  target_current_jwt_hash text,
  target_current_jwt_iat timestamptz,
  target_totp_amr_method text,
  target_totp_amr_at timestamptz
)
returns jsonb
language sql
volatile
security invoker
set search_path = ''
as $$
  select private.complete_admin_control_step_up_v1(
    target_token_hash,
    target_auth_user_id,
    target_supabase_auth_session_id,
    target_action,
    target_intent_digest,
    target_mutation_request_id,
    target_nonce_hash,
    target_current_jwt_hash,
    target_current_jwt_iat,
    target_totp_amr_method,
    target_totp_amr_at
  );
$$;

create function public.reconcile_admin_totp_factor_set_v1(
  target_auth_user_id uuid,
  target_request_id uuid
)
returns jsonb
language sql
volatile
security invoker
set search_path = ''
as $$
  select private.reconcile_admin_totp_factor_set_v1(
    target_auth_user_id,
    target_request_id
  );
$$;

create function public.revoke_admin_ai_pin_v1(
  target_token_hash text,
  target_auth_user_id uuid,
  target_supabase_auth_session_id uuid,
  target_request_id uuid
)
returns jsonb
language sql
volatile
security invoker
set search_path = ''
as $$
  select private.revoke_admin_ai_pin_v1(
    target_token_hash,
    target_auth_user_id,
    target_supabase_auth_session_id,
    target_request_id
  );
$$;

create function public.reset_admin_ai_pin_v1(
  target_token_hash text,
  target_auth_user_id uuid,
  target_supabase_auth_session_id uuid,
  target_request_id uuid
)
returns jsonb
language sql
volatile
security invoker
set search_path = ''
as $$
  select private.reset_admin_ai_pin_v1(
    target_token_hash,
    target_auth_user_id,
    target_supabase_auth_session_id,
    target_request_id
  );
$$;

create function public.get_admin_ai_unlock_profile_v1(
  target_token_hash text,
  target_auth_user_id uuid,
  target_supabase_auth_session_id uuid
)
returns jsonb
language sql
volatile
security invoker
set search_path = ''
as $$
  select private.get_admin_ai_unlock_profile_v1(
    target_token_hash,
    target_auth_user_id,
    target_supabase_auth_session_id
  );
$$;

create function public.cleanup_admin_control_step_up_ephemera_v1(
  target_retention_before timestamptz,
  target_request_id uuid
)
returns jsonb
language sql
volatile
security invoker
set search_path = ''
as $$
  select private.cleanup_admin_control_step_up_ephemera_v1(
    target_retention_before,
    target_request_id
  );
$$;

revoke all on function public.begin_admin_totp_step_up_v2(
  uuid, uuid, uuid, uuid, text, uuid, text, uuid
) from public, anon, authenticated;
revoke all on function public.adopt_existing_admin_totp_factor_set_v1(
  uuid, uuid, uuid, uuid, text, integer, uuid, text, text
) from public, anon, authenticated;
revoke all on function public.begin_admin_control_step_up_v1(
  text, uuid, uuid, text, uuid, text, text, text
) from public, anon, authenticated;
revoke all on function public.complete_admin_control_step_up_v1(
  text, uuid, uuid, text, text, uuid, text, text, timestamptz, text, timestamptz
) from public, anon, authenticated;
revoke all on function public.reconcile_admin_totp_factor_set_v1(uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.revoke_admin_ai_pin_v1(text, uuid, uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.reset_admin_ai_pin_v1(text, uuid, uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.get_admin_ai_unlock_profile_v1(text, uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.cleanup_admin_control_step_up_ephemera_v1(
  timestamptz, uuid
) from public, anon, authenticated;

grant execute on function private.begin_admin_totp_step_up_v2(
  uuid, uuid, uuid, uuid, text, uuid, text, uuid
) to service_role;
grant execute on function private.adopt_existing_admin_totp_factor_set_v1(
  uuid, uuid, uuid, uuid, text, integer, uuid, text, text
) to service_role;
grant execute on function private.complete_admin_totp_step_up_v1(
  text, uuid, uuid, smallint, text, timestamptz, text, timestamptz,
  text, text, text, uuid
) to service_role;
grant execute on function private.verify_and_touch_google_admin_session_v1(
  text, uuid, uuid
) to service_role;
grant execute on function private.enroll_admin_ai_pin_v1(
  text, uuid, uuid, text, integer, uuid
) to service_role;
grant execute on function private.set_admin_ai_policy_v1(
  text, uuid, uuid, uuid, text[], text[], integer, integer, bigint, bigint,
  bigint, bigint, bigint, bigint, integer, integer, integer, timestamptz,
  timestamptz, uuid
) to service_role;
grant execute on function private.begin_admin_control_step_up_v1(
  text, uuid, uuid, text, uuid, text, text, text
) to service_role;
grant execute on function private.complete_admin_control_step_up_v1(
  text, uuid, uuid, text, text, uuid, text, text, timestamptz, text, timestamptz
) to service_role;
grant execute on function private.reconcile_admin_totp_factor_set_v1(uuid, uuid)
  to service_role;
grant execute on function private.revoke_admin_ai_pin_v1(
  text, uuid, uuid, uuid
) to service_role;
grant execute on function private.reset_admin_ai_pin_v1(
  text, uuid, uuid, uuid
) to service_role;
grant execute on function private.get_admin_ai_unlock_profile_v1(
  text, uuid, uuid
) to service_role;
grant execute on function private.cleanup_admin_control_step_up_ephemera_v1(
  timestamptz, uuid
) to service_role;

grant execute on function public.begin_admin_totp_step_up_v2(
  uuid, uuid, uuid, uuid, text, uuid, text, uuid
) to service_role;
grant execute on function public.adopt_existing_admin_totp_factor_set_v1(
  uuid, uuid, uuid, uuid, text, integer, uuid, text, text
) to service_role;
grant execute on function public.begin_admin_control_step_up_v1(
  text, uuid, uuid, text, uuid, text, text, text
) to service_role;
grant execute on function public.complete_admin_control_step_up_v1(
  text, uuid, uuid, text, text, uuid, text, text, timestamptz, text, timestamptz
) to service_role;
grant execute on function public.reconcile_admin_totp_factor_set_v1(uuid, uuid)
  to service_role;
grant execute on function public.revoke_admin_ai_pin_v1(text, uuid, uuid, uuid)
  to service_role;
grant execute on function public.reset_admin_ai_pin_v1(text, uuid, uuid, uuid)
  to service_role;
grant execute on function public.get_admin_ai_unlock_profile_v1(text, uuid, uuid)
  to service_role;
grant execute on function public.cleanup_admin_control_step_up_ephemera_v1(
  timestamptz, uuid
) to service_role;
