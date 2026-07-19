-- Phase 7.1 classroom UX extensions.
-- Expand-first: existing Phase 0-6.9 RPCs and client contracts remain valid.

alter table public.lecture_ai_control
  add column summary_language text not null default 'auto';

alter table public.lecture_ai_control
  add constraint lecture_ai_control_summary_language_check
  check (summary_language in ('auto', 'ja', 'en'));

alter table public.lecture_summary_windows
  add column requested_language text not null default 'auto',
  add column resolved_language text,
  add column language_reason text,
  add column language_recorded_at timestamptz;

alter table public.lecture_summary_windows
  add constraint lecture_summary_windows_requested_language_check
    check (requested_language in ('auto', 'ja', 'en')),
  add constraint lecture_summary_windows_resolved_language_check
    check (resolved_language is null or resolved_language in ('ja', 'en')),
  add constraint lecture_summary_windows_language_reason_check
    check (language_reason is null or char_length(language_reason) between 1 and 120),
  add constraint lecture_summary_windows_language_record_check
    check (
      (resolved_language is null and language_recorded_at is null)
      or (resolved_language is not null and language_recorded_at is not null)
    );

create index comments_lecture_participant_history_idx
  on public.comments (
    lecture_session_id,
    participant_id,
    created_at desc,
    id desc
  )
  where status = 'visible';

create function private.phase71_snapshot_summary_window_language()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  configured_language text;
begin
  select control.summary_language
  into configured_language
  from public.lecture_ai_control as control
  where control.lecture_session_id = new.lecture_session_id;

  new.requested_language := coalesce(configured_language, 'auto');
  new.resolved_language := null;
  new.language_reason := null;
  new.language_recorded_at := null;
  return new;
end;
$$;

create trigger lecture_summary_windows_phase71_language_snapshot
before insert on public.lecture_summary_windows
for each row execute function private.phase71_snapshot_summary_window_language();

