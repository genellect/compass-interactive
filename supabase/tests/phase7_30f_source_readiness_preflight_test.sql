BEGIN ISOLATION LEVEL SERIALIZABLE;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path = public, extensions;
SELECT no_plan();

CREATE TEMP TABLE phase730f_legacy_billing_functions(
  key text PRIMARY KEY,
  signature text NOT NULL UNIQUE
) ON COMMIT DROP;

INSERT INTO phase730f_legacy_billing_functions(key, signature) VALUES
  (
    'publicAdminIssueAiBillingGrant',
    'public.admin_issue_ai_billing_grant(uuid,text[],text,boolean,text)'
  ),
  (
    'privateIssueAiBillingGrant',
    'private.issue_ai_billing_grant(uuid,text[],text,boolean,text)'
  ),
  (
    'publicAdminConsumeAiBillingGrant',
    'public.admin_consume_ai_billing_grant(uuid,text,uuid,jsonb,text)'
  ),
  (
    'privateConsumeAiBillingGrantAndStartOperations',
    'private.consume_ai_billing_grant_and_start_operations(uuid,text,uuid,jsonb,text)'
  ),
  (
    'publicAdminAuthorizeAiMaster',
    'public.admin_authorize_ai_master(uuid,uuid,text,text,boolean)'
  ),
  (
    'publicAdminIssueAiBillingGrantFromMaster',
    'public.admin_issue_ai_billing_grant_from_master(uuid,uuid,text[],text,text)'
  );

SELECT has_function(
  'private',
  'get_phase7_30f_source_readiness_preflight_v1',
  ARRAY['uuid'],
  'Phase 7.30F operator preflight exists with the fixed UUID ABI'
);

SELECT ok(
  (
    SELECT pg_get_userbyid(procedure.proowner) = 'postgres'
      AND procedure.prosecdef
      AND procedure.provolatile = 's'
      AND pg_get_function_result(procedure.oid) = 'jsonb'
      AND coalesce(
        procedure.proconfig @> ARRAY[
          'search_path=""',
          'statement_timeout=10s'
        ]::text[],
        false
      )
    FROM pg_proc AS procedure
    WHERE procedure.oid =
      'private.get_phase7_30f_source_readiness_preflight_v1(uuid)'::regprocedure
  ),
  'Phase 7.30F preflight is a bounded fixed-path postgres-owned stable definer'
);

SELECT ok(
  (
    SELECT NOT has_function_privilege(
      'service_role', procedure.oid, 'EXECUTE'
    )
      AND NOT has_function_privilege('anon', procedure.oid, 'EXECUTE')
      AND NOT has_function_privilege(
        'authenticated', procedure.oid, 'EXECUTE'
      )
      AND NOT EXISTS (
        SELECT 1
        FROM aclexplode(
          coalesce(
            procedure.proacl,
            acldefault('f', procedure.proowner)
          )
        ) AS privilege
        WHERE privilege.grantee = 0
          AND privilege.privilege_type = 'EXECUTE'
      )
    FROM pg_proc AS procedure
    WHERE procedure.oid =
      'private.get_phase7_30f_source_readiness_preflight_v1(uuid)'::regprocedure
  ),
  'only the database owner/operator can execute the Phase 7.30F preflight'
);

SELECT ok(
  (
    SELECT
      position(
        'private.get_google_only_admin_cutover_preflight_v1('
        IN procedure_definition.value
      ) > 0
      AND position(
        'private.get_admin_identity_runtime_gate_v1()'
        IN procedure_definition.value
      ) > 0
      AND position(
        'private.get_admin_ai_unlock_runtime_gate_v1()'
        IN procedure_definition.value
      ) > 0
      AND position('auth.sessions' IN procedure_definition.value) > 0
      AND position(
        'private.admin_identity_cutover_receipts'
        IN procedure_definition.value
      ) > 0
      AND position('pg_catalog.pg_trigger' IN procedure_definition.value) > 0
      AND position(
        'pg_catalog.to_regprocedure'
        IN procedure_definition.value
      ) > 0
      AND position(
        'legacyBillingCompatibilityRetired'
        IN procedure_definition.value
      ) > 0
    FROM (
      SELECT pg_get_functiondef(
        'private.get_phase7_30f_source_readiness_preflight_v1(uuid)'::regprocedure
      ) AS value
    ) AS procedure_definition
  ),
  'preflight composes the reviewed E, identity, AI, Auth, receipt, trigger and ACL authorities'
);

