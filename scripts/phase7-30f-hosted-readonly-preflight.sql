\set ON_ERROR_STOP on

-- Phase 7.30F operator input. Supply values with psql -v. Neither value is
-- emitted: the evidence snapshot records only content-free counts, gate/ACL
-- booleans, and exact-binding booleans.
\if :{?phase730f_environment_id}
\else
  \echo 'phase730f_environment_id is required'
  \quit 2
\endif
\if :{?phase730f_deployment_evidence_digest}
\else
  \echo 'phase730f_deployment_evidence_digest is required'
  \quit 2
\endif

begin transaction read only;
set local statement_timeout = '10s';
set local lock_timeout = '750ms';

with input as (
  select
    :'phase730f_environment_id'::uuid as environment_id,
    :'phase730f_deployment_evidence_digest'::text as deployment_evidence_digest,
    1 / case
      when :'phase730f_deployment_evidence_digest'::text
        ~ '^[0-9a-f]{64}$'
      then 1
      else 0
    end as validated
), raw_snapshot as (
  select
    input.*,
    private.get_phase7_30f_source_readiness_preflight_v1(
      input.environment_id
    ) as value
  from input
), e_preflight as (
  -- The function above embeds the exact existing E authority. Keep the direct
  -- reference visible so source/static evidence also proves this dependency.
  select
    raw_snapshot.*,
    1 / case
      when raw_snapshot.value ->> 'environmentKind' = 'staging'
      then 1
      else 0
    end as staging_validated,
    raw_snapshot.value -> 'googleOnlyCutoverPreflight' as e_value,
    raw_snapshot.value -> 'identityRuntimeGate' as identity_value,
    raw_snapshot.value -> 'aiUnlockRuntimeGate' as ai_value,
    raw_snapshot.value -> 'identityCutoverReceipt' as receipt_value,
    raw_snapshot.value -> 'membershipCounts' as membership_value,
    raw_snapshot.value -> 'sessionCounts' as session_value
  from raw_snapshot
  where pg_catalog.to_regprocedure(
    'private.get_google_only_admin_cutover_preflight_v1(uuid)'
  ) is not null
)
select pg_catalog.jsonb_pretty(jsonb_build_object(
  'activeLegacyMasterCount',
    (e_preflight.e_value ->> 'activeLegacyMasterCount')::integer,
  'activeLegacySessionCount',
    (e_preflight.e_value ->> 'activeLegacySessionCount')::integer,
  'activeOwnerCount',
    (e_preflight.e_value ->> 'activeOwnerCount')::integer,
  'activeAiEnabledInstructorCount',
    (e_preflight.membership_value
      ->> 'activeAiEnabledInstructorCount')::integer,
  'activeStandardInstructorCount',
    (e_preflight.membership_value
      ->> 'activeStandardInstructorCount')::integer,
  'suspendedAdminCount',
    (e_preflight.membership_value ->> 'suspendedAdminCount')::integer,
  'suspendedInstructorCount',
    (e_preflight.membership_value ->> 'suspendedInstructorCount')::integer,
  'activePersonalAiPinFactorCount',
    (e_preflight.membership_value
      ->> 'activePersonalAiPinFactorCount')::integer,
  'activeAiEnabledInstructorPersonalAiPinFactorCount',
    (e_preflight.membership_value
      ->> 'activeAiEnabledInstructorPersonalAiPinFactorCount')::integer,
  'activeApprovedTotpPrincipalCount',
    (e_preflight.membership_value
      ->> 'activeApprovedTotpPrincipalCount')::integer,
  'activeOwnerApprovedTotpCount',
    (e_preflight.membership_value
      ->> 'activeOwnerApprovedTotpCount')::integer,
  'activeAiEnabledInstructorApprovedTotpCount',
    (e_preflight.membership_value
      ->> 'activeAiEnabledInstructorApprovedTotpCount')::integer,
  'activeStandardInstructorApprovedTotpCount',
    (e_preflight.membership_value
      ->> 'activeStandardInstructorApprovedTotpCount')::integer,
  'activeGoogleSessionCount',
    (e_preflight.session_value ->> 'activeGoogleSessionCount')::integer,
  'unbackedGoogleSessionCount',
    (e_preflight.session_value ->> 'unbackedGoogleSessionCount')::integer,
  'overCapGoogleSessionCount',
    (e_preflight.session_value ->> 'overCapGoogleSessionCount')::integer,
  'googleSessionIdleCapMismatchCount',
    (e_preflight.session_value
      ->> 'googleSessionIdleCapMismatchCount')::integer,
  'invalidGoogleSessionAuthorityCount',
    (e_preflight.session_value
      ->> 'invalidGoogleSessionAuthorityCount')::integer,
  'authoritative',
    (e_preflight.e_value ->> 'authoritative')::boolean,
  'cutoverCommitted',
    (e_preflight.e_value ->> 'cutoverCommitted')::boolean,
  'environmentReady',
    (e_preflight.e_value ->> 'environmentReady')::boolean,
  'externalTransportAttestationRequired',
    (e_preflight.e_value ->> 'externalTransportAttestationRequired')::boolean,
  'googleAdminLedgerEnabled',
    (e_preflight.e_value ->> 'googleAdminLedgerEnabled')::boolean,
  'googleOperationalAuthorizationEnabled',
    (e_preflight.e_value ->> 'googleOperationalAuthorizationEnabled')::boolean,
  'googleSessionIssueEnabled',
    (e_preflight.e_value ->> 'googleSessionIssueEnabled')::boolean,
  'issuedLegacyGrantCount',
    (e_preflight.e_value ->> 'issuedLegacyGrantCount')::integer,
  'pendingLegacyAcademicCount',
    (e_preflight.e_value ->> 'pendingLegacyAcademicCount')::integer,
  'runningLegacySummaryCount',
    (e_preflight.e_value ->> 'runningLegacySummaryCount')::integer,
  'runningLegacyUsageCount',
    (e_preflight.e_value ->> 'runningLegacyUsageCount')::integer,
  'unboundPdfPublicationCount',
    (e_preflight.e_value ->> 'unboundPdfPublicationCount')::integer,
  'unownedActiveLectureCount',
    (e_preflight.e_value ->> 'unownedActiveLectureCount')::integer,
  'legacyPinLoginEnabled',
    (e_preflight.identity_value ->> 'legacy_pin_login_enabled')::boolean,
  'operatorTotpFactorSetAdoptionEnabled',
    (e_preflight.identity_value
      ->> 'operator_totp_factor_set_adoption_enabled')::boolean,
  'totpFactorMutationEnabled',
    (e_preflight.identity_value ->> 'totp_factor_mutation_enabled')::boolean,
  'aiUnlockEnabled',
    (e_preflight.ai_value ->> 'ai_unlock_enabled')::boolean,
  'googleAiMasterAdmissionEnabled',
    (e_preflight.ai_value
      ->> 'google_ai_master_admission_enabled')::boolean,
  'rememberedBrowserEnabled',
    (e_preflight.ai_value ->> 'remembered_browser_enabled')::boolean,
  'invalidActiveOwnershipCount',
    (e_preflight.value ->> 'invalidActiveOwnershipCount')::integer,
  'cutoverReceiptCount',
    (e_preflight.receipt_value ->> 'count')::integer,
  'cutoverReceiptEnvironmentMatches', case
    when (e_preflight.receipt_value ->> 'count')::integer = 0 then null
    else (e_preflight.receipt_value ->> 'environmentId')::uuid =
      e_preflight.environment_id
  end,
  'cutoverReceiptDeploymentEvidenceDigestMatches', case
    when (e_preflight.receipt_value ->> 'count')::integer = 0 then null
    else e_preflight.receipt_value ->> 'deploymentEvidenceDigest' =
      e_preflight.deployment_evidence_digest
  end,
  'legacyVerifierServiceRoleExecute',
    (e_preflight.value -> 'legacyVerifierAcl'
      ->> 'serviceRoleExecute')::boolean,
  'legacyBillingAcl', e_preflight.value -> 'legacyBillingAcl',
  'triggers', jsonb_build_object(
    'legacyGateTombstoneEnabled',
      (e_preflight.value -> 'triggers'
        ->> 'legacyGateTombstoneEnabled')::boolean,
    'legacySessionFenceEnabled',
      (e_preflight.value -> 'triggers'
        ->> 'legacySessionFenceEnabled')::boolean,
    'activeLectureOwnershipFenceEnabled',
      (e_preflight.value -> 'triggers'
        ->> 'activeLectureOwnershipFenceEnabled')::boolean,
    'googleSessionAbsoluteIdleTriggerEnabled',
      (e_preflight.value -> 'triggers'
        ->> 'googleSessionAbsoluteIdleTriggerEnabled')::boolean
  )
)) as phase730f_readiness_snapshot
from e_preflight
where e_preflight.validated = 1
  and e_preflight.staging_validated = 1;

rollback;
