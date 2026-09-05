import {
  isPresenterBridgeActivateRequest,
  isPresenterBridgeConnectRequest,
  isPresenterBridgeSessionToken,
  parsePresenterBridgeActivateResponse,
  parsePresenterBridgeConnectResponse,
  parsePresenterBridgeDisconnectResponse,
  parsePresenterBridgeErrorResponse,
  parsePresenterBridgeHealthResponse,
  parsePresenterBridgePresentationResponse,
  parsePresenterBridgeStatusResponse,
  PRESENTER_BRIDGE_BASE_URL,
  PRESENTER_BRIDGE_HEALTH_TIMEOUT_MS,
  PRESENTER_BRIDGE_MAX_RESPONSE_BYTES,
  PRESENTER_BRIDGE_REQUEST_TIMEOUT_MS,
  PRESENTER_BRIDGE_ROUTES,
  PRESENTER_BRIDGE_SESSION_HEADER,
  type PresenterBridgeActivateRequest,
  type PresenterBridgeActivateResponse,
  type PresenterBridgeConnectRequest,
  type PresenterBridgeConnectResponse,
  type PresenterBridgeDisconnectResponse,
  type PresenterBridgeHealthResponse,
  type PresenterBridgePresentationResponse,
  type PresenterBridgeStatusResponse,
} from './presenterBridgeProtocol.ts'

type PresenterBridgeFetch = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>

type PresenterBridgeRoute =
  (typeof PRESENTER_BRIDGE_ROUTES)[keyof typeof PRESENTER_BRIDGE_ROUTES]

type ResponseParser<T> = (value: unknown) => T | null

const safeErrorMessages: Readonly<Record<string, string>> = {
  bridge_unavailable: 'Presenter Bridge is not available.',
  connector_conflict: 'Another PowerPoint presentation is already connected.',
  current_slide_order_mismatch:
    'The current PowerPoint slide order is not supported.',
  custom_or_partial_show_unsupported:
    'Custom or partial PowerPoint shows are not supported.',
  hidden_slides_unsupported: 'Hidden PowerPoint slides are not supported.',
  invalid_request: 'Presenter Bridge rejected the request.',
  invalid_session: 'Presenter Bridge session is no longer valid.',
  multiple_slide_shows: 'Close the other PowerPoint slide show and try again.',
  origin_not_allowed: 'This site is not allowed to use Presenter Bridge.',
  page_count_mismatch:
    'The PowerPoint slide count does not match the lecture material.',
  pairing_rate_limited: 'Wait briefly before trying to connect again.',
  powerpoint_not_running: 'Start the PowerPoint slide show and try again.',
  presenter_view_must_be_disabled: 'Turn off Presenter View before connecting.',
  presentation_changed: 'The PowerPoint presentation changed.',
  request_timeout: 'Presenter Bridge did not respond in time.',
  slide_id_order_invalid: 'The PowerPoint slide order is not supported.',
  ticket_invalid: 'The connection request expired. Start again.',
  windowed_slide_show_required:
    'Use a normal full-screen or windowed PowerPoint slide show before connecting.',
}

export class PresenterBridgeClientError extends Error {
  readonly code: string
  readonly status: number | null

  constructor(code: string, message: string, status: number | null = null) {
    super(message)
    this.name = 'PresenterBridgeClientError'
    this.code = code
    this.status = status
  }
}

function safeBridgeErrorMessage(code: string) {
  return (
    safeErrorMessages[code] ??
    'Presenter Bridge could not complete the request.'
  )
}

function endpoint(route: PresenterBridgeRoute) {
  return `${PRESENTER_BRIDGE_BASE_URL}${route}`
}

function responseByteLength(value: string) {
  return new TextEncoder().encode(value).byteLength
}

function sessionHeaders(sessionToken: string): HeadersInit {
  if (!isPresenterBridgeSessionToken(sessionToken)) {
    throw new PresenterBridgeClientError(
      'invalid_session',
      safeBridgeErrorMessage('invalid_session'),
    )
  }
  return { [PRESENTER_BRIDGE_SESSION_HEADER]: sessionToken }
}

function isAbortError(error: unknown) {
  return (
    (error instanceof DOMException && error.name === 'AbortError') ||
    (error instanceof Error && error.name === 'AbortError')
  )
}

async function readJsonResponse(response: Response) {
  const contentType = response.headers.get('content-type') ?? ''
  const cacheControl = response.headers.get('cache-control') ?? ''
  if (
    !contentType.toLowerCase().includes('application/json') ||
    !cacheControl.toLowerCase().includes('no-store')
  ) {
    throw new PresenterBridgeClientError(
      'invalid_response',
      'Presenter Bridge returned an invalid response.',
      response.status || null,
    )
  }

  const declaredLength = Number(response.headers.get('content-length'))
  if (
    Number.isFinite(declaredLength) &&
    declaredLength > PRESENTER_BRIDGE_MAX_RESPONSE_BYTES
  ) {
    throw new PresenterBridgeClientError(
      'response_too_large',
      'Presenter Bridge returned an invalid response.',
      response.status || null,
    )
  }

  const text = await response.text()
  if (responseByteLength(text) > PRESENTER_BRIDGE_MAX_RESPONSE_BYTES) {
    throw new PresenterBridgeClientError(
      'response_too_large',
      'Presenter Bridge returned an invalid response.',
      response.status || null,
    )
  }

  try {
    return JSON.parse(text) as unknown
  } catch {
    throw new PresenterBridgeClientError(
      'invalid_response',
      'Presenter Bridge returned an invalid response.',
      response.status || null,
    )
  }
}

