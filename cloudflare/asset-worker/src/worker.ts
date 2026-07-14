import {
  decodeManifest,
  encodeManifest,
  parseManifest,
  toPublicManifest,
} from '../../../publisher/src/manifest/manifest.ts'
import type { PdfManifest } from '../../../publisher/src/manifest/types.ts'
import {
  signAssetTicket,
  verifyAssetTicket,
  verifyLectureToken,
} from './crypto.ts'
import type { R2BucketLike, R2ObjectLike } from './r2Types.ts'

export type AssetWorkerEnvironment = {
  ALLOWED_ORIGINS: string
  PDF_ACCESS_AUDIENCE: string
  PDF_ACCESS_ISSUER: string
  PDF_ACCESS_PUBLIC_JWK: string
  PDF_ASSET_TICKET_SECRET: string
  PDF_BUCKET: R2BucketLike
  PDF_RETENTION_FEED_URL?: string
  PDF_RETENTION_SYNC_SECRET?: string
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

type CleanupIntent = {
  document_id: string
  document_version: string
  lecture_public_id: string
  object_key: string
  requested_at: string
  schema_version: 1
}

function cleanupIntentKey(intent: CleanupIntent) {
  return `cleanup-pending/${intent.lecture_public_id}/${intent.document_version}.json`
}

function parseCleanupIntent(value: Uint8Array): CleanupIntent {
  const intent = JSON.parse(new TextDecoder().decode(value)) as CleanupIntent
  const expectedObjectKey = `pdf/${intent.lecture_public_id}/${intent.document_id}/${intent.document_version}.pdf`
  if (
    intent.schema_version !== 1 ||
    !/^lecture_[a-z0-9]{16,64}$/.test(intent.lecture_public_id) ||
    !/^[a-z0-9][a-z0-9-]{0,63}$/.test(intent.document_id) ||
    !/^[0-9a-f]{64}$/.test(intent.document_version) ||
    intent.object_key !== expectedObjectKey ||
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
  const auditKey = `audit/${intent.lecture_public_id}/${intent.document_version}.json`
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
  for (const summary of listed.objects) {
    if (deleted >= limit) break
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
      continue
    }
    await env.PDF_BUCKET.delete(intent.object_key)
    if (await writeDeletionAudit(env, intent, now)) deleted += 1
    await env.PDF_BUCKET.delete(summary.key)
  }
  return { deleted, scanned: listed.objects.length }
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
) {
  const origin = requireAllowedOrigin(request, env)
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Headers': 'Authorization, Content-Type, Range',
        'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
        'Access-Control-Allow-Origin': origin ?? 'null',
        'Access-Control-Max-Age': '600',
        Vary: 'Origin',
      },
      status: 204,
    })
  }
  const nowSeconds = Math.floor(now.getTime() / 1000)
  const url = new URL(request.url)
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
      if (deleted + conflicts >= deletionLimit) break
      const object = await env.PDF_BUCKET.get(summary.key)
      if (!object) continue
      const manifest = decodeManifest(await objectBytes(object))
      const due = manifest.documents
        .filter(
          (document) =>
            document.delete_after !== null &&
            Date.parse(document.delete_after) <= now.getTime(),
        )
        .slice(0, deletionLimit - deleted - conflicts)
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
        conflicts += 1
        for (const intent of intents) {
          await env.PDF_BUCKET.delete(cleanupIntentKey(intent))
        }
        continue
      }
      for (const intent of intents) {
        await env.PDF_BUCKET.delete(intent.object_key)
        if (await writeDeletionAudit(env, intent, now)) deleted += 1
        await env.PDF_BUCKET.delete(cleanupIntentKey(intent))
      }
    }
    truncated = listed.truncated
    cursor = listed.cursor
  } while (
    truncated &&
    cursor &&
    scanned < 5000 &&
    deleted + conflicts < deletionLimit
  )
  return {
    conflicts,
    deleted,
    pendingScanned: recovered.scanned,
    scanned,
  }
}

export function createAssetWorker(now: () => Date = () => new Date()) {
  return {
    async fetch(request: Request, env: AssetWorkerEnvironment) {
      try {
        return await handleFetch(request, env, now())
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
      let synchronizationError: unknown
      try {
        await syncRetentionMetadata(env)
      } catch (error) {
        synchronizationError = error
      }
      await cleanupExpiredDocuments(env, now())
      if (synchronizationError) throw synchronizationError
    },
  }
}

export default createAssetWorker()