SELECT unlike(
  lower(pg_get_functiondef(
    'private.get_phase7_30f_source_readiness_preflight_v1(uuid)'::regprocedure
  )),
  '%insert into%',
  'preflight contains no INSERT mutation'
);
SELECT unlike(
  lower(pg_get_functiondef(
    'private.get_phase7_30f_source_readiness_preflight_v1(uuid)'::regprocedure
  )),
  '%update %',
  'preflight contains no UPDATE mutation'
);
SELECT unlike(
  lower(pg_get_functiondef(
    'private.get_phase7_30f_source_readiness_preflight_v1(uuid)'::regprocedure
  )),
  '%delete from%',
  'preflight contains no DELETE mutation'
);

SELECT ok(
  (
    SELECT gate.legacy_pin_login_enabled
      AND NOT gate.google_session_issue_enabled
      AND NOT gate.operator_totp_factor_set_adoption_enabled
      AND NOT gate.totp_factor_mutation_enabled
      AND NOT gate.google_operational_authorization_enabled
      AND NOT gate.google_admin_ledger_enabled
    FROM private.admin_identity_runtime_gate AS gate
    WHERE gate.singleton
  )
  AND NOT EXISTS (
    SELECT 1 FROM private.admin_identity_cutover_receipts
  ),
  'migration leaves the pre-cutover identity gates and receipt state unchanged'
);

SELECT ok(
  (
    SELECT NOT gate.ai_unlock_enabled
      AND NOT gate.google_ai_master_admission_enabled
      AND NOT gate.remembered_browser_enabled
    FROM private.admin_ai_unlock_runtime_gate AS gate
    WHERE gate.singleton
  ),
  'migration leaves all AI-unlock runtime gates default OFF'
);

SELECT is(
  (
    SELECT count(*)::integer
    FROM phase730f_legacy_billing_functions AS expected
    JOIN pg_proc AS procedure
      ON procedure.oid = to_regprocedure(expected.signature)
  ),
  6,
  'all exact six legacy billing compatibility functions still exist'
);

SELECT ok(
  NOT EXISTS (
    SELECT 1
    FROM phase730f_legacy_billing_functions AS expected
    JOIN pg_proc AS procedure
      ON procedure.oid = to_regprocedure(expected.signature)
    WHERE NOT has_function_privilege(
        'service_role', procedure.oid, 'EXECUTE'
      )
      OR has_function_privilege('anon', procedure.oid, 'EXECUTE')
      OR has_function_privilege(
        'authenticated', procedure.oid, 'EXECUTE'
      )
      OR EXISTS (
        SELECT 1
        FROM aclexplode(
          coalesce(
            procedure.proacl,
            acldefault('f', procedure.proowner)
          )
        ) AS privilege
        WHERE privilege.grantee = 0
          AND privilege.privilege_type = 'EXECUTE'
      )
  ),
  'current HOLD keeps exact six billing functions service-only without retiring them'
);

CREATE TEMP TABLE phase730f_before_state(value jsonb NOT NULL)
ON COMMIT DROP;

INSERT INTO phase730f_before_state(value)
SELECT jsonb_build_object(
  'identityGate', (
    SELECT to_jsonb(gate)
    FROM private.admin_identity_runtime_gate AS gate
    WHERE gate.singleton
  ),
  'aiGate', (
    SELECT to_jsonb(gate)
    FROM private.admin_ai_unlock_runtime_gate AS gate
    WHERE gate.singleton
  ),
  'cutoverReceiptCount', (
    SELECT count(*) FROM private.admin_identity_cutover_receipts
  ),
  'membershipCount', (
    SELECT count(*) FROM private.admin_environment_memberships
  ),
  'adminSessionCount', (
    SELECT count(*) FROM public.admin_sessions
  ),
  'lectureOwnershipCount', (
    SELECT count(*) FROM private.admin_lecture_ownerships
  ),
  'legacyBillingServiceAcl', (
    SELECT jsonb_object_agg(
      expected.key,
      has_function_privilege(
        'service_role', to_regprocedure(expected.signature), 'EXECUTE'
      )
    )
    FROM phase730f_legacy_billing_functions AS expected
  )
);

CREATE TEMP TABLE phase730f_snapshot(value jsonb NOT NULL)
ON COMMIT DROP;

INSERT INTO phase730f_snapshot(value)
SELECT private.get_phase7_30f_source_readiness_preflight_v1(
  '00000000-0000-4000-8000-00000000f101'::uuid
);

