-- Phase 7.2: verified-primary-literature academic reference answers.
-- Expand-first: all Phase 0-7.1 contracts remain available and the new
-- browser/Edge capability is dormant behind default-OFF flags.

alter table public.ai_usage_ledger
  add column provider_dispatched_at timestamptz,
  add column accounting_settled_at timestamptz,
  add column settlement_status text
    check (settlement_status is null or settlement_status in (
      'actual', 'released', 'conservative', 'legacy_reserved'
    ));

update public.ai_usage_ledger
set
  accounting_settled_at = coalesce(finished_at, requested_at),
  settlement_status = 'legacy_reserved'
where status <> 'running';

create index ai_usage_ledger_unsettled_idx
  on public.ai_usage_ledger (lecture_session_id, id)
  where accounting_settled_at is null;

-- A completion replaces the reservation exactly once. A terminal operation
-- created by lecture close may still settle provider usage, but can never
-- accept content. Existing terminal rows are backfilled as already settled.
create or replace function private.finish_lecture_ai_operation(
  target_operation_id uuid,
  target_status text,
  actual_microusd bigint,
  actual_audio_seconds integer,
  actual_input_tokens bigint,
  actual_output_tokens bigint,
  provider_request_id text,
  error_code text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  initial_usage public.ai_usage_ledger%rowtype;
  usage_row public.ai_usage_ledger%rowtype;
  control_row public.lecture_ai_control%rowtype;
  lecture_row public.lecture_sessions%rowtype;
  effective_status text;
  accept_result boolean;
  remaining_running_count integer;
  was_running boolean;
  effective_settlement_status text;
begin
  if target_status not in ('succeeded', 'failed', 'cancelled') then
    raise exception 'invalid AI completion status' using errcode = '22023';
  end if;
  if least(
    actual_microusd,
    actual_audio_seconds::bigint,
    actual_input_tokens,
    actual_output_tokens
  ) < 0 then
    raise exception 'AI actual usage cannot be negative' using errcode = '22023';
  end if;

  select usage.* into initial_usage
  from public.ai_usage_ledger as usage
  where usage.id = target_operation_id;
  if not found then
    raise exception 'AI operation not found' using errcode = 'P0002';
  end if;

  perform private.close_lecture_if_expired(initial_usage.lecture_session_id);

  select lecture.* into lecture_row
  from public.lecture_sessions as lecture
  where lecture.id = initial_usage.lecture_session_id
  for update;

  select control.* into control_row
  from public.lecture_ai_control as control
  where control.lecture_session_id = initial_usage.lecture_session_id
  for update;
  if not found then
    raise exception 'AI control is not configured' using errcode = 'P0001';
  end if;

  select usage.* into usage_row
  from public.ai_usage_ledger as usage
  where usage.id = target_operation_id
  for update;

  if usage_row.accounting_settled_at is not null then
    return jsonb_build_object(
      'accepted', usage_row.result_accepted,
      'idempotent_replay', true,
      'operation', to_jsonb(usage_row)
    );
  end if;

  was_running := usage_row.status = 'running';
  accept_result := was_running
    and target_status = 'succeeded'
    and lecture_row.status = 'open'
    and lecture_row.hard_stop_at > statement_timestamp()
    and control_row.status not in ('stopping', 'stopped');
  effective_status := case
    when not was_running then usage_row.status
    when target_status = 'succeeded' and not accept_result then 'discarded'
    else target_status
  end;
  effective_settlement_status := case
    when actual_microusd = 0
      and actual_audio_seconds = 0
      and actual_input_tokens = 0
      and actual_output_tokens = 0 then 'released'
    when error_code like '%ambiguous%' then 'conservative'
    else 'actual'
  end;

  update public.ai_usage_ledger as usage
  set
    status = effective_status,
    actual_microusd = finish_lecture_ai_operation.actual_microusd,
    actual_audio_seconds = finish_lecture_ai_operation.actual_audio_seconds,
    actual_input_tokens = finish_lecture_ai_operation.actual_input_tokens,
    actual_output_tokens = finish_lecture_ai_operation.actual_output_tokens,
    provider_request_id = nullif(trim(finish_lecture_ai_operation.provider_request_id), ''),
    error_code = nullif(trim(finish_lecture_ai_operation.error_code), ''),
    result_accepted = accept_result,
    finished_at = coalesce(usage.finished_at, statement_timestamp()),
    accounting_settled_at = statement_timestamp(),
    settlement_status = effective_settlement_status
  where usage.id = target_operation_id
  returning * into usage_row;

  select count(*)::integer into remaining_running_count
  from public.ai_usage_ledger as usage
  where usage.lecture_session_id = usage_row.lecture_session_id
    and usage.status = 'running';

  update public.lecture_ai_control as control
  set
    active_operation_count = remaining_running_count,
    status = case
      when control.status in ('stopping', 'stopped') then 'stopped'
      when remaining_running_count > 0 then 'running'
      when control.captions_enabled
        or control.summaries_enabled
        or control.material_analysis_enabled
        or control.poll_suggestions_enabled
        or control.academic_answers_enabled then 'ready'
      else 'disabled'
    end,
    used_microusd = greatest(
      control.used_microusd - usage_row.reserved_microusd + actual_microusd,
      0
    ),
    audio_seconds_used = greatest(
      control.audio_seconds_used - usage_row.reserved_audio_seconds + actual_audio_seconds,
      0
    ),
    input_tokens_used = greatest(
      control.input_tokens_used - usage_row.reserved_input_tokens + actual_input_tokens,
      0
    ),
    output_tokens_used = greatest(
      control.output_tokens_used - usage_row.reserved_output_tokens + actual_output_tokens,
      0
    ),
    last_heartbeat_at = statement_timestamp(),
    stopped_at = case
      when control.status in ('stopping', 'stopped') then statement_timestamp()
      else control.stopped_at
    end,
    version = control.version + 1,
    updated_at = statement_timestamp()
  where control.lecture_session_id = usage_row.lecture_session_id;

  return jsonb_build_object(
    'accepted', accept_result,
    'idempotent_replay', false,
    'operation', to_jsonb(usage_row)
  );
end;
$$;

create table public.academic_answer_requests (
  id uuid primary key default extensions.gen_random_uuid(),
  lecture_session_id uuid not null
    references public.lecture_sessions(id) on delete restrict,
  requested_by_actor text not null
    check (char_length(requested_by_actor) between 1 and 200),
  idempotency_key text not null
    check (char_length(idempotency_key) between 8 and 160),
  source_kind text not null
    check (source_kind in ('summary_candidate', 'teacher_selected')),
  source_summary_id uuid
    references public.lecture_ai_summaries(id) on delete restrict,
  question text not null check (char_length(question) between 10 and 500),
  question_sha256 text not null check (question_sha256 ~ '^[0-9a-f]{64}$'),
  search_query_sha256 text not null
    check (search_query_sha256 ~ '^[0-9a-f]{64}$'),
  status text not null default 'evidence_checking' check (status in (
    'evidence_checking', 'insufficient_evidence', 'running',
    'awaiting_review', 'failed', 'discarded', 'rejected',
    'published', 'hidden'
  )),
  lease_until timestamptz,
  operation_id uuid unique
    references public.ai_usage_ledger(id) on delete restrict,
  verified_source_count integer not null default 0
    check (verified_source_count between 0 and 5),
  verified_primary_count integer not null default 0
    check (verified_primary_count between 0 and 5),
  source_set_sha256 text
    check (source_set_sha256 is null or source_set_sha256 ~ '^[0-9a-f]{64}$'),
  prompt_version text
    check (prompt_version is null or char_length(prompt_version) between 1 and 120),
  provider_dispatched_at timestamptz,
  error_code text check (error_code is null or char_length(error_code) <= 120),
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  unique (lecture_session_id, idempotency_key),
  check (
    (source_kind = 'summary_candidate' and source_summary_id is not null)
    or (source_kind = 'teacher_selected' and source_summary_id is null)
  )
);

create index academic_answer_requests_lecture_created_idx
  on public.academic_answer_requests (lecture_session_id, created_at desc);
create index academic_answer_requests_summary_idx
  on public.academic_answer_requests (source_summary_id)
  where source_summary_id is not null;
create index academic_answer_requests_lease_idx
  on public.academic_answer_requests (lease_until, id)
  where status = 'evidence_checking';

create table public.lecture_academic_answers (
  id uuid primary key default extensions.gen_random_uuid(),
  lecture_session_id uuid not null
    references public.lecture_sessions(id) on delete restrict,
  request_id uuid not null unique
    references public.academic_answer_requests(id) on delete restrict,
  operation_id uuid not null unique
    references public.ai_usage_ledger(id) on delete restrict,
  question text not null check (char_length(question) between 10 and 500),
  source_kind text not null
    check (source_kind in ('summary_candidate', 'teacher_selected')),
  source_summary_id uuid
    references public.lecture_ai_summaries(id) on delete restrict,
  model_id text not null check (char_length(model_id) between 1 and 120),
  prompt_version text not null check (char_length(prompt_version) between 1 and 120),
  source_set_sha256 text not null check (source_set_sha256 ~ '^[0-9a-f]{64}$'),
  quality_result jsonb not null default '{}'::jsonb
    check (pg_column_size(quality_result) <= 4096),
  status text not null default 'awaiting_review'
    check (status in ('awaiting_review', 'published', 'hidden', 'rejected')),
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp()
);

create index lecture_academic_answers_lecture_created_idx
  on public.lecture_academic_answers (lecture_session_id, created_at desc);
create index lecture_academic_answers_summary_idx
  on public.lecture_academic_answers (source_summary_id)
  where source_summary_id is not null;

create table public.academic_answer_sources (
  id uuid primary key default extensions.gen_random_uuid(),
  answer_id uuid not null
    references public.lecture_academic_answers(id) on delete restrict,
  lecture_session_id uuid not null
    references public.lecture_sessions(id) on delete restrict,
  source_id text not null check (source_id ~ '^pmid:[0-9]{1,9}$'),
  pmid text not null check (pmid ~ '^[0-9]{1,9}$'),
  doi text check (
    doi is null or (
      char_length(doi) between 7 and 255
      and doi ~ '^10\.[0-9]{4,9}/\S+$'
    )
  ),
  title text not null check (char_length(title) between 3 and 500),
  publication_year integer not null check (publication_year between 1800 and 2200),
  authors jsonb not null check (
    jsonb_typeof(authors) = 'array'
    and jsonb_array_length(authors) between 1 and 20
    and pg_column_size(authors) <= 4096
  ),
  journal text not null check (char_length(journal) <= 240),
  publication_types jsonb not null check (
    jsonb_typeof(publication_types) = 'array'
    and jsonb_array_length(publication_types) between 1 and 16
    and pg_column_size(publication_types) <= 2048
  ),
  study_type text not null check (char_length(study_type) between 1 and 120),
  source_role text not null check (source_role in ('primary', 'context')),
  verification jsonb not null check (
    jsonb_typeof(verification) = 'object'
    and verification ->> 'passed' = 'true'
    and pg_column_size(verification) <= 2048
  ),
  verified_at timestamptz not null default statement_timestamp(),
  unique (answer_id, source_id),
  unique (lecture_session_id, answer_id, source_id),
  check (source_id = 'pmid:' || pmid)
);

create index academic_answer_sources_answer_idx
  on public.academic_answer_sources (answer_id, source_role, source_id);
create index academic_answer_sources_lecture_idx
  on public.academic_answer_sources (lecture_session_id, answer_id);

create function private.phase72_answer_body_is_valid(target_body jsonb)
returns boolean
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  point jsonb;
begin
  if target_body is null
     or jsonb_typeof(target_body) is distinct from 'object'
     or exists (
       select 1 from jsonb_object_keys(target_body) as key_name
       where key_name not in ('answer_points', 'limitations')
     )
     or jsonb_typeof(target_body -> 'answer_points') is distinct from 'array'
     or jsonb_array_length(target_body -> 'answer_points') not between 1 and 5
     or jsonb_typeof(target_body -> 'limitations') is distinct from 'array'
     or jsonb_array_length(target_body -> 'limitations') > 3
     or pg_column_size(target_body) > 16384 then
    return false;
  end if;
  if exists (
    select 1 from jsonb_array_elements_text(target_body -> 'limitations') as item(value)
    where char_length(trim(item.value)) not between 1 and 300
  ) then return false; end if;
  for point in select value from jsonb_array_elements(target_body -> 'answer_points')
  loop
    if jsonb_typeof(point) is distinct from 'object'
       or exists (
         select 1 from jsonb_object_keys(point) as key_name
         where key_name not in ('text', 'source_ids')
       )
       or jsonb_typeof(point -> 'text') is distinct from 'string'
       or char_length(trim(point ->> 'text')) not between 1 and 500
       or jsonb_typeof(point -> 'source_ids') is distinct from 'array'
       or jsonb_array_length(point -> 'source_ids') not between 1 and 3
       or exists (
         select 1 from jsonb_array_elements_text(point -> 'source_ids') as source(value)
         where source.value !~ '^pmid:[0-9]{1,9}$'
       ) then
      return false;
    end if;
  end loop;
  return true;
exception when others then
  return false;
end;
$$;

create table public.academic_answer_revisions (
  id uuid primary key default extensions.gen_random_uuid(),
  answer_id uuid not null
    references public.lecture_academic_answers(id) on delete restrict,
  lecture_session_id uuid not null
    references public.lecture_sessions(id) on delete restrict,
  revision_number integer not null check (revision_number >= 1),
  body jsonb not null check (private.phase72_answer_body_is_valid(body)),
  author_type text not null check (author_type in ('ai', 'admin')),
  author_actor_id text check (
    author_actor_id is null or char_length(author_actor_id) between 1 and 200
  ),
  reason text check (reason is null or char_length(reason) <= 300),
  created_at timestamptz not null default statement_timestamp(),
  unique (answer_id, revision_number),
  unique (lecture_session_id, answer_id, id)
);

create index academic_answer_revisions_answer_idx
  on public.academic_answer_revisions (answer_id, revision_number desc);

create table public.academic_answer_publications (
  answer_id uuid primary key
    references public.lecture_academic_answers(id) on delete restrict,
  lecture_session_id uuid not null
    references public.lecture_sessions(id) on delete restrict,
  active_revision_id uuid not null,
  visibility text not null default 'hidden'
    check (visibility in ('hidden', 'public')),
  review_state text not null default 'ai_unreviewed'
    check (review_state in ('ai_unreviewed', 'admin_confirmed', 'admin_revised')),
  reviewed_by_actor_id text check (
    reviewed_by_actor_id is null
    or char_length(reviewed_by_actor_id) between 1 and 200
  ),
  published_at timestamptz,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  foreign key (lecture_session_id, answer_id, active_revision_id)
    references public.academic_answer_revisions(
      lecture_session_id, answer_id, id
    ) on delete restrict,
  check (
    (visibility = 'hidden')
    or (
      visibility = 'public'
      and review_state in ('admin_confirmed', 'admin_revised')
      and reviewed_by_actor_id is not null
      and published_at is not null
    )
  )
);

create index academic_answer_publications_public_idx
  on public.academic_answer_publications (lecture_session_id, published_at desc)
  where visibility = 'public';
create index academic_answer_publications_revision_fk_idx
  on public.academic_answer_publications (
    lecture_session_id, answer_id, active_revision_id
  );

alter table public.academic_answer_requests enable row level security;
alter table public.lecture_academic_answers enable row level security;
alter table public.academic_answer_sources enable row level security;
alter table public.academic_answer_revisions enable row level security;
alter table public.academic_answer_publications enable row level security;

revoke all on public.academic_answer_requests from public, anon, authenticated;
revoke all on public.lecture_academic_answers from public, anon, authenticated;
revoke all on public.academic_answer_sources from public, anon, authenticated;
revoke all on public.academic_answer_revisions from public, anon, authenticated;
revoke all on public.academic_answer_publications from public, anon, authenticated;
grant select, insert, update on public.academic_answer_requests to service_role;
grant select, insert, update on public.lecture_academic_answers to service_role;
grant select, insert on public.academic_answer_sources to service_role;
grant select, insert on public.academic_answer_revisions to service_role;
grant select, insert, update on public.academic_answer_publications to service_role;

create function private.phase72_public_answers_json(
  target_lecture_session_id uuid,
  answer_limit integer default 3
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(answer_payload order by published_at desc), '[]'::jsonb)
  from (
    select
      publication.published_at,
      jsonb_build_object(
        'id', answer.id,
        'question', answer.question,
        'review_state', publication.review_state,
        'published_at', publication.published_at,
        'revision_id', revision.id,
        'body', revision.body,
        'sources', coalesce((
          select jsonb_agg(jsonb_build_object(
            'source_id', source.source_id,
            'pmid', source.pmid,
            'doi', source.doi,
            'title', source.title,
            'publication_year', source.publication_year,
            'authors', source.authors,
            'journal', source.journal,
            'publication_types', source.publication_types,
            'study_type', source.study_type,
            'source_role', source.source_role
          ) order by source.source_role desc, source.publication_year desc, source.source_id)
          from public.academic_answer_sources as source
          where source.answer_id = answer.id
            and source.lecture_session_id = answer.lecture_session_id
        ), '[]'::jsonb)
      ) as answer_payload
    from public.academic_answer_publications as publication
    join public.lecture_academic_answers as answer
      on answer.id = publication.answer_id
     and answer.lecture_session_id = publication.lecture_session_id
    join public.academic_answer_revisions as revision
      on revision.id = publication.active_revision_id
     and revision.answer_id = answer.id
     and revision.lecture_session_id = answer.lecture_session_id
    where publication.lecture_session_id = target_lecture_session_id
      and publication.visibility = 'public'
      and publication.review_state in ('admin_confirmed', 'admin_revised')
    order by publication.published_at desc, answer.id
    limit least(greatest(answer_limit, 1), 3)
  ) as published;
$$;

create function private.phase72_admin_results_json(target_lecture_session_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'control', case when control.lecture_session_id is null then null else jsonb_build_object(
      'academic_answers_enabled', control.academic_answers_enabled,
      'academic_answer_limit', least(control.academic_answer_limit, 3),
      'academic_answer_calls_used', control.academic_answer_calls_used,
      'budget_limit_microusd', control.budget_limit_microusd,
      'used_microusd', control.used_microusd,
      'status', control.status
    ) end,
    'active_requests', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', request.id,
        'operation_id', request.operation_id,
        'question', request.question,
        'status', request.status,
        'updated_at', request.updated_at
      ) order by request.created_at desc)
      from public.academic_answer_requests as request
      where request.lecture_session_id = target_lecture_session_id
        and request.status in ('evidence_checking', 'running')
    ), '[]'::jsonb),
    'candidates', coalesce((
      select jsonb_agg(jsonb_build_object(
        'summary_id', summary.id,
        'question', summary.ai_output #>> '{academic_question_candidate,question}',
        'educational_value', summary.ai_output #>> '{academic_question_candidate,educationalValue}',
        'quality_score', summary.ai_output #> '{academic_question_candidate,qualityScore}',
        'window_index', summary_window.window_index
      ) order by summary_window.window_index desc)
      from public.lecture_ai_summaries as summary
      join public.lecture_summary_windows as summary_window
        on summary_window.id = summary.window_id
      where summary.lecture_session_id = target_lecture_session_id
        and summary.ai_output -> 'academic_question_candidate' is not null
        and summary.ai_output -> 'academic_question_candidate' <> 'null'::jsonb
      limit 12
    ), '[]'::jsonb),
    'answers', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', answer.id,
        'request_id', answer.request_id,
        'operation_id', answer.operation_id,
        'question', answer.question,
        'source_kind', answer.source_kind,
        'source_summary_id', answer.source_summary_id,
        'model_id', answer.model_id,
        'prompt_version', answer.prompt_version,
        'quality_result', answer.quality_result,
        'status', answer.status,
        'created_at', answer.created_at,
        'sources', coalesce((
          select jsonb_agg(to_jsonb(source) - 'answer_id' - 'lecture_session_id' order by source.source_id)
          from public.academic_answer_sources as source
          where source.answer_id = answer.id
        ), '[]'::jsonb),
        'revisions', coalesce((
          select jsonb_agg(to_jsonb(revision) - 'answer_id' - 'lecture_session_id' order by revision.revision_number)
          from public.academic_answer_revisions as revision
          where revision.answer_id = answer.id
        ), '[]'::jsonb),
        'publication', case when publication.answer_id is null then null else
          to_jsonb(publication) - 'lecture_session_id' end
      ) order by answer.created_at desc, answer.id)
      from public.lecture_academic_answers as answer
      left join public.academic_answer_publications as publication
        on publication.answer_id = answer.id
      where answer.lecture_session_id = target_lecture_session_id
    ), '[]'::jsonb)
  )
  from public.lecture_sessions as lecture
  left join public.lecture_ai_control as control
    on control.lecture_session_id = lecture.id
  where lecture.id = target_lecture_session_id;
