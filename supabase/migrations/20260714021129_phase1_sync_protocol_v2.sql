-- Phase 1: split shared live data from participant-owned state.
--
-- This is an expand-only migration. The Phase 0 snapshot RPC remains available
-- until every deployed frontend has moved behind the Phase 1 feature flag.

alter table public.lecture_live_state
  add column lecture_version bigint not null default 0
    check (lecture_version >= 0),
  add column caption_version bigint not null default 0
    check (caption_version >= 0),
  add column summaries_version bigint not null default 0
    check (summaries_version >= 0),
  add column pdf_version bigint not null default 0
    check (pdf_version >= 0);

update public.lecture_live_state
set
  lecture_version = state_version,
  pdf_version = display_version;

-- Keep the legacy aggregate versions current while introducing the seven
-- section-specific Phase 1 versions.
create or replace function private.bump_lecture_live_state(
  target_lecture_session_id uuid,
  target_section text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if target_section not in (
    'state',
    'lecture',
    'caption',
    'comments',
    'likes',
    'polls',
    'summaries',
    'display',
    'pdf'
  ) then
    raise exception 'unknown live-state section: %', target_section;
  end if;

  insert into public.lecture_live_state as live (
    lecture_session_id,
    state_version,
    comments_version,
    likes_version,
    polls_version,
    display_version,
    lecture_version,
    caption_version,
    summaries_version,
    pdf_version,
    updated_at
  )
  values (
    target_lecture_session_id,
    1,
    case when target_section = 'comments' then 1 else 0 end,
    case when target_section = 'likes' then 1 else 0 end,
    case when target_section = 'polls' then 1 else 0 end,
    case when target_section in ('display', 'pdf') then 1 else 0 end,
    case when target_section in ('state', 'lecture') then 1 else 0 end,
    case when target_section = 'caption' then 1 else 0 end,
    case when target_section = 'summaries' then 1 else 0 end,
    case when target_section in ('display', 'pdf') then 1 else 0 end,
    now()
  )
  on conflict (lecture_session_id) do update
  set
    state_version = live.state_version + 1,
    comments_version = live.comments_version
      + case when target_section = 'comments' then 1 else 0 end,
    likes_version = live.likes_version
      + case when target_section = 'likes' then 1 else 0 end,
    polls_version = live.polls_version
      + case when target_section = 'polls' then 1 else 0 end,
    display_version = live.display_version
      + case when target_section in ('display', 'pdf') then 1 else 0 end,
    lecture_version = live.lecture_version
      + case when target_section in ('state', 'lecture') then 1 else 0 end,
    caption_version = live.caption_version
      + case when target_section = 'caption' then 1 else 0 end,
    summaries_version = live.summaries_version
      + case when target_section = 'summaries' then 1 else 0 end,
    pdf_version = live.pdf_version
      + case when target_section in ('display', 'pdf') then 1 else 0 end,
    updated_at = now();
end;
$$;

create or replace function private.sync_legacy_display_live_state()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.lecture_live_state as live (
    lecture_session_id,
    current_pdf_page,
    display_mode,
    state_version,
    display_version,
    pdf_version,
    updated_at
  )
  values (
    new.lecture_session_id,
    new.current_pdf_page,
    new.display_mode,
    1,
    1,
    1,
    now()
  )
  on conflict (lecture_session_id) do update
  set
    current_pdf_page = excluded.current_pdf_page,
    display_mode = excluded.display_mode,
    state_version = live.state_version + 1,
    display_version = live.display_version + 1,
    pdf_version = live.pdf_version + 1,
    updated_at = now()
  where (live.current_pdf_page, live.display_mode)
    is distinct from (excluded.current_pdf_page, excluded.display_mode);

  return new;
end;
$$;

create or replace function public.admin_update_pdf_display(
  target_lecture_session_id uuid,
  target_pdf_document_id text,
  target_current_pdf_page integer,
  target_display_mode text
)
returns table (
  lecture_session_id uuid,
  pdf_document_id text,
  current_pdf_page integer,
  display_mode text,
  display_version bigint,
  state_version bigint,
  updated_at timestamptz
)
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if target_pdf_document_id is not null
     and target_pdf_document_id !~ '^[a-z0-9][a-z0-9-]{0,63}$' then
    raise exception 'Invalid PDF document ID.';
  end if;

  if target_current_pdf_page < 1 then
    raise exception 'PDF page must be greater than or equal to 1.';
  end if;

  if target_pdf_document_id is null and target_current_pdf_page <> 1 then
    raise exception 'A lecture without a PDF must remain on page 1.';
  end if;

  if target_display_mode not in ('normal', 'presentation', 'slideOnly') then
    raise exception 'Invalid display mode.';
  end if;

  return query
  update public.lecture_live_state as live
  set
    pdf_document_id = target_pdf_document_id,
    current_pdf_page = target_current_pdf_page,
    display_mode = target_display_mode,
    display_version = live.display_version + 1,
    pdf_version = live.pdf_version + 1,
    state_version = live.state_version + 1,
    updated_at = now()
  where live.lecture_session_id = target_lecture_session_id
    and exists (
      select 1
      from public.lecture_sessions as lecture
      where lecture.id = target_lecture_session_id
        and lecture.status <> 'closed'
    )
    and (live.pdf_document_id, live.current_pdf_page, live.display_mode)
      is distinct from (
        target_pdf_document_id,
        target_current_pdf_page,
        target_display_mode
      )
  returning
    live.lecture_session_id,
    live.pdf_document_id,
    live.current_pdf_page,
    live.display_mode,
    live.display_version,
    live.state_version,
    live.updated_at;

  if found then
    return;
  end if;

  return query
  select
    live.lecture_session_id,
    live.pdf_document_id,
    live.current_pdf_page,
    live.display_mode,
    live.display_version,
    live.state_version,
    live.updated_at
  from public.lecture_live_state as live
  join public.lecture_sessions as lecture
    on lecture.id = live.lecture_session_id
  where live.lecture_session_id = target_lecture_session_id
    and lecture.status <> 'closed';
end;
$$;

create function private.can_read_lecture_v2(
  target_lecture_session_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null
    and exists (
      select 1
      from public.lecture_sessions as lecture
      where lecture.id = target_lecture_session_id
        and (
          private.is_lecture_open(lecture.id)
          or exists (
            select 1
            from public.participants as participant
            where participant.lecture_session_id = lecture.id
              and participant.auth_user_id = (select auth.uid())
          )
        )
    );
$$;

create function private.get_lecture_public_snapshot_v2(
  target_lecture_session_id uuid,
  known_lecture_version bigint default null,
  known_caption_version bigint default null,
  known_comments_version bigint default null,
  known_likes_version bigint default null,
  known_polls_version bigint default null,
  known_summaries_version bigint default null,
  known_pdf_version bigint default null,
  comment_cursor_created_at timestamptz default null,
  comment_cursor_id uuid default null,
  comment_limit integer default 100
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  lecture_row public.lecture_sessions%rowtype;
  live_row public.lecture_live_state%rowtype;
  effective_comment_limit integer := least(greatest(comment_limit, 1), 100);
  comments_payload jsonb;
  comments_items jsonb := '[]'::jsonb;
  comments_has_more boolean := false;
  comments_has_older boolean := false;
  likes_payload jsonb;
  polls_payload jsonb;
  changed_payload jsonb := '{}'::jsonb;
begin
  if not private.can_read_lecture_v2(target_lecture_session_id) then
    return null;
  end if;

  select *
  into lecture_row
  from public.lecture_sessions as lecture
  where lecture.id = target_lecture_session_id;

  if not found then
    return null;
  end if;

  select *
  into live_row
  from public.lecture_live_state as live
  where live.lecture_session_id = target_lecture_session_id;

  if not found then
    live_row.lecture_session_id := target_lecture_session_id;
    live_row.current_pdf_page := 1;
    live_row.display_mode := 'normal';
    live_row.state_version := 0;
    live_row.comments_version := 0;
    live_row.likes_version := 0;
    live_row.polls_version := 0;
    live_row.display_version := 0;
    live_row.lecture_version := 0;
    live_row.caption_version := 0;
    live_row.summaries_version := 0;
    live_row.pdf_version := 0;
    live_row.updated_at := lecture_row.updated_at;
  end if;

  if known_lecture_version is distinct from live_row.lecture_version then
    changed_payload := changed_payload || jsonb_build_object(
      'lecture',
      jsonb_build_object(
        'lecture_session_id', lecture_row.id,
        'title', lecture_row.title,
        'status', lecture_row.status,
        'starts_at', lecture_row.starts_at,
        'ends_at', lecture_row.ends_at
      )
    );
  end if;

  if known_caption_version is distinct from live_row.caption_version then
    changed_payload := changed_payload || jsonb_build_object('caption', null);
  end if;

  if known_comments_version is distinct from live_row.comments_version then
    if comment_cursor_created_at is null or comment_cursor_id is null then
      select count(*) > effective_comment_limit
      into comments_has_older
      from (
        select 1
        from public.comments as comment
        where comment.lecture_session_id = target_lecture_session_id
          and comment.status = 'visible'
        order by comment.created_at desc, comment.id desc
        limit effective_comment_limit + 1
      ) as candidates;

      select coalesce(
        jsonb_agg(
          jsonb_build_object(
            'id', comment.id,
            'lecture_session_id', comment.lecture_session_id,
            'body', comment.body,
            'status', comment.status,
            'is_pinned', comment.is_pinned,
            'created_at', comment.created_at
          ) order by comment.created_at desc, comment.id desc
        ),
        '[]'::jsonb
      )
      into comments_items
      from (
        select *
        from public.comments as candidate
        where candidate.lecture_session_id = target_lecture_session_id
          and candidate.status = 'visible'
        order by candidate.created_at desc, candidate.id desc
        limit effective_comment_limit
      ) as comment;

      comments_payload := jsonb_build_object(
        'mode', 'initial',
        'items', comments_items,
        'has_more', false,
        'has_older', comments_has_older
      );
    else
      select count(*) > effective_comment_limit
      into comments_has_more
      from (
        select 1
        from public.comments as comment
        where comment.lecture_session_id = target_lecture_session_id
          and comment.status = 'visible'
          and (comment.created_at, comment.id)
            > (comment_cursor_created_at, comment_cursor_id)
        order by comment.created_at, comment.id
        limit effective_comment_limit + 1
      ) as candidates;

      select coalesce(
        jsonb_agg(
          jsonb_build_object(
            'id', comment.id,
            'lecture_session_id', comment.lecture_session_id,
            'body', comment.body,
            'status', comment.status,
            'is_pinned', comment.is_pinned,
            'created_at', comment.created_at
          ) order by comment.created_at, comment.id
        ),
        '[]'::jsonb
      )
      into comments_items
      from (
        select *
        from public.comments as candidate
        where candidate.lecture_session_id = target_lecture_session_id
          and candidate.status = 'visible'
          and (candidate.created_at, candidate.id)
            > (comment_cursor_created_at, comment_cursor_id)
        order by candidate.created_at, candidate.id
        limit effective_comment_limit
      ) as comment;

      comments_payload := jsonb_build_object(
        'mode', 'delta',
        'items', comments_items,
        'has_more', comments_has_more,
        'has_older', false
      );
    end if;

    changed_payload := changed_payload
      || jsonb_build_object('comments', comments_payload);
  end if;

  if known_likes_version is distinct from live_row.likes_version then
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'comment_id', comment.id,
          'like_count', coalesce(total.like_count, 0)
        ) order by comment.created_at desc, comment.id desc
      ),
      '[]'::jsonb
    )
    into likes_payload
    from (
      select candidate.*
      from public.comments as candidate
      where candidate.lecture_session_id = target_lecture_session_id
        and candidate.status = 'visible'
      order by candidate.created_at desc, candidate.id desc
      limit 100
    ) as comment
    left join public.comment_like_totals as total
      on total.lecture_session_id = comment.lecture_session_id
     and total.comment_id = comment.id;

    changed_payload := changed_payload
      || jsonb_build_object('likes', likes_payload);
  end if;

  if known_polls_version is distinct from live_row.polls_version then
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'id', poll.id,
          'lecture_session_id', poll.lecture_session_id,
          'question', poll.question,
          'type', poll.type,
          'status', poll.status,
          'created_at', poll.created_at,
          'options', coalesce((
            select jsonb_agg(
              jsonb_build_object(
                'id', option.id,
                'poll_id', option.poll_id,
                'label', option.label,
                'display_order', option.display_order,
                'response_count', coalesce(total.response_count, 0)
              ) order by option.display_order, option.id
            )
            from public.poll_options as option
            left join public.poll_option_totals as total
              on total.lecture_session_id = option.lecture_session_id
             and total.poll_id = option.poll_id
             and total.option_id = option.id
            where option.poll_id = poll.id
              and option.lecture_session_id = poll.lecture_session_id
          ), '[]'::jsonb)
        ) order by poll.created_at, poll.id
      ),
      '[]'::jsonb
    )
    into polls_payload
    from public.polls as poll
    where poll.lecture_session_id = target_lecture_session_id
      and poll.status = 'open';

    changed_payload := changed_payload
      || jsonb_build_object('polls', polls_payload);
  end if;

  if known_summaries_version is distinct from live_row.summaries_version then
    changed_payload := changed_payload || jsonb_build_object(
      'summaries',
      '[]'::jsonb
    );
  end if;

  if known_pdf_version is distinct from live_row.pdf_version then
    changed_payload := changed_payload || jsonb_build_object(
      'pdf',
      jsonb_build_object(
        'lecture_session_id', live_row.lecture_session_id,
        'pdf_document_id', live_row.pdf_document_id,
        'current_pdf_page', live_row.current_pdf_page,
        'display_mode', live_row.display_mode,
        'updated_at', live_row.updated_at
      )
    );
  end if;

  return jsonb_build_object(
    'contract_version', 2,
    'server_time', statement_timestamp(),
    'versions', jsonb_build_object(
      'lecture', live_row.lecture_version,
      'caption', live_row.caption_version,
      'comments', live_row.comments_version,
      'likes', live_row.likes_version,
      'polls', live_row.polls_version,
      'summaries', live_row.summaries_version,
      'pdf', live_row.pdf_version
    ),
    'changed', changed_payload
  );
