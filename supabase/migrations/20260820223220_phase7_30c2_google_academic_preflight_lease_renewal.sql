create function private.renew_google_admin_academic_answer_preflight_v1(
  target_token_hash text,
  target_auth_user_id uuid,
  target_supabase_auth_session_id uuid,
  target_google_issuer text,
  target_provider_subject_hmac text,
  target_subject_pepper_version integer,
  target_lecture_session_id uuid,
  target_academic_request_id uuid,
  target_publication_mode text,
  target_run_id uuid,
  target_run_token_hash text,
  target_idempotency_key text,
  target_source_kind text,
  target_source_summary_id uuid,
  target_question_sha256 text,
  target_search_query_sha256 text,
  target_source_policy text,
  target_preflight_request_id uuid,
  target_preflight_context_digest text,
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
  authority_value jsonb;
  receipt_row private.admin_google_academic_answer_preflight_receipts%rowtype;
  request_row public.academic_answer_requests%rowtype;
  run_row public.lecture_summary_runs%rowtype;
  identity_gate private.admin_identity_runtime_gate%rowtype;
  ai_gate private.admin_ai_unlock_runtime_gate%rowtype;
  intent_digest_value text;
  actor_value text;
  required_actions text[];
  renewal_expires_at timestamptz;
begin
  if target_preflight_request_id is null
     or target_academic_request_id is null
     or target_lecture_session_id is null
     or target_transport_enabled is null
     or target_publication_mode not in ('manual_review', 'auto_unreviewed')
     or char_length(coalesce(target_idempotency_key, '')) not between 8 and 160
     or target_question_sha256 is null
     or target_question_sha256 !~ '^[0-9a-f]{64}$'
     or target_search_query_sha256 is null
     or target_search_query_sha256 !~ '^[0-9a-f]{64}$'
     or target_preflight_context_digest is null
     or target_preflight_context_digest !~ '^[0-9a-f]{64}$'
     or target_source_policy not in (
       'auto', 'biomedical_pubmed', 'multidisciplinary_doi'
     )
     or target_source_kind not in ('summary_candidate', 'teacher_selected')
     or (
       target_source_kind = 'summary_candidate'
       and target_source_summary_id is null
     )
     or (
       target_source_kind = 'teacher_selected'
       and target_source_summary_id is not null
     )
     or (
       target_publication_mode = 'manual_review'
       and (target_run_id is not null or target_run_token_hash is not null)
     )
     or (
       target_publication_mode = 'auto_unreviewed'
       and (
         target_run_id is null
         or target_run_token_hash is null
         or target_run_token_hash !~ '^[0-9a-f]{64}$'
         or target_source_kind <> 'summary_candidate'
         or target_source_summary_id is null
       )
     ) then
    return null;
  end if;

  perform private.serialize_admin_ai_request_v1(target_preflight_request_id);
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
  intent_digest_value := private.google_academic_preflight_intent_digest_v1(
    target_preflight_request_id,
    (context_value ->> 'admin_session_id')::uuid,
    target_lecture_session_id,
    target_publication_mode,
    target_run_id,
    target_run_token_hash,
    target_idempotency_key,
    target_source_kind,
    target_source_summary_id,
    target_question_sha256,
    target_search_query_sha256,
    target_source_policy
  );
  if intent_digest_value is null then
    return null;
  end if;

  select receipt.* into receipt_row
  from private.admin_google_academic_answer_preflight_receipts as receipt
  where receipt.request_id = target_preflight_request_id;
  if not found
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
     or receipt_row.auth_user_id is distinct from target_auth_user_id
     or receipt_row.lecture_session_id is distinct from target_lecture_session_id
     or receipt_row.academic_request_id is distinct from
       target_academic_request_id
     or receipt_row.publication_mode is distinct from target_publication_mode
     or receipt_row.run_id is distinct from target_run_id
     or receipt_row.run_token_hash is distinct from target_run_token_hash
     or receipt_row.source_summary_id is distinct from target_source_summary_id
     or receipt_row.source_kind is distinct from target_source_kind
     or receipt_row.question_sha256 is distinct from target_question_sha256
     or receipt_row.search_query_sha256 is distinct from
       target_search_query_sha256
     or receipt_row.source_policy is distinct from target_source_policy
     or receipt_row.provider_context_digest is distinct from
       target_preflight_context_digest then
    raise exception 'Google academic preflight renewal binding changed'
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
  if identity_gate.singleton is distinct from true
     or ai_gate.singleton is distinct from true
     or target_transport_enabled is distinct from true
     or identity_gate.google_operational_authorization_enabled
       is distinct from true
     or ai_gate.google_ai_child_grant_enabled is distinct from true then
    raise exception 'Google academic preflight renewal is disabled'
      using errcode = 'P7338';
  end if;

  required_actions := case when target_publication_mode = 'auto_unreviewed'
    then array['academic_answers', 'summaries']::text[]
    else array['academic_answers']::text[] end;
  authority_value := private.require_google_academic_live_authority_v1(
    context_value, target_lecture_session_id, required_actions
  );
  if authority_value is null then
    raise exception 'Google academic authority is unavailable for renewal'
      using errcode = 'P7335';
  end if;

  renewal_expires_at := least(
    statement_timestamp() + interval '2 minutes',
    (authority_value ->> 'lecture_hard_stop_at')::timestamptz,
    (authority_value ->> 'master_expires_at')::timestamptz,
    (authority_value ->> 'policy_valid_until')::timestamptz
  );
  if target_publication_mode = 'auto_unreviewed' then
    select run.* into run_row
    from public.lecture_summary_runs as run
    where run.id = target_run_id
      and run.lecture_session_id = target_lecture_session_id
      and run.actor_id = actor_value
      and run.token_hash = target_run_token_hash
      and run.status = 'running'
      and run.expires_at > statement_timestamp()
      and run.auto_academic_answers_enabled
      and run.academic_authority_mode = 'google_per_call'
      and run.academic_authorization_grant_id is null
    for update;
    if not found
       or not exists (
         select 1
         from private.admin_google_summary_auto_receipts as marker
         where marker.run_id = run_row.id
           and marker.action_name = 'start'
           and marker.principal_id = (context_value ->> 'principal_id')::uuid
           and marker.membership_id = (context_value ->> 'membership_id')::uuid
       ) then
      raise exception 'Google automatic academic run is unavailable for renewal'
        using errcode = 'P7335';
    end if;
    renewal_expires_at := least(renewal_expires_at, run_row.expires_at);
  end if;

  select request.* into request_row
  from public.academic_answer_requests as request
  where request.id = target_academic_request_id
    and request.lecture_session_id = target_lecture_session_id
    and request.requested_by_actor = actor_value
  for update;
  if not found
     or request_row.publication_mode is distinct from target_publication_mode
     or request_row.automation_run_id is distinct from target_run_id
     or request_row.idempotency_key is distinct from target_idempotency_key
     or request_row.source_kind is distinct from target_source_kind
     or request_row.source_summary_id is distinct from target_source_summary_id
     or request_row.question_sha256 is distinct from target_question_sha256
     or request_row.search_query_sha256 is distinct from
       target_search_query_sha256
     or request_row.requested_source_policy is distinct from
       target_source_policy then
    raise exception 'Google academic preflight renewal request is incomplete'
      using errcode = 'P7335';
  end if;
  if request_row.status <> 'evidence_checking'
     or request_row.operation_id is not null
     or request_row.source_set_sha256 is not null then
    return jsonb_build_object(
      'accepted', false,
      'academicRequestId', request_row.id,
      'preflightRequestId', receipt_row.request_id,
      'providerContextDigest', receipt_row.provider_context_digest,
      'reason', 'request_not_renewable',
      'requestStatus', request_row.status
    );
  end if;
  if renewal_expires_at <= statement_timestamp() then
    raise exception 'Google academic preflight renewal lease is unavailable'
      using errcode = 'P7335';
  end if;

  update public.academic_answer_requests as request
  set
    lease_until = renewal_expires_at,
    updated_at = statement_timestamp()
  where request.id = request_row.id
    and request.status = 'evidence_checking'
    and request.operation_id is null
    and request.source_set_sha256 is null
  returning * into request_row;
  if not found then
    raise exception 'Google academic preflight changed during renewal'
      using errcode = 'P7335';
  end if;

  return jsonb_build_object(
    'accepted', true,
    'academicRequestId', request_row.id,
    'leaseUntil', request_row.lease_until,
    'preflightRequestId', receipt_row.request_id,
    'providerContextDigest', receipt_row.provider_context_digest,
    'requestStatus', request_row.status
  );
end;
$$;

revoke all on function private.renew_google_admin_academic_answer_preflight_v1(
  text, uuid, uuid, text, text, integer, uuid, uuid, text, uuid, text, text,
  text, uuid, text, text, text, uuid, text, boolean
) from public, anon, authenticated, service_role;

create function public.renew_google_admin_academic_answer_preflight_v1(
  target_token_hash text,
  target_auth_user_id uuid,
  target_supabase_auth_session_id uuid,
  target_google_issuer text,
  target_provider_subject_hmac text,
  target_subject_pepper_version integer,
  target_lecture_session_id uuid,
  target_academic_request_id uuid,
  target_publication_mode text,
  target_run_id uuid,
  target_run_token_hash text,
  target_idempotency_key text,
  target_source_kind text,
  target_source_summary_id uuid,
  target_question_sha256 text,
  target_search_query_sha256 text,
  target_source_policy text,
  target_preflight_request_id uuid,
  target_preflight_context_digest text,
  target_transport_enabled boolean
)
returns jsonb
language sql
volatile
security definer
set search_path = ''
set statement_timeout = '8s'
set lock_timeout = '750ms'
as $$
  select private.renew_google_admin_academic_answer_preflight_v1(
    target_token_hash,
    target_auth_user_id,
    target_supabase_auth_session_id,
    target_google_issuer,
    target_provider_subject_hmac,
    target_subject_pepper_version,
    target_lecture_session_id,
    target_academic_request_id,
    target_publication_mode,
    target_run_id,
    target_run_token_hash,
    target_idempotency_key,
    target_source_kind,
    target_source_summary_id,
    target_question_sha256,
    target_search_query_sha256,
    target_source_policy,
    target_preflight_request_id,
    target_preflight_context_digest,
    target_transport_enabled
  );
$$;

revoke all on function public.renew_google_admin_academic_answer_preflight_v1(
  text, uuid, uuid, text, text, integer, uuid, uuid, text, uuid, text, text,
  text, uuid, text, text, text, uuid, text, boolean
) from public, anon, authenticated;
grant execute on function public.renew_google_admin_academic_answer_preflight_v1(
  text, uuid, uuid, text, text, integer, uuid, uuid, text, uuid, text, text,
  text, uuid, text, text, text, uuid, text, boolean
) to service_role;

create function private.google_academic_results_with_preflight_v1(
  target_lecture_session_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
set statement_timeout = '3s'
as $$
declare
  result_value jsonb;
  active_requests_value jsonb;
  answers_value jsonb;
begin
  result_value := private.phase72_admin_results_json(
    target_lecture_session_id
  );
  if result_value is null then
    return null;
  end if;

  select coalesce(
    jsonb_agg(
      request_item.value || jsonb_build_object(
        'preflight_request_id', receipt.request_id
      )
      order by request_item.ordinality
    ),
    '[]'::jsonb
  )
  into active_requests_value
  from jsonb_array_elements(
    coalesce(result_value -> 'active_requests', '[]'::jsonb)
  ) with ordinality as request_item(value, ordinality)
  left join private.admin_google_academic_answer_preflight_receipts as receipt
    on receipt.academic_request_id =
      nullif(request_item.value ->> 'id', '')::uuid
   and receipt.lecture_session_id = target_lecture_session_id;

  select coalesce(
    jsonb_agg(
      answer_item.value || jsonb_build_object(
        'preflight_request_id', receipt.request_id
      )
      order by answer_item.ordinality
    ),
    '[]'::jsonb
  )
  into answers_value
  from jsonb_array_elements(
    coalesce(result_value -> 'answers', '[]'::jsonb)
  ) with ordinality as answer_item(value, ordinality)
  left join private.admin_google_academic_answer_preflight_receipts as receipt
    on receipt.academic_request_id =
      nullif(answer_item.value ->> 'request_id', '')::uuid
   and receipt.lecture_session_id = target_lecture_session_id;

  return jsonb_set(
    jsonb_set(
      result_value,
      '{active_requests}',
      active_requests_value,
      true
    ),
    '{answers}',
    answers_value,
    true
  );
end;
$$;

revoke all on function private.google_academic_results_with_preflight_v1(uuid)
  from public, anon, authenticated, service_role;

create or replace function private.get_google_admin_academic_results_v1(
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
  perform private.assert_google_admin_operation_lecture_state_v1(
    context_value
  );
  return private.google_academic_results_with_preflight_v1(
    target_lecture_session_id
  );
end;
$$;

revoke all on function private.get_google_admin_academic_results_v1(
  text, uuid, uuid, text, text, integer, boolean, uuid
) from public, anon, authenticated, service_role;
