BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path = public, extensions;
SELECT no_plan();

SELECT has_table(
  'public',
  'lecture_pdf_publications',
  'browser PDF publication control table exists'
);
SELECT has_table(
  'public',
  'lecture_pdf_publication_events',
  'browser PDF publication audit table exists'
);
SELECT has_column(
  'public',
  'lecture_pdf_documents',
  'browser_publication_id',
  'Phase 3 PDF metadata has optional browser-publication provenance'
);
SELECT has_column(
  'public',
  'lecture_pdf_publications',
  'cleanup_worker_generation',
  'terminal cleanup persists its pre-terminal Worker generation'
);
SELECT has_column(
  'public',
  'lecture_pdf_publications',
  'cleanup_exhausted_at',
  'bounded cleanup retries expose a manual-review marker'
);
SELECT ok(
  NOT (
    SELECT attribute.attnotnull
    FROM pg_attribute AS attribute
    WHERE attribute.attrelid = 'public.lecture_pdf_documents'::regclass
      AND attribute.attname = 'browser_publication_id'
  ),
  'Local Publisher rows remain compatible with NULL provenance'
);
SELECT ok(
  (SELECT relrowsecurity
   FROM pg_class
   WHERE oid = 'public.lecture_pdf_publications'::regclass)
  AND
  (SELECT relrowsecurity
   FROM pg_class
   WHERE oid = 'public.lecture_pdf_publication_events'::regclass),
  'publication state and audit tables have RLS enabled'
);
SELECT ok(
  NOT has_table_privilege(
    'anon', 'public.lecture_pdf_publications', 'SELECT'
  )
  AND NOT has_table_privilege(
    'authenticated', 'public.lecture_pdf_publications', 'SELECT'
  )
  AND NOT has_table_privilege(
    'anon', 'public.lecture_pdf_publication_events', 'SELECT'
  )
  AND NOT has_table_privilege(
    'authenticated', 'public.lecture_pdf_publication_events', 'SELECT'
  ),
  'browser roles cannot inspect publication tickets or audit state'
);
SELECT ok(
  has_table_privilege(
    'service_role', 'public.lecture_pdf_publications', 'SELECT,INSERT,UPDATE'
  )
  AND has_table_privilege(
    'service_role', 'public.lecture_pdf_publication_events', 'SELECT,INSERT'
  )
  AND NOT has_table_privilege(
    'service_role', 'public.lecture_pdf_publication_events', 'UPDATE'
  ),
  'service role receives only the table privileges needed by the saga'
);
SELECT ok(
  NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename IN (
        'lecture_pdf_publications',
        'lecture_pdf_publication_events'
      )
  ),
  'publication control state adds no Supabase Realtime fanout'
);
SELECT ok(
  to_regclass(
    'public.lecture_pdf_publications_one_inflight_per_lecture_idx'
  ) IS NOT NULL
  AND to_regclass(
    'public.lecture_pdf_publications_requested_admin_session_idx'
  ) IS NOT NULL
  AND to_regclass(
    'public.lecture_pdf_publications_ticket_admin_session_idx'
  ) IS NOT NULL
  AND to_regclass(
    'public.lecture_pdf_publications_operation_expiry_idx'
  ) IS NOT NULL
  AND to_regclass(
    'public.lecture_pdf_publications_cleanup_due_idx'
  ) IS NOT NULL
  AND to_regclass(
    'public.lecture_pdf_publications_cleanup_retryable_due_idx'
  ) IS NOT NULL,
  'in-flight exclusion and bounded expiry scans are indexed'
);
SELECT ok(
  to_regprocedure(
    'public.admin_register_pdf_document(uuid,text,text,bigint,text,integer,bigint,integer,text,text,boolean)'
  ) IS NOT NULL
  AND to_regprocedure(
    'public.admin_update_pdf_display_v3(uuid,text,text,bigint,integer,boolean,integer,text)'
  ) IS NOT NULL,
  'Phase 3 Local Publisher RPCs remain available unchanged'
);

WITH expected_rpc(signature) AS (
  VALUES
    ('public.admin_create_pdf_publication_v1(uuid,text,text,bigint,integer,integer,text,text,boolean,text,uuid,text,text,uuid,uuid)'),
    ('public.admin_reissue_pdf_publication_ticket_v1(uuid,text,text,uuid,uuid)'),
    ('public.admin_get_pdf_publication_v1(uuid,uuid,uuid)'),
    ('public.admin_find_inflight_pdf_publication_v1(uuid,uuid,uuid)'),
    ('public.worker_claim_pdf_publication_nonce_v1(uuid,integer,text,text,text,text,text,bigint,text,uuid,uuid)'),
    ('public.worker_record_pdf_publication_uploaded_v1(uuid,uuid,bigint,text,boolean,text,text,text)'),
    ('public.admin_prepare_pdf_publication_commit_v1(uuid,uuid,uuid,uuid)'),
    ('public.admin_complete_pdf_publication_commit_v1(uuid,uuid,bigint,bigint,text,uuid,uuid)'),
    ('public.admin_prepare_pdf_publication_activation_v1(uuid,uuid,uuid,uuid)'),
    ('public.admin_complete_pdf_publication_activation_v1(uuid,uuid,bigint,bigint,text,uuid,uuid)'),
    ('public.admin_abort_pdf_publication_v1(uuid,text,uuid,uuid)'),
    ('public.claim_due_pdf_publication_cleanup_v1(integer,text)'),
    ('public.complete_pdf_publication_cleanup_v1(uuid,uuid,boolean,text,text)')
)
SELECT ok(
  bool_and(to_regprocedure(signature) IS NOT NULL),
  'all Phase 7.26 service RPC signatures exist'
)
FROM expected_rpc;

WITH expected_rpc(signature) AS (
  VALUES
    ('public.admin_create_pdf_publication_v1(uuid,text,text,bigint,integer,integer,text,text,boolean,text,uuid,text,text,uuid,uuid)'),
    ('public.admin_reissue_pdf_publication_ticket_v1(uuid,text,text,uuid,uuid)'),
    ('public.admin_get_pdf_publication_v1(uuid,uuid,uuid)'),
    ('public.admin_find_inflight_pdf_publication_v1(uuid,uuid,uuid)'),
    ('public.worker_claim_pdf_publication_nonce_v1(uuid,integer,text,text,text,text,text,bigint,text,uuid,uuid)'),
    ('public.worker_record_pdf_publication_uploaded_v1(uuid,uuid,bigint,text,boolean,text,text,text)'),
    ('public.admin_prepare_pdf_publication_commit_v1(uuid,uuid,uuid,uuid)'),
    ('public.admin_complete_pdf_publication_commit_v1(uuid,uuid,bigint,bigint,text,uuid,uuid)'),
    ('public.admin_prepare_pdf_publication_activation_v1(uuid,uuid,uuid,uuid)'),
    ('public.admin_complete_pdf_publication_activation_v1(uuid,uuid,bigint,bigint,text,uuid,uuid)'),
    ('public.admin_abort_pdf_publication_v1(uuid,text,uuid,uuid)'),
    ('public.claim_due_pdf_publication_cleanup_v1(integer,text)'),
    ('public.complete_pdf_publication_cleanup_v1(uuid,uuid,boolean,text,text)')
)
SELECT ok(
  bool_and(
    NOT has_function_privilege('anon', signature, 'EXECUTE')
    AND NOT has_function_privilege('authenticated', signature, 'EXECUTE')
    AND has_function_privilege('service_role', signature, 'EXECUTE')
  ),
  'Phase 7.26 RPCs are service-role only'
)
FROM expected_rpc;

