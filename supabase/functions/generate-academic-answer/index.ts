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
import {
  AcademicAnswerError,
  applyAcademicAnswerQualityGates,
  buildAcademicAnswerOpenAiRequest,
  calculateAcademicAnswerCostMicrousd,
  estimateAcademicAnswerReservation,
  parseAcademicAnswerOpenAiResponse,
  PHASE72_INPUT_PRICE_MICROUSD_PER_MILLION,
  PHASE72_MAX_REQUEST_BYTES,
  PHASE72_MODEL,
  PHASE72_OUTPUT_PRICE_MICROUSD_PER_MILLION,
  PHASE72_PROMPT_VERSION,
  retrieveVerifiedAcademicSources,
  type AcademicSourcePolicy,
  type OpenAiAcademicResponse,
  type VerifiedAcademicSource,
} from '../_shared/academicAnswers.ts'
import { handleCors } from '../_shared/cors.ts'
import {
  type GoogleAdminOperationContext,
  verifyGoogleAdminOperationRequest,
} from '../_shared/googleAdminOperations.ts'
import {
  readJsonBody,
  RequestBodyTooLargeError,
  UnsupportedJsonContentTypeError,
} from '../_shared/requestBody.ts'
import { createJsonResponse } from '../_shared/responses.ts'
import { parseSummaryRunToken } from '../_shared/lectureSummaries.ts'

type RequestBody = {
  action?:
    | 'approve'
    | 'cancel'
    | 'generate'
    | 'generateAuto'
    | 'hide'
    | 'reject'
    | 'revise'
    | 'status'
  adminToken?: string
  appSessionToken?: string
  answerId?: string
  billingGrant?: string
  grantRequestId?: string
  idempotencyKey?: string
  lectureSessionId?: string
  preflightRequestId?: string
  question?: string
  requestId?: string
  reason?: string | null
  revisionBody?: {
    answerPoints?: Array<{ sourceIds?: string[]; text?: string }>
    limitations?: string[]
  } | null
  runToken?: string
  searchQuery?: string
  sourceKind?: 'summary_candidate' | 'teacher_selected'
  sourceSummaryId?: string | null
  sourcePolicy?: AcademicSourcePolicy
  startRequestId?: string
}

type PreparedRequest = {
  id?: string
  operation_id?: string | null
  status?: string
}

type PrepareResult = {
  accepted?: boolean
  claim_acquired?: boolean
  idempotent_replay?: boolean
  request?: PreparedRequest
  results?: unknown
}

type StartResult = {
  accepted?: boolean
  operation?: { id?: string }
  operations?: Array<{ operation?: { id?: string } }>
  reason?: string
}

type GooglePreflightResult = {
  accepted?: boolean
  academicRequestId?: string
  claimAcquired?: boolean
  idempotentReplay?: boolean
  providerContextDigest?: string
  requestStatus?: string
}

type GoogleChildResult = {
  accepted?: boolean
  grant_id?: string
  providerIntentDigest?: string
}

