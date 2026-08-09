-- Phase 7.30B2: personal AI unlock and remembered-browser foundation.
--
-- This migration is additive and dormant. It creates no provider call, does
-- not activate Google Auth, and does not change either legacy compatibility
-- path. A trusted Edge function must HMAC the four-digit intent value with a
-- server-only versioned pepper before calling these service-role-only RPCs.
-- PostgreSQL then applies the deliberately slow bcrypt verifier to that
-- 64-character HMAC. No low-entropy input is accepted or retained here.

create table private.admin_ai_unlock_runtime_gate (
  singleton boolean primary key default true check (singleton),
  ai_unlock_enabled boolean not null default false,
  remembered_browser_enabled boolean not null default false,
  updated_at timestamptz not null default statement_timestamp()
);

insert into private.admin_ai_unlock_runtime_gate (singleton) values (true);

create table private.admin_ai_policies (
  id uuid primary key default extensions.gen_random_uuid(),
  environment_id uuid not null
    references private.admin_environments(id) on delete restrict,
  membership_id uuid not null
    references private.admin_environment_memberships(id) on delete restrict,
  allowed_actions text[] not null check (
    cardinality(allowed_actions) between 1 and 5
    and array_position(allowed_actions, null) is null
    and allowed_actions <@ array[
      'academic_answers',
      'captions',
      'material_analysis',
      'poll_suggestions',
      'summaries'
    ]::text[]
  ),
  allowed_models text[] not null check (
    cardinality(allowed_models) between 1 and 16
    and array_position(allowed_models, null) is null
    and pg_column_size(allowed_models) <= 2048
  ),
  max_calls_per_lecture integer not null check (max_calls_per_lecture between 1 and 10000),
  max_calls_per_day integer not null check (max_calls_per_day between 1 and 100000),
  max_input_tokens_per_lecture bigint not null check (max_input_tokens_per_lecture > 0),
  max_input_tokens_per_day bigint not null check (max_input_tokens_per_day > 0),
  max_output_tokens_per_lecture bigint not null check (max_output_tokens_per_lecture > 0),
  max_output_tokens_per_day bigint not null check (max_output_tokens_per_day > 0),
  max_cost_microusd_per_lecture bigint not null check (max_cost_microusd_per_lecture > 0),
  max_cost_microusd_per_day bigint not null check (max_cost_microusd_per_day > 0),
  max_realtime_minutes_per_lecture integer not null check (
    max_realtime_minutes_per_lecture between 0 and 90
  ),
  max_realtime_minutes_per_day integer not null check (
    max_realtime_minutes_per_day between 0 and 1440
  ),
  max_concurrency integer not null check (max_concurrency between 1 and 32),
  valid_from timestamptz not null,
  valid_until timestamptz not null,
  status text not null default 'active' check (
    status in ('active', 'superseded', 'revoked', 'expired')
  ),
  version bigint not null check (version >= 1),
  supersedes_policy_id uuid
    references private.admin_ai_policies(id) on delete restrict,
  created_by_membership_id uuid not null
    references private.admin_environment_memberships(id) on delete restrict,
  created_by_admin_session_id uuid not null
    references public.admin_sessions(id) on delete restrict,
  request_id uuid not null unique,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  revoked_at timestamptz,
  check (valid_until > valid_from),
  check (
    (status = 'active' and revoked_at is null)
    or (status <> 'active' and revoked_at is not null)
  )
);

create unique index admin_ai_policies_one_active_membership_idx
  on private.admin_ai_policies (environment_id, membership_id)
  where status = 'active';

create unique index admin_ai_policies_membership_version_idx
  on private.admin_ai_policies (environment_id, membership_id, version);

create index admin_ai_policies_validity_idx
  on private.admin_ai_policies (environment_id, valid_until)
  where status = 'active';

create index admin_ai_policies_membership_history_idx
  on private.admin_ai_policies (membership_id, version desc);

create index admin_ai_policies_created_by_membership_idx
  on private.admin_ai_policies (created_by_membership_id, created_at desc);

create index admin_ai_policies_created_by_session_idx
  on private.admin_ai_policies (created_by_admin_session_id, created_at desc);

create index admin_ai_policies_supersedes_idx
  on private.admin_ai_policies (supersedes_policy_id)
  where supersedes_policy_id is not null;

create table private.admin_ai_unlock_factors (
  id uuid primary key default extensions.gen_random_uuid(),
  environment_id uuid not null
    references private.admin_environments(id) on delete restrict,
  principal_id uuid not null
    references private.admin_principals(id) on delete restrict,
  membership_id uuid not null
    references private.admin_environment_memberships(id) on delete restrict,
  factor_kind text not null default 'ai_pin' check (factor_kind = 'ai_pin'),
  pin_verifier text not null check (
    pin_verifier ~ '^[$]2[aby][$]12[$][./A-Za-z0-9]{53}$'
  ),
  pin_pepper_version integer not null check (
    pin_pepper_version between 1 and 2147483647
  ),
  verifier_work_factor smallint not null default 12 check (verifier_work_factor = 12),
  factor_version bigint not null check (factor_version >= 1),
  status text not null default 'active' check (
    status in ('active', 'rotated', 'revoked')
  ),
  enrolled_by_admin_session_id uuid not null
    references public.admin_sessions(id) on delete restrict,
  enrolled_step_up_verified_at timestamptz not null,
  rotated_from_factor_id uuid
    references private.admin_ai_unlock_factors(id) on delete restrict,
  enrollment_request_id uuid not null unique,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  last_verified_at timestamptz,
  revoked_at timestamptz,
  revoke_reason text check (
    revoke_reason is null or revoke_reason ~ '^[a-z][a-z0-9_]{0,79}$'
  ),
  check (
    (status = 'active' and revoked_at is null and revoke_reason is null)
    or (status <> 'active' and revoked_at is not null and revoke_reason is not null)
  )
);

create unique index admin_ai_unlock_factors_one_active_membership_idx
  on private.admin_ai_unlock_factors (environment_id, membership_id)
  where status = 'active';

create unique index admin_ai_unlock_factors_membership_version_idx
  on private.admin_ai_unlock_factors (environment_id, membership_id, factor_version);

create index admin_ai_unlock_factors_principal_status_idx
  on private.admin_ai_unlock_factors (principal_id, status, factor_version desc);

create index admin_ai_unlock_factors_membership_history_idx
  on private.admin_ai_unlock_factors (membership_id, factor_version desc);

create index admin_ai_unlock_factors_enrolled_session_idx
  on private.admin_ai_unlock_factors (enrolled_by_admin_session_id, created_at desc);

create index admin_ai_unlock_factors_rotated_from_idx
  on private.admin_ai_unlock_factors (rotated_from_factor_id)
  where rotated_from_factor_id is not null;

-- These buckets intentionally contain no factor, factor-version, session or
-- browser-credential key. Rotation and multi-tab/session use therefore cannot
-- erase or shard a membership/network/environment lockout.
create table private.admin_ai_unlock_rate_limits (
  environment_id uuid not null
    references private.admin_environments(id) on delete restrict,
  bucket_kind text not null check (
    bucket_kind in ('environment', 'membership', 'network')
  ),
  bucket_key text not null check (char_length(bucket_key) between 1 and 128),
  membership_id uuid
    references private.admin_environment_memberships(id) on delete restrict,
  network_hmac text check (
    network_hmac is null or network_hmac ~ '^[0-9a-f]{64}$'
  ),
  window_started_at timestamptz not null,
  failed_attempts integer not null default 0 check (failed_attempts >= 0),
  locked_until timestamptz,
  last_failed_at timestamptz,
  updated_at timestamptz not null default statement_timestamp(),
  primary key (environment_id, bucket_kind, bucket_key),
  check (
    (
      bucket_kind = 'membership'
      and membership_id is not null
      and network_hmac is null
      and bucket_key = membership_id::text
    )
    or (
      bucket_kind = 'network'
      and membership_id is null
      and network_hmac is not null
      and bucket_key = network_hmac
    )
    or (
      bucket_kind = 'environment'
      and membership_id is null
      and network_hmac is null
      and bucket_key = 'environment'
    )
  )
);

create index admin_ai_unlock_rate_limits_locked_idx
  on private.admin_ai_unlock_rate_limits (environment_id, locked_until)
  where locked_until is not null;

create index admin_ai_unlock_rate_limits_updated_idx
  on private.admin_ai_unlock_rate_limits (
    updated_at,
    environment_id,
    bucket_kind,
    bucket_key
  );

create index admin_ai_unlock_rate_limits_membership_idx
  on private.admin_ai_unlock_rate_limits (membership_id)
  where membership_id is not null;

create table private.admin_ai_unlock_attempt_receipts (
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
  factor_id uuid
    references private.admin_ai_unlock_factors(id) on delete restrict,
  factor_version bigint,
  factor_pin_pepper_version integer,
  input_pin_pepper_version integer not null check (input_pin_pepper_version >= 1),
  input_pin_proof_digest text not null check (
    input_pin_proof_digest ~ '^[0-9a-f]{64}$'
  ),
  verified boolean not null,
  reason_code text not null check (reason_code ~ '^[a-z][a-z0-9_]{0,79}$'),
  retry_after_seconds integer not null default 0 check (
    retry_after_seconds between 0 and 900
  ),
  occurred_at timestamptz not null default statement_timestamp(),
  check (
    (
      factor_id is null
      and factor_version is null
      and factor_pin_pepper_version is null
    )
    or (
      factor_id is not null
      and factor_version is not null
      and factor_version >= 1
      and factor_pin_pepper_version is not null
      and factor_pin_pepper_version >= 1
    )
  )
);

create index admin_ai_unlock_attempt_receipts_retention_idx
  on private.admin_ai_unlock_attempt_receipts (occurred_at, request_id);

create index admin_ai_unlock_attempt_receipts_environment_idx
  on private.admin_ai_unlock_attempt_receipts (environment_id, occurred_at desc);

create index admin_ai_unlock_attempt_receipts_principal_idx
  on private.admin_ai_unlock_attempt_receipts (principal_id, occurred_at desc);

create index admin_ai_unlock_attempt_receipts_membership_idx
  on private.admin_ai_unlock_attempt_receipts (membership_id, occurred_at desc);

create index admin_ai_unlock_attempt_receipts_session_idx
  on private.admin_ai_unlock_attempt_receipts (admin_session_id, occurred_at desc);

create index admin_ai_unlock_attempt_receipts_factor_idx
  on private.admin_ai_unlock_attempt_receipts (factor_id, occurred_at desc)
  where factor_id is not null;

create table private.admin_ai_pin_discovery_receipts (
  request_id uuid primary key,
  intent_digest text not null check (intent_digest ~ '^[0-9a-f]{64}$'),
  network_hmac text not null check (network_hmac ~ '^[0-9a-f]{64}$'),
  environment_id uuid not null
    references private.admin_environments(id) on delete restrict,
  principal_id uuid not null
    references private.admin_principals(id) on delete restrict,
  membership_id uuid not null
    references private.admin_environment_memberships(id) on delete restrict,
  admin_session_id uuid not null
    references public.admin_sessions(id) on delete restrict,
  factor_id uuid not null
    references private.admin_ai_unlock_factors(id) on delete restrict,
  factor_version bigint not null check (factor_version >= 1),
  pin_pepper_version integer not null check (pin_pepper_version >= 1),
  occurred_at timestamptz not null default statement_timestamp(),
  expires_at timestamptz not null,
  check (expires_at > occurred_at and expires_at <= occurred_at + interval '5 minutes')
);

create index admin_ai_pin_discovery_retention_idx
  on private.admin_ai_pin_discovery_receipts (expires_at, request_id);

create index admin_ai_pin_discovery_environment_idx
  on private.admin_ai_pin_discovery_receipts (environment_id, expires_at);

create index admin_ai_pin_discovery_principal_idx
  on private.admin_ai_pin_discovery_receipts (principal_id, expires_at);

create index admin_ai_pin_discovery_membership_idx
  on private.admin_ai_pin_discovery_receipts (membership_id, expires_at);

create index admin_ai_pin_discovery_session_idx
  on private.admin_ai_pin_discovery_receipts (admin_session_id, expires_at);

create index admin_ai_pin_discovery_factor_idx
  on private.admin_ai_pin_discovery_receipts (factor_id, factor_version);

create table private.admin_ai_browser_enrollment_nonces (
  id uuid primary key default extensions.gen_random_uuid(),
  nonce_hash text not null unique check (nonce_hash ~ '^[0-9a-f]{64}$'),
  reserved_browser_credential_id uuid not null unique,
  credential_hash text not null unique check (credential_hash ~ '^[0-9a-f]{64}$'),
  environment_id uuid not null
    references private.admin_environments(id) on delete restrict,
  principal_id uuid not null
    references private.admin_principals(id) on delete restrict,
  membership_id uuid not null
    references private.admin_environment_memberships(id) on delete restrict,
  admin_session_id uuid not null
    references public.admin_sessions(id) on delete restrict,
  factor_id uuid not null
    references private.admin_ai_unlock_factors(id) on delete restrict,
  factor_version bigint not null check (factor_version >= 1),
  step_up_verified_at timestamptz not null,
  origin text not null check (origin ~ '^https?://[^/?#]+$'),
  public_key_fingerprint text not null check (
    public_key_fingerprint ~ '^[0-9a-f]{64}$'
  ),
  absolute_expires_at timestamptz not null,
  begin_request_id uuid not null unique,
  completion_request_id uuid unique,
  completion_intent_digest text check (
    completion_intent_digest is null
    or completion_intent_digest ~ '^[0-9a-f]{64}$'
  ),
  issued_at timestamptz not null default statement_timestamp(),
  expires_at timestamptz not null,
  status text not null default 'pending' check (
    status in ('pending', 'consumed', 'superseded', 'expired')
  ),
  consumed_at timestamptz,
  completed_browser_credential_id uuid,
  updated_at timestamptz not null default statement_timestamp(),
  check (expires_at > issued_at and expires_at <= issued_at + interval '5 minutes'),
  check (
    absolute_expires_at > issued_at
    and absolute_expires_at <= issued_at + interval '30 days'
  ),
  check (
    completed_browser_credential_id is null
    or completed_browser_credential_id = reserved_browser_credential_id
  ),
  check (
    (
      status = 'consumed'
      and consumed_at is not null
      and completion_request_id is not null
      and completion_intent_digest is not null
      and completed_browser_credential_id is not null
    )
    or (
      status <> 'consumed'
      and consumed_at is null
      and completion_request_id is null
      and completion_intent_digest is null
      and completed_browser_credential_id is null
    )
  )
);

create unique index admin_ai_browser_enrollment_pending_session_idx
  on private.admin_ai_browser_enrollment_nonces (admin_session_id)
  where status = 'pending';

create index admin_ai_browser_enrollment_expiry_idx
  on private.admin_ai_browser_enrollment_nonces (expires_at, id)
  where status = 'pending';

create index admin_ai_browser_enrollment_retention_idx
  on private.admin_ai_browser_enrollment_nonces (updated_at, id)
  where status in ('consumed', 'superseded', 'expired');

create index admin_ai_browser_enrollment_factor_status_idx
  on private.admin_ai_browser_enrollment_nonces (factor_id, status);

create index admin_ai_browser_enrollment_membership_status_idx
  on private.admin_ai_browser_enrollment_nonces (membership_id, status);

create index admin_ai_browser_enrollment_environment_status_idx
  on private.admin_ai_browser_enrollment_nonces (environment_id, status);

create index admin_ai_browser_enrollment_principal_status_idx
  on private.admin_ai_browser_enrollment_nonces (principal_id, status);

create index admin_ai_browser_enrollment_session_status_idx
  on private.admin_ai_browser_enrollment_nonces (admin_session_id, status);

create table private.admin_ai_browser_credentials (
  id uuid primary key,
  credential_hash text not null unique check (credential_hash ~ '^[0-9a-f]{64}$'),
  environment_id uuid not null
    references private.admin_environments(id) on delete restrict,
  principal_id uuid not null
    references private.admin_principals(id) on delete restrict,
  membership_id uuid not null
    references private.admin_environment_memberships(id) on delete restrict,
  source_factor_id uuid not null
    references private.admin_ai_unlock_factors(id) on delete restrict,
  source_factor_version bigint not null check (source_factor_version >= 1),
  origin text not null check (origin ~ '^https?://[^/?#]+$'),
  public_key_algorithm text not null default 'ES256' check (
    public_key_algorithm = 'ES256'
  ),
  public_key_jwk jsonb not null check (
    jsonb_typeof(public_key_jwk) = 'object'
    and jsonb_typeof(public_key_jwk -> 'kty') = 'string'
    and jsonb_typeof(public_key_jwk -> 'crv') = 'string'
    and jsonb_typeof(public_key_jwk -> 'x') = 'string'
    and jsonb_typeof(public_key_jwk -> 'y') = 'string'
    and (public_key_jwk ->> 'kty' = 'EC') is true
    and (public_key_jwk ->> 'crv' = 'P-256') is true
    and (public_key_jwk ->> 'x' ~ '^[A-Za-z0-9_-]{43}$') is true
    and (public_key_jwk ->> 'y' ~ '^[A-Za-z0-9_-]{43}$') is true
    and not (public_key_jwk ? 'd')
    and pg_column_size(public_key_jwk) <= 1024
  ),
  public_key_fingerprint text not null check (
    public_key_fingerprint ~ '^[0-9a-f]{64}$'
  ),
  enrolled_by_admin_session_id uuid not null
    references public.admin_sessions(id) on delete restrict,
  enrollment_nonce_id uuid not null unique
    references private.admin_ai_browser_enrollment_nonces(id) on delete restrict,
  status text not null default 'active' check (
    status in ('active', 'revoked', 'expired')
  ),
  created_at timestamptz not null default statement_timestamp(),
  expires_at timestamptz not null,
  last_used_at timestamptz,
  revoked_at timestamptz,
  revoked_by_admin_session_id uuid
    references public.admin_sessions(id) on delete restrict,
  revocation_request_id uuid unique,
  revoke_reason text check (
    revoke_reason is null or revoke_reason ~ '^[a-z][a-z0-9_]{0,79}$'
  ),
  updated_at timestamptz not null default statement_timestamp(),
  check (expires_at > created_at and expires_at <= created_at + interval '30 days'),
  check (
    public_key_fingerprint = pg_catalog.encode(
      extensions.digest(
        pg_catalog.convert_to(
          '{"crv":"P-256","kty":"EC","x":"'
            || (public_key_jwk ->> 'x')
            || '","y":"'
            || (public_key_jwk ->> 'y')
            || '"}',
          'UTF8'
        ),
        'sha256'
      ),
      'hex'
    )
  ),
  check (
    (
      status = 'active'
      and revoked_at is null
      and revoked_by_admin_session_id is null
      and revocation_request_id is null
      and revoke_reason is null
    )
    or (
      status <> 'active'
      and revoked_at is not null
      and revoke_reason is not null
    )
  )
);

