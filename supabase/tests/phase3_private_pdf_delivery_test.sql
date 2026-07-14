BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path = public, extensions;
SELECT no_plan();

SELECT has_column('public', 'lecture_sessions', 'pdf_public_id', 'lecture has PDF public ID');
SELECT has_column('public', 'lecture_sessions', 'pdf_access_version', 'lecture has PDF access version');
SELECT has_column('public', 'lecture_live_state', 'pdf_document_version', 'live state has document version');
SELECT has_column('public', 'lecture_live_state', 'pdf_manifest_version', 'live state has manifest version');
SELECT has_column('public', 'lecture_live_state', 'pdf_page_count', 'live state has page count');
SELECT has_column('public', 'lecture_live_state', 'pdf_visible', 'live state has visibility');
SELECT has_table('public', 'lecture_pdf_documents', 'PDF metadata table exists');
SELECT ok(
  (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.lecture_pdf_documents'::regclass),
  'PDF metadata table has RLS enabled'
);
SELECT ok(
  NOT has_table_privilege('anon', 'public.lecture_pdf_documents', 'SELECT'),
  'anonymous role cannot read PDF metadata table'
);
SELECT ok(
  NOT has_table_privilege('authenticated', 'public.lecture_pdf_documents', 'SELECT'),
  'authenticated role cannot read PDF metadata table'
);
SELECT ok(
  has_table_privilege('service_role', 'public.lecture_pdf_documents', 'SELECT'),
  'service role can read PDF metadata for protected Edge code'
);
SELECT ok(
  to_regprocedure('public.admin_register_pdf_document(uuid,text,text,bigint,text,integer,bigint,integer,text,text,boolean)') IS NOT NULL,
  'PDF registration RPC exists'
);
SELECT ok(
  to_regprocedure('public.admin_update_pdf_display_v3(uuid,text,text,bigint,integer,boolean,integer,text)') IS NOT NULL,
  'PDF display v3 RPC exists'
);
SELECT ok(
  to_regprocedure('public.get_pdf_access_claims_v1(uuid)') IS NOT NULL,
  'member PDF claim RPC exists'
);
SELECT ok(
  NOT (SELECT prosecdef FROM pg_proc WHERE oid = 'public.get_pdf_access_claims_v1(uuid)'::regprocedure),
  'public member claim RPC is security invoker'
);
SELECT ok(
  (SELECT prosecdef FROM pg_proc WHERE oid = 'private.get_pdf_access_claims_v1(uuid)'::regprocedure),
  'private member claim primitive is security definer'
);
SELECT is(
  (SELECT proconfig FROM pg_proc WHERE oid = 'private.get_pdf_access_claims_v1(uuid)'::regprocedure),
  ARRAY['search_path=""']::text[],
  'private claim primitive fixes an empty search path'
);
SELECT ok(
  NOT has_function_privilege(
    'authenticated',
    'public.admin_register_pdf_document(uuid,text,text,bigint,text,integer,bigint,integer,text,text,boolean)',
    'EXECUTE'
  ),
  'browser clients cannot register PDF metadata'
);
SELECT ok(
  has_function_privilege(
    'service_role',
    'public.admin_register_pdf_document(uuid,text,text,bigint,text,integer,bigint,integer,text,text,boolean)',
    'EXECUTE'
  ),
  'service role can register PDF metadata'
);
SELECT ok(
  has_function_privilege('authenticated', 'public.get_pdf_access_claims_v1(uuid)', 'EXECUTE'),
  'authenticated members can request bounded PDF claims'
);
SELECT ok(
  NOT has_function_privilege('anon', 'public.get_pdf_access_claims_v1(uuid)', 'EXECUTE'),
  'anonymous role cannot request PDF claims'
);
SELECT ok(
  to_regclass('public.lecture_pdf_documents_manifest_lookup_idx') IS NOT NULL,
  'manifest document lookup is indexed'
);
SELECT ok(
  to_regclass('public.lecture_pdf_documents_cleanup_idx') IS NOT NULL,
  'PDF retention cleanup is indexed'
);

CREATE TEMP TABLE p3_fixture (
  lecture_id uuid,
  participant_id uuid,
  display_version bigint,
  pdf_version bigint,
  archive_payload jsonb
);
GRANT SELECT, INSERT, UPDATE ON p3_fixture TO service_role, authenticated;
INSERT INTO p3_fixture DEFAULT VALUES;

SET LOCAL ROLE service_role;
UPDATE p3_fixture
SET lecture_id = public.admin_create_lecture(
  'Phase 3 PDF lecture',
  encode(extensions.digest(convert_to('P3-PDF', 'UTF8'), 'sha256'), 'hex'),
  'P3-PDF',
  null,
  null
);
SELECT ok(
  public.admin_set_lecture_status((SELECT lecture_id FROM p3_fixture), 'start', null),
  'Phase 3 lecture starts'
);

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '61000000-0000-4000-8000-000000000001', true);
UPDATE p3_fixture
SET participant_id = (
  SELECT participant_id FROM public.join_lecture_by_code('P3-PDF')
);
SELECT ok((SELECT participant_id IS NOT NULL FROM p3_fixture), 'member joins lecture');
SELECT throws_ok(
  $$SELECT * FROM public.lecture_pdf_documents$$,
  '42501',
  null,
  'member cannot bypass metadata RPC with a table read'
);

