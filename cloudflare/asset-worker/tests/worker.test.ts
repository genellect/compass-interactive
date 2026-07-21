import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import test from 'node:test'
import {
  decodeManifest,
  encodeManifest,
} from '../../../publisher/src/manifest/manifest.ts'
import type { PdfManifest } from '../../../publisher/src/manifest/types.ts'
import {
  sanitizeArchiveExportClaim,
  sha256CanonicalJson,
} from '../../../supabase/functions/_shared/archiveExport.ts'
import {
  createArchiveLookupHash,
  signLectureResumeToken,
} from '../src/crypto.ts'
import {
  ArchiveFailureGuard,
  cleanupExpiredLectureArchives,
  cleanupExpiredDocuments,
  createAssetWorker,
  syncRetentionMetadata,
  type AssetWorkerEnvironment,
} from '../src/worker.ts'
import { cleanupExpiredPdfPublications } from '../src/pdfPublication.ts'
import type { R2BucketLike, R2ObjectLike } from '../src/r2Types.ts'

class FakeR2 implements R2BucketLike {
  objects = new Map<
    string,
    {
      bytes: Uint8Array
      customMetadata?: Record<string, string>
      etag: string
      sha256: ArrayBuffer
    }
  >()
  failNextConditional = false
  failNextDeleteKey: string | null = null
  getCalls: string[] = []
  listPageSize: number | null = null

  async delete(key: string) {
    if (this.failNextDeleteKey === key) {
      this.failNextDeleteKey = null
      throw new Error('simulated delete interruption')
    }
    this.objects.delete(key)
  }

  #object(
    key: string,
    stored: {
      bytes: Uint8Array
      customMetadata?: Record<string, string>
      etag: string
      sha256: ArrayBuffer
    },
    range?: { length?: number; offset?: number },
  ) {
    const offset = range?.offset ?? 0
    const length = range?.length ?? stored.bytes.byteLength - offset
    const bytes = stored.bytes.slice(offset, offset + length)
    return {
      arrayBuffer: async () =>
        bytes.buffer.slice(
          bytes.byteOffset,
          bytes.byteOffset + bytes.byteLength,
        ),
      body: new Blob([bytes]).stream(),
      checksums: { sha256: stored.sha256 },
      customMetadata: stored.customMetadata,
      etag: stored.etag,
      httpEtag: `"${stored.etag}"`,
      key,
      range: { length: bytes.byteLength, offset },
      size: stored.bytes.byteLength,
    } satisfies R2ObjectLike
  }

  async get(
    key: string,
    options?: { range?: { length?: number; offset?: number; suffix?: number } },
  ) {
    this.getCalls.push(key)
    const stored = this.objects.get(key)
    return stored ? this.#object(key, stored, options?.range) : null
  }

  async head(key: string) {
    const stored = this.objects.get(key)
    return stored ? this.#object(key, stored) : null
  }

  async list(options: { cursor?: string; limit?: number; prefix: string }) {
    const matching = [...this.objects.entries()]
      .filter(([key]) => key.startsWith(options.prefix))
      .sort(([left], [right]) => left.localeCompare(right))
    const offset = Number(options.cursor ?? 0)
    const limit = Math.min(
      options.limit ?? 1000,
      this.listPageSize ?? Number.POSITIVE_INFINITY,
    )
    const selected = matching.slice(offset, offset + limit)
    const objects = selected.map(([key, stored]) => this.#object(key, stored))
    const nextOffset = offset + selected.length
    return {
      cursor: nextOffset < matching.length ? String(nextOffset) : undefined,
      objects,
      truncated: nextOffset < matching.length,
    }
  }

  async put(
    key: string,
    value: ReadableStream | Uint8Array | string,
    options?: {
      customMetadata?: Record<string, string>
      onlyIf?: { etagMatches?: string; etagDoesNotMatch?: string }
      sha256?: ArrayBuffer | string
    },
  ) {
    const existing = this.objects.get(key)
    if (this.failNextConditional && options?.onlyIf?.etagMatches) {
      this.failNextConditional = false
      return null
    }
    if (
      options?.onlyIf?.etagMatches &&
      existing?.etag !== options.onlyIf.etagMatches
    ) {
      return null
    }
    if (options?.onlyIf?.etagDoesNotMatch === '*' && existing) {
      return null
    }
    const bytes =
      typeof value === 'string'
        ? new TextEncoder().encode(value)
        : value instanceof Uint8Array
          ? value
          : new Uint8Array(await new Response(value).arrayBuffer())
    const etag = createHash('sha256').update(bytes).digest('hex')
    const sha256 = Uint8Array.from(Buffer.from(etag, 'hex')).buffer
    const expectedSha =
      typeof options?.sha256 === 'string'
        ? options.sha256
        : options?.sha256
          ? Buffer.from(options.sha256).toString('hex')
          : null
    if (expectedSha && expectedSha !== etag) {
      throw new Error('R2 checksum mismatch')
    }
    const stored = {
      bytes,
      customMetadata: options?.customMetadata,
      etag,
      sha256,
    }
    this.objects.set(key, stored)
    return this.#object(key, stored)
  }
}

class FakeArchiveFailureNamespace {
  readonly guards = new Map<string, ArchiveFailureGuard>()
  readonly storageById = new Map<string, Map<string, unknown>>()

  idFromName(name: string) {
    return name
  }

  get(id: unknown) {
    const key = String(id)
    let guard = this.guards.get(key)
    if (!guard) {
      const storageValues = new Map<string, unknown>()
      this.storageById.set(key, storageValues)
      guard = new ArchiveFailureGuard({
        storage: {
          get: async <T>(storageKey: string) =>
            storageValues.get(storageKey) as T | undefined,
          put: async <T>(storageKey: string, value: T) => {
            storageValues.set(storageKey, value)
          },
        },
      })
      this.guards.set(key, guard)
    }
    return {
      fetch: (request: Request) => guard.fetch(request),
    }
  }
}

function b64url(bytes: Uint8Array) {
  return Buffer.from(bytes).toString('base64url')
}

async function createLectureToken(input: {
  accessUntil?: number
  accessVersion?: number
  audience: string
  expiresAt: number
  issuer: string
  key: CryptoKey
  lecture: string
  manifestVersion?: number
  now: number
}) {
  const header = b64url(
    new TextEncoder().encode(JSON.stringify({ alg: 'ES256', typ: 'JWT' })),
  )
  const payload = b64url(
    new TextEncoder().encode(
      JSON.stringify({
        ...(input.accessUntil ? { access_until: input.accessUntil } : {}),
        aud: input.audience,
        av: input.accessVersion ?? 1,
        exp: input.expiresAt,
        iat: input.now,
        iss: input.issuer,
        jti: crypto.randomUUID(),
        lec: input.lecture,
        mv: input.manifestVersion ?? 1,
        nbf: input.now - 1,
      }),
    ),
  )
  const signature = await crypto.subtle.sign(
    { hash: 'SHA-256', name: 'ECDSA' },
    input.key,
    new TextEncoder().encode(`${header}.${payload}`),
  )
  return `${header}.${payload}.${b64url(new Uint8Array(signature))}`
}

async function createPublicationToken(
  key: CryptoKey,
  claims: Record<string, unknown>,
) {
  const header = b64url(
    new TextEncoder().encode(JSON.stringify({ alg: 'ES256', typ: 'JWT' })),
  )
  const payload = b64url(
    new TextEncoder().encode(JSON.stringify(claims)),
  )
  const signature = await crypto.subtle.sign(
    { hash: 'SHA-256', name: 'ECDSA' },
    key,
    new TextEncoder().encode(`${header}.${payload}`),
  )
  return `${header}.${payload}.${b64url(new Uint8Array(signature))}`
}

