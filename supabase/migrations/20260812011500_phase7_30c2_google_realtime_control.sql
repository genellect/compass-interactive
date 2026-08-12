-- Phase 7.30C2: finish the Google Admin operational transport for AI master
-- control and Realtime captions. All admission remains default OFF. Legacy
-- compatibility is retained for the later transactional Phase E cutover.

-- Master status can reconcile expiry and therefore must acquire the lecture
-- UPDATE lock before entering the C1 implementation. Revoke already has a
-- state-changing operation class and inherits UPDATE.
drop trigger admin_google_operation_policies_immutable
  on private.admin_google_operation_policies;

update private.admin_google_operation_policies
set lecture_lock_mode = 'update'
where operation_key = 'authorize-ai-start.masterStatus';

-- The two legacy browser-generic actions were never safe Google operations:
-- start bypassed the short-lived provider child and finish trusted browser
-- accounting. Reuse their closed-policy slots for the two semantic controls
-- the classroom UI actually needs, keeping the inventory cardinality stable.
update private.admin_google_operation_policies
set
  operation_key = 'manage-ai-control.setSummaryLanguage',
  action_name = 'setSummaryLanguage',
  access_scope = 'owned_lecture',
  lecture_state = 'draft_or_open',
  gate_mode = 'required',
  operation_class = 'write',
  lecture_lock_mode = 'update',
  instructor_requires_ai = false,
  owner_requires_ai = false,
  request_binding_required = true,
  control_step_up_action = null
where operation_key = 'manage-ai-control.startOperation';

update private.admin_google_operation_policies
set
  operation_key = 'manage-ai-control.disableFeatures',
  action_name = 'disableFeatures',
  access_scope = 'owned_lecture',
  lecture_state = 'retained',
  gate_mode = 'gate_independent',
  operation_class = 'free_control',
  lecture_lock_mode = 'update',
  instructor_requires_ai = false,
  owner_requires_ai = false,
  request_binding_required = true,
  control_step_up_action = null
where operation_key = 'manage-ai-control.finishOperation';

-- Heartbeat is a terminal-safety continuation. It must still tell a client to
-- stop after the lecture hard deadline, so it accepts status=open even after
-- hard_stop_at while retaining the exclusive lecture-first lock order.
update private.admin_google_operation_policies
set
  lecture_state = 'open_any',
  lecture_lock_mode = 'update'
where operation_key = 'manage-ai-control.heartbeat';

create trigger admin_google_operation_policies_immutable
before update or delete on private.admin_google_operation_policies
for each row execute function private.reject_admin_c1_evidence_mutation_v1();

-- Realtime provider creation is a separate, append-only boundary from the
-- generic provider dispatch claim. It is created before the control facade so
-- heartbeat/stop can require the complete start -> dispatch -> activation
-- chain in the same transaction.
create table private.admin_google_realtime_provider_creation_receipts (
  start_request_id uuid primary key
    references private.admin_google_ai_provider_start_receipts(start_request_id)
    on delete restrict,
  operation_id uuid not null unique
    references public.ai_usage_ledger(id) on delete restrict,
  client_request_id uuid not null unique,
  outcome text not null check (
    outcome in ('activated', 'creation_failed', 'creation_uncertain')
  ),
  provider_call_id text unique check (
    provider_call_id is null
    or (
      char_length(provider_call_id) between 3 and 200
      and provider_call_id ~ '^[A-Za-z0-9_-]+$'
    )
  ),
  provider_request_id text check (
    provider_request_id is null
    or char_length(provider_request_id) <= 200
  ),
  error_code text check (
    error_code is null
    or (
      char_length(error_code) between 1 and 120
      and error_code ~ '^[A-Za-z0-9:_-]+$'
    )
  ),
  created_at timestamptz not null default statement_timestamp(),
  check (
    (outcome = 'activated' and provider_call_id is not null and error_code is null)
    or (outcome = 'creation_failed' and provider_call_id is null and error_code is not null)
    or (outcome = 'creation_uncertain' and error_code is not null)
  )
);

create index admin_google_realtime_creation_operation_idx
  on private.admin_google_realtime_provider_creation_receipts (
    operation_id, created_at desc
  );

alter table private.admin_google_realtime_provider_creation_receipts
  enable row level security;
revoke all on private.admin_google_realtime_provider_creation_receipts
  from public, anon, authenticated, service_role;

create trigger admin_google_realtime_creation_receipts_append_only
before update or delete
on private.admin_google_realtime_provider_creation_receipts
for each row execute function private.reject_admin_c1_evidence_mutation_v1();

