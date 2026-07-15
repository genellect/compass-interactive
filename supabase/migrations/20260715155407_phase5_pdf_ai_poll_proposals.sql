-- Phase 5: Admin-only, explicitly billed PDF analysis and Poll proposals.
--
-- Expand-first guarantees:
-- - no existing table, RPC, or signature is removed;
-- - extracted PDF source text is never stored in Supabase;
-- - Phase 4.1's authoritative usage ledger and Batch lane remain authoritative;
-- - all browser roles are denied; only service_role-backed Edge Functions may call
--   the public SECURITY INVOKER wrappers.

create table public.material_ai_operation_contexts (
  operation_id uuid primary key
    references public.ai_usage_ledger(id) on delete restrict,
  lecture_session_id uuid not null
    references public.lecture_sessions(id) on delete restrict,
  feature text not null
    check (feature in ('material_analysis', 'poll_suggestions')),
  source_document_id text not null,
  source_document_version text not null,
  source_text_sha256 text not null
    check (source_text_sha256 ~ '^[0-9a-f]{64}$'),
  analysis_id uuid,
  requested_page_start integer,
  requested_page_end integer,
  prompt_version text not null
    check (char_length(prompt_version) between 1 and 80),
  model_id text not null
    check (char_length(model_id) between 1 and 120),
  input_price_microusd_per_million bigint not null
    check (input_price_microusd_per_million between 0 and 100000000),
  output_price_microusd_per_million bigint not null
    check (output_price_microusd_per_million between 0 and 100000000),
  max_output_tokens integer not null
    check (max_output_tokens between 1 and 10000),
  result_committed_at timestamptz,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  foreign key (
    lecture_session_id,
    source_document_id,
    source_document_version
  ) references public.lecture_pdf_documents (
    lecture_session_id,
    document_id,
    document_version
  ) on delete restrict,
  check (
    (
      feature = 'material_analysis'
      and requested_page_start is null
      and requested_page_end is null
    )
    or (
      feature = 'poll_suggestions'
      and analysis_id is not null
      and requested_page_start between 1 and 75
      and requested_page_end between requested_page_start and 75
    )
  )
);

create index material_ai_operation_contexts_lecture_created_idx
  on public.material_ai_operation_contexts (lecture_session_id, created_at desc);

create table public.lecture_material_analyses (
  id uuid primary key default extensions.gen_random_uuid(),
  lecture_session_id uuid not null
    references public.lecture_sessions(id) on delete restrict,
  operation_id uuid not null unique
    references public.material_ai_operation_contexts(operation_id) on delete restrict,
  source_document_id text not null,
  source_document_version text not null,
  source_text_sha256 text not null
    check (source_text_sha256 ~ '^[0-9a-f]{64}$'),
  prompt_version text not null
    check (char_length(prompt_version) between 1 and 80),
  model_id text not null
    check (char_length(model_id) between 1 and 120),
  input_price_microusd_per_million bigint not null
    check (input_price_microusd_per_million between 0 and 100000000),
  output_price_microusd_per_million bigint not null
    check (output_price_microusd_per_million between 0 and 100000000),
  material_outline jsonb not null
    check (
      jsonb_typeof(material_outline) = 'array'
      and jsonb_array_length(material_outline) between 1 and 12
    ),
  material_summary text not null
    check (char_length(material_summary) between 1 and 2000),
  key_terms jsonb not null
    check (
      jsonb_typeof(key_terms) = 'array'
      and jsonb_array_length(key_terms) between 1 and 20
    ),
  important_pages integer[] not null
    check (cardinality(important_pages) between 1 and 20),
  section_boundaries jsonb not null
    check (
      jsonb_typeof(section_boundaries) = 'array'
      and jsonb_array_length(section_boundaries) between 1 and 20
    ),
  status text not null default 'active'
    check (status in ('active', 'superseded')),
  created_at timestamptz not null default statement_timestamp(),
  superseded_at timestamptz,
  foreign key (
    lecture_session_id,
    source_document_id,
    source_document_version
  ) references public.lecture_pdf_documents (
    lecture_session_id,
    document_id,
    document_version
  ) on delete restrict,
  check (
    (status = 'active' and superseded_at is null)
    or (status = 'superseded' and superseded_at is not null)
  )
);

create unique index lecture_material_analyses_active_document_idx
  on public.lecture_material_analyses (
    lecture_session_id,
    source_document_id,
    source_document_version
  )
  where status = 'active';

create index lecture_material_analyses_lecture_created_idx
  on public.lecture_material_analyses (lecture_session_id, created_at desc);

alter table public.material_ai_operation_contexts
  add constraint material_ai_operation_contexts_analysis_fkey
  foreign key (analysis_id)
  references public.lecture_material_analyses(id)
  on delete restrict;

