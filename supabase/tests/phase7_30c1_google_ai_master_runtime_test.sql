BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path = public, extensions;
SELECT no_plan();

INSERT INTO auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) VALUES (
  '00000000-0000-0000-0000-000000000000'::uuid,
  '00000000-0000-4000-8000-00000000c102'::uuid,
  'authenticated', 'authenticated', 'phase730c1@example.test', '',
  statement_timestamp() - interval '1 hour',
  '{"provider":"google","providers":["google"]}'::jsonb, '{}'::jsonb,
  statement_timestamp() - interval '1 hour',
  statement_timestamp() - interval '1 hour'
);
INSERT INTO auth.sessions (id, user_id, created_at, updated_at) VALUES (
  '00000000-0000-4000-8000-00000000c103'::uuid,
  '00000000-0000-4000-8000-00000000c102'::uuid,
  statement_timestamp() - interval '1 hour',
  statement_timestamp() - interval '1 hour'
);
INSERT INTO auth.mfa_factors (
  id, user_id, friendly_name, factor_type, status, created_at, updated_at
) VALUES (
  '00000000-0000-4000-8000-00000000c104'::uuid,
  '00000000-0000-4000-8000-00000000c102'::uuid,
  'phase730c1-totp', 'totp', 'verified',
  statement_timestamp() - interval '1 hour',
  statement_timestamp() - interval '1 hour'
);

INSERT INTO private.admin_environments (
  id, environment_kind, canonical_admin_origin, supabase_issuer,
  current_deployment, bootstrap_sealed_at, owner_invariant_enforced_at
) VALUES (
  '00000000-0000-4000-8000-00000000c101'::uuid,
  'local', 'http://127.0.0.1:5173',
  'http://127.0.0.1:54321/auth/v1', true,
  statement_timestamp() - interval '1 hour',
  statement_timestamp() - interval '1 hour'
);
INSERT INTO private.admin_principals (
  id, auth_user_id, google_issuer, provider_subject_hmac,
  subject_pepper_version, normalized_email, email_verified_at
) VALUES (
  '00000000-0000-4000-8000-00000000c105'::uuid,
  '00000000-0000-4000-8000-00000000c102'::uuid,
  'https://accounts.google.com', repeat('a', 64), 1,
  'phase730c1@example.test', statement_timestamp() - interval '1 hour'
);
UPDATE private.admin_principals
SET
  approved_totp_factor_set_hash = snapshot.factor_set_hash,
  approved_totp_factor_set_version = 1,
  approved_totp_factor_count = snapshot.factor_count,
  approved_totp_factor_set_at = statement_timestamp() - interval '30 minutes',
  approved_totp_factor_set_request_id =
    '00000000-0000-4000-8000-00000000c10b'::uuid,
  approved_totp_factor_set_source = 'operator_adoption',
  approved_totp_factor_set_actor = 'fixture:phase730c1',
  approved_totp_factor_set_reason = 'C1 atomic admission runtime fixture'
FROM private.current_verified_totp_factor_set_snapshot_v1(
  '00000000-0000-4000-8000-00000000c102'::uuid
) AS snapshot
WHERE id = '00000000-0000-4000-8000-00000000c105'::uuid;
INSERT INTO private.admin_environment_memberships (
  id, environment_id, principal_id, role, status, can_use_ai, activated_at
) VALUES (
  '00000000-0000-4000-8000-00000000c106'::uuid,
  '00000000-0000-4000-8000-00000000c101'::uuid,
  '00000000-0000-4000-8000-00000000c105'::uuid,
  'owner', 'active', true, statement_timestamp() - interval '1 hour'
);

INSERT INTO private.admin_step_up_nonces (
  id, nonce_hash, reserved_admin_session_id, environment_id, principal_id,
  membership_id, supabase_auth_session_id, intended_action, request_id,
  prechallenge_jwt_hash, min_amr_at, challenged_totp_factor_id,
  prechallenge_verified_totp_factor_set_hash,
  verified_totp_factor_set_hash, factor_set_bootstrap_allowed,
  approved_totp_factor_set_version, completion_jwt_hash,
  verified_totp_amr_at, issued_at, expires_at
) VALUES (
  '00000000-0000-4000-8000-00000000c107'::uuid,
  repeat('2', 64),
  '00000000-0000-4000-8000-00000000c108'::uuid,
  '00000000-0000-4000-8000-00000000c101'::uuid,
  '00000000-0000-4000-8000-00000000c105'::uuid,
  '00000000-0000-4000-8000-00000000c106'::uuid,
  '00000000-0000-4000-8000-00000000c103'::uuid,
  'admin_login',
  '00000000-0000-4000-8000-00000000c10c'::uuid,
  repeat('3', 64), statement_timestamp() - interval '1 minute',
  '00000000-0000-4000-8000-00000000c104'::uuid,
  private.current_verified_totp_factor_set_hash_v1(
    '00000000-0000-4000-8000-00000000c102'::uuid
  ),
  private.current_verified_totp_factor_set_hash_v1(
    '00000000-0000-4000-8000-00000000c102'::uuid
  ),
  false, 1, repeat('4', 64), statement_timestamp(),
  statement_timestamp() - interval '1 minute',
  statement_timestamp() + interval '4 minutes'
);
UPDATE private.admin_identity_runtime_gate
SET google_session_issue_enabled = true
WHERE singleton;
INSERT INTO public.admin_sessions (
  id, token_hash, auth_user_id, pin_version_hash, authentication_method, aal,
  principal_id, membership_id, environment_id, supabase_auth_session_id,
  step_up_verified_at, step_up_nonce_id, verified_totp_factor_set_hash,
  issued_at, last_seen_at, idle_expires_at, expires_at
) VALUES (
  '00000000-0000-4000-8000-00000000c108'::uuid,
  repeat('1', 64),
  '00000000-0000-4000-8000-00000000c102'::uuid,
  null, 'google_totp', 2,
  '00000000-0000-4000-8000-00000000c105'::uuid,
  '00000000-0000-4000-8000-00000000c106'::uuid,
  '00000000-0000-4000-8000-00000000c101'::uuid,
  '00000000-0000-4000-8000-00000000c103'::uuid,
  statement_timestamp(),
  '00000000-0000-4000-8000-00000000c107'::uuid,
  private.current_verified_totp_factor_set_hash_v1(
    '00000000-0000-4000-8000-00000000c102'::uuid
  ),
  statement_timestamp() - interval '1 hour',
  statement_timestamp() - interval '1 hour',
  statement_timestamp() + interval '12 hours',
  statement_timestamp() + interval '12 hours'
);
UPDATE private.admin_step_up_nonces
SET status = 'consumed', consumed_at = statement_timestamp(),
    completed_admin_session_id =
      '00000000-0000-4000-8000-00000000c108'::uuid,
    updated_at = statement_timestamp()
