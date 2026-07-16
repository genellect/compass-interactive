-- Phase 6.5: one nullable nickname value travels with the comment row.
-- There is deliberately no participant profile table, preference write, or
-- additional sync channel.

alter table public.comments
  add column nickname text;

alter table public.comments
  add constraint comments_nickname_valid
  check (
    nickname is null
    or (
      char_length(nickname) between 1 and 10
      and nickname = btrim(nickname)
      and nickname !~ '[[:cntrl:]]'
    )
  ) not valid;

alter table public.comments
  validate constraint comments_nickname_valid;

comment on column public.comments.nickname is
  'Optional per-comment display nickname. NULL means anonymous; this is not a participant profile.';

create function private.phase65_comment_items_with_nicknames(
  target_lecture_session_id uuid,
  comment_items jsonb
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  enriched_items jsonb;
begin
  if comment_items is null or jsonb_typeof(comment_items) <> 'array' then
    return comment_items;
  end if;

  select coalesce(
    jsonb_agg(
      item.value || jsonb_build_object('nickname', comment.nickname)
      order by item.ordinality
    ),
    '[]'::jsonb
  )
  into enriched_items
  from jsonb_array_elements(comment_items) with ordinality as item(value, ordinality)
  left join public.comments as comment
    on comment.id = (item.value ->> 'id')::uuid
   and comment.lecture_session_id = target_lecture_session_id
   and comment.status = 'visible';

  return enriched_items;
end;
$$;

alter function private.get_lecture_public_snapshot_v2(
  uuid, bigint, bigint, bigint, bigint, bigint, bigint, bigint,
  timestamptz, uuid, integer
) rename to get_lecture_public_snapshot_v2_phase65_core;

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
volatile
security definer
set search_path = ''
as $$
declare
  payload jsonb;
  comment_items jsonb;
begin
  payload := private.get_lecture_public_snapshot_v2_phase65_core(
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

  if payload is null then return null; end if;
  comment_items := payload #> '{changed,comments,items}';
  if jsonb_typeof(comment_items) = 'array' then
    payload := jsonb_set(
      payload,
      '{changed,comments,items}',
      private.phase65_comment_items_with_nicknames(
        target_lecture_session_id,
        comment_items
      ),
      true
    );
  end if;
  return payload;
end;
$$;

alter function private.get_lecture_comment_history_v2(
  uuid, timestamptz, uuid, integer
) rename to get_lecture_comment_history_v2_phase65_core;

create function private.get_lecture_comment_history_v2(
  target_lecture_session_id uuid,
  before_created_at timestamptz,
  before_comment_id uuid,
  history_limit integer default 50
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  payload jsonb;
begin
  payload := private.get_lecture_comment_history_v2_phase65_core(
    target_lecture_session_id,
    before_created_at,
    before_comment_id,
    history_limit
  );
  if payload is null then return null; end if;
  return jsonb_set(
    payload,
    '{items}',
    private.phase65_comment_items_with_nicknames(
      target_lecture_session_id,
      payload -> 'items'
    ),
    true
  );
end;
$$;

alter function private.get_lecture_archive_v2(uuid)
  rename to get_lecture_archive_v2_phase65_core;

create function private.get_lecture_archive_v2(
  target_lecture_session_id uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  payload jsonb;
begin
  payload := private.get_lecture_archive_v2_phase65_core(
    target_lecture_session_id
  );
  if payload is null then return null; end if;
  return jsonb_set(
    payload,
    '{comments}',
    private.phase65_comment_items_with_nicknames(
      target_lecture_session_id,
      payload -> 'comments'
    ),
    true
  );
end;
$$;

revoke all on function private.phase65_comment_items_with_nicknames(uuid, jsonb)
  from public, anon, authenticated, service_role;
revoke all on function private.get_lecture_public_snapshot_v2_phase65_core(
  uuid, bigint, bigint, bigint, bigint, bigint, bigint, bigint,
  timestamptz, uuid, integer
) from public, anon, authenticated, service_role;
revoke all on function private.get_lecture_comment_history_v2_phase65_core(
  uuid, timestamptz, uuid, integer
) from public, anon, authenticated, service_role;
revoke all on function private.get_lecture_archive_v2_phase65_core(uuid)
  from public, anon, authenticated, service_role;

revoke all on function private.get_lecture_public_snapshot_v2(
  uuid, bigint, bigint, bigint, bigint, bigint, bigint, bigint,
  timestamptz, uuid, integer
) from public, anon, authenticated, service_role;
revoke all on function private.get_lecture_comment_history_v2(
  uuid, timestamptz, uuid, integer
) from public, anon, authenticated, service_role;
revoke all on function private.get_lecture_archive_v2(uuid)
  from public, anon, authenticated, service_role;

grant execute on function private.get_lecture_public_snapshot_v2(
  uuid, bigint, bigint, bigint, bigint, bigint, bigint, bigint,
  timestamptz, uuid, integer
) to authenticated;
grant execute on function private.get_lecture_comment_history_v2(
  uuid, timestamptz, uuid, integer
) to authenticated;
grant execute on function private.get_lecture_archive_v2(uuid)
  to authenticated;