SELECT is(
  (
    SELECT array_agg(keys.key ORDER BY keys.key)
    FROM phase730f_snapshot AS snapshot
    CROSS JOIN LATERAL jsonb_object_keys(snapshot.value) AS keys(key)
  ),
  ARRAY[
    'aiUnlockRuntimeGate',
    'authoritative',
    'environmentKind',
    'environmentReady',
    'externalHostedAttestationRequired',
    'googleOnlyCutoverPreflight',
    'identityCutoverReceipt',
    'identityRuntimeGate',
    'invalidActiveOwnershipCount',
    'legacyBillingAcl',
    'legacyBillingCompatibilityRetired',
    'legacyVerifierAcl',
    'membershipCounts',
    'schemaVersion',
    'sessionCounts',
    'triggers'
  ]::text[],
  'top-level Phase 7.30F evidence ABI has the exact key set'
);

SELECT ok(
  (
    SELECT value ->> 'schemaVersion' = '1'
      AND value ->> 'authoritative' = 'false'
      AND value ->> 'externalHostedAttestationRequired' = 'true'
      AND value -> 'environmentKind' = 'null'::jsonb
      AND value ->> 'environmentReady' = 'false'
    FROM phase730f_snapshot
  ),
  'unknown environment remains non-authoritative and requires external Hosted attestation'
);

SELECT is(
  (
    SELECT array_agg(keys.key ORDER BY keys.key)
    FROM phase730f_snapshot AS snapshot
    CROSS JOIN LATERAL jsonb_object_keys(
      snapshot.value -> 'googleOnlyCutoverPreflight'
    ) AS keys(key)
  ),
  ARRAY[
    'activeLegacyMasterCount',
    'activeLegacySessionCount',
    'activeOwnerCount',
    'authoritative',
    'cutoverCommitted',
    'environmentReady',
    'externalTransportAttestationRequired',
    'googleAdminLedgerEnabled',
    'googleOperationalAuthorizationEnabled',
    'googleSessionIssueEnabled',
    'issuedLegacyGrantCount',
    'pendingLegacyAcademicCount',
    'runningLegacySummaryCount',
    'runningLegacyUsageCount',
    'unboundPdfPublicationCount',
    'unownedActiveLectureCount'
  ]::text[],
  'nested E cutover preflight preserves its exact 16-key ABI'
);

SELECT ok(
  (
    SELECT (value -> 'googleOnlyCutoverPreflight') @> jsonb_build_object(
      'activeLegacyMasterCount', 0,
      'activeLegacySessionCount', 0,
      'activeOwnerCount', 0,
      'authoritative', false,
      'cutoverCommitted', false,
      'environmentReady', false,
      'externalTransportAttestationRequired', true,
      'googleAdminLedgerEnabled', false,
      'googleOperationalAuthorizationEnabled', false,
      'googleSessionIssueEnabled', false,
      'issuedLegacyGrantCount', 0,
      'pendingLegacyAcademicCount', 0,
      'runningLegacySummaryCount', 0,
      'runningLegacyUsageCount', 0,
      'unboundPdfPublicationCount', 0,
      'unownedActiveLectureCount', 0
    )
    FROM phase730f_snapshot
  ),
  'fresh zero-state E snapshot is HOLD evidence rather than activation authority'
);

SELECT is(
  (SELECT value -> 'identityRuntimeGate' FROM phase730f_snapshot),
  jsonb_build_object(
    'google_admin_ledger_enabled', false,
    'google_only_admin_cutover_committed', false,
    'google_operational_authorization_enabled', false,
    'google_session_issue_enabled', false,
    'legacy_pin_login_enabled', true,
    'operator_totp_factor_set_adoption_enabled', false,
    'totp_factor_mutation_enabled', false
  ),
  'identity runtime evidence preserves the exact seven current gate values'
);

SELECT is(
  (SELECT value -> 'aiUnlockRuntimeGate' FROM phase730f_snapshot),
  jsonb_build_object(
    'ai_unlock_enabled', false,
    'google_ai_master_admission_enabled', false,
    'remembered_browser_enabled', false
  ),
  'AI-unlock runtime evidence preserves the exact three default-OFF values'
);

SELECT is(
  (SELECT value -> 'membershipCounts' FROM phase730f_snapshot),
  jsonb_build_object(
    'activeOwnerCount', 0,
    'activeAiEnabledInstructorCount', 0,
    'activeStandardInstructorCount', 0,
    'suspendedAdminCount', 0,
    'activePersonalAiPinFactorCount', 0,
    'activeApprovedTotpPrincipalCount', 0
  ),
  'membership and personal-factor evidence has the exact six zero-state counts'
);

SELECT is(
  (SELECT value -> 'sessionCounts' FROM phase730f_snapshot),
  jsonb_build_object(
    'activeGoogleSessionCount', 0,
    'unbackedGoogleSessionCount', 0
  ),
  'Google application-session evidence has the exact two zero-state counts'
);

SELECT is(
  (SELECT (value ->> 'invalidActiveOwnershipCount')::integer
   FROM phase730f_snapshot),
  0,
  'fresh database has no invalid active lecture ownership'
);

