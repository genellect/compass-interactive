export const DEFAULT_REALTIME_TRANSCRIPTION_MODEL = 'gpt-realtime-whisper'
export const DEFAULT_REALTIME_PRICE_MICROUSD_PER_MINUTE = 17_000

export type RealtimeTranscriptionDelay =
  'minimal' | 'low' | 'medium' | 'high' | 'xhigh'

export type RealtimeProviderCall = {
  answerSdp: string
  callId: string
  requestId: string | null
}

const REALTIME_CREATE_TIMEOUT_MS = 20_000
const REALTIME_HANGUP_TIMEOUT_MS = 10_000

export function createRealtimeTranscriptionSessionConfig({
  delay = 'low',
  language,
  model = DEFAULT_REALTIME_TRANSCRIPTION_MODEL,
}: {
  delay?: RealtimeTranscriptionDelay
  language?: 'en' | 'ja'
  model?: string
}) {
  return {
    session: {
      type: 'transcription',
      audio: {
        input: {
          format: { rate: 24_000, type: 'audio/pcm' },
          transcription: {
            delay,
            ...(language ? { language } : {}),
            model,
          },
          turn_detection: null,
        },
      },
    },
  }
}

export function parseRealtimeCallId(location: string | null) {
  if (!location) {
    throw new Error('openai_missing_realtime_call_location')
  }

  let pathname: string
  try {
    pathname = new URL(location, 'https://api.openai.com').pathname
  } catch {
    throw new Error('openai_invalid_realtime_call_location')
  }
  const match = pathname.match(/\/v1\/realtime\/calls\/([^/]+)$/)
  const callId = match?.[1] ? decodeURIComponent(match[1]) : ''
  if (
    callId.length < 3 ||
    callId.length > 200 ||
    !/^[A-Za-z0-9_-]+$/.test(callId)
  ) {
    throw new Error('openai_invalid_realtime_call_location')
  }
  return callId
}

export async function createOpenAiRealtimeCall({
  apiKey,
  clientRequestId,
  fetchImpl = fetch,
  safetyIdentifier,
  sdpOffer,
  sessionConfig,
}: {
  apiKey: string
  clientRequestId: string
  fetchImpl?: typeof fetch
  safetyIdentifier: string
  sdpOffer: string
  sessionConfig: ReturnType<typeof createRealtimeTranscriptionSessionConfig>
}): Promise<RealtimeProviderCall> {
  if (
    sdpOffer.length < 10 ||
    sdpOffer.length > 100_000 ||
    !sdpOffer.startsWith('v=0')
  ) {
    throw new Error('invalid_realtime_sdp_offer')
  }
  if (!/^[0-9a-f-]{36}$/i.test(clientRequestId)) {
    throw new Error('invalid_realtime_client_request_id')
  }

  const formData = new FormData()
  // OpenAI expects both multipart values as regular form fields. Supplying a
  // filename turns them into file-upload parts and the Realtime endpoint
  // rejects the otherwise valid session with HTTP 400.
  formData.set('sdp', sdpOffer)
  formData.set('session', JSON.stringify(sessionConfig.session))

  const response = await fetchImpl('https://api.openai.com/v1/realtime/calls', {
    body: formData,
    headers: {
      Accept: 'application/sdp',
      Authorization: `Bearer ${apiKey}`,
      'OpenAI-Safety-Identifier': safetyIdentifier,
      'X-Client-Request-Id': clientRequestId,
    },
    method: 'POST',
    signal: AbortSignal.timeout(REALTIME_CREATE_TIMEOUT_MS),
  })

  if (!response.ok) {
    throw new Error(`openai_http_${response.status}`)
  }

  const answerSdp = await response.text()
  if (
    answerSdp.length < 10 ||
    answerSdp.length > 100_000 ||
    !answerSdp.startsWith('v=0')
  ) {
    throw new Error('openai_invalid_realtime_sdp_response')
  }

  return {
    answerSdp,
    callId: parseRealtimeCallId(response.headers.get('Location')),
    requestId: response.headers.get('x-request-id'),
  }
}

export async function hangupOpenAiRealtimeCall({
  apiKey,
  callId,
  fetchImpl = fetch,
}: {
  apiKey: string
  callId: string
  fetchImpl?: typeof fetch
}) {
  if (
    callId.length < 3 ||
    callId.length > 200 ||
    !/^[A-Za-z0-9_-]+$/.test(callId)
  ) {
    throw new Error('invalid_realtime_provider_call_id')
  }

  const response = await fetchImpl(
    `https://api.openai.com/v1/realtime/calls/${encodeURIComponent(callId)}/hangup`,
    {
      headers: {
        Accept: '*/*',
        Authorization: `Bearer ${apiKey}`,
        'X-Client-Request-Id': crypto.randomUUID(),
      },
      method: 'POST',
      signal: AbortSignal.timeout(REALTIME_HANGUP_TIMEOUT_MS),
    },
  )

  return {
    ok: response.ok || response.status === 404 || response.status === 410,
    requestId: response.headers.get('x-request-id'),
    status: response.status,
  }
}
