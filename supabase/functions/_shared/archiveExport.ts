export type ArchiveExportClaimIdentity = {
  lectureSessionId: string
  sourceVersion: number
}

export type PublicLectureArchivePayload = {
  academic_answers: unknown[]
  archive_policy?: {
    mode: 'permanent'
    policy_id: 'phase7-27-journal-club-2026-07-23-v1'
  }
  archive_expires_at: string
  closed_at: string
  comments: unknown[]
  comments_has_more: boolean
  material_summary: Record<string, unknown> | null
  participant_count_approximate: number
  pdf: Record<string, unknown> | null
  polls: unknown[]
  schema_version: 1
  started_at: string | null
  summaries: unknown[]
  title: string
}

export type ArchiveExportClaim = ArchiveExportClaimIdentity & {
  archiveExpiresAt: string
  attemptCount: number
  lectureCode: string
  payload: PublicLectureArchivePayload
}

export type FinishArchiveExportInput = ArchiveExportClaimIdentity & {
  error: string | null
  payloadSha256: string | null
  succeeded: boolean
}

export type ArchiveExportBatchItem = {
  errorCode: string | null
  finalized: boolean
  lectureSessionId: string | null
  sourceVersion: number | null
  status: 'exported' | 'failed' | 'finalize_failed'
}

export type ArchiveExportBatchResult = {
  claimed: number
  failed: number
  finalizeFailed: number
  items: ArchiveExportBatchItem[]
  succeeded: number
}

type JsonValue =
  boolean | null | number | string | JsonValue[] | { [key: string]: JsonValue }

const MAX_ARCHIVE_PAYLOAD_BYTES = 900_000
const MAX_JSON_DEPTH = 16
const MAX_JSON_ARRAY_ITEMS = 2_000
const MAX_JSON_OBJECT_KEYS = 250
const MAX_JSON_STRING_LENGTH = 250_000
const MAX_EXPORT_BATCH_SIZE = 5
const ARCHIVE_WORKER_TIMEOUT_MS = 15_000
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const lectureCodePattern = /^[A-Z0-9-]{4,32}$/
const forbiddenArchiveKeys = new Set([
  'admin_token',
  'auth_user_id',
  'billing_pin',
  'code_hash',
  'lecture_code',
  'openai_api_key',
  'participant_id',
  'participant_key',
  'raw_pdf_text',
  'raw_transcript',
  'service_role',
  'service_role_key',
  'transcript_segments',
])
const forbiddenArchiveKeyTokens = new Set(
  [...forbiddenArchiveKeys].map((key) => key.replaceAll('_', '')),
)

class ArchiveExportError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'ArchiveExportError'
    this.code = code
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function parseSafeInteger(value: unknown, label: string, minimum: number) {
  const parsed =
    typeof value === 'string' && /^[0-9]+$/.test(value) ? Number(value) : value
  if (
    typeof parsed !== 'number' ||
    !Number.isSafeInteger(parsed) ||
    parsed < minimum
  ) {
    throw new ArchiveExportError(
      'invalid_claim',
      `${label} must be a safe integer.`,
    )
  }
  return parsed
}

export function normalizeIsoTimestamp(value: unknown, label: string) {
  if (typeof value !== 'string') {
    throw new ArchiveExportError(
      'invalid_claim',
      `${label} must be an ISO timestamp.`,
    )
  }
  const timestamp = Date.parse(value)
  if (!Number.isFinite(timestamp)) {
    throw new ArchiveExportError(
      'invalid_claim',
      `${label} must be an ISO timestamp.`,
    )
  }
  return new Date(timestamp).toISOString()
}