end;
$$;

create function private.get_lecture_participant_state_v2(
  target_lecture_session_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  request_user_id uuid := (select auth.uid());
  participant_row public.participants%rowtype;
  lecture_status text;
  liked_comment_ids jsonb;
  participant_poll_responses jsonb;
begin
  if request_user_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  select participant.*
  into participant_row
  from public.participants as participant
  where participant.lecture_session_id = target_lecture_session_id
    and participant.auth_user_id = request_user_id
  limit 1;

  if not found then
    return null;
  end if;

  select lecture.status
  into lecture_status
  from public.lecture_sessions as lecture
  where lecture.id = target_lecture_session_id;

  select coalesce(jsonb_agg(owned.comment_id order by owned.created_at), '[]'::jsonb)
  into liked_comment_ids
  from (
    select like_row.comment_id, like_row.created_at
    from public.comment_likes as like_row
    join public.comments as comment
      on comment.id = like_row.comment_id
     and comment.lecture_session_id = like_row.lecture_session_id
    where like_row.lecture_session_id = target_lecture_session_id
      and like_row.participant_id = participant_row.id
      and comment.status = 'visible'
    order by like_row.created_at desc
    limit 500
  ) as owned;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'poll_id', response.poll_id,
        'option_ids', response.option_ids,
        'created_at', response.created_at
      ) order by response.created_at, response.id
    ),
    '[]'::jsonb
  )
  into participant_poll_responses
  from public.poll_responses as response
  join public.polls as poll
    on poll.id = response.poll_id
   and poll.lecture_session_id = response.lecture_session_id
  where response.lecture_session_id = target_lecture_session_id
    and response.participant_id = participant_row.id
    and poll.status = 'open';

  return jsonb_build_object(
    'contract_version', 2,
    'server_time', statement_timestamp(),
    'membership', jsonb_build_object(
      'participant_id', participant_row.id,
      'joined_at', participant_row.joined_at,
      'last_seen_at', participant_row.last_seen_at
    ),
    'commenting', jsonb_build_object(
      'allowed', lecture_status = 'open',
      'max_length', 120,
      'next_allowed_at', null
    ),
    'liked_comment_ids', liked_comment_ids,
    'poll_responses', participant_poll_responses
  );
