-- Phase 7.25: multidisciplinary DOI evidence, explicitly authorized automatic
-- academic answers, unreviewed public delivery and auditable teacher revision.
-- Expand-first: Phase 7.2 RPCs and stored rows remain valid. New automatic paid
-- work requires a separate feature flag at the Edge layer and a billing grant
-- whose canonical scope is exactly academic_answers + summaries.

alter table public.lecture_summary_runs
  add column auto_academic_answers_enabled boolean not null default false,
  add column academic_source_policy text not null default 'auto'
    check (academic_source_policy in (
      'auto', 'biomedical_pubmed', 'multidisciplinary_doi'
    )),
  add column academic_authorization_grant_id uuid
    references public.ai_billing_grants(id) on delete restrict,
  add column previous_academic_answers_enabled boolean not null default false;

alter table public.lecture_summary_runs
  add constraint lecture_summary_runs_academic_authorization_check check (
    (not auto_academic_answers_enabled and academic_authorization_grant_id is null)
    or (auto_academic_answers_enabled and academic_authorization_grant_id is not null)
  );

alter table public.lecture_summary_runs
  add constraint lecture_summary_runs_lecture_id_unique
  unique (lecture_session_id, id);

alter table public.academic_answer_requests
  add column publication_mode text not null default 'manual_review'
    check (publication_mode in ('manual_review', 'auto_unreviewed')),
  add column requested_source_policy text not null default 'biomedical_pubmed'
    check (requested_source_policy in (
      'auto', 'biomedical_pubmed', 'multidisciplinary_doi'
    )),
  add column resolved_source_route text
    check (resolved_source_route is null or resolved_source_route in (
      'biomedical_pubmed', 'multidisciplinary_doi'
    )),
  add column retrieval_version text not null default 'phase7-2-pubmed-v1'
    check (char_length(retrieval_version) between 1 and 120),
  add column evidence_attempt_count integer not null default 0
    check (evidence_attempt_count between 0 and 3),
  add column automation_run_id uuid
    references public.lecture_summary_runs(id) on delete restrict;

-- Defaults deliberately remain the Phase 7.2 values so an old Edge function
-- deployed during an expand-first rollout continues to label new rows safely.
-- Every Phase 7.25 insert supplies its policy and retrieval version explicitly.

alter table public.academic_answer_requests
  add constraint academic_answer_requests_automation_check check (
    (publication_mode = 'manual_review' and automation_run_id is null)
    or (
      publication_mode = 'auto_unreviewed'
      and automation_run_id is not null
      and source_kind = 'summary_candidate'
      and source_summary_id is not null
    )
  ),
  add constraint academic_answer_requests_automation_lecture_fk
    foreign key (lecture_session_id, automation_run_id)
    references public.lecture_summary_runs(lecture_session_id, id)
    on delete restrict;

create unique index academic_answer_requests_auto_summary_uidx
  on public.academic_answer_requests (source_summary_id)
  where publication_mode = 'auto_unreviewed';

alter table public.academic_answer_sources
  add column source_provider text not null default 'pubmed'
    check (source_provider in ('pubmed', 'crossref_openalex'));

alter table public.academic_answer_sources
  alter column pmid drop not null;

alter table public.academic_answer_sources
  drop constraint if exists academic_answer_sources_source_id_check,
  drop constraint if exists academic_answer_sources_pmid_check,
  drop constraint if exists academic_answer_sources_verification_check,
  drop constraint if exists academic_answer_sources_check;

-- Phase 7.2 only admitted PMID sources. Preserve those rows while making the
-- provider marker explicit. Add the new check without a long table lock, then
-- validate it separately so an unexpected malformed legacy row aborts safely.
update public.academic_answer_sources
set verification = jsonb_set(verification, '{pubmed}', 'true'::jsonb, true)
where source_provider = 'pubmed'
  and verification ->> 'passed' is not distinct from 'true'
  and verification ->> 'pubmed' is distinct from 'true';

alter table public.academic_answer_sources
  add constraint academic_answer_sources_phase725_source_id_check check (
  source_id ~ '^pmid:[0-9]{1,9}$'
    or (
      source_id ~ '^doi:10\.[0-9]{4,9}/\S+$'
      and char_length(source_id) <= 259
    )
  ),
  add constraint academic_answer_sources_phase725_pmid_check check (
    pmid is null or pmid ~ '^[0-9]{1,9}$'
  ),
  add constraint academic_answer_sources_phase725_identity_check check (
    (
      source_provider = 'pubmed'
      and pmid is not null
      and source_id = 'pmid:' || pmid
    )
    or (
      source_provider = 'crossref_openalex'
      and pmid is null
      and doi is not null
      and source_id = 'doi:' || lower(doi)
    )
  ),
  add constraint academic_answer_sources_phase725_verification_check check (
    jsonb_typeof(verification) is not distinct from 'object'
    and verification ->> 'passed' is not distinct from 'true'
    and pg_column_size(verification) <= 2048
    and (
      (
        source_provider = 'pubmed'
        and verification ->> 'pubmed' is not distinct from 'true'
      )
      or (
        source_provider = 'crossref_openalex'
        and verification ->> 'crossref' is not distinct from 'true'
        and verification ->> 'openalex' is not distinct from 'true'
      )
    )
  ) not valid;

alter table public.academic_answer_sources
  validate constraint academic_answer_sources_phase725_verification_check;

-- The latest publication row is compact state. Events preserve who changed a
-- student-visible answer and why without exposing another browser table.
create table public.academic_answer_publication_events (
  id uuid primary key default extensions.gen_random_uuid(),
  lecture_session_id uuid not null
    references public.lecture_sessions(id) on delete restrict,
  answer_id uuid not null
    references public.lecture_academic_answers(id) on delete restrict,
  revision_id uuid not null,
  actor_id text check (actor_id is null or char_length(actor_id) between 1 and 200),
  event_type text not null check (event_type in (
    'auto_publish', 'approve', 'hide', 'reject', 'revise_publish'
  )),
  previous_visibility text
    check (previous_visibility is null or previous_visibility in ('hidden', 'public')),
  next_visibility text not null check (next_visibility in ('hidden', 'public')),
  reason text check (reason is null or char_length(reason) <= 300),
  created_at timestamptz not null default statement_timestamp(),
  foreign key (lecture_session_id, answer_id, revision_id)
    references public.academic_answer_revisions(
      lecture_session_id, answer_id, id
    ) on delete restrict
);

create index academic_answer_publication_events_answer_idx
  on public.academic_answer_publication_events (answer_id, created_at desc, id);
create index academic_answer_publication_events_lecture_idx
  on public.academic_answer_publication_events (
    lecture_session_id, created_at desc, id
  );

alter table public.academic_answer_publication_events enable row level security;
revoke all on public.academic_answer_publication_events
  from public, anon, authenticated, service_role;

-- Permit public AI-unreviewed answers while retaining the stronger reviewer
-- requirement for teacher-confirmed or teacher-revised publications.
do $$
declare constraint_name text;
begin
  select con.conname into constraint_name
  from pg_catalog.pg_constraint as con
  where con.conrelid = 'public.academic_answer_publications'::regclass
    and con.contype = 'c'
    and pg_catalog.pg_get_constraintdef(con.oid) like '%review_state%admin_confirmed%'
    and pg_catalog.pg_get_constraintdef(con.oid) like '%published_at%'
  limit 1;
  if constraint_name is not null then
    execute format(
      'alter table public.academic_answer_publications drop constraint %I',
      constraint_name
    );
  end if;
end;
$$;

alter table public.academic_answer_publications
  add constraint academic_answer_publications_phase725_public_check check (
    visibility = 'hidden'
    or (
      visibility = 'public'
      and published_at is not null
      and (
        (review_state = 'ai_unreviewed' and reviewed_by_actor_id is null)
        or (
          review_state in ('admin_confirmed', 'admin_revised')
          and reviewed_by_actor_id is not null
        )
      )
    )
  );

