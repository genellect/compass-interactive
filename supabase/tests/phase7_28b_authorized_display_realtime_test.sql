BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path = public, extensions;
SELECT no_plan();

SELECT has_table(
  'public',
  'display_realtime_sessions',
  'Display Realtime binding table exists'
);
SELECT ok(
  (SELECT relrowsecurity
   FROM pg_class
   WHERE oid = 'public.display_realtime_sessions'::regclass),
  'Display Realtime bindings have RLS enabled'
);
SELECT ok(
  NOT has_table_privilege(
    'authenticated',
    'public.display_realtime_sessions',
    'SELECT'
  ),
  'browser clients cannot inspect Display bindings'
);
SELECT ok(
  has_function_privilege(
    'service_role',
    'public.register_display_realtime_session_v1(uuid,uuid,text,timestamptz,uuid,uuid)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'authenticated',
    'public.register_display_realtime_session_v1(uuid,uuid,text,timestamptz,uuid,uuid)',
    'EXECUTE'
  ),
  'only the Edge service role can register a Display binding'
);
SELECT ok(
  has_function_privilege(
    'service_role',
    'public.claim_display_realtime_session_v1(text,uuid,uuid)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'authenticated',
    'public.claim_display_realtime_session_v1(text,uuid,uuid)',
    'EXECUTE'
  ),
  'raw browser RPC cannot bypass the signed-token claim Edge function'
);
SELECT ok(
  EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'realtime'
      AND tablename = 'messages'
      AND policyname = 'phase728 display can receive private broadcast'
      AND cmd = 'SELECT'
  ),
  'Realtime messages have the private Display receive policy'
);
SELECT ok(
  NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'realtime'
      AND tablename = 'messages'
      AND policyname LIKE 'phase728%'
      AND cmd = 'INSERT'
  ),
  'Admin browsers have no direct cached INSERT policy for caption delivery'
);
SELECT ok(
  NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'display_realtime_sessions'
  ),
  'binding metadata creates no Postgres Changes fan-out'
);
SELECT ok(
  to_regclass('public.display_realtime_sessions_one_active_per_lecture_idx')
    IS NOT NULL,
  'one-active-Display invariant is indexed'
);
SELECT ok(
  to_regclass('public.display_realtime_sessions_global_cleanup_idx')
    IS NOT NULL,
  'bounded global cleanup has a matching index'
);
SELECT ok(
  has_function_privilege(
    'service_role',
    'public.set_display_realtime_runtime_v1(boolean)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'authenticated',
    'public.set_display_realtime_runtime_v1(boolean)',
    'EXECUTE'
  ),
  'only the Edge service role can operate the DB runtime kill switch'
);
SELECT ok(
  has_function_privilege(
    'service_role',
    'public.verify_display_snapshot_fallback_v1(text,uuid,uuid)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'authenticated',
    'public.verify_display_snapshot_fallback_v1(text,uuid,uuid)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'anon',
    'public.verify_display_snapshot_fallback_v1(text,uuid,uuid)',
    'EXECUTE'
  ),
  'only the Edge service role can verify a snapshot fallback'
);
SELECT ok(
  (SELECT relrowsecurity
   FROM pg_class
   WHERE oid = 'private.display_realtime_runtime_gate'::regclass)
  AND NOT has_table_privilege(
    'authenticated',
    'private.display_realtime_runtime_gate',
    'SELECT'
  )
  AND NOT has_table_privilege(
    'anon',
    'private.display_realtime_runtime_gate',
    'SELECT'
  ),
  'DB runtime gate has RLS and no browser privileges'
);

CREATE TEMP TABLE phase728b_fixture (
  lecture_id uuid,
  admin_revoke_lecture_id uuid,
  hard_stop_lecture_id uuid,
  first_topic text,
  second_topic text,
  admin_revoke_topic text,
  hard_stop_topic text
);
GRANT SELECT, INSERT, UPDATE ON phase728b_fixture TO service_role;
GRANT SELECT ON phase728b_fixture TO authenticated;
INSERT INTO phase728b_fixture DEFAULT VALUES;

