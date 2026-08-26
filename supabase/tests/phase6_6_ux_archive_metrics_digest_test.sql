BEGIN;
SET search_path = public, extensions;
SELECT no_plan();

-- Schema, privilege, and expand-first compatibility checks.
SELECT has_column(
  'public', 'lecture_sessions', 'duplicated_from_lecture_session_id',
  'lecture duplication provenance is stored'
);
SELECT has_column(
  'public', 'lecture_live_state', 'metrics_version',
  'live state has a cached metrics version'
);
SELECT has_column(
  'public', 'lecture_live_state', 'participant_count',
  'live state has a cached participant count'
);
SELECT has_column(
  'public', 'lecture_live_state', 'visible_comment_count',
  'live state has a cached visible-comment count'
);
SELECT has_column(
  'public', 'lecture_live_state', 'hidden_comment_count',
  'live state has a cached Admin-only hidden-comment count'
);
SELECT has_column(
  'public', 'lecture_live_state', 'visible_comments_version',
  'live state has a visible-only operator comment version'
);
SELECT has_table(
  'public', 'lecture_join_rate_limits',
  'join brute-force state exists'
);
SELECT has_table(
  'public', 'lecture_participant_presence',
  'server-owned participant presence state exists'
);
SELECT has_table(
  'public', 'lecture_presence_metrics',
  'lecture-scoped active-presence cache exists'
);
SELECT has_table(
  'public', 'lecture_archive_exports',
  'sanitized archive export outbox exists'
);
SELECT has_table(
  'public', 'lecture_material_summary_publications',
  'teacher-reviewed material summary publication state exists'
);
SELECT has_table(
  'public', 'daily_operations_digest_jobs',
  'daily operations digest queue exists'
);

SELECT ok(
  (SELECT relrowsecurity
   FROM pg_class
   WHERE oid = 'public.lecture_join_rate_limits'::regclass),
  'join rate-limit state has RLS enabled'
);
SELECT ok(
  (SELECT relrowsecurity
   FROM pg_class
   WHERE oid = 'public.lecture_participant_presence'::regclass)
  AND (SELECT relrowsecurity
       FROM pg_class
       WHERE oid = 'public.lecture_presence_metrics'::regclass),
  'presence source and cache have RLS enabled'
);
SELECT ok(
  (SELECT relrowsecurity
   FROM pg_class
   WHERE oid = 'public.lecture_archive_exports'::regclass),
  'archive export outbox has RLS enabled'
);
SELECT ok(
  (SELECT relrowsecurity
   FROM pg_class
   WHERE oid =
     'public.lecture_material_summary_publications'::regclass),
  'material summary publication state has RLS enabled'
);
SELECT ok(
  (SELECT relrowsecurity
   FROM pg_class
   WHERE oid = 'public.daily_operations_digest_jobs'::regclass),
  'digest queue has RLS enabled'
);
SELECT ok(
  NOT has_table_privilege(
    'anon', 'public.lecture_join_rate_limits', 'SELECT'
  ),
  'anonymous clients cannot read join rate-limit state'
);
SELECT ok(
  NOT has_table_privilege(
    'authenticated', 'public.lecture_participant_presence', 'SELECT'
  )
  AND NOT has_table_privilege(
    'authenticated', 'public.lecture_participant_presence', 'INSERT'
  )
  AND NOT has_table_privilege(
    'authenticated', 'public.lecture_participant_presence', 'UPDATE'
  )
  AND NOT has_table_privilege(
    'authenticated', 'public.lecture_presence_metrics', 'SELECT'
  ),
  'browser clients cannot read or forge presence'
);
SELECT ok(
  NOT has_table_privilege(
    'authenticated', 'public.lecture_archive_exports', 'SELECT'
  ),
  'authenticated clients cannot read archive export state'
);
SELECT ok(
  NOT has_table_privilege(
    'authenticated',
    'public.lecture_material_summary_publications',
    'SELECT'
  )
  AND NOT has_table_privilege(
    'authenticated',
    'public.lecture_material_summary_publications',
    'INSERT'
  )
  AND NOT has_table_privilege(
    'authenticated',
    'public.lecture_material_summary_publications',
    'UPDATE'
  ),
  'browser clients cannot directly read or write material publications'
);
SELECT ok(
  NOT has_table_privilege(
    'authenticated', 'public.daily_operations_digest_jobs', 'SELECT'
  ),
  'authenticated clients cannot read digest delivery state'
);
SELECT ok(
  has_function_privilege(
    'authenticated',
    'public.join_lecture_by_code_v2(text)',
    'EXECUTE'
  ),
  'authenticated clients can use the protected join RPC'
);
SELECT ok(
  NOT has_function_privilege(
    'anon',
    'public.join_lecture_by_code_v2(text)',
    'EXECUTE'
  ),
  'unauthenticated clients cannot use the protected join RPC'
);
SELECT ok(
  has_function_privilege(
    'service_role',
    'public.admin_create_lecture_v2(text,text,text,timestamptz,timestamptz)',
    'EXECUTE'
  ),
  'service role can create new six-digit-code lectures'
);
SELECT ok(
  NOT has_function_privilege(
    'authenticated',
    'public.admin_create_lecture_v2(text,text,text,timestamptz,timestamptz)',
    'EXECUTE'
  ),
  'students cannot create lectures'
);
SELECT ok(
  has_function_privilege(
    'service_role',
    'public.admin_set_material_summary_publication(uuid,uuid,uuid,text,jsonb,text)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'authenticated',
    'public.admin_set_material_summary_publication(uuid,uuid,uuid,text,jsonb,text)',
    'EXECUTE'
  ),
  'only service-backed Admin Edge code can manage material publications'
);
SELECT ok(
  has_function_privilege(
    'service_role',
    'public.admin_get_lecture_operator_access_v1(uuid)',
    'EXECUTE'
  )
  AND has_function_privilege(
    'service_role',
    'public.admin_get_lecture_operator_snapshot_v1(uuid,boolean,bigint,bigint,bigint,bigint,bigint,bigint,bigint,timestamptz,uuid,integer,bigint)',
    'EXECUTE'
  )
  AND has_function_privilege(
    'service_role',
    'public.admin_get_lecture_operator_comment_history_v1(uuid,timestamptz,uuid,integer)',
    'EXECUTE'
  ),
  'service-backed Edge code can read operator projections'
);
SELECT ok(
  NOT has_function_privilege(
    'authenticated',
    'public.admin_get_lecture_operator_access_v1(uuid)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'authenticated',
    'public.admin_get_lecture_operator_snapshot_v1(uuid,boolean,bigint,bigint,bigint,bigint,bigint,bigint,bigint,timestamptz,uuid,integer,bigint)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'anon',
    'public.admin_get_lecture_operator_snapshot_v1(uuid,boolean,bigint,bigint,bigint,bigint,bigint,bigint,bigint,timestamptz,uuid,integer,bigint)',
    'EXECUTE'
  ),
  'browser roles cannot bypass Edge operator credentials'
);
SELECT ok(
  has_function_privilege(
    'service_role',
    'private.bump_lecture_live_state(uuid,text)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'authenticated',
    'private.bump_lecture_live_state(uuid,text)',
    'EXECUTE'
  ),
  'material publication has only the service-scoped canonical live-state bump'
);
SELECT ok(
  NOT (SELECT prosecdef
       FROM pg_proc
       WHERE oid = 'public.join_lecture_by_code_v2(text)'::regprocedure),
  'public join v2 wrapper is SECURITY INVOKER'
);
SELECT ok(
  NOT (SELECT prosecdef
       FROM pg_proc
       WHERE oid =
         'public.get_lecture_public_snapshot_v5(uuid,bigint,bigint,bigint,bigint,bigint,bigint,bigint,timestamptz,uuid,integer,bigint)'::regprocedure),
  'public v5 snapshot wrapper is SECURITY INVOKER'
);
SELECT ok(
  NOT (SELECT prosecdef
       FROM pg_proc
       WHERE oid =
         'public.claim_lecture_archive_exports(integer)'::regprocedure),
  'public archive claim wrapper is SECURITY INVOKER'
);
SELECT ok(
  NOT (SELECT prosecdef
       FROM pg_proc
       WHERE oid =
         'public.claim_daily_operations_digest_jobs(integer,text)'::regprocedure),
  'public digest claim wrapper is SECURITY INVOKER'
);
SELECT ok(
  NOT (SELECT prosecdef
       FROM pg_proc
       WHERE oid =
         'public.admin_set_material_summary_publication(uuid,uuid,uuid,text,jsonb,text)'::regprocedure),
  'public material publication RPC is SECURITY INVOKER'
);
SELECT is(
  (
    SELECT count(*)::integer
    FROM pg_proc AS procedure
    JOIN pg_namespace AS namespace
      ON namespace.oid = procedure.pronamespace
    WHERE namespace.nspname = 'private'
      AND procedure.proname IN (
        'join_lecture_by_code_v2',
        'invalidate_presence_metrics',
        'phase66_active_participant_count',
        'requeue_lecture_archive_export',
        'build_public_lecture_archive_v1',
        'claim_lecture_archive_exports',
        'finish_lecture_archive_export',
        'claim_daily_operations_digest_jobs',
        'finish_daily_operations_digest_job',
        'get_lecture_public_snapshot_v5',
        'phase66_public_material_summary_json',
        'phase66_admin_material_summary_publication_json',
        'reap_stale_realtime_caption_operations',
        'heartbeat_realtime_caption_operation',
        'publish_lecture_caption',
        'maintain_phase6_6_jobs'
      )
      AND (
        NOT procedure.prosecdef
        OR NOT coalesce(procedure.proconfig, '{}'::text[])
          @> ARRAY['search_path=""']
      )
  ),
  0,
  'all Phase 6.6 private entrypoints are Definer functions with an empty search_path'
);
SELECT ok(
  to_regprocedure('public.join_lecture_by_code(text)') IS NOT NULL
    AND to_regprocedure(
      'public.get_lecture_public_snapshot_v4(uuid,bigint,bigint,bigint,bigint,bigint,bigint,bigint,timestamptz,uuid,integer)'
    ) IS NOT NULL,
  'legacy join and v4 snapshot RPCs remain available'
);
SELECT ok(
  to_regclass('public.polls_one_open_per_lecture_uidx') IS NOT NULL,
  'one-open-Poll invariant is backed by a partial unique index'
);
SELECT ok(
  to_regclass(
    'public.lecture_participant_presence_active_idx'
  ) IS NOT NULL
  AND to_regclass(
    'public.lecture_participant_presence_participant_idx'
  ) IS NOT NULL,
  'active presence and its participant foreign key are indexed'
);
SELECT ok(
  to_regclass('public.lecture_archive_exports_claim_idx') IS NOT NULL
    AND to_regclass('public.lecture_archive_exports_lease_idx') IS NOT NULL,
  'archive ready and expired-lease claims are indexed'
);
SELECT ok(
  to_regclass(
    'public.lecture_material_analyses_lecture_id_uidx'
  ) IS NOT NULL
  AND to_regclass(
    'public.lecture_material_summary_publications_analysis_uidx'
  ) IS NOT NULL,
  'material publication ownership and analysis lookup are indexed'
);
SELECT ok(
  to_regclass('public.daily_operations_digest_jobs_claim_idx') IS NOT NULL
    AND to_regclass('public.daily_operations_digest_jobs_lease_idx') IS NOT NULL,
  'digest ready and expired-lease claims are indexed'
);
SELECT ok(
  to_regclass('public.lecture_sessions_started_digest_idx') IS NOT NULL
    AND to_regclass('public.ai_usage_ledger_requested_global_idx') IS NOT NULL,
  'daily digest source-range scans are indexed'
);
SELECT alike(
  pg_get_functiondef(
    'public.admin_set_poll_status(uuid,uuid,text)'::regprocedure
  ),
  '%for update%',
  'Poll transitions serialize on the lecture row'
);
SELECT unalike(
  pg_get_functiondef(
    'private.phase66_active_participant_count(uuid,timestamptz)'::regprocedure
  ),
  '%from public.participants%',
  'active attendance never recounts the cumulative participant table'
);
SELECT alike(
  pg_get_functiondef(
    'private.phase66_active_participant_count(uuid,timestamptz)'::regprocedure
  ),
  '%from public.lecture_participant_presence%',
  'active attendance counts only the indexed TTL presence table'
);
SELECT alike(
  pg_get_functiondef(
    'private.heartbeat_realtime_caption_operation(uuid,text)'::regprocedure
  ),
  '%statement_timestamp()%',
  'Realtime duration heartbeat uses database time'
);
SELECT alike(
  pg_get_functiondef(
    'private.publish_lecture_caption(uuid,uuid,text,text,text,bigint,text)'::regprocedure
  ),
  '%reserved_audio_seconds * interval ''1 second''%',
  'caption publication enforces the reserved duration in the database'
);
SELECT ok(
  private.phase66_material_summary_body_is_valid(
    '{
      "lead":"Reviewed lead",
      "points":[{
        "pageLabel":"P.1",
        "title":"Reviewed point",
        "detail":""
      }],
      "reflectionQuestion":""
    }'::jsonb
  ),
  'optional point detail and reflection question may be empty strings'
);
SELECT is(
  (
    SELECT count(*)::integer
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename IN (
        'lecture_join_rate_limits',
        'lecture_participant_presence',
        'lecture_presence_metrics',
        'lecture_archive_exports',
        'lecture_material_summary_publications',
        'daily_operations_digest_jobs'
      )
  ),
  0,
  'Phase 6.6 operational tables are not added to Realtime'
);