create table public.ai_poll_proposals (
  id uuid primary key default extensions.gen_random_uuid(),
  lecture_session_id uuid not null
    references public.lecture_sessions(id) on delete restrict,
  analysis_id uuid not null
    references public.lecture_material_analyses(id) on delete restrict,
  operation_id uuid not null
    references public.material_ai_operation_contexts(operation_id) on delete restrict,
  ordinal integer not null check (ordinal between 1 and 8),
  source_document_id text not null,
  source_document_version text not null,
  source_text_sha256 text not null
    check (source_text_sha256 ~ '^[0-9a-f]{64}$'),
  prompt_version text not null
    check (char_length(prompt_version) between 1 and 80),
  model_id text not null
    check (char_length(model_id) between 1 and 120),
  proposal_type text not null
    check (proposal_type in ('single_choice', 'multiple_choice', 'discussion')),
  stem text not null check (char_length(stem) between 10 and 300),
  options jsonb not null check (jsonb_typeof(options) = 'array'),
  correct_option_ids text[] not null,
  explanation text not null
    check (char_length(explanation) between 1 and 1200),
  learning_objective text not null
    check (char_length(learning_objective) between 1 and 600),
  misconception_target text
    check (misconception_target is null or char_length(misconception_target) <= 600),
  difficulty text not null
    check (difficulty in ('beginner', 'intermediate', 'advanced')),
  evidence_pages integer[] not null
    check (cardinality(evidence_pages) between 1 and 8),
  evidence_excerpt_ids text[] not null
    check (cardinality(evidence_excerpt_ids) between 1 and 8),
  educational_value text not null
    check (char_length(educational_value) between 1 and 800),
  quality_score numeric(4,3) not null
    check (quality_score between 0 and 1),
  status text not null default 'draft'
    check (status in ('draft', 'adopted', 'rejected', 'expired', 'superseded')),
  adopted_poll_id uuid references public.polls(id) on delete restrict,
  reviewed_by_actor text
    check (reviewed_by_actor is null or char_length(reviewed_by_actor) between 1 and 200),
  reviewed_at timestamptz,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  unique (operation_id, ordinal),
  foreign key (
    lecture_session_id,
    source_document_id,
    source_document_version
  ) references public.lecture_pdf_documents (
    lecture_session_id,
    document_id,
    document_version
  ) on delete restrict,
  check (
    (status = 'adopted' and adopted_poll_id is not null and reviewed_at is not null)
    or (status <> 'adopted' and adopted_poll_id is null)
  )
);

create index ai_poll_proposals_lecture_status_created_idx
  on public.ai_poll_proposals (lecture_session_id, status, created_at desc);

create index ai_poll_proposals_analysis_created_idx
  on public.ai_poll_proposals (analysis_id, created_at, ordinal);

create index ai_poll_proposals_adopted_poll_idx
  on public.ai_poll_proposals (adopted_poll_id)
  where adopted_poll_id is not null;

alter table public.material_ai_operation_contexts enable row level security;
alter table public.lecture_material_analyses enable row level security;
alter table public.ai_poll_proposals enable row level security;

revoke all on public.material_ai_operation_contexts
  from public, anon, authenticated;
revoke all on public.lecture_material_analyses
  from public, anon, authenticated;
revoke all on public.ai_poll_proposals
  from public, anon, authenticated;

grant select, insert, update on public.material_ai_operation_contexts
  to service_role;
grant select, insert, update on public.lecture_material_analyses
  to service_role;
grant select, insert, update on public.ai_poll_proposals
  to service_role;

