CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT plan(15);

SELECT is(
  (
    SELECT count(*)::integer
    FROM public.admin_sessions
    WHERE id = '73000000-0000-4000-8000-000000000001'::uuid
  ),
  1,
  'the populated legacy Admin session survives the B1 migration'
);
SELECT is(
  (
    SELECT authentication_method
    FROM public.admin_sessions
    WHERE id = '73000000-0000-4000-8000-000000000001'::uuid
  ),
  'legacy_pin',
  'the existing row is explicitly classified as legacy PIN auth'
);
SELECT is(
  (
    SELECT aal
    FROM public.admin_sessions
    WHERE id = '73000000-0000-4000-8000-000000000001'::uuid
  ),
  1::smallint,
  'the existing row retains AAL1 semantics'
);
SELECT is(
  (
    SELECT pin_version_hash
    FROM public.admin_sessions
    WHERE id = '73000000-0000-4000-8000-000000000001'::uuid
  ),
  repeat('8', 64),
  'the existing PIN-version fence remains intact'
);
SELECT is(
  (
    SELECT principal_id
    FROM public.admin_sessions
    WHERE id = '73000000-0000-4000-8000-000000000001'::uuid
  ),
  null::uuid,
  'legacy rows do not acquire a Google principal'
);
SELECT is(
  (
    SELECT membership_id
    FROM public.admin_sessions
    WHERE id = '73000000-0000-4000-8000-000000000001'::uuid
  ),
  null::uuid,
  'legacy rows do not acquire an environment membership'
);
SELECT is(
  (
    SELECT environment_id
    FROM public.admin_sessions
    WHERE id = '73000000-0000-4000-8000-000000000001'::uuid
  ),
  null::uuid,
  'legacy rows do not acquire an Admin environment'
);
SELECT is(
  (
    SELECT supabase_auth_session_id
    FROM public.admin_sessions
    WHERE id = '73000000-0000-4000-8000-000000000001'::uuid
  ),
  null::uuid,
  'legacy rows do not acquire a Google Auth session binding'
);
SELECT is(
  (
    SELECT step_up_nonce_id
    FROM public.admin_sessions
    WHERE id = '73000000-0000-4000-8000-000000000001'::uuid
  ),
  null::uuid,
  'legacy rows do not acquire a TOTP step-up nonce'
);

SET ROLE service_role;

SELECT is(
  public.verify_and_touch_admin_session(
    '73000000-0000-4000-8000-000000000001'::uuid,
    repeat('7', 64),
    repeat('8', 64)
  ) ->> 'id',
  '73000000-0000-4000-8000-000000000001',
  'the hardened legacy verifier still accepts the migrated session'
);
SELECT is(
  public.verify_and_touch_admin_session(
    '73000000-0000-4000-8000-000000000001'::uuid,
    repeat('7', 64),
    repeat('9', 64)
  )::text,
  null,
  'the migrated session still rejects a changed PIN-version fence'
);

RESET ROLE;

UPDATE public.admin_sessions
SET revoked_at = null, revoke_reason = null
WHERE id = '73000000-0000-4000-8000-000000000001'::uuid;

SET ROLE service_role;

SELECT throws_ok(
  $$
    UPDATE public.admin_sessions
    SET
      authentication_method = 'google_totp',
      supabase_auth_session_id = '73000000-0000-4000-8000-000000000003'::uuid
    WHERE id = '73000000-0000-4000-8000-000000000001'::uuid
  $$,
  '23514',
  null,
  'legacy data cannot be relabelled as Google without its provenance'
);
SELECT lives_ok(
  $$
    UPDATE public.admin_sessions
    SET revoked_at = statement_timestamp(), revoke_reason = 'upgrade_probe'
    WHERE id = '73000000-0000-4000-8000-000000000001'::uuid
  $$,
  'service-role legacy revocation remains available after upgrade'
);
SELECT is(
  public.verify_and_touch_admin_session(
    '73000000-0000-4000-8000-000000000001'::uuid,
    repeat('7', 64),
    repeat('8', 64)
  )::text,
  null,
  'a revoked migrated session cannot be restored by the legacy verifier'
);

RESET ROLE;

SELECT is(
  (
    SELECT revoke_reason
    FROM public.admin_sessions
    WHERE id = '73000000-0000-4000-8000-000000000001'::uuid
  ),
  'upgrade_probe',
  'the legacy revocation reason remains auditable'
);

SELECT * FROM finish();
