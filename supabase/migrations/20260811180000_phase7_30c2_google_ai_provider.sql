-- Phase 7.30C2: Google Admin AI child authority and the first provider start.
--
-- This migration is expand-only and default-OFF. A C1 full-provenance master
-- remains the human authorization boundary. C2 creates one short-lived child
-- per provider intent and requires a private start intent before that child
-- can be consumed. Raw nonces, bearer tokens and provider payloads are never
-- retained by the database.

alter table private.admin_ai_unlock_runtime_gate
  add column google_ai_child_grant_enabled boolean not null default false;

create table private.admin_google_ai_child_grant_receipts (
  request_id uuid primary key,
  grant_id uuid not null unique
    references public.ai_billing_grants(id)
    on delete restrict deferrable initially deferred,
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
  auth_user_id uuid not null,
  lecture_session_id uuid not null
    references public.lecture_sessions(id) on delete restrict,
  master_authorization_id uuid not null
    references public.lecture_ai_master_authorizations(id) on delete restrict,
  master_version_at_issue bigint not null check (master_version_at_issue >= 1),
  policy_id uuid not null
    references private.admin_ai_policies(id) on delete restrict,
  policy_version bigint not null check (policy_version >= 1),
  feature text not null check (feature in (
    'academic_answers', 'captions', 'material_analysis',
    'poll_suggestions', 'summaries'
  )),
  provider_intent_digest text not null
    check (provider_intent_digest ~ '^[0-9a-f]{64}$'),
  nonce_hash text not null unique check (nonce_hash ~ '^[0-9a-f]{64}$'),
  nonce_key_version integer not null check (nonce_key_version >= 1),
  issued_at timestamptz not null default statement_timestamp(),
  expires_at timestamptz not null,
  check (expires_at > issued_at)
);

create index admin_google_ai_child_receipts_environment_idx
  on private.admin_google_ai_child_grant_receipts (
    environment_id, issued_at desc, request_id
  );
create index admin_google_ai_child_receipts_principal_idx
  on private.admin_google_ai_child_grant_receipts (
    principal_id, issued_at desc, request_id
  );
create index admin_google_ai_child_receipts_membership_idx
  on private.admin_google_ai_child_grant_receipts (
    membership_id, issued_at desc, request_id
  );
create index admin_google_ai_child_receipts_session_idx
  on private.admin_google_ai_child_grant_receipts (
    admin_session_id, issued_at desc, request_id
  );
create index admin_google_ai_child_receipts_lecture_idx
  on private.admin_google_ai_child_grant_receipts (
    lecture_session_id, issued_at desc, request_id
  );
create index admin_google_ai_child_receipts_master_idx
  on private.admin_google_ai_child_grant_receipts (
    master_authorization_id, issued_at desc, request_id
  );
create index admin_google_ai_child_receipts_policy_idx
  on private.admin_google_ai_child_grant_receipts (
    policy_id, policy_version, issued_at desc
  );