function sanitizeJsonValue(value: unknown, depth = 0): JsonValue {
  if (depth > MAX_JSON_DEPTH) {
    throw new ArchiveExportError(
      'invalid_claim',
      'Archive payload is nested too deeply.',
    )
  }
  if (value === null || typeof value === 'boolean') return value
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new ArchiveExportError(
        'invalid_claim',
        'Archive payload contains a non-finite number.',
      )
    }
    return value
  }
  if (typeof value === 'string') {
    if (value.length > MAX_JSON_STRING_LENGTH) {
      throw new ArchiveExportError(
        'invalid_claim',
        'Archive payload contains an oversized string.',
      )
    }
    return value
  }
  if (Array.isArray(value)) {
    if (value.length > MAX_JSON_ARRAY_ITEMS) {
      throw new ArchiveExportError(
        'invalid_claim',
        'Archive payload contains an oversized array.',
      )
    }
    return value.map((item) => sanitizeJsonValue(item, depth + 1))
  }
  if (!isRecord(value)) {
    throw new ArchiveExportError(
      'invalid_claim',
      'Archive payload is not valid JSON.',
    )
  }

  const entries = Object.entries(value).sort(([left], [right]) =>
    left.localeCompare(right),
  )
  if (entries.length > MAX_JSON_OBJECT_KEYS) {
    throw new ArchiveExportError(
      'invalid_claim',
      'Archive payload contains too many object keys.',
    )
  }

  const sanitized: Record<string, JsonValue> = {}
  for (const [key, nestedValue] of entries) {
    const normalizedKey = key.toLowerCase().replace(/[^a-z0-9]/g, '')
    if (
      key.length < 1 ||
      key.length > 120 ||
      forbiddenArchiveKeys.has(key.toLowerCase()) ||
      forbiddenArchiveKeyTokens.has(normalizedKey)
    ) {
      throw new ArchiveExportError(
        'invalid_claim',
        'Archive payload contains a private or invalid field.',
      )
    }
    sanitized[key] = sanitizeJsonValue(nestedValue, depth + 1)
  }
  return sanitized
}

function requireArray(value: JsonValue | undefined, label: string) {
  if (!Array.isArray(value)) {
    throw new ArchiveExportError('invalid_claim', `${label} must be an array.`)
  }
  return value
}

function sanitizeArchivePayload(value: unknown): PublicLectureArchivePayload {
  const sanitizedValue = sanitizeJsonValue(value)
  if (!isRecord(sanitizedValue)) {
    throw new ArchiveExportError(
      'invalid_claim',
      'Archive payload must be an object.',
    )
  }

  const title =
    typeof sanitizedValue.title === 'string' ? sanitizedValue.title.trim() : ''
  const comments = requireArray(sanitizedValue.comments, 'Archive comments')
  const academicAnswers = requireArray(
    sanitizedValue.academic_answers ?? [],
    'Archive academic answers',
  )
  const polls = requireArray(sanitizedValue.polls, 'Archive polls')
  const summaries = requireArray(sanitizedValue.summaries, 'Archive summaries')
  const materialSummary = sanitizedValue.material_summary ?? null
  const participantCount = sanitizedValue.participant_count_approximate
  const pdf = sanitizedValue.pdf
  const archivePolicy = sanitizedValue.archive_policy
  const permanentArchive =
    isRecord(archivePolicy) &&
    Object.keys(archivePolicy).length === 2 &&
    archivePolicy.mode === 'permanent' &&
    archivePolicy.policy_id ===
      'phase7-27-journal-club-2026-07-23-v1'

  if (archivePolicy !== undefined && !permanentArchive) {
    throw new ArchiveExportError(
      'invalid_claim',
      'Archive policy is invalid.',
    )
  }

  if (
    sanitizedValue.schema_version !== 1 ||
    title.length < 1 ||
    title.length > 300 ||
    typeof sanitizedValue.comments_has_more !== 'boolean' ||
    !Number.isSafeInteger(participantCount) ||
    Number(participantCount) < 0 ||
    comments.length > 500 ||
    academicAnswers.length > 3 ||
    polls.length > 100 ||
    summaries.length > (permanentArchive ? 18 : 12) ||
    (materialSummary !== null && !isRecord(materialSummary)) ||
    (pdf !== null && !isRecord(pdf))
  ) {
    throw new ArchiveExportError(
      'invalid_claim',
      'Archive payload contract is invalid.',
    )
  }

  const archiveExpiresAt = normalizeIsoTimestamp(
    sanitizedValue.archive_expires_at,
    'Archive expiry',
  )
  const closedAt = normalizeIsoTimestamp(
    sanitizedValue.closed_at,
    'Archive close time',
  )
  const startedAt =
    sanitizedValue.started_at === null
      ? null
      : normalizeIsoTimestamp(sanitizedValue.started_at, 'Archive start time')

  return {
    academic_answers: academicAnswers,
    ...(permanentArchive
      ? {
          archive_policy: {
            mode: 'permanent' as const,
            policy_id:
              'phase7-27-journal-club-2026-07-23-v1' as const,
          },
        }
      : {}),
    archive_expires_at: archiveExpiresAt,
    closed_at: closedAt,
    comments,
    comments_has_more: sanitizedValue.comments_has_more,
    material_summary: materialSummary as Record<string, unknown> | null,
    participant_count_approximate: Number(participantCount),
    pdf: pdf as Record<string, unknown> | null,
    polls,
    schema_version: 1,
    started_at: startedAt,
    summaries,
    title,
  }
}

