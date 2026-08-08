BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path = public, extensions;
SELECT no_plan();

-- The native Presenter boundary is additive, content-free, and default OFF.
SELECT has_table(
  'private',
  'presenter_runtime_gate',
  'Presenter runtime gate exists outside the public schema'
);
SELECT has_table(
  'public',
  'presenter_connections',
  'Presenter connection metadata table exists'
);
SELECT has_table(
  'public',
  'presenter_connection_events',
  'Presenter lifecycle audit table exists'
);
SELECT ok(
  (SELECT relrowsecurity
   FROM pg_class
   WHERE oid = 'private.presenter_runtime_gate'::regclass)
  AND (SELECT relrowsecurity
       FROM pg_class
       WHERE oid = 'public.presenter_connections'::regclass)
  AND (SELECT relrowsecurity
       FROM pg_class
       WHERE oid = 'public.presenter_connection_events'::regclass),
  'Presenter runtime and audit metadata have RLS enabled'
);
SELECT ok(
  NOT has_table_privilege('anon', 'public.presenter_connections', 'SELECT')
  AND NOT has_table_privilege(
    'authenticated',
    'public.presenter_connections',
    'SELECT'
  )
  AND NOT has_table_privilege(
    'authenticated',
    'public.presenter_connection_events',
    'SELECT'
  )
  AND NOT has_table_privilege(
    'authenticated',
    'private.presenter_runtime_gate',
    'SELECT'
  ),
  'browser roles cannot read Presenter credentials, bindings, or audit rows'
);
SELECT ok(
  has_table_privilege('service_role', 'public.presenter_connections', 'SELECT')
  AND has_table_privilege(
    'service_role',
    'public.presenter_connections',
    'UPDATE'
  )
  AND has_table_privilege(
    'service_role',
    'public.presenter_connection_events',
    'INSERT'
  )
  AND has_table_privilege(
    'service_role',
    'private.presenter_runtime_gate',
    'UPDATE'
  ),
  'service role has only the server-side metadata privileges it needs'
);
SELECT ok(
  NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name IN (
        'presenter_connections',
        'presenter_connection_events'
      )
      AND column_name IN (
        'ticket',
        'manual_code',
        'capability',
        'local_path',
        'file_name',
        'slide_text',
        'pdf_bytes',
        'pptx_bytes'
      )
  ),
  'Presenter tables store no raw credential, local path, slide text, or file bytes'
);
SELECT is(
  (SELECT enabled::text
   FROM private.presenter_runtime_gate
   WHERE singleton),
  'false',
  'Presenter runtime is disabled by default'
);
SELECT ok(
  NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename IN (
        'presenter_connections',
        'presenter_connection_events'
      )
  ),
  'Presenter metadata adds no Realtime Postgres Changes fan-out'
);
SELECT ok(
  to_regclass(
    'public.presenter_connections_one_unrevoked_per_lecture_idx'
  ) IS NOT NULL
  AND to_regclass(
    'public.presenter_connections_admin_active_idx'
  ) IS NOT NULL
  AND to_regclass(
    'public.presenter_connections_cleanup_idx'
  ) IS NOT NULL
  AND to_regclass(
    'public.presenter_connections_revoked_cleanup_idx'
  ) IS NOT NULL
  AND to_regclass(
    'public.presenter_connections_lecture_idx'
  ) IS NOT NULL
  AND to_regclass(
    'public.presenter_connections_admin_session_idx'
  ) IS NOT NULL
  AND to_regclass(
    'public.presenter_connections_heartbeat_expiry_idx'
  ) IS NOT NULL
  AND to_regclass(
    'public.presenter_connections_owner_status_idx'
  ) IS NOT NULL,
  'foreign-key, one-active, owner-status, heartbeat, and cleanup paths are indexed'
);
SELECT ok(
  NOT (
    SELECT procedure.prosecdef
    FROM pg_proc AS procedure
    WHERE procedure.oid =
      'public.apply_presenter_page_v1(uuid,text,text,bigint,uuid,text,text,integer,integer,integer)'::regprocedure
  )
  AND (
    SELECT procedure.proconfig = ARRAY['search_path=""']::text[]
    FROM pg_proc AS procedure
    WHERE procedure.oid =
      'public.apply_presenter_page_v1(uuid,text,text,bigint,uuid,text,text,integer,integer,integer)'::regprocedure
  ),
  'page apply RPC is SECURITY INVOKER with a fixed empty search_path'
);
SELECT ok(
  has_function_privilege(
    'service_role',
    'public.issue_presenter_connection_v1(uuid,uuid,uuid,text,text,timestamptz)',
    'EXECUTE'
  )
  AND has_function_privilege(
    'service_role',
    'public.apply_presenter_page_v1(uuid,text,text,bigint,uuid,text,text,integer,integer,integer)',
    'EXECUTE'
  )
  AND has_function_privilege(
    'service_role',
    'public.set_presenter_runtime_v1(boolean)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'authenticated',
    'public.issue_presenter_connection_v1(uuid,uuid,uuid,text,text,timestamptz)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'anon',
    'public.apply_presenter_page_v1(uuid,text,text,bigint,uuid,text,text,integer,integer,integer)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'authenticated',
    'public.set_presenter_runtime_v1(boolean)',
    'EXECUTE'
  ),
  'only the Edge service role can operate Presenter connection RPCs'
);
SELECT ok(
  NOT EXISTS (
    SELECT 1
    FROM pg_proc AS procedure
    JOIN pg_namespace AS namespace
      ON namespace.oid = procedure.pronamespace
    WHERE namespace.nspname = 'public'
      AND procedure.proname IN (
        'issue_presenter_connection_v1',
        'inspect_presenter_connection_v1',
        'confirm_presenter_connection_v1',
        'claim_presenter_connection_v1',
        'apply_presenter_page_v1',
        'heartbeat_presenter_connection_v1',
        'get_presenter_connection_status_v1',
        'disconnect_presenter_connection_v1',
        'revoke_presenter_connection_v1',
        'admin_update_pdf_display_with_presenter_fence_v1',
        'set_presenter_runtime_v1',
        'cleanup_presenter_connections_v1'
      )
      AND (
        has_function_privilege('anon', procedure.oid, 'EXECUTE')
        OR has_function_privilege('authenticated', procedure.oid, 'EXECUTE')
        OR NOT has_function_privilege(
          'service_role',
          procedure.oid,
          'EXECUTE'
        )
      )
  ),
  'every Phase 7.29 public RPC is service-role-only'
);

