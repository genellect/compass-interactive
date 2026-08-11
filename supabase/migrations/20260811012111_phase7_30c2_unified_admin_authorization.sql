-- Phase 7.30C2: dormant unified Google Admin operational authorization.
--
-- This migration is expand-first and default OFF. It introduces the database
-- transaction boundary that every operational Admin Edge path must use before
-- the later Google-only cutover. It does not infer ownership for an existing
-- lecture, remove either legacy shared PIN, enable a paid provider, or change a
-- Hosted project.

alter table private.admin_identity_runtime_gate
  add column google_operational_authorization_enabled boolean not null
    default false;

comment on column
  private.admin_identity_runtime_gate.google_operational_authorization_enabled
is
  'Default-OFF C2 gate for Google Admin operational authorization. Exact replay and explicitly free terminal controls may remain available while new/elevating work is disabled.';

create or replace function private.get_admin_identity_runtime_gate_v1()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'google_operational_authorization_enabled',
      gate.google_operational_authorization_enabled,
    'google_session_issue_enabled', gate.google_session_issue_enabled,
    'legacy_pin_login_enabled', gate.legacy_pin_login_enabled,
    'operator_totp_factor_set_adoption_enabled',
      gate.operator_totp_factor_set_adoption_enabled,
    'totp_factor_mutation_enabled', gate.totp_factor_mutation_enabled
  )
  from private.admin_identity_runtime_gate as gate
  where gate.singleton;
$$;

revoke all on function private.get_admin_identity_runtime_gate_v1()
  from public, anon, authenticated;
grant execute on function private.get_admin_identity_runtime_gate_v1()
  to service_role;

create table private.admin_google_operation_policies (
  operation_key text primary key check (
    operation_key ~ '^[a-z0-9-]+\.[A-Za-z][A-Za-z0-9_]*$'
  ),
  edge_function text not null check (
    edge_function ~ '^[a-z0-9-]+$'
  ),
  action_name text not null check (
    action_name ~ '^[A-Za-z][A-Za-z0-9_]*$'
  ),
  access_scope text not null check (
    access_scope in (
      'create_owned',
      'lecture_list',
      'owned_lecture',
      'owner_lecture',
      'self_or_owner',
      'environment_owner'
    )
  ),
  lecture_state text not null check (
    lecture_state in (
      'none',
      'draft',
      'closed',
      'draft_or_open',
      'draft_or_open_any',
      'open',
      'open_any',
      'retained'
    )
  ),
  gate_mode text not null check (
    gate_mode in ('required', 'gate_independent')
  ),
  operation_class text not null check (
    operation_class in (
      'read',
      'write',
      'free_control',
      'paid_start',
      'provider_continuation'
    )
  ),
  lecture_lock_mode text not null default 'share' check (
    lecture_lock_mode in ('share', 'update')
  ),
  instructor_requires_ai boolean not null default false,
  owner_requires_ai boolean not null default false,
  request_binding_required boolean not null default true,
  control_step_up_action text check (
    control_step_up_action is null
    or control_step_up_action = 'environment_ai_policy_change'
  ),
  unique (edge_function, action_name),
  check (
    (access_scope in ('create_owned', 'lecture_list') and lecture_state = 'none')
    or (access_scope in ('self_or_owner', 'environment_owner') and lecture_state = 'none')
    or (access_scope in ('owned_lecture', 'owner_lecture') and lecture_state <> 'none')
  )
);

comment on table private.admin_google_operation_policies is
  'Closed C2 authorization inventory. Rows are migration-owned policy, never caller input or a browser/service-role writable authorization surface.';

alter table private.admin_google_operation_policies enable row level security;
revoke all on private.admin_google_operation_policies
  from public, anon, authenticated, service_role;

insert into private.admin_google_operation_policies (
  operation_key,
  edge_function,
  action_name,
  access_scope,
  lecture_state,
  gate_mode,
  operation_class,
  instructor_requires_ai,
  owner_requires_ai,
  request_binding_required
) values
  -- Lecture lifecycle and classroom controls.
  ('manage-lectures.list', 'manage-lectures', 'list', 'lecture_list', 'none', 'gate_independent', 'read', false, false, false),
  ('manage-lectures.create', 'manage-lectures', 'create', 'create_owned', 'none', 'required', 'write', false, false, true),
  ('manage-lectures.createJournalClubRun', 'manage-lectures', 'createJournalClubRun', 'create_owned', 'none', 'required', 'write', false, false, true),
  ('manage-lectures.duplicate', 'manage-lectures', 'duplicate', 'owned_lecture', 'closed', 'required', 'write', false, false, true),
  ('manage-lectures.start', 'manage-lectures', 'start', 'owned_lecture', 'draft', 'required', 'write', false, false, true),
  ('manage-lectures.close', 'manage-lectures', 'close', 'owned_lecture', 'open_any', 'gate_independent', 'free_control', false, false, true),
  ('manage-lectures.emergencyStop', 'manage-lectures', 'emergencyStop', 'owner_lecture', 'open_any', 'gate_independent', 'free_control', false, false, true),
  ('manage-admin-sessions.list', 'manage-admin-sessions', 'list', 'self_or_owner', 'none', 'gate_independent', 'read', false, false, false),
  ('manage-admin-sessions.logout', 'manage-admin-sessions', 'logout', 'self_or_owner', 'none', 'gate_independent', 'free_control', false, false, true),
  ('manage-admin-sessions.revoke', 'manage-admin-sessions', 'revoke', 'self_or_owner', 'none', 'gate_independent', 'free_control', false, false, true),
  ('manage-admin-sessions.revokeAll', 'manage-admin-sessions', 'revokeAll', 'self_or_owner', 'none', 'gate_independent', 'free_control', false, false, true),
  ('manage-comments.togglePin', 'manage-comments', 'togglePin', 'owned_lecture', 'retained', 'required', 'write', false, false, true),
  ('manage-comments.toggleVisibility', 'manage-comments', 'toggleVisibility', 'owned_lecture', 'retained', 'required', 'write', false, false, true),
  ('manage-polls.list', 'manage-polls', 'list', 'owned_lecture', 'retained', 'gate_independent', 'read', false, false, false),
  ('manage-polls.create', 'manage-polls', 'create', 'owned_lecture', 'draft_or_open', 'required', 'write', false, false, true),
  ('manage-polls.open', 'manage-polls', 'open', 'owned_lecture', 'open', 'required', 'write', false, false, true),
  ('manage-polls.close', 'manage-polls', 'close', 'owned_lecture', 'draft_or_open_any', 'gate_independent', 'free_control', false, false, true),
  ('publish-caption-window.publish', 'publish-caption-window', 'publish', 'owned_lecture', 'open', 'required', 'provider_continuation', true, true, true),

  -- AI control, master, child and provider paths. Ambiguous curation paths
  -- conservatively require can_use_ai for instructors; configure is owner-only.
  ('manage-ai-control.status', 'manage-ai-control', 'status', 'owned_lecture', 'retained', 'gate_independent', 'read', false, false, false),
  ('manage-ai-control.configure', 'manage-ai-control', 'configure', 'owner_lecture', 'draft_or_open', 'required', 'write', false, true, true),
  ('manage-ai-control.startOperation', 'manage-ai-control', 'startOperation', 'owned_lecture', 'open', 'required', 'paid_start', true, true, true),
  ('manage-ai-control.finishOperation', 'manage-ai-control', 'finishOperation', 'owned_lecture', 'retained', 'gate_independent', 'provider_continuation', false, false, true),
  ('manage-ai-control.heartbeat', 'manage-ai-control', 'heartbeat', 'owned_lecture', 'open', 'gate_independent', 'provider_continuation', false, false, true),
  ('manage-ai-control.stopFeature', 'manage-ai-control', 'stopFeature', 'owned_lecture', 'retained', 'gate_independent', 'free_control', false, false, true),
  ('manage-ai-control.stop', 'manage-ai-control', 'stop', 'owned_lecture', 'retained', 'gate_independent', 'free_control', false, false, true),
  ('authorize-ai-start.masterStatus', 'authorize-ai-start', 'masterStatus', 'owned_lecture', 'retained', 'gate_independent', 'read', false, false, false),
  ('authorize-ai-start.authorizeMaster', 'authorize-ai-start', 'authorizeMaster', 'owned_lecture', 'open', 'required', 'paid_start', true, true, true),
  ('authorize-ai-start.issueGrant', 'authorize-ai-start', 'issueGrant', 'owned_lecture', 'open', 'required', 'paid_start', true, true, true),
  ('authorize-ai-start.revokeMaster', 'authorize-ai-start', 'revokeMaster', 'owned_lecture', 'retained', 'gate_independent', 'free_control', false, false, true),
  ('analyze-lecture-material.material_analysis', 'analyze-lecture-material', 'material_analysis', 'owned_lecture', 'open', 'required', 'paid_start', true, true, true),
  ('analyze-lecture-material.poll_suggestions', 'analyze-lecture-material', 'poll_suggestions', 'owned_lecture', 'open', 'required', 'paid_start', true, true, true),
  ('generate-lecture-summary.generate', 'generate-lecture-summary', 'generate', 'owned_lecture', 'open', 'required', 'paid_start', true, true, true),
  ('manage-lecture-summaries.status', 'manage-lecture-summaries', 'status', 'owned_lecture', 'retained', 'gate_independent', 'read', true, false, false),
  ('manage-lecture-summaries.start', 'manage-lecture-summaries', 'start', 'owned_lecture', 'open', 'required', 'paid_start', true, true, true),
  ('manage-lecture-summaries.resume', 'manage-lecture-summaries', 'resume', 'owned_lecture', 'open', 'required', 'paid_start', true, true, true),
  ('manage-lecture-summaries.stop', 'manage-lecture-summaries', 'stop', 'owned_lecture', 'retained', 'gate_independent', 'free_control', false, false, true),
  ('manage-lecture-summaries.publish', 'manage-lecture-summaries', 'publish', 'owned_lecture', 'retained', 'required', 'write', true, false, true),
  ('manage-lecture-summaries.hide', 'manage-lecture-summaries', 'hide', 'owned_lecture', 'retained', 'gate_independent', 'free_control', true, false, true),
  ('manage-lecture-summaries.pin', 'manage-lecture-summaries', 'pin', 'owned_lecture', 'retained', 'required', 'write', true, false, true),
  ('manage-lecture-summaries.unpin', 'manage-lecture-summaries', 'unpin', 'owned_lecture', 'retained', 'required', 'write', true, false, true),
  ('manage-lecture-summaries.revisePublish', 'manage-lecture-summaries', 'revisePublish', 'owned_lecture', 'retained', 'required', 'write', true, false, true),
  ('generate-academic-answer.status', 'generate-academic-answer', 'status', 'owned_lecture', 'retained', 'gate_independent', 'read', true, false, false),
  ('generate-academic-answer.generate', 'generate-academic-answer', 'generate', 'owned_lecture', 'open', 'required', 'paid_start', true, true, true),
  ('generate-academic-answer.generateAuto', 'generate-academic-answer', 'generateAuto', 'owned_lecture', 'open', 'required', 'paid_start', true, true, true),
  ('generate-academic-answer.cancel', 'generate-academic-answer', 'cancel', 'owned_lecture', 'retained', 'gate_independent', 'free_control', false, false, true),
  ('generate-academic-answer.revise', 'generate-academic-answer', 'revise', 'owned_lecture', 'retained', 'required', 'write', true, false, true),
  ('generate-academic-answer.approve', 'generate-academic-answer', 'approve', 'owned_lecture', 'retained', 'required', 'write', true, false, true),
  ('generate-academic-answer.hide', 'generate-academic-answer', 'hide', 'owned_lecture', 'retained', 'gate_independent', 'free_control', true, false, true),
  ('generate-academic-answer.reject', 'generate-academic-answer', 'reject', 'owned_lecture', 'retained', 'gate_independent', 'free_control', true, false, true),
  ('manage-material-analysis.list', 'manage-material-analysis', 'list', 'owned_lecture', 'retained', 'gate_independent', 'read', true, false, false),
  ('manage-material-analysis.adopt', 'manage-material-analysis', 'adopt', 'owned_lecture', 'draft_or_open', 'required', 'write', true, false, true),
  ('manage-material-analysis.reject', 'manage-material-analysis', 'reject', 'owned_lecture', 'retained', 'gate_independent', 'free_control', true, false, true),
  ('manage-material-analysis.publishSummary', 'manage-material-analysis', 'publishSummary', 'owned_lecture', 'retained', 'required', 'write', true, false, true),
  ('manage-material-analysis.hideSummary', 'manage-material-analysis', 'hideSummary', 'owned_lecture', 'retained', 'gate_independent', 'free_control', true, false, true),
  ('issue-realtime-client-secret.issue', 'issue-realtime-client-secret', 'issue', 'owned_lecture', 'open', 'required', 'paid_start', true, true, true),

  -- PDF, Display, Presenter and operator surfaces.
  ('issue-display-session.issue', 'issue-display-session', 'issue', 'owned_lecture', 'open', 'required', 'write', false, false, true),
  ('update-display-state.next', 'update-display-state', 'next', 'owned_lecture', 'draft_or_open', 'required', 'write', false, false, true),
  ('update-display-state.previous', 'update-display-state', 'previous', 'owned_lecture', 'draft_or_open', 'required', 'write', false, false, true),
  ('update-display-state.goToPage', 'update-display-state', 'goToPage', 'owned_lecture', 'draft_or_open', 'required', 'write', false, false, true),
  ('update-display-state.setDisplayMode', 'update-display-state', 'setDisplayMode', 'owned_lecture', 'draft_or_open', 'required', 'write', false, false, true),
  ('update-display-state.setDocument', 'update-display-state', 'setDocument', 'owned_lecture', 'draft_or_open', 'required', 'write', false, false, true),
  ('operator-live-snapshot.snapshot', 'operator-live-snapshot', 'snapshot', 'owned_lecture', 'retained', 'gate_independent', 'read', false, false, false),
  ('operator-live-snapshot.commentHistory', 'operator-live-snapshot', 'commentHistory', 'owned_lecture', 'retained', 'gate_independent', 'read', false, false, false),
  ('issue-pdf-access-token.admin', 'issue-pdf-access-token', 'admin', 'owned_lecture', 'retained', 'required', 'read', false, false, true),
  ('manage-pdf-documents.list', 'manage-pdf-documents', 'list', 'owned_lecture', 'retained', 'gate_independent', 'read', false, false, false),
  ('manage-pdf-documents.register', 'manage-pdf-documents', 'register', 'owned_lecture', 'draft_or_open', 'required', 'write', false, false, true),
  ('manage-pdf-publications.discover', 'manage-pdf-publications', 'discover', 'owned_lecture', 'retained', 'gate_independent', 'read', false, false, false),
  ('manage-pdf-publications.status', 'manage-pdf-publications', 'status', 'owned_lecture', 'retained', 'gate_independent', 'read', false, false, false),
  ('manage-pdf-publications.initiate', 'manage-pdf-publications', 'initiate', 'owned_lecture', 'draft_or_open', 'required', 'write', false, false, true),
  ('manage-pdf-publications.finalize', 'manage-pdf-publications', 'finalize', 'owned_lecture', 'draft_or_open', 'required', 'provider_continuation', false, false, true),
  ('manage-pdf-publications.abort', 'manage-pdf-publications', 'abort', 'owned_lecture', 'retained', 'gate_independent', 'free_control', false, false, true),
  ('manage-presenter-connection.issue', 'manage-presenter-connection', 'issue', 'owned_lecture', 'open', 'required', 'write', false, false, true),
  ('manage-presenter-connection.confirm', 'manage-presenter-connection', 'confirm', 'owned_lecture', 'open', 'required', 'write', false, false, true),
  ('manage-presenter-connection.status', 'manage-presenter-connection', 'status', 'owned_lecture', 'retained', 'gate_independent', 'read', false, false, false),
  ('manage-presenter-connection.revoke', 'manage-presenter-connection', 'revoke', 'owned_lecture', 'retained', 'gate_independent', 'free_control', false, false, true);

