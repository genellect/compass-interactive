import { handleCors } from '../_shared/cors.ts'
import { verifyGoogleAdminOperationRequest } from '../_shared/googleAdminOperations.ts'
import { hasLegacyAdminFields } from '../_shared/googleOnlyAdmin.ts'
import { describeJsonBodyError, readJsonBody } from '../_shared/requestBody.ts'
import { createJsonResponse } from '../_shared/responses.ts'

type PollType = 'single' | 'multiple'

type ManagePollsRequest =
  | {
      action: 'list'
      appSessionToken?: string
      includeHistory?: boolean
      lectureSessionId?: string
      requestId?: string
    }
  | {
      action: 'create'
      appSessionToken?: string
      includeHistory?: boolean
      lectureSessionId?: string
      optionLabels?: string[]
      question?: string
      requestId?: string
      type?: PollType
    }
  | {
      action: 'open' | 'close'
      appSessionToken?: string
      includeHistory?: boolean
      lectureSessionId?: string
      pollId?: string
      requestId?: string
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

  let body: ManagePollsRequest
  try {
    body = await readJsonBody<ManagePollsRequest>(request, 64 * 1024)
  } catch (error) {
    const bodyError = describeJsonBodyError(error)
    return jsonResponse(
      { ok: false, message: bodyError.message },
      bodyError.status,
    )
  }
  if (
    hasLegacyAdminFields(body) ||
    !body.appSessionToken?.trim() ||
    !body.lectureSessionId ||
    !UUID_PATTERN.test(body.lectureSessionId)
  ) {
    return jsonResponse(
      { ok: false, message: 'Google Admin credential and lecture are required.' },
      400,
    )
  }
  if (
    body.action !== 'list' &&
    !UUID_PATTERN.test(body.requestId ?? '')
  ) {
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
  const serviceClient = verification.serviceClient
  const identity = {
    target_auth_user_id: verification.authUserId,
    target_google_issuer: verification.googleIssuer,
    target_provider_subject_hmac: verification.googleSubjectHmac,
    target_subject_pepper_version: verification.subjectPepperVersion,
    target_supabase_auth_session_id: verification.supabaseAuthSessionId,
    target_token_hash: verification.appSessionTokenHash,
    target_transport_enabled: verification.transportEnabled,
  }

  async function runPollAction(
    action: 'list' | 'create' | 'open' | 'close',
    values: {
      optionLabels?: string[] | null
      pollId?: string | null
      pollType?: PollType | null
      question?: string | null
      requestId?: string | null
    } = {},
  ) {
    const { data, error } = await serviceClient.rpc(
      'manage_google_admin_polls_v1',
      {
        ...identity,
        target_action: action,
        target_include_history: body.includeHistory ?? false,
        target_lecture_session_id: body.lectureSessionId,
        target_option_labels: values.optionLabels ?? null,
        target_poll_id: values.pollId ?? null,
        target_poll_type: values.pollType ?? null,
        target_question: values.question ?? null,
        target_request_id: values.requestId ?? null,
      },
    )
    if (error) throw new Error(error.message)
    const result = data as {
      hasMore?: unknown
      ok?: boolean
      polls?: unknown
      refreshRequired?: boolean
    } | null
    if (
      result?.ok !== true ||
      typeof result.hasMore !== 'boolean' ||
      !Array.isArray(result.polls)
    ) {
      throw new Error('Google Admin poll operation was not confirmed.')
    }
    return result
  }

  try {
    if (body.action === 'list') {
      return jsonResponse(await runPollAction('list'))
    }

    let result
    if (body.action === 'create') {
      const question = body.question?.trim()
      const optionLabels = body.optionLabels?.map((option) => option.trim())
      if (!question || !body.type || !optionLabels) {
        return jsonResponse(
          { ok: false, message: 'Poll question, type, and options are required.' },
          400,
        )
      }
      result = await runPollAction('create', {
        optionLabels,
        pollType: body.type,
        question,
        requestId: body.requestId,
      })
    } else if (body.action === 'open' || body.action === 'close') {
      if (!body.pollId || !UUID_PATTERN.test(body.pollId)) {
        return jsonResponse({ ok: false, message: 'pollId is required.' }, 400)
      }
      result = await runPollAction(body.action, {
        pollId: body.pollId,
        requestId: body.requestId,
      })
    } else {
      return jsonResponse({ ok: false, message: 'Unknown action.' }, 400)
    }

    if (result.refreshRequired === true) {
      try {
        return jsonResponse({
          ...result,
          ...(await runPollAction('list')),
          refreshRequired: false,
        })
      } catch {
        return jsonResponse({ ...result, refreshRequired: true })
      }
    }
    return jsonResponse(result)
  } catch (error) {
    return jsonResponse(
      {
        ok: false,
        message:
          error instanceof Error ? error.message : 'Poll operation failed.',
      },
      500,
    )
  }
})