async function fixture() {
  const now = Math.floor(Date.parse('2026-07-14T00:00:00.000Z') / 1000)
  const keys = await crypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    ['sign', 'verify'],
  )
  const publicJwk = await crypto.subtle.exportKey('jwk', keys.publicKey)
  const r2 = new FakeR2()
  const lecture = 'lecture_1234567890abcdef'
  const version = 'a'.repeat(64)
  const objectKey = `pdf/${lecture}/doc-main/${version}.pdf`
  const manifest: PdfManifest = {
    access_version: 1,
    documents: [
      {
        archive_expires_at: new Date((now + 3600) * 1000).toISOString(),
        byte_size: 10,
        delete_after: new Date((now + 3600 + 7 * 86400) * 1000).toISOString(),
        display_name: 'Main material',
        document_id: 'doc-main',
        document_version: version,
        download_enabled: true,
        object_key: objectKey,
        page_count: 3,
        pdf_sha256: version,
        text_char_count: 100,
        text_sha256: 'b'.repeat(64),
        visible: true,
      },
      {
        archive_expires_at: null,
        byte_size: 10,
        delete_after: null,
        display_name: 'Retired material',
        document_id: 'doc-retired',
        document_version: 'c'.repeat(64),
        download_enabled: false,
        object_key: `pdf/${lecture}/doc-retired/${'c'.repeat(64)}.pdf`,
        page_count: 3,
        pdf_sha256: 'c'.repeat(64),
        text_char_count: 100,
        text_sha256: 'd'.repeat(64),
        visible: false,
      },
    ],
    lecture_public_id: lecture,
    manifest_version: 1,
    schema_version: 1,
    updated_at: new Date(now * 1000).toISOString(),
  }
  await r2.put(`manifests/${lecture}/manifest.json`, encodeManifest(manifest))
  await r2.put(objectKey, new TextEncoder().encode('0123456789'))
  const env: AssetWorkerEnvironment = {
    ALLOWED_ORIGINS: 'https://compass.example',
    PDF_ACCESS_AUDIENCE: 'compass-pdf-worker',
    PDF_ACCESS_ISSUER: 'compass-supabase',
    PDF_ACCESS_PUBLIC_JWK: JSON.stringify(publicJwk),
    PDF_ASSET_TICKET_SECRET: 'test-secret-at-least-thirty-two-bytes-long',
    PDF_BUCKET: r2,
  }
  const token = await createLectureToken({
    accessUntil: now + 3600,
    audience: env.PDF_ACCESS_AUDIENCE,
    expiresAt: now + 600,
    issuer: env.PDF_ACCESS_ISSUER,
    key: keys.privateKey,
    lecture,
    now,
  })
  return { env, keys, lecture, manifest, now, objectKey, r2, token, version }
}

function archivePayload(
  value: Awaited<ReturnType<typeof fixture>>,
  overrides: Record<string, unknown> = {},
) {
  return {
    archive_expires_at: new Date((value.now + 30 * 86400) * 1000).toISOString(),
    closed_at: new Date((value.now - 60) * 1000).toISOString(),
    comments: [
      {
        body: 'Archived student comment',
        created_at: new Date((value.now - 120) * 1000).toISOString(),
        id: '20000000-0000-4000-8000-000000000066',
        is_pinned: false,
        like_count: 2,
        nickname: null,
      },
    ],
    comments_has_more: false,
    participant_count_approximate: 20,
    pdf: {
      current_page: 2,
      display_name: 'Main material',
      document_id: 'doc-main',
      document_version: value.version,
      download_enabled: true,
      lecture_public_id: value.lecture,
      manifest_version: 1,
      page_count: 3,
    },
    polls: [],
    schema_version: 1,
    started_at: new Date((value.now - 3600) * 1000).toISOString(),
    summaries: [],
    title: 'Archived lecture',
    ...overrides,
  }
}

async function sha256Json(value: unknown) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

function enableArchiveEnvironment(
  value: Awaited<ReturnType<typeof fixture>>,
  options: { clientAllowed?: boolean; ipAllowed?: boolean } = {},
) {
  const clientKeys: string[] = []
  const ipKeys: string[] = []
  const failureGuard = new FakeArchiveFailureNamespace()
  Object.assign(value.env, {
    ARCHIVE_ACCESS_SECRET: 'archive-access-secret-at-least-32-bytes-long',
    ARCHIVE_CODE_LOOKUP_SECRET: 'archive-lookup-secret-at-least-32-bytes-long',
    ARCHIVE_FAILURE_GUARD: failureGuard,
    ARCHIVE_INGEST_SECRET: 'archive-ingest-secret-at-least-32-bytes-long',
    LECTURE_RESUME_TOKEN_SECRET: 'lecture-resume-secret-at-least-32-bytes-long',
    ARCHIVE_IP_RATE_LIMITER: {
      limit: async ({ key }: { key: string }) => {
        ipKeys.push(key)
        return { success: options.ipAllowed !== false }
      },
    },
    ARCHIVE_RATE_LIMITER: {
      limit: async ({ key }: { key: string }) => {
        clientKeys.push(key)
        return { success: options.clientAllowed !== false }
      },
    },
    TURNSTILE_EXPECTED_HOSTNAME: 'compass.example',
    TURNSTILE_SECRET_KEY: 'turnstile-secret-at-least-16-bytes',
  })
  return { clientKeys, failureGuard, ipKeys }
}

async function ingestArchive(input: {
  code?: string
  payload: Record<string, unknown>
  sourceVersion?: number
  value: Awaited<ReturnType<typeof fixture>>
  worker: ReturnType<typeof createAssetWorker>
}) {
  const body = {
    archiveExpiresAt: input.payload.archive_expires_at,
    lectureCode: input.code ?? '285463',
    payload: input.payload,
    payloadSha256: await sha256Json(input.payload),
    sourceVersion: input.sourceVersion ?? 1,
  }
  return input.worker.fetch(
    new Request('https://pdf.example/internal/v1/archives', {
      body: JSON.stringify(body),
      headers: {
        Authorization: `Bearer ${input.value.env.ARCHIVE_INGEST_SECRET}`,
        'Content-Type': 'application/json',
      },
      method: 'POST',
    }),
    input.value.env,
  )
}

test('verifies lecture scope, returns a private manifest and streams a byte range', async () => {
  const value = await fixture()
  const worker = createAssetWorker(() => new Date(value.now * 1000))
  const manifestResponse = await worker.fetch(
    new Request(`https://pdf.example/v1/lectures/${value.lecture}/manifest`, {
      headers: {
        Authorization: `Bearer ${value.token}`,
        Origin: 'https://compass.example',
      },
    }),
    value.env,
  )
  assert.equal(manifestResponse.status, 200)
  const publicManifest = (await manifestResponse.json()) as Record<
    string,
    unknown
  >
  assert.equal(JSON.stringify(publicManifest).includes('object_key'), false)
  assert.equal(JSON.stringify(publicManifest).includes('pdf_sha256'), false)
  assert.equal((publicManifest.documents as unknown[]).length, 1)
  assert.equal(
    JSON.stringify(publicManifest).includes('Retired material'),
    false,
  )

  const accessResponse = await worker.fetch(
    new Request(
      `https://pdf.example/v1/lectures/${value.lecture}/documents/doc-main/${value.version}/access?mode=inline`,
      {
        headers: {
          Authorization: `Bearer ${value.token}`,
          Origin: 'https://compass.example',
        },
      },
    ),
    value.env,
  )
  assert.equal(accessResponse.status, 200)
  const { url } = (await accessResponse.json()) as { url: string }
  assert.equal(url.includes(value.token), false)
  const rangeResponse = await worker.fetch(
    new Request(url, {
      headers: { Origin: 'https://compass.example', Range: 'bytes=2-5' },
    }),
    value.env,
  )
  assert.equal(rangeResponse.status, 206)
  assert.equal(rangeResponse.headers.get('Content-Range'), 'bytes 2-5/10')
  assert.equal(await rangeResponse.text(), '2345')

  const originlessAssetResponse = await worker.fetch(
    new Request(url),
    value.env,
  )
  assert.equal(originlessAssetResponse.status, 200)
  assert.equal(
    originlessAssetResponse.headers.get('Access-Control-Allow-Origin'),
    '*',
  )
})

