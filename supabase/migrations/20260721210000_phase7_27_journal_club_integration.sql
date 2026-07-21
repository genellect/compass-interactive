-- Phase 7.27: one-shot Journal Club production run plus isolated rehearsals.
--
-- This is deliberately an additive operational preset. Existing lecture,
-- Poll, PDF, AI and archive state machines remain authoritative. Creating a
-- run never starts a lecture, opens a Poll, publishes a PDF or enables AI.

create table public.phase727_journal_club_runs (
  lecture_session_id uuid primary key
    references public.lecture_sessions(id) on delete restrict,
  event_key text not null default 'journal-club-2026-07-23'
    check (event_key = 'journal-club-2026-07-23'),
  run_kind text not null check (run_kind in ('rehearsal', 'production')),
  preset_version integer not null default 1 check (preset_version = 1),
  client_request_id uuid not null unique,
  created_by_admin_session_id uuid not null
    references public.admin_sessions(id) on delete restrict,
  created_by_auth_user_id uuid not null,
  expected_document_id text not null default 'journal-club-2026-07-23-v1'
    check (expected_document_id = 'journal-club-2026-07-23-v1'),
  expected_pdf_sha256 text not null default
    '8c6903527b050c1db5f6b13b24bcf9108950bf8248a80205b10be6a9c63d7842'
    check (
      expected_pdf_sha256 =
        '8c6903527b050c1db5f6b13b24bcf9108950bf8248a80205b10be6a9c63d7842'
    ),
  expected_pdf_byte_size bigint not null default 5816208
    check (expected_pdf_byte_size = 5816208),
  expected_pdf_page_count integer not null default 34
    check (expected_pdf_page_count = 34),
  created_at timestamptz not null default statement_timestamp()
);

create unique index phase727_journal_club_one_production_idx
  on public.phase727_journal_club_runs (event_key)
  where run_kind = 'production';

create index phase727_journal_club_runs_event_kind_created_idx
  on public.phase727_journal_club_runs (
    event_key,
    run_kind,
    created_at desc,
    lecture_session_id
  );

create index phase727_journal_club_runs_admin_session_idx
  on public.phase727_journal_club_runs (
    created_by_admin_session_id,
    lecture_session_id
  );

alter table public.phase727_journal_club_runs enable row level security;
revoke all on public.phase727_journal_club_runs
  from public, anon, authenticated, service_role;
grant select, insert on public.phase727_journal_club_runs to service_role;

comment on table public.phase727_journal_club_runs is
  'Service-only binding for isolated 2026-07-23 Journal Club rehearsals and the one production run.';

create table public.phase727_journal_club_poll_slots (
  lecture_session_id uuid not null
    references public.phase727_journal_club_runs(lecture_session_id)
    on delete restrict,
  poll_id uuid not null,
  display_order integer not null check (display_order between 1 and 6),
  created_at timestamptz not null default statement_timestamp(),
  primary key (lecture_session_id, display_order),
  unique (poll_id),
  foreign key (poll_id, lecture_session_id)
    references public.polls(id, lecture_session_id) on delete restrict
);

create index phase727_journal_club_poll_slots_poll_idx
  on public.phase727_journal_club_poll_slots (poll_id, lecture_session_id);

alter table public.phase727_journal_club_poll_slots enable row level security;
revoke all on public.phase727_journal_club_poll_slots
  from public, anon, authenticated, service_role;
grant select, insert on public.phase727_journal_club_poll_slots to service_role;

comment on table public.phase727_journal_club_poll_slots is
  'Stable display order for the six draft Polls created by the Phase 7.27 preset.';

