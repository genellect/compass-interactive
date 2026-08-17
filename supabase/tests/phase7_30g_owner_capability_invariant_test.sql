BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path = public, extensions;
SELECT no_plan();

SELECT ok(
  EXISTS (
    SELECT 1
    FROM pg_trigger AS trigger
    JOIN pg_class AS relation ON relation.oid = trigger.tgrelid
    JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = 'private'
      AND relation.relname = 'admin_environment_memberships'
      AND trigger.tgname = 'admin_memberships_owner_capability_guard'
      AND trigger.tgdeferrable
      AND trigger.tginitdeferred
      AND NOT trigger.tgisinternal
  ),
  'the Owner capability invariant is deferred until invitation acceptance finishes'
);

SELECT ok(
  EXISTS (
    SELECT 1
    FROM pg_trigger AS trigger
    JOIN pg_class AS relation ON relation.oid = trigger.tgrelid
    JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = 'private'
      AND relation.relname = 'admin_invitations'
      AND trigger.tgname = 'admin_invitations_apply_owner_capability'
      AND NOT trigger.tgdeferrable
      AND NOT trigger.tgisinternal
  ),
  'accepted Owner invitations apply the complete capability set before commit'
);

SELECT ok(
  NOT has_function_privilege(
    'service_role',
    'private.normalize_admin_owner_capability_v1()',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'authenticated',
    'private.normalize_admin_owner_capability_v1()',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'anon',
    'private.normalize_admin_owner_capability_v1()',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'service_role',
    'private.apply_accepted_owner_capability_v1()',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'authenticated',
    'private.apply_accepted_owner_capability_v1()',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'anon',
    'private.apply_accepted_owner_capability_v1()',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'service_role',
    'private.enforce_admin_owner_capability_v1()',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'authenticated',
    'private.enforce_admin_owner_capability_v1()',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'anon',
    'private.enforce_admin_owner_capability_v1()',
    'EXECUTE'
  ),
  'Owner capability trigger workers are not callable by application roles'
);

INSERT INTO private.admin_environments (
  id, environment_kind, canonical_admin_origin, supabase_issuer,
  current_deployment
) VALUES (
  '00000000-0000-4000-8000-00000000f701'::uuid,
  'local', 'http://127.0.0.1:5173',
  'http://127.0.0.1:54321/auth/v1', true
);

INSERT INTO private.admin_principals (
  id, auth_user_id, google_issuer, provider_subject_hmac,
  subject_pepper_version, normalized_email, email_verified_at, display_name
) VALUES
  (
    '00000000-0000-4000-8000-00000000f702'::uuid,
    '00000000-0000-4000-8000-00000000f703'::uuid,
    'https://accounts.google.com', repeat('7', 64), 1,
    'phase730g-owner@example.test', statement_timestamp(),
    'Phase 7.30G Owner'
  ),
  (
    '00000000-0000-4000-8000-00000000f712'::uuid,
    '00000000-0000-4000-8000-00000000f713'::uuid,
    'https://accounts.google.com', repeat('8', 64), 1,
    'phase730g-instructor@example.test', statement_timestamp(),
    'Phase 7.30G Instructor'
  );

INSERT INTO private.admin_environment_memberships (
  id, environment_id, principal_id, role, status, can_use_ai, activated_at
) VALUES (
  '00000000-0000-4000-8000-00000000f704'::uuid,
  '00000000-0000-4000-8000-00000000f701'::uuid,
  '00000000-0000-4000-8000-00000000f702'::uuid,
  'owner', 'active', false, statement_timestamp()
);

SELECT throws_ok(
  'SET CONSTRAINTS admin_memberships_owner_capability_guard IMMEDIATE',
  'P7335',
  'Owner must retain the complete capability set',
  'a direct Owner insert cannot commit without the complete capability set'
);

DELETE FROM private.admin_environment_memberships
WHERE id = '00000000-0000-4000-8000-00000000f704'::uuid;

SET CONSTRAINTS admin_memberships_owner_capability_guard IMMEDIATE;

SET CONSTRAINTS admin_memberships_owner_capability_guard DEFERRED;

INSERT INTO private.admin_environment_memberships (
  id, environment_id, principal_id, role, status, can_use_ai, activated_at
) VALUES (
  '00000000-0000-4000-8000-00000000f705'::uuid,
  '00000000-0000-4000-8000-00000000f701'::uuid,
  '00000000-0000-4000-8000-00000000f702'::uuid,
  'owner', 'active', false, statement_timestamp()
);

UPDATE private.admin_environment_memberships
SET id = '00000000-0000-4000-8000-00000000f706'::uuid
WHERE id = '00000000-0000-4000-8000-00000000f705'::uuid;

SELECT throws_ok(
  'SET CONSTRAINTS admin_memberships_owner_capability_guard IMMEDIATE',
  'P7335',
  'Owner must retain the complete capability set',
  'changing only the membership ID cannot bypass the deferred Owner guard'
);

DELETE FROM private.admin_environment_memberships
WHERE id = '00000000-0000-4000-8000-00000000f706'::uuid;

SET CONSTRAINTS admin_memberships_owner_capability_guard IMMEDIATE;

