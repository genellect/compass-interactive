begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select no_plan();

select has_function(
  'private',
  'get_phase7_30f_source_readiness_preflight_v1',
  array['uuid'],
  'the populated E-head upgrade installs the fixed Phase 7.30F preflight ABI'
);

select ok(
  (
    select pg_get_userbyid(procedure.proowner) = 'postgres'
      and procedure.prosecdef
      and procedure.provolatile = 's'
      and not has_function_privilege(
        'service_role', procedure.oid, 'EXECUTE'
      )
      and not has_function_privilege('anon', procedure.oid, 'EXECUTE')
      and not has_function_privilege(
        'authenticated', procedure.oid, 'EXECUTE'
      )
      and not exists (
        select 1
        from aclexplode(
          coalesce(
            procedure.proacl,
            acldefault('f', procedure.proowner)
          )
        ) as privilege
        where privilege.grantee = 0
          and privilege.privilege_type = 'EXECUTE'
      )
    from pg_proc as procedure
    where procedure.oid =
      'private.get_phase7_30f_source_readiness_preflight_v1(uuid)'::regprocedure
  ),
  'the upgraded Phase 7.30F preflight remains postgres-owner-only'
);

create temp table phase730f_upgrade_before_call(value jsonb not null)
on commit drop;

insert into phase730f_upgrade_before_call(value)
select jsonb_build_object(
  'identityGate', (
    select to_jsonb(gate)
    from private.admin_identity_runtime_gate as gate
    where gate.singleton
  ),
  'aiGate', (
    select to_jsonb(gate)
    from private.admin_ai_unlock_runtime_gate as gate
    where gate.singleton
  ),
  'cutoverReceiptCount', (
    select count(*) from private.admin_identity_cutover_receipts
  ),
  'membershipCount', (
    select count(*) from private.admin_environment_memberships
  ),
  'adminSessionCount', (
    select count(*) from public.admin_sessions
  ),
  'lectureOwnershipCount', (
    select count(*) from private.admin_lecture_ownerships
  )
);

create temp table phase730f_upgrade_snapshot(value jsonb not null)
on commit drop;

insert into phase730f_upgrade_snapshot(value)
select private.get_phase7_30f_source_readiness_preflight_v1(
  '73035000-0000-4000-8000-000000000001'::uuid
);

select ok(
  (
    select value @> jsonb_build_object(
      'schemaVersion', 1,
      'authoritative', false,
      'externalHostedAttestationRequired', true,
      'environmentKind', 'local',
      'environmentReady', true,
      'invalidActiveOwnershipCount', 0,
      'legacyBillingCompatibilityRetired', false
    )
    from phase730f_upgrade_snapshot
  ),
  'the populated upgrade remains non-authoritative HOLD evidence for the exact local environment'
);

select ok(
  (
    select value -> 'googleOnlyCutoverPreflight' @> jsonb_build_object(
      'activeLegacyMasterCount', 0,
      'activeLegacySessionCount', 0,
      'activeOwnerCount', 2,
      'authoritative', false,
      'cutoverCommitted', false,
      'environmentReady', true,
      'externalTransportAttestationRequired', true,
      'issuedLegacyGrantCount', 0,
      'pendingLegacyAcademicCount', 0,
      'runningLegacySummaryCount', 0,
      'runningLegacyUsageCount', 0,
      'unboundPdfPublicationCount', 0,
      'unownedActiveLectureCount', 0
    )
    from phase730f_upgrade_snapshot
  ),
  'the populated E authority remains exact and the irreversible cutover stays dormant'
);

select is(
  (select value -> 'identityRuntimeGate' from phase730f_upgrade_snapshot),
  jsonb_build_object(
    'google_admin_ledger_enabled', true,
    'google_only_admin_cutover_committed', false,
    'google_operational_authorization_enabled', true,
    'google_session_issue_enabled', true,
    'legacy_pin_login_enabled', true,
    'operator_totp_factor_set_adoption_enabled', false,
    'totp_factor_mutation_enabled', false
  ),
  'the populated identity gates survive F without invoking cutover'
);

