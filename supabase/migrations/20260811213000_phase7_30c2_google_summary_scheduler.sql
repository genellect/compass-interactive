-- Phase 7.30C2: Google Admin lecture-summary scheduler authority.
--
-- Starting or resuming the five-minute scheduler is not itself a provider
-- call. It therefore consumes no billing child. Every actual summary window
-- will receive its own short-lived child and provider dispatch evidence in the
-- following tranche. Exact retries return the same deterministic run binding.

drop trigger admin_google_operation_policies_immutable
  on private.admin_google_operation_policies;

update private.admin_google_operation_policies
set operation_class = 'write'
where operation_key in (
  'manage-lecture-summaries.start',
  'manage-lecture-summaries.resume'
);

update private.admin_google_operation_policies
set lecture_lock_mode = 'update'
where operation_key = 'manage-lecture-summaries.stop';

create trigger admin_google_operation_policies_immutable
before update or delete on private.admin_google_operation_policies
for each row execute function private.reject_admin_c1_evidence_mutation_v1();

create table private.admin_google_summary_run_receipts (
  request_id uuid primary key,
  action_name text not null check (
    action_name in ('start', 'resume', 'stop')
  ),
  intent_digest text not null check (intent_digest ~ '^[0-9a-f]{64}$'),
  environment_id uuid not null
    references private.admin_environments(id) on delete restrict,
  principal_id uuid not null
    references private.admin_principals(id) on delete restrict,
  membership_id uuid not null
    references private.admin_environment_memberships(id) on delete restrict,
  admin_session_id uuid not null
    references public.admin_sessions(id) on delete restrict,
  supabase_auth_session_id uuid not null,
  auth_user_id uuid not null,
  lecture_session_id uuid not null
    references public.lecture_sessions(id) on delete restrict,
  master_authorization_id uuid
    references public.lecture_ai_master_authorizations(id) on delete restrict,
  run_id uuid
    references public.lecture_summary_runs(id) on delete restrict,
  run_token_hash text check (
    run_token_hash is null or run_token_hash ~ '^[0-9a-f]{64}$'
  ),
  academic_source_policy text check (
    academic_source_policy is null or academic_source_policy in (
      'auto', 'biomedical_pubmed', 'multidisciplinary_doi'
    )
  ),
  stop_reason text check (
    stop_reason is null or char_length(stop_reason) between 1 and 120
  ),
  result_status text not null check (
    result_status in ('running', 'stopped', 'already_stopped')
  ),
  completed_at timestamptz not null default statement_timestamp(),
  check (
    (
      action_name in ('start', 'resume')
      and master_authorization_id is not null
      and run_id is not null
      and run_token_hash is not null
      and stop_reason is null
      and result_status = 'running'
      and (
        (action_name = 'start' and academic_source_policy is not null)
        or (action_name = 'resume' and academic_source_policy is null)
      )
    )
    or (
      action_name = 'stop'
      and master_authorization_id is null
      and run_token_hash is null
      and academic_source_policy is null
      and stop_reason is not null
      and result_status in ('stopped', 'already_stopped')
    )
  )
);

create index admin_google_summary_run_receipts_environment_idx
  on private.admin_google_summary_run_receipts (
    environment_id, completed_at desc, request_id
  );
create index admin_google_summary_run_receipts_principal_idx
  on private.admin_google_summary_run_receipts (
    principal_id, completed_at desc, request_id
  );
create index admin_google_summary_run_receipts_membership_idx
  on private.admin_google_summary_run_receipts (
    membership_id, completed_at desc, request_id
  );
create index admin_google_summary_run_receipts_session_idx
  on private.admin_google_summary_run_receipts (
    admin_session_id, completed_at desc, request_id
  );
create index admin_google_summary_run_receipts_lecture_idx
  on private.admin_google_summary_run_receipts (
    lecture_session_id, completed_at desc, request_id
  );
create index admin_google_summary_run_receipts_master_idx
  on private.admin_google_summary_run_receipts (
    master_authorization_id, completed_at desc, request_id
  );
create index admin_google_summary_run_receipts_run_idx
  on private.admin_google_summary_run_receipts (
    run_id, completed_at desc, request_id
  );

alter table private.admin_google_summary_run_receipts enable row level security;
revoke all on private.admin_google_summary_run_receipts
  from public, anon, authenticated, service_role;

create trigger admin_google_summary_run_receipts_append_only
before update or delete on private.admin_google_summary_run_receipts
for each row execute function private.reject_admin_c1_evidence_mutation_v1();