CREATE TEMP TABLE phase729_fixture (
  lecture_id uuid,
  admin_session_id uuid,
  admin_auth_user_id uuid,
  same_user_admin_session_id uuid,
  other_admin_session_id uuid,
  other_admin_auth_user_id uuid,
  expired_connection_id uuid,
  incompatible_connection_id uuid,
  active_connection_id uuid,
  stale_connection_id uuid,
  deck_connection_id uuid,
  binding_connection_id uuid,
  kill_connection_id uuid,
  display_version bigint,
  pdf_version bigint,
  state_version bigint
);
GRANT SELECT, INSERT, UPDATE ON phase729_fixture TO service_role;
INSERT INTO phase729_fixture (
  admin_session_id,
  admin_auth_user_id,
  same_user_admin_session_id,
  other_admin_session_id,
  other_admin_auth_user_id
) VALUES (
  '72900000-0000-4000-8000-000000000001',
  '72900000-0000-4000-8000-000000000101',
  '72900000-0000-4000-8000-000000000003',
  '72900000-0000-4000-8000-000000000002',
  '72900000-0000-4000-8000-000000000102'
);

SET LOCAL ROLE service_role;
UPDATE phase729_fixture
SET lecture_id = public.admin_create_lecture(
  'Phase 7.29 PowerPoint Presenter Bridge',
  repeat('7', 64),
  '729001',
  null,
  null
);
SELECT ok(
  public.admin_set_lecture_status(
    (SELECT lecture_id FROM phase729_fixture),
    'start',
    null
  ),
  'Presenter fixture lecture starts through the canonical lifecycle RPC'
);

INSERT INTO public.admin_sessions (
  id,
  token_hash,
  auth_user_id,
  pin_version_hash,
  issued_at,
  last_seen_at,
  idle_expires_at,
  expires_at
) VALUES
(
  '72900000-0000-4000-8000-000000000001',
  repeat('1', 64),
  '72900000-0000-4000-8000-000000000101',
  repeat('2', 64),
  statement_timestamp() - interval '1 minute',
  statement_timestamp(),
  statement_timestamp() + interval '1 hour',
  statement_timestamp() + interval '2 hours'
),
(
  '72900000-0000-4000-8000-000000000002',
  repeat('3', 64),
  '72900000-0000-4000-8000-000000000102',
  repeat('4', 64),
  statement_timestamp() - interval '1 minute',
  statement_timestamp(),
  statement_timestamp() + interval '1 hour',
  statement_timestamp() + interval '2 hours'
),
(
  '72900000-0000-4000-8000-000000000003',
  repeat('5', 64),
  '72900000-0000-4000-8000-000000000101',
  repeat('6', 64),
  statement_timestamp() - interval '1 minute',
  statement_timestamp(),
  statement_timestamp() + interval '1 hour',
  statement_timestamp() + interval '2 hours'
);

SELECT lives_ok(
  $$
    SELECT public.admin_register_pdf_document(
      (SELECT lecture_id FROM phase729_fixture),
      'phase729-doc',
      repeat('d', 64),
      1,
      'Phase 7.29 material',
      3,
      3000,
      300,
      repeat('d', 64),
      repeat('e', 64),
      true
    )
  $$,
  'Presenter fixture registers content-free PDF metadata'
);
SELECT lives_ok(
  $$
    SELECT * FROM public.admin_update_pdf_display_v3(
      (SELECT lecture_id FROM phase729_fixture),
      'phase729-doc', repeat('d', 64), 1, 3, true, 1, 'normal'
    )
  $$,
  'Presenter fixture selects a registered visible PDF'
);

