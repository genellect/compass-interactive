import type { CaptionBroadcastMessage } from '../caption/captionBroadcast'
import { isCaptionBroadcastMessage } from '../caption/captionBroadcast'
import { ensureAnonymousAuthSession } from '../lib/anonymousAuth'
import { adminSupabase } from '../lib/adminAuth/adminSupabaseClient'
import { isPhase728DisplayRealtimeEnabled } from '../lib/featureFlags'
import { supabase } from '../lib/supabaseClient'
import {
  getFunctionErrorMessage,
  SUPABASE_REQUEST_TIMEOUT_MS,
} from '../repositories/supabase/requestPolicy'
import { invokeEdgeFunction } from '../repositories/supabase/transport'

const CHANNEL_JOIN_TIMEOUT_MS = 8_000
const REMOTE_CAPTION_MIN_INTERVAL_MS = 500

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
    error instanceof DisplayRealtimeClaimError &&
    error.snapshotFallbackAllowed
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

type PublisherRegistration = {
  expiresAt: number
  topic: string
}

const adminPublishers = new Map<
  string,
  Map<string, PublisherRegistration>
>()
const pendingCaptionDeltas = new Map<string, CaptionBroadcastMessage>()
const pendingCaptionTimers = new Map<string, number>()
const captionRelayQueues = new Map<string, CaptionBroadcastMessage[]>()
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
  await ensureAnonymousAuthSession()
  const { data, error } = await supabase.auth.getSession()
  if (error || !data.session?.access_token) {
    throw new Error('Realtime authentication is unavailable.')
  }
  await supabase.realtime.setAuth(data.session.access_token)
}

