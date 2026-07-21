-- Phase 7.26 follow-up: converge a Worker activation that outlived its DB lease.
--
-- A Worker can publish access_version + 1 immediately before the coordinating
-- Edge Function loses its DB completion call. If the lecture then closes (or
-- the operation expires), cleanup must be able to prove which Worker
-- generation is terminal before restoring the previous manifest fence.

alter table public.lecture_pdf_publications
  add column cleanup_worker_generation integer
    check (cleanup_worker_generation between 1 and 2147483647);

-- Phase 7.26 has not been enabled in production, but keep this migration safe
-- for local databases that already applied the first Phase 7.26 migration.
-- A prepared activation is terminalized only after its upload generation was
-- fenced, so its prior generation is the cleanup binding. Other legacy rows
-- retain their current generation and remain fail-closed at the Worker.
update public.lecture_pdf_publications as publication
set cleanup_worker_generation = case
  when publication.state in ('aborted', 'expired')
    and publication.activation_operation_id is not null
    and publication.activation_target_access_version is not null
    and publication.ticket_generation > 1
    then publication.ticket_generation - 1
  else publication.ticket_generation
end
where publication.state in ('retired', 'aborted', 'expired')
  and publication.cleanup_worker_generation is null;

alter table public.lecture_pdf_publications
  add constraint lecture_pdf_publications_terminal_cleanup_generation_check
  check (
    (state in ('retired', 'aborted', 'expired'))
      = (cleanup_worker_generation is not null)
  );

alter table public.lecture_pdf_publications
  add column cleanup_exhausted_at timestamptz;

update public.lecture_pdf_publications as publication
set cleanup_exhausted_at = coalesce(
  publication.cleanup_lease_expires_at,
  publication.updated_at
)
where publication.cleanup_attempt_count = 1000
  and publication.cleanup_completed_at is null
  and publication.cleanup_exhausted_at is null;

alter table public.lecture_pdf_publications
  add constraint lecture_pdf_publications_cleanup_exhausted_check
  check (
    cleanup_exhausted_at is null
    or (
      cleanup_attempt_count = 1000
      and cleanup_completed_at is null
    )
  );

create index lecture_pdf_publications_cleanup_retryable_due_idx
  on public.lecture_pdf_publications (cleanup_after, id)
  where cleanup_completed_at is null
    and cleanup_attempt_count < 1000
    and state in ('retired', 'aborted', 'expired');

create function private.capture_pdf_publication_cleanup_binding_v1()
returns trigger
language plpgsql
volatile
security invoker
set search_path = ''
as $$
begin
  if new.state in ('retired', 'aborted', 'expired') then
    new.cleanup_worker_generation := coalesce(
      old.cleanup_worker_generation,
      old.ticket_generation
    );
  else
    new.cleanup_worker_generation := null;
  end if;
  return new;
end;
$$;

create trigger lecture_pdf_publications_capture_cleanup_binding
before update of state on public.lecture_pdf_publications
for each row execute function private.capture_pdf_publication_cleanup_binding_v1();

create function private.capture_pdf_publication_cleanup_exhaustion_v1()
returns trigger
language plpgsql
volatile
security invoker
set search_path = ''
as $$
begin
  if new.cleanup_completed_at is not null then
    new.cleanup_exhausted_at := null;
  elsif new.cleanup_attempt_count = 1000 then
    new.cleanup_exhausted_at := coalesce(
      old.cleanup_exhausted_at,
      statement_timestamp()
    );
  else
    new.cleanup_exhausted_at := null;
  end if;
  return new;
end;
$$;

create trigger lecture_pdf_publications_capture_cleanup_exhaustion
before update of cleanup_attempt_count, cleanup_completed_at
on public.lecture_pdf_publications
for each row execute function private.capture_pdf_publication_cleanup_exhaustion_v1();