test('rejects cross-lecture use, hostile Origin, disabled download and expiry', async () => {
  const value = await fixture()
  const worker = createAssetWorker(() => new Date(value.now * 1000))
  const mismatch = await worker.fetch(
    new Request(
      'https://pdf.example/v1/lectures/lecture_ffffffffffffffff/manifest',
      {
        headers: {
          Authorization: `Bearer ${value.token}`,
          Origin: 'https://compass.example',
        },
      },
    ),
    value.env,
  )
  assert.equal(mismatch.status, 403)
  const hostile = await worker.fetch(
    new Request(`https://pdf.example/v1/lectures/${value.lecture}/manifest`, {
      headers: {
        Authorization: `Bearer ${value.token}`,
        Origin: 'https://evil.example',
      },
    }),
    value.env,
  )
  assert.equal(hostile.status, 403)

  value.manifest.documents[0]!.download_enabled = false
  await value.r2.put(
    `manifests/${value.lecture}/manifest.json`,
    encodeManifest(value.manifest),
  )
  const disabled = await worker.fetch(
    new Request(
      `https://pdf.example/v1/lectures/${value.lecture}/documents/doc-main/${value.version}/access?mode=download`,
      {
        headers: {
          Authorization: `Bearer ${value.token}`,
          Origin: 'https://compass.example',
        },
      },
    ),
    value.env,
  )
  assert.equal(disabled.status, 403)

  const expiredWorker = createAssetWorker(
    () => new Date((value.now + 601) * 1000),
  )
  const expired = await expiredWorker.fetch(
    new Request(`https://pdf.example/v1/lectures/${value.lecture}/manifest`, {
      headers: {
        Authorization: `Bearer ${value.token}`,
        Origin: 'https://compass.example',
      },
    }),
    value.env,
  )
  assert.equal(expired.status, 401)
})

test('37-day cleanup is conflict-safe and idempotent', async () => {
  const value = await fixture()
  const dueTime = new Date((value.now - 1) * 1000).toISOString()
  value.manifest.documents[0]!.archive_expires_at = new Date(
    (value.now - 7 * 86400 - 1) * 1000,
  ).toISOString()
  value.manifest.documents[0]!.delete_after = dueTime
  await value.r2.put(
    `manifests/${value.lecture}/manifest.json`,
    encodeManifest(value.manifest),
  )
  value.r2.failNextConditional = true
  const conflicted = await cleanupExpiredDocuments(
    value.env,
    new Date(value.now * 1000),
  )
  assert.equal(conflicted.conflicts, 1)
  assert.equal(value.r2.objects.has(value.objectKey), true)
  assert.equal(
    value.r2.objects.has(`manifests/${value.lecture}/manifest.json`),
    true,
  )

  const retried = await cleanupExpiredDocuments(
    value.env,
    new Date(value.now * 1000),
  )
  assert.equal(retried.deleted, 1)
  const repeated = await cleanupExpiredDocuments(
    value.env,
    new Date(value.now * 1000),
  )
  assert.equal(repeated.deleted, 0)
  assert.equal(
    [...value.r2.objects.keys()].some((key) => key.startsWith('audit/')),
    true,
  )
})

test('cleanup resumes safely after manifest commit and interrupted object deletion', async () => {
  const value = await fixture()
  value.manifest.documents[0]!.archive_expires_at = new Date(
    (value.now - 7 * 86400 - 1) * 1000,
  ).toISOString()
  value.manifest.documents[0]!.delete_after = new Date(
    (value.now - 1) * 1000,
  ).toISOString()
  await value.r2.put(
    `manifests/${value.lecture}/manifest.json`,
    encodeManifest(value.manifest),
  )
  value.r2.failNextDeleteKey = value.objectKey

  await assert.rejects(
    cleanupExpiredDocuments(value.env, new Date(value.now * 1000)),
    /simulated delete interruption/,
  )
  const committedManifest = await value.r2.get(
    `manifests/${value.lecture}/manifest.json`,
  )
  assert.ok(committedManifest)
  assert.equal(value.r2.objects.has(value.objectKey), true)
  assert.equal(
    [...value.r2.objects.keys()].some((key) =>
      key.startsWith('cleanup-pending/'),
    ),
    true,
  )

  const retried = await cleanupExpiredDocuments(
    value.env,
    new Date(value.now * 1000),
  )
  assert.equal(retried.deleted, 1)
  assert.equal(value.r2.objects.has(value.objectKey), false)
  assert.equal(
    [...value.r2.objects.keys()].some((key) =>
      key.startsWith('cleanup-pending/'),
    ),
    false,
  )
})

test('scheduled retention feed reconciles canonical close timestamps idempotently', async () => {
  const value = await fixture()
  value.env.PDF_RETENTION_FEED_URL =
    'https://example.supabase.co/functions/v1/get-pdf-retention-feed'
  value.env.PDF_RETENTION_SYNC_SECRET =
    'test-retention-secret-at-least-thirty-two-bytes'
  const archiveExpiresAt = '2026-08-13T00:00:00.000Z'
  const deleteAfter = '2026-08-20T00:00:00.000Z'
  let requests = 0
  const fetcher: typeof fetch = async (_input, init) => {
    requests += 1
    assert.equal(
      new Headers(init?.headers).get('Authorization'),
      `Bearer ${value.env.PDF_RETENTION_SYNC_SECRET}`,
    )
    return Response.json({
      contractVersion: 1,
      generatedAt: '2026-07-14T00:00:00.000Z',
      hasMore: false,
      items: [
        {
          archiveExpiresAt,
          deleteAfter,
          documentId: 'doc-main',
          documentVersion: 'a'.repeat(64),
          lecturePublicId: value.lecture,
        },
      ],
      nextOffset: 1,
      ok: true,
    })
  }

  const first = await syncRetentionMetadata(value.env, fetcher)
  assert.equal(first.manifestsUpdated, 1)
  const stored = await value.r2.get(`manifests/${value.lecture}/manifest.json`)
  assert.ok(stored)
  const manifest = decodeManifest(new Uint8Array(await stored.arrayBuffer!()))
  assert.equal(manifest.documents[0]?.archive_expires_at, archiveExpiresAt)
  assert.equal(manifest.documents[0]?.delete_after, deleteAfter)

  const second = await syncRetentionMetadata(value.env, fetcher)
  assert.equal(second.manifestsUpdated, 0)
  assert.equal(requests, 2)
})

test('archive ingest is authenticated, HMAC-addressed and rejects private fields', async () => {
  const value = await fixture()
  enableArchiveEnvironment(value)
  const worker = createAssetWorker(() => new Date(value.now * 1000))
  const payload = archivePayload(value)
  const unauthorized = await worker.fetch(
    new Request('https://pdf.example/internal/v1/archives', {
      body: JSON.stringify({
        archiveExpiresAt: payload.archive_expires_at,
        lectureCode: '285463',
        payload,
        payloadSha256: await sha256Json(payload),
        sourceVersion: 1,
      }),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    }),
    value.env,
  )
  assert.equal(unauthorized.status, 401)

  const accepted = await ingestArchive({ payload, value, worker })
  assert.equal(accepted.status, 200)
  const acceptedBody = (await accepted.json()) as {
    accepted: boolean
    sourceVersion: number
  }
  assert.equal(acceptedBody.accepted, true)
  assert.equal(acceptedBody.sourceVersion, 1)
  const lookupHash = await createArchiveLookupHash(
    '285463',
    value.env.ARCHIVE_CODE_LOOKUP_SECRET!,
  )
  const archiveObject = value.r2.objects.get(
    `archives/by-code/${lookupHash}.json`,
  )
  assert.ok(archiveObject)
  assert.equal(
    new TextDecoder().decode(archiveObject.bytes).includes('285463'),
    false,
  )
  const conflictingRetry = await ingestArchive({
    payload: archivePayload(value, { title: 'Conflicting same revision' }),
    value,
    worker,
  })
  assert.equal(conflictingRetry.status, 200)
  assert.equal(
    ((await conflictingRetry.json()) as { accepted: boolean }).accepted,
    false,
  )
  assert.match(
    new TextDecoder().decode(
      value.r2.objects.get(`archives/by-code/${lookupHash}.json`)!.bytes,
    ),
    /"title":"Archived lecture"/,
  )
  assert.equal(
    (
      await ingestArchive({
        code: '285465',
        payload: archivePayload(value, { material_summary: null }),
        value,
        worker,
      })
    ).status,
    200,
  )

  const privatePayload = structuredClone(payload)
  ;(
    privatePayload.comments as Array<Record<string, unknown>>
  )[0]!.serviceRoleKey = 'must-never-be-published'
  const rejected = await ingestArchive({
    code: '285464',
    payload: privatePayload,
    value,
    worker,
  })
  assert.equal(rejected.status, 400)
  assert.equal(
    [...value.r2.objects.keys()].some((key) => key.includes('285464')),
    false,
  )
})