SELECT is(
  (SELECT value -> 'identityCutoverReceipt' FROM phase730f_snapshot),
  jsonb_build_object(
    'count', 0,
    'environmentId', null,
    'deploymentEvidenceDigest', null,
    'committedAt', null,
    'activeOwnerCount', null,
    'revokedLegacySessionCount', null
  ),
  'receipt evidence has the exact content-free six-key zero-state shape'
);

SELECT is(
  (SELECT value -> 'legacyVerifierAcl' FROM phase730f_snapshot),
  jsonb_build_object(
    'publicExecute', false,
    'anonExecute', false,
    'authenticatedExecute', false,
    'serviceRoleExecute', true
  ),
  'legacy Admin verifier ACL is observed without changing its current HOLD authority'
);

SELECT is(
  (SELECT value -> 'triggers' FROM phase730f_snapshot),
  jsonb_build_object(
    'legacyGateTombstoneEnabled', true,
    'legacySessionFenceEnabled', true,
    'activeLectureOwnershipFenceEnabled', true
  ),
  'all three E safety triggers are installed and enabled'
);

SELECT is(
  (
    SELECT array_agg(keys.key ORDER BY keys.key)
    FROM phase730f_snapshot AS snapshot
    CROSS JOIN LATERAL jsonb_object_keys(
      snapshot.value -> 'legacyBillingAcl'
    ) AS keys(key)
  ),
  ARRAY[
    'privateConsumeAiBillingGrantAndStartOperations',
    'privateIssueAiBillingGrant',
    'publicAdminAuthorizeAiMaster',
    'publicAdminConsumeAiBillingGrant',
    'publicAdminIssueAiBillingGrant',
    'publicAdminIssueAiBillingGrantFromMaster'
  ]::text[],
  'legacy billing evidence contains only the exact six compatibility paths'
);

SELECT ok(
  NOT EXISTS (
    SELECT 1
    FROM phase730f_snapshot AS snapshot
    CROSS JOIN LATERAL jsonb_each(
      snapshot.value -> 'legacyBillingAcl'
    ) AS acl(key, value)
    WHERE acl.value <> jsonb_build_object(
      'publicExecute', false,
      'anonExecute', false,
      'authenticatedExecute', false,
      'serviceRoleExecute', true
    )
  )
  AND (
    SELECT value ->> 'legacyBillingCompatibilityRetired' = 'false'
    FROM phase730f_snapshot
  ),
  'current exact-six billing service authority is valid HOLD evidence, not retired state'
);

SELECT is(
  (
    SELECT array_agg(keys.key ORDER BY keys.key)
    FROM phase730f_snapshot AS snapshot
    CROSS JOIN LATERAL jsonb_each(
      snapshot.value -> 'legacyBillingAcl'
    ) AS acl(name, value)
    CROSS JOIN LATERAL jsonb_object_keys(acl.value) AS keys(key)
    GROUP BY acl.name
    ORDER BY acl.name
    LIMIT 1
  ),
  ARRAY[
    'anonExecute',
    'authenticatedExecute',
    'publicExecute',
    'serviceRoleExecute'
  ]::text[],
  'each legacy billing ACL record uses the exact four-role shape'
);

SELECT is(
  (
    SELECT count(*)::integer
    FROM phase730f_snapshot AS snapshot
    CROSS JOIN LATERAL jsonb_each(
      snapshot.value -> 'legacyBillingAcl'
    ) AS acl(name, value)
    WHERE (
      SELECT array_agg(keys.key ORDER BY keys.key)
      FROM jsonb_object_keys(acl.value) AS keys(key)
    ) = ARRAY[
      'anonExecute',
      'authenticatedExecute',
      'publicExecute',
      'serviceRoleExecute'
    ]::text[]
  ),
  6,
  'all six legacy billing ACL records use the exact four-role shape'
);

SELECT is(
  (
    SELECT value FROM phase730f_before_state
  ),
  (
    SELECT jsonb_build_object(
      'identityGate', (
        SELECT to_jsonb(gate)
        FROM private.admin_identity_runtime_gate AS gate
        WHERE gate.singleton
      ),
      'aiGate', (
        SELECT to_jsonb(gate)
        FROM private.admin_ai_unlock_runtime_gate AS gate
        WHERE gate.singleton
      ),
      'cutoverReceiptCount', (
        SELECT count(*) FROM private.admin_identity_cutover_receipts
      ),
      'membershipCount', (
        SELECT count(*) FROM private.admin_environment_memberships
      ),
      'adminSessionCount', (
        SELECT count(*) FROM public.admin_sessions
      ),
      'lectureOwnershipCount', (
        SELECT count(*) FROM private.admin_lecture_ownerships
      ),
      'legacyBillingServiceAcl', (
        SELECT jsonb_object_agg(
          expected.key,
          has_function_privilege(
            'service_role', to_regprocedure(expected.signature), 'EXECUTE'
          )
        )
        FROM phase730f_legacy_billing_functions AS expected
      )
    )
  ),
  'executing the preflight does not mutate gates, receipts, identity rows, sessions, ownership or billing ACLs'
);