create index admin_ai_browser_credentials_membership_status_idx
  on private.admin_ai_browser_credentials (membership_id, status, expires_at, environment_id);

create index admin_ai_browser_credentials_environment_status_idx
  on private.admin_ai_browser_credentials (environment_id, status, expires_at);

create index admin_ai_browser_credentials_factor_idx
  on private.admin_ai_browser_credentials (source_factor_id, source_factor_version, status);

create index admin_ai_browser_credentials_principal_status_idx
  on private.admin_ai_browser_credentials (principal_id, status, expires_at);

create index admin_ai_browser_credentials_expiry_idx
  on private.admin_ai_browser_credentials (expires_at, id)
  where status = 'active';

create index admin_ai_browser_credentials_enrolled_session_idx
  on private.admin_ai_browser_credentials (enrolled_by_admin_session_id, created_at desc);

create index admin_ai_browser_credentials_revoked_session_idx
  on private.admin_ai_browser_credentials (revoked_by_admin_session_id, revoked_at desc)
  where revoked_by_admin_session_id is not null;

alter table private.admin_ai_browser_enrollment_nonces
  add constraint admin_ai_browser_enrollment_completed_credential_fkey
  foreign key (completed_browser_credential_id)
  references private.admin_ai_browser_credentials(id) on delete restrict;

create index admin_ai_browser_enrollment_completed_credential_idx
  on private.admin_ai_browser_enrollment_nonces (completed_browser_credential_id)
  where completed_browser_credential_id is not null;

create table private.admin_ai_browser_assertion_challenges (
  id uuid primary key default extensions.gen_random_uuid(),
  challenge_hash text not null unique check (challenge_hash ~ '^[0-9a-f]{64}$'),
  browser_credential_id uuid not null
    references private.admin_ai_browser_credentials(id) on delete restrict,
  environment_id uuid not null
    references private.admin_environments(id) on delete restrict,
  principal_id uuid not null
    references private.admin_principals(id) on delete restrict,
  membership_id uuid not null
    references private.admin_environment_memberships(id) on delete restrict,
  admin_session_id uuid not null
    references public.admin_sessions(id) on delete restrict,
  factor_id uuid not null
    references private.admin_ai_unlock_factors(id) on delete restrict,
  factor_version bigint not null check (factor_version >= 1),
  lecture_session_id uuid not null
    references public.lecture_sessions(id) on delete restrict,
  requested_scope text not null check (
    requested_scope in ('all_except_captions', 'all_including_captions')
  ),
  policy_id uuid not null
    references private.admin_ai_policies(id) on delete restrict,
  policy_version bigint not null check (policy_version >= 1),
  origin text not null check (origin ~ '^https?://[^/?#]+$'),
  begin_request_id uuid not null unique,
  completion_request_id uuid unique,
  issued_at timestamptz not null default statement_timestamp(),
  expires_at timestamptz not null,
  status text not null default 'pending' check (
    status in ('pending', 'consumed', 'denied', 'superseded', 'expired')
  ),
  consumed_at timestamptz,
  assertion_payload_hash text check (
    assertion_payload_hash is null or assertion_payload_hash ~ '^[0-9a-f]{64}$'
  ),
  signature_verified boolean,
  updated_at timestamptz not null default statement_timestamp(),
  check (expires_at > issued_at and expires_at <= issued_at + interval '5 minutes'),
  check (
    (
      status in ('consumed', 'denied')
      and consumed_at is not null
      and completion_request_id is not null
      and assertion_payload_hash is not null
      and signature_verified is not null
    )
    or (
      status not in ('consumed', 'denied')
      and consumed_at is null
      and completion_request_id is null
      and assertion_payload_hash is null
      and signature_verified is null
    )
  ),
  check ((status = 'consumed') = (signature_verified is true))
);

create unique index admin_ai_browser_assertion_pending_binding_idx
  on private.admin_ai_browser_assertion_challenges (
    browser_credential_id,
    admin_session_id,
    lecture_session_id
  )
  where status = 'pending';

create index admin_ai_browser_assertion_expiry_idx
  on private.admin_ai_browser_assertion_challenges (expires_at, id)
  where status = 'pending';

create index admin_ai_browser_assertion_retention_idx
  on private.admin_ai_browser_assertion_challenges (updated_at, id)
  where status in ('consumed', 'denied', 'superseded', 'expired');

create index admin_ai_browser_assertion_factor_status_idx
  on private.admin_ai_browser_assertion_challenges (factor_id, status);

create index admin_ai_browser_assertion_membership_status_idx
  on private.admin_ai_browser_assertion_challenges (membership_id, status);

create index admin_ai_browser_assertion_lecture_status_idx
  on private.admin_ai_browser_assertion_challenges (lecture_session_id, status);

create index admin_ai_browser_assertion_credential_status_idx
  on private.admin_ai_browser_assertion_challenges (browser_credential_id, status);

create index admin_ai_browser_assertion_environment_status_idx
  on private.admin_ai_browser_assertion_challenges (environment_id, status);

create index admin_ai_browser_assertion_principal_status_idx
  on private.admin_ai_browser_assertion_challenges (principal_id, status);

create index admin_ai_browser_assertion_session_status_idx
  on private.admin_ai_browser_assertion_challenges (admin_session_id, status);

create index admin_ai_browser_assertion_policy_status_idx
  on private.admin_ai_browser_assertion_challenges (policy_id, status);

alter table public.lecture_ai_master_authorizations
  add column principal_id uuid
    references private.admin_principals(id) on delete restrict,
  add column membership_id uuid
    references private.admin_environment_memberships(id) on delete restrict,
  add column issuing_admin_session_id uuid
    references public.admin_sessions(id) on delete restrict,
  add column ai_policy_id uuid
    references private.admin_ai_policies(id) on delete restrict,
  add column ai_policy_version bigint,
  add column unlock_method text check (
    unlock_method in ('ai_pin', 'remembered_browser')
  ),
  add column unlock_factor_id uuid
    references private.admin_ai_unlock_factors(id) on delete restrict,
  add column unlock_factor_version bigint,
  add column browser_credential_id uuid
    references private.admin_ai_browser_credentials(id) on delete restrict,
  add column unlock_verified_at timestamptz,
  add column step_up_verified_at timestamptz,
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
      and unlock_factor_id is not null
      and unlock_factor_version is not null
      and unlock_factor_version >= 1
      and unlock_verified_at is not null
      and step_up_verified_at is not null
      and (
        (unlock_method = 'ai_pin' and browser_credential_id is null)
        or (unlock_method = 'remembered_browser' and browser_credential_id is not null)
      )
    )
  );

create index lecture_ai_master_authorizations_membership_active_idx
  on public.lecture_ai_master_authorizations (membership_id, issued_at desc);

create index lecture_ai_master_authorizations_policy_idx
  on public.lecture_ai_master_authorizations (ai_policy_id, ai_policy_version, status);

create index lecture_ai_master_authorizations_unlock_factor_idx
  on public.lecture_ai_master_authorizations (
    unlock_factor_id,
    unlock_factor_version,
    status
  );

create index lecture_ai_master_authorizations_browser_credential_idx
  on public.lecture_ai_master_authorizations (browser_credential_id, status);

create index lecture_ai_master_authorizations_principal_active_idx
  on public.lecture_ai_master_authorizations (principal_id, issued_at desc);

create index lecture_ai_master_authorizations_issuing_session_idx
  on public.lecture_ai_master_authorizations (issuing_admin_session_id, issued_at desc);

create index admin_step_up_nonces_b2_retention_idx
  on private.admin_step_up_nonces (updated_at, id)
  where status in ('superseded', 'expired');

alter table private.admin_ai_unlock_runtime_gate enable row level security;
alter table private.admin_ai_policies enable row level security;
alter table private.admin_ai_unlock_factors enable row level security;
alter table private.admin_ai_unlock_rate_limits enable row level security;
alter table private.admin_ai_unlock_attempt_receipts enable row level security;
alter table private.admin_ai_pin_discovery_receipts enable row level security;
alter table private.admin_ai_browser_enrollment_nonces enable row level security;
alter table private.admin_ai_browser_credentials enable row level security;
alter table private.admin_ai_browser_assertion_challenges enable row level security;

revoke all on private.admin_ai_unlock_runtime_gate from public, anon, authenticated, service_role;
revoke all on private.admin_ai_policies from public, anon, authenticated, service_role;
revoke all on private.admin_ai_unlock_factors from public, anon, authenticated, service_role;
revoke all on private.admin_ai_unlock_rate_limits from public, anon, authenticated, service_role;
revoke all on private.admin_ai_unlock_attempt_receipts from public, anon, authenticated, service_role;
revoke all on private.admin_ai_pin_discovery_receipts from public, anon, authenticated, service_role;
revoke all on private.admin_ai_browser_enrollment_nonces from public, anon, authenticated, service_role;
revoke all on private.admin_ai_browser_credentials from public, anon, authenticated, service_role;
revoke all on private.admin_ai_browser_assertion_challenges from public, anon, authenticated, service_role;

create trigger admin_ai_unlock_attempt_receipts_immutable
before update on private.admin_ai_unlock_attempt_receipts
for each row execute function private.reject_admin_audit_mutation_v1();

create trigger admin_ai_pin_discovery_receipts_immutable
before update on private.admin_ai_pin_discovery_receipts
for each row execute function private.reject_admin_audit_mutation_v1();

comment on table private.admin_ai_unlock_factors is
  'Stores only an Edge-peppered HMAC protected by bcrypt. No low-entropy input or browser secret is retained.';

comment on table private.admin_ai_unlock_attempt_receipts is
  'Bounded idempotency receipts, not the canonical audit log. Updates are forbidden; controlled retention deletes occur only through the service cleanup RPC.';

comment on table private.admin_ai_pin_discovery_receipts is
  'Immutable five-minute binding between authenticated rate admission and one version-bound PIN verification request.';

comment on table private.admin_ai_unlock_rate_limits is
  'Atomic membership, pepper-hashed coarse-network and environment counters independent of factor version, Admin session and browser credential.';

comment on table private.admin_ai_browser_credentials is
  'Opt-in, revocable origin/profile credential. The browser private key is non-extractable and never leaves the browser; this is not hardware binding.';

comment on table private.admin_ai_browser_assertion_challenges is
  'Digest-only, single-use challenge bound to exact session, lecture, scope, policy, factor, browser credential and Origin.';

-- Google/TOTP Admin sessions use the existing eight-hour absolute cap. They do
-- not impose a second 30-minute idle/TOTP prompt during an active lecture.
-- Legacy PIN sessions retain their existing idle behavior until retirement.
create function private.enforce_google_admin_session_absolute_idle_v1()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  auth_session_created_at timestamptz;
  auth_session_expires_at timestamptz;
begin
  if new.authentication_method = 'google_totp' then
    select auth_session.created_at
    into auth_session_created_at
    from auth.sessions as auth_session
    where auth_session.id = new.supabase_auth_session_id
      and auth_session.user_id = new.auth_user_id
    for key share;

    if not found then
      raise exception 'Supabase Auth session not found'
        using errcode = 'P7323';
    end if;

    auth_session_expires_at := auth_session_created_at + interval '8 hours';
    if new.issued_at >= auth_session_expires_at then
      raise exception 'Supabase Auth session absolute cap elapsed'
        using errcode = 'P7322';
    end if;
    new.expires_at := least(new.expires_at, auth_session_expires_at);
    new.idle_expires_at := new.expires_at;
  end if;
  return new;
end;
$$;

create trigger admin_sessions_google_absolute_idle
before insert or update of
  authentication_method,
  auth_user_id,
  supabase_auth_session_id,
  issued_at,
  expires_at,
  idle_expires_at
on public.admin_sessions
for each row execute function private.enforce_google_admin_session_absolute_idle_v1();

update public.admin_sessions as session
set
  revoked_at = statement_timestamp(),
  revoke_reason = 'absolute_expiry',
  updated_at = statement_timestamp()
from auth.sessions as auth_session
where session.authentication_method = 'google_totp'
  and session.revoked_at is null
  and auth_session.id = session.supabase_auth_session_id
  and auth_session.user_id = session.auth_user_id
  and auth_session.created_at + interval '8 hours' <= statement_timestamp();

update public.admin_sessions as session
set
  expires_at = least(
    session.expires_at,
    auth_session.created_at + interval '8 hours'
  ),
  idle_expires_at = least(
    session.expires_at,
    auth_session.created_at + interval '8 hours'
  ),
  updated_at = statement_timestamp()
from auth.sessions as auth_session
where session.authentication_method = 'google_totp'
  and session.revoked_at is null
  and auth_session.id = session.supabase_auth_session_id
  and auth_session.user_id = session.auth_user_id
  and auth_session.created_at + interval '8 hours' > statement_timestamp()
  and (
    session.expires_at > auth_session.created_at + interval '8 hours'
    or session.idle_expires_at is distinct from least(
      session.expires_at,
      auth_session.created_at + interval '8 hours'
    )
  );

create function private.require_admin_ai_context_v1(
  target_token_hash text,
  target_auth_user_id uuid,
  target_supabase_auth_session_id uuid,
  target_min_step_up_verified_at timestamptz default null,
  target_require_ai boolean default true,
  target_require_owner boolean default false
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
  session_snapshot public.admin_sessions%rowtype;
  session_row public.admin_sessions%rowtype;
  principal_row private.admin_principals%rowtype;
  membership_row private.admin_environment_memberships%rowtype;
  environment_row private.admin_environments%rowtype;
  effective_now timestamptz := statement_timestamp();
begin
  if target_token_hash is null
     or target_token_hash !~ '^[0-9a-f]{64}$'
     or target_auth_user_id is null
     or target_supabase_auth_session_id is null
     or target_require_ai is null
     or target_require_owner is null
     or (
       target_min_step_up_verified_at is not null
       and target_min_step_up_verified_at > effective_now
     ) then
    return null;
  end if;

  -- Discover immutable bindings without taking a lock, then lock the
  -- principal -> membership -> app-session chain. The environment is read
  -- only after those locks and is deliberately not row-locked: the B1
  -- last-owner trigger locks a membership before its environment, so an
  -- environment reader lock here would create the inverse edge on DELETE.
  select session.*
  into session_snapshot
  from public.admin_sessions as session
  where session.token_hash = target_token_hash
    and session.authentication_method = 'google_totp'
    and session.aal = 2
    and session.auth_user_id = target_auth_user_id
    and session.supabase_auth_session_id = target_supabase_auth_session_id
  ;

  if not found then
    return null;
  end if;
  select principal.*
  into principal_row
  from private.admin_principals as principal
  where principal.id = session_snapshot.principal_id
    and principal.auth_user_id = target_auth_user_id
  for key share;

  select membership.*
  into membership_row
  from private.admin_environment_memberships as membership
  where membership.id = session_snapshot.membership_id
    and membership.environment_id = session_snapshot.environment_id
    and membership.principal_id = session_snapshot.principal_id
  for key share;

  select session.*
  into session_row
  from public.admin_sessions as session
  where session.id = session_snapshot.id
    and session.token_hash = target_token_hash
    and session.authentication_method = 'google_totp'
    and session.aal = 2
    and session.auth_user_id = target_auth_user_id
    and session.supabase_auth_session_id = target_supabase_auth_session_id
    and session.environment_id = session_snapshot.environment_id
    and session.principal_id = session_snapshot.principal_id
    and session.membership_id = session_snapshot.membership_id
  for update;

  if not found then
    return null;
  end if;

  perform 1
  from auth.sessions as auth_session
  where auth_session.id = target_supabase_auth_session_id
    and auth_session.user_id = target_auth_user_id
  for key share;

  if not found then
    if session_row.revoked_at is null then
      update public.admin_sessions
      set
        revoked_at = effective_now,
        revoke_reason = 'auth_session_revoked',
        updated_at = effective_now
      where id = session_row.id;
    end if;
    return null;
  end if;

  -- Re-read the environment after the locked identity chain. This keeps the
  -- context decision current without participating in the owner-trigger lock
  -- graph; private table ACLs prevent callers from mutating it directly.
  select environment.*
  into environment_row
  from private.admin_environments as environment
  where environment.id = session_snapshot.environment_id;

  if session_row.revoked_at is not null
     or session_row.expires_at <= effective_now
     or session_row.step_up_verified_at is null
     or (
       target_min_step_up_verified_at is not null
       and session_row.step_up_verified_at < target_min_step_up_verified_at
     )
     or principal_row.id is null
     or principal_row.status <> 'active'
     or membership_row.id is null
     or membership_row.status <> 'active'
     or (
       membership_row.expires_at is not null
       and membership_row.expires_at <= effective_now
     )
     or (target_require_ai and not membership_row.can_use_ai)
     or (target_require_owner and membership_row.role <> 'owner')
     or environment_row.id is null
     or environment_row.status <> 'active'
     or not environment_row.current_deployment then
    return null;
  end if;

  if session_row.last_seen_at <= effective_now - interval '5 minutes' then
    update public.admin_sessions
    set
      last_seen_at = effective_now,
      idle_expires_at = expires_at,
      updated_at = effective_now
    where id = session_row.id
    returning * into session_row;
  end if;

  return jsonb_build_object(
    'admin_session_id', session_row.id,
    'environment_id', environment_row.id,
    'membership_id', membership_row.id,
    'principal_id', principal_row.id,
    'role', membership_row.role,
    'step_up_verified_at', session_row.step_up_verified_at
  );
end;
$$;

create function private.serialize_admin_ai_scope_v1(
  target_scope_kind text,
  target_scope_id uuid
)
returns void
language sql
volatile
security invoker
set search_path = ''
as $$
  select pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      target_scope_kind || ':' || target_scope_id::text,
      732
    )
  );
$$;

revoke all on function private.serialize_admin_ai_scope_v1(text, uuid)
  from public, anon, authenticated, service_role;

create function private.try_serialize_admin_ai_scope_v1(
  target_scope_kind text,
  target_scope_id uuid
)
returns boolean
language sql
volatile
security invoker
set search_path = ''
as $$
  select pg_catalog.pg_try_advisory_xact_lock(
    pg_catalog.hashtextextended(
      target_scope_kind || ':' || target_scope_id::text,
      732
    )
  );
$$;

revoke all on function private.try_serialize_admin_ai_scope_v1(text, uuid)
  from public, anon, authenticated, service_role;

-- Bound expensive bcrypt work without holding a shared rate-bucket row lock.
-- Environment slots cap aggregate CPU; the narrower network slots cap a
-- single source. Both use try-locks so a saturated caller receives a bounded
-- retry response instead of waiting through another bcrypt operation.
create function private.try_acquire_admin_ai_bcrypt_lease_v1(
  target_environment_id uuid,
  target_network_hmac text
)
returns boolean
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  slot_number integer;
  environment_slot_acquired boolean := false;