WHERE id = '00000000-0000-4000-8000-00000000c107'::uuid;

INSERT INTO private.admin_ai_unlock_factors (
  id, environment_id, principal_id, membership_id, pin_verifier,
  pin_pepper_version, factor_version, enrolled_by_admin_session_id,
  enrolled_step_up_verified_at, enrollment_request_id
) VALUES (
  '00000000-0000-4000-8000-00000000c109'::uuid,
  '00000000-0000-4000-8000-00000000c101'::uuid,
  '00000000-0000-4000-8000-00000000c105'::uuid,
  '00000000-0000-4000-8000-00000000c106'::uuid,
  extensions.crypt(repeat('e', 64), extensions.gen_salt('bf', 12)),
  1, 1,
  '00000000-0000-4000-8000-00000000c108'::uuid,
  statement_timestamp(),
  '00000000-0000-4000-8000-00000000c10d'::uuid
);
INSERT INTO private.admin_ai_policies (
  id, environment_id, membership_id, allowed_actions, allowed_models,
  max_calls_per_lecture, max_calls_per_day,
  max_input_tokens_per_lecture, max_input_tokens_per_day,
  max_output_tokens_per_lecture, max_output_tokens_per_day,
  max_cost_microusd_per_lecture, max_cost_microusd_per_day,
  max_realtime_minutes_per_lecture, max_realtime_minutes_per_day,
  max_concurrency, valid_from, valid_until, version,
  created_by_membership_id, created_by_admin_session_id, request_id
) VALUES (
  '00000000-0000-4000-8000-00000000c10a'::uuid,
  '00000000-0000-4000-8000-00000000c101'::uuid,
  '00000000-0000-4000-8000-00000000c106'::uuid,
  array[
    'academic_answers', 'captions', 'material_analysis',
    'poll_suggestions', 'summaries'
  ]::text[],
  array['test-model']::text[],
  10, 100, 10000, 100000, 10000, 100000, 100000, 1000000,
  90, 900, 1,
  statement_timestamp() - interval '1 minute',
  statement_timestamp() + interval '2 hours',
  1,
  '00000000-0000-4000-8000-00000000c106'::uuid,
  '00000000-0000-4000-8000-00000000c108'::uuid,
  '00000000-0000-4000-8000-00000000c10e'::uuid
);
UPDATE private.admin_ai_unlock_runtime_gate
SET ai_unlock_enabled = true, remembered_browser_enabled = true
WHERE singleton;

SET ROLE service_role;
SELECT throws_ok(
  $$
    SELECT public.create_owned_admin_lecture_v1(
      repeat('1', 64),
      '00000000-0000-4000-8000-00000000c102'::uuid,
      '00000000-0000-4000-8000-00000000c103'::uuid,
      'C1 owned lecture',
      encode(extensions.digest(convert_to('123456', 'UTF8'), 'sha256'), 'hex'),
      '123456', null::timestamptz, null::timestamptz,
      '00000000-0000-4000-8000-00000000c110'::uuid
    )
  $$,
  'P7336',
  'Google AI master admission is disabled',
  'gate-OFF rejects a new owned lecture'
);
RESET ROLE;
UPDATE private.admin_ai_unlock_runtime_gate
SET google_ai_master_admission_enabled = true
WHERE singleton;
SET ROLE service_role;
SELECT ok(
  set_config(
    'compass.test.c1_lecture_id',
    public.create_owned_admin_lecture_v1(
      repeat('1', 64),
      '00000000-0000-4000-8000-00000000c102'::uuid,
      '00000000-0000-4000-8000-00000000c103'::uuid,
      'C1 owned lecture',
      encode(extensions.digest(convert_to('123456', 'UTF8'), 'sha256'), 'hex'),
      '123456', null::timestamptz, null::timestamptz,
      '00000000-0000-4000-8000-00000000c110'::uuid
    ) ->> 'lecture_session_id',
    false
  ) IS NOT NULL,
  'verified Google Admin creates one privately owned lecture'
);
SELECT is(
  public.create_owned_admin_lecture_v1(
    repeat('1', 64),
    '00000000-0000-4000-8000-00000000c102'::uuid,
    '00000000-0000-4000-8000-00000000c103'::uuid,
    'C1 owned lecture',
    encode(extensions.digest(convert_to('123456', 'UTF8'), 'sha256'), 'hex'),
    '123456', null::timestamptz, null::timestamptz,
    '00000000-0000-4000-8000-00000000c110'::uuid
  ) ->> 'lecture_session_id',
  current_setting('compass.test.c1_lecture_id'),
  'owned lecture exact replay converges'
);
SELECT is(
  public.create_owned_admin_lecture_v1(
    repeat('1', 64),
    '00000000-0000-4000-8000-00000000c102'::uuid,
    '00000000-0000-4000-8000-00000000c103'::uuid,
    'changed title',
    encode(extensions.digest(convert_to('123456', 'UTF8'), 'sha256'), 'hex'),
    '123456', null::timestamptz, null::timestamptz,
    '00000000-0000-4000-8000-00000000c110'::uuid
  )::text,
  null,
  'same ownership request cannot change canonical create input'
);
RESET ROLE;
SELECT is(
  public.admin_set_lecture_status(
    current_setting('compass.test.c1_lecture_id')::uuid,
    'start'
  ),
  true,
  'owned lecture opens through the established lifecycle transition'
);

