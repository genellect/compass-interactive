BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path = public, extensions;
SELECT no_plan();

SELECT has_column(
  'public',
  'presenter_connections',
  'proof_key_id',
  'Presenter connections bind a proof-key fingerprint'
);
SELECT has_column(
  'public',
  'presenter_connections',
  'proof_public_key_spki',
  'Presenter connections retain only public proof-key material'
);
SELECT has_table(
  'private',
  'presenter_request_receipts',
  'Private exact-retry receipts exist'
);
SELECT has_table(
  'private',
  'presenter_machine_rate_limits',
  'Private machine rate buckets exist'
);
SELECT has_table(
  'private',
  'presenter_cleanup_health',
  'Presenter cleanup has a content-free health marker'
);

SELECT ok(
  (SELECT relrowsecurity
   FROM pg_class
   WHERE oid = 'private.presenter_request_receipts'::regclass)
  AND (SELECT relrowsecurity
       FROM pg_class
       WHERE oid = 'private.presenter_machine_rate_limits'::regclass)
  AND (SELECT relrowsecurity
       FROM pg_class
       WHERE oid = 'private.presenter_cleanup_health'::regclass),
  'Presenter proof, rate and maintenance metadata have RLS enabled'
);
SELECT ok(
  NOT has_table_privilege(
    'anon',
    'private.presenter_request_receipts',
    'SELECT'
  )
  AND NOT has_table_privilege(
    'authenticated',
    'private.presenter_request_receipts',
    'SELECT'
  )
  AND NOT has_table_privilege(
    'authenticated',
    'private.presenter_machine_rate_limits',
    'UPDATE'
  )
  AND has_table_privilege(
    'service_role',
    'private.presenter_request_receipts',
    'INSERT'
  )
  AND has_table_privilege(
    'service_role',
    'private.presenter_request_receipts',
    'UPDATE'
  )
  AND has_table_privilege(
    'service_role',
    'private.presenter_machine_rate_limits',
    'UPDATE'
  ),
  'proof receipts and rate buckets remain service-only'
);

SELECT ok(
  to_regclass('public.presenter_connections_proof_key_idx') IS NOT NULL
  AND to_regclass('private.presenter_request_receipts_connection_idx')
    IS NOT NULL
  AND to_regclass('private.presenter_request_receipts_cleanup_idx')
    IS NOT NULL
  AND to_regclass('private.presenter_machine_rate_limits_cleanup_idx')
    IS NOT NULL,
  'proof binding, receipt and cleanup paths are indexed'
);

SELECT is(
  (
    SELECT count(*)::integer
    FROM pg_proc AS procedure
    JOIN pg_namespace AS namespace
      ON namespace.oid = procedure.pronamespace
    WHERE namespace.nspname = 'public'
      AND procedure.proname IN (
       'inspect_presenter_connection_v2',
        'issue_presenter_connection_v2',
        'claim_presenter_connection_v2',
        'apply_presenter_page_v2',
        'heartbeat_presenter_connection_v2',
        'disconnect_presenter_connection_v2',
        'cleanup_presenter_security_v2'
      )
  ),
  7,
  'all seven Phase 7.29C service RPCs exist exactly once'
);
SELECT ok(
  NOT EXISTS (
    SELECT 1
    FROM pg_proc AS procedure
    JOIN pg_namespace AS namespace
      ON namespace.oid = procedure.pronamespace
    WHERE namespace.nspname = 'public'
      AND procedure.proname IN (
        'inspect_presenter_connection_v2',
        'issue_presenter_connection_v2',
        'claim_presenter_connection_v2',
        'apply_presenter_page_v2',
        'heartbeat_presenter_connection_v2',
        'disconnect_presenter_connection_v2',
        'cleanup_presenter_security_v2'
      )
      AND (
        procedure.prosecdef
        OR NOT has_function_privilege(
          'service_role',
          procedure.oid,
          'EXECUTE'
        )
        OR has_function_privilege('anon', procedure.oid, 'EXECUTE')
        OR has_function_privilege('authenticated', procedure.oid, 'EXECUTE')
      )
  ),
  'Phase 7.29C public RPCs are invoker-only and service-role-only'
);
SELECT ok(
  NOT EXISTS (
    SELECT 1
    FROM pg_proc AS procedure
    JOIN pg_namespace AS namespace
      ON namespace.oid = procedure.pronamespace
    WHERE namespace.nspname IN ('public', 'private')
      AND procedure.proname LIKE '%presenter%v2'
      AND NOT (
        procedure.proconfig @> ARRAY['search_path=""']::text[]
      )
  ),
  'every Phase 7.29C function fixes an empty search_path'
);
SELECT ok(
  NOT EXISTS (
    SELECT 1
    FROM pg_proc AS procedure
    JOIN pg_namespace AS namespace
      ON namespace.oid = procedure.pronamespace
    WHERE namespace.nspname = 'public'
      AND procedure.proname IN (
        'inspect_presenter_connection_v2',
        'issue_presenter_connection_v2',
        'claim_presenter_connection_v2',
        'apply_presenter_page_v2',
        'heartbeat_presenter_connection_v2',
        'disconnect_presenter_connection_v2'
      )
      AND NOT (
        procedure.proconfig @> ARRAY['statement_timeout=3s']::text[]
        AND procedure.proconfig @> ARRAY['lock_timeout=750ms']::text[]
      )
  ),
  'machine state RPCs carry explicit statement and lock timeouts'
);