SELECT throws_ok(
  $$
    SELECT public.issue_presenter_connection_v1(
      (SELECT lecture_id FROM phase729_fixture),
      (SELECT admin_session_id FROM phase729_fixture),
      (SELECT admin_auth_user_id FROM phase729_fixture),
      encode(extensions.digest(convert_to('phase729-off-ticket', 'UTF8'), 'sha256'), 'hex'),
      encode(extensions.digest(convert_to('phase729-off-manual', 'UTF8'), 'sha256'), 'hex'),
      statement_timestamp() + interval '45 seconds'
    )
  $$,
  'P7290',
  null,
  'default-OFF runtime rejects Presenter pairing server-side'
);
SELECT is(
  public.set_presenter_runtime_v1(true) ->> 'enabled',
  'true',
  'service role can explicitly enable the local Presenter runtime gate'
);

-- A ticket is short lived and cannot be revived by a client clock.
UPDATE phase729_fixture
SET expired_connection_id = (
  public.issue_presenter_connection_v1(
    lecture_id,
    admin_session_id,
    admin_auth_user_id,
    encode(extensions.digest(convert_to('phase729-expired-ticket', 'UTF8'), 'sha256'), 'hex'),
    encode(extensions.digest(convert_to('phase729-expired-manual', 'UTF8'), 'sha256'), 'hex'),
    statement_timestamp() + interval '45 seconds'
  ) ->> 'connection_id'
)::uuid;
SELECT ok(
  (SELECT ticket_expires_at <= issued_at + interval '60 seconds'
   FROM public.presenter_connections, phase729_fixture
   WHERE id = expired_connection_id),
  'pairing ticket lifetime is capped at 60 seconds by the database'
);
UPDATE public.presenter_connections AS connection
SET
  issued_at = statement_timestamp() - interval '2 minutes',
  ticket_expires_at = statement_timestamp() - interval '1 minute'
FROM phase729_fixture AS fixture
WHERE connection.id = fixture.expired_connection_id;
SELECT ok(
  public.inspect_presenter_connection_v1(
    (SELECT expired_connection_id FROM phase729_fixture),
    'ticket',
    encode(extensions.digest(convert_to('phase729-expired-ticket', 'UTF8'), 'sha256'), 'hex'),
    repeat('7', 64),
    repeat('8', 64),
    repeat('9', 64),
    3,
    0,
    false
  ) IS NULL,
  'expired ticket cannot inspect or bind a PowerPoint installation'
);

-- Initial scope rejects hidden slides and Custom Shows instead of guessing a
-- PDF mapping from CurrentShowPosition.
UPDATE phase729_fixture
SET incompatible_connection_id = (
  public.issue_presenter_connection_v1(
    lecture_id,
    admin_session_id,
    admin_auth_user_id,
    encode(extensions.digest(convert_to('phase729-bad-ticket', 'UTF8'), 'sha256'), 'hex'),
    encode(extensions.digest(convert_to('phase729-bad-manual', 'UTF8'), 'sha256'), 'hex'),
    statement_timestamp() + interval '45 seconds'
  ) ->> 'connection_id'
)::uuid;
SELECT is(
  public.inspect_presenter_connection_v1(
    (SELECT incompatible_connection_id FROM phase729_fixture),
    'ticket',
    encode(extensions.digest(convert_to('phase729-bad-ticket', 'UTF8'), 'sha256'), 'hex'),
    repeat('7', 64),
    repeat('8', 64),
    repeat('9', 64),
    3,
    1,
    true
  ) ->> 'state',
  'inspected',
  'Bridge inspection records the real deck shape before confirmation'
);
SELECT throws_ok(
  $$
    SELECT public.confirm_presenter_connection_v1(
      (SELECT incompatible_connection_id FROM phase729_fixture),
      (SELECT admin_session_id FROM phase729_fixture),
      (SELECT admin_auth_user_id FROM phase729_fixture)
    )
  $$,
  'P7294',
  null,
  'hidden slides and Custom Shows are rejected at the confirmation gate'
);

