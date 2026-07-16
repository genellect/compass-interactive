import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.110.0'
import { sha256Hex } from '../_shared/aiBilling.ts'
import {
  getAdminActorId,
  getAdminTokenClaims,
  getAdminTokenSecret,
} from '../_shared/adminToken.ts'
import { handleCors } from '../_shared/cors.ts'
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
  type SummaryPdfContext,
  type SummaryTranscriptSegment,
} from '../_shared/lectureSummaries.ts'
import {
  readJsonBody,
  RequestBodyTooLargeError,
} from '../_shared/requestBody.ts'
import { createJsonResponse } from '../_shared/responses.ts'

type RequestBody = {
  adminToken?: string
  lectureSessionId?: string
  pdfContext?: SummaryPdfContext | null
  runToken?: string
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
    window_end?: string
    window_start?: string
  }
}

function responseForError(
  jsonResponse: ReturnType<typeof createJsonResponse>,
  error: unknown,
) {
  if (error instanceof LectureSummaryError) {
    return jsonResponse({ code: error.code, message: error.message, ok: false }, error.status)
  }
  return jsonResponse(
    { code: 'summary_failed', message: 'Lecture summary generation failed.', ok: false },
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
      return jsonResponse({ message: 'Request body is too large.', ok: false }, 413)
    }
    return jsonResponse({ message: 'Invalid JSON body.', ok: false }, 400)
  }
  if (
    !body.adminToken ||
    !body.lectureSessionId ||
    !body.runToken ||
    !Number.isInteger(body.windowIndex) ||
    (body.windowIndex ?? 0) < 1 ||
    (body.windowIndex ?? 0) > 18
  ) {
    return jsonResponse(
      { message: 'Admin session, run and valid window are required.', ok: false },
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

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const openAiKey = Deno.env.get('OPENAI_API_KEY')
  if (!supabaseUrl || !serviceRoleKey || !openAiKey) {
    return jsonResponse(
      { message: 'Lecture summaries are not configured.', ok: false },
      503,
    )
  }
  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  })

  try {
    const run = parseSummaryRunToken(body.runToken)
    const runTokenHash = await sha256Hex(run.nonce)
    const transcript = await normalizeTranscriptSegments(
      body.lectureSessionId,
      body.transcriptSegments ?? [],
    )
    const pdf = await normalizePdfContext(body.pdfContext)

    if (pdf.context) {
      const [{ data: document, error: documentError }, { data: live, error: liveError }] =
        await Promise.all([
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

    if (
      transcript.characters < PHASE6_MIN_SOURCE_CHARACTERS &&
      pdf.characters < PHASE6_MIN_SOURCE_CHARACTERS
    ) {
      const { data, error } = await supabase.rpc('admin_skip_summary_window', {
        target_actor_id: actorId,
        target_lecture_session_id: body.lectureSessionId,
        target_prompt_version: PHASE6_PROMPT_VERSION,
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
      }
      if (skipped.accepted !== false) {
        return jsonResponse({ ok: true, results: skipped.results, skipped: true })
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
          target_prompt_version: PHASE6_PROMPT_VERSION,
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
          return jsonResponse({ idempotentReplay: true, ok: true, results: start.results })
        }
        throw new LectureSummaryError(
          start.reason ?? 'summary_start_rejected',
          'Summary window could not be started.',
          start.reason === 'window_running' ? 409 : 422,
        )
      }

      const operationId = start.operation.id
      let provider: OpenAiSummaryResponse | null = null
      try {
        const openAiRequest = buildSummaryOpenAiRequest({
          commentContext: start.comment_context,
          materialContext: start.material_context,
          pdfContext: pdf.context,
          previousSummary: start.previous_summary,
          safetyIdentifier: await sha256Hex(`${actorId}:${body.lectureSessionId}`),
          transcript: transcript.segments,
          windowEnd: start.window.window_end ?? '',
          windowStart: start.window.window_start ?? '',
        })
        const response = await fetch('https://api.openai.com/v1/responses', {
          body: JSON.stringify(openAiRequest),
          headers: {
            Authorization: `Bearer ${openAiKey}`,
            'Content-Type': 'application/json',
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
          provider_request_id: provider?.id ?? null,
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
    throw lastError ?? new LectureSummaryError('summary_failed', 'Summary generation failed.', 502)
  } catch (error) {
    return responseForError(jsonResponse, error)
  }
})