create function private.phase725_safe_quality_score(target_value jsonb)
returns numeric
language plpgsql
immutable
security invoker
set search_path = ''
as $$
begin
  if jsonb_typeof(target_value) is distinct from 'number' then
    return 0;
  end if;
  return least(greatest((target_value #>> '{}')::numeric, 0), 1);
exception when others then
  return 0;
end;
$$;

create or replace function private.phase72_answer_body_is_valid(target_body jsonb)
returns boolean
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare point jsonb;
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
    where item.value is null
      or char_length(trim(item.value)) not between 1 and 300
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
         where source.value is null
           or (
             source.value !~ '^pmid:[0-9]{1,9}$'
           and (
             source.value !~ '^doi:10\.[0-9]{4,9}/\S+$'
             or char_length(source.value) > 259
           )
           )
       )
       or (
         select count(*) <> count(distinct source.value)
         from jsonb_array_elements_text(point -> 'source_ids') as source(value)
       ) then
      return false;
    end if;
  end loop;
  return true;
exception when others then
  return false;
end;
$$;

create or replace function private.phase72_public_answers_json(
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
    select publication.published_at,
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
            'source_provider', source.source_provider,
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
      and publication.review_state in (
        'ai_unreviewed', 'admin_confirmed', 'admin_revised'
      )
      and exists (
        select 1 from public.academic_answer_sources as primary_source
        where primary_source.answer_id = answer.id
          and primary_source.lecture_session_id = answer.lecture_session_id
          and primary_source.source_role = 'primary'
      )
      and not exists (
        select 1
        from public.academic_answer_sources as source_check
        where source_check.answer_id = answer.id
          and not (
            jsonb_typeof(source_check.verification)
              is not distinct from 'object'
            and source_check.verification ->> 'passed'
              is not distinct from 'true'
            and (
              (
                source_check.source_provider = 'pubmed'
                and source_check.verification ->> 'pubmed'
                  is not distinct from 'true'
              )
              or (
                source_check.source_provider = 'crossref_openalex'
                and source_check.verification ->> 'crossref'
                  is not distinct from 'true'
                and source_check.verification ->> 'openalex'
                  is not distinct from 'true'
              )
            )
          )
      )
    order by publication.published_at desc, answer.id
    limit least(greatest(answer_limit, 1), 3)
  ) as published;
$$;

create or replace function private.phase72_admin_results_json(
  target_lecture_session_id uuid
)
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
    'automation', (
      select jsonb_build_object(
        'run_id', run.id,
        'enabled', run.auto_academic_answers_enabled,
        'source_policy', run.academic_source_policy,
        'status', run.status,
        'expires_at', run.expires_at
      )
      from public.lecture_summary_runs as run
      where run.lecture_session_id = target_lecture_session_id
      order by run.created_at desc
      limit 1
    ),
    'active_requests', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', request.id,
        'operation_id', request.operation_id,
        'question', request.question,
        'status', request.status,
        'publication_mode', request.publication_mode,
        'updated_at', request.updated_at
      ) order by request.created_at desc)
      from public.academic_answer_requests as request
      where request.lecture_session_id = target_lecture_session_id
        and request.status in ('evidence_checking', 'running')
    ), '[]'::jsonb),
    'candidates', coalesce((
      select jsonb_agg(candidate.payload order by candidate.window_index desc)
      from (
        select summary_window.window_index,
          jsonb_build_object(
            'summary_id', summary.id,
            'run_id', summary_window.run_id,
            'question', summary.ai_output #>> '{academic_question_candidate,question}',
            'educational_value', summary.ai_output #>> '{academic_question_candidate,educationalValue}',
            'quality_score', private.phase725_safe_quality_score(
              summary.ai_output #> '{academic_question_candidate,qualityScore}'
            ),
            'window_index', summary_window.window_index,
            'auto_request_id', auto_request.id,
            'auto_request_status', auto_request.status,
            'retry_after_ms', case
              when auto_request.status = 'evidence_checking'
                and auto_request.lease_until > statement_timestamp()
              then least(
                60000,
                greatest(
                  0,
                  floor(extract(epoch from (
                    auto_request.lease_until - statement_timestamp()
                  )) * 1000)::integer
                )
              )
              else 0
            end,
            'needs_auto_dispatch', (
              auto_request.id is null
              or (
                auto_request.status = 'evidence_checking'
                and auto_request.lease_until <= statement_timestamp()
              )
            )
              and private.phase725_safe_quality_score(
                summary.ai_output #> '{academic_question_candidate,qualityScore}'
              ) >= 0.85
          ) as payload
        from public.lecture_ai_summaries as summary
        join public.lecture_summary_windows as summary_window
          on summary_window.id = summary.window_id
        left join lateral (
          select request.id, request.status, request.lease_until
          from public.academic_answer_requests as request
          where request.source_summary_id = summary.id
            and request.publication_mode = 'auto_unreviewed'
          order by request.created_at desc
          limit 1
        ) as auto_request on true
        where summary.lecture_session_id = target_lecture_session_id
          and summary.ai_output -> 'academic_question_candidate' is not null
          and summary.ai_output -> 'academic_question_candidate' <> 'null'::jsonb
        order by summary_window.window_index desc
        limit 12
      ) as candidate
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
          select jsonb_agg(to_jsonb(source) - 'answer_id' - 'lecture_session_id'
            order by source.source_id)
          from public.academic_answer_sources as source
          where source.answer_id = answer.id
        ), '[]'::jsonb),
        'revisions', coalesce((
          select jsonb_agg(to_jsonb(revision) - 'answer_id' - 'lecture_session_id'
            order by revision.revision_number)
          from public.academic_answer_revisions as revision
          where revision.answer_id = answer.id
        ), '[]'::jsonb),
        'publication', case when publication.answer_id is null then null else
          to_jsonb(publication) - 'lecture_session_id' end,
        'publication_events', coalesce((
          select jsonb_agg(event_payload order by created_at, id)
          from (
            select event.created_at, event.id,
              jsonb_build_object(
                'id', event.id,
                'revision_id', event.revision_id,
                'actor_id', event.actor_id,
                'event_type', event.event_type,
                'previous_visibility', event.previous_visibility,
                'next_visibility', event.next_visibility,
                'reason', event.reason,
                'created_at', event.created_at
              ) as event_payload
            from public.academic_answer_publication_events as event
            where event.answer_id = answer.id
            order by event.created_at desc, event.id desc
            limit 20
          ) as bounded_events
        ), '[]'::jsonb)
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

