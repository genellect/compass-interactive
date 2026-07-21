import {
  decodeManifest,
  encodeManifest,
  parseManifest,
  toPublicManifest,
} from '../../../publisher/src/manifest/manifest.ts'
import type { PdfManifest } from '../../../publisher/src/manifest/types.ts'
import {
  createArchiveLookupHash,
  signAssetTicket,
  signArchiveAccessToken,
  verifyArchiveAccessToken,
  verifyAssetTicket,
  verifyLectureResumeToken,
  verifyLectureToken,
} from './crypto.ts'
import type { R2BucketLike, R2ObjectLike } from './r2Types.ts'
import {
  cleanupExpiredPdfPublications,
  handlePdfPublicationRequest,
} from './pdfPublication.ts'

type DurableObjectStorageLike = {
  get<T>(key: string): Promise<T | undefined>
  put<T>(key: string, value: T): Promise<void>
}

type DurableObjectStateLike = {
  storage: DurableObjectStorageLike
}

type DurableObjectStubLike = {
  fetch(request: Request): Promise<Response>
}

type DurableObjectNamespaceLike = {
  get(id: unknown): DurableObjectStubLike
  idFromName(name: string): unknown
}

export type AssetWorkerEnvironment = {
  ALLOWED_ORIGINS: string
  ARCHIVE_ACCESS_SECRET?: string
  ARCHIVE_CODE_LOOKUP_SECRET?: string
  ARCHIVE_FAILURE_GUARD?: DurableObjectNamespaceLike
  ARCHIVE_INGEST_SECRET?: string
  ARCHIVE_IP_RATE_LIMITER?: {
    limit(input: { key: string }): Promise<{ success: boolean }>
  }
  ARCHIVE_RATE_LIMITER?: {
    limit(input: { key: string }): Promise<{ success: boolean }>
  }
  LECTURE_RESUME_TOKEN_SECRET?: string
  PDF_ACCESS_AUDIENCE: string
  PDF_ACCESS_ISSUER: string
  PDF_ACCESS_PUBLIC_JWK: string
  PDF_ASSET_TICKET_SECRET: string
  PDF_BUCKET: R2BucketLike
  PDF_PUBLICATION_COORDINATOR_SECRET?: string
  PDF_PUBLICATION_COORDINATOR_URL?: string
  PDF_PUBLICATION_PUBLIC_JWK?: string
  PDF_RETENTION_FEED_URL?: string
  PDF_RETENTION_SYNC_SECRET?: string
  PHASE726_BROWSER_PDF_UPLOAD_ENABLED?: string
  TURNSTILE_EXPECTED_HOSTNAME?: string
  TURNSTILE_SECRET_KEY?: string
}

type PublicArchivePdf = {
  current_page: number
  display_name: string
  document_id: string
  document_version: string
  download_enabled: boolean
  lecture_public_id: string
  manifest_version: number
  page_count: number
}

type PublicLectureArchivePayload = {
  academic_answers?: Array<Record<string, unknown>>
  archive_policy?: {
    mode: 'permanent'
    policy_id: 'phase7-27-journal-club-2026-07-23-v1'
  }
  archive_expires_at: string
  closed_at: string
  comments: Array<Record<string, unknown>>
  comments_has_more: boolean
  material_summary?: Record<string, unknown> | null
  lecture_public_id?: string
  participant_count_approximate: number
  pdf: PublicArchivePdf | null
  polls: Array<Record<string, unknown>>
  resume_token_version?: number
  schema_version: 1
  started_at: string | null
  summaries: Array<Record<string, unknown>>
  title: string
}

type StoredLectureArchiveIndex = {
  archive_expires_at: string
  lookup_hash: string
  payload_sha256: string
  schema_version: 1
  source_version: number
}

type StoredLectureArchive = {
  archive_expires_at: string
  payload: PublicLectureArchivePayload
  payload_sha256: string
  published_at: string
  schema_version: 1
  source_version: number
}

const MAX_ARCHIVE_INGEST_BYTES = 1_000_000
const MAX_ARCHIVE_RESOLVE_BYTES = 8_192
const ARCHIVE_FAILURE_LIMIT = 8
const ARCHIVE_FAILURE_WINDOW_MS = 10 * 60 * 1000
const PHASE727_PERMANENT_ARCHIVE_POLICY_ID =
  'phase7-27-journal-club-2026-07-23-v1'
const forbiddenArchiveKeyTokens = new Set(
  [
    'admin_token',
    'access_token',
    'auth_user_id',
    'billing_pin',
    'code_hash',
    'email',
    'ip_address',
    'lecture_code',
    'openai_api_key',
    'password',
    'participant_id',
    'participant_key',
    'pdf_text',
    'raw_audio',
    'raw_pdf_text',
    'raw_transcript',
    'refresh_token',
    'secret',
    'session_token',
    'service_role',
    'service_role_key',
    'transcript_segments',
    'user_id',
  ].map((key) => key.replaceAll('_', '')),
)

export class ArchiveFailureGuard {
  readonly state: DurableObjectStateLike

  constructor(state: DurableObjectStateLike) {
    this.state = state
  }

  async fetch(request: Request) {
    let body: { action?: string; nowMs?: number }
    try {
      body = (await request.json()) as typeof body
    } catch {
      return Response.json({ allowed: false }, { status: 400 })
    }
    const nowMs = Number(body.nowMs)
    if (
      !Number.isFinite(nowMs) ||
      !['check', 'record_failure'].includes(body.action ?? '')
    ) {
      return Response.json({ allowed: false }, { status: 400 })
    }

    const stored =
      (await this.state.storage.get<number[]>('failure_timestamps')) ?? []
    const failures = stored.filter(
      (timestamp) =>
        Number.isFinite(timestamp) &&
        timestamp > nowMs - ARCHIVE_FAILURE_WINDOW_MS &&
        timestamp <= nowMs + 5_000,
    )
    if (body.action === 'record_failure') {
      failures.push(nowMs)
    }
    if (failures.length !== stored.length || body.action === 'record_failure') {
      await this.state.storage.put('failure_timestamps', failures.slice(-32))
    }

    const allowed = failures.length < ARCHIVE_FAILURE_LIMIT
    const retryAt =
      allowed || failures.length === 0
        ? null
        : failures[0]! + ARCHIVE_FAILURE_WINDOW_MS
    return Response.json({ allowed, retryAt })
  }
}

function jsonResponse(
  payload: unknown,
  status: number,
  origin: string | null,
  extraHeaders?: HeadersInit,
) {
  const headers = new Headers(extraHeaders)
  headers.set('Cache-Control', 'no-store')
  headers.set('Content-Type', 'application/json; charset=utf-8')
  headers.set('X-Content-Type-Options', 'nosniff')
  if (origin) {
    headers.set('Access-Control-Allow-Origin', origin)
    headers.set('Vary', 'Origin')
  }
  return new Response(`${JSON.stringify(payload)}\n`, { headers, status })
}

function getAllowedOrigin(request: Request, env: AssetWorkerEnvironment) {
  const origin = request.headers.get('Origin')
  if (!origin) return null
  const allowed = new Set(
    env.ALLOWED_ORIGINS.split(',').map((candidate) => candidate.trim()),
  )
  return allowed.has(origin) ? origin : null
}

function requireAllowedOrigin(request: Request, env: AssetWorkerEnvironment) {
  const origin = request.headers.get('Origin')
  const allowed = getAllowedOrigin(request, env)
  if (origin && !allowed)
    throw Object.assign(new Error('Origin is not allowed.'), { status: 403 })
  return allowed
}

function manifestKey(lecturePublicId: string) {
  return `manifests/${lecturePublicId}/manifest.json`
}

function archiveKey(lookupHash: string) {
  return `archives/by-code/${lookupHash}.json`
}

function archivePublicIndexKey(lecturePublicId: string) {
  return `archives/by-public-id/${lecturePublicId}.json`
}

function requireResumeTokenSecret(env: AssetWorkerEnvironment) {
  const secret = env.LECTURE_RESUME_TOKEN_SECRET ?? ''
  if (new TextEncoder().encode(secret).byteLength < 32) {
    throw Object.assign(new Error('Archive resume is unavailable.'), {
      status: 503,
    })
  }
  return secret
}

