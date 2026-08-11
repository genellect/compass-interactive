import { createClient } from 'npm:@supabase/supabase-js@2'
import {
  decodeVerifiedAdminJwtClaims,
  getTrustedGoogleIdentity,
  hasOAuthAmr,
  hmacIdentityValue,
  isGoogleAdminSessionToken,
  readSecret,
  sha256Hex,
} from './adminIdentity.ts'
import { getAllowedCorsOrigin } from './cors.ts'

type EnvironmentConfig = {
  audience?: string
  canonical_admin_origin?: string
  environment_id?: string
  status?: string
  supabase_issuer?: string
}

export type GoogleAdminOperationFailure = {
  code:
    | 'aal2_required'
    | 'app_session_invalid'
    | 'identity_invalid'
    | 'origin_required'
    | 'service_unavailable'
  message: string
  ok: false
  status: number
}

export type GoogleAdminOperationContext = {
  appSessionTokenHash: string
  authUserId: string
  environmentId: string
  googleIssuer: string
  googleSubjectHmac: string
  ok: true
  serviceClient: ReturnType<typeof createClient>
  subjectPepperVersion: number
  supabaseAuthSessionId: string
  transportEnabled: boolean
}

export type GoogleAdminOperationVerification =
  GoogleAdminOperationContext | GoogleAdminOperationFailure

function failure(
  code: GoogleAdminOperationFailure['code'],
  message: string,
  status: number,
): GoogleAdminOperationFailure {
  return { code, message, ok: false, status }
}

function getBearerToken(request: Request) {
  const authorization = request.headers.get('authorization')?.trim() ?? ''
  const match = /^Bearer ([A-Za-z0-9._~-]+)$/.exec(authorization)
  return match?.[1] ?? ''
}

function getEnvironmentId() {
  const value = Deno.env.get('PHASE730_ADMIN_ENVIRONMENT_ID')?.trim() ?? ''
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  )
    ? value
    : ''
}

function getSubjectPepperVersion() {
  const raw = Deno.env.get('ADMIN_IDENTITY_PEPPER_VERSION')?.trim() ?? '1'
  const value = Number(raw)
  return Number.isSafeInteger(value) && value >= 1 && value <= 2_147_483_647
    ? value
    : null
}

/**
 * Performs only the trusted Edge half of C2 verification. Every caller must
 * pass the returned bindings to one service-role-only database facade which
 * rechecks the Google Admin application/Auth session and performs the target
 * read or mutation in the same transaction. A separate verify-then-mutate RPC
 * sequence is intentionally not supported because it would leave a TOCTOU.
 */
export async function verifyGoogleAdminOperationRequest(
  request: Request,
  appSessionToken: string,
): Promise<GoogleAdminOperationVerification> {
  const requestOrigin = getAllowedCorsOrigin(request)
  if (!requestOrigin) {
    return failure(
      'origin_required',
      'Admin operations are not available from this origin.',
      403,
    )
  }

  const bearerToken = getBearerToken(request)
  const normalizedAppSessionToken = appSessionToken.trim()
  if (!bearerToken || !isGoogleAdminSessionToken(normalizedAppSessionToken)) {
    return failure(
      'app_session_invalid',
      'Admin application session could not be verified.',
      401,
    )
  }

  const environmentId = getEnvironmentId()
  const supabaseUrl = Deno.env.get('SUPABASE_URL')?.trim()
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')?.trim()
  const subjectPepperVersion = getSubjectPepperVersion()
  let identityPepper = ''
  try {
    identityPepper = readSecret('ADMIN_IDENTITY_PEPPER')
  } catch {
    // The same generic response covers missing or invalid server-only config.
  }
  if (
    !environmentId ||
    !supabaseUrl ||
    !serviceRoleKey ||
    !subjectPepperVersion ||
    !identityPepper
  ) {
    return failure(
      'service_unavailable',
      'Google Admin operations are not configured.',
      503,
    )
  }

  const serviceClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const { data: userData, error: userError } =
    await serviceClient.auth.getUser(bearerToken)
  const claims = decodeVerifiedAdminJwtClaims(bearerToken)
  const userIdentities = userData.user?.identities ?? []
  const appMetadataProviders = userData.user?.app_metadata?.providers
  const trustedGoogleIdentity = getTrustedGoogleIdentity(userIdentities)
  if (
    userError ||
    !userData.user ||
    userData.user.is_anonymous === true ||
    !claims ||
    claims.subject !== userData.user.id ||
    claims.aal !== 'aal2' ||
    !hasOAuthAmr(claims) ||
    userData.user.app_metadata?.provider !== 'google' ||
    !Array.isArray(appMetadataProviders) ||
    appMetadataProviders.length !== 1 ||
    appMetadataProviders[0] !== 'google' ||
    userIdentities.length !== 1 ||
    userIdentities[0]?.provider !== 'google' ||
    !trustedGoogleIdentity ||
    !userData.user.factors?.some(
      (factor) => factor.factor_type === 'totp' && factor.status === 'verified',
    )
  ) {
    return failure(
      'identity_invalid',
      'Admin identity could not be verified.',
      401,
    )
  }

  const { data: assurance, error: assuranceError } =
    await serviceClient.auth.mfa.getAuthenticatorAssuranceLevel(bearerToken)
  if (
    assuranceError ||
    assurance?.currentLevel !== 'aal2' ||
    assurance.nextLevel !== 'aal2'
  ) {
    return failure(
      'aal2_required',
      'Authenticator verification is required.',
      401,
    )
  }

  const environmentResult = await serviceClient.rpc(
    'get_admin_identity_environment_v1',
    { target_environment_id: environmentId },
  )
  const environment = environmentResult.data as EnvironmentConfig | null
  if (
    environmentResult.error ||
    !environment ||
    environment.environment_id !== environmentId ||
    environment.status !== 'active' ||
    environment.canonical_admin_origin !== requestOrigin ||
    environment.supabase_issuer !== claims.issuer ||
    !environment.audience ||
    !claims.audience.includes(environment.audience)
  ) {
    return failure(
      'identity_invalid',
      'Admin identity could not be verified.',
      401,
    )
  }

  return {
    appSessionTokenHash: await sha256Hex(normalizedAppSessionToken),
    authUserId: userData.user.id,
    environmentId,
    googleIssuer: trustedGoogleIdentity.issuer,
    googleSubjectHmac: await hmacIdentityValue(
      trustedGoogleIdentity.subject,
      identityPepper,
      'subject',
    ),
    ok: true,
    serviceClient,
    subjectPepperVersion,
    supabaseAuthSessionId: claims.sessionId,
    transportEnabled:
      Deno.env.get('PHASE730_GOOGLE_ADMIN_OPERATIONS_ENABLED') === 'true',
  }
}
