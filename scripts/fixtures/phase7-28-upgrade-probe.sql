do $$
declare
  admin_session_id constant uuid :=
    '72800000-0000-4000-8000-000000000001';
  admin_auth_user_id constant uuid :=
    '72800000-0000-4000-8000-000000000002';
  request_id constant uuid :=
    '72800000-0000-4000-8000-000000000003';
  lecture_id uuid;
  created jsonb;
begin
  insert into public.admin_sessions (
    id,
    token_hash,
    auth_user_id,
    pin_version_hash,
    issued_at,
    last_seen_at,
    idle_expires_at,
    expires_at
  ) values (
    admin_session_id,
    repeat('7', 64),
    admin_auth_user_id,
    repeat('8', 64),
    statement_timestamp(),
    statement_timestamp(),
    statement_timestamp() + interval '30 minutes',
    statement_timestamp() + interval '8 hours'
  );

  created := public.admin_create_phase727_journal_club_run_v1(
    'rehearsal',
    encode(
      extensions.digest(convert_to('728280', 'UTF8'), 'sha256'),
      'hex'
    ),
    '728280',
    request_id,
    admin_session_id,
    admin_auth_user_id
  );

  if coalesce((created ->> 'created')::boolean, false) is not true then
    raise exception 'Phase 7.28 upgrade probe could not create its Phase 7.27 row';
  end if;

  lecture_id := (created ->> 'lecture_session_id')::uuid;

  insert into public.participants (
    id,
    lecture_session_id,
    participant_key,
    auth_user_id,
    last_seen_at
  ) values (
    '72800000-0000-4000-8000-000000000010',
    lecture_id,
    'phase728-upgrade-participant',
    '72800000-0000-4000-8000-000000000011',
    statement_timestamp()
  );

  insert into public.comments (
    id,
    lecture_session_id,
    participant_id,
    body,
    nickname
  ) values (
    '72800000-0000-4000-8000-000000000012',
    lecture_id,
    '72800000-0000-4000-8000-000000000010',
    'Phase 7.27 preserved comment',
    null
  );

  perform public.admin_register_pdf_document(
    lecture_id,
    'journal-club-2026-07-23-v1',
    '8c6903527b050c1db5f6b13b24bcf9108950bf8248a80205b10be6a9c63d7842',
    1,
    'Phase 7.27 Preserved PDF',
    34,
    5816208,
    100,
    '8c6903527b050c1db5f6b13b24bcf9108950bf8248a80205b10be6a9c63d7842',
    repeat('e', 64),
    true
  );

  insert into public.lecture_archive_state (
    lecture_session_id,
    status,
    eligible_at
  ) values (
    lecture_id,
    'retained',
    statement_timestamp() + interval '30 days'
  );

  insert into public.ai_usage_ledger (
    id,
    lecture_session_id,
    feature,
    idempotency_key,
    status,
    requested_by_actor,
    actual_microusd,
    actual_input_tokens,
    actual_output_tokens,
    result_accepted,
    finished_at
  ) values (
    '72800000-0000-4000-8000-000000000005',
    lecture_id,
    'summaries',
    'phase728-upgrade-summary-operation',
    'succeeded',
    'admin-session:phase727-upgrade-probe',
    10,
    10,
    10,
    true,
    statement_timestamp()
  );

  insert into public.lecture_summary_runs (
    id,
    lecture_session_id,
    actor_id,
    token_hash,
    status,
    started_at,
    expires_at,
    stopped_at,
    stop_reason,
    last_window_index
  ) values (
    '72800000-0000-4000-8000-000000000006',
    lecture_id,
    'admin-session:phase727-upgrade-probe',
    repeat('a', 64),
    'stopped',
    statement_timestamp() - interval '6 minutes',
    statement_timestamp() + interval '10 minutes',
    statement_timestamp(),
    'upgrade_probe',
    1
  );

  insert into public.lecture_summary_windows (
    id,
    lecture_session_id,
    run_id,
    window_index,
    window_start,
    window_end,
    prompt_version,
    status,
    attempt_count,
    source_hashes,
    source_coverage
  ) values (
    '72800000-0000-4000-8000-000000000007',
    lecture_id,
    '72800000-0000-4000-8000-000000000006',
    1,
    statement_timestamp() - interval '10 minutes',
    statement_timestamp() - interval '5 minutes',
    'phase7-28-upgrade-probe',
    'succeeded',
    1,
    '{"pdf":"preserved"}'::jsonb,
    '{"pdf":true}'::jsonb
  );

  insert into public.lecture_ai_summaries (
    id,
    lecture_session_id,
    window_id,
    operation_id,
    model_id,
    prompt_version,
    ai_output,
    quality_result,
    status
  ) values (
    '72800000-0000-4000-8000-000000000008',
    lecture_id,
    '72800000-0000-4000-8000-000000000007',
    '72800000-0000-4000-8000-000000000005',
    'phase7-28-upgrade-probe-model',
    'phase7-28-upgrade-probe',
    '{"bullets":["preserved"]}'::jsonb,
    '{"accepted":true}'::jsonb,
    'published'
  );

  insert into public.lecture_ai_summary_revisions (
    id,
    summary_id,
    revision_number,
    body,
    author_type
  ) values (
    '72800000-0000-4000-8000-000000000009',
    '72800000-0000-4000-8000-000000000008',
    1,
    '{"bullets":["preserved"]}'::jsonb,
    'ai'
  );

  insert into public.summary_publications (
    summary_id,
    lecture_session_id,
    active_revision_id,
    visibility,
    review_state,
    published_at
  ) values (
    '72800000-0000-4000-8000-000000000008',
    lecture_id,
    '72800000-0000-4000-8000-000000000009',
    'public',
    'ai_unreviewed',
    statement_timestamp()
  );

  insert into public.ai_billing_grants (
    id,
    lecture_session_id,
    actor_id,
    actions,
    nonce_hash,
    expires_at
  ) values (
    '72800000-0000-4000-8000-000000000004',
    lecture_id,
    'admin-session:phase727-upgrade-probe',
    array['summaries']::text[],
    repeat('9', 64),
    statement_timestamp() + interval '10 minutes'
  );
end;
$$;
