-- Phase 7.30C2: recoverable, single-owner provider dispatch claims.
--
-- Starting an AI usage row and sending the external provider request are
-- necessarily separate transactions. This append-only claim closes the
-- response-loss gap: a retry may claim a start that committed before the Edge
-- response was lost, while a request that may already have reached the
-- provider can never be dispatched a second time.

create table private.admin_google_ai_provider_dispatch_receipts (
  start_request_id uuid primary key
    references private.admin_google_ai_provider_start_receipts(start_request_id)
      on delete restrict,
  operation_id uuid not null unique
    references public.ai_usage_ledger(id) on delete restrict,
  provider_family text not null check (
    provider_family in ('openai_responses_v1', 'openai_realtime_v1')
  ),
  client_request_id uuid not null unique,
  claimed_at timestamptz not null default statement_timestamp(),
  lease_expires_at timestamptz not null,
  check (
    lease_expires_at > claimed_at
    and lease_expires_at <= claimed_at + interval '2 minutes'
  )
);

create index admin_google_ai_dispatch_operation_idx
  on private.admin_google_ai_provider_dispatch_receipts (
    operation_id,
    claimed_at desc
  );
create index admin_google_ai_dispatch_lease_idx
  on private.admin_google_ai_provider_dispatch_receipts (
    lease_expires_at,
    start_request_id
  );

alter table private.admin_google_ai_provider_dispatch_receipts
  enable row level security;
revoke all on private.admin_google_ai_provider_dispatch_receipts
  from public, anon, authenticated, service_role;

create trigger admin_google_ai_dispatch_receipts_append_only
before update or delete on private.admin_google_ai_provider_dispatch_receipts
for each row execute function private.reject_admin_c1_evidence_mutation_v1();

create function private.require_google_ai_dispatch_receipt_on_terminal_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (
    new.status = 'succeeded'
    or coalesce(new.result_accepted, false)
  )
  and exists (
    select 1
    from private.admin_google_ai_provider_start_receipts as start_receipt
    where start_receipt.operation_id = new.id
  )
  and not exists (
    select 1
    from private.admin_google_ai_provider_start_receipts as start_receipt
    join private.admin_google_ai_provider_dispatch_receipts as dispatch_receipt
      on dispatch_receipt.start_request_id = start_receipt.start_request_id
     and dispatch_receipt.operation_id = start_receipt.operation_id
    where start_receipt.operation_id = new.id
  ) then
    raise exception 'Google AI provider result lacks dispatch evidence'
      using errcode = 'P7335';
  end if;
  return new;
end;
$$;

revoke all on function private.require_google_ai_dispatch_receipt_on_terminal_v1()
  from public, anon, authenticated, service_role;

create trigger ai_usage_google_dispatch_terminal_guard
before update of status, result_accepted on public.ai_usage_ledger
for each row execute function
  private.require_google_ai_dispatch_receipt_on_terminal_v1();

