-- Final lecture UX: durable, provider-free pre-lecture AI activation intent.
--
-- The intent is server-authoritative but deliberately does not authorize an AI
-- master, issue a child grant, or call a provider. The existing Google/TOTP
-- AAL2 master-admission path remains the only activation path after a lecture
-- opens. This migration only records, reads and consumes the owned lecture's
-- preparation intent through the canonical Google Admin operation context.

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
  request_binding_required
) values
  (
    'manage-ai-activation-intent.status',
    'manage-ai-activation-intent',
    'status',
    'owned_lecture',
    'draft_or_open',
    'gate_independent',
    'read',
    'share',
    false,
    false,
    false
  ),
  (
    'manage-ai-activation-intent.arm',
    'manage-ai-activation-intent',
    'arm',
    'owned_lecture',
    'draft',
    'required',
    'write',
    'update',
    true,
    true,
    true
  ),
  (
    'manage-ai-activation-intent.cancel',
    'manage-ai-activation-intent',
    'cancel',
    'owned_lecture',
    'draft_or_open',
    'gate_independent',
    'free_control',
    'update',
    false,
    false,
    true
  ),
  (
    'manage-ai-activation-intent.consume',
    'manage-ai-activation-intent',
    'consume',
    'owned_lecture',
    'draft_or_open',
    'gate_independent',
    'free_control',
    'update',
    false,
    false,
    true
  );

create table private.admin_ai_activation_intents (
  lecture_session_id uuid primary key
    references public.lecture_sessions(id) on delete cascade,
  environment_id uuid not null
    references private.admin_environments(id) on delete restrict,
  principal_id uuid not null
    references private.admin_principals(id) on delete restrict,
  membership_id uuid not null
    references private.admin_environment_memberships(id) on delete restrict,
  admin_session_id uuid not null
    references public.admin_sessions(id) on delete restrict,
  state text not null check (state in ('armed', 'cancelled', 'consumed')),
  armed_at timestamptz,
  activation_expires_at timestamptz,
  cancelled_at timestamptz,
  cancel_reason text check (
    cancel_reason is null or char_length(cancel_reason) between 1 and 120
  ),
  consumed_at timestamptz,
  consumed_master_authorization_id uuid
    references public.lecture_ai_master_authorizations(id) on delete restrict,
  consumed_master_version bigint check (
    consumed_master_version is null or consumed_master_version >= 1
  ),
  version bigint not null default 1 check (version >= 1),
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  check (
    (
      state = 'armed'
      and armed_at is not null
      and cancelled_at is null
      and cancel_reason is null
      and consumed_at is null
      and consumed_master_authorization_id is null
      and consumed_master_version is null
    )
    or (
      state = 'cancelled'
      and armed_at is not null
      and cancelled_at is not null
      and cancel_reason is not null
      and consumed_at is null
      and consumed_master_authorization_id is null
      and consumed_master_version is null
    )
    or (
      state = 'consumed'
      and armed_at is not null
      and cancelled_at is null
      and cancel_reason is null
      and consumed_at is not null
      and consumed_master_authorization_id is not null
      and consumed_master_version is not null
    )
  ),
  check (
    activation_expires_at is null
    or activation_expires_at > armed_at
  )
);

comment on table private.admin_ai_activation_intents is
  'Provider-free, server-authoritative preparation intent for an owned draft lecture. Opening creates a bounded activation handoff; it stores no PIN, TOTP, token, prompt, content or provider payload.';

create index admin_ai_activation_intents_environment_idx
  on private.admin_ai_activation_intents (environment_id, updated_at desc);
create index admin_ai_activation_intents_principal_idx
  on private.admin_ai_activation_intents (principal_id, updated_at desc);
create index admin_ai_activation_intents_membership_idx
  on private.admin_ai_activation_intents (membership_id, updated_at desc);
create index admin_ai_activation_intents_admin_session_idx
  on private.admin_ai_activation_intents (admin_session_id, updated_at desc);
create index admin_ai_activation_intents_master_idx
  on private.admin_ai_activation_intents (consumed_master_authorization_id)
  where consumed_master_authorization_id is not null;

