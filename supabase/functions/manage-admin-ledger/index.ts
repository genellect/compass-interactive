import {
  deriveAdminInvitationToken,
  hmacIdentityValue,
  readSecret,
  sha256Hex,
} from '../_shared/adminIdentity.ts'
import { classifyAdminLedgerRpcFailure } from '../_shared/adminLedgerRpcFailure.ts'
import { normalizeAdminLedgerAiPolicy as normalizeAiPolicy } from '../_shared/adminLedgerAiPolicy.ts'
import { handleCors } from '../_shared/cors.ts'
import {
  readJsonBody,
  RequestBodyTooLargeError,
  UnsupportedJsonContentTypeError,
} from '../_shared/requestBody.ts'
import { createJsonResponse } from '../_shared/responses.ts'
import { verifyGoogleAdminOperationRequest } from '../_shared/googleAdminOperations.ts'

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const SHA256_HEX_PATTERN = /^[0-9a-f]{64}$/
const REASON_PATTERN = /^[a-z][a-z0-9_]{0,79}$/
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const MUTATION_ACTIONS = [
  'issueInvitation',
  'revokeInvitation',
  'promoteOwner',
  'demoteOwner',
  'suspendMembership',
  'reactivateMembership',
  'revokeMembership',
  'enableAi',
  'disableAi',
  'revokeSession',
  'globalRevoke',
] as const
type MutationAction = (typeof MUTATION_ACTIONS)[number]
const MUTATION_ACTION_SET = new Set<string>(MUTATION_ACTIONS)

type LedgerRequest = {
  action?: 'audit' | 'snapshot' | MutationAction
  appSessionToken?: string
  beforeAt?: string
  beforeId?: string
  intentDigest?: string
  limit?: number
  payload?: unknown
  requestId?: string
  stage?: 'commit' | 'intent'
}

