import { createClient } from 'npm:@supabase/supabase-js@2'
import {
  getAdminTokenClaims,
  getAdminTokenSecret,
  trackedAdminSessionsEnabled,
} from '../_shared/adminToken.ts'
import { handleCors } from '../_shared/cors.ts'
import {
  readJsonBody,
  RequestBodyTooLargeError,
  UnsupportedJsonContentTypeError,
} from '../_shared/requestBody.ts'
import { createJsonResponse } from '../_shared/responses.ts'
import {
  type GoogleAdminOperationContext,
  verifyGoogleAdminOperationRequest,
} from '../_shared/googleAdminOperations.ts'

type ManageAdminSessionRequest = {
  action?: 'list' | 'logout' | 'revoke' | 'revokeAll'
  adminToken?: string
  appSessionToken?: string
  requestId?: string
  sessionId?: string
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

Deno.serve(async (request) => {
  const jsonResponse = createJsonResponse(request)
  const corsResponse = handleCors(request)
  if (corsResponse) return corsResponse
  if (request.method !== 'POST') {
    return jsonResponse({ ok: false, message: 'Method not allowed.' }, 405)
  }
  let body: ManageAdminSessionRequest
  try {
    body = await readJsonBody<ManageAdminSessionRequest>(request, 8_192)
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) {
      return jsonResponse({ ok: false, message: 'Request is too large.' }, 413)
    }
    if (error instanceof UnsupportedJsonContentTypeError) {
      return jsonResponse({ ok: false, message: 'Request must be JSON.' }, 415)
    }
    return jsonResponse({ ok: false, message: 'Invalid JSON body.' }, 400)
  }
  if (!body.action) {
    return jsonResponse({ ok: false, message: 'Request is incomplete.' }, 400)
  }
  const hasGoogleCredential = Boolean(body.appSessionToken)
  const hasLegacyCredential = Boolean(body.adminToken)
  if (hasGoogleCredential === hasLegacyCredential) {
    return jsonResponse(
      { ok: false, message: 'Exactly one Admin credential is required.' },
      400,
    )
  }

  let googleContext: GoogleAdminOperationContext | null = null
  let legacySessionId: string | null = null
  if (body.appSessionToken) {
    const verification = await verifyGoogleAdminOperationRequest(
      request,
      body.appSessionToken,
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
    googleContext = verification
  } else {
    if (!trackedAdminSessionsEnabled()) {
      return jsonResponse(
        { ok: false, message: 'Admin session management is unavailable.' },
        503,
      )
    }
    const claims = await getAdminTokenClaims(
      body.adminToken ?? '',
      getAdminTokenSecret(),
      request,
    ).catch(() => null)
    if (!claims?.sid) {
      return jsonResponse({ ok: false, message: 'Invalid Admin session.' }, 401)
    }
    legacySessionId = claims.sid
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!supabaseUrl || !serviceRoleKey) {
    return jsonResponse(
      { ok: false, message: 'Admin session storage is unavailable.' },
      503,
    )
  }
  const supabase =
    googleContext?.serviceClient ??
    createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false },
    })

  if (googleContext) {
    if (body.action === 'list') {
      const { data, error } = await supabase.rpc(
        'get_google_admin_sessions_v1',
        {
          target_auth_user_id: googleContext.authUserId,
          target_google_issuer: googleContext.googleIssuer,
          target_provider_subject_hmac: googleContext.googleSubjectHmac,
          target_subject_pepper_version: googleContext.subjectPepperVersion,
          target_supabase_auth_session_id: googleContext.supabaseAuthSessionId,
          target_token_hash: googleContext.appSessionTokenHash,
          target_transport_enabled: googleContext.transportEnabled,
        },
      )
      if (error || !data) {
        return jsonResponse(
          { ok: false, message: '管理セッションを読み込めませんでした。' },
          error ? 503 : 404,
        )
      }
      return jsonResponse(data)
    }

    if (!body.requestId || !UUID_PATTERN.test(body.requestId)) {
      return jsonResponse({ ok: false, message: 'requestId is required.' }, 400)
    }
    if (
      (body.action === 'revoke' &&
        (!body.sessionId || !UUID_PATTERN.test(body.sessionId))) ||
      (body.action !== 'revoke' && body.sessionId != null)
    ) {
      return jsonResponse(
        { ok: false, message: 'Session target is invalid.' },
        400,
      )
    }

    const { data, error } = await supabase.rpc(
      'manage_google_admin_sessions_v1',
      {
        target_action: body.action,
        target_auth_user_id: googleContext.authUserId,
        target_google_issuer: googleContext.googleIssuer,
        target_provider_subject_hmac: googleContext.googleSubjectHmac,
        target_request_id: body.requestId,
        target_session_id:
          body.action === 'revoke' ? (body.sessionId ?? null) : null,
        target_subject_pepper_version: googleContext.subjectPepperVersion,
        target_supabase_auth_session_id: googleContext.supabaseAuthSessionId,
        target_token_hash: googleContext.appSessionTokenHash,
        target_transport_enabled: googleContext.transportEnabled,
      },
    )
    if (error) {
      return jsonResponse(
        { ok: false, message: '管理セッションを更新できませんでした。' },
        error.code === '22023' || error.code === 'P7335' ? 400 : 409,
      )
    }
    if (!data || (data as { ok?: boolean }).ok !== true) {
      return jsonResponse(
        { ok: false, message: '管理セッションの更新を確認できませんでした。' },
        409,
      )
    }
    return jsonResponse(data)
  }

  if (body.action === 'list') {
    const { data, error } = await supabase
      .from('admin_sessions')
      .select(
        'id,issued_at,last_seen_at,idle_expires_at,expires_at,revoked_at,revoke_reason',
      )
      .eq('authentication_method', 'legacy_pin')
      .order('issued_at', { ascending: false })
      .limit(20)
    if (error) {
      return jsonResponse(
        { ok: false, message: 'Admin sessions could not be loaded.' },
        503,
      )
    }
    return jsonResponse({
      currentSessionId: legacySessionId,
      ok: true,
      sessions: data,
    })
  }

  const now = new Date().toISOString()
  if (body.action === 'logout') {
    const { error } = await supabase
      .from('admin_sessions')
      .update({
        revoke_reason: 'logout',
        revoked_at: now,
        updated_at: now,
      })
      .eq('id', legacySessionId)
      .eq('authentication_method', 'legacy_pin')
      .is('revoked_at', null)
    return error
      ? jsonResponse({ ok: false, message: 'Admin logout failed.' }, 503)
      : jsonResponse({ ok: true })
  }

  if (body.action === 'revoke') {
    if (!body.sessionId || !UUID_PATTERN.test(body.sessionId)) {
      return jsonResponse({ ok: false, message: 'Session is invalid.' }, 400)
    }
    const { error } = await supabase
      .from('admin_sessions')
      .update({
        revoke_reason: 'admin_revoked',
        revoked_at: now,
        updated_at: now,
      })
      .eq('id', body.sessionId)
      .eq('authentication_method', 'legacy_pin')
      .is('revoked_at', null)
    return error
      ? jsonResponse(
          { ok: false, message: 'Admin session revoke failed.' },
          503,
        )
      : jsonResponse({ ok: true })
  }

  if (body.action === 'revokeAll') {
    const { error } = await supabase
      .from('admin_sessions')
      .update({
        revoke_reason: 'admin_revoked_all',
        revoked_at: now,
        updated_at: now,
      })
      .eq('authentication_method', 'legacy_pin')
      .is('revoked_at', null)
    return error
      ? jsonResponse(
          { ok: false, message: 'Admin sessions revoke failed.' },
          503,
        )
      : jsonResponse({ ok: true })
  }

  return jsonResponse({ ok: false, message: 'Action is invalid.' }, 400)
})