UPDATE private.admin_ai_unlock_runtime_gate
SET google_ai_master_admission_enabled = false
WHERE singleton;
SET ROLE service_role;
SELECT throws_ok(
  format(
    $$SELECT public.authorize_google_ai_master_with_pin_v1(
      repeat('1',64),
      '00000000-0000-4000-8000-00000000c102'::uuid,
      '00000000-0000-4000-8000-00000000c103'::uuid,
      %L::uuid, 'all_except_captions',
      '00000000-0000-4000-8000-00000000c10a'::uuid, 1,
      repeat('b',64), 1, repeat('e',64),
      '00000000-0000-4000-8000-00000000c120'::uuid
    )$$,
    current_setting('compass.test.c1_lecture_id')
  ),
  'P7336',
  'Google AI master admission is disabled',
  'gate-OFF rejects new PIN admission before consuming proof'
);
RESET ROLE;
UPDATE private.admin_ai_unlock_runtime_gate
SET google_ai_master_admission_enabled = true
WHERE singleton;
SET ROLE service_role;
SELECT is(
  public.authorize_google_ai_master_with_pin_v1(
    repeat('1', 64),
    '00000000-0000-4000-8000-00000000c102'::uuid,
    '00000000-0000-4000-8000-00000000c103'::uuid,
    current_setting('compass.test.c1_lecture_id')::uuid,
    'all_except_captions',
    '00000000-0000-4000-8000-00000000c10a'::uuid, 1,
    repeat('b', 64), 1, repeat('e', 64),
    '00000000-0000-4000-8000-00000000c120'::uuid
  ) ->> 'accepted',
  'true',
  'PIN proof atomically creates a dormant lecture master'
);
RESET ROLE;
SELECT ok(
  (
    SELECT master.status = 'active'
      AND master.principal_id =
        '00000000-0000-4000-8000-00000000c105'::uuid
      AND master.membership_id =
        '00000000-0000-4000-8000-00000000c106'::uuid
      AND master.unlock_method = 'ai_pin'
      AND receipt.pin_attempt_request_id = receipt.request_id
    FROM private.admin_ai_master_admission_receipts AS receipt
    JOIN public.lecture_ai_master_authorizations AS master
      ON master.id = receipt.master_authorization_id
    WHERE receipt.request_id =
      '00000000-0000-4000-8000-00000000c120'::uuid
  ),
  'PIN master and immutable receipt commit together with full provenance'
);

SET ROLE service_role;
SELECT throws_ok(
  format(
    $$SELECT public.authorize_google_ai_master_with_pin_v1(
      repeat('1',64),
      '00000000-0000-4000-8000-00000000c102'::uuid,
      '00000000-0000-4000-8000-00000000c103'::uuid,
      %L::uuid, 'all_including_captions',
      '00000000-0000-4000-8000-00000000c10a'::uuid, 2,
      repeat('b',64), 1, repeat('e',64),
      '00000000-0000-4000-8000-00000000c121'::uuid
    )$$,
    current_setting('compass.test.c1_lecture_id')
  ),
  'P7335',
  'AI policy is unavailable',
  'failed post-PIN policy admission aborts the transaction'
);
RESET ROLE;
SELECT ok(
  NOT EXISTS (
    SELECT 1 FROM private.admin_ai_unlock_attempt_receipts
    WHERE request_id = '00000000-0000-4000-8000-00000000c121'::uuid
  )
  AND NOT EXISTS (
    SELECT 1 FROM private.admin_ai_master_admission_receipts
    WHERE request_id = '00000000-0000-4000-8000-00000000c121'::uuid
  ),
  'failed policy rolls PIN proof and master receipt back together'
);