-- The valid path binds the ticket, installation, file fingerprint, stable
-- Slide ID order, PDF publication, and one generated capability atomically.
UPDATE phase729_fixture
SET active_connection_id = (
  public.issue_presenter_connection_v1(
    lecture_id,
    admin_session_id,
    admin_auth_user_id,
    encode(extensions.digest(convert_to('phase729-main-ticket', 'UTF8'), 'sha256'), 'hex'),
    encode(extensions.digest(convert_to('phase729-main-manual', 'UTF8'), 'sha256'), 'hex'),
    statement_timestamp() + interval '45 seconds'
  ) ->> 'connection_id'
)::uuid;
SELECT is(
  (SELECT revoke_reason
   FROM public.presenter_connections, phase729_fixture
   WHERE id = incompatible_connection_id),
  'session_replaced',
  'issuing a replacement converges to one unrevoked connection per lecture'
);
SELECT is(
  (SELECT count(*)::integer
   FROM public.presenter_connections, phase729_fixture
   WHERE lecture_session_id = lecture_id
     AND revoked_at IS NULL),
  1,
  'database uniqueness permits only one unrevoked Presenter connection'
);
SELECT ok(
  public.inspect_presenter_connection_v1(
    (SELECT active_connection_id FROM phase729_fixture),
    'ticket',
    repeat('f', 64),
    repeat('7', 64),
    repeat('8', 64),
    repeat('9', 64),
    3,
    0,
    false
  ) IS NULL,
  'an incorrect pairing credential cannot inspect a known connection ID'
);
SELECT is(
  public.inspect_presenter_connection_v1(
    (SELECT active_connection_id FROM phase729_fixture),
    'manual_code',
    encode(extensions.digest(convert_to('phase729-main-manual', 'UTF8'), 'sha256'), 'hex'),
    repeat('7', 64),
    repeat('8', 64),
    repeat('9', 64),
    3,
    0,
    false
  ) ->> 'state',
  'inspected',
  'manual recovery credential can bind the expected installation and deck'
);
SELECT ok(
  public.inspect_presenter_connection_v1(
    (SELECT active_connection_id FROM phase729_fixture),
    'manual_code',
    encode(extensions.digest(convert_to('phase729-main-manual', 'UTF8'), 'sha256'), 'hex'),
    repeat('6', 64),
    repeat('8', 64),
    repeat('9', 64),
    3,
    0,
    false
  ) IS NULL,
  'an inspected connection cannot be rebound to another installation'
);
SELECT ok(
  public.confirm_presenter_connection_v1(
    (SELECT active_connection_id FROM phase729_fixture),
    (SELECT other_admin_session_id FROM phase729_fixture),
    (SELECT other_admin_auth_user_id FROM phase729_fixture)
  ) IS NULL,
  'another valid Admin session cannot confirm an unrelated Presenter binding'
);
SELECT ok(
  public.confirm_presenter_connection_v1(
    (SELECT active_connection_id FROM phase729_fixture),
    (SELECT same_user_admin_session_id FROM phase729_fixture),
    (SELECT admin_auth_user_id FROM phase729_fixture)
  ) IS NULL,
  'a replacement session for the same Admin user cannot confirm the old binding'
);
SELECT is(
  public.confirm_presenter_connection_v1(
    (SELECT active_connection_id FROM phase729_fixture),
    (SELECT admin_session_id FROM phase729_fixture),
    (SELECT admin_auth_user_id FROM phase729_fixture)
  ) ->> 'state',
  'confirmed',
  'owning Admin explicitly confirms the inspected PowerPoint/PDF mapping'
);
SELECT ok(
  public.claim_presenter_connection_v1(
    (SELECT active_connection_id FROM phase729_fixture),
    'ticket',
    encode(extensions.digest(convert_to('phase729-main-ticket', 'UTF8'), 'sha256'), 'hex'),
    repeat('6', 64),
    repeat('a', 64)
  ) IS NULL,
  'a different installation cannot claim the confirmed connection'
);
SELECT is(
  public.claim_presenter_connection_v1(
    (SELECT active_connection_id FROM phase729_fixture),
    'ticket',
    encode(extensions.digest(convert_to('phase729-main-ticket', 'UTF8'), 'sha256'), 'hex'),
    repeat('7', 64),
    repeat('a', 64)
  ) ->> 'state',
  'active',
  'confirmed ticket is consumed into one active capability'
);
SELECT is(
  public.claim_presenter_connection_v1(
    (SELECT active_connection_id FROM phase729_fixture),
    'ticket',
    encode(extensions.digest(convert_to('phase729-main-ticket', 'UTF8'), 'sha256'), 'hex'),
    repeat('7', 64),
    repeat('a', 64)
  ) ->> 'state',
  'active',
  'same-installation claim retry is idempotent'
);
SELECT ok(
  public.claim_presenter_connection_v1(
    (SELECT active_connection_id FROM phase729_fixture),
    'ticket',
    encode(extensions.digest(convert_to('phase729-main-ticket', 'UTF8'), 'sha256'), 'hex'),
    repeat('7', 64),
    repeat('b', 64)
  ) IS NULL,
  'consumed ticket cannot mint a second capability'
);
SELECT is(
  public.get_presenter_connection_status_v1(
    (SELECT lecture_id FROM phase729_fixture),
    (SELECT same_user_admin_session_id FROM phase729_fixture),
    (SELECT admin_auth_user_id FROM phase729_fixture)
  ) -> 'connection' ->> 'connection_id',
  (SELECT active_connection_id::text FROM phase729_fixture),
  'a valid replacement session can recover same-user Presenter status'
);
SELECT is(
  public.get_presenter_connection_status_v1(
    (SELECT lecture_id FROM phase729_fixture),
    (SELECT other_admin_session_id FROM phase729_fixture),
    (SELECT other_admin_auth_user_id FROM phase729_fixture)
  ) ->> 'connection',
  null,
  'another Admin user cannot discover Presenter connection metadata'
);