SET LOCAL ROLE service_role;
UPDATE phase728b_fixture
SET lecture_id = public.admin_create_lecture(
  'Phase 7.28B Display Realtime',
  repeat('8', 64),
  '728001',
  null,
  null
);
SELECT ok(
  public.admin_set_lecture_status(
    (SELECT lecture_id FROM phase728b_fixture),
    'start',
    null
  ),
  'Display fixture lecture starts'
);

INSERT INTO public.admin_sessions (
  id,
  token_hash,
  auth_user_id,
  pin_version_hash,
  issued_at,
  last_seen_at,
  idle_expires_at,
  expires_at
) VALUES (
  '72800000-0000-4000-8000-000000000001',
  repeat('1', 64),
  '72800000-0000-4000-8000-000000000101',
  repeat('2', 64),
  statement_timestamp() - interval '1 minute',
  statement_timestamp(),
  statement_timestamp() + interval '1 hour',
  statement_timestamp() + interval '2 hours'
);

UPDATE phase728b_fixture
SET first_topic = public.register_display_realtime_session_v1(
  '72800000-0000-4000-8000-000000000011',
  lecture_id,
  repeat('3', 64),
  statement_timestamp() + interval '1 hour',
  '72800000-0000-4000-8000-000000000001',
  '72800000-0000-4000-8000-000000000101'
) ->> 'topic';
SELECT ok(
  (SELECT first_topic FROM phase728b_fixture) LIKE 'display:%',
  'registration returns a private random session topic'
);

SELECT is(
  public.claim_display_realtime_session_v1(
    repeat('3', 64),
    (SELECT lecture_id FROM phase728b_fixture),
    '72800000-0000-4000-8000-000000000201'
  ) ->> 'status',
  'claimed',
  'the first Display auth UID atomically claims the token'
);
SELECT is(
  public.claim_display_realtime_session_v1(
    repeat('3', 64),
    (SELECT lecture_id FROM phase728b_fixture),
    '72800000-0000-4000-8000-000000000201'
  ) ->> 'status',
  'claimed',
  'same-browser claim retry is idempotent'
);
SELECT is(
  public.claim_display_realtime_session_v1(
    repeat('3', 64),
    (SELECT lecture_id FROM phase728b_fixture),
    '72800000-0000-4000-8000-000000000202'
  ) ->> 'status',
  'claimed_by_other',
  'the same Display token cannot be replayed by another auth UID'
);
SELECT ok(
  public.verify_display_realtime_session_v1(
    repeat('3', 64),
    (SELECT lecture_id FROM phase728b_fixture),
    '72800000-0000-4000-8000-000000000201'
  ),
  'claimed browser can use the live operator and PDF paths'
);
SELECT ok(
  NOT public.verify_display_realtime_session_v1(
    repeat('3', 64),
    (SELECT lecture_id FROM phase728b_fixture),
    '72800000-0000-4000-8000-000000000202'
  ),
  'a replay browser cannot use the live operator or PDF paths'
);

RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"72800000-0000-4000-8000-000000000201","role":"authenticated"}',
  true
);
SELECT ok(
  private.display_realtime_access_allowed_v1(
    (SELECT first_topic FROM phase728b_fixture),
    false
  ),
  'the claimed Display UID can subscribe to its private topic'
);
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"72800000-0000-4000-8000-000000000299","role":"authenticated"}',
  true
);
SELECT ok(
  NOT private.display_realtime_access_allowed_v1(
    (SELECT first_topic FROM phase728b_fixture),
    false
  ),
  'an unrelated student UID cannot subscribe even when the topic is known'
);

RESET ROLE;
SET LOCAL ROLE service_role;
UPDATE phase728b_fixture
SET second_topic = public.register_display_realtime_session_v1(
  '72800000-0000-4000-8000-000000000012',
  lecture_id,
  repeat('4', 64),
  statement_timestamp() + interval '1 hour',
  '72800000-0000-4000-8000-000000000001',
  '72800000-0000-4000-8000-000000000101'
) ->> 'topic';
SELECT is(
  (
    SELECT revoke_reason
    FROM public.display_realtime_sessions
    WHERE token_jti_hash = repeat('3', 64)
  ),
  'session_replaced',
  'issuing a new Display atomically revokes the old binding'
);
SELECT is(
  (
    SELECT count(*)::integer
    FROM public.display_realtime_sessions, phase728b_fixture
    WHERE lecture_session_id = lecture_id
      AND revoked_at is null
  ),
  1,
  'retries and CTA clicks converge to one active Display per lecture'
);
SELECT is(
  public.claim_display_realtime_session_v1(
    repeat('4', 64),
    (SELECT lecture_id FROM phase728b_fixture),
    '72800000-0000-4000-8000-000000000203'
  ) ->> 'status',
  'claimed',
  'replacement Display can claim its own token'
);

RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"72800000-0000-4000-8000-000000000201","role":"authenticated"}',
  true
);
SELECT ok(
  NOT private.display_realtime_access_allowed_v1(
    (SELECT second_topic FROM phase728b_fixture),
    false
  ),
  'a UID claimed on another known topic cannot subscribe cross-topic'
);

RESET ROLE;
SET LOCAL ROLE service_role;
SELECT is(
  public.claim_display_caption_relay_v1(
    (SELECT second_topic FROM phase728b_fixture),
    (SELECT lecture_id FROM phase728b_fixture),
    '72800000-0000-4000-8000-000000000199',
    '72800000-0000-4000-8000-000000000301',
    0,
    'delta'
  ),
  'unavailable',
  'the wrong Admin auth UID cannot claim a caption relay'
);

SELECT is(
  public.claim_display_caption_relay_v1(
    (SELECT second_topic FROM phase728b_fixture),
    (SELECT lecture_id FROM phase728b_fixture),
    '72800000-0000-4000-8000-000000000101',
    '72800000-0000-4000-8000-000000000301',
    0,
    'delta'
  ),
  'allowed',
  'first bounded caption delta is admitted'
);
SELECT is(
  public.claim_display_caption_relay_v1(
    (SELECT second_topic FROM phase728b_fixture),
    (SELECT lecture_id FROM phase728b_fixture),
    '72800000-0000-4000-8000-000000000101',
    '72800000-0000-4000-8000-000000000301',
    1,
    'delta'
  ),
  'rate_limited',
  'rapid caption delta is rejected before external relay'
);
UPDATE public.display_realtime_sessions
SET last_caption_delta_relay_at = statement_timestamp() - interval '1 second'
WHERE token_jti_hash = repeat('4', 64);
SELECT is(
  public.claim_display_caption_relay_v1(
    (SELECT second_topic FROM phase728b_fixture),
    (SELECT lecture_id FROM phase728b_fixture),
    '72800000-0000-4000-8000-000000000101',
    '72800000-0000-4000-8000-000000000301',
    1,
    'delta'
  ),
  'allowed',
  'coalesced delta is admitted after the server interval'
);
SELECT is(
  public.claim_display_caption_relay_v1(
    (SELECT second_topic FROM phase728b_fixture),
    (SELECT lecture_id FROM phase728b_fixture),
    '72800000-0000-4000-8000-000000000101',
    '72800000-0000-4000-8000-000000000301',
    2,
    'completed'
  ),
  'allowed',
  'completed is not lost when it immediately follows a delta'
);
SELECT is(
  public.claim_display_caption_relay_v1(
    (SELECT second_topic FROM phase728b_fixture),
    (SELECT lecture_id FROM phase728b_fixture),
    '72800000-0000-4000-8000-000000000101',
    '72800000-0000-4000-8000-000000000301',
    3,
    'stopped'
  ),
  'allowed',
  'stopped is not lost when it immediately follows completed'
);
SELECT is(
  public.claim_display_caption_relay_v1(
    (SELECT second_topic FROM phase728b_fixture),
    (SELECT lecture_id FROM phase728b_fixture),
    '72800000-0000-4000-8000-000000000101',
    '72800000-0000-4000-8000-000000000301',
    3,
    'completed'
  ),
  'stale',
  'a duplicate or reordered terminal sequence is never relayed'
);

