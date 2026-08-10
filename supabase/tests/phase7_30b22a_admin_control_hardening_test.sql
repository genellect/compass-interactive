BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path = public, extensions;
SELECT no_plan();

SELECT has_table(
  'private',
  'admin_control_step_up_nonces',
  'rare-control step-up nonces exist'
);
SELECT has_table(
  'private',
  'admin_control_step_up_grants',
  'single-use rare-control grants exist'
);
SELECT has_column(
  'public',
  'admin_sessions',
  'verified_totp_factor_set_hash',
  'Admin sessions bind the verified TOTP factor set'
);
SELECT has_column(
  'private',
  'admin_principals',
  'approved_totp_factor_set_hash',
  'Admin principals hold the authoritative approved TOTP trust anchor'
);
SELECT has_column(
  'private',
  'admin_principals',
  'approved_totp_factor_set_version',
  'approved TOTP trust anchors are versioned'
);
SELECT has_column(
  'private',
  'admin_step_up_nonces',
  'factor_set_bootstrap_allowed',
  'login nonces distinguish the bounded first-factor bootstrap'
);

SELECT ok(
  (
    SELECT count(*) = 2 AND bool_and(class.relrowsecurity)
    FROM pg_class AS class
    JOIN pg_namespace AS namespace ON namespace.oid = class.relnamespace
    WHERE namespace.nspname = 'private'
      AND class.relname IN (
        'admin_control_step_up_nonces',
        'admin_control_step_up_grants'
      )
  ),
  'both B2.2a control tables have defense-in-depth RLS'
);

SELECT ok(
  NOT EXISTS (
    SELECT 1
    FROM pg_constraint AS foreign_key
    WHERE foreign_key.contype = 'f'
      AND foreign_key.conrelid IN (
        'private.admin_ai_unlock_factors'::regclass,
        'private.admin_control_step_up_nonces'::regclass,
        'private.admin_control_step_up_grants'::regclass
      )
      AND NOT EXISTS (
        SELECT 1
        FROM pg_index AS idx
        WHERE idx.indrelid = foreign_key.conrelid
          AND idx.indisvalid
          AND idx.indisready
          AND split_part(idx.indkey::text, ' ', 1)::smallint = foreign_key.conkey[1]
      )
  ),
  'every B2.2a foreign key has a valid leading lookup index'
);

SELECT ok(
  NOT has_table_privilege(
    'anon',
    'private.admin_control_step_up_nonces',
    'SELECT'
  )
  AND NOT has_table_privilege(
    'authenticated',
    'private.admin_control_step_up_grants',
    'SELECT'
  )
  AND NOT has_table_privilege(
    'service_role',
    'private.admin_control_step_up_nonces',
    'INSERT'
  )
  AND NOT has_table_privilege(
    'service_role',
    'private.admin_control_step_up_grants',
      'UPDATE'
  )
  AND NOT has_function_privilege(
    'anon',
    'public.adopt_existing_admin_totp_factor_set_v1(uuid,uuid,uuid,uuid,text,integer,uuid,text,text)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'anon',
    'private.current_verified_totp_factor_set_snapshot_v1(uuid)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'authenticated',
    'private.current_verified_totp_factor_set_snapshot_v1(uuid)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'service_role',
    'private.current_verified_totp_factor_set_snapshot_v1(uuid)',
    'EXECUTE'
  )
  AND has_function_privilege(
    'service_role',
    'public.adopt_existing_admin_totp_factor_set_v1(uuid,uuid,uuid,uuid,text,integer,uuid,text,text)',
    'EXECUTE'
  ),
  'browser and service roles have no direct control-state table path'
);

SELECT ok(
  NOT has_function_privilege(
    'service_role',
    'private.begin_admin_totp_step_up_pre_b22a_v1(uuid,uuid,uuid,text,uuid,text,uuid)',
    'EXECUTE'
  )
  AND to_regprocedure(
    'public.begin_admin_totp_step_up_v1(uuid,uuid,uuid,text,uuid,text,uuid)'
  ) IS NULL
  AND has_function_privilege(
    'service_role',
    'public.begin_admin_totp_step_up_v2(uuid,uuid,uuid,uuid,text,uuid,text,uuid)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'service_role',
    'private.enroll_admin_ai_pin_pre_b22a_v1(text,uuid,uuid,text,integer,uuid)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'service_role',
    'private.set_admin_ai_policy_pre_b22a_v1(text,uuid,uuid,uuid,text[],text[],integer,integer,bigint,bigint,bigint,bigint,bigint,bigint,integer,integer,integer,timestamptz,timestamptz,uuid)',
    'EXECUTE'
  ),
  'factor-unbound login and pre-B2.2a PIN/policy implementations cannot bypass current grants'
);

SELECT ok(
  (
    SELECT ai_unlock_enabled IS FALSE
      AND remembered_browser_enabled IS FALSE
    FROM private.admin_ai_unlock_runtime_gate
    WHERE singleton
  )
  AND (
    SELECT google_session_issue_enabled IS FALSE
      AND operator_totp_factor_set_adoption_enabled IS FALSE
    FROM private.admin_identity_runtime_gate
    WHERE singleton
  ),
  'B2.2a remains dormant and fixed-cost-zero by default'
);

INSERT INTO auth.users (
  instance_id,
  id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  raw_app_meta_data,
  raw_user_meta_data,
  created_at,
  updated_at
) VALUES (
  '00000000-0000-0000-0000-000000000000'::uuid,
  '00000000-0000-4000-8000-000000007801'::uuid,
  'authenticated',
  'authenticated',
  'phase730b22a@example.test',
  '',
  statement_timestamp() - interval '1 hour',
  '{"provider":"google","providers":["google"]}'::jsonb,
  '{}'::jsonb,
  statement_timestamp() - interval '1 hour',
  statement_timestamp() - interval '1 hour'
) ON CONFLICT (id) DO NOTHING;

INSERT INTO auth.sessions (id, user_id, created_at, updated_at)
VALUES (
  '00000000-0000-4000-8000-000000007802'::uuid,
  '00000000-0000-4000-8000-000000007801'::uuid,
  statement_timestamp() - interval '1 hour',
  statement_timestamp() - interval '1 hour'
) ON CONFLICT (id) DO NOTHING;

-- Insert in reverse UUID order. The authoritative digest must be independent
-- of row/insertion order and include verified TOTP factors only.
INSERT INTO auth.mfa_factors (
  id,
  user_id,
  friendly_name,
  factor_type,
  status,
  created_at,
  updated_at
) VALUES
  (
    '00000000-0000-4000-8000-000000007804'::uuid,
    '00000000-0000-4000-8000-000000007801'::uuid,
    'phase730b22a-second',
    'totp',
    'verified',
    statement_timestamp() - interval '1 hour',
    statement_timestamp() - interval '1 hour'
  ),
  (
    '00000000-0000-4000-8000-000000007803'::uuid,
    '00000000-0000-4000-8000-000000007801'::uuid,
    'phase730b22a-first',
    'totp',
    'verified',
    statement_timestamp() - interval '1 hour',
    statement_timestamp() - interval '1 hour'
  );