-- Archive claim RPCs intentionally select the oldest eligible outbox row.
-- Remove rows left by earlier local E2E runs inside this rollback-only test
-- transaction so the claim assertions exercise only the fixtures below.
DELETE FROM public.lecture_archive_exports;

CREATE TEMP TABLE p66_fixture (
  lecture_id uuid,
  legacy_lecture_id uuid,
  duration_lecture_id uuid,
  presence_load_lecture_id uuid,
  codeless_lecture_id uuid,
  caption_operation_id uuid,
  participant_a uuid,
  participant_b uuid,
  visible_comment_id uuid,
  hidden_comment_id uuid,
  poll_a uuid,
  poll_b uuid,
  duplicate_lecture_id uuid,
  material_analysis_id uuid,
  material_summary_version bigint,
  summaries_version_before bigint,
  summaries_version_after bigint,
  participant_presence_before timestamptz,
  metrics_before_hidden bigint,
  metrics_after_hidden bigint,
  visible_comments_version_before bigint,
  visible_comments_version_after bigint,
  archive_source_version bigint,
  archive_reclaimed_version bigint,
  digest_job_id uuid,
  digest_retry_job_id uuid,
  digest_retry_attempt integer
);
GRANT SELECT, INSERT, UPDATE ON p66_fixture
  TO service_role, authenticated;
INSERT INTO p66_fixture DEFAULT VALUES;

SET LOCAL ROLE service_role;
SELECT lives_ok(
  $$
    UPDATE p66_fixture
    SET lecture_id = public.admin_create_lecture_v2(
      'Phase 6.6 main lecture',
      encode(extensions.digest(convert_to('285463', 'UTF8'), 'sha256'), 'hex'),
      '285463',
      null,
      null
    )
  $$,
  'Admin can create a lecture with a six-digit code'
);
SELECT throws_ok(
  $$
    SELECT public.admin_create_lecture_v2(
      'Invalid code',
      encode(extensions.digest(convert_to('ABC123', 'UTF8'), 'sha256'), 'hex'),
      'ABC123',
      null,
      null
    )
  $$,
  '22023',
  null,
  'new lecture creation rejects non-numeric codes'
);
SELECT throws_ok(
  $$
    SELECT public.admin_create_lecture_v2(
      'Mismatched hash',
      repeat('0', 64),
      '285464',
      null,
      null
    )
  $$,
  '22023',
  null,
  'new lecture creation recomputes and verifies the code hash'
);
UPDATE p66_fixture
SET legacy_lecture_id = public.admin_create_lecture(
  'Phase 6.6 legacy-code lecture',
  encode(
    extensions.digest(convert_to('P66-LEGACY', 'UTF8'), 'sha256'),
    'hex'
  ),
  'P66-LEGACY',
  null,
  null
);
UPDATE p66_fixture
SET duration_lecture_id = public.admin_create_lecture_v2(
  'Phase 6.6 Realtime duration lecture',
  encode(extensions.digest(convert_to('285466', 'UTF8'), 'sha256'), 'hex'),
  '285466',
  null,
  null
);
UPDATE p66_fixture
SET presence_load_lecture_id = public.admin_create_lecture_v2(
  'Phase 6.6 presence load lecture',
  encode(extensions.digest(convert_to('285467', 'UTF8'), 'sha256'), 'hex'),
  '285467',
  null,
  null
);
UPDATE p66_fixture
SET codeless_lecture_id = public.admin_create_lecture_v2(
  'Phase 6.6 code-less archive fixture',
  encode(extensions.digest(convert_to('285468', 'UTF8'), 'sha256'), 'hex'),
  '285468',
  null,
  null
);
SELECT ok(
  public.admin_set_lecture_status(
    (SELECT lecture_id FROM p66_fixture),
    'start',
    null
  ),
  'six-digit lecture starts through the canonical lifecycle'
);
SELECT ok(
  public.admin_set_lecture_status(
    (SELECT legacy_lecture_id FROM p66_fixture),
    'start',
    null
  ),
  'legacy-code lecture still starts'
);
SELECT ok(
  public.admin_set_lecture_status(
    (SELECT duration_lecture_id FROM p66_fixture),
    'start',
    null
  ),
  'Realtime duration fixture starts'
);
SELECT ok(
  public.admin_set_lecture_status(
    (SELECT presence_load_lecture_id FROM p66_fixture),
    'start',
    null
  ),
  'presence load fixture starts'
);
SELECT ok(
  public.admin_set_lecture_status(
    (SELECT codeless_lecture_id FROM p66_fixture),
    'start',
    null
  )
  AND public.admin_set_lecture_status(
    (SELECT codeless_lecture_id FROM p66_fixture),
    'close',
    null
  ),
  'code-less archive fixture reaches the canonical closed state'
);
DELETE FROM public.lecture_admin_codes AS code
USING p66_fixture AS fixture
WHERE code.lecture_session_id = fixture.codeless_lecture_id;
SELECT is(
  (
    SELECT count(*)::integer
    FROM public.claim_lecture_archive_exports(1)
  ),
  0,
  'archive claim skips a legacy closed lecture without an access code'
);
SELECT is(
  (
    SELECT export.status
    FROM public.lecture_archive_exports AS export, p66_fixture AS fixture
    WHERE export.lecture_session_id = fixture.codeless_lecture_id
  ),
  'pending',
  'skipping a code-less lecture does not establish an invisible export lease'
);
SELECT ok(
  (
    SELECT
      lecture.status = 'open'
      AND lecture.hard_stop_at <= lecture.started_at + interval '90 minutes'
    FROM public.lecture_sessions AS lecture, p66_fixture
    WHERE lecture.id = p66_fixture.lecture_id
  ),
  'new-code lecture retains the server-authoritative 90-minute lifecycle'
);

SELECT lives_ok(
  $$
    SELECT public.admin_register_pdf_document(
      (SELECT lecture_id FROM p66_fixture),
      'p66-material',
      repeat('a', 64),
      1,
      'Phase 6.6 reviewed material',
      3,
      3000,
      300,
      repeat('a', 64),
      repeat('b', 64),
      true
    )
  $$,
  'material publication fixture registers content-free PDF metadata'
);

