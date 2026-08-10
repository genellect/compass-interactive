BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path = public, extensions;
SELECT no_plan();

SELECT has_table(
  'private',
  'admin_totp_factor_transitions',
  'durable TOTP factor transitions exist'
);
SELECT has_column(
  'private',
  'admin_identity_runtime_gate',
  'totp_factor_mutation_enabled',
  'factor mutation has an independent identity gate'
);
SELECT has_column(
  'private',
  'admin_totp_factor_transitions',
  'recovery_token_hash',
  'transition stores only the recovery credential hash'
);
SELECT has_column(
  'private',
  'admin_ai_browser_credentials',
  'approved_totp_factor_set_version',
  'remembered browser credentials bind the approved TOTP version'
);
SELECT has_column(
  'private',
  'admin_ai_browser_assertion_challenges',
  'supabase_auth_session_id',
  'browser assertions bind the current Auth session'
);

SELECT ok(
  (
    SELECT relrowsecurity
    FROM pg_class
    WHERE oid = 'private.admin_totp_factor_transitions'::regclass
  ),
  'transition table has defense-in-depth RLS'
);
SELECT ok(
  NOT has_table_privilege(
    'anon', 'private.admin_totp_factor_transitions', 'SELECT'
  )
  AND NOT has_table_privilege(
    'authenticated', 'private.admin_totp_factor_transitions', 'SELECT'
  )
  AND NOT has_table_privilege(
    'service_role', 'private.admin_totp_factor_transitions', 'INSERT'
  ),
  'browser roles and service role cannot mutate the private transition table'
);
SELECT ok(
  NOT has_function_privilege(
    'anon',
    'public.authorize_admin_totp_factor_transition_v1(text,uuid,uuid,text,uuid,text,text,uuid)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'authenticated',
    'public.finalize_admin_totp_factor_transition_v1(text,uuid,uuid,text,uuid,text,uuid,uuid)',
    'EXECUTE'
  )
  AND has_function_privilege(
    'service_role',
    'public.authorize_admin_totp_factor_transition_v1(text,uuid,uuid,text,uuid,text,text,uuid)',
    'EXECUTE'
  )
  AND has_function_privilege(
    'service_role',
    'public.finalize_admin_totp_factor_transition_v1(text,uuid,uuid,text,uuid,text,uuid,uuid)',
    'EXECUTE'
  ),
  'only service role can execute factor-transition facades'
);