export async function claimDisplayRealtimeSession(input: {
  displayToken: string
  lectureSessionId: string
}): Promise<ClaimedDisplayRealtimeSession> {
  if (!isPhase728DisplayRealtimeEnabled) {
    throw new Error('Display Realtime is disabled.')
  }
  await ensureAnonymousAuthSession()
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

export function registerAdminDisplayRealtimeSession(input: {
  expiresAt: string
  lectureSessionId: string
  topic: string
}) {
  if (!isPhase728DisplayRealtimeEnabled) return
  const expiresAt = Date.parse(input.expiresAt)
  if (
    !isUuid(input.lectureSessionId) ||
    !isTopic(input.topic, input.lectureSessionId) ||
    !Number.isFinite(expiresAt) ||
    expiresAt <= Date.now()
  ) {
    return
  }

  // The server atomically replaces the previous lecture binding. Mirroring
  // that one-active-session invariant in memory prevents failed fan-out after
  // repeated Display CTA clicks.
  const lecturePublishers = new Map<string, PublisherRegistration>()
  const registration: PublisherRegistration = {
    expiresAt,
    topic: input.topic,
  }
  lecturePublishers.set(input.topic, registration)
  adminPublishers.set(input.lectureSessionId, lecturePublishers)

  window.setTimeout(
    () => {
      if (adminPublishers.get(input.lectureSessionId) !== lecturePublishers) {
        return
      }
      const current = lecturePublishers.get(input.topic)
      if (current !== registration) return
      lecturePublishers.delete(input.topic)
      if (lecturePublishers.size === 0) {
        adminPublishers.delete(input.lectureSessionId)
      }
    },
    Math.max(0, expiresAt - Date.now()),
  )
}

async function relayCaption(message: CaptionBroadcastMessage) {
  const lecturePublishers = adminPublishers.get(message.lectureSessionId)
  if (!lecturePublishers) return

  const sends = [...lecturePublishers.values()]
    .filter((registration) => registration.expiresAt > Date.now())
    .map(async (registration) => {
      const { data, error } = await adminSupabase.functions.invoke<{
        message?: string
        ok?: boolean
      }>('broadcast-display-caption', {
        body: {
          lectureSessionId: message.lectureSessionId,
          message,
          topic: registration.topic,
        },
        timeout: SUPABASE_REQUEST_TIMEOUT_MS.adminFunction,
      })
      if (error || !data?.ok) {
        // Caption relay never controls the paid provider lifecycle. The
        // completed-caption snapshot remains the bounded fallback.
        throw new Error(data?.message ?? 'Display caption relay failed.')
      }
    })
  await Promise.allSettled(sends)
}

async function sendCaptionNow(message: CaptionBroadcastMessage) {
  const streamKey = `${message.lectureSessionId}:${message.streamId}`
  if (
    message.source !== 'stopped' &&
    stoppedCaptionStreams.has(streamKey)
  ) {
    return
  }
  if (message.source === 'stopped') stoppedCaptionStreams.add(streamKey)

  const queue = captionRelayQueues.get(message.lectureSessionId) ?? []
  if (message.source === 'delta') {
    const lastDeltaIndex = queue.findLastIndex(
      (queued) =>
        queued.source === 'delta' && queued.streamId === message.streamId,
    )
    if (lastDeltaIndex >= 0) queue[lastDeltaIndex] = message
    else queue.push(message)
  } else {
    if (message.source === 'completed') {
      const pendingDeltaIndex = queue.findLastIndex(
        (queued) =>
          queued.source === 'delta' && queued.streamId === message.streamId,
      )
      if (pendingDeltaIndex >= 0) queue.splice(pendingDeltaIndex, 1)
    } else {
      for (let index = queue.length - 1; index >= 0; index -= 1) {
        if (queue[index].source === 'delta') queue.splice(index, 1)
      }
    }
    queue.push(message)
  }
  while (queue.length > 16) {
    const deltaIndex = queue.findIndex((queued) => queued.source === 'delta')
    queue.splice(deltaIndex >= 0 ? deltaIndex : 0, 1)
  }
  captionRelayQueues.set(message.lectureSessionId, queue)
  if (captionRelayInFlight.has(message.lectureSessionId)) return

  const relay = (async () => {
    while (true) {
      const activeQueue = captionRelayQueues.get(message.lectureSessionId)
      const next = activeQueue?.shift()
      if (!next) break
      await relayCaption(next)
    }
    captionRelayQueues.delete(message.lectureSessionId)
  })().finally(() => {
    captionRelayInFlight.delete(message.lectureSessionId)
  })
  captionRelayInFlight.set(message.lectureSessionId, relay)
  await relay
}

export function publishAdminCaptionRealtime(message: CaptionBroadcastMessage) {
  if (!isPhase728DisplayRealtimeEnabled) return Promise.resolve()

  if (message.source !== 'delta') {
    const timerId = pendingCaptionTimers.get(message.lectureSessionId)
    if (timerId !== undefined) window.clearTimeout(timerId)
    pendingCaptionTimers.delete(message.lectureSessionId)
    pendingCaptionDeltas.delete(message.lectureSessionId)
    return sendCaptionNow(message)
  }

  pendingCaptionDeltas.set(message.lectureSessionId, message)
  if (!pendingCaptionTimers.has(message.lectureSessionId)) {
    const timerId = window.setTimeout(() => {
      pendingCaptionTimers.delete(message.lectureSessionId)
      const pending = pendingCaptionDeltas.get(message.lectureSessionId)
      pendingCaptionDeltas.delete(message.lectureSessionId)
      if (pending) void sendCaptionNow(pending)
    }, REMOTE_CAPTION_MIN_INTERVAL_MS)
    pendingCaptionTimers.set(message.lectureSessionId, timerId)
  }
  return Promise.resolve()
}

export async function clearAdminDisplayRealtimeSessions(
  lectureSessionId: string,
) {
  const lecturePublishers = adminPublishers.get(lectureSessionId)
  adminPublishers.delete(lectureSessionId)
  const timerId = pendingCaptionTimers.get(lectureSessionId)
  if (timerId !== undefined) window.clearTimeout(timerId)
  pendingCaptionTimers.delete(lectureSessionId)
  pendingCaptionDeltas.delete(lectureSessionId)
  captionRelayQueues.delete(lectureSessionId)
  for (const key of stoppedCaptionStreams) {
    if (key.startsWith(`${lectureSessionId}:`)) stoppedCaptionStreams.delete(key)
  }
  if (lecturePublishers) lecturePublishers.clear()
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

export async function subscribeClaimedDisplayRealtimeSession(input: {
  onCaption: (message: CaptionBroadcastMessage) => void
  onConnectionStatus?: (status: string, error?: Error) => void
  onDisplayState: (message: DisplayStateRealtimeMessage) => void
  onSessionClosed: (reason: string) => void
  session: ClaimedDisplayRealtimeSession
}) {
  const { session } = input
  let lastDisplayVersion = -1
  const captionSequences = new Map<string, number>()
  let closed = false
  let expiryTimer: number | null = null

  await authorizeRealtime()
  const channel = supabase.channel(session.topic, {
    config: {
      broadcast: { ack: true, self: false },
      private: true,
    },
  })
  channel.on('broadcast', { event: 'display_state' }, ({ payload }) => {
    if (closed) return
    if (!isDisplayStateMessage(payload, session.lectureSessionId)) return
    if (payload.displayVersion <= lastDisplayVersion) return
    lastDisplayVersion = payload.displayVersion
    input.onDisplayState(payload)
  })
  channel.on('broadcast', { event: 'caption' }, ({ payload }) => {
    if (closed) return
    if (!isCaptionBroadcastMessage(payload, session.lectureSessionId)) return
    const lastSequence = captionSequences.get(payload.streamId) ?? -1
    if (payload.sequence <= lastSequence) return
    captionSequences.set(payload.streamId, payload.sequence)
    input.onCaption(payload)
  })
  channel.on('broadcast', { event: 'session_closed' }, ({ payload }) => {
    if (closed) return
    const message = payload as {
      lectureSessionId?: unknown
      reason?: unknown
    }
    if (message.lectureSessionId !== session.lectureSessionId) return
    input.onSessionClosed(
      typeof message.reason === 'string' ? message.reason : 'session_closed',
    )
    void close()
  })

  await new Promise<void>((resolve, reject) => {
    const timeoutId = window.setTimeout(() => {
      void supabase.removeChannel(channel)
      reject(new Error('Display Realtime connection timed out.'))
    }, CHANNEL_JOIN_TIMEOUT_MS)
    channel.subscribe((status, error) => {
      input.onConnectionStatus?.(status, error)
      if (status === 'SUBSCRIBED') {
        window.clearTimeout(timeoutId)
        resolve()
        return
      }
      if (
        status === 'CHANNEL_ERROR' ||
        status === 'TIMED_OUT' ||
        status === 'CLOSED'
      ) {
        window.clearTimeout(timeoutId)
        reject(
          error instanceof Error
            ? error
            : new Error('Display Realtime connection failed.'),
        )
      }
    })
  })

  const stopAt = Math.min(
    Date.parse(session.expiresAt),
    Date.parse(session.hardStopAt),
  )
  expiryTimer = window.setTimeout(
    () => {
      input.onSessionClosed('hard_stop')
      void close()
    },
    Math.max(0, stopAt - Date.now()),
  )

  async function close() {
    if (closed) return
    closed = true
    if (expiryTimer !== null) window.clearTimeout(expiryTimer)
    await supabase.removeChannel(channel)
  }

  return close
}
