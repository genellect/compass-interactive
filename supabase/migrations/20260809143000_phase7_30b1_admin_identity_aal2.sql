-- Phase 7.30A-B1: additive Google Admin identity and mandatory TOTP AAL2.
--
-- This migration is intentionally dormant. Google session issuance requires
-- the database gate and a separate Edge flag; legacy Admin PIN login remains
-- enabled for expand-first rollback. Phase 7.30B2 AI unlock and Phase 7.30C
-- operational RBAC are deliberately out of scope.

create table private.admin_identity_runtime_gate (
  singleton boolean primary key default true check (singleton),
  google_session_issue_enabled boolean not null default false,
  legacy_pin_login_enabled boolean not null default true,
  updated_at timestamptz not null default statement_timestamp()
);

insert into private.admin_identity_runtime_gate (singleton) values (true);

comment on table private.admin_identity_runtime_gate is
  'Dormant Phase 7.30 identity admission gate. Google issuance defaults OFF and legacy Admin PIN defaults ON.';

create table private.admin_environments (
  id uuid primary key,
  environment_kind text not null check (
    environment_kind in ('production', 'staging', 'contest', 'local')
  ),
  canonical_admin_origin text not null check (
    canonical_admin_origin ~ '^https?://[^/?#]+$'
  ),
  supabase_issuer text not null check (
    supabase_issuer ~ '^https?://[^/?#]+(?:/auth/v1)?$'
  ),
  audience text not null default 'authenticated' check (
    char_length(audience) between 1 and 120
  ),
  status text not null default 'active' check (
    status in ('active', 'suspended', 'retired')
  ),
  current_deployment boolean not null default true,
  bootstrap_sealed_at timestamptz,
  owner_invariant_enforced_at timestamptz,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  check (
    owner_invariant_enforced_at is null
    or bootstrap_sealed_at is not null
  )
);

create unique index admin_environments_current_deployment_idx
  on private.admin_environments (current_deployment)
  where current_deployment;

create table private.admin_principals (
  id uuid primary key,
  auth_user_id uuid not null unique,
  provider text not null default 'google' check (provider = 'google'),
  google_issuer text not null check (
    google_issuer = 'https://accounts.google.com'
  ),
  provider_subject_hmac text not null check (
    provider_subject_hmac ~ '^[0-9a-f]{64}$'
  ),
  subject_pepper_version integer not null check (
    subject_pepper_version between 1 and 2147483647
  ),
  normalized_email text not null check (
    normalized_email = lower(trim(normalized_email))
    and char_length(normalized_email) between 3 and 320
  ),
  display_name text check (
    display_name is null or char_length(display_name) between 1 and 160
  ),
  email_verified_at timestamptz not null,
  status text not null default 'active' check (
    status in ('active', 'suspended', 'compromised', 'revoked')
  ),
  bound_at timestamptz not null default statement_timestamp(),
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  unique (
    provider,
    google_issuer,
    provider_subject_hmac,
    subject_pepper_version
  )
);

create table private.admin_environment_memberships (
  id uuid primary key,
  environment_id uuid not null
    references private.admin_environments(id) on delete restrict,
  principal_id uuid not null
    references private.admin_principals(id) on delete restrict,
  role text not null check (role in ('owner', 'instructor')),
  status text not null default 'pending_mfa' check (
    status in ('pending_mfa', 'active', 'suspended', 'revoked')
  ),
  can_use_ai boolean not null default false,
  activated_at timestamptz,
  expires_at timestamptz,
  suspended_at timestamptz,
  revoked_at timestamptz,
  status_reason text check (
    status_reason is null or char_length(status_reason) between 1 and 120
  ),
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  unique (environment_id, principal_id),
  check (role <> 'owner' or expires_at is null),
  check (
    (status = 'active' and activated_at is not null)
    or status <> 'active'
  ),
  check (
    (status = 'suspended') = (suspended_at is not null)
  ),
  check (
    (status = 'revoked') = (revoked_at is not null)
  )
);

create index admin_memberships_environment_status_idx
  on private.admin_environment_memberships (environment_id, status, role);

create index admin_memberships_active_owner_idx
  on private.admin_environment_memberships (environment_id, principal_id)
  where role = 'owner' and status = 'active';

create index admin_memberships_principal_status_idx
  on private.admin_environment_memberships (principal_id, status);

create table private.admin_invitations (
  id uuid primary key,
  environment_id uuid not null
    references private.admin_environments(id) on delete restrict,
  invitation_kind text not null check (
    invitation_kind in ('bootstrap', 'invitation')
  ),
  target_email_hmac text not null check (
    target_email_hmac ~ '^[0-9a-f]{64}$'
  ),
  role text not null check (role in ('owner', 'instructor')),
  can_use_ai boolean not null default false,
  token_hash text check (token_hash is null or token_hash ~ '^[0-9a-f]{64}$'),
  inviter_membership_id uuid
    references private.admin_environment_memberships(id) on delete restrict,
  expires_at timestamptz not null,
  status text not null default 'pending' check (
    status in ('pending', 'accepted', 'revoked', 'expired')
  ),
  accepted_principal_id uuid
    references private.admin_principals(id) on delete restrict,
  accepted_membership_id uuid
    references private.admin_environment_memberships(id) on delete restrict,
  accepted_at timestamptz,
  request_id uuid not null unique,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  check (
    (invitation_kind = 'bootstrap' and token_hash is null and inviter_membership_id is null)
    or
    (invitation_kind = 'invitation' and token_hash is not null and inviter_membership_id is not null)
  ),
  check (expires_at > created_at),
  check (
    (status = 'accepted') = (
      accepted_principal_id is not null
      and accepted_membership_id is not null
      and accepted_at is not null
    )
  )
);

