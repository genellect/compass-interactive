-- One Owner approval binds teacher entitlement and bounded AI policy together.
-- Historical payloads/receipts keep their exact canonical form. No Auth session
-- is created, revoked, renewed or extended by this migration or its new paths.

create function private.normalize_teacher_ai_policy_terms_v1(target_policy jsonb)
returns jsonb language plpgsql immutable security definer set search_path = ''
as $$
declare
  lecture_limit bigint;
  day_limit bigint;
begin
  if target_policy is null or jsonb_typeof(target_policy) <> 'object'
     or (select count(*) from jsonb_object_keys(target_policy)) <> 3
     or not target_policy ?& array[
       'max_cost_microusd_per_lecture', 'max_cost_microusd_per_day', 'validity_days'
     ]
     or jsonb_typeof(target_policy -> 'max_cost_microusd_per_lecture') <> 'number'
     or jsonb_typeof(target_policy -> 'max_cost_microusd_per_day') <> 'number'
     or target_policy ->> 'max_cost_microusd_per_lecture' !~ '^[0-9]{1,8}$'
     or target_policy ->> 'max_cost_microusd_per_day' !~ '^[0-9]{1,8}$'
     or target_policy -> 'validity_days' is distinct from '30'::jsonb then
    raise exception 'invalid teacher AI policy terms' using errcode = '22023';
  end if;
  lecture_limit := (target_policy ->> 'max_cost_microusd_per_lecture')::bigint;
  day_limit := (target_policy ->> 'max_cost_microusd_per_day')::bigint;
  if lecture_limit not between 10000 and 5000000
     or day_limit not between lecture_limit and 20000000 then
    raise exception 'invalid teacher AI policy limits' using errcode = '22023';
  end if;
  return jsonb_build_object(
    'max_cost_microusd_per_lecture', lecture_limit,
    'max_cost_microusd_per_day', day_limit,
    'validity_days', 30
  );
end;
$$;
revoke all on function private.normalize_teacher_ai_policy_terms_v1(jsonb)
  from public, anon, authenticated, service_role;

alter function private.normalize_google_admin_ledger_payload_v1(text, jsonb)
  rename to normalize_google_admin_ledger_payload_pre_one_step_v1;

create function private.normalize_google_admin_ledger_payload_v1(
  target_action text, target_payload jsonb
)
returns jsonb language plpgsql immutable security definer set search_path = ''
as $$
declare
  normalized_payload jsonb;
  policy_terms jsonb;
begin
  if not coalesce(target_payload ? 'ai_policy', false) then
    return private.normalize_google_admin_ledger_payload_pre_one_step_v1(
      target_action, target_payload
    );
  end if;
  if target_action not in ('issueInvitation', 'enableAi') then
    raise exception 'AI policy is not allowed on this ledger action'
      using errcode = '22023';
  end if;
  policy_terms := private.normalize_teacher_ai_policy_terms_v1(target_payload -> 'ai_policy');
  normalized_payload := private.normalize_google_admin_ledger_payload_pre_one_step_v1(
    target_action, target_payload - 'ai_policy'
  );
  if target_action = 'issueInvitation' and (
    normalized_payload ->> 'role' <> 'instructor'
    or (normalized_payload ->> 'can_use_ai')::boolean is not true
    or normalized_payload ->> 'membership_expires_at' is not null
  ) then
    raise exception 'AI invitation must grant an ordinary instructor'
      using errcode = '22023';
  end if;
  return normalized_payload || jsonb_build_object('ai_policy', policy_terms);
end;
$$;
revoke all on function private.normalize_google_admin_ledger_payload_v1(text, jsonb)
  from public, anon, authenticated, service_role;
revoke all on function private.normalize_google_admin_ledger_payload_pre_one_step_v1(text, jsonb)
  from public, anon, authenticated, service_role;