create or replace function private.build_pdf_publication_result_v1(
  target_publication_id uuid
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'publication_id', publication.id,
    'client_request_id', publication.client_request_id,
    'lecture_session_id', publication.lecture_session_id,
    'lecture_public_id',
      'lecture_' || replace(lecture.pdf_public_id::text, '-', ''),
    'pdf_access_version', lecture.pdf_access_version,
    'document_id', publication.document_id,
    'document_version', publication.expected_pdf_sha256,
    'expected_pdf_sha256', publication.expected_pdf_sha256,
    'expected_byte_size', publication.expected_byte_size,
    'declared_page_count', publication.declared_page_count,
    'declared_text_char_count', publication.declared_text_char_count,
    'declared_text_sha256', publication.declared_text_sha256,
    'display_name', publication.display_name,
    'download_enabled', publication.download_enabled,
    'allowed_origin', publication.allowed_origin,
    'state', publication.state,
    'state_version', publication.state_version,
    'ticket_generation', publication.ticket_generation,
    'ticket_admin_session_id', publication.ticket_admin_session_id,
    'ticket_expires_at', publication.ticket_expires_at,
    'operation_expires_at', publication.operation_expires_at,
    'object_key',
      'pdf/' ||
      'lecture_' || replace(lecture.pdf_public_id::text, '-', '') || '/' ||
      publication.document_id || '/' ||
      publication.expected_pdf_sha256 || '/' ||
      publication.id::text || '.pdf',
    'nonce_used_at', publication.nonce_used_at,
    'worker_attempt_id', publication.worker_attempt_id,
    'upload_lease_expires_at', publication.upload_lease_expires_at,
    'actual_byte_size', publication.actual_byte_size,
    'actual_pdf_sha256', publication.actual_pdf_sha256,
    'pdf_magic_verified', publication.pdf_magic_verified,
    'r2_object_version', publication.r2_object_version,
    'r2_etag', publication.r2_etag,
    'uploaded_at', publication.uploaded_at
  ) || jsonb_build_object(
    'commit_operation_id', publication.commit_operation_id,
    'commit_lease_expires_at', publication.commit_lease_expires_at,
    'committed_manifest_version', publication.committed_manifest_version,
    'committed_manifest_access_version',
      publication.committed_manifest_access_version,
    'committed_manifest_etag', publication.committed_manifest_etag,
    'committed_at', publication.committed_at,
    'activation_operation_id', publication.activation_operation_id,
    'activation_lease_expires_at', publication.activation_lease_expires_at,
    'activation_target_access_version',
      publication.activation_target_access_version,
    'activated_manifest_version', publication.activated_manifest_version,
    'activated_manifest_etag', publication.activated_manifest_etag,
    'active_at', publication.active_at,
    'retired_at', publication.retired_at,
    'aborted_at', publication.aborted_at,
    'expired_at', publication.expired_at,
    'cleanup_after', publication.cleanup_after,
    'cleanup_claim_id', publication.cleanup_claim_id,
    'cleanup_lease_expires_at', publication.cleanup_lease_expires_at,
    'cleanup_attempt_count', publication.cleanup_attempt_count,
    'cleanup_completed_at', publication.cleanup_completed_at,
    'cleanup_exhausted_at', publication.cleanup_exhausted_at,
    'cleanup_binding_version', 1,
    'cleanup_worker_generation', publication.cleanup_worker_generation,
    'last_error_code', publication.last_error_code,
    'created_at', publication.created_at,
    'updated_at', publication.updated_at,
    'server_time', statement_timestamp()
  )
  from public.lecture_pdf_publications as publication
  join public.lecture_sessions as lecture
    on lecture.id = publication.lecture_session_id
  where publication.id = target_publication_id;
$$;

create or replace function public.claim_due_pdf_publication_cleanup_v1(
  job_limit integer default 20,
  target_worker_id text default 'pdf-publication-cleanup'
)
returns setof jsonb
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  effective_now timestamptz := statement_timestamp();
  candidate_id uuid;
  preliminary_row public.lecture_pdf_publications%rowtype;
  lecture_row public.lecture_sessions%rowtype;
  publication_row public.lecture_pdf_publications%rowtype;
  new_claim_id uuid;
  claimed_count integer := 0;