create unique index admin_invitations_pending_email_idx
  on private.admin_invitations (environment_id, target_email_hmac)
  where status = 'pending';

create unique index admin_invitations_token_idx
  on private.admin_invitations (token_hash)
  where token_hash is not null;

create index admin_invitations_expiry_idx
  on private.admin_invitations (expires_at)
  where status = 'pending';

create table private.admin_audit_events (
  id bigint generated always as identity primary key,
  occurred_at timestamptz not null default statement_timestamp(),
  request_id uuid not null,
  environment_id uuid
    references private.admin_environments(id) on delete restrict,
  actor_principal_id uuid
    references private.admin_principals(id) on delete restrict,
  actor_membership_id uuid
    references private.admin_environment_memberships(id) on delete restrict,
  actor_session_id uuid,
  action text not null check (char_length(action) between 1 and 120),
  target_type text not null check (char_length(target_type) between 1 and 80),
  target_id text check (
    target_id is null or char_length(target_id) between 1 and 200
  ),
  result text not null check (result in ('accepted', 'denied', 'error')),
  reason_code text check (
    reason_code is null or reason_code ~ '^[a-z][a-z0-9_]{0,79}$'
  ),
  metadata jsonb not null default '{}'::jsonb check (
    jsonb_typeof(metadata) = 'object'
    and pg_column_size(metadata) <= 2048
  )
);

create index admin_audit_environment_time_idx
  on private.admin_audit_events (environment_id, occurred_at desc, id desc);

create index admin_audit_actor_time_idx
  on private.admin_audit_events (actor_principal_id, occurred_at desc, id desc);

alter table public.admin_sessions
  alter column pin_version_hash drop not null,
  add column authentication_method text not null default 'legacy_pin' check (
    authentication_method in ('legacy_pin', 'google_totp')
  ),
  add column aal smallint not null default 1 check (aal in (1, 2)),
  add column principal_id uuid
    references private.admin_principals(id) on delete restrict,
  add column membership_id uuid
    references private.admin_environment_memberships(id) on delete restrict,
  add column environment_id uuid
    references private.admin_environments(id) on delete restrict,
  add column supabase_auth_session_id uuid,
  add column step_up_verified_at timestamptz;

create index admin_sessions_google_principal_active_idx
  on public.admin_sessions (principal_id, issued_at desc)
  where authentication_method = 'google_totp' and revoked_at is null;

create index admin_sessions_google_membership_active_idx
  on public.admin_sessions (membership_id, issued_at desc)
  where authentication_method = 'google_totp' and revoked_at is null;

create index admin_sessions_google_auth_session_idx
  on public.admin_sessions (supabase_auth_session_id, issued_at desc)
  where authentication_method = 'google_totp' and revoked_at is null;

create index admin_sessions_google_environment_idx
  on public.admin_sessions (environment_id, issued_at desc)
  where authentication_method = 'google_totp' and revoked_at is null;

alter table public.admin_sessions
  add constraint admin_sessions_authentication_mode_check check (
    (
      authentication_method = 'legacy_pin'
      and aal = 1
      and pin_version_hash is not null
      and principal_id is null
      and membership_id is null
      and environment_id is null
      and supabase_auth_session_id is null
      and step_up_verified_at is null
    )
    or
    (
      authentication_method = 'google_totp'
      and aal = 2
      and pin_version_hash is null
      and principal_id is not null
      and membership_id is not null
      and environment_id is not null
      and supabase_auth_session_id is not null
      and step_up_verified_at is not null
    )
  );

create table private.admin_step_up_nonces (
  id uuid primary key,
  nonce_hash text not null unique check (nonce_hash ~ '^[0-9a-f]{64}$'),
  reserved_admin_session_id uuid not null unique,
  environment_id uuid not null
    references private.admin_environments(id) on delete restrict,
  principal_id uuid not null
    references private.admin_principals(id) on delete restrict,
  membership_id uuid not null
    references private.admin_environment_memberships(id) on delete restrict,
  supabase_auth_session_id uuid not null,
  intended_action text not null check (intended_action = 'admin_login'),
  request_id uuid not null unique,
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
  -- Deliberately not a reverse foreign key: admin_sessions already references
  -- the nonce. A reverse RESTRICT edge would make the pair impossible to purge.
  completed_admin_session_id uuid,
  updated_at timestamptz not null default statement_timestamp(),
  check (expires_at > issued_at and expires_at <= issued_at + interval '5 minutes'),
  check (
    completed_admin_session_id is null
    or completed_admin_session_id = reserved_admin_session_id
  ),
  check (
    (status = 'consumed') = (
      consumed_at is not null and completed_admin_session_id is not null
    )
  )
);

alter table public.admin_sessions
  add column step_up_nonce_id uuid
    references private.admin_step_up_nonces(id) on delete restrict;

create unique index admin_sessions_google_step_up_nonce_idx
  on public.admin_sessions (step_up_nonce_id)
  where step_up_nonce_id is not null;

alter table public.admin_sessions
  drop constraint admin_sessions_authentication_mode_check,
  add constraint admin_sessions_authentication_mode_check check (
    (
      authentication_method = 'legacy_pin'
      and aal = 1
      and pin_version_hash is not null
      and principal_id is null
      and membership_id is null
      and environment_id is null
      and supabase_auth_session_id is null
      and step_up_verified_at is null
      and step_up_nonce_id is null
    )
    or
    (
      authentication_method = 'google_totp'
      and aal = 2
      and pin_version_hash is null
      and principal_id is not null
      and membership_id is not null
      and environment_id is not null
      and supabase_auth_session_id is not null
      and step_up_verified_at is not null
      and step_up_nonce_id is not null
    )
  );

