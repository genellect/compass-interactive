-- Reject a delayed pre-dispatch failure once a concurrent request owns dispatch.
-- No new tables, API, privileges, or feature gates.
BEGIN;

create or replace function private.fail_google_admin_summary_window_operation_v1(
  target_token_hash text,
  target_auth_user_id uuid,
  target_supabase_auth_session_id uuid,
  target_google_issuer text,
  target_provider_subject_hmac text,
  target_subject_pepper_version integer,
  target_start_request_id uuid,
  target_operation_id uuid,
  target_status text,
  actual_microusd bigint,
  actual_input_tokens bigint,
  actual_output_tokens bigint,
  provider_request_id text,
  error_code text
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
  binding_row private.admin_google_summary_window_start_bindings%rowtype;
  dispatch_row private.admin_google_ai_provider_dispatch_receipts%rowtype;
  lecture_row public.lecture_sessions%rowtype;
  usage_row public.ai_usage_ledger%rowtype;
  settlement jsonb;
begin
  if target_status is null
     or target_status not in ('failed', 'cancelled')
     or actual_microusd is null
     or actual_input_tokens is null
     or actual_output_tokens is null
     or least(actual_microusd, actual_input_tokens, actual_output_tokens) < 0
     or (error_code is not null and char_length(error_code) > 120)
     or (provider_request_id is not null and char_length(provider_request_id) > 200) then
    raise exception 'invalid Google summary provider failure'
      using errcode = '22023';
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
  if evidence is null or evidence ->> 'feature' <> 'summaries' then
    return null;
  end if;

  select binding.*
  into binding_row
  from private.admin_google_summary_window_start_bindings as binding
  where binding.start_request_id = target_start_request_id
    and binding.operation_id = target_operation_id
    and binding.lecture_session_id = (evidence ->> 'lecture_session_id')::uuid;
  if not found then
    return null;
  end if;

  select receipt.*
  into dispatch_row
  from private.admin_google_ai_provider_dispatch_receipts as receipt
  where receipt.start_request_id = target_start_request_id
    and receipt.operation_id = target_operation_id;
  if (
    greatest(actual_microusd, actual_input_tokens, actual_output_tokens) > 0
    or provider_request_id is not null
    or coalesce(error_code, '') like '%ambiguous%'
  ) and dispatch_row.start_request_id is null then
    raise exception 'Google summary accounting lacks dispatch evidence'
      using errcode = 'P7335';
  end if;

  select lecture.*
  into lecture_row
  from public.lecture_sessions as lecture
  where lecture.id = binding_row.lecture_session_id
  for update;
  if not found then
    return null;
  end if;

  select usage.*
  into usage_row
  from public.ai_usage_ledger as usage
  where usage.id = target_operation_id
  for update;
  if not found
     or usage_row.feature <> 'summaries'
     or usage_row.requested_by_actor is distinct from (evidence ->> 'actor_id')
     or usage_row.idempotency_key is distinct from target_start_request_id::text then
    return null;
  end if;

  if usage_row.accounting_settled_at is not null then
    return jsonb_build_object(
      'accepted', true,
      'idempotentReplay', true,
      'operationId', usage_row.id,
      'status', usage_row.status
    );
  end if;

  -- A lost claim response must not let the non-dispatching request cancel
  -- another retry's paid operation. The settlement context holds the same
  -- start-request serialization lock as dispatch claim. A real HTTP 429 still
  -- carries its claim request ID and may legitimately settle zero usage.
  if dispatch_row.start_request_id is not null
     and target_status = 'failed'
     and provider_request_id is null
     and greatest(actual_microusd, actual_input_tokens, actual_output_tokens) = 0 then
    raise exception 'Google summary failure lacks dispatch ownership'
      using errcode = 'P7335';
  end if;

  if usage_row.status = 'running' and target_status = 'failed' then
    settlement := private.fail_summary_window_operation(
      target_operation_id,
      binding_row.run_id,
      evidence ->> 'actor_id',
      actual_microusd,
      actual_input_tokens,
      actual_output_tokens,
      provider_request_id,
      error_code
    );
  elsif usage_row.status = 'running' then
    settlement := private.finish_lecture_ai_operation(
      target_operation_id,
      'cancelled',
      actual_microusd,
      0,
      actual_input_tokens,
      actual_output_tokens,
      provider_request_id,
      error_code
    );
    update public.lecture_summary_windows as summary_window
    set
      status = 'discarded',
      current_operation_id = null,
      last_error_code = left(
        coalesce(error_code, 'summary_provider_cancelled'),
        120
      ),
      updated_at = statement_timestamp()
    where summary_window.id = binding_row.window_id
      and summary_window.run_id = binding_row.run_id
      and summary_window.current_operation_id = target_operation_id;
  else
    settlement := private.finish_lecture_ai_operation(
      target_operation_id,
      target_status,
      actual_microusd,
      0,
      actual_input_tokens,
      actual_output_tokens,
      provider_request_id,
      error_code
    );
  end if;

  return (settlement - 'results') || jsonb_build_object(
    'operationId', target_operation_id,
    'result_saved', false
  );
end;
$$;

revoke all on function private.fail_google_admin_summary_window_operation_v1(
  text, uuid, uuid, text, text, integer, uuid, uuid, text, bigint, bigint,
  bigint, text, text
) from public, anon, authenticated, service_role;

COMMIT;
