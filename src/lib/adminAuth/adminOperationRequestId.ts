type JsonRecord = Record<string, unknown>

const STORAGE_KEY = 'compass-admin-operation-requests-v1'
const REQUEST_TTL_MS = 15 * 60 * 1_000
const pendingRequestIds = new Map<
  string,
  { createdAt: number; requestId: string }
>()
const MAX_PENDING_REQUEST_IDS = 256
let hydrated = false

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (!value || typeof value !== 'object') return value

  const record = value as JsonRecord
  return Object.fromEntries(
    Object.keys(record)
      .filter((key) => record[key] !== undefined)
      .sort()
      .map((key) => [key, canonicalize(record[key])]),
  )
}

function requestKey(functionName: string, body: JsonRecord) {
  const value = JSON.stringify(canonicalize(body))
  let first = 0x811c9dc5
  let second = 0x9e3779b9
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    first = Math.imul(first ^ code, 0x01000193)
    second = Math.imul(second ^ code, 33) ^ (index + 1)
  }
  return `${functionName}:${value.length}:${first >>> 0}:${second >>> 0}`
}

function storage() {
  if (typeof window === 'undefined') return null
  try {
    return window.sessionStorage
  } catch {
    return null
  }
}

function persistPendingRequests() {
  try {
    storage()?.setItem(
      STORAGE_KEY,
      JSON.stringify(
        [...pendingRequestIds].map(([key, value]) => ({ key, ...value })),
      ),
    )
  } catch {
    // Request IDs remain valid in memory if tab storage is unavailable.
  }
}

function hydratePendingRequests() {
  if (hydrated) return
  hydrated = true
  try {
    const rows = JSON.parse(storage()?.getItem(STORAGE_KEY) ?? '[]') as Array<{
      createdAt?: unknown
      key?: unknown
      requestId?: unknown
    }>
    const cutoff = Date.now() - REQUEST_TTL_MS
    for (const row of rows) {
      if (
        typeof row.key === 'string' &&
        typeof row.requestId === 'string' &&
        typeof row.createdAt === 'number' &&
        row.createdAt >= cutoff
      ) {
        pendingRequestIds.set(row.key, {
          createdAt: row.createdAt,
          requestId: row.requestId,
        })
      }
    }
  } catch {
    try {
      storage()?.removeItem(STORAGE_KEY)
    } catch {
      // Ignore malformed or inaccessible tab storage.
    }
  }
}

function trimPendingRequests() {
  const cutoff = Date.now() - REQUEST_TTL_MS
  for (const [key, value] of pendingRequestIds) {
    if (value.createdAt < cutoff) pendingRequestIds.delete(key)
  }
  while (pendingRequestIds.size > MAX_PENDING_REQUEST_IDS) {
    const oldest = pendingRequestIds.keys().next().value
    if (typeof oldest !== 'string') return
    pendingRequestIds.delete(oldest)
  }
}

export function reserveAdminOperationRequestId(
  functionName: string,
  body: JsonRecord,
  preferredRequestId?: string,
) {
  hydratePendingRequests()
  trimPendingRequests()
  const key = requestKey(functionName, body)
  const existing = pendingRequestIds.get(key)
  if (existing) return { key, requestId: existing.requestId }

  const requestId = preferredRequestId ?? crypto.randomUUID()
  pendingRequestIds.set(key, { createdAt: Date.now(), requestId })
  trimPendingRequests()
  persistPendingRequests()
  return { key, requestId }
}

export function completeAdminOperationRequestId(
  key: string,
  requestId: string,
) {
  hydratePendingRequests()
  if (pendingRequestIds.get(key)?.requestId === requestId) {
    pendingRequestIds.delete(key)
    persistPendingRequests()
  }
}

export function clearAdminOperationRequestIds() {
  pendingRequestIds.clear()
  hydrated = true
  try {
    storage()?.removeItem(STORAGE_KEY)
  } catch {
    // Best-effort cleanup only.
  }
}