create unique index admin_step_up_pending_auth_action_idx
  on private.admin_step_up_nonces (
    supabase_auth_session_id,
    intended_action
  )
  where status = 'pending';

create index admin_step_up_expiry_idx
  on private.admin_step_up_nonces (expires_at)
  where status = 'pending';

alter table private.admin_identity_runtime_gate enable row level security;
alter table private.admin_environments enable row level security;
alter table private.admin_principals enable row level security;
alter table private.admin_environment_memberships enable row level security;
alter table private.admin_invitations enable row level security;
alter table private.admin_step_up_nonces enable row level security;
alter table private.admin_audit_events enable row level security;

revoke all on private.admin_identity_runtime_gate from public, anon, authenticated, service_role;
revoke all on private.admin_environments from public, anon, authenticated, service_role;
revoke all on private.admin_principals from public, anon, authenticated, service_role;
revoke all on private.admin_environment_memberships from public, anon, authenticated, service_role;
revoke all on private.admin_invitations from public, anon, authenticated, service_role;
revoke all on private.admin_step_up_nonces from public, anon, authenticated, service_role;
revoke all on private.admin_audit_events from public, anon, authenticated, service_role;
revoke all on sequence private.admin_audit_events_id_seq from public, anon, authenticated, service_role;

create function private.reject_admin_audit_mutation_v1()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  raise exception 'Admin audit events are append-only' using errcode = '42501';
end;
$$;

create trigger admin_audit_events_append_only
before update or delete on private.admin_audit_events
for each row execute function private.reject_admin_audit_mutation_v1();

create function private.enforce_admin_principal_identity_v1()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  governed_environment record;
  remaining_owner_count integer;
begin
  if old.auth_user_id is distinct from new.auth_user_id
     or old.provider is distinct from new.provider
     or old.google_issuer is distinct from new.google_issuer
     or old.provider_subject_hmac is distinct from new.provider_subject_hmac
     or old.subject_pepper_version is distinct from new.subject_pepper_version then
    raise exception 'Admin identity binding is immutable' using errcode = '22023';
  end if;

  if old.status = 'active' and new.status <> 'active' then
    for governed_environment in
      select environment.id
      from private.admin_environments as environment
      join private.admin_environment_memberships as membership
        on membership.environment_id = environment.id
       and membership.principal_id = old.id
       and membership.role = 'owner'
       and membership.status = 'active'
      where environment.owner_invariant_enforced_at is not null
      order by environment.id
      for update of environment
    loop
      select count(*)
      into remaining_owner_count
      from private.admin_environment_memberships as membership
      join private.admin_principals as principal
        on principal.id = membership.principal_id
      where membership.environment_id = governed_environment.id
        and membership.role = 'owner'
        and membership.status = 'active'
        and membership.principal_id <> old.id
        and principal.status = 'active';

      if remaining_owner_count = 0 then
        raise exception 'An environment must retain an active owner'
          using errcode = 'P7310';
      end if;
    end loop;
  end if;

  new.updated_at := statement_timestamp();
  return new;
end;
$$;

create trigger admin_principals_identity_and_owner_guard
before update on private.admin_principals
for each row execute function private.enforce_admin_principal_identity_v1();

create function private.enforce_admin_membership_owner_v1()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  environment_row private.admin_environments%rowtype;
  remaining_owner_count integer;
begin
  if tg_op = 'UPDATE' and (
    old.environment_id is distinct from new.environment_id
    or old.principal_id is distinct from new.principal_id
  ) then
    raise exception 'Admin membership binding is immutable' using errcode = '22023';
  end if;

  if old.role = 'owner'
     and old.status = 'active'
     and (
       tg_op = 'DELETE'
       or new.role <> 'owner'
       or new.status <> 'active'
     ) then
    select environment.*
    into environment_row
    from private.admin_environments as environment
    where environment.id = old.environment_id
    for update;

    if environment_row.owner_invariant_enforced_at is not null then
      select count(*)
      into remaining_owner_count
      from private.admin_environment_memberships as membership
      join private.admin_principals as principal
        on principal.id = membership.principal_id
      where membership.environment_id = old.environment_id
        and membership.id <> old.id
        and membership.role = 'owner'
        and membership.status = 'active'
        and principal.status = 'active';

      if remaining_owner_count = 0 then
        raise exception 'An environment must retain an active owner'
          using errcode = 'P7310';
      end if;
    end if;
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  new.updated_at := statement_timestamp();
  return new;
end;
$$;

create trigger admin_memberships_owner_guard
before update or delete on private.admin_environment_memberships
for each row execute function private.enforce_admin_membership_owner_v1();

