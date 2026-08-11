type JsonRecord = Record<string, unknown>

const pendingRequestIds = new Map<string, string>()
const MAX_PENDING_REQUEST_IDS = 256

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
  return `${functionName}:${JSON.stringify(canonicalize(body))}`
}

function trimPendingRequests() {
  while (pendingRequestIds.size > MAX_PENDING_REQUEST_IDS) {
    const oldest = pendingRequestIds.keys().next().value
    if (typeof oldest !== 'string') return
    pendingRequestIds.delete(oldest)
  }
}

export function reserveAdminOperationRequestId(
  functionName: string,
  body: JsonRecord,
) {
  const key = requestKey(functionName, body)
  const existing = pendingRequestIds.get(key)
  if (existing) return { key, requestId: existing }

  const requestId = crypto.randomUUID()
  pendingRequestIds.set(key, requestId)
  trimPendingRequests()
  return { key, requestId }
}

export function completeAdminOperationRequestId(
  key: string,
  requestId: string,
) {
  if (pendingRequestIds.get(key) === requestId) {
    pendingRequestIds.delete(key)
  }
}

export function clearAdminOperationRequestIds() {
  pendingRequestIds.clear()
}