begin
  if job_limit is null
     or job_limit not between 1 and 100
     or target_worker_id is null
     or char_length(target_worker_id) not between 1 and 200
     or target_worker_id ~ '[[:cntrl:]]' then
    raise exception 'invalid PDF cleanup claim request'
      using errcode = '22023';
  end if;

  for candidate_id in
    select publication.id
    from public.lecture_pdf_publications as publication
    where publication.cleanup_attempt_count < 1000
      and (
        (
          publication.state in ('pending', 'uploaded', 'committed')
          and publication.operation_expires_at <= effective_now
        ) or (
          publication.state in ('retired', 'aborted', 'expired')
          and publication.cleanup_after <= effective_now
          and publication.cleanup_completed_at is null
          and (
            publication.cleanup_claim_id is null
            or publication.cleanup_lease_expires_at <= effective_now
          )
        )
      )
    order by coalesce(
      publication.cleanup_after,
      publication.operation_expires_at
    ), publication.id
    limit job_limit * 4
  loop
    exit when claimed_count >= job_limit;

    select publication.*
    into preliminary_row
    from public.lecture_pdf_publications as publication
    where publication.id = candidate_id;

    if not found then
      continue;
    end if;

    perform private.close_lecture_if_expired(
      preliminary_row.lecture_session_id,
      'deadline_guard',
      'pdf-publication-cleanup-claim'
    );

    select lecture.*
    into lecture_row
    from public.lecture_sessions as lecture
    where lecture.id = preliminary_row.lecture_session_id
    for update;

    select publication.*
    into publication_row
    from public.lecture_pdf_publications as publication
    where publication.id = candidate_id
      and publication.lecture_session_id = lecture_row.id
    for update skip locked;

    if not found then
      continue;
    end if;

    if publication_row.cleanup_attempt_count >= 1000 then
      continue;
    end if;

    if publication_row.state in ('pending', 'uploaded', 'committed')
       and publication_row.operation_expires_at <= effective_now then
      update public.lecture_pdf_publications as publication
      set
        state = 'expired',
        ticket_generation = least(
          publication.ticket_generation::bigint + 1,
          2147483647::bigint
        )::integer,
        upload_lease_expires_at = null,
        commit_lease_expires_at = null,
        activation_lease_expires_at = null,
        expired_at = effective_now,
        cleanup_after = effective_now,
        state_version = publication.state_version + 1,
        last_error_code = 'operation_expired',
        updated_at = effective_now
      where publication.id = candidate_id
      returning * into publication_row;

      perform private.record_pdf_publication_event_v1(
        candidate_id,
        lecture_row.id,
        'expired',
        'system',
        target_worker_id,
        preliminary_row.state,
        'expired',
        jsonb_build_object('reason', 'operation_expired')
      );
    end if;

    if publication_row.state not in ('retired', 'aborted', 'expired')
       or publication_row.cleanup_after > effective_now
       or publication_row.cleanup_completed_at is not null
       or publication_row.cleanup_attempt_count >= 1000
       or (
         publication_row.cleanup_claim_id is not null
         and publication_row.cleanup_lease_expires_at > effective_now
       ) then
      continue;
    end if;

    new_claim_id := gen_random_uuid();
    update public.lecture_pdf_publications as publication
    set
      cleanup_claim_id = new_claim_id,
      cleanup_lease_expires_at = effective_now + interval '10 minutes',
      cleanup_attempt_count = publication.cleanup_attempt_count + 1,
      state_version = publication.state_version + 1,
      updated_at = effective_now
    where publication.id = candidate_id
      and publication.cleanup_attempt_count < 1000
    returning * into publication_row;

    if not found then
      continue;
    end if;

    perform private.record_pdf_publication_event_v1(
      candidate_id,
      lecture_row.id,
      'cleanup_claimed',
      'worker',
      target_worker_id,
      publication_row.state,
      publication_row.state,
      jsonb_build_object(
        'cleanup_claim_id', new_claim_id,
        'cleanup_attempt_count', publication_row.cleanup_attempt_count,
        'cleanup_attempt_limit', 1000,
        'manual_review_if_unfinished',
          publication_row.cleanup_attempt_count = 1000
      )
    );

    claimed_count := claimed_count + 1;
    return next private.build_pdf_publication_result_v1(candidate_id);
  end loop;

  return;
end;
$$;

revoke all on function private.capture_pdf_publication_cleanup_binding_v1()
  from public, anon, authenticated, service_role;
revoke all on function private.capture_pdf_publication_cleanup_exhaustion_v1()
  from public, anon, authenticated, service_role;
revoke all on function private.build_pdf_publication_result_v1(uuid)
  from public, anon, authenticated;
revoke all on function public.claim_due_pdf_publication_cleanup_v1(integer, text)
  from public, anon, authenticated;
grant execute on function private.build_pdf_publication_result_v1(uuid)
  to service_role;
grant execute on function public.claim_due_pdf_publication_cleanup_v1(integer, text)
  to service_role;

comment on column public.lecture_pdf_publications.cleanup_worker_generation is
  'Immutable Worker upload generation captured when a publication first enters terminal cleanup state.';
comment on function private.capture_pdf_publication_cleanup_binding_v1() is
  'Captures the pre-terminal Worker generation so cleanup cannot roll back or delete another ticket generation.';
comment on column public.lecture_pdf_publications.cleanup_exhausted_at is
  'Manual-review marker set when the bounded cleanup retry budget reaches 1000 attempts.';
comment on function private.capture_pdf_publication_cleanup_exhaustion_v1() is
  'Saturates cleanup retries at 1000 without allowing a poison row to starve later due work.';
