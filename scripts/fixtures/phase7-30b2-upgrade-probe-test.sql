CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT plan(7);

SELECT is(
  (
    SELECT count(*)::integer
    FROM public.admin_sessions
    WHERE id = '73020000-0000-4000-8000-000000000006'::uuid
  ),
  1,
  'the populated Google Admin session survives the B2 migration'
);

SELECT ok(
  (
    SELECT app_session.authentication_method = 'google_totp'
      AND app_session.aal = 2
      AND app_session.pin_version_hash IS NULL
    FROM public.admin_sessions AS app_session
    WHERE app_session.id = '73020000-0000-4000-8000-000000000006'::uuid
  ),
  'the upgraded row retains Google AAL2 provenance'
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
  'B2 caps the populated Google row at Auth created_at plus eight hours'
);

SELECT ok(
  (
    SELECT expires_at > statement_timestamp() + interval '6 hours'
    FROM public.admin_sessions
    WHERE id = '73020000-0000-4000-8000-000000000006'::uuid
  ),
  'B2 does not introduce a 30-minute lecture idle cutoff'
);

SET ROLE service_role;
SELECT is(
  public.verify_and_touch_google_admin_session_v1(
    repeat('b', 64),
    '73020000-0000-4000-8000-000000000001'::uuid,
    '73020000-0000-4000-8000-000000000002'::uuid
  ) ->> 'id',
  '73020000-0000-4000-8000-000000000006',
  'the upgraded Google row remains usable while its Auth session exists'
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
  AND to_regclass('private.admin_ai_browser_credentials') IS NOT NULL,
  'the complete B2 unlock schema is installed beside the preserved Google session'
);

SELECT * FROM finish();
