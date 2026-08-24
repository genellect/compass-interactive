import type { CaptionBroadcastMessage } from '../caption/captionBroadcast'
import { isCaptionBroadcastMessage } from '../caption/captionBroadcast'
import type { AdminOperationCredentialInput } from '../lib/adminAuth/adminOperationCredential'
import { adminSupabase } from '../lib/adminAuth/adminSupabaseClient'
import {
  displaySupabase,
  ensureDisplayAnonymousAuthSession,
} from '../lib/displaySupabaseClient'
import { isPhase728DisplayRealtimeEnabled } from '../lib/featureFlags'
import {
  getFunctionErrorMessage,
  SUPABASE_REQUEST_TIMEOUT_MS,
} from '../repositories/supabase/requestPolicy'
import { invokeEdgeFunction } from '../repositories/supabase/transport'

const CHANNEL_JOIN_TIMEOUT_MS = 8_000
const DISPLAY_HEARTBEAT_INTERVAL_MS = 10_000
const RECONNECT_BACKOFF_MS = [1_000, 2_000, 4_000, 8_000, 15_000] as const
const REMOTE_CAPTION_MIN_INTERVAL_MS = 500

export type AdminCaptionRelayAuthority = {
  operationId: string
  startRequestId: string
}

type QueuedCaptionRelay = {
  authority: AdminCaptionRelayAuthority
  message: CaptionBroadcastMessage
}

class DisplayRealtimeClaimError extends Error {
  readonly snapshotFallbackAllowed: boolean

  constructor(message: string, snapshotFallbackAllowed: boolean) {
    super(message)
    this.name = 'DisplayRealtimeClaimError'
    this.snapshotFallbackAllowed = snapshotFallbackAllowed
  }
}

export function canFallbackFromDisplayRealtimeClaim(error: unknown) {
  return (
    error instanceof DisplayRealtimeClaimError && error.snapshotFallbackAllowed
  )
}

type ClaimResponse = {
  expiresAt?: string
  hardStopAt?: string
  lectureSessionId?: string
  message?: string
  ok?: boolean
  sessionId?: string
  topic?: string
}

export type ClaimedDisplayRealtimeSession = {
  connectionGeneration?: number
  expiresAt: string
  hardStopAt: string
  lectureSessionId: string
  sessionId: string
  topic: string
}

export type DisplayStateRealtimeMessage = {
  currentPdfPage: number
  displayVersion: number
  lectureSessionId: string
  sentAt: string
}

type DisplayLiveStateVersionKey =
  | 'caption'
  | 'comments'
  | 'display'
  | 'lecture'
  | 'likes'
  | 'metrics'
  | 'pdf'
  | 'polls'
  | 'summaries'

export type DisplayLiveStateVersionVector = Record<
  DisplayLiveStateVersionKey,
  number
>

export type DisplayLiveStateChangedMessage = {
  changeKinds: DisplayLiveStateVersionKey[]
  lectureSessionId: string
  sentAt: string
  sessionId: string
  versions: DisplayLiveStateVersionVector
}

const pendingCaptionDeltas = new Map<string, QueuedCaptionRelay>()
const pendingCaptionTimers = new Map<string, number>()
const captionRelayQueues = new Map<string, QueuedCaptionRelay[]>()
const captionRelayInFlight = new Map<string, Promise<void>>()
const stoppedCaptionStreams = new Set<string>()

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  )
}

function isTopic(value: string, lectureSessionId: string) {
  return new RegExp(
    `^display:${lectureSessionId.replaceAll('-', '\\-')}:[0-9a-f-]{36}$`,
    'i',
  ).test(value)
}

async function authorizeRealtime() {
  await ensureDisplayAnonymousAuthSession()
  const { data, error } = await displaySupabase.auth.getSession()
  if (error || !data.session?.access_token) {
    throw new Error('Realtime authentication is unavailable.')
  }
  await displaySupabase.realtime.setAuth(data.session.access_token)
}