create function private.bootstrap_admin_environment_v1(
  target_environment_id uuid,
  target_environment_kind text,
  target_canonical_admin_origin text,
  target_supabase_issuer text,
  target_audience text,
  target_owner_email_hashes text[],
  target_bootstrap_expires_at timestamptz,
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
  email_hash text;
  invitation_number integer := 0;
begin
  if target_environment_id is null
     or target_request_id is null
     or target_environment_kind is null
     or target_canonical_admin_origin is null
     or target_supabase_issuer is null
     or target_audience is null
     or target_owner_email_hashes is null
     or target_bootstrap_expires_at is null
     or target_environment_kind not in ('production', 'staging', 'contest', 'local')
     or target_canonical_admin_origin !~ '^https?://[^/?#]+$'
     or target_supabase_issuer !~ '^https?://[^/?#]+(?:/auth/v1)?$'
     or nullif(trim(target_audience), '') is null
     or cardinality(target_owner_email_hashes) <> 2
     or (
       select count(distinct value)
       from unnest(target_owner_email_hashes) as hashes(value)
     ) <> 2
     or target_bootstrap_expires_at <= statement_timestamp() + interval '5 minutes'
     or target_bootstrap_expires_at > statement_timestamp() + interval '30 days' then
    raise exception 'invalid Admin environment bootstrap' using errcode = '22023';
  end if;

  if exists (select 1 from private.admin_environments) then
    raise exception 'Admin environment bootstrap is create-only' using errcode = 'P0001';
  end if;

  insert into private.admin_environments (
    id,
    environment_kind,
    canonical_admin_origin,
    supabase_issuer,
    audience,
    bootstrap_sealed_at
  ) values (
    target_environment_id,
    target_environment_kind,
    target_canonical_admin_origin,
    target_supabase_issuer,
    trim(target_audience),
    statement_timestamp()
  );

  foreach email_hash in array target_owner_email_hashes
  loop
    if email_hash !~ '^[0-9a-f]{64}$' then
      raise exception 'invalid Admin bootstrap email digest' using errcode = '22023';
    end if;
    invitation_number := invitation_number + 1;
    insert into private.admin_invitations (
      id,
      environment_id,
      invitation_kind,
      target_email_hmac,
      role,
      can_use_ai,
      expires_at,
      request_id
    ) values (
      gen_random_uuid(),
      target_environment_id,
      'bootstrap',
      email_hash,
      'owner',
      false,
      target_bootstrap_expires_at,
      case
        when invitation_number = 1 then target_request_id
        else gen_random_uuid()
      end
    );
  end loop;

  insert into private.admin_audit_events (
    request_id,
    environment_id,
    action,
    target_type,
    target_id,
    result,
    metadata
  ) values (
    target_request_id,
    target_environment_id,
    'admin_environment.bootstrap',
    'admin_environment',
    target_environment_id::text,
    'accepted',
    jsonb_build_object('owner_count', 2)
  );

  return jsonb_build_object(
    'environment_id', target_environment_id,
    'owner_invitation_count', 2
  );
end;
$$;

create function private.consume_admin_identity_admission_v1(
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
set statement_timeout = '3s'
set lock_timeout = '750ms'
as $$
declare
  principal_row private.admin_principals%rowtype;
  membership_row private.admin_environment_memberships%rowtype;
  invitation_row private.admin_invitations%rowtype;
  normalized_email text := lower(trim(target_normalized_email));
begin
  if target_environment_id is null
     or target_auth_user_id is null
     or target_request_id is null
     or target_google_issuer is null
     or target_provider_subject_hmac is null
     or target_subject_pepper_version is null
     or target_normalized_email is null
     or target_email_digest is null
     or target_google_issuer <> 'https://accounts.google.com'
     or target_provider_subject_hmac !~ '^[0-9a-f]{64}$'
     or target_email_digest !~ '^[0-9a-f]{64}$'
     or target_subject_pepper_version < 1
     or normalized_email <> target_normalized_email
     or char_length(normalized_email) not between 3 and 320
     or (target_display_name is not null and char_length(target_display_name) not between 1 and 160)
     or (
       target_invitation_token_hash is not null
       and target_invitation_token_hash !~ '^[0-9a-f]{64}$'
     ) then
    raise exception 'invalid Admin identity admission' using errcode = '22023';
  end if;

  if not exists (
    select 1
    from private.admin_identity_runtime_gate as gate
    where gate.singleton
      and gate.google_session_issue_enabled
  ) then
    raise exception 'Admin Google identity is disabled' using errcode = 'P7300';
  end if;

  perform 1
  from private.admin_environments as environment
  where environment.id = target_environment_id
    and environment.current_deployment
    and environment.status = 'active'
  for update;

  if not found then
    return jsonb_build_object('eligible', false);
  end if;

  select principal.*
  into principal_row
  from private.admin_principals as principal
  where principal.auth_user_id = target_auth_user_id
  for update;

  if found then
    if principal_row.status <> 'active'
       or principal_row.google_issuer is distinct from target_google_issuer
       or principal_row.provider_subject_hmac is distinct from target_provider_subject_hmac
       or principal_row.subject_pepper_version is distinct from target_subject_pepper_version then
      return jsonb_build_object('eligible', false);
    end if;

    select membership.*
    into membership_row
    from private.admin_environment_memberships as membership
    where membership.environment_id = target_environment_id
      and membership.principal_id = principal_row.id
    for update;

    if not found
       or membership_row.status not in ('pending_mfa', 'active')
       or (
         membership_row.expires_at is not null
         and membership_row.expires_at <= statement_timestamp()
       ) then
      return jsonb_build_object('eligible', false);
    end if;
  else
    if exists (
      select 1
      from private.admin_principals as principal
      where principal.provider = 'google'
        and principal.google_issuer = target_google_issuer
        and principal.provider_subject_hmac = target_provider_subject_hmac
        and principal.subject_pepper_version = target_subject_pepper_version
    ) then
      return jsonb_build_object('eligible', false);
    end if;

    select invitation.*
    into invitation_row
    from private.admin_invitations as invitation
    where invitation.environment_id = target_environment_id
      and invitation.target_email_hmac = target_email_digest
      and invitation.status = 'pending'
      and invitation.expires_at > statement_timestamp()
      and (
        (invitation.invitation_kind = 'bootstrap' and target_invitation_token_hash is null)
        or
        (invitation.invitation_kind = 'invitation' and invitation.token_hash = target_invitation_token_hash)
      )
    for update;

    if not found then
      return jsonb_build_object('eligible', false);
    end if;

    principal_row.id := gen_random_uuid();
    insert into private.admin_principals (
      id,
      auth_user_id,
      provider,
      google_issuer,
      provider_subject_hmac,
      subject_pepper_version,
      normalized_email,
      display_name,
      email_verified_at
    ) values (
      principal_row.id,
      target_auth_user_id,
      'google',
      target_google_issuer,
      target_provider_subject_hmac,
      target_subject_pepper_version,
      normalized_email,
      nullif(trim(target_display_name), ''),
      statement_timestamp()
    ) returning * into principal_row;

    membership_row.id := gen_random_uuid();
    insert into private.admin_environment_memberships (
      id,
      environment_id,
      principal_id,
      role,
      status,
      can_use_ai
    ) values (
      membership_row.id,
      target_environment_id,
      principal_row.id,
      invitation_row.role,
      'pending_mfa',
      invitation_row.can_use_ai
    ) returning * into membership_row;

    update private.admin_invitations
    set
      status = 'accepted',
      accepted_principal_id = principal_row.id,
      accepted_membership_id = membership_row.id,
      accepted_at = statement_timestamp(),
      updated_at = statement_timestamp()
    where id = invitation_row.id;
  end if;

  if (
    select count(*) >= 30
    from private.admin_audit_events as event
    where event.actor_principal_id = principal_row.id
      and event.action = 'admin_identity.admit'
      and event.occurred_at >= statement_timestamp() - interval '5 minutes'
  ) then
    raise exception 'Admin identity admission rate exceeded'
      using errcode = 'P7301';
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
    metadata
  ) values (
    target_request_id,
    target_environment_id,
    principal_row.id,
    membership_row.id,
    'admin_identity.admit',
    'admin_membership',
    membership_row.id::text,
    'accepted',
    jsonb_build_object('membership_status', membership_row.status)
  );

  return jsonb_build_object(
    'eligible', true,
    'membership_id', membership_row.id,
    'principal_id', principal_row.id
  );
end;
$$;

create function private.begin_admin_totp_step_up_v1(
  target_environment_id uuid,
  target_auth_user_id uuid,
  target_supabase_auth_session_id uuid,
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
  issued_at_value timestamptz := statement_timestamp();
  nonce_id uuid := gen_random_uuid();
begin
  if target_environment_id is null
     or target_auth_user_id is null
     or target_supabase_auth_session_id is null
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
    where gate.singleton
      and gate.google_session_issue_enabled
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
    and (
      membership.expires_at is null
      or membership.expires_at > issued_at_value
    )
  for update;

  if not found then
    return null;
  end if;

  if (
    select count(*) >= 10
    from private.admin_audit_events as event
    where event.actor_principal_id = principal_row.id
      and event.action = 'admin_step_up.begin'
      and event.occurred_at >= issued_at_value - interval '5 minutes'
  ) then
    raise exception 'Admin TOTP step-up rate exceeded'
      using errcode = 'P7301';
  end if;

  delete from private.admin_step_up_nonces as nonce
  where nonce.principal_id = principal_row.id
    and nonce.status in ('superseded', 'expired')
    and nonce.expires_at < issued_at_value - interval '1 day';

  update private.admin_step_up_nonces
  set
    status = 'superseded',
    updated_at = issued_at_value
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
    result
  ) values (
    target_request_id,
    target_environment_id,
    principal_row.id,
    membership_row.id,
    'admin_step_up.begin',
    'admin_step_up_nonce',
    nonce_id::text,
    'accepted'
  );

  return jsonb_build_object(
    'expires_at', issued_at_value + interval '5 minutes',
    'issued_at', issued_at_value,
    'nonce_id', nonce_id,
    'reserved_admin_session_id', target_reserved_admin_session_id
  );
end;
$$;

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
  nonce_row private.admin_step_up_nonces%rowtype;
  principal_row private.admin_principals%rowtype;
  membership_row private.admin_environment_memberships%rowtype;
  environment_row private.admin_environments%rowtype;
  session_row public.admin_sessions%rowtype;
  effective_now timestamptz := statement_timestamp();
begin
  if target_nonce_hash is null
     or target_auth_user_id is null
     or target_supabase_auth_session_id is null
     or target_aal is distinct from 2
     or target_current_jwt_hash is null
     or target_current_jwt_iat is null
     or target_totp_amr_method is null
     or target_totp_amr_at is null
     or target_token_hash is null
     or target_request_id is null
     or target_totp_amr_method not in ('totp', 'mfa/totp')
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
    where gate.singleton
      and gate.google_session_issue_enabled
  ) then
    raise exception 'Admin Google identity is disabled' using errcode = 'P7300';
  end if;

  select nonce.*
  into nonce_row
  from private.admin_step_up_nonces as nonce
  where nonce.nonce_hash = target_nonce_hash
  for update;

  if not found then
    return null;
  end if;

  if nonce_row.status = 'consumed' then
    if nonce_row.expires_at <= effective_now
       or nonce_row.supabase_auth_session_id <> target_supabase_auth_session_id
       or nonce_row.prechallenge_jwt_hash = target_current_jwt_hash
       or target_current_jwt_iat < nonce_row.min_amr_at - interval '1 second'
       or target_totp_amr_at < nonce_row.min_amr_at - interval '1 second'
       or target_totp_amr_at > effective_now + interval '1 minute' then
      return null;
    end if;

    select environment.*
    into environment_row
    from private.admin_environments as environment
    where environment.id = nonce_row.environment_id
      and environment.current_deployment
      and environment.status = 'active'
    for update;

    select principal.*
    into principal_row
    from private.admin_principals as principal
    where principal.id = nonce_row.principal_id
      and principal.auth_user_id = target_auth_user_id
      and principal.status = 'active'
    for update;

    select membership.*
    into membership_row
    from private.admin_environment_memberships as membership
    where membership.id = nonce_row.membership_id
      and membership.environment_id = nonce_row.environment_id
      and membership.principal_id = nonce_row.principal_id
      and membership.status = 'active'
      and (membership.expires_at is null or membership.expires_at > effective_now)
    for update;

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

    if environment_row.id is not null
       and principal_row.id is not null
       and membership_row.id is not null
       and session_row.id is not null then
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
    end if;
    return null;
  end if;

  if nonce_row.status <> 'pending'
     or nonce_row.expires_at <= effective_now
     or nonce_row.supabase_auth_session_id <> target_supabase_auth_session_id
     or nonce_row.prechallenge_jwt_hash = target_current_jwt_hash
     or target_current_jwt_iat < nonce_row.min_amr_at - interval '1 second'
     or target_totp_amr_at < nonce_row.min_amr_at - interval '1 second'
     or target_totp_amr_at > effective_now + interval '1 minute' then
    return null;
  end if;

  select environment.*
  into environment_row
  from private.admin_environments as environment
  where environment.id = nonce_row.environment_id
    and environment.current_deployment
    and environment.status = 'active'
  for update;

  select principal.*
  into principal_row
  from private.admin_principals as principal
  where principal.id = nonce_row.principal_id
    and principal.auth_user_id = target_auth_user_id
    and principal.status = 'active'
  for update;

  select membership.*
  into membership_row
  from private.admin_environment_memberships as membership
  where membership.id = nonce_row.membership_id
    and membership.environment_id = nonce_row.environment_id
    and membership.principal_id = nonce_row.principal_id
    and membership.status in ('pending_mfa', 'active')
    and (
      membership.expires_at is null
      or membership.expires_at > effective_now
    )
  for update;

  if environment_row.id is null
     or principal_row.id is null
     or membership_row.id is null then
    return null;
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
    where id = environment_row.id;
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
    effective_now,
    effective_now,
    effective_now + interval '30 minutes',
    effective_now + interval '8 hours'
  ) returning * into session_row;

  update private.admin_step_up_nonces
  set
    status = 'consumed',
    consumed_at = effective_now,
    completed_admin_session_id = session_row.id,
    updated_at = effective_now
  where id = nonce_row.id;

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
    jsonb_build_object('aal', 2, 'method', 'totp')
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
    'step_up_verified_at', session_row.step_up_verified_at
  );