function requireArchiveConfiguration(env: AssetWorkerEnvironment) {
  const accessSecret = env.ARCHIVE_ACCESS_SECRET ?? ''
  const lookupSecret = env.ARCHIVE_CODE_LOOKUP_SECRET ?? ''
  const ingestSecret = env.ARCHIVE_INGEST_SECRET ?? ''
  if (
    new TextEncoder().encode(accessSecret).byteLength < 32 ||
    new TextEncoder().encode(lookupSecret).byteLength < 32 ||
    new TextEncoder().encode(ingestSecret).byteLength < 32
  ) {
    throw Object.assign(new Error('Lecture archive is not configured.'), {
      status: 503,
    })
  }
  return {
    accessSecret,
    ingestSecret,
    lookupSecret,
  }
}

function requireArchiveResolveConfiguration(env: AssetWorkerEnvironment) {
  const configuration = requireArchiveConfiguration(env)
  if (
    new TextEncoder().encode(env.TURNSTILE_SECRET_KEY ?? '').byteLength < 16 ||
    !env.TURNSTILE_EXPECTED_HOSTNAME?.trim() ||
    !env.ARCHIVE_RATE_LIMITER ||
    !env.ARCHIVE_IP_RATE_LIMITER
  ) {
    throw Object.assign(new Error('Archive safety check is not configured.'), {
      status: 503,
    })
  }
  return configuration
}

async function parseBoundedJsonRequest(request: Request, maximumBytes: number) {
  if (
    request.headers.get('Content-Type')?.split(';', 1)[0]?.trim() !==
    'application/json'
  ) {
    throw Object.assign(new Error('Request body must be JSON.'), {
      status: 415,
    })
  }
  const contentLength = Number(request.headers.get('Content-Length') ?? 0)
  if (
    !Number.isFinite(contentLength) ||
    contentLength < 0 ||
    contentLength > maximumBytes
  ) {
    throw Object.assign(new Error('Request body is too large.'), {
      status: 413,
    })
  }
  const text = await request.text()
  if (new TextEncoder().encode(text).byteLength > maximumBytes) {
    throw Object.assign(new Error('Request body is too large.'), {
      status: 413,
    })
  }
  let value: unknown
  try {
    value = JSON.parse(text) as unknown
  } catch {
    throw Object.assign(new Error('Request body is invalid.'), { status: 400 })
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw Object.assign(new Error('Request body is invalid.'), { status: 400 })
  }
  return value as Record<string, unknown>
}

async function timingSafeStringEqual(expected: string, supplied: string) {
  const [expectedDigest, suppliedDigest] = await Promise.all(
    [expected, supplied].map((value) =>
      crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)),
    ),
  )
  const expectedBytes = new Uint8Array(expectedDigest)
  const suppliedBytes = new Uint8Array(suppliedDigest)
  let difference = 0
  for (let index = 0; index < expectedBytes.length; index += 1) {
    difference |= expectedBytes[index]! ^ suppliedBytes[index]!
  }
  return difference === 0
}

function parseIsoTimestamp(value: unknown, label: string) {
  if (
    typeof value !== 'string' ||
    !Number.isFinite(Date.parse(value)) ||
    new Date(value).toISOString() !== value
  ) {
    throw new Error(`${label} is invalid.`)
  }
  return value
}

function assertNoPrivateArchiveKeys(value: unknown) {
  if (Array.isArray(value)) {
    value.forEach(assertNoPrivateArchiveKeys)
    return
  }
  if (!value || typeof value !== 'object') return

  for (const [key, nested] of Object.entries(value)) {
    const normalizedKey = key.toLowerCase().replace(/[^a-z0-9]/g, '')
    if (forbiddenArchiveKeyTokens.has(normalizedKey)) {
      throw new Error('Archive payload contains a private field.')
    }
    assertNoPrivateArchiveKeys(nested)
  }
}

function parsePublicArchivePayload(
  value: unknown,
): PublicLectureArchivePayload {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Archive payload is invalid.')
  }
  const payload = value as Record<string, unknown>
  const academicAnswers = payload.academic_answers ?? []
  const archivePolicy = payload.archive_policy
  const permanentArchive =
    archivePolicy !== null &&
    archivePolicy !== undefined &&
    typeof archivePolicy === 'object' &&
    !Array.isArray(archivePolicy) &&
    Object.keys(archivePolicy).length === 2 &&
    (archivePolicy as Record<string, unknown>).mode === 'permanent' &&
    (archivePolicy as Record<string, unknown>).policy_id ===
      PHASE727_PERMANENT_ARCHIVE_POLICY_ID
  if (archivePolicy !== undefined && !permanentArchive) {
    throw new Error('Archive policy is invalid.')
  }
  if (
    payload.schema_version !== 1 ||
    typeof payload.title !== 'string' ||
    payload.title.trim().length < 1 ||
    payload.title.length > 300 ||
    typeof payload.comments_has_more !== 'boolean' ||
    !Number.isSafeInteger(payload.participant_count_approximate) ||
    Number(payload.participant_count_approximate) < 0 ||
    !Array.isArray(payload.comments) ||
    payload.comments.length > 500 ||
    !Array.isArray(payload.polls) ||
    payload.polls.length > 100 ||
    !Array.isArray(payload.summaries) ||
    payload.summaries.length > (permanentArchive ? 18 : 12) ||
    !Array.isArray(academicAnswers) ||
    academicAnswers.length > 3 ||
    ![
      ...payload.comments,
      ...payload.polls,
      ...payload.summaries,
      ...academicAnswers,
    ].every(
      (item) =>
        Boolean(item) && typeof item === 'object' && !Array.isArray(item),
    )
  ) {
    throw new Error('Archive payload contract is invalid.')
  }
  if (
    payload.material_summary !== undefined &&
    payload.material_summary !== null &&
    (typeof payload.material_summary !== 'object' ||
      Array.isArray(payload.material_summary))
  ) {
    throw new Error('Archive material summary is invalid.')
  }
  const archiveExpiresAt = parseIsoTimestamp(
    payload.archive_expires_at,
    'Archive expiry',
  )
  const closedAt = parseIsoTimestamp(payload.closed_at, 'Archive closed time')
  const archiveDuration = Date.parse(archiveExpiresAt) - Date.parse(closedAt)
  if (
    archiveDuration <= 0 ||
    archiveDuration > 30 * 24 * 60 * 60 * 1000 + 5 * 60 * 1000
  ) {
    throw new Error('Archive retention window is invalid.')
  }
  if (payload.started_at !== null) {
    const startedAt = parseIsoTimestamp(
      payload.started_at,
      'Archive start time',
    )
    if (Date.parse(startedAt) > Date.parse(closedAt)) {
      throw new Error('Archive start time is invalid.')
    }
  }

  const hasResumeScope =
    payload.lecture_public_id !== undefined ||
    payload.resume_token_version !== undefined
  if (
    hasResumeScope &&
    (typeof payload.lecture_public_id !== 'string' ||
      !/^lecture_[a-z0-9]{16,64}$/.test(payload.lecture_public_id) ||
      !Number.isInteger(payload.resume_token_version) ||
      Number(payload.resume_token_version) < 1)
  ) {
    throw new Error('Archive resume scope is invalid.')
  }

  if (payload.pdf !== null) {
    if (
      !payload.pdf ||
      typeof payload.pdf !== 'object' ||
      Array.isArray(payload.pdf)
    ) {
      throw new Error('Archive PDF metadata is invalid.')
    }
    const pdf = payload.pdf as Record<string, unknown>
    if (
      typeof pdf.document_id !== 'string' ||
      !/^[a-z0-9][a-z0-9-]{0,63}$/.test(pdf.document_id) ||
      typeof pdf.document_version !== 'string' ||
      !/^[0-9a-f]{64}$/.test(pdf.document_version) ||
      typeof pdf.lecture_public_id !== 'string' ||
      !/^lecture_[a-z0-9]{16,64}$/.test(pdf.lecture_public_id) ||
      typeof pdf.display_name !== 'string' ||
      pdf.display_name.length < 1 ||
      pdf.display_name.length > 160 ||
      !Number.isInteger(pdf.current_page) ||
      Number(pdf.current_page) < 1 ||
      !Number.isInteger(pdf.page_count) ||
      Number(pdf.page_count) < 1 ||
      Number(pdf.page_count) > 75 ||
      Number(pdf.current_page) > Number(pdf.page_count) ||
      !Number.isInteger(pdf.manifest_version) ||
      Number(pdf.manifest_version) < 1 ||
      typeof pdf.download_enabled !== 'boolean'
    ) {
      throw new Error('Archive PDF metadata is invalid.')
    }
  }

  assertNoPrivateArchiveKeys(payload)
  return payload as PublicLectureArchivePayload
}

function isPermanentArchivePayload(payload: PublicLectureArchivePayload) {
  return (
    payload.archive_policy?.mode === 'permanent' &&
    payload.archive_policy.policy_id === PHASE727_PERMANENT_ARCHIVE_POLICY_ID
  )
}

