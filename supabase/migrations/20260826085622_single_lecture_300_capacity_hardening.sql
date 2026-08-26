-- Single-lecture capacity hardening for one instructor, one Display, and up to 300 students.
-- Shared lecture locks allow concurrent joins while preserving serialization with close/update paths.
-- Snapshot transport batches up to 25 comments; presentation components may still render a smaller subset.

create or replace function private.join_lecture_by_code_v2(
  lecture_code text
)
returns table (
  joined_lecture_session_id uuid,
  participant_id uuid,
  title text,
  starts_at timestamptz,
  ends_at timestamptz,
  status text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  request_user_id uuid := (select auth.uid());
  normalized_code text;
  hashed_code text;
  matched_lecture public.lecture_sessions%rowtype;
  joined_participant_id uuid;
  rate_row public.lecture_join_rate_limits%rowtype;
  effective_now timestamptz := statement_timestamp();
  next_attempts integer;
begin
  if request_user_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  insert into public.lecture_join_rate_limits (auth_user_id)
  values (request_user_id)
  on conflict (auth_user_id) do nothing;

  select rate.*
  into rate_row
  from public.lecture_join_rate_limits as rate
  where rate.auth_user_id = request_user_id
  for update;

  if rate_row.locked_until is not null
     and rate_row.locked_until > effective_now then
    return;
  end if;

  normalized_code := upper(trim(coalesce(lecture_code, '')));
  hashed_code := encode(
    extensions.digest(convert_to(normalized_code, 'UTF8'), 'sha256'),
    'hex'
  );

  if normalized_code <> '' then
    select lecture.*
    into matched_lecture
    from public.lecture_sessions as lecture
    where lecture.code_hash = hashed_code
      and lecture.status = 'open'
      and lecture.hard_stop_at > effective_now
      and private.is_lecture_open(lecture.id)
    limit 1
    for share of lecture;
  end if;

  if not found or normalized_code = '' then
    next_attempts := case
      when rate_row.window_started_at is null
        or rate_row.window_started_at < effective_now - interval '10 minutes'
        then 1
      else least(rate_row.failed_attempts + 1, 8)
    end;

    update public.lecture_join_rate_limits as rate
    set
      failed_attempts = next_attempts,
      window_started_at = case
        when rate.window_started_at is null
          or rate.window_started_at < effective_now - interval '10 minutes'
          then effective_now
        else rate.window_started_at
      end,
      last_failed_at = effective_now,
      locked_until = case
        when next_attempts >= 8 then effective_now + interval '15 minutes'
        else null
      end,
      updated_at = effective_now
    where rate.auth_user_id = request_user_id;
    return;
  end if;

  update public.lecture_join_rate_limits as rate
  set
    failed_attempts = 0,
    window_started_at = null,
    last_failed_at = null,
    locked_until = null,
    updated_at = effective_now
  where rate.auth_user_id = request_user_id;

  insert into public.participants (
    lecture_session_id,
    auth_user_id,
    participant_key,
    last_seen_at
  )
  values (
    matched_lecture.id,
    request_user_id,
    encode(extensions.gen_random_bytes(32), 'hex'),
    effective_now
  )
  on conflict (lecture_session_id, auth_user_id)
    where auth_user_id is not null
  do update set last_seen_at = excluded.last_seen_at
  returning id into joined_participant_id;

  return query
  select
    matched_lecture.id,
    joined_participant_id,
    matched_lecture.title,
    matched_lecture.starts_at,
    matched_lecture.ends_at,
    matched_lecture.status;
end;
$$;

create or replace function private.get_lecture_public_snapshot_v5(
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
  comment_limit integer default 25,
  known_metrics_version bigint default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  payload jsonb;
  live_row public.lecture_live_state%rowtype;
  request_user_id uuid := (select auth.uid());
  request_participant_id uuid;
  participant_last_seen_at timestamptz;
  lecture_is_open boolean := false;
  active_participant_count bigint := 0;
  participant_counted_at timestamptz := statement_timestamp();
  effective_now timestamptz := statement_timestamp();
begin
  payload := private.get_lecture_public_snapshot_v4(
    target_lecture_session_id,
    known_lecture_version,
    known_caption_version,
    known_comments_version,
    known_likes_version,
    known_polls_version,
    known_summaries_version,
    known_pdf_version,
    null,
    null,
    least(greatest(comment_limit, 1), 25)
  );
  if payload is null then
    return null;
  end if;

  select live.*
  into live_row
  from public.lecture_live_state as live
  where live.lecture_session_id = target_lecture_session_id;

  select
    participant.id,
    lecture.status = 'open'
      and lecture.hard_stop_at > effective_now
  into request_participant_id, lecture_is_open
  from public.participants as participant
  join public.lecture_sessions as lecture
    on lecture.id = participant.lecture_session_id
  where participant.lecture_session_id = target_lecture_session_id
    and participant.auth_user_id = request_user_id;

  if not found then
    return null;
  end if;

  if lecture_is_open then
    select presence.last_seen_at
    into participant_last_seen_at
    from public.lecture_participant_presence as presence
    where presence.lecture_session_id = target_lecture_session_id
      and presence.participant_id = request_participant_id;

    if not found then
      insert into public.lecture_participant_presence (
        lecture_session_id,
        participant_id,
        last_seen_at
      )
      values (
        target_lecture_session_id,
        request_participant_id,
        effective_now
      )
      on conflict (lecture_session_id, participant_id) do nothing;
    elsif participant_last_seen_at
        <= effective_now - interval '45 seconds' then
      update public.lecture_participant_presence as presence
      set last_seen_at = effective_now
      where presence.lecture_session_id = target_lecture_session_id
        and presence.participant_id = request_participant_id
        and presence.last_seen_at
          <= effective_now - interval '45 seconds';
    end if;

    select active.active_count, active.counted_at
    into active_participant_count, participant_counted_at
    from private.phase66_active_participant_count(
      target_lecture_session_id,
      effective_now
    ) as active;
  end if;

  payload := jsonb_set(
    payload,
    '{versions,metrics}',
    to_jsonb(coalesce(live_row.metrics_version, 0)),
    true
  );

  -- Presence naturally expires without a write, so metrics are intentionally
  -- returned on every snapshot instead of relying only on a row-change
  -- version. A 15-second lecture-scoped bucket limits the indexed count to one
  -- refresh per lecture per bucket.
  payload := jsonb_set(
    payload,
    '{changed,metrics}',
    jsonb_build_object(
      'participant_count_approximate', active_participant_count,
      'participant_count_mode', 'active_90s',
      'updated_at', participant_counted_at,
      'visible_comment_count', live_row.visible_comment_count
    ),
    true
  );

  if (payload -> 'changed') ? 'summaries' then
    payload := jsonb_set(
      payload,
      '{changed,material_summary}',
      coalesce(
        private.phase66_public_material_summary_json(
          target_lecture_session_id
        ),
        'null'::jsonb
      ),
      true
    );
  end if;

  if (payload -> 'changed') ? 'likes' then
    payload := jsonb_set(
      payload,
      '{changed,likes}',
      coalesce((
        select jsonb_agg(item.value order by item.ordinality)
        from jsonb_array_elements(payload #> '{changed,likes}')
          with ordinality as item(value, ordinality)
        where item.ordinality <= 5
      ), '[]'::jsonb),
      true
    );
  end if;

  return payload;
end;
$$;

create or replace function private.get_lecture_operator_snapshot_v1(
  target_lecture_session_id uuid,
  include_hidden boolean default false,
  known_lecture_version bigint default null,
  known_caption_version bigint default null,
  known_comments_version bigint default null,
  known_likes_version bigint default null,
  known_polls_version bigint default null,
  known_summaries_version bigint default null,
  known_pdf_version bigint default null,
  comment_cursor_created_at timestamptz default null,
  comment_cursor_id uuid default null,
  comment_limit integer default 25,
  known_metrics_version bigint default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  lecture_row public.lecture_sessions%rowtype;
  live_row public.lecture_live_state%rowtype;
  effective_now timestamptz := statement_timestamp();
  effective_comment_limit integer := least(greatest(comment_limit, 1), 25);
  active_participant_count bigint := 0;
  participant_counted_at timestamptz := effective_now;
  comments_payload jsonb;
  comments_items jsonb := '[]'::jsonb;
  comments_has_more boolean := false;
  comments_has_older boolean := false;
  force_initial_comments boolean :=
    comment_cursor_created_at is null or comment_cursor_id is null;
  effective_comments_version bigint;
  likes_payload jsonb := '[]'::jsonb;
  polls_payload jsonb := '[]'::jsonb;
  caption_payload jsonb := 'null'::jsonb;
  metrics_payload jsonb;
  changed_payload jsonb := '{}'::jsonb;
begin
  perform private.close_lecture_if_expired(target_lecture_session_id);

  select lecture.*
  into lecture_row
  from public.lecture_sessions as lecture
  where lecture.id = target_lecture_session_id;

  if not found then
    return null;
  end if;
  if lecture_row.status <> 'open'
     or lecture_row.hard_stop_at <= effective_now then
    if lecture_row.status = 'closed' then
      return jsonb_build_object(
        'mode', 'terminal',
        'terminal',
          private.phase66_operator_terminal_json(
            target_lecture_session_id
          )
      );
    end if;
    return null;
  end if;

  select live.*
  into live_row
  from public.lecture_live_state as live
  where live.lecture_session_id = target_lecture_session_id;

  if not found then
    live_row.lecture_session_id := target_lecture_session_id;
    live_row.current_pdf_page := 1;
    live_row.display_mode := 'normal';
    live_row.lecture_version := 0;
    live_row.caption_version := 0;
    live_row.comments_version := 0;
    live_row.visible_comments_version := 0;
    live_row.likes_version := 0;
    live_row.polls_version := 0;
    live_row.summaries_version := 0;
    live_row.pdf_version := 0;
    live_row.metrics_version := 0;
    live_row.visible_comment_count := 0;
    live_row.hidden_comment_count := 0;
    live_row.pdf_manifest_version := 0;
    live_row.pdf_visible := false;
    live_row.updated_at := lecture_row.updated_at;
  end if;

  effective_comments_version := case
    when include_hidden then live_row.comments_version
    else live_row.visible_comments_version
  end;

  if known_lecture_version is distinct from live_row.lecture_version then
    changed_payload := changed_payload || jsonb_build_object(
      'lecture',
      jsonb_build_object(
        'archive_expires_at', lecture_row.archive_expires_at,
        'closed_at', lecture_row.closed_at,
        'close_reason', lecture_row.close_reason,
        'ends_at', lecture_row.ends_at,
        'hard_stop_at', lecture_row.hard_stop_at,
        'lecture_session_id', lecture_row.id,
        'starts_at', lecture_row.starts_at,
        'status', lecture_row.status,
        'title', lecture_row.title
      )
    );
  end if;

  if known_caption_version is distinct from live_row.caption_version then
    select jsonb_build_object(
      'language', caption.language,
      'last_item_id', caption.last_item_id,
      'sequence', caption.sequence,
      'text', caption.text,
      'updated_at', caption.updated_at,
      'window_ended_at', caption.window_ended_at,
      'window_started_at', caption.window_started_at
    )
    into caption_payload
    from public.lecture_public_captions as caption
    where caption.lecture_session_id = target_lecture_session_id;

    changed_payload := changed_payload || jsonb_build_object(
      'caption',
      coalesce(caption_payload, 'null'::jsonb)
    );
  end if;

  if known_comments_version is distinct from effective_comments_version then
    if not force_initial_comments and exists (
      select 1
      from public.comment_moderation_events as moderation
      where moderation.lecture_session_id = target_lecture_session_id
        and moderation.created_at > comment_cursor_created_at
    ) then
      force_initial_comments := true;
    end if;

    if force_initial_comments then
      select count(*) > effective_comment_limit
      into comments_has_older
      from (
        select 1
        from public.comments as comment
        where comment.lecture_session_id = target_lecture_session_id
          and (
            comment.status = 'visible'
            or (include_hidden and comment.status = 'hidden')
          )
        order by comment.created_at desc, comment.id desc
        limit effective_comment_limit + 1
      ) as candidates;

      select coalesce(jsonb_agg(
        jsonb_build_object(
          'body', comment.body,
          'created_at', comment.created_at,
          'id', comment.id,
          'is_pinned', comment.is_pinned,
          'lecture_session_id', comment.lecture_session_id,
          'like_count', coalesce(total.like_count, 0),
          'nickname', comment.nickname,
          'status', comment.status
        )
        order by comment.created_at desc, comment.id desc
      ), '[]'::jsonb)
      into comments_items
      from (
        select candidate.*
        from public.comments as candidate
        where candidate.lecture_session_id = target_lecture_session_id
          and (
            candidate.status = 'visible'
            or (include_hidden and candidate.status = 'hidden')
          )
        order by candidate.created_at desc, candidate.id desc
        limit effective_comment_limit
      ) as comment
      left join public.comment_like_totals as total
        on total.lecture_session_id = comment.lecture_session_id
       and total.comment_id = comment.id;

      comments_payload := jsonb_build_object(
        'has_more', false,
        'has_older', comments_has_older,
        'items', comments_items,
        'mode', 'initial'
      );
    else
      select count(*) > effective_comment_limit
      into comments_has_more
      from (
        select 1
        from public.comments as comment
        where comment.lecture_session_id = target_lecture_session_id
          and (
            comment.status = 'visible'
            or (include_hidden and comment.status = 'hidden')
          )
          and (comment.created_at, comment.id)
            > (comment_cursor_created_at, comment_cursor_id)
        order by comment.created_at, comment.id
        limit effective_comment_limit + 1
      ) as candidates;

      select coalesce(jsonb_agg(
        jsonb_build_object(
          'body', comment.body,
          'created_at', comment.created_at,
          'id', comment.id,
          'is_pinned', comment.is_pinned,
          'lecture_session_id', comment.lecture_session_id,
          'like_count', coalesce(total.like_count, 0),
          'nickname', comment.nickname,
          'status', comment.status
        )
        order by comment.created_at, comment.id
      ), '[]'::jsonb)
      into comments_items
      from (
        select candidate.*
        from public.comments as candidate
        where candidate.lecture_session_id = target_lecture_session_id
          and (
            candidate.status = 'visible'
            or (include_hidden and candidate.status = 'hidden')
          )
          and (candidate.created_at, candidate.id)
            > (comment_cursor_created_at, comment_cursor_id)
        order by candidate.created_at, candidate.id
        limit effective_comment_limit
      ) as comment
      left join public.comment_like_totals as total
        on total.lecture_session_id = comment.lecture_session_id
       and total.comment_id = comment.id;

      comments_payload := jsonb_build_object(
        'has_more', comments_has_more,
        'has_older', false,
        'items', comments_items,
        'mode', 'delta'
      );
    end if;

    changed_payload := changed_payload
      || jsonb_build_object('comments', comments_payload);
  end if;

  if known_likes_version is distinct from live_row.likes_version then
    select coalesce(jsonb_agg(
      jsonb_build_object(
        'comment_id', comment.id,
        'like_count', coalesce(total.like_count, 0)
      )
      order by comment.created_at desc, comment.id desc
    ), '[]'::jsonb)
    into likes_payload
    from (
      select candidate.*
      from public.comments as candidate
      where candidate.lecture_session_id = target_lecture_session_id
        and (
          candidate.status = 'visible'
          or (include_hidden and candidate.status = 'hidden')
        )
      order by candidate.created_at desc, candidate.id desc
      limit 5
    ) as comment
    left join public.comment_like_totals as total
      on total.lecture_session_id = comment.lecture_session_id
     and total.comment_id = comment.id;

    changed_payload := changed_payload
      || jsonb_build_object('likes', likes_payload);
  end if;

  if known_polls_version is distinct from live_row.polls_version then
    select coalesce(jsonb_agg(
      jsonb_build_object(
        'created_at', poll.created_at,
        'id', poll.id,
        'lecture_session_id', poll.lecture_session_id,
        'options', coalesce((
          select jsonb_agg(
            jsonb_build_object(
              'display_order', option.display_order,
              'id', option.id,
              'label', option.label,
              'poll_id', option.poll_id,
              'response_count', coalesce(total.response_count, 0)
            )
            order by option.display_order, option.id
          )
          from public.poll_options as option
          left join public.poll_option_totals as total
            on total.lecture_session_id = option.lecture_session_id
           and total.poll_id = option.poll_id
           and total.option_id = option.id
          where option.lecture_session_id = poll.lecture_session_id
            and option.poll_id = poll.id
        ), '[]'::jsonb),
        'question', poll.question,
        'status', poll.status,
        'type', poll.type
      )
      order by poll.created_at, poll.id
    ), '[]'::jsonb)
    into polls_payload
    from public.polls as poll
    where poll.lecture_session_id = target_lecture_session_id
      and poll.status = 'open';

    changed_payload := changed_payload
      || jsonb_build_object('polls', polls_payload);
  end if;

  if known_summaries_version is distinct from live_row.summaries_version then
    changed_payload := changed_payload || jsonb_build_object(
      'material_summary',
      coalesce(
        private.phase66_public_material_summary_json(
          target_lecture_session_id
        ),
        'null'::jsonb
      ),
      'summaries',
      private.phase6_public_summaries_json(
        target_lecture_session_id,
        6
      )
    );
  end if;

  if known_pdf_version is distinct from live_row.pdf_version then
    changed_payload := changed_payload || jsonb_build_object(
      'pdf',
      jsonb_build_object(
        'current_pdf_page', live_row.current_pdf_page,
        'display_mode', live_row.display_mode,
        'lecture_session_id', target_lecture_session_id,
        'pdf_document_id', live_row.pdf_document_id,
        'pdf_document_version', live_row.pdf_document_version,
        'pdf_manifest_version', coalesce(live_row.pdf_manifest_version, 0),
        'pdf_page_count', live_row.pdf_page_count,
        'pdf_visible', coalesce(live_row.pdf_visible, false),
        'updated_at', live_row.updated_at
      )
    );
  end if;

  select active.active_count, active.counted_at
  into active_participant_count, participant_counted_at
  from private.phase66_active_participant_count(
    target_lecture_session_id,
    effective_now
  ) as active;

  metrics_payload := jsonb_build_object(
    'participant_count_approximate', active_participant_count,
    'participant_count_mode', 'active_90s',
    'updated_at', participant_counted_at,
    'visible_comment_count', coalesce(
      live_row.visible_comment_count,
      0
    )
  );
  if include_hidden then
    metrics_payload := metrics_payload || jsonb_build_object(
      'hidden_comment_count',
      coalesce(live_row.hidden_comment_count, 0)
    );
  end if;
  changed_payload := changed_payload
    || jsonb_build_object('metrics', metrics_payload);

  -- A concurrent manual close is observed before the payload leaves the DB.
  select lecture.*
  into lecture_row
  from public.lecture_sessions as lecture
  where lecture.id = target_lecture_session_id;
  if lecture_row.status <> 'open'
     or lecture_row.hard_stop_at <= statement_timestamp() then
    perform private.close_lecture_if_expired(target_lecture_session_id);
    return jsonb_build_object(
      'mode', 'terminal',
      'terminal',
        private.phase66_operator_terminal_json(
          target_lecture_session_id
        )
    );
  end if;

  return jsonb_build_object(
    'mode', 'live',
    'snapshot', jsonb_build_object(
      'changed', changed_payload,
      'contract_version', 2,
      'server_time', statement_timestamp(),
      'versions', jsonb_build_object(
        'caption', coalesce(live_row.caption_version, 0),
        'comments', coalesce(effective_comments_version, 0),
        'lecture', coalesce(live_row.lecture_version, 0),
        'likes', coalesce(live_row.likes_version, 0),
        'metrics', coalesce(live_row.metrics_version, 0),
        'pdf', coalesce(live_row.pdf_version, 0),
        'polls', coalesce(live_row.polls_version, 0),
        'summaries', coalesce(live_row.summaries_version, 0)
      )
    )
  );
end;
$$;
