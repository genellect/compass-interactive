begin;
select plan(10);

select is(
  (
    select count(*)::integer
    from public.lecture_sessions
    where title = 'Phase 7.27 upgrade preservation probe'
  ),
  1,
  'existing Phase 7.26 lecture survives the Phase 7.27 upgrade'
);

select is(
  (
    select status
    from public.lecture_sessions
    where title = 'Phase 7.27 upgrade preservation probe'
  ),
  'draft',
  'existing lecture status is unchanged'
);

select is(
  (
    select count(*)::integer
    from public.polls as poll
    join public.lecture_sessions as lecture
      on lecture.id = poll.lecture_session_id
    where lecture.title = 'Phase 7.27 upgrade preservation probe'
      and poll.question = 'Existing Phase 7.26 Poll remains isolated?'
      and poll.status = 'draft'
  ),
  1,
  'existing Poll remains a draft and survives the upgrade'
);

select is(
  (
    select count(*)::integer
    from public.poll_options as option_row
    join public.lecture_sessions as lecture
      on lecture.id = option_row.lecture_session_id
    where lecture.title = 'Phase 7.27 upgrade preservation probe'
  ),
  2,
  'existing Poll options survive the upgrade'
);

select is(
  (
    select count(*)::integer
    from public.lecture_pdf_documents as document
    join public.lecture_sessions as lecture
      on lecture.id = document.lecture_session_id
    where lecture.title = 'Phase 7.27 upgrade preservation probe'
      and document.document_id = 'phase727-upgrade-probe-doc'
      and document.document_version = repeat('b', 64)
  ),
  1,
  'existing PDF metadata survives the upgrade'
);

select is(
  (
    select count(*)::integer
    from public.phase727_journal_club_runs
  ),
  0,
  'upgrade does not reclassify an existing lecture as Journal Club'
);

select is(
  (
    select count(*)::integer
    from public.phase727_journal_club_poll_slots
  ),
  0,
  'upgrade does not assign Journal Club slots to an existing Poll'
);

select ok(
  to_regprocedure(
    'public.admin_create_phase727_journal_club_run_v1(text,text,text,uuid,uuid,uuid)'
  ) is not null,
  'Phase 7.27 run creation RPC is installed'
);

select is(
  (
    select document.local_manifest_etag
    from public.lecture_pdf_documents as document
    join public.lecture_sessions as lecture
      on lecture.id = document.lecture_session_id
    where lecture.title = 'Phase 7.27 upgrade preservation probe'
      and document.document_id = 'phase727-upgrade-probe-doc'
  ),
  null,
  'pre-Phase-7.27 Local Publisher metadata remains backward-compatible'
);

select is(
  (
    select control.material_analysis_call_limit
    from public.lecture_ai_control as control
    join public.lecture_sessions as lecture
      on lecture.id = control.lecture_session_id
    where lecture.title = 'Phase 7.27 upgrade preservation probe'
  ),
  1,
  'the recovery default does not rewrite an existing per-lecture call cap'
);

select * from finish();
rollback;
