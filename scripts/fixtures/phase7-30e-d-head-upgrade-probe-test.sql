begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select no_plan();

select ok(
  (
    select count(*) = 2
    from private.admin_environment_memberships
    where environment_id =
        '73035000-0000-4000-8000-000000000001'::uuid
      and role = 'owner'
      and status = 'active'
      and can_use_ai
  ),
  'the populated D-head Owners upgrade to the complete capability invariant'
);

select ok(
  exists (
    select 1
    from private.admin_lecture_ownerships as ownership
    where ownership.lecture_session_id =
        '73035000-0000-4000-8000-00000000000c'::uuid
      and ownership.environment_id =
        '73035000-0000-4000-8000-000000000001'::uuid
      and ownership.principal_id =
        '73035000-0000-4000-8000-000000000006'::uuid
      and ownership.membership_id =
        '73035000-0000-4000-8000-000000000008'::uuid
      and ownership.assigned_by_admin_session_id =
        '73035000-0000-4000-8000-00000000000b'::uuid
      and ownership.ownership_request_id =
        '73035000-0000-4000-8000-00000000000f'::uuid
      and ownership.ownership_intent_digest = repeat('5', 64)
      and ownership.ownership_source = 'google_create'
      and ownership.ownership_approval_id is null
  ),
  'the populated D-head ownership keeps Google-create provenance under E'
);

select is(
  (
    select count(*)::integer
    from private.admin_environment_memberships as membership
    where membership.id in (
      '73035000-0000-4000-8000-000000000008'::uuid,
      '73035000-0000-4000-8000-000000000009'::uuid
    )
      and membership.environment_id =
        '73035000-0000-4000-8000-000000000001'::uuid
      and membership.role = 'owner'
      and membership.status = 'active'
      and membership.expires_at is null
  ),
  2,
  'both populated D-head owner memberships survive E unchanged'
);

select ok(
  exists (
    select 1
    from public.admin_sessions as session
    where session.id = '73035000-0000-4000-8000-00000000000b'::uuid
      and session.token_hash = repeat('1', 64)
      and session.auth_user_id =
        '73035000-0000-4000-8000-000000000002'::uuid
      and session.authentication_method = 'google_totp'
      and session.aal = 2
      and session.principal_id =
        '73035000-0000-4000-8000-000000000006'::uuid
      and session.membership_id =
        '73035000-0000-4000-8000-000000000008'::uuid
      and session.environment_id =
        '73035000-0000-4000-8000-000000000001'::uuid
      and session.supabase_auth_session_id =
        '73035000-0000-4000-8000-000000000004'::uuid
      and session.revoked_at is null
  ),
  'the populated D-head Google Admin session survives E unchanged'
);

select ok(
  exists (
    select 1
    from private.admin_invitations as invitation
    where invitation.id = '73035000-0000-4000-8000-000000000010'::uuid
      and invitation.environment_id =
        '73035000-0000-4000-8000-000000000001'::uuid
      and invitation.invitation_kind = 'invitation'
      and invitation.target_email_hmac = repeat('6', 64)
      and invitation.target_normalized_email =
        'phase730e-d-head-invitee@example.test'
      and invitation.target_email_pepper_version = 1
      and invitation.role = 'instructor'
      and invitation.can_use_ai
      and invitation.token_hash = repeat('7', 64)
      and invitation.inviter_membership_id =
        '73035000-0000-4000-8000-000000000008'::uuid
      and invitation.status = 'pending'
      and invitation.request_id =
        '73035000-0000-4000-8000-000000000011'::uuid
      and invitation.revoked_at is null
      and invitation.expired_at is null
  ),
  'the populated D-head pending invitation remains exact and non-terminal'
);

select ok(
  exists (
    select 1
    from private.admin_audit_events as event
    where event.request_id =
        '73035000-0000-4000-8000-000000000012'::uuid
      and event.environment_id =
        '73035000-0000-4000-8000-000000000001'::uuid
      and event.actor_principal_id =
        '73035000-0000-4000-8000-000000000006'::uuid
      and event.actor_membership_id =
        '73035000-0000-4000-8000-000000000008'::uuid
      and event.actor_session_id =
        '73035000-0000-4000-8000-00000000000b'::uuid
      and event.action = 'admin_ledger.upgrade_fixture'
      and event.target_id = '73035000-0000-4000-8000-000000000010'
      and event.result = 'accepted'
      and event.metadata = '{"fixture":"phase7.30e-d-head"}'::jsonb
  )
  and exists (
    select 1
    from private.admin_google_operation_policies as policy
    where policy.operation_key = 'manage-admin-ledger.snapshot'
      and policy.edge_function = 'manage-admin-ledger'
      and policy.operation_class = 'read'
  ),
  'D owner-ledger audit and operation authority survive the E upgrade'
);

select ok(
  (
    select gate.legacy_pin_login_enabled
      and gate.google_session_issue_enabled
      and gate.google_operational_authorization_enabled
      and gate.google_admin_ledger_enabled
    from private.admin_identity_runtime_gate as gate
    where gate.singleton
  )
  and not exists (
    select 1 from private.admin_identity_cutover_receipts
  )
  and not exists (
    select 1 from private.admin_lecture_ownership_claim_approvals
  )
  and not exists (
    select 1 from private.admin_lecture_ownership_claim_receipts
  ),
  'E preserves the populated D gates without fabricating irreversible evidence'
);

select ok(
  private.get_google_only_admin_cutover_preflight_v1(
    '73035000-0000-4000-8000-000000000001'::uuid
  ) @> jsonb_build_object(
    'activeLegacySessionCount', 0,
    'activeOwnerCount', 2,
    'authoritative', false,
    'cutoverCommitted', false,
    'environmentReady', true,
    'externalTransportAttestationRequired', true,
    'unownedActiveLectureCount', 0
  ),
  'the populated D-head preflight remains advisory and reports exact readiness'
);

select * from finish();
rollback;
