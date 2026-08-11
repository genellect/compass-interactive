-- Phase 7.30C2: Google Admin provider authority for one summary window.
--
-- Summary run start/resume are scheduler controls only. Every external model
-- request uses a distinct C1 master child, immutable preflight/start evidence,
-- an atomic provider-dispatch claim and typed terminal settlement.

alter table private.admin_google_ai_provider_start_intents
  drop constraint admin_google_ai_provider_start_intents_feature_check;
alter table private.admin_google_ai_provider_start_intents
  add constraint admin_google_ai_provider_start_intents_feature_check check (
    feature in ('material_analysis', 'poll_suggestions', 'summaries')
  );

create function private.google_summary_source_evidence_is_valid_v1(
  target_source_hashes jsonb,
  target_source_coverage jsonb
)
returns boolean
language plpgsql
immutable
security definer
set search_path = ''
as $$
declare
  pdf_character_count bigint;
  pdf_max_page_number bigint;
  pdf_page_count bigint;
  transcript_character_count bigint;
  transcript_segment_count bigint;
begin
  if jsonb_typeof(target_source_hashes) is distinct from 'object'
     or jsonb_typeof(target_source_coverage) is distinct from 'object'
     or octet_length(target_source_hashes::text) > 4000
     or octet_length(target_source_coverage::text) > 1000 then
    return false;
  end if;
  if (
       select pg_catalog.count(*)
       from pg_catalog.jsonb_object_keys(target_source_hashes)
     ) <> 7
     or not target_source_hashes ?& array[
       'pdf_character_count', 'pdf_context_sha256', 'pdf_max_page_number',
       'pdf_page_count', 'transcript_character_count',
       'transcript_segment_count', 'transcript_sha256'
     ]::text[]
     or (
       select pg_catalog.count(*)
       from pg_catalog.jsonb_object_keys(target_source_coverage)
     ) <> 3
     or not target_source_coverage ?& array[
       'comments', 'pdf', 'transcript'
     ]::text[] then
    return false;
  end if;
  if jsonb_typeof(target_source_hashes -> 'pdf_character_count')
       is distinct from 'number'
     or jsonb_typeof(target_source_hashes -> 'pdf_max_page_number')
       is distinct from 'number'
     or jsonb_typeof(target_source_hashes -> 'pdf_page_count')
       is distinct from 'number'
     or jsonb_typeof(target_source_hashes -> 'transcript_character_count')
       is distinct from 'number'
     or jsonb_typeof(target_source_hashes -> 'transcript_segment_count')
       is distinct from 'number'
     or (target_source_hashes ->> 'pdf_character_count') !~ '^[0-9]+$'
     or (target_source_hashes ->> 'pdf_max_page_number') !~ '^[0-9]+$'
     or (target_source_hashes ->> 'pdf_page_count') !~ '^[0-9]+$'
     or (target_source_hashes ->> 'transcript_character_count') !~ '^[0-9]+$'
     or (target_source_hashes ->> 'transcript_segment_count') !~ '^[0-9]+$'
     or jsonb_typeof(target_source_coverage -> 'comments')
       is distinct from 'boolean'
     or jsonb_typeof(target_source_coverage -> 'pdf')
       is distinct from 'boolean'
     or jsonb_typeof(target_source_coverage -> 'transcript')
       is distinct from 'boolean'
     or jsonb_typeof(target_source_hashes -> 'pdf_context_sha256')
       not in ('null', 'string')
     or jsonb_typeof(target_source_hashes -> 'transcript_sha256')
       not in ('null', 'string') then
    return false;
  end if;
  if (
       jsonb_typeof(target_source_hashes -> 'pdf_context_sha256') = 'string'
       and (target_source_hashes ->> 'pdf_context_sha256') !~ '^[0-9a-f]{64}$'
     )
     or (
       jsonb_typeof(target_source_hashes -> 'transcript_sha256') = 'string'
       and (target_source_hashes ->> 'transcript_sha256') !~ '^[0-9a-f]{64}$'
     ) then
    return false;
  end if;

  pdf_character_count :=
    (target_source_hashes ->> 'pdf_character_count')::bigint;
  pdf_max_page_number :=
    (target_source_hashes ->> 'pdf_max_page_number')::bigint;
  pdf_page_count := (target_source_hashes ->> 'pdf_page_count')::bigint;
  transcript_character_count :=
    (target_source_hashes ->> 'transcript_character_count')::bigint;
  transcript_segment_count :=
    (target_source_hashes ->> 'transcript_segment_count')::bigint;

  return pdf_character_count between 0 and 1000000
    and pdf_max_page_number between 0 and 1000000
    and pdf_page_count between 0 and 10000
    and transcript_character_count between 0 and 1000000
    and transcript_segment_count between 0 and 100000
    and pdf_page_count <= pdf_max_page_number
    and (
      (pdf_page_count = 0) =
        (jsonb_typeof(target_source_hashes -> 'pdf_context_sha256') = 'null')
    )
    and (
      (transcript_segment_count = 0) =
        (jsonb_typeof(target_source_hashes -> 'transcript_sha256') = 'null')
    );
exception
  when others then
    return false;
end;
$$;

revoke all on function private.google_summary_source_evidence_is_valid_v1(
  jsonb, jsonb
) from public, anon, authenticated, service_role;

create table private.admin_google_summary_window_preflight_receipts (
  request_id uuid primary key,
  intent_digest text not null check (intent_digest ~ '^[0-9a-f]{64}$'),
  environment_id uuid not null
    references private.admin_environments(id) on delete restrict,
  principal_id uuid not null
    references private.admin_principals(id) on delete restrict,
  membership_id uuid not null
    references private.admin_environment_memberships(id) on delete restrict,
  admin_session_id uuid not null
    references public.admin_sessions(id) on delete restrict,
  supabase_auth_session_id uuid not null,
  auth_user_id uuid not null,
  lecture_session_id uuid not null
    references public.lecture_sessions(id) on delete restrict,
  run_id uuid not null
    references public.lecture_summary_runs(id) on delete restrict,
  window_id uuid not null
    references public.lecture_summary_windows(id) on delete restrict,
  expected_attempt integer not null check (expected_attempt between 0 and 2),
  prompt_version text not null check (char_length(prompt_version) between 1 and 80),
  source_hashes jsonb not null check (
    jsonb_typeof(source_hashes) = 'object'
    and octet_length(source_hashes::text) <= 4000
  ),
  source_coverage jsonb not null check (
    jsonb_typeof(source_coverage) = 'object'
    and octet_length(source_coverage::text) <= 1000
  ),
  document_id text check (
    document_id is null or char_length(document_id) between 1 and 160
  ),
  document_version text check (
    document_version is null or char_length(document_version) between 1 and 160
  ),
  provider_context_digest text not null
    check (provider_context_digest ~ '^[0-9a-f]{64}$'),
  result_status text not null check (
    result_status in ('prepared', 'skipped', 'final')
  ),
  created_at timestamptz not null default statement_timestamp(),
  check ((document_id is null) = (document_version is null)),
  check (private.google_summary_source_evidence_is_valid_v1(
    source_hashes, source_coverage
  ))
);

create index admin_google_summary_preflight_environment_idx
  on private.admin_google_summary_window_preflight_receipts (
    environment_id, created_at desc, request_id
  );
create index admin_google_summary_preflight_principal_idx
  on private.admin_google_summary_window_preflight_receipts (
    principal_id, created_at desc, request_id
  );
create index admin_google_summary_preflight_membership_idx
  on private.admin_google_summary_window_preflight_receipts (
    membership_id, created_at desc, request_id
  );
create index admin_google_summary_preflight_session_idx
  on private.admin_google_summary_window_preflight_receipts (
    admin_session_id, created_at desc, request_id
  );
create index admin_google_summary_preflight_lecture_idx
  on private.admin_google_summary_window_preflight_receipts (
    lecture_session_id, created_at desc, request_id
  );
create index admin_google_summary_preflight_run_idx
  on private.admin_google_summary_window_preflight_receipts (
    run_id, created_at desc, request_id
  );
create index admin_google_summary_preflight_window_idx
  on private.admin_google_summary_window_preflight_receipts (
    window_id, created_at desc, request_id
  );

create table private.admin_google_summary_window_start_bindings (
  start_request_id uuid primary key
    references private.admin_google_ai_provider_start_receipts(start_request_id)
      on delete restrict deferrable initially deferred,
  operation_id uuid not null unique
    references public.ai_usage_ledger(id) on delete restrict,
  preflight_request_id uuid not null
    references private.admin_google_summary_window_preflight_receipts(request_id)
      on delete restrict,
  lecture_session_id uuid not null
    references public.lecture_sessions(id) on delete restrict,
  run_id uuid not null
    references public.lecture_summary_runs(id) on delete restrict,
  window_id uuid not null
    references public.lecture_summary_windows(id) on delete restrict,
  attempt_number integer not null check (attempt_number between 1 and 2),
  preflight_context_digest text not null
    check (preflight_context_digest ~ '^[0-9a-f]{64}$'),
  provider_payload_sha256 text not null
    check (provider_payload_sha256 ~ '^[0-9a-f]{64}$'),
  resolved_language text not null check (resolved_language in ('ja', 'en')),
  language_reason text not null check (
    language_reason ~ '^(manual_(ja|en)|auto_(transcript|pdf)_(ja|en|mixed_(ja|en))|auto_default_ja)$'
  ),
  created_at timestamptz not null default statement_timestamp(),
  unique (window_id, attempt_number)
);

create index admin_google_summary_bindings_operation_idx
  on private.admin_google_summary_window_start_bindings (
    operation_id, created_at desc
  );
create index admin_google_summary_bindings_preflight_idx
  on private.admin_google_summary_window_start_bindings (
    preflight_request_id, created_at desc, start_request_id
  );
create index admin_google_summary_bindings_lecture_idx
  on private.admin_google_summary_window_start_bindings (
    lecture_session_id, created_at desc, start_request_id
  );
create index admin_google_summary_bindings_run_idx
  on private.admin_google_summary_window_start_bindings (
    run_id, created_at desc, start_request_id
  );
create index admin_google_summary_bindings_window_idx
  on private.admin_google_summary_window_start_bindings (
    window_id, attempt_number, start_request_id
  );

alter table private.admin_google_summary_window_preflight_receipts
  enable row level security;
alter table private.admin_google_summary_window_start_bindings
  enable row level security;
revoke all on private.admin_google_summary_window_preflight_receipts
  from public, anon, authenticated, service_role;
revoke all on private.admin_google_summary_window_start_bindings
  from public, anon, authenticated, service_role;

create trigger admin_google_summary_preflight_receipts_append_only
before update or delete on private.admin_google_summary_window_preflight_receipts
for each row execute function private.reject_admin_c1_evidence_mutation_v1();

create trigger admin_google_summary_start_bindings_append_only
before update or delete on private.admin_google_summary_window_start_bindings
for each row execute function private.reject_admin_c1_evidence_mutation_v1();

create function private.google_summary_preflight_intent_digest_v1(
  target_request_id uuid,
  target_admin_session_id uuid,
  target_lecture_session_id uuid,
  target_run_id uuid,
  target_run_token_hash text,
  target_window_index integer,
  target_prompt_version text,
  target_source_hashes jsonb,
  target_source_coverage jsonb,
  target_document_id text,
  target_document_version text
)
returns text
language sql
immutable
security definer
set search_path = ''
as $$
  select case
    when target_request_id is null
      or target_admin_session_id is null
      or target_lecture_session_id is null
      or target_run_id is null
      or target_run_token_hash is null
      or target_run_token_hash !~ '^[0-9a-f]{64}$'
      or target_window_index is null
      or target_window_index not between 1 and 18
      or nullif(trim(target_prompt_version), '') is null
      or char_length(target_prompt_version) > 80
      or jsonb_typeof(target_source_hashes) is distinct from 'object'
      or octet_length(target_source_hashes::text) > 4000
      or jsonb_typeof(target_source_coverage) is distinct from 'object'
      or octet_length(target_source_coverage::text) > 1000
      or not private.google_summary_source_evidence_is_valid_v1(
        target_source_hashes, target_source_coverage
      )
      or ((target_document_id is null) <> (target_document_version is null))
      then null
    else pg_catalog.encode(
      extensions.digest(
        pg_catalog.convert_to(
          'compass:phase7.30c2:google-summary-preflight:v1'
          || '|request=' || target_request_id::text
          || '|session=' || target_admin_session_id::text
          || '|lecture=' || target_lecture_session_id::text
          || '|run=' || target_run_id::text
          || '|run_token_hash=' || target_run_token_hash
          || '|window=' || target_window_index::text
          || '|prompt=' || trim(target_prompt_version)
          || '|source_hashes=' || target_source_hashes::text
          || '|source_coverage=' || target_source_coverage::text
          || '|document=' || coalesce(target_document_id, '')
          || '|document_version=' || coalesce(target_document_version, ''),
          'UTF8'
        ),
        'sha256'
      ),
      'hex'
    )
  end;
