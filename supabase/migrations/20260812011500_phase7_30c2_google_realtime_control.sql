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

create trigger admin_google_operation_policies_immutable
before update or delete on private.admin_google_operation_policies
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