SELECT is(
  (
    SELECT count(*)::integer
    FROM cron.job
    WHERE jobname = 'compass-presenter-cleanup'
      AND schedule = '* * * * *'
  ),
  1,
  'Presenter cleanup Cron is installed once at one-minute cadence'
);
SELECT ok(
  EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.presenter_connections'::regclass
      AND conname = 'presenter_connections_pairing_window_check'
      AND pg_get_constraintdef(oid) LIKE '%00:05:00%'
  ),
  'manual recovery has a named five-minute database window'
);
SELECT ok(
  pg_get_functiondef(
    'public.issue_presenter_connection_v2(uuid,uuid,uuid,text,text,timestamptz,timestamptz)'::regprocedure
  ) LIKE '%interval ''60 seconds''%'
  AND pg_get_functiondef(
    'public.issue_presenter_connection_v2(uuid,uuid,uuid,text,text,timestamptz,timestamptz)'::regprocedure
  ) LIKE '%interval ''5 minutes''%',
  'pairing ticket and manual recovery deadlines remain separate server contracts'
);
SELECT ok(
  NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND (
        tablename LIKE 'presenter_request%'
        OR tablename LIKE 'presenter_machine%'
        OR tablename = 'presenter_cleanup_health'
      )
  ),
  'proof, rate and cleanup metadata never enter Realtime publication'
);
SELECT is(
  (SELECT enabled::text
   FROM private.presenter_runtime_gate
   WHERE singleton),
  'false',
  'Phase 7.29C migration does not activate Presenter runtime'
);
SELECT is(
  (SELECT count(*)::integer FROM public.presenter_connections),
  0,
  'Phase 7.29C migration creates no Presenter connection'
);

SET LOCAL ROLE service_role;
SELECT is(
  (
    private.begin_presenter_request_v2(
      'heartbeat',
      repeat('a', 64),
      repeat('0', 64),
      repeat('c', 64),
      statement_timestamp(),
      repeat('d', 64),
      repeat('e', 64),
      repeat('f', 64)
    ) ->> 'proof_cached'
  ),
  'false',
  'a fresh signed request reaches the uncached admission state'
);
SELECT is(
  (
    private.begin_presenter_request_v2(
      'heartbeat',
      repeat('a', 64),
      repeat('b', 64),
      repeat('c', 64),
      statement_timestamp() - interval '3 minutes',
      repeat('d', 64),
      repeat('e', 64),
      repeat('f', 64)
    ) ->> 'proof_rejected'
  ),
  'invalid_request',
  'a stale request is rejected before state transition'
);
SELECT is(
  (
    private.begin_presenter_request_v2(
      'heartbeat',
      repeat('1', 64),
      repeat('2', 64),
      repeat('3', 64),
      current_timestamp,
      repeat('4', 64),
      repeat('5', 64),
      repeat('6', 64)
    ) ->> 'proof_cached'
  ),
  'false',
  'an admitted logical request starts with one pending receipt'
);
SELECT lives_ok(
  $$SELECT private.finish_presenter_request_v2(
    NULL,
    'heartbeat',
    repeat('1', 64),
    repeat('2', 64),
    repeat('3', 64),
    current_timestamp,
    '{"presenter_error":"confirmation_pending"}'::jsonb
  )$$,
  'an expected negative result completes the receipt atomically'
);
SELECT is(
  (
    private.begin_presenter_request_v2(
      'heartbeat',
      repeat('1', 64),
      repeat('2', 64),
      repeat('3', 64),
      current_timestamp,
      repeat('4', 64),
      repeat('5', 64),
      repeat('6', 64)
    ) ->> 'proof_cached'
  ),
  'true',
  'an exact transport retry reuses the completed receipt before rate charging'
);
SELECT is(
  (
    private.begin_presenter_request_v2(
      'heartbeat',
      repeat('1', 64),
      repeat('2', 64),
      repeat('7', 64),
      current_timestamp,
      repeat('4', 64),
      repeat('5', 64),
      repeat('6', 64)
    ) ->> 'proof_rejected'
  ),
  'nonce_reused',
  'a nonce cannot be replayed with a different body digest'
);