alter table private.admin_ai_activation_intents enable row level security;
revoke all on private.admin_ai_activation_intents
  from public, anon, authenticated, service_role;

create function private.admin_ai_activation_intent_json_v1(
  target_intent private.admin_ai_activation_intents,
  target_server_time timestamptz
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'activation_expires_at', target_intent.activation_expires_at,
    'armed', coalesce(target_intent.state = 'armed', false),
    'armed_at', target_intent.armed_at,
    'cancel_reason', target_intent.cancel_reason,
    'consumed_at', target_intent.consumed_at,
    'server_time', target_server_time,
    'state', coalesce(target_intent.state, 'none'),
    'version', coalesce(target_intent.version, 0)
  );
$$;

revoke all on function private.admin_ai_activation_intent_json_v1(
  private.admin_ai_activation_intents,
  timestamptz
) from public, anon, authenticated, service_role;

create function private.manage_google_admin_ai_activation_intent_v1(
  target_token_hash text,
  target_auth_user_id uuid,
  target_supabase_auth_session_id uuid,
  target_google_issuer text,
  target_provider_subject_hmac text,
  target_subject_pepper_version integer,
  target_transport_enabled boolean,
  target_action text,
  target_request_id uuid,
  target_lecture_session_id uuid,
  target_enabled boolean
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
  operation_key_value text := case
    when target_action = 'set' and target_enabled is true
      then 'manage-ai-activation-intent.arm'
    when target_action = 'set' and target_enabled is false
      then 'manage-ai-activation-intent.cancel'
    else 'manage-ai-activation-intent.' || coalesce(target_action, '')
  end;
  arm_prelude_context jsonb;
  context_value jsonb;
  receipt_row private.admin_google_operation_receipts%rowtype;
  intent_row private.admin_ai_activation_intents%rowtype;
  master_row public.lecture_ai_master_authorizations%rowtype;
  identity_gate private.admin_identity_runtime_gate%rowtype;
  ai_gate private.admin_ai_unlock_runtime_gate%rowtype;
  intent_digest_value text;
  target_marker text;
  result_value jsonb;
  effective_now timestamptz := statement_timestamp();
begin
  if target_lecture_session_id is null
     or target_action not in ('status', 'set', 'consume')
     or (
       target_action = 'status'
       and (target_request_id is not null or target_enabled is not null)
     )
     or (
       target_action = 'set'
       and (target_request_id is null or target_enabled is null)
     )
     or (
       target_action = 'consume'
       and (target_request_id is null or target_enabled is not null)
     ) then
    return null;
  end if;

  if target_request_id is not null then
    perform private.serialize_admin_ai_request_v1(target_request_id);
  end if;

  -- Arm/re-arm is state-expanding AI work. Establish the canonical
  -- P -> M -> E -> Admin/Auth -> identity gate -> AI gate prelude before the
  -- owned lecture lock taken by the operation context below. The shared AI
  -- gate lock serializes arm with its disable drain without a gate/lecture
  -- inversion: arm either commits first and is drained, or observes gate OFF.
  if target_action = 'set' and target_enabled then
    arm_prelude_context := private.require_google_ai_provider_context_v1(
      target_token_hash,
      target_auth_user_id,
      target_supabase_auth_session_id,
      target_google_issuer,
      target_provider_subject_hmac,
      target_subject_pepper_version
    );
    if arm_prelude_context is null then
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
  end if;

  context_value := private.require_google_admin_operation_context_v1(
    target_token_hash,
    target_auth_user_id,
    target_supabase_auth_session_id,
    target_google_issuer,
    target_provider_subject_hmac,
    target_subject_pepper_version,
    operation_key_value,
    target_lecture_session_id
  );
  if context_value is null then
    return null;
  end if;

  perform private.assert_google_admin_operation_lecture_state_v1(context_value);

  if target_action = 'status' then
    select intent.*
    into intent_row
    from private.admin_ai_activation_intents as intent
    where intent.lecture_session_id = target_lecture_session_id;

    if found and (
      intent_row.environment_id <>
        (context_value ->> 'environment_id')::uuid
      or intent_row.principal_id <>
        (context_value ->> 'principal_id')::uuid
      or intent_row.membership_id <>
        (context_value ->> 'membership_id')::uuid
      or intent_row.admin_session_id <>
        (context_value ->> 'admin_session_id')::uuid
    ) then
      raise exception 'AI activation intent ownership is invalid'
        using errcode = 'P7335';
    end if;

    return private.admin_ai_activation_intent_json_v1(
      intent_row,
      effective_now
    ) || jsonb_build_object('idempotent_replay', false, 'ok', true);
  end if;

  target_marker := case
    when target_action = 'set' and target_enabled then 'enabled=true'
    when target_action = 'set' then 'enabled=false'
    else 'consume'
  end;
  intent_digest_value := private.google_admin_operation_intent_digest_v1(
    target_request_id,
    (context_value ->> 'admin_session_id')::uuid,
    operation_key_value,
    target_lecture_session_id,
    target_marker,
    null
  );
  if intent_digest_value is null then
    return null;
  end if;

  select receipt.*
  into receipt_row
  from private.admin_google_operation_receipts as receipt
  where receipt.request_id = target_request_id;

  if found then
    if receipt_row.operation_key = operation_key_value
       and receipt_row.intent_digest = intent_digest_value
       and receipt_row.environment_id =
         (context_value ->> 'environment_id')::uuid
       and receipt_row.principal_id =
         (context_value ->> 'principal_id')::uuid
       and receipt_row.membership_id =
         (context_value ->> 'membership_id')::uuid
       and receipt_row.admin_session_id =
         (context_value ->> 'admin_session_id')::uuid
       and receipt_row.supabase_auth_session_id =
         target_supabase_auth_session_id
       and receipt_row.lecture_session_id = target_lecture_session_id
       and receipt_row.target_id = target_marker
       and receipt_row.result_id = target_lecture_session_id::text then
      return receipt_row.result_metadata || jsonb_build_object(
        'idempotent_replay', true,
        'ok', true,
        'server_time', receipt_row.created_at
      );
    end if;
    raise exception 'AI activation intent request binding does not match its receipt'
      using errcode = 'P7335';
  end if;

  perform private.assert_google_admin_operation_gate_v1(
    context_value,
    target_transport_enabled
  );

  if target_action = 'set' and target_enabled then
    if identity_gate.singleton is distinct from true
       or ai_gate.singleton is distinct from true
       or ai_gate.ai_unlock_enabled is distinct from true
       or ai_gate.google_ai_master_admission_enabled is distinct from true then
      raise exception 'Google AI master admission is disabled'
        using errcode = 'P7336';
    end if;
  end if;

  -- Consumption follows the canonical lecture -> master -> intent order. This
  -- is also the order used by the atomic automatic-admission wrapper below and
  -- by terminal master drains.
  if target_action = 'consume' then
    if context_value ->> 'lecture_status' <> 'open' then
      raise exception 'AI activation intent requires an open lecture before consumption'
        using errcode = 'P7335';
    end if;

    select master.*
    into master_row
    from public.lecture_ai_master_authorizations as master
    where master.lecture_session_id = target_lecture_session_id
      and master.status = 'active'
      and master.expires_at > effective_now
      and master.principal_id = (context_value ->> 'principal_id')::uuid
      and master.membership_id = (context_value ->> 'membership_id')::uuid
      and master.issuing_admin_session_id =
        (context_value ->> 'admin_session_id')::uuid
      and master.admin_session_id =
        (context_value ->> 'admin_session_id')::uuid
      and master.actor_id =
        'admin-session:' || (context_value ->> 'admin_session_id')
    for update;

    if not found then
      raise exception 'active Google AI master is required before intent consumption'
        using errcode = 'P7335';
    end if;
  end if;

  select intent.*
  into intent_row
  from private.admin_ai_activation_intents as intent
  where intent.lecture_session_id = target_lecture_session_id
  for update;

  if found and (
    intent_row.environment_id <>
      (context_value ->> 'environment_id')::uuid
    or intent_row.principal_id <>
      (context_value ->> 'principal_id')::uuid
    or intent_row.membership_id <>
      (context_value ->> 'membership_id')::uuid
    or intent_row.admin_session_id <>
      (context_value ->> 'admin_session_id')::uuid
  ) then
    raise exception 'AI activation intent ownership is invalid'
      using errcode = 'P7335';
  end if;

  if target_action = 'set' then
    if target_enabled and intent_row.lecture_session_id is null then
      insert into private.admin_ai_activation_intents (
        lecture_session_id,
        environment_id,
        principal_id,
        membership_id,
        admin_session_id,
        state,
        armed_at
      ) values (
        target_lecture_session_id,
        (context_value ->> 'environment_id')::uuid,
        (context_value ->> 'principal_id')::uuid,
        (context_value ->> 'membership_id')::uuid,
        (context_value ->> 'admin_session_id')::uuid,
        'armed',
        effective_now
      ) returning * into intent_row;
    elsif target_enabled and intent_row.state = 'cancelled' then
      update private.admin_ai_activation_intents as intent
      set
        state = 'armed',
        armed_at = effective_now,
        activation_expires_at = null,
        cancelled_at = null,
        cancel_reason = null,
        updated_at = effective_now,
        version = intent.version + 1
      where intent.lecture_session_id = target_lecture_session_id
      returning * into intent_row;
    elsif not target_enabled and intent_row.state = 'armed' then
      update private.admin_ai_activation_intents as intent
      set
        state = 'cancelled',
        cancelled_at = effective_now,
        cancel_reason = 'admin_cancelled',
        updated_at = effective_now,
        version = intent.version + 1
      where intent.lecture_session_id = target_lecture_session_id
      returning * into intent_row;
    end if;
  elsif intent_row.lecture_session_id is not null
        and intent_row.state = 'armed' then
    if intent_row.activation_expires_at is null
       or intent_row.activation_expires_at <= effective_now then
      raise exception 'AI activation handoff has expired'
        using errcode = 'P7335';
    end if;

    update private.admin_ai_activation_intents as intent
    set
      state = 'consumed',
      cancelled_at = null,
      cancel_reason = null,
      consumed_at = effective_now,
      consumed_master_authorization_id = master_row.id,
      consumed_master_version = master_row.version,
      updated_at = effective_now,
      version = intent.version + 1
    where intent.lecture_session_id = target_lecture_session_id
    returning * into intent_row;
  end if;

  result_value := private.admin_ai_activation_intent_json_v1(
    intent_row,
    effective_now
  );

  insert into private.admin_google_operation_receipts (
    request_id,
    operation_key,
    intent_digest,
    environment_id,
    principal_id,
    membership_id,
    admin_session_id,
    supabase_auth_session_id,
    lecture_session_id,
    target_id,
    result_id,
    result_status,
    result_metadata
  ) values (
    target_request_id,
    operation_key_value,
    intent_digest_value,
    (context_value ->> 'environment_id')::uuid,
    (context_value ->> 'principal_id')::uuid,
    (context_value ->> 'membership_id')::uuid,
    (context_value ->> 'admin_session_id')::uuid,
    target_supabase_auth_session_id,
    target_lecture_session_id,
    target_marker,
    target_lecture_session_id::text,
    result_value ->> 'state',
    result_value - 'server_time'
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
    (context_value ->> 'environment_id')::uuid,
    (context_value ->> 'principal_id')::uuid,
    (context_value ->> 'membership_id')::uuid,
    (context_value ->> 'admin_session_id')::uuid,
    'admin_ai_activation_intent.' || target_action,
    'lecture_session',
    target_lecture_session_id::text,
    'accepted',
    'google_admin_operation',
    jsonb_build_object(
      'armed', result_value -> 'armed',
      'operation_key', operation_key_value,
      'state', result_value ->> 'state',
      'version', (result_value ->> 'version')::bigint
    )
  );

  return result_value || jsonb_build_object(
    'idempotent_replay', false,
    'ok', true
  );
end;
$$;

revoke all on function private.manage_google_admin_ai_activation_intent_v1(
  text, uuid, uuid, text, text, integer, boolean, text, uuid, uuid, boolean
) from public, anon, authenticated, service_role;

create function public.manage_google_admin_ai_activation_intent_v1(
  target_token_hash text,
  target_auth_user_id uuid,
  target_supabase_auth_session_id uuid,
  target_google_issuer text,
  target_provider_subject_hmac text,
  target_subject_pepper_version integer,
  target_transport_enabled boolean,
  target_action text,
  target_request_id uuid,
  target_lecture_session_id uuid,
  target_enabled boolean
)
returns jsonb
language sql
volatile
security definer
set search_path = ''
as $$
  select private.manage_google_admin_ai_activation_intent_v1(
    target_token_hash,
    target_auth_user_id,
    target_supabase_auth_session_id,
    target_google_issuer,
    target_provider_subject_hmac,
    target_subject_pepper_version,
    target_transport_enabled,
    target_action,
    target_request_id,
    target_lecture_session_id,
    target_enabled
  );
$$;

revoke all on function public.manage_google_admin_ai_activation_intent_v1(
  text, uuid, uuid, text, text, integer, boolean, text, uuid, uuid, boolean
) from public, anon, authenticated;
grant execute on function public.manage_google_admin_ai_activation_intent_v1(
  text, uuid, uuid, text, text, integer, boolean, text, uuid, uuid, boolean
) to service_role;

comment on function public.manage_google_admin_ai_activation_intent_v1(
  text, uuid, uuid, text, text, integer, boolean, text, uuid, uuid, boolean
) is
  'Service-role-only Google Admin facade for idempotent status/set/consume of the provider-free lecture AI activation intent.';

-- Automatic activation is a single transaction. Canonical Google AI master
-- admission locks identity/policy/lecture/master first; only then may the
-- exact bounded intent be locked and consumed. A cancellation that wins the
-- lecture/intent race therefore makes the admission statement roll back.
create function private.authorize_google_ai_master_from_activation_intent_v1(
  target_token_hash text,
  target_auth_user_id uuid,
  target_supabase_auth_session_id uuid,
  target_lecture_session_id uuid,
  target_scope text,
  target_policy_id uuid,
  target_policy_version bigint,
  target_request_id uuid,
  target_intent_version bigint
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
  admission_value jsonb;
  authorization_id uuid;
  authorization_version bigint;
  master_row public.lecture_ai_master_authorizations%rowtype;
  intent_row private.admin_ai_activation_intents%rowtype;
  effective_now timestamptz := statement_timestamp();
begin
  if target_intent_version is null or target_intent_version < 1 then
    raise exception 'invalid AI activation intent version'
      using errcode = '22023';
  end if;

  admission_value := private.authorize_google_ai_master_with_session_v1(
    target_token_hash,
    target_auth_user_id,
    target_supabase_auth_session_id,
    target_lecture_session_id,
    target_scope,
    target_policy_id,
    target_policy_version,
    target_request_id
  );

  if admission_value is null
     or coalesce((admission_value ->> 'accepted')::boolean, false) is false then
    return admission_value;
  end if;

  authorization_id :=
    (admission_value #>> '{authorization,id}')::uuid;
  authorization_version :=
    (admission_value #>> '{authorization,version}')::bigint;
  if authorization_id is null or authorization_version is null then
    raise exception 'Google AI master admission result is invalid'
      using errcode = 'P7335';
  end if;

  -- Preserve canonical serialization: the returned master is locked before
  -- the intent, including exact-replay/reuse paths that may not have retained
  -- the admission apply lock.
  select master.*
  into master_row
  from public.lecture_ai_master_authorizations as master
  where master.id = authorization_id
    and master.lecture_session_id = target_lecture_session_id
  for update;

  if not found or master_row.version <> authorization_version then
    raise exception 'Google AI master admission result is stale'
      using errcode = 'P7335';
  end if;

  select intent.*
  into intent_row
  from private.admin_ai_activation_intents as intent
  where intent.lecture_session_id = target_lecture_session_id
  for update;

  if not found
     or intent_row.principal_id is distinct from master_row.principal_id
     or intent_row.membership_id is distinct from master_row.membership_id
     or intent_row.admin_session_id is distinct from
       master_row.issuing_admin_session_id
     or intent_row.admin_session_id is distinct from master_row.admin_session_id
     or master_row.actor_id <>
       'admin-session:' || intent_row.admin_session_id::text then
    raise exception 'AI activation intent ownership is invalid'
      using errcode = 'P7335';
  end if;

  if intent_row.state = 'consumed' then
    if intent_row.consumed_master_authorization_id <> master_row.id then
      raise exception 'AI activation intent was consumed by another master'
        using errcode = 'P7335';
    end if;

    return admission_value || jsonb_build_object(
      'activation_intent_consumed', true,
      'activation_intent_replayed', true,
      'activation_intent_version', intent_row.version
    );
  end if;

  if intent_row.state <> 'armed'
     or intent_row.version <> target_intent_version
     or intent_row.activation_expires_at is null
     or intent_row.activation_expires_at <= effective_now
     or master_row.status <> 'active'
     or master_row.expires_at <= effective_now then
    raise exception 'AI activation intent is cancelled, stale or expired'
      using errcode = 'P7335';
  end if;

  update private.admin_ai_activation_intents as intent
  set
    state = 'consumed',
    cancelled_at = null,
    cancel_reason = null,
    consumed_at = effective_now,
    consumed_master_authorization_id = master_row.id,
    consumed_master_version = master_row.version,
    updated_at = effective_now,
    version = intent.version + 1
  where intent.lecture_session_id = target_lecture_session_id
    and intent.state = 'armed'
    and intent.version = target_intent_version
  returning * into intent_row;

  if not found then
    raise exception 'AI activation intent changed during admission'
      using errcode = 'P7335';
  end if;

  return admission_value || jsonb_build_object(
    'activation_intent_consumed', true,
    'activation_intent_replayed', false,
    'activation_intent_version', intent_row.version
  );
end;
$$;

revoke all on function
  private.authorize_google_ai_master_from_activation_intent_v1(
    text, uuid, uuid, uuid, text, uuid, bigint, uuid, bigint
  ) from public, anon, authenticated, service_role;

create function public.authorize_google_ai_master_from_activation_intent_v1(
  target_token_hash text,
  target_auth_user_id uuid,
  target_supabase_auth_session_id uuid,
  target_lecture_session_id uuid,
  target_scope text,
  target_policy_id uuid,
  target_policy_version bigint,
  target_request_id uuid,
  target_intent_version bigint
)
returns jsonb
language sql
volatile
security definer
set search_path = ''
as $$
  select private.authorize_google_ai_master_from_activation_intent_v1(
    target_token_hash,
    target_auth_user_id,
    target_supabase_auth_session_id,
    target_lecture_session_id,
    target_scope,
    target_policy_id,
    target_policy_version,
    target_request_id,
    target_intent_version
  );
$$;

revoke all on function
  public.authorize_google_ai_master_from_activation_intent_v1(
    text, uuid, uuid, uuid, text, uuid, bigint, uuid, bigint
  ) from public, anon, authenticated;
grant execute on function
  public.authorize_google_ai_master_from_activation_intent_v1(
    text, uuid, uuid, uuid, text, uuid, bigint, uuid, bigint
  ) to service_role;

comment on function
  public.authorize_google_ai_master_from_activation_intent_v1(
    text, uuid, uuid, uuid, text, uuid, bigint, uuid, bigint
  ) is
  'Atomically admits an automatic Google AAL2 AI master and consumes the exact bounded, same-session activation intent. Manual admission remains on authorize_google_ai_master_with_session_v1.';

create function private.cancel_admin_ai_activation_intents_v1(
  target_source_kind text,
  target_source_id uuid,
  target_reason text
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
  changed_count integer;
  cancelled_count integer := 0;
  effective_now timestamptz := statement_timestamp();
begin
  if target_source_kind not in (
       'all',
       'lecture',
       'environment',
       'principal',
       'membership',
       'admin_session'
     )
     or (target_source_kind <> 'all' and target_source_id is null)
     or nullif(trim(target_reason), '') is null
     or char_length(target_reason) > 120 then
    raise exception 'invalid AI activation intent drain'
      using errcode = '22023';
  end if;

  -- Every drain, including global gate drains, takes intent rows in the same
  -- lecture UUID order so overlapping drain sources cannot invert row locks.
  for candidate in
    select intent.lecture_session_id
    from private.admin_ai_activation_intents as intent
    where intent.state = 'armed'
      and (
        target_source_kind = 'all'
        or (
          target_source_kind = 'lecture'
          and intent.lecture_session_id = target_source_id
        )
        or (
          target_source_kind = 'environment'
          and intent.environment_id = target_source_id
        )
        or (
          target_source_kind = 'principal'
          and intent.principal_id = target_source_id
        )
        or (
          target_source_kind = 'membership'
          and intent.membership_id = target_source_id
        )
        or (
          target_source_kind = 'admin_session'
          and intent.admin_session_id = target_source_id
        )
      )
    order by intent.lecture_session_id
  loop
    update private.admin_ai_activation_intents as intent
    set
      state = 'cancelled',
      cancelled_at = effective_now,
      cancel_reason = target_reason,
      updated_at = effective_now,
      version = intent.version + 1
    where intent.lecture_session_id = candidate.lecture_session_id
      and intent.state = 'armed';
    get diagnostics changed_count = row_count;
    cancelled_count := cancelled_count + changed_count;
  end loop;
  return cancelled_count;
end;
$$;

revoke all on function private.cancel_admin_ai_activation_intents_v1(
  text, uuid, text
) from public, anon, authenticated, service_role;

-- Draft arm becomes a short, versioned activation handoff only as the owned
-- lecture opens. Closing or hard-stopping the lecture cancels any handoff that
-- did not reach the atomic admission wrapper.
create function private.sync_admin_ai_activation_intent_lecture_v1()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  effective_now timestamptz := statement_timestamp();
begin
  if old.status = 'draft'
     and new.status = 'open'
     and new.hard_stop_at is not null
     and new.hard_stop_at > effective_now then
    update private.admin_ai_activation_intents as intent
    set
      activation_expires_at = least(
        new.hard_stop_at,
        effective_now + interval '5 minutes'
      ),
      updated_at = effective_now,
      version = intent.version + 1
    where intent.lecture_session_id = new.id
      and intent.state = 'armed';
  elsif old.status = 'open'
        and (
          new.status <> 'open'
          or new.hard_stop_at is null
          or new.hard_stop_at <= effective_now
        ) then
    perform private.cancel_admin_ai_activation_intents_v1(
      'lecture',
      new.id,
      case
        when new.hard_stop_at is null or new.hard_stop_at <= effective_now
          then 'lecture_hard_stop'
        else 'lecture_closed'
      end
    );
  end if;
  return new;
end;
$$;

revoke all on function private.sync_admin_ai_activation_intent_lecture_v1()
  from public, anon, authenticated, service_role;
create trigger zz_admin_ai_activation_intent_lecture_handoff
after update of status, hard_stop_at on public.lecture_sessions
for each row execute function
  private.sync_admin_ai_activation_intent_lecture_v1();

create function private.drain_admin_ai_activation_intent_on_master_v1()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if old.status = 'active'
     and (
       new.status <> 'active'
       or new.expires_at <= statement_timestamp()
     ) then
    perform private.cancel_admin_ai_activation_intents_v1(
      'lecture',
      new.lecture_session_id,
      'ai_master_terminal'
    );
  end if;
  return new;
end;
$$;

revoke all on function private.drain_admin_ai_activation_intent_on_master_v1()
  from public, anon, authenticated, service_role;
create trigger zz_admin_ai_activation_intent_master_terminal
after update of status, expires_at on public.lecture_ai_master_authorizations
for each row execute function
  private.drain_admin_ai_activation_intent_on_master_v1();

create function private.drain_admin_ai_activation_intent_on_session_v1()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if old.revoked_at is null and new.revoked_at is not null then
    perform private.cancel_admin_ai_activation_intents_v1(
      'admin_session',
      new.id,
      'admin_session_revoked'
    );
  end if;
  return new;
end;
$$;

revoke all on function private.drain_admin_ai_activation_intent_on_session_v1()
  from public, anon, authenticated, service_role;
create trigger zz_admin_ai_activation_intent_session_revoke
after update of revoked_at on public.admin_sessions
for each row execute function
  private.drain_admin_ai_activation_intent_on_session_v1();

create function private.drain_admin_ai_activation_intent_on_membership_v1()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if old.status = 'active'
     and old.can_use_ai
     and (
       new.status <> 'active'
       or not new.can_use_ai
       or (
         new.expires_at is not null
         and new.expires_at <= statement_timestamp()
       )
     ) then
    perform private.cancel_admin_ai_activation_intents_v1(
      'membership',
      new.id,
      'membership_ai_access_changed'
    );
  end if;
  return new;
end;
$$;

revoke all on function
  private.drain_admin_ai_activation_intent_on_membership_v1()
  from public, anon, authenticated, service_role;
create trigger zz_admin_ai_activation_intent_membership_drain
after update of status, can_use_ai, expires_at
on private.admin_environment_memberships
for each row execute function
  private.drain_admin_ai_activation_intent_on_membership_v1();

create function private.drain_admin_ai_activation_intent_on_principal_v1()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if old.status = 'active' and new.status <> 'active' then
    perform private.cancel_admin_ai_activation_intents_v1(
      'principal',
      new.id,
      'principal_access_changed'
    );
  end if;
  return new;
end;
$$;

revoke all on function
  private.drain_admin_ai_activation_intent_on_principal_v1()
  from public, anon, authenticated, service_role;
create trigger zz_admin_ai_activation_intent_principal_drain
after update of status on private.admin_principals
for each row execute function
  private.drain_admin_ai_activation_intent_on_principal_v1();

create function private.drain_admin_ai_activation_intent_on_environment_v1()
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
    perform private.cancel_admin_ai_activation_intents_v1(
      'environment',
      new.id,
      'environment_access_changed'
    );
  end if;
  return new;
end;
$$;

revoke all on function
  private.drain_admin_ai_activation_intent_on_environment_v1()
  from public, anon, authenticated, service_role;
create trigger zz_admin_ai_activation_intent_environment_drain
after update of status, current_deployment on private.admin_environments
for each row execute function
  private.drain_admin_ai_activation_intent_on_environment_v1();

create function private.drain_admin_ai_activation_intent_on_identity_gate_v1()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if old.google_operational_authorization_enabled
     and not new.google_operational_authorization_enabled then
    perform private.cancel_admin_ai_activation_intents_v1(
      'all',
      null,
      'google_operational_authorization_disabled'
    );
  end if;
  return new;
end;
$$;

revoke all on function
  private.drain_admin_ai_activation_intent_on_identity_gate_v1()
  from public, anon, authenticated, service_role;
create trigger zz_admin_ai_activation_intent_identity_gate_drain
after update of google_operational_authorization_enabled
on private.admin_identity_runtime_gate
for each row execute function
  private.drain_admin_ai_activation_intent_on_identity_gate_v1();

create function private.drain_admin_ai_activation_intent_on_ai_gate_v1()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if old.ai_unlock_enabled
     and old.google_ai_master_admission_enabled
     and (
       not new.ai_unlock_enabled
       or not new.google_ai_master_admission_enabled
     ) then
    perform private.cancel_admin_ai_activation_intents_v1(
      'all',
      null,
      'ai_master_admission_disabled'
    );
  end if;
  return new;
end;
$$;

revoke all on function private.drain_admin_ai_activation_intent_on_ai_gate_v1()
  from public, anon, authenticated, service_role;
create trigger zz_admin_ai_activation_intent_ai_gate_drain
after update of ai_unlock_enabled, google_ai_master_admission_enabled
on private.admin_ai_unlock_runtime_gate
for each row execute function
  private.drain_admin_ai_activation_intent_on_ai_gate_v1();