RESET ROLE;
WITH usage AS (
  INSERT INTO public.ai_usage_ledger (
    lecture_session_id,
    feature,
    idempotency_key,
    status,
    requested_by_actor,
    model_id,
    result_accepted,
    requested_at,
    finished_at
  )
  SELECT
    lecture_id,
    'material_analysis',
    'p66-reviewed-material',
    'succeeded',
    'admin-session:phase66-fixture',
    'gpt-5-mini',
    true,
    statement_timestamp(),
    statement_timestamp()
  FROM p66_fixture
  RETURNING id, lecture_session_id
), context AS (
  INSERT INTO public.material_ai_operation_contexts (
    operation_id,
    lecture_session_id,
    feature,
    source_document_id,
    source_document_version,
    source_text_sha256,
    prompt_version,
    model_id,
    input_price_microusd_per_million,
    output_price_microusd_per_million,
    max_output_tokens,
    result_committed_at
  )
  SELECT
    usage.id,
    usage.lecture_session_id,
    'material_analysis',
    'p66-material',
    repeat('a', 64),
    repeat('b', 64),
    'phase66-material-fixture-v1',
    'gpt-5-mini',
    0,
    0,
    1000,
    statement_timestamp()
  FROM usage
  RETURNING operation_id, lecture_session_id
), analysis AS (
  INSERT INTO public.lecture_material_analyses (
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
  )
  SELECT
    context.lecture_session_id,
    context.operation_id,
    'p66-material',
    repeat('a', 64),
    repeat('b', 64),
    'phase66-material-fixture-v1',
    'gpt-5-mini',
    0,
    0,
    jsonb_build_array(jsonb_build_object(
      'pageStart', 1,
      'pageEnd', 3,
      'title', 'Reviewed source'
    )),
    'Admin-only source analysis.',
    jsonb_build_array(jsonb_build_object(
      'term', 'evidence',
      'definition', 'supporting information'
    )),
    ARRAY[1, 2, 3],
    jsonb_build_array(jsonb_build_object(
      'pageStart', 1,
      'pageEnd', 3,
      'title', 'Reviewed source',
      'rationale', 'One compact fixture section.'
    ))
  FROM context
  RETURNING id
)
UPDATE p66_fixture
SET material_analysis_id = analysis.id
FROM analysis;

INSERT INTO public.participants (
  lecture_session_id,
  auth_user_id,
  participant_key,
  last_seen_at
)
SELECT
  fixture.presence_load_lecture_id,
  extensions.gen_random_uuid(),
  'p66-load-participant-' || lpad(item::text, 3, '0'),
  statement_timestamp()
FROM p66_fixture AS fixture
CROSS JOIN generate_series(1, 300) AS item;

INSERT INTO public.lecture_participant_presence (
  lecture_session_id,
  participant_id,
  last_seen_at
)
SELECT
  participant.lecture_session_id,
  participant.id,
  statement_timestamp()
FROM public.participants AS participant, p66_fixture AS fixture
WHERE participant.lecture_session_id = fixture.presence_load_lecture_id;

SELECT is(
  (
    SELECT active.active_count
    FROM p66_fixture AS fixture
    CROSS JOIN LATERAL private.phase66_active_participant_count(
      fixture.presence_load_lecture_id,
      statement_timestamp()
    ) AS active
  ),
  300::bigint,
  'indexed active-presence aggregation handles the 300-student target'
);

WITH inserted_participant AS (
  INSERT INTO public.participants (
    lecture_session_id,
    auth_user_id,
    participant_key,
    last_seen_at
  )
  SELECT
    presence_load_lecture_id,
    extensions.gen_random_uuid(),
    'p66-insert-invalidation',
    statement_timestamp()
  FROM p66_fixture
  RETURNING id, lecture_session_id
)
INSERT INTO public.lecture_participant_presence (
  lecture_session_id,
  participant_id,
  last_seen_at
)
SELECT lecture_session_id, id, statement_timestamp()
FROM inserted_participant;
SELECT is(
  (
    SELECT active.active_count
    FROM p66_fixture AS fixture
    CROSS JOIN LATERAL private.phase66_active_participant_count(
      fixture.presence_load_lecture_id,
      statement_timestamp()
    ) AS active
  ),
  301::bigint,
  'a first presence INSERT invalidates the current 15-second cache bucket'
);
DELETE FROM public.participants AS participant
USING p66_fixture AS fixture
WHERE participant.lecture_session_id = fixture.presence_load_lecture_id
  AND participant.participant_key = 'p66-insert-invalidation';

WITH ranked_presence AS (
  SELECT
    presence.lecture_session_id,
    presence.participant_id,
    row_number() over (order by presence.participant_id) AS row_number
  FROM public.lecture_participant_presence AS presence, p66_fixture AS fixture
  WHERE presence.lecture_session_id = fixture.presence_load_lecture_id
)
UPDATE public.lecture_participant_presence AS presence
SET last_seen_at = statement_timestamp() - interval '91 seconds'
FROM ranked_presence
WHERE presence.lecture_session_id = ranked_presence.lecture_session_id
  AND presence.participant_id = ranked_presence.participant_id
  AND ranked_presence.row_number <= 150;

UPDATE public.lecture_presence_metrics AS metrics
SET bucket_started_at = 'epoch'::timestamptz
FROM p66_fixture AS fixture
WHERE metrics.lecture_session_id = fixture.presence_load_lecture_id;

SELECT is(
  (
    SELECT active.active_count
    FROM p66_fixture AS fixture
    CROSS JOIN LATERAL private.phase66_active_participant_count(
      fixture.presence_load_lecture_id,
      statement_timestamp()
    ) AS active
  ),
  150::bigint,
  'participants naturally leave the active count after the 90-second TTL'
);

-- Realtime selected-duration enforcement is independent of client clocks.
RESET ROLE;
UPDATE public.lecture_ai_control AS control
SET
  captions_enabled = true,
  status = 'running',
  active_operation_count = 1,
  audio_seconds_used = 600,
  updated_at = statement_timestamp()
FROM p66_fixture AS fixture
WHERE control.lecture_session_id = fixture.duration_lecture_id;
WITH operation AS (
  INSERT INTO public.ai_usage_ledger (
    lecture_session_id,
    feature,
    idempotency_key,
    status,
    requested_by_actor,
    reserved_audio_seconds,
    requested_at,
    last_heartbeat_at
  )
  SELECT
    duration_lecture_id,
    'captions',
    'p66-duration-before',
    'running',
    'phase66-duration-admin',
    600,
    statement_timestamp(),
    statement_timestamp()
  FROM p66_fixture
  RETURNING id
)
UPDATE p66_fixture
SET caption_operation_id = operation.id
FROM operation;

SET LOCAL ROLE service_role;
SELECT is(
  public.admin_heartbeat_realtime_caption_operation(
    (SELECT caption_operation_id FROM p66_fixture),
    'phase66-duration-admin'
  ) ->> 'should_stop',
  'false',
  'Realtime heartbeat remains allowed before the selected duration'
);
SELECT ok(
  (
    SELECT
      (heartbeat.payload ->> 'reserved_until')::timestamptz
        > (heartbeat.payload ->> 'server_time')::timestamptz
    FROM (
      SELECT public.admin_heartbeat_realtime_caption_operation(
        caption_operation_id,
        'phase66-duration-admin'
      ) AS payload
      FROM p66_fixture
    ) AS heartbeat
  ),
  'heartbeat returns a server-derived future duration deadline'
);
SELECT ok(
  (
    public.admin_finish_realtime_caption_operation(
      (SELECT caption_operation_id FROM p66_fixture),
      'phase66-duration-admin',
      'phase66_test_cleanup',
      false,
      false
    ) ->> 'accepted'
  )::boolean,
  'pre-deadline duration fixture stops cleanly'
);

RESET ROLE;
UPDATE public.lecture_ai_control AS control
SET
  captions_enabled = true,
  status = 'running',
  active_operation_count = 1,
  audio_seconds_used = 0,
  updated_at = statement_timestamp()
FROM p66_fixture AS fixture
WHERE control.lecture_session_id = fixture.duration_lecture_id;
WITH operation AS (
  INSERT INTO public.ai_usage_ledger (
    lecture_session_id,
    feature,
    idempotency_key,
    status,
    requested_by_actor,
    reserved_audio_seconds,
    requested_at,
    last_heartbeat_at
  )
  SELECT
    duration_lecture_id,
    'captions',
    'p66-duration-boundary',
    'running',
    'phase66-duration-admin',
    0,
    statement_timestamp(),
    statement_timestamp()
  FROM p66_fixture
  RETURNING id
)
UPDATE p66_fixture
SET caption_operation_id = operation.id
FROM operation;

SET LOCAL ROLE service_role;
SELECT is(
  public.admin_heartbeat_realtime_caption_operation(
    (SELECT caption_operation_id FROM p66_fixture),
    'phase66-duration-admin'
  ) ->> 'reason',
  'selected_duration_elapsed',
  'Realtime heartbeat stops at the selected-duration boundary'
);
SELECT ok(
  (
    SELECT
      usage.status = 'cancelled'
      AND usage.error_code = 'selected_duration_elapsed'
      AND usage.actual_audio_seconds = 0
    FROM public.ai_usage_ledger AS usage, p66_fixture AS fixture
    WHERE usage.id = fixture.caption_operation_id
  ),
  'boundary stop is persisted once with bounded actual audio'
);
SELECT is(
  public.admin_heartbeat_realtime_caption_operation(
    (SELECT caption_operation_id FROM p66_fixture),
    'phase66-duration-admin'
  ) ->> 'reason',
  'selected_duration_elapsed',
  'duration-stop heartbeat retry is idempotent'
);

RESET ROLE;
UPDATE public.lecture_ai_control AS control
SET
  captions_enabled = true,
  status = 'running',
  active_operation_count = 1,
  audio_seconds_used = 60,
  updated_at = statement_timestamp()
FROM p66_fixture AS fixture
WHERE control.lecture_session_id = fixture.duration_lecture_id;
WITH operation AS (
  INSERT INTO public.ai_usage_ledger (
    lecture_session_id,
    feature,
    idempotency_key,
    status,
    requested_by_actor,
    reserved_audio_seconds,
    requested_at,
    last_heartbeat_at
  )
  SELECT
    duration_lecture_id,
    'captions',
    'p66-duration-publish',
    'running',
    'phase66-duration-admin',
    60,
    statement_timestamp() - interval '61 seconds',
    statement_timestamp()
  FROM p66_fixture
  RETURNING id
)
UPDATE p66_fixture
SET caption_operation_id = operation.id
FROM operation;

SET LOCAL ROLE service_role;
SELECT is(
  public.admin_publish_lecture_caption(
    (SELECT duration_lecture_id FROM p66_fixture),
    (SELECT caption_operation_id FROM p66_fixture),
    'This late caption must not be published.',
    'en',
    'p66-late-item',
    1,
    'phase66-duration-admin'
  ) ->> 'accepted',
  'false',
  'caption publication is rejected after the selected duration'
);
SELECT ok(
  (
    SELECT
      usage.status = 'cancelled'
      AND usage.error_code = 'selected_duration_elapsed'
      AND NOT EXISTS (
        SELECT 1
        FROM public.lecture_public_captions AS caption
        WHERE caption.lecture_session_id = fixture.duration_lecture_id
      )
    FROM public.ai_usage_ledger AS usage, p66_fixture AS fixture
    WHERE usage.id = fixture.caption_operation_id
  ),
  'overdue caption rejection persists the stop and publishes no student payload'
);

