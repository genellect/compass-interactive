-- Phase 7.30B2.2b: dormant Admin AI-unlock transport, remembered-browser
-- proof, and rare approved-TOTP-set transitions.
--
-- This migration remains default OFF. It does not issue lecture AI master
-- authority, call a paid provider, remove either legacy PIN, or expose the
-- operator-adoption recovery RPC through an Edge action.

alter table private.admin_identity_runtime_gate
  add column totp_factor_mutation_enabled boolean not null default false;

comment on column private.admin_identity_runtime_gate.totp_factor_mutation_enabled is
  'Default-OFF B2.2b source gate. Add/remove requires a fresh B2.2a control proof and a durable exact transition; operator adoption remains separate.';

-- B2.2b factor-set mutations use the B2.2a five-minute proof state machine.
-- The longer transition recovery window starts only after that grant is
-- consumed and before the caller changes the upstream Auth factor set.
alter table private.admin_control_step_up_nonces
  drop constraint admin_control_step_up_nonces_intended_action_check;
alter table private.admin_control_step_up_nonces
  add constraint admin_control_step_up_nonces_intended_action_check check (
    intended_action in (
      'ai_pin_enroll',
      'ai_pin_rotate',
      'ai_pin_revoke',
      'ai_pin_reset',
      'environment_ai_policy_change',
      'totp_factor_add',
      'totp_factor_remove'
    )
  );

alter table private.admin_control_step_up_grants
  drop constraint admin_control_step_up_grants_intended_action_check;
alter table private.admin_control_step_up_grants
  add constraint admin_control_step_up_grants_intended_action_check check (
    intended_action in (
      'ai_pin_enroll',
      'ai_pin_rotate',
      'ai_pin_revoke',
      'ai_pin_reset',
      'environment_ai_policy_change',
      'totp_factor_add',
      'totp_factor_remove'
    )
  );

alter table private.admin_principals
  drop constraint admin_principals_approved_totp_factor_set_check;
alter table private.admin_principals
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
        'operator_adoption',
        'rare_control_transition'
      )
      and approved_totp_factor_set_actor is not null
      and char_length(approved_totp_factor_set_actor) between 3 and 160
      and approved_totp_factor_set_reason is not null
      and char_length(approved_totp_factor_set_reason) between 3 and 500
    )
  );

-- Never infer a trust decision for B2 browser state created before B2.2b.
-- Retain rows for audit/FK integrity, but make every pre-binding authority
-- dormant before adding nullable evidence columns.
update private.admin_ai_browser_assertion_challenges
set status = 'superseded', updated_at = statement_timestamp()
where status = 'pending';

update private.admin_ai_browser_enrollment_nonces
set status = 'superseded', updated_at = statement_timestamp()
where status = 'pending';

update private.admin_ai_browser_credentials
set
  status = 'revoked',
  revoked_at = statement_timestamp(),
  revoked_by_admin_session_id = enrolled_by_admin_session_id,
  revoke_reason = 'totp_binding_upgrade',
  updated_at = statement_timestamp()
where status = 'active';

alter table private.admin_ai_browser_enrollment_nonces
  add column approved_totp_factor_set_hash text check (
    approved_totp_factor_set_hash is null
    or approved_totp_factor_set_hash ~ '^[0-9a-f]{64}$'
  ),
  add column approved_totp_factor_set_version bigint check (
    approved_totp_factor_set_version is null
    or approved_totp_factor_set_version >= 1
  ),
  add column approved_totp_factor_count integer check (
    approved_totp_factor_count is null or approved_totp_factor_count >= 1
  ),
  add column supabase_auth_session_id uuid;

alter table private.admin_ai_browser_credentials
  add column approved_totp_factor_set_hash text check (
    approved_totp_factor_set_hash is null
    or approved_totp_factor_set_hash ~ '^[0-9a-f]{64}$'
  ),
  add column approved_totp_factor_set_version bigint check (
    approved_totp_factor_set_version is null
    or approved_totp_factor_set_version >= 1
  ),
  add column approved_totp_factor_count integer check (
    approved_totp_factor_count is null or approved_totp_factor_count >= 1
  ),
  add column supabase_auth_session_id uuid;

alter table private.admin_ai_browser_assertion_challenges
  add column approved_totp_factor_set_hash text check (
    approved_totp_factor_set_hash is null
    or approved_totp_factor_set_hash ~ '^[0-9a-f]{64}$'
  ),
  add column approved_totp_factor_set_version bigint check (
    approved_totp_factor_set_version is null
    or approved_totp_factor_set_version >= 1
  ),
  add column approved_totp_factor_count integer check (
    approved_totp_factor_count is null or approved_totp_factor_count >= 1
  ),
  add column supabase_auth_session_id uuid;

create index admin_ai_browser_enrollment_totp_binding_idx
  on private.admin_ai_browser_enrollment_nonces (
    principal_id,
    approved_totp_factor_set_version,
    status
  );
create index admin_ai_browser_credentials_totp_binding_idx
  on private.admin_ai_browser_credentials (
    principal_id,
    approved_totp_factor_set_version,
    status
  );
create index admin_ai_browser_assertion_totp_binding_idx
  on private.admin_ai_browser_assertion_challenges (
    principal_id,
    approved_totp_factor_set_version,
    status
  );

create table private.admin_totp_factor_transitions (
  id uuid primary key default extensions.gen_random_uuid(),
  mutation_request_id uuid not null unique,
  finalize_request_id uuid unique,
  intended_action text not null check (
    intended_action in ('totp_factor_add', 'totp_factor_remove')
  ),
  intent_digest text not null check (intent_digest ~ '^[0-9a-f]{64}$'),
  recovery_token_hash text not null check (
    recovery_token_hash ~ '^[0-9a-f]{64}$'
  ),
  target_factor_id uuid not null,
  environment_id uuid not null
    references private.admin_environments(id) on delete restrict,
  principal_id uuid not null
    references private.admin_principals(id) on delete restrict,
  membership_id uuid not null
    references private.admin_environment_memberships(id) on delete restrict,
  admin_session_id uuid not null
    references public.admin_sessions(id) on delete restrict,
  supabase_auth_session_id uuid not null,
  control_grant_id uuid not null unique
    references private.admin_control_step_up_grants(id) on delete restrict,
  approved_pre_hash text not null check (approved_pre_hash ~ '^[0-9a-f]{64}$'),
  approved_pre_version bigint not null check (approved_pre_version >= 1),
  approved_pre_count integer not null check (approved_pre_count >= 1),
  expected_post_hash text not null check (expected_post_hash ~ '^[0-9a-f]{64}$'),
  expected_post_count integer not null check (expected_post_count >= 1),
  finalized_post_version bigint check (
    finalized_post_version is null or finalized_post_version >= 2
  ),
  status text not null default 'authorized' check (
    status in ('authorized', 'finalized', 'expired')
  ),
  authorized_at timestamptz not null default statement_timestamp(),
  expires_at timestamptz not null,
  finalized_at timestamptz,
  updated_at timestamptz not null default statement_timestamp(),
  check (
    expires_at > authorized_at
    and expires_at <= authorized_at + interval '30 minutes'
  ),
  check (
    (
      status = 'finalized'
      and finalize_request_id is not null
      and finalized_post_version is not null
      and finalized_at is not null
    )
    or (
      status <> 'finalized'
      and finalize_request_id is null
      and finalized_post_version is null
      and finalized_at is null
    )
  )
);

create unique index admin_totp_factor_transition_authorized_principal_idx
  on private.admin_totp_factor_transitions (principal_id)
  where status = 'authorized';
-- The partial unique index enforces one live transition, but PostgreSQL RI
-- checks also need a full leading index for finalized/expired history.
create index admin_totp_factor_transition_principal_idx
  on private.admin_totp_factor_transitions (principal_id, status);
create index admin_totp_factor_transition_expiry_idx
  on private.admin_totp_factor_transitions (expires_at, id)
  where status = 'authorized';
create index admin_totp_factor_transition_environment_idx
  on private.admin_totp_factor_transitions (environment_id, status);
create index admin_totp_factor_transition_membership_idx
  on private.admin_totp_factor_transitions (membership_id, status);
create index admin_totp_factor_transition_session_idx
  on private.admin_totp_factor_transitions (admin_session_id, status);

alter table private.admin_totp_factor_transitions enable row level security;
revoke all on private.admin_totp_factor_transitions
  from public, anon, authenticated, service_role;

