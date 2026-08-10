-- Phase 7.30C1: dormant Google-Admin lecture ownership and atomic AI-master
-- admission. This migration never calls a provider, issues a child billing
-- grant, bridges the legacy Admin workspace, or infers ownership for an
-- existing lecture.

alter table private.admin_ai_unlock_runtime_gate
  add column google_ai_master_admission_enabled boolean not null default false;

comment on column private.admin_ai_unlock_runtime_gate.google_ai_master_admission_enabled is
  'Default-OFF C1 admission gate. Exact replay, status, revoke and free downgrade remain available while new or elevating admission is disabled.';

create or replace function private.get_admin_ai_unlock_runtime_gate_v1()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'ai_unlock_enabled', gate.ai_unlock_enabled,
    'google_ai_master_admission_enabled',
      gate.google_ai_master_admission_enabled,
    'remembered_browser_enabled', gate.remembered_browser_enabled
  )
  from private.admin_ai_unlock_runtime_gate as gate
  where gate.singleton;
$$;

revoke all on function private.get_admin_ai_unlock_runtime_gate_v1()
  from public, anon, authenticated;
grant execute on function private.get_admin_ai_unlock_runtime_gate_v1()
  to service_role;

create table private.admin_lecture_ownerships (
  lecture_session_id uuid primary key
    references public.lecture_sessions(id) on delete restrict,
  environment_id uuid not null
    references private.admin_environments(id) on delete restrict,
  principal_id uuid not null
    references private.admin_principals(id) on delete restrict,
  membership_id uuid not null
    references private.admin_environment_memberships(id) on delete restrict,
  assigned_by_admin_session_id uuid not null
    references public.admin_sessions(id) on delete restrict,
  ownership_request_id uuid not null unique,
  ownership_intent_digest text not null check (
    ownership_intent_digest ~ '^[0-9a-f]{64}$'
  ),
  ownership_source text not null default 'google_create' check (
    ownership_source = 'google_create'
  ),
  assigned_at timestamptz not null default statement_timestamp()
);

comment on table private.admin_lecture_ownerships is
  'C1 private ownership evidence. Absence means unowned; migration never claims or backfills an existing lecture.';

create index admin_lecture_ownerships_environment_idx
  on private.admin_lecture_ownerships (environment_id, lecture_session_id);
create index admin_lecture_ownerships_principal_idx
  on private.admin_lecture_ownerships (principal_id, lecture_session_id);
create index admin_lecture_ownerships_membership_idx
  on private.admin_lecture_ownerships (membership_id, lecture_session_id);
create index admin_lecture_ownerships_session_idx
  on private.admin_lecture_ownerships (
    assigned_by_admin_session_id,
    lecture_session_id
  );

create table private.admin_ai_master_admission_receipts (
  request_id uuid primary key,
  intent_digest text not null check (intent_digest ~ '^[0-9a-f]{64}$'),
  environment_id uuid not null
    references private.admin_environments(id) on delete restrict,
  principal_id uuid not null
    references private.admin_principals(id) on delete restrict,
  membership_id uuid not null
    references private.admin_environment_memberships(id) on delete restrict,
  admin_session_id uuid not null
    references public.admin_sessions(id) on delete restrict,
  supabase_auth_session_id uuid not null,
  lecture_session_id uuid not null
    references public.lecture_sessions(id) on delete restrict,
  master_authorization_id uuid not null
    references public.lecture_ai_master_authorizations(id) on delete restrict,
  master_version bigint not null check (master_version >= 1),
  requested_scope text not null check (
    requested_scope in ('all_except_captions', 'all_including_captions')
  ),
  requested_actions text[] not null check (
    requested_actions in (
      array[
        'academic_answers',
        'material_analysis',
        'poll_suggestions',
        'summaries'
      ]::text[],
      array[
        'academic_answers',
        'captions',
        'material_analysis',
        'poll_suggestions',
        'summaries'
      ]::text[]
    )
  ),
  policy_id uuid not null
    references private.admin_ai_policies(id) on delete restrict,
  policy_version bigint not null check (policy_version >= 1),
  unlock_method text not null check (
    unlock_method in ('ai_pin', 'remembered_browser')
  ),
  unlock_factor_id uuid not null
    references private.admin_ai_unlock_factors(id) on delete restrict,
  unlock_factor_version bigint not null check (unlock_factor_version >= 1),
  browser_credential_id uuid
    references private.admin_ai_browser_credentials(id) on delete restrict,
  pin_attempt_request_id uuid,
  browser_assertion_challenge_id uuid,
  unlock_verified_at timestamptz not null,
  step_up_verified_at timestamptz not null,
  admitted_at timestamptz not null default statement_timestamp(),
  check (
    (
      unlock_method = 'ai_pin'
      and browser_credential_id is null
      and pin_attempt_request_id is not null
      and pin_attempt_request_id = request_id
      and browser_assertion_challenge_id is null
    )
    or (
      unlock_method = 'remembered_browser'
      and browser_credential_id is not null
      and pin_attempt_request_id is null
      and browser_assertion_challenge_id is not null
    )
  )
);

create table private.admin_ai_master_control_receipts (
  request_id uuid primary key,
  control_action text not null check (
    control_action in ('downgrade', 'revoke')
  ),
  environment_id uuid not null
    references private.admin_environments(id) on delete restrict,
  principal_id uuid not null
    references private.admin_principals(id) on delete restrict,
  membership_id uuid not null
    references private.admin_environment_memberships(id) on delete restrict,
  admin_session_id uuid not null
    references public.admin_sessions(id) on delete restrict,
  lecture_session_id uuid not null
    references public.lecture_sessions(id) on delete restrict,
  master_authorization_id uuid
    references public.lecture_ai_master_authorizations(id) on delete restrict,
  requested_reason text check (
    requested_reason is null
    or char_length(requested_reason) between 1 and 120
  ),
  result_kind text not null check (
    result_kind in ('active', 'terminal', 'already_inactive')
  ),
  resulting_scope text check (
    resulting_scope is null
    or resulting_scope in ('all_except_captions', 'all_including_captions')
  ),
  resulting_version bigint check (
    resulting_version is null or resulting_version >= 1
  ),
  completed_at timestamptz not null default statement_timestamp(),
  check (
    (control_action = 'downgrade' and requested_reason is null)
    or (control_action = 'revoke' and requested_reason is not null)
  ),
  check (
    (
      result_kind in ('active', 'terminal')
      and master_authorization_id is not null
      and resulting_scope is not null
      and resulting_version is not null
    )
    or (
      result_kind = 'already_inactive'
      and master_authorization_id is null
      and resulting_scope is null
      and resulting_version is null
    )
  )
);

create table private.admin_ai_master_reuse_receipts (
  request_id uuid primary key,
  intent_digest text not null check (intent_digest ~ '^[0-9a-f]{64}$'),
  environment_id uuid not null
    references private.admin_environments(id) on delete restrict,
  principal_id uuid not null
    references private.admin_principals(id) on delete restrict,
  membership_id uuid not null
    references private.admin_environment_memberships(id) on delete restrict,
  admin_session_id uuid not null
    references public.admin_sessions(id) on delete restrict,
  supabase_auth_session_id uuid not null,
  lecture_session_id uuid not null
    references public.lecture_sessions(id) on delete restrict,
  master_authorization_id uuid not null
    references public.lecture_ai_master_authorizations(id) on delete restrict,
  observed_master_version bigint not null check (observed_master_version >= 1),
  requested_scope text not null check (
    requested_scope in ('all_except_captions', 'all_including_captions')
  ),
  policy_id uuid not null
    references private.admin_ai_policies(id) on delete restrict,
  policy_version bigint not null check (policy_version >= 1),
  requested_unlock_method text not null check (
    requested_unlock_method in ('ai_pin', 'remembered_browser')
  ),
  observed_at timestamptz not null default statement_timestamp()
);

comment on table private.admin_ai_master_reuse_receipts is
  'Immutable proof-free same-scope request observation. Exact retry returns the current state of the recorded master row and can never create or reactivate authority.';

comment on table private.admin_ai_master_control_receipts is
  'Immutable request binding for C1 free downgrade/revoke. Exact replay intentionally returns the current state of the recorded master row; callers refresh status after a later admission creates a different row.';

comment on table private.admin_ai_master_admission_receipts is
  'Immutable C1 exact-replay evidence written in the same transaction that consumes PIN or browser proof and creates or elevates a lecture AI master.';

create unique index admin_ai_master_admission_receipts_pin_proof_idx
  on private.admin_ai_master_admission_receipts (pin_attempt_request_id)
  where pin_attempt_request_id is not null;
create unique index admin_ai_master_admission_receipts_browser_proof_idx
  on private.admin_ai_master_admission_receipts (browser_assertion_challenge_id)
  where browser_assertion_challenge_id is not null;
create index admin_ai_master_admission_receipts_environment_idx
  on private.admin_ai_master_admission_receipts (environment_id, admitted_at desc);
create index admin_ai_master_admission_receipts_principal_idx
  on private.admin_ai_master_admission_receipts (principal_id, admitted_at desc);
create index admin_ai_master_admission_receipts_membership_idx
  on private.admin_ai_master_admission_receipts (membership_id, admitted_at desc);
create index admin_ai_master_admission_receipts_session_idx
  on private.admin_ai_master_admission_receipts (admin_session_id, admitted_at desc);
create index admin_ai_master_admission_receipts_lecture_idx
  on private.admin_ai_master_admission_receipts (lecture_session_id, admitted_at desc);
create index admin_ai_master_admission_receipts_master_idx
  on private.admin_ai_master_admission_receipts (
    master_authorization_id,
    admitted_at desc
  );
create index admin_ai_master_admission_receipts_policy_idx
  on private.admin_ai_master_admission_receipts (policy_id, policy_version);
create index admin_ai_master_admission_receipts_factor_idx
  on private.admin_ai_master_admission_receipts (
    unlock_factor_id,
    unlock_factor_version
  );
create index admin_ai_master_admission_receipts_browser_idx
  on private.admin_ai_master_admission_receipts (browser_credential_id)
  where browser_credential_id is not null;

create index admin_ai_master_control_receipts_environment_idx
  on private.admin_ai_master_control_receipts (environment_id, completed_at desc);
create index admin_ai_master_control_receipts_principal_idx
  on private.admin_ai_master_control_receipts (principal_id, completed_at desc);
create index admin_ai_master_control_receipts_membership_idx
  on private.admin_ai_master_control_receipts (membership_id, completed_at desc);
create index admin_ai_master_control_receipts_session_idx
  on private.admin_ai_master_control_receipts (admin_session_id, completed_at desc);
create index admin_ai_master_control_receipts_lecture_idx
  on private.admin_ai_master_control_receipts (lecture_session_id, completed_at desc);
create index admin_ai_master_control_receipts_master_idx
  on private.admin_ai_master_control_receipts (master_authorization_id)
  where master_authorization_id is not null;

create index admin_ai_master_reuse_receipts_environment_idx
  on private.admin_ai_master_reuse_receipts (environment_id, observed_at desc);
create index admin_ai_master_reuse_receipts_principal_idx
  on private.admin_ai_master_reuse_receipts (principal_id, observed_at desc);
create index admin_ai_master_reuse_receipts_membership_idx
  on private.admin_ai_master_reuse_receipts (membership_id, observed_at desc);
create index admin_ai_master_reuse_receipts_session_idx
  on private.admin_ai_master_reuse_receipts (admin_session_id, observed_at desc);
create index admin_ai_master_reuse_receipts_lecture_idx
  on private.admin_ai_master_reuse_receipts (lecture_session_id, observed_at desc);
create index admin_ai_master_reuse_receipts_master_idx
  on private.admin_ai_master_reuse_receipts (
    master_authorization_id,
    observed_at desc
  );
create index admin_ai_master_reuse_receipts_policy_idx
  on private.admin_ai_master_reuse_receipts (policy_id, policy_version);

