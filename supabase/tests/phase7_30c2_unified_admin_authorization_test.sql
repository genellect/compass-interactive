BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path = public, extensions;
SELECT no_plan();

SELECT has_column(
  'private', 'admin_identity_runtime_gate',
  'google_operational_authorization_enabled',
  'C2 adds an independent Google operational authorization gate'
);
SELECT is(
  (
    SELECT google_operational_authorization_enabled
    FROM private.admin_identity_runtime_gate
    WHERE singleton
  ),
  false,
  'C2 operational authorization remains default OFF'
);
SELECT has_table(
  'private', 'admin_google_operation_policies',
  'C2 stores its closed operation matrix privately'
);
SELECT has_table(
  'private', 'admin_google_lecture_operation_receipts',
  'C2 stores immutable lecture-operation receipts privately'
);
SELECT has_table(
  'private', 'admin_google_operation_receipts',
  'C2 stores immutable generic operation receipts privately'
);
SELECT is(
  (
    SELECT count(*)::integer
    FROM private.admin_google_operation_policies
    WHERE edge_function <> 'manage-admin-ledger'
  ),
  75,
  'the C2 policy matrix contains exactly 75 approved operations'
);
SELECT is(
  (
    SELECT count(DISTINCT edge_function)::integer
    FROM private.admin_google_operation_policies
    WHERE edge_function <> 'manage-admin-ledger'
  ),
  20,
  'the policy matrix covers exactly 20 operational Admin Edge functions'
);
SELECT is(
  (
    SELECT count(*)::integer
    FROM private.admin_google_lecture_operation_receipts
  ),
  0,
  'the migration fabricates no lecture-operation receipt'
);
SELECT is(
  (
    SELECT count(*)::integer
    FROM private.admin_google_operation_receipts
  ),
  0,
  'the migration fabricates no generic operation receipt'
);

SELECT ok(
  (
    SELECT count(*) = 3 AND bool_and(class.relrowsecurity)
    FROM pg_class AS class
    JOIN pg_namespace AS namespace ON namespace.oid = class.relnamespace
    WHERE namespace.nspname = 'private'
      AND class.relname IN (
        'admin_google_operation_policies',
        'admin_google_lecture_operation_receipts',
        'admin_google_operation_receipts'
      )
  ),
  'all C2 private tables enable defense-in-depth RLS'
);
SELECT ok(
  NOT has_table_privilege(
    'service_role', 'private.admin_google_operation_policies', 'SELECT'
  )
  AND NOT has_table_privilege(
    'service_role',
    'private.admin_google_lecture_operation_receipts',
    'INSERT'
  )
  AND NOT has_table_privilege(
    'anon', 'private.admin_google_operation_policies', 'SELECT'
  )
  AND NOT has_table_privilege(
    'authenticated',
    'private.admin_google_lecture_operation_receipts',
    'SELECT'
  )
  AND NOT has_table_privilege(
    'service_role',
    'private.admin_google_operation_receipts',
    'INSERT'
  )
  AND NOT has_table_privilege(
    'authenticated',
    'private.admin_google_operation_receipts',
    'SELECT'
  ),
  'browser and service roles have no direct C2 policy or receipt access'
);
SELECT ok(
  NOT EXISTS (
    SELECT 1
    FROM pg_constraint AS foreign_key
    WHERE foreign_key.contype = 'f'
      AND foreign_key.conrelid = ANY (
        ARRAY[
          'private.admin_google_lecture_operation_receipts'::regclass,
          'private.admin_google_operation_receipts'::regclass
        ]
      )
      AND NOT EXISTS (
        SELECT 1
        FROM pg_index AS idx
        WHERE idx.indrelid = foreign_key.conrelid
          AND idx.indisvalid
          AND idx.indisready
          AND idx.indpred IS NULL
          AND split_part(idx.indkey::text, ' ', 1)::smallint =
            foreign_key.conkey[1]
      )
  ),
  'every C2 receipt foreign key has a full leading index'
);

