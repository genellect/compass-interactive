BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path = public, extensions;
SELECT no_plan();

SELECT has_table(
  'private', 'admin_lecture_ownerships',
  'C1 stores lecture ownership only in a private table'
);
SELECT has_table(
  'private', 'admin_ai_master_admission_receipts',
  'C1 stores atomic proof-to-master receipts'
);
SELECT has_table(
  'private', 'admin_ai_master_control_receipts',
  'C1 stores downgrade/revoke idempotency receipts'
);
SELECT has_table(
  'private', 'admin_ai_master_reuse_receipts',
  'C1 stores proof-free same-scope request observations'
);
SELECT has_column(
  'private', 'admin_ai_unlock_runtime_gate',
  'google_ai_master_admission_enabled',
  'C1 has an independent admission gate'
);
SELECT is(
  (
    SELECT google_ai_master_admission_enabled
    FROM private.admin_ai_unlock_runtime_gate
    WHERE singleton
  ),
  false,
  'C1 admission gate remains default OFF'
);

SELECT is(
  (SELECT count(*)::integer FROM private.admin_lecture_ownerships),
  0,
  'existing lectures receive no inferred ownership'
);
SELECT is(
  (
    SELECT count(*)::integer
    FROM private.admin_ai_master_admission_receipts
  ),
  0,
  'migration fabricates no AI-master admission receipt'
);
SELECT is(
  (
    SELECT count(*)::integer
    FROM private.admin_ai_master_control_receipts
  ),
  0,
  'migration fabricates no AI-master control receipt'
);
SELECT is(
  (
    SELECT count(*)::integer
    FROM private.admin_ai_master_reuse_receipts
  ),
  0,
  'migration fabricates no AI-master reuse receipt'
);

SET ROLE service_role;
SELECT is(
  public.get_admin_ai_unlock_runtime_gate_v1()
    ->> 'google_ai_master_admission_enabled',
  'false',
  'supported runtime-gate RPC exposes C1 default OFF'
);
RESET ROLE;

SELECT ok(
  (
    SELECT count(*) = 4 AND bool_and(class.relrowsecurity)
    FROM pg_class AS class
    JOIN pg_namespace AS namespace ON namespace.oid = class.relnamespace
    WHERE namespace.nspname = 'private'
      AND class.relname IN (
        'admin_lecture_ownerships',
        'admin_ai_master_admission_receipts',
        'admin_ai_master_control_receipts',
        'admin_ai_master_reuse_receipts'
      )
  ),
  'all C1 evidence tables enable defense-in-depth RLS'
);
SELECT ok(
  NOT has_table_privilege(
    'service_role', 'private.admin_lecture_ownerships', 'SELECT'
  )
  AND NOT has_table_privilege(
    'service_role', 'private.admin_ai_master_admission_receipts', 'INSERT'
  )
  AND NOT has_table_privilege(
    'service_role', 'private.admin_ai_master_control_receipts', 'UPDATE'
  )
  AND NOT has_table_privilege(
    'service_role', 'private.admin_ai_master_reuse_receipts', 'SELECT'
  )
  AND NOT has_table_privilege(
    'anon', 'private.admin_lecture_ownerships', 'SELECT'
  )
  AND NOT has_table_privilege(
    'authenticated', 'private.admin_ai_master_admission_receipts', 'SELECT'
  ),
  'browser and service roles have no direct C1 evidence-table access'
);

