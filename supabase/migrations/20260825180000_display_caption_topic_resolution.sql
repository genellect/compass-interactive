-- Resolve the private Display caption topic from the active server binding.
-- Admin reloads therefore do not depend on the launch tab's in-memory topic.

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
) values (
  'broadcast-display-caption.publish',
  'broadcast-display-caption',
  'publish',
  'owned_lecture',
  'open',
  'required',
  'provider_continuation',
  'update',
  true,
  true,
  false
);

create function private.claim_google_admin_display_caption_relay_v1(
  target_token_hash text,
  target_auth_user_id uuid,
  target_supabase_auth_session_id uuid,
  target_google_issuer text,
  target_provider_subject_hmac text,
  target_subject_pepper_version integer,
  target_transport_enabled boolean,
  target_lecture_session_id uuid,
  target_start_request_id uuid,
  target_operation_id uuid,
  target_stream_id uuid,
  target_sequence bigint,
  target_source text
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
  operation_key_value constant text := 'broadcast-display-caption.publish';
  operation_policy_row private.admin_google_operation_policies%rowtype;
  context_value jsonb;
  child_receipt private.admin_google_ai_child_grant_receipts%rowtype;
  start_intent private.admin_google_ai_provider_start_intents%rowtype;
  start_receipt private.admin_google_ai_provider_start_receipts%rowtype;
  dispatch_receipt private.admin_google_ai_provider_dispatch_receipts%rowtype;
  creation_receipt private.admin_google_realtime_provider_creation_receipts%rowtype;
  identity_gate private.admin_identity_runtime_gate%rowtype;
  ai_gate private.admin_ai_unlock_runtime_gate%rowtype;
  ownership_row private.admin_lecture_ownerships%rowtype;
  policy_row private.admin_ai_policies%rowtype;
  lecture_row public.lecture_sessions%rowtype;
  master_row public.lecture_ai_master_authorizations%rowtype;
  control_row public.lecture_ai_control%rowtype;
  usage_row public.ai_usage_ledger%rowtype;
  provider_call_row public.ai_realtime_provider_calls%rowtype;
  binding public.display_realtime_sessions%rowtype;
  display_root private.admin_google_display_sessions%rowtype;
  admission_status text;
  actor_value text;
  effective_now timestamptz := statement_timestamp();
begin
  if target_transport_enabled is null
     or target_lecture_session_id is null
     or target_start_request_id is null
     or target_operation_id is null
     or target_stream_id is null
     or target_sequence is null
     or target_sequence < 0
     or target_source not in ('delta', 'completed', 'stopped') then
    return jsonb_build_object('status', 'invalid');
  end if;

  -- This facade shares mutable AI rows with the canonical caption publisher.
  -- Take only the canonical P -> M -> environment -> Admin/Auth-session
  -- prelude here; the generic operation helper would lock the lecture before
  -- the AI policy and invert the publisher's policy -> lecture order.
  select operation_policy.* into operation_policy_row
  from private.admin_google_operation_policies as operation_policy
  where operation_policy.operation_key = operation_key_value;
  if not found
     or operation_policy_row.edge_function <> 'broadcast-display-caption'
     or operation_policy_row.action_name <> 'publish'
     or operation_policy_row.access_scope <> 'owned_lecture'
     or operation_policy_row.lecture_state <> 'open'
     or operation_policy_row.gate_mode <> 'required'
     or operation_policy_row.operation_class <> 'provider_continuation'
     or operation_policy_row.lecture_lock_mode <> 'update'
     or operation_policy_row.instructor_requires_ai is not true
     or operation_policy_row.owner_requires_ai is not true
     or operation_policy_row.request_binding_required is not false then
    return jsonb_build_object('status', 'unavailable');
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
     or context_value ->> 'role' not in ('owner', 'instructor') then
    return jsonb_build_object('status', 'unavailable');
  end if;
  actor_value := 'admin-session:' || (context_value ->> 'admin_session_id');

  -- The high-rate stream uses (stream_id, sequence) as its monotonic replay
  -- fence. Every relay is nevertheless bound to the exact paid provider start
  -- evidence and live master/control/usage authority before any topic resolves.
  select intent.* into start_intent
  from private.admin_google_ai_provider_start_intents as intent
  where intent.start_request_id = target_start_request_id;
  select receipt.* into start_receipt
  from private.admin_google_ai_provider_start_receipts as receipt
  where receipt.start_request_id = target_start_request_id;
  select receipt.* into child_receipt
  from private.admin_google_ai_child_grant_receipts as receipt
  where receipt.grant_id = start_intent.child_grant_id;
  select receipt.* into dispatch_receipt
  from private.admin_google_ai_provider_dispatch_receipts as receipt
  where receipt.start_request_id = target_start_request_id;
  select receipt.* into creation_receipt
  from private.admin_google_realtime_provider_creation_receipts as receipt
  where receipt.start_request_id = target_start_request_id;

  if start_intent.start_request_id is null
     or start_receipt.start_request_id is null
     or child_receipt.request_id is null
     or dispatch_receipt.start_request_id is null
     or creation_receipt.start_request_id is null
     or start_intent.feature <> 'captions'
     or start_intent.provider_family <> 'openai_realtime_v1'
     or start_intent.lecture_session_id is distinct from target_lecture_session_id
     or start_receipt.operation_id is distinct from target_operation_id
     or dispatch_receipt.operation_id is distinct from target_operation_id
     or dispatch_receipt.client_request_id is distinct from target_start_request_id
     or creation_receipt.operation_id is distinct from target_operation_id
     or creation_receipt.client_request_id is distinct from target_start_request_id
     or creation_receipt.outcome <> 'activated'
     or child_receipt.admin_session_id is distinct from
       (context_value ->> 'admin_session_id')::uuid
     or child_receipt.supabase_auth_session_id is distinct from
       target_supabase_auth_session_id
     or child_receipt.auth_user_id is distinct from target_auth_user_id then
    return jsonb_build_object('status', 'unavailable');
  end if;

  select gate.* into identity_gate
  from private.admin_identity_runtime_gate as gate
  where gate.singleton
  for share;
  select gate.* into ai_gate
  from private.admin_ai_unlock_runtime_gate as gate
  where gate.singleton
  for share;
  if not target_transport_enabled
     or not coalesce(identity_gate.google_operational_authorization_enabled, false)
     or not coalesce(ai_gate.google_ai_child_grant_enabled, false) then
    return jsonb_build_object('status', 'unavailable');
  end if;

  select ownership.* into ownership_row
  from private.admin_lecture_ownerships as ownership
  where ownership.lecture_session_id = target_lecture_session_id;
  if not found
     or ownership_row.environment_id is distinct from
       (context_value ->> 'environment_id')::uuid
     or ownership_row.principal_id is distinct from
       (context_value ->> 'principal_id')::uuid
     or ownership_row.membership_id is distinct from
       (context_value ->> 'membership_id')::uuid then
    return jsonb_build_object('status', 'unavailable');
  end if;

  -- Match publish_google_admin_caption_window_v1 exactly from here through the
  -- provider row: AI policy -> lecture -> master -> control -> usage -> call.
  perform private.serialize_admin_ai_scope_v1(
    'policy-membership', start_intent.membership_id
  );
  select policy.* into policy_row
  from private.admin_ai_policies as policy
  where policy.id = start_intent.policy_id
    and policy.version = start_intent.policy_version
  for update;
  if policy_row.id is null
     or policy_row.status <> 'active'
     or policy_row.valid_from > effective_now
     or policy_row.valid_until <= effective_now
     or not (array['captions']::text[] <@ policy_row.allowed_actions)
     or not (array[start_intent.model_id]::text[] <@ policy_row.allowed_models) then
    return jsonb_build_object('status', 'unavailable');
  end if;

  select lecture.* into lecture_row
  from public.lecture_sessions as lecture
  where lecture.id = target_lecture_session_id
  for update;
  if lecture_row.id is null
     or lecture_row.status <> 'open'
     or lecture_row.hard_stop_at is null
     or lecture_row.hard_stop_at <= effective_now then
    return jsonb_build_object('status', 'unavailable');
  end if;

  select master.* into master_row
  from public.lecture_ai_master_authorizations as master
  where master.id = start_intent.master_authorization_id
    and master.lecture_session_id = target_lecture_session_id
  for update;
  if master_row.id is null
     or master_row.status <> 'active'
     or master_row.expires_at <= effective_now
     or master_row.principal_id is distinct from start_intent.principal_id
     or master_row.membership_id is distinct from start_intent.membership_id
     or master_row.issuing_admin_session_id is distinct from
       start_intent.admin_session_id
     or master_row.actor_id is distinct from actor_value
     or master_row.ai_policy_id is distinct from start_intent.policy_id
     or master_row.ai_policy_version is distinct from start_intent.policy_version
     or master_row.scope <> 'all_including_captions'
     or not (array['captions']::text[] <@ master_row.actions) then
    return jsonb_build_object('status', 'unavailable');
  end if;

  select control.* into control_row
  from public.lecture_ai_control as control
  where control.lecture_session_id = target_lecture_session_id
  for update;
  if control_row.lecture_session_id is null
     or control_row.status not in ('ready', 'running')
     or not control_row.captions_enabled
     or control_row.stop_requested_at is not null then
    return jsonb_build_object('status', 'unavailable');
  end if;

  select usage.* into usage_row
  from public.ai_usage_ledger as usage
  where usage.id = target_operation_id
  for update;
  if usage_row.id is null
     or usage_row.lecture_session_id is distinct from target_lecture_session_id
     or usage_row.feature <> 'captions'
     or usage_row.requested_by_actor is distinct from actor_value
     or usage_row.status <> 'running'
     or usage_row.accounting_settled_at is not null
     or usage_row.provider_dispatched_at is null
     or usage_row.provider_request_id is distinct from
       dispatch_receipt.client_request_id::text then
    return jsonb_build_object('status', 'unavailable');
  end if;

  select provider_call.* into provider_call_row
  from public.ai_realtime_provider_calls as provider_call
  where provider_call.operation_id = target_operation_id
  for update;
  if provider_call_row.operation_id is null
     or provider_call_row.lecture_session_id is distinct from target_lecture_session_id
     or provider_call_row.actor_id is distinct from actor_value
     or provider_call_row.client_request_id is distinct from
       target_start_request_id::text
     or provider_call_row.provider_call_id is distinct from
       creation_receipt.provider_call_id
     or provider_call_row.status <> 'active' then
    return jsonb_build_object('status', 'unavailable');
  end if;

  -- The Display capability family locks its public Realtime projection before
  -- the matching private root, as issuance/revocation and claim verification do.
  select session.* into binding
  from private.display_realtime_runtime_gate as gate
  join public.display_realtime_sessions as session
    on gate.singleton
  join public.admin_sessions as admin_session
    on admin_session.id = session.admin_session_id
  where gate.enabled
    and session.lecture_session_id = target_lecture_session_id
    and session.admin_auth_user_id = target_auth_user_id
    and session.admin_session_id =
      (context_value ->> 'admin_session_id')::uuid
    and session.display_auth_user_id is not null
    and session.revoked_at is null
    and session.expires_at > effective_now
    and session.hard_stop_at > effective_now
    and admin_session.auth_user_id = target_auth_user_id
    and admin_session.revoked_at is null
    and admin_session.expires_at > effective_now
    and admin_session.idle_expires_at > effective_now
  for update of session;

  if not found then
    return jsonb_build_object('status', 'unavailable');
  end if;

  select root.* into display_root
  from private.admin_google_display_sessions as root
  where root.id = binding.id
    and root.token_jti_hash = binding.token_jti_hash
    and root.lecture_session_id = binding.lecture_session_id
    and root.admin_session_id = binding.admin_session_id
    and root.admin_auth_user_id = binding.admin_auth_user_id
  for update;
  if not found
     or not display_root.realtime_enabled
     or display_root.revoked_at is not null
     or display_root.display_auth_user_id is distinct from
       binding.display_auth_user_id
     or display_root.expires_at <= effective_now
     or display_root.hard_stop_at <= effective_now then
    return jsonb_build_object('status', 'unavailable');
  end if;

  admission_status := public.claim_display_caption_relay_v1(
    binding.topic,
    target_lecture_session_id,
    target_auth_user_id,
    target_stream_id,
    target_sequence,
    target_source
  );

  if admission_status = 'allowed' then
    return jsonb_build_object(
      'status', admission_status,
      'topic', binding.topic
    );
  end if;
  return jsonb_build_object('status', admission_status);
end;
$$;

revoke all on function private.claim_google_admin_display_caption_relay_v1(
  text, uuid, uuid, text, text, integer, boolean, uuid, uuid, uuid, uuid,
  bigint, text
) from public, anon, authenticated, service_role;

create function public.claim_google_admin_display_caption_relay_v1(
  target_token_hash text,
  target_auth_user_id uuid,
  target_supabase_auth_session_id uuid,
  target_google_issuer text,
  target_provider_subject_hmac text,
  target_subject_pepper_version integer,
  target_transport_enabled boolean,
  target_lecture_session_id uuid,
  target_start_request_id uuid,
  target_operation_id uuid,
  target_stream_id uuid,
  target_sequence bigint,
  target_source text
)
returns jsonb
language sql
volatile
security definer
set search_path = ''
as $$
  select private.claim_google_admin_display_caption_relay_v1(
    target_token_hash,
    target_auth_user_id,
    target_supabase_auth_session_id,
    target_google_issuer,
    target_provider_subject_hmac,
    target_subject_pepper_version,
    target_transport_enabled,
    target_lecture_session_id,
    target_start_request_id,
    target_operation_id,
    target_stream_id,
    target_sequence,
    target_source
  );
$$;

revoke all on function public.claim_google_admin_display_caption_relay_v1(
  text, uuid, uuid, text, text, integer, boolean, uuid, uuid, uuid, uuid,
  bigint, text
) from public, anon, authenticated;
grant execute on function public.claim_google_admin_display_caption_relay_v1(
  text, uuid, uuid, text, text, integer, boolean, uuid, uuid, uuid, uuid,
  bigint, text
) to service_role;