RESET ROLE;
UPDATE public.lecture_ai_control AS control
SET
  captions_enabled = true,
  status = 'running',
  active_operation_count = 1,
  audio_seconds_used = 60,
  updated_at = statement_timestamp()
FROM p66_fixture AS fixture
WHERE control.lecture_session_id = fixture.duration_lecture_id;
WITH operation AS (
  INSERT INTO public.ai_usage_ledger (
    lecture_session_id,
    feature,
    idempotency_key,
    status,
    requested_by_actor,
    reserved_audio_seconds,
    requested_at,
    last_heartbeat_at
  )
  SELECT
    duration_lecture_id,
    'captions',
    'p66-duration-reaper',
    'running',
    'phase66-duration-admin',
    60,
    statement_timestamp() - interval '61 seconds',
    statement_timestamp()
  FROM p66_fixture
  RETURNING id
)
UPDATE p66_fixture
SET caption_operation_id = operation.id
FROM operation;

SET LOCAL ROLE service_role;
SELECT is(
  (
    SELECT count(*)::integer
    FROM public.admin_reap_stale_realtime_caption_operations(
      (SELECT duration_lecture_id FROM p66_fixture),
      20
    )
  ),
  1,
  'server reaper stops an elapsed duration even with a fresh heartbeat'
);
SELECT is(
  (
    SELECT error_code
    FROM public.ai_usage_ledger AS usage, p66_fixture AS fixture
    WHERE usage.id = fixture.caption_operation_id
  ),
  'selected_duration_elapsed',
  'background duration stop records the canonical reason'
);

SET LOCAL ROLE authenticated;
SELECT set_config(
  'request.jwt.claim.sub',
  '46600000-0000-4000-8000-000000000001',
  true
);
UPDATE p66_fixture
SET participant_a = (
  SELECT participant_id
  FROM public.join_lecture_by_code_v2('285463')
);
SELECT ok(
  (SELECT participant_a IS NOT NULL FROM p66_fixture),
  'student A joins by the new six-digit code'
);
SELECT ok(
  (
    SELECT public.get_lecture_public_snapshot_v5(
      fixture.lecture_id
    ) IS NOT NULL
    FROM p66_fixture AS fixture
  ),
  'student A snapshot creates its server-owned presence heartbeat'
);
RESET ROLE;
UPDATE p66_fixture AS fixture
SET participant_presence_before = presence.last_seen_at
FROM public.lecture_participant_presence AS presence
WHERE presence.lecture_session_id = fixture.lecture_id
  AND presence.participant_id = fixture.participant_a;
SET LOCAL ROLE authenticated;
SELECT set_config(
  'request.jwt.claim.sub',
  '46600000-0000-4000-8000-000000000001',
  true
);
SELECT ok(
  (
    SELECT public.get_lecture_public_snapshot_v5(
      fixture.lecture_id
    ) IS NOT NULL
    FROM p66_fixture AS fixture
  ),
  'student A can immediately retry the snapshot'
);
RESET ROLE;
SELECT is(
  (
    SELECT presence.last_seen_at
    FROM public.lecture_participant_presence AS presence, p66_fixture AS fixture
    WHERE presence.lecture_session_id = fixture.lecture_id
      AND presence.participant_id = fixture.participant_a
  ),
  (SELECT participant_presence_before FROM p66_fixture),
  'five-second snapshots are write-throttled to one heartbeat per 45 seconds'
);
SET LOCAL ROLE authenticated;
SELECT set_config(
  'request.jwt.claim.sub',
  '46600000-0000-4000-8000-000000000001',
  true
);
SELECT is(
  (
    SELECT participant_id
    FROM public.join_lecture_by_code_v2('285463')
  ),
  (SELECT participant_a FROM p66_fixture),
  'rejoining is idempotent for the same authenticated user'
);
SET LOCAL ROLE service_role;
SELECT is(
  (
    SELECT participant_count
    FROM public.lecture_live_state AS live, p66_fixture
    WHERE live.lecture_session_id = p66_fixture.lecture_id
  ),
  1::bigint,
  'rejoin does not inflate the cached participant count'
);

SET LOCAL ROLE authenticated;
SELECT set_config(
  'request.jwt.claim.sub',
  '46600000-0000-4000-8000-000000000002',
  true
);
UPDATE p66_fixture
SET participant_b = (
  SELECT participant_id
  FROM public.join_lecture_by_code_v2('285463')
);
RESET ROLE;
UPDATE public.lecture_participant_presence AS presence
SET last_seen_at = statement_timestamp() - interval '91 seconds'
FROM p66_fixture AS fixture
WHERE presence.lecture_session_id = fixture.lecture_id
  AND presence.participant_id = fixture.participant_a;
UPDATE p66_fixture AS fixture
SET participant_presence_before = presence.last_seen_at
FROM public.lecture_participant_presence AS presence
WHERE presence.lecture_session_id = fixture.lecture_id
  AND presence.participant_id = fixture.participant_a;
SET LOCAL ROLE authenticated;
SELECT set_config(
  'request.jwt.claim.sub',
  '46600000-0000-4000-8000-000000000002',
  true
);
SELECT ok(
  (
    SELECT public.get_lecture_public_snapshot_v5(
      fixture.lecture_id
    ) IS NOT NULL
    FROM p66_fixture AS fixture
  ),
  'student B snapshot creates only student B presence'
);
RESET ROLE;
SELECT is(
  (
    SELECT presence.last_seen_at
    FROM public.lecture_participant_presence AS presence, p66_fixture AS fixture
    WHERE presence.lecture_session_id = fixture.lecture_id
      AND presence.participant_id = fixture.participant_a
  ),
  (SELECT participant_presence_before FROM p66_fixture),
  'one participant cannot refresh another participant presence'
);
SELECT ok(
  (
    SELECT presence.last_seen_at >= statement_timestamp() - interval '5 seconds'
    FROM public.lecture_participant_presence AS presence, p66_fixture AS fixture
    WHERE presence.lecture_session_id = fixture.lecture_id
      AND presence.participant_id = fixture.participant_b
  ),
  'student B receives its own recent heartbeat'
);
SET LOCAL ROLE authenticated;
SELECT set_config(
  'request.jwt.claim.sub',
  '46600000-0000-4000-8000-000000000001',
  true
);
SELECT ok(
  (
    SELECT public.get_lecture_public_snapshot_v5(
      fixture.lecture_id
    ) IS NOT NULL
    FROM p66_fixture AS fixture
  ),
  'student A can reactivate only its own expired presence'
);
SET LOCAL ROLE service_role;
SELECT is(
  (
    SELECT participant_count
    FROM public.lecture_live_state AS live, p66_fixture
    WHERE live.lecture_session_id = p66_fixture.lecture_id
  ),
  2::bigint,
  'a second unique join increments the cached participant count once'
);

SET LOCAL ROLE authenticated;
SELECT set_config(
  'request.jwt.claim.sub',
  '46600000-0000-4000-8000-000000000002',
  true
);
SELECT is(
  (
    SELECT count(*)::integer
    FROM generate_series(1, 8) AS attempt
    CROSS JOIN LATERAL public.join_lecture_by_code_v2(
      'INVALID-' || attempt::text
    )
  ),
  0,
  'eight invalid joins all return the same empty response shape'
);
SET LOCAL ROLE service_role;
SELECT ok(
  (
    SELECT
      rate.failed_attempts = 8
      AND rate.locked_until > statement_timestamp()
    FROM public.lecture_join_rate_limits AS rate
    WHERE rate.auth_user_id =
      '46600000-0000-4000-8000-000000000002'::uuid
  ),
  'eight invalid joins create a bounded 15-minute lock'
);
SET LOCAL ROLE authenticated;
SELECT set_config(
  'request.jwt.claim.sub',
  '46600000-0000-4000-8000-000000000002',
  true
);
SELECT is(
  (SELECT count(*)::integer
   FROM public.join_lecture_by_code_v2('285463')),
  0,
  'a valid code is not an oracle while the caller is locked'
);
SELECT is(
  (SELECT count(*)::integer
   FROM public.join_lecture_by_code('285463')),
  0,
  'legacy join RPC cannot bypass the shared brute-force lock'
);

SET LOCAL ROLE service_role;
UPDATE public.lecture_join_rate_limits
SET
  failed_attempts = 0,
  window_started_at = null,
  last_failed_at = null,
  locked_until = null,
  updated_at = statement_timestamp()
WHERE auth_user_id =
  '46600000-0000-4000-8000-000000000002'::uuid;

SET LOCAL ROLE authenticated;
SELECT set_config(
  'request.jwt.claim.sub',
  '46600000-0000-4000-8000-000000000003',
  true
);
SELECT is(
  (SELECT count(*)::integer
   FROM public.join_lecture_by_code('P66-LEGACY')),
  1,
  'the original join RPC remains compatible with legacy codes'
);
SELECT set_config(
  'request.jwt.claim.sub',
  '46600000-0000-4000-8000-000000000004',
  true
);
SELECT is(
  (SELECT count(*)::integer
   FROM public.join_lecture_by_code_v2('P66-LEGACY')),
  1,
  'join v2 also accepts already-issued legacy codes'
);

SELECT set_config(
  'request.jwt.claim.sub',
  '46600000-0000-4000-8000-000000000001',
  true
);
WITH inserted AS (
  INSERT INTO public.comments (
    lecture_session_id,
    participant_id,
    body
  )
  SELECT lecture_id, participant_a, 'Visible Phase 6.6 comment'
  FROM p66_fixture
  RETURNING id
)
UPDATE p66_fixture
SET visible_comment_id = inserted.id
FROM inserted;
SET LOCAL ROLE service_role;
SELECT is(
  (
    SELECT visible_comment_count
    FROM public.lecture_live_state AS live, p66_fixture
    WHERE live.lecture_session_id = p66_fixture.lecture_id
  ),
  1::bigint,
  'visible comment insertion updates the cached count'
);

RESET ROLE;
UPDATE p66_fixture
SET
  metrics_before_hidden = live.metrics_version,
  visible_comments_version_before = live.visible_comments_version