comment on table private.admin_totp_factor_transitions is
  'Durable one-time authorization created only after a fresh B2.2a control grant. It bridges an upstream Auth factor mutation without treating AMR as factor-ID proof.';

-- Retention must remove the transition before its referenced grant, and the
-- grant before its nonce. Keeping this in the existing facade also cleans up
-- inactive principals without waiting for a later factor mutation.
create or replace function private.cleanup_admin_control_step_up_ephemera_v1(
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
  expired_transitions integer := 0;
  deleted_transitions integer := 0;
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
    select transition.id
    from private.admin_totp_factor_transitions as transition
    where transition.status = 'authorized'
      and transition.expires_at <= effective_now
    order by transition.expires_at, transition.id
    for update of transition skip locked
    limit 500
  )
  update private.admin_totp_factor_transitions as transition
  set status = 'expired', updated_at = effective_now
  from candidates
  where transition.id = candidates.id;
  get diagnostics expired_transitions = row_count;

  -- Preserve the B2.2a completion lock order while terminal deletion below
  -- follows transition -> grant -> nonce foreign-key order.
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
    select control_grant.id
    from private.admin_control_step_up_grants as control_grant
    where control_grant.status = 'available'
      and control_grant.expires_at <= effective_now
    order by control_grant.expires_at, control_grant.id
    for update of control_grant skip locked
    limit 500
  )
  update private.admin_control_step_up_grants as control_grant
  set status = 'expired', updated_at = effective_now
  from candidates
  where control_grant.id = candidates.id;
  get diagnostics expired_grants = row_count;

  with candidates as (
    select transition.id
    from private.admin_totp_factor_transitions as transition
    where transition.status in ('finalized', 'expired')
      and transition.updated_at < target_retention_before
    order by transition.updated_at, transition.id
    for update of transition skip locked
    limit 500
  )
  delete from private.admin_totp_factor_transitions as transition
  using candidates
  where transition.id = candidates.id;
  get diagnostics deleted_transitions = row_count;

  with candidates as (
    select control_grant.id
    from private.admin_control_step_up_grants as control_grant
    where control_grant.status in ('consumed', 'superseded', 'expired')
      and control_grant.updated_at < target_retention_before
      and not exists (
        select 1
        from private.admin_totp_factor_transitions as transition
        where transition.control_grant_id = control_grant.id
      )
    order by control_grant.updated_at, control_grant.id
    for update of control_grant skip locked
    limit 500
  )
  delete from private.admin_control_step_up_grants as control_grant
  using candidates
  where control_grant.id = candidates.id;
  get diagnostics deleted_grants = row_count;

  with candidates as (
    select nonce.id
    from private.admin_control_step_up_nonces as nonce
    where nonce.status in ('consumed', 'superseded', 'expired')
      and nonce.updated_at < target_retention_before
      and not exists (
        select 1
        from private.admin_control_step_up_grants as control_grant
        where control_grant.control_nonce_id = nonce.id
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
      select 1 from private.admin_totp_factor_transitions as transition
      where transition.status = 'authorized'
        and transition.expires_at <= effective_now
    )
    or exists (
      select 1 from private.admin_totp_factor_transitions as transition
      where transition.status in ('finalized', 'expired')
        and transition.updated_at < target_retention_before
    )
    or exists (
      select 1 from private.admin_control_step_up_nonces as nonce
      where nonce.status = 'pending' and nonce.expires_at <= effective_now
    )
    or exists (
      select 1 from private.admin_control_step_up_grants as control_grant
      where control_grant.status = 'available'
        and control_grant.expires_at <= effective_now
    )
    or exists (
      select 1 from private.admin_control_step_up_grants as control_grant
      where control_grant.status in ('consumed', 'superseded', 'expired')
        and control_grant.updated_at < target_retention_before
        and not exists (
          select 1 from private.admin_totp_factor_transitions as transition
          where transition.control_grant_id = control_grant.id
        )
    )
    or exists (
      select 1 from private.admin_control_step_up_nonces as nonce
      where nonce.status in ('consumed', 'superseded', 'expired')
        and nonce.updated_at < target_retention_before
        and not exists (
          select 1 from private.admin_control_step_up_grants as control_grant
          where control_grant.control_nonce_id = nonce.id
        )
    )
  into has_more;

  insert into private.admin_audit_events (
    request_id, action, target_type, result, metadata
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
      'nonces_expired', expired_nonces,
      'transitions_deleted', deleted_transitions,
      'transitions_expired', expired_transitions
    )
  );

  return jsonb_build_object(
    'grants_deleted', deleted_grants,
    'grants_expired', expired_grants,
    'has_more', has_more,
    'nonces_deleted', deleted_nonces,
    'nonces_expired', expired_nonces,
    'transitions_deleted', deleted_transitions,
    'transitions_expired', expired_transitions
  );
end;
$$;

revoke all on function private.cleanup_admin_control_step_up_ephemera_v1(
  timestamptz, uuid
) from public, anon, authenticated, service_role;
grant execute on function private.cleanup_admin_control_step_up_ephemera_v1(
  timestamptz, uuid
) to service_role;

create function private.hash_verified_totp_factor_ids_v1(
  target_auth_user_id uuid,
  target_factor_ids uuid[]
)
returns text
language sql
immutable
security definer
set search_path = ''
set statement_timeout = '2s'
as $$
  select case
    when target_auth_user_id is null
      or target_factor_ids is null
      or cardinality(target_factor_ids) = 0
      or array_position(target_factor_ids, null) is not null
      or (
        select count(*) <> count(distinct factor_id)
        from unnest(target_factor_ids) as factor_id
      )
      then null
    else pg_catalog.encode(
      extensions.digest(
        pg_catalog.convert_to(
          'compass:phase7.30:verified-totp-factor-set:v1|user='
          || target_auth_user_id::text
          || '|factors='
          || (
            select pg_catalog.string_agg(factor_id::text, ',' order by factor_id::text)
            from unnest(target_factor_ids) as factor_id
          ),
          'UTF8'
        ),
        'sha256'
      ),
      'hex'
    )
  end;
$$;

revoke all on function private.hash_verified_totp_factor_ids_v1(uuid, uuid[])
  from public, anon, authenticated, service_role;