end;
$$;

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
  session_row public.admin_sessions%rowtype;
  principal_row private.admin_principals%rowtype;
  membership_row private.admin_environment_memberships%rowtype;
  environment_row private.admin_environments%rowtype;
  effective_now timestamptz := statement_timestamp();
  rejection_reason text;
begin
  if target_token_hash !~ '^[0-9a-f]{64}$' then
    return null;
  end if;

  if not exists (
    select 1
    from private.admin_identity_runtime_gate as gate
    where gate.singleton
      and gate.google_session_issue_enabled
  ) then
    return null;
  end if;

  select session.*
  into session_row
  from public.admin_sessions as session
  where session.token_hash = target_token_hash
    and session.authentication_method = 'google_totp'
    and session.aal = 2
    and session.auth_user_id = target_auth_user_id
    and session.supabase_auth_session_id = target_supabase_auth_session_id
  for update;

  if not found then
    return null;
  end if;

  select principal.*
  into principal_row
  from private.admin_principals as principal
  where principal.id = session_row.principal_id
  for update;

  select membership.*
  into membership_row
  from private.admin_environment_memberships as membership
  where membership.id = session_row.membership_id
    and membership.environment_id = session_row.environment_id
    and membership.principal_id = session_row.principal_id
  for update;

  select environment.*
  into environment_row
  from private.admin_environments as environment
  where environment.id = session_row.environment_id
  for update;

  rejection_reason := case
    when session_row.revoked_at is not null then session_row.revoke_reason
    when session_row.expires_at <= effective_now then 'absolute_expiry'
    when session_row.idle_expires_at <= effective_now then 'inactivity_expiry'
    when principal_row.id is null or principal_row.status <> 'active' then 'principal_inactive'
    when membership_row.id is null or membership_row.status <> 'active' then 'membership_inactive'
    when membership_row.expires_at is not null and membership_row.expires_at <= effective_now then 'membership_expired'
    when environment_row.id is null or environment_row.status <> 'active' or not environment_row.current_deployment then 'environment_inactive'
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

  if session_row.last_seen_at <= effective_now - interval '5 minutes' then
    update public.admin_sessions
    set
      last_seen_at = effective_now,
      idle_expires_at = least(expires_at, effective_now + interval '30 minutes'),
      updated_at = effective_now
    where id = session_row.id
    returning * into session_row;
  end if;

  return jsonb_build_object(
    'can_use_ai', membership_row.can_use_ai,
    'environment_id', environment_row.id,
    'expires_at', session_row.expires_at,
    'id', session_row.id,
    'idle_expires_at', session_row.idle_expires_at,
    'membership_id', membership_row.id,
    'principal_id', principal_row.id,
    'role', membership_row.role,
    'step_up_verified_at', session_row.step_up_verified_at
  );
