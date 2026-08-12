import { handleCors } from '../_shared/cors.ts'
import { verifyGoogleAdminOperationRequest } from '../_shared/googleAdminOperations.ts'
import { hasLegacyAdminFields } from '../_shared/googleOnlyAdmin.ts'
import { describeJsonBodyError, readJsonBody } from '../_shared/requestBody.ts'
import {
  runRealtimeProviderHangupSweep,
  type RealtimeProviderHangupJob,
} from '../_shared/realtimeProviderHangup.ts'
import { createJsonResponse } from '../_shared/responses.ts'

type ManageLecturesRequest =
  | {
      action: 'list'
      appSessionToken?: string
      includeHistory?: boolean
      requestId?: string
    }
  | {
      action: 'create'
      appSessionToken?: string
      endsAt?: string | null
      requestId?: string
      startsAt?: string | null
      title?: string
    }
  | {
      action: 'start' | 'close' | 'emergencyStop' | 'duplicate'
      appSessionToken?: string
      lectureSessionId?: string
      requestId?: string
    }
  | {
      action: 'createJournalClubRun'
      appSessionToken?: string
      clientRequestId?: string
      runKind?: 'production' | 'rehearsal'
    }

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function normalizeTimestamp(value: string | null | undefined) {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) throw new Error('Invalid lecture timestamp.')
  return date.toISOString()
}

async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(value.trim().toUpperCase()),
  )
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

function generateLectureCode() {
  const range = 1_000_000
  const maxAccepted = Math.floor(0x1_0000_0000 / range) * range
  const random = new Uint32Array(1)
  do crypto.getRandomValues(random)
  while (random[0] >= maxAccepted)
  return String(random[0] % range).padStart(6, '0')
}