SELECT is(
  private.current_verified_totp_factor_set_hash_v1(
    '00000000-0000-4000-8000-000000007801'::uuid
  ),
  encode(
    extensions.digest(
      convert_to(
        'compass:phase7.30:verified-totp-factor-set:v1|user='
        || '00000000-0000-4000-8000-000000007801'
        || '|factors='
        || '00000000-0000-4000-8000-000000007803,'
        || '00000000-0000-4000-8000-000000007804',
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  ),
  'factor-set digest is domain-separated and UUID-sorted'
);

SELECT ok(
  (
    SELECT snapshot.factor_set_hash =
        'b907a60aa6717a40eb1992e769992cc70f870d751fc5f8f0376db719814ffe3a'
      AND snapshot.factor_count = 2
    FROM private.current_verified_totp_factor_set_snapshot_v1(
      '00000000-0000-4000-8000-000000007801'::uuid
    ) AS snapshot
  ),
  'factor-set snapshot returns its hash/count pair from one aggregate result'
);

INSERT INTO private.admin_environments (
  id,
  environment_kind,
  canonical_admin_origin,
  supabase_issuer,
  current_deployment,
  bootstrap_sealed_at,
  owner_invariant_enforced_at
) VALUES (
  '00000000-0000-4000-8000-000000007805'::uuid,
  'local',
  'http://127.0.0.1:5173',
  'http://127.0.0.1:54321/auth/v1',
  true,
  statement_timestamp() - interval '1 hour',
  statement_timestamp() - interval '1 hour'
);

INSERT INTO private.admin_principals (
  id,
  auth_user_id,
  google_issuer,
  provider_subject_hmac,
  subject_pepper_version,
  normalized_email,
  email_verified_at
) VALUES (
  '00000000-0000-4000-8000-000000007806'::uuid,
  '00000000-0000-4000-8000-000000007801'::uuid,
  'https://accounts.google.com',
  repeat('a', 64),
  1,
  'phase730b22a@example.test',
  statement_timestamp() - interval '1 hour'
);

INSERT INTO private.admin_environment_memberships (
  id,
  environment_id,
  principal_id,
  role,
  status,
  can_use_ai,
  activated_at
) VALUES (
  '00000000-0000-4000-8000-000000007807'::uuid,
  '00000000-0000-4000-8000-000000007805'::uuid,
  '00000000-0000-4000-8000-000000007806'::uuid,
  'owner',
  'active',
  true,
  statement_timestamp() - interval '1 hour'
);

UPDATE private.admin_identity_runtime_gate
SET google_session_issue_enabled = true
WHERE singleton;
UPDATE private.admin_ai_unlock_runtime_gate
SET ai_unlock_enabled = true
WHERE singleton;

-- A preexisting verified set is not trusted merely because it is live in
-- GoTrue. Browser login fails closed until an explicit operator adoption.
SET ROLE service_role;
SELECT throws_ok(
  $$
    SELECT public.begin_admin_totp_step_up_v2(
      '00000000-0000-4000-8000-000000007805'::uuid,
      '00000000-0000-4000-8000-000000007801'::uuid,
      '00000000-0000-4000-8000-000000007802'::uuid,
      '00000000-0000-4000-8000-000000007803'::uuid,
      repeat('c', 64),
      '00000000-0000-4000-8000-000000007840'::uuid,
      repeat('d', 64),
      '00000000-0000-4000-8000-000000007841'::uuid
    )
  $$,
  'P7332',
  'Admin TOTP factor-set adoption is required',
  'an existing verified set with no approved anchor fails closed'
);
RESET ROLE;

UPDATE private.admin_identity_runtime_gate
SET google_session_issue_enabled = false
WHERE singleton;
SET ROLE service_role;
SELECT throws_ok(
  $$
    SELECT public.adopt_existing_admin_totp_factor_set_v1(
      '00000000-0000-4000-8000-000000007805'::uuid,
      '00000000-0000-4000-8000-000000007806'::uuid,
      '00000000-0000-4000-8000-000000007807'::uuid,
      '00000000-0000-4000-8000-000000007801'::uuid,
      'b907a60aa6717a40eb1992e769992cc70f870d751fc5f8f0376db719814ffe3a',
      2,
      '00000000-0000-4000-8000-000000007842'::uuid,
      'operator:test-suite',
      'local explicit adoption fixture'
    )
  $$,
  'P7300',
  'Admin TOTP factor-set operator adoption is disabled',
  'operator adoption is default-OFF'
);
RESET ROLE;

UPDATE private.admin_identity_runtime_gate
SET operator_totp_factor_set_adoption_enabled = true
WHERE singleton;
SET ROLE service_role;
SELECT is(
  public.adopt_existing_admin_totp_factor_set_v1(
    '00000000-0000-4000-8000-000000007805'::uuid,
    '00000000-0000-4000-8000-000000007806'::uuid,
    '00000000-0000-4000-8000-000000007807'::uuid,
    '00000000-0000-4000-8000-000000007801'::uuid,
    'b907a60aa6717a40eb1992e769992cc70f870d751fc5f8f0376db719814ffe3a',
    2,
    '00000000-0000-4000-8000-000000007842'::uuid,
    'operator:test-suite',
    'local explicit adoption fixture'
  ) ->> 'replayed',
  'false',
  'service-role operator adoption binds the exact DB-recomputed live set'
);
RESET ROLE;

UPDATE private.admin_identity_runtime_gate
SET operator_totp_factor_set_adoption_enabled = false
WHERE singleton;
SET ROLE service_role;
SELECT is(
  public.adopt_existing_admin_totp_factor_set_v1(
    '00000000-0000-4000-8000-000000007805'::uuid,
    '00000000-0000-4000-8000-000000007806'::uuid,
    '00000000-0000-4000-8000-000000007807'::uuid,
    '00000000-0000-4000-8000-000000007801'::uuid,
    'b907a60aa6717a40eb1992e769992cc70f870d751fc5f8f0376db719814ffe3a',
    2,
    '00000000-0000-4000-8000-000000007842'::uuid,
    'operator:test-suite',
    'local explicit adoption fixture'
  ) ->> 'replayed',
  'true',
  'an exact adoption retry survives the operator gate returning OFF'
);
SELECT is(
  public.adopt_existing_admin_totp_factor_set_v1(
    '00000000-0000-4000-8000-000000007805'::uuid,
    '00000000-0000-4000-8000-000000007806'::uuid,
    '00000000-0000-4000-8000-000000007807'::uuid,
    '00000000-0000-4000-8000-000000007801'::uuid,
    'b907a60aa6717a40eb1992e769992cc70f870d751fc5f8f0376db719814ffe3a',
    2,
    '00000000-0000-4000-8000-000000007842'::uuid,
    'operator:test-suite',
    'changed adoption reason'
  )::text,
  null,
  'same-request adoption retry cannot change actor-bound intent'
);
RESET ROLE;

SELECT ok(
  (
    SELECT principal.approved_totp_factor_set_hash = snapshot.factor_set_hash
      AND principal.approved_totp_factor_count = snapshot.factor_count
      AND snapshot.factor_set_hash =
        'b907a60aa6717a40eb1992e769992cc70f870d751fc5f8f0376db719814ffe3a'
      AND snapshot.factor_count = 2
      AND principal.approved_totp_factor_set_version = 1
      AND principal.approved_totp_factor_set_source = 'operator_adoption'
    FROM private.admin_principals AS principal
    CROSS JOIN LATERAL private.current_verified_totp_factor_set_snapshot_v1(
      principal.auth_user_id
    ) AS snapshot
    WHERE principal.id = '00000000-0000-4000-8000-000000007806'::uuid
  ),
  'operator adoption persists one authoritative hash/count aggregate snapshot'
);

UPDATE private.admin_identity_runtime_gate
SET google_session_issue_enabled = true
WHERE singleton;

-- Model a stolen old AAL2 bearer that has already enrolled and verified a new
-- factor upstream. Live membership is insufficient: it differs from the
-- operator-approved anchor and cannot start a new Admin login.
INSERT INTO auth.mfa_factors (
  id, user_id, friendly_name, factor_type, status, created_at, updated_at
) VALUES (
  '00000000-0000-4000-8000-000000007843'::uuid,
  '00000000-0000-4000-8000-000000007801'::uuid,
  'phase730b22a-stolen-aal2-added-factor',
  'totp', 'verified', statement_timestamp(), statement_timestamp()
);
SET ROLE service_role;
SELECT throws_ok(
  $$
    SELECT public.begin_admin_totp_step_up_v2(
      '00000000-0000-4000-8000-000000007805'::uuid,
      '00000000-0000-4000-8000-000000007801'::uuid,
      '00000000-0000-4000-8000-000000007802'::uuid,
      '00000000-0000-4000-8000-000000007843'::uuid,
      repeat('e', 64),
      '00000000-0000-4000-8000-000000007844'::uuid,
      repeat('f', 64),
      '00000000-0000-4000-8000-000000007845'::uuid
    )
  $$,
  'P7330',
  'approved Admin TOTP factor set changed',
  'a newly verified factor from an old AAL2 bearer cannot become Admin authority'
);
RESET ROLE;
SELECT is(
  (
    SELECT count(*)::integer
    FROM private.admin_step_up_nonces
    WHERE reserved_admin_session_id =
      '00000000-0000-4000-8000-000000007844'::uuid
  ),
  0,
  'stolen-AAL2 factor substitution writes no login nonce'
);
DELETE FROM auth.mfa_factors
WHERE id = '00000000-0000-4000-8000-000000007843'::uuid;

-- Initial enrollment binds exactly the challenged unverified factor. An
-- abandoned second enrollment must neither block login nor enter the expected
-- post-challenge set.
INSERT INTO auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) VALUES (
  '00000000-0000-0000-0000-000000000000'::uuid,
  '00000000-0000-4000-8000-000000007820'::uuid,
  'authenticated', 'authenticated', 'phase730b22a-initial@example.test', '',
  statement_timestamp() - interval '1 hour',
  '{"provider":"google","providers":["google"]}'::jsonb, '{}'::jsonb,
  statement_timestamp() - interval '1 hour',
  statement_timestamp() - interval '1 hour'
);
INSERT INTO auth.sessions (id, user_id, created_at, updated_at) VALUES (
  '00000000-0000-4000-8000-000000007821'::uuid,
  '00000000-0000-4000-8000-000000007820'::uuid,
  statement_timestamp() - interval '1 hour',
  statement_timestamp() - interval '1 hour'
);
INSERT INTO auth.mfa_factors (
  id, user_id, friendly_name, factor_type, status, created_at, updated_at
) VALUES
  (
    '00000000-0000-4000-8000-000000007822'::uuid,
    '00000000-0000-4000-8000-000000007820'::uuid,
    'phase730b22a-exact-candidate', 'totp', 'unverified',
    statement_timestamp(), statement_timestamp()
  ),
  (
    '00000000-0000-4000-8000-000000007823'::uuid,
    '00000000-0000-4000-8000-000000007820'::uuid,
    'phase730b22a-abandoned-candidate', 'totp', 'unverified',
    statement_timestamp(), statement_timestamp()
  );
INSERT INTO private.admin_principals (
  id, auth_user_id, google_issuer, provider_subject_hmac,
  subject_pepper_version, normalized_email, email_verified_at
) VALUES (
  '00000000-0000-4000-8000-000000007824'::uuid,
  '00000000-0000-4000-8000-000000007820'::uuid,
  'https://accounts.google.com', repeat('d', 64), 1,
  'phase730b22a-initial@example.test',
  statement_timestamp() - interval '1 hour'
);
INSERT INTO private.admin_environment_memberships (
  id, environment_id, principal_id, role, status, can_use_ai, activated_at
) VALUES (
  '00000000-0000-4000-8000-000000007825'::uuid,
  '00000000-0000-4000-8000-000000007805'::uuid,
  '00000000-0000-4000-8000-000000007824'::uuid,
  'instructor', 'pending_mfa', true, null
);

SELECT is(
  private.expected_verified_totp_factor_set_hash_v1(
    '00000000-0000-4000-8000-000000007820'::uuid,
    '00000000-0000-4000-8000-000000007822'::uuid
  ),
  encode(
    extensions.digest(
      convert_to(
        'compass:phase7.30:verified-totp-factor-set:v1|user='
        || '00000000-0000-4000-8000-000000007820'
        || '|factors=00000000-0000-4000-8000-000000007822',
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  ),
  'initial enrollment expects only the exact challenged factor despite an abandoned enrollment'
);

SET ROLE service_role;
SELECT is(
  public.begin_admin_totp_step_up_v2(
    '00000000-0000-4000-8000-000000007805'::uuid,
    '00000000-0000-4000-8000-000000007820'::uuid,
    '00000000-0000-4000-8000-000000007821'::uuid,
    '00000000-0000-4000-8000-000000007822'::uuid,
    repeat('6', 64),
    '00000000-0000-4000-8000-000000007826'::uuid,
    repeat('7', 64),
    '00000000-0000-4000-8000-000000007827'::uuid
  ) ->> 'reserved_admin_session_id',
  '00000000-0000-4000-8000-000000007826',
  'factor-bound v2 login begin accepts an exact initial enrollment candidate'
);
RESET ROLE;

SELECT ok(
  (
    SELECT challenged_totp_factor_id =
        '00000000-0000-4000-8000-000000007822'::uuid
      AND prechallenge_verified_totp_factor_set_hash IS NULL
      AND verified_totp_factor_set_hash =
        private.expected_verified_totp_factor_set_hash_v1(
          '00000000-0000-4000-8000-000000007820'::uuid,
          '00000000-0000-4000-8000-000000007822'::uuid
        )
      AND factor_set_bootstrap_allowed
      AND approved_totp_factor_set_version = 0
    FROM private.admin_step_up_nonces
    WHERE reserved_admin_session_id =
      '00000000-0000-4000-8000-000000007826'::uuid
  ),
  'login nonce persists the challenged factor and expected post-challenge set'
);

UPDATE auth.mfa_factors
SET status = 'verified', updated_at = statement_timestamp()
WHERE id = '00000000-0000-4000-8000-000000007822'::uuid;

SET ROLE service_role;
SELECT is(
  public.complete_admin_totp_step_up_v1(
    repeat('6', 64),
    '00000000-0000-4000-8000-000000007820'::uuid,
    '00000000-0000-4000-8000-000000007821'::uuid,
    2::smallint,
    repeat('8', 64),
    statement_timestamp(),
    'totp',
    statement_timestamp(),
    repeat('9', 64),
    null,
    null,
    '00000000-0000-4000-8000-000000007828'::uuid
  ) ->> 'id',
  '00000000-0000-4000-8000-000000007826',
  'exact initial factor verification issues a factor-bound Admin session'
);
RESET ROLE;
SELECT ok(
  (
    SELECT approved_totp_factor_set_hash =
        'e820ac4362c17a27f4563c8835a2619eefaa6782b25cb3e6cc2dfcc376299d43'
      AND approved_totp_factor_set_version = 1
      AND approved_totp_factor_count = 1
      AND approved_totp_factor_set_source = 'login_bootstrap'
      AND approved_totp_factor_set_request_id =
        '00000000-0000-4000-8000-000000007827'::uuid
    FROM private.admin_principals
    WHERE id = '00000000-0000-4000-8000-000000007824'::uuid
  )
  AND (
    SELECT status = 'active' AND activated_at IS NOT NULL
    FROM private.admin_environment_memberships
    WHERE id = '00000000-0000-4000-8000-000000007825'::uuid
  ),
  'fresh completion atomically bootstraps the singleton trust anchor and membership'
);
SET ROLE service_role;

-- The first AI PIN enrollment reuses the just-consumed login TOTP event. It
-- creates a consumed admin_login grant, but only an exact canonical retry may
-- reuse that request ID and no later mutation gets the same exemption.
SELECT is(
  public.enroll_admin_ai_pin_v1(
    repeat('9', 64),
    '00000000-0000-4000-8000-000000007820'::uuid,
    '00000000-0000-4000-8000-000000007821'::uuid,
    encode(extensions.digest('phase730b22a-initial-pin', 'sha256'), 'hex'),
    1,
    '00000000-0000-4000-8000-00000000782c'::uuid
  ) ->> 'factor_version',
  '1',
  'factor-history-free initial PIN enrollment reuses the fresh login TOTP'
);
SELECT ok(
  (
    SELECT source_kind = 'admin_login'
      AND intended_action = 'ai_pin_enroll'
      AND status = 'consumed'
    FROM private.admin_control_step_up_grants
    WHERE mutation_request_id =
      '00000000-0000-4000-8000-00000000782c'::uuid
  ),
  'initial enrollment records one consumed login-source grant'
);
SELECT is(
  public.enroll_admin_ai_pin_v1(
    repeat('9', 64),
    '00000000-0000-4000-8000-000000007820'::uuid,
    '00000000-0000-4000-8000-000000007821'::uuid,
    encode(extensions.digest('phase730b22a-initial-pin', 'sha256'), 'hex'),
    1,
    '00000000-0000-4000-8000-00000000782c'::uuid
  ) ->> 'factor_version',
  '1',
  'exact initial PIN enrollment replay returns the committed factor'
);
SELECT is(
  public.enroll_admin_ai_pin_v1(
    repeat('9', 64),
    '00000000-0000-4000-8000-000000007820'::uuid,
    '00000000-0000-4000-8000-000000007821'::uuid,
    encode(extensions.digest('phase730b22a-changed-pin', 'sha256'), 'hex'),
    1,
    '00000000-0000-4000-8000-00000000782c'::uuid
  )::text,
  null,
  'changed PIN input cannot replay the consumed login-source grant'
);
SELECT is(
  public.enroll_admin_ai_pin_v1(
    repeat('9', 64),
    '00000000-0000-4000-8000-000000007820'::uuid,
    '00000000-0000-4000-8000-000000007821'::uuid,
    encode(extensions.digest('phase730b22a-second-pin', 'sha256'), 'hex'),
    2,
    '00000000-0000-4000-8000-00000000782d'::uuid
  )::text,
  null,
  'a second PIN mutation cannot reuse login TOTP freshness'
);

SELECT ok(
  public.begin_admin_control_step_up_v1(
    repeat('9', 64),
    '00000000-0000-4000-8000-000000007820'::uuid,
    '00000000-0000-4000-8000-000000007821'::uuid,
    'ai_pin_revoke',
    '00000000-0000-4000-8000-00000000782e'::uuid,
    encode(extensions.digest('phase730b22a-revoke-nonce', 'sha256'), 'hex'),
    encode(extensions.digest('phase730b22a-revoke-prejwt', 'sha256'), 'hex')
  ) IS NOT NULL,
  'terminal PIN revoke begins with a DB-derived factor-scoped intent'
);
SELECT ok(
  public.complete_admin_control_step_up_v1(
    repeat('9', 64),
    '00000000-0000-4000-8000-000000007820'::uuid,
    '00000000-0000-4000-8000-000000007821'::uuid,
    'ai_pin_revoke',
    (
      SELECT intent_digest
      FROM private.admin_control_step_up_nonces
      WHERE mutation_request_id =
        '00000000-0000-4000-8000-00000000782e'::uuid
    ),
    '00000000-0000-4000-8000-00000000782e'::uuid,
    encode(extensions.digest('phase730b22a-revoke-nonce', 'sha256'), 'hex'),
    encode(extensions.digest('phase730b22a-revoke-postjwt', 'sha256'), 'hex'),
    statement_timestamp(),
    'totp',
    statement_timestamp()
  ) IS NOT NULL,
  'fresh factor-scoped TOTP completes one revoke control grant'
);
SELECT is(
  public.revoke_admin_ai_pin_v1(
    repeat('9', 64),
    '00000000-0000-4000-8000-000000007820'::uuid,
    '00000000-0000-4000-8000-000000007821'::uuid,
    '00000000-0000-4000-8000-00000000782e'::uuid
  ) ->> 'terminal_action',
  'revoke',
  'explicit PIN revoke consumes its exact grant'
);
SELECT is(
  public.revoke_admin_ai_pin_v1(
    repeat('9', 64),
    '00000000-0000-4000-8000-000000007820'::uuid,
    '00000000-0000-4000-8000-000000007821'::uuid,
    '00000000-0000-4000-8000-00000000782e'::uuid
  ) ->> 'terminal_action',
  'revoke',
  'exact PIN revoke request is idempotent'
);
SELECT is(
  public.reset_admin_ai_pin_v1(
    repeat('9', 64),
    '00000000-0000-4000-8000-000000007820'::uuid,
    '00000000-0000-4000-8000-000000007821'::uuid,
    '00000000-0000-4000-8000-00000000782e'::uuid
  )::text,
  null,
  'the same request/grant cannot cross from revoke to reset'
);

RESET ROLE;
INSERT INTO private.admin_ai_unlock_factors (
  id, environment_id, principal_id, membership_id, pin_verifier,
  pin_pepper_version, factor_version, enrolled_by_admin_session_id,
  enrolled_step_up_verified_at, enrollment_request_id
) VALUES (
  '00000000-0000-4000-8000-000000007835'::uuid,
  '00000000-0000-4000-8000-000000007805'::uuid,
  '00000000-0000-4000-8000-000000007824'::uuid,
  '00000000-0000-4000-8000-000000007825'::uuid,
  extensions.crypt(
    encode(extensions.digest('phase730b22a-reset-factor', 'sha256'), 'hex'),
    extensions.gen_salt('bf', 12)
  ),
  1, 2, '00000000-0000-4000-8000-000000007826'::uuid,
  statement_timestamp(), '00000000-0000-4000-8000-000000007836'::uuid
);
SET ROLE service_role;
SELECT ok(
  public.begin_admin_control_step_up_v1(
    repeat('9', 64),
    '00000000-0000-4000-8000-000000007820'::uuid,
    '00000000-0000-4000-8000-000000007821'::uuid,
    'ai_pin_reset',
    '00000000-0000-4000-8000-000000007837'::uuid,
    encode(extensions.digest('phase730b22a-reset-nonce', 'sha256'), 'hex'),
    encode(extensions.digest('phase730b22a-reset-prejwt', 'sha256'), 'hex')
  ) IS NOT NULL,
  'terminal PIN reset independently begins with its exact active factor'
);
SELECT ok(
  public.complete_admin_control_step_up_v1(
    repeat('9', 64),
    '00000000-0000-4000-8000-000000007820'::uuid,
    '00000000-0000-4000-8000-000000007821'::uuid,
    'ai_pin_reset',
    (
      SELECT intent_digest
      FROM private.admin_control_step_up_nonces
      WHERE mutation_request_id =
        '00000000-0000-4000-8000-000000007837'::uuid
    ),
    '00000000-0000-4000-8000-000000007837'::uuid,
    encode(extensions.digest('phase730b22a-reset-nonce', 'sha256'), 'hex'),
    encode(extensions.digest('phase730b22a-reset-postjwt', 'sha256'), 'hex'),
    statement_timestamp(), 'totp', statement_timestamp()
  ) IS NOT NULL,
  'fresh TOTP completes the independent reset control grant'
);
SELECT is(
  public.reset_admin_ai_pin_v1(
    repeat('9', 64),
    '00000000-0000-4000-8000-000000007820'::uuid,
    '00000000-0000-4000-8000-000000007821'::uuid,
    '00000000-0000-4000-8000-000000007837'::uuid
  ) ->> 'terminal_action',
  'reset',
  'explicit PIN reset consumes its independent exact grant'
);
SELECT is(
  public.reset_admin_ai_pin_v1(
    repeat('9', 64),
    '00000000-0000-4000-8000-000000007820'::uuid,
    '00000000-0000-4000-8000-000000007821'::uuid,
    '00000000-0000-4000-8000-000000007837'::uuid
  ) ->> 'terminal_action',
  'reset',
  'exact PIN reset request is idempotent'
);
RESET ROLE;
SELECT ok(
  (
    SELECT status = 'revoked'
      AND revoke_reason = 'factor_reset'
      AND terminal_action = 'reset'
    FROM private.admin_ai_unlock_factors
    WHERE id = '00000000-0000-4000-8000-000000007835'::uuid
  ),
  'reset records its distinct terminal factor outcome'
);
SET ROLE service_role;

SELECT is(
  public.begin_admin_totp_step_up_v2(
    '00000000-0000-4000-8000-000000007805'::uuid,
    '00000000-0000-4000-8000-000000007820'::uuid,
    '00000000-0000-4000-8000-000000007821'::uuid,
    '00000000-0000-4000-8000-000000007823'::uuid,
    repeat('a', 64),
    '00000000-0000-4000-8000-000000007829'::uuid,
    repeat('b', 64),
    '00000000-0000-4000-8000-00000000782a'::uuid
  )::text,
  null,
  'an existing verified set rejects an unverified login candidate'
);
SELECT is(
  (
    SELECT count(*)::integer
    FROM private.admin_step_up_nonces
    WHERE reserved_admin_session_id =
      '00000000-0000-4000-8000-000000007829'::uuid
  ),
  0,
  'rejected post-enrollment factor addition writes no login nonce'
);
RESET ROLE;

-- A stale proof for factor A must not be laundered into a session bound only
-- to surviving factor B.
SET ROLE service_role;
SELECT ok(
  public.begin_admin_totp_step_up_v2(
    '00000000-0000-4000-8000-000000007805'::uuid,
    '00000000-0000-4000-8000-000000007801'::uuid,
    '00000000-0000-4000-8000-000000007802'::uuid,
    '00000000-0000-4000-8000-000000007803'::uuid,
    repeat('e', 64),
    '00000000-0000-4000-8000-000000007830'::uuid,
    repeat('f', 64),
    '00000000-0000-4000-8000-000000007831'::uuid
  ) IS NOT NULL,
  'two-factor login snapshot begins against challenged factor A'
);
RESET ROLE;
DELETE FROM auth.mfa_factors
WHERE id = '00000000-0000-4000-8000-000000007803'::uuid;
SET ROLE service_role;
SELECT is(
  public.complete_admin_totp_step_up_v1(
    repeat('e', 64),
    '00000000-0000-4000-8000-000000007801'::uuid,
    '00000000-0000-4000-8000-000000007802'::uuid,
    2::smallint,
    repeat('0', 64),
    statement_timestamp(),
    'totp',
    statement_timestamp(),
    encode(extensions.digest('phase730b22a-launder-token', 'sha256'), 'hex'),
    null,
    null,
    '00000000-0000-4000-8000-000000007832'::uuid
  )::text,
  null,
  'factor A removal rejects its stale proof instead of binding surviving factor B'
);
RESET ROLE;
SELECT is(
  (
    SELECT count(*)::integer
    FROM public.admin_sessions
    WHERE id = '00000000-0000-4000-8000-000000007830'::uuid
  ),
  0,
  'factor-set change during login creates no Admin session'
);

INSERT INTO auth.mfa_factors (
  id, user_id, friendly_name, factor_type, status, created_at, updated_at
) VALUES (
  '00000000-0000-4000-8000-000000007803'::uuid,
  '00000000-0000-4000-8000-000000007801'::uuid,
  'phase730b22a-first-restored',
  'totp', 'verified', statement_timestamp(), statement_timestamp()
);

-- A direct caller cannot ask the INSERT trigger to replace a stale expected
-- hash with the then-current DB value.
SET ROLE service_role;
SELECT ok(
  public.begin_admin_totp_step_up_v2(
    '00000000-0000-4000-8000-000000007805'::uuid,
    '00000000-0000-4000-8000-000000007801'::uuid,
    '00000000-0000-4000-8000-000000007802'::uuid,
    '00000000-0000-4000-8000-000000007804'::uuid,
    encode(extensions.digest('phase730b22a-trigger-nonce', 'sha256'), 'hex'),
    '00000000-0000-4000-8000-000000007833'::uuid,
    encode(extensions.digest('phase730b22a-trigger-prejwt', 'sha256'), 'hex'),
    '00000000-0000-4000-8000-000000007834'::uuid
  ) IS NOT NULL,
  'trigger mismatch fixture has an otherwise valid factor-bound nonce'
);
RESET ROLE;
SELECT throws_ok(
  $$
    INSERT INTO public.admin_sessions (
      id, token_hash, auth_user_id, pin_version_hash, authentication_method,
      aal, principal_id, membership_id, environment_id,
      supabase_auth_session_id, step_up_verified_at, step_up_nonce_id,
      verified_totp_factor_set_hash, issued_at, last_seen_at,
      idle_expires_at, expires_at
    )
    SELECT
      '00000000-0000-4000-8000-000000007833'::uuid,
      encode(extensions.digest('phase730b22a-trigger-token', 'sha256'), 'hex'),
      '00000000-0000-4000-8000-000000007801'::uuid,
      null, 'google_totp', 2,
      '00000000-0000-4000-8000-000000007806'::uuid,
      '00000000-0000-4000-8000-000000007807'::uuid,
      '00000000-0000-4000-8000-000000007805'::uuid,
      '00000000-0000-4000-8000-000000007802'::uuid,
      statement_timestamp(), nonce.id, repeat('1', 64),
      statement_timestamp(), statement_timestamp(),
      statement_timestamp() + interval '8 hours',
      statement_timestamp() + interval '8 hours'
    FROM private.admin_step_up_nonces AS nonce
    WHERE nonce.reserved_admin_session_id =
      '00000000-0000-4000-8000-000000007833'::uuid
  $$,
  'P7330',
  'verified TOTP factor set changed during session issue',
  'session INSERT trigger rejects rather than laundering a mismatched expected factor set'
);

SELECT throws_ok(
  $$
    INSERT INTO public.admin_sessions (
      id, token_hash, auth_user_id, pin_version_hash, authentication_method,
      aal, principal_id, membership_id, environment_id,
      supabase_auth_session_id, step_up_verified_at, step_up_nonce_id,
      verified_totp_factor_set_hash, issued_at, last_seen_at,
      idle_expires_at, expires_at
    ) VALUES (
      '00000000-0000-4000-8000-000000007846'::uuid,
      repeat('a', 64),
      '00000000-0000-4000-8000-000000007801'::uuid,
      null, 'google_totp', 2,
      '00000000-0000-4000-8000-000000007806'::uuid,
      '00000000-0000-4000-8000-000000007807'::uuid,
      '00000000-0000-4000-8000-000000007805'::uuid,
      '00000000-0000-4000-8000-000000007802'::uuid,
      statement_timestamp(),
      '00000000-0000-4000-8000-000000007847'::uuid,
      'b907a60aa6717a40eb1992e769992cc70f870d751fc5f8f0376db719814ffe3a',
      statement_timestamp(), statement_timestamp(),
      statement_timestamp() + interval '8 hours',
      statement_timestamp() + interval '8 hours'
    )
  $$,
  'P7330',
  'Google Admin session requires bound completed TOTP evidence',
  'direct service-style session INSERT cannot bypass pending nonce evidence'
);

UPDATE private.admin_step_up_nonces
SET status = 'superseded', updated_at = statement_timestamp()
WHERE reserved_admin_session_id =
  '00000000-0000-4000-8000-000000007833'::uuid
  AND status = 'pending';

INSERT INTO private.admin_step_up_nonces (
  id,
  nonce_hash,
  reserved_admin_session_id,
  environment_id,
  principal_id,
  membership_id,
  supabase_auth_session_id,
  intended_action,
  request_id,
  prechallenge_jwt_hash,
  min_amr_at,
  challenged_totp_factor_id,
  prechallenge_verified_totp_factor_set_hash,
  verified_totp_factor_set_hash,
  factor_set_bootstrap_allowed,
  approved_totp_factor_set_version,
  issued_at,
  expires_at
) VALUES (
  '00000000-0000-4000-8000-000000007808'::uuid,
  repeat('1', 64),
  '00000000-0000-4000-8000-000000007809'::uuid,
  '00000000-0000-4000-8000-000000007805'::uuid,
  '00000000-0000-4000-8000-000000007806'::uuid,
  '00000000-0000-4000-8000-000000007807'::uuid,
  '00000000-0000-4000-8000-000000007802'::uuid,
  'admin_login',
  '00000000-0000-4000-8000-00000000780a'::uuid,
  repeat('2', 64),
  statement_timestamp() - interval '1 minute',
  '00000000-0000-4000-8000-000000007804'::uuid,
  private.current_verified_totp_factor_set_hash_v1(
    '00000000-0000-4000-8000-000000007801'::uuid
  ),
  private.current_verified_totp_factor_set_hash_v1(
    '00000000-0000-4000-8000-000000007801'::uuid
  ),
  false,
  1,
  statement_timestamp() - interval '1 minute',
  statement_timestamp() + interval '4 minutes'
);

SELECT throws_ok(
  $$
    INSERT INTO public.admin_sessions (
      id, token_hash, auth_user_id, pin_version_hash, authentication_method,
      aal, principal_id, membership_id, environment_id,
      supabase_auth_session_id, step_up_verified_at, step_up_nonce_id,
      verified_totp_factor_set_hash, issued_at, last_seen_at,
      idle_expires_at, expires_at
    ) VALUES (
      '00000000-0000-4000-8000-000000007809'::uuid,
      repeat('3', 64),
      '00000000-0000-4000-8000-000000007801'::uuid,
      null, 'google_totp', 2,
      '00000000-0000-4000-8000-000000007806'::uuid,
      '00000000-0000-4000-8000-000000007807'::uuid,
      '00000000-0000-4000-8000-000000007805'::uuid,
      '00000000-0000-4000-8000-000000007802'::uuid,
      statement_timestamp(),
      '00000000-0000-4000-8000-000000007808'::uuid,
      'b907a60aa6717a40eb1992e769992cc70f870d751fc5f8f0376db719814ffe3a',
      statement_timestamp() - interval '1 hour',
      statement_timestamp() - interval '1 hour',
      statement_timestamp() + interval '12 hours',
      statement_timestamp() + interval '12 hours'
    )
  $$,
  'P7330',
  'Google Admin session requires bound completed TOTP evidence',
  'a valid pending nonce without post-challenge evidence cannot issue a session'
);

UPDATE private.admin_step_up_nonces
SET
  completion_jwt_hash = repeat('4', 64),
  verified_totp_amr_at = statement_timestamp(),
  updated_at = statement_timestamp()
WHERE id = '00000000-0000-4000-8000-000000007808'::uuid;

UPDATE private.admin_identity_runtime_gate
SET google_session_issue_enabled = false
WHERE singleton;
SELECT throws_ok(
  $$
    INSERT INTO public.admin_sessions (
      id, token_hash, auth_user_id, pin_version_hash, authentication_method,
      aal, principal_id, membership_id, environment_id,
      supabase_auth_session_id, step_up_verified_at, step_up_nonce_id,
      verified_totp_factor_set_hash, issued_at, last_seen_at,
      idle_expires_at, expires_at
    ) VALUES (
      '00000000-0000-4000-8000-000000007809'::uuid,
      repeat('3', 64),
      '00000000-0000-4000-8000-000000007801'::uuid,
      null, 'google_totp', 2,
      '00000000-0000-4000-8000-000000007806'::uuid,
      '00000000-0000-4000-8000-000000007807'::uuid,
      '00000000-0000-4000-8000-000000007805'::uuid,
      '00000000-0000-4000-8000-000000007802'::uuid,
      statement_timestamp(),
      '00000000-0000-4000-8000-000000007808'::uuid,
      'b907a60aa6717a40eb1992e769992cc70f870d751fc5f8f0376db719814ffe3a',
      statement_timestamp() - interval '1 hour',
      statement_timestamp() - interval '1 hour',
      statement_timestamp() + interval '12 hours',
      statement_timestamp() + interval '12 hours'
    )
  $$,
  'P7300',
  'Admin Google identity is disabled',
  'otherwise-valid completed evidence cannot bypass the default-OFF issue gate'
);
UPDATE private.admin_identity_runtime_gate
SET google_session_issue_enabled = true
WHERE singleton;

INSERT INTO public.admin_sessions (
  id,
  token_hash,
  auth_user_id,
  pin_version_hash,
  authentication_method,
  aal,
  principal_id,
  membership_id,
  environment_id,
  supabase_auth_session_id,
  step_up_verified_at,
  step_up_nonce_id,
  verified_totp_factor_set_hash,
  issued_at,
  last_seen_at,
  idle_expires_at,
  expires_at
) VALUES (
  '00000000-0000-4000-8000-000000007809'::uuid,
  repeat('3', 64),
  '00000000-0000-4000-8000-000000007801'::uuid,
  null,
  'google_totp',
  2,
  '00000000-0000-4000-8000-000000007806'::uuid,
  '00000000-0000-4000-8000-000000007807'::uuid,
  '00000000-0000-4000-8000-000000007805'::uuid,
  '00000000-0000-4000-8000-000000007802'::uuid,
  statement_timestamp(),
  '00000000-0000-4000-8000-000000007808'::uuid,
  private.current_verified_totp_factor_set_hash_v1(
    '00000000-0000-4000-8000-000000007801'::uuid
  ),
  statement_timestamp() - interval '1 hour',
  statement_timestamp() - interval '1 hour',
  statement_timestamp() + interval '12 hours',
  statement_timestamp() + interval '12 hours'
);

UPDATE private.admin_step_up_nonces
SET
  status = 'consumed',
  consumed_at = statement_timestamp(),
  completed_admin_session_id = '00000000-0000-4000-8000-000000007809'::uuid,
  completion_jwt_hash = repeat('4', 64),
  verified_totp_amr_at = statement_timestamp(),
  verified_totp_factor_set_hash = (
    SELECT verified_totp_factor_set_hash
    FROM public.admin_sessions
    WHERE id = '00000000-0000-4000-8000-000000007809'::uuid
  ),
  updated_at = statement_timestamp() - interval '1 hour'
WHERE id = '00000000-0000-4000-8000-000000007808'::uuid;

SELECT ok(
  (
    SELECT verified_totp_factor_set_hash IS NOT NULL
      AND expires_at = auth_session.created_at + interval '8 hours'
      AND idle_expires_at = expires_at
    FROM public.admin_sessions AS session
    JOIN auth.sessions AS auth_session
      ON auth_session.id = session.supabase_auth_session_id
    WHERE session.id = '00000000-0000-4000-8000-000000007809'::uuid
  ),
  'new Google Admin session binds factor set and preserves 8h/no-idle semantics'
);

SELECT throws_ok(
  $$
    UPDATE public.admin_sessions
    SET
      authentication_method = 'legacy_pin',
      aal = 1,
      pin_version_hash = repeat('5', 64),
      auth_user_id = null,
      principal_id = null,
      membership_id = null,
      environment_id = null,
      supabase_auth_session_id = null,
      step_up_verified_at = null,
      step_up_nonce_id = null,
      verified_totp_factor_set_hash = null
    WHERE id = '00000000-0000-4000-8000-000000007809'::uuid
  $$,
  '23514',
  'Google Admin identity/factor-set binding is immutable',
  'a Google TOTP session cannot compound-downgrade into a legacy PIN session'
);

INSERT INTO private.admin_ai_unlock_factors (
  id,
  environment_id,
  principal_id,
  membership_id,
  pin_verifier,
  pin_pepper_version,
  factor_version,
  enrolled_by_admin_session_id,
  enrolled_step_up_verified_at,
  enrollment_request_id
) VALUES (
  '00000000-0000-4000-8000-00000000780b'::uuid,
  '00000000-0000-4000-8000-000000007805'::uuid,
  '00000000-0000-4000-8000-000000007806'::uuid,
  '00000000-0000-4000-8000-000000007807'::uuid,
  extensions.crypt(repeat('5', 64), extensions.gen_salt('bf', 12)),
  1,
  1,
  '00000000-0000-4000-8000-000000007809'::uuid,
  statement_timestamp() - interval '1 hour',
  '00000000-0000-4000-8000-00000000780c'::uuid
);

UPDATE private.admin_identity_runtime_gate
SET google_session_issue_enabled = true
WHERE singleton;
UPDATE private.admin_ai_unlock_runtime_gate
SET ai_unlock_enabled = true
WHERE singleton;

SET ROLE service_role;
SELECT is(
  public.get_admin_ai_unlock_profile_v1(
    repeat('3', 64),
    '00000000-0000-4000-8000-000000007801'::uuid,
    '00000000-0000-4000-8000-000000007802'::uuid
  ) ->> 'active_pin',
  'true',
  'profile is available without a periodic fresh-TOTP requirement'
);

SELECT is(
  public.begin_admin_control_step_up_v1(
    repeat('3', 64),
    '00000000-0000-4000-8000-000000007801'::uuid,
    '00000000-0000-4000-8000-000000007802'::uuid,
    'ai_pin_rotate',
    '00000000-0000-4000-8000-000000007810'::uuid,
    repeat('6', 64),
    repeat('7', 64),
    encode(
      extensions.digest(
        convert_to(
          'compass:phase7.30:admin-control-intent:v1|action=ai_pin_rotate'
          || '|pin_pepper_version=2|peppered_pin_hmac=' || repeat('9', 64),
          'UTF8'
        ),
        'sha256'
      ),
      'hex'
    )
  ) ->> 'status',
  'pending',
  'rare PIN rotation starts an action/request/session-bound challenge'
);

SELECT is(
  public.complete_admin_control_step_up_v1(
    repeat('3', 64),
    '00000000-0000-4000-8000-000000007801'::uuid,
    '00000000-0000-4000-8000-000000007802'::uuid,
    'ai_pin_rotate',
    encode(
      extensions.digest(
        convert_to(
          'compass:phase7.30:admin-control-intent:v1|action=ai_pin_rotate'
          || '|pin_pepper_version=2|peppered_pin_hmac=' || repeat('9', 64),
          'UTF8'
        ),
        'sha256'
      ),
      'hex'
    ),
    '00000000-0000-4000-8000-000000007810'::uuid,
    repeat('6', 64),
    repeat('8', 64),
    statement_timestamp(),
    'totp',
    statement_timestamp()
  ) ->> 'status',
  'available',
  'fresh TOTP completion creates one five-minute control grant'
);

SELECT ok(
  public.enroll_admin_ai_pin_v1(
    repeat('3', 64),
    '00000000-0000-4000-8000-000000007801'::uuid,
    '00000000-0000-4000-8000-000000007802'::uuid,
    repeat('4', 64),
    2,
    '00000000-0000-4000-8000-000000007810'::uuid
  ) IS NULL,
  'same request cannot substitute different PIN material after TOTP completion'
);

SELECT is(
  public.enroll_admin_ai_pin_v1(
    repeat('3', 64),
    '00000000-0000-4000-8000-000000007801'::uuid,
    '00000000-0000-4000-8000-000000007802'::uuid,
    repeat('9', 64),
    2,
    '00000000-0000-4000-8000-000000007810'::uuid
  ) ->> 'factor_version',
  '2',
  'the exact mutation consumes its grant and rotates the personal AI PIN'
);
RESET ROLE;

SELECT ok(
  (
    SELECT status = 'consumed' AND consumed_at IS NOT NULL
    FROM private.admin_control_step_up_grants
    WHERE mutation_request_id = '00000000-0000-4000-8000-000000007810'::uuid
  ),
  'control grant is single-use after the committed mutation'
);

INSERT INTO private.admin_control_step_up_nonces (
  nonce_hash,
  environment_id,
  principal_id,
  membership_id,
  admin_session_id,
  supabase_auth_session_id,
  verified_totp_factor_set_hash,
  intended_action,
  intent_digest,
  mutation_request_id,
  prechallenge_jwt_hash,
  min_amr_at,
  expires_at
)
SELECT
  repeat('a', 64),
  session.environment_id,
  session.principal_id,
  session.membership_id,
  session.id,
  session.supabase_auth_session_id,
  session.verified_totp_factor_set_hash,
  'ai_pin_revoke',
  repeat('c', 64),
  '00000000-0000-4000-8000-000000007811'::uuid,
  repeat('b', 64),
  statement_timestamp(),
  statement_timestamp() + interval '5 minutes'
FROM public.admin_sessions AS session
WHERE session.id = '00000000-0000-4000-8000-000000007809'::uuid;

INSERT INTO private.admin_control_step_up_nonces (
  nonce_hash, environment_id, principal_id, membership_id, admin_session_id,
  supabase_auth_session_id, verified_totp_factor_set_hash, intended_action,
  intent_digest, mutation_request_id, prechallenge_jwt_hash, min_amr_at,
  issued_at, expires_at, status
)
SELECT
  encode(extensions.digest('phase730b22a-control-rate-exact', 'sha256'), 'hex'),
  session.environment_id, session.principal_id, session.membership_id, session.id,
  session.supabase_auth_session_id, session.verified_totp_factor_set_hash,
  'environment_ai_policy_change', repeat('d', 64),
  '00000000-0000-4000-8000-00000000784b'::uuid, repeat('e', 64),
  statement_timestamp(), statement_timestamp(),
  statement_timestamp() + interval '5 minutes', 'superseded'
FROM public.admin_sessions AS session
WHERE session.id = '00000000-0000-4000-8000-000000007809'::uuid;

INSERT INTO private.admin_control_step_up_nonces (
  nonce_hash, environment_id, principal_id, membership_id, admin_session_id,
  supabase_auth_session_id, verified_totp_factor_set_hash, intended_action,
  intent_digest, mutation_request_id, prechallenge_jwt_hash, min_amr_at,
  issued_at, expires_at, status
)
SELECT
  encode(
    extensions.digest('phase730b22a-control-rate-' || series.value::text, 'sha256'),
    'hex'
  ),
  session.environment_id, session.principal_id, session.membership_id, session.id,
  session.supabase_auth_session_id, session.verified_totp_factor_set_hash,
  'environment_ai_policy_change', repeat('d', 64),
  extensions.gen_random_uuid(), repeat('e', 64), statement_timestamp(),
  statement_timestamp(), statement_timestamp() + interval '5 minutes',
  'superseded'
FROM public.admin_sessions AS session
CROSS JOIN generate_series(1, 9) AS series(value)
WHERE session.id = '00000000-0000-4000-8000-000000007809'::uuid;

SET ROLE service_role;
SELECT is(
  public.begin_admin_control_step_up_v1(
    repeat('3', 64),
    '00000000-0000-4000-8000-000000007801'::uuid,
    '00000000-0000-4000-8000-000000007802'::uuid,
    'environment_ai_policy_change',
    '00000000-0000-4000-8000-00000000784b'::uuid,
    encode(extensions.digest('phase730b22a-control-rate-exact', 'sha256'), 'hex'),
    repeat('e', 64),
    repeat('d', 64)
  ) ->> 'status',
  'superseded',
  'exact control-begin retry is returned before rate accounting'
);
SELECT throws_ok(
  $$
    SELECT public.begin_admin_control_step_up_v1(
      repeat('3', 64),
      '00000000-0000-4000-8000-000000007801'::uuid,
      '00000000-0000-4000-8000-000000007802'::uuid,
      'environment_ai_policy_change',
      '00000000-0000-4000-8000-00000000784c'::uuid,
      encode(extensions.digest('phase730b22a-control-rate-new', 'sha256'), 'hex'),
      repeat('f', 64),
      repeat('d', 64)
    )
  $$,
  'P7301',
  'Admin control step-up rate exceeded',
  'new control-begin requests are bounded to ten per five minutes'
);
RESET ROLE;
SELECT ok(
  (
    SELECT count(*) = 10
    FROM private.admin_control_step_up_nonces
    WHERE admin_session_id = '00000000-0000-4000-8000-000000007809'::uuid
      AND intended_action = 'environment_ai_policy_change'
      AND issued_at >= statement_timestamp() - interval '5 minutes'
  )
  AND NOT EXISTS (
    SELECT 1
    FROM private.admin_audit_events
    WHERE request_id = '00000000-0000-4000-8000-00000000784c'::uuid
  ),
  'rate rejection creates neither a nonce nor an audit row'
);

SET ROLE service_role;
SELECT is(
  public.reconcile_admin_totp_factor_set_v1(
    '00000000-0000-4000-8000-000000007801'::uuid,
    '00000000-0000-4000-8000-000000007848'::uuid
  ) ->> 'revoked_sessions',
  '0',
  'factor reconciliation no-op returns without writing audit storage'
);
SELECT is(
  public.reconcile_admin_totp_factor_set_v1(
    '00000000-0000-4000-8000-000000007849'::uuid,
    '00000000-0000-4000-8000-00000000784a'::uuid
  )::text,
  null,
  'a valid Auth user without an active Admin principal cannot reconcile'
);
RESET ROLE;
SELECT is(
  (
    SELECT count(*)::integer
    FROM private.admin_audit_events
    WHERE request_id IN (
      '00000000-0000-4000-8000-000000007848'::uuid,
      '00000000-0000-4000-8000-00000000784a'::uuid
    )
  ),
  0,
  'non-admin and no-op reconciliation add no audit rows'
);

INSERT INTO auth.mfa_factors (
  id,
  user_id,
  friendly_name,
  factor_type,
  status,
  created_at,
  updated_at
) VALUES (
  '00000000-0000-4000-8000-000000007812'::uuid,
  '00000000-0000-4000-8000-000000007801'::uuid,
  'phase730b22a-new-factor',
  'totp',
  'verified',
  statement_timestamp(),
  statement_timestamp()
);

SET ROLE service_role;
SELECT is(
  public.reconcile_admin_totp_factor_set_v1(
    '00000000-0000-4000-8000-000000007801'::uuid,
    '00000000-0000-4000-8000-000000007813'::uuid
  ) ->> 'revoked_sessions',
  '1',
  'factor-set change explicitly revokes every stale Admin session'
);
RESET ROLE;

SELECT ok(
  (
    SELECT revoked_at IS NOT NULL
      AND revoke_reason = 'totp_factor_set_changed'
    FROM public.admin_sessions
    WHERE id = '00000000-0000-4000-8000-000000007809'::uuid
  )
  AND (
    SELECT status = 'superseded'
    FROM private.admin_control_step_up_nonces
    WHERE mutation_request_id = '00000000-0000-4000-8000-000000007811'::uuid
  ),
  'factor-set reconciliation drains session-bound pending AI authority'
);
SELECT is(
  (
    SELECT count(*)::integer
    FROM private.admin_audit_events
    WHERE request_id = '00000000-0000-4000-8000-000000007813'::uuid
      AND action = 'admin_session.factor_set_reconcile'
  ),
  1,
  'factor reconciliation writes one audit row only for a committed revoke'
);

SELECT * FROM finish();
ROLLBACK;
