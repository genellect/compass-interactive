BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path = public, extensions;
SELECT plan(31);

SELECT has_column(
  'public',
  'lecture_live_state',
  'pdf_document_id',
  'live state stores only the static PDF document ID'
);
SELECT ok(
  to_regprocedure('public.admin_update_pdf_display(uuid,text,integer,text)') IS NOT NULL,
  'atomic PDF display update routine exists'
);
SELECT ok(
  to_regprocedure('private.get_lecture_live_snapshot_core(uuid,uuid,bigint,bigint,bigint,bigint,bigint,timestamptz,uuid,integer)') IS NOT NULL,
  'the previous snapshot implementation is private'
);
SELECT ok(
  NOT has_function_privilege(
    'anon',
    'public.admin_update_pdf_display(uuid,text,integer,text)',
    'EXECUTE'
  ),
  'anonymous clients cannot update PDF display state'
);
SELECT ok(
  NOT has_function_privilege(
    'authenticated',
    'public.admin_update_pdf_display(uuid,text,integer,text)',
    'EXECUTE'
  ),
  'authenticated clients cannot update PDF display state'
);
SELECT ok(
  has_function_privilege(
    'service_role',
    'public.admin_update_pdf_display(uuid,text,integer,text)',
    'EXECUTE'
  ),
  'service role can update PDF display state'
);
SELECT ok(
  has_function_privilege(
    'anon',
    'public.get_lecture_live_snapshot(uuid,uuid,bigint,bigint,bigint,bigint,bigint,timestamptz,uuid,integer)',
    'EXECUTE'
  ),
  'anonymous clients retain snapshot access'
);
SELECT ok(
  has_function_privilege(
    'authenticated',
    'public.get_lecture_live_snapshot(uuid,uuid,bigint,bigint,bigint,bigint,bigint,timestamptz,uuid,integer)',
    'EXECUTE'
  ),
  'authenticated clients retain snapshot access'
);
SELECT ok(
  NOT has_function_privilege(
    'anon',
    'private.get_lecture_live_snapshot_core(uuid,uuid,bigint,bigint,bigint,bigint,bigint,timestamptz,uuid,integer)',
    'EXECUTE'
  ),
  'anonymous clients cannot execute the snapshot core'
);
SELECT ok(
  NOT has_function_privilege(
    'authenticated',
    'private.get_lecture_live_snapshot_core(uuid,uuid,bigint,bigint,bigint,bigint,bigint,timestamptz,uuid,integer)',
    'EXECUTE'
  ),
  'authenticated clients cannot execute the snapshot core'
);

CREATE TEMP TABLE m4_fixture (
  lecture_id uuid,
  display_version_before bigint,
  state_version_before bigint
);
GRANT SELECT, INSERT, UPDATE ON m4_fixture TO service_role, anon;

SET LOCAL ROLE service_role;
SELECT lives_ok(
  $$
    INSERT INTO m4_fixture (lecture_id)
    SELECT public.admin_create_lecture(
      'Milestone 4 PDF lecture',
      repeat('b', 64),
      'M4-PDF',
      null,
      null
    )
  $$,
  'service role creates an M4 lecture'
);
SELECT ok(
  public.admin_set_lecture_status(
    (SELECT lecture_id FROM m4_fixture),
    'start',
    '2026-07-11 10:00:00+00'
  ),
  'M4 lecture starts'
);
SELECT is(
  (SELECT pdf_document_id FROM public.lecture_live_state WHERE lecture_session_id = (SELECT lecture_id FROM m4_fixture)),
  null,
  'new lecture has no PDF selected'
);
SELECT is(
  (SELECT current_pdf_page FROM public.lecture_live_state WHERE lecture_session_id = (SELECT lecture_id FROM m4_fixture)),
  1,
  'new lecture starts on PDF page 1'
);
SELECT lives_ok(
  $$
    UPDATE m4_fixture
    SET
      display_version_before = live.display_version,
      state_version_before = live.state_version
    FROM public.lecture_live_state live
    WHERE live.lecture_session_id = m4_fixture.lecture_id
  $$,
  'fixture captures versions before PDF selection'
);
SELECT lives_ok(
  $$
    SELECT * FROM public.admin_update_pdf_display(
      (SELECT lecture_id FROM m4_fixture),
      'm4-sample-v1',
      1,
      'normal'
    )
  $$,
  'Admin selects a registered static PDF document'
);
SELECT is(
  (SELECT pdf_document_id FROM public.lecture_live_state WHERE lecture_session_id = (SELECT lecture_id FROM m4_fixture)),
  'm4-sample-v1',
  'PDF document ID is persisted'
);
SELECT is(
  (SELECT current_pdf_page FROM public.lecture_live_state WHERE lecture_session_id = (SELECT lecture_id FROM m4_fixture)),
  1,
  'selecting a PDF resets to page 1'
);
SELECT is(
  (SELECT display_version FROM public.lecture_live_state WHERE lecture_session_id = (SELECT lecture_id FROM m4_fixture)),
  (SELECT display_version_before + 1 FROM m4_fixture),
  'PDF selection advances display version once'
);
SELECT is(
  (SELECT state_version FROM public.lecture_live_state WHERE lecture_session_id = (SELECT lecture_id FROM m4_fixture)),
  (SELECT state_version_before + 1 FROM m4_fixture),
  'PDF selection advances state version once'
);