create function private.start_lecture_summary_run_v2(
  target_grant_id uuid,
  target_grant_nonce_hash text,
  target_lecture_session_id uuid,
  target_run_token_hash text,
  target_actor_id text,
  target_auto_academic_answers_enabled boolean,
  target_academic_source_policy text
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
  control_row public.lecture_ai_control%rowtype;
  expected_actions text[];
begin
  if target_grant_nonce_hash !~ '^[0-9a-f]{64}$'
     or target_run_token_hash !~ '^[0-9a-f]{64}$'
     or nullif(trim(target_actor_id), '') is null
     or char_length(target_actor_id) > 200
     or target_academic_source_policy not in (
       'auto', 'biomedical_pubmed', 'multidisciplinary_doi'
     ) then
    raise exception 'invalid summary run credentials' using errcode = '22023';
  end if;
  expected_actions := case when target_auto_academic_answers_enabled
    then array['academic_answers', 'summaries']::text[]
    else array['summaries']::text[] end;

  -- Billing start lock order remains grant -> lecture -> control -> run.
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
  if grant_row.actions <> expected_actions then
    return jsonb_build_object('accepted', false, 'reason', 'grant_scope_mismatch');
  end if;

  perform private.close_lecture_if_expired(target_lecture_session_id);
  select lecture.* into lecture_row
  from public.lecture_sessions as lecture
  where lecture.id = target_lecture_session_id
  for update;
  if not found or lecture_row.status <> 'open'
     or lecture_row.started_at is null
     or lecture_row.hard_stop_at <= statement_timestamp() then
    return jsonb_build_object('accepted', false, 'reason', 'lecture_not_open');
  end if;

  select control.* into control_row
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
  set summaries_enabled = true,
      academic_answers_enabled = control.academic_answers_enabled
        or target_auto_academic_answers_enabled,
      status = case when exists (
        select 1 from public.ai_usage_ledger as usage
        where usage.lecture_session_id = target_lecture_session_id
          and usage.status = 'running'
      ) then 'running' else 'ready' end,
      stop_requested_at = null, stopped_at = null, stop_reason = null,
      version = control.version + 1, updated_at = statement_timestamp()
  where control.lecture_session_id = target_lecture_session_id;

  insert into public.lecture_summary_runs (
    lecture_session_id, actor_id, token_hash, expires_at,
    auto_academic_answers_enabled, academic_source_policy,
    academic_authorization_grant_id, previous_academic_answers_enabled
  ) values (
    target_lecture_session_id, target_actor_id, target_run_token_hash,
    lecture_row.hard_stop_at, target_auto_academic_answers_enabled,
    target_academic_source_policy,
    case when target_auto_academic_answers_enabled then grant_row.id else null end,
    control_row.academic_answers_enabled
  ) returning * into run_row;

  update public.ai_billing_grants
  set status = 'consumed', consumed_at = statement_timestamp(),
      operation_ids = '{}'::uuid[]
  where id = grant_row.id;
  return jsonb_build_object(
    'accepted', true, 'run', to_jsonb(run_row) - 'token_hash',
    'results', private.phase6_admin_results_json(target_lecture_session_id)
  );
end;
$$;

create or replace function private.stop_lecture_summary_run(
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
  active record;
  usage_to_stop public.ai_usage_ledger%rowtype;
begin
  if nullif(trim(target_actor_id), '') is null
     or char_length(target_actor_id) > 200
     or nullif(trim(target_reason), '') is null
     or char_length(target_reason) > 120 then
    raise exception 'invalid summary stop request' using errcode = '22023';
  end if;

  perform 1 from public.lecture_sessions as lecture
  where lecture.id = target_lecture_session_id
  for update;
  if not found then raise exception 'lecture not found' using errcode = 'P0002'; end if;
  perform 1 from public.lecture_ai_control as control
  where control.lecture_session_id = target_lecture_session_id
  for update;
  select run.* into run_row
  from public.lecture_summary_runs as run
  where run.lecture_session_id = target_lecture_session_id
    and run.status = 'running'
  for update;
  if found and run_row.actor_id <> target_actor_id then
    return jsonb_build_object('accepted', false, 'reason', 'actor_mismatch');
  end if;

  perform 1 from public.ai_usage_ledger as usage
  where usage.lecture_session_id = target_lecture_session_id
    and usage.feature = 'summaries'
    and usage.status = 'running'
  order by usage.id
  for update;
  update public.ai_usage_ledger
  set status = 'cancelled', result_accepted = false,
      error_code = 'summary_run_stopped_cost_unknown',
      finished_at = statement_timestamp()
  where lecture_session_id = target_lecture_session_id
    and feature = 'summaries' and status = 'running';
  update public.lecture_summary_windows
  set status = 'discarded', current_operation_id = null,
      last_error_code = 'summary_run_stopped',
      updated_at = statement_timestamp()
  where lecture_session_id = target_lecture_session_id and status = 'running';

  if run_row.id is not null and run_row.auto_academic_answers_enabled then
    update public.academic_answer_requests
    set status = 'discarded', lease_until = null,
        error_code = 'automation_stopped_before_dispatch',
        updated_at = statement_timestamp()
    where automation_run_id = run_row.id
      and status = 'evidence_checking';

    for active in
      select request.id as request_id, request.operation_id
      from public.academic_answer_requests as request
      where request.automation_run_id = run_row.id
        and request.status = 'running'
      order by request.id
      for update
    loop
      select usage.* into usage_to_stop
      from public.ai_usage_ledger as usage
      where usage.id = active.operation_id
      for update;
      if not found then
        raise exception 'academic usage ledger is missing' using errcode = 'P0002';
      end if;
      perform private.finish_lecture_ai_operation(
        usage_to_stop.id, 'cancelled',
        case when usage_to_stop.provider_dispatched_at is null
          then 0 else usage_to_stop.reserved_microusd end,
        0,
        case when usage_to_stop.provider_dispatched_at is null
          then 0 else usage_to_stop.reserved_input_tokens end,
        case when usage_to_stop.provider_dispatched_at is null
          then 0 else usage_to_stop.reserved_output_tokens end,
        null,
        case when usage_to_stop.provider_dispatched_at is null
          then 'automation_stopped_before_dispatch'
          else 'automation_stopped_after_dispatch_ambiguous' end
      );
      update public.academic_answer_requests
      set status = 'discarded', lease_until = null,
          error_code = case when usage_to_stop.provider_dispatched_at is null
            then 'automation_stopped_before_dispatch'
            else 'automation_stopped_after_dispatch_ambiguous' end,
          updated_at = statement_timestamp()
      where id = active.request_id;
    end loop;
  end if;

  update public.lecture_summary_runs
  set status = 'stopped', stopped_at = statement_timestamp(),
      stop_reason = trim(target_reason),
      token_hash = encode(extensions.gen_random_bytes(32), 'hex'),
      updated_at = statement_timestamp()
  where lecture_session_id = target_lecture_session_id and status = 'running';
  update public.lecture_ai_control as control
  set summaries_enabled = false,
      academic_answers_enabled = case
        when run_row.auto_academic_answers_enabled
          then run_row.previous_academic_answers_enabled
        else control.academic_answers_enabled end,
      version = control.version + 1,
      updated_at = statement_timestamp()
  where control.lecture_session_id = target_lecture_session_id;
  perform private.reconcile_lecture_ai_runtime_state(
    target_lecture_session_id, false
  );
  return jsonb_build_object(
    'accepted', true,
    'results', private.phase6_admin_results_json(target_lecture_session_id)
  );
end;
$$;

create function private.prepare_academic_answer_request_v2(
  target_lecture_session_id uuid,
  target_actor_id text,
  target_idempotency_key text,
  target_source_kind text,
  target_source_summary_id uuid,
  target_question text,
  target_question_sha256 text,
  target_search_query_sha256 text,
  target_source_policy text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  prepared jsonb;
  request_row public.academic_answer_requests%rowtype;
begin
  if target_source_policy not in (
    'auto', 'biomedical_pubmed', 'multidisciplinary_doi'
  ) then
    raise exception 'invalid academic source policy' using errcode = '22023';
  end if;
  prepared := private.prepare_academic_answer_request(
    target_lecture_session_id, target_actor_id, target_idempotency_key,
    target_source_kind, target_source_summary_id, target_question,
    target_question_sha256, target_search_query_sha256
  );
  select request.* into request_row
  from public.academic_answer_requests as request
  where request.id = (prepared #>> '{request,id}')::uuid
  for update;
  if coalesce((prepared ->> 'idempotent_replay')::boolean, false) then
    if request_row.requested_source_policy <> target_source_policy
       or request_row.retrieval_version <> 'phase7-25-retrieval-v1' then
      raise exception 'academic source policy idempotency mismatch'
        using errcode = '22023';
    end if;
  else
    update public.academic_answer_requests
    set requested_source_policy = target_source_policy,
        retrieval_version = 'phase7-25-retrieval-v1',
        updated_at = statement_timestamp()
    where id = request_row.id
    returning * into request_row;
  end if;
  return prepared || jsonb_build_object(
    'request', to_jsonb(request_row)
  );
end;
$$;

create function private.start_academic_answer_operation_v2(
  target_request_id uuid,
  target_grant_id uuid,
  target_nonce_hash text,
  target_actor_id text,
  target_model_id text,
  target_prompt_version text,
  target_source_set_sha256 text,
  target_resolved_source_route text,
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
  started jsonb;
begin
  select request.* into request_row
  from public.academic_answer_requests as request
  where request.id = target_request_id
  for update;
  if not found or request_row.requested_by_actor <> target_actor_id then
    raise exception 'academic request is not owned by this actor'
      using errcode = '42501';
  end if;
  if request_row.retrieval_version <> 'phase7-25-retrieval-v1'
     or target_resolved_source_route not in (
       'biomedical_pubmed', 'multidisciplinary_doi'
     )
     or (
       request_row.requested_source_policy <> 'auto'
       and request_row.requested_source_policy <> target_resolved_source_route
     ) then
    raise exception 'academic source route mismatch' using errcode = '22023';
  end if;
  update public.academic_answer_requests
  set resolved_source_route = target_resolved_source_route,
      updated_at = statement_timestamp()
  where id = target_request_id;
  started := private.start_academic_answer_operation(
    target_request_id, target_grant_id, target_nonce_hash, target_actor_id,
    target_model_id, target_prompt_version, target_source_set_sha256,
    target_verified_source_count, target_verified_primary_count,
    estimated_microusd, estimated_input_tokens, estimated_output_tokens,
    target_input_price_microusd_per_million,
    target_output_price_microusd_per_million
  );
  return started;
end;
$$;

create function private.prepare_auto_academic_answer_request(
  target_lecture_session_id uuid,
  target_run_id uuid,
  target_run_token_hash text,
  target_actor_id text,
  target_idempotency_key text,
  target_source_summary_id uuid,
  target_question text,
  target_question_sha256 text,
  target_search_query_sha256 text,
  target_source_policy text
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
  request_row public.academic_answer_requests%rowtype;
  candidate_question text;
  candidate_quality numeric;
  candidate_educational_value text;
begin
  if target_run_token_hash !~ '^[0-9a-f]{64}$'
     or nullif(trim(target_actor_id), '') is null
     or char_length(target_actor_id) > 200
     or char_length(trim(coalesce(target_question, ''))) not between 10 and 500
     or char_length(target_idempotency_key) not between 8 and 160
     or target_question_sha256 !~ '^[0-9a-f]{64}$'
     or target_search_query_sha256 !~ '^[0-9a-f]{64}$'
     or target_source_policy not in (
       'auto', 'biomedical_pubmed', 'multidisciplinary_doi'
     ) then
    raise exception 'invalid automatic academic answer request' using errcode = '22023';
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
  select run.* into run_row
  from public.lecture_summary_runs as run
  where run.id = target_run_id
    and run.lecture_session_id = target_lecture_session_id
    and run.actor_id = target_actor_id
    and run.token_hash = target_run_token_hash
    and run.status = 'running'
    and run.expires_at > statement_timestamp()
    and run.auto_academic_answers_enabled
  for update;
  if not found then
    raise exception 'automatic academic authorization is not active'
      using errcode = '42501';
  end if;
  if run_row.academic_source_policy <> target_source_policy then
    raise exception 'academic source policy mismatch' using errcode = '22023';
  end if;

  select
    summary.ai_output #>> '{academic_question_candidate,question}',
    private.phase725_safe_quality_score(
      summary.ai_output #> '{academic_question_candidate,qualityScore}'
    ),
    summary.ai_output #>> '{academic_question_candidate,educationalValue}'
  into candidate_question, candidate_quality, candidate_educational_value
  from public.lecture_ai_summaries as summary
  join public.lecture_summary_windows as summary_window
    on summary_window.id = summary.window_id
  where summary.id = target_source_summary_id
    and summary.lecture_session_id = target_lecture_session_id
    and summary_window.run_id = target_run_id;
  if candidate_question is null
     or trim(candidate_question) <> trim(target_question)
     or candidate_quality < 0.85
     or char_length(trim(coalesce(candidate_educational_value, ''))) < 8 then
    return jsonb_build_object(
      'accepted', false, 'reason', 'candidate_below_auto_threshold'
    );
  end if;

  select request.* into request_row
  from public.academic_answer_requests as request
  where request.lecture_session_id = target_lecture_session_id
    and (
      request.idempotency_key = target_idempotency_key
      or (
        request.publication_mode = 'auto_unreviewed'
        and request.source_summary_id = target_source_summary_id
      )
    )
  order by (request.idempotency_key = target_idempotency_key) desc
  limit 1
  for update;
  if found then
    if request_row.requested_by_actor <> target_actor_id
       or request_row.question_sha256 <> target_question_sha256
       or request_row.search_query_sha256 <> target_search_query_sha256
       or request_row.source_summary_id <> target_source_summary_id
       or request_row.automation_run_id <> target_run_id
       or request_row.publication_mode <> 'auto_unreviewed'
       or request_row.requested_source_policy <> target_source_policy then
      raise exception 'automatic academic idempotency mismatch' using errcode = '22023';
    end if;
    if request_row.status = 'evidence_checking'
       and request_row.lease_until <= statement_timestamp() then
      if request_row.evidence_attempt_count >= 3 then
        update public.academic_answer_requests
        set status = 'discarded', lease_until = null,
            error_code = 'evidence_retry_limit',
            updated_at = statement_timestamp()
        where id = request_row.id
        returning * into request_row;
        return jsonb_build_object(
          'accepted', false, 'claim_acquired', false,
          'idempotent_replay', true, 'reason', 'evidence_retry_limit',
          'request', to_jsonb(request_row),
          'results', private.phase72_admin_results_json(target_lecture_session_id)
        );
      end if;
      update public.academic_answer_requests
      set lease_until = statement_timestamp() + interval '45 seconds',
          evidence_attempt_count = evidence_attempt_count + 1,
          error_code = null,
          updated_at = statement_timestamp()
      where id = request_row.id
      returning * into request_row;
      return jsonb_build_object(
        'accepted', true, 'claim_acquired', true, 'idempotent_replay', true,
        'request', to_jsonb(request_row)
      );
    end if;
    return jsonb_build_object(
      'accepted', true,
      -- A live lease belongs to the in-flight caller. Replays may observe the
      -- request, but must not perform a second metadata or model dispatch.
      'claim_acquired', false,
      'idempotent_replay', true,
      'request', to_jsonb(request_row),
      'results', private.phase72_admin_results_json(target_lecture_session_id)
    );
  end if;

  begin
    insert into public.academic_answer_requests (
      lecture_session_id, requested_by_actor, idempotency_key, source_kind,
      source_summary_id, question, question_sha256, search_query_sha256,
      status, lease_until, publication_mode, requested_source_policy,
      automation_run_id, retrieval_version, evidence_attempt_count
    ) values (
      target_lecture_session_id, trim(target_actor_id), target_idempotency_key,
      'summary_candidate', target_source_summary_id, trim(target_question),
      target_question_sha256, target_search_query_sha256,
      'evidence_checking', statement_timestamp() + interval '45 seconds',
      'auto_unreviewed', target_source_policy, target_run_id,
      'phase7-25-retrieval-v1', 1
    ) returning * into request_row;
  exception when unique_violation then
    select request.* into request_row
    from public.academic_answer_requests as request
    where request.lecture_session_id = target_lecture_session_id
      and (
        request.idempotency_key = target_idempotency_key
        or (
          request.publication_mode = 'auto_unreviewed'
          and request.source_summary_id = target_source_summary_id
        )
      )
    order by (request.idempotency_key = target_idempotency_key) desc
    limit 1
    for update;
    if not found
       or request_row.requested_by_actor <> target_actor_id
       or request_row.question_sha256 <> target_question_sha256
       or request_row.search_query_sha256 <> target_search_query_sha256
       or request_row.source_summary_id <> target_source_summary_id
       or request_row.automation_run_id <> target_run_id
       or request_row.publication_mode <> 'auto_unreviewed'
       or request_row.requested_source_policy <> target_source_policy then
      raise exception 'automatic academic idempotency mismatch'
        using errcode = '22023';
    end if;
    return jsonb_build_object(
      'accepted', true, 'claim_acquired', false,
      'idempotent_replay', true, 'request', to_jsonb(request_row),
      'results', private.phase72_admin_results_json(target_lecture_session_id)
    );
  end;
  return jsonb_build_object(
    'accepted', true, 'claim_acquired', true, 'idempotent_replay', false,
    'request', to_jsonb(request_row)
  );
end;
$$;

create function private.start_auto_academic_answer_operation(
  target_request_id uuid,
  target_run_id uuid,
  target_run_token_hash text,
  target_actor_id text,
  target_model_id text,
  target_prompt_version text,
  target_source_set_sha256 text,
  target_resolved_source_route text,
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
  request_probe public.academic_answer_requests%rowtype;
  request_row public.academic_answer_requests%rowtype;
  run_row public.lecture_summary_runs%rowtype;
  control_row public.lecture_ai_control%rowtype;
  start_result jsonb;
  created_operation_id uuid;
begin
  select request.* into request_probe
  from public.academic_answer_requests as request
  where request.id = target_request_id;
  if not found then raise exception 'academic request not found' using errcode = 'P0002'; end if;
  perform private.close_lecture_if_expired(request_probe.lecture_session_id);
  perform 1 from public.lecture_sessions as lecture
  where lecture.id = request_probe.lecture_session_id
    and lecture.status = 'open'
    and lecture.hard_stop_at > statement_timestamp()
  for update;
  if not found then return jsonb_build_object('accepted', false, 'reason', 'lecture_not_open'); end if;
  select control.* into control_row
  from public.lecture_ai_control as control
  where control.lecture_session_id = request_probe.lecture_session_id
  for update;
  if not found then raise exception 'AI control is not configured' using errcode = 'P0001'; end if;
  select run.* into run_row
  from public.lecture_summary_runs as run
  where run.id = target_run_id
    and run.lecture_session_id = request_probe.lecture_session_id
    and run.actor_id = target_actor_id
    and run.token_hash = target_run_token_hash
    and run.status = 'running'
    and run.expires_at > statement_timestamp()
    and run.auto_academic_answers_enabled
  for update;
  if not found then return jsonb_build_object('accepted', false, 'reason', 'automation_not_authorized'); end if;
  select request.* into request_row
  from public.academic_answer_requests as request
  where request.id = target_request_id
  for update;
  if request_row.requested_by_actor <> target_actor_id
     or request_row.automation_run_id <> target_run_id
     or request_row.publication_mode <> 'auto_unreviewed'
     or request_row.status <> 'evidence_checking'
     or request_row.lease_until <= statement_timestamp()
     or target_run_token_hash !~ '^[0-9a-f]{64}$'
     or target_verified_source_count not between 1 and 5
     or target_verified_primary_count not between 1 and target_verified_source_count
     or target_source_set_sha256 !~ '^[0-9a-f]{64}$'
     or target_resolved_source_route not in (
       'biomedical_pubmed', 'multidisciplinary_doi'
     )
     or (
       request_row.requested_source_policy <> 'auto'
       and request_row.requested_source_policy <> target_resolved_source_route
     )
     or run_row.academic_source_policy <> request_row.requested_source_policy
     or char_length(coalesce(target_prompt_version, '')) not between 1 and 120
     or target_input_price_microusd_per_million < 0
     or target_output_price_microusd_per_million < 0 then
    raise exception 'automatic academic evidence admission rejected'
      using errcode = 'P0001';
  end if;
  if control_row.academic_answer_calls_used >= least(
    control_row.academic_answer_limit, 3
  ) then
    update public.academic_answer_requests
    set status = 'discarded', lease_until = null,
        error_code = 'academic_answer_limit', updated_at = statement_timestamp()
    where id = target_request_id;
    return jsonb_build_object('accepted', false, 'reason', 'academic_answer_limit');
  end if;

  start_result := private.start_lecture_ai_operation(
    request_row.lecture_session_id, 'academic_answers', request_row.idempotency_key,
    estimated_microusd, 0, estimated_input_tokens, estimated_output_tokens,
    target_actor_id
  );
  if coalesce((start_result ->> 'accepted')::boolean, false) is not true then
    update public.academic_answer_requests
    set status = case when start_result ->> 'reason' = 'concurrency_limit'
          then 'evidence_checking' else 'discarded' end,
        lease_until = case when start_result ->> 'reason' = 'concurrency_limit'
          then statement_timestamp() else null end,
        error_code = left(coalesce(start_result ->> 'reason', 'operation_rejected'), 120),
        updated_at = statement_timestamp()
    where id = target_request_id;
    return start_result;
  end if;
  created_operation_id := (start_result #>> '{operation,id}')::uuid;
  update public.ai_usage_ledger as usage
  set model_id = target_model_id, pricing_unit = 'token',
      pricing_rate_microusd = target_input_price_microusd_per_million,
      last_heartbeat_at = statement_timestamp()
  where usage.id = created_operation_id;
  update public.academic_answer_requests
  set status = 'running', operation_id = created_operation_id,
      verified_source_count = target_verified_source_count,
      verified_primary_count = target_verified_primary_count,
      source_set_sha256 = target_source_set_sha256,
      prompt_version = target_prompt_version,
      resolved_source_route = target_resolved_source_route,
      lease_until = null, updated_at = statement_timestamp()
  where id = target_request_id;
  update public.ai_billing_grants as billing_grant
  set operation_ids = case
    when created_operation_id = any(billing_grant.operation_ids)
      then billing_grant.operation_ids
    else array_append(billing_grant.operation_ids, created_operation_id) end
  where billing_grant.id = run_row.academic_authorization_grant_id;
  return jsonb_build_object(
    'accepted', true,
    'idempotent_replay', coalesce((start_result ->> 'idempotent_replay')::boolean, false),
    'operation', start_result -> 'operation',
    'request_id', target_request_id
  );
end;
$$;

create or replace function private.complete_academic_answer_operation(
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
  request_probe public.academic_answer_requests%rowtype;
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
  publish_automatically boolean;
  stored_source_provider text;
  source_year integer;
  effective_route text;
  has_pubmed_source boolean := false;
  has_crossref_source boolean := false;
begin
  select request.* into request_probe
  from public.academic_answer_requests as request
  where request.id = target_request_id;
  if not found then
    raise exception 'academic request not found' using errcode = 'P0002';
  end if;
  perform private.close_lecture_if_expired(request_probe.lecture_session_id);
  perform 1 from public.lecture_sessions as lecture
  where lecture.id = request_probe.lecture_session_id
  for update;
  perform 1 from public.lecture_ai_control as control
  where control.lecture_session_id = request_probe.lecture_session_id
  for update;
  select request.* into request_row
  from public.academic_answer_requests as request
  where request.id = target_request_id for update;
  select usage.* into usage_row
  from public.ai_usage_ledger as usage
  where usage.id = target_operation_id for update;
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
      'accepted', true, 'idempotent_replay', true, 'result_saved', true,
      'results', private.phase72_admin_results_json(request_row.lecture_session_id)
    );
  end if;
  if request_row.retrieval_version = 'phase7-2-pubmed-v1' then
    effective_route := 'biomedical_pubmed';
  elsif request_row.retrieval_version = 'phase7-25-retrieval-v1'
        and request_row.resolved_source_route in (
          'biomedical_pubmed', 'multidisciplinary_doi'
        ) then
    effective_route := request_row.resolved_source_route;
  else
    raise exception 'academic retrieval route is not auditable'
      using errcode = '22023';
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
    stored_source_provider := coalesce(
      nullif(source ->> 'source_provider', ''),
      case when source ->> 'pmid' ~ '^[0-9]{1,9}$' then 'pubmed' end
    );
    if jsonb_typeof(source) is distinct from 'object'
       or char_length(trim(coalesce(source ->> 'title', ''))) not between 3 and 500
       or coalesce(source ->> 'publication_year', '') !~ '^[0-9]{4}$'
       or source ->> 'source_role' is null
       or source ->> 'source_role' not in ('primary', 'context')
       or source #>> '{verification,passed}' is distinct from 'true'
       or jsonb_typeof(source -> 'authors') is distinct from 'array'
       or jsonb_array_length(source -> 'authors') not between 1 and 20
       or jsonb_typeof(source -> 'publication_types') is distinct from 'array'
       or jsonb_array_length(source -> 'publication_types') not between 1 and 16 then
       raise exception 'invalid verified academic source' using errcode = '22023';
    end if;
    source_year := (source ->> 'publication_year')::integer;
    if source_year not between 1800 and 2200 then
      raise exception 'invalid verified academic source' using errcode = '22023';
    end if;
    if stored_source_provider = 'pubmed' then
      if source ->> 'source_id' !~ '^pmid:[0-9]{1,9}$'
         or source ->> 'pmid' !~ '^[0-9]{1,9}$'
         or source ->> 'source_id' is distinct from
            'pmid:' || (source ->> 'pmid')
         or source #>> '{verification,pubmed}' is distinct from 'true' then
        raise exception 'invalid verified academic source' using errcode = '22023';
      end if;
    elsif stored_source_provider = 'crossref_openalex' then
      if source ->> 'source_id' !~ '^doi:10\.[0-9]{4,9}/\S+$'
         or char_length(coalesce(source ->> 'source_id', '')) > 259
         or coalesce(source ->> 'pmid', '') <> ''
         or lower(coalesce(source ->> 'doi', '')) !~ '^10\.[0-9]{4,9}/\S+$'
         or char_length(coalesce(source ->> 'doi', '')) > 255
         or source ->> 'source_id' is distinct from
            'doi:' || lower(source ->> 'doi')
         or source #>> '{verification,crossref}' is distinct from 'true'
         or source #>> '{verification,openalex}' is distinct from 'true' then
        raise exception 'invalid verified academic source' using errcode = '22023';
      end if;
    else
      raise exception 'invalid verified academic source' using errcode = '22023';
    end if;
    if request_row.retrieval_version = 'phase7-25-retrieval-v1'
       and source ->> 'source_role' = 'primary'
       and source #>> '{verification,originalResearch}' is distinct from 'true' then
      raise exception 'primary source is not verified as original research'
        using errcode = '22023';
    end if;
    if source ->> 'source_id' = any(source_ids) then
      raise exception 'duplicate academic source' using errcode = '22023';
    end if;
    source_ids := array_append(source_ids, source ->> 'source_id');
    has_pubmed_source := has_pubmed_source or stored_source_provider = 'pubmed';
    has_crossref_source := has_crossref_source
      or stored_source_provider = 'crossref_openalex';
    if source ->> 'source_role' = 'primary' then
      primary_ids := array_append(primary_ids, source ->> 'source_id');
    end if;
  end loop;
  if cardinality(primary_ids) < 1 then
    raise exception 'primary academic evidence is required' using errcode = '22023';
  end if;
  if cardinality(source_ids) <> request_row.verified_source_count
     or cardinality(primary_ids) <> request_row.verified_primary_count
     or (
       request_row.retrieval_version = 'phase7-25-retrieval-v1'
       and target_quality_result ->> 'source_set_sha256'
          is distinct from request_row.source_set_sha256
     )
     or (
       effective_route = 'biomedical_pubmed'
       and (has_crossref_source or not has_pubmed_source)
     )
     or (
       effective_route = 'multidisciplinary_doi'
       and (has_pubmed_source or not has_crossref_source)
     ) then
    raise exception 'academic evidence set does not match admission'
      using errcode = '22023';
  end if;
  for point in select value from jsonb_array_elements(target_body -> 'answer_points')
  loop
    point_ids := array(select value from jsonb_array_elements_text(point -> 'source_ids'));
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
  publish_automatically := request_row.publication_mode = 'auto_unreviewed';
  if publish_automatically and not exists (
    select 1
    from public.lecture_summary_runs as run
    where run.id = request_row.automation_run_id
      and run.lecture_session_id = request_row.lecture_session_id
      and run.actor_id = request_row.requested_by_actor
      and run.status = 'running'
      and run.expires_at > statement_timestamp()
      and run.auto_academic_answers_enabled
  ) then
    update public.academic_answer_requests
    set status = 'discarded', error_code = 'automation_stopped_before_publish',
        updated_at = statement_timestamp()
    where id = target_request_id;
    return completion || jsonb_build_object(
      'result_saved', false, 'reason', 'automation_stopped_before_publish'
    );
  end if;
  insert into public.lecture_academic_answers (
    lecture_session_id, request_id, operation_id, question, source_kind,
    source_summary_id, model_id, prompt_version, source_set_sha256,
    quality_result, status
  ) values (
    request_row.lecture_session_id, request_row.id, target_operation_id,
    request_row.question, request_row.source_kind, request_row.source_summary_id,
    usage_row.model_id, request_row.prompt_version, request_row.source_set_sha256,
    target_quality_result,
    case when publish_automatically then 'published' else 'awaiting_review' end
  ) returning id into answer_id;
  for source in select value from jsonb_array_elements(target_sources)
  loop
    stored_source_provider := coalesce(
      nullif(source ->> 'source_provider', ''),
      case when source ->> 'pmid' ~ '^[0-9]{1,9}$' then 'pubmed' end
    );
    insert into public.academic_answer_sources (
      answer_id, lecture_session_id, source_id, source_provider, pmid, doi,
      title, publication_year, authors, journal, publication_types,
      study_type, source_role, verification
    ) values (
      answer_id, request_row.lecture_session_id, source ->> 'source_id',
      stored_source_provider, nullif(source ->> 'pmid', ''),
      nullif(lower(source ->> 'doi'), ''), trim(source ->> 'title'),
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
    answer_id, lecture_session_id, active_revision_id, visibility,
    review_state, published_at
  ) values (
    answer_id, request_row.lecture_session_id, revision_id,
    case when publish_automatically then 'public' else 'hidden' end,
    'ai_unreviewed',
    case when publish_automatically then statement_timestamp() else null end
  );
  update public.academic_answer_requests
  set status = case when publish_automatically then 'published' else 'awaiting_review' end,
      updated_at = statement_timestamp()
  where id = target_request_id;
  if publish_automatically then
    insert into public.academic_answer_publication_events (
      lecture_session_id, answer_id, revision_id, actor_id, event_type,
      previous_visibility, next_visibility, reason
    ) values (
      request_row.lecture_session_id, answer_id, revision_id, null,
      'auto_publish', 'hidden', 'public', 'five_minute_summary_candidate'
    );
    perform private.bump_lecture_live_state(
      request_row.lecture_session_id, 'summaries'
    );
  end if;
  return completion || jsonb_build_object(
    'result_saved', true,
    'auto_published', publish_automatically,
    'results', private.phase72_admin_results_json(request_row.lecture_session_id)
  );
end;
$$;

create or replace function private.manage_academic_answer_publication(
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
  next_visibility text;
begin
  if nullif(trim(target_actor_id), '') is null
     or char_length(target_actor_id) > 200
     or target_action not in ('approve', 'hide', 'reject') then
    raise exception 'invalid academic publication action' using errcode = '22023';
  end if;
  perform private.close_lecture_if_expired(target_lecture_session_id);
  select lecture.* into lecture_row
  from public.lecture_sessions as lecture
  where lecture.id = target_lecture_session_id for update;
  if not found
     or (
       lecture_row.status <> 'open'
       and not (
         lecture_row.status = 'closed'
         and lecture_row.archive_expires_at > statement_timestamp()
       )
     ) then
    raise exception 'lecture is outside its review window' using errcode = 'P0001';
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
       and publication_row.review_state in ('admin_confirmed', 'admin_revised')
       and publication_row.reviewed_by_actor_id = target_actor_id then
      return private.phase72_admin_results_json(target_lecture_session_id);
    end if;
    if answer_row.status = 'rejected'
       or not exists (
         select 1 from public.academic_answer_sources as source
         where source.answer_id = answer_row.id and source.source_role = 'primary'
       ) then
      raise exception 'academic answer is not approvable' using errcode = 'P0001';
    end if;
    update public.academic_answer_publications
    set visibility = 'public', review_state = case when exists (
          select 1 from public.academic_answer_revisions as revision
          where revision.id = publication_row.active_revision_id
            and revision.author_type = 'admin'
        ) then 'admin_revised' else 'admin_confirmed' end,
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
    next_visibility := 'public';
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
    next_visibility := 'hidden';
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
    next_visibility := 'hidden';
  end if;
  insert into public.academic_answer_publication_events (
    lecture_session_id, answer_id, revision_id, actor_id, event_type,
    previous_visibility, next_visibility, reason
  ) values (
    target_lecture_session_id, target_answer_id,
    publication_row.active_revision_id, target_actor_id, target_action,
    publication_row.visibility, next_visibility, 'admin_action'
  );
  perform private.bump_lecture_live_state(target_lecture_session_id, 'summaries');
  return private.phase72_admin_results_json(target_lecture_session_id);
end;
$$;

create function private.revise_academic_answer_publication(
  target_lecture_session_id uuid,
  target_answer_id uuid,
  target_actor_id text,
  target_body jsonb,
  target_reason text default null
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
  active_revision public.academic_answer_revisions%rowtype;
  created_revision public.academic_answer_revisions%rowtype;
  point jsonb;
  point_ids text[];
  source_ids text[];
  primary_ids text[];
  next_revision integer;
begin
  if nullif(trim(target_actor_id), '') is null
     or char_length(target_actor_id) > 200
     or not private.phase72_answer_body_is_valid(target_body)
     or char_length(coalesce(target_reason, '')) > 300 then
    raise exception 'invalid academic revision' using errcode = '22023';
  end if;
  perform private.close_lecture_if_expired(target_lecture_session_id);
  select lecture.* into lecture_row
  from public.lecture_sessions as lecture
  where lecture.id = target_lecture_session_id for update;
  if not found
     or (
       lecture_row.status <> 'open'
       and not (
         lecture_row.status = 'closed'
         and lecture_row.archive_expires_at > statement_timestamp()
       )
     ) then
    raise exception 'lecture is outside its review window' using errcode = 'P0001';
  end if;
  select answer.* into answer_row
  from public.lecture_academic_answers as answer
  where answer.id = target_answer_id
    and answer.lecture_session_id = target_lecture_session_id
  for update;
  if not found or answer_row.status = 'rejected' then
    raise exception 'academic answer is not revisable' using errcode = 'P0001';
  end if;
  select publication.* into publication_row
  from public.academic_answer_publications as publication
  where publication.answer_id = target_answer_id
    and publication.lecture_session_id = target_lecture_session_id
  for update;
  if not found then raise exception 'academic publication not found' using errcode = 'P0002'; end if;
  select revision.* into active_revision
  from public.academic_answer_revisions as revision
  where revision.id = publication_row.active_revision_id;
  if active_revision.body = target_body
     and publication_row.review_state = 'admin_revised'
     and publication_row.reviewed_by_actor_id = target_actor_id
     and publication_row.visibility = 'public' then
    return private.phase72_admin_results_json(target_lecture_session_id);
  end if;
  select coalesce(array_agg(source.source_id), '{}'::text[]),
         coalesce(
           array_agg(source.source_id) filter (where source.source_role = 'primary'),
           '{}'::text[]
         )
  into source_ids, primary_ids
  from public.academic_answer_sources as source
  where source.answer_id = target_answer_id;
  if cardinality(source_ids) = 0 or cardinality(primary_ids) = 0 then
    raise exception 'academic revision requires primary sources'
      using errcode = '22023';
  end if;
  for point in select value from jsonb_array_elements(target_body -> 'answer_points')
  loop
    point_ids := array(select value from jsonb_array_elements_text(point -> 'source_ids'));
    if exists (select 1 from unnest(point_ids) as id where not id = any(source_ids))
       or not (point_ids && primary_ids) then
      raise exception 'academic revision source mapping is invalid' using errcode = '22023';
    end if;
  end loop;
  select coalesce(max(revision.revision_number), 0) + 1 into next_revision
  from public.academic_answer_revisions as revision
  where revision.answer_id = target_answer_id;
  insert into public.academic_answer_revisions (
    answer_id, lecture_session_id, revision_number, body, author_type,
    author_actor_id, reason
  ) values (
    target_answer_id, target_lecture_session_id, next_revision, target_body,
    'admin', target_actor_id,
    coalesce(nullif(trim(target_reason), ''), 'teacher_correction')
  ) returning * into created_revision;
  update public.academic_answer_publications
  set active_revision_id = created_revision.id, visibility = 'public',
      review_state = 'admin_revised', reviewed_by_actor_id = target_actor_id,
      published_at = coalesce(published_at, statement_timestamp()),
      updated_at = statement_timestamp()
  where answer_id = target_answer_id;
  update public.lecture_academic_answers
  set status = 'published', updated_at = statement_timestamp()
  where id = target_answer_id;
  update public.academic_answer_requests
  set status = 'published', updated_at = statement_timestamp()
  where id = answer_row.request_id;
  insert into public.academic_answer_publication_events (
    lecture_session_id, answer_id, revision_id, actor_id, event_type,
    previous_visibility, next_visibility, reason
  ) values (
    target_lecture_session_id, target_answer_id, created_revision.id,
    target_actor_id, 'revise_publish', publication_row.visibility, 'public',
    coalesce(nullif(trim(target_reason), ''), 'teacher_correction')
  );
  perform private.bump_lecture_live_state(target_lecture_session_id, 'summaries');
  return private.phase72_admin_results_json(target_lecture_session_id);
end;
$$;

-- All academic terminal paths use the same lock order as automatic stop and
-- completion: lecture -> control -> request -> usage. This prevents the
-- request-first deadlock cycle present in the Phase 7.2 implementation.
create or replace function private.fail_academic_answer_operation(
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
  request_probe public.academic_answer_requests%rowtype;
  request_row public.academic_answer_requests%rowtype;
  completion jsonb;
begin
  select request.* into request_probe
  from public.academic_answer_requests as request
  where request.id = target_request_id
    and request.operation_id = target_operation_id;
  if not found or request_probe.requested_by_actor <> target_actor_id then
    raise exception 'academic operation is not owned by this actor'
      using errcode = '42501';
  end if;
  perform private.close_lecture_if_expired(request_probe.lecture_session_id);
  perform 1 from public.lecture_sessions as lecture
  where lecture.id = request_probe.lecture_session_id for update;
  perform 1 from public.lecture_ai_control as control
  where control.lecture_session_id = request_probe.lecture_session_id for update;
  select request.* into request_row
  from public.academic_answer_requests as request
  where request.id = target_request_id
    and request.operation_id = target_operation_id
  for update;
  if not found or request_row.requested_by_actor <> target_actor_id then
    raise exception 'academic operation is not owned by this actor'
      using errcode = '42501';
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
      lease_until = null,
      error_code = left(coalesce(target_error_code, 'academic_answer_failed'), 120),
      updated_at = statement_timestamp()
  where id = target_request_id
    and status in ('running', 'evidence_checking');
  return completion;
end;
$$;

create or replace function private.cancel_academic_answer_request(
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
  request_probe public.academic_answer_requests%rowtype;
  request_row public.academic_answer_requests%rowtype;
  usage_row public.ai_usage_ledger%rowtype;
  cancellation_error text;
begin
  select request.* into request_probe
  from public.academic_answer_requests as request
  where request.id = target_request_id
    and request.lecture_session_id = target_lecture_session_id;
  if not found or request_probe.requested_by_actor <> target_actor_id then
    raise exception 'academic request is not owned by this actor'
      using errcode = '42501';
  end if;
  perform private.close_lecture_if_expired(target_lecture_session_id);
  perform 1 from public.lecture_sessions as lecture
  where lecture.id = target_lecture_session_id for update;
  perform 1 from public.lecture_ai_control as control
  where control.lecture_session_id = target_lecture_session_id for update;
  select request.* into request_row
  from public.academic_answer_requests as request
  where request.id = target_request_id
    and request.lecture_session_id = target_lecture_session_id
  for update;
  if not found or request_row.requested_by_actor <> target_actor_id then
    raise exception 'academic request is not owned by this actor'
      using errcode = '42501';
  end if;
  if request_row.status not in ('evidence_checking', 'running') then
    return private.phase72_admin_results_json(target_lecture_session_id);
  end if;
  if request_row.operation_id is not null then
    select usage.* into usage_row
    from public.ai_usage_ledger as usage
    where usage.id = request_row.operation_id
    for update;
    if usage_row.id is not null and usage_row.accounting_settled_at is null then
      cancellation_error := case when usage_row.provider_dispatched_at is null
        then 'cancelled_by_admin_before_dispatch'
        else 'cancelled_by_admin_after_dispatch_ambiguous' end;
      perform private.finish_lecture_ai_operation(
        usage_row.id, 'cancelled',
        case when usage_row.provider_dispatched_at is null
          then 0 else usage_row.reserved_microusd end,
        0,
        case when usage_row.provider_dispatched_at is null
          then 0 else usage_row.reserved_input_tokens end,
        case when usage_row.provider_dispatched_at is null
          then 0 else usage_row.reserved_output_tokens end,
        null, cancellation_error
      );
    end if;
  end if;
  update public.academic_answer_requests
  set status = 'discarded', lease_until = null,
      error_code = coalesce(cancellation_error, 'cancelled_by_admin'),
      updated_at = statement_timestamp()
  where id = target_request_id;
  return private.phase72_admin_results_json(target_lecture_session_id);
end;
$$;

create or replace function private.reap_stale_academic_answer_operations(
  job_limit integer default 10
)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  candidate record;
  request_probe public.academic_answer_requests%rowtype;
  request_row public.academic_answer_requests%rowtype;
  usage_row public.ai_usage_ledger%rowtype;
  reaper_error text;
  reaped integer := 0;
begin
  for candidate in
    select request.id as request_id
    from public.academic_answer_requests as request
    join public.ai_usage_ledger as usage on usage.id = request.operation_id
    where request.status in ('running', 'discarded')
      and usage.accounting_settled_at is null
      and request.updated_at < statement_timestamp() - interval '2 minutes'
    order by request.updated_at, request.id
    limit least(greatest(job_limit, 1), 50)
  loop
    select request.* into request_probe
    from public.academic_answer_requests as request
    where request.id = candidate.request_id;
    if not found then continue; end if;
    perform private.close_lecture_if_expired(request_probe.lecture_session_id);
    perform 1 from public.lecture_sessions as lecture
    where lecture.id = request_probe.lecture_session_id for update;
    perform 1 from public.lecture_ai_control as control
    where control.lecture_session_id = request_probe.lecture_session_id for update;
    select request.* into request_row
    from public.academic_answer_requests as request
    where request.id = candidate.request_id
      and request.status in ('running', 'discarded')
      and request.updated_at < statement_timestamp() - interval '2 minutes'
    for update skip locked;
    if not found or request_row.operation_id is null then continue; end if;
    select usage.* into usage_row
    from public.ai_usage_ledger as usage
    where usage.id = request_row.operation_id
      and usage.accounting_settled_at is null
    for update skip locked;
    if not found then continue; end if;
    reaper_error := case when usage_row.provider_dispatched_at is null
      then 'stale_before_dispatch'
      else 'stale_after_dispatch_ambiguous' end;
    perform private.finish_lecture_ai_operation(
      usage_row.id, 'cancelled',
      case when usage_row.provider_dispatched_at is null
        then 0 else usage_row.reserved_microusd end,
      0,
      case when usage_row.provider_dispatched_at is null
        then 0 else usage_row.reserved_input_tokens end,
      case when usage_row.provider_dispatched_at is null
        then 0 else usage_row.reserved_output_tokens end,
      null, reaper_error
    );
    update public.academic_answer_requests
    set status = 'discarded', lease_until = null,
        error_code = reaper_error, updated_at = statement_timestamp()
    where id = request_row.id;
    reaped := reaped + 1;
  end loop;
  return reaped;
end;
$$;

create function private.phase725_record_manual_academic_setting(
  target_lecture_session_id uuid,
  configuration jsonb,
  target_actor_id text
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if jsonb_typeof(configuration) is distinct from 'object'
     or jsonb_typeof(configuration -> 'academic_answers_enabled')
        is distinct from 'boolean'
     or nullif(trim(target_actor_id), '') is null
     or char_length(target_actor_id) > 200 then
    raise exception 'invalid academic answer setting' using errcode = '22023';
  end if;
  perform 1 from public.lecture_sessions as lecture
  where lecture.id = target_lecture_session_id for update;
  perform 1 from public.lecture_ai_control as control
  where control.lecture_session_id = target_lecture_session_id for update;
  perform 1 from public.lecture_summary_runs as run
  where run.lecture_session_id = target_lecture_session_id
    and run.status = 'running'
  for update;
  update public.lecture_summary_runs
  set previous_academic_answers_enabled =
        (configuration ->> 'academic_answers_enabled')::boolean,
      updated_at = statement_timestamp()
  where lecture_session_id = target_lecture_session_id
    and status = 'running'
    and auto_academic_answers_enabled;
end;
$$;

create or replace function public.admin_configure_lecture_ai_control(
  target_lecture_session_id uuid,
  configuration jsonb,
  target_actor_id text default 'admin-session'
)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = ''
as $$
begin
  if jsonb_typeof(configuration) is not distinct from 'object'
     and configuration ? 'academic_answers_enabled' then
    perform private.phase725_record_manual_academic_setting(
      target_lecture_session_id, configuration, target_actor_id
    );
  end if;
  return private.configure_lecture_ai_control(
    target_lecture_session_id, configuration, target_actor_id
  );
end;
$$;

create function public.admin_start_lecture_summary_run_v2(
  target_grant_id uuid,
  target_grant_nonce_hash text,
  target_lecture_session_id uuid,
  target_run_token_hash text,
  target_actor_id text,
  target_auto_academic_answers_enabled boolean,
  target_academic_source_policy text
)
returns jsonb language sql volatile security invoker set search_path = ''
as $$ select private.start_lecture_summary_run_v2(
  target_grant_id, target_grant_nonce_hash, target_lecture_session_id,
  target_run_token_hash, target_actor_id,
  target_auto_academic_answers_enabled, target_academic_source_policy
); $$;

create function public.admin_prepare_academic_answer_request_v2(
  target_lecture_session_id uuid, target_actor_id text,
  target_idempotency_key text, target_source_kind text,
  target_source_summary_id uuid, target_question text,
  target_question_sha256 text, target_search_query_sha256 text,
  target_source_policy text
)
returns jsonb language sql volatile security invoker set search_path = ''
as $$ select private.prepare_academic_answer_request_v2(
  target_lecture_session_id, target_actor_id, target_idempotency_key,
  target_source_kind, target_source_summary_id, target_question,
  target_question_sha256, target_search_query_sha256, target_source_policy
); $$;

create function public.admin_start_academic_answer_operation_v2(
  target_request_id uuid, target_grant_id uuid, target_nonce_hash text,
  target_actor_id text, target_model_id text, target_prompt_version text,
  target_source_set_sha256 text, target_resolved_source_route text,
  target_verified_source_count integer, target_verified_primary_count integer,
  estimated_microusd bigint, estimated_input_tokens bigint,
  estimated_output_tokens bigint,
  target_input_price_microusd_per_million bigint,
  target_output_price_microusd_per_million bigint
)
returns jsonb language sql volatile security invoker set search_path = ''
as $$ select private.start_academic_answer_operation_v2(
  target_request_id, target_grant_id, target_nonce_hash, target_actor_id,
  target_model_id, target_prompt_version, target_source_set_sha256,
  target_resolved_source_route, target_verified_source_count,
  target_verified_primary_count, estimated_microusd, estimated_input_tokens,
  estimated_output_tokens, target_input_price_microusd_per_million,
  target_output_price_microusd_per_million
); $$;

create function public.admin_prepare_auto_academic_answer_request(
  target_lecture_session_id uuid, target_run_id uuid,
  target_run_token_hash text, target_actor_id text,
  target_idempotency_key text, target_source_summary_id uuid,
  target_question text, target_question_sha256 text,
  target_search_query_sha256 text, target_source_policy text
)
returns jsonb language sql volatile security invoker set search_path = ''
as $$ select private.prepare_auto_academic_answer_request(
  target_lecture_session_id, target_run_id, target_run_token_hash,
  target_actor_id, target_idempotency_key, target_source_summary_id,
  target_question, target_question_sha256, target_search_query_sha256,
  target_source_policy
); $$;

create function public.admin_start_auto_academic_answer_operation(
  target_request_id uuid, target_run_id uuid, target_run_token_hash text,
  target_actor_id text, target_model_id text, target_prompt_version text,
  target_source_set_sha256 text, target_resolved_source_route text,
  target_verified_source_count integer, target_verified_primary_count integer,
  estimated_microusd bigint, estimated_input_tokens bigint,
  estimated_output_tokens bigint,
  target_input_price_microusd_per_million bigint,
  target_output_price_microusd_per_million bigint
)
returns jsonb language sql volatile security invoker set search_path = ''
as $$ select private.start_auto_academic_answer_operation(
  target_request_id, target_run_id, target_run_token_hash, target_actor_id,
  target_model_id, target_prompt_version, target_source_set_sha256,
  target_resolved_source_route, target_verified_source_count,
  target_verified_primary_count, estimated_microusd, estimated_input_tokens,
  estimated_output_tokens, target_input_price_microusd_per_million,
  target_output_price_microusd_per_million
); $$;

create function public.admin_revise_academic_answer_publication(
  target_lecture_session_id uuid, target_answer_id uuid,
  target_actor_id text, target_body jsonb, target_reason text default null
)
returns jsonb language sql volatile security invoker set search_path = ''
as $$ select private.revise_academic_answer_publication(
  target_lecture_session_id, target_answer_id, target_actor_id,
  target_body, target_reason
); $$;

revoke all on function private.start_lecture_summary_run_v2(
  uuid, text, uuid, text, text, boolean, text
) from public, anon, authenticated, service_role;
revoke all on function private.prepare_academic_answer_request_v2(
  uuid, text, text, text, uuid, text, text, text, text
) from public, anon, authenticated, service_role;
revoke all on function private.start_academic_answer_operation_v2(
  uuid, uuid, text, text, text, text, text, text,
  integer, integer, bigint, bigint, bigint, bigint, bigint
) from public, anon, authenticated, service_role;
revoke all on function private.prepare_auto_academic_answer_request(
  uuid, uuid, text, text, text, uuid, text, text, text, text
) from public, anon, authenticated, service_role;
revoke all on function private.start_auto_academic_answer_operation(
  uuid, uuid, text, text, text, text, text, text,
  integer, integer, bigint, bigint, bigint, bigint, bigint
) from public, anon, authenticated, service_role;
revoke all on function private.revise_academic_answer_publication(
  uuid, uuid, text, jsonb, text
) from public, anon, authenticated, service_role;
revoke all on function private.phase725_safe_quality_score(jsonb)
  from public, anon, authenticated, service_role;
revoke all on function private.phase725_record_manual_academic_setting(uuid, jsonb, text)
  from public, anon, authenticated, service_role;

grant execute on function private.start_lecture_summary_run_v2(
  uuid, text, uuid, text, text, boolean, text
) to service_role;
grant execute on function private.prepare_academic_answer_request_v2(
  uuid, text, text, text, uuid, text, text, text, text
) to service_role;
grant execute on function private.start_academic_answer_operation_v2(
  uuid, uuid, text, text, text, text, text, text,
  integer, integer, bigint, bigint, bigint, bigint, bigint
) to service_role;
grant execute on function private.prepare_auto_academic_answer_request(
  uuid, uuid, text, text, text, uuid, text, text, text, text
) to service_role;
grant execute on function private.start_auto_academic_answer_operation(
  uuid, uuid, text, text, text, text, text, text,
  integer, integer, bigint, bigint, bigint, bigint, bigint
) to service_role;
grant execute on function private.revise_academic_answer_publication(
  uuid, uuid, text, jsonb, text
) to service_role;
grant execute on function private.phase725_record_manual_academic_setting(uuid, jsonb, text)
  to service_role;

revoke all on function public.admin_start_lecture_summary_run_v2(
  uuid, text, uuid, text, text, boolean, text
) from public, anon, authenticated, service_role;
revoke all on function public.admin_prepare_academic_answer_request_v2(
  uuid, text, text, text, uuid, text, text, text, text
) from public, anon, authenticated, service_role;
revoke all on function public.admin_start_academic_answer_operation_v2(
  uuid, uuid, text, text, text, text, text, text,
  integer, integer, bigint, bigint, bigint, bigint, bigint
) from public, anon, authenticated, service_role;
revoke all on function public.admin_prepare_auto_academic_answer_request(
  uuid, uuid, text, text, text, uuid, text, text, text, text
) from public, anon, authenticated, service_role;
revoke all on function public.admin_start_auto_academic_answer_operation(
  uuid, uuid, text, text, text, text, text, text,
  integer, integer, bigint, bigint, bigint, bigint, bigint
) from public, anon, authenticated, service_role;
revoke all on function public.admin_revise_academic_answer_publication(
  uuid, uuid, text, jsonb, text
) from public, anon, authenticated, service_role;

grant execute on function public.admin_start_lecture_summary_run_v2(
  uuid, text, uuid, text, text, boolean, text
) to service_role;
grant execute on function public.admin_prepare_academic_answer_request_v2(
  uuid, text, text, text, uuid, text, text, text, text
) to service_role;
grant execute on function public.admin_start_academic_answer_operation_v2(
  uuid, uuid, text, text, text, text, text, text,
  integer, integer, bigint, bigint, bigint, bigint, bigint
) to service_role;
grant execute on function public.admin_prepare_auto_academic_answer_request(
  uuid, uuid, text, text, text, uuid, text, text, text, text
) to service_role;
grant execute on function public.admin_start_auto_academic_answer_operation(
  uuid, uuid, text, text, text, text, text, text,
  integer, integer, bigint, bigint, bigint, bigint, bigint
) to service_role;
grant execute on function public.admin_revise_academic_answer_publication(
  uuid, uuid, text, jsonb, text
) to service_role;

comment on column public.lecture_summary_runs.auto_academic_answers_enabled is
  'Teacher opt-in captured only after an API PIN grant scoped to summaries and academic answers.';
comment on column public.academic_answer_requests.publication_mode is
  'Manual answers remain hidden; authorized five-minute candidates may publish as AI-unreviewed.';
comment on table public.academic_answer_publication_events is
  'Append-only audit trail for automatic publication and teacher remediation.';