end;
$$;

create function private.revoke_own_google_admin_session_v1(
  target_token_hash text,
  target_auth_user_id uuid,
  target_supabase_auth_session_id uuid,
  target_request_id uuid
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
  session_row public.admin_sessions%rowtype;
  effective_now timestamptz := statement_timestamp();
begin
  if target_token_hash !~ '^[0-9a-f]{64}$' then
    return false;
  end if;

  select session.*
  into session_row
  from public.admin_sessions as session
  where session.token_hash = target_token_hash
    and session.authentication_method = 'google_totp'
    and session.auth_user_id = target_auth_user_id
    and session.supabase_auth_session_id = target_supabase_auth_session_id
  for update;

  if not found then
    return false;
  end if;

  if session_row.revoked_at is null then
    update public.admin_sessions
    set
      revoked_at = effective_now,
      revoke_reason = 'self_logout',
      updated_at = effective_now
    where id = session_row.id;
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
    result
  ) values (
    target_request_id,
    session_row.environment_id,
    session_row.principal_id,
    session_row.membership_id,
    session_row.id,
    'admin_session.logout',
    'admin_session',
    session_row.id::text,
    'accepted'
  );

  return true;
end;
$$;

create or replace function public.verify_and_touch_admin_session(
  target_session_id uuid,
  target_token_hash text,
  target_pin_version_hash text
)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  session_row public.admin_sessions%rowtype;
  effective_now timestamptz := statement_timestamp();
  rejection_reason text;