-- Populate a bounded local-only identity snapshot to prove that the aggregate
-- fields are computed from the authoritative relationships rather than being
-- constant zero placeholders. Everything remains inside this rolled-back
-- pgTAP transaction.
INSERT INTO auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) VALUES
  (
    '00000000-0000-0000-0000-000000000000'::uuid,
    '00000000-0000-4000-8000-00000000f102'::uuid,
    'authenticated', 'authenticated', 'phase730f-owner@example.test', '',
    statement_timestamp() - interval '1 hour',
    '{"provider":"google","providers":["google"]}'::jsonb, '{}'::jsonb,
    statement_timestamp() - interval '1 hour',
    statement_timestamp() - interval '1 hour'
  ),
  (
    '00000000-0000-0000-0000-000000000000'::uuid,
    '00000000-0000-4000-8000-00000000f112'::uuid,
    'authenticated', 'authenticated', 'phase730f-ai@example.test', '',
    statement_timestamp() - interval '1 hour',
    '{"provider":"google","providers":["google"]}'::jsonb, '{}'::jsonb,
    statement_timestamp() - interval '1 hour',
    statement_timestamp() - interval '1 hour'
  ),
  (
    '00000000-0000-0000-0000-000000000000'::uuid,
    '00000000-0000-4000-8000-00000000f122'::uuid,
    'authenticated', 'authenticated', 'phase730f-standard@example.test', '',
    statement_timestamp() - interval '1 hour',
    '{"provider":"google","providers":["google"]}'::jsonb, '{}'::jsonb,
    statement_timestamp() - interval '1 hour',
    statement_timestamp() - interval '1 hour'
  ),
  (
    '00000000-0000-0000-0000-000000000000'::uuid,
    '00000000-0000-4000-8000-00000000f132'::uuid,
    'authenticated', 'authenticated', 'phase730f-suspended@example.test', '',
    statement_timestamp() - interval '1 hour',
    '{"provider":"google","providers":["google"]}'::jsonb, '{}'::jsonb,
    statement_timestamp() - interval '1 hour',
    statement_timestamp() - interval '1 hour'
  );

INSERT INTO auth.sessions (id, user_id, created_at, updated_at) VALUES
  (
    '00000000-0000-4000-8000-00000000f103'::uuid,
    '00000000-0000-4000-8000-00000000f102'::uuid,
    statement_timestamp() - interval '1 hour',
    statement_timestamp() - interval '1 hour'
  ),
  (
    '00000000-0000-4000-8000-00000000f113'::uuid,
    '00000000-0000-4000-8000-00000000f112'::uuid,
    statement_timestamp() - interval '1 hour',
    statement_timestamp() - interval '1 hour'
  );

INSERT INTO auth.mfa_factors (
  id, user_id, friendly_name, factor_type, status, created_at, updated_at
) VALUES
  (
    '00000000-0000-4000-8000-00000000f104'::uuid,
    '00000000-0000-4000-8000-00000000f102'::uuid,
    'phase730f-owner-totp', 'totp', 'verified',
    statement_timestamp() - interval '1 hour',
    statement_timestamp() - interval '1 hour'
  ),
  (
    '00000000-0000-4000-8000-00000000f114'::uuid,
    '00000000-0000-4000-8000-00000000f112'::uuid,
    'phase730f-ai-totp', 'totp', 'verified',
    statement_timestamp() - interval '1 hour',
    statement_timestamp() - interval '1 hour'
  );

INSERT INTO private.admin_environments (
  id, environment_kind, canonical_admin_origin, supabase_issuer,
  current_deployment, bootstrap_sealed_at, owner_invariant_enforced_at
) VALUES (
  '00000000-0000-4000-8000-00000000f101'::uuid,
  'local', 'http://127.0.0.1:5173',
  'http://127.0.0.1:54321/auth/v1', true,
  statement_timestamp() - interval '1 hour',
  statement_timestamp() - interval '1 hour'
);

