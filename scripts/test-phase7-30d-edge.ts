import assert from 'node:assert/strict'
import test from 'node:test'
import { classifyAdminLedgerRpcFailure } from '../supabase/functions/_shared/adminLedgerRpcFailure.ts'
import { normalizeAdminLedgerAiPolicy } from '../supabase/functions/_shared/adminLedgerAiPolicy.ts'

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
