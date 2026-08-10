CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(8);

SELECT ok(
  (
    SELECT approved_totp_factor_set_hash IS NOT NULL
      AND approved_totp_factor_set_version = 1
      AND approved_totp_factor_count = 1
      AND approved_totp_factor_set_source = 'operator_adoption'
    FROM private.admin_principals
    WHERE id = '73023000-0000-4000-8000-000000000005'::uuid
  ),
  'the explicit B2.2a principal trust anchor is preserved'
);

SELECT ok(
  (
    SELECT status = 'revoked'
      AND revoke_reason = 'totp_binding_upgrade'
      AND approved_totp_factor_set_hash IS NULL
      AND approved_totp_factor_set_version IS NULL
      AND approved_totp_factor_count IS NULL
      AND supabase_auth_session_id IS NULL
    FROM private.admin_ai_browser_credentials
    WHERE id = '73023000-0000-4000-8000-00000000000c'::uuid
  ),
  'pre-B2.2b browser authority is revoked without inferred trust binding'
);

SELECT ok(
  (
    SELECT status = 'consumed'
      AND approved_totp_factor_set_hash IS NULL
      AND approved_totp_factor_set_version IS NULL
      AND approved_totp_factor_count IS NULL
      AND supabase_auth_session_id IS NULL
    FROM private.admin_ai_browser_enrollment_nonces
    WHERE id = '73023000-0000-4000-8000-00000000000b'::uuid
  ),
  'consumed enrollment evidence remains but receives no inferred binding'
);

SELECT ok(
  (
    SELECT status = 'superseded'
      AND approved_totp_factor_set_hash IS NULL
      AND approved_totp_factor_set_version IS NULL
      AND approved_totp_factor_count IS NULL
      AND supabase_auth_session_id IS NULL
    FROM private.admin_ai_browser_enrollment_nonces
    WHERE id = '73023000-0000-4000-8000-00000000000f'::uuid
  ),
  'pending pre-B2.2b enrollment is superseded without backfill'
);

SELECT ok(
  (
    SELECT status = 'active' AND factor_version = 1
    FROM private.admin_ai_unlock_factors
    WHERE id = '73023000-0000-4000-8000-000000000009'::uuid
  ),
  'the personal AI PIN factor is preserved'
);

SELECT is(
  (SELECT count(*)::integer FROM private.admin_totp_factor_transitions),
  0,
  'the upgrade never fabricates a factor-transition authorization'
);

SELECT ok(
  (
    SELECT google_session_issue_enabled IS FALSE
      AND totp_factor_mutation_enabled IS FALSE
    FROM private.admin_identity_runtime_gate
    WHERE singleton
  )
  AND (
    SELECT ai_unlock_enabled IS FALSE
      AND remembered_browser_enabled IS FALSE
    FROM private.admin_ai_unlock_runtime_gate
    WHERE singleton
  ),
  'all B2.2b source gates remain default OFF'
);

SELECT ok(
  EXISTS (
    SELECT 1
    FROM auth.mfa_factors
    WHERE id = '73023000-0000-4000-8000-000000000003'::uuid
      AND status = 'verified'
  ),
  'the upstream verified factor remains unchanged'
);

SELECT * FROM finish();
