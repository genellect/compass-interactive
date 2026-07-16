import {
  createAdminToken,
  getAdminTokenSecret,
  timingSafeEqual,
} from '../_shared/adminToken.ts'
import { handleCors } from '../_shared/cors.ts'
import { createJsonResponse } from '../_shared/responses.ts'

type VerifyAdminPinRequest = {
  pin?: string
}

Deno.serve(async (request) => {
  const jsonResponse = createJsonResponse(request)
  const corsResponse = handleCors(request)
  if (corsResponse) {
    return corsResponse
  }

  if (request.method !== 'POST') {
    return jsonResponse({ ok: false, message: 'Method not allowed.' }, 405)
  }

  const adminPin = Deno.env.get('ADMIN_PIN')
  if (!adminPin) {
    return jsonResponse(
      { ok: false, message: 'ADMIN_PIN is not configured.' },
      500,
    )
  }

  let body: VerifyAdminPinRequest
  try {
    body = (await request.json()) as VerifyAdminPinRequest
  } catch {
    return jsonResponse({ ok: false, message: 'Invalid JSON body.' }, 400)
  }

  const submittedPin = body.pin?.trim() ?? ''
  if (!timingSafeEqual(submittedPin, adminPin)) {
    return jsonResponse({ ok: false, message: 'Invalid Admin PIN.' }, 401)
  }

  try {
    const adminToken = await createAdminToken(getAdminTokenSecret())
    return jsonResponse({ adminToken, ok: true })
  } catch (error) {
    return jsonResponse(
      {
        ok: false,
        message:
          error instanceof Error
            ? error.message
            : 'Admin token creation failed.',
      },
      500,
    )
  }
})