end;
$$;

create function private.get_lecture_comment_history_v2(
  target_lecture_session_id uuid,
  before_created_at timestamptz,
  before_comment_id uuid,
  history_limit integer default 50
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  effective_limit integer := least(greatest(history_limit, 1), 100);
  history_items jsonb;
  has_older boolean := false;
begin
  if not private.can_read_lecture_v2(target_lecture_session_id) then
    return null;
  end if;

  if (before_created_at is null) <> (before_comment_id is null) then
    raise exception 'both history cursor values are required';
  end if;

  select count(*) > effective_limit
  into has_older
  from (
    select 1
    from public.comments as comment
    where comment.lecture_session_id = target_lecture_session_id
      and comment.status = 'visible'
      and (
        before_created_at is null
        or (comment.created_at, comment.id)
          < (before_created_at, before_comment_id)
      )
    order by comment.created_at desc, comment.id desc
    limit effective_limit + 1
  ) as candidates;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', comment.id,
        'lecture_session_id', comment.lecture_session_id,
        'body', comment.body,
        'status', comment.status,
        'is_pinned', comment.is_pinned,
        'created_at', comment.created_at,
        'like_count', coalesce(total.like_count, 0)
      ) order by comment.created_at desc, comment.id desc
    ),
    '[]'::jsonb
  )
  into history_items
  from (
    select *
    from public.comments as candidate
    where candidate.lecture_session_id = target_lecture_session_id
      and candidate.status = 'visible'
      and (
        before_created_at is null
        or (candidate.created_at, candidate.id)
          < (before_created_at, before_comment_id)
      )
    order by candidate.created_at desc, candidate.id desc
    limit effective_limit
  ) as comment
  left join public.comment_like_totals as total
    on total.lecture_session_id = comment.lecture_session_id
   and total.comment_id = comment.id;

  return jsonb_build_object(
    'contract_version', 2,
    'server_time', statement_timestamp(),
    'items', history_items,
    'has_older', has_older
  );