begin
  if target_token_hash !~ '^[0-9a-f]{64}$'
     or target_pin_version_hash !~ '^[0-9a-f]{64}$' then
    return null;
  end if;

  select session.*
  into session_row
  from public.admin_sessions as session
  where session.id = target_session_id
    and session.token_hash = target_token_hash
    and session.authentication_method = 'legacy_pin'
    and session.aal = 1
    and session.pin_version_hash is not null
  for update;

  if not found then
    return null;
  end if;

  rejection_reason := case
    when session_row.revoked_at is not null then session_row.revoke_reason
    when session_row.pin_version_hash <> target_pin_version_hash then 'pin_rotated'
    when session_row.expires_at <= effective_now then 'absolute_expiry'
    when session_row.idle_expires_at <= effective_now then 'inactivity_expiry'
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

  if session_row.last_seen_at <= effective_now - interval '5 minutes' then
    update public.admin_sessions
    set
      last_seen_at = effective_now,
      idle_expires_at = least(expires_at, effective_now + interval '30 minutes'),
      updated_at = effective_now
    where id = session_row.id
    returning * into session_row;
  end if;

  return jsonb_build_object(
    'auth_user_id', session_row.auth_user_id,
    'expires_at', session_row.expires_at,
    'id', session_row.id,
    'idle_expires_at', session_row.idle_expires_at,
    'last_seen_at', session_row.last_seen_at
  );
end;
$$;

create function private.get_admin_identity_runtime_gate_v1()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'google_session_issue_enabled', gate.google_session_issue_enabled,
    'legacy_pin_login_enabled', gate.legacy_pin_login_enabled
  )
  from private.admin_identity_runtime_gate as gate
  where gate.singleton;
$$;

create function private.get_admin_identity_environment_v1(
  target_environment_id uuid
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'audience', environment.audience,
    'canonical_admin_origin', environment.canonical_admin_origin,
    'environment_id', environment.id,
    'status', environment.status,
    'supabase_issuer', environment.supabase_issuer
  )
  from private.admin_environments as environment
  where environment.id = target_environment_id
    and environment.current_deployment;
$$;

create function public.get_admin_identity_runtime_gate_v1()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select private.get_admin_identity_runtime_gate_v1();
$$;