test('archive ingest accepts the canonical payload emitted by the Supabase exporter', async () => {
  const value = await fixture()
  enableArchiveEnvironment(value)
  const worker = createAssetWorker(() => new Date(value.now * 1000))
  const claim = sanitizeArchiveExportClaim({
    archive_expires_at: archivePayload(value).archive_expires_at,
    attempt_count: 1,
    lecture_code: '285466',
    lecture_session_id: '10000000-0000-4000-8000-000000000066',
    payload: archivePayload(value, {
      material_summary: {
        bullets: ['Canonical material summary'],
        status: 'published',
      },
    }),
    source_version: 4,
  })
  const { payloadSha256 } = await sha256CanonicalJson(claim.payload)
  const response = await worker.fetch(
    new Request('https://pdf.example/internal/v1/archives', {
      body: JSON.stringify({
        archiveExpiresAt: claim.archiveExpiresAt,
        lectureCode: claim.lectureCode,
        payload: claim.payload,
        payloadSha256,
        sourceVersion: claim.sourceVersion,
      }),
      headers: {
        Authorization: `Bearer ${value.env.ARCHIVE_INGEST_SECRET}`,
        'Content-Type': 'application/json',
      },
      method: 'POST',
    }),
    value.env,
  )
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), {
    accepted: true,
    lookupHash: await createArchiveLookupHash(
      claim.lectureCode,
      value.env.ARCHIVE_CODE_LOOKUP_SECRET!,
    ),
    ok: true,
    sourceVersion: 4,
  })
})

test('archive resolve validates both rate limits, Turnstile action and hostname', async () => {
  const value = await fixture()
  const rateLimits = enableArchiveEnvironment(value)
  const requestedUrls: string[] = []
  let action = 'wrong-action'
  let hostname = 'compass.example'
  const worker = createAssetWorker(
    () => new Date(value.now * 1000),
    async (input, init) => {
      requestedUrls.push(String(input))
      const verification = JSON.parse(String(init?.body)) as {
        response: string
        secret: string
      }
      assert.equal(verification.response, 'turnstile-token')
      assert.equal(verification.secret, value.env.TURNSTILE_SECRET_KEY)
      return Response.json({ action, hostname, success: true })
    },
  )
  const payload = archivePayload(value, {
    material_summary: {
      bullets: ['Archived, teacher-approved point'],
      status: 'published',
    },
  })
  assert.equal((await ingestArchive({ payload, value, worker })).status, 200)

  const resolve = (
    lectureCode = '285463',
    origin = 'https://compass.example',
  ) =>
    worker.fetch(
      new Request('https://pdf.example/v1/archives/resolve', {
        body: JSON.stringify({
          lectureCode,
          turnstileToken: 'turnstile-token',
        }),
        headers: {
          'CF-Connecting-IP': '192.0.2.10',
          'Content-Type': 'application/json',
          ...(origin ? { Origin: origin } : {}),
          'X-Compass-Client-Id': '12345678-1234-4123-8123-123456789abc',
        },
        method: 'POST',
      }),
      value.env,
    )

  assert.equal((await resolve('285463', '')).status, 403)
  assert.equal((await resolve('285463', 'https://evil.example')).status, 403)
  assert.equal(requestedUrls.length, 0)
  assert.equal(rateLimits.clientKeys.length, 0)
  assert.equal(rateLimits.ipKeys.length, 0)

  value.r2.getCalls = []
  const nonexistentWithInvalidToken = await resolve('285999')
  const existingWithInvalidToken = await resolve()
  assert.equal(nonexistentWithInvalidToken.status, 404)
  assert.equal(existingWithInvalidToken.status, 404)
  assert.deepEqual(
    await nonexistentWithInvalidToken.json(),
    await existingWithInvalidToken.json(),
  )
  assert.equal(requestedUrls.length, 2)
  assert.equal(
    value.r2.getCalls.some((key) => key.startsWith('archives/by-code/')),
    false,
  )

  action = 'archive-lookup'
  hostname = 'wrong.example'
  assert.equal((await resolve()).status, 404)
  hostname = 'compass.example'
  const accepted = await resolve()
  assert.equal(accepted.status, 200)
  const body = (await accepted.json()) as {
    archive: {
      material_summary?: Record<string, unknown> | null
    }
    archiveAccessToken: string
    archiveAccessTokenExpiresAt: string
    lookupHash: string
  }
  assert.match(body.lookupHash, /^[0-9a-f]{64}$/)
  assert.deepEqual(body.archive.material_summary, {
    bullets: ['Archived, teacher-approved point'],
    status: 'published',
  })
  assert.ok(body.archiveAccessToken.length > 80)
  assert.ok(
    Date.parse(body.archiveAccessTokenExpiresAt) <=
      (value.now + 15 * 60) * 1000,
  )
  assert.equal(rateLimits.clientKeys.length, 4)
  assert.equal(rateLimits.ipKeys.length, 4)
  assert.ok(rateLimits.clientKeys.every((key) => !key.includes('285463')))
  assert.ok(rateLimits.ipKeys.every((key) => /^[0-9a-f]{64}$/.test(key)))
  assert.deepEqual(requestedUrls, [
    'https://challenges.cloudflare.com/turnstile/v0/siteverify',
    'https://challenges.cloudflare.com/turnstile/v0/siteverify',
    'https://challenges.cloudflare.com/turnstile/v0/siteverify',
    'https://challenges.cloudflare.com/turnstile/v0/siteverify',
  ])

  const blockedValue = await fixture()
  enableArchiveEnvironment(blockedValue, { clientAllowed: false })
  const blockedWorker = createAssetWorker(
    () => new Date(blockedValue.now * 1000),
    async () => {
      throw new Error('Turnstile must not run after rate-limit rejection.')
    },
  )
  assert.equal(
    (
      await ingestArchive({
        payload: archivePayload(blockedValue),
        value: blockedValue,
        worker: blockedWorker,
      })
    ).status,
    200,
  )
  const blocked = await blockedWorker.fetch(
    new Request('https://pdf.example/v1/archives/resolve', {
      body: JSON.stringify({
        lectureCode: '285463',
        turnstileToken: 'turnstile-token',
      }),
      headers: {
        'CF-Connecting-IP': '192.0.2.10',
        'Content-Type': 'application/json',
        Origin: 'https://compass.example',
        'X-Compass-Client-Id': '12345678-1234-4123-8123-123456789abc',
      },
      method: 'POST',
    }),
    blockedValue.env,
  )
  assert.equal(blocked.status, 429)
})

test('archive failure guard blocks repeated unknown codes without penalizing successful NAT traffic', async () => {
  const value = await fixture()
  enableArchiveEnvironment(value)
  let turnstileChecks = 0
  const worker = createAssetWorker(
    () => new Date(value.now * 1000),
    async () => {
      turnstileChecks += 1
      return Response.json({
        action: 'archive-lookup',
        hostname: 'compass.example',
        success: true,
      })
    },
  )
  assert.equal(
    (
      await ingestArchive({
        payload: archivePayload(value),
        value,
        worker,
      })
    ).status,
    200,
  )

  const resolve = (lectureCode: string, clientId: string) =>
    worker.fetch(
      new Request('https://pdf.example/v1/archives/resolve', {
        body: JSON.stringify({
          lectureCode,
          turnstileToken: 'turnstile-token',
        }),
        headers: {
          'CF-Connecting-IP': '192.0.2.44',
          'Content-Type': 'application/json',
          Origin: 'https://compass.example',
          'X-Compass-Client-Id': clientId,
        },
        method: 'POST',
      }),
      value.env,
    )

  assert.equal(
    (await resolve('285463', '32345678-1234-4123-8123-123456789abc')).status,
    200,
  )
  assert.equal(
    (await resolve('285463', '42345678-1234-4123-8123-123456789abc')).status,
    200,
  )

  for (let attempt = 0; attempt < 8; attempt += 1) {
    const code = String(900000 + attempt)
    assert.equal(
      (
        await resolve(
          code,
          `52345678-1234-4123-8123-${String(attempt).padStart(12, '0')}`,
        )
      ).status,
      404,
    )
  }
  const checksBeforeBlockedAttempt = turnstileChecks
  assert.equal(
    (await resolve('900008', '62345678-1234-4123-8123-123456789abc')).status,
    404,
  )
  assert.equal(
    turnstileChecks,
    checksBeforeBlockedAttempt,
    'the ninth failed-code attempt is denied before Turnstile and R2 lookup',
  )
})

