import {
  deriveGoogleAiChildGrantNonce,
  sha256Hex,
} from '../_shared/aiBilling.ts'
import { handleCors } from '../_shared/cors.ts'
import {
  type GoogleAdminOperationContext,
  verifyGoogleAdminOperationRequest,
} from '../_shared/googleAdminOperations.ts'
import { hasLegacyAdminFields } from '../_shared/googleOnlyAdmin.ts'
import { describeJsonBodyError, readJsonBody } from '../_shared/requestBody.ts'
import {
  createOpenAiRealtimeCall,
  createRealtimeTranscriptionSessionConfig,
  DEFAULT_REALTIME_PRICE_MICROUSD_PER_MINUTE,
  DEFAULT_REALTIME_TRANSCRIPTION_MODEL,
  hangupOpenAiRealtimeCall,
  RealtimeProviderCreationError,
  type RealtimeTranscriptionDelay,
} from '../_shared/openaiRealtime.ts'
import {
  runRealtimeProviderHangupSweep,
  type RealtimeProviderHangupJob,
} from '../_shared/realtimeProviderHangup.ts'
import { createJsonResponse } from '../_shared/responses.ts'

type IssueRealtimeSecretRequest = {
  appSessionToken?: string
  delay?: RealtimeTranscriptionDelay
  grantRequestId?: string
  idempotencyKey?: string
  language?: 'auto' | 'en' | 'ja'
  lectureSessionId?: string
  maxAudioSeconds?: number
  sdpOffer?: string
  startRequestId?: string
}

type ProviderActivationResult = {
  accepted?: boolean
  outcome?: string
  should_hangup?: boolean
  shouldHangup?: boolean
  status?: string
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
  reservedAudioSeconds?: number
  reservedMicrousd?: number
  reservedUntil?: string
  status?: string
}

type GoogleDispatchResult = {
  accepted?: boolean
  clientRequestId?: string
  dispatchAllowed?: boolean
  idempotentReplay?: boolean
  leaseExpiresAt?: string
  operationId?: string
  staleRecovered?: boolean
}

const VALID_DELAYS = new Set<RealtimeTranscriptionDelay>([
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
])

function parsePrice(value: string | undefined) {
  if (!value) return DEFAULT_REALTIME_PRICE_MICROUSD_PER_MINUTE
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 1_000_000) {
    throw new Error('Realtime pricing configuration is invalid.')
  }
  return parsed
}

function isUuid(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    )
  )
}

function googleIdentity(context: GoogleAdminOperationContext) {
  return {
    target_auth_user_id: context.authUserId,
    target_google_issuer: context.googleIssuer,
    target_provider_subject_hmac: context.googleSubjectHmac,
    target_subject_pepper_version: context.subjectPepperVersion,
    target_supabase_auth_session_id: context.supabaseAuthSessionId,
    target_token_hash: context.appSessionTokenHash,
  }
}

function providerErrorCode(error: unknown) {
  const raw = error instanceof Error ? error.message : 'openai_error'
  const normalized = raw.replace(/[^A-Za-z0-9:_-]/g, '_').slice(0, 120)
  return normalized || 'openai_error'
}