UPDATE phase729_fixture AS fixture
SET
  display_version = live.display_version,
  pdf_version = live.pdf_version,
  state_version = live.state_version
FROM public.lecture_live_state AS live
WHERE live.lecture_session_id = fixture.lecture_id;
SELECT is(
  public.apply_presenter_page_v1(
    (SELECT active_connection_id FROM phase729_fixture),
    repeat('a', 64),
    repeat('7', 64),
    0,
    '72900000-0000-4000-8000-000000000201',
    repeat('8', 64),
    repeat('9', 64),
    101,
    1,
    1
  ) ->> 'changed',
  'false',
  'stable PowerPoint position equal to the current PDF page is a no-op'
);
SELECT is(
  (SELECT live.display_version
   FROM public.lecture_live_state AS live, phase729_fixture AS fixture
   WHERE live.lecture_session_id = fixture.lecture_id),
  (SELECT display_version FROM phase729_fixture),
  'same-page Presenter apply does not increment display_version'
);
SELECT is(
  (SELECT live.pdf_version
   FROM public.lecture_live_state AS live, phase729_fixture AS fixture
   WHERE live.lecture_session_id = fixture.lecture_id),
  (SELECT pdf_version FROM phase729_fixture),
  'same-page Presenter apply does not increment pdf_version'
);
SELECT is(
  (SELECT live.state_version
   FROM public.lecture_live_state AS live, phase729_fixture AS fixture
   WHERE live.lecture_session_id = fixture.lecture_id),
  (SELECT state_version FROM phase729_fixture),
  'same-page Presenter apply does not increment state_version'
);
SELECT is(
  public.apply_presenter_page_v1(
    (SELECT active_connection_id FROM phase729_fixture),
    repeat('a', 64),
    repeat('7', 64),
    0,
    '72900000-0000-4000-8000-000000000201',
    repeat('8', 64),
    repeat('9', 64),
    101,
    1,
    1
  ) ->> 'idempotent_replay',
  'true',
  'exact event retry is accepted as an idempotent replay'
);
SELECT is(
  public.apply_presenter_page_v1(
    (SELECT active_connection_id FROM phase729_fixture),
    repeat('a', 64),
    repeat('7', 64),
    0,
    '72900000-0000-4000-8000-000000000202',
    repeat('8', 64),
    repeat('9', 64),
    102,
    1,
    1
  ) ->> 'reason',
  'stale_sequence',
  'same or older sequence with different content is rejected'
);
UPDATE public.presenter_connections AS connection
SET last_request_at = statement_timestamp() + interval '1 minute'
FROM phase729_fixture AS fixture
WHERE connection.id = fixture.active_connection_id;
SELECT is(
  public.apply_presenter_page_v1(
    (SELECT active_connection_id FROM phase729_fixture),
    repeat('a', 64),
    repeat('7', 64),
    1,
    '72900000-0000-4000-8000-000000000203',
    repeat('8', 64),
    repeat('9', 64),
    202,
    2,
    2
  ) ->> 'reason',
  'rate_limited',
  'server-side 200ms coalescing rejects an excessive page update'
);
UPDATE public.presenter_connections AS connection
SET last_request_at = statement_timestamp() - interval '1 second'
FROM phase729_fixture AS fixture
WHERE connection.id = fixture.active_connection_id;
SELECT is(
  public.apply_presenter_page_v1(
    (SELECT active_connection_id FROM phase729_fixture),
    repeat('a', 64),
    repeat('7', 64),
    1,
    '72900000-0000-4000-8000-000000000203',
    repeat('8', 64),
    repeat('9', 64),
    202,
    2,
    2
  ) ->> 'accepted',
  'true',
  'latest stable absolute slide position commits after coalescing'
);
SELECT is(
  (SELECT current_pdf_page
   FROM public.lecture_live_state, phase729_fixture
   WHERE lecture_session_id = lecture_id),
  2,
  'committed Presenter position updates the canonical PDF page'
);
SELECT throws_ok(
  $$
    SELECT *
    FROM public.admin_update_pdf_display_with_presenter_fence_v1(
      (SELECT lecture_id FROM phase729_fixture),
      'phase729-doc', repeat('d', 64), 1, 3, true, 3, 'normal'
    )
  $$,
  'P7291',
  null,
  'manual PDF controls cannot race an active Presenter connection'
);
SELECT ok(
  public.revoke_presenter_connection_v1(
    (SELECT active_connection_id FROM phase729_fixture),
    (SELECT other_admin_session_id FROM phase729_fixture),
    (SELECT other_admin_auth_user_id FROM phase729_fixture),
    'manual_handover'
  ) IS NULL,
  'another Admin cannot revoke an unrelated Presenter connection'
);
SELECT is(
  public.revoke_presenter_connection_v1(
    (SELECT active_connection_id FROM phase729_fixture),
    (SELECT same_user_admin_session_id FROM phase729_fixture),
    (SELECT admin_auth_user_id FROM phase729_fixture),
    'manual_handover'
  ) ->> 'revoke_reason',
  'manual_handover',
  'a valid replacement session can stop the same Admin user connection'
);
SELECT is(
  public.revoke_presenter_connection_v1(
    (SELECT active_connection_id FROM phase729_fixture),
    (SELECT admin_session_id FROM phase729_fixture),
    (SELECT admin_auth_user_id FROM phase729_fixture),
    'manual_handover'
  ) ->> 'revoke_reason',
  'manual_handover',
  'original owning session observes the same idempotent stop result'
);
SELECT lives_ok(
  $$
    SELECT *
    FROM public.admin_update_pdf_display_with_presenter_fence_v1(
      (SELECT lecture_id FROM phase729_fixture),
      'phase729-doc', repeat('d', 64), 1, 3, true, 3, 'normal'
    )
  $$,
  'manual PDF controls recover immediately after Presenter handover'
);