WITH expected_rpc(signature) AS (
  VALUES
    ('public.admin_create_pdf_publication_v1(uuid,text,text,bigint,integer,integer,text,text,boolean,text,uuid,text,text,uuid,uuid)'),
    ('public.admin_reissue_pdf_publication_ticket_v1(uuid,text,text,uuid,uuid)'),
    ('public.admin_get_pdf_publication_v1(uuid,uuid,uuid)'),
    ('public.admin_find_inflight_pdf_publication_v1(uuid,uuid,uuid)'),
    ('public.worker_claim_pdf_publication_nonce_v1(uuid,integer,text,text,text,text,text,bigint,text,uuid,uuid)'),
    ('public.worker_record_pdf_publication_uploaded_v1(uuid,uuid,bigint,text,boolean,text,text,text)'),
    ('public.admin_prepare_pdf_publication_commit_v1(uuid,uuid,uuid,uuid)'),
    ('public.admin_complete_pdf_publication_commit_v1(uuid,uuid,bigint,bigint,text,uuid,uuid)'),
    ('public.admin_prepare_pdf_publication_activation_v1(uuid,uuid,uuid,uuid)'),
    ('public.admin_complete_pdf_publication_activation_v1(uuid,uuid,bigint,bigint,text,uuid,uuid)'),
    ('public.admin_abort_pdf_publication_v1(uuid,text,uuid,uuid)'),
    ('public.claim_due_pdf_publication_cleanup_v1(integer,text)'),
    ('public.complete_pdf_publication_cleanup_v1(uuid,uuid,boolean,text,text)')
)
SELECT ok(
  bool_and(
    NOT procedure.prosecdef
    AND procedure.proconfig = ARRAY['search_path=""']::text[]
  ),
  'all public Phase 7.26 RPCs are SECURITY INVOKER with empty search_path'
)
FROM expected_rpc
JOIN pg_proc AS procedure
  ON procedure.oid = to_regprocedure(expected_rpc.signature);

CREATE TEMP TABLE phase726_fixture (
  lecture_id uuid,
  publication_id uuid,
  lecture_public_id text,
  object_key text,
  claim_state_version bigint,
  deadline_lecture_id uuid,
  deadline_publication_id uuid,
  deadline_lecture_public_id text,
  cleanup_claim_id uuid,
  expired_lecture_id uuid,
  expired_publication_id uuid,
  expired_lecture_public_id text,
  expired_cleanup_claim_id uuid,
  crash_lecture_id uuid,
  crash_publication_id uuid,
  crash_lecture_public_id text,
  crash_object_key text,
  crash_worker_generation integer,
  crash_cleanup_claim_id uuid,
  poison_lecture_id uuid,
  poison_publication_id uuid,
  healthy_lecture_id uuid,
  healthy_publication_id uuid,
  healthy_cleanup_claim_id uuid,
  result jsonb
);
GRANT SELECT, INSERT, UPDATE ON phase726_fixture
  TO service_role, authenticated;
INSERT INTO phase726_fixture DEFAULT VALUES;

SET LOCAL ROLE service_role;

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
    '72600000-0000-4000-8000-000000000001',
    repeat('1', 64),
    '72600000-0000-4000-8000-000000000101',
    repeat('2', 64),
    statement_timestamp() - interval '1 minute',
    statement_timestamp() - interval '30 seconds',
    statement_timestamp() + interval '1 hour',
    statement_timestamp() + interval '4 hours'
  ),
  (
    '72600000-0000-4000-8000-000000000002',
    repeat('3', 64),
    '72600000-0000-4000-8000-000000000102',
    repeat('4', 64),
    statement_timestamp() - interval '1 minute',
    statement_timestamp() - interval '30 seconds',
    statement_timestamp() + interval '1 hour',
    statement_timestamp() + interval '4 hours'
  );

UPDATE phase726_fixture
SET lecture_id = public.admin_create_lecture(
  'Phase 7.26 browser PDF publication',
  repeat('5', 64),
  '726001',
  null,
  null
);
SELECT ok(
  public.admin_set_lecture_status(
    (SELECT lecture_id FROM phase726_fixture),
    'start',
    null
  ),
  'browser publication fixture lecture starts'
);

UPDATE phase726_fixture
SET result = public.admin_create_pdf_publication_v1(
  lecture_id,
  'doc-main',
  repeat('a', 64),
  3000,
  3,
  300,
  repeat('b', 64),
  'Main material',
  true,
  'https://compass.example',
  '72600000-0000-4000-8000-000000000201',
  repeat('c', 64),
  repeat('d', 64),
  '72600000-0000-4000-8000-000000000001',
  '72600000-0000-4000-8000-000000000101'
);
UPDATE phase726_fixture
SET
  publication_id = (result ->> 'publication_id')::uuid,
  lecture_public_id = result ->> 'lecture_public_id',
  object_key = result ->> 'object_key';
SELECT is(
  (SELECT result ->> 'state' FROM phase726_fixture),
  'pending',
  'initiation creates only a pending publication'
);
SELECT is(
  (SELECT publication.cleanup_worker_generation
   FROM public.lecture_pdf_publications AS publication,
     phase726_fixture AS fixture
   WHERE publication.id = fixture.publication_id),
  null::integer,
  'nonterminal publication carries no cleanup generation binding'
);
SELECT is(
  (SELECT count(*)::integer
   FROM public.lecture_pdf_documents AS document, phase726_fixture AS fixture
   WHERE document.lecture_session_id = fixture.lecture_id),
  0,
  'pending publication is absent from student PDF metadata'
);

