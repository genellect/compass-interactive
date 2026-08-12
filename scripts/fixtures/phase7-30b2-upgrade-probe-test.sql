CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT plan(16);

SELECT is(
  (
    SELECT count(*)::integer
    FROM public.admin_sessions
    WHERE id = '73020000-0000-4000-8000-000000000006'::uuid
  ),
  1,
  'the populated pre-binding Google Admin session remains as audit history'
);

SELECT ok(
  (
    SELECT app_session.authentication_method = 'google_totp'
      AND app_session.aal = 2
      AND app_session.pin_version_hash IS NULL
      AND app_session.revoked_at IS NOT NULL
      AND app_session.revoke_reason = 'totp_factor_set_migration'
      AND app_session.verified_totp_factor_set_hash IS NULL
    FROM public.admin_sessions AS app_session
    WHERE app_session.id = '73020000-0000-4000-8000-000000000006'::uuid
  ),
  'the upgraded row is reason-revoked without an inferred factor-set hash'
);

SELECT ok(
  (
    SELECT status = 'superseded'
      AND challenged_totp_factor_id IS NULL
      AND prechallenge_verified_totp_factor_set_hash IS NULL
      AND verified_totp_factor_set_hash IS NULL
    FROM private.admin_step_up_nonces
    WHERE id = '73020000-0000-4000-8000-000000000009'::uuid
  )
  AND EXISTS (
    SELECT 1
    FROM private.admin_audit_events
    WHERE target_id = '73020000-0000-4000-8000-000000000009'
      AND action = 'admin_step_up.migration_supersede'
      AND reason_code = 'totp_factor_set_migration'
      AND metadata ->> 'factor_set_backfilled' = 'false'
  ),
  'pre-B2.2a pending login proof is superseded without factor-set inference'
);

SELECT ok(
  (
    SELECT app_session.expires_at = auth_session.created_at + interval '8 hours'
      AND app_session.idle_expires_at = app_session.expires_at
    FROM public.admin_sessions AS app_session
    JOIN auth.sessions AS auth_session
      ON auth_session.id = app_session.supabase_auth_session_id
    WHERE app_session.id = '73020000-0000-4000-8000-000000000006'::uuid
  ),
  'the retained row preserves its Auth-created-at eight-hour cap'
);

SELECT ok(
  (
    SELECT expires_at > statement_timestamp() + interval '6 hours'
    FROM public.admin_sessions
    WHERE id = '73020000-0000-4000-8000-000000000006'::uuid
  ),
  'migration revocation does not rewrite the retained no-idle evidence'
);

SET ROLE service_role;
SELECT is(
  public.verify_and_touch_google_admin_session_v1(
    repeat('b', 64),
    '73020000-0000-4000-8000-000000000001'::uuid,
    '73020000-0000-4000-8000-000000000002'::uuid
  )::text,
  null,
  'a pre-binding Google row cannot be reused after the upgrade'
);
RESET ROLE;

SELECT ok(
  (
    SELECT ai_unlock_enabled IS FALSE AND remembered_browser_enabled IS FALSE
    FROM private.admin_ai_unlock_runtime_gate
    WHERE singleton
  ),
  'B2 remains dormant after a populated upgrade'
);

SELECT ok(
  to_regclass('private.admin_ai_pin_discovery_receipts') IS NOT NULL
  AND to_regclass('private.admin_ai_browser_credentials') IS NOT NULL
  AND to_regclass('private.admin_control_step_up_nonces') IS NOT NULL
  AND to_regclass('private.admin_control_step_up_grants') IS NOT NULL,
  'B2.2a control schema is installed beside preserved session history'
);

SELECT ok(
  (
    SELECT approved_totp_factor_set_hash IS NULL
      AND approved_totp_factor_set_version = 0
      AND approved_totp_factor_count = 0
      AND approved_totp_factor_set_at IS NULL
      AND approved_totp_factor_set_request_id IS NULL
      AND approved_totp_factor_set_source IS NULL
    FROM private.admin_principals
    WHERE id = '73020000-0000-4000-8000-000000000004'::uuid
  ),
  'B1/B2 history does not infer an approved principal TOTP trust anchor'
);

SELECT ok(
  (
    SELECT status = 'accepted'
      AND accepted_principal_id =
        '73020000-0000-4000-8000-000000000004'::uuid
      AND accepted_membership_id =
        '73020000-0000-4000-8000-000000000005'::uuid
      AND accepted_at IS NOT NULL
    FROM private.admin_invitations
    WHERE id = '73020000-0000-4000-8000-00000000000c'::uuid
  ),
  'D preserves accepted bootstrap invitation evidence'
);

SELECT ok(
  (
    SELECT status = 'pending'
      AND revoked_at IS NULL
      AND expired_at IS NULL
      AND accepted_at IS NULL
    FROM private.admin_invitations
    WHERE id = '73020000-0000-4000-8000-00000000000e'::uuid
  ),
  'D preserves a pending legacy invitation without terminal evidence'
);

SELECT ok(
  (
    SELECT status = 'revoked'
      AND revoked_at = updated_at
      AND revocation_reason = 'legacy_terminal'
      AND expired_at IS NULL
    FROM private.admin_invitations
    WHERE id = '73020000-0000-4000-8000-000000000010'::uuid
  ),
  'D backfills bounded evidence for a revoked legacy invitation'
);

SELECT ok(
  (
    SELECT status = 'expired'
      AND expired_at = updated_at
      AND revoked_at IS NULL
    FROM private.admin_invitations
    WHERE id = '73020000-0000-4000-8000-000000000012'::uuid
  ),
  'D backfills bounded evidence for an expired legacy invitation'
);

SELECT ok(
  NOT EXISTS (
    SELECT 1
    FROM private.admin_invitations
    WHERE id IN (
      '73020000-0000-4000-8000-00000000000c'::uuid,
      '73020000-0000-4000-8000-00000000000e'::uuid,
      '73020000-0000-4000-8000-000000000010'::uuid,
      '73020000-0000-4000-8000-000000000012'::uuid
    )
      AND (
        target_normalized_email IS NOT NULL
        OR target_email_pepper_version IS NOT NULL
        OR membership_expires_at IS NOT NULL
      )
  ),
  'D never invents display identity or membership expiry for legacy invitations'
);

SELECT is(
  (SELECT count(*)::integer FROM private.admin_invitation_redemption_receipts),
  0,
  'D does not fabricate redemption receipts for legacy accepted invitations'
);

SELECT ok(
  (
    SELECT google_admin_ledger_enabled IS FALSE
    FROM private.admin_identity_runtime_gate
    WHERE singleton
  )
  AND (
    SELECT count(*) = 13
    FROM private.admin_google_operation_policies
    WHERE edge_function = 'manage-admin-ledger'
  ),
  'D installs the owner ledger dormant with its closed policy slice'
);

SELECT * FROM finish();