create function private.settle_stale_google_ai_provider_dispatch_v1(
  target_start_request_id uuid
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
  receipt_row private.admin_google_ai_provider_dispatch_receipts%rowtype;
  intent_row private.admin_google_ai_provider_start_intents%rowtype;
  lecture_row public.lecture_sessions%rowtype;
  usage_row public.ai_usage_ledger%rowtype;
  settlement jsonb;
  actor_value text;
  effective_now timestamptz := statement_timestamp();
begin
  if target_start_request_id is null then
    return null;
  end if;

  perform private.serialize_admin_ai_request_v1(target_start_request_id);

  select receipt.*
  into receipt_row
  from private.admin_google_ai_provider_dispatch_receipts as receipt
  where receipt.start_request_id = target_start_request_id;
  if not found or receipt_row.lease_expires_at > effective_now then
    return null;
  end if;

  select intent.*
  into intent_row
  from private.admin_google_ai_provider_start_intents as intent
  where intent.start_request_id = target_start_request_id
    and intent.provider_family = receipt_row.provider_family;
  if not found
     or intent_row.feature not in ('material_analysis', 'poll_suggestions') then
    return null;
  end if;

  select lecture.*
  into lecture_row
  from public.lecture_sessions as lecture
  where lecture.id = intent_row.lecture_session_id
  for update;
  if not found then
    return null;
  end if;

  select usage.*
  into usage_row
  from public.ai_usage_ledger as usage
  where usage.id = receipt_row.operation_id
  for update;
  if not found then
    return null;
  end if;
  if usage_row.accounting_settled_at is not null then
    return jsonb_build_object(
      'accepted', true,
      'alreadyTerminal', true,
      'operationId', usage_row.id,
      'staleRecovered', false
    );
  end if;

  actor_value := 'admin-session:' || intent_row.admin_session_id::text;
  if usage_row.lecture_session_id is distinct from lecture_row.id
     or usage_row.feature is distinct from intent_row.feature
     or usage_row.idempotency_key is distinct from
       target_start_request_id::text
     or usage_row.requested_by_actor is distinct from actor_value
     or usage_row.provider_dispatched_at is null
     or usage_row.provider_request_id is distinct from
       receipt_row.client_request_id::text then
    return null;
  end if;

  settlement := private.fail_material_ai_operation(
    usage_row.id,
    actor_value,
    'cancelled',
    usage_row.reserved_microusd,
    usage_row.reserved_input_tokens,
    usage_row.reserved_output_tokens,
    receipt_row.client_request_id::text,
    'provider_dispatch_lease_expired_ambiguous'
  );
  return settlement || jsonb_build_object(
    'accepted', true,
    'operationId', usage_row.id,
    'staleRecovered', true
  );
end;
$$;

revoke all on function private.settle_stale_google_ai_provider_dispatch_v1(
  uuid
) from public, anon, authenticated, service_role;

create function private.reap_stale_google_ai_provider_dispatches_v1(
  job_limit integer default 10
)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
set statement_timeout = '8s'
set lock_timeout = '750ms'
as $$
declare
  candidate record;
  settlement jsonb;
  reaped integer := 0;
begin
  if job_limit is null or job_limit not between 1 and 50 then
    return 0;
  end if;

  for candidate in
    select receipt.start_request_id
    from private.admin_google_ai_provider_dispatch_receipts as receipt
    join public.ai_usage_ledger as usage
      on usage.id = receipt.operation_id
    where receipt.lease_expires_at <= statement_timestamp()
      and usage.accounting_settled_at is null
    order by receipt.lease_expires_at, receipt.start_request_id
    limit job_limit
  loop
    settlement := private.settle_stale_google_ai_provider_dispatch_v1(
      candidate.start_request_id
    );
    if coalesce((settlement ->> 'staleRecovered')::boolean, false) then
      reaped := reaped + 1;
    end if;
  end loop;
  return reaped;
end;
$$;

revoke all on function private.reap_stale_google_ai_provider_dispatches_v1(
  integer
) from public, anon, authenticated, service_role;

create function public.reap_stale_google_ai_provider_dispatches_v1(
  job_limit integer default 10
)
returns integer
language sql
volatile
security definer
set search_path = ''
as $$
  select private.reap_stale_google_ai_provider_dispatches_v1(job_limit);
$$;

revoke all on function public.reap_stale_google_ai_provider_dispatches_v1(
  integer
) from public, anon, authenticated;
grant execute on function public.reap_stale_google_ai_provider_dispatches_v1(
  integer
) to service_role;

create function private.claim_google_ai_provider_dispatch_v1(
  target_token_hash text,
  target_auth_user_id uuid,
  target_supabase_auth_session_id uuid,
  target_google_issuer text,
  target_provider_subject_hmac text,
  target_subject_pepper_version integer,
  target_start_request_id uuid,
  target_operation_id uuid,
  target_provider_family text,
  target_client_request_id uuid,
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
  evidence jsonb;
  context_value jsonb;
  start_intent private.admin_google_ai_provider_start_intents%rowtype;
  existing_receipt private.admin_google_ai_provider_dispatch_receipts%rowtype;
  identity_gate private.admin_identity_runtime_gate%rowtype;
  ai_gate private.admin_ai_unlock_runtime_gate%rowtype;
  ownership_row private.admin_lecture_ownerships%rowtype;
  policy_row private.admin_ai_policies%rowtype;
  lecture_row public.lecture_sessions%rowtype;
  master_row public.lecture_ai_master_authorizations%rowtype;
  control_row public.lecture_ai_control%rowtype;
  usage_row public.ai_usage_ledger%rowtype;
  receipt_row private.admin_google_ai_provider_dispatch_receipts%rowtype;
  stale_result jsonb;
  effective_now timestamptz := statement_timestamp();
begin
  if target_provider_family is null
     or target_provider_family not in (
       'openai_responses_v1',
       'openai_realtime_v1'
     )
     or target_client_request_id is null then
    return null;
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

  select intent.*
  into start_intent
  from private.admin_google_ai_provider_start_intents as intent
  where intent.start_request_id = target_start_request_id;
  if not found
     or start_intent.provider_family is distinct from target_provider_family
     or start_intent.lecture_session_id is distinct from
       (evidence ->> 'lecture_session_id')::uuid
     or start_intent.admin_session_id is distinct from
       (evidence ->> 'admin_session_id')::uuid then
    return null;
  end if;

  -- An exact replay is deliberately evaluated before live authority. Once a
  -- claim exists, returning dispatchAllowed=false is the only safe answer,
  -- even if the session or feature was disabled after the provider call may
  -- have started.
  select receipt.*
  into existing_receipt
  from private.admin_google_ai_provider_dispatch_receipts as receipt
  where receipt.start_request_id = target_start_request_id;
  if found then
    if existing_receipt.operation_id is distinct from target_operation_id
       or existing_receipt.provider_family is distinct from
         target_provider_family
       or existing_receipt.client_request_id is distinct from
         target_client_request_id then
      raise exception 'Google AI provider dispatch binding changed on retry'
        using errcode = 'P7335';
    end if;
    if existing_receipt.lease_expires_at <= effective_now then
      stale_result := private.settle_stale_google_ai_provider_dispatch_v1(
        target_start_request_id
      );
    end if;
    return jsonb_build_object(
      'accepted', true,
      'clientRequestId', existing_receipt.client_request_id,
      'dispatchAllowed', false,
      'idempotentReplay', true,
      'leaseExpiresAt', existing_receipt.lease_expires_at,
      'staleRecovered', coalesce(
        (stale_result ->> 'staleRecovered')::boolean,
        false
      ),
      'operationId', existing_receipt.operation_id
    );
  end if;

  context_value := private.require_google_ai_provider_context_v1(
    target_token_hash,
    target_auth_user_id,
    target_supabase_auth_session_id,
    target_google_issuer,
    target_provider_subject_hmac,
    target_subject_pepper_version
  );
  if context_value is null
     or (context_value ->> 'environment_id')::uuid is distinct from
       (evidence ->> 'environment_id')::uuid
     or (context_value ->> 'principal_id')::uuid is distinct from
       (evidence ->> 'principal_id')::uuid
     or (context_value ->> 'membership_id')::uuid is distinct from
       (evidence ->> 'membership_id')::uuid
     or (context_value ->> 'admin_session_id')::uuid is distinct from
       (evidence ->> 'admin_session_id')::uuid
     or (context_value ->> 'supabase_auth_session_id')::uuid is distinct from
       (evidence ->> 'supabase_auth_session_id')::uuid then
    return null;
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
    raise exception 'Google AI provider dispatch is disabled'
      using errcode = 'P7338';
  end if;

  select ownership.*
  into ownership_row
  from private.admin_lecture_ownerships as ownership
  where ownership.lecture_session_id =
    (evidence ->> 'lecture_session_id')::uuid;
  if not found
     or ownership_row.environment_id is distinct from
       (evidence ->> 'environment_id')::uuid
     or ownership_row.principal_id is distinct from
       (evidence ->> 'principal_id')::uuid
     or ownership_row.membership_id is distinct from
       (evidence ->> 'membership_id')::uuid then
    return null;
  end if;

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
  if not found
     or policy_row.status <> 'active'
     or policy_row.valid_from > effective_now
     or policy_row.valid_until <= effective_now
     or not array[evidence ->> 'feature']::text[] <@ policy_row.allowed_actions
     or not array[evidence ->> 'model_id']::text[] <@ policy_row.allowed_models then
    return null;
  end if;

  select lecture.*
  into lecture_row
  from public.lecture_sessions as lecture
  where lecture.id = (evidence ->> 'lecture_session_id')::uuid
  for update;
  if not found
     or lecture_row.status <> 'open'
     or lecture_row.hard_stop_at is null
     or lecture_row.hard_stop_at <= effective_now then
    return null;
  end if;

  select master.*
  into master_row
  from public.lecture_ai_master_authorizations as master
  where master.id = (evidence ->> 'master_authorization_id')::uuid
    and master.lecture_session_id = (evidence ->> 'lecture_session_id')::uuid
  for update;
  if not found
     or master_row.status <> 'active'
     or master_row.expires_at <= effective_now
     or master_row.principal_id is distinct from
       (evidence ->> 'principal_id')::uuid
     or master_row.membership_id is distinct from
       (evidence ->> 'membership_id')::uuid
     or master_row.issuing_admin_session_id is distinct from
       (evidence ->> 'admin_session_id')::uuid
     or master_row.actor_id is distinct from (evidence ->> 'actor_id')
     or master_row.ai_policy_id is distinct from
       (evidence ->> 'policy_id')::uuid
     or master_row.ai_policy_version is distinct from
       (evidence ->> 'policy_version')::bigint
     or not array[evidence ->> 'feature']::text[] <@ master_row.actions then
    return null;
  end if;

  -- Realtime disable/stop is lecture -> control -> usage. Lock and validate
  -- the caption control before the usage reservation so a disabled feature
  -- cannot cross the provider-dispatch boundary and no inverse lock edge is
  -- introduced against terminal controls.
  if (evidence ->> 'feature') = 'captions' then
    select control.*
    into control_row
    from public.lecture_ai_control as control
    where control.lecture_session_id = lecture_row.id
    for update;
    if not found
       or control_row.status not in ('ready', 'running')
       or not control_row.captions_enabled
       or control_row.stop_requested_at is not null then
      raise exception 'Google Realtime provider dispatch is disabled'
        using errcode = 'P7338';
    end if;
  end if;

  select usage.*
  into usage_row
  from public.ai_usage_ledger as usage
  where usage.id = target_operation_id
  for update;
  if not found
     or usage_row.lecture_session_id is distinct from lecture_row.id
     or usage_row.feature is distinct from (evidence ->> 'feature')
     or usage_row.requested_by_actor is distinct from (evidence ->> 'actor_id')
     or usage_row.status is distinct from 'running'
     or usage_row.provider_dispatched_at is not null
     or usage_row.provider_request_id is not null then
    return null;
  end if;

  update public.ai_usage_ledger as usage
  set
    provider_dispatched_at = effective_now,
    provider_request_id = target_client_request_id::text
  where usage.id = usage_row.id;

  insert into private.admin_google_ai_provider_dispatch_receipts (
    start_request_id,
    operation_id,
    provider_family,
    client_request_id,
    claimed_at,
    lease_expires_at
  ) values (
    target_start_request_id,
    target_operation_id,
    target_provider_family,
    target_client_request_id,
    effective_now,
    effective_now + interval '90 seconds'
  )
  returning * into receipt_row;

  return jsonb_build_object(
    'accepted', true,
    'clientRequestId', receipt_row.client_request_id,
    'dispatchAllowed', true,
    'idempotentReplay', false,
    'leaseExpiresAt', receipt_row.lease_expires_at,
    'staleRecovered', false,
    'operationId', receipt_row.operation_id
  );
end;
$$;

revoke all on function private.claim_google_ai_provider_dispatch_v1(
  text, uuid, uuid, text, text, integer, uuid, uuid, text, uuid, boolean
) from public, anon, authenticated, service_role;

create function public.claim_google_ai_provider_dispatch_v1(
  target_token_hash text,
  target_auth_user_id uuid,
  target_supabase_auth_session_id uuid,
  target_google_issuer text,
  target_provider_subject_hmac text,
  target_subject_pepper_version integer,
  target_start_request_id uuid,
  target_operation_id uuid,
  target_provider_family text,
  target_client_request_id uuid,
  target_transport_enabled boolean
)
returns jsonb
language sql
volatile
security definer
set search_path = ''
as $$
  select private.claim_google_ai_provider_dispatch_v1(
    target_token_hash,
    target_auth_user_id,
    target_supabase_auth_session_id,
    target_google_issuer,
    target_provider_subject_hmac,
    target_subject_pepper_version,
    target_start_request_id,
    target_operation_id,
    target_provider_family,
    target_client_request_id,
    target_transport_enabled
  );
$$;

revoke all on function public.claim_google_ai_provider_dispatch_v1(
  text, uuid, uuid, text, text, integer, uuid, uuid, text, uuid, boolean
) from public, anon, authenticated;
grant execute on function public.claim_google_ai_provider_dispatch_v1(
  text, uuid, uuid, text, text, integer, uuid, uuid, text, uuid, boolean
) to service_role;