UPDATE phase726_fixture
SET result = public.admin_create_pdf_publication_v1(
  lecture_id,
  'doc-main',
  repeat('a', 64),
  3000,
  3,
  300,
  repeat('b', 64),
  'Main material',
  true,
  'https://compass.example',
  '72600000-0000-4000-8000-000000000201',
  repeat('e', 64),
  repeat('f', 64),
  '72600000-0000-4000-8000-000000000001',
  '72600000-0000-4000-8000-000000000101'
);
SELECT is(
  (SELECT result ->> 'publication_id' FROM phase726_fixture),
  (SELECT publication_id::text FROM phase726_fixture),
  'same client request id resumes the same publication'
);
SELECT is(
  (SELECT result ->> 'ticket_generation' FROM phase726_fixture),
  '2',
  'idempotent initiation rotates the unused ticket generation'
);
SELECT is(
  (SELECT count(*)::integer
   FROM public.lecture_pdf_publications AS publication,
     phase726_fixture AS fixture
   WHERE publication.lecture_session_id = fixture.lecture_id),
  1,
  'idempotent initiation does not duplicate publication state'
);
UPDATE phase726_fixture
SET result = public.admin_reissue_pdf_publication_ticket_v1(
  publication_id,
  repeat('6', 64),
  repeat('7', 64),
  '72600000-0000-4000-8000-000000000001',
  '72600000-0000-4000-8000-000000000101'
);
SELECT is(
  (SELECT result ->> 'ticket_generation' FROM phase726_fixture),
  '3',
  'explicit resume rotates an unused ticket without a second publication'
);
SELECT is(
  (
    SELECT public.admin_find_inflight_pdf_publication_v1(
      lecture_id,
      '72600000-0000-4000-8000-000000000001',
      '72600000-0000-4000-8000-000000000101'
    ) ->> 'publication_id'
    FROM phase726_fixture
  ),
  (SELECT publication_id::text FROM phase726_fixture),
  'the owning tracked Admin can rediscover an in-flight publication'
);
SELECT is(
  (
    SELECT public.admin_find_inflight_pdf_publication_v1(
      lecture_id,
      '72600000-0000-4000-8000-000000000001',
      '72600000-0000-4000-8000-000000000101'
    ) ->> 'client_request_id'
    FROM phase726_fixture
  ),
  '72600000-0000-4000-8000-000000000201',
  'discovery returns the original non-secret idempotency key'
);
SELECT is(
  (
    SELECT public.admin_find_inflight_pdf_publication_v1(
      lecture_id,
      '72600000-0000-4000-8000-000000000002',
      '72600000-0000-4000-8000-000000000102'
    )
    FROM phase726_fixture
  ),
  null::jsonb,
  'another tracked Admin actor cannot discover an in-flight publication'
);
SELECT throws_ok(
  $$
    SELECT public.admin_create_pdf_publication_v1(
      lecture_id,
      'doc-main',
      repeat('a', 64),
      3000,
      3,
      300,
      repeat('b', 64),
      'Changed title',
      true,
      'https://compass.example',
      '72600000-0000-4000-8000-000000000201',
      repeat('8', 64),
      repeat('9', 64),
      '72600000-0000-4000-8000-000000000001',
      '72600000-0000-4000-8000-000000000101'
    )
    FROM phase726_fixture
  $$,
  '23514',
  null,
  'idempotency key cannot be reused with changed immutable metadata'
);
SELECT throws_ok(
  $$
    SELECT public.admin_get_pdf_publication_v1(
      publication_id,
      '72600000-0000-4000-8000-000000000002',
      '72600000-0000-4000-8000-000000000102'
    )
    FROM phase726_fixture
  $$,
  '42501',
  null,
  'another tracked Admin actor cannot inspect the publication'
);
SELECT throws_ok(
  $$
    SELECT public.admin_abort_pdf_publication_v1(
      publication_id,
      'cross_actor_attempt',
      '72600000-0000-4000-8000-000000000002',
      '72600000-0000-4000-8000-000000000102'
    )
    FROM phase726_fixture
  $$,
  '42501',
  null,
  'another tracked Admin actor cannot abort the publication'
);

SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $$SELECT * FROM public.lecture_pdf_publications$$,
  '42501',
  null,
  'browser role cannot bypass the Edge control plane with a table read'
);
SELECT throws_ok(
  $$
    SELECT public.admin_get_pdf_publication_v1(
      publication_id,
      '72600000-0000-4000-8000-000000000001',
      '72600000-0000-4000-8000-000000000101'
    )
    FROM phase726_fixture
  $$,
  '42501',
  null,
  'browser role cannot call a service-only publication RPC'
);

SET LOCAL ROLE service_role;
SELECT throws_ok(
  $$
    SELECT public.worker_claim_pdf_publication_nonce_v1(
      publication_id,
      3,
      repeat('6', 64),
      repeat('7', 64),
      lecture_public_id,
      null,
      repeat('a', 64),
      3000,
      'https://compass.example',
      '72600000-0000-4000-8000-000000000001',
      '72600000-0000-4000-8000-000000000301'
    )
    FROM phase726_fixture
  $$,
  '22023',
  null,
  'NULL binding cannot bypass the upload-ticket validator'
);
SELECT throws_ok(
  $$
    SELECT public.worker_claim_pdf_publication_nonce_v1(
      publication_id,
      3,
      repeat('6', 64),
      repeat('7', 64),
      lecture_public_id,
      'doc-main',
      repeat('a', 64),
      3000,
      'https://other.example',
      '72600000-0000-4000-8000-000000000001',
      '72600000-0000-4000-8000-000000000301'
    )
    FROM phase726_fixture
  $$,
  '42501',
  null,
  'Origin mismatch rejects the upload ticket before nonce use'
);

UPDATE phase726_fixture
SET result = public.worker_claim_pdf_publication_nonce_v1(
  publication_id,
  3,
  repeat('6', 64),
  repeat('7', 64),
  lecture_public_id,
  'doc-main',
  repeat('a', 64),
  3000,
  'https://compass.example',
  '72600000-0000-4000-8000-000000000001',
  '72600000-0000-4000-8000-000000000301'
);
UPDATE phase726_fixture
SET
  object_key = result ->> 'object_key',
  claim_state_version = (result ->> 'state_version')::bigint;
SELECT ok(
  (SELECT nonce_used_at IS NOT NULL
   FROM public.lecture_pdf_publications AS publication,
     phase726_fixture AS fixture
   WHERE publication.id = fixture.publication_id),
  'first Worker claim atomically consumes the DB nonce'
);
SELECT is(
  (
    public.worker_claim_pdf_publication_nonce_v1(
      (SELECT publication_id FROM phase726_fixture),
      3,
      repeat('6', 64),
      repeat('7', 64),
      (SELECT lecture_public_id FROM phase726_fixture),
      'doc-main',
      repeat('a', 64),
      3000,
      'https://compass.example',
      '72600000-0000-4000-8000-000000000001',
      '72600000-0000-4000-8000-000000000301'
    ) ->> 'state_version'
  )::bigint,
  (SELECT claim_state_version FROM phase726_fixture),
  'same Worker attempt is an idempotent nonce-claim retry'
);
SELECT is(
  (SELECT count(*)::integer
   FROM public.lecture_pdf_publication_events AS event,
     phase726_fixture AS fixture
   WHERE event.publication_id = fixture.publication_id
     AND event.event_type = 'nonce_claimed'),
  1,
  'idempotent Worker retry writes no duplicate nonce event'
);
SELECT throws_ok(
  $$
    SELECT public.worker_claim_pdf_publication_nonce_v1(
      publication_id,
      3,
      repeat('6', 64),
      repeat('7', 64),
      lecture_public_id,
      'doc-main',
      repeat('a', 64),
      3000,
      'https://compass.example',
      '72600000-0000-4000-8000-000000000001',
      '72600000-0000-4000-8000-000000000302'
    )
    FROM phase726_fixture
  $$,
  '42501',
  null,
  'a consumed nonce cannot be replayed by a different Worker attempt'
);
UPDATE public.lecture_pdf_publications AS publication
SET
  nonce_used_at = statement_timestamp() - interval '6 minutes',
  upload_lease_expires_at = statement_timestamp() - interval '1 minute'