test('archive document access is short-lived, scoped and revoked by a new archive revision', async () => {
  const value = await fixture()
  enableArchiveEnvironment(value)
  const worker = createAssetWorker(
    () => new Date(value.now * 1000),
    async () =>
      Response.json({
        action: 'archive-lookup',
        hostname: 'compass.example',
        success: true,
      }),
  )
  const payload = archivePayload(value)
  assert.equal((await ingestArchive({ payload, value, worker })).status, 200)
  const resolved = await worker.fetch(
    new Request('https://pdf.example/v1/archives/resolve', {
      body: JSON.stringify({
        lectureCode: '285463',
        turnstileToken: 'turnstile-token',
      }),
      headers: {
        'CF-Connecting-IP': '192.0.2.11',
        'Content-Type': 'application/json',
        Origin: 'https://compass.example',
        'X-Compass-Client-Id': '22345678-1234-4123-8123-123456789abc',
      },
      method: 'POST',
    }),
    value.env,
  )
  const archiveSession = (await resolved.json()) as {
    archiveAccessToken: string
    lookupHash: string
  }
  const accessUrl = `https://pdf.example/v1/archives/${archiveSession.lookupHash}/documents/doc-main/${value.version}/access?mode=inline`
  const access = await worker.fetch(
    new Request(accessUrl, {
      headers: {
        Authorization: `Bearer ${archiveSession.archiveAccessToken}`,
        Origin: 'https://compass.example',
      },
    }),
    value.env,
  )
  assert.equal(access.status, 200)
  const asset = (await access.json()) as { expiresAt: string; url: string }
  assert.ok(Date.parse(asset.expiresAt) <= (value.now + 5 * 60) * 1000)
  assert.equal(asset.url.includes(archiveSession.archiveAccessToken), false)

  const revisedPayload = archivePayload(value, { title: 'Revised archive' })
  assert.equal(
    (
      await ingestArchive({
        payload: revisedPayload,
        sourceVersion: 2,
        value,
        worker,
      })
    ).status,
    200,
  )
  const staleAccess = await worker.fetch(
    new Request(accessUrl, {
      headers: {
        Authorization: `Bearer ${archiveSession.archiveAccessToken}`,
        Origin: 'https://compass.example',
      },
    }),
    value.env,
  )
  assert.equal(staleAccess.status, 401)
})

test('archive resume tokens are lecture-scoped, short-lived and version-revocable', async () => {
  const value = await fixture()
  enableArchiveEnvironment(value)
  const worker = createAssetWorker(() => new Date(value.now * 1000))
  const payload = archivePayload(value, {
    lecture_public_id: value.lecture,
    resume_token_version: 1,
  })
  assert.equal((await ingestArchive({ payload, value, worker })).status, 200)
  assert.equal(
    value.r2.objects.has(`archives/by-public-id/${value.lecture}.json`),
    true,
  )

  const createResumeToken = (overrides: Record<string, unknown> = {}) =>
    signLectureResumeToken(
      {
        aud: 'compass-lecture-resume',
        exp: value.now + 7 * 24 * 60 * 60,
        iat: value.now,
        jti: crypto.randomUUID(),
        lec: value.lecture,
        ver: 1,
        ...overrides,
      },
      value.env.LECTURE_RESUME_TOKEN_SECRET!,
    )
  const resumeToken = await createResumeToken()
  const resume = await worker.fetch(
    new Request('https://pdf.example/v1/archives/resume', {
      body: JSON.stringify({ resumeToken }),
      headers: {
        'Content-Type': 'application/json',
        Origin: 'https://compass.example',
      },
      method: 'POST',
    }),
    value.env,
  )
  assert.equal(resume.status, 200)
  const resumeBody = (await resume.json()) as Record<string, unknown>
  assert.equal(resumeBody.ok, true)
  assert.match(String(resumeBody.lookupHash), /^[0-9a-f]{64}$/)
  assert.equal(JSON.stringify(resumeBody).includes(resumeToken), false)

  for (const token of [
    await createResumeToken({ lec: 'lecture_ffffffffffffffff' }),
    await createResumeToken({ ver: 2 }),
    await createResumeToken({ exp: value.now - 1, iat: value.now - 60 }),
  ]) {
    const rejected = await worker.fetch(
      new Request('https://pdf.example/v1/archives/resume', {
        body: JSON.stringify({ resumeToken: token }),
        headers: {
          'Content-Type': 'application/json',
          Origin: 'https://compass.example',
        },
        method: 'POST',
      }),
      value.env,
    )
    assert.equal(rejected.status, 404)
  }
})

test('archive cleanup honors the seven-day recovery window and resumes across pages', async () => {
  const value = await fixture()
  enableArchiveEnvironment(value)
  value.r2.listPageSize = 1
  const cleanupTime = new Date((value.now + 40 * 86400) * 1000)
  const duePayload = archivePayload(value)
  const retainedPayload = archivePayload(value, {
    archive_expires_at: new Date((value.now + 35 * 86400) * 1000).toISOString(),
    closed_at: new Date((value.now + 5 * 86400) * 1000).toISOString(),
  })
  const dueLookup = await createArchiveLookupHash(
    '285463',
    value.env.ARCHIVE_CODE_LOOKUP_SECRET!,
  )
  const retainedLookup = await createArchiveLookupHash(
    '285464',
    value.env.ARCHIVE_CODE_LOOKUP_SECRET!,
  )
  for (const [lookup, payload] of [
    [dueLookup, duePayload],
    [retainedLookup, retainedPayload],
  ] as const) {
    await value.r2.put(
      `archives/by-code/${lookup}.json`,
      `${JSON.stringify({
        archive_expires_at: payload.archive_expires_at,
        payload,
        payload_sha256: await sha256Json(payload),
        published_at: new Date(value.now * 1000).toISOString(),
        schema_version: 1,
        source_version: 1,
      })}\n`,
    )
  }
  await value.r2.put('archives/by-code/invalid.json', 'not-json')

  const first = await cleanupExpiredLectureArchives(value.env, cleanupTime, 1)
  assert.equal(first.deleted, 1)
  assert.ok(first.scanned >= 2)
  assert.equal(
    value.r2.objects.has(`archives/by-code/${dueLookup}.json`),
    false,
  )
  assert.equal(
    value.r2.objects.has(`archives/by-code/${retainedLookup}.json`),
    true,
  )
  assert.equal(value.r2.objects.has('archives/by-code/invalid.json'), true)

  const repeated = await cleanupExpiredLectureArchives(
    value.env,
    cleanupTime,
    1,
  )
  assert.equal(repeated.deleted, 0)
  assert.ok(repeated.invalid >= 1)
})