create function private.manage_google_admin_ai_master_v1(
  target_token_hash text,
  target_auth_user_id uuid,
  target_supabase_auth_session_id uuid,
  target_google_issuer text,
  target_provider_subject_hmac text,
  target_subject_pepper_version integer,
  target_action text,
  target_lecture_session_id uuid,
  target_request_id uuid default null,
  target_reason text default null,
  target_transport_enabled boolean default false
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
  result_value jsonb;
  effective_reason text := nullif(trim(coalesce(target_reason, '')), '');
begin
  if target_lecture_session_id is null
     or target_action not in ('masterStatus', 'revokeMaster')
     or target_transport_enabled is null
     or (
       target_action = 'masterStatus'
       and (target_request_id is not null or effective_reason is not null)
     )
     or (
       target_action = 'revokeMaster'
       and (
         target_request_id is null
         or effective_reason is null
         or char_length(effective_reason) > 120
       )
     ) then
    raise exception 'invalid Google AI master operation'
      using errcode = '22023';
  end if;

  if target_action = 'revokeMaster' then
    perform private.serialize_admin_ai_request_v1(target_request_id);
  end if;

  context_value := private.require_google_admin_operation_context_v1(
    target_token_hash,
    target_auth_user_id,
    target_supabase_auth_session_id,
    target_google_issuer,
    target_provider_subject_hmac,
    target_subject_pepper_version,
    'authorize-ai-start.' || target_action,
    target_lecture_session_id
  );
  if context_value is null then
    return null;
  end if;

  perform private.assert_google_admin_operation_gate_v1(
    context_value,
    target_transport_enabled
  );
  perform private.assert_google_admin_operation_lecture_state_v1(context_value);

  if target_action = 'masterStatus' then
    result_value := private.get_google_ai_master_status_v1(
      target_token_hash,
      target_auth_user_id,
      target_supabase_auth_session_id,
      target_lecture_session_id
    );
    if result_value is null then
      return null;
    end if;
    return result_value || jsonb_build_object('accepted', true);
  end if;

  result_value := private.revoke_google_ai_master_v1(
    target_token_hash,
    target_auth_user_id,
    target_supabase_auth_session_id,
    target_lecture_session_id,
    target_request_id,
    effective_reason
  );
  if result_value is null then
    return null;
  end if;
  return result_value;
end;
$$;

revoke all on function private.manage_google_admin_ai_master_v1(
  text, uuid, uuid, text, text, integer, text, uuid, uuid, text, boolean
) from public, anon, authenticated, service_role;

create function public.manage_google_admin_ai_master_v1(
  target_token_hash text,
  target_auth_user_id uuid,
  target_supabase_auth_session_id uuid,
  target_google_issuer text,
  target_provider_subject_hmac text,
  target_subject_pepper_version integer,
  target_action text,
  target_lecture_session_id uuid,
  target_request_id uuid default null,
  target_reason text default null,
  target_transport_enabled boolean default false
)
returns jsonb
language sql
volatile
security definer
set search_path = ''
as $$
  select private.manage_google_admin_ai_master_v1(
    target_token_hash,
    target_auth_user_id,
    target_supabase_auth_session_id,
    target_google_issuer,
    target_provider_subject_hmac,
    target_subject_pepper_version,
    target_action,
    target_lecture_session_id,
    target_request_id,
    target_reason,
    target_transport_enabled
  );
$$;

revoke all on function public.manage_google_admin_ai_master_v1(
  text, uuid, uuid, text, text, integer, text, uuid, uuid, text, boolean
) from public, anon, authenticated;
grant execute on function public.manage_google_admin_ai_master_v1(
  text, uuid, uuid, text, text, integer, text, uuid, uuid, text, boolean
) to service_role;

create function private.normalize_google_admin_ai_control_configuration_v1(
  target_action text,
  target_configuration jsonb
)
returns jsonb
language plpgsql
immutable
security definer
set search_path = ''
as $$
declare
  key_count integer;
  invalid_key text;
  invalid_value boolean;
begin
  if target_action not in (
       'configure',
       'disableFeatures',
       'setSummaryLanguage'
     )
     or target_configuration is null
     or jsonb_typeof(target_configuration) <> 'object' then
    raise exception 'invalid Google AI control configuration'
      using errcode = '22023';
  end if;

  select count(*)::integer
  into key_count
  from jsonb_object_keys(target_configuration);
  if key_count < 1 then
    raise exception 'AI control configuration cannot be empty'
      using errcode = '22023';
  end if;

  if target_action = 'setSummaryLanguage' then
    if key_count <> 1
       or not (target_configuration ? 'summary_language')
       or target_configuration ->> 'summary_language'
         not in ('auto', 'ja', 'en') then
      raise exception 'invalid summary language configuration'
        using errcode = '22023';
    end if;
    return target_configuration;
  end if;

  if target_action = 'disableFeatures' then
    select key
    into invalid_key
    from jsonb_object_keys(target_configuration) as key
    where key not in (
      'academic_answers_enabled',
      'captions_enabled',
      'material_analysis_enabled',
      'poll_suggestions_enabled',
      'summaries_enabled'
    )
    limit 1;
    select true
    into invalid_value
    from jsonb_each(target_configuration) as item(key, value)
    where jsonb_typeof(item.value) <> 'boolean'
       or item.value <> 'false'::jsonb
    limit 1;
    if invalid_key is not null or coalesce(invalid_value, false) then
      raise exception 'feature disable accepts false feature flags only'
        using errcode = '22023';
    end if;
    return target_configuration;
  end if;

  select key
  into invalid_key
  from jsonb_object_keys(target_configuration) as key
  where key not in (
    'academic_answer_limit',
    'audio_seconds_limit',
    'budget_limit_microusd',
    'input_token_limit',
    'material_analysis_call_limit',
    'max_concurrent_operations',
    'output_token_limit',
    'poll_generation_limit',
    'summary_call_limit'
  )
  limit 1;
  select true
  into invalid_value
  from jsonb_each(target_configuration) as item(key, value)
  where jsonb_typeof(item.value) <> 'number'
     or item.value::text !~ '^[0-9]+$'
  limit 1;
  if invalid_key is not null or coalesce(invalid_value, false) then
    raise exception 'AI policy limits must be non-negative integers'
      using errcode = '22023';
  end if;
  return target_configuration;
end;
$$;

revoke all on function
  private.normalize_google_admin_ai_control_configuration_v1(text, jsonb)
  from public, anon, authenticated, service_role;

create function private.google_admin_ai_control_payload_digest_v1(
  target_action text,
  target_operation_id uuid,
  target_configuration jsonb,
  target_reason text
)
returns text
language sql
immutable
security definer
set search_path = ''
as $$
  select case
    when target_action not in (
      'configure',
      'disableFeatures',
      'heartbeat',
      'setSummaryLanguage',
      'stop',
      'stopFeature'
    ) then null
    else encode(
      extensions.digest(
        convert_to(
          'phase730c2:google-ai-control:v1'
          || '|action=' || target_action
          || '|operation=' || coalesce(target_operation_id::text, '')
          || '|configuration=' || coalesce(target_configuration::text, '')
          || '|reason=' || coalesce(target_reason, ''),
          'UTF8'
        ),
        'sha256'
      ),
      'hex'
    )
  end;
$$;

revoke all on function private.google_admin_ai_control_payload_digest_v1(
  text, uuid, jsonb, text
) from public, anon, authenticated, service_role;

create function private.get_google_admin_ai_control_configuration_intent_v1(
  target_token_hash text,
  target_auth_user_id uuid,
  target_supabase_auth_session_id uuid,
  target_google_issuer text,
  target_provider_subject_hmac text,
  target_subject_pepper_version integer,
  target_lecture_session_id uuid,
  target_request_id uuid,
  target_configuration jsonb,
  target_transport_enabled boolean default false
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
  normalized_configuration jsonb;
  payload_digest_value text;
  intent_digest_value text;
begin
  if target_lecture_session_id is null
     or target_request_id is null
     or target_transport_enabled is null then
    raise exception 'invalid Google AI configuration intent request'
      using errcode = '22023';
  end if;
  normalized_configuration :=
    private.normalize_google_admin_ai_control_configuration_v1(
      'configure',
      target_configuration
    );
  context_value := private.require_google_admin_operation_context_v1(
    target_token_hash,
    target_auth_user_id,
    target_supabase_auth_session_id,
    target_google_issuer,
    target_provider_subject_hmac,
    target_subject_pepper_version,
    'manage-ai-control.configure',
    target_lecture_session_id
  );
  if context_value is null then
    return null;
  end if;
  perform private.assert_google_admin_operation_gate_v1(
    context_value,
    target_transport_enabled
  );
  perform private.assert_google_admin_operation_lecture_state_v1(context_value);

  payload_digest_value := private.google_admin_ai_control_payload_digest_v1(
    'configure',
    null,
    normalized_configuration,
    null
  );
  intent_digest_value := private.google_admin_operation_intent_digest_v1(
    target_request_id,
    (context_value ->> 'admin_session_id')::uuid,
    'manage-ai-control.configure',
    target_lecture_session_id,
    null,
    payload_digest_value
  );
  if intent_digest_value is null then
    return null;
  end if;
  return jsonb_build_object(
    'accepted', true,
    'intentDigest', intent_digest_value,
    'requestId', target_request_id,
    'serverTime', statement_timestamp()
  );
end;
$$;

revoke all on function
  private.get_google_admin_ai_control_configuration_intent_v1(
    text, uuid, uuid, text, text, integer, uuid, uuid, jsonb, boolean
  ) from public, anon, authenticated, service_role;

create function public.get_google_admin_ai_control_configuration_intent_v1(
  target_token_hash text,
  target_auth_user_id uuid,
  target_supabase_auth_session_id uuid,
  target_google_issuer text,
  target_provider_subject_hmac text,
  target_subject_pepper_version integer,
  target_lecture_session_id uuid,
  target_request_id uuid,
  target_configuration jsonb,
  target_transport_enabled boolean default false
)
returns jsonb
language sql
volatile
security definer
set search_path = ''
as $$
  select private.get_google_admin_ai_control_configuration_intent_v1(
    target_token_hash,
    target_auth_user_id,
    target_supabase_auth_session_id,
    target_google_issuer,
    target_provider_subject_hmac,
    target_subject_pepper_version,
    target_lecture_session_id,
    target_request_id,
    target_configuration,
    target_transport_enabled
  );
$$;

revoke all on function
  public.get_google_admin_ai_control_configuration_intent_v1(
    text, uuid, uuid, text, text, integer, uuid, uuid, jsonb, boolean
  ) from public, anon, authenticated;
grant execute on function
  public.get_google_admin_ai_control_configuration_intent_v1(
    text, uuid, uuid, text, text, integer, uuid, uuid, jsonb, boolean
  ) to service_role;

create function private.manage_google_admin_ai_control_v1(
  target_token_hash text,
  target_auth_user_id uuid,
  target_supabase_auth_session_id uuid,
  target_google_issuer text,
  target_provider_subject_hmac text,
  target_subject_pepper_version integer,
  target_action text,
  target_lecture_session_id uuid,
  target_request_id uuid default null,
  target_operation_id uuid default null,
  target_configuration jsonb default null,
  target_reason text default null,
  target_control_intent_digest text default null,
  target_transport_enabled boolean default false
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
  operation_key_value text := 'manage-ai-control.' || coalesce(target_action, '');
  context_value jsonb;
  normalized_configuration jsonb;
  payload_digest_value text;
  intent_digest_value text;
  effective_reason text := nullif(trim(coalesce(target_reason, '')), '');
  target_id_value text := target_operation_id::text;
  receipt_row private.admin_google_operation_receipts%rowtype;
  start_intent private.admin_google_ai_provider_start_intents%rowtype;
  dispatch_receipt private.admin_google_ai_provider_dispatch_receipts%rowtype;
  creation_receipt private.admin_google_realtime_provider_creation_receipts%rowtype;
  control_grant jsonb;
  ai_gate private.admin_ai_unlock_runtime_gate%rowtype;
  policy_row private.admin_ai_policies%rowtype;
  master_row public.lecture_ai_master_authorizations%rowtype;
  control_row public.lecture_ai_control%rowtype;
  active_caption_usage public.ai_usage_ledger%rowtype;
  usage_row public.ai_usage_ledger%rowtype;
  provider_call_row public.ai_realtime_provider_calls%rowtype;
  summary_run public.lecture_summary_runs%rowtype;
  result_value jsonb;
  recent_operations jsonb := '[]'::jsonb;
  result_metadata_value jsonb := '{}'::jsonb;
  result_status_value text;
  actor_value text;
  changed_value boolean := false;
  live_authority boolean := false;
  replay_value boolean := false;
  effective_now timestamptz := statement_timestamp();
begin
  if target_action not in (
       'configure',
       'disableFeatures',
       'heartbeat',
       'setSummaryLanguage',
       'status',
       'stop',
       'stopFeature'
     )
     or target_lecture_session_id is null
     or target_transport_enabled is null then
    raise exception 'invalid Google AI control operation'
      using errcode = '22023';
  end if;

  if target_action = 'status' then
    if target_request_id is not null
       or target_operation_id is not null
       or target_configuration is not null
       or effective_reason is not null
       or target_control_intent_digest is not null then
      raise exception 'invalid Google AI status request'
        using errcode = '22023';
    end if;
  elsif target_action in (
    'configure', 'disableFeatures', 'setSummaryLanguage'
  ) then
    if target_request_id is null
       or target_operation_id is not null
       or target_configuration is null
       or effective_reason is not null
       or (
         target_action = 'configure'
         and (
           target_control_intent_digest is null
           or target_control_intent_digest !~ '^[0-9a-f]{64}$'
         )
       )
       or (
         target_action <> 'configure'
         and target_control_intent_digest is not null
       ) then
      raise exception 'invalid Google AI configuration request'
        using errcode = '22023';
    end if;
    normalized_configuration :=
      private.normalize_google_admin_ai_control_configuration_v1(
        target_action,
        target_configuration
      );
  elsif target_action = 'heartbeat' then
    if target_request_id is null
       or target_operation_id is null
       or target_configuration is not null
       or effective_reason is not null
       or target_control_intent_digest is not null then
      raise exception 'invalid Google AI heartbeat request'
        using errcode = '22023';
    end if;
  elsif target_action = 'stopFeature' then
    if target_request_id is null
       or target_operation_id is null
       or target_configuration is not null
       or effective_reason is null
       or char_length(effective_reason) > 120
       or target_control_intent_digest is not null then
      raise exception 'invalid Google AI feature stop request'
        using errcode = '22023';
    end if;
  elsif target_action = 'stop' then
    if target_request_id is null
       or target_operation_id is not null
       or target_configuration is not null
       or effective_reason is null
       or char_length(effective_reason) > 120
       or target_control_intent_digest is not null then
      raise exception 'invalid Google AI stop request'
        using errcode = '22023';
    end if;
  end if;

  if target_action <> 'status' then
    perform private.serialize_admin_ai_request_v1(target_request_id);
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

  if target_action = 'status' then
    perform private.assert_google_admin_operation_gate_v1(
      context_value,
      target_transport_enabled
    );
    perform private.assert_google_admin_operation_lecture_state_v1(context_value);
    select control.*
    into control_row
    from public.lecture_ai_control as control
    where control.lecture_session_id = target_lecture_session_id;
    select coalesce(jsonb_agg(item.payload order by item.requested_at desc), '[]'::jsonb)
    into recent_operations
    from (
      select
        usage.requested_at,
        jsonb_build_object(
          'actual_audio_seconds', usage.actual_audio_seconds,
          'actual_input_tokens', usage.actual_input_tokens,
          'actual_microusd', usage.actual_microusd,
          'actual_output_tokens', usage.actual_output_tokens,
          'error_code', usage.error_code,
          'feature', usage.feature,
          'finished_at', usage.finished_at,
          'id', usage.id,
          'lecture_session_id', usage.lecture_session_id,
          'requested_at', usage.requested_at,
          'reserved_audio_seconds', usage.reserved_audio_seconds,
          'reserved_input_tokens', usage.reserved_input_tokens,
          'reserved_microusd', usage.reserved_microusd,
          'reserved_output_tokens', usage.reserved_output_tokens,
          'result_accepted', usage.result_accepted,
          'status', usage.status
        ) as payload
      from public.ai_usage_ledger as usage
      where usage.lecture_session_id = target_lecture_session_id
      order by usage.requested_at desc, usage.id desc
      limit 20
    ) as item;
    return jsonb_build_object(
      'accepted', true,
      'control', case when control_row.lecture_session_id is null
        then null else to_jsonb(control_row) end,
      'recentOperations', recent_operations,
      'serverTime', statement_timestamp()
    );
  end if;

  payload_digest_value := private.google_admin_ai_control_payload_digest_v1(
    target_action,
    target_operation_id,
    normalized_configuration,
    effective_reason
  );
  intent_digest_value := private.google_admin_operation_intent_digest_v1(
    target_request_id,
    (context_value ->> 'admin_session_id')::uuid,
    operation_key_value,
    target_lecture_session_id,
    target_id_value,
    payload_digest_value
  );
  if intent_digest_value is null
     or (
       target_action = 'configure'
       and target_control_intent_digest is distinct from intent_digest_value
     ) then
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
       and receipt_row.target_id is not distinct from target_id_value
       and receipt_row.result_id is not distinct from target_id_value then
      if target_action = 'heartbeat' then
        -- A heartbeat retry is deliberately re-evaluated against current
        -- authority. Replaying a previously stored "continue" decision after
        -- a revoke or gate transition would keep a paid provider call alive.
        replay_value := true;
      else
        return jsonb_build_object(
          'accepted', true,
          'idempotentReplay', true,
          'metadata', receipt_row.result_metadata,
          'refreshRequired', true,
          'status', receipt_row.result_status
        );
      end if;
    else
      raise exception 'AI control request binding does not match its receipt'
        using errcode = 'P7335';
    end if;
  end if;

  perform private.assert_google_admin_operation_gate_v1(
    context_value,
    target_transport_enabled
  );
  perform private.assert_google_admin_operation_lecture_state_v1(context_value);
  actor_value := 'admin-session:' || (context_value ->> 'admin_session_id');

  if target_action = 'setSummaryLanguage' then
    result_value := private.set_lecture_summary_language(
      target_lecture_session_id,
      normalized_configuration ->> 'summary_language',
      actor_value
    );
    result_status_value := 'updated';
    result_metadata_value := jsonb_build_object(
      'summaryLanguage', result_value ->> 'summary_language',
      'version', (result_value ->> 'version')::bigint
    );
  elsif target_action = 'disableFeatures' then
    select control.*
    into control_row
    from public.lecture_ai_control as control
    where control.lecture_session_id = target_lecture_session_id
    for update;
    if found then
      changed_value :=
        ((normalized_configuration ? 'captions_enabled') and control_row.captions_enabled)
        or ((normalized_configuration ? 'summaries_enabled') and control_row.summaries_enabled)
        or ((normalized_configuration ? 'material_analysis_enabled') and control_row.material_analysis_enabled)
        or ((normalized_configuration ? 'poll_suggestions_enabled') and control_row.poll_suggestions_enabled)
        or ((normalized_configuration ? 'academic_answers_enabled') and control_row.academic_answers_enabled);
      if (normalized_configuration ? 'captions_enabled')
         and control_row.captions_enabled then
        select usage.*
        into active_caption_usage
        from public.ai_usage_ledger as usage
        where usage.lecture_session_id = target_lecture_session_id
          and usage.feature = 'captions'
          and usage.status = 'running'
        for update;
        if found then
          perform private.finish_realtime_caption_operation(
            active_caption_usage.id,
            active_caption_usage.requested_by_actor,
            'caption_feature_disabled',
            true,
            true
          );
        end if;
      end if;
      update public.lecture_ai_control as control
      set
        captions_enabled = control.captions_enabled
          and not (normalized_configuration ? 'captions_enabled'),
        summaries_enabled = control.summaries_enabled
          and not (normalized_configuration ? 'summaries_enabled'),
        material_analysis_enabled = control.material_analysis_enabled
          and not (normalized_configuration ? 'material_analysis_enabled'),
        poll_suggestions_enabled = control.poll_suggestions_enabled
          and not (normalized_configuration ? 'poll_suggestions_enabled'),
        academic_answers_enabled = control.academic_answers_enabled
          and not (normalized_configuration ? 'academic_answers_enabled'),
        status = case
          when control.active_operation_count > 0 then 'running'
          when (control.captions_enabled and not (normalized_configuration ? 'captions_enabled'))
            or (control.summaries_enabled and not (normalized_configuration ? 'summaries_enabled'))
            or (control.material_analysis_enabled and not (normalized_configuration ? 'material_analysis_enabled'))
            or (control.poll_suggestions_enabled and not (normalized_configuration ? 'poll_suggestions_enabled'))
            or (control.academic_answers_enabled and not (normalized_configuration ? 'academic_answers_enabled'))
            then 'ready'
          else 'disabled'
        end,
        version = control.version + 1,
        updated_at = statement_timestamp()
      where control.lecture_session_id = target_lecture_session_id
      returning * into control_row;
      result_value := to_jsonb(control_row);
    else
      result_value := null;
    end if;
    result_status_value := 'disabled';
    result_metadata_value := jsonb_build_object(
      'changed', changed_value,
      'featureCount', (select count(*) from jsonb_object_keys(normalized_configuration))
    );
  elsif target_action = 'configure' then
    control_grant := private.consume_admin_control_step_up_grant_v1(
      (context_value ->> 'admin_session_id')::uuid,
      'environment_ai_policy_change',
      target_request_id,
      intent_digest_value,
      false
    );
    if control_grant is null then
      return null;
    end if;
    update public.admin_sessions
    set
      step_up_verified_at =
        (control_grant ->> 'verified_totp_amr_at')::timestamptz,
      updated_at = statement_timestamp()
    where id = (context_value ->> 'admin_session_id')::uuid;
    result_value := private.configure_lecture_ai_control(
      target_lecture_session_id,
      normalized_configuration,
      actor_value
    );
    result_status_value := 'updated';
    result_metadata_value := jsonb_build_object(
      'changed', true,
      'version', (result_value ->> 'version')::bigint
    );
  elsif target_action in ('heartbeat', 'stopFeature') then
    select intent.*
    into start_intent
    from private.admin_google_ai_provider_start_intents as intent
    join private.admin_google_ai_provider_start_receipts as receipt
      on receipt.start_request_id = intent.start_request_id
    where receipt.operation_id = target_operation_id
      and intent.feature = 'captions'
      and intent.environment_id = (context_value ->> 'environment_id')::uuid
      and intent.principal_id = (context_value ->> 'principal_id')::uuid
      and intent.membership_id = (context_value ->> 'membership_id')::uuid
      and intent.lecture_session_id = target_lecture_session_id;
    if not found
       or (
         target_action = 'heartbeat'
         and start_intent.admin_session_id <>
            (context_value ->> 'admin_session_id')::uuid
       ) then
      return null;
    end if;

    select dispatch.*
    into dispatch_receipt
    from private.admin_google_ai_provider_dispatch_receipts as dispatch
    where dispatch.start_request_id = start_intent.start_request_id
      and dispatch.operation_id = target_operation_id
      and dispatch.provider_family = 'openai_realtime_v1';
    if not found
       or dispatch_receipt.client_request_id is distinct from
         start_intent.start_request_id then
      return null;
    end if;

    select creation.*
    into creation_receipt
    from private.admin_google_realtime_provider_creation_receipts as creation
    where creation.start_request_id = start_intent.start_request_id
      and creation.operation_id = target_operation_id
      and creation.client_request_id = dispatch_receipt.client_request_id;
    if not found then
      return null;
    end if;

    select control.*
    into control_row
    from public.lecture_ai_control as control
    where control.lecture_session_id = target_lecture_session_id
    for update;
    select usage.*
    into usage_row
    from public.ai_usage_ledger as usage
    where usage.id = target_operation_id
      and usage.lecture_session_id = target_lecture_session_id
      and usage.feature = 'captions'
      and usage.requested_by_actor =
        'admin-session:' || start_intent.admin_session_id::text
    for update;
    if control_row.lecture_session_id is null or usage_row.id is null then
      return null;
    end if;

    select provider_call.*
    into provider_call_row
    from public.ai_realtime_provider_calls as provider_call
    where provider_call.operation_id = target_operation_id
      and provider_call.lecture_session_id = target_lecture_session_id
      and provider_call.actor_id = usage_row.requested_by_actor
      and provider_call.client_request_id = start_intent.start_request_id::text
    for update;
    if not found
       or provider_call_row.provider_call_id is distinct from
         creation_receipt.provider_call_id
       or provider_call_row.provider_request_id is distinct from
         creation_receipt.provider_request_id then
      return null;
    end if;

    if target_action = 'heartbeat' then
      select gate.*
      into ai_gate
      from private.admin_ai_unlock_runtime_gate as gate
      where gate.singleton;
      select policy.*
      into policy_row
      from private.admin_ai_policies as policy
      where policy.id = start_intent.policy_id
        and policy.version = start_intent.policy_version;
      select master.*
      into master_row
      from public.lecture_ai_master_authorizations as master
      where master.id = start_intent.master_authorization_id;

      live_authority :=
        coalesce((context_value ->> 'can_use_ai')::boolean, false)
        and target_transport_enabled is true
        and coalesce(
          (context_value ->> 'google_operational_authorization_enabled')::boolean,
          false
        )
        and ai_gate.singleton is true
        and ai_gate.google_ai_child_grant_enabled is true
        and policy_row.id is not null
        and policy_row.environment_id is not distinct from
          start_intent.environment_id
        and policy_row.membership_id is not distinct from
          start_intent.membership_id
        and policy_row.status = 'active'
        and policy_row.valid_from <= effective_now
        and policy_row.valid_until > effective_now
        and array['captions']::text[] <@ policy_row.allowed_actions
        and array[start_intent.model_id]::text[] <@ policy_row.allowed_models
        and master_row.id is not null
        and master_row.lecture_session_id is not distinct from
          target_lecture_session_id
        and master_row.principal_id is not distinct from start_intent.principal_id
        and master_row.membership_id is not distinct from start_intent.membership_id
        and master_row.issuing_admin_session_id is not distinct from
          start_intent.admin_session_id
        and master_row.ai_policy_id is not distinct from start_intent.policy_id
        and master_row.ai_policy_version is not distinct from
          start_intent.policy_version
        and master_row.status = 'active'
        and master_row.expires_at > effective_now
        and array['captions']::text[] <@ master_row.actions
        and creation_receipt.outcome = 'activated'
        and control_row.status in ('ready', 'running')
        and control_row.captions_enabled
        and control_row.stop_requested_at is null
        and usage_row.status = 'running'
        and usage_row.accounting_settled_at is null
        and usage_row.provider_dispatched_at is not null
        and usage_row.provider_request_id is not distinct from
          dispatch_receipt.client_request_id::text
        and provider_call_row.status = 'active';

      if live_authority then
        result_value := private.heartbeat_realtime_caption_operation(
          target_operation_id,
          usage_row.requested_by_actor
        );
      else
        perform private.finish_realtime_caption_operation(
          target_operation_id,
          usage_row.requested_by_actor,
          'authority_revoked',
          true,
          true
        );
        result_value := jsonb_build_object(
          'accepted', true,
          'reason', 'authority_revoked',
          'should_stop', true
        );
      end if;
      result_status_value := case
        when coalesce((result_value ->> 'should_stop')::boolean, true)
          then 'stop'
        else 'continue'
      end;
      result_metadata_value := jsonb_build_object(
        'reason', result_value ->> 'reason',
        'should_stop', coalesce(
          (result_value ->> 'should_stop')::boolean,
          true
        )
      );
    else
      perform private.finish_realtime_caption_operation(
        target_operation_id,
        usage_row.requested_by_actor,
        effective_reason,
        true,
        true
      );
      result_status_value := 'stopped';
      result_metadata_value := jsonb_build_object(
        'pending', true,
        'shouldStop', true
      );
      result_value := jsonb_build_object(
        'providerHangup', jsonb_build_object('pending', true),
        'shouldStop', true
      );
    end if;
  else
    -- Full stop is one database transaction. The summary actor is derived
    -- from the locked run; a different valid session of the same owner can
    -- still stop the lecture without impersonating browser input.
    select control.*
    into control_row
    from public.lecture_ai_control as control
    where control.lecture_session_id = target_lecture_session_id
    for update;
    if found then
      select usage.*
      into active_caption_usage
      from public.ai_usage_ledger as usage
      where usage.lecture_session_id = target_lecture_session_id
        and usage.feature = 'captions'
        and usage.status = 'running'
      for update;
      if found then
        perform private.finish_realtime_caption_operation(
          active_caption_usage.id,
          active_caption_usage.requested_by_actor,
          effective_reason,
          true,
          true
        );
      end if;
      select run.*
      into summary_run
      from public.lecture_summary_runs as run
      where run.lecture_session_id = target_lecture_session_id
        and run.status = 'running'
      for update;
      if summary_run.id is not null then
        result_value := private.stop_lecture_summary_run(
          target_lecture_session_id,
          summary_run.actor_id,
          effective_reason
        );
        if coalesce((result_value ->> 'accepted')::boolean, false) is not true then
          raise exception 'summary stop did not reach a terminal state'
            using errcode = 'P7335';
        end if;
      end if;
      result_value := private.stop_lecture_ai_control(
        target_lecture_session_id,
        effective_reason,
        actor_value
      );
    else
      result_value := null;
    end if;
    result_status_value := 'stopped';
    result_metadata_value := jsonb_build_object(
      'changed', control_row.lecture_session_id is not null,
      'pending', true
    );
    result_value := jsonb_build_object(
      'control', result_value,
      'providerHangup', jsonb_build_object('pending', true)
    );
  end if;

  if not replay_value then
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
      target_id_value,
      target_id_value,
      result_status_value,
      result_metadata_value
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
      'admin_ai_control.' || target_action,
      case when target_operation_id is null
        then 'lecture_ai_control' else 'ai_operation' end,
      coalesce(target_operation_id::text, target_lecture_session_id::text),
      'accepted',
      'google_admin_operation',
      jsonb_build_object(
        'operation_key', operation_key_value,
        'result_status', result_status_value
      )
    );
  end if;

  return jsonb_build_object(
    'accepted', true,
    'idempotentReplay', replay_value,
    'metadata', result_metadata_value,
    'result', result_value,
    'status', result_status_value
  );
end;
$$;

revoke all on function private.manage_google_admin_ai_control_v1(
  text, uuid, uuid, text, text, integer, text, uuid, uuid, uuid, jsonb,
  text, text, boolean
) from public, anon, authenticated, service_role;

create function public.manage_google_admin_ai_control_v1(
  target_token_hash text,
  target_auth_user_id uuid,
  target_supabase_auth_session_id uuid,
  target_google_issuer text,
  target_provider_subject_hmac text,
  target_subject_pepper_version integer,
  target_action text,
  target_lecture_session_id uuid,
  target_request_id uuid default null,
  target_operation_id uuid default null,
  target_configuration jsonb default null,
  target_reason text default null,
  target_control_intent_digest text default null,
  target_transport_enabled boolean default false
)
returns jsonb
language sql
volatile
security definer
set search_path = ''
as $$
  select private.manage_google_admin_ai_control_v1(
    target_token_hash,
    target_auth_user_id,
    target_supabase_auth_session_id,
    target_google_issuer,
    target_provider_subject_hmac,
    target_subject_pepper_version,
    target_action,
    target_lecture_session_id,
    target_request_id,
    target_operation_id,
    target_configuration,
    target_reason,
    target_control_intent_digest,
    target_transport_enabled
  );
$$;

revoke all on function public.manage_google_admin_ai_control_v1(
  text, uuid, uuid, text, text, integer, text, uuid, uuid, uuid, jsonb,
  text, text, boolean
) from public, anon, authenticated;
grant execute on function public.manage_google_admin_ai_control_v1(
  text, uuid, uuid, text, text, integer, text, uuid, uuid, uuid, jsonb,
  text, text, boolean
) to service_role;