SELECT is(
  (
    SELECT access_scope
    FROM private.admin_google_operation_policies
    WHERE operation_key = 'manage-lectures.close'
  ),
  'owned_lecture',
  'ordinary close remains limited to the exact lecture owner'
);
SELECT is(
  (
    SELECT access_scope || ':' || gate_mode || ':' || lecture_state
    FROM private.admin_google_operation_policies
    WHERE operation_key = 'manage-lectures.emergencyStop'
  ),
  'owner_lecture:gate_independent:open_any',
  'owner emergency stop is explicit, free and works for any still-open lecture'
);
SELECT is(
  (
    SELECT control_step_up_action
    FROM private.admin_google_operation_policies
    WHERE operation_key = 'manage-ai-control.configure'
  ),
  'environment_ai_policy_change',
  'AI policy configuration requires the rare five-minute control proof'
);
SELECT is(
  (
    SELECT count(*)::integer
    FROM private.admin_google_operation_policies
    WHERE operation_class <> 'read'
      AND edge_function <> 'manage-admin-ledger'
      AND lecture_lock_mode <> 'update'
  ),
  0,
  'every state-changing Admin operation takes the lecture UPDATE lock before nested RPCs'
);
SELECT is(
  (
    SELECT string_agg(lecture_lock_mode, ':' ORDER BY operation_key)
    FROM private.admin_google_operation_policies
    WHERE operation_key IN (
      'manage-material-analysis.adopt',
      'manage-material-analysis.hideSummary',
      'manage-material-analysis.publishSummary',
      'operator-live-snapshot.commentHistory',
      'operator-live-snapshot.snapshot'
    )
  ),
  'update:update:update:update:update',
  'nested lecture mutations and expiry-reconciling projections use an exclusive lecture lock'
);
SELECT ok(
  EXISTS (
    SELECT 1
    FROM private.admin_google_operation_policies
    WHERE operation_key = 'analyze-lecture-material.material_analysis'
  )
  AND EXISTS (
    SELECT 1
    FROM private.admin_google_operation_policies
    WHERE operation_key = 'analyze-lecture-material.poll_suggestions'
  ),
  'underscore action names satisfy the same closed operation-key contract'
);

CREATE TEMP TABLE c2_internal_functions(name text PRIMARY KEY) ON COMMIT DROP;
INSERT INTO c2_internal_functions(name) VALUES
  ('assert_google_admin_operation_gate_v1'),
  ('assert_google_admin_operation_lecture_state_v1'),
  ('google_admin_operation_intent_digest_v1'),
  ('google_admin_lecture_intent_digest_v1'),
  ('get_google_admin_material_analysis_v1'),
  ('get_google_admin_academic_results_v1'),
  ('get_google_admin_operator_live_snapshot_v1'),
  ('get_google_admin_sessions_v1'),
  ('get_google_admin_summary_results_v1'),
  ('issue_google_admin_pdf_access_claims_v1'),
  ('list_google_admin_polls_v1'),
  ('list_google_admin_lectures_v1'),
  ('list_google_admin_pdf_documents_v1'),
  ('manage_google_admin_comments_v1'),
  ('manage_google_admin_academic_results_v1'),
  ('manage_google_admin_display_state_v1'),
  ('manage_google_admin_lectures_v1'),
  ('manage_google_admin_material_analysis_v1'),
  ('manage_google_admin_pdf_documents_v1'),
  ('manage_google_admin_polls_v1'),
  ('manage_google_admin_sessions_v1'),
  ('manage_google_admin_summary_publication_v1'),
  ('require_google_admin_operation_context_v1');

SELECT is(
  (
    SELECT count(*)::integer
    FROM pg_proc AS procedure
    JOIN pg_namespace AS namespace ON namespace.oid = procedure.pronamespace
    JOIN c2_internal_functions AS expected
      ON expected.name = procedure.proname
    WHERE namespace.nspname = 'private'
  ),
  23,
  'the complete current C2 private function inventory is present'
);
SELECT ok(
  NOT EXISTS (
    SELECT 1
    FROM pg_proc AS procedure
    JOIN pg_namespace AS namespace ON namespace.oid = procedure.pronamespace
    JOIN c2_internal_functions AS expected
      ON expected.name = procedure.proname
    WHERE namespace.nspname = 'private'
      AND (
        has_function_privilege('service_role', procedure.oid, 'EXECUTE')
        OR has_function_privilege('anon', procedure.oid, 'EXECUTE')
        OR has_function_privilege('authenticated', procedure.oid, 'EXECUTE')
        OR EXISTS (
          SELECT 1
          FROM aclexplode(
            coalesce(
              procedure.proacl,
              acldefault('f', procedure.proowner)
            )
          ) AS privilege
          WHERE privilege.grantee = 0
            AND privilege.privilege_type = 'EXECUTE'
        )
      )
  ),
  'C2 internals remain non-executable by runtime roles and PUBLIC'
);