test('browser PDF publication verifies origin, nonce, bytes, magic and native sha before upload', async () => {
  const value = await fixture()
  const coordinatorActions: string[] = []
  Object.assign(value.env, {
    PDF_PUBLICATION_COORDINATOR_SECRET:
      'publication-coordinator-secret-at-least-32-bytes',
    PDF_PUBLICATION_COORDINATOR_URL:
      'https://functions.example/coordinate-pdf-upload-worker',
    PDF_PUBLICATION_PUBLIC_JWK: value.env.PDF_ACCESS_PUBLIC_JWK,
    PHASE726_BROWSER_PDF_UPLOAD_ENABLED: 'true',
  })
  const fetcher = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    assert.equal(
      new Headers(init?.headers).get('X-Compass-Pdf-Publication-Secret'),
      value.env.PDF_PUBLICATION_COORDINATOR_SECRET,
    )
    const body = JSON.parse(String(init?.body)) as { action: string }
    coordinatorActions.push(body.action)
    return Response.json({ ok: true, status: body.action })
  }) as typeof fetch
  const worker = createAssetWorker(() => new Date(value.now * 1000), fetcher)
  const publicationId = '70000000-0000-4000-8000-000000000726'
  const pdf = new TextEncoder().encode('%PDF-1.7\nphase-7.26')
  const sha = createHash('sha256').update(pdf).digest('hex')
  const ticketJti = '71000000-0000-4000-8000-000000000726'
  const claims = {
    aud: 'compass-pdf-publication-worker',
    bytes: pdf.byteLength,
    doc: 'browser-material',
    exp: value.now + 300,
    gen: 1,
    iat: value.now,
    iss: 'compass-supabase',
    jti: ticketJti,
    lec: value.lecture,
    nbf: value.now - 1,
    nonce: 'A'.repeat(43),
    origin: 'https://compass.example',
    pub: publicationId,
    purpose: 'upload',
    sha,
    sid: '79000000-0000-4000-8000-000000000726',
  }
  const ticket = await createPublicationToken(value.keys.privateKey, claims)
  const upload = () =>
    worker.fetch(
      new Request(`https://pdf.example/v2/pdf-publications/${publicationId}`, {
        body: pdf,
        headers: {
          Authorization: `Bearer ${ticket}`,
          'Content-Length': String(pdf.byteLength),
          'Content-Type': 'application/pdf',
          Origin: 'https://compass.example',
        },
        method: 'PUT',
      }),
      value.env,
    )
  const response = await upload()
  assert.equal(response.status, 201)
  assert.deepEqual(coordinatorActions, ['claimNonce', 'recordUploaded'])
  assert.equal(
    value.r2.objects.has(
      `pdf/${value.lecture}/browser-material/${sha}/${publicationId}.pdf`,
    ),
    true,
  )

  const idempotent = await upload()
  assert.equal(idempotent.status, 200)
  assert.deepEqual(coordinatorActions, [
    'claimNonce',
    'recordUploaded',
    'recordUploaded',
  ])

  const replayTicket = await createPublicationToken(value.keys.privateKey, {
    ...claims,
    jti: '72000000-0000-4000-8000-000000000726',
  })
  const replay = await worker.fetch(
    new Request(`https://pdf.example/v2/pdf-publications/${publicationId}`, {
      body: pdf,
      headers: {
        Authorization: `Bearer ${replayTicket}`,
        'Content-Type': 'application/pdf',
        Origin: 'https://compass.example',
      },
      method: 'PUT',
    }),
    value.env,
  )
  assert.equal(replay.status, 409)

  const hostile = await worker.fetch(
    new Request(`https://pdf.example/v2/pdf-publications/${publicationId}`, {
      body: pdf,
      headers: {
        Authorization: `Bearer ${ticket}`,
        'Content-Type': 'application/pdf',
        Origin: 'https://evil.example',
      },
      method: 'PUT',
    }),
    value.env,
  )
  assert.equal(hostile.status, 403)
})

test('browser PDF publication permits only one concurrent first-use effect', async () => {
  const value = await fixture()
  Object.assign(value.env, {
    PDF_PUBLICATION_COORDINATOR_SECRET:
      'publication-coordinator-secret-at-least-32-bytes',
    PDF_PUBLICATION_COORDINATOR_URL:
      'https://functions.example/coordinate-pdf-upload-worker',
    PDF_PUBLICATION_PUBLIC_JWK: value.env.PDF_ACCESS_PUBLIC_JWK,
    PHASE726_BROWSER_PDF_UPLOAD_ENABLED: 'true',
  })
  let nonceClaimed = false
  let successfulNonceClaims = 0
  const fetcher = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as { action: string }
    if (body.action === 'claimNonce') {
      if (nonceClaimed) {
        return Response.json({ message: 'nonce already claimed', ok: false }, {
          status: 409,
        })
      }
      nonceClaimed = true
      successfulNonceClaims += 1
    }
    return Response.json({ ok: true, status: body.action })
  }) as typeof fetch
  const worker = createAssetWorker(() => new Date(value.now * 1000), fetcher)
  const publicationId = '72500000-0000-4000-8000-000000000726'
  const pdf = new TextEncoder().encode('%PDF-1.7\nconcurrent')
  const sha = createHash('sha256').update(pdf).digest('hex')
  const ticket = await createPublicationToken(value.keys.privateKey, {
    aud: 'compass-pdf-publication-worker',
    bytes: pdf.byteLength,
    doc: 'concurrent-material',
    exp: value.now + 300,
    gen: 1,
    iat: value.now,
    iss: 'compass-supabase',
    jti: '72600000-0000-4000-8000-000000000726',
    lec: value.lecture,
    nbf: value.now - 1,
    nonce: 'N'.repeat(43),
    origin: 'https://compass.example',
    pub: publicationId,
    purpose: 'upload',
    sha,
    sid: '79000000-0000-4000-8000-000000000726',
  })
  const upload = () =>
    worker.fetch(
      new Request(`https://pdf.example/v2/pdf-publications/${publicationId}`, {
        body: pdf,
        headers: {
          Authorization: `Bearer ${ticket}`,
          'Content-Type': 'application/pdf',
          Origin: 'https://compass.example',
        },
        method: 'PUT',
      }),
      value.env,
    )

  const responses = await Promise.all([upload(), upload()])
  const statuses = responses.map((response) => response.status).sort()
  assert.equal(statuses.includes(201), true)
  assert.equal(statuses[0] === 200 || statuses[1] === 409, true)
  assert.equal(successfulNonceClaims, 1)
  assert.equal(
    value.r2.objects.has(
      `pdf/${value.lecture}/concurrent-material/${sha}/${publicationId}.pdf`,
    ),
    true,
  )
})

test('browser PDF publication rejects actual-size, sha and immutable-key conflicts without orphaning a new object', async () => {
  const value = await fixture()
  Object.assign(value.env, {
    PDF_PUBLICATION_COORDINATOR_SECRET:
      'publication-coordinator-secret-at-least-32-bytes',
    PDF_PUBLICATION_COORDINATOR_URL:
      'https://functions.example/coordinate-pdf-upload-worker',
    PDF_PUBLICATION_PUBLIC_JWK: value.env.PDF_ACCESS_PUBLIC_JWK,
    PHASE726_BROWSER_PDF_UPLOAD_ENABLED: 'true',
  })
  const worker = createAssetWorker(
    () => new Date(value.now * 1000),
    (async () => Response.json({ ok: true })) as typeof fetch,
  )
  const pdf = new TextEncoder().encode('%PDF-1.7\nintegrity')
  const sha = createHash('sha256').update(pdf).digest('hex')
  const baseClaims = {
    aud: 'compass-pdf-publication-worker',
    doc: 'integrity-material',
    exp: value.now + 300,
    gen: 1,
    iat: value.now,
    iss: 'compass-supabase',
    lec: value.lecture,
    nbf: value.now - 1,
    origin: 'https://compass.example',
    purpose: 'upload',
    sid: '79000000-0000-4000-8000-000000000726',
  }
  const upload = async (input: {
    bytes: number
    jti: string
    nonce: string
    publicationId: string
    sha: string
  }) => {
    const ticket = await createPublicationToken(value.keys.privateKey, {
      ...baseClaims,
      bytes: input.bytes,
      jti: input.jti,
      nonce: input.nonce,
      pub: input.publicationId,
      sha: input.sha,
    })
    return worker.fetch(
      new Request(
        `https://pdf.example/v2/pdf-publications/${input.publicationId}`,
        {
          body: pdf,
          headers: {
            Authorization: `Bearer ${ticket}`,
            'Content-Type': 'application/pdf',
            Origin: 'https://compass.example',
          },
          method: 'PUT',
        },
      ),
      value.env,
    )
  }

  const shortPublicationId = '72700000-0000-4000-8000-000000000726'
  const short = await upload({
    bytes: pdf.byteLength + 1,
    jti: '72800000-0000-4000-8000-000000000726',
    nonce: 'S'.repeat(43),
    publicationId: shortPublicationId,
    sha,
  })
  assert.equal(short.status, 400)
  assert.equal(
    value.r2.objects.has(
      `pdf/${value.lecture}/integrity-material/${sha}/${shortPublicationId}.pdf`,
    ),
    false,
  )

  const hashPublicationId = '72900000-0000-4000-8000-000000000726'
  const wrongSha = '0'.repeat(64)
  const hashMismatch = await upload({
    bytes: pdf.byteLength,
    jti: '72a00000-0000-4000-8000-000000000726',
    nonce: 'H'.repeat(43),
    publicationId: hashPublicationId,
    sha: wrongSha,
  })
  assert.equal(hashMismatch.status, 400)
  assert.equal(
    value.r2.objects.has(
      `pdf/${value.lecture}/integrity-material/${wrongSha}/${hashPublicationId}.pdf`,
    ),
    false,
  )

  const collisionPublicationId = '72b00000-0000-4000-8000-000000000726'
  const collisionKey =
    `pdf/${value.lecture}/integrity-material/${sha}/${collisionPublicationId}.pdf`
  const existingBytes = new TextEncoder().encode('%PDF-1.7\nexisting')
  await value.r2.put(collisionKey, existingBytes)
  const collision = await upload({
    bytes: pdf.byteLength,
    jti: '72c00000-0000-4000-8000-000000000726',
    nonce: 'I'.repeat(43),
    publicationId: collisionPublicationId,
    sha,
  })
  assert.equal(collision.status, 409)
  assert.deepEqual(value.r2.objects.get(collisionKey)?.bytes, existingBytes)
})