SELECT ok(
  public.admin_set_lecture_status(
    (SELECT lecture_id FROM phase728b_fixture),
    'close',
    null
  ),
  'manual lecture close uses the canonical lifecycle transition'
);
SELECT is(
  (
    SELECT revoke_reason
    FROM public.display_realtime_sessions
    WHERE token_jti_hash = repeat('4', 64)
  ),
  'lecture_closed',
  'manual close revokes the active Display binding'
);
SELECT ok(
  NOT public.verify_display_realtime_session_v1(
    repeat('4', 64),
    (SELECT lecture_id FROM phase728b_fixture),
    '72800000-0000-4000-8000-000000000203'
  ),
  'closed lecture cannot continue live Display reads'
);
SELECT is(
  public.claim_display_caption_relay_v1(
    (SELECT second_topic FROM phase728b_fixture),
    (SELECT lecture_id FROM phase728b_fixture),
    '72800000-0000-4000-8000-000000000101',
    '72800000-0000-4000-8000-000000000301',
    4,
    'completed'
  ),
  'unavailable',
  'closed lecture cannot relay captions even with a cached browser JWT'
);
SELECT is(
  public.cleanup_display_realtime_sessions_v1(),
  0,
  'cleanup does not remove a freshly revoked live binding'
);
UPDATE public.display_realtime_sessions
SET
  issued_at = statement_timestamp() - interval '3 days',
  expires_at = statement_timestamp() - interval '2 days',
  revoked_at = statement_timestamp() - interval '2 days'
WHERE token_jti_hash = repeat('4', 64);
SELECT is(
  public.cleanup_display_realtime_sessions_v1(),
  1,
  'cleanup removes old live binding metadata independently of archive tokens'
);

RESET ROLE;
SELECT ok(
  EXISTS (
    SELECT 1
    FROM cron.job
    WHERE jobname = 'compass-display-realtime-cleanup'
  ),
  'expired Display binding cleanup is scheduled idempotently'
);

-- Admin revoke is an immediate server-side stop even if a browser retained a
-- cached Realtime authorization decision.
SET LOCAL ROLE service_role;
UPDATE phase728b_fixture
SET admin_revoke_lecture_id = public.admin_create_lecture(
  'Phase 7.28B Admin revoke',
  repeat('9', 64),
  '728002',
  null,
  null
);
SELECT ok(
  public.admin_set_lecture_status(
    (SELECT admin_revoke_lecture_id FROM phase728b_fixture),
    'start',
    null
  ),
  'Admin-revoke fixture lecture starts'
);
INSERT INTO public.admin_sessions (
  id, token_hash, auth_user_id, pin_version_hash, issued_at, last_seen_at,
  idle_expires_at, expires_at
) VALUES (
  '72800000-0000-4000-8000-000000000002',
  repeat('5', 64),
  '72800000-0000-4000-8000-000000000102',
  repeat('6', 64),
  statement_timestamp() - interval '1 minute',
  statement_timestamp(),
  statement_timestamp() + interval '1 hour',
  statement_timestamp() + interval '2 hours'
);
UPDATE phase728b_fixture
SET admin_revoke_topic = public.register_display_realtime_session_v1(
  '72800000-0000-4000-8000-000000000013',
  admin_revoke_lecture_id,
  repeat('7', 64),
  statement_timestamp() + interval '1 hour',
  '72800000-0000-4000-8000-000000000002',
  '72800000-0000-4000-8000-000000000102'
) ->> 'topic';
SELECT is(
  public.claim_display_realtime_session_v1(
    repeat('7', 64),
    (SELECT admin_revoke_lecture_id FROM phase728b_fixture),
    '72800000-0000-4000-8000-000000000204'
  ) ->> 'status',
  'claimed',
  'Admin-revoke fixture Display claims its token'
);
SELECT is(
  public.set_display_realtime_runtime_v1(false),
  1,
  'runtime rollback drains the Admin-revoke fixture binding'
);
SELECT ok(
  public.verify_display_snapshot_fallback_v1(
    repeat('7', 64),
    (SELECT admin_revoke_lecture_id FROM phase728b_fixture),
    '72800000-0000-4000-8000-000000000204'
  ),
  'same claimed Display UID retains snapshot access only while rollback is active'
);
SELECT ok(
  NOT public.verify_display_snapshot_fallback_v1(
    repeat('7', 64),
    (SELECT admin_revoke_lecture_id FROM phase728b_fixture),
    '72800000-0000-4000-8000-000000000299'
  ),
  'runtime rollback never grants another auth UID snapshot access'
);
UPDATE public.admin_sessions
SET idle_expires_at = statement_timestamp() - interval '1 second'
WHERE id = '72800000-0000-4000-8000-000000000002';
SELECT ok(
  NOT public.verify_display_snapshot_fallback_v1(
    repeat('7', 64),
    (SELECT admin_revoke_lecture_id FROM phase728b_fixture),
    '72800000-0000-4000-8000-000000000204'
  ),
  'expired Admin idle lifetime blocks the rollback snapshot path'
);
UPDATE public.admin_sessions
SET idle_expires_at = statement_timestamp() + interval '1 hour'
WHERE id = '72800000-0000-4000-8000-000000000002';
SELECT ok(
  public.verify_display_snapshot_fallback_v1(
    repeat('7', 64),
    (SELECT admin_revoke_lecture_id FROM phase728b_fixture),
    '72800000-0000-4000-8000-000000000204'
  ),
  'restoring the active Admin lifetime restores only the intentional rollback path'
);
UPDATE public.admin_sessions
SET revoked_at = statement_timestamp(), revoke_reason = 'test_revoke'
WHERE id = '72800000-0000-4000-8000-000000000002';
SELECT is(
  (
    SELECT revoke_reason
    FROM public.display_realtime_sessions
    WHERE token_jti_hash = repeat('7', 64)
  ),
  'admin_session_revoked',
  'Admin-session revoke permanently overwrites a runtime fallback binding'
);
SELECT ok(
  NOT public.verify_display_realtime_session_v1(
    repeat('7', 64),
    (SELECT admin_revoke_lecture_id FROM phase728b_fixture),
    '72800000-0000-4000-8000-000000000204'
  ),
  'Admin-session revoke blocks subsequent Display reads'
);
SELECT ok(
  NOT public.verify_display_snapshot_fallback_v1(
    repeat('7', 64),
    (SELECT admin_revoke_lecture_id FROM phase728b_fixture),
    '72800000-0000-4000-8000-000000000204'
  ),
  'Admin-session revoke cannot fall back through feature-disabled state'
);
SELECT is(
  public.claim_display_caption_relay_v1(
    (SELECT admin_revoke_topic FROM phase728b_fixture),
    (SELECT admin_revoke_lecture_id FROM phase728b_fixture),
    '72800000-0000-4000-8000-000000000102',
    '72800000-0000-4000-8000-000000000302',
    0,
    'completed'
  ),
  'unavailable',
  'Admin-session revoke blocks cached-client caption relays'
);
SELECT is(
  public.set_display_realtime_runtime_v1(true),
  0,
  'runtime gate can be restored after the Admin-revoke regression fixture'
);