INSERT INTO private.admin_principals (
  id, auth_user_id, google_issuer, provider_subject_hmac,
  subject_pepper_version, normalized_email, email_verified_at, display_name
) VALUES
  (
    '00000000-0000-4000-8000-00000000f105'::uuid,
    '00000000-0000-4000-8000-00000000f102'::uuid,
    'https://accounts.google.com', repeat('a', 64), 1,
    'phase730f-owner@example.test', statement_timestamp() - interval '1 hour',
    'Phase 7.30F Owner'
  ),
  (
    '00000000-0000-4000-8000-00000000f115'::uuid,
    '00000000-0000-4000-8000-00000000f112'::uuid,
    'https://accounts.google.com', repeat('b', 64), 1,
    'phase730f-ai@example.test', statement_timestamp() - interval '1 hour',
    'Phase 7.30F AI Instructor'
  ),
  (
    '00000000-0000-4000-8000-00000000f125'::uuid,
    '00000000-0000-4000-8000-00000000f122'::uuid,
    'https://accounts.google.com', repeat('c', 64), 1,
    'phase730f-standard@example.test',
    statement_timestamp() - interval '1 hour',
    'Phase 7.30F Standard Instructor'
  ),
  (
    '00000000-0000-4000-8000-00000000f135'::uuid,
    '00000000-0000-4000-8000-00000000f132'::uuid,
    'https://accounts.google.com', repeat('d', 64), 1,
    'phase730f-suspended@example.test',
    statement_timestamp() - interval '1 hour',
    'Phase 7.30F Suspended Instructor'
  );

UPDATE private.admin_principals
SET
  approved_totp_factor_set_hash = snapshot.factor_set_hash,
  approved_totp_factor_set_version = 1,
  approved_totp_factor_count = snapshot.factor_count,
  approved_totp_factor_set_at = statement_timestamp() - interval '30 minutes',
  approved_totp_factor_set_request_id =
    '00000000-0000-4000-8000-00000000f109'::uuid,
  approved_totp_factor_set_source = 'operator_adoption',
  approved_totp_factor_set_actor = 'fixture:phase730f',
  approved_totp_factor_set_reason = 'F aggregate fixture'
FROM private.current_verified_totp_factor_set_snapshot_v1(
  '00000000-0000-4000-8000-00000000f102'::uuid
) AS snapshot
WHERE id = '00000000-0000-4000-8000-00000000f105'::uuid;

UPDATE private.admin_principals
SET
  approved_totp_factor_set_hash = snapshot.factor_set_hash,
  approved_totp_factor_set_version = 1,
  approved_totp_factor_count = snapshot.factor_count,
  approved_totp_factor_set_at = statement_timestamp() - interval '30 minutes',
  approved_totp_factor_set_request_id =
    '00000000-0000-4000-8000-00000000f119'::uuid,
  approved_totp_factor_set_source = 'operator_adoption',
  approved_totp_factor_set_actor = 'fixture:phase730f',
  approved_totp_factor_set_reason = 'F aggregate fixture'
FROM private.current_verified_totp_factor_set_snapshot_v1(
  '00000000-0000-4000-8000-00000000f112'::uuid
) AS snapshot
WHERE id = '00000000-0000-4000-8000-00000000f115'::uuid;

INSERT INTO private.admin_environment_memberships (
  id, environment_id, principal_id, role, status, can_use_ai,
  activated_at, suspended_at, status_reason
) VALUES
  (
    '00000000-0000-4000-8000-00000000f106'::uuid,
    '00000000-0000-4000-8000-00000000f101'::uuid,
    '00000000-0000-4000-8000-00000000f105'::uuid,
    'owner', 'active', false,
    statement_timestamp() - interval '1 hour', null, null
  ),
  (
    '00000000-0000-4000-8000-00000000f116'::uuid,
    '00000000-0000-4000-8000-00000000f101'::uuid,
    '00000000-0000-4000-8000-00000000f115'::uuid,
    'instructor', 'active', true,
    statement_timestamp() - interval '1 hour', null, null
  ),
  (
    '00000000-0000-4000-8000-00000000f126'::uuid,
    '00000000-0000-4000-8000-00000000f101'::uuid,
    '00000000-0000-4000-8000-00000000f125'::uuid,
    'instructor', 'active', false,
    statement_timestamp() - interval '1 hour', null, null
  ),
  (
    '00000000-0000-4000-8000-00000000f136'::uuid,
    '00000000-0000-4000-8000-00000000f101'::uuid,
    '00000000-0000-4000-8000-00000000f135'::uuid,
    'instructor', 'suspended', false,
    null, statement_timestamp() - interval '10 minutes', 'fixture_suspension'
  );