begin
  if target_environment_id is null
     or target_network_hmac is null
     or target_network_hmac !~ '^[0-9a-f]{64}$' then
    return false;
  end if;

  for slot_number in 1..4 loop
    if pg_catalog.pg_try_advisory_xact_lock(
      pg_catalog.hashtextextended(
        'bcrypt-environment:' || target_environment_id::text || ':' || slot_number::text,
        732
      )
    ) then
      environment_slot_acquired := true;
      exit;
    end if;
  end loop;

  if not environment_slot_acquired then
    return false;
  end if;

  for slot_number in 1..2 loop
    if pg_catalog.pg_try_advisory_xact_lock(
      pg_catalog.hashtextextended(
        'bcrypt-network:' || target_environment_id::text || ':' || target_network_hmac || ':' || slot_number::text,
        732
      )
    ) then
      return true;
    end if;
  end loop;

  return false;
end;
$$;

revoke all on function private.try_acquire_admin_ai_bcrypt_lease_v1(uuid, text)
  from public, anon, authenticated, service_role;

create function private.serialize_admin_ai_request_v1(target_request_id uuid)
returns void
language sql
volatile
security invoker
set search_path = ''
as $$
  select private.serialize_admin_ai_scope_v1('request', target_request_id);
$$;

revoke all on function private.serialize_admin_ai_request_v1(uuid)
  from public, anon, authenticated, service_role;

-- PostgreSQL validates this call target while compiling the policy setter.
-- The transactionally installed implementation replaces the unreachable
-- forward declaration before the migration can commit.
create function private.drain_admin_ai_policy_authority_v1(
  target_policy_id uuid,
  target_actor_admin_session_id uuid,
  target_effective_at timestamptz
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  raise exception 'Admin AI policy drain implementation is not installed'
    using errcode = '55000';
end;
$$;

create function private.get_admin_ai_unlock_runtime_gate_v1()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'ai_unlock_enabled', gate.ai_unlock_enabled,
    'remembered_browser_enabled', gate.remembered_browser_enabled
  )
  from private.admin_ai_unlock_runtime_gate as gate
  where gate.singleton;
$$;

create function private.set_admin_ai_policy_v1(
  target_token_hash text,
  target_auth_user_id uuid,
  target_supabase_auth_session_id uuid,
  target_membership_id uuid,
  target_allowed_actions text[],
  target_allowed_models text[],
  target_max_calls_per_lecture integer,
  target_max_calls_per_day integer,
  target_max_input_tokens_per_lecture bigint,
  target_max_input_tokens_per_day bigint,
  target_max_output_tokens_per_lecture bigint,
  target_max_output_tokens_per_day bigint,
  target_max_cost_microusd_per_lecture bigint,
  target_max_cost_microusd_per_day bigint,
  target_max_realtime_minutes_per_lecture integer,
  target_max_realtime_minutes_per_day integer,
  target_max_concurrency integer,
  target_valid_from timestamptz,
  target_valid_until timestamptz,
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
  context_value jsonb;
  target_membership private.admin_environment_memberships%rowtype;
  existing_policy private.admin_ai_policies%rowtype;
  policy_row private.admin_ai_policies%rowtype;
  policy_drain_result jsonb := jsonb_build_object(
    'assertion_challenges', 0,
    'master_authorizations', 0
  );
  next_version bigint;
  effective_now timestamptz := statement_timestamp();
begin
  if target_membership_id is null
     or target_request_id is null
     or target_allowed_actions is null
     or target_allowed_models is null
     or target_valid_from is null
     or target_valid_until is null
     or target_max_calls_per_lecture is null
     or target_max_calls_per_day is null
     or target_max_input_tokens_per_lecture is null
     or target_max_input_tokens_per_day is null
     or target_max_output_tokens_per_lecture is null
     or target_max_output_tokens_per_day is null
     or target_max_cost_microusd_per_lecture is null
     or target_max_cost_microusd_per_day is null
     or target_max_realtime_minutes_per_lecture is null
     or target_max_realtime_minutes_per_day is null
     or target_max_concurrency is null
     or target_valid_from > effective_now
     or target_valid_until <= effective_now
     or target_valid_until <= target_valid_from
     or cardinality(target_allowed_actions) not between 1 and 5
     or cardinality(target_allowed_models) not between 1 and 16
     or target_max_calls_per_lecture not between 1 and 10000
     or target_max_calls_per_day not between 1 and 100000
     or target_max_input_tokens_per_lecture <= 0
     or target_max_input_tokens_per_day <= 0
     or target_max_output_tokens_per_lecture <= 0
     or target_max_output_tokens_per_day <= 0
     or target_max_cost_microusd_per_lecture <= 0
     or target_max_cost_microusd_per_day <= 0
     or target_max_realtime_minutes_per_lecture not between 0 and 90
     or target_max_realtime_minutes_per_day not between 0 and 1440
     or target_max_concurrency not between 1 and 32
     or exists (
       select 1
       from unnest(target_allowed_actions) as action(value)
       where value is null
          or value not in (
            'academic_answers',
            'captions',
            'material_analysis',
            'poll_suggestions',
            'summaries'
          )
     )
     or (
       select count(*)
       from unnest(target_allowed_actions) as action(value)
     ) <> (
       select count(distinct value)
       from unnest(target_allowed_actions) as action(value)
     )
     or exists (
       select 1
       from unnest(target_allowed_models) as model(value)
       where value is null
          or char_length(value) not between 1 and 120
          or value !~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,119}$'
     )
     or (
       select count(*)
       from unnest(target_allowed_models) as model(value)
     ) <> (
       select count(distinct value)
       from unnest(target_allowed_models) as model(value)
     ) then
    raise exception 'invalid Admin AI policy' using errcode = '22023';
  end if;

  perform private.serialize_admin_ai_request_v1(target_request_id);

  context_value := private.require_admin_ai_context_v1(
    target_token_hash,
    target_auth_user_id,
    target_supabase_auth_session_id,
    null,
    false,
    true
  );

  if context_value is null then
    return null;
  end if;

  perform private.serialize_admin_ai_scope_v1(
    'policy-membership',
    target_membership_id
  );

  select policy.*
  into existing_policy
  from private.admin_ai_policies as policy
  where policy.request_id = target_request_id;

  if found then
    if existing_policy.environment_id = (context_value ->> 'environment_id')::uuid
       and existing_policy.membership_id = target_membership_id
       and existing_policy.created_by_membership_id = (context_value ->> 'membership_id')::uuid
       and existing_policy.created_by_admin_session_id = (context_value ->> 'admin_session_id')::uuid
       and existing_policy.allowed_actions is not distinct from target_allowed_actions
       and existing_policy.allowed_models is not distinct from target_allowed_models
       and existing_policy.max_calls_per_lecture is not distinct from target_max_calls_per_lecture
       and existing_policy.max_calls_per_day is not distinct from target_max_calls_per_day
       and existing_policy.max_input_tokens_per_lecture is not distinct from target_max_input_tokens_per_lecture
       and existing_policy.max_input_tokens_per_day is not distinct from target_max_input_tokens_per_day
       and existing_policy.max_output_tokens_per_lecture is not distinct from target_max_output_tokens_per_lecture
       and existing_policy.max_output_tokens_per_day is not distinct from target_max_output_tokens_per_day
       and existing_policy.max_cost_microusd_per_lecture is not distinct from target_max_cost_microusd_per_lecture
       and existing_policy.max_cost_microusd_per_day is not distinct from target_max_cost_microusd_per_day
       and existing_policy.max_realtime_minutes_per_lecture is not distinct from target_max_realtime_minutes_per_lecture
       and existing_policy.max_realtime_minutes_per_day is not distinct from target_max_realtime_minutes_per_day
       and existing_policy.max_concurrency is not distinct from target_max_concurrency
       and existing_policy.valid_from is not distinct from target_valid_from
       and existing_policy.valid_until is not distinct from target_valid_until then
      return jsonb_build_object(
        'id', existing_policy.id,
        'membership_id', existing_policy.membership_id,
        'status', existing_policy.status,
        'version', existing_policy.version
      );
    end if;
    return null;
  end if;

  -- Exact retries are authorized by the still-valid AAL2 identity context and
  -- immutable request binding above. Fresh step-up is required only to create
  -- new policy authority, never to recover an already-committed response.
  if context_value ->> 'step_up_verified_at' is null
     or (context_value ->> 'step_up_verified_at')::timestamptz
       < effective_now - interval '5 minutes' then
    return null;
  end if;

  select membership.*
  into target_membership
  from private.admin_environment_memberships as membership
  where membership.id = target_membership_id
    and membership.environment_id = (context_value ->> 'environment_id')::uuid
    and membership.status = 'active'
    and membership.can_use_ai
    and (membership.expires_at is null or membership.expires_at > effective_now)
  for key share;

  if not found then
    return null;
  end if;

  select coalesce(max(policy.version), 0) + 1
  into next_version
  from private.admin_ai_policies as policy
  where policy.environment_id = target_membership.environment_id
    and policy.membership_id = target_membership.id;

  select policy.*
  into existing_policy
  from private.admin_ai_policies as policy
  where policy.environment_id = target_membership.environment_id
    and policy.membership_id = target_membership.id
    and policy.status = 'active'
  for update;

  if found then
    update private.admin_ai_policies
    set
      status = 'superseded',
      revoked_at = effective_now,
      updated_at = effective_now
    where id = existing_policy.id;

    policy_drain_result := private.drain_admin_ai_policy_authority_v1(
      existing_policy.id,
      (context_value ->> 'admin_session_id')::uuid,
      effective_now
    );
  end if;

  insert into private.admin_ai_policies (
    environment_id,
    membership_id,
    allowed_actions,
    allowed_models,
    max_calls_per_lecture,
    max_calls_per_day,
    max_input_tokens_per_lecture,
    max_input_tokens_per_day,
    max_output_tokens_per_lecture,
    max_output_tokens_per_day,
    max_cost_microusd_per_lecture,
    max_cost_microusd_per_day,
    max_realtime_minutes_per_lecture,
    max_realtime_minutes_per_day,
    max_concurrency,
    valid_from,
    valid_until,
    version,
    supersedes_policy_id,
    created_by_membership_id,
    created_by_admin_session_id,
    request_id
  ) values (
    target_membership.environment_id,
    target_membership.id,
    target_allowed_actions,
    target_allowed_models,
    target_max_calls_per_lecture,
    target_max_calls_per_day,
    target_max_input_tokens_per_lecture,
    target_max_input_tokens_per_day,
    target_max_output_tokens_per_lecture,
    target_max_output_tokens_per_day,
    target_max_cost_microusd_per_lecture,
    target_max_cost_microusd_per_day,
    target_max_realtime_minutes_per_lecture,
    target_max_realtime_minutes_per_day,
    target_max_concurrency,
    target_valid_from,
    target_valid_until,
    next_version,
    existing_policy.id,
    (context_value ->> 'membership_id')::uuid,
    (context_value ->> 'admin_session_id')::uuid,
    target_request_id
  ) returning * into policy_row;

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
    policy_row.environment_id,
    (context_value ->> 'principal_id')::uuid,
    (context_value ->> 'membership_id')::uuid,
    (context_value ->> 'admin_session_id')::uuid,
    'admin_ai_policy.set',
    'admin_ai_policy',
    policy_row.id::text,
    'accepted',
    jsonb_build_object(
      'authority_drain', policy_drain_result,
      'membership_id', policy_row.membership_id,
      'version', policy_row.version
    )
  );

  return jsonb_build_object(
    'id', policy_row.id,
    'membership_id', policy_row.membership_id,
    'status', policy_row.status,
    'version', policy_row.version
  );
end;
$$;

create function private.drain_admin_ai_master_authority_v1(
  target_source_kind text,
  target_source_id uuid,
  target_actor_id text,
  target_reason text,
  target_effective_at timestamptz
)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
set statement_timeout = '5s'
set lock_timeout = '750ms'
as $$
declare
  master_candidate record;
  master_row public.lecture_ai_master_authorizations%rowtype;
  revoked_master_authorizations integer := 0;
begin
  if target_source_kind not in ('browser_credential', 'factor', 'policy')
     or target_source_id is null
     or target_actor_id is null
     or char_length(target_actor_id) not between 1 and 200
     or target_reason not in (
       'browser_credential_expired',
       'browser_credential_revoked',
       'factor_revoked',
       'factor_rotated',
       'policy_superseded'
     )
     or target_effective_at is null
     or target_effective_at > statement_timestamp() + interval '1 minute' then
    raise exception 'invalid Admin AI master authority drain' using errcode = '22023';
  end if;

  for master_candidate in
    select master.id, master.lecture_session_id
    from public.lecture_ai_master_authorizations as master
    where master.status = 'active'
      and (
        (target_source_kind = 'factor' and master.unlock_factor_id = target_source_id)
        or (
          target_source_kind = 'browser_credential'
          and master.browser_credential_id = target_source_id
        )
        or (target_source_kind = 'policy' and master.ai_policy_id = target_source_id)
      )
    order by master.lecture_session_id, master.id
  loop
    perform 1
    from public.lecture_sessions as lecture
    where lecture.id = master_candidate.lecture_session_id
    for update;

    select master.*
    into master_row
    from public.lecture_ai_master_authorizations as master
    where master.id = master_candidate.id
      and master.status = 'active'
      and (
        (target_source_kind = 'factor' and master.unlock_factor_id = target_source_id)
        or (
          target_source_kind = 'browser_credential'
          and master.browser_credential_id = target_source_id
        )
        or (target_source_kind = 'policy' and master.ai_policy_id = target_source_id)
      )
    for update;

    if not found then
      continue;
    end if;

    update public.lecture_ai_master_authorizations as master
    set
      status = 'revoked',
      revoked_at = target_effective_at,
      revoked_by_actor_id = target_actor_id,
      revoke_reason = target_reason,
      version = master.version + 1,
      updated_at = target_effective_at
    where master.id = master_row.id
    returning master.* into master_row;

    revoked_master_authorizations := revoked_master_authorizations + 1;

    perform private.revoke_pending_ai_grants_for_lecture(
      master_row.lecture_session_id,
      target_reason
    );
    perform private.stop_summary_for_ai_master_transition(
      master_row.lecture_session_id,
      target_reason
    );
    perform private.stop_lecture_ai_control(
      master_row.lecture_session_id,
      target_reason,
      target_actor_id
    );

    insert into public.ai_master_authorization_events (
      authorization_id,
      lecture_session_id,
      event_type,
      actor_id,
      scope,
      actions,
      reason
    ) values (
      master_row.id,
      master_row.lecture_session_id,
      'revoked',
      target_actor_id,
      master_row.scope,
      master_row.actions,
      target_reason
    );
  end loop;

  return revoked_master_authorizations;
end;
$$;

