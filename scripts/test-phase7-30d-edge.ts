import assert from 'node:assert/strict'
import test from 'node:test'
import { classifyAdminLedgerRpcFailure } from '../supabase/functions/_shared/adminLedgerRpcFailure.ts'
import { normalizeAdminLedgerAiPolicy } from '../supabase/functions/_shared/adminLedgerAiPolicy.ts'
import {
  createMicrosoftStoreReviewContract,
  MICROSOFT_STORE_REVIEW_INVITATION_SECONDS,
  MICROSOFT_STORE_REVIEW_MEMBERSHIP_SECONDS,
  normalizeMicrosoftStoreReviewRequest,
  verifyMicrosoftStoreReviewContract,
} from '../supabase/functions/_shared/adminMicrosoftStoreReview.ts'

const reviewEnvironmentId = '00000000-0000-4000-8000-000000000101'
const reviewRequestId = '00000000-0000-4000-8000-000000000102'
const reviewEmailHmac = 'a'.repeat(64)
const reviewInvitationSecret = 'review-invitation-secret-for-tests-1234567890'
const reviewIssuedAtMs = Date.parse('2026-09-06T00:00:00.000Z')

test('accepts only the minimal Microsoft Store review request shape', () => {
  assert.deepEqual(
    normalizeMicrosoftStoreReviewRequest({
      normalizedEmail: ' Store.Reviewer@Example.Test ',
      purpose: 'microsoftStoreReview',
    }),
    {
      normalizedEmail: 'store.reviewer@example.test',
      purpose: 'microsoftStoreReview',
    },
  )

  for (const broaderPayload of [
    {
      normalizedEmail: 'store.reviewer@example.test',
      purpose: 'microsoftStoreReview',
      role: 'owner',
    },
    {
      canUseAi: true,
      normalizedEmail: 'store.reviewer@example.test',
      purpose: 'microsoftStoreReview',
    },
    {
      expiresAt: '2099-01-01T00:00:00.000Z',
      normalizedEmail: 'store.reviewer@example.test',
      purpose: 'microsoftStoreReview',
    },
    {
      membershipExpiresAt: '2099-01-01T00:00:00.000Z',
      normalizedEmail: 'store.reviewer@example.test',
      purpose: 'microsoftStoreReview',
    },
  ]) {
    assert.equal(normalizeMicrosoftStoreReviewRequest(broaderPayload), null)
  }
})

test('server contract fixes Store review role, AI and absolute expiries', async () => {
  const issued = await createMicrosoftStoreReviewContract({
    emailHmac: reviewEmailHmac,
    environmentId: reviewEnvironmentId,
    issuedAtMs: reviewIssuedAtMs,
    invitationSecret: reviewInvitationSecret,
    requestId: reviewRequestId,
  })

  assert.deepEqual(issued.terms, {
    canUseAi: false,
    expiresAt: new Date(
      reviewIssuedAtMs + MICROSOFT_STORE_REVIEW_INVITATION_SECONDS * 1_000,
    ).toISOString(),
    issuedAt: new Date(reviewIssuedAtMs).toISOString(),
    membershipExpiresAt: new Date(
      reviewIssuedAtMs + MICROSOFT_STORE_REVIEW_MEMBERSHIP_SECONDS * 1_000,
    ).toISOString(),
    role: 'instructor',
  })
  assert.deepEqual(
    await verifyMicrosoftStoreReviewContract({
      contract: issued.contract,
      emailHmac: reviewEmailHmac,
      environmentId: reviewEnvironmentId,
      invitationSecret: reviewInvitationSecret,
      nowMs: reviewIssuedAtMs,
      requestId: reviewRequestId,
    }),
    issued.terms,
  )
})

test('rejects altered, cross-scope and expired Store review contracts', async () => {
  const issued = await createMicrosoftStoreReviewContract({
    emailHmac: reviewEmailHmac,
    environmentId: reviewEnvironmentId,
    issuedAtMs: reviewIssuedAtMs,
    invitationSecret: reviewInvitationSecret,
    requestId: reviewRequestId,
  })
  const common = {
    contract: issued.contract,
    emailHmac: reviewEmailHmac,
    environmentId: reviewEnvironmentId,
    invitationSecret: reviewInvitationSecret,
    nowMs:
      reviewIssuedAtMs + MICROSOFT_STORE_REVIEW_INVITATION_SECONDS * 1_000 - 1,
    requestId: reviewRequestId,
  }
  assert.ok(await verifyMicrosoftStoreReviewContract(common))
  const changedLastCharacter = issued.contract.endsWith('A') ? 'B' : 'A'

  for (const changed of [
    {
      ...common,
      contract: `${issued.contract.slice(0, -1)}${changedLastCharacter}`,
    },
    { ...common, emailHmac: 'b'.repeat(64) },
    {
      ...common,
      environmentId: '00000000-0000-4000-8000-000000000103',
    },
    { ...common, invitationSecret: `${reviewInvitationSecret}-changed` },
    { ...common, requestId: '00000000-0000-4000-8000-000000000104' },
    {
      ...common,
      nowMs:
        reviewIssuedAtMs + MICROSOFT_STORE_REVIEW_INVITATION_SECONDS * 1_000,
    },
  ]) {
    assert.equal(await verifyMicrosoftStoreReviewContract(changed), null)
  }
})