SET ROLE service_role;
SELECT is(
  public.authorize_google_ai_master_with_pin_v1(
    repeat('1', 64),
    '00000000-0000-4000-8000-00000000c102'::uuid,
    '00000000-0000-4000-8000-00000000c103'::uuid,
    current_setting('compass.test.c1_lecture_id')::uuid,
    'all_except_captions',
    '00000000-0000-4000-8000-00000000c10a'::uuid, 1,
    repeat('b', 64), 1, repeat('f', 64),
    '00000000-0000-4000-8000-00000000c122'::uuid
  ) ->> 'accepted',
  'true',
  'same-session same-scope reuse needs no new PIN proof'
);
SELECT is(
  public.complete_google_ai_master_browser_admission_v1(
    repeat('1', 64),
    '00000000-0000-4000-8000-00000000c102'::uuid,
    '00000000-0000-4000-8000-00000000c103'::uuid,
    current_setting('compass.test.c1_lecture_id')::uuid,
    'all_except_captions',
    '00000000-0000-4000-8000-00000000c10a'::uuid, 1,
    repeat('7', 64), repeat('8', 64),
    'http://127.0.0.1:5173', repeat('9', 64), false,
    '00000000-0000-4000-8000-00000000c127'::uuid
  ) ->> 'accepted',
  'true',
  'same-session same-scope browser request records proof-free reuse'
);
SELECT is(
  public.replay_google_ai_master_admission_v1(
    repeat('1', 64),
    '00000000-0000-4000-8000-00000000c102'::uuid,
    '00000000-0000-4000-8000-00000000c103'::uuid,
    current_setting('compass.test.c1_lecture_id')::uuid,
    'all_including_captions',
    '00000000-0000-4000-8000-00000000c10a'::uuid, 1, 'ai_pin',
    '00000000-0000-4000-8000-00000000c123'::uuid
  )::text,
  null,
  'scope escalation still requires a new AI proof'
);
SELECT is(
  public.authorize_google_ai_master_with_pin_v1(
    repeat('1', 64),
    '00000000-0000-4000-8000-00000000c102'::uuid,
    '00000000-0000-4000-8000-00000000c103'::uuid,
    current_setting('compass.test.c1_lecture_id')::uuid,
    'all_including_captions',
    '00000000-0000-4000-8000-00000000c10a'::uuid, 1,
    repeat('b', 64), 1, repeat('e', 64),
    '00000000-0000-4000-8000-00000000c124'::uuid
  ) ->> 'accepted',
  'true',
  'new PIN proof can explicitly elevate the dormant scope'
);
RESET ROLE;

UPDATE private.admin_ai_unlock_runtime_gate
SET google_ai_master_admission_enabled = false
WHERE singleton;
SET ROLE service_role;
SELECT is(
  public.authorize_google_ai_master_with_pin_v1(
    repeat('1', 64),
    '00000000-0000-4000-8000-00000000c102'::uuid,
    '00000000-0000-4000-8000-00000000c103'::uuid,
    current_setting('compass.test.c1_lecture_id')::uuid,
    'all_including_captions',
    '00000000-0000-4000-8000-00000000c10a'::uuid, 1,
    repeat('b', 64), 1, repeat('e', 64),
    '00000000-0000-4000-8000-00000000c124'::uuid
  ) ->> 'admission_replayed',
  'true',
  'exact admission replay survives gate OFF and proof expiry boundary'
);
SELECT is(
  public.downgrade_google_ai_master_v1(
    repeat('1', 64),
    '00000000-0000-4000-8000-00000000c102'::uuid,
    '00000000-0000-4000-8000-00000000c103'::uuid,
    current_setting('compass.test.c1_lecture_id')::uuid,
    '00000000-0000-4000-8000-00000000c125'::uuid
  ) ->> 'accepted',
  'true',
  'free downgrade remains available gate OFF'
);
SELECT is(
  public.downgrade_google_ai_master_v1(
    repeat('1', 64),
    '00000000-0000-4000-8000-00000000c102'::uuid,
    '00000000-0000-4000-8000-00000000c103'::uuid,
    current_setting('compass.test.c1_lecture_id')::uuid,
    '00000000-0000-4000-8000-00000000c125'::uuid
  ) ->> 'control_replayed',
  'true',
  'downgrade exact retry converges through its immutable receipt'
);
SELECT is(
  public.revoke_google_ai_master_v1(
    repeat('1', 64),
    '00000000-0000-4000-8000-00000000c102'::uuid,
    '00000000-0000-4000-8000-00000000c103'::uuid,
    current_setting('compass.test.c1_lecture_id')::uuid,
    '00000000-0000-4000-8000-00000000c126'::uuid,
    'teacher_requested'
  ) ->> 'accepted',
  'true',
  'revoke remains available gate OFF'
);
SELECT throws_ok(
  format(
    $$SELECT public.downgrade_google_ai_master_v1(
      repeat('1',64),
      '00000000-0000-4000-8000-00000000c102'::uuid,
      '00000000-0000-4000-8000-00000000c103'::uuid,
      %L::uuid,
      '00000000-0000-4000-8000-00000000c126'::uuid
    )$$,
    current_setting('compass.test.c1_lecture_id')
  ),
  'P7335',
  'AI master control request binding mismatch',
  'same control request cannot cross from revoke to downgrade'
);
SELECT is(
  public.get_google_ai_master_status_v1(
    repeat('1', 64),
    '00000000-0000-4000-8000-00000000c102'::uuid,
    '00000000-0000-4000-8000-00000000c103'::uuid,
    current_setting('compass.test.c1_lecture_id')::uuid
  ) -> 'authorization' ->> 'status',
  'revoked',
  'status remains available gate OFF after revoke'
);
SELECT is(
  public.authorize_google_ai_master_with_pin_v1(
    repeat('1', 64),
    '00000000-0000-4000-8000-00000000c102'::uuid,
    '00000000-0000-4000-8000-00000000c103'::uuid,
    current_setting('compass.test.c1_lecture_id')::uuid,
    'all_except_captions',
    '00000000-0000-4000-8000-00000000c10a'::uuid, 1,
    repeat('b', 64), 1, repeat('f', 64),
    '00000000-0000-4000-8000-00000000c122'::uuid
  ) -> 'authorization' ->> 'status',
  'revoked',
  'stale proof-free PIN request returns its recorded terminal master'
);
SELECT is(
  public.complete_google_ai_master_browser_admission_v1(
    repeat('1', 64),
    '00000000-0000-4000-8000-00000000c102'::uuid,
    '00000000-0000-4000-8000-00000000c103'::uuid,
    current_setting('compass.test.c1_lecture_id')::uuid,
    'all_except_captions',
    '00000000-0000-4000-8000-00000000c10a'::uuid, 1,
    repeat('7', 64), repeat('8', 64),
    'http://127.0.0.1:5173', repeat('9', 64), false,
    '00000000-0000-4000-8000-00000000c127'::uuid
  ) -> 'authorization' ->> 'status',
  'revoked',
  'stale proof-free browser request returns its recorded terminal master'
);
SELECT is(
  (
    SELECT count(*)::integer
    FROM public.lecture_ai_master_authorizations AS master
    WHERE master.lecture_session_id =
      current_setting('compass.test.c1_lecture_id')::uuid
      AND master.status = 'active'
  ),
  0,
  'stale reuse retries cannot resurrect revoked authority'
);
SELECT is(
  public.admin_authorize_ai_master(
    current_setting('compass.test.c1_lecture_id')::uuid,
    '00000000-0000-4000-8000-00000000c108'::uuid,
    'admin-session:00000000-0000-4000-8000-00000000c108',
    'all_except_captions', true
  ) ->> 'reason',
  'google_master_requires_c2',
  'owned lecture remains fenced from legacy master after C1 revoke'
);
SELECT is(
  public.admin_issue_ai_billing_grant_from_master(
    current_setting('compass.test.c1_lecture_id')::uuid,
    '00000000-0000-4000-8000-00000000c108'::uuid,
    array['summaries']::text[], repeat('5', 64),
    'admin-session:00000000-0000-4000-8000-00000000c108'
  ) ->> 'reason',
  'google_master_child_grant_deferred_to_c2',
  'owned lecture remains fenced from legacy child issue after C1 revoke'
);
RESET ROLE;