type GoogleStartResult = {
  accepted?: boolean
  actorId?: string
  academicRequestId?: string
  idempotentReplay?: boolean
  operationId?: string
  reason?: string
  requestStatus?: string
  status?: string
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

function errorResponse(
  jsonResponse: ReturnType<typeof createJsonResponse>,
  error: unknown,
) {
  if (error instanceof AcademicAnswerError) {
    return jsonResponse(
      { code: error.code, message: error.message, ok: false },
      error.status,
    )
  }
  return jsonResponse(
    {
      code: 'academic_answer_failed',
      message: 'The academic reference answer could not be completed.',
      ok: false,
    },
    502,
  )
}

function boundedText(value: unknown, minimum: number, maximum: number) {
  if (typeof value !== 'string') return null
  const normalized = value.normalize('NFKC').replace(/\s+/g, ' ').trim()
  return normalized.length >= minimum && normalized.length <= maximum
    ? normalized
    : null
}

function sourcePolicy(value: unknown): AcademicSourcePolicy | null {
  return ['auto', 'biomedical_pubmed', 'multidisciplinary_doi'].includes(
    String(value ?? ''),
  )
    ? (value as AcademicSourcePolicy)
    : null
}

function revisionBody(value: RequestBody['revisionBody']) {
  if (!value || !Array.isArray(value.answerPoints)) return null
  if (value.answerPoints.length < 1 || value.answerPoints.length > 5)
    return null
  const answerPoints = value.answerPoints.map((point) => {
    const text = boundedText(point?.text, 1, 500)
    const sourceIds = Array.isArray(point?.sourceIds)
      ? [...new Set(point.sourceIds)]
      : []
    if (
      !text ||
      sourceIds.length < 1 ||
      sourceIds.length > 3 ||
      sourceIds.some(
        (id) =>
          !/^(?:pmid:[0-9]{1,9}|doi:10\.[0-9]{4,9}\/\S+)$/i.test(id) ||
          id.length > 259,
      )
    ) {
      return null
    }
    return { source_ids: sourceIds, text }
  })
  if (answerPoints.some((point) => !point)) return null
  const limitations = Array.isArray(value.limitations)
    ? value.limitations.map((item) => boundedText(item, 1, 300))
    : []
  if (limitations.length > 3 || limitations.some((item) => !item)) return null
  return {
    answer_points: answerPoints,
    limitations,
  }
}

function toStoredSource(source: VerifiedAcademicSource) {
  return {
    authors: source.authors,
    doi: source.doi,
    journal: source.journal,
    pmid: source.pmid,
    publication_types: source.publicationTypes,
    publication_year: source.year,
    source_id: source.sourceId,
    source_provider: source.sourceProvider,
    source_role: source.sourceRole,
    study_type: source.studyType,
    title: source.title,
    verification: source.verification,
  }
}

async function readProviderJson(response: Response) {
  if (!response.ok) {
    throw new AcademicAnswerError(
      `provider_http_${response.status}`,
      response.status === 429
        ? 'The model rate limit was reached. A new explicit attempt is required.'
        : 'The model request failed. A new explicit attempt is required.',
      response.status === 429 ? 429 : 502,
    )
  }
  const contentType = (response.headers.get('content-type') ?? '').toLowerCase()
  if (contentType && !contentType.includes('application/json')) {
    throw new AcademicAnswerError(
      'provider_content_type',
      'The model returned an invalid response type.',
      502,
    )
  }
  const declared = Number(response.headers.get('content-length') ?? 0)
  if (Number.isFinite(declared) && declared > 128 * 1024) {
    throw new AcademicAnswerError(
      'provider_response_too_large',
      'The model response was too large.',
      502,
    )
  }
  const bytes = new Uint8Array(await response.arrayBuffer())
  if (bytes.byteLength > 128 * 1024) {
    throw new AcademicAnswerError(
      'provider_response_too_large',
      'The model response was too large.',
      502,
    )
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes)) as OpenAiAcademicResponse
  } catch {
    throw new AcademicAnswerError(
      'provider_invalid_json',
      'The model returned invalid JSON.',
      502,
    )
  }
}