FROM phase726_fixture AS fixture
WHERE publication.id = fixture.publication_id;
UPDATE phase726_fixture
SET result = public.admin_reissue_pdf_publication_ticket_v1(
  publication_id,
  repeat('e', 64),
  repeat('f', 64),
  '72600000-0000-4000-8000-000000000001',
  '72600000-0000-4000-8000-000000000101'
);
SELECT is(
  (SELECT result ->> 'ticket_generation' FROM phase726_fixture),
  '4',
  'expired upload lease can rotate to a fresh ticket generation'
);
SELECT ok(
  (SELECT
     result ->> 'nonce_used_at' IS NULL
     AND result ->> 'worker_attempt_id' IS NULL
     AND result ->> 'upload_lease_expires_at' IS NULL
   FROM phase726_fixture),
  'ticket resume clears only the expired nonce-attempt lease'
);
UPDATE phase726_fixture
SET result = public.worker_claim_pdf_publication_nonce_v1(
  publication_id,
  4,
  repeat('e', 64),
  repeat('f', 64),
  lecture_public_id,
  'doc-main',
  repeat('a', 64),
  3000,
  'https://compass.example',
  '72600000-0000-4000-8000-000000000001',
  '72600000-0000-4000-8000-000000000303'
);
SELECT ok(
  (SELECT
     (result ->> 'upload_lease_expires_at')::timestamptz
       > (result ->> 'server_time')::timestamptz
     AND (result ->> 'upload_lease_expires_at')::timestamptz
       <= (result ->> 'server_time')::timestamptz + interval '5 minutes'
   FROM phase726_fixture),
  'resumed Worker claim receives a bounded five-minute upload lease'
);
SELECT is(
  (SELECT count(*)::integer
   FROM public.lecture_pdf_publication_events AS event,
     phase726_fixture AS fixture
   WHERE event.publication_id = fixture.publication_id
     AND event.event_type = 'nonce_claimed'),
  2,
  'lease-expiry resume records exactly one new nonce claim'
);
SELECT throws_ok(
  $$
    SELECT public.worker_record_pdf_publication_uploaded_v1(
      publication_id,
      '72600000-0000-4000-8000-000000000303',
      3001,
      repeat('a', 64),
      true,
      object_key,
      'r2-version-1',
      'etag-upload-1'
    )
    FROM phase726_fixture
  $$,
  '42501',
  null,
  'actual byte count must exactly match the ticket binding'
);
SELECT throws_ok(
  $$
    SELECT public.worker_record_pdf_publication_uploaded_v1(
      publication_id,
      '72600000-0000-4000-8000-000000000303',
      3000,
      repeat('a', 64),
      false,
      object_key,
      'r2-version-1',
      'etag-upload-1'
    )
    FROM phase726_fixture
  $$,
  '22023',
  null,
  'Worker receipt without verified PDF magic is rejected'
);
SELECT throws_ok(
  $$
    SELECT public.worker_record_pdf_publication_uploaded_v1(
      publication_id,
      '72600000-0000-4000-8000-000000000303',
      3000,
      repeat('a', 64),
      true,
      object_key || '.changed',
      'r2-version-1',
      'etag-upload-1'
    )
    FROM phase726_fixture
  $$,
  '42501',
  null,
  'Worker receipt must match the deterministic immutable object key'
);

UPDATE phase726_fixture
SET result = public.worker_record_pdf_publication_uploaded_v1(
  publication_id,
  '72600000-0000-4000-8000-000000000303',
  3000,
  repeat('a', 64),
  true,
  object_key,
  'r2-version-1',
  'etag-upload-1'
);
SELECT is(
  (SELECT result ->> 'state' FROM phase726_fixture),
  'uploaded',
  'verified receipt advances pending to uploaded'
);
SELECT is(
  public.worker_record_pdf_publication_uploaded_v1(
    (SELECT publication_id FROM phase726_fixture),
    '72600000-0000-4000-8000-000000000303',
    3000,
    repeat('a', 64),
    true,
    (SELECT object_key FROM phase726_fixture),
    'r2-version-1',
    'etag-upload-1'
  ) ->> 'state',
  'uploaded',
  'identical upload receipt is idempotent'
);
SELECT is(
  (SELECT count(*)::integer
   FROM public.lecture_pdf_publication_events AS event,
     phase726_fixture AS fixture
   WHERE event.publication_id = fixture.publication_id
     AND event.event_type = 'uploaded'),
  1,
  'idempotent upload receipt writes one uploaded event'
);
SELECT throws_ok(
  $$
    SELECT public.worker_record_pdf_publication_uploaded_v1(
      publication_id,
      '72600000-0000-4000-8000-000000000303',
      3000,
      repeat('a', 64),
      true,
      object_key,
      'r2-version-1',
      'changed-etag'
    )
    FROM phase726_fixture
  $$,
  '23514',
  null,
  'an immutable upload receipt cannot change on retry'
);