create function private.validate_phase5_poll_proposal(
  proposal jsonb,
  document_page_count integer
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  proposal_type text := proposal ->> 'type';
  option_item jsonb;
  option_ids text[] := ARRAY[]::text[];
  correct_ids text[];
  evidence_pages integer[];
  evidence_excerpt_ids text[];
begin
  if jsonb_typeof(proposal) <> 'object'
     or proposal_type not in ('single_choice', 'multiple_choice', 'discussion')
     or char_length(trim(coalesce(proposal ->> 'stem', ''))) not between 10 and 300
     or jsonb_typeof(proposal -> 'options') <> 'array'
     or jsonb_typeof(proposal -> 'correctOptionIds') <> 'array'
     or jsonb_typeof(proposal -> 'evidencePages') <> 'array'
     or jsonb_typeof(proposal -> 'evidenceExcerptIds') <> 'array'
     or char_length(trim(coalesce(proposal ->> 'explanation', ''))) not between 1 and 1200
     or char_length(trim(coalesce(proposal ->> 'learningObjective', ''))) not between 1 and 600
     or char_length(trim(coalesce(proposal ->> 'educationalValue', ''))) not between 1 and 800
     or coalesce(proposal ->> 'difficulty', '') not in ('beginner', 'intermediate', 'advanced')
     or coalesce((proposal ->> 'qualityScore')::numeric, -1) not between 0 and 1 then
    raise exception 'invalid Poll proposal payload' using errcode = '22023';
  end if;

  if proposal -> 'misconceptionTarget' <> 'null'::jsonb
     and char_length(coalesce(proposal ->> 'misconceptionTarget', '')) > 600 then
    raise exception 'invalid misconception target' using errcode = '22023';
  end if;

  for option_item in select value from jsonb_array_elements(proposal -> 'options') loop
    if jsonb_typeof(option_item) <> 'object'
       or coalesce(option_item ->> 'id', '') !~ '^[a-z0-9][a-z0-9_-]{0,49}$'
       or char_length(trim(coalesce(option_item ->> 'text', ''))) not between 1 and 200 then
      raise exception 'invalid Poll proposal option' using errcode = '22023';
    end if;
    if option_item ->> 'id' = any(option_ids) then
      raise exception 'Poll proposal option ids must be unique' using errcode = '22023';
    end if;
    option_ids := array_append(option_ids, option_item ->> 'id');
  end loop;

  select coalesce(array_agg(value), ARRAY[]::text[])
  into correct_ids
  from jsonb_array_elements_text(proposal -> 'correctOptionIds') as item(value);

  if (proposal_type = 'discussion' and cardinality(option_ids) <> 0)
     or (proposal_type = 'discussion' and cardinality(correct_ids) <> 0)
     or (proposal_type = 'single_choice' and cardinality(option_ids) not between 2 and 8)
     or (proposal_type = 'single_choice' and cardinality(correct_ids) <> 1)
     or (proposal_type = 'multiple_choice' and cardinality(option_ids) not between 2 and 8)
     or (proposal_type = 'multiple_choice' and cardinality(correct_ids) not between 1 and cardinality(option_ids))
     or exists (
       select 1 from unnest(correct_ids) as correct_id
       where not (correct_id = any(option_ids))
     )
     or cardinality(correct_ids) <> (
       select count(distinct correct_id) from unnest(correct_ids) as correct_id
     ) then
    raise exception 'invalid Poll proposal answer set' using errcode = '22023';
  end if;

  select coalesce(array_agg(value::integer), ARRAY[]::integer[])
  into evidence_pages
  from jsonb_array_elements_text(proposal -> 'evidencePages') as item(value);
  select coalesce(array_agg(value), ARRAY[]::text[])
  into evidence_excerpt_ids
  from jsonb_array_elements_text(proposal -> 'evidenceExcerptIds') as item(value);

  if cardinality(evidence_pages) not between 1 and 8
     or cardinality(evidence_excerpt_ids) not between 1 and 8
     or cardinality(evidence_pages) <> cardinality(evidence_excerpt_ids)
     or exists (
       select 1 from unnest(evidence_pages) as page_number
       where page_number not between 1 and document_page_count
     )
     or exists (
       select 1 from unnest(evidence_excerpt_ids) as excerpt_id
       where excerpt_id !~ '^[0-9a-f]{64}$'
     )
     or cardinality(evidence_pages) <> (
       select count(distinct page_number) from unnest(evidence_pages) as page_number
     ) then
    raise exception 'invalid Poll proposal evidence' using errcode = '22023';
  end if;
end;
$$;

create function private.start_material_ai_operation(
  target_grant_id uuid,
  target_nonce_hash text,
  target_lecture_session_id uuid,
  target_feature text,
  target_idempotency_key text,
  target_actor_id text,
  target_document_id text,
  target_document_version text,
  target_text_sha256 text,
  target_analysis_id uuid,
  target_page_start integer,
  target_page_end integer,
  target_model_id text,
  target_prompt_version text,
  target_input_price_microusd_per_million bigint,
  target_output_price_microusd_per_million bigint,
  target_max_output_tokens integer,
  estimated_microusd bigint,
  estimated_input_tokens bigint,
  estimated_output_tokens bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  start_result jsonb;
  started_operation_id uuid;
  document_row public.lecture_pdf_documents%rowtype;
  minimum_reservation bigint;
begin
  if target_feature not in ('material_analysis', 'poll_suggestions')
     or target_document_id !~ '^[a-z0-9][a-z0-9-]{0,63}$'
     or target_document_version !~ '^[0-9a-f]{64}$'
     or target_text_sha256 !~ '^[0-9a-f]{64}$'
     or char_length(coalesce(target_model_id, '')) not between 1 and 120
     or char_length(coalesce(target_prompt_version, '')) not between 1 and 80
     or target_input_price_microusd_per_million not between 0 and 100000000
     or target_output_price_microusd_per_million not between 0 and 100000000
     or target_max_output_tokens not between 1 and 10000
     or estimated_input_tokens not between 1 and 100000
     or estimated_output_tokens not between 1 and target_max_output_tokens then
    raise exception 'invalid material AI operation request' using errcode = '22023';
  end if;

  minimum_reservation := ceil(
    estimated_input_tokens::numeric
      * target_input_price_microusd_per_million::numeric / 1000000
    + estimated_output_tokens::numeric
      * target_output_price_microusd_per_million::numeric / 1000000
  )::bigint;
  if estimated_microusd < minimum_reservation then
    raise exception 'material AI cost reservation is too small' using errcode = '22023';
  end if;

  start_result := private.consume_ai_billing_grant_and_start_operations(
    target_grant_id,
    target_nonce_hash,
    target_lecture_session_id,
    jsonb_build_array(jsonb_build_object(
      'feature', target_feature,
      'idempotency_key', target_idempotency_key,
      'estimated_microusd', estimated_microusd,
      'estimated_audio_seconds', 0,
      'estimated_input_tokens', estimated_input_tokens,
      'estimated_output_tokens', estimated_output_tokens,
      'model_id', target_model_id,
      'pricing_unit', 'token',
      -- The legacy scalar records the conservative highest per-token rate.
      'pricing_rate_microusd', ceil(
        target_output_price_microusd_per_million::numeric / 1000000
      )::bigint
    )),
    target_actor_id
  );

  if coalesce((start_result ->> 'accepted')::boolean, false) is not true then
    return start_result;
  end if;
  started_operation_id := (start_result #>> '{operations,0,operation,id}')::uuid;

  select document.*
  into document_row
  from public.lecture_pdf_documents as document
  where document.lecture_session_id = target_lecture_session_id
    and document.document_id = target_document_id
    and document.document_version = target_document_version
    and document.visible;

  if not found
     or document_row.text_sha256 <> target_text_sha256 then
    raise exception 'PDF extraction metadata does not match' using errcode = '23514';
  end if;

  if target_feature = 'material_analysis' then
    if target_analysis_id is not null
       or target_page_start is not null
       or target_page_end is not null then
      raise exception 'initial material analysis cannot have a page range'
        using errcode = '22023';
    end if;
  else
    perform 1
    from public.lecture_material_analyses as analysis
    where analysis.id = target_analysis_id
      and analysis.lecture_session_id = target_lecture_session_id
      and analysis.source_document_id = target_document_id
      and analysis.source_document_version = target_document_version
      and analysis.source_text_sha256 = target_text_sha256
      and analysis.status = 'active';

    if not found
       or target_page_start is null
       or target_page_end is null
       or target_page_start not between 1 and document_row.page_count
       or target_page_end not between target_page_start and document_row.page_count then
      raise exception 'additional Poll request is not bound to an active analysis'
        using errcode = '22023';
    end if;
  end if;

  insert into public.material_ai_operation_contexts (
    operation_id,
    lecture_session_id,
    feature,
    source_document_id,
    source_document_version,
    source_text_sha256,
    analysis_id,
    requested_page_start,
    requested_page_end,
    prompt_version,
    model_id,
    input_price_microusd_per_million,
    output_price_microusd_per_million,
    max_output_tokens
  ) values (
    started_operation_id,
    target_lecture_session_id,
    target_feature,
    target_document_id,
    target_document_version,
    target_text_sha256,
    target_analysis_id,
    target_page_start,
    target_page_end,
    target_prompt_version,
    target_model_id,
    target_input_price_microusd_per_million,
    target_output_price_microusd_per_million,
    target_max_output_tokens
  )
  on conflict (operation_id) do nothing;

  if not exists (
    select 1
    from public.material_ai_operation_contexts as context
    where context.operation_id = started_operation_id
      and context.lecture_session_id = target_lecture_session_id
      and context.feature = target_feature
      and context.source_document_id = target_document_id
      and context.source_document_version = target_document_version
      and context.source_text_sha256 = target_text_sha256
      and context.analysis_id is not distinct from target_analysis_id
      and context.requested_page_start is not distinct from target_page_start
      and context.requested_page_end is not distinct from target_page_end
      and context.prompt_version = target_prompt_version
      and context.model_id = target_model_id
  ) then
    raise exception 'material AI operation context mismatch' using errcode = '23514';
  end if;

  return start_result;
end;
$$;

create function private.material_ai_results_json(
  target_lecture_session_id uuid
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'analysis', (
      select jsonb_build_object(
        'id', analysis.id,
        'operation_id', analysis.operation_id,
        'source_document_id', analysis.source_document_id,
        'source_document_version', analysis.source_document_version,
        'source_text_sha256', analysis.source_text_sha256,
        'prompt_version', analysis.prompt_version,
        'model_id', analysis.model_id,
        'material_outline', analysis.material_outline,
        'material_summary', analysis.material_summary,
        'key_terms', analysis.key_terms,
        'important_pages', to_jsonb(analysis.important_pages),
        'section_boundaries', analysis.section_boundaries,
        'created_at', analysis.created_at
      )
      from public.lecture_material_analyses as analysis
      where analysis.lecture_session_id = target_lecture_session_id
        and analysis.status = 'active'
      order by analysis.created_at desc
      limit 1
    ),
    'proposals', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', proposal.id,
        'analysis_id', proposal.analysis_id,
        'operation_id', proposal.operation_id,
        'ordinal', proposal.ordinal,
        'source_document_id', proposal.source_document_id,
        'source_document_version', proposal.source_document_version,
        'proposal_type', proposal.proposal_type,
        'stem', proposal.stem,
        'options', proposal.options,
        'correct_option_ids', to_jsonb(proposal.correct_option_ids),
        'explanation', proposal.explanation,
        'learning_objective', proposal.learning_objective,
        'misconception_target', proposal.misconception_target,
        'difficulty', proposal.difficulty,
        'evidence_pages', to_jsonb(proposal.evidence_pages),
        'evidence_excerpt_ids', to_jsonb(proposal.evidence_excerpt_ids),
        'educational_value', proposal.educational_value,
        'quality_score', proposal.quality_score,
        'status', proposal.status,
        'adopted_poll_id', proposal.adopted_poll_id,
        'reviewed_at', proposal.reviewed_at,
        'created_at', proposal.created_at
      ) order by proposal.created_at, proposal.ordinal)
      from public.ai_poll_proposals as proposal
      where proposal.lecture_session_id = target_lecture_session_id
    ), '[]'::jsonb)
  );