SELECT ok(
  NOT EXISTS (
    SELECT 1
    FROM pg_constraint AS foreign_key
    WHERE foreign_key.contype = 'f'
      AND foreign_key.conrelid =
        'private.admin_totp_factor_transitions'::regclass
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
  'every transition foreign key has a full non-partial leading lookup index'
);

SELECT is(
  (
    SELECT totp_factor_mutation_enabled
    FROM private.admin_identity_runtime_gate
    WHERE singleton
  ),
  false,
  'factor mutation is default OFF'
);
SELECT is(
  (
    SELECT ai_unlock_enabled
    FROM private.admin_ai_unlock_runtime_gate
    WHERE singleton
  ),
  false,
  'AI unlock remains default OFF'
);
SELECT is(
  (
    SELECT remembered_browser_enabled
    FROM private.admin_ai_unlock_runtime_gate
    WHERE singleton
  ),
  false,
  'remembered browser remains default OFF'
);

SELECT alike(
  pg_get_functiondef(
    'private.describe_admin_totp_factor_transition_v1(uuid,uuid,text,uuid)'::regprocedure
  ),
  '%array_agg(factor.id order by factor.id::text)%max(factor.status) filter (where factor.id = target_factor_id)%live_count := cardinality(live_ids)%live_hash := private.hash_verified_totp_factor_ids_v1(%target_auth_user_id,%live_ids%',
  'factor transition intent derives IDs, target status, count, and hash from one aggregate snapshot'
);
SELECT unalike(
  pg_get_functiondef(
    'private.describe_admin_totp_factor_transition_v1(uuid,uuid,text,uuid)'::regprocedure
  ),
  '%current_verified_totp_factor_set_snapshot_v1%',
  'factor transition intent has no split scalar factor-set read'
);

SELECT ok(
  strpos(
    pg_get_functiondef(
      'private.finalize_admin_totp_factor_transition_v1(text,uuid,uuid,text,uuid,text,uuid,uuid)'::regprocedure
    ),
    'select principal.* into principal_row'
  ) < strpos(
    pg_get_functiondef(
      'private.finalize_admin_totp_factor_transition_v1(text,uuid,uuid,text,uuid,text,uuid,uuid)'::regprocedure
    ),
    'select transition.* into transition_row'
  ),
  'factor finalization locks the principal before the transition row'
);
SELECT ok(
  strpos(
    pg_get_functiondef(
      'private.cleanup_admin_control_step_up_ephemera_v1(timestamptz,uuid)'::regprocedure
    ),
    'delete from private.admin_totp_factor_transitions as transition'
  ) < strpos(
    pg_get_functiondef(
      'private.cleanup_admin_control_step_up_ephemera_v1(timestamptz,uuid)'::regprocedure
    ),
    'delete from private.admin_control_step_up_grants as control_grant'
  )
  AND strpos(
    pg_get_functiondef(
      'private.cleanup_admin_control_step_up_ephemera_v1(timestamptz,uuid)'::regprocedure
    ),
    'delete from private.admin_control_step_up_grants as control_grant'
  ) < strpos(
    pg_get_functiondef(
      'private.cleanup_admin_control_step_up_ephemera_v1(timestamptz,uuid)'::regprocedure
    ),
    'delete from private.admin_control_step_up_nonces as nonce'
  ),
  'control retention deletes transition then grant then nonce'
);
SELECT alike(
  pg_get_functiondef(
    'private.cleanup_admin_control_step_up_ephemera_v1(timestamptz,uuid)'::regprocedure
  ),
  '%for update of transition skip locked%limit 500%transitions_deleted%',
  'transition retention is bounded, nonblocking and reports its result'
);

SELECT alike(
  pg_get_functiondef(
    'private.authorize_admin_totp_factor_transition_v1(text,uuid,uuid,text,uuid,text,text,uuid)'::regprocedure
  ),
  '%try_serialize_admin_ai_scope_v1%',
  'competing transitions use a nonblocking principal serializer'
);
SELECT alike(
  pg_get_functiondef(
    'private.authorize_admin_totp_factor_transition_v1(text,uuid,uuid,text,uuid,text,text,uuid)'::regprocedure
  ),
  '%transition_expires_at <= effective_now + interval ''5 minutes''%',
  'transition authorization rejects an Auth session with too little recovery time'
);
SELECT alike(
  pg_get_functiondef(
    'private.authorize_admin_totp_factor_transition_v1(text,uuid,uuid,text,uuid,text,text,uuid)'::regprocedure
  ),
  '%set status = ''expired''%expires_at <= effective_now%limit 25%',
  'expired transitions are released and retained with bounded cleanup'
);
SELECT alike(
  pg_get_functiondef(
    'private.finalize_admin_totp_factor_transition_v1(text,uuid,uuid,text,uuid,text,uuid,uuid)'::regprocedure
  ),
  '%recovery_token_hash = target_recovery_token_hash%',
  'finalize binds the exact durable recovery credential'
);
SELECT unalike(
  pg_get_functiondef(
    'private.finalize_admin_totp_factor_transition_v1(text,uuid,uuid,text,uuid,text,uuid,uuid)'::regprocedure
  ),
  '%session.token_hash = target_recovery_token_hash%',
  'recovery credential is not confused with the app-session token'
);
SELECT unalike(
  pg_get_functiondef(
    'private.drain_admin_ai_on_session_revoke_v1()'::regprocedure
  ),
  '%admin_ai_browser_credentials%',
  'ordinary app-session logout preserves remembered-browser credentials'
);
SELECT alike(
  pg_get_functiondef(
    'private.bind_admin_ai_browser_totp_context_v1()'::regprocedure
  ),
  '%new.supabase_auth_session_id := session_row.supabase_auth_session_id%',
  'browser assertion binds the current valid Auth session'
);

SELECT throws_ok(
  $$
    INSERT INTO private.admin_totp_factor_transitions (
      mutation_request_id, intended_action, intent_digest,
      recovery_token_hash, target_factor_id,
      environment_id, principal_id, membership_id, admin_session_id,
      supabase_auth_session_id, control_grant_id,
      approved_pre_hash, approved_pre_version, approved_pre_count,
      expected_post_hash, expected_post_count, expires_at
    ) VALUES (
      '00000000-0000-4000-8000-00000000b221',
      'totp_factor_add', repeat('a', 64), 'raw-recovery-token',
      '00000000-0000-4000-8000-00000000b222',
      '00000000-0000-4000-8000-00000000b223',
      '00000000-0000-4000-8000-00000000b224',
      '00000000-0000-4000-8000-00000000b225',
      '00000000-0000-4000-8000-00000000b226',
      '00000000-0000-4000-8000-00000000b227',
      '00000000-0000-4000-8000-00000000b228',
      repeat('b', 64), 1, 1, repeat('c', 64), 2,
      statement_timestamp() + interval '10 minutes'
    )
  $$,
  '23514',
  NULL,
  'raw recovery tokens cannot be persisted in the database'
);

SELECT throws_ok(
  $$
    INSERT INTO private.admin_totp_factor_transitions (
      mutation_request_id, finalize_request_id, intended_action, intent_digest,
      recovery_token_hash, target_factor_id,
      environment_id, principal_id, membership_id, admin_session_id,
      supabase_auth_session_id, control_grant_id,
      approved_pre_hash, approved_pre_version, approved_pre_count,
      expected_post_hash, expected_post_count, expires_at
    ) VALUES (
      '00000000-0000-4000-8000-00000000b231',
      '00000000-0000-4000-8000-00000000b232',
      'totp_factor_add', repeat('a', 64), repeat('b', 64),
      '00000000-0000-4000-8000-00000000b233',
      '00000000-0000-4000-8000-00000000b234',
      '00000000-0000-4000-8000-00000000b235',
      '00000000-0000-4000-8000-00000000b236',
      '00000000-0000-4000-8000-00000000b237',
      '00000000-0000-4000-8000-00000000b238',
      '00000000-0000-4000-8000-00000000b239',
      repeat('c', 64), 1, 1, repeat('d', 64), 2,
      statement_timestamp() + interval '10 minutes'
    )
  $$,
  '23514',
  NULL,
  'non-finalized transitions reject partial terminal evidence'
);

SELECT * FROM finish();
ROLLBACK;