test('browser PDF publication rejects malformed bytes and keeps uncommitted objects inaccessible', async () => {
  const value = await fixture()
  Object.assign(value.env, {
    PDF_PUBLICATION_COORDINATOR_SECRET:
      'publication-coordinator-secret-at-least-32-bytes',
    PDF_PUBLICATION_COORDINATOR_URL:
      'https://functions.example/coordinate-pdf-upload-worker',
    PDF_PUBLICATION_PUBLIC_JWK: value.env.PDF_ACCESS_PUBLIC_JWK,
    PHASE726_BROWSER_PDF_UPLOAD_ENABLED: 'true',
  })
  const fetcher = (async () => Response.json({ ok: true })) as typeof fetch
  const worker = createAssetWorker(() => new Date(value.now * 1000), fetcher)
  const publicationId = '73000000-0000-4000-8000-000000000726'
  const invalid = new TextEncoder().encode('NOT-A-PDF')
  const sha = createHash('sha256').update(invalid).digest('hex')
  const token = await createPublicationToken(value.keys.privateKey, {
    aud: 'compass-pdf-publication-worker',
    bytes: invalid.byteLength,
    doc: 'invalid-material',
    exp: value.now + 300,
    gen: 1,
    iat: value.now,
    iss: 'compass-supabase',
    jti: '74000000-0000-4000-8000-000000000726',
    lec: value.lecture,
    nbf: value.now - 1,
    nonce: 'B'.repeat(43),
    origin: 'https://compass.example',
    pub: publicationId,
    purpose: 'upload',
    sha,
    sid: '79000000-0000-4000-8000-000000000726',
  })
  const response = await worker.fetch(
    new Request(`https://pdf.example/v2/pdf-publications/${publicationId}`, {
      body: invalid,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/pdf',
        Origin: 'https://compass.example',
      },
      method: 'PUT',
    }),
    value.env,
  )
  assert.equal(response.status, 400)
  assert.equal(
    value.r2.objects.has(
      `pdf/${value.lecture}/invalid-material/${sha}/${publicationId}.pdf`,
    ),
    false,
  )

  const missingAccess = await worker.fetch(
    new Request(
      `https://pdf.example/v1/lectures/${value.lecture}/documents/invalid-material/${sha}/access`,
      {
        headers: {
          Authorization: `Bearer ${value.token}`,
          Origin: 'https://compass.example',
        },
      },
    ),
    value.env,
  )
  assert.equal(missingAccess.status, 410)
})

test('hidden commit and activation fence keep publication inaccessible until DB can publish it', async () => {
  const value = await fixture()
  Object.assign(value.env, {
    PDF_PUBLICATION_COORDINATOR_SECRET:
      'publication-coordinator-secret-at-least-32-bytes',
    PDF_PUBLICATION_COORDINATOR_URL:
      'https://functions.example/coordinate-pdf-upload-worker',
    PDF_PUBLICATION_PUBLIC_JWK: value.env.PDF_ACCESS_PUBLIC_JWK,
    PHASE726_BROWSER_PDF_UPLOAD_ENABLED: 'true',
  })
  const worker = createAssetWorker(
    () => new Date(value.now * 1000),
    (async () => Response.json({ ok: true })) as typeof fetch,
  )
  const publicationId = '75000000-0000-4000-8000-000000000726'
  const pdf = new TextEncoder().encode('%PDF-1.7\ncommitted')
  const sha = createHash('sha256').update(pdf).digest('hex')
  const baseClaims = {
    aud: 'compass-pdf-publication-worker',
    bytes: pdf.byteLength,
    doc: 'browser-material',
    exp: value.now + 300,
    gen: 1,
    iat: value.now,
    iss: 'compass-supabase',
    lec: value.lecture,
    nbf: value.now - 1,
    origin: 'https://compass.example',
    pub: publicationId,
    sha,
    sid: '79000000-0000-4000-8000-000000000726',
  }
  const uploadToken = await createPublicationToken(value.keys.privateKey, {
    ...baseClaims,
    jti: '76000000-0000-4000-8000-000000000726',
    nonce: 'C'.repeat(43),
    purpose: 'upload',
  })
  const uploaded = await worker.fetch(
    new Request(`https://pdf.example/v2/pdf-publications/${publicationId}`, {
      body: pdf,
      headers: {
        Authorization: `Bearer ${uploadToken}`,
        'Content-Type': 'application/pdf',
        Origin: 'https://compass.example',
      },
      method: 'PUT',
    }),
    value.env,
  )
  assert.equal(uploaded.status, 201)

  const commitToken = await createPublicationToken(value.keys.privateKey, {
    ...baseClaims,
    download: true,
    jti: '77000000-0000-4000-8000-000000000726',
    name: 'Browser material',
    pages: 1,
    previous_av: 1,
    purpose: 'commit',
    text_chars: 9,
    text_sha: 'd'.repeat(64),
  })
  const committed = await worker.fetch(
    new Request(
      `https://pdf.example/v2/pdf-publications/${publicationId}/commit`,
      {
        headers: { Authorization: `Bearer ${commitToken}` },
        method: 'POST',
      },
    ),
    value.env,
  )
  assert.equal(committed.status, 200)
  const stillOld = await worker.fetch(
    new Request(`https://pdf.example/v1/lectures/${value.lecture}/manifest`, {
      headers: {
        Authorization: `Bearer ${value.token}`,
        Origin: 'https://compass.example',
      },
    }),
    value.env,
  )
  assert.equal(stillOld.status, 200)
  const oldPublicManifest = (await stillOld.json()) as {
    documents: Array<{ document_id: string }>
  }
  assert.equal(
    oldPublicManifest.documents.some(
      (document) => document.document_id === 'browser-material',
    ),
    false,
  )
  const stagedObject = await value.r2.get(
    `manifests/${value.lecture}/manifest.json`,
  )
  assert.ok(stagedObject)
  const stagedManifest = decodeManifest(
    new Uint8Array(await stagedObject.arrayBuffer!()),
  )
  assert.equal(stagedManifest.access_version, 1)
  assert.equal(
    stagedManifest.documents.some(
      (document) =>
        document.document_id === 'browser-material' && !document.visible,
    ),
    true,
  )

  const activateToken = await createPublicationToken(value.keys.privateKey, {
    ...baseClaims,
    jti: '77500000-0000-4000-8000-000000000726',
    previous_av: 1,
    purpose: 'activate',
    target_av: 2,
  })
  const activated = await worker.fetch(
    new Request(
      `https://pdf.example/v2/pdf-publications/${publicationId}/activate`,
      {
        headers: { Authorization: `Bearer ${activateToken}` },
        method: 'POST',
      },
    ),
    value.env,
  )
  assert.equal(activated.status, 200)
  const fenced = await worker.fetch(
    new Request(`https://pdf.example/v1/lectures/${value.lecture}/manifest`, {
      headers: {
        Authorization: `Bearer ${value.token}`,
        Origin: 'https://compass.example',
      },
    }),
    value.env,
  )
  assert.equal(fenced.status, 401)

  const rollbackToken = await createPublicationToken(value.keys.privateKey, {
    ...baseClaims,
    jti: '78000000-0000-4000-8000-000000000726',
    previous_av: 1,
    purpose: 'rollback',
    target_av: 2,
  })
  const rolledBack = await worker.fetch(
    new Request(
      `https://pdf.example/v2/pdf-publications/${publicationId}/rollback`,
      {
        headers: { Authorization: `Bearer ${rollbackToken}` },
        method: 'POST',
      },
    ),
    value.env,
  )
  assert.equal(rolledBack.status, 200)
  const restoredObject = await value.r2.get(
    `manifests/${value.lecture}/manifest.json`,
  )
  assert.ok(restoredObject)
  const restored = decodeManifest(
    new Uint8Array(await restoredObject.arrayBuffer!()),
  )
  assert.equal(restored.access_version, 1)
  assert.equal(
    restored.documents.some(
      (document) => document.document_id === 'browser-material',
    ),
    false,
  )
})