create function private.describe_admin_totp_factor_transition_v1(
  target_auth_user_id uuid,
  target_principal_id uuid,
  target_action text,
  target_factor_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
set statement_timeout = '2s'
as $$
declare
  principal_row private.admin_principals%rowtype;
  live_hash text;
  live_count integer;
  live_ids uuid[];
  expected_ids uuid[];
  target_status text;
  expected_hash text;
  expected_count integer;
  intent_digest text;
begin
  if target_auth_user_id is null
     or target_principal_id is null
     or target_action is null
     or target_action not in ('totp_factor_add', 'totp_factor_remove')
     or target_factor_id is null then
    raise exception 'invalid Admin TOTP transition description'
      using errcode = '22023';
  end if;

  select principal.*
  into principal_row
  from private.admin_principals as principal
  where principal.id = target_principal_id
    and principal.auth_user_id = target_auth_user_id
    and principal.status = 'active';
  if not found or principal_row.approved_totp_factor_set_hash is null then
    return null;
  end if;

  -- Keep the verified set, target status, count, and hash on one Auth-table
  -- statement snapshot. A split scalar snapshot followed by an ID scan could
  -- otherwise combine two different GoTrue factor-set states.
  select
    coalesce(
      pg_catalog.array_agg(factor.id order by factor.id::text)
        filter (where factor.status = 'verified'),
      array[]::uuid[]
    ),
    max(factor.status) filter (where factor.id = target_factor_id)
  into live_ids, target_status
  from auth.mfa_factors as factor
  where factor.user_id = target_auth_user_id
    and factor.factor_type = 'totp'
    and (
      factor.status = 'verified'
      or factor.id = target_factor_id
    );

  live_count := cardinality(live_ids);
  live_hash := private.hash_verified_totp_factor_ids_v1(
    target_auth_user_id,
    live_ids
  );
  if live_hash is distinct from principal_row.approved_totp_factor_set_hash
     or live_count <> principal_row.approved_totp_factor_count then
    return null;
  end if;

  if target_action = 'totp_factor_add' then
    if target_status is distinct from 'unverified'
       or target_factor_id = any(live_ids) then
      return null;
    end if;
    select pg_catalog.array_agg(candidate order by candidate::text)
    into expected_ids
    from unnest(
      live_ids || array[target_factor_id]
    ) as candidate;
  else
    if target_status is distinct from 'verified' or live_count < 2 then
      return null;
    end if;
    select pg_catalog.array_agg(candidate order by candidate::text)
    into expected_ids
    from unnest(live_ids) as candidate
    where candidate <> target_factor_id;
  end if;

  expected_count := cardinality(expected_ids);
  if expected_count < 1 then
    return null;
  end if;
  expected_hash := private.hash_verified_totp_factor_ids_v1(
    target_auth_user_id,
    expected_ids
  );
  intent_digest := private.hash_admin_control_intent_v1(
    'action=' || target_action
    || '|principal_id=' || principal_row.id::text
    || '|approved_pre_version='
      || principal_row.approved_totp_factor_set_version::text
    || '|approved_pre_hash=' || principal_row.approved_totp_factor_set_hash
    || '|target_factor_id=' || target_factor_id::text
    || '|expected_post_hash=' || expected_hash
    || '|expected_post_count=' || expected_count::text
  );

  return jsonb_build_object(
    'action', target_action,
    'approved_pre_count', principal_row.approved_totp_factor_count,
    'approved_pre_hash', principal_row.approved_totp_factor_set_hash,
    'approved_pre_version', principal_row.approved_totp_factor_set_version,
    'expected_post_count', expected_count,
    'expected_post_hash', expected_hash,
    'intent_digest', intent_digest,
    'target_factor_id', target_factor_id
  );
end;
$$;

revoke all on function private.describe_admin_totp_factor_transition_v1(
  uuid, uuid, text, uuid
) from public, anon, authenticated, service_role;

-- New B2.2b control actions share the B2.2a nonce/grant tables but use a
-- separate implementation so the already-reviewed PIN/policy paths remain
-- byte-for-byte unchanged.
create function private.begin_admin_totp_factor_control_step_up_v1(
  target_token_hash text,
  target_auth_user_id uuid,
  target_supabase_auth_session_id uuid,
  target_action text,
  target_mutation_request_id uuid,
  target_nonce_hash text,
  target_prechallenge_jwt_hash text,
  target_intent_digest text
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
  existing_nonce private.admin_control_step_up_nonces%rowtype;
  nonce_row private.admin_control_step_up_nonces%rowtype;
  effective_now timestamptz := statement_timestamp();
begin
  if target_action is null
     or target_action not in ('totp_factor_add', 'totp_factor_remove')
     or target_mutation_request_id is null
     or target_nonce_hash !~ '^[0-9a-f]{64}$'
     or target_prechallenge_jwt_hash !~ '^[0-9a-f]{64}$'
     or target_intent_digest !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid Admin TOTP factor control start'
      using errcode = '22023';
  end if;

  if not exists (
       select 1 from private.admin_identity_runtime_gate as gate
       where gate.singleton and gate.google_session_issue_enabled
     )
     or not exists (
       select 1 from private.admin_identity_runtime_gate as gate
       where gate.singleton and gate.totp_factor_mutation_enabled
     ) then
    raise exception 'Admin TOTP factor mutation is disabled'
      using errcode = 'P7331';
  end if;

  perform private.serialize_admin_ai_request_v1(target_mutation_request_id);
  context_value := private.require_admin_ai_context_v1(
    target_token_hash,
    target_auth_user_id,
    target_supabase_auth_session_id,
    null,
    false,
    false
  );
  if context_value is null then return null; end if;

  select nonce.* into existing_nonce
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
       and existing_nonce.intent_digest = target_intent_digest
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
    nonce_hash, environment_id, principal_id, membership_id,
    admin_session_id, supabase_auth_session_id,
    verified_totp_factor_set_hash, intended_action, intent_digest,
    mutation_request_id, prechallenge_jwt_hash, min_amr_at,
    issued_at, expires_at
  ) values (
    target_nonce_hash,
    (context_value ->> 'environment_id')::uuid,
    (context_value ->> 'principal_id')::uuid,
    (context_value ->> 'membership_id')::uuid,
    (context_value ->> 'admin_session_id')::uuid,
    target_supabase_auth_session_id,
    context_value ->> 'verified_totp_factor_set_hash',
    target_action,
    target_intent_digest,
    target_mutation_request_id,
    target_prechallenge_jwt_hash,
    effective_now,
    effective_now,
    effective_now + interval '5 minutes'
  ) returning * into nonce_row;

  insert into private.admin_audit_events (
    request_id, environment_id, actor_principal_id, actor_membership_id,
    actor_session_id, action, target_type, target_id, result, metadata
  ) values (
    target_mutation_request_id, nonce_row.environment_id,
    nonce_row.principal_id, nonce_row.membership_id, nonce_row.admin_session_id,
    'admin_totp_factor_control.begin', 'admin_control_step_up_nonce',
    nonce_row.id::text, 'accepted',
    jsonb_build_object('intended_action', target_action)
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

revoke all on function private.begin_admin_totp_factor_control_step_up_v1(
  text, uuid, uuid, text, uuid, text, text, text
) from public, anon, authenticated, service_role;

create function private.complete_admin_totp_factor_control_step_up_v1(
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
     or target_action not in ('totp_factor_add', 'totp_factor_remove')
     or target_intent_digest !~ '^[0-9a-f]{64}$'
     or target_mutation_request_id is null
     or target_nonce_hash !~ '^[0-9a-f]{64}$'
     or target_current_jwt_hash !~ '^[0-9a-f]{64}$'
     or target_current_jwt_iat is null
     or target_totp_amr_method is null
     or target_totp_amr_method not in ('totp', 'mfa/totp')
     or target_totp_amr_at is null then
    raise exception 'invalid Admin TOTP factor control completion'
      using errcode = '22023';
  end if;

  if not exists (
       select 1 from private.admin_identity_runtime_gate as gate
       where gate.singleton and gate.google_session_issue_enabled
     )
     or not exists (
       select 1 from private.admin_identity_runtime_gate as gate
       where gate.singleton and gate.totp_factor_mutation_enabled
     ) then
    raise exception 'Admin TOTP factor mutation is disabled'
      using errcode = 'P7331';
  end if;

  perform private.serialize_admin_ai_request_v1(target_mutation_request_id);
  select nonce.* into nonce_snapshot
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
    false,
    false
  );
  if context_value is null then return null; end if;

  select nonce.* into nonce_row
  from private.admin_control_step_up_nonces as nonce
  where nonce.id = nonce_snapshot.id
    and nonce.nonce_hash = target_nonce_hash
    and nonce.mutation_request_id = target_mutation_request_id
    and nonce.intended_action = target_action
    and nonce.intent_digest = target_intent_digest
  for update;
  if not found then return null; end if;

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
    select control_grant.* into grant_row
    from private.admin_control_step_up_grants as control_grant
    where control_grant.control_nonce_id = nonce_row.id
      and control_grant.mutation_request_id = target_mutation_request_id
      and control_grant.intended_action = target_action
      and control_grant.intent_digest = target_intent_digest
      and control_grant.completion_jwt_hash = target_current_jwt_hash
      and control_grant.verified_totp_amr_at is not distinct from target_totp_amr_at;
    if not found then return null; end if;
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

  select session.* into session_row
  from public.admin_sessions as session
  where session.id = nonce_row.admin_session_id
    and session.revoked_at is null
  for update;
  if not found then return null; end if;

  grant_expires_at := least(
    nonce_row.expires_at,
    target_totp_amr_at + interval '5 minutes',
    session_row.expires_at
  );
  if grant_expires_at <= effective_now then return null; end if;

  insert into private.admin_control_step_up_grants (
    source_kind, control_nonce_id, environment_id, principal_id,
    membership_id, admin_session_id, supabase_auth_session_id,
    verified_totp_factor_set_hash, intended_action, intent_digest,
    mutation_request_id, prechallenge_jwt_hash, completion_jwt_hash,
    min_amr_at, verified_totp_amr_at, issued_at, expires_at
  ) values (
    'control', nonce_row.id, nonce_row.environment_id,
    nonce_row.principal_id, nonce_row.membership_id, nonce_row.admin_session_id,
    nonce_row.supabase_auth_session_id, nonce_row.verified_totp_factor_set_hash,
    nonce_row.intended_action, nonce_row.intent_digest,
    nonce_row.mutation_request_id, nonce_row.prechallenge_jwt_hash,
    target_current_jwt_hash, nonce_row.min_amr_at, target_totp_amr_at,
    effective_now, grant_expires_at
  ) returning * into grant_row;

  update private.admin_control_step_up_nonces
  set status = 'consumed', consumed_at = effective_now,
      completed_grant_id = grant_row.id, updated_at = effective_now
  where id = nonce_row.id;

  update public.admin_sessions
  set step_up_verified_at = target_totp_amr_at, updated_at = effective_now
  where id = nonce_row.admin_session_id;

  insert into private.admin_audit_events (
    request_id, environment_id, actor_principal_id, actor_membership_id,
    actor_session_id, action, target_type, target_id, result, metadata
  ) values (
    target_mutation_request_id, grant_row.environment_id,
    grant_row.principal_id, grant_row.membership_id, grant_row.admin_session_id,
    'admin_totp_factor_control.complete', 'admin_control_step_up_grant',
    grant_row.id::text, 'accepted',
    jsonb_build_object('intended_action', target_action, 'source_kind', 'control')
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

revoke all on function private.complete_admin_totp_factor_control_step_up_v1(
  text, uuid, uuid, text, text, uuid, text, text, timestamptz, text, timestamptz
) from public, anon, authenticated, service_role;

create or replace function public.begin_admin_control_step_up_v1(
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
security invoker
set search_path = ''
as $$
begin
  if target_action in ('totp_factor_add', 'totp_factor_remove') then
    return private.begin_admin_totp_factor_control_step_up_v1(
      target_token_hash, target_auth_user_id, target_supabase_auth_session_id,
      target_action, target_mutation_request_id, target_nonce_hash,
      target_prechallenge_jwt_hash, target_intent_digest
    );
  end if;
  return private.begin_admin_control_step_up_v1(
    target_token_hash, target_auth_user_id, target_supabase_auth_session_id,
    target_action, target_mutation_request_id, target_nonce_hash,
    target_prechallenge_jwt_hash, target_intent_digest
  );
end;
$$;

create or replace function public.complete_admin_control_step_up_v1(
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
security invoker
set search_path = ''
as $$
begin
  if target_action in ('totp_factor_add', 'totp_factor_remove') then
    return private.complete_admin_totp_factor_control_step_up_v1(
      target_token_hash, target_auth_user_id, target_supabase_auth_session_id,
      target_action, target_intent_digest, target_mutation_request_id,
      target_nonce_hash, target_current_jwt_hash, target_current_jwt_iat,
      target_totp_amr_method, target_totp_amr_at
    );
  end if;
  return private.complete_admin_control_step_up_v1(
    target_token_hash, target_auth_user_id, target_supabase_auth_session_id,
    target_action, target_intent_digest, target_mutation_request_id,
    target_nonce_hash, target_current_jwt_hash, target_current_jwt_iat,
    target_totp_amr_method, target_totp_amr_at
  );
end;
$$;

create function private.get_admin_totp_factor_transition_intent_v1(
  target_token_hash text,
  target_auth_user_id uuid,
  target_supabase_auth_session_id uuid,
  target_action text,
  target_factor_id uuid
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
  description_value jsonb;
  transition_expires_at timestamptz;
begin
  if target_action is null
     or target_action not in ('totp_factor_add', 'totp_factor_remove')
     or target_factor_id is null then
    raise exception 'invalid Admin TOTP factor transition intent'
      using errcode = '22023';
  end if;
  if not exists (
    select 1
    from private.admin_identity_runtime_gate as gate
    where gate.singleton
      and gate.google_session_issue_enabled
      and gate.totp_factor_mutation_enabled
  ) then
    raise exception 'Admin TOTP factor mutation is disabled'
      using errcode = 'P7331';
  end if;

  context_value := private.require_admin_ai_context_v1(
    target_token_hash,
    target_auth_user_id,
    target_supabase_auth_session_id,
    null,
    false,
    false
  );
  if context_value is null then return null; end if;

  select least(
    statement_timestamp() + interval '30 minutes',
    app_session.expires_at,
    auth_session.created_at + interval '8 hours'
  ) into transition_expires_at
  from public.admin_sessions as app_session
  join auth.sessions as auth_session
    on auth_session.id = app_session.supabase_auth_session_id
   and auth_session.user_id = app_session.auth_user_id
  where app_session.id = (context_value ->> 'admin_session_id')::uuid
    and app_session.token_hash = target_token_hash
    and app_session.auth_user_id = target_auth_user_id
    and app_session.supabase_auth_session_id = target_supabase_auth_session_id
    and app_session.revoked_at is null
    and auth_session.user_id = target_auth_user_id
  for key share of auth_session;
  if transition_expires_at is null
     or transition_expires_at <= statement_timestamp() + interval '5 minutes' then
    raise exception 'Admin Auth session has insufficient recovery lifetime'
      using errcode = 'P7334';
  end if;

  description_value := private.describe_admin_totp_factor_transition_v1(
    target_auth_user_id,
    (context_value ->> 'principal_id')::uuid,
    target_action,
    target_factor_id
  );
  if description_value is null then return null; end if;

  -- Hashes remain server-side trust anchors. The browser needs only the
  -- canonical digest and bounded, non-secret operation metadata.
  return jsonb_build_object(
    'action', description_value ->> 'action',
    'approved_pre_version',
      (description_value ->> 'approved_pre_version')::bigint,
    'expected_post_count',
      (description_value ->> 'expected_post_count')::integer,
    'intent_digest', description_value ->> 'intent_digest',
    'recovery_expires_at', transition_expires_at,
    'target_factor_id', description_value ->> 'target_factor_id'
  );
end;
$$;

revoke all on function private.get_admin_totp_factor_transition_intent_v1(
  text, uuid, uuid, text, uuid
) from public, anon, authenticated, service_role;

create function private.authorize_admin_totp_factor_transition_v1(
  target_token_hash text,
  target_auth_user_id uuid,
  target_supabase_auth_session_id uuid,
  target_action text,
  target_factor_id uuid,
  target_intent_digest text,
  target_recovery_token_hash text,
  target_mutation_request_id uuid
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
  description_value jsonb;
  existing_transition private.admin_totp_factor_transitions%rowtype;
  transition_row private.admin_totp_factor_transitions%rowtype;
  grant_row private.admin_control_step_up_grants%rowtype;
  session_row public.admin_sessions%rowtype;
  transition_expires_at timestamptz;
  effective_now timestamptz := statement_timestamp();
begin
  if target_action is null
     or target_action not in ('totp_factor_add', 'totp_factor_remove')
     or target_factor_id is null
     or target_intent_digest !~ '^[0-9a-f]{64}$'
     or target_recovery_token_hash !~ '^[0-9a-f]{64}$'
     or target_mutation_request_id is null then
    raise exception 'invalid Admin TOTP factor transition authorization'
      using errcode = '22023';
  end if;

  perform private.serialize_admin_ai_request_v1(target_mutation_request_id);
  select transition.* into existing_transition
  from private.admin_totp_factor_transitions as transition
  where transition.mutation_request_id = target_mutation_request_id
  for update;

  if found then
    select session.* into session_row
    from public.admin_sessions as session
    where session.id = existing_transition.admin_session_id
      and session.token_hash = target_token_hash
      and session.auth_user_id = target_auth_user_id
      and session.supabase_auth_session_id = target_supabase_auth_session_id;
    if not found
       or existing_transition.intended_action <> target_action
       or existing_transition.target_factor_id <> target_factor_id
       or existing_transition.intent_digest <> target_intent_digest
       or existing_transition.recovery_token_hash <>
         target_recovery_token_hash then
      return null;
    end if;
    if existing_transition.status = 'authorized'
       and existing_transition.expires_at <= effective_now then
      update private.admin_totp_factor_transitions
      set status = 'expired', updated_at = effective_now
      where id = existing_transition.id and status = 'authorized'
      returning * into existing_transition;
    end if;
    return jsonb_build_object(
      'action', existing_transition.intended_action,
      'expires_at', existing_transition.expires_at,
      'intent_digest', existing_transition.intent_digest,
      'request_id', existing_transition.mutation_request_id,
      'status', existing_transition.status,
      'target_factor_id', existing_transition.target_factor_id,
      'transition_id', existing_transition.id
    );
  end if;

  if not exists (
    select 1
    from private.admin_identity_runtime_gate as gate
    where gate.singleton
      and gate.google_session_issue_enabled
      and gate.totp_factor_mutation_enabled
  ) then
    raise exception 'Admin TOTP factor mutation is disabled'
      using errcode = 'P7331';
  end if;

  context_value := private.require_admin_ai_context_v1(
    target_token_hash,
    target_auth_user_id,
    target_supabase_auth_session_id,
    null,
    false,
    false
  );
  if context_value is null then return null; end if;

  description_value := private.describe_admin_totp_factor_transition_v1(
    target_auth_user_id,
    (context_value ->> 'principal_id')::uuid,
    target_action,
    target_factor_id
  );
  if description_value is null
     or description_value ->> 'intent_digest' <> target_intent_digest then
    return null;
  end if;

  select least(
    effective_now + interval '30 minutes',
    app_session.expires_at,
    auth_session.created_at + interval '8 hours'
  ) into transition_expires_at
  from public.admin_sessions as app_session
  join auth.sessions as auth_session
    on auth_session.id = app_session.supabase_auth_session_id
   and auth_session.user_id = app_session.auth_user_id
  where app_session.id = (context_value ->> 'admin_session_id')::uuid
    and app_session.token_hash = target_token_hash
    and app_session.auth_user_id = target_auth_user_id
    and app_session.supabase_auth_session_id = target_supabase_auth_session_id
    and app_session.revoked_at is null
    and auth_session.user_id = target_auth_user_id
  for key share of auth_session;
  if transition_expires_at is null
     or transition_expires_at <= effective_now + interval '5 minutes' then
    raise exception 'Admin Auth session has insufficient recovery lifetime'
      using errcode = 'P7334';
  end if;

  if not private.try_serialize_admin_ai_scope_v1(
    'totp-factor-transition-principal',
    (context_value ->> 'principal_id')::uuid
  ) then
    -- A concurrent factor transition owns this principal. Return a bounded
    -- busy result before locking or consuming this request's control grant.
    return null;
  end if;
  update private.admin_totp_factor_transitions
  set status = 'expired', updated_at = effective_now
  where principal_id = (context_value ->> 'principal_id')::uuid
    and status = 'authorized'
    and expires_at <= effective_now;

  -- Opportunistic bounded retention keeps lost-client transitions from
  -- accumulating without introducing a paid scheduler dependency.
  delete from private.admin_totp_factor_transitions as transition
  where transition.id in (
    select cleanup_candidate.id
    from private.admin_totp_factor_transitions as cleanup_candidate
    where cleanup_candidate.principal_id =
        (context_value ->> 'principal_id')::uuid
      and cleanup_candidate.status in ('expired', 'finalized')
      and cleanup_candidate.updated_at < effective_now - interval '30 days'
    order by cleanup_candidate.updated_at, cleanup_candidate.id
    limit 25
  );
  if exists (
    select 1
    from private.admin_totp_factor_transitions as transition
    where transition.principal_id = (context_value ->> 'principal_id')::uuid
      and transition.status = 'authorized'
  ) then
    -- Do not consume the competing grant. The existing transition remains the
    -- sole recovery path until it finalizes or reaches its bounded expiry.
    return null;
  end if;

  select control_grant.* into grant_row
  from private.admin_control_step_up_grants as control_grant
  where control_grant.mutation_request_id = target_mutation_request_id
    and control_grant.source_kind = 'control'
    and control_grant.intended_action = target_action
    and control_grant.intent_digest = target_intent_digest
    and control_grant.environment_id = (context_value ->> 'environment_id')::uuid
    and control_grant.principal_id = (context_value ->> 'principal_id')::uuid
    and control_grant.membership_id = (context_value ->> 'membership_id')::uuid
    and control_grant.admin_session_id = (context_value ->> 'admin_session_id')::uuid
    and control_grant.supabase_auth_session_id = target_supabase_auth_session_id
    and control_grant.verified_totp_factor_set_hash =
      description_value ->> 'approved_pre_hash'
  for update;
  if not found
     or grant_row.status <> 'available'
     or grant_row.expires_at <= effective_now then
    return null;
  end if;

  update private.admin_control_step_up_grants
  set status = 'consumed', consumed_at = effective_now, updated_at = effective_now
  where id = grant_row.id and status = 'available'
  returning * into grant_row;
  if not found then return null; end if;

  insert into private.admin_totp_factor_transitions (
    mutation_request_id, intended_action, intent_digest,
    recovery_token_hash, target_factor_id,
    environment_id, principal_id, membership_id, admin_session_id,
    supabase_auth_session_id, control_grant_id,
    approved_pre_hash, approved_pre_version, approved_pre_count,
    expected_post_hash, expected_post_count,
    authorized_at, expires_at
  ) values (
    target_mutation_request_id,
    target_action,
    target_intent_digest,
    target_recovery_token_hash,
    target_factor_id,
    (context_value ->> 'environment_id')::uuid,
    (context_value ->> 'principal_id')::uuid,
    (context_value ->> 'membership_id')::uuid,
    (context_value ->> 'admin_session_id')::uuid,
    target_supabase_auth_session_id,
    grant_row.id,
    description_value ->> 'approved_pre_hash',
    (description_value ->> 'approved_pre_version')::bigint,
    (description_value ->> 'approved_pre_count')::integer,
    description_value ->> 'expected_post_hash',
    (description_value ->> 'expected_post_count')::integer,
    effective_now,
    transition_expires_at
  ) returning * into transition_row;

  insert into private.admin_audit_events (
    request_id, environment_id, actor_principal_id, actor_membership_id,
    actor_session_id, action, target_type, target_id, result, metadata
  ) values (
    target_mutation_request_id, transition_row.environment_id,
    transition_row.principal_id, transition_row.membership_id,
    transition_row.admin_session_id,
    'admin_totp_factor_transition.authorize',
    'admin_totp_factor_transition', transition_row.id::text, 'accepted',
    jsonb_build_object(
      'approved_pre_version', transition_row.approved_pre_version,
      'expected_post_count', transition_row.expected_post_count,
      'intended_action', transition_row.intended_action
    )
  );

  return jsonb_build_object(
    'action', transition_row.intended_action,
    'expires_at', transition_row.expires_at,
    'intent_digest', transition_row.intent_digest,
    'request_id', transition_row.mutation_request_id,
    'status', transition_row.status,
    'target_factor_id', transition_row.target_factor_id,
    'transition_id', transition_row.id
  );
end;
$$;

revoke all on function private.authorize_admin_totp_factor_transition_v1(
  text, uuid, uuid, text, uuid, text, text, uuid
) from public, anon, authenticated, service_role;

create function private.finalize_admin_totp_factor_transition_v1(
  target_recovery_token_hash text,
  target_auth_user_id uuid,
  target_supabase_auth_session_id uuid,
  target_action text,
  target_factor_id uuid,
  target_intent_digest text,
  target_mutation_request_id uuid,
  target_finalize_request_id uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
set statement_timeout = '8s'
set lock_timeout = '750ms'
as $$
declare
  transition_snapshot private.admin_totp_factor_transitions%rowtype;
  transition_row private.admin_totp_factor_transitions%rowtype;
  principal_row private.admin_principals%rowtype;
  membership_row private.admin_environment_memberships%rowtype;
  session_row public.admin_sessions%rowtype;
  live_hash text;
  live_count integer;
  next_version bigint;
  candidate record;
  revoked_sessions integer := 0;
  revoked_credentials integer := 0;
  auth_session_found boolean := false;
  effective_now timestamptz := statement_timestamp();
begin
  if target_action is null
     or target_action not in ('totp_factor_add', 'totp_factor_remove')
     or target_factor_id is null
     or target_intent_digest !~ '^[0-9a-f]{64}$'
     or target_recovery_token_hash !~ '^[0-9a-f]{64}$'
     or target_mutation_request_id is null
     or target_finalize_request_id is null then
    raise exception 'invalid Admin TOTP factor transition finalization'
      using errcode = '22023';
  end if;

  perform private.serialize_admin_ai_request_v1(target_mutation_request_id);
  select transition.* into transition_snapshot
  from private.admin_totp_factor_transitions as transition
  where transition.mutation_request_id = target_mutation_request_id;
  if not found
     or transition_snapshot.intended_action <> target_action
     or transition_snapshot.target_factor_id <> target_factor_id
     or transition_snapshot.intent_digest <> target_intent_digest
     or transition_snapshot.recovery_token_hash <>
       target_recovery_token_hash then
    return null;
  end if;

  -- A committed exact replay is immutable and gate-independent. Returning it
  -- from the nonlocking snapshot also avoids reacquiring identity locks after
  -- the successful transition has intentionally revoked its old app session.
  if transition_snapshot.status = 'finalized' then
    if transition_snapshot.finalize_request_id <> target_finalize_request_id
       or not exists (
         select 1 from public.admin_sessions as session
         where session.id = transition_snapshot.admin_session_id
           and session.auth_user_id = target_auth_user_id
           and session.supabase_auth_session_id = target_supabase_auth_session_id
       ) then
      return null;
    end if;
    return jsonb_build_object(
      'action', transition_snapshot.intended_action,
      'approved_factor_count', transition_snapshot.expected_post_count,
      'approved_factor_set_version', transition_snapshot.finalized_post_version,
      'finalized_at', transition_snapshot.finalized_at,
      'request_id', transition_snapshot.mutation_request_id,
      'status', transition_snapshot.status,
      'target_factor_id', transition_snapshot.target_factor_id,
      'transition_id', transition_snapshot.id
    );
  end if;

  -- Canonical order shared with authorize/context: principal -> membership ->
  -- app/Auth session -> principal advisory -> transition. The initial snapshot
  -- discovers immutable IDs only and never owns a row lock.
  select principal.* into principal_row
  from private.admin_principals as principal
  where principal.id = transition_snapshot.principal_id
    and principal.auth_user_id = target_auth_user_id
  for update;
  if not found then return null; end if;

  select membership.* into membership_row
  from private.admin_environment_memberships as membership
  where membership.id = transition_snapshot.membership_id
    and membership.environment_id = transition_snapshot.environment_id
    and membership.principal_id = transition_snapshot.principal_id
  for update;
  if not found then return null; end if;

  select session.* into session_row
  from public.admin_sessions as session
  where session.id = transition_snapshot.admin_session_id
    and session.environment_id = transition_snapshot.environment_id
    and session.principal_id = transition_snapshot.principal_id
    and session.membership_id = transition_snapshot.membership_id
    and session.auth_user_id = target_auth_user_id
    and session.supabase_auth_session_id = target_supabase_auth_session_id
  for update;
  if not found then return null; end if;

  perform 1
  from auth.sessions as auth_session
  where auth_session.id = target_supabase_auth_session_id
    and auth_session.user_id = target_auth_user_id
    and auth_session.created_at + interval '8 hours' > effective_now
  for key share;
  auth_session_found := found;

  perform private.serialize_admin_ai_scope_v1(
    'totp-factor-transition-principal',
    transition_snapshot.principal_id
  );

  select transition.* into transition_row
  from private.admin_totp_factor_transitions as transition
  where transition.id = transition_snapshot.id
    and transition.mutation_request_id = target_mutation_request_id
    and transition.intended_action = target_action
    and transition.target_factor_id = target_factor_id
    and transition.intent_digest = target_intent_digest
    and transition.recovery_token_hash = target_recovery_token_hash
    and transition.environment_id = transition_snapshot.environment_id
    and transition.principal_id = transition_snapshot.principal_id
    and transition.membership_id = transition_snapshot.membership_id
    and transition.admin_session_id = transition_snapshot.admin_session_id
    and transition.supabase_auth_session_id = target_supabase_auth_session_id
  for update;
  if not found then return null; end if;

  if transition_row.status = 'finalized' then
    if transition_row.finalize_request_id <> target_finalize_request_id then
      return null;
    end if;
    return jsonb_build_object(
      'action', transition_row.intended_action,
      'approved_factor_count', transition_row.expected_post_count,
      'approved_factor_set_version', transition_row.finalized_post_version,
      'finalized_at', transition_row.finalized_at,
      'request_id', transition_row.mutation_request_id,
      'status', transition_row.status,
      'target_factor_id', transition_row.target_factor_id,
      'transition_id', transition_row.id
    );
  end if;

  if transition_row.status <> 'authorized'
     or transition_row.expires_at <= effective_now then
    if transition_row.status = 'authorized' then
      update private.admin_totp_factor_transitions
      set status = 'expired', updated_at = effective_now
      where id = transition_row.id and status = 'authorized';
    end if;
    return null;
  end if;

  if not auth_session_found
     or session_row.expires_at <= effective_now
     or (
       session_row.revoked_at is not null
       and session_row.revoke_reason <> 'totp_factor_set_changed'
     )
     or principal_row.status <> 'active'
     or principal_row.approved_totp_factor_set_hash <>
       transition_row.approved_pre_hash
     or principal_row.approved_totp_factor_set_version <>
       transition_row.approved_pre_version
     or principal_row.approved_totp_factor_count <>
       transition_row.approved_pre_count
     or membership_row.status <> 'active'
     or (
       membership_row.expires_at is not null
       and membership_row.expires_at <= effective_now
     ) then
    return null;
  end if;

  select snapshot.factor_set_hash, snapshot.factor_count
  into live_hash, live_count
  from private.current_verified_totp_factor_set_snapshot_v1(
    target_auth_user_id
  ) as snapshot;
  if live_hash is distinct from transition_row.expected_post_hash
     or live_count <> transition_row.expected_post_count
     or (target_action = 'totp_factor_remove' and live_count < 1) then
    return null;
  end if;

  next_version := principal_row.approved_totp_factor_set_version + 1;
  update private.admin_principals
  set
    approved_totp_factor_set_hash = transition_row.expected_post_hash,
    approved_totp_factor_set_version = next_version,
    approved_totp_factor_count = transition_row.expected_post_count,
    approved_totp_factor_set_at = effective_now,
    approved_totp_factor_set_request_id = target_mutation_request_id,
    approved_totp_factor_set_source = 'rare_control_transition',
    approved_totp_factor_set_actor =
      'admin-session:' || transition_row.admin_session_id::text,
    approved_totp_factor_set_reason = case
      when target_action = 'totp_factor_add' then 'approved_totp_factor_added'
      else 'approved_totp_factor_removed'
    end
  where id = principal_row.id
    and approved_totp_factor_set_version = transition_row.approved_pre_version;
  if not found then return null; end if;

  -- Principal -> membership -> app-session UUID order. Every session is old
  -- authority after the approved version changes, including the actor.
  for candidate in
    select session.id
    from public.admin_sessions as session
    where session.authentication_method = 'google_totp'
      and session.principal_id = transition_row.principal_id
      and session.revoked_at is null
    order by session.id
  loop
    update public.admin_sessions
    set revoked_at = effective_now,
        revoke_reason = 'totp_factor_set_changed',
        updated_at = effective_now
    where id = candidate.id and revoked_at is null;
    if found then revoked_sessions := revoked_sessions + 1; end if;
  end loop;

  -- Credentials issued by an already-revoked session are also old authority.
  update private.admin_ai_browser_assertion_challenges
  set status = 'superseded', updated_at = effective_now
  where principal_id = transition_row.principal_id and status = 'pending';
  update private.admin_ai_browser_enrollment_nonces
  set status = 'superseded', updated_at = effective_now
  where principal_id = transition_row.principal_id and status = 'pending';
  update private.admin_ai_browser_credentials
  set status = 'revoked', revoked_at = effective_now,
      revoked_by_admin_session_id = transition_row.admin_session_id,
      revoke_reason = 'totp_factor_set_changed', updated_at = effective_now
  where principal_id = transition_row.principal_id and status = 'active';
  get diagnostics revoked_credentials = row_count;

  update private.admin_control_step_up_nonces
  set status = 'superseded', updated_at = effective_now
  where principal_id = transition_row.principal_id and status = 'pending';
  update private.admin_control_step_up_grants
  set status = 'superseded', updated_at = effective_now
  where principal_id = transition_row.principal_id and status = 'available';

  update private.admin_totp_factor_transitions
  set status = 'finalized', finalize_request_id = target_finalize_request_id,
      finalized_post_version = next_version, finalized_at = effective_now,
      updated_at = effective_now
  where id = transition_row.id and status = 'authorized'
  returning * into transition_row;
  if not found then return null; end if;

  insert into private.admin_audit_events (
    request_id, environment_id, actor_principal_id, actor_membership_id,
    actor_session_id, action, target_type, target_id, result, metadata
  ) values (
    target_finalize_request_id, transition_row.environment_id,
    transition_row.principal_id, transition_row.membership_id,
    transition_row.admin_session_id,
    'admin_totp_factor_transition.finalize',
    'admin_totp_factor_transition', transition_row.id::text, 'accepted',
    jsonb_build_object(
      'approved_factor_count', transition_row.expected_post_count,
      'approved_factor_set_version', next_version,
      'browser_credentials_revoked', revoked_credentials,
      'intended_action', transition_row.intended_action,
      'sessions_revoked', revoked_sessions
    )
  );

  return jsonb_build_object(
    'action', transition_row.intended_action,
    'approved_factor_count', transition_row.expected_post_count,
    'approved_factor_set_version', next_version,
    'finalized_at', transition_row.finalized_at,
    'request_id', transition_row.mutation_request_id,
    'status', transition_row.status,
    'target_factor_id', transition_row.target_factor_id,
    'transition_id', transition_row.id
  );
end;
$$;

revoke all on function private.finalize_admin_totp_factor_transition_v1(
  text, uuid, uuid, text, uuid, text, uuid, uuid
) from public, anon, authenticated, service_role;

create function private.bind_admin_ai_browser_totp_context_v1()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
set statement_timeout = '3s'
set lock_timeout = '750ms'
as $$
declare
  principal_row private.admin_principals%rowtype;
  session_row public.admin_sessions%rowtype;
  enrollment_row private.admin_ai_browser_enrollment_nonces%rowtype;
  credential_row private.admin_ai_browser_credentials%rowtype;
  live_hash text;
  live_count integer;
begin
  if tg_op = 'UPDATE' then
    if new.approved_totp_factor_set_hash is distinct from
         old.approved_totp_factor_set_hash
       or new.approved_totp_factor_set_version is distinct from
         old.approved_totp_factor_set_version
       or new.approved_totp_factor_count is distinct from
         old.approved_totp_factor_count
       or new.supabase_auth_session_id is distinct from
         old.supabase_auth_session_id then
      raise exception 'remembered-browser TOTP binding is immutable'
        using errcode = 'P7330';
    end if;
    return new;
  end if;

  if tg_table_name = 'admin_ai_browser_enrollment_nonces' then
    select principal.* into principal_row
    from private.admin_principals as principal
    where principal.id = new.principal_id
      and principal.status = 'active'
      and principal.approved_totp_factor_set_hash is not null
    for share;
    if not found then
      raise exception 'approved TOTP factor set not found'
        using errcode = 'P7332';
    end if;
    select session.* into session_row
    from public.admin_sessions as session
    where session.id = new.admin_session_id
      and session.principal_id = new.principal_id
      and session.membership_id = new.membership_id
      and session.environment_id = new.environment_id
      and session.authentication_method = 'google_totp'
      and session.aal = 2
      and session.revoked_at is null
      and session.verified_totp_factor_set_hash =
        principal_row.approved_totp_factor_set_hash
    for share;
    if not found then
      raise exception 'Admin session TOTP binding mismatch'
        using errcode = 'P7330';
    end if;
    select snapshot.factor_set_hash, snapshot.factor_count
    into live_hash, live_count
    from private.current_verified_totp_factor_set_snapshot_v1(
      principal_row.auth_user_id
    ) as snapshot;
    if live_hash is distinct from principal_row.approved_totp_factor_set_hash
       or live_count <> principal_row.approved_totp_factor_count then
      raise exception 'live TOTP factor set mismatch'
        using errcode = 'P7330';
    end if;
    new.approved_totp_factor_set_hash :=
      principal_row.approved_totp_factor_set_hash;
    new.approved_totp_factor_set_version :=
      principal_row.approved_totp_factor_set_version;
    new.approved_totp_factor_count := principal_row.approved_totp_factor_count;
    new.supabase_auth_session_id := session_row.supabase_auth_session_id;
    return new;
  end if;

  if tg_table_name = 'admin_ai_browser_credentials' then
    select nonce.* into enrollment_row
    from private.admin_ai_browser_enrollment_nonces as nonce
    where nonce.id = new.enrollment_nonce_id
      and nonce.reserved_browser_credential_id = new.id
      and nonce.admin_session_id = new.enrolled_by_admin_session_id
      and nonce.environment_id = new.environment_id
      and nonce.principal_id = new.principal_id
      and nonce.membership_id = new.membership_id
      and nonce.factor_id = new.source_factor_id
      and nonce.factor_version = new.source_factor_version
      and nonce.approved_totp_factor_set_hash is not null
      and nonce.approved_totp_factor_set_version is not null
      and nonce.approved_totp_factor_count is not null
      and nonce.supabase_auth_session_id is not null;
    if not found then
      raise exception 'remembered-browser enrollment binding mismatch'
        using errcode = 'P7330';
    end if;
    select principal.* into principal_row
    from private.admin_principals as principal
    where principal.id = new.principal_id
      and principal.status = 'active'
      and principal.approved_totp_factor_set_hash =
        enrollment_row.approved_totp_factor_set_hash
      and principal.approved_totp_factor_set_version =
        enrollment_row.approved_totp_factor_set_version
      and principal.approved_totp_factor_count =
        enrollment_row.approved_totp_factor_count
    for share;
    if not found then
      raise exception 'remembered-browser approved factor binding mismatch'
        using errcode = 'P7330';
    end if;
    select session.* into session_row
    from public.admin_sessions as session
    where session.id = new.enrolled_by_admin_session_id
      and session.supabase_auth_session_id =
        enrollment_row.supabase_auth_session_id
      and session.verified_totp_factor_set_hash =
        enrollment_row.approved_totp_factor_set_hash
      and session.revoked_at is null;
    if not found then
      raise exception 'remembered-browser session binding mismatch'
        using errcode = 'P7330';
    end if;
    select snapshot.factor_set_hash, snapshot.factor_count
    into live_hash, live_count
    from private.current_verified_totp_factor_set_snapshot_v1(
      principal_row.auth_user_id
    ) as snapshot;
    if live_hash is distinct from principal_row.approved_totp_factor_set_hash
       or live_count <> principal_row.approved_totp_factor_count then
      raise exception 'live TOTP factor set mismatch'
        using errcode = 'P7330';
    end if;
    new.approved_totp_factor_set_hash :=
      enrollment_row.approved_totp_factor_set_hash;
    new.approved_totp_factor_set_version :=
      enrollment_row.approved_totp_factor_set_version;
    new.approved_totp_factor_count := enrollment_row.approved_totp_factor_count;
    new.supabase_auth_session_id := enrollment_row.supabase_auth_session_id;
    return new;
  end if;

  if tg_table_name = 'admin_ai_browser_assertion_challenges' then
    select credential.* into credential_row
    from private.admin_ai_browser_credentials as credential
    where credential.id = new.browser_credential_id
      and credential.environment_id = new.environment_id
      and credential.principal_id = new.principal_id
      and credential.membership_id = new.membership_id
      and credential.source_factor_id = new.factor_id
      and credential.source_factor_version = new.factor_version
      and credential.status = 'active'
      and credential.expires_at > statement_timestamp()
      and credential.approved_totp_factor_set_hash is not null
      and credential.approved_totp_factor_set_version is not null
      and credential.approved_totp_factor_count is not null
      and credential.supabase_auth_session_id is not null;
    if not found then
      raise exception 'remembered-browser credential binding mismatch'
        using errcode = 'P7330';
    end if;
    select principal.* into principal_row
    from private.admin_principals as principal
    where principal.id = new.principal_id
      and principal.status = 'active'
      and principal.approved_totp_factor_set_hash =
        credential_row.approved_totp_factor_set_hash
      and principal.approved_totp_factor_set_version =
        credential_row.approved_totp_factor_set_version
      and principal.approved_totp_factor_count =
        credential_row.approved_totp_factor_count
    for share;
    if not found then
      raise exception 'remembered-browser approved factor binding mismatch'
        using errcode = 'P7330';
    end if;
    select session.* into session_row
    from public.admin_sessions as session
    where session.id = new.admin_session_id
      and session.environment_id = new.environment_id
      and session.principal_id = new.principal_id
      and session.membership_id = new.membership_id
      and session.authentication_method = 'google_totp'
      and session.aal = 2
      and session.verified_totp_factor_set_hash =
        credential_row.approved_totp_factor_set_hash
      and session.revoked_at is null;
    if not found then
      raise exception 'remembered-browser session binding mismatch'
        using errcode = 'P7330';
    end if;
    new.approved_totp_factor_set_hash :=
      credential_row.approved_totp_factor_set_hash;
    new.approved_totp_factor_set_version :=
      credential_row.approved_totp_factor_set_version;
    new.approved_totp_factor_count := credential_row.approved_totp_factor_count;
    select snapshot.factor_set_hash, snapshot.factor_count
    into live_hash, live_count
    from private.current_verified_totp_factor_set_snapshot_v1(
      principal_row.auth_user_id
    ) as snapshot;
    if live_hash is distinct from principal_row.approved_totp_factor_set_hash
       or live_count <> principal_row.approved_totp_factor_count then
      raise exception 'live TOTP factor set mismatch'
        using errcode = 'P7330';
    end if;
    new.supabase_auth_session_id := session_row.supabase_auth_session_id;
    return new;
  end if;

  raise exception 'unsupported remembered-browser binding table'
    using errcode = '55000';
end;
$$;

create trigger admin_ai_browser_enrollment_totp_binding
before insert or update on private.admin_ai_browser_enrollment_nonces
for each row execute function private.bind_admin_ai_browser_totp_context_v1();
create trigger admin_ai_browser_credential_totp_binding
before insert or update on private.admin_ai_browser_credentials
for each row execute function private.bind_admin_ai_browser_totp_context_v1();
create trigger admin_ai_browser_assertion_totp_binding
before insert or update on private.admin_ai_browser_assertion_challenges
for each row execute function private.bind_admin_ai_browser_totp_context_v1();

revoke all on function private.bind_admin_ai_browser_totp_context_v1()
  from public, anon, authenticated, service_role;

create or replace function private.drain_admin_ai_on_session_revoke_v1()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  effective_now timestamptz := statement_timestamp();
begin
  if old.revoked_at is not null or new.revoked_at is null then return new; end if;

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

revoke all on function private.drain_admin_ai_on_session_revoke_v1()
  from public, anon, authenticated, service_role;

create or replace function private.get_admin_ai_unlock_runtime_gate_v1()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'ai_unlock_enabled', gate.ai_unlock_enabled,
    'remembered_browser_enabled', gate.remembered_browser_enabled
  )
  from private.admin_ai_unlock_runtime_gate as gate
  where gate.singleton;
$$;

revoke all on function private.get_admin_ai_unlock_runtime_gate_v1()
  from public, anon, authenticated, service_role;

create function private.get_admin_ai_browser_credential_status_v1(
  target_token_hash text,
  target_auth_user_id uuid,
  target_supabase_auth_session_id uuid,
  target_browser_credential_id uuid,
  target_credential_hash text,
  target_public_key_fingerprint text,
  target_origin text
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
  credential_row private.admin_ai_browser_credentials%rowtype;
begin
  if target_browser_credential_id is null
     or target_credential_hash !~ '^[0-9a-f]{64}$'
     or target_public_key_fingerprint !~ '^[0-9a-f]{64}$'
     or target_origin !~ '^https?://[^/?#]+$' then
    raise exception 'invalid remembered-browser credential status request'
      using errcode = '22023';
  end if;

  context_value := private.require_admin_ai_context_v1(
    target_token_hash,
    target_auth_user_id,
    target_supabase_auth_session_id,
    null,
    true,
    false
  );
  if context_value is null then return null; end if;

  select credential.* into credential_row
  from private.admin_ai_browser_credentials as credential
  where credential.id = target_browser_credential_id
    and credential.credential_hash = target_credential_hash
    and credential.public_key_fingerprint = target_public_key_fingerprint
    and credential.origin = target_origin
    and credential.environment_id = (context_value ->> 'environment_id')::uuid
    and credential.principal_id = (context_value ->> 'principal_id')::uuid
    and credential.membership_id = (context_value ->> 'membership_id')::uuid
    and credential.status = 'active'
    and credential.expires_at > statement_timestamp()
    and credential.approved_totp_factor_set_hash =
      context_value ->> 'verified_totp_factor_set_hash'
    and exists (
      select 1
      from private.admin_principals as principal
      where principal.id = credential.principal_id
        and principal.status = 'active'
        and principal.approved_totp_factor_set_hash =
          credential.approved_totp_factor_set_hash
        and principal.approved_totp_factor_set_version =
          credential.approved_totp_factor_set_version
        and principal.approved_totp_factor_count =
          credential.approved_totp_factor_count
    );

  if not found then
    return jsonb_build_object('status', 'absent');
  end if;
  return jsonb_build_object(
    'browser_credential_id', credential_row.id,
    'expires_at', credential_row.expires_at,
    'status', credential_row.status
  );
end;
$$;

revoke all on function private.get_admin_ai_browser_credential_status_v1(
  text, uuid, uuid, uuid, text, text, text
) from public, anon, authenticated, service_role;

create function public.get_admin_totp_factor_transition_intent_v1(
  target_token_hash text,
  target_auth_user_id uuid,
  target_supabase_auth_session_id uuid,
  target_action text,
  target_factor_id uuid
)
returns jsonb
language sql
volatile
security invoker
set search_path = ''
as $$
  select private.get_admin_totp_factor_transition_intent_v1(
    target_token_hash, target_auth_user_id, target_supabase_auth_session_id,
    target_action, target_factor_id
  );
$$;

create function public.get_admin_ai_browser_credential_status_v1(
  target_token_hash text,
  target_auth_user_id uuid,
  target_supabase_auth_session_id uuid,
  target_browser_credential_id uuid,
  target_credential_hash text,
  target_public_key_fingerprint text,
  target_origin text
)
returns jsonb
language sql
volatile
security invoker
set search_path = ''
as $$
  select private.get_admin_ai_browser_credential_status_v1(
    target_token_hash, target_auth_user_id, target_supabase_auth_session_id,
    target_browser_credential_id, target_credential_hash,
    target_public_key_fingerprint, target_origin
  );
$$;

create function public.authorize_admin_totp_factor_transition_v1(
  target_token_hash text,
  target_auth_user_id uuid,
  target_supabase_auth_session_id uuid,
  target_action text,
  target_factor_id uuid,
  target_intent_digest text,
  target_recovery_token_hash text,
  target_mutation_request_id uuid
)
returns jsonb
language sql
volatile
security invoker
set search_path = ''
as $$
  select private.authorize_admin_totp_factor_transition_v1(
    target_token_hash, target_auth_user_id, target_supabase_auth_session_id,
    target_action, target_factor_id, target_intent_digest,
    target_recovery_token_hash,
    target_mutation_request_id
  );
$$;

create function public.finalize_admin_totp_factor_transition_v1(
  target_recovery_token_hash text,
  target_auth_user_id uuid,
  target_supabase_auth_session_id uuid,
  target_action text,
  target_factor_id uuid,
  target_intent_digest text,
  target_mutation_request_id uuid,
  target_finalize_request_id uuid
)
returns jsonb
language sql
volatile
security invoker
set search_path = ''
as $$
  select private.finalize_admin_totp_factor_transition_v1(
    target_recovery_token_hash, target_auth_user_id,
    target_supabase_auth_session_id,
    target_action, target_factor_id, target_intent_digest,
    target_mutation_request_id, target_finalize_request_id
  );
$$;

revoke all on function public.get_admin_totp_factor_transition_intent_v1(
  text, uuid, uuid, text, uuid
) from public, anon, authenticated;
revoke all on function public.get_admin_ai_browser_credential_status_v1(
  text, uuid, uuid, uuid, text, text, text
) from public, anon, authenticated;
revoke all on function public.authorize_admin_totp_factor_transition_v1(
  text, uuid, uuid, text, uuid, text, text, uuid
) from public, anon, authenticated;
revoke all on function public.finalize_admin_totp_factor_transition_v1(
  text, uuid, uuid, text, uuid, text, uuid, uuid
) from public, anon, authenticated;

grant execute on function private.begin_admin_totp_factor_control_step_up_v1(
  text, uuid, uuid, text, uuid, text, text, text
) to service_role;
grant execute on function private.complete_admin_totp_factor_control_step_up_v1(
  text, uuid, uuid, text, text, uuid, text, text, timestamptz, text, timestamptz
) to service_role;
grant execute on function private.get_admin_totp_factor_transition_intent_v1(
  text, uuid, uuid, text, uuid
) to service_role;
grant execute on function private.authorize_admin_totp_factor_transition_v1(
  text, uuid, uuid, text, uuid, text, text, uuid
) to service_role;
grant execute on function private.finalize_admin_totp_factor_transition_v1(
  text, uuid, uuid, text, uuid, text, uuid, uuid
) to service_role;
grant execute on function private.get_admin_ai_unlock_runtime_gate_v1()
  to service_role;
grant execute on function private.get_admin_ai_browser_credential_status_v1(
  text, uuid, uuid, uuid, text, text, text
) to service_role;

grant execute on function public.get_admin_totp_factor_transition_intent_v1(
  text, uuid, uuid, text, uuid
) to service_role;
grant execute on function public.get_admin_ai_browser_credential_status_v1(
  text, uuid, uuid, uuid, text, text, text
) to service_role;
grant execute on function public.authorize_admin_totp_factor_transition_v1(
  text, uuid, uuid, text, uuid, text, text, uuid
) to service_role;
grant execute on function public.finalize_admin_totp_factor_transition_v1(
  text, uuid, uuid, text, uuid, text, uuid, uuid
) to service_role;