UPDATE phase726_fixture
SET result = public.admin_prepare_pdf_publication_commit_v1(
  publication_id,
  '72600000-0000-4000-8000-000000000401',
  '72600000-0000-4000-8000-000000000001',
  '72600000-0000-4000-8000-000000000101'
);
SELECT is(
  (SELECT result ->> 'commit_operation_id' FROM phase726_fixture),
  '72600000-0000-4000-8000-000000000401',
  'commit preparation exposes the resumable operation id'
);
SELECT ok(
  (SELECT (result ->> 'commit_lease_expires_at')::timestamptz
      > (result ->> 'server_time')::timestamptz
   FROM phase726_fixture),
  'commit preparation exposes a future server-side lease'
);
SELECT is(
  public.admin_complete_pdf_publication_commit_v1(
    (SELECT publication_id FROM phase726_fixture),
    '72600000-0000-4000-8000-000000000401',
    10,
    1,
    'manifest-hidden-etag-10',
    '72600000-0000-4000-8000-000000000001',
    '72600000-0000-4000-8000-000000000101'
  ) ->> 'state',
  'committed',
  'hidden Worker manifest receipt advances uploaded to committed'
);
SELECT is(
  (SELECT count(*)::integer
   FROM public.lecture_pdf_documents AS document, phase726_fixture AS fixture
   WHERE document.lecture_session_id = fixture.lecture_id),
  0,
  'committed-but-not-active object remains absent from student metadata'
);
SELECT is(
  (SELECT live.pdf_document_id
   FROM public.lecture_live_state AS live, phase726_fixture AS fixture
   WHERE live.lecture_session_id = fixture.lecture_id),
  null::text,
  'committed-but-not-active object does not change live state'
);
SELECT is(
  (SELECT lecture.pdf_access_version
   FROM public.lecture_sessions AS lecture, phase726_fixture AS fixture
   WHERE lecture.id = fixture.lecture_id),
  1::bigint,
  'hidden commit does not advance the student access-version fence'
);
SELECT is(
  public.admin_complete_pdf_publication_commit_v1(
    (SELECT publication_id FROM phase726_fixture),
    '72600000-0000-4000-8000-000000000401',
    10,
    1,
    'manifest-hidden-etag-10',
    '72600000-0000-4000-8000-000000000001',
    '72600000-0000-4000-8000-000000000101'
  ) ->> 'state',
  'committed',
  'identical hidden-manifest receipt is idempotent'
);
SELECT throws_ok(
  $$
    SELECT public.admin_complete_pdf_publication_commit_v1(
      publication_id,
      '72600000-0000-4000-8000-000000000401',
      10,
      1,
      'changed-hidden-etag',
      '72600000-0000-4000-8000-000000000001',
      '72600000-0000-4000-8000-000000000101'
    )
    FROM phase726_fixture
  $$,
  '23514',
  null,
  'hidden-manifest receipt cannot change on retry'
);

UPDATE phase726_fixture
SET result = public.admin_prepare_pdf_publication_activation_v1(
  publication_id,
  '72600000-0000-4000-8000-000000000501',
  '72600000-0000-4000-8000-000000000001',
  '72600000-0000-4000-8000-000000000101'
);
SELECT is(
  (SELECT result ->> 'activation_operation_id' FROM phase726_fixture),
  '72600000-0000-4000-8000-000000000501',
  'activation preparation exposes the resumable operation id'
);
SELECT is(
  (SELECT result ->> 'activation_target_access_version'
   FROM phase726_fixture),
  '2',
  'activation reserves the next access version without publishing it'
);
SELECT is(
  (SELECT lecture.pdf_access_version
   FROM public.lecture_sessions AS lecture, phase726_fixture AS fixture
   WHERE lecture.id = fixture.lecture_id),
  1::bigint,
  'future manifest fence remains unpublished during activation lease'
);
SELECT throws_ok(
  $$
    SELECT public.admin_complete_pdf_publication_activation_v1(
      publication_id,
      '72600000-0000-4000-8000-000000000501',
      11,
      3,
      'manifest-active-etag-11',
      '72600000-0000-4000-8000-000000000001',
      '72600000-0000-4000-8000-000000000101'
    )
    FROM phase726_fixture
  $$,
  '42501',
  null,
  'activation cannot skip the future access-version fence'
);

UPDATE phase726_fixture
SET result = public.admin_complete_pdf_publication_activation_v1(
  publication_id,
  '72600000-0000-4000-8000-000000000501',
  11,
  2,
  'manifest-active-etag-11',
  '72600000-0000-4000-8000-000000000001',
  '72600000-0000-4000-8000-000000000101'
);
SELECT is(
  (SELECT result ->> 'state' FROM phase726_fixture),
  'active',
  'activation completes the pending-uploaded-committed-active path'
);
SELECT is(
  (SELECT lecture.pdf_access_version
   FROM public.lecture_sessions AS lecture, phase726_fixture AS fixture
   WHERE lecture.id = fixture.lecture_id),
  2::bigint,
  'DB access-version fence advances atomically with active state'
);
SELECT ok(
  (SELECT
     document.visible
     AND document.browser_publication_id = fixture.publication_id
     AND document.manifest_version = 11
   FROM public.lecture_pdf_documents AS document,
     phase726_fixture AS fixture
   WHERE document.lecture_session_id = fixture.lecture_id
     AND document.document_id = 'doc-main'
     AND document.document_version = repeat('a', 64)),
  'active publication registers visible metadata with provenance'
);
SELECT ok(
  (SELECT
     live.pdf_visible
     AND live.pdf_document_id = 'doc-main'
     AND live.pdf_document_version = repeat('a', 64)
     AND live.pdf_manifest_version = 11
     AND live.current_pdf_page = 1
   FROM public.lecture_live_state AS live, phase726_fixture AS fixture
   WHERE live.lecture_session_id = fixture.lecture_id),
  'active publication and live-state pointer converge in one transaction'
);
SELECT is(
  public.admin_complete_pdf_publication_activation_v1(
    (SELECT publication_id FROM phase726_fixture),
    '72600000-0000-4000-8000-000000000501',
    11,
    2,
    'manifest-active-etag-11',
    '72600000-0000-4000-8000-000000000001',
    '72600000-0000-4000-8000-000000000101'
  ) ->> 'state',
  'active',
  'identical activation receipt is idempotent'
);
SELECT throws_ok(
  $$
    SELECT public.admin_abort_pdf_publication_v1(
      publication_id,
      'late_abort',
      '72600000-0000-4000-8000-000000000001',
      '72600000-0000-4000-8000-000000000101'
    )
    FROM phase726_fixture
  $$,
  '55000',
  null,
  'active immutable publication cannot be converted back to aborted'
);

UPDATE phase726_fixture
SET deadline_lecture_id = public.admin_create_lecture(
  'Phase 7.26 deadline guard',
  repeat('6', 64),
  '726002',
  null,
  null
);
SELECT ok(
  public.admin_set_lecture_status(
    (SELECT deadline_lecture_id FROM phase726_fixture),
    'start',
    null
  ),
  'deadline-guard fixture starts'
);
UPDATE phase726_fixture
SET result = public.admin_create_pdf_publication_v1(
  deadline_lecture_id,
  'doc-deadline',
  repeat('1', 64),
  2000,
  2,
  200,
  repeat('2', 64),
  'Deadline material',
  true,
  'https://compass.example',
  '72600000-0000-4000-8000-000000000202',
  repeat('3', 64),
  repeat('4', 64),
  '72600000-0000-4000-8000-000000000001',
  '72600000-0000-4000-8000-000000000101'
);
UPDATE phase726_fixture
SET
  deadline_publication_id = (result ->> 'publication_id')::uuid,
  deadline_lecture_public_id = result ->> 'lecture_public_id';

