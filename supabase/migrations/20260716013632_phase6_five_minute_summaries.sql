-- Phase 6: five-minute lecture recaps, comment pulse, academic-question
-- candidate detection, immutable revision history and compact snapshot delivery.
-- Expand-first: Phase 0-5 tables and v1-v3 snapshot/archive RPCs remain intact.

create table public.lecture_summary_runs (
  id uuid primary key default extensions.gen_random_uuid(),
  lecture_session_id uuid not null
    references public.lecture_sessions(id) on delete restrict,
  actor_id text not null check (char_length(actor_id) between 1 and 200),
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  status text not null default 'running'
    check (status in ('running', 'stopped', 'closed', 'failed')),
  started_at timestamptz not null default statement_timestamp(),
  expires_at timestamptz not null,
  stopped_at timestamptz,
  stop_reason text check (stop_reason is null or char_length(stop_reason) <= 120),
  last_window_index integer not null default 0 check (last_window_index between 0 and 18),
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  check (expires_at > started_at),
  check (
    (status = 'running' and stopped_at is null)
    or (status <> 'running' and stopped_at is not null)
  )
);

create unique index lecture_summary_runs_running_lecture_uidx
  on public.lecture_summary_runs (lecture_session_id)
  where status = 'running';
create index lecture_summary_runs_actor_created_idx
  on public.lecture_summary_runs (lecture_session_id, actor_id, created_at desc);

create table public.lecture_summary_windows (
  id uuid primary key default extensions.gen_random_uuid(),
  lecture_session_id uuid not null
    references public.lecture_sessions(id) on delete restrict,
  run_id uuid not null
    references public.lecture_summary_runs(id) on delete restrict,
  window_index integer not null check (window_index between 1 and 18),
  window_start timestamptz not null,
  window_end timestamptz not null,
  prompt_version text not null check (char_length(prompt_version) between 1 and 80),
  status text not null default 'pending'
    check (status in ('pending', 'running', 'succeeded', 'skipped', 'failed', 'discarded')),
  attempt_count integer not null default 0 check (attempt_count between 0 and 2),
  current_operation_id uuid
    references public.ai_usage_ledger(id) on delete restrict,
  source_hashes jsonb not null default '{}'::jsonb
    check (jsonb_typeof(source_hashes) = 'object' and octet_length(source_hashes::text) <= 4000),
  source_coverage jsonb not null default '{}'::jsonb
    check (jsonb_typeof(source_coverage) = 'object' and octet_length(source_coverage::text) <= 1000),
  last_error_code text
    check (last_error_code is null or char_length(last_error_code) <= 120),
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  unique (lecture_session_id, window_index, prompt_version),
  check (window_end = window_start + interval '5 minutes'),
  check ((status = 'running') = (current_operation_id is not null))
);

create index lecture_summary_windows_lecture_window_idx
  on public.lecture_summary_windows (lecture_session_id, window_index desc);
create index lecture_summary_windows_running_operation_idx
  on public.lecture_summary_windows (current_operation_id)
  where status = 'running';

create table public.lecture_ai_summaries (
  id uuid primary key default extensions.gen_random_uuid(),
  lecture_session_id uuid not null
    references public.lecture_sessions(id) on delete restrict,
  window_id uuid not null unique
    references public.lecture_summary_windows(id) on delete restrict,
  operation_id uuid not null unique
    references public.ai_usage_ledger(id) on delete restrict,
  model_id text not null check (char_length(model_id) between 1 and 120),
  prompt_version text not null check (char_length(prompt_version) between 1 and 80),
  ai_output jsonb not null
    check (jsonb_typeof(ai_output) = 'object' and octet_length(ai_output::text) <= 16000),
  quality_result jsonb not null
    check (jsonb_typeof(quality_result) = 'object' and octet_length(quality_result::text) <= 4000),
  status text not null default 'accepted'
    check (status in ('accepted', 'published', 'hidden')),
  created_at timestamptz not null default statement_timestamp()
);

create index lecture_ai_summaries_lecture_created_idx
  on public.lecture_ai_summaries (lecture_session_id, created_at desc);

create table public.lecture_ai_summary_revisions (
  id uuid primary key default extensions.gen_random_uuid(),
  summary_id uuid not null
    references public.lecture_ai_summaries(id) on delete restrict,
  revision_number integer not null check (revision_number between 1 and 100),
  body jsonb not null
    check (jsonb_typeof(body) = 'object' and octet_length(body::text) <= 10000),
  author_type text not null check (author_type in ('ai', 'admin')),
  author_actor_id text
    check (author_actor_id is null or char_length(author_actor_id) between 1 and 200),
  supersedes_id uuid
    references public.lecture_ai_summary_revisions(id) on delete restrict,
  reason text check (reason is null or char_length(reason) <= 500),
  created_at timestamptz not null default statement_timestamp(),
  unique (summary_id, revision_number),
  unique (id, summary_id),
  check (
    (author_type = 'ai' and author_actor_id is null)
    or (author_type = 'admin' and author_actor_id is not null)
  )
);

create index lecture_ai_summary_revisions_summary_created_idx
  on public.lecture_ai_summary_revisions (summary_id, revision_number desc);

create table public.summary_publications (
  summary_id uuid primary key
    references public.lecture_ai_summaries(id) on delete restrict,
  lecture_session_id uuid not null
    references public.lecture_sessions(id) on delete restrict,
  active_revision_id uuid not null,
  visibility text not null default 'hidden'
    check (visibility in ('public', 'hidden')),
  review_state text not null default 'ai_unreviewed'
    check (review_state in ('ai_unreviewed', 'admin_confirmed', 'admin_revised')),
  reviewed_by_actor text
    check (reviewed_by_actor is null or char_length(reviewed_by_actor) between 1 and 200),
  published_at timestamptz,
  pinned_order integer check (pinned_order is null or pinned_order between 1 and 20),
  pinned_until timestamptz,
  updated_at timestamptz not null default statement_timestamp(),
  foreign key (active_revision_id, summary_id)
    references public.lecture_ai_summary_revisions(id, summary_id)
    on delete restrict,
  check (visibility <> 'public' or published_at is not null),
  check ((pinned_order is null) = (pinned_until is null)),
  check (
    review_state = 'ai_unreviewed'
    or reviewed_by_actor is not null
  )
);

create index summary_publications_public_lecture_idx
  on public.summary_publications (
    lecture_session_id,
    pinned_order nulls last,
    published_at desc,
    summary_id
  ) where visibility = 'public';

alter table public.lecture_summary_runs enable row level security;
alter table public.lecture_summary_windows enable row level security;
alter table public.lecture_ai_summaries enable row level security;
alter table public.lecture_ai_summary_revisions enable row level security;
alter table public.summary_publications enable row level security;

revoke all on public.lecture_summary_runs from public, anon, authenticated;
revoke all on public.lecture_summary_windows from public, anon, authenticated;
revoke all on public.lecture_ai_summaries from public, anon, authenticated;
revoke all on public.lecture_ai_summary_revisions from public, anon, authenticated;
revoke all on public.summary_publications from public, anon, authenticated;

grant select, insert, update on public.lecture_summary_runs to service_role;
grant select, insert, update on public.lecture_summary_windows to service_role;
grant select, insert, update on public.lecture_ai_summaries to service_role;
grant select, insert on public.lecture_ai_summary_revisions to service_role;
grant select, insert, update on public.summary_publications to service_role;