CREATE TEMP TABLE c2_public_facades(signature text PRIMARY KEY) ON COMMIT DROP;
INSERT INTO c2_public_facades(signature) VALUES
  ('public.manage_google_admin_comments_v1(text,uuid,uuid,text,text,integer,boolean,text,uuid,uuid,uuid)'),
  ('public.manage_google_admin_display_state_v1(text,uuid,uuid,text,text,integer,boolean,text,uuid,uuid,integer,text,text)'),
  ('public.manage_google_admin_lectures_v1(text,uuid,uuid,text,text,integer,boolean,text,uuid,uuid,text,text,text,timestamptz,timestamptz,text,boolean)'),
  ('public.get_google_admin_material_analysis_v1(text,uuid,uuid,text,text,integer,boolean,uuid)'),
  ('public.get_google_admin_academic_results_v1(text,uuid,uuid,text,text,integer,boolean,uuid)'),
  ('public.get_google_admin_sessions_v1(text,uuid,uuid,text,text,integer,boolean)'),
  ('public.get_google_admin_summary_results_v1(text,uuid,uuid,text,text,integer,boolean,uuid)'),
  ('public.manage_google_admin_material_analysis_v1(text,uuid,uuid,text,text,integer,boolean,text,uuid,uuid,uuid,uuid,text,text,text[],jsonb,text)'),
  ('public.manage_google_admin_pdf_documents_v1(text,uuid,uuid,text,text,integer,boolean,text,uuid,uuid,text,text,bigint,text,integer,bigint,integer,text,text,boolean,text,bigint)'),
  ('public.manage_google_admin_polls_v1(text,uuid,uuid,text,text,integer,boolean,text,uuid,uuid,uuid,text,text,text[],boolean)'),
  ('public.manage_google_admin_sessions_v1(text,uuid,uuid,text,text,integer,boolean,text,uuid,uuid)'),
  ('public.manage_google_admin_academic_results_v1(text,uuid,uuid,text,text,integer,boolean,text,uuid,uuid,uuid,uuid,jsonb,text)'),
  ('public.manage_google_admin_summary_publication_v1(text,uuid,uuid,text,text,integer,boolean,text,uuid,uuid,uuid,jsonb,text,integer,timestamp with time zone)'),
  ('public.issue_google_admin_pdf_access_claims_v1(text,uuid,uuid,text,text,integer,boolean,uuid,uuid)'),
  ('public.get_google_admin_operator_live_snapshot_v1(text,uuid,uuid,text,text,integer,boolean,text,uuid,timestamp with time zone,uuid,integer,bigint,bigint,bigint,bigint,bigint,bigint,bigint,bigint,boolean)'),
  ('public.get_google_admin_operations_activation_preflight_v1()');
SELECT is(
  (
    SELECT count(*)::integer
    FROM c2_public_facades AS facade
    JOIN pg_proc AS procedure
      ON procedure.oid = facade.signature::regprocedure
    WHERE pg_get_userbyid(procedure.proowner) = 'postgres'
      AND procedure.prosecdef
      AND procedure.proconfig @> ARRAY['search_path=""']::text[]
  ),
  16,
  'all C2 public facades are postgres-owned with an empty search_path'
);
SELECT ok(
  NOT EXISTS (
    SELECT 1
    FROM c2_public_facades AS facade
    WHERE NOT has_function_privilege(
      'service_role', facade.signature, 'EXECUTE'
    )
      OR has_function_privilege('anon', facade.signature, 'EXECUTE')
      OR has_function_privilege('authenticated', facade.signature, 'EXECUTE')
  ),
  'only service_role can execute the C2 public facades'
);