RESET ROLE;
UPDATE public.lecture_sessions AS lecture
SET hard_stop_at = lecture.started_at
FROM phase726_fixture AS fixture
WHERE lecture.id = fixture.deadline_lecture_id;
SET LOCAL ROLE service_role;
SELECT throws_ok(
  $$
    SELECT public.worker_claim_pdf_publication_nonce_v1(
      deadline_publication_id,
      1,
      repeat('3', 64),
      repeat('4', 64),
      deadline_lecture_public_id,
      'doc-deadline',
      repeat('1', 64),
      2000,
      'https://compass.example',
      '72600000-0000-4000-8000-000000000001',
      '72600000-0000-4000-8000-000000000302'
    )
    FROM phase726_fixture
  $$,
  'P0001',
  null,
  'server hard-stop time rejects a nonce claim despite client clock'
);

RESET ROLE;
SELECT is(
  (SELECT count(*)::integer
   FROM private.close_expired_lectures(10) AS closed,
     phase726_fixture AS fixture
   WHERE closed.lecture_session_id = fixture.deadline_lecture_id
     AND closed.changed),
  1,
  'background reconciliation closes the deadline fixture without a browser'
);
SELECT is(
  (SELECT publication.state
   FROM public.lecture_pdf_publications AS publication,
     phase726_fixture AS fixture
   WHERE publication.id = fixture.deadline_publication_id),
  'aborted',
  'lecture-close trigger aborts the in-flight publication'
);
SELECT is(
  (SELECT count(*)::integer
   FROM public.lecture_pdf_documents AS document, phase726_fixture AS fixture
   WHERE document.lecture_session_id = fixture.deadline_lecture_id),
  0,
  'aborted uncommitted publication remains unavailable to students'
);

SET LOCAL ROLE service_role;
UPDATE phase726_fixture AS fixture
SET
  result = claimed.payload,
  cleanup_claim_id = (claimed.payload ->> 'cleanup_claim_id')::uuid
FROM (
  SELECT payload
  FROM public.claim_due_pdf_publication_cleanup_v1(
    10,
    'phase726-cleanup'
  ) AS cleanup(payload)
) AS claimed
WHERE (claimed.payload ->> 'publication_id')::uuid
  = fixture.deadline_publication_id;
SELECT ok(
  (SELECT cleanup_claim_id IS NOT NULL FROM phase726_fixture),
  'cleanup worker atomically claims the aborted object'
);
SELECT is(
  (SELECT result ->> 'cleanup_binding_version' FROM phase726_fixture),
  '1',
  'cleanup claim declares the strict Worker binding contract version'
);
SELECT is(
  (SELECT result ->> 'cleanup_worker_generation' FROM phase726_fixture),
  '1',
  'lecture close exposes the generation captured before ticket rotation'
);
SELECT is(
  (SELECT publication.cleanup_worker_generation
   FROM public.lecture_pdf_publications AS publication,
     phase726_fixture AS fixture
   WHERE publication.id = fixture.deadline_publication_id),
  1,
  'lecture-close trigger persists the pre-terminal Worker generation'
);
SELECT is(
  public.complete_pdf_publication_cleanup_v1(
    (SELECT deadline_publication_id FROM phase726_fixture),
    (SELECT cleanup_claim_id FROM phase726_fixture),
    false,
    'r2_transient',
    'phase726-cleanup'
  ) ->> 'state',
  'aborted',
  'failed cleanup preserves terminal state for retry'
);
SELECT ok(
  (SELECT publication.cleanup_claim_id IS NULL
   FROM public.lecture_pdf_publications AS publication,
     phase726_fixture AS fixture
   WHERE publication.id = fixture.deadline_publication_id),
  'failed cleanup releases its lease instead of stranding the object'
);
UPDATE public.lecture_pdf_publications AS publication
SET cleanup_after = statement_timestamp() - interval '1 second'
FROM phase726_fixture AS fixture
WHERE publication.id = fixture.deadline_publication_id;
UPDATE phase726_fixture AS fixture
SET
  result = claimed.payload,
  cleanup_claim_id = (claimed.payload ->> 'cleanup_claim_id')::uuid
FROM (
  SELECT payload
  FROM public.claim_due_pdf_publication_cleanup_v1(
    10,
    'phase726-cleanup'
  ) AS cleanup(payload)
) AS claimed
WHERE (claimed.payload ->> 'publication_id')::uuid
  = fixture.deadline_publication_id;
SELECT ok(
  public.complete_pdf_publication_cleanup_v1(
    (SELECT deadline_publication_id FROM phase726_fixture),
    (SELECT cleanup_claim_id FROM phase726_fixture),
    true,
    null,
    'phase726-cleanup'
  ) ->> 'cleanup_completed_at' IS NOT NULL,
  'retry can complete cleanup after a transient failure'
);
SELECT ok(
  public.complete_pdf_publication_cleanup_v1(
    (SELECT deadline_publication_id FROM phase726_fixture),
    (SELECT cleanup_claim_id FROM phase726_fixture),
    true,
    null,
    'phase726-cleanup'
  ) ->> 'cleanup_completed_at' IS NOT NULL,
  'identical cleanup completion retry is idempotent'
);
SELECT throws_ok(
  $$SELECT * FROM public.claim_due_pdf_publication_cleanup_v1(NULL, 'worker')$$,
  '22023',
  null,
  'NULL cleanup limit cannot become an unbounded scan'
);

UPDATE phase726_fixture
SET expired_lecture_id = public.admin_create_lecture(
  'Phase 7.26 operation expiry',
  repeat('7', 64),
  '726003',
  null,
  null
);
UPDATE phase726_fixture
SET result = public.admin_create_pdf_publication_v1(
  expired_lecture_id,
  'doc-expired',
  repeat('8', 64),
  1000,
  1,
  100,
  repeat('9', 64),
  'Expired material',
  false,
  'https://compass.example',
  '72600000-0000-4000-8000-000000000203',
  repeat('0', 64),
  repeat('a', 64),
  '72600000-0000-4000-8000-000000000001',
  '72600000-0000-4000-8000-000000000101'
);
UPDATE phase726_fixture
SET
  expired_publication_id = (result ->> 'publication_id')::uuid,
  expired_lecture_public_id = result ->> 'lecture_public_id';
UPDATE public.lecture_pdf_publications AS publication
SET
  created_at = statement_timestamp() - interval '3 hours',
  ticket_expires_at = statement_timestamp() - interval '1 hour',
  operation_expires_at = statement_timestamp() + interval '1 hour'