INSERT INTO private.admin_step_up_nonces (
  id, nonce_hash, reserved_admin_session_id, environment_id, principal_id,
  membership_id, supabase_auth_session_id, intended_action, request_id,
  prechallenge_jwt_hash, min_amr_at, challenged_totp_factor_id,
  prechallenge_verified_totp_factor_set_hash,
  verified_totp_factor_set_hash, factor_set_bootstrap_allowed,
  approved_totp_factor_set_version, completion_jwt_hash,
  verified_totp_amr_at, issued_at, expires_at
) VALUES
  (
    '00000000-0000-4000-8000-00000000f107'::uuid, repeat('1', 64),
    '00000000-0000-4000-8000-00000000f108'::uuid,
    '00000000-0000-4000-8000-00000000f101'::uuid,
    '00000000-0000-4000-8000-00000000f105'::uuid,
    '00000000-0000-4000-8000-00000000f106'::uuid,
    '00000000-0000-4000-8000-00000000f103'::uuid,
    'admin_login', '00000000-0000-4000-8000-00000000f109'::uuid,
    repeat('3', 64), statement_timestamp() - interval '1 minute',
    '00000000-0000-4000-8000-00000000f104'::uuid,
    private.current_verified_totp_factor_set_hash_v1(
      '00000000-0000-4000-8000-00000000f102'::uuid
    ),
    private.current_verified_totp_factor_set_hash_v1(
      '00000000-0000-4000-8000-00000000f102'::uuid
    ),
    false, 1, repeat('5', 64), statement_timestamp(),
    statement_timestamp() - interval '1 minute',
    statement_timestamp() + interval '4 minutes'
  ),
  (
    '00000000-0000-4000-8000-00000000f117'::uuid, repeat('2', 64),
    '00000000-0000-4000-8000-00000000f118'::uuid,
    '00000000-0000-4000-8000-00000000f101'::uuid,
    '00000000-0000-4000-8000-00000000f115'::uuid,
    '00000000-0000-4000-8000-00000000f116'::uuid,
    '00000000-0000-4000-8000-00000000f113'::uuid,
    'admin_login', '00000000-0000-4000-8000-00000000f119'::uuid,
    repeat('4', 64), statement_timestamp() - interval '1 minute',
    '00000000-0000-4000-8000-00000000f114'::uuid,
    private.current_verified_totp_factor_set_hash_v1(
      '00000000-0000-4000-8000-00000000f112'::uuid
    ),
    private.current_verified_totp_factor_set_hash_v1(
      '00000000-0000-4000-8000-00000000f112'::uuid
    ),
    false, 1, repeat('6', 64), statement_timestamp(),
    statement_timestamp() - interval '1 minute',
    statement_timestamp() + interval '4 minutes'
  );

UPDATE private.admin_identity_runtime_gate
SET google_session_issue_enabled = true,
    updated_at = statement_timestamp()
WHERE singleton;

INSERT INTO public.admin_sessions (
  id, token_hash, auth_user_id, pin_version_hash, authentication_method, aal,
  principal_id, membership_id, environment_id, supabase_auth_session_id,
  step_up_verified_at, step_up_nonce_id, verified_totp_factor_set_hash,
  issued_at, last_seen_at, idle_expires_at, expires_at
) VALUES
  (
    '00000000-0000-4000-8000-00000000f108'::uuid, repeat('7', 64),
    '00000000-0000-4000-8000-00000000f102'::uuid,
    null, 'google_totp', 2,
    '00000000-0000-4000-8000-00000000f105'::uuid,
    '00000000-0000-4000-8000-00000000f106'::uuid,
    '00000000-0000-4000-8000-00000000f101'::uuid,
    '00000000-0000-4000-8000-00000000f103'::uuid,
    statement_timestamp(),
    '00000000-0000-4000-8000-00000000f107'::uuid,
    private.current_verified_totp_factor_set_hash_v1(
      '00000000-0000-4000-8000-00000000f102'::uuid
    ),
    statement_timestamp() - interval '1 hour',
    statement_timestamp() - interval '1 hour',
    statement_timestamp() + interval '12 hours',
    statement_timestamp() + interval '12 hours'
  ),
  (
    '00000000-0000-4000-8000-00000000f118'::uuid, repeat('8', 64),
    '00000000-0000-4000-8000-00000000f112'::uuid,
    null, 'google_totp', 2,
    '00000000-0000-4000-8000-00000000f115'::uuid,
    '00000000-0000-4000-8000-00000000f116'::uuid,
    '00000000-0000-4000-8000-00000000f101'::uuid,
    '00000000-0000-4000-8000-00000000f113'::uuid,
    statement_timestamp(),
    '00000000-0000-4000-8000-00000000f117'::uuid,
    private.current_verified_totp_factor_set_hash_v1(
      '00000000-0000-4000-8000-00000000f112'::uuid
    ),
    statement_timestamp() - interval '1 hour',
    statement_timestamp() - interval '1 hour',
    statement_timestamp() + interval '12 hours',
    statement_timestamp() + interval '12 hours'
  );