FROM public.lecture_live_state AS live
WHERE live.lecture_session_id = p66_fixture.lecture_id;
WITH inserted AS (
  INSERT INTO public.comments (
    lecture_session_id,
    participant_id,
    body,
    status
  )
  SELECT lecture_id, participant_a, 'Initially hidden', 'hidden'
  FROM p66_fixture
  RETURNING id
)
UPDATE p66_fixture
SET hidden_comment_id = inserted.id
FROM inserted;
UPDATE p66_fixture
SET
  metrics_after_hidden = live.metrics_version,
  visible_comments_version_after = live.visible_comments_version
FROM public.lecture_live_state AS live
WHERE live.lecture_session_id = p66_fixture.lecture_id;
SELECT is(
  (SELECT metrics_after_hidden FROM p66_fixture),
  (SELECT metrics_before_hidden FROM p66_fixture),
  'a hidden comment does not create a false visible-count delta'
);
SELECT is(
  (SELECT visible_comments_version_after FROM p66_fixture),
  (SELECT visible_comments_version_before FROM p66_fixture),
  'hidden-only activity does not advance the classroom display version'
);
SELECT is(
  (
    SELECT hidden_comment_count
    FROM public.lecture_live_state AS live, p66_fixture
    WHERE live.lecture_session_id = p66_fixture.lecture_id
  ),
  1::bigint,
  'hidden comment insertion updates the Admin-only cached count'
);
UPDATE p66_fixture AS fixture
SET participant_presence_before = presence.last_seen_at
FROM public.lecture_participant_presence AS presence
WHERE presence.lecture_session_id = fixture.lecture_id
  AND presence.participant_id = fixture.participant_a;
SET LOCAL ROLE service_role;
SELECT is(
  (
    SELECT public.admin_get_lecture_operator_snapshot_v1(
      fixture.lecture_id,
      true
    ) #>> '{mode}'
    FROM p66_fixture AS fixture
  ),
  'live',
  'Admin operator snapshot reads an open lecture without participant ownership'
);
SELECT is(
  (
    SELECT jsonb_array_length(
      public.admin_get_lecture_operator_snapshot_v1(
        fixture.lecture_id,
        true
      ) #> '{snapshot,changed,comments,items}'
    )
    FROM p66_fixture AS fixture
  ),
  2,
  'Admin operator snapshot includes recent visible and hidden comments'
);
SELECT is(
  (
    SELECT jsonb_array_length(
      public.admin_get_lecture_operator_snapshot_v1(
        fixture.lecture_id,
        false
      ) #> '{snapshot,changed,comments,items}'
    )
    FROM p66_fixture AS fixture
  ),
  1,
  'classroom display projection excludes hidden comments'
);
SELECT is(
  (
    SELECT public.admin_get_lecture_operator_snapshot_v1(
      fixture.lecture_id,
      true
    ) #>> '{snapshot,changed,metrics,hidden_comment_count}'
    FROM p66_fixture AS fixture
  ),
  '1',
  'Admin operator metrics expose the cached hidden-comment count'
);
SELECT is(
  (
    SELECT public.admin_get_lecture_operator_snapshot_v1(
      fixture.lecture_id,
      false
    ) #>> '{snapshot,versions,comments}'
    FROM p66_fixture AS fixture
  ),
  (
    SELECT live.visible_comments_version::text
    FROM public.lecture_live_state AS live, p66_fixture AS fixture
    WHERE live.lecture_session_id = fixture.lecture_id
  ),
  'display snapshot exposes only the visible-comments version'
);
SELECT is(
  (
    SELECT public.admin_get_lecture_operator_snapshot_v1(
      fixture.lecture_id,
      true
    ) #>> '{snapshot,versions,comments}'
    FROM p66_fixture AS fixture
  ),
  (
    SELECT live.comments_version::text
    FROM public.lecture_live_state AS live, p66_fixture AS fixture
    WHERE live.lecture_session_id = fixture.lecture_id
  ),
  'Admin snapshot retains the full moderation-aware comment version'
);
SELECT ok(
  (
    SELECT NOT (
      public.admin_get_lecture_operator_snapshot_v1(
        fixture.lecture_id,
        false
      ) #> '{snapshot,changed,metrics}'
    ) ? 'hidden_comment_count'
    FROM p66_fixture AS fixture
  ),
  'classroom display metrics do not expose hidden-comment count'
);
SELECT is(
  (
    SELECT jsonb_array_length(
      public.admin_get_lecture_operator_comment_history_v1(
        fixture.lecture_id,
        '9999-12-31 23:59:59+00'::timestamptz,
        'ffffffff-ffff-4fff-bfff-ffffffffffff'::uuid,
        50
      ) -> 'items'
    )
    FROM p66_fixture AS fixture
  ),
  2,
  'explicit Admin history can retrieve visible and hidden comments'
);
SELECT is(
  (
    SELECT public.admin_get_lecture_operator_comment_history_v1(
      fixture.lecture_id,
      '9999-12-31 23:59:59+00'::timestamptz,
      'ffffffff-ffff-4fff-bfff-ffffffffffff'::uuid,
      50
    ) ->> 'contract_version'
    FROM p66_fixture AS fixture
  ),
  '2',
  'operator history uses the declared v2 repository contract'
);
RESET ROLE;
SELECT is(
  (
    SELECT presence.last_seen_at
    FROM public.lecture_participant_presence AS presence, p66_fixture AS fixture
    WHERE presence.lecture_session_id = fixture.lecture_id
      AND presence.participant_id = fixture.participant_a
  ),
  (SELECT participant_presence_before FROM p66_fixture),
  'operator snapshots never write or refresh participant presence'
);
UPDATE public.comments AS comment
SET status = 'visible'
FROM p66_fixture
WHERE comment.id = p66_fixture.hidden_comment_id;
SELECT is(
  (
    SELECT visible_comment_count
    FROM public.lecture_live_state AS live, p66_fixture
    WHERE live.lecture_session_id = p66_fixture.lecture_id
  ),
  2::bigint,
  'making a hidden comment visible increments the cached count'
);
UPDATE p66_fixture
SET metrics_before_hidden = live.metrics_version
FROM public.lecture_live_state AS live
WHERE live.lecture_session_id = p66_fixture.lecture_id;
UPDATE public.comments AS comment
SET body = 'Visible text edit'
FROM p66_fixture
WHERE comment.id = p66_fixture.visible_comment_id;
SELECT is(
  (
    SELECT metrics_version
    FROM public.lecture_live_state AS live, p66_fixture
    WHERE live.lecture_session_id = p66_fixture.lecture_id
  ),
  (SELECT metrics_before_hidden FROM p66_fixture),
  'editing visible text does not create a false count delta'
);
UPDATE public.comments AS comment
SET status = 'deleted'
FROM p66_fixture
WHERE comment.id = p66_fixture.hidden_comment_id;
SELECT is(
  (
    SELECT visible_comment_count
    FROM public.lecture_live_state AS live, p66_fixture
    WHERE live.lecture_session_id = p66_fixture.lecture_id
  ),
  1::bigint,
  'soft deletion decrements the cached visible count'
);

SET LOCAL ROLE authenticated;
SELECT set_config(
  'request.jwt.claim.sub',
  '46600000-0000-4000-8000-000000000001',
  true
);
INSERT INTO public.comments (
  lecture_session_id,
  participant_id,
  body
)
SELECT
  fixture.lecture_id,
  fixture.participant_a,
  'Bounded snapshot comment ' || item::text
FROM p66_fixture AS fixture
CROSS JOIN generate_series(1, 30) AS item;
SELECT is(
  (
    SELECT
      public.get_lecture_public_snapshot_v5(
        fixture.lecture_id,
        comment_limit => 50
      ) #>> '{changed,metrics,participant_count_approximate}'
    FROM p66_fixture AS fixture
  ),
  '2',
  'v5 snapshot returns the active 90-second participant count'
);
SELECT is(
  (
    SELECT
      public.get_lecture_public_snapshot_v5(
        fixture.lecture_id,
        comment_limit => 50
      ) #>> '{changed,metrics,participant_count_mode}'
    FROM p66_fixture AS fixture
  ),
  'active_90s',
  'student metrics identify the bounded active-presence mode'
);
SELECT is(
  (
    SELECT
      public.get_lecture_public_snapshot_v5(
        fixture.lecture_id,
        comment_limit => 50
      ) #>> '{changed,metrics,visible_comment_count}'
    FROM p66_fixture AS fixture
  ),
  (
    SELECT '31'::text
  ),
  'v5 snapshot returns the trigger-maintained visible-comment count'
);
SELECT is(
  (
    SELECT jsonb_array_length(
      public.get_lecture_public_snapshot_v5(
        fixture.lecture_id,
        comment_limit => 50
      ) #> '{changed,comments,items}'
    )
    FROM p66_fixture AS fixture
  ),
  25,
  'v5 snapshot caps the live comment transport payload at twenty-five items'
);
SELECT ok(
  (
    WITH first_snapshot AS (
      SELECT public.get_lecture_public_snapshot_v5(
        fixture.lecture_id
      ) AS payload
      FROM p66_fixture AS fixture
    )
    SELECT (
      public.get_lecture_public_snapshot_v5(
        fixture.lecture_id,
        known_metrics_version =>
          (first_snapshot.payload #>> '{versions,metrics}')::bigint
      ) -> 'changed'
    ) ? 'metrics'
    FROM p66_fixture AS fixture
    CROSS JOIN first_snapshot
  ),
  'metrics are returned every snapshot so TTL expiry converges without writes'
);

RESET ROLE;
UPDATE public.lecture_participant_presence AS presence
SET last_seen_at = statement_timestamp() - interval '91 seconds'
FROM p66_fixture AS fixture
WHERE presence.lecture_session_id = fixture.lecture_id
  AND presence.participant_id = fixture.participant_b;
UPDATE public.lecture_presence_metrics AS metrics
SET bucket_started_at = 'epoch'::timestamptz
FROM p66_fixture AS fixture
WHERE metrics.lecture_session_id = fixture.lecture_id;
SET LOCAL ROLE authenticated;
SELECT set_config(
  'request.jwt.claim.sub',
  '46600000-0000-4000-8000-000000000001',
  true
);
SELECT is(
  (
    SELECT public.get_lecture_public_snapshot_v5(
      fixture.lecture_id
    ) #>> '{changed,metrics,participant_count_approximate}'
    FROM p66_fixture AS fixture
  ),
  '1',
  'expired student B naturally leaves the approximate active count'
);

SELECT throws_ok(
  $$SELECT * FROM public.lecture_material_summary_publications$$,
  '42501',
  null,
  'student browser cannot directly read material publication rows'
);
SELECT ok(
  (
    SELECT
      snapshot.payload -> 'changed' ? 'material_summary'
      AND snapshot.payload #> '{changed,material_summary}' = 'null'::jsonb
    FROM (
      SELECT public.get_lecture_public_snapshot_v5(
        fixture.lecture_id
      ) AS payload
      FROM p66_fixture AS fixture
    ) AS snapshot
  ),
  'initial summaries delta explicitly reports no reviewed material summary'
);

SET LOCAL ROLE service_role;
SELECT throws_ok(
  $$
    SELECT public.admin_set_material_summary_publication(
      '46600000-0000-4000-8000-000000000066'::uuid,
      legacy_lecture_id,
      material_analysis_id,
      'public',
      '{
        "lead":"A reviewed lead.",
        "points":[{
          "pageLabel":"P.1",
          "title":"First point",
          "detail":"Evidence-grounded detail."
        }],
        "reflectionQuestion":""
      }'::jsonb,
      'admin_confirmed'
    )
    FROM p66_fixture
  $$,
  'P0002',
  'material analysis not found',
  'an analysis cannot be published for a different lecture'
);
SELECT throws_ok(
  $$
    SELECT public.admin_set_material_summary_publication(
      '46600000-0000-4000-8000-000000000066'::uuid,
      lecture_id,
      material_analysis_id,
      'public',
      '{"lead":"No bounded points.","points":[]}'::jsonb,
      'admin_confirmed'
    )
    FROM p66_fixture
  $$,
  '22023',
  'invalid reviewed material summary',
  'publication rejects an invalid reviewed body'
);
SELECT throws_ok(
  $$
    SELECT public.admin_set_material_summary_publication(
      '46600000-0000-4000-8000-000000000066'::uuid,
      lecture_id,
      material_analysis_id,
      'public',
      jsonb_build_object(
        'lead', repeat('x', 1201),
        'points', jsonb_build_array(jsonb_build_object(
          'pageLabel', 'P.1',
          'title', 'Bounded title',
          'detail', 'Bounded detail'
        ))
      ),
      'admin_confirmed'
    )
    FROM p66_fixture
  $$,
  '22023',
  'invalid reviewed material summary',
  'publication enforces the 1200-character reviewed lead limit'
);

