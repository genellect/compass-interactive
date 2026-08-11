-- Phase 7.30C2: Google Admin academic-answer provider authority.
--
-- The summary scheduler remains grant-free. Each manual or automatic academic
-- answer provider call receives its own C1-derived child grant, immutable
-- preflight/start/dispatch evidence and a typed settlement path. Raw bearer,
-- run token, child nonce, question/search content, source abstracts and provider
-- payloads are never stored in the private evidence relations.

alter table private.admin_google_ai_provider_start_intents
  drop constraint admin_google_ai_provider_start_intents_feature_check;
alter table private.admin_google_ai_provider_start_intents
  add constraint admin_google_ai_provider_start_intents_feature_check check (
    feature in (
      'academic_answers', 'material_analysis', 'poll_suggestions', 'summaries'
    )
  );

alter table public.lecture_summary_runs
  add column academic_authority_mode text not null default 'none'
    check (academic_authority_mode in (
      'none', 'legacy_run_grant', 'google_per_call'
    ));

update public.lecture_summary_runs
set academic_authority_mode = case
  when auto_academic_answers_enabled then 'legacy_run_grant'
  else 'none'
end;

alter table public.lecture_summary_runs
  drop constraint lecture_summary_runs_academic_authorization_check;
alter table public.lecture_summary_runs
  add constraint lecture_summary_runs_academic_authorization_check check (
    (
      not auto_academic_answers_enabled
      and academic_authorization_grant_id is null
      and academic_authority_mode = 'none'
    )
    or (
      auto_academic_answers_enabled
      and academic_authorization_grant_id is not null
      and academic_authority_mode = 'legacy_run_grant'
    )
    or (
      auto_academic_answers_enabled
      and academic_authorization_grant_id is null
      and academic_authority_mode = 'google_per_call'
    )
  );

create function private.normalize_summary_academic_authority_mode_v1()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if new.auto_academic_answers_enabled
     and new.academic_authorization_grant_id is not null
     and new.academic_authority_mode = 'none' then
    new.academic_authority_mode := 'legacy_run_grant';
  elsif not new.auto_academic_answers_enabled
        and new.academic_authorization_grant_id is null
        and new.academic_authority_mode <> 'none' then
    new.academic_authority_mode := 'none';
  end if;
  return new;
end;
$$;

revoke all on function private.normalize_summary_academic_authority_mode_v1()
  from public, anon, authenticated, service_role;

create trigger lecture_summary_runs_academic_authority_mode
before insert or update of auto_academic_answers_enabled,
  academic_authorization_grant_id, academic_authority_mode
on public.lecture_summary_runs
for each row execute function private.normalize_summary_academic_authority_mode_v1();

create table private.admin_google_summary_auto_receipts (
  request_id uuid primary key,
  action_name text not null check (action_name in ('start', 'resume')),
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
  master_authorization_id uuid not null
    references public.lecture_ai_master_authorizations(id) on delete restrict,
  run_id uuid not null
    references public.lecture_summary_runs(id) on delete restrict,
  run_token_hash text not null check (run_token_hash ~ '^[0-9a-f]{64}$'),
  academic_source_policy text not null check (
    academic_source_policy in (
      'auto', 'biomedical_pubmed', 'multidisciplinary_doi'
    )
  ),
  completed_at timestamptz not null default statement_timestamp()
);

create index admin_google_summary_auto_environment_idx
  on private.admin_google_summary_auto_receipts (
    environment_id, completed_at desc, request_id
  );
create index admin_google_summary_auto_principal_idx
  on private.admin_google_summary_auto_receipts (
    principal_id, completed_at desc, request_id
  );
create index admin_google_summary_auto_membership_idx
  on private.admin_google_summary_auto_receipts (
    membership_id, completed_at desc, request_id
  );
create index admin_google_summary_auto_session_idx
  on private.admin_google_summary_auto_receipts (
    admin_session_id, completed_at desc, request_id
  );
create index admin_google_summary_auto_lecture_idx
  on private.admin_google_summary_auto_receipts (
    lecture_session_id, completed_at desc, request_id
  );
create index admin_google_summary_auto_master_idx
  on private.admin_google_summary_auto_receipts (
    master_authorization_id, completed_at desc, request_id
  );
create index admin_google_summary_auto_run_idx
  on private.admin_google_summary_auto_receipts (
    run_id, completed_at desc, request_id
  );

create table private.admin_google_academic_answer_preflight_receipts (
  request_id uuid primary key,
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
  academic_request_id uuid not null unique
    references public.academic_answer_requests(id) on delete restrict,
  publication_mode text not null check (
    publication_mode in ('manual_review', 'auto_unreviewed')
  ),
  run_id uuid references public.lecture_summary_runs(id) on delete restrict,
  run_token_hash text check (
    run_token_hash is null or run_token_hash ~ '^[0-9a-f]{64}$'
  ),
  source_summary_id uuid
    references public.lecture_ai_summaries(id) on delete restrict,
  source_kind text not null check (
    source_kind in ('summary_candidate', 'teacher_selected')
  ),
  question_sha256 text not null check (question_sha256 ~ '^[0-9a-f]{64}$'),
  search_query_sha256 text not null
    check (search_query_sha256 ~ '^[0-9a-f]{64}$'),
  source_policy text not null check (
    source_policy in ('auto', 'biomedical_pubmed', 'multidisciplinary_doi')
  ),
  retrieval_version text not null check (
    retrieval_version = 'phase7-25-retrieval-v1'
  ),
  provider_context_digest text not null
    check (provider_context_digest ~ '^[0-9a-f]{64}$'),
  result_status text not null check (result_status = 'prepared'),
  created_at timestamptz not null default statement_timestamp(),
  check (
    (
      publication_mode = 'manual_review'
      and run_id is null
      and run_token_hash is null
    )
    or (
      publication_mode = 'auto_unreviewed'
      and run_id is not null
      and run_token_hash is not null
      and source_kind = 'summary_candidate'
      and source_summary_id is not null
    )
  )
);

create index admin_google_academic_preflight_environment_idx
  on private.admin_google_academic_answer_preflight_receipts (
    environment_id, created_at desc, request_id
  );
create index admin_google_academic_preflight_principal_idx
  on private.admin_google_academic_answer_preflight_receipts (
    principal_id, created_at desc, request_id
  );
create index admin_google_academic_preflight_membership_idx
  on private.admin_google_academic_answer_preflight_receipts (
    membership_id, created_at desc, request_id
  );
create index admin_google_academic_preflight_session_idx
  on private.admin_google_academic_answer_preflight_receipts (
    admin_session_id, created_at desc, request_id
  );
create index admin_google_academic_preflight_lecture_idx
  on private.admin_google_academic_answer_preflight_receipts (
    lecture_session_id, created_at desc, request_id
  );
create index admin_google_academic_preflight_request_idx
  on private.admin_google_academic_answer_preflight_receipts (
    academic_request_id, created_at desc
  );
create index admin_google_academic_preflight_run_idx
  on private.admin_google_academic_answer_preflight_receipts (
    run_id, created_at desc, request_id
  );
create index admin_google_academic_preflight_summary_idx
  on private.admin_google_academic_answer_preflight_receipts (
    source_summary_id, created_at desc, request_id
  );