alter table private.admin_lecture_ownerships enable row level security;
alter table private.admin_ai_master_admission_receipts enable row level security;
alter table private.admin_ai_master_control_receipts enable row level security;
alter table private.admin_ai_master_reuse_receipts enable row level security;

revoke all on private.admin_lecture_ownerships
  from public, anon, authenticated, service_role;
revoke all on private.admin_ai_master_admission_receipts
  from public, anon, authenticated, service_role;
revoke all on private.admin_ai_master_control_receipts
  from public, anon, authenticated, service_role;
revoke all on private.admin_ai_master_reuse_receipts
  from public, anon, authenticated, service_role;

create function private.reject_admin_c1_evidence_mutation_v1()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  raise exception 'C1 ownership and admission evidence is append-only'
    using errcode = 'P0001';
end;
$$;

revoke all on function private.reject_admin_c1_evidence_mutation_v1()
  from public, anon, authenticated, service_role;

create trigger admin_lecture_ownerships_append_only
before update or delete on private.admin_lecture_ownerships
for each row execute function private.reject_admin_c1_evidence_mutation_v1();

create trigger admin_ai_master_admission_receipts_append_only
before update or delete on private.admin_ai_master_admission_receipts
for each row execute function private.reject_admin_c1_evidence_mutation_v1();

create trigger admin_ai_master_control_receipts_append_only
before update or delete on private.admin_ai_master_control_receipts
for each row execute function private.reject_admin_c1_evidence_mutation_v1();

create trigger admin_ai_master_reuse_receipts_append_only
before update or delete on private.admin_ai_master_reuse_receipts
for each row execute function private.reject_admin_c1_evidence_mutation_v1();