create function private.set_lecture_summary_language(
  target_lecture_session_id uuid,
  target_summary_language text,
  target_actor_id text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  lecture_row public.lecture_sessions%rowtype;
  control_row public.lecture_ai_control%rowtype;
begin
  if target_summary_language not in ('auto', 'ja', 'en') then
    raise exception 'invalid summary language' using errcode = '22023';
  end if;
  if nullif(trim(target_actor_id), '') is null
     or char_length(target_actor_id) > 200 then
    raise exception 'invalid AI control actor id' using errcode = '22023';
  end if;

  perform private.close_lecture_if_expired(target_lecture_session_id);

  select lecture.*
  into lecture_row
  from public.lecture_sessions as lecture
  where lecture.id = target_lecture_session_id
  for update;

  if not found then
    raise exception 'lecture not found' using errcode = 'P0002';
  end if;
  if lecture_row.status = 'closed' then
    raise exception 'lecture is closed' using errcode = 'P0001';
  end if;

  insert into public.lecture_ai_control (lecture_session_id, hard_stop_at)
  values (target_lecture_session_id, lecture_row.hard_stop_at)
  on conflict (lecture_session_id) do nothing;

  update public.lecture_ai_control as control
  set
    summary_language = target_summary_language,
    hard_stop_at = lecture_row.hard_stop_at,
    version = control.version + 1,
    updated_at = statement_timestamp()
  where control.lecture_session_id = target_lecture_session_id
  returning * into control_row;

  return jsonb_build_object(
    'lecture_session_id', control_row.lecture_session_id,
    'summary_language', control_row.summary_language,
    'updated_at', control_row.updated_at,
    'version', control_row.version
  );
end;
$$;

create function public.admin_set_lecture_summary_language(
  target_lecture_session_id uuid,
  target_summary_language text,
  target_actor_id text
)
returns jsonb
language sql
volatile
security invoker
set search_path = ''
as $$
  select private.set_lecture_summary_language(
    target_lecture_session_id,
    target_summary_language,
    target_actor_id
  );
$$;

create function private.record_summary_window_language(
  target_window_id uuid,
  target_run_id uuid,
  target_actor_id text,
  target_resolved_language text,
  target_language_reason text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  window_row public.lecture_summary_windows%rowtype;
begin
  if target_resolved_language not in ('ja', 'en')
     or target_language_reason !~ '^(manual_(ja|en)|auto_(transcript|pdf)_(ja|en|mixed_(ja|en))|auto_default_ja)$'
     or nullif(trim(target_actor_id), '') is null
     or char_length(target_actor_id) > 200 then
    raise exception 'invalid summary language resolution' using errcode = '22023';
  end if;

  select summary_window.*
  into window_row
  from public.lecture_summary_windows as summary_window
  join public.lecture_summary_runs as run
    on run.id = summary_window.run_id
   and run.lecture_session_id = summary_window.lecture_session_id
  where summary_window.id = target_window_id
    and summary_window.run_id = target_run_id
    and run.actor_id = target_actor_id
  for update of summary_window;

  if not found then
    raise exception 'summary window not found' using errcode = 'P0002';
  end if;
  if window_row.status not in ('running', 'skipped') then
    raise exception 'summary window is not language-recordable' using errcode = 'P0001';
  end if;
  if window_row.requested_language in ('ja', 'en')
     and window_row.requested_language <> target_resolved_language then
    raise exception 'manual summary language mismatch' using errcode = '22023';
  end if;
  if window_row.requested_language = 'auto'
     and target_language_reason like 'manual_%' then
    raise exception 'automatic summary language reason mismatch' using errcode = '22023';
  end if;
  if window_row.requested_language in ('ja', 'en')
     and target_language_reason <> ('manual_' || window_row.requested_language) then
    raise exception 'manual summary language reason mismatch' using errcode = '22023';
  end if;

  if window_row.language_recorded_at is not null then
    if window_row.resolved_language = target_resolved_language
       and window_row.language_reason = target_language_reason then
      return jsonb_build_object(
        'accepted', true,
        'idempotent_replay', true,
        'language_reason', window_row.language_reason,
        'requested_language', window_row.requested_language,
        'resolved_language', window_row.resolved_language,
        'window_id', window_row.id
      );
    end if;
    raise exception 'summary window language is immutable' using errcode = 'P0001';
  end if;

  update public.lecture_summary_windows as summary_window
  set
    resolved_language = target_resolved_language,
    language_reason = target_language_reason,
    language_recorded_at = statement_timestamp(),
    updated_at = statement_timestamp()
  where summary_window.id = window_row.id
  returning * into window_row;

  return jsonb_build_object(
    'accepted', true,
    'idempotent_replay', false,
    'language_reason', window_row.language_reason,
    'requested_language', window_row.requested_language,
    'resolved_language', window_row.resolved_language,
    'window_id', window_row.id
  );
end;
$$;

create function public.admin_record_summary_window_language(
  target_window_id uuid,
  target_run_id uuid,
  target_actor_id text,
  target_resolved_language text,
  target_language_reason text
)
returns jsonb
language sql
volatile
security invoker
set search_path = ''
as $$
  select private.record_summary_window_language(
    target_window_id,
    target_run_id,
    target_actor_id,
    target_resolved_language,
    target_language_reason
  );
$$;

alter function private.phase6_admin_results_json(uuid)
  rename to phase6_admin_results_json_phase71_core;

create function private.phase6_admin_results_json(
  target_lecture_session_id uuid
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with core as (
    select private.phase6_admin_results_json_phase71_core(
      target_lecture_session_id
    ) as payload
  )
  select jsonb_set(
    jsonb_set(
      core.payload,
      '{control}',
      case
        when core.payload -> 'control' is null
          or core.payload -> 'control' = 'null'::jsonb
          then 'null'::jsonb
        else (core.payload -> 'control') || jsonb_build_object(
          'summary_language', control.summary_language
        )
      end,
      true
    ),
    '{windows}',
    coalesce((
      select jsonb_agg(
        item.value || jsonb_build_object(
          'language_reason', summary_window.language_reason,
          'language_recorded_at', summary_window.language_recorded_at,
          'requested_language', summary_window.requested_language,
          'resolved_language', summary_window.resolved_language
        )
        order by (item.value ->> 'window_index')::integer desc
      )
      from jsonb_array_elements(core.payload -> 'windows') as item(value)
      join public.lecture_summary_windows as summary_window
        on summary_window.id = (item.value ->> 'id')::uuid
    ), '[]'::jsonb),
    true
  )
  from core
  left join public.lecture_ai_control as control
    on control.lecture_session_id = target_lecture_session_id;
$$;

create function private.get_lecture_comment_history_v3(
  target_lecture_session_id uuid,
  before_created_at timestamptz default null,
  before_comment_id uuid default null,
  history_limit integer default 50,
  history_scope text default 'all'
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  request_user_id uuid := (select auth.uid());
  request_participant_id uuid;
  effective_limit integer := least(greatest(history_limit, 1), 50);
  history_items jsonb := '[]'::jsonb;
  has_older boolean := false;
  payload jsonb;
begin
  if request_user_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if history_scope not in ('all', 'mine') then
    raise exception 'invalid comment history scope' using errcode = '22023';
  end if;
  if (before_created_at is null) <> (before_comment_id is null) then
    raise exception 'both history cursor values are required' using errcode = '22023';
  end if;

  perform private.close_lecture_if_expired(target_lecture_session_id);
  if not private.can_read_lecture_v2(target_lecture_session_id) then
    return null;
  end if;

  if history_scope = 'all' then
    payload := private.get_lecture_comment_history_v2(
      target_lecture_session_id,
      before_created_at,
      before_comment_id,
      effective_limit
    );
    if payload is null then return null; end if;
    return jsonb_set(
      jsonb_set(payload, '{contract_version}', '3'::jsonb, true),
      '{scope}',
      to_jsonb('all'::text),
      true
    );
  end if;

  select participant.id
  into request_participant_id
  from public.participants as participant
  where participant.lecture_session_id = target_lecture_session_id
    and participant.auth_user_id = request_user_id
  limit 1;

  if request_participant_id is null then
    return null;
  end if;

  select count(*) > effective_limit
  into has_older
  from (
    select 1
    from public.comments as comment
    where comment.lecture_session_id = target_lecture_session_id
      and comment.participant_id = request_participant_id
      and comment.status = 'visible'
      and (
        before_created_at is null
        or (comment.created_at, comment.id)
          < (before_created_at, before_comment_id)
      )
    order by comment.created_at desc, comment.id desc
    limit effective_limit + 1
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
    ) order by comment.created_at desc, comment.id desc
  ), '[]'::jsonb)
  into history_items
  from (
    select candidate.*
    from public.comments as candidate
    where candidate.lecture_session_id = target_lecture_session_id
      and candidate.participant_id = request_participant_id
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
    'contract_version', 3,
    'has_older', has_older,
    'items', history_items,
    'scope', 'mine',
    'server_time', statement_timestamp()
  );
end;
$$;

create function public.get_lecture_comment_history_v3(
  target_lecture_session_id uuid,
  before_created_at timestamptz default null,
  before_comment_id uuid default null,
  history_limit integer default 50,
  history_scope text default 'all'
)
returns jsonb
language sql
volatile
security invoker
set search_path = ''
as $$
  select private.get_lecture_comment_history_v3(
    target_lecture_session_id,
    before_created_at,
    before_comment_id,
    history_limit,
    history_scope
  );
$$;

revoke all on function private.phase71_snapshot_summary_window_language()
  from public, anon, authenticated, service_role;
revoke all on function private.set_lecture_summary_language(uuid, text, text)
  from public, anon, authenticated, service_role;
revoke all on function public.admin_set_lecture_summary_language(uuid, text, text)
  from public, anon, authenticated, service_role;
revoke all on function private.record_summary_window_language(uuid, uuid, text, text, text)
  from public, anon, authenticated, service_role;
revoke all on function public.admin_record_summary_window_language(uuid, uuid, text, text, text)
  from public, anon, authenticated, service_role;
revoke all on function private.phase6_admin_results_json_phase71_core(uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.phase6_admin_results_json(uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.get_lecture_comment_history_v3(
  uuid, timestamptz, uuid, integer, text
) from public, anon, authenticated, service_role;
revoke all on function public.get_lecture_comment_history_v3(
  uuid, timestamptz, uuid, integer, text
) from public, anon, authenticated, service_role;

grant execute on function private.set_lecture_summary_language(uuid, text, text)
  to service_role;
grant execute on function public.admin_set_lecture_summary_language(uuid, text, text)
  to service_role;
grant execute on function private.record_summary_window_language(uuid, uuid, text, text, text)
  to service_role;
grant execute on function public.admin_record_summary_window_language(uuid, uuid, text, text, text)
  to service_role;
grant execute on function private.phase6_admin_results_json_phase71_core(uuid)
  to service_role;
grant execute on function private.phase6_admin_results_json(uuid)
  to service_role;
grant execute on function private.get_lecture_comment_history_v3(
  uuid, timestamptz, uuid, integer, text
) to authenticated;
grant execute on function public.get_lecture_comment_history_v3(
  uuid, timestamptz, uuid, integer, text
) to authenticated;

comment on column public.lecture_ai_control.summary_language is
  'Teacher-selected summary language. Auto is resolved from teacher transcript, then PDF, for each future window.';
comment on column public.lecture_summary_windows.requested_language is
  'Immutable language configuration snapshot captured when the window is first inserted.';
comment on column public.lecture_summary_windows.resolved_language is
  'Resolved output language for the one summary call; never derived from student comments alone.';
comment on function public.get_lecture_comment_history_v3(
  uuid, timestamptz, uuid, integer, text
) is 'Phase 7.1 on-demand cursor history. Mine scope resolves ownership only through auth.uid().';