UPDATE private.admin_step_up_nonces
SET
  status = 'consumed',
  consumed_at = statement_timestamp(),
  completed_admin_session_id = case id
    when '00000000-0000-4000-8000-00000000f107'::uuid
      then '00000000-0000-4000-8000-00000000f108'::uuid
    else '00000000-0000-4000-8000-00000000f118'::uuid
  end,
  updated_at = statement_timestamp()
WHERE id in (
  '00000000-0000-4000-8000-00000000f107'::uuid,
  '00000000-0000-4000-8000-00000000f117'::uuid
);

UPDATE private.admin_identity_runtime_gate
SET google_session_issue_enabled = false,
    updated_at = statement_timestamp()
WHERE singleton;

INSERT INTO private.admin_ai_unlock_factors (
  id, environment_id, principal_id, membership_id, pin_verifier,
  pin_pepper_version, factor_version, enrolled_by_admin_session_id,
  enrolled_step_up_verified_at, enrollment_request_id
) VALUES (
  '00000000-0000-4000-8000-00000000f120'::uuid,
  '00000000-0000-4000-8000-00000000f101'::uuid,
  '00000000-0000-4000-8000-00000000f115'::uuid,
  '00000000-0000-4000-8000-00000000f116'::uuid,
  extensions.crypt(repeat('9', 64), extensions.gen_salt('bf', 12)),
  1, 1, '00000000-0000-4000-8000-00000000f118'::uuid,
  statement_timestamp(), '00000000-0000-4000-8000-00000000f121'::uuid
);

DELETE FROM auth.sessions
WHERE id = '00000000-0000-4000-8000-00000000f113'::uuid;

INSERT INTO public.lecture_sessions (
  id, title, code_hash, status
) VALUES (
  '00000000-0000-4000-8000-00000000f130'::uuid,
  'Phase 7.30F invalid ownership evidence', repeat('e', 64), 'draft'
);

INSERT INTO private.admin_lecture_ownerships (
  lecture_session_id, environment_id, principal_id, membership_id,
  assigned_by_admin_session_id, ownership_request_id,
  ownership_intent_digest, ownership_source
) VALUES (
  '00000000-0000-4000-8000-00000000f130'::uuid,
  '00000000-0000-4000-8000-00000000f101'::uuid,
  '00000000-0000-4000-8000-00000000f135'::uuid,
  '00000000-0000-4000-8000-00000000f136'::uuid,
  '00000000-0000-4000-8000-00000000f108'::uuid,
  '00000000-0000-4000-8000-00000000f131'::uuid,
  repeat('f', 64), 'google_create'
);

CREATE TEMP TABLE phase730f_populated_snapshot(value jsonb NOT NULL)
ON COMMIT DROP;

INSERT INTO phase730f_populated_snapshot(value)
SELECT private.get_phase7_30f_source_readiness_preflight_v1(
  '00000000-0000-4000-8000-00000000f101'::uuid
);

SELECT is(
  (SELECT value -> 'membershipCounts' FROM phase730f_populated_snapshot),
  jsonb_build_object(
    'activeOwnerCount', 1,
    'activeAiEnabledInstructorCount', 1,
    'activeStandardInstructorCount', 1,
    'suspendedAdminCount', 1,
    'activePersonalAiPinFactorCount', 1,
    'activeApprovedTotpPrincipalCount', 2
  ),
  'populated membership, entitlement, AI-PIN and approved-TOTP counts are exact'
);

SELECT is(
  (SELECT value -> 'sessionCounts' FROM phase730f_populated_snapshot),
  jsonb_build_object(
    'activeGoogleSessionCount', 2,
    'unbackedGoogleSessionCount', 1
  ),
  'populated session counts distinguish one unbacked Google session'
);

SELECT is(
  (
    SELECT (value ->> 'invalidActiveOwnershipCount')::integer
    FROM phase730f_populated_snapshot
  ),
  1,
  'active lecture ownership tied to a suspended membership is invalid evidence'
);

SELECT ok(
  (
    SELECT value ->> 'environmentKind' = 'local'
      AND value ->> 'environmentReady' = 'true'
      AND value -> 'googleOnlyCutoverPreflight' ->> 'activeOwnerCount' = '1'
      AND value -> 'googleOnlyCutoverPreflight'
        ->> 'unownedActiveLectureCount' = '0'
    FROM phase730f_populated_snapshot
  ),
  'populated environment and nested E authority remain internally consistent'
);

SELECT * FROM finish();
ROLLBACK;