-- C1 admission needs stronger serialization than normal AI profile reads. It
-- discovers immutable session bindings without a lock, then acquires the
-- canonical principal -> membership -> environment -> app session -> Auth
-- session chain. The environment is locked FOR SHARE only after P/M: B1
-- principal/membership owner guards already hold their target row before they
-- request the environment, so this direction cannot form an inverse edge and
-- a concurrent environment deactivation cannot commit ahead of C1 admission.
create function private.require_google_ai_master_context_v1(
  target_token_hash text,
  target_auth_user_id uuid,
  target_supabase_auth_session_id uuid,
  target_require_ai boolean default true
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
  auth_session_row auth.sessions%rowtype;
  live_factor_set_hash text;
  live_factor_count integer;
  effective_session_expiry timestamptz;
  effective_now timestamptz := statement_timestamp();
begin
  if target_token_hash is null
     or target_token_hash !~ '^[0-9a-f]{64}$'
     or target_auth_user_id is null
     or target_supabase_auth_session_id is null
     or target_require_ai is null then
    return null;
  end if;

  select session.*
  into session_snapshot
  from public.admin_sessions as session
  where session.token_hash = target_token_hash
    and session.authentication_method = 'google_totp'
    and session.aal = 2
    and session.auth_user_id = target_auth_user_id
    and session.supabase_auth_session_id = target_supabase_auth_session_id;

  if not found then
    return null;
  end if;

  select principal.*
  into principal_row
  from private.admin_principals as principal
  where principal.id = session_snapshot.principal_id
    and principal.auth_user_id = target_auth_user_id
  for update;

  if not found then
    return null;
  end if;

  select membership.*
  into membership_row
  from private.admin_environment_memberships as membership
  where membership.id = session_snapshot.membership_id
    and membership.environment_id = session_snapshot.environment_id
    and membership.principal_id = principal_row.id
  for update;

  if not found then
    return null;
  end if;

  select environment.*
  into environment_row
  from private.admin_environments as environment
  where environment.id = session_snapshot.environment_id
  for share;

  select session.*
  into session_row
  from public.admin_sessions as session
  where session.id = session_snapshot.id
    and session.token_hash = target_token_hash
    and session.authentication_method = 'google_totp'
    and session.aal = 2
    and session.auth_user_id = target_auth_user_id
    and session.supabase_auth_session_id = target_supabase_auth_session_id
    and session.environment_id = environment_row.id
    and session.principal_id = principal_row.id
    and session.membership_id = membership_row.id
  for update;

  if not found then
    return null;
  end if;

  select auth_session.*
  into auth_session_row
  from auth.sessions as auth_session
  where auth_session.id = target_supabase_auth_session_id
    and auth_session.user_id = target_auth_user_id
  for key share;

  if not found then
    if session_row.revoked_at is null then
      update public.admin_sessions
      set
        revoked_at = effective_now,
        revoke_reason = 'auth_session_revoked',
        updated_at = effective_now
      where id = session_row.id;
    end if;
    return null;
  end if;

  -- One aggregate statement provides the paired hash/count evidence.
  select snapshot.factor_set_hash, snapshot.factor_count
  into live_factor_set_hash, live_factor_count
  from private.current_verified_totp_factor_set_snapshot_v1(
    target_auth_user_id
  ) as snapshot;

  effective_session_expiry := least(
    session_row.expires_at,
    auth_session_row.created_at + interval '8 hours'
  );

  if live_factor_set_hash is null
     or principal_row.approved_totp_factor_set_hash is null
     or live_factor_set_hash is distinct from
       principal_row.approved_totp_factor_set_hash
     or live_factor_count <> principal_row.approved_totp_factor_count
     or session_row.verified_totp_factor_set_hash is distinct from
       live_factor_set_hash then
    if session_row.revoked_at is null then
      update public.admin_sessions
      set
        revoked_at = effective_now,
        revoke_reason = 'totp_factor_set_changed',
        updated_at = effective_now
      where id = session_row.id and revoked_at is null;
    end if;
    return null;
  end if;

  if session_row.revoked_at is not null
     or effective_session_expiry <= effective_now
     or session_row.step_up_verified_at is null
     or principal_row.status <> 'active'
     or principal_row.approved_totp_factor_count < 1
     or membership_row.status <> 'active'
     or (
       membership_row.expires_at is not null
       and membership_row.expires_at <= effective_now
     )
     or (target_require_ai and not membership_row.can_use_ai)
     or environment_row.id is null
     or environment_row.status <> 'active'
     or not environment_row.current_deployment then
    return null;
  end if;

  if session_row.last_seen_at <= effective_now - interval '5 minutes' then
    update public.admin_sessions
    set
      last_seen_at = effective_now,
      idle_expires_at = expires_at,
      updated_at = effective_now
    where id = session_row.id
    returning * into session_row;
  end if;

  return jsonb_build_object(
    'admin_session_id', session_row.id,
    'approved_totp_factor_count', principal_row.approved_totp_factor_count,
    'approved_totp_factor_set_hash',
      principal_row.approved_totp_factor_set_hash,
    'approved_totp_factor_set_version',
      principal_row.approved_totp_factor_set_version,
    'can_use_ai', membership_row.can_use_ai,
    'environment_id', environment_row.id,
    'expires_at', effective_session_expiry,
    'membership_id', membership_row.id,
    'principal_id', principal_row.id,
    'role', membership_row.role,
    'step_up_verified_at', session_row.step_up_verified_at,
    'supabase_auth_session_id', target_supabase_auth_session_id,
    'verified_totp_factor_set_hash', live_factor_set_hash
  );
end;
$$;

revoke all on function private.require_google_ai_master_context_v1(
  text, uuid, uuid, boolean
) from public, anon, authenticated, service_role;

create function private.google_ai_master_intent_digest_v1(
  target_request_id uuid,
  target_admin_session_id uuid,
  target_lecture_session_id uuid,
  target_scope text,
  target_policy_id uuid,
  target_policy_version bigint,
  target_unlock_method text
)
returns text
language sql
immutable
security definer
set search_path = ''
as $$
  select case
    when target_request_id is null
      or target_admin_session_id is null
      or target_lecture_session_id is null
      or target_scope not in (
        'all_except_captions',
        'all_including_captions'
      )
      or target_policy_id is null
      or target_policy_version is null
      or target_policy_version < 1
      or target_unlock_method not in ('ai_pin', 'remembered_browser')
      then null
    else pg_catalog.encode(
      extensions.digest(
        pg_catalog.convert_to(
          'compass:phase7.30c1:google-ai-master-intent:v1'
          || '|request_id=' || target_request_id::text
          || '|admin_session_id=' || target_admin_session_id::text
          || '|lecture_session_id=' || target_lecture_session_id::text
          || '|scope=' || target_scope
          || '|policy_id=' || target_policy_id::text
          || '|policy_version=' || target_policy_version::text
          || '|unlock_method=' || target_unlock_method,
          'UTF8'
        ),
        'sha256'
      ),
      'hex'
    )
  end;
$$;

revoke all on function private.google_ai_master_intent_digest_v1(
  uuid, uuid, uuid, text, uuid, bigint, text
) from public, anon, authenticated, service_role;

create function private.owned_admin_lecture_intent_digest_v1(
  target_request_id uuid,
  target_admin_session_id uuid,
  target_title text,
  target_code_hash text,
  target_starts_at timestamptz,
  target_ends_at timestamptz
)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when target_request_id is null
      or target_admin_session_id is null
      or nullif(trim(target_title), '') is null
      or target_code_hash is null
      then null
    else pg_catalog.encode(
      extensions.digest(
        pg_catalog.convert_to(
          'compass:phase7.30c1:owned-lecture-create:v1'
          || '|request_id=' || target_request_id::text
          || '|admin_session_id=' || target_admin_session_id::text
          || '|title=' || trim(target_title)
          || '|code_hash=' || target_code_hash
          || '|starts_at_epoch_us=' || coalesce(
            round(extract(epoch from target_starts_at) * 1000000)::bigint::text,
            ''
          )
          || '|ends_at_epoch_us=' || coalesce(
            round(extract(epoch from target_ends_at) * 1000000)::bigint::text,
            ''
          ),
          'UTF8'
        ),
        'sha256'
      ),
      'hex'
    )
  end;
$$;

revoke all on function private.owned_admin_lecture_intent_digest_v1(
  uuid, uuid, text, text, timestamptz, timestamptz
) from public, anon, authenticated, service_role;

create function private.create_owned_admin_lecture_v1(
  target_token_hash text,
  target_auth_user_id uuid,
  target_supabase_auth_session_id uuid,
  target_lecture_title text,
  target_lecture_code_hash text,
  target_lecture_code text,
  target_lecture_starts_at timestamptz,
  target_lecture_ends_at timestamptz,
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
  ownership_row private.admin_lecture_ownerships%rowtype;
  gate_row private.admin_ai_unlock_runtime_gate%rowtype;
  created_lecture_id uuid;
  intent_digest_value text;
begin
  if target_request_id is null then
    raise exception 'invalid owned lecture request' using errcode = '22023';
  end if;

  perform private.serialize_admin_ai_request_v1(target_request_id);

  context_value := private.require_google_ai_master_context_v1(
    target_token_hash,
    target_auth_user_id,
    target_supabase_auth_session_id,
    false
  );
  if context_value is null then
    return null;
  end if;

  intent_digest_value := private.owned_admin_lecture_intent_digest_v1(
    target_request_id,
    (context_value ->> 'admin_session_id')::uuid,
    target_lecture_title,
    target_lecture_code_hash,
    target_lecture_starts_at,
    target_lecture_ends_at
  );
  if intent_digest_value is null then
    raise exception 'invalid owned lecture request' using errcode = '22023';
  end if;

  select ownership.*
  into ownership_row
  from private.admin_lecture_ownerships as ownership
  where ownership.ownership_request_id = target_request_id;

  if found then
    if ownership_row.environment_id =
         (context_value ->> 'environment_id')::uuid
       and ownership_row.principal_id =
         (context_value ->> 'principal_id')::uuid
       and ownership_row.membership_id =
         (context_value ->> 'membership_id')::uuid
       and ownership_row.assigned_by_admin_session_id =
         (context_value ->> 'admin_session_id')::uuid
       and ownership_row.ownership_intent_digest = intent_digest_value then
      return jsonb_build_object(
        'lecture_session_id', ownership_row.lecture_session_id,
        'ownership_request_id', ownership_row.ownership_request_id,
        'status', 'owned'
      );
    end if;
    return null;
  end if;

  -- Ownership creation is part of the dormant C1 source boundary. Exact
  -- replay above is gate independent so a lost successful response still
  -- converges, but a new lecture is never created while C1 is default OFF.
  select gate.*
  into gate_row
  from private.admin_ai_unlock_runtime_gate as gate
  where gate.singleton
  for share;

  if not found or not gate_row.google_ai_master_admission_enabled then
    raise exception 'Google AI master admission is disabled'
      using errcode = 'P7336';
  end if;

  created_lecture_id := public.admin_create_lecture_v2(
    target_lecture_title,
    target_lecture_code_hash,
    target_lecture_code,
    target_lecture_starts_at,
    target_lecture_ends_at
  );

  insert into private.admin_lecture_ownerships (
    lecture_session_id,
    environment_id,
    principal_id,
    membership_id,
    assigned_by_admin_session_id,
    ownership_request_id,
    ownership_intent_digest
  ) values (
    created_lecture_id,
    (context_value ->> 'environment_id')::uuid,
    (context_value ->> 'principal_id')::uuid,
    (context_value ->> 'membership_id')::uuid,
    (context_value ->> 'admin_session_id')::uuid,
    target_request_id,
    intent_digest_value
  ) returning * into ownership_row;

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
    ownership_row.environment_id,
    ownership_row.principal_id,
    ownership_row.membership_id,
    ownership_row.assigned_by_admin_session_id,
    'admin_lecture.create_owned',
    'lecture_session',
    ownership_row.lecture_session_id::text,
    'accepted',
    'google_owned_lecture_created',
    jsonb_build_object('ownership_source', ownership_row.ownership_source)
  );

  return jsonb_build_object(
    'lecture_session_id', ownership_row.lecture_session_id,
    'ownership_request_id', ownership_row.ownership_request_id,
    'status', 'owned'
  );
end;
$$;

revoke all on function private.create_owned_admin_lecture_v1(
  text, uuid, uuid, text, text, text, timestamptz, timestamptz, uuid
) from public, anon, authenticated, service_role;

create function public.create_owned_admin_lecture_v1(
  target_token_hash text,
  target_auth_user_id uuid,
  target_supabase_auth_session_id uuid,
  target_lecture_title text,
  target_lecture_code_hash text,
  target_lecture_code text,
  target_lecture_starts_at timestamptz,
  target_lecture_ends_at timestamptz,
  target_request_id uuid
)
returns jsonb
language sql
volatile
security definer
set search_path = ''
as $$
  select private.create_owned_admin_lecture_v1(
    target_token_hash,
    target_auth_user_id,
    target_supabase_auth_session_id,
    target_lecture_title,
    target_lecture_code_hash,
    target_lecture_code,
    target_lecture_starts_at,
    target_lecture_ends_at,
    target_request_id
  );
$$;

revoke all on function public.create_owned_admin_lecture_v1(
  text, uuid, uuid, text, text, text, timestamptz, timestamptz, uuid
) from public, anon, authenticated;
grant execute on function public.create_owned_admin_lecture_v1(
  text, uuid, uuid, text, text, text, timestamptz, timestamptz, uuid
) to service_role;

create function private.replay_or_reuse_google_ai_master_v1(
  target_context jsonb,
  target_lecture_session_id uuid,
  target_scope text,
  target_policy_id uuid,
  target_policy_version bigint,
  target_unlock_method text,
  target_request_id uuid,
  target_intent_digest text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  receipt_row private.admin_ai_master_admission_receipts%rowtype;
  reuse_row private.admin_ai_master_reuse_receipts%rowtype;
  authorization_row public.lecture_ai_master_authorizations%rowtype;
  actor_value text :=
    'admin-session:' || (target_context ->> 'admin_session_id');
  effective_now timestamptz := statement_timestamp();
begin
  select receipt.*
  into receipt_row
  from private.admin_ai_master_admission_receipts as receipt
  where receipt.request_id = target_request_id;

  if found then
    if receipt_row.intent_digest <> target_intent_digest
       or receipt_row.environment_id <>
         (target_context ->> 'environment_id')::uuid
       or receipt_row.principal_id <>
         (target_context ->> 'principal_id')::uuid
       or receipt_row.membership_id <>
         (target_context ->> 'membership_id')::uuid
       or receipt_row.admin_session_id <>
         (target_context ->> 'admin_session_id')::uuid
       or receipt_row.lecture_session_id <> target_lecture_session_id
       or receipt_row.requested_scope <> target_scope
       or receipt_row.policy_id <> target_policy_id
       or receipt_row.policy_version <> target_policy_version
       or receipt_row.unlock_method <> target_unlock_method then
      raise exception 'AI master admission request binding mismatch'
        using errcode = 'P7335';
    end if;

    select master.*
    into authorization_row
    from public.lecture_ai_master_authorizations as master
    where master.id = receipt_row.master_authorization_id
      and master.lecture_session_id = receipt_row.lecture_session_id;
    if not found then
      raise exception 'AI master admission receipt is inconsistent'
        using errcode = 'P7335';
    end if;

    -- Do not require the recorded master version to remain current. A later
    -- free downgrade or revoke must still converge an exact lost response to
    -- the current terminal state instead of consuming the proof again.
    return jsonb_build_object(
      'accepted', true,
      'admission_replayed', true,
      'authorization', private.ai_master_authorization_json(
        authorization_row,
        actor_value
      ),
      'proof_required', false,
      'server_time', effective_now
    );
  end if;

  select reuse.*
  into reuse_row
  from private.admin_ai_master_reuse_receipts as reuse
  where reuse.request_id = target_request_id;

  if found then
    if reuse_row.intent_digest <> target_intent_digest
       or reuse_row.environment_id <>
         (target_context ->> 'environment_id')::uuid
       or reuse_row.principal_id <>
         (target_context ->> 'principal_id')::uuid
       or reuse_row.membership_id <>
         (target_context ->> 'membership_id')::uuid
       or reuse_row.admin_session_id <>
         (target_context ->> 'admin_session_id')::uuid
       or reuse_row.supabase_auth_session_id <>
         (target_context ->> 'supabase_auth_session_id')::uuid
       or reuse_row.lecture_session_id <> target_lecture_session_id
       or reuse_row.requested_scope <> target_scope
       or reuse_row.policy_id <> target_policy_id
       or reuse_row.policy_version <> target_policy_version
       or reuse_row.requested_unlock_method <> target_unlock_method then
      raise exception 'AI master reuse request binding mismatch'
        using errcode = 'P7335';
    end if;

    select master.*
    into authorization_row
    from public.lecture_ai_master_authorizations as master
    where master.id = reuse_row.master_authorization_id
      and master.lecture_session_id = reuse_row.lecture_session_id;
    if not found then
      raise exception 'AI master reuse receipt is inconsistent'
        using errcode = 'P7335';
    end if;

    return jsonb_build_object(
      'accepted', true,
      'admission_replayed', false,
      'authorization', private.ai_master_authorization_json(
        authorization_row,
        actor_value
      ),
      'proof_required', false,
      'reuse_replayed', true,
      'server_time', effective_now
    );
  end if;

  -- Same-session, same-policy, same-scope reuse is a proof-free observation.
  -- It writes only an immutable request receipt, remains gate independent and
  -- consumes no PIN/browser proof. A concurrent revoke can linearize after
  -- this observation; C1 issues no child/provider authority, and exact retry
  -- returns only the recorded master row's current state.
  select master.*
  into authorization_row
  from public.lecture_ai_master_authorizations as master
  join private.admin_lecture_ownerships as ownership
    on ownership.lecture_session_id = master.lecture_session_id
  join private.admin_ai_policies as policy
    on policy.id = master.ai_policy_id
   and policy.version = master.ai_policy_version
  where master.lecture_session_id = target_lecture_session_id
    and master.status = 'active'
    and master.expires_at > effective_now
    and master.principal_id = (target_context ->> 'principal_id')::uuid
    and master.membership_id = (target_context ->> 'membership_id')::uuid
    and master.issuing_admin_session_id =
      (target_context ->> 'admin_session_id')::uuid
    and master.actor_id = actor_value
    and master.scope = target_scope
    and master.ai_policy_id = target_policy_id
    and master.ai_policy_version = target_policy_version
    and ownership.environment_id =
      (target_context ->> 'environment_id')::uuid
    and ownership.principal_id = (target_context ->> 'principal_id')::uuid
    and ownership.membership_id = (target_context ->> 'membership_id')::uuid
    and policy.environment_id = (target_context ->> 'environment_id')::uuid
    and policy.membership_id = (target_context ->> 'membership_id')::uuid
    and policy.status = 'active'
    and policy.valid_from <= effective_now
    and policy.valid_until > effective_now
    and exists (
      select 1
      from private.admin_ai_master_admission_receipts as marker
      where marker.master_authorization_id = master.id
    );

  if found then
    insert into private.admin_ai_master_reuse_receipts (
      request_id,
      intent_digest,
      environment_id,
      principal_id,
      membership_id,
      admin_session_id,
      supabase_auth_session_id,
      lecture_session_id,
      master_authorization_id,
      observed_master_version,
      requested_scope,
      policy_id,
      policy_version,
      requested_unlock_method,
      observed_at
    ) values (
      target_request_id,
      target_intent_digest,
      (target_context ->> 'environment_id')::uuid,
      (target_context ->> 'principal_id')::uuid,
      (target_context ->> 'membership_id')::uuid,
      (target_context ->> 'admin_session_id')::uuid,
      (target_context ->> 'supabase_auth_session_id')::uuid,
      target_lecture_session_id,
      authorization_row.id,
      authorization_row.version,
      target_scope,
      target_policy_id,
      target_policy_version,
      target_unlock_method,
      effective_now
    );

    return jsonb_build_object(
      'accepted', true,
      'admission_replayed', false,
      'authorization', private.ai_master_authorization_json(
        authorization_row,
        actor_value
      ),
      'proof_required', false,
      'reuse_replayed', false,
      'server_time', effective_now
    );
  end if;

  return null;
end;
$$;

revoke all on function private.replay_or_reuse_google_ai_master_v1(
  jsonb, uuid, text, uuid, bigint, text, uuid, text
) from public, anon, authenticated, service_role;

create function private.replay_google_ai_master_admission_v1(
  target_token_hash text,
  target_auth_user_id uuid,
  target_supabase_auth_session_id uuid,
  target_lecture_session_id uuid,
  target_scope text,
  target_policy_id uuid,
  target_policy_version bigint,
  target_unlock_method text,
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
  context_value jsonb;
  intent_digest_value text;
begin
  if target_request_id is null then
    raise exception 'invalid Google AI master replay' using errcode = '22023';
  end if;
  perform private.serialize_admin_ai_request_v1(target_request_id);
  context_value := private.require_google_ai_master_context_v1(
    target_token_hash,
    target_auth_user_id,
    target_supabase_auth_session_id,
    true
  );
  if context_value is null then
    return null;
  end if;
  intent_digest_value := private.google_ai_master_intent_digest_v1(
    target_request_id,
    (context_value ->> 'admin_session_id')::uuid,
    target_lecture_session_id,
    target_scope,
    target_policy_id,
    target_policy_version,
    target_unlock_method
  );
  if intent_digest_value is null then
    raise exception 'invalid Google AI master replay' using errcode = '22023';
  end if;
  return private.replay_or_reuse_google_ai_master_v1(
    context_value,
    target_lecture_session_id,
    target_scope,
    target_policy_id,
    target_policy_version,
    target_unlock_method,
    target_request_id,
    intent_digest_value
  );
end;
$$;

revoke all on function private.replay_google_ai_master_admission_v1(
  text, uuid, uuid, uuid, text, uuid, bigint, text, uuid
) from public, anon, authenticated, service_role;

create function public.replay_google_ai_master_admission_v1(
  target_token_hash text,
  target_auth_user_id uuid,
  target_supabase_auth_session_id uuid,
  target_lecture_session_id uuid,
  target_scope text,
  target_policy_id uuid,
  target_policy_version bigint,
  target_unlock_method text,
  target_request_id uuid
)
returns jsonb
language sql
volatile
security definer
set search_path = ''
as $$
  select private.replay_google_ai_master_admission_v1(
    target_token_hash,
    target_auth_user_id,
    target_supabase_auth_session_id,
    target_lecture_session_id,
    target_scope,
    target_policy_id,
    target_policy_version,
    target_unlock_method,
    target_request_id
  );
$$;

revoke all on function public.replay_google_ai_master_admission_v1(
  text, uuid, uuid, uuid, text, uuid, bigint, text, uuid
) from public, anon, authenticated;
grant execute on function public.replay_google_ai_master_admission_v1(
  text, uuid, uuid, uuid, text, uuid, bigint, text, uuid
) to service_role;

create function private.apply_google_ai_master_admission_v1(
  target_context jsonb,
  target_supabase_auth_session_id uuid,
  target_lecture_session_id uuid,
  target_scope text,
  target_policy_id uuid,
  target_policy_version bigint,
  target_unlock_method text,
  target_factor_id uuid,
  target_factor_version bigint,
  target_browser_credential_id uuid,
  target_pin_attempt_request_id uuid,
  target_browser_assertion_challenge_id uuid,
  target_verified_at timestamptz,
  target_request_id uuid,
  target_intent_digest text
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
  ownership_row private.admin_lecture_ownerships%rowtype;
  policy_row private.admin_ai_policies%rowtype;
  gate_row private.admin_ai_unlock_runtime_gate%rowtype;
  lecture_row public.lecture_sessions%rowtype;
  authorization_row public.lecture_ai_master_authorizations%rowtype;
  receipt_row private.admin_ai_master_admission_receipts%rowtype;
  requested_actions text[];
  actor_value text :=
    'admin-session:' || (target_context ->> 'admin_session_id');
  authorization_was_new boolean := false;
  effective_expires_at timestamptz;
  effective_now timestamptz := statement_timestamp();
begin
  requested_actions := private.ai_master_actions_for_scope(target_scope);
  if requested_actions is null
     or target_request_id is null
     or target_intent_digest is null
     or target_intent_digest !~ '^[0-9a-f]{64}$'
     or target_unlock_method is null
     or target_unlock_method not in ('ai_pin', 'remembered_browser')
     or target_factor_id is null
     or target_factor_version is null
     or target_factor_version < 1
     or target_verified_at is null
     or target_verified_at > effective_now + interval '1 minute'
     or (
       target_unlock_method = 'ai_pin'
       and (
         target_browser_credential_id is not null
         or target_pin_attempt_request_id is null
         or target_pin_attempt_request_id is distinct from target_request_id
         or target_browser_assertion_challenge_id is not null
       )
     )
     or (
       target_unlock_method = 'remembered_browser'
       and (
         target_browser_credential_id is null
         or target_pin_attempt_request_id is not null
         or target_browser_assertion_challenge_id is null
       )
     ) then
    raise exception 'invalid Google AI master proof' using errcode = '22023';
  end if;

  -- Linearize every new/elevating admission against gate deactivation. The
  -- same locked row also binds remembered-browser authority at final apply,
  -- after proof completion but before any master or receipt can commit.
  select gate.*
  into gate_row
  from private.admin_ai_unlock_runtime_gate as gate
  where gate.singleton
  for share;

  if not found
     or not gate_row.ai_unlock_enabled
     or not gate_row.google_ai_master_admission_enabled
     or (
       target_unlock_method = 'remembered_browser'
       and not gate_row.remembered_browser_enabled
     ) then
    raise exception 'Google AI master admission is disabled'
      using errcode = 'P7336';
  end if;

  perform private.serialize_admin_ai_scope_v1(
    'factor-membership',
    (target_context ->> 'membership_id')::uuid
  );
  perform private.serialize_admin_ai_scope_v1(
    'policy-membership',
    (target_context ->> 'membership_id')::uuid
  );

  select ownership.*
  into ownership_row
  from private.admin_lecture_ownerships as ownership
  where ownership.lecture_session_id = target_lecture_session_id;

  if not found
     or ownership_row.environment_id <>
       (target_context ->> 'environment_id')::uuid
     or ownership_row.principal_id <>
       (target_context ->> 'principal_id')::uuid
     or ownership_row.membership_id <>
       (target_context ->> 'membership_id')::uuid then
    raise exception 'lecture ownership is unavailable' using errcode = 'P7335';
  end if;

  select policy.*
  into policy_row
  from private.admin_ai_policies as policy
  where policy.id = target_policy_id
    and policy.version = target_policy_version
    and policy.environment_id = (target_context ->> 'environment_id')::uuid
    and policy.membership_id = (target_context ->> 'membership_id')::uuid
  for update;

  if not found
     or policy_row.status <> 'active'
     or policy_row.valid_from > effective_now
     or policy_row.valid_until <= effective_now
     or not requested_actions <@ policy_row.allowed_actions then
    raise exception 'AI policy is unavailable' using errcode = 'P7335';
  end if;

  select lecture.*
  into lecture_row
  from public.lecture_sessions as lecture
  where lecture.id = target_lecture_session_id
  for update;

  if not found
     or lecture_row.status <> 'open'
     or lecture_row.hard_stop_at is null
     or lecture_row.hard_stop_at <= effective_now then
    raise exception 'lecture is not open' using errcode = 'P7335';
  end if;

  select master.*
  into authorization_row
  from public.lecture_ai_master_authorizations as master
  where master.lecture_session_id = target_lecture_session_id
    and master.status = 'active'
  for update;

  if found and authorization_row.expires_at <= effective_now then
    perform private.expire_ai_master_authorization(
      target_lecture_session_id,
      'expired',
      'authorization_expired',
      'system:expiry'
    );
    authorization_row := null::public.lecture_ai_master_authorizations;
  end if;

  if authorization_row.id is not null and (
    authorization_row.principal_id is null
    or not exists (
      select 1
      from private.admin_ai_master_admission_receipts as marker
      where marker.master_authorization_id = authorization_row.id
    )
  ) then
    raise exception 'pre-C1 AI master cannot be converted by C1'
      using errcode = 'P7335';
  end if;

  if authorization_row.id is not null and (
    authorization_row.principal_id <>
      (target_context ->> 'principal_id')::uuid
    or authorization_row.membership_id <>
      (target_context ->> 'membership_id')::uuid
    or authorization_row.issuing_admin_session_id <>
      (target_context ->> 'admin_session_id')::uuid
    or authorization_row.actor_id <> actor_value
  ) then
    raise exception 'AI master is held by another Admin session'
      using errcode = 'P7335';
  end if;

  effective_expires_at := least(
    lecture_row.hard_stop_at,
    policy_row.valid_until,
    (target_context ->> 'expires_at')::timestamptz
  );
  if effective_expires_at <= effective_now then
    raise exception 'AI master lifetime is unavailable' using errcode = 'P7335';
  end if;

  if authorization_row.id is null then
    authorization_was_new := true;
    insert into public.lecture_ai_master_authorizations (
      lecture_session_id,
      admin_session_id,
      actor_id,
      scope,
      actions,
      expires_at,
      principal_id,
      membership_id,
      issuing_admin_session_id,
      ai_policy_id,
      ai_policy_version,
      unlock_method,
      unlock_factor_id,
      unlock_factor_version,
      browser_credential_id,
      unlock_verified_at,
      step_up_verified_at
    ) values (
      target_lecture_session_id,
      (target_context ->> 'admin_session_id')::uuid,
      actor_value,
      target_scope,
      requested_actions,
      effective_expires_at,
      (target_context ->> 'principal_id')::uuid,
      (target_context ->> 'membership_id')::uuid,
      (target_context ->> 'admin_session_id')::uuid,
      policy_row.id,
      policy_row.version,
      target_unlock_method,
      target_factor_id,
      target_factor_version,
      target_browser_credential_id,
      target_verified_at,
      (target_context ->> 'step_up_verified_at')::timestamptz
    ) returning * into authorization_row;
  else
    if authorization_row.scope = 'all_including_captions'
       and target_scope = 'all_except_captions' then
      perform private.stop_captions_for_ai_master_scope_change(
        target_lecture_session_id
      );
    end if;

    update public.lecture_ai_master_authorizations as master
    set
      scope = target_scope,
      actions = requested_actions,
      expires_at = effective_expires_at,
      last_used_at = null,
      ai_policy_id = policy_row.id,
      ai_policy_version = policy_row.version,
      unlock_method = target_unlock_method,
      unlock_factor_id = target_factor_id,
      unlock_factor_version = target_factor_version,
      browser_credential_id = target_browser_credential_id,
      unlock_verified_at = target_verified_at,
      step_up_verified_at =
        (target_context ->> 'step_up_verified_at')::timestamptz,
      version = master.version + 1,
      updated_at = effective_now
    where master.id = authorization_row.id
    returning * into authorization_row;

    perform private.revoke_pending_ai_master_grants(
      authorization_row.id,
      'google_ai_master_reauthorized'
    );
  end if;

  insert into public.ai_master_authorization_events (
    authorization_id,
    lecture_session_id,
    event_type,
    actor_id,
    scope,
    actions,
    reason
  ) values (
    authorization_row.id,
    authorization_row.lecture_session_id,
    case when authorization_was_new then 'authorized' else 'scope_changed' end,
    actor_value,
    authorization_row.scope,
    authorization_row.actions,
    case
      when authorization_was_new then null
      else 'google_ai_master_reauthorized'
    end
  );

  insert into private.admin_ai_master_admission_receipts (
    request_id,
    intent_digest,
    environment_id,
    principal_id,
    membership_id,
    admin_session_id,
    supabase_auth_session_id,
    lecture_session_id,
    master_authorization_id,
    master_version,
    requested_scope,
    requested_actions,
    policy_id,
    policy_version,
    unlock_method,
    unlock_factor_id,
    unlock_factor_version,
    browser_credential_id,
    pin_attempt_request_id,
    browser_assertion_challenge_id,
    unlock_verified_at,
    step_up_verified_at,
    admitted_at
  ) values (
    target_request_id,
    target_intent_digest,
    (target_context ->> 'environment_id')::uuid,
    (target_context ->> 'principal_id')::uuid,
    (target_context ->> 'membership_id')::uuid,
    (target_context ->> 'admin_session_id')::uuid,
    target_supabase_auth_session_id,
    target_lecture_session_id,
    authorization_row.id,
    authorization_row.version,
    target_scope,
    requested_actions,
    policy_row.id,
    policy_row.version,
    target_unlock_method,
    target_factor_id,
    target_factor_version,
    target_browser_credential_id,
    target_pin_attempt_request_id,
    target_browser_assertion_challenge_id,
    target_verified_at,
    (target_context ->> 'step_up_verified_at')::timestamptz,
    effective_now
  ) returning * into receipt_row;

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
    receipt_row.environment_id,
    receipt_row.principal_id,
    receipt_row.membership_id,
    receipt_row.admin_session_id,
    'google_ai_master.admit',
    'lecture_ai_master_authorization',
    authorization_row.id::text,
    'accepted',
    'atomic_unlock_proof_consumed',
    jsonb_build_object(
      'scope', authorization_row.scope,
      'unlock_method', authorization_row.unlock_method,
      'version', authorization_row.version
    )
  );

  return jsonb_build_object(
    'accepted', true,
    'admission_replayed', false,
    'authorization', private.ai_master_authorization_json(
      authorization_row,
      actor_value
    ),
    'proof_required', false,
    'server_time', effective_now
  );
end;
$$;

revoke all on function private.apply_google_ai_master_admission_v1(
  jsonb, uuid, uuid, text, uuid, bigint, text, uuid, bigint, uuid, uuid,
  uuid, timestamptz, uuid, text
) from public, anon, authenticated, service_role;

create function private.authorize_google_ai_master_with_pin_v1(
  target_token_hash text,
  target_auth_user_id uuid,
  target_supabase_auth_session_id uuid,
  target_lecture_session_id uuid,
  target_scope text,
  target_policy_id uuid,
  target_policy_version bigint,
  target_network_hmac text,
  target_pin_pepper_version integer,
  target_peppered_pin_hmac text,
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
  replay_value jsonb;
  metadata_value jsonb;
  verification_value jsonb;
  intent_digest_value text;
begin
  if target_lecture_session_id is null
     or target_scope not in ('all_except_captions', 'all_including_captions')
     or target_policy_id is null
     or target_policy_version is null
     or target_policy_version < 1
     or target_network_hmac !~ '^[0-9a-f]{64}$'
     or target_pin_pepper_version is null
     or target_pin_pepper_version < 1
     or target_peppered_pin_hmac !~ '^[0-9a-f]{64}$'
     or target_request_id is null then
    raise exception 'invalid Google AI master PIN admission'
      using errcode = '22023';
  end if;

  perform private.serialize_admin_ai_request_v1(target_request_id);

  context_value := private.require_google_ai_master_context_v1(
    target_token_hash,
    target_auth_user_id,
    target_supabase_auth_session_id,
    true
  );
  if context_value is null then
    return null;
  end if;

  intent_digest_value := private.google_ai_master_intent_digest_v1(
    target_request_id,
    (context_value ->> 'admin_session_id')::uuid,
    target_lecture_session_id,
    target_scope,
    target_policy_id,
    target_policy_version,
    'ai_pin'
  );

  replay_value := private.replay_or_reuse_google_ai_master_v1(
    context_value,
    target_lecture_session_id,
    target_scope,
    target_policy_id,
    target_policy_version,
    'ai_pin',
    target_request_id,
    intent_digest_value
  );
  if replay_value is not null then
    return replay_value;
  end if;

  if not exists (
    select 1
    from private.admin_ai_unlock_runtime_gate as gate
    where gate.singleton
      and gate.ai_unlock_enabled
      and gate.google_ai_master_admission_enabled
  ) then
    raise exception 'Google AI master admission is disabled'
      using errcode = 'P7336';
  end if;

  metadata_value := private.get_admin_ai_pin_factor_metadata_v1(
    target_token_hash,
    target_auth_user_id,
    target_supabase_auth_session_id,
    target_network_hmac,
    intent_digest_value,
    target_request_id
  );

  if metadata_value is null
     or coalesce((metadata_value ->> 'available')::boolean, false) is false then
    return coalesce(
      metadata_value,
      jsonb_build_object(
        'accepted', false,
        'reason_code', 'invalid_unlock',
        'retry_after_seconds', 0,
        'verified', false
      )
    );
  end if;

  if (metadata_value ->> 'pin_pepper_version')::integer <>
       target_pin_pepper_version then
    return jsonb_build_object(
      'accepted', false,
      'reason_code', 'invalid_unlock',
      'retry_after_seconds', 0,
      'verified', false
    );
  end if;

  verification_value := private.consume_admin_ai_pin_attempt_v1(
    target_token_hash,
    target_auth_user_id,
    target_supabase_auth_session_id,
    target_pin_pepper_version,
    target_peppered_pin_hmac,
    target_network_hmac,
    intent_digest_value,
    target_request_id
  );

  if verification_value is null
     or coalesce((verification_value ->> 'verified')::boolean, false) is false then
    return coalesce(
      verification_value,
      jsonb_build_object(
        'accepted', false,
        'reason_code', 'invalid_unlock',
        'retry_after_seconds', 0,
        'verified', false
      )
    );
  end if;

  return private.apply_google_ai_master_admission_v1(
    context_value,
    target_supabase_auth_session_id,
    target_lecture_session_id,
    target_scope,
    target_policy_id,
    target_policy_version,
    'ai_pin',
    (verification_value ->> 'factor_id')::uuid,
    (verification_value ->> 'factor_version')::bigint,
    null,
    target_request_id,
    null,
    (verification_value ->> 'verified_at')::timestamptz,
    target_request_id,
    intent_digest_value
  );
end;
$$;

revoke all on function private.authorize_google_ai_master_with_pin_v1(
  text, uuid, uuid, uuid, text, uuid, bigint, text, integer, text, uuid
) from public, anon, authenticated, service_role;

create function public.authorize_google_ai_master_with_pin_v1(
  target_token_hash text,
  target_auth_user_id uuid,
  target_supabase_auth_session_id uuid,
  target_lecture_session_id uuid,
  target_scope text,
  target_policy_id uuid,
  target_policy_version bigint,
  target_network_hmac text,
  target_pin_pepper_version integer,
  target_peppered_pin_hmac text,
  target_request_id uuid
)
returns jsonb
language sql
volatile
security definer
set search_path = ''
as $$
  select private.authorize_google_ai_master_with_pin_v1(
    target_token_hash,
    target_auth_user_id,
    target_supabase_auth_session_id,
    target_lecture_session_id,
    target_scope,
    target_policy_id,
    target_policy_version,
    target_network_hmac,
    target_pin_pepper_version,
    target_peppered_pin_hmac,
    target_request_id
  );
$$;

revoke all on function public.authorize_google_ai_master_with_pin_v1(
  text, uuid, uuid, uuid, text, uuid, bigint, text, integer, text, uuid
) from public, anon, authenticated;
grant execute on function public.authorize_google_ai_master_with_pin_v1(
  text, uuid, uuid, uuid, text, uuid, bigint, text, integer, text, uuid
) to service_role;

create function private.complete_google_ai_master_browser_admission_v1(
  target_token_hash text,
  target_auth_user_id uuid,
  target_supabase_auth_session_id uuid,
  target_lecture_session_id uuid,
  target_scope text,
  target_policy_id uuid,
  target_policy_version bigint,
  target_credential_hash text,
  target_challenge_hash text,
  target_origin text,
  target_assertion_payload_hash text,
  target_signature_verified boolean,
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
  replay_value jsonb;
  verification_value jsonb;
  challenge_snapshot private.admin_ai_browser_assertion_challenges%rowtype;
  intent_digest_value text;
begin
  if target_lecture_session_id is null
     or target_scope not in ('all_except_captions', 'all_including_captions')
     or target_policy_id is null
     or target_policy_version is null
     or target_policy_version < 1
     or target_credential_hash !~ '^[0-9a-f]{64}$'
     or target_challenge_hash !~ '^[0-9a-f]{64}$'
     or target_origin !~ '^https?://[^/?#]+$'
     or target_assertion_payload_hash !~ '^[0-9a-f]{64}$'
     or target_signature_verified is null
     or target_request_id is null then
    raise exception 'invalid Google AI master browser admission'
      using errcode = '22023';
  end if;

  perform private.serialize_admin_ai_request_v1(target_request_id);

  context_value := private.require_google_ai_master_context_v1(
    target_token_hash,
    target_auth_user_id,
    target_supabase_auth_session_id,
    true
  );
  if context_value is null then
    return null;
  end if;

  intent_digest_value := private.google_ai_master_intent_digest_v1(
    target_request_id,
    (context_value ->> 'admin_session_id')::uuid,
    target_lecture_session_id,
    target_scope,
    target_policy_id,
    target_policy_version,
    'remembered_browser'
  );

  replay_value := private.replay_or_reuse_google_ai_master_v1(
    context_value,
    target_lecture_session_id,
    target_scope,
    target_policy_id,
    target_policy_version,
    'remembered_browser',
    target_request_id,
    intent_digest_value
  );
  if replay_value is not null then
    return replay_value;
  end if;

  if not exists (
    select 1
    from private.admin_ai_unlock_runtime_gate as gate
    where gate.singleton
      and gate.ai_unlock_enabled
      and gate.remembered_browser_enabled
      and gate.google_ai_master_admission_enabled
  ) then
    raise exception 'Google AI master admission is disabled'
      using errcode = 'P7336';
  end if;

  select challenge.*
  into challenge_snapshot
  from private.admin_ai_browser_assertion_challenges as challenge
  where challenge.challenge_hash = target_challenge_hash;
  if not found
     or challenge_snapshot.admin_session_id <>
       (context_value ->> 'admin_session_id')::uuid
     or challenge_snapshot.environment_id <>
       (context_value ->> 'environment_id')::uuid
     or challenge_snapshot.principal_id <>
       (context_value ->> 'principal_id')::uuid
     or challenge_snapshot.membership_id <>
       (context_value ->> 'membership_id')::uuid
     or challenge_snapshot.lecture_session_id <> target_lecture_session_id
     or challenge_snapshot.requested_scope <> target_scope
     or challenge_snapshot.policy_id <> target_policy_id
     or challenge_snapshot.policy_version <> target_policy_version
     or challenge_snapshot.origin <> target_origin then
    return null;
  end if;

  verification_value := private.complete_admin_ai_browser_assertion_v1(
    target_token_hash,
    target_auth_user_id,
    target_supabase_auth_session_id,
    target_credential_hash,
    target_challenge_hash,
    target_origin,
    target_assertion_payload_hash,
    target_signature_verified,
    target_request_id
  );

  if not target_signature_verified then
    -- The underlying assertion function records a bounded denial. No master
    -- mutation follows, so this result intentionally commits that abuse state.
    return null;
  end if;

  if verification_value is null then
    return null;
  end if;

  if coalesce((verification_value ->> 'verified')::boolean, false) is false
     or (verification_value ->> 'lecture_session_id')::uuid <>
       target_lecture_session_id
     or verification_value ->> 'scope' <> target_scope
     or (verification_value ->> 'policy_id')::uuid <> target_policy_id
     or (verification_value ->> 'policy_version')::bigint <>
       target_policy_version then
    -- Any mismatch discovered after the proof function could have consumed
    -- its challenge must abort the transaction so proof and master remain
    -- atomic.
    raise exception 'browser proof binding changed during admission'
      using errcode = 'P7335';
  end if;

  return private.apply_google_ai_master_admission_v1(
    context_value,
    target_supabase_auth_session_id,
    target_lecture_session_id,
    target_scope,
    target_policy_id,
    target_policy_version,
    'remembered_browser',
    (verification_value ->> 'factor_id')::uuid,
    (verification_value ->> 'factor_version')::bigint,
    (verification_value ->> 'browser_credential_id')::uuid,
    null,
    challenge_snapshot.id,
    (verification_value ->> 'verified_at')::timestamptz,
    target_request_id,
    intent_digest_value
  );
end;
$$;

revoke all on function private.complete_google_ai_master_browser_admission_v1(
  text, uuid, uuid, uuid, text, uuid, bigint, text, text, text, text, boolean,
  uuid
) from public, anon, authenticated, service_role;

create function public.complete_google_ai_master_browser_admission_v1(
  target_token_hash text,
  target_auth_user_id uuid,
  target_supabase_auth_session_id uuid,
  target_lecture_session_id uuid,
  target_scope text,
  target_policy_id uuid,
  target_policy_version bigint,
  target_credential_hash text,
  target_challenge_hash text,
  target_origin text,
  target_assertion_payload_hash text,
  target_signature_verified boolean,
  target_request_id uuid
)
returns jsonb
language sql
volatile
security definer
set search_path = ''
as $$
  select private.complete_google_ai_master_browser_admission_v1(
    target_token_hash,
    target_auth_user_id,
    target_supabase_auth_session_id,
    target_lecture_session_id,
    target_scope,
    target_policy_id,
    target_policy_version,
    target_credential_hash,
    target_challenge_hash,
    target_origin,
    target_assertion_payload_hash,
    target_signature_verified,
    target_request_id
  );
$$;

revoke all on function public.complete_google_ai_master_browser_admission_v1(
  text, uuid, uuid, uuid, text, uuid, bigint, text, text, text, text, boolean,
  uuid
) from public, anon, authenticated;
grant execute on function public.complete_google_ai_master_browser_admission_v1(
  text, uuid, uuid, uuid, text, uuid, bigint, text, text, text, text, boolean,
  uuid
) to service_role;

create function private.get_google_ai_master_status_v1(
  target_token_hash text,
  target_auth_user_id uuid,
  target_supabase_auth_session_id uuid,
  target_lecture_session_id uuid
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
  ownership_row private.admin_lecture_ownerships%rowtype;
  lecture_row public.lecture_sessions%rowtype;
  authorization_row public.lecture_ai_master_authorizations%rowtype;
  effective_now timestamptz := statement_timestamp();
begin
  if target_lecture_session_id is null then
    raise exception 'invalid Google AI master status' using errcode = '22023';
  end if;

  context_value := private.require_google_ai_master_context_v1(
    target_token_hash,
    target_auth_user_id,
    target_supabase_auth_session_id,
    false
  );
  if context_value is null then
    return null;
  end if;

  select ownership.*
  into ownership_row
  from private.admin_lecture_ownerships as ownership
  where ownership.lecture_session_id = target_lecture_session_id
    and ownership.environment_id = (context_value ->> 'environment_id')::uuid
    and ownership.principal_id = (context_value ->> 'principal_id')::uuid
    and ownership.membership_id = (context_value ->> 'membership_id')::uuid;
  if not found then
    return null;
  end if;

  select lecture.*
  into lecture_row
  from public.lecture_sessions as lecture
  where lecture.id = target_lecture_session_id
  for update;
  if not found then
    return null;
  end if;

  select master.*
  into authorization_row
  from public.lecture_ai_master_authorizations as master
  where master.lecture_session_id = target_lecture_session_id
    and master.status = 'active'
  for update;

  if not found then
    -- Status is gate independent and should converge to the most recent C1
    -- row after revoke/expiry. Ownership and an immutable admission receipt
    -- keep pre-C1 rows from being mistaken for C1 authority.
    select master.*
    into authorization_row
    from public.lecture_ai_master_authorizations as master
    where master.lecture_session_id = target_lecture_session_id
      and exists (
        select 1
        from private.admin_ai_master_admission_receipts as marker
        where marker.master_authorization_id = master.id
      )
    order by master.issued_at desc, master.id desc
    limit 1
    for update;
  end if;

  if found and (
    authorization_row.principal_id is null
    or not exists (
      select 1
      from private.admin_ai_master_admission_receipts as marker
      where marker.master_authorization_id = authorization_row.id
    )
  ) then
    return jsonb_build_object(
      'authorization', null,
      'lecture_open', lecture_row.status = 'open'
        and lecture_row.hard_stop_at is not null
        and lecture_row.hard_stop_at > effective_now,
      'reason', 'pre_c1_master_fenced',
      'server_time', effective_now
    );
  end if;

  if found and (
    authorization_row.principal_id <> ownership_row.principal_id
    or authorization_row.membership_id <> ownership_row.membership_id
  ) then
    return null;
  end if;

  if found and (
    lecture_row.status <> 'open'
    or lecture_row.hard_stop_at is null
    or lecture_row.hard_stop_at <= effective_now
  ) then
    authorization_row := private.expire_ai_master_authorization(
      target_lecture_session_id,
      'lecture_closed',
      'lecture_not_open',
      'system:lifecycle'
    );
  elsif found and authorization_row.expires_at <= effective_now then
    authorization_row := private.expire_ai_master_authorization(
      target_lecture_session_id,
      'expired',
      'authorization_expired',
      'system:expiry'
    );
  end if;

  return jsonb_build_object(
    'authorization', case
      when authorization_row.id is null then null::jsonb
      else private.ai_master_authorization_json(
        authorization_row,
        'admin-session:' || (context_value ->> 'admin_session_id')
      )
    end,
    'can_use_ai', (context_value ->> 'can_use_ai')::boolean,
    'lecture_open', lecture_row.status = 'open'
      and lecture_row.hard_stop_at is not null
      and lecture_row.hard_stop_at > effective_now,
    'server_time', effective_now
  );
end;
$$;

revoke all on function private.get_google_ai_master_status_v1(
  text, uuid, uuid, uuid
) from public, anon, authenticated, service_role;

create function public.get_google_ai_master_status_v1(
  target_token_hash text,
  target_auth_user_id uuid,
  target_supabase_auth_session_id uuid,
  target_lecture_session_id uuid
)
returns jsonb
language sql
volatile
security definer
set search_path = ''
as $$
  select private.get_google_ai_master_status_v1(
    target_token_hash,
    target_auth_user_id,
    target_supabase_auth_session_id,
    target_lecture_session_id
  );
$$;

revoke all on function public.get_google_ai_master_status_v1(
  text, uuid, uuid, uuid
) from public, anon, authenticated;
grant execute on function public.get_google_ai_master_status_v1(
  text, uuid, uuid, uuid
) to service_role;

create function private.downgrade_google_ai_master_v1(
  target_token_hash text,
  target_auth_user_id uuid,
  target_supabase_auth_session_id uuid,
  target_lecture_session_id uuid,
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
  ownership_row private.admin_lecture_ownerships%rowtype;
  control_receipt_row private.admin_ai_master_control_receipts%rowtype;
  lecture_row public.lecture_sessions%rowtype;
  authorization_row public.lecture_ai_master_authorizations%rowtype;
  requested_actions text[] :=
    private.ai_master_actions_for_scope('all_except_captions');
  actor_value text;
  effective_now timestamptz := statement_timestamp();
begin
  if target_lecture_session_id is null or target_request_id is null then
    raise exception 'invalid Google AI master downgrade' using errcode = '22023';
  end if;

  perform private.serialize_admin_ai_request_v1(target_request_id);
  context_value := private.require_google_ai_master_context_v1(
    target_token_hash,
    target_auth_user_id,
    target_supabase_auth_session_id,
    false
  );
  if context_value is null then
    return null;
  end if;
  actor_value := 'admin-session:' || (context_value ->> 'admin_session_id');

  select ownership.*
  into ownership_row
  from private.admin_lecture_ownerships as ownership
  where ownership.lecture_session_id = target_lecture_session_id
    and ownership.environment_id = (context_value ->> 'environment_id')::uuid
    and ownership.principal_id = (context_value ->> 'principal_id')::uuid
    and ownership.membership_id = (context_value ->> 'membership_id')::uuid;
  if not found then
    return null;
  end if;

  select receipt.*
  into control_receipt_row
  from private.admin_ai_master_control_receipts as receipt
  where receipt.request_id = target_request_id;
  if found then
    if control_receipt_row.control_action <> 'downgrade'
       or control_receipt_row.environment_id <> ownership_row.environment_id
       or control_receipt_row.principal_id <> ownership_row.principal_id
       or control_receipt_row.membership_id <> ownership_row.membership_id
       or control_receipt_row.admin_session_id <>
         (context_value ->> 'admin_session_id')::uuid
       or control_receipt_row.lecture_session_id <> target_lecture_session_id
       or control_receipt_row.requested_reason is not null then
      raise exception 'AI master control request binding mismatch'
        using errcode = 'P7335';
    end if;
    if control_receipt_row.master_authorization_id is null then
      return jsonb_build_object('accepted', true, 'already_inactive', true);
    end if;
    select master.*
    into authorization_row
    from public.lecture_ai_master_authorizations as master
    where master.id = control_receipt_row.master_authorization_id;
    return jsonb_build_object(
      'accepted', true,
      'control_replayed', true,
      'authorization', case
        when authorization_row.id is null then null::jsonb
        else private.ai_master_authorization_json(authorization_row, actor_value)
      end
    );
  end if;

  select lecture.*
  into lecture_row
  from public.lecture_sessions as lecture
  where lecture.id = target_lecture_session_id
  for update;
  if not found then
    return null;
  end if;

  select master.*
  into authorization_row
  from public.lecture_ai_master_authorizations as master
  where master.lecture_session_id = target_lecture_session_id
    and master.status = 'active'
  for update;

  if not found then
    insert into private.admin_ai_master_control_receipts (
      request_id, control_action, environment_id, principal_id, membership_id,
      admin_session_id, lecture_session_id, result_kind
    ) values (
      target_request_id, 'downgrade', ownership_row.environment_id,
      ownership_row.principal_id, ownership_row.membership_id,
      (context_value ->> 'admin_session_id')::uuid,
      target_lecture_session_id, 'already_inactive'
    );
    return jsonb_build_object('accepted', true, 'already_inactive', true);
  end if;
  if authorization_row.principal_id is null
     or not exists (
       select 1
       from private.admin_ai_master_admission_receipts as marker
       where marker.master_authorization_id = authorization_row.id
     )
     or authorization_row.principal_id <> ownership_row.principal_id
     or authorization_row.membership_id <> ownership_row.membership_id then
    return null;
  end if;

  if lecture_row.status <> 'open'
     or lecture_row.hard_stop_at is null
     or lecture_row.hard_stop_at <= effective_now then
    authorization_row := private.expire_ai_master_authorization(
      target_lecture_session_id,
      'lecture_closed',
      'lecture_not_open',
      'system:lifecycle'
    );
    insert into private.admin_ai_master_control_receipts (
      request_id, control_action, environment_id, principal_id, membership_id,
      admin_session_id, lecture_session_id, master_authorization_id,
      result_kind, resulting_scope, resulting_version
    ) values (
      target_request_id, 'downgrade', ownership_row.environment_id,
      ownership_row.principal_id, ownership_row.membership_id,
      (context_value ->> 'admin_session_id')::uuid,
      target_lecture_session_id, authorization_row.id, 'terminal',
      authorization_row.scope, authorization_row.version
    );
    return jsonb_build_object(
      'accepted', true,
      'authorization', private.ai_master_authorization_json(
        authorization_row,
        actor_value
      )
    );
  elsif authorization_row.expires_at <= effective_now then
    authorization_row := private.expire_ai_master_authorization(
      target_lecture_session_id,
      'expired',
      'authorization_expired',
      'system:expiry'
    );
    insert into private.admin_ai_master_control_receipts (
      request_id, control_action, environment_id, principal_id, membership_id,
      admin_session_id, lecture_session_id, master_authorization_id,
      result_kind, resulting_scope, resulting_version
    ) values (
      target_request_id, 'downgrade', ownership_row.environment_id,
      ownership_row.principal_id, ownership_row.membership_id,
      (context_value ->> 'admin_session_id')::uuid,
      target_lecture_session_id, authorization_row.id, 'terminal',
      authorization_row.scope, authorization_row.version
    );
    return jsonb_build_object(
      'accepted', true,
      'authorization', private.ai_master_authorization_json(
        authorization_row,
        actor_value
      )
    );
  end if;

  if authorization_row.scope = 'all_except_captions' then
    insert into private.admin_ai_master_control_receipts (
      request_id, control_action, environment_id, principal_id, membership_id,
      admin_session_id, lecture_session_id, master_authorization_id,
      result_kind, resulting_scope, resulting_version
    ) values (
      target_request_id, 'downgrade', ownership_row.environment_id,
      ownership_row.principal_id, ownership_row.membership_id,
      (context_value ->> 'admin_session_id')::uuid,
      target_lecture_session_id, authorization_row.id, 'active',
      authorization_row.scope, authorization_row.version
    );
    return jsonb_build_object(
      'accepted', true,
      'already_downgraded', true,
      'authorization', private.ai_master_authorization_json(
        authorization_row,
        actor_value
      )
    );
  end if;

  perform private.stop_captions_for_ai_master_scope_change(
    target_lecture_session_id
  );
  update public.lecture_ai_master_authorizations as master
  set
    scope = 'all_except_captions',
    actions = requested_actions,
    last_used_at = null,
    version = master.version + 1,
    updated_at = effective_now
  where master.id = authorization_row.id
  returning * into authorization_row;

  perform private.revoke_pending_ai_master_grants(
    authorization_row.id,
    'google_ai_master_downgrade'
  );

  insert into public.ai_master_authorization_events (
    authorization_id,
    lecture_session_id,
    event_type,
    actor_id,
    scope,
    actions,
    reason
  ) values (
    authorization_row.id,
    authorization_row.lecture_session_id,
    'scope_changed',
    actor_value,
    authorization_row.scope,
    authorization_row.actions,
    'google_ai_master_downgrade'
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
    ownership_row.environment_id,
    ownership_row.principal_id,
    ownership_row.membership_id,
    (context_value ->> 'admin_session_id')::uuid,
    'google_ai_master.downgrade',
    'lecture_ai_master_authorization',
    authorization_row.id::text,
    'accepted',
    'captions_removed',
    jsonb_build_object('version', authorization_row.version)
  );

  insert into private.admin_ai_master_control_receipts (
    request_id, control_action, environment_id, principal_id, membership_id,
    admin_session_id, lecture_session_id, master_authorization_id,
    result_kind, resulting_scope, resulting_version
  ) values (
    target_request_id, 'downgrade', ownership_row.environment_id,
    ownership_row.principal_id, ownership_row.membership_id,
    (context_value ->> 'admin_session_id')::uuid,
    target_lecture_session_id, authorization_row.id, 'active',
    authorization_row.scope, authorization_row.version
  );

  return jsonb_build_object(
    'accepted', true,
    'authorization', private.ai_master_authorization_json(
      authorization_row,
      actor_value
    )
  );
end;
$$;

revoke all on function private.downgrade_google_ai_master_v1(
  text, uuid, uuid, uuid, uuid
) from public, anon, authenticated, service_role;

create function public.downgrade_google_ai_master_v1(
  target_token_hash text,
  target_auth_user_id uuid,
  target_supabase_auth_session_id uuid,
  target_lecture_session_id uuid,
  target_request_id uuid
)
returns jsonb
language sql
volatile
security definer
set search_path = ''
as $$
  select private.downgrade_google_ai_master_v1(
    target_token_hash,
    target_auth_user_id,
    target_supabase_auth_session_id,
    target_lecture_session_id,
    target_request_id
  );
$$;

revoke all on function public.downgrade_google_ai_master_v1(
  text, uuid, uuid, uuid, uuid
) from public, anon, authenticated;
grant execute on function public.downgrade_google_ai_master_v1(
  text, uuid, uuid, uuid, uuid
) to service_role;

create function private.revoke_google_ai_master_v1(
  target_token_hash text,
  target_auth_user_id uuid,
  target_supabase_auth_session_id uuid,
  target_lecture_session_id uuid,
  target_request_id uuid,
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
  context_value jsonb;
  ownership_row private.admin_lecture_ownerships%rowtype;
  control_receipt_row private.admin_ai_master_control_receipts%rowtype;
  authorization_row public.lecture_ai_master_authorizations%rowtype;
  actor_value text;
  effective_reason text := nullif(trim(target_reason), '');
  effective_now timestamptz := statement_timestamp();
begin
  if target_lecture_session_id is null
     or target_request_id is null
     or effective_reason is null
     or char_length(effective_reason) > 120 then
    raise exception 'invalid Google AI master revoke' using errcode = '22023';
  end if;

  perform private.serialize_admin_ai_request_v1(target_request_id);
  context_value := private.require_google_ai_master_context_v1(
    target_token_hash,
    target_auth_user_id,
    target_supabase_auth_session_id,
    false
  );
  if context_value is null then
    return null;
  end if;
  actor_value := 'admin-session:' || (context_value ->> 'admin_session_id');

  select ownership.*
  into ownership_row
  from private.admin_lecture_ownerships as ownership
  where ownership.lecture_session_id = target_lecture_session_id
    and ownership.environment_id = (context_value ->> 'environment_id')::uuid
    and ownership.principal_id = (context_value ->> 'principal_id')::uuid
    and ownership.membership_id = (context_value ->> 'membership_id')::uuid;
  if not found then
    return null;
  end if;

  select receipt.*
  into control_receipt_row
  from private.admin_ai_master_control_receipts as receipt
  where receipt.request_id = target_request_id;
  if found then
    if control_receipt_row.control_action <> 'revoke'
       or control_receipt_row.environment_id <> ownership_row.environment_id
       or control_receipt_row.principal_id <> ownership_row.principal_id
       or control_receipt_row.membership_id <> ownership_row.membership_id
       or control_receipt_row.admin_session_id <>
         (context_value ->> 'admin_session_id')::uuid
       or control_receipt_row.lecture_session_id <> target_lecture_session_id
       or control_receipt_row.requested_reason is distinct from effective_reason then
      raise exception 'AI master control request binding mismatch'
        using errcode = 'P7335';
    end if;
    if control_receipt_row.master_authorization_id is null then
      return jsonb_build_object('accepted', true, 'already_inactive', true);
    end if;
    select master.*
    into authorization_row
    from public.lecture_ai_master_authorizations as master
    where master.id = control_receipt_row.master_authorization_id;
    return jsonb_build_object(
      'accepted', true,
      'control_replayed', true,
      'authorization', case
        when authorization_row.id is null then null::jsonb
        else private.ai_master_authorization_json(authorization_row, actor_value)
      end
    );
  end if;

  perform 1
  from public.lecture_sessions as lecture
  where lecture.id = target_lecture_session_id
  for update;
  if not found then
    return null;
  end if;

  select master.*
  into authorization_row
  from public.lecture_ai_master_authorizations as master
  where master.lecture_session_id = target_lecture_session_id
    and master.status = 'active'
  for update;

  if not found then
    insert into private.admin_ai_master_control_receipts (
      request_id, control_action, environment_id, principal_id, membership_id,
      admin_session_id, lecture_session_id, requested_reason, result_kind
    ) values (
      target_request_id, 'revoke', ownership_row.environment_id,
      ownership_row.principal_id, ownership_row.membership_id,
      (context_value ->> 'admin_session_id')::uuid,
      target_lecture_session_id, effective_reason, 'already_inactive'
    );
    return jsonb_build_object('accepted', true, 'already_inactive', true);
  end if;
  if authorization_row.principal_id is null
     or not exists (
       select 1
       from private.admin_ai_master_admission_receipts as marker
       where marker.master_authorization_id = authorization_row.id
     )
     or authorization_row.principal_id <> ownership_row.principal_id
     or authorization_row.membership_id <> ownership_row.membership_id then
    return null;
  end if;

  update public.lecture_ai_master_authorizations as master
  set
    status = 'revoked',
    revoked_at = effective_now,
    revoked_by_actor_id = actor_value,
    revoke_reason = effective_reason,
    version = master.version + 1,
    updated_at = effective_now
  where master.id = authorization_row.id
  returning * into authorization_row;

  perform private.revoke_pending_ai_grants_for_lecture(
    target_lecture_session_id,
    effective_reason
  );
  perform private.stop_summary_for_ai_master_transition(
    target_lecture_session_id,
    effective_reason
  );
  perform private.stop_lecture_ai_control(
    target_lecture_session_id,
    effective_reason,
    actor_value
  );

  insert into public.ai_master_authorization_events (
    authorization_id,
    lecture_session_id,
    event_type,
    actor_id,
    scope,
    actions,
    reason
  ) values (
    authorization_row.id,
    authorization_row.lecture_session_id,
    'revoked',
    actor_value,
    authorization_row.scope,
    authorization_row.actions,
    effective_reason
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
    ownership_row.environment_id,
    ownership_row.principal_id,
    ownership_row.membership_id,
    (context_value ->> 'admin_session_id')::uuid,
    'google_ai_master.revoke',
    'lecture_ai_master_authorization',
    authorization_row.id::text,
    'accepted',
    'teacher_revoked',
    jsonb_build_object('version', authorization_row.version)
  );

  insert into private.admin_ai_master_control_receipts (
    request_id, control_action, environment_id, principal_id, membership_id,
    admin_session_id, lecture_session_id, master_authorization_id,
    requested_reason, result_kind, resulting_scope, resulting_version
  ) values (
    target_request_id, 'revoke', ownership_row.environment_id,
    ownership_row.principal_id, ownership_row.membership_id,
    (context_value ->> 'admin_session_id')::uuid,
    target_lecture_session_id, authorization_row.id, effective_reason,
    'terminal', authorization_row.scope, authorization_row.version
  );

  return jsonb_build_object(
    'accepted', true,
    'authorization', private.ai_master_authorization_json(
      authorization_row,
      actor_value
    )
  );
end;
$$;

revoke all on function private.revoke_google_ai_master_v1(
  text, uuid, uuid, uuid, uuid, text
) from public, anon, authenticated, service_role;

create function public.revoke_google_ai_master_v1(
  target_token_hash text,
  target_auth_user_id uuid,
  target_supabase_auth_session_id uuid,
  target_lecture_session_id uuid,
  target_request_id uuid,
  target_reason text
)
returns jsonb
language sql
volatile
security definer
set search_path = ''
as $$
  select private.revoke_google_ai_master_v1(
    target_token_hash,
    target_auth_user_id,
    target_supabase_auth_session_id,
    target_lecture_session_id,
    target_request_id,
    target_reason
  );
$$;

revoke all on function public.revoke_google_ai_master_v1(
  text, uuid, uuid, uuid, uuid, text
) from public, anon, authenticated;
grant execute on function public.revoke_google_ai_master_v1(
  text, uuid, uuid, uuid, uuid, text
) to service_role;

-- C1 masters are deliberately dormant until C2 migrates provider/child-grant
-- authorization. Fence both named legacy RPCs and direct grant writes.
alter function private.authorize_ai_master(
  uuid, uuid, text, text, boolean
) rename to authorize_ai_master_pre_c1;
revoke all on function private.authorize_ai_master_pre_c1(
  uuid, uuid, text, text, boolean
) from public, anon, authenticated, service_role;

create function private.authorize_ai_master(
  target_lecture_session_id uuid,
  target_admin_session_id uuid,
  target_actor_id text,
  target_scope text,
  pin_succeeded boolean
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  authorization_row public.lecture_ai_master_authorizations%rowtype;
begin
  if exists (
    select 1
    from private.admin_lecture_ownerships as ownership
    where ownership.lecture_session_id = target_lecture_session_id
  ) then
    return jsonb_build_object(
      'accepted', false,
      'reason', 'google_master_requires_c2'
    );
  end if;

  perform 1
  from public.lecture_sessions as lecture
  where lecture.id = target_lecture_session_id
  for update;

  select master.*
  into authorization_row
  from public.lecture_ai_master_authorizations as master
  where master.lecture_session_id = target_lecture_session_id
    and master.status = 'active'
  for update;

  if found and (
    authorization_row.principal_id is not null
    or exists (
      select 1
      from private.admin_ai_master_admission_receipts as marker
      where marker.master_authorization_id = authorization_row.id
    )
  ) then
    return jsonb_build_object(
      'accepted', false,
      'reason', 'google_master_requires_c2'
    );
  end if;

  return private.authorize_ai_master_pre_c1(
    target_lecture_session_id,
    target_admin_session_id,
    target_actor_id,
    target_scope,
    pin_succeeded
  );
end;
$$;

revoke all on function private.authorize_ai_master(
  uuid, uuid, text, text, boolean
) from public, anon, authenticated, service_role;

create or replace function public.admin_authorize_ai_master(
  target_lecture_session_id uuid,
  target_admin_session_id uuid,
  target_actor_id text,
  target_scope text,
  pin_succeeded boolean
)
returns jsonb
language sql
volatile
security definer
set search_path = ''
as $$
  select private.authorize_ai_master(
    target_lecture_session_id,
    target_admin_session_id,
    target_actor_id,
    target_scope,
    pin_succeeded
  );
$$;

revoke all on function public.admin_authorize_ai_master(
  uuid, uuid, text, text, boolean
) from public, anon, authenticated;
grant execute on function public.admin_authorize_ai_master(
  uuid, uuid, text, text, boolean
) to service_role;

alter function private.issue_ai_billing_grant_from_master(
  uuid, uuid, text[], text, text
) rename to issue_ai_billing_grant_from_master_pre_c1;
revoke all on function private.issue_ai_billing_grant_from_master_pre_c1(
  uuid, uuid, text[], text, text
) from public, anon, authenticated, service_role;

create function private.issue_ai_billing_grant_from_master(
  target_lecture_session_id uuid,
  target_admin_session_id uuid,
  target_actions text[],
  target_nonce_hash text,
  target_actor_id text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  authorization_row public.lecture_ai_master_authorizations%rowtype;
begin
  if exists (
    select 1
    from private.admin_lecture_ownerships as ownership
    where ownership.lecture_session_id = target_lecture_session_id
  ) then
    return jsonb_build_object(
      'accepted', false,
      'reason', 'google_master_child_grant_deferred_to_c2'
    );
  end if;

  perform 1
  from public.lecture_sessions as lecture
  where lecture.id = target_lecture_session_id
  for update;

  select master.*
  into authorization_row
  from public.lecture_ai_master_authorizations as master
  where master.lecture_session_id = target_lecture_session_id
    and master.status = 'active'
  for update;

  if found and (
    authorization_row.principal_id is not null
    or exists (
      select 1
      from private.admin_ai_master_admission_receipts as marker
      where marker.master_authorization_id = authorization_row.id
    )
  ) then
    return jsonb_build_object(
      'accepted', false,
      'reason', 'google_master_child_grant_deferred_to_c2'
    );
  end if;

  return private.issue_ai_billing_grant_from_master_pre_c1(
    target_lecture_session_id,
    target_admin_session_id,
    target_actions,
    target_nonce_hash,
    target_actor_id
  );
end;
$$;

revoke all on function private.issue_ai_billing_grant_from_master(
  uuid, uuid, text[], text, text
) from public, anon, authenticated, service_role;

create or replace function public.admin_issue_ai_billing_grant_from_master(
  target_lecture_session_id uuid,
  target_admin_session_id uuid,
  target_actions text[],
  target_nonce_hash text,
  target_actor_id text
)
returns jsonb
language sql
volatile
security definer
set search_path = ''
as $$
  select private.issue_ai_billing_grant_from_master(
    target_lecture_session_id,
    target_admin_session_id,
    target_actions,
    target_nonce_hash,
    target_actor_id
  );
$$;

revoke all on function public.admin_issue_ai_billing_grant_from_master(
  uuid, uuid, text[], text, text
) from public, anon, authenticated;
grant execute on function public.admin_issue_ai_billing_grant_from_master(
  uuid, uuid, text[], text, text
) to service_role;

create or replace function private.enforce_ai_master_on_direct_grant_insert()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if new.master_authorization_id is null and exists (
    select 1
    from private.admin_lecture_ownerships as ownership
    where ownership.lecture_session_id = new.lecture_session_id
  ) then
    raise exception 'C1 owned lecture child authority is deferred to C2'
      using errcode = 'P7335';
  end if;

  if new.master_authorization_id is not null and exists (
    select 1
    from public.lecture_ai_master_authorizations as master
    where master.id = new.master_authorization_id
      and master.lecture_session_id = new.lecture_session_id
      and (
        master.principal_id is not null
        or exists (
          select 1
          from private.admin_ai_master_admission_receipts as marker
          where marker.master_authorization_id = master.id
        )
      )
  ) then
    raise exception 'C1 Google AI master child authority is deferred to C2'
      using errcode = 'P7335';
  end if;

  if new.master_authorization_id is null and exists (
    select 1
    from public.lecture_ai_master_authorizations as master
    where master.lecture_session_id = new.lecture_session_id
      and master.status = 'active'
      and master.expires_at > statement_timestamp()
  ) then
    raise exception 'lecture-wide AI authorization requires a child grant'
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;

revoke all on function private.enforce_ai_master_on_direct_grant_insert()
  from public, anon, authenticated, service_role;

create or replace function private.enforce_ai_master_on_child_grant_consume()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  authorization_row public.lecture_ai_master_authorizations%rowtype;
  session_is_active boolean;
begin
  if old.status <> 'issued' or new.status <> 'consumed' then
    return new;
  end if;

  if old.master_authorization_id is null then
    if exists (
      select 1
      from private.admin_lecture_ownerships as ownership
      where ownership.lecture_session_id = old.lecture_session_id
    ) then
      raise exception 'C1 owned lecture child authority is deferred to C2'
        using errcode = 'P7335';
    end if;

    if exists (
      select 1
      from public.lecture_ai_master_authorizations as master
      where master.lecture_session_id = old.lecture_session_id
        and (
          (
            master.status = 'active'
            and master.expires_at > statement_timestamp()
          )
          or (
            master.status <> 'active'
            and master.revoked_at is not null
            and master.revoked_at >= old.issued_at
          )
        )
    ) then
      raise exception 'direct AI grant is fenced by lecture-wide authorization'
        using errcode = 'P0001';
    end if;
    return new;
  end if;

  select master.*
  into authorization_row
  from public.lecture_ai_master_authorizations as master
  where master.id = old.master_authorization_id
    and master.lecture_session_id = old.lecture_session_id
  for update;

  if not found then
    raise exception 'master authorization is unavailable' using errcode = 'P0001';
  end if;

  if authorization_row.principal_id is not null
     or exists (
       select 1
       from private.admin_ai_master_admission_receipts as marker
       where marker.master_authorization_id = authorization_row.id
     ) then
    raise exception 'C1 Google AI master child authority is deferred to C2'
      using errcode = 'P7335';
  end if;

  select exists (
    select 1
    from public.admin_sessions as admin_session
    where admin_session.id = authorization_row.admin_session_id
      and admin_session.revoked_at is null
      and admin_session.expires_at > statement_timestamp()
      and admin_session.idle_expires_at > statement_timestamp()
  ) into session_is_active;

  if authorization_row.status <> 'active'
     or authorization_row.expires_at <= statement_timestamp()
     or not session_is_active
     or authorization_row.actor_id <> old.actor_id
     or not old.actions <@ authorization_row.actions then
    raise exception 'master authorization is no longer active'
      using errcode = 'P0001';
  end if;

  return new;
end;
$$;

revoke all on function private.enforce_ai_master_on_child_grant_consume()
  from public, anon, authenticated, service_role;

create function private.drain_c1_google_ai_master_scope_v1(
  target_source_kind text,
  target_source_id uuid,
  target_actor_id text,
  target_reason text,
  target_effective_at timestamptz
)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
set statement_timeout = '5s'
set lock_timeout = '750ms'
as $$
declare
  candidate record;
  authorization_row public.lecture_ai_master_authorizations%rowtype;
  revoked_count integer := 0;
begin
  if target_source_kind not in ('environment', 'principal', 'membership')
     or target_source_id is null
     or nullif(trim(target_actor_id), '') is null
     or char_length(target_actor_id) > 200
     or target_reason not in (
       'environment_access_changed',
       'membership_access_changed',
       'principal_access_changed'
     )
     or target_effective_at is null then
    raise exception 'invalid C1 master scope drain' using errcode = '22023';
  end if;

  for candidate in
    select master.id, master.lecture_session_id
    from public.lecture_ai_master_authorizations as master
    join private.admin_lecture_ownerships as ownership
      on ownership.lecture_session_id = master.lecture_session_id
    where master.status = 'active'
      and exists (
        select 1
        from private.admin_ai_master_admission_receipts as marker
        where marker.master_authorization_id = master.id
      )
      and (
        (target_source_kind = 'environment'
          and ownership.environment_id = target_source_id)
        or (target_source_kind = 'principal'
          and master.principal_id = target_source_id)
        or (target_source_kind = 'membership'
          and master.membership_id = target_source_id)
      )
    order by master.lecture_session_id, master.id
  loop
    perform 1
    from public.lecture_sessions as lecture
    where lecture.id = candidate.lecture_session_id
    for update;

    select master.*
    into authorization_row
    from public.lecture_ai_master_authorizations as master
    where master.id = candidate.id
      and master.status = 'active'
    for update;
    if not found then
      continue;
    end if;

    update public.lecture_ai_master_authorizations as master
    set
      status = 'revoked',
      revoked_at = target_effective_at,
      revoked_by_actor_id = target_actor_id,
      revoke_reason = target_reason,
      version = master.version + 1,
      updated_at = target_effective_at
    where master.id = authorization_row.id
    returning * into authorization_row;

    perform private.revoke_pending_ai_grants_for_lecture(
      authorization_row.lecture_session_id,
      target_reason
    );
    perform private.stop_summary_for_ai_master_transition(
      authorization_row.lecture_session_id,
      target_reason
    );
    perform private.stop_lecture_ai_control(
      authorization_row.lecture_session_id,
      target_reason,
      target_actor_id
    );

    insert into public.ai_master_authorization_events (
      authorization_id,
      lecture_session_id,
      event_type,
      actor_id,
      scope,
      actions,
      reason
    ) values (
      authorization_row.id,
      authorization_row.lecture_session_id,
      'revoked',
      target_actor_id,
      authorization_row.scope,
      authorization_row.actions,
      target_reason
    );
    revoked_count := revoked_count + 1;
  end loop;

  return revoked_count;
end;
$$;

revoke all on function private.drain_c1_google_ai_master_scope_v1(
  text, uuid, text, text, timestamptz
) from public, anon, authenticated, service_role;

create function private.drain_c1_master_on_membership_change_v1()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if old.status = 'active'
     and old.can_use_ai
     and (new.status <> 'active' or not new.can_use_ai) then
    perform private.drain_c1_google_ai_master_scope_v1(
      'membership',
      old.id,
      'system:membership',
      'membership_access_changed',
      statement_timestamp()
    );
  end if;
  return new;
end;
$$;

revoke all on function private.drain_c1_master_on_membership_change_v1()
  from public, anon, authenticated, service_role;
create trigger drain_c1_master_on_membership_change
after update of status, can_use_ai on private.admin_environment_memberships
for each row execute function private.drain_c1_master_on_membership_change_v1();

create function private.drain_c1_master_on_principal_change_v1()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if old.status = 'active' and new.status <> 'active' then
    perform private.drain_c1_google_ai_master_scope_v1(
      'principal',
      old.id,
      'system:principal',
      'principal_access_changed',
      statement_timestamp()
    );
  end if;
  return new;
end;
$$;

revoke all on function private.drain_c1_master_on_principal_change_v1()
  from public, anon, authenticated, service_role;
create trigger drain_c1_master_on_principal_change
after update of status on private.admin_principals
for each row execute function private.drain_c1_master_on_principal_change_v1();

create function private.drain_c1_master_on_environment_change_v1()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if old.status = 'active'
     and old.current_deployment
     and (new.status <> 'active' or not new.current_deployment) then
    perform private.drain_c1_google_ai_master_scope_v1(
      'environment',
      old.id,
      'system:environment',
      'environment_access_changed',
      statement_timestamp()
    );
  end if;
  return new;
end;
$$;

revoke all on function private.drain_c1_master_on_environment_change_v1()
  from public, anon, authenticated, service_role;
create trigger drain_c1_master_on_environment_change
after update of status, current_deployment on private.admin_environments
for each row execute function private.drain_c1_master_on_environment_change_v1();
