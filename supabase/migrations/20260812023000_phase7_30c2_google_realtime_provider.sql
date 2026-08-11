-- Phase 7.30C2: Google Admin Realtime caption provider authority.
--
-- A Realtime call uses the same C1 master -> C2 child -> immutable start ->
-- single dispatch chain as every other paid provider operation. Provider
-- creation and caption publication receive typed, transaction-authoritative
-- continuations; provider secrets, SDP and caption text are never evidence.

alter table private.admin_google_ai_provider_start_intents
  drop constraint admin_google_ai_provider_start_intents_feature_check;
alter table private.admin_google_ai_provider_start_intents
  add constraint admin_google_ai_provider_start_intents_feature_check check (
    feature in (
      'academic_answers', 'captions', 'material_analysis',
      'poll_suggestions', 'summaries'
    )
  );

alter table private.admin_google_ai_provider_start_intents
  drop constraint admin_google_ai_provider_start_intents_provider_family_check;
alter table private.admin_google_ai_provider_start_intents
  add constraint admin_google_ai_provider_start_intents_provider_family_check
  check (
    (feature = 'captions' and provider_family = 'openai_realtime_v1')
    or (
      feature <> 'captions'
      and provider_family = 'openai_responses_v1'
    )
  );

create function private.google_realtime_provider_intent_digest_v1(
  target_lecture_session_id uuid,
  target_model_id text,
  target_language text,
  target_delay text,
  target_session_config_sha256 text,
  target_sdp_offer_sha256 text,
  target_price_microusd_per_minute bigint,
  target_requested_audio_seconds integer,
  target_estimated_microusd bigint
)
returns text
language sql
immutable
security definer
set search_path = ''
as $$
  select case
    when target_lecture_session_id is null
      or nullif(trim(target_model_id), '') is null
      or char_length(target_model_id) > 120
      or target_language not in ('auto', 'en', 'ja')
      or target_delay not in ('minimal', 'low', 'medium', 'high', 'xhigh')
      or target_session_config_sha256 is null
      or target_session_config_sha256 !~ '^[0-9a-f]{64}$'
      or target_sdp_offer_sha256 is null
      or target_sdp_offer_sha256 !~ '^[0-9a-f]{64}$'
      or target_price_microusd_per_minute is null
      or target_price_microusd_per_minute < 1
      or target_requested_audio_seconds is null
      or target_requested_audio_seconds not between 1 and 5400
      or target_estimated_microusd is null
      or target_estimated_microusd < 1
      then null
    else pg_catalog.encode(
      extensions.digest(
        pg_catalog.convert_to(
          'compass:phase7.30c2:google-realtime-provider-intent:v1'
          || '|lecture=' || target_lecture_session_id::text
          || '|model=' || trim(target_model_id)
          || '|language=' || target_language
          || '|delay=' || target_delay
          || '|session_config=' || target_session_config_sha256
          || '|sdp_offer=' || target_sdp_offer_sha256
          || '|price=' || target_price_microusd_per_minute::text
          || '|requested_audio=' || target_requested_audio_seconds::text
          || '|estimated_cost=' || target_estimated_microusd::text,
          'UTF8'
        ),
        'sha256'
      ),
      'hex'
    )
  end;
$$;

revoke all on function private.google_realtime_provider_intent_digest_v1(
  uuid, text, text, text, text, text, bigint, integer, bigint
) from public, anon, authenticated, service_role;