create function private.google_summary_run_intent_digest_v1(
  target_request_id uuid,
  target_admin_session_id uuid,
  target_lecture_session_id uuid,
  target_action text,
  target_run_token_hash text,
  target_auto_academic_answers_enabled boolean,
  target_academic_source_policy text,
  target_reason text
)
returns text
language sql
immutable
security definer
set search_path = ''
as $$
  select case
    when target_request_id is null
      or target_admin_session_id is null
      or target_lecture_session_id is null
      or target_action is null
      or target_action not in ('start', 'resume', 'stop')
      then null
    else pg_catalog.encode(
      extensions.digest(
        pg_catalog.convert_to(
          'compass:phase7.30c2:google-summary-run:v1'
          || '|request=' || target_request_id::text
          || '|session=' || target_admin_session_id::text
          || '|lecture=' || target_lecture_session_id::text
          || '|action=' || target_action
          || '|run_token_hash=' || coalesce(target_run_token_hash, '-')
          || '|auto_academic=' || coalesce(
            target_auto_academic_answers_enabled::text, '-'
          )
          || '|source_policy=' || coalesce(target_academic_source_policy, '-')
          || '|reason=' || coalesce(target_reason, '-'),
          'UTF8'
        ),
        'sha256'
      ),
      'hex'
    )
  end;
$$;

revoke all on function private.google_summary_run_intent_digest_v1(
  uuid, uuid, uuid, text, text, boolean, text, text
) from public, anon, authenticated, service_role;

