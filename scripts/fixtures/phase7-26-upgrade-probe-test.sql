begin;
select plan(6);

select is(
  (
    select count(*)::integer
    from public.lecture_sessions
    where title = 'Phase 7.26 upgrade preservation probe'
  ),
  1,
  'existing Phase 7.2 lecture survives the Phase 7.25/7.26 upgrade'
);

select is(
  (
    select status
    from public.lecture_sessions
    where title = 'Phase 7.26 upgrade preservation probe'
  ),
  'open',
  'existing open lecture state survives the upgrade'
);

select is(
  (
    select count(*)::integer
    from public.lecture_pdf_documents as document
    join public.lecture_sessions as lecture
      on lecture.id = document.lecture_session_id
    where lecture.title = 'Phase 7.26 upgrade preservation probe'
      and document.document_id = 'upgrade-probe-doc'
      and document.document_version = repeat('b', 64)
  ),
  1,
  'existing Phase 3 PDF metadata survives the upgrade'
);

select ok(
  exists(
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'lecture_pdf_publications'
      and column_name = 'cleanup_worker_generation'
  ),
  'Phase 7.26 terminal cleanup binding is installed'
);

select ok(
  exists(
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'lecture_pdf_documents'
      and column_name = 'local_manifest_etag'
  ),
  'Phase 7.26 Local Publisher receipt column is installed'
);

select is(
  (
    select document.local_manifest_etag
    from public.lecture_pdf_documents as document
    join public.lecture_sessions as lecture
      on lecture.id = document.lecture_session_id
    where lecture.title = 'Phase 7.26 upgrade preservation probe'
      and document.document_id = 'upgrade-probe-doc'
  ),
  null,
  'pre-Phase-7.26 PDF rows keep a NULL Local Publisher receipt'
);

select * from finish();
rollback;