function hasExactKeys(value: Record<string, unknown>, keys: string[]) {
  const expected = [...keys].sort()
  const actual = Object.keys(value).sort()
  return (
    actual.length === expected.length &&
    actual.every((key, index) => key === expected[index])
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function isTimestamp(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length >= 20 &&
    value.length <= 40 &&
    Number.isFinite(Date.parse(value))
  )
}

function isMembershipStatus(value: unknown) {
  return ['pending_mfa', 'active', 'suspended'].includes(String(value))
}

function normalizeMutationPayload(
  action: Exclude<MutationAction, 'issueInvitation'>,
  value: unknown,
): Record<string, unknown> | null {
  if (!isRecord(value)) return null
  if ('aiPolicy' in value) {
    if (action !== 'enableAi') return null
    const aiPolicy = normalizeAiPolicy(value.aiPolicy)
    if (!aiPolicy) return null
    const { aiPolicy: _policy, ...membershipPayload } = value
    const normalized = normalizeMutationPayload(action, membershipPayload)
    return normalized ? { ...normalized, ai_policy: aiPolicy } : null
  }

  if (action === 'revokeInvitation') {
    if (
      !hasExactKeys(value, [
        'expectedStatus',
        'expectedUpdatedAt',
        'invitationId',
      ]) ||
      value.expectedStatus !== 'pending' ||
      !isTimestamp(value.expectedUpdatedAt) ||
      typeof value.invitationId !== 'string' ||
      !UUID_PATTERN.test(value.invitationId)
    ) {
      return null
    }
    return {
      expected_status: value.expectedStatus,
      expected_updated_at: value.expectedUpdatedAt,
      invitation_id: value.invitationId,
    }
  }

  if (action === 'revokeSession') {
    if (
      !hasExactKeys(value, ['membershipId', 'sessionId']) ||
      typeof value.membershipId !== 'string' ||
      !UUID_PATTERN.test(value.membershipId) ||
      typeof value.sessionId !== 'string' ||
      !UUID_PATTERN.test(value.sessionId)
    ) {
      return null
    }
    return { membership_id: value.membershipId, session_id: value.sessionId }
  }

  if (action === 'globalRevoke') {
    if (
      !hasExactKeys(value, ['membershipId']) ||
      typeof value.membershipId !== 'string' ||
      !UUID_PATTERN.test(value.membershipId)
    ) {
      return null
    }
    return { membership_id: value.membershipId }
  }

  const commonKeys = ['expectedStatus', 'expectedUpdatedAt', 'membershipId']
  if (
    typeof value.membershipId !== 'string' ||
    !UUID_PATTERN.test(value.membershipId) ||
    !isMembershipStatus(value.expectedStatus) ||
    !isTimestamp(value.expectedUpdatedAt)
  ) {
    return null
  }

  if (action === 'promoteOwner') {
    if (
      !hasExactKeys(value, [...commonKeys, 'expectedRole']) ||
      value.expectedRole !== 'instructor' ||
      value.expectedStatus !== 'active'
    ) {
      return null
    }
    return {
      expected_role: value.expectedRole,
      expected_status: value.expectedStatus,
      expected_updated_at: value.expectedUpdatedAt,
      membership_id: value.membershipId,
    }
  }

  if (action === 'demoteOwner') {
    if (
      !hasExactKeys(value, [
        ...commonKeys,
        'expectedRole',
        'membershipExpiresAt',
        'reasonCode',
      ]) ||
      value.expectedRole !== 'owner' ||
      value.expectedStatus !== 'active' ||
      (value.membershipExpiresAt !== null &&
        !isTimestamp(value.membershipExpiresAt)) ||
      typeof value.reasonCode !== 'string' ||
      !REASON_PATTERN.test(value.reasonCode)
    ) {
      return null
    }
    return {
      expected_role: value.expectedRole,
      expected_status: value.expectedStatus,
      expected_updated_at: value.expectedUpdatedAt,
      membership_expires_at: value.membershipExpiresAt,
      membership_id: value.membershipId,
      reason_code: value.reasonCode,
    }
  }

  if (action === 'suspendMembership' || action === 'revokeMembership') {
    if (
      !hasExactKeys(value, [...commonKeys, 'reasonCode']) ||
      typeof value.reasonCode !== 'string' ||
      !REASON_PATTERN.test(value.reasonCode) ||
      (action === 'suspendMembership' && value.expectedStatus !== 'active')
    ) {
      return null
    }
    return {
      expected_status: value.expectedStatus,
      expected_updated_at: value.expectedUpdatedAt,
      membership_id: value.membershipId,
      reason_code: value.reasonCode,
    }
  }

  if (action === 'reactivateMembership') {
    if (
      !hasExactKeys(value, commonKeys) ||
      value.expectedStatus !== 'suspended'
    ) {
      return null
    }
    return {
      expected_status: value.expectedStatus,
      expected_updated_at: value.expectedUpdatedAt,
      membership_id: value.membershipId,
    }
  }

  if (
    !hasExactKeys(value, [...commonKeys, 'expectedCanUseAi']) ||
    typeof value.expectedCanUseAi !== 'boolean' ||
    value.expectedStatus !== 'active' ||
    (action === 'enableAi' && value.expectedCanUseAi !== false) ||
    (action === 'disableAi' && value.expectedCanUseAi !== true)
  ) {
    return null
  }
  return {
    expected_can_use_ai: value.expectedCanUseAi,
    expected_status: value.expectedStatus,
    expected_updated_at: value.expectedUpdatedAt,
    membership_id: value.membershipId,
  }
}

Deno.serve(async (request) => {
  const jsonResponse = createJsonResponse(request)
  const corsResponse = handleCors(request)
  if (corsResponse) return corsResponse
  if (request.method !== 'POST') {
    return jsonResponse(
      { code: 'method_not_allowed', message: 'Method not allowed.', ok: false },
      405,
    )
  }

  let body: LedgerRequest
  try {
    body = await readJsonBody<LedgerRequest>(request, 16_384)
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) {
      return jsonResponse(
        {
          code: 'request_too_large',
          message: 'Request is too large.',
          ok: false,
        },
        413,
      )
    }
    if (error instanceof UnsupportedJsonContentTypeError) {
      return jsonResponse(
        {
          code: 'content_type_invalid',
          message: 'Request must be JSON.',
          ok: false,
        },
        415,
      )
    }
    return jsonResponse(
      { code: 'request_invalid', message: 'Invalid JSON body.', ok: false },
      400,
    )
  }

  if (!isRecord(body) || typeof body.action !== 'string') {
    return jsonResponse(
      { code: 'request_invalid', message: 'Request is invalid.', ok: false },
      400,
    )
  }
  const appSessionToken = body.appSessionToken?.trim() ?? ''
  const verification = await verifyGoogleAdminOperationRequest(
    request,
    appSessionToken,
  )
  if (!verification.ok) {
    return jsonResponse(
      {
        code: verification.code,
        message: verification.message,
        ok: false,
      },
      verification.status,
    )
  }
  const transportEnabled =
    verification.transportEnabled &&
    Deno.env.get('PHASE730_GOOGLE_ADMIN_LEDGER_ENABLED') === 'true'
  const identityArgs = {
    target_auth_user_id: verification.authUserId,
    target_google_issuer: verification.googleIssuer,
    target_provider_subject_hmac: verification.googleSubjectHmac,
    target_subject_pepper_version: verification.subjectPepperVersion,
    target_supabase_auth_session_id: verification.supabaseAuthSessionId,
    target_token_hash: verification.appSessionTokenHash,
    target_transport_enabled: transportEnabled,
  }

  if (body.action === 'snapshot') {
    if (!hasExactKeys(body, ['action', 'appSessionToken'])) {
      return jsonResponse(
        { code: 'request_invalid', message: 'Request is invalid.', ok: false },
        400,
      )
    }
    const { data, error } = await verification.serviceClient.rpc(
      'get_google_admin_ledger_v1',
      identityArgs,
    )
    if (error || !data) {
      const failure = error
        ? classifyAdminLedgerRpcFailure(error)
        : { code: 'authorization_failed', status: 403 }
      return jsonResponse(
        {
          code: failure.code,
          message: '管理台帳を読み込めませんでした。',
          ok: false,
        },
        failure.status,
      )
    }
    return jsonResponse(data)
  }

  if (body.action === 'audit') {
    if (
      !hasExactKeys(
        body,
        ['action', 'appSessionToken'].concat(
          body.beforeAt === undefined ? [] : ['beforeAt'],
          body.beforeId === undefined ? [] : ['beforeId'],
          body.limit === undefined ? [] : ['limit'],
        ),
      ) ||
      (body.beforeAt === undefined) !== (body.beforeId === undefined) ||
      (body.beforeAt !== undefined && !isTimestamp(body.beforeAt)) ||
      (body.beforeId !== undefined &&
        !/^[1-9][0-9]{0,18}$/.test(body.beforeId)) ||
      (body.limit !== undefined &&
        (!Number.isInteger(body.limit) || body.limit < 1 || body.limit > 100))
    ) {
      return jsonResponse(
        { code: 'request_invalid', message: 'Request is invalid.', ok: false },
        400,
      )
    }
    const { data, error } = await verification.serviceClient.rpc(
      'get_google_admin_ledger_audit_v1',
      {
        ...identityArgs,
        target_before_at: body.beforeAt ?? null,
        target_before_id: body.beforeId ?? null,
        target_limit: body.limit ?? 50,
      },
    )
    if (error || !data) {
      const failure = error
        ? classifyAdminLedgerRpcFailure(error)
        : { code: 'authorization_failed', status: 403 }
      return jsonResponse(
        {
          code: failure.code,
          message: '監査履歴を読み込めませんでした。',
          ok: false,
        },
        failure.status,
      )
    }
    return jsonResponse(data)
  }

  if (!MUTATION_ACTION_SET.has(body.action)) {
    return jsonResponse(
      { code: 'request_invalid', message: 'Request is invalid.', ok: false },
      400,
    )
  }
  const action = body.action as MutationAction
  if (
    !hasExactKeys(body, [
      'action',
      'appSessionToken',
      'payload',
      'requestId',
      'stage',
      ...(body.stage === 'commit' ? ['intentDigest'] : []),
    ]) ||
    !body.requestId ||
    !UUID_PATTERN.test(body.requestId) ||
    (body.stage !== 'intent' && body.stage !== 'commit') ||
    (body.stage === 'commit' &&
      (!body.intentDigest || !SHA256_HEX_PATTERN.test(body.intentDigest)))
  ) {
    return jsonResponse(
      { code: 'request_invalid', message: 'Request is invalid.', ok: false },
      400,
    )
  }

  let invitationToken: string | null = null
  let payload: Record<string, unknown> | null = null
  if (action === 'issueInvitation') {
    if (
      !isRecord(body.payload) ||
      !hasExactKeys(body.payload, [
        'canUseAi',
        'expiresAt',
        'membershipExpiresAt',
        'normalizedEmail',
        'role',
        ...('aiPolicy' in body.payload ? ['aiPolicy'] : []),
      ]) ||
      typeof body.payload.normalizedEmail !== 'string' ||
      typeof body.payload.canUseAi !== 'boolean' ||
      (body.payload.role !== 'owner' && body.payload.role !== 'instructor') ||
      !isTimestamp(body.payload.expiresAt) ||
      (body.payload.membershipExpiresAt !== null &&
        !isTimestamp(body.payload.membershipExpiresAt))
    ) {
      return jsonResponse(
        { code: 'request_invalid', message: 'Request is invalid.', ok: false },
        400,
      )
    }
    const aiPolicy =
      'aiPolicy' in body.payload
        ? normalizeAiPolicy(body.payload.aiPolicy)
        : undefined
    if (
      'aiPolicy' in body.payload &&
      (!aiPolicy ||
        body.payload.role !== 'instructor' ||
        body.payload.canUseAi !== true ||
        body.payload.membershipExpiresAt !== null)
    ) {
      return jsonResponse(
        { code: 'request_invalid', message: 'Request is invalid.', ok: false },
        400,
      )
    }
    const normalizedEmail = body.payload.normalizedEmail.trim().toLowerCase()
    if (
      normalizedEmail.length < 3 ||
      normalizedEmail.length > 320 ||
      !EMAIL_PATTERN.test(normalizedEmail)
    ) {
      return jsonResponse(
        { code: 'request_invalid', message: 'Request is invalid.', ok: false },
        400,
      )
    }
    try {
      const identityPepper = readSecret('ADMIN_IDENTITY_PEPPER')
      const invitationSecret = readSecret('ADMIN_INVITATION_SECRET')
      const emailHmac = await hmacIdentityValue(
        normalizedEmail,
        identityPepper,
        'email',
      )
      invitationToken = await deriveAdminInvitationToken(
        verification.environmentId,
        body.requestId,
        emailHmac,
        invitationSecret,
      )
      payload = {
        ...(aiPolicy ? { ai_policy: aiPolicy } : {}),
        can_use_ai: body.payload.canUseAi,
        email_hmac: emailHmac,
        email_pepper_version: verification.subjectPepperVersion,
        expires_at: body.payload.expiresAt,
        invitation_token_hash: await sha256Hex(invitationToken),
        membership_expires_at: body.payload.membershipExpiresAt,
        normalized_email: normalizedEmail,
        role: body.payload.role,
      }
    } catch {
      return jsonResponse(
        {
          code: 'service_unavailable',
          message: '招待機能が設定されていません。',
          ok: false,
        },
        503,
      )
    }
  } else {
    payload = normalizeMutationPayload(action, body.payload)
  }

  if (!payload) {
    return jsonResponse(
      { code: 'request_invalid', message: 'Request is invalid.', ok: false },
      400,
    )
  }

  const rpcName =
    body.stage === 'intent'
      ? 'get_google_admin_ledger_intent_v1'
      : 'manage_google_admin_ledger_v1'
  const rpcArgs = {
    ...identityArgs,
    target_action: action,
    target_payload: payload,
    target_request_id: body.requestId,
    ...(body.stage === 'commit'
      ? { target_intent_digest: body.intentDigest! }
      : {}),
  }
  const { data, error } = await verification.serviceClient.rpc(rpcName, rpcArgs)
  if (error || !data) {
    const failure = error
      ? classifyAdminLedgerRpcFailure(error, action)
      : { code: 'authorization_failed', status: 403 }
    return jsonResponse(
      {
        code: failure.code,
        message: '管理台帳を更新できませんでした。',
        ok: false,
      },
      failure.status,
    )
  }
  if (body.stage === 'commit' && action === 'issueInvitation') {
    return jsonResponse({
      ...(data as Record<string, unknown>),
      invitationToken,
    })
  }
  return jsonResponse(data)
})
