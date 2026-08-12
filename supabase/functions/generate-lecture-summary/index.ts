import { createClient } from 'npm:@supabase/supabase-js@2'
import {
  deriveGoogleAiChildGrantNonce,
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
  applySummaryQualityGates,
  buildSummaryOpenAiRequest,
  calculateSummaryCostMicrousd,
  estimateSummaryReservation,
  getSummaryFailureAccounting,
  LectureSummaryError,
  normalizePdfContext,
  normalizeTranscriptSegments,
  type OpenAiSummaryResponse,
  parseSummaryOpenAiResponse,
  parseSummaryRunToken,
  PHASE6_INPUT_PRICE_MICROUSD_PER_MILLION,
  PHASE6_MAX_REQUEST_BYTES,
  PHASE6_MIN_SOURCE_CHARACTERS,
  PHASE6_MODEL,
  PHASE6_OUTPUT_PRICE_MICROUSD_PER_MILLION,
  PHASE6_PROMPT_VERSION,
  PHASE71_PROMPT_VERSION,
  resolveSummaryLanguage,
  type SummaryLanguagePreference,
  type SummaryLanguageResolution,
  type SummaryPdfContext,
  type SummaryTranscriptSegment,
} from '../_shared/lectureSummaries.ts'
import {
  readJsonBody,
  RequestBodyTooLargeError,
  UnsupportedJsonContentTypeError,
} from '../_shared/requestBody.ts'
import { createJsonResponse } from '../_shared/responses.ts'

type RequestBody = {
  adminToken?: string
  appSessionToken?: string
  grantRequestId?: string
  lectureSessionId?: string
  pdfContext?: SummaryPdfContext | null
  preflightRequestId?: string
  runToken?: string
  startRequestId?: string
  transcriptSegments?: SummaryTranscriptSegment[]
  windowIndex?: number
}

type StartResult = {
  accepted?: boolean
  comment_context?: unknown
  material_context?: unknown
  operation?: { id?: string }
  previous_summary?: unknown
  reason?: string
  results?: unknown
  window?: {
    attempt_count?: number
    id?: string
    requested_language?: string
    window_end?: string
    window_start?: string
  }
}

type GooglePreflightResult = {
  accepted?: boolean
  commentContext?: unknown
  expectedAttempt?: number
  idempotentReplay?: boolean
  materialContext?: unknown
  preflightContextDigest?: string
  previousSummary?: unknown
  reason?: string
  refreshRequired?: boolean
  resultStatus?: 'final' | 'prepared' | 'skipped'
  skipped?: boolean
  window?: {
    id?: string
    requested_language?: string
    status?: string
    window_end?: string
    window_start?: string
  }
  windowId?: string
  windowStatus?: string
}

type GoogleChildResult = {
  accepted?: boolean
  grant_id?: string
  providerIntentDigest?: string
}

type GoogleStartResult = {
  accepted?: boolean
  actorId?: string
  idempotentReplay?: boolean
  operationId?: string
  reason?: string
  status?: string
  windowId?: string
}

type GoogleDispatchClaimResult = {
  accepted?: boolean
  clientRequestId?: string
  dispatchAllowed?: boolean
  leaseExpiresAt?: string
  operationId?: string
  staleRecovered?: boolean
}

function isUuid(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    )
  )
}

function responseForError(
  jsonResponse: ReturnType<typeof createJsonResponse>,
  error: unknown,
) {
  if (error instanceof LectureSummaryError) {
    return jsonResponse(
      { code: error.code, message: error.message, ok: false },
      error.status,
    )
  }
  return jsonResponse(
    {
      code: 'summary_failed',
      message: 'Lecture summary generation failed.',
      ok: false,
    },
    502,
  )
}