-- Rebind the short string-body SQL entry explicitly to the canonical normalizer.
create or replace function private.google_admin_ledger_payload_digest_v1(
  target_action text, target_payload jsonb
)
returns text language sql immutable security definer set search_path = ''
as $$
  select pg_catalog.encode(extensions.digest(pg_catalog.convert_to(
    'compass:phase7.30d:admin-ledger-payload:v1'
    || '|action=' || target_action || '|payload='
    || private.normalize_google_admin_ledger_payload_v1(target_action, target_payload)::text,
    'UTF8'), 'sha256'), 'hex');
$$;
revoke all on function private.google_admin_ledger_payload_digest_v1(text, jsonb)
  from public, anon, authenticated, service_role;

create table private.admin_invitation_ai_policy_contracts (
  invitation_id uuid primary key references private.admin_invitations(id) on delete restrict,
  request_id uuid not null unique references private.admin_google_operation_receipts(request_id) on delete restrict,
  policy_terms jsonb not null check (
    policy_terms = private.normalize_teacher_ai_policy_terms_v1(policy_terms)
  ),
  created_at timestamptz not null default statement_timestamp()
);
alter table private.admin_invitation_ai_policy_contracts enable row level security;
revoke all on private.admin_invitation_ai_policy_contracts from public, anon, authenticated, service_role;

create function private.reject_invitation_ai_policy_contract_change_v1()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  raise exception 'invitation AI policy approval is immutable' using errcode = '55000';
end;
$$;
revoke all on function private.reject_invitation_ai_policy_contract_change_v1()
  from public, anon, authenticated, service_role;
create trigger admin_invitation_ai_policy_contracts_immutable
before update or delete on private.admin_invitation_ai_policy_contracts
for each row execute function private.reject_invitation_ai_policy_contract_change_v1();

-- Callable only inside the verified ledger/acceptance transaction. The target
-- membership is already locked by that transaction. Do NOT acquire a later
-- policy-membership advisory lock: the ordinary setter uses the reverse order.
create function private.apply_teacher_ai_policy_from_ledger_v1(
  target_membership_id uuid, target_request_id uuid, target_policy jsonb
)
returns uuid language plpgsql volatile security definer set search_path = ''
set statement_timeout = '5s' set lock_timeout = '750ms'
as $$
declare
  receipt private.admin_google_operation_receipts%rowtype;
  membership private.admin_environment_memberships%rowtype;
  previous_policy private.admin_ai_policies%rowtype;
  terms jsonb;
  next_version bigint;
  result_id uuid;
  effective_now timestamptz := statement_timestamp();