create function private.phase6_revision_body_is_valid(candidate jsonb)
returns boolean
language sql
immutable
security invoker
set search_path = ''
as $$
  select
    jsonb_typeof(candidate) = 'object'
    and jsonb_typeof(candidate -> 'lecture_recap') = 'array'
    and jsonb_array_length(candidate -> 'lecture_recap') between 1 and 5
    and jsonb_typeof(candidate -> 'comment_pulse') = 'array'
    and jsonb_array_length(candidate -> 'comment_pulse') between 0 and 3
    and not exists (
      select 1
      from jsonb_array_elements_text(candidate -> 'lecture_recap') as item(value)
      where char_length(trim(item.value)) not between 1 and 300
    )
    and not exists (
      select 1
      from jsonb_array_elements_text(candidate -> 'comment_pulse') as item(value)
      where char_length(trim(item.value)) not between 1 and 300
    );
$$;

create function private.phase6_public_summaries_json(
  target_lecture_session_id uuid,
  result_limit integer default 6
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(item.payload order by item.pinned_rank, item.window_end desc), '[]'::jsonb)
  from (
    select
      case when publication.pinned_order is null then 1000 else publication.pinned_order end as pinned_rank,
      summary_window.window_end,
      jsonb_build_object(
        'id', summary.id,
        'revision_id', revision.id,
        'window_index', summary_window.window_index,
        'window_start', summary_window.window_start,
        'window_end', summary_window.window_end,
        'lecture_recap', revision.body -> 'lecture_recap',
        'comment_pulse', revision.body -> 'comment_pulse',
        'review_state', publication.review_state,
        'published_at', publication.published_at,
        'pinned', publication.pinned_order is not null
          and publication.pinned_until > statement_timestamp()
      ) as payload
    from public.summary_publications as publication
    join public.lecture_ai_summaries as summary
      on summary.id = publication.summary_id
    join public.lecture_summary_windows as summary_window
      on summary_window.id = summary.window_id
    join public.lecture_ai_summary_revisions as revision
      on revision.id = publication.active_revision_id
     and revision.summary_id = publication.summary_id
    where publication.lecture_session_id = target_lecture_session_id
      and publication.visibility = 'public'
      and (
        publication.pinned_until is null
        or publication.pinned_until > statement_timestamp()
      )
    order by pinned_rank, summary_window.window_end desc
    limit least(greatest(result_limit, 1), 12)
  ) as item;
$$;

create function private.phase6_comment_context(
  target_lecture_session_id uuid,
  target_window_start timestamptz,
  target_window_end timestamptz
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with current_metrics as (
    select
      count(*)::integer as comment_count,
      count(distinct comment.participant_id)::integer as participant_count
    from public.comments as comment
    where comment.lecture_session_id = target_lecture_session_id
      and comment.status = 'visible'
      and comment.created_at >= target_window_start
      and comment.created_at < target_window_end
  ), previous_metrics as (
    select count(*)::integer as comment_count
    from public.comments as comment
    where comment.lecture_session_id = target_lecture_session_id
      and comment.status = 'visible'
      and comment.created_at >= target_window_start - interval '5 minutes'
      and comment.created_at < target_window_start
  ), like_deltas as (
    select likes.comment_id, count(*)::integer as like_delta
    from public.comment_likes as likes
    where likes.lecture_session_id = target_lecture_session_id
      and likes.created_at >= target_window_start
      and likes.created_at < target_window_end
    group by likes.comment_id
  ), bounded_comments as (
    select
      comment.id,
      comment.body,
      comment.created_at,
      comment.is_pinned,
      coalesce(delta.like_delta, 0) as like_delta
    from public.comments as comment
    left join like_deltas as delta on delta.comment_id = comment.id
    where comment.lecture_session_id = target_lecture_session_id
      and comment.status = 'visible'
      and (
        (comment.created_at >= target_window_start and comment.created_at < target_window_end)
        or coalesce(delta.like_delta, 0) > 0
        or comment.is_pinned
      )
    order by comment.is_pinned desc, coalesce(delta.like_delta, 0) desc,
      comment.created_at desc, comment.id
    limit 20
  )
  select jsonb_build_object(
    'comment_count', current.comment_count,
    'unique_participant_count', current.participant_count,
    'previous_comment_count', previous.comment_count,
    'growth_ratio', case
      when previous.comment_count = 0 then null
      else round((current.comment_count - previous.comment_count)::numeric / previous.comment_count, 3)
    end,
    'comments', coalesce((
      select jsonb_agg(jsonb_build_object(
        'comment_id', bounded.id,
        'body', bounded.body,
        'created_at', bounded.created_at,
        'is_pinned', bounded.is_pinned,
        'like_delta', bounded.like_delta
      ) order by bounded.is_pinned desc, bounded.like_delta desc, bounded.created_at desc)
      from bounded_comments as bounded
    ), '[]'::jsonb)
  )
  from current_metrics as current cross join previous_metrics as previous;
$$;

create function private.phase6_admin_results_json(target_lecture_session_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'run', (
      select to_jsonb(run) - 'token_hash'
      from public.lecture_summary_runs as run
      where run.lecture_session_id = target_lecture_session_id
      order by run.created_at desc
      limit 1
    ),
    'control', (
      select jsonb_build_object(
        'status', control.status,
        'summaries_enabled', control.summaries_enabled,
        'summary_call_limit', control.summary_call_limit,
        'summary_calls_used', control.summary_calls_used,
        'budget_limit_microusd', control.budget_limit_microusd,
        'used_microusd', control.used_microusd,
        'input_token_limit', control.input_token_limit,
        'input_tokens_used', control.input_tokens_used,
        'output_token_limit', control.output_token_limit,
        'output_tokens_used', control.output_tokens_used
      )
      from public.lecture_ai_control as control
      where control.lecture_session_id = target_lecture_session_id
    ),
    'summaries', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', summary.id,
        'window_id', summary_window.id,
        'window_index', summary_window.window_index,
        'window_start', summary_window.window_start,
        'window_end', summary_window.window_end,
        'status', summary.status,
        'model_id', summary.model_id,
        'prompt_version', summary.prompt_version,
        'ai_output', summary.ai_output,
        'quality_result', summary.quality_result,
        'created_at', summary.created_at,
        'publication', case when publication.summary_id is null then null else jsonb_build_object(
          'active_revision_id', publication.active_revision_id,
          'visibility', publication.visibility,
          'review_state', publication.review_state,
          'published_at', publication.published_at,
          'pinned_order', publication.pinned_order,
          'pinned_until', publication.pinned_until
        ) end,
        'revisions', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', revision.id,
            'revision_number', revision.revision_number,
            'body', revision.body,
            'author_type', revision.author_type,
            'author_actor_id', revision.author_actor_id,
            'reason', revision.reason,
            'created_at', revision.created_at
          ) order by revision.revision_number)
          from public.lecture_ai_summary_revisions as revision
          where revision.summary_id = summary.id
        ), '[]'::jsonb)
      ) order by summary_window.window_index desc)
      from public.lecture_ai_summaries as summary
      join public.lecture_summary_windows as summary_window on summary_window.id = summary.window_id
      left join public.summary_publications as publication on publication.summary_id = summary.id
      where summary.lecture_session_id = target_lecture_session_id
    ), '[]'::jsonb),
    'windows', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', summary_window.id,
        'window_index', summary_window.window_index,
        'window_start', summary_window.window_start,
        'window_end', summary_window.window_end,
        'status', summary_window.status,
        'attempt_count', summary_window.attempt_count,
        'last_error_code', summary_window.last_error_code
      ) order by summary_window.window_index desc)
      from public.lecture_summary_windows as summary_window
      where summary_window.lecture_session_id = target_lecture_session_id
    ), '[]'::jsonb)
  );