FROM phase726_fixture AS fixture
WHERE publication.id = fixture.expired_publication_id;
SELECT throws_ok(
  $$
    SELECT public.worker_claim_pdf_publication_nonce_v1(
      expired_publication_id,
      1,
      repeat('0', 64),
      repeat('a', 64),
      expired_lecture_public_id,
      'doc-expired',
      repeat('8', 64),
      1000,
      'https://compass.example',
      '72600000-0000-4000-8000-000000000001',
      '72600000-0000-4000-8000-000000000303'
    )
    FROM phase726_fixture
  $$,
  '42501',
  null,
  'DB server time rejects an expired upload ticket'
);
SELECT is(
  (SELECT count(*)::integer
   FROM public.claim_due_pdf_publication_cleanup_v1(
     10,
     'phase726-expiry'
   ) AS cleanup(payload)
   WHERE (payload ->> 'publication_id')::uuid =
     (SELECT expired_publication_id FROM phase726_fixture)),
  0,
  'operation is not archived or cleaned before its server deadline'
);
UPDATE public.lecture_pdf_publications AS publication
SET
  created_at = statement_timestamp() - interval '4 hours',
  ticket_expires_at = statement_timestamp() - interval '3 hours',
  operation_expires_at = statement_timestamp() - interval '2 hours'
FROM phase726_fixture AS fixture
WHERE publication.id = fixture.expired_publication_id;
UPDATE phase726_fixture AS fixture
SET
  result = claimed.payload,
  expired_cleanup_claim_id =
    (claimed.payload ->> 'cleanup_claim_id')::uuid
FROM (
  SELECT payload
  FROM public.claim_due_pdf_publication_cleanup_v1(
    10,
    'phase726-expiry'
  ) AS cleanup(payload)
) AS claimed
WHERE (claimed.payload ->> 'publication_id')::uuid
  = fixture.expired_publication_id;
SELECT is(
  (SELECT result ->> 'state' FROM phase726_fixture),
  'expired',
  'operation deadline atomically advances pending to expired'
);
SELECT ok(
  (SELECT expired_cleanup_claim_id IS NOT NULL FROM phase726_fixture),
  'expired operation is immediately claimable for object cleanup'
);
SELECT is(
  (SELECT result ->> 'cleanup_worker_generation' FROM phase726_fixture),
  '1',
  'operation expiry captures the generation before its terminal fence'
);
SELECT ok(
  public.complete_pdf_publication_cleanup_v1(
    (SELECT expired_publication_id FROM phase726_fixture),
    (SELECT expired_cleanup_claim_id FROM phase726_fixture),
    true,
    null,
    'phase726-expiry'
  ) ->> 'cleanup_completed_at' IS NOT NULL,
  'expired cleanup completes without deleting audit state'
);

UPDATE phase726_fixture
SET poison_lecture_id = public.admin_create_lecture(
  'Phase 7.26 exhausted cleanup poison row',
  repeat('a', 64),
  '726005',
  null,
  null
),
healthy_lecture_id = public.admin_create_lecture(
  'Phase 7.26 healthy cleanup row',
  repeat('b', 64),
  '726006',
  null,
  null
);
SELECT ok(
  public.admin_set_lecture_status(
    (SELECT poison_lecture_id FROM phase726_fixture),
    'start',
    null
  )
  AND public.admin_set_lecture_status(
    (SELECT healthy_lecture_id FROM phase726_fixture),
    'start',
    null
  ),
  'cleanup starvation fixtures start'
);
UPDATE phase726_fixture
SET result = public.admin_create_pdf_publication_v1(
  poison_lecture_id,
  'doc-poison',
  repeat('c', 64),
  1000,
  1,
  100,
  repeat('d', 64),
  'Poison cleanup material',
  false,
  'https://compass.example',
  '72600000-0000-4000-8000-000000000205',
  repeat(md5('phase726-poison-nonce'), 2),
  repeat(md5('phase726-poison-ticket'), 2),
  '72600000-0000-4000-8000-000000000001',
  '72600000-0000-4000-8000-000000000101'
);
UPDATE phase726_fixture
SET poison_publication_id = (result ->> 'publication_id')::uuid;
UPDATE phase726_fixture
SET result = public.admin_create_pdf_publication_v1(
  healthy_lecture_id,
  'doc-healthy',
  repeat('e', 64),
  1000,
  1,
  100,
  repeat('f', 64),
  'Healthy cleanup material',
  false,
  'https://compass.example',
  '72600000-0000-4000-8000-000000000206',
  repeat(md5('phase726-healthy-nonce'), 2),
  repeat(md5('phase726-healthy-ticket'), 2),
  '72600000-0000-4000-8000-000000000001',
  '72600000-0000-4000-8000-000000000101'
);
UPDATE phase726_fixture
SET healthy_publication_id = (result ->> 'publication_id')::uuid;
UPDATE public.lecture_pdf_publications AS publication
SET
  state = 'aborted',
  ticket_generation = publication.ticket_generation + 1,
  aborted_at = statement_timestamp(),
  cleanup_after = statement_timestamp() - interval '2 hours',
  cleanup_attempt_count = 1000,
  last_error_code = 'cleanup_attempts_exhausted'
FROM phase726_fixture AS fixture
WHERE publication.id = fixture.poison_publication_id;
UPDATE public.lecture_pdf_publications AS publication
SET
  state = 'aborted',
  ticket_generation = publication.ticket_generation + 1,
  aborted_at = statement_timestamp(),
  cleanup_after = statement_timestamp() - interval '1 hour',
  last_error_code = 'cleanup_fixture'
FROM phase726_fixture AS fixture
WHERE publication.id = fixture.healthy_publication_id;
UPDATE phase726_fixture AS fixture
SET
  result = claimed.payload,
  healthy_cleanup_claim_id =
    (claimed.payload ->> 'cleanup_claim_id')::uuid
FROM (
  SELECT payload
  FROM public.claim_due_pdf_publication_cleanup_v1(
    1,
    'phase726-starvation'
  ) AS cleanup(payload)
) AS claimed
WHERE (claimed.payload ->> 'publication_id')::uuid
  = fixture.healthy_publication_id;
SELECT ok(
  (SELECT
     healthy_cleanup_claim_id IS NOT NULL
     AND result ->> 'cleanup_attempt_count' = '1'
   FROM phase726_fixture),
  'an exhausted earliest row does not starve a healthy due cleanup'
);
SELECT ok(
  (SELECT
     publication.cleanup_exhausted_at IS NOT NULL
     AND publication.cleanup_attempt_count = 1000
     AND publication.cleanup_claim_id IS NULL
   FROM public.lecture_pdf_publications AS publication,
     phase726_fixture AS fixture
   WHERE publication.id = fixture.poison_publication_id),
  'the exhausted row saturates with a durable manual-review marker'
);
SELECT ok(
  public.complete_pdf_publication_cleanup_v1(
    (SELECT healthy_publication_id FROM phase726_fixture),
    (SELECT healthy_cleanup_claim_id FROM phase726_fixture),
    true,
    null,
    'phase726-starvation'
  ) ->> 'cleanup_completed_at' IS NOT NULL,
  'healthy cleanup can complete after skipping the poison row'
);