-- A disappeared Bridge receives a short server-time lease. It cannot hold
-- manual PDF control until lecture hard stop, and the boundary is retry-safe.
UPDATE phase729_fixture
SET stale_connection_id = (
  public.issue_presenter_connection_v1(
    lecture_id,
    admin_session_id,
    admin_auth_user_id,
    encode(extensions.digest(convert_to('phase729-stale-ticket', 'UTF8'), 'sha256'), 'hex'),
    encode(extensions.digest(convert_to('phase729-stale-manual', 'UTF8'), 'sha256'), 'hex'),
    statement_timestamp() + interval '45 seconds'
  ) ->> 'connection_id'
)::uuid;
SELECT lives_ok(
  $$
    SELECT public.inspect_presenter_connection_v1(
      (SELECT stale_connection_id FROM phase729_fixture),
      'ticket',
      encode(extensions.digest(convert_to('phase729-stale-ticket', 'UTF8'), 'sha256'), 'hex'),
      repeat('7', 64), repeat('8', 64), repeat('9', 64), 3, 0, false
    );
    SELECT public.confirm_presenter_connection_v1(
      (SELECT stale_connection_id FROM phase729_fixture),
      (SELECT admin_session_id FROM phase729_fixture),
      (SELECT admin_auth_user_id FROM phase729_fixture)
    );
    SELECT public.claim_presenter_connection_v1(
      (SELECT stale_connection_id FROM phase729_fixture),
      'ticket',
      encode(extensions.digest(convert_to('phase729-stale-ticket', 'UTF8'), 'sha256'), 'hex'),
      repeat('7', 64), repeat('1', 64)
    )
  $$,
  'stale-heartbeat fixture reaches active state'
);
UPDATE public.presenter_connections AS connection
SET last_seen_at = statement_timestamp() - interval '44 seconds'
FROM phase729_fixture AS fixture
WHERE connection.id = fixture.stale_connection_id;
SELECT throws_ok(
  $$
    SELECT *
    FROM public.admin_update_pdf_display_with_presenter_fence_v1(
      (SELECT lecture_id FROM phase729_fixture),
      'phase729-doc', repeat('d', 64), 1, 3, true, 2, 'normal'
    )
  $$,
  'P7291',
  null,
  'a heartbeat newer than the 45-second server lease keeps Presenter active'
);
UPDATE public.presenter_connections AS connection
SET last_seen_at = statement_timestamp() - interval '45 seconds'
FROM phase729_fixture AS fixture
WHERE connection.id = fixture.stale_connection_id;
SELECT lives_ok(
  $$
    SELECT *
    FROM public.admin_update_pdf_display_with_presenter_fence_v1(
      (SELECT lecture_id FROM phase729_fixture),
      'phase729-doc', repeat('d', 64), 1, 3, true, 2, 'normal'
    )
  $$,
  'the 45-second server-time boundary releases manual PDF control'
);
SELECT is(
  (SELECT revoke_reason
   FROM public.presenter_connections, phase729_fixture
   WHERE id = stale_connection_id),
  'disconnected',
  'stale Bridge recovery records a disconnected terminal reason'
);
SELECT lives_ok(
  $$
    SELECT *
    FROM public.admin_update_pdf_display_with_presenter_fence_v1(
      (SELECT lecture_id FROM phase729_fixture),
      'phase729-doc', repeat('d', 64), 1, 3, true, 2, 'normal'
    )
  $$,
  'stale Bridge handover is idempotent on retry'
);

