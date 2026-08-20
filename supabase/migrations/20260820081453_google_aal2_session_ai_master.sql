-- Add a provider-free Google/TOTP AAL2 app-session admission method for the
-- lecture AI master. Existing PIN and remembered-browser methods remain
-- available as rollback-compatible transports. This migration creates no
-- child grant, billing grant, usage row, provider request, or hosted effect.

alter table public.lecture_ai_master_authorizations
  drop constraint lecture_ai_master_authorizations_unlock_method_check,
  drop constraint lecture_ai_master_authorizations_unlock_provenance_check,
  add constraint lecture_ai_master_authorizations_unlock_method_check check (
    unlock_method in (
      'ai_pin',
      'google_aal2_session',
      'remembered_browser'
    )
  ),
  add constraint lecture_ai_master_authorizations_unlock_provenance_check check (
    (
      principal_id is null
      and membership_id is null
      and issuing_admin_session_id is null
      and ai_policy_id is null
      and ai_policy_version is null
      and unlock_method is null
      and unlock_factor_id is null
      and unlock_factor_version is null
      and browser_credential_id is null
      and unlock_verified_at is null
      and step_up_verified_at is null
    )
    or (
      principal_id is not null
      and membership_id is not null
      and issuing_admin_session_id is not null
      and issuing_admin_session_id = admin_session_id
      and ai_policy_id is not null
      and ai_policy_version is not null
      and ai_policy_version >= 1
      and unlock_method is not null
      and unlock_verified_at is not null
      and step_up_verified_at is not null
      and (
        (
          unlock_method = 'ai_pin'
          and unlock_factor_id is not null
          and unlock_factor_version is not null
          and unlock_factor_version >= 1
          and browser_credential_id is null
        )
        or (
          unlock_method = 'remembered_browser'
          and unlock_factor_id is not null
          and unlock_factor_version is not null
          and unlock_factor_version >= 1
          and browser_credential_id is not null
        )
        or (
          unlock_method = 'google_aal2_session'
          and unlock_factor_id is null
          and unlock_factor_version is null
          and browser_credential_id is null
          and unlock_verified_at = step_up_verified_at
        )
      )
    )
  );

alter table private.admin_ai_master_admission_receipts
  drop constraint admin_ai_master_admission_receipts_unlock_method_check,
  drop constraint admin_ai_master_admission_receipts_unlock_factor_version_check,
  drop constraint admin_ai_master_admission_receipts_check,
  alter column unlock_factor_id drop not null,
  alter column unlock_factor_version drop not null,
  add constraint admin_ai_master_admission_receipts_unlock_method_check check (
    unlock_method in (
      'ai_pin',
      'google_aal2_session',
      'remembered_browser'
    )
  ),
  add constraint admin_ai_master_admission_receipts_unlock_factor_version_check
    check (
      unlock_factor_version is null or unlock_factor_version >= 1
    ),
  add constraint admin_ai_master_admission_receipts_check check (
    (
      unlock_method = 'ai_pin'
      and unlock_factor_id is not null
      and unlock_factor_version is not null
      and browser_credential_id is null
      and pin_attempt_request_id is not null
      and pin_attempt_request_id = request_id
      and browser_assertion_challenge_id is null
    )
    or (
      unlock_method = 'remembered_browser'
      and unlock_factor_id is not null
      and unlock_factor_version is not null
      and browser_credential_id is not null
      and pin_attempt_request_id is null
      and browser_assertion_challenge_id is not null
    )
    or (
      unlock_method = 'google_aal2_session'
      and unlock_factor_id is null
      and unlock_factor_version is null
      and browser_credential_id is null
      and pin_attempt_request_id is null
      and browser_assertion_challenge_id is null
      and unlock_verified_at = step_up_verified_at
    )
  );

alter table private.admin_ai_master_reuse_receipts
  drop constraint admin_ai_master_reuse_receipts_requested_unlock_method_check,
  add constraint admin_ai_master_reuse_receipts_requested_unlock_method_check
    check (
      requested_unlock_method in (
        'ai_pin',
        'google_aal2_session',
        'remembered_browser'
      )
    );