Deno.serve(async (request) => {
  const jsonResponse = createJsonResponse(request)
  const corsResponse = handleCors(request)
  if (corsResponse) return corsResponse
  if (request.method !== 'POST') {
    return jsonResponse({ message: 'Method not allowed.', ok: false }, 405)
  }
  if (Deno.env.get('PHASE6_SUMMARIES_ENABLED') !== 'true') {
    return jsonResponse(
      { message: 'Five-minute summaries are disabled.', ok: false },
      503,
    )
  }

  let body: RequestBody
  try {
    body = await readJsonBody<RequestBody>(request, PHASE6_MAX_REQUEST_BYTES)
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
    !body.runToken ||
    !Number.isInteger(body.windowIndex) ||
    (body.windowIndex ?? 0) < 1 ||
    (body.windowIndex ?? 0) > 18
  ) {
    return jsonResponse(
      {
        message: 'Admin session, run and valid window are required.',
        ok: false,
      },
      400,
    )
  }
  if (
    hasGoogleCredential &&
    (!isUuid(body.preflightRequestId) ||
      !isUuid(body.grantRequestId) ||
      !isUuid(body.startRequestId) ||
      new Set([
        body.preflightRequestId.toLowerCase(),
        body.grantRequestId.toLowerCase(),
        body.startRequestId.toLowerCase(),
      ]).size !== 3)
  ) {
    return jsonResponse(
      {
        message: 'Google summary request IDs are invalid.',
        ok: false,
      },
      400,
    )
  }
  if (
    hasLegacyCredential &&
    (body.preflightRequestId !== undefined ||
      body.grantRequestId !== undefined ||
      body.startRequestId !== undefined)
  ) {
    return jsonResponse(
      { message: 'Legacy summary request is invalid.', ok: false },
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

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const openAiKey = Deno.env.get('OPENAI_API_KEY')
  if (!supabaseUrl || !serviceRoleKey || !openAiKey) {
    return jsonResponse(
      { message: 'Lecture summaries are not configured.', ok: false },
      503,
    )
  }
  let supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  })
  if (googleContext) {
    supabase = googleContext.serviceClient
    googleRpcIdentity = {
      target_auth_user_id: googleContext.authUserId,
      target_google_issuer: googleContext.googleIssuer,
      target_provider_subject_hmac: googleContext.googleSubjectHmac,
      target_subject_pepper_version: googleContext.subjectPepperVersion,
      target_supabase_auth_session_id: googleContext.supabaseAuthSessionId,
      target_token_hash: googleContext.appSessionTokenHash,
    }
  }

  let operationId: string | null = null
  let actualInputTokens = 0
  let actualMicrousd = 0
  let actualOutputTokens = 0
  let googleProvider: OpenAiSummaryResponse | null = null
  let googleReservation: ReturnType<typeof estimateSummaryReservation> | null =
    null
  let providerRequestId: string | null = null
  let providerWasDispatched = false
  let ownsNewOperation = false

  async function finishGoogleFailure(code: string) {
    if (
      !googleRpcIdentity ||
      !body.startRequestId ||
      !ownsNewOperation ||
      !operationId ||
      !googleReservation
    ) {
      return
    }
    const accounting = providerWasDispatched
      ? getSummaryFailureAccounting({
          errorCode: code,
          provider: googleProvider,
          reservation: googleReservation,
        })
      : {
          actualInputTokens: 0,
          actualMicrousd: 0,
          actualOutputTokens: 0,
          conservativeUnknownUsage: false,
        }
    const effectiveCode =
      accounting.conservativeUnknownUsage && !code.includes('ambiguous')
        ? `${code}_ambiguous`
        : code
    const { error } = await supabase.rpc(
      'fail_google_admin_summary_window_operation_v1',
      {
        ...googleRpcIdentity,
        actual_input_tokens: accounting.actualInputTokens,
        actual_microusd: accounting.actualMicrousd,
        actual_output_tokens: accounting.actualOutputTokens,
        error_code: effectiveCode.slice(0, 120),
        provider_request_id: providerRequestId,
        target_operation_id: operationId,
        target_start_request_id: body.startRequestId,
        target_status: 'failed',
      },
    )
    if (error) throw error
  }

  try {
    const phase71Enabled =
      Deno.env.get('PHASE7_1_CLASSROOM_EXTENSIONS_ENABLED') === 'true'
    const promptVersion = phase71Enabled
      ? PHASE71_PROMPT_VERSION
      : PHASE6_PROMPT_VERSION
    const run = parseSummaryRunToken(body.runToken)
    const runTokenHash = await sha256Hex(run.nonce)
    const transcript = await normalizeTranscriptSegments(
      body.lectureSessionId,
      body.transcriptSegments ?? [],
    )
    const pdf = await normalizePdfContext(body.pdfContext)

    async function resolveAndRecordWindowLanguage(window: {
      id?: string
      requested_language?: string
    }): Promise<SummaryLanguageResolution> {
      if (!window.id || !actorId) {
        throw new LectureSummaryError(
          'summary_language_window_missing',
          'Summary language could not be bound to the window.',
          409,
        )
      }
      const preference = ['auto', 'ja', 'en'].includes(
        window.requested_language ?? '',
      )
        ? (window.requested_language as SummaryLanguagePreference)
        : 'auto'
      const resolution = resolveSummaryLanguage({
        pdfContext: pdf.context,
        preference,
        transcript: transcript.segments,
      })
      const { data, error } = await supabase.rpc(
        'admin_record_summary_window_language',
        {
          target_actor_id: actorId,
          target_language_reason: resolution.reason,
          target_resolved_language: resolution.language,
          target_run_id: run.runId,
          target_window_id: window.id,
        },
      )
      if (error || (data as { accepted?: boolean } | null)?.accepted !== true) {
        throw new LectureSummaryError(
          'summary_language_record_failed',
          'Summary language could not be recorded.',
          409,
        )
      }
      return resolution
    }

    if (!googleContext && pdf.context) {
      const [
        { data: document, error: documentError },
        { data: live, error: liveError },
      ] = await Promise.all([
        supabase
          .from('lecture_pdf_documents')
          .select('document_id,document_version,page_count,visible')
          .eq('lecture_session_id', body.lectureSessionId)
          .eq('document_id', pdf.context.documentId)
          .eq('document_version', pdf.context.documentVersion)
          .maybeSingle(),
        supabase
          .from('lecture_live_state')
          .select('pdf_document_id,pdf_document_version,pdf_page_count')
          .eq('lecture_session_id', body.lectureSessionId)
          .maybeSingle(),
      ])
      if (documentError || liveError) throw documentError ?? liveError
      if (
        !document ||
        !document.visible ||
        live?.pdf_document_id !== pdf.context.documentId ||
        live?.pdf_document_version !== pdf.context.documentVersion ||
        pdf.context.pages.some(
          (page) => page.pageNumber > Number(document.page_count),
        )
      ) {
        throw new LectureSummaryError(
          'pdf_context_mismatch',
          'PDF context is not the current published document.',
          409,
        )
      }
    }

    const sourceHashes = {
      pdf_character_count: pdf.characters,
      pdf_context_sha256: pdf.context
        ? await sha256Hex(JSON.stringify(pdf.context.pages))
        : null,
      pdf_max_page_number: pdf.context
        ? Math.max(...pdf.context.pages.map((page) => page.pageNumber), 0)
        : 0,
      pdf_page_count: pdf.context?.pages.length ?? 0,
      transcript_character_count: transcript.characters,
      transcript_segment_count: transcript.segments.length,
      transcript_sha256: transcript.segments.length
        ? await sha256Hex(JSON.stringify(transcript.segments))
        : null,
    }
    const sourceCoverage = {
      comments: true,
      pdf: pdf.characters > 0,
      transcript: transcript.characters > 0,
    }

    if (googleContext && googleRpcIdentity) {
      const transportEnabled =
        googleContext.transportEnabled &&
        Deno.env.get('PHASE6_SUMMARIES_ENABLED') === 'true' &&
        Boolean(openAiKey)
      const { error: reapError } = await supabase.rpc(
        'reap_stale_google_ai_provider_dispatches_v1',
        { job_limit: 10 },
      )
      if (reapError) {
        throw new LectureSummaryError(
          'provider_dispatch_cleanup_failed',
          'Previous model activity could not be reconciled safely.',
          503,
        )
      }

      const { data: preflightData, error: preflightError } = await supabase.rpc(
        'prepare_google_admin_summary_window_v1',
        {
          ...googleRpcIdentity,
          target_document_id: pdf.context?.documentId ?? null,
          target_document_version: pdf.context?.documentVersion ?? null,
          target_lecture_session_id: body.lectureSessionId,
          target_prompt_version: promptVersion,
          target_request_id: body.preflightRequestId,
          target_run_id: run.runId,
          target_run_token_hash: runTokenHash,
          target_source_coverage: sourceCoverage,
          target_source_hashes: sourceHashes,
          target_transport_enabled: transportEnabled,
          target_window_index: body.windowIndex,
        },
      )
      if (preflightError) {
        throw new LectureSummaryError(
          preflightError.code === 'P7338'
            ? 'google_ai_admission_disabled'
            : 'summary_preflight_rejected',
          preflightError.code === 'P7338'
            ? 'AI use is not enabled for this Admin environment.'
            : 'The summary window could not be prepared safely.',
          preflightError.code === 'P7338' ? 503 : 409,
        )
      }
      const preflight = preflightData as GooglePreflightResult | null
      if (!preflight?.accepted) {
        throw new LectureSummaryError(
          preflight?.reason ?? 'summary_preflight_rejected',
          preflight?.reason === 'window_not_due'
            ? 'This summary window is not due yet.'
            : 'The summary window could not be prepared.',
          409,
        )
      }
      if (preflight.resultStatus === 'skipped') {
        return jsonResponse({
          idempotentReplay: Boolean(preflight.idempotentReplay),
          ok: true,
          refreshRequired: true,
          results: null,
          skipped: true,
        })
      }
      if (preflight.resultStatus === 'final') {
        return jsonResponse({
          idempotentReplay: true,
          ok: true,
          refreshRequired: true,
          results: null,
          skipped: preflight.windowStatus === 'skipped',
        })
      }
      if (preflight.refreshRequired) {
        throw new LectureSummaryError(
          'summary_preflight_refresh_required',
          'Lecture context changed before the model request. Refresh and start a new summary attempt.',
          409,
        )
      }
      if (
        preflight.resultStatus !== 'prepared' ||
        !preflight.window?.id ||
        !Number.isInteger(preflight.expectedAttempt) ||
        !preflight.preflightContextDigest ||
        !/^[0-9a-f]{64}$/.test(preflight.preflightContextDigest)
      ) {
        throw new LectureSummaryError(
          'summary_preflight_incomplete',
          'The summary window preflight was incomplete.',
          409,
        )
      }

      const preference = ['auto', 'ja', 'en'].includes(
        preflight.window.requested_language ?? '',
      )
        ? (preflight.window.requested_language as SummaryLanguagePreference)
        : 'auto'
      const languageResolution = resolveSummaryLanguage({
        pdfContext: pdf.context,
        preference,
        transcript: transcript.segments,
      })
      const reservation = estimateSummaryReservation(
        transcript.characters + pdf.characters + 8_000,
      )
      googleReservation = reservation
      const safetyIdentifier = await sha256Hex(
        `phase6:${googleContext.authUserId}:${body.lectureSessionId}`,
      )
      const providerRequestBody = buildSummaryOpenAiRequest({
        commentContext: preflight.commentContext,
        materialContext: preflight.materialContext,
        pdfContext: pdf.context,
        previousSummary: preflight.previousSummary,
        resolvedLanguage: languageResolution.language,
        safetyIdentifier,
        transcript: transcript.segments,
        windowEnd: preflight.window.window_end ?? '',
        windowStart: preflight.window.window_start ?? '',
      })
      const serializedProviderBody = JSON.stringify(providerRequestBody)
      const providerPayloadSha256 = await sha256Hex(serializedProviderBody)
      let nonce: string
      let nonceKeyVersion: number
      try {
        const derived = await deriveGoogleAiChildGrantNonce({
          feature: 'summaries',
          lectureSessionId: body.lectureSessionId,
          requestId: body.grantRequestId!,
        })
        nonce = derived.nonce
        nonceKeyVersion = derived.keyVersion
      } catch {
        throw new LectureSummaryError(
          'google_ai_child_not_configured',
          'Google Admin AI authorization is not configured.',
          503,
        )
      }
      const nonceHash = await sha256Hex(nonce)
      const childArgs = {
        ...googleRpcIdentity,
        target_estimated_input_tokens: reservation.estimatedInputTokens,
        target_estimated_microusd: reservation.estimatedMicrousd,
        target_estimated_output_tokens: reservation.estimatedOutputTokens,
        target_expected_attempt: preflight.expectedAttempt,
        target_input_price_microusd_per_million:
          PHASE6_INPUT_PRICE_MICROUSD_PER_MILLION,
        target_language_reason: languageResolution.reason,
        target_lecture_session_id: body.lectureSessionId,
        target_max_output_tokens: reservation.maxOutputTokens,
        target_model_id: PHASE6_MODEL,
        target_nonce_hash: nonceHash,
        target_nonce_key_version: nonceKeyVersion,
        target_output_price_microusd_per_million:
          PHASE6_OUTPUT_PRICE_MICROUSD_PER_MILLION,
        target_preflight_context_digest: preflight.preflightContextDigest,
        target_preflight_request_id: body.preflightRequestId,
        target_prompt_version: promptVersion,
        target_provider_payload_sha256: providerPayloadSha256,
        target_request_id: body.grantRequestId,
        target_resolved_language: languageResolution.language,
        target_run_id: run.runId,
        target_transport_enabled: transportEnabled,
        target_window_id: preflight.window.id,
      }
      const { data: childData, error: childError } = await supabase.rpc(
        'issue_google_summary_ai_child_grant_v1',
        childArgs,
      )
      if (childError) {
        throw new LectureSummaryError(
          childError.code === 'P7338'
            ? 'google_ai_admission_disabled'
            : 'google_ai_child_rejected',
          childError.code === 'P7338'
            ? 'AI use is not enabled for this Admin environment.'
            : 'AI authorization is no longer available for this lecture.',
          childError.code === 'P7338' ? 503 : 409,
        )
      }
      const child = childData as GoogleChildResult | null
      if (
        !child?.accepted ||
        !isUuid(child.grant_id) ||
        !child.providerIntentDigest ||
        !/^[0-9a-f]{64}$/.test(child.providerIntentDigest)
      ) {
        throw new LectureSummaryError(
          'google_ai_child_rejected',
          'AI authorization is no longer available for this lecture.',
          409,
        )
      }

      const { data: startData, error: startError } = await supabase.rpc(
        'start_google_admin_summary_window_operation_v1',
        {
          ...googleRpcIdentity,
          target_estimated_input_tokens: reservation.estimatedInputTokens,
          target_estimated_microusd: reservation.estimatedMicrousd,
          target_estimated_output_tokens: reservation.estimatedOutputTokens,
          target_expected_attempt: preflight.expectedAttempt,
          target_grant_id: child.grant_id,
          target_input_price_microusd_per_million:
            PHASE6_INPUT_PRICE_MICROUSD_PER_MILLION,
          target_language_reason: languageResolution.reason,
          target_lecture_session_id: body.lectureSessionId,
          target_max_output_tokens: reservation.maxOutputTokens,
          target_model_id: PHASE6_MODEL,
          target_nonce_hash: nonceHash,
          target_output_price_microusd_per_million:
            PHASE6_OUTPUT_PRICE_MICROUSD_PER_MILLION,
          target_preflight_context_digest: preflight.preflightContextDigest,
          target_preflight_request_id: body.preflightRequestId,
          target_prompt_version: promptVersion,
          target_provider_intent_digest: child.providerIntentDigest,
          target_provider_payload_sha256: providerPayloadSha256,
          target_resolved_language: languageResolution.language,
          target_run_id: run.runId,
          target_run_token_hash: runTokenHash,
          target_start_request_id: body.startRequestId,
          target_transport_enabled: transportEnabled,
          target_window_id: preflight.window.id,
        },
      )
      if (startError) {
        throw new LectureSummaryError(
          startError.code === 'P7338'
            ? 'google_ai_admission_disabled'
            : 'summary_start_rejected',
          startError.code === 'P7338'
            ? 'AI use is not enabled for this Admin environment.'
            : 'The summary operation could not be started.',
          startError.code === 'P7338' ? 503 : 409,
        )
      }
      const started = startData as GoogleStartResult | null
      if (
        !started?.accepted ||
        !isUuid(started.operationId) ||
        !started.actorId ||
        typeof started.idempotentReplay !== 'boolean'
      ) {
        throw new LectureSummaryError(
          started?.reason ?? 'summary_start_rejected',
          'The summary operation was rejected by its usage limits.',
          409,
        )
      }
      actorId = started.actorId
      operationId = started.operationId
      ownsNewOperation = !started.idempotentReplay

      const { data: claimData, error: claimError } = await supabase.rpc(
        'claim_google_ai_provider_dispatch_v1',
        {
          ...googleRpcIdentity,
          target_client_request_id: body.startRequestId,
          target_operation_id: operationId,
          target_provider_family: 'openai_responses_v1',
          target_start_request_id: body.startRequestId,
          target_transport_enabled: transportEnabled,
        },
      )
      if (claimError) throw claimError
      const claim = claimData as GoogleDispatchClaimResult | null
      if (
        !claim?.accepted ||
        claim.operationId !== operationId ||
        !isUuid(claim.clientRequestId)
      ) {
        throw new LectureSummaryError(
          'provider_dispatch_not_authorized',
          'The model request could not be authorized.',
          409,
        )
      }
      if (!claim.dispatchAllowed) {
        if (claim.staleRecovered) {
          return jsonResponse(
            {
              code: 'provider_dispatch_recovered',
              message:
                'The previous model request ended safely. Start a new summary attempt.',
              ok: false,
            },
            409,
          )
        }
        return jsonResponse(
          {
            code: 'operation_in_progress',
            message: 'This summary window is already being generated.',
            ok: false,
            retryAfter: claim.leaseExpiresAt,
          },
          409,
        )
      }
      providerRequestId = claim.clientRequestId
      ownsNewOperation = true

      providerWasDispatched = true
      const response = await fetch('https://api.openai.com/v1/responses', {
        body: serializedProviderBody,
        headers: {
          Authorization: `Bearer ${openAiKey}`,
          'Content-Type': 'application/json',
          'X-Client-Request-Id': providerRequestId,
        },
        method: 'POST',
        signal: AbortSignal.timeout(45_000),
      })
      if (!response.ok) {
        throw new LectureSummaryError(
          `provider_http_${response.status}`,
          response.status === 429
            ? 'The model rate limit was reached. A new explicit retry is required.'
            : `OpenAI summary request failed (${response.status}).`,
          response.status === 429 ? 429 : 502,
        )
      }
      googleProvider = (await response.json()) as OpenAiSummaryResponse
      const parsed = parseSummaryOpenAiResponse(googleProvider)
      actualInputTokens = parsed.inputTokens
      actualOutputTokens = parsed.outputTokens
      providerRequestId = parsed.providerRequestId ?? providerRequestId
      const gated = applySummaryQualityGates({
        commentContext: preflight.commentContext,
        pdfContext: pdf.context,
        previousSummary: preflight.previousSummary,
        result: parsed.result,
        transcript: transcript.segments,
      })
      actualMicrousd = calculateSummaryCostMicrousd(
        actualInputTokens,
        actualOutputTokens,
      )
      const { data: completionData, error: completionError } =
        await supabase.rpc(
          'complete_google_admin_summary_window_operation_v1',
          {
            ...googleRpcIdentity,
            actual_input_tokens: actualInputTokens,
            actual_microusd: actualMicrousd,
            actual_output_tokens: actualOutputTokens,
            provider_request_id: providerRequestId,
            publish_recommended: gated.publishRecommended,
            target_ai_output: gated.output,
            target_operation_id: operationId,
            target_quality_result: gated.qualityResult,
            target_start_request_id: body.startRequestId,
          },
        )
      if (completionError) throw completionError
      const completion = completionData as {
        accepted?: boolean
        authorityRevoked?: boolean
        result_saved?: boolean
        results?: unknown
      }
      if (!completion.accepted || !completion.result_saved) {
        throw new LectureSummaryError(
          completion.authorityRevoked
            ? 'admin_authority_changed'
            : 'late_summary_discarded',
          completion.authorityRevoked
            ? 'Your Admin session changed while the summary was running. The result was safely discarded. Please sign in again and retry.'
            : 'The lecture or summary run ended before this result was accepted.',
          409,
        )
      }
      return jsonResponse({
        actualInputTokens,
        actualMicrousd,
        actualOutputTokens,
        ok: true,
        operationId,
        published: gated.publishRecommended,
        results: completion.results,
        skipped: false,
      })
    }

    if (
      transcript.characters < PHASE6_MIN_SOURCE_CHARACTERS &&
      pdf.characters < PHASE6_MIN_SOURCE_CHARACTERS
    ) {
      const { data, error } = await supabase.rpc('admin_skip_summary_window', {
        target_actor_id: actorId,
        target_lecture_session_id: body.lectureSessionId,
        target_prompt_version: promptVersion,
        target_reason: 'insufficient_source_context',
        target_run_id: run.runId,
        target_run_token_hash: runTokenHash,
        target_source_coverage: sourceCoverage,
        target_source_hashes: sourceHashes,
        target_window_index: body.windowIndex,
      })
      if (error) throw error
      const skipped = data as {
        accepted?: boolean
        reason?: string
        results?: unknown
        window?: { id?: string; requested_language?: string }
      }
      if (skipped.accepted !== false) {
        if (phase71Enabled && skipped.window) {
          await resolveAndRecordWindowLanguage(skipped.window)
        }
        return jsonResponse({
          ok: true,
          results: skipped.results,
          skipped: true,
        })
      }
      if (skipped.reason !== 'comment_context_available') {
        throw new LectureSummaryError(
          skipped.reason ?? 'summary_skip_rejected',
          'Summary preflight could not be completed.',
          409,
        )
      }
    }

    const reservation = estimateSummaryReservation(
      transcript.characters + pdf.characters + 8_000,
    )
    let lastError: unknown = null

    for (let localAttempt = 1; localAttempt <= 2; localAttempt += 1) {
      const { data: startData, error: startError } = await supabase.rpc(
        'admin_start_summary_window_operation',
        {
          estimated_input_tokens: reservation.estimatedInputTokens,
          estimated_microusd: reservation.estimatedMicrousd,
          estimated_output_tokens: reservation.estimatedOutputTokens,
          input_price_microusd_per_million:
            PHASE6_INPUT_PRICE_MICROUSD_PER_MILLION,
          output_price_microusd_per_million:
            PHASE6_OUTPUT_PRICE_MICROUSD_PER_MILLION,
          target_actor_id: actorId,
          target_lecture_session_id: body.lectureSessionId,
          target_model_id: PHASE6_MODEL,
          target_prompt_version: promptVersion,
          target_run_id: run.runId,
          target_run_token_hash: runTokenHash,
          target_source_coverage: sourceCoverage,
          target_source_hashes: sourceHashes,
          target_window_index: body.windowIndex,
        },
      )
      if (startError) throw startError
      const start = startData as StartResult
      if (!start.accepted || !start.operation?.id || !start.window) {
        if (start.reason === 'window_final') {
          return jsonResponse({
            idempotentReplay: true,
            ok: true,
            results: start.results,
          })
        }
        throw new LectureSummaryError(
          start.reason ?? 'summary_start_rejected',
          'Summary window could not be started.',
          start.reason === 'window_running' ? 409 : 422,
        )
      }

      const operationId = start.operation.id
      const languageResolution = phase71Enabled
        ? await resolveAndRecordWindowLanguage(start.window)
        : null
      let provider: OpenAiSummaryResponse | null = null
      const clientRequestId = crypto.randomUUID()
      try {
        const openAiRequest = buildSummaryOpenAiRequest({
          commentContext: start.comment_context,
          materialContext: start.material_context,
          pdfContext: pdf.context,
          previousSummary: start.previous_summary,
          resolvedLanguage: languageResolution?.language,
          safetyIdentifier: await sha256Hex(
            `${actorId}:${body.lectureSessionId}`,
          ),
          transcript: transcript.segments,
          windowEnd: start.window.window_end ?? '',
          windowStart: start.window.window_start ?? '',
        })
        const response = await fetch('https://api.openai.com/v1/responses', {
          body: JSON.stringify(openAiRequest),
          headers: {
            Authorization: `Bearer ${openAiKey}`,
            'Content-Type': 'application/json',
            'X-Client-Request-Id': clientRequestId,
          },
          method: 'POST',
          signal: AbortSignal.timeout(45_000),
        })
        if (!response.ok) {
          throw new LectureSummaryError(
            `provider_http_${response.status}`,
            `OpenAI summary request failed (${response.status}).`,
            502,
          )
        }
        provider = (await response.json()) as OpenAiSummaryResponse
        const parsed = parseSummaryOpenAiResponse(provider)
        const gated = applySummaryQualityGates({
          commentContext: start.comment_context,
          pdfContext: pdf.context,
          previousSummary: start.previous_summary,
          result: parsed.result,
          transcript: transcript.segments,
        })
        const actualMicrousd = calculateSummaryCostMicrousd(
          parsed.inputTokens,
          parsed.outputTokens,
        )
        const { data: completion, error: completionError } = await supabase.rpc(
          'admin_complete_summary_window_operation',
          {
            actual_input_tokens: parsed.inputTokens,
            actual_microusd: actualMicrousd,
            actual_output_tokens: parsed.outputTokens,
            provider_request_id: parsed.providerRequestId,
            publish_recommended: gated.publishRecommended,
            target_actor_id: actorId,
            target_ai_output: gated.output,
            target_model_id: PHASE6_MODEL,
            target_operation_id: operationId,
            target_quality_result: gated.qualityResult,
            target_run_id: run.runId,
          },
        )
        if (completionError) throw completionError
        const completed = completion as {
          accepted?: boolean
          result_saved?: boolean
          results?: unknown
        }
        if (!completed.accepted || !completed.result_saved) {
          throw new LectureSummaryError(
            'late_summary_discarded',
            'The lecture or summary run ended before this result was accepted.',
            409,
          )
        }
        return jsonResponse({
          actualInputTokens: parsed.inputTokens,
          actualMicrousd,
          actualOutputTokens: parsed.outputTokens,
          ok: true,
          operationId,
          published: gated.publishRecommended,
          results: completed.results,
        })
      } catch (error) {
        lastError = error
        const code =
          error instanceof LectureSummaryError
            ? error.code
            : error instanceof DOMException && error.name === 'TimeoutError'
              ? 'provider_timeout_ambiguous'
              : 'summary_provider_failed'
        const accounting = getSummaryFailureAccounting({
          errorCode: code,
          provider,
          reservation,
        })
        await supabase.rpc('admin_fail_summary_window_operation', {
          actual_input_tokens: accounting.actualInputTokens,
          actual_microusd: accounting.actualMicrousd,
          actual_output_tokens: accounting.actualOutputTokens,
          provider_request_id: provider?.id ?? clientRequestId,
          target_actor_id: actorId,
          target_error_code: code,
          target_operation_id: operationId,
          target_run_id: run.runId,
        })
        if (
          localAttempt === 1 &&
          error instanceof LectureSummaryError &&
          error.retryableSchemaFailure
        ) {
          continue
        }
        break
      }
    }
    throw (
      lastError ??
      new LectureSummaryError(
        'summary_failed',
        'Summary generation failed.',
        502,
      )
    )
  } catch (error) {
    if (googleRpcIdentity) {
      const code =
        error instanceof LectureSummaryError
          ? error.code
          : error instanceof DOMException && error.name === 'TimeoutError'
            ? 'provider_timeout_ambiguous'
            : 'summary_provider_failed'
      await finishGoogleFailure(code).catch(() => undefined)
    }
    return responseForError(jsonResponse, error)
  }
})