SET LOCAL ROLE service_role;
SELECT lives_ok(
  $$
    SELECT public.admin_register_pdf_document(
      (SELECT lecture_id FROM p3_fixture),
      'doc-main',
      repeat('a', 64),
      1,
      'Main material',
      3,
      3000,
      300,
      repeat('a', 64),
      repeat('b', 64),
      true
    )
  $$,
  'service role registers content-free PDF metadata'
);
SELECT is(
  (SELECT count(*)::integer FROM public.lecture_pdf_documents WHERE lecture_session_id = (SELECT lecture_id FROM p3_fixture)),
  1,
  'registration creates one metadata row'
);
SELECT lives_ok(
  $$
    SELECT public.admin_register_pdf_document(
      (SELECT lecture_id FROM p3_fixture),
      'doc-main', repeat('a', 64), 1, 'Main material', 3, 3000, 300,
      repeat('a', 64), repeat('b', 64), true
    )
  $$,
  'duplicate registration is idempotent'
);
SELECT is(
  (SELECT count(*)::integer FROM public.lecture_pdf_documents WHERE lecture_session_id = (SELECT lecture_id FROM p3_fixture)),
  1,
  'duplicate registration does not duplicate rows'
);
SELECT throws_ok(
  $$
    SELECT public.admin_register_pdf_document(
      (SELECT lecture_id FROM p3_fixture),
      'doc-main', repeat('a', 64), 1, 'Tampered title', 3, 3000, 300,
      repeat('a', 64), repeat('b', 64), true
    )
  $$,
  '23514',
  'Immutable PDF metadata does not match.',
  'immutable metadata mismatch is rejected'
);

SELECT lives_ok(
  $$
    SELECT * FROM public.admin_update_pdf_display_v3(
      (SELECT lecture_id FROM p3_fixture),
      'doc-main', repeat('a', 64), 1, 3, true, 1, 'normal'
    )
  $$,
  'registered PDF can be selected'
);
UPDATE p3_fixture
SET
  display_version = live.display_version,
  pdf_version = live.pdf_version
FROM public.lecture_live_state AS live
WHERE live.lecture_session_id = p3_fixture.lecture_id;
SELECT lives_ok(
  $$
    SELECT * FROM public.admin_update_pdf_display_v3(
      (SELECT lecture_id FROM p3_fixture),
      'doc-main', repeat('a', 64), 1, 3, true, 1, 'normal'
    )
  $$,
  'repeated display state is a safe no-op'
);
SELECT is(
  (SELECT live.pdf_version FROM public.lecture_live_state live, p3_fixture WHERE live.lecture_session_id = p3_fixture.lecture_id),
  (SELECT pdf_version FROM p3_fixture),
  'no-op does not increment PDF version'
);
SELECT throws_ok(
  $$
    SELECT * FROM public.admin_update_pdf_display_v3(
      (SELECT lecture_id FROM p3_fixture),
      'doc-main', repeat('a', 64), 1, 3, true, 4, 'normal'
    )
  $$,
  'P0001',
  'The selected PDF publication is not registered.',
  'page above registered count is rejected'
);
SELECT throws_ok(
  $$
    SELECT * FROM public.admin_update_pdf_display_v3(
      (SELECT lecture_id FROM p3_fixture),
      'doc-unknown', repeat('c', 64), 1, 1, true, 1, 'normal'
    )
  $$,
  'P0001',
  'The selected PDF publication is not registered.',
  'unregistered PDF cannot be selected'
);

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '61000000-0000-4000-8000-000000000001', true);
SELECT is(
  public.get_lecture_public_snapshot_v2((SELECT lecture_id FROM p3_fixture))
    #>> '{changed,pdf,pdf_document_version}',
  repeat('a', 64),
  'Phase 1 v2 snapshot contains document version'
);
SELECT is(
  public.get_lecture_live_snapshot((SELECT lecture_id FROM p3_fixture))
    #>> '{display,pdf_manifest_version}',
  '1',
  'legacy snapshot contains additive manifest version'
);
SELECT ok(
  (public.get_pdf_access_claims_v1((SELECT lecture_id FROM p3_fixture))
    ->> 'lecture_public_id') IS NOT NULL,
  'owned member receives pseudonymous lecture access claims'
);
SELECT set_config('request.jwt.claim.sub', '61000000-0000-4000-8000-000000000099', true);
SELECT is(
  public.get_pdf_access_claims_v1((SELECT lecture_id FROM p3_fixture)),
  null,
  'unrelated authenticated user receives no PDF claims'
);