SELECT alike(
  pg_get_functiondef(
    'private.get_google_ai_master_status_v1(text,uuid,uuid,uuid)'::regprocedure
  ),
  '%admin_ai_unlock_runtime_gate%for share%admin_ai_policies%for share%lecture_sessions%for update%admission_blocked_reason%allowed_scopes%pre_c1_master_remediated%',
  'workspace master status binds gates, supported policy bundles and pre-C1 remediation'
);
SELECT alike(
  pg_get_functiondef(
    'private.manage_google_admin_academic_results_v1(text,uuid,uuid,text,text,integer,boolean,text,uuid,uuid,uuid,uuid,jsonb,text)'::regprocedure
  ),
  '%target_action = ''cancel''%from public.lecture_ai_control%from public.academic_answer_requests%from public.ai_usage_ledger%finish_lecture_ai_operation%',
  'Google academic cancellation uses current lecture authority and exact accounting settlement'
);
SELECT unalike(
  pg_get_functiondef(
    'private.manage_google_admin_academic_results_v1(text,uuid,uuid,text,text,integer,boolean,text,uuid,uuid,uuid,uuid,jsonb,text)'::regprocedure
  ),
  '%admin_cancel_academic_answer_request%',
  'Google academic cancellation does not inherit the historical app-session actor fence'
);

SET ROLE service_role;
SELECT is(
  public.get_google_admin_operations_activation_preflight_v1()
    ->> 'preflightReady',
  'false',
  'default-OFF legacy compatibility is never reported ready for cutover'
);
SELECT is(
  public.get_google_admin_operations_activation_preflight_v1()
    ->> 'authoritative',
  'false',
  'read-only preflight never claims to be the serialized E cutover gate'
);
RESET ROLE;