begin
  terms := private.normalize_teacher_ai_policy_terms_v1(target_policy);
  select * into receipt from private.admin_google_operation_receipts
  where request_id = target_request_id;
  if not found or receipt.operation_key not in (
    'manage-admin-ledger.issueInvitation', 'manage-admin-ledger.enableAi'
  ) then
    raise exception 'teacher AI approval receipt is missing' using errcode = 'P7335';
  end if;
  select * into membership from private.admin_environment_memberships
  where id = target_membership_id and environment_id = receipt.environment_id
    and role = 'instructor' and can_use_ai
    and (expires_at is null or expires_at > effective_now)
  for update;
  if not found then
    raise exception 'teacher AI membership is unavailable' using errcode = 'P7335';
  end if;
  if receipt.operation_key = 'manage-admin-ledger.enableAi' then
    if membership.status <> 'active' or receipt.result_id <> membership.id::text
       or receipt.result_status <> 'ai_enabled' then
      raise exception 'teacher AI approval target mismatch' using errcode = 'P7335';
    end if;
  else
    if membership.status not in ('pending_mfa', 'active') or not exists (
      select 1 from private.admin_invitations invitation
      join private.admin_invitation_ai_policy_contracts contract
        on contract.invitation_id = invitation.id
      where invitation.id::text = receipt.result_id
        and invitation.request_id = receipt.request_id
        and invitation.environment_id = receipt.environment_id
        and invitation.inviter_membership_id = receipt.membership_id
        and invitation.role = 'instructor' and invitation.can_use_ai
        and invitation.status = 'accepted'
        and invitation.accepted_membership_id = membership.id
        and invitation.accepted_principal_id = membership.principal_id
        and contract.request_id = receipt.request_id
        and contract.policy_terms = terms
    ) then
      raise exception 'teacher AI invitation binding mismatch' using errcode = 'P7335';
    end if;
  end if;
  if exists (select 1 from private.admin_ai_policies where request_id = target_request_id) then
    raise exception 'teacher AI policy already exists for this request' using errcode = 'P7335';
  end if;
  select * into previous_policy from private.admin_ai_policies
  where environment_id = membership.environment_id and membership_id = membership.id
    and status = 'active' for update;
  select coalesce(max(version), 0) + 1 into next_version from private.admin_ai_policies
  where environment_id = membership.environment_id and membership_id = membership.id;
  if previous_policy.id is not null then
    update private.admin_ai_policies set status = 'superseded',
      revoked_at = effective_now, updated_at = effective_now where id = previous_policy.id;
    perform private.drain_admin_ai_policy_authority_v1(
      previous_policy.id, receipt.admin_session_id, effective_now
    );
  end if;
  insert into private.admin_ai_policies (
    environment_id, membership_id, allowed_actions, allowed_models,
    max_calls_per_lecture, max_calls_per_day, max_input_tokens_per_lecture,
    max_input_tokens_per_day, max_output_tokens_per_lecture, max_output_tokens_per_day,
    max_cost_microusd_per_lecture, max_cost_microusd_per_day,
    max_realtime_minutes_per_lecture, max_realtime_minutes_per_day, max_concurrency,
    valid_from, valid_until, version, supersedes_policy_id,
    created_by_membership_id, created_by_admin_session_id, request_id
  ) values (
    membership.environment_id, membership.id,
    array['academic_answers', 'captions', 'material_analysis', 'poll_suggestions', 'summaries'],
    array['gpt-5.6-luna', 'gpt-realtime-whisper'],
    24, 96, 200000, 800000, 40000, 160000,
    (terms ->> 'max_cost_microusd_per_lecture')::bigint,
    (terms ->> 'max_cost_microusd_per_day')::bigint,
    90, 180, 2, effective_now, effective_now + interval '30 days', next_version,
    previous_policy.id, receipt.membership_id, receipt.admin_session_id, target_request_id
  ) returning id into result_id;
  insert into private.admin_audit_events (
    request_id, environment_id, actor_principal_id, actor_membership_id,
    actor_session_id, action, target_type, target_id, result, metadata
  ) values (
    receipt.request_id, receipt.environment_id, receipt.principal_id,
    receipt.membership_id, receipt.admin_session_id, 'admin_ai_policy.set',
    'admin_ai_policy', result_id::text, 'accepted',
    jsonb_build_object('membership_id', membership.id, 'version', next_version,
      'approval_source', receipt.operation_key)
  );
  return result_id;
end;
$$;
revoke all on function private.apply_teacher_ai_policy_from_ledger_v1(uuid, uuid, jsonb)
  from public, anon, authenticated, service_role;

alter function private.manage_google_admin_ledger_v1(
  text, uuid, uuid, text, text, integer, boolean, text, uuid, jsonb, text
) rename to manage_google_admin_ledger_pre_one_step_v1;

create function private.manage_google_admin_ledger_v1(
  target_token_hash text, target_auth_user_id uuid,
  target_supabase_auth_session_id uuid, target_google_issuer text,
  target_provider_subject_hmac text, target_subject_pepper_version integer,
  target_transport_enabled boolean, target_action text, target_request_id uuid,
  target_payload jsonb, target_intent_digest text
)
returns jsonb language plpgsql volatile security definer set search_path = ''
set statement_timeout = '8s' set lock_timeout = '750ms'
as $$
declare
  result_value jsonb;
  normalized_payload jsonb;