create function public.admin_create_phase727_journal_club_run_v1(
  target_run_kind text,
  target_lecture_code_hash text,
  target_lecture_code text,
  target_client_request_id uuid,
  target_admin_session_id uuid,
  target_admin_auth_user_id uuid
)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  existing_run public.phase727_journal_club_runs%rowtype;
  created_lecture_id uuid;
  created_poll_id uuid;
  poll_entry record;
  option_labels text[];
  poll_blueprint constant jsonb := jsonb_build_array(
    jsonb_build_object(
      'question', 'QUIZ1: C9orf72リピートはどの方向に転写される？',
      'options', jsonb_build_array(
        'sense方向のみ',
        'antisense方向のみ',
        'sense・antisenseの両方向',
        'どちらにも転写されない'
      )
    ),
    jsonb_build_object(
      'question', 'QUIZ2: CasRxが直接切断する分子はどれ？',
      'options', jsonb_build_array(
        'C9orf72遺伝子のDNA',
        'リピートを含むRNA',
        'RAN翻訳で生じるDPR',
        '細胞膜'
      )
    ),
    jsonb_build_object(
      'question', 'QUIZ3: gRNAをリピート隣接領域に設計する利点は？',
      'options', jsonb_build_array(
        '標的特異性を確保しやすい',
        'RNAには塩基配列がない',
        'CasRxはPAM配列を必要とする',
        'DPRがgRNAの結合を阻害する'
      )
    ),
    jsonb_build_object(
      'question', 'FINAL QUIZ: この研究から直接結論できないものはどれ？',
      'options', jsonb_build_array(
        'CasRxはsense RNAを減少させる',
        'CasRxはantisense RNAを減少させる',
        'Dual guideはsingle guideより優れている',
        'CasRxはグルタミン酸興奮毒性を軽減する'
      )
    ),
    jsonb_build_object(
      'question', '今回の発表を通して、説明・文献の内容をどの程度理解できましたか？',
      'options', jsonb_build_array(
        '80％以上',
        '60〜80％くらい',
        '40〜60％くらい',
        '理解するのが難しかった'
      )
    ),
    jsonb_build_object(
      'question', 'COMPASS Interactiveは、今回の発表内容の理解や議論への参加に役立ちましたか？',
      'options', jsonb_build_array(
        '非常に役立った',
        'ある程度役立った',
        'あまり変わらなかった',
        '従来の形式の方が良い'
      )
    )
  );
begin
  perform private.assert_tracked_pdf_admin_actor_v1(
    target_admin_session_id,
    target_admin_auth_user_id
  );

  if target_run_kind not in ('rehearsal', 'production') then
    raise exception 'invalid Journal Club run kind' using errcode = '22023';
  end if;
  if target_client_request_id is null then
    raise exception 'client request ID is required' using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'phase727:request:' || target_client_request_id::text,
      0
    )
  );

  select run.*
  into existing_run
  from public.phase727_journal_club_runs as run
  where run.client_request_id = target_client_request_id;

  if found then
    if existing_run.run_kind <> target_run_kind
       or existing_run.created_by_admin_session_id <> target_admin_session_id
       or existing_run.created_by_auth_user_id <> target_admin_auth_user_id then
      raise exception 'Journal Club request identity does not match'
        using errcode = '42501';
    end if;
    return jsonb_build_object(
      'created', false,
      'idempotent_replay', true,
      'lecture_session_id', existing_run.lecture_session_id,
      'run_kind', existing_run.run_kind
    );
  end if;

  if target_run_kind = 'production' then
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(
        'phase727:event:journal-club-2026-07-23',
        0
      )
    );
    if exists (
      select 1
      from public.phase727_journal_club_runs as run
      where run.event_key = 'journal-club-2026-07-23'
        and run.run_kind = 'production'
    ) then
      raise exception 'Journal Club production run already exists'
        using errcode = 'P0001';
    end if;
  end if;

  created_lecture_id := public.admin_create_lecture_v2(
    '7.23 Journal Club',
    target_lecture_code_hash,
    target_lecture_code,
    null,
    null
  );

  insert into public.phase727_journal_club_runs (
    lecture_session_id,
    run_kind,
    client_request_id,
    created_by_admin_session_id,
    created_by_auth_user_id
  )
  values (
    created_lecture_id,
    target_run_kind,
    target_client_request_id,
    target_admin_session_id,
    target_admin_auth_user_id
  );

  for poll_entry in
    select blueprint.value as payload, blueprint.ordinality::integer as position
    from jsonb_array_elements(poll_blueprint) with ordinality as blueprint
  loop
    select array_agg(option_value order by option_order)
    into option_labels
    from jsonb_array_elements_text(poll_entry.payload -> 'options')
      with ordinality as option_row(option_value, option_order);

    created_poll_id := public.admin_create_poll(
      created_lecture_id,
      poll_entry.payload ->> 'question',
      'single',
      option_labels
    );

    insert into public.phase727_journal_club_poll_slots (
      lecture_session_id,
      poll_id,
      display_order
    )
    values (created_lecture_id, created_poll_id, poll_entry.position);
  end loop;

  return jsonb_build_object(
    'created', true,
    'idempotent_replay', false,
    'lecture_session_id', created_lecture_id,
    'run_kind', target_run_kind
  );