create function private.drain_admin_ai_browser_credential_authority_v1(
  target_browser_credential_id uuid,
  target_actor_id text,
  target_reason text,
  target_effective_at timestamptz default statement_timestamp()
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  superseded_assertion_challenges integer := 0;
  revoked_master_authorizations integer := 0;
begin
  if target_browser_credential_id is null
     or target_actor_id is null
     or target_reason not in ('browser_credential_expired', 'browser_credential_revoked')
     or target_effective_at is null then
    raise exception 'invalid browser credential authority drain' using errcode = '22023';
  end if;

  update private.admin_ai_browser_assertion_challenges
  set status = 'superseded', updated_at = target_effective_at
  where browser_credential_id = target_browser_credential_id
    and status = 'pending';
  get diagnostics superseded_assertion_challenges = row_count;

  revoked_master_authorizations := private.drain_admin_ai_master_authority_v1(
    'browser_credential',
    target_browser_credential_id,
    target_actor_id,
    target_reason,
    target_effective_at
  );

  return jsonb_build_object(
    'assertion_challenges', superseded_assertion_challenges,
    'master_authorizations', revoked_master_authorizations
  );
end;
$$;

create or replace function private.drain_admin_ai_policy_authority_v1(
  target_policy_id uuid,
  target_actor_admin_session_id uuid,
  target_effective_at timestamptz
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  actor_id_value text;
  superseded_assertion_challenges integer := 0;
  revoked_master_authorizations integer := 0;
begin
  if target_policy_id is null
     or target_actor_admin_session_id is null
     or target_effective_at is null then
    raise exception 'invalid policy authority drain' using errcode = '22023';
  end if;

  actor_id_value := 'admin-session:' || target_actor_admin_session_id::text;

  update private.admin_ai_browser_assertion_challenges
  set status = 'superseded', updated_at = target_effective_at
  where policy_id = target_policy_id
    and status = 'pending';
  get diagnostics superseded_assertion_challenges = row_count;

  revoked_master_authorizations := private.drain_admin_ai_master_authority_v1(
    'policy',
    target_policy_id,
    actor_id_value,
    'policy_superseded',
    target_effective_at
  );

  return jsonb_build_object(
    'assertion_challenges', superseded_assertion_challenges,
    'master_authorizations', revoked_master_authorizations
  );
end;
$$;

create function private.drain_admin_ai_factor_authority_v1(
  target_factor_id uuid,
  target_actor_admin_session_id uuid,
  target_reason text,
  target_effective_at timestamptz default statement_timestamp()
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
  actor_id_value text;
  master_candidate record;
  master_row public.lecture_ai_master_authorizations%rowtype;
  revoked_browser_credentials integer := 0;
  revoked_master_authorizations integer := 0;
  superseded_assertion_challenges integer := 0;
  superseded_enrollment_nonces integer := 0;
begin
  if target_factor_id is null
     or target_actor_admin_session_id is null
     or target_reason not in ('factor_revoked', 'factor_rotated')
     or target_effective_at is null
     or target_effective_at > statement_timestamp() + interval '1 minute' then
    raise exception 'invalid Admin AI factor authority drain' using errcode = '22023';
  end if;

  actor_id_value := 'admin-session:' || target_actor_admin_session_id::text;

  update private.admin_ai_browser_assertion_challenges
  set
    status = 'superseded',
    updated_at = target_effective_at
  where factor_id = target_factor_id
    and status = 'pending';
  get diagnostics superseded_assertion_challenges = row_count;

  update private.admin_ai_browser_enrollment_nonces
  set
    status = 'superseded',
    updated_at = target_effective_at
  where factor_id = target_factor_id
    and status = 'pending';
  get diagnostics superseded_enrollment_nonces = row_count;

  update private.admin_ai_browser_credentials
  set
    status = 'revoked',
    revoked_at = target_effective_at,
    revoked_by_admin_session_id = target_actor_admin_session_id,
    revoke_reason = target_reason,
    updated_at = target_effective_at
  where source_factor_id = target_factor_id
    and status = 'active';
  get diagnostics revoked_browser_credentials = row_count;

  for master_candidate in
    select master.id, master.lecture_session_id
    from public.lecture_ai_master_authorizations as master
    where master.unlock_factor_id = target_factor_id
      and master.status = 'active'
    order by master.lecture_session_id, master.id
  loop
    perform 1
    from public.lecture_sessions as lecture
    where lecture.id = master_candidate.lecture_session_id
    for update;

    select master.*
    into master_row
    from public.lecture_ai_master_authorizations as master
    where master.id = master_candidate.id
      and master.unlock_factor_id = target_factor_id
      and master.status = 'active'
    for update;

    if not found then
      continue;
    end if;

    update public.lecture_ai_master_authorizations as master
    set
      status = 'revoked',
      revoked_at = target_effective_at,
      revoked_by_actor_id = actor_id_value,
      revoke_reason = target_reason,
      version = master.version + 1,
      updated_at = target_effective_at
    where master.id = master_row.id
    returning master.* into master_row;

    revoked_master_authorizations := revoked_master_authorizations + 1;

    perform private.revoke_pending_ai_grants_for_lecture(
      master_row.lecture_session_id,
      target_reason
    );
    perform private.stop_summary_for_ai_master_transition(
      master_row.lecture_session_id,
      target_reason
    );
    perform private.stop_lecture_ai_control(
      master_row.lecture_session_id,
      target_reason,
      actor_id_value
    );

    insert into public.ai_master_authorization_events (
      authorization_id,
      lecture_session_id,
      event_type,
      actor_id,
      scope,
      actions,
      reason
    ) values (
      master_row.id,
      master_row.lecture_session_id,
      'revoked',
      actor_id_value,
      master_row.scope,
      master_row.actions,
      target_reason
    );
  end loop;

  return jsonb_build_object(
    'assertion_challenges', superseded_assertion_challenges,
    'browser_credentials', revoked_browser_credentials,
    'enrollment_nonces', superseded_enrollment_nonces,
    'master_authorizations', revoked_master_authorizations
  );
end;
$$;

create function private.enroll_admin_ai_pin_v1(
  target_token_hash text,
  target_auth_user_id uuid,
  target_supabase_auth_session_id uuid,
  target_peppered_pin_hmac text,
  target_pin_pepper_version integer,
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
  existing_factor private.admin_ai_unlock_factors%rowtype;
  factor_row private.admin_ai_unlock_factors%rowtype;
  next_version bigint;
  verifier_value text;
  drain_result jsonb := jsonb_build_object(
    'assertion_challenges', 0,
    'browser_credentials', 0,
    'enrollment_nonces', 0,
    'master_authorizations', 0
  );
  effective_now timestamptz := statement_timestamp();
begin
  if target_peppered_pin_hmac is null
     or target_peppered_pin_hmac !~ '^[0-9a-f]{64}$'
     or target_pin_pepper_version is null
     or target_pin_pepper_version < 1
     or target_request_id is null then
    raise exception 'invalid Admin AI PIN enrollment' using errcode = '22023';
  end if;

  if not exists (
    select 1
    from private.admin_ai_unlock_runtime_gate as gate
    where gate.singleton and gate.ai_unlock_enabled
  ) then
    raise exception 'Admin AI unlock is disabled' using errcode = 'P7320';
  end if;

  perform private.serialize_admin_ai_request_v1(target_request_id);

  context_value := private.require_admin_ai_context_v1(
    target_token_hash,
    target_auth_user_id,
    target_supabase_auth_session_id,
    null,
    true,
    false
  );

  if context_value is null then
    return null;
  end if;

  perform private.serialize_admin_ai_scope_v1(
    'factor-membership',
    (context_value ->> 'membership_id')::uuid
  );

  select factor.*
  into existing_factor
  from private.admin_ai_unlock_factors as factor
  where factor.enrollment_request_id = target_request_id;

  if found then
    if existing_factor.environment_id = (context_value ->> 'environment_id')::uuid
       and existing_factor.principal_id = (context_value ->> 'principal_id')::uuid
       and existing_factor.membership_id = (context_value ->> 'membership_id')::uuid
       and existing_factor.enrolled_by_admin_session_id = (context_value ->> 'admin_session_id')::uuid then
      -- The request id is the idempotency key. Once it is bound to this exact
      -- actor/session/scope, retries return the committed result without
      -- inspecting PIN material. This keeps stale retries from becoming a PIN
      -- oracle and guarantees that bcrypt runs only for a fresh new request.
      return jsonb_build_object(
        'factor_id', existing_factor.id,
        'factor_version', existing_factor.factor_version,
        'pin_pepper_version', existing_factor.pin_pepper_version,
        'status', existing_factor.status
      );
    end if;
    return null;
  end if;

  -- The actor/session/scope-bound idempotency key above is replayable after the
  -- five-minute mutation window without inspecting PIN material. Only a new
  -- request can create a factor version and cross the fresh-step-up boundary.
  if context_value ->> 'step_up_verified_at' is null
     or (context_value ->> 'step_up_verified_at')::timestamptz
       < effective_now - interval '5 minutes' then
    return null;
  end if;

  select coalesce(max(factor.factor_version), 0) + 1
  into next_version
  from private.admin_ai_unlock_factors as factor
  where factor.environment_id = (context_value ->> 'environment_id')::uuid
    and factor.membership_id = (context_value ->> 'membership_id')::uuid;

  select factor.*
  into existing_factor
  from private.admin_ai_unlock_factors as factor
  where factor.environment_id = (context_value ->> 'environment_id')::uuid
    and factor.membership_id = (context_value ->> 'membership_id')::uuid
    and factor.status = 'active'
  for update;

  verifier_value := extensions.crypt(
    target_peppered_pin_hmac,
    extensions.gen_salt('bf', 12)
  );

  if found then
    update private.admin_ai_unlock_factors
    set
      status = 'rotated',
      revoked_at = effective_now,
      revoke_reason = 'factor_rotated',
      updated_at = effective_now
    where id = existing_factor.id;

    drain_result := private.drain_admin_ai_factor_authority_v1(
      existing_factor.id,
      (context_value ->> 'admin_session_id')::uuid,
      'factor_rotated',
      effective_now
    );
  end if;

  insert into private.admin_ai_unlock_factors (
    environment_id,
    principal_id,
    membership_id,
    pin_verifier,
    pin_pepper_version,
    factor_version,
    enrolled_by_admin_session_id,
    enrolled_step_up_verified_at,
    rotated_from_factor_id,
    enrollment_request_id
  ) values (
    (context_value ->> 'environment_id')::uuid,
    (context_value ->> 'principal_id')::uuid,
    (context_value ->> 'membership_id')::uuid,
    verifier_value,
    target_pin_pepper_version,
    next_version,
    (context_value ->> 'admin_session_id')::uuid,
    (context_value ->> 'step_up_verified_at')::timestamptz,
    existing_factor.id,
    target_request_id
  ) returning * into factor_row;

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
    factor_row.environment_id,
    factor_row.principal_id,
    factor_row.membership_id,
    factor_row.enrolled_by_admin_session_id,
    case when factor_row.factor_version = 1
      then 'admin_ai_factor.enroll'
      else 'admin_ai_factor.rotate'
    end,
    'admin_ai_unlock_factor',
    factor_row.id::text,
    'accepted',
    jsonb_build_object(
      'authority_drain', drain_result,
      'factor_version', factor_row.factor_version,
      'pin_pepper_version', factor_row.pin_pepper_version
    )
  );

  return jsonb_build_object(
    'factor_id', factor_row.id,
    'factor_version', factor_row.factor_version,
    'pin_pepper_version', factor_row.pin_pepper_version,
    'status', factor_row.status
  );
end;
$$;

create function private.get_admin_ai_pin_factor_metadata_v1(
  target_token_hash text,
  target_auth_user_id uuid,
  target_supabase_auth_session_id uuid,
  target_network_hmac text,
  target_intent_digest text,
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
  context_value jsonb;
  factor_row private.admin_ai_unlock_factors%rowtype;
  discovery_row private.admin_ai_pin_discovery_receipts%rowtype;
  effective_now timestamptz := statement_timestamp();
  blocked_until_value timestamptz;
  retry_after_value integer := 0;
begin
  if target_network_hmac is null
     or target_network_hmac !~ '^[0-9a-f]{64}$'
     or target_intent_digest is null
     or target_intent_digest !~ '^[0-9a-f]{64}$'
     or target_request_id is null then
    raise exception 'invalid Admin AI PIN discovery' using errcode = '22023';
  end if;

  if not exists (
    select 1
    from private.admin_ai_unlock_runtime_gate as gate
    where gate.singleton and gate.ai_unlock_enabled
  ) then
    raise exception 'Admin AI unlock is disabled' using errcode = 'P7320';
  end if;

  perform private.serialize_admin_ai_request_v1(target_request_id);

  context_value := private.require_admin_ai_context_v1(
    target_token_hash,
    target_auth_user_id,
    target_supabase_auth_session_id,
    null,
    true,
    false
  );

  if context_value is null then
    return null;
  end if;

  perform private.serialize_admin_ai_scope_v1(
    'factor-membership',
    (context_value ->> 'membership_id')::uuid
  );

  select discovery.*
  into discovery_row
  from private.admin_ai_pin_discovery_receipts as discovery
  where discovery.request_id = target_request_id;

  if found then
    if discovery_row.intent_digest = target_intent_digest
       and discovery_row.network_hmac = target_network_hmac
       and discovery_row.environment_id = (context_value ->> 'environment_id')::uuid
       and discovery_row.principal_id = (context_value ->> 'principal_id')::uuid
       and discovery_row.membership_id = (context_value ->> 'membership_id')::uuid
       and discovery_row.admin_session_id = (context_value ->> 'admin_session_id')::uuid
       and discovery_row.expires_at > effective_now
       and exists (
         select 1
         from private.admin_ai_unlock_factors as factor
         where factor.id = discovery_row.factor_id
           and factor.factor_version = discovery_row.factor_version
           and factor.pin_pepper_version = discovery_row.pin_pepper_version
           and factor.status = 'active'
       ) then
      return jsonb_build_object(
        'available', true,
        'expires_at', discovery_row.expires_at,
        'factor_version', discovery_row.factor_version,
        'pin_pepper_version', discovery_row.pin_pepper_version,
        'retry_after_seconds', 0
      );
    end if;
    return null;
  end if;

  -- A read-only precheck preserves cheap cached denials. Crucially, neither a
  -- shared environment bucket row nor a just-inserted unique-key tuple is held
  -- while bcrypt runs, so independent teachers can verify concurrently.
  select max(limiter.locked_until)
  into blocked_until_value
  from private.admin_ai_unlock_rate_limits as limiter
  where limiter.environment_id = (context_value ->> 'environment_id')::uuid
    and limiter.locked_until > effective_now
    and (
      (limiter.bucket_kind = 'environment' and limiter.bucket_key = 'environment')
      or (
        limiter.bucket_kind = 'membership'
        and limiter.bucket_key = context_value ->> 'membership_id'
      )
      or (
        limiter.bucket_kind = 'network'
        and limiter.bucket_key = target_network_hmac
      )
    );

  if blocked_until_value is not null then
    retry_after_value := least(
      900,
      greatest(1, ceil(extract(epoch from blocked_until_value - effective_now))::integer)
    );
    return jsonb_build_object(
      'available', false,
      'reason_code', 'unlock_temporarily_unavailable',
      'retry_after_seconds', retry_after_value
    );
  end if;

  select factor.*
  into factor_row
  from private.admin_ai_unlock_factors as factor
  where factor.environment_id = (context_value ->> 'environment_id')::uuid
    and factor.principal_id = (context_value ->> 'principal_id')::uuid
    and factor.membership_id = (context_value ->> 'membership_id')::uuid
    and factor.status = 'active'
  for key share;

  if not found then
    return null;
  end if;

  insert into private.admin_ai_pin_discovery_receipts (
    request_id,
    intent_digest,
    network_hmac,
    environment_id,
    principal_id,
    membership_id,
    admin_session_id,
    factor_id,
    factor_version,
    pin_pepper_version,
    occurred_at,
    expires_at
  ) values (
    target_request_id,
    target_intent_digest,
    target_network_hmac,
    (context_value ->> 'environment_id')::uuid,
    (context_value ->> 'principal_id')::uuid,
    (context_value ->> 'membership_id')::uuid,
    (context_value ->> 'admin_session_id')::uuid,
    factor_row.id,
    factor_row.factor_version,
    factor_row.pin_pepper_version,
    effective_now,
    effective_now + interval '5 minutes'
  ) returning * into discovery_row;

  insert into private.admin_audit_events (
    request_id,
    environment_id,
    actor_principal_id,
    actor_membership_id,
    actor_session_id,
    action,
    target_type,
    result,
    metadata
  ) values (
    target_request_id,
    discovery_row.environment_id,
    discovery_row.principal_id,
    discovery_row.membership_id,
    discovery_row.admin_session_id,
    'admin_ai_pin.discover',
    'admin_ai_pin_discovery',
    'accepted',
    jsonb_build_object(
      'factor_version', discovery_row.factor_version,
      'pin_pepper_version', discovery_row.pin_pepper_version
    )
  );

  return jsonb_build_object(
    'available', true,
    'expires_at', discovery_row.expires_at,
    'factor_version', discovery_row.factor_version,
    'pin_pepper_version', discovery_row.pin_pepper_version,
    'retry_after_seconds', 0
  );
end;
$$;

create function private.consume_admin_ai_pin_attempt_v1(
  target_token_hash text,
  target_auth_user_id uuid,
  target_supabase_auth_session_id uuid,
  target_pin_pepper_version integer,
  target_peppered_pin_hmac text,
  target_network_hmac text,
  target_intent_digest text,
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
  factor_row private.admin_ai_unlock_factors%rowtype;
  discovery_row private.admin_ai_pin_discovery_receipts%rowtype;
  receipt_row private.admin_ai_unlock_attempt_receipts%rowtype;
  effective_now timestamptz := statement_timestamp();
  blocked_until_value timestamptz;
  bcrypt_lease_acquired boolean := false;
  retry_after_value integer := 0;
  verified_value boolean := false;
  reason_value text := 'invalid_unlock';
  pin_proof_digest_value text;
begin
  if target_pin_pepper_version is null
     or target_pin_pepper_version < 1
     or target_peppered_pin_hmac is null
     or target_peppered_pin_hmac !~ '^[0-9a-f]{64}$'
     or target_network_hmac is null
     or target_network_hmac !~ '^[0-9a-f]{64}$'
     or target_intent_digest is null
     or target_intent_digest !~ '^[0-9a-f]{64}$'
     or target_request_id is null then
    raise exception 'invalid Admin AI unlock verification' using errcode = '22023';
  end if;

  if not exists (
    select 1
    from private.admin_ai_unlock_runtime_gate as gate
    where gate.singleton and gate.ai_unlock_enabled
  ) then
    raise exception 'Admin AI unlock is disabled' using errcode = 'P7320';
  end if;

  perform private.serialize_admin_ai_request_v1(target_request_id);

  context_value := private.require_admin_ai_context_v1(
    target_token_hash,
    target_auth_user_id,
    target_supabase_auth_session_id,
    null,
    true,
    false
  );

  if context_value is null then
    return null;
  end if;

  perform private.serialize_admin_ai_scope_v1(
    'factor-membership',
    (context_value ->> 'membership_id')::uuid
  );

  pin_proof_digest_value := encode(
    extensions.digest(
      convert_to(
        target_pin_pepper_version::text || ':' || target_peppered_pin_hmac,
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );

  select discovery.*
  into discovery_row
  from private.admin_ai_pin_discovery_receipts as discovery
  where discovery.request_id = target_request_id
    and discovery.intent_digest = target_intent_digest
    and discovery.network_hmac = target_network_hmac
    and discovery.environment_id = (context_value ->> 'environment_id')::uuid
    and discovery.principal_id = (context_value ->> 'principal_id')::uuid
    and discovery.membership_id = (context_value ->> 'membership_id')::uuid
    and discovery.admin_session_id = (context_value ->> 'admin_session_id')::uuid
    and discovery.pin_pepper_version = target_pin_pepper_version
    and discovery.expires_at > effective_now;

  if not found then
    return null;
  end if;

  select receipt.*
  into receipt_row
  from private.admin_ai_unlock_attempt_receipts as receipt
  where receipt.request_id = target_request_id;

  if found then
    if receipt_row.intent_digest = target_intent_digest
       and receipt_row.environment_id = (context_value ->> 'environment_id')::uuid
       and receipt_row.principal_id = (context_value ->> 'principal_id')::uuid
       and receipt_row.membership_id = (context_value ->> 'membership_id')::uuid
       and receipt_row.admin_session_id = (context_value ->> 'admin_session_id')::uuid
       and receipt_row.input_pin_pepper_version is not distinct from target_pin_pepper_version
       and receipt_row.input_pin_proof_digest is not distinct from pin_proof_digest_value then
      if receipt_row.verified and (
        receipt_row.occurred_at <= effective_now - interval '5 minutes'
        or not exists (
          select 1
          from private.admin_ai_unlock_factors as factor
          where factor.id = receipt_row.factor_id
            and factor.factor_version = receipt_row.factor_version
            and factor.pin_pepper_version = receipt_row.factor_pin_pepper_version
            and factor.environment_id = receipt_row.environment_id
            and factor.principal_id = receipt_row.principal_id
            and factor.membership_id = receipt_row.membership_id
            and factor.status = 'active'
        )
      ) then
        return jsonb_build_object(
          'factor_id', null,
          'factor_version', null,
          'reason_code', 'invalid_unlock',
          'retry_after_seconds', 0,
          'verified', false,
          'verified_at', receipt_row.occurred_at
        );
      end if;

      return jsonb_build_object(
        'factor_id', receipt_row.factor_id,
        'factor_version', receipt_row.factor_version,
        'reason_code', receipt_row.reason_code,
        'retry_after_seconds', receipt_row.retry_after_seconds,
        'verified', receipt_row.verified,
        'verified_at', receipt_row.occurred_at
      );
    end if;
    return null;
  end if;

  bcrypt_lease_acquired := private.try_acquire_admin_ai_bcrypt_lease_v1(
    (context_value ->> 'environment_id')::uuid,
    target_network_hmac
  );

  if not bcrypt_lease_acquired then
    -- A full fixed-slot lease is a capacity denial, not a failed PIN. Cache it
    -- as the exact request receipt without incrementing any abuse counter.
    retry_after_value := 1;
    reason_value := 'unlock_temporarily_unavailable';
  else
    -- A read-only precheck preserves cheap cached denials. Crucially, neither a
    -- shared environment bucket row nor a just-inserted unique-key tuple is held
    -- while bcrypt runs, so independent teachers can verify concurrently.
    select max(limiter.locked_until)
    into blocked_until_value
    from private.admin_ai_unlock_rate_limits as limiter
    where limiter.environment_id = (context_value ->> 'environment_id')::uuid
      and limiter.locked_until > effective_now
      and (
        (limiter.bucket_kind = 'environment' and limiter.bucket_key = 'environment')
        or (
          limiter.bucket_kind = 'membership'
          and limiter.bucket_key = context_value ->> 'membership_id'
        )
        or (
          limiter.bucket_kind = 'network'
          and limiter.bucket_key = target_network_hmac
        )
      );

    if blocked_until_value is null then
      select factor.*
      into factor_row
      from private.admin_ai_unlock_factors as factor
      where factor.environment_id = (context_value ->> 'environment_id')::uuid
        and factor.principal_id = (context_value ->> 'principal_id')::uuid
        and factor.membership_id = (context_value ->> 'membership_id')::uuid
        and factor.id = discovery_row.factor_id
        and factor.factor_version = discovery_row.factor_version
        and factor.pin_pepper_version = target_pin_pepper_version
        and factor.status = 'active'
      for update;

      if found then
        verified_value := extensions.crypt(
          target_peppered_pin_hmac,
          factor_row.pin_verifier
        ) = factor_row.pin_verifier;
      end if;
    end if;

    -- Create missing buckets only after bcrypt, then lock all applicable rows in
    -- one canonical order and recheck under lock before mutating any counter.
    insert into private.admin_ai_unlock_rate_limits (
    environment_id,
    bucket_kind,
    bucket_key,
    membership_id,
    network_hmac,
    window_started_at
  ) values
    (
      (context_value ->> 'environment_id')::uuid,
      'environment',
      'environment',
      null,
      null,
      effective_now
    ),
    (
      (context_value ->> 'environment_id')::uuid,
      'membership',
      context_value ->> 'membership_id',
      (context_value ->> 'membership_id')::uuid,
      null,
      effective_now
    ),
    (
      (context_value ->> 'environment_id')::uuid,
      'network',
      target_network_hmac,
      null,
      target_network_hmac,
      effective_now
    )
  on conflict (environment_id, bucket_kind, bucket_key) do nothing;

  perform 1
  from private.admin_ai_unlock_rate_limits as limiter
  where limiter.environment_id = (context_value ->> 'environment_id')::uuid
    and (
      (limiter.bucket_kind = 'environment' and limiter.bucket_key = 'environment')
      or (
        limiter.bucket_kind = 'membership'
        and limiter.bucket_key = context_value ->> 'membership_id'
      )
      or (
        limiter.bucket_kind = 'network'
        and limiter.bucket_key = target_network_hmac
      )
    )
  order by limiter.bucket_kind, limiter.bucket_key
  for update;

  select max(limiter.locked_until)
  into blocked_until_value
  from private.admin_ai_unlock_rate_limits as limiter
  where limiter.environment_id = (context_value ->> 'environment_id')::uuid
    and limiter.locked_until > effective_now
    and (
      (limiter.bucket_kind = 'environment' and limiter.bucket_key = 'environment')
      or (
        limiter.bucket_kind = 'membership'
        and limiter.bucket_key = context_value ->> 'membership_id'
      )
      or (
        limiter.bucket_kind = 'network'
        and limiter.bucket_key = target_network_hmac
      )
    );

  if blocked_until_value is not null then
    verified_value := false;
    retry_after_value := least(
      900,
      greatest(
        1,
        ceil(extract(epoch from blocked_until_value - effective_now))::integer
      )
    );
    reason_value := 'unlock_temporarily_unavailable';
  elsif verified_value then
    reason_value := 'verified';
    update private.admin_ai_unlock_factors
    set
      last_verified_at = effective_now,
      updated_at = effective_now
    where id = factor_row.id;
  else
    update private.admin_ai_unlock_rate_limits as limiter
    set
      failed_attempts = case
        when limiter.window_started_at <= effective_now - case limiter.bucket_kind
          when 'environment' then interval '1 minute'
          else interval '15 minutes'
        end then 1
        else limiter.failed_attempts + 1
      end,
      window_started_at = case
        when limiter.window_started_at <= effective_now - case limiter.bucket_kind
          when 'environment' then interval '1 minute'
          else interval '15 minutes'
        end then effective_now
        else limiter.window_started_at
      end,
      locked_until = case
        when (
          case
            when limiter.window_started_at <= effective_now - case limiter.bucket_kind
              when 'environment' then interval '1 minute'
              else interval '15 minutes'
            end then 1
            else limiter.failed_attempts + 1
          end
        ) >= case limiter.bucket_kind
          when 'membership' then 5
          when 'network' then 30
          else 300
        end then greatest(
          limiter.locked_until,
          effective_now + case limiter.bucket_kind
            when 'environment' then interval '60 seconds'
            else interval '15 minutes'
          end
        )
        else limiter.locked_until
      end,
      last_failed_at = effective_now,
      updated_at = effective_now
    where limiter.environment_id = (context_value ->> 'environment_id')::uuid
      and (
        (limiter.bucket_kind = 'environment' and limiter.bucket_key = 'environment')
        or (
          limiter.bucket_kind = 'membership'
          and limiter.bucket_key = context_value ->> 'membership_id'
        )
        or (
          limiter.bucket_kind = 'network'
          and limiter.bucket_key = target_network_hmac
        )
      );

    select max(limiter.locked_until)
    into blocked_until_value
    from private.admin_ai_unlock_rate_limits as limiter
    where limiter.environment_id = (context_value ->> 'environment_id')::uuid
      and limiter.locked_until > effective_now
      and (
        (limiter.bucket_kind = 'environment' and limiter.bucket_key = 'environment')
        or (
          limiter.bucket_kind = 'membership'
          and limiter.bucket_key = context_value ->> 'membership_id'
        )
        or (
          limiter.bucket_kind = 'network'
          and limiter.bucket_key = target_network_hmac
        )
      );

    if blocked_until_value is not null then
      retry_after_value := least(
        900,
        greatest(
          1,
          ceil(extract(epoch from blocked_until_value - effective_now))::integer
        )
      );
      reason_value := 'unlock_temporarily_unavailable';
    end if;
    end if;
  end if;

  insert into private.admin_ai_unlock_attempt_receipts (
    request_id,
    intent_digest,
    environment_id,
    principal_id,
    membership_id,
    admin_session_id,
    factor_id,
    factor_version,
    factor_pin_pepper_version,
    input_pin_pepper_version,
    input_pin_proof_digest,
    verified,
    reason_code,
    retry_after_seconds,
    occurred_at
  ) values (
    target_request_id,
    target_intent_digest,
    (context_value ->> 'environment_id')::uuid,
    (context_value ->> 'principal_id')::uuid,
    (context_value ->> 'membership_id')::uuid,
    (context_value ->> 'admin_session_id')::uuid,
    factor_row.id,
    factor_row.factor_version,
    factor_row.pin_pepper_version,
    target_pin_pepper_version,
    pin_proof_digest_value,
    verified_value,
    reason_value,
    retry_after_value,
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
    'admin_ai_unlock.verify',
    'admin_ai_unlock_factor',
    receipt_row.factor_id::text,
    case when receipt_row.verified then 'accepted' else 'denied' end,
    receipt_row.reason_code,
    jsonb_build_object(
      'factor_version', receipt_row.factor_version,
      'retry_after_seconds', receipt_row.retry_after_seconds
    )
  );

  return jsonb_build_object(
    'factor_id', receipt_row.factor_id,
    'factor_version', receipt_row.factor_version,
    'reason_code', receipt_row.reason_code,
    'retry_after_seconds', receipt_row.retry_after_seconds,
    'verified', receipt_row.verified,
    'verified_at', receipt_row.occurred_at
  );
end;
$$;

create function private.verify_admin_ai_pin_v1(
  target_token_hash text,
  target_auth_user_id uuid,
  target_supabase_auth_session_id uuid,
  target_pin_pepper_version integer,
  target_peppered_pin_hmac text,
  target_network_hmac text,
  target_intent_digest text,
  target_request_id uuid
)
returns jsonb
language sql
volatile
security definer
set search_path = ''
as $$
  select private.consume_admin_ai_pin_attempt_v1(
    target_token_hash,
    target_auth_user_id,
    target_supabase_auth_session_id,
    target_pin_pepper_version,
    target_peppered_pin_hmac,
    target_network_hmac,
    target_intent_digest,
    target_request_id
  );
$$;

create function private.begin_admin_ai_browser_enrollment_v1(
  target_token_hash text,
  target_auth_user_id uuid,
  target_supabase_auth_session_id uuid,
  target_nonce_hash text,
  target_reserved_browser_credential_id uuid,
  target_credential_hash text,
  target_origin text,
  target_public_key_fingerprint text,
  target_absolute_expires_at timestamptz,
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
  context_value jsonb;
  factor_row private.admin_ai_unlock_factors%rowtype;
  nonce_row private.admin_ai_browser_enrollment_nonces%rowtype;
  effective_now timestamptz := statement_timestamp();
begin
  if target_nonce_hash is null
     or target_nonce_hash !~ '^[0-9a-f]{64}$'
     or target_reserved_browser_credential_id is null
     or target_credential_hash is null
     or target_credential_hash !~ '^[0-9a-f]{64}$'
     or target_origin is null
     or target_origin !~ '^https?://[^/?#]+$'
     or target_public_key_fingerprint is null
     or target_public_key_fingerprint !~ '^[0-9a-f]{64}$'
     or target_absolute_expires_at is null
     or target_absolute_expires_at <= effective_now
     or target_absolute_expires_at > effective_now + interval '30 days'
     or target_request_id is null then
    raise exception 'invalid remembered-browser enrollment' using errcode = '22023';
  end if;

  if not exists (
    select 1
    from private.admin_ai_unlock_runtime_gate as gate
    where gate.singleton
      and gate.ai_unlock_enabled
      and gate.remembered_browser_enabled
  ) then
    raise exception 'Remembered-browser enrollment is disabled' using errcode = 'P7321';
  end if;

  perform private.serialize_admin_ai_request_v1(target_request_id);

  context_value := private.require_admin_ai_context_v1(
    target_token_hash,
    target_auth_user_id,
    target_supabase_auth_session_id,
    null,
    true,
    false
  );

  if context_value is null
     or not exists (
       select 1
       from private.admin_environments as environment
       where environment.id = (context_value ->> 'environment_id')::uuid
         and environment.canonical_admin_origin = target_origin
     ) then
    return null;
  end if;

  perform private.serialize_admin_ai_scope_v1(
    'factor-membership',
    (context_value ->> 'membership_id')::uuid
  );

  select nonce.*
  into nonce_row
  from private.admin_ai_browser_enrollment_nonces as nonce
  where nonce.begin_request_id = target_request_id;

  if found then
    if nonce_row.admin_session_id = (context_value ->> 'admin_session_id')::uuid
       and nonce_row.environment_id = (context_value ->> 'environment_id')::uuid
       and nonce_row.principal_id = (context_value ->> 'principal_id')::uuid
       and nonce_row.membership_id = (context_value ->> 'membership_id')::uuid
       and nonce_row.step_up_verified_at = (context_value ->> 'step_up_verified_at')::timestamptz
       and nonce_row.nonce_hash = target_nonce_hash
       and nonce_row.reserved_browser_credential_id = target_reserved_browser_credential_id
       and nonce_row.credential_hash = target_credential_hash
       and nonce_row.origin = target_origin
       and nonce_row.public_key_fingerprint = target_public_key_fingerprint
       and nonce_row.absolute_expires_at = target_absolute_expires_at
       and nonce_row.status = 'pending'
       and nonce_row.expires_at > effective_now
       and exists (
         select 1
         from private.admin_ai_unlock_factors as factor
         where factor.id = nonce_row.factor_id
           and factor.factor_version = nonce_row.factor_version
           and factor.status = 'active'
       ) then
      return jsonb_build_object(
        'expires_at', nonce_row.expires_at,
        'factor_version', nonce_row.factor_version,
        'nonce_id', nonce_row.id,
        'pin_pepper_version', (
          select factor.pin_pepper_version
          from private.admin_ai_unlock_factors as factor
          where factor.id = nonce_row.factor_id
        ),
        'reserved_browser_credential_id', nonce_row.reserved_browser_credential_id
      );
    end if;
    return null;
  end if;

  select factor.*
  into factor_row
  from private.admin_ai_unlock_factors as factor
  where factor.environment_id = (context_value ->> 'environment_id')::uuid
    and factor.principal_id = (context_value ->> 'principal_id')::uuid
    and factor.membership_id = (context_value ->> 'membership_id')::uuid
    and factor.status = 'active'
  for update;

  if not found then
    return null;
  end if;

  update private.admin_ai_browser_enrollment_nonces
  set
    status = 'superseded',
    updated_at = effective_now
  where admin_session_id = (context_value ->> 'admin_session_id')::uuid
    and status = 'pending';

  insert into private.admin_ai_browser_enrollment_nonces (
    nonce_hash,
    reserved_browser_credential_id,
    credential_hash,
    environment_id,
    principal_id,
    membership_id,
    admin_session_id,
    factor_id,
    factor_version,
    step_up_verified_at,
    origin,
    public_key_fingerprint,
    absolute_expires_at,
    begin_request_id,
    issued_at,
    expires_at
  ) values (
    target_nonce_hash,
    target_reserved_browser_credential_id,
    target_credential_hash,
    (context_value ->> 'environment_id')::uuid,
    (context_value ->> 'principal_id')::uuid,
    (context_value ->> 'membership_id')::uuid,
    (context_value ->> 'admin_session_id')::uuid,
    factor_row.id,
    factor_row.factor_version,
    (context_value ->> 'step_up_verified_at')::timestamptz,
    target_origin,
    target_public_key_fingerprint,
    target_absolute_expires_at,
    target_request_id,
    effective_now,
    effective_now + interval '5 minutes'
  ) returning * into nonce_row;

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
    nonce_row.environment_id,
    nonce_row.principal_id,
    nonce_row.membership_id,
    nonce_row.admin_session_id,
    'admin_ai_browser_enrollment.begin',
    'admin_ai_browser_enrollment_nonce',
    nonce_row.id::text,
    'accepted',
    jsonb_build_object('factor_version', nonce_row.factor_version)
  );

  return jsonb_build_object(
    'expires_at', nonce_row.expires_at,
    'factor_version', nonce_row.factor_version,
    'nonce_id', nonce_row.id,
    'pin_pepper_version', factor_row.pin_pepper_version,
    'reserved_browser_credential_id', nonce_row.reserved_browser_credential_id
  );
end;
$$;

create function private.complete_admin_ai_browser_enrollment_v1(
  target_token_hash text,
  target_auth_user_id uuid,
  target_supabase_auth_session_id uuid,
  target_nonce_hash text,
  target_pin_pepper_version integer,
  target_peppered_pin_hmac text,
  target_network_hmac text,
  target_public_key_jwk jsonb,
  target_request_id uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
set statement_timeout = '6s'
set lock_timeout = '750ms'
as $$
declare
  context_value jsonb;
  nonce_snapshot private.admin_ai_browser_enrollment_nonces%rowtype;
  nonce_row private.admin_ai_browser_enrollment_nonces%rowtype;
  credential_row private.admin_ai_browser_credentials%rowtype;
  metadata_value jsonb;
  verification_value jsonb;
  computed_fingerprint text;
  intent_digest_value text;
  effective_now timestamptz := statement_timestamp();
begin
  if target_nonce_hash is null
     or target_nonce_hash !~ '^[0-9a-f]{64}$'
     or target_pin_pepper_version is null
     or target_pin_pepper_version < 1
     or target_peppered_pin_hmac is null
     or target_peppered_pin_hmac !~ '^[0-9a-f]{64}$'
     or target_network_hmac is null
     or target_network_hmac !~ '^[0-9a-f]{64}$'
     or target_public_key_jwk is null
     or jsonb_typeof(target_public_key_jwk) <> 'object'
     or not (target_public_key_jwk ? 'kty')
     or not (target_public_key_jwk ? 'crv')
     or not (target_public_key_jwk ? 'x')
     or not (target_public_key_jwk ? 'y')
     or jsonb_typeof(target_public_key_jwk -> 'kty') is distinct from 'string'
     or jsonb_typeof(target_public_key_jwk -> 'crv') is distinct from 'string'
     or jsonb_typeof(target_public_key_jwk -> 'x') is distinct from 'string'
     or jsonb_typeof(target_public_key_jwk -> 'y') is distinct from 'string'
     or (target_public_key_jwk ->> 'kty' = 'EC') is not true
     or (target_public_key_jwk ->> 'crv' = 'P-256') is not true
     or (target_public_key_jwk ->> 'x' ~ '^[A-Za-z0-9_-]{43}$') is not true
     or (target_public_key_jwk ->> 'y' ~ '^[A-Za-z0-9_-]{43}$') is not true
     or target_public_key_jwk ? 'd'
     or pg_column_size(target_public_key_jwk) > 1024
     or target_request_id is null then
    raise exception 'invalid remembered-browser completion' using errcode = '22023';
  end if;

  if not exists (
    select 1
    from private.admin_ai_unlock_runtime_gate as gate
    where gate.singleton
      and gate.ai_unlock_enabled
      and gate.remembered_browser_enabled
  ) then
    raise exception 'Remembered-browser enrollment is disabled'
      using errcode = 'P7321';
  end if;

  select nonce.*
  into nonce_snapshot
  from private.admin_ai_browser_enrollment_nonces as nonce
  where nonce.nonce_hash = target_nonce_hash;

  if not found then
    return null;
  end if;

  perform private.serialize_admin_ai_request_v1(target_request_id);

  context_value := private.require_admin_ai_context_v1(
    target_token_hash,
    target_auth_user_id,
    target_supabase_auth_session_id,
    null,
    true,
    false
  );

  if context_value is null then
    return null;
  end if;

  perform private.serialize_admin_ai_scope_v1(
    'factor-membership',
    (context_value ->> 'membership_id')::uuid
  );

  computed_fingerprint := encode(
    extensions.digest(
      convert_to(
        '{"crv":"P-256","kty":"EC","x":"'
          || (target_public_key_jwk ->> 'x')
          || '","y":"'
          || (target_public_key_jwk ->> 'y')
          || '"}',
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );

  if computed_fingerprint <> nonce_snapshot.public_key_fingerprint then
    return null;
  end if;

  intent_digest_value := encode(
    extensions.digest(
      convert_to(
        concat_ws(
          ':',
          'browser-enrollment',
          nonce_snapshot.id::text,
          target_pin_pepper_version::text,
          target_peppered_pin_hmac,
          target_network_hmac,
          computed_fingerprint
        ),
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );

  select nonce.*
  into nonce_row
  from private.admin_ai_browser_enrollment_nonces as nonce
  where nonce.id = nonce_snapshot.id
  for update;

  if nonce_row.status = 'consumed' then
    if nonce_row.completion_request_id <> target_request_id
       or nonce_row.completion_intent_digest <> intent_digest_value
       or nonce_row.expires_at <= effective_now
       or nonce_row.admin_session_id <> (context_value ->> 'admin_session_id')::uuid
       or nonce_row.environment_id <> (context_value ->> 'environment_id')::uuid
       or nonce_row.principal_id <> (context_value ->> 'principal_id')::uuid
       or nonce_row.membership_id <> (context_value ->> 'membership_id')::uuid then
      return null;
    end if;

    select credential.*
    into credential_row
    from private.admin_ai_browser_credentials as credential
    where credential.id = nonce_row.completed_browser_credential_id
      and credential.enrollment_nonce_id = nonce_row.id
      and credential.credential_hash = nonce_row.credential_hash
      and credential.environment_id = nonce_row.environment_id
      and credential.principal_id = nonce_row.principal_id
      and credential.membership_id = nonce_row.membership_id
      and credential.source_factor_id = nonce_row.factor_id
      and credential.source_factor_version = nonce_row.factor_version
      and credential.origin = nonce_row.origin
      and credential.public_key_jwk = target_public_key_jwk
      and credential.public_key_fingerprint = computed_fingerprint
      and credential.status = 'active'
      and credential.expires_at > effective_now
      and exists (
        select 1
        from private.admin_ai_unlock_factors as factor
        where factor.id = nonce_row.factor_id
          and factor.factor_version = nonce_row.factor_version
          and factor.pin_pepper_version = target_pin_pepper_version
          and factor.status = 'active'
      );

    if found then
      return jsonb_build_object(
        'browser_credential_id', credential_row.id,
        'expires_at', credential_row.expires_at,
        'factor_id', credential_row.source_factor_id,
        'factor_version', credential_row.source_factor_version,
        'status', credential_row.status
      );
    end if;
    return null;
  end if;

  if nonce_row.status <> 'pending'
     or nonce_row.expires_at <= effective_now
     or nonce_row.absolute_expires_at <= effective_now
     or nonce_row.admin_session_id <> (context_value ->> 'admin_session_id')::uuid
     or nonce_row.environment_id <> (context_value ->> 'environment_id')::uuid
     or nonce_row.principal_id <> (context_value ->> 'principal_id')::uuid
     or nonce_row.membership_id <> (context_value ->> 'membership_id')::uuid
     or nonce_row.step_up_verified_at <> (context_value ->> 'step_up_verified_at')::timestamptz
     or nonce_row.public_key_fingerprint <> computed_fingerprint
     or not exists (
       select 1
       from private.admin_ai_unlock_factors as factor
       where factor.id = nonce_row.factor_id
         and factor.factor_version = nonce_row.factor_version
         and factor.pin_pepper_version = target_pin_pepper_version
         and factor.status = 'active'
     ) then
    return null;
  end if;

  metadata_value := private.get_admin_ai_pin_factor_metadata_v1(
    target_token_hash,
    target_auth_user_id,
    target_supabase_auth_session_id,
    target_network_hmac,
    intent_digest_value,
    target_request_id
  );

  if metadata_value is null
     or coalesce((metadata_value ->> 'available')::boolean, false) is false
     or (metadata_value ->> 'factor_version')::bigint is distinct from nonce_row.factor_version
     or (metadata_value ->> 'pin_pepper_version')::integer is distinct from target_pin_pepper_version then
    return jsonb_build_object(
      'reason_code', coalesce(metadata_value ->> 'reason_code', 'invalid_unlock'),
      'retry_after_seconds', coalesce(
        (metadata_value ->> 'retry_after_seconds')::integer,
        0
      ),
      'verified', false
    );
  end if;

  verification_value := private.consume_admin_ai_pin_attempt_v1(
    target_token_hash,
    target_auth_user_id,
    target_supabase_auth_session_id,
    target_pin_pepper_version,
    target_peppered_pin_hmac,
    target_network_hmac,
    intent_digest_value,
    target_request_id
  );

  if verification_value is null
     or coalesce((verification_value ->> 'verified')::boolean, false) is false
     or (verification_value ->> 'factor_id')::uuid is distinct from nonce_row.factor_id
     or (verification_value ->> 'factor_version')::bigint is distinct from nonce_row.factor_version then
    return jsonb_build_object(
      'reason_code', coalesce(
        verification_value ->> 'reason_code',
        'invalid_unlock'
      ),
      'retry_after_seconds', coalesce(
        (verification_value ->> 'retry_after_seconds')::integer,
        0
      ),
      'verified', false
    );
  end if;

  insert into private.admin_ai_browser_credentials (
    id,
    credential_hash,
    environment_id,
    principal_id,
    membership_id,
    source_factor_id,
    source_factor_version,
    origin,
    public_key_jwk,
    public_key_fingerprint,
    enrolled_by_admin_session_id,
    enrollment_nonce_id,
    created_at,
    expires_at
  ) values (
    nonce_row.reserved_browser_credential_id,
    nonce_row.credential_hash,
    nonce_row.environment_id,
    nonce_row.principal_id,
    nonce_row.membership_id,
    nonce_row.factor_id,
    nonce_row.factor_version,
    nonce_row.origin,
    target_public_key_jwk,
    computed_fingerprint,
    nonce_row.admin_session_id,
    nonce_row.id,
    effective_now,
    nonce_row.absolute_expires_at
  ) returning * into credential_row;

  update private.admin_ai_browser_enrollment_nonces
  set
    status = 'consumed',
    completion_request_id = target_request_id,
    completion_intent_digest = intent_digest_value,
    consumed_at = effective_now,
    completed_browser_credential_id = credential_row.id,
    updated_at = effective_now
  where id = nonce_row.id;

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
    credential_row.environment_id,
    credential_row.principal_id,
    credential_row.membership_id,
    credential_row.enrolled_by_admin_session_id,
    'admin_ai_browser_enrollment.complete',
    'admin_ai_browser_credential',
    credential_row.id::text,
    'accepted',
    jsonb_build_object('factor_version', credential_row.source_factor_version)
  );

  return jsonb_build_object(
    'browser_credential_id', credential_row.id,
    'expires_at', credential_row.expires_at,
    'factor_id', credential_row.source_factor_id,
    'factor_version', credential_row.source_factor_version,
    'status', credential_row.status
  );
end;
$$;

create function private.begin_admin_ai_browser_assertion_v1(
  target_token_hash text,
  target_auth_user_id uuid,
  target_supabase_auth_session_id uuid,
  target_credential_hash text,
  target_challenge_hash text,
  target_origin text,
  target_lecture_session_id uuid,
  target_requested_scope text,
  target_policy_id uuid,
  target_policy_version bigint,
  target_expires_at timestamptz,
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
  context_value jsonb;
  credential_row private.admin_ai_browser_credentials%rowtype;
  policy_row private.admin_ai_policies%rowtype;
  challenge_row private.admin_ai_browser_assertion_challenges%rowtype;
  effective_now timestamptz := statement_timestamp();
begin
  if target_credential_hash is null
     or target_credential_hash !~ '^[0-9a-f]{64}$'
     or target_challenge_hash is null
     or target_challenge_hash !~ '^[0-9a-f]{64}$'
     or target_origin is null
     or target_origin !~ '^https?://[^/?#]+$'
     or target_lecture_session_id is null
     or target_requested_scope not in ('all_except_captions', 'all_including_captions')
     or target_policy_id is null
     or target_policy_version is null
     or target_policy_version < 1
     or target_expires_at is null
     or target_expires_at <= effective_now
     or target_expires_at > effective_now + interval '5 minutes'
     or target_request_id is null then
    raise exception 'invalid remembered-browser assertion' using errcode = '22023';
  end if;

  if not exists (
    select 1
    from private.admin_ai_unlock_runtime_gate as gate
    where gate.singleton
      and gate.ai_unlock_enabled
      and gate.remembered_browser_enabled
  ) then
    raise exception 'Remembered-browser assertion is disabled' using errcode = 'P7321';
  end if;

  perform private.serialize_admin_ai_request_v1(target_request_id);

  context_value := private.require_admin_ai_context_v1(
    target_token_hash,
    target_auth_user_id,
    target_supabase_auth_session_id,
    null,
    true,
    false
  );

  if context_value is null then
    return null;
  end if;

  perform private.serialize_admin_ai_scope_v1(
    'factor-membership',
    (context_value ->> 'membership_id')::uuid
  );
  perform private.serialize_admin_ai_scope_v1(
    'policy-membership',
    (context_value ->> 'membership_id')::uuid
  );

  select challenge.*
  into challenge_row
  from private.admin_ai_browser_assertion_challenges as challenge
  where challenge.begin_request_id = target_request_id;

  if found then
    if challenge_row.admin_session_id = (context_value ->> 'admin_session_id')::uuid
       and challenge_row.environment_id = (context_value ->> 'environment_id')::uuid
       and challenge_row.principal_id = (context_value ->> 'principal_id')::uuid
       and challenge_row.membership_id = (context_value ->> 'membership_id')::uuid
       and challenge_row.challenge_hash = target_challenge_hash
       and challenge_row.lecture_session_id = target_lecture_session_id
       and challenge_row.requested_scope = target_requested_scope
       and challenge_row.policy_id = target_policy_id
       and challenge_row.policy_version = target_policy_version
       and challenge_row.origin = target_origin
       and challenge_row.expires_at = target_expires_at
       and challenge_row.status = 'pending'
       and challenge_row.expires_at > effective_now
       and exists (
         select 1
         from private.admin_ai_unlock_factors as factor
         where factor.id = challenge_row.factor_id
           and factor.factor_version = challenge_row.factor_version
           and factor.status = 'active'
       )
       and exists (
         select 1
         from private.admin_ai_policies as policy
         where policy.id = challenge_row.policy_id
           and policy.version = challenge_row.policy_version
           and policy.environment_id = challenge_row.environment_id
           and policy.membership_id = challenge_row.membership_id
           and policy.status = 'active'
           and policy.valid_from <= effective_now
           and policy.valid_until > effective_now
       )
       and exists (
         select 1
         from public.lecture_sessions as lecture
         where lecture.id = challenge_row.lecture_session_id
           and lecture.status = 'open'
           and lecture.hard_stop_at > effective_now
       ) then
      select credential.*
      into credential_row
      from private.admin_ai_browser_credentials as credential
      where credential.id = challenge_row.browser_credential_id
        and credential.credential_hash = target_credential_hash
         and credential.environment_id = challenge_row.environment_id
         and credential.principal_id = challenge_row.principal_id
         and credential.membership_id = challenge_row.membership_id
         and credential.source_factor_id = challenge_row.factor_id
         and credential.source_factor_version = challenge_row.factor_version
         and credential.origin = target_origin
        and credential.status = 'active'
        and credential.expires_at > effective_now;

      if found then
        return jsonb_build_object(
          'browser_credential_id', challenge_row.browser_credential_id,
          'challenge_id', challenge_row.id,
          'expires_at', challenge_row.expires_at,
          'public_key_algorithm', credential_row.public_key_algorithm,
          'public_key_jwk', credential_row.public_key_jwk
        );
      end if;
    end if;
    return null;
  end if;

  select credential.*
  into credential_row
  from private.admin_ai_browser_credentials as credential
  where credential.credential_hash = target_credential_hash
    and credential.environment_id = (context_value ->> 'environment_id')::uuid
    and credential.principal_id = (context_value ->> 'principal_id')::uuid
    and credential.membership_id = (context_value ->> 'membership_id')::uuid
    and credential.origin = target_origin
    and credential.status = 'active'
    and credential.expires_at > effective_now
  for update;

  if not found
     or not exists (
       select 1
       from private.admin_ai_unlock_factors as factor
       where factor.id = credential_row.source_factor_id
         and factor.factor_version = credential_row.source_factor_version
         and factor.status = 'active'
     ) then
    return null;
  end if;

  select policy.*
  into policy_row
  from private.admin_ai_policies as policy
  where policy.id = target_policy_id
    and policy.version = target_policy_version
    and policy.environment_id = (context_value ->> 'environment_id')::uuid
    and policy.membership_id = (context_value ->> 'membership_id')::uuid
    and policy.status = 'active'
    and policy.valid_from <= effective_now
    and policy.valid_until > effective_now
  for update;

  if not found
     or (
       target_requested_scope = 'all_including_captions'
       and not ('captions' = any(policy_row.allowed_actions))
     )
     or not exists (
       select 1
       from public.lecture_sessions as lecture
       where lecture.id = target_lecture_session_id
         and lecture.status = 'open'
         and lecture.hard_stop_at > effective_now
     ) then
    return null;
  end if;

  update private.admin_ai_browser_assertion_challenges
  set
    status = 'superseded',
    updated_at = effective_now
  where browser_credential_id = credential_row.id
    and admin_session_id = (context_value ->> 'admin_session_id')::uuid
    and lecture_session_id = target_lecture_session_id
    and status = 'pending';

  insert into private.admin_ai_browser_assertion_challenges (
    challenge_hash,
    browser_credential_id,
    environment_id,
    principal_id,
    membership_id,
    admin_session_id,
    factor_id,
    factor_version,
    lecture_session_id,
    requested_scope,
    policy_id,
    policy_version,
    origin,
    begin_request_id,
    issued_at,
    expires_at
  ) values (
    target_challenge_hash,
    credential_row.id,
    credential_row.environment_id,
    credential_row.principal_id,
    credential_row.membership_id,
    (context_value ->> 'admin_session_id')::uuid,
    credential_row.source_factor_id,
    credential_row.source_factor_version,
    target_lecture_session_id,
    target_requested_scope,
    policy_row.id,
    policy_row.version,
    target_origin,
    target_request_id,
    effective_now,
    target_expires_at
  ) returning * into challenge_row;

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
    challenge_row.environment_id,
    challenge_row.principal_id,
    challenge_row.membership_id,
    challenge_row.admin_session_id,
    'admin_ai_browser_assertion.begin',
    'admin_ai_browser_assertion_challenge',
    challenge_row.id::text,
    'accepted',
    jsonb_build_object(
      'lecture_session_id', challenge_row.lecture_session_id,
      'policy_version', challenge_row.policy_version,
      'scope', challenge_row.requested_scope
    )
  );

  return jsonb_build_object(
    'browser_credential_id', challenge_row.browser_credential_id,
    'challenge_id', challenge_row.id,
    'expires_at', challenge_row.expires_at,
    'public_key_algorithm', credential_row.public_key_algorithm,
    'public_key_jwk', credential_row.public_key_jwk
  );
end;
$$;

create function private.complete_admin_ai_browser_assertion_v1(
  target_token_hash text,
  target_auth_user_id uuid,
  target_supabase_auth_session_id uuid,
  target_credential_hash text,
  target_challenge_hash text,
  target_origin text,
  target_assertion_payload_hash text,
  target_signature_verified boolean,
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
  context_value jsonb;
  challenge_snapshot private.admin_ai_browser_assertion_challenges%rowtype;
  challenge_row private.admin_ai_browser_assertion_challenges%rowtype;
  credential_row private.admin_ai_browser_credentials%rowtype;
  effective_now timestamptz := statement_timestamp();
begin
  if target_credential_hash is null
     or target_credential_hash !~ '^[0-9a-f]{64}$'
     or target_challenge_hash is null
     or target_challenge_hash !~ '^[0-9a-f]{64}$'
     or target_origin is null
     or target_origin !~ '^https?://[^/?#]+$'
     or target_assertion_payload_hash is null
     or target_assertion_payload_hash !~ '^[0-9a-f]{64}$'
     or target_signature_verified is null
     or target_request_id is null then
    raise exception 'invalid remembered-browser assertion completion'
      using errcode = '22023';
  end if;

  if not exists (
    select 1
    from private.admin_ai_unlock_runtime_gate as gate
    where gate.singleton
      and gate.ai_unlock_enabled
      and gate.remembered_browser_enabled
  ) then
    raise exception 'Remembered-browser assertion is disabled'
      using errcode = 'P7321';
  end if;

  select challenge.*
  into challenge_snapshot
  from private.admin_ai_browser_assertion_challenges as challenge
  where challenge.challenge_hash = target_challenge_hash;

  if not found then
    return null;
  end if;

  perform private.serialize_admin_ai_request_v1(target_request_id);

  context_value := private.require_admin_ai_context_v1(
    target_token_hash,
    target_auth_user_id,
    target_supabase_auth_session_id,
    null,
    true,
    false
  );

  if context_value is null then
    return null;
  end if;

  perform private.serialize_admin_ai_scope_v1(
    'factor-membership',
    (context_value ->> 'membership_id')::uuid
  );
  perform private.serialize_admin_ai_scope_v1(
    'policy-membership',
    (context_value ->> 'membership_id')::uuid
  );

  select challenge.*
  into challenge_row
  from private.admin_ai_browser_assertion_challenges as challenge
  where challenge.id = challenge_snapshot.id
  for update;

  if challenge_row.status in ('consumed', 'denied') then
    if challenge_row.completion_request_id = target_request_id
       and challenge_row.assertion_payload_hash = target_assertion_payload_hash
       and challenge_row.signature_verified = target_signature_verified
       and challenge_row.admin_session_id = (context_value ->> 'admin_session_id')::uuid
       and challenge_row.environment_id = (context_value ->> 'environment_id')::uuid
       and challenge_row.principal_id = (context_value ->> 'principal_id')::uuid
       and challenge_row.membership_id = (context_value ->> 'membership_id')::uuid
       and challenge_row.origin = target_origin
       and challenge_row.expires_at > effective_now
       and exists (
         select 1
         from private.admin_ai_browser_credentials as credential
         where credential.id = challenge_row.browser_credential_id
           and credential.credential_hash = target_credential_hash
           and credential.environment_id = challenge_row.environment_id
           and credential.principal_id = challenge_row.principal_id
           and credential.membership_id = challenge_row.membership_id
           and credential.source_factor_id = challenge_row.factor_id
           and credential.source_factor_version = challenge_row.factor_version
           and credential.origin = target_origin
           and credential.status = 'active'
           and credential.expires_at > effective_now
       )
       and exists (
         select 1
         from private.admin_ai_unlock_factors as factor
         where factor.id = challenge_row.factor_id
           and factor.factor_version = challenge_row.factor_version
           and factor.status = 'active'
       )
       and exists (
         select 1
         from private.admin_ai_policies as policy
         where policy.id = challenge_row.policy_id
           and policy.version = challenge_row.policy_version
           and policy.environment_id = challenge_row.environment_id
           and policy.membership_id = challenge_row.membership_id
           and policy.status = 'active'
           and policy.valid_from <= effective_now
           and policy.valid_until > effective_now
       )
       and exists (
         select 1
         from public.lecture_sessions as lecture
         where lecture.id = challenge_row.lecture_session_id
           and lecture.status = 'open'
           and lecture.hard_stop_at > effective_now
       )
       and challenge_row.status = 'consumed' then
      return jsonb_build_object(
        'browser_credential_id', challenge_row.browser_credential_id,
        'factor_id', challenge_row.factor_id,
        'factor_version', challenge_row.factor_version,
        'lecture_session_id', challenge_row.lecture_session_id,
        'membership_id', challenge_row.membership_id,
        'policy_id', challenge_row.policy_id,
        'policy_version', challenge_row.policy_version,
        'principal_id', challenge_row.principal_id,
        'scope', challenge_row.requested_scope,
        'verified', true,
        'verified_at', challenge_row.consumed_at
      );
    end if;
    return null;
  end if;

  select credential.*
  into credential_row
  from private.admin_ai_browser_credentials as credential
  where credential.id = challenge_row.browser_credential_id
    and credential.credential_hash = target_credential_hash
    and credential.environment_id = challenge_row.environment_id
    and credential.principal_id = challenge_row.principal_id
    and credential.membership_id = challenge_row.membership_id
    and credential.origin = target_origin
    and credential.status = 'active'
    and credential.expires_at > effective_now
  for update;

  if challenge_row.status <> 'pending'
     or challenge_row.expires_at <= effective_now
     or challenge_row.origin <> target_origin
     or challenge_row.admin_session_id <> (context_value ->> 'admin_session_id')::uuid
     or challenge_row.environment_id <> (context_value ->> 'environment_id')::uuid
     or challenge_row.principal_id <> (context_value ->> 'principal_id')::uuid
     or challenge_row.membership_id <> (context_value ->> 'membership_id')::uuid
     or credential_row.id is null
     or credential_row.source_factor_id <> challenge_row.factor_id
     or credential_row.source_factor_version <> challenge_row.factor_version
     or not exists (
       select 1
       from private.admin_ai_unlock_factors as factor
       where factor.id = challenge_row.factor_id
         and factor.factor_version = challenge_row.factor_version
         and factor.status = 'active'
     )
     or not exists (
       select 1
       from private.admin_ai_policies as policy
       where policy.id = challenge_row.policy_id
         and policy.version = challenge_row.policy_version
         and policy.environment_id = challenge_row.environment_id
         and policy.membership_id = challenge_row.membership_id
         and policy.status = 'active'
         and policy.valid_from <= effective_now
         and policy.valid_until > effective_now
     )
     or not exists (
       select 1
       from public.lecture_sessions as lecture
       where lecture.id = challenge_row.lecture_session_id
         and lecture.status = 'open'
         and lecture.hard_stop_at > effective_now
     ) then
    return null;
  end if;

  update private.admin_ai_browser_assertion_challenges
  set
    status = case when target_signature_verified then 'consumed' else 'denied' end,
    completion_request_id = target_request_id,
    consumed_at = effective_now,
    assertion_payload_hash = target_assertion_payload_hash,
    signature_verified = target_signature_verified,
    updated_at = effective_now
  where id = challenge_row.id
  returning * into challenge_row;

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
    challenge_row.environment_id,
    challenge_row.principal_id,
    challenge_row.membership_id,
    challenge_row.admin_session_id,
    'admin_ai_browser_assertion.complete',
    'admin_ai_browser_assertion_challenge',
    challenge_row.id::text,
    case when target_signature_verified then 'accepted' else 'denied' end,
    case when target_signature_verified then 'verified' else 'invalid_assertion' end,
    jsonb_build_object(
      'lecture_session_id', challenge_row.lecture_session_id,
      'policy_version', challenge_row.policy_version,
      'scope', challenge_row.requested_scope
    )
  );

  if not target_signature_verified then
    return null;
  end if;

  update private.admin_ai_browser_credentials
  set
    last_used_at = effective_now,
    updated_at = effective_now
  where id = credential_row.id;

  return jsonb_build_object(
    'browser_credential_id', challenge_row.browser_credential_id,
    'factor_id', challenge_row.factor_id,
    'factor_version', challenge_row.factor_version,
    'lecture_session_id', challenge_row.lecture_session_id,
    'membership_id', challenge_row.membership_id,
    'policy_id', challenge_row.policy_id,
    'policy_version', challenge_row.policy_version,
    'principal_id', challenge_row.principal_id,
    'scope', challenge_row.requested_scope,
    'verified', true,
    'verified_at', challenge_row.consumed_at
  );
end;
$$;

create function private.revoke_admin_ai_browser_credential_v1(
  target_token_hash text,
  target_auth_user_id uuid,
  target_supabase_auth_session_id uuid,
  target_browser_credential_id uuid,
  target_request_id uuid
)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
set statement_timeout = '3s'
set lock_timeout = '750ms'
as $$
declare
  context_value jsonb;
  credential_row private.admin_ai_browser_credentials%rowtype;
  drain_result jsonb;
  effective_now timestamptz := statement_timestamp();
begin
  if target_browser_credential_id is null or target_request_id is null then
    return false;
  end if;

  perform private.serialize_admin_ai_request_v1(target_request_id);

  context_value := private.require_admin_ai_context_v1(
    target_token_hash,
    target_auth_user_id,
    target_supabase_auth_session_id,
    null,
    false,
    false
  );

  if context_value is null then
    return false;
  end if;

  perform private.serialize_admin_ai_scope_v1(
    'factor-membership',
    (context_value ->> 'membership_id')::uuid
  );

  select credential.*
  into credential_row
  from private.admin_ai_browser_credentials as credential
  where credential.id = target_browser_credential_id
    and credential.environment_id = (context_value ->> 'environment_id')::uuid
    and credential.principal_id = (context_value ->> 'principal_id')::uuid
    and credential.membership_id = (context_value ->> 'membership_id')::uuid
  for update;

  if not found then
    return false;
  end if;

  if credential_row.status <> 'active' then
    return credential_row.revocation_request_id is not distinct from target_request_id;
  end if;

  update private.admin_ai_browser_credentials
  set
    status = 'revoked',
    revoked_at = effective_now,
    revoked_by_admin_session_id = (context_value ->> 'admin_session_id')::uuid,
    revocation_request_id = target_request_id,
    revoke_reason = 'self_revoked',
    updated_at = effective_now
  where id = credential_row.id;

  drain_result := private.drain_admin_ai_browser_credential_authority_v1(
    credential_row.id,
    'admin-session:' || (context_value ->> 'admin_session_id'),
    'browser_credential_revoked',
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
    credential_row.environment_id,
    credential_row.principal_id,
    credential_row.membership_id,
    (context_value ->> 'admin_session_id')::uuid,
    'admin_ai_browser_credential.revoke',
    'admin_ai_browser_credential',
    credential_row.id::text,
    'accepted',
    jsonb_build_object('authority_drain', drain_result)
  );

  return true;
end;
$$;

create function private.cleanup_admin_ai_ephemera_v1(
  target_retention_before timestamptz,
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
  expired_credential_candidate record;
  revoked_auth_sessions integer := 0;
  expired_assertion_challenges integer := 0;
  expired_browser_credentials integer := 0;
  expired_enrollment_nonces integer := 0;
  expired_step_up_nonces integer := 0;
  deleted_attempt_receipts integer := 0;
  deleted_pin_discoveries integer := 0;
  deleted_enrollment_nonces integer := 0;
  deleted_assertion_challenges integer := 0;
  deleted_rate_buckets integer := 0;
  deleted_step_up_nonces integer := 0;
  has_more boolean := false;
begin
  if target_retention_before is null
     or target_retention_before > effective_now - interval '1 day'
     or target_request_id is null then
    raise exception 'invalid Admin AI retention cutoff' using errcode = '22023';
  end if;

  with candidates as (
    select session.id
    from public.admin_sessions as session
    where session.authentication_method = 'google_totp'
      and session.revoked_at is null
      and not exists (
        select 1
        from auth.sessions as auth_session
        where auth_session.id = session.supabase_auth_session_id
          and auth_session.user_id = session.auth_user_id
      )
    order by session.id
    for update of session skip locked
    limit 500
  )
  update public.admin_sessions as session
  set
    revoked_at = effective_now,
    revoke_reason = 'auth_session_revoked',
    updated_at = effective_now
  from candidates
  where session.id = candidates.id;
  get diagnostics revoked_auth_sessions = row_count;

  with candidates as (
    select nonce.id
    from private.admin_step_up_nonces as nonce
    where nonce.status = 'pending'
      and nonce.expires_at <= effective_now
    order by nonce.expires_at, nonce.id
    for update of nonce skip locked
    limit 500
  )
  update private.admin_step_up_nonces as nonce
  set
    status = 'expired',
    updated_at = effective_now
  from candidates
  where nonce.id = candidates.id;
  get diagnostics expired_step_up_nonces = row_count;

  -- Acquire the membership advisory lock before touching any browser
  -- challenge or enrollment row. Rotation/revocation use the same edge, so
  -- cleanup cannot first hold a child row and then wait behind their drain.
  for expired_credential_candidate in
    select credential.id, credential.membership_id
    from private.admin_ai_browser_credentials as credential
    where credential.status = 'active'
      and credential.expires_at <= effective_now
    order by credential.membership_id, credential.expires_at, credential.id
    limit 500
  loop
    continue when not private.try_serialize_admin_ai_scope_v1(
      'factor-membership',
      expired_credential_candidate.membership_id
    );

    perform 1
    from private.admin_ai_browser_credentials as credential
    where credential.id = expired_credential_candidate.id
      and credential.status = 'active'
      and credential.expires_at <= effective_now
    for update of credential skip locked;

    continue when not found;

    update private.admin_ai_browser_credentials as credential
    set
      status = 'expired',
      revoked_at = effective_now,
      revoke_reason = 'absolute_expiry',
      updated_at = effective_now
    where credential.id = expired_credential_candidate.id
      and credential.status = 'active';

    if found then
      expired_browser_credentials := expired_browser_credentials + 1;
      perform private.drain_admin_ai_browser_credential_authority_v1(
        expired_credential_candidate.id,
        'system:admin-ai-retention',
        'browser_credential_expired',
        effective_now
      );
    end if;
  end loop;

  with candidates as (
    select challenge.id
    from private.admin_ai_browser_assertion_challenges as challenge
    where challenge.status = 'pending'
      and challenge.expires_at <= effective_now
    order by challenge.expires_at, challenge.id
    for update of challenge skip locked
    limit 500
  )
  update private.admin_ai_browser_assertion_challenges as challenge
  set
    status = 'expired',
    updated_at = effective_now
  from candidates
  where challenge.id = candidates.id;
  get diagnostics expired_assertion_challenges = row_count;

  with candidates as (
    select nonce.id
    from private.admin_ai_browser_enrollment_nonces as nonce
    where nonce.status = 'pending'
      and nonce.expires_at <= effective_now
    order by nonce.expires_at, nonce.id
    for update of nonce skip locked
    limit 500
  )
  update private.admin_ai_browser_enrollment_nonces as nonce
  set
    status = 'expired',
    updated_at = effective_now
  from candidates
  where nonce.id = candidates.id;
  get diagnostics expired_enrollment_nonces = row_count;

  with candidates as (
    select receipt.request_id
    from private.admin_ai_unlock_attempt_receipts as receipt
    where receipt.occurred_at < target_retention_before
    order by receipt.occurred_at, receipt.request_id
    for update of receipt skip locked
    limit 500
  )
  delete from private.admin_ai_unlock_attempt_receipts as receipt
  using candidates
  where receipt.request_id = candidates.request_id;
  get diagnostics deleted_attempt_receipts = row_count;

  with candidates as (
    select discovery.request_id
    from private.admin_ai_pin_discovery_receipts as discovery
    where discovery.expires_at < target_retention_before
    order by discovery.expires_at, discovery.request_id
    for update of discovery skip locked
    limit 500
  )
  delete from private.admin_ai_pin_discovery_receipts as discovery
  using candidates
  where discovery.request_id = candidates.request_id;
  get diagnostics deleted_pin_discoveries = row_count;

  with candidates as (
    select challenge.id
    from private.admin_ai_browser_assertion_challenges as challenge
    where challenge.status in ('consumed', 'denied', 'superseded', 'expired')
      and challenge.updated_at < target_retention_before
    order by challenge.updated_at, challenge.id
    for update of challenge skip locked
    limit 500
  )
  delete from private.admin_ai_browser_assertion_challenges as challenge
  using candidates
  where challenge.id = candidates.id;
  get diagnostics deleted_assertion_challenges = row_count;

  with candidates as (
    select nonce.id
    from private.admin_ai_browser_enrollment_nonces as nonce
    where nonce.status in ('consumed', 'superseded', 'expired')
      and nonce.updated_at < target_retention_before
      and not exists (
        select 1
        from private.admin_ai_browser_credentials as credential
        where credential.enrollment_nonce_id = nonce.id
      )
    order by nonce.updated_at, nonce.id
    for update of nonce skip locked
    limit 500
  )
  delete from private.admin_ai_browser_enrollment_nonces as nonce
  using candidates
  where nonce.id = candidates.id;
  get diagnostics deleted_enrollment_nonces = row_count;

  with candidates as (
    select
      limiter.environment_id,
      limiter.bucket_kind,
      limiter.bucket_key
    from private.admin_ai_unlock_rate_limits as limiter
    where limiter.updated_at < target_retention_before
      and (limiter.locked_until is null or limiter.locked_until <= effective_now)
    order by
      limiter.updated_at,
      limiter.environment_id,
      limiter.bucket_kind,
      limiter.bucket_key
    for update of limiter skip locked
    limit 500
  )
  delete from private.admin_ai_unlock_rate_limits as limiter
  using candidates
  where limiter.environment_id = candidates.environment_id
    and limiter.bucket_kind = candidates.bucket_kind
    and limiter.bucket_key = candidates.bucket_key;
  get diagnostics deleted_rate_buckets = row_count;

  with candidates as (
    select nonce.id
    from private.admin_step_up_nonces as nonce
    where nonce.status in ('superseded', 'expired')
      and nonce.updated_at < target_retention_before
      and not exists (
        select 1
        from public.admin_sessions as session
        where session.step_up_nonce_id = nonce.id
      )
    order by nonce.updated_at, nonce.id
    for update of nonce skip locked
    limit 500
  )
  delete from private.admin_step_up_nonces as nonce
  using candidates
  where nonce.id = candidates.id;
  get diagnostics deleted_step_up_nonces = row_count;

  select
    exists (
      select 1
      from public.admin_sessions as session
      where session.authentication_method = 'google_totp'
        and session.revoked_at is null
        and not exists (
          select 1
          from auth.sessions as auth_session
          where auth_session.id = session.supabase_auth_session_id
            and auth_session.user_id = session.auth_user_id
        )
    )
    or exists (
      select 1 from private.admin_step_up_nonces as nonce
      where nonce.status = 'pending' and nonce.expires_at <= effective_now
    )
    or exists (
      select 1 from private.admin_ai_browser_enrollment_nonces as nonce
      where nonce.status = 'pending' and nonce.expires_at <= effective_now
    )
    or exists (
      select 1 from private.admin_ai_browser_assertion_challenges as challenge
      where challenge.status = 'pending' and challenge.expires_at <= effective_now
    )
    or exists (
      select 1 from private.admin_ai_browser_credentials as credential
      where credential.status = 'active' and credential.expires_at <= effective_now
    )
    or exists (
      select 1 from private.admin_ai_unlock_attempt_receipts as receipt
      where receipt.occurred_at < target_retention_before
    )
    or exists (
      select 1 from private.admin_ai_pin_discovery_receipts as discovery
      where discovery.expires_at < target_retention_before
    )
    or exists (
      select 1 from private.admin_ai_browser_assertion_challenges as challenge
      where challenge.status in ('consumed', 'denied', 'superseded', 'expired')
        and challenge.updated_at < target_retention_before
    )
    or exists (
      select 1 from private.admin_ai_browser_enrollment_nonces as nonce
      where nonce.status in ('consumed', 'superseded', 'expired')
        and nonce.updated_at < target_retention_before
        and not exists (
          select 1
          from private.admin_ai_browser_credentials as credential
          where credential.enrollment_nonce_id = nonce.id
        )
    )
    or exists (
      select 1 from private.admin_ai_unlock_rate_limits as limiter
      where limiter.updated_at < target_retention_before
        and (limiter.locked_until is null or limiter.locked_until <= effective_now)
    )
    or exists (
      select 1 from private.admin_step_up_nonces as nonce
      where nonce.status in ('superseded', 'expired')
        and nonce.updated_at < target_retention_before
        and not exists (
          select 1
          from public.admin_sessions as session
          where session.step_up_nonce_id = nonce.id
        )
    )
  into has_more;

  insert into private.admin_audit_events (
    request_id,
    action,
    target_type,
    result,
    metadata
  ) values (
    target_request_id,
    'admin_ai_retention.cleanup',
    'admin_ai_ephemera',
    'accepted',
    jsonb_build_object(
      'assertion_challenges', deleted_assertion_challenges,
      'assertion_challenges_expired', expired_assertion_challenges,
      'attempt_receipts', deleted_attempt_receipts,
      'browser_credentials_expired', expired_browser_credentials,
      'enrollment_nonces', deleted_enrollment_nonces,
      'enrollment_nonces_expired', expired_enrollment_nonces,
      'has_more', has_more,
      'pin_discoveries', deleted_pin_discoveries,
      'rate_buckets', deleted_rate_buckets,
      'sessions_revoked', revoked_auth_sessions,
      'step_up_nonces', deleted_step_up_nonces,
      'step_up_nonces_expired', expired_step_up_nonces
    )
  );

  return jsonb_build_object(
    'assertion_challenges', deleted_assertion_challenges,
    'assertion_challenges_expired', expired_assertion_challenges,
    'attempt_receipts', deleted_attempt_receipts,
    'browser_credentials_expired', expired_browser_credentials,
    'enrollment_nonces', deleted_enrollment_nonces,
    'enrollment_nonces_expired', expired_enrollment_nonces,
    'has_more', has_more,
    'pin_discoveries', deleted_pin_discoveries,
    'rate_buckets', deleted_rate_buckets,
    'sessions_revoked', revoked_auth_sessions,
    'step_up_nonces', deleted_step_up_nonces,
    'step_up_nonces_expired', expired_step_up_nonces
  );
end;
$$;

-- B1 hardening: every tracked Google Admin touch now proves that the backing
-- Supabase Auth session still exists. JWT validity alone is intentionally not
-- treated as revocation evidence.
create or replace function private.verify_and_touch_google_admin_session_v1(
  target_token_hash text,
  target_auth_user_id uuid,
  target_supabase_auth_session_id uuid
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
  session_snapshot public.admin_sessions%rowtype;
  session_row public.admin_sessions%rowtype;
  principal_row private.admin_principals%rowtype;
  membership_row private.admin_environment_memberships%rowtype;
  environment_row private.admin_environments%rowtype;
  effective_now timestamptz := statement_timestamp();
  rejection_reason text;
  auth_session_present boolean := false;
begin
  if target_token_hash !~ '^[0-9a-f]{64}$' then
    return null;
  end if;

  if not exists (
    select 1
    from private.admin_identity_runtime_gate as gate
    where gate.singleton
      and gate.google_session_issue_enabled
  ) then
    return null;
  end if;

  -- Match the B2 principal -> membership -> session order. The environment
  -- is re-read without a row lock after that chain so this reader cannot form
  -- an inverse edge with the B1 last-owner DELETE trigger.
  select session.*
  into session_snapshot
  from public.admin_sessions as session
  where session.token_hash = target_token_hash
    and session.authentication_method = 'google_totp'
    and session.aal = 2
    and session.auth_user_id = target_auth_user_id
    and session.supabase_auth_session_id = target_supabase_auth_session_id
  ;

  if not found then
    return null;
  end if;

  select principal.*
  into principal_row
  from private.admin_principals as principal
  where principal.id = session_snapshot.principal_id
    and principal.auth_user_id = target_auth_user_id
  for key share;

  select membership.*
  into membership_row
  from private.admin_environment_memberships as membership
  where membership.id = session_snapshot.membership_id
    and membership.environment_id = session_snapshot.environment_id
    and membership.principal_id = session_snapshot.principal_id
  for key share;

  select session.*
  into session_row
  from public.admin_sessions as session
  where session.id = session_snapshot.id
    and session.token_hash = target_token_hash
    and session.authentication_method = 'google_totp'
    and session.aal = 2
    and session.auth_user_id = target_auth_user_id
    and session.supabase_auth_session_id = target_supabase_auth_session_id
    and session.environment_id = session_snapshot.environment_id
    and session.principal_id = session_snapshot.principal_id
    and session.membership_id = session_snapshot.membership_id
  for update;

  if not found then
    return null;
  end if;

  perform 1
  from auth.sessions as auth_session
  where auth_session.id = target_supabase_auth_session_id
    and auth_session.user_id = target_auth_user_id
  for key share;
  auth_session_present := found;

  select environment.*
  into environment_row
  from private.admin_environments as environment
  where environment.id = session_snapshot.environment_id;

  rejection_reason := case
    when session_row.revoked_at is not null then session_row.revoke_reason
    when not auth_session_present then 'auth_session_revoked'
    when session_row.expires_at <= effective_now then 'absolute_expiry'
    when principal_row.id is null or principal_row.status <> 'active' then 'principal_inactive'
    when membership_row.id is null or membership_row.status <> 'active' then 'membership_inactive'
    when membership_row.expires_at is not null and membership_row.expires_at <= effective_now then 'membership_expired'
    when environment_row.id is null or environment_row.status <> 'active' or not environment_row.current_deployment then 'environment_inactive'
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
      idle_expires_at = expires_at,
      updated_at = effective_now
    where id = session_row.id
    returning * into session_row;
  end if;

  return jsonb_build_object(
    'can_use_ai', membership_row.can_use_ai,
    'environment_id', environment_row.id,
    'expires_at', session_row.expires_at,
    'id', session_row.id,
    'idle_expires_at', session_row.idle_expires_at,
    'membership_id', membership_row.id,
    'principal_id', principal_row.id,
    'role', membership_row.role,
    'step_up_verified_at', session_row.step_up_verified_at
  );
end;
$$;

create function public.get_admin_ai_unlock_runtime_gate_v1()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select private.get_admin_ai_unlock_runtime_gate_v1();
$$;

create function public.set_admin_ai_policy_v1(
  target_token_hash text,
  target_auth_user_id uuid,
  target_supabase_auth_session_id uuid,
  target_membership_id uuid,
  target_allowed_actions text[],
  target_allowed_models text[],
  target_max_calls_per_lecture integer,
  target_max_calls_per_day integer,
  target_max_input_tokens_per_lecture bigint,
  target_max_input_tokens_per_day bigint,
  target_max_output_tokens_per_lecture bigint,
  target_max_output_tokens_per_day bigint,
  target_max_cost_microusd_per_lecture bigint,
  target_max_cost_microusd_per_day bigint,
  target_max_realtime_minutes_per_lecture integer,
  target_max_realtime_minutes_per_day integer,
  target_max_concurrency integer,
  target_valid_from timestamptz,
  target_valid_until timestamptz,
  target_request_id uuid
)
returns jsonb
language sql
volatile
security invoker
set search_path = ''
as $$
  select private.set_admin_ai_policy_v1(
    target_token_hash,
    target_auth_user_id,
    target_supabase_auth_session_id,
    target_membership_id,
    target_allowed_actions,
    target_allowed_models,
    target_max_calls_per_lecture,
    target_max_calls_per_day,
    target_max_input_tokens_per_lecture,
    target_max_input_tokens_per_day,
    target_max_output_tokens_per_lecture,
    target_max_output_tokens_per_day,
    target_max_cost_microusd_per_lecture,
    target_max_cost_microusd_per_day,
    target_max_realtime_minutes_per_lecture,
    target_max_realtime_minutes_per_day,
    target_max_concurrency,
    target_valid_from,
    target_valid_until,
    target_request_id
  );
$$;

create function public.enroll_admin_ai_pin_v1(
  target_token_hash text,
  target_auth_user_id uuid,
  target_supabase_auth_session_id uuid,
  target_peppered_pin_hmac text,
  target_pin_pepper_version integer,
  target_request_id uuid
)
returns jsonb
language sql
volatile
security invoker
set search_path = ''
as $$
  select private.enroll_admin_ai_pin_v1(
    target_token_hash,
    target_auth_user_id,
    target_supabase_auth_session_id,
    target_peppered_pin_hmac,
    target_pin_pepper_version,
    target_request_id
  );
$$;

create function public.get_admin_ai_pin_factor_metadata_v1(
  target_token_hash text,
  target_auth_user_id uuid,
  target_supabase_auth_session_id uuid,
  target_network_hmac text,
  target_intent_digest text,
  target_request_id uuid
)
returns jsonb
language sql
volatile
security invoker
set search_path = ''
as $$
  select private.get_admin_ai_pin_factor_metadata_v1(
    target_token_hash,
    target_auth_user_id,
    target_supabase_auth_session_id,
    target_network_hmac,
    target_intent_digest,
    target_request_id
  );
$$;

create function public.verify_admin_ai_pin_v1(
  target_token_hash text,
  target_auth_user_id uuid,
  target_supabase_auth_session_id uuid,
  target_pin_pepper_version integer,
  target_peppered_pin_hmac text,
  target_network_hmac text,
  target_intent_digest text,
  target_request_id uuid
)
returns jsonb
language sql
volatile
security invoker
set search_path = ''
as $$
  select private.verify_admin_ai_pin_v1(
    target_token_hash,
    target_auth_user_id,
    target_supabase_auth_session_id,
    target_pin_pepper_version,
    target_peppered_pin_hmac,
    target_network_hmac,
    target_intent_digest,
    target_request_id
  );
$$;

create function public.begin_admin_ai_browser_enrollment_v1(
  target_token_hash text,
  target_auth_user_id uuid,
  target_supabase_auth_session_id uuid,
  target_nonce_hash text,
  target_reserved_browser_credential_id uuid,
  target_credential_hash text,
  target_origin text,
  target_public_key_fingerprint text,
  target_absolute_expires_at timestamptz,
  target_request_id uuid
)
returns jsonb
language sql
volatile
security invoker
set search_path = ''
as $$
  select private.begin_admin_ai_browser_enrollment_v1(
    target_token_hash,
    target_auth_user_id,
    target_supabase_auth_session_id,
    target_nonce_hash,
    target_reserved_browser_credential_id,
    target_credential_hash,
    target_origin,
    target_public_key_fingerprint,
    target_absolute_expires_at,
    target_request_id
  );
$$;

create function public.complete_admin_ai_browser_enrollment_v1(
  target_token_hash text,
  target_auth_user_id uuid,
  target_supabase_auth_session_id uuid,
  target_nonce_hash text,
  target_pin_pepper_version integer,
  target_peppered_pin_hmac text,
  target_network_hmac text,
  target_public_key_jwk jsonb,
  target_request_id uuid
)
returns jsonb
language sql
volatile
security invoker
set search_path = ''
as $$
  select private.complete_admin_ai_browser_enrollment_v1(
    target_token_hash,
    target_auth_user_id,
    target_supabase_auth_session_id,
    target_nonce_hash,
    target_pin_pepper_version,
    target_peppered_pin_hmac,
    target_network_hmac,
    target_public_key_jwk,
    target_request_id
  );
$$;

create function public.begin_admin_ai_browser_assertion_v1(
  target_token_hash text,
  target_auth_user_id uuid,
  target_supabase_auth_session_id uuid,
  target_credential_hash text,
  target_challenge_hash text,
  target_origin text,
  target_lecture_session_id uuid,
  target_requested_scope text,
  target_policy_id uuid,
  target_policy_version bigint,
  target_expires_at timestamptz,
  target_request_id uuid
)
returns jsonb
language sql
volatile
security invoker
set search_path = ''
as $$
  select private.begin_admin_ai_browser_assertion_v1(
    target_token_hash,
    target_auth_user_id,
    target_supabase_auth_session_id,
    target_credential_hash,
    target_challenge_hash,
    target_origin,
    target_lecture_session_id,
    target_requested_scope,
    target_policy_id,
    target_policy_version,
    target_expires_at,
    target_request_id
  );
$$;

create function public.complete_admin_ai_browser_assertion_v1(
  target_token_hash text,
  target_auth_user_id uuid,
  target_supabase_auth_session_id uuid,
  target_credential_hash text,
  target_challenge_hash text,
  target_origin text,
  target_assertion_payload_hash text,
  target_signature_verified boolean,
  target_request_id uuid
)
returns jsonb
language sql
volatile
security invoker
set search_path = ''
as $$
  select private.complete_admin_ai_browser_assertion_v1(
    target_token_hash,
    target_auth_user_id,
    target_supabase_auth_session_id,
    target_credential_hash,
    target_challenge_hash,
    target_origin,
    target_assertion_payload_hash,
    target_signature_verified,
    target_request_id
  );
$$;

create function public.revoke_admin_ai_browser_credential_v1(
  target_token_hash text,
  target_auth_user_id uuid,
  target_supabase_auth_session_id uuid,
  target_browser_credential_id uuid,
  target_request_id uuid
)
returns boolean
language sql
volatile
security invoker
set search_path = ''
as $$
  select private.revoke_admin_ai_browser_credential_v1(
    target_token_hash,
    target_auth_user_id,
    target_supabase_auth_session_id,
    target_browser_credential_id,
    target_request_id
  );
$$;

create function public.cleanup_admin_ai_ephemera_v1(
  target_retention_before timestamptz,
  target_request_id uuid
)
returns jsonb
language sql
volatile
security invoker
set search_path = ''
as $$
  select private.cleanup_admin_ai_ephemera_v1(
    target_retention_before,
    target_request_id
  );
$$;

revoke all on function private.enforce_google_admin_session_absolute_idle_v1()
  from public, anon, authenticated, service_role;
revoke all on function private.verify_and_touch_google_admin_session_v1(text, uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.require_admin_ai_context_v1(text, uuid, uuid, timestamptz, boolean, boolean)
  from public, anon, authenticated, service_role;
revoke all on function private.get_admin_ai_unlock_runtime_gate_v1()
  from public, anon, authenticated, service_role;
revoke all on function private.set_admin_ai_policy_v1(text, uuid, uuid, uuid, text[], text[], integer, integer, bigint, bigint, bigint, bigint, bigint, bigint, integer, integer, integer, timestamptz, timestamptz, uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.enroll_admin_ai_pin_v1(text, uuid, uuid, text, integer, uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.drain_admin_ai_master_authority_v1(text, uuid, text, text, timestamptz)
  from public, anon, authenticated, service_role;
revoke all on function private.drain_admin_ai_browser_credential_authority_v1(uuid, text, text, timestamptz)
  from public, anon, authenticated, service_role;
revoke all on function private.drain_admin_ai_policy_authority_v1(uuid, uuid, timestamptz)
  from public, anon, authenticated, service_role;
revoke all on function private.drain_admin_ai_factor_authority_v1(uuid, uuid, text, timestamptz)
  from public, anon, authenticated, service_role;
revoke all on function private.get_admin_ai_pin_factor_metadata_v1(text, uuid, uuid, text, text, uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.consume_admin_ai_pin_attempt_v1(text, uuid, uuid, integer, text, text, text, uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.verify_admin_ai_pin_v1(text, uuid, uuid, integer, text, text, text, uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.begin_admin_ai_browser_enrollment_v1(text, uuid, uuid, text, uuid, text, text, text, timestamptz, uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.complete_admin_ai_browser_enrollment_v1(text, uuid, uuid, text, integer, text, text, jsonb, uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.begin_admin_ai_browser_assertion_v1(text, uuid, uuid, text, text, text, uuid, text, uuid, bigint, timestamptz, uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.complete_admin_ai_browser_assertion_v1(text, uuid, uuid, text, text, text, text, boolean, uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.revoke_admin_ai_browser_credential_v1(text, uuid, uuid, uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.cleanup_admin_ai_ephemera_v1(timestamptz, uuid)
  from public, anon, authenticated, service_role;

grant execute on function private.get_admin_ai_unlock_runtime_gate_v1()
  to service_role;
grant execute on function private.verify_and_touch_google_admin_session_v1(text, uuid, uuid)
  to service_role;
grant execute on function private.set_admin_ai_policy_v1(text, uuid, uuid, uuid, text[], text[], integer, integer, bigint, bigint, bigint, bigint, bigint, bigint, integer, integer, integer, timestamptz, timestamptz, uuid)
  to service_role;
grant execute on function private.enroll_admin_ai_pin_v1(text, uuid, uuid, text, integer, uuid)
  to service_role;
grant execute on function private.get_admin_ai_pin_factor_metadata_v1(text, uuid, uuid, text, text, uuid)
  to service_role;
grant execute on function private.verify_admin_ai_pin_v1(text, uuid, uuid, integer, text, text, text, uuid)
  to service_role;
grant execute on function private.begin_admin_ai_browser_enrollment_v1(text, uuid, uuid, text, uuid, text, text, text, timestamptz, uuid)
  to service_role;
grant execute on function private.complete_admin_ai_browser_enrollment_v1(text, uuid, uuid, text, integer, text, text, jsonb, uuid)
  to service_role;
grant execute on function private.begin_admin_ai_browser_assertion_v1(text, uuid, uuid, text, text, text, uuid, text, uuid, bigint, timestamptz, uuid)
  to service_role;
grant execute on function private.complete_admin_ai_browser_assertion_v1(text, uuid, uuid, text, text, text, text, boolean, uuid)
  to service_role;
grant execute on function private.revoke_admin_ai_browser_credential_v1(text, uuid, uuid, uuid, uuid)
  to service_role;
grant execute on function private.cleanup_admin_ai_ephemera_v1(timestamptz, uuid)
  to service_role;

revoke all on function public.get_admin_ai_unlock_runtime_gate_v1()
  from public, anon, authenticated, service_role;
revoke all on function public.set_admin_ai_policy_v1(text, uuid, uuid, uuid, text[], text[], integer, integer, bigint, bigint, bigint, bigint, bigint, bigint, integer, integer, integer, timestamptz, timestamptz, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.enroll_admin_ai_pin_v1(text, uuid, uuid, text, integer, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.get_admin_ai_pin_factor_metadata_v1(text, uuid, uuid, text, text, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.verify_admin_ai_pin_v1(text, uuid, uuid, integer, text, text, text, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.begin_admin_ai_browser_enrollment_v1(text, uuid, uuid, text, uuid, text, text, text, timestamptz, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.complete_admin_ai_browser_enrollment_v1(text, uuid, uuid, text, integer, text, text, jsonb, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.begin_admin_ai_browser_assertion_v1(text, uuid, uuid, text, text, text, uuid, text, uuid, bigint, timestamptz, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.complete_admin_ai_browser_assertion_v1(text, uuid, uuid, text, text, text, text, boolean, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.revoke_admin_ai_browser_credential_v1(text, uuid, uuid, uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.cleanup_admin_ai_ephemera_v1(timestamptz, uuid)
  from public, anon, authenticated, service_role;

grant execute on function public.get_admin_ai_unlock_runtime_gate_v1()
  to service_role;
grant execute on function public.set_admin_ai_policy_v1(text, uuid, uuid, uuid, text[], text[], integer, integer, bigint, bigint, bigint, bigint, bigint, bigint, integer, integer, integer, timestamptz, timestamptz, uuid)
  to service_role;
grant execute on function public.enroll_admin_ai_pin_v1(text, uuid, uuid, text, integer, uuid)
  to service_role;
grant execute on function public.get_admin_ai_pin_factor_metadata_v1(text, uuid, uuid, text, text, uuid)
  to service_role;
grant execute on function public.verify_admin_ai_pin_v1(text, uuid, uuid, integer, text, text, text, uuid)
  to service_role;
grant execute on function public.begin_admin_ai_browser_enrollment_v1(text, uuid, uuid, text, uuid, text, text, text, timestamptz, uuid)
  to service_role;
grant execute on function public.complete_admin_ai_browser_enrollment_v1(text, uuid, uuid, text, integer, text, text, jsonb, uuid)
  to service_role;
grant execute on function public.begin_admin_ai_browser_assertion_v1(text, uuid, uuid, text, text, text, uuid, text, uuid, bigint, timestamptz, uuid)
  to service_role;
grant execute on function public.complete_admin_ai_browser_assertion_v1(text, uuid, uuid, text, text, text, text, boolean, uuid)
  to service_role;
grant execute on function public.revoke_admin_ai_browser_credential_v1(text, uuid, uuid, uuid, uuid)
  to service_role;
grant execute on function public.cleanup_admin_ai_ephemera_v1(timestamptz, uuid)
  to service_role;

comment on column private.admin_ai_unlock_factors.pin_verifier is
  'bcrypt verifier of a versioned Edge pepper HMAC; never a direct verifier of the low-entropy user input.';

comment on column public.lecture_ai_master_authorizations.unlock_method is
  'Nullable for legacy rows. New Phase 7.30 master rows record ai_pin or remembered_browser provenance without storing proof material.';