function isArchiveExpired(payload: PublicLectureArchivePayload, now: Date) {
  return (
    !isPermanentArchivePayload(payload) &&
    Date.parse(payload.archive_expires_at) <= now.getTime()
  )
}

function parseStoredArchive(value: Uint8Array): StoredLectureArchive {
  const stored = JSON.parse(new TextDecoder().decode(value)) as Record<
    string,
    unknown
  >
  if (
    stored.schema_version !== 1 ||
    !Number.isSafeInteger(stored.source_version) ||
    Number(stored.source_version) < 1 ||
    typeof stored.payload_sha256 !== 'string' ||
    !/^[0-9a-f]{64}$/.test(stored.payload_sha256)
  ) {
    throw new Error('Stored lecture archive is invalid.')
  }
  const archiveExpiresAt = parseIsoTimestamp(
    stored.archive_expires_at,
    'Stored archive expiry',
  )
  const publishedAt = parseIsoTimestamp(
    stored.published_at,
    'Stored archive publication time',
  )
  const payload = parsePublicArchivePayload(stored.payload)
  if (payload.archive_expires_at !== archiveExpiresAt) {
    throw new Error('Stored archive expiry does not match its payload.')
  }
  return {
    archive_expires_at: archiveExpiresAt,
    payload,
    payload_sha256: stored.payload_sha256,
    published_at: publishedAt,
    schema_version: 1,
    source_version: Number(stored.source_version),
  }
}

async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(value),
  )
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

function canonicalJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalJsonValue)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => [key, canonicalJsonValue(nested)]),
  )
}

function canonicalJsonStringify(value: unknown) {
  return JSON.stringify(canonicalJsonValue(value))
}

async function archivePayloadHashMatches(
  payload: PublicLectureArchivePayload,
  expectedHash: string,
) {
  const legacyJson = JSON.stringify(payload)
  const canonicalJson = canonicalJsonStringify(payload)
  const [legacyHash, canonicalHash] = await Promise.all([
    sha256Hex(legacyJson),
    legacyJson === canonicalJson
      ? Promise.resolve('')
      : sha256Hex(canonicalJson),
  ])
  return expectedHash === legacyHash || expectedHash === canonicalHash
}

async function validateTurnstileToken(
  request: Request,
  env: AssetWorkerEnvironment,
  token: string,
  fetcher: typeof fetch,
) {
  if (
    new TextEncoder().encode(env.TURNSTILE_SECRET_KEY ?? '').byteLength < 16
  ) {
    throw Object.assign(new Error('Archive safety check is not configured.'), {
      status: 503,
    })
  }
  if (!token || token.length > 2048) return false

  const response = await fetcher(
    'https://challenges.cloudflare.com/turnstile/v0/siteverify',
    {
      body: JSON.stringify({
        idempotency_key: crypto.randomUUID(),
        remoteip: request.headers.get('CF-Connecting-IP') ?? undefined,
        response: token,
        secret: env.TURNSTILE_SECRET_KEY,
      }),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    },
  )
  if (!response.ok) return false
  let result: {
    action?: string
    hostname?: string
    success?: boolean
  }
  try {
    result = (await response.json()) as typeof result
  } catch {
    return false
  }
  const expectedHostnames = new Set(
    (env.TURNSTILE_EXPECTED_HOSTNAME ?? '')
      .split(',')
      .map((hostname) => hostname.trim().toLowerCase())
      .filter(Boolean),
  )
  return Boolean(
    result.success &&
    result.action === 'archive-lookup' &&
    typeof result.hostname === 'string' &&
    expectedHostnames.has(result.hostname.toLowerCase()),
  )
}

async function enforceArchiveRateLimit(
  request: Request,
  env: AssetWorkerEnvironment,
  normalizedCode: string,
) {
  const clientId = request.headers.get('X-Compass-Client-Id')?.trim() ?? ''
  const clientKey = /^[0-9a-f-]{16,64}$/i.test(clientId)
    ? clientId.toLowerCase()
    : 'invalid-client-id'
  const ipAddress =
    request.headers.get('CF-Connecting-IP')?.trim() ?? 'unknown-client-ip'
  const codeDigest = await sha256Hex(normalizedCode)
  const [clientResult, ipResult] = await Promise.all([
    env.ARCHIVE_RATE_LIMITER!.limit({
      key: `${clientKey}:${codeDigest.slice(0, 16)}`,
    }),
    env.ARCHIVE_IP_RATE_LIMITER!.limit({
      key: await sha256Hex(`archive-ip:v1:${ipAddress}`),
    }),
  ])
  if (!clientResult.success || !ipResult.success) {
    throw Object.assign(new Error('Too many archive requests.'), {
      status: 429,
    })
  }
}

async function updateArchiveFailureGuard(
  request: Request,
  env: AssetWorkerEnvironment,
  now: Date,
  action: 'check' | 'record_failure',
) {
  if (!env.ARCHIVE_FAILURE_GUARD) {
    throw Object.assign(
      new Error('Archive failure protection is not configured.'),
      { status: 503 },
    )
  }
  const ipAddress =
    request.headers.get('CF-Connecting-IP')?.trim() ?? 'unknown-client-ip'
  const guardId = env.ARCHIVE_FAILURE_GUARD.idFromName(
    await sha256Hex(`archive-failure-ip:v1:${ipAddress}`),
  )
  const response = await env.ARCHIVE_FAILURE_GUARD.get(guardId).fetch(
    new Request('https://archive-failure-guard.internal/', {
      body: JSON.stringify({ action, nowMs: now.getTime() }),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    }),
  )
  const result = (await response.json().catch(() => null)) as {
    allowed?: boolean
  } | null
  if (!response.ok || typeof result?.allowed !== 'boolean') {
    throw Object.assign(new Error('Archive failure protection failed.'), {
      status: 503,
    })
  }
  return result.allowed
}

type CleanupIntent = {
  document_id: string
  document_version: string
  lecture_public_id: string
  object_key: string
  requested_at: string
  schema_version: 1
}

function cleanupIntentKey(intent: CleanupIntent) {
  // document_version is a content hash and can legitimately be shared by
  // different document IDs or publication-scoped object keys. Encoding the
  // complete object key makes the v2 intent identity injective while the
  // recovery scan keeps reading legacy v1 keys under cleanup-pending/.
  return (
    `cleanup-pending/v2/${intent.lecture_public_id}/` +
    `${encodeURIComponent(intent.object_key)}.json`
  )
}

function isBrowserPublicationObjectKey(intent: CleanupIntent) {
  const prefix =
    `pdf/${intent.lecture_public_id}/${intent.document_id}/` +
    `${intent.document_version}/`
  if (!intent.object_key.startsWith(prefix)) return false
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.pdf$/i.test(
    intent.object_key.slice(prefix.length),
  )
}

function parseCleanupIntent(value: Uint8Array): CleanupIntent {
  const intent = JSON.parse(new TextDecoder().decode(value)) as CleanupIntent
  const expectedObjectKey = `pdf/${intent.lecture_public_id}/${intent.document_id}/${intent.document_version}.pdf`
  if (
    intent.schema_version !== 1 ||
    !/^lecture_[a-z0-9]{16,64}$/.test(intent.lecture_public_id) ||
    !/^[a-z0-9][a-z0-9-]{0,63}$/.test(intent.document_id) ||
    !/^[0-9a-f]{64}$/.test(intent.document_version) ||
    (intent.object_key !== expectedObjectKey &&
      !isBrowserPublicationObjectKey(intent)) ||
    !Number.isFinite(Date.parse(intent.requested_at))
  ) {
    throw new Error('Cleanup intent is invalid.')
  }
  return intent
}

async function writeDeletionAudit(
  env: AssetWorkerEnvironment,
  intent: CleanupIntent,
  now: Date,
) {
  const auditKey =
    `audit/v2/${intent.lecture_public_id}/` +
    `${encodeURIComponent(intent.object_key)}.json`
  const existed = Boolean(await env.PDF_BUCKET.head(auditKey))
  await env.PDF_BUCKET.put(
    auditKey,
    `${JSON.stringify({
      deleted_at: now.toISOString(),
      document_id: intent.document_id,
      document_version: intent.document_version,
      lecture_public_id: intent.lecture_public_id,
    })}\n`,
    { httpMetadata: { contentType: 'application/json' } },
  )
  return !existed
}