-- Hard-stop predicates remain authoritative even if the cleanup worker and
-- this Phase trigger are absent. Disable only this acceleration trigger to
-- prove the read/relay RPC defenses independently.
UPDATE phase728b_fixture
SET hard_stop_lecture_id = public.admin_create_lecture(
  'Phase 7.28B hard stop',
  repeat('a', 64),
  '728003',
  null,
  null
);
SELECT ok(
  public.admin_set_lecture_status(
    (SELECT hard_stop_lecture_id FROM phase728b_fixture),
    'start',
    null
  ),
  'hard-stop fixture lecture starts'
);
INSERT INTO public.admin_sessions (
  id, token_hash, auth_user_id, pin_version_hash, issued_at, last_seen_at,
  idle_expires_at, expires_at
) VALUES (
  '72800000-0000-4000-8000-000000000003',
  repeat('8', 64),
  '72800000-0000-4000-8000-000000000103',
  repeat('9', 64),
  statement_timestamp() - interval '1 minute',
  statement_timestamp(),
  statement_timestamp() + interval '1 hour',
  statement_timestamp() + interval '2 hours'
);
UPDATE phase728b_fixture
SET hard_stop_topic = public.register_display_realtime_session_v1(
  '72800000-0000-4000-8000-000000000014',
  hard_stop_lecture_id,
  repeat('b', 64),
  statement_timestamp() + interval '1 hour',
  '72800000-0000-4000-8000-000000000003',
  '72800000-0000-4000-8000-000000000103'
) ->> 'topic';
SELECT is(
  public.claim_display_realtime_session_v1(
    repeat('b', 64),
    (SELECT hard_stop_lecture_id FROM phase728b_fixture),
    '72800000-0000-4000-8000-000000000205'
  ) ->> 'status',
  'claimed',
  'hard-stop fixture Display claims its token'
);