Deno.serve(async (request) => {
  const jsonResponse = createJsonResponse(request)
  const corsResponse = handleCors(request)
  if (corsResponse) return corsResponse
  if (request.method !== 'POST') {
    return jsonResponse({ message: 'Method not allowed.', ok: false }, 405)
  }
  if (Deno.env.get('PHASE7_2_ACADEMIC_ANSWERS_ENABLED') !== 'true') {
    return jsonResponse(
      { message: 'Academic reference answers are disabled.', ok: false },
      503,
    )
  }

  let body: RequestBody
  try {
    body = await readJsonBody<RequestBody>(request, PHASE72_MAX_REQUEST_BYTES)
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
  if (!body.lectureSessionId || !body.action) {
    return jsonResponse(
      { message: 'Admin session, lecture and action are required.', ok: false },
      400,
    )
  }
  if (
    hasGoogleCredential &&
    !['generate', 'generateAuto'].includes(body.action)
  ) {
    return jsonResponse(
      {
        message:
          'This Admin action is not yet available through the Google workspace.',
        ok: false,
      },
      403,
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
      { message: 'Google academic request IDs are invalid.', ok: false },
      400,
    )
  }
  if (
    hasLegacyCredential &&
    (body.preflightRequestId !== undefined ||
      body.grantRequestId !== undefined ||
      body.startRequestId !== undefined ||
      body.appSessionToken !== undefined)
  ) {
    return jsonResponse(
      { message: 'Legacy academic request is invalid.', ok: false },
      400,
    )
  }
  if (
    body.action === 'generateAuto' &&
    Deno.env.get('PHASE7_25_AUTO_ACADEMIC_ANSWERS_ENABLED') !== 'true'
  ) {
    return jsonResponse(
      {
        message: 'Automatic academic reference answers are disabled.',
        ok: false,
      },
      503,
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
  if (!supabaseUrl || !serviceRoleKey) {
    return jsonResponse(
      { message: 'Academic reference answers are not configured.', ok: false },
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

  try {
    if (body.action === 'status') {
      await supabase.rpc('admin_reap_stale_academic_answer_operations', {
        job_limit: 10,
      })
      const { data, error } = await supabase.rpc(
        'admin_list_academic_answer_results',
        { target_lecture_session_id: body.lectureSessionId },
      )
      if (error) throw error
      return jsonResponse({ ok: true, results: data })
    }

    if (body.action === 'cancel') {
      if (!body.requestId) {
        return jsonResponse(
          { message: 'requestId is required.', ok: false },
          400,
        )
      }
      const { data, error } = await supabase.rpc(
        'admin_cancel_academic_answer_request',
        {
          target_actor_id: actorId,
          target_lecture_session_id: body.lectureSessionId,
          target_request_id: body.requestId,
        },
      )
      if (error) throw error
      return jsonResponse({ ok: true, results: data })
    }

    if (['approve', 'hide', 'reject'].includes(body.action)) {
      if (!body.answerId) {
        return jsonResponse(
          { message: 'answerId is required.', ok: false },
          400,
        )
      }
      const { data, error } = await supabase.rpc(
        'admin_manage_academic_answer_publication',
        {
          target_action: body.action,
          target_actor_id: actorId,
          target_answer_id: body.answerId,
          target_lecture_session_id: body.lectureSessionId,
        },
      )
      if (error) throw error
      return jsonResponse({ ok: true, results: data })
    }

    if (body.action === 'revise') {
      const revisedBody = revisionBody(body.revisionBody)
      const reason = body.reason?.normalize('NFKC').trim() || null
      if (!body.answerId || !revisedBody || (reason?.length ?? 0) > 300) {
        return jsonResponse(
          { message: 'A valid answer revision is required.', ok: false },
          400,
        )
      }
      const { data, error } = await supabase.rpc(
        'admin_revise_academic_answer_publication',
        {
          target_actor_id: actorId,
          target_answer_id: body.answerId,
          target_body: revisedBody,
          target_lecture_session_id: body.lectureSessionId,
          target_reason: reason,
        },
      )
      if (error) throw error
      return jsonResponse({ ok: true, results: data })
    }

    const automatic = body.action === 'generateAuto'
    const question = boundedText(body.question, 10, 500)
    const searchQuery = boundedText(body.searchQuery, 3, 240)
    const selectedPolicy = sourcePolicy(body.sourcePolicy ?? 'auto')
    const sourceKind = automatic ? 'summary_candidate' : body.sourceKind
    const effectiveIdempotencyKey = googleContext
      ? body.preflightRequestId
      : body.idempotencyKey
    if (
      !['generate', 'generateAuto'].includes(body.action) ||
      !question ||
      !searchQuery ||
      !selectedPolicy ||
      !effectiveIdempotencyKey ||
      !/^[a-zA-Z0-9:_-]{8,160}$/.test(effectiveIdempotencyKey) ||
      !['summary_candidate', 'teacher_selected'].includes(sourceKind ?? '') ||
      (sourceKind === 'summary_candidate' && !body.sourceSummaryId) ||
      (sourceKind === 'teacher_selected' && body.sourceSummaryId) ||
      (!googleContext && !automatic && !body.billingGrant) ||
      (automatic && !body.runToken)
    ) {
      return jsonResponse(
        {
          message: 'Academic reference answer request is incomplete.',
          ok: false,
        },
        400,
      )
    }

    let runCredentials: { nonce: string; runId: string } | null = null
    if (automatic) {
      try {
        runCredentials = parseSummaryRunToken(body.runToken ?? '')
      } catch {
        throw new AcademicAnswerError(
          'invalid_run_token',
          'The summary automation authorization is invalid.',
          401,
        )
      }
    }

    const openAiKey = Deno.env.get('OPENAI_API_KEY')?.trim()
    const contactEmail = Deno.env.get('LITERATURE_API_CONTACT_EMAIL')?.trim()
    if (
      !openAiKey ||
      !contactEmail ||
      contactEmail.length > 254 ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail)
    ) {
      return jsonResponse(
        { message: 'Literature services are not configured.', ok: false },
        503,
      )
    }

    const runTokenHash = automatic
      ? await sha256Hex(runCredentials?.nonce ?? '')
      : null
    let requestState: PreparedRequest
    let googlePreflightContextDigest: string | null = null
    if (googleContext && googleRpcIdentity) {
      const transportEnabled = googleContext.transportEnabled
      const { data: prepareData, error: prepareError } = await supabase.rpc(
        'prepare_google_admin_academic_answer_v1',
        {
          ...googleRpcIdentity,
          target_idempotency_key: effectiveIdempotencyKey,
          target_lecture_session_id: body.lectureSessionId,
          target_preflight_request_id: body.preflightRequestId,
          target_publication_mode: automatic
            ? 'auto_unreviewed'
            : 'manual_review',
          target_question: question,
          target_question_sha256: await sha256Hex(question),
          target_run_id: automatic ? runCredentials?.runId : null,
          target_run_token_hash: runTokenHash,
          target_search_query_sha256: await sha256Hex(searchQuery),
          target_source_kind: sourceKind,
          target_source_policy: selectedPolicy,
          target_source_summary_id: body.sourceSummaryId ?? null,
          target_transport_enabled: transportEnabled,
        },
      )
      if (prepareError) {
        throw new AcademicAnswerError(
          prepareError.code === 'P7338'
            ? 'google_ai_admission_disabled'
            : 'request_prepare_failed',
          prepareError.code === 'P7338'
            ? 'AI use is not enabled for this Admin environment.'
            : 'The academic answer request could not be prepared safely.',
          prepareError.code === 'P7338' ? 503 : 409,
        )
      }
      const prepared = prepareData as GooglePreflightResult | null
      if (
        !prepared?.accepted ||
        !isUuid(prepared.academicRequestId) ||
        !prepared.providerContextDigest ||
        !/^[0-9a-f]{64}$/.test(prepared.providerContextDigest)
      ) {
        throw new AcademicAnswerError(
          'request_prepare_failed',
          'The academic answer request could not be prepared safely.',
          409,
        )
      }
      requestState = {
        id: prepared.academicRequestId,
        status: prepared.requestStatus,
      }
      googlePreflightContextDigest = prepared.providerContextDigest
      if (
        ['awaiting_review', 'published', 'hidden'].includes(
          prepared.requestStatus ?? '',
        )
      ) {
        return jsonResponse({
          idempotentReplay: true,
          ok: true,
          refreshRequired: true,
          results: null,
        })
      }
      if (prepared.requestStatus === 'insufficient_evidence') {
        throw new AcademicAnswerError(
          'insufficient_verified_primary_evidence',
          'Sufficient verified primary literature was not found, so no answer was generated.',
          422,
        )
      }
      if (
        !['evidence_checking', 'running'].includes(prepared.requestStatus ?? '')
      ) {
        throw new AcademicAnswerError(
          'operation_not_retryable',
          'This reference answer is no longer retryable. Start a new explicit attempt.',
          409,
        )
      }
    } else {
      const prepareRpc = automatic
        ? 'admin_prepare_auto_academic_answer_request'
        : 'admin_prepare_academic_answer_request_v2'
      const prepareArguments = automatic
        ? {
            target_actor_id: actorId,
            target_idempotency_key: body.idempotencyKey,
            target_lecture_session_id: body.lectureSessionId,
            target_question: question,
            target_question_sha256: await sha256Hex(question),
            target_run_id: runCredentials?.runId,
            target_run_token_hash: runTokenHash,
            target_search_query_sha256: await sha256Hex(searchQuery),
            target_source_policy: selectedPolicy,
            target_source_summary_id: body.sourceSummaryId,
          }
        : {
            target_actor_id: actorId,
            target_idempotency_key: body.idempotencyKey,
            target_lecture_session_id: body.lectureSessionId,
            target_question: question,
            target_question_sha256: await sha256Hex(question),
            target_search_query_sha256: await sha256Hex(searchQuery),
            target_source_kind: sourceKind,
            target_source_policy: selectedPolicy,
            target_source_summary_id: body.sourceSummaryId ?? null,
          }
      const { data: prepareData, error: prepareError } = await supabase.rpc(
        prepareRpc,
        prepareArguments,
      )
      if (prepareError) throw prepareError
      const prepared = prepareData as PrepareResult
      requestState = prepared.request ?? {}
      if (!requestState.id) {
        throw new AcademicAnswerError(
          'request_prepare_failed',
          'The academic answer request could not be prepared.',
          409,
        )
      }
      if (automatic && prepared.accepted === false) {
        throw new AcademicAnswerError(
          String(
            (prepareData as { reason?: string }).reason ?? 'auto_not_admitted',
          ),
          'This summary candidate was not admitted for automatic publication.',
          409,
        )
      }
      if (automatic && prepared.claim_acquired === false) {
        if (
          ['awaiting_review', 'published', 'hidden'].includes(
            requestState.status ?? '',
          )
        ) {
          return jsonResponse({
            idempotentReplay: true,
            ok: true,
            results: prepared.results,
          })
        }
        if (
          ['evidence_checking', 'running'].includes(requestState.status ?? '')
        ) {
          return jsonResponse(
            {
              idempotentReplay: true,
              inProgress: true,
              ok: true,
              results: prepared.results,
            },
            202,
          )
        }
        throw new AcademicAnswerError(
          'operation_not_retryable',
          'This automatic reference answer is no longer retryable.',
          409,
        )
      }
      if (!automatic && prepared.idempotent_replay) {
        if (
          ['awaiting_review', 'published', 'hidden'].includes(
            requestState.status ?? '',
          )
        ) {
          return jsonResponse({
            idempotentReplay: true,
            ok: true,
            results: prepared.results,
          })
        }
        throw new AcademicAnswerError(
          requestState.status === 'running'
            ? 'operation_in_progress'
            : 'operation_not_retryable',
          requestState.status === 'running'
            ? 'This reference answer is already running.'
            : 'A new explicit action and API usage PIN are required.',
          409,
        )
      }
    }

    let retrieval
    try {
      retrieval = await retrieveVerifiedAcademicSources({
        contactEmail,
        searchQuery,
        sourcePolicy: selectedPolicy,
      })
    } catch (error) {
      if (!googleContext && !automatic) {
        await supabase.rpc('admin_mark_academic_answer_insufficient', {
          target_actor_id: actorId,
          target_reason:
            error instanceof AcademicAnswerError
              ? error.code
              : 'metadata_failed',
          target_request_id: requestState.id,
        })
      }
      throw error
    }
    const sources = retrieval.sources
    if (!sources.some((source) => source.sourceRole === 'primary')) {
      if (googleContext && googleRpcIdentity) {
        const { data, error } = await supabase.rpc(
          'mark_google_admin_academic_answer_insufficient_v1',
          {
            ...googleRpcIdentity,
            target_academic_request_id: requestState.id,
            target_preflight_request_id: body.preflightRequestId,
            target_reason: 'insufficient_verified_primary_evidence',
            target_transport_enabled: googleContext.transportEnabled,
          },
        )
        if (
          error ||
          (data as { accepted?: boolean } | null)?.accepted !== true
        ) {
          throw new AcademicAnswerError(
            'insufficient_evidence_settlement_failed',
            'The literature result could not be finalized safely.',
            503,
          )
        }
      } else {
        await supabase.rpc('admin_mark_academic_answer_insufficient', {
          target_actor_id: actorId,
          target_reason: 'insufficient_verified_primary_evidence',
          target_request_id: requestState.id,
        })
      }
      throw new AcademicAnswerError(
        'insufficient_verified_primary_evidence',
        'Sufficient verified primary literature was not found, so no answer was generated.',
        422,
      )
    }

    const sourceSetHash = await sha256Hex(
      JSON.stringify(
        sources.map((source) => ({
          abstract: source.abstract,
          authors: source.authors,
          doi: source.doi,
          pmid: source.pmid,
          provider: source.sourceProvider,
          role: source.sourceRole,
          title: source.title,
          year: source.year,
        })),
      ),
    )
    const reservation = estimateAcademicAnswerReservation(
      sources.reduce((sum, source) => sum + source.abstract.length, 0),
    )
    const safetyIdentity = googleContext?.authUserId ?? actorId
    if (!safetyIdentity) {
      throw new AcademicAnswerError(
        'academic_identity_missing',
        'The Admin identity could not be bound to this model request.',
        401,
      )
    }
    const safetyIdentifier = `compass_${(
      await sha256Hex(`phase725:${body.lectureSessionId}:${safetyIdentity}`)
    ).slice(0, 48)}`
    const serializedProviderBody = JSON.stringify(
      buildAcademicAnswerOpenAiRequest({ question, safetyIdentifier, sources }),
    )

    if (
      googleContext &&
      googleRpcIdentity &&
      googlePreflightContextDigest &&
      requestState.id
    ) {
      const transportEnabled = googleContext.transportEnabled
      const { error: reapError } = await supabase.rpc(
        'reap_stale_google_ai_provider_dispatches_v1',
        { job_limit: 10 },
      )
      if (reapError) {
        throw new AcademicAnswerError(
          'provider_dispatch_cleanup_failed',
          'Previous model activity could not be reconciled safely.',
          503,
        )
      }

      let nonce: string
      let nonceKeyVersion: number
      try {
        const derived = await deriveGoogleAiChildGrantNonce({
          feature: 'academic_answers',
          lectureSessionId: body.lectureSessionId,
          requestId: body.grantRequestId!,
        })
        nonce = derived.nonce
        nonceKeyVersion = derived.keyVersion
      } catch {
        throw new AcademicAnswerError(
          'google_ai_child_not_configured',
          'Google Admin AI authorization is not configured.',
          503,
        )
      }
      const nonceHash = await sha256Hex(nonce)
      const providerPayloadSha256 = await sha256Hex(serializedProviderBody)
      const verifiedPrimaryCount = sources.filter(
        (source) => source.sourceRole === 'primary',
      ).length
      const publicationMode = automatic ? 'auto_unreviewed' : 'manual_review'
      const { data: childData, error: childError } = await supabase.rpc(
        'issue_google_academic_answer_ai_child_grant_v1',
        {
          ...googleRpcIdentity,
          target_academic_request_id: requestState.id,
          target_estimated_input_tokens: reservation.estimatedInputTokens,
          target_estimated_microusd: reservation.estimatedMicrousd,
          target_estimated_output_tokens: reservation.estimatedOutputTokens,
          target_input_price_microusd_per_million:
            PHASE72_INPUT_PRICE_MICROUSD_PER_MILLION,
          target_lecture_session_id: body.lectureSessionId,
          target_max_output_tokens: reservation.estimatedOutputTokens,
          target_model_id: PHASE72_MODEL,
          target_nonce_hash: nonceHash,
          target_nonce_key_version: nonceKeyVersion,
          target_output_price_microusd_per_million:
            PHASE72_OUTPUT_PRICE_MICROUSD_PER_MILLION,
          target_preflight_context_digest: googlePreflightContextDigest,
          target_preflight_request_id: body.preflightRequestId,
          target_prompt_version: PHASE72_PROMPT_VERSION,
          target_provider_payload_sha256: providerPayloadSha256,
          target_publication_mode: publicationMode,
          target_request_id: body.grantRequestId,
          target_resolved_source_route: retrieval.route,
          target_run_id: automatic ? runCredentials?.runId : null,
          target_source_set_sha256: sourceSetHash,
          target_transport_enabled: transportEnabled,
          target_verified_primary_count: verifiedPrimaryCount,
          target_verified_source_count: sources.length,
        },
      )
      if (childError) {
        throw new AcademicAnswerError(
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
        throw new AcademicAnswerError(
          'google_ai_child_rejected',
          'AI authorization is no longer available for this lecture.',
          409,
        )
      }

      const { data: startData, error: startError } = await supabase.rpc(
        'start_google_admin_academic_answer_operation_v1',
        {
          ...googleRpcIdentity,
          target_academic_request_id: requestState.id,
          target_estimated_input_tokens: reservation.estimatedInputTokens,
          target_estimated_microusd: reservation.estimatedMicrousd,
          target_estimated_output_tokens: reservation.estimatedOutputTokens,
          target_grant_id: child.grant_id,
          target_input_price_microusd_per_million:
            PHASE72_INPUT_PRICE_MICROUSD_PER_MILLION,
          target_lecture_session_id: body.lectureSessionId,
          target_max_output_tokens: reservation.estimatedOutputTokens,
          target_model_id: PHASE72_MODEL,
          target_nonce_hash: nonceHash,
          target_output_price_microusd_per_million:
            PHASE72_OUTPUT_PRICE_MICROUSD_PER_MILLION,
          target_preflight_context_digest: googlePreflightContextDigest,
          target_preflight_request_id: body.preflightRequestId,
          target_prompt_version: PHASE72_PROMPT_VERSION,
          target_provider_intent_digest: child.providerIntentDigest,
          target_provider_payload_sha256: providerPayloadSha256,
          target_publication_mode: publicationMode,
          target_resolved_source_route: retrieval.route,
          target_run_id: automatic ? runCredentials?.runId : null,
          target_source_set_sha256: sourceSetHash,
          target_start_request_id: body.startRequestId,
          target_transport_enabled: transportEnabled,
          target_verified_primary_count: verifiedPrimaryCount,
          target_verified_source_count: sources.length,
        },
      )
      if (startError) {
        throw new AcademicAnswerError(
          startError.code === 'P7338'
            ? 'google_ai_admission_disabled'
            : 'academic_start_rejected',
          startError.code === 'P7338'
            ? 'AI use is not enabled for this Admin environment.'
            : 'The reference-answer operation could not be started.',
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
        throw new AcademicAnswerError(
          started?.reason ?? 'academic_start_rejected',
          'The reference-answer operation was rejected by its usage limits.',
          409,
        )
      }

      actorId = started.actorId
      const operationId = started.operationId
      let actualInputTokens = 0
      let actualOutputTokens = 0
      let providerRequestId: string | null = null
      let providerDispatched = false
      let accountingSettled = false
      let ownsNewOperation = !started.idempotentReplay

      async function finishGoogleFailure(code: string) {
        if (accountingSettled || !ownsNewOperation) return
        const definitelyUncharged =
          /^provider_http_(?:400|401|403|404|409|422|429)$/.test(code)
        const conservative =
          providerDispatched &&
          actualInputTokens === 0 &&
          actualOutputTokens === 0 &&
          !definitelyUncharged
        const accountedInput = conservative
          ? reservation.estimatedInputTokens
          : actualInputTokens
        const accountedOutput = conservative
          ? reservation.estimatedOutputTokens
          : actualOutputTokens
        const effectiveCode =
          conservative && !code.includes('ambiguous')
            ? `${code}_ambiguous`
            : code
        const { error } = await supabase.rpc(
          'fail_google_admin_academic_answer_operation_v1',
          {
            ...googleRpcIdentity,
            actual_input_tokens: accountedInput,
            actual_microusd: calculateAcademicAnswerCostMicrousd(
              accountedInput,
              accountedOutput,
            ),
            actual_output_tokens: accountedOutput,
            error_code: effectiveCode.slice(0, 120),
            provider_request_id: providerRequestId,
            target_operation_id: operationId,
            target_start_request_id: body.startRequestId,
            target_status: 'failed',
          },
        )
        if (error) throw error
        accountingSettled = true
      }

      try {
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
          throw new AcademicAnswerError(
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
                  'The previous model request ended safely. Start a new explicit attempt.',
                ok: false,
              },
              409,
            )
          }
          return jsonResponse(
            {
              code: 'operation_in_progress',
              message: 'This reference answer is already being generated.',
              ok: false,
              retryAfter: claim.leaseExpiresAt,
            },
            409,
          )
        }
        providerRequestId = claim.clientRequestId
        ownsNewOperation = true
        providerDispatched = true

        const response = await fetch('https://api.openai.com/v1/responses', {
          body: serializedProviderBody,
          headers: {
            Authorization: `Bearer ${openAiKey}`,
            'Content-Type': 'application/json',
            'X-Client-Request-Id': providerRequestId,
          },
          method: 'POST',
          redirect: 'error',
          signal: AbortSignal.timeout(55_000),
        })
        const parsed = parseAcademicAnswerOpenAiResponse(
          await readProviderJson(response),
        )
        actualInputTokens = parsed.inputTokens
        actualOutputTokens = parsed.outputTokens
        providerRequestId = parsed.providerRequestId ?? providerRequestId
        const gated = applyAcademicAnswerQualityGates({
          result: parsed.result,
          sources,
        })
        if (!gated.supported) {
          await finishGoogleFailure('insufficient_model_evidence')
          throw new AcademicAnswerError(
            'insufficient_model_evidence',
            'The verified evidence was insufficient for a supported answer.',
            422,
          )
        }
        const { data: completionData, error: completionError } =
          await supabase.rpc(
            'complete_google_admin_academic_answer_operation_v1',
            {
              ...googleRpcIdentity,
              actual_input_tokens: actualInputTokens,
              actual_microusd: calculateAcademicAnswerCostMicrousd(
                actualInputTokens,
                actualOutputTokens,
              ),
              actual_output_tokens: actualOutputTokens,
              provider_request_id: providerRequestId,
              target_body: gated.body,
              target_operation_id: operationId,
              target_quality_result: {
                ...gated.qualityResult,
                resolved_source_route: retrieval.route,
                source_set_sha256: sourceSetHash,
              },
              target_sources: sources.map(toStoredSource),
              target_start_request_id: body.startRequestId,
            },
          )
        if (completionError) throw completionError
        accountingSettled = true
        const completion = completionData as {
          accepted?: boolean
          authorityRevoked?: boolean
          result_saved?: boolean
          results?: unknown
        }
        if (!completion.accepted || !completion.result_saved) {
          throw new AcademicAnswerError(
            completion.authorityRevoked
              ? 'admin_authority_changed'
              : 'late_result_discarded',
            completion.authorityRevoked
              ? 'Your Admin session changed while the answer was running. The result was safely discarded. Please sign in again and retry.'
              : 'The lecture ended before the answer could be accepted.',
            409,
          )
        }
        return jsonResponse({
          actualInputTokens,
          actualMicrousd: calculateAcademicAnswerCostMicrousd(
            actualInputTokens,
            actualOutputTokens,
          ),
          actualOutputTokens,
          model: PHASE72_MODEL,
          ok: true,
          operationId,
          results: completion.results,
        })
      } catch (error) {
        const code =
          error instanceof AcademicAnswerError
            ? error.code
            : error instanceof DOMException && error.name === 'TimeoutError'
              ? 'provider_timeout'
              : 'academic_answer_failed'
        await finishGoogleFailure(code).catch(() => undefined)
        throw error
      }
    }

    const commonStartArguments = {
      estimated_input_tokens: reservation.estimatedInputTokens,
      estimated_microusd: reservation.estimatedMicrousd,
      estimated_output_tokens: reservation.estimatedOutputTokens,
      target_actor_id: actorId,
      target_input_price_microusd_per_million:
        PHASE72_INPUT_PRICE_MICROUSD_PER_MILLION,
      target_model_id: PHASE72_MODEL,
      target_output_price_microusd_per_million:
        PHASE72_OUTPUT_PRICE_MICROUSD_PER_MILLION,
      target_prompt_version: PHASE72_PROMPT_VERSION,
      target_request_id: requestState.id,
      target_resolved_source_route: retrieval.route,
      target_source_set_sha256: sourceSetHash,
      target_verified_primary_count: sources.filter(
        (source) => source.sourceRole === 'primary',
      ).length,
      target_verified_source_count: sources.length,
    }
    const manualGrant = automatic
      ? null
      : parseBillingGrantToken(body.billingGrant ?? '')
    const { data: startData, error: startError } = await supabase.rpc(
      automatic
        ? 'admin_start_auto_academic_answer_operation'
        : 'admin_start_academic_answer_operation_v2',
      automatic
        ? {
            ...commonStartArguments,
            target_run_id: runCredentials?.runId,
            target_run_token_hash: await sha256Hex(runCredentials?.nonce ?? ''),
          }
        : {
            ...commonStartArguments,
            target_grant_id: manualGrant?.grantId,
            target_nonce_hash: await sha256Hex(manualGrant?.nonce ?? ''),
          },
    )
    if (startError) throw startError
    const started = startData as StartResult
    const operationId = automatic
      ? started.operation?.id
      : started.operations?.[0]?.operation?.id
    if (!started.accepted || !operationId) {
      throw new AcademicAnswerError(
        started.reason ?? 'operation_rejected',
        'The reference-answer operation was rejected by its limits.',
        409,
      )
    }

    let actualInputTokens = 0
    let actualOutputTokens = 0
    let providerRequestId: string | null = crypto.randomUUID()
    let providerDispatched = false
    let accountingSettled = false
    async function finishFailure(code: string) {
      if (accountingSettled) return
      const definitelyUncharged =
        /^provider_http_(?:400|401|403|404|409|422|429)$/.test(code)
      const conservative =
        providerDispatched &&
        actualInputTokens === 0 &&
        actualOutputTokens === 0 &&
        !definitelyUncharged
      const accountedInput = conservative
        ? reservation.estimatedInputTokens
        : actualInputTokens
      const accountedOutput = conservative
        ? reservation.estimatedOutputTokens
        : actualOutputTokens
      await supabase.rpc('admin_fail_academic_answer_operation', {
        actual_input_tokens: accountedInput,
        actual_microusd: calculateAcademicAnswerCostMicrousd(
          accountedInput,
          accountedOutput,
        ),
        actual_output_tokens: accountedOutput,
        provider_request_id: providerRequestId,
        target_actor_id: actorId,
        target_error_code: conservative ? `${code}_ambiguous` : code,
        target_operation_id: operationId,
        target_request_id: requestState.id,
      })
      accountingSettled = true
    }

    try {
      const marked = await supabase.rpc(
        'admin_mark_academic_provider_dispatched',
        {
          target_actor_id: actorId,
          target_operation_id: operationId,
          target_request_id: requestState.id,
        },
      )
      if (marked.error || marked.data !== true) {
        throw new AcademicAnswerError(
          'provider_dispatch_not_authorized',
          'The provider request could not be authorized.',
          409,
        )
      }
      providerDispatched = true
      const response = await fetch('https://api.openai.com/v1/responses', {
        body: serializedProviderBody,
        headers: {
          Authorization: `Bearer ${openAiKey}`,
          'Content-Type': 'application/json',
          'X-Client-Request-Id': providerRequestId,
        },
        method: 'POST',
        redirect: 'error',
        signal: AbortSignal.timeout(55_000),
      })
      const parsed = parseAcademicAnswerOpenAiResponse(
        await readProviderJson(response),
      )
      actualInputTokens = parsed.inputTokens
      actualOutputTokens = parsed.outputTokens
      providerRequestId = parsed.providerRequestId ?? providerRequestId
      const gated = applyAcademicAnswerQualityGates({
        result: parsed.result,
        sources,
      })
      if (!gated.supported) {
        await finishFailure('insufficient_model_evidence')
        throw new AcademicAnswerError(
          'insufficient_model_evidence',
          'The verified evidence was insufficient for a supported answer.',
          422,
        )
      }
      const { data: completionData, error: completionError } =
        await supabase.rpc('admin_complete_academic_answer_operation', {
          actual_input_tokens: actualInputTokens,
          actual_microusd: calculateAcademicAnswerCostMicrousd(
            actualInputTokens,
            actualOutputTokens,
          ),
          actual_output_tokens: actualOutputTokens,
          provider_request_id: providerRequestId,
          target_actor_id: actorId,
          target_body: gated.body,
          target_operation_id: operationId,
          target_quality_result: {
            ...gated.qualityResult,
            resolved_source_route: retrieval.route,
            source_set_sha256: sourceSetHash,
          },
          target_request_id: requestState.id,
          target_sources: sources.map(toStoredSource),
        })
      if (completionError) throw completionError
      accountingSettled = true
      const completion = completionData as {
        accepted?: boolean
        result_saved?: boolean
        results?: unknown
      }
      if (!completion.accepted || !completion.result_saved) {
        throw new AcademicAnswerError(
          'late_result_discarded',
          'The lecture ended before the answer could be accepted.',
          409,
        )
      }
      return jsonResponse({
        actualInputTokens,
        actualMicrousd: calculateAcademicAnswerCostMicrousd(
          actualInputTokens,
          actualOutputTokens,
        ),
        actualOutputTokens,
        model: PHASE72_MODEL,
        ok: true,
        operationId,
        results: completion.results,
      })
    } catch (error) {
      const code =
        error instanceof AcademicAnswerError
          ? error.code
          : error instanceof DOMException && error.name === 'TimeoutError'
            ? 'provider_timeout'
            : 'academic_answer_failed'
      await finishFailure(code).catch(() => undefined)
      throw error
    }
  } catch (error) {
    return errorResponse(jsonResponse, error)
  }
})