async function recoverPendingCleanups(
  env: AssetWorkerEnvironment,
  now: Date,
  limit: number,
) {
  const listed = await env.PDF_BUCKET.list({
    limit: Math.min(limit, 1000),
    prefix: 'cleanup-pending/',
  })
  let deleted = 0
  let processed = 0
  for (const summary of listed.objects) {
    if (processed >= limit) break
    const object = await env.PDF_BUCKET.get(summary.key)
    if (!object) continue
    const intent = parseCleanupIntent(await objectBytes(object))
    const loaded = await loadManifest(env, intent.lecture_public_id)
    const stillReferenced = loaded?.manifest.documents.some(
      (document) =>
        document.document_version === intent.document_version &&
        document.object_key === intent.object_key,
    )
    if (stillReferenced) {
      await env.PDF_BUCKET.delete(summary.key)
      processed += 1
      continue
    }
    if (!isBrowserPublicationObjectKey(intent)) {
      await env.PDF_BUCKET.delete(intent.object_key)
      if (await writeDeletionAudit(env, intent, now)) deleted += 1
    }
    await env.PDF_BUCKET.delete(summary.key)
    processed += 1
  }
  return { deleted, processed, scanned: listed.objects.length }
}

type RetentionFeedItem = {
  archiveExpiresAt: string
  deleteAfter: string
  documentId: string
  documentVersion: string
  lecturePublicId: string
}

function parseRetentionFeed(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Retention feed is invalid.')
  }
  const feed = value as Record<string, unknown>
  if (
    feed.contractVersion !== 1 ||
    typeof feed.hasMore !== 'boolean' ||
    !Number.isInteger(feed.nextOffset) ||
    !Array.isArray(feed.items)
  ) {
    throw new Error('Retention feed header is invalid.')
  }
  const items = feed.items.map((raw): RetentionFeedItem => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new Error('Retention feed item is invalid.')
    }
    const item = raw as Record<string, unknown>
    if (
      typeof item.lecturePublicId !== 'string' ||
      !/^lecture_[a-z0-9]{16,64}$/.test(item.lecturePublicId) ||
      typeof item.documentId !== 'string' ||
      !/^[a-z0-9][a-z0-9-]{0,63}$/.test(item.documentId) ||
      typeof item.documentVersion !== 'string' ||
      !/^[0-9a-f]{64}$/.test(item.documentVersion) ||
      typeof item.archiveExpiresAt !== 'string' ||
      new Date(item.archiveExpiresAt).toISOString() !== item.archiveExpiresAt ||
      typeof item.deleteAfter !== 'string' ||
      new Date(item.deleteAfter).toISOString() !== item.deleteAfter ||
      Date.parse(item.deleteAfter) !==
        Date.parse(item.archiveExpiresAt) + 7 * 24 * 60 * 60 * 1000
    ) {
      throw new Error('Retention feed item is invalid.')
    }
    return item as RetentionFeedItem
  })
  return {
    hasMore: feed.hasMore,
    items,
    nextOffset: Number(feed.nextOffset),
  }
}

export async function syncRetentionMetadata(
  env: AssetWorkerEnvironment,
  fetcher: typeof fetch = fetch,
) {
  if (!env.PDF_RETENTION_FEED_URL && !env.PDF_RETENTION_SYNC_SECRET) {
    return { conflicts: 0, manifestsUpdated: 0, rows: 0, skipped: true }
  }
  if (
    !env.PDF_RETENTION_FEED_URL ||
    !env.PDF_RETENTION_SYNC_SECRET ||
    new TextEncoder().encode(env.PDF_RETENTION_SYNC_SECRET).byteLength < 32
  ) {
    throw new Error('Retention synchronization is incompletely configured.')
  }
  const feedUrl = new URL(env.PDF_RETENTION_FEED_URL)
  if (
    feedUrl.protocol !== 'https:' &&
    !['127.0.0.1', 'localhost'].includes(feedUrl.hostname)
  ) {
    throw new Error('Retention feed must use HTTPS.')
  }

  let conflicts = 0
  let manifestsUpdated = 0
  let offset = 0
  let rows = 0
  for (let page = 0; page < 200; page += 1) {
    feedUrl.searchParams.set('offset', String(offset))
    const response = await fetcher(feedUrl, {
      headers: {
        Authorization: `Bearer ${env.PDF_RETENTION_SYNC_SECRET}`,
      },
    })
    if (!response.ok) {
      throw new Error(`Retention feed failed (${response.status}).`)
    }
    const feed = parseRetentionFeed(await response.json())
    rows += feed.items.length
    const byLecture = new Map<string, RetentionFeedItem[]>()
    for (const item of feed.items) {
      const existing = byLecture.get(item.lecturePublicId) ?? []
      existing.push(item)
      byLecture.set(item.lecturePublicId, existing)
    }
    for (const [lecturePublicId, items] of byLecture) {
      const loaded = await loadManifest(env, lecturePublicId)
      if (!loaded) continue
      let changed = false
      const documents = loaded.manifest.documents.map((document) => {
        const retention = items.find(
          (item) =>
            item.documentId === document.document_id &&
            item.documentVersion === document.document_version,
        )
        if (
          !retention ||
          (document.archive_expires_at === retention.archiveExpiresAt &&
            document.delete_after === retention.deleteAfter)
        ) {
          return document
        }
        changed = true
        return {
          ...document,
          archive_expires_at: retention.archiveExpiresAt,
          delete_after: retention.deleteAfter,
        }
      })
      if (!changed) continue
      const nextManifest = parseManifest({
        ...loaded.manifest,
        documents,
        manifest_version: loaded.manifest.manifest_version + 1,
        updated_at: new Date().toISOString(),
      })
      const committed = await env.PDF_BUCKET.put(
        manifestKey(lecturePublicId),
        encodeManifest(nextManifest),
        {
          httpMetadata: {
            cacheControl: 'no-store',
            contentType: 'application/json',
          },
          onlyIf: { etagMatches: loaded.object.etag },
        },
      )
      if (committed) manifestsUpdated += 1
      else conflicts += 1
    }
    if (!feed.hasMore) {
      return { conflicts, manifestsUpdated, rows, skipped: false }
    }
    if (feed.nextOffset <= offset) {
      throw new Error('Retention feed pagination did not advance.')
    }
    offset = feed.nextOffset
  }
  throw new Error('Retention feed exceeded the page safety limit.')
}

async function objectBytes(object: R2ObjectLike) {
  if (object.arrayBuffer) return new Uint8Array(await object.arrayBuffer())
  if (!object.body) throw new Error('R2 object body is missing.')
  return new Uint8Array(await new Response(object.body).arrayBuffer())
}

async function loadManifest(
  env: AssetWorkerEnvironment,
  lecturePublicId: string,
) {
  const object = await env.PDF_BUCKET.get(manifestKey(lecturePublicId))
  if (!object) return null
  const manifest = decodeManifest(await objectBytes(object))
  if (manifest.lecture_public_id !== lecturePublicId) {
    throw new Error('Manifest lecture scope is invalid.')
  }
  return { manifest, object }
}

async function preservePermanentArchiveDocument(
  env: AssetWorkerEnvironment,
  payload: PublicLectureArchivePayload,
  now: Date,
) {
  if (!isPermanentArchivePayload(payload) || !payload.pdf) return

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const loaded = await loadManifest(env, payload.pdf.lecture_public_id)
    if (!loaded) {
      throw Object.assign(new Error('Permanent archive manifest is missing.'), {
        status: 409,
      })
    }
    const documentIndex = loaded.manifest.documents.findIndex(
      (document) =>
        document.document_id === payload.pdf?.document_id &&
        document.document_version === payload.pdf?.document_version &&
        document.visible,
    )
    if (documentIndex < 0) {
      throw Object.assign(
        new Error('Permanent archive document is unavailable.'),
        { status: 409 },
      )
    }
    const document = loaded.manifest.documents[documentIndex]!
    if (!document.archive_expires_at && !document.delete_after) return

    const documents = [...loaded.manifest.documents]
    documents[documentIndex] = {
      ...document,
      archive_expires_at: null,
      delete_after: null,
    }
    const nextManifest = parseManifest({
      ...loaded.manifest,
      documents,
      manifest_version: loaded.manifest.manifest_version + 1,
      updated_at: now.toISOString(),
    })
    const committed = await env.PDF_BUCKET.put(
      manifestKey(payload.pdf.lecture_public_id),
      encodeManifest(nextManifest),
      {
        httpMetadata: {
          cacheControl: 'no-store',
          contentType: 'application/json',
        },
        onlyIf: { etagMatches: loaded.object.etag },
      },
    )
    if (committed) return
  }
  throw Object.assign(
    new Error('Permanent archive manifest publication conflicted.'),
    { status: 409 },
  )
}

