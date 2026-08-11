import { createClient } from 'npm:@supabase/supabase-js@2'
import {
  deriveGoogleAiChildGrantNonce,
  parseBillingGrantToken,
  sha256Hex,
} from '../_shared/aiBilling.ts'
import {
  getAdminActorId,
  getAdminTokenClaims,
  getAdminTokenSecret,
} from '../_shared/adminToken.ts'
import { handleCors } from '../_shared/cors.ts'
import {
  type GoogleAdminOperationContext,
  verifyGoogleAdminOperationRequest,
} from '../_shared/googleAdminOperations.ts'
import {
  applyMaterialQualityGates,
  buildMaterialOpenAiRequest,
  calculateCostMicrousd,
  estimateReservation,
  type MaterialAction,
  MaterialAnalysisError,
  type MaterialExtraction,
  type OpenAiMaterialResponse,
  parseMaterialOpenAiResponse,
  PHASE5_INPUT_PRICE_MICROUSD_PER_MILLION,
  PHASE5_MAX_REQUEST_BYTES,
  PHASE5_MODEL,
  PHASE5_OUTPUT_PRICE_MICROUSD_PER_MILLION,
  PHASE5_PROMPT_VERSION,
  verifyExtraction,
} from '../_shared/materialAnalysis.ts'
import {
  readJsonBody,
  RequestBodyTooLargeError,
  UnsupportedJsonContentTypeError,
} from '../_shared/requestBody.ts'
import { createJsonResponse } from '../_shared/responses.ts'

type RequestBody = {
  action?: MaterialAction
  adminToken?: string
  analysisId?: string | null
  appSessionToken?: string
  billingGrant?: string
  documentId?: string
  documentVersion?: string
  extraction?: MaterialExtraction
  grantRequestId?: string
  idempotencyKey?: string
  lectureSessionId?: string
  pageEnd?: number | null
  pageStart?: number | null
  startRequestId?: string
}

type PdfDocumentRow = {
  document_id: string
  document_version: string
  page_count: number
  text_char_count: number
  text_sha256: string
}

type OperationState = {
  found?: boolean
  operation_id?: string
  result_accepted?: boolean
  result_saved?: boolean
  results?: unknown
  status?: string
}

type StartResult = {
  accepted?: boolean
  actorId?: string
  idempotentReplay?: boolean
  operationId?: string
  operations?: Array<{
    idempotent_replay?: boolean
    operation?: { id?: string }
  }>
  reason?: string
  status?: string
}

type GoogleChildResult = {
  accepted?: boolean
  expires_at?: string
  grant_id?: string
  idempotentReplay?: boolean
  providerIntentDigest?: string
  status?: string
}

function isUuid(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    )
  )
}

function errorResponse(
  jsonResponse: ReturnType<typeof createJsonResponse>,
  error: unknown,
) {
  if (error instanceof MaterialAnalysisError) {
    return jsonResponse(
      { code: error.code, message: error.message, ok: false },
      error.status,
    )
  }
  return jsonResponse(
    {
      code: 'material_analysis_failed',
      message: 'Material analysis failed.',
      ok: false,
    },
    500,
  )
}