create function public.get_admin_identity_environment_v1(
  target_environment_id uuid
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select private.get_admin_identity_environment_v1(target_environment_id);
$$;

create function public.bootstrap_admin_environment_v1(
  target_environment_id uuid,
  target_environment_kind text,
  target_canonical_admin_origin text,
  target_supabase_issuer text,
  target_audience text,
  target_owner_email_hashes text[],
  target_bootstrap_expires_at timestamptz,
  target_request_id uuid
)
returns jsonb
language sql
volatile
security invoker
set search_path = ''
as $$
  select private.bootstrap_admin_environment_v1(
    target_environment_id,
    target_environment_kind,
    target_canonical_admin_origin,
    target_supabase_issuer,
    target_audience,
    target_owner_email_hashes,
    target_bootstrap_expires_at,
    target_request_id
  );
$$;

create function public.consume_admin_identity_admission_v1(
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
  select private.consume_admin_identity_admission_v1(
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

create function public.begin_admin_totp_step_up_v1(
  target_environment_id uuid,
  target_auth_user_id uuid,
  target_supabase_auth_session_id uuid,
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
  select private.begin_admin_totp_step_up_v1(
    target_environment_id,
    target_auth_user_id,
    target_supabase_auth_session_id,
    target_nonce_hash,
    target_reserved_admin_session_id,
    target_prechallenge_jwt_hash,
    target_request_id
  );
$$;

create function public.complete_admin_totp_step_up_v1(
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
language sql
volatile
security invoker
set search_path = ''
as $$
  select private.complete_admin_totp_step_up_v1(
    target_nonce_hash,
    target_auth_user_id,
    target_supabase_auth_session_id,
    target_aal,
    target_current_jwt_hash,
    target_current_jwt_iat,
    target_totp_amr_method,
    target_totp_amr_at,
    target_token_hash,
    target_network_hash,
    target_user_agent_hash,
    target_request_id
  );
$$;

create function public.verify_and_touch_google_admin_session_v1(
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
  select private.verify_and_touch_google_admin_session_v1(
    target_token_hash,
    target_auth_user_id,
    target_supabase_auth_session_id
  );
$$;

create function public.revoke_own_google_admin_session_v1(
  target_token_hash text,
  target_auth_user_id uuid,
  target_supabase_auth_session_id uuid,
  target_request_id uuid
)
returns boolean
language sql
volatile
security invoker
set search_path = ''
as $$
  select private.revoke_own_google_admin_session_v1(
    target_token_hash,
    target_auth_user_id,
    target_supabase_auth_session_id,
    target_request_id
  );
$$;

revoke all on function private.reject_admin_audit_mutation_v1()
  from public, anon, authenticated, service_role;
revoke all on function private.get_admin_identity_runtime_gate_v1()
  from public, anon, authenticated, service_role;
revoke all on function private.get_admin_identity_environment_v1(uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.enforce_admin_principal_identity_v1()
  from public, anon, authenticated, service_role;
revoke all on function private.enforce_admin_membership_owner_v1()
  from public, anon, authenticated, service_role;
revoke all on function private.bootstrap_admin_environment_v1(uuid, text, text, text, text, text[], timestamptz, uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.consume_admin_identity_admission_v1(uuid, uuid, text, text, integer, text, text, text, uuid, text)
  from public, anon, authenticated, service_role;
revoke all on function private.begin_admin_totp_step_up_v1(uuid, uuid, uuid, text, uuid, text, uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.complete_admin_totp_step_up_v1(text, uuid, uuid, smallint, text, timestamptz, text, timestamptz, text, text, text, uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.verify_and_touch_google_admin_session_v1(text, uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.revoke_own_google_admin_session_v1(text, uuid, uuid, uuid)
  from public, anon, authenticated, service_role;

grant execute on function private.bootstrap_admin_environment_v1(uuid, text, text, text, text, text[], timestamptz, uuid)
  to service_role;
grant execute on function private.get_admin_identity_runtime_gate_v1()
  to service_role;
grant execute on function private.get_admin_identity_environment_v1(uuid)
  to service_role;
grant execute on function private.consume_admin_identity_admission_v1(uuid, uuid, text, text, integer, text, text, text, uuid, text)
  to service_role;
grant execute on function private.begin_admin_totp_step_up_v1(uuid, uuid, uuid, text, uuid, text, uuid)
  to service_role;
grant execute on function private.complete_admin_totp_step_up_v1(text, uuid, uuid, smallint, text, timestamptz, text, timestamptz, text, text, text, uuid)
  to service_role;
grant execute on function private.verify_and_touch_google_admin_session_v1(text, uuid, uuid)
  to service_role;
grant execute on function private.revoke_own_google_admin_session_v1(text, uuid, uuid, uuid)
  to service_role;

revoke all on function public.get_admin_identity_runtime_gate_v1()
  from public, anon, authenticated, service_role;
revoke all on function public.get_admin_identity_environment_v1(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.bootstrap_admin_environment_v1(uuid, text, text, text, text, text[], timestamptz, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.consume_admin_identity_admission_v1(uuid, uuid, text, text, integer, text, text, text, uuid, text)
  from public, anon, authenticated, service_role;
revoke all on function public.begin_admin_totp_step_up_v1(uuid, uuid, uuid, text, uuid, text, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.complete_admin_totp_step_up_v1(text, uuid, uuid, smallint, text, timestamptz, text, timestamptz, text, text, text, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.verify_and_touch_google_admin_session_v1(text, uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.revoke_own_google_admin_session_v1(text, uuid, uuid, uuid)
  from public, anon, authenticated, service_role;

grant execute on function public.get_admin_identity_runtime_gate_v1()
  to service_role;
grant execute on function public.get_admin_identity_environment_v1(uuid)
  to service_role;
grant execute on function public.bootstrap_admin_environment_v1(uuid, text, text, text, text, text[], timestamptz, uuid)
  to service_role;
grant execute on function public.consume_admin_identity_admission_v1(uuid, uuid, text, text, integer, text, text, text, uuid, text)
  to service_role;
grant execute on function public.begin_admin_totp_step_up_v1(uuid, uuid, uuid, text, uuid, text, uuid)
  to service_role;
grant execute on function public.complete_admin_totp_step_up_v1(text, uuid, uuid, smallint, text, timestamptz, text, timestamptz, text, text, text, uuid)
  to service_role;
grant execute on function public.verify_and_touch_google_admin_session_v1(text, uuid, uuid)
  to service_role;
grant execute on function public.revoke_own_google_admin_session_v1(text, uuid, uuid, uuid)
  to service_role;

comment on table private.admin_step_up_nonces is
  'Raw login nonce is never stored. A five-minute digest binds one TOTP event to one future Admin session and Supabase Auth session.';

comment on column public.admin_sessions.authentication_method is
  'Explicitly separates legacy shared-PIN tokens from Phase 7.30 Google plus TOTP sessions.';

comment on column public.admin_sessions.step_up_verified_at is
  'Server time recorded only after a fresh TOTP AMR event atomically consumes a Phase 7.30 nonce.';
