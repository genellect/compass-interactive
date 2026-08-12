-- Phase 7.30D: dormant Google Admin owner ledger authority.
--
-- This migration is expand-only and default OFF. It adds an owner-only,
-- content-free ledger and immutable invitation-redemption evidence. It does
-- not enable Google admission, alter Hosted configuration, remove either
-- legacy PIN, or reset another user's upstream Auth factors.

alter table private.admin_identity_runtime_gate
  add column google_admin_ledger_enabled boolean not null default false;

comment on column private.admin_identity_runtime_gate.google_admin_ledger_enabled is
  'Default-OFF Phase 7.30D admission gate for new/elevating owner-ledger mutations. Reads and narrowly terminal controls remain available for rollback.';

create or replace function private.get_admin_identity_runtime_gate_v1()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'google_admin_ledger_enabled', gate.google_admin_ledger_enabled,
    'google_operational_authorization_enabled',
      gate.google_operational_authorization_enabled,
    'google_session_issue_enabled', gate.google_session_issue_enabled,
    'legacy_pin_login_enabled', gate.legacy_pin_login_enabled,
    'operator_totp_factor_set_adoption_enabled',
      gate.operator_totp_factor_set_adoption_enabled,
    'totp_factor_mutation_enabled', gate.totp_factor_mutation_enabled
  )
  from private.admin_identity_runtime_gate as gate
  where gate.singleton;
$$;

revoke all on function private.get_admin_identity_runtime_gate_v1()
  from public, anon, authenticated;
grant execute on function private.get_admin_identity_runtime_gate_v1()
  to service_role;

-- The closed C2 inventory remains migration-owned. Ledger operations use the
-- same gate/read/control vocabulary, but never require can_use_ai.
drop trigger admin_google_operation_policies_immutable
  on private.admin_google_operation_policies;

alter table private.admin_google_operation_policies
  drop constraint admin_google_operation_policies_control_step_up_action_check;
alter table private.admin_google_operation_policies
  add constraint admin_google_operation_policies_control_step_up_action_check
  check (
    control_step_up_action is null
    or control_step_up_action in (
      'environment_ai_policy_change',
      'admin_invitation_change',
      'admin_membership_role_change',
      'admin_membership_status_change',
      'admin_membership_ai_change',
      'admin_session_revoke',
      'admin_global_revoke',
      'admin_totp_factor_reset'
    )
  );

insert into private.admin_google_operation_policies (
  operation_key,
  edge_function,
  action_name,
  access_scope,
  lecture_state,
  gate_mode,
  operation_class,
  lecture_lock_mode,
  instructor_requires_ai,
  owner_requires_ai,
  request_binding_required,
  control_step_up_action
) values
  ('manage-admin-ledger.snapshot', 'manage-admin-ledger', 'snapshot',
    'environment_owner', 'none', 'gate_independent', 'read', 'share',
    false, false, false, null),
  ('manage-admin-ledger.audit', 'manage-admin-ledger', 'audit',
    'environment_owner', 'none', 'gate_independent', 'read', 'share',
    false, false, false, null),
  ('manage-admin-ledger.issueInvitation', 'manage-admin-ledger', 'issueInvitation',
    'environment_owner', 'none', 'required', 'write', 'share',
    false, false, true, 'admin_invitation_change'),
  ('manage-admin-ledger.revokeInvitation', 'manage-admin-ledger', 'revokeInvitation',
    'environment_owner', 'none', 'gate_independent', 'free_control', 'share',
    false, false, true, 'admin_invitation_change'),
  ('manage-admin-ledger.promoteOwner', 'manage-admin-ledger', 'promoteOwner',
    'environment_owner', 'none', 'required', 'write', 'share',
    false, false, true, 'admin_membership_role_change'),
  ('manage-admin-ledger.demoteOwner', 'manage-admin-ledger', 'demoteOwner',
    'environment_owner', 'none', 'gate_independent', 'free_control', 'share',
    false, false, true, 'admin_membership_role_change'),
  ('manage-admin-ledger.suspendMembership', 'manage-admin-ledger', 'suspendMembership',
    'environment_owner', 'none', 'gate_independent', 'free_control', 'share',
    false, false, true, 'admin_membership_status_change'),
  ('manage-admin-ledger.reactivateMembership', 'manage-admin-ledger', 'reactivateMembership',
    'environment_owner', 'none', 'required', 'write', 'share',
    false, false, true, 'admin_membership_status_change'),
  ('manage-admin-ledger.revokeMembership', 'manage-admin-ledger', 'revokeMembership',
    'environment_owner', 'none', 'gate_independent', 'free_control', 'share',
    false, false, true, 'admin_membership_status_change'),
  ('manage-admin-ledger.enableAi', 'manage-admin-ledger', 'enableAi',
    'environment_owner', 'none', 'required', 'write', 'share',
    false, false, true, 'admin_membership_ai_change'),
  ('manage-admin-ledger.disableAi', 'manage-admin-ledger', 'disableAi',
    'environment_owner', 'none', 'gate_independent', 'free_control', 'share',
    false, false, true, 'admin_membership_ai_change'),
  ('manage-admin-ledger.revokeSession', 'manage-admin-ledger', 'revokeSession',
    'environment_owner', 'none', 'gate_independent', 'free_control', 'share',
    false, false, true, 'admin_session_revoke'),
  ('manage-admin-ledger.globalRevoke', 'manage-admin-ledger', 'globalRevoke',
    'environment_owner', 'none', 'gate_independent', 'free_control', 'share',
    false, false, true, 'admin_global_revoke');

create trigger admin_google_operation_policies_immutable
before update or delete on private.admin_google_operation_policies
for each row execute function private.reject_admin_c1_evidence_mutation_v1();

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
      'totp_factor_remove',
      'admin_invitation_change',
      'admin_membership_role_change',
      'admin_membership_status_change',
      'admin_membership_ai_change',
      'admin_session_revoke',
      'admin_global_revoke',
      'admin_totp_factor_reset'
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
      'totp_factor_remove',
      'admin_invitation_change',
      'admin_membership_role_change',
      'admin_membership_status_change',
      'admin_membership_ai_change',
      'admin_session_revoke',
      'admin_global_revoke',
      'admin_totp_factor_reset'
    )
  );

-- Pending invitations need a restricted display value for the owner ledger and
-- a durable terminal contract. Bootstrap rows remain upgrade-compatible.
alter table private.admin_invitations
  add column target_normalized_email text,
  add column target_email_pepper_version integer,
  add column membership_expires_at timestamptz,
  add column revoked_at timestamptz,
  add column revoked_by_membership_id uuid
    references private.admin_environment_memberships(id) on delete restrict,
  add column revocation_reason text,
  add column expired_at timestamptz;

update private.admin_invitations
set
  revoked_at = case when status = 'revoked' then updated_at else null end,
  revocation_reason = case
    when status = 'revoked' then 'legacy_terminal' else null end,
  expired_at = case when status = 'expired' then updated_at else null end;

alter table private.admin_invitations
  add constraint admin_invitations_target_email_contract_check check (
    (
      target_normalized_email is null
      and target_email_pepper_version is null
    )
    or (
      target_normalized_email is not null
      and target_email_pepper_version is not null
      and target_normalized_email = lower(trim(target_normalized_email))
      and char_length(target_normalized_email) between 3 and 320
      and target_email_pepper_version between 1 and 2147483647
    )
  ),
  add constraint admin_invitations_membership_expiry_check check (
    (role = 'owner' and membership_expires_at is null)
    or (
      role = 'instructor'
      and (
        membership_expires_at is null
        or membership_expires_at >= expires_at
      )
    )
  ),
  add constraint admin_invitations_acceptance_contract_v2_check check (
    (
      status = 'accepted'
      and accepted_principal_id is not null
      and accepted_membership_id is not null
      and accepted_at is not null
    )
    or (
      status <> 'accepted'
      and accepted_principal_id is null
      and accepted_membership_id is null
      and accepted_at is null
    )
  ),
  add constraint admin_invitations_terminal_contract_check check (
    (
      status in ('pending', 'accepted')
      and revoked_at is null
      and revoked_by_membership_id is null
      and revocation_reason is null
      and expired_at is null
    )
    or (
      status = 'revoked'
      and revoked_at is not null
      and revocation_reason is not null
      and revocation_reason ~ '^[a-z][a-z0-9_]{0,79}$'
      and expired_at is null
    )
    or (
      status = 'expired'
      and expired_at is not null
      and revoked_at is null
      and revoked_by_membership_id is null
      and revocation_reason is null
    )
  );

create function private.enforce_admin_invitation_transition_v1()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Admin invitation evidence is immutable'
      using errcode = '55000';
  end if;

  if old.status <> 'pending'
     or new.id is distinct from old.id
     or new.environment_id is distinct from old.environment_id
     or new.invitation_kind is distinct from old.invitation_kind
     or new.target_email_hmac is distinct from old.target_email_hmac
     or new.target_normalized_email is distinct from old.target_normalized_email
     or new.target_email_pepper_version is distinct from
       old.target_email_pepper_version
     or new.role is distinct from old.role
     or new.can_use_ai is distinct from old.can_use_ai
     or new.token_hash is distinct from old.token_hash
     or new.inviter_membership_id is distinct from old.inviter_membership_id
     or new.expires_at is distinct from old.expires_at
     or new.membership_expires_at is distinct from old.membership_expires_at
     or new.request_id is distinct from old.request_id
     or new.created_at is distinct from old.created_at
     or new.status not in ('accepted', 'revoked', 'expired')
     or new.updated_at < old.updated_at then
    raise exception 'Admin invitation transition is immutable'
      using errcode = '55000';
  end if;

  if new.status = 'accepted' then
    if new.accepted_principal_id is null
       or new.accepted_membership_id is null
       or new.accepted_at is null
       or new.accepted_at is distinct from new.updated_at
       or new.revoked_at is not null
       or new.revoked_by_membership_id is not null
       or new.revocation_reason is not null
       or new.expired_at is not null then
      raise exception 'Admin invitation acceptance evidence is incomplete'
        using errcode = '55000';
    end if;

    perform 1
    from private.admin_environment_memberships as membership
    where membership.id = new.accepted_membership_id
      and membership.environment_id = new.environment_id
      and membership.principal_id = new.accepted_principal_id
      and membership.role = new.role
      and membership.can_use_ai = new.can_use_ai
      and membership.expires_at is not distinct from new.membership_expires_at;
    if not found then
      raise exception 'Admin invitation membership binding is invalid'
        using errcode = '55000';
    end if;
  elsif new.status = 'revoked' then
    if new.accepted_principal_id is not null
       or new.accepted_membership_id is not null
       or new.accepted_at is not null
       or new.revoked_at is null
       or new.revoked_at is distinct from new.updated_at
       or new.revoked_by_membership_id is null
       or new.revocation_reason is null
       or new.expired_at is not null then
      raise exception 'Admin invitation revocation evidence is incomplete'
        using errcode = '55000';
    end if;

    perform 1
    from private.admin_environment_memberships as membership
    where membership.id = new.revoked_by_membership_id
      and membership.environment_id = new.environment_id;
    if not found then
      raise exception 'Admin invitation revoker binding is invalid'
        using errcode = '55000';
    end if;
  else
    if new.accepted_principal_id is not null
       or new.accepted_membership_id is not null
       or new.accepted_at is not null
       or new.revoked_at is not null
       or new.revoked_by_membership_id is not null
       or new.revocation_reason is not null
       or new.expired_at is null
       or new.expired_at is distinct from new.updated_at then
      raise exception 'Admin invitation expiry evidence is incomplete'
        using errcode = '55000';
    end if;
  end if;

  return new;
end;
$$;

