-- Milestone 2: consolidate live lecture reads behind one versioned snapshot.
-- This migration is additive and keeps lecture_display_state as a compatibility
-- write target until the Admin lifecycle migration switches the Edge Function.

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table public.lecture_live_state (
  lecture_session_id uuid primary key
    references public.lecture_sessions(id) on delete cascade,
  current_pdf_page integer not null default 1 check (current_pdf_page >= 1),
  display_mode text not null default 'normal'
    check (display_mode in ('normal', 'presentation', 'slideOnly')),
  state_version bigint not null default 0 check (state_version >= 0),
  comments_version bigint not null default 0 check (comments_version >= 0),
  likes_version bigint not null default 0 check (likes_version >= 0),
  polls_version bigint not null default 0 check (polls_version >= 0),
  display_version bigint not null default 0 check (display_version >= 0),
  updated_at timestamptz not null default now()
);

create table public.comment_like_totals (
  lecture_session_id uuid not null,
  comment_id uuid not null,
  like_count bigint not null default 0 check (like_count >= 0),
  updated_at timestamptz not null default now(),
  primary key (lecture_session_id, comment_id),
  foreign key (comment_id, lecture_session_id)
    references public.comments(id, lecture_session_id) on delete cascade
);

create table public.poll_option_totals (
  lecture_session_id uuid not null,
  poll_id uuid not null,
  option_id uuid not null,
  response_count bigint not null default 0 check (response_count >= 0),
  updated_at timestamptz not null default now(),
  primary key (lecture_session_id, poll_id, option_id),
  foreign key (poll_id, lecture_session_id)
    references public.polls(id, lecture_session_id) on delete cascade,
  foreign key (option_id, poll_id)
    references public.poll_options(id, poll_id) on delete cascade
);

create index comments_live_cursor_idx
  on public.comments (lecture_session_id, status, created_at, id);
create index comment_like_totals_comment_idx
  on public.comment_like_totals (comment_id, lecture_session_id);
create index poll_option_totals_option_idx
  on public.poll_option_totals (option_id, poll_id);
create index poll_option_totals_poll_idx
  on public.poll_option_totals (poll_id, lecture_session_id);

alter table public.lecture_live_state enable row level security;
alter table public.comment_like_totals enable row level security;
alter table public.poll_option_totals enable row level security;

revoke all on public.lecture_live_state from public, anon, authenticated;
revoke all on public.comment_like_totals from public, anon, authenticated;
revoke all on public.poll_option_totals from public, anon, authenticated;
grant select, insert, update on public.lecture_live_state to service_role;
grant select, insert, update on public.comment_like_totals to service_role;
grant select, insert, update on public.poll_option_totals to service_role;

-- Existing remote data becomes version zero. A client with no known version
-- receives every section once, so no artificial version bump is required.
insert into public.lecture_live_state (
  lecture_session_id,
  current_pdf_page,
  display_mode,
  updated_at
)
select
  lecture.id,
  coalesce(display.current_pdf_page, 1),
  coalesce(display.display_mode, 'normal'),
  coalesce(display.updated_at, lecture.updated_at)
from public.lecture_sessions lecture
left join public.lecture_display_state display
  on display.lecture_session_id = lecture.id
on conflict (lecture_session_id) do nothing;

insert into public.comment_like_totals (
  lecture_session_id,
  comment_id,
  like_count
)
select
  likes.lecture_session_id,
  likes.comment_id,
  count(*)::bigint
from public.comment_likes likes
group by likes.lecture_session_id, likes.comment_id
on conflict (lecture_session_id, comment_id) do update
set
  like_count = excluded.like_count,
  updated_at = now();

insert into public.poll_option_totals (
  lecture_session_id,
  poll_id,
  option_id,
  response_count
)
select
  response.lecture_session_id,
  response.poll_id,
  selected.option_id,
  count(*)::bigint
from public.poll_responses response
cross join lateral unnest(response.option_ids) as selected(option_id)
group by response.lecture_session_id, response.poll_id, selected.option_id
on conflict (lecture_session_id, poll_id, option_id) do update
set
  response_count = excluded.response_count,
  updated_at = now();