SELECT is(
  (
    SELECT sum(rate.request_count)::integer
    FROM private.presenter_machine_rate_limits AS rate
    WHERE rate.action = 'heartbeat'
      AND rate.bucket_hash IN (
        repeat('4', 64),
        repeat('5', 64),
        repeat('6', 64)
      )
  ),
  3,
  'an exact cached retry does not consume rate capacity again'
);
SELECT is(
  (
    private.begin_presenter_request_v2(
      'heartbeat',
      repeat('1', 64),
      repeat('2', 64),
      repeat('3', 64),
      current_timestamp + interval '1 second',
      repeat('4', 64),
      repeat('5', 64),
      repeat('6', 64)
    ) ->> 'proof_rejected'
  ),
  'nonce_reused',
  'a nonce cannot be replayed under a different signed timestamp'
);

SELECT is(
  (
    private.begin_presenter_request_v2(
      'update',
      repeat('8', 64),
      repeat('9', 64),
      repeat('a', 64),
      current_timestamp,
      repeat('b', 64),
      repeat('c', 64),
      repeat('d', 64)
    ) ->> 'proof_cached'
  ),
  'false',
  'a positive logical result also starts with one pending receipt'
);
SELECT lives_ok(
  $$SELECT private.finish_presenter_request_v2(
    NULL,
    'update',
    repeat('8', 64),
    repeat('9', 64),
    repeat('a', 64),
    current_timestamp,
    '{"ok":true}'::jsonb
  )$$,
  'a positive result completes its receipt atomically'
);
SELECT is(
  (
    private.begin_presenter_request_v2(
      'update',
      repeat('8', 64),
      repeat('9', 64),
      repeat('a', 64),
      current_timestamp,
      repeat('b', 64),
      repeat('c', 64),
      repeat('d', 64)
    ) #>> '{response,ok}'
  ),
  'true',
  'an exact positive retry returns the cached response'
);

INSERT INTO private.presenter_request_receipts (
  proof_key_id,
  nonce_hash,
  action,
  request_body_sha256,
  response_body,
  request_issued_at,
  consumed_at,
  completed_at,
  expires_at
) VALUES (
  repeat('7', 64),
  repeat('8', 64),
  'inspect',
  repeat('9', 64),
  '{"ok":true}'::jsonb,
  current_timestamp - interval '9 minutes',
  current_timestamp - interval '9 minutes',
  current_timestamp - interval '9 minutes' + interval '1 second',
  current_timestamp + interval '1 minute'
);
SELECT is(
  (
    private.begin_presenter_request_v2(
      'inspect',
      repeat('7', 64),
      repeat('8', 64),
      repeat('9', 64),
      current_timestamp - interval '9 minutes',
      null,
      repeat('a', 64),
      repeat('b', 64)
    ) #>> '{response,ok}'
  ),
  'true',
  'an exact completed retry remains recoverable for the ten-minute receipt TTL'
);

INSERT INTO private.presenter_request_receipts (
  proof_key_id,
  nonce_hash,
  action,
  request_body_sha256,
  response_body,
  request_issued_at,
  consumed_at,
  completed_at,
  expires_at
) VALUES (
  repeat('c', 64),
  repeat('d', 64),
  'inspect',
  repeat('e', 64),
  '{"ok":true}'::jsonb,
  current_timestamp - interval '11 minutes',
  current_timestamp - interval '11 minutes',
  current_timestamp - interval '11 minutes' + interval '1 second',
  current_timestamp - interval '1 minute'
);
SELECT is(
  (
    private.begin_presenter_request_v2(
      'inspect',
      repeat('c', 64),
      repeat('d', 64),
      repeat('e', 64),
      current_timestamp - interval '11 minutes',
      null,
      repeat('f', 64),
      repeat('0', 64)
    ) ->> 'proof_rejected'
  ),
  'nonce_expired',
  'an expired receipt fails closed before physical cleanup'
);