update private.admin_google_operation_policies
set control_step_up_action = 'environment_ai_policy_change'
where operation_key = 'manage-ai-control.configure';

-- Acquire the lecture lock mode required by each nested legacy operation before
-- entering that operation. All state-changing paths take UPDATE up front so a
-- nested legacy RPC can never create a SHARE-to-UPDATE conversion deadlock.
-- The two nominal reads below also reconcile an expired lecture and therefore
-- require the same exclusive lock. Genuinely read-only projections keep SHARE.
update private.admin_google_operation_policies
set lecture_lock_mode = 'update'
where operation_class <> 'read'
   or operation_key in (
     'operator-live-snapshot.snapshot',
     'operator-live-snapshot.commentHistory'
   );

create trigger admin_google_operation_policies_immutable
before update or delete on private.admin_google_operation_policies
for each row execute function private.reject_admin_c1_evidence_mutation_v1();

-- This helper is never an externally callable verifier. A domain facade calls
-- it inside the same transaction that performs its typed read or mutation.
-- The C1 helper supplies the canonical P -> M -> environment -> application
-- session -> Auth session locks and the approved/live TOTP-set comparison.
create function private.require_google_admin_operation_context_v1(
  target_token_hash text,
  target_auth_user_id uuid,
  target_supabase_auth_session_id uuid,
  target_google_issuer text,
  target_provider_subject_hmac text,
  target_subject_pepper_version integer,
  target_operation_key text,
  target_lecture_session_id uuid default null
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
  policy_row private.admin_google_operation_policies%rowtype;
  context_value jsonb;
  gate_row private.admin_identity_runtime_gate%rowtype;
  principal_binding private.admin_principals%rowtype;
  ownership_row private.admin_lecture_ownerships%rowtype;
  lecture_row public.lecture_sessions%rowtype;
  actor_role text;
  actor_can_use_ai boolean;
  effective_now timestamptz := statement_timestamp();
begin
  if target_operation_key is null
     or target_operation_key !~ '^[a-z0-9-]+\.[A-Za-z][A-Za-z0-9_]*$'
     or target_google_issuer <> 'https://accounts.google.com'
     or target_provider_subject_hmac is null
     or target_provider_subject_hmac !~ '^[0-9a-f]{64}$'
     or target_subject_pepper_version is null
     or target_subject_pepper_version < 1 then
    return null;
  end if;

  select policy.*
  into policy_row
  from private.admin_google_operation_policies as policy
  where policy.operation_key = target_operation_key;

  if not found then
    return null;
  end if;

  if (
    policy_row.access_scope in ('owned_lecture', 'owner_lecture')
    and target_lecture_session_id is null
  ) or (
    policy_row.access_scope not in ('owned_lecture', 'owner_lecture')
    and target_lecture_session_id is not null
  ) then
    return null;
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

  select principal.*
  into principal_binding
  from private.admin_principals as principal
  where principal.id = (context_value ->> 'principal_id')::uuid
    and principal.auth_user_id = target_auth_user_id
  for update;

  if not found
     or principal_binding.provider <> 'google'
     or principal_binding.google_issuer is distinct from target_google_issuer
     or principal_binding.provider_subject_hmac is distinct from
       target_provider_subject_hmac
     or principal_binding.subject_pepper_version is distinct from
       target_subject_pepper_version then
    return null;
  end if;

  actor_role := context_value ->> 'role';
  actor_can_use_ai := coalesce(
    (context_value ->> 'can_use_ai')::boolean,
    false
  );

  if actor_role not in ('owner', 'instructor')
     or (
       policy_row.access_scope = 'environment_owner'
       and actor_role <> 'owner'
     )
     or (
       policy_row.access_scope = 'owner_lecture'
       and actor_role <> 'owner'
     )
     or (
       actor_role = 'owner'
       and policy_row.owner_requires_ai
       and not actor_can_use_ai
     )
     or (
       actor_role = 'instructor'
       and policy_row.instructor_requires_ai
       and not actor_can_use_ai
     ) then
    return null;
  end if;

  -- Linearize state-expanding work against gate deactivation only after the
  -- canonical identity locks. Gate-independent reads and free terminal
  -- controls still take the same short shared lock but do not require ON.
  select gate.*
  into gate_row
  from private.admin_identity_runtime_gate as gate
  where gate.singleton
  for share;

  if not found then
    return null;
  end if;
  if policy_row.access_scope in ('owned_lecture', 'owner_lecture') then
    select ownership.*
    into ownership_row
    from private.admin_lecture_ownerships as ownership
    where ownership.lecture_session_id = target_lecture_session_id;

    if not found
       or ownership_row.environment_id <>
         (context_value ->> 'environment_id')::uuid
       or (
         policy_row.access_scope = 'owned_lecture'
         and (
           ownership_row.principal_id <>
             (context_value ->> 'principal_id')::uuid
           or ownership_row.membership_id <>
             (context_value ->> 'membership_id')::uuid
         )
       ) then
      return null;
    end if;

    if policy_row.lecture_lock_mode = 'share' then
      select lecture.*
      into lecture_row
      from public.lecture_sessions as lecture
      where lecture.id = target_lecture_session_id
      for share;
    else
      select lecture.*
      into lecture_row
      from public.lecture_sessions as lecture
      where lecture.id = target_lecture_session_id
      for update;
    end if;

    if lecture_row.id is null then
      return null;
    end if;
  end if;

  return context_value || jsonb_build_object(
    'gate_mode', policy_row.gate_mode,
    'google_operational_authorization_enabled',
      gate_row.google_operational_authorization_enabled,
    'lecture_archive_expires_at', lecture_row.archive_expires_at,
    'lecture_hard_stop_at', lecture_row.hard_stop_at,
    'lecture_session_id', target_lecture_session_id,
    'lecture_lock_mode', policy_row.lecture_lock_mode,
    'lecture_state_requirement', policy_row.lecture_state,
    'lecture_status', lecture_row.status,
    'operation_class', policy_row.operation_class,
    'operation_key', policy_row.operation_key,
    'request_binding_required', policy_row.request_binding_required
  );
end;
$$;

revoke all on function private.require_google_admin_operation_context_v1(
  text, uuid, uuid, text, text, integer, text, uuid
) from public, anon, authenticated, service_role;

-- Domain facades call this only after any immutable exact-replay lookup. That
-- keeps lost successful responses convergent while preventing new or expanded
-- state from committing after the singleton C2 gate is disabled.
create function private.assert_google_admin_operation_gate_v1(
  target_context jsonb,
  target_transport_enabled boolean
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if target_context is null
     or target_context ->> 'operation_key' is null then
    raise exception 'Google Admin operation context is invalid'
      using errcode = '42501';
  end if;

  if target_context ->> 'gate_mode' = 'required'
     and (
       coalesce(
         (target_context ->> 'google_operational_authorization_enabled')::boolean,
         false
       ) is not true
       or coalesce(target_transport_enabled, false) is not true
     ) then
    raise exception 'Google Admin operational authorization is disabled'
      using errcode = 'P7337';
  end if;
end;
$$;

revoke all on function
  private.assert_google_admin_operation_gate_v1(jsonb, boolean)
  from public, anon, authenticated, service_role;

create function private.assert_google_admin_operation_lecture_state_v1(
  target_context jsonb
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  state_requirement text := target_context ->> 'lecture_state_requirement';
  lecture_status text := target_context ->> 'lecture_status';
  archive_expires_at timestamptz :=
    (target_context ->> 'lecture_archive_expires_at')::timestamptz;
  hard_stop_at timestamptz :=
    (target_context ->> 'lecture_hard_stop_at')::timestamptz;
  effective_now timestamptz := statement_timestamp();
begin
  if target_context is null
     or state_requirement is null then
    raise exception 'Google Admin operation context is invalid'
      using errcode = '42501';
  end if;

  if state_requirement = 'none' then
    return;
  end if;

  if (state_requirement = 'draft' and lecture_status <> 'draft')
     or (
       state_requirement = 'closed'
       and (
         lecture_status <> 'closed'
         or archive_expires_at is null
         or archive_expires_at <= effective_now
       )
     )
     or (
       state_requirement = 'draft_or_open'
       and (
         lecture_status not in ('draft', 'open')
         or (
           lecture_status = 'open'
           and (
             hard_stop_at is null
             or hard_stop_at <= effective_now
           )
         )
       )
     )
     or (
       state_requirement = 'draft_or_open_any'
       and lecture_status not in ('draft', 'open')
     )
     or (
       state_requirement = 'open'
       and (
         lecture_status <> 'open'
         or hard_stop_at is null
         or hard_stop_at <= effective_now
       )
     )
     or (
       state_requirement = 'open_any'
       and lecture_status <> 'open'
     )
     or (
       state_requirement = 'retained'
       and (
         lecture_status not in ('draft', 'open', 'closed')
         or (
           lecture_status = 'closed'
           and (
             archive_expires_at is null
             or archive_expires_at <= effective_now
           )
         )
       )
     ) then
    raise exception 'lecture lifecycle does not permit this operation'
      using errcode = 'P7335';
  end if;
end;
$$;

revoke all on function
  private.assert_google_admin_operation_lecture_state_v1(jsonb)
  from public, anon, authenticated, service_role;

create table private.admin_google_lecture_operation_receipts (
  request_id uuid primary key,
  operation_key text not null
    references private.admin_google_operation_policies(operation_key)
      on delete restrict,
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
  target_lecture_session_id uuid
    references public.lecture_sessions(id) on delete restrict,
  result_lecture_session_id uuid not null
    references public.lecture_sessions(id) on delete restrict,
  result_status text not null check (
    result_status in ('draft', 'open', 'closed')
  ),
  created_at timestamptz not null default statement_timestamp()
);

comment on table private.admin_google_lecture_operation_receipts is
  'Immutable C2 exact-replay evidence for Google lecture lifecycle mutations. It stores hashes and identifiers, never the raw lecture code or bearer/app token.';

create index admin_google_lecture_receipts_environment_idx
  on private.admin_google_lecture_operation_receipts (
    environment_id,
    created_at desc,
    request_id
  );
create index admin_google_lecture_receipts_operation_idx
  on private.admin_google_lecture_operation_receipts (
    operation_key,
    created_at desc,
    request_id
  );
create index admin_google_lecture_receipts_principal_idx
  on private.admin_google_lecture_operation_receipts (
    principal_id,
    created_at desc,
    request_id
  );
create index admin_google_lecture_receipts_membership_idx
  on private.admin_google_lecture_operation_receipts (
    membership_id,
    created_at desc,
    request_id
  );
create index admin_google_lecture_receipts_session_idx
  on private.admin_google_lecture_operation_receipts (
    admin_session_id,
    created_at desc,
    request_id
  );
create index admin_google_lecture_receipts_target_idx
  on private.admin_google_lecture_operation_receipts (
    target_lecture_session_id,
    created_at desc,
    request_id
  );
create index admin_google_lecture_receipts_result_idx
  on private.admin_google_lecture_operation_receipts (
    result_lecture_session_id,
    created_at desc,
    request_id
  );

alter table private.admin_google_lecture_operation_receipts
  enable row level security;
revoke all on private.admin_google_lecture_operation_receipts
  from public, anon, authenticated, service_role;

create trigger admin_google_lecture_operation_receipts_append_only
before update or delete on private.admin_google_lecture_operation_receipts
for each row execute function private.reject_admin_c1_evidence_mutation_v1();

create table private.admin_google_operation_receipts (
  request_id uuid primary key,
  operation_key text not null
    references private.admin_google_operation_policies(operation_key)
      on delete restrict,
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
  lecture_session_id uuid
    references public.lecture_sessions(id) on delete restrict,
  target_id text check (
    target_id is null or char_length(target_id) between 1 and 200
  ),
  result_id text check (
    result_id is null or char_length(result_id) between 1 and 200
  ),
  result_status text check (
    result_status is null
    or result_status ~ '^[A-Za-z][A-Za-z0-9_]{0,79}$'
  ),
  result_metadata jsonb not null default '{}'::jsonb check (
    jsonb_typeof(result_metadata) = 'object'
    and pg_column_size(result_metadata) <= 4096
    and result_metadata::text !~* '"[^"]*(bearer|token|secret|pin|totp|credential|authorization|body|content|url|code)[^"]*"[[:space:]]*:'
  ),
  created_at timestamptz not null default statement_timestamp()
);

comment on table private.admin_google_operation_receipts is
  'Immutable C2 request receipts for non-lecture-lifecycle operational facades. Values are bounded identifiers, digests and non-secret result metadata; raw credentials and content are forbidden.';

create index admin_google_operation_receipts_operation_idx
  on private.admin_google_operation_receipts (
    operation_key,
    created_at desc,
    request_id
  );
create index admin_google_operation_receipts_environment_idx
  on private.admin_google_operation_receipts (
    environment_id,
    created_at desc,
    request_id
  );
create index admin_google_operation_receipts_principal_idx
  on private.admin_google_operation_receipts (
    principal_id,
    created_at desc,
    request_id
  );
create index admin_google_operation_receipts_membership_idx
  on private.admin_google_operation_receipts (
    membership_id,
    created_at desc,
    request_id
  );
create index admin_google_operation_receipts_session_idx
  on private.admin_google_operation_receipts (
    admin_session_id,
    created_at desc,
    request_id
  );
create index admin_google_operation_receipts_lecture_idx
  on private.admin_google_operation_receipts (
    lecture_session_id,
    created_at desc,
    request_id
  );

alter table private.admin_google_operation_receipts enable row level security;
revoke all on private.admin_google_operation_receipts
  from public, anon, authenticated, service_role;

create trigger admin_google_operation_receipts_append_only
before update or delete on private.admin_google_operation_receipts
for each row execute function private.reject_admin_c1_evidence_mutation_v1();

create function private.google_admin_operation_intent_digest_v1(
  target_request_id uuid,
  target_admin_session_id uuid,
  target_operation_key text,
  target_lecture_session_id uuid,
  target_target_id text,
  target_payload_digest text
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
      or target_operation_key is null
      or target_operation_key !~ '^[a-z0-9-]+\.[A-Za-z][A-Za-z0-9_]*$'
      or (
        target_payload_digest is not null
        and target_payload_digest !~ '^[0-9a-f]{64}$'
      ) then null
    else encode(
      extensions.digest(
        convert_to(
          'phase730c2:google-operation:v1'
          || '|request=' || target_request_id::text
          || '|session=' || target_admin_session_id::text
          || '|operation=' || target_operation_key
          || '|lecture=' || coalesce(target_lecture_session_id::text, '')
          || '|target=' || coalesce(target_target_id, '')
          || '|payload_digest=' || coalesce(target_payload_digest, ''),
          'UTF8'
        ),
        'sha256'
      ),
      'hex'
    )
  end;
$$;

revoke all on function private.google_admin_operation_intent_digest_v1(
  uuid, uuid, text, uuid, text, text
) from public, anon, authenticated, service_role;

create function private.google_admin_lecture_intent_digest_v1(
  target_request_id uuid,
  target_admin_session_id uuid,
  target_operation_key text,
  target_lecture_session_id uuid,
  target_title text,
  target_starts_at timestamptz,
  target_ends_at timestamptz,
  target_run_kind text
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
      or target_operation_key not in (
        'manage-lectures.create',
        'manage-lectures.createJournalClubRun',
        'manage-lectures.duplicate',
        'manage-lectures.start',
        'manage-lectures.close',
        'manage-lectures.emergencyStop'
      ) then null
    else encode(
      extensions.digest(
        convert_to(
          'phase730c2:lecture-operation:v1'
          || '|request=' || target_request_id::text
          || '|session=' || target_admin_session_id::text
          || '|operation=' || target_operation_key
          || '|lecture=' || coalesce(target_lecture_session_id::text, '')
          || '|title=' || coalesce(target_title, '')
          || '|starts_at_epoch_us=' || coalesce(
            round(extract(epoch from target_starts_at) * 1000000)::bigint::text,
            ''
          )
          || '|ends_at_epoch_us=' || coalesce(
            round(extract(epoch from target_ends_at) * 1000000)::bigint::text,
            ''
          )
          || '|run_kind=' || coalesce(target_run_kind, ''),
          'UTF8'
        ),
        'sha256'
      ),
      'hex'
    )
  end;
$$;

revoke all on function private.google_admin_lecture_intent_digest_v1(
  uuid, uuid, text, uuid, text, timestamptz, timestamptz, text
) from public, anon, authenticated, service_role;

create function private.list_google_admin_lectures_v1(
  target_context jsonb,
  target_include_history boolean
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with visible_lectures as (
    select lecture.*
    from private.admin_lecture_ownerships as ownership
    join public.lecture_sessions as lecture
      on lecture.id = ownership.lecture_session_id
    where ownership.environment_id =
        (target_context ->> 'environment_id')::uuid
      and (
        target_context ->> 'role' = 'owner'
        or (
          ownership.principal_id =
            (target_context ->> 'principal_id')::uuid
          and ownership.membership_id =
            (target_context ->> 'membership_id')::uuid
        )
      )
      and (
        lecture.status <> 'closed'
        or (
          lecture.archive_expires_at is not null
          and lecture.archive_expires_at > statement_timestamp()
        )
      )
    order by lecture.created_at desc, lecture.id desc
    limit case when coalesce(target_include_history, false) then 30 else 3 end
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'archiveExpiresAt', lecture.archive_expires_at,
        'closedAt', lecture.closed_at,
        'closeActorType', lecture.close_actor_type,
        'closeReason', lecture.close_reason,
        'createdAt', lecture.created_at,
        'endsAt', lecture.ends_at,
        'hardStopAt', lecture.hard_stop_at,
        'id', lecture.id,
        'journalClub', case
          when journal_run.lecture_session_id is null then null
          else jsonb_build_object(
            'expectedDocumentId', journal_run.expected_document_id,
            'expectedPdfByteSize', journal_run.expected_pdf_byte_size,
            'expectedPdfPageCount', journal_run.expected_pdf_page_count,
            'expectedPdfSha256', journal_run.expected_pdf_sha256,
            'presetVersion', journal_run.preset_version,
            'runKind', journal_run.run_kind
          )
        end,
        'lectureCode', coalesce(code.lecture_code, ''),
        'startsAt', lecture.starts_at,
        'status', lecture.status,
        'title', lecture.title,
        'updatedAt', lecture.updated_at
      ) order by lecture.created_at desc, lecture.id desc
    ),
    '[]'::jsonb
  )
  from visible_lectures as lecture
  left join public.lecture_admin_codes as code
    on code.lecture_session_id = lecture.id
  left join public.phase727_journal_club_runs as journal_run
    on journal_run.lecture_session_id = lecture.id;
$$;

revoke all on function private.list_google_admin_lectures_v1(jsonb, boolean)
  from public, anon, authenticated, service_role;

create function private.manage_google_admin_lectures_v1(
  target_token_hash text,
  target_auth_user_id uuid,
  target_supabase_auth_session_id uuid,
  target_google_issuer text,
  target_provider_subject_hmac text,
  target_subject_pepper_version integer,
  target_transport_enabled boolean,
  target_action text,
  target_request_id uuid default null,
  target_lecture_session_id uuid default null,
  target_title text default null,
  target_code_hash text default null,
  target_code text default null,
  target_starts_at timestamptz default null,
  target_ends_at timestamptz default null,
  target_run_kind text default null,
  target_include_history boolean default false
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
  operation_key_value text := 'manage-lectures.' || coalesce(target_action, '');
  context_value jsonb;
  receipt_row private.admin_google_lecture_operation_receipts%rowtype;
  ownership_row private.admin_lecture_ownerships%rowtype;
  transition_result jsonb;
  journal_result jsonb;
  result_lecture_session_id uuid;
  result_status text;
  normalized_title text := nullif(trim(target_title), '');
  intent_digest_value text;
  actor_value text;
begin
  if target_action = 'list' then
    if target_request_id is not null
       or target_lecture_session_id is not null
       or target_title is not null
       or target_code_hash is not null
       or target_code is not null
       or target_starts_at is not null
       or target_ends_at is not null
       or target_run_kind is not null then
      return null;
    end if;

    context_value := private.require_google_admin_operation_context_v1(
      target_token_hash,
      target_auth_user_id,
      target_supabase_auth_session_id,
      target_google_issuer,
      target_provider_subject_hmac,
      target_subject_pepper_version,
      operation_key_value,
      null
    );
    if context_value is null then
      return null;
    end if;

    return jsonb_build_object(
      'lectures', private.list_google_admin_lectures_v1(
        context_value,
        target_include_history
      ),
      'ok', true
    );
  end if;

  if target_action not in (
    'create',
    'createJournalClubRun',
    'duplicate',
    'start',
    'close',
    'emergencyStop'
  ) or target_request_id is null or coalesce(target_include_history, false) then
    return null;
  end if;

  if (
    target_action = 'create'
    and (
      target_lecture_session_id is not null
      or normalized_title is null
      or target_code_hash is null
      or target_code is null
      or target_run_kind is not null
    )
  ) or (
    target_action = 'createJournalClubRun'
    and (
      target_lecture_session_id is not null
      or target_title is not null
      or target_starts_at is not null
      or target_ends_at is not null
      or target_code_hash is null
      or target_code is null
      or target_run_kind not in ('production', 'rehearsal')
    )
  ) or (
    target_action = 'duplicate'
    and (
      target_lecture_session_id is null
      or target_title is not null
      or target_starts_at is not null
      or target_ends_at is not null
      or target_code_hash is null
      or target_code is null
      or target_run_kind is not null
    )
  ) or (
    target_action in ('start', 'close', 'emergencyStop')
    and (
      target_lecture_session_id is null
      or target_title is not null
      or target_code_hash is not null
      or target_code is not null
      or target_starts_at is not null
      or target_ends_at is not null
      or target_run_kind is not null
    )
  ) then
    return null;
  end if;

  perform private.serialize_admin_ai_request_v1(target_request_id);

  context_value := private.require_google_admin_operation_context_v1(
    target_token_hash,
    target_auth_user_id,
    target_supabase_auth_session_id,
    target_google_issuer,
    target_provider_subject_hmac,
    target_subject_pepper_version,
    operation_key_value,
    case
      when target_action in ('create', 'createJournalClubRun') then null
      else target_lecture_session_id
    end
  );
  if context_value is null then
    return null;
  end if;

  intent_digest_value := private.google_admin_lecture_intent_digest_v1(
    target_request_id,
    (context_value ->> 'admin_session_id')::uuid,
    operation_key_value,
    target_lecture_session_id,
    normalized_title,
    target_starts_at,
    target_ends_at,
    target_run_kind
  );
  if intent_digest_value is null then
    return null;
  end if;

  select receipt.*
  into receipt_row
  from private.admin_google_lecture_operation_receipts as receipt
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
       and receipt_row.target_lecture_session_id is not distinct from
         target_lecture_session_id then
      return jsonb_build_object(
        'idempotentReplay', true,
        'lectureSessionId', receipt_row.result_lecture_session_id,
        'ok', true,
        'status', receipt_row.result_status
      );
    end if;
    raise exception 'lecture request binding does not match its receipt'
      using errcode = 'P7335';
  end if;

  perform private.assert_google_admin_operation_gate_v1(
    context_value,
    target_transport_enabled
  );
  perform private.assert_google_admin_operation_lecture_state_v1(context_value);
  actor_value := 'admin-session:' || (context_value ->> 'admin_session_id');

  if target_action = 'create' then
    result_lecture_session_id := public.admin_create_lecture_v2(
      normalized_title,
      target_code_hash,
      target_code,
      target_starts_at,
      target_ends_at
    );
  elsif target_action = 'createJournalClubRun' then
    journal_result := public.admin_create_phase727_journal_club_run_v1(
      target_run_kind,
      target_code_hash,
      target_code,
      target_request_id,
      (context_value ->> 'admin_session_id')::uuid,
      target_auth_user_id
    );
    if coalesce((journal_result ->> 'idempotent_replay')::boolean, false) then
      raise exception 'pre-C2 Journal Club run cannot be adopted implicitly'
        using errcode = 'P7335';
    end if;
    result_lecture_session_id :=
      (journal_result ->> 'lecture_session_id')::uuid;
  elsif target_action = 'duplicate' then
    result_lecture_session_id := public.admin_duplicate_lecture_v1(
      target_lecture_session_id,
      target_code_hash,
      target_code
    );
  elsif target_action = 'start' then
    transition_result := private.start_lecture_core(
      target_lecture_session_id,
      actor_value
    );
    if coalesce((transition_result ->> 'changed')::boolean, false) is not true
       or transition_result ->> 'status' <> 'open' then
      raise exception 'lecture start did not transition to open'
        using errcode = 'P7335';
    end if;
    result_lecture_session_id := target_lecture_session_id;
  else
    transition_result := private.close_lecture_core(
      target_lecture_session_id,
      case
        when target_action = 'emergencyStop' then 'manual'
        else 'manual'
      end,
      'admin',
      actor_value
    );
    if coalesce((transition_result ->> 'changed')::boolean, false) is not true
       or transition_result ->> 'status' <> 'closed' then
      raise exception 'lecture close did not transition to closed'
        using errcode = 'P7335';
    end if;
    result_lecture_session_id := target_lecture_session_id;
  end if;

  if result_lecture_session_id is null then
    raise exception 'lecture operation did not return a lecture'
      using errcode = 'P7335';
  end if;

  if target_action in ('create', 'createJournalClubRun', 'duplicate') then
    insert into private.admin_lecture_ownerships (
      lecture_session_id,
      environment_id,
      principal_id,
      membership_id,
      assigned_by_admin_session_id,
      ownership_request_id,
      ownership_intent_digest
    ) values (
      result_lecture_session_id,
      (context_value ->> 'environment_id')::uuid,
      (context_value ->> 'principal_id')::uuid,
      (context_value ->> 'membership_id')::uuid,
      (context_value ->> 'admin_session_id')::uuid,
      target_request_id,
      intent_digest_value
    ) returning * into ownership_row;
  end if;

  select lecture.status
  into result_status
  from public.lecture_sessions as lecture
  where lecture.id = result_lecture_session_id;
  if result_status not in ('draft', 'open', 'closed') then
    raise exception 'lecture operation produced an invalid status'
      using errcode = 'P7335';
  end if;

  insert into private.admin_google_lecture_operation_receipts (
    request_id,
    operation_key,
    intent_digest,
    environment_id,
    principal_id,
    membership_id,
    admin_session_id,
    supabase_auth_session_id,
    target_lecture_session_id,
    result_lecture_session_id,
    result_status
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
    result_lecture_session_id,
    result_status
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
    'admin_lecture.' || target_action,
    'lecture_session',
    result_lecture_session_id::text,
    'accepted',
    case
      when target_action = 'emergencyStop' then 'owner_emergency_stop'
      else 'google_admin_operation'
    end,
    jsonb_build_object(
      'operation_key', operation_key_value,
      'source_lecture_session_id', target_lecture_session_id
    )
  );

  return jsonb_build_object(
    'idempotentReplay', false,
    'lectureSessionId', result_lecture_session_id,
    'ok', true,
    'status', result_status
  );
end;
$$;

revoke all on function private.manage_google_admin_lectures_v1(
  text, uuid, uuid, text, text, integer, boolean, text, uuid, uuid, text, text, text,
  timestamptz, timestamptz, text, boolean
) from public, anon, authenticated, service_role;

create function public.manage_google_admin_lectures_v1(
  target_token_hash text,
  target_auth_user_id uuid,
  target_supabase_auth_session_id uuid,
  target_google_issuer text,
  target_provider_subject_hmac text,
  target_subject_pepper_version integer,
  target_transport_enabled boolean,
  target_action text,
  target_request_id uuid default null,
  target_lecture_session_id uuid default null,
  target_title text default null,
  target_code_hash text default null,
  target_code text default null,
  target_starts_at timestamptz default null,
  target_ends_at timestamptz default null,
  target_run_kind text default null,
  target_include_history boolean default false
)
returns jsonb
language sql
volatile
security definer
set search_path = ''
as $$
  select private.manage_google_admin_lectures_v1(
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
    target_title,
    target_code_hash,
    target_code,
    target_starts_at,
    target_ends_at,
    target_run_kind,
    target_include_history
  );
$$;

revoke all on function public.manage_google_admin_lectures_v1(
  text, uuid, uuid, text, text, integer, boolean, text, uuid, uuid, text, text, text,
  timestamptz, timestamptz, text, boolean
) from public, anon, authenticated;
grant execute on function public.manage_google_admin_lectures_v1(
  text, uuid, uuid, text, text, integer, boolean, text, uuid, uuid, text, text, text,
  timestamptz, timestamptz, text, boolean
) to service_role;

-- Read-only operator preflight. C2 never invents ownership for legacy lectures;
-- Google-only activation must instead converge every active lecture and legacy
-- session to an explicit safe terminal state before the old issuer is fenced.
create function public.get_google_admin_operations_activation_preflight_v1()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with readiness as (
    select
      count(*) filter (
        where ownership.lecture_session_id is null
          and lecture.status in ('draft', 'open')
      )::integer as unowned_active_lecture_count,
      count(*) filter (
        where ownership.lecture_session_id is null
          and lecture.status = 'closed'
          and lecture.archive_expires_at > statement_timestamp()
      )::integer as unowned_retained_lecture_count
    from public.lecture_sessions as lecture
    left join private.admin_lecture_ownerships as ownership
      on ownership.lecture_session_id = lecture.id
  ), active_legacy_sessions as (
    select count(*)::integer as session_count
    from public.admin_sessions as session
    where session.authentication_method = 'legacy_pin'
      and session.revoked_at is null
      and session.expires_at > statement_timestamp()
      and session.idle_expires_at > statement_timestamp()
  )
  select jsonb_build_object(
    'authoritative', false,
    'preflightReady',
      readiness.unowned_active_lecture_count = 0
      and active_legacy_sessions.session_count = 0
      and gate.legacy_pin_login_enabled is false,
    'googleOperationalAuthorizationEnabled',
      gate.google_operational_authorization_enabled,
    'legacyPinLoginEnabled', gate.legacy_pin_login_enabled,
    'unownedActiveLectureCount', readiness.unowned_active_lecture_count,
    'unownedRetainedLectureCount', readiness.unowned_retained_lecture_count,
    'activeLegacySessionCount', active_legacy_sessions.session_count
  )
  from readiness
  cross join active_legacy_sessions
  cross join private.admin_identity_runtime_gate as gate
  where gate.singleton;
$$;

revoke all on function
  public.get_google_admin_operations_activation_preflight_v1()
  from public, anon, authenticated;
grant execute on function
  public.get_google_admin_operations_activation_preflight_v1()
  to service_role;

comment on function
  public.get_google_admin_operations_activation_preflight_v1()
is
  'Advisory read-only preflight. E cutover must tombstone legacy mutation paths and repeat these checks with serialization in the same transaction; this snapshot alone never authorizes activation.';

create function private.manage_google_admin_comments_v1(
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
  target_comment_id uuid
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
  operation_key_value text := 'manage-comments.' || coalesce(target_action, '');
  context_value jsonb;
  receipt_row private.admin_google_operation_receipts%rowtype;
  comment_value jsonb;
  intent_digest_value text;
  actor_value text;
begin
  if target_action not in ('togglePin', 'toggleVisibility')
     or target_request_id is null
     or target_lecture_session_id is null
     or target_comment_id is null then
    return null;
  end if;

  perform private.serialize_admin_ai_request_v1(target_request_id);

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

  intent_digest_value := private.google_admin_operation_intent_digest_v1(
    target_request_id,
    (context_value ->> 'admin_session_id')::uuid,
    operation_key_value,
    target_lecture_session_id,
    target_comment_id::text,
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
       and receipt_row.target_id = target_comment_id::text
       and receipt_row.result_id = target_comment_id::text then
      return jsonb_build_object(
        'comment', null,
        'commentId', target_comment_id,
        'idempotentReplay', true,
        'ok', true,
        'refreshRequired', true,
        'status', receipt_row.result_status
      );
    end if;
    raise exception 'comment request binding does not match its receipt'
      using errcode = 'P7335';
  end if;

  perform private.assert_google_admin_operation_gate_v1(
    context_value,
    target_transport_enabled
  );
  perform private.assert_google_admin_operation_lecture_state_v1(context_value);
  actor_value := 'google-admin-session:' ||
    (context_value ->> 'admin_session_id');

  comment_value := private.admin_moderate_lecture_comment(
    target_lecture_session_id,
    target_comment_id,
    case
      when target_action = 'togglePin' then 'toggle_pin'
      else 'toggle_visibility'
    end,
    actor_value
  );
  if comment_value is null
     or comment_value ->> 'id' <> target_comment_id::text
     or comment_value ->> 'status' not in ('visible', 'hidden') then
    raise exception 'comment moderation produced an invalid result'
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
    target_comment_id::text,
    target_comment_id::text,
    comment_value ->> 'status',
    jsonb_build_object(
      'marked', coalesce((comment_value ->> 'is_pinned')::boolean, false)
    )
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
    'admin_comment.' || target_action,
    'comment',
    target_comment_id::text,
    'accepted',
    'google_admin_operation',
    jsonb_build_object(
      'is_pinned', coalesce((comment_value ->> 'is_pinned')::boolean, false),
      'operation_key', operation_key_value,
      'status', comment_value ->> 'status'
    )
  );

  return jsonb_build_object(
    'comment', comment_value,
    'idempotentReplay', false,
    'ok', true,
    'refreshRequired', false
  );
end;
$$;

revoke all on function private.manage_google_admin_comments_v1(
  text, uuid, uuid, text, text, integer, boolean, text, uuid, uuid, uuid
) from public, anon, authenticated, service_role;

create function public.manage_google_admin_comments_v1(
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
  target_comment_id uuid
)
returns jsonb
language sql
volatile
security definer
set search_path = ''
as $$
  select private.manage_google_admin_comments_v1(
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
    target_comment_id
  );
$$;

revoke all on function public.manage_google_admin_comments_v1(
  text, uuid, uuid, text, text, integer, boolean, text, uuid, uuid, uuid
) from public, anon, authenticated;
grant execute on function public.manage_google_admin_comments_v1(
  text, uuid, uuid, text, text, integer, boolean, text, uuid, uuid, uuid
) to service_role;

create function private.list_google_admin_polls_v1(
  target_lecture_session_id uuid,
  target_include_history boolean
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with settings as (
    select case
      when coalesce(target_include_history, false) then 100
      else 5
    end as recent_limit
  ), recent_non_open as (
    select
      poll.id,
      row_number() over (
        order by poll.created_at desc, poll.id desc
      ) as recent_rank
    from public.polls as poll
    where poll.lecture_session_id = target_lecture_session_id
      and poll.status <> 'open'
  ), selected_ids as (
    select poll.id, 0 as state_order
    from public.polls as poll
    where poll.lecture_session_id = target_lecture_session_id
      and poll.status = 'open'
    union all
    select recent.id, 1 as state_order
    from recent_non_open as recent
    cross join settings
    where recent.recent_rank <= settings.recent_limit
  ), decorated as (
    select
      poll.created_at,
      poll.id,
      selected.state_order,
      slot.display_order as template_order,
      jsonb_build_object(
        'createdAt', poll.created_at,
        'id', poll.id,
        'lectureSessionId', poll.lecture_session_id,
        'options', coalesce((
          select jsonb_agg(
            jsonb_build_object(
              'id', option.id,
              'label', option.label,
              'order', option.display_order,
              'responseCount', coalesce(total.response_count, 0)
            ) order by option.display_order, option.id
          )
          from public.poll_options as option
          left join public.poll_option_totals as total
            on total.lecture_session_id = option.lecture_session_id
           and total.poll_id = option.poll_id
           and total.option_id = option.id
          where option.lecture_session_id = poll.lecture_session_id
            and option.poll_id = poll.id
        ), '[]'::jsonb),
        'question', poll.question,
        'status', poll.status,
        'templateOrder', slot.display_order,
        'type', poll.type,
        'updatedAt', poll.updated_at
      ) as value
    from selected_ids as selected
    join public.polls as poll on poll.id = selected.id
    left join public.phase727_journal_club_poll_slots as slot
      on slot.lecture_session_id = poll.lecture_session_id
     and slot.poll_id = poll.id
  )
  select jsonb_build_object(
    'hasMore', exists (
      select 1
      from recent_non_open as recent
      cross join settings
      where recent.recent_rank > settings.recent_limit
    ),
    'polls', coalesce((
      select jsonb_agg(
        decorated.value order by
          decorated.template_order asc nulls last,
          decorated.state_order,
          decorated.created_at desc,
          decorated.id desc
      )
      from decorated
    ), '[]'::jsonb)
  );
$$;

revoke all on function private.list_google_admin_polls_v1(uuid, boolean)
  from public, anon, authenticated, service_role;

create function private.manage_google_admin_polls_v1(
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
  target_poll_id uuid,
  target_question text,
  target_poll_type text,
  target_option_labels text[],
  target_include_history boolean
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
  operation_key_value text := 'manage-polls.' || coalesce(target_action, '');
  context_value jsonb;
  receipt_row private.admin_google_operation_receipts%rowtype;
  normalized_question text := nullif(trim(target_question), '');
  normalized_option_labels text[];
  payload_digest_value text;
  intent_digest_value text;
  result_poll_id uuid;
  result_status text;
  changed_value boolean := false;
  list_value jsonb;
begin
  if target_lecture_session_id is null
     or target_action not in ('list', 'create', 'open', 'close') then
    return null;
  end if;

  if target_option_labels is not null then
    select array_agg(trim(option_label) order by option_order)
    into normalized_option_labels
    from unnest(target_option_labels) with ordinality
      as options(option_label, option_order);
  end if;

  if target_action = 'list' then
    if target_request_id is not null
       or target_poll_id is not null
       or target_question is not null
       or target_poll_type is not null
       or target_option_labels is not null then
      return null;
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
    return private.list_google_admin_polls_v1(
      target_lecture_session_id,
      target_include_history
    ) || jsonb_build_object('ok', true);
  end if;

  if target_request_id is null then
    return null;
  end if;
  if (
    target_action = 'create'
    and (
      target_poll_id is not null
      or normalized_question is null
      or char_length(normalized_question) > 300
      or target_poll_type is null
      or target_poll_type not in ('single', 'multiple')
      or normalized_option_labels is null
      or coalesce(cardinality(normalized_option_labels), 0) not between 2 and 8
      or exists (
        select 1
        from unnest(normalized_option_labels) as option_label
        where nullif(option_label, '') is null
          or char_length(option_label) > 200
      )
      or (
        select count(*)
        from (
          select distinct lower(option_label)
          from unnest(normalized_option_labels) as option_label
        ) as unique_options
      ) <> cardinality(normalized_option_labels)
    )
  ) or (
    target_action in ('open', 'close')
    and (
      target_poll_id is null
      or target_question is not null
      or target_poll_type is not null
      or target_option_labels is not null
    )
  ) then
    return null;
  end if;

  perform private.serialize_admin_ai_request_v1(target_request_id);

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

  if target_action = 'create' then
    payload_digest_value := encode(
      extensions.digest(
        convert_to(
          jsonb_build_object(
            'optionLabels', to_jsonb(normalized_option_labels),
            'question', normalized_question,
            'type', target_poll_type
          )::text,
          'UTF8'
        ),
        'sha256'
      ),
      'hex'
    );
  end if;

  intent_digest_value := private.google_admin_operation_intent_digest_v1(
    target_request_id,
    (context_value ->> 'admin_session_id')::uuid,
    operation_key_value,
    target_lecture_session_id,
    target_poll_id::text,
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
       and receipt_row.target_id is not distinct from target_poll_id::text then
      return jsonb_build_object(
        'hasMore', false,
        'idempotentReplay', true,
        'ok', true,
        'pollId', receipt_row.result_id,
        'polls', '[]'::jsonb,
        'refreshRequired', true,
        'status', receipt_row.result_status
      );
    end if;
    raise exception 'poll request binding does not match its receipt'
      using errcode = 'P7335';
  end if;

  perform private.assert_google_admin_operation_gate_v1(
    context_value,
    target_transport_enabled
  );
  perform private.assert_google_admin_operation_lecture_state_v1(context_value);

  if target_action = 'create' then
    result_poll_id := public.admin_create_poll(
      target_lecture_session_id,
      normalized_question,
      target_poll_type,
      normalized_option_labels
    );
    changed_value := true;
  else
    result_poll_id := target_poll_id;
    changed_value := public.admin_set_poll_status(
      target_lecture_session_id,
      target_poll_id,
      case when target_action = 'open' then 'open' else 'closed' end
    );
  end if;

  select poll.status
  into result_status
  from public.polls as poll
  where poll.id = result_poll_id
    and poll.lecture_session_id = target_lecture_session_id;
  if not found then
    raise exception 'poll operation did not return a bound poll'
      using errcode = 'P7335';
  end if;

  if target_action = 'open' and (
    changed_value is not true or result_status <> 'open'
  ) then
    raise exception 'poll open did not transition to open'
      using errcode = 'P7335';
  elsif target_action = 'close' and result_status <> 'closed' then
    raise exception 'poll close did not converge to closed'
      using errcode = 'P7335';
  elsif target_action = 'create' and result_status <> 'draft' then
    raise exception 'poll create did not produce a draft'
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
    target_poll_id::text,
    result_poll_id::text,
    result_status,
    jsonb_build_object('changed', changed_value)
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
    'admin_poll.' || target_action,
    'poll',
    result_poll_id::text,
    'accepted',
    'google_admin_operation',
    jsonb_build_object(
      'changed', changed_value,
      'operation_key', operation_key_value,
      'status', result_status
    )
  );

  list_value := private.list_google_admin_polls_v1(
    target_lecture_session_id,
    target_include_history
  );
  return list_value || jsonb_build_object(
    'idempotentReplay', false,
    'ok', true,
    'pollId', result_poll_id
  );
end;
$$;

revoke all on function private.manage_google_admin_polls_v1(
  text, uuid, uuid, text, text, integer, boolean, text, uuid, uuid, uuid,
  text, text, text[], boolean
) from public, anon, authenticated, service_role;

create function public.manage_google_admin_polls_v1(
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
  target_poll_id uuid,
  target_question text,
  target_poll_type text,
  target_option_labels text[],
  target_include_history boolean
)
returns jsonb
language sql
volatile
security definer
set search_path = ''
as $$
  select private.manage_google_admin_polls_v1(
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
    target_poll_id,
    target_question,
    target_poll_type,
    target_option_labels,
    target_include_history
  );
$$;

revoke all on function public.manage_google_admin_polls_v1(
  text, uuid, uuid, text, text, integer, boolean, text, uuid, uuid, uuid,
  text, text, text[], boolean
) from public, anon, authenticated;
grant execute on function public.manage_google_admin_polls_v1(
  text, uuid, uuid, text, text, integer, boolean, text, uuid, uuid, uuid,
  text, text, text[], boolean
) to service_role;

create function private.list_google_admin_pdf_documents_v1(
  target_lecture_session_id uuid
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'byteSize', document.byte_size,
        'displayName', document.display_name,
        'documentId', document.document_id,
        'documentVersion', document.document_version,
        'downloadEnabled', document.download_enabled,
        'manifestVersion', document.manifest_version,
        'pageCount', document.page_count,
        'pdfSha256', document.pdf_sha256,
        'publishedAt', document.published_at,
        'textCharCount', document.text_char_count,
        'textSha256', document.text_sha256,
        'visible', document.visible
      ) order by document.published_at desc, document.document_id
    ),
    '[]'::jsonb
  )
  from public.lecture_pdf_documents as document
  where document.lecture_session_id = target_lecture_session_id
    and document.visible;
$$;

revoke all on function private.list_google_admin_pdf_documents_v1(uuid)
  from public, anon, authenticated, service_role;

create function private.manage_google_admin_pdf_documents_v1(
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
  target_document_id text,
  target_document_version text,
  target_manifest_version bigint,
  target_display_name text,
  target_page_count integer,
  target_byte_size bigint,
  target_text_char_count integer,
  target_pdf_sha256 text,
  target_text_sha256 text,
  target_download_enabled boolean,
  target_manifest_etag text,
  target_expected_access_version bigint
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
  operation_key_value text :=
    'manage-pdf-documents.' || coalesce(target_action, '');
  context_value jsonb;
  receipt_row private.admin_google_operation_receipts%rowtype;
  registered_row public.lecture_pdf_documents%rowtype;
  payload_digest_value text;
  intent_digest_value text;
  access_version_value bigint;
  documents_value jsonb;
begin
  if target_lecture_session_id is null
     or target_action not in ('list', 'register') then
    return null;
  end if;

  if target_action = 'list' then
    if target_request_id is not null
       or target_document_id is not null
       or target_document_version is not null
       or target_manifest_version is not null
       or target_display_name is not null
       or target_page_count is not null
       or target_byte_size is not null
       or target_text_char_count is not null
       or target_pdf_sha256 is not null
       or target_text_sha256 is not null
       or target_download_enabled is not null
       or target_manifest_etag is not null
       or target_expected_access_version is not null then
      return null;
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
    return jsonb_build_object(
      'documents', private.list_google_admin_pdf_documents_v1(
        target_lecture_session_id
      ),
      'ok', true
    );
  end if;

  if target_request_id is null
     or target_document_id is null
     or target_document_version is null
     or target_manifest_version is null
     or target_display_name is null
     or target_page_count is null
     or target_byte_size is null
     or target_text_char_count is null
     or target_pdf_sha256 is null
     or target_text_sha256 is null
     or target_download_enabled is null
     or ((target_manifest_etag is null) <>
       (target_expected_access_version is null))
     or (
       target_manifest_etag is not null
       and (
         char_length(target_manifest_etag) not between 1 and 512
         or target_manifest_etag ~ '[[:cntrl:]]'
         or target_expected_access_version < 1
       )
     ) then
    return null;
  end if;

  perform private.serialize_admin_ai_request_v1(target_request_id);

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

  payload_digest_value := encode(
    extensions.digest(
      convert_to(
        jsonb_build_object(
          'byteSize', target_byte_size,
          'displayName', trim(target_display_name),
          'documentId', target_document_id,
          'documentVersion', target_document_version,
          'downloadEnabled', target_download_enabled,
          'expectedAccessVersion', target_expected_access_version,
          'manifestEtag', target_manifest_etag,
          'manifestVersion', target_manifest_version,
          'pageCount', target_page_count,
          'pdfSha256', target_pdf_sha256,
          'textCharCount', target_text_char_count,
          'textSha256', target_text_sha256
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
    target_document_id,
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
       and receipt_row.target_id = target_document_id
       and receipt_row.result_id = target_document_id then
      return jsonb_build_object(
        'documents', '[]'::jsonb,
        'documentId', target_document_id,
        'idempotentReplay', true,
        'ok', true,
        'refreshRequired', true,
        'status', receipt_row.result_status
      );
    end if;
    raise exception 'PDF document request binding does not match its receipt'
      using errcode = 'P7335';
  end if;

  perform private.assert_google_admin_operation_gate_v1(
    context_value,
    target_transport_enabled
  );
  perform private.assert_google_admin_operation_lecture_state_v1(context_value);

  if target_manifest_etag is not null then
    select lecture.pdf_access_version
    into access_version_value
    from public.lecture_sessions as lecture
    where lecture.id = target_lecture_session_id
    for update;
    if not found
       or access_version_value <> target_expected_access_version then
      raise exception 'Local Publisher access-version receipt is stale'
        using errcode = '40001';
    end if;
  end if;

  select registration.*
  into registered_row
  from public.admin_register_pdf_document(
    target_lecture_session_id,
    target_document_id,
    target_document_version,
    target_manifest_version,
    target_display_name,
    target_page_count,
    target_byte_size,
    target_text_char_count,
    target_pdf_sha256,
    target_text_sha256,
    target_download_enabled
  ) as registration;

  if registered_row.lecture_session_id is null then
    raise exception 'PDF registration did not return a document'
      using errcode = 'P7335';
  end if;
  if target_manifest_etag is not null then
    update public.lecture_pdf_documents as document
    set
      local_manifest_etag = target_manifest_etag,
      updated_at = statement_timestamp()
    where document.lecture_session_id = registered_row.lecture_session_id
      and document.document_id = registered_row.document_id
      and document.document_version = registered_row.document_version
    returning document.* into registered_row;
    if not found then
      raise exception 'Local Publisher registration was not persisted'
        using errcode = 'P7335';
    end if;
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
    target_document_id,
    registered_row.document_id,
    'registered',
    jsonb_build_object(
      'accessVersion', access_version_value,
      'manifestVersion', registered_row.manifest_version
    )
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
    'admin_pdf_document.register',
    'pdf_document',
    registered_row.document_id,
    'accepted',
    'google_admin_operation',
    jsonb_build_object(
      'local_manifest_receipt', target_manifest_etag is not null,
      'manifest_version', registered_row.manifest_version,
      'operation_key', operation_key_value
    )
  );

  documents_value := private.list_google_admin_pdf_documents_v1(
    target_lecture_session_id
  );
  return jsonb_build_object(
    'documents', documents_value,
    'documentId', registered_row.document_id,
    'idempotentReplay', false,
    'ok', true,
    'refreshRequired', false,
    'status', 'registered'
  );
end;
$$;

revoke all on function private.manage_google_admin_pdf_documents_v1(
  text, uuid, uuid, text, text, integer, boolean, text, uuid, uuid,
  text, text, bigint, text, integer, bigint, integer, text, text, boolean,
  text, bigint
) from public, anon, authenticated, service_role;

create function public.manage_google_admin_pdf_documents_v1(
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
  target_document_id text,
  target_document_version text,
  target_manifest_version bigint,
  target_display_name text,
  target_page_count integer,
  target_byte_size bigint,
  target_text_char_count integer,
  target_pdf_sha256 text,
  target_text_sha256 text,
  target_download_enabled boolean,
  target_manifest_etag text,
  target_expected_access_version bigint
)
returns jsonb
language sql
volatile
security definer
set search_path = ''
as $$
  select private.manage_google_admin_pdf_documents_v1(
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
    target_document_id,
    target_document_version,
    target_manifest_version,
    target_display_name,
    target_page_count,
    target_byte_size,
    target_text_char_count,
    target_pdf_sha256,
    target_text_sha256,
    target_download_enabled,
    target_manifest_etag,
    target_expected_access_version
  );
$$;

revoke all on function public.manage_google_admin_pdf_documents_v1(
  text, uuid, uuid, text, text, integer, boolean, text, uuid, uuid,
  text, text, bigint, text, integer, bigint, integer, text, text, boolean,
  text, bigint
) from public, anon, authenticated;
grant execute on function public.manage_google_admin_pdf_documents_v1(
  text, uuid, uuid, text, text, integer, boolean, text, uuid, uuid,
  text, text, bigint, text, integer, bigint, integer, text, text, boolean,
  text, bigint
) to service_role;

create function private.issue_google_admin_pdf_access_claims_v1(
  target_token_hash text,
  target_auth_user_id uuid,
  target_supabase_auth_session_id uuid,
  target_google_issuer text,
  target_provider_subject_hmac text,
  target_subject_pepper_version integer,
  target_transport_enabled boolean,
  target_request_id uuid,
  target_lecture_session_id uuid
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
  operation_key_value text := 'issue-pdf-access-token.admin';
  context_value jsonb;
  receipt_row private.admin_google_operation_receipts%rowtype;
  intent_digest_value text;
  claims_value jsonb;
  lecture_public_id_value text;
begin
  if target_request_id is null or target_lecture_session_id is null then
    return null;
  end if;

  perform private.serialize_admin_ai_request_v1(target_request_id);
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
  intent_digest_value := private.google_admin_operation_intent_digest_v1(
    target_request_id,
    (context_value ->> 'admin_session_id')::uuid,
    operation_key_value,
    target_lecture_session_id,
    null,
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
       and receipt_row.target_id = target_lecture_session_id::text then
      return jsonb_build_object(
        'claims', receipt_row.result_metadata -> 'claims',
        'idempotentReplay', true,
        'ok', true
      );
    end if;
    raise exception 'PDF access request binding does not match its receipt'
      using errcode = 'P7335';
  end if;

  perform private.assert_google_admin_operation_gate_v1(
    context_value,
    target_transport_enabled
  );
  perform private.assert_google_admin_operation_lecture_state_v1(context_value);

  claims_value := public.admin_get_pdf_access_claims_v1(
    target_lecture_session_id
  );
  lecture_public_id_value := claims_value ->> 'lecture_public_id';
  if claims_value is null
     or lecture_public_id_value is null
     or claims_value ->> 'access_version' is null
     or claims_value ->> 'expires_at' is null
     or claims_value ->> 'manifest_version' is null
     or claims_value ->> 'not_before' is null
     or claims_value ->> 'server_time' is null then
    raise exception 'PDF access claims are unavailable'
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
    target_lecture_session_id::text,
    lecture_public_id_value,
    'issued',
    jsonb_build_object('claims', claims_value)
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
    'admin_pdf_access.issue',
    'lecture_session',
    target_lecture_session_id::text,
    'accepted',
    'google_admin_operation',
    jsonb_build_object(
      'access_version', (claims_value ->> 'access_version')::bigint,
      'manifest_version', (claims_value ->> 'manifest_version')::bigint,
      'operation_key', operation_key_value
    )
  );

  return jsonb_build_object(
    'claims', claims_value,
    'idempotentReplay', false,
    'ok', true
  );
end;
$$;

revoke all on function private.issue_google_admin_pdf_access_claims_v1(
  text, uuid, uuid, text, text, integer, boolean, uuid, uuid
) from public, anon, authenticated, service_role;

create function public.issue_google_admin_pdf_access_claims_v1(
  target_token_hash text,
  target_auth_user_id uuid,
  target_supabase_auth_session_id uuid,
  target_google_issuer text,
  target_provider_subject_hmac text,
  target_subject_pepper_version integer,
  target_transport_enabled boolean,
  target_request_id uuid,
  target_lecture_session_id uuid
)
returns jsonb
language sql
volatile
security definer
set search_path = ''
as $$
  select private.issue_google_admin_pdf_access_claims_v1(
    target_token_hash,
    target_auth_user_id,
    target_supabase_auth_session_id,
    target_google_issuer,
    target_provider_subject_hmac,
    target_subject_pepper_version,
    target_transport_enabled,
    target_request_id,
    target_lecture_session_id
  );
$$;

revoke all on function public.issue_google_admin_pdf_access_claims_v1(
  text, uuid, uuid, text, text, integer, boolean, uuid, uuid
) from public, anon, authenticated;
grant execute on function public.issue_google_admin_pdf_access_claims_v1(
  text, uuid, uuid, text, text, integer, boolean, uuid, uuid
) to service_role;

create function private.get_google_admin_operator_live_snapshot_v1(
  target_token_hash text,
  target_auth_user_id uuid,
  target_supabase_auth_session_id uuid,
  target_google_issuer text,
  target_provider_subject_hmac text,
  target_subject_pepper_version integer,
  target_transport_enabled boolean,
  target_action text,
  target_lecture_session_id uuid,
  target_comment_cursor_created_at timestamptz,
  target_comment_cursor_id uuid,
  target_limit integer,
  target_known_caption_version bigint,
  target_known_comments_version bigint,
  target_known_lecture_version bigint,
  target_known_likes_version bigint,
  target_known_metrics_version bigint,
  target_known_pdf_version bigint,
  target_known_polls_version bigint,
  target_known_summaries_version bigint,
  target_academic_answers_enabled boolean
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
begin
  if target_action not in ('snapshot', 'commentHistory')
     or target_lecture_session_id is null then
    return null;
  end if;

  operation_key_value := 'operator-live-snapshot.' || target_action;
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
     or context_value ->> 'lecture_lock_mode' <> 'update' then
    return null;
  end if;

  perform private.assert_google_admin_operation_gate_v1(
    context_value,
    target_transport_enabled
  );
  perform private.assert_google_admin_operation_lecture_state_v1(context_value);

  if target_action = 'commentHistory' then
    if target_comment_cursor_created_at is null
       or target_comment_cursor_id is null then
      return null;
    end if;
    return private.get_lecture_operator_comment_history_v1(
      target_lecture_session_id,
      target_comment_cursor_created_at,
      target_comment_cursor_id,
      least(greatest(coalesce(target_limit, 50), 1), 50)
    );
  end if;

  if coalesce(target_academic_answers_enabled, false) then
    return private.get_lecture_operator_snapshot_v2(
      target_lecture_session_id,
      true,
      target_known_lecture_version,
      target_known_caption_version,
      target_known_comments_version,
      target_known_likes_version,
      target_known_polls_version,
      target_known_summaries_version,
      target_known_pdf_version,
      target_comment_cursor_created_at,
      target_comment_cursor_id,
      5,
      target_known_metrics_version
    );
  end if;

  return private.get_lecture_operator_snapshot_v1(
    target_lecture_session_id,
    true,
    target_known_lecture_version,
    target_known_caption_version,
    target_known_comments_version,
    target_known_likes_version,
    target_known_polls_version,
    target_known_summaries_version,
    target_known_pdf_version,
    target_comment_cursor_created_at,
    target_comment_cursor_id,
    5,
    target_known_metrics_version
  );
end;
$$;

revoke all on function private.get_google_admin_operator_live_snapshot_v1(
  text, uuid, uuid, text, text, integer, boolean, text, uuid,
  timestamptz, uuid, integer, bigint, bigint, bigint, bigint, bigint,
  bigint, bigint, bigint, boolean
) from public, anon, authenticated, service_role;

create function public.get_google_admin_operator_live_snapshot_v1(
  target_token_hash text,
  target_auth_user_id uuid,
  target_supabase_auth_session_id uuid,
  target_google_issuer text,
  target_provider_subject_hmac text,
  target_subject_pepper_version integer,
  target_transport_enabled boolean,
  target_action text,
  target_lecture_session_id uuid,
  target_comment_cursor_created_at timestamptz,
  target_comment_cursor_id uuid,
  target_limit integer,
  target_known_caption_version bigint,
  target_known_comments_version bigint,
  target_known_lecture_version bigint,
  target_known_likes_version bigint,
  target_known_metrics_version bigint,
  target_known_pdf_version bigint,
  target_known_polls_version bigint,
  target_known_summaries_version bigint,
  target_academic_answers_enabled boolean
)
returns jsonb
language sql
volatile
security definer
set search_path = ''
as $$
  select private.get_google_admin_operator_live_snapshot_v1(
    target_token_hash,
    target_auth_user_id,
    target_supabase_auth_session_id,
    target_google_issuer,
    target_provider_subject_hmac,
    target_subject_pepper_version,
    target_transport_enabled,
    target_action,
    target_lecture_session_id,
    target_comment_cursor_created_at,
    target_comment_cursor_id,
    target_limit,
    target_known_caption_version,
    target_known_comments_version,
    target_known_lecture_version,
    target_known_likes_version,
    target_known_metrics_version,
    target_known_pdf_version,
    target_known_polls_version,
    target_known_summaries_version,
    target_academic_answers_enabled
  );
$$;

revoke all on function public.get_google_admin_operator_live_snapshot_v1(
  text, uuid, uuid, text, text, integer, boolean, text, uuid,
  timestamptz, uuid, integer, bigint, bigint, bigint, bigint, bigint,
  bigint, bigint, bigint, boolean
) from public, anon, authenticated;
grant execute on function public.get_google_admin_operator_live_snapshot_v1(
  text, uuid, uuid, text, text, integer, boolean, text, uuid,
  timestamptz, uuid, integer, bigint, bigint, bigint, bigint, bigint,
  bigint, bigint, bigint, boolean
) to service_role;

create function private.manage_google_admin_display_state_v1(
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
  target_current_pdf_page integer,
  target_display_mode text,
  target_pdf_document_id text
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
  live_row public.lecture_live_state%rowtype;
  registered_row public.lecture_pdf_documents%rowtype;
  intent_digest_value text;
  payload_digest_value text;
  normalized_page integer;
  normalized_mode text;
  normalized_document_id text;
  next_document_id text;
  next_document_version text;
  next_manifest_version bigint;
  next_page_count integer;
  next_visible boolean;
  next_page integer;
  next_mode text;
  presenter_gate_enabled boolean;
  updated_state jsonb;
  effective_now timestamptz := statement_timestamp();
begin
  if target_action not in (
       'next', 'previous', 'goToPage', 'setDisplayMode', 'setDocument'
     )
     or target_request_id is null
     or target_lecture_session_id is null then
    return null;
  end if;

  normalized_page := case
    when target_action = 'goToPage' then target_current_pdf_page
    else null
  end;
  normalized_mode := case
    when target_action = 'setDisplayMode' then target_display_mode
    else null
  end;
  normalized_document_id := case
    when target_action = 'setDocument' then
      nullif(btrim(coalesce(target_pdf_document_id, '')), '')
    else null
  end;
  if (target_action = 'goToPage' and coalesce(normalized_page, 0) < 1)
     or (
       target_action = 'setDisplayMode'
       and (
         normalized_mode is null
         or normalized_mode not in ('normal', 'presentation', 'slideOnly')
       )
     )
     or (
       normalized_document_id is not null
       and (
         char_length(normalized_document_id) > 120
         or normalized_document_id !~ '^[A-Za-z0-9][A-Za-z0-9._-]*$'
       )
     ) then
    return null;
  end if;

  perform private.serialize_admin_ai_request_v1(target_request_id);

  -- Presenter legacy functions use gate -> session -> lecture. C2 takes the
  -- same global gate first, then its stronger identity/session/lecture order,
  -- so staged legacy and Google operations cannot form an inverse cycle.
  select gate.enabled
  into presenter_gate_enabled
  from private.presenter_runtime_gate as gate
  where gate.singleton
  for update;
  if not found then
    return null;
  end if;

  operation_key_value := 'update-display-state.' || target_action;
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

  payload_digest_value := encode(
    extensions.digest(
      convert_to(
        'phase730c2:display-state:v1'
        || '|action=' || target_action
        || '|page=' || coalesce(normalized_page::text, '')
        || '|mode=' || coalesce(normalized_mode, '')
        || '|document=' || coalesce(normalized_document_id, ''),
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
    normalized_document_id,
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
       and receipt_row.lecture_session_id = target_lecture_session_id then
      return jsonb_build_object(
        'displayState', receipt_row.result_metadata -> 'displayState',
        'idempotentReplay', true,
        'ok', true
      );
    end if;
    raise exception 'Display-state request binding does not match its receipt'
      using errcode = 'P7335';
  end if;

  perform private.assert_google_admin_operation_gate_v1(
    context_value,
    target_transport_enabled
  );
  perform private.assert_google_admin_operation_lecture_state_v1(context_value);

  select live.*
  into live_row
  from public.lecture_live_state as live
  where live.lecture_session_id = target_lecture_session_id
  for update;
  if not found then
    raise exception 'Lecture live state is unavailable'
      using errcode = 'P7335';
  end if;

  next_document_id := live_row.pdf_document_id;
  next_document_version := live_row.pdf_document_version;
  next_manifest_version := coalesce(live_row.pdf_manifest_version, 0);
  next_page_count := live_row.pdf_page_count;
  next_visible := coalesce(live_row.pdf_visible, false);
  next_page := coalesce(live_row.current_pdf_page, 1);
  next_mode := coalesce(live_row.display_mode, 'normal');

  if target_action = 'next' then
    if next_page_count is null or next_page >= next_page_count then
      raise exception 'The PDF is already on its last page.'
        using errcode = '22023';
    end if;
    next_page := next_page + 1;
  elsif target_action = 'previous' then
    next_page := greatest(1, next_page - 1);
  elsif target_action = 'goToPage' then
    if next_page_count is null or normalized_page > next_page_count then
      raise exception 'PDF page exceeds the registered page count.'
        using errcode = '22023';
    end if;
    next_page := normalized_page;
  elsif target_action = 'setDisplayMode' then
    next_mode := normalized_mode;
  elsif target_action = 'setDocument' then
    if normalized_document_id is null then
      next_document_id := null;
      next_document_version := null;
      next_manifest_version := 0;
      next_page_count := null;
      next_visible := false;
      next_page := 1;
    else
      select document.*
      into registered_row
      from public.lecture_pdf_documents as document
      where document.lecture_session_id = target_lecture_session_id
        and document.document_id = normalized_document_id
        and document.visible
      order by document.manifest_version desc
      limit 1
      for share;

      if found then
        next_document_id := registered_row.document_id;
        next_document_version := registered_row.document_version;
        next_manifest_version := registered_row.manifest_version;
        next_page_count := registered_row.page_count;
      elsif normalized_document_id = 'why-learn-english-v1' then
        next_document_id := normalized_document_id;
        next_document_version := null;
        next_manifest_version := 0;
        next_page_count := 15;
      elsif normalized_document_id = 'm4-sample-v1' then
        next_document_id := normalized_document_id;
        next_document_version := null;
        next_manifest_version := 0;
        next_page_count := 3;
      else
        raise exception 'The selected PDF document is not registered.'
          using errcode = 'P7335';
      end if;
      next_visible := true;
      next_page := 1;
    end if;
  end if;

  if presenter_gate_enabled then
    perform 1
    from public.presenter_connections as connection
    where connection.lecture_session_id = target_lecture_session_id
      and connection.state = 'active'
      and connection.revoked_at is null
      and connection.capability_expires_at > effective_now
      and connection.hard_stop_at > effective_now
      and connection.last_seen_at > effective_now - interval '45 seconds'
    order by connection.id
    for update;
    if found then
      raise exception 'PowerPoint synchronization is active.'
        using errcode = 'P7291';
    end if;
  end if;

  if next_document_version is not null or next_document_id is null then
    perform *
    from public.admin_update_pdf_display_v3(
      target_lecture_session_id,
      next_document_id,
      next_document_version,
      next_manifest_version,
      next_page_count,
      next_visible,
      next_page,
      next_mode
    );
  else
    perform *
    from public.admin_update_pdf_display(
      target_lecture_session_id,
      next_document_id,
      next_page,
      next_mode
    );
  end if;

  select jsonb_build_object(
    'current_pdf_page', live.current_pdf_page,
    'display_mode', live.display_mode,
    'lecture_session_id', live.lecture_session_id,
    'pdf_document_id', live.pdf_document_id,
    'pdf_document_version', live.pdf_document_version,
    'pdf_manifest_version', live.pdf_manifest_version,
    'pdf_page_count', live.pdf_page_count,
    'pdf_visible', live.pdf_visible,
    'updated_at', live.updated_at
  )
  into updated_state
  from public.lecture_live_state as live
  where live.lecture_session_id = target_lecture_session_id;
  if updated_state is null then
    raise exception 'Display state update did not converge'
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
    coalesce(normalized_document_id, target_action),
    target_lecture_session_id::text,
    'updated',
    jsonb_build_object('displayState', updated_state)
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
    'admin_display_state.' || target_action,
    'lecture_session',
    target_lecture_session_id::text,
    'accepted',
    'google_admin_operation',
    jsonb_build_object(
      'display_mode', updated_state ->> 'display_mode',
      'operation_key', operation_key_value,
      'pdf_visible', coalesce(
        (updated_state ->> 'pdf_visible')::boolean,
        false
      )
    )
  );

  return jsonb_build_object(
    'displayState', updated_state,
    'idempotentReplay', false,
    'ok', true
  );
end;
$$;

revoke all on function private.manage_google_admin_display_state_v1(
  text, uuid, uuid, text, text, integer, boolean, text, uuid, uuid,
  integer, text, text
) from public, anon, authenticated, service_role;

create function public.manage_google_admin_display_state_v1(
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
  target_current_pdf_page integer,
  target_display_mode text,
  target_pdf_document_id text
)
returns jsonb
language sql
volatile
security definer
set search_path = ''
as $$
  select private.manage_google_admin_display_state_v1(
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
    target_current_pdf_page,
    target_display_mode,
    target_pdf_document_id
  );
$$;

revoke all on function public.manage_google_admin_display_state_v1(
  text, uuid, uuid, text, text, integer, boolean, text, uuid, uuid,
  integer, text, text
) from public, anon, authenticated;
grant execute on function public.manage_google_admin_display_state_v1(
  text, uuid, uuid, text, text, integer, boolean, text, uuid, uuid,
  integer, text, text
) to service_role;

create function private.get_google_admin_material_analysis_v1(
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
set statement_timeout = '5s'
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
    'manage-material-analysis.list',
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
  return public.admin_list_material_ai_results(target_lecture_session_id);
end;
$$;

revoke all on function private.get_google_admin_material_analysis_v1(
  text, uuid, uuid, text, text, integer, boolean, uuid
) from public, anon, authenticated, service_role;

create function private.manage_google_admin_material_analysis_v1(
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
  target_proposal_id uuid,
  target_analysis_id uuid,
  target_question text,
  target_poll_type text,
  target_option_labels text[],
  target_summary_body jsonb,
  target_review_state text
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
  normalized_question text;
  normalized_options text[];
  normalized_summary jsonb;
  actor_value text;
  poll_id_value uuid;
  publication_value jsonb;
  result_id_value text;
  result_status_value text;
  results_value jsonb;
  target_id_value text;
  target_type_value text;
begin
  if target_action not in (
       'adopt', 'reject', 'publishSummary', 'hideSummary'
     )
     or target_request_id is null
     or target_lecture_session_id is null then
    return null;
  end if;

  normalized_question := nullif(btrim(coalesce(target_question, '')), '');
  if target_option_labels is not null then
    select array_agg(btrim(option_label) order by ordinality)
    into normalized_options
    from unnest(target_option_labels) with ordinality
      as option_value(option_label, ordinality);
  end if;
  normalized_summary := case
    when target_summary_body is null then null
    else jsonb_strip_nulls(target_summary_body)
  end;

  if target_action = 'adopt' and (
       target_proposal_id is null
       or target_analysis_id is not null
       or normalized_question is null
       or char_length(normalized_question) not between 10 and 300
       or target_poll_type is null
       or target_poll_type not in ('single', 'multiple')
       or normalized_options is null
       or coalesce(cardinality(normalized_options), 0) not between 2 and 8
       or exists (
         select 1
         from unnest(normalized_options) as option_value(option_label)
         where option_label is null
           or char_length(option_label) not between 1 and 200
       )
       or cardinality(normalized_options) <> (
         select count(distinct lower(option_label))
         from unnest(normalized_options) as option_value(option_label)
       )
       or target_summary_body is not null
       or target_review_state is not null
     ) then
    return null;
  end if;
  if target_action = 'reject' and (
       target_proposal_id is null
       or target_analysis_id is not null
       or target_question is not null
       or target_poll_type is not null
       or target_option_labels is not null
       or target_summary_body is not null
       or target_review_state is not null
     ) then
    return null;
  end if;
  if target_action = 'publishSummary' and (
       target_analysis_id is null
       or target_proposal_id is not null
       or target_question is not null
       or target_poll_type is not null
       or target_option_labels is not null
       or target_review_state is null
       or target_review_state not in ('admin_confirmed', 'admin_revised')
       or normalized_summary is null
       or not private.phase66_material_summary_body_is_valid(
         normalized_summary
       )
     ) then
    return null;
  end if;
  if target_action = 'hideSummary' and (
       target_analysis_id is null
       or target_proposal_id is not null
       or target_question is not null
       or target_poll_type is not null
       or target_option_labels is not null
       or target_summary_body is not null
       or target_review_state is not null
     ) then
    return null;
  end if;

  if target_action in ('adopt', 'reject') then
    target_id_value := target_proposal_id::text;
    target_type_value := 'poll_proposal';
  else
    target_id_value := target_analysis_id::text;
    target_type_value := 'material_summary';
  end if;

  perform private.serialize_admin_ai_request_v1(target_request_id);
  operation_key_value := 'manage-material-analysis.' || target_action;
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
  if target_action in ('adopt', 'publishSummary', 'hideSummary')
     and context_value ->> 'lecture_lock_mode'
       is distinct from 'update' then
    return null;
  end if;

  payload_digest_value := encode(
    extensions.digest(
      convert_to(
        jsonb_build_object(
          'action', target_action,
          'analysisId', target_analysis_id,
          'optionLabels', normalized_options,
          'pollType', case
            when target_action = 'adopt' then target_poll_type
            else null
          end,
          'proposalId', target_proposal_id,
          'question', case
            when target_action = 'adopt' then normalized_question
            else null
          end,
          'reviewState', case
            when target_action = 'publishSummary' then target_review_state
            else null
          end,
          'summaryBody', case
            when target_action = 'publishSummary' then normalized_summary
            else null
          end
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
       and receipt_row.lecture_session_id = target_lecture_session_id then
      return jsonb_build_object(
        'idempotentReplay', true,
        'ok', true,
        'pollId', receipt_row.result_metadata ->> 'pollId',
        'refreshRequired', true,
        'resultId', receipt_row.result_id,
        'resultStatus', receipt_row.result_status,
        'results', null
      );
    end if;
    raise exception 'Material-analysis request binding does not match its receipt'
      using errcode = 'P7335';
  end if;

  perform private.assert_google_admin_operation_gate_v1(
    context_value,
    target_transport_enabled
  );
  perform private.assert_google_admin_operation_lecture_state_v1(context_value);
  actor_value := 'google-admin-session:' ||
    (context_value ->> 'admin_session_id');

  if target_action = 'adopt' then
    poll_id_value := public.admin_adopt_poll_proposal(
      target_lecture_session_id,
      target_proposal_id,
      actor_value,
      normalized_question,
      target_poll_type,
      normalized_options
    );
    result_id_value := poll_id_value::text;
    result_status_value := 'adopted';
  elsif target_action = 'reject' then
    if public.admin_reject_poll_proposal(
      target_lecture_session_id,
      target_proposal_id,
      actor_value
    ) is not true then
      raise exception 'Poll proposal rejection did not converge'
        using errcode = 'P7335';
    end if;
    result_id_value := target_proposal_id::text;
    result_status_value := 'rejected';
  else
    publication_value := public.admin_set_material_summary_publication(
      (context_value ->> 'admin_session_id')::uuid,
      target_lecture_session_id,
      target_analysis_id,
      case when target_action = 'publishSummary' then 'public' else 'hidden' end,
      normalized_summary,
      case
        when target_action = 'publishSummary' then target_review_state
        else null
      end
    );
    if publication_value is null
       or (publication_value ->> 'analysis_id') is distinct from
         target_analysis_id::text
       or (publication_value ->> 'visibility') is distinct from (
         case when target_action = 'publishSummary' then 'public' else 'hidden' end
       ) then
      raise exception 'Material summary publication did not converge'
        using errcode = 'P7335';
    end if;
    result_id_value := target_analysis_id::text;
    result_status_value := publication_value ->> 'visibility';
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
    result_id_value,
    result_status_value,
    jsonb_build_object(
      'pollId', poll_id_value,
      'refreshRequired', true
    )
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
    'admin_material_analysis.' || target_action,
    target_type_value,
    target_id_value,
    'accepted',
    'google_admin_operation',
    jsonb_build_object(
      'operation_key', operation_key_value,
      'result_status', result_status_value
    )
  );

  results_value := public.admin_list_material_ai_results(
    target_lecture_session_id
  );
  return jsonb_build_object(
    'idempotentReplay', false,
    'ok', true,
    'pollId', poll_id_value,
    'refreshRequired', false,
    'resultId', result_id_value,
    'resultStatus', result_status_value,
    'results', results_value
  );
end;
$$;

revoke all on function private.manage_google_admin_material_analysis_v1(
  text, uuid, uuid, text, text, integer, boolean, text, uuid, uuid,
  uuid, uuid, text, text, text[], jsonb, text
) from public, anon, authenticated, service_role;

create function public.get_google_admin_material_analysis_v1(
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
  select private.get_google_admin_material_analysis_v1(
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

revoke all on function public.get_google_admin_material_analysis_v1(
  text, uuid, uuid, text, text, integer, boolean, uuid
) from public, anon, authenticated;
grant execute on function public.get_google_admin_material_analysis_v1(
  text, uuid, uuid, text, text, integer, boolean, uuid
) to service_role;

create function public.manage_google_admin_material_analysis_v1(
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
  target_proposal_id uuid,
  target_analysis_id uuid,
  target_question text,
  target_poll_type text,
  target_option_labels text[],
  target_summary_body jsonb,
  target_review_state text
)
returns jsonb
language sql
volatile
security definer
set search_path = ''
as $$
  select private.manage_google_admin_material_analysis_v1(
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
    target_proposal_id,
    target_analysis_id,
    target_question,
    target_poll_type,
    target_option_labels,
    target_summary_body,
    target_review_state
  );
$$;

revoke all on function public.manage_google_admin_material_analysis_v1(
  text, uuid, uuid, text, text, integer, boolean, text, uuid, uuid,
  uuid, uuid, text, text, text[], jsonb, text
) from public, anon, authenticated;
grant execute on function public.manage_google_admin_material_analysis_v1(
  text, uuid, uuid, text, text, integer, boolean, text, uuid, uuid,
  uuid, uuid, text, text, text[], jsonb, text
) to service_role;

create function private.get_google_admin_sessions_v1(
  target_token_hash text,
  target_auth_user_id uuid,
  target_supabase_auth_session_id uuid,
  target_google_issuer text,
  target_provider_subject_hmac text,
  target_subject_pepper_version integer,
  target_transport_enabled boolean
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
  sessions_value jsonb;
begin
  if target_transport_enabled is null then
    return null;
  end if;

  context_value := private.require_google_admin_operation_context_v1(
    target_token_hash,
    target_auth_user_id,
    target_supabase_auth_session_id,
    target_google_issuer,
    target_provider_subject_hmac,
    target_subject_pepper_version,
    'manage-admin-sessions.list',
    null
  );
  if context_value is null then
    return null;
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'expires_at', candidate.expires_at,
        'id', candidate.id,
        'idle_expires_at', candidate.idle_expires_at,
        'is_current', candidate.id =
          (context_value ->> 'admin_session_id')::uuid,
        'issued_at', candidate.issued_at,
        'last_seen_at', candidate.last_seen_at,
        'revoke_reason', candidate.revoke_reason,
        'revoked_at', candidate.revoked_at,
        'status', case
          when candidate.revoked_at is not null then 'revoked'
          when candidate.expires_at <= statement_timestamp() then 'expired'
          else 'active'
        end
      )
      order by candidate.issued_at desc, candidate.id desc
    ),
    '[]'::jsonb
  )
  into sessions_value
  from (
    select session.*
    from public.admin_sessions as session
    where session.authentication_method = 'google_totp'
      and session.auth_user_id = target_auth_user_id
      and session.environment_id =
        (context_value ->> 'environment_id')::uuid
      and session.principal_id =
        (context_value ->> 'principal_id')::uuid
      and session.membership_id =
        (context_value ->> 'membership_id')::uuid
    order by session.issued_at desc, session.id desc
    limit 20
  ) as candidate;

  return jsonb_build_object(
    'currentSessionId', context_value ->> 'admin_session_id',
    'ok', true,
    'sessions', sessions_value
  );
end;
$$;

revoke all on function private.get_google_admin_sessions_v1(
  text, uuid, uuid, text, text, integer, boolean
) from public, anon, authenticated, service_role;

create function private.manage_google_admin_sessions_v1(
  target_token_hash text,
  target_auth_user_id uuid,
  target_supabase_auth_session_id uuid,
  target_google_issuer text,
  target_provider_subject_hmac text,
  target_subject_pepper_version integer,
  target_transport_enabled boolean,
  target_action text,
  target_request_id uuid,
  target_session_id uuid
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
  actor_session_row public.admin_sessions%rowtype;
  target_session_row public.admin_sessions%rowtype;
  principal_row private.admin_principals%rowtype;
  intent_digest_value text;
  intent_target_id_value text;
  receipt_target_id_value text;
  revoked_count_value integer := 0;
  current_session_revoked_value boolean := false;
  result_status_value text;
  effective_now timestamptz := statement_timestamp();
begin
  if target_action not in ('logout', 'revoke', 'revokeAll')
     or target_request_id is null
     or target_transport_enabled is null
     or (
       target_action = 'revoke'
       and target_session_id is null
     )
     or (
       target_action <> 'revoke'
       and target_session_id is not null
     ) then
    return null;
  end if;

  operation_key_value := 'manage-admin-sessions.' || target_action;
  intent_target_id_value := case
    when target_action = 'revoke' then target_session_id::text
    else null
  end;

  perform private.serialize_admin_ai_request_v1(target_request_id);

  -- A successful logout can revoke the very app session used by this request.
  -- Exact replay therefore authenticates the immutable receipt and original
  -- session binding without requiring that session to still be active.
  select receipt.*
  into receipt_row
  from private.admin_google_operation_receipts as receipt
  where receipt.request_id = target_request_id;
  if found then
    select session.*
    into actor_session_row
    from public.admin_sessions as session
    where session.id = receipt_row.admin_session_id
      and session.token_hash = target_token_hash
      and session.authentication_method = 'google_totp'
      and session.auth_user_id = target_auth_user_id
      and session.supabase_auth_session_id = target_supabase_auth_session_id;

    select principal.*
    into principal_row
    from private.admin_principals as principal
    where principal.id = receipt_row.principal_id
      and principal.auth_user_id = target_auth_user_id
      and principal.provider = 'google'
      and principal.google_issuer = target_google_issuer
      and principal.provider_subject_hmac = target_provider_subject_hmac
      and principal.subject_pepper_version = target_subject_pepper_version;

    intent_digest_value := private.google_admin_operation_intent_digest_v1(
      target_request_id,
      receipt_row.admin_session_id,
      operation_key_value,
      null,
      intent_target_id_value,
      null
    );
    receipt_target_id_value := case
      when target_action = 'logout' then actor_session_row.id::text
      when target_action = 'revoke' then target_session_id::text
      else principal_row.id::text
    end;

    if actor_session_row.id is null
       or principal_row.id is null
       or receipt_row.operation_key <> operation_key_value
       or receipt_row.intent_digest is distinct from intent_digest_value
       or receipt_row.environment_id is distinct from
         actor_session_row.environment_id
       or receipt_row.principal_id is distinct from
         actor_session_row.principal_id
       or receipt_row.membership_id is distinct from
         actor_session_row.membership_id
       or receipt_row.supabase_auth_session_id is distinct from
         target_supabase_auth_session_id
       or receipt_row.target_id is distinct from receipt_target_id_value then
      raise exception 'Admin-session request binding does not match its receipt'
        using errcode = 'P7335';
    end if;

    return receipt_row.result_metadata || jsonb_build_object(
      'idempotentReplay', true,
      'ok', true,
      'resultId', receipt_row.result_id,
      'resultStatus', receipt_row.result_status
    );
  end if;

  context_value := private.require_google_admin_operation_context_v1(
    target_token_hash,
    target_auth_user_id,
    target_supabase_auth_session_id,
    target_google_issuer,
    target_provider_subject_hmac,
    target_subject_pepper_version,
    operation_key_value,
    null
  );
  if context_value is null then
    return null;
  end if;

  intent_digest_value := private.google_admin_operation_intent_digest_v1(
    target_request_id,
    (context_value ->> 'admin_session_id')::uuid,
    operation_key_value,
    null,
    intent_target_id_value,
    null
  );
  if intent_digest_value is null then
    return null;
  end if;

  if target_action in ('logout', 'revoke') then
    select session.*
    into target_session_row
    from public.admin_sessions as session
    where session.id = case
        when target_action = 'logout' then
          (context_value ->> 'admin_session_id')::uuid
        else target_session_id
      end
      and session.authentication_method = 'google_totp'
      and session.auth_user_id = target_auth_user_id
      and session.environment_id =
        (context_value ->> 'environment_id')::uuid
      and session.principal_id =
        (context_value ->> 'principal_id')::uuid
      and session.membership_id =
        (context_value ->> 'membership_id')::uuid
    for update;
    if not found then
      return null;
    end if;

    receipt_target_id_value := target_session_row.id::text;
    current_session_revoked_value := target_session_row.id =
      (context_value ->> 'admin_session_id')::uuid;
    if target_session_row.revoked_at is null then
      update public.admin_sessions
      set
        revoked_at = effective_now,
        revoke_reason = case
          when target_action = 'logout' then 'self_logout'
          else 'self_session_revoked'
        end,
        updated_at = effective_now
      where id = target_session_row.id;
      revoked_count_value := 1;
    end if;
  else
    receipt_target_id_value := context_value ->> 'principal_id';
    for target_session_row in
      select session.*
      from public.admin_sessions as session
      where session.authentication_method = 'google_totp'
        and session.auth_user_id = target_auth_user_id
        and session.environment_id =
          (context_value ->> 'environment_id')::uuid
        and session.principal_id =
          (context_value ->> 'principal_id')::uuid
        and session.membership_id =
          (context_value ->> 'membership_id')::uuid
      order by session.id
      for update
    loop
      if target_session_row.id =
         (context_value ->> 'admin_session_id')::uuid then
        current_session_revoked_value := true;
      end if;
      if target_session_row.revoked_at is null then
        update public.admin_sessions
        set
          revoked_at = effective_now,
          revoke_reason = 'self_all_sessions_revoked',
          updated_at = effective_now
        where id = target_session_row.id;
        revoked_count_value := revoked_count_value + 1;
      end if;
    end loop;
  end if;

  result_status_value := case
    when revoked_count_value > 0 then 'revoked'
    else 'already_revoked'
  end;

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
    null,
    receipt_target_id_value,
    receipt_target_id_value,
    result_status_value,
    jsonb_build_object(
      'currentSessionRevoked', current_session_revoked_value,
      'refreshRequired', true,
      'revokedCount', revoked_count_value
    )
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
    'admin_session.' || target_action,
    case
      when target_action = 'revokeAll' then 'admin_principal'
      else 'admin_session'
    end,
    receipt_target_id_value,
    'accepted',
    'google_admin_operation',
    jsonb_build_object(
      'current_session_revoked', current_session_revoked_value,
      'revoked_count', revoked_count_value
    )
  );

  return jsonb_build_object(
    'currentSessionRevoked', current_session_revoked_value,
    'idempotentReplay', false,
    'ok', true,
    'refreshRequired', true,
    'resultId', receipt_target_id_value,
    'resultStatus', result_status_value,
    'revokedCount', revoked_count_value
  );
end;
$$;

revoke all on function private.manage_google_admin_sessions_v1(
  text, uuid, uuid, text, text, integer, boolean, text, uuid, uuid
) from public, anon, authenticated, service_role;

create function public.get_google_admin_sessions_v1(
  target_token_hash text,
  target_auth_user_id uuid,
  target_supabase_auth_session_id uuid,
  target_google_issuer text,
  target_provider_subject_hmac text,
  target_subject_pepper_version integer,
  target_transport_enabled boolean
)
returns jsonb
language sql
volatile
security definer
set search_path = ''
as $$
  select private.get_google_admin_sessions_v1(
    target_token_hash,
    target_auth_user_id,
    target_supabase_auth_session_id,
    target_google_issuer,
    target_provider_subject_hmac,
    target_subject_pepper_version,
    target_transport_enabled
  );
$$;

revoke all on function public.get_google_admin_sessions_v1(
  text, uuid, uuid, text, text, integer, boolean
) from public, anon, authenticated;
grant execute on function public.get_google_admin_sessions_v1(
  text, uuid, uuid, text, text, integer, boolean
) to service_role;

create function public.manage_google_admin_sessions_v1(
  target_token_hash text,
  target_auth_user_id uuid,
  target_supabase_auth_session_id uuid,
  target_google_issuer text,
  target_provider_subject_hmac text,
  target_subject_pepper_version integer,
  target_transport_enabled boolean,
  target_action text,
  target_request_id uuid,
  target_session_id uuid
)
returns jsonb
language sql
volatile
security definer
set search_path = ''
as $$
  select private.manage_google_admin_sessions_v1(
    target_token_hash,
    target_auth_user_id,
    target_supabase_auth_session_id,
    target_google_issuer,
    target_provider_subject_hmac,
    target_subject_pepper_version,
    target_transport_enabled,
    target_action,
    target_request_id,
    target_session_id
  );
$$;

revoke all on function public.manage_google_admin_sessions_v1(
  text, uuid, uuid, text, text, integer, boolean, text, uuid, uuid
) from public, anon, authenticated;
grant execute on function public.manage_google_admin_sessions_v1(
  text, uuid, uuid, text, text, integer, boolean, text, uuid, uuid
) to service_role;