export async function claimDisplayRealtimeSession(input: {
  displayToken: string
  lectureSessionId: string
}): Promise<ClaimedDisplayRealtimeSession> {
  if (!isPhase728DisplayRealtimeEnabled) {
    throw new Error('Display Realtime is disabled.')
  }
  await ensureDisplayAnonymousAuthSession()
  const { data, error } = await invokeEdgeFunction<ClaimResponse>(
    'claim-display-realtime-session',
    {
      body: input,
      timeout: SUPABASE_REQUEST_TIMEOUT_MS.adminFunction,
    },
  )
  if (error) {
    const context = (error as { context?: unknown }).context
    const status = context instanceof Response ? context.status : null
    throw new DisplayRealtimeClaimError(
      await getFunctionErrorMessage(
        error,
        'Display Realtime could not be claimed.',
      ),
      status === 404 || status === 503,
    )
  }
  if (
    !data?.ok ||
    data.lectureSessionId !== input.lectureSessionId ||
    !data.sessionId ||
    !isUuid(data.sessionId) ||
    !data.topic ||
    !isTopic(data.topic, input.lectureSessionId) ||
    !data.expiresAt ||
    !data.hardStopAt
  ) {
    throw new Error(data?.message ?? 'Display Realtime claim is invalid.')
  }
  return {
    expiresAt: data.expiresAt,
    hardStopAt: data.hardStopAt,
    lectureSessionId: data.lectureSessionId,
    sessionId: data.sessionId,
    topic: data.topic,
  }
}

async function relayCaption(
  message: CaptionBroadcastMessage,
  adminToken: AdminOperationCredentialInput,
  authority: AdminCaptionRelayAuthority,
) {
  const { data, error } = await adminSupabase.functions.invoke<{
    message?: string
    ok?: boolean
  }>('broadcast-display-caption', {
    body: {
      appSessionToken: adminToken.appSessionToken,
      lectureSessionId: message.lectureSessionId,
      message,
      operationId: authority.operationId,
      startRequestId: authority.startRequestId,
    },
    timeout: SUPABASE_REQUEST_TIMEOUT_MS.adminFunction,
  })
  if (error || !data?.ok) {
    // Caption relay never controls the paid provider lifecycle. The
    // completed-caption snapshot remains the bounded fallback.
    throw new Error(data?.message ?? 'Display caption relay failed.')
  }
}

async function sendCaptionNow(
  message: CaptionBroadcastMessage,
  adminToken: AdminOperationCredentialInput,
  authority: AdminCaptionRelayAuthority,
) {
  const streamKey = `${message.lectureSessionId}:${message.streamId}`
  if (message.source !== 'stopped' && stoppedCaptionStreams.has(streamKey)) {
    return
  }
  if (message.source === 'stopped') stoppedCaptionStreams.add(streamKey)

  const queue = captionRelayQueues.get(message.lectureSessionId) ?? []
  if (message.source === 'delta') {
    const lastDeltaIndex = queue.findLastIndex(
      (queued) =>
        queued.message.source === 'delta' &&
        queued.message.streamId === message.streamId,
    )
    if (lastDeltaIndex >= 0) queue[lastDeltaIndex] = { authority, message }
    else queue.push({ authority, message })
  } else {
    if (message.source === 'completed') {
      const pendingDeltaIndex = queue.findLastIndex(
        (queued) =>
          queued.message.source === 'delta' &&
          queued.message.streamId === message.streamId,
      )
      if (pendingDeltaIndex >= 0) queue.splice(pendingDeltaIndex, 1)
    } else {
      for (let index = queue.length - 1; index >= 0; index -= 1) {
        if (queue[index].message.source === 'delta') queue.splice(index, 1)
      }
    }
    queue.push({ authority, message })
  }
  while (queue.length > 16) {
    const deltaIndex = queue.findIndex(
      (queued) => queued.message.source === 'delta',
    )
    queue.splice(deltaIndex >= 0 ? deltaIndex : 0, 1)
  }
  captionRelayQueues.set(message.lectureSessionId, queue)
  if (captionRelayInFlight.has(message.lectureSessionId)) return

  const relay = (async () => {
    while (true) {
      const activeQueue = captionRelayQueues.get(message.lectureSessionId)
      const next = activeQueue?.shift()
      if (!next) break
      await relayCaption(next.message, adminToken, next.authority)
    }
    captionRelayQueues.delete(message.lectureSessionId)
  })().finally(() => {
    captionRelayInFlight.delete(message.lectureSessionId)
  })
  captionRelayInFlight.set(message.lectureSessionId, relay)
  await relay
}