create function private.issue_google_realtime_ai_child_grant_v1(
  target_token_hash text,
  target_auth_user_id uuid,
  target_supabase_auth_session_id uuid,
  target_google_issuer text,
  target_provider_subject_hmac text,
  target_subject_pepper_version integer,
  target_lecture_session_id uuid,
  target_model_id text,
  target_language text,
  target_delay text,
  target_session_config_sha256 text,
  target_sdp_offer_sha256 text,
  target_price_microusd_per_minute bigint,
  target_requested_audio_seconds integer,
  target_estimated_microusd bigint,
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
set statement_timeout = '8s'
set lock_timeout = '750ms'
as $$
declare
  provider_digest_value text;
  child_result jsonb;
begin
  provider_digest_value := private.google_realtime_provider_intent_digest_v1(
    target_lecture_session_id,
    target_model_id,
    target_language,
    target_delay,
    target_session_config_sha256,
    target_sdp_offer_sha256,
    target_price_microusd_per_minute,
    target_requested_audio_seconds,
    target_estimated_microusd
  );
  if provider_digest_value is null then
    return null;
  end if;

  child_result := private.issue_google_ai_child_grant_v1(
    target_token_hash,
    target_auth_user_id,
    target_supabase_auth_session_id,
    target_google_issuer,
    target_provider_subject_hmac,
    target_subject_pepper_version,
    target_lecture_session_id,
    'captions',
    provider_digest_value,
    target_nonce_hash,
    target_nonce_key_version,
    target_request_id,
    target_transport_enabled
  );
  if child_result is null
     or coalesce((child_result ->> 'accepted')::boolean, false) is not true then
    return child_result;
  end if;

  return child_result || jsonb_build_object(
    'providerIntentDigest', provider_digest_value
  );
end;
$$;

revoke all on function private.issue_google_realtime_ai_child_grant_v1(
  text, uuid, uuid, text, text, integer, uuid, text, text, text, text, text,
  bigint, integer, bigint, text, integer, uuid, boolean
) from public, anon, authenticated, service_role;

create function public.issue_google_realtime_ai_child_grant_v1(
  target_token_hash text,
  target_auth_user_id uuid,
  target_supabase_auth_session_id uuid,
  target_google_issuer text,
  target_provider_subject_hmac text,
  target_subject_pepper_version integer,
  target_lecture_session_id uuid,
  target_model_id text,
  target_language text,
  target_delay text,
  target_session_config_sha256 text,
  target_sdp_offer_sha256 text,
  target_price_microusd_per_minute bigint,
  target_requested_audio_seconds integer,
  target_estimated_microusd bigint,
  target_nonce_hash text,
  target_nonce_key_version integer,
  target_request_id uuid,
  target_transport_enabled boolean
)
returns jsonb
language sql
volatile
security definer
set search_path = ''
as $$
  select private.issue_google_realtime_ai_child_grant_v1(
    target_token_hash,
    target_auth_user_id,
    target_supabase_auth_session_id,
    target_google_issuer,
    target_provider_subject_hmac,
    target_subject_pepper_version,
    target_lecture_session_id,
    target_model_id,
    target_language,
    target_delay,
    target_session_config_sha256,
    target_sdp_offer_sha256,
    target_price_microusd_per_minute,
    target_requested_audio_seconds,
    target_estimated_microusd,
    target_nonce_hash,
    target_nonce_key_version,
    target_request_id,
    target_transport_enabled
  );
$$;

revoke all on function public.issue_google_realtime_ai_child_grant_v1(
  text, uuid, uuid, text, text, integer, uuid, text, text, text, text, text,
  bigint, integer, bigint, text, integer, uuid, boolean
) from public, anon, authenticated;
grant execute on function public.issue_google_realtime_ai_child_grant_v1(
  text, uuid, uuid, text, text, integer, uuid, text, text, text, text, text,
  bigint, integer, bigint, text, integer, uuid, boolean
) to service_role;

create function private.start_google_admin_realtime_operation_v1(
  target_token_hash text,
  target_auth_user_id uuid,
  target_supabase_auth_session_id uuid,
  target_google_issuer text,
  target_provider_subject_hmac text,
  target_subject_pepper_version integer,
  target_grant_id uuid,
  target_nonce_hash text,
  target_lecture_session_id uuid,
  target_model_id text,
  target_language text,
  target_delay text,
  target_session_config_sha256 text,
  target_sdp_offer_sha256 text,
  target_price_microusd_per_minute bigint,
  target_requested_audio_seconds integer,
  target_estimated_microusd bigint,
  target_start_request_id uuid,
  target_provider_intent_digest text,
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
  grant_row public.ai_billing_grants%rowtype;
  child_receipt private.admin_google_ai_child_grant_receipts%rowtype;
  start_intent private.admin_google_ai_provider_start_intents%rowtype;
  start_receipt private.admin_google_ai_provider_start_receipts%rowtype;
  context_value jsonb;
  identity_gate private.admin_identity_runtime_gate%rowtype;
  ai_gate private.admin_ai_unlock_runtime_gate%rowtype;
  ownership_row private.admin_lecture_ownerships%rowtype;
  policy_row private.admin_ai_policies%rowtype;
  lecture_row public.lecture_sessions%rowtype;
  master_row public.lecture_ai_master_authorizations%rowtype;
  control_row public.lecture_ai_control%rowtype;
  usage_row public.ai_usage_ledger%rowtype;
  provider_call_row public.ai_realtime_provider_calls%rowtype;
  result_value jsonb;
  provider_digest_value text;
  start_digest_value text;
  operation_id_value uuid;
  actor_value text;
  lecture_calls bigint;
  daily_calls bigint;
  lecture_audio bigint;
  daily_audio bigint;
  lecture_cost bigint;
  daily_cost bigint;
  policy_running bigint;
  deadline_seconds integer;
  control_audio_seconds integer;
  control_budget_seconds integer;
  policy_lecture_seconds integer;
  policy_daily_seconds integer;
  reserved_audio_seconds_value integer;
  reserved_microusd_value bigint;
  effective_now timestamptz := statement_timestamp();
  utc_day_start timestamptz := date_trunc(
    'day', statement_timestamp() at time zone 'UTC'
  ) at time zone 'UTC';
begin
  provider_digest_value := private.google_realtime_provider_intent_digest_v1(
    target_lecture_session_id,
    target_model_id,
    target_language,
    target_delay,
    target_session_config_sha256,
    target_sdp_offer_sha256,
    target_price_microusd_per_minute,
    target_requested_audio_seconds,
    target_estimated_microusd
  );
  if target_start_request_id is null
     or target_grant_id is null
     or target_nonce_hash is null
     or target_nonce_hash !~ '^[0-9a-f]{64}$'
     or provider_digest_value is null
     or target_provider_intent_digest is distinct from provider_digest_value
     or target_transport_enabled is null
     or target_estimated_microusd is distinct from ceil(
       target_requested_audio_seconds::numeric
         * target_price_microusd_per_minute::numeric / 60
     )::bigint then
    return null;
  end if;

  perform private.serialize_admin_ai_request_v1(target_start_request_id);
  -- Legacy billing consumption is grant-first. Preserve that order while both
  -- transports coexist, then keep every mutable domain lock canonical.
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
        'compass:phase7.30c2:google-realtime-provider-start:v1'
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
     or child_receipt.feature <> 'captions'
     or child_receipt.provider_intent_digest is distinct from
       target_provider_intent_digest
     or child_receipt.nonce_hash is distinct from target_nonce_hash then
    raise exception 'Google Realtime child evidence is unavailable'
      using errcode = 'P7335';
  end if;

  select receipt.*
  into start_receipt
  from private.admin_google_ai_provider_start_receipts as receipt
  where receipt.start_request_id = target_start_request_id;
  if found then
    select intent.* into start_intent
    from private.admin_google_ai_provider_start_intents as intent
    where intent.start_request_id = target_start_request_id;
    select usage.* into usage_row
    from public.ai_usage_ledger as usage
    where usage.id = start_receipt.operation_id;
    select provider_call.* into provider_call_row
    from public.ai_realtime_provider_calls as provider_call
    where provider_call.operation_id = start_receipt.operation_id;
    if start_intent.start_request_id is null
       or usage_row.id is null
       or provider_call_row.operation_id is null
       or start_intent.child_grant_id is distinct from target_grant_id
       or start_intent.environment_id is distinct from child_receipt.environment_id
       or start_intent.principal_id is distinct from child_receipt.principal_id
       or start_intent.membership_id is distinct from child_receipt.membership_id
       or start_intent.admin_session_id is distinct from child_receipt.admin_session_id
       or start_intent.supabase_auth_session_id is distinct from
         child_receipt.supabase_auth_session_id
       or start_intent.lecture_session_id is distinct from target_lecture_session_id
       or start_intent.feature <> 'captions'
       or start_intent.model_id is distinct from target_model_id
       or start_intent.provider_family <> 'openai_realtime_v1'
       or start_intent.provider_intent_digest is distinct from
         target_provider_intent_digest
       or start_intent.start_intent_digest is distinct from start_digest_value
       or start_receipt.child_grant_id is distinct from target_grant_id
       or grant_row.status <> 'consumed'
       or grant_row.operation_ids is distinct from
         array[start_receipt.operation_id]::uuid[]
       or grant_row.nonce_hash is distinct from target_nonce_hash
       or usage_row.lecture_session_id is distinct from target_lecture_session_id
       or usage_row.feature <> 'captions'
       or usage_row.idempotency_key is distinct from target_start_request_id::text
       or usage_row.requested_by_actor is distinct from actor_value
       or usage_row.model_id is distinct from target_model_id
       or usage_row.pricing_unit is distinct from 'audio_minute'
       or usage_row.pricing_rate_microusd is distinct from
         target_price_microusd_per_minute
       or provider_call_row.lecture_session_id is distinct from
         target_lecture_session_id
       or provider_call_row.actor_id is distinct from actor_value
       or provider_call_row.client_request_id is distinct from
         target_start_request_id::text then
      raise exception 'Google Realtime start binding changed on retry'
        using errcode = 'P7335';
    end if;
    return jsonb_build_object(
      'accepted', true,
      'actorId', actor_value,
      'idempotentReplay', true,
      'operationId', usage_row.id,
      'reservedAudioSeconds', usage_row.reserved_audio_seconds,
      'reservedMicrousd', usage_row.reserved_microusd,
      'reservedUntil', usage_row.requested_at
        + usage_row.reserved_audio_seconds * interval '1 second',
      'status', usage_row.status
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
     or identity_gate.google_operational_authorization_enabled is distinct from true
     or ai_gate.google_ai_child_grant_enabled is distinct from true then
    raise exception 'Google Realtime provider start is disabled'
      using errcode = 'P7338';
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
    raise exception 'lecture ownership is unavailable' using errcode = 'P7335';
  end if;

  perform private.serialize_admin_ai_scope_v1(
    'policy-membership',
    (context_value ->> 'membership_id')::uuid
  );
  select policy.* into policy_row
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
     or not array['captions']::text[] <@ policy_row.allowed_actions
     or not array[target_model_id]::text[] <@ policy_row.allowed_models then
    raise exception 'AI policy is unavailable' using errcode = 'P7335';
  end if;

  select lecture.* into lecture_row
  from public.lecture_sessions as lecture
  where lecture.id = target_lecture_session_id
  for update;
  if not found
     or lecture_row.status <> 'open'
     or lecture_row.hard_stop_at is null
     or lecture_row.hard_stop_at <= effective_now then
    raise exception 'lecture is not open' using errcode = 'P7335';
  end if;

  select master.* into master_row
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
     or not array['captions']::text[] <@ master_row.actions then
    raise exception 'Google AI master is unavailable' using errcode = 'P7335';
  end if;

  if grant_row.lecture_session_id is distinct from target_lecture_session_id
     or grant_row.master_authorization_id is distinct from master_row.id
     or grant_row.status <> 'issued'
     or grant_row.expires_at <= effective_now
     or grant_row.actor_id is distinct from actor_value
     or grant_row.actions is distinct from array['captions']::text[]
     or grant_row.nonce_hash is distinct from target_nonce_hash then
    raise exception 'Google Realtime child is unavailable' using errcode = 'P7335';
  end if;

  select control.* into control_row
  from public.lecture_ai_control as control
  where control.lecture_session_id = target_lecture_session_id
  for update;
  if not found then
    raise exception 'AI control is not configured' using errcode = 'P7335';
  end if;

  select
    count(*) filter (where intent.lecture_session_id = target_lecture_session_id),
    count(*) filter (where intent.created_at >= utc_day_start),
    coalesce(sum(usage.reserved_audio_seconds) filter (
      where intent.lecture_session_id = target_lecture_session_id
    ), 0),
    coalesce(sum(usage.reserved_audio_seconds) filter (
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
    lecture_calls, daily_calls, lecture_audio, daily_audio,
    lecture_cost, daily_cost, policy_running
  from private.admin_google_ai_provider_start_intents as intent
  join private.admin_google_ai_provider_start_receipts as receipt
    on receipt.start_request_id = intent.start_request_id
  join public.ai_usage_ledger as usage on usage.id = receipt.operation_id
  where intent.policy_id = policy_row.id
    and intent.policy_version = policy_row.version;

  deadline_seconds := greatest(
    0,
    floor(extract(epoch from lecture_row.hard_stop_at - effective_now))::integer
  );
  control_audio_seconds := greatest(
    0,
    control_row.audio_seconds_limit - control_row.audio_seconds_used
  );
  control_budget_seconds := greatest(
    0,
    least(
      target_requested_audio_seconds::numeric,
      floor(
        greatest(
          0,
          control_row.budget_limit_microusd - control_row.used_microusd
        ) * 60::numeric / target_price_microusd_per_minute
      )
    )::integer
  );
  policy_lecture_seconds := greatest(
    0,
    policy_row.max_realtime_minutes_per_lecture * 60 - lecture_audio
  )::integer;
  policy_daily_seconds := greatest(
    0,
    policy_row.max_realtime_minutes_per_day * 60 - daily_audio
  )::integer;
  reserved_audio_seconds_value := least(
    target_requested_audio_seconds,
    deadline_seconds,
    control_audio_seconds,
    control_budget_seconds,
    policy_lecture_seconds,
    policy_daily_seconds
  );
  reserved_microusd_value := ceil(
    reserved_audio_seconds_value::numeric
      * target_price_microusd_per_minute::numeric / 60
  )::bigint;

  if reserved_audio_seconds_value < 1
     or lecture_calls + 1 > policy_row.max_calls_per_lecture
     or daily_calls + 1 > policy_row.max_calls_per_day
     or lecture_cost + reserved_microusd_value >
       policy_row.max_cost_microusd_per_lecture
     or daily_cost + reserved_microusd_value >
       policy_row.max_cost_microusd_per_day
     or policy_running + 1 > policy_row.max_concurrency then
    raise exception 'Realtime policy usage limit is unavailable'
      using errcode = 'P7335';
  end if;

  update public.lecture_ai_control as control
  set
    status = case when control.active_operation_count > 0 then 'running' else 'ready' end,
    captions_enabled = true,
    stop_requested_at = null,
    stopped_at = null,
    stop_reason = null,
    version = control.version + 1,
    updated_at = effective_now
  where control.lecture_session_id = target_lecture_session_id
  returning * into control_row;

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
    target_supabase_auth_session_id, target_lecture_session_id,
    master_row.id, policy_row.id, policy_row.version, 'captions',
    target_model_id, 'openai_realtime_v1', target_provider_intent_digest,
    start_digest_value, effective_now
  ) returning * into start_intent;

  result_value := private.start_lecture_ai_operation(
    target_lecture_session_id,
    'captions',
    target_start_request_id::text,
    reserved_microusd_value,
    reserved_audio_seconds_value,
    0,
    0,
    actor_value
  );
  if coalesce((result_value ->> 'accepted')::boolean, false) is not true
     or (result_value ->> 'idempotent_replay')::boolean is distinct from false then
    raise exception 'Google Realtime provider start was rejected: %',
      coalesce(result_value ->> 'reason', 'collision')
      using errcode = 'P7335';
  end if;
  operation_id_value := (result_value #>> '{operation,id}')::uuid;

  select usage.* into usage_row
  from public.ai_usage_ledger as usage
  where usage.id = operation_id_value
  for update;
  if not found
     or usage_row.lecture_session_id is distinct from target_lecture_session_id
     or usage_row.feature <> 'captions'
     or usage_row.idempotency_key is distinct from target_start_request_id::text
     or usage_row.requested_by_actor is distinct from actor_value
     or usage_row.status <> 'running'
     or usage_row.reserved_microusd is distinct from reserved_microusd_value
     or usage_row.reserved_audio_seconds is distinct from
       reserved_audio_seconds_value
     or usage_row.reserved_input_tokens is distinct from 0
     or usage_row.reserved_output_tokens is distinct from 0 then
    raise exception 'Google Realtime provider start has no operation receipt'
      using errcode = 'P7335';
  end if;

  update public.ai_usage_ledger as usage
  set
    model_id = target_model_id,
    pricing_unit = 'audio_minute',
    pricing_rate_microusd = target_price_microusd_per_minute,
    last_heartbeat_at = effective_now
  where usage.id = operation_id_value
  returning * into usage_row;

  insert into public.ai_realtime_provider_calls (
    operation_id, lecture_session_id, actor_id, client_request_id, status
  ) values (
    operation_id_value, target_lecture_session_id, actor_value,
    target_start_request_id::text, 'creating'
  ) returning * into provider_call_row;

  update public.ai_billing_grants as grant_record
  set
    status = 'consumed',
    consumed_at = effective_now,
    operation_ids = array[operation_id_value]::uuid[]
  where grant_record.id = target_grant_id
    and grant_record.status = 'issued'
  returning * into grant_row;
  if not found then
    raise exception 'Google Realtime child could not be consumed'
      using errcode = 'P7335';
  end if;

  insert into private.admin_google_ai_provider_start_receipts (
    start_request_id, child_grant_id, operation_id, result_status, started_at
  ) values (
    target_start_request_id, target_grant_id, operation_id_value,
    'started', effective_now
  ) returning * into start_receipt;

  return jsonb_build_object(
    'accepted', true,
    'actorId', actor_value,
    'idempotentReplay', false,
    'operationId', operation_id_value,
    'reservedAudioSeconds', reserved_audio_seconds_value,
    'reservedMicrousd', reserved_microusd_value,
    'reservedUntil', effective_now
      + reserved_audio_seconds_value * interval '1 second',
    'status', 'running'
  );
end;
$$;

revoke all on function private.start_google_admin_realtime_operation_v1(
  text, uuid, uuid, text, text, integer, uuid, text, uuid, text, text, text,
  text, text, bigint, integer, bigint, uuid, text, boolean
) from public, anon, authenticated, service_role;

create function public.start_google_admin_realtime_operation_v1(
  target_token_hash text,
  target_auth_user_id uuid,
  target_supabase_auth_session_id uuid,
  target_google_issuer text,
  target_provider_subject_hmac text,
  target_subject_pepper_version integer,
  target_grant_id uuid,
  target_nonce_hash text,
  target_lecture_session_id uuid,
  target_model_id text,
  target_language text,
  target_delay text,
  target_session_config_sha256 text,
  target_sdp_offer_sha256 text,
  target_price_microusd_per_minute bigint,
  target_requested_audio_seconds integer,
  target_estimated_microusd bigint,
  target_start_request_id uuid,
  target_provider_intent_digest text,
  target_transport_enabled boolean
)
returns jsonb
language sql
volatile
security definer
set search_path = ''
as $$
  select private.start_google_admin_realtime_operation_v1(
    target_token_hash,
    target_auth_user_id,
    target_supabase_auth_session_id,
    target_google_issuer,
    target_provider_subject_hmac,
    target_subject_pepper_version,
    target_grant_id,
    target_nonce_hash,
    target_lecture_session_id,
    target_model_id,
    target_language,
    target_delay,
    target_session_config_sha256,
    target_sdp_offer_sha256,
    target_price_microusd_per_minute,
    target_requested_audio_seconds,
    target_estimated_microusd,
    target_start_request_id,
    target_provider_intent_digest,
    target_transport_enabled
  );
$$;

revoke all on function public.start_google_admin_realtime_operation_v1(
  text, uuid, uuid, text, text, integer, uuid, text, uuid, text, text, text,
  text, text, bigint, integer, bigint, uuid, text, boolean
) from public, anon, authenticated;
grant execute on function public.start_google_admin_realtime_operation_v1(
  text, uuid, uuid, text, text, integer, uuid, text, uuid, text, text, text,
  text, text, bigint, integer, bigint, uuid, text, boolean
) to service_role;

-- Phase 4 predated exact accounting settlement. Keep its stable signature for
-- legacy callers, but route every terminal Realtime path through the current
-- exactly-once usage settlement contract.
create or replace function private.finish_realtime_caption_operation(
  target_operation_id uuid,
  target_actor_id text,
  target_reason text,
  charge_elapsed boolean,
  disable_feature boolean
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  start_receipt private.admin_google_ai_provider_start_receipts%rowtype;
  dispatch_receipt private.admin_google_ai_provider_dispatch_receipts%rowtype;
  creation_receipt private.admin_google_realtime_provider_creation_receipts%rowtype;
  usage_snapshot public.ai_usage_ledger%rowtype;
  usage_row public.ai_usage_ledger%rowtype;
  lecture_row public.lecture_sessions%rowtype;
  control_row public.lecture_ai_control%rowtype;
  provider_call_row public.ai_realtime_provider_calls%rowtype;
  settlement jsonb;
  actual_audio integer := 0;
  actual_cost bigint := 0;
  deleted_caption boolean := false;
  effective_error text := nullif(trim(coalesce(target_reason, '')), '');
  settlement_error text;
begin
  if target_operation_id is null
     or nullif(trim(coalesce(target_actor_id, '')), '') is null
     or effective_error is null
     or char_length(effective_error) > 120 then
    raise exception 'invalid Realtime settlement request'
      using errcode = '22023';
  end if;

  select usage.* into usage_snapshot
  from public.ai_usage_ledger as usage
  where usage.id = target_operation_id;
  if not found
     or usage_snapshot.feature <> 'captions'
     or usage_snapshot.requested_by_actor is distinct from target_actor_id then
    raise exception 'Realtime operation is not available'
      using errcode = '42501';
  end if;

  perform private.close_lecture_if_expired(usage_snapshot.lecture_session_id);
  select lecture.* into lecture_row
  from public.lecture_sessions as lecture
  where lecture.id = usage_snapshot.lecture_session_id
  for update;
  select control.* into control_row
  from public.lecture_ai_control as control
  where control.lecture_session_id = usage_snapshot.lecture_session_id
  for update;
  select usage.* into usage_snapshot
  from public.ai_usage_ledger as usage
  where usage.id = target_operation_id
  for update;
  if lecture_row.id is null
     or control_row.lecture_session_id is null
     or usage_snapshot.id is null
     or usage_snapshot.feature <> 'captions'
     or usage_snapshot.requested_by_actor is distinct from target_actor_id then
    raise exception 'Realtime operation changed during settlement'
      using errcode = 'P7335';
  end if;

  settlement_error := effective_error;
  select receipt.* into start_receipt
  from private.admin_google_ai_provider_start_receipts as receipt
  join private.admin_google_ai_provider_start_intents as intent
    on intent.start_request_id = receipt.start_request_id
  where receipt.operation_id = target_operation_id
    and intent.feature = 'captions'
    and intent.provider_family = 'openai_realtime_v1';
  if found then
    select receipt.* into dispatch_receipt
    from private.admin_google_ai_provider_dispatch_receipts as receipt
    where receipt.start_request_id = start_receipt.start_request_id
      and receipt.operation_id = target_operation_id;
    select receipt.* into creation_receipt
    from private.admin_google_realtime_provider_creation_receipts as receipt
    where receipt.start_request_id = start_receipt.start_request_id
      and receipt.operation_id = target_operation_id;
    select provider_call.* into provider_call_row
    from public.ai_realtime_provider_calls as provider_call
    where provider_call.operation_id = target_operation_id
    for update;
    if provider_call_row.operation_id is null
       or provider_call_row.lecture_session_id is distinct from
         usage_snapshot.lecture_session_id
       or provider_call_row.actor_id is distinct from target_actor_id
       or provider_call_row.client_request_id is distinct from
         start_receipt.start_request_id::text then
      raise exception 'Realtime provider settlement binding changed'
        using errcode = 'P7335';
    end if;

    if dispatch_receipt.start_request_id is null
       or creation_receipt.outcome = 'creation_failed' then
      actual_audio := 0;
      actual_cost := 0;
      settlement_error := coalesce(creation_receipt.error_code, effective_error);
    elsif creation_receipt.outcome = 'activated' then
      actual_audio := least(
        usage_snapshot.reserved_audio_seconds,
        greatest(
          0,
          ceil(extract(
            epoch from coalesce(
              usage_snapshot.finished_at,
              statement_timestamp()
            ) - usage_snapshot.requested_at
          ))::integer
        )
      );
      actual_cost := least(
        usage_snapshot.reserved_microusd,
        ceil(
          actual_audio::numeric
            * coalesce(usage_snapshot.pricing_rate_microusd, 0)::numeric / 60
        )::bigint
      );
    else
      -- A provider request may have crossed the network after its immutable
      -- dispatch claim but before the activation response was recorded.
      actual_audio := usage_snapshot.reserved_audio_seconds;
      actual_cost := usage_snapshot.reserved_microusd;
      settlement_error := 'realtime_stop_after_dispatch_ambiguous';
    end if;
  elsif charge_elapsed then
    actual_audio := least(
      usage_snapshot.reserved_audio_seconds,
      greatest(
        0,
        ceil(extract(
          epoch from coalesce(
            usage_snapshot.finished_at,
            statement_timestamp()
          ) - usage_snapshot.requested_at
        ))::integer
      )
    );
    actual_cost := least(
      usage_snapshot.reserved_microusd,
      ceil(
        actual_audio::numeric
          * coalesce(usage_snapshot.pricing_rate_microusd, 0)::numeric / 60
      )::bigint
    );
  end if;

  settlement := private.finish_lecture_ai_operation(
    target_operation_id,
    'cancelled',
    actual_cost,
    actual_audio,
    0,
    0,
    usage_snapshot.provider_request_id,
    settlement_error
  );

  select usage.* into usage_row
  from public.ai_usage_ledger as usage
  where usage.id = target_operation_id;
  if not found or usage_row.accounting_settled_at is null then
    raise exception 'Realtime accounting was not settled'
      using errcode = 'P7335';
  end if;

  if disable_feature then
    update public.lecture_ai_control as control
    set
      captions_enabled = false,
      status = case
        when control.active_operation_count > 0 then 'running'
        when control.summaries_enabled
          or control.material_analysis_enabled
          or control.poll_suggestions_enabled
          or control.academic_answers_enabled then 'ready'
        else 'stopped'
      end,
      stop_requested_at = case
        when control.active_operation_count = 0
          and not control.summaries_enabled
          and not control.material_analysis_enabled
          and not control.poll_suggestions_enabled
          and not control.academic_answers_enabled
          then coalesce(control.stop_requested_at, statement_timestamp())
        else control.stop_requested_at
      end,
      stopped_at = case
        when control.active_operation_count = 0
          and not control.summaries_enabled
          and not control.material_analysis_enabled
          and not control.poll_suggestions_enabled
          and not control.academic_answers_enabled
          then coalesce(control.stopped_at, statement_timestamp())
        else control.stopped_at
      end,
      stop_reason = case
        when control.active_operation_count = 0
          and not control.summaries_enabled
          and not control.material_analysis_enabled
          and not control.poll_suggestions_enabled
          and not control.academic_answers_enabled
          then effective_error
        else control.stop_reason
      end,
      version = control.version + 1,
      updated_at = statement_timestamp()
    where control.lecture_session_id = usage_row.lecture_session_id;

    delete from public.lecture_public_captions
    where lecture_session_id = usage_row.lecture_session_id;
    deleted_caption := found;
    if deleted_caption then
      perform private.bump_lecture_live_state(
        usage_row.lecture_session_id,
        'caption'
      );
    end if;
  end if;

  return jsonb_build_object(
    'accepted', true,
    'idempotent_replay',
      coalesce((settlement ->> 'idempotent_replay')::boolean, false),
    'operation', to_jsonb(usage_row)
  );
end;
$$;

revoke all on function private.finish_realtime_caption_operation(
  uuid, text, text, boolean, boolean
) from public, anon, authenticated;
-- The Phase 4 compatibility facade is SECURITY INVOKER. Keep this narrowly
-- scoped grant until the transactional Phase E legacy tombstone replaces it.
grant execute on function private.finish_realtime_caption_operation(
  uuid, text, text, boolean, boolean
) to service_role;

create function private.finalize_google_admin_realtime_provider_v1(
  target_token_hash text,
  target_auth_user_id uuid,
  target_supabase_auth_session_id uuid,
  target_google_issuer text,
  target_provider_subject_hmac text,
  target_subject_pepper_version integer,
  target_start_request_id uuid,
  target_operation_id uuid,
  target_client_request_id uuid,
  target_outcome text,
  target_provider_call_id text,
  target_provider_request_id text,
  target_error_code text,
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
  start_intent private.admin_google_ai_provider_start_intents%rowtype;
  start_receipt private.admin_google_ai_provider_start_receipts%rowtype;
  child_receipt private.admin_google_ai_child_grant_receipts%rowtype;
  dispatch_receipt private.admin_google_ai_provider_dispatch_receipts%rowtype;
  creation_receipt private.admin_google_realtime_provider_creation_receipts%rowtype;
  principal_row private.admin_principals%rowtype;
  context_value jsonb;
  identity_gate private.admin_identity_runtime_gate%rowtype;
  ai_gate private.admin_ai_unlock_runtime_gate%rowtype;
  ownership_row private.admin_lecture_ownerships%rowtype;
  policy_row private.admin_ai_policies%rowtype;
  lecture_row public.lecture_sessions%rowtype;
  master_row public.lecture_ai_master_authorizations%rowtype;
  control_row public.lecture_ai_control%rowtype;
  usage_row public.ai_usage_ledger%rowtype;
  provider_call_row public.ai_realtime_provider_calls%rowtype;
  settlement jsonb;
  actor_value text;
  effective_outcome text := target_outcome;
  effective_error text := nullif(trim(coalesce(target_error_code, '')), '');
  canonical_call_id text := nullif(trim(coalesce(target_provider_call_id, '')), '');
  canonical_provider_request_id text :=
    nullif(trim(coalesce(target_provider_request_id, '')), '');
  live_authority boolean := false;
  should_hangup boolean := false;
  reconcile_activated_response_loss boolean := false;
  effective_now timestamptz := statement_timestamp();
begin
  if target_start_request_id is null
     or target_operation_id is null
     or target_client_request_id is null
     or target_outcome not in (
       'activated', 'creation_failed', 'creation_uncertain'
     )
     or target_transport_enabled is null
     or target_google_issuer is distinct from 'https://accounts.google.com'
     or target_provider_subject_hmac is null
     or target_provider_subject_hmac !~ '^[0-9a-f]{64}$'
     or target_subject_pepper_version is null
     or target_subject_pepper_version < 1
     or char_length(coalesce(canonical_provider_request_id, '')) > 200
     or (
       canonical_call_id is not null
       and (
         char_length(canonical_call_id) not between 3 and 200
         or canonical_call_id !~ '^[A-Za-z0-9_-]+$'
       )
     )
     or (
       target_outcome = 'activated'
       and (canonical_call_id is null or effective_error is not null)
     )
     or (
       target_outcome = 'creation_failed'
       and (canonical_call_id is not null or effective_error is null)
     )
     or (
       target_outcome = 'creation_uncertain'
       and effective_error is null
     )
     or char_length(coalesce(effective_error, '')) > 120
     or (
       effective_error is not null
       and effective_error !~ '^[A-Za-z0-9:_-]+$'
     ) then
    raise exception 'invalid Google Realtime provider finalization'
      using errcode = '22023';
  end if;

  perform private.serialize_admin_ai_request_v1(target_start_request_id);

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
  if start_intent.start_request_id is null
     or start_receipt.start_request_id is null
     or child_receipt.request_id is null
     or dispatch_receipt.start_request_id is null
     or start_intent.feature <> 'captions'
     or start_intent.provider_family <> 'openai_realtime_v1'
     or start_receipt.operation_id is distinct from target_operation_id
     or dispatch_receipt.operation_id is distinct from target_operation_id
     or dispatch_receipt.client_request_id is distinct from
       target_client_request_id
     or child_receipt.lecture_session_id is distinct from
       start_intent.lecture_session_id
     or child_receipt.master_authorization_id is distinct from
       start_intent.master_authorization_id
     or child_receipt.policy_id is distinct from start_intent.policy_id
     or child_receipt.policy_version is distinct from start_intent.policy_version
     or child_receipt.admin_session_id is distinct from
       start_intent.admin_session_id
     or child_receipt.supabase_auth_session_id is distinct from
       start_intent.supabase_auth_session_id
     or child_receipt.auth_user_id is distinct from target_auth_user_id
     or target_supabase_auth_session_id is distinct from
       start_intent.supabase_auth_session_id then
    raise exception 'Google Realtime provider evidence is unavailable'
      using errcode = 'P7335';
  end if;

  select principal.* into principal_row
  from private.admin_principals as principal
  where principal.id = start_intent.principal_id;
  if not found
     or principal_row.auth_user_id is distinct from target_auth_user_id
     or principal_row.google_issuer is distinct from target_google_issuer
     or principal_row.provider_subject_hmac is distinct from
       target_provider_subject_hmac
     or principal_row.subject_pepper_version is distinct from
       target_subject_pepper_version then
    raise exception 'Google Realtime provider identity binding changed'
      using errcode = 'P7335';
  end if;

  select receipt.* into creation_receipt
  from private.admin_google_realtime_provider_creation_receipts as receipt
  where receipt.start_request_id = target_start_request_id;
  if found then
    if creation_receipt.operation_id is distinct from target_operation_id
       or creation_receipt.client_request_id is distinct from
         target_client_request_id
       or creation_receipt.provider_call_id is distinct from canonical_call_id
       or creation_receipt.provider_request_id is distinct from
         canonical_provider_request_id then
      raise exception 'Google Realtime finalization binding changed on retry'
        using errcode = 'P7335';
    end if;
    if creation_receipt.outcome = 'activated'
       and target_outcome = 'creation_uncertain'
       and effective_error like '%ambiguous%' then
      -- The activation transaction may have committed while both Edge RPC
      -- responses were lost. Preserve the immutable fact that the call was
      -- activated, but continue through the canonical terminal locks so the
      -- paid reservation and durable hangup outbox cannot remain orphaned.
      reconcile_activated_response_loss := true;
    elsif (
      creation_receipt.outcome = target_outcome
      and (
        target_outcome = 'activated'
        or creation_receipt.error_code is not distinct from effective_error
      )
    ) or (
      target_outcome = 'activated'
      and creation_receipt.outcome = 'creation_uncertain'
    ) then
      return jsonb_build_object(
        'accepted', creation_receipt.outcome = 'activated',
        'idempotentReplay', true,
        'outcome', creation_receipt.outcome,
        'shouldHangup', creation_receipt.outcome <> 'activated'
          and creation_receipt.provider_call_id is not null,
        'status', case when creation_receipt.outcome = 'activated'
          then 'active' else 'terminal' end
      );
    else
      raise exception 'Google Realtime finalization binding changed on retry'
        using errcode = 'P7335';
    end if;
  end if;

  actor_value := 'admin-session:' || start_intent.admin_session_id::text;
  if target_outcome = 'activated' then
    context_value := private.require_google_ai_provider_context_v1(
      target_token_hash,
      target_auth_user_id,
      target_supabase_auth_session_id,
      target_google_issuer,
      target_provider_subject_hmac,
      target_subject_pepper_version
    );
    live_authority := context_value is not null
      and (context_value ->> 'environment_id')::uuid = start_intent.environment_id
      and (context_value ->> 'principal_id')::uuid = start_intent.principal_id
      and (context_value ->> 'membership_id')::uuid = start_intent.membership_id
      and (context_value ->> 'admin_session_id')::uuid =
        start_intent.admin_session_id;
  end if;

  select gate.* into identity_gate
  from private.admin_identity_runtime_gate as gate
  where gate.singleton
  for share;
  select gate.* into ai_gate
  from private.admin_ai_unlock_runtime_gate as gate
  where gate.singleton
  for share;
  live_authority := live_authority
    and target_transport_enabled
    and identity_gate.google_operational_authorization_enabled
    and ai_gate.google_ai_child_grant_enabled;

  select ownership.* into ownership_row
  from private.admin_lecture_ownerships as ownership
  where ownership.lecture_session_id = start_intent.lecture_session_id;
  live_authority := live_authority
    and ownership_row.environment_id is not distinct from start_intent.environment_id
    and ownership_row.principal_id is not distinct from start_intent.principal_id
    and ownership_row.membership_id is not distinct from start_intent.membership_id;

  perform private.serialize_admin_ai_scope_v1(
    'policy-membership', start_intent.membership_id
  );
  select policy.* into policy_row
  from private.admin_ai_policies as policy
  where policy.id = start_intent.policy_id
    and policy.version = start_intent.policy_version
  for update;
  live_authority := live_authority
    and policy_row.id is not null
    and policy_row.status = 'active'
    and policy_row.valid_from <= effective_now
    and policy_row.valid_until > effective_now
    and array['captions']::text[] <@ policy_row.allowed_actions
    and array[start_intent.model_id]::text[] <@ policy_row.allowed_models;

  select lecture.* into lecture_row
  from public.lecture_sessions as lecture
  where lecture.id = start_intent.lecture_session_id
  for update;
  live_authority := live_authority
    and lecture_row.id is not null
    and lecture_row.status = 'open'
    and lecture_row.hard_stop_at > effective_now;

  select master.* into master_row
  from public.lecture_ai_master_authorizations as master
  where master.id = start_intent.master_authorization_id
    and master.lecture_session_id = start_intent.lecture_session_id
  for update;
  live_authority := live_authority
    and master_row.id is not null
    and master_row.status = 'active'
    and master_row.expires_at > effective_now
    and master_row.principal_id is not distinct from start_intent.principal_id
    and master_row.membership_id is not distinct from start_intent.membership_id
    and master_row.issuing_admin_session_id is not distinct from
      start_intent.admin_session_id
    and master_row.actor_id is not distinct from actor_value
    and master_row.ai_policy_id is not distinct from start_intent.policy_id
    and master_row.ai_policy_version is not distinct from
      start_intent.policy_version
    and array['captions']::text[] <@ master_row.actions;

  select control.* into control_row
  from public.lecture_ai_control as control
  where control.lecture_session_id = start_intent.lecture_session_id
  for update;
  live_authority := live_authority
    and control_row.lecture_session_id is not null
    and control_row.status in ('ready', 'running')
    and control_row.captions_enabled
    and control_row.stop_requested_at is null;

  select usage.* into usage_row
  from public.ai_usage_ledger as usage
  where usage.id = target_operation_id
  for update;
  live_authority := live_authority
    and usage_row.id is not null
    and usage_row.lecture_session_id is not distinct from
      start_intent.lecture_session_id
    and usage_row.feature = 'captions'
    and usage_row.requested_by_actor is not distinct from actor_value
    and usage_row.idempotency_key is not distinct from
      target_start_request_id::text
    and usage_row.status = 'running'
    and usage_row.accounting_settled_at is null
    and usage_row.provider_dispatched_at is not null
    and usage_row.provider_request_id is not distinct from
      target_client_request_id::text;

  select provider_call.* into provider_call_row
  from public.ai_realtime_provider_calls as provider_call
  where provider_call.operation_id = target_operation_id
  for update;
  if provider_call_row.operation_id is null
     or provider_call_row.lecture_session_id is distinct from
       start_intent.lecture_session_id
     or provider_call_row.actor_id is distinct from actor_value
     or provider_call_row.client_request_id is distinct from
       target_client_request_id::text
     or (
       not reconcile_activated_response_loss
       and provider_call_row.provider_call_id is not null
     )
     or (
       reconcile_activated_response_loss
       and provider_call_row.provider_call_id is distinct from canonical_call_id
     ) then
    raise exception 'Realtime provider call binding is unavailable'
      using errcode = 'P7335';
  end if;

  if target_outcome = 'activated' and live_authority is not true then
    effective_outcome := 'creation_uncertain';
    effective_error := 'authority_revoked_after_provider_dispatch_ambiguous';
  end if;
  should_hangup := effective_outcome <> 'activated'
    and canonical_call_id is not null;

  if not reconcile_activated_response_loss then
    insert into private.admin_google_realtime_provider_creation_receipts (
      start_request_id, operation_id, client_request_id, outcome,
      provider_call_id, provider_request_id, error_code, created_at
    ) values (
      target_start_request_id, target_operation_id, target_client_request_id,
      effective_outcome, canonical_call_id, canonical_provider_request_id,
      effective_error, effective_now
    ) returning * into creation_receipt;
  end if;

  update public.ai_realtime_provider_calls as provider_call
  set
    provider_call_id = canonical_call_id,
    provider_request_id = canonical_provider_request_id,
    status = case
      when effective_outcome = 'activated' then 'active'
      when canonical_call_id is not null then 'stop_requested'
      else 'creation_failed'
    end,
    creation_outcome_uncertain = effective_outcome = 'creation_uncertain',
    uncertainty_recorded_at = case
      when effective_outcome = 'creation_uncertain' then effective_now
      else null
    end,
    activated_at = case
      when effective_outcome = 'activated' then effective_now
      else provider_call.activated_at
    end,
    stop_requested_at = case
      when effective_outcome <> 'activated' and canonical_call_id is not null
        then effective_now
      else provider_call.stop_requested_at
    end,
    stop_reason = case
      when effective_outcome <> 'activated' then left(effective_error, 120)
      else null
    end,
    next_attempt_at = effective_now,
    lease_until = null,
    last_error = case when effective_outcome <> 'activated'
      then effective_error else null end,
    updated_at = effective_now
  where provider_call.operation_id = target_operation_id
  returning * into provider_call_row;

  if effective_outcome <> 'activated' then
    settlement := private.finish_lecture_ai_operation(
      target_operation_id,
      'cancelled',
      case when effective_outcome = 'creation_uncertain'
        then usage_row.reserved_microusd else 0 end,
      case when effective_outcome = 'creation_uncertain'
        then usage_row.reserved_audio_seconds else 0 end,
      0,
      0,
      coalesce(
        canonical_provider_request_id,
        target_client_request_id::text
      ),
      case
        when effective_outcome = 'creation_uncertain'
          and effective_error like '%ambiguous%'
          then effective_error
        when effective_outcome = 'creation_uncertain'
          then left(effective_error, 110) || '_ambiguous'
        else effective_error
      end
    );
  end if;

  return jsonb_build_object(
    'accepted', effective_outcome = 'activated',
    'idempotentReplay', reconcile_activated_response_loss,
    'outcome', effective_outcome,
    'shouldHangup', should_hangup,
    'status', provider_call_row.status
  );
end;
$$;

revoke all on function private.finalize_google_admin_realtime_provider_v1(
  text, uuid, uuid, text, text, integer, uuid, uuid, uuid, text, text, text,
  text, boolean
) from public, anon, authenticated, service_role;

create function public.activate_google_admin_realtime_provider_v1(
  target_token_hash text,
  target_auth_user_id uuid,
  target_supabase_auth_session_id uuid,
  target_google_issuer text,
  target_provider_subject_hmac text,
  target_subject_pepper_version integer,
  target_start_request_id uuid,
  target_operation_id uuid,
  target_client_request_id uuid,
  target_provider_call_id text,
  target_provider_request_id text,
  target_transport_enabled boolean
)
returns jsonb
language sql
volatile
security definer
set search_path = ''
as $$
  select private.finalize_google_admin_realtime_provider_v1(
    target_token_hash,
    target_auth_user_id,
    target_supabase_auth_session_id,
    target_google_issuer,
    target_provider_subject_hmac,
    target_subject_pepper_version,
    target_start_request_id,
    target_operation_id,
    target_client_request_id,
    'activated',
    target_provider_call_id,
    target_provider_request_id,
    null,
    target_transport_enabled
  );
$$;

revoke all on function public.activate_google_admin_realtime_provider_v1(
  text, uuid, uuid, text, text, integer, uuid, uuid, uuid, text, text, boolean
) from public, anon, authenticated;
grant execute on function public.activate_google_admin_realtime_provider_v1(
  text, uuid, uuid, text, text, integer, uuid, uuid, uuid, text, text, boolean
) to service_role;

create function public.fail_google_admin_realtime_provider_v1(
  target_token_hash text,
  target_auth_user_id uuid,
  target_supabase_auth_session_id uuid,
  target_google_issuer text,
  target_provider_subject_hmac text,
  target_subject_pepper_version integer,
  target_start_request_id uuid,
  target_operation_id uuid,
  target_client_request_id uuid,
  target_outcome text,
  target_provider_call_id text,
  target_provider_request_id text,
  target_error_code text,
  target_transport_enabled boolean
)
returns jsonb
language sql
volatile
security definer
set search_path = ''
as $$
  select private.finalize_google_admin_realtime_provider_v1(
    target_token_hash,
    target_auth_user_id,
    target_supabase_auth_session_id,
    target_google_issuer,
    target_provider_subject_hmac,
    target_subject_pepper_version,
    target_start_request_id,
    target_operation_id,
    target_client_request_id,
    target_outcome,
    target_provider_call_id,
    target_provider_request_id,
    target_error_code,
    target_transport_enabled
  );
$$;

revoke all on function public.fail_google_admin_realtime_provider_v1(
  text, uuid, uuid, text, text, integer, uuid, uuid, uuid, text, text, text,
  text, boolean
) from public, anon, authenticated;
grant execute on function public.fail_google_admin_realtime_provider_v1(
  text, uuid, uuid, text, text, integer, uuid, uuid, uuid, text, text, text,
  text, boolean
) to service_role;

create function private.publish_google_admin_caption_window_v1(
  target_token_hash text,
  target_auth_user_id uuid,
  target_supabase_auth_session_id uuid,
  target_google_issuer text,
  target_provider_subject_hmac text,
  target_subject_pepper_version integer,
  target_start_request_id uuid,
  target_operation_id uuid,
  target_request_id uuid,
  target_lecture_session_id uuid,
  target_text text,
  target_language text,
  target_last_item_id text,
  target_sequence bigint,
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
  context_value jsonb;
  child_receipt private.admin_google_ai_child_grant_receipts%rowtype;
  start_intent private.admin_google_ai_provider_start_intents%rowtype;
  start_receipt private.admin_google_ai_provider_start_receipts%rowtype;
  dispatch_receipt private.admin_google_ai_provider_dispatch_receipts%rowtype;
  creation_receipt private.admin_google_realtime_provider_creation_receipts%rowtype;
  receipt_row private.admin_google_operation_receipts%rowtype;
  identity_gate private.admin_identity_runtime_gate%rowtype;
  ai_gate private.admin_ai_unlock_runtime_gate%rowtype;
  ownership_row private.admin_lecture_ownerships%rowtype;
  policy_row private.admin_ai_policies%rowtype;
  lecture_row public.lecture_sessions%rowtype;
  master_row public.lecture_ai_master_authorizations%rowtype;
  control_row public.lecture_ai_control%rowtype;
  usage_row public.ai_usage_ledger%rowtype;
  provider_call_row public.ai_realtime_provider_calls%rowtype;
  result_value jsonb;
  payload_digest_value text;
  intent_digest_value text;
  result_metadata_value jsonb;
  actor_value text;
  live_authority boolean := true;
  effective_now timestamptz := statement_timestamp();
begin
  if target_start_request_id is null
     or target_operation_id is null
     or target_request_id is null
     or target_lecture_session_id is null
     or target_text is null
     or char_length(trim(target_text)) not between 1 and 1000
     or target_language is null
     or target_language not in ('auto', 'en', 'ja', 'mixed', 'und')
     or target_last_item_id is null
     or char_length(target_last_item_id) not between 1 and 200
     or target_sequence is null
     or target_sequence < 0
     or target_transport_enabled is null then
    raise exception 'invalid Google caption window'
      using errcode = '22023';
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

  payload_digest_value := pg_catalog.encode(
    extensions.digest(
      pg_catalog.convert_to(
        'compass:phase7.30c2:google-caption-window:v1'
        || '|start=' || target_start_request_id::text
        || '|operation=' || target_operation_id::text
        || '|lecture=' || target_lecture_session_id::text
        || '|text_sha256=' || pg_catalog.encode(
          extensions.digest(pg_catalog.convert_to(trim(target_text), 'UTF8'), 'sha256'),
          'hex'
        )
        || '|language=' || target_language
        || '|last_item=' || target_last_item_id
        || '|sequence=' || target_sequence::text,
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );
  intent_digest_value := private.google_admin_operation_intent_digest_v1(
    target_request_id,
    (context_value ->> 'admin_session_id')::uuid,
    'publish-caption-window.publish',
    target_lecture_session_id,
    target_operation_id::text,
    payload_digest_value
  );
  if intent_digest_value is null then
    return null;
  end if;

  select receipt.* into receipt_row
  from private.admin_google_operation_receipts as receipt
  where receipt.request_id = target_request_id;
  if found then
    if receipt_row.operation_key <> 'publish-caption-window.publish'
       or receipt_row.intent_digest is distinct from intent_digest_value
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
       or receipt_row.lecture_session_id is distinct from
         target_lecture_session_id
       or receipt_row.target_id is distinct from target_operation_id::text then
      raise exception 'Google caption request binding changed on retry'
        using errcode = 'P7335';
    end if;
    return jsonb_build_object(
      'accepted', receipt_row.result_status = 'published',
      'idempotentReplay', true,
      'metadata', receipt_row.result_metadata,
      'status', receipt_row.result_status
    );
  end if;

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
     or start_intent.lecture_session_id is distinct from
       target_lecture_session_id
     or start_receipt.operation_id is distinct from target_operation_id
     or dispatch_receipt.operation_id is distinct from target_operation_id
     or dispatch_receipt.client_request_id is distinct from
       target_start_request_id
     or creation_receipt.operation_id is distinct from target_operation_id
     or creation_receipt.client_request_id is distinct from
       target_start_request_id
     or creation_receipt.outcome <> 'activated'
     or child_receipt.admin_session_id is distinct from
       (context_value ->> 'admin_session_id')::uuid
     or child_receipt.supabase_auth_session_id is distinct from
       target_supabase_auth_session_id
     or child_receipt.auth_user_id is distinct from target_auth_user_id then
    raise exception 'Google Realtime publication evidence is unavailable'
      using errcode = 'P7335';
  end if;

  select gate.* into identity_gate
  from private.admin_identity_runtime_gate as gate
  where gate.singleton
  for share;
  select gate.* into ai_gate
  from private.admin_ai_unlock_runtime_gate as gate
  where gate.singleton
  for share;
  live_authority := live_authority
    and target_transport_enabled
    and coalesce(identity_gate.google_operational_authorization_enabled, false)
    and coalesce(ai_gate.google_ai_child_grant_enabled, false);

  select ownership.* into ownership_row
  from private.admin_lecture_ownerships as ownership
  where ownership.lecture_session_id = target_lecture_session_id;
  live_authority := live_authority
    and ownership_row.environment_id is not distinct from
      (context_value ->> 'environment_id')::uuid
    and ownership_row.principal_id is not distinct from
      (context_value ->> 'principal_id')::uuid
    and ownership_row.membership_id is not distinct from
      (context_value ->> 'membership_id')::uuid;

  perform private.serialize_admin_ai_scope_v1(
    'policy-membership', start_intent.membership_id
  );
  select policy.* into policy_row
  from private.admin_ai_policies as policy
  where policy.id = start_intent.policy_id
    and policy.version = start_intent.policy_version
  for update;
  live_authority := live_authority
    and policy_row.id is not null
    and policy_row.status = 'active'
    and policy_row.valid_from <= effective_now
    and policy_row.valid_until > effective_now
    and array['captions']::text[] <@ policy_row.allowed_actions
    and array[start_intent.model_id]::text[] <@ policy_row.allowed_models;

  select lecture.* into lecture_row
  from public.lecture_sessions as lecture
  where lecture.id = target_lecture_session_id
  for update;
  live_authority := live_authority
    and lecture_row.id is not null
    and lecture_row.status = 'open'
    and lecture_row.hard_stop_at > effective_now;

  select master.* into master_row
  from public.lecture_ai_master_authorizations as master
  where master.id = start_intent.master_authorization_id
    and master.lecture_session_id = target_lecture_session_id
  for update;
  live_authority := live_authority
    and master_row.id is not null
    and master_row.status = 'active'
    and master_row.expires_at > effective_now
    and master_row.principal_id is not distinct from start_intent.principal_id
    and master_row.membership_id is not distinct from start_intent.membership_id
    and master_row.issuing_admin_session_id is not distinct from
      start_intent.admin_session_id
    and master_row.actor_id is not distinct from actor_value
    and master_row.ai_policy_id is not distinct from start_intent.policy_id
    and master_row.ai_policy_version is not distinct from
      start_intent.policy_version
    and array['captions']::text[] <@ master_row.actions;

  select control.* into control_row
  from public.lecture_ai_control as control
  where control.lecture_session_id = target_lecture_session_id
  for update;
  live_authority := live_authority
    and control_row.lecture_session_id is not null
    and control_row.status in ('ready', 'running')
    and control_row.captions_enabled
    and control_row.stop_requested_at is null;

  select usage.* into usage_row
  from public.ai_usage_ledger as usage
  where usage.id = target_operation_id
  for update;
  live_authority := live_authority
    and usage_row.id is not null
    and usage_row.lecture_session_id is not distinct from target_lecture_session_id
    and usage_row.feature = 'captions'
    and usage_row.requested_by_actor is not distinct from actor_value
    and usage_row.status = 'running'
    and usage_row.accounting_settled_at is null
    and usage_row.provider_dispatched_at is not null
    and usage_row.provider_request_id is not distinct from
      dispatch_receipt.client_request_id::text;

  select provider_call.* into provider_call_row
  from public.ai_realtime_provider_calls as provider_call
  where provider_call.operation_id = target_operation_id
  for update;
  live_authority := live_authority
    and provider_call_row.operation_id is not null
    and provider_call_row.lecture_session_id is not distinct from
      target_lecture_session_id
    and provider_call_row.actor_id is not distinct from actor_value
    and provider_call_row.client_request_id is not distinct from
      target_start_request_id::text
    and provider_call_row.provider_call_id is not distinct from
      creation_receipt.provider_call_id
    and provider_call_row.status = 'active';

  if live_authority is true then
    result_value := private.publish_lecture_caption(
      target_lecture_session_id,
      target_operation_id,
      target_text,
      target_language,
      target_last_item_id,
      target_sequence,
      actor_value
    );
  else
    result_value := jsonb_build_object(
      'accepted', false,
      'changed', false,
      'reason', 'authority_revoked',
      'sequence', target_sequence,
      'should_stop', true,
      'updated_at', effective_now
    );
  end if;

  result_metadata_value := jsonb_strip_nulls(jsonb_build_object(
    'changed', coalesce((result_value ->> 'changed')::boolean, false),
    'reason', result_value ->> 'reason',
    'reservedUntil', result_value ->> 'reserved_until',
    'sequence', coalesce((result_value ->> 'sequence')::bigint, target_sequence),
    'shouldStop', live_authority is not true
      or (result_value ->> 'reason') in (
        'authority_revoked', 'selected_duration_elapsed'
      ),
    'updatedAt', result_value ->> 'updated_at'
  ));

  insert into private.admin_google_operation_receipts (
    request_id, operation_key, intent_digest, environment_id, principal_id,
    membership_id, admin_session_id, supabase_auth_session_id,
    lecture_session_id, target_id, result_id, result_status,
    result_metadata, created_at
  ) values (
    target_request_id, 'publish-caption-window.publish', intent_digest_value,
    (context_value ->> 'environment_id')::uuid,
    (context_value ->> 'principal_id')::uuid,
    (context_value ->> 'membership_id')::uuid,
    (context_value ->> 'admin_session_id')::uuid,
    target_supabase_auth_session_id, target_lecture_session_id,
    target_operation_id::text, target_operation_id::text,
    case
      when coalesce((result_value ->> 'accepted')::boolean, false)
        then 'published'
      when live_authority is not true
        or (result_value ->> 'reason') = 'selected_duration_elapsed'
        then 'stopped'
      else 'ignored'
    end,
    result_metadata_value, effective_now
  ) returning * into receipt_row;

  return jsonb_build_object(
    'accepted', receipt_row.result_status = 'published',
    'idempotentReplay', false,
    'metadata', receipt_row.result_metadata,
    'status', receipt_row.result_status
  );
end;
$$;

revoke all on function private.publish_google_admin_caption_window_v1(
  text, uuid, uuid, text, text, integer, uuid, uuid, uuid, uuid, text, text,
  text, bigint, boolean
) from public, anon, authenticated, service_role;

create function public.publish_google_admin_caption_window_v1(
  target_token_hash text,
  target_auth_user_id uuid,
  target_supabase_auth_session_id uuid,
  target_google_issuer text,
  target_provider_subject_hmac text,
  target_subject_pepper_version integer,
  target_start_request_id uuid,
  target_operation_id uuid,
  target_request_id uuid,
  target_lecture_session_id uuid,
  target_text text,
  target_language text,
  target_last_item_id text,
  target_sequence bigint,
  target_transport_enabled boolean
)
returns jsonb
language sql
volatile
security definer
set search_path = ''
as $$
  select private.publish_google_admin_caption_window_v1(
    target_token_hash,
    target_auth_user_id,
    target_supabase_auth_session_id,
    target_google_issuer,
    target_provider_subject_hmac,
    target_subject_pepper_version,
    target_start_request_id,
    target_operation_id,
    target_request_id,
    target_lecture_session_id,
    target_text,
    target_language,
    target_last_item_id,
    target_sequence,
    target_transport_enabled
  );
$$;

revoke all on function public.publish_google_admin_caption_window_v1(
  text, uuid, uuid, text, text, integer, uuid, uuid, uuid, uuid, text, text,
  text, bigint, boolean
) from public, anon, authenticated;
grant execute on function public.publish_google_admin_caption_window_v1(
  text, uuid, uuid, text, text, integer, uuid, uuid, uuid, uuid, text, text,
  text, bigint, boolean
) to service_role;

-- A process can die after the local start transaction commits but before the
  -- dispatch claim is acquired. After the existing caption heartbeat lease,
  -- convert only that exact
-- unclaimed Realtime start into zero-cost terminal evidence so the one-running
-- caption lane cannot remain blocked forever.
create function private.settle_unclaimed_google_realtime_start_v1(
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
  intent_row private.admin_google_ai_provider_start_intents%rowtype;
  start_receipt private.admin_google_ai_provider_start_receipts%rowtype;
  dispatch_receipt private.admin_google_ai_provider_dispatch_receipts%rowtype;
  lecture_row public.lecture_sessions%rowtype;
  control_row public.lecture_ai_control%rowtype;
  usage_row public.ai_usage_ledger%rowtype;
  provider_call_row public.ai_realtime_provider_calls%rowtype;
  settlement jsonb;
  actor_value text;
  effective_now timestamptz := statement_timestamp();
begin
  if target_start_request_id is null then
    return null;
  end if;
  perform private.serialize_admin_ai_request_v1(target_start_request_id);

  select intent.* into intent_row
  from private.admin_google_ai_provider_start_intents as intent
  where intent.start_request_id = target_start_request_id;
  select receipt.* into start_receipt
  from private.admin_google_ai_provider_start_receipts as receipt
  where receipt.start_request_id = target_start_request_id;
  if intent_row.start_request_id is null
     or start_receipt.start_request_id is null
     or intent_row.feature <> 'captions'
     or intent_row.provider_family <> 'openai_realtime_v1'
     or intent_row.created_at > effective_now - interval '45 seconds' then
    return null;
  end if;

  select receipt.* into dispatch_receipt
  from private.admin_google_ai_provider_dispatch_receipts as receipt
  where receipt.start_request_id = target_start_request_id;
  if found
     or exists (
       select 1
       from private.admin_google_realtime_provider_creation_receipts as creation
       where creation.start_request_id = target_start_request_id
     ) then
    return null;
  end if;

  select lecture.* into lecture_row
  from public.lecture_sessions as lecture
  where lecture.id = intent_row.lecture_session_id
  for update;
  if not found then
    return null;
  end if;
  select control.* into control_row
  from public.lecture_ai_control as control
  where control.lecture_session_id = intent_row.lecture_session_id
  for update;
  select usage.* into usage_row
  from public.ai_usage_ledger as usage
  where usage.id = start_receipt.operation_id
  for update;
  select provider_call.* into provider_call_row
  from public.ai_realtime_provider_calls as provider_call
  where provider_call.operation_id = start_receipt.operation_id
  for update;
  -- A dispatch can win while this recovery path waits for the canonical
  -- lecture/control/usage/provider locks. Re-read immutable evidence only
  -- after those locks and never synthesize a terminal claim over a real one.
  select receipt.* into dispatch_receipt
  from private.admin_google_ai_provider_dispatch_receipts as receipt
  where receipt.start_request_id = target_start_request_id;
  if found
     or exists (
       select 1
       from private.admin_google_realtime_provider_creation_receipts as creation
       where creation.start_request_id = target_start_request_id
     ) then
    return null;
  end if;
  actor_value := 'admin-session:' || intent_row.admin_session_id::text;
  if control_row.lecture_session_id is null
     or usage_row.id is null
     or provider_call_row.operation_id is null
     or usage_row.lecture_session_id is distinct from intent_row.lecture_session_id
     or usage_row.feature <> 'captions'
     or usage_row.idempotency_key is distinct from target_start_request_id::text
     or usage_row.requested_by_actor is distinct from actor_value
     or usage_row.status <> 'running'
     or usage_row.accounting_settled_at is not null
     or usage_row.provider_dispatched_at is not null
     or usage_row.provider_request_id is not null
     or provider_call_row.lecture_session_id is distinct from
       intent_row.lecture_session_id
     or provider_call_row.actor_id is distinct from actor_value
     or provider_call_row.client_request_id is distinct from
       target_start_request_id::text
     or provider_call_row.status <> 'creating'
     or provider_call_row.provider_call_id is not null then
    return null;
  end if;

  update public.ai_usage_ledger as usage
  set
    provider_dispatched_at = effective_now,
    provider_request_id = target_start_request_id::text
  where usage.id = usage_row.id;
  insert into private.admin_google_ai_provider_dispatch_receipts (
    start_request_id, operation_id, provider_family, client_request_id,
    claimed_at, lease_expires_at
  ) values (
    target_start_request_id, usage_row.id, 'openai_realtime_v1',
    target_start_request_id, effective_now, effective_now + interval '1 second'
  );
  insert into private.admin_google_realtime_provider_creation_receipts (
    start_request_id, operation_id, client_request_id, outcome,
    provider_call_id, provider_request_id, error_code, created_at
  ) values (
    target_start_request_id, usage_row.id, target_start_request_id,
    'creation_failed', null, target_start_request_id::text,
    'provider_dispatch_not_claimed', effective_now
  );
  update public.ai_realtime_provider_calls as provider_call
  set
    provider_request_id = target_start_request_id::text,
    status = 'creation_failed',
    stop_reason = 'provider_dispatch_not_claimed',
    stop_requested_at = effective_now,
    next_attempt_at = effective_now,
    lease_until = null,
    last_error = 'provider_dispatch_not_claimed',
    updated_at = effective_now
  where provider_call.operation_id = usage_row.id;

  settlement := private.finish_lecture_ai_operation(
    usage_row.id,
    'cancelled',
    0,
    0,
    0,
    0,
    target_start_request_id::text,
    'provider_dispatch_not_claimed'
  );
  return settlement || jsonb_build_object(
    'accepted', true,
    'operationId', usage_row.id,
    'staleRecovered', true
  );
end;
$$;

revoke all on function private.settle_unclaimed_google_realtime_start_v1(
  uuid
) from public, anon, authenticated, service_role;

-- Older lecture-close and global-stop primitives predate exact accounting.
-- Recover only Google Realtime rows that are already terminal but remain
-- unsettled, using the same immutable dispatch/creation classification as an
-- explicit stop. Candidate discovery is nonlocking; the worker takes the
-- canonical lecture -> control -> usage -> provider locks itself.
create function private.settle_terminal_google_realtime_accounting_v1(
  job_limit integer default 20
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
  settled integer := 0;
begin
  if job_limit is null or job_limit not between 1 and 50 then
    return 0;
  end if;
  for candidate in
    select
      usage.id,
      usage.requested_by_actor,
      coalesce(
        nullif(usage.error_code, ''),
        'terminal_realtime_accounting_recovery'
      ) as error_code
    from public.ai_usage_ledger as usage
    join private.admin_google_ai_provider_start_receipts as start_receipt
      on start_receipt.operation_id = usage.id
    join private.admin_google_ai_provider_start_intents as intent
      on intent.start_request_id = start_receipt.start_request_id
    where intent.feature = 'captions'
      and intent.provider_family = 'openai_realtime_v1'
      and usage.status <> 'running'
      and usage.accounting_settled_at is null
    order by usage.finished_at nulls first, usage.id
    limit job_limit
  loop
    perform private.finish_realtime_caption_operation(
      candidate.id,
      candidate.requested_by_actor,
      candidate.error_code,
      true,
      true
    );
    settled := settled + 1;
  end loop;
  return settled;
end;
$$;

revoke all on function private.settle_terminal_google_realtime_accounting_v1(
  integer
) from public, anon, authenticated, service_role;

create or replace function private.settle_stale_google_ai_provider_dispatch_v1(
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
  creation_row private.admin_google_realtime_provider_creation_receipts%rowtype;
  provider_call_row public.ai_realtime_provider_calls%rowtype;
  academic_binding private.admin_google_academic_answer_start_bindings%rowtype;
  summary_binding private.admin_google_summary_window_start_bindings%rowtype;
  lecture_row public.lecture_sessions%rowtype;
  control_row public.lecture_ai_control%rowtype;
  request_row public.academic_answer_requests%rowtype;
  usage_row public.ai_usage_ledger%rowtype;
  settlement jsonb;
  actor_value text;
  effective_now timestamptz := statement_timestamp();
begin
  if target_start_request_id is null then
    return null;
  end if;
  perform private.serialize_admin_ai_request_v1(target_start_request_id);

  select receipt.* into receipt_row
  from private.admin_google_ai_provider_dispatch_receipts as receipt
  where receipt.start_request_id = target_start_request_id;
  if not found or receipt_row.lease_expires_at > effective_now then
    return null;
  end if;

  select intent.* into intent_row
  from private.admin_google_ai_provider_start_intents as intent
  where intent.start_request_id = target_start_request_id
    and intent.provider_family = receipt_row.provider_family;
  if not found
     or intent_row.feature not in (
       'material_analysis', 'poll_suggestions', 'summaries',
       'academic_answers', 'captions'
     ) then
    return null;
  end if;

  if intent_row.feature = 'academic_answers' then
    select binding.* into academic_binding
    from private.admin_google_academic_answer_start_bindings as binding
    where binding.start_request_id = target_start_request_id
      and binding.operation_id = receipt_row.operation_id
      and binding.lecture_session_id = intent_row.lecture_session_id;
    if not found then
      return null;
    end if;
  end if;

  select lecture.* into lecture_row
  from public.lecture_sessions as lecture
  where lecture.id = intent_row.lecture_session_id
  for update;
  if not found then
    return null;
  end if;

  actor_value := 'admin-session:' || intent_row.admin_session_id::text;
  if intent_row.feature = 'academic_answers' then
    select control.* into control_row
    from public.lecture_ai_control as control
    where control.lecture_session_id = lecture_row.id
    for update;
    if not found then
      return null;
    end if;
    select request.* into request_row
    from public.academic_answer_requests as request
    where request.id = academic_binding.academic_request_id
      and request.lecture_session_id = lecture_row.id
      and request.operation_id = receipt_row.operation_id
      and request.requested_by_actor = actor_value
    for update;
    if not found then
      return null;
    end if;
  end if;

  select usage.* into usage_row
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

  if intent_row.feature = 'captions' then
    select provider_call.* into provider_call_row
    from public.ai_realtime_provider_calls as provider_call
    where provider_call.operation_id = usage_row.id
    for update;
    if not found
       or provider_call_row.lecture_session_id is distinct from lecture_row.id
       or provider_call_row.actor_id is distinct from actor_value
       or provider_call_row.client_request_id is distinct from
         receipt_row.client_request_id::text then
      return null;
    end if;

    select receipt.* into creation_row
    from private.admin_google_realtime_provider_creation_receipts as receipt
    where receipt.start_request_id = target_start_request_id;
    if found and creation_row.outcome = 'activated' then
      -- Activated Realtime calls are intentionally excluded from the
      -- background 90-second reaper. An explicit exact start retry after the
      -- lease, however, proves the SDP response was not usable by the caller;
      -- converge by settling conservatively and enqueueing durable hangup.
      update public.ai_realtime_provider_calls as provider_call
      set
        status = case when provider_call.status = 'active'
          then 'stop_requested' else provider_call.status end,
        stop_reason = coalesce(
          provider_call.stop_reason,
          'provider_dispatch_response_lost_ambiguous'
        ),
        stop_requested_at = case when provider_call.status = 'active'
          then effective_now else provider_call.stop_requested_at end,
        next_attempt_at = case when provider_call.status = 'active'
          then effective_now else provider_call.next_attempt_at end,
        lease_until = null,
        last_error = 'provider_dispatch_response_lost_ambiguous',
        updated_at = effective_now
      where provider_call.operation_id = usage_row.id
      returning * into provider_call_row;
    elsif not found then
      insert into private.admin_google_realtime_provider_creation_receipts (
        start_request_id, operation_id, client_request_id, outcome,
        provider_call_id, provider_request_id, error_code, created_at
      ) values (
        target_start_request_id, usage_row.id, receipt_row.client_request_id,
        'creation_uncertain', provider_call_row.provider_call_id,
        provider_call_row.provider_request_id,
        'provider_dispatch_lease_expired_ambiguous', effective_now
      ) returning * into creation_row;

      update public.ai_realtime_provider_calls as provider_call
      set
        status = case when provider_call.provider_call_id is null
          then 'creation_failed' else 'stop_requested' end,
        creation_outcome_uncertain = true,
        uncertainty_recorded_at = effective_now,
        stop_reason = 'provider_dispatch_lease_expired_ambiguous',
        stop_requested_at = case when provider_call.provider_call_id is not null
          then effective_now else provider_call.stop_requested_at end,
        next_attempt_at = effective_now,
        lease_until = null,
        last_error = 'provider_dispatch_lease_expired_ambiguous',
        updated_at = effective_now
      where provider_call.operation_id = usage_row.id
      returning * into provider_call_row;
    end if;

    settlement := private.finish_lecture_ai_operation(
      usage_row.id,
      'cancelled',
      case when creation_row.outcome = 'creation_failed'
        then 0 else usage_row.reserved_microusd end,
      case when creation_row.outcome = 'creation_failed'
        then 0 else usage_row.reserved_audio_seconds end,
      0,
      0,
      coalesce(
        creation_row.provider_request_id,
        receipt_row.client_request_id::text
      ),
      case
        when creation_row.outcome = 'creation_failed'
          then creation_row.error_code
        when creation_row.outcome = 'activated'
          then 'provider_dispatch_response_lost_ambiguous'
        when coalesce(creation_row.error_code, '') like '%ambiguous%'
          then creation_row.error_code
        else left(creation_row.error_code, 110) || '_ambiguous'
      end
    );
  elsif intent_row.feature = 'academic_answers' then
    settlement := private.fail_academic_answer_operation(
      academic_binding.academic_request_id,
      usage_row.id,
      actor_value,
      usage_row.reserved_microusd,
      usage_row.reserved_input_tokens,
      usage_row.reserved_output_tokens,
      receipt_row.client_request_id::text,
      'provider_dispatch_lease_expired_ambiguous'
    );
  elsif intent_row.feature = 'summaries' then
    select binding.* into summary_binding
    from private.admin_google_summary_window_start_bindings as binding
    where binding.start_request_id = target_start_request_id
      and binding.operation_id = usage_row.id
      and binding.lecture_session_id = usage_row.lecture_session_id;
    if not found then
      return null;
    end if;
    if usage_row.status = 'running' then
      settlement := private.fail_summary_window_operation(
        usage_row.id,
        summary_binding.run_id,
        actor_value,
        usage_row.reserved_microusd,
        usage_row.reserved_input_tokens,
        usage_row.reserved_output_tokens,
        receipt_row.client_request_id::text,
        'provider_dispatch_lease_expired_ambiguous'
      );
    else
      settlement := private.finish_lecture_ai_operation(
        usage_row.id,
        'cancelled',
        usage_row.reserved_microusd,
        0,
        usage_row.reserved_input_tokens,
        usage_row.reserved_output_tokens,
        receipt_row.client_request_id::text,
        'provider_dispatch_lease_expired_ambiguous'
      );
    end if;
  else
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
  end if;

  return (settlement - 'results') || jsonb_build_object(
    'accepted', true,
    'operationId', usage_row.id,
    'staleRecovered', true
  );
end;
$$;

revoke all on function private.settle_stale_google_ai_provider_dispatch_v1(
  uuid
) from public, anon, authenticated, service_role;

create or replace function private.reap_stale_google_ai_provider_dispatches_v1(
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
      and not exists (
        select 1
        from private.admin_google_realtime_provider_creation_receipts as creation
        where creation.start_request_id = receipt.start_request_id
          and creation.outcome = 'activated'
      )
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

  for candidate in
    select intent.start_request_id
    from private.admin_google_ai_provider_start_intents as intent
    join private.admin_google_ai_provider_start_receipts as start_receipt
      on start_receipt.start_request_id = intent.start_request_id
    join public.ai_usage_ledger as usage
      on usage.id = start_receipt.operation_id
    where intent.feature = 'captions'
      and intent.provider_family = 'openai_realtime_v1'
      and intent.created_at <= statement_timestamp() - interval '45 seconds'
      and usage.accounting_settled_at is null
      and not exists (
        select 1
        from private.admin_google_ai_provider_dispatch_receipts as dispatch
        where dispatch.start_request_id = intent.start_request_id
      )
    order by intent.created_at, intent.start_request_id
    limit greatest(job_limit - reaped, 0)
  loop
    settlement := private.settle_unclaimed_google_realtime_start_v1(
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

-- The existing five-minute maintenance cron remains the durable scheduler.
-- Reconcile immutable Google dispatch/creation evidence before the legacy
-- caption timeout pass so the latter never attempts a terminal transition
-- without the dispatch receipt required by the C2 trigger.
create or replace function public.run_phase6_6_maintenance()
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  google_provider_reaps integer;
  terminal_realtime_settlements integer;
  maintenance_result jsonb;
begin
  google_provider_reaps := public.reap_stale_google_ai_provider_dispatches_v1(20);
  maintenance_result := private.maintain_phase6_6_jobs();
  terminal_realtime_settlements :=
    private.settle_terminal_google_realtime_accounting_v1(20);
  return maintenance_result || jsonb_build_object(
    'reaped_google_provider_dispatches', google_provider_reaps,
    'settled_terminal_google_realtime', terminal_realtime_settlements
  );
end;
$$;

revoke all on function public.run_phase6_6_maintenance()
  from public, anon, authenticated, service_role;
grant execute on function public.run_phase6_6_maintenance()
  to service_role;
