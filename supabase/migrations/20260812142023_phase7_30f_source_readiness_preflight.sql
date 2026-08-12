-- Phase 7.30F: operator-only source/readiness preflight.
--
-- This migration is observational. Applying it does not enable a runtime
-- gate, create a cutover receipt, revoke a session, change lecture ownership,
-- or retire any legacy billing compatibility function. The returned UUIDs,
-- counts, timestamps and SHA-256 deployment-evidence digest are content-free
-- operator evidence; no credential, token, PIN, factor secret or user profile
-- value is returned.

create function private.get_phase7_30f_source_readiness_preflight_v1(
  target_environment_id uuid
)
returns jsonb
language sql
stable
security definer
set search_path = ''
set statement_timeout = '10s'
as $$
  with environment_snapshot as (
    select
      environment.environment_kind,
      environment.status = 'active'
        and environment.current_deployment as environment_ready
    from private.admin_environments as environment
    where environment.id = target_environment_id
  ), membership_counts as (
    select jsonb_build_object(
      'activeOwnerCount', (
        select pg_catalog.count(*)::integer
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
      'activeAiEnabledInstructorCount', (
        select pg_catalog.count(*)::integer
        from private.admin_environment_memberships as membership
        join private.admin_principals as principal
          on principal.id = membership.principal_id
        where membership.environment_id = target_environment_id
          and membership.role = 'instructor'
          and membership.can_use_ai
          and membership.status = 'active'
          and (
            membership.expires_at is null
            or membership.expires_at > statement_timestamp()
          )
          and principal.status = 'active'
      ),
      'activeStandardInstructorCount', (
        select pg_catalog.count(*)::integer
        from private.admin_environment_memberships as membership
        join private.admin_principals as principal
          on principal.id = membership.principal_id
        where membership.environment_id = target_environment_id
          and membership.role = 'instructor'
          and not membership.can_use_ai
          and membership.status = 'active'
          and (
            membership.expires_at is null
            or membership.expires_at > statement_timestamp()
          )
          and principal.status = 'active'
      ),
      'suspendedAdminCount', (
        select pg_catalog.count(*)::integer
        from private.admin_environment_memberships as membership
        where membership.environment_id = target_environment_id
          and membership.status = 'suspended'
      ),
      'activePersonalAiPinFactorCount', (
        select pg_catalog.count(*)::integer
        from private.admin_ai_unlock_factors as factor
        join private.admin_environment_memberships as membership
          on membership.id = factor.membership_id
         and membership.environment_id = factor.environment_id
         and membership.principal_id = factor.principal_id
        join private.admin_principals as principal
          on principal.id = factor.principal_id
        where factor.environment_id = target_environment_id
          and factor.factor_kind = 'ai_pin'
          and factor.status = 'active'
          and membership.status = 'active'
          and (
            membership.expires_at is null
            or membership.expires_at > statement_timestamp()
          )
          and principal.status = 'active'
      ),
      'activeApprovedTotpPrincipalCount', (
        select pg_catalog.count(*)::integer
        from private.admin_environment_memberships as membership
        join private.admin_principals as principal
          on principal.id = membership.principal_id
        where membership.environment_id = target_environment_id
          and membership.status = 'active'
          and (
            membership.expires_at is null
            or membership.expires_at > statement_timestamp()
          )
          and principal.status = 'active'
          and principal.approved_totp_factor_set_hash is not null
          and principal.approved_totp_factor_set_version >= 1
          and principal.approved_totp_factor_count >= 1
      )
    ) as value
  ), session_counts as (
    select jsonb_build_object(
      'activeGoogleSessionCount', pg_catalog.count(*),
      'unbackedGoogleSessionCount', pg_catalog.count(*) filter (
        where not exists (
          select 1
          from auth.sessions as auth_session
          where auth_session.id = session.supabase_auth_session_id
            and auth_session.user_id = session.auth_user_id
        )
      )
    ) as value
    from public.admin_sessions as session
    where session.authentication_method = 'google_totp'
      and session.environment_id = target_environment_id
      and session.revoked_at is null
      and session.expires_at > statement_timestamp()
      and session.idle_expires_at > statement_timestamp()
  ), invalid_active_ownership as (
    select pg_catalog.count(*)::integer as value
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
          and membership.expires_at <= statement_timestamp()
        )
      )
  ), cutover_receipt as (
    select jsonb_build_object(
      'count', pg_catalog.count(*)::integer,
      'environmentId', (
        pg_catalog.array_agg(receipt.environment_id order by receipt.committed_at)
      )[1],
      'deploymentEvidenceDigest', (
        pg_catalog.array_agg(
          receipt.deployment_evidence_digest order by receipt.committed_at
        )
      )[1],
      'committedAt', (
        pg_catalog.array_agg(receipt.committed_at order by receipt.committed_at)
      )[1],
      'activeOwnerCount', (
        pg_catalog.array_agg(receipt.active_owner_count order by receipt.committed_at)
      )[1],
      'revokedLegacySessionCount', (
        pg_catalog.array_agg(
          receipt.revoked_legacy_session_count order by receipt.committed_at
        )
      )[1]
    ) as value
    from private.admin_identity_cutover_receipts as receipt
  ), function_acl_targets(key, signature, is_legacy_billing) as (
    values
      (
        'legacyVerifier',
        'public.verify_and_touch_admin_session(uuid,text,text)',
        false
      ),
      (
        'publicAdminIssueAiBillingGrant',
        'public.admin_issue_ai_billing_grant(uuid,text[],text,boolean,text)',
        true
      ),
      (
        'privateIssueAiBillingGrant',
        'private.issue_ai_billing_grant(uuid,text[],text,boolean,text)',
        true
      ),
      (
        'publicAdminConsumeAiBillingGrant',
        'public.admin_consume_ai_billing_grant(uuid,text,uuid,jsonb,text)',
        true
      ),
      (
        'privateConsumeAiBillingGrantAndStartOperations',
        'private.consume_ai_billing_grant_and_start_operations(uuid,text,uuid,jsonb,text)',
        true
      ),
      (
        'publicAdminAuthorizeAiMaster',
        'public.admin_authorize_ai_master(uuid,uuid,text,text,boolean)',
        true
      ),
      (
        'publicAdminIssueAiBillingGrantFromMaster',
        'public.admin_issue_ai_billing_grant_from_master(uuid,uuid,text[],text,text)',
        true
      )
  ), function_acl_rows as (
    select
      target.key,
      target.is_legacy_billing,
      jsonb_build_object(
        'publicExecute', exists (
          select 1
          from pg_catalog.aclexplode(
            coalesce(
              procedure.proacl,
              pg_catalog.acldefault('f', procedure.proowner)
            )
          ) as privilege
          where privilege.grantee = 0
            and privilege.privilege_type = 'EXECUTE'
        ),
        'anonExecute', coalesce(pg_catalog.has_function_privilege(
          'anon', procedure.oid, 'EXECUTE'
        ), false),
        'authenticatedExecute', coalesce(pg_catalog.has_function_privilege(
          'authenticated', procedure.oid, 'EXECUTE'
        ), false),
        'serviceRoleExecute', coalesce(pg_catalog.has_function_privilege(
          'service_role', procedure.oid, 'EXECUTE'
        ), false)
      ) as value
    from function_acl_targets as target
    left join pg_catalog.pg_proc as procedure
      on procedure.oid = pg_catalog.to_regprocedure(target.signature)
  ), legacy_billing_acl as (
    select
      pg_catalog.jsonb_object_agg(acl_row.key, acl_row.value) as value,
      coalesce(pg_catalog.bool_and(
        not (acl_row.value ->> 'publicExecute')::boolean
        and not (acl_row.value ->> 'anonExecute')::boolean
        and not (acl_row.value ->> 'authenticatedExecute')::boolean
        and not (acl_row.value ->> 'serviceRoleExecute')::boolean
      ), false) as retired
    from function_acl_rows as acl_row
    where acl_row.is_legacy_billing
  ), trigger_state as (
    select jsonb_build_object(
      'legacyGateTombstoneEnabled', exists (
        select 1
        from pg_catalog.pg_trigger as trigger_row
        where trigger_row.tgrelid =
          'private.admin_identity_runtime_gate'::regclass
          and trigger_row.tgname =
            'admin_identity_runtime_gate_google_only_tombstone'
          and not trigger_row.tgisinternal
          and trigger_row.tgenabled in ('O', 'A')
      ),
      'legacySessionFenceEnabled', exists (
        select 1
        from pg_catalog.pg_trigger as trigger_row
        where trigger_row.tgrelid = 'public.admin_sessions'::regclass
          and trigger_row.tgname = 'admin_sessions_google_only_admin_fence'
          and not trigger_row.tgisinternal
          and trigger_row.tgenabled in ('O', 'A')
      ),
      'activeLectureOwnershipFenceEnabled', exists (
        select 1
        from pg_catalog.pg_trigger as trigger_row
        where trigger_row.tgrelid = 'public.lecture_sessions'::regclass
          and trigger_row.tgname =
            'lecture_sessions_google_only_active_ownership'
          and not trigger_row.tgisinternal
          and trigger_row.tgenabled in ('O', 'A')
      )
    ) as value
  )
  select jsonb_build_object(
    'schemaVersion', 1,
    'authoritative', false,
    'externalHostedAttestationRequired', true,
    'environmentKind', (
      select snapshot.environment_kind from environment_snapshot as snapshot
    ),
    'environmentReady', coalesce((
      select snapshot.environment_ready from environment_snapshot as snapshot
    ), false),
    'googleOnlyCutoverPreflight',
      private.get_google_only_admin_cutover_preflight_v1(
        target_environment_id
      ),
    'identityRuntimeGate', private.get_admin_identity_runtime_gate_v1(),
    'aiUnlockRuntimeGate', private.get_admin_ai_unlock_runtime_gate_v1(),
    'membershipCounts', membership_counts.value,
    'sessionCounts', session_counts.value,
    'invalidActiveOwnershipCount', invalid_active_ownership.value,
    'identityCutoverReceipt', cutover_receipt.value,
    'legacyVerifierAcl', (
      select acl_row.value
      from function_acl_rows as acl_row
      where acl_row.key = 'legacyVerifier'
    ),
    'triggers', trigger_state.value,
    'legacyBillingAcl', legacy_billing_acl.value,
    'legacyBillingCompatibilityRetired', legacy_billing_acl.retired
  )
  from membership_counts
  cross join session_counts
  cross join invalid_active_ownership
  cross join cutover_receipt
  cross join trigger_state
  cross join legacy_billing_acl;
$$;

comment on function private.get_phase7_30f_source_readiness_preflight_v1(uuid)
is
  'Operator-only read-only Phase 7.30F source/readiness evidence. It never authorizes Hosted execution, identity cutover, billing retirement or Production activation.';

revoke all on function private.get_phase7_30f_source_readiness_preflight_v1(uuid)
  from public, anon, authenticated, service_role;
