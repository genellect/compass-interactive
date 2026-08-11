import { createClient } from 'npm:@supabase/supabase-js@2'
import {
  getAdminTokenSecret,
  sha256Hex,
  verifyAdminToken,
} from '../_shared/adminToken.ts'
import { handleCors } from '../_shared/cors.ts'
import {
  getDisplayTokenClaims,
  getDisplayTokenSecret,
  getDisplayTerminalTokenClaims,
} from '../_shared/displayToken.ts'
import { verifyGoogleAdminOperationRequest } from '../_shared/googleAdminOperations.ts'
import { describeJsonBodyError, readJsonBody } from '../_shared/requestBody.ts'
import { signPdfAccessToken } from '../_shared/pdfAccessToken.ts'
import { createJsonResponse } from '../_shared/responses.ts'

type RequestBody = {
  action?: 'admin' | 'display' | 'member'
  adminToken?: string
  appSessionToken?: string
  displayToken?: string
  lectureSessionId?: string
  requestId?: string
}

type AccessClaimRow = {
  access_version: number
  archive_expires_at: string | null
  expires_at: string
  lecture_public_id: string
  manifest_version: number
  not_before: string
  server_time: string
}

function seconds(value: string) {
  const timestamp = Date.parse(value)
  if (!Number.isFinite(timestamp))
    throw new Error('PDF access time is invalid.')
  return Math.floor(timestamp / 1000)
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

Deno.serve(async (request) => {
  const jsonResponse = createJsonResponse(request)
  const corsResponse = handleCors(request)
  if (corsResponse) return corsResponse
  if (request.method !== 'POST') {
    return jsonResponse({ message: 'Method not allowed.', ok: false }, 405)
  }

  let body: RequestBody
  try {
    body = await readJsonBody<RequestBody>(request, 16 * 1024)
  } catch (error) {
    const bodyError = describeJsonBodyError(error)
    return jsonResponse(
      { message: bodyError.message, ok: false },
      bodyError.status,
    )
  }
  if (
    !body.lectureSessionId ||
    !body.action ||
    !['admin', 'display', 'member'].includes(body.action)
  ) {
    return jsonResponse(
      { message: 'lectureSessionId and action are required.', ok: false },
      400,
    )
  }
  const hasAdminToken =
    typeof body.adminToken === 'string' && body.adminToken.trim().length > 0
  const hasGoogleCredential =
    typeof body.appSessionToken === 'string' &&
    body.appSessionToken.trim().length > 0
  const hasDisplayToken =
    typeof body.displayToken === 'string' && body.displayToken.trim().length > 0
  if (
    (body.action === 'admin' &&
      (hasAdminToken === hasGoogleCredential || hasDisplayToken)) ||
    (body.action === 'display' &&
      (!hasDisplayToken || hasAdminToken || hasGoogleCredential)) ||
    (body.action === 'member' &&
      (hasAdminToken || hasGoogleCredential || hasDisplayToken))
  ) {
    return jsonResponse(
      {
        message: 'Provide exactly one credential for this PDF action.',
        ok: false,
      },
      400,
    )
  }
  if (
    body.action === 'admin' &&
    hasGoogleCredential &&
    !UUID_PATTERN.test(body.requestId ?? '')
  ) {
    return jsonResponse({ message: 'requestId is required.', ok: false }, 400)
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    return jsonResponse(
      { message: 'PDF access is not configured.', ok: false },
      500,
    )
  }

  let claims: AccessClaimRow | null = null
  if (body.action === 'admin') {
    if (hasGoogleCredential) {
      const verification = await verifyGoogleAdminOperationRequest(
        request,
        body.appSessionToken!,
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
      const { data, error } = await verification.serviceClient.rpc(
        'issue_google_admin_pdf_access_claims_v1',
        {
          target_auth_user_id: verification.authUserId,
          target_google_issuer: verification.googleIssuer,
          target_lecture_session_id: body.lectureSessionId,
          target_provider_subject_hmac: verification.googleSubjectHmac,
          target_request_id: body.requestId,
          target_subject_pepper_version: verification.subjectPepperVersion,
          target_supabase_auth_session_id: verification.supabaseAuthSessionId,
          target_token_hash: verification.appSessionTokenHash,
          target_transport_enabled: verification.transportEnabled,
        },
      )
      if (error) {
        return jsonResponse({ message: error.message, ok: false }, 500)
      }
      const result = data as { claims?: unknown; ok?: boolean } | null
      if (result?.ok !== true || !result.claims) {
        return jsonResponse(
          { message: 'PDF access is unavailable.', ok: false },
          403,
        )
      }
      claims = result.claims as AccessClaimRow
    } else {
      let adminSecret: string
      try {
        adminSecret = getAdminTokenSecret()
      } catch (error) {
        return jsonResponse(
          {
            message:
              error instanceof Error ? error.message : 'Admin auth failed.',
            ok: false,
          },
          500,
        )
      }
      if (!(await verifyAdminToken(body.adminToken!, adminSecret, request))) {
        return jsonResponse(
          { message: 'Invalid Admin session.', ok: false },
          401,
        )
      }
      const serviceClient = createClient(supabaseUrl, serviceRoleKey, {
        auth: { persistSession: false },
      })
      const { data, error } = await serviceClient.rpc(
        'admin_get_pdf_access_claims_v1',
        { target_lecture_session_id: body.lectureSessionId },
      )
      if (error) {
        return jsonResponse({ message: error.message, ok: false }, 500)
      }
      claims = data as AccessClaimRow | null
    }
  } else if (body.action === 'display') {
    let displayClaims
    let terminalOnly = false
    try {
      displayClaims = body.displayToken
        ? await getDisplayTokenClaims(
            body.displayToken,
            getDisplayTokenSecret(),
          )
        : null
      if (!displayClaims && body.displayToken) {
        displayClaims = await getDisplayTerminalTokenClaims(
          body.displayToken,
          getDisplayTokenSecret(),
        )
        terminalOnly = Boolean(displayClaims)
      }
    } catch (error) {
      return jsonResponse(
        {
          message:
            error instanceof Error ? error.message : 'Display auth failed.',
          ok: false,
        },
        500,
      )
    }
    if (displayClaims?.lectureSessionId !== body.lectureSessionId) {
      return jsonResponse(
        { message: 'Invalid Display session.', ok: false },
        401,
      )
    }
    const serviceClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false },
    })
    let terminalAccessVerified = false
    if (!terminalOnly) {
      const authorization = request.headers.get('Authorization') ?? ''
      const bearerToken = authorization.startsWith('Bearer ')
        ? authorization.slice('Bearer '.length).trim()
        : ''
      if (!bearerToken) {
        return jsonResponse(
          { message: 'Invalid Display session.', ok: false },
          401,
        )
      }
      const { data: authData, error: authError } =
        await serviceClient.auth.getUser(bearerToken)
      if (authError || !authData.user) {
        return jsonResponse(
          { message: 'Invalid Display session.', ok: false },
          401,
        )
      }
      const tokenJtiHash = await sha256Hex(displayClaims.jti)
      const {
        data: googleDisplayBindingData,
        error: googleDisplayBindingError,
      } = await serviceClient.rpc(
        'verify_and_claim_google_display_session_v1',
        {
          target_display_auth_user_id: authData.user.id,
          target_lecture_session_id: body.lectureSessionId,
          target_token_jti_hash: tokenJtiHash,
        },
      )
      if (googleDisplayBindingError) {
        return jsonResponse(
          { message: 'Display session verification failed.', ok: false },
          503,
        )
      }
      const googleDisplayBinding = googleDisplayBindingData as {
        reason?: unknown
        recognized?: unknown
        valid?: unknown
      } | null
      if (
        googleDisplayBinding?.recognized === true &&
        googleDisplayBinding.valid !== true
      ) {
        if (googleDisplayBinding.reason === 'claimed_by_other') {
          return jsonResponse(
            { message: 'Invalid Display session.', ok: false },
            401,
          )
        }
        const { data: accessData, error: accessError } =
          await serviceClient.rpc('admin_get_lecture_operator_access_v1', {
            target_lecture_session_id: body.lectureSessionId,
          })
        const access = accessData as {
          mode?: unknown
          terminal?: unknown
        } | null
        if (accessError || access?.mode !== 'terminal' || !access.terminal) {
          return jsonResponse({
            credentialExpired: true,
            message: 'Display session has ended.',
            ok: false,
          })
        }
        terminalAccessVerified = true
      }
      if (googleDisplayBinding?.recognized !== true) {
        const { data: bindingValid, error: bindingError } =
          await serviceClient.rpc('verify_display_realtime_session_v1', {
            target_display_auth_user_id: authData.user.id,
            target_lecture_session_id: body.lectureSessionId,
            target_token_jti_hash: tokenJtiHash,
          })
        if (bindingError) {
          return jsonResponse(
            { message: 'Display session verification failed.', ok: false },
            503,
          )
        }
        if (bindingValid !== true) {
          const { data: realtimeBinding, error: realtimeBindingError } =
            await serviceClient
              .from('display_realtime_sessions')
              .select('id, display_auth_user_id, revoke_reason')
              .eq('lecture_session_id', body.lectureSessionId)
              .eq('token_jti_hash', tokenJtiHash)
              .maybeSingle()
          if (realtimeBindingError) {
            return jsonResponse(
              { message: 'Display session verification failed.', ok: false },
              503,
            )
          }
          // Legacy clients have no binding and intentionally keep the pre-7.28
          // signed-token PDF path during staged rollout. A registered token may
          // downgrade only when the DB runtime gate is OFF and a service-only RPC
          // revalidates its browser, lecture, binding, and issuing Admin session.
          let snapshotFallbackValid = false
          if (realtimeBinding) {
            const { data: fallbackValid, error: fallbackError } =
              await serviceClient.rpc('verify_display_snapshot_fallback_v1', {
                target_display_auth_user_id: authData.user.id,
                target_lecture_session_id: body.lectureSessionId,
                target_token_jti_hash: tokenJtiHash,
              })
            if (fallbackError) {
              return jsonResponse(
                { message: 'Display session verification failed.', ok: false },
                503,
              )
            }
            snapshotFallbackValid = fallbackValid === true
          }
          if (realtimeBinding && !snapshotFallbackValid) {
            const { data: accessData, error: accessError } =
              await serviceClient.rpc('admin_get_lecture_operator_access_v1', {
                target_lecture_session_id: body.lectureSessionId,
              })
            const access = accessData as {
              mode?: unknown
              terminal?: unknown
            } | null
            if (
              accessError ||
              access?.mode !== 'terminal' ||
              !access.terminal
            ) {
              if (realtimeBinding.display_auth_user_id === authData.user.id) {
                return jsonResponse({
                  credentialExpired: true,
                  message: 'Display session has ended.',
                  ok: false,
                })
              }
              return jsonResponse(
                { message: 'Invalid Display session.', ok: false },
                401,
              )
            }
            terminalAccessVerified = true
          }
        }
      }
    }
    if (terminalOnly && !terminalAccessVerified) {
      const { data: accessData, error: accessError } = await serviceClient.rpc(
        'admin_get_lecture_operator_access_v1',
        {
          target_lecture_session_id: body.lectureSessionId,
        },
      )
      const access = accessData as {
        mode?: unknown
        terminal?: unknown
      } | null
      if (accessError || access?.mode !== 'terminal' || !access.terminal) {
        return jsonResponse(
          { message: 'Display archive is unavailable.', ok: false },
          401,
        )
      }
    }
    const { data, error } = await serviceClient.rpc(
      'admin_get_pdf_access_claims_v1',
      { target_lecture_session_id: body.lectureSessionId },
    )
    if (error) return jsonResponse({ message: error.message, ok: false }, 500)
    claims = data as AccessClaimRow | null
  } else {
    const authorization = request.headers.get('Authorization')
    if (!authorization?.startsWith('Bearer ')) {
      return jsonResponse(
        { message: 'Authentication required.', ok: false },
        401,
      )
    }
    const userClient = createClient(supabaseUrl, anonKey, {
      auth: { persistSession: false },
      global: { headers: { Authorization: authorization } },
    })
    const { data, error } = await userClient.rpc('get_pdf_access_claims_v1', {
      target_lecture_session_id: body.lectureSessionId,
    })
    if (error) return jsonResponse({ message: error.message, ok: false }, 403)
    claims = data as AccessClaimRow | null
  }

  if (!claims) {
    return jsonResponse(
      { message: 'PDF access is unavailable.', ok: false },
      403,
    )
  }

  try {
    const lecturePublicId = `lecture_${claims.lecture_public_id.replaceAll('-', '')}`
    const accessToken = await signPdfAccessToken({
      ...(claims.archive_expires_at
        ? { accessUntil: seconds(claims.archive_expires_at) }
        : {}),
      accessVersion: claims.access_version,
      audience: Deno.env.get('PDF_ACCESS_AUDIENCE') ?? 'compass-pdf-worker',
      expiresAt: seconds(claims.expires_at),
      issuedAt: seconds(claims.server_time),
      issuer: Deno.env.get('PDF_ACCESS_ISSUER') ?? 'compass-supabase',
      keyId: Deno.env.get('PDF_ACCESS_KEY_ID') ?? 'compass-pdf-local-1',
      lecturePublicId,
      manifestVersion: claims.manifest_version,
      notBefore: seconds(claims.not_before),
    })
    return jsonResponse({
      accessToken,
      expiresAt: claims.expires_at,
      lecturePublicId,
      manifestVersion: claims.manifest_version,
      ok: true,
      workerBaseUrl: Deno.env.get('PDF_WORKER_BASE_URL') ?? null,
    })
  } catch (error) {
    return jsonResponse(
      {
        message: error instanceof Error ? error.message : 'PDF token failed.',
        ok: false,
      },
      500,
    )
  }
})
