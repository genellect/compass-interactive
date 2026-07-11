-- Milestone 3: atomic Admin lecture and poll lifecycle operations.
-- Edge Functions call these routines with the service role. Public clients
-- cannot execute them and continue to read live data through snapshot RPCs.

grant select, insert, update on public.polls to service_role;
grant select, insert on public.poll_options to service_role;
grant select on public.poll_option_totals to service_role;

create function public.admin_create_lecture(
  lecture_title text,
  lecture_code_hash text,
  lecture_code text,
  lecture_starts_at timestamptz default null,
  lecture_ends_at timestamptz default null
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  created_lecture_id uuid;
begin
  insert into public.lecture_sessions (
    title,
    code_hash,
    status,
    starts_at,
    ends_at
  ) values (
    trim(lecture_title),
    lecture_code_hash,
    'draft',
    lecture_starts_at,
    lecture_ends_at
  )
  returning id into created_lecture_id;

  insert into public.lecture_admin_codes (
    lecture_session_id,
    lecture_code
  ) values (
    created_lecture_id,
    upper(trim(lecture_code))
  );

  -- The lecture trigger normally creates this row. Keeping the upsert here
  -- makes the lifecycle contract explicit and safe if trigger order changes.
  insert into public.lecture_live_state (lecture_session_id)
  values (created_lecture_id)
  on conflict (lecture_session_id) do nothing;

  insert into public.lecture_display_state (
    lecture_session_id,
    current_pdf_page,
    display_mode
  ) values (
    created_lecture_id,
    1,
    'normal'
  )
  on conflict (lecture_session_id) do nothing;

  return created_lecture_id;
end;
$$;

create function public.admin_set_lecture_status(
  target_lecture_session_id uuid,
  target_action text,
  transition_at timestamptz default now()
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  changed_rows integer;
begin
  if target_action = 'start' then
    update public.lecture_sessions
    set
      status = 'open',
      starts_at = transition_at
    where id = target_lecture_session_id
      and status = 'draft';
    get diagnostics changed_rows = row_count;
  elsif target_action = 'close' then
    update public.lecture_sessions
    set
      status = 'closed',
      ends_at = transition_at
    where id = target_lecture_session_id
      and status = 'open';
    get diagnostics changed_rows = row_count;

    if changed_rows = 1 then
      update public.polls
      set status = 'closed'
      where lecture_session_id = target_lecture_session_id
        and status = 'open';
    end if;
  else
    raise exception 'unknown lecture action: %', target_action;
  end if;

  return changed_rows = 1;
end;
$$;

create function public.admin_create_poll(
  target_lecture_session_id uuid,
  poll_question text,
  poll_type text,
  option_labels text[]
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  created_poll_id uuid;
begin
  if not exists (
    select 1
    from public.lecture_sessions lecture
    where lecture.id = target_lecture_session_id
      and lecture.status in ('draft', 'open')
  ) then
    raise exception 'lecture is not available for poll creation';
  end if;

  if poll_type not in ('single', 'multiple') then
    raise exception 'invalid poll type';
  end if;

  if cardinality(option_labels) not between 2 and 8 then
    raise exception 'poll requires between 2 and 8 options';
  end if;

  if exists (
    select 1
    from unnest(option_labels) option_label
    where nullif(trim(option_label), '') is null
  ) then
    raise exception 'poll options cannot be empty';
  end if;

  if (
    select count(*)
    from (
      select distinct lower(trim(option_label))
      from unnest(option_labels) option_label
    ) unique_options
  ) <> cardinality(option_labels) then
    raise exception 'poll options must be unique';
  end if;

  insert into public.polls (
    lecture_session_id,
    question,
    type,
    status
  ) values (
    target_lecture_session_id,
    trim(poll_question),
    poll_type,
    'draft'
  )
  returning id into created_poll_id;

  insert into public.poll_options (
    lecture_session_id,
    poll_id,
    label,
    display_order
  )
  select
    target_lecture_session_id,
    created_poll_id,
    trim(option_label),
    option_order::integer
  from unnest(option_labels) with ordinality
    as options(option_label, option_order);

  return created_poll_id;
end;
$$;

create function public.admin_set_poll_status(
  target_lecture_session_id uuid,
  target_poll_id uuid,
  target_status text
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  changed_rows integer;
begin
  if target_status = 'open' then
    update public.polls poll
    set status = 'open'
    where poll.id = target_poll_id
      and poll.lecture_session_id = target_lecture_session_id
      and poll.status in ('draft', 'closed')
      and exists (
        select 1
        from public.lecture_sessions lecture
        where lecture.id = target_lecture_session_id
          and lecture.status = 'open'
      );
  elsif target_status = 'closed' then
    update public.polls poll
    set status = 'closed'
    where poll.id = target_poll_id
      and poll.lecture_session_id = target_lecture_session_id
      and poll.status = 'open';
  else
    raise exception 'invalid poll status: %', target_status;
  end if;

  get diagnostics changed_rows = row_count;
  return changed_rows = 1;
end;
$$;

revoke all on function public.admin_create_lecture(
  text, text, text, timestamptz, timestamptz
) from public, anon, authenticated;
revoke all on function public.admin_set_lecture_status(
  uuid, text, timestamptz
) from public, anon, authenticated;
revoke all on function public.admin_create_poll(
  uuid, text, text, text[]
) from public, anon, authenticated;
revoke all on function public.admin_set_poll_status(
  uuid, uuid, text
) from public, anon, authenticated;

grant execute on function public.admin_create_lecture(
  text, text, text, timestamptz, timestamptz
) to service_role;
grant execute on function public.admin_set_lecture_status(
  uuid, text, timestamptz
) to service_role;
grant execute on function public.admin_create_poll(
  uuid, text, text, text[]
) to service_role;
grant execute on function public.admin_set_poll_status(
  uuid, uuid, text
) to service_role;
