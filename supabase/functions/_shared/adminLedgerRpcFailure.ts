export type AdminLedgerRpcError = {
  code?: string
  details?: string
  message?: string
}

const PENDING_INVITATION_CONSTRAINT =
  'unique constraint "admin_invitations_pending_email_idx"'

export function classifyAdminLedgerRpcFailure(
  error: AdminLedgerRpcError | null,
  action?: string,
) {
  const isExistingPendingInvitation =
    action === 'issueInvitation' &&
    error?.code === '23505' &&
    [error.message, error.details].some((value) =>
      value?.includes(PENDING_INVITATION_CONSTRAINT),
    )
  if (isExistingPendingInvitation) {
    return { code: 'invitation_pending', status: 409 }
  }

  switch (error?.code) {
    case '22023':
      return { code: 'request_invalid', status: 400 }
    case '42501':
      return { code: 'authorization_failed', status: 403 }
    case 'P7310':
      return { code: 'last_owner_required', status: 409 }
    case 'P7335':
      return { code: 'state_changed', status: 409 }
    case 'P7337':
      return { code: 'feature_disabled', status: 503 }
    case 'P7301':
      return { code: 'rate_limited', status: 429 }
    default:
      return { code: 'service_unavailable', status: 503 }
  }
}