SET LOCAL ROLE service_role;
SELECT lives_ok(
  $$
    SELECT public.admin_register_pdf_document(
      (SELECT lecture_id FROM p3_fixture),
      'doc-second', repeat('c', 64), 2, 'Second', 1, 100, 100,
      repeat('c', 64), repeat('d', 64), false
    )
  $$,
  'newer manifest metadata registers'
);
SELECT throws_ok(
  $$
    SELECT public.admin_register_pdf_document(
      (SELECT lecture_id FROM p3_fixture),
      'doc-stale', repeat('e', 64), 1, 'Stale', 1, 100, 100,
      repeat('e', 64), repeat('f', 64), false
    )
  $$,
  '40001',
  'PDF manifest version is stale.',
  'stale new manifest metadata is rejected'
);
SELECT lives_ok(
  $$
    SELECT public.admin_register_pdf_document(
      (SELECT lecture_id FROM p3_fixture),
      'doc-large', repeat('1', 64), 3, 'Large', 70, 100, 100,
      repeat('1', 64), repeat('2', 64), false
    )
  $$,
  'aggregate metadata remains valid at 74 pages'
);
SELECT throws_ok(
  $$
    SELECT public.admin_register_pdf_document(
      (SELECT lecture_id FROM p3_fixture),
      'doc-too-many', repeat('3', 64), 4, 'Too many', 2, 100, 100,
      repeat('3', 64), repeat('4', 64), false
    )
  $$,
  '22023',
  'Lecture PDF aggregate limit exceeded.',
  'aggregate page limit is server enforced'
);

SELECT ok(
  public.admin_set_lecture_status((SELECT lecture_id FROM p3_fixture), 'close', null),
  'lecture closes through unified Phase 2 transition'
);
SELECT ok(
  (
    SELECT bool_and(
      document.archive_expires_at = lecture.archive_expires_at
      AND document.delete_after = lecture.archive_expires_at + interval '7 days'
    )
    FROM public.lecture_pdf_documents document
    JOIN public.lecture_sessions lecture ON lecture.id = document.lecture_session_id
    WHERE lecture.id = (SELECT lecture_id FROM p3_fixture)
  ),
  'close trigger propagates 30/37-day retention metadata'
);
SELECT throws_ok(
  $$
    SELECT public.admin_register_pdf_document(
      (SELECT lecture_id FROM p3_fixture),
      'doc-after-close', repeat('5', 64), 5, 'Closed', 1, 100, 100,
      repeat('5', 64), repeat('6', 64), false
    )
  $$,
  'P0001',
  'PDF publication is unavailable for this lecture.',
  'closed lecture rejects metadata registration'
);
SELECT is(
  (
    SELECT count(*)::integer
    FROM public.admin_update_pdf_display_v3(
      (SELECT lecture_id FROM p3_fixture),
      'doc-main', repeat('a', 64), 1, 3, true, 2, 'normal'
    )
  ),
  0,
  'closed lecture rejects PDF page writes'
);

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '61000000-0000-4000-8000-000000000001', true);
UPDATE p3_fixture SET archive_payload = public.get_lecture_archive_v2(lecture_id);
SELECT is(
  (SELECT archive_payload #>> '{pdf,pdf_document_version}' FROM p3_fixture),
  repeat('a', 64),
  '30-day archive payload retains private delivery metadata'
);
SELECT ok(
  public.get_pdf_access_claims_v1((SELECT lecture_id FROM p3_fixture)) IS NOT NULL,
  'member can obtain PDF claims before 30-day boundary'
);

SET LOCAL ROLE service_role;
UPDATE public.lecture_sessions
SET
  starts_at = statement_timestamp() - interval '30 days 90 minutes 1 microsecond',
  started_at = statement_timestamp() - interval '30 days 90 minutes 1 microsecond',
  closed_at = statement_timestamp() - interval '30 days 1 microsecond',
  archive_expires_at = statement_timestamp() - interval '1 microsecond'
WHERE id = (SELECT lecture_id FROM p3_fixture);

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '61000000-0000-4000-8000-000000000001', true);
SELECT is(
  public.get_pdf_access_claims_v1((SELECT lecture_id FROM p3_fixture)),
  null,
  'member PDF claims stop at the 30-day boundary even before R2 cleanup'
);

SELECT * FROM finish();
ROLLBACK;