export function publishAdminCaptionRealtime(
  message: CaptionBroadcastMessage,
  adminToken: AdminOperationCredentialInput,
  authority: AdminCaptionRelayAuthority,
) {
  if (!isPhase728DisplayRealtimeEnabled) return Promise.resolve()

  if (message.source !== 'delta') {
    const timerId = pendingCaptionTimers.get(message.lectureSessionId)
    if (timerId !== undefined) window.clearTimeout(timerId)
    pendingCaptionTimers.delete(message.lectureSessionId)
    pendingCaptionDeltas.delete(message.lectureSessionId)
    return sendCaptionNow(message, adminToken, authority)
  }

  pendingCaptionDeltas.set(message.lectureSessionId, { authority, message })
  if (!pendingCaptionTimers.has(message.lectureSessionId)) {
    const timerId = window.setTimeout(() => {
      pendingCaptionTimers.delete(message.lectureSessionId)
      const pending = pendingCaptionDeltas.get(message.lectureSessionId)
      pendingCaptionDeltas.delete(message.lectureSessionId)
      if (pending) {
        void sendCaptionNow(pending.message, adminToken, pending.authority)
      }
    }, REMOTE_CAPTION_MIN_INTERVAL_MS)
    pendingCaptionTimers.set(message.lectureSessionId, timerId)
  }
  return Promise.resolve()
}

export async function clearAdminDisplayRealtimeSessions(
  lectureSessionId: string,
) {
  const timerId = pendingCaptionTimers.get(lectureSessionId)
  if (timerId !== undefined) window.clearTimeout(timerId)
  pendingCaptionTimers.delete(lectureSessionId)
  pendingCaptionDeltas.delete(lectureSessionId)
  captionRelayQueues.delete(lectureSessionId)
  for (const key of stoppedCaptionStreams) {
    if (key.startsWith(`${lectureSessionId}:`))
      stoppedCaptionStreams.delete(key)
  }
}

function isDisplayStateMessage(
  value: unknown,
  lectureSessionId: string,
): value is DisplayStateRealtimeMessage {
  if (!value || typeof value !== 'object') return false
  const message = value as Partial<DisplayStateRealtimeMessage>
  return (
    message.lectureSessionId === lectureSessionId &&
    typeof message.currentPdfPage === 'number' &&
    Number.isSafeInteger(message.currentPdfPage) &&
    message.currentPdfPage >= 1 &&
    typeof message.displayVersion === 'number' &&
    Number.isSafeInteger(message.displayVersion) &&
    message.displayVersion >= 0 &&
    typeof message.sentAt === 'string' &&
    Number.isFinite(Date.parse(message.sentAt))
  )
}

const DISPLAY_LIVE_STATE_VERSION_KEYS = [
  'caption',
  'comments',
  'display',
  'lecture',
  'likes',
  'metrics',
  'pdf',
  'polls',
  'summaries',
] as const satisfies readonly DisplayLiveStateVersionKey[]