revoke all on function private.enforce_admin_invitation_transition_v1()
  from public, anon, authenticated, service_role;

create trigger enforce_admin_invitation_transition
before update or delete on private.admin_invitations
for each row execute function private.enforce_admin_invitation_transition_v1();

create index admin_memberships_environment_created_idx
  on private.admin_environment_memberships (
    environment_id, created_at desc, id desc
  );
create index admin_principals_normalized_email_idx
  on private.admin_principals (normalized_email, id);
create index admin_invitations_environment_created_idx
  on private.admin_invitations (environment_id, created_at desc, id desc);
create index admin_sessions_google_environment_history_idx
  on public.admin_sessions (environment_id, issued_at desc, id desc)
  where authentication_method = 'google_totp';
create index admin_sessions_google_membership_history_idx
  on public.admin_sessions (membership_id, issued_at desc, id desc)
  where authentication_method = 'google_totp';
create index admin_lecture_ownerships_environment_time_idx
  on private.admin_lecture_ownerships (
    environment_id, assigned_at desc, lecture_session_id
  );

create table private.admin_invitation_redemption_receipts (
  admission_request_id uuid primary key,
  invitation_id uuid not null unique
    references private.admin_invitations(id) on delete restrict,
  invitation_request_id uuid not null,
  intent_digest text not null check (intent_digest ~ '^[0-9a-f]{64}$'),
  environment_id uuid not null
    references private.admin_environments(id) on delete restrict,
  principal_id uuid not null
    references private.admin_principals(id) on delete restrict,
  membership_id uuid not null unique
    references private.admin_environment_memberships(id) on delete restrict,
  auth_user_id uuid not null,
  google_issuer text not null check (
    google_issuer = 'https://accounts.google.com'
  ),
  provider_subject_hmac text not null check (
    provider_subject_hmac ~ '^[0-9a-f]{64}$'
  ),
  subject_pepper_version integer not null check (
    subject_pepper_version between 1 and 2147483647
  ),
  target_email_hmac text not null check (
    target_email_hmac ~ '^[0-9a-f]{64}$'
  ),
  target_email_pepper_version integer check (
    target_email_pepper_version is null
    or target_email_pepper_version between 1 and 2147483647
  ),
  invitation_kind text not null check (
    invitation_kind in ('bootstrap', 'invitation')
  ),
  invitation_token_hash text check (
    invitation_token_hash is null
    or invitation_token_hash ~ '^[0-9a-f]{64}$'
  ),
  role text not null check (role in ('owner', 'instructor')),
  can_use_ai boolean not null,
  membership_expires_at timestamptz,
  accepted_at timestamptz not null default statement_timestamp(),
  result_status text not null default 'accepted' check (
    result_status = 'accepted'
  ),
  check (
    (
      invitation_kind = 'bootstrap'
      and invitation_token_hash is null
    )
    or (
      invitation_kind = 'invitation'
      and invitation_token_hash is not null
    )
  ),
  check (role <> 'owner' or membership_expires_at is null)
);

alter table private.admin_invitation_redemption_receipts
  enable row level security;
revoke all on private.admin_invitation_redemption_receipts
  from public, anon, authenticated, service_role;

create index admin_invitation_redemptions_environment_idx
  on private.admin_invitation_redemption_receipts (
    environment_id, accepted_at desc, admission_request_id
  );
create index admin_invitation_redemptions_principal_idx
  on private.admin_invitation_redemption_receipts (
    principal_id, accepted_at desc, admission_request_id
  );

create trigger admin_invitation_redemptions_append_only
before update or delete on private.admin_invitation_redemption_receipts
for each row execute function private.reject_admin_c1_evidence_mutation_v1();

create function private.google_admin_admission_intent_digest_v1(
  target_environment_id uuid,
  target_auth_user_id uuid,
  target_google_issuer text,
  target_provider_subject_hmac text,
  target_subject_pepper_version integer,
  target_normalized_email text,
  target_email_digest text,
  target_display_name text,
  target_request_id uuid,
  target_invitation_token_hash text
)
returns text
language sql
immutable
security definer
set search_path = ''
as $$
  select case
    when target_environment_id is null
      or target_auth_user_id is null
      or target_google_issuer is null
      or target_provider_subject_hmac is null
      or target_subject_pepper_version is null
      or target_normalized_email is null
      or target_email_digest is null
      or target_request_id is null
    then null
    else pg_catalog.encode(
      extensions.digest(
        pg_catalog.convert_to(
          'compass:phase7.30d:admin-admission:v1'
          || '|request_id=' || target_request_id::text
          || '|environment_id=' || target_environment_id::text
          || '|auth_user_id=' || target_auth_user_id::text
          || '|google_issuer=' || char_length(target_google_issuer)::text
          || ':' || target_google_issuer
          || '|provider_subject_hmac='
          || char_length(target_provider_subject_hmac)::text
          || ':' || target_provider_subject_hmac
          || '|subject_pepper_version=' || target_subject_pepper_version::text
          || '|normalized_email=' || char_length(target_normalized_email)::text
          || ':' || target_normalized_email
          || '|email_digest=' || char_length(target_email_digest)::text
          || ':' || target_email_digest
          || '|display_name=' || case
            when target_display_name is null then '-1:'
            else char_length(target_display_name)::text || ':'
              || target_display_name
          end
          || '|invitation_token_hash='
          || case
            when target_invitation_token_hash is null then '-1:'
            else char_length(target_invitation_token_hash)::text || ':'
              || target_invitation_token_hash
          end,
          'UTF8'
        ),
        'sha256'
      ),
      'hex'
    )
  end;
$$;

revoke all on function private.google_admin_admission_intent_digest_v1(
  uuid, uuid, text, text, integer, text, text, text, uuid, text
) from public, anon, authenticated, service_role;

-- Replace the original admission body without changing its public signature.
-- Existing principals use P -> M -> environment. A first admission is
-- serialized by Auth user and provider subject before it locks the deployment
-- and invitation, so it cannot create the former environment -> principal
-- inversion. Invitation acceptance and its immutable receipt commit together.
create or replace function private.consume_admin_identity_admission_v1(
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
  subject_principal_row private.admin_principals%rowtype;
  membership_row private.admin_environment_memberships%rowtype;
  environment_row private.admin_environments%rowtype;
  invitation_row private.admin_invitations%rowtype;
  receipt_row private.admin_invitation_redemption_receipts%rowtype;
  gate_row private.admin_identity_runtime_gate%rowtype;
  normalized_email text := lower(trim(target_normalized_email));
  intent_digest_value text;
  needs_invitation_acceptance boolean := false;
  needs_principal_insert boolean := false;
  effective_now timestamptz := statement_timestamp();
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
     or (
       target_display_name is not null
       and char_length(target_display_name) not between 1 and 160
     )
     or (
       target_invitation_token_hash is not null
       and target_invitation_token_hash !~ '^[0-9a-f]{64}$'
     ) then
    raise exception 'invalid Admin identity admission' using errcode = '22023';
  end if;

  intent_digest_value := private.google_admin_admission_intent_digest_v1(
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
  if intent_digest_value is null then
    raise exception 'invalid Admin identity admission' using errcode = '22023';
  end if;

  perform private.serialize_admin_ai_scope_v1(
    'admin-ledger-environment',
    target_environment_id
  );
  perform private.serialize_admin_ai_scope_v1(
    'admin-identity-auth-user',
    target_auth_user_id
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'compass:admin-identity-subject:v1:'
      || target_google_issuer || ':'
      || target_provider_subject_hmac || ':'
      || target_subject_pepper_version::text,
      0
    )
  );
  perform private.serialize_admin_ai_request_v1(target_request_id);

  select receipt.*
  into receipt_row
  from private.admin_invitation_redemption_receipts as receipt
  where receipt.admission_request_id = target_request_id;

  if found then
    if receipt_row.intent_digest is distinct from intent_digest_value
       or receipt_row.environment_id is distinct from target_environment_id
       or receipt_row.auth_user_id is distinct from target_auth_user_id
       or receipt_row.google_issuer is distinct from target_google_issuer
       or receipt_row.provider_subject_hmac is distinct from
         target_provider_subject_hmac
       or receipt_row.subject_pepper_version is distinct from
         target_subject_pepper_version
       or receipt_row.target_email_hmac is distinct from target_email_digest
       or receipt_row.invitation_token_hash is distinct from
         target_invitation_token_hash
       or receipt_row.result_status <> 'accepted' then
      raise exception 'Admin admission request binding does not match its receipt'
        using errcode = 'P7335';
    end if;

    return jsonb_build_object(
      'eligible', true,
      'idempotent_replay', true,
      'membership_id', receipt_row.membership_id,
      'principal_id', receipt_row.principal_id
    );
  end if;

  select gate.*
  into gate_row
  from private.admin_identity_runtime_gate as gate
  where gate.singleton
  for share;
  if not found or gate_row.google_session_issue_enabled is not true then
    raise exception 'Admin Google identity is disabled' using errcode = 'P7300';
  end if;

  select principal.*
  into principal_row
  from private.admin_principals as principal
  where principal.auth_user_id = target_auth_user_id
  for update;

  if found then
    if principal_row.status <> 'active'
       or principal_row.google_issuer is distinct from target_google_issuer
       or principal_row.provider_subject_hmac is distinct from
         target_provider_subject_hmac
       or principal_row.subject_pepper_version is distinct from
         target_subject_pepper_version then
      return jsonb_build_object('eligible', false);
    end if;

    select membership.*
    into membership_row
    from private.admin_environment_memberships as membership
    where membership.environment_id = target_environment_id
      and membership.principal_id = principal_row.id
    for update;

    if found then
      select environment.*
      into environment_row
      from private.admin_environments as environment
      where environment.id = target_environment_id
        and environment.current_deployment
        and environment.status = 'active'
      for share;

      if environment_row.id is null
         or membership_row.status not in ('pending_mfa', 'active')
         or (
           membership_row.expires_at is not null
           and membership_row.expires_at <= effective_now
         ) then
        return jsonb_build_object('eligible', false);
      end if;
    else
      needs_invitation_acceptance := true;
    end if;
  else
    select principal.*
    into subject_principal_row
    from private.admin_principals as principal
    where principal.provider = 'google'
      and principal.google_issuer = target_google_issuer
      and principal.provider_subject_hmac = target_provider_subject_hmac
      and principal.subject_pepper_version = target_subject_pepper_version
    for update;

    if found then
      return jsonb_build_object('eligible', false);
    end if;

    needs_invitation_acceptance := true;
    needs_principal_insert := true;
  end if;

  if needs_invitation_acceptance then

    select environment.*
    into environment_row
    from private.admin_environments as environment
    where environment.id = target_environment_id
      and environment.current_deployment
      and environment.status = 'active'
    for share;

    if not found then
      return jsonb_build_object('eligible', false);
    end if;

    update private.admin_invitations
    set
      status = 'expired',
      expired_at = effective_now,
      updated_at = effective_now
    where environment_id = target_environment_id
      and target_email_hmac = target_email_digest
      and status = 'pending'
      and expires_at <= effective_now;

    select invitation.*
    into invitation_row
    from private.admin_invitations as invitation
    where invitation.environment_id = target_environment_id
      and invitation.target_email_hmac = target_email_digest
      and invitation.status = 'pending'
      and invitation.expires_at > effective_now
      and (
        invitation.membership_expires_at is null
        or invitation.membership_expires_at > effective_now
      )
      and (
        invitation.target_normalized_email is null
        or (
          invitation.target_normalized_email = normalized_email
          and invitation.target_email_pepper_version =
            target_subject_pepper_version
        )
      )
      and (
        (
          invitation.invitation_kind = 'bootstrap'
          and target_invitation_token_hash is null
        )
        or (
          invitation.invitation_kind = 'invitation'
          and gate_row.google_admin_ledger_enabled is true
          and invitation.token_hash = target_invitation_token_hash
          and invitation.target_normalized_email is not null
          and invitation.target_email_pepper_version is not null
        )
      )
    for update;

    if not found
       or (
         environment_row.environment_kind = 'contest'
         and invitation_row.invitation_kind = 'invitation'
         and (
           invitation_row.role <> 'instructor'
           or not invitation_row.can_use_ai
           or invitation_row.membership_expires_at is null
           or invitation_row.membership_expires_at <= effective_now
         )
       ) then
      return jsonb_build_object('eligible', false);
    end if;

    if needs_principal_insert then
      principal_row.id := extensions.gen_random_uuid();
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
        effective_now
      ) returning * into principal_row;
    end if;

    membership_row.id := extensions.gen_random_uuid();
    insert into private.admin_environment_memberships (
      id,
      environment_id,
      principal_id,
      role,
      status,
      can_use_ai,
      expires_at
    ) values (
      membership_row.id,
      target_environment_id,
      principal_row.id,
      invitation_row.role,
      'pending_mfa',
      invitation_row.can_use_ai,
      invitation_row.membership_expires_at
    ) returning * into membership_row;

    update private.admin_invitations
    set
      status = 'accepted',
      accepted_principal_id = principal_row.id,
      accepted_membership_id = membership_row.id,
      accepted_at = effective_now,
      updated_at = effective_now
    where id = invitation_row.id;

    insert into private.admin_invitation_redemption_receipts (
      admission_request_id,
      invitation_id,
      invitation_request_id,
      intent_digest,
      environment_id,
      principal_id,
      membership_id,
      auth_user_id,
      google_issuer,
      provider_subject_hmac,
      subject_pepper_version,
      target_email_hmac,
      target_email_pepper_version,
      invitation_kind,
      invitation_token_hash,
      role,
      can_use_ai,
      membership_expires_at,
      accepted_at
    ) values (
      target_request_id,
      invitation_row.id,
      invitation_row.request_id,
      intent_digest_value,
      target_environment_id,
      principal_row.id,
      membership_row.id,
      target_auth_user_id,
      target_google_issuer,
      target_provider_subject_hmac,
      target_subject_pepper_version,
      target_email_digest,
      invitation_row.target_email_pepper_version,
      invitation_row.invitation_kind,
      target_invitation_token_hash,
      invitation_row.role,
      invitation_row.can_use_ai,
      invitation_row.membership_expires_at,
      effective_now
    );
  end if;

  if (
    select count(*) >= 30
    from private.admin_audit_events as event
    where event.actor_principal_id = principal_row.id
      and event.action = 'admin_identity.admit'
      and event.occurred_at >= effective_now - interval '5 minutes'
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
    jsonb_build_object(
      'invitation_kind', coalesce(invitation_row.invitation_kind, 'existing'),
      'membership_status', membership_row.status
    )
  );

  return jsonb_build_object(
    'eligible', true,
    'idempotent_replay', false,
    'membership_id', membership_row.id,
    'principal_id', principal_row.id
  );