-- A changed file/order fingerprint stops synchronization instead of silently
-- applying a stale PPTX-to-PDF mapping.
UPDATE phase729_fixture
SET deck_connection_id = (
  public.issue_presenter_connection_v1(
    lecture_id,
    admin_session_id,
    admin_auth_user_id,
    encode(extensions.digest(convert_to('phase729-deck-ticket', 'UTF8'), 'sha256'), 'hex'),
    encode(extensions.digest(convert_to('phase729-deck-manual', 'UTF8'), 'sha256'), 'hex'),
    statement_timestamp() + interval '45 seconds'
  ) ->> 'connection_id'
)::uuid;
SELECT lives_ok(
  $$
    SELECT public.inspect_presenter_connection_v1(
      (SELECT deck_connection_id FROM phase729_fixture),
      'ticket',
      encode(extensions.digest(convert_to('phase729-deck-ticket', 'UTF8'), 'sha256'), 'hex'),
      repeat('7', 64), repeat('8', 64), repeat('9', 64), 3, 0, false
    );
    SELECT public.confirm_presenter_connection_v1(
      (SELECT deck_connection_id FROM phase729_fixture),
      (SELECT admin_session_id FROM phase729_fixture),
      (SELECT admin_auth_user_id FROM phase729_fixture)
    );
    SELECT public.claim_presenter_connection_v1(
      (SELECT deck_connection_id FROM phase729_fixture),
      'ticket',
      encode(extensions.digest(convert_to('phase729-deck-ticket', 'UTF8'), 'sha256'), 'hex'),
      repeat('7', 64), repeat('b', 64)
    )
  $$,
  'replacement connection reaches active state with the confirmed deck'
);
SELECT is(
  public.apply_presenter_page_v1(
    (SELECT deck_connection_id FROM phase729_fixture),
    repeat('b', 64),
    repeat('7', 64),
    0,
    '72900000-0000-4000-8000-000000000204',
    repeat('f', 64),
    repeat('9', 64),
    303,
    3,
    3
  ) ->> 'reason',
  'deck_changed',
  'file fingerprint drift revokes synchronization before a page write'
);
SELECT is(
  (SELECT revoke_reason
   FROM public.presenter_connections, phase729_fixture
   WHERE id = deck_connection_id),
  'deck_changed',
  'deck drift records an auditable terminal reason'
);

-- PDF publication binding changes also stop the native connector.
UPDATE phase729_fixture
SET binding_connection_id = (
  public.issue_presenter_connection_v1(
    lecture_id,
    admin_session_id,
    admin_auth_user_id,
    encode(extensions.digest(convert_to('phase729-binding-ticket', 'UTF8'), 'sha256'), 'hex'),
    encode(extensions.digest(convert_to('phase729-binding-manual', 'UTF8'), 'sha256'), 'hex'),
    statement_timestamp() + interval '45 seconds'
  ) ->> 'connection_id'
)::uuid;
SELECT lives_ok(
  $$
    SELECT public.inspect_presenter_connection_v1(
      (SELECT binding_connection_id FROM phase729_fixture),
      'ticket',
      encode(extensions.digest(convert_to('phase729-binding-ticket', 'UTF8'), 'sha256'), 'hex'),
      repeat('7', 64), repeat('8', 64), repeat('9', 64), 3, 0, false
    );
    SELECT public.confirm_presenter_connection_v1(
      (SELECT binding_connection_id FROM phase729_fixture),
      (SELECT admin_session_id FROM phase729_fixture),
      (SELECT admin_auth_user_id FROM phase729_fixture)
    );
    SELECT public.claim_presenter_connection_v1(
      (SELECT binding_connection_id FROM phase729_fixture),
      'ticket',
      encode(extensions.digest(convert_to('phase729-binding-ticket', 'UTF8'), 'sha256'), 'hex'),
      repeat('7', 64), repeat('c', 64)
    )
  $$,
  'PDF-binding fixture reaches active state'
);
UPDATE public.lecture_live_state AS live
SET pdf_visible = false
FROM phase729_fixture AS fixture
WHERE live.lecture_session_id = fixture.lecture_id;
SELECT is(
  (SELECT revoke_reason
   FROM public.presenter_connections, phase729_fixture
   WHERE id = binding_connection_id),
  'document_changed',
  'PDF publication visibility change immediately revokes Presenter control'
);
UPDATE public.lecture_live_state AS live
SET pdf_visible = true
FROM phase729_fixture AS fixture
WHERE live.lecture_session_id = fixture.lecture_id;