begin
  normalized_payload := private.normalize_google_admin_ledger_payload_v1(target_action, target_payload);
  result_value := private.manage_google_admin_ledger_pre_one_step_v1(
    target_token_hash, target_auth_user_id, target_supabase_auth_session_id,
    target_google_issuer, target_provider_subject_hmac, target_subject_pepper_version,
    target_transport_enabled, target_action, target_request_id, target_payload, target_intent_digest
  );
  -- Historical receipt recovery proves a past result, not current mutation
  -- authority. Never repair/create a policy or contract on the replay path.
  if result_value is null or result_value ->> 'idempotentReplay' = 'true'
     or not normalized_payload ? 'ai_policy' then
    return result_value;
  end if;
  if target_action = 'issueInvitation' then
    if not exists (
      select 1 from private.admin_invitations invitation
      join private.admin_google_operation_receipts receipt on receipt.request_id = invitation.request_id
      where invitation.id::text = result_value ->> 'resultId'
        and invitation.request_id = target_request_id
        and invitation.status = 'pending' and invitation.role = 'instructor' and invitation.can_use_ai
        and invitation.expires_at <= statement_timestamp() + interval '48 hours'
        and receipt.operation_key = 'manage-admin-ledger.issueInvitation'
        and receipt.result_id = invitation.id::text
        and receipt.environment_id = invitation.environment_id
        and receipt.membership_id = invitation.inviter_membership_id
    ) then
      raise exception 'AI invitation approval does not match' using errcode = 'P7335';
    end if;
    insert into private.admin_invitation_ai_policy_contracts (invitation_id, request_id, policy_terms)
    values ((result_value ->> 'resultId')::uuid, target_request_id, normalized_payload -> 'ai_policy');
  elsif target_action = 'enableAi' then
    perform private.apply_teacher_ai_policy_from_ledger_v1(
      (normalized_payload ->> 'membership_id')::uuid,
      target_request_id, normalized_payload -> 'ai_policy'
    );
  end if;
  return result_value;
end;
$$;
revoke all on function private.manage_google_admin_ledger_v1(
  text, uuid, uuid, text, text, integer, boolean, text, uuid, jsonb, text
) from public, anon, authenticated, service_role;
revoke all on function private.manage_google_admin_ledger_pre_one_step_v1(
  text, uuid, uuid, text, text, integer, boolean, text, uuid, jsonb, text
) from public, anon, authenticated, service_role;

create or replace function public.manage_google_admin_ledger_v1(
  target_token_hash text, target_auth_user_id uuid,
  target_supabase_auth_session_id uuid, target_google_issuer text,
  target_provider_subject_hmac text, target_subject_pepper_version integer,
  target_transport_enabled boolean, target_action text, target_request_id uuid,
  target_payload jsonb, target_intent_digest text
)
returns jsonb language sql volatile security definer set search_path = ''
as $$
  select private.manage_google_admin_ledger_v1(
    target_token_hash, target_auth_user_id, target_supabase_auth_session_id,
    target_google_issuer, target_provider_subject_hmac, target_subject_pepper_version,
    target_transport_enabled, target_action, target_request_id, target_payload, target_intent_digest
  );
$$;
revoke all on function public.manage_google_admin_ledger_v1(
  text, uuid, uuid, text, text, integer, boolean, text, uuid, jsonb, text
) from public, anon, authenticated;
grant execute on function public.manage_google_admin_ledger_v1(
  text, uuid, uuid, text, text, integer, boolean, text, uuid, jsonb, text
) to service_role;

create function private.apply_accepted_invitation_ai_policy_v1()
returns trigger language plpgsql volatile security definer set search_path = ''
as $$
declare
  contract private.admin_invitation_ai_policy_contracts%rowtype;
begin
  select * into contract from private.admin_invitation_ai_policy_contracts where invitation_id = new.id;
  if not found then return new; end if;
  perform private.apply_teacher_ai_policy_from_ledger_v1(
    new.accepted_membership_id, contract.request_id, contract.policy_terms
  );
  return new;
end;
$$;
revoke all on function private.apply_accepted_invitation_ai_policy_v1()
  from public, anon, authenticated, service_role;
create trigger admin_invitations_apply_teacher_ai_policy
after update of status on private.admin_invitations
for each row when (old.status = 'pending' and new.status = 'accepted')
execute function private.apply_accepted_invitation_ai_policy_v1();