create table private.admin_google_ai_provider_start_intents (
  start_request_id uuid primary key,
  child_grant_id uuid not null unique
    references public.ai_billing_grants(id) on delete restrict,
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
  policy_id uuid not null
    references private.admin_ai_policies(id) on delete restrict,
  policy_version bigint not null check (policy_version >= 1),
  feature text not null check (feature in ('material_analysis', 'poll_suggestions')),
  model_id text not null check (char_length(model_id) between 1 and 120),
  provider_family text not null check (provider_family = 'openai_responses_v1'),
  provider_intent_digest text not null
    check (provider_intent_digest ~ '^[0-9a-f]{64}$'),
  start_intent_digest text not null
    check (start_intent_digest ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default statement_timestamp()
);

create index admin_google_ai_start_intents_environment_idx
  on private.admin_google_ai_provider_start_intents (
    environment_id, created_at desc, start_request_id
  );
create index admin_google_ai_start_intents_principal_idx
  on private.admin_google_ai_provider_start_intents (
    principal_id, created_at desc, start_request_id
  );
create index admin_google_ai_start_intents_membership_idx
  on private.admin_google_ai_provider_start_intents (
    membership_id, created_at desc, start_request_id
  );
create index admin_google_ai_start_intents_session_idx
  on private.admin_google_ai_provider_start_intents (
    admin_session_id, created_at desc, start_request_id
  );
create index admin_google_ai_start_intents_lecture_idx
  on private.admin_google_ai_provider_start_intents (
    lecture_session_id, created_at desc, start_request_id
  );
create index admin_google_ai_start_intents_master_idx
  on private.admin_google_ai_provider_start_intents (
    master_authorization_id, created_at desc, start_request_id
  );
create index admin_google_ai_start_intents_policy_idx
  on private.admin_google_ai_provider_start_intents (
    policy_id, policy_version, created_at desc
  );

create table private.admin_google_ai_provider_start_receipts (
  start_request_id uuid primary key
    references private.admin_google_ai_provider_start_intents(start_request_id)
    on delete restrict,
  child_grant_id uuid not null unique
    references public.ai_billing_grants(id) on delete restrict,
  operation_id uuid not null unique
    references public.ai_usage_ledger(id) on delete restrict,
  result_status text not null check (result_status = 'started'),
  started_at timestamptz not null default statement_timestamp()
);

create index admin_google_ai_start_receipts_grant_idx
  on private.admin_google_ai_provider_start_receipts (
    child_grant_id, started_at desc
  );
create index admin_google_ai_start_receipts_operation_idx
  on private.admin_google_ai_provider_start_receipts (
    operation_id, started_at desc
  );

alter table private.admin_google_ai_child_grant_receipts enable row level security;
alter table private.admin_google_ai_provider_start_intents enable row level security;
alter table private.admin_google_ai_provider_start_receipts enable row level security;

revoke all on private.admin_google_ai_child_grant_receipts
  from public, anon, authenticated, service_role;
revoke all on private.admin_google_ai_provider_start_intents
  from public, anon, authenticated, service_role;
revoke all on private.admin_google_ai_provider_start_receipts
  from public, anon, authenticated, service_role;

create trigger admin_google_ai_child_receipts_append_only
before update or delete on private.admin_google_ai_child_grant_receipts
for each row execute function private.reject_admin_c1_evidence_mutation_v1();

create trigger admin_google_ai_start_intents_append_only
before update or delete on private.admin_google_ai_provider_start_intents
for each row execute function private.reject_admin_c1_evidence_mutation_v1();

create trigger admin_google_ai_start_receipts_append_only
before update or delete on private.admin_google_ai_provider_start_receipts
for each row execute function private.reject_admin_c1_evidence_mutation_v1();

create function private.require_google_ai_provider_context_v1(
  target_token_hash text,
  target_auth_user_id uuid,
  target_supabase_auth_session_id uuid,
  target_google_issuer text,
  target_provider_subject_hmac text,
  target_subject_pepper_version integer
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
  principal_row private.admin_principals%rowtype;
begin
  if target_google_issuer is distinct from 'https://accounts.google.com'
     or target_provider_subject_hmac is null
     or target_provider_subject_hmac !~ '^[0-9a-f]{64}$'
     or target_subject_pepper_version is null
     or target_subject_pepper_version < 1 then
    return null;
  end if;

  context_value := private.require_google_ai_master_context_v1(
    target_token_hash,
    target_auth_user_id,
    target_supabase_auth_session_id,
    true
  );
  if context_value is null then
    return null;
  end if;

  select principal.*
  into principal_row
  from private.admin_principals as principal
  where principal.id = (context_value ->> 'principal_id')::uuid
  for update;

  if not found
     or principal_row.google_issuer is distinct from target_google_issuer
     or principal_row.provider_subject_hmac is distinct from
       target_provider_subject_hmac
     or principal_row.subject_pepper_version is distinct from
       target_subject_pepper_version then
    return null;
  end if;

  return context_value;
end;
$$;

revoke all on function private.require_google_ai_provider_context_v1(
  text, uuid, uuid, text, text, integer
) from public, anon, authenticated, service_role;

create function private.google_ai_child_intent_digest_v1(
  target_request_id uuid,
  target_admin_session_id uuid,
  target_lecture_session_id uuid,
  target_feature text,
  target_provider_intent_digest text,
  target_nonce_hash text,
  target_nonce_key_version integer
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
      or target_feature is null
      or target_feature not in (
        'academic_answers', 'captions', 'material_analysis',
        'poll_suggestions', 'summaries'
      )
      or target_provider_intent_digest is null
      or target_provider_intent_digest !~ '^[0-9a-f]{64}$'
      or target_nonce_hash is null
      or target_nonce_hash !~ '^[0-9a-f]{64}$'
      or target_nonce_key_version is null
      or target_nonce_key_version < 1
      then null
    else pg_catalog.encode(
      extensions.digest(
        pg_catalog.convert_to(
          'compass:phase7.30c2:google-ai-child:v1'
          || '|request=' || target_request_id::text
          || '|session=' || target_admin_session_id::text
          || '|lecture=' || target_lecture_session_id::text
          || '|feature=' || target_feature
          || '|provider_intent=' || target_provider_intent_digest
          || '|nonce_hash=' || target_nonce_hash
          || '|nonce_key_version=' || target_nonce_key_version::text,
          'UTF8'
        ),
        'sha256'
      ),
      'hex'
    )
  end;
$$;

revoke all on function private.google_ai_child_intent_digest_v1(
  uuid, uuid, uuid, text, text, text, integer
) from public, anon, authenticated, service_role;

create function private.issue_google_ai_child_grant_v1(
  target_token_hash text,
  target_auth_user_id uuid,
  target_supabase_auth_session_id uuid,
  target_google_issuer text,
  target_provider_subject_hmac text,
  target_subject_pepper_version integer,
  target_lecture_session_id uuid,
  target_feature text,
  target_provider_intent_digest text,
  target_nonce_hash text,
  target_nonce_key_version integer,
  target_request_id uuid,
  target_transport_enabled boolean
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
  policy_snapshot private.admin_ai_policies%rowtype;
  policy_row private.admin_ai_policies%rowtype;
  lecture_row public.lecture_sessions%rowtype;
  master_snapshot public.lecture_ai_master_authorizations%rowtype;
  master_row public.lecture_ai_master_authorizations%rowtype;
  receipt_row private.admin_google_ai_child_grant_receipts%rowtype;
  grant_row public.ai_billing_grants%rowtype;
  identity_gate private.admin_identity_runtime_gate%rowtype;
  ai_gate private.admin_ai_unlock_runtime_gate%rowtype;
  intent_digest_value text;
  actor_value text;
  effective_expires_at timestamptz;
  effective_now timestamptz := statement_timestamp();
begin
  if target_request_id is null
     or target_lecture_session_id is null
     or target_feature is null
     or target_feature not in (
       'academic_answers', 'captions', 'material_analysis',
       'poll_suggestions', 'summaries'
     )
     or target_provider_intent_digest is null
     or target_provider_intent_digest !~ '^[0-9a-f]{64}$'
     or target_nonce_hash is null
     or target_nonce_hash !~ '^[0-9a-f]{64}$'
     or target_nonce_key_version is null
     or target_nonce_key_version < 1
     or target_transport_enabled is null then
    return null;
  end if;

  perform private.serialize_admin_ai_request_v1(target_request_id);
  context_value := private.require_google_ai_provider_context_v1(
    target_token_hash,
    target_auth_user_id,
    target_supabase_auth_session_id,
    target_google_issuer,
    target_provider_subject_hmac,
    target_subject_pepper_version
  );
  if context_value is null then
    return null;
  end if;

  actor_value := 'admin-session:' || (context_value ->> 'admin_session_id');
  intent_digest_value := private.google_ai_child_intent_digest_v1(
    target_request_id,
    (context_value ->> 'admin_session_id')::uuid,
    target_lecture_session_id,
    target_feature,
    target_provider_intent_digest,
    target_nonce_hash,
    target_nonce_key_version
  );
  if intent_digest_value is null then
    return null;
  end if;

  select receipt.*
  into receipt_row
  from private.admin_google_ai_child_grant_receipts as receipt
  where receipt.request_id = target_request_id;
  if found then
    if receipt_row.intent_digest is distinct from intent_digest_value
       or receipt_row.environment_id is distinct from
         (context_value ->> 'environment_id')::uuid
       or receipt_row.principal_id is distinct from
         (context_value ->> 'principal_id')::uuid
       or receipt_row.membership_id is distinct from
         (context_value ->> 'membership_id')::uuid
       or receipt_row.admin_session_id is distinct from
         (context_value ->> 'admin_session_id')::uuid
       or receipt_row.supabase_auth_session_id is distinct from
         target_supabase_auth_session_id
       or receipt_row.auth_user_id is distinct from target_auth_user_id
       or receipt_row.lecture_session_id is distinct from
         target_lecture_session_id
       or receipt_row.feature is distinct from target_feature
       or receipt_row.provider_intent_digest is distinct from
         target_provider_intent_digest
       or receipt_row.nonce_hash is distinct from target_nonce_hash
       or receipt_row.nonce_key_version is distinct from
         target_nonce_key_version then
      raise exception 'Google AI child request binding changed on retry'
        using errcode = 'P7335';
    end if;

    select grant_record.*
    into grant_row
    from public.ai_billing_grants as grant_record
    where grant_record.id = receipt_row.grant_id;
    if not found
       or grant_row.master_authorization_id is distinct from
         receipt_row.master_authorization_id
       or grant_row.lecture_session_id is distinct from
         receipt_row.lecture_session_id
       or grant_row.actor_id is distinct from actor_value
       or grant_row.actions is distinct from array[target_feature]::text[]
       or grant_row.nonce_hash is distinct from target_nonce_hash then
      raise exception 'Google AI child receipt is incomplete'
        using errcode = 'P7335';
    end if;

    return jsonb_build_object(
      'accepted', true,
      'actions', to_jsonb(grant_row.actions),
      'expires_at', grant_row.expires_at,
      'grant_id', grant_row.id,
      'idempotentReplay', true,
      'providerIntentDigest', receipt_row.provider_intent_digest,
      'status', grant_row.status
    );
  end if;

  select gate.*
  into identity_gate
  from private.admin_identity_runtime_gate as gate
  where gate.singleton
  for share;
  select gate.*
  into ai_gate
  from private.admin_ai_unlock_runtime_gate as gate
  where gate.singleton
  for share;
  if identity_gate.singleton is distinct from true
     or ai_gate.singleton is distinct from true
     or target_transport_enabled is distinct from true
     or identity_gate.google_operational_authorization_enabled
       is distinct from true
     or ai_gate.google_ai_child_grant_enabled is distinct from true then
    raise exception 'Google AI child admission is disabled'
      using errcode = 'P7338';
  end if;

  select ownership.*
  into ownership_row
  from private.admin_lecture_ownerships as ownership
  where ownership.lecture_session_id = target_lecture_session_id;
  if not found
     or ownership_row.environment_id is distinct from
       (context_value ->> 'environment_id')::uuid
     or ownership_row.principal_id is distinct from
       (context_value ->> 'principal_id')::uuid
     or ownership_row.membership_id is distinct from
       (context_value ->> 'membership_id')::uuid then
    raise exception 'lecture ownership is unavailable'
      using errcode = 'P7335';
  end if;

  select master.*
  into master_snapshot
  from public.lecture_ai_master_authorizations as master
  where master.lecture_session_id = target_lecture_session_id
    and master.status = 'active';
  if not found or master_snapshot.ai_policy_id is null then
    raise exception 'Google AI master is unavailable'
      using errcode = 'P7335';
  end if;

  perform private.serialize_admin_ai_scope_v1(
    'policy-membership',
    (context_value ->> 'membership_id')::uuid
  );
  select policy.*
  into policy_row
  from private.admin_ai_policies as policy
  where policy.id = master_snapshot.ai_policy_id
    and policy.version = master_snapshot.ai_policy_version
    and policy.environment_id = (context_value ->> 'environment_id')::uuid
    and policy.membership_id = (context_value ->> 'membership_id')::uuid
  for update;
  if not found
     or policy_row.status <> 'active'
     or policy_row.valid_from > effective_now
     or policy_row.valid_until <= effective_now
     or not array[target_feature]::text[] <@ policy_row.allowed_actions then
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
  into master_row
  from public.lecture_ai_master_authorizations as master
  where master.id = master_snapshot.id
    and master.lecture_session_id = target_lecture_session_id
  for update;
  if not found
     or master_row.status <> 'active'
     or master_row.expires_at <= effective_now
     or master_row.principal_id is distinct from
       (context_value ->> 'principal_id')::uuid
     or master_row.membership_id is distinct from
       (context_value ->> 'membership_id')::uuid
     or master_row.issuing_admin_session_id is distinct from
       (context_value ->> 'admin_session_id')::uuid
     or master_row.actor_id is distinct from actor_value
     or master_row.ai_policy_id is distinct from policy_row.id
     or master_row.ai_policy_version is distinct from policy_row.version
     or not array[target_feature]::text[] <@ master_row.actions
     or not exists (
       select 1
       from private.admin_ai_master_admission_receipts as marker
       where marker.master_authorization_id = master_row.id
         and marker.principal_id = master_row.principal_id
         and marker.membership_id = master_row.membership_id
         and marker.admin_session_id = master_row.issuing_admin_session_id
         and marker.policy_id = master_row.ai_policy_id
         and marker.policy_version = master_row.ai_policy_version
     ) then
    raise exception 'Google AI master is unavailable'
      using errcode = 'P7335';
  end if;

  effective_expires_at := least(
    effective_now + interval '2 minutes',
    lecture_row.hard_stop_at,
    master_row.expires_at,
    policy_row.valid_until,
    (context_value ->> 'expires_at')::timestamptz
  );
  if effective_expires_at <= effective_now then
    raise exception 'Google AI child lifetime is unavailable'
      using errcode = 'P7335';
  end if;

  begin
    insert into private.admin_google_ai_child_grant_receipts (
      request_id, grant_id, intent_digest, environment_id, principal_id,
      membership_id, admin_session_id, supabase_auth_session_id, auth_user_id,
      lecture_session_id, master_authorization_id, master_version_at_issue,
      policy_id, policy_version, feature, provider_intent_digest, nonce_hash,
      nonce_key_version, issued_at, expires_at
    ) values (
      target_request_id, target_request_id, intent_digest_value,
      (context_value ->> 'environment_id')::uuid,
      (context_value ->> 'principal_id')::uuid,
      (context_value ->> 'membership_id')::uuid,
      (context_value ->> 'admin_session_id')::uuid,
      target_supabase_auth_session_id, target_auth_user_id,
      target_lecture_session_id, master_row.id, master_row.version,
      policy_row.id, policy_row.version, target_feature,
      target_provider_intent_digest, target_nonce_hash,
      target_nonce_key_version, effective_now, effective_expires_at
    ) returning * into receipt_row;

    insert into public.ai_billing_grants (
      id, lecture_session_id, master_authorization_id, actor_id,
      actions, nonce_hash, expires_at
    ) values (
      target_request_id, target_lecture_session_id, master_row.id, actor_value,
      array[target_feature]::text[], target_nonce_hash, effective_expires_at
    ) returning * into grant_row;
  exception
    when unique_violation then
      raise exception 'Google AI child request collided with existing authority'
        using errcode = 'P7335';
  end;

  update public.lecture_ai_master_authorizations as master
  set
    last_used_at = effective_now,
    version = master.version + 1,
    updated_at = effective_now
  where master.id = master_row.id;

  insert into public.ai_master_authorization_events (
    authorization_id, lecture_session_id, event_type, actor_id,
    scope, actions, child_grant_id
  ) values (
    master_row.id, target_lecture_session_id, 'child_grant_issued',
    actor_value, master_row.scope, array[target_feature]::text[], grant_row.id
  );

  return jsonb_build_object(
    'accepted', true,
    'actions', to_jsonb(grant_row.actions),
    'expires_at', grant_row.expires_at,
    'grant_id', grant_row.id,
    'idempotentReplay', false,
    'providerIntentDigest', receipt_row.provider_intent_digest,
    'status', grant_row.status
  );
end;
$$;

revoke all on function private.issue_google_ai_child_grant_v1(
  text, uuid, uuid, text, text, integer, uuid, text, text, text,
  integer, uuid, boolean
) from public, anon, authenticated, service_role;

create or replace function private.enforce_ai_master_on_direct_grant_insert()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  google_master boolean := false;
begin
  if new.master_authorization_id is not null then
    select exists (
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
    ) into google_master;
  end if;

  if google_master then
    if not exists (
      select 1
      from private.admin_google_ai_child_grant_receipts as receipt
      where receipt.grant_id = new.id
        and receipt.lecture_session_id = new.lecture_session_id
        and receipt.master_authorization_id = new.master_authorization_id
        and receipt.feature = any(new.actions)
        and new.actions = array[receipt.feature]::text[]
        and receipt.nonce_hash = new.nonce_hash
        and receipt.expires_at = new.expires_at
        and new.actor_id = 'admin-session:' || receipt.admin_session_id::text
    ) then
      raise exception 'Google AI child grant requires immutable C2 evidence'
        using errcode = 'P7335';
    end if;
    return new;
  end if;

  if new.master_authorization_id is null and exists (
    select 1
    from private.admin_lecture_ownerships as ownership
    where ownership.lecture_session_id = new.lecture_session_id
  ) then
    raise exception 'C2 owned lecture child authority requires Google evidence'
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
  receipt_row private.admin_google_ai_child_grant_receipts%rowtype;
  start_intent_row private.admin_google_ai_provider_start_intents%rowtype;
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
      raise exception 'C2 owned lecture child authority requires Google evidence'
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
    raise exception 'master authorization is unavailable'
      using errcode = 'P0001';
  end if;

  if authorization_row.principal_id is not null
     or exists (
       select 1
       from private.admin_ai_master_admission_receipts as marker
       where marker.master_authorization_id = authorization_row.id
     ) then
    select receipt.*
    into receipt_row
    from private.admin_google_ai_child_grant_receipts as receipt
    where receipt.grant_id = old.id
      and receipt.lecture_session_id = old.lecture_session_id
      and receipt.master_authorization_id = old.master_authorization_id
      and old.actions = array[receipt.feature]::text[]
      and receipt.nonce_hash = old.nonce_hash;
    if not found then
      raise exception 'Google AI child consumption lacks C2 evidence'
        using errcode = 'P7335';
    end if;

    select intent.*
    into start_intent_row
    from private.admin_google_ai_provider_start_intents as intent
    where intent.child_grant_id = old.id
      and intent.environment_id = receipt_row.environment_id
      and intent.principal_id = receipt_row.principal_id
      and intent.membership_id = receipt_row.membership_id
      and intent.admin_session_id = receipt_row.admin_session_id
      and intent.supabase_auth_session_id =
        receipt_row.supabase_auth_session_id
      and intent.lecture_session_id = receipt_row.lecture_session_id
      and intent.master_authorization_id =
        receipt_row.master_authorization_id
      and intent.policy_id = receipt_row.policy_id
      and intent.policy_version = receipt_row.policy_version
      and intent.feature = receipt_row.feature
      and intent.provider_intent_digest =
        receipt_row.provider_intent_digest;
    if not found then
      raise exception 'Google AI child consumption lacks provider-start evidence'
        using errcode = 'P7335';
    end if;

    if authorization_row.status is distinct from 'active'
       or authorization_row.expires_at <= statement_timestamp()
       or authorization_row.principal_id is distinct from
         receipt_row.principal_id
       or authorization_row.membership_id is distinct from
         receipt_row.membership_id
       or authorization_row.issuing_admin_session_id is distinct from
         receipt_row.admin_session_id
       or authorization_row.actor_id is distinct from old.actor_id
       or authorization_row.ai_policy_id is distinct from
         receipt_row.policy_id
       or authorization_row.ai_policy_version is distinct from
         receipt_row.policy_version
       or not old.actions <@ authorization_row.actions then
      raise exception 'Google AI master is no longer active'
        using errcode = 'P7335';
    end if;
    return new;
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

create function private.google_material_provider_intent_digest_v1(
  target_lecture_session_id uuid,
  target_feature text,
  target_document_id text,
  target_document_version text,
  target_text_sha256 text,
  target_analysis_id uuid,
  target_page_start integer,
  target_page_end integer,
  target_model_id text,
  target_prompt_version text,
  target_input_price_microusd_per_million bigint,
  target_output_price_microusd_per_million bigint,
  target_max_output_tokens integer,
  target_estimated_microusd bigint,
  target_estimated_input_tokens bigint,
  target_estimated_output_tokens bigint
)
returns text
language sql
immutable
security definer
set search_path = ''
as $$
  select case
    when target_lecture_session_id is null
      or target_feature is null
      or target_feature not in ('material_analysis', 'poll_suggestions')
      or target_document_id is null
      or target_document_id !~ '^[a-z0-9][a-z0-9-]{0,63}$'
      or target_document_version is null
      or target_document_version !~ '^[0-9a-f]{64}$'
      or target_text_sha256 is null
      or target_text_sha256 !~ '^[0-9a-f]{64}$'
      or char_length(coalesce(target_model_id, '')) not between 1 and 120
      or char_length(coalesce(target_prompt_version, '')) not between 1 and 80
      or target_input_price_microusd_per_million is null
      or target_input_price_microusd_per_million not between 0 and 100000000
      or target_output_price_microusd_per_million is null
      or target_output_price_microusd_per_million not between 0 and 100000000
      or target_max_output_tokens is null
      or target_max_output_tokens not between 1 and 10000
      or target_estimated_microusd is null
      or target_estimated_microusd < 0
      or target_estimated_input_tokens is null
      or target_estimated_input_tokens not between 1 and 100000
      or target_estimated_output_tokens is null
      or target_estimated_output_tokens not between 1 and target_max_output_tokens
      or (
        target_feature = 'material_analysis'
        and (
          target_analysis_id is not null
          or target_page_start is not null
          or target_page_end is not null
        )
      )
      or (
        target_feature = 'poll_suggestions'
        and (
          target_analysis_id is null
          or target_page_start is null
          or target_page_end is null
        )
      )
      then null
    else pg_catalog.encode(
      extensions.digest(
        pg_catalog.convert_to(
          jsonb_build_object(
            'analysis_id', target_analysis_id,
            'document_id', target_document_id,
            'document_version', target_document_version,
            'estimated_input_tokens', target_estimated_input_tokens,
            'estimated_microusd', target_estimated_microusd,
            'estimated_output_tokens', target_estimated_output_tokens,
            'feature', target_feature,
            'input_price_microusd_per_million',
              target_input_price_microusd_per_million,
            'lecture_session_id', target_lecture_session_id,
            'max_output_tokens', target_max_output_tokens,
            'model_id', target_model_id,
            'output_price_microusd_per_million',
              target_output_price_microusd_per_million,
            'page_end', target_page_end,
            'page_start', target_page_start,
            'prompt_version', target_prompt_version,
            'text_sha256', target_text_sha256
          )::text,
          'UTF8'
        ),
        'sha256'
      ),
      'hex'
    )
  end;
$$;

revoke all on function private.google_material_provider_intent_digest_v1(
  uuid, text, text, text, text, uuid, integer, integer, text, text,
  bigint, bigint, integer, bigint, bigint, bigint
) from public, anon, authenticated, service_role;

create function public.issue_google_material_ai_child_grant_v1(
  target_token_hash text,
  target_auth_user_id uuid,
  target_supabase_auth_session_id uuid,
  target_google_issuer text,
  target_provider_subject_hmac text,
  target_subject_pepper_version integer,
  target_lecture_session_id uuid,
  target_feature text,
  target_nonce_hash text,
  target_nonce_key_version integer,
  target_request_id uuid,
  target_document_id text,
  target_document_version text,
  target_text_sha256 text,
  target_analysis_id uuid,
  target_page_start integer,
  target_page_end integer,
  target_model_id text,
  target_prompt_version text,
  target_input_price_microusd_per_million bigint,
  target_output_price_microusd_per_million bigint,
  target_max_output_tokens integer,
  target_estimated_microusd bigint,
  target_estimated_input_tokens bigint,
  target_estimated_output_tokens bigint,
  target_transport_enabled boolean
)
returns jsonb
language sql
volatile
security definer
set search_path = ''
as $$
  select private.issue_google_ai_child_grant_v1(
    target_token_hash,
    target_auth_user_id,
    target_supabase_auth_session_id,
    target_google_issuer,
    target_provider_subject_hmac,
    target_subject_pepper_version,
    target_lecture_session_id,
    target_feature,
    private.google_material_provider_intent_digest_v1(
      target_lecture_session_id,
      target_feature,
      target_document_id,
      target_document_version,
      target_text_sha256,
      target_analysis_id,
      target_page_start,
      target_page_end,
      target_model_id,
      target_prompt_version,
      target_input_price_microusd_per_million,
      target_output_price_microusd_per_million,
      target_max_output_tokens,
      target_estimated_microusd,
      target_estimated_input_tokens,
      target_estimated_output_tokens
    ),
    target_nonce_hash,
    target_nonce_key_version,
    target_request_id,
    target_transport_enabled
  );
$$;

revoke all on function public.issue_google_material_ai_child_grant_v1(
  text, uuid, uuid, text, text, integer, uuid, text, text, integer, uuid,
  text, text, text, uuid, integer, integer, text, text, bigint, bigint,
  integer, bigint, bigint, bigint, boolean
) from public, anon, authenticated;
grant execute on function public.issue_google_material_ai_child_grant_v1(
  text, uuid, uuid, text, text, integer, uuid, text, text, integer, uuid,
  text, text, text, uuid, integer, integer, text, text, bigint, bigint,
  integer, bigint, bigint, bigint, boolean
) to service_role;

create function private.assert_google_ai_start_intent_completed_v1()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from private.admin_google_ai_provider_start_receipts as receipt
    where receipt.start_request_id = new.start_request_id
      and receipt.child_grant_id = new.child_grant_id
  ) then
    raise exception 'Google AI provider start intent has no completion receipt'
      using errcode = '23514';
  end if;
  return null;
end;
$$;

revoke all on function private.assert_google_ai_start_intent_completed_v1()
  from public, anon, authenticated, service_role;

create constraint trigger admin_google_ai_start_intents_completed
after insert on private.admin_google_ai_provider_start_intents
deferrable initially deferred
for each row execute function private.assert_google_ai_start_intent_completed_v1();

create function private.start_google_admin_material_ai_operation_v1(
  target_token_hash text,
  target_auth_user_id uuid,
  target_supabase_auth_session_id uuid,
  target_google_issuer text,
  target_provider_subject_hmac text,
  target_subject_pepper_version integer,
  target_grant_id uuid,
  target_nonce_hash text,
  target_lecture_session_id uuid,
  target_feature text,
  target_start_request_id uuid,
  target_provider_intent_digest text,
  target_document_id text,
  target_document_version text,
  target_text_sha256 text,
  target_analysis_id uuid,
  target_page_start integer,
  target_page_end integer,
  target_model_id text,
  target_prompt_version text,
  target_input_price_microusd_per_million bigint,
  target_output_price_microusd_per_million bigint,
  target_max_output_tokens integer,
  target_estimated_microusd bigint,
  target_estimated_input_tokens bigint,
  target_estimated_output_tokens bigint,
  target_transport_enabled boolean
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
  child_receipt private.admin_google_ai_child_grant_receipts%rowtype;
  start_intent private.admin_google_ai_provider_start_intents%rowtype;
  start_receipt private.admin_google_ai_provider_start_receipts%rowtype;
  grant_row public.ai_billing_grants%rowtype;
  usage_row public.ai_usage_ledger%rowtype;
  document_row public.lecture_pdf_documents%rowtype;
  context_value jsonb;
  ownership_row private.admin_lecture_ownerships%rowtype;
  policy_row private.admin_ai_policies%rowtype;
  lecture_row public.lecture_sessions%rowtype;
  master_row public.lecture_ai_master_authorizations%rowtype;
  identity_gate private.admin_identity_runtime_gate%rowtype;
  ai_gate private.admin_ai_unlock_runtime_gate%rowtype;
  result_value jsonb;
  provider_digest_value text;
  start_digest_value text;
  operation_id_value uuid;
  actor_value text;
  lecture_calls bigint;
  daily_calls bigint;
  lecture_input_tokens bigint;
  daily_input_tokens bigint;
  lecture_output_tokens bigint;
  daily_output_tokens bigint;
  lecture_cost bigint;
  daily_cost bigint;
  policy_running bigint;
  minimum_reservation bigint;
  effective_now timestamptz := statement_timestamp();
  utc_day_start timestamptz := date_trunc(
    'day', statement_timestamp() at time zone 'UTC'
  ) at time zone 'UTC';
begin
  provider_digest_value := private.google_material_provider_intent_digest_v1(
    target_lecture_session_id,
    target_feature,
    target_document_id,
    target_document_version,
    target_text_sha256,
    target_analysis_id,
    target_page_start,
    target_page_end,
    target_model_id,
    target_prompt_version,
    target_input_price_microusd_per_million,
    target_output_price_microusd_per_million,
    target_max_output_tokens,
    target_estimated_microusd,
    target_estimated_input_tokens,
    target_estimated_output_tokens
  );
  if target_start_request_id is null
     or target_grant_id is null
     or target_nonce_hash is null
     or target_nonce_hash !~ '^[0-9a-f]{64}$'
     or provider_digest_value is null
     or target_provider_intent_digest is null
     or target_provider_intent_digest is distinct from provider_digest_value
     or target_transport_enabled is null then
    return null;
  end if;

  minimum_reservation := ceil(
    target_estimated_input_tokens::numeric
      * target_input_price_microusd_per_million::numeric / 1000000
    + target_estimated_output_tokens::numeric
      * target_output_price_microusd_per_million::numeric / 1000000
  )::bigint;
  if target_estimated_microusd < minimum_reservation then
    raise exception 'Google material AI cost reservation is too small'
      using errcode = '22023';
  end if;

  perform private.serialize_admin_ai_request_v1(target_start_request_id);

  -- Dual transport is still present in C2. Lock the one child before identity
  -- and lecture state so the legacy grant-first consumer cannot form a
  -- grant -> lecture / lecture -> grant cycle during the migration window.
  select grant_record.*
  into grant_row
  from public.ai_billing_grants as grant_record
  where grant_record.id = target_grant_id
  for update;
  if not found then
    return null;
  end if;

  context_value := private.require_google_ai_provider_context_v1(
    target_token_hash,
    target_auth_user_id,
    target_supabase_auth_session_id,
    target_google_issuer,
    target_provider_subject_hmac,
    target_subject_pepper_version
  );
  if context_value is null then
    return null;
  end if;
  actor_value := 'admin-session:' || (context_value ->> 'admin_session_id');

  start_digest_value := pg_catalog.encode(
    extensions.digest(
      pg_catalog.convert_to(
        'compass:phase7.30c2:google-ai-provider-start:v1'
        || '|request=' || target_start_request_id::text
        || '|session=' || (context_value ->> 'admin_session_id')
        || '|grant=' || target_grant_id::text
        || '|provider_intent=' || target_provider_intent_digest,
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );

  select receipt.*
  into child_receipt
  from private.admin_google_ai_child_grant_receipts as receipt
  where receipt.grant_id = target_grant_id;
  if not found
     or child_receipt.environment_id is distinct from
       (context_value ->> 'environment_id')::uuid
     or child_receipt.principal_id is distinct from
       (context_value ->> 'principal_id')::uuid
     or child_receipt.membership_id is distinct from
       (context_value ->> 'membership_id')::uuid
     or child_receipt.admin_session_id is distinct from
       (context_value ->> 'admin_session_id')::uuid
     or child_receipt.supabase_auth_session_id is distinct from
       target_supabase_auth_session_id
     or child_receipt.auth_user_id is distinct from target_auth_user_id
     or child_receipt.lecture_session_id is distinct from
       target_lecture_session_id
     or child_receipt.feature is distinct from target_feature
     or child_receipt.provider_intent_digest is distinct from
       target_provider_intent_digest
     or child_receipt.nonce_hash is distinct from target_nonce_hash then
    raise exception 'Google AI child evidence is unavailable'
      using errcode = 'P7335';
  end if;

  select receipt.*
  into start_receipt
  from private.admin_google_ai_provider_start_receipts as receipt
  where receipt.start_request_id = target_start_request_id;
  if found then
    select intent.*
    into start_intent
    from private.admin_google_ai_provider_start_intents as intent
    where intent.start_request_id = target_start_request_id;
    select grant_record.*
    into grant_row
    from public.ai_billing_grants as grant_record
    where grant_record.id = target_grant_id;
    select usage.*
    into usage_row
    from public.ai_usage_ledger as usage
    where usage.id = start_receipt.operation_id;
    if not found
       or start_intent.child_grant_id is distinct from target_grant_id
       or start_intent.environment_id is distinct from
         (context_value ->> 'environment_id')::uuid
       or start_intent.principal_id is distinct from
         (context_value ->> 'principal_id')::uuid
       or start_intent.membership_id is distinct from
         (context_value ->> 'membership_id')::uuid
       or start_intent.admin_session_id is distinct from
         (context_value ->> 'admin_session_id')::uuid
       or start_intent.supabase_auth_session_id is distinct from
         target_supabase_auth_session_id
       or start_intent.lecture_session_id is distinct from
         target_lecture_session_id
       or start_intent.feature is distinct from target_feature
       or start_intent.model_id is distinct from target_model_id
       or start_intent.provider_intent_digest is distinct from
         target_provider_intent_digest
       or start_intent.start_intent_digest is distinct from
         start_digest_value
       or start_receipt.child_grant_id is distinct from target_grant_id
       or grant_row.id is null
       or grant_row.lecture_session_id is distinct from target_lecture_session_id
       or grant_row.master_authorization_id is distinct from
         child_receipt.master_authorization_id
       or grant_row.actor_id is distinct from actor_value
       or grant_row.actions is distinct from array[target_feature]::text[]
       or grant_row.nonce_hash is distinct from target_nonce_hash
       or grant_row.status is distinct from 'consumed'
       or grant_row.operation_ids is distinct from
         array[start_receipt.operation_id]::uuid[]
       or usage_row.id is null
       or usage_row.lecture_session_id is distinct from target_lecture_session_id
       or usage_row.feature is distinct from target_feature
       or usage_row.idempotency_key is distinct from
         target_start_request_id::text
       or usage_row.requested_by_actor is distinct from actor_value then
      raise exception 'Google AI provider start binding changed on retry'
        using errcode = 'P7335';
    end if;
    return jsonb_build_object(
      'accepted', true,
      'actorId', 'admin-session:' || start_intent.admin_session_id::text,
      'idempotentReplay', true,
      'operationId', start_receipt.operation_id,
      'status', (
        usage_row.status
      )
    );
  end if;

  select gate.* into identity_gate
  from private.admin_identity_runtime_gate as gate
  where gate.singleton
  for share;
  select gate.* into ai_gate
  from private.admin_ai_unlock_runtime_gate as gate
  where gate.singleton
  for share;
  if identity_gate.singleton is distinct from true
     or ai_gate.singleton is distinct from true
     or target_transport_enabled is distinct from true
     or identity_gate.google_operational_authorization_enabled
       is distinct from true
     or ai_gate.google_ai_child_grant_enabled is distinct from true then
    raise exception 'Google AI provider start is disabled'
      using errcode = 'P7338';
  end if;

  select ownership.*
  into ownership_row
  from private.admin_lecture_ownerships as ownership
  where ownership.lecture_session_id = target_lecture_session_id;
  if not found
     or ownership_row.environment_id is distinct from
       (context_value ->> 'environment_id')::uuid
     or ownership_row.principal_id is distinct from
       (context_value ->> 'principal_id')::uuid
     or ownership_row.membership_id is distinct from
       (context_value ->> 'membership_id')::uuid then
    raise exception 'lecture ownership is unavailable' using errcode = 'P7335';
  end if;

  perform private.serialize_admin_ai_scope_v1(
    'policy-membership',
    (context_value ->> 'membership_id')::uuid
  );
  select policy.*
  into policy_row
  from private.admin_ai_policies as policy
  where policy.id = child_receipt.policy_id
    and policy.version = child_receipt.policy_version
    and policy.environment_id = (context_value ->> 'environment_id')::uuid
    and policy.membership_id = (context_value ->> 'membership_id')::uuid
  for update;
  if not found
     or policy_row.status <> 'active'
     or policy_row.valid_from > effective_now
     or policy_row.valid_until <= effective_now
     or not array[target_feature]::text[] <@ policy_row.allowed_actions
     or not array[target_model_id]::text[] <@ policy_row.allowed_models then
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
  into master_row
  from public.lecture_ai_master_authorizations as master
  where master.id = child_receipt.master_authorization_id
    and master.lecture_session_id = target_lecture_session_id
  for update;
  if not found
     or master_row.status <> 'active'
     or master_row.expires_at <= effective_now
     or master_row.principal_id is distinct from child_receipt.principal_id
     or master_row.membership_id is distinct from child_receipt.membership_id
     or master_row.issuing_admin_session_id is distinct from
       child_receipt.admin_session_id
     or master_row.actor_id is distinct from actor_value
     or master_row.ai_policy_id is distinct from policy_row.id
     or master_row.ai_policy_version is distinct from policy_row.version
     or not array[target_feature]::text[] <@ master_row.actions then
    raise exception 'Google AI master is unavailable' using errcode = 'P7335';
  end if;

  if grant_row.lecture_session_id is distinct from target_lecture_session_id
     or grant_row.master_authorization_id is distinct from master_row.id
     or grant_row.status is distinct from 'issued'
     or grant_row.expires_at <= effective_now
     or grant_row.actor_id is distinct from actor_value
     or grant_row.actions is distinct from array[target_feature]::text[]
     or grant_row.nonce_hash is distinct from target_nonce_hash then
    raise exception 'Google AI child is unavailable' using errcode = 'P7335';
  end if;

  select document.*
  into document_row
  from public.lecture_pdf_documents as document
  where document.lecture_session_id = target_lecture_session_id
    and document.document_id = target_document_id
    and document.document_version = target_document_version
    and document.visible
  for share;
  if not found
     or document_row.text_sha256 is distinct from target_text_sha256 then
    raise exception 'PDF extraction metadata does not match'
      using errcode = '23514';
  end if;
  if target_feature = 'material_analysis' then
    if target_analysis_id is not null
       or target_page_start is not null
       or target_page_end is not null then
      raise exception 'initial material analysis cannot have a page range'
        using errcode = '22023';
    end if;
  else
    perform 1
    from public.lecture_material_analyses as analysis
    where analysis.id = target_analysis_id
      and analysis.lecture_session_id = target_lecture_session_id
      and analysis.source_document_id = target_document_id
      and analysis.source_document_version = target_document_version
      and analysis.source_text_sha256 = target_text_sha256
      and analysis.status = 'active'
    for share;
    if not found
       or target_page_start is null
       or target_page_end is null
       or target_page_start not between 1 and document_row.page_count
       or target_page_end not between target_page_start and document_row.page_count then
      raise exception 'additional Poll request is not bound to an active analysis'
        using errcode = '22023';
    end if;
  end if;

  -- The C1 master proves the teacher's paid intent. The child activates only
  -- its single requested feature; normal provider starts do not ask for
  -- another TOTP prompt. This mirrors the legacy fresh-start transition while
  -- leaving every other feature untouched.
  update public.lecture_ai_control as control
  set
    status = case
      when exists (
        select 1
        from public.ai_usage_ledger as usage
        where usage.lecture_session_id = target_lecture_session_id
          and usage.status = 'running'
      ) then 'running'
      else 'ready'
    end,
    material_analysis_enabled = control.material_analysis_enabled
      or target_feature = 'material_analysis',
    poll_suggestions_enabled = control.poll_suggestions_enabled
      or target_feature = 'poll_suggestions',
    stop_requested_at = null,
    stopped_at = null,
    stop_reason = null,
    version = control.version + 1,
    updated_at = effective_now
  where control.lecture_session_id = target_lecture_session_id;
  if not found then
    raise exception 'AI control is not configured' using errcode = 'P7335';
  end if;

  select
    count(*) filter (where intent.lecture_session_id = target_lecture_session_id),
    count(*) filter (where intent.created_at >= utc_day_start),
    coalesce(sum(usage.reserved_input_tokens) filter (
      where intent.lecture_session_id = target_lecture_session_id
    ), 0),
    coalesce(sum(usage.reserved_input_tokens) filter (
      where intent.created_at >= utc_day_start
    ), 0),
    coalesce(sum(usage.reserved_output_tokens) filter (
      where intent.lecture_session_id = target_lecture_session_id
    ), 0),
    coalesce(sum(usage.reserved_output_tokens) filter (
      where intent.created_at >= utc_day_start
    ), 0),
    coalesce(sum(usage.reserved_microusd) filter (
      where intent.lecture_session_id = target_lecture_session_id
    ), 0),
    coalesce(sum(usage.reserved_microusd) filter (
      where intent.created_at >= utc_day_start
    ), 0),
    count(*) filter (where usage.status = 'running')
  into
    lecture_calls, daily_calls,
    lecture_input_tokens, daily_input_tokens,
    lecture_output_tokens, daily_output_tokens,
    lecture_cost, daily_cost, policy_running
  from private.admin_google_ai_provider_start_intents as intent
  join private.admin_google_ai_provider_start_receipts as receipt
    on receipt.start_request_id = intent.start_request_id
  join public.ai_usage_ledger as usage
    on usage.id = receipt.operation_id
  where intent.policy_id = policy_row.id
    and intent.policy_version = policy_row.version;

  if lecture_calls + 1 > policy_row.max_calls_per_lecture
     or daily_calls + 1 > policy_row.max_calls_per_day
     or lecture_input_tokens + target_estimated_input_tokens >
       policy_row.max_input_tokens_per_lecture
     or daily_input_tokens + target_estimated_input_tokens >
       policy_row.max_input_tokens_per_day
     or lecture_output_tokens + target_estimated_output_tokens >
       policy_row.max_output_tokens_per_lecture
     or daily_output_tokens + target_estimated_output_tokens >
       policy_row.max_output_tokens_per_day
     or lecture_cost + target_estimated_microusd >
       policy_row.max_cost_microusd_per_lecture
     or daily_cost + target_estimated_microusd >
       policy_row.max_cost_microusd_per_day
     or policy_running + 1 > policy_row.max_concurrency then
    raise exception 'AI policy usage limit is unavailable'
      using errcode = 'P7335';
  end if;

  insert into private.admin_google_ai_provider_start_intents (
    start_request_id, child_grant_id, environment_id, principal_id,
    membership_id, admin_session_id, supabase_auth_session_id,
    lecture_session_id, master_authorization_id, policy_id, policy_version,
    feature, model_id, provider_family, provider_intent_digest,
    start_intent_digest, created_at
  ) values (
    target_start_request_id, target_grant_id,
    (context_value ->> 'environment_id')::uuid,
    (context_value ->> 'principal_id')::uuid,
    (context_value ->> 'membership_id')::uuid,
    (context_value ->> 'admin_session_id')::uuid,
    target_supabase_auth_session_id,
    target_lecture_session_id, master_row.id, policy_row.id,
    policy_row.version, target_feature, target_model_id,
    'openai_responses_v1', target_provider_intent_digest,
    start_digest_value, effective_now
  ) returning * into start_intent;

  result_value := private.start_lecture_ai_operation(
    target_lecture_session_id,
    target_feature,
    target_start_request_id::text,
    target_estimated_microusd,
    0,
    target_estimated_input_tokens,
    target_estimated_output_tokens,
    actor_value
  );
  if coalesce((result_value ->> 'accepted')::boolean, false) is not true then
    raise exception 'Google material provider start was rejected: %',
      coalesce(result_value ->> 'reason', 'unknown')
      using errcode = 'P7335';
  end if;
  if (result_value ->> 'idempotent_replay')::boolean is distinct from false then
    raise exception 'Google material provider start collided with existing usage'
      using errcode = 'P7335';
  end if;
  operation_id_value := (result_value #>> '{operation,id}')::uuid;
  select usage.*
  into usage_row
  from public.ai_usage_ledger as usage
  where usage.id = operation_id_value
  for update;
  if not found
     or usage_row.lecture_session_id is distinct from target_lecture_session_id
     or usage_row.feature is distinct from target_feature
     or usage_row.idempotency_key is distinct from target_start_request_id::text
     or usage_row.requested_by_actor is distinct from actor_value
     or usage_row.status is distinct from 'running'
     or usage_row.reserved_microusd is distinct from target_estimated_microusd
     or usage_row.reserved_audio_seconds is distinct from 0
     or usage_row.reserved_input_tokens is distinct from
       target_estimated_input_tokens
     or usage_row.reserved_output_tokens is distinct from
       target_estimated_output_tokens then
    raise exception 'Google material provider start has no operation receipt'
      using errcode = 'P7335';
  end if;

  update public.ai_usage_ledger as usage
  set
    model_id = target_model_id,
    pricing_unit = 'token',
    pricing_rate_microusd = ceil(
      target_output_price_microusd_per_million::numeric / 1000000
    )::bigint,
    last_heartbeat_at = effective_now
  where usage.id = operation_id_value;

  insert into public.material_ai_operation_contexts (
    operation_id, lecture_session_id, feature, source_document_id,
    source_document_version, source_text_sha256, analysis_id,
    requested_page_start, requested_page_end, prompt_version, model_id,
    input_price_microusd_per_million,
    output_price_microusd_per_million, max_output_tokens
  ) values (
    operation_id_value, target_lecture_session_id, target_feature,
    target_document_id, target_document_version, target_text_sha256,
    target_analysis_id, target_page_start, target_page_end,
    target_prompt_version, target_model_id,
    target_input_price_microusd_per_million,
    target_output_price_microusd_per_million, target_max_output_tokens
  );

  update public.ai_billing_grants as grant_record
  set
    status = 'consumed',
    consumed_at = effective_now,
    operation_ids = array[operation_id_value]::uuid[]
  where grant_record.id = target_grant_id
    and grant_record.status = 'issued'
  returning * into grant_row;
  if not found then
    raise exception 'Google AI child could not be consumed'
      using errcode = 'P7335';
  end if;

  insert into private.admin_google_ai_provider_start_receipts (
    start_request_id, child_grant_id, operation_id, result_status, started_at
  ) values (
    target_start_request_id, target_grant_id, operation_id_value,
    'started', effective_now
  ) returning * into start_receipt;

  return result_value || jsonb_build_object(
    'actorId', actor_value,
    'idempotentReplay', false,
    'operationId', operation_id_value
  );
end;
$$;

revoke all on function private.start_google_admin_material_ai_operation_v1(
  text, uuid, uuid, text, text, integer, uuid, text, uuid, text, uuid, text,
  text, text, text, uuid, integer, integer, text, text, bigint, bigint,
  integer, bigint, bigint, bigint, boolean
) from public, anon, authenticated, service_role;

create function public.start_google_admin_material_ai_operation_v1(
  target_token_hash text,
  target_auth_user_id uuid,
  target_supabase_auth_session_id uuid,
  target_google_issuer text,
  target_provider_subject_hmac text,
  target_subject_pepper_version integer,
  target_grant_id uuid,
  target_nonce_hash text,
  target_lecture_session_id uuid,
  target_feature text,
  target_start_request_id uuid,
  target_provider_intent_digest text,
  target_document_id text,
  target_document_version text,
  target_text_sha256 text,
  target_analysis_id uuid,
  target_page_start integer,
  target_page_end integer,
  target_model_id text,
  target_prompt_version text,
  target_input_price_microusd_per_million bigint,
  target_output_price_microusd_per_million bigint,
  target_max_output_tokens integer,
  target_estimated_microusd bigint,
  target_estimated_input_tokens bigint,
  target_estimated_output_tokens bigint,
  target_transport_enabled boolean
)
returns jsonb
language sql
volatile
security definer
set search_path = ''
as $$
  select private.start_google_admin_material_ai_operation_v1(
    target_token_hash,
    target_auth_user_id,
    target_supabase_auth_session_id,
    target_google_issuer,
    target_provider_subject_hmac,
    target_subject_pepper_version,
    target_grant_id,
    target_nonce_hash,
    target_lecture_session_id,
    target_feature,
    target_start_request_id,
    target_provider_intent_digest,
    target_document_id,
    target_document_version,
    target_text_sha256,
    target_analysis_id,
    target_page_start,
    target_page_end,
    target_model_id,
    target_prompt_version,
    target_input_price_microusd_per_million,
    target_output_price_microusd_per_million,
    target_max_output_tokens,
    target_estimated_microusd,
    target_estimated_input_tokens,
    target_estimated_output_tokens,
    target_transport_enabled
  );
$$;

revoke all on function public.start_google_admin_material_ai_operation_v1(
  text, uuid, uuid, text, text, integer, uuid, text, uuid, text, uuid, text,
  text, text, text, uuid, integer, integer, text, text, bigint, bigint,
  integer, bigint, bigint, bigint, boolean
) from public, anon, authenticated;
grant execute on function public.start_google_admin_material_ai_operation_v1(
  text, uuid, uuid, text, text, integer, uuid, text, uuid, text, uuid, text,
  text, text, text, uuid, integer, integer, text, text, bigint, bigint,
  integer, bigint, bigint, bigint, boolean
) to service_role;

-- Provider calls outlive the transaction that reserved their usage. Keep a
-- separate immutable settlement context so a failure can still close the
-- ledger after logout, while a successful result must re-prove live Google
-- authority before any provider payload is saved.
create function private.require_google_ai_provider_settlement_context_v1(
  target_token_hash text,
  target_auth_user_id uuid,
  target_supabase_auth_session_id uuid,
  target_google_issuer text,
  target_provider_subject_hmac text,
  target_subject_pepper_version integer,
  target_start_request_id uuid,
  target_operation_id uuid
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
  start_intent private.admin_google_ai_provider_start_intents%rowtype;
  start_receipt private.admin_google_ai_provider_start_receipts%rowtype;
  child_receipt private.admin_google_ai_child_grant_receipts%rowtype;
  session_snapshot public.admin_sessions%rowtype;
  session_row public.admin_sessions%rowtype;
  principal_row private.admin_principals%rowtype;
  membership_row private.admin_environment_memberships%rowtype;
  environment_row private.admin_environments%rowtype;
  usage_row public.ai_usage_ledger%rowtype;
  actor_value text;
begin
  if target_token_hash is null
     or target_token_hash !~ '^[0-9a-f]{64}$'
     or target_auth_user_id is null
     or target_supabase_auth_session_id is null
     or target_google_issuer is distinct from 'https://accounts.google.com'
     or target_provider_subject_hmac is null
     or target_provider_subject_hmac !~ '^[0-9a-f]{64}$'
     or target_subject_pepper_version is null
     or target_subject_pepper_version < 1
     or target_start_request_id is null
     or target_operation_id is null then
    return null;
  end if;

  perform private.serialize_admin_ai_request_v1(target_start_request_id);

  select intent.*
  into start_intent
  from private.admin_google_ai_provider_start_intents as intent
  where intent.start_request_id = target_start_request_id;
  if not found then
    return null;
  end if;

  select receipt.*
  into start_receipt
  from private.admin_google_ai_provider_start_receipts as receipt
  where receipt.start_request_id = target_start_request_id
    and receipt.child_grant_id = start_intent.child_grant_id
    and receipt.operation_id = target_operation_id
    and receipt.result_status = 'started';
  if not found then
    return null;
  end if;

  -- Discover the immutable lock chain without locking, then take the same
  -- principal -> membership -> environment -> Admin-session order as C1/C2.
  select session.*
  into session_snapshot
  from public.admin_sessions as session
  where session.id = start_intent.admin_session_id
    and session.token_hash = target_token_hash
    and session.authentication_method = 'google_totp'
    and session.aal = 2
    and session.auth_user_id = target_auth_user_id
    and session.supabase_auth_session_id = target_supabase_auth_session_id
    and session.environment_id = start_intent.environment_id
    and session.principal_id = start_intent.principal_id
    and session.membership_id = start_intent.membership_id;
  if not found then
    return null;
  end if;

  select principal.*
  into principal_row
  from private.admin_principals as principal
  where principal.id = start_intent.principal_id
    and principal.auth_user_id = target_auth_user_id
  for update;
  if not found
     or principal_row.google_issuer is distinct from target_google_issuer
     or principal_row.provider_subject_hmac is distinct from
       target_provider_subject_hmac
     or principal_row.subject_pepper_version is distinct from
       target_subject_pepper_version then
    return null;
  end if;

  select membership.*
  into membership_row
  from private.admin_environment_memberships as membership
  where membership.id = start_intent.membership_id
    and membership.environment_id = start_intent.environment_id
    and membership.principal_id = start_intent.principal_id
  for update;
  if not found then
    return null;
  end if;

  select environment.*
  into environment_row
  from private.admin_environments as environment
  where environment.id = start_intent.environment_id
  for share;
  if not found then
    return null;
  end if;

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

  select receipt.*
  into child_receipt
  from private.admin_google_ai_child_grant_receipts as receipt
  where receipt.grant_id = start_intent.child_grant_id;
  actor_value := 'admin-session:' || start_intent.admin_session_id::text;
  if not found
     or child_receipt.environment_id is distinct from start_intent.environment_id
     or child_receipt.principal_id is distinct from start_intent.principal_id
     or child_receipt.membership_id is distinct from start_intent.membership_id
     or child_receipt.admin_session_id is distinct from
       start_intent.admin_session_id
     or child_receipt.supabase_auth_session_id is distinct from
       start_intent.supabase_auth_session_id
     or child_receipt.auth_user_id is distinct from target_auth_user_id
     or child_receipt.lecture_session_id is distinct from
       start_intent.lecture_session_id
     or child_receipt.master_authorization_id is distinct from
       start_intent.master_authorization_id
     or child_receipt.policy_id is distinct from start_intent.policy_id
     or child_receipt.policy_version is distinct from start_intent.policy_version
     or child_receipt.feature is distinct from start_intent.feature then
    return null;
  end if;

  select usage.*
  into usage_row
  from public.ai_usage_ledger as usage
  where usage.id = target_operation_id;
  if not found
     or usage_row.lecture_session_id is distinct from
       start_intent.lecture_session_id
     or usage_row.feature is distinct from start_intent.feature
     or usage_row.idempotency_key is distinct from
       target_start_request_id::text
     or usage_row.requested_by_actor is distinct from actor_value then
    return null;
  end if;

  return jsonb_build_object(
    'actor_id', actor_value,
    'admin_session_id', start_intent.admin_session_id,
    'environment_id', start_intent.environment_id,
    'feature', start_intent.feature,
    'lecture_session_id', start_intent.lecture_session_id,
    'master_authorization_id', start_intent.master_authorization_id,
    'membership_id', start_intent.membership_id,
    'model_id', start_intent.model_id,
    'operation_id', start_receipt.operation_id,
    'policy_id', start_intent.policy_id,
    'policy_version', start_intent.policy_version,
    'principal_id', start_intent.principal_id,
    'supabase_auth_session_id', start_intent.supabase_auth_session_id
  );
end;
$$;

revoke all on function private.require_google_ai_provider_settlement_context_v1(
  text, uuid, uuid, text, text, integer, uuid, uuid
) from public, anon, authenticated, service_role;

create function private.fail_google_admin_material_ai_operation_v1(
  target_token_hash text,
  target_auth_user_id uuid,
  target_supabase_auth_session_id uuid,
  target_google_issuer text,
  target_provider_subject_hmac text,
  target_subject_pepper_version integer,
  target_start_request_id uuid,
  target_operation_id uuid,
  target_status text,
  actual_microusd bigint,
  actual_input_tokens bigint,
  actual_output_tokens bigint,
  provider_request_id text,
  error_code text
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
  evidence jsonb;
  lecture_row public.lecture_sessions%rowtype;
begin
  if target_status not in ('failed', 'cancelled') then
    raise exception 'invalid Google material provider failure status'
      using errcode = '22023';
  end if;

  evidence := private.require_google_ai_provider_settlement_context_v1(
    target_token_hash,
    target_auth_user_id,
    target_supabase_auth_session_id,
    target_google_issuer,
    target_provider_subject_hmac,
    target_subject_pepper_version,
    target_start_request_id,
    target_operation_id
  );
  if evidence is null then
    return null;
  end if;

  -- Settle after the canonical lecture lock. This remains available after
  -- logout or factor revocation, but can never publish provider output.
  select lecture.*
  into lecture_row
  from public.lecture_sessions as lecture
  where lecture.id = (evidence ->> 'lecture_session_id')::uuid
  for update;
  if not found then
    return null;
  end if;

  return private.fail_material_ai_operation(
    target_operation_id,
    evidence ->> 'actor_id',
    target_status,
    actual_microusd,
    actual_input_tokens,
    actual_output_tokens,
    provider_request_id,
    error_code
  );
end;
$$;

revoke all on function private.fail_google_admin_material_ai_operation_v1(
  text, uuid, uuid, text, text, integer, uuid, uuid, text, bigint, bigint,
  bigint, text, text
) from public, anon, authenticated, service_role;

create function public.fail_google_admin_material_ai_operation_v1(
  target_token_hash text,
  target_auth_user_id uuid,
  target_supabase_auth_session_id uuid,
  target_google_issuer text,
  target_provider_subject_hmac text,
  target_subject_pepper_version integer,
  target_start_request_id uuid,
  target_operation_id uuid,
  target_status text,
  actual_microusd bigint,
  actual_input_tokens bigint,
  actual_output_tokens bigint,
  provider_request_id text,
  error_code text
)
returns jsonb
language sql
volatile
security definer
set search_path = ''
as $$
  select private.fail_google_admin_material_ai_operation_v1(
    target_token_hash,
    target_auth_user_id,
    target_supabase_auth_session_id,
    target_google_issuer,
    target_provider_subject_hmac,
    target_subject_pepper_version,
    target_start_request_id,
    target_operation_id,
    target_status,
    actual_microusd,
    actual_input_tokens,
    actual_output_tokens,
    provider_request_id,
    error_code
  );
$$;

revoke all on function public.fail_google_admin_material_ai_operation_v1(
  text, uuid, uuid, text, text, integer, uuid, uuid, text, bigint, bigint,
  bigint, text, text
) from public, anon, authenticated;
grant execute on function public.fail_google_admin_material_ai_operation_v1(
  text, uuid, uuid, text, text, integer, uuid, uuid, text, bigint, bigint,
  bigint, text, text
) to service_role;

create function private.complete_google_admin_material_ai_operation_v1(
  target_token_hash text,
  target_auth_user_id uuid,
  target_supabase_auth_session_id uuid,
  target_google_issuer text,
  target_provider_subject_hmac text,
  target_subject_pepper_version integer,
  target_start_request_id uuid,
  target_operation_id uuid,
  target_result jsonb,
  actual_microusd bigint,
  actual_input_tokens bigint,
  actual_output_tokens bigint,
  provider_request_id text
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
  evidence jsonb;
  context_value jsonb;
  ownership_row private.admin_lecture_ownerships%rowtype;
  policy_row private.admin_ai_policies%rowtype;
  lecture_row public.lecture_sessions%rowtype;
  master_row public.lecture_ai_master_authorizations%rowtype;
  settlement jsonb;
  authority_is_live boolean := true;
  effective_now timestamptz := statement_timestamp();
begin
  evidence := private.require_google_ai_provider_settlement_context_v1(
    target_token_hash,
    target_auth_user_id,
    target_supabase_auth_session_id,
    target_google_issuer,
    target_provider_subject_hmac,
    target_subject_pepper_version,
    target_start_request_id,
    target_operation_id
  );
  if evidence is null then
    return null;
  end if;

  context_value := private.require_google_ai_provider_context_v1(
    target_token_hash,
    target_auth_user_id,
    target_supabase_auth_session_id,
    target_google_issuer,
    target_provider_subject_hmac,
    target_subject_pepper_version
  );
  authority_is_live := context_value is not null
    and (context_value ->> 'environment_id')::uuid is not distinct from
      (evidence ->> 'environment_id')::uuid
    and (context_value ->> 'principal_id')::uuid is not distinct from
      (evidence ->> 'principal_id')::uuid
    and (context_value ->> 'membership_id')::uuid is not distinct from
      (evidence ->> 'membership_id')::uuid
    and (context_value ->> 'admin_session_id')::uuid is not distinct from
      (evidence ->> 'admin_session_id')::uuid
    and (context_value ->> 'supabase_auth_session_id')::uuid is not distinct from
      (evidence ->> 'supabase_auth_session_id')::uuid;

  if authority_is_live then
    select ownership.*
    into ownership_row
    from private.admin_lecture_ownerships as ownership
    where ownership.lecture_session_id =
      (evidence ->> 'lecture_session_id')::uuid;
    authority_is_live := found
      and ownership_row.environment_id is not distinct from
        (evidence ->> 'environment_id')::uuid
      and ownership_row.principal_id is not distinct from
        (evidence ->> 'principal_id')::uuid
      and ownership_row.membership_id is not distinct from
        (evidence ->> 'membership_id')::uuid;

    perform private.serialize_admin_ai_scope_v1(
      'policy-membership',
      (evidence ->> 'membership_id')::uuid
    );
    select policy.*
    into policy_row
    from private.admin_ai_policies as policy
    where policy.id = (evidence ->> 'policy_id')::uuid
      and policy.version = (evidence ->> 'policy_version')::bigint
      and policy.environment_id = (evidence ->> 'environment_id')::uuid
      and policy.membership_id = (evidence ->> 'membership_id')::uuid
    for update;
    authority_is_live := authority_is_live
      and found
      and policy_row.status = 'active'
      and policy_row.valid_from <= effective_now
      and policy_row.valid_until > effective_now
      and array[evidence ->> 'feature']::text[] <@ policy_row.allowed_actions
      and array[evidence ->> 'model_id']::text[] <@ policy_row.allowed_models;
  end if;

  -- Always take the lecture lock before settlement so cleanup cannot invert
  -- the lecture -> control -> usage order used by stop and revoke paths.
  select lecture.*
  into lecture_row
  from public.lecture_sessions as lecture
  where lecture.id = (evidence ->> 'lecture_session_id')::uuid
  for update;
  authority_is_live := authority_is_live
    and found
    and lecture_row.status = 'open'
    and lecture_row.hard_stop_at is not null
    and lecture_row.hard_stop_at > effective_now;

  if context_value is not null then
    select master.*
    into master_row
    from public.lecture_ai_master_authorizations as master
    where master.id = (evidence ->> 'master_authorization_id')::uuid
      and master.lecture_session_id = (evidence ->> 'lecture_session_id')::uuid
    for update;
    authority_is_live := authority_is_live
      and found
      and master_row.status = 'active'
      and master_row.expires_at > effective_now
      and master_row.principal_id is not distinct from
        (evidence ->> 'principal_id')::uuid
      and master_row.membership_id is not distinct from
        (evidence ->> 'membership_id')::uuid
      and master_row.issuing_admin_session_id is not distinct from
        (evidence ->> 'admin_session_id')::uuid
      and master_row.actor_id is not distinct from (evidence ->> 'actor_id')
      and master_row.ai_policy_id is not distinct from
        (evidence ->> 'policy_id')::uuid
      and master_row.ai_policy_version is not distinct from
        (evidence ->> 'policy_version')::bigint
      and array[evidence ->> 'feature']::text[] <@ master_row.actions;
  else
    authority_is_live := false;
  end if;

  if not authority_is_live then
    settlement := private.fail_material_ai_operation(
      target_operation_id,
      evidence ->> 'actor_id',
      'cancelled',
      actual_microusd,
      actual_input_tokens,
      actual_output_tokens,
      provider_request_id,
      'google_authority_revoked'
    );
    return settlement || jsonb_build_object(
      'accepted', false,
      'authorityRevoked', true,
      'result_saved', false
    );
  end if;

  return private.complete_material_ai_operation(
    target_operation_id,
    evidence ->> 'actor_id',
    target_result,
    actual_microusd,
    actual_input_tokens,
    actual_output_tokens,
    provider_request_id
  );
end;
$$;

revoke all on function private.complete_google_admin_material_ai_operation_v1(
  text, uuid, uuid, text, text, integer, uuid, uuid, jsonb, bigint, bigint,
  bigint, text
) from public, anon, authenticated, service_role;

create function public.complete_google_admin_material_ai_operation_v1(
  target_token_hash text,
  target_auth_user_id uuid,
  target_supabase_auth_session_id uuid,
  target_google_issuer text,
  target_provider_subject_hmac text,
  target_subject_pepper_version integer,
  target_start_request_id uuid,
  target_operation_id uuid,
  target_result jsonb,
  actual_microusd bigint,
  actual_input_tokens bigint,
  actual_output_tokens bigint,
  provider_request_id text
)
returns jsonb
language sql
volatile
security definer
set search_path = ''
as $$
  select private.complete_google_admin_material_ai_operation_v1(
    target_token_hash,
    target_auth_user_id,
    target_supabase_auth_session_id,
    target_google_issuer,
    target_provider_subject_hmac,
    target_subject_pepper_version,
    target_start_request_id,
    target_operation_id,
    target_result,
    actual_microusd,
    actual_input_tokens,
    actual_output_tokens,
    provider_request_id
  );
$$;

revoke all on function public.complete_google_admin_material_ai_operation_v1(
  text, uuid, uuid, text, text, integer, uuid, uuid, jsonb, bigint, bigint,
  bigint, text
) from public, anon, authenticated;
grant execute on function public.complete_google_admin_material_ai_operation_v1(
  text, uuid, uuid, text, text, integer, uuid, uuid, jsonb, bigint, bigint,
  bigint, text
) to service_role;
