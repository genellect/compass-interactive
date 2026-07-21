BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path = public, extensions;
SELECT no_plan();

SELECT has_column(
  'public',
  'lecture_pdf_documents',
  'local_manifest_etag',
  'Local Publisher metadata stores the verified manifest ETag receipt'
);
SELECT col_is_null(
  'public',
  'lecture_pdf_documents',
  'local_manifest_etag',
  'legacy and browser document rows remain compatible with a NULL receipt'
);
SELECT has_function(
  'public',
  'admin_register_local_pdf_document_v2',
  ARRAY[
    'uuid', 'text', 'text', 'bigint', 'text', 'bigint', 'text', 'integer',
    'bigint', 'integer', 'text', 'text', 'boolean', 'uuid', 'uuid'
  ],
  'receipt-fenced Local Publisher registration RPC exists'
);
SELECT ok(
  NOT has_function_privilege(
    'anon',
    'public.admin_register_local_pdf_document_v2(uuid,text,text,bigint,text,bigint,text,integer,bigint,integer,text,text,boolean,uuid,uuid)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'authenticated',
    'public.admin_register_local_pdf_document_v2(uuid,text,text,bigint,text,bigint,text,integer,bigint,integer,text,text,boolean,uuid,uuid)',
    'EXECUTE'
  )
  AND has_function_privilege(
    'service_role',
    'public.admin_register_local_pdf_document_v2(uuid,text,text,bigint,text,bigint,text,integer,bigint,integer,text,text,boolean,uuid,uuid)',
    'EXECUTE'
  ),
  'only service_role can invoke the Local Publisher receipt RPC'
);
SELECT ok(
  NOT procedure.prosecdef
  AND procedure.proconfig = ARRAY['search_path=""']::text[],
  'Local Publisher receipt RPC is SECURITY INVOKER with an empty search_path'
)
FROM pg_proc AS procedure
WHERE procedure.oid = to_regprocedure(
  'public.admin_register_local_pdf_document_v2(uuid,text,text,bigint,text,bigint,text,integer,bigint,integer,text,text,boolean,uuid,uuid)'
);

CREATE TEMP TABLE phase726_local_fixture (
  lecture_id uuid
);
GRANT SELECT, INSERT, UPDATE ON phase726_local_fixture TO service_role;
INSERT INTO phase726_local_fixture DEFAULT VALUES;

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
) VALUES (
  '72620000-0000-4000-8000-000000000001',
  repeat('1', 64),
  '72620000-0000-4000-8000-000000000101',
  repeat('2', 64),
  statement_timestamp() - interval '1 minute',
  statement_timestamp() - interval '30 seconds',
  statement_timestamp() + interval '1 hour',
  statement_timestamp() + interval '4 hours'
);

UPDATE phase726_local_fixture
SET lecture_id = public.admin_create_lecture(
  'Phase 7.26 Local Publisher manifest fence',
  repeat('3', 64),
  '726201',
  null,
  null
);
SELECT ok(
  public.admin_set_lecture_status(
    (SELECT lecture_id FROM phase726_local_fixture),
    'start',
    null
  ),
  'Local Publisher fence fixture lecture starts'
);

SELECT lives_ok(
  format(
    $sql$
      SELECT public.admin_register_local_pdf_document_v2(
        %L::uuid,
        'local-fenced-document',
        %L,
        1,
        %L,
        1,
        'Local fenced document',
        2,
        4096,
        120,
        %L,
        %L,
        true,
        '72620000-0000-4000-8000-000000000001'::uuid,
        '72620000-0000-4000-8000-000000000101'::uuid
      )
    $sql$,
    (SELECT lecture_id FROM phase726_local_fixture),
    repeat('4', 64),
    repeat('5', 64),
    repeat('4', 64),
    repeat('6', 64)
  ),
  'matching access-version and manifest receipt registers Local metadata'
);
SELECT is(
  (
    SELECT document.local_manifest_etag
    FROM public.lecture_pdf_documents AS document
    WHERE document.lecture_session_id = (
      SELECT lecture_id FROM phase726_local_fixture
    )
      AND document.document_id = 'local-fenced-document'
      AND document.document_version = repeat('4', 64)
  ),
  repeat('5', 64),
  'the exact manifest ETag receipt is retained for audit'
);
SELECT is(
  (
    SELECT lecture.pdf_access_version
    FROM public.lecture_sessions AS lecture
    WHERE lecture.id = (SELECT lecture_id FROM phase726_local_fixture)
  ),
  1::bigint,
  'Local Publisher registration never advances the access-version fence'
);

UPDATE public.lecture_sessions AS lecture
SET pdf_access_version = 2
WHERE lecture.id = (SELECT lecture_id FROM phase726_local_fixture);

SELECT throws_ok(
  format(
    $sql$
      SELECT public.admin_register_local_pdf_document_v2(
        %L::uuid,
        'stale-local-document',
        %L,
        2,
        %L,
        1,
        'Stale Local document',
        1,
        1024,
        40,
        %L,
        %L,
        true,
        '72620000-0000-4000-8000-000000000001'::uuid,
        '72620000-0000-4000-8000-000000000101'::uuid
      )
    $sql$,
    (SELECT lecture_id FROM phase726_local_fixture),
    repeat('7', 64),
    repeat('8', 64),
    repeat('7', 64),
    repeat('9', 64)
  ),
  '40001',
  'Local Publisher access-version receipt is stale',
  'a Local registration delayed past browser activation fails closed'
);

SELECT throws_ok(
  format(
    $sql$
      SELECT public.admin_register_local_pdf_document_v2(
        %L::uuid,
        'other-actor-document',
        %L,
        2,
        %L,
        2,
        'Other actor document',
        1,
        1024,
        40,
        %L,
        %L,
        true,
        '72620000-0000-4000-8000-000000000001'::uuid,
        '72620000-0000-4000-8000-000000000102'::uuid
      )
    $sql$,
    (SELECT lecture_id FROM phase726_local_fixture),
    repeat('a', 64),
    repeat('b', 64),
    repeat('a', 64),
    repeat('c', 64)
  ),
  '42501',
  'tracked Admin session is unavailable',
  'a mismatched Admin identity cannot register a Local receipt'
);

RESET ROLE;
SELECT * FROM finish();
ROLLBACK;