UPDATE p66_fixture AS fixture
SET summaries_version_before = live.summaries_version
FROM public.lecture_live_state AS live
WHERE live.lecture_session_id = fixture.lecture_id;
UPDATE p66_fixture AS fixture
SET material_summary_version = (
  public.admin_set_material_summary_publication(
    '46600000-0000-4000-8000-000000000066'::uuid,
    fixture.lecture_id,
    fixture.material_analysis_id,
    'public',
    '{
      "lead":"  Three evidence-grounded takeaways.  ",
      "points":[{
        "pageLabel":" P.1 ",
        "title":" First point ",
        "detail":" Evidence-grounded detail. "
      }],
      "reflectionQuestion":"  What would change your interpretation?  "
    }'::jsonb,
    'admin_confirmed'
  ) ->> 'version'
)::bigint;
SELECT is(
  (SELECT material_summary_version FROM p66_fixture),
  1::bigint,
  'first teacher-confirmed publication creates version one'
);
SELECT is(
  (
    SELECT live.summaries_version
    FROM public.lecture_live_state AS live, p66_fixture AS fixture
    WHERE live.lecture_session_id = fixture.lecture_id
  ),
  (SELECT summaries_version_before + 1 FROM p66_fixture),
  'first public material summary bumps the shared summaries version once'
);
SET LOCAL ROLE authenticated;
SELECT is(
  (
    SELECT public.get_lecture_public_snapshot_v5(
      fixture.lecture_id,
      known_summaries_version => fixture.summaries_version_before
    ) #>> '{changed,material_summary,body,lead}'
    FROM p66_fixture AS fixture
  ),
  'Three evidence-grounded takeaways.',
  'v5 snapshot exposes only the normalized reviewed material body'
);
SELECT is(
  (
    SELECT public.get_lecture_public_snapshot_v5(
      fixture.lecture_id,
      known_summaries_version => fixture.summaries_version_before
    ) #>> '{changed,material_summary,review_state}'
    FROM p66_fixture AS fixture
  ),
  'admin_confirmed',
  'student snapshot carries the explicit teacher review state'
);
SET LOCAL ROLE service_role;
SELECT is(
  (
    SELECT public.admin_list_material_ai_results(fixture.lecture_id)
      #>> '{publication,visibility}'
    FROM p66_fixture AS fixture
  ),
  'public',
  'Admin material results include current publication state'
);

UPDATE p66_fixture AS fixture
SET summaries_version_before = live.summaries_version
FROM public.lecture_live_state AS live
WHERE live.lecture_session_id = fixture.lecture_id;
SELECT is(
  (
    SELECT public.admin_set_material_summary_publication(
      '46600000-0000-4000-8000-000000000066'::uuid,
      fixture.lecture_id,
      fixture.material_analysis_id,
      'public',
      '{
        "lead":"Three evidence-grounded takeaways.",
        "points":[{
          "pageLabel":"P.1",
          "title":"First point",
          "detail":"Evidence-grounded detail."
        }],
        "reflectionQuestion":"What would change your interpretation?"
      }'::jsonb,
      'admin_confirmed'
    ) ->> 'version'
    FROM p66_fixture AS fixture
  ),
  '1',
  'identical publication retry returns the existing version'
);
SELECT is(
  (
    SELECT live.summaries_version
    FROM public.lecture_live_state AS live, p66_fixture AS fixture
    WHERE live.lecture_session_id = fixture.lecture_id
  ),
  (SELECT summaries_version_before FROM p66_fixture),
  'identical publication retry does not create a false live delta'
);

UPDATE p66_fixture AS fixture
SET summaries_version_before = live.summaries_version
FROM public.lecture_live_state AS live
WHERE live.lecture_session_id = fixture.lecture_id;
SELECT is(
  (
    SELECT public.admin_set_material_summary_publication(
      '46600000-0000-4000-8000-000000000066'::uuid,
      fixture.lecture_id,
      fixture.material_analysis_id,
      'public',
      '{
        "lead":"Teacher-revised takeaways.",
        "points":[
          {
            "pageLabel":"P.1",
            "title":"Evidence",
            "detail":"Read the primary result before the interpretation."
          },
          {
            "pageLabel":"P.3",
            "title":"Limitation",
            "detail":"The study boundary constrains generalization."
          }
        ],
        "reflectionQuestion":"Which limitation matters most?"
      }'::jsonb,
      'admin_revised'
    ) ->> 'version'
    FROM p66_fixture AS fixture
  ),
  '2',
  'teacher revision creates the next publication version'
);
SELECT is(
  (
    SELECT live.summaries_version
    FROM public.lecture_live_state AS live, p66_fixture AS fixture
    WHERE live.lecture_session_id = fixture.lecture_id
  ),
  (SELECT summaries_version_before + 1 FROM p66_fixture),
  'teacher revision creates one summaries delta'
);

UPDATE p66_fixture AS fixture
SET summaries_version_before = live.summaries_version
FROM public.lecture_live_state AS live
WHERE live.lecture_session_id = fixture.lecture_id;
SELECT is(
  (
    SELECT public.admin_set_material_summary_publication(
      '46600000-0000-4000-8000-000000000066'::uuid,
      fixture.lecture_id,
      fixture.material_analysis_id,
      'hidden',
      null,
      null
    ) ->> 'version'
    FROM p66_fixture AS fixture
  ),
  '3',
  'hiding a public material summary creates the next version'
);
SET LOCAL ROLE authenticated;
SELECT ok(
  (
    SELECT
      snapshot.payload -> 'changed' ? 'material_summary'
      AND snapshot.payload #> '{changed,material_summary}' = 'null'::jsonb
    FROM (
      SELECT public.get_lecture_public_snapshot_v5(
        fixture.lecture_id,
        known_summaries_version => fixture.summaries_version_before
      ) AS payload
      FROM p66_fixture AS fixture
    ) AS snapshot
  ),
  'hidden material summary is explicitly removed from the student delta'
);
SET LOCAL ROLE service_role;
SELECT is(
  (
    SELECT public.admin_list_material_ai_results(fixture.lecture_id)
      #>> '{publication,visibility}'
    FROM p66_fixture AS fixture
  ),
  'hidden',
  'Admin can still review hidden publication metadata'
);

UPDATE p66_fixture AS fixture
SET summaries_version_before = live.summaries_version
FROM public.lecture_live_state AS live
WHERE live.lecture_session_id = fixture.lecture_id;
SELECT is(
  (
    SELECT public.admin_set_material_summary_publication(
      '46600000-0000-4000-8000-000000000066'::uuid,
      fixture.lecture_id,
      fixture.material_analysis_id,
      'hidden',
      null,
      null
    ) ->> 'version'
    FROM p66_fixture AS fixture
  ),
  '3',
  'hide retry is idempotent'
);
SELECT is(
  (
    SELECT live.summaries_version
    FROM public.lecture_live_state AS live, p66_fixture AS fixture
    WHERE live.lecture_session_id = fixture.lecture_id
  ),
  (SELECT summaries_version_before FROM p66_fixture),
  'hide retry does not create a false live delta'
);

SELECT is(
  (
    SELECT public.admin_set_material_summary_publication(
      '46600000-0000-4000-8000-000000000066'::uuid,
      fixture.lecture_id,
      fixture.material_analysis_id,
      'public',
      '{
        "lead":"Teacher-revised takeaways.",
        "points":[
          {
            "pageLabel":"P.1",
            "title":"Evidence",
            "detail":"Read the primary result before the interpretation."
          },
          {
            "pageLabel":"P.3",
            "title":"Limitation",
            "detail":"The study boundary constrains generalization."
          }
        ],
        "reflectionQuestion":"Which limitation matters most?"
      }'::jsonb,
      'admin_revised'
    ) ->> 'version'
    FROM p66_fixture AS fixture
  ),
  '4',
  'teacher can republish the reviewed material summary'
);