end;
$$;

-- Linearize the final Google session INSERT with the identity kill switch.
-- This closes the interval after the completion worker's earlier gate read
-- without replacing its established ABI or duplicating its security body.
create function private.enforce_google_admin_session_issue_gate_v1()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  gate_row private.admin_identity_runtime_gate%rowtype;
begin
  if new.authentication_method <> 'google_totp' then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.authentication_method = 'google_totp' then
    return new;
  end if;

  select gate.*
  into gate_row
  from private.admin_identity_runtime_gate as gate
  where gate.singleton
  for share;
  if not found or gate_row.google_session_issue_enabled is not true then
    raise exception 'Admin Google identity is disabled' using errcode = 'P7300';
  end if;
  return new;
end;
$$;

create trigger admin_sessions_google_issue_gate
before insert or update of authentication_method
on public.admin_sessions
for each row execute function private.enforce_google_admin_session_issue_gate_v1();

revoke all on function private.enforce_google_admin_session_issue_gate_v1()
  from public, anon, authenticated, service_role;

revoke all on function private.consume_admin_identity_admission_v1(
  uuid, uuid, text, text, integer, text, text, text, uuid, text
) from public, anon, authenticated;
grant execute on function private.consume_admin_identity_admission_v1(
  uuid, uuid, text, text, integer, text, text, text, uuid, text
) to service_role;