async function loadLectureArchive(
  env: AssetWorkerEnvironment,
  lookupHash: string,
) {
  const object = await env.PDF_BUCKET.get(archiveKey(lookupHash))
  if (!object) return null
  const archive = parseStoredArchive(await objectBytes(object))
  if (
    !(await archivePayloadHashMatches(archive.payload, archive.payload_sha256))
  ) {
    throw new Error('Stored lecture archive integrity check failed.')
  }
  return { archive, object }
}

function parseStoredLectureArchiveIndex(value: Uint8Array) {
  const index = JSON.parse(new TextDecoder().decode(value)) as Record<
    string,
    unknown
  >
  if (
    index.schema_version !== 1 ||
    !Number.isSafeInteger(index.source_version) ||
    Number(index.source_version) < 1 ||
    typeof index.lookup_hash !== 'string' ||
    !/^[0-9a-f]{64}$/.test(index.lookup_hash) ||
    typeof index.payload_sha256 !== 'string' ||
    !/^[0-9a-f]{64}$/.test(index.payload_sha256) ||
    typeof index.archive_expires_at !== 'string' ||
    !Number.isFinite(Date.parse(index.archive_expires_at))
  ) {
    throw new Error('Stored lecture archive index is invalid.')
  }
  return index as StoredLectureArchiveIndex
}

async function storeLectureArchivePublicIndex(
  env: AssetWorkerEnvironment,
  lookupHash: string,
  archive: StoredLectureArchive,
) {
  const lecturePublicId = archive.payload.lecture_public_id
  if (!lecturePublicId) return
  const key = archivePublicIndexKey(lecturePublicId)
  const index: StoredLectureArchiveIndex = {
    archive_expires_at: archive.archive_expires_at,
    lookup_hash: lookupHash,
    payload_sha256: archive.payload_sha256,
    schema_version: 1,
    source_version: archive.source_version,
  }
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const existingObject = await env.PDF_BUCKET.get(key)
    if (existingObject) {
      const existingIndex = parseStoredLectureArchiveIndex(
        await objectBytes(existingObject),
      )
      if (existingIndex.source_version > archive.source_version) return
      if (
        existingIndex.source_version === archive.source_version &&
        existingIndex.payload_sha256 === archive.payload_sha256 &&
        existingIndex.lookup_hash === lookupHash
      ) {
        return
      }
    }
    const committed = await env.PDF_BUCKET.put(
      key,
      `${JSON.stringify(index)}\n`,
      {
        httpMetadata: {
          cacheControl: 'no-store',
          contentType: 'application/json',
        },
        onlyIf: existingObject
          ? { etagMatches: existingObject.etag }
          : { etagDoesNotMatch: '*' },
      },
    )
    if (committed) return
  }
  throw new Error('Archive resume index publication conflicted.')
}

async function loadLectureArchiveByPublicId(
  env: AssetWorkerEnvironment,
  lecturePublicId: string,
) {
  const indexObject = await env.PDF_BUCKET.get(
    archivePublicIndexKey(lecturePublicId),
  )
  if (!indexObject) return null
  const index = parseStoredLectureArchiveIndex(await objectBytes(indexObject))
  const loaded = await loadLectureArchive(env, index.lookup_hash)
  if (
    !loaded ||
    loaded.archive.source_version !== index.source_version ||
    loaded.archive.payload_sha256 !== index.payload_sha256 ||
    loaded.archive.payload.lecture_public_id !== lecturePublicId
  ) {
    throw new Error('Archive resume index integrity check failed.')
  }
  return { ...loaded, lookupHash: index.lookup_hash }
}

async function storeLectureArchive(
  env: AssetWorkerEnvironment,
  lookupHash: string,
  archive: StoredLectureArchive,
) {
  const key = archiveKey(lookupHash)
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const existingObject = await env.PDF_BUCKET.get(key)
    if (existingObject) {
      const existingArchive = parseStoredArchive(
        await objectBytes(existingObject),
      )
      if (
        !(await archivePayloadHashMatches(
          existingArchive.payload,
          existingArchive.payload_sha256,
        ))
      ) {
        throw new Error('Stored lecture archive integrity check failed.')
      }
      if (
        isPermanentArchivePayload(existingArchive.payload) &&
        !isPermanentArchivePayload(archive.payload)
      ) {
        throw Object.assign(
          new Error('Permanent lecture archive cannot be downgraded.'),
          { status: 409 },
        )
      }
      if (existingArchive.source_version >= archive.source_version) {
        await storeLectureArchivePublicIndex(env, lookupHash, existingArchive)
        return {
          accepted:
            existingArchive.source_version === archive.source_version &&
            existingArchive.payload_sha256 === archive.payload_sha256,
          sourceVersion: existingArchive.source_version,
        }
      }
    }

    const committed = await env.PDF_BUCKET.put(
      key,
      `${JSON.stringify(archive)}\n`,
      {
        httpMetadata: {
          cacheControl: 'no-store',
          contentType: 'application/json',
        },
        onlyIf: existingObject
          ? { etagMatches: existingObject.etag }
          : { etagDoesNotMatch: '*' },
      },
    )
    if (committed) {
      await storeLectureArchivePublicIndex(env, lookupHash, archive)
      return { accepted: true, sourceVersion: archive.source_version }
    }
  }
  throw Object.assign(new Error('Archive publication conflicted.'), {
    status: 409,
  })
}

async function handleArchiveIngest(
  request: Request,
  env: AssetWorkerEnvironment,
  now: Date,
) {
  const configuration = requireArchiveConfiguration(env)
  const suppliedSecret =
    request.headers.get('Authorization')?.replace(/^Bearer /, '') ?? ''
  if (
    !(await timingSafeStringEqual(configuration.ingestSecret, suppliedSecret))
  ) {
    throw Object.assign(new Error('Archive ingest is unauthorized.'), {
      status: 401,
    })
  }
  const body = await parseBoundedJsonRequest(request, MAX_ARCHIVE_INGEST_BYTES)
  const lectureCode =
    typeof body.lectureCode === 'string'
      ? body.lectureCode.trim().toUpperCase()
      : ''
  const sourceVersion = Number(body.sourceVersion)
  const payloadSha256 =
    typeof body.payloadSha256 === 'string' ? body.payloadSha256 : ''
  let archiveExpiresAt: string
  let payload: PublicLectureArchivePayload
  try {
    archiveExpiresAt = parseIsoTimestamp(
      body.archiveExpiresAt,
      'Archive expiry',
    )
    payload = parsePublicArchivePayload(body.payload)
  } catch {
    throw Object.assign(new Error('Archive ingest contract is invalid.'), {
      status: 400,
    })
  }
  if (
    lectureCode.length < 4 ||
    lectureCode.length > 32 ||
    !/^[A-Z0-9-]+$/.test(lectureCode) ||
    !Number.isSafeInteger(sourceVersion) ||
    sourceVersion < 1 ||
    !/^[0-9a-f]{64}$/.test(payloadSha256) ||
    payload.archive_expires_at !== archiveExpiresAt ||
    Date.parse(payload.closed_at) > now.getTime() + 5 * 60 * 1000 ||
    Date.parse(archiveExpiresAt) <= now.getTime()
  ) {
    throw Object.assign(new Error('Archive ingest contract is invalid.'), {
      status: 400,
    })
  }
  if (!(await archivePayloadHashMatches(payload, payloadSha256))) {
    throw Object.assign(new Error('Archive payload hash does not match.'), {
      status: 400,
    })
  }
  await preservePermanentArchiveDocument(env, payload, now)
  const lookupHash = await createArchiveLookupHash(
    lectureCode,
    configuration.lookupSecret,
  )
  const result = await storeLectureArchive(env, lookupHash, {
    archive_expires_at: archiveExpiresAt,
    payload,
    payload_sha256: payloadSha256,
    published_at: now.toISOString(),
    schema_version: 1,
    source_version: sourceVersion,
  })
  return { lookupHash, ...result }
}

async function createArchiveAccessResult(
  loaded: NonNullable<Awaited<ReturnType<typeof loadLectureArchive>>>,
  lookupHash: string,
  accessSecret: string,
  now: Date,
) {
  const nowSeconds = Math.floor(now.getTime() / 1000)
  const expiresAt = Math.min(
    nowSeconds + 15 * 60,
    isPermanentArchivePayload(loaded.archive.payload)
      ? Number.MAX_SAFE_INTEGER
      : Math.floor(Date.parse(loaded.archive.archive_expires_at) / 1000),
  )
  const archiveAccessToken = await signArchiveAccessToken(
    {
      exp: expiresAt,
      iat: nowSeconds,
      jti: crypto.randomUUID(),
      lec:
        loaded.archive.payload.lecture_public_id ??
        loaded.archive.payload.pdf?.lecture_public_id ??
        'lecture_0000000000000000',
      lookup: lookupHash,
      rev: loaded.archive.payload_sha256,
    },
    accessSecret,
  )
  return {
    archive: loaded.archive.payload,
    archiveAccessToken,
    archiveAccessTokenExpiresAt: new Date(expiresAt * 1000).toISOString(),
    lookupHash,
  }
}

