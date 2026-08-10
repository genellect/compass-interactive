CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT plan(15);

SELECT ok(
  (
    SELECT authentication_method = 'google_totp'
      AND aal = 2
      AND revoked_at IS NOT NULL
      AND revoke_reason = 'totp_factor_set_migration'
      AND verified_totp_factor_set_hash IS NULL
    FROM public.admin_sessions
    WHERE id = '73022000-0000-4000-8000-000000000008'::uuid
  ),
  'the B2-head Google session is reason-revoked without inferred factor binding'
);

SELECT ok(
  (
    SELECT app_session.expires_at = auth_session.created_at + interval '8 hours'
      AND app_session.idle_expires_at = app_session.expires_at
    FROM public.admin_sessions AS app_session
    JOIN auth.sessions AS auth_session
      ON auth_session.id = app_session.supabase_auth_session_id
    WHERE app_session.id = '73022000-0000-4000-8000-000000000008'::uuid
  ),
  'the B2-created Auth-session cap and no-idle evidence remain unchanged'
);

SELECT ok(
  (
    SELECT status = 'superseded'
      AND challenged_totp_factor_id IS NULL
      AND prechallenge_verified_totp_factor_set_hash IS NULL
      AND verified_totp_factor_set_hash IS NULL
    FROM private.admin_step_up_nonces
    WHERE id = '73022000-0000-4000-8000-00000000000b'::uuid
  )
  AND EXISTS (
    SELECT 1
    FROM private.admin_audit_events
    WHERE target_id = '73022000-0000-4000-8000-00000000000b'
      AND action = 'admin_step_up.migration_supersede'
      AND reason_code = 'totp_factor_set_migration'
      AND metadata ->> 'factor_set_backfilled' = 'false'
  ),
  'the pending B2 login nonce is superseded without inferred factor evidence'
);

SELECT ok(
  (
    SELECT ai_unlock_enabled IS FALSE AND remembered_browser_enabled IS FALSE
    FROM private.admin_ai_unlock_runtime_gate
    WHERE singleton
  )
  AND (
    SELECT google_session_issue_enabled IS FALSE
      AND operator_totp_factor_set_adoption_enabled IS FALSE
    FROM private.admin_identity_runtime_gate
    WHERE singleton
  ),
  'both source gates remain default OFF across the B2-head upgrade'
);

SELECT ok(
  (
    SELECT status = 'active'
      AND factor_version = 1
      AND terminal_request_id IS NULL
      AND terminal_action IS NULL
      AND terminal_by_admin_session_id IS NULL
    FROM private.admin_ai_unlock_factors
    WHERE id = '73022000-0000-4000-8000-00000000000e'::uuid
  ),
  'the active PIN factor is preserved with empty B2.2a terminal evidence'
);

SELECT ok(
  (
    SELECT status = 'active' AND version = 1
    FROM private.admin_ai_policies
    WHERE id = '73022000-0000-4000-8000-000000000010'::uuid
  ),
  'the active AI policy is preserved'
);

SELECT ok(
  (
    SELECT status = 'active' AND revoked_at IS NULL
    FROM private.admin_ai_browser_credentials
    WHERE id = '73022000-0000-4000-8000-000000000013'::uuid
  ),
  'session migration does not destroy the opted-in remembered-browser credential'
);

SELECT ok(
  (
    SELECT status = 'consumed'
      AND completed_browser_credential_id =
        '73022000-0000-4000-8000-000000000013'::uuid
    FROM private.admin_ai_browser_enrollment_nonces
    WHERE id = '73022000-0000-4000-8000-000000000012'::uuid
  )
  AND (
    SELECT status = 'superseded'
    FROM private.admin_ai_browser_enrollment_nonces
    WHERE id = '73022000-0000-4000-8000-000000000016'::uuid
  ),
  'consumed browser enrollment is retained while pending session authority drains'
);

SELECT is(
  (
    SELECT status
    FROM private.admin_ai_browser_assertion_challenges
    WHERE id = '73022000-0000-4000-8000-00000000001a'::uuid
  ),
  'superseded',
  'the pending browser assertion is drained when the old session is revoked'
);

SELECT is(
  (
    SELECT count(*)::integer
    FROM private.admin_ai_pin_discovery_receipts
    WHERE request_id = '73022000-0000-4000-8000-00000000001c'::uuid
  ) + (
    SELECT count(*)::integer
    FROM private.admin_ai_unlock_attempt_receipts
    WHERE request_id = '73022000-0000-4000-8000-00000000001d'::uuid
  ),
  2,
  'B2 discovery and unlock receipts remain immutable audit evidence'
);

SELECT ok(
  EXISTS (
    SELECT 1
    FROM private.admin_ai_unlock_rate_limits
    WHERE environment_id = '73022000-0000-4000-8000-000000000004'::uuid
      AND bucket_kind = 'membership'
      AND failed_attempts = 1
  ),
  'the factor-independent abuse bucket is preserved'
);

SELECT ok(
  (
    SELECT status = 'expired'
      AND revoke_reason = 'admin_session_revoked'
    FROM public.lecture_ai_master_authorizations
    WHERE id = '73022000-0000-4000-8000-00000000001e'::uuid
  ),
  'the existing session trigger expires active lecture AI master authority'
);

SELECT ok(
  NOT EXISTS (SELECT 1 FROM private.admin_control_step_up_nonces)
  AND NOT EXISTS (SELECT 1 FROM private.admin_control_step_up_grants),
  'B2.2a never fabricates rare-control proof or grants while upgrading'
);

SELECT ok(
  EXISTS (
    SELECT 1
    FROM auth.mfa_factors
    WHERE id = '73022000-0000-4000-8000-000000000003'::uuid
      AND user_id = '73022000-0000-4000-8000-000000000001'::uuid
      AND factor_type = 'totp'
      AND status = 'verified'
  )
  AND EXISTS (
    SELECT 1
    FROM private.admin_step_up_nonces
    WHERE id = '73022000-0000-4000-8000-000000000007'::uuid
      AND status = 'consumed'
      AND challenged_totp_factor_id IS NULL
      AND verified_totp_factor_set_hash IS NULL
  ),
  'verified Auth factor and consumed B2 login history remain without backfill'
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
    WHERE id = '73022000-0000-4000-8000-000000000005'::uuid
  ),
  'B2-head verified factors are not inferred into the principal trust anchor'
);

SELECT * FROM finish();