-- Every ledger write path takes the deployment-wide advisory mutex before its
-- request mutex and before the canonical P -> M -> E context chain. The
-- snapshot intentionally does not require a live session so a committed
-- self-terminal mutation can still reach receipt-first replay.
create function private.serialize_google_admin_ledger_environment_v1(
  target_token_hash text,
  target_auth_user_id uuid,
  target_supabase_auth_session_id uuid
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  environment_id_value uuid;
begin
  select session.environment_id
  into environment_id_value
  from public.admin_sessions as session
  where session.token_hash = target_token_hash
    and session.authentication_method = 'google_totp'
    and session.aal = 2
    and session.auth_user_id = target_auth_user_id
    and session.supabase_auth_session_id = target_supabase_auth_session_id;

  if not found then
    return null;
  end if;

  perform private.serialize_admin_ai_scope_v1(
    'admin-ledger-environment',
    environment_id_value
  );
  return environment_id_value;
end;
$$;

revoke all on function private.serialize_google_admin_ledger_environment_v1(
  text, uuid, uuid
) from public, anon, authenticated, service_role;

create function private.require_google_admin_ledger_context_v1(
  target_token_hash text,
  target_auth_user_id uuid,
  target_supabase_auth_session_id uuid,
  target_google_issuer text,
  target_provider_subject_hmac text,
  target_subject_pepper_version integer,
  target_operation_key text
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
  context_value jsonb;
  policy_row private.admin_google_operation_policies%rowtype;
  gate_row private.admin_identity_runtime_gate%rowtype;
begin
  if target_operation_key is null
     or target_operation_key not like 'manage-admin-ledger.%' then
    return null;
  end if;

  select policy.*
  into policy_row
  from private.admin_google_operation_policies as policy
  where policy.operation_key = target_operation_key;

  if not found then
    return null;
  end if;

  -- Discover only the immutable environment binding. Mutation callers take
  -- this same D-wide mutex before their request mutex; reacquiring it here is
  -- transaction-local and keeps this helper safe for future direct callers.
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

  if policy_row.operation_class <> 'read' then
    if private.serialize_google_admin_ledger_environment_v1(
      target_token_hash,
      target_auth_user_id,
      target_supabase_auth_session_id
    ) is distinct from session_snapshot.environment_id then
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
    target_operation_key,
    null
  );
  if context_value is null
     or (context_value ->> 'environment_id')::uuid is distinct from
       session_snapshot.environment_id then
    return null;
  end if;

  select gate.*
  into gate_row
  from private.admin_identity_runtime_gate as gate
  where gate.singleton
  for share;

  if policy_row.operation_key is null or gate_row.singleton is not true then
    return null;
  end if;

  return context_value || jsonb_build_object(
    'control_step_up_action', policy_row.control_step_up_action,
    'google_admin_ledger_enabled', gate_row.google_admin_ledger_enabled
  );
end;
$$;

revoke all on function private.require_google_admin_ledger_context_v1(
  text, uuid, uuid, text, text, integer, text
) from public, anon, authenticated, service_role;

create function private.assert_google_admin_ledger_gate_v1(
  target_context jsonb,
  target_transport_enabled boolean
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if target_context is null
     or target_context ->> 'operation_key' is null then
    raise exception 'Google Admin ledger context is invalid'
      using errcode = '42501';
  end if;

  if target_context ->> 'gate_mode' = 'required'
     and (
       coalesce(
         (target_context ->> 'google_admin_ledger_enabled')::boolean,
         false
       ) is not true
       or coalesce(target_transport_enabled, false) is not true
     ) then
    raise exception 'Google Admin ledger admission is disabled'
      using errcode = 'P7337';
  end if;
end;
$$;

revoke all on function private.assert_google_admin_ledger_gate_v1(
  jsonb, boolean
) from public, anon, authenticated, service_role;

create function private.get_google_admin_ledger_v1(
  target_token_hash text,
  target_auth_user_id uuid,
  target_supabase_auth_session_id uuid,
  target_google_issuer text,
  target_provider_subject_hmac text,
  target_subject_pepper_version integer,
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
  memberships_value jsonb;
  invitations_value jsonb;
  sessions_value jsonb;
  ownerships_value jsonb;
begin
  context_value := private.require_google_admin_ledger_context_v1(
    target_token_hash,
    target_auth_user_id,
    target_supabase_auth_session_id,
    target_google_issuer,
    target_provider_subject_hmac,
    target_subject_pepper_version,
    'manage-admin-ledger.snapshot'
  );
  if context_value is null then
    return null;
  end if;
  perform private.assert_google_admin_ledger_gate_v1(
    context_value,
    target_transport_enabled
  );

  select coalesce(jsonb_agg(candidate.value order by candidate.sort_at desc,
    candidate.sort_id desc), '[]'::jsonb)
  into memberships_value
  from (
    select
      membership.created_at as sort_at,
      membership.id as sort_id,
      jsonb_build_object(
        'canUseAi', membership.can_use_ai,
        'createdAt', membership.created_at,
        'displayName', principal.display_name,
        'expiresAt', membership.expires_at,
        'membershipId', membership.id,
        'normalizedEmail', principal.normalized_email,
        'principalId', principal.id,
        'principalStatus', principal.status,
        'role', membership.role,
        'status', membership.status,
        'statusReason', membership.status_reason,
        'updatedAt', membership.updated_at
      ) as value
    from private.admin_environment_memberships as membership
    join private.admin_principals as principal
      on principal.id = membership.principal_id
    where membership.environment_id =
      (context_value ->> 'environment_id')::uuid
    order by membership.created_at desc, membership.id desc
    limit 200
  ) as candidate;

  select coalesce(jsonb_agg(candidate.value order by candidate.sort_at desc,
    candidate.sort_id desc), '[]'::jsonb)
  into invitations_value
  from (
    select
      invitation.created_at as sort_at,
      invitation.id as sort_id,
      jsonb_build_object(
        'canUseAi', invitation.can_use_ai,
        'createdAt', invitation.created_at,
        'expiresAt', invitation.expires_at,
        'expiredAt', case
          when invitation.status = 'pending'
            and invitation.expires_at <= statement_timestamp()
            then invitation.expires_at
          else invitation.expired_at
        end,
        'invitationId', invitation.id,
        'membershipExpiresAt', invitation.membership_expires_at,
        'normalizedEmail', invitation.target_normalized_email,
        'revocationReason', invitation.revocation_reason,
        'revokedAt', invitation.revoked_at,
        'role', invitation.role,
        'status', case
          when invitation.status = 'pending'
            and invitation.expires_at <= statement_timestamp()
            then 'expired'
          else invitation.status
        end,
        'updatedAt', invitation.updated_at
      ) as value
    from private.admin_invitations as invitation
    where invitation.environment_id =
      (context_value ->> 'environment_id')::uuid
    order by invitation.created_at desc, invitation.id desc
    limit 100
  ) as candidate;

  select coalesce(jsonb_agg(candidate.value order by candidate.sort_at desc,
    candidate.sort_id desc), '[]'::jsonb)
  into sessions_value
  from (
    select
      session.issued_at as sort_at,
      session.id as sort_id,
      jsonb_build_object(
        'expiresAt', session.expires_at,
        'idleExpiresAt', session.idle_expires_at,
        'isCurrent', session.id =
          (context_value ->> 'admin_session_id')::uuid,
        'issuedAt', session.issued_at,
        'lastSeenAt', session.last_seen_at,
        'membershipId', session.membership_id,
        'revokeReason', session.revoke_reason,
        'revokedAt', session.revoked_at,
        'sessionId', session.id,
        'status', case
          when session.revoked_at is not null then 'revoked'
          when session.expires_at <= statement_timestamp() then 'expired'
          else 'active'
        end
      ) as value
    from public.admin_sessions as session
    where session.authentication_method = 'google_totp'
      and session.environment_id =
        (context_value ->> 'environment_id')::uuid
    order by session.issued_at desc, session.id desc
    limit 200
  ) as candidate;

  select coalesce(jsonb_agg(candidate.value order by candidate.sort_at desc,
    candidate.sort_id), '[]'::jsonb)
  into ownerships_value
  from (
    select
      ownership.assigned_at as sort_at,
      ownership.lecture_session_id as sort_id,
      jsonb_build_object(
        'assignedAt', ownership.assigned_at,
        'lectureSessionId', ownership.lecture_session_id,
        'lectureStatus', lecture.status,
        'membershipId', ownership.membership_id,
        'principalId', ownership.principal_id
      ) as value
    from private.admin_lecture_ownerships as ownership
    join public.lecture_sessions as lecture
      on lecture.id = ownership.lecture_session_id
    where ownership.environment_id =
      (context_value ->> 'environment_id')::uuid
    order by ownership.assigned_at desc, ownership.lecture_session_id
    limit 200
  ) as candidate;

  return jsonb_build_object(
    'currentMembershipId', context_value ->> 'membership_id',
    'currentPrincipalId', context_value ->> 'principal_id',
    'currentSessionId', context_value ->> 'admin_session_id',
    'environmentId', context_value ->> 'environment_id',
    'environmentKind', (
      select environment.environment_kind
      from private.admin_environments as environment
      where environment.id = (context_value ->> 'environment_id')::uuid
    ),
    'invitations', invitations_value,
    'ledgerAdmissionEnabled',
      (context_value ->> 'google_admin_ledger_enabled')::boolean,
    'memberships', memberships_value,
    'ok', true,
    'ownerships', ownerships_value,
    'sessions', sessions_value
  );
end;
$$;

revoke all on function private.get_google_admin_ledger_v1(
  text, uuid, uuid, text, text, integer, boolean
) from public, anon, authenticated, service_role;

create function private.get_google_admin_ledger_audit_v1(
  target_token_hash text,
  target_auth_user_id uuid,
  target_supabase_auth_session_id uuid,
  target_google_issuer text,
  target_provider_subject_hmac text,
  target_subject_pepper_version integer,
  target_transport_enabled boolean,
  target_before_at timestamptz default null,
  target_before_id bigint default null,
  target_limit integer default 50
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
  events_value jsonb;
begin
  if target_limit is null
     or target_limit not between 1 and 100
     or (target_before_at is null) <> (target_before_id is null)
     or (target_before_id is not null and target_before_id < 1) then
    raise exception 'invalid Admin ledger audit cursor' using errcode = '22023';
  end if;

  context_value := private.require_google_admin_ledger_context_v1(
    target_token_hash,
    target_auth_user_id,
    target_supabase_auth_session_id,
    target_google_issuer,
    target_provider_subject_hmac,
    target_subject_pepper_version,
    'manage-admin-ledger.audit'
  );
  if context_value is null then
    return null;
  end if;
  perform private.assert_google_admin_ledger_gate_v1(
    context_value,
    target_transport_enabled
  );

  select coalesce(jsonb_agg(candidate.value order by candidate.occurred_at desc,
    candidate.id desc), '[]'::jsonb)
  into events_value
  from (
    select
      event.occurred_at,
      event.id,
      jsonb_build_object(
        'action', event.action,
        'eventId', event.id::text,
        'occurredAt', event.occurred_at,
        'reasonCode', event.reason_code,
        'result', event.result,
        'targetId', event.target_id,
        'targetType', event.target_type
      ) as value
    from private.admin_audit_events as event
    where event.environment_id =
      (context_value ->> 'environment_id')::uuid
      and (
        target_before_at is null
        or event.occurred_at < target_before_at
        or (
          event.occurred_at = target_before_at
          and event.id < target_before_id
        )
      )
    order by event.occurred_at desc, event.id desc
    limit target_limit
  ) as candidate;

  return jsonb_build_object('events', events_value, 'ok', true);
end;
$$;

revoke all on function private.get_google_admin_ledger_audit_v1(
  text, uuid, uuid, text, text, integer, boolean,
  timestamptz, bigint, integer
) from public, anon, authenticated, service_role;

create function private.normalize_google_admin_ledger_payload_v1(
  target_action text,
  target_payload jsonb
)
returns jsonb
language plpgsql
immutable
security definer
set search_path = ''
as $$
declare
  key_count integer;
  normalized_email text;
  membership_expires_at_value timestamptz;
  expires_at_value timestamptz;
  expected_updated_at_value timestamptz;
  reason_value text;
begin
  if target_action not in (
    'issueInvitation', 'revokeInvitation', 'promoteOwner', 'demoteOwner',
    'suspendMembership', 'reactivateMembership', 'revokeMembership',
    'enableAi', 'disableAi', 'revokeSession', 'globalRevoke'
  ) or target_payload is null or jsonb_typeof(target_payload) <> 'object' then
    raise exception 'invalid Admin ledger payload' using errcode = '22023';
  end if;

  select count(*) into key_count
  from jsonb_object_keys(target_payload);

  if target_action = 'issueInvitation' then
    if key_count <> 8
       or not target_payload ?& array[
         'normalized_email', 'email_hmac', 'email_pepper_version',
         'invitation_token_hash', 'role', 'can_use_ai',
         'membership_expires_at', 'expires_at'
       ]
       or jsonb_typeof(target_payload -> 'normalized_email') <> 'string'
       or jsonb_typeof(target_payload -> 'email_hmac') <> 'string'
       or jsonb_typeof(target_payload -> 'email_pepper_version') <> 'number'
       or jsonb_typeof(target_payload -> 'invitation_token_hash') <> 'string'
       or jsonb_typeof(target_payload -> 'role') <> 'string'
       or jsonb_typeof(target_payload -> 'can_use_ai') <> 'boolean'
       or jsonb_typeof(target_payload -> 'expires_at') <> 'string'
       or jsonb_typeof(target_payload -> 'membership_expires_at')
         not in ('string', 'null')
       or target_payload ->> 'email_hmac' !~ '^[0-9a-f]{64}$'
       or target_payload ->> 'invitation_token_hash' !~ '^[0-9a-f]{64}$'
       or target_payload ->> 'email_pepper_version' !~ '^[0-9]{1,10}$'
       or (target_payload ->> 'email_pepper_version')::bigint not between
         1 and 2147483647
       or target_payload ->> 'role' not in ('owner', 'instructor') then
      raise exception 'invalid Admin invitation payload' using errcode = '22023';
    end if;

    normalized_email := lower(trim(target_payload ->> 'normalized_email'));
    if normalized_email is distinct from target_payload ->> 'normalized_email'
       or char_length(normalized_email) not between 3 and 320
       or normalized_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
      raise exception 'invalid Admin invitation email' using errcode = '22023';
    end if;

    begin
      expires_at_value := (target_payload ->> 'expires_at')::timestamptz;
      membership_expires_at_value := case
        when jsonb_typeof(target_payload -> 'membership_expires_at') = 'null'
          then null
        else (target_payload ->> 'membership_expires_at')::timestamptz
      end;
    exception when invalid_text_representation or datetime_field_overflow then
      raise exception 'invalid Admin invitation expiry' using errcode = '22023';
    end;

    if target_payload ->> 'role' = 'owner'
       and membership_expires_at_value is not null then
      raise exception 'owner invitation cannot expire' using errcode = '22023';
    end if;
    if membership_expires_at_value is not null
       and membership_expires_at_value < expires_at_value then
      raise exception 'Admin membership expiry precedes invitation expiry'
        using errcode = '22023';
    end if;

    return jsonb_build_object(
      'can_use_ai', (target_payload ->> 'can_use_ai')::boolean,
      'email_hmac', target_payload ->> 'email_hmac',
      'email_pepper_version',
        (target_payload ->> 'email_pepper_version')::integer,
      'expires_at', expires_at_value,
      'invitation_token_hash', target_payload ->> 'invitation_token_hash',
      'membership_expires_at', membership_expires_at_value,
      'normalized_email', normalized_email,
      'role', target_payload ->> 'role'
    );
  end if;

  if target_action = 'revokeInvitation' then
    if key_count <> 3
       or not target_payload ?& array[
         'invitation_id', 'expected_status', 'expected_updated_at'
       ]
       or target_payload ->> 'invitation_id' !~*
         '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
       or target_payload ->> 'expected_status' <> 'pending' then
      raise exception 'invalid Admin invitation revoke payload'
        using errcode = '22023';
    end if;
  elsif target_action in ('promoteOwner', 'enableAi', 'disableAi') then
    if key_count <> 4
       or not target_payload ?& array[
         'membership_id',
         case when target_action = 'promoteOwner'
           then 'expected_role' else 'expected_can_use_ai' end,
         'expected_status', 'expected_updated_at'
       ]
       or (
         target_action = 'promoteOwner'
         and target_payload ->> 'expected_role' <> 'instructor'
       )
       or (
         target_action in ('enableAi', 'disableAi')
         and jsonb_typeof(target_payload -> 'expected_can_use_ai') <> 'boolean'
       ) then
      raise exception 'invalid Admin membership mutation payload'
        using errcode = '22023';
    end if;
  elsif target_action = 'demoteOwner' then
    if key_count <> 6
       or not target_payload ?& array[
         'membership_id', 'expected_role', 'expected_status',
         'expected_updated_at', 'membership_expires_at', 'reason_code'
       ]
       or target_payload ->> 'expected_role' <> 'owner'
       or jsonb_typeof(target_payload -> 'membership_expires_at')
         not in ('string', 'null') then
      raise exception 'invalid Admin owner demotion payload'
        using errcode = '22023';
    end if;
  elsif target_action in ('suspendMembership', 'revokeMembership') then
    if key_count <> 4
       or not target_payload ?& array[
         'membership_id', 'expected_status', 'expected_updated_at',
         'reason_code'
       ] then
      raise exception 'invalid Admin membership terminal payload'
        using errcode = '22023';
    end if;
  elsif target_action = 'reactivateMembership' then
    if key_count <> 3
       or not target_payload ?& array[
         'membership_id', 'expected_status', 'expected_updated_at'
       ]
       or target_payload ->> 'expected_status' <> 'suspended' then
      raise exception 'invalid Admin membership reactivation payload'
        using errcode = '22023';
    end if;
  elsif target_action = 'revokeSession' then
    if key_count <> 2
       or not target_payload ?& array['membership_id', 'session_id']
       or target_payload ->> 'session_id' !~*
         '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
      raise exception 'invalid Admin session revoke payload'
        using errcode = '22023';
    end if;
  elsif target_action = 'globalRevoke' then
    if key_count <> 1 or not target_payload ? 'membership_id' then
      raise exception 'invalid Admin global revoke payload'
        using errcode = '22023';
    end if;
  end if;

  if target_action <> 'revokeInvitation' then
    if target_payload ->> 'membership_id' !~*
      '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
      raise exception 'invalid Admin membership identifier' using errcode = '22023';
    end if;
  end if;

  if target_action not in ('revokeInvitation', 'revokeSession', 'globalRevoke') then
    if target_payload ->> 'expected_status' not in (
      'pending_mfa', 'active', 'suspended'
    ) then
      raise exception 'invalid expected Admin membership status'
        using errcode = '22023';
    end if;
    begin
      expected_updated_at_value :=
        (target_payload ->> 'expected_updated_at')::timestamptz;
    exception when invalid_text_representation or datetime_field_overflow then
      raise exception 'invalid expected Admin membership version'
        using errcode = '22023';
    end;
  elsif target_action = 'revokeInvitation' then
    begin
      expected_updated_at_value :=
        (target_payload ->> 'expected_updated_at')::timestamptz;
    exception when invalid_text_representation or datetime_field_overflow then
      raise exception 'invalid expected Admin invitation version'
        using errcode = '22023';
    end;
  end if;

  if target_action in ('demoteOwner', 'suspendMembership', 'revokeMembership') then
    reason_value := target_payload ->> 'reason_code';
    if reason_value is null or reason_value !~ '^[a-z][a-z0-9_]{0,79}$' then
      raise exception 'invalid Admin ledger reason' using errcode = '22023';
    end if;
  end if;

  if target_action = 'demoteOwner' then
    begin
      membership_expires_at_value := case
        when jsonb_typeof(target_payload -> 'membership_expires_at') = 'null'
          then null
        else (target_payload ->> 'membership_expires_at')::timestamptz
      end;
    exception when invalid_text_representation or datetime_field_overflow then
      raise exception 'invalid Admin membership expiry' using errcode = '22023';
    end;
  end if;

  return jsonb_strip_nulls(jsonb_build_object(
    'expected_can_use_ai', case
      when target_action in ('enableAi', 'disableAi')
        then (target_payload ->> 'expected_can_use_ai')::boolean
      else null end,
    'expected_role', case
      when target_action in ('promoteOwner', 'demoteOwner')
        then target_payload ->> 'expected_role'
      else null end,
    'expected_status', case
      when target_action not in ('revokeSession', 'globalRevoke')
        then target_payload ->> 'expected_status'
      else null end,
    'expected_updated_at', expected_updated_at_value,
    'invitation_id', case when target_action = 'revokeInvitation'
      then (target_payload ->> 'invitation_id')::uuid else null end,
    'membership_expires_at', membership_expires_at_value,
    'membership_id', case when target_action <> 'revokeInvitation'
      then (target_payload ->> 'membership_id')::uuid else null end,
    'reason_code', reason_value,
    'session_id', case when target_action = 'revokeSession'
      then (target_payload ->> 'session_id')::uuid else null end
  ));
end;
$$;

revoke all on function private.normalize_google_admin_ledger_payload_v1(
  text, jsonb
) from public, anon, authenticated, service_role;

create function private.google_admin_ledger_payload_digest_v1(
  target_action text,
  target_payload jsonb
)
returns text
language sql
immutable
security definer
set search_path = ''
as $$
  select pg_catalog.encode(
    extensions.digest(
      pg_catalog.convert_to(
        'compass:phase7.30d:admin-ledger-payload:v1'
        || '|action=' || target_action
        || '|payload='
        || private.normalize_google_admin_ledger_payload_v1(
          target_action,
          target_payload
        )::text,
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );
$$;

revoke all on function private.google_admin_ledger_payload_digest_v1(
  text, jsonb
) from public, anon, authenticated, service_role;

create function private.get_google_admin_ledger_intent_v1(
  target_token_hash text,
  target_auth_user_id uuid,
  target_supabase_auth_session_id uuid,
  target_google_issuer text,
  target_provider_subject_hmac text,
  target_subject_pepper_version integer,
  target_transport_enabled boolean,
  target_action text,
  target_request_id uuid,
  target_payload jsonb
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
  operation_key_value text := 'manage-admin-ledger.' || target_action;
  context_value jsonb;
  normalized_payload jsonb;
  payload_digest_value text;
  target_id_value text;
  intent_digest_value text;
begin
  if target_request_id is null then
    raise exception 'invalid Admin ledger intent request' using errcode = '22023';
  end if;

  normalized_payload := private.normalize_google_admin_ledger_payload_v1(
    target_action,
    target_payload
  );
  payload_digest_value := private.google_admin_ledger_payload_digest_v1(
    target_action,
    target_payload
  );
  target_id_value := case
    when target_action = 'issueInvitation' then
      normalized_payload ->> 'email_hmac'
    when target_action = 'revokeInvitation' then
      normalized_payload ->> 'invitation_id'
    when target_action = 'revokeSession' then
      normalized_payload ->> 'session_id'
    else normalized_payload ->> 'membership_id'
  end;

  if private.serialize_google_admin_ledger_environment_v1(
    target_token_hash,
    target_auth_user_id,
    target_supabase_auth_session_id
  ) is null then
    return null;
  end if;
  perform private.serialize_admin_ai_request_v1(target_request_id);
  context_value := private.require_google_admin_ledger_context_v1(
    target_token_hash,
    target_auth_user_id,
    target_supabase_auth_session_id,
    target_google_issuer,
    target_provider_subject_hmac,
    target_subject_pepper_version,
    operation_key_value
  );
  if context_value is null
     or context_value ->> 'control_step_up_action' is null then
    return null;
  end if;
  perform private.assert_google_admin_ledger_gate_v1(
    context_value,
    target_transport_enabled
  );

  intent_digest_value := private.google_admin_operation_intent_digest_v1(
    target_request_id,
    (context_value ->> 'admin_session_id')::uuid,
    operation_key_value,
    null,
    target_id_value,
    payload_digest_value
  );
  if intent_digest_value is null then
    return null;
  end if;

  return jsonb_build_object(
    'ok', true,
    'controlStepUpAction', context_value ->> 'control_step_up_action',
    'intentDigest', intent_digest_value,
    'operationKey', operation_key_value,
    'requestId', target_request_id,
    'targetId', target_id_value
  );
end;
$$;

revoke all on function private.get_google_admin_ledger_intent_v1(
  text, uuid, uuid, text, text, integer, boolean, text, uuid, jsonb
) from public, anon, authenticated, service_role;

create function private.begin_google_admin_owner_control_step_up_v1(
  target_token_hash text,
  target_auth_user_id uuid,
  target_supabase_auth_session_id uuid,
  target_google_issuer text,
  target_provider_subject_hmac text,
  target_subject_pepper_version integer,
  target_transport_enabled boolean,
  target_operation_key text,
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
set statement_timeout = '5s'
set lock_timeout = '750ms'
as $$
declare
  context_value jsonb;
  existing_nonce private.admin_control_step_up_nonces%rowtype;
  nonce_row private.admin_control_step_up_nonces%rowtype;
  intended_action_value text;
  effective_now timestamptz := statement_timestamp();
begin
  if target_mutation_request_id is null
     or target_nonce_hash is null
     or target_nonce_hash !~ '^[0-9a-f]{64}$'
     or target_prechallenge_jwt_hash is null
     or target_prechallenge_jwt_hash !~ '^[0-9a-f]{64}$'
     or target_intent_digest is null
     or target_intent_digest !~ '^[0-9a-f]{64}$'
     or target_transport_enabled is null then
    raise exception 'invalid owner control step-up start' using errcode = '22023';
  end if;

  if private.serialize_google_admin_ledger_environment_v1(
    target_token_hash,
    target_auth_user_id,
    target_supabase_auth_session_id
  ) is null then
    return null;
  end if;
  perform private.serialize_admin_ai_request_v1(target_mutation_request_id);
  context_value := private.require_google_admin_ledger_context_v1(
    target_token_hash,
    target_auth_user_id,
    target_supabase_auth_session_id,
    target_google_issuer,
    target_provider_subject_hmac,
    target_subject_pepper_version,
    target_operation_key
  );
  if context_value is null then
    return null;
  end if;
  perform private.assert_google_admin_ledger_gate_v1(
    context_value,
    target_transport_enabled
  );
  intended_action_value := context_value ->> 'control_step_up_action';
  if intended_action_value not in (
    'admin_invitation_change', 'admin_membership_role_change',
    'admin_membership_status_change', 'admin_membership_ai_change',
    'admin_session_revoke', 'admin_global_revoke'
  ) then
    return null;
  end if;

  select nonce.*
  into existing_nonce
  from private.admin_control_step_up_nonces as nonce
  where nonce.mutation_request_id = target_mutation_request_id
  for update;

  if found then
    if existing_nonce.environment_id =
         (context_value ->> 'environment_id')::uuid
       and existing_nonce.principal_id =
         (context_value ->> 'principal_id')::uuid
       and existing_nonce.membership_id =
         (context_value ->> 'membership_id')::uuid
       and existing_nonce.admin_session_id =
         (context_value ->> 'admin_session_id')::uuid
       and existing_nonce.supabase_auth_session_id =
         target_supabase_auth_session_id
       and existing_nonce.verified_totp_factor_set_hash =
         context_value ->> 'verified_totp_factor_set_hash'
       and existing_nonce.intended_action = intended_action_value
       and existing_nonce.intent_digest = target_intent_digest
       and existing_nonce.nonce_hash = target_nonce_hash
       and existing_nonce.prechallenge_jwt_hash =
         target_prechallenge_jwt_hash then
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
      and nonce.admin_session_id =
        (context_value ->> 'admin_session_id')::uuid
      and nonce.intended_action = intended_action_value
      and nonce.issued_at >= effective_now - interval '5 minutes'
  ) then
    raise exception 'owner control step-up rate exceeded' using errcode = 'P7301';
  end if;

  update private.admin_control_step_up_nonces
  set status = 'superseded', updated_at = effective_now
  where admin_session_id = (context_value ->> 'admin_session_id')::uuid
    and intended_action = intended_action_value
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
    intended_action_value,
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
    'admin_owner_control_step_up.begin', 'admin_control_step_up_nonce',
    nonce_row.id::text, 'accepted',
    jsonb_build_object('intended_action', intended_action_value)
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

revoke all on function private.begin_google_admin_owner_control_step_up_v1(
  text, uuid, uuid, text, text, integer, boolean, text, uuid, text, text, text
) from public, anon, authenticated, service_role;

create function private.complete_google_admin_owner_control_step_up_v1(
  target_token_hash text,
  target_auth_user_id uuid,
  target_supabase_auth_session_id uuid,
  target_google_issuer text,
  target_provider_subject_hmac text,
  target_subject_pepper_version integer,
  target_transport_enabled boolean,
  target_operation_key text,
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
set statement_timeout = '5s'
set lock_timeout = '750ms'
as $$
declare
  context_value jsonb;
  nonce_snapshot private.admin_control_step_up_nonces%rowtype;
  nonce_row private.admin_control_step_up_nonces%rowtype;
  grant_row private.admin_control_step_up_grants%rowtype;
  session_row public.admin_sessions%rowtype;
  intended_action_value text;
  grant_expires_at timestamptz;
  effective_now timestamptz := statement_timestamp();
begin
  if target_intent_digest is null
     or target_intent_digest !~ '^[0-9a-f]{64}$'
     or target_mutation_request_id is null
     or target_nonce_hash is null
     or target_nonce_hash !~ '^[0-9a-f]{64}$'
     or target_current_jwt_hash is null
     or target_current_jwt_hash !~ '^[0-9a-f]{64}$'
     or target_current_jwt_iat is null
     or target_totp_amr_method is null
     or target_totp_amr_method not in ('totp', 'mfa/totp')
     or target_totp_amr_at is null
     or target_transport_enabled is null then
    raise exception 'invalid owner control step-up completion'
      using errcode = '22023';
  end if;

  if private.serialize_google_admin_ledger_environment_v1(
    target_token_hash,
    target_auth_user_id,
    target_supabase_auth_session_id
  ) is null then
    return null;
  end if;
  perform private.serialize_admin_ai_request_v1(target_mutation_request_id);
  select nonce.*
  into nonce_snapshot
  from private.admin_control_step_up_nonces as nonce
  where nonce.nonce_hash = target_nonce_hash
    and nonce.mutation_request_id = target_mutation_request_id;
  if not found or nonce_snapshot.intent_digest <> target_intent_digest then
    return null;
  end if;

  context_value := private.require_google_admin_ledger_context_v1(
    target_token_hash,
    target_auth_user_id,
    target_supabase_auth_session_id,
    target_google_issuer,
    target_provider_subject_hmac,
    target_subject_pepper_version,
    target_operation_key
  );
  if context_value is null then
    return null;
  end if;
  perform private.assert_google_admin_ledger_gate_v1(
    context_value,
    target_transport_enabled
  );
  intended_action_value := context_value ->> 'control_step_up_action';
  if nonce_snapshot.intended_action <> intended_action_value then
    return null;
  end if;

  select nonce.*
  into nonce_row
  from private.admin_control_step_up_nonces as nonce
  where nonce.id = nonce_snapshot.id
    and nonce.nonce_hash = target_nonce_hash
    and nonce.mutation_request_id = target_mutation_request_id
    and nonce.intended_action = intended_action_value
    and nonce.intent_digest = target_intent_digest
  for update;
  if not found then
    return null;
  end if;

  if nonce_row.environment_id <>
       (context_value ->> 'environment_id')::uuid
     or nonce_row.principal_id <>
       (context_value ->> 'principal_id')::uuid
     or nonce_row.membership_id <>
       (context_value ->> 'membership_id')::uuid
     or nonce_row.admin_session_id <>
       (context_value ->> 'admin_session_id')::uuid
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
    select control_grant.*
    into grant_row
    from private.admin_control_step_up_grants as control_grant
    where control_grant.control_nonce_id = nonce_row.id
      and control_grant.mutation_request_id = target_mutation_request_id
      and control_grant.intended_action = intended_action_value
      and control_grant.intent_digest = target_intent_digest
      and control_grant.completion_jwt_hash = target_current_jwt_hash
      and control_grant.verified_totp_amr_at is not distinct from
        target_totp_amr_at;
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
    source_kind, control_nonce_id, environment_id, principal_id,
    membership_id, admin_session_id, supabase_auth_session_id,
    verified_totp_factor_set_hash, intended_action, intent_digest,
    mutation_request_id, prechallenge_jwt_hash, completion_jwt_hash,
    min_amr_at, verified_totp_amr_at, issued_at, expires_at
  ) values (
    'control', nonce_row.id, nonce_row.environment_id,
    nonce_row.principal_id, nonce_row.membership_id,
    nonce_row.admin_session_id, nonce_row.supabase_auth_session_id,
    nonce_row.verified_totp_factor_set_hash, intended_action_value,
    target_intent_digest, target_mutation_request_id,
    nonce_row.prechallenge_jwt_hash, target_current_jwt_hash,
    nonce_row.min_amr_at, target_totp_amr_at, effective_now, grant_expires_at
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
    request_id, environment_id, actor_principal_id, actor_membership_id,
    actor_session_id, action, target_type, target_id, result, metadata
  ) values (
    target_mutation_request_id, grant_row.environment_id,
    grant_row.principal_id, grant_row.membership_id, grant_row.admin_session_id,
    'admin_owner_control_step_up.complete', 'admin_control_step_up_grant',
    grant_row.id::text, 'accepted',
    jsonb_build_object('intended_action', intended_action_value)
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

revoke all on function private.complete_google_admin_owner_control_step_up_v1(
  text, uuid, uuid, text, text, integer, boolean, text, text, uuid, text,
  text, timestamptz, text, timestamptz
) from public, anon, authenticated, service_role;

create function private.consume_google_admin_owner_control_step_up_grant_v1(
  target_admin_session_id uuid,
  target_action text,
  target_mutation_request_id uuid,
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
  session_row public.admin_sessions%rowtype;
  grant_row private.admin_control_step_up_grants%rowtype;
  current_factor_set_hash text;
  effective_now timestamptz := statement_timestamp();
begin
  if target_admin_session_id is null
     or target_action not in (
       'admin_invitation_change', 'admin_membership_role_change',
       'admin_membership_status_change', 'admin_membership_ai_change',
       'admin_session_revoke', 'admin_global_revoke'
     )
     or target_mutation_request_id is null
     or target_intent_digest is null
     or target_intent_digest !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid owner control grant consumption'
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

  select control_grant.*
  into grant_row
  from private.admin_control_step_up_grants as control_grant
  where control_grant.mutation_request_id = target_mutation_request_id
  for update;
  if not found
     or grant_row.source_kind <> 'control'
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
  set status = 'consumed', consumed_at = effective_now, updated_at = effective_now
  where id = grant_row.id and status = 'available'
  returning * into grant_row;

  insert into private.admin_audit_events (
    request_id, environment_id, actor_principal_id, actor_membership_id,
    actor_session_id, action, target_type, target_id, result, metadata
  ) values (
    target_mutation_request_id, grant_row.environment_id,
    grant_row.principal_id, grant_row.membership_id, grant_row.admin_session_id,
    'admin_owner_control_step_up.consume', 'admin_control_step_up_grant',
    grant_row.id::text, 'accepted',
    jsonb_build_object('intended_action', target_action)
  );

  return jsonb_build_object(
    'grant_id', grant_row.id,
    'source_kind', grant_row.source_kind,
    'verified_totp_amr_at', grant_row.verified_totp_amr_at
  );
end;
$$;

revoke all on function
  private.consume_google_admin_owner_control_step_up_grant_v1(
    uuid, text, uuid, text
  ) from public, anon, authenticated, service_role;

create function private.drain_admin_membership_ai_authority_v1(
  target_membership_id uuid,
  target_actor_admin_session_id uuid,
  target_request_id uuid,
  target_effective_at timestamptz default statement_timestamp()
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
  factor_row private.admin_ai_unlock_factors%rowtype;
  drain_value jsonb;
  revoked_factor_count integer := 0;
  superseded_nonce_count integer := 0;
  superseded_grant_count integer := 0;
begin
  if target_membership_id is null
     or target_actor_admin_session_id is null
     or target_request_id is null
     or target_effective_at is null
     or target_effective_at > statement_timestamp() + interval '1 minute' then
    raise exception 'invalid Admin membership AI drain' using errcode = '22023';
  end if;

  for factor_row in
    select factor.*
    from private.admin_ai_unlock_factors as factor
    where factor.membership_id = target_membership_id
      and factor.status = 'active'
    order by factor.id
    for update
  loop
    update private.admin_ai_unlock_factors
    set
      status = 'revoked',
      terminal_request_id = target_request_id,
      terminal_action = 'reset',
      terminal_by_admin_session_id = target_actor_admin_session_id,
      revoked_at = target_effective_at,
      revoke_reason = 'factor_revoked',
      updated_at = target_effective_at
    where id = factor_row.id
    returning * into factor_row;

    drain_value := private.drain_admin_ai_factor_authority_v1(
      factor_row.id,
      target_actor_admin_session_id,
      'factor_revoked',
      target_effective_at
    );
    revoked_factor_count := revoked_factor_count + 1;
  end loop;

  update private.admin_control_step_up_nonces
  set status = 'superseded', updated_at = target_effective_at
  where membership_id = target_membership_id and status = 'pending';
  get diagnostics superseded_nonce_count = row_count;

  update private.admin_control_step_up_grants
  set status = 'superseded', updated_at = target_effective_at
  where membership_id = target_membership_id and status = 'available';
  get diagnostics superseded_grant_count = row_count;

  return jsonb_build_object(
    'factors', revoked_factor_count,
    'grants', superseded_grant_count,
    'nonces', superseded_nonce_count
  );
end;
$$;

revoke all on function private.drain_admin_membership_ai_authority_v1(
  uuid, uuid, uuid, timestamptz
) from public, anon, authenticated, service_role;

create function private.manage_google_admin_ledger_v1(
  target_token_hash text,
  target_auth_user_id uuid,
  target_supabase_auth_session_id uuid,
  target_google_issuer text,
  target_provider_subject_hmac text,
  target_subject_pepper_version integer,
  target_transport_enabled boolean,
  target_action text,
  target_request_id uuid,
  target_payload jsonb,
  target_intent_digest text
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
  operation_key_value text := 'manage-admin-ledger.' || target_action;
  session_snapshot public.admin_sessions%rowtype;
  replay_session public.admin_sessions%rowtype;
  replay_principal private.admin_principals%rowtype;
  context_value jsonb;
  receipt_row private.admin_google_operation_receipts%rowtype;
  environment_row private.admin_environments%rowtype;
  invitation_row private.admin_invitations%rowtype;
  target_principal_row private.admin_principals%rowtype;
  target_membership_row private.admin_environment_memberships%rowtype;
  target_session_row public.admin_sessions%rowtype;
  normalized_payload jsonb;
  payload_digest_value text;
  computed_intent_digest text;
  target_id_value text;
  result_id_value text;
  result_status_value text;
  result_metadata_value jsonb := '{}'::jsonb;
  control_action_value text;
  grant_value jsonb;
  target_principal_id uuid;
  changed_value boolean := false;
  revoked_count_value integer := 0;
  drain_value jsonb := '{}'::jsonb;
  audit_target_type text;
  audit_reason_value text := 'google_admin_ledger';
  effective_now timestamptz := statement_timestamp();
begin
  if target_request_id is null
     or target_intent_digest is null
     or target_intent_digest !~ '^[0-9a-f]{64}$'
     or target_transport_enabled is null then
    raise exception 'invalid Admin ledger mutation request'
      using errcode = '22023';
  end if;

  normalized_payload := private.normalize_google_admin_ledger_payload_v1(
    target_action,
    target_payload
  );
  payload_digest_value := private.google_admin_ledger_payload_digest_v1(
    target_action,
    target_payload
  );
  target_id_value := case
    when target_action = 'issueInvitation' then
      normalized_payload ->> 'email_hmac'
    when target_action = 'revokeInvitation' then
      normalized_payload ->> 'invitation_id'
    when target_action = 'revokeSession' then
      normalized_payload ->> 'session_id'
    else normalized_payload ->> 'membership_id'
  end;

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

  perform private.serialize_admin_ai_scope_v1(
    'admin-ledger-environment',
    session_snapshot.environment_id
  );
  perform private.serialize_admin_ai_request_v1(target_request_id);

  select receipt.*
  into receipt_row
  from private.admin_google_operation_receipts as receipt
  where receipt.request_id = target_request_id;
  if found then
    select session.*
    into replay_session
    from public.admin_sessions as session
    where session.id = receipt_row.admin_session_id
      and session.token_hash = target_token_hash
      and session.authentication_method = 'google_totp'
      and session.auth_user_id = target_auth_user_id
      and session.supabase_auth_session_id = target_supabase_auth_session_id;

    select principal.*
    into replay_principal
    from private.admin_principals as principal
    where principal.id = receipt_row.principal_id
      and principal.auth_user_id = target_auth_user_id
      and principal.provider = 'google'
      and principal.google_issuer = target_google_issuer
      and principal.provider_subject_hmac = target_provider_subject_hmac
      and principal.subject_pepper_version = target_subject_pepper_version;

    computed_intent_digest := private.google_admin_operation_intent_digest_v1(
      target_request_id,
      receipt_row.admin_session_id,
      operation_key_value,
      null,
      target_id_value,
      payload_digest_value
    );

    if replay_session.id is null
       or replay_principal.id is null
       or receipt_row.operation_key <> operation_key_value
       or receipt_row.intent_digest is distinct from computed_intent_digest
       or target_intent_digest is distinct from computed_intent_digest
       or receipt_row.environment_id is distinct from
         replay_session.environment_id
       or receipt_row.principal_id is distinct from replay_session.principal_id
       or receipt_row.membership_id is distinct from
         replay_session.membership_id
       or receipt_row.supabase_auth_session_id is distinct from
         target_supabase_auth_session_id
       or receipt_row.target_id is distinct from target_id_value then
      raise exception 'Admin ledger request binding does not match its receipt'
        using errcode = 'P7335';
    end if;

    return receipt_row.result_metadata || jsonb_build_object(
      'idempotentReplay', true,
      'ok', true,
      'resultId', receipt_row.result_id,
      'resultStatus', receipt_row.result_status
    );
  end if;

  context_value := private.require_google_admin_ledger_context_v1(
    target_token_hash,
    target_auth_user_id,
    target_supabase_auth_session_id,
    target_google_issuer,
    target_provider_subject_hmac,
    target_subject_pepper_version,
    operation_key_value
  );
  if context_value is null then
    return null;
  end if;
  perform private.assert_google_admin_ledger_gate_v1(
    context_value,
    target_transport_enabled
  );

  computed_intent_digest := private.google_admin_operation_intent_digest_v1(
    target_request_id,
    (context_value ->> 'admin_session_id')::uuid,
    operation_key_value,
    null,
    target_id_value,
    payload_digest_value
  );
  if computed_intent_digest is null
     or computed_intent_digest is distinct from target_intent_digest then
    raise exception 'Admin ledger intent changed before mutation'
      using errcode = 'P7335';
  end if;

  control_action_value := context_value ->> 'control_step_up_action';
  grant_value :=
    private.consume_google_admin_owner_control_step_up_grant_v1(
      (context_value ->> 'admin_session_id')::uuid,
      control_action_value,
      target_request_id,
      target_intent_digest
    );
  if grant_value is null then
    return null;
  end if;

  select environment.*
  into environment_row
  from private.admin_environments as environment
  where environment.id = (context_value ->> 'environment_id')::uuid
    and environment.current_deployment
    and environment.status = 'active'
  for share;
  if not found then
    return null;
  end if;

  if target_action = 'issueInvitation' then
    if (normalized_payload ->> 'expires_at')::timestamptz <= effective_now
       or not pg_catalog.isfinite(
         (normalized_payload ->> 'expires_at')::timestamptz
       )
       or (
         normalized_payload ->> 'membership_expires_at' is not null
         and (
           (normalized_payload ->> 'membership_expires_at')::timestamptz <=
             effective_now
           or not pg_catalog.isfinite(
             (normalized_payload ->> 'membership_expires_at')::timestamptz
           )
           or (normalized_payload ->> 'membership_expires_at')::timestamptz <
             (normalized_payload ->> 'expires_at')::timestamptz
         )
       )
       or (
         environment_row.environment_kind = 'contest'
         and (
           normalized_payload ->> 'role' <> 'instructor'
           or coalesce(
             (normalized_payload ->> 'can_use_ai')::boolean,
             false
           ) is not true
           or normalized_payload ->> 'membership_expires_at' is null
         )
       ) then
      raise exception 'Admin invitation expiry or contest scope is invalid'
        using errcode = '22023';
    end if;

    update private.admin_invitations
    set
      status = 'expired',
      expired_at = effective_now,
      updated_at = effective_now
    where environment_id = environment_row.id
      and target_email_hmac = normalized_payload ->> 'email_hmac'
      and status = 'pending'
      and expires_at <= effective_now;

    if exists (
      select 1
      from private.admin_principals as principal
      join private.admin_environment_memberships as membership
        on membership.principal_id = principal.id
       and membership.environment_id = environment_row.id
      where principal.normalized_email =
        normalized_payload ->> 'normalized_email'
    ) then
      raise exception 'Admin invitation target already belongs to this environment'
        using errcode = 'P7335';
    end if;

    insert into private.admin_invitations (
      id, environment_id, invitation_kind, target_email_hmac,
      target_normalized_email, target_email_pepper_version,
      role, can_use_ai, token_hash, inviter_membership_id,
      expires_at, membership_expires_at, request_id
    ) values (
      extensions.gen_random_uuid(),
      environment_row.id,
      'invitation',
      normalized_payload ->> 'email_hmac',
      normalized_payload ->> 'normalized_email',
      (normalized_payload ->> 'email_pepper_version')::integer,
      normalized_payload ->> 'role',
      (normalized_payload ->> 'can_use_ai')::boolean,
      normalized_payload ->> 'invitation_token_hash',
      (context_value ->> 'membership_id')::uuid,
      (normalized_payload ->> 'expires_at')::timestamptz,
      (normalized_payload ->> 'membership_expires_at')::timestamptz,
      target_request_id
    ) returning * into invitation_row;

    changed_value := true;
    result_id_value := invitation_row.id::text;
    result_status_value := invitation_row.status;
    result_metadata_value := jsonb_build_object(
      'changed', true,
      'expiresAt', invitation_row.expires_at,
      'invitationId', invitation_row.id,
      'refreshRequired', true
    );
    audit_target_type := 'admin_invitation';

  elsif target_action = 'revokeInvitation' then
    select invitation.*
    into invitation_row
    from private.admin_invitations as invitation
    where invitation.id = (normalized_payload ->> 'invitation_id')::uuid
      and invitation.environment_id = environment_row.id
    for update;
    if not found
       or invitation_row.status is distinct from
         normalized_payload ->> 'expected_status'
       or invitation_row.updated_at is distinct from
         (normalized_payload ->> 'expected_updated_at')::timestamptz then
      raise exception 'Admin invitation changed before revoke'
        using errcode = 'P7335';
    end if;

    update private.admin_invitations
    set
      status = 'revoked',
      revoked_at = effective_now,
      revoked_by_membership_id =
        (context_value ->> 'membership_id')::uuid,
      revocation_reason = 'owner_revoked',
      updated_at = effective_now
    where id = invitation_row.id
    returning * into invitation_row;

    changed_value := true;
    result_id_value := invitation_row.id::text;
    result_status_value := invitation_row.status;
    result_metadata_value := jsonb_build_object(
      'changed', true,
      'invitationId', invitation_row.id,
      'refreshRequired', true
    );
    audit_target_type := 'admin_invitation';

  else
    select membership.principal_id
    into target_principal_id
    from private.admin_environment_memberships as membership
    where membership.id = (normalized_payload ->> 'membership_id')::uuid
      and membership.environment_id = environment_row.id;
    if not found then
      return null;
    end if;

    select principal.*
    into target_principal_row
    from private.admin_principals as principal
    where principal.id = target_principal_id
    for update;
    select membership.*
    into target_membership_row
    from private.admin_environment_memberships as membership
    where membership.id = (normalized_payload ->> 'membership_id')::uuid
      and membership.environment_id = environment_row.id
      and membership.principal_id = target_principal_row.id
    for update;
    if not found then
      return null;
    end if;

    if target_action in (
      'disableAi', 'suspendMembership', 'revokeMembership', 'globalRevoke'
    ) then
      perform private.serialize_admin_ai_scope_v1(
        'factor-membership',
        target_membership_row.id
      );
    end if;

    if target_action in (
      'promoteOwner', 'demoteOwner', 'suspendMembership',
      'reactivateMembership', 'revokeMembership', 'enableAi', 'disableAi'
    ) and (
      target_membership_row.status is distinct from
        normalized_payload ->> 'expected_status'
      or target_membership_row.updated_at is distinct from
        (normalized_payload ->> 'expected_updated_at')::timestamptz
    ) then
      raise exception 'Admin membership changed before mutation'
        using errcode = 'P7335';
    end if;

    if target_action = 'promoteOwner' then
      if target_principal_row.status <> 'active'
         or environment_row.environment_kind = 'contest'
         or target_membership_row.role is distinct from
           normalized_payload ->> 'expected_role'
         or target_membership_row.status <> 'active'
         or (
           target_membership_row.expires_at is not null
           and target_membership_row.expires_at <= effective_now
         ) then
        raise exception 'Admin membership cannot be promoted'
          using errcode = 'P7335';
      end if;
      update private.admin_environment_memberships
      set role = 'owner', expires_at = null, updated_at = effective_now
      where id = target_membership_row.id
      returning * into target_membership_row;
      result_status_value := 'promoted';

    elsif target_action = 'demoteOwner' then
      if target_membership_row.role is distinct from
           normalized_payload ->> 'expected_role'
         or target_membership_row.status <> 'active'
         or (
           normalized_payload ->> 'membership_expires_at' is not null
           and (
             not pg_catalog.isfinite(
               (normalized_payload ->> 'membership_expires_at')::timestamptz
             )
             or (normalized_payload ->> 'membership_expires_at')::timestamptz
               <= effective_now
           )
         )
         or (
           environment_row.environment_kind = 'contest'
           and normalized_payload ->> 'membership_expires_at' is null
         ) then
        raise exception 'Admin membership cannot be demoted'
          using errcode = 'P7335';
      end if;
      update private.admin_environment_memberships
      set
        role = 'instructor',
        expires_at =
          (normalized_payload ->> 'membership_expires_at')::timestamptz,
        status_reason = normalized_payload ->> 'reason_code',
        updated_at = effective_now
      where id = target_membership_row.id
      returning * into target_membership_row;
      result_status_value := 'demoted';

    elsif target_action = 'suspendMembership' then
      if target_membership_row.status <> 'active' then
        raise exception 'Admin membership cannot be suspended'
          using errcode = 'P7335';
      end if;
      update private.admin_environment_memberships
      set
        status = 'suspended',
        suspended_at = effective_now,
        revoked_at = null,
        status_reason = normalized_payload ->> 'reason_code',
        updated_at = effective_now
      where id = target_membership_row.id
      returning * into target_membership_row;
      result_status_value := 'suspended';

    elsif target_action = 'reactivateMembership' then
      if target_principal_row.status <> 'active'
         or target_membership_row.status <> 'suspended'
         or (
           target_membership_row.expires_at is not null
           and target_membership_row.expires_at <= effective_now
         ) then
        raise exception 'Admin membership cannot be reactivated'
          using errcode = 'P7335';
      end if;
      update private.admin_environment_memberships
      set
        status = 'active',
        activated_at = coalesce(activated_at, effective_now),
        suspended_at = null,
        status_reason = null,
        updated_at = effective_now
      where id = target_membership_row.id
      returning * into target_membership_row;
      result_status_value := 'reactivated';

    elsif target_action = 'revokeMembership' then
      if target_membership_row.status = 'revoked' then
        raise exception 'Admin membership is already revoked'
          using errcode = 'P7335';
      end if;
      update private.admin_environment_memberships
      set
        status = 'revoked',
        suspended_at = null,
        revoked_at = effective_now,
        status_reason = normalized_payload ->> 'reason_code',
        updated_at = effective_now
      where id = target_membership_row.id
      returning * into target_membership_row;
      result_status_value := 'revoked';

    elsif target_action in ('enableAi', 'disableAi') then
      if target_principal_row.status <> 'active'
         or target_membership_row.status <> 'active'
         or target_membership_row.can_use_ai is distinct from
           (normalized_payload ->> 'expected_can_use_ai')::boolean
         or (
           target_action = 'enableAi'
           and target_membership_row.can_use_ai
         )
         or (
           target_action = 'disableAi'
           and not target_membership_row.can_use_ai
         ) then
        raise exception 'Admin membership AI entitlement changed'
          using errcode = 'P7335';
      end if;
      update private.admin_environment_memberships
      set
        can_use_ai = target_action = 'enableAi',
        updated_at = effective_now
      where id = target_membership_row.id
      returning * into target_membership_row;
      result_status_value := case when target_action = 'enableAi'
        then 'ai_enabled' else 'ai_disabled' end;

    elsif target_action = 'revokeSession' then
      select session.*
      into target_session_row
      from public.admin_sessions as session
      where session.id = (normalized_payload ->> 'session_id')::uuid
        and session.authentication_method = 'google_totp'
        and session.environment_id = environment_row.id
        and session.membership_id = target_membership_row.id
        and session.principal_id = target_membership_row.principal_id
      for update;
      if not found then
        return null;
      end if;
      if target_session_row.revoked_at is null then
        update public.admin_sessions
        set
          revoked_at = effective_now,
          revoke_reason = 'owner_session_revoked',
          updated_at = effective_now
        where id = target_session_row.id;
        revoked_count_value := 1;
      end if;
      result_status_value := case when revoked_count_value = 1
        then 'session_revoked' else 'already_revoked' end;

    elsif target_action = 'globalRevoke' then
      if target_membership_row.id =
         (context_value ->> 'membership_id')::uuid then
        raise exception 'owner global revoke cannot target the acting membership'
          using errcode = 'P7335';
      end if;
      result_status_value := 'authority_revoked';
    end if;

    if target_action in (
      'suspendMembership', 'revokeMembership', 'globalRevoke'
    ) then
      for target_session_row in
        select session.*
        from public.admin_sessions as session
        where session.authentication_method = 'google_totp'
          and session.environment_id = environment_row.id
          and session.membership_id = target_membership_row.id
          and session.principal_id = target_membership_row.principal_id
        order by session.id
        for update
      loop
        if target_session_row.revoked_at is null then
          update public.admin_sessions
          set
            revoked_at = effective_now,
            revoke_reason = case target_action
              when 'suspendMembership' then 'membership_suspended'
              when 'revokeMembership' then 'membership_revoked'
              else 'owner_global_revoke'
            end,
            updated_at = effective_now
          where id = target_session_row.id;
          revoked_count_value := revoked_count_value + 1;
        end if;
      end loop;
    end if;

    if target_action in (
      'disableAi', 'suspendMembership', 'revokeMembership', 'globalRevoke'
    ) then
      drain_value := private.drain_admin_membership_ai_authority_v1(
        target_membership_row.id,
        (context_value ->> 'admin_session_id')::uuid,
        target_request_id,
        effective_now
      );
    end if;

    changed_value := true;
    result_id_value := case when target_action = 'revokeSession'
      then target_session_row.id::text else target_membership_row.id::text end;
    result_metadata_value := jsonb_build_object(
      'changed', true,
      'refreshRequired', true,
      'revokedCount', revoked_count_value
    );
    audit_target_type := case when target_action = 'revokeSession'
      then 'admin_session' else 'admin_membership' end;
    audit_reason_value := coalesce(
      normalized_payload ->> 'reason_code',
      'google_admin_ledger'
    );
  end if;

  insert into private.admin_google_operation_receipts (
    request_id, operation_key, intent_digest, environment_id,
    principal_id, membership_id, admin_session_id,
    supabase_auth_session_id, lecture_session_id, target_id,
    result_id, result_status, result_metadata
  ) values (
    target_request_id,
    operation_key_value,
    computed_intent_digest,
    (context_value ->> 'environment_id')::uuid,
    (context_value ->> 'principal_id')::uuid,
    (context_value ->> 'membership_id')::uuid,
    (context_value ->> 'admin_session_id')::uuid,
    target_supabase_auth_session_id,
    null,
    target_id_value,
    result_id_value,
    result_status_value,
    result_metadata_value
  );

  insert into private.admin_audit_events (
    request_id, environment_id, actor_principal_id, actor_membership_id,
    actor_session_id, action, target_type, target_id, result,
    reason_code, metadata
  ) values (
    target_request_id,
    (context_value ->> 'environment_id')::uuid,
    (context_value ->> 'principal_id')::uuid,
    (context_value ->> 'membership_id')::uuid,
    (context_value ->> 'admin_session_id')::uuid,
    'admin_ledger.' || target_action,
    audit_target_type,
    result_id_value,
    'accepted',
    audit_reason_value,
    jsonb_build_object(
      'changed', changed_value,
      'revoked_count', revoked_count_value,
      'step_up_action', control_action_value
    )
  );

  return result_metadata_value || jsonb_build_object(
    'idempotentReplay', false,
    'ok', true,
    'resultId', result_id_value,
    'resultStatus', result_status_value
  );
end;
$$;

revoke all on function private.manage_google_admin_ledger_v1(
  text, uuid, uuid, text, text, integer, boolean, text, uuid, jsonb, text
) from public, anon, authenticated, service_role;

create function public.get_google_admin_ledger_v1(
  target_token_hash text,
  target_auth_user_id uuid,
  target_supabase_auth_session_id uuid,
  target_google_issuer text,
  target_provider_subject_hmac text,
  target_subject_pepper_version integer,
  target_transport_enabled boolean
)
returns jsonb
language sql
volatile
security definer
set search_path = ''
as $$
  select private.get_google_admin_ledger_v1(
    target_token_hash,
    target_auth_user_id,
    target_supabase_auth_session_id,
    target_google_issuer,
    target_provider_subject_hmac,
    target_subject_pepper_version,
    target_transport_enabled
  );
$$;

create function public.get_google_admin_ledger_audit_v1(
  target_token_hash text,
  target_auth_user_id uuid,
  target_supabase_auth_session_id uuid,
  target_google_issuer text,
  target_provider_subject_hmac text,
  target_subject_pepper_version integer,
  target_transport_enabled boolean,
  target_before_at timestamptz default null,
  target_before_id bigint default null,
  target_limit integer default 50
)
returns jsonb
language sql
volatile
security definer
set search_path = ''
as $$
  select private.get_google_admin_ledger_audit_v1(
    target_token_hash,
    target_auth_user_id,
    target_supabase_auth_session_id,
    target_google_issuer,
    target_provider_subject_hmac,
    target_subject_pepper_version,
    target_transport_enabled,
    target_before_at,
    target_before_id,
    target_limit
  );
$$;

create function public.get_google_admin_ledger_intent_v1(
  target_token_hash text,
  target_auth_user_id uuid,
  target_supabase_auth_session_id uuid,
  target_google_issuer text,
  target_provider_subject_hmac text,
  target_subject_pepper_version integer,
  target_transport_enabled boolean,
  target_action text,
  target_request_id uuid,
  target_payload jsonb
)
returns jsonb
language sql
volatile
security definer
set search_path = ''
as $$
  select private.get_google_admin_ledger_intent_v1(
    target_token_hash,
    target_auth_user_id,
    target_supabase_auth_session_id,
    target_google_issuer,
    target_provider_subject_hmac,
    target_subject_pepper_version,
    target_transport_enabled,
    target_action,
    target_request_id,
    target_payload
  );
$$;

create function public.begin_google_admin_owner_control_step_up_v1(
  target_token_hash text,
  target_auth_user_id uuid,
  target_supabase_auth_session_id uuid,
  target_google_issuer text,
  target_provider_subject_hmac text,
  target_subject_pepper_version integer,
  target_transport_enabled boolean,
  target_operation_key text,
  target_mutation_request_id uuid,
  target_nonce_hash text,
  target_prechallenge_jwt_hash text,
  target_intent_digest text
)
returns jsonb
language sql
volatile
security definer
set search_path = ''
as $$
  select private.begin_google_admin_owner_control_step_up_v1(
    target_token_hash,
    target_auth_user_id,
    target_supabase_auth_session_id,
    target_google_issuer,
    target_provider_subject_hmac,
    target_subject_pepper_version,
    target_transport_enabled,
    target_operation_key,
    target_mutation_request_id,
    target_nonce_hash,
    target_prechallenge_jwt_hash,
    target_intent_digest
  );
$$;

create function public.complete_google_admin_owner_control_step_up_v1(
  target_token_hash text,
  target_auth_user_id uuid,
  target_supabase_auth_session_id uuid,
  target_google_issuer text,
  target_provider_subject_hmac text,
  target_subject_pepper_version integer,
  target_transport_enabled boolean,
  target_operation_key text,
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
security definer
set search_path = ''
as $$
  select private.complete_google_admin_owner_control_step_up_v1(
    target_token_hash,
    target_auth_user_id,
    target_supabase_auth_session_id,
    target_google_issuer,
    target_provider_subject_hmac,
    target_subject_pepper_version,
    target_transport_enabled,
    target_operation_key,
    target_intent_digest,
    target_mutation_request_id,
    target_nonce_hash,
    target_current_jwt_hash,
    target_current_jwt_iat,
    target_totp_amr_method,
    target_totp_amr_at
  );
$$;

create function public.manage_google_admin_ledger_v1(
  target_token_hash text,
  target_auth_user_id uuid,
  target_supabase_auth_session_id uuid,
  target_google_issuer text,
  target_provider_subject_hmac text,
  target_subject_pepper_version integer,
  target_transport_enabled boolean,
  target_action text,
  target_request_id uuid,
  target_payload jsonb,
  target_intent_digest text
)
returns jsonb
language sql
volatile
security definer
set search_path = ''
as $$
  select private.manage_google_admin_ledger_v1(
    target_token_hash,
    target_auth_user_id,
    target_supabase_auth_session_id,
    target_google_issuer,
    target_provider_subject_hmac,
    target_subject_pepper_version,
    target_transport_enabled,
    target_action,
    target_request_id,
    target_payload,
    target_intent_digest
  );
$$;

revoke all on function public.get_google_admin_ledger_v1(
  text, uuid, uuid, text, text, integer, boolean
) from public, anon, authenticated;
grant execute on function public.get_google_admin_ledger_v1(
  text, uuid, uuid, text, text, integer, boolean
) to service_role;

revoke all on function public.get_google_admin_ledger_audit_v1(
  text, uuid, uuid, text, text, integer, boolean,
  timestamptz, bigint, integer
) from public, anon, authenticated;
grant execute on function public.get_google_admin_ledger_audit_v1(
  text, uuid, uuid, text, text, integer, boolean,
  timestamptz, bigint, integer
) to service_role;

revoke all on function public.get_google_admin_ledger_intent_v1(
  text, uuid, uuid, text, text, integer, boolean, text, uuid, jsonb
) from public, anon, authenticated;
grant execute on function public.get_google_admin_ledger_intent_v1(
  text, uuid, uuid, text, text, integer, boolean, text, uuid, jsonb
) to service_role;

revoke all on function public.begin_google_admin_owner_control_step_up_v1(
  text, uuid, uuid, text, text, integer, boolean, text, uuid, text, text, text
) from public, anon, authenticated;
grant execute on function public.begin_google_admin_owner_control_step_up_v1(
  text, uuid, uuid, text, text, integer, boolean, text, uuid, text, text, text
) to service_role;

revoke all on function public.complete_google_admin_owner_control_step_up_v1(
  text, uuid, uuid, text, text, integer, boolean, text, text, uuid, text,
  text, timestamptz, text, timestamptz
) from public, anon, authenticated;
grant execute on function public.complete_google_admin_owner_control_step_up_v1(
  text, uuid, uuid, text, text, integer, boolean, text, text, uuid, text,
  text, timestamptz, text, timestamptz
) to service_role;

revoke all on function public.manage_google_admin_ledger_v1(
  text, uuid, uuid, text, text, integer, boolean, text, uuid, jsonb, text
) from public, anon, authenticated;
grant execute on function public.manage_google_admin_ledger_v1(
  text, uuid, uuid, text, text, integer, boolean, text, uuid, jsonb, text
) to service_role;