test('publication status recovers an object written before the uploaded ledger CAS', async () => {
  const value = await fixture()
  Object.assign(value.env, {
    PDF_PUBLICATION_COORDINATOR_SECRET:
      'publication-coordinator-secret-at-least-32-bytes',
    PDF_PUBLICATION_COORDINATOR_URL:
      'https://functions.example/coordinate-pdf-upload-worker',
    PDF_PUBLICATION_PUBLIC_JWK: value.env.PDF_ACCESS_PUBLIC_JWK,
    PHASE726_BROWSER_PDF_UPLOAD_ENABLED: 'true',
  })
  const actions: string[] = []
  const worker = createAssetWorker(
    () => new Date(value.now * 1000),
    (async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { action: string }
      actions.push(body.action)
      return Response.json({ ok: true, status: body.action })
    }) as typeof fetch,
  )
  const publicationId = '78500000-0000-4000-8000-000000000726'
  const attemptId = '78600000-0000-4000-8000-000000000726'
  const pdf = new TextEncoder().encode('%PDF-1.7\nrecover')
  const sha = createHash('sha256').update(pdf).digest('hex')
  const objectKey =
    `pdf/${value.lecture}/recover-material/${sha}/${publicationId}.pdf`
  await value.r2.put(objectKey, pdf, { sha256: sha })
  await value.r2.put(
    `publication-ledger/${publicationId}.json`,
    `${JSON.stringify({
      bytes: pdf.byteLength,
      createdAt: new Date(value.now * 1000).toISOString(),
      documentId: 'recover-material',
      generation: 1,
      lecturePublicId: value.lecture,
      objectKey,
      pdfSha256: sha,
      publicationId,
      status: 'receiving',
      ticketJti: attemptId,
      updatedAt: new Date(value.now * 1000).toISOString(),
    })}\n`,
  )
  const statusTicket = await createPublicationToken(value.keys.privateKey, {
    aud: 'compass-pdf-publication-worker',
    bytes: pdf.byteLength,
    doc: 'recover-material',
    exp: value.now + 60,
    gen: 1,
    iat: value.now,
    iss: 'compass-supabase',
    jti: '78700000-0000-4000-8000-000000000726',
    lec: value.lecture,
    nbf: value.now - 1,
    origin: 'https://compass.example',
    pub: publicationId,
    purpose: 'status',
    sha,
    sid: '79000000-0000-4000-8000-000000000726',
  })
  const response = await worker.fetch(
    new Request(
      `https://pdf.example/v2/pdf-publications/${publicationId}/status`,
      { headers: { Authorization: `Bearer ${statusTicket}` } },
    ),
    value.env,
  )
  assert.equal(response.status, 200)
  assert.equal((await response.json() as { status: string }).status, 'uploaded')
  assert.deepEqual(actions, ['recordUploaded'])
  const ledger = await value.r2.get(`publication-ledger/${publicationId}.json`)
  assert.ok(ledger)
  assert.equal(
    JSON.parse(new TextDecoder().decode(new Uint8Array(await ledger.arrayBuffer!())))
      .status,
    'uploaded',
  )
})

test('DB-leased publication cleanup remains active when uploads are disabled and removes only hidden references', async () => {
  const value = await fixture()
  Object.assign(value.env, {
    PDF_PUBLICATION_COORDINATOR_SECRET:
      'publication-coordinator-secret-at-least-32-bytes',
    PDF_PUBLICATION_COORDINATOR_URL:
      'https://functions.example/coordinate-pdf-upload-worker',
    PHASE726_BROWSER_PDF_UPLOAD_ENABLED: 'false',
  })
  const publicationId = '78800000-0000-4000-8000-000000000726'
  const cleanupClaimId = '78900000-0000-4000-8000-000000000726'
  const sha = 'e'.repeat(64)
  const objectKey =
    `pdf/${value.lecture}/cleanup-material/${sha}/${publicationId}.pdf`
  const pdf = new TextEncoder().encode('%PDF-cleanup')
  await value.r2.put(objectKey, pdf)
  await value.r2.put(
    `publication-ledger/${publicationId}.json`,
    `${JSON.stringify({
      bytes: pdf.byteLength,
      createdAt: new Date(value.now * 1000).toISOString(),
      documentId: 'cleanup-material',
      generation: 1,
      lecturePublicId: value.lecture,
      objectKey,
      pdfSha256: sha,
      publicationId,
      status: 'uploaded',
      ticketJti: '78a00000-0000-4000-8000-000000000726',
      updatedAt: new Date(value.now * 1000).toISOString(),
    })}\n`,
  )
  await value.r2.put(
    `manifests/${value.lecture}/manifest.json`,
    encodeManifest({
      ...value.manifest,
      documents: [
        ...value.manifest.documents,
        {
          archive_expires_at: null,
          byte_size: pdf.byteLength,
          delete_after: null,
          display_name: 'Cleanup material',
          document_id: 'cleanup-material',
          document_version: sha,
          download_enabled: true,
          object_key: objectKey,
          page_count: 1,
          pdf_sha256: sha,
          text_char_count: 1,
          text_sha256: 'f'.repeat(64),
          visible: false,
        },
      ],
      manifest_version: value.manifest.manifest_version + 1,
    }),
  )
  const completions: Array<Record<string, unknown>> = []
  let claimAvailable = true
  const fetcher = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>
    if (body.action === 'claimCleanup') {
      const data = claimAvailable
        ? [{
            cleanup_claim_id: cleanupClaimId,
            document_id: 'cleanup-material',
            expected_pdf_sha256: sha,
            lecture_public_id: value.lecture,
            object_key: objectKey,
            publication_id: publicationId,
            state: 'expired',
          }]
        : []
      claimAvailable = false
      return Response.json({ data, ok: true })
    }
    completions.push(body)
    return Response.json({ ok: true })
  }) as typeof fetch

  const result = await cleanupExpiredPdfPublications(
    value.env,
    new Date(value.now * 1000),
    25,
    fetcher,
  )
  assert.deepEqual(result, {
    deletedLedgers: 1,
    deletedObjects: 1,
    failures: 0,
    scanned: 1,
    skipped: false,
  })
  assert.equal(value.r2.objects.has(objectKey), false)
  assert.equal(
    value.r2.objects.has(`publication-ledger/${publicationId}.json`),
    false,
  )
  const manifestObject = await value.r2.get(
    `manifests/${value.lecture}/manifest.json`,
  )
  assert.ok(manifestObject)
  const manifest = decodeManifest(
    new Uint8Array(await manifestObject.arrayBuffer!()),
  )
  assert.equal(
    manifest.documents.some((document) => document.object_key === objectKey),
    false,
  )
  assert.equal(completions.length, 1)
  assert.equal(completions[0]?.succeeded, true)

  const repeated = await cleanupExpiredPdfPublications(
    value.env,
    new Date(value.now * 1000),
    25,
    fetcher,
  )
  assert.equal(repeated.scanned, 0)
})
