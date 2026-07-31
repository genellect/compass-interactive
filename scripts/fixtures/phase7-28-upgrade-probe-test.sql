begin;
select plan(20);

select is(
  (
    select count(*)::integer
    from public.phase727_journal_club_runs
    where client_request_id = '72800000-0000-4000-8000-000000000003'::uuid
      and run_kind = 'rehearsal'
  ),
  1,
  'the existing Journal Club rehearsal binding survives Phase 7.28'
);

select is(
  (
    select count(*)::integer
    from public.lecture_sessions as lecture
    join public.phase727_journal_club_runs as run
      on run.lecture_session_id = lecture.id
    where run.client_request_id =
      '72800000-0000-4000-8000-000000000003'::uuid
      and lecture.status = 'draft'
  ),
  1,
  'the existing rehearsal lifecycle remains draft'
);

select is(
  (
    select count(*)::integer
    from public.phase727_journal_club_poll_slots as slot
    join public.phase727_journal_club_runs as run
      on run.lecture_session_id = slot.lecture_session_id
    where run.client_request_id =
      '72800000-0000-4000-8000-000000000003'::uuid
  ),
  6,
  'all six existing Journal Club Poll slots survive Phase 7.28'
);

select is(
  (
    select count(*)::integer
    from public.polls as poll
    join public.phase727_journal_club_runs as run
      on run.lecture_session_id = poll.lecture_session_id
    where run.client_request_id =
      '72800000-0000-4000-8000-000000000003'::uuid
      and poll.status = 'draft'
  ),
  6,
  'Phase 7.28 does not open or alter the six existing Polls'
);

select is(
  (
    select count(*)::integer
    from public.admin_sessions
    where id = '72800000-0000-4000-8000-000000000001'::uuid
      and revoked_at is null
  ),
  1,
  'the tracked Admin session is not rewritten by the upgrade'
);

select ok(
  exists (
    select 1
    from public.participants
    where id = '72800000-0000-4000-8000-000000000010'::uuid
      and auth_user_id = '72800000-0000-4000-8000-000000000011'::uuid
  ),
  'the existing participant identifier and ownership survive Phase 7.28'
);

select ok(
  exists (
    select 1
    from public.comments
    where id = '72800000-0000-4000-8000-000000000012'::uuid
      and participant_id = '72800000-0000-4000-8000-000000000010'::uuid
      and body = 'Phase 7.27 preserved comment'
      and nickname is null
  ),
  'the existing comment identifier and anonymous nickname survive Phase 7.28'
);

select ok(
  exists (
    select 1
    from public.lecture_pdf_documents
    where document_id = 'journal-club-2026-07-23-v1'
      and document_version =
        '8c6903527b050c1db5f6b13b24bcf9108950bf8248a80205b10be6a9c63d7842'
      and pdf_sha256 =
        '8c6903527b050c1db5f6b13b24bcf9108950bf8248a80205b10be6a9c63d7842'
  ),
  'the existing PDF metadata and hashes survive Phase 7.28'
);

select ok(
  exists (
    select 1
    from public.lecture_archive_state
    where lecture_session_id = (
      select lecture_session_id
      from public.phase727_journal_club_runs
      where client_request_id =
        '72800000-0000-4000-8000-000000000003'::uuid
    )
      and status = 'retained'
  ),
  'the existing archive lifecycle row survives Phase 7.28'
);

select ok(
  exists (
    select 1
    from public.ai_usage_ledger
    where id = '72800000-0000-4000-8000-000000000005'::uuid
      and status = 'succeeded'
      and result_accepted
  ),
  'the existing accepted AI usage result survives Phase 7.28'
);

select ok(
  exists (
    select 1
    from public.lecture_summary_runs
    where id = '72800000-0000-4000-8000-000000000006'::uuid
      and status = 'stopped'
      and last_window_index = 1
  ),
  'the existing summary run identifier and terminal state survive Phase 7.28'
);

select ok(
  exists (
    select 1
    from public.lecture_ai_summaries
    where id = '72800000-0000-4000-8000-000000000008'::uuid
      and operation_id = '72800000-0000-4000-8000-000000000005'::uuid
      and status = 'published'
  ),
  'the existing AI summary result identifier survives Phase 7.28'
);

select ok(
  exists (
    select 1
    from public.summary_publications
    where summary_id = '72800000-0000-4000-8000-000000000008'::uuid
      and active_revision_id = '72800000-0000-4000-8000-000000000009'::uuid
      and visibility = 'public'
  ),
  'the existing public summary revision binding survives Phase 7.28'
);

select is(
  (select count(*)::integer from public.display_realtime_sessions),
  0,
  'upgrade creates no Display Realtime binding as a side effect'
);

select is(
  (select count(*)::integer from public.lecture_ai_master_authorizations),
  0,
  'upgrade creates no AI master authorization as a side effect'
);

select is(
  (select count(*)::integer from public.ai_master_authorization_events),
  0,
  'upgrade creates no AI authorization audit event as a side effect'
);

select ok(
  exists (
    select 1
    from public.ai_billing_grants
    where id = '72800000-0000-4000-8000-000000000004'::uuid
      and status = 'issued'
      and master_authorization_id is null
  ),
  'a pre-Phase 7.28 direct-PIN grant survives with nullable master binding'
);

select ok(
  to_regprocedure(
    'public.claim_display_realtime_session_v1(text,uuid,uuid)'
  ) is not null,
  'Display Realtime claim RPC is installed additively'
);

select ok(
  to_regprocedure(
    'public.admin_authorize_ai_master(uuid,uuid,text,text,boolean)'
  ) is not null,
  'AI master authorization RPC is installed additively'
);

select ok(
  to_regprocedure(
    'public.admin_create_phase727_journal_club_run_v1(text,text,text,uuid,uuid,uuid)'
  ) is not null,
  'the Phase 7.27 recovery RPC remains available'
);

select * from finish();
rollback;
