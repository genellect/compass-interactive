-- Phase 7.30C2: Google workspace admission context.
--
-- The browser may display and submit only the current non-secret policy
-- binding. The admission transaction remains authoritative and rejects a
-- policy that was superseded after this status snapshot.

create or replace function private.get_google_ai_master_status_v1(
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
  gate_row private.admin_ai_unlock_runtime_gate%rowtype;
  ownership_row private.admin_lecture_ownerships%rowtype;
  policy_row private.admin_ai_policies%rowtype;
  lecture_row public.lecture_sessions%rowtype;
  authorization_row public.lecture_ai_master_authorizations%rowtype;
  allowed_scopes text[] := array[]::text[];
  admission_blocked_reason text;
  status_reason text;
  lecture_open boolean := false;
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

  -- Keep the same gate -> policy -> lecture order as C1 admission so status
  -- cannot deadlock with a concurrent admission or operational cutoff.
  select gate.*
  into gate_row
  from private.admin_ai_unlock_runtime_gate as gate
  where gate.singleton
  for share;
  if not found then
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

  select policy.*
  into policy_row
  from private.admin_ai_policies as policy
  where policy.environment_id = ownership_row.environment_id
    and policy.membership_id = ownership_row.membership_id
    and policy.status = 'active'
    and policy.valid_from <= effective_now
    and policy.valid_until > effective_now
  for share;

  select lecture.*
  into lecture_row
  from public.lecture_sessions as lecture
  where lecture.id = target_lecture_session_id
  for update;
  if not found then
    return null;
  end if;

  lecture_open := lecture_row.status = 'open'
    and lecture_row.hard_stop_at is not null
    and lecture_row.hard_stop_at > effective_now;

  if policy_row.id is not null then
    if private.ai_master_actions_for_scope('all_except_captions')
       <@ policy_row.allowed_actions then
      allowed_scopes := array_append(allowed_scopes, 'all_except_captions');
    end if;
    if private.ai_master_actions_for_scope('all_including_captions')
       <@ policy_row.allowed_actions then
      allowed_scopes := array_append(allowed_scopes, 'all_including_captions');
    end if;
  end if;

  admission_blocked_reason := case
    when not gate_row.ai_unlock_enabled then 'ai_unlock_disabled'
    when not gate_row.google_ai_master_admission_enabled then
      'google_ai_master_admission_disabled'
    when (context_value ->> 'can_use_ai')::boolean is not true then
      'membership_ai_disabled'
    when not lecture_open then 'lecture_not_open'
    when policy_row.id is null then 'policy_unavailable'
    when cardinality(allowed_scopes) = 0 then 'policy_scope_unavailable'
    else null
  end;

  select master.*
  into authorization_row
  from public.lecture_ai_master_authorizations as master
  where master.lecture_session_id = target_lecture_session_id
    and master.status = 'active'
  for update;

  if not found then
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

  if authorization_row.id is not null and (
    authorization_row.principal_id is null
    or not exists (
      select 1
      from private.admin_ai_master_admission_receipts as marker
      where marker.master_authorization_id = authorization_row.id
    )
  ) then
    perform private.expire_ai_master_authorization(
      target_lecture_session_id,
      'expired',
      'pre_c1_master_fenced',
      'system:c2-cutover'
    );
    authorization_row := null::public.lecture_ai_master_authorizations;
    status_reason := 'pre_c1_master_remediated';
  end if;

  if authorization_row.id is not null and (
    authorization_row.principal_id <> ownership_row.principal_id
    or authorization_row.membership_id <> ownership_row.membership_id
  ) then
    return null;
  end if;

  if authorization_row.id is not null and not lecture_open then
    authorization_row := private.expire_ai_master_authorization(
      target_lecture_session_id,
      'lecture_closed',
      'lecture_not_open',
      'system:lifecycle'
    );
  elsif authorization_row.id is not null
        and authorization_row.expires_at <= effective_now then
    authorization_row := private.expire_ai_master_authorization(
      target_lecture_session_id,
      'expired',
      'authorization_expired',
      'system:expiry'
    );
  end if;

  return jsonb_build_object(
    'admission_blocked_reason', admission_blocked_reason,
    'admission_enabled', admission_blocked_reason is null,
    'allowed_scopes', to_jsonb(allowed_scopes),
    'authorization', case
      when authorization_row.id is null then null::jsonb
      else private.ai_master_authorization_json(
        authorization_row,
        'admin-session:' || (context_value ->> 'admin_session_id')
      )
    end,
    'can_use_ai', (context_value ->> 'can_use_ai')::boolean,
    'lecture_open', lecture_open,
    'policy', case
      when policy_row.id is null then null::jsonb
      else jsonb_build_object(
        'allowed_actions', to_jsonb(policy_row.allowed_actions),
        'id', policy_row.id,
        'valid_until', policy_row.valid_until,
        'version', policy_row.version
      )
    end,
    'reason', status_reason,
    'server_time', effective_now
  );
end;
$$;

revoke all on function private.get_google_ai_master_status_v1(
  text, uuid, uuid, uuid
) from public, anon, authenticated, service_role;

create function private.get_google_admin_summary_results_v1(
  target_token_hash text,
  target_auth_user_id uuid,
  target_supabase_auth_session_id uuid,
  target_google_issuer text,
  target_provider_subject_hmac text,
  target_subject_pepper_version integer,
  target_transport_enabled boolean,
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
begin
  context_value := private.require_google_admin_operation_context_v1(
    target_token_hash,
    target_auth_user_id,
    target_supabase_auth_session_id,
    target_google_issuer,
    target_provider_subject_hmac,
    target_subject_pepper_version,
    'manage-lecture-summaries.status',
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
  return public.admin_get_phase6_summary_results(target_lecture_session_id);
end;
$$;

revoke all on function private.get_google_admin_summary_results_v1(
  text, uuid, uuid, text, text, integer, boolean, uuid
) from public, anon, authenticated, service_role;

create function public.get_google_admin_summary_results_v1(
  target_token_hash text,
  target_auth_user_id uuid,
  target_supabase_auth_session_id uuid,
  target_google_issuer text,
  target_provider_subject_hmac text,
  target_subject_pepper_version integer,
  target_transport_enabled boolean,
  target_lecture_session_id uuid
)
returns jsonb
language sql
volatile
security definer
set search_path = ''
as $$
  select private.get_google_admin_summary_results_v1(
    target_token_hash,
    target_auth_user_id,
    target_supabase_auth_session_id,
    target_google_issuer,
    target_provider_subject_hmac,
    target_subject_pepper_version,
    target_transport_enabled,
    target_lecture_session_id
  );
$$;

revoke all on function public.get_google_admin_summary_results_v1(
  text, uuid, uuid, text, text, integer, boolean, uuid
) from public, anon, authenticated;
grant execute on function public.get_google_admin_summary_results_v1(
  text, uuid, uuid, text, text, integer, boolean, uuid
) to service_role;

create function private.manage_google_admin_summary_publication_v1(
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
  target_summary_id uuid,
  target_revision_body jsonb,
  target_reason text,
  target_pinned_order integer,
  target_pinned_until timestamptz
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
  operation_key_value text;
  context_value jsonb;
  receipt_row private.admin_google_operation_receipts%rowtype;
  intent_digest_value text;
  payload_digest_value text;
  normalized_body jsonb;
  normalized_reason text;
  actor_value text;
  legacy_action text;
  results_value jsonb;
begin
  if target_action not in ('publish', 'hide', 'pin', 'unpin', 'revisePublish')
     or target_request_id is null
     or target_lecture_session_id is null
     or target_summary_id is null then
    return null;
  end if;

  normalized_body := case
    when target_revision_body is null then null
    else jsonb_strip_nulls(target_revision_body)
  end;
  normalized_reason := nullif(btrim(coalesce(target_reason, '')), '');

  if target_action = 'revisePublish' and (
       normalized_body is null
       or jsonb_typeof(normalized_body) is distinct from 'object'
       or normalized_reason is null
       or char_length(normalized_reason) > 500
       or target_pinned_order is not null
       or target_pinned_until is not null
     ) then
    return null;
  end if;
  if target_action = 'pin' and (
       target_pinned_order is null
       or target_pinned_until is null
       or target_revision_body is not null
       or target_reason is not null
     ) then
    return null;
  end if;
  if target_action in ('publish', 'hide', 'unpin') and (
       target_revision_body is not null
       or target_reason is not null
       or target_pinned_order is not null
       or target_pinned_until is not null
     ) then
    return null;
  end if;

  perform private.serialize_admin_ai_request_v1(target_request_id);
  operation_key_value := 'manage-lecture-summaries.' || target_action;
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
  if context_value is null
     or context_value ->> 'lecture_lock_mode' is distinct from 'update' then
    return null;
  end if;

  payload_digest_value := encode(
    extensions.digest(
      convert_to(
        jsonb_build_object(
          'action', target_action,
          'pinnedOrder', target_pinned_order,
          'pinnedUntil', target_pinned_until,
          'reason', normalized_reason,
          'revisionBody', normalized_body,
          'summaryId', target_summary_id
        )::text,
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );
  intent_digest_value := private.google_admin_operation_intent_digest_v1(
    target_request_id,
    (context_value ->> 'admin_session_id')::uuid,
    operation_key_value,
    target_lecture_session_id,
    target_summary_id::text,
    payload_digest_value
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
       and receipt_row.target_id = target_summary_id::text then
      return jsonb_build_object(
        'idempotentReplay', true,
        'ok', true,
        'refreshRequired', true,
        'resultId', receipt_row.result_id,
        'resultStatus', receipt_row.result_status,
        'results', null
      );
    end if;
    raise exception 'Summary publication request binding does not match its receipt'
      using errcode = 'P7335';
  end if;

  perform private.assert_google_admin_operation_gate_v1(
    context_value,
    target_transport_enabled
  );
  perform private.assert_google_admin_operation_lecture_state_v1(context_value);
  actor_value := 'admin-session:' || (context_value ->> 'admin_session_id');
  legacy_action := case target_action
    when 'revisePublish' then 'revise_publish'
    else target_action
  end;
  results_value := public.admin_manage_summary_publication(
    target_lecture_session_id,
    target_summary_id,
    actor_value,
    legacy_action,
    normalized_body,
    normalized_reason,
    target_pinned_order,
    target_pinned_until
  );
  if results_value is null then
    raise exception 'Summary publication did not converge'
      using errcode = 'P7335';
  end if;

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
    target_summary_id::text,
    target_summary_id::text,
    target_action,
    jsonb_build_object('refreshRequired', true)
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
    'admin_summary.' || target_action,
    'lecture_summary',
    target_summary_id::text,
    'accepted',
    'google_admin_operation',
    jsonb_build_object(
      'operation_key', operation_key_value,
      'result_status', target_action
    )
  );

  return jsonb_build_object(
    'idempotentReplay', false,
    'ok', true,
    'refreshRequired', false,
    'resultId', target_summary_id,
    'resultStatus', target_action,
    'results', results_value
  );
end;
$$;

revoke all on function private.manage_google_admin_summary_publication_v1(
  text, uuid, uuid, text, text, integer, boolean, text, uuid, uuid, uuid,
  jsonb, text, integer, timestamptz
) from public, anon, authenticated, service_role;

create function public.manage_google_admin_summary_publication_v1(
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
  target_summary_id uuid,
  target_revision_body jsonb,
  target_reason text,
  target_pinned_order integer,
  target_pinned_until timestamptz
)
returns jsonb
language sql
volatile
security definer
set search_path = ''
as $$
  select private.manage_google_admin_summary_publication_v1(
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
    target_summary_id,
    target_revision_body,
    target_reason,
    target_pinned_order,
    target_pinned_until
  );
$$;

revoke all on function public.manage_google_admin_summary_publication_v1(
  text, uuid, uuid, text, text, integer, boolean, text, uuid, uuid, uuid,
  jsonb, text, integer, timestamptz
) from public, anon, authenticated;
grant execute on function public.manage_google_admin_summary_publication_v1(
  text, uuid, uuid, text, text, integer, boolean, text, uuid, uuid, uuid,
  jsonb, text, integer, timestamptz
) to service_role;

create function private.get_google_admin_academic_results_v1(
  target_token_hash text,
  target_auth_user_id uuid,
  target_supabase_auth_session_id uuid,
  target_google_issuer text,
  target_provider_subject_hmac text,
  target_subject_pepper_version integer,
  target_transport_enabled boolean,
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
begin
  context_value := private.require_google_admin_operation_context_v1(
    target_token_hash,
    target_auth_user_id,
    target_supabase_auth_session_id,
    target_google_issuer,
    target_provider_subject_hmac,
    target_subject_pepper_version,
    'generate-academic-answer.status',
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
  return public.admin_list_academic_answer_results(target_lecture_session_id);
end;
$$;

revoke all on function private.get_google_admin_academic_results_v1(
  text, uuid, uuid, text, text, integer, boolean, uuid
) from public, anon, authenticated, service_role;

create function public.get_google_admin_academic_results_v1(
  target_token_hash text,
  target_auth_user_id uuid,
  target_supabase_auth_session_id uuid,
  target_google_issuer text,
  target_provider_subject_hmac text,
  target_subject_pepper_version integer,
  target_transport_enabled boolean,
  target_lecture_session_id uuid
)
returns jsonb
language sql
volatile
security definer
set search_path = ''
as $$
  select private.get_google_admin_academic_results_v1(
    target_token_hash,
    target_auth_user_id,
    target_supabase_auth_session_id,
    target_google_issuer,
    target_provider_subject_hmac,
    target_subject_pepper_version,
    target_transport_enabled,
    target_lecture_session_id
  );
$$;

revoke all on function public.get_google_admin_academic_results_v1(
  text, uuid, uuid, text, text, integer, boolean, uuid
) from public, anon, authenticated;
grant execute on function public.get_google_admin_academic_results_v1(
  text, uuid, uuid, text, text, integer, boolean, uuid
) to service_role;

create function private.manage_google_admin_academic_results_v1(
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
  target_academic_request_id uuid,
  target_answer_id uuid,
  target_revision_body jsonb,
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
  operation_key_value text;
  context_value jsonb;
  receipt_row private.admin_google_operation_receipts%rowtype;
  intent_digest_value text;
  payload_digest_value text;
  normalized_body jsonb;
  normalized_reason text;
  target_id_value text;
  actor_value text;
  results_value jsonb;
  academic_request_row public.academic_answer_requests%rowtype;
  usage_row public.ai_usage_ledger%rowtype;
  cancellation_error text;
begin
  if target_action not in ('cancel', 'approve', 'hide', 'reject', 'revise')
     or target_request_id is null
     or target_lecture_session_id is null then
    return null;
  end if;

  normalized_body := case
    when target_revision_body is null then null
    else jsonb_strip_nulls(target_revision_body)
  end;
  normalized_reason := nullif(btrim(coalesce(target_reason, '')), '');

  if target_action = 'cancel' and (
       target_academic_request_id is null
       or target_answer_id is not null
       or target_revision_body is not null
       or target_reason is not null
     ) then
    return null;
  end if;
  if target_action in ('approve', 'hide', 'reject') and (
       target_answer_id is null
       or target_academic_request_id is not null
       or target_revision_body is not null
       or target_reason is not null
     ) then
    return null;
  end if;
  if target_action = 'revise' and (
       target_answer_id is null
       or target_academic_request_id is not null
       or normalized_body is null
       or jsonb_typeof(normalized_body) is distinct from 'object'
       or char_length(coalesce(normalized_reason, '')) > 300
     ) then
    return null;
  end if;

  target_id_value := case
    when target_action = 'cancel' then target_academic_request_id::text
    else target_answer_id::text
  end;
  perform private.serialize_admin_ai_request_v1(target_request_id);
  operation_key_value := 'generate-academic-answer.' || target_action;
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
  if context_value is null
     or context_value ->> 'lecture_lock_mode' is distinct from 'update' then
    return null;
  end if;

  payload_digest_value := encode(
    extensions.digest(
      convert_to(
        jsonb_build_object(
          'academicRequestId', target_academic_request_id,
          'action', target_action,
          'answerId', target_answer_id,
          'reason', normalized_reason,
          'revisionBody', normalized_body
        )::text,
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );
  intent_digest_value := private.google_admin_operation_intent_digest_v1(
    target_request_id,
    (context_value ->> 'admin_session_id')::uuid,
    operation_key_value,
    target_lecture_session_id,
    target_id_value,
    payload_digest_value
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
       and receipt_row.target_id = target_id_value then
      return jsonb_build_object(
        'idempotentReplay', true,
        'ok', true,
        'refreshRequired', true,
        'resultId', receipt_row.result_id,
        'resultStatus', receipt_row.result_status,
        'results', null
      );
    end if;
    raise exception 'Academic answer request binding does not match its receipt'
      using errcode = 'P7335';
  end if;

  perform private.assert_google_admin_operation_gate_v1(
    context_value,
    target_transport_enabled
  );
  perform private.assert_google_admin_operation_lecture_state_v1(context_value);
  actor_value := 'admin-session:' || (context_value ->> 'admin_session_id');

  if target_action = 'cancel' then
    -- Cancellation belongs to the current canonical lecture owner, not the
    -- historical app-session actor that started the request. The C2 context
    -- already holds the lecture lock, so preserve lecture -> control ->
    -- request -> usage across relogin and session replacement.
    perform 1
    from public.lecture_ai_control as control
    where control.lecture_session_id = target_lecture_session_id
    for update;

    select request.*
    into academic_request_row
    from public.academic_answer_requests as request
    where request.id = target_academic_request_id
      and request.lecture_session_id = target_lecture_session_id
    for update;
    if not found then
      raise exception 'Academic answer request was not found'
        using errcode = 'P7335';
    end if;

    if academic_request_row.status in ('evidence_checking', 'running')
       and academic_request_row.operation_id is not null then
      select usage.*
      into usage_row
      from public.ai_usage_ledger as usage
      where usage.id = academic_request_row.operation_id
        and usage.lecture_session_id = target_lecture_session_id
      for update;

      if usage_row.id is not null
         and usage_row.accounting_settled_at is null then
        cancellation_error := case
          when usage_row.provider_dispatched_at is null then
            'cancelled_by_admin_before_dispatch'
          else 'cancelled_by_admin_after_dispatch_ambiguous'
        end;
        perform private.finish_lecture_ai_operation(
          usage_row.id,
          'cancelled',
          case when usage_row.provider_dispatched_at is null
            then 0 else usage_row.reserved_microusd end,
          0,
          case when usage_row.provider_dispatched_at is null
            then 0 else usage_row.reserved_input_tokens end,
          case when usage_row.provider_dispatched_at is null
            then 0 else usage_row.reserved_output_tokens end,
          null,
          cancellation_error
        );
      end if;
    end if;

    update public.academic_answer_requests as request
    set status = 'discarded',
        lease_until = null,
        error_code = coalesce(cancellation_error, 'cancelled_by_admin'),
        updated_at = statement_timestamp()
    where request.id = target_academic_request_id
      and request.status in ('evidence_checking', 'running');

    results_value := private.phase72_admin_results_json(
      target_lecture_session_id
    );
  elsif target_action in ('approve', 'hide', 'reject') then
    results_value := public.admin_manage_academic_answer_publication(
      target_lecture_session_id,
      target_answer_id,
      actor_value,
      target_action
    );
  else
    results_value := public.admin_revise_academic_answer_publication(
      target_lecture_session_id,
      target_answer_id,
      actor_value,
      normalized_body,
      normalized_reason
    );
  end if;
  if results_value is null then
    raise exception 'Academic answer operation did not converge'
      using errcode = 'P7335';
  end if;

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
    target_action,
    jsonb_build_object('refreshRequired', true)
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
    'admin_academic_answer.' || target_action,
    case when target_action = 'cancel' then 'academic_request'
      else 'academic_answer' end,
    target_id_value,
    'accepted',
    'google_admin_operation',
    jsonb_build_object(
      'operation_key', operation_key_value,
      'result_status', target_action
    )
  );

  return jsonb_build_object(
    'idempotentReplay', false,
    'ok', true,
    'refreshRequired', false,
    'resultId', target_id_value,
    'resultStatus', target_action,
    'results', results_value
  );
end;
$$;

revoke all on function private.manage_google_admin_academic_results_v1(
  text, uuid, uuid, text, text, integer, boolean, text, uuid, uuid, uuid,
  uuid, jsonb, text
) from public, anon, authenticated, service_role;

create function public.manage_google_admin_academic_results_v1(
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
  target_academic_request_id uuid,
  target_answer_id uuid,
  target_revision_body jsonb,
  target_reason text
)
returns jsonb
language sql
volatile
security definer
set search_path = ''
as $$
  select private.manage_google_admin_academic_results_v1(
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
    target_academic_request_id,
    target_answer_id,
    target_revision_body,
    target_reason
  );
$$;

revoke all on function public.manage_google_admin_academic_results_v1(
  text, uuid, uuid, text, text, integer, boolean, text, uuid, uuid, uuid,
  uuid, jsonb, text
) from public, anon, authenticated;
grant execute on function public.manage_google_admin_academic_results_v1(
  text, uuid, uuid, text, text, integer, boolean, text, uuid, uuid, uuid,
  uuid, jsonb, text
) to service_role;