Deno.serve(async (request) => {
  const jsonResponse = createJsonResponse(request)
  const corsResponse = handleCors(request)
  if (corsResponse) return corsResponse
  if (request.method !== 'POST') {
    return jsonResponse({ ok: false, message: 'Method not allowed.' }, 405)
  }
  if (Deno.env.get('PHASE4_REALTIME_CAPTIONS_ENABLED') !== 'true') {
    return jsonResponse(
      { ok: false, message: 'Realtime captions are disabled.' },
      503,
    )
  }

  const openAiApiKey = Deno.env.get('OPENAI_API_KEY')
  if (!openAiApiKey) {
    return jsonResponse(
      { ok: false, message: 'Realtime transcription is not configured.' },
      503,
    )
  }

  let body: IssueRealtimeSecretRequest
  try {
    body = await readJsonBody<IssueRealtimeSecretRequest>(request, 128 * 1024)
  } catch (error) {
    const bodyError = describeJsonBodyError(error)
    return jsonResponse(
      { ok: false, message: bodyError.message },
      bodyError.status,
    )
  }
  if (hasLegacyAdminFields(body)) {
    return jsonResponse(
      { ok: false, message: 'Legacy Admin credentials are not supported.' },
      400,
    )
  }
  if (
    typeof body.appSessionToken !== 'string' ||
    body.appSessionToken.trim().length === 0
  ) {
    return jsonResponse(
      { ok: false, message: 'appSessionToken is required.' },
      401,
    )
  }
  if (
    !body.lectureSessionId ||
    !isUuid(body.lectureSessionId) ||
    !body.sdpOffer
  ) {
    return jsonResponse(
      { ok: false, message: 'Realtime start request is incomplete.' },
      400,
    )
  }
  if (
    !isUuid(body.grantRequestId) ||
      !isUuid(body.startRequestId) ||
      body.grantRequestId.toLowerCase() === body.startRequestId.toLowerCase() ||
      body.idempotencyKey !== undefined
  ) {
    return jsonResponse(
      { ok: false, message: 'Google Realtime request IDs are invalid.' },
      400,
    )
  }
  if (
    body.sdpOffer.length < 10 ||
    body.sdpOffer.length > 100_000 ||
    !body.sdpOffer.startsWith('v=0')
  ) {
    return jsonResponse({ ok: false, message: 'Invalid SDP offer.' }, 400)
  }
  if (
    body.maxAudioSeconds !== undefined &&
    (!Number.isSafeInteger(body.maxAudioSeconds) ||
      body.maxAudioSeconds < 1 ||
      body.maxAudioSeconds > 5_400)
  ) {
    return jsonResponse(
      { ok: false, message: 'Invalid Realtime duration.' },
      400,
    )
  }

  const language = body.language ?? 'auto'
  const delay = body.delay ?? 'low'
  if (!['auto', 'en', 'ja'].includes(language) || !VALID_DELAYS.has(delay)) {
    return jsonResponse(
      { ok: false, message: 'Invalid transcription configuration.' },
      400,
    )
  }

  let pricePerMinute: number
  try {
    pricePerMinute = parsePrice(
      Deno.env.get('OPENAI_REALTIME_PRICE_MICROUSD_PER_MINUTE'),
    )
  } catch (error) {
    return jsonResponse(
      {
        ok: false,
        message:
          error instanceof Error ? error.message : 'Realtime start failed.',
      },
      400,
    )
  }
  const model =
    Deno.env.get('OPENAI_REALTIME_TRANSCRIPTION_MODEL') ??
    DEFAULT_REALTIME_TRANSCRIPTION_MODEL
  if (!/^[a-z0-9][a-z0-9._-]{1,119}$/i.test(model)) {
    return jsonResponse(
      { ok: false, message: 'Realtime model configuration is invalid.' },
      503,
    )
  }

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
  const googleContext = verification
  const googleSupabase = verification.serviceClient
  const rpcIdentity = googleIdentity(googleContext)
    const requestedAudioSeconds = body.maxAudioSeconds ?? 5_400
    const estimatedMicrousd = Math.ceil(
      (requestedAudioSeconds * pricePerMinute) / 60,
    )
    const sessionConfig = createRealtimeTranscriptionSessionConfig({
      delay,
      ...(language === 'auto' ? {} : { language }),
      model,
    })
    const sessionConfigSha256 = await sha256Hex(
      JSON.stringify(sessionConfig.session),
    )
    const sdpOfferSha256 = await sha256Hex(body.sdpOffer)
    let nonce: string
    let nonceKeyVersion: number
    try {
      const derived = await deriveGoogleAiChildGrantNonce({
        feature: 'captions',
        lectureSessionId: body.lectureSessionId,
        requestId: body.grantRequestId!,
      })
      nonce = derived.nonce
      nonceKeyVersion = derived.keyVersion
    } catch {
      return jsonResponse(
        {
          code: 'google_ai_child_not_configured',
          message: 'Google Admin AI authorization is not configured.',
          ok: false,
        },
        503,
      )
    }
    const nonceHash = await sha256Hex(nonce)

    const { error: reapError } = await googleSupabase.rpc(
      'reap_stale_google_ai_provider_dispatches_v1',
      { job_limit: 10 },
    )
    if (reapError) {
      return jsonResponse(
        {
          code: 'provider_dispatch_cleanup_failed',
          message: 'Previous model activity could not be reconciled safely.',
          ok: false,
        },
        503,
      )
    }

    const childArguments = {
      ...rpcIdentity,
      target_delay: delay,
      target_estimated_microusd: estimatedMicrousd,
      target_language: language,
      target_lecture_session_id: body.lectureSessionId,
      target_model_id: model,
      target_nonce_hash: nonceHash,
      target_nonce_key_version: nonceKeyVersion,
      target_price_microusd_per_minute: pricePerMinute,
      target_request_id: body.grantRequestId,
      target_requested_audio_seconds: requestedAudioSeconds,
      target_sdp_offer_sha256: sdpOfferSha256,
      target_session_config_sha256: sessionConfigSha256,
      target_transport_enabled:
        googleContext.transportEnabled &&
        Deno.env.get('PHASE4_REALTIME_CAPTIONS_ENABLED') === 'true' &&
        Boolean(openAiApiKey),
    }
    const issueChild = () =>
      googleSupabase.rpc(
        'issue_google_realtime_ai_child_grant_v1',
        childArguments,
      )
    let childResponse: Awaited<ReturnType<typeof issueChild>>
    let childRetried = false
    try {
      childResponse = await issueChild()
    } catch {
      childRetried = true
      childResponse = await issueChild()
    }
    if (!childRetried && childResponse.error && !childResponse.error.code) {
      childRetried = true
      childResponse = await issueChild()
    }
    const { data: childData, error: childError } = childResponse
    const child = childData as GoogleChildResult | null
    if (
      childError ||
      child?.accepted !== true ||
      !isUuid(child.grant_id) ||
      !/^[0-9a-f]{64}$/.test(child.providerIntentDigest ?? '')
    ) {
      return jsonResponse(
        {
          code:
            childError?.code === 'P7338'
              ? 'google_ai_admission_disabled'
              : 'google_ai_child_rejected',
          message:
            childError?.code === 'P7338'
              ? 'AI use is not enabled for this Admin environment.'
              : 'AI authorization is no longer available for this lecture.',
          ok: false,
        },
        childError?.code === 'P7338' ? 503 : 409,
      )
    }

    const startArguments = {
      ...rpcIdentity,
      target_delay: delay,
      target_estimated_microusd: estimatedMicrousd,
      target_grant_id: child.grant_id,
      target_language: language,
      target_lecture_session_id: body.lectureSessionId,
      target_model_id: model,
      target_nonce_hash: nonceHash,
      target_price_microusd_per_minute: pricePerMinute,
      target_provider_intent_digest: child.providerIntentDigest,
      target_requested_audio_seconds: requestedAudioSeconds,
      target_sdp_offer_sha256: sdpOfferSha256,
      target_session_config_sha256: sessionConfigSha256,
      target_start_request_id: body.startRequestId,
      target_transport_enabled:
        googleContext.transportEnabled &&
        Deno.env.get('PHASE4_REALTIME_CAPTIONS_ENABLED') === 'true' &&
        Boolean(openAiApiKey),
    }
    const startRealtime = () =>
      googleSupabase.rpc(
        'start_google_admin_realtime_operation_v1',
        startArguments,
      )
    let startResponse: Awaited<ReturnType<typeof startRealtime>>
    let startRetried = false
    try {
      startResponse = await startRealtime()
    } catch {
      startRetried = true
      startResponse = await startRealtime()
    }
    if (!startRetried && startResponse.error && !startResponse.error.code) {
      startRetried = true
      startResponse = await startRealtime()
    }
    const { data: startData, error: startError } = startResponse
    const started = startData as GoogleStartResult | null
    if (
      startError ||
      started?.accepted !== true ||
      !isUuid(started.operationId) ||
      typeof started.idempotentReplay !== 'boolean' ||
      !Number.isSafeInteger(started.reservedAudioSeconds) ||
      (started.reservedAudioSeconds ?? 0) < 1 ||
      !Number.isSafeInteger(started.reservedMicrousd) ||
      (started.reservedMicrousd ?? 0) < 1 ||
      !started.reservedUntil
    ) {
      return jsonResponse(
        {
          code:
            startError?.code === 'P7338'
              ? 'google_ai_admission_disabled'
              : 'operation_rejected',
          message:
            startError?.code === 'P7338'
              ? 'AI use is not enabled for this Admin environment.'
              : 'The Realtime caption operation could not be started.',
          ok: false,
        },
        startError?.code === 'P7338' ? 503 : 409,
      )
    }
    const operationId = started.operationId

    const claimArguments = {
      ...rpcIdentity,
      target_client_request_id: body.startRequestId,
      target_operation_id: operationId,
      target_provider_family: 'openai_realtime_v1',
      target_start_request_id: body.startRequestId,
      target_transport_enabled:
        googleContext.transportEnabled &&
        Deno.env.get('PHASE4_REALTIME_CAPTIONS_ENABLED') === 'true' &&
        Boolean(openAiApiKey),
    }
    let claimResponse = await googleSupabase.rpc(
      'claim_google_ai_provider_dispatch_v1',
      claimArguments,
    )
    // An exact retry determines whether the first claim committed without
    // ever making a provider request twice. Abandoned unclaimed starts are
    // subsequently released by the bounded DB reaper.
    if (claimResponse.error) {
      claimResponse = await googleSupabase.rpc(
        'claim_google_ai_provider_dispatch_v1',
        claimArguments,
      )
    }
    const claim = claimResponse.data as GoogleDispatchResult | null
    if (
      claimResponse.error ||
      claim?.accepted !== true ||
      claim.operationId !== operationId ||
      claim.clientRequestId !== body.startRequestId
    ) {
      return jsonResponse(
        {
          code: 'provider_dispatch_not_authorized',
          message: 'The Realtime provider request could not be authorized.',
          ok: false,
          operationId,
          startRequestId: body.startRequestId,
        },
        claimResponse.error ? 503 : 409,
      )
    }
    if (!claim.dispatchAllowed) {
      return jsonResponse(
        {
          code: claim.staleRecovered
            ? 'provider_dispatch_recovered'
            : 'operation_in_progress',
          message: claim.staleRecovered
            ? 'The previous Realtime request ended safely. Start a new attempt.'
            : 'This Realtime connection is already being prepared.',
          ok: false,
          operationId,
          retryAfter: claim.leaseExpiresAt ?? null,
          startRequestId: body.startRequestId,
        },
        409,
      )
    }

    let providerCall: Awaited<
      ReturnType<typeof createOpenAiRealtimeCall>
    > | null = null
    let creationError: RealtimeProviderCreationError | null = null
    let finalized = false
    const sweepOperation = async () =>
      runRealtimeProviderHangupSweep({
        apiKey: openAiApiKey,
        claim: async ({ lectureSessionId, limit, operationId }) => {
          const { data, error } = await googleSupabase.rpc(
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
          const { data, error } = await googleSupabase.rpc(
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
        limit: 1,
        operationId,
      })

    try {
      providerCall = await createOpenAiRealtimeCall({
        apiKey: openAiApiKey,
        clientRequestId: body.startRequestId!,
        safetyIdentifier: await sha256Hex(
          `${body.lectureSessionId}:${googleContext.authUserId}`,
        ),
        sdpOffer: body.sdpOffer,
        sessionConfig,
      })

      let activationResponse = await googleSupabase.rpc(
        'activate_google_admin_realtime_provider_v1',
        {
          ...rpcIdentity,
          target_client_request_id: body.startRequestId,
          target_operation_id: operationId,
          target_provider_call_id: providerCall.callId,
          target_provider_request_id: providerCall.requestId,
          target_start_request_id: body.startRequestId,
          target_transport_enabled:
            googleContext.transportEnabled &&
            Deno.env.get('PHASE4_REALTIME_CAPTIONS_ENABLED') === 'true',
        },
      )
      // One exact retry closes a lost local DB response without ever creating
      // or dispatching another provider call.
      if (activationResponse.error) {
        activationResponse = await googleSupabase.rpc(
          'activate_google_admin_realtime_provider_v1',
          {
            ...rpcIdentity,
            target_client_request_id: body.startRequestId,
            target_operation_id: operationId,
            target_provider_call_id: providerCall.callId,
            target_provider_request_id: providerCall.requestId,
            target_start_request_id: body.startRequestId,
            target_transport_enabled:
              googleContext.transportEnabled &&
              Deno.env.get('PHASE4_REALTIME_CAPTIONS_ENABLED') === 'true',
          },
        )
      }
      const activation =
        activationResponse.data as ProviderActivationResult | null
      if (activationResponse.error || !activation) {
        throw new Error('realtime_provider_call_registration_failed')
      }
      finalized = true
      if (!activation.accepted || activation.shouldHangup) {
        throw new Error('realtime_operation_stopped_before_activation')
      }

      return jsonResponse({
        model,
        ok: true,
        operationId,
        pricingRateMicrousdPerMinute: pricePerMinute,
        reservedAudioSeconds: started.reservedAudioSeconds,
        reservedMicrousd: started.reservedMicrousd,
        reservedUntil: started.reservedUntil,
        sdpAnswer: providerCall.answerSdp,
        sessionConfig,
      })
    } catch (error) {
      if (error instanceof RealtimeProviderCreationError) {
        creationError = error
      }
      const callId = providerCall?.callId ?? creationError?.callId ?? null
      const providerRequestId =
        providerCall?.requestId ?? creationError?.requestId ?? null
      const creationMayHaveSucceeded =
        Boolean(callId) || creationError?.creationMayHaveSucceeded === true
      const errorCode = providerErrorCode(error)

      if (!finalized) {
        const terminalErrorCode = creationMayHaveSucceeded
          ? `${errorCode.slice(0, 100)}_ambiguous`
          : errorCode
        const failureResponse = await googleSupabase.rpc(
          'fail_google_admin_realtime_provider_v1',
          {
            ...rpcIdentity,
            target_client_request_id: body.startRequestId,
            target_error_code: terminalErrorCode,
            target_operation_id: operationId,
            target_outcome: creationMayHaveSucceeded
              ? 'creation_uncertain'
              : 'creation_failed',
            target_provider_call_id: callId,
            target_provider_request_id: providerRequestId,
            target_start_request_id: body.startRequestId,
            target_transport_enabled: googleContext.transportEnabled,
          },
        )
        if (failureResponse.error || !failureResponse.data) {
          // Last-resort typed terminal control. This covers a committed
          // activation whose two exact RPC responses were lost; the DB facade
          // rebinds start/dispatch/creation evidence before enqueueing hangup.
          await googleSupabase.rpc('manage_google_admin_ai_control_v1', {
            ...rpcIdentity,
            target_action: 'stopFeature',
            target_configuration: null,
            target_control_intent_digest: null,
            target_lecture_session_id: body.lectureSessionId,
            target_operation_id: operationId,
            target_reason: terminalErrorCode,
            target_request_id: body.grantRequestId,
            target_transport_enabled: googleContext.transportEnabled,
          })
        }
      }

      if (callId) {
        try {
          const directHangup = await hangupOpenAiRealtimeCall({
            apiKey: openAiApiKey,
            callId,
          })
          if (!directHangup.ok) await sweepOperation()
        } catch {
          try {
            await sweepOperation()
          } catch {
            // The durable provider row remains eligible for the machine sweep.
          }
        }
      }
      return jsonResponse(
        {
          code: 'realtime_provider_unavailable',
          message: 'OpenAI Realtime connection could not be prepared.',
          ok: false,
        },
        errorCode === 'openai_http_429' ? 429 : 502,
      )
    }
})