$$;

create function private.prepare_academic_answer_request(
  target_lecture_session_id uuid,
  target_actor_id text,
  target_idempotency_key text,
  target_source_kind text,
  target_source_summary_id uuid,
  target_question text,
  target_question_sha256 text,
  target_search_query_sha256 text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  lecture_row public.lecture_sessions%rowtype;
  request_row public.academic_answer_requests%rowtype;
  candidate_question text;
begin
  if nullif(trim(target_actor_id), '') is null
     or char_length(target_actor_id) > 200
     or char_length(trim(coalesce(target_question, ''))) not between 10 and 500
     or char_length(target_idempotency_key) not between 8 and 160
     or target_question_sha256 !~ '^[0-9a-f]{64}$'
     or target_search_query_sha256 !~ '^[0-9a-f]{64}$'
     or target_source_kind not in ('summary_candidate', 'teacher_selected') then
    raise exception 'invalid academic answer request' using errcode = '22023';
  end if;

  perform private.close_lecture_if_expired(target_lecture_session_id);
  select lecture.* into lecture_row
  from public.lecture_sessions as lecture
  where lecture.id = target_lecture_session_id
  for update;
  if not found or lecture_row.status <> 'open'
     or lecture_row.hard_stop_at <= statement_timestamp() then
    raise exception 'lecture is not open' using errcode = 'P0001';
  end if;

  if target_source_kind = 'summary_candidate' then
    select summary.ai_output #>> '{academic_question_candidate,question}'
    into candidate_question
    from public.lecture_ai_summaries as summary
    where summary.id = target_source_summary_id
      and summary.lecture_session_id = target_lecture_session_id;
    if candidate_question is null
       or trim(candidate_question) <> trim(target_question) then
      raise exception 'academic question candidate mismatch' using errcode = '42501';
    end if;
  elsif target_source_summary_id is not null then
    raise exception 'teacher question cannot reference a summary' using errcode = '22023';
  end if;

  select request.* into request_row
  from public.academic_answer_requests as request
  where request.lecture_session_id = target_lecture_session_id
    and request.idempotency_key = target_idempotency_key
  for update;
  if found then
    if request_row.requested_by_actor <> target_actor_id
       or request_row.question_sha256 <> target_question_sha256
       or request_row.search_query_sha256 <> target_search_query_sha256
       or request_row.source_kind <> target_source_kind
       or request_row.source_summary_id is distinct from target_source_summary_id then
      raise exception 'academic request idempotency mismatch' using errcode = '22023';
    end if;
    return jsonb_build_object(
      'idempotent_replay', true,
      'request', to_jsonb(request_row),
      'results', private.phase72_admin_results_json(target_lecture_session_id)
    );
  end if;

  insert into public.academic_answer_requests (
    lecture_session_id, requested_by_actor, idempotency_key, source_kind,
    source_summary_id, question, question_sha256, search_query_sha256,
    status, lease_until
  ) values (
    target_lecture_session_id, trim(target_actor_id), target_idempotency_key,
    target_source_kind, target_source_summary_id, trim(target_question),
    target_question_sha256, target_search_query_sha256,
    'evidence_checking', statement_timestamp() + interval '45 seconds'
  ) returning * into request_row;
  return jsonb_build_object(
    'idempotent_replay', false,
    'request', to_jsonb(request_row)
  );
end;
$$;

create function private.mark_academic_answer_insufficient(
  target_request_id uuid,
  target_actor_id text,
  target_reason text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare request_row public.academic_answer_requests%rowtype;
begin
  select request.* into request_row
  from public.academic_answer_requests as request
  where request.id = target_request_id
  for update;
  if not found or request_row.requested_by_actor <> target_actor_id then
    raise exception 'academic request is not owned by this actor' using errcode = '42501';
  end if;
  if request_row.status = 'insufficient_evidence' then return to_jsonb(request_row); end if;
  if request_row.status <> 'evidence_checking' then
    raise exception 'academic request is not checking evidence' using errcode = 'P0001';
  end if;
  update public.academic_answer_requests
  set status = 'insufficient_evidence', lease_until = null,
      error_code = left(coalesce(nullif(trim(target_reason), ''), 'insufficient_evidence'), 120),
      updated_at = statement_timestamp()
  where id = target_request_id
  returning * into request_row;
  return to_jsonb(request_row);
end;
$$;

create function private.start_academic_answer_operation(
  target_request_id uuid,
  target_grant_id uuid,
  target_nonce_hash text,
  target_actor_id text,
  target_model_id text,
  target_prompt_version text,
  target_source_set_sha256 text,
  target_verified_source_count integer,
  target_verified_primary_count integer,
  estimated_microusd bigint,
  estimated_input_tokens bigint,
  estimated_output_tokens bigint,
  target_input_price_microusd_per_million bigint,
  target_output_price_microusd_per_million bigint
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  request_row public.academic_answer_requests%rowtype;
  control_row public.lecture_ai_control%rowtype;
  start_result jsonb;
  created_operation_id uuid;
begin
  select request.* into request_row
  from public.academic_answer_requests as request
  where request.id = target_request_id
  for update;
  if not found or request_row.requested_by_actor <> target_actor_id then
    raise exception 'academic request is not owned by this actor' using errcode = '42501';
  end if;
  if request_row.status <> 'evidence_checking'
     or request_row.lease_until <= statement_timestamp()
     or target_verified_source_count not between 1 and 5
     or target_verified_primary_count not between 1 and target_verified_source_count
     or target_source_set_sha256 !~ '^[0-9a-f]{64}$'
     or char_length(coalesce(target_prompt_version, '')) not between 1 and 120
     or target_input_price_microusd_per_million < 0
     or target_output_price_microusd_per_million < 0 then
    raise exception 'academic evidence admission rejected' using errcode = 'P0001';
  end if;

  -- Preserve the billing lock order used by Phase 4.1.
  perform 1
  from public.ai_billing_grants as billing_grant
  where billing_grant.id = target_grant_id
    and billing_grant.lecture_session_id = request_row.lecture_session_id
  for update;
  perform 1
  from public.lecture_sessions as lecture
  where lecture.id = request_row.lecture_session_id
  for update;
  select control.* into control_row
  from public.lecture_ai_control as control
  where control.lecture_session_id = request_row.lecture_session_id
  for update;
  if not found or control_row.academic_answer_calls_used >= least(
    control_row.academic_answer_limit, 3
  ) then
    return jsonb_build_object('accepted', false, 'reason', 'academic_answer_limit');
  end if;

  start_result := private.consume_ai_billing_grant_and_start_operations(
    target_grant_id,
    target_nonce_hash,
    request_row.lecture_session_id,
    jsonb_build_array(jsonb_build_object(
      'feature', 'academic_answers',
      'idempotency_key', request_row.idempotency_key,
      'model_id', target_model_id,
      'pricing_unit', 'token',
      'pricing_rate_microusd', target_input_price_microusd_per_million,
      'estimated_microusd', estimated_microusd,
      'estimated_audio_seconds', 0,
      'estimated_input_tokens', estimated_input_tokens,
      'estimated_output_tokens', estimated_output_tokens
    )),
    target_actor_id
  );
  if coalesce((start_result ->> 'accepted')::boolean, false) is not true then
    return start_result;
  end if;
  created_operation_id := (start_result #>> '{operations,0,operation,id}')::uuid;
  update public.academic_answer_requests
  set status = 'running', operation_id = created_operation_id,
      verified_source_count = target_verified_source_count,
      verified_primary_count = target_verified_primary_count,
      source_set_sha256 = target_source_set_sha256,
      prompt_version = target_prompt_version,
      lease_until = null, updated_at = statement_timestamp()
  where id = target_request_id;
  return start_result || jsonb_build_object('request_id', target_request_id);
end;
$$;

create function private.mark_academic_provider_dispatched(
  target_request_id uuid,
  target_operation_id uuid,
  target_actor_id text
)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  update public.academic_answer_requests as request
  set provider_dispatched_at = coalesce(request.provider_dispatched_at, statement_timestamp()),
      updated_at = statement_timestamp()
  where request.id = target_request_id
    and request.operation_id = target_operation_id
    and request.requested_by_actor = target_actor_id
    and request.status = 'running';
  if not found then return false; end if;
  update public.ai_usage_ledger as usage
  set provider_dispatched_at = coalesce(usage.provider_dispatched_at, statement_timestamp())
  where usage.id = target_operation_id
    and usage.feature = 'academic_answers'
    and usage.requested_by_actor = target_actor_id;
  return found;
end;
$$;

create function private.complete_academic_answer_operation(
  target_request_id uuid,
  target_operation_id uuid,
  target_actor_id text,
  target_sources jsonb,
  target_body jsonb,
  target_quality_result jsonb,
  actual_microusd bigint,
  actual_input_tokens bigint,
  actual_output_tokens bigint,
  provider_request_id text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  request_row public.academic_answer_requests%rowtype;
  usage_row public.ai_usage_ledger%rowtype;
  completion jsonb;
  answer_id uuid;
  revision_id uuid;
  source jsonb;
  point jsonb;
  source_ids text[] := '{}'::text[];
  primary_ids text[] := '{}'::text[];
  point_ids text[];
begin
  select request.* into request_row
  from public.academic_answer_requests as request
  where request.id = target_request_id
  for update;
  select usage.* into usage_row
  from public.ai_usage_ledger as usage
  where usage.id = target_operation_id
  for update;
  if request_row.id is null or usage_row.id is null
     or request_row.operation_id <> target_operation_id
     or request_row.requested_by_actor <> target_actor_id
     or usage_row.requested_by_actor <> target_actor_id
     or usage_row.feature <> 'academic_answers' then
    raise exception 'academic operation is not owned by this actor' using errcode = '42501';
  end if;
  if exists (
    select 1 from public.lecture_academic_answers as answer
    where answer.operation_id = target_operation_id
  ) then
    return jsonb_build_object(
      'accepted', true, 'idempotent_replay', true,
      'result_saved', true,
      'results', private.phase72_admin_results_json(request_row.lecture_session_id)
    );
  end if;
  if jsonb_typeof(target_sources) is distinct from 'array'
     or jsonb_array_length(target_sources) not between 1 and 5
     or not private.phase72_answer_body_is_valid(target_body)
     or jsonb_typeof(target_quality_result) is distinct from 'object'
     or pg_column_size(target_quality_result) > 4096 then
    raise exception 'invalid academic answer result' using errcode = '22023';
  end if;

  for source in select value from jsonb_array_elements(target_sources)
  loop
    if jsonb_typeof(source) is distinct from 'object'
       or source ->> 'source_id' !~ '^pmid:[0-9]{1,9}$'
       or source ->> 'pmid' !~ '^[0-9]{1,9}$'
       or source ->> 'source_id' <> 'pmid:' || (source ->> 'pmid')
       or char_length(trim(source ->> 'title')) not between 3 and 500
       or (source ->> 'publication_year')::integer not between 1800 and 2200
       or source ->> 'source_role' not in ('primary', 'context')
       or source #>> '{verification,passed}' <> 'true' then
      raise exception 'invalid verified academic source' using errcode = '22023';
    end if;
    if source ->> 'source_id' = any(source_ids) then
      raise exception 'duplicate academic source' using errcode = '22023';
    end if;
    source_ids := array_append(source_ids, source ->> 'source_id');
    if source ->> 'source_role' = 'primary' then
      primary_ids := array_append(primary_ids, source ->> 'source_id');
    end if;
  end loop;
  if cardinality(primary_ids) < 1 then
    raise exception 'primary academic evidence is required' using errcode = '22023';
  end if;
  for point in select value from jsonb_array_elements(target_body -> 'answer_points')
  loop
    point_ids := array(
      select value from jsonb_array_elements_text(point -> 'source_ids')
    );
    if exists (select 1 from unnest(point_ids) as id where not id = any(source_ids))
       or not (point_ids && primary_ids) then
      raise exception 'academic claim source mapping is invalid' using errcode = '22023';
    end if;
  end loop;

  completion := private.finish_lecture_ai_operation(
    target_operation_id, 'succeeded', actual_microusd, 0,
    actual_input_tokens, actual_output_tokens, provider_request_id, null
  );
  if coalesce((completion ->> 'accepted')::boolean, false) is not true then
    update public.academic_answer_requests
    set status = 'discarded', error_code = 'late_result_discarded',
        updated_at = statement_timestamp()
    where id = target_request_id;
    return completion || jsonb_build_object('result_saved', false);
  end if;

  insert into public.lecture_academic_answers (
    lecture_session_id, request_id, operation_id, question, source_kind,
    source_summary_id, model_id, prompt_version, source_set_sha256,
    quality_result, status
  ) values (
    request_row.lecture_session_id, request_row.id, target_operation_id,
    request_row.question, request_row.source_kind, request_row.source_summary_id,
    usage_row.model_id, request_row.prompt_version, request_row.source_set_sha256,
    target_quality_result, 'awaiting_review'
  ) returning id into answer_id;

  for source in select value from jsonb_array_elements(target_sources)
  loop
    insert into public.academic_answer_sources (
      answer_id, lecture_session_id, source_id, pmid, doi, title,
      publication_year, authors, journal, publication_types, study_type,
      source_role, verification
    ) values (
      answer_id, request_row.lecture_session_id, source ->> 'source_id',
      source ->> 'pmid', nullif(source ->> 'doi', ''), trim(source ->> 'title'),
      (source ->> 'publication_year')::integer, source -> 'authors',
      coalesce(source ->> 'journal', ''), source -> 'publication_types',
      source ->> 'study_type', source ->> 'source_role', source -> 'verification'
    );
  end loop;

  insert into public.academic_answer_revisions (
    answer_id, lecture_session_id, revision_number, body, author_type
  ) values (
    answer_id, request_row.lecture_session_id, 1, target_body, 'ai'
  ) returning id into revision_id;

  insert into public.academic_answer_publications (
    answer_id, lecture_session_id, active_revision_id, visibility, review_state
  ) values (
    answer_id, request_row.lecture_session_id, revision_id, 'hidden', 'ai_unreviewed'
  );
  update public.academic_answer_requests
  set status = 'awaiting_review', updated_at = statement_timestamp()
  where id = target_request_id;
  return completion || jsonb_build_object(
    'result_saved', true,
    'results', private.phase72_admin_results_json(request_row.lecture_session_id)
  );
end;
$$;

create function private.fail_academic_answer_operation(
  target_request_id uuid,
  target_operation_id uuid,
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
  request_row public.academic_answer_requests%rowtype;
  completion jsonb;
begin
  select request.* into request_row
  from public.academic_answer_requests as request
  where request.id = target_request_id
    and request.operation_id = target_operation_id
  for update;
  if not found or request_row.requested_by_actor <> target_actor_id then
    raise exception 'academic operation is not owned by this actor' using errcode = '42501';
  end if;
  completion := private.finish_lecture_ai_operation(
    target_operation_id, 'failed', actual_microusd, 0,
    actual_input_tokens, actual_output_tokens, provider_request_id,
    left(coalesce(target_error_code, 'academic_answer_failed'), 120)
  );
  update public.academic_answer_requests
  set status = case
        when (completion #>> '{operation,status}') in ('cancelled', 'discarded')
          then 'discarded' else 'failed' end,
      error_code = left(coalesce(target_error_code, 'academic_answer_failed'), 120),
      updated_at = statement_timestamp()
  where id = target_request_id
    and status in ('running', 'evidence_checking');
  return completion;
end;
$$;

create function private.cancel_academic_answer_request(
  target_lecture_session_id uuid,
  target_request_id uuid,
  target_actor_id text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  request_row public.academic_answer_requests%rowtype;
  usage_row public.ai_usage_ledger%rowtype;
  remaining_running_count integer;
begin
  select request.* into request_row
  from public.academic_answer_requests as request
  where request.id = target_request_id
    and request.lecture_session_id = target_lecture_session_id
  for update;
  if not found or request_row.requested_by_actor <> target_actor_id then
    raise exception 'academic request is not owned by this actor' using errcode = '42501';
  end if;
  if request_row.status not in ('evidence_checking', 'running') then
    return private.phase72_admin_results_json(target_lecture_session_id);
  end if;

  update public.academic_answer_requests
  set status = 'discarded', lease_until = null,
      error_code = 'cancelled_by_admin', updated_at = statement_timestamp()
  where id = target_request_id;

  if request_row.operation_id is not null then
    select usage.* into usage_row
    from public.ai_usage_ledger as usage
    where usage.id = request_row.operation_id
    for update;
    if usage_row.id is not null and usage_row.accounting_settled_at is null then
      if usage_row.provider_dispatched_at is null then
        perform private.finish_lecture_ai_operation(
          usage_row.id, 'cancelled', 0, 0, 0, 0, null, 'cancelled_by_admin'
        );
      else
        update public.ai_usage_ledger
        set status = 'cancelled', result_accepted = false,
            error_code = 'cancelled_by_admin',
            finished_at = coalesce(finished_at, statement_timestamp())
        where id = usage_row.id;
        select count(*)::integer into remaining_running_count
        from public.ai_usage_ledger as usage
        where usage.lecture_session_id = target_lecture_session_id
          and usage.status = 'running';
        update public.lecture_ai_control as control
        set active_operation_count = remaining_running_count,
            status = case when remaining_running_count > 0 then 'running'
              when control.status in ('stopping', 'stopped') then 'stopped'
              else 'ready' end,
            version = control.version + 1,
            updated_at = statement_timestamp()
        where control.lecture_session_id = target_lecture_session_id;
      end if;
    end if;
  end if;
  return private.phase72_admin_results_json(target_lecture_session_id);
end;
$$;

create function private.reap_stale_academic_answer_operations(
  job_limit integer default 10
)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  stale record;
  reaped integer := 0;
begin
  for stale in
    select request.id as request_id, request.requested_by_actor,
      usage.id as operation_id, usage.provider_dispatched_at,
      usage.reserved_microusd, usage.reserved_input_tokens,
      usage.reserved_output_tokens
    from public.academic_answer_requests as request
    join public.ai_usage_ledger as usage on usage.id = request.operation_id
    where request.status in ('running', 'discarded')
      and usage.accounting_settled_at is null
      and request.updated_at < statement_timestamp() - interval '2 minutes'
    order by request.updated_at, request.id
    for update of request, usage skip locked
    limit least(greatest(job_limit, 1), 50)
  loop
    perform private.finish_lecture_ai_operation(
      stale.operation_id,
      'cancelled',
      case when stale.provider_dispatched_at is null then 0
        else stale.reserved_microusd end,
      0,
      case when stale.provider_dispatched_at is null then 0
        else stale.reserved_input_tokens end,
      case when stale.provider_dispatched_at is null then 0
        else stale.reserved_output_tokens end,
      null,
      case when stale.provider_dispatched_at is null
        then 'stale_before_dispatch'
        else 'stale_after_dispatch_ambiguous' end
    );
    update public.academic_answer_requests
    set status = 'discarded', lease_until = null,
        error_code = case when stale.provider_dispatched_at is null
          then 'stale_before_dispatch'
          else 'stale_after_dispatch_ambiguous' end,
        updated_at = statement_timestamp()
    where id = stale.request_id;
    reaped := reaped + 1;
  end loop;
  return reaped;
end;
$$;

create function private.manage_academic_answer_publication(
  target_lecture_session_id uuid,
  target_answer_id uuid,
  target_actor_id text,
  target_action text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  lecture_row public.lecture_sessions%rowtype;
  answer_row public.lecture_academic_answers%rowtype;
  publication_row public.academic_answer_publications%rowtype;
begin
  if nullif(trim(target_actor_id), '') is null
     or char_length(target_actor_id) > 200
     or target_action not in ('approve', 'hide', 'reject') then
    raise exception 'invalid academic publication action' using errcode = '22023';
  end if;
  perform private.close_lecture_if_expired(target_lecture_session_id);
  select lecture.* into lecture_row
  from public.lecture_sessions as lecture
  where lecture.id = target_lecture_session_id
  for update;
  if not found or lecture_row.status <> 'open'
     or lecture_row.hard_stop_at <= statement_timestamp() then
    raise exception 'lecture is not open' using errcode = 'P0001';
  end if;
  select answer.* into answer_row
  from public.lecture_academic_answers as answer
  where answer.id = target_answer_id
    and answer.lecture_session_id = target_lecture_session_id
  for update;
  if not found then raise exception 'academic answer not found' using errcode = 'P0002'; end if;
  select publication.* into publication_row
  from public.academic_answer_publications as publication
  where publication.answer_id = target_answer_id
    and publication.lecture_session_id = target_lecture_session_id
  for update;
  if not found then raise exception 'academic publication not found' using errcode = 'P0002'; end if;

  if target_action = 'approve' then
    if publication_row.visibility = 'public'
       and publication_row.reviewed_by_actor_id = target_actor_id then
      return private.phase72_admin_results_json(target_lecture_session_id);
    end if;
    if answer_row.status not in ('awaiting_review', 'hidden')
       or publication_row.review_state not in (
         'ai_unreviewed', 'admin_confirmed', 'admin_revised'
       )
       or not exists (
         select 1 from public.academic_answer_sources as source
         where source.answer_id = answer_row.id and source.source_role = 'primary'
       ) then
      raise exception 'academic answer is not approvable' using errcode = 'P0001';
    end if;
    update public.academic_answer_publications
    set visibility = 'public', review_state = 'admin_confirmed',
        reviewed_by_actor_id = target_actor_id,
        published_at = coalesce(published_at, statement_timestamp()),
        updated_at = statement_timestamp()
    where answer_id = target_answer_id;
    update public.lecture_academic_answers
    set status = 'published', updated_at = statement_timestamp()
    where id = target_answer_id;
    update public.academic_answer_requests
    set status = 'published', updated_at = statement_timestamp()
    where id = answer_row.request_id;
  elsif target_action = 'hide' then
    if publication_row.visibility = 'hidden' then
      return private.phase72_admin_results_json(target_lecture_session_id);
    end if;
    update public.academic_answer_publications
    set visibility = 'hidden', updated_at = statement_timestamp()
    where answer_id = target_answer_id;
    update public.lecture_academic_answers
    set status = 'hidden', updated_at = statement_timestamp()
    where id = target_answer_id;
    update public.academic_answer_requests
    set status = 'hidden', updated_at = statement_timestamp()
    where id = answer_row.request_id;
  else
    if answer_row.status = 'rejected' then
      return private.phase72_admin_results_json(target_lecture_session_id);
    end if;
    if publication_row.visibility <> 'hidden' then
      raise exception 'published answer must be hidden before rejection' using errcode = 'P0001';
    end if;
    update public.lecture_academic_answers
    set status = 'rejected', updated_at = statement_timestamp()
    where id = target_answer_id;
    update public.academic_answer_requests
    set status = 'rejected', updated_at = statement_timestamp()
    where id = answer_row.request_id;
  end if;
  perform private.bump_lecture_live_state(target_lecture_session_id, 'summaries');
  return private.phase72_admin_results_json(target_lecture_session_id);
end;
$$;

create function private.get_lecture_public_snapshot_v6(
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
  comment_limit integer default 5,
  known_metrics_version bigint default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare payload jsonb;
begin
  payload := private.get_lecture_public_snapshot_v5(
    target_lecture_session_id, known_lecture_version, known_caption_version,
    known_comments_version, known_likes_version, known_polls_version,
    known_summaries_version, known_pdf_version, comment_cursor_created_at,
    comment_cursor_id, comment_limit, known_metrics_version
  );
  if payload is not null and (payload -> 'changed') ? 'summaries' then
    payload := jsonb_set(
      payload, '{changed,academic_answers}',
      private.phase72_public_answers_json(target_lecture_session_id, 3), true
    );
  end if;
  return payload;
end;
$$;

create function private.get_lecture_operator_snapshot_v2(
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
  comment_limit integer default 5,
  known_metrics_version bigint default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare result jsonb;
begin
  result := private.get_lecture_operator_snapshot_v1(
    target_lecture_session_id, include_hidden, known_lecture_version,
    known_caption_version, known_comments_version, known_likes_version,
    known_polls_version, known_summaries_version, known_pdf_version,
    comment_cursor_created_at, comment_cursor_id, comment_limit,
    known_metrics_version
  );
  if result #>> '{mode}' = 'live'
     and (result #> '{snapshot,changed}') ? 'summaries' then
    result := jsonb_set(
      result, '{snapshot,changed,academic_answers}',
      private.phase72_public_answers_json(target_lecture_session_id, 3), true
    );
  end if;
  return result;
end;
$$;

create function private.build_public_lecture_archive_v3(
  target_lecture_session_id uuid
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select case when base.payload is null then null else
    base.payload || jsonb_build_object(
      'academic_answers', private.phase72_public_answers_json(
        target_lecture_session_id, 3
      )
    ) end
  from (
    select private.build_public_lecture_archive_v2(target_lecture_session_id) as payload
  ) as base;
$$;

-- Keep the Phase 6 immediate post-close RPC intact and add a versioned wrapper
-- so old clients continue to receive the v3 shape.
create function private.get_lecture_archive_v4(target_lecture_session_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare payload jsonb;
begin
  payload := private.get_lecture_archive_v3(target_lecture_session_id);
  if payload is null then return null; end if;
  return jsonb_set(
    payload, '{academic_answers}',
    private.phase72_public_answers_json(target_lecture_session_id, 3), true
  );
end;
$$;

create function public.get_lecture_archive_v4(target_lecture_session_id uuid)
returns jsonb
language sql
volatile
security invoker
set search_path = ''
as $$ select private.get_lecture_archive_v4(target_lecture_session_id); $$;

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
    select export.lecture_session_id,
      export.status = 'exporting' as reclaim_expired_lease
    from public.lecture_archive_exports as export
    join public.lecture_sessions as lecture on lecture.id = export.lecture_session_id
    where (
      (export.status in ('pending', 'error') and export.next_attempt_at <= statement_timestamp())
      or (export.status = 'exporting' and export.lease_until <= statement_timestamp())
    )
      and lecture.status = 'closed'
      and lecture.archive_expires_at > statement_timestamp()
      and exists (
        select 1 from public.lecture_admin_codes as code
        where code.lecture_session_id = export.lecture_session_id
      )
    order by case when export.status = 'exporting' then export.lease_until
      else export.next_attempt_at end, export.lecture_session_id
    for update of export skip locked
    limit least(greatest(job_limit, 1), 20)
  ), claimed as (
    update public.lecture_archive_exports as export
    set source_version = export.source_version
          + case when candidates.reclaim_expired_lease then 1 else 0 end,
        status = 'exporting',
        lease_until = statement_timestamp() + interval '10 minutes',
        attempt_count = export.attempt_count + 1,
        last_error = case when candidates.reclaim_expired_lease
          then 'export_lease_expired' else export.last_error end,
        updated_at = statement_timestamp()
    from candidates
    where export.lecture_session_id = candidates.lecture_session_id
    returning export.lecture_session_id, export.source_version, export.attempt_count
  )
  select claimed.lecture_session_id, claimed.source_version,
    code.lecture_code, lecture.archive_expires_at, claimed.attempt_count,
    private.build_public_lecture_archive_v3(claimed.lecture_session_id)
  from claimed
  join public.lecture_sessions as lecture on lecture.id = claimed.lecture_session_id
  join public.lecture_admin_codes as code on code.lecture_session_id = claimed.lecture_session_id;
end;
$$;

create trigger academic_answer_publications_track_public_archive
after insert or update or delete on public.academic_answer_publications
for each row execute function private.track_related_archive_export();

-- Repair the direct Data API compatibility policies: a valid anonymous Auth
-- account is not itself lecture membership. The existing snapshot RPC remains
-- the preferred bounded read path.
drop policy if exists "students can read visible comments in open lectures"
  on public.comments;
create policy "students can read visible comments in owned lectures"
on public.comments for select to authenticated
using (
  status = 'visible'
  and exists (
    select 1 from public.participants as participant
    where participant.lecture_session_id = comments.lecture_session_id
      and participant.auth_user_id = (select auth.uid())
  )
);

drop policy if exists "authenticated clients can read active display compatibility state"
  on public.lecture_display_state;
create policy "members can read display compatibility state"
on public.lecture_display_state for select to authenticated
using (
  exists (
    select 1 from public.participants as participant
    where participant.lecture_session_id = lecture_display_state.lecture_session_id
      and participant.auth_user_id = (select auth.uid())
  )
);

create function public.admin_prepare_academic_answer_request(
  target_lecture_session_id uuid, target_actor_id text,
  target_idempotency_key text, target_source_kind text,
  target_source_summary_id uuid, target_question text,
  target_question_sha256 text, target_search_query_sha256 text
)
returns jsonb language sql volatile security invoker set search_path = ''
as $$ select private.prepare_academic_answer_request(
  target_lecture_session_id, target_actor_id, target_idempotency_key,
  target_source_kind, target_source_summary_id, target_question,
  target_question_sha256, target_search_query_sha256
); $$;

create function public.admin_mark_academic_answer_insufficient(
  target_request_id uuid, target_actor_id text, target_reason text
)
returns jsonb language sql volatile security invoker set search_path = ''
as $$ select private.mark_academic_answer_insufficient(
  target_request_id, target_actor_id, target_reason
); $$;

create function public.admin_start_academic_answer_operation(
  target_request_id uuid, target_grant_id uuid, target_nonce_hash text,
  target_actor_id text, target_model_id text, target_prompt_version text,
  target_source_set_sha256 text, target_verified_source_count integer,
  target_verified_primary_count integer, estimated_microusd bigint,
  estimated_input_tokens bigint, estimated_output_tokens bigint,
  target_input_price_microusd_per_million bigint,
  target_output_price_microusd_per_million bigint
)
returns jsonb language sql volatile security invoker set search_path = ''
as $$ select private.start_academic_answer_operation(
  target_request_id, target_grant_id, target_nonce_hash, target_actor_id,
  target_model_id, target_prompt_version, target_source_set_sha256,
  target_verified_source_count, target_verified_primary_count,
  estimated_microusd, estimated_input_tokens, estimated_output_tokens,
  target_input_price_microusd_per_million,
  target_output_price_microusd_per_million
); $$;

create function public.admin_mark_academic_provider_dispatched(
  target_request_id uuid, target_operation_id uuid, target_actor_id text
)
returns boolean language sql volatile security invoker set search_path = ''
as $$ select private.mark_academic_provider_dispatched(
  target_request_id, target_operation_id, target_actor_id
); $$;

create function public.admin_complete_academic_answer_operation(
  target_request_id uuid, target_operation_id uuid, target_actor_id text,
  target_sources jsonb, target_body jsonb, target_quality_result jsonb,
  actual_microusd bigint, actual_input_tokens bigint,
  actual_output_tokens bigint, provider_request_id text
)
returns jsonb language sql volatile security invoker set search_path = ''
as $$ select private.complete_academic_answer_operation(
  target_request_id, target_operation_id, target_actor_id, target_sources,
  target_body, target_quality_result, actual_microusd, actual_input_tokens,
  actual_output_tokens, provider_request_id
); $$;

create function public.admin_fail_academic_answer_operation(
  target_request_id uuid, target_operation_id uuid, target_actor_id text,
  actual_microusd bigint, actual_input_tokens bigint,
  actual_output_tokens bigint, provider_request_id text,
  target_error_code text
)
returns jsonb language sql volatile security invoker set search_path = ''
as $$ select private.fail_academic_answer_operation(
  target_request_id, target_operation_id, target_actor_id, actual_microusd,
  actual_input_tokens, actual_output_tokens, provider_request_id,
  target_error_code
); $$;

create function public.admin_cancel_academic_answer_request(
  target_lecture_session_id uuid, target_request_id uuid,
  target_actor_id text
)
returns jsonb language sql volatile security invoker set search_path = ''
as $$ select private.cancel_academic_answer_request(
  target_lecture_session_id, target_request_id, target_actor_id
); $$;

create function public.admin_reap_stale_academic_answer_operations(
  job_limit integer default 10
)
returns integer language sql volatile security invoker set search_path = ''
as $$ select private.reap_stale_academic_answer_operations(job_limit); $$;

create function public.admin_manage_academic_answer_publication(
  target_lecture_session_id uuid, target_answer_id uuid,
  target_actor_id text, target_action text
)
returns jsonb language sql volatile security invoker set search_path = ''
as $$ select private.manage_academic_answer_publication(
  target_lecture_session_id, target_answer_id, target_actor_id, target_action
); $$;

create function public.admin_list_academic_answer_results(
  target_lecture_session_id uuid
)
returns jsonb language sql stable security invoker set search_path = ''
as $$ select private.phase72_admin_results_json(target_lecture_session_id); $$;

create function public.get_lecture_public_snapshot_v6(
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
  comment_limit integer default 5,
  known_metrics_version bigint default null
)
returns jsonb language sql volatile security invoker set search_path = ''
as $$ select private.get_lecture_public_snapshot_v6(
  target_lecture_session_id, known_lecture_version, known_caption_version,
  known_comments_version, known_likes_version, known_polls_version,
  known_summaries_version, known_pdf_version, comment_cursor_created_at,
  comment_cursor_id, comment_limit, known_metrics_version
); $$;

create function public.admin_get_lecture_operator_snapshot_v2(
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
  comment_limit integer default 5,
  known_metrics_version bigint default null
)
returns jsonb language sql volatile security invoker set search_path = ''
as $$ select private.get_lecture_operator_snapshot_v2(
  target_lecture_session_id, include_hidden, known_lecture_version,
  known_caption_version, known_comments_version, known_likes_version,
  known_polls_version, known_summaries_version, known_pdf_version,
  comment_cursor_created_at, comment_cursor_id, comment_limit,
  known_metrics_version
); $$;

revoke all on function private.phase72_answer_body_is_valid(jsonb)
  from public, anon, authenticated, service_role;
revoke all on function private.phase72_public_answers_json(uuid, integer)
  from public, anon, authenticated, service_role;
revoke all on function private.phase72_admin_results_json(uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.prepare_academic_answer_request(uuid, text, text, text, uuid, text, text, text)
  from public, anon, authenticated, service_role;
revoke all on function private.mark_academic_answer_insufficient(uuid, text, text)
  from public, anon, authenticated, service_role;
revoke all on function private.start_academic_answer_operation(uuid, uuid, text, text, text, text, text, integer, integer, bigint, bigint, bigint, bigint, bigint)
  from public, anon, authenticated, service_role;
revoke all on function private.mark_academic_provider_dispatched(uuid, uuid, text)
  from public, anon, authenticated, service_role;
revoke all on function private.complete_academic_answer_operation(uuid, uuid, text, jsonb, jsonb, jsonb, bigint, bigint, bigint, text)
  from public, anon, authenticated, service_role;
revoke all on function private.fail_academic_answer_operation(uuid, uuid, text, bigint, bigint, bigint, text, text)
  from public, anon, authenticated, service_role;
revoke all on function private.cancel_academic_answer_request(uuid, uuid, text)
  from public, anon, authenticated, service_role;
revoke all on function private.reap_stale_academic_answer_operations(integer)
  from public, anon, authenticated, service_role;
revoke all on function private.manage_academic_answer_publication(uuid, uuid, text, text)
  from public, anon, authenticated, service_role;
revoke all on function private.get_lecture_public_snapshot_v6(uuid, bigint, bigint, bigint, bigint, bigint, bigint, bigint, timestamptz, uuid, integer, bigint)
  from public, anon, authenticated, service_role;
revoke all on function private.get_lecture_operator_snapshot_v2(uuid, boolean, bigint, bigint, bigint, bigint, bigint, bigint, bigint, timestamptz, uuid, integer, bigint)
  from public, anon, authenticated, service_role;
revoke all on function private.build_public_lecture_archive_v3(uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.get_lecture_archive_v4(uuid)
  from public, anon, authenticated, service_role;

grant execute on function private.phase72_answer_body_is_valid(jsonb) to service_role;
grant execute on function private.phase72_public_answers_json(uuid, integer) to service_role;
grant execute on function private.phase72_admin_results_json(uuid) to service_role;
grant execute on function private.prepare_academic_answer_request(uuid, text, text, text, uuid, text, text, text) to service_role;
grant execute on function private.mark_academic_answer_insufficient(uuid, text, text) to service_role;
grant execute on function private.start_academic_answer_operation(uuid, uuid, text, text, text, text, text, integer, integer, bigint, bigint, bigint, bigint, bigint) to service_role;
grant execute on function private.mark_academic_provider_dispatched(uuid, uuid, text) to service_role;
grant execute on function private.complete_academic_answer_operation(uuid, uuid, text, jsonb, jsonb, jsonb, bigint, bigint, bigint, text) to service_role;
grant execute on function private.fail_academic_answer_operation(uuid, uuid, text, bigint, bigint, bigint, text, text) to service_role;
grant execute on function private.cancel_academic_answer_request(uuid, uuid, text) to service_role;
grant execute on function private.reap_stale_academic_answer_operations(integer) to service_role;
grant execute on function private.manage_academic_answer_publication(uuid, uuid, text, text) to service_role;
grant execute on function private.get_lecture_public_snapshot_v6(uuid, bigint, bigint, bigint, bigint, bigint, bigint, bigint, timestamptz, uuid, integer, bigint) to authenticated, service_role;
grant execute on function private.get_lecture_operator_snapshot_v2(uuid, boolean, bigint, bigint, bigint, bigint, bigint, bigint, bigint, timestamptz, uuid, integer, bigint) to service_role;
grant execute on function private.build_public_lecture_archive_v3(uuid) to service_role;
grant execute on function private.get_lecture_archive_v4(uuid) to authenticated, service_role;

revoke all on function public.admin_prepare_academic_answer_request(uuid, text, text, text, uuid, text, text, text) from public, anon, authenticated, service_role;
revoke all on function public.admin_mark_academic_answer_insufficient(uuid, text, text) from public, anon, authenticated, service_role;
revoke all on function public.admin_start_academic_answer_operation(uuid, uuid, text, text, text, text, text, integer, integer, bigint, bigint, bigint, bigint, bigint) from public, anon, authenticated, service_role;
revoke all on function public.admin_mark_academic_provider_dispatched(uuid, uuid, text) from public, anon, authenticated, service_role;
revoke all on function public.admin_complete_academic_answer_operation(uuid, uuid, text, jsonb, jsonb, jsonb, bigint, bigint, bigint, text) from public, anon, authenticated, service_role;
revoke all on function public.admin_fail_academic_answer_operation(uuid, uuid, text, bigint, bigint, bigint, text, text) from public, anon, authenticated, service_role;
revoke all on function public.admin_cancel_academic_answer_request(uuid, uuid, text) from public, anon, authenticated, service_role;
revoke all on function public.admin_reap_stale_academic_answer_operations(integer) from public, anon, authenticated, service_role;
revoke all on function public.admin_manage_academic_answer_publication(uuid, uuid, text, text) from public, anon, authenticated, service_role;
revoke all on function public.admin_list_academic_answer_results(uuid) from public, anon, authenticated, service_role;
revoke all on function public.get_lecture_public_snapshot_v6(uuid, bigint, bigint, bigint, bigint, bigint, bigint, bigint, timestamptz, uuid, integer, bigint) from public, anon, authenticated, service_role;
revoke all on function public.admin_get_lecture_operator_snapshot_v2(uuid, boolean, bigint, bigint, bigint, bigint, bigint, bigint, bigint, timestamptz, uuid, integer, bigint) from public, anon, authenticated, service_role;
revoke all on function public.get_lecture_archive_v4(uuid) from public, anon, authenticated, service_role;

grant execute on function public.admin_prepare_academic_answer_request(uuid, text, text, text, uuid, text, text, text) to service_role;
grant execute on function public.admin_mark_academic_answer_insufficient(uuid, text, text) to service_role;
grant execute on function public.admin_start_academic_answer_operation(uuid, uuid, text, text, text, text, text, integer, integer, bigint, bigint, bigint, bigint, bigint) to service_role;
grant execute on function public.admin_mark_academic_provider_dispatched(uuid, uuid, text) to service_role;
grant execute on function public.admin_complete_academic_answer_operation(uuid, uuid, text, jsonb, jsonb, jsonb, bigint, bigint, bigint, text) to service_role;
grant execute on function public.admin_fail_academic_answer_operation(uuid, uuid, text, bigint, bigint, bigint, text, text) to service_role;
grant execute on function public.admin_cancel_academic_answer_request(uuid, uuid, text) to service_role;
grant execute on function public.admin_reap_stale_academic_answer_operations(integer) to service_role;
grant execute on function public.admin_manage_academic_answer_publication(uuid, uuid, text, text) to service_role;
grant execute on function public.admin_list_academic_answer_results(uuid) to service_role;
grant execute on function public.get_lecture_public_snapshot_v6(uuid, bigint, bigint, bigint, bigint, bigint, bigint, bigint, timestamptz, uuid, integer, bigint) to authenticated, service_role;
grant execute on function public.admin_get_lecture_operator_snapshot_v2(uuid, boolean, bigint, bigint, bigint, bigint, bigint, bigint, bigint, timestamptz, uuid, integer, bigint) to service_role;
grant execute on function public.get_lecture_archive_v4(uuid) to authenticated;

do $$
declare existing_job_id bigint;
begin
  select jobid into existing_job_id
  from cron.job
  where jobname = 'compass-phase7-2-academic-reaper'
  limit 1;
  if existing_job_id is null then
    perform cron.schedule(
      'compass-phase7-2-academic-reaper',
      '*/5 * * * *',
      'select private.reap_stale_academic_answer_operations(20);'
    );
  end if;
end;
$$;

comment on table public.academic_answer_requests is
  'Phase 7.2 teacher-triggered academic answer state; raw search text is never stored.';
comment on table public.academic_answer_sources is
  'Bounded verified citation metadata only; no abstract, full text, PDF or transcript corpus.';