create function private.bump_lecture_live_state(
  target_lecture_session_id uuid,
  target_section text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if target_section not in ('state', 'comments', 'likes', 'polls', 'display') then
    raise exception 'unknown live-state section: %', target_section;
  end if;

  insert into public.lecture_live_state (
    lecture_session_id,
    state_version,
    comments_version,
    likes_version,
    polls_version,
    display_version,
    updated_at
  )
  values (
    target_lecture_session_id,
    1,
    case when target_section = 'comments' then 1 else 0 end,
    case when target_section = 'likes' then 1 else 0 end,
    case when target_section = 'polls' then 1 else 0 end,
    case when target_section = 'display' then 1 else 0 end,
    now()
  )
  on conflict (lecture_session_id) do update
  set
    state_version = lecture_live_state.state_version + 1,
    comments_version = lecture_live_state.comments_version
      + case when target_section = 'comments' then 1 else 0 end,
    likes_version = lecture_live_state.likes_version
      + case when target_section = 'likes' then 1 else 0 end,
    polls_version = lecture_live_state.polls_version
      + case when target_section = 'polls' then 1 else 0 end,
    display_version = lecture_live_state.display_version
      + case when target_section = 'display' then 1 else 0 end,
    updated_at = now();
end;
$$;

create function private.track_lecture_session_live_state()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.lecture_live_state (lecture_session_id)
    values (new.id)
    on conflict (lecture_session_id) do nothing;
  elsif (old.title, old.status, old.starts_at, old.ends_at)
    is distinct from (new.title, new.status, new.starts_at, new.ends_at) then
    perform private.bump_lecture_live_state(new.id, 'state');
  end if;

  return new;
end;
$$;

create function private.track_comment_live_state()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.bump_lecture_live_state(
    case when tg_op = 'DELETE'
      then old.lecture_session_id
      else new.lecture_session_id
    end,
    'comments'
  );

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create function private.track_comment_like_total()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.comment_like_totals (
    lecture_session_id,
    comment_id,
    like_count,
    updated_at
  )
  values (new.lecture_session_id, new.comment_id, 1, now())
  on conflict (lecture_session_id, comment_id) do update
  set
    like_count = comment_like_totals.like_count + 1,
    updated_at = now();

  perform private.bump_lecture_live_state(new.lecture_session_id, 'likes');
  return new;
end;
$$;

create function private.track_poll_response_total()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.poll_option_totals (
    lecture_session_id,
    poll_id,
    option_id,
    response_count,
    updated_at
  )
  select
    new.lecture_session_id,
    new.poll_id,
    selected.option_id,
    1,
    now()
  from unnest(new.option_ids) as selected(option_id)
  on conflict (lecture_session_id, poll_id, option_id) do update
  set
    response_count = poll_option_totals.response_count + 1,
    updated_at = now();

  perform private.bump_lecture_live_state(new.lecture_session_id, 'polls');
  return new;
end;
$$;

create function private.track_poll_definition_live_state()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_lecture_session_id uuid;
begin
  target_lecture_session_id := case when tg_op = 'DELETE'
    then old.lecture_session_id
    else new.lecture_session_id
  end;

  perform private.bump_lecture_live_state(target_lecture_session_id, 'polls');
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create function private.sync_legacy_display_live_state()
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
    updated_at
  )
  values (
    new.lecture_session_id,
    new.current_pdf_page,
    new.display_mode,
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
    updated_at = now()
  where (live.current_pdf_page, live.display_mode)
    is distinct from (excluded.current_pdf_page, excluded.display_mode);

  return new;
end;
$$;

create trigger track_lecture_session_live_state
after insert or update of title, status, starts_at, ends_at
on public.lecture_sessions
for each row execute function private.track_lecture_session_live_state();

create trigger track_comment_live_state
after insert or update of body, status, is_pinned or delete on public.comments
for each row execute function private.track_comment_live_state();

create trigger track_comment_like_total
after insert on public.comment_likes
for each row execute function private.track_comment_like_total();

create trigger track_poll_response_total
after insert on public.poll_responses
for each row execute function private.track_poll_response_total();

create trigger track_poll_live_state
after insert or update or delete on public.polls
for each row execute function private.track_poll_definition_live_state();

create trigger track_poll_option_live_state
after insert or update or delete on public.poll_options
for each row execute function private.track_poll_definition_live_state();

create trigger sync_legacy_display_live_state
after insert or update of current_pdf_page, display_mode
on public.lecture_display_state
for each row execute function private.sync_legacy_display_live_state();

revoke all on function private.bump_lecture_live_state(uuid, text)
  from public, anon, authenticated, service_role;
revoke all on function private.track_lecture_session_live_state()
  from public, anon, authenticated, service_role;
revoke all on function private.track_comment_live_state()
  from public, anon, authenticated, service_role;
revoke all on function private.track_comment_like_total()
  from public, anon, authenticated, service_role;
revoke all on function private.track_poll_response_total()
  from public, anon, authenticated, service_role;
revoke all on function private.track_poll_definition_live_state()
  from public, anon, authenticated, service_role;
revoke all on function private.sync_legacy_display_live_state()
  from public, anon, authenticated, service_role;

create function public.get_lecture_live_snapshot(
  target_lecture_session_id uuid,
  target_participant_id uuid default null,
  known_state_version bigint default null,
  known_comments_version bigint default null,
  known_likes_version bigint default null,
  known_polls_version bigint default null,
  known_display_version bigint default null,
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
  comments_payload jsonb := null;
  comments_items jsonb := '[]'::jsonb;
  comments_has_more boolean := false;
  comments_has_older boolean := false;
  likes_payload jsonb := null;
  polls_payload jsonb := null;
  display_payload jsonb := null;
begin
  select * into lecture_row
  from public.lecture_sessions lecture
  where lecture.id = target_lecture_session_id;

  if not found then
    return null;
  end if;

  select * into live_row
  from public.lecture_live_state live
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
    live_row.updated_at := lecture_row.updated_at;
  end if;

  if known_comments_version is distinct from live_row.comments_version then
    if comment_cursor_created_at is null or comment_cursor_id is null then
      select count(*) > effective_comment_limit
      into comments_has_older
      from (
        select 1
        from public.comments comment
        where comment.lecture_session_id = target_lecture_session_id
          and comment.status = 'visible'
        order by comment.created_at desc, comment.id desc
        limit effective_comment_limit + 1
      ) candidates;

      select coalesce(
        jsonb_agg(
          jsonb_build_object(
            'id', comment.id,
            'lecture_session_id', comment.lecture_session_id,
            'participant_id', comment.participant_id,
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
        from public.comments candidate
        where candidate.lecture_session_id = target_lecture_session_id
          and candidate.status = 'visible'
        order by candidate.created_at desc, candidate.id desc
        limit effective_comment_limit
      ) comment;

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
        from public.comments comment
        where comment.lecture_session_id = target_lecture_session_id
          and comment.status = 'visible'
          and (comment.created_at, comment.id)
            > (comment_cursor_created_at, comment_cursor_id)
        order by comment.created_at, comment.id
        limit effective_comment_limit + 1
      ) candidates;

      select coalesce(
        jsonb_agg(
          jsonb_build_object(
            'id', comment.id,
            'lecture_session_id', comment.lecture_session_id,
            'participant_id', comment.participant_id,
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
        from public.comments candidate
        where candidate.lecture_session_id = target_lecture_session_id
          and candidate.status = 'visible'
          and (candidate.created_at, candidate.id)
            > (comment_cursor_created_at, comment_cursor_id)
        order by candidate.created_at, candidate.id
        limit effective_comment_limit
      ) comment;

      comments_payload := jsonb_build_object(
        'mode', 'delta',
        'items', comments_items,
        'has_more', comments_has_more,
        'has_older', false
      );
    end if;
  end if;

  if known_likes_version is distinct from live_row.likes_version then
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'comment_id', comment.id,
          'like_count', coalesce(total.like_count, 0),
          'liked_by_participant', case
            when target_participant_id is null then false
            else exists (
              select 1
              from public.comment_likes participant_like
              where participant_like.comment_id = comment.id
                and participant_like.participant_id = target_participant_id
            )
          end
        ) order by comment.created_at desc, comment.id desc
      ),
      '[]'::jsonb
    )
    into likes_payload
    from (
      select candidate.*
      from public.comments candidate
      where candidate.lecture_session_id = target_lecture_session_id
        and candidate.status = 'visible'
      order by candidate.created_at desc, candidate.id desc
      limit 100
    ) comment
    left join public.comment_like_totals total
      on total.lecture_session_id = comment.lecture_session_id
     and total.comment_id = comment.id;
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
          'participant_option_ids', coalesce(participant_response.option_ids, '{}'),
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
            from public.poll_options option
            left join public.poll_option_totals total
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
    from public.polls poll
    left join public.poll_responses participant_response
      on participant_response.poll_id = poll.id
     and participant_response.participant_id = target_participant_id
    where poll.lecture_session_id = target_lecture_session_id
      and poll.status = 'open';
  end if;

  if known_display_version is distinct from live_row.display_version then
    display_payload := jsonb_build_object(
      'lecture_session_id', live_row.lecture_session_id,
      'current_pdf_page', live_row.current_pdf_page,
      'display_mode', live_row.display_mode,
      'pdf_asset_id', null,
      'updated_at', live_row.updated_at
    );
  end if;

  return jsonb_build_object(
    'lecture', jsonb_build_object(
      'lecture_session_id', lecture_row.id,
      'title', lecture_row.title,
      'status', lecture_row.status,
      'starts_at', lecture_row.starts_at,
      'ends_at', lecture_row.ends_at
    ),
    'versions', jsonb_build_object(
      'state', live_row.state_version,
      'comments', live_row.comments_version,
      'likes', live_row.likes_version,
      'polls', live_row.polls_version,
      'display', live_row.display_version
    ),
    'state_changed', known_state_version is distinct from live_row.state_version,
    'comments', comments_payload,
    'like_totals', likes_payload,
    'polls', polls_payload,
    'display', display_payload
  );
end;
$$;

revoke all on function public.get_lecture_live_snapshot(
  uuid, uuid, bigint, bigint, bigint, bigint, bigint, timestamptz, uuid, integer
) from public, anon, authenticated, service_role;
grant execute on function public.get_lecture_live_snapshot(
  uuid, uuid, bigint, bigint, bigint, bigint, bigint, timestamptz, uuid, integer
) to anon, authenticated;