$$;

create function private.complete_material_ai_operation(
  target_operation_id uuid,
  target_actor_id text,
  target_result jsonb,
  actual_microusd bigint,
  actual_input_tokens bigint,
  actual_output_tokens bigint,
  provider_request_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  context_row public.material_ai_operation_contexts%rowtype;
  usage_row public.ai_usage_ledger%rowtype;
  document_row public.lecture_pdf_documents%rowtype;
  completion_result jsonb;
  analysis_payload jsonb;
  proposal_payload jsonb;
  created_analysis_id uuid;
  proposal_ordinal integer := 0;
  important_pages integer[];
begin
  if jsonb_typeof(target_result) <> 'object'
     or least(actual_microusd, actual_input_tokens, actual_output_tokens) < 0 then
    raise exception 'invalid material AI result' using errcode = '22023';
  end if;

  select context.*
  into context_row
  from public.material_ai_operation_contexts as context
  where context.operation_id = target_operation_id;

  select usage.*
  into usage_row
  from public.ai_usage_ledger as usage
  where usage.id = target_operation_id;

  if not found
     or usage_row.requested_by_actor <> target_actor_id
     or usage_row.feature <> context_row.feature then
    raise exception 'material AI operation is not owned by this actor'
      using errcode = '42501';
  end if;

  if context_row.result_committed_at is not null then
    completion_result := private.finish_lecture_ai_operation(
      target_operation_id,
      'succeeded',
      actual_microusd,
      0,
      actual_input_tokens,
      actual_output_tokens,
      provider_request_id,
      null
    );
    return completion_result || jsonb_build_object(
      'result_saved', true,
      'results', private.material_ai_results_json(context_row.lecture_session_id)
    );
  end if;

  if jsonb_typeof(target_result -> 'proposals') <> 'array'
     or jsonb_array_length(target_result -> 'proposals') not between 1 and 8 then
    raise exception 'invalid material AI result' using errcode = '22023';
  end if;

  select document.*
  into document_row
  from public.lecture_pdf_documents as document
  where document.lecture_session_id = context_row.lecture_session_id
    and document.document_id = context_row.source_document_id
    and document.document_version = context_row.source_document_version;

  if not found or document_row.text_sha256 <> context_row.source_text_sha256 then
    raise exception 'material AI source metadata changed' using errcode = '23514';
  end if;

  if context_row.feature = 'material_analysis' then
    analysis_payload := target_result -> 'analysis';
    if jsonb_typeof(analysis_payload) <> 'object'
       or jsonb_typeof(analysis_payload -> 'outline') <> 'array'
       or jsonb_array_length(analysis_payload -> 'outline') not between 1 and 12
       or char_length(trim(coalesce(analysis_payload ->> 'summary', ''))) not between 1 and 2000
       or jsonb_typeof(analysis_payload -> 'keyTerms') <> 'array'
       or jsonb_array_length(analysis_payload -> 'keyTerms') not between 1 and 20
       or jsonb_typeof(analysis_payload -> 'importantPages') <> 'array'
       or jsonb_array_length(analysis_payload -> 'importantPages') not between 1 and 20
       or jsonb_typeof(analysis_payload -> 'sectionBoundaries') <> 'array'
       or jsonb_array_length(analysis_payload -> 'sectionBoundaries') not between 1 and 20 then
      raise exception 'invalid material analysis payload' using errcode = '22023';
    end if;

    select array_agg(value::integer)
    into important_pages
    from jsonb_array_elements_text(analysis_payload -> 'importantPages') as item(value);
    if exists (
      select 1 from unnest(important_pages) as page_number
      where page_number not between 1 and document_row.page_count
    )
       or cardinality(important_pages) <> (
         select count(distinct page_number)
         from unnest(important_pages) as page_number
       ) then
      raise exception 'analysis important pages are invalid' using errcode = '22023';
    end if;
  elsif target_result ? 'analysis' and target_result -> 'analysis' <> 'null'::jsonb then
    raise exception 'additional Poll result cannot replace analysis'
      using errcode = '22023';
  end if;

  for proposal_payload in
    select value from jsonb_array_elements(target_result -> 'proposals')
  loop
    perform private.validate_phase5_poll_proposal(
      proposal_payload,
      document_row.page_count
    );
  end loop;

  completion_result := private.finish_lecture_ai_operation(
    target_operation_id,
    'succeeded',
    actual_microusd,
    0,
    actual_input_tokens,
    actual_output_tokens,
    provider_request_id,
    null
  );

  if coalesce((completion_result ->> 'accepted')::boolean, false) is not true then
    return completion_result || jsonb_build_object('result_saved', false);
  end if;

  if context_row.feature = 'material_analysis' then
    update public.lecture_material_analyses as analysis
    set
      status = 'superseded',
      superseded_at = statement_timestamp()
    where analysis.lecture_session_id = context_row.lecture_session_id
      and analysis.source_document_id = context_row.source_document_id
      and analysis.source_document_version = context_row.source_document_version
      and analysis.status = 'active';

    insert into public.lecture_material_analyses (
      lecture_session_id,
      operation_id,
      source_document_id,
      source_document_version,
      source_text_sha256,
      prompt_version,
      model_id,
      input_price_microusd_per_million,
      output_price_microusd_per_million,
      material_outline,
      material_summary,
      key_terms,
      important_pages,
      section_boundaries
    ) values (
      context_row.lecture_session_id,
      context_row.operation_id,
      context_row.source_document_id,
      context_row.source_document_version,
      context_row.source_text_sha256,
      context_row.prompt_version,
      context_row.model_id,
      context_row.input_price_microusd_per_million,
      context_row.output_price_microusd_per_million,
      analysis_payload -> 'outline',
      trim(analysis_payload ->> 'summary'),
      analysis_payload -> 'keyTerms',
      important_pages,
      analysis_payload -> 'sectionBoundaries'
    )
    returning id into created_analysis_id;

    update public.material_ai_operation_contexts
    set analysis_id = created_analysis_id
    where operation_id = target_operation_id;
  else
    created_analysis_id := context_row.analysis_id;
  end if;

  for proposal_payload in
    select value from jsonb_array_elements(target_result -> 'proposals')
  loop
    proposal_ordinal := proposal_ordinal + 1;
    insert into public.ai_poll_proposals (
      lecture_session_id,
      analysis_id,
      operation_id,
      ordinal,
      source_document_id,
      source_document_version,
      source_text_sha256,
      prompt_version,
      model_id,
      proposal_type,
      stem,
      options,
      correct_option_ids,
      explanation,
      learning_objective,
      misconception_target,
      difficulty,
      evidence_pages,
      evidence_excerpt_ids,
      educational_value,
      quality_score
    ) values (
      context_row.lecture_session_id,
      created_analysis_id,
      context_row.operation_id,
      proposal_ordinal,
      context_row.source_document_id,
      context_row.source_document_version,
      context_row.source_text_sha256,
      context_row.prompt_version,
      context_row.model_id,
      proposal_payload ->> 'type',
      trim(proposal_payload ->> 'stem'),
      proposal_payload -> 'options',
      array(
        select value
        from jsonb_array_elements_text(proposal_payload -> 'correctOptionIds')
      ),
      trim(proposal_payload ->> 'explanation'),
      trim(proposal_payload ->> 'learningObjective'),
      nullif(trim(proposal_payload ->> 'misconceptionTarget'), ''),
      proposal_payload ->> 'difficulty',
      array(
        select value::integer
        from jsonb_array_elements_text(proposal_payload -> 'evidencePages')
      ),
      array(
        select value
        from jsonb_array_elements_text(proposal_payload -> 'evidenceExcerptIds')
      ),
      trim(proposal_payload ->> 'educationalValue'),
      (proposal_payload ->> 'qualityScore')::numeric
    );
  end loop;

  update public.material_ai_operation_contexts
  set
    result_committed_at = statement_timestamp(),
    updated_at = statement_timestamp()
  where operation_id = target_operation_id;

  return completion_result || jsonb_build_object(
    'result_saved', true,
    'results', private.material_ai_results_json(context_row.lecture_session_id)
  );
end;
$$;

create function private.fail_material_ai_operation(
  target_operation_id uuid,
  target_actor_id text,
  target_status text,
  actual_microusd bigint,
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
  usage_row public.ai_usage_ledger%rowtype;
begin
  select usage.*
  into usage_row
  from public.ai_usage_ledger as usage
  join public.material_ai_operation_contexts as context
    on context.operation_id = usage.id
  where usage.id = target_operation_id
    and usage.feature in ('material_analysis', 'poll_suggestions');

  if not found or usage_row.requested_by_actor <> target_actor_id then
    raise exception 'material AI operation is not owned by this actor'
      using errcode = '42501';
  end if;
  if target_status not in ('failed', 'cancelled') then
    raise exception 'invalid material AI failure status' using errcode = '22023';
  end if;

  return private.finish_lecture_ai_operation(
    target_operation_id,
    target_status,
    actual_microusd,
    0,
    actual_input_tokens,
    actual_output_tokens,
    provider_request_id,
    error_code
  );
end;
$$;

create function public.admin_start_material_ai_operation(
  target_grant_id uuid,
  target_nonce_hash text,
  target_lecture_session_id uuid,
  target_feature text,
  target_idempotency_key text,
  target_actor_id text,
  target_document_id text,
  target_document_version text,
  target_text_sha256 text,
  target_analysis_id uuid,
  target_page_start integer,
  target_page_end integer,
  target_model_id text,
  target_prompt_version text,
  target_input_price_microusd_per_million bigint,
  target_output_price_microusd_per_million bigint,
  target_max_output_tokens integer,
  estimated_microusd bigint,
  estimated_input_tokens bigint,
  estimated_output_tokens bigint
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select private.start_material_ai_operation(
    target_grant_id,
    target_nonce_hash,
    target_lecture_session_id,
    target_feature,
    target_idempotency_key,
    target_actor_id,
    target_document_id,
    target_document_version,
    target_text_sha256,
    target_analysis_id,
    target_page_start,
    target_page_end,
    target_model_id,
    target_prompt_version,
    target_input_price_microusd_per_million,
    target_output_price_microusd_per_million,
    target_max_output_tokens,
    estimated_microusd,
    estimated_input_tokens,
    estimated_output_tokens
  );
$$;

create function public.admin_complete_material_ai_operation(
  target_operation_id uuid,
  target_actor_id text,
  target_result jsonb,
  actual_microusd bigint,
  actual_input_tokens bigint,
  actual_output_tokens bigint,
  provider_request_id text
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select private.complete_material_ai_operation(
    target_operation_id,
    target_actor_id,
    target_result,
    actual_microusd,
    actual_input_tokens,
    actual_output_tokens,
    provider_request_id
  );
$$;

create function public.admin_fail_material_ai_operation(
  target_operation_id uuid,
  target_actor_id text,
  target_status text,
  actual_microusd bigint,
  actual_input_tokens bigint,
  actual_output_tokens bigint,
  provider_request_id text,
  error_code text
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select private.fail_material_ai_operation(
    target_operation_id,
    target_actor_id,
    target_status,
    actual_microusd,
    actual_input_tokens,
    actual_output_tokens,
    provider_request_id,
    error_code
  );
$$;

create function public.admin_get_material_ai_operation_state(
  target_lecture_session_id uuid,
  target_feature text,
  target_idempotency_key text,
  target_actor_id text
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'found', true,
    'operation_id', usage.id,
    'status', usage.status,
    'result_accepted', usage.result_accepted,
    'result_saved', context.result_committed_at is not null,
    'results', case
      when context.result_committed_at is not null
        then private.material_ai_results_json(usage.lecture_session_id)
      else null
    end
  )
  from public.ai_usage_ledger as usage
  join public.material_ai_operation_contexts as context
    on context.operation_id = usage.id
  where usage.lecture_session_id = target_lecture_session_id
    and usage.feature = target_feature
    and usage.idempotency_key = target_idempotency_key
    and usage.requested_by_actor = target_actor_id;
$$;

create function public.admin_list_material_ai_results(
  target_lecture_session_id uuid
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select private.material_ai_results_json(target_lecture_session_id)
  where exists (
    select 1
    from public.lecture_sessions as lecture
    where lecture.id = target_lecture_session_id
  );
$$;

create function public.admin_adopt_poll_proposal(
  target_lecture_session_id uuid,
  target_proposal_id uuid,
  target_actor_id text,
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
  lecture_row public.lecture_sessions%rowtype;
  proposal_row public.ai_poll_proposals%rowtype;
  created_poll_id uuid;
begin
  if nullif(trim(target_actor_id), '') is null
     or char_length(target_actor_id) > 200
     or char_length(trim(coalesce(poll_question, ''))) not between 10 and 300
     or poll_type not in ('single', 'multiple')
     or cardinality(option_labels) not between 2 and 8
     or exists (
       select 1 from unnest(option_labels) as option_label
       where char_length(trim(option_label)) not between 1 and 200
     )
     or cardinality(option_labels) <> (
       select count(distinct lower(trim(option_label)))
       from unnest(option_labels) as option_label
     ) then
    raise exception 'invalid adopted Poll draft' using errcode = '22023';
  end if;

  perform private.close_lecture_if_expired(target_lecture_session_id);
  select lecture.*
  into lecture_row
  from public.lecture_sessions as lecture
  where lecture.id = target_lecture_session_id
  for update;

  if not found or not (
    lecture_row.status = 'draft' or private.is_lecture_open(lecture_row.id)
  ) then
    raise exception 'lecture is unavailable for Poll adoption' using errcode = 'P0001';
  end if;

  select proposal.*
  into proposal_row
  from public.ai_poll_proposals as proposal
  where proposal.id = target_proposal_id
    and proposal.lecture_session_id = target_lecture_session_id
  for update;

  if not found then
    raise exception 'Poll proposal not found' using errcode = 'P0002';
  end if;
  if proposal_row.status = 'adopted' then
    return proposal_row.adopted_poll_id;
  end if;
  if proposal_row.status <> 'draft' then
    raise exception 'Poll proposal cannot be adopted' using errcode = 'P0001';
  end if;

  created_poll_id := public.admin_create_poll(
    target_lecture_session_id,
    trim(poll_question),
    poll_type,
    option_labels
  );

  update public.ai_poll_proposals
  set
    status = 'adopted',
    adopted_poll_id = created_poll_id,
    reviewed_by_actor = target_actor_id,
    reviewed_at = statement_timestamp(),
    updated_at = statement_timestamp()
  where id = target_proposal_id;

  return created_poll_id;
end;
$$;

create function public.admin_reject_poll_proposal(
  target_lecture_session_id uuid,
  target_proposal_id uuid,
  target_actor_id text
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  proposal_row public.ai_poll_proposals%rowtype;
begin
  if nullif(trim(target_actor_id), '') is null
     or char_length(target_actor_id) > 200 then
    raise exception 'invalid Poll reviewer' using errcode = '22023';
  end if;

  select proposal.*
  into proposal_row
  from public.ai_poll_proposals as proposal
  where proposal.id = target_proposal_id
    and proposal.lecture_session_id = target_lecture_session_id
  for update;

  if not found then
    raise exception 'Poll proposal not found' using errcode = 'P0002';
  end if;
  if proposal_row.status = 'rejected' then
    return true;
  end if;
  if proposal_row.status <> 'draft' then
    raise exception 'Poll proposal cannot be rejected' using errcode = 'P0001';
  end if;

  update public.ai_poll_proposals
  set
    status = 'rejected',
    reviewed_by_actor = target_actor_id,
    reviewed_at = statement_timestamp(),
    updated_at = statement_timestamp()
  where id = target_proposal_id;
  return true;
end;
$$;

create function private.expire_phase5_poll_proposals_on_lecture_close()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'closed' and old.status is distinct from new.status then
    update public.ai_poll_proposals as proposal
    set
      status = 'expired',
      updated_at = statement_timestamp()
    where proposal.lecture_session_id = new.id
      and proposal.status = 'draft';
  end if;
  return new;
end;
$$;

create trigger lecture_sessions_expire_phase5_poll_proposals
after update of status on public.lecture_sessions
for each row execute function private.expire_phase5_poll_proposals_on_lecture_close();

revoke all on function private.validate_phase5_poll_proposal(jsonb, integer)
  from public, anon, authenticated, service_role;
revoke all on function private.material_ai_results_json(uuid)
  from public, anon, authenticated;
revoke all on function private.start_material_ai_operation(
  uuid, text, uuid, text, text, text, text, text, text, uuid,
  integer, integer, text, text, bigint, bigint, integer, bigint, bigint, bigint
) from public, anon, authenticated;
revoke all on function private.complete_material_ai_operation(
  uuid, text, jsonb, bigint, bigint, bigint, text
) from public, anon, authenticated;
revoke all on function private.fail_material_ai_operation(
  uuid, text, text, bigint, bigint, bigint, text, text
) from public, anon, authenticated;
revoke all on function private.expire_phase5_poll_proposals_on_lecture_close()
  from public, anon, authenticated, service_role;

revoke all on function public.admin_start_material_ai_operation(
  uuid, text, uuid, text, text, text, text, text, text, uuid,
  integer, integer, text, text, bigint, bigint, integer, bigint, bigint, bigint
) from public, anon, authenticated;
revoke all on function public.admin_complete_material_ai_operation(
  uuid, text, jsonb, bigint, bigint, bigint, text
) from public, anon, authenticated;
revoke all on function public.admin_fail_material_ai_operation(
  uuid, text, text, bigint, bigint, bigint, text, text
) from public, anon, authenticated;
revoke all on function public.admin_get_material_ai_operation_state(
  uuid, text, text, text
) from public, anon, authenticated;
revoke all on function public.admin_list_material_ai_results(uuid)
  from public, anon, authenticated;
revoke all on function public.admin_adopt_poll_proposal(
  uuid, uuid, text, text, text, text[]
) from public, anon, authenticated;
revoke all on function public.admin_reject_poll_proposal(uuid, uuid, text)
  from public, anon, authenticated;

grant execute on function private.material_ai_results_json(uuid)
  to service_role;
grant execute on function private.start_material_ai_operation(
  uuid, text, uuid, text, text, text, text, text, text, uuid,
  integer, integer, text, text, bigint, bigint, integer, bigint, bigint, bigint
) to service_role;
grant execute on function private.complete_material_ai_operation(
  uuid, text, jsonb, bigint, bigint, bigint, text
) to service_role;
grant execute on function private.fail_material_ai_operation(
  uuid, text, text, bigint, bigint, bigint, text, text
) to service_role;

grant execute on function public.admin_start_material_ai_operation(
  uuid, text, uuid, text, text, text, text, text, text, uuid,
  integer, integer, text, text, bigint, bigint, integer, bigint, bigint, bigint
) to service_role;
grant execute on function public.admin_complete_material_ai_operation(
  uuid, text, jsonb, bigint, bigint, bigint, text
) to service_role;
grant execute on function public.admin_fail_material_ai_operation(
  uuid, text, text, bigint, bigint, bigint, text, text
) to service_role;
grant execute on function public.admin_get_material_ai_operation_state(
  uuid, text, text, text
) to service_role;
grant execute on function public.admin_list_material_ai_results(uuid)
  to service_role;
grant execute on function public.admin_adopt_poll_proposal(
  uuid, uuid, text, text, text, text[]
) to service_role;
grant execute on function public.admin_reject_poll_proposal(uuid, uuid, text)
  to service_role;

comment on table public.material_ai_operation_contexts is
  'Content-free binding between an explicitly billed Phase 5 Batch operation and one immutable local PDF extraction.';
comment on table public.lecture_material_analyses is
  'Admin-only structured PDF analysis output. Extracted PDF source text is intentionally absent.';
comment on table public.ai_poll_proposals is
  'Admin-only, unverified AI Poll drafts. Adoption creates a separate ordinary draft Poll and never opens it.';
