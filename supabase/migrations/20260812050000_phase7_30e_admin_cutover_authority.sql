-- Phase 7.30E: dormant Google-only Admin identity cutover authority.
--
-- Applying this migration does not claim a lecture, disable legacy admission,
-- revoke a session, or activate Hosted configuration. Existing lectures can
-- only be claimed from an immutable operator-reviewed mapping. The final
-- cutover remains an explicit SERIALIZABLE operator transaction and records a
-- digest of the independently verified Hosted deployment evidence.

alter table private.admin_environment_memberships
  add constraint admin_environment_memberships_id_environment_principal_key
  unique (id, environment_id, principal_id);

create table private.admin_lecture_ownership_claim_approvals (
  id uuid primary key,
  approval_request_id uuid not null unique,
  environment_id uuid not null
    references private.admin_environments(id) on delete restrict,
  lecture_session_id uuid not null
    references public.lecture_sessions(id) on delete restrict,
  principal_id uuid not null
    references private.admin_principals(id) on delete restrict,
  membership_id uuid not null,
  approved_by_admin_session_id uuid not null
    references public.admin_sessions(id) on delete restrict,
  expected_lecture_status text not null check (
    expected_lecture_status in ('draft', 'open', 'closed')
  ),
  expected_lifecycle_version bigint not null check (
    expected_lifecycle_version >= 0
  ),
  mapping_evidence_digest text not null check (
    mapping_evidence_digest ~ '^[0-9a-f]{64}$'
  ),
  approval_intent_digest text not null check (
    approval_intent_digest ~ '^[0-9a-f]{64}$'
  ),
  operator_actor text not null check (
    operator_actor = pg_catalog.btrim(operator_actor)
    and pg_catalog.char_length(operator_actor) between 3 and 160
  ),
  reason text not null check (
    reason = pg_catalog.btrim(reason)
    and pg_catalog.char_length(reason) between 3 and 500
  ),
  approved_at timestamptz not null default statement_timestamp(),
  expires_at timestamptz not null,
  foreign key (membership_id, environment_id, principal_id)
    references private.admin_environment_memberships(
      id, environment_id, principal_id
    ) on delete restrict,
  unique (
    id,
    environment_id,
    lecture_session_id,
    principal_id,
    membership_id
  ),
  check (expires_at > approved_at),
  check (expires_at <= approved_at + interval '7 days')
);

comment on table private.admin_lecture_ownership_claim_approvals is
  'Immutable operator-reviewed lecture ownership mappings. No browser or service-role principal can create or alter an approval.';

create index admin_lecture_ownership_claim_approvals_environment_idx
  on private.admin_lecture_ownership_claim_approvals (
    environment_id, approved_at desc, id
  );
create index admin_lecture_ownership_claim_approvals_lecture_idx
  on private.admin_lecture_ownership_claim_approvals (
    lecture_session_id, approved_at desc, id
  );

alter table private.admin_lecture_ownerships
  add column ownership_approval_id uuid;

alter table private.admin_lecture_ownerships
  drop constraint admin_lecture_ownerships_ownership_source_check,
  add constraint admin_lecture_ownerships_ownership_source_check check (
    ownership_source in ('google_create', 'operator_claim')
  ),
  add constraint admin_lecture_ownerships_source_provenance_check check (
    (
      ownership_source = 'google_create'
      and ownership_approval_id is null
    )
    or (
      ownership_source = 'operator_claim'
      and ownership_approval_id is not null
    )
  ),
  add constraint admin_lecture_ownerships_operator_claim_fkey
    foreign key (
      ownership_approval_id,
      environment_id,
      lecture_session_id,
      principal_id,
      membership_id
    ) references private.admin_lecture_ownership_claim_approvals (
      id,
      environment_id,
      lecture_session_id,
      principal_id,
      membership_id
    ) on delete restrict;

create unique index admin_lecture_ownerships_approval_idx
  on private.admin_lecture_ownerships (ownership_approval_id)
  where ownership_approval_id is not null;

create table private.admin_lecture_ownership_claim_receipts (
  request_id uuid primary key,
  approval_id uuid not null unique
    references private.admin_lecture_ownership_claim_approvals(id)
    on delete restrict,
  intent_digest text not null check (intent_digest ~ '^[0-9a-f]{64}$'),
  environment_id uuid not null
    references private.admin_environments(id) on delete restrict,
  lecture_session_id uuid not null
    references public.lecture_sessions(id) on delete restrict,
  principal_id uuid not null
    references private.admin_principals(id) on delete restrict,
  membership_id uuid not null
    references private.admin_environment_memberships(id) on delete restrict,
  actor_principal_id uuid not null
    references private.admin_principals(id) on delete restrict,
  actor_membership_id uuid not null
    references private.admin_environment_memberships(id) on delete restrict,
  actor_admin_session_id uuid not null
    references public.admin_sessions(id) on delete restrict,
  ownership_source text not null check (ownership_source = 'operator_claim'),
  claimed_at timestamptz not null default statement_timestamp()
);

comment on table private.admin_lecture_ownership_claim_receipts is
  'Immutable exact-replay evidence for an operator-approved legacy lecture ownership claim.';

create index admin_lecture_ownership_claim_receipts_environment_idx
  on private.admin_lecture_ownership_claim_receipts (
    environment_id, claimed_at desc, request_id
  );
create index admin_lecture_ownership_claim_receipts_lecture_idx
  on private.admin_lecture_ownership_claim_receipts (
    lecture_session_id, claimed_at desc, request_id
  );

create table private.admin_identity_cutover_receipts (
  singleton boolean primary key default true check (singleton),
  request_id uuid not null unique,
  environment_id uuid not null unique
    references private.admin_environments(id) on delete restrict,
  intent_digest text not null check (intent_digest ~ '^[0-9a-f]{64}$'),
  deployment_evidence_digest text not null check (
    deployment_evidence_digest ~ '^[0-9a-f]{64}$'
  ),
  operator_actor text not null check (
    operator_actor = pg_catalog.btrim(operator_actor)
    and pg_catalog.char_length(operator_actor) between 3 and 160
  ),
  reason text not null check (
    reason = pg_catalog.btrim(reason)
    and pg_catalog.char_length(reason) between 3 and 500
  ),
  active_owner_count integer not null check (active_owner_count >= 2),
  revoked_legacy_session_count integer not null check (
    revoked_legacy_session_count >= 0
  ),
  committed_at timestamptz not null default statement_timestamp()
);