$$;

revoke all on function private.google_summary_preflight_intent_digest_v1(
  uuid, uuid, uuid, uuid, text, integer, text, jsonb, jsonb, text, text
) from public, anon, authenticated, service_role;

create function private.google_summary_provider_context_digest_v1(
  target_lecture_session_id uuid,
  target_run_id uuid,
  target_window_id uuid,
  target_expected_attempt integer,
  target_window_start timestamptz,
  target_window_end timestamptz,
  target_requested_language text,
  target_comment_context jsonb,
  target_material_context jsonb,
  target_previous_summary jsonb,
  target_source_hashes jsonb,
  target_source_coverage jsonb,
  target_document_id text,
  target_document_version text
)
returns text
language sql
immutable
security definer
set search_path = ''
as $$
  select case
    when target_lecture_session_id is null
      or target_run_id is null
      or target_window_id is null
      or target_expected_attempt is null
      or target_expected_attempt not between 1 and 2
      or target_window_start is null
      or target_window_end is null
      or target_requested_language not in ('auto', 'ja', 'en')
      or jsonb_typeof(target_comment_context) is distinct from 'object'
      or jsonb_typeof(target_source_hashes) is distinct from 'object'
      or jsonb_typeof(target_source_coverage) is distinct from 'object'
      or ((target_document_id is null) <> (target_document_version is null))
      then null
    else pg_catalog.encode(
      extensions.digest(
        pg_catalog.convert_to(
          'compass:phase7.30c2:google-summary-context:v1'
          || '|lecture=' || target_lecture_session_id::text
          || '|run=' || target_run_id::text
          || '|window=' || target_window_id::text
          || '|attempt=' || target_expected_attempt::text
          || '|window_start=' || target_window_start::text
          || '|window_end=' || target_window_end::text
          || '|requested_language=' || target_requested_language
          || '|comment=' || target_comment_context::text
          || '|material=' || coalesce(target_material_context, 'null'::jsonb)::text
          || '|previous=' || coalesce(target_previous_summary, '[]'::jsonb)::text
          || '|source_hashes=' || target_source_hashes::text
          || '|source_coverage=' || target_source_coverage::text
          || '|document=' || coalesce(target_document_id, '')
          || '|document_version=' || coalesce(target_document_version, ''),
          'UTF8'
        ),
        'sha256'
      ),
      'hex'
    )
  end;
$$;

revoke all on function private.google_summary_provider_context_digest_v1(
  uuid, uuid, uuid, integer, timestamptz, timestamptz, text, jsonb, jsonb,
  jsonb, jsonb, jsonb, text, text
) from public, anon, authenticated, service_role;