async function handleArchiveResolve(
  request: Request,
  env: AssetWorkerEnvironment,
  now: Date,
  fetcher: typeof fetch,
) {
  const configuration = requireArchiveResolveConfiguration(env)
  let body: Record<string, unknown>
  try {
    body = await parseBoundedJsonRequest(request, MAX_ARCHIVE_RESOLVE_BYTES)
  } catch {
    throw Object.assign(new Error('Archive is unavailable.'), { status: 404 })
  }
  const lectureCode =
    typeof body.lectureCode === 'string'
      ? body.lectureCode.trim().toUpperCase()
      : ''
  const turnstileToken =
    typeof body.turnstileToken === 'string' ? body.turnstileToken : ''
  if (
    lectureCode.length < 4 ||
    lectureCode.length > 32 ||
    !/^[A-Z0-9-]+$/.test(lectureCode)
  ) {
    throw Object.assign(new Error('Archive is unavailable.'), { status: 404 })
  }
  await enforceArchiveRateLimit(request, env, lectureCode)
  if (!(await updateArchiveFailureGuard(request, env, now, 'check'))) {
    throw Object.assign(new Error('Archive is unavailable.'), { status: 404 })
  }
  const turnstileValid = await validateTurnstileToken(
    request,
    env,
    turnstileToken,
    fetcher,
  )
  if (!turnstileValid) {
    throw Object.assign(new Error('Archive is unavailable.'), { status: 404 })
  }

  const lookupHash = await createArchiveLookupHash(
    lectureCode,
    configuration.lookupSecret,
  )
  let loaded: Awaited<ReturnType<typeof loadLectureArchive>>
  try {
    loaded = await loadLectureArchive(env, lookupHash)
  } catch {
    throw Object.assign(new Error('Archive is unavailable.'), { status: 404 })
  }
  if (!loaded) {
    await updateArchiveFailureGuard(request, env, now, 'record_failure')
    throw Object.assign(new Error('Archive is unavailable.'), { status: 404 })
  }
  if (isArchiveExpired(loaded.archive.payload, now)) {
    throw Object.assign(new Error('Archive is unavailable.'), { status: 404 })
  }

  return createArchiveAccessResult(
    loaded,
    lookupHash,
    configuration.accessSecret,
    now,
  )
}

async function handleArchiveResume(
  request: Request,
  env: AssetWorkerEnvironment,
  now: Date,
) {
  let body: Record<string, unknown>
  try {
    body = await parseBoundedJsonRequest(request, MAX_ARCHIVE_RESOLVE_BYTES)
  } catch {
    throw Object.assign(new Error('Archive is unavailable.'), { status: 404 })
  }
  const resumeToken =
    typeof body.resumeToken === 'string' ? body.resumeToken.trim() : ''
  if (resumeToken.length < 80 || resumeToken.length > 2_048) {
    throw Object.assign(new Error('Archive is unavailable.'), { status: 404 })
  }
  const claims = await verifyLectureResumeToken({
    nowSeconds: Math.floor(now.getTime() / 1000),
    secret: requireResumeTokenSecret(env),
    token: resumeToken,
  }).catch(() => null)
  if (!claims) {
    throw Object.assign(new Error('Archive is unavailable.'), { status: 404 })
  }

  let loaded: Awaited<ReturnType<typeof loadLectureArchiveByPublicId>>
  try {
    loaded = await loadLectureArchiveByPublicId(env, claims.lec)
  } catch {
    throw Object.assign(new Error('Archive is unavailable.'), { status: 404 })
  }
  if (
    !loaded ||
    isArchiveExpired(loaded.archive.payload, now) ||
    loaded.archive.payload.resume_token_version !== claims.ver
  ) {
    throw Object.assign(new Error('Archive is unavailable.'), { status: 404 })
  }
  const configuration = requireArchiveConfiguration(env)
  return createArchiveAccessResult(
    loaded,
    loaded.lookupHash,
    configuration.accessSecret,
    now,
  )
}

async function handleArchiveDocumentAccess(
  request: Request,
  env: AssetWorkerEnvironment,
  now: Date,
  lookupHash: string,
  documentId: string,
  documentVersion: string,
  origin: string | null,
) {
  const configuration = requireArchiveConfiguration(env)
  const nowSeconds = Math.floor(now.getTime() / 1000)
  const claims = await verifyArchiveAccessToken({
    nowSeconds,
    secret: configuration.accessSecret,
    token: getBearerToken(request),
  })
  if (claims.lookup !== lookupHash) {
    throw Object.assign(new Error('Archive scope does not match.'), {
      status: 403,
    })
  }
  let loaded: Awaited<ReturnType<typeof loadLectureArchive>>
  try {
    loaded = await loadLectureArchive(env, lookupHash)
  } catch {
    throw Object.assign(new Error('Archive is unavailable.'), { status: 410 })
  }
  if (!loaded || isArchiveExpired(loaded.archive.payload, now)) {
    throw Object.assign(new Error('Archive is unavailable.'), { status: 410 })
  }
  if (claims.rev !== loaded.archive.payload_sha256) {
    throw Object.assign(new Error('Archive access was refreshed.'), {
      status: 401,
    })
  }
  const archivedPdf = loaded.archive.payload.pdf
  if (
    !archivedPdf ||
    archivedPdf.document_id !== documentId ||
    archivedPdf.document_version !== documentVersion ||
    archivedPdf.lecture_public_id !== claims.lec
  ) {
    throw Object.assign(new Error('Archived document is unavailable.'), {
      status: 404,
    })
  }
  const mode =
    new URL(request.url).searchParams.get('mode') === 'download'
      ? 'download'
      : 'inline'
  if (mode === 'download' && !archivedPdf.download_enabled) {
    throw Object.assign(new Error('Download is disabled.'), { status: 403 })
  }
  const manifest = await loadManifest(env, archivedPdf.lecture_public_id)
  if (!manifest) {
    throw Object.assign(new Error('Manifest not found.'), { status: 404 })
  }
  const document = manifest.manifest.documents.find(
    (candidate) =>
      candidate.document_id === documentId &&
      candidate.document_version === documentVersion,
  )
  if (!document || !isDocumentAvailable(document, nowSeconds)) {
    throw Object.assign(new Error('Document is unavailable.'), { status: 410 })
  }
  const expiresAt = Math.min(
    nowSeconds + 5 * 60,
    claims.exp,
    isPermanentArchivePayload(loaded.archive.payload)
      ? Number.MAX_SAFE_INTEGER
      : Math.floor(Date.parse(loaded.archive.archive_expires_at) / 1000),
  )
  const ticket = await signAssetTicket(
    {
      av: manifest.manifest.access_version,
      doc: document.document_id,
      exp: expiresAt,
      jti: crypto.randomUUID(),
      lec: archivedPdf.lecture_public_id,
      mode,
      ver: document.document_version,
    },
    env.PDF_ASSET_TICKET_SECRET,
  )
  const assetUrl = new URL(
    `/v1/lectures/${archivedPdf.lecture_public_id}/documents/${documentId}/${documentVersion}`,
    request.url,
  )
  assetUrl.searchParams.set('ticket', ticket)
  return jsonResponse(
    {
      expiresAt: new Date(expiresAt * 1000).toISOString(),
      url: assetUrl.toString(),
    },
    200,
    origin,
  )
}

function parsePublicJwk(env: AssetWorkerEnvironment) {
  try {
    return JSON.parse(env.PDF_ACCESS_PUBLIC_JWK) as JsonWebKey
  } catch {
    throw new Error('Worker public key is not configured.')
  }
}

function getBearerToken(request: Request) {
  const authorization = request.headers.get('Authorization') ?? ''
  return authorization.startsWith('Bearer ') ? authorization.slice(7) : ''
}

function isDocumentAvailable(
  document: PdfManifest['documents'][number],
  nowSeconds: number,
) {
  return (
    document.visible &&
    (!document.archive_expires_at ||
      Date.parse(document.archive_expires_at) / 1000 > nowSeconds)
  )
}

