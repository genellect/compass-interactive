import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.110.0'
import { getAdminTokenSecret, verifyAdminToken } from '../_shared/adminToken.ts'
import { handleCors } from '../_shared/cors.ts'
import { describeJsonBodyError, readJsonBody } from '../_shared/requestBody.ts'
import { signPdfAccessToken } from '../_shared/pdfAccessToken.ts'
import { createJsonResponse } from '../_shared/responses.ts'

type RequestBody = {
  action?: 'admin' | 'member'
  adminToken?: string
  lectureSessionId?: string
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
  if (!body.lectureSessionId || !body.action) {
    return jsonResponse(
      { message: 'lectureSessionId and action are required.', ok: false },
      400,
    )
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
    if (
      !body.adminToken ||
      !(await verifyAdminToken(body.adminToken, adminSecret, request))
    ) {
      return jsonResponse({ message: 'Invalid Admin session.', ok: false }, 401)
    }
    const serviceClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false },
    })
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