function isDisplayLiveStateChangedMessage(
  value: unknown,
  session: ClaimedDisplayRealtimeSession,
): value is DisplayLiveStateChangedMessage {
  if (!value || typeof value !== 'object') return false
  const message = value as Partial<DisplayLiveStateChangedMessage>
  if (
    message.lectureSessionId !== session.lectureSessionId ||
    message.sessionId !== session.sessionId ||
    !Array.isArray(message.changeKinds) ||
    message.changeKinds.length < 1 ||
    message.changeKinds.some(
      (kind) => !DISPLAY_LIVE_STATE_VERSION_KEYS.includes(kind),
    ) ||
    !message.versions ||
    typeof message.versions !== 'object' ||
    typeof message.sentAt !== 'string' ||
    !Number.isFinite(Date.parse(message.sentAt))
  ) {
    return false
  }
  return DISPLAY_LIVE_STATE_VERSION_KEYS.every((key) => {
    const version = message.versions?.[key]
    return (
      typeof version === 'number' &&
      Number.isSafeInteger(version) &&
      version >= 0
    )
  })
}

function advanceVersionVector(
  current: DisplayLiveStateVersionVector | null,
  next: DisplayLiveStateVersionVector,
) {
  if (
    current &&
    DISPLAY_LIVE_STATE_VERSION_KEYS.every((key) => next[key] <= current[key])
  ) {
    return null
  }
  return Object.fromEntries(
    DISPLAY_LIVE_STATE_VERSION_KEYS.map((key) => [
      key,
      Math.max(current?.[key] ?? -1, next[key]),
    ]),
  ) as DisplayLiveStateVersionVector
}