end;
$$;

create function public.get_lecture_public_snapshot_v2(
  target_lecture_session_id uuid,
  known_lecture_version bigint default null,
  known_caption_version bigint default null,
  known_comments_version bigint default null,
  known_likes_version bigint default null,
  known_polls_version bigint default null,
  known_summaries_version bigint default null,
  known_pdf_version bigint default null,
  comment_cursor_created_at timestamptz default null,
  comment_cursor_id uuid default null,
  comment_limit integer default 100
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select private.get_lecture_public_snapshot_v2(
    target_lecture_session_id,
    known_lecture_version,
    known_caption_version,
    known_comments_version,
    known_likes_version,
    known_polls_version,
    known_summaries_version,
    known_pdf_version,
    comment_cursor_created_at,
    comment_cursor_id,
    comment_limit
  );
$$;

create function public.get_lecture_participant_state_v2(
  target_lecture_session_id uuid
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select private.get_lecture_participant_state_v2(
    target_lecture_session_id
  );
$$;

create function public.get_lecture_comment_history_v2(
  target_lecture_session_id uuid,
  before_created_at timestamptz,
  before_comment_id uuid,
  history_limit integer default 50
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select private.get_lecture_comment_history_v2(
    target_lecture_session_id,
    before_created_at,
    before_comment_id,
    history_limit
  );
$$;

revoke all on function private.can_read_lecture_v2(uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.get_lecture_public_snapshot_v2(
  uuid, bigint, bigint, bigint, bigint, bigint, bigint, bigint,
  timestamptz, uuid, integer
) from public, anon, authenticated, service_role;
revoke all on function private.get_lecture_participant_state_v2(uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.get_lecture_comment_history_v2(
  uuid, timestamptz, uuid, integer
) from public, anon, authenticated, service_role;

revoke all on function public.get_lecture_public_snapshot_v2(
  uuid, bigint, bigint, bigint, bigint, bigint, bigint, bigint,
  timestamptz, uuid, integer
) from public, anon, authenticated, service_role;
revoke all on function public.get_lecture_participant_state_v2(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.get_lecture_comment_history_v2(
  uuid, timestamptz, uuid, integer
) from public, anon, authenticated, service_role;

grant execute on function public.get_lecture_public_snapshot_v2(
  uuid, bigint, bigint, bigint, bigint, bigint, bigint, bigint,
  timestamptz, uuid, integer
) to authenticated;
grant execute on function public.get_lecture_participant_state_v2(uuid)
  to authenticated;
grant execute on function public.get_lecture_comment_history_v2(
  uuid, timestamptz, uuid, integer
) to authenticated;

grant execute on function private.get_lecture_public_snapshot_v2(
  uuid, bigint, bigint, bigint, bigint, bigint, bigint, bigint,
  timestamptz, uuid, integer
) to authenticated;
grant execute on function private.get_lecture_participant_state_v2(uuid)
  to authenticated;
grant execute on function private.get_lecture_comment_history_v2(
  uuid, timestamptz, uuid, integer
) to authenticated;

comment on function public.get_lecture_public_snapshot_v2(
  uuid, bigint, bigint, bigint, bigint, bigint, bigint, bigint,
  timestamptz, uuid, integer
) is 'Phase 1 shared live-state contract. It never returns participant-owned state.';
comment on function public.get_lecture_participant_state_v2(uuid)
  is 'Phase 1 participant-owned state derived only from auth.uid().';
comment on function public.get_lecture_comment_history_v2(
  uuid, timestamptz, uuid, integer
) is 'Phase 1 cursor-paginated public comment history.';