SET LOCAL ROLE service_role;
UPDATE p66_fixture
SET poll_a = public.admin_create_poll(
  lecture_id,
  'First Phase 6.6 Poll?',
  'single',
  ARRAY['A', 'B']
);
UPDATE p66_fixture
SET poll_b = public.admin_create_poll(
  lecture_id,
  'Second Phase 6.6 Poll?',
  'single',
  ARRAY['C', 'D']
);
SELECT ok(
  public.admin_set_poll_status(
    (SELECT lecture_id FROM p66_fixture),
    (SELECT poll_a FROM p66_fixture),
    'open'
  ),
  'the first Poll opens'
);
SELECT ok(
  NOT public.admin_set_poll_status(
    (SELECT lecture_id FROM p66_fixture),
    (SELECT poll_a FROM p66_fixture),
    'open'
  ),
  'reopening the already-open Poll preserves the legacy false result'
);
SELECT ok(
  public.admin_set_poll_status(
    (SELECT lecture_id FROM p66_fixture),
    (SELECT poll_b FROM p66_fixture),
    'open'
  ),
  'opening a second Poll atomically closes the first'
);
SELECT is(
  (
    SELECT count(*)::integer
    FROM public.polls AS poll, p66_fixture AS fixture
    WHERE poll.lecture_session_id = fixture.lecture_id
      AND poll.status = 'open'
  ),
  1,
  'exactly one Poll remains open'
);
SELECT is(
  (
    SELECT status
    FROM public.polls AS poll, p66_fixture AS fixture
    WHERE poll.id = fixture.poll_a
  ),
  'closed',
  'the previously open Poll is closed before the target opens'
);
SELECT throws_ok(
  $$
    INSERT INTO public.polls (
      lecture_session_id,
      question,
      type,
      status
    )
    SELECT lecture_id, 'Direct conflicting Poll', 'single', 'open'
    FROM p66_fixture
  $$,
  '23505',
  null,
  'the partial unique index rejects a second direct open Poll'
);

SELECT ok(
  public.admin_set_lecture_status(
    (SELECT lecture_id FROM p66_fixture),
    'close',
    null
  ),
  'main lecture closes through the canonical terminal transition'
);
SELECT is(
  (
    SELECT public.admin_get_lecture_operator_snapshot_v1(
      fixture.lecture_id,
      true
    ) #>> '{mode}'
    FROM p66_fixture AS fixture
  ),
  'terminal',
  'operator snapshot converges to terminal after canonical close'
);
SELECT is(
  (
    SELECT public.admin_get_lecture_operator_snapshot_v1(
      fixture.lecture_id,
      false
    ) #>> '{terminal,status}'
    FROM p66_fixture AS fixture
  ),
  'closed',
  'classroom display receives only terminal lifecycle state after close'
);
SELECT is(
  (
    SELECT public.admin_get_lecture_operator_access_v1(
      fixture.lecture_id
    ) #>> '{terminal,status}'
    FROM p66_fixture AS fixture
  ),
  'closed',
  'expired display credentials can resolve only the minimal terminal state'
);
SELECT ok(
  NOT public.admin_set_poll_status(
    (SELECT lecture_id FROM p66_fixture),
    (SELECT poll_a FROM p66_fixture),
    'open'
  ),
  'closed lectures reject Poll reopening'
);
RESET ROLE;
UPDATE public.lecture_participant_presence AS presence
SET last_seen_at = statement_timestamp() - interval '91 seconds'
FROM p66_fixture AS fixture
WHERE presence.lecture_session_id = fixture.lecture_id
  AND presence.participant_id = fixture.participant_a;
UPDATE p66_fixture AS fixture
SET participant_presence_before = presence.last_seen_at
FROM public.lecture_participant_presence AS presence
WHERE presence.lecture_session_id = fixture.lecture_id
  AND presence.participant_id = fixture.participant_a;
SET LOCAL ROLE authenticated;
SELECT set_config(
  'request.jwt.claim.sub',
  '46600000-0000-4000-8000-000000000001',
  true
);
SELECT is(
  (
    SELECT public.get_lecture_public_snapshot_v5(
      fixture.lecture_id
    ) #>> '{changed,metrics,participant_count_approximate}'
    FROM p66_fixture AS fixture
  ),
  '0',
  'closed lecture snapshot reports no active live participants'
);
RESET ROLE;
SELECT is(
  (
    SELECT presence.last_seen_at
    FROM public.lecture_participant_presence AS presence, p66_fixture AS fixture
    WHERE presence.lecture_session_id = fixture.lecture_id
      AND presence.participant_id = fixture.participant_a
  ),
  (SELECT participant_presence_before FROM p66_fixture),
  'closed lectures refuse presence heartbeat refresh'
);
SET LOCAL ROLE authenticated;
SELECT set_config(
  'request.jwt.claim.sub',
  '46600000-0000-4000-8000-000000000005',
  true
);
SELECT is(
  (SELECT count(*)::integer
   FROM public.join_lecture_by_code_v2('285463')),
  0,
  'closed lecture codes use the same empty join response as invalid codes'
);
SET LOCAL ROLE service_role;
SELECT is(
  (
    SELECT archive_expires_at - closed_at
    FROM public.lecture_sessions AS lecture, p66_fixture AS fixture
    WHERE lecture.id = fixture.lecture_id
  ),
  interval '30 days',
  'archive retention starts at canonical close time'
);

SELECT lives_ok(
  $$
    UPDATE p66_fixture
    SET duplicate_lecture_id = public.admin_duplicate_lecture_v1(
      lecture_id,
      encode(
        extensions.digest(convert_to('285464', 'UTF8'), 'sha256'),
        'hex'
      ),
      '285464'
    )
  $$,
  'Admin can duplicate a closed lecture into a fresh draft'
);
SELECT ok(
  (
    SELECT
      duplicate.status = 'draft'
      AND duplicate.title = source.title
      AND duplicate.duplicated_from_lecture_session_id = source.id
    FROM p66_fixture AS fixture
    JOIN public.lecture_sessions AS duplicate
      ON duplicate.id = fixture.duplicate_lecture_id
    JOIN public.lecture_sessions AS source
      ON source.id = fixture.lecture_id
  ),
  'duplicate stores provenance while copying only safe lecture metadata'
);
RESET ROLE;
SELECT is(
  (
    SELECT
      (SELECT count(*) FROM public.participants
       WHERE lecture_session_id = fixture.duplicate_lecture_id)
      + (SELECT count(*) FROM public.comments
         WHERE lecture_session_id = fixture.duplicate_lecture_id)
      + (SELECT count(*) FROM public.polls
         WHERE lecture_session_id = fixture.duplicate_lecture_id)
    FROM p66_fixture AS fixture
  ),
  0::bigint,
  'duplicate does not copy participants, comments, or Polls'
);
SET LOCAL ROLE service_role;
SELECT throws_ok(
  $$
    SELECT public.admin_duplicate_lecture_v1(
      legacy_lecture_id,
      encode(
        extensions.digest(convert_to('285465', 'UTF8'), 'sha256'),
        'hex'
      ),
      '285465'
    )
    FROM p66_fixture
  $$,
  'P0001',
  null,
  'an open lecture cannot be duplicated'
);

RESET ROLE;
SELECT ok(
  (
    SELECT private.build_public_lecture_archive_v1(lecture_id) IS NOT NULL
    FROM p66_fixture
  ),
  'closed lecture produces a sanitized archive payload'
);
SELECT unalike(
  (
    SELECT private.build_public_lecture_archive_v1(lecture_id)::text
    FROM p66_fixture
  ),
  '%participant_id%',
  'archive payload omits participant identity'
);
SELECT unalike(
  (
    SELECT private.build_public_lecture_archive_v1(lecture_id)::text
    FROM p66_fixture
  ),
  '%auth_user_id%',
  'archive payload omits Auth identity'
);
SELECT unalike(
  (
    SELECT private.build_public_lecture_archive_v1(lecture_id)::text
    FROM p66_fixture
  ),
  '%lecture_code%',
  'archive payload omits the lecture lookup code'
);
SELECT ok(
  (
    SELECT
      jsonb_array_length(
        private.build_public_lecture_archive_v1(lecture_id) -> 'comments'
      ) <= 500
      AND jsonb_array_length(
        private.build_public_lecture_archive_v1(lecture_id) -> 'polls'
      ) <= 100
    FROM p66_fixture
  ),
  'archive payload applies bounded comment and Poll limits'
);
SELECT is(
  (
    SELECT private.build_public_lecture_archive_v1(lecture_id)
      #>> '{material_summary,body,lead}'
    FROM p66_fixture
  ),
  'Teacher-revised takeaways.',
  'archive payload contains only the public reviewed material summary'
);

SET LOCAL ROLE service_role;
UPDATE p66_fixture AS fixture
SET archive_source_version = export.source_version
FROM public.lecture_archive_exports AS export
WHERE export.lecture_session_id = fixture.lecture_id;
SELECT is(
  (
    SELECT public.admin_set_material_summary_publication(
      '46600000-0000-4000-8000-000000000066'::uuid,
      fixture.lecture_id,
      fixture.material_analysis_id,
      'hidden',
      null,
      null
    ) ->> 'visibility'
    FROM p66_fixture AS fixture
  ),
  'hidden',
  'reviewed material can be hidden while the retained archive is available'
);
SELECT is(
  (
    SELECT export.source_version
    FROM public.lecture_archive_exports AS export, p66_fixture AS fixture
    WHERE export.lecture_session_id = fixture.lecture_id
  ),
  (SELECT archive_source_version + 1 FROM p66_fixture),
  'archive outbox is regenerated exactly once after material visibility change'
);

RESET ROLE;
SELECT ok(
  (
    SELECT private.build_public_lecture_archive_v1(lecture_id)
      #> '{material_summary}' = 'null'::jsonb
    FROM p66_fixture
  ),
  'hidden material summary is absent from the public archive payload'
);