export async function subscribeClaimedDisplayRealtimeSession(input: {
  onCaption: (message: CaptionBroadcastMessage) => void
  onConnectionStatus?: (status: string, error?: Error) => void
  onDisplayState: (message: DisplayStateRealtimeMessage) => void
  onLiveStateChanged: (message: DisplayLiveStateChangedMessage) => void
  onSessionClosed: (reason: string) => void
  session: ClaimedDisplayRealtimeSession
}) {
  const { session } = input
  let lastDisplayVersion = -1
  let lastVersionVector: DisplayLiveStateVersionVector | null = null
  const captionSequences = new Map<string, number>()
  let closed = false
  const stopAt = Math.min(
    Date.parse(session.expiresAt),
    Date.parse(session.hardStopAt),
  )
  if (!Number.isFinite(stopAt) || stopAt <= Date.now()) {
    throw new Error('Display Realtime session has expired.')
  }

  type DisplayChannel = ReturnType<typeof displaySupabase.channel>
  let activeChannel: DisplayChannel | null = null
  let reconnectTimer: number | null = null
  let reconnectAttempt = 0
  let connectInFlight = false
  const expiryTimer = window.setTimeout(
    () => {
      input.onSessionClosed(
        Date.parse(session.hardStopAt) <= Date.parse(session.expiresAt)
          ? 'hard_stop'
          : 'expired',
      )
      void close()
    },
    Math.max(0, stopAt - Date.now()),
  )

  function scheduleReconnect(error: Error) {
    if (closed || reconnectTimer !== null) return
    if (Date.now() >= stopAt) {
      input.onSessionClosed('hard_stop')
      void close()
      return
    }
    const delay =
      RECONNECT_BACKOFF_MS[
        Math.min(reconnectAttempt, RECONNECT_BACKOFF_MS.length - 1)
      ]
    reconnectAttempt += 1
    input.onConnectionStatus?.('RECONNECTING', error)
    reconnectTimer = window.setTimeout(
      () => {
        reconnectTimer = null
        void connect()
      },
      Math.min(delay, Math.max(0, stopAt - Date.now())),
    )
  }

  function retireChannel(channel: DisplayChannel, error: Error) {
    if (closed || activeChannel !== channel) return
    activeChannel = null
    void displaySupabase.removeChannel(channel)
    scheduleReconnect(error)
  }

  async function connect() {
    if (closed || connectInFlight || activeChannel) return
    connectInFlight = true
    try {
      await authorizeRealtime()
      if (closed) return

      const channel = displaySupabase.channel(session.topic, {
        config: {
          broadcast: { ack: true, self: false },
          private: true,
        },
      })
      activeChannel = channel
      channel.on('broadcast', { event: 'display_state' }, ({ payload }) => {
        if (closed || activeChannel !== channel) return
        if (!isDisplayStateMessage(payload, session.lectureSessionId)) return
        if (payload.displayVersion <= lastDisplayVersion) return
        lastDisplayVersion = payload.displayVersion
        input.onDisplayState(payload)
      })
      channel.on(
        'broadcast',
        { event: 'live_state_changed' },
        ({ payload }) => {
          if (closed || activeChannel !== channel) return
          if (!isDisplayLiveStateChangedMessage(payload, session)) return
          const advanced = advanceVersionVector(
            lastVersionVector,
            payload.versions,
          )
          if (!advanced) return
          lastVersionVector = advanced
          input.onLiveStateChanged(payload)
        },
      )
      channel.on('broadcast', { event: 'caption' }, ({ payload }) => {
        if (closed || activeChannel !== channel) return
        if (!isCaptionBroadcastMessage(payload, session.lectureSessionId)) {
          return
        }
        const lastSequence = captionSequences.get(payload.streamId) ?? -1
        if (payload.sequence <= lastSequence) return
        captionSequences.set(payload.streamId, payload.sequence)
        input.onCaption(payload)
      })
      channel.on('broadcast', { event: 'session_closed' }, ({ payload }) => {
        if (closed || activeChannel !== channel) return
        const message = payload as {
          lectureSessionId?: unknown
          reason?: unknown
        }
        if (message.lectureSessionId !== session.lectureSessionId) return
        input.onSessionClosed(
          typeof message.reason === 'string'
            ? message.reason
            : 'session_closed',
        )
        void close()
      })

      const timeoutId = window.setTimeout(() => {
        retireChannel(
          channel,
          new Error('Display Realtime connection timed out.'),
        )
      }, CHANNEL_JOIN_TIMEOUT_MS)
      channel.subscribe((status, error) => {
        if (closed || activeChannel !== channel) return
        input.onConnectionStatus?.(status, error)
        if (status === 'SUBSCRIBED') {
          window.clearTimeout(timeoutId)
          reconnectAttempt = 0
          return
        }
        if (
          status === 'CHANNEL_ERROR' ||
          status === 'TIMED_OUT' ||
          status === 'CLOSED'
        ) {
          window.clearTimeout(timeoutId)
          retireChannel(
            channel,
            error instanceof Error
              ? error
              : new Error('Display Realtime connection failed.'),
          )
        }
      })
    } catch (error) {
      scheduleReconnect(
        error instanceof Error
          ? error
          : new Error('Display Realtime connection failed.'),
      )
    } finally {
      connectInFlight = false
    }
  }

  async function close() {
    if (closed) return
    closed = true
    window.clearTimeout(expiryTimer)
    if (reconnectTimer !== null) window.clearTimeout(reconnectTimer)
    const channel = activeChannel
    activeChannel = null
    if (channel) await displaySupabase.removeChannel(channel)
  }

  void connect()
  return close
}

type DisplayDeliverySignalResponse = {
  displayVersion?: number
  message?: string
  ok?: boolean
  renderedPage?: number
  serverTime?: string
}