export class PresenterBridgeClient {
  private readonly fetchImpl: PresenterBridgeFetch

  constructor(
    fetchImpl: PresenterBridgeFetch = globalThis.fetch.bind(globalThis),
  ) {
    this.fetchImpl = fetchImpl
  }

  private async request<T>(input: {
    body?: PresenterBridgeActivateRequest | PresenterBridgeConnectRequest
    headers?: HeadersInit
    method: 'GET' | 'POST'
    parse: ResponseParser<T>
    route: PresenterBridgeRoute
    timeoutMs: number
  }): Promise<T> {
    const controller = new AbortController()
    const timeoutId = globalThis.setTimeout(
      () => controller.abort(),
      input.timeoutMs,
    )

    try {
      const headers = new Headers(input.headers)
      if (input.body) headers.set('Content-Type', 'application/json')

      const response = await this.fetchImpl(endpoint(input.route), {
        body: input.body ? JSON.stringify(input.body) : undefined,
        cache: 'no-store',
        credentials: 'omit',
        headers,
        keepalive: false,
        method: input.method,
        mode: 'cors',
        redirect: 'manual',
        referrerPolicy: 'no-referrer',
        signal: controller.signal,
      })

      if (
        response.type === 'opaqueredirect' ||
        response.status === 0 ||
        (response.status >= 300 && response.status < 400)
      ) {
        throw new PresenterBridgeClientError(
          'redirect_rejected',
          'Presenter Bridge returned an invalid response.',
          response.status || null,
        )
      }

      const payload = await readJsonResponse(response)
      if (!response.ok) {
        const errorPayload = parsePresenterBridgeErrorResponse(payload)
        const errorCode = errorPayload?.code ?? 'bridge_request_failed'
        throw new PresenterBridgeClientError(
          errorCode,
          safeBridgeErrorMessage(errorCode),
          response.status,
        )
      }

      const parsed = input.parse(payload)
      if (!parsed) {
        throw new PresenterBridgeClientError(
          'invalid_response',
          'Presenter Bridge returned an invalid response.',
          response.status,
        )
      }
      return parsed
    } catch (error) {
      if (error instanceof PresenterBridgeClientError) throw error
      if (isAbortError(error)) {
        throw new PresenterBridgeClientError(
          'request_timeout',
          'Presenter Bridge did not respond in time.',
        )
      }
      throw new PresenterBridgeClientError(
        'bridge_unavailable',
        safeBridgeErrorMessage('bridge_unavailable'),
      )
    } finally {
      globalThis.clearTimeout(timeoutId)
    }
  }

  health(): Promise<PresenterBridgeHealthResponse> {
    return this.request({
      method: 'GET',
      parse: parsePresenterBridgeHealthResponse,
      route: PRESENTER_BRIDGE_ROUTES.health,
      timeoutMs: PRESENTER_BRIDGE_HEALTH_TIMEOUT_MS,
    })
  }

  connect(
    request: PresenterBridgeConnectRequest,
  ): Promise<PresenterBridgeConnectResponse> {
    if (!isPresenterBridgeConnectRequest(request)) {
      throw new PresenterBridgeClientError(
        'invalid_request',
        safeBridgeErrorMessage('invalid_request'),
      )
    }
    return this.request({
      body: request,
      method: 'POST',
      parse: parsePresenterBridgeConnectResponse,
      route: PRESENTER_BRIDGE_ROUTES.connect,
      timeoutMs: PRESENTER_BRIDGE_REQUEST_TIMEOUT_MS,
    })
  }

  activate(
    sessionToken: string,
    bindingDigest: string,
  ): Promise<PresenterBridgeActivateResponse> {
    const request: PresenterBridgeActivateRequest = {
      action: 'activate',
      bindingDigest,
    }
    if (!isPresenterBridgeActivateRequest(request)) {
      throw new PresenterBridgeClientError(
        'invalid_request',
        safeBridgeErrorMessage('invalid_request'),
      )
    }
    return this.request({
      body: request,
      headers: sessionHeaders(sessionToken),
      method: 'POST',
      parse: parsePresenterBridgeActivateResponse,
      route: PRESENTER_BRIDGE_ROUTES.connect,
      timeoutMs: PRESENTER_BRIDGE_REQUEST_TIMEOUT_MS,
    })
  }

  getPresentation(
    sessionToken: string,
  ): Promise<PresenterBridgePresentationResponse> {
    return this.request({
      headers: sessionHeaders(sessionToken),
      method: 'GET',
      parse: parsePresenterBridgePresentationResponse,
      route: PRESENTER_BRIDGE_ROUTES.presentation,
      timeoutMs: PRESENTER_BRIDGE_REQUEST_TIMEOUT_MS,
    })
  }

  getStatus(sessionToken: string): Promise<PresenterBridgeStatusResponse> {
    return this.request({
      headers: sessionHeaders(sessionToken),
      method: 'GET',
      parse: parsePresenterBridgeStatusResponse,
      route: PRESENTER_BRIDGE_ROUTES.status,
      timeoutMs: PRESENTER_BRIDGE_REQUEST_TIMEOUT_MS,
    })
  }

  disconnect(sessionToken: string): Promise<PresenterBridgeDisconnectResponse> {
    return this.request({
      headers: sessionHeaders(sessionToken),
      method: 'POST',
      parse: parsePresenterBridgeDisconnectResponse,
      route: PRESENTER_BRIDGE_ROUTES.disconnect,
      timeoutMs: PRESENTER_BRIDGE_REQUEST_TIMEOUT_MS,
    })
  }
}

export const presenterBridgeClient = new PresenterBridgeClient()