select is(
  (select value -> 'aiUnlockRuntimeGate' from phase730f_upgrade_snapshot),
  jsonb_build_object(
    'ai_unlock_enabled', false,
    'google_ai_master_admission_enabled', false,
    'remembered_browser_enabled', false
  ),
  'the populated upgrade leaves every AI admission gate OFF'
);

select is(
  (select value -> 'membershipCounts' from phase730f_upgrade_snapshot),
  jsonb_build_object(
    'activeOwnerCount', 2,
    'activeAiEnabledInstructorCount', 0,
    'activeStandardInstructorCount', 0,
    'suspendedAdminCount', 0,
    'suspendedInstructorCount', 0,
    'activePersonalAiPinFactorCount', 0,
    'activeAiEnabledInstructorPersonalAiPinFactorCount', 0,
    'activeApprovedTotpPrincipalCount', 1,
    'activeOwnerApprovedTotpCount', 1,
    'activeAiEnabledInstructorApprovedTotpCount', 0,
    'activeStandardInstructorApprovedTotpCount', 0
  ),
  'the populated owner and role-correlated approved-TOTP aggregates survive the F upgrade'
);

select is(
  (select value -> 'sessionCounts' from phase730f_upgrade_snapshot),
  jsonb_build_object(
    'activeGoogleSessionCount', 1,
    'unbackedGoogleSessionCount', 0,
    'overCapGoogleSessionCount', 0,
    'googleSessionIdleCapMismatchCount', 0,
    'invalidGoogleSessionAuthorityCount', 0
  ),
  'the populated backed Google application session survives the F upgrade'
);

select is(
  (select value -> 'identityCutoverReceipt' from phase730f_upgrade_snapshot),
  jsonb_build_object(
    'count', 0,
    'environmentId', null,
    'deploymentEvidenceDigest', null,
    'committedAt', null,
    'activeOwnerCount', null,
    'revokedLegacySessionCount', null
  ),
  'the F upgrade does not fabricate an identity cutover receipt'
);

select is(
  (select value -> 'legacyVerifierAcl' from phase730f_upgrade_snapshot),
  jsonb_build_object(
    'functionExists', true,
    'publicExecute', false,
    'anonExecute', false,
    'authenticatedExecute', false,
    'serviceRoleExecute', true
  ),
  'the pre-cutover legacy verifier ACL remains unchanged under F'
);

select ok(
  (
    select (
        select count(*)
        from jsonb_object_keys(value -> 'legacyBillingAcl') as billing_key
      ) = 6
      and not exists (
        select 1
        from jsonb_each(value -> 'legacyBillingAcl') as acl(name, privileges)
        where acl.privileges <> jsonb_build_object(
          'functionExists', true,
          'publicExecute', false,
          'anonExecute', false,
          'authenticatedExecute', false,
          'serviceRoleExecute', true
        )
      )
      and value ->> 'legacyBillingCompatibilityRetired' = 'false'
    from phase730f_upgrade_snapshot
  ),
  'all exact six legacy billing paths remain service-only and not retired'
);

select is(
  (select value -> 'triggers' from phase730f_upgrade_snapshot),
  jsonb_build_object(
    'legacyGateTombstoneEnabled', true,
    'legacySessionFenceEnabled', true,
    'activeLectureOwnershipFenceEnabled', true,
    'googleSessionAbsoluteIdleTriggerEnabled', true
  ),
  'all E safety and Google absolute/idle session triggers remain enabled after the F upgrade'
);

select is(
  (select value from phase730f_upgrade_before_call),
  (
    select jsonb_build_object(
      'identityGate', (
        select to_jsonb(gate)
        from private.admin_identity_runtime_gate as gate
        where gate.singleton
      ),
      'aiGate', (
        select to_jsonb(gate)
        from private.admin_ai_unlock_runtime_gate as gate
        where gate.singleton
      ),
      'cutoverReceiptCount', (
        select count(*) from private.admin_identity_cutover_receipts
      ),
      'membershipCount', (
        select count(*) from private.admin_environment_memberships
      ),
      'adminSessionCount', (
        select count(*) from public.admin_sessions
      ),
      'lectureOwnershipCount', (
        select count(*) from private.admin_lecture_ownerships
      )
    )
  ),
  'the populated Phase 7.30F preflight call is observational'
);

select * from finish();
rollback;
