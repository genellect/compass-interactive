-- Final lecture UX: exact Display lifetime, delivery observability and
-- version-vector invalidation.

-- The durable lecture snapshot remains authoritative. Realtime carries only
-- identifiers and monotonically increasing versions; it never duplicates
-- captions, comments, polls, PDF metadata or other classroom content.

alter table public.display_realtime_sessions
  add column connected_at timestamptz,
  add column last_heartbeat_at timestamptz,
  add column last_applied_display_version bigint check (
    last_applied_display_version is null
    or last_applied_display_version >= 0
  ),
  add column last_rendered_page integer check (
    last_rendered_page is null or last_rendered_page >= 1
  ),
  add column connection_generation integer not null default 0 check (
    connection_generation between 0 and 2147483647
  ),
  add constraint display_realtime_sessions_delivery_status_check check (
    (
      connection_generation = 0
      and connected_at is null
      and last_heartbeat_at is null
      and last_applied_display_version is null
      and last_rendered_page is null
    )
    or (
      connection_generation >= 1
      and connected_at is not null
      and last_heartbeat_at is not null
      and connected_at <= last_heartbeat_at
      and last_applied_display_version is not null
      and last_rendered_page is not null
    )
  );

comment on column public.display_realtime_sessions.connected_at is
  'First server-confirmed render time for the current Display connection generation.';
comment on column public.display_realtime_sessions.last_heartbeat_at is
  'Last authenticated heartbeat from the exact claimed anonymous Display UID.';
comment on column public.display_realtime_sessions.last_applied_display_version is
  'Authoritative display_version whose page was last confirmed rendered.';
comment on column public.display_realtime_sessions.last_rendered_page is
  'Authoritative PDF page last confirmed rendered by the claimed Display.';
comment on column public.display_realtime_sessions.connection_generation is
  'Monotonic same-tab connection generation used to fence stale reloads.';

-- Clamp every existing binding before adding the stronger root invariant.
-- The public Realtime binding is never allowed to outlive its private root.
update private.admin_google_display_sessions as binding
set
  expires_at = least(
    binding.expires_at,
    binding.hard_stop_at,
    binding.issued_at + interval '90 minutes'
  ),
  updated_at = statement_timestamp()
where binding.expires_at > least(
  binding.hard_stop_at,
  binding.issued_at + interval '90 minutes'
);

update public.display_realtime_sessions as binding
set
  expires_at = least(
    binding.expires_at,
    binding.hard_stop_at,
    binding.issued_at + interval '90 minutes',
    coalesce(
      (
        select root.expires_at
        from private.admin_google_display_sessions as root
        where root.id = binding.id
          and root.token_jti_hash = binding.token_jti_hash
      ),
      'infinity'::timestamptz
    )
  ),
  updated_at = statement_timestamp()
where binding.expires_at > least(
  binding.hard_stop_at,
  binding.issued_at + interval '90 minutes',
  coalesce(
    (
      select root.expires_at
      from private.admin_google_display_sessions as root
      where root.id = binding.id
        and root.token_jti_hash = binding.token_jti_hash
    ),
    'infinity'::timestamptz
  )
);

alter table private.admin_google_display_sessions
  add column revoked_at timestamptz,
  add column revoke_reason text,
  add constraint admin_google_display_sessions_revocation_pair_check check (
    (revoked_at is null and revoke_reason is null)
    or (revoked_at is not null and revoke_reason is not null)
  ),
  add constraint admin_google_display_sessions_exact_hard_stop_check check (
    expires_at <= hard_stop_at
    and expires_at <= issued_at + interval '90 minutes'
  );

with ranked as (
  select
    binding.id,
    row_number() over (
      partition by binding.lecture_session_id
      order by binding.issued_at desc, binding.id desc
    ) as issuance_rank
  from private.admin_google_display_sessions as binding
)
update private.admin_google_display_sessions as binding
set
  revoked_at = statement_timestamp(),
  revoke_reason = 'session_replaced',
  updated_at = statement_timestamp()
from ranked
where ranked.id = binding.id
  and ranked.issuance_rank > 1;

-- A Display URL is a live-lecture capability, never an archive credential.
-- Revoke roots carried into this migration if their lecture already ended or
-- their hard stop elapsed before the final lifetime invariant was installed.
update private.admin_google_display_sessions as binding
set
  revoked_at = statement_timestamp(),
  revoke_reason = case
    when lecture.status <> 'open' or lecture.closed_at is not null
      then 'lecture_closed'
    else 'hard_stop'
  end,
  updated_at = statement_timestamp()
from public.lecture_sessions as lecture
where lecture.id = binding.lecture_session_id
  and binding.revoked_at is null
  and (
    lecture.status <> 'open'
    or lecture.closed_at is not null
    or lecture.hard_stop_at is null
    or lecture.hard_stop_at <= statement_timestamp()
  );

update public.display_realtime_sessions as binding
set
  revoked_at = coalesce(binding.revoked_at, statement_timestamp()),
  revoke_reason = 'session_replaced',
  updated_at = statement_timestamp()
from private.admin_google_display_sessions as root
where root.id = binding.id
  and root.revoked_at is not null
  and (
    binding.revoked_at is null
    or binding.revoke_reason = 'feature_disabled'
  );

create unique index admin_google_display_sessions_one_live_lecture_idx
  on private.admin_google_display_sessions (lecture_session_id)
  where revoked_at is null;