UPDATE phase726_fixture
SET crash_lecture_id = public.admin_create_lecture(
  'Phase 7.26 activation crash cleanup binding',
  repeat('0', 64),
  '726004',
  null,
  null
);
SELECT ok(
  public.admin_set_lecture_status(
    (SELECT crash_lecture_id FROM phase726_fixture),
    'start',
    null
  ),
  'activation-crash cleanup fixture starts'
);
UPDATE phase726_fixture
SET result = public.admin_create_pdf_publication_v1(
  crash_lecture_id,
  'doc-crash',
  repeat('9', 64),
  4096,
  4,
  400,
  repeat('8', 64),
  'Crash recovery material',
  true,
  'https://compass.example',
  '72600000-0000-4000-8000-000000000204',
  repeat(md5('phase726-crash-nonce'), 2),
  repeat(md5('phase726-crash-ticket'), 2),
  '72600000-0000-4000-8000-000000000001',
  '72600000-0000-4000-8000-000000000101'
);
UPDATE phase726_fixture
SET
  crash_publication_id = (result ->> 'publication_id')::uuid,
  crash_lecture_public_id = result ->> 'lecture_public_id',
  crash_object_key = result ->> 'object_key',
  crash_worker_generation = (result ->> 'ticket_generation')::integer;
UPDATE phase726_fixture
SET result = public.worker_claim_pdf_publication_nonce_v1(
  crash_publication_id,
  crash_worker_generation,
  repeat(md5('phase726-crash-nonce'), 2),
  repeat(md5('phase726-crash-ticket'), 2),
  crash_lecture_public_id,
  'doc-crash',
  repeat('9', 64),
  4096,
  'https://compass.example',
  '72600000-0000-4000-8000-000000000001',
  '72600000-0000-4000-8000-000000000304'
);
UPDATE phase726_fixture
SET result = public.worker_record_pdf_publication_uploaded_v1(
  crash_publication_id,
  '72600000-0000-4000-8000-000000000304',
  4096,
  repeat('9', 64),
  true,
  crash_object_key,
  'r2-version-crash',
  'etag-upload-crash'
);
UPDATE phase726_fixture
SET result = public.admin_prepare_pdf_publication_commit_v1(
  crash_publication_id,
  '72600000-0000-4000-8000-000000000404',
  '72600000-0000-4000-8000-000000000001',
  '72600000-0000-4000-8000-000000000101'
);
UPDATE phase726_fixture
SET result = public.admin_complete_pdf_publication_commit_v1(
  crash_publication_id,
  '72600000-0000-4000-8000-000000000404',
  20,
  1,
  'manifest-hidden-etag-crash',
  '72600000-0000-4000-8000-000000000001',
  '72600000-0000-4000-8000-000000000101'
);
UPDATE phase726_fixture
SET result = public.admin_prepare_pdf_publication_activation_v1(
  crash_publication_id,
  '72600000-0000-4000-8000-000000000504',
  '72600000-0000-4000-8000-000000000001',
  '72600000-0000-4000-8000-000000000101'
);
SELECT ok(
  public.admin_set_lecture_status(
    (SELECT crash_lecture_id FROM phase726_fixture),
    'close',
    null
  ),
  'lecture close wins the DB fence before external activation rollback'
);
SELECT ok(
  (SELECT
     publication.state = 'aborted'
     AND publication.cleanup_worker_generation = fixture.crash_worker_generation
     AND publication.ticket_generation = fixture.crash_worker_generation + 1
     AND publication.committed_manifest_access_version = 1
     AND publication.activation_target_access_version = 2
     AND publication.activation_operation_id =
       '72600000-0000-4000-8000-000000000504'::uuid
   FROM public.lecture_pdf_publications AS publication,
     phase726_fixture AS fixture
   WHERE publication.id = fixture.crash_publication_id),
  'terminal intent preserves the exact activation and pre-rotation generation binding'
);
UPDATE phase726_fixture AS fixture
SET
  result = claimed.payload,
  crash_cleanup_claim_id = (claimed.payload ->> 'cleanup_claim_id')::uuid
FROM (
  SELECT payload
  FROM public.claim_due_pdf_publication_cleanup_v1(
    10,
    'phase726-activation-crash'
  ) AS cleanup(payload)
) AS claimed
WHERE (claimed.payload ->> 'publication_id')::uuid
  = fixture.crash_publication_id;
SELECT ok(
  (SELECT
     result ->> 'cleanup_binding_version' = '1'
     AND (result ->> 'cleanup_worker_generation')::integer
       = crash_worker_generation
     AND result ->> 'committed_manifest_access_version' = '1'
     AND result ->> 'activation_target_access_version' = '2'
     AND result ->> 'pdf_access_version' = '1'
     AND result ->> 'activation_operation_id'
       = '72600000-0000-4000-8000-000000000504'
   FROM phase726_fixture),
  'cleanup claim exports the complete strict rollback binding without advancing DB access'
);

UPDATE public.lecture_pdf_publications AS publication
SET
  state = 'retired',
  retired_at = statement_timestamp(),
  cleanup_after = statement_timestamp() + interval '7 days'
FROM phase726_fixture AS fixture
WHERE publication.id = fixture.publication_id;
SELECT is(
  (SELECT publication.cleanup_worker_generation
   FROM public.lecture_pdf_publications AS publication,
     phase726_fixture AS fixture
   WHERE publication.id = fixture.publication_id),
  (SELECT publication.ticket_generation
   FROM public.lecture_pdf_publications AS publication,
     phase726_fixture AS fixture
   WHERE publication.id = fixture.publication_id),
  'retirement captures the active Worker generation without rotating it'
);
SELECT ok(
  EXISTS (
    SELECT 1
    FROM public.lecture_pdf_publication_events AS event,
      phase726_fixture AS fixture
    WHERE event.publication_id = fixture.publication_id
      AND event.event_type = 'active'
      AND event.actor_type = 'admin'
  )
  AND EXISTS (
    SELECT 1
    FROM public.lecture_pdf_publication_events AS event,
      phase726_fixture AS fixture
    WHERE event.publication_id = fixture.deadline_publication_id
      AND event.event_type = 'aborted'
      AND event.actor_type = 'system'
  )
  AND EXISTS (
    SELECT 1
    FROM public.lecture_pdf_publication_events AS event,
      phase726_fixture AS fixture
    WHERE event.publication_id = fixture.expired_publication_id
      AND event.event_type = 'expired'
      AND event.actor_type = 'system'
  ),
  'active, lecture-close, and expiry outcomes retain actor-aware audit events'
);
SELECT throws_ok(
  $$
    UPDATE public.lecture_pdf_publication_events
    SET details = '{}'::jsonb
  $$,
  '42501',
  null,
  'service role cannot rewrite append-only audit events'
);

RESET ROLE;
SELECT * FROM finish();
ROLLBACK;