create table private.admin_google_academic_answer_start_bindings (
  start_request_id uuid primary key
    references private.admin_google_ai_provider_start_receipts(start_request_id)
    on delete restrict deferrable initially deferred,
  operation_id uuid not null unique
    references public.ai_usage_ledger(id) on delete restrict,
  preflight_request_id uuid not null unique
    references private.admin_google_academic_answer_preflight_receipts(request_id)
    on delete restrict,
  lecture_session_id uuid not null
    references public.lecture_sessions(id) on delete restrict,
  academic_request_id uuid not null unique
    references public.academic_answer_requests(id) on delete restrict,
  run_id uuid references public.lecture_summary_runs(id) on delete restrict,
  publication_mode text not null check (
    publication_mode in ('manual_review', 'auto_unreviewed')
  ),
  source_set_sha256 text not null check (source_set_sha256 ~ '^[0-9a-f]{64}$'),
  resolved_source_route text not null check (
    resolved_source_route in ('biomedical_pubmed', 'multidisciplinary_doi')
  ),
  verified_source_count integer not null check (
    verified_source_count between 1 and 5
  ),
  verified_primary_count integer not null check (
    verified_primary_count between 1 and verified_source_count
  ),
  preflight_context_digest text not null
    check (preflight_context_digest ~ '^[0-9a-f]{64}$'),
  provider_payload_sha256 text not null
    check (provider_payload_sha256 ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default statement_timestamp(),
  check (
    (publication_mode = 'manual_review' and run_id is null)
    or (publication_mode = 'auto_unreviewed' and run_id is not null)
  )
);

create index admin_google_academic_bindings_operation_idx
  on private.admin_google_academic_answer_start_bindings (
    operation_id, created_at desc
  );
create index admin_google_academic_bindings_preflight_idx
  on private.admin_google_academic_answer_start_bindings (
    preflight_request_id, created_at desc
  );
create index admin_google_academic_bindings_lecture_idx
  on private.admin_google_academic_answer_start_bindings (
    lecture_session_id, created_at desc, start_request_id
  );
create index admin_google_academic_bindings_request_idx
  on private.admin_google_academic_answer_start_bindings (
    academic_request_id, created_at desc
  );
create index admin_google_academic_bindings_run_idx
  on private.admin_google_academic_answer_start_bindings (
    run_id, created_at desc, start_request_id
  );

alter table private.admin_google_summary_auto_receipts enable row level security;
alter table private.admin_google_academic_answer_preflight_receipts
  enable row level security;
alter table private.admin_google_academic_answer_start_bindings
  enable row level security;

revoke all on private.admin_google_summary_auto_receipts
  from public, anon, authenticated, service_role;
revoke all on private.admin_google_academic_answer_preflight_receipts
  from public, anon, authenticated, service_role;
revoke all on private.admin_google_academic_answer_start_bindings
  from public, anon, authenticated, service_role;

create trigger admin_google_summary_auto_receipts_append_only
before update or delete on private.admin_google_summary_auto_receipts
for each row execute function private.reject_admin_c1_evidence_mutation_v1();

create trigger admin_google_academic_preflight_receipts_append_only
before update or delete on private.admin_google_academic_answer_preflight_receipts
for each row execute function private.reject_admin_c1_evidence_mutation_v1();

create trigger admin_google_academic_start_bindings_append_only
before update or delete on private.admin_google_academic_answer_start_bindings
for each row execute function private.reject_admin_c1_evidence_mutation_v1();

-- Google summary automation never owns a run-wide paid grant. The existing v1
-- scheduler remains the non-auto/stop core; v2 adds one atomic, append-only
-- proof that an auto-enabled run is authorized for both summaries and academic
-- answers while each later answer still receives its own child grant.
create function private.manage_google_admin_summary_run_v2(
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
set statement_timeout = '8s'
set lock_timeout = '750ms'
as $$
declare
  run_snapshot public.lecture_summary_runs%rowtype;
  run_row public.lecture_summary_runs%rowtype;
  summary_receipt private.admin_google_summary_run_receipts%rowtype;
  auto_receipt private.admin_google_summary_auto_receipts%rowtype;
  context_value jsonb;
  ownership_row private.admin_lecture_ownerships%rowtype;
  identity_gate private.admin_identity_runtime_gate%rowtype;
  ai_gate private.admin_ai_unlock_runtime_gate%rowtype;
  policy_row private.admin_ai_policies%rowtype;
  master_snapshot public.lecture_ai_master_authorizations%rowtype;
  master_row public.lecture_ai_master_authorizations%rowtype;
  lecture_row public.lecture_sessions%rowtype;
  control_row public.lecture_ai_control%rowtype;
  result_value jsonb;
  intent_digest_value text;
  actor_value text;
  requires_academic boolean;
  effective_now timestamptz := statement_timestamp();
begin
  if target_action = 'stop'
     or (
       target_action = 'start'
       and target_auto_academic_answers_enabled is distinct from true
     ) then
    return private.manage_google_admin_summary_run_v1(
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
  end if;

  if target_action = 'resume' then
    select run.*
    into run_snapshot
    from public.lecture_summary_runs as run
    where run.lecture_session_id = target_lecture_session_id
      and run.status = 'running';
    if not found or run_snapshot.academic_authority_mode <> 'google_per_call' then
      return private.manage_google_admin_summary_run_v1(
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
    end if;
  end if;

  if target_request_id is null
     or target_lecture_session_id is null
     or target_run_token_hash is null
     or target_run_token_hash !~ '^[0-9a-f]{64}$'
     or target_transport_enabled is null
     or (
       target_action = 'start'
       and (
         target_auto_academic_answers_enabled is distinct from true
         or target_academic_source_policy not in (
           'auto', 'biomedical_pubmed', 'multidisciplinary_doi'
         )
         or target_reason is not null
       )
     )
     or (
       target_action = 'resume'
       and (
         target_auto_academic_answers_enabled is not null
         or target_academic_source_policy is not null
         or target_reason is not null
       )
     )
     or target_action not in ('start', 'resume') then
    return null;
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
  intent_digest_value := private.google_summary_run_intent_digest_v1(
    target_request_id,
    (context_value ->> 'admin_session_id')::uuid,
    target_lecture_session_id,
    target_action,
    target_run_token_hash,
    target_auto_academic_answers_enabled,
    target_academic_source_policy,
    null
  );
  if intent_digest_value is null then
    return null;
  end if;

  select receipt.*
  into auto_receipt
  from private.admin_google_summary_auto_receipts as receipt
  where receipt.request_id = target_request_id;
  if found then
    if auto_receipt.action_name is distinct from target_action
       or auto_receipt.intent_digest is distinct from intent_digest_value
       or auto_receipt.environment_id is distinct from
         (context_value ->> 'environment_id')::uuid
       or auto_receipt.principal_id is distinct from
         (context_value ->> 'principal_id')::uuid
       or auto_receipt.membership_id is distinct from
         (context_value ->> 'membership_id')::uuid
       or auto_receipt.admin_session_id is distinct from
         (context_value ->> 'admin_session_id')::uuid
       or auto_receipt.supabase_auth_session_id is distinct from
         target_supabase_auth_session_id
       or auto_receipt.auth_user_id is distinct from target_auth_user_id
       or auto_receipt.lecture_session_id is distinct from
         target_lecture_session_id
       or auto_receipt.run_token_hash is distinct from target_run_token_hash
       or (
         target_action = 'start'
         and auto_receipt.academic_source_policy is distinct from
           target_academic_source_policy
       ) then
      raise exception 'Google automatic summary binding changed on retry'
        using errcode = 'P7335';
    end if;
    select run.*
    into run_row
    from public.lecture_summary_runs as run
    where run.id = auto_receipt.run_id
      and run.lecture_session_id = auto_receipt.lecture_session_id;
    if not found
       or run_row.academic_authority_mode <> 'google_per_call'
       or not run_row.auto_academic_answers_enabled
       or run_row.academic_authorization_grant_id is not null then
      raise exception 'Google automatic summary receipt is incomplete'
        using errcode = 'P7335';
    end if;
    return jsonb_build_object(
      'accepted', true,
      'actorId', actor_value,
      'idempotentReplay', true,
      'refreshRequired', run_row.token_hash is distinct from target_run_token_hash,
      'resultStatus', 'running',
      'run', to_jsonb(run_row) - 'token_hash'
    );
  end if;

  if target_action = 'start' then
    result_value := private.manage_google_admin_summary_run_v1(
      target_token_hash,
      target_auth_user_id,
      target_supabase_auth_session_id,
      target_google_issuer,
      target_provider_subject_hmac,
      target_subject_pepper_version,
      target_lecture_session_id,
      'start',
      target_run_token_hash,
      false,
      target_academic_source_policy,
      null,
      target_request_id,
      target_transport_enabled
    );
    if coalesce((result_value ->> 'accepted')::boolean, false) is not true then
      return result_value;
    end if;
    select run.*
    into run_row
    from public.lecture_summary_runs as run
    where run.id = (result_value #>> '{run,id}')::uuid
      and run.lecture_session_id = target_lecture_session_id
    for update;
    if not found
       or run_row.auto_academic_answers_enabled
       or run_row.academic_authorization_grant_id is not null
       or run_row.academic_authority_mode <> 'none' then
      raise exception 'Google summary run cannot enable per-call academic authority'
        using errcode = 'P7335';
    end if;
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
    raise exception 'Google automatic summary scheduling is disabled'
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

  select master.* into master_snapshot
  from public.lecture_ai_master_authorizations as master
  where master.lecture_session_id = target_lecture_session_id
    and master.status = 'active';
  if not found or master_snapshot.ai_policy_id is null then
    raise exception 'Google AI master is unavailable' using errcode = 'P7335';
  end if;

  perform private.serialize_admin_ai_scope_v1(
    'policy-membership', (context_value ->> 'membership_id')::uuid
  );
  select policy.* into policy_row
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
     or not array['academic_answers', 'summaries']::text[]
       <@ policy_row.allowed_actions then
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
     or not array['academic_answers', 'summaries']::text[]
       <@ master_row.actions then
    raise exception 'Google AI master is unavailable' using errcode = 'P7335';
  end if;

  select control.* into control_row
  from public.lecture_ai_control as control
  where control.lecture_session_id = target_lecture_session_id
  for update;
  if not found then
    raise exception 'AI control is not configured' using errcode = 'P7335';
  end if;

  if target_action = 'resume' then
    select run.* into run_row
    from public.lecture_summary_runs as run
    where run.id = run_snapshot.id
      and run.lecture_session_id = target_lecture_session_id
      and run.status = 'running'
      and run.expires_at > effective_now
    for update;
    if not found
       or run_row.academic_authority_mode <> 'google_per_call'
       or not run_row.auto_academic_answers_enabled
       or run_row.academic_authorization_grant_id is not null
       or not exists (
         select 1
         from private.admin_google_summary_auto_receipts as prior
         where prior.run_id = run_row.id
           and prior.action_name = 'start'
           and prior.principal_id = (context_value ->> 'principal_id')::uuid
           and prior.membership_id = (context_value ->> 'membership_id')::uuid
       ) then
      return jsonb_build_object(
        'accepted', false,
        'reason', 'summary_run_not_active'
      );
    end if;
  end if;

  update public.lecture_ai_control as control
  set
    summaries_enabled = true,
    academic_answers_enabled = true,
    status = case when exists (
      select 1 from public.ai_usage_ledger as usage
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
    auto_academic_answers_enabled = true,
    academic_authorization_grant_id = null,
    academic_authority_mode = 'google_per_call',
    updated_at = effective_now
  where run.id = run_row.id
  returning * into run_row;
  if not found then
    raise exception 'Google automatic summary run disappeared'
      using errcode = 'P7335';
  end if;

  if target_action = 'resume' then
    intent_digest_value := private.google_summary_run_intent_digest_v1(
      target_request_id,
      (context_value ->> 'admin_session_id')::uuid,
      target_lecture_session_id,
      'resume',
      target_run_token_hash,
      null,
      null,
      null
    );
    insert into private.admin_google_summary_run_receipts (
      request_id, action_name, intent_digest, environment_id, principal_id,
      membership_id, admin_session_id, supabase_auth_session_id, auth_user_id,
      lecture_session_id, master_authorization_id, run_id, run_token_hash,
      academic_source_policy, stop_reason, result_status, completed_at
    ) values (
      target_request_id, 'resume', intent_digest_value,
      (context_value ->> 'environment_id')::uuid,
      (context_value ->> 'principal_id')::uuid,
      (context_value ->> 'membership_id')::uuid,
      (context_value ->> 'admin_session_id')::uuid,
      target_supabase_auth_session_id, target_auth_user_id,
      target_lecture_session_id, master_row.id, run_row.id,
      target_run_token_hash, null, null, 'running', effective_now
    ) returning * into summary_receipt;
  else
    select receipt.* into summary_receipt
    from private.admin_google_summary_run_receipts as receipt
    where receipt.request_id = target_request_id
      and receipt.run_id = run_row.id
      and receipt.action_name = 'start';
    if not found then
      raise exception 'Google summary start receipt is incomplete'
        using errcode = 'P7335';
    end if;
  end if;

  insert into private.admin_google_summary_auto_receipts (
    request_id, action_name, intent_digest, environment_id, principal_id,
    membership_id, admin_session_id, supabase_auth_session_id, auth_user_id,
    lecture_session_id, master_authorization_id, run_id, run_token_hash,
    academic_source_policy, completed_at
  ) values (
    target_request_id, target_action, intent_digest_value,
    (context_value ->> 'environment_id')::uuid,
    (context_value ->> 'principal_id')::uuid,
    (context_value ->> 'membership_id')::uuid,
    (context_value ->> 'admin_session_id')::uuid,
    target_supabase_auth_session_id, target_auth_user_id,
    target_lecture_session_id, master_row.id, run_row.id,
    target_run_token_hash, run_row.academic_source_policy, effective_now
  ) returning * into auto_receipt;

  return jsonb_build_object(
    'accepted', true,
    'actorId', actor_value,
    'idempotentReplay', false,
    'refreshRequired', false,
    'resultStatus', 'running',
    'run', to_jsonb(run_row) - 'token_hash',
    'results', private.phase6_admin_results_json(target_lecture_session_id)
  );
end;
$$;

revoke all on function private.manage_google_admin_summary_run_v2(
  text, uuid, uuid, text, text, integer, uuid, text, text, boolean, text,
  text, uuid, boolean
) from public, anon, authenticated, service_role;

create function public.manage_google_admin_summary_run_v2(
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
set statement_timeout = '8s'
set lock_timeout = '750ms'
as $$
  select private.manage_google_admin_summary_run_v2(
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

revoke all on function public.manage_google_admin_summary_run_v2(
  text, uuid, uuid, text, text, integer, uuid, text, text, boolean, text,
  text, uuid, boolean
) from public, anon, authenticated;
grant execute on function public.manage_google_admin_summary_run_v2(
  text, uuid, uuid, text, text, integer, uuid, text, text, boolean, text,
  text, uuid, boolean
) to service_role;

create function private.google_academic_preflight_intent_digest_v1(
  target_request_id uuid,
  target_admin_session_id uuid,
  target_lecture_session_id uuid,
  target_publication_mode text,
  target_run_id uuid,
  target_run_token_hash text,
  target_idempotency_key text,
  target_source_kind text,
  target_source_summary_id uuid,
  target_question_sha256 text,
  target_search_query_sha256 text,
  target_source_policy text
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
      or target_publication_mode not in ('manual_review', 'auto_unreviewed')
      or char_length(coalesce(target_idempotency_key, '')) not between 8 and 160
      or target_source_kind not in ('summary_candidate', 'teacher_selected')
      or target_question_sha256 is null
      or target_question_sha256 !~ '^[0-9a-f]{64}$'
      or target_search_query_sha256 is null
      or target_search_query_sha256 !~ '^[0-9a-f]{64}$'
      or target_source_policy not in (
        'auto', 'biomedical_pubmed', 'multidisciplinary_doi'
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
      )
      then null
    else pg_catalog.encode(
      extensions.digest(
        pg_catalog.convert_to(
          jsonb_build_object(
            'admin_session_id', target_admin_session_id,
            'idempotency_key', target_idempotency_key,
            'lecture_session_id', target_lecture_session_id,
            'publication_mode', target_publication_mode,
            'question_sha256', target_question_sha256,
            'request_id', target_request_id,
            'run_id', target_run_id,
            'run_token_hash', target_run_token_hash,
            'search_query_sha256', target_search_query_sha256,
            'source_kind', target_source_kind,
            'source_policy', target_source_policy,
            'source_summary_id', target_source_summary_id
          )::text,
          'UTF8'
        ),
        'sha256'
      ),
      'hex'
    )
  end;
$$;

revoke all on function private.google_academic_preflight_intent_digest_v1(
  uuid, uuid, uuid, text, uuid, text, text, text, uuid, text, text, text
) from public, anon, authenticated, service_role;

create function private.google_academic_preflight_context_digest_v1(
  target_preflight_request_id uuid,
  target_academic_request_id uuid,
  target_intent_digest text
)
returns text
language sql
immutable
security definer
set search_path = ''
as $$
  select case
    when target_preflight_request_id is null
      or target_academic_request_id is null
      or target_intent_digest is null
      or target_intent_digest !~ '^[0-9a-f]{64}$'
      then null
    else pg_catalog.encode(
      extensions.digest(
        pg_catalog.convert_to(
          'compass:phase7.30c2:google-academic-preflight:v1'
          || '|preflight=' || target_preflight_request_id::text
          || '|academic_request=' || target_academic_request_id::text
          || '|intent=' || target_intent_digest,
          'UTF8'
        ),
        'sha256'
      ),
      'hex'
    )
  end;
$$;

revoke all on function private.google_academic_preflight_context_digest_v1(
  uuid, uuid, text
) from public, anon, authenticated, service_role;

create function private.require_google_academic_live_authority_v1(
  target_context jsonb,
  target_lecture_session_id uuid,
  target_required_actions text[]
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
  ownership_row private.admin_lecture_ownerships%rowtype;
  policy_row private.admin_ai_policies%rowtype;
  master_snapshot public.lecture_ai_master_authorizations%rowtype;
  master_row public.lecture_ai_master_authorizations%rowtype;
  lecture_row public.lecture_sessions%rowtype;
  actor_value text;
  effective_now timestamptz := statement_timestamp();
begin
  if target_context is null
     or target_lecture_session_id is null
     or target_required_actions is null
     or target_required_actions not in (
       array['academic_answers']::text[],
       array['academic_answers', 'summaries']::text[]
     ) then
    return null;
  end if;
  actor_value := 'admin-session:' || (target_context ->> 'admin_session_id');

  select ownership.* into ownership_row
  from private.admin_lecture_ownerships as ownership
  where ownership.lecture_session_id = target_lecture_session_id;
  if not found
     or ownership_row.environment_id is distinct from
       (target_context ->> 'environment_id')::uuid
     or ownership_row.principal_id is distinct from
       (target_context ->> 'principal_id')::uuid
     or ownership_row.membership_id is distinct from
       (target_context ->> 'membership_id')::uuid then
    return null;
  end if;

  select master.* into master_snapshot
  from public.lecture_ai_master_authorizations as master
  where master.lecture_session_id = target_lecture_session_id
    and master.status = 'active';
  if not found or master_snapshot.ai_policy_id is null then
    return null;
  end if;

  perform private.serialize_admin_ai_scope_v1(
    'policy-membership', (target_context ->> 'membership_id')::uuid
  );
  select policy.* into policy_row
  from private.admin_ai_policies as policy
  where policy.id = master_snapshot.ai_policy_id
    and policy.version = master_snapshot.ai_policy_version
    and policy.environment_id = (target_context ->> 'environment_id')::uuid
    and policy.membership_id = (target_context ->> 'membership_id')::uuid
  for update;
  if not found
     or policy_row.status <> 'active'
     or policy_row.valid_from > effective_now
     or policy_row.valid_until <= effective_now
     or not target_required_actions <@ policy_row.allowed_actions then
    return null;
  end if;

  select lecture.* into lecture_row
  from public.lecture_sessions as lecture
  where lecture.id = target_lecture_session_id
  for update;
  if not found
     or lecture_row.status <> 'open'
     or lecture_row.hard_stop_at is null
     or lecture_row.hard_stop_at <= effective_now then
    return null;
  end if;

  select master.* into master_row
  from public.lecture_ai_master_authorizations as master
  where master.id = master_snapshot.id
    and master.lecture_session_id = target_lecture_session_id
  for update;
  if not found
     or master_row.status <> 'active'
     or master_row.expires_at <= effective_now
     or master_row.principal_id is distinct from
       (target_context ->> 'principal_id')::uuid
     or master_row.membership_id is distinct from
       (target_context ->> 'membership_id')::uuid
     or master_row.issuing_admin_session_id is distinct from
       (target_context ->> 'admin_session_id')::uuid
     or master_row.actor_id is distinct from actor_value
     or master_row.ai_policy_id is distinct from policy_row.id
     or master_row.ai_policy_version is distinct from policy_row.version
     or not target_required_actions <@ master_row.actions
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
    return null;
  end if;

  return jsonb_build_object(
    'actor_id', actor_value,
    'lecture_hard_stop_at', lecture_row.hard_stop_at,
    'master_authorization_id', master_row.id,
    'master_expires_at', master_row.expires_at,
    'policy_id', policy_row.id,
    'policy_valid_until', policy_row.valid_until,
    'policy_version', policy_row.version
  );
end;
$$;

revoke all on function private.require_google_academic_live_authority_v1(
  jsonb, uuid, text[]
) from public, anon, authenticated, service_role;

create function private.prepare_google_admin_academic_answer_v1(
  target_token_hash text,
  target_auth_user_id uuid,
  target_supabase_auth_session_id uuid,
  target_google_issuer text,
  target_provider_subject_hmac text,
  target_subject_pepper_version integer,
  target_lecture_session_id uuid,
  target_publication_mode text,
  target_run_id uuid,
  target_run_token_hash text,
  target_idempotency_key text,
  target_source_kind text,
  target_source_summary_id uuid,
  target_question text,
  target_question_sha256 text,
  target_search_query_sha256 text,
  target_source_policy text,
  target_preflight_request_id uuid,
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
  prepared jsonb;
  intent_digest_value text;
  context_digest_value text;
  actor_value text;
  required_actions text[];
  claim_recovered boolean := false;
  recovery_expires_at timestamptz;
begin
  if target_preflight_request_id is null
     or target_lecture_session_id is null
     or target_transport_enabled is null
     or target_publication_mode not in ('manual_review', 'auto_unreviewed')
     or char_length(coalesce(target_idempotency_key, '')) not between 8 and 160
     or char_length(trim(coalesce(target_question, ''))) not between 10 and 500
     or target_question_sha256 is null
     or target_question_sha256 !~ '^[0-9a-f]{64}$'
     or target_search_query_sha256 is null
     or target_search_query_sha256 !~ '^[0-9a-f]{64}$'
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

  select receipt.* into receipt_row
  from private.admin_google_academic_answer_preflight_receipts as receipt
  where receipt.request_id = target_preflight_request_id;
  if found then
    if receipt_row.intent_digest is distinct from intent_digest_value
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
       or receipt_row.publication_mode is distinct from target_publication_mode
       or receipt_row.run_id is distinct from target_run_id
       or receipt_row.run_token_hash is distinct from target_run_token_hash
       or receipt_row.source_summary_id is distinct from target_source_summary_id
       or receipt_row.source_kind is distinct from target_source_kind
       or receipt_row.question_sha256 is distinct from target_question_sha256
       or receipt_row.search_query_sha256 is distinct from
         target_search_query_sha256
       or receipt_row.source_policy is distinct from target_source_policy then
      raise exception 'Google academic preflight binding changed on retry'
        using errcode = 'P7335';
    end if;
    select request.* into request_row
    from public.academic_answer_requests as request
    where request.id = receipt_row.academic_request_id
      and request.lecture_session_id = receipt_row.lecture_session_id
      and request.requested_by_actor = actor_value;
    if not found then
      raise exception 'Google academic preflight receipt is incomplete'
        using errcode = 'P7335';
    end if;
    if request_row.status = 'evidence_checking'
       and request_row.lease_until <= statement_timestamp() then
      select gate.* into identity_gate
      from private.admin_identity_runtime_gate as gate
      where gate.singleton
      for share;
      select gate.* into ai_gate
      from private.admin_ai_unlock_runtime_gate as gate
      where gate.singleton
      for share;
      if identity_gate.singleton is true
         and ai_gate.singleton is true
         and target_transport_enabled is true
         and identity_gate.google_operational_authorization_enabled is true
         and ai_gate.google_ai_child_grant_enabled is true then
        required_actions := case when target_publication_mode = 'auto_unreviewed'
          then array['academic_answers', 'summaries']::text[]
          else array['academic_answers']::text[] end;
        authority_value := private.require_google_academic_live_authority_v1(
          context_value, target_lecture_session_id, required_actions
        );
        if authority_value is not null then
          recovery_expires_at := least(
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
            if found then
              recovery_expires_at := least(recovery_expires_at, run_row.expires_at);
            else
              recovery_expires_at := null;
            end if;
          end if;
          if recovery_expires_at > statement_timestamp() then
            select request.* into request_row
            from public.academic_answer_requests as request
            where request.id = receipt_row.academic_request_id
              and request.lecture_session_id = receipt_row.lecture_session_id
              and request.requested_by_actor = actor_value
            for update;
            if found
               and request_row.status = 'evidence_checking'
               and request_row.operation_id is null
               and request_row.lease_until <= statement_timestamp() then
              update public.academic_answer_requests as request
              set
                lease_until = recovery_expires_at,
                updated_at = statement_timestamp()
              where request.id = request_row.id
              returning * into request_row;
              claim_recovered := true;
            end if;
          end if;
        end if;
      end if;
    end if;
    return jsonb_build_object(
      'accepted', true,
      'academicRequestId', request_row.id,
      'claimAcquired', claim_recovered,
      'idempotentReplay', true,
      'providerContextDigest', receipt_row.provider_context_digest,
      'requestStatus', request_row.status
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
     or identity_gate.google_operational_authorization_enabled
       is distinct from true
     or ai_gate.google_ai_child_grant_enabled is distinct from true then
    raise exception 'Google academic preflight is disabled' using errcode = 'P7338';
  end if;

  required_actions := case when target_publication_mode = 'auto_unreviewed'
    then array['academic_answers', 'summaries']::text[]
    else array['academic_answers']::text[] end;
  authority_value := private.require_google_academic_live_authority_v1(
    context_value, target_lecture_session_id, required_actions
  );
  if authority_value is null then
    raise exception 'Google academic authority is unavailable'
      using errcode = 'P7335';
  end if;

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
      raise exception 'Google automatic academic run is unavailable'
        using errcode = 'P7335';
    end if;
    prepared := private.prepare_auto_academic_answer_request(
      target_lecture_session_id,
      target_run_id,
      target_run_token_hash,
      actor_value,
      target_idempotency_key,
      target_source_summary_id,
      target_question,
      target_question_sha256,
      target_search_query_sha256,
      target_source_policy
    );
    if coalesce((prepared ->> 'accepted')::boolean, false) is not true then
      return jsonb_build_object(
        'accepted', false,
        'reason', coalesce(prepared ->> 'reason', 'auto_not_admitted')
      );
    end if;
    if coalesce((prepared ->> 'idempotent_replay')::boolean, false)
       or coalesce((prepared ->> 'claim_acquired')::boolean, false)
          is not true then
      raise exception 'Google automatic academic preflight collided with legacy state'
        using errcode = 'P7335';
    end if;
  else
    prepared := private.prepare_academic_answer_request_v2(
      target_lecture_session_id,
      actor_value,
      target_idempotency_key,
      target_source_kind,
      target_source_summary_id,
      target_question,
      target_question_sha256,
      target_search_query_sha256,
      target_source_policy
    );
    if coalesce((prepared ->> 'idempotent_replay')::boolean, false) then
      raise exception 'Google academic preflight collided with legacy state'
        using errcode = 'P7335';
    end if;
  end if;

  select request.* into request_row
  from public.academic_answer_requests as request
  where request.id = (prepared #>> '{request,id}')::uuid
    and request.lecture_session_id = target_lecture_session_id
    and request.requested_by_actor = actor_value
  for update;
  if not found
     or request_row.status <> 'evidence_checking'
     or request_row.publication_mode is distinct from target_publication_mode
     or request_row.question_sha256 is distinct from target_question_sha256
     or request_row.search_query_sha256 is distinct from target_search_query_sha256
     or request_row.requested_source_policy is distinct from target_source_policy
     or request_row.automation_run_id is distinct from target_run_id then
    raise exception 'Google academic preflight has no canonical request'
      using errcode = 'P7335';
  end if;

  update public.academic_answer_requests as request
  set
    lease_until = least(
      statement_timestamp() + interval '2 minutes',
      (authority_value ->> 'lecture_hard_stop_at')::timestamptz,
      (authority_value ->> 'master_expires_at')::timestamptz,
      (authority_value ->> 'policy_valid_until')::timestamptz
    ),
    updated_at = statement_timestamp()
  where request.id = request_row.id
    and request.status = 'evidence_checking'
  returning * into request_row;
  if not found or request_row.lease_until <= statement_timestamp() then
    raise exception 'Google academic preflight lease is unavailable'
      using errcode = 'P7335';
  end if;

  context_digest_value := private.google_academic_preflight_context_digest_v1(
    target_preflight_request_id, request_row.id, intent_digest_value
  );
  insert into private.admin_google_academic_answer_preflight_receipts (
    request_id, intent_digest, environment_id, principal_id, membership_id,
    admin_session_id, supabase_auth_session_id, auth_user_id,
    lecture_session_id, academic_request_id, publication_mode, run_id,
    run_token_hash, source_summary_id, source_kind, question_sha256,
    search_query_sha256, source_policy, retrieval_version,
    provider_context_digest, result_status
  ) values (
    target_preflight_request_id, intent_digest_value,
    (context_value ->> 'environment_id')::uuid,
    (context_value ->> 'principal_id')::uuid,
    (context_value ->> 'membership_id')::uuid,
    (context_value ->> 'admin_session_id')::uuid,
    target_supabase_auth_session_id, target_auth_user_id,
    target_lecture_session_id, request_row.id, target_publication_mode,
    target_run_id, target_run_token_hash, target_source_summary_id,
    target_source_kind, target_question_sha256, target_search_query_sha256,
    target_source_policy, 'phase7-25-retrieval-v1', context_digest_value,
    'prepared'
  ) returning * into receipt_row;

  return jsonb_build_object(
    'accepted', true,
    'academicRequestId', request_row.id,
    'claimAcquired', true,
    'idempotentReplay', false,
    'providerContextDigest', receipt_row.provider_context_digest,
    'requestStatus', request_row.status
  );
end;
$$;

revoke all on function private.prepare_google_admin_academic_answer_v1(
  text, uuid, uuid, text, text, integer, uuid, text, uuid, text, text, text,
  uuid, text, text, text, text, uuid, boolean
) from public, anon, authenticated, service_role;

create function public.prepare_google_admin_academic_answer_v1(
  target_token_hash text,
  target_auth_user_id uuid,
  target_supabase_auth_session_id uuid,
  target_google_issuer text,
  target_provider_subject_hmac text,
  target_subject_pepper_version integer,
  target_lecture_session_id uuid,
  target_publication_mode text,
  target_run_id uuid,
  target_run_token_hash text,
  target_idempotency_key text,
  target_source_kind text,
  target_source_summary_id uuid,
  target_question text,
  target_question_sha256 text,
  target_search_query_sha256 text,
  target_source_policy text,
  target_preflight_request_id uuid,
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
  select private.prepare_google_admin_academic_answer_v1(
    target_token_hash,
    target_auth_user_id,
    target_supabase_auth_session_id,
    target_google_issuer,
    target_provider_subject_hmac,
    target_subject_pepper_version,
    target_lecture_session_id,
    target_publication_mode,
    target_run_id,
    target_run_token_hash,
    target_idempotency_key,
    target_source_kind,
    target_source_summary_id,
    target_question,
    target_question_sha256,
    target_search_query_sha256,
    target_source_policy,
    target_preflight_request_id,
    target_transport_enabled
  );
$$;

revoke all on function public.prepare_google_admin_academic_answer_v1(
  text, uuid, uuid, text, text, integer, uuid, text, uuid, text, text, text,
  uuid, text, text, text, text, uuid, boolean
) from public, anon, authenticated;
grant execute on function public.prepare_google_admin_academic_answer_v1(
  text, uuid, uuid, text, text, integer, uuid, text, uuid, text, text, text,
  uuid, text, text, text, text, uuid, boolean
) to service_role;

create function private.mark_google_admin_academic_answer_insufficient_v1(
  target_token_hash text,
  target_auth_user_id uuid,
  target_supabase_auth_session_id uuid,
  target_google_issuer text,
  target_provider_subject_hmac text,
  target_subject_pepper_version integer,
  target_preflight_request_id uuid,
  target_academic_request_id uuid,
  target_reason text,
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
  receipt_row private.admin_google_academic_answer_preflight_receipts%rowtype;
  request_row public.academic_answer_requests%rowtype;
  result_value jsonb;
  actor_value text;
  normalized_reason text := nullif(trim(target_reason), '');
  was_terminal boolean := false;
begin
  if target_preflight_request_id is null
     or target_academic_request_id is null
     or target_transport_enabled is null
     or normalized_reason is null
     or normalized_reason !~ '^[a-z0-9_]{1,80}$' then
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
  select receipt.* into receipt_row
  from private.admin_google_academic_answer_preflight_receipts as receipt
  where receipt.request_id = target_preflight_request_id;
  if not found
     or receipt_row.academic_request_id is distinct from target_academic_request_id
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
     or receipt_row.auth_user_id is distinct from target_auth_user_id then
    return null;
  end if;
  select request.* into request_row
  from public.academic_answer_requests as request
  where request.id = target_academic_request_id
    and request.requested_by_actor = actor_value;
  if not found then
    return null;
  end if;
  was_terminal := request_row.status = 'insufficient_evidence';
  result_value := private.mark_academic_answer_insufficient(
    target_academic_request_id, actor_value, normalized_reason
  );
  select request.* into request_row
  from public.academic_answer_requests as request
  where request.id = target_academic_request_id
    and request.requested_by_actor = actor_value;
  if not found or request_row.status <> 'insufficient_evidence' then
    raise exception 'Google academic request did not become terminal'
      using errcode = 'P7335';
  end if;
  return jsonb_build_object(
    'accepted', true,
    'academicRequestId', request_row.id,
    'idempotentReplay', was_terminal,
    'requestStatus', request_row.status
  );
end;
$$;

revoke all on function private.mark_google_admin_academic_answer_insufficient_v1(
  text, uuid, uuid, text, text, integer, uuid, uuid, text, boolean
) from public, anon, authenticated, service_role;

create function public.mark_google_admin_academic_answer_insufficient_v1(
  target_token_hash text,
  target_auth_user_id uuid,
  target_supabase_auth_session_id uuid,
  target_google_issuer text,
  target_provider_subject_hmac text,
  target_subject_pepper_version integer,
  target_preflight_request_id uuid,
  target_academic_request_id uuid,
  target_reason text,
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
  select private.mark_google_admin_academic_answer_insufficient_v1(
    target_token_hash,
    target_auth_user_id,
    target_supabase_auth_session_id,
    target_google_issuer,
    target_provider_subject_hmac,
    target_subject_pepper_version,
    target_preflight_request_id,
    target_academic_request_id,
    target_reason,
    target_transport_enabled
  );
$$;

revoke all on function public.mark_google_admin_academic_answer_insufficient_v1(
  text, uuid, uuid, text, text, integer, uuid, uuid, text, boolean
) from public, anon, authenticated;
grant execute on function public.mark_google_admin_academic_answer_insufficient_v1(
  text, uuid, uuid, text, text, integer, uuid, uuid, text, boolean
) to service_role;

create function private.google_academic_provider_intent_digest_v1(
  target_lecture_session_id uuid,
  target_academic_request_id uuid,
  target_preflight_request_id uuid,
  target_preflight_context_digest text,
  target_publication_mode text,
  target_run_id uuid,
  target_source_set_sha256 text,
  target_resolved_source_route text,
  target_verified_source_count integer,
  target_verified_primary_count integer,
  target_provider_payload_sha256 text,
  target_model_id text,
  target_prompt_version text,
  target_input_price_microusd_per_million bigint,
  target_output_price_microusd_per_million bigint,
  target_max_output_tokens integer,
  target_estimated_microusd bigint,
  target_estimated_input_tokens bigint,
  target_estimated_output_tokens bigint
)
returns text
language sql
immutable
security definer
set search_path = ''
as $$
  select case
    when target_lecture_session_id is null
      or target_academic_request_id is null
      or target_preflight_request_id is null
      or target_preflight_context_digest is null
      or target_preflight_context_digest !~ '^[0-9a-f]{64}$'
      or target_publication_mode not in ('manual_review', 'auto_unreviewed')
      or (
        target_publication_mode = 'manual_review'
        and target_run_id is not null
      )
      or (
        target_publication_mode = 'auto_unreviewed'
        and target_run_id is null
      )
      or target_source_set_sha256 is null
      or target_source_set_sha256 !~ '^[0-9a-f]{64}$'
      or target_resolved_source_route not in (
        'biomedical_pubmed', 'multidisciplinary_doi'
      )
      or target_verified_source_count not between 1 and 5
      or target_verified_primary_count not between 1 and target_verified_source_count
      or target_provider_payload_sha256 is null
      or target_provider_payload_sha256 !~ '^[0-9a-f]{64}$'
      or char_length(coalesce(target_model_id, '')) not between 1 and 120
      or char_length(coalesce(target_prompt_version, '')) not between 1 and 120
      or target_input_price_microusd_per_million is null
      or target_input_price_microusd_per_million not between 0 and 100000000
      or target_output_price_microusd_per_million is null
      or target_output_price_microusd_per_million not between 0 and 100000000
      or target_max_output_tokens is null
      or target_max_output_tokens not between 1 and 10000
      or target_estimated_microusd is null
      or target_estimated_microusd < 0
      or target_estimated_input_tokens is null
      or target_estimated_input_tokens not between 1 and 100000
      or target_estimated_output_tokens is null
      or target_estimated_output_tokens not between 1 and target_max_output_tokens
      then null
    else pg_catalog.encode(
      extensions.digest(
        pg_catalog.convert_to(
          jsonb_build_object(
            'academic_request_id', target_academic_request_id,
            'estimated_input_tokens', target_estimated_input_tokens,
            'estimated_microusd', target_estimated_microusd,
            'estimated_output_tokens', target_estimated_output_tokens,
            'input_price_microusd_per_million',
              target_input_price_microusd_per_million,
            'lecture_session_id', target_lecture_session_id,
            'max_output_tokens', target_max_output_tokens,
            'model_id', target_model_id,
            'output_price_microusd_per_million',
              target_output_price_microusd_per_million,
            'preflight_context_digest', target_preflight_context_digest,
            'preflight_request_id', target_preflight_request_id,
            'prompt_version', target_prompt_version,
            'provider_payload_sha256', target_provider_payload_sha256,
            'publication_mode', target_publication_mode,
            'resolved_source_route', target_resolved_source_route,
            'run_id', target_run_id,
            'source_set_sha256', target_source_set_sha256,
            'verified_primary_count', target_verified_primary_count,
            'verified_source_count', target_verified_source_count
          )::text,
          'UTF8'
        ),
        'sha256'
      ),
      'hex'
    )
  end;
$$;

revoke all on function private.google_academic_provider_intent_digest_v1(
  uuid, uuid, uuid, text, text, uuid, text, text, integer, integer, text,
  text, text, bigint, bigint, integer, bigint, bigint, bigint
) from public, anon, authenticated, service_role;

create function private.issue_google_academic_answer_ai_child_grant_v1(
  target_token_hash text,
  target_auth_user_id uuid,
  target_supabase_auth_session_id uuid,
  target_google_issuer text,
  target_provider_subject_hmac text,
  target_subject_pepper_version integer,
  target_lecture_session_id uuid,
  target_academic_request_id uuid,
  target_preflight_request_id uuid,
  target_preflight_context_digest text,
  target_publication_mode text,
  target_run_id uuid,
  target_source_set_sha256 text,
  target_resolved_source_route text,
  target_verified_source_count integer,
  target_verified_primary_count integer,
  target_provider_payload_sha256 text,
  target_model_id text,
  target_prompt_version text,
  target_input_price_microusd_per_million bigint,
  target_output_price_microusd_per_million bigint,
  target_max_output_tokens integer,
  target_estimated_microusd bigint,
  target_estimated_input_tokens bigint,
  target_estimated_output_tokens bigint,
  target_nonce_hash text,
  target_nonce_key_version integer,
  target_grant_request_id uuid,
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
  result_value jsonb;
  preflight_row private.admin_google_academic_answer_preflight_receipts%rowtype;
  child_row private.admin_google_ai_child_grant_receipts%rowtype;
  start_intent private.admin_google_ai_provider_start_intents%rowtype;
  start_receipt private.admin_google_ai_provider_start_receipts%rowtype;
  binding_row private.admin_google_academic_answer_start_bindings%rowtype;
  request_row public.academic_answer_requests%rowtype;
  child_replay boolean := false;
begin
  provider_digest_value := private.google_academic_provider_intent_digest_v1(
    target_lecture_session_id,
    target_academic_request_id,
    target_preflight_request_id,
    target_preflight_context_digest,
    target_publication_mode,
    target_run_id,
    target_source_set_sha256,
    target_resolved_source_route,
    target_verified_source_count,
    target_verified_primary_count,
    target_provider_payload_sha256,
    target_model_id,
    target_prompt_version,
    target_input_price_microusd_per_million,
    target_output_price_microusd_per_million,
    target_max_output_tokens,
    target_estimated_microusd,
    target_estimated_input_tokens,
    target_estimated_output_tokens
  );
  if provider_digest_value is null then
    return null;
  end if;

  result_value := private.issue_google_ai_child_grant_v1(
    target_token_hash,
    target_auth_user_id,
    target_supabase_auth_session_id,
    target_google_issuer,
    target_provider_subject_hmac,
    target_subject_pepper_version,
    target_lecture_session_id,
    'academic_answers',
    provider_digest_value,
    target_nonce_hash,
    target_nonce_key_version,
    target_grant_request_id,
    target_transport_enabled
  );
  if result_value is null then
    return null;
  end if;
  child_replay := coalesce(
    (result_value ->> 'idempotentReplay')::boolean,
    false
  );

  select receipt.* into child_row
  from private.admin_google_ai_child_grant_receipts as receipt
  where receipt.request_id = target_grant_request_id;
  select receipt.* into preflight_row
  from private.admin_google_academic_answer_preflight_receipts as receipt
  where receipt.request_id = target_preflight_request_id;
  if child_row.grant_id is null
     or preflight_row.request_id is null
     or child_row.environment_id is distinct from preflight_row.environment_id
     or child_row.principal_id is distinct from preflight_row.principal_id
     or child_row.membership_id is distinct from preflight_row.membership_id
     or child_row.admin_session_id is distinct from preflight_row.admin_session_id
     or child_row.supabase_auth_session_id is distinct from
       preflight_row.supabase_auth_session_id
     or child_row.auth_user_id is distinct from preflight_row.auth_user_id
     or child_row.lecture_session_id is distinct from
       preflight_row.lecture_session_id
     or child_row.feature <> 'academic_answers'
     or child_row.provider_intent_digest is distinct from provider_digest_value
     or preflight_row.lecture_session_id is distinct from target_lecture_session_id
     or preflight_row.academic_request_id is distinct from
       target_academic_request_id
     or preflight_row.provider_context_digest is distinct from
       target_preflight_context_digest
     or preflight_row.publication_mode is distinct from target_publication_mode
     or preflight_row.run_id is distinct from target_run_id then
    raise exception 'Google academic child evidence is incomplete'
      using errcode = 'P7335';
  end if;

  select request.* into request_row
  from public.academic_answer_requests as request
  where request.id = target_academic_request_id
    and request.lecture_session_id = target_lecture_session_id
  for update;
  if not found
     or request_row.publication_mode is distinct from target_publication_mode
     or request_row.automation_run_id is distinct from target_run_id
     or (
       request_row.status = 'evidence_checking'
       and (
         request_row.source_set_sha256 is not null
         or request_row.operation_id is not null
       )
     )
     or request_row.status not in ('evidence_checking', 'running') then
    raise exception 'Google academic request is no longer admissible'
      using errcode = 'P7335';
  end if;
  if request_row.status = 'running' then
    if not child_replay or request_row.operation_id is null then
      raise exception 'Google academic running request lacks replay evidence'
        using errcode = 'P7335';
    end if;
    select binding.* into binding_row
    from private.admin_google_academic_answer_start_bindings as binding
    where binding.preflight_request_id = target_preflight_request_id
      and binding.academic_request_id = target_academic_request_id
      and binding.lecture_session_id = target_lecture_session_id
      and binding.operation_id = request_row.operation_id;
    select intent.* into start_intent
    from private.admin_google_ai_provider_start_intents as intent
    where intent.start_request_id = binding_row.start_request_id
      and intent.child_grant_id = child_row.grant_id;
    select receipt.* into start_receipt
    from private.admin_google_ai_provider_start_receipts as receipt
    where receipt.start_request_id = binding_row.start_request_id
      and receipt.child_grant_id = child_row.grant_id
      and receipt.operation_id = request_row.operation_id;
    if binding_row.start_request_id is null
       or start_intent.start_request_id is null
       or start_receipt.start_request_id is null
       or binding_row.run_id is distinct from target_run_id
       or binding_row.publication_mode is distinct from target_publication_mode
       or binding_row.source_set_sha256 is distinct from target_source_set_sha256
       or binding_row.resolved_source_route is distinct from
         target_resolved_source_route
       or binding_row.verified_source_count is distinct from
         target_verified_source_count
       or binding_row.verified_primary_count is distinct from
         target_verified_primary_count
       or binding_row.preflight_context_digest is distinct from
         target_preflight_context_digest
       or binding_row.provider_payload_sha256 is distinct from
         target_provider_payload_sha256
       or start_intent.feature is distinct from 'academic_answers'
       or start_intent.provider_intent_digest is distinct from
         provider_digest_value then
      raise exception 'Google academic running replay evidence is incomplete'
        using errcode = 'P7335';
    end if;
  elsif request_row.lease_until <= statement_timestamp() then
    if coalesce((result_value ->> 'idempotentReplay')::boolean, false)
       and child_row.expires_at > statement_timestamp()
       and result_value ->> 'status' = 'issued' then
      update public.academic_answer_requests as request
      set
        lease_until = child_row.expires_at,
        updated_at = statement_timestamp()
      where request.id = request_row.id
      returning * into request_row;
    else
      raise exception 'Google academic preflight lease expired before child issue'
        using errcode = 'P7335';
    end if;
  end if;

  return result_value || jsonb_build_object(
    'academicRequestId', target_academic_request_id,
    'preflightRequestId', target_preflight_request_id,
    'providerIntentDigest', provider_digest_value
  );
end;
$$;

revoke all on function private.issue_google_academic_answer_ai_child_grant_v1(
  text, uuid, uuid, text, text, integer, uuid, uuid, uuid, text, text, uuid,
  text, text, integer, integer, text, text, text, bigint, bigint, integer,
  bigint, bigint, bigint, text, integer, uuid, boolean
) from public, anon, authenticated, service_role;

create function public.issue_google_academic_answer_ai_child_grant_v1(
  target_token_hash text,
  target_auth_user_id uuid,
  target_supabase_auth_session_id uuid,
  target_google_issuer text,
  target_provider_subject_hmac text,
  target_subject_pepper_version integer,
  target_lecture_session_id uuid,
  target_academic_request_id uuid,
  target_preflight_request_id uuid,
  target_preflight_context_digest text,
  target_publication_mode text,
  target_run_id uuid,
  target_source_set_sha256 text,
  target_resolved_source_route text,
  target_verified_source_count integer,
  target_verified_primary_count integer,
  target_provider_payload_sha256 text,
  target_model_id text,
  target_prompt_version text,
  target_input_price_microusd_per_million bigint,
  target_output_price_microusd_per_million bigint,
  target_max_output_tokens integer,
  target_estimated_microusd bigint,
  target_estimated_input_tokens bigint,
  target_estimated_output_tokens bigint,
  target_nonce_hash text,
  target_nonce_key_version integer,
  target_grant_request_id uuid,
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
  select private.issue_google_academic_answer_ai_child_grant_v1(
    target_token_hash,
    target_auth_user_id,
    target_supabase_auth_session_id,
    target_google_issuer,
    target_provider_subject_hmac,
    target_subject_pepper_version,
    target_lecture_session_id,
    target_academic_request_id,
    target_preflight_request_id,
    target_preflight_context_digest,
    target_publication_mode,
    target_run_id,
    target_source_set_sha256,
    target_resolved_source_route,
    target_verified_source_count,
    target_verified_primary_count,
    target_provider_payload_sha256,
    target_model_id,
    target_prompt_version,
    target_input_price_microusd_per_million,
    target_output_price_microusd_per_million,
    target_max_output_tokens,
    target_estimated_microusd,
    target_estimated_input_tokens,
    target_estimated_output_tokens,
    target_nonce_hash,
    target_nonce_key_version,
    target_grant_request_id,
    target_transport_enabled
  );
$$;

revoke all on function public.issue_google_academic_answer_ai_child_grant_v1(
  text, uuid, uuid, text, text, integer, uuid, uuid, uuid, text, text, uuid,
  text, text, integer, integer, text, text, text, bigint, bigint, integer,
  bigint, bigint, bigint, text, integer, uuid, boolean
) from public, anon, authenticated;
grant execute on function public.issue_google_academic_answer_ai_child_grant_v1(
  text, uuid, uuid, text, text, integer, uuid, uuid, uuid, text, text, uuid,
  text, text, integer, integer, text, text, text, bigint, bigint, integer,
  bigint, bigint, bigint, text, integer, uuid, boolean
) to service_role;

create function private.start_google_admin_academic_answer_operation_v1(
  target_token_hash text,
  target_auth_user_id uuid,
  target_supabase_auth_session_id uuid,
  target_google_issuer text,
  target_provider_subject_hmac text,
  target_subject_pepper_version integer,
  target_grant_id uuid,
  target_nonce_hash text,
  target_lecture_session_id uuid,
  target_academic_request_id uuid,
  target_preflight_request_id uuid,
  target_preflight_context_digest text,
  target_publication_mode text,
  target_run_id uuid,
  target_source_set_sha256 text,
  target_resolved_source_route text,
  target_verified_source_count integer,
  target_verified_primary_count integer,
  target_provider_payload_sha256 text,
  target_model_id text,
  target_prompt_version text,
  target_input_price_microusd_per_million bigint,
  target_output_price_microusd_per_million bigint,
  target_max_output_tokens integer,
  target_estimated_microusd bigint,
  target_estimated_input_tokens bigint,
  target_estimated_output_tokens bigint,
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
  child_receipt private.admin_google_ai_child_grant_receipts%rowtype;
  preflight_receipt private.admin_google_academic_answer_preflight_receipts%rowtype;
  start_intent private.admin_google_ai_provider_start_intents%rowtype;
  start_receipt private.admin_google_ai_provider_start_receipts%rowtype;
  binding_row private.admin_google_academic_answer_start_bindings%rowtype;
  grant_row public.ai_billing_grants%rowtype;
  usage_row public.ai_usage_ledger%rowtype;
  request_row public.academic_answer_requests%rowtype;
  run_row public.lecture_summary_runs%rowtype;
  control_row public.lecture_ai_control%rowtype;
  policy_row private.admin_ai_policies%rowtype;
  master_row public.lecture_ai_master_authorizations%rowtype;
  context_value jsonb;
  authority_value jsonb;
  identity_gate private.admin_identity_runtime_gate%rowtype;
  ai_gate private.admin_ai_unlock_runtime_gate%rowtype;
  provider_digest_value text;
  start_digest_value text;
  result_value jsonb;
  actor_value text;
  operation_id_value uuid;
  minimum_reservation bigint;
  lecture_calls bigint;
  daily_calls bigint;
  lecture_input_tokens bigint;
  daily_input_tokens bigint;
  lecture_output_tokens bigint;
  daily_output_tokens bigint;
  lecture_cost bigint;
  daily_cost bigint;
  policy_running bigint;
  effective_now timestamptz := statement_timestamp();
  utc_day_start timestamptz := date_trunc(
    'day', statement_timestamp() at time zone 'UTC'
  ) at time zone 'UTC';
begin
  provider_digest_value := private.google_academic_provider_intent_digest_v1(
    target_lecture_session_id,
    target_academic_request_id,
    target_preflight_request_id,
    target_preflight_context_digest,
    target_publication_mode,
    target_run_id,
    target_source_set_sha256,
    target_resolved_source_route,
    target_verified_source_count,
    target_verified_primary_count,
    target_provider_payload_sha256,
    target_model_id,
    target_prompt_version,
    target_input_price_microusd_per_million,
    target_output_price_microusd_per_million,
    target_max_output_tokens,
    target_estimated_microusd,
    target_estimated_input_tokens,
    target_estimated_output_tokens
  );
  if target_start_request_id is null
     or target_grant_id is null
     or target_nonce_hash is null
     or target_nonce_hash !~ '^[0-9a-f]{64}$'
     or provider_digest_value is null
     or target_provider_intent_digest is null
     or target_provider_intent_digest is distinct from provider_digest_value
     or target_transport_enabled is null then
    return null;
  end if;

  minimum_reservation := ceil(
    target_estimated_input_tokens::numeric
      * target_input_price_microusd_per_million::numeric / 1000000
    + target_estimated_output_tokens::numeric
      * target_output_price_microusd_per_million::numeric / 1000000
  )::bigint;
  if target_estimated_microusd < minimum_reservation then
    raise exception 'Google academic AI cost reservation is too small'
      using errcode = '22023';
  end if;

  perform private.serialize_admin_ai_request_v1(target_start_request_id);
  select grant_record.* into grant_row
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
        'compass:phase7.30c2:google-ai-provider-start:v1'
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

  select receipt.* into child_receipt
  from private.admin_google_ai_child_grant_receipts as receipt
  where receipt.grant_id = target_grant_id;
  select receipt.* into preflight_receipt
  from private.admin_google_academic_answer_preflight_receipts as receipt
  where receipt.request_id = target_preflight_request_id;
  if child_receipt.grant_id is null
     or preflight_receipt.request_id is null
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
     or child_receipt.feature <> 'academic_answers'
     or child_receipt.provider_intent_digest is distinct from
       target_provider_intent_digest
     or child_receipt.nonce_hash is distinct from target_nonce_hash
     or preflight_receipt.environment_id is distinct from
       child_receipt.environment_id
     or preflight_receipt.principal_id is distinct from child_receipt.principal_id
     or preflight_receipt.membership_id is distinct from
       child_receipt.membership_id
     or preflight_receipt.admin_session_id is distinct from
       child_receipt.admin_session_id
     or preflight_receipt.supabase_auth_session_id is distinct from
       child_receipt.supabase_auth_session_id
     or preflight_receipt.auth_user_id is distinct from child_receipt.auth_user_id
     or preflight_receipt.lecture_session_id is distinct from
       target_lecture_session_id
     or preflight_receipt.academic_request_id is distinct from
       target_academic_request_id
     or preflight_receipt.provider_context_digest is distinct from
       target_preflight_context_digest
     or preflight_receipt.publication_mode is distinct from
       target_publication_mode
     or preflight_receipt.run_id is distinct from target_run_id then
    raise exception 'Google academic provider evidence is unavailable'
      using errcode = 'P7335';
  end if;

  select receipt.* into start_receipt
  from private.admin_google_ai_provider_start_receipts as receipt
  where receipt.start_request_id = target_start_request_id;
  if found then
    select intent.* into start_intent
    from private.admin_google_ai_provider_start_intents as intent
    where intent.start_request_id = target_start_request_id;
    select binding.* into binding_row
    from private.admin_google_academic_answer_start_bindings as binding
    where binding.start_request_id = target_start_request_id;
    select usage.* into usage_row
    from public.ai_usage_ledger as usage
    where usage.id = start_receipt.operation_id;
    select request.* into request_row
    from public.academic_answer_requests as request
    where request.id = target_academic_request_id;
    if start_intent.start_request_id is null
       or binding_row.start_request_id is null
       or usage_row.id is null
       or request_row.id is null
       or start_intent.child_grant_id is distinct from target_grant_id
       or start_intent.environment_id is distinct from
         (context_value ->> 'environment_id')::uuid
       or start_intent.principal_id is distinct from
         (context_value ->> 'principal_id')::uuid
       or start_intent.membership_id is distinct from
         (context_value ->> 'membership_id')::uuid
       or start_intent.admin_session_id is distinct from
         (context_value ->> 'admin_session_id')::uuid
       or start_intent.supabase_auth_session_id is distinct from
         target_supabase_auth_session_id
       or start_intent.lecture_session_id is distinct from
         target_lecture_session_id
       or start_intent.feature <> 'academic_answers'
       or start_intent.model_id is distinct from target_model_id
       or start_intent.provider_intent_digest is distinct from
         target_provider_intent_digest
       or start_intent.start_intent_digest is distinct from start_digest_value
       or start_receipt.child_grant_id is distinct from target_grant_id
       or grant_row.status <> 'consumed'
       or grant_row.operation_ids is distinct from
         array[start_receipt.operation_id]::uuid[]
       or usage_row.lecture_session_id is distinct from target_lecture_session_id
       or usage_row.feature <> 'academic_answers'
       or usage_row.idempotency_key is distinct from
         target_start_request_id::text
       or usage_row.requested_by_actor is distinct from actor_value
       or binding_row.operation_id is distinct from start_receipt.operation_id
       or binding_row.preflight_request_id is distinct from
         target_preflight_request_id
       or binding_row.lecture_session_id is distinct from
         target_lecture_session_id
       or binding_row.academic_request_id is distinct from
         target_academic_request_id
       or binding_row.run_id is distinct from target_run_id
       or binding_row.publication_mode is distinct from target_publication_mode
       or binding_row.source_set_sha256 is distinct from target_source_set_sha256
       or binding_row.resolved_source_route is distinct from
         target_resolved_source_route
       or binding_row.verified_source_count is distinct from
         target_verified_source_count
       or binding_row.verified_primary_count is distinct from
         target_verified_primary_count
       or binding_row.preflight_context_digest is distinct from
         target_preflight_context_digest
       or binding_row.provider_payload_sha256 is distinct from
         target_provider_payload_sha256
       or request_row.operation_id is distinct from start_receipt.operation_id
       or request_row.requested_by_actor is distinct from actor_value then
      raise exception 'Google academic provider start binding changed on retry'
        using errcode = 'P7335';
    end if;
    return jsonb_build_object(
      'accepted', true,
      'actorId', actor_value,
      'academicRequestId', request_row.id,
      'idempotentReplay', true,
      'operationId', start_receipt.operation_id,
      'requestStatus', request_row.status,
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
     or identity_gate.google_operational_authorization_enabled
       is distinct from true
     or ai_gate.google_ai_child_grant_enabled is distinct from true then
    raise exception 'Google academic provider start is disabled'
      using errcode = 'P7338';
  end if;

  authority_value := private.require_google_academic_live_authority_v1(
    context_value,
    target_lecture_session_id,
    case when target_publication_mode = 'auto_unreviewed'
      then array['academic_answers', 'summaries']::text[]
      else array['academic_answers']::text[] end
  );
  if authority_value is null
     or (authority_value ->> 'master_authorization_id')::uuid is distinct from
       child_receipt.master_authorization_id
     or (authority_value ->> 'policy_id')::uuid is distinct from
       child_receipt.policy_id
     or (authority_value ->> 'policy_version')::bigint is distinct from
       child_receipt.policy_version then
    raise exception 'Google academic live authority is unavailable'
      using errcode = 'P7335';
  end if;

  select policy.* into policy_row
  from private.admin_ai_policies as policy
  where policy.id = child_receipt.policy_id
    and policy.version = child_receipt.policy_version
  for update;
  select master.* into master_row
  from public.lecture_ai_master_authorizations as master
  where master.id = child_receipt.master_authorization_id
    and master.lecture_session_id = target_lecture_session_id
  for update;
  if policy_row.id is null
     or master_row.id is null
     or not array[target_model_id]::text[] <@ policy_row.allowed_models then
    raise exception 'Google academic model is unavailable' using errcode = 'P7335';
  end if;

  if grant_row.lecture_session_id is distinct from target_lecture_session_id
     or grant_row.master_authorization_id is distinct from master_row.id
     or grant_row.status <> 'issued'
     or grant_row.expires_at <= effective_now
     or grant_row.actor_id is distinct from actor_value
     or grant_row.actions is distinct from array['academic_answers']::text[]
     or grant_row.nonce_hash is distinct from target_nonce_hash then
    raise exception 'Google academic child is unavailable' using errcode = 'P7335';
  end if;

  select control.* into control_row
  from public.lecture_ai_control as control
  where control.lecture_session_id = target_lecture_session_id
  for update;
  if not found then
    raise exception 'AI control is not configured' using errcode = 'P7335';
  end if;

  if target_publication_mode = 'auto_unreviewed' then
    select run.* into run_row
    from public.lecture_summary_runs as run
    where run.id = target_run_id
      and run.lecture_session_id = target_lecture_session_id
      and run.actor_id = actor_value
      and run.token_hash = preflight_receipt.run_token_hash
      and run.status = 'running'
      and run.expires_at > effective_now
      and run.auto_academic_answers_enabled
      and run.academic_authority_mode = 'google_per_call'
      and run.academic_authorization_grant_id is null
    for update;
    if not found then
      raise exception 'Google automatic academic run is unavailable'
        using errcode = 'P7335';
    end if;
  end if;

  select request.* into request_row
  from public.academic_answer_requests as request
  where request.id = target_academic_request_id
    and request.lecture_session_id = target_lecture_session_id
  for update;
  if not found
     or request_row.requested_by_actor is distinct from actor_value
     or request_row.status <> 'evidence_checking'
     or request_row.lease_until <= effective_now
     or request_row.publication_mode is distinct from target_publication_mode
     or request_row.automation_run_id is distinct from target_run_id
     or request_row.requested_source_policy is distinct from
       preflight_receipt.source_policy
     or request_row.retrieval_version <> 'phase7-25-retrieval-v1'
     or (
       request_row.requested_source_policy <> 'auto'
       and request_row.requested_source_policy <> target_resolved_source_route
     ) then
    raise exception 'Google academic request is no longer admissible'
      using errcode = 'P7335';
  end if;

  update public.lecture_ai_control as control
  set
    academic_answers_enabled = true,
    status = case when exists (
      select 1 from public.ai_usage_ledger as usage
      where usage.lecture_session_id = target_lecture_session_id
        and usage.status = 'running'
    ) then 'running' else 'ready' end,
    stop_requested_at = null,
    stopped_at = null,
    stop_reason = null,
    version = control.version + 1,
    updated_at = effective_now
  where control.lecture_session_id = target_lecture_session_id;

  select
    count(*) filter (where intent.lecture_session_id = target_lecture_session_id),
    count(*) filter (where intent.created_at >= utc_day_start),
    coalesce(sum(usage.reserved_input_tokens) filter (
      where intent.lecture_session_id = target_lecture_session_id
    ), 0),
    coalesce(sum(usage.reserved_input_tokens) filter (
      where intent.created_at >= utc_day_start
    ), 0),
    coalesce(sum(usage.reserved_output_tokens) filter (
      where intent.lecture_session_id = target_lecture_session_id
    ), 0),
    coalesce(sum(usage.reserved_output_tokens) filter (
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
    lecture_calls, daily_calls,
    lecture_input_tokens, daily_input_tokens,
    lecture_output_tokens, daily_output_tokens,
    lecture_cost, daily_cost, policy_running
  from private.admin_google_ai_provider_start_intents as intent
  join private.admin_google_ai_provider_start_receipts as receipt
    on receipt.start_request_id = intent.start_request_id
  join public.ai_usage_ledger as usage
    on usage.id = receipt.operation_id
  where intent.policy_id = policy_row.id
    and intent.policy_version = policy_row.version;

  if lecture_calls + 1 > policy_row.max_calls_per_lecture
     or daily_calls + 1 > policy_row.max_calls_per_day
     or lecture_input_tokens + target_estimated_input_tokens >
       policy_row.max_input_tokens_per_lecture
     or daily_input_tokens + target_estimated_input_tokens >
       policy_row.max_input_tokens_per_day
     or lecture_output_tokens + target_estimated_output_tokens >
       policy_row.max_output_tokens_per_lecture
     or daily_output_tokens + target_estimated_output_tokens >
       policy_row.max_output_tokens_per_day
     or lecture_cost + target_estimated_microusd >
       policy_row.max_cost_microusd_per_lecture
     or daily_cost + target_estimated_microusd >
       policy_row.max_cost_microusd_per_day
     or policy_running + 1 > policy_row.max_concurrency then
    raise exception 'AI policy usage limit is unavailable'
      using errcode = 'P7335';
  end if;

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
    target_supabase_auth_session_id,
    target_lecture_session_id, master_row.id, policy_row.id,
    policy_row.version, 'academic_answers', target_model_id,
    'openai_responses_v1', target_provider_intent_digest,
    start_digest_value, effective_now
  ) returning * into start_intent;

  result_value := private.start_lecture_ai_operation(
    target_lecture_session_id,
    'academic_answers',
    target_start_request_id::text,
    target_estimated_microusd,
    0,
    target_estimated_input_tokens,
    target_estimated_output_tokens,
    actor_value
  );
  if coalesce((result_value ->> 'accepted')::boolean, false) is not true then
    raise exception 'Google academic provider start was rejected: %',
      coalesce(result_value ->> 'reason', 'unknown')
      using errcode = 'P7335';
  end if;
  if (result_value ->> 'idempotent_replay')::boolean is distinct from false then
    raise exception 'Google academic provider start collided with existing usage'
      using errcode = 'P7335';
  end if;
  operation_id_value := (result_value #>> '{operation,id}')::uuid;
  select usage.* into usage_row
  from public.ai_usage_ledger as usage
  where usage.id = operation_id_value
  for update;
  if not found
     or usage_row.lecture_session_id is distinct from target_lecture_session_id
     or usage_row.feature <> 'academic_answers'
     or usage_row.idempotency_key is distinct from target_start_request_id::text
     or usage_row.requested_by_actor is distinct from actor_value
     or usage_row.status <> 'running'
     or usage_row.reserved_microusd is distinct from target_estimated_microusd
     or usage_row.reserved_audio_seconds is distinct from 0
     or usage_row.reserved_input_tokens is distinct from
       target_estimated_input_tokens
     or usage_row.reserved_output_tokens is distinct from
       target_estimated_output_tokens then
    raise exception 'Google academic provider start has no operation receipt'
      using errcode = 'P7335';
  end if;

  update public.ai_usage_ledger as usage
  set
    model_id = target_model_id,
    pricing_unit = 'token',
    pricing_rate_microusd = ceil(
      target_output_price_microusd_per_million::numeric / 1000000
    )::bigint,
    last_heartbeat_at = effective_now
  where usage.id = operation_id_value;

  update public.academic_answer_requests as request
  set
    status = 'running',
    operation_id = operation_id_value,
    verified_source_count = target_verified_source_count,
    verified_primary_count = target_verified_primary_count,
    source_set_sha256 = target_source_set_sha256,
    prompt_version = target_prompt_version,
    resolved_source_route = target_resolved_source_route,
    lease_until = null,
    updated_at = effective_now
  where request.id = target_academic_request_id
    and request.status = 'evidence_checking'
  returning * into request_row;
  if not found then
    raise exception 'Google academic request could not enter running state'
      using errcode = 'P7335';
  end if;

  update public.ai_billing_grants as grant_record
  set
    status = 'consumed',
    consumed_at = effective_now,
    operation_ids = array[operation_id_value]::uuid[]
  where grant_record.id = target_grant_id
    and grant_record.status = 'issued'
  returning * into grant_row;
  if not found then
    raise exception 'Google academic child could not be consumed'
      using errcode = 'P7335';
  end if;

  insert into private.admin_google_ai_provider_start_receipts (
    start_request_id, child_grant_id, operation_id, result_status, started_at
  ) values (
    target_start_request_id, target_grant_id, operation_id_value,
    'started', effective_now
  ) returning * into start_receipt;

  insert into private.admin_google_academic_answer_start_bindings (
    start_request_id, operation_id, preflight_request_id, lecture_session_id,
    academic_request_id, run_id, publication_mode, source_set_sha256,
    resolved_source_route, verified_source_count, verified_primary_count,
    preflight_context_digest, provider_payload_sha256, created_at
  ) values (
    target_start_request_id, operation_id_value, target_preflight_request_id,
    target_lecture_session_id, target_academic_request_id, target_run_id,
    target_publication_mode, target_source_set_sha256,
    target_resolved_source_route, target_verified_source_count,
    target_verified_primary_count, target_preflight_context_digest,
    target_provider_payload_sha256, effective_now
  ) returning * into binding_row;

  return result_value || jsonb_build_object(
    'actorId', actor_value,
    'academicRequestId', target_academic_request_id,
    'idempotentReplay', false,
    'operationId', operation_id_value,
    'requestStatus', request_row.status
  );
end;
$$;

revoke all on function private.start_google_admin_academic_answer_operation_v1(
  text, uuid, uuid, text, text, integer, uuid, text, uuid, uuid, uuid, text,
  text, uuid, text, text, integer, integer, text, text, text, bigint, bigint,
  integer, bigint, bigint, bigint, uuid, text, boolean
) from public, anon, authenticated, service_role;

create function public.start_google_admin_academic_answer_operation_v1(
  target_token_hash text,
  target_auth_user_id uuid,
  target_supabase_auth_session_id uuid,
  target_google_issuer text,
  target_provider_subject_hmac text,
  target_subject_pepper_version integer,
  target_grant_id uuid,
  target_nonce_hash text,
  target_lecture_session_id uuid,
  target_academic_request_id uuid,
  target_preflight_request_id uuid,
  target_preflight_context_digest text,
  target_publication_mode text,
  target_run_id uuid,
  target_source_set_sha256 text,
  target_resolved_source_route text,
  target_verified_source_count integer,
  target_verified_primary_count integer,
  target_provider_payload_sha256 text,
  target_model_id text,
  target_prompt_version text,
  target_input_price_microusd_per_million bigint,
  target_output_price_microusd_per_million bigint,
  target_max_output_tokens integer,
  target_estimated_microusd bigint,
  target_estimated_input_tokens bigint,
  target_estimated_output_tokens bigint,
  target_start_request_id uuid,
  target_provider_intent_digest text,
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
  select private.start_google_admin_academic_answer_operation_v1(
    target_token_hash,
    target_auth_user_id,
    target_supabase_auth_session_id,
    target_google_issuer,
    target_provider_subject_hmac,
    target_subject_pepper_version,
    target_grant_id,
    target_nonce_hash,
    target_lecture_session_id,
    target_academic_request_id,
    target_preflight_request_id,
    target_preflight_context_digest,
    target_publication_mode,
    target_run_id,
    target_source_set_sha256,
    target_resolved_source_route,
    target_verified_source_count,
    target_verified_primary_count,
    target_provider_payload_sha256,
    target_model_id,
    target_prompt_version,
    target_input_price_microusd_per_million,
    target_output_price_microusd_per_million,
    target_max_output_tokens,
    target_estimated_microusd,
    target_estimated_input_tokens,
    target_estimated_output_tokens,
    target_start_request_id,
    target_provider_intent_digest,
    target_transport_enabled
  );
$$;

revoke all on function public.start_google_admin_academic_answer_operation_v1(
  text, uuid, uuid, text, text, integer, uuid, text, uuid, uuid, uuid, text,
  text, uuid, text, text, integer, integer, text, text, text, bigint, bigint,
  integer, bigint, bigint, bigint, uuid, text, boolean
) from public, anon, authenticated;
grant execute on function public.start_google_admin_academic_answer_operation_v1(
  text, uuid, uuid, text, text, integer, uuid, text, uuid, uuid, uuid, text,
  text, uuid, text, text, integer, integer, text, text, text, bigint, bigint,
  integer, bigint, bigint, bigint, uuid, text, boolean
) to service_role;

create function private.fail_google_admin_academic_answer_operation_v1(
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
  binding_row private.admin_google_academic_answer_start_bindings%rowtype;
  dispatch_row private.admin_google_ai_provider_dispatch_receipts%rowtype;
  lecture_row public.lecture_sessions%rowtype;
  control_row public.lecture_ai_control%rowtype;
  request_row public.academic_answer_requests%rowtype;
  usage_row public.ai_usage_ledger%rowtype;
  settlement jsonb;
begin
  if target_status not in ('failed', 'cancelled')
     or actual_microusd is null
     or actual_input_tokens is null
     or actual_output_tokens is null
     or least(actual_microusd, actual_input_tokens, actual_output_tokens) < 0
     or char_length(coalesce(error_code, '')) not between 1 and 120
     or (provider_request_id is not null and char_length(provider_request_id) > 200) then
    raise exception 'invalid Google academic provider failure'
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
  if evidence is null or evidence ->> 'feature' <> 'academic_answers' then
    return null;
  end if;

  select binding.* into binding_row
  from private.admin_google_academic_answer_start_bindings as binding
  where binding.start_request_id = target_start_request_id
    and binding.operation_id = target_operation_id;
  if not found then
    return null;
  end if;
  select request.* into request_row
  from public.academic_answer_requests as request
  where request.id = binding_row.academic_request_id
    and request.lecture_session_id = binding_row.lecture_session_id
    and request.operation_id = target_operation_id
    and request.requested_by_actor = evidence ->> 'actor_id';
  if not found then
    return null;
  end if;

  select receipt.* into dispatch_row
  from private.admin_google_ai_provider_dispatch_receipts as receipt
  where receipt.start_request_id = target_start_request_id
    and receipt.operation_id = target_operation_id;
  if (
       actual_microusd > 0
       or actual_input_tokens > 0
       or actual_output_tokens > 0
       or provider_request_id is not null
       or coalesce(error_code, '') like '%ambiguous%'
     )
     and dispatch_row.start_request_id is null then
    raise exception 'charged Google academic failure lacks dispatch evidence'
      using errcode = 'P7335';
  end if;

  select lecture.* into lecture_row
  from public.lecture_sessions as lecture
  where lecture.id = binding_row.lecture_session_id
  for update;
  if not found then
    return null;
  end if;
  select control.* into control_row
  from public.lecture_ai_control as control
  where control.lecture_session_id = binding_row.lecture_session_id
  for update;
  select request.* into request_row
  from public.academic_answer_requests as request
  where request.id = binding_row.academic_request_id
    and request.lecture_session_id = binding_row.lecture_session_id
    and request.operation_id = target_operation_id
    and request.requested_by_actor = evidence ->> 'actor_id'
  for update;
  select usage.* into usage_row
  from public.ai_usage_ledger as usage
  where usage.id = target_operation_id
  for update;
  if control_row.lecture_session_id is null
     or request_row.id is null
     or usage_row.id is null
     or usage_row.feature <> 'academic_answers'
     or usage_row.requested_by_actor is distinct from (evidence ->> 'actor_id')
     or usage_row.idempotency_key is distinct from target_start_request_id::text then
    return null;
  end if;
  if usage_row.accounting_settled_at is not null then
    return jsonb_build_object(
      'accepted', true,
      'academicRequestId', binding_row.academic_request_id,
      'idempotentReplay', true,
      'operationId', usage_row.id,
      'result_saved', false,
      'status', usage_row.status
    );
  end if;

  if usage_row.status = 'running' and target_status = 'failed' then
    settlement := private.fail_academic_answer_operation(
      binding_row.academic_request_id,
      target_operation_id,
      evidence ->> 'actor_id',
      actual_microusd,
      actual_input_tokens,
      actual_output_tokens,
      provider_request_id,
      error_code
    );
  else
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
    update public.academic_answer_requests as request
    set
      status = 'discarded',
      lease_until = null,
      error_code = left(
        coalesce(error_code, 'academic_answer_cancelled'),
        120
      ),
      updated_at = statement_timestamp()
    where request.id = binding_row.academic_request_id
      and request.operation_id = target_operation_id
      and request.status in ('evidence_checking', 'running');
  end if;
  return (settlement - 'results') || jsonb_build_object(
    'academicRequestId', binding_row.academic_request_id,
    'operationId', target_operation_id,
    'result_saved', false
  );
end;
$$;

revoke all on function private.fail_google_admin_academic_answer_operation_v1(
  text, uuid, uuid, text, text, integer, uuid, uuid, text, bigint, bigint,
  bigint, text, text
) from public, anon, authenticated, service_role;

create function public.fail_google_admin_academic_answer_operation_v1(
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
language sql
volatile
security definer
set search_path = ''
set statement_timeout = '8s'
set lock_timeout = '750ms'
as $$
  select private.fail_google_admin_academic_answer_operation_v1(
    target_token_hash,
    target_auth_user_id,
    target_supabase_auth_session_id,
    target_google_issuer,
    target_provider_subject_hmac,
    target_subject_pepper_version,
    target_start_request_id,
    target_operation_id,
    target_status,
    actual_microusd,
    actual_input_tokens,
    actual_output_tokens,
    provider_request_id,
    error_code
  );
$$;

revoke all on function public.fail_google_admin_academic_answer_operation_v1(
  text, uuid, uuid, text, text, integer, uuid, uuid, text, bigint, bigint,
  bigint, text, text
) from public, anon, authenticated;
grant execute on function public.fail_google_admin_academic_answer_operation_v1(
  text, uuid, uuid, text, text, integer, uuid, uuid, text, bigint, bigint,
  bigint, text, text
) to service_role;

create function private.complete_google_admin_academic_answer_operation_v1(
  target_token_hash text,
  target_auth_user_id uuid,
  target_supabase_auth_session_id uuid,
  target_google_issuer text,
  target_provider_subject_hmac text,
  target_subject_pepper_version integer,
  target_start_request_id uuid,
  target_operation_id uuid,
  target_sources jsonb,
  target_body jsonb,
  target_quality_result jsonb,
  actual_microusd bigint,
  actual_input_tokens bigint,
  actual_output_tokens bigint,
  provider_request_id text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
set statement_timeout = '10s'
set lock_timeout = '750ms'
as $$
declare
  evidence jsonb;
  context_value jsonb;
  authority_value jsonb;
  binding_row private.admin_google_academic_answer_start_bindings%rowtype;
  preflight_row private.admin_google_academic_answer_preflight_receipts%rowtype;
  dispatch_row private.admin_google_ai_provider_dispatch_receipts%rowtype;
  policy_row private.admin_ai_policies%rowtype;
  control_row public.lecture_ai_control%rowtype;
  run_row public.lecture_summary_runs%rowtype;
  request_row public.academic_answer_requests%rowtype;
  settlement jsonb;
  authority_is_live boolean := true;
  effective_now timestamptz := statement_timestamp();
begin
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
  if evidence is null or evidence ->> 'feature' <> 'academic_answers' then
    return null;
  end if;

  select binding.* into binding_row
  from private.admin_google_academic_answer_start_bindings as binding
  where binding.start_request_id = target_start_request_id
    and binding.operation_id = target_operation_id;
  select receipt.* into preflight_row
  from private.admin_google_academic_answer_preflight_receipts as receipt
  where receipt.request_id = binding_row.preflight_request_id
    and receipt.academic_request_id = binding_row.academic_request_id;
  select receipt.* into dispatch_row
  from private.admin_google_ai_provider_dispatch_receipts as receipt
  where receipt.start_request_id = target_start_request_id
    and receipt.operation_id = target_operation_id;
  if binding_row.start_request_id is null
     or preflight_row.request_id is null
     or dispatch_row.start_request_id is null
     or binding_row.lecture_session_id is distinct from
       (evidence ->> 'lecture_session_id')::uuid
     or binding_row.publication_mode is distinct from
       preflight_row.publication_mode
     or binding_row.run_id is distinct from preflight_row.run_id
     or binding_row.preflight_context_digest is distinct from
       preflight_row.provider_context_digest then
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
  authority_is_live := context_value is not null
    and (context_value ->> 'environment_id')::uuid is not distinct from
      (evidence ->> 'environment_id')::uuid
    and (context_value ->> 'principal_id')::uuid is not distinct from
      (evidence ->> 'principal_id')::uuid
    and (context_value ->> 'membership_id')::uuid is not distinct from
      (evidence ->> 'membership_id')::uuid
    and (context_value ->> 'admin_session_id')::uuid is not distinct from
      (evidence ->> 'admin_session_id')::uuid
    and (context_value ->> 'supabase_auth_session_id')::uuid is not distinct from
      (evidence ->> 'supabase_auth_session_id')::uuid;
  if authority_is_live then
    authority_value := private.require_google_academic_live_authority_v1(
      context_value,
      binding_row.lecture_session_id,
      case when binding_row.publication_mode = 'auto_unreviewed'
        then array['academic_answers', 'summaries']::text[]
        else array['academic_answers']::text[] end
    );
    authority_is_live := authority_value is not null
      and (authority_value ->> 'master_authorization_id')::uuid
        is not distinct from (evidence ->> 'master_authorization_id')::uuid
      and (authority_value ->> 'policy_id')::uuid
        is not distinct from (evidence ->> 'policy_id')::uuid
      and (authority_value ->> 'policy_version')::bigint
        is not distinct from (evidence ->> 'policy_version')::bigint;
    if authority_is_live then
      select policy.* into policy_row
      from private.admin_ai_policies as policy
      where policy.id = (evidence ->> 'policy_id')::uuid
        and policy.version = (evidence ->> 'policy_version')::bigint
        and policy.environment_id = (evidence ->> 'environment_id')::uuid
        and policy.membership_id = (evidence ->> 'membership_id')::uuid
      for update;
      authority_is_live := found
        and policy_row.status = 'active'
        and policy_row.valid_from <= effective_now
        and policy_row.valid_until > effective_now
        and array[evidence ->> 'model_id']::text[] <@ policy_row.allowed_models;
    end if;
  end if;

  -- Terminal cleanup always follows lecture -> control -> run -> request ->
  -- usage. The live branch may publish; the revoked branch only settles and
  -- discards the already-dispatched result.
  perform 1
  from public.lecture_sessions as lecture
  where lecture.id = binding_row.lecture_session_id
  for update;
  if not found then
    return null;
  end if;
  select control.* into control_row
  from public.lecture_ai_control as control
  where control.lecture_session_id = binding_row.lecture_session_id
  for update;
  if not found then
    return null;
  end if;

  if binding_row.publication_mode = 'auto_unreviewed' then
    select run.* into run_row
    from public.lecture_summary_runs as run
    where run.id = binding_row.run_id
      and run.lecture_session_id = binding_row.lecture_session_id
    for update;
    authority_is_live := authority_is_live
      and found
      and run_row.status = 'running'
      and run_row.expires_at > statement_timestamp()
      and run_row.actor_id = evidence ->> 'actor_id'
      and run_row.token_hash = preflight_row.run_token_hash
      and run_row.auto_academic_answers_enabled
      and run_row.academic_authority_mode = 'google_per_call'
      and run_row.academic_authorization_grant_id is null;
  end if;

  select request.* into request_row
  from public.academic_answer_requests as request
  where request.id = binding_row.academic_request_id
    and request.lecture_session_id = binding_row.lecture_session_id
    and request.operation_id = target_operation_id
    and request.requested_by_actor = evidence ->> 'actor_id'
  for update;
  if not found then
    return null;
  end if;

  if not authority_is_live then
    settlement := private.fail_academic_answer_operation(
      binding_row.academic_request_id,
      target_operation_id,
      evidence ->> 'actor_id',
      actual_microusd,
      actual_input_tokens,
      actual_output_tokens,
      provider_request_id,
      'google_authority_revoked'
    );
    return settlement || jsonb_build_object(
      'accepted', false,
      'academicRequestId', binding_row.academic_request_id,
      'authorityRevoked', true,
      'result_saved', false
    );
  end if;

  settlement := private.complete_academic_answer_operation(
    binding_row.academic_request_id,
    target_operation_id,
    evidence ->> 'actor_id',
    target_sources,
    target_body,
    target_quality_result,
    actual_microusd,
    actual_input_tokens,
    actual_output_tokens,
    provider_request_id
  );
  return settlement || jsonb_build_object(
    'academicRequestId', binding_row.academic_request_id
  );
end;
$$;

revoke all on function private.complete_google_admin_academic_answer_operation_v1(
  text, uuid, uuid, text, text, integer, uuid, uuid, jsonb, jsonb, jsonb,
  bigint, bigint, bigint, text
) from public, anon, authenticated, service_role;

create function public.complete_google_admin_academic_answer_operation_v1(
  target_token_hash text,
  target_auth_user_id uuid,
  target_supabase_auth_session_id uuid,
  target_google_issuer text,
  target_provider_subject_hmac text,
  target_subject_pepper_version integer,
  target_start_request_id uuid,
  target_operation_id uuid,
  target_sources jsonb,
  target_body jsonb,
  target_quality_result jsonb,
  actual_microusd bigint,
  actual_input_tokens bigint,
  actual_output_tokens bigint,
  provider_request_id text
)
returns jsonb
language sql
volatile
security definer
set search_path = ''
set statement_timeout = '10s'
set lock_timeout = '750ms'
as $$
  select private.complete_google_admin_academic_answer_operation_v1(
    target_token_hash,
    target_auth_user_id,
    target_supabase_auth_session_id,
    target_google_issuer,
    target_provider_subject_hmac,
    target_subject_pepper_version,
    target_start_request_id,
    target_operation_id,
    target_sources,
    target_body,
    target_quality_result,
    actual_microusd,
    actual_input_tokens,
    actual_output_tokens,
    provider_request_id
  );
$$;

revoke all on function public.complete_google_admin_academic_answer_operation_v1(
  text, uuid, uuid, text, text, integer, uuid, uuid, jsonb, jsonb, jsonb,
  bigint, bigint, bigint, text
) from public, anon, authenticated;
grant execute on function public.complete_google_admin_academic_answer_operation_v1(
  text, uuid, uuid, text, text, integer, uuid, uuid, jsonb, jsonb, jsonb,
  bigint, bigint, bigint, text
) to service_role;

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
       'material_analysis', 'poll_suggestions', 'summaries', 'academic_answers'
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

  if intent_row.feature = 'academic_answers' then
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

-- Keep the legacy compatibility path during the default-OFF expansion, but
-- normalize its lock order with the Google provider path. The request probe is
-- nonlocking; all mutable state is re-read after grant -> lecture -> control.
create or replace function private.start_academic_answer_operation(
  target_request_id uuid,
  target_grant_id uuid,
  target_nonce_hash text,
  target_actor_id text,
  target_model_id text,
  target_prompt_version text,
  target_source_set_sha256 text,
  target_verified_source_count integer,
  target_verified_primary_count integer,
  estimated_microusd bigint,
  estimated_input_tokens bigint,
  estimated_output_tokens bigint,
  target_input_price_microusd_per_million bigint,
  target_output_price_microusd_per_million bigint
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  request_probe public.academic_answer_requests%rowtype;
  request_row public.academic_answer_requests%rowtype;
  control_row public.lecture_ai_control%rowtype;
  start_result jsonb;
  created_operation_id uuid;
begin
  select request.* into request_probe
  from public.academic_answer_requests as request
  where request.id = target_request_id;
  if not found
     or request_probe.requested_by_actor is distinct from target_actor_id then
    raise exception 'academic request is not owned by this actor'
      using errcode = '42501';
  end if;

  perform 1
  from public.ai_billing_grants as billing_grant
  where billing_grant.id = target_grant_id
    and billing_grant.lecture_session_id = request_probe.lecture_session_id
  for update;
  if not found then
    raise exception 'academic billing grant is unavailable' using errcode = 'P0001';
  end if;
  perform 1
  from public.lecture_sessions as lecture
  where lecture.id = request_probe.lecture_session_id
  for update;
  if not found then
    raise exception 'academic lecture is unavailable' using errcode = 'P0001';
  end if;
  select control.* into control_row
  from public.lecture_ai_control as control
  where control.lecture_session_id = request_probe.lecture_session_id
  for update;
  if not found then
    raise exception 'AI control is not configured' using errcode = 'P0001';
  end if;
  select request.* into request_row
  from public.academic_answer_requests as request
  where request.id = target_request_id
    and request.lecture_session_id = request_probe.lecture_session_id
  for update;
  if not found
     or request_row.requested_by_actor is distinct from target_actor_id then
    raise exception 'academic request is not owned by this actor'
      using errcode = '42501';
  end if;
  if request_row.status <> 'evidence_checking'
     or request_row.lease_until <= statement_timestamp()
     or target_verified_source_count not between 1 and 5
     or target_verified_primary_count not between 1 and target_verified_source_count
     or target_source_set_sha256 !~ '^[0-9a-f]{64}$'
     or char_length(coalesce(target_prompt_version, '')) not between 1 and 120
     or target_input_price_microusd_per_million < 0
     or target_output_price_microusd_per_million < 0 then
    raise exception 'academic evidence admission rejected' using errcode = 'P0001';
  end if;
  if control_row.academic_answer_calls_used >= least(
    control_row.academic_answer_limit, 3
  ) then
    return jsonb_build_object('accepted', false, 'reason', 'academic_answer_limit');
  end if;

  start_result := private.consume_ai_billing_grant_and_start_operations(
    target_grant_id,
    target_nonce_hash,
    request_row.lecture_session_id,
    jsonb_build_array(jsonb_build_object(
      'feature', 'academic_answers',
      'idempotency_key', request_row.idempotency_key,
      'model_id', target_model_id,
      'pricing_unit', 'token',
      'pricing_rate_microusd', target_input_price_microusd_per_million,
      'estimated_microusd', estimated_microusd,
      'estimated_audio_seconds', 0,
      'estimated_input_tokens', estimated_input_tokens,
      'estimated_output_tokens', estimated_output_tokens
    )),
    target_actor_id
  );
  if coalesce((start_result ->> 'accepted')::boolean, false) is not true then
    return start_result;
  end if;
  created_operation_id := (start_result #>> '{operations,0,operation,id}')::uuid;
  update public.academic_answer_requests
  set status = 'running', operation_id = created_operation_id,
      verified_source_count = target_verified_source_count,
      verified_primary_count = target_verified_primary_count,
      source_set_sha256 = target_source_set_sha256,
      prompt_version = target_prompt_version,
      lease_until = null, updated_at = statement_timestamp()
  where id = target_request_id;
  return start_result || jsonb_build_object('request_id', target_request_id);
end;
$$;

create or replace function private.start_academic_answer_operation_v2(
  target_request_id uuid,
  target_grant_id uuid,
  target_nonce_hash text,
  target_actor_id text,
  target_model_id text,
  target_prompt_version text,
  target_source_set_sha256 text,
  target_resolved_source_route text,
  target_verified_source_count integer,
  target_verified_primary_count integer,
  estimated_microusd bigint,
  estimated_input_tokens bigint,
  estimated_output_tokens bigint,
  target_input_price_microusd_per_million bigint,
  target_output_price_microusd_per_million bigint
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  request_probe public.academic_answer_requests%rowtype;
  request_row public.academic_answer_requests%rowtype;
  started jsonb;
begin
  select request.* into request_probe
  from public.academic_answer_requests as request
  where request.id = target_request_id;
  if not found
     or request_probe.requested_by_actor is distinct from target_actor_id then
    raise exception 'academic request is not owned by this actor'
      using errcode = '42501';
  end if;
  if request_probe.retrieval_version <> 'phase7-25-retrieval-v1'
     or target_resolved_source_route not in (
       'biomedical_pubmed', 'multidisciplinary_doi'
     )
     or (
       request_probe.requested_source_policy <> 'auto'
       and request_probe.requested_source_policy <> target_resolved_source_route
     ) then
    raise exception 'academic source route mismatch' using errcode = '22023';
  end if;

  started := private.start_academic_answer_operation(
    target_request_id, target_grant_id, target_nonce_hash, target_actor_id,
    target_model_id, target_prompt_version, target_source_set_sha256,
    target_verified_source_count, target_verified_primary_count,
    estimated_microusd, estimated_input_tokens, estimated_output_tokens,
    target_input_price_microusd_per_million,
    target_output_price_microusd_per_million
  );
  update public.academic_answer_requests as request
  set resolved_source_route = target_resolved_source_route,
      updated_at = statement_timestamp()
  where request.id = target_request_id
    and request.requested_by_actor = target_actor_id
    and request.retrieval_version = 'phase7-25-retrieval-v1'
    and (
      request.requested_source_policy = 'auto'
      or request.requested_source_policy = target_resolved_source_route
    )
  returning * into request_row;
  if not found then
    raise exception 'academic source route changed during start'
      using errcode = 'P0001';
  end if;
  return started;
end;
$$;

-- Legacy automatic answers remain bound to their run-level grant. Google runs
-- use one child per provider call and are permanently rejected here.
create or replace function private.start_auto_academic_answer_operation(
  target_request_id uuid,
  target_run_id uuid,
  target_run_token_hash text,
  target_actor_id text,
  target_model_id text,
  target_prompt_version text,
  target_source_set_sha256 text,
  target_resolved_source_route text,
  target_verified_source_count integer,
  target_verified_primary_count integer,
  estimated_microusd bigint,
  estimated_input_tokens bigint,
  estimated_output_tokens bigint,
  target_input_price_microusd_per_million bigint,
  target_output_price_microusd_per_million bigint
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  request_probe public.academic_answer_requests%rowtype;
  request_row public.academic_answer_requests%rowtype;
  run_row public.lecture_summary_runs%rowtype;
  control_row public.lecture_ai_control%rowtype;
  start_result jsonb;
  created_operation_id uuid;
begin
  select request.* into request_probe
  from public.academic_answer_requests as request
  where request.id = target_request_id;
  if not found then
    raise exception 'academic request not found' using errcode = 'P0002';
  end if;
  perform private.close_lecture_if_expired(request_probe.lecture_session_id);
  perform 1 from public.lecture_sessions as lecture
  where lecture.id = request_probe.lecture_session_id
    and lecture.status = 'open'
    and lecture.hard_stop_at > statement_timestamp()
  for update;
  if not found then
    return jsonb_build_object('accepted', false, 'reason', 'lecture_not_open');
  end if;
  select control.* into control_row
  from public.lecture_ai_control as control
  where control.lecture_session_id = request_probe.lecture_session_id
  for update;
  if not found then
    raise exception 'AI control is not configured' using errcode = 'P0001';
  end if;
  select run.* into run_row
  from public.lecture_summary_runs as run
  where run.id = target_run_id
    and run.lecture_session_id = request_probe.lecture_session_id
    and run.actor_id = target_actor_id
    and run.token_hash = target_run_token_hash
    and run.status = 'running'
    and run.expires_at > statement_timestamp()
    and run.auto_academic_answers_enabled
    and run.academic_authority_mode = 'legacy_run_grant'
    and run.academic_authorization_grant_id is not null
  for update;
  if not found then
    return jsonb_build_object('accepted', false, 'reason', 'automation_not_authorized');
  end if;
  select request.* into request_row
  from public.academic_answer_requests as request
  where request.id = target_request_id
  for update;
  if request_row.requested_by_actor <> target_actor_id
     or request_row.automation_run_id <> target_run_id
     or request_row.publication_mode <> 'auto_unreviewed'
     or request_row.status <> 'evidence_checking'
     or request_row.lease_until <= statement_timestamp()
     or target_run_token_hash !~ '^[0-9a-f]{64}$'
     or target_verified_source_count not between 1 and 5
     or target_verified_primary_count not between 1 and target_verified_source_count
     or target_source_set_sha256 !~ '^[0-9a-f]{64}$'
     or target_resolved_source_route not in (
       'biomedical_pubmed', 'multidisciplinary_doi'
     )
     or (
       request_row.requested_source_policy <> 'auto'
       and request_row.requested_source_policy <> target_resolved_source_route
     )
     or run_row.academic_source_policy <> request_row.requested_source_policy
     or char_length(coalesce(target_prompt_version, '')) not between 1 and 120
     or target_input_price_microusd_per_million < 0
     or target_output_price_microusd_per_million < 0 then
    raise exception 'automatic academic evidence admission rejected'
      using errcode = 'P0001';
  end if;
  if control_row.academic_answer_calls_used >= least(
    control_row.academic_answer_limit, 3
  ) then
    update public.academic_answer_requests
    set status = 'discarded', lease_until = null,
        error_code = 'academic_answer_limit', updated_at = statement_timestamp()
    where id = target_request_id;
    return jsonb_build_object('accepted', false, 'reason', 'academic_answer_limit');
  end if;

  start_result := private.start_lecture_ai_operation(
    request_row.lecture_session_id, 'academic_answers', request_row.idempotency_key,
    estimated_microusd, 0, estimated_input_tokens, estimated_output_tokens,
    target_actor_id
  );
  if coalesce((start_result ->> 'accepted')::boolean, false) is not true then
    update public.academic_answer_requests
    set status = case when start_result ->> 'reason' = 'concurrency_limit'
          then 'evidence_checking' else 'discarded' end,
        lease_until = case when start_result ->> 'reason' = 'concurrency_limit'
          then statement_timestamp() else null end,
        error_code = left(coalesce(start_result ->> 'reason', 'operation_rejected'), 120),
        updated_at = statement_timestamp()
    where id = target_request_id;
    return start_result;
  end if;
  created_operation_id := (start_result #>> '{operation,id}')::uuid;
  update public.ai_usage_ledger as usage
  set model_id = target_model_id, pricing_unit = 'token',
      pricing_rate_microusd = target_input_price_microusd_per_million,
      last_heartbeat_at = statement_timestamp()
  where usage.id = created_operation_id;
  update public.academic_answer_requests
  set status = 'running', operation_id = created_operation_id,
      verified_source_count = target_verified_source_count,
      verified_primary_count = target_verified_primary_count,
      source_set_sha256 = target_source_set_sha256,
      prompt_version = target_prompt_version,
      resolved_source_route = target_resolved_source_route,
      lease_until = null, updated_at = statement_timestamp()
  where id = target_request_id;
  update public.ai_billing_grants as billing_grant
  set operation_ids = case
    when created_operation_id = any(billing_grant.operation_ids)
      then billing_grant.operation_ids
    else array_append(billing_grant.operation_ids, created_operation_id) end
  where billing_grant.id = run_row.academic_authorization_grant_id;
  return jsonb_build_object(
    'accepted', true,
    'idempotent_replay', coalesce((start_result ->> 'idempotent_replay')::boolean, false),
    'operation', start_result -> 'operation',
    'request_id', target_request_id
  );
end;
$$;