export function parseArchiveExportClaimIdentity(
  value: unknown,
): ArchiveExportClaimIdentity {
  if (!isRecord(value)) {
    throw new ArchiveExportError(
      'invalid_claim',
      'Archive claim must be an object.',
    )
  }
  const lectureSessionId =
    typeof value.lecture_session_id === 'string'
      ? value.lecture_session_id.toLowerCase()
      : ''
  if (!uuidPattern.test(lectureSessionId)) {
    throw new ArchiveExportError(
      'invalid_claim',
      'Archive lecture ID is invalid.',
    )
  }
  return {
    lectureSessionId,
    sourceVersion: parseSafeInteger(
      value.source_version,
      'Archive source version',
      1,
    ),
  }
}

export function sanitizeArchiveExportClaim(value: unknown): ArchiveExportClaim {
  const identity = parseArchiveExportClaimIdentity(value)
  const raw = value as Record<string, unknown>
  const lectureCode =
    typeof raw.lecture_code === 'string'
      ? raw.lecture_code.trim().toUpperCase()
      : ''
  if (!lectureCodePattern.test(lectureCode)) {
    throw new ArchiveExportError(
      'invalid_claim',
      'Archive lecture code is invalid.',
    )
  }

  const archiveExpiresAt = normalizeIsoTimestamp(
    raw.archive_expires_at,
    'Archive expiry',
  )
  const payload = sanitizeArchivePayload(raw.payload)
  if (payload.archive_expires_at !== archiveExpiresAt) {
    throw new ArchiveExportError(
      'invalid_claim',
      'Archive expiry does not match its payload.',
    )
  }

  const canonicalPayload = canonicalJsonStringify(payload)
  if (
    new TextEncoder().encode(canonicalPayload).byteLength >
    MAX_ARCHIVE_PAYLOAD_BYTES
  ) {
    throw new ArchiveExportError(
      'invalid_claim',
      'Archive payload is too large.',
    )
  }

  return {
    ...identity,
    archiveExpiresAt,
    attemptCount: parseSafeInteger(
      raw.attempt_count,
      'Archive attempt count',
      0,
    ),
    lectureCode,
    payload,
  }
}

export function canonicalJsonStringify(value: unknown) {
  return JSON.stringify(sanitizeJsonValue(value))
}

export async function sha256CanonicalJson(value: unknown) {
  const canonicalJson = canonicalJsonStringify(value)
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(canonicalJson),
  )
  const payloadSha256 = Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
  return { canonicalJson, payloadSha256 }
}

export function normalizeArchiveWorkerIngestUrl(value: string) {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new ArchiveExportError(
      'invalid_configuration',
      'Archive Worker URL is invalid.',
    )
  }
  const localHostname = ['127.0.0.1', 'localhost', '[::1]'].includes(
    url.hostname,
  )
  if (
    (url.protocol !== 'https:' &&
      !(url.protocol === 'http:' && localHostname)) ||
    url.username ||
    url.password ||
    url.hash
  ) {
    throw new ArchiveExportError(
      'invalid_configuration',
      'Archive Worker URL must use HTTPS.',
    )
  }
  return url.toString()
}

function errorCode(error: unknown) {
  return error instanceof ArchiveExportError
    ? error.code
    : 'archive_export_failed'
}

async function finishSafely({
  finish,
  input,
}: {
  finish: (input: FinishArchiveExportInput) => Promise<boolean>
  input: FinishArchiveExportInput
}) {
  try {
    return await finish(input)
  } catch {
    return false
  }
}