Deno.serve(async (request) => {
  const jsonResponse = createJsonResponse(request)
  const corsResponse = handleCors(request)
  if (corsResponse) return corsResponse
  if (request.method !== 'POST') {
    return jsonResponse({ ok: false, message: 'Method not allowed.' }, 405)
  }

  let body: ManageLecturesRequest
  try {
    body = await readJsonBody<ManageLecturesRequest>(request, 32 * 1024)
  } catch (error) {
    const bodyError = describeJsonBodyError(error)
    return jsonResponse(
      { ok: false, message: bodyError.message },
      bodyError.status,
    )
  }
  if (hasLegacyAdminFields(body) || !body.appSessionToken?.trim()) {
    return jsonResponse(
      { ok: false, message: 'Google Admin credential is required.' },
      401,
    )
  }
  const requestId =
    body.action === 'createJournalClubRun' ? body.clientRequestId : body.requestId
  if (body.action !== 'list' && !UUID_PATTERN.test(requestId ?? '')) {
    return jsonResponse({ ok: false, message: 'requestId is required.' }, 400)
  }

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
  const supabase = verification.serviceClient
  const identity = {
    target_auth_user_id: verification.authUserId,
    target_google_issuer: verification.googleIssuer,
    target_provider_subject_hmac: verification.googleSubjectHmac,
    target_subject_pepper_version: verification.subjectPepperVersion,
    target_supabase_auth_session_id: verification.supabaseAuthSessionId,
    target_token_hash: verification.appSessionTokenHash,
    target_transport_enabled: verification.transportEnabled,
  }

  async function listLectures(includeHistory = true) {
    const { data, error } = await supabase.rpc(
      'manage_google_admin_lectures_v1',
      {
        ...identity,
        target_action: 'list',
        target_include_history: includeHistory,
      },
    )
    if (error) throw new Error(error.message)
    const result = data as { lectures?: unknown; ok?: boolean } | null
    if (result?.ok !== true || !Array.isArray(result.lectures)) {
      throw new Error('Google Admin lecture list is unavailable.')
    }
    return result.lectures
  }

  async function sweepRealtimeProviderCalls(lectureSessionId: string) {
    const openAiApiKey = Deno.env.get('OPENAI_API_KEY')?.trim()
    if (!openAiApiKey) {
      return { claimed: 0, pending: true, retried: 0, stopped: 0 }
    }
    try {
      const result = await runRealtimeProviderHangupSweep({
        apiKey: openAiApiKey,
        claim: async ({ lectureSessionId, limit, operationId }) => {
          const { data, error } = await supabase.rpc(
            'claim_realtime_provider_hangups',
            {
              job_limit: limit,
              target_lecture_session_id: lectureSessionId,
              target_operation_id: operationId,
            },
          )
          if (error) throw new Error('realtime_hangup_claim_failed')
          return (data ?? []) as RealtimeProviderHangupJob[]
        },
        finish: async ({ error: providerError, operationId, succeeded }) => {
          const { data, error } = await supabase.rpc(
            'finish_realtime_provider_hangup',
            {
              target_error: providerError,
              target_operation_id: operationId,
              target_succeeded: succeeded,
            },
          )
          if (error) throw new Error('realtime_hangup_finalize_failed')
          return data === true
        },
        lectureSessionId,
        limit: 10,
      })
      return { ...result, pending: result.retried > 0 }
    } catch {
      return { claimed: 0, pending: true, retried: 1, stopped: 0 }
    }
  }

  async function createWithUniqueCode(
    action: 'create' | 'duplicate' | 'createJournalClubRun',
    values: Record<string, unknown>,
  ) {
    for (let attempt = 0; attempt < 16; attempt += 1) {
      const lectureCode = generateLectureCode()
      const { data, error } = await supabase.rpc(
        'manage_google_admin_lectures_v1',
        {
          ...identity,
          target_action: action,
          target_code: lectureCode,
          target_code_hash: await sha256Hex(lectureCode),
          ...values,
        },
      )
      if (!error) {
        const result = data as {
          idempotentReplay?: boolean
          lectureSessionId?: string
          ok?: boolean
        } | null
        if (result?.ok !== true || !UUID_PATTERN.test(result.lectureSessionId ?? '')) {
          throw new Error('Google Admin lecture operation was not accepted.')
        }
        return result
      }
      if (error.code === '23505') continue
      if (error.code === 'P0001') {
        throw new Error(
          action === 'duplicate'
            ? 'Only a closed lecture can be reused.'
            : 'The production run is already prepared.',
        )
      }
      throw new Error(error.message)
    }
    throw new Error('Could not generate a unique lecture code.')
  }

  try {
    if (body.action === 'list') {
      return jsonResponse({
        lectures: await listLectures(body.includeHistory === true),
        ok: true,
      })
    }

    if (body.action === 'create') {
      const title = body.title?.trim()
      if (!title) {
        return jsonResponse({ ok: false, message: 'Lecture title is required.' }, 400)
      }
      const startsAt = normalizeTimestamp(body.startsAt)
      const endsAt = normalizeTimestamp(body.endsAt)
      if (startsAt && endsAt && new Date(startsAt) >= new Date(endsAt)) {
        return jsonResponse(
          { ok: false, message: 'Lecture end must be after its start.' },
          400,
        )
      }
      await createWithUniqueCode('create', {
        target_ends_at: endsAt,
        target_request_id: body.requestId,
        target_starts_at: startsAt,
        target_title: title,
      })
      return jsonResponse({ lectures: await listLectures(), ok: true })
    }

    if (body.action === 'createJournalClubRun') {
      if (Deno.env.get('PHASE7_27_JOURNAL_CLUB_ENABLED') !== 'true') {
        return jsonResponse(
          { ok: false, message: 'Journal Club preset is not enabled.' },
          409,
        )
      }
      if (
        Deno.env.get('PHASE7_28_JOURNAL_CLUB_PRESET_CREATION_ENABLED') !==
        'true'
      ) {
        return jsonResponse(
          { ok: false, message: 'Journal Club preset creation is retired.' },
          410,
        )
      }
      if (!['production', 'rehearsal'].includes(body.runKind ?? '')) {
        return jsonResponse(
          { ok: false, message: 'Journal Club request is invalid.' },
          400,
        )
      }
      const result = await createWithUniqueCode('createJournalClubRun', {
        target_request_id: body.clientRequestId,
        target_run_kind: body.runKind,
      })
      return jsonResponse({
        createdLectureSessionId: result.lectureSessionId,
        idempotentReplay: result.idempotentReplay === true,
        lectures: await listLectures(),
        ok: true,
      })
    }

    if (body.action === 'duplicate') {
      if (!body.lectureSessionId || !UUID_PATTERN.test(body.lectureSessionId)) {
        return jsonResponse(
          { ok: false, message: 'lectureSessionId is required.' },
          400,
        )
      }
      await createWithUniqueCode('duplicate', {
        target_lecture_session_id: body.lectureSessionId,
        target_request_id: body.requestId,
      })
      return jsonResponse({ lectures: await listLectures(), ok: true })
    }

    if (
      body.action === 'start' ||
      body.action === 'close' ||
      body.action === 'emergencyStop'
    ) {
      if (!body.lectureSessionId || !UUID_PATTERN.test(body.lectureSessionId)) {
        return jsonResponse(
          { ok: false, message: 'lectureSessionId is required.' },
          400,
        )
      }
      const { data, error } = await supabase.rpc(
        'manage_google_admin_lectures_v1',
        {
          ...identity,
          target_action: body.action,
          target_lecture_session_id: body.lectureSessionId,
          target_request_id: body.requestId,
        },
      )
      if (error) throw new Error(error.message)
      if ((data as { ok?: boolean } | null)?.ok !== true) {
        return jsonResponse(
          { ok: false, message: 'Lecture status transition is not allowed.' },
          409,
        )
      }
      const providerHangup =
        body.action === 'close' || body.action === 'emergencyStop'
          ? await sweepRealtimeProviderCalls(body.lectureSessionId)
          : null
      return jsonResponse({
        lectures: await listLectures(),
        ok: true,
        providerHangup,
      })
    }

    return jsonResponse({ ok: false, message: 'Unknown action.' }, 400)
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Lecture operation failed.'
    return jsonResponse(
      { ok: false, message },
      /already prepared|Only a closed/.test(message) ? 409 : 500,
    )
  }
})