SELECT alike(
  pg_get_functiondef(
    'private.require_google_admin_operation_context_v1(text,uuid,uuid,text,text,integer,text,uuid)'::regprocedure
  ),
  '%require_google_ai_master_context_v1(%principal_binding.google_issuer%principal_binding.provider_subject_hmac%principal_binding.subject_pepper_version%from private.admin_identity_runtime_gate as gate%for share%from private.admin_lecture_ownerships as ownership%ownership_row.principal_id%ownership_row.membership_id%from public.lecture_sessions as lecture%for update%',
  'C2 rechecks Google subject binding, gate, exact ownership and lecture in one transaction'
);
SELECT alike(
  pg_get_functiondef(
    'private.assert_google_admin_operation_gate_v1(jsonb,boolean)'::regprocedure
  ),
  '%google_operational_authorization_enabled%target_transport_enabled%',
  'new state requires both the DB and Edge transport gates'
);
SELECT alike(
  pg_get_functiondef(
    'private.assert_google_admin_operation_lecture_state_v1(jsonb)'::regprocedure
  ),
  '%state_requirement = ''draft_or_open''%lecture_status = ''open''%hard_stop_at <= effective_now%state_requirement = ''draft_or_open_any''%state_requirement = ''open_any''%lecture_status <> ''open''%',
  'state expansion rejects overdue lectures while terminal controls remain available'
);
SELECT alike(
  pg_get_functiondef(
    'private.manage_google_admin_lectures_v1(text,uuid,uuid,text,text,integer,boolean,text,uuid,uuid,text,text,text,timestamptz,timestamptz,text,boolean)'::regprocedure
  ),
  '%serialize_admin_ai_request_v1(%require_google_admin_operation_context_v1(%from private.admin_google_lecture_operation_receipts%idempotentReplay%assert_google_admin_operation_gate_v1(%assert_google_admin_operation_lecture_state_v1(%lecture start did not transition to open%lecture close did not transition to closed%insert into private.admin_google_lecture_operation_receipts%insert into private.admin_audit_events%',
  'lecture facade keeps request, context, replay, gate, lifecycle, mutation and evidence atomic'
);
SELECT unalike(
  pg_get_functiondef(
    'private.google_admin_lecture_intent_digest_v1(uuid,uuid,text,uuid,text,timestamptz,timestamptz,text)'::regprocedure
  ),
  '%code_hash%',
  'server-generated lecture codes are not caller retry intent'
);
SELECT alike(
  pg_get_functiondef(
    'private.google_admin_operation_intent_digest_v1(uuid,uuid,text,uuid,text,text)'::regprocedure
  ),
  '%request=%session=%operation=%lecture=%target=%payload_digest=%',
  'generic operation intents bind request, session, operation, lecture, target and payload digest'
);
SELECT alike(
  pg_get_functiondef(
    'private.manage_google_admin_comments_v1(text,uuid,uuid,text,text,integer,boolean,text,uuid,uuid,uuid)'::regprocedure
  ),
  '%serialize_admin_ai_request_v1(%require_google_admin_operation_context_v1(%google_admin_operation_intent_digest_v1(%from private.admin_google_operation_receipts%assert_google_admin_operation_gate_v1(%assert_google_admin_operation_lecture_state_v1(%private.admin_moderate_lecture_comment(%insert into private.admin_google_operation_receipts%',
  'comment moderation keeps request, context, replay, gate, lifecycle, child mutation and evidence atomic'
);
SELECT alike(
  pg_get_functiondef(
    'private.manage_google_admin_polls_v1(text,uuid,uuid,text,text,integer,boolean,text,uuid,uuid,uuid,text,text,text[],boolean)'::regprocedure
  ),
  '%normalized_option_labels is null%coalesce(cardinality(normalized_option_labels), 0) not between 2 and 8%serialize_admin_ai_request_v1(%require_google_admin_operation_context_v1(%google_admin_operation_intent_digest_v1(%from private.admin_google_operation_receipts%assert_google_admin_operation_gate_v1(%assert_google_admin_operation_lecture_state_v1(%public.admin_create_poll(%public.admin_set_poll_status(%insert into private.admin_google_operation_receipts%',
  'poll operations reject missing options and keep authorization, mutation and evidence atomic'
);
SELECT alike(
  pg_get_functiondef(
    'private.manage_google_admin_pdf_documents_v1(text,uuid,uuid,text,text,integer,boolean,text,uuid,uuid,text,text,bigint,text,integer,bigint,integer,text,text,boolean,text,bigint)'::regprocedure
  ),
  '%serialize_admin_ai_request_v1(%require_google_admin_operation_context_v1(%google_admin_operation_intent_digest_v1(%from private.admin_google_operation_receipts%assert_google_admin_operation_gate_v1(%assert_google_admin_operation_lecture_state_v1(%pdf_access_version%target_expected_access_version%public.admin_register_pdf_document(%local_manifest_etag = target_manifest_etag%insert into private.admin_google_operation_receipts%',
  'PDF registration keeps Google context, Local Publisher CAS, document mutation and evidence atomic'
);
SELECT alike(
  pg_get_functiondef(
    'private.issue_google_admin_pdf_access_claims_v1(text,uuid,uuid,text,text,integer,boolean,uuid,uuid)'::regprocedure
  ),
  '%serialize_admin_ai_request_v1(%require_google_admin_operation_context_v1(%google_admin_operation_intent_digest_v1(%from private.admin_google_operation_receipts%result_metadata -> ''claims''%assert_google_admin_operation_gate_v1(%assert_google_admin_operation_lecture_state_v1(%public.admin_get_pdf_access_claims_v1(%insert into private.admin_google_operation_receipts%',
  'Admin PDF claims are issued and exactly replayed inside the Google operation transaction'
);
SELECT alike(
  pg_get_functiondef(
    'private.get_google_admin_operator_live_snapshot_v1(text,uuid,uuid,text,text,integer,boolean,text,uuid,timestamp with time zone,uuid,integer,bigint,bigint,bigint,bigint,bigint,bigint,bigint,bigint,boolean)'::regprocedure
  ),
  '%require_google_admin_operation_context_v1(%lecture_lock_mode%update%assert_google_admin_operation_gate_v1(%assert_google_admin_operation_lecture_state_v1(%private.get_lecture_operator_comment_history_v1(%private.get_lecture_operator_snapshot_v2(%private.get_lecture_operator_snapshot_v1(%',
  'Google Admin snapshots keep ownership, lifecycle and expiry reconciliation in one exclusive transaction'
);
SELECT alike(
  pg_get_functiondef(
    'private.manage_google_admin_display_state_v1(text,uuid,uuid,text,text,integer,boolean,text,uuid,uuid,integer,text,text)'::regprocedure
  ),
  '%serialize_admin_ai_request_v1(%from private.presenter_runtime_gate as gate%for update%require_google_admin_operation_context_v1(%google_admin_operation_intent_digest_v1(%from private.admin_google_operation_receipts%assert_google_admin_operation_gate_v1(%assert_google_admin_operation_lecture_state_v1(%from public.lecture_live_state as live%for update%from public.presenter_connections as connection%for update%public.admin_update_pdf_display_v3(%public.admin_update_pdf_display(%insert into private.admin_google_operation_receipts%insert into private.admin_audit_events%',
  'Display state keeps Presenter gate, Google context, lecture state, manual fence, mutation and evidence atomic'
);
SELECT alike(
  pg_get_functiondef(
    'private.get_google_admin_material_analysis_v1(text,uuid,uuid,text,text,integer,boolean,uuid)'::regprocedure
  ),
  '%require_google_admin_operation_context_v1(%assert_google_admin_operation_gate_v1(%assert_google_admin_operation_lecture_state_v1(%public.admin_list_material_ai_results(%',
  'material-analysis reads recheck Google context, ownership and retention in one transaction'
);
SELECT alike(
  pg_get_functiondef(
    'private.manage_google_admin_material_analysis_v1(text,uuid,uuid,text,text,integer,boolean,text,uuid,uuid,uuid,uuid,text,text,text[],jsonb,text)'::regprocedure
  ),
  '%normalized_options is null%coalesce(cardinality(normalized_options), 0) not between 2 and 8%target_action = ''reject''%target_analysis_id is not null%target_action = ''publishSummary''%target_proposal_id is not null%target_action in (''adopt'', ''reject'')%target_type_value := ''poll_proposal''%target_type_value := ''material_summary''%serialize_admin_ai_request_v1(%require_google_admin_operation_context_v1(%lecture_lock_mode%update%google_admin_operation_intent_digest_v1(%from private.admin_google_operation_receipts%refreshRequired%assert_google_admin_operation_gate_v1(%assert_google_admin_operation_lecture_state_v1(%public.admin_adopt_poll_proposal(%public.admin_reject_poll_proposal(%public.admin_set_material_summary_publication(%analysis_id%target_analysis_id%insert into private.admin_google_operation_receipts%insert into private.admin_audit_events%',
  'material-analysis curation validates content and keeps replay, mutation and evidence atomic'
);
SELECT alike(
  pg_get_functiondef(
    'private.get_google_admin_sessions_v1(text,uuid,uuid,text,text,integer,boolean)'::regprocedure
  ),
  '%require_google_admin_operation_context_v1(%manage-admin-sessions.list%expires_at%idle_expires_at%issued_at%last_seen_at%revoke_reason%revoked_at%authentication_method = ''google_totp''%principal_id%membership_id%limit 20%',
  'session ledger preserves the client response schema and lists only the current principal membership without exposing credentials'
);
SELECT alike(
  pg_get_functiondef(
    'private.manage_google_admin_sessions_v1(text,uuid,uuid,text,text,integer,boolean,text,uuid,uuid)'::regprocedure
  ),
  '%serialize_admin_ai_request_v1(%from private.admin_google_operation_receipts%idempotentReplay%require_google_admin_operation_context_v1(%target_action in (''logout'', ''revoke'')%order by session.id%for update%self_all_sessions_revoked%insert into private.admin_google_operation_receipts%insert into private.admin_audit_events%',
  'self session revocation is receipt-bound, ordered, drain-triggering and replay-safe after logout'
);

SET ROLE service_role;
SELECT is(
  public.get_admin_identity_runtime_gate_v1()
    ->> 'google_operational_authorization_enabled',
  'false',
  'supported runtime-gate RPC exposes C2 default OFF'
);
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