INSERT INTO private.presenter_machine_rate_limits (
  action,
  bucket_kind,
  bucket_hash,
  window_started_at,
  request_count,
  updated_at
) VALUES (
  'inspect',
  'network',
  repeat('2', 64),
  date_trunc('minute', current_timestamp),
  30,
  current_timestamp
);
SELECT is(
  private.consume_presenter_machine_rate_v2(
    'inspect',
    null,
    repeat('2', 64),
    repeat('0', 64)
  )::text,
  'false',
  'the network bucket rejects before broader buckets are charged'
);
SELECT is(
  (
    SELECT count(*)::integer
    FROM private.presenter_machine_rate_limits AS rate
    WHERE rate.action = 'inspect'
      AND rate.bucket_kind = 'global'
      AND rate.bucket_hash = repeat('0', 64)
  ),
  0,
  'a rejected network bucket does not consume the global bucket'
);

INSERT INTO private.presenter_machine_rate_limits (
  action,
  bucket_kind,
  bucket_hash,
  window_started_at,
  request_count,
  updated_at
) VALUES (
  'claim',
  'proof_key',
  repeat('4', 64),
  date_trunc('minute', current_timestamp),
  30,
  current_timestamp
);
SELECT is(
  private.consume_presenter_machine_rate_v2(
    'claim',
    repeat('4', 64),
    repeat('3', 64),
    repeat('5', 64)
  )::text,
  'false',
  'the proof-key bucket rejects after network admission'
);
SELECT is(
  (
    SELECT count(*)::integer
    FROM private.presenter_machine_rate_limits AS rate
    WHERE rate.action = 'claim'
      AND rate.bucket_kind = 'global'
      AND rate.bucket_hash = repeat('5', 64)
  ),
  0,
  'a rejected proof-key bucket does not consume the global bucket'
);

INSERT INTO private.presenter_machine_rate_limits (
  action,
  bucket_kind,
  bucket_hash,
  window_started_at,
  request_count,
  updated_at
) VALUES (
  'inspect',
  'global',
  repeat('6', 64),
  date_trunc('minute', current_timestamp),
  600,
  current_timestamp
);
SELECT is(
  private.consume_presenter_machine_rate_v2(
    'inspect',
    null,
    repeat('7', 64),
    repeat('6', 64)
  )::text,
  'false',
  'the global bucket remains authoritative after network admission'
);
SELECT is(
  (
    private.begin_presenter_request_v2(
      'heartbeat',
      repeat('a', 64),
      repeat('f', 64),
      repeat('b', 64),
      current_timestamp,
      repeat('c', 64),
      repeat('d', 64),
      null
    ) ->> 'proof_rejected'
  ),
  'invalid_request',
  'a missing global rate bucket fails closed'
);

INSERT INTO private.presenter_machine_rate_limits (
  action,
  bucket_kind,
  bucket_hash,
  window_started_at,
  request_count,
  updated_at
) VALUES (
  'disconnect',
  'global',
  repeat('3', 64),
  date_trunc('minute', current_timestamp - interval '11 minutes'),
  1,
  current_timestamp - interval '11 minutes'
);
SELECT is(
  (public.cleanup_presenter_security_v2(10000) ->> 'receipt_delete_count')::integer,
  1,
  'one-minute cleanup deletes the expired receipt in its bounded batch'
);
SELECT is(
  (
    SELECT count(*)::integer
    FROM private.presenter_machine_rate_limits AS rate
    WHERE rate.action = 'disconnect'
      AND rate.bucket_hash = repeat('3', 64)
  ),
  0,
  'cleanup removes stale application rate buckets'
);
SELECT ok(
  (
    SELECT health.last_succeeded_at IS NOT NULL
      AND health.last_receipt_delete_count = 1
      AND health.last_rate_delete_count = 1
    FROM private.presenter_cleanup_health AS health
    WHERE health.singleton
  ),
  'cleanup records bounded receipt and rate progress without content'
);
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