end;
$$;

revoke all on function public.admin_create_phase727_journal_club_run_v1(
  text, text, text, uuid, uuid, uuid
) from public, anon, authenticated, service_role;
grant execute on function public.admin_create_phase727_journal_club_run_v1(
  text, text, text, uuid, uuid, uuid
) to service_role;

comment on function public.admin_create_phase727_journal_club_run_v1(
  text, text, text, uuid, uuid, uuid
) is
  'Atomically creates one isolated draft lecture and six ordered draft Polls. It never starts paid or live operations.';

create function private.phase727_guard_single_open_run()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_run public.phase727_journal_club_runs%rowtype;
begin
  if new.status <> 'open' or old.status = 'open' then
    return new;
  end if;

  select run.*
  into target_run
  from public.phase727_journal_club_runs as run
  where run.lecture_session_id = new.id;

  if not found then
    return new;
  end if;

  if target_run.run_kind = 'production'
     and not exists (
       select 1
       from public.lecture_pdf_documents as document
       where document.lecture_session_id = new.id
         and document.document_id = target_run.expected_document_id
         and document.document_version = target_run.expected_pdf_sha256
         and document.pdf_sha256 = target_run.expected_pdf_sha256
         and document.byte_size = target_run.expected_pdf_byte_size
         and document.page_count = target_run.expected_pdf_page_count
         and document.visible
         and document.retired_at is null
     ) then
    raise exception 'production Journal Club PDF is not active'
      using errcode = '55000';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'phase727:open:' || target_run.event_key,
      0
    )
  );

  if exists (
    select 1
    from public.phase727_journal_club_runs as run
    join public.lecture_sessions as lecture
      on lecture.id = run.lecture_session_id
    where run.event_key = target_run.event_key
      and run.lecture_session_id <> new.id
      and lecture.status = 'open'
  ) then
    raise exception 'another Journal Club run is already open'
      using errcode = 'P0001';
  end if;

  return new;
end;
$$;

revoke all on function private.phase727_guard_single_open_run() from public;

create trigger phase727_guard_single_open_run
before update of status on public.lecture_sessions
for each row execute function private.phase727_guard_single_open_run();

create function private.phase727_validate_pdf_publication()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  run public.phase727_journal_club_runs%rowtype;
begin
  select candidate.*
  into run
  from public.phase727_journal_club_runs as candidate
  where candidate.lecture_session_id = new.lecture_session_id;

  if not found then
    return new;
  end if;

  if new.document_id <> run.expected_document_id
     or new.expected_pdf_sha256 <> run.expected_pdf_sha256
     or new.expected_byte_size <> run.expected_pdf_byte_size
     or new.declared_page_count <> run.expected_pdf_page_count then
    raise exception 'PDF does not match the Journal Club template'
      using errcode = '22023';
  end if;
  return new;
end;
$$;

revoke all on function private.phase727_validate_pdf_publication() from public;

create trigger phase727_validate_pdf_publication
before insert or update of
  lecture_session_id,
  document_id,
  expected_pdf_sha256,
  expected_byte_size,
  declared_page_count
on public.lecture_pdf_publications
for each row execute function private.phase727_validate_pdf_publication();

create function private.phase727_validate_pdf_document()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  run public.phase727_journal_club_runs%rowtype;
begin
  select candidate.*
  into run
  from public.phase727_journal_club_runs as candidate
  where candidate.lecture_session_id = new.lecture_session_id;

  if not found then
    return new;
  end if;

  if new.document_id <> run.expected_document_id
     or new.document_version <> run.expected_pdf_sha256
     or new.pdf_sha256 <> run.expected_pdf_sha256
     or new.byte_size <> run.expected_pdf_byte_size
     or new.page_count <> run.expected_pdf_page_count then
    raise exception 'PDF document does not match the Journal Club template'
      using errcode = '22023';
  end if;

  if run.run_kind = 'production'
     and new.visible
     and new.retired_at is null then
    new.archive_expires_at := null;
    new.delete_after := null;
  end if;
  return new;