SELECT ok(
  NOT EXISTS (
    SELECT 1
    FROM pg_constraint AS foreign_key
    WHERE foreign_key.contype = 'f'
      AND foreign_key.conrelid IN (
        'private.admin_lecture_ownerships'::regclass,
        'private.admin_ai_master_admission_receipts'::regclass,
        'private.admin_ai_master_control_receipts'::regclass,
        'private.admin_ai_master_reuse_receipts'::regclass
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
  'every C1 evidence foreign key has a full leading index'
);

CREATE TEMP TABLE c1_public_facades(signature text PRIMARY KEY) ON COMMIT DROP;
INSERT INTO c1_public_facades(signature) VALUES
  ('public.create_owned_admin_lecture_v1(text,uuid,uuid,text,text,text,timestamptz,timestamptz,uuid)'),
  ('public.replay_google_ai_master_admission_v1(text,uuid,uuid,uuid,text,uuid,bigint,text,uuid)'),
  ('public.authorize_google_ai_master_with_pin_v1(text,uuid,uuid,uuid,text,uuid,bigint,text,integer,text,uuid)'),
  ('public.complete_google_ai_master_browser_admission_v1(text,uuid,uuid,uuid,text,uuid,bigint,text,text,text,text,boolean,uuid)'),
  ('public.get_google_ai_master_status_v1(text,uuid,uuid,uuid)'),
  ('public.downgrade_google_ai_master_v1(text,uuid,uuid,uuid,uuid)'),
  ('public.revoke_google_ai_master_v1(text,uuid,uuid,uuid,uuid,text)'),
  ('public.admin_authorize_ai_master(uuid,uuid,text,text,boolean)'),
  ('public.admin_issue_ai_billing_grant_from_master(uuid,uuid,text[],text,text)');

SELECT is(
  (
    SELECT count(*)::integer
    FROM c1_public_facades AS facade
    JOIN pg_proc AS procedure
      ON procedure.oid = facade.signature::regprocedure
    WHERE pg_get_userbyid(procedure.proowner) = 'postgres'
  ),
  9,
  'all nine C1 public facades are owned by postgres'
);
SELECT is(
  (
    SELECT count(*)::integer
    FROM c1_public_facades AS facade
    JOIN pg_proc AS procedure
      ON procedure.oid = facade.signature::regprocedure
    WHERE procedure.prosecdef
      AND procedure.proconfig @> ARRAY['search_path=""']::text[]
  ),
  9,
  'all nine C1 public facades fix an empty search_path'
);
SELECT ok(
  NOT EXISTS (
    SELECT 1
    FROM c1_public_facades AS facade
    WHERE NOT has_function_privilege(
      'service_role', facade.signature, 'EXECUTE'
    )
      OR has_function_privilege('anon', facade.signature, 'EXECUTE')
      OR has_function_privilege('authenticated', facade.signature, 'EXECUTE')
  ),
  'only service_role can execute all nine C1 public facades'
);

CREATE TEMP TABLE c1_private_function_names(name text PRIMARY KEY) ON COMMIT DROP;
INSERT INTO c1_private_function_names(name) VALUES
  ('apply_google_ai_master_admission_v1'),
  ('authorize_ai_master'),
  ('authorize_ai_master_pre_c1'),
  ('authorize_google_ai_master_with_pin_v1'),
  ('complete_google_ai_master_browser_admission_v1'),
  ('create_owned_admin_lecture_v1'),
  ('downgrade_google_ai_master_v1'),
  ('drain_c1_google_ai_master_scope_v1'),
  ('drain_c1_master_on_environment_change_v1'),
  ('drain_c1_master_on_membership_change_v1'),
  ('drain_c1_master_on_principal_change_v1'),
  ('enforce_ai_master_on_child_grant_consume'),
  ('enforce_ai_master_on_direct_grant_insert'),
  ('get_google_ai_master_status_v1'),
  ('google_ai_master_intent_digest_v1'),
  ('issue_ai_billing_grant_from_master'),
  ('issue_ai_billing_grant_from_master_pre_c1'),
  ('owned_admin_lecture_intent_digest_v1'),
  ('reject_admin_c1_evidence_mutation_v1'),
  ('replay_google_ai_master_admission_v1'),
  ('replay_or_reuse_google_ai_master_v1'),
  ('require_google_ai_master_context_v1'),
  ('revoke_google_ai_master_v1');

SELECT is(
  (
    SELECT count(*)::integer
    FROM pg_proc AS procedure
    JOIN pg_namespace AS namespace ON namespace.oid = procedure.pronamespace
    JOIN c1_private_function_names AS expected
      ON expected.name = procedure.proname
    WHERE namespace.nspname = 'private'
  ),
  23,
  'the complete private C1 function inventory is present'
);
SELECT ok(
  NOT EXISTS (
    SELECT 1
    FROM pg_proc AS procedure
    JOIN pg_namespace AS namespace ON namespace.oid = procedure.pronamespace
    JOIN c1_private_function_names AS expected
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
  'private C1 functions remain non-executable by service_role, PUBLIC, anon and authenticated'
);

SELECT alike(
  pg_get_functiondef(
    'private.require_google_ai_master_context_v1(text,uuid,uuid,boolean)'::regprocedure
  ),
  '%current_verified_totp_factor_set_snapshot_v1(%auth_session_row.created_at + interval ''8 hours''%revoke_reason = ''totp_factor_set_changed''%',
  'C1 context rechecks one TOTP snapshot, drains mismatch, and preserves the eight-hour cap'
);
SELECT alike(
  pg_get_functiondef(
    'private.require_google_ai_master_context_v1(text,uuid,uuid,boolean)'::regprocedure
  ),
  '%from private.admin_principals as principal%for update%from private.admin_environment_memberships as membership%for update%from private.admin_environments as environment%for share%from public.admin_sessions as session%for update%from auth.sessions as auth_session%for key share%',
  'C1 context preserves principal, membership, environment-share, then session lock order'
);

SELECT alike(
  pg_get_functiondef(
    'private.replay_or_reuse_google_ai_master_v1(jsonb,uuid,text,uuid,bigint,text,uuid,text)'::regprocedure
  ),
  '%from private.admin_ai_master_reuse_receipts%insert into private.admin_ai_master_reuse_receipts%reuse_replayed%',
  'proof-free reuse records an immutable request before returning authority state'
);

SELECT alike(
  pg_get_functiondef(
    'private.authorize_google_ai_master_with_pin_v1(text,uuid,uuid,uuid,text,uuid,bigint,text,integer,text,uuid)'::regprocedure
  ),
  '%replay_or_reuse_google_ai_master_v1(%consume_admin_ai_pin_attempt_v1(%apply_google_ai_master_admission_v1(%',
  'PIN proof and master issuance remain one transaction with replay first'
);
SELECT alike(
  pg_get_functiondef(
    'private.complete_google_ai_master_browser_admission_v1(text,uuid,uuid,uuid,text,uuid,bigint,text,text,text,text,boolean,uuid)'::regprocedure
  ),
  '%replay_or_reuse_google_ai_master_v1(%complete_admin_ai_browser_assertion_v1(%raise exception ''browser proof binding changed during admission''%apply_google_ai_master_admission_v1(%',
  'browser proof mismatch rolls back proof and master atomically'
);
SELECT alike(
  pg_get_functiondef(
    'private.apply_google_ai_master_admission_v1(jsonb,uuid,uuid,text,uuid,bigint,text,uuid,bigint,uuid,uuid,uuid,timestamptz,uuid,text)'::regprocedure
  ),
  '%pre-C1 AI master cannot be converted by C1%insert into private.admin_ai_master_admission_receipts%',
  'C1 refuses implicit legacy conversion and writes immutable admission evidence'
);
SELECT alike(
  pg_get_functiondef(
    'private.issue_ai_billing_grant_from_master(uuid,uuid,text[],text,text)'::regprocedure
  ),
  '%google_master_child_grant_deferred_to_c2%',
  'C1 masters cannot issue child/provider authority before C2'
);

SET LOCAL TIME ZONE 'UTC';
SELECT ok(
  set_config(
    'compass.test.c1_owned_digest_utc',
    private.owned_admin_lecture_intent_digest_v1(
      '00000000-0000-4000-8000-00000000c191'::uuid,
      '00000000-0000-4000-8000-00000000c192'::uuid,
      'timezone invariant lecture', repeat('a', 64),
      '2026-08-10 12:34:56.123456+00'::timestamptz,
      '2026-08-10 13:34:56.654321+00'::timestamptz
    ),
    true
  ) is not null,
  'owned lecture digest captures an absolute timestamp representation'
);
SET LOCAL TIME ZONE 'Asia/Tokyo';
SELECT is(
  private.owned_admin_lecture_intent_digest_v1(
    '00000000-0000-4000-8000-00000000c191'::uuid,
    '00000000-0000-4000-8000-00000000c192'::uuid,
    'timezone invariant lecture', repeat('a', 64),
    '2026-08-10 21:34:56.123456+09'::timestamptz,
    '2026-08-10 22:34:56.654321+09'::timestamptz
  ),
  current_setting('compass.test.c1_owned_digest_utc'),
  'owned lecture digest is invariant across TimeZone settings'
);
SET LOCAL TIME ZONE 'UTC';

SELECT * FROM finish();
ROLLBACK;