create function private.prepare_google_admin_summary_window_v1(
  target_token_hash text,
  target_auth_user_id uuid,
  target_supabase_auth_session_id uuid,
  target_google_issuer text,
  target_provider_subject_hmac text,
  target_subject_pepper_version integer,
  target_lecture_session_id uuid,
  target_run_id uuid,
  target_run_token_hash text,
  target_window_index integer,
  target_prompt_version text,
  target_source_hashes jsonb,
  target_source_coverage jsonb,
  target_document_id text,
  target_document_version text,
  target_request_id uuid,
  target_transport_enabled boolean
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
set statement_timeout = '8s'
set lock_timeout = '750ms'
as $$
declare
  context_value jsonb;
  ai_gate private.admin_ai_unlock_runtime_gate%rowtype;
  receipt_row private.admin_google_summary_window_preflight_receipts%rowtype;
  start_binding_snapshot private.admin_google_summary_window_start_bindings%rowtype;
  start_binding_row private.admin_google_summary_window_start_bindings%rowtype;
  start_intent_row private.admin_google_ai_provider_start_intents%rowtype;
  start_receipt_row private.admin_google_ai_provider_start_receipts%rowtype;
  dispatch_row private.admin_google_ai_provider_dispatch_receipts%rowtype;
  lecture_row public.lecture_sessions%rowtype;
  control_row public.lecture_ai_control%rowtype;
  run_row public.lecture_summary_runs%rowtype;
  window_row public.lecture_summary_windows%rowtype;
  usage_row public.ai_usage_ledger%rowtype;
  document_row public.lecture_pdf_documents%rowtype;
  live_row public.lecture_live_state%rowtype;
  comment_context jsonb;
  material_context jsonb;
  previous_summary jsonb;
  intent_digest_value text;
  context_digest_value text;
  actor_value text;
  expected_start timestamptz;
  expected_end timestamptz;
  expected_attempt integer;
  source_below_threshold boolean;
  recovery_result jsonb;
  unclaimed_start_recovered boolean := false;
  effective_now timestamptz := statement_timestamp();
begin
  if target_request_id is null
     or target_lecture_session_id is null
     or target_run_id is null
     or target_run_token_hash is null
     or target_run_token_hash !~ '^[0-9a-f]{64}$'
     or target_window_index is null
     or target_window_index not between 1 and 18
     or nullif(trim(target_prompt_version), '') is null
     or char_length(target_prompt_version) > 80
     or jsonb_typeof(target_source_hashes) is distinct from 'object'
     or octet_length(target_source_hashes::text) > 4000
     or jsonb_typeof(target_source_coverage) is distinct from 'object'
     or octet_length(target_source_coverage::text) > 1000
     or not private.google_summary_source_evidence_is_valid_v1(
       target_source_hashes, target_source_coverage
     )
     or ((target_document_id is null) <> (target_document_version is null))
     or target_transport_enabled is null then
    return null;
  end if;

  perform private.serialize_admin_ai_request_v1(target_request_id);
  -- Discover an already-started attempt without locks, then serialize its
  -- start request before taking identity/domain rows. This keeps claim and
  -- response-loss recovery on the same request -> context lock order.
  select receipt.*
  into receipt_row
  from private.admin_google_summary_window_preflight_receipts as receipt
  where receipt.request_id = target_request_id;
  if found then
    select binding.*
    into start_binding_snapshot
    from private.admin_google_summary_window_start_bindings as binding
    where binding.preflight_request_id = receipt_row.request_id
      and binding.window_id = receipt_row.window_id
      and binding.attempt_number = receipt_row.expected_attempt;
    if found then
      perform private.serialize_admin_ai_request_v1(
        start_binding_snapshot.start_request_id
      );
    end if;
  end if;
  context_value := private.require_google_admin_operation_context_v1(
    target_token_hash,
    target_auth_user_id,
    target_supabase_auth_session_id,
    target_google_issuer,
    target_provider_subject_hmac,
    target_subject_pepper_version,
    'generate-lecture-summary.generate',
    target_lecture_session_id
  );
  if context_value is null
     or context_value ->> 'lecture_lock_mode' <> 'update' then
    return null;
  end if;
  actor_value := 'admin-session:' || (context_value ->> 'admin_session_id');
  intent_digest_value := private.google_summary_preflight_intent_digest_v1(
    target_request_id,
    (context_value ->> 'admin_session_id')::uuid,
    target_lecture_session_id,
    target_run_id,
    target_run_token_hash,
    target_window_index,
    target_prompt_version,
    target_source_hashes,
    target_source_coverage,
    target_document_id,
    target_document_version
  );
  if intent_digest_value is null then
    return null;
  end if;

  select receipt.*
  into receipt_row
  from private.admin_google_summary_window_preflight_receipts as receipt
  where receipt.request_id = target_request_id;
  if found then
    if receipt_row.intent_digest is distinct from intent_digest_value
       or receipt_row.environment_id is distinct from
         (context_value ->> 'environment_id')::uuid
       or receipt_row.principal_id is distinct from
         (context_value ->> 'principal_id')::uuid
       or receipt_row.membership_id is distinct from
         (context_value ->> 'membership_id')::uuid
       or receipt_row.admin_session_id is distinct from
         (context_value ->> 'admin_session_id')::uuid
       or receipt_row.supabase_auth_session_id is distinct from
         target_supabase_auth_session_id
       or receipt_row.auth_user_id is distinct from target_auth_user_id
       or receipt_row.lecture_session_id is distinct from
         target_lecture_session_id
       or receipt_row.run_id is distinct from target_run_id
       or receipt_row.prompt_version is distinct from target_prompt_version
       or receipt_row.source_hashes is distinct from target_source_hashes
       or receipt_row.source_coverage is distinct from target_source_coverage
       or receipt_row.document_id is distinct from target_document_id
       or receipt_row.document_version is distinct from target_document_version then
      raise exception 'Google summary preflight binding changed on retry'
        using errcode = 'P7335';
    end if;

    select summary_window.*
    into window_row
    from public.lecture_summary_windows as summary_window
    where summary_window.id = receipt_row.window_id
      and summary_window.lecture_session_id = receipt_row.lecture_session_id
      and summary_window.run_id = receipt_row.run_id;
    if not found then
      raise exception 'Google summary preflight receipt is incomplete'
        using errcode = 'P7335';
    end if;

    if receipt_row.result_status <> 'prepared'
       or (context_value ->> 'lecture_status') is distinct from 'open'
       or (context_value ->> 'lecture_hard_stop_at')::timestamptz <= effective_now
       or window_row.status in ('succeeded', 'skipped', 'discarded')
       or (
         window_row.attempt_count >= receipt_row.expected_attempt
         and window_row.status = 'failed'
       ) then
      return jsonb_build_object(
        'accepted', true,
        'idempotentReplay', true,
        'refreshRequired', true,
        'resultStatus', receipt_row.result_status,
        'windowId', receipt_row.window_id,
        'windowStatus', window_row.status
      );
    end if;

    comment_context := private.phase6_comment_context(
      receipt_row.lecture_session_id,
      window_row.window_start,
      window_row.window_end
    );
    select jsonb_build_object(
      'outline', analysis.material_outline,
      'summary', analysis.material_summary,
      'section_boundaries', analysis.section_boundaries,
      'document_id', analysis.source_document_id,
      'document_version', analysis.source_document_version
    )
    into material_context
    from public.lecture_material_analyses as analysis
    join public.lecture_live_state as live
      on live.lecture_session_id = analysis.lecture_session_id
     and live.pdf_document_id = analysis.source_document_id
     and live.pdf_document_version = analysis.source_document_version
    where analysis.lecture_session_id = receipt_row.lecture_session_id
      and analysis.status = 'active'
    order by analysis.created_at desc
    limit 1;
    previous_summary := private.phase6_public_summaries_json(
      receipt_row.lecture_session_id,
      1
    );
    context_digest_value := private.google_summary_provider_context_digest_v1(
      receipt_row.lecture_session_id,
      receipt_row.run_id,
      receipt_row.window_id,
      receipt_row.expected_attempt,
      window_row.window_start,
      window_row.window_end,
      window_row.requested_language,
      comment_context,
      material_context,
      previous_summary,
      receipt_row.source_hashes,
      receipt_row.source_coverage,
      receipt_row.document_id,
      receipt_row.document_version
    );
    if context_digest_value is distinct from receipt_row.provider_context_digest then
      if start_binding_snapshot.start_request_id is not null then
        select binding.*
        into start_binding_row
        from private.admin_google_summary_window_start_bindings as binding
        where binding.start_request_id =
            start_binding_snapshot.start_request_id
          and binding.preflight_request_id = receipt_row.request_id
          and binding.window_id = receipt_row.window_id
          and binding.attempt_number = receipt_row.expected_attempt
        for update;
        if found then
          select intent.*
          into start_intent_row
          from private.admin_google_ai_provider_start_intents as intent
          where intent.start_request_id = start_binding_row.start_request_id
            and intent.feature = 'summaries'
            and intent.environment_id = receipt_row.environment_id
            and intent.principal_id = receipt_row.principal_id
            and intent.membership_id = receipt_row.membership_id
            and intent.admin_session_id = receipt_row.admin_session_id
            and intent.supabase_auth_session_id =
              receipt_row.supabase_auth_session_id
            and intent.lecture_session_id = receipt_row.lecture_session_id;
          if found then
            select start_receipt.*
            into start_receipt_row
            from private.admin_google_ai_provider_start_receipts
              as start_receipt
            where start_receipt.start_request_id =
                start_binding_row.start_request_id
              and start_receipt.operation_id = start_binding_row.operation_id;
            if found then
              select dispatch.*
              into dispatch_row
              from private.admin_google_ai_provider_dispatch_receipts
                as dispatch
              where dispatch.start_request_id =
                  start_binding_row.start_request_id
                and dispatch.operation_id = start_binding_row.operation_id;
              if not found then
                select usage.*
                into usage_row
                from public.ai_usage_ledger as usage
                where usage.id = start_binding_row.operation_id
                for update;
                if found
                   and usage_row.status = 'running'
                   and usage_row.accounting_settled_at is null
                   and usage_row.provider_dispatched_at is null
                   and usage_row.provider_request_id is null
                   and usage_row.lecture_session_id =
                     receipt_row.lecture_session_id
                   and usage_row.feature = 'summaries'
                   and usage_row.idempotency_key =
                     start_binding_row.start_request_id::text
                   and usage_row.requested_by_actor = actor_value then
                  recovery_result := private.fail_summary_window_operation(
                    usage_row.id,
                    start_binding_row.run_id,
                    actor_value,
                    0, 0, 0, null,
                    'summary_context_changed_before_dispatch'
                  );
                  unclaimed_start_recovered := coalesce(
                    (recovery_result ->> 'accepted')::boolean,
                    false
                  );
                end if;
              end if;
            end if;
          end if;
        end if;
      end if;
      return jsonb_build_object(
        'accepted', true,
        'idempotentReplay', true,
        'refreshRequired', true,
        'resultStatus', 'prepared',
        'unclaimedStartRecovered', unclaimed_start_recovered,
        'windowId', receipt_row.window_id,
        'windowStatus', case when unclaimed_start_recovered
          then 'failed' else window_row.status end
      );
    end if;

    return jsonb_build_object(
      'accepted', true,
      'commentContext', comment_context,
      'expectedAttempt', receipt_row.expected_attempt,
      'idempotentReplay', true,
      'materialContext', material_context,
      'preflightContextDigest', receipt_row.provider_context_digest,
      'previousSummary', previous_summary,
      'refreshRequired', false,
      'resultStatus', 'prepared',
      'window', to_jsonb(window_row) - 'current_operation_id'
    );
  end if;

  select gate.*
  into ai_gate
  from private.admin_ai_unlock_runtime_gate as gate
  where gate.singleton
  for share;
  if target_transport_enabled is distinct from true
     or (context_value ->> 'google_operational_authorization_enabled')::boolean
       is distinct from true
     or ai_gate.singleton is distinct from true
     or ai_gate.google_ai_child_grant_enabled is distinct from true then
    raise exception 'Google summary provider admission is disabled'
      using errcode = 'P7338';
  end if;

  select lecture.*
  into lecture_row
  from public.lecture_sessions as lecture
  where lecture.id = target_lecture_session_id;
  if not found
     or lecture_row.status <> 'open'
     or lecture_row.started_at is null
     or lecture_row.hard_stop_at is null
     or lecture_row.hard_stop_at <= effective_now then
    return jsonb_build_object('accepted', false, 'reason', 'lecture_not_open');
  end if;

  select control.*
  into control_row
  from public.lecture_ai_control as control
  where control.lecture_session_id = target_lecture_session_id
  for update;
  if not found
     or control_row.summaries_enabled is distinct from true
     or control_row.status not in ('ready', 'running')
     or control_row.stop_requested_at is not null then
    return jsonb_build_object('accepted', false, 'reason', 'summaries_not_active');
  end if;

  select run.*
  into run_row
  from public.lecture_summary_runs as run
  where run.id = target_run_id
    and run.lecture_session_id = target_lecture_session_id
    and run.actor_id = actor_value
    and run.token_hash = target_run_token_hash
  for update;
  if not found
     or run_row.status <> 'running'
     or run_row.expires_at <= effective_now then
    return jsonb_build_object('accepted', false, 'reason', 'summary_run_not_active');
  end if;

  expected_start := lecture_row.started_at
    + (target_window_index - 1) * interval '5 minutes';
  expected_end := expected_start + interval '5 minutes';
  if expected_end > effective_now then
    return jsonb_build_object(
      'accepted', false,
      'reason', 'window_not_due',
      'windowEnd', expected_end
    );
  end if;
  if expected_start >= lecture_row.hard_stop_at then
    return jsonb_build_object('accepted', false, 'reason', 'window_outside_lecture');
  end if;

  insert into public.lecture_summary_windows (
    lecture_session_id, run_id, window_index, window_start, window_end,
    prompt_version, source_hashes, source_coverage
  ) values (
    target_lecture_session_id, target_run_id, target_window_index,
    expected_start, expected_end, trim(target_prompt_version),
    target_source_hashes, target_source_coverage
  ) on conflict (lecture_session_id, window_index, prompt_version) do nothing;

  select summary_window.*
  into window_row
  from public.lecture_summary_windows as summary_window
  where summary_window.lecture_session_id = target_lecture_session_id
    and summary_window.window_index = target_window_index
    and summary_window.prompt_version = trim(target_prompt_version)
  for update;
  if not found or window_row.run_id is distinct from target_run_id then
    raise exception 'summary window binding is unavailable'
      using errcode = 'P7335';
  end if;

  if target_document_id is not null then
    select document.*
    into document_row
    from public.lecture_pdf_documents as document
    where document.lecture_session_id = target_lecture_session_id
      and document.document_id = target_document_id
      and document.document_version = target_document_version
      and document.visible
    for share;
    select live.*
    into live_row
    from public.lecture_live_state as live
    where live.lecture_session_id = target_lecture_session_id
    for share;
    if document_row.document_id is null
       or live_row.lecture_session_id is null
       or live_row.pdf_document_id is distinct from target_document_id
       or live_row.pdf_document_version is distinct from target_document_version
       or jsonb_typeof(target_source_hashes -> 'pdf_page_count')
         is distinct from 'number'
       or jsonb_typeof(target_source_hashes -> 'pdf_max_page_number')
         is distinct from 'number'
       or coalesce((target_source_hashes ->> 'pdf_page_count')::numeric, 0) < 1
       or coalesce(
         (target_source_hashes ->> 'pdf_max_page_number')::numeric,
         0
       ) < 1
       or (target_source_hashes ->> 'pdf_max_page_number')::numeric >
         document_row.page_count then
      raise exception 'summary PDF context is not current'
        using errcode = 'P7335';
    end if;
  elsif coalesce((target_source_hashes ->> 'pdf_page_count')::numeric, 0) <> 0
     or coalesce(
       (target_source_hashes ->> 'pdf_max_page_number')::numeric,
       0
     ) <> 0
     or target_source_hashes ->> 'pdf_context_sha256' is not null then
    raise exception 'summary PDF context has no registered document'
      using errcode = 'P7335';
  end if;

  if window_row.status in ('succeeded', 'skipped', 'discarded') then
    insert into private.admin_google_summary_window_preflight_receipts (
      request_id, intent_digest, environment_id, principal_id, membership_id,
      admin_session_id, supabase_auth_session_id, auth_user_id,
      lecture_session_id, run_id, window_id, expected_attempt, prompt_version,
      source_hashes, source_coverage, document_id, document_version,
      provider_context_digest, result_status, created_at
    ) values (
      target_request_id, intent_digest_value,
      (context_value ->> 'environment_id')::uuid,
      (context_value ->> 'principal_id')::uuid,
      (context_value ->> 'membership_id')::uuid,
      (context_value ->> 'admin_session_id')::uuid,
      target_supabase_auth_session_id, target_auth_user_id,
      target_lecture_session_id, target_run_id, window_row.id,
      window_row.attempt_count, trim(target_prompt_version),
      target_source_hashes, target_source_coverage,
      target_document_id, target_document_version, repeat('0', 64),
      'final', effective_now
    );
    return jsonb_build_object(
      'accepted', true,
      'idempotentReplay', false,
      'refreshRequired', true,
      'resultStatus', 'final',
      'windowId', window_row.id,
      'windowStatus', window_row.status
    );
  end if;
  if window_row.status = 'running' then
    return jsonb_build_object(
      'accepted', false,
      'reason', 'window_running',
      'windowId', window_row.id
    );
  end if;
  if window_row.attempt_count >= 2 then
    return jsonb_build_object('accepted', false, 'reason', 'window_attempt_limit');
  end if;

  comment_context := private.phase6_comment_context(
    target_lecture_session_id,
    expected_start,
    expected_end
  );
  source_below_threshold := (
    case
      when jsonb_typeof(target_source_hashes -> 'transcript_character_count') =
        'number' then
        (target_source_hashes ->> 'transcript_character_count')::numeric < 120
      else not coalesce(
        (target_source_coverage ->> 'transcript')::boolean,
        false
      )
    end
  ) and (
    case
      when jsonb_typeof(target_source_hashes -> 'pdf_character_count') =
        'number' then
        (target_source_hashes ->> 'pdf_character_count')::numeric < 120
      else not coalesce((target_source_coverage ->> 'pdf')::boolean, false)
    end
  );
  if source_below_threshold
     and coalesce((comment_context ->> 'comment_count')::integer, 0) < 3
     and not exists (
       select 1
       from jsonb_array_elements(comment_context -> 'comments') as item(value)
       where coalesce((item.value ->> 'like_delta')::integer, 0) >= 3
     ) then
    update public.lecture_summary_windows as summary_window
    set
      status = 'skipped',
      source_hashes = target_source_hashes,
      source_coverage = target_source_coverage,
      last_error_code = 'insufficient_source_context',
      updated_at = effective_now
    where summary_window.id = window_row.id
    returning * into window_row;
    update public.lecture_summary_runs as run
    set
      last_window_index = greatest(run.last_window_index, target_window_index),
      updated_at = effective_now
    where run.id = target_run_id;
    insert into private.admin_google_summary_window_preflight_receipts (
      request_id, intent_digest, environment_id, principal_id, membership_id,
      admin_session_id, supabase_auth_session_id, auth_user_id,
      lecture_session_id, run_id, window_id, expected_attempt, prompt_version,
      source_hashes, source_coverage, document_id, document_version,
      provider_context_digest, result_status, created_at
    ) values (
      target_request_id, intent_digest_value,
      (context_value ->> 'environment_id')::uuid,
      (context_value ->> 'principal_id')::uuid,
      (context_value ->> 'membership_id')::uuid,
      (context_value ->> 'admin_session_id')::uuid,
      target_supabase_auth_session_id, target_auth_user_id,
      target_lecture_session_id, target_run_id, window_row.id,
      window_row.attempt_count, trim(target_prompt_version),
      target_source_hashes, target_source_coverage,
      target_document_id, target_document_version, repeat('0', 64),
      'skipped', effective_now
    );
    return jsonb_build_object(
      'accepted', true,
      'idempotentReplay', false,
      'refreshRequired', true,
      'resultStatus', 'skipped',
      'skipped', true,
      'windowId', window_row.id
    );
  end if;

  select jsonb_build_object(
    'outline', analysis.material_outline,
    'summary', analysis.material_summary,
    'section_boundaries', analysis.section_boundaries,
    'document_id', analysis.source_document_id,
    'document_version', analysis.source_document_version
  )
  into material_context
  from public.lecture_material_analyses as analysis
  join public.lecture_live_state as live
    on live.lecture_session_id = analysis.lecture_session_id
   and live.pdf_document_id = analysis.source_document_id
   and live.pdf_document_version = analysis.source_document_version
  where analysis.lecture_session_id = target_lecture_session_id
    and analysis.status = 'active'
  order by analysis.created_at desc
  limit 1;
  previous_summary := private.phase6_public_summaries_json(
    target_lecture_session_id,
    1
  );
  expected_attempt := window_row.attempt_count + 1;
  context_digest_value := private.google_summary_provider_context_digest_v1(
    target_lecture_session_id,
    target_run_id,
    window_row.id,
    expected_attempt,
    window_row.window_start,
    window_row.window_end,
    window_row.requested_language,
    comment_context,
    material_context,
    previous_summary,
    target_source_hashes,
    target_source_coverage,
    target_document_id,
    target_document_version
  );
  if context_digest_value is null then
    return null;
  end if;

  insert into private.admin_google_summary_window_preflight_receipts (
    request_id, intent_digest, environment_id, principal_id, membership_id,
    admin_session_id, supabase_auth_session_id, auth_user_id,
    lecture_session_id, run_id, window_id, expected_attempt, prompt_version,
    source_hashes, source_coverage, document_id, document_version,
    provider_context_digest, result_status, created_at
  ) values (
    target_request_id, intent_digest_value,
    (context_value ->> 'environment_id')::uuid,
    (context_value ->> 'principal_id')::uuid,
    (context_value ->> 'membership_id')::uuid,
    (context_value ->> 'admin_session_id')::uuid,
    target_supabase_auth_session_id, target_auth_user_id,
    target_lecture_session_id, target_run_id, window_row.id,
    expected_attempt, trim(target_prompt_version), target_source_hashes,
    target_source_coverage, target_document_id, target_document_version,
    context_digest_value, 'prepared', effective_now
  ) returning * into receipt_row;

  return jsonb_build_object(
    'accepted', true,
    'commentContext', comment_context,
    'expectedAttempt', expected_attempt,
    'idempotentReplay', false,
    'materialContext', material_context,
    'preflightContextDigest', context_digest_value,
    'previousSummary', previous_summary,
    'refreshRequired', false,
    'resultStatus', 'prepared',
    'window', to_jsonb(window_row) - 'current_operation_id'
  );
end;
$$;

revoke all on function private.prepare_google_admin_summary_window_v1(
  text, uuid, uuid, text, text, integer, uuid, uuid, text, integer, text,
  jsonb, jsonb, text, text, uuid, boolean
) from public, anon, authenticated, service_role;

create function public.prepare_google_admin_summary_window_v1(
  target_token_hash text,
  target_auth_user_id uuid,
  target_supabase_auth_session_id uuid,
  target_google_issuer text,
  target_provider_subject_hmac text,
  target_subject_pepper_version integer,
  target_lecture_session_id uuid,
  target_run_id uuid,
  target_run_token_hash text,
  target_window_index integer,
  target_prompt_version text,
  target_source_hashes jsonb,
  target_source_coverage jsonb,
  target_document_id text,
  target_document_version text,
  target_request_id uuid,
  target_transport_enabled boolean
)
returns jsonb
language sql
volatile
security definer
set search_path = ''
as $$
  select private.prepare_google_admin_summary_window_v1(
    target_token_hash,
    target_auth_user_id,
    target_supabase_auth_session_id,
    target_google_issuer,
    target_provider_subject_hmac,
    target_subject_pepper_version,
    target_lecture_session_id,
    target_run_id,
    target_run_token_hash,
    target_window_index,
    target_prompt_version,
    target_source_hashes,
    target_source_coverage,
    target_document_id,
    target_document_version,
    target_request_id,
    target_transport_enabled
  );
$$;

revoke all on function public.prepare_google_admin_summary_window_v1(
  text, uuid, uuid, text, text, integer, uuid, uuid, text, integer, text,
  jsonb, jsonb, text, text, uuid, boolean
) from public, anon, authenticated;
grant execute on function public.prepare_google_admin_summary_window_v1(
  text, uuid, uuid, text, text, integer, uuid, uuid, text, integer, text,
  jsonb, jsonb, text, text, uuid, boolean
) to service_role;

create function private.google_summary_provider_intent_digest_v1(
  target_preflight_request_id uuid,
  target_preflight_context_digest text,
  target_lecture_session_id uuid,
  target_run_id uuid,
  target_window_id uuid,
  target_expected_attempt integer,
  target_provider_payload_sha256 text,
  target_resolved_language text,
  target_language_reason text,
  target_model_id text,
  target_prompt_version text,
  target_input_price_microusd_per_million bigint,
  target_output_price_microusd_per_million bigint,
  target_max_output_tokens integer,
  target_estimated_microusd bigint,
  target_estimated_input_tokens bigint,
  target_estimated_output_tokens bigint
)
returns text
language sql
immutable
security definer
set search_path = ''
as $$
  select case
    when target_preflight_request_id is null
      or target_preflight_context_digest is null
      or target_preflight_context_digest !~ '^[0-9a-f]{64}$'
      or target_lecture_session_id is null
      or target_run_id is null
      or target_window_id is null
      or target_expected_attempt is null
      or target_expected_attempt not between 1 and 2
      or target_provider_payload_sha256 is null
      or target_provider_payload_sha256 !~ '^[0-9a-f]{64}$'
      or target_resolved_language not in ('ja', 'en')
      or target_language_reason is null
      or target_language_reason !~ '^(manual_(ja|en)|auto_(transcript|pdf)_(ja|en|mixed_(ja|en))|auto_default_ja)$'
      or nullif(trim(target_model_id), '') is null
      or char_length(target_model_id) > 120
      or nullif(trim(target_prompt_version), '') is null
      or char_length(target_prompt_version) > 80
      or least(
        target_input_price_microusd_per_million,
        target_output_price_microusd_per_million,
        target_max_output_tokens,
        target_estimated_microusd,
        target_estimated_input_tokens,
        target_estimated_output_tokens
      ) < 0
      or target_max_output_tokens < 1
      then null
    else pg_catalog.encode(
      extensions.digest(
        pg_catalog.convert_to(
          'compass:phase7.30c2:google-summary-provider-intent:v1'
          || '|preflight_request=' || target_preflight_request_id::text
          || '|preflight_context=' || target_preflight_context_digest
          || '|lecture=' || target_lecture_session_id::text
          || '|run=' || target_run_id::text
          || '|window=' || target_window_id::text
          || '|attempt=' || target_expected_attempt::text
          || '|payload=' || target_provider_payload_sha256
          || '|language=' || target_resolved_language
          || '|language_reason=' || target_language_reason
          || '|model=' || trim(target_model_id)
          || '|prompt=' || trim(target_prompt_version)
          || '|input_price=' || target_input_price_microusd_per_million::text
          || '|output_price=' || target_output_price_microusd_per_million::text
          || '|max_output=' || target_max_output_tokens::text
          || '|estimated_cost=' || target_estimated_microusd::text
          || '|estimated_input=' || target_estimated_input_tokens::text
          || '|estimated_output=' || target_estimated_output_tokens::text,
          'UTF8'
        ),
        'sha256'
      ),
      'hex'
    )
  end;
$$;

revoke all on function private.google_summary_provider_intent_digest_v1(
  uuid, text, uuid, uuid, uuid, integer, text, text, text, text, text, bigint,
  bigint, integer, bigint, bigint, bigint
) from public, anon, authenticated, service_role;

create function private.issue_google_summary_ai_child_grant_v1(
  target_token_hash text,
  target_auth_user_id uuid,
  target_supabase_auth_session_id uuid,
  target_google_issuer text,
  target_provider_subject_hmac text,
  target_subject_pepper_version integer,
  target_lecture_session_id uuid,
  target_run_id uuid,
  target_window_id uuid,
  target_expected_attempt integer,
  target_preflight_request_id uuid,
  target_preflight_context_digest text,
  target_provider_payload_sha256 text,
  target_resolved_language text,
  target_language_reason text,
  target_model_id text,
  target_prompt_version text,
  target_input_price_microusd_per_million bigint,
  target_output_price_microusd_per_million bigint,
  target_max_output_tokens integer,
  target_estimated_microusd bigint,
  target_estimated_input_tokens bigint,
  target_estimated_output_tokens bigint,
  target_nonce_hash text,
  target_nonce_key_version integer,
  target_request_id uuid,
  target_transport_enabled boolean
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
set statement_timeout = '8s'
set lock_timeout = '750ms'
as $$
declare
  provider_digest_value text;
  child_result jsonb;
  child_receipt private.admin_google_ai_child_grant_receipts%rowtype;
  preflight_receipt private.admin_google_summary_window_preflight_receipts%rowtype;
begin
  provider_digest_value := private.google_summary_provider_intent_digest_v1(
    target_preflight_request_id,
    target_preflight_context_digest,
    target_lecture_session_id,
    target_run_id,
    target_window_id,
    target_expected_attempt,
    target_provider_payload_sha256,
    target_resolved_language,
    target_language_reason,
    target_model_id,
    target_prompt_version,
    target_input_price_microusd_per_million,
    target_output_price_microusd_per_million,
    target_max_output_tokens,
    target_estimated_microusd,
    target_estimated_input_tokens,
    target_estimated_output_tokens
  );
  if provider_digest_value is null then
    return null;
  end if;

  child_result := private.issue_google_ai_child_grant_v1(
    target_token_hash,
    target_auth_user_id,
    target_supabase_auth_session_id,
    target_google_issuer,
    target_provider_subject_hmac,
    target_subject_pepper_version,
    target_lecture_session_id,
    'summaries',
    provider_digest_value,
    target_nonce_hash,
    target_nonce_key_version,
    target_request_id,
    target_transport_enabled
  );
  if child_result is null
     or coalesce((child_result ->> 'accepted')::boolean, false) is not true then
    return child_result;
  end if;

  select receipt.*
  into child_receipt
  from private.admin_google_ai_child_grant_receipts as receipt
  where receipt.request_id = target_request_id;
  select receipt.*
  into preflight_receipt
  from private.admin_google_summary_window_preflight_receipts as receipt
  where receipt.request_id = target_preflight_request_id;
  if child_receipt.request_id is null
     or preflight_receipt.request_id is null
     or preflight_receipt.result_status <> 'prepared'
     or preflight_receipt.environment_id is distinct from
       child_receipt.environment_id
     or preflight_receipt.principal_id is distinct from child_receipt.principal_id
     or preflight_receipt.membership_id is distinct from
       child_receipt.membership_id
     or preflight_receipt.admin_session_id is distinct from
       child_receipt.admin_session_id
     or preflight_receipt.supabase_auth_session_id is distinct from
       child_receipt.supabase_auth_session_id
     or preflight_receipt.auth_user_id is distinct from child_receipt.auth_user_id
     or preflight_receipt.lecture_session_id is distinct from
       target_lecture_session_id
     or preflight_receipt.run_id is distinct from target_run_id
     or preflight_receipt.window_id is distinct from target_window_id
     or preflight_receipt.expected_attempt is distinct from
       target_expected_attempt
     or preflight_receipt.provider_context_digest is distinct from
       target_preflight_context_digest
     or preflight_receipt.prompt_version is distinct from target_prompt_version
     or child_receipt.feature <> 'summaries'
     or child_receipt.provider_intent_digest is distinct from
       provider_digest_value then
    raise exception 'Google summary child is not bound to its preflight'
      using errcode = 'P7335';
  end if;

  return child_result || jsonb_build_object(
    'preflightRequestId', target_preflight_request_id,
    'providerIntentDigest', provider_digest_value,
    'windowId', target_window_id
  );
end;
$$;

revoke all on function private.issue_google_summary_ai_child_grant_v1(
  text, uuid, uuid, text, text, integer, uuid, uuid, uuid, integer, uuid, text,
  text, text, text, text, text, bigint, bigint, integer, bigint, bigint, bigint,
  text, integer, uuid, boolean
) from public, anon, authenticated, service_role;

create function public.issue_google_summary_ai_child_grant_v1(
  target_token_hash text,
  target_auth_user_id uuid,
  target_supabase_auth_session_id uuid,
  target_google_issuer text,
  target_provider_subject_hmac text,
  target_subject_pepper_version integer,
  target_lecture_session_id uuid,
  target_run_id uuid,
  target_window_id uuid,
  target_expected_attempt integer,
  target_preflight_request_id uuid,
  target_preflight_context_digest text,
  target_provider_payload_sha256 text,
  target_resolved_language text,
  target_language_reason text,
  target_model_id text,
  target_prompt_version text,
  target_input_price_microusd_per_million bigint,
  target_output_price_microusd_per_million bigint,
  target_max_output_tokens integer,
  target_estimated_microusd bigint,
  target_estimated_input_tokens bigint,
  target_estimated_output_tokens bigint,
  target_nonce_hash text,
  target_nonce_key_version integer,
  target_request_id uuid,
  target_transport_enabled boolean
)
returns jsonb
language sql
volatile
security definer
set search_path = ''
as $$
  select private.issue_google_summary_ai_child_grant_v1(
    target_token_hash,
    target_auth_user_id,
    target_supabase_auth_session_id,
    target_google_issuer,
    target_provider_subject_hmac,
    target_subject_pepper_version,
    target_lecture_session_id,
    target_run_id,
    target_window_id,
    target_expected_attempt,
    target_preflight_request_id,
    target_preflight_context_digest,
    target_provider_payload_sha256,
    target_resolved_language,
    target_language_reason,
    target_model_id,
    target_prompt_version,
    target_input_price_microusd_per_million,
    target_output_price_microusd_per_million,
    target_max_output_tokens,
    target_estimated_microusd,
    target_estimated_input_tokens,
    target_estimated_output_tokens,
    target_nonce_hash,
    target_nonce_key_version,
    target_request_id,
    target_transport_enabled
  );
$$;

revoke all on function public.issue_google_summary_ai_child_grant_v1(
  text, uuid, uuid, text, text, integer, uuid, uuid, uuid, integer, uuid, text,
  text, text, text, text, text, bigint, bigint, integer, bigint, bigint, bigint,
  text, integer, uuid, boolean
) from public, anon, authenticated;
grant execute on function public.issue_google_summary_ai_child_grant_v1(
  text, uuid, uuid, text, text, integer, uuid, uuid, uuid, integer, uuid, text,
  text, text, text, text, text, bigint, bigint, integer, bigint, bigint, bigint,
  text, integer, uuid, boolean
) to service_role;

create function private.start_google_admin_summary_window_operation_v1(
  target_token_hash text,
  target_auth_user_id uuid,
  target_supabase_auth_session_id uuid,
  target_google_issuer text,
  target_provider_subject_hmac text,
  target_subject_pepper_version integer,
  target_grant_id uuid,
  target_nonce_hash text,
  target_lecture_session_id uuid,
  target_run_id uuid,
  target_run_token_hash text,
  target_window_id uuid,
  target_expected_attempt integer,
  target_preflight_request_id uuid,
  target_preflight_context_digest text,
  target_provider_payload_sha256 text,
  target_resolved_language text,
  target_language_reason text,
  target_model_id text,
  target_prompt_version text,
  target_input_price_microusd_per_million bigint,
  target_output_price_microusd_per_million bigint,
  target_max_output_tokens integer,
  target_estimated_microusd bigint,
  target_estimated_input_tokens bigint,
  target_estimated_output_tokens bigint,
  target_start_request_id uuid,
  target_provider_intent_digest text,
  target_transport_enabled boolean
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
set statement_timeout = '8s'
set lock_timeout = '750ms'
as $$
declare
  grant_row public.ai_billing_grants%rowtype;
  child_receipt private.admin_google_ai_child_grant_receipts%rowtype;
  preflight_receipt private.admin_google_summary_window_preflight_receipts%rowtype;
  start_intent private.admin_google_ai_provider_start_intents%rowtype;
  start_receipt private.admin_google_ai_provider_start_receipts%rowtype;
  binding_row private.admin_google_summary_window_start_bindings%rowtype;
  context_value jsonb;
  identity_gate private.admin_identity_runtime_gate%rowtype;
  ai_gate private.admin_ai_unlock_runtime_gate%rowtype;
  ownership_row private.admin_lecture_ownerships%rowtype;
  policy_row private.admin_ai_policies%rowtype;
  lecture_row public.lecture_sessions%rowtype;
  master_row public.lecture_ai_master_authorizations%rowtype;
  control_row public.lecture_ai_control%rowtype;
  run_row public.lecture_summary_runs%rowtype;
  window_row public.lecture_summary_windows%rowtype;
  document_row public.lecture_pdf_documents%rowtype;
  live_row public.lecture_live_state%rowtype;
  usage_row public.ai_usage_ledger%rowtype;
  result_value jsonb;
  provider_digest_value text;
  start_digest_value text;
  operation_id_value uuid;
  actor_value text;
  minimum_reservation bigint;
  lecture_calls bigint;
  daily_calls bigint;
  lecture_input_tokens bigint;
  daily_input_tokens bigint;
  lecture_output_tokens bigint;
  daily_output_tokens bigint;
  lecture_cost bigint;
  daily_cost bigint;
  policy_running bigint;
  effective_now timestamptz := statement_timestamp();
  utc_day_start timestamptz := date_trunc(
    'day', statement_timestamp() at time zone 'UTC'
  ) at time zone 'UTC';
begin
  provider_digest_value := private.google_summary_provider_intent_digest_v1(
    target_preflight_request_id,
    target_preflight_context_digest,
    target_lecture_session_id,
    target_run_id,
    target_window_id,
    target_expected_attempt,
    target_provider_payload_sha256,
    target_resolved_language,
    target_language_reason,
    target_model_id,
    target_prompt_version,
    target_input_price_microusd_per_million,
    target_output_price_microusd_per_million,
    target_max_output_tokens,
    target_estimated_microusd,
    target_estimated_input_tokens,
    target_estimated_output_tokens
  );
  if target_start_request_id is null
     or target_grant_id is null
     or target_nonce_hash is null
     or target_nonce_hash !~ '^[0-9a-f]{64}$'
     or target_run_token_hash is null
     or target_run_token_hash !~ '^[0-9a-f]{64}$'
     or provider_digest_value is null
     or target_provider_intent_digest is distinct from provider_digest_value
     or target_transport_enabled is null then
    return null;
  end if;

  minimum_reservation := ceil(
    target_estimated_input_tokens::numeric
      * target_input_price_microusd_per_million::numeric / 1000000
    + target_estimated_output_tokens::numeric
      * target_output_price_microusd_per_million::numeric / 1000000
  )::bigint;
  if target_estimated_microusd < minimum_reservation then
    raise exception 'Google summary reservation is too small'
      using errcode = '22023';
  end if;

  perform private.serialize_admin_ai_request_v1(target_start_request_id);
  -- Legacy provider consumers take the grant before the lecture. Preserve that
  -- order throughout the dual-transport interval.
  select grant_record.*
  into grant_row
  from public.ai_billing_grants as grant_record
  where grant_record.id = target_grant_id
  for update;
  if not found then
    return null;
  end if;

  context_value := private.require_google_ai_provider_context_v1(
    target_token_hash,
    target_auth_user_id,
    target_supabase_auth_session_id,
    target_google_issuer,
    target_provider_subject_hmac,
    target_subject_pepper_version
  );
  if context_value is null then
    return null;
  end if;
  actor_value := 'admin-session:' || (context_value ->> 'admin_session_id');
  start_digest_value := pg_catalog.encode(
    extensions.digest(
      pg_catalog.convert_to(
        'compass:phase7.30c2:google-summary-provider-start:v1'
        || '|request=' || target_start_request_id::text
        || '|session=' || (context_value ->> 'admin_session_id')
        || '|grant=' || target_grant_id::text
        || '|provider_intent=' || target_provider_intent_digest,
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );

  select receipt.*
  into child_receipt
  from private.admin_google_ai_child_grant_receipts as receipt
  where receipt.grant_id = target_grant_id;
  if not found
     or child_receipt.environment_id is distinct from
       (context_value ->> 'environment_id')::uuid
     or child_receipt.principal_id is distinct from
       (context_value ->> 'principal_id')::uuid
     or child_receipt.membership_id is distinct from
       (context_value ->> 'membership_id')::uuid
     or child_receipt.admin_session_id is distinct from
       (context_value ->> 'admin_session_id')::uuid
     or child_receipt.supabase_auth_session_id is distinct from
       target_supabase_auth_session_id
     or child_receipt.auth_user_id is distinct from target_auth_user_id
     or child_receipt.lecture_session_id is distinct from
       target_lecture_session_id
     or child_receipt.feature <> 'summaries'
     or child_receipt.provider_intent_digest is distinct from
       target_provider_intent_digest
     or child_receipt.nonce_hash is distinct from target_nonce_hash then
    raise exception 'Google summary child evidence is unavailable'
      using errcode = 'P7335';
  end if;

  select receipt.*
  into preflight_receipt
  from private.admin_google_summary_window_preflight_receipts as receipt
  where receipt.request_id = target_preflight_request_id;
  if not found
     or preflight_receipt.result_status <> 'prepared'
     or preflight_receipt.environment_id is distinct from child_receipt.environment_id
     or preflight_receipt.principal_id is distinct from child_receipt.principal_id
     or preflight_receipt.membership_id is distinct from child_receipt.membership_id
     or preflight_receipt.admin_session_id is distinct from child_receipt.admin_session_id
     or preflight_receipt.supabase_auth_session_id is distinct from
       child_receipt.supabase_auth_session_id
     or preflight_receipt.auth_user_id is distinct from child_receipt.auth_user_id
     or preflight_receipt.lecture_session_id is distinct from
       target_lecture_session_id
     or preflight_receipt.run_id is distinct from target_run_id
     or preflight_receipt.window_id is distinct from target_window_id
     or preflight_receipt.expected_attempt is distinct from target_expected_attempt
     or preflight_receipt.provider_context_digest is distinct from
       target_preflight_context_digest
     or preflight_receipt.prompt_version is distinct from target_prompt_version then
    raise exception 'Google summary preflight evidence is unavailable'
      using errcode = 'P7335';
  end if;

  select receipt.*
  into start_receipt
  from private.admin_google_ai_provider_start_receipts as receipt
  where receipt.start_request_id = target_start_request_id;
  if found then
    select intent.*
    into start_intent
    from private.admin_google_ai_provider_start_intents as intent
    where intent.start_request_id = target_start_request_id;
    select binding.*
    into binding_row
    from private.admin_google_summary_window_start_bindings as binding
    where binding.start_request_id = target_start_request_id;
    select usage.*
    into usage_row
    from public.ai_usage_ledger as usage
    where usage.id = start_receipt.operation_id;
    if start_intent.start_request_id is null
       or binding_row.start_request_id is null
       or usage_row.id is null
       or start_intent.child_grant_id is distinct from target_grant_id
       or start_intent.environment_id is distinct from child_receipt.environment_id
       or start_intent.principal_id is distinct from child_receipt.principal_id
       or start_intent.membership_id is distinct from child_receipt.membership_id
       or start_intent.admin_session_id is distinct from child_receipt.admin_session_id
       or start_intent.supabase_auth_session_id is distinct from
         child_receipt.supabase_auth_session_id
       or start_intent.lecture_session_id is distinct from target_lecture_session_id
       or start_intent.feature <> 'summaries'
       or start_intent.model_id is distinct from target_model_id
       or start_intent.provider_intent_digest is distinct from provider_digest_value
       or start_intent.start_intent_digest is distinct from start_digest_value
       or start_receipt.child_grant_id is distinct from target_grant_id
       or binding_row.operation_id is distinct from start_receipt.operation_id
       or binding_row.preflight_request_id is distinct from
         target_preflight_request_id
       or binding_row.lecture_session_id is distinct from target_lecture_session_id
       or binding_row.run_id is distinct from target_run_id
       or binding_row.window_id is distinct from target_window_id
       or binding_row.attempt_number is distinct from target_expected_attempt
       or binding_row.preflight_context_digest is distinct from
         target_preflight_context_digest
       or binding_row.provider_payload_sha256 is distinct from
         target_provider_payload_sha256
       or binding_row.resolved_language is distinct from target_resolved_language
       or binding_row.language_reason is distinct from target_language_reason
       or grant_row.status <> 'consumed'
       or grant_row.operation_ids is distinct from
         array[start_receipt.operation_id]::uuid[]
       or grant_row.nonce_hash is distinct from target_nonce_hash
       or usage_row.lecture_session_id is distinct from target_lecture_session_id
       or usage_row.feature <> 'summaries'
       or usage_row.idempotency_key is distinct from target_start_request_id::text
       or usage_row.requested_by_actor is distinct from actor_value then
      raise exception 'Google summary start binding changed on retry'
        using errcode = 'P7335';
    end if;
    return jsonb_build_object(
      'accepted', true,
      'actorId', actor_value,
      'idempotentReplay', true,
      'operationId', start_receipt.operation_id,
      'status', usage_row.status,
      'windowId', binding_row.window_id
    );
  end if;

  select gate.*
  into identity_gate
  from private.admin_identity_runtime_gate as gate
  where gate.singleton
  for share;
  select gate.*
  into ai_gate
  from private.admin_ai_unlock_runtime_gate as gate
  where gate.singleton
  for share;
  if identity_gate.singleton is distinct from true
     or ai_gate.singleton is distinct from true
     or target_transport_enabled is distinct from true
     or identity_gate.google_operational_authorization_enabled is distinct from true
     or ai_gate.google_ai_child_grant_enabled is distinct from true then
    raise exception 'Google summary provider start is disabled'
      using errcode = 'P7338';
  end if;

  select ownership.*
  into ownership_row
  from private.admin_lecture_ownerships as ownership
  where ownership.lecture_session_id = target_lecture_session_id;
  if not found
     or ownership_row.environment_id is distinct from
       (context_value ->> 'environment_id')::uuid
     or ownership_row.principal_id is distinct from
       (context_value ->> 'principal_id')::uuid
     or ownership_row.membership_id is distinct from
       (context_value ->> 'membership_id')::uuid then
    raise exception 'lecture ownership is unavailable' using errcode = 'P7335';
  end if;

  perform private.serialize_admin_ai_scope_v1(
    'policy-membership',
    (context_value ->> 'membership_id')::uuid
  );
  select policy.*
  into policy_row
  from private.admin_ai_policies as policy
  where policy.id = child_receipt.policy_id
    and policy.version = child_receipt.policy_version
    and policy.environment_id = (context_value ->> 'environment_id')::uuid
    and policy.membership_id = (context_value ->> 'membership_id')::uuid
  for update;
  if not found
     or policy_row.status <> 'active'
     or policy_row.valid_from > effective_now
     or policy_row.valid_until <= effective_now
     or not array['summaries']::text[] <@ policy_row.allowed_actions
     or not array[target_model_id]::text[] <@ policy_row.allowed_models then
    raise exception 'AI policy is unavailable' using errcode = 'P7335';
  end if;

  select lecture.*
  into lecture_row
  from public.lecture_sessions as lecture
  where lecture.id = target_lecture_session_id
  for update;
  if not found
     or lecture_row.status <> 'open'
     or lecture_row.hard_stop_at is null
     or lecture_row.hard_stop_at <= effective_now then
    raise exception 'lecture is not open' using errcode = 'P7335';
  end if;

  select master.*
  into master_row
  from public.lecture_ai_master_authorizations as master
  where master.id = child_receipt.master_authorization_id
    and master.lecture_session_id = target_lecture_session_id
  for update;
  if not found
     or master_row.status <> 'active'
     or master_row.expires_at <= effective_now
     or master_row.principal_id is distinct from child_receipt.principal_id
     or master_row.membership_id is distinct from child_receipt.membership_id
     or master_row.issuing_admin_session_id is distinct from
       child_receipt.admin_session_id
     or master_row.actor_id is distinct from actor_value
     or master_row.ai_policy_id is distinct from policy_row.id
     or master_row.ai_policy_version is distinct from policy_row.version
     or not array['summaries']::text[] <@ master_row.actions then
    raise exception 'Google AI master is unavailable' using errcode = 'P7335';
  end if;

  if grant_row.lecture_session_id is distinct from target_lecture_session_id
     or grant_row.master_authorization_id is distinct from master_row.id
     or grant_row.status <> 'issued'
     or grant_row.expires_at <= effective_now
     or grant_row.actor_id is distinct from actor_value
     or grant_row.actions is distinct from array['summaries']::text[]
     or grant_row.nonce_hash is distinct from target_nonce_hash then
    raise exception 'Google summary child is unavailable' using errcode = 'P7335';
  end if;

  select control.*
  into control_row
  from public.lecture_ai_control as control
  where control.lecture_session_id = target_lecture_session_id
  for update;
  if not found
     or control_row.summaries_enabled is distinct from true
     or control_row.status not in ('ready', 'running')
     or control_row.stop_requested_at is not null then
    raise exception 'summary scheduler is not active' using errcode = 'P7335';
  end if;

  select run.*
  into run_row
  from public.lecture_summary_runs as run
  where run.id = target_run_id
    and run.lecture_session_id = target_lecture_session_id
    and run.actor_id = actor_value
    and run.token_hash = target_run_token_hash
  for update;
  if not found
     or run_row.status <> 'running'
     or run_row.expires_at <= effective_now then
    raise exception 'summary run is not active' using errcode = 'P7335';
  end if;

  select summary_window.*
  into window_row
  from public.lecture_summary_windows as summary_window
  where summary_window.id = target_window_id
    and summary_window.lecture_session_id = target_lecture_session_id
    and summary_window.run_id = target_run_id
    and summary_window.prompt_version = target_prompt_version
  for update;
  if not found
     or window_row.status not in ('pending', 'failed')
     or window_row.current_operation_id is not null
     or window_row.attempt_count + 1 is distinct from target_expected_attempt
     or window_row.window_end > effective_now
     or window_row.window_start >= lecture_row.hard_stop_at then
    raise exception 'summary window is not startable' using errcode = 'P7335';
  end if;
  if window_row.requested_language in ('ja', 'en')
     and window_row.requested_language is distinct from target_resolved_language then
    raise exception 'manual summary language mismatch' using errcode = '22023';
  end if;
  if window_row.requested_language = 'auto'
     and target_language_reason like 'manual_%' then
    raise exception 'automatic summary language reason mismatch'
      using errcode = '22023';
  end if;
  if window_row.requested_language in ('ja', 'en')
     and target_language_reason is distinct from
       ('manual_' || window_row.requested_language) then
    raise exception 'manual summary language reason mismatch'
      using errcode = '22023';
  end if;

  if preflight_receipt.document_id is not null then
    select document.*
    into document_row
    from public.lecture_pdf_documents as document
    where document.lecture_session_id = target_lecture_session_id
      and document.document_id = preflight_receipt.document_id
      and document.document_version = preflight_receipt.document_version
      and document.visible
    for share;
    select live.*
    into live_row
    from public.lecture_live_state as live
    where live.lecture_session_id = target_lecture_session_id
    for share;
    if document_row.document_id is null
       or live_row.lecture_session_id is null
       or live_row.pdf_document_id is distinct from preflight_receipt.document_id
       or live_row.pdf_document_version is distinct from
         preflight_receipt.document_version
       or jsonb_typeof(preflight_receipt.source_hashes -> 'pdf_page_count')
         is distinct from 'number'
       or jsonb_typeof(
         preflight_receipt.source_hashes -> 'pdf_max_page_number'
       ) is distinct from 'number'
       or coalesce(
         (preflight_receipt.source_hashes ->> 'pdf_page_count')::numeric,
         0
       ) < 1
       or coalesce(
         (preflight_receipt.source_hashes ->> 'pdf_max_page_number')::numeric,
         0
       ) < 1
       or (preflight_receipt.source_hashes ->> 'pdf_max_page_number')::numeric >
         document_row.page_count then
      raise exception 'summary PDF context changed before provider start'
        using errcode = 'P7335';
    end if;
  elsif coalesce(
    (preflight_receipt.source_hashes ->> 'pdf_page_count')::numeric,
    0
  ) <> 0
     or coalesce(
       (preflight_receipt.source_hashes ->> 'pdf_max_page_number')::numeric,
       0
     ) <> 0
     or preflight_receipt.source_hashes ->> 'pdf_context_sha256' is not null then
    raise exception 'summary PDF context has no registered document'
      using errcode = 'P7335';
  end if;

  select
    count(*) filter (where intent.lecture_session_id = target_lecture_session_id),
    count(*) filter (where intent.created_at >= utc_day_start),
    coalesce(sum(usage.reserved_input_tokens) filter (
      where intent.lecture_session_id = target_lecture_session_id
    ), 0),
    coalesce(sum(usage.reserved_input_tokens) filter (
      where intent.created_at >= utc_day_start
    ), 0),
    coalesce(sum(usage.reserved_output_tokens) filter (
      where intent.lecture_session_id = target_lecture_session_id
    ), 0),
    coalesce(sum(usage.reserved_output_tokens) filter (
      where intent.created_at >= utc_day_start
    ), 0),
    coalesce(sum(usage.reserved_microusd) filter (
      where intent.lecture_session_id = target_lecture_session_id
    ), 0),
    coalesce(sum(usage.reserved_microusd) filter (
      where intent.created_at >= utc_day_start
    ), 0),
    count(*) filter (where usage.status = 'running')
  into
    lecture_calls, daily_calls,
    lecture_input_tokens, daily_input_tokens,
    lecture_output_tokens, daily_output_tokens,
    lecture_cost, daily_cost, policy_running
  from private.admin_google_ai_provider_start_intents as intent
  join private.admin_google_ai_provider_start_receipts as receipt
    on receipt.start_request_id = intent.start_request_id
  join public.ai_usage_ledger as usage
    on usage.id = receipt.operation_id
  where intent.policy_id = policy_row.id
    and intent.policy_version = policy_row.version;

  if lecture_calls + 1 > policy_row.max_calls_per_lecture
     or daily_calls + 1 > policy_row.max_calls_per_day
     or lecture_input_tokens + target_estimated_input_tokens >
       policy_row.max_input_tokens_per_lecture
     or daily_input_tokens + target_estimated_input_tokens >
       policy_row.max_input_tokens_per_day
     or lecture_output_tokens + target_estimated_output_tokens >
       policy_row.max_output_tokens_per_lecture
     or daily_output_tokens + target_estimated_output_tokens >
       policy_row.max_output_tokens_per_day
     or lecture_cost + target_estimated_microusd >
       policy_row.max_cost_microusd_per_lecture
     or daily_cost + target_estimated_microusd >
       policy_row.max_cost_microusd_per_day
     or policy_running + 1 > policy_row.max_concurrency then
    raise exception 'AI policy usage limit is unavailable'
      using errcode = 'P7335';
  end if;

  insert into private.admin_google_ai_provider_start_intents (
    start_request_id, child_grant_id, environment_id, principal_id,
    membership_id, admin_session_id, supabase_auth_session_id,
    lecture_session_id, master_authorization_id, policy_id, policy_version,
    feature, model_id, provider_family, provider_intent_digest,
    start_intent_digest, created_at
  ) values (
    target_start_request_id, target_grant_id,
    (context_value ->> 'environment_id')::uuid,
    (context_value ->> 'principal_id')::uuid,
    (context_value ->> 'membership_id')::uuid,
    (context_value ->> 'admin_session_id')::uuid,
    target_supabase_auth_session_id, target_lecture_session_id,
    master_row.id, policy_row.id, policy_row.version, 'summaries',
    target_model_id, 'openai_responses_v1', target_provider_intent_digest,
    start_digest_value, effective_now
  ) returning * into start_intent;

  result_value := private.start_lecture_ai_operation(
    target_lecture_session_id,
    'summaries',
    target_start_request_id::text,
    target_estimated_microusd,
    0,
    target_estimated_input_tokens,
    target_estimated_output_tokens,
    actor_value
  );
  if coalesce((result_value ->> 'accepted')::boolean, false) is not true then
    raise exception 'Google summary provider start was rejected: %',
      coalesce(result_value ->> 'reason', 'unknown')
      using errcode = 'P7335';
  end if;
  if (result_value ->> 'idempotent_replay')::boolean is distinct from false then
    raise exception 'Google summary provider start collided with existing usage'
      using errcode = 'P7335';
  end if;
  operation_id_value := (result_value #>> '{operation,id}')::uuid;

  select usage.*
  into usage_row
  from public.ai_usage_ledger as usage
  where usage.id = operation_id_value
  for update;
  if not found
     or usage_row.lecture_session_id is distinct from target_lecture_session_id
     or usage_row.feature <> 'summaries'
     or usage_row.idempotency_key is distinct from target_start_request_id::text
     or usage_row.requested_by_actor is distinct from actor_value
     or usage_row.status <> 'running'
     or usage_row.reserved_microusd is distinct from target_estimated_microusd
     or usage_row.reserved_audio_seconds is distinct from 0
     or usage_row.reserved_input_tokens is distinct from
       target_estimated_input_tokens
     or usage_row.reserved_output_tokens is distinct from
       target_estimated_output_tokens then
    raise exception 'Google summary provider start has no operation receipt'
      using errcode = 'P7335';
  end if;

  update public.ai_usage_ledger as usage
  set
    model_id = target_model_id,
    pricing_unit = 'token',
    pricing_rate_microusd = ceil(
      target_output_price_microusd_per_million::numeric / 1000000
    )::bigint,
    last_heartbeat_at = effective_now
  where usage.id = operation_id_value;

  update public.lecture_summary_windows as summary_window
  set
    status = 'running',
    attempt_count = target_expected_attempt,
    current_operation_id = operation_id_value,
    source_hashes = preflight_receipt.source_hashes,
    source_coverage = preflight_receipt.source_coverage,
    resolved_language = target_resolved_language,
    language_reason = target_language_reason,
    language_recorded_at = effective_now,
    last_error_code = null,
    updated_at = effective_now
  where summary_window.id = target_window_id
  returning * into window_row;

  insert into private.admin_google_summary_window_start_bindings (
    start_request_id, operation_id, preflight_request_id,
    lecture_session_id, run_id, window_id, attempt_number,
    preflight_context_digest, provider_payload_sha256,
    resolved_language, language_reason, created_at
  ) values (
    target_start_request_id, operation_id_value, target_preflight_request_id,
    target_lecture_session_id, target_run_id, target_window_id,
    target_expected_attempt, target_preflight_context_digest,
    target_provider_payload_sha256, target_resolved_language,
    target_language_reason, effective_now
  ) returning * into binding_row;

  update public.ai_billing_grants as grant_record
  set
    status = 'consumed',
    consumed_at = effective_now,
    operation_ids = array[operation_id_value]::uuid[]
  where grant_record.id = target_grant_id
    and grant_record.status = 'issued'
  returning * into grant_row;
  if not found then
    raise exception 'Google summary child could not be consumed'
      using errcode = 'P7335';
  end if;

  insert into private.admin_google_ai_provider_start_receipts (
    start_request_id, child_grant_id, operation_id, result_status, started_at
  ) values (
    target_start_request_id, target_grant_id, operation_id_value,
    'started', effective_now
  ) returning * into start_receipt;

  return jsonb_build_object(
    'accepted', true,
    'actorId', actor_value,
    'idempotentReplay', false,
    'operationId', operation_id_value,
    'status', 'running',
    'windowId', target_window_id
  );
end;
$$;

revoke all on function private.start_google_admin_summary_window_operation_v1(
  text, uuid, uuid, text, text, integer, uuid, text, uuid, uuid, text, uuid,
  integer, uuid, text, text, text, text, text, text, bigint, bigint, integer,
  bigint, bigint, bigint, uuid, text, boolean
) from public, anon, authenticated, service_role;

create function public.start_google_admin_summary_window_operation_v1(
  target_token_hash text,
  target_auth_user_id uuid,
  target_supabase_auth_session_id uuid,
  target_google_issuer text,
  target_provider_subject_hmac text,
  target_subject_pepper_version integer,
  target_grant_id uuid,
  target_nonce_hash text,
  target_lecture_session_id uuid,
  target_run_id uuid,
  target_run_token_hash text,
  target_window_id uuid,
  target_expected_attempt integer,
  target_preflight_request_id uuid,
  target_preflight_context_digest text,
  target_provider_payload_sha256 text,
  target_resolved_language text,
  target_language_reason text,
  target_model_id text,
  target_prompt_version text,
  target_input_price_microusd_per_million bigint,
  target_output_price_microusd_per_million bigint,
  target_max_output_tokens integer,
  target_estimated_microusd bigint,
  target_estimated_input_tokens bigint,
  target_estimated_output_tokens bigint,
  target_start_request_id uuid,
  target_provider_intent_digest text,
  target_transport_enabled boolean
)
returns jsonb
language sql
volatile
security definer
set search_path = ''
as $$
  select private.start_google_admin_summary_window_operation_v1(
    target_token_hash,
    target_auth_user_id,
    target_supabase_auth_session_id,
    target_google_issuer,
    target_provider_subject_hmac,
    target_subject_pepper_version,
    target_grant_id,
    target_nonce_hash,
    target_lecture_session_id,
    target_run_id,
    target_run_token_hash,
    target_window_id,
    target_expected_attempt,
    target_preflight_request_id,
    target_preflight_context_digest,
    target_provider_payload_sha256,
    target_resolved_language,
    target_language_reason,
    target_model_id,
    target_prompt_version,
    target_input_price_microusd_per_million,
    target_output_price_microusd_per_million,
    target_max_output_tokens,
    target_estimated_microusd,
    target_estimated_input_tokens,
    target_estimated_output_tokens,
    target_start_request_id,
    target_provider_intent_digest,
    target_transport_enabled
  );
$$;

revoke all on function public.start_google_admin_summary_window_operation_v1(
  text, uuid, uuid, text, text, integer, uuid, text, uuid, uuid, text, uuid,
  integer, uuid, text, text, text, text, text, text, bigint, bigint, integer,
  bigint, bigint, bigint, uuid, text, boolean
) from public, anon, authenticated;
grant execute on function public.start_google_admin_summary_window_operation_v1(
  text, uuid, uuid, text, text, integer, uuid, text, uuid, uuid, text, uuid,
  integer, uuid, text, text, text, text, text, text, bigint, bigint, integer,
  bigint, bigint, bigint, uuid, text, boolean
) to service_role;

create function private.fail_google_admin_summary_window_operation_v1(
  target_token_hash text,
  target_auth_user_id uuid,
  target_supabase_auth_session_id uuid,
  target_google_issuer text,
  target_provider_subject_hmac text,
  target_subject_pepper_version integer,
  target_start_request_id uuid,
  target_operation_id uuid,
  target_status text,
  actual_microusd bigint,
  actual_input_tokens bigint,
  actual_output_tokens bigint,
  provider_request_id text,
  error_code text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
set statement_timeout = '8s'
set lock_timeout = '750ms'
as $$
declare
  evidence jsonb;
  binding_row private.admin_google_summary_window_start_bindings%rowtype;
  dispatch_row private.admin_google_ai_provider_dispatch_receipts%rowtype;
  lecture_row public.lecture_sessions%rowtype;
  usage_row public.ai_usage_ledger%rowtype;
  settlement jsonb;
begin
  if target_status is null
     or target_status not in ('failed', 'cancelled')
     or actual_microusd is null
     or actual_input_tokens is null
     or actual_output_tokens is null
     or least(actual_microusd, actual_input_tokens, actual_output_tokens) < 0
     or (error_code is not null and char_length(error_code) > 120)
     or (provider_request_id is not null and char_length(provider_request_id) > 200) then
    raise exception 'invalid Google summary provider failure'
      using errcode = '22023';
  end if;

  evidence := private.require_google_ai_provider_settlement_context_v1(
    target_token_hash,
    target_auth_user_id,
    target_supabase_auth_session_id,
    target_google_issuer,
    target_provider_subject_hmac,
    target_subject_pepper_version,
    target_start_request_id,
    target_operation_id
  );
  if evidence is null or evidence ->> 'feature' <> 'summaries' then
    return null;
  end if;

  select binding.*
  into binding_row
  from private.admin_google_summary_window_start_bindings as binding
  where binding.start_request_id = target_start_request_id
    and binding.operation_id = target_operation_id
    and binding.lecture_session_id = (evidence ->> 'lecture_session_id')::uuid;
  if not found then
    return null;
  end if;

  select receipt.*
  into dispatch_row
  from private.admin_google_ai_provider_dispatch_receipts as receipt
  where receipt.start_request_id = target_start_request_id
    and receipt.operation_id = target_operation_id;
  if (
    greatest(actual_microusd, actual_input_tokens, actual_output_tokens) > 0
    or provider_request_id is not null
    or coalesce(error_code, '') like '%ambiguous%'
  ) and dispatch_row.start_request_id is null then
    raise exception 'Google summary accounting lacks dispatch evidence'
      using errcode = 'P7335';
  end if;

  select lecture.*
  into lecture_row
  from public.lecture_sessions as lecture
  where lecture.id = binding_row.lecture_session_id
  for update;
  if not found then
    return null;
  end if;

  select usage.*
  into usage_row
  from public.ai_usage_ledger as usage
  where usage.id = target_operation_id
  for update;
  if not found
     or usage_row.feature <> 'summaries'
     or usage_row.requested_by_actor is distinct from (evidence ->> 'actor_id')
     or usage_row.idempotency_key is distinct from target_start_request_id::text then
    return null;
  end if;

  if usage_row.accounting_settled_at is not null then
    return jsonb_build_object(
      'accepted', true,
      'idempotentReplay', true,
      'operationId', usage_row.id,
      'status', usage_row.status
    );
  end if;

  if usage_row.status = 'running' and target_status = 'failed' then
    settlement := private.fail_summary_window_operation(
      target_operation_id,
      binding_row.run_id,
      evidence ->> 'actor_id',
      actual_microusd,
      actual_input_tokens,
      actual_output_tokens,
      provider_request_id,
      error_code
    );
  elsif usage_row.status = 'running' then
    settlement := private.finish_lecture_ai_operation(
      target_operation_id,
      'cancelled',
      actual_microusd,
      0,
      actual_input_tokens,
      actual_output_tokens,
      provider_request_id,
      error_code
    );
    update public.lecture_summary_windows as summary_window
    set
      status = 'discarded',
      current_operation_id = null,
      last_error_code = left(
        coalesce(error_code, 'summary_provider_cancelled'),
        120
      ),
      updated_at = statement_timestamp()
    where summary_window.id = binding_row.window_id
      and summary_window.run_id = binding_row.run_id
      and summary_window.current_operation_id = target_operation_id;
  else
    settlement := private.finish_lecture_ai_operation(
      target_operation_id,
      target_status,
      actual_microusd,
      0,
      actual_input_tokens,
      actual_output_tokens,
      provider_request_id,
      error_code
    );
  end if;

  return (settlement - 'results') || jsonb_build_object(
    'operationId', target_operation_id,
    'result_saved', false
  );
end;
$$;

revoke all on function private.fail_google_admin_summary_window_operation_v1(
  text, uuid, uuid, text, text, integer, uuid, uuid, text, bigint, bigint,
  bigint, text, text
) from public, anon, authenticated, service_role;

create function public.fail_google_admin_summary_window_operation_v1(
  target_token_hash text,
  target_auth_user_id uuid,
  target_supabase_auth_session_id uuid,
  target_google_issuer text,
  target_provider_subject_hmac text,
  target_subject_pepper_version integer,
  target_start_request_id uuid,
  target_operation_id uuid,
  target_status text,
  actual_microusd bigint,
  actual_input_tokens bigint,
  actual_output_tokens bigint,
  provider_request_id text,
  error_code text
)
returns jsonb
language sql
volatile
security definer
set search_path = ''
as $$
  select private.fail_google_admin_summary_window_operation_v1(
    target_token_hash,
    target_auth_user_id,
    target_supabase_auth_session_id,
    target_google_issuer,
    target_provider_subject_hmac,
    target_subject_pepper_version,
    target_start_request_id,
    target_operation_id,
    target_status,
    actual_microusd,
    actual_input_tokens,
    actual_output_tokens,
    provider_request_id,
    error_code
  );
$$;

revoke all on function public.fail_google_admin_summary_window_operation_v1(
  text, uuid, uuid, text, text, integer, uuid, uuid, text, bigint, bigint,
  bigint, text, text
) from public, anon, authenticated;
grant execute on function public.fail_google_admin_summary_window_operation_v1(
  text, uuid, uuid, text, text, integer, uuid, uuid, text, bigint, bigint,
  bigint, text, text
) to service_role;

create function private.complete_google_admin_summary_window_operation_v1(
  target_token_hash text,
  target_auth_user_id uuid,
  target_supabase_auth_session_id uuid,
  target_google_issuer text,
  target_provider_subject_hmac text,
  target_subject_pepper_version integer,
  target_start_request_id uuid,
  target_operation_id uuid,
  target_ai_output jsonb,
  target_quality_result jsonb,
  publish_recommended boolean,
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
set statement_timeout = '8s'
set lock_timeout = '750ms'
as $$
declare
  evidence jsonb;
  binding_row private.admin_google_summary_window_start_bindings%rowtype;
  dispatch_row private.admin_google_ai_provider_dispatch_receipts%rowtype;
  context_value jsonb;
  ownership_row private.admin_lecture_ownerships%rowtype;
  policy_row private.admin_ai_policies%rowtype;
  lecture_row public.lecture_sessions%rowtype;
  master_row public.lecture_ai_master_authorizations%rowtype;
  settlement jsonb;
  authority_is_live boolean := true;
  effective_now timestamptz := statement_timestamp();
begin
  if target_ai_output is null
     or target_quality_result is null
     or jsonb_typeof(target_ai_output) is distinct from 'object'
     or jsonb_typeof(target_quality_result) is distinct from 'object'
     or octet_length(target_ai_output::text) > 16000
     or octet_length(target_quality_result::text) > 4000
     or publish_recommended is null
     or actual_microusd is null
     or actual_input_tokens is null
     or actual_output_tokens is null
     or least(actual_microusd, actual_input_tokens, actual_output_tokens) < 0
     or provider_request_id is null
     or char_length(provider_request_id) not between 1 and 200 then
    raise exception 'invalid Google summary provider completion'
      using errcode = '22023';
  end if;

  evidence := private.require_google_ai_provider_settlement_context_v1(
    target_token_hash,
    target_auth_user_id,
    target_supabase_auth_session_id,
    target_google_issuer,
    target_provider_subject_hmac,
    target_subject_pepper_version,
    target_start_request_id,
    target_operation_id
  );
  if evidence is null or evidence ->> 'feature' <> 'summaries' then
    return null;
  end if;
  select binding.*
  into binding_row
  from private.admin_google_summary_window_start_bindings as binding
  where binding.start_request_id = target_start_request_id
    and binding.operation_id = target_operation_id
    and binding.lecture_session_id = (evidence ->> 'lecture_session_id')::uuid;
  select receipt.*
  into dispatch_row
  from private.admin_google_ai_provider_dispatch_receipts as receipt
  where receipt.start_request_id = target_start_request_id
    and receipt.operation_id = target_operation_id;
  if binding_row.start_request_id is null or dispatch_row.start_request_id is null then
    raise exception 'Google summary completion lacks dispatch evidence'
      using errcode = 'P7335';
  end if;

  context_value := private.require_google_ai_provider_context_v1(
    target_token_hash,
    target_auth_user_id,
    target_supabase_auth_session_id,
    target_google_issuer,
    target_provider_subject_hmac,
    target_subject_pepper_version
  );
  authority_is_live := context_value is not null
    and (context_value ->> 'environment_id')::uuid is not distinct from
      (evidence ->> 'environment_id')::uuid
    and (context_value ->> 'principal_id')::uuid is not distinct from
      (evidence ->> 'principal_id')::uuid
    and (context_value ->> 'membership_id')::uuid is not distinct from
      (evidence ->> 'membership_id')::uuid
    and (context_value ->> 'admin_session_id')::uuid is not distinct from
      (evidence ->> 'admin_session_id')::uuid
    and (context_value ->> 'supabase_auth_session_id')::uuid is not distinct from
      (evidence ->> 'supabase_auth_session_id')::uuid;

  if authority_is_live then
    select ownership.*
    into ownership_row
    from private.admin_lecture_ownerships as ownership
    where ownership.lecture_session_id = binding_row.lecture_session_id;
    authority_is_live := found
      and ownership_row.environment_id is not distinct from
        (evidence ->> 'environment_id')::uuid
      and ownership_row.principal_id is not distinct from
        (evidence ->> 'principal_id')::uuid
      and ownership_row.membership_id is not distinct from
        (evidence ->> 'membership_id')::uuid;

    perform private.serialize_admin_ai_scope_v1(
      'policy-membership',
      (evidence ->> 'membership_id')::uuid
    );
    select policy.*
    into policy_row
    from private.admin_ai_policies as policy
    where policy.id = (evidence ->> 'policy_id')::uuid
      and policy.version = (evidence ->> 'policy_version')::bigint
      and policy.environment_id = (evidence ->> 'environment_id')::uuid
      and policy.membership_id = (evidence ->> 'membership_id')::uuid
    for update;
    authority_is_live := authority_is_live
      and found
      and policy_row.status = 'active'
      and policy_row.valid_from <= effective_now
      and policy_row.valid_until > effective_now
      and array['summaries']::text[] <@ policy_row.allowed_actions
      and array[evidence ->> 'model_id']::text[] <@ policy_row.allowed_models;
  end if;

  select lecture.*
  into lecture_row
  from public.lecture_sessions as lecture
  where lecture.id = binding_row.lecture_session_id
  for update;
  authority_is_live := authority_is_live
    and found
    and lecture_row.status = 'open'
    and lecture_row.hard_stop_at is not null
    and lecture_row.hard_stop_at > effective_now;

  if context_value is not null then
    select master.*
    into master_row
    from public.lecture_ai_master_authorizations as master
    where master.id = (evidence ->> 'master_authorization_id')::uuid
      and master.lecture_session_id = binding_row.lecture_session_id
    for update;
    authority_is_live := authority_is_live
      and found
      and master_row.status = 'active'
      and master_row.expires_at > effective_now
      and master_row.principal_id is not distinct from
        (evidence ->> 'principal_id')::uuid
      and master_row.membership_id is not distinct from
        (evidence ->> 'membership_id')::uuid
      and master_row.issuing_admin_session_id is not distinct from
        (evidence ->> 'admin_session_id')::uuid
      and master_row.actor_id is not distinct from (evidence ->> 'actor_id')
      and master_row.ai_policy_id is not distinct from
        (evidence ->> 'policy_id')::uuid
      and master_row.ai_policy_version is not distinct from
        (evidence ->> 'policy_version')::bigint
      and array['summaries']::text[] <@ master_row.actions;
  else
    authority_is_live := false;
  end if;

  if not authority_is_live then
    settlement := private.fail_google_admin_summary_window_operation_v1(
      target_token_hash,
      target_auth_user_id,
      target_supabase_auth_session_id,
      target_google_issuer,
      target_provider_subject_hmac,
      target_subject_pepper_version,
      target_start_request_id,
      target_operation_id,
      'cancelled',
      actual_microusd,
      actual_input_tokens,
      actual_output_tokens,
      provider_request_id,
      'google_authority_revoked_ambiguous'
    );
    return (settlement - 'results') || jsonb_build_object(
      'accepted', false,
      'authorityRevoked', true,
      'operationId', target_operation_id,
      'result_saved', false
    );
  end if;

  return private.complete_summary_window_operation(
    target_operation_id,
    binding_row.run_id,
    evidence ->> 'actor_id',
    actual_microusd,
    actual_input_tokens,
    actual_output_tokens,
    provider_request_id,
    evidence ->> 'model_id',
    target_ai_output,
    target_quality_result,
    publish_recommended
  );
end;
$$;

revoke all on function private.complete_google_admin_summary_window_operation_v1(
  text, uuid, uuid, text, text, integer, uuid, uuid, jsonb, jsonb, boolean,
  bigint, bigint, bigint, text
) from public, anon, authenticated, service_role;

create function public.complete_google_admin_summary_window_operation_v1(
  target_token_hash text,
  target_auth_user_id uuid,
  target_supabase_auth_session_id uuid,
  target_google_issuer text,
  target_provider_subject_hmac text,
  target_subject_pepper_version integer,
  target_start_request_id uuid,
  target_operation_id uuid,
  target_ai_output jsonb,
  target_quality_result jsonb,
  publish_recommended boolean,
  actual_microusd bigint,
  actual_input_tokens bigint,
  actual_output_tokens bigint,
  provider_request_id text
)
returns jsonb
language sql
volatile
security definer
set search_path = ''
as $$
  select private.complete_google_admin_summary_window_operation_v1(
    target_token_hash,
    target_auth_user_id,
    target_supabase_auth_session_id,
    target_google_issuer,
    target_provider_subject_hmac,
    target_subject_pepper_version,
    target_start_request_id,
    target_operation_id,
    target_ai_output,
    target_quality_result,
    publish_recommended,
    actual_microusd,
    actual_input_tokens,
    actual_output_tokens,
    provider_request_id
  );
$$;

revoke all on function public.complete_google_admin_summary_window_operation_v1(
  text, uuid, uuid, text, text, integer, uuid, uuid, jsonb, jsonb, boolean,
  bigint, bigint, bigint, text
) from public, anon, authenticated;
grant execute on function public.complete_google_admin_summary_window_operation_v1(
  text, uuid, uuid, text, text, integer, uuid, uuid, jsonb, jsonb, boolean,
  bigint, bigint, bigint, text
) to service_role;

create or replace function private.settle_stale_google_ai_provider_dispatch_v1(
  target_start_request_id uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
set statement_timeout = '5s'
set lock_timeout = '750ms'
as $$
declare
  receipt_row private.admin_google_ai_provider_dispatch_receipts%rowtype;
  intent_row private.admin_google_ai_provider_start_intents%rowtype;
  summary_binding private.admin_google_summary_window_start_bindings%rowtype;
  lecture_row public.lecture_sessions%rowtype;
  usage_row public.ai_usage_ledger%rowtype;
  settlement jsonb;
  actor_value text;
  effective_now timestamptz := statement_timestamp();
begin
  if target_start_request_id is null then
    return null;
  end if;
  perform private.serialize_admin_ai_request_v1(target_start_request_id);

  select receipt.*
  into receipt_row
  from private.admin_google_ai_provider_dispatch_receipts as receipt
  where receipt.start_request_id = target_start_request_id;
  if not found or receipt_row.lease_expires_at > effective_now then
    return null;
  end if;

  select intent.*
  into intent_row
  from private.admin_google_ai_provider_start_intents as intent
  where intent.start_request_id = target_start_request_id
    and intent.provider_family = receipt_row.provider_family;
  if not found
     or intent_row.feature not in (
       'material_analysis', 'poll_suggestions', 'summaries'
     ) then
    return null;
  end if;

  select lecture.*
  into lecture_row
  from public.lecture_sessions as lecture
  where lecture.id = intent_row.lecture_session_id
  for update;
  if not found then
    return null;
  end if;
  select usage.*
  into usage_row
  from public.ai_usage_ledger as usage
  where usage.id = receipt_row.operation_id
  for update;
  if not found then
    return null;
  end if;
  if usage_row.accounting_settled_at is not null then
    return jsonb_build_object(
      'accepted', true,
      'alreadyTerminal', true,
      'operationId', usage_row.id,
      'staleRecovered', false
    );
  end if;

  actor_value := 'admin-session:' || intent_row.admin_session_id::text;
  if usage_row.lecture_session_id is distinct from lecture_row.id
     or usage_row.feature is distinct from intent_row.feature
     or usage_row.idempotency_key is distinct from
       target_start_request_id::text
     or usage_row.requested_by_actor is distinct from actor_value
     or usage_row.provider_dispatched_at is null
     or usage_row.provider_request_id is distinct from
       receipt_row.client_request_id::text then
    return null;
  end if;

  if intent_row.feature = 'summaries' then
    select binding.*
    into summary_binding
    from private.admin_google_summary_window_start_bindings as binding
    where binding.start_request_id = target_start_request_id
      and binding.operation_id = usage_row.id
      and binding.lecture_session_id = usage_row.lecture_session_id;
    if not found then
      return null;
    end if;
    if usage_row.status = 'running' then
      settlement := private.fail_summary_window_operation(
        usage_row.id,
        summary_binding.run_id,
        actor_value,
        usage_row.reserved_microusd,
        usage_row.reserved_input_tokens,
        usage_row.reserved_output_tokens,
        receipt_row.client_request_id::text,
        'provider_dispatch_lease_expired_ambiguous'
      );
    else
      settlement := private.finish_lecture_ai_operation(
        usage_row.id,
        'cancelled',
        usage_row.reserved_microusd,
        0,
        usage_row.reserved_input_tokens,
        usage_row.reserved_output_tokens,
        receipt_row.client_request_id::text,
        'provider_dispatch_lease_expired_ambiguous'
      );
    end if;
  else
    settlement := private.fail_material_ai_operation(
      usage_row.id,
      actor_value,
      'cancelled',
      usage_row.reserved_microusd,
      usage_row.reserved_input_tokens,
      usage_row.reserved_output_tokens,
      receipt_row.client_request_id::text,
      'provider_dispatch_lease_expired_ambiguous'
    );
  end if;

  return (settlement - 'results') || jsonb_build_object(
    'accepted', true,
    'operationId', usage_row.id,
    'staleRecovered', true
  );
end;
$$;

revoke all on function private.settle_stale_google_ai_provider_dispatch_v1(
  uuid
) from public, anon, authenticated, service_role;

comment on table private.admin_google_summary_window_preflight_receipts is
  'Append-only Google Admin summary preflight evidence. It stores hashes, bounded source metadata and identifiers, never transcript, PDF text, bearer, PIN, nonce or provider payload content.';
comment on table private.admin_google_summary_window_start_bindings is
  'Append-only binding from one summary window attempt to one Google child, one usage operation and one provider payload hash.';
comment on function public.prepare_google_admin_summary_window_v1(
  text, uuid, uuid, text, text, integer, uuid, uuid, text, integer, text,
  jsonb, jsonb, text, text, uuid, boolean
) is
  'Service-only, request-bound summary preflight. Insufficient windows skip without a provider child; exact replay never exposes stale lecture content.';
comment on function public.issue_google_summary_ai_child_grant_v1(
  text, uuid, uuid, text, text, integer, uuid, uuid, uuid, integer, uuid, text,
  text, text, text, text, text, bigint, bigint, integer, bigint, bigint, bigint,
  text, integer, uuid, boolean
) is
  'Service-only C1-master child issue for one preflighted summary window attempt.';
comment on function public.start_google_admin_summary_window_operation_v1(
  text, uuid, uuid, text, text, integer, uuid, text, uuid, uuid, text, uuid,
  integer, uuid, text, text, text, text, text, text, bigint, bigint, integer,
  bigint, bigint, bigint, uuid, text, boolean
) is
  'Service-only atomic child consumption and usage start for one summary window attempt. It never re-enables a stopped scheduler.';
comment on function public.complete_google_admin_summary_window_operation_v1(
  text, uuid, uuid, text, text, integer, uuid, uuid, jsonb, jsonb, boolean,
  bigint, bigint, bigint, text
) is
  'Service-only summary completion. Current Google authority is revalidated before content is saved; revoked authority settles and discards.';
comment on function public.fail_google_admin_summary_window_operation_v1(
  text, uuid, uuid, text, text, integer, uuid, uuid, text, bigint, bigint,
  bigint, text, text
) is
  'Service-only immutable-evidence settlement for a failed or cancelled Google summary provider attempt.';