end;
$$;

revoke all on function private.phase727_validate_pdf_document() from public;

create trigger phase727_validate_pdf_document
before insert or update on public.lecture_pdf_documents
for each row execute function private.phase727_validate_pdf_document();

-- The public builders continue requesting 1, 6 or 12 items. Raising only the
-- private helper ceiling lets the production archive request all 18 five-minute
-- windows without changing any existing live or standard archive response.
create or replace function private.phase6_public_summaries_json(
  target_lecture_session_id uuid,
  result_limit integer default 6
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    jsonb_agg(item.payload order by item.pinned_rank, item.window_end desc),
    '[]'::jsonb
  )
  from (
    select
      case
        when publication.pinned_order is null then 1000
        else publication.pinned_order
      end as pinned_rank,
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
    limit least(greatest(result_limit, 1), 18)
  ) as item;
$$;

create function private.build_public_lecture_archive_v4(
  target_lecture_session_id uuid
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when base.payload is null then null
    when run.run_kind = 'production' then
      base.payload || jsonb_build_object(
        'archive_policy', jsonb_build_object(
          'mode', 'permanent',
          'policy_id', 'phase7-27-journal-club-2026-07-23-v1'
        ),
        'summaries', private.phase6_public_summaries_json(
          target_lecture_session_id,
          18
        )
      )
    else base.payload
  end
  from (
    select private.build_public_lecture_archive_v3(
      target_lecture_session_id
    ) as payload
  ) as base
  left join public.phase727_journal_club_runs as run
    on run.lecture_session_id = target_lecture_session_id;
$$;

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
    select
      export.lecture_session_id,
      export.status = 'exporting' as reclaim_expired_lease
    from public.lecture_archive_exports as export
    join public.lecture_sessions as lecture
      on lecture.id = export.lecture_session_id
    where (
      (
        export.status in ('pending', 'error')
        and export.next_attempt_at <= statement_timestamp()
      )
      or (
        export.status = 'exporting'
        and export.lease_until <= statement_timestamp()
      )
    )
      and lecture.status = 'closed'
      and lecture.archive_expires_at > statement_timestamp()
      and exists (
        select 1
        from public.lecture_admin_codes as code
        where code.lecture_session_id = export.lecture_session_id
      )
    order by
      case
        when export.status = 'exporting' then export.lease_until
        else export.next_attempt_at
      end,
      export.lecture_session_id
    for update of export skip locked
    limit least(greatest(job_limit, 1), 20)
  ),
  claimed as (
    update public.lecture_archive_exports as export
    set
      source_version = export.source_version
        + case when candidates.reclaim_expired_lease then 1 else 0 end,
      status = 'exporting',
      lease_until = statement_timestamp() + interval '10 minutes',
      attempt_count = export.attempt_count + 1,
      last_error = case
        when candidates.reclaim_expired_lease then 'export_lease_expired'
        else export.last_error
      end,
      updated_at = statement_timestamp()
    from candidates
    where export.lecture_session_id = candidates.lecture_session_id
    returning
      export.lecture_session_id,
      export.source_version,
      export.attempt_count
  )
  select
    claimed.lecture_session_id,
    claimed.source_version,
    code.lecture_code,
    lecture.archive_expires_at,
    claimed.attempt_count,
    private.build_public_lecture_archive_v4(claimed.lecture_session_id)
  from claimed
  join public.lecture_sessions as lecture
    on lecture.id = claimed.lecture_session_id
  join public.lecture_admin_codes as code
    on code.lecture_session_id = claimed.lecture_session_id;
end;
$$;

revoke all on function private.build_public_lecture_archive_v4(uuid)
  from public, anon, authenticated, service_role;
grant execute on function private.build_public_lecture_archive_v4(uuid)
  to service_role;
revoke all on function private.claim_lecture_archive_exports(integer)
  from public, anon, authenticated, service_role;
grant execute on function private.claim_lecture_archive_exports(integer)
  to service_role;

comment on function private.build_public_lecture_archive_v4(uuid) is
  'Adds the exact permanent R2 policy marker and all 18 summary windows only for the bound Phase 7.27 production run.';