INSERT INTO private.admin_environment_memberships (
  id, environment_id, principal_id, role, status, can_use_ai, activated_at,
  expires_at
) VALUES (
  '00000000-0000-4000-8000-00000000f714'::uuid,
  '00000000-0000-4000-8000-00000000f701'::uuid,
  '00000000-0000-4000-8000-00000000f712'::uuid,
  'instructor', 'active', false, statement_timestamp(),
  statement_timestamp() + interval '30 days'
);

UPDATE private.admin_environment_memberships
SET role = 'owner', expires_at = null
WHERE id = '00000000-0000-4000-8000-00000000f714'::uuid;

SELECT is(
  (
    SELECT can_use_ai
    FROM private.admin_environment_memberships
    WHERE id = '00000000-0000-4000-8000-00000000f714'::uuid
  ),
  true,
  'promotion to Owner atomically grants the complete capability set'
);

SELECT throws_ok(
  $$
    UPDATE private.admin_environment_memberships
    SET can_use_ai = false
    WHERE id = '00000000-0000-4000-8000-00000000f714'::uuid
  $$,
  'P7335',
  'Owner capability cannot be disabled',
  'an existing Owner capability cannot be disabled'
);

INSERT INTO private.admin_principals (
  id, auth_user_id, google_issuer, provider_subject_hmac,
  subject_pepper_version, normalized_email, email_verified_at, display_name
) VALUES (
  '00000000-0000-4000-8000-00000000f722'::uuid,
  '00000000-0000-4000-8000-00000000f723'::uuid,
  'https://accounts.google.com', repeat('9', 64), 1,
  'phase730g-owner-invitee@example.test', statement_timestamp(),
  'Phase 7.30G Owner Invitee'
);

SET CONSTRAINTS admin_memberships_owner_capability_guard DEFERRED;

INSERT INTO private.admin_environment_memberships (
  id, environment_id, principal_id, role, status, can_use_ai
) VALUES (
  '00000000-0000-4000-8000-00000000f724'::uuid,
  '00000000-0000-4000-8000-00000000f701'::uuid,
  '00000000-0000-4000-8000-00000000f722'::uuid,
  'owner', 'pending_mfa', false
);

INSERT INTO private.admin_invitations (
  id, environment_id, invitation_kind, target_email_hmac,
  target_normalized_email, target_email_pepper_version, role, can_use_ai,
  token_hash, inviter_membership_id, membership_expires_at, expires_at,
  status, request_id
) VALUES (
  '00000000-0000-4000-8000-00000000f725'::uuid,
  '00000000-0000-4000-8000-00000000f701'::uuid,
  'invitation', repeat('a', 64), 'phase730g-owner-invitee@example.test', 1,
  'owner', false, repeat('b', 64),
  '00000000-0000-4000-8000-00000000f714'::uuid, null,
  statement_timestamp() + interval '2 days', 'pending',
  '00000000-0000-4000-8000-00000000f726'::uuid
);

UPDATE private.admin_invitations
SET
  status = 'accepted',
  accepted_principal_id = '00000000-0000-4000-8000-00000000f722'::uuid,
  accepted_membership_id = '00000000-0000-4000-8000-00000000f724'::uuid,
  accepted_at = statement_timestamp(),
  updated_at = statement_timestamp()
WHERE id = '00000000-0000-4000-8000-00000000f725'::uuid;

SET CONSTRAINTS admin_memberships_owner_capability_guard IMMEDIATE;

SELECT is(
  (
    SELECT can_use_ai
    FROM private.admin_environment_memberships
    WHERE id = '00000000-0000-4000-8000-00000000f724'::uuid
  ),
  true,
  'accepting an Owner invitation normalizes legacy false capability intent'
);

UPDATE private.admin_environments
SET owner_invariant_enforced_at = statement_timestamp()
WHERE id = '00000000-0000-4000-8000-00000000f701'::uuid;

SELECT throws_ok(
  $$
    UPDATE private.admin_environment_memberships
    SET role = 'instructor', expires_at = statement_timestamp() + interval '1 day'
    WHERE id = '00000000-0000-4000-8000-00000000f714'::uuid
  $$,
  'P7310',
  'An environment must retain an active owner',
  'the complete-capability invariant does not weaken the last-active-Owner guard'
);

SELECT ok(
  (
    SELECT NOT google_session_issue_enabled
      AND NOT google_operational_authorization_enabled
      AND NOT google_admin_ledger_enabled
    FROM private.admin_identity_runtime_gate
    WHERE singleton
  )
  AND (
    SELECT NOT ai_unlock_enabled
      AND NOT google_ai_master_admission_enabled
    FROM private.admin_ai_unlock_runtime_gate
    WHERE singleton
  ),
  'the Owner capability migration does not activate identity or paid AI gates'
);

SELECT ok(
  NOT EXISTS (
    SELECT 1
    FROM private.admin_environment_memberships
    WHERE role = 'owner'
      AND status <> 'revoked'
      AND NOT can_use_ai
  ),
  'all effective Owner memberships retain the complete capability set'
);

SELECT * FROM finish();
ROLLBACK;