comment on table private.admin_identity_cutover_receipts is
  'Global immutable Google-only Admin identity tombstone. The deployment digest is operator attestation, not DB-derived proof of Hosted deployment state.';

alter table private.admin_lecture_ownership_claim_approvals
  enable row level security;
alter table private.admin_lecture_ownership_claim_receipts
  enable row level security;
alter table private.admin_identity_cutover_receipts
  enable row level security;

revoke all on private.admin_lecture_ownership_claim_approvals
  from public, anon, authenticated, service_role;
revoke all on private.admin_lecture_ownership_claim_receipts
  from public, anon, authenticated, service_role;
revoke all on private.admin_identity_cutover_receipts
  from public, anon, authenticated, service_role;

create trigger admin_lecture_ownership_claim_approvals_append_only
before update or delete on private.admin_lecture_ownership_claim_approvals
for each row execute function private.reject_admin_c1_evidence_mutation_v1();

create trigger admin_lecture_ownership_claim_receipts_append_only
before update or delete on private.admin_lecture_ownership_claim_receipts
for each row execute function private.reject_admin_c1_evidence_mutation_v1();

create trigger admin_identity_cutover_receipts_append_only
before update or delete on private.admin_identity_cutover_receipts
for each row execute function private.reject_admin_c1_evidence_mutation_v1();