SELECT throws_ok(
  format(
    $$INSERT INTO public.ai_billing_grants (
      lecture_session_id, actor_id, actions, nonce_hash, expires_at
    ) VALUES (
      %L::uuid, 'admin-session:00000000-0000-4000-8000-00000000c108',
      array['summaries']::text[], repeat('6',64),
      statement_timestamp() + interval '2 minutes'
    )$$,
    current_setting('compass.test.c1_lecture_id')
  ),
  'P7335',
  'C2 owned lecture child authority requires Google evidence',
  'owned lecture rejects direct null-master grants after revoke'
);

-- A grant issued before ownership appears must also fail at consume time.
INSERT INTO public.lecture_sessions (
  id, title, code_hash, status, starts_at, started_at, hard_stop_at, ends_at
) VALUES (
  '00000000-0000-4000-8000-00000000c140'::uuid,
  'C1 preissued grant race', repeat('7', 64), 'open',
  statement_timestamp() - interval '1 minute',
  statement_timestamp() - interval '1 minute',
  statement_timestamp() + interval '1 hour',
  statement_timestamp() + interval '1 hour'
);
INSERT INTO public.ai_billing_grants (
  id, lecture_session_id, actor_id, actions, nonce_hash, expires_at
) VALUES (
  '00000000-0000-4000-8000-00000000c141'::uuid,
  '00000000-0000-4000-8000-00000000c140'::uuid,
  'admin-session:00000000-0000-4000-8000-00000000c108',
  array['summaries']::text[], repeat('8', 64),
  statement_timestamp() + interval '2 minutes'
);
INSERT INTO private.admin_lecture_ownerships (
  lecture_session_id, environment_id, principal_id, membership_id,
  assigned_by_admin_session_id, ownership_request_id, ownership_intent_digest
) VALUES (
  '00000000-0000-4000-8000-00000000c140'::uuid,
  '00000000-0000-4000-8000-00000000c101'::uuid,
  '00000000-0000-4000-8000-00000000c105'::uuid,
  '00000000-0000-4000-8000-00000000c106'::uuid,
  '00000000-0000-4000-8000-00000000c108'::uuid,
  '00000000-0000-4000-8000-00000000c142'::uuid,
  repeat('9', 64)
);
SELECT throws_ok(
  $$
    UPDATE public.ai_billing_grants
    SET status = 'consumed', consumed_at = statement_timestamp()
    WHERE id = '00000000-0000-4000-8000-00000000c141'::uuid
  $$,
  'P7335',
  'C2 owned lecture child authority requires Google evidence',
  'preissued direct grant cannot cross a concurrent C1 ownership boundary'
);