function safeDispositionName(value: string) {
  const fallback = value
    .normalize('NFKD')
    .replace(/[^A-Za-z0-9._ -]/g, '')
    .trim()
    .slice(0, 80)
  const ascii = fallback.toLowerCase().endsWith('.pdf')
    ? fallback
    : `${fallback || 'lecture-material'}.pdf`
  return `filename="${ascii.replace(/["\\]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(
    value.toLowerCase().endsWith('.pdf') ? value : `${value}.pdf`,
  )}`
}

function parseRange(value: string | null, size: number) {
  if (!value) return null
  const match = /^bytes=(\d*)-(\d*)$/.exec(value)
  if (!match)
    throw Object.assign(new Error('Invalid byte range.'), { status: 416 })
  const startText = match[1]!
  const endText = match[2]!
  if (!startText && !endText)
    throw Object.assign(new Error('Invalid byte range.'), { status: 416 })
  if (!startText) {
    const suffix = Number(endText)
    if (!Number.isInteger(suffix) || suffix < 1)
      throw Object.assign(new Error('Invalid byte range.'), { status: 416 })
    const length = Math.min(suffix, size)
    return { length, offset: size - length }
  }
  const offset = Number(startText)
  const requestedEnd = endText ? Number(endText) : size - 1
  if (
    !Number.isInteger(offset) ||
    !Number.isInteger(requestedEnd) ||
    offset < 0 ||
    offset >= size ||
    requestedEnd < offset
  ) {
    throw Object.assign(new Error('Invalid byte range.'), { status: 416 })
  }
  return { length: Math.min(requestedEnd, size - 1) - offset + 1, offset }
}

async function authorizeLecture(
  request: Request,
  env: AssetWorkerEnvironment,
  lecturePublicId: string,
  nowSeconds: number,
) {
  const claims = await verifyLectureToken({
    audience: env.PDF_ACCESS_AUDIENCE,
    issuer: env.PDF_ACCESS_ISSUER,
    nowSeconds,
    publicJwk: parsePublicJwk(env),
    token: getBearerToken(request),
  })
  if (claims.lec !== lecturePublicId) {
    throw Object.assign(new Error('Lecture scope does not match.'), {
      status: 403,
    })
  }
  return claims
}

async function handleFetch(
  request: Request,
  env: AssetWorkerEnvironment,
  now = new Date(),
  fetcher: typeof fetch = fetch,
) {
  const origin = requireAllowedOrigin(request, env)
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Headers':
          'Authorization, Content-Type, Range, X-Compass-Client-Id',
        'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS, POST, PUT',
        'Access-Control-Allow-Origin': origin ?? 'null',
        'Access-Control-Max-Age': '600',
        Vary: 'Origin',
      },
      status: 204,
    })
  }
  const nowSeconds = Math.floor(now.getTime() / 1000)
  const url = new URL(request.url)
  const publicationResponse = await handlePdfPublicationRequest({
    env,
    fetcher,
    now,
    origin,
    request,
  })
  if (publicationResponse) return publicationResponse
  if (request.method === 'POST' && url.pathname === '/internal/v1/archives') {
    const result = await handleArchiveIngest(request, env, now)
    return jsonResponse({ ok: true, ...result }, 200, null)
  }

  if (request.method === 'POST' && url.pathname === '/v1/archives/resolve') {
    if (!origin) {
      throw Object.assign(new Error('Origin is required.'), { status: 403 })
    }
    const result = await handleArchiveResolve(request, env, now, fetcher)
    return jsonResponse({ ok: true, ...result }, 200, origin)
  }

  if (request.method === 'POST' && url.pathname === '/v1/archives/resume') {
    if (!origin) {
      throw Object.assign(new Error('Origin is required.'), { status: 403 })
    }
    const result = await handleArchiveResume(request, env, now)
    return jsonResponse({ ok: true, ...result }, 200, origin)
  }

  const archiveDocumentAccessMatch = url.pathname.match(
    /^\/v1\/archives\/([0-9a-f]{64})\/documents\/([a-z0-9][a-z0-9-]{0,63})\/([0-9a-f]{64})\/access$/,
  )
  if (request.method === 'GET' && archiveDocumentAccessMatch) {
    const [, lookupHash, documentId, documentVersion] =
      archiveDocumentAccessMatch
    return handleArchiveDocumentAccess(
      request,
      env,
      now,
      lookupHash!,
      documentId!,
      documentVersion!,
      origin,
    )
  }

  const manifestMatch = url.pathname.match(
    /^\/v1\/lectures\/(lecture_[a-z0-9]{16,64})\/manifest$/,
  )
  if (request.method === 'GET' && manifestMatch) {
    const lecturePublicId = manifestMatch[1]!
    const claims = await authorizeLecture(
      request,
      env,
      lecturePublicId,
      nowSeconds,
    )
    const loaded = await loadManifest(env, lecturePublicId)
    if (!loaded)
      return jsonResponse({ message: 'Manifest not found.' }, 404, origin)
    if (loaded.manifest.access_version !== claims.av) {
      throw Object.assign(new Error('Lecture access was revoked.'), {
        status: 401,
      })
    }
    if (loaded.manifest.manifest_version < claims.mv) {
      throw Object.assign(
        new Error('Manifest publication is not yet visible.'),
        { status: 409 },
      )
    }
    return jsonResponse(toPublicManifest(loaded.manifest), 200, origin, {
      ETag: loaded.object.httpEtag,
    })
  }

  const accessMatch = url.pathname.match(
    /^\/v1\/lectures\/(lecture_[a-z0-9]{16,64})\/documents\/([a-z0-9][a-z0-9-]{0,63})\/([0-9a-f]{64})\/access$/,
  )
  if (request.method === 'GET' && accessMatch) {
    const [, lecturePublicId, documentId, documentVersion] = accessMatch
    const claims = await authorizeLecture(
      request,
      env,
      lecturePublicId!,
      nowSeconds,
    )
    const loaded = await loadManifest(env, lecturePublicId!)
    if (!loaded)
      return jsonResponse({ message: 'Manifest not found.' }, 404, origin)
    if (loaded.manifest.access_version !== claims.av) {
      throw Object.assign(new Error('Lecture access was revoked.'), {
        status: 401,
      })
    }
    if (loaded.manifest.manifest_version < claims.mv) {
      throw Object.assign(
        new Error('Manifest publication is not yet visible.'),
        { status: 409 },
      )
    }
    const document = loaded.manifest.documents.find(
      (candidate) =>
        candidate.document_id === documentId &&
        candidate.document_version === documentVersion,
    )
    if (!document || !isDocumentAvailable(document, nowSeconds)) {
      throw Object.assign(new Error('Document is unavailable.'), {
        status: 410,
      })
    }
    const mode =
      url.searchParams.get('mode') === 'download' ? 'download' : 'inline'
    if (mode === 'download' && !document.download_enabled) {
      throw Object.assign(new Error('Download is disabled.'), { status: 403 })
    }
    const documentExpiry = document.archive_expires_at
      ? Math.floor(Date.parse(document.archive_expires_at) / 1000)
      : Number.POSITIVE_INFINITY
    const expiresAt = Math.min(nowSeconds + 5 * 60, claims.exp, documentExpiry)
    const ticket = await signAssetTicket(
      {
        av: claims.av,
        doc: document.document_id,
        exp: expiresAt,
        jti: crypto.randomUUID(),
        lec: lecturePublicId!,
        mode,
        ver: document.document_version,
      },
      env.PDF_ASSET_TICKET_SECRET,
    )
    const assetUrl = new URL(
      `/v1/lectures/${lecturePublicId}/documents/${documentId}/${documentVersion}`,
      url.origin,
    )
    assetUrl.searchParams.set('ticket', ticket)
    return jsonResponse(
      {
        expiresAt: new Date(expiresAt * 1000).toISOString(),
        url: assetUrl.toString(),
      },
      200,
      origin,
    )
  }

  const assetMatch = url.pathname.match(
    /^\/v1\/lectures\/(lecture_[a-z0-9]{16,64})\/documents\/([a-z0-9][a-z0-9-]{0,63})\/([0-9a-f]{64})$/,
  )
  if ((request.method === 'GET' || request.method === 'HEAD') && assetMatch) {
    const [, lecturePublicId, documentId, documentVersion] = assetMatch
    const ticket = await verifyAssetTicket({
      nowSeconds,
      secret: env.PDF_ASSET_TICKET_SECRET,
      ticket: url.searchParams.get('ticket') ?? '',
    })
    if (
      ticket.lec !== lecturePublicId ||
      ticket.doc !== documentId ||
      ticket.ver !== documentVersion
    ) {
      throw Object.assign(new Error('Asset ticket scope does not match.'), {
        status: 403,
      })
    }
    const loaded = await loadManifest(env, lecturePublicId!)
    if (!loaded || loaded.manifest.access_version !== ticket.av) {
      throw Object.assign(new Error('Asset access was revoked.'), {
        status: 401,
      })
    }
    const document = loaded.manifest.documents.find(
      (candidate) =>
        candidate.document_id === documentId &&
        candidate.document_version === documentVersion,
    )
    if (!document || !isDocumentAvailable(document, nowSeconds)) {
      throw Object.assign(new Error('Document is unavailable.'), {
        status: 410,
      })
    }
    if (ticket.mode === 'download' && !document.download_enabled) {
      throw Object.assign(new Error('Download is disabled.'), { status: 403 })
    }
    const head = await env.PDF_BUCKET.head(document.object_key)
    if (!head)
      return jsonResponse(
        { message: 'Document object not found.' },
        404,
        origin,
      )
    if (request.headers.get('If-None-Match') === head.httpEtag) {
      return new Response(null, { status: 304 })
    }
    const range = parseRange(request.headers.get('Range'), head.size)
    const object =
      request.method === 'HEAD'
        ? head
        : await env.PDF_BUCKET.get(
            document.object_key,
            range ? { range } : undefined,
          )
    if (!object)
      return jsonResponse(
        { message: 'Document object not found.' },
        404,
        origin,
      )
    const headers = new Headers({
      'Accept-Ranges': 'bytes',
      'Access-Control-Allow-Origin': origin ?? '*',
      'Cache-Control': 'private, max-age=300',
      'Content-Disposition': `${ticket.mode}; ${safeDispositionName(document.display_name)}`,
      'Content-Length': String(range?.length ?? head.size),
      'Content-Type': 'application/pdf',
      ETag: head.httpEtag,
      Vary: 'Origin',
      'X-Content-Type-Options': 'nosniff',
    })
    if (range) {
      headers.set(
        'Content-Range',
        `bytes ${range.offset}-${range.offset + range.length - 1}/${head.size}`,
      )
    }
    return new Response(request.method === 'HEAD' ? null : object.body, {
      headers,
      status: range ? 206 : 200,
    })
  }

  return jsonResponse({ message: 'Not found.' }, 404, origin)
}

