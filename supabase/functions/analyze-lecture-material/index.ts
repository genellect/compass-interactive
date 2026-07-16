import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.110.0'
import { parseBillingGrantToken, sha256Hex } from '../_shared/aiBilling.ts'
import {
  getAdminActorId,
  getAdminTokenClaims,
  getAdminTokenSecret,
} from '../_shared/adminToken.ts'
import { handleCors } from '../_shared/cors.ts'
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
} from '../_shared/requestBody.ts'
import { createJsonResponse } from '../_shared/responses.ts'

type RequestBody = {
  action?: MaterialAction
  adminToken?: string
  analysisId?: string | null
  billingGrant?: string
  documentId?: string
  documentVersion?: string
  extraction?: MaterialExtraction
  idempotencyKey?: string
  lectureSessionId?: string
  pageEnd?: number | null
  pageStart?: number | null
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
  operations?: Array<{
    operation?: { id?: string }
  }>
  reason?: string
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
  if (Deno.env.get('PHASE5_MATERIAL_ANALYSIS_ENABLED') !== 'true') {
    return jsonResponse(
      { message: 'Material analysis is disabled.', ok: false },
      503,
    )
  }
  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const openAiKey = Deno.env.get('OPENAI_API_KEY')
  if (!supabaseUrl || !serviceRoleKey || !openAiKey) {
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
    return jsonResponse({ message: 'Invalid JSON body.', ok: false }, 400)
  }
  if (
    !body.adminToken ||
    !body.billingGrant ||
    !body.lectureSessionId ||
    !body.documentId ||
    !body.documentVersion ||
    !body.extraction ||
    !body.idempotencyKey ||
    !body.action ||
    !['material_analysis', 'poll_suggestions'].includes(body.action) ||
    !/^[a-zA-Z0-9:_-]{8,160}$/.test(body.idempotencyKey)
  ) {
    return jsonResponse(
      { message: 'Material analysis request is incomplete.', ok: false },
      400,
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

  let actorId: string
  try {
    const claims = await getAdminTokenClaims(
      body.adminToken,
      getAdminTokenSecret(),
    )
    if (!claims) {
      return jsonResponse({ message: 'Invalid Admin session.', ok: false }, 401)
    }
    actorId = getAdminActorId(claims)
  } catch {
    return jsonResponse({ message: 'Admin auth failed.', ok: false }, 500)
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  })
  let operationId: string | null = null
  let actualInputTokens = 0
  let actualOutputTokens = 0
  let providerRequestId: string | null = null

  async function finishFailure(code: string) {
    if (!operationId) return
    await supabase.rpc('admin_fail_material_ai_operation', {
      actual_input_tokens: actualInputTokens,
      actual_microusd: calculateCostMicrousd(
        actualInputTokens,
        actualOutputTokens,
      ),
      actual_output_tokens: actualOutputTokens,
      error_code: code.slice(0, 120),
      provider_request_id: providerRequestId,
      target_actor_id: actorId,
      target_operation_id: operationId,
      target_status: 'failed',
    })
  }

  try {
    const { data: priorState, error: stateError } = await supabase.rpc(
      'admin_get_material_ai_operation_state',
      {
        target_actor_id: actorId,
        target_feature: body.action,
        target_idempotency_key: body.idempotencyKey,
        target_lecture_session_id: body.lectureSessionId,
      },
    )
    if (stateError) throw stateError
    const state = priorState as OperationState | null
    if (state?.found) {
      if (state.status === 'succeeded' && state.result_saved) {
        return jsonResponse({
          idempotentReplay: true,
          ok: true,
          results: state.results,
        })
      }
      return jsonResponse(
        {
          code:
            state.status === 'running'
              ? 'operation_in_progress'
              : 'operation_not_retryable',
          message:
            state.status === 'running'
              ? 'This material analysis is already running.'
              : 'A new Billing PIN authorization is required before retrying.',
          ok: false,
        },
        409,
      )
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

    const selectedCharacterCount = body.extraction.pages
      .filter(
        (page) =>
          body.action === 'material_analysis' ||
          (page.pageNumber >= (body.pageStart ?? 1) &&
            page.pageNumber <= (body.pageEnd ?? body.extraction.pageCount)),
      )
      .reduce((sum, page) => sum + page.characterCount, 0)
    const reservation = estimateReservation(selectedCharacterCount, body.action)
    const { grantId, nonce } = parseBillingGrantToken(body.billingGrant)
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
      throw new MaterialAnalysisError(
        'operation_rejected',
        'The billed material analysis operation could not be started.',
        409,
      )
    }
    const started = startedData as StartResult
    operationId = started.operations?.[0]?.operation?.id ?? null
    if (!started.accepted || !operationId) {
      throw new MaterialAnalysisError(
        started.reason ?? 'operation_rejected',
        'The material analysis operation was rejected by its usage limits.',
        409,
      )
    }

    const safetyIdentifier = `compass_${(
      await sha256Hex(`phase5:${body.lectureSessionId}:${actorId}`)
    ).slice(0, 48)}`
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
    providerRequestId = parsed.providerRequestId
    const gatedResult = applyMaterialQualityGates({
      action: body.action,
      existingQuestions,
      extraction: body.extraction,
      pageEnd: body.pageEnd,
      pageStart: body.pageStart,
      result: parsed.result,
    })

    const { data: completionData, error: completionError } = await supabase.rpc(
      'admin_complete_material_ai_operation',
      {
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
      },
    )
    if (completionError) throw completionError
    const completion = completionData as {
      accepted?: boolean
      result_saved?: boolean
      results?: unknown
    }
    if (!completion.accepted || !completion.result_saved) {
      throw new MaterialAnalysisError(
        'late_result_discarded',
        'The lecture ended before the model result was accepted.',
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
          ? 'provider_timeout'
          : 'material_analysis_failed'
    await finishFailure(code).catch(() => undefined)
    return errorResponse(jsonResponse, error)
  }
})