-- Build one B2.2b remembered-browser credential with the production binding
-- triggers, then prove denial, rollback, and successful master admission.
UPDATE private.admin_ai_unlock_runtime_gate
SET google_ai_master_admission_enabled = true
WHERE singleton;
SELECT set_config(
  'compass.test.c1_jwk_fingerprint',
  encode(
    extensions.digest(
      convert_to(
        '{"crv":"P-256","kty":"EC","x":"'
          || repeat('A', 43)
          || '","y":"'
          || repeat('B', 43)
          || '"}',
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  ),
  false
);
INSERT INTO private.admin_ai_browser_enrollment_nonces (
  id, nonce_hash, reserved_browser_credential_id, credential_hash,
  environment_id, principal_id, membership_id, admin_session_id,
  factor_id, factor_version, step_up_verified_at, origin,
  public_key_fingerprint, absolute_expires_at, begin_request_id,
  issued_at, expires_at
) VALUES (
  '00000000-0000-4000-8000-00000000c150'::uuid,
  repeat('c', 64),
  '00000000-0000-4000-8000-00000000c151'::uuid,
  repeat('d', 64),
  '00000000-0000-4000-8000-00000000c101'::uuid,
  '00000000-0000-4000-8000-00000000c105'::uuid,
  '00000000-0000-4000-8000-00000000c106'::uuid,
  '00000000-0000-4000-8000-00000000c108'::uuid,
  '00000000-0000-4000-8000-00000000c109'::uuid,
  1, statement_timestamp(), 'http://127.0.0.1:5173',
  current_setting('compass.test.c1_jwk_fingerprint'),
  statement_timestamp() + interval '29 days',
  '00000000-0000-4000-8000-00000000c152'::uuid,
  statement_timestamp(), statement_timestamp() + interval '4 minutes'
);
INSERT INTO private.admin_ai_browser_credentials (
  id, credential_hash, environment_id, principal_id, membership_id,
  source_factor_id, source_factor_version, origin, public_key_jwk,
  public_key_fingerprint, enrolled_by_admin_session_id,
  enrollment_nonce_id, created_at, expires_at
) VALUES (
  '00000000-0000-4000-8000-00000000c151'::uuid,
  repeat('d', 64),
  '00000000-0000-4000-8000-00000000c101'::uuid,
  '00000000-0000-4000-8000-00000000c105'::uuid,
  '00000000-0000-4000-8000-00000000c106'::uuid,
  '00000000-0000-4000-8000-00000000c109'::uuid,
  1, 'http://127.0.0.1:5173',
  jsonb_build_object(
    'crv', 'P-256', 'kty', 'EC', 'x', repeat('A', 43), 'y', repeat('B', 43)
  ),
  current_setting('compass.test.c1_jwk_fingerprint'),
  '00000000-0000-4000-8000-00000000c108'::uuid,
  '00000000-0000-4000-8000-00000000c150'::uuid,
  statement_timestamp(), statement_timestamp() + interval '29 days'
);
UPDATE private.admin_ai_browser_enrollment_nonces
SET
  status = 'consumed',
  consumed_at = statement_timestamp(),
  completion_request_id = '00000000-0000-4000-8000-00000000c153'::uuid,
  completion_intent_digest = repeat('e', 64),
  completed_browser_credential_id =
    '00000000-0000-4000-8000-00000000c151'::uuid,
  updated_at = statement_timestamp()
WHERE id = '00000000-0000-4000-8000-00000000c150'::uuid;

INSERT INTO private.admin_ai_browser_assertion_challenges (
  id, challenge_hash, browser_credential_id, environment_id, principal_id,
  membership_id, admin_session_id, factor_id, factor_version,
  lecture_session_id, requested_scope, policy_id, policy_version, origin,
  begin_request_id, issued_at, expires_at
) VALUES (
  '00000000-0000-4000-8000-00000000c154'::uuid,
  repeat('0', 64),
  '00000000-0000-4000-8000-00000000c151'::uuid,
  '00000000-0000-4000-8000-00000000c101'::uuid,
  '00000000-0000-4000-8000-00000000c105'::uuid,
  '00000000-0000-4000-8000-00000000c106'::uuid,
  '00000000-0000-4000-8000-00000000c108'::uuid,
  '00000000-0000-4000-8000-00000000c109'::uuid,
  1, current_setting('compass.test.c1_lecture_id')::uuid,
  'all_except_captions',
  '00000000-0000-4000-8000-00000000c10a'::uuid,
  1, 'http://127.0.0.1:5173',
  '00000000-0000-4000-8000-00000000c155'::uuid,
  statement_timestamp(), statement_timestamp() + interval '4 minutes'
);
SET ROLE service_role;
SELECT is(
  public.complete_google_ai_master_browser_admission_v1(
    repeat('1', 64),
    '00000000-0000-4000-8000-00000000c102'::uuid,
    '00000000-0000-4000-8000-00000000c103'::uuid,
    current_setting('compass.test.c1_lecture_id')::uuid,
    'all_except_captions',
    '00000000-0000-4000-8000-00000000c10a'::uuid, 1,
    repeat('d', 64), repeat('0', 64),
    'http://127.0.0.1:5173', repeat('f', 64), false,
    '00000000-0000-4000-8000-00000000c156'::uuid
  )::text,
  null::text,
  'false browser signature records denial without a master'
);
RESET ROLE;
SELECT ok(
  (
    SELECT challenge.status = 'denied'
      AND challenge.signature_verified is false
    FROM private.admin_ai_browser_assertion_challenges AS challenge
    WHERE challenge.id = '00000000-0000-4000-8000-00000000c154'::uuid
  )
  AND NOT EXISTS (
    SELECT 1
    FROM private.admin_ai_master_admission_receipts AS receipt
    WHERE receipt.request_id = '00000000-0000-4000-8000-00000000c156'::uuid
  ),
  'false browser signature denial commits but creates no master receipt'
);

INSERT INTO private.admin_ai_browser_assertion_challenges (
  id, challenge_hash, browser_credential_id, environment_id, principal_id,
  membership_id, admin_session_id, factor_id, factor_version,
  lecture_session_id, requested_scope, policy_id, policy_version, origin,
  begin_request_id, issued_at, expires_at
) VALUES (
  '00000000-0000-4000-8000-00000000c157'::uuid,
  repeat('2', 64),
  '00000000-0000-4000-8000-00000000c151'::uuid,
  '00000000-0000-4000-8000-00000000c101'::uuid,
  '00000000-0000-4000-8000-00000000c105'::uuid,
  '00000000-0000-4000-8000-00000000c106'::uuid,
  '00000000-0000-4000-8000-00000000c108'::uuid,
  '00000000-0000-4000-8000-00000000c109'::uuid,
  1, current_setting('compass.test.c1_lecture_id')::uuid,
  'all_except_captions',
  '00000000-0000-4000-8000-00000000c10a'::uuid,
  1, 'http://127.0.0.1:5173',
  '00000000-0000-4000-8000-00000000c158'::uuid,
  statement_timestamp(), statement_timestamp() + interval '4 minutes'
);

UPDATE private.admin_ai_unlock_runtime_gate
SET remembered_browser_enabled = false
WHERE singleton;
SET ROLE service_role;
SELECT throws_ok(
  format(
    $$SELECT public.complete_google_ai_master_browser_admission_v1(
      repeat('1',64),
      '00000000-0000-4000-8000-00000000c102'::uuid,
      '00000000-0000-4000-8000-00000000c103'::uuid,
      %L::uuid, 'all_except_captions',
      '00000000-0000-4000-8000-00000000c10a'::uuid, 1,
      repeat('d',64), repeat('2',64), 'http://127.0.0.1:5173',
      repeat('3',64), true,
      '00000000-0000-4000-8000-00000000c159'::uuid
    )$$,
    current_setting('compass.test.c1_lecture_id')
  ),
  'P7336',
  'Google AI master admission is disabled',
  'remembered-browser gate OFF rejects final admission'
);
RESET ROLE;
SELECT ok(
  (
    SELECT challenge.status = 'pending'
      AND challenge.completion_request_id is null
      AND challenge.signature_verified is null
    FROM private.admin_ai_browser_assertion_challenges AS challenge
    WHERE challenge.id = '00000000-0000-4000-8000-00000000c157'::uuid
  )
  AND NOT EXISTS (
    SELECT 1
    FROM private.admin_ai_master_admission_receipts AS receipt
    WHERE receipt.request_id = '00000000-0000-4000-8000-00000000c159'::uuid
  ),
  'remembered-browser gate change rolls proof and master back together'
);
UPDATE private.admin_ai_unlock_runtime_gate
SET remembered_browser_enabled = true
WHERE singleton;

-- A pre-C1 active master forces the post-proof apply step to fail. The
-- wrapper must roll the consumed browser challenge back to pending.
INSERT INTO public.lecture_ai_master_authorizations (
  id, lecture_session_id, admin_session_id, actor_id, scope, actions,
  status, issued_at, expires_at
) VALUES (
  '00000000-0000-4000-8000-00000000c160'::uuid,
  current_setting('compass.test.c1_lecture_id')::uuid,
  '00000000-0000-4000-8000-00000000c108'::uuid,
  'admin-session:00000000-0000-4000-8000-00000000c108',
  'all_except_captions',
  array[
    'academic_answers', 'material_analysis', 'poll_suggestions', 'summaries'
  ]::text[],
  'active', statement_timestamp(), statement_timestamp() + interval '1 hour'
);
SET ROLE service_role;
SELECT throws_ok(
  format(
    $$SELECT public.complete_google_ai_master_browser_admission_v1(
      repeat('1',64),
      '00000000-0000-4000-8000-00000000c102'::uuid,
      '00000000-0000-4000-8000-00000000c103'::uuid,
      %L::uuid, 'all_except_captions',
      '00000000-0000-4000-8000-00000000c10a'::uuid, 1,
      repeat('d',64), repeat('2',64), 'http://127.0.0.1:5173',
      repeat('3',64), true,
      '00000000-0000-4000-8000-00000000c159'::uuid
    )$$,
    current_setting('compass.test.c1_lecture_id')
  ),
  'P7335',
  'pre-C1 AI master cannot be converted by C1',
  'post-browser-proof master failure aborts the whole statement'
);
RESET ROLE;
SELECT ok(
  (
    SELECT challenge.status = 'pending'
      AND challenge.completion_request_id is null
      AND challenge.signature_verified is null
    FROM private.admin_ai_browser_assertion_challenges AS challenge
    WHERE challenge.id = '00000000-0000-4000-8000-00000000c157'::uuid
  )
  AND NOT EXISTS (
    SELECT 1
    FROM private.admin_ai_master_admission_receipts AS receipt
    WHERE receipt.request_id = '00000000-0000-4000-8000-00000000c159'::uuid
  ),
  'browser challenge consumption rolls back when master admission fails'
);
DELETE FROM public.lecture_ai_master_authorizations
WHERE id = '00000000-0000-4000-8000-00000000c160'::uuid;

SET ROLE service_role;
SELECT is(
  public.complete_google_ai_master_browser_admission_v1(
    repeat('1', 64),
    '00000000-0000-4000-8000-00000000c102'::uuid,
    '00000000-0000-4000-8000-00000000c103'::uuid,
    current_setting('compass.test.c1_lecture_id')::uuid,
    'all_except_captions',
    '00000000-0000-4000-8000-00000000c10a'::uuid, 1,
    repeat('d', 64), repeat('2', 64),
    'http://127.0.0.1:5173', repeat('3', 64), true,
    '00000000-0000-4000-8000-00000000c159'::uuid
  ) ->> 'accepted',
  'true',
  'valid browser proof atomically creates a dormant C1 master'
);
RESET ROLE;
SELECT ok(
  (
    SELECT challenge.status = 'consumed'
      AND master.status = 'active'
      AND master.unlock_method = 'remembered_browser'
      AND receipt.browser_credential_id =
        '00000000-0000-4000-8000-00000000c151'::uuid
      AND receipt.browser_assertion_challenge_id = challenge.id
    FROM private.admin_ai_browser_assertion_challenges AS challenge
    JOIN private.admin_ai_master_admission_receipts AS receipt
      ON receipt.browser_assertion_challenge_id = challenge.id
    JOIN public.lecture_ai_master_authorizations AS master
      ON master.id = receipt.master_authorization_id
    WHERE challenge.id = '00000000-0000-4000-8000-00000000c157'::uuid
      AND receipt.request_id = '00000000-0000-4000-8000-00000000c159'::uuid
  ),
  'browser assertion, master, and immutable receipt commit atomically'
);

-- C1 provenance uses the established B2 drains plus C1 access triggers.
UPDATE private.admin_environment_memberships
SET can_use_ai = false
WHERE id = '00000000-0000-4000-8000-00000000c106'::uuid;
SELECT is(
  (
    SELECT master.revoke_reason
    FROM private.admin_ai_master_admission_receipts AS receipt
    JOIN public.lecture_ai_master_authorizations AS master
      ON master.id = receipt.master_authorization_id
    WHERE receipt.request_id = '00000000-0000-4000-8000-00000000c159'::uuid
  ),
  'membership_access_changed',
  'membership AI-access loss drains a C1 browser master'
);
UPDATE private.admin_environment_memberships
SET can_use_ai = true
WHERE id = '00000000-0000-4000-8000-00000000c106'::uuid;

SET ROLE service_role;
SELECT is(
  public.authorize_google_ai_master_with_pin_v1(
    repeat('1', 64),
    '00000000-0000-4000-8000-00000000c102'::uuid,
    '00000000-0000-4000-8000-00000000c103'::uuid,
    current_setting('compass.test.c1_lecture_id')::uuid,
    'all_except_captions',
    '00000000-0000-4000-8000-00000000c10a'::uuid, 1,
    repeat('b', 64), 1, repeat('e', 64),
    '00000000-0000-4000-8000-00000000c170'::uuid
  ) ->> 'accepted',
  'true',
  'C1 master can be re-admitted after access restoration'
);
RESET ROLE;
SELECT private.drain_admin_ai_policy_authority_v1(
  '00000000-0000-4000-8000-00000000c10a'::uuid,
  '00000000-0000-4000-8000-00000000c108'::uuid,
  statement_timestamp()
);
SELECT is(
  (
    SELECT master.revoke_reason
    FROM private.admin_ai_master_admission_receipts AS receipt
    JOIN public.lecture_ai_master_authorizations AS master
      ON master.id = receipt.master_authorization_id
    WHERE receipt.request_id = '00000000-0000-4000-8000-00000000c170'::uuid
  ),
  'policy_superseded',
  'B2 policy authority drain revokes a C1 master'
);

SET ROLE service_role;
SELECT is(
  public.authorize_google_ai_master_with_pin_v1(
    repeat('1', 64),
    '00000000-0000-4000-8000-00000000c102'::uuid,
    '00000000-0000-4000-8000-00000000c103'::uuid,
    current_setting('compass.test.c1_lecture_id')::uuid,
    'all_except_captions',
    '00000000-0000-4000-8000-00000000c10a'::uuid, 1,
    repeat('b', 64), 1, repeat('e', 64),
    '00000000-0000-4000-8000-00000000c171'::uuid
  ) ->> 'accepted',
  'true',
  'C1 master can be re-admitted after a policy drain'
);
RESET ROLE;
SELECT private.drain_admin_ai_factor_authority_v1(
  '00000000-0000-4000-8000-00000000c109'::uuid,
  '00000000-0000-4000-8000-00000000c108'::uuid,
  'factor_revoked',
  statement_timestamp()
);
SELECT is(
  (
    SELECT master.revoke_reason
    FROM private.admin_ai_master_admission_receipts AS receipt
    JOIN public.lecture_ai_master_authorizations AS master
      ON master.id = receipt.master_authorization_id
    WHERE receipt.request_id = '00000000-0000-4000-8000-00000000c171'::uuid
  ),
  'factor_revoked',
  'B2 factor authority drain revokes a C1 master'
);

SET ROLE service_role;
SELECT is(
  public.authorize_google_ai_master_with_pin_v1(
    repeat('1', 64),
    '00000000-0000-4000-8000-00000000c102'::uuid,
    '00000000-0000-4000-8000-00000000c103'::uuid,
    current_setting('compass.test.c1_lecture_id')::uuid,
    'all_except_captions',
    '00000000-0000-4000-8000-00000000c10a'::uuid, 1,
    repeat('b', 64), 1, repeat('e', 64),
    '00000000-0000-4000-8000-00000000c172'::uuid
  ) ->> 'accepted',
  'true',
  'C1 master can be re-admitted before session drain'
);
RESET ROLE;
UPDATE public.admin_sessions
SET
  revoked_at = statement_timestamp(),
  revoke_reason = 'teacher_logout',
  updated_at = statement_timestamp()
WHERE id = '00000000-0000-4000-8000-00000000c108'::uuid;
SELECT is(
  (
    SELECT master.revoke_reason
    FROM private.admin_ai_master_admission_receipts AS receipt
    JOIN public.lecture_ai_master_authorizations AS master
      ON master.id = receipt.master_authorization_id
    WHERE receipt.request_id = '00000000-0000-4000-8000-00000000c172'::uuid
  ),
  'admin_session_revoked',
  'Admin session revocation drains the final C1 master'
);

SELECT * FROM finish();
ROLLBACK;