-- Preserve recognized=true for replaced capabilities so they can never fall
-- through to the legacy verifier. Only the public service facade is callable.
create or replace function private.verify_and_claim_google_display_session_v1(
  target_token_jti_hash text,
  target_lecture_session_id uuid,
  target_display_auth_user_id uuid
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
  binding_snapshot private.admin_google_display_sessions%rowtype;
  binding private.admin_google_display_sessions%rowtype;
  lecture_row public.lecture_sessions%rowtype;
  admin_snapshot public.admin_sessions%rowtype;
  admin_row public.admin_sessions%rowtype;
  principal_row private.admin_principals%rowtype;
  membership_row private.admin_environment_memberships%rowtype;
  environment_row private.admin_environments%rowtype;
  auth_session_row auth.sessions%rowtype;
  realtime_binding public.display_realtime_sessions%rowtype;
  display_gate_enabled boolean := false;
  live_factor_set_hash text;
  live_factor_count integer;
  effective_now timestamptz := statement_timestamp();
begin
  if target_token_jti_hash is null
     or target_token_jti_hash !~ '^[0-9a-f]{64}$'
     or target_lecture_session_id is null
     or target_display_auth_user_id is null then
    return jsonb_build_object('recognized', false, 'valid', false);
  end if;

  select session.*
  into binding_snapshot
  from private.admin_google_display_sessions as session
  where session.token_jti_hash = target_token_jti_hash
    and session.lecture_session_id = target_lecture_session_id;
  if not found then
    return jsonb_build_object('recognized', false, 'valid', false);
  end if;

  if binding_snapshot.realtime_enabled then
    select gate.enabled
    into display_gate_enabled
    from private.display_realtime_runtime_gate as gate
    where gate.singleton
    for share;
    if not found then
      return jsonb_build_object(
        'reason', 'inactive',
        'recognized', true,
        'realtimeEnabled', true,
        'valid', false
      );
    end if;
  end if;

  select session.*
  into admin_snapshot
  from public.admin_sessions as session
  where session.id = binding_snapshot.admin_session_id
    and session.auth_user_id = binding_snapshot.admin_auth_user_id;
  if not found then
    return jsonb_build_object(
      'reason', 'inactive',
      'recognized', true,
      'realtimeEnabled', binding_snapshot.realtime_enabled,
      'valid', false
    );
  end if;

  -- Display consumers use the same canonical identity ordering as Google Admin
  -- operations, but SHARE locks keep concurrent read-only classroom displays
  -- from serializing on one principal. Factor/session mutations take UPDATE
  -- locks and therefore linearize before or after this validation.
  select principal.*
  into principal_row
  from private.admin_principals as principal
  where principal.id = admin_snapshot.principal_id
    and principal.auth_user_id = binding_snapshot.admin_auth_user_id
  for share;

  if principal_row.id is not null then
    select membership.*
    into membership_row
    from private.admin_environment_memberships as membership
    where membership.id = admin_snapshot.membership_id
      and membership.principal_id = principal_row.id
      and membership.environment_id = admin_snapshot.environment_id
    for share;
  end if;

  if membership_row.id is not null then
    select environment.*
    into environment_row
    from private.admin_environments as environment
    where environment.id = membership_row.environment_id
    for share;
  end if;

  select session.*
  into admin_row
  from public.admin_sessions as session
  where session.id = admin_snapshot.id
    and session.auth_user_id = binding_snapshot.admin_auth_user_id
    and session.principal_id = principal_row.id
    and session.membership_id = membership_row.id
    and session.environment_id = environment_row.id
    and session.supabase_auth_session_id = admin_snapshot.supabase_auth_session_id
  for share;

  if admin_row.supabase_auth_session_id is not null then
    select session.*
    into auth_session_row
    from auth.sessions as session
    where session.id = admin_row.supabase_auth_session_id
      and session.user_id = binding_snapshot.admin_auth_user_id
    for key share;
  end if;

  if principal_row.id is not null then
    select snapshot.factor_set_hash, snapshot.factor_count
    into live_factor_set_hash, live_factor_count
    from private.current_verified_totp_factor_set_snapshot_v1(
      binding_snapshot.admin_auth_user_id
    ) as snapshot;
  end if;

  select lecture.*
  into lecture_row
  from public.lecture_sessions as lecture
  where lecture.id = binding_snapshot.lecture_session_id
  for share;

  if binding_snapshot.realtime_enabled then
    select session.*
    into realtime_binding
    from public.display_realtime_sessions as session
    where session.id = binding_snapshot.id
      and session.token_jti_hash = target_token_jti_hash
      and session.lecture_session_id = target_lecture_session_id
      and session.admin_session_id = binding_snapshot.admin_session_id
      and session.admin_auth_user_id = binding_snapshot.admin_auth_user_id
    for update;
    if not found then
      return jsonb_build_object(
        'reason', 'inactive',
        'recognized', true,
        'realtimeEnabled', true,
        'valid', false
      );
    end if;
  end if;

  select session.*
  into binding
  from private.admin_google_display_sessions as session
  where session.id = binding_snapshot.id
    and session.token_jti_hash = target_token_jti_hash
    and session.lecture_session_id = target_lecture_session_id
    and session.admin_session_id = binding_snapshot.admin_session_id
    and session.admin_auth_user_id = binding_snapshot.admin_auth_user_id
    and session.issued_at = binding_snapshot.issued_at
    and session.expires_at = binding_snapshot.expires_at
    and session.hard_stop_at = binding_snapshot.hard_stop_at
    and session.realtime_enabled = binding_snapshot.realtime_enabled
  for update;
  if not found then
    return jsonb_build_object(
      'reason', 'inactive',
      'recognized', true,
      'valid', false
    );
  end if;

  -- Revocation is authoritative only after the exact root row is locked.
  -- This closes the claim-versus-reissue race before either UID can be bound.
  if binding.revoked_at is not null then
    return jsonb_build_object(
      'reason', coalesce(binding.revoke_reason, 'inactive'),
      'recognized', true,
      'realtimeEnabled', binding.realtime_enabled,
      'valid', false
    );
  end if;

  if binding.expires_at <= effective_now
     or binding.hard_stop_at <= effective_now
     or lecture_row.id is null
     or lecture_row.status <> 'open'
     or lecture_row.started_at is null
     or lecture_row.closed_at is not null
     or lecture_row.hard_stop_at is null
     or lecture_row.hard_stop_at <= effective_now
     or admin_row.id is null
     or admin_row.authentication_method <> 'google_totp'
     or admin_row.aal <> 2
     or admin_row.auth_user_id <> binding.admin_auth_user_id
     or admin_row.step_up_verified_at is null
     or admin_row.revoked_at is not null
     or admin_row.expires_at <= effective_now
     or admin_row.idle_expires_at <= effective_now
     or auth_session_row.id is null
     or auth_session_row.created_at + interval '8 hours' <= effective_now
     or principal_row.id is null
     or principal_row.status <> 'active'
     or principal_row.approved_totp_factor_set_hash is null
     or principal_row.approved_totp_factor_count < 1
     or membership_row.id is null
     or membership_row.status <> 'active'
     or (
       membership_row.expires_at is not null
       and membership_row.expires_at <= effective_now
     )
     or environment_row.id is null
     or environment_row.status <> 'active'
     or not environment_row.current_deployment
     or live_factor_set_hash is null
     or live_factor_set_hash is distinct from
       principal_row.approved_totp_factor_set_hash
     or live_factor_count <> principal_row.approved_totp_factor_count
     or admin_row.verified_totp_factor_set_hash is distinct from
       live_factor_set_hash
     or (
       binding.realtime_enabled
       and (
         realtime_binding.id is null
         or realtime_binding.issued_at < binding.issued_at
         or realtime_binding.issued_at >=
           binding.issued_at + interval '1 second'
         or realtime_binding.expires_at > binding.expires_at
         or realtime_binding.hard_stop_at is distinct from binding.hard_stop_at
         or realtime_binding.expires_at <= effective_now
         or realtime_binding.hard_stop_at <= effective_now
         or (
           display_gate_enabled
           and realtime_binding.revoked_at is not null
         )
         or (
           not display_gate_enabled
           and (
             realtime_binding.revoked_at is null
             or realtime_binding.revoke_reason <> 'feature_disabled'
           )
         )
       )
     ) then
    return jsonb_build_object(
      'reason', 'inactive',
      'recognized', true,
      'realtimeEnabled', binding.realtime_enabled,
      'valid', false
    );
  end if;

  if (
       binding.display_auth_user_id is not null
       and binding.display_auth_user_id <> target_display_auth_user_id
     )
     or (
       binding.realtime_enabled
       and realtime_binding.display_auth_user_id is not null
       and realtime_binding.display_auth_user_id <> target_display_auth_user_id
     )
     or (
       binding.realtime_enabled
       and binding.display_auth_user_id is not null
       and realtime_binding.display_auth_user_id is not null
       and binding.display_auth_user_id <>
         realtime_binding.display_auth_user_id
     ) then
    return jsonb_build_object(
      'reason', 'claimed_by_other',
      'recognized', true,
      'realtimeEnabled', binding.realtime_enabled,
      'valid', false
    );
  end if;

  if binding.realtime_enabled
     and realtime_binding.display_auth_user_id is null then
    update public.display_realtime_sessions
    set
      display_auth_user_id = target_display_auth_user_id,
      claimed_at = effective_now,
      updated_at = effective_now
    where id = realtime_binding.id
      and display_auth_user_id is null
    returning * into realtime_binding;
    if not found then
      raise exception 'Google Display Realtime claim did not converge'
        using errcode = 'P7335';
    end if;
  end if;

  if binding.display_auth_user_id is null then
    update private.admin_google_display_sessions
    set
      display_auth_user_id = target_display_auth_user_id,
      claimed_at = effective_now,
      updated_at = effective_now
    where id = binding.id
      and display_auth_user_id is null
    returning * into binding;
    if not found then
      raise exception 'Google Display claim did not converge'
        using errcode = 'P7335';
    end if;
  end if;

  return jsonb_build_object(
    'recognized', true,
    'realtime', case
      when binding.realtime_enabled then jsonb_build_object(
        'expires_at', realtime_binding.expires_at,
        'hard_stop_at', realtime_binding.hard_stop_at,
        'lecture_session_id', realtime_binding.lecture_session_id,
        'session_id', realtime_binding.id,
        'status', 'claimed',
        'topic', realtime_binding.topic
      )
      else 'null'::jsonb
    end,
    'realtimeAvailable',
      binding.realtime_enabled and display_gate_enabled,
    'realtimeEnabled', binding.realtime_enabled,
    'valid', true
  );
end;
$$;

revoke all on function private.verify_and_claim_google_display_session_v1(
  text, uuid, uuid
) from public, anon, authenticated, service_role;

create or replace function public.verify_and_claim_google_display_session_v1(
  target_token_jti_hash text,
  target_lecture_session_id uuid,
  target_display_auth_user_id uuid
)
returns jsonb
language sql
volatile
security definer
set search_path = ''
as $$
  select private.verify_and_claim_google_display_session_v1(
    target_token_jti_hash,
    target_lecture_session_id,
    target_display_auth_user_id
  );
$$;

revoke all on function public.verify_and_claim_google_display_session_v1(
  text, uuid, uuid
) from public, anon, authenticated;
grant execute on function public.verify_and_claim_google_display_session_v1(
  text, uuid, uuid
) to service_role;

-- Existing public-row revocation triggers run first. These alphabetically-last
-- companion triggers then tombstone snapshot and Realtime roots alike.
create function private.revoke_google_display_roots_for_lecture_v1()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if new.status = 'open'
     and new.closed_at is null
     and new.hard_stop_at is not null
     and new.hard_stop_at > statement_timestamp() then
    return new;
  end if;

  update private.admin_google_display_sessions
  set
    revoked_at = statement_timestamp(),
    revoke_reason = case
      when new.status <> 'open' or new.closed_at is not null
        then 'lecture_closed'
      else 'hard_stop'
    end,
    updated_at = statement_timestamp()
  where lecture_session_id = new.id
    and revoked_at is null;

  return new;
end;
$$;

revoke all on function private.revoke_google_display_roots_for_lecture_v1()
  from public, anon, authenticated, service_role;

create trigger lecture_sessions_revoke_zz_google_display_roots
after update of status, closed_at, hard_stop_at on public.lecture_sessions
for each row execute function private.revoke_google_display_roots_for_lecture_v1();

create function private.revoke_google_display_roots_for_admin_v1()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if old.revoked_at is not null or new.revoked_at is null then
    return new;
  end if;

  update private.admin_google_display_sessions
  set
    revoked_at = statement_timestamp(),
    revoke_reason = 'admin_session_revoked',
    updated_at = statement_timestamp()
  where admin_session_id = new.id
    and revoked_at is null;

  return new;
end;
$$;

revoke all on function private.revoke_google_display_roots_for_admin_v1()
  from public, anon, authenticated, service_role;

create trigger admin_sessions_revoke_zz_google_display_roots
after update of revoked_at on public.admin_sessions
for each row execute function private.revoke_google_display_roots_for_admin_v1();

create or replace function private.verify_google_display_terminal_session_v1(
  target_token_jti_hash text,
  target_lecture_session_id uuid,
  target_display_auth_user_id uuid,
  target_token_issued_at timestamptz,
  target_token_expires_at timestamptz
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
  binding private.admin_google_display_sessions%rowtype;
begin
  if target_token_jti_hash is null
     or target_token_jti_hash !~ '^[0-9a-f]{64}$'
     or target_lecture_session_id is null
     or target_display_auth_user_id is null
     or target_token_issued_at is null
     or target_token_expires_at is null
     or target_token_issued_at >= target_token_expires_at then
    return jsonb_build_object('recognized', false, 'valid', false);
  end if;

  select session.*
  into binding
  from private.admin_google_display_sessions as session
  where session.token_jti_hash = target_token_jti_hash
    and session.lecture_session_id = target_lecture_session_id
    and session.issued_at = target_token_issued_at
    and session.expires_at = target_token_expires_at
  for update;

  if not found then
    return jsonb_build_object('recognized', false, 'valid', false);
  end if;

  -- Kept only as a fail-closed compatibility facade for an in-flight older
  -- Edge deployment. Final Display URLs cannot downgrade to archive access.
  return jsonb_build_object(
    'reason', coalesce(binding.revoke_reason, 'terminal_disabled'),
    'recognized', true,
    'valid', false
  );
end;
$$;

revoke all on function private.verify_google_display_terminal_session_v1(
  text, uuid, uuid, timestamptz, timestamptz
) from public, anon, authenticated, service_role;

create or replace function public.verify_google_display_terminal_session_v1(
  target_token_jti_hash text,
  target_lecture_session_id uuid,
  target_display_auth_user_id uuid,
  target_token_issued_at timestamptz,
  target_token_expires_at timestamptz
)
returns jsonb
language sql
volatile
security definer
set search_path = ''
as $$
  select private.verify_google_display_terminal_session_v1(
    target_token_jti_hash,
    target_lecture_session_id,
    target_display_auth_user_id,
    target_token_issued_at,
    target_token_expires_at
  );
$$;

revoke all on function public.verify_google_display_terminal_session_v1(
  text, uuid, uuid, timestamptz, timestamptz
) from public, anon, authenticated;
grant execute on function public.verify_google_display_terminal_session_v1(
  text, uuid, uuid, timestamptz, timestamptz
) to service_role;

-- Status is a read-only, gate-independent Admin operation. It exposes only
-- delivery metadata for the owned lecture.
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
) values (
  'display-session-status.status',
  'display-session-status',
  'status',
  'owned_lecture',
  'retained',
  'gate_independent',
  'read',
  false,
  false,
  false
);

-- Recreate the existing issuance transaction with the approved exact lifetime:
-- no independent 95-minute token and no five-minute hard-stop grace.

create or replace function private.issue_google_admin_display_session_v1(
  target_token_hash text,
  target_auth_user_id uuid,
  target_supabase_auth_session_id uuid,
  target_google_issuer text,
  target_provider_subject_hmac text,
  target_subject_pepper_version integer,
  target_transport_enabled boolean,
  target_request_id uuid,
  target_lecture_session_id uuid,
  target_enable_realtime boolean
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
  operation_key_value constant text := 'issue-display-session.issue';
  context_value jsonb;
  receipt_row private.admin_google_operation_receipts%rowtype;
  lecture_row public.lecture_sessions%rowtype;
  display_gate_enabled boolean;
  existing public.display_realtime_sessions%rowtype;
  registered public.display_realtime_sessions%rowtype;
  payload_digest_value text;
  intent_digest_value text;
  token_jti_hash_value text;
  display_session_id uuid := target_request_id;
  display_topic text;
  token_issued_epoch bigint;
  token_expires_epoch bigint;
  realtime_expiry timestamptz;
  result_metadata_value jsonb;
  effective_now timestamptz := statement_timestamp();
begin
  if target_request_id is null
     or target_lecture_session_id is null
     or target_enable_realtime is null
     or target_transport_enabled is null then
    return null;
  end if;

  perform private.serialize_admin_ai_request_v1(target_request_id);

  -- The legacy registration order is Display gate -> Admin session ->
  -- lecture. Acquire the singleton first for realtime issuance so staged
  -- legacy and Google requests cannot create an inverse lock edge. Exact
  -- replay still takes this short lock, but never requires the gate to be ON.
  if target_enable_realtime then
    select gate.enabled
    into display_gate_enabled
    from private.display_realtime_runtime_gate as gate
    where gate.singleton
    for update;
    if not found then
      return null;
    end if;
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

  payload_digest_value := encode(
    extensions.digest(
      convert_to(
        'phase730c2:display-session:v1'
        || '|realtime=' || target_enable_realtime::text,
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
    case when target_enable_realtime then 'realtime' else 'snapshot' end,
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
       and receipt_row.target_id = (
         case when target_enable_realtime then 'realtime' else 'snapshot' end
       )
       and receipt_row.result_id = target_request_id::text then
      if (target_enable_realtime and not display_gate_enabled)
         or not exists (
           select 1
           from private.admin_google_display_sessions as root
           join public.lecture_sessions as lecture
             on lecture.id = root.lecture_session_id
           where root.id = target_request_id
             and root.lecture_session_id = target_lecture_session_id
             and root.revoked_at is null
             and root.expires_at > effective_now
             and root.hard_stop_at > effective_now
             and lecture.status = 'open'
             and lecture.started_at is not null
             and lecture.closed_at is null
             and lecture.hard_stop_at > effective_now
             and (
               not target_enable_realtime
               or exists (
                 select 1
                 from public.display_realtime_sessions as realtime_binding
                 where realtime_binding.id = root.id
                   and realtime_binding.token_jti_hash = root.token_jti_hash
                   and realtime_binding.revoked_at is null
                   and realtime_binding.expires_at > effective_now
                   and realtime_binding.hard_stop_at > effective_now
               )
             )
         ) then
        raise exception 'Display-session replay is no longer active'
          using errcode = 'P7335';
      end if;
      return receipt_row.result_metadata || jsonb_build_object(
        'idempotentReplay', true,
        'ok', true
      );
    end if;
    raise exception 'Display-session request binding does not match its receipt'
      using errcode = 'P7335';
  end if;

  perform private.assert_google_admin_operation_gate_v1(
    context_value,
    target_transport_enabled
  );
  perform private.assert_google_admin_operation_lecture_state_v1(context_value);

  select lecture.*
  into lecture_row
  from public.lecture_sessions as lecture
  where lecture.id = target_lecture_session_id
  for update;
  if not found
     or lecture_row.status <> 'open'
     or lecture_row.started_at is null
     or lecture_row.closed_at is not null
     or lecture_row.hard_stop_at is null
     or lecture_row.hard_stop_at <= effective_now then
    raise exception 'Lecture is not open for Display issuance'
      using errcode = 'P7335';
  end if;

  token_issued_epoch := floor(extract(epoch from effective_now))::bigint;
  token_expires_epoch := least(
    token_issued_epoch + 90 * 60,
    floor(extract(epoch from lecture_row.hard_stop_at))::bigint,
    floor(extract(epoch from
      (context_value ->> 'expires_at')::timestamptz))::bigint
  );
  if token_expires_epoch <= token_issued_epoch then
    raise exception 'Display-session authorization has expired'
      using errcode = 'P7335';
  end if;

  token_jti_hash_value := encode(
    extensions.digest(
      convert_to(target_request_id::text, 'UTF8'),
      'sha256'
    ),
    'hex'
  );
  display_topic := 'display:' || target_lecture_session_id::text || ':' ||
    display_session_id::text;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'display-realtime:' || target_lecture_session_id::text,
      0
    )
  );

  -- Every new URL replaces every earlier Display capability for this lecture,
  -- regardless of whether either issuance requested Realtime.
  for existing in
    select session.*
    from public.display_realtime_sessions as session
    where session.lecture_session_id = target_lecture_session_id
      and (
        session.revoked_at is null
        or session.revoke_reason = 'feature_disabled'
      )
    order by session.id
    for update
  loop
    begin
      perform realtime.send(
        jsonb_build_object(
          'lectureSessionId', target_lecture_session_id,
          'reason', 'session_replaced',
          'sentAt', effective_now
        ),
        'session_closed',
        existing.topic,
        true
      );
    exception when others then
      null;
    end;

    update public.display_realtime_sessions
    set
      revoked_at = coalesce(revoked_at, effective_now),
      revoke_reason = 'session_replaced',
      updated_at = effective_now
    where id = existing.id
      and (
        revoked_at is null
        or revoke_reason = 'feature_disabled'
      );
  end loop;

  update private.admin_google_display_sessions
  set
    revoked_at = effective_now,
    revoke_reason = 'session_replaced',
    updated_at = effective_now
  where lecture_session_id = target_lecture_session_id
    and revoked_at is null;

  if target_enable_realtime then
    if not display_gate_enabled then
      raise exception 'Display Realtime is disabled'
        using errcode = 'P7335';
    end if;

    realtime_expiry := least(
      to_timestamp(token_expires_epoch),
      lecture_row.hard_stop_at,
      (context_value ->> 'expires_at')::timestamptz
    );
    if realtime_expiry <= effective_now then
      raise exception 'Display Realtime authorization has expired'
        using errcode = 'P7335';
    end if;

    insert into public.display_realtime_sessions (
      id,
      lecture_session_id,
      token_jti_hash,
      topic,
      admin_session_id,
      admin_auth_user_id,
      issued_at,
      expires_at,
      hard_stop_at
    ) values (
      display_session_id,
      target_lecture_session_id,
      token_jti_hash_value,
      display_topic,
      (context_value ->> 'admin_session_id')::uuid,
      target_auth_user_id,
      effective_now,
      realtime_expiry,
      lecture_row.hard_stop_at
    )
    returning * into registered;
    if registered.id is null then
      raise exception 'Display Realtime registration did not converge'
        using errcode = 'P7335';
    end if;
  end if;

  insert into private.admin_google_display_sessions (
    id,
    token_jti_hash,
    lecture_session_id,
    admin_session_id,
    admin_auth_user_id,
    realtime_enabled,
    issued_at,
    expires_at,
    hard_stop_at
  ) values (
    display_session_id,
    token_jti_hash_value,
    target_lecture_session_id,
    (context_value ->> 'admin_session_id')::uuid,
    target_auth_user_id,
    target_enable_realtime,
    to_timestamp(token_issued_epoch),
    to_timestamp(token_expires_epoch),
    lecture_row.hard_stop_at
  );

  result_metadata_value := jsonb_build_object(
    'displaySessionId', display_session_id,
    'expiresAtEpoch', token_expires_epoch,
    'issuedAtEpoch', token_issued_epoch,
    'realtime', case
      when target_enable_realtime then jsonb_build_object(
        'expiresAt', registered.expires_at,
        'sessionId', registered.id,
        'topic', registered.topic
      )
      else 'null'::jsonb
    end
  );

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
    case when target_enable_realtime then 'realtime' else 'snapshot' end,
    display_session_id::text,
    'issued',
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
    'admin_display_session.issue',
    'lecture_session',
    target_lecture_session_id::text,
    'accepted',
    'google_admin_operation',
    jsonb_build_object(
      'operation_key', operation_key_value,
      'realtime_enabled', target_enable_realtime
    )
  );

  return result_metadata_value || jsonb_build_object(
    'idempotentReplay', false,
    'ok', true
  );
end;
$$;

create function private.ack_display_realtime_delivery_v1(
  target_token_jti_hash text,
  target_lecture_session_id uuid,
  target_display_auth_user_id uuid,
  target_session_id uuid,
  target_connection_generation integer,
  target_action text,
  target_display_updated_at timestamptz default null,
  target_rendered_page integer default null
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
  binding public.display_realtime_sessions%rowtype;
  live_row public.lecture_live_state%rowtype;
  effective_now timestamptz := statement_timestamp();
begin
  if target_token_jti_hash is null
     or target_token_jti_hash !~ '^[0-9a-f]{64}$'
     or target_lecture_session_id is null
     or target_display_auth_user_id is null
     or target_session_id is null
     or target_connection_generation is null
     or target_connection_generation not between 1 and 2147483647
     or target_action not in ('heartbeat', 'rendered')
     or (
       target_action = 'rendered'
       and (
         target_display_updated_at is null
         or target_rendered_page is null
         or target_rendered_page < 1
       )
     )
     or (
       target_action = 'heartbeat'
       and (
         target_display_updated_at is not null
         or target_rendered_page is not null
       )
     ) then
    return jsonb_build_object('status', 'invalid');
  end if;

  select session.*
  into binding
  from private.display_realtime_runtime_gate as gate
  join public.display_realtime_sessions as session
    on gate.singleton
  join private.admin_google_display_sessions as root
    on root.id = session.id
    and root.token_jti_hash = session.token_jti_hash
    and root.lecture_session_id = session.lecture_session_id
    and root.admin_session_id = session.admin_session_id
    and root.admin_auth_user_id = session.admin_auth_user_id
  join public.lecture_sessions as lecture
    on lecture.id = session.lecture_session_id
  join public.admin_sessions as admin_session
    on admin_session.id = session.admin_session_id
  where gate.enabled
    and session.id = target_session_id
    and session.token_jti_hash = target_token_jti_hash
    and session.lecture_session_id = target_lecture_session_id
    and session.display_auth_user_id = target_display_auth_user_id
    and session.revoked_at is null
    and session.expires_at > effective_now
    and session.hard_stop_at > effective_now
    and root.realtime_enabled
    and root.revoked_at is null
    and root.display_auth_user_id = target_display_auth_user_id
    and root.expires_at > effective_now
    and root.hard_stop_at > effective_now
    and lecture.status = 'open'
    and lecture.started_at is not null
    and lecture.closed_at is null
    and lecture.hard_stop_at > effective_now
    and admin_session.auth_user_id = session.admin_auth_user_id
    and admin_session.revoked_at is null
    and admin_session.expires_at > effective_now
    and admin_session.idle_expires_at > effective_now
  for update of session;

  if not found then
    return jsonb_build_object('status', 'inactive');
  end if;

  if target_connection_generation < binding.connection_generation then
    return jsonb_build_object('status', 'stale_generation');
  end if;

  if target_action = 'heartbeat' then
    if binding.connected_at is null
       or target_connection_generation <> binding.connection_generation then
      return jsonb_build_object('status', 'render_required');
    end if;

    update public.display_realtime_sessions
    set
      last_heartbeat_at = effective_now,
      updated_at = effective_now
    where id = binding.id;

    return jsonb_build_object(
      'display_version', binding.last_applied_display_version,
      'rendered_page', binding.last_rendered_page,
      'server_time', effective_now,
      'status', 'accepted'
    );
  end if;

  select live.*
  into live_row
  from public.lecture_live_state as live
  where live.lecture_session_id = target_lecture_session_id
  for share;

  if not found
     or live_row.updated_at is distinct from target_display_updated_at
     or live_row.current_pdf_page <> target_rendered_page then
    return jsonb_build_object('status', 'snapshot_stale');
  end if;

  update public.display_realtime_sessions
  set
    connected_at = case
      when connection_generation < target_connection_generation
        then effective_now
      else coalesce(connected_at, effective_now)
    end,
    last_heartbeat_at = effective_now,
    last_applied_display_version = live_row.display_version,
    last_rendered_page = target_rendered_page,
    connection_generation = target_connection_generation,
    updated_at = effective_now
  where id = binding.id;

  return jsonb_build_object(
    'display_version', live_row.display_version,
    'rendered_page', target_rendered_page,
    'server_time', effective_now,
    'status', 'accepted'
  );
end;
$$;

revoke all on function private.ack_display_realtime_delivery_v1(
  text, uuid, uuid, uuid, integer, text, timestamptz, integer
) from public, anon, authenticated, service_role;

create function public.ack_display_realtime_delivery_v1(
  target_token_jti_hash text,
  target_lecture_session_id uuid,
  target_display_auth_user_id uuid,
  target_session_id uuid,
  target_connection_generation integer,
  target_action text,
  target_display_updated_at timestamptz default null,
  target_rendered_page integer default null
)
returns jsonb
language sql
volatile
security definer
set search_path = ''
as $$
  select private.ack_display_realtime_delivery_v1(
    target_token_jti_hash,
    target_lecture_session_id,
    target_display_auth_user_id,
    target_session_id,
    target_connection_generation,
    target_action,
    target_display_updated_at,
    target_rendered_page
  );
$$;

revoke all on function public.ack_display_realtime_delivery_v1(
  text, uuid, uuid, uuid, integer, text, timestamptz, integer
) from public, anon, authenticated;
grant execute on function public.ack_display_realtime_delivery_v1(
  text, uuid, uuid, uuid, integer, text, timestamptz, integer
) to service_role;

create function private.get_google_admin_display_session_status_v1(
  target_token_hash text,
  target_auth_user_id uuid,
  target_supabase_auth_session_id uuid,
  target_google_issuer text,
  target_provider_subject_hmac text,
  target_subject_pepper_version integer,
  target_transport_enabled boolean,
  target_display_realtime_enabled boolean,
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
  operation_key_value constant text := 'display-session-status.status';
  context_value jsonb;
  binding public.display_realtime_sessions%rowtype;
  root_row private.admin_google_display_sessions%rowtype;
  live_row public.lecture_live_state%rowtype;
  gate_enabled boolean := false;
  delivery_state text;
  effective_now timestamptz := statement_timestamp();
begin
  if target_transport_enabled is null
     or target_display_realtime_enabled is null
     or target_lecture_session_id is null then
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

  select coalesce(gate.enabled, false)
  into gate_enabled
  from private.display_realtime_runtime_gate as gate
  where gate.singleton;

  select root.*
  into root_row
  from private.admin_google_display_sessions as root
  where root.lecture_session_id = target_lecture_session_id
    and root.admin_auth_user_id = target_auth_user_id
    and root.admin_session_id =
      (context_value ->> 'admin_session_id')::uuid
  order by root.issued_at desc, root.id desc
  limit 1;

  if not found or not root_row.realtime_enabled then
    return jsonb_build_object(
      'ok', true,
      'runtime_enabled',
        gate_enabled
        and target_transport_enabled
        and target_display_realtime_enabled,
      'server_time', effective_now,
      'session', 'null'::jsonb
    );
  end if;

  select session.*
  into binding
  from public.display_realtime_sessions as session
  where session.id = root_row.id
    and session.token_jti_hash = root_row.token_jti_hash
    and session.lecture_session_id = root_row.lecture_session_id;

  if not found then
    return jsonb_build_object(
      'ok', true,
      'runtime_enabled',
        gate_enabled
        and target_transport_enabled
        and target_display_realtime_enabled,
      'server_time', effective_now,
      'session', 'null'::jsonb
    );
  end if;

  select live.*
  into live_row
  from public.lecture_live_state as live
  where live.lecture_session_id = target_lecture_session_id;

  delivery_state := case
    when root_row.revoked_at is not null
      or binding.revoked_at is not null
      or binding.expires_at <= effective_now
      or binding.hard_stop_at <= effective_now
      or (context_value ->> 'lecture_status') <> 'open'
      or (context_value ->> 'lecture_hard_stop_at')::timestamptz <=
        effective_now
      then 'ended'
    when binding.connected_at is null then 'waiting'
    when binding.last_heartbeat_at is null
      or binding.last_heartbeat_at <= effective_now - interval '25 seconds'
      then 'reconnecting'
    when live_row.lecture_session_id is not null
      and binding.last_applied_display_version = live_row.display_version
      and binding.last_rendered_page = live_row.current_pdf_page
      then 'synced'
    else 'connected'
  end;

  return jsonb_build_object(
    'ok', true,
    'runtime_enabled',
      gate_enabled
      and target_transport_enabled
      and target_display_realtime_enabled,
    'server_time', effective_now,
    'session', jsonb_build_object(
      'connected_at', binding.connected_at,
      'connection_generation', binding.connection_generation,
      'current_display_version', live_row.display_version,
      'current_page', live_row.current_pdf_page,
      'expires_at', binding.expires_at,
      'hard_stop_at', binding.hard_stop_at,
      'last_applied_display_version',
        binding.last_applied_display_version,
      'last_heartbeat_at', binding.last_heartbeat_at,
      'last_rendered_page', binding.last_rendered_page,
      'revoke_reason', binding.revoke_reason,
      'revoked_at', binding.revoked_at,
      'session_id', binding.id,
      'state', delivery_state
    )
  );
end;
$$;

revoke all on function private.get_google_admin_display_session_status_v1(
  text, uuid, uuid, text, text, integer, boolean, boolean, uuid
) from public, anon, authenticated, service_role;

create function public.get_google_admin_display_session_status_v1(
  target_token_hash text,
  target_auth_user_id uuid,
  target_supabase_auth_session_id uuid,
  target_google_issuer text,
  target_provider_subject_hmac text,
  target_subject_pepper_version integer,
  target_transport_enabled boolean,
  target_display_realtime_enabled boolean,
  target_lecture_session_id uuid
)
returns jsonb
language sql
volatile
security definer
set search_path = ''
as $$
  select private.get_google_admin_display_session_status_v1(
    target_token_hash,
    target_auth_user_id,
    target_supabase_auth_session_id,
    target_google_issuer,
    target_provider_subject_hmac,
    target_subject_pepper_version,
    target_transport_enabled,
    target_display_realtime_enabled,
    target_lecture_session_id
  );
$$;

revoke all on function public.get_google_admin_display_session_status_v1(
  text, uuid, uuid, text, text, integer, boolean, boolean, uuid
) from public, anon, authenticated;
grant execute on function public.get_google_admin_display_session_status_v1(
  text, uuid, uuid, text, text, integer, boolean, boolean, uuid
) to service_role;

create function private.broadcast_display_live_state_changed_v1()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  binding record;
  change_kinds text[] := array[]::text[];
begin
  if not coalesce((
    select gate.enabled
    from private.display_realtime_runtime_gate as gate
    where gate.singleton
  ), false) then
    return new;
  end if;

  if new.lecture_version is distinct from old.lecture_version then
    change_kinds := array_append(change_kinds, 'lecture');
  end if;
  if new.caption_version is distinct from old.caption_version then
    change_kinds := array_append(change_kinds, 'caption');
  end if;
  if new.visible_comments_version is distinct from
     old.visible_comments_version then
    change_kinds := array_append(change_kinds, 'comments');
  end if;
  if new.likes_version is distinct from old.likes_version then
    change_kinds := array_append(change_kinds, 'likes');
  end if;
  if new.polls_version is distinct from old.polls_version then
    change_kinds := array_append(change_kinds, 'polls');
  end if;
  if new.summaries_version is distinct from old.summaries_version then
    change_kinds := array_append(change_kinds, 'summaries');
  end if;
  if new.pdf_version is distinct from old.pdf_version then
    change_kinds := array_append(change_kinds, 'pdf');
  end if;
  if new.display_version is distinct from old.display_version then
    change_kinds := array_append(change_kinds, 'display');
  end if;
  if new.metrics_version is distinct from old.metrics_version then
    change_kinds := array_append(change_kinds, 'metrics');
  end if;

  if cardinality(change_kinds) = 0 then
    return new;
  end if;

  for binding in
    select session.id, session.topic
    from public.display_realtime_sessions as session
    join public.lecture_sessions as lecture
      on lecture.id = session.lecture_session_id
    join public.admin_sessions as admin_session
      on admin_session.id = session.admin_session_id
    where session.lecture_session_id = new.lecture_session_id
      and session.display_auth_user_id is not null
      and session.revoked_at is null
      and session.expires_at > statement_timestamp()
      and session.hard_stop_at > statement_timestamp()
      and lecture.status = 'open'
      and lecture.closed_at is null
      and lecture.hard_stop_at > statement_timestamp()
      and admin_session.auth_user_id = session.admin_auth_user_id
      and admin_session.revoked_at is null
      and admin_session.expires_at > statement_timestamp()
      and admin_session.idle_expires_at > statement_timestamp()
  loop
    begin
      perform realtime.send(
        jsonb_build_object(
          'changeKinds', to_jsonb(change_kinds),
          'lectureSessionId', new.lecture_session_id,
          'sentAt', statement_timestamp(),
          'sessionId', binding.id,
          'versions', jsonb_build_object(
            'caption', new.caption_version,
            'comments', new.visible_comments_version,
            'display', new.display_version,
            'lecture', new.lecture_version,
            'likes', new.likes_version,
            'metrics', new.metrics_version,
            'pdf', new.pdf_version,
            'polls', new.polls_version,
            'summaries', new.summaries_version
          )
        ),
        'live_state_changed',
        binding.topic,
        true
      );
    exception when others then
      -- Realtime is acceleration only; the five-second snapshot remains live.
      null;
    end;
  end loop;

  return new;
end;
$$;

revoke all on function private.broadcast_display_live_state_changed_v1()
  from public, anon, authenticated, service_role;

create trigger lecture_live_state_display_vector_realtime
after update of
  lecture_version,
  caption_version,
  visible_comments_version,
  likes_version,
  polls_version,
  summaries_version,
  pdf_version,
  display_version,
  metrics_version
on public.lecture_live_state
for each row execute function private.broadcast_display_live_state_changed_v1();