async function processArchiveExport({
  fetchImpl,
  finish,
  ingestSecret,
  rawClaim,
  workerIngestUrl,
}: {
  fetchImpl: typeof fetch
  finish: (input: FinishArchiveExportInput) => Promise<boolean>
  ingestSecret: string
  rawClaim: unknown
  workerIngestUrl: string
}): Promise<ArchiveExportBatchItem> {
  let identity: ArchiveExportClaimIdentity
  try {
    identity = parseArchiveExportClaimIdentity(rawClaim)
  } catch {
    return {
      errorCode: 'invalid_claim',
      finalized: false,
      lectureSessionId: null,
      sourceVersion: null,
      status: 'failed',
    }
  }

  let claim: ArchiveExportClaim
  try {
    claim = sanitizeArchiveExportClaim(rawClaim)
  } catch (error) {
    const code = errorCode(error)
    const finalized = await finishSafely({
      finish,
      input: {
        ...identity,
        error: code,
        payloadSha256: null,
        succeeded: false,
      },
    })
    return {
      errorCode: code,
      finalized,
      lectureSessionId: identity.lectureSessionId,
      sourceVersion: identity.sourceVersion,
      status: finalized ? 'failed' : 'finalize_failed',
    }
  }

  let payloadSha256: string | null = null
  let deliveryError: string | null = null
  try {
    const hashed = await sha256CanonicalJson(claim.payload)
    payloadSha256 = hashed.payloadSha256
    const response = await fetchImpl(workerIngestUrl, {
      body: JSON.stringify({
        archiveExpiresAt: claim.archiveExpiresAt,
        lectureCode: claim.lectureCode,
        payload: claim.payload,
        payloadSha256,
        sourceVersion: claim.sourceVersion,
      }),
      headers: {
        Authorization: `Bearer ${ingestSecret}`,
        'Content-Type': 'application/json',
      },
      method: 'POST',
      signal: AbortSignal.timeout(ARCHIVE_WORKER_TIMEOUT_MS),
    })
    if (!response.ok) {
      throw new ArchiveExportError(
        `worker_http_${response.status}`,
        'Archive Worker rejected the export.',
      )
    }
    let responseBody: unknown
    try {
      responseBody = await response.json()
    } catch {
      throw new ArchiveExportError(
        'worker_invalid_response',
        'Archive Worker returned invalid JSON.',
      )
    }
    if (
      !isRecord(responseBody) ||
      responseBody.ok !== true ||
      responseBody.accepted !== true ||
      Number(responseBody.sourceVersion) !== claim.sourceVersion
    ) {
      throw new ArchiveExportError(
        'worker_rejected_export',
        'Archive Worker did not accept the requested source version.',
      )
    }
  } catch (error) {
    deliveryError =
      error instanceof ArchiveExportError ? error.code : 'worker_request_failed'
  }

  const succeeded = deliveryError === null && payloadSha256 !== null
  const finalized = await finishSafely({
    finish,
    input: {
      ...identity,
      error: deliveryError,
      payloadSha256: succeeded ? payloadSha256 : null,
      succeeded,
    },
  })

  return {
    errorCode: finalized
      ? deliveryError
      : (deliveryError ?? 'archive_finalize_failed'),
    finalized,
    lectureSessionId: claim.lectureSessionId,
    sourceVersion: claim.sourceVersion,
    status: finalized ? (succeeded ? 'exported' : 'failed') : 'finalize_failed',
  }
}

export async function runArchiveExportBatch({
  claim,
  fetchImpl = fetch,
  finish,
  ingestSecret,
  limit = MAX_EXPORT_BATCH_SIZE,
  workerIngestUrl,
}: {
  claim: (limit: number) => Promise<unknown[]>
  fetchImpl?: typeof fetch
  finish: (input: FinishArchiveExportInput) => Promise<boolean>
  ingestSecret: string
  limit?: number
  workerIngestUrl: string
}): Promise<ArchiveExportBatchResult> {
  const effectiveLimit = Math.min(
    Math.max(Number.isSafeInteger(limit) ? limit : MAX_EXPORT_BATCH_SIZE, 1),
    MAX_EXPORT_BATCH_SIZE,
  )
  if (new TextEncoder().encode(ingestSecret).byteLength < 32) {
    throw new ArchiveExportError(
      'invalid_configuration',
      'Archive ingest secret must contain at least 32 bytes.',
    )
  }
  const normalizedWorkerUrl = normalizeArchiveWorkerIngestUrl(workerIngestUrl)
  const rawClaims = await claim(effectiveLimit)
  if (!Array.isArray(rawClaims) || rawClaims.length > effectiveLimit) {
    throw new ArchiveExportError(
      'invalid_claim',
      'Archive claim result exceeded the requested batch.',
    )
  }

  const items = await Promise.all(
    rawClaims.map((rawClaim) =>
      processArchiveExport({
        fetchImpl,
        finish,
        ingestSecret,
        rawClaim,
        workerIngestUrl: normalizedWorkerUrl,
      }),
    ),
  )
  return {
    claimed: items.length,
    failed: items.filter((item) => item.status === 'failed').length,
    finalizeFailed: items.filter((item) => item.status === 'finalize_failed')
      .length,
    items,
    succeeded: items.filter((item) => item.status === 'exported').length,
  }
}
