export const DEFAULT_REALTIME_TRANSCRIPTION_MODEL = 'gpt-realtime-whisper'
export const DEFAULT_REALTIME_PRICE_MICROUSD_PER_MINUTE = 17_000

export type RealtimeTranscriptionDelay =
  'minimal' | 'low' | 'medium' | 'high' | 'xhigh'

export type RealtimeClientSecret = {
  expiresAt: number | null
  requestId: string | null
  value: string
}

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

export async function createOpenAiRealtimeClientSecret({
  apiKey,
  fetchImpl = fetch,
  safetyIdentifier,
  sessionConfig,
}: {
  apiKey: string
  fetchImpl?: typeof fetch
  safetyIdentifier: string
  sessionConfig: ReturnType<typeof createRealtimeTranscriptionSessionConfig>
}): Promise<RealtimeClientSecret> {
  const response = await fetchImpl(
    'https://api.openai.com/v1/realtime/client_secrets',
    {
      body: JSON.stringify(sessionConfig),
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'OpenAI-Safety-Identifier': safetyIdentifier,
      },
      method: 'POST',
    },
  )

  if (!response.ok) {
    throw new Error(`openai_http_${response.status}`)
  }

  const payload = (await response.json()) as {
    expires_at?: number
    value?: string
  }
  if (!payload.value || typeof payload.value !== 'string') {
    throw new Error('openai_invalid_client_secret_response')
  }

  return {
    expiresAt:
      typeof payload.expires_at === 'number' ? payload.expires_at : null,
    requestId: response.headers.get('x-request-id'),
    value: payload.value,
  }
}