create table private.admin_ai_master_session_rate_limits (
  admin_session_id uuid not null
    references public.admin_sessions(id) on delete cascade,
  lecture_session_id uuid not null
    references public.lecture_sessions(id) on delete cascade,
  environment_id uuid not null
    references private.admin_environments(id) on delete cascade,
  window_started_at timestamptz not null,
  admission_attempts integer not null default 0 check (
    admission_attempts between 0 and 6
  ),
  updated_at timestamptz not null default statement_timestamp(),
  primary key (admin_session_id, lecture_session_id)
);

create index admin_ai_master_session_rate_limits_lecture_idx
  on private.admin_ai_master_session_rate_limits (lecture_session_id);
create index admin_ai_master_session_rate_limits_environment_idx
  on private.admin_ai_master_session_rate_limits (
    environment_id,
    updated_at
  );

alter table private.admin_ai_master_session_rate_limits enable row level security;
revoke all on private.admin_ai_master_session_rate_limits
  from public, anon, authenticated, service_role;

comment on table private.admin_ai_master_session_rate_limits is
  'One-minute, six-admission cap per Google app session and lecture. Exact admission replay and same-scope reuse bypass this counter.';

create or replace function private.google_ai_master_intent_digest_v1(
  target_request_id uuid,
  target_admin_session_id uuid,
  target_lecture_session_id uuid,
  target_scope text,
  target_policy_id uuid,
  target_policy_version bigint,
  target_unlock_method text
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
      or target_scope not in (
        'all_except_captions',
        'all_including_captions'
      )
      or target_policy_id is null
      or target_policy_version is null
      or target_policy_version < 1
      or target_unlock_method not in (
        'ai_pin',
        'google_aal2_session',
        'remembered_browser'
      )
      then null
    else pg_catalog.encode(
      extensions.digest(
        pg_catalog.convert_to(
          'compass:phase7.30c1:google-ai-master-intent:v1'
          || '|request_id=' || target_request_id::text
          || '|admin_session_id=' || target_admin_session_id::text
          || '|lecture_session_id=' || target_lecture_session_id::text
          || '|scope=' || target_scope
          || '|policy_id=' || target_policy_id::text
          || '|policy_version=' || target_policy_version::text
          || '|unlock_method=' || target_unlock_method,
          'UTF8'
        ),
        'sha256'
      ),
      'hex'
    )
  end;
$$;

revoke all on function private.google_ai_master_intent_digest_v1(
  uuid, uuid, uuid, text, uuid, bigint, text
) from public, anon, authenticated, service_role;

create function private.consume_google_ai_master_session_rate_v1(
  target_context jsonb,
  target_lecture_session_id uuid,
  target_scope text,
  target_request_id uuid
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
  limiter_row private.admin_ai_master_session_rate_limits%rowtype;
  retry_after_value integer;
  effective_now timestamptz := statement_timestamp();
begin
  if target_context is null
     or target_lecture_session_id is null
     or target_scope not in (
       'all_except_captions',
       'all_including_captions'
     )
     or target_request_id is null then
    raise exception 'invalid Google AI master session rate request'
      using errcode = '22023';
  end if;

  insert into private.admin_ai_master_session_rate_limits (
    admin_session_id,
    lecture_session_id,
    environment_id,
    window_started_at,
    admission_attempts,
    updated_at
  ) values (
    (target_context ->> 'admin_session_id')::uuid,
    target_lecture_session_id,
    (target_context ->> 'environment_id')::uuid,
    effective_now,
    0,
    effective_now
  ) on conflict (admin_session_id, lecture_session_id) do nothing;

  select limiter.*
  into limiter_row
  from private.admin_ai_master_session_rate_limits as limiter
  where limiter.admin_session_id =
      (target_context ->> 'admin_session_id')::uuid
    and limiter.lecture_session_id = target_lecture_session_id
  for update;

  if not found
     or limiter_row.environment_id <>
       (target_context ->> 'environment_id')::uuid then
    raise exception 'Google AI master session rate state is unavailable'
      using errcode = 'P7335';
  end if;

  if limiter_row.window_started_at <= effective_now - interval '1 minute' then
    update private.admin_ai_master_session_rate_limits as limiter
    set
      window_started_at = effective_now,
      admission_attempts = 1,
      updated_at = effective_now
    where limiter.admin_session_id = limiter_row.admin_session_id
      and limiter.lecture_session_id = limiter_row.lecture_session_id;
    return jsonb_build_object(
      'allowed', true,
      'retry_after_seconds', 0
    );
  end if;

  if limiter_row.admission_attempts >= 6 then
    retry_after_value := greatest(
      1,
      least(
        60,
        ceil(
          extract(
            epoch from (
              limiter_row.window_started_at + interval '1 minute' -
              effective_now
            )
          )
        )::integer
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
      (target_context ->> 'environment_id')::uuid,
      (target_context ->> 'principal_id')::uuid,
      (target_context ->> 'membership_id')::uuid,
      (target_context ->> 'admin_session_id')::uuid,
      'google_ai_master.admit',
      'lecture_ai_master_authorization',
      target_lecture_session_id::text,
      'denied',
      'session_admission_rate_limited',
      jsonb_build_object(
        'retry_after_seconds', retry_after_value,
        'scope', target_scope,
        'unlock_method', 'google_aal2_session'
      )
    );
    return jsonb_build_object(
      'allowed', false,
      'reason_code', 'rate_limited',
      'retry_after_seconds', retry_after_value
    );
  end if;

  update private.admin_ai_master_session_rate_limits as limiter
  set
    admission_attempts = limiter.admission_attempts + 1,
    updated_at = effective_now
  where limiter.admin_session_id = limiter_row.admin_session_id
    and limiter.lecture_session_id = limiter_row.lecture_session_id;

  return jsonb_build_object(
    'allowed', true,
    'retry_after_seconds', 0
  );
end;
$$;

revoke all on function private.consume_google_ai_master_session_rate_v1(
  jsonb, uuid, text, uuid
) from public, anon, authenticated, service_role;

create or replace function private.apply_google_ai_master_admission_v1(
  target_context jsonb,
  target_supabase_auth_session_id uuid,
  target_lecture_session_id uuid,
  target_scope text,
  target_policy_id uuid,
  target_policy_version bigint,
  target_unlock_method text,
  target_factor_id uuid,
  target_factor_version bigint,
  target_browser_credential_id uuid,
  target_pin_attempt_request_id uuid,
  target_browser_assertion_challenge_id uuid,
  target_verified_at timestamptz,
  target_request_id uuid,
  target_intent_digest text
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
  gate_row private.admin_ai_unlock_runtime_gate%rowtype;
  lecture_row public.lecture_sessions%rowtype;
  authorization_row public.lecture_ai_master_authorizations%rowtype;
  receipt_row private.admin_ai_master_admission_receipts%rowtype;
  requested_actions text[];
  actor_value text :=
    'admin-session:' || (target_context ->> 'admin_session_id');
  authorization_was_new boolean := false;
  effective_expires_at timestamptz;
  effective_now timestamptz := statement_timestamp();
begin
  requested_actions := private.ai_master_actions_for_scope(target_scope);
  if requested_actions is null
     or target_request_id is null
     or target_intent_digest is null
     or target_intent_digest !~ '^[0-9a-f]{64}$'
     or target_unlock_method is null
     or target_unlock_method not in (
       'ai_pin',
       'google_aal2_session',
       'remembered_browser'
     )
     or target_verified_at is null
     or target_verified_at > effective_now + interval '1 minute'
     or (
       target_unlock_method = 'ai_pin'
       and (
         target_factor_id is null
         or target_factor_version is null
         or target_factor_version < 1
         or target_browser_credential_id is not null
         or target_pin_attempt_request_id is null
         or target_pin_attempt_request_id is distinct from target_request_id
         or target_browser_assertion_challenge_id is not null
       )
     )
     or (
       target_unlock_method = 'remembered_browser'
       and (
         target_factor_id is null
         or target_factor_version is null
         or target_factor_version < 1
         or target_browser_credential_id is null
         or target_pin_attempt_request_id is not null
         or target_browser_assertion_challenge_id is null
       )
     )
     or (
       target_unlock_method = 'google_aal2_session'
       and (
         target_factor_id is not null
         or target_factor_version is not null
         or target_browser_credential_id is not null
         or target_pin_attempt_request_id is not null
         or target_browser_assertion_challenge_id is not null
         or target_verified_at is distinct from
           (target_context ->> 'step_up_verified_at')::timestamptz
       )
     ) then
    raise exception 'invalid Google AI master proof' using errcode = '22023';
  end if;

  select gate.*
  into gate_row
  from private.admin_ai_unlock_runtime_gate as gate
  where gate.singleton
  for share;

  if not found
     or not gate_row.ai_unlock_enabled
     or not gate_row.google_ai_master_admission_enabled
     or (
       target_unlock_method = 'remembered_browser'
       and not gate_row.remembered_browser_enabled
     ) then
    raise exception 'Google AI master admission is disabled'
      using errcode = 'P7336';
  end if;

  perform private.serialize_admin_ai_scope_v1(
    'factor-membership',
    (target_context ->> 'membership_id')::uuid
  );
  perform private.serialize_admin_ai_scope_v1(
    'policy-membership',
    (target_context ->> 'membership_id')::uuid
  );

  select ownership.*
  into ownership_row
  from private.admin_lecture_ownerships as ownership
  where ownership.lecture_session_id = target_lecture_session_id;

  if not found
     or ownership_row.environment_id <>
       (target_context ->> 'environment_id')::uuid
     or ownership_row.principal_id <>
       (target_context ->> 'principal_id')::uuid
     or ownership_row.membership_id <>
       (target_context ->> 'membership_id')::uuid then
    raise exception 'lecture ownership is unavailable' using errcode = 'P7335';
  end if;

  select policy.*
  into policy_row
  from private.admin_ai_policies as policy
  where policy.id = target_policy_id
    and policy.version = target_policy_version
    and policy.environment_id = (target_context ->> 'environment_id')::uuid
    and policy.membership_id = (target_context ->> 'membership_id')::uuid
  for update;

  if not found
     or policy_row.status <> 'active'
     or policy_row.valid_from > effective_now
     or policy_row.valid_until <= effective_now
     or not requested_actions <@ policy_row.allowed_actions then
    raise exception 'AI policy is unavailable' using errcode = 'P7335';
  end if;

  select lecture.*
  into lecture_row
  from public.lecture_sessions as lecture
  where lecture.id = target_lecture_session_id
  for update;

  if not found
     or lecture_row.status <> 'open'
     or lecture_row.hard_stop_at is null
     or lecture_row.hard_stop_at <= effective_now then
    raise exception 'lecture is not open' using errcode = 'P7335';
  end if;

  select master.*
  into authorization_row
  from public.lecture_ai_master_authorizations as master
  where master.lecture_session_id = target_lecture_session_id
    and master.status = 'active'
  for update;

  if found and authorization_row.expires_at <= effective_now then
    perform private.expire_ai_master_authorization(
      target_lecture_session_id,
      'expired',
      'authorization_expired',
      'system:expiry'
    );
    authorization_row := null::public.lecture_ai_master_authorizations;
  end if;

  if authorization_row.id is not null and (
    authorization_row.principal_id is null
    or not exists (
      select 1
      from private.admin_ai_master_admission_receipts as marker
      where marker.master_authorization_id = authorization_row.id
    )
  ) then
    raise exception 'pre-C1 AI master cannot be converted by C1'
      using errcode = 'P7335';
  end if;

  if authorization_row.id is not null and (
    authorization_row.principal_id <>
      (target_context ->> 'principal_id')::uuid
    or authorization_row.membership_id <>
      (target_context ->> 'membership_id')::uuid
    or authorization_row.issuing_admin_session_id <>
      (target_context ->> 'admin_session_id')::uuid
    or authorization_row.actor_id <> actor_value
  ) then
    raise exception 'AI master is held by another Admin session'
      using errcode = 'P7335';
  end if;

  effective_expires_at := least(
    lecture_row.hard_stop_at,
    policy_row.valid_until,
    (target_context ->> 'expires_at')::timestamptz
  );
  if effective_expires_at <= effective_now then
    raise exception 'AI master lifetime is unavailable' using errcode = 'P7335';
  end if;

  if authorization_row.id is null then
    authorization_was_new := true;
    insert into public.lecture_ai_master_authorizations (
      lecture_session_id,
      admin_session_id,
      actor_id,
      scope,
      actions,
      expires_at,
      principal_id,
      membership_id,
      issuing_admin_session_id,
      ai_policy_id,
      ai_policy_version,
      unlock_method,
      unlock_factor_id,
      unlock_factor_version,
      browser_credential_id,
      unlock_verified_at,
      step_up_verified_at
    ) values (
      target_lecture_session_id,
      (target_context ->> 'admin_session_id')::uuid,
      actor_value,
      target_scope,
      requested_actions,
      effective_expires_at,
      (target_context ->> 'principal_id')::uuid,
      (target_context ->> 'membership_id')::uuid,
      (target_context ->> 'admin_session_id')::uuid,
      policy_row.id,
      policy_row.version,
      target_unlock_method,
      target_factor_id,
      target_factor_version,
      target_browser_credential_id,
      target_verified_at,
      (target_context ->> 'step_up_verified_at')::timestamptz
    ) returning * into authorization_row;
  else
    if authorization_row.scope = 'all_including_captions'
       and target_scope = 'all_except_captions' then
      perform private.stop_captions_for_ai_master_scope_change(
        target_lecture_session_id
      );
    end if;

    update public.lecture_ai_master_authorizations as master
    set
      scope = target_scope,
      actions = requested_actions,
      expires_at = effective_expires_at,
      last_used_at = null,
      ai_policy_id = policy_row.id,
      ai_policy_version = policy_row.version,
      unlock_method = target_unlock_method,
      unlock_factor_id = target_factor_id,
      unlock_factor_version = target_factor_version,
      browser_credential_id = target_browser_credential_id,
      unlock_verified_at = target_verified_at,
      step_up_verified_at =
        (target_context ->> 'step_up_verified_at')::timestamptz,
      version = master.version + 1,
      updated_at = effective_now
    where master.id = authorization_row.id
    returning * into authorization_row;

    perform private.revoke_pending_ai_master_grants(
      authorization_row.id,
      'google_ai_master_reauthorized'
    );
  end if;

  insert into public.ai_master_authorization_events (
    authorization_id,
    lecture_session_id,
    event_type,
    actor_id,
    scope,
    actions,
    reason
  ) values (
    authorization_row.id,
    authorization_row.lecture_session_id,
    case when authorization_was_new then 'authorized' else 'scope_changed' end,
    actor_value,
    authorization_row.scope,
    authorization_row.actions,
    case
      when authorization_was_new then null
      else 'google_ai_master_reauthorized'
    end
  );

  insert into private.admin_ai_master_admission_receipts (
    request_id,
    intent_digest,
    environment_id,
    principal_id,
    membership_id,
    admin_session_id,
    supabase_auth_session_id,
    lecture_session_id,
    master_authorization_id,
    master_version,
    requested_scope,
    requested_actions,
    policy_id,
    policy_version,
    unlock_method,
    unlock_factor_id,
    unlock_factor_version,
    browser_credential_id,
    pin_attempt_request_id,
    browser_assertion_challenge_id,
    unlock_verified_at,
    step_up_verified_at,
    admitted_at
  ) values (
    target_request_id,
    target_intent_digest,
    (target_context ->> 'environment_id')::uuid,
    (target_context ->> 'principal_id')::uuid,
    (target_context ->> 'membership_id')::uuid,
    (target_context ->> 'admin_session_id')::uuid,
    target_supabase_auth_session_id,
    target_lecture_session_id,
    authorization_row.id,
    authorization_row.version,
    target_scope,
    requested_actions,
    policy_row.id,
    policy_row.version,
    target_unlock_method,
    target_factor_id,
    target_factor_version,
    target_browser_credential_id,
    target_pin_attempt_request_id,
    target_browser_assertion_challenge_id,
    target_verified_at,
    (target_context ->> 'step_up_verified_at')::timestamptz,
    effective_now
  ) returning * into receipt_row;

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
    receipt_row.environment_id,
    receipt_row.principal_id,
    receipt_row.membership_id,
    receipt_row.admin_session_id,
    'google_ai_master.admit',
    'lecture_ai_master_authorization',
    authorization_row.id::text,
    'accepted',
    case
      when target_unlock_method = 'google_aal2_session'
        then 'google_aal2_session_verified'
      else 'atomic_unlock_proof_consumed'
    end,
    jsonb_build_object(
      'scope', authorization_row.scope,
      'unlock_method', authorization_row.unlock_method,
      'version', authorization_row.version
    )
  );

  return jsonb_build_object(
    'accepted', true,
    'admission_replayed', false,
    'authorization', private.ai_master_authorization_json(
      authorization_row,
      actor_value
    ),
    'proof_required', false,
    'server_time', effective_now
  );
end;
$$;

revoke all on function private.apply_google_ai_master_admission_v1(
  jsonb, uuid, uuid, text, uuid, bigint, text, uuid, bigint, uuid, uuid,
  uuid, timestamptz, uuid, text
) from public, anon, authenticated, service_role;

create function private.authorize_google_ai_master_with_session_v1(
  target_token_hash text,
  target_auth_user_id uuid,
  target_supabase_auth_session_id uuid,
  target_lecture_session_id uuid,
  target_scope text,
  target_policy_id uuid,
  target_policy_version bigint,
  target_request_id uuid
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
  replay_value jsonb;
  rate_value jsonb;
  intent_digest_value text;
begin
  if target_lecture_session_id is null
     or target_scope not in ('all_except_captions', 'all_including_captions')
     or target_policy_id is null
     or target_policy_version is null
     or target_policy_version < 1
     or target_request_id is null then
    raise exception 'invalid Google AI master session admission'
      using errcode = '22023';
  end if;

  perform private.serialize_admin_ai_request_v1(target_request_id);

  context_value := private.require_google_ai_master_context_v1(
    target_token_hash,
    target_auth_user_id,
    target_supabase_auth_session_id,
    true
  );
  if context_value is null then
    return null;
  end if;

  intent_digest_value := private.google_ai_master_intent_digest_v1(
    target_request_id,
    (context_value ->> 'admin_session_id')::uuid,
    target_lecture_session_id,
    target_scope,
    target_policy_id,
    target_policy_version,
    'google_aal2_session'
  );

  replay_value := private.replay_or_reuse_google_ai_master_v1(
    context_value,
    target_lecture_session_id,
    target_scope,
    target_policy_id,
    target_policy_version,
    'google_aal2_session',
    target_request_id,
    intent_digest_value
  );
  if replay_value is not null then
    return replay_value;
  end if;

  if not exists (
    select 1
    from private.admin_ai_unlock_runtime_gate as gate
    where gate.singleton
      and gate.ai_unlock_enabled
      and gate.google_ai_master_admission_enabled
  ) then
    raise exception 'Google AI master admission is disabled'
      using errcode = 'P7336';
  end if;

  rate_value := private.consume_google_ai_master_session_rate_v1(
    context_value,
    target_lecture_session_id,
    target_scope,
    target_request_id
  );
  if coalesce((rate_value ->> 'allowed')::boolean, false) is false then
    return jsonb_build_object(
      'accepted', false,
      'proof_required', false,
      'reason_code', coalesce(rate_value ->> 'reason_code', 'rate_limited'),
      'retry_after_seconds', coalesce(
        (rate_value ->> 'retry_after_seconds')::integer,
        1
      ),
      'server_time', statement_timestamp()
    );
  end if;

  return private.apply_google_ai_master_admission_v1(
    context_value,
    target_supabase_auth_session_id,
    target_lecture_session_id,
    target_scope,
    target_policy_id,
    target_policy_version,
    'google_aal2_session',
    null,
    null,
    null,
    null,
    null,
    (context_value ->> 'step_up_verified_at')::timestamptz,
    target_request_id,
    intent_digest_value
  );
end;
$$;

revoke all on function private.authorize_google_ai_master_with_session_v1(
  text, uuid, uuid, uuid, text, uuid, bigint, uuid
) from public, anon, authenticated, service_role;

create function public.authorize_google_ai_master_with_session_v1(
  target_token_hash text,
  target_auth_user_id uuid,
  target_supabase_auth_session_id uuid,
  target_lecture_session_id uuid,
  target_scope text,
  target_policy_id uuid,
  target_policy_version bigint,
  target_request_id uuid
)
returns jsonb
language sql
volatile
security definer
set search_path = ''
as $$
  select private.authorize_google_ai_master_with_session_v1(
    target_token_hash,
    target_auth_user_id,
    target_supabase_auth_session_id,
    target_lecture_session_id,
    target_scope,
    target_policy_id,
    target_policy_version,
    target_request_id
  );
$$;

revoke all on function public.authorize_google_ai_master_with_session_v1(
  text, uuid, uuid, uuid, text, uuid, bigint, uuid
) from public, anon, authenticated;
grant execute on function public.authorize_google_ai_master_with_session_v1(
  text, uuid, uuid, uuid, text, uuid, bigint, uuid
) to service_role;

comment on function public.authorize_google_ai_master_with_session_v1(
  text, uuid, uuid, uuid, text, uuid, bigint, uuid
) is
  'Authorizes a provider-free lecture AI master from the verified Google/TOTP AAL2 app session. Exact ownership, policy, lifecycle, rate and drain checks remain server-authoritative.';