create function private.approve_google_admin_lecture_ownership_claim_v1(
  target_approval_id uuid,
  target_approval_request_id uuid,
  target_environment_id uuid,
  target_lecture_session_id uuid,
  target_principal_id uuid,
  target_membership_id uuid,
  target_approved_by_admin_session_id uuid,
  target_operator_actor text,
  target_reason text,
  target_mapping_evidence_digest text,
  target_expires_at timestamptz
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
  effective_now timestamptz := statement_timestamp();
  intent_digest text;
  operator_actor_digest text;
  reason_digest text;
  discovered_actor record;
  actor_session public.admin_sessions%rowtype;
  actor_principal private.admin_principals%rowtype;
  actor_membership private.admin_environment_memberships%rowtype;
  target_principal_row private.admin_principals%rowtype;
  target_membership_row private.admin_environment_memberships%rowtype;
  environment_row private.admin_environments%rowtype;
  lecture_row public.lecture_sessions%rowtype;
  existing_approval private.admin_lecture_ownership_claim_approvals%rowtype;
begin
  if target_approval_id is null
     or target_approval_request_id is null
     or target_environment_id is null
     or target_lecture_session_id is null
     or target_principal_id is null
     or target_membership_id is null
     or target_approved_by_admin_session_id is null
     or target_operator_actor is null
     or target_operator_actor <> pg_catalog.btrim(target_operator_actor)
     or pg_catalog.char_length(target_operator_actor) not between 3 and 160
     or target_reason is null
     or target_reason <> pg_catalog.btrim(target_reason)
     or pg_catalog.char_length(target_reason) not between 3 and 500
     or target_mapping_evidence_digest is null
     or target_mapping_evidence_digest !~ '^[0-9a-f]{64}$'
     or target_expires_at is null
     or target_expires_at <= effective_now
     or target_expires_at > effective_now + interval '7 days' then
    raise exception 'Google Admin lecture ownership approval is invalid'
      using errcode = '22023';
  end if;

  operator_actor_digest := pg_catalog.encode(
    extensions.digest(
      pg_catalog.convert_to(target_operator_actor, 'UTF8'),
      'sha256'
    ),
    'hex'
  );
  reason_digest := pg_catalog.encode(
    extensions.digest(
      pg_catalog.convert_to(target_reason, 'UTF8'),
      'sha256'
    ),
    'hex'
  );
  intent_digest := pg_catalog.encode(
    extensions.digest(
      pg_catalog.convert_to(
        target_approval_id::text || '|' ||
        target_approval_request_id::text || '|' ||
        target_environment_id::text || '|' ||
        target_lecture_session_id::text || '|' ||
        target_principal_id::text || '|' ||
        target_membership_id::text || '|' ||
        target_approved_by_admin_session_id::text || '|' ||
        operator_actor_digest || '|' || reason_digest || '|' ||
        target_mapping_evidence_digest || '|' ||
        pg_catalog.date_part('epoch', target_expires_at)::text,
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );

  perform private.serialize_admin_ai_scope_v1(
    'admin-ledger-environment',
    target_environment_id
  );
  perform private.serialize_admin_ai_request_v1(target_approval_request_id);

  select approval.*
  into existing_approval
  from private.admin_lecture_ownership_claim_approvals as approval
  where approval.approval_request_id = target_approval_request_id
  for share;

  if found then
    if existing_approval.id <> target_approval_id
       or existing_approval.approval_intent_digest <> intent_digest then
      raise exception 'Google Admin lecture ownership approval collided'
        using errcode = 'P7335';
    end if;
    return jsonb_build_object(
      'approvalId', existing_approval.id,
      'environmentId', existing_approval.environment_id,
      'expiresAt', existing_approval.expires_at,
      'lectureSessionId', existing_approval.lecture_session_id,
      'membershipId', existing_approval.membership_id,
      'ok', true,
      'principalId', existing_approval.principal_id,
      'replayed', true
    );
  end if;

  if exists (
    select 1
    from private.admin_lecture_ownership_claim_approvals as approval
    where approval.id = target_approval_id
  ) then
    raise exception 'Google Admin lecture ownership approval collided'
      using errcode = 'P7335';
  end if;

  if exists (
    select 1
    from private.admin_identity_cutover_receipts
  ) then
    raise exception 'Google-only Admin cutover already committed'
      using errcode = 'P7335';
  end if;

  select
    session.principal_id,
    session.membership_id,
    session.environment_id
  into discovered_actor
  from public.admin_sessions as session
  where session.id = target_approved_by_admin_session_id;

  if not found
     or discovered_actor.principal_id is null
     or discovered_actor.membership_id is null
     or discovered_actor.environment_id is null then
    raise exception 'Google Admin ownership approver is unavailable'
      using errcode = '42501';
  end if;

  perform 1
  from private.admin_principals as principal
  where principal.id in (discovered_actor.principal_id, target_principal_id)
  order by principal.id
  for update;

  select principal.*
  into actor_principal
  from private.admin_principals as principal
  where principal.id = discovered_actor.principal_id;
  select principal.*
  into target_principal_row
  from private.admin_principals as principal
  where principal.id = target_principal_id;

  perform 1
  from private.admin_environment_memberships as membership
  where membership.id in (
    discovered_actor.membership_id,
    target_membership_id
  )
  order by membership.id
  for update;

  select membership.*
  into actor_membership
  from private.admin_environment_memberships as membership
  where membership.id = discovered_actor.membership_id;
  select membership.*
  into target_membership_row
  from private.admin_environment_memberships as membership
  where membership.id = target_membership_id;

  select environment.*
  into environment_row
  from private.admin_environments as environment
  where environment.id = target_environment_id
  for share;

  select session.*
  into actor_session
  from public.admin_sessions as session
  where session.id = target_approved_by_admin_session_id
  for update;

  select lecture.*
  into lecture_row
  from public.lecture_sessions as lecture
  where lecture.id = target_lecture_session_id
  for share;

  if actor_principal.id is null
     or actor_principal.status <> 'active'
     or actor_membership.id is null
     or actor_membership.environment_id <> target_environment_id
     or actor_membership.principal_id <> actor_principal.id
     or actor_membership.role <> 'owner'
     or actor_membership.status <> 'active'
     or (
       actor_membership.expires_at is not null
       and actor_membership.expires_at <= effective_now
     )
     or environment_row.id is null
     or environment_row.status <> 'active'
     or environment_row.current_deployment is not true
     or actor_session.id is null
     or actor_session.principal_id <> actor_principal.id
     or actor_session.membership_id <> actor_membership.id
     or actor_session.environment_id <> target_environment_id
     or actor_session.authentication_method <> 'google_totp'
     or actor_session.aal <> 2
     or actor_session.revoked_at is not null
     or actor_session.expires_at <= effective_now
     or actor_session.idle_expires_at <= effective_now then
    raise exception 'Google Admin ownership approver is not an active owner'
      using errcode = '42501';
  end if;

  if target_principal_row.id is null
     or target_principal_row.status <> 'active'
     or target_membership_row.id is null
     or target_membership_row.environment_id <> target_environment_id
     or target_membership_row.principal_id <> target_principal_id
     or target_membership_row.status <> 'active'
     or (
       target_membership_row.expires_at is not null
       and target_membership_row.expires_at <= effective_now
     ) then
    raise exception 'Google Admin ownership target is not active'
      using errcode = '42501';
  end if;

  if lecture_row.id is null then
    raise exception 'Lecture is unavailable' using errcode = 'P0002';
  end if;
  if exists (
    select 1
    from private.admin_lecture_ownerships as ownership
    where ownership.lecture_session_id = target_lecture_session_id
  ) then
    raise exception 'Lecture already has ownership authority'
      using errcode = 'P7335';
  end if;

  insert into private.admin_lecture_ownership_claim_approvals (
    id,
    approval_request_id,
    environment_id,
    lecture_session_id,
    principal_id,
    membership_id,
    approved_by_admin_session_id,
    expected_lecture_status,
    expected_lifecycle_version,
    mapping_evidence_digest,
    approval_intent_digest,
    operator_actor,
    reason,
    approved_at,
    expires_at
  ) values (
    target_approval_id,
    target_approval_request_id,
    target_environment_id,
    target_lecture_session_id,
    target_principal_id,
    target_membership_id,
    target_approved_by_admin_session_id,
    lecture_row.status,
    lecture_row.lifecycle_version,
    target_mapping_evidence_digest,
    intent_digest,
    target_operator_actor,
    target_reason,
    effective_now,
    target_expires_at
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
    metadata
  ) values (
    target_approval_request_id,
    target_environment_id,
    actor_principal.id,
    actor_membership.id,
    actor_session.id,
    'admin_cutover.approve_lecture_ownership',
    'lecture_session',
    target_lecture_session_id::text,
    'accepted',
    jsonb_build_object(
      'approval_id', target_approval_id,
      'evidence_digest', target_mapping_evidence_digest,
      'expected_lifecycle_version', lecture_row.lifecycle_version,
      'expected_status', lecture_row.status
    )
  );

  return jsonb_build_object(
    'approvalId', target_approval_id,
    'environmentId', target_environment_id,
    'expiresAt', target_expires_at,
    'lectureSessionId', target_lecture_session_id,
    'membershipId', target_membership_id,
    'ok', true,
    'principalId', target_principal_id,
    'replayed', false
  );
end;
$$;

revoke all on function private.approve_google_admin_lecture_ownership_claim_v1(
  uuid, uuid, uuid, uuid, uuid, uuid, uuid, text, text, text, timestamptz
) from public, anon, authenticated, service_role;

create function private.claim_approved_google_admin_lecture_ownership_v1(
  target_approval_id uuid,
  target_request_id uuid
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
  effective_now timestamptz := statement_timestamp();
  intent_digest text;
  discovered_approval record;
  approval_row private.admin_lecture_ownership_claim_approvals%rowtype;
  receipt_row private.admin_lecture_ownership_claim_receipts%rowtype;
  actor_session public.admin_sessions%rowtype;
  actor_principal private.admin_principals%rowtype;
  actor_membership private.admin_environment_memberships%rowtype;
  target_principal_row private.admin_principals%rowtype;
  target_membership_row private.admin_environment_memberships%rowtype;
  environment_row private.admin_environments%rowtype;
  lecture_row public.lecture_sessions%rowtype;
  gate_row private.admin_identity_runtime_gate%rowtype;
begin
  if target_approval_id is null or target_request_id is null then
    raise exception 'Google Admin lecture ownership claim is invalid'
      using errcode = '22023';
  end if;

  select
    approval.environment_id,
    approval.approved_by_admin_session_id
  into discovered_approval
  from private.admin_lecture_ownership_claim_approvals as approval
  where approval.id = target_approval_id;

  if not found then
    raise exception 'Google Admin lecture ownership approval is unavailable'
      using errcode = 'P0002';
  end if;

  intent_digest := pg_catalog.encode(
    extensions.digest(
      pg_catalog.convert_to(
        target_approval_id::text || '|' || target_request_id::text,
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );

  perform private.serialize_admin_ai_scope_v1(
    'admin-ledger-environment',
    discovered_approval.environment_id
  );
  perform private.serialize_admin_ai_request_v1(target_request_id);

  select receipt.*
  into receipt_row
  from private.admin_lecture_ownership_claim_receipts as receipt
  where receipt.request_id = target_request_id
  for share;

  if found then
    if receipt_row.approval_id <> target_approval_id
       or receipt_row.intent_digest <> intent_digest then
      raise exception 'Google Admin lecture ownership claim collided'
        using errcode = 'P7335';
    end if;
    return jsonb_build_object(
      'approvalId', receipt_row.approval_id,
      'environmentId', receipt_row.environment_id,
      'lectureSessionId', receipt_row.lecture_session_id,
      'membershipId', receipt_row.membership_id,
      'ok', true,
      'principalId', receipt_row.principal_id,
      'replayed', true,
      'requestId', receipt_row.request_id
    );
  end if;

  if exists (
    select 1
    from private.admin_identity_cutover_receipts
  ) then
    raise exception 'Google-only Admin cutover already committed'
      using errcode = 'P7335';
  end if;

  select approval.*
  into approval_row
  from private.admin_lecture_ownership_claim_approvals as approval
  where approval.id = target_approval_id
  for update;

  if not found
     or approval_row.environment_id <> discovered_approval.environment_id
     or approval_row.expires_at <= effective_now then
    raise exception 'Google Admin lecture ownership approval is unavailable'
      using errcode = 'P0002';
  end if;

  -- Freeze every legacy descendant writer before taking identity/lecture row
  -- locks. The cutover transaction uses the same table-first order and NOWAIT
  -- turns incomplete quiescence into a full, retryable transaction failure.
  lock table
    public.lecture_ai_master_authorizations,
    public.ai_billing_grants,
    public.ai_usage_ledger,
    public.lecture_summary_runs,
    public.academic_answer_requests,
    public.lecture_pdf_publications
  in share row exclusive mode nowait;

  select session.*
  into actor_session
  from public.admin_sessions as session
  where session.id = approval_row.approved_by_admin_session_id;

  if not found
     or actor_session.principal_id is null
     or actor_session.membership_id is null
     or actor_session.environment_id is null then
    raise exception 'Google Admin ownership approver is unavailable'
      using errcode = '42501';
  end if;

  perform 1
  from private.admin_principals as principal
  where principal.id in (actor_session.principal_id, approval_row.principal_id)
  order by principal.id
  for update;

  select principal.*
  into actor_principal
  from private.admin_principals as principal
  where principal.id = actor_session.principal_id;
  select principal.*
  into target_principal_row
  from private.admin_principals as principal
  where principal.id = approval_row.principal_id;

  perform 1
  from private.admin_environment_memberships as membership
  where membership.id in (
    actor_session.membership_id,
    approval_row.membership_id
  )
  order by membership.id
  for update;

  select membership.*
  into actor_membership
  from private.admin_environment_memberships as membership
  where membership.id = actor_session.membership_id;
  select membership.*
  into target_membership_row
  from private.admin_environment_memberships as membership
  where membership.id = approval_row.membership_id;

  select environment.*
  into environment_row
  from private.admin_environments as environment
  where environment.id = approval_row.environment_id
  for share;

  select session.*
  into actor_session
  from public.admin_sessions as session
  where session.id = approval_row.approved_by_admin_session_id
  for update;

  if actor_session.supabase_auth_session_id is null
     or not exists (
       select 1
       from auth.sessions as auth_session
       where auth_session.id = actor_session.supabase_auth_session_id
       for key share
     ) then
    raise exception 'Google Admin ownership approver Auth session is unavailable'
      using errcode = '42501';
  end if;

  select gate.*
  into gate_row
  from private.admin_identity_runtime_gate as gate
  where gate.singleton
  for share;

  select lecture.*
  into lecture_row
  from public.lecture_sessions as lecture
  where lecture.id = approval_row.lecture_session_id
  for update;

  if actor_principal.id is null
     or actor_principal.status <> 'active'
     or actor_membership.id is null
     or actor_membership.environment_id <> approval_row.environment_id
     or actor_membership.principal_id <> actor_principal.id
     or actor_membership.role <> 'owner'
     or actor_membership.status <> 'active'
     or (
       actor_membership.expires_at is not null
       and actor_membership.expires_at <= effective_now
     )
     or environment_row.id is null
     or environment_row.status <> 'active'
     or environment_row.current_deployment is not true
     or actor_session.id is null
     or actor_session.principal_id <> actor_principal.id
     or actor_session.membership_id <> actor_membership.id
     or actor_session.environment_id <> approval_row.environment_id
     or actor_session.authentication_method <> 'google_totp'
     or actor_session.aal <> 2
     or actor_session.revoked_at is not null
     or actor_session.expires_at <= effective_now
     or actor_session.idle_expires_at <= effective_now then
    raise exception 'Google Admin ownership approver is not an active owner'
      using errcode = '42501';
  end if;

  if target_principal_row.id is null
     or target_principal_row.status <> 'active'
     or target_membership_row.id is null
     or target_membership_row.environment_id <> approval_row.environment_id
     or target_membership_row.principal_id <> approval_row.principal_id
     or target_membership_row.status <> 'active'
     or (
       target_membership_row.expires_at is not null
       and target_membership_row.expires_at <= effective_now
     ) then
    raise exception 'Google Admin ownership target is not active'
      using errcode = '42501';
  end if;

  if gate_row.singleton is null
     or gate_row.google_session_issue_enabled is not true
     or gate_row.google_operational_authorization_enabled is not true
     or gate_row.google_admin_ledger_enabled is not true then
    raise exception 'Google Admin ownership admission is disabled'
      using errcode = 'P7337';
  end if;

  if lecture_row.id is null
     or lecture_row.status <> approval_row.expected_lecture_status
     or lecture_row.lifecycle_version <> approval_row.expected_lifecycle_version then
    raise exception 'Approved lecture snapshot changed'
      using errcode = 'P7335';
  end if;

  if exists (
    select 1
    from private.admin_lecture_ownerships as ownership
    where ownership.lecture_session_id = approval_row.lecture_session_id
  ) then
    raise exception 'Lecture already has ownership authority'
      using errcode = 'P7335';
  end if;

  if exists (
    select 1
    from public.lecture_ai_master_authorizations as master_authorization
    where master_authorization.lecture_session_id = approval_row.lecture_session_id
      and master_authorization.status = 'active'
      and master_authorization.principal_id is null
  ) or exists (
    select 1
    from public.ai_billing_grants as grant_row
    where grant_row.lecture_session_id = approval_row.lecture_session_id
      and grant_row.status = 'issued'
      and not exists (
        select 1
        from private.admin_google_ai_child_grant_receipts as receipt
        where receipt.grant_id = grant_row.id
      )
  ) or exists (
    select 1
    from public.ai_usage_ledger as usage_row
    where usage_row.lecture_session_id = approval_row.lecture_session_id
      and usage_row.status = 'running'
      and not exists (
        select 1
        from private.admin_google_ai_provider_start_receipts as receipt
        where receipt.operation_id = usage_row.id
      )
  ) or exists (
    select 1
    from public.lecture_summary_runs as run_row
    where run_row.lecture_session_id = approval_row.lecture_session_id
      and run_row.status = 'running'
      and not exists (
        select 1
        from private.admin_google_summary_run_receipts as receipt
        where receipt.run_id = run_row.id
      )
  ) or exists (
    select 1
    from public.academic_answer_requests as request_row
    where request_row.lecture_session_id = approval_row.lecture_session_id
      and request_row.status in ('evidence_checking', 'running')
      and not exists (
        select 1
        from private.admin_google_academic_answer_preflight_receipts as receipt
        where receipt.academic_request_id = request_row.id
      )
  ) or exists (
    select 1
    from public.lecture_pdf_publications as publication
    where publication.lecture_session_id = approval_row.lecture_session_id
      and publication.state in ('pending', 'uploaded', 'committed', 'active')
      and not exists (
        select 1
        from private.admin_google_pdf_publication_bindings as binding
        where binding.publication_id = publication.id
      )
  ) then
    raise exception 'Lecture retains unresolved legacy Admin authority'
      using errcode = 'P7335';
  end if;

  insert into private.admin_lecture_ownerships (
    lecture_session_id,
    environment_id,
    principal_id,
    membership_id,
    assigned_by_admin_session_id,
    ownership_request_id,
    ownership_intent_digest,
    ownership_source,
    ownership_approval_id,
    assigned_at
  ) values (
    approval_row.lecture_session_id,
    approval_row.environment_id,
    approval_row.principal_id,
    approval_row.membership_id,
    actor_session.id,
    target_request_id,
    intent_digest,
    'operator_claim',
    approval_row.id,
    effective_now
  );

  insert into private.admin_lecture_ownership_claim_receipts (
    request_id,
    approval_id,
    intent_digest,
    environment_id,
    lecture_session_id,
    principal_id,
    membership_id,
    actor_principal_id,
    actor_membership_id,
    actor_admin_session_id,
    ownership_source,
    claimed_at
  ) values (
    target_request_id,
    approval_row.id,
    intent_digest,
    approval_row.environment_id,
    approval_row.lecture_session_id,
    approval_row.principal_id,
    approval_row.membership_id,
    actor_principal.id,
    actor_membership.id,
    actor_session.id,
    'operator_claim',
    effective_now
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
    metadata
  ) values (
    target_request_id,
    approval_row.environment_id,
    actor_principal.id,
    actor_membership.id,
    actor_session.id,
    'admin_cutover.claim_lecture_ownership',
    'lecture_session',
    approval_row.lecture_session_id::text,
    'accepted',
    jsonb_build_object(
      'approval_id', approval_row.id,
      'ownership_source', 'operator_claim'
    )
  );

  return jsonb_build_object(
    'approvalId', approval_row.id,
    'environmentId', approval_row.environment_id,
    'lectureSessionId', approval_row.lecture_session_id,
    'membershipId', approval_row.membership_id,
    'ok', true,
    'principalId', approval_row.principal_id,
    'replayed', false,
    'requestId', target_request_id
  );
end;
$$;

revoke all on function private.claim_approved_google_admin_lecture_ownership_v1(
  uuid, uuid
) from public, anon, authenticated, service_role;

create or replace function private.get_admin_identity_runtime_gate_v1()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'google_admin_ledger_enabled', gate.google_admin_ledger_enabled,
    'google_only_admin_cutover_committed', exists (
      select 1 from private.admin_identity_cutover_receipts
    ),
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

create function private.hold_legacy_admin_session_gate_v1()
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  legacy_enabled boolean := false;
begin
  select gate.legacy_pin_login_enabled
  into legacy_enabled
  from private.admin_identity_runtime_gate as gate
  where gate.singleton
  for share;

  return coalesce(legacy_enabled, false)
    and not exists (select 1 from private.admin_identity_cutover_receipts);
end;
$$;

revoke all on function private.hold_legacy_admin_session_gate_v1()
  from public, anon, authenticated;
grant execute on function private.hold_legacy_admin_session_gate_v1()
  to service_role;

create function private.enforce_google_only_admin_gate_tombstone_v1()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from private.admin_identity_cutover_receipts) then
    if tg_op = 'DELETE' then
      raise exception 'Google-only Admin identity cutover is immutable'
        using errcode = 'P7335';
    end if;
    if old.legacy_pin_login_enabled is false
       and new.legacy_pin_login_enabled is true then
      raise exception 'Legacy Admin PIN admission cannot be re-enabled'
        using errcode = 'P7335';
    end if;
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create trigger admin_identity_runtime_gate_google_only_tombstone
before update or delete on private.admin_identity_runtime_gate
for each row execute function private.enforce_google_only_admin_gate_tombstone_v1();

revoke all on function private.enforce_google_only_admin_gate_tombstone_v1()
  from public, anon, authenticated, service_role;

create function private.enforce_google_only_admin_session_fence_v1()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  legacy_enabled boolean := false;
  cutover_committed boolean := false;
begin
  select
    gate.legacy_pin_login_enabled,
    exists (select 1 from private.admin_identity_cutover_receipts)
  into legacy_enabled, cutover_committed
  from private.admin_identity_runtime_gate as gate
  where gate.singleton
  for share;

  if legacy_enabled is true and cutover_committed is false then
    if tg_op = 'DELETE' then
      return old;
    end if;
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.authentication_method = 'legacy_pin' then
      raise exception 'Legacy Admin session issuance is disabled'
        using errcode = 'P7335';
    end if;
    return new;
  end if;

  if tg_op = 'DELETE' then
    if old.authentication_method = 'legacy_pin' then
      raise exception 'Legacy Admin session evidence cannot be deleted'
        using errcode = 'P7335';
    end if;
    return old;
  end if;

  if old.authentication_method <> 'legacy_pin'
     and new.authentication_method <> 'legacy_pin' then
    return new;
  end if;

  if old.authentication_method <> new.authentication_method then
    raise exception 'Legacy Admin session authority cannot be relabeled'
      using errcode = 'P7335';
  end if;

  if old.revoked_at is null
     and new.revoked_at is not null
     and new.revoke_reason is not null
     and new.updated_at >= old.updated_at
     and (
       pg_catalog.to_jsonb(new) - array[
         'revoked_at', 'revoke_reason', 'updated_at'
       ]::text[]
     ) = (
       pg_catalog.to_jsonb(old) - array[
         'revoked_at', 'revoke_reason', 'updated_at'
       ]::text[]
     ) then
    return new;
  end if;

  raise exception 'Legacy Admin session authority is fenced'
    using errcode = 'P7335';
end;
$$;

create trigger admin_sessions_google_only_admin_fence
before insert or update or delete on public.admin_sessions
for each row execute function private.enforce_google_only_admin_session_fence_v1();

revoke all on function private.enforce_google_only_admin_session_fence_v1()
  from public, anon, authenticated, service_role;

create or replace function public.verify_and_touch_admin_session(
  target_session_id uuid,
  target_token_hash text,
  target_pin_version_hash text
)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  session_row public.admin_sessions%rowtype;
  effective_now timestamptz := statement_timestamp();
  rejection_reason text;
begin
  if private.hold_legacy_admin_session_gate_v1() is not true then
    return null;
  end if;

  if target_token_hash !~ '^[0-9a-f]{64}$'
     or target_pin_version_hash !~ '^[0-9a-f]{64}$' then
    return null;
  end if;

  select session.*
  into session_row
  from public.admin_sessions as session
  where session.id = target_session_id
    and session.token_hash = target_token_hash
    and session.authentication_method = 'legacy_pin'
    and session.aal = 1
    and session.pin_version_hash is not null
  for update;

  if not found then
    return null;
  end if;

  rejection_reason := case
    when session_row.revoked_at is not null then session_row.revoke_reason
    when session_row.pin_version_hash <> target_pin_version_hash then 'pin_rotated'
    when session_row.expires_at <= effective_now then 'absolute_expiry'
    when session_row.idle_expires_at <= effective_now then 'inactivity_expiry'
    else null
  end;

  if rejection_reason is not null then
    if session_row.revoked_at is null then
      update public.admin_sessions
      set
        revoked_at = effective_now,
        revoke_reason = rejection_reason,
        updated_at = effective_now
      where id = session_row.id;
    end if;
    return null;
  end if;

  if session_row.last_seen_at <= effective_now - interval '5 minutes' then
    update public.admin_sessions
    set
      last_seen_at = effective_now,
      idle_expires_at = least(expires_at, effective_now + interval '30 minutes'),
      updated_at = effective_now
    where id = session_row.id
    returning * into session_row;
  end if;

  return jsonb_build_object(
    'auth_user_id', session_row.auth_user_id,
    'expires_at', session_row.expires_at,
    'id', session_row.id,
    'idle_expires_at', session_row.idle_expires_at,
    'last_seen_at', session_row.last_seen_at
  );
end;
$$;

create function private.get_google_only_admin_cutover_preflight_v1(
  target_environment_id uuid
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'activeLegacyMasterCount', (
      select pg_catalog.count(*)
      from public.lecture_ai_master_authorizations as master_authorization
      where master_authorization.status = 'active'
        and master_authorization.principal_id is null
    ),
    'activeLegacySessionCount', (
      select pg_catalog.count(*)
      from public.admin_sessions as session
      where session.authentication_method = 'legacy_pin'
        and session.revoked_at is null
    ),
    'activeOwnerCount', (
      select pg_catalog.count(*)
      from private.admin_environment_memberships as membership
      join private.admin_principals as principal
        on principal.id = membership.principal_id
      where membership.environment_id = target_environment_id
        and membership.role = 'owner'
        and membership.status = 'active'
        and (
          membership.expires_at is null
          or membership.expires_at > statement_timestamp()
        )
        and principal.status = 'active'
    ),
    'authoritative', false,
    'cutoverCommitted', exists (
      select 1 from private.admin_identity_cutover_receipts
    ),
    'environmentReady', exists (
      select 1
      from private.admin_environments as environment
      where environment.id = target_environment_id
        and environment.status = 'active'
        and environment.current_deployment
    ),
    'externalTransportAttestationRequired', true,
    'googleAdminLedgerEnabled', coalesce((
      select gate.google_admin_ledger_enabled
      from private.admin_identity_runtime_gate as gate
      where gate.singleton
    ), false),
    'googleOperationalAuthorizationEnabled', coalesce((
      select gate.google_operational_authorization_enabled
      from private.admin_identity_runtime_gate as gate
      where gate.singleton
    ), false),
    'googleSessionIssueEnabled', coalesce((
      select gate.google_session_issue_enabled
      from private.admin_identity_runtime_gate as gate
      where gate.singleton
    ), false),
    'issuedLegacyGrantCount', (
      select pg_catalog.count(*)
      from public.ai_billing_grants as grant_row
      where grant_row.status = 'issued'
        and not exists (
          select 1
          from private.admin_google_ai_child_grant_receipts as receipt
          where receipt.grant_id = grant_row.id
        )
    ),
    'pendingLegacyAcademicCount', (
      select pg_catalog.count(*)
      from public.academic_answer_requests as request_row
      where request_row.status in ('evidence_checking', 'running')
        and not exists (
          select 1
          from private.admin_google_academic_answer_preflight_receipts as receipt
          where receipt.academic_request_id = request_row.id
        )
    ),
    'runningLegacySummaryCount', (
      select pg_catalog.count(*)
      from public.lecture_summary_runs as run_row
      where run_row.status = 'running'
        and not exists (
          select 1
          from private.admin_google_summary_run_receipts as receipt
          where receipt.run_id = run_row.id
        )
    ),
    'runningLegacyUsageCount', (
      select pg_catalog.count(*)
      from public.ai_usage_ledger as usage_row
      where usage_row.status = 'running'
        and not exists (
          select 1
          from private.admin_google_ai_provider_start_receipts as receipt
          where receipt.operation_id = usage_row.id
        )
    ),
    'unboundPdfPublicationCount', (
      select pg_catalog.count(*)
      from public.lecture_pdf_publications as publication
      where publication.state in ('pending', 'uploaded', 'committed', 'active')
        and not exists (
          select 1
          from private.admin_google_pdf_publication_bindings as binding
          where binding.publication_id = publication.id
        )
    ),
    'unownedActiveLectureCount', (
      select pg_catalog.count(*)
      from public.lecture_sessions as lecture
      where lecture.status in ('draft', 'open')
        and not exists (
          select 1
          from private.admin_lecture_ownerships as ownership
          where ownership.lecture_session_id = lecture.id
            and ownership.environment_id = target_environment_id
        )
    )
  );
$$;

revoke all on function private.get_google_only_admin_cutover_preflight_v1(uuid)
  from public, anon, authenticated, service_role;

create function private.commit_google_only_admin_cutover_v1(
  target_environment_id uuid,
  target_request_id uuid,
  target_operator_actor text,
  target_reason text,
  target_deployment_evidence_digest text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
set statement_timeout = '15s'
set lock_timeout = '750ms'
as $$
declare
  effective_now timestamptz := statement_timestamp();
  intent_digest text;
  operator_actor_digest text;
  reason_digest text;
  gate_row private.admin_identity_runtime_gate%rowtype;
  environment_row private.admin_environments%rowtype;
  receipt_row private.admin_identity_cutover_receipts%rowtype;
  legacy_session_row record;
  active_owner_count integer := 0;
  revoked_legacy_session_count integer := 0;
  invalid_active_ownership_count integer := 0;
  unowned_active_lecture_count integer := 0;
  active_legacy_session_count integer := 0;
  active_legacy_master_count integer := 0;
  issued_legacy_grant_count integer := 0;
  running_legacy_usage_count integer := 0;
  running_legacy_summary_count integer := 0;
  pending_legacy_academic_count integer := 0;
  unbound_pdf_publication_count integer := 0;
begin
  if target_environment_id is null
     or target_request_id is null
     or target_operator_actor is null
     or target_operator_actor <> pg_catalog.btrim(target_operator_actor)
     or pg_catalog.char_length(target_operator_actor) not between 3 and 160
     or target_reason is null
     or target_reason <> pg_catalog.btrim(target_reason)
     or pg_catalog.char_length(target_reason) not between 3 and 500
     or target_deployment_evidence_digest is null
     or target_deployment_evidence_digest !~ '^[0-9a-f]{64}$' then
    raise exception 'Google-only Admin cutover request is invalid'
      using errcode = '22023';
  end if;

  operator_actor_digest := pg_catalog.encode(
    extensions.digest(
      pg_catalog.convert_to(target_operator_actor, 'UTF8'),
      'sha256'
    ),
    'hex'
  );
  reason_digest := pg_catalog.encode(
    extensions.digest(
      pg_catalog.convert_to(target_reason, 'UTF8'),
      'sha256'
    ),
    'hex'
  );
  intent_digest := pg_catalog.encode(
    extensions.digest(
      pg_catalog.convert_to(
        target_environment_id::text || '|' || target_request_id::text || '|' ||
        operator_actor_digest || '|' || reason_digest || '|' ||
        target_deployment_evidence_digest,
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );

  perform private.serialize_admin_ai_scope_v1(
    'admin-ledger-environment',
    target_environment_id
  );
  perform private.serialize_admin_ai_request_v1(target_request_id);

  select receipt.*
  into receipt_row
  from private.admin_identity_cutover_receipts as receipt
  where receipt.request_id = target_request_id
  for share;

  if found then
    if receipt_row.environment_id <> target_environment_id
       or receipt_row.intent_digest <> intent_digest
       or receipt_row.deployment_evidence_digest <>
         target_deployment_evidence_digest then
      raise exception 'Google-only Admin cutover request collided'
        using errcode = 'P7335';
    end if;
    return jsonb_build_object(
      'activeOwnerCount', receipt_row.active_owner_count,
      'committedAt', receipt_row.committed_at,
      'environmentId', receipt_row.environment_id,
      'ok', true,
      'replayed', true,
      'requestId', receipt_row.request_id,
      'revokedLegacySessionCount',
        receipt_row.revoked_legacy_session_count
    );
  end if;

  if pg_catalog.current_setting('transaction_isolation') <> 'serializable' then
    raise exception 'Google-only Admin cutover requires SERIALIZABLE isolation'
      using errcode = '25001';
  end if;

  lock table
    private.admin_identity_runtime_gate,
    private.admin_identity_cutover_receipts,
    private.admin_environments,
    private.admin_principals,
    private.admin_environment_memberships,
    public.admin_sessions,
    public.lecture_sessions,
    private.admin_lecture_ownerships,
    public.lecture_ai_master_authorizations,
    public.ai_billing_grants,
    public.ai_usage_ledger,
    public.lecture_summary_runs,
    public.academic_answer_requests,
    public.lecture_pdf_publications,
    private.admin_google_ai_child_grant_receipts,
    private.admin_google_ai_provider_start_receipts,
    private.admin_google_summary_run_receipts,
    private.admin_google_academic_answer_preflight_receipts,
    private.admin_google_pdf_publication_bindings
  in access exclusive mode nowait;

  select receipt.*
  into receipt_row
  from private.admin_identity_cutover_receipts as receipt
  limit 1;
  if found then
    raise exception 'Google-only Admin identity cutover already committed'
      using errcode = 'P7335';
  end if;

  select gate.*
  into gate_row
  from private.admin_identity_runtime_gate as gate
  where gate.singleton
  for update;
  select environment.*
  into environment_row
  from private.admin_environments as environment
  where environment.id = target_environment_id
  for update;

  if gate_row.singleton is null
     or gate_row.legacy_pin_login_enabled is not true
     or gate_row.google_session_issue_enabled is not true
     or gate_row.google_operational_authorization_enabled is not true
     or gate_row.google_admin_ledger_enabled is not true
     or environment_row.id is null
     or environment_row.status <> 'active'
     or environment_row.current_deployment is not true then
    raise exception 'Google-only Admin cutover gates are not ready'
      using errcode = 'P7337';
  end if;

  select pg_catalog.count(*)::integer
  into active_owner_count
  from private.admin_environment_memberships as membership
  join private.admin_principals as principal
    on principal.id = membership.principal_id
  where membership.environment_id = target_environment_id
    and membership.role = 'owner'
    and membership.status = 'active'
    and (
      membership.expires_at is null
      or membership.expires_at > effective_now
    )
    and principal.status = 'active';

  if active_owner_count < 2 then
    raise exception 'Google-only Admin cutover requires two active owners'
      using errcode = 'P7310';
  end if;

  select pg_catalog.count(*)::integer
  into unowned_active_lecture_count
  from public.lecture_sessions as lecture
  where lecture.status in ('draft', 'open')
    and not exists (
      select 1
      from private.admin_lecture_ownerships as ownership
      where ownership.lecture_session_id = lecture.id
        and ownership.environment_id = target_environment_id
    );

  select pg_catalog.count(*)::integer
  into invalid_active_ownership_count
  from public.lecture_sessions as lecture
  join private.admin_lecture_ownerships as ownership
    on ownership.lecture_session_id = lecture.id
  left join private.admin_principals as principal
    on principal.id = ownership.principal_id
  left join private.admin_environment_memberships as membership
    on membership.id = ownership.membership_id
  where lecture.status in ('draft', 'open')
    and (
      ownership.environment_id <> target_environment_id
      or principal.id is null
      or principal.status <> 'active'
      or membership.id is null
      or membership.environment_id <> target_environment_id
      or membership.principal_id <> ownership.principal_id
      or membership.status <> 'active'
      or (
        membership.expires_at is not null
        and membership.expires_at <= effective_now
      )
    );

  if unowned_active_lecture_count <> 0
     or invalid_active_ownership_count <> 0 then
    raise exception 'Active lectures require valid Google ownership evidence'
      using errcode = 'P7335';
  end if;

  update private.admin_identity_runtime_gate
  set
    legacy_pin_login_enabled = false,
    updated_at = effective_now
  where singleton;

  for legacy_session_row in
    select session.id
    from public.admin_sessions as session
    where session.authentication_method = 'legacy_pin'
      and session.revoked_at is null
    order by session.id
    for update
  loop
    update public.admin_sessions
    set
      revoked_at = effective_now,
      revoke_reason = 'google_only_cutover',
      updated_at = effective_now
    where id = legacy_session_row.id;
    revoked_legacy_session_count := revoked_legacy_session_count + 1;
  end loop;

  select pg_catalog.count(*)::integer
  into active_legacy_session_count
  from public.admin_sessions as session
  where session.authentication_method = 'legacy_pin'
    and session.revoked_at is null;

  select pg_catalog.count(*)::integer
  into active_legacy_master_count
  from public.lecture_ai_master_authorizations as master_authorization
  where master_authorization.status = 'active'
    and master_authorization.principal_id is null;

  select pg_catalog.count(*)::integer
  into issued_legacy_grant_count
  from public.ai_billing_grants as grant_row
  where grant_row.status = 'issued'
    and not exists (
      select 1
      from private.admin_google_ai_child_grant_receipts as receipt
      where receipt.grant_id = grant_row.id
    );

  select pg_catalog.count(*)::integer
  into running_legacy_usage_count
  from public.ai_usage_ledger as usage_row
  where usage_row.status = 'running'
    and not exists (
      select 1
      from private.admin_google_ai_provider_start_receipts as receipt
      where receipt.operation_id = usage_row.id
    );

  select pg_catalog.count(*)::integer
  into running_legacy_summary_count
  from public.lecture_summary_runs as run_row
  where run_row.status = 'running'
    and not exists (
      select 1
      from private.admin_google_summary_run_receipts as receipt
      where receipt.run_id = run_row.id
    );

  select pg_catalog.count(*)::integer
  into pending_legacy_academic_count
  from public.academic_answer_requests as request_row
  where request_row.status in ('evidence_checking', 'running')
    and not exists (
      select 1
      from private.admin_google_academic_answer_preflight_receipts as receipt
      where receipt.academic_request_id = request_row.id
    );

  select pg_catalog.count(*)::integer
  into unbound_pdf_publication_count
  from public.lecture_pdf_publications as publication
  where publication.state in ('pending', 'uploaded', 'committed', 'active')
    and not exists (
      select 1
      from private.admin_google_pdf_publication_bindings as binding
      where binding.publication_id = publication.id
    );

  if active_legacy_session_count <> 0
     or active_legacy_master_count <> 0
     or issued_legacy_grant_count <> 0
     or running_legacy_usage_count <> 0
     or running_legacy_summary_count <> 0
     or pending_legacy_academic_count <> 0
     or unbound_pdf_publication_count <> 0 then
    raise exception 'Legacy Admin descendants must be terminal before cutover'
      using errcode = 'P7335';
  end if;

  execute 'revoke execute on function public.verify_and_touch_admin_session(uuid, text, text) from service_role';

  insert into private.admin_identity_cutover_receipts (
    singleton,
    request_id,
    environment_id,
    intent_digest,
    deployment_evidence_digest,
    operator_actor,
    reason,
    active_owner_count,
    revoked_legacy_session_count,
    committed_at
  ) values (
    true,
    target_request_id,
    target_environment_id,
    intent_digest,
    target_deployment_evidence_digest,
    target_operator_actor,
    target_reason,
    active_owner_count,
    revoked_legacy_session_count,
    effective_now
  );

  insert into private.admin_audit_events (
    request_id,
    environment_id,
    action,
    target_type,
    target_id,
    result,
    metadata
  ) values (
    target_request_id,
    target_environment_id,
    'admin_cutover.commit_google_only_identity',
    'admin_environment',
    target_environment_id::text,
    'accepted',
    jsonb_build_object(
      'active_owner_count', active_owner_count,
      'deployment_evidence_digest', target_deployment_evidence_digest,
      'revoked_legacy_session_count', revoked_legacy_session_count
    )
  );

  return jsonb_build_object(
    'activeOwnerCount', active_owner_count,
    'committedAt', effective_now,
    'environmentId', target_environment_id,
    'ok', true,
    'replayed', false,
    'requestId', target_request_id,
    'revokedLegacySessionCount', revoked_legacy_session_count
  );
end;
$$;

revoke all on function private.commit_google_only_admin_cutover_v1(
  uuid, uuid, text, text, text
) from public, anon, authenticated, service_role;

create function private.enforce_active_admin_lecture_ownership_v1()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if new.status not in ('draft', 'open')
     or not exists (
       select 1 from private.admin_identity_cutover_receipts
     ) then
    return new;
  end if;

  if not exists (
    select 1
    from private.admin_lecture_ownerships as ownership
    join private.admin_identity_cutover_receipts as cutover
      on cutover.environment_id = ownership.environment_id
    where ownership.lecture_session_id = new.id
  ) then
    raise exception 'Active lecture requires Google Admin ownership authority'
      using errcode = 'P7335';
  end if;

  return new;
end;
$$;

create constraint trigger lecture_sessions_google_only_active_ownership
after insert or update on public.lecture_sessions
deferrable initially deferred
for each row execute function private.enforce_active_admin_lecture_ownership_v1();

revoke all on function private.enforce_active_admin_lecture_ownership_v1()
  from public, anon, authenticated, service_role;