export async function cleanupExpiredDocuments(
  env: AssetWorkerEnvironment,
  now = new Date(),
  limit = 50,
) {
  const deletionLimit = Math.max(1, Math.min(limit, 500))
  const recovered = await recoverPendingCleanups(env, now, deletionLimit)
  let deleted = recovered.deleted
  let processed = recovered.processed
  let conflicts = 0
  let scanned = 0
  let cursor: string | undefined
  let truncated = false
  do {
    const listed = await env.PDF_BUCKET.list({
      cursor,
      limit: Math.min(1000, 5000 - scanned),
      prefix: 'manifests/',
    })
    scanned += listed.objects.length
    for (const summary of listed.objects) {
      if (processed + conflicts >= deletionLimit) break
      const object = await env.PDF_BUCKET.get(summary.key)
      if (!object) continue
      const manifest = decodeManifest(await objectBytes(object))
      const due = manifest.documents
        .filter(
          (document) =>
            document.delete_after !== null &&
            Date.parse(document.delete_after) <= now.getTime(),
        )
        .slice(0, deletionLimit - processed - conflicts)
      if (due.length === 0) continue
      const intents = due.map((document): CleanupIntent => ({
        document_id: document.document_id,
        document_version: document.document_version,
        lecture_public_id: manifest.lecture_public_id,
        object_key: document.object_key,
        requested_at: now.toISOString(),
        schema_version: 1,
      }))
      for (const intent of intents) {
        await env.PDF_BUCKET.put(
          cleanupIntentKey(intent),
          `${JSON.stringify(intent)}\n`,
          { httpMetadata: { contentType: 'application/json' } },
        )
      }
      const nextManifest = parseManifest({
        ...manifest,
        documents: manifest.documents.filter(
          (document) => !due.includes(document),
        ),
        manifest_version: manifest.manifest_version + 1,
        updated_at: now.toISOString(),
      })
      const committed = await env.PDF_BUCKET.put(
        summary.key,
        encodeManifest(nextManifest),
        {
          httpMetadata: {
            cacheControl: 'no-store',
            contentType: 'application/json',
          },
          onlyIf: { etagMatches: object.etag },
        },
      )
      if (!committed) {
        // Every due document already consumed one intent PUT and one cleanup
        // attempt, even though the manifest CAS lost. Charge the budget per
        // document so one large conflicting manifest cannot make this pass
        // retry O(limit^2) intents across later manifests.
        conflicts += intents.length
        for (const intent of intents) {
          await env.PDF_BUCKET.delete(cleanupIntentKey(intent))
        }
        continue
      }
      for (const intent of intents) {
        if (!isBrowserPublicationObjectKey(intent)) {
          await env.PDF_BUCKET.delete(intent.object_key)
          if (await writeDeletionAudit(env, intent, now)) deleted += 1
        }
        await env.PDF_BUCKET.delete(cleanupIntentKey(intent))
        processed += 1
      }
    }
    truncated = listed.truncated
    cursor = listed.cursor
  } while (
    truncated &&
    cursor &&
    scanned < 5000 &&
    processed + conflicts < deletionLimit
  )
  return {
    conflicts,
    deleted,
    pendingScanned: recovered.scanned,
    processed,
    scanned,
  }
}

export async function cleanupExpiredLectureArchives(
  env: AssetWorkerEnvironment,
  now = new Date(),
  limit = 50,
) {
  const deletionLimit = Math.max(1, Math.min(limit, 500))
  let deleted = 0
  let invalid = 0
  let scanned = 0
  let cursor: string | undefined
  let truncated = false
  do {
    const listed = await env.PDF_BUCKET.list({
      cursor,
      limit: Math.min(1000, 5000 - scanned),
      prefix: 'archives/by-code/',
    })
    scanned += listed.objects.length
    for (const summary of listed.objects) {
      if (deleted >= deletionLimit) break
      const object = await env.PDF_BUCKET.get(summary.key)
      if (!object) continue
      try {
        const archive = parseStoredArchive(await objectBytes(object))
        if (
          !(await archivePayloadHashMatches(
            archive.payload,
            archive.payload_sha256,
          ))
        ) {
          throw new Error('Stored lecture archive integrity check failed.')
        }
        if (isPermanentArchivePayload(archive.payload)) {
          continue
        }
        if (
          Date.parse(archive.archive_expires_at) + 7 * 24 * 60 * 60 * 1000 >
          now.getTime()
        ) {
          continue
        }
        if (archive.payload.lecture_public_id) {
          await env.PDF_BUCKET.delete(
            archivePublicIndexKey(archive.payload.lecture_public_id),
          )
        }
        await env.PDF_BUCKET.delete(summary.key)
        deleted += 1
      } catch {
        invalid += 1
      }
    }
    truncated = listed.truncated
    cursor = listed.cursor
  } while (truncated && cursor && scanned < 5000 && deleted < deletionLimit)
  return { deleted, invalid, scanned }
}

export function createAssetWorker(
  now: () => Date = () => new Date(),
  fetcher: typeof fetch = fetch,
) {
  return {
    async fetch(request: Request, env: AssetWorkerEnvironment) {
      try {
        return await handleFetch(request, env, now(), fetcher)
      } catch (error) {
        const status =
          error && typeof error === 'object' && 'status' in error
            ? Number(error.status)
            : error instanceof Error && /token|ticket/i.test(error.message)
              ? 401
              : 500
        return jsonResponse(
          {
            message: error instanceof Error ? error.message : 'Request failed.',
          },
          status,
          getAllowedOrigin(request, env),
        )
      }
    },
    async scheduled(_event: unknown, env: AssetWorkerEnvironment) {
      let firstError: unknown
      try {
        await syncRetentionMetadata(env)
      } catch (error) {
        firstError = error
      }
      try {
        await cleanupExpiredDocuments(env, now())
      } catch (error) {
        firstError ??= error
      }
      try {
        await cleanupExpiredPdfPublications(env, now(), 25, fetcher)
      } catch (error) {
        firstError ??= error
      }
      try {
        const cleanup = await cleanupExpiredLectureArchives(env, now())
        if (cleanup.invalid > 0) {
          console.warn(
            `Archive cleanup skipped ${cleanup.invalid} invalid R2 object(s).`,
          )
        }
      } catch (error) {
        firstError ??= error
      }
      if (firstError) throw firstError
    },
  }
}

export default createAssetWorker()