-- The DB kill switch is authoritative and idempotent even if the Bridge keeps
-- retrying with a cached capability.
UPDATE phase729_fixture
SET kill_connection_id = (
  public.issue_presenter_connection_v1(
    lecture_id,
    admin_session_id,
    admin_auth_user_id,
    encode(extensions.digest(convert_to('phase729-kill-ticket', 'UTF8'), 'sha256'), 'hex'),
    encode(extensions.digest(convert_to('phase729-kill-manual', 'UTF8'), 'sha256'), 'hex'),
    statement_timestamp() + interval '45 seconds'
  ) ->> 'connection_id'
)::uuid;
SELECT lives_ok(
  $$
    SELECT public.inspect_presenter_connection_v1(
      (SELECT kill_connection_id FROM phase729_fixture),
      'ticket',
      encode(extensions.digest(convert_to('phase729-kill-ticket', 'UTF8'), 'sha256'), 'hex'),
      repeat('7', 64), repeat('8', 64), repeat('9', 64), 3, 0, false
    );
    SELECT public.confirm_presenter_connection_v1(
      (SELECT kill_connection_id FROM phase729_fixture),
      (SELECT admin_session_id FROM phase729_fixture),
      (SELECT admin_auth_user_id FROM phase729_fixture)
    );
    SELECT public.claim_presenter_connection_v1(
      (SELECT kill_connection_id FROM phase729_fixture),
      'ticket',
      encode(extensions.digest(convert_to('phase729-kill-ticket', 'UTF8'), 'sha256'), 'hex'),
      repeat('7', 64), repeat('e', 64)
    )
  $$,
  'kill-switch fixture reaches active state'
);
SELECT is(
  (public.set_presenter_runtime_v1(false) ->> 'revoked_count')::integer,
  1,
  'runtime kill switch drains the one active Presenter connection'
);
SELECT is(
  (SELECT revoke_reason
   FROM public.presenter_connections, phase729_fixture
   WHERE id = kill_connection_id),
  'feature_disabled',
  'runtime drain records the feature-disabled terminal reason'
);
SELECT is(
  (public.set_presenter_runtime_v1(false) ->> 'revoked_count')::integer,
  0,
  'runtime kill-switch retry is idempotent'
);
SELECT is(
  public.apply_presenter_page_v1(
    (SELECT kill_connection_id FROM phase729_fixture),
    repeat('e', 64),
    repeat('7', 64),
    0,
    '72900000-0000-4000-8000-000000000205',
    repeat('8', 64),
    repeat('9', 64),
    101,
    1,
    1
  ) ->> 'reason',
  'feature_disabled',
  'cached Bridge capability cannot write while the DB gate is disabled'
);
SELECT is(
  public.get_presenter_connection_status_v1(
    (SELECT lecture_id FROM phase729_fixture),
    (SELECT admin_session_id FROM phase729_fixture),
    (SELECT admin_auth_user_id FROM phase729_fixture)
  ) ->> 'runtime_enabled',
  'false',
  'Admin status reports the authoritative disabled runtime state'
);

-- Cleanup first revokes an abandoned ticket using server time, then retains it
-- for the normal 30-day audit window before bounded physical deletion.
INSERT INTO public.presenter_connections (
  lecture_session_id,
  admin_session_id,
  admin_auth_user_id,
  ticket_jti_hash,
  manual_code_hmac,
  ticket_expires_at,
  pdf_document_id,
  pdf_document_version,
  pdf_manifest_version,
  pdf_page_count,
  issued_at,
  hard_stop_at,
  updated_at
)
SELECT
  fixture.lecture_id,
  fixture.admin_session_id,
  fixture.admin_auth_user_id,
  encode(extensions.digest(convert_to('phase729-abandoned-ticket', 'UTF8'), 'sha256'), 'hex'),
  encode(extensions.digest(convert_to('phase729-abandoned-manual', 'UTF8'), 'sha256'), 'hex'),
  statement_timestamp() - interval '1 minute',
  'phase729-doc',
  repeat('d', 64),
  1,
  3,
  statement_timestamp() - interval '2 minutes',
  lecture.hard_stop_at,
  statement_timestamp() - interval '2 minutes'
FROM phase729_fixture AS fixture
JOIN public.lecture_sessions AS lecture ON lecture.id = fixture.lecture_id;
SELECT is(
  public.cleanup_presenter_connections_v1(500),
  0,
  'cleanup revokes but does not immediately delete an expired pairing'
);
SELECT is(
  (SELECT revoke_reason
   FROM public.presenter_connections
   WHERE ticket_jti_hash = encode(
     extensions.digest(convert_to('phase729-abandoned-ticket', 'UTF8'), 'sha256'),
     'hex'
   )),
  'expired',
  'abandoned pairing converges to an auditable expired state'
);

-- Retention cleanup is bounded, cascades low-frequency events, and converges.
UPDATE public.presenter_connections
SET revoked_at = statement_timestamp() - interval '31 days'
WHERE revoked_at IS NOT NULL;
SELECT is(
  public.cleanup_presenter_connections_v1(1),
  1,
  'cleanup removes at most the requested bounded batch'
);
SELECT ok(
  public.cleanup_presenter_connections_v1(500) > 0,
  'a subsequent cleanup invocation converges remaining expired metadata'
);
SELECT is(
  public.cleanup_presenter_connections_v1(500),
  0,
  'cleanup is idempotent after convergence'
);
SELECT is(
  (SELECT count(*)::integer
   FROM public.presenter_connection_events AS event
   LEFT JOIN public.presenter_connections AS connection
     ON connection.id = event.connection_id
   WHERE connection.id IS NULL),
  0,
  'cleanup cascade leaves no orphan Presenter lifecycle events'
);

RESET ROLE;
SELECT * FROM finish();
ROLLBACK;