async function sendDisplayDeliverySignal(input: {
  action: 'heartbeat' | 'rendered'
  displayToken: string
  displayUpdatedAt?: string
  renderedPage?: number
  session: ClaimedDisplayRealtimeSession
}) {
  const { data, error } =
    await invokeEdgeFunction<DisplayDeliverySignalResponse>(
      'display-session-status',
      {
        body: {
          action: input.action,
          connectionGeneration: input.session.connectionGeneration,
          displayToken: input.displayToken,
          ...(input.action === 'rendered'
            ? {
                displayUpdatedAt: input.displayUpdatedAt,
                renderedPage: input.renderedPage,
              }
            : {}),
          lectureSessionId: input.session.lectureSessionId,
          sessionId: input.session.sessionId,
        },
        timeout: SUPABASE_REQUEST_TIMEOUT_MS.adminFunction,
      },
    )
  if (error || !data?.ok) {
    throw new Error(
      error
        ? await getFunctionErrorMessage(
            error,
            'Display delivery report failed.',
          )
        : (data?.message ?? 'Display delivery report failed.'),
    )
  }
  return data
}

export function createDisplaySessionReporter(input: {
  displayToken: string
  onStatus?: (status: 'error' | 'ready', error?: Error) => void
  session: ClaimedDisplayRealtimeSession
}) {
  let closed = false
  let ready = false
  let renderInFlight = false
  let heartbeatInFlight = false
  let heartbeatTimer: number | null = null
  let renderRetryAttempt = 0
  let renderRetryTimer: number | null = null
  let pendingRender: { displayUpdatedAt: string; renderedPage: number } | null =
    null

  function ensureHeartbeat() {
    if (heartbeatTimer !== null) return
    heartbeatTimer = window.setInterval(() => {
      if (closed || !ready || renderInFlight || heartbeatInFlight) {
        return
      }
      heartbeatInFlight = true
      void sendDisplayDeliverySignal({
        action: 'heartbeat',
        displayToken: input.displayToken,
        session: input.session,
      })
        .catch((error: unknown) => {
          input.onStatus?.(
            'error',
            error instanceof Error
              ? error
              : new Error('Display heartbeat failed.'),
          )
        })
        .finally(() => {
          heartbeatInFlight = false
        })
    }, DISPLAY_HEARTBEAT_INTERVAL_MS)
  }

  async function flushRender() {
    if (closed || renderInFlight || !pendingRender) return
    const rendered = pendingRender
    pendingRender = null
    renderInFlight = true
    try {
      await sendDisplayDeliverySignal({
        action: 'rendered',
        displayToken: input.displayToken,
        ...rendered,
        session: input.session,
      })
      ready = true
      renderRetryAttempt = 0
      ensureHeartbeat()
      input.onStatus?.('ready')
    } catch (error) {
      if (
        !closed &&
        Date.now() <
          Math.min(
            Date.parse(input.session.expiresAt),
            Date.parse(input.session.hardStopAt),
          )
      ) {
        pendingRender ??= rendered
        const retryDelay =
          RECONNECT_BACKOFF_MS[
            Math.min(renderRetryAttempt, RECONNECT_BACKOFF_MS.length - 1)
          ]
        renderRetryAttempt += 1
        if (renderRetryTimer === null) {
          renderRetryTimer = window.setTimeout(() => {
            renderRetryTimer = null
            void flushRender()
          }, retryDelay)
        }
      }
      input.onStatus?.(
        'error',
        error instanceof Error
          ? error
          : new Error('Display render acknowledgement failed.'),
      )
    } finally {
      renderInFlight = false
      if (pendingRender && renderRetryTimer === null) void flushRender()
    }
  }

  return {
    close() {
      closed = true
      pendingRender = null
      if (heartbeatTimer !== null) window.clearInterval(heartbeatTimer)
      if (renderRetryTimer !== null) window.clearTimeout(renderRetryTimer)
    },
    reportRendered(rendered: {
      displayUpdatedAt: string
      renderedPage: number
    }) {
      if (
        closed ||
        !Number.isFinite(Date.parse(rendered.displayUpdatedAt)) ||
        !Number.isSafeInteger(rendered.renderedPage) ||
        rendered.renderedPage < 1
      ) {
        return
      }
      pendingRender = rendered
      if (renderRetryTimer !== null) {
        window.clearTimeout(renderRetryTimer)
        renderRetryTimer = null
      }
      void flushRender()
    },
  }
}