SET LOCAL ROLE service_role;
UPDATE p66_fixture AS fixture
SET archive_source_version = export.source_version
FROM public.lecture_archive_exports AS export
WHERE export.lecture_session_id = fixture.lecture_id;
SELECT is(
  (
    SELECT public.admin_set_material_summary_publication(
      '46600000-0000-4000-8000-000000000066'::uuid,
      fixture.lecture_id,
      fixture.material_analysis_id,
      'public',
      '{
        "lead":"Teacher-revised takeaways.",
        "points":[
          {
            "pageLabel":"P.1",
            "title":"Evidence",
            "detail":"Read the primary result before the interpretation."
          },
          {
            "pageLabel":"P.3",
            "title":"Limitation",
            "detail":"The study boundary constrains generalization."
          }
        ],
        "reflectionQuestion":"Which limitation matters most?"
      }'::jsonb,
      'admin_revised'
    ) ->> 'version'
    FROM p66_fixture AS fixture
  ),
  '6',
  'retained lecture material can be safely republished'
);
SELECT is(
  (
    SELECT export.source_version
    FROM public.lecture_archive_exports AS export, p66_fixture AS fixture
    WHERE export.lecture_session_id = fixture.lecture_id
  ),
  (SELECT archive_source_version + 1 FROM p66_fixture),
  'republishing also regenerates the archive outbox exactly once'
);

SET LOCAL ROLE service_role;
SELECT is(
  (
    SELECT count(*)::integer
    FROM public.lecture_archive_exports AS export, p66_fixture AS fixture
    WHERE export.lecture_session_id = fixture.lecture_id
  ),
  1,
  'archive requeue uses one idempotent outbox row per lecture'
);
WITH claimed AS (
  SELECT *
  FROM public.claim_lecture_archive_exports(1)
)
UPDATE p66_fixture AS fixture
SET archive_source_version = claimed.source_version
FROM claimed
WHERE claimed.lecture_session_id = fixture.lecture_id;
SELECT ok(
  (
    SELECT
      export.status = 'exporting'
      AND export.lease_until > statement_timestamp()
      AND fixture.archive_source_version = export.source_version
    FROM public.lecture_archive_exports AS export, p66_fixture AS fixture
    WHERE export.lecture_session_id = fixture.lecture_id
  ),
  'archive claim atomically establishes a bounded lease'
);
SELECT throws_ok(
  $$
    SELECT public.finish_lecture_archive_export(
      lecture_id,
      archive_source_version,
      true,
      null,
      null
    )
    FROM p66_fixture
  $$,
  '22023',
  null,
  'successful archive finalization requires a payload hash'
);
SELECT ok(
  NOT public.finish_lecture_archive_export(
    (SELECT lecture_id FROM p66_fixture),
    (SELECT archive_source_version + 1 FROM p66_fixture),
    true,
    repeat('a', 64),
    null
  ),
  'archive finalization rejects an unrelated source version'
);
UPDATE public.lecture_archive_exports AS export
SET lease_until = statement_timestamp() - interval '1 second'
FROM p66_fixture AS fixture
WHERE export.lecture_session_id = fixture.lecture_id;
WITH reclaimed AS (
  SELECT *
  FROM public.claim_lecture_archive_exports(1)
)
UPDATE p66_fixture AS fixture
SET archive_reclaimed_version = reclaimed.source_version
FROM reclaimed
WHERE reclaimed.lecture_session_id = fixture.lecture_id;
SELECT is(
  (SELECT archive_reclaimed_version FROM p66_fixture),
  (SELECT archive_source_version + 1 FROM p66_fixture),
  'claim directly reclaims an expired export lease and fences the old worker'
);
SELECT ok(
  NOT public.finish_lecture_archive_export(
    (SELECT lecture_id FROM p66_fixture),
    (SELECT archive_source_version FROM p66_fixture),
    true,
    repeat('b', 64),
    null
  ),
  'a late abandoned worker cannot finalize the reclaimed job'
);
SELECT ok(
  public.finish_lecture_archive_export(
    (SELECT lecture_id FROM p66_fixture),
    (SELECT archive_reclaimed_version FROM p66_fixture),
    true,
    repeat('c', 64),
    null
  ),
  'the active archive lease can be finalized'
);
SELECT ok(
  NOT public.finish_lecture_archive_export(
    (SELECT lecture_id FROM p66_fixture),
    (SELECT archive_reclaimed_version FROM p66_fixture),
    true,
    repeat('c', 64),
    null
  ),
  'archive finalize replay is idempotently rejected'
);
UPDATE public.lecture_sessions AS lecture
SET title = lecture.title || ' corrected'
FROM p66_fixture AS fixture
WHERE lecture.id = fixture.lecture_id;
SELECT ok(
  (
    SELECT
      export.status = 'pending'
      AND export.source_version > fixture.archive_reclaimed_version
    FROM public.lecture_archive_exports AS export, p66_fixture AS fixture
    WHERE export.lecture_session_id = fixture.lecture_id
  ),
  'a public archive correction safely requeues a newer source version'
);
SELECT is(
  (
    SELECT count(*)::integer
    FROM public.lecture_archive_exports AS export, p66_fixture AS fixture
    WHERE export.lecture_session_id = fixture.lecture_id
  ),
  1,
  'archive correction does not duplicate the outbox row'
);

WITH claimed AS (
  SELECT *
  FROM public.claim_daily_operations_digest_jobs(
    1,
    'phase66@example.test'
  )
)
UPDATE p66_fixture
SET digest_job_id = claimed.id
FROM claimed;
SELECT ok(
  (
    SELECT
      job.status = 'sending'
      AND job.attempt_count = 1
      AND job.digest_date = (
        statement_timestamp() at time zone 'Asia/Tokyo'
      )::date
    FROM public.daily_operations_digest_jobs AS job, p66_fixture AS fixture
    WHERE job.id = fixture.digest_job_id
  ),
  'daily digest claim creates one JST-date delivery job'
);
SELECT is(
  (
    SELECT count(*)::integer
    FROM public.claim_daily_operations_digest_jobs(
      1,
      'phase66@example.test'
    )
  ),
  0,
  'an active digest lease is not double-claimed'
);
SELECT throws_ok(
  $$
    SELECT public.finish_daily_operations_digest_job(
      digest_job_id,
      'sent',
      null,
      null
    )
    FROM p66_fixture
  $$,
  '22023',
  null,
  'sent digest finalization requires a provider message id'
);
SELECT ok(
  public.finish_daily_operations_digest_job(
    (SELECT digest_job_id FROM p66_fixture),
    'skipped',
    null,
    null
  ),
  'an empty-activity digest can finalize as skipped'
);
SELECT ok(
  NOT public.finish_daily_operations_digest_job(
    (SELECT digest_job_id FROM p66_fixture),
    'skipped',
    null,
    null
  ),
  'digest finalize replay is idempotently rejected'
);
SELECT is(
  (
    SELECT count(*)::integer
    FROM public.daily_operations_digest_jobs
    WHERE recipient = 'phase66@example.test'
      AND digest_date = (
        statement_timestamp() at time zone 'Asia/Tokyo'
      )::date
  ),
  1,
  'digest queue remains unique per JST date and normalized recipient'
);

WITH claimed AS (
  SELECT *
  FROM public.claim_daily_operations_digest_jobs(
    1,
    'phase66-retry@example.test'
  )
)
UPDATE p66_fixture
SET digest_retry_job_id = claimed.id
FROM claimed;
UPDATE public.daily_operations_digest_jobs AS job
SET updated_at = statement_timestamp() - interval '16 minutes'
FROM p66_fixture AS fixture
WHERE job.id = fixture.digest_retry_job_id;
WITH reclaimed AS (
  SELECT *
  FROM public.claim_daily_operations_digest_jobs(
    1,
    'phase66-retry@example.test'
  )
)
UPDATE p66_fixture
SET digest_retry_attempt = reclaimed.attempt_count
FROM reclaimed;
SELECT is(
  (SELECT digest_retry_attempt FROM p66_fixture),
  2,
  'digest claim directly reclaims a stale sending lease'
);
SELECT ok(
  public.finish_daily_operations_digest_job(
    (SELECT digest_retry_job_id FROM p66_fixture),
    'failed',
    null,
    'provider unavailable'
  ),
  'digest failure is recorded for bounded retry'
);
SELECT ok(
  (
    SELECT
      job.status = 'failed'
      AND job.next_attempt_at > statement_timestamp()
      AND job.error_message = 'provider unavailable'
    FROM public.daily_operations_digest_jobs AS job, p66_fixture AS fixture
    WHERE job.id = fixture.digest_retry_job_id
  ),
  'failed digest gets a future retry time and bounded error'
);
UPDATE public.daily_operations_digest_jobs AS job
SET next_attempt_at = statement_timestamp() - interval '1 second'
FROM p66_fixture AS fixture
WHERE job.id = fixture.digest_retry_job_id;
SELECT is(
  (
    SELECT attempt_count
    FROM public.claim_daily_operations_digest_jobs(
      1,
      'phase66-retry@example.test'
    )
  ),
  3,
  'failed digest can be safely retried when due'
);
SELECT ok(
  public.finish_daily_operations_digest_job(
    (SELECT digest_retry_job_id FROM p66_fixture),
    'sent',
    'resend-phase66-message',
    null
  ),
  'retried digest can finalize with its provider id'
);

UPDATE public.lecture_join_rate_limits
SET
  updated_at = statement_timestamp() - interval '25 hours',
  locked_until = null
WHERE auth_user_id =
  '46600000-0000-4000-8000-000000000002'::uuid;
UPDATE public.lecture_sessions AS lecture
SET
  starts_at = statement_timestamp() - interval '32 days',
  started_at = statement_timestamp() - interval '32 days',
  closed_at = statement_timestamp() - interval '31 days'
FROM p66_fixture AS fixture
WHERE lecture.id = fixture.lecture_id;
SELECT ok(
  (
    SELECT (public.run_phase6_6_maintenance()
      ->> 'deleted_join_rate_rows')::integer >= 1
  ),
  'maintenance removes old unlocked brute-force state'
);
SELECT is(
  (
    SELECT status
    FROM public.lecture_archive_exports AS export, p66_fixture AS fixture
    WHERE export.lecture_session_id = fixture.lecture_id
  ),
  'expired',
  'archive export becomes ineligible at the 30-day boundary'
);
SELECT is(
  (
    SELECT count(*)::integer
    FROM public.claim_lecture_archive_exports(5) AS claimed, p66_fixture AS fixture
    WHERE claimed.lecture_session_id = fixture.lecture_id
  ),
  0,
  'expired archives cannot be reclaimed or republished'
);

RESET ROLE;
SELECT * FROM finish();
ROLLBACK;
