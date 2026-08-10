CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(9);

SELECT ok(
  EXISTS (
    SELECT 1
    FROM public.lecture_sessions
    WHERE id = '73031000-0000-4000-8000-000000000001'::uuid
      AND title = 'pre-C1 populated lecture'
  ),
  'the populated B2.2b-head lecture is preserved'
);

SELECT is(
  (
    SELECT count(*)::integer
    FROM private.admin_lecture_ownerships
    WHERE lecture_session_id =
      '73031000-0000-4000-8000-000000000001'::uuid
  ),
  0,
  'existing lecture remains unowned'
);

SELECT ok(
  NOT EXISTS (SELECT 1 FROM private.admin_ai_master_admission_receipts)
  AND NOT EXISTS (SELECT 1 FROM private.admin_ai_master_reuse_receipts)
  AND NOT EXISTS (SELECT 1 FROM private.admin_ai_master_control_receipts),
  'no inferred admission, reuse or control receipts are created'
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

SELECT ok(
  (
    SELECT status = 'active'
      AND principal_id IS NULL
      AND membership_id IS NULL
      AND issuing_admin_session_id IS NULL
      AND unlock_method IS NULL
    FROM public.lecture_ai_master_authorizations
    WHERE id = '73031000-0000-4000-8000-000000000004'::uuid
  )
  AND EXISTS (
    SELECT 1
    FROM public.ai_billing_grants
    WHERE id = '73031000-0000-4000-8000-000000000005'::uuid
      AND status = 'issued'
      AND master_authorization_id =
        '73031000-0000-4000-8000-000000000004'::uuid
  ),
  'pre-C1 active master and child grant are preserved without inferred C1 provenance'
);

SELECT is(
  public.admin_authorize_ai_master(
    '73031000-0000-4000-8000-000000000001'::uuid,
    '73031000-0000-4000-8000-000000000002'::uuid,
    'admin-session:73031000-0000-4000-8000-000000000002',
    'all_except_captions',
    true
  ) ->> 'accepted',
  'true',
  'unowned pre-C1 master remains on the compatibility path'
);

SELECT ok(
  set_config(
    'compass.test.c1_upgrade_legacy_grant_id',
    public.admin_issue_ai_billing_grant_from_master(
      '73031000-0000-4000-8000-000000000001'::uuid,
      '73031000-0000-4000-8000-000000000002'::uuid,
      array['summaries']::text[],
      repeat('d', 64),
      'admin-session:73031000-0000-4000-8000-000000000002'
    ) ->> 'grant_id',
    false
  ) IS NOT NULL,
  'legacy child issue remains compatibility-only for an unowned master'
);

UPDATE public.ai_billing_grants
SET status = 'consumed', consumed_at = statement_timestamp()
WHERE id = current_setting('compass.test.c1_upgrade_legacy_grant_id')::uuid;

SELECT ok(
  (
    SELECT status = 'consumed'
      AND master_authorization_id =
        '73031000-0000-4000-8000-000000000004'::uuid
    FROM public.ai_billing_grants
    WHERE id = current_setting('compass.test.c1_upgrade_legacy_grant_id')::uuid
  )
  AND NOT EXISTS (SELECT 1 FROM private.admin_ai_master_admission_receipts),
  'legacy child consumption cannot fabricate C1 provenance'
);

SELECT ok(
  (
    SELECT principal_id IS NULL
      AND membership_id IS NULL
      AND issuing_admin_session_id IS NULL
    FROM public.lecture_ai_master_authorizations
    WHERE id = '73031000-0000-4000-8000-000000000004'::uuid
  ),
  'legacy authorize and child paths never bridge the master into C1'
);

SELECT * FROM finish();