$$;

create function private.start_lecture_summary_run(
  target_grant_id uuid,
  target_grant_nonce_hash text,
  target_lecture_session_id uuid,
  target_run_token_hash text,
  target_actor_id text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  grant_row public.ai_billing_grants%rowtype;
  lecture_row public.lecture_sessions%rowtype;
  run_row public.lecture_summary_runs%rowtype;
begin
  if target_grant_nonce_hash !~ '^[0-9a-f]{64}$'
     or target_run_token_hash !~ '^[0-9a-f]{64}$'
     or nullif(trim(target_actor_id), '') is null
     or char_length(target_actor_id) > 200 then
    raise exception 'invalid summary run credentials' using errcode = '22023';
  end if;

  -- Billing start lock order: grant -> lecture -> control -> run.
  select billing_grant.* into grant_row
  from public.ai_billing_grants as billing_grant
  where billing_grant.id = target_grant_id
    and billing_grant.lecture_session_id = target_lecture_session_id
  for update;

  if not found
     or grant_row.nonce_hash <> target_grant_nonce_hash
     or grant_row.actor_id <> target_actor_id then
    return jsonb_build_object('accepted', false, 'reason', 'invalid_grant');
  end if;
  if grant_row.status <> 'issued' then
    return jsonb_build_object('accepted', false, 'reason', 'grant_not_available');
  end if;
  if grant_row.expires_at <= statement_timestamp() then
    update public.ai_billing_grants set status = 'expired' where id = grant_row.id;
    return jsonb_build_object('accepted', false, 'reason', 'grant_expired');
  end if;
  if grant_row.actions <> array['summaries']::text[] then
    return jsonb_build_object('accepted', false, 'reason', 'grant_scope_mismatch');
  end if;

  perform private.close_lecture_if_expired(target_lecture_session_id);

  select lecture.* into lecture_row
  from public.lecture_sessions as lecture
  where lecture.id = target_lecture_session_id
  for update;
  if not found
     or lecture_row.status <> 'open'
     or lecture_row.started_at is null
     or lecture_row.hard_stop_at <= statement_timestamp() then
    return jsonb_build_object('accepted', false, 'reason', 'lecture_not_open');
  end if;

  perform 1
  from public.lecture_ai_control as control
  where control.lecture_session_id = target_lecture_session_id
  for update;
  if not found then
    raise exception 'AI control is not configured' using errcode = 'P0001';
  end if;

  select run.* into run_row
  from public.lecture_summary_runs as run
  where run.lecture_session_id = target_lecture_session_id
    and run.status = 'running'
  for update;
  if found then
    return jsonb_build_object('accepted', false, 'reason', 'summary_run_already_active');
  end if;

  update public.lecture_ai_control as control
  set
    summaries_enabled = true,
    status = case
      when exists (
        select 1 from public.ai_usage_ledger as usage
        where usage.lecture_session_id = target_lecture_session_id
          and usage.status = 'running'
      ) then 'running' else 'ready' end,
    stop_requested_at = null,
    stopped_at = null,
    stop_reason = null,
    version = control.version + 1,
    updated_at = statement_timestamp()
  where control.lecture_session_id = target_lecture_session_id;

  insert into public.lecture_summary_runs (
    lecture_session_id, actor_id, token_hash, expires_at
  ) values (
    target_lecture_session_id, target_actor_id, target_run_token_hash,
    lecture_row.hard_stop_at
  ) returning * into run_row;

  update public.ai_billing_grants
  set status = 'consumed', consumed_at = statement_timestamp(), operation_ids = '{}'::uuid[]
  where id = grant_row.id;

  return jsonb_build_object(
    'accepted', true,
    'run', to_jsonb(run_row) - 'token_hash',
    'results', private.phase6_admin_results_json(target_lecture_session_id)
  );
end;
$$;

create function private.resume_lecture_summary_run(
  target_lecture_session_id uuid,
  target_run_token_hash text,
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
  run_row public.lecture_summary_runs%rowtype;
begin
  if target_run_token_hash !~ '^[0-9a-f]{64}$'
     or nullif(trim(target_actor_id), '') is null
     or char_length(target_actor_id) > 200 then
    raise exception 'invalid summary run credentials' using errcode = '22023';
  end if;

  perform private.close_lecture_if_expired(target_lecture_session_id);
  select lecture.* into lecture_row
  from public.lecture_sessions as lecture
  where lecture.id = target_lecture_session_id
  for update;
  if not found or lecture_row.status <> 'open' or lecture_row.hard_stop_at <= statement_timestamp() then
    return jsonb_build_object('accepted', false, 'reason', 'lecture_not_open');
  end if;

  perform 1 from public.lecture_ai_control as control
  where control.lecture_session_id = target_lecture_session_id
  for update;

  select run.* into run_row
  from public.lecture_summary_runs as run
  where run.lecture_session_id = target_lecture_session_id
    and run.actor_id = target_actor_id
    and run.status = 'running'
    and run.expires_at > statement_timestamp()
  for update;
  if not found then
    return jsonb_build_object('accepted', false, 'reason', 'summary_run_not_active');
  end if;

  update public.lecture_summary_runs
  set token_hash = target_run_token_hash, updated_at = statement_timestamp()
  where id = run_row.id
  returning * into run_row;

  return jsonb_build_object(
    'accepted', true,
    'run', to_jsonb(run_row) - 'token_hash',
    'results', private.phase6_admin_results_json(target_lecture_session_id)
  );
end;
$$;

create function private.stop_lecture_summary_run(
  target_lecture_session_id uuid,
  target_actor_id text,
  target_reason text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  run_row public.lecture_summary_runs%rowtype;
begin
  if nullif(trim(target_actor_id), '') is null or char_length(target_actor_id) > 200
     or nullif(trim(target_reason), '') is null or char_length(target_reason) > 120 then
    raise exception 'invalid summary stop request' using errcode = '22023';
  end if;

  perform 1
  from public.lecture_sessions as lecture
  where lecture.id = target_lecture_session_id
  for update;
  if not found then raise exception 'lecture not found' using errcode = 'P0002'; end if;

  perform 1 from public.lecture_ai_control as control
  where control.lecture_session_id = target_lecture_session_id
  for update;

  perform 1 from public.ai_usage_ledger as usage
  where usage.lecture_session_id = target_lecture_session_id
    and usage.feature = 'summaries'
    and usage.status = 'running'
  order by usage.id
  for update;

  select run.* into run_row
  from public.lecture_summary_runs as run
  where run.lecture_session_id = target_lecture_session_id
    and run.status = 'running'
  for update;

  if found and run_row.actor_id <> target_actor_id then
    return jsonb_build_object('accepted', false, 'reason', 'actor_mismatch');
  end if;

  update public.ai_usage_ledger
  set status = 'cancelled', result_accepted = false,
      error_code = 'summary_run_stopped_cost_unknown', finished_at = statement_timestamp()
  where lecture_session_id = target_lecture_session_id
    and feature = 'summaries' and status = 'running';

  update public.lecture_summary_windows
  set status = 'discarded', current_operation_id = null,
      last_error_code = 'summary_run_stopped', updated_at = statement_timestamp()
  where lecture_session_id = target_lecture_session_id and status = 'running';

  update public.lecture_summary_runs
  set status = 'stopped', stopped_at = statement_timestamp(), stop_reason = trim(target_reason),
      token_hash = encode(extensions.gen_random_bytes(32), 'hex'), updated_at = statement_timestamp()
  where lecture_session_id = target_lecture_session_id and status = 'running';

  update public.lecture_ai_control as control
  set summaries_enabled = false, version = control.version + 1,
      updated_at = statement_timestamp()
  where control.lecture_session_id = target_lecture_session_id;
  perform private.reconcile_lecture_ai_runtime_state(target_lecture_session_id, false);

  return jsonb_build_object(
    'accepted', true,
    'results', private.phase6_admin_results_json(target_lecture_session_id)
  );
end;
$$;

create function private.start_summary_window_operation(
  target_lecture_session_id uuid,
  target_run_id uuid,
  target_run_token_hash text,
  target_actor_id text,
  target_window_index integer,
  target_prompt_version text,
  target_model_id text,
  target_source_hashes jsonb,
  target_source_coverage jsonb,
  estimated_microusd bigint,
  estimated_input_tokens bigint,
  estimated_output_tokens bigint,
  input_price_microusd_per_million bigint,
  output_price_microusd_per_million bigint
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  lecture_row public.lecture_sessions%rowtype;
  run_row public.lecture_summary_runs%rowtype;
  window_row public.lecture_summary_windows%rowtype;
  operation_result jsonb;
  operation_id uuid;
  expected_start timestamptz;
  expected_end timestamptz;
  next_attempt integer;
  material_context jsonb;
  comment_context jsonb;
  source_below_threshold boolean;
begin
  if target_window_index not between 1 and 18
     or target_run_token_hash !~ '^[0-9a-f]{64}$'
     or nullif(trim(target_actor_id), '') is null
     or char_length(target_actor_id) > 200
     or nullif(trim(target_prompt_version), '') is null
     or char_length(target_prompt_version) > 80
     or nullif(trim(target_model_id), '') is null
     or char_length(target_model_id) > 120
     or jsonb_typeof(target_source_hashes) <> 'object'
     or jsonb_typeof(target_source_coverage) <> 'object'
     or least(estimated_microusd, estimated_input_tokens, estimated_output_tokens,
              input_price_microusd_per_million, output_price_microusd_per_million) < 0 then
    raise exception 'invalid summary window request' using errcode = '22023';
  end if;

  perform private.close_lecture_if_expired(target_lecture_session_id);
  select lecture.* into lecture_row
  from public.lecture_sessions as lecture
  where lecture.id = target_lecture_session_id
  for update;
  if not found or lecture_row.status <> 'open' or lecture_row.hard_stop_at <= statement_timestamp() then
    return jsonb_build_object('accepted', false, 'reason', 'lecture_not_open');
  end if;

  perform 1 from public.lecture_ai_control as control
  where control.lecture_session_id = target_lecture_session_id
  for update;

  select run.* into run_row
  from public.lecture_summary_runs as run
  where run.id = target_run_id
    and run.lecture_session_id = target_lecture_session_id
    and run.actor_id = target_actor_id
    and run.token_hash = target_run_token_hash
  for update;
  if not found or run_row.status <> 'running' or run_row.expires_at <= statement_timestamp() then
    return jsonb_build_object('accepted', false, 'reason', 'summary_run_not_active');
  end if;

  expected_start := lecture_row.started_at + (target_window_index - 1) * interval '5 minutes';
  expected_end := expected_start + interval '5 minutes';
  if expected_end > statement_timestamp() then
    return jsonb_build_object('accepted', false, 'reason', 'window_not_due', 'window_end', expected_end);
  end if;
  if expected_start >= lecture_row.hard_stop_at then
    return jsonb_build_object('accepted', false, 'reason', 'window_outside_lecture');
  end if;

  insert into public.lecture_summary_windows (
    lecture_session_id, run_id, window_index, window_start, window_end,
    prompt_version, source_hashes, source_coverage
  ) values (
    target_lecture_session_id, target_run_id, target_window_index,
    expected_start, expected_end, target_prompt_version,
    target_source_hashes, target_source_coverage
  ) on conflict (lecture_session_id, window_index, prompt_version) do nothing;

  select summary_window.* into window_row
  from public.lecture_summary_windows as summary_window
  where summary_window.lecture_session_id = target_lecture_session_id
    and summary_window.window_index = target_window_index
    and summary_window.prompt_version = target_prompt_version
  for update;

  if window_row.status in ('succeeded', 'skipped', 'discarded') then
    return jsonb_build_object(
      'accepted', false, 'reason', 'window_final', 'window', to_jsonb(window_row),
      'results', private.phase6_admin_results_json(target_lecture_session_id)
    );
  end if;
  if window_row.status = 'running' then
    return jsonb_build_object('accepted', false, 'reason', 'window_running', 'window', to_jsonb(window_row));
  end if;
  if window_row.attempt_count >= 2 then
    return jsonb_build_object('accepted', false, 'reason', 'window_attempt_limit');
  end if;

  comment_context := private.phase6_comment_context(
    target_lecture_session_id, expected_start, expected_end
  );
  source_below_threshold := (
    case
      when jsonb_typeof(target_source_hashes -> 'transcript_character_count') = 'number'
        then (target_source_hashes ->> 'transcript_character_count')::numeric < 120
      else not coalesce((target_source_coverage ->> 'transcript')::boolean, false)
    end
  ) and (
    case
      when jsonb_typeof(target_source_hashes -> 'pdf_character_count') = 'number'
        then (target_source_hashes ->> 'pdf_character_count')::numeric < 120
      else not coalesce((target_source_coverage ->> 'pdf')::boolean, false)
    end
  );
  if source_below_threshold
     and coalesce((comment_context ->> 'comment_count')::integer, 0) < 3
     and not exists (
       select 1
       from jsonb_array_elements(comment_context -> 'comments') as comment_item(value)
       where coalesce((comment_item.value ->> 'like_delta')::integer, 0) >= 3
     ) then
    return jsonb_build_object(
      'accepted', false,
      'reason', 'insufficient_source_context',
      'window', to_jsonb(window_row)
    );
  end if;

  next_attempt := window_row.attempt_count + 1;
  operation_result := private.start_lecture_ai_operation(
    target_lecture_session_id,
    'summaries',
    'phase6-summary:' || window_row.id::text || ':' || next_attempt::text,
    estimated_microusd, 0, estimated_input_tokens, estimated_output_tokens,
    target_actor_id
  );
  if coalesce((operation_result ->> 'accepted')::boolean, false) is not true then
    return operation_result || jsonb_build_object('window', to_jsonb(window_row));
  end if;

  operation_id := (operation_result #>> '{operation,id}')::uuid;
  update public.ai_usage_ledger
  set model_id = target_model_id, pricing_unit = 'token',
      pricing_rate_microusd = input_price_microusd_per_million,
      last_heartbeat_at = statement_timestamp()
  where id = operation_id;

  update public.lecture_summary_windows
  set run_id = target_run_id, status = 'running', attempt_count = next_attempt,
      current_operation_id = operation_id, source_hashes = target_source_hashes,
      source_coverage = target_source_coverage, last_error_code = null,
      updated_at = statement_timestamp()
  where id = window_row.id
  returning * into window_row;

  select jsonb_build_object(
    'outline', analysis.material_outline,
    'summary', analysis.material_summary,
    'section_boundaries', analysis.section_boundaries,
    'document_id', analysis.source_document_id,
    'document_version', analysis.source_document_version
  ) into material_context
  from public.lecture_material_analyses as analysis
  join public.lecture_live_state as live
    on live.lecture_session_id = analysis.lecture_session_id
   and live.pdf_document_id = analysis.source_document_id
   and live.pdf_document_version = analysis.source_document_version
  where analysis.lecture_session_id = target_lecture_session_id
    and analysis.status = 'active'
  order by analysis.created_at desc
  limit 1;

  return jsonb_build_object(
    'accepted', true,
    'operation', operation_result -> 'operation',
    'window', to_jsonb(window_row),
    'comment_context', comment_context,
    'material_context', material_context,
    'previous_summary', private.phase6_public_summaries_json(target_lecture_session_id, 1),
    'output_price_microusd_per_million', output_price_microusd_per_million
  );
end;
$$;

create function private.skip_summary_window(
  target_lecture_session_id uuid,
  target_run_id uuid,
  target_run_token_hash text,
  target_actor_id text,
  target_window_index integer,
  target_prompt_version text,
  target_reason text,
  target_source_hashes jsonb,
  target_source_coverage jsonb
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  lecture_row public.lecture_sessions%rowtype;
  run_row public.lecture_summary_runs%rowtype;
  window_row public.lecture_summary_windows%rowtype;
  expected_start timestamptz;
  expected_end timestamptz;
  comment_context jsonb;
begin
  if target_window_index not between 1 and 18
     or target_run_token_hash !~ '^[0-9a-f]{64}$'
     or nullif(trim(target_reason), '') is null
     or char_length(target_reason) > 120 then
    raise exception 'invalid summary skip request' using errcode = '22023';
  end if;

  perform private.close_lecture_if_expired(target_lecture_session_id);
  select lecture.* into lecture_row from public.lecture_sessions as lecture
  where lecture.id = target_lecture_session_id for update;
  if not found or lecture_row.status <> 'open' or lecture_row.hard_stop_at <= statement_timestamp() then
    return jsonb_build_object('accepted', false, 'reason', 'lecture_not_open');
  end if;
  perform 1 from public.lecture_ai_control as control
  where control.lecture_session_id = target_lecture_session_id for update;
  select run.* into run_row from public.lecture_summary_runs as run
  where run.id = target_run_id and run.lecture_session_id = target_lecture_session_id
    and run.actor_id = target_actor_id and run.token_hash = target_run_token_hash
  for update;
  if not found or run_row.status <> 'running' then
    return jsonb_build_object('accepted', false, 'reason', 'summary_run_not_active');
  end if;

  expected_start := lecture_row.started_at + (target_window_index - 1) * interval '5 minutes';
  expected_end := expected_start + interval '5 minutes';
  if expected_end > statement_timestamp() or expected_start >= lecture_row.hard_stop_at then
    return jsonb_build_object('accepted', false, 'reason', 'window_not_due');
  end if;

  comment_context := private.phase6_comment_context(
    target_lecture_session_id, expected_start, expected_end
  );
  if target_reason = 'insufficient_source_context'
     and (
       coalesce((comment_context ->> 'comment_count')::integer, 0) >= 3
       or exists (
         select 1
         from jsonb_array_elements(comment_context -> 'comments') as comment_item(value)
         where coalesce((comment_item.value ->> 'like_delta')::integer, 0) >= 3
       )
     ) then
    return jsonb_build_object(
      'accepted', false,
      'reason', 'comment_context_available',
      'comment_context', comment_context
    );
  end if;

  insert into public.lecture_summary_windows (
    lecture_session_id, run_id, window_index, window_start, window_end,
    prompt_version, status, source_hashes, source_coverage, last_error_code
  ) values (
    target_lecture_session_id, target_run_id, target_window_index,
    expected_start, expected_end, target_prompt_version, 'skipped',
    target_source_hashes, target_source_coverage, trim(target_reason)
  ) on conflict (lecture_session_id, window_index, prompt_version) do update
  set status = case
        when lecture_summary_windows.status in ('succeeded', 'running')
          then lecture_summary_windows.status else 'skipped' end,
      last_error_code = case
        when lecture_summary_windows.status in ('succeeded', 'running')
          then lecture_summary_windows.last_error_code else trim(target_reason) end,
      source_hashes = excluded.source_hashes,
      source_coverage = excluded.source_coverage,
      updated_at = statement_timestamp()
  returning * into window_row;

  update public.lecture_summary_runs
  set last_window_index = greatest(last_window_index, target_window_index),
      updated_at = statement_timestamp()
  where id = target_run_id and window_row.status = 'skipped';

  return jsonb_build_object(
    'accepted', window_row.status = 'skipped',
    'window', to_jsonb(window_row),
    'results', private.phase6_admin_results_json(target_lecture_session_id)
  );
end;
$$;

create function private.fail_summary_window_operation(
  target_operation_id uuid,
  target_run_id uuid,
  target_actor_id text,
  actual_microusd bigint,
  actual_input_tokens bigint,
  actual_output_tokens bigint,
  provider_request_id text,
  target_error_code text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  usage_row public.ai_usage_ledger%rowtype;
  window_row public.lecture_summary_windows%rowtype;
  finish_result jsonb;
begin
  select usage.* into usage_row
  from public.ai_usage_ledger as usage
  where usage.id = target_operation_id;
  if not found or usage_row.feature <> 'summaries'
     or usage_row.requested_by_actor <> target_actor_id then
    raise exception 'summary operation not found' using errcode = 'P0002';
  end if;

  if usage_row.status <> 'running' then
    return jsonb_build_object(
      'accepted', true,
      'idempotent_replay', true,
      'results', private.phase6_admin_results_json(usage_row.lecture_session_id)
    );
  end if;

  finish_result := private.finish_lecture_ai_operation(
    target_operation_id, 'failed', actual_microusd, 0,
    actual_input_tokens, actual_output_tokens, provider_request_id, target_error_code
  );

  select summary_window.* into window_row
  from public.lecture_summary_windows as summary_window
  where summary_window.current_operation_id = target_operation_id
    and summary_window.run_id = target_run_id
  for update;
  if found then
    update public.lecture_summary_windows
    set status = 'failed', current_operation_id = null,
        last_error_code = left(coalesce(target_error_code, 'summary_failed'), 120),
        updated_at = statement_timestamp()
    where id = window_row.id;
  end if;

  return finish_result || jsonb_build_object(
    'results', private.phase6_admin_results_json(usage_row.lecture_session_id)
  );
end;
$$;

create function private.complete_summary_window_operation(
  target_operation_id uuid,
  target_run_id uuid,
  target_actor_id text,
  actual_microusd bigint,
  actual_input_tokens bigint,
  actual_output_tokens bigint,
  provider_request_id text,
  target_model_id text,
  target_ai_output jsonb,
  target_quality_result jsonb,
  publish_recommended boolean
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  usage_row public.ai_usage_ledger%rowtype;
  run_row public.lecture_summary_runs%rowtype;
  window_row public.lecture_summary_windows%rowtype;
  summary_row public.lecture_ai_summaries%rowtype;
  revision_row public.lecture_ai_summary_revisions%rowtype;
  finish_result jsonb;
  revision_body jsonb;
begin
  if jsonb_typeof(target_ai_output) <> 'object'
     or jsonb_typeof(target_quality_result) <> 'object'
     or octet_length(target_ai_output::text) > 16000
     or octet_length(target_quality_result::text) > 4000 then
    raise exception 'invalid summary output' using errcode = '22023';
  end if;
  revision_body := jsonb_build_object(
    'lecture_recap', target_ai_output -> 'lecture_recap',
    'comment_pulse', target_ai_output -> 'comment_pulse'
  );
  if not private.phase6_revision_body_is_valid(revision_body) then
    raise exception 'invalid summary revision body' using errcode = '22023';
  end if;

  select usage.* into usage_row
  from public.ai_usage_ledger as usage
  where usage.id = target_operation_id;
  if not found or usage_row.feature <> 'summaries'
     or usage_row.requested_by_actor <> target_actor_id then
    raise exception 'summary operation not found' using errcode = 'P0002';
  end if;

  select summary.* into summary_row
  from public.lecture_ai_summaries as summary
  where summary.operation_id = target_operation_id;
  if found then
    return jsonb_build_object(
      'accepted', true,
      'result_saved', true,
      'idempotent_replay', true,
      'summary_id', summary_row.id,
      'results', private.phase6_admin_results_json(usage_row.lecture_session_id)
    );
  end if;
  if usage_row.status <> 'running' then
    return jsonb_build_object(
      'accepted', false,
      'result_saved', false,
      'idempotent_replay', true,
      'reason', coalesce(usage_row.error_code, 'operation_final'),
      'results', private.phase6_admin_results_json(usage_row.lecture_session_id)
    );
  end if;

  finish_result := private.finish_lecture_ai_operation(
    target_operation_id, 'succeeded', actual_microusd, 0,
    actual_input_tokens, actual_output_tokens, provider_request_id, null
  );

  select run.* into run_row
  from public.lecture_summary_runs as run
  where run.id = target_run_id
    and run.lecture_session_id = usage_row.lecture_session_id
    and run.actor_id = target_actor_id
  for update;
  select summary_window.* into window_row
  from public.lecture_summary_windows as summary_window
  where summary_window.current_operation_id = target_operation_id
    and summary_window.run_id = target_run_id
  for update;

  if not found then
    raise exception 'summary window not found' using errcode = 'P0002';
  end if;
  if coalesce((finish_result ->> 'accepted')::boolean, false) is not true
     or run_row.status <> 'running'
     or run_row.expires_at <= statement_timestamp() then
    update public.ai_usage_ledger
    set status = 'discarded', result_accepted = false,
        error_code = 'late_summary_discarded'
    where id = target_operation_id;
    update public.lecture_summary_windows
    set status = 'discarded', current_operation_id = null,
        last_error_code = 'late_summary_discarded', updated_at = statement_timestamp()
    where id = window_row.id;
    return jsonb_build_object(
      'accepted', false, 'result_saved', false, 'reason', 'late_summary_discarded',
      'results', private.phase6_admin_results_json(usage_row.lecture_session_id)
    );
  end if;

  insert into public.lecture_ai_summaries (
    lecture_session_id, window_id, operation_id, model_id, prompt_version,
    ai_output, quality_result, status
  ) values (
    usage_row.lecture_session_id, window_row.id, target_operation_id,
    target_model_id, window_row.prompt_version, target_ai_output,
    target_quality_result, case when publish_recommended then 'published' else 'hidden' end
  ) returning * into summary_row;

  insert into public.lecture_ai_summary_revisions (
    summary_id, revision_number, body, author_type, reason
  ) values (
    summary_row.id, 1, revision_body, 'ai', 'initial_ai_output'
  ) returning * into revision_row;

  insert into public.summary_publications (
    summary_id, lecture_session_id, active_revision_id, visibility,
    review_state, published_at
  ) values (
    summary_row.id, usage_row.lecture_session_id, revision_row.id,
    case when publish_recommended then 'public' else 'hidden' end,
    'ai_unreviewed', case when publish_recommended then statement_timestamp() else null end
  );

  update public.lecture_summary_windows
  set status = 'succeeded', current_operation_id = null, last_error_code = null,
      updated_at = statement_timestamp()
  where id = window_row.id;
  update public.lecture_summary_runs
  set last_window_index = greatest(last_window_index, window_row.window_index),
      updated_at = statement_timestamp()
  where id = run_row.id;

  if publish_recommended then
    perform private.bump_lecture_live_state(usage_row.lecture_session_id, 'summaries');
  end if;

  return jsonb_build_object(
    'accepted', true,
    'result_saved', true,
    'summary_id', summary_row.id,
    'results', private.phase6_admin_results_json(usage_row.lecture_session_id)
  );
end;
$$;

create function private.manage_summary_publication(
  target_lecture_session_id uuid,
  target_summary_id uuid,
  target_actor_id text,
  target_action text,
  target_body jsonb default null,
  target_reason text default null,
  target_pinned_order integer default null,
  target_pinned_until timestamptz default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  publication_row public.summary_publications%rowtype;
  current_revision public.lecture_ai_summary_revisions%rowtype;
  new_revision public.lecture_ai_summary_revisions%rowtype;
  next_revision integer;
begin
  if target_action not in ('publish', 'hide', 'pin', 'unpin', 'revise_publish')
     or nullif(trim(target_actor_id), '') is null
     or char_length(target_actor_id) > 200 then
    raise exception 'invalid summary publication action' using errcode = '22023';
  end if;

  perform 1 from public.lecture_sessions as lecture
  where lecture.id = target_lecture_session_id
  for update;
  if not found then raise exception 'lecture not found' using errcode = 'P0002'; end if;
  perform 1 from public.lecture_ai_control as control
  where control.lecture_session_id = target_lecture_session_id
  for update;

  perform 1
  from public.lecture_ai_summaries as summary
  where summary.id = target_summary_id
    and summary.lecture_session_id = target_lecture_session_id
  for update;
  if not found then raise exception 'summary not found' using errcode = 'P0002'; end if;

  select publication.* into publication_row
  from public.summary_publications as publication
  where publication.summary_id = target_summary_id
    and publication.lecture_session_id = target_lecture_session_id
  for update;
  if not found then raise exception 'publication not found' using errcode = 'P0002'; end if;

  select revision.* into current_revision
  from public.lecture_ai_summary_revisions as revision
  where revision.id = publication_row.active_revision_id
  for update;

  if target_action = 'revise_publish' then
    if not private.phase6_revision_body_is_valid(target_body)
       or nullif(trim(target_reason), '') is null
       or char_length(target_reason) > 500 then
      raise exception 'invalid Admin revision' using errcode = '22023';
    end if;
    select coalesce(max(revision_number), 0) + 1 into next_revision
    from public.lecture_ai_summary_revisions where summary_id = target_summary_id;
    insert into public.lecture_ai_summary_revisions (
      summary_id, revision_number, body, author_type, author_actor_id,
      supersedes_id, reason
    ) values (
      target_summary_id, next_revision, target_body, 'admin', target_actor_id,
      current_revision.id, trim(target_reason)
    ) returning * into new_revision;
    update public.summary_publications
    set active_revision_id = new_revision.id, visibility = 'public',
        review_state = 'admin_revised', reviewed_by_actor = target_actor_id,
        published_at = coalesce(published_at, statement_timestamp()),
        updated_at = statement_timestamp()
    where summary_id = target_summary_id;
    update public.lecture_ai_summaries set status = 'published' where id = target_summary_id;
  elsif target_action = 'publish' then
    update public.summary_publications
    set visibility = 'public', review_state = case
          when current_revision.author_type = 'admin' then 'admin_revised'
          else 'admin_confirmed' end,
        reviewed_by_actor = target_actor_id,
        published_at = coalesce(published_at, statement_timestamp()),
        updated_at = statement_timestamp()
    where summary_id = target_summary_id;
    update public.lecture_ai_summaries set status = 'published' where id = target_summary_id;
  elsif target_action = 'hide' then
    update public.summary_publications
    set visibility = 'hidden', pinned_order = null, pinned_until = null,
        updated_at = statement_timestamp()
    where summary_id = target_summary_id;
    update public.lecture_ai_summaries set status = 'hidden' where id = target_summary_id;
  elsif target_action = 'pin' then
    if target_pinned_order not between 1 and 20
       or target_pinned_until is null
       or target_pinned_until <= statement_timestamp()
       or target_pinned_until > statement_timestamp() + interval '30 days' then
      raise exception 'invalid pin request' using errcode = '22023';
    end if;
    update public.summary_publications
    set visibility = 'public', review_state = case
          when current_revision.author_type = 'admin' then 'admin_revised'
          else 'admin_confirmed' end,
        reviewed_by_actor = target_actor_id,
        published_at = coalesce(published_at, statement_timestamp()),
        pinned_order = target_pinned_order, pinned_until = target_pinned_until,
        updated_at = statement_timestamp()
    where summary_id = target_summary_id;
    update public.lecture_ai_summaries set status = 'published' where id = target_summary_id;
  else
    update public.summary_publications
    set pinned_order = null, pinned_until = null, updated_at = statement_timestamp()
    where summary_id = target_summary_id;
  end if;

  perform private.bump_lecture_live_state(target_lecture_session_id, 'summaries');
  return private.phase6_admin_results_json(target_lecture_session_id);
end;
$$;

create function private.close_phase6_summary_runs()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'closed' and old.status is distinct from 'closed' then
    update public.lecture_summary_runs
    set status = 'closed', stopped_at = statement_timestamp(),
        stop_reason = 'lecture_closed',
        token_hash = encode(extensions.gen_random_bytes(32), 'hex'),
        updated_at = statement_timestamp()
    where lecture_session_id = new.id and status = 'running';
    update public.lecture_summary_windows
    set status = 'discarded', current_operation_id = null,
        last_error_code = 'lecture_closed', updated_at = statement_timestamp()
    where lecture_session_id = new.id and status = 'running';
  end if;
  return new;
end;
$$;

create trigger lecture_sessions_close_phase6_summary_runs
after update of status on public.lecture_sessions
for each row execute function private.close_phase6_summary_runs();

create function private.get_lecture_public_snapshot_v4(
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
declare payload jsonb;
begin
  payload := private.get_lecture_public_snapshot_v3(
    target_lecture_session_id, known_lecture_version, known_caption_version,
    known_comments_version, known_likes_version, known_polls_version,
    known_summaries_version, known_pdf_version, comment_cursor_created_at,
    comment_cursor_id, comment_limit
  );
  if payload is null then return null; end if;
  if (payload -> 'changed') ? 'summaries' then
    payload := jsonb_set(
      payload, '{changed,summaries}',
      private.phase6_public_summaries_json(target_lecture_session_id, 6), true
    );
  end if;
  return payload;
end;
$$;

create function public.get_lecture_public_snapshot_v4(
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
volatile
security invoker
set search_path = ''
as $$
  select private.get_lecture_public_snapshot_v4(
    target_lecture_session_id, known_lecture_version, known_caption_version,
    known_comments_version, known_likes_version, known_polls_version,
    known_summaries_version, known_pdf_version, comment_cursor_created_at,
    comment_cursor_id, comment_limit
  );
$$;

create function private.get_lecture_archive_v3(target_lecture_session_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare payload jsonb;
begin
  payload := private.get_lecture_archive_v2(target_lecture_session_id);
  if payload is null then return null; end if;
  return jsonb_set(
    payload, '{summaries}',
    private.phase6_public_summaries_json(target_lecture_session_id, 12), true
  );
end;
$$;

create function public.get_lecture_archive_v3(target_lecture_session_id uuid)
returns jsonb
language sql
volatile
security invoker
set search_path = ''
as $$ select private.get_lecture_archive_v3(target_lecture_session_id); $$;

create function public.admin_start_lecture_summary_run(
  target_grant_id uuid,
  target_grant_nonce_hash text,
  target_lecture_session_id uuid,
  target_run_token_hash text,
  target_actor_id text
)
returns jsonb language sql volatile security invoker set search_path = ''
as $$ select private.start_lecture_summary_run(
  target_grant_id, target_grant_nonce_hash, target_lecture_session_id,
  target_run_token_hash, target_actor_id
); $$;

create function public.admin_resume_lecture_summary_run(
  target_lecture_session_id uuid,
  target_run_token_hash text,
  target_actor_id text
)
returns jsonb language sql volatile security invoker set search_path = ''
as $$ select private.resume_lecture_summary_run(
  target_lecture_session_id, target_run_token_hash, target_actor_id
); $$;

create function public.admin_stop_lecture_summary_run(
  target_lecture_session_id uuid,
  target_actor_id text,
  target_reason text
)
returns jsonb language sql volatile security invoker set search_path = ''
as $$ select private.stop_lecture_summary_run(
  target_lecture_session_id, target_actor_id, target_reason
); $$;

create function public.admin_start_summary_window_operation(
  target_lecture_session_id uuid, target_run_id uuid,
  target_run_token_hash text, target_actor_id text,
  target_window_index integer, target_prompt_version text, target_model_id text,
  target_source_hashes jsonb, target_source_coverage jsonb,
  estimated_microusd bigint, estimated_input_tokens bigint,
  estimated_output_tokens bigint, input_price_microusd_per_million bigint,
  output_price_microusd_per_million bigint
)
returns jsonb language sql volatile security invoker set search_path = ''
as $$ select private.start_summary_window_operation(
  target_lecture_session_id, target_run_id, target_run_token_hash,
  target_actor_id, target_window_index, target_prompt_version, target_model_id,
  target_source_hashes, target_source_coverage, estimated_microusd,
  estimated_input_tokens, estimated_output_tokens,
  input_price_microusd_per_million, output_price_microusd_per_million
); $$;

create function public.admin_skip_summary_window(
  target_lecture_session_id uuid, target_run_id uuid,
  target_run_token_hash text, target_actor_id text,
  target_window_index integer, target_prompt_version text, target_reason text,
  target_source_hashes jsonb, target_source_coverage jsonb
)
returns jsonb language sql volatile security invoker set search_path = ''
as $$ select private.skip_summary_window(
  target_lecture_session_id, target_run_id, target_run_token_hash,
  target_actor_id, target_window_index, target_prompt_version, target_reason,
  target_source_hashes, target_source_coverage
); $$;

create function public.admin_fail_summary_window_operation(
  target_operation_id uuid, target_run_id uuid, target_actor_id text,
  actual_microusd bigint, actual_input_tokens bigint, actual_output_tokens bigint,
  provider_request_id text, target_error_code text
)
returns jsonb language sql volatile security invoker set search_path = ''
as $$ select private.fail_summary_window_operation(
  target_operation_id, target_run_id, target_actor_id, actual_microusd,
  actual_input_tokens, actual_output_tokens, provider_request_id, target_error_code
); $$;

create function public.admin_complete_summary_window_operation(
  target_operation_id uuid, target_run_id uuid, target_actor_id text,
  actual_microusd bigint, actual_input_tokens bigint, actual_output_tokens bigint,
  provider_request_id text, target_model_id text, target_ai_output jsonb,
  target_quality_result jsonb, publish_recommended boolean
)
returns jsonb language sql volatile security invoker set search_path = ''
as $$ select private.complete_summary_window_operation(
  target_operation_id, target_run_id, target_actor_id, actual_microusd,
  actual_input_tokens, actual_output_tokens, provider_request_id,
  target_model_id, target_ai_output, target_quality_result, publish_recommended
); $$;

create function public.admin_manage_summary_publication(
  target_lecture_session_id uuid, target_summary_id uuid, target_actor_id text,
  target_action text, target_body jsonb default null, target_reason text default null,
  target_pinned_order integer default null, target_pinned_until timestamptz default null
)
returns jsonb language sql volatile security invoker set search_path = ''
as $$ select private.manage_summary_publication(
  target_lecture_session_id, target_summary_id, target_actor_id, target_action,
  target_body, target_reason, target_pinned_order, target_pinned_until
); $$;

create function public.admin_get_phase6_summary_results(target_lecture_session_id uuid)
returns jsonb language sql stable security invoker set search_path = ''
as $$ select private.phase6_admin_results_json(target_lecture_session_id); $$;

revoke all on function private.phase6_revision_body_is_valid(jsonb)
  from public, anon, authenticated, service_role;
revoke all on function private.phase6_public_summaries_json(uuid, integer)
  from public, anon, authenticated, service_role;
revoke all on function private.phase6_comment_context(uuid, timestamptz, timestamptz)
  from public, anon, authenticated, service_role;
revoke all on function private.phase6_admin_results_json(uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.start_lecture_summary_run(uuid, text, uuid, text, text)
  from public, anon, authenticated, service_role;
revoke all on function private.resume_lecture_summary_run(uuid, text, text)
  from public, anon, authenticated, service_role;
revoke all on function private.stop_lecture_summary_run(uuid, text, text)
  from public, anon, authenticated, service_role;
revoke all on function private.start_summary_window_operation(
  uuid, uuid, text, text, integer, text, text, jsonb, jsonb,
  bigint, bigint, bigint, bigint, bigint
) from public, anon, authenticated, service_role;
revoke all on function private.skip_summary_window(
  uuid, uuid, text, text, integer, text, text, jsonb, jsonb
) from public, anon, authenticated, service_role;
revoke all on function private.fail_summary_window_operation(
  uuid, uuid, text, bigint, bigint, bigint, text, text
) from public, anon, authenticated, service_role;
revoke all on function private.complete_summary_window_operation(
  uuid, uuid, text, bigint, bigint, bigint, text, text, jsonb, jsonb, boolean
) from public, anon, authenticated, service_role;
revoke all on function private.manage_summary_publication(
  uuid, uuid, text, text, jsonb, text, integer, timestamptz
) from public, anon, authenticated, service_role;
revoke all on function private.close_phase6_summary_runs()
  from public, anon, authenticated, service_role;
revoke all on function private.get_lecture_public_snapshot_v4(
  uuid, bigint, bigint, bigint, bigint, bigint, bigint, bigint,
  timestamptz, uuid, integer
) from public, anon, authenticated, service_role;
revoke all on function private.get_lecture_archive_v3(uuid)
  from public, anon, authenticated, service_role;

grant execute on function private.phase6_admin_results_json(uuid) to service_role;
grant execute on function private.start_lecture_summary_run(uuid, text, uuid, text, text)
  to service_role;
grant execute on function private.resume_lecture_summary_run(uuid, text, text)
  to service_role;
grant execute on function private.stop_lecture_summary_run(uuid, text, text)
  to service_role;
grant execute on function private.start_summary_window_operation(
  uuid, uuid, text, text, integer, text, text, jsonb, jsonb,
  bigint, bigint, bigint, bigint, bigint
) to service_role;
grant execute on function private.skip_summary_window(
  uuid, uuid, text, text, integer, text, text, jsonb, jsonb
) to service_role;
grant execute on function private.fail_summary_window_operation(
  uuid, uuid, text, bigint, bigint, bigint, text, text
) to service_role;
grant execute on function private.complete_summary_window_operation(
  uuid, uuid, text, bigint, bigint, bigint, text, text, jsonb, jsonb, boolean
) to service_role;
grant execute on function private.manage_summary_publication(
  uuid, uuid, text, text, jsonb, text, integer, timestamptz
) to service_role;
grant execute on function private.get_lecture_public_snapshot_v4(
  uuid, bigint, bigint, bigint, bigint, bigint, bigint, bigint,
  timestamptz, uuid, integer
) to authenticated;
grant execute on function private.get_lecture_archive_v3(uuid) to authenticated;

revoke all on function public.get_lecture_public_snapshot_v4(
  uuid, bigint, bigint, bigint, bigint, bigint, bigint, bigint,
  timestamptz, uuid, integer
) from public, anon, authenticated, service_role;
revoke all on function public.get_lecture_archive_v3(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.admin_start_lecture_summary_run(uuid, text, uuid, text, text)
  from public, anon, authenticated, service_role;
revoke all on function public.admin_resume_lecture_summary_run(uuid, text, text)
  from public, anon, authenticated, service_role;
revoke all on function public.admin_stop_lecture_summary_run(uuid, text, text)
  from public, anon, authenticated, service_role;
revoke all on function public.admin_start_summary_window_operation(
  uuid, uuid, text, text, integer, text, text, jsonb, jsonb,
  bigint, bigint, bigint, bigint, bigint
) from public, anon, authenticated, service_role;
revoke all on function public.admin_skip_summary_window(
  uuid, uuid, text, text, integer, text, text, jsonb, jsonb
) from public, anon, authenticated, service_role;
revoke all on function public.admin_fail_summary_window_operation(
  uuid, uuid, text, bigint, bigint, bigint, text, text
) from public, anon, authenticated, service_role;
revoke all on function public.admin_complete_summary_window_operation(
  uuid, uuid, text, bigint, bigint, bigint, text, text, jsonb, jsonb, boolean
) from public, anon, authenticated, service_role;
revoke all on function public.admin_manage_summary_publication(
  uuid, uuid, text, text, jsonb, text, integer, timestamptz
) from public, anon, authenticated, service_role;
revoke all on function public.admin_get_phase6_summary_results(uuid)
  from public, anon, authenticated, service_role;

grant execute on function public.get_lecture_public_snapshot_v4(
  uuid, bigint, bigint, bigint, bigint, bigint, bigint, bigint,
  timestamptz, uuid, integer
) to authenticated;
grant execute on function public.get_lecture_archive_v3(uuid) to authenticated;
grant execute on function public.admin_start_lecture_summary_run(uuid, text, uuid, text, text)
  to service_role;
grant execute on function public.admin_resume_lecture_summary_run(uuid, text, text)
  to service_role;
grant execute on function public.admin_stop_lecture_summary_run(uuid, text, text)
  to service_role;
grant execute on function public.admin_start_summary_window_operation(
  uuid, uuid, text, text, integer, text, text, jsonb, jsonb,
  bigint, bigint, bigint, bigint, bigint
) to service_role;
grant execute on function public.admin_skip_summary_window(
  uuid, uuid, text, text, integer, text, text, jsonb, jsonb
) to service_role;
grant execute on function public.admin_fail_summary_window_operation(
  uuid, uuid, text, bigint, bigint, bigint, text, text
) to service_role;
grant execute on function public.admin_complete_summary_window_operation(
  uuid, uuid, text, bigint, bigint, bigint, text, text, jsonb, jsonb, boolean
) to service_role;
grant execute on function public.admin_manage_summary_publication(
  uuid, uuid, text, text, jsonb, text, integer, timestamptz
) to service_role;
grant execute on function public.admin_get_phase6_summary_results(uuid) to service_role;

comment on table public.lecture_summary_runs is
  'Billing-authorized, actor-bound summary automation runs; tokens are stored only as hashes.';
comment on table public.lecture_summary_windows is
  'Deterministic server-time five-minute windows with no raw transcript or PDF text.';
comment on table public.lecture_ai_summaries is
  'Bounded accepted Phase 6 structured model outputs; source text is never stored.';
comment on table public.lecture_ai_summary_revisions is
  'Immutable AI/Admin summary revision history.';
comment on table public.summary_publications is
  'Compact student publication pointer, visibility, review and pin state.';