RESET ROLE;
ALTER TABLE public.lecture_sessions
  DISABLE TRIGGER lecture_sessions_revoke_display_realtime;
SET LOCAL ROLE service_role;
UPDATE public.lecture_sessions
SET
  started_at = statement_timestamp() - interval '2 minutes',
  hard_stop_at = statement_timestamp() - interval '1 second'
WHERE id = (SELECT hard_stop_lecture_id FROM phase728b_fixture);
SELECT ok(
  NOT public.verify_display_realtime_session_v1(
    repeat('b', 64),
    (SELECT hard_stop_lecture_id FROM phase728b_fixture),
    '72800000-0000-4000-8000-000000000205'
  ),
  'hard-stop boundary blocks Display reads without cleanup or revoke trigger'
);
SELECT is(
  public.claim_display_caption_relay_v1(
    (SELECT hard_stop_topic FROM phase728b_fixture),
    (SELECT hard_stop_lecture_id FROM phase728b_fixture),
    '72800000-0000-4000-8000-000000000103',
    '72800000-0000-4000-8000-000000000303',
    0,
    'completed'
  ),
  'unavailable',
  'hard-stop boundary blocks cached-client relay without cleanup or trigger'
);
RESET ROLE;
ALTER TABLE public.lecture_sessions
  ENABLE TRIGGER lecture_sessions_revoke_display_realtime;

-- Disabling the DB runtime gate atomically rejects new work and drains any
-- already-authorized private channel. Repeating the rollback is harmless.
SET LOCAL ROLE service_role;
SELECT is(
  public.set_display_realtime_runtime_v1(false),
  1,
  'runtime kill switch revokes the remaining active Display binding'
);
SELECT is(
  (
    SELECT revoke_reason
    FROM public.display_realtime_sessions
    WHERE token_jti_hash = repeat('b', 64)
  ),
  'feature_disabled',
  'runtime drain records an auditable feature-disabled reason'
);
SELECT is(
  public.set_display_realtime_runtime_v1(false),
  0,
  'runtime kill switch retry is idempotent'
);
SELECT is(
  public.claim_display_realtime_session_v1(
    repeat('b', 64),
    (SELECT hard_stop_lecture_id FROM phase728b_fixture),
    '72800000-0000-4000-8000-000000000205'
  ) ->> 'status',
  'unavailable',
  'runtime kill switch rejects claims independently of client flags'
);
SELECT is(
  public.set_display_realtime_runtime_v1(true),
  0,
  'runtime gate can be re-enabled without resurrecting revoked bindings'
);

-- Cleanup is intentionally bounded to keep the hourly Cron predictable and
-- converges safely when more than one batch has accumulated.
INSERT INTO public.display_realtime_sessions (
  id,
  lecture_session_id,
  token_jti_hash,
  topic,
  admin_session_id,
  admin_auth_user_id,
  issued_at,
  expires_at,
  hard_stop_at,
  revoked_at,
  revoke_reason
)
SELECT
  gen_random_uuid(),
  (SELECT hard_stop_lecture_id FROM phase728b_fixture),
  encode(digest('phase728b-cleanup-' || series::text, 'sha256'), 'hex'),
  'display:' ||
    (SELECT hard_stop_lecture_id::text FROM phase728b_fixture) || ':' ||
    gen_random_uuid()::text,
  '72800000-0000-4000-8000-000000000003',
  '72800000-0000-4000-8000-000000000103',
  statement_timestamp() - interval '4 days',
  statement_timestamp() - interval '3 days',
  statement_timestamp() - interval '2 days',
  statement_timestamp() - interval '3 days',
  'test_cleanup'
FROM generate_series(1, 501) AS series;
SELECT is(
  public.cleanup_display_realtime_sessions_v1(),
  500,
  'cleanup removes at most one bounded batch per invocation'
);
SELECT is(
  public.cleanup_display_realtime_sessions_v1(),
  1,
  'a second cleanup invocation converges the remainder'
);
SELECT is(
  public.cleanup_display_realtime_sessions_v1(),
  0,
  'bounded cleanup is idempotent after convergence'
);

RESET ROLE;
SELECT * FROM finish();
ROLLBACK;