test('normalizes the single-action AI budget with exact approved terms', () => {
  assert.deepEqual(
    normalizeAdminLedgerAiPolicy({
      maxCostMicrousdPerLecture: 3_000_000,
      maxCostMicrousdPerDay: 6_000_000,
      validityDays: 30,
    }),
    {
      max_cost_microusd_per_lecture: 3_000_000,
      max_cost_microusd_per_day: 6_000_000,
      validity_days: 30,
    },
  )
  for (const [lecture, day] of [
    [10_000, 10_000],
    [5_000_000, 20_000_000],
  ]) {
    assert.ok(
      normalizeAdminLedgerAiPolicy({
        maxCostMicrousdPerLecture: lecture,
        maxCostMicrousdPerDay: day,
        validityDays: 30,
      }),
    )
  }
})

test('rejects policy escalation, coercion, fractional amounts, and unknown fields', () => {
  const terms = {
    maxCostMicrousdPerLecture: 3_000_000,
    maxCostMicrousdPerDay: 6_000_000,
    validityDays: 30,
  }
  for (const value of [
    null,
    [],
    {},
    { ...terms, role: 'owner' },
    { ...terms, validityDays: 31 },
    { ...terms, maxCostMicrousdPerLecture: '3000000' },
    { ...terms, maxCostMicrousdPerLecture: 9999 },
    { ...terms, maxCostMicrousdPerLecture: 5_000_001 },
    { ...terms, maxCostMicrousdPerDay: 20_000_001 },
    { ...terms, maxCostMicrousdPerDay: 2_999_999 },
    { ...terms, maxCostMicrousdPerDay: 6_000_000.1 },
    { ...terms, maxCostMicrousdPerDay: Infinity },
    { ...terms, maxCostMicrousdPerLecture: NaN },
  ])
    assert.equal(normalizeAdminLedgerAiPolicy(value), null)
})

const pendingConstraintMessage =
  'duplicate key value violates unique constraint "admin_invitations_pending_email_idx"'

test('maps only the pending-email invitation conflict to invitation_pending', () => {
  assert.deepEqual(
    classifyAdminLedgerRpcFailure(
      { code: '23505', message: pendingConstraintMessage },
      'issueInvitation',
    ),
    { code: 'invitation_pending', status: 409 },
  )
  assert.deepEqual(
    classifyAdminLedgerRpcFailure(
      { code: '23505', details: pendingConstraintMessage },
      'issueInvitation',
    ),
    { code: 'invitation_pending', status: 409 },
  )
})

test('does not misclassify unrelated unique violations', () => {
  for (const error of [
    {
      code: '23505',
      message:
        'duplicate key value violates unique constraint "admin_environment_memberships_pkey"',
    },
    { code: '23505', message: 'admin_invitations_pending_email_idx' },
    { code: '23505' },
  ]) {
    assert.deepEqual(classifyAdminLedgerRpcFailure(error, 'issueInvitation'), {
      code: 'service_unavailable',
      status: 503,
    })
  }
})

test('does not expose the invitation conflict mapping to another action', () => {
  assert.deepEqual(
    classifyAdminLedgerRpcFailure(
      { code: '23505', message: pendingConstraintMessage },
      'promoteOwner',
    ),
    { code: 'service_unavailable', status: 503 },
  )
  assert.deepEqual(
    classifyAdminLedgerRpcFailure(
      { code: 'P7335', message: pendingConstraintMessage },
      'issueInvitation',
    ),
    { code: 'state_changed', status: 409 },
  )
})

test('preserves established database error mappings', () => {
  const cases = [
    ['22023', { code: 'request_invalid', status: 400 }],
    ['42501', { code: 'authorization_failed', status: 403 }],
    ['P7310', { code: 'last_owner_required', status: 409 }],
    ['P7335', { code: 'state_changed', status: 409 }],
    ['P7337', { code: 'feature_disabled', status: 503 }],
    ['P7301', { code: 'rate_limited', status: 429 }],
  ] as const

  for (const [code, expected] of cases) {
    assert.deepEqual(classifyAdminLedgerRpcFailure({ code }), expected)
  }
  assert.deepEqual(classifyAdminLedgerRpcFailure(null), {
    code: 'service_unavailable',
    status: 503,
  })
})
