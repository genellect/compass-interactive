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
import type { R2BucketLike, R2ObjectLike } from '../src/r2Types.ts'

class FakeR2 implements R2BucketLike {
  objects = new Map<string, { bytes: Uint8Array; etag: string }>()
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
    stored: { bytes: Uint8Array; etag: string },
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
    value: Uint8Array | string,
    options?: { onlyIf?: { etagMatches?: string; etagDoesNotMatch?: string } },
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
      typeof value === 'string' ? new TextEncoder().encode(value) : value
    const etag = createHash('sha256').update(bytes).digest('hex')
    this.objects.set(key, { bytes, etag })
    return this.#object(key, { bytes, etag })
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
