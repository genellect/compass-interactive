-- A legacy closed lecture can predate lecture_admin_codes. Claiming such a row
-- and joining the code only after the UPDATE leaves an invisible exporting
-- lease. Fence any current lease and keep the row recoverable if a code is
-- supplied later.
update public.lecture_archive_exports as export
set
  source_version = export.source_version
    + case when export.status = 'exporting' then 1 else 0 end,
  status = 'error',
  lease_until = null,
  next_attempt_at = statement_timestamp(),
  last_error = 'lecture_code_missing',
  updated_at = statement_timestamp()
where export.status in ('pending', 'error', 'exporting')
  and not exists (
    select 1
    from public.lecture_admin_codes as code
    where code.lecture_session_id = export.lecture_session_id
  );

create or replace function private.claim_lecture_archive_exports(
  job_limit integer default 5
)
returns table (
  lecture_session_id uuid,
  source_version bigint,
  lecture_code text,
  archive_expires_at timestamptz,
  attempt_count integer,
  payload jsonb
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  return query
  with candidates as (
    select
      export.lecture_session_id,
      export.status = 'exporting' as reclaim_expired_lease
    from public.lecture_archive_exports as export
    join public.lecture_sessions as lecture
      on lecture.id = export.lecture_session_id
    where (
        (
          export.status in ('pending', 'error')
          and export.next_attempt_at <= statement_timestamp()
        )
        or (
          export.status = 'exporting'
          and export.lease_until <= statement_timestamp()
        )
      )
      and lecture.status = 'closed'
      and lecture.archive_expires_at > statement_timestamp()
      and exists (
        select 1
        from public.lecture_admin_codes as code
        where code.lecture_session_id = export.lecture_session_id
      )
    order by
      case
        when export.status = 'exporting' then export.lease_until
        else export.next_attempt_at
      end,
      export.lecture_session_id
    for update of export skip locked
    limit least(greatest(job_limit, 1), 20)
  ),
  claimed as (
    update public.lecture_archive_exports as export
    set
      source_version = export.source_version
        + case when candidates.reclaim_expired_lease then 1 else 0 end,
      status = 'exporting',
      lease_until = statement_timestamp() + interval '10 minutes',
      attempt_count = export.attempt_count + 1,
      last_error = case
        when candidates.reclaim_expired_lease then 'export_lease_expired'
        else export.last_error
      end,
      updated_at = statement_timestamp()
    from candidates
    where export.lecture_session_id = candidates.lecture_session_id
    returning
      export.lecture_session_id,
      export.source_version,
      export.attempt_count
  )
  select
    claimed.lecture_session_id,
    claimed.source_version,
    code.lecture_code,
    lecture.archive_expires_at,
    claimed.attempt_count,
    private.build_public_lecture_archive_v1(claimed.lecture_session_id)
  from claimed
  join public.lecture_sessions as lecture
    on lecture.id = claimed.lecture_session_id
  join public.lecture_admin_codes as code
    on code.lecture_session_id = claimed.lecture_session_id;
end;
$$;

comment on function private.claim_lecture_archive_exports(integer) is
  'Claims only closed lectures with an access code, preventing invisible export leases for legacy rows.';