create function private.manage_google_admin_summary_run_v1(
  target_token_hash text,
  target_auth_user_id uuid,
  target_supabase_auth_session_id uuid,
  target_google_issuer text,
  target_provider_subject_hmac text,
  target_subject_pepper_version integer,
  target_lecture_session_id uuid,
  target_action text,
  target_run_token_hash text,
  target_auto_academic_answers_enabled boolean,
  target_academic_source_policy text,
  target_reason text,
  target_request_id uuid,
  target_transport_enabled boolean
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
  receipt_row private.admin_google_summary_run_receipts%rowtype;
  ownership_row private.admin_lecture_ownerships%rowtype;
  identity_gate private.admin_identity_runtime_gate%rowtype;
  ai_gate private.admin_ai_unlock_runtime_gate%rowtype;
  policy_row private.admin_ai_policies%rowtype;
  master_snapshot public.lecture_ai_master_authorizations%rowtype;
  master_row public.lecture_ai_master_authorizations%rowtype;
  lecture_row public.lecture_sessions%rowtype;
  control_row public.lecture_ai_control%rowtype;
  run_row public.lecture_summary_runs%rowtype;
  result_value jsonb;
  intent_digest_value text;
  actor_value text;
  normalized_reason text;
  effective_now timestamptz := statement_timestamp();
begin
  normalized_reason := nullif(trim(target_reason), '');
  if target_request_id is null
     or target_lecture_session_id is null
     or target_action is null
     or target_action not in ('start', 'resume', 'stop')
     or target_transport_enabled is null
     or (
       target_action = 'start'
       and (
         target_run_token_hash is null
         or target_run_token_hash !~ '^[0-9a-f]{64}$'
         or target_auto_academic_answers_enabled is distinct from false
         or target_academic_source_policy is null
         or target_academic_source_policy not in (
           'auto', 'biomedical_pubmed', 'multidisciplinary_doi'
         )
         or target_reason is not null
       )
     )
     or (
       target_action = 'resume'
       and (
         target_run_token_hash is null
         or target_run_token_hash !~ '^[0-9a-f]{64}$'
         or target_auto_academic_answers_enabled is not null
         or target_academic_source_policy is not null
         or target_reason is not null
       )
     )
     or (
       target_action = 'stop'
       and (
         target_run_token_hash is not null
         or target_auto_academic_answers_enabled is not null
         or target_academic_source_policy is not null
         or normalized_reason is null
         or char_length(normalized_reason) > 120
       )
     ) then
    return null;
  end if;

  perform private.serialize_admin_ai_request_v1(target_request_id);

  if target_action = 'stop' then
    context_value := private.require_google_admin_operation_context_v1(
      target_token_hash,
      target_auth_user_id,
      target_supabase_auth_session_id,
      target_google_issuer,
      target_provider_subject_hmac,
      target_subject_pepper_version,
      'manage-lecture-summaries.stop',
      target_lecture_session_id
    );
  else
    context_value := private.require_google_ai_provider_context_v1(
      target_token_hash,
      target_auth_user_id,
      target_supabase_auth_session_id,
      target_google_issuer,
      target_provider_subject_hmac,
      target_subject_pepper_version
    );
  end if;
  if context_value is null then
    return null;
  end if;

  actor_value := 'admin-session:' || (context_value ->> 'admin_session_id');
  intent_digest_value := private.google_summary_run_intent_digest_v1(
    target_request_id,
    (context_value ->> 'admin_session_id')::uuid,
    target_lecture_session_id,
    target_action,
    target_run_token_hash,
    target_auto_academic_answers_enabled,
    target_academic_source_policy,
    normalized_reason
  );
  if intent_digest_value is null then
    return null;
  end if;

  select receipt.*
  into receipt_row
  from private.admin_google_summary_run_receipts as receipt
  where receipt.request_id = target_request_id;
  if found then
    if receipt_row.action_name is distinct from target_action
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
       or receipt_row.lecture_session_id is distinct from
         target_lecture_session_id
       or receipt_row.run_token_hash is distinct from target_run_token_hash
       or receipt_row.academic_source_policy is distinct from
         target_academic_source_policy
       or receipt_row.stop_reason is distinct from normalized_reason then
      raise exception 'Google summary request binding changed on retry'
        using errcode = 'P7335';
    end if;

    if receipt_row.run_id is not null then
      select run.*
      into run_row
      from public.lecture_summary_runs as run
      where run.id = receipt_row.run_id
        and run.lecture_session_id = receipt_row.lecture_session_id;
      if not found then
        raise exception 'Google summary run receipt is incomplete'
          using errcode = 'P7335';
      end if;
    end if;

    return jsonb_build_object(
      'accepted', true,
      'actorId', actor_value,
      'idempotentReplay', true,
      'refreshRequired',
        receipt_row.run_token_hash is not null
        and run_row.token_hash is distinct from receipt_row.run_token_hash,
      'resultStatus', receipt_row.result_status,
      'run', case when run_row.id is null then null
        else to_jsonb(run_row) - 'token_hash' end
    );
  end if;

  if target_action = 'stop' then
    perform private.assert_google_admin_operation_lecture_state_v1(
      context_value
    );
    select run.*
    into run_row
    from public.lecture_summary_runs as run
    where run.lecture_session_id = target_lecture_session_id
      and run.status = 'running';

    result_value := private.stop_lecture_summary_run(
      target_lecture_session_id,
      coalesce(run_row.actor_id, actor_value),
      normalized_reason
    );
    if coalesce((result_value ->> 'accepted')::boolean, false) is not true then
      raise exception 'Google summary stop was rejected: %',
        coalesce(result_value ->> 'reason', 'unknown')
        using errcode = 'P7335';
    end if;
    if run_row.id is not null then
      select run.*
      into run_row
      from public.lecture_summary_runs as run
      where run.id = run_row.id;
    end if;

    insert into private.admin_google_summary_run_receipts (
      request_id, action_name, intent_digest, environment_id, principal_id,
      membership_id, admin_session_id, supabase_auth_session_id, auth_user_id,
      lecture_session_id, master_authorization_id, run_id, run_token_hash,
      academic_source_policy, stop_reason, result_status, completed_at
    ) values (
      target_request_id, target_action, intent_digest_value,
      (context_value ->> 'environment_id')::uuid,
      (context_value ->> 'principal_id')::uuid,
      (context_value ->> 'membership_id')::uuid,
      (context_value ->> 'admin_session_id')::uuid,
      target_supabase_auth_session_id, target_auth_user_id,
      target_lecture_session_id, null, run_row.id, null, null,
      normalized_reason,
      case when run_row.id is null then 'already_stopped' else 'stopped' end,
      effective_now
    ) returning * into receipt_row;

    return (result_value - 'results') || jsonb_build_object(
      'actorId', actor_value,
      'idempotentReplay', false,
      'refreshRequired', false,
      'resultStatus', receipt_row.result_status,
      'run', case when run_row.id is null then null
        else to_jsonb(run_row) - 'token_hash' end
    );
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
    raise exception 'Google summary scheduling is disabled'
      using errcode = 'P7338';
  end if;

  select ownership.*
  into ownership_row
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

  select master.*
  into master_snapshot
  from public.lecture_ai_master_authorizations as master
  where master.lecture_session_id = target_lecture_session_id
    and master.status = 'active';
  if not found or master_snapshot.ai_policy_id is null then
    raise exception 'Google AI master is unavailable' using errcode = 'P7335';
  end if;

  perform private.serialize_admin_ai_scope_v1(
    'policy-membership',
    (context_value ->> 'membership_id')::uuid
  );
  select policy.*
  into policy_row
  from private.admin_ai_policies as policy
  where policy.id = master_snapshot.ai_policy_id
    and policy.version = master_snapshot.ai_policy_version
    and policy.environment_id = (context_value ->> 'environment_id')::uuid
    and policy.membership_id = (context_value ->> 'membership_id')::uuid
  for update;
  if not found
     or policy_row.status <> 'active'
     or policy_row.valid_from > effective_now
     or policy_row.valid_until <= effective_now
     or not array['summaries']::text[] <@ policy_row.allowed_actions then
    raise exception 'AI policy is unavailable' using errcode = 'P7335';
  end if;

  select lecture.*
  into lecture_row
  from public.lecture_sessions as lecture
  where lecture.id = target_lecture_session_id
  for update;
  if not found
     or lecture_row.status <> 'open'
     or lecture_row.started_at is null
     or lecture_row.hard_stop_at is null
     or lecture_row.hard_stop_at <= effective_now then
    raise exception 'lecture is not open' using errcode = 'P7335';
  end if;

  select master.*
  into master_row
  from public.lecture_ai_master_authorizations as master
  where master.id = master_snapshot.id
    and master.lecture_session_id = target_lecture_session_id
  for update;
  if not found
     or master_row.status <> 'active'
     or master_row.expires_at <= effective_now
     or master_row.principal_id is distinct from
       (context_value ->> 'principal_id')::uuid
     or master_row.membership_id is distinct from
       (context_value ->> 'membership_id')::uuid
     or master_row.issuing_admin_session_id is distinct from
       (context_value ->> 'admin_session_id')::uuid
     or master_row.actor_id is distinct from actor_value
     or master_row.ai_policy_id is distinct from policy_row.id
     or master_row.ai_policy_version is distinct from policy_row.version
     or not array['summaries']::text[] <@ master_row.actions
     or not exists (
       select 1
       from private.admin_ai_master_admission_receipts as marker
       where marker.master_authorization_id = master_row.id
         and marker.principal_id = master_row.principal_id
         and marker.membership_id = master_row.membership_id
         and marker.admin_session_id = master_row.issuing_admin_session_id
         and marker.policy_id = master_row.ai_policy_id
         and marker.policy_version = master_row.ai_policy_version
     ) then
    raise exception 'Google AI master is unavailable' using errcode = 'P7335';
  end if;

  select control.*
  into control_row
  from public.lecture_ai_control as control
  where control.lecture_session_id = target_lecture_session_id
  for update;
  if not found then
    raise exception 'AI control is not configured' using errcode = 'P7335';
  end if;

  if target_action = 'start' then
    select run.*
    into run_row
    from public.lecture_summary_runs as run
    where run.lecture_session_id = target_lecture_session_id
      and run.status = 'running'
    for update;
    if found then
      return jsonb_build_object(
        'accepted', false,
        'reason', 'summary_run_already_active',
        'results', private.phase6_admin_results_json(target_lecture_session_id)
      );
    end if;

    update public.lecture_ai_control as control
    set
      summaries_enabled = true,
      status = case when exists (
        select 1
        from public.ai_usage_ledger as usage
        where usage.lecture_session_id = target_lecture_session_id
          and usage.status = 'running'
      ) then 'running' else 'ready' end,
      stop_requested_at = null,
      stopped_at = null,
      stop_reason = null,
      version = control.version + 1,
      updated_at = effective_now
    where control.lecture_session_id = target_lecture_session_id;

    insert into public.lecture_summary_runs (
      lecture_session_id, actor_id, token_hash, expires_at,
      auto_academic_answers_enabled, academic_source_policy,
      academic_authorization_grant_id, previous_academic_answers_enabled
    ) values (
      target_lecture_session_id, actor_value, target_run_token_hash,
      least(lecture_row.hard_stop_at, master_row.expires_at, policy_row.valid_until),
      false, target_academic_source_policy, null,
      control_row.academic_answers_enabled
    ) returning * into run_row;
  else
    select run.*
    into run_row
    from public.lecture_summary_runs as run
    where run.lecture_session_id = target_lecture_session_id
      and run.status = 'running'
      and run.expires_at > effective_now
    for update;
    if not found
       or run_row.auto_academic_answers_enabled
       or run_row.academic_authorization_grant_id is not null
       or not exists (
         select 1
         from private.admin_google_summary_run_receipts as prior
         where prior.run_id = run_row.id
           and prior.action_name = 'start'
           and prior.principal_id = (context_value ->> 'principal_id')::uuid
           and prior.membership_id = (context_value ->> 'membership_id')::uuid
       ) then
      return jsonb_build_object(
        'accepted', false,
        'reason', 'summary_run_not_active',
        'results', private.phase6_admin_results_json(target_lecture_session_id)
      );
    end if;

    update public.lecture_ai_control as control
    set
      summaries_enabled = true,
      status = case when exists (
        select 1
        from public.ai_usage_ledger as usage
        where usage.lecture_session_id = target_lecture_session_id
          and usage.status = 'running'
      ) then 'running' else 'ready' end,
      stop_requested_at = null,
      stopped_at = null,
      stop_reason = null,
      version = control.version + 1,
      updated_at = effective_now
    where control.lecture_session_id = target_lecture_session_id;

    update public.lecture_summary_runs as run
    set
      actor_id = actor_value,
      token_hash = target_run_token_hash,
      expires_at = least(
        run.expires_at,
        lecture_row.hard_stop_at,
        master_row.expires_at,
        policy_row.valid_until
      ),
      updated_at = effective_now
    where run.id = run_row.id
    returning * into run_row;
  end if;

  insert into private.admin_google_summary_run_receipts (
    request_id, action_name, intent_digest, environment_id, principal_id,
    membership_id, admin_session_id, supabase_auth_session_id, auth_user_id,
    lecture_session_id, master_authorization_id, run_id, run_token_hash,
    academic_source_policy, stop_reason, result_status, completed_at
  ) values (
    target_request_id, target_action, intent_digest_value,
    (context_value ->> 'environment_id')::uuid,
    (context_value ->> 'principal_id')::uuid,
    (context_value ->> 'membership_id')::uuid,
    (context_value ->> 'admin_session_id')::uuid,
    target_supabase_auth_session_id, target_auth_user_id,
    target_lecture_session_id, master_row.id, run_row.id,
    target_run_token_hash,
    case when target_action = 'start' then target_academic_source_policy
      else null end,
    null, 'running', effective_now
  ) returning * into receipt_row;

  return jsonb_build_object(
    'accepted', true,
    'actorId', actor_value,
    'idempotentReplay', false,
    'refreshRequired', false,
    'resultStatus', receipt_row.result_status,
    'run', to_jsonb(run_row) - 'token_hash',
    'results', private.phase6_admin_results_json(target_lecture_session_id)
  );
end;
$$;

revoke all on function private.manage_google_admin_summary_run_v1(
  text, uuid, uuid, text, text, integer, uuid, text, text, boolean, text,
  text, uuid, boolean
) from public, anon, authenticated, service_role;

create function public.manage_google_admin_summary_run_v1(
  target_token_hash text,
  target_auth_user_id uuid,
  target_supabase_auth_session_id uuid,
  target_google_issuer text,
  target_provider_subject_hmac text,
  target_subject_pepper_version integer,
  target_lecture_session_id uuid,
  target_action text,
  target_run_token_hash text,
  target_auto_academic_answers_enabled boolean,
  target_academic_source_policy text,
  target_reason text,
  target_request_id uuid,
  target_transport_enabled boolean
)
returns jsonb
language sql
volatile
security definer
set search_path = ''
set statement_timeout = '5s'
set lock_timeout = '750ms'
as $$
  select private.manage_google_admin_summary_run_v1(
    target_token_hash,
    target_auth_user_id,
    target_supabase_auth_session_id,
    target_google_issuer,
    target_provider_subject_hmac,
    target_subject_pepper_version,
    target_lecture_session_id,
    target_action,
    target_run_token_hash,
    target_auto_academic_answers_enabled,
    target_academic_source_policy,
    target_reason,
    target_request_id,
    target_transport_enabled
  );
$$;

revoke all on function public.manage_google_admin_summary_run_v1(
  text, uuid, uuid, text, text, integer, uuid, text, text, boolean, text,
  text, uuid, boolean
) from public, anon, authenticated;
grant execute on function public.manage_google_admin_summary_run_v1(
  text, uuid, uuid, text, text, integer, uuid, text, text, boolean, text,
  text, uuid, boolean
) to service_role;

comment on table private.admin_google_summary_run_receipts is
  'Append-only Google Admin summary scheduler evidence. It stores only hashes and identifiers; no raw run token, bearer, PIN, provider payload or lecture content.';

comment on function public.manage_google_admin_summary_run_v1(
  text, uuid, uuid, text, text, integer, uuid, text, text, boolean, text,
  text, uuid, boolean
) is
  'Service-only Google Admin summary scheduler facade. Start and resume consume no provider child; stop remains available when admission gates are disabled.';