Deno.serve(async (request) => {
  const jsonResponse = createJsonResponse(request)
  const corsResponse = handleCors(request)
  if (corsResponse) return corsResponse
  if (request.method !== 'POST') {
    return jsonResponse({ message: 'Method not allowed.', ok: false }, 405)
  }
  const materialTransportEnabled =
    Deno.env.get('PHASE5_MATERIAL_ANALYSIS_ENABLED') === 'true'
  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const openAiKey = Deno.env.get('OPENAI_API_KEY')
  if (!supabaseUrl || !serviceRoleKey) {
    return jsonResponse(
      { message: 'Material analysis is not configured.', ok: false },
      503,
    )
  }

  let body: RequestBody
  try {
    body = await readJsonBody<RequestBody>(request, PHASE5_MAX_REQUEST_BYTES)
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) {
      return jsonResponse(
        { message: 'Request body is too large.', ok: false },
        413,
      )
    }
    if (error instanceof UnsupportedJsonContentTypeError) {
      return jsonResponse({ message: 'Request must be JSON.', ok: false }, 415)
    }
    return jsonResponse({ message: 'Invalid JSON body.', ok: false }, 400)
  }
  const hasGoogleCredential =
    typeof body.appSessionToken === 'string' &&
    body.appSessionToken.trim().length > 0
  const hasLegacyCredential =
    typeof body.adminToken === 'string' && body.adminToken.trim().length > 0
  if (hasGoogleCredential === hasLegacyCredential) {
    return jsonResponse(
      { message: 'Exactly one Admin credential is required.', ok: false },
      401,
    )
  }

  if (
    !body.lectureSessionId ||
    !body.documentId ||
    !body.documentVersion ||
    !body.extraction ||
    !body.action ||
    !['material_analysis', 'poll_suggestions'].includes(body.action)
  ) {
    return jsonResponse(
      { message: 'Material analysis request is incomplete.', ok: false },
      400,
    )
  }
  if (
    hasGoogleCredential &&
    (!isUuid(body.grantRequestId) ||
      !isUuid(body.startRequestId) ||
      body.grantRequestId.toLowerCase() === body.startRequestId.toLowerCase() ||
      body.billingGrant !== undefined ||
      body.idempotencyKey !== undefined)
  ) {
    return jsonResponse(
      {
        message: 'Google material analysis request IDs are invalid.',
        ok: false,
      },
      400,
    )
  }
  if (
    hasLegacyCredential &&
    (!body.billingGrant ||
      !body.idempotencyKey ||
      !/^[a-zA-Z0-9:_-]{8,160}$/.test(body.idempotencyKey) ||
      body.grantRequestId !== undefined ||
      body.startRequestId !== undefined)
  ) {
    return jsonResponse(
      { message: 'Legacy material analysis request is incomplete.', ok: false },
      400,
    )
  }
  if (hasLegacyCredential && !materialTransportEnabled) {
    return jsonResponse(
      { message: 'Material analysis is disabled.', ok: false },
      503,
    )
  }
  if (hasLegacyCredential && !openAiKey) {
    return jsonResponse(
      { message: 'Material analysis is not configured.', ok: false },
      503,
    )
  }
  if (
    body.action === 'poll_suggestions' &&
    (!body.analysisId ||
      !Number.isInteger(body.pageStart) ||
      !Number.isInteger(body.pageEnd))
  ) {
    return jsonResponse(
      {
        message:
          'Additional Poll proposals require an analysis and page range.',
        ok: false,
      },
      400,
    )
  }

  let actorId: string | null = null
  let googleContext: GoogleAdminOperationContext | null = null
  let googleRpcIdentity: {
    target_auth_user_id: string
    target_google_issuer: string
    target_provider_subject_hmac: string
    target_subject_pepper_version: number
    target_supabase_auth_session_id: string
    target_token_hash: string
  } | null = null
  let supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  })
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
    googleContext = verification
    supabase = verification.serviceClient
  } else {
    try {
      const claims = await getAdminTokenClaims(
        body.adminToken!,
        getAdminTokenSecret(),
        request,
      )
      if (!claims) {
        return jsonResponse(
          { message: 'Invalid Admin session.', ok: false },
          401,
        )
      }
      actorId = getAdminActorId(claims)
    } catch {
      return jsonResponse({ message: 'Admin auth failed.', ok: false }, 500)
    }
  }

  let operationId: string | null = null
  let actualInputTokens = 0
  let actualOutputTokens = 0
  let providerRequestId: string | null = null
  let reservedInputTokens = 0
  let reservedOutputTokens = 0
  let ownsNewOperation = false

  async function finishFailure(code: string) {
    if (!ownsNewOperation || !operationId) return
    const definitelyUncharged =
      /^provider_http_(?:400|401|403|404|409|422|429)$/.test(code)
    const conservativeUnknownUsage =
      providerRequestId !== null &&
      actualInputTokens === 0 &&
      actualOutputTokens === 0 &&
      !definitelyUncharged
    const accountedInputTokens = conservativeUnknownUsage
      ? reservedInputTokens
      : actualInputTokens
    const accountedOutputTokens = conservativeUnknownUsage
      ? reservedOutputTokens
      : actualOutputTokens
    const actualMicrousd = calculateCostMicrousd(
      accountedInputTokens,
      accountedOutputTokens,
    )
    if (googleRpcIdentity && body.startRequestId) {
      await supabase.rpc('fail_google_admin_material_ai_operation_v1', {
        ...googleRpcIdentity,
        actual_input_tokens: accountedInputTokens,
        actual_microusd: actualMicrousd,
        actual_output_tokens: accountedOutputTokens,
        error_code: code.slice(0, 120),
        provider_request_id: providerRequestId,
        target_operation_id: operationId,
        target_start_request_id: body.startRequestId,
        target_status: 'failed',
      })
      return
    }
    if (!actorId) return
    await supabase.rpc('admin_fail_material_ai_operation', {
      actual_input_tokens: accountedInputTokens,
      actual_microusd: actualMicrousd,
      actual_output_tokens: accountedOutputTokens,
      error_code: code.slice(0, 120),
      provider_request_id: providerRequestId,
      target_actor_id: actorId,
      target_operation_id: operationId,
      target_status: 'failed',
    })
  }

  async function readOperationState(idempotencyKey: string, actor: string) {
    const { data, error } = await supabase.rpc(
      'admin_get_material_ai_operation_state',
      {
        target_actor_id: actor,
        target_feature: body.action,
        target_idempotency_key: idempotencyKey,
        target_lecture_session_id: body.lectureSessionId,
      },
    )
    if (error) throw error
    return data as OperationState | null
  }

  try {
    if (actorId) {
      const state = await readOperationState(body.idempotencyKey!, actorId)
      if (!state?.found) {
        // The legacy start below is the first attempt for this key.
      } else if (state.status === 'succeeded' && state.result_saved) {
        return jsonResponse({
          idempotentReplay: true,
          ok: true,
          results: state.results,
        })
      } else {
        return jsonResponse(
          {
            code:
              state.status === 'running'
                ? 'operation_in_progress'
                : 'operation_not_retryable',
            message:
              state.status === 'running'
                ? 'This material analysis is already running.'
                : 'A new API usage authorization is required before retrying.',
            ok: false,
          },
          409,
        )
      }
    }

    const { data: documentData, error: documentError } = await supabase
      .from('lecture_pdf_documents')
      .select(
        'document_id,document_version,page_count,text_char_count,text_sha256',
      )
      .eq('lecture_session_id', body.lectureSessionId)
      .eq('document_id', body.documentId)
      .eq('document_version', body.documentVersion)
      .eq('visible', true)
      .maybeSingle()
    if (documentError || !documentData) {
      throw new MaterialAnalysisError(
        'document_not_available',
        'Published PDF metadata was not found for this lecture.',
        409,
      )
    }
    const document = documentData as PdfDocumentRow
    await verifyExtraction(body.extraction, {
      documentId: document.document_id,
      documentVersion: document.document_version,
      pageCount: document.page_count,
      textCharCount: document.text_char_count,
      textSha256: document.text_sha256,
    })

    const selectedCharacterCount = body.extraction.pages
      .filter(
        (page) =>
          body.action === 'material_analysis' ||
          (page.pageNumber >= (body.pageStart ?? 1) &&
            page.pageNumber <= (body.pageEnd ?? body.extraction.pageCount)),
      )
      .reduce((sum, page) => sum + page.characterCount, 0)
    const reservation = estimateReservation(selectedCharacterCount, body.action)
    reservedInputTokens = reservation.estimatedInputTokens
    reservedOutputTokens = reservation.estimatedOutputTokens

    let started: StartResult
    if (googleContext) {
      let nonce: string
      let keyVersion: number
      try {
        const derived = await deriveGoogleAiChildGrantNonce({
          feature: body.action,
          lectureSessionId: body.lectureSessionId,
          requestId: body.grantRequestId!,
        })
        nonce = derived.nonce
        keyVersion = derived.keyVersion
      } catch {
        throw new MaterialAnalysisError(
          'google_ai_child_not_configured',
          'Google Admin AI authorization is not configured.',
          503,
        )
      }
      const nonceHash = await sha256Hex(nonce)
      googleRpcIdentity = {
        target_auth_user_id: googleContext.authUserId,
        target_google_issuer: googleContext.googleIssuer,
        target_provider_subject_hmac: googleContext.googleSubjectHmac,
        target_subject_pepper_version: googleContext.subjectPepperVersion,
        target_supabase_auth_session_id: googleContext.supabaseAuthSessionId,
        target_token_hash: googleContext.appSessionTokenHash,
      }
      const { data: childData, error: childError } = await supabase.rpc(
        'issue_google_material_ai_child_grant_v1',
        {
          ...googleRpcIdentity,
          target_analysis_id:
            body.action === 'poll_suggestions' ? body.analysisId : null,
          target_document_id: body.documentId,
          target_document_version: body.documentVersion,
          target_estimated_input_tokens: reservation.estimatedInputTokens,
          target_estimated_microusd: reservation.estimatedMicrousd,
          target_estimated_output_tokens: reservation.estimatedOutputTokens,
          target_feature: body.action,
          target_input_price_microusd_per_million:
            PHASE5_INPUT_PRICE_MICROUSD_PER_MILLION,
          target_lecture_session_id: body.lectureSessionId,
          target_max_output_tokens: reservation.maxOutputTokens,
          target_model_id: PHASE5_MODEL,
          target_nonce_hash: nonceHash,
          target_nonce_key_version: keyVersion,
          target_output_price_microusd_per_million:
            PHASE5_OUTPUT_PRICE_MICROUSD_PER_MILLION,
          target_page_end:
            body.action === 'poll_suggestions' ? body.pageEnd : null,
          target_page_start:
            body.action === 'poll_suggestions' ? body.pageStart : null,
          target_prompt_version: PHASE5_PROMPT_VERSION,
          target_request_id: body.grantRequestId,
          target_text_sha256: body.extraction.textSha256,
          target_transport_enabled:
            googleContext.transportEnabled &&
            materialTransportEnabled &&
            Boolean(openAiKey),
        },
      )
      if (childError) {
        throw new MaterialAnalysisError(
          childError.code === 'P7338'
            ? 'google_ai_admission_disabled'
            : 'google_ai_child_rejected',
          childError.code === 'P7338'
            ? 'AI use is not enabled for this Admin environment.'
            : 'AI authorization is no longer available for this lecture.',
          childError.code === 'P7338' ? 503 : 409,
        )
      }
      const child = childData as GoogleChildResult
      if (
        !child.accepted ||
        !child.grant_id ||
        !child.providerIntentDigest ||
        !/^[0-9a-f]{64}$/.test(child.providerIntentDigest)
      ) {
        throw new MaterialAnalysisError(
          'google_ai_child_rejected',
          'AI authorization is no longer available for this lecture.',
          409,
        )
      }

      const { data: startedData, error: startError } = await supabase.rpc(
        'start_google_admin_material_ai_operation_v1',
        {
          ...googleRpcIdentity,
          target_analysis_id:
            body.action === 'poll_suggestions' ? body.analysisId : null,
          target_document_id: body.documentId,
          target_document_version: body.documentVersion,
          target_estimated_input_tokens: reservation.estimatedInputTokens,
          target_estimated_microusd: reservation.estimatedMicrousd,
          target_estimated_output_tokens: reservation.estimatedOutputTokens,
          target_feature: body.action,
          target_grant_id: child.grant_id,
          target_input_price_microusd_per_million:
            PHASE5_INPUT_PRICE_MICROUSD_PER_MILLION,
          target_lecture_session_id: body.lectureSessionId,
          target_max_output_tokens: reservation.maxOutputTokens,
          target_model_id: PHASE5_MODEL,
          target_nonce_hash: nonceHash,
          target_output_price_microusd_per_million:
            PHASE5_OUTPUT_PRICE_MICROUSD_PER_MILLION,
          target_page_end:
            body.action === 'poll_suggestions' ? body.pageEnd : null,
          target_page_start:
            body.action === 'poll_suggestions' ? body.pageStart : null,
          target_prompt_version: PHASE5_PROMPT_VERSION,
          target_provider_intent_digest: child.providerIntentDigest,
          target_start_request_id: body.startRequestId,
          target_text_sha256: body.extraction.textSha256,
          target_transport_enabled:
            googleContext.transportEnabled &&
            materialTransportEnabled &&
            Boolean(openAiKey),
        },
      )
      if (startError) {
        throw new MaterialAnalysisError(
          startError.code === 'P7338'
            ? 'google_ai_admission_disabled'
            : 'operation_rejected',
          startError.code === 'P7338'
            ? 'AI use is not enabled for this Admin environment.'
            : 'The material analysis operation could not be started.',
          startError.code === 'P7338' ? 503 : 409,
        )
      }
      started = startedData as StartResult
      actorId = started.actorId ?? null
      operationId = started.operationId ?? null
      if (
        !started.accepted ||
        !actorId ||
        !operationId ||
        typeof started.idempotentReplay !== 'boolean'
      ) {
        throw new MaterialAnalysisError(
          started.reason ?? 'operation_rejected',
          'The material analysis operation was rejected by its usage limits.',
          409,
        )
      }
      if (started.idempotentReplay) {
        const state = await readOperationState(body.startRequestId!, actorId)
        if (state?.status === 'succeeded' && state.result_saved) {
          return jsonResponse({
            idempotentReplay: true,
            ok: true,
            results: state.results,
          })
        }
        return jsonResponse(
          {
            code:
              state?.status === 'running'
                ? 'operation_in_progress'
                : 'operation_not_retryable',
            message:
              state?.status === 'running'
                ? 'This material analysis is already running.'
                : 'Start a new material analysis attempt.',
            ok: false,
          },
          409,
        )
      }
      ownsNewOperation = true
    } else {
      const { grantId, nonce } = parseBillingGrantToken(body.billingGrant!)
      const { data: startedData, error: startError } = await supabase.rpc(
        'admin_start_material_ai_operation',
        {
          estimated_input_tokens: reservation.estimatedInputTokens,
          estimated_microusd: reservation.estimatedMicrousd,
          estimated_output_tokens: reservation.estimatedOutputTokens,
          target_actor_id: actorId,
          target_analysis_id:
            body.action === 'poll_suggestions' ? body.analysisId : null,
          target_document_id: body.documentId,
          target_document_version: body.documentVersion,
          target_feature: body.action,
          target_grant_id: grantId,
          target_idempotency_key: body.idempotencyKey,
          target_input_price_microusd_per_million:
            PHASE5_INPUT_PRICE_MICROUSD_PER_MILLION,
          target_lecture_session_id: body.lectureSessionId,
          target_max_output_tokens: reservation.maxOutputTokens,
          target_model_id: PHASE5_MODEL,
          target_nonce_hash: await sha256Hex(nonce),
          target_output_price_microusd_per_million:
            PHASE5_OUTPUT_PRICE_MICROUSD_PER_MILLION,
          target_page_end:
            body.action === 'poll_suggestions' ? body.pageEnd : null,
          target_page_start:
            body.action === 'poll_suggestions' ? body.pageStart : null,
          target_prompt_version: PHASE5_PROMPT_VERSION,
          target_text_sha256: body.extraction.textSha256,
        },
      )
      if (startError) {
        const knownReason = [
          'material_analysis_call_limit',
          'poll_generation_limit',
          'budget_limit',
          'input_token_limit',
          'output_token_limit',
          'concurrency_limit',
          'feature_disabled',
          'ai_control_not_ready',
        ].find((reason) => startError.message.includes(reason))
        throw new MaterialAnalysisError(
          knownReason ?? 'operation_rejected',
          knownReason === 'material_analysis_call_limit'
            ? 'The material analysis retry limit has been reached.'
            : knownReason === 'concurrency_limit'
              ? 'Another batch AI operation is still running.'
              : 'The billed material analysis operation could not be started.',
          409,
        )
      }
      started = startedData as StartResult
      operationId = started.operations?.[0]?.operation?.id ?? null
      const legacyReplay = started.operations?.[0]?.idempotent_replay
      if (
        !started.accepted ||
        !operationId ||
        !actorId ||
        typeof legacyReplay !== 'boolean'
      ) {
        throw new MaterialAnalysisError(
          started.reason ?? 'operation_rejected',
          'The material analysis operation was rejected by its usage limits.',
          409,
        )
      }
      if (legacyReplay) {
        const state = await readOperationState(body.idempotencyKey!, actorId)
        if (state?.status === 'succeeded' && state.result_saved) {
          return jsonResponse({
            idempotentReplay: true,
            ok: true,
            results: state.results,
          })
        }
        return jsonResponse(
          {
            code:
              state?.status === 'running'
                ? 'operation_in_progress'
                : 'operation_not_retryable',
            message:
              state?.status === 'running'
                ? 'This material analysis is already running.'
                : 'A new API usage authorization is required before retrying.',
            ok: false,
          },
          409,
        )
      }
      ownsNewOperation = true
    }

    const { data: currentResults, error: resultError } = await supabase.rpc(
      'admin_list_material_ai_results',
      { target_lecture_session_id: body.lectureSessionId },
    )
    if (resultError) throw resultError
    const { data: pollRows, error: pollError } = await supabase
      .from('polls')
      .select('question')
      .eq('lecture_session_id', body.lectureSessionId)
      .limit(100)
    if (pollError) throw pollError
    const previousProposals = Array.isArray(
      (currentResults as { proposals?: unknown[] } | null)?.proposals,
    )
      ? (currentResults as { proposals: Array<{ stem?: string }> }).proposals
          .map((proposal) => proposal.stem)
          .filter((stem): stem is string => typeof stem === 'string')
      : []
    const existingQuestions = [
      ...(pollRows ?? []).map((poll) => String(poll.question)),
      ...previousProposals,
    ]

    if (!actorId) {
      throw new MaterialAnalysisError(
        'operation_rejected',
        'The material analysis operation has no Admin authority.',
        409,
      )
    }

    // Provider dispatch is reached only after one child is consumed. A replay
    // of a running operation returns above and never calls the provider twice.
    if (!openAiKey) {
      throw new MaterialAnalysisError(
        'google_ai_provider_not_configured',
        'Material analysis is not configured.',
        503,
      )
    }
    const safetyIdentifier = `compass_${(
      await sha256Hex(`phase5:${body.lectureSessionId}:${actorId}`)
    ).slice(0, 48)}`
    providerRequestId = crypto.randomUUID()
    const providerResponse = await fetch(
      'https://api.openai.com/v1/responses',
      {
        body: JSON.stringify(
          buildMaterialOpenAiRequest({
            action: body.action,
            existingQuestions,
            extraction: body.extraction,
            pageEnd: body.pageEnd,
            pageStart: body.pageStart,
            safetyIdentifier,
          }),
        ),
        headers: {
          Authorization: `Bearer ${openAiKey}`,
          'Content-Type': 'application/json',
          'X-Client-Request-Id': providerRequestId,
        },
        method: 'POST',
        signal: AbortSignal.timeout(55_000),
      },
    )
    if (!providerResponse.ok) {
      throw new MaterialAnalysisError(
        `provider_http_${providerResponse.status}`,
        providerResponse.status === 429
          ? 'The model rate limit was reached. A new explicit retry is required.'
          : 'The model request failed. A new explicit retry is required.',
        providerResponse.status === 429 ? 429 : 502,
      )
    }
    const providerPayload =
      (await providerResponse.json()) as OpenAiMaterialResponse
    const parsed = parseMaterialOpenAiResponse(providerPayload)
    actualInputTokens = parsed.inputTokens
    actualOutputTokens = parsed.outputTokens
    providerRequestId = parsed.providerRequestId ?? providerRequestId
    const gatedResult = applyMaterialQualityGates({
      action: body.action,
      existingQuestions,
      extraction: body.extraction,
      pageEnd: body.pageEnd,
      pageStart: body.pageStart,
      result: parsed.result,
    })

    const completionRpc = googleRpcIdentity
      ? 'complete_google_admin_material_ai_operation_v1'
      : 'admin_complete_material_ai_operation'
    const completionArgs = googleRpcIdentity
      ? {
          ...googleRpcIdentity,
          actual_input_tokens: actualInputTokens,
          actual_microusd: calculateCostMicrousd(
            actualInputTokens,
            actualOutputTokens,
          ),
          actual_output_tokens: actualOutputTokens,
          provider_request_id: providerRequestId,
          target_operation_id: operationId,
          target_result: gatedResult,
          target_start_request_id: body.startRequestId!,
        }
      : {
          actual_input_tokens: actualInputTokens,
          actual_microusd: calculateCostMicrousd(
            actualInputTokens,
            actualOutputTokens,
          ),
          actual_output_tokens: actualOutputTokens,
          provider_request_id: providerRequestId,
          target_actor_id: actorId,
          target_operation_id: operationId,
          target_result: gatedResult,
        }
    const { data: completionData, error: completionError } = await supabase.rpc(
      completionRpc,
      completionArgs,
    )
    if (completionError) throw completionError
    const completion = completionData as {
      accepted?: boolean
      authorityRevoked?: boolean
      result_saved?: boolean
      results?: unknown
    }
    if (!completion.accepted || !completion.result_saved) {
      throw new MaterialAnalysisError(
        completion.authorityRevoked
          ? 'admin_authority_changed'
          : 'late_result_discarded',
        completion.authorityRevoked
          ? 'Your Admin session changed while the analysis was running. The result was safely discarded. Please sign in again and retry.'
          : 'The lecture ended before the model result was accepted.',
        409,
      )
    }
    return jsonResponse({
      actualInputTokens,
      actualMicrousd: calculateCostMicrousd(
        actualInputTokens,
        actualOutputTokens,
      ),
      actualOutputTokens,
      model: PHASE5_MODEL,
      ok: true,
      operationId,
      results: completion.results,
    })
  } catch (error) {
    const code =
      error instanceof MaterialAnalysisError
        ? error.code
        : error instanceof DOMException && error.name === 'TimeoutError'
          ? 'provider_timeout_ambiguous'
          : 'material_analysis_failed'
    await finishFailure(code).catch(() => undefined)
    return errorResponse(jsonResponse, error)
  }
})