SET LOCAL ROLE anon;
SELECT is(
  public.get_lecture_live_snapshot((SELECT lecture_id FROM m4_fixture))
    #>> '{display,pdf_document_id}',
  'm4-sample-v1',
  'student snapshot includes the PDF document ID'
);

SET LOCAL ROLE service_role;
SELECT lives_ok(
  $$
    SELECT * FROM public.admin_update_pdf_display(
      (SELECT lecture_id FROM m4_fixture),
      'm4-sample-v1',
      2,
      'presentation'
    )
  $$,
  'Admin changes PDF page and display mode atomically'
);
SELECT is(
  (SELECT current_pdf_page FROM public.lecture_live_state WHERE lecture_session_id = (SELECT lecture_id FROM m4_fixture)),
  2,
  'PDF page change is persisted'
);
SELECT is(
  (SELECT display_mode FROM public.lecture_live_state WHERE lecture_session_id = (SELECT lecture_id FROM m4_fixture)),
  'presentation',
  'PDF display mode change is persisted'
);
SELECT lives_ok(
  $$
    SELECT * FROM public.admin_update_pdf_display(
      (SELECT lecture_id FROM m4_fixture),
      'm4-sample-v1',
      2,
      'presentation'
    )
  $$,
  'repeating the same display state is a safe no-op'
);
SELECT is(
  (SELECT display_version FROM public.lecture_live_state WHERE lecture_session_id = (SELECT lecture_id FROM m4_fixture)),
  (SELECT display_version_before + 2 FROM m4_fixture),
  'a no-op does not advance display version'
);
SELECT throws_ok(
  $$
    SELECT * FROM public.admin_update_pdf_display(
      (SELECT lecture_id FROM m4_fixture),
      'Invalid Document',
      1,
      'normal'
    )
  $$,
  'P0001',
  'Invalid PDF document ID.',
  'invalid document IDs are rejected'
);
SELECT throws_ok(
  $$
    SELECT * FROM public.admin_update_pdf_display(
      (SELECT lecture_id FROM m4_fixture),
      'm4-sample-v1',
      0,
      'normal'
    )
  $$,
  'P0001',
  'PDF page must be greater than or equal to 1.',
  'page zero is rejected'
);
SELECT throws_ok(
  $$
    SELECT * FROM public.admin_update_pdf_display(
      (SELECT lecture_id FROM m4_fixture),
      null,
      2,
      'normal'
    )
  $$,
  'P0001',
  'A lecture without a PDF must remain on page 1.',
  'clearing a PDF with a non-first page is rejected'
);
SELECT ok(
  public.admin_set_lecture_status(
    (SELECT lecture_id FROM m4_fixture),
    'close',
    '2026-07-11 11:00:00+00'
  ),
  'M4 lecture closes'
);
SELECT is(
  (
    SELECT count(*)::integer
    FROM public.admin_update_pdf_display(
      (SELECT lecture_id FROM m4_fixture),
      'm4-sample-v1',
      3,
      'normal'
    )
  ),
  0,
  'closed lecture rejects further PDF display changes'
);

SELECT * FROM finish();
ROLLBACK;
